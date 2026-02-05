// MultiWA Admin - Enhanced Profile Detail with QR Code & Reconnection
// apps/admin/src/app/dashboard/profiles/[id]/page.tsx

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  dailyMessageLimit?: number;
  dailyMessageCount?: number;
  sessionData?: {
    jid?: string;
    name?: string;
    avatar?: string;
  };
}

export default function ProfileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const accountIdRef = useRef<string | null>(null);

  const profileId = params.id as string;
  const autoConnect = searchParams.get('action') === 'connect';

  // WebSocket connection for real-time updates
  useEffect(() => {
    // Determine WebSocket URL based on environment
    let wsUrl: string;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    if (typeof window !== 'undefined') {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Development: connect directly to API server
        wsUrl = apiUrl.replace(/^http/, 'ws');
      } else {
        // Production: connect via same host (Nginx will proxy to backend)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${wsProtocol}//${window.location.host}`;
      }
    } else {
      wsUrl = apiUrl.replace(/^http/, 'ws');
    }

    // Connect to WebSocket server with /ws namespace (must match backend EventsGateway)
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      timeout: 15000,
      forceNew: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected for profile:', profileId);
      // Join this profile's room to receive QR updates
      socket.emit('join', { profileId });
    });

    // Listen for QR code updates (backend sends { profileId, qrCode })
    socket.on('qr:update', (data: { profileId: string; qrCode: string }) => {
      console.log('QR update received:', data.profileId, data.qrCode?.substring(0, 50));
      if (data.profileId === profileId && data.qrCode) {
        setQrCode(data.qrCode);
        console.log('QR Code set!');
      }
    });

    // Listen for connection status updates
    socket.on('connection:status', (data: { profileId: string; status: string; phone?: string }) => {
      console.log('Connection status update:', data);
      if (data.profileId === profileId) {
        if (data.status === 'connected') {
          setQrCode(null);
          setConnecting(false);
          fetchProfile();
          toast({ title: 'Connected!', description: `Phone: ${data.phone || 'Active'}` });
        } else if (data.status === 'disconnected') {
          setConnecting(false);
          setQrCode(null);
          fetchProfile();
        } else if (data.status === 'error') {
          setConnecting(false);
          setQrCode(null);
          fetchProfile();
          toast({ title: 'Connection failed', description: 'Please try connecting again', variant: 'destructive' });
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, [profileId]);

  // Get account ID helper (cached to avoid repeated requests)
  const getAccountId = async (): Promise<string | null> => {
    if (accountIdRef.current) return accountIdRef.current;
    const token = localStorage.getItem('accessToken');
    const res = await fetch('/api/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accounts = Array.isArray(data) ? data : (data.data || []);
    const id = accounts[0]?.id || null;
    if (id) accountIdRef.current = id;
    return id;
  };

  // Fetch profile
  const fetchProfile = useCallback(async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');

      const res = await fetch(`/api/v1/accounts/${accountId}/profiles/${profileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        const profileData = data.data || data;
        setProfile(profileData);
        
        // If connected, clear QR code
        if (profileData.status?.toLowerCase() === 'connected') {
          setQrCode(null);
          setConnecting(false);
        }
      } else if (res.status === 404) {
        setProfile(null);
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  // Start connection / Get QR Code
  const handleConnect = async () => {
    setConnecting(true);
    setQrCode(null);
    setConnectionAttempts(prev => prev + 1);

    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');

      const res = await fetch(`/api/v1/accounts/${accountId}/profiles/${profileId}/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await res.json();
      console.log('Connect response:', data);

      if (data.qrCode) {
        setQrCode(data.qrCode);
        toast({ title: 'QR Code ready', description: 'Scan with WhatsApp to connect' });
      } else if (data.status === 'connected') {
        toast({ title: 'Already connected!' });
        fetchProfile();
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      toast({ title: 'Connection failed', variant: 'destructive' });
      setConnecting(false);
    }
  };

  // Disconnect profile
  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');

      const res = await fetch(`/api/v1/accounts/${accountId}/profiles/${profileId}/disconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        toast({ title: 'Profile disconnected' });
        fetchProfile();
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
      toast({ title: 'Disconnect failed', variant: 'destructive' });
    } finally {
      setDisconnecting(false);
    }
  };

  // Delete profile
  const handleDelete = async () => {
    setDeleting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');

      const res = await fetch(`/api/v1/accounts/${accountId}/profiles/${profileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        toast({ title: 'Profile deleted' });
        router.push('/dashboard/profiles');
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      toast({ title: 'Delete failed', variant: 'destructive' });
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Auto-connect if action=connect in URL
  useEffect(() => {
    if (autoConnect && profile && profile.status?.toLowerCase() !== 'connected' && !connecting && connectionAttempts === 0) {
      handleConnect();
    }
  }, [autoConnect, profile, connecting, connectionAttempts]);

  // Poll for connection status when QR is displayed (only while connecting, not after connected)
  useEffect(() => {
    if (!connecting) return;
    // Don't poll if already connected
    if (profile?.status?.toLowerCase() === 'connected') return;

    const interval = setInterval(async () => {
      await fetchProfile();
    }, 5000); // Poll every 5 seconds (reduced from 3s)

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      setQrCode(null);
      setConnecting(false);
      toast({ title: 'QR Code expired', description: 'Please try again', variant: 'destructive' });
    }, 120000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [connecting, profile?.status, fetchProfile]);

  // Status badge styling
  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'connected':
        return <Badge className="bg-green-500 hover:bg-green-600">Connected</Badge>;
      case 'connecting':
      case 'qr_ready':
        return <Badge className="bg-yellow-500 hover:bg-yellow-600">Connecting</Badge>;
      default:
        return <Badge variant="secondary">Disconnected</Badge>;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-6 w-32" />
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="w-16 h-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  // Not found
  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="text-6xl mb-4">😕</div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Profile Not Found</h2>
        <p className="text-muted-foreground mb-6">
          The profile you're looking for doesn't exist or has been deleted.
        </p>
        <Link href="/dashboard/profiles">
          <Button className="bg-[#25D366] hover:bg-[#128C7E]">← Back to Profiles</Button>
        </Link>
      </div>
    );
  }

  const isConnected = profile.status?.toLowerCase() === 'connected';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/dashboard/profiles" className="hover:text-foreground transition-colors">Profiles</Link>
        <span>/</span>
        <span className="text-foreground">{profile.displayName || 'Unnamed'}</span>
      </nav>

      {/* Profile Header Card */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-6 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center text-white text-2xl font-bold">
              {(profile.displayName || 'P')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-foreground">{profile.displayName || 'Unnamed Profile'}</h1>
              <p className="text-muted-foreground">{profile.phoneNumber || 'Not connected'}</p>
            </div>
            {getStatusBadge(profile.status)}
          </div>
        </div>

        {/* QR Code Section */}
        {(qrCode || connecting) && !isConnected && (
          <div className="p-6 border-b border-border bg-secondary/10">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">Scan QR Code with WhatsApp</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Open WhatsApp → Settings → Linked Devices → Link a Device
              </p>
              
              {qrCode ? (
                <div className="inline-block p-4 bg-white rounded-2xl shadow-lg">
                  <img 
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code"
                    className="w-64 h-64"
                  />
                </div>
              ) : (
                <div className="inline-flex items-center justify-center w-64 h-64 bg-secondary rounded-2xl">
                  <div className="text-center">
                    <svg className="w-12 h-12 mx-auto animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-sm text-muted-foreground mt-2">Generating QR Code...</p>
                  </div>
                </div>
              )}
              
              <p className="text-xs text-muted-foreground mt-4">
                QR Code will expire in 2 minutes
              </p>

              <Button 
                variant="outline" 
                onClick={handleConnect}
                className="mt-4"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh QR Code
              </Button>
            </div>
          </div>
        )}

        {/* Profile Details */}
        <div className="p-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">Profile Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-secondary/30 rounded-xl p-4">
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-medium text-foreground capitalize">{(profile.status || 'unknown').replace('_', ' ')}</p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-4">
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="font-medium text-foreground">
                {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '-'}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-4">
              <p className="text-xs text-muted-foreground">Messages Today</p>
              <p className="font-medium text-foreground">
                {profile.dailyMessageCount || 0} / {profile.dailyMessageLimit || 1000}
              </p>
            </div>
            <div className="bg-secondary/30 rounded-xl p-4">
              <p className="text-xs text-muted-foreground">Session</p>
              <p className="font-medium text-foreground">
                {profile.sessionData?.name || (isConnected ? 'Active' : 'None')}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 bg-secondary/30 border-t border-border">
          <div className="flex flex-wrap gap-3">
            {isConnected ? (
              <>
                <Link href={`/dashboard/chat?profile=${profileId}`}>
                  <Button className="bg-[#25D366] hover:bg-[#128C7E]">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Open Chat
                  </Button>
                </Link>
                <Button 
                  variant="outline" 
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-yellow-600 border-yellow-600 hover:bg-yellow-50"
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </>
            ) : (
              <Button 
                onClick={handleConnect}
                disabled={connecting}
                className="bg-[#25D366] hover:bg-[#128C7E]"
              >
                {connecting ? (
                  <>
                    <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                    </svg>
                    Connect WhatsApp
                  </>
                )}
              </Button>
            )}
            
            <Button 
              variant="outline" 
              onClick={() => setShowDeleteDialog(true)}
              className="text-red-600 border-red-600 hover:bg-red-50 ml-auto"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Usage Tips */}
      {isConnected && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4 border border-blue-100 dark:border-blue-800">
          <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">💡 Quick Tips</h4>
          <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
            <li>• Use the Chat page to send and receive messages</li>
            <li>• Set up Webhooks to receive message notifications</li>
            <li>• Create Templates for quick message sending</li>
            <li>• Configure Automation for automatic responses</li>
          </ul>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{profile.displayName}" and all associated data including messages and contacts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete Profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
