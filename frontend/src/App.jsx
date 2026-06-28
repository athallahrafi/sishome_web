import React, { useState, useEffect } from 'react';
import mqtt from 'mqtt';
import axios from 'axios';
import Swal from 'sweetalert2';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { Thermometer, Droplets, Power, Activity, Clock, Sun, Moon, Info, LogOut } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Konfigurasi URL API Backend
// const API_URL = 'http:127.0.0.1:5000/api'; 
const API_URL = 'https://sishome.rafiathallah.space/api'; 
const GOOGLE_CLIENT_ID ='308867522259-d3vnpt26tlv3qpbu8m52e31jmifo11vp.apps.googleusercontent.com'

const App = () => {
  // Current User State
  const [currentUser, setCurrentUser] = useState(null);
  const [brokerStatus, setBrokerStatus] = useState('Disconnected');
  const [deviceStatus, setDeviceStatus] = useState('Menunggu...');
  const [sensorData, setSensorData] = useState({ temperature: '--', humidity: '--' });
  const [relayState, setRelayState] = useState(false);
  const [logs, setLogs] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState('');
  const [newScheduleAction, setNewScheduleAction] = useState('ON');
  const [isRelayLocked, setIsRelayLocked] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isGlobalLocked, setIsGlobalLocked] = useState(false);
  const [newScheduleMode, setNewScheduleMode] = useState('ONCE');
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);

  // Google OAuth Handler
  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const res = await axios.post(`${API_URL}/auth/google`, {
        credential: credentialResponse.credential
      });
      localStorage.setItem('sishome_token', res.data.token);
      localStorage.setItem('sishome_user', JSON.stringify(res.data.userData));
      setCurrentUser(res.data.userData);
      fetchAllData(); 
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Login Gagal',
        text: 'Tidak dapat terhubung ke server SiSHome.',
        confirmButtonColor: '#2563EB'
      });
    }
  };
  const handleAddSchedule = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/schedules`, {
        userId: currentUser.id,
        targetTime: newScheduleTime,
        action: newScheduleAction,
        repeatMode: newScheduleMode
      });
      
      // Reset form
      setNewScheduleTime('');
      setNewScheduleAction('ON');
      setNewScheduleMode('ONCE');
      
      // TUTUP MODAL SETELAH SUKSES
      setIsScheduleModalOpen(false); 
      
      fetchAllData();
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Jadwal ditambahkan', showConfirmButton: false, timer: 1500 });
    } catch (error) {
      console.error('Gagal menambah jadwal', error);
    }
  };
  const handleLogout = () => {
    Swal.fire({
      title: 'Keluar dari SiSHome?',
      text: "Sesi Anda akan diakhiri dan perangkat akan terputus.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#EF4444', // Warna merah untuk tombol keluar
      cancelButtonColor: '#9CA3AF',  // Warna abu-abu untuk batal
      confirmButtonText: 'Ya, Keluar!',
      cancelButtonText: 'Batal'
    }).then((result) => {
      if (result.isConfirmed) {
        // Eksekusi pembersihan data
        localStorage.removeItem('sishome_token');
        localStorage.removeItem('sishome_user');
        setCurrentUser(null);
        setSensorData({ temperature: '--', humidity: '--' });
        setRelayState(false);
        
        // Notifikasi sukses kecil di pojok (Toast)
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Berhasil keluar',
          showConfirmButton: false,
          timer: 2000
        });
      }
    });
  };

  // --- FUNGSI MENGAMBIL DATA DARI DATABASE ---
  const fetchAllData = async () => {
    try {
      const resSched = await axios.get(`${API_URL}/schedules`);
      setSchedules(resSched.data);
      const resLogs = await axios.get(`${API_URL}/logs`);
      setLogs(resLogs.data);
      const resChart = await axios.get(`${API_URL}/chart`);
      setChartData(resChart.data);
      const res = await axios.get(`${API_URL}/relay/status`);
      setRelayState(res.data.status === 'ON');
    } catch (error) {
      console.error('Gagal mengambil data dari database', error);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchValue) {
        console.log('Mengirim API Request untuk mencari:', searchValue);
        // axios.get(`/api/search?q=${searchValue}`)
      }
    }, 1000);
    return () => clearTimeout(delayDebounceFn);
  }, [searchValue]);
  useEffect(() => {
    const savedUser = localStorage.getItem('sishome_user');
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
      fetchAllData();
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return; // Jika belum login, jangan hubungkan MQTT

    const client = mqtt.connect('wss://f5c8801cf6d342bea2c68cbc379544ae.s1.eu.hivemq.cloud:8884/mqtt', {
      clientId: 'SiSHome_Web_' + Math.random().toString(16).substring(2, 8),
      username: 'sishome_RO',
      password: 'ReadOnlyCred123',
      clean: true,
      reconnectPeriod: 5000,
    });

    client.on('connect', () => {
      setBrokerStatus('Connected');
      client.subscribe('SiSHome/degre');
      client.subscribe('SiSHome/humid');
      client.subscribe('SiSHome/relay/status');
      client.subscribe('SiSHome/status_dht');
      client.subscribe('SiSHome/relay/lock');
    });

    client.on('message', (topic, message) => {
      const payload = message.toString();
      if (topic === 'SiSHome/degre') setSensorData(prev => ({ ...prev, temperature: payload }));
      else if (topic === 'SiSHome/humid') setSensorData(prev => ({ ...prev, humidity: payload }));
      else if (topic === 'SiSHome/status_dht') setDeviceStatus(payload);
      else if (topic === 'SiSHome/relay/status') {
        setRelayState(payload === 'ON');
        fetchAllData();
      }
      else if (topic === 'SiSHome/relay/lock') {
        if (payload === 'UNLOCKED') {
           setTimeout(() => setIsGlobalLocked(false), 500);
        } else {
           setIsGlobalLocked(true);
        }
      }
    });

    client.on('error', (err) => console.error('MQTT Error:', err));
    client.on('close', () => setBrokerStatus('Disconnected'));

    return () => {
      if (client) client.end();
    };
  }, [currentUser]);

    // --- HANDLER RELAY (POST KE BACKEND) ---
    const toggleRelay = async () => {
      if (isGlobalLocked) return; // Cegah klik ganda murni
      
      const newAction = relayState ? 'OFF' : 'ON';
      
      try {
        await axios.post(`${API_URL}/relay`, {
          userId: currentUser.id,
          action: newAction
        });
        // Catatan: Jangan gunakan setRelayState(!relayState) di sini lagi!
        // Biarkan MQTT (topic /status) yang mengubah warna tombolnya nanti.
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Perintah Ditolak',
          text: error.response?.data?.error || 'Sistem sedang sibuk!',
          confirmButtonColor: '#2563EB'
        });
      }
    };

    if (!currentUser) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <div className="min-h-screen bg-sishome-bg flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center">
            <Activity className="text-sishome-primary mx-auto mb-4" size={48} />
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Selamat Datang di SiSHome</h1>
            <p className="text-gray-500 mb-8 text-sm">Silakan masuk untuk mengontrol dan memonitor perangkat IoT Anda.</p>
            
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => console.log('Login Gagal')}
                useOneTap
              />
            </div>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }
    

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
              <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>{currentUser.name}</p>
            </div>
            <div className="w-10 h-10 bg-sishome-primary rounded-full flex items-center justify-center text-white font-bold shadow-md overflow-hidden">
              {/* Menampilkan Foto Profil Google jika ada, jika tidak pakai inisial huruf */}
              {currentUser.avatar ? (
                <img src={currentUser.avatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                currentUser.name.substring(0, 2).toUpperCase()
              )}
            </div>
            <button 
              onClick={handleLogout}
              className={`p-2 ml-2 rounded-full transition-colors ${isDarkMode ? 'bg-gray-700 text-red-400 hover:bg-red-500 hover:text-white' : 'bg-red-50 text-red-500 hover:bg-red-500 hover:text-white'}`}
              title="Logout"
            >
              <LogOut size={20} />
            </button>
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
            <Power size={48} className={isGlobalLocked ? 'animate-spin' : ''} />
          </button>
          <p className="text-xl font-bold mt-4">
            {isGlobalLocked ? 'Memproses...' : `Status: ${relayState ? 'ON' : 'OFF'}`}
          </p>
        </div>
      </div>

      {/* Layout Tengah: Grafik & Log Aktivitas */}
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        
        {/* Grafik */}
        <div className={`p-6 rounded-2xl shadow-sm lg:col-span-2 transition-colors duration-300 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className={`text-lg font-bold mb-6 ${isDarkMode ? 'text-blue-400' : 'text-sishome-primary'}`}>Tren Sensor (Dari Database)</h2>
          <div className="h-72 w-full min-h-[300px]">
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
              <button 
                onClick={() => setIsScheduleModalOpen(true)}
                className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition shadow-sm
                  ${isDarkMode 
                    ? 'bg-blue-600 text-white hover:bg-blue-500' 
                    : 'bg-sishome-primary text-white hover:bg-blue-800'
                  }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Buat Jadwal Baru
              </button>
            </div>

            <div>
              <h3 className={`text-sm font-bold mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Menunggu Eksekusi</h3>
              {schedules.length === 0 ? (
                <p className={`text-sm italic text-center py-4 rounded-lg ${isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>Tidak ada jadwal aktif.</p>
              ) : (
                <ul className="space-y-2 max-h-40 overflow-y-auto pr-2">
                  {schedules.map((sched) => (
                    <li key={sched.id} className={`flex justify-between items-center p-3 rounded-lg border transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-100'}`}>
                    <div>
                      <span className={`text-lg font-bold block ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>{sched.target_time}</span>
                      {/* Indikator Mode */}
                      <span className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {sched.repeat_mode === 'DAILY' ? '🔄 Tiap Hari' : '▶️ Sekali Saja'}
                      </span>
                    </div>

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
              {/* ================= MODAL TAMBAH JADWAL ================= */}
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-60 backdrop-blur-sm">
            <div className={`w-full max-w-md p-6 rounded-2xl shadow-2xl transform transition-all ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-800'}`}>
              
              {/* Header Modal */}
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-xl font-bold">Atur Jadwal Otomatis</h3>
                <button 
                  onClick={() => setIsScheduleModalOpen(false)} 
                  className="text-gray-400 hover:text-red-500 transition"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Form Input (Format Vertikal agar rapi) */}
              <form onSubmit={handleAddSchedule} className="flex flex-col gap-4">
                
                {/* Input Waktu */}
                <div>
                  <label className={`block text-sm font-semibold mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Pilih Waktu (WIB)</label>
                  <input 
                    type="time" 
                    value={newScheduleTime}
                    onChange={(e) => setNewScheduleTime(e.target.value)}
                    className={`w-full border rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                    required
                  />
                </div>

                {/* Flex Container untuk Aksi & Mode */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={`block text-sm font-semibold mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Perintah</label>
                    <select 
                      value={newScheduleAction}
                      onChange={(e) => setNewScheduleAction(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-3 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-300'}`}
                    >
                      <option value="ON" className="text-green-600">Nyala (ON)</option>
                      <option value="OFF" className="text-red-600">Mati (OFF)</option>
                    </select>
                  </div>

                  <div className="flex-1">
                    <label className={`block text-sm font-semibold mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Tipe Ulang</label>
                    <select 
                      value={newScheduleMode}
                      onChange={(e) => setNewScheduleMode(e.target.value)}
                      className={`w-full border rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-300'}`}
                    >
                      <option value="ONCE">1x Jalan</option>
                      <option value="DAILY">Tiap Hari</option>
                    </select>
                  </div>
                </div>

                {/* Tombol Aksi */}
                <div className="flex gap-3 mt-4">
                  <button 
                    type="button" 
                    onClick={() => setIsScheduleModalOpen(false)} 
                    className={`flex-1 py-3 rounded-lg font-bold transition-colors ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                  >
                    Batal
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 bg-sishome-primary text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition shadow-md"
                  >
                    Simpan Jadwal
                  </button>
                </div>

              </form>
            </div>
          </div>
        )}
        {/* ================= AKHIR MODAL ================= */}

    </div>
  );
};

export default App;