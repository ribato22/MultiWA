// MultiWA Admin - New Profile / QR Scanner
// apps/admin/src/app/dashboard/profiles/new/page.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

export default function NewProfilePage() {
  const router = useRouter();
  const [step, setStep] = useState<'create' | 'scanning'>('create');
  const [name, setName] = useState('');
  const [engineType, setEngineType] = useState('whatsapp-web-js');
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [showEngineCompare, setShowEngineCompare] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const createProfile = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        throw new Error('Not logged in. Please login again.');
      }
      
      // First, fetch accounts to get a valid accountId
      const accountsRes = await fetch('/api/v1/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      let accountId: string | null = null;
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        const accounts = Array.isArray(accountsData) ? accountsData : (accountsData.data || []);
        if (accounts.length > 0) {
          accountId = accounts[0].id;
        }
      }
      
      if (!accountId) {
        throw new Error('No account found. Please contact administrator.');
      }
      
      // Create profile with correct field names for deployed API
      const res = await fetch(`/api/v1/accounts/${accountId}/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: name,
          settings: { engine: engineType },
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error?.message || 'Failed to create profile');
      }

      const result = await res.json();
      const profile = result.data || result;
      setProfileId(profile.id);
      setStep('scanning');
      
      // Start connection with accountId
      await connectProfile(profile.id, accountId);
    } catch (error: any) {
      console.error('Error:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const connectProfile = async (id: string, accountId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      
      // Connect to WebSocket FIRST to ensure we receive QR updates
      connectWebSocket(id);
      
      // Then trigger WhatsApp connection via POST /profiles/:id/connect
      // This calls EngineManager.connectProfile() which generates QR
      const res = await fetch(`/api/v1/profiles/${id}/connect`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to start connection');
      }
      
      console.log('Connection initiated, waiting for QR code via WebSocket...');
    } catch (error) {
      console.error('Connect error:', error);
      setStatus('Error connecting. Please try again.');
    }
  };

  const connectWebSocket = (profileId: string) => {
    // WebSocket must connect directly to API server
    // Next.js rewrites only work for HTTP, not WebSocket
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    let wsUrl = apiUrl.replace(/^http/, 'ws');
    
    if (typeof window !== 'undefined') {
      const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocalDev) {
        // Development: connect directly to API server
        wsUrl = apiUrl.replace(/^http/, 'ws');
      } else {
        // Production: connect via same host (Nginx will proxy to backend)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${window.location.host}`;
      }
    }
    
    console.log('Connecting WebSocket to:', wsUrl);
    setStatus('Connecting to server...');
    
    // Create socket connection to /ws namespace (must match backend EventsGateway namespace)
    // Backend uses: @WebSocketGateway({ namespace: '/ws', ... })
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      timeout: 15000,
      forceNew: true,
    });
    
    socketRef.current = socket;
    
    socket.on('connect', () => {
      console.log('WebSocket connected:', socket.id);
      setStatus('Connected to server. Waiting for QR code...');
      
      // Join the profile room to receive QR updates
      socket.emit('join', { profileId });
    });
    
    socket.on('qr:update', (data: { profileId: string; qrCode: string }) => {
      console.log('QR update received:', data.profileId);
      if (data.qrCode) {
        setQrCode(data.qrCode);
        setStatus('Scan the QR code with your WhatsApp');
      }
    });
    
    socket.on('connection:status', (data: { profileId: string; status: string; phoneNumber?: string }) => {
      console.log('Connection status received:', data);
      if (data.status === 'connected') {
        const phone = data.phoneNumber ? ` (${data.phoneNumber})` : '';
        setStatus(`Connected${phone}! 🎉 Redirecting...`);
        setQrCode(null); // Hide QR code
        socket.disconnect();
        setTimeout(() => router.push('/dashboard/profiles'), 1500);
      } else if (data.status === 'disconnected') {
        setStatus('Disconnected. Please try again.');
      }
    });
    
    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setStatus('Connection error. Retrying...');
    });
    
    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
    });
  };

  // QR code is already a data URL from backend, no need to render

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-6">
        <a href="/dashboard/profiles" className="hover:text-emerald-600">Profiles</a>
        <span>/</span>
        <span className="text-gray-900 dark:text-white">New Profile</span>
      </nav>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        {step === 'create' ? (
          <div className="p-8">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Add New Profile
            </h1>

            <form onSubmit={(e) => { e.preventDefault(); createProfile(); }} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Profile Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  placeholder="e.g. Customer Support"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Engine Type
                </label>
                <div className="grid grid-cols-2 gap-4">
                  {/* WhatsApp Web.js Card */}
                  <button
                    type="button"
                    onClick={() => setEngineType('whatsapp-web-js')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      engineType === 'whatsapp-web-js'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🌐</span>
                      <p className="font-semibold text-gray-900 dark:text-white">WhatsApp Web.js</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">✅ Stable</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">⭐ Recommended</span>
                    </div>
                    <ul className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                      <li>• Battle-tested & production-ready</li>
                      <li>• Full media & group support</li>
                      <li>• Uses Chromium (~200MB RAM)</li>
                    </ul>
                  </button>

                  {/* Baileys Card */}
                  <button
                    type="button"
                    onClick={() => setEngineType('baileys')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      engineType === 'baileys'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">⚡</span>
                      <p className="font-semibold text-gray-900 dark:text-white">Baileys</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">⚡ Fast</span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">🪶 Lightweight</span>
                    </div>
                    <ul className="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5">
                      <li>• No browser needed (~50MB RAM)</li>
                      <li>• Direct WA protocol, faster</li>
                      <li>• Actively developed by community</li>
                    </ul>
                  </button>
                </div>

                {/* Expandable Comparison */}
                <button
                  type="button"
                  onClick={() => setShowEngineCompare(!showEngineCompare)}
                  className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 transition-colors"
                >
                  <span className={`transition-transform ${showEngineCompare ? 'rotate-90' : ''}`}>▶</span>
                  {showEngineCompare ? 'Sembunyikan perbandingan detail' : 'Lihat perbandingan detail'}
                </button>

                {showEngineCompare && (
                  <div className="mt-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800">
                          <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Fitur</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400">Web.js 🌐</th>
                          <th className="px-3 py-2 text-center font-medium text-gray-600 dark:text-gray-400">Baileys ⚡</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {[
                          { feature: 'Stabilitas', webjs: '✅ Sangat stabil', baileys: '⚠️ Aktif dikembangkan' },
                          { feature: 'Kecepatan', webjs: '🔵 Moderate', baileys: '🟢 Cepat' },
                          { feature: 'RAM Usage', webjs: '~200 MB (Chromium)', baileys: '~50 MB' },
                          { feature: 'Media Support', webjs: '✅ Lengkap', baileys: '✅ Lengkap' },
                          { feature: 'Group Chat', webjs: '✅ Full', baileys: '✅ Full' },
                          { feature: 'QR Code Login', webjs: '✅ Via browser', baileys: '✅ Direct protocol' },
                          { feature: 'Multi-Device', webjs: '✅ Supported', baileys: '✅ Supported' },
                          { feature: 'Status/Story', webjs: '✅ Bisa', baileys: '✅ Bisa' },
                          { feature: 'Butuh Chromium', webjs: '⚠️ Ya', baileys: '✅ Tidak' },
                          { feature: 'Cocok untuk', webjs: 'Produksi, reliability', baileys: 'Hemat resource, speed' },
                        ].map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-300">{row.feature}</td>
                            <td className="px-3 py-1.5 text-center text-gray-600 dark:text-gray-400">{row.webjs}</td>
                            <td className="px-3 py-1.5 text-center text-gray-600 dark:text-gray-400">{row.baileys}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!name || loading}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? 'Creating...' : 'Create & Connect'}
              </button>
            </form>
          </div>
        ) : (
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Scan QR Code
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-8">
              Open WhatsApp on your phone &gt; Settings &gt; Linked Devices &gt; Link a Device
            </p>

            <div className="flex justify-center mb-6">
              {qrCode ? (
                <div className="p-4 bg-white rounded-2xl shadow-lg">
                  <img 
                    src={qrCode} 
                    alt="QR Code" 
                    className="w-64 h-64"
                  />
                </div>
              ) : (
                <div className="w-64 h-64 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center">
                  <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full"></div>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400">
              {status}
            </p>

            <button
              onClick={() => router.push('/dashboard/profiles')}
              className="mt-6 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
