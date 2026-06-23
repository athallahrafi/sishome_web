require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
// const { Pool } = require('@neondatabase/serverless');
const mqtt = require('mqtt');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Konfigurasi Database (AWS RDS / Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ganti nama variabel env agar lebih universal
  ssl: { 
    rejectUnauthorized: false 
  }
  // ssl: false
});
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Gagal terhubung ke Database PostgreSQL:', err.message);
  } else {
    console.log('✅ Backend terhubung ke Database (Neon/RDS)');
    release(); // Penting: lepaskan kembali koneksi ke pool setelah tes berhasil
  }
});

// 2. Konfigurasi MQTT Broker (HiveMQ Cloud via MQTTS)
// Format di .env -> MQTT_BROKER_URL=mqtts://f5c8801cf6d342bea2c68cbc379544ae.s1.eu.hivemq.cloud
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  port: 8883, // Port wajib untuk MQTTS (Server Backend)
  clientId: 'SiSHome_Backend_' + Math.random().toString(16).substring(2, 8)
});

// Variabel penyimpan data sensor terakhir (karena dipisah topiknya oleh ESP32)
let latestSensorData = { temperature: 0, humidity: 0 };
let latestRelayState = 'OFF';

mqttClient.on('connect', () => {
  console.log('✅ Backend terhubung ke HiveMQ Cloud');
  // Subscribe ke topik yang dikirim ESP32
  mqttClient.subscribe('SiSHome/degre');
  mqttClient.subscribe('SiSHome/humid');
  mqttClient.subscribe('SiSHome/relay');
});

mqttClient.on('message', (topic, message) => {
  const payload = message.toString();
  try {
    if (topic === 'SiSHome/degre') {
      latestSensorData.temperature = parseFloat(payload);
    } else if (topic === 'SiSHome/humid') {
      latestSensorData.humidity = parseFloat(payload);
    } else if (topic === 'SiSHome/relay') {
      latestRelayState = payload;
      console.log(`🔌 [Status Sync] Relay saat ini: ${latestRelayState}`);
    }
  } catch (error) {
    console.error('Gagal memproses data sensor MQTT');
  }
});

// 3. API Endpoint: Toggle Relay dari Web
app.post('/api/relay', async (req, res) => {
  const { userId, action } = req.body; // action = 'ON' atau 'OFF'

  try {
    // Publish perintah ke ESP32
    mqttClient.publish('SiSHome/relay', action);

    // Simpan history ke Database
    await pool.query(
      'INSERT INTO sishome_relay_logs (user_id, action) VALUES ($1, $2)',
      [userId, action]
    );

    res.status(200).json({ message: `Relay diubah menjadi ${action}` });
  } catch (error) {
    console.error('Error API Relay:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- API: Mengambil daftar jadwal yang aktif ---
app.get('/api/schedules', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sishome_relay_schedules WHERE is_active = TRUE ORDER BY target_time ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil jadwal' });
  }
});

// --- API: Membuat jadwal baru ---
app.post('/api/schedules', async (req, res) => {
  // Potong string agar pasti berformat HH:MM (5 karakter)
  try {
    const { userId, targetTime, action } = req.body; // targetTime format "HH:MM"
    const timeFormatted = targetTime.substring(0, 5); 
    await pool.query(
      'INSERT INTO sishome_relay_schedules (user_id, target_time, action) VALUES ($1, $2, $3)',
      [userId, timeFormatted, action]
    );
    res.status(201).json({ message: 'Jadwal berhasil ditambahkan' });
  } catch (error) {
    console.error('❌ Error saat insert jadwal:', error.message);
    res.status(500).json({ error: 'Gagal menyimpan jadwal' });
  }
});

// --- CRON JOB: Pengecek Jadwal (Berjalan Setiap 1 Menit) ---
cron.schedule('* * * * *', async () => {
  // Ambil waktu server sekarang
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  try {
    const result = await pool.query(
      'SELECT id, action, user_id FROM sishome_relay_schedules WHERE target_time = $1 AND is_active = TRUE',
      [currentHHMM]
    );

    for (const schedule of result.rows) {
      // 1. Eksekusi MQTT ke ESP32 ('ON' / 'OFF')
      mqttClient.publish('SiSHome/relay', schedule.action);
      
      // 2. Simpan Log
      await pool.query(
        'INSERT INTO sishome_relay_logs (user_id, action) VALUES ($1, $2)',
        [schedule.user_id, `${schedule.action} (Auto)`]
      );

      // 3. Matikan status jadwal (Execute Once)
      await pool.query(
        'UPDATE sishome_relay_schedules SET is_active = FALSE WHERE id = $1',
        [schedule.id]
      );

      console.log(`⏰ [Scheduler] Relay otomatis ${schedule.action} dieksekusi pukul ${currentHHMM}`);
    }
  } catch (error) {
    console.error('Scheduler Error:', error);
  }
});

// --- CRON JOB: Log Suhu & Kelembapan (Berjalan Setiap 15 Menit) ---
cron.schedule('*/15 * * * *', async () => {
  // Hanya simpan jika nilai tidak 0 (artinya ESP32 sudah pernah mengirim data)
  if (latestSensorData.temperature !== 0 || latestSensorData.humidity !== 0) {
    try {
      await pool.query(
        'INSERT INTO sishome_sensor_logs (temperature, humidity) VALUES ($1, $2)',
        [latestSensorData.temperature, latestSensorData.humidity]
      );
      console.log('🕒 [Sensor Log] Data disimpan ke Database otomatis (15 Menit)');
    } catch (error) {
      console.error('Error menyimpan log sensor:', error);
    }
  }
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Menutup server secara aman...');
  mqttClient.end();
  await pool.end();
  process.exit(0);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server Backend aktif di port ${PORT}`));