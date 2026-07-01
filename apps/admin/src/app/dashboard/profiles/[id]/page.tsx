// MultiWA Admin — Profile Detail (Session 2 Tier A redesign)
// Dark OLED design system, Lucide icons, accessible QR flow with step
// indicator, server-side phone-mismatch surfaced as an inline alert.
//
// Tokens reference: design-system/multiwa-admin/MASTER.md
// Per-page rules: design-system/multiwa-admin/pages/profile-detail.md
//
// apps/admin/src/app/dashboard/profiles/[id]/page.tsx

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { getSocketUrl } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatFull } from '@/lib/datetime';
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
import {
  ArrowLeft,
  ShieldCheck,
  ScanLine,
  Wifi,
  MessageCircle,
  PlugZap,
  RefreshCw,
  Power,
  Trash2,
  AlertTriangle,
  Smartphone,
  Activity,
  Clock,
  Inbox,
  WifiOff,
  Loader2,
  Gauge,
  Save,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Profile {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageDelayMs?: number;
  dailyMessageLimit?: number | null;
  dailyMessageCount?: number;
  sessionData?: {
    jid?: string;
    name?: string;
    avatar?: string;
  };
}

type WireStatus = 'connected' | 'disconnected' | 'connecting' | 'error' | 'qr_ready' | string;

const fmtPhone = (raw: string | null | undefined): string => {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  // Group: 2 + 3-4 + 4 + remainder
  if (digits.length <= 4) return digits;
  if (digits.length <= 8) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `+${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6, 10)} ${digits.slice(10)}`.trim();
};

const ChipDot = ({ color }: { color: string }) => (
  <span
    aria-hidden
    className="inline-block w-1.5 h-1.5 rounded-full"
    style={{ background: color }}
  />
);

function StatusBadge({ status }: { status: WireStatus }) {
  const s = (status || '').toLowerCase();
  let label = 'Disconnected';
  let bg = 'rgb(100 116 139 / 0.18)'; // slate-500/18
  let fg = 'rgb(148 163 184)'; // slate-400
  let border = 'rgb(100 116 139 / 0.35)';
  let pulse = false;

  if (s === 'connected') {
    label = 'Connected';
    bg = 'rgb(34 197 94 / 0.15)'; // green-500/15
    fg = 'rgb(74 222 128)'; // green-400
    border = 'rgb(34 197 94 / 0.35)';
  } else if (s === 'connecting' || s === 'qr_ready') {
    label = 'Connecting';
    bg = 'rgb(245 158 11 / 0.15)';
    fg = 'rgb(251 191 36)';
    border = 'rgb(245 158 11 / 0.35)';
    pulse = true;
  } else if (s === 'error') {
    label = 'Error';
    bg = 'rgb(239 68 68 / 0.15)';
    fg = 'rgb(248 113 113)';
    border = 'rgb(239 68 68 / 0.35)';
  }

  return (
    <span
      role="status"
      aria-label={`Profile status: ${label}`}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
      style={{ background: bg, color: fg, borderColor: border }}
    >
      <span
        aria-hidden
        className={pulse ? 'inline-block w-1.5 h-1.5 rounded-full' : 'inline-block w-1.5 h-1.5 rounded-full'}
        style={{
          background: fg,
          animation: pulse ? 'mw-spin 2s ease-in-out infinite' : undefined,
        }}
      />
      {label}
    </span>
  );
}

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Authenticate', Icon: ShieldCheck },
    { n: 2, label: 'Scan QR', Icon: ScanLine },
    { n: 3, label: 'Online', Icon: Wifi },
  ];
  return (
    <ol className="flex items-center justify-center gap-2 text-xs">
      {steps.map(({ n, label, Icon }, i) => {
        const isActive = step === n;
        const isDone = step > n;
        const active = isActive || isDone;
        return (
          <li key={n} className="flex items-center gap-2">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors"
              style={{
                background: active ? 'rgb(34 197 94 / 0.12)' : 'rgb(51 65 85 / 0.4)',
                borderColor: active ? 'rgb(34 197 94 / 0.4)' : 'rgb(51 65 85)',
                color: active ? 'rgb(74 222 128)' : 'rgb(148 163 184)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="font-medium">
                {n}. {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="block w-6 h-px"
                style={{ background: step > n ? 'rgb(34 197 94 / 0.5)' : 'rgb(51 65 85)' }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
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
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const accountIdRef = useRef<string | null>(null);

  // Sending-guardrail form state (delay + daily limit), prefilled from the profile.
  const [delayMs, setDelayMs] = useState<number>(1500);
  const [dailyLimit, setDailyLimit] = useState<string>(''); // '' means unlimited
  const [savingGuardrails, setSavingGuardrails] = useState(false);

  const profileId = params.id as string;
  const autoConnect = searchParams.get('action') === 'connect';

  // WebSocket connection for real-time updates
  useEffect(() => {
    const wsUrl = getSocketUrl();
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      auth: (cb) => cb({ token: typeof window !== 'undefined' ? localStorage.getItem('accessToken') : undefined }),
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 15000,
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { profileId });
    });

    socket.on('qr:update', (data: { profileId: string; qrCode: string }) => {
      if (data.profileId === profileId && data.qrCode) {
        setQrCode(data.qrCode);
        setErrorReason(null);
      }
    });

    socket.on(
      'connection:status',
      (data: {
        profileId: string;
        status: string;
        phone?: string;
        phoneNumber?: string;
        reason?: string;
      }) => {
        if (data.profileId !== profileId) return;
        if (data.status === 'connected') {
          setQrCode(null);
          setConnecting(false);
          setErrorReason(null);
          fetchProfile();
          toast({
            title: 'Connected',
            description: `Linked to ${fmtPhone(data.phone || data.phoneNumber)}`,
          });
        } else if (data.status === 'disconnected') {
          setConnecting(false);
          setQrCode(null);
          fetchProfile();
        } else if (data.status === 'error') {
          setConnecting(false);
          setQrCode(null);
          setErrorReason(data.reason || 'Connection failed. Please try again.');
          fetchProfile();
          toast({
            title: 'Connection rejected',
            description: data.reason || 'Please try connecting again',
            variant: 'destructive',
          });
        }
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [profileId]);

  const getAccountId = async (): Promise<string | null> => {
    if (accountIdRef.current) return accountIdRef.current;
    const token = localStorage.getItem('accessToken');
    const res = await fetch('/api/v1/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accounts = Array.isArray(data) ? data : data.data || [];
    const id = accounts[0]?.id || null;
    if (id) accountIdRef.current = id;
    return id;
  };

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
        if (profileData.status?.toLowerCase() === 'connected') {
          setQrCode(null);
          setConnecting(false);
          setErrorReason(null);
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

  const handleConnect = async () => {
    setConnecting(true);
    setQrCode(null);
    setErrorReason(null);
    setConnectionAttempts((prev) => prev + 1);

    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');

      const res = await fetch(`/api/v1/accounts/${accountId}/profiles/${profileId}/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.qrCode) {
        setQrCode(data.qrCode);
        toast({ title: 'QR Code ready', description: 'Scan with WhatsApp to link' });
      } else if (data.status === 'connected') {
        toast({ title: 'Already connected' });
        fetchProfile();
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      toast({ title: 'Connection failed', variant: 'destructive' });
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const token = localStorage.getItem('accessToken');
      const accountId = await getAccountId();
      if (!accountId) throw new Error('No account found');
      const res = await fetch(
        `/api/v1/accounts/${accountId}/profiles/${profileId}/disconnect`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
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

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Prefill the guardrail form once the profile loads. Keyed on id so refetches
  // during the QR flow don't clobber in-progress edits.
  useEffect(() => {
    if (!profile) return;
    setDelayMs(profile.messageDelayMs ?? 1500);
    setDailyLimit(
      profile.dailyMessageLimit != null ? String(profile.dailyMessageLimit) : '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const handleSaveGuardrails = async () => {
    const trimmed = dailyLimit.trim();
    const parsedLimit = trimmed === '' ? null : Math.floor(Number(trimmed));
    if (parsedLimit != null && (!Number.isFinite(parsedLimit) || parsedLimit < 0)) {
      toast({
        title: 'Invalid daily limit',
        description: 'Enter a whole number, or leave empty for unlimited.',
        variant: 'destructive',
      });
      return;
    }
    setSavingGuardrails(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/v1/profiles/${profileId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messageDelayMs: delayMs, dailyMessageLimit: parsedLimit }),
      });
      if (res.ok) {
        toast({ title: 'Guardrails saved', description: 'Sending limits updated.' });
        fetchProfile();
      } else {
        toast({ title: 'Save failed', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Failed to save guardrails:', error);
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSavingGuardrails(false);
    }
  };

  // Auto-connect via ?action=connect URL flag
  useEffect(() => {
    if (
      autoConnect &&
      profile &&
      profile.status?.toLowerCase() !== 'connected' &&
      !connecting &&
      connectionAttempts === 0
    ) {
      handleConnect();
    }
  }, [autoConnect, profile, connecting, connectionAttempts]);

  // Poll profile while waiting for QR scan (WebSocket primary, polling fallback)
  useEffect(() => {
    if (!connecting) return;
    if (profile?.status?.toLowerCase() === 'connected') return;
    const interval = setInterval(() => {
      fetchProfile();
    }, 5000);
    const timeout = setTimeout(() => {
      setQrCode(null);
      setConnecting(false);
      toast({
        title: 'QR Code expired',
        description: 'Please refresh and try again',
        variant: 'destructive',
      });
    }, 120000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [connecting, profile?.status, fetchProfile]);

  // ───────────────────── render ─────────────────────

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-40" />
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 space-y-4">
          <div className="flex items-center gap-4">
            <Skeleton className="w-16 h-16 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  // Not found state (Lucide icon, design-system tokens)
  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-6"
          style={{ background: 'rgb(51 65 85 / 0.5)' }}
        >
          <Inbox className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-semibold text-slate-100 mb-2">Profile not found</h2>
        <p className="text-sm text-slate-400 mb-6">
          The profile you&apos;re looking for doesn&apos;t exist or has been deleted.
        </p>
        <Link href="/dashboard/profiles">
          <Button className="bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A] font-medium">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to profiles
          </Button>
        </Link>
      </div>
    );
  }

  const status = (profile.status || '').toLowerCase();
  const isConnected = status === 'connected';
  const isConnecting = connecting && !isConnected;
  const flowStep: 1 | 2 | 3 = isConnected ? 3 : qrCode ? 2 : 1;

  // Guardrail form: derived "unlimited" flag + dirty check (disables Save when unchanged).
  const unlimited = dailyLimit.trim() === '';
  const normalizedFormLimit = unlimited ? null : Math.floor(Number(dailyLimit));
  const guardrailsDirty =
    delayMs !== (profile.messageDelayMs ?? 1500) ||
    (Number.isNaN(normalizedFormLimit as number)
      ? true
      : normalizedFormLimit !== (profile.dailyMessageLimit ?? null));

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 text-sm text-slate-400"
      >
        <Link
          href="/dashboard/profiles"
          className="flex items-center gap-1.5 hover:text-slate-100 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Profiles
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-100 font-medium">
          {profile.displayName || 'Unnamed'}
        </span>
      </nav>

      {/* Hero card */}
      <section
        aria-label="Profile summary"
        className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden"
      >
        <div className="p-6 flex items-start gap-4">
          <div
            aria-hidden
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-semibold shrink-0"
            style={{
              background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
              color: '#0F172A',
            }}
          >
            {(profile.displayName || 'P')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-slate-100 truncate">
              {profile.displayName || 'Unnamed profile'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Smartphone className="w-3.5 h-3.5 text-slate-500" />
              <span
                className="text-sm text-slate-300 tracking-tight"
                style={{ fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, "Fira Code", Menlo, monospace)' }}
              >
                {fmtPhone(profile.phoneNumber)}
              </span>
            </div>
          </div>
          <StatusBadge status={profile.status} />
        </div>

        {/* Step indicator (visible when not yet connected) */}
        {!isConnected && (
          <div className="px-6 pb-5">
            <StepIndicator step={flowStep} />
          </div>
        )}

        {/* Phone mismatch alert */}
        {errorReason && (
          <div
            role="alert"
            className="mx-6 mb-5 rounded-xl border p-4 flex items-start gap-3"
            style={{
              background: 'rgb(239 68 68 / 0.08)',
              borderColor: 'rgb(239 68 68 / 0.35)',
            }}
          >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'rgb(248 113 113)' }} />
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'rgb(252 165 165)' }}>
                Wrong WhatsApp account scanned
              </p>
              <p className="text-sm mt-1" style={{ color: 'rgb(254 202 202)' }}>
                {errorReason}
              </p>
              <p className="text-xs mt-2" style={{ color: 'rgb(252 165 165 / 0.8)' }}>
                Disconnect this device on your phone (WhatsApp → Settings → Linked Devices)
                and scan again with the correct number.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setErrorReason(null)}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: 'rgb(239 68 68 / 0.2)',
                color: 'rgb(252 165 165)',
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* QR section (visible when connecting or QR ready, and not connected) */}
        {(qrCode || isConnecting) && !isConnected && (
          <div className="px-6 pb-6">
            <div
              className="rounded-xl border border-slate-800 bg-slate-950/40 p-6"
              aria-busy={isConnecting && !qrCode}
              aria-live="polite"
            >
              <div className="text-center">
                <h2 className="text-base font-semibold text-slate-100">
                  Scan QR with WhatsApp
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  WhatsApp on phone → Settings → Linked Devices → Link a Device
                </p>

                <div className="mt-5 inline-flex items-center justify-center">
                  {qrCode ? (
                    <div className="p-4 bg-white rounded-xl shadow-lg">
                      <img
                        src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                        alt="WhatsApp QR code"
                        className="w-64 h-64"
                      />
                    </div>
                  ) : (
                    <div
                      className="flex items-center justify-center w-64 h-64 rounded-xl border border-slate-800"
                      style={{ background: 'rgb(15 23 42 / 0.6)' }}
                    >
                      <div className="text-center" role="status" aria-label="Generating QR code">
                        <Loader2 className="w-12 h-12 mx-auto text-primary mw-spin" aria-hidden="true" />
                        <p className="text-xs text-slate-400 mt-3">Generating QR code…</p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          First boot can take up to 30 seconds
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 mt-4 flex items-center justify-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  QR expires in about 2 minutes
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleConnect}
                  className="mt-4 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-slate-100"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-2" />
                  Refresh QR
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Detail metrics */}
      <section
        aria-label="Profile details"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <DetailCell icon={Activity} label="Status">
          <span className="capitalize">{(profile.status || 'unknown').replace('_', ' ')}</span>
        </DetailCell>
        <DetailCell icon={Clock} label="Created">
          {profile.createdAt ? (
            <span title={formatFull(profile.createdAt)}>{formatDateTime(profile.createdAt)}</span>
          ) : (
            '—'
          )}
        </DetailCell>
        <DetailCell icon={MessageCircle} label="Messages today">
          <span className="font-mono">
            {profile.dailyMessageCount || 0} / {profile.dailyMessageLimit || 1000}
          </span>
        </DetailCell>
        <DetailCell icon={Wifi} label="Session">
          {profile.sessionData?.name || (isConnected ? 'Active' : 'None')}
        </DetailCell>
      </section>

      {/* Sending guardrails */}
      <section
        aria-label="Sending guardrails"
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-100">Sending guardrails</h2>
        </div>
        <p className="text-xs text-slate-400 max-w-2xl">
          Pace outbound messages and cap daily volume to lower the risk of WhatsApp
          rate-locks (error 463). The send gate applies these per message; a recently
          rate-locked number should stay conservative.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
          <div className="space-y-1.5">
            <Label htmlFor="delay" className="text-xs text-slate-300">
              Inter-message delay
            </Label>
            <Select value={String(delayMs)} onValueChange={(v) => setDelayMs(Number(v))}>
              <SelectTrigger
                id="delay"
                className="bg-slate-950/40 border-slate-800 text-slate-100"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1500">1.5 seconds</SelectItem>
                <SelectItem value="3000">3 seconds</SelectItem>
                <SelectItem value="6000">6 seconds</SelectItem>
                <SelectItem value="10000">10 seconds</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500">Minimum gap enforced between two sends.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="limit" className="text-xs text-slate-300">
              Daily message limit
            </Label>
            <Input
              id="limit"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Unlimited"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={unlimited}
              className="bg-slate-950/40 border-slate-800 text-slate-100 disabled:opacity-50"
            />
            <div className="flex items-center gap-2 pt-0.5">
              <Switch
                id="unlimited"
                checked={unlimited}
                onCheckedChange={(on) =>
                  setDailyLimit(on ? '' : String(profile.dailyMessageLimit ?? 1000))
                }
              />
              <Label htmlFor="unlimited" className="text-[11px] text-slate-500 cursor-pointer">
                Unlimited (not recommended)
              </Label>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-slate-500">
            Sent today:{' '}
            <span className="font-mono text-slate-300">{profile.dailyMessageCount || 0}</span>
            {!unlimited && (
              <>
                {' / '}
                <span className="font-mono text-slate-300">{dailyLimit}</span>
              </>
            )}
          </p>
          <Button
            onClick={handleSaveGuardrails}
            disabled={savingGuardrails || !guardrailsDirty}
            className="bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A] font-medium disabled:opacity-50"
          >
            {savingGuardrails ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 mw-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save guardrails
              </>
            )}
          </Button>
        </div>
      </section>

      {/* Actions bar */}
      <section
        aria-label="Profile actions"
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 flex flex-wrap items-center gap-3"
      >
        {isConnected ? (
          <>
            <Link href={`/dashboard/chat?profile=${profileId}`}>
              <Button className="bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A] font-medium">
                <MessageCircle className="w-4 h-4 mr-2" />
                Open Chat
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="border-slate-700 text-slate-200 hover:bg-slate-800"
            >
              {disconnecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 mw-spin" aria-hidden="true" />
                  Disconnecting…
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 mr-2" />
                  Disconnect
                </>
              )}
            </Button>
          </>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A] font-medium"
          >
            {connecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 mw-spin" aria-hidden="true" />
                Connecting…
              </>
            ) : (
              <>
                <PlugZap className="w-4 h-4 mr-2" />
                Connect WhatsApp
              </>
            )}
          </Button>
        )}

        <Button
          variant="outline"
          onClick={() => setShowDeleteDialog(true)}
          className="ml-auto border-red-500/40 text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete profile
        </Button>
      </section>

      {/* Quick tips (only when connected) */}
      {isConnected && (
        <section
          aria-label="Quick tips"
          className="rounded-xl border p-4"
          style={{
            background: 'rgb(14 165 233 / 0.06)',
            borderColor: 'rgb(14 165 233 / 0.25)',
          }}
        >
          <h3
            className="text-sm font-semibold mb-2 flex items-center gap-2"
            style={{ color: 'rgb(125 211 252)' }}
          >
            <Activity className="w-4 h-4" />
            What you can do next
          </h3>
          <ul className="text-sm space-y-1.5" style={{ color: 'rgb(186 230 253)' }}>
            <li>• Use the Chat page to send and receive messages</li>
            <li>• Set up Webhooks to receive real-time message events</li>
            <li>• Create Templates for repeated message patterns</li>
            <li>• Configure Automation for AI-powered replies</li>
          </ul>
        </section>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-slate-900 border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-100">Delete this profile?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              This will permanently delete{' '}
              <strong className="text-slate-200">{profile.displayName || 'this profile'}</strong>{' '}
              along with all associated messages and contacts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting…' : 'Delete profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailCell({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Activity;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-sm font-medium text-slate-100">{children}</div>
    </div>
  );
}