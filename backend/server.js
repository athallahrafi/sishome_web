require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
// const { Pool } = require('@neondatabase/serverless');
const mqtt = require('mqtt');
const cron = require('node-cron');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
let latestRelayState = 'OFF';
let lastTriggeredBy = 1;
let isRelayProcessing = false; // Status gembok global
let lockTimeout; // Timer pengaman

const app = express();
app.use(cors({
  origin: ['https://sishome.rafiathallah.space', 'https://rafiathallah.space'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.set('trust proxy', 1);

// 1. Konfigurasi Database (AWS RDS / Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Ganti nama variabel env agar lebih universal
  ssl: { 
    rejectUnauthorized: false 
  },
  connectionTimeoutMillis: 10000, 
  idleTimeoutMillis: 30000,       
  keepAlive: true
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

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Durasi 15 menit
  max: 150, // Maksimal 150 request per IP dalam 15 menit
  message: { error: 'Terlalu banyak aktivitas dari IP ini. Silakan coba lagi setelah 15 menit.' },
  standardHeaders: true, // Kembalikan info limit di header RateLimit-*
  legacyHeaders: false, // Matikan header X-RateLimit-* yang sudah usang
});

app.use('/api/', globalLimiter);

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // Durasi 1 Jam
  max: 10, // Maksimal 10 percobaan login per IP per jam
  message: { error: 'Terlalu banyak percobaan login. Akun Anda diamankan sementara, coba lagi 1 jam kemudian.' }
});
app.use('/api/auth/google', authLimiter);

let latestSensorData = { temperature: 0, humidity: 0 };

mqttClient.on('connect', () => {
  console.log('✅ Backend terhubung ke HiveMQ Cloud');
  // Subscribe ke topik yang dikirim ESP32
  mqttClient.subscribe('SiSHome/degre');
  mqttClient.subscribe('SiSHome/humid');
  mqttClient.subscribe('SiSHome/relay/status');
  mqttClient.subscribe('SiSHome/relay');
});

// --- PENERIMA PESAN MQTT TERPADU ---
mqttClient.on('message', async (topic, message) => {
  const payload = message.toString();
  try {
    if (topic === 'SiSHome/degre') {
      latestSensorData.temperature = parseFloat(payload);
    } 
    else if (topic === 'SiSHome/humid') {
      latestSensorData.humidity = parseFloat(payload);
    } 
    else if (topic === 'SiSHome/relay/status') {
      latestRelayState = payload;
      console.log(`🔌 [Status Sync] ESP32 mengonfirmasi relay: ${latestRelayState}`);
      
      // --- TAMBAHKAN BLOK BUKA GEMBOK INI ---
      if (isRelayProcessing) {
        isRelayProcessing = false;
        clearTimeout(lockTimeout); // Matikan alarm Watchdog
        mqttClient.publish('SiSHome/relay/lock', 'UNLOCKED'); // Suruh semua UI User buka tombol
      }
      // --------------------------------------

      // Catat ke Database... (kode db bawaanmu tetap di bawah ini)
      await pool.query(
        'INSERT INTO sishome_relay_logs (user_id, action) VALUES ($1, $2)',
        [lastTriggeredBy, payload] 
      );
    }
  } catch (error) {
    console.error('Gagal memproses/mencatat data MQTT:', error.message);
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body; // Token KTP yang dikirim dari React

  try {
    // 1. Verifikasi keaslian token ke Server Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload(); // Berisi email, nama, foto profil
    
    // 2. Cek apakah user sudah ada di database Neon
    let userResult = await pool.query('SELECT * FROM sishome_users WHERE email = $1', [payload.email]);
    let user = userResult.rows[0];

    // 3. Jika belum ada (User Baru), daftarkan otomatis (Auto-Register)
    if (!user) {
      const insertResult = await pool.query(
        'INSERT INTO sishome_users (name, email, google_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *',
        [payload.name, payload.email, payload.sub, payload.picture]
      );
      user = insertResult.rows[0];
    }

    // 4. Buat Tiket Masuk (JWT) khusus untuk SiSHome
    const sishomeToken = jwt.sign(
      { id: user.id, email: user.email, name: user.name }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // Sesi login berlaku 7 hari
    );

    // 5. Kirim data kembali ke React
    res.status(200).json({ 
      message: 'Login Berhasil', 
      token: sishomeToken, 
      userData: { id: user.id, name: user.name, avatar: user.avatar_url } 
    });

  } catch (error) {
    console.error('❌ Error Google Auth:', error);
    res.status(401).json({ error: 'Autentikasi Google Gagal' });
  }
});

// --- API Endpoint: Toggle Relay dari Web ---
app.post('/api/relay', async (req, res) => {
  // 1. Tolak request jika sistem sedang dipakai orang lain (Gembok Aktif)
  if (isRelayProcessing) {
    return res.status(423).json({ error: 'Sistem sibuk! Pengguna lain sedang mengontrol perangkat.' });
  }

  const { userId, action } = req.body; 
  
  try {
    // 2. Aktifkan Gembok Global
    isRelayProcessing = true;
    lastTriggeredBy = userId; 
    
    // 3. Umumkan ke semua User (via MQTT) agar tombol mereka dikunci
    mqttClient.publish('SiSHome/relay/lock', 'LOCKED'); 
    
    // 4. Kirim perintah ke ESP32
    mqttClient.publish('SiSHome/relay/cmd', action); 

    // 5. Pasang Watchdog Timer (Buka gembok paksa jika ESP32 mati/offline setelah 5 detik)
    clearTimeout(lockTimeout);
    lockTimeout = setTimeout(() => {
      if (isRelayProcessing) {
        isRelayProcessing = false;
        mqttClient.publish('SiSHome/relay/lock', 'UNLOCKED');
        console.log('⚠️ [Watchdog] Gembok dilepas paksa. ESP32 tidak merespons.');
      }
    }, 5000); 

    res.status(200).json({ message: 'Perintah sedang diproses ESP32...' });
  } catch (error) {
    isRelayProcessing = false;
    res.status(500).json({ error: 'Gagal mengirim perintah' });
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
// --- API: Membuat jadwal baru ---
app.post('/api/schedules', async (req, res) => {
  try {
    const { userId, targetTime, action } = req.body; 
    const timeFormatted = targetTime.substring(0, 5); 
    
    // PERBAIKAN: Tambahkan is_active ke dalam kueri
    await pool.query(
      'INSERT INTO sishome_relay_schedules (user_id, target_time, action, is_active) VALUES ($1, $2, $3, $4)',
      [userId, timeFormatted, action, true] // true ditambahkan di sini
    );
    res.status(201).json({ message: 'Jadwal berhasil ditambahkan' });
  } catch (error) {
    console.error('❌ Error saat insert jadwal:', error.message);
    res.status(500).json({ error: 'Gagal menyimpan jadwal' });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rl.action, TO_CHAR(rl.created_at, 'HH24:MI:SS') as time, u.name as user_name 
      FROM sishome_relay_logs rl 
      JOIN sishome_users u ON rl.user_id = u.id 
      ORDER BY rl.created_at DESC LIMIT 5
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error mengambil logs:', error.message);
    res.status(500).json([]);
  }
});

// --- API: Mengambil Data Grafik Sensor (10 Pembacaan Terakhir) ---
app.get('/api/chart', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT temperature as suhu, humidity as kelembapan, TO_CHAR(created_at, 'HH24:MI') as time 
      FROM sishome_sensor_logs 
      ORDER BY created_at DESC LIMIT 10
    `);
    // Dibalik (reverse) agar grafik mengalir dari waktu terlama di kiri ke terbaru di kanan
    res.json(result.rows.reverse()); 
  } catch (error) {
    console.error('❌ Error mengambil data chart:', error.message);
    res.status(500).json([]);
  }
});

// --- CRON JOB: Pengecek Jadwal (Berjalan Setiap 1 Menit) ---
cron.schedule('* * * * *', async () => {
  // Ambil waktu server sekarang
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  try {
    const result = await pool.query(
      'SELECT id, action, user_id, repeat_mode FROM sishome_relay_schedules WHERE target_time = $1 AND is_active = TRUE',
      [currentHHMM]
    );

    for (const schedule of result.rows) {
      lastTriggeredBy = schedule.user_id; // Set agar log MQTT tahu ini dari jadwal
      // mqttClient.publish('SiSHome/relay/cmd', action);
      mqttClient.publish('SiSHome/relay/cmd', schedule.action);
      
      // Matikan is_active HANYA JIKA mode-nya 'ONCE'
      if (schedule.repeat_mode === 'ONCE') {
        await pool.query(
          'UPDATE sishome_relay_schedules SET is_active = FALSE WHERE id = $1',
          [schedule.id]
        );
      }
      // Jika 'DAILY', biarkan is_active tetap TRUE agar besok dieksekusi lagi
      
      console.log(`⏰ [Scheduler] Dieksekusi: ${schedule.action} (${schedule.repeat_mode})`);
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