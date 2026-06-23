import React, { useState, useEffect } from 'react';
import mqtt from 'mqtt';
import axios from 'axios';
import { Thermometer, Droplets, Power, Activity, Clock, Sun, Moon, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Konfigurasi URL API Backend
const API_URL = 'http://localhost:5000/api'; 

const App = () => {
  // States MQTT & Status
  const [brokerStatus, setBrokerStatus] = useState('Disconnected');
  const [deviceStatus, setDeviceStatus] = useState('Menunggu...');
  const [sensorData, setSensorData] = useState({ temperature: '--', humidity: '--' });
  const [relayState, setRelayState] = useState(false);
  
  // States Database
  const [logs, setLogs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [chartData, setChartData] = useState([]);
  
  // States Form & UI
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState('');
  const [newScheduleAction, setNewScheduleAction] = useState('ON');

  // Profil User Saat Ini
  const userProfile = { id: 1, name: 'Rafi Athallah', initials: 'RA' };

  // --- FUNGSI MENGAMBIL DATA DARI DATABASE ---
  const fetchAllData = async () => {
    try {
      // 1. Ambil Jadwal
      const resSched = await axios.get(`${API_URL}/schedules`);
      setSchedules(resSched.data);

      // 2. Ambil Log Aktivitas Relay
      const resLogs = await axios.get(`${API_URL}/logs`);
      setLogs(resLogs.data);

      // 3. Ambil Data Grafik Sensor
      const resChart = await axios.get(`${API_URL}/chart`);
      setChartData(resChart.data);
    } catch (error) {
      console.error('Gagal mengambil data dari database', error);
    }
  };

  useEffect(() => {
    // Tarik data awal dari Database
    fetchAllData();

    // --- KONEKSI MQTT WEBSOCKETS ---
    const client = mqtt.connect('wss://f5c8801cf6d342bea2c68cbc379544ae.s1.eu.hivemq.cloud:8884/mqtt', {
      clientId: 'SiSHome_Web_' + Math.random().toString(16).substring(2, 8),
      username: 'SiSHome_Dev',
      password: 'Development0',
      clean: true,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      setBrokerStatus('Connected');
      // Subscribe aktual sesuai program ESP32
      client.subscribe('SiSHome/degre');
      client.subscribe('SiSHome/humid');
      client.subscribe('SiSHome/relay');
      client.subscribe('SiSHome/status_dht');
    });

    client.on('message', (topic, message) => {
      const payload = message.toString();
      
      // Pemilahan topik aktual
      if (topic === 'SiSHome/degre') {
        setSensorData(prev => ({ ...prev, temperature: payload }));
      } else if (topic === 'SiSHome/humid') {
        setSensorData(prev => ({ ...prev, humidity: payload }));
      } else if (topic === 'SiSHome/status_dht') {
        setDeviceStatus(payload);
      } else if (topic === 'SiSHome/relay') {
        setRelayState(payload === 'ON');
      }
    });

    client.on('error', (err) => console.error('MQTT Error:', err));
    client.on('close', () => setBrokerStatus('Disconnected'));

    return () => {
      if (client) client.end();
    };
  }, []);

  // --- HANDLER RELAY (POST KE BACKEND) ---
  const toggleRelay = async () => {
    const newAction = relayState ? 'OFF' : 'ON';
    setRelayState(!relayState);
    
    try {
      await axios.post(`${API_URL}/relay`, {
        userId: userProfile.id,
        action: newAction
      });
      fetchAllData();
    } catch (error) {
      alert('Gagal mengirim perintah relay ke server!');
      setRelayState(relayState); 
    }
  };

  // --- HANDLER JADWAL (POST KE BACKEND) ---
  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (!newScheduleTime) return;

    try {
      await axios.post(`${API_URL}/schedules`, {
        userId: userProfile.id,
        targetTime: newScheduleTime,
        action: newScheduleAction
      });
      setNewScheduleTime('');
      fetchAllData(); 
    } catch (error) {
      alert('Gagal menyimpan jadwal ke database!');
    }
  };

  return (
    <div className={`min-h-screen p-4 md:p-6 font-sans transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-sishome-bg text-gray-800'}`}>
      
      {/* Header & User Profile */}
      <div className={`max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center mb-8 p-4 rounded-xl shadow-sm gap-4 transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h1 className={`text-2xl font-bold flex items-center gap-2 ${isDarkMode ? 'text-blue-400' : 'text-sishome-primary'}`}>
          <Activity size={28} /> SiSHome
        </h1>
        
        <div className="flex items-center gap-4 md:gap-6">
          <div className="flex flex-col md:flex-row gap-2 md:gap-4 text-xs md:text-sm font-medium">
            <span className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded-full ${brokerStatus === 'Connected' ? 'bg-sishome-accent' : 'bg-sishome-danger'}`}></span>
              Server: {brokerStatus}
            </span>
            <span className="flex items-center gap-1">
              <Info size={14} className={deviceStatus.includes('Ditemukan') ? 'text-sishome-accent' : 'text-sishome-danger'}/>
              Sensor: {deviceStatus}
            </span>
          </div>

          <div className={`flex items-center gap-3 border-l pl-4 md:pl-6 transition-colors ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`p-2 rounded-full transition-colors ${isDarkMode ? 'bg-gray-700 text-yellow-400 hover:bg-gray-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              title="Toggle Theme"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <div className="text-right hidden sm:block ml-2">
              <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>{userProfile.name}</p>
            </div>
            <div className="w-10 h-10 bg-sishome-primary rounded-full flex items-center justify-center text-white font-bold shadow-md">
              {userProfile.initials}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Data Cards */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
        <div className={`p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center border-t-4 border-orange-400 transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <Thermometer className="text-orange-400 mb-2" size={40} />
          <p className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Suhu Ruangan</p>
          <p className={`text-5xl font-bold mt-2 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{sensorData.temperature}°C</p>
        </div>

        <div className={`p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center border-t-4 border-blue-400 transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <Droplets className="text-blue-400 mb-2" size={40} />
          <p className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Kelembapan</p>
          <p className={`text-5xl font-bold mt-2 ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{sensorData.humidity}%</p>
        </div>

        <div className={`p-6 rounded-2xl shadow-sm flex flex-col items-center justify-center transition-colors duration-300 ${relayState ? 'bg-sishome-primary text-white' : (isDarkMode ? 'bg-gray-800' : 'bg-white')}`}>
          <p className={`font-medium mb-4 ${relayState ? 'text-blue-200' : (isDarkMode ? 'text-gray-300' : 'text-gray-500')}`}>Kontrol Perangkat</p>
          <button 
            onClick={toggleRelay}
            className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-transform transform hover:scale-105 active:scale-95 ${relayState ? 'bg-sishome-accent text-white' : (isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-400')}`}
          >
            <Power size={48} />
          </button>
          <p className="text-xl font-bold mt-4">Status: {relayState ? 'ON' : 'OFF'}</p>
        </div>
      </div>

      {/* Layout Tengah: Grafik & Log Aktivitas */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        
        {/* Grafik */}
        <div className={`p-6 rounded-2xl shadow-sm lg:col-span-2 transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-blue-400' : 'text-sishome-primary'}`}>Tren Sensor (Dari Database)</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#4B5563' : '#E5E7EB'} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#D1D5DB' : '#6B7280', fontSize: 12}} dy={10} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#D1D5DB' : '#6B7280', fontSize: 12}} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#D1D5DB' : '#6B7280', fontSize: 12}} />
                <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', backgroundColor: isDarkMode ? '#1F2937' : '#FFFFFF', color: isDarkMode ? '#F9FAFB' : '#1F2937' }} />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }}/>
                <Line yAxisId="left" type="monotone" dataKey="suhu" name="Suhu (°C)" stroke="#FB923C" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line yAxisId="right" type="monotone" dataKey="kelembapan" name="Kelembapan (%)" stroke="#60A5FA" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Log Section */}
        <div className={`p-6 rounded-2xl shadow-sm transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className={`text-lg font-bold mb-4 border-b pb-2 ${isDarkMode ? 'text-blue-400 border-gray-700' : 'text-sishome-primary border-gray-200'}`}>Aktivitas Relay</h2>
          {logs.length === 0 ? (
            <p className={`italic text-sm text-center mt-10 ${isDarkMode ? 'text-gray-400' : 'text-gray-400'}`}>Belum ada aktivitas di database.</p>
          ) : (
            <ul className="space-y-4">
              {logs.map((log, index) => (
                <li key={index} className={`flex justify-between items-start text-sm p-3 rounded-lg border ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-100'}`}>
                  <div>
                    <span className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-800'}`}>{log.user_name}</span>
                    <p className={`mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Mengubah relay ke <span className={`font-bold ${log.action.includes('ON') ? 'text-sishome-accent' : 'text-sishome-danger'}`}>{log.action}</span></p>
                  </div>
                  <span className={`text-xs text-right ${isDarkMode ? 'text-gray-400' : 'text-gray-400'}`}>{log.time}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Layout Bawah: Penjadwalan Otomatis */}
      <div className="max-w-5xl mx-auto">
        <div className={`p-6 rounded-2xl shadow-sm border transition-colors duration-300 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-100'}`}>
          <div className={`flex items-center gap-2 mb-4 border-b pb-2 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <Clock className={isDarkMode ? 'text-blue-400' : 'text-sishome-primary'} size={24} />
            <h2 className={`text-lg font-bold ${isDarkMode ? 'text-blue-400' : 'text-sishome-primary'}`}>Jadwal Otomatis (Scheduler)</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">
            <div>
              <h3 className={`text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Buat Jadwal Baru</h3>
              <form onSubmit={handleAddSchedule} className="flex gap-2">
                <input 
                  type="time" 
                  value={newScheduleTime}
                  onChange={(e) => setNewScheduleTime(e.target.value)}
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                  required
                />
                <select 
                  value={newScheduleAction}
                  onChange={(e) => setNewScheduleAction(e.target.value)}
                  className={`border rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-blue-400 transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-200 text-gray-800'}`}
                >
                  <option value="ON" className="text-sishome-accent">Turn ON</option>
                  <option value="OFF" className="text-sishome-danger">Turn OFF</option>
                </select>
                <button type="submit" className="bg-sishome-primary text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-800 transition shadow-sm">
                  Simpan
                </button>
              </form>
            </div>

            <div>
              <h3 className={`text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Menunggu Eksekusi</h3>
              {schedules.length === 0 ? (
                <p className={`text-sm italic text-center py-4 rounded-lg ${isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>Tidak ada jadwal aktif.</p>
              ) : (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {schedules.map((sched) => (
                    <li key={sched.id} className={`flex justify-between items-center p-3 rounded-lg border transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-100'}`}>
                      <span className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>{sched.target_time}</span>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${sched.action === 'ON' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        Relay {sched.action}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          
        </div>
      </div>

    </div>
  );
};

export default App;