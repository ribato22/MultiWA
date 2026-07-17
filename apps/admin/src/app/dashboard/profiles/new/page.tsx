// MultiWA Admin - New Profile / QR Scanner
// apps/admin/src/app/dashboard/profiles/new/page.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  ChevronRight,
  Globe,
  Zap,
  Loader2,
  CheckCircle2,
  Sparkles,
  X,
} from 'lucide-react';
import { getSocketUrl } from '@/lib/socket';

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
    const wsUrl = getSocketUrl();
    
    console.log('Connecting WebSocket to:', wsUrl);
    setStatus('Connecting to server...');
    
    // Create socket connection to /ws namespace (must match backend EventsGateway namespace)
    // Backend uses: @WebSocketGateway({ namespace: '/ws', ... })
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') : undefined }),
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
        setStatus(`Connected${phone}. Redirecting...`);
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
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6" aria-label="Breadcrumb">
        <a href="/dashboard/profiles" className="hover:text-primary transition-colors">Profiles</a>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" aria-hidden="true" />
        <span className="text-foreground">New Profile</span>
      </nav>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        {step === 'create' ? (
          <div className="p-8">
            <h1 className="text-2xl font-bold text-foreground mb-1">
              Add New Profile
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              Pilih engine dan scan QR untuk menghubungkan device WhatsApp.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); createProfile(); }} className="space-y-6">
              <div>
                <label htmlFor="profile-name" className="block text-sm font-medium text-foreground mb-2">
                  Profile Name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-border bg-secondary/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/60 transition-colors"
                  placeholder="e.g. Customer Support"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-foreground mb-2">
                  Engine Type
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="radiogroup" aria-label="Engine type">
                  {/* WhatsApp Web.js Card */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={engineType === 'whatsapp-web-js'}
                    onClick={() => setEngineType('whatsapp-web-js')}
                    className={`p-4 rounded-xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                      engineType === 'whatsapp-web-js'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                        : 'border-border bg-secondary/30 hover:border-border/80 hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="w-4 h-4 text-primary" aria-hidden="true" />
                      <p className="font-semibold text-foreground">WhatsApp Web.js</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-primary/15 text-primary">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Stable
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/15 text-sky-400">
                        <Sparkles className="w-3 h-3" aria-hidden="true" /> Recommended
                      </span>
                    </div>
                    <ul className="text-[11px] text-muted-foreground space-y-0.5">
                      <li>• Battle-tested & production-ready</li>
                      <li>• Full media & group support</li>
                      <li>• Uses Chromium (~200MB RAM)</li>
                    </ul>
                  </button>

                  {/* Baileys Card */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={engineType === 'baileys'}
                    onClick={() => setEngineType('baileys')}
                    className={`p-4 rounded-xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                      engineType === 'baileys'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                        : 'border-border bg-secondary/30 hover:border-border/80 hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-amber-400" aria-hidden="true" />
                      <p className="font-semibold text-foreground">Baileys</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/15 text-orange-400">
                        Experimental
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-400">
                        <Zap className="w-3 h-3" aria-hidden="true" /> Fast
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 text-violet-400">
                        <Sparkles className="w-3 h-3" aria-hidden="true" /> Lightweight
                      </span>
                    </div>
                    <ul className="text-[11px] text-muted-foreground space-y-0.5">
                      <li>• No browser needed (~50MB RAM)</li>
                      <li>• Direct WA protocol, faster</li>
                      <li>• Experimental — reactions/contacts limited</li>
                    </ul>
                  </button>
                </div>

                {/* Expandable Comparison */}
                <button
                  type="button"
                  onClick={() => setShowEngineCompare(!showEngineCompare)}
                  aria-expanded={showEngineCompare}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors cursor-pointer"
                >
                  <ChevronRight
                    className={`w-3.5 h-3.5 transition-transform ${showEngineCompare ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  {showEngineCompare ? 'Sembunyikan perbandingan detail' : 'Lihat perbandingan detail'}
                </button>

                {showEngineCompare && (
                  <div className="mt-3 rounded-xl border border-border overflow-hidden text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-secondary/40">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fitur</th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Globe className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> Web.js
                            </span>
                          </th>
                          <th className="px-3 py-2 text-center font-medium text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" /> Baileys
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {[
                          { feature: 'Stabilitas', webjs: 'Sangat stabil', baileys: 'Aktif dikembangkan' },
                          { feature: 'Kecepatan', webjs: 'Moderate', baileys: 'Cepat' },
                          { feature: 'RAM Usage', webjs: '~200 MB (Chromium)', baileys: '~50 MB' },
                          { feature: 'Media Support', webjs: 'Lengkap', baileys: 'Lengkap' },
                          { feature: 'Group Chat', webjs: 'Full', baileys: 'Full' },
                          { feature: 'QR Code Login', webjs: 'Via browser', baileys: 'Direct protocol' },
                          { feature: 'Multi-Device', webjs: 'Supported', baileys: 'Supported' },
                          { feature: 'Status/Story', webjs: 'Bisa', baileys: 'Bisa' },
                          { feature: 'Butuh Chromium', webjs: 'Ya', baileys: 'Tidak' },
                          { feature: 'Cocok untuk', webjs: 'Produksi, reliability', baileys: 'Hemat resource, speed' },
                        ].map((row, i) => (
                          <tr key={i} className="hover:bg-secondary/30 transition-colors">
                            <td className="px-3 py-1.5 font-medium text-foreground">{row.feature}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{row.webjs}</td>
                            <td className="px-3 py-1.5 text-center text-muted-foreground">{row.baileys}</td>
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
                className="w-full py-3.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                    Creating...
                  </span>
                ) : (
                  'Create & Connect'
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Scan QR Code
            </h1>
            <p className="text-muted-foreground mb-8">
              Buka WhatsApp di HP &gt; Settings &gt; Linked Devices &gt; Link a Device
            </p>

            <div className="flex justify-center mb-6">
              {qrCode ? (
                <div
                  className="p-4 bg-white rounded-2xl shadow-lg shadow-black/40 ring-1 ring-border"
                  role="img"
                  aria-label="WhatsApp QR code"
                >
                  <img
                    src={qrCode}
                    alt="QR Code"
                    className="w-64 h-64"
                  />
                </div>
              ) : (
                <div
                  className="w-64 h-64 bg-secondary/40 border border-border rounded-2xl flex items-center justify-center"
                  role="status"
                  aria-busy="true"
                  aria-label="Generating QR code"
                >
                  <Loader2 className="w-8 h-8 text-primary mw-spin" aria-hidden="true" />
                </div>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              {status}
            </p>

            <button
              type="button"
              onClick={() => router.push('/dashboard/profiles')}
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
