// MultiWA Admin — Dashboard Overview (Session 2 Tier A redesign)
// Dark OLED tokens, Lucide icons, no emoji glyphs in functional UI.
//
// apps/admin/src/app/dashboard/page.tsx

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import { getSocketUrl } from '@/lib/socket';
import { api, DashboardStats, Profile } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { ProfileCard, ProfileGrid } from '@/components/ui/profile-card';
import { Button } from '@/components/ui/button';
import { EmptyProfiles } from '@/components/ui/empty-state';
import {
  Smartphone,
  MessageCircle,
  Users,
  Megaphone,
  Plus,
  Send,
  BookOpen,
  RefreshCw,
  ArrowRight,
  Rocket,
  Wifi,
  WifiOff,
} from 'lucide-react';

const MessageChart = dynamic(() => import('@/components/dashboard/MessageChart'), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 h-80 animate-pulse" />
  ),
});

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        const [statsRes, profilesRes] = await Promise.all([
          api.getDashboardStats(parsedUser.organizationId),
          api.getProfiles(),
        ]);
        if (statsRes.data) setStats(statsRes.data);
        if (profilesRes.data) setProfiles(profilesRes.data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDataCb = useCallback(() => {
    fetchData();
  }, []);

  useEffect(() => {
    fetchDataCb();

    const wsUrl = getSocketUrl();
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect', () => setWsConnected(true));
    socket.on('disconnect', () => setWsConnected(false));
    socket.on('message', fetchDataCb);
    socket.on('connection:status', fetchDataCb);
    socket.on('event', fetchDataCb);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchDataCb]);

  const handleConnect = async (profileId: string) => {
    window.location.href = `/dashboard/profiles/${profileId}?action=connect`;
  };

  const handleDisconnect = async (profileId: string) => {
    await api.disconnectProfile(profileId);
    fetchData();
  };

  const handleViewProfile = (profileId: string) => {
    window.location.href = `/dashboard/profiles/${profileId}`;
  };

  const firstName = user?.name?.split(' ')[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Here&apos;s what&apos;s happening with your WhatsApp gateway today.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ConnectionPill connected={wsConnected} />
          <button
            type="button"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border border-slate-700 text-slate-200 bg-slate-900/40 hover:bg-slate-800 hover:text-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? 'mw-spin' : ''}`}
              aria-hidden
            />
            Refresh
          </button>
        </div>
      </header>

      {/* Stats grid */}
      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatCard
          title="Connected profiles"
          value={stats?.profiles.connected || 0}
          icon={<Smartphone className="w-5 h-5" />}
          description={`${stats?.profiles.total || 0} total profiles`}
          loading={loading}
        />
        <StatCard
          title="Messages today"
          value={stats?.messages.today || 0}
          icon={<MessageCircle className="w-5 h-5" />}
          description={`${stats?.messages.total || 0} total messages`}
          loading={loading}
        />
        <StatCard
          title="Total contacts"
          value={stats?.contacts.total || 0}
          icon={<Users className="w-5 h-5" />}
          loading={loading}
        />
        <StatCard
          title="Broadcasts"
          value={stats?.broadcasts.total || 0}
          icon={<Megaphone className="w-5 h-5" />}
          loading={loading}
        />
      </section>

      {/* Quick actions */}
      <section
        aria-label="Quick actions"
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-6"
      >
        <h2 className="text-sm font-semibold text-slate-100 mb-4 uppercase tracking-wide">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickAction
            href="/dashboard/profiles/new"
            icon={Plus}
            title="Add profile"
            desc="Connect a new WhatsApp device"
            primary
          />
          <QuickAction
            href="/dashboard/messages"
            icon={Send}
            title="Send message"
            desc="Send a quick test message"
          />
          <QuickAction
            href="/dashboard/broadcast"
            icon={Megaphone}
            title="Create broadcast"
            desc="Bulk message a contact list"
          />
          <QuickAction
            href="/api/docs"
            icon={BookOpen}
            title="API docs"
            desc="Swagger interactive reference"
            external
          />
        </div>
      </section>

      {/* Activity chart */}
      <section aria-label="Message activity">
        <MessageChart />
      </section>

      {/* Profiles row */}
      <section aria-label="Profiles">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-100 uppercase tracking-wide">
            Your profiles
          </h2>
          <Link href="/dashboard/profiles">
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-slate-100 hover:bg-slate-800"
            >
              View all
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </Link>
        </div>

        {loading ? (
          <ProfileGrid>
            {[1, 2, 3].map((i) => (
              <ProfileCard key={i} id="" name="" status="offline" loading />
            ))}
          </ProfileGrid>
        ) : profiles.length > 0 ? (
          <ProfileGrid>
            {profiles.slice(0, 3).map((profile) => (
              <ProfileCard
                key={profile.id}
                id={profile.id}
                name={profile.displayName || profile.name || 'Unnamed'}
                phone={profile.sessionData?.jid?.split('@')[0]}
                avatar={profile.sessionData?.avatar}
                status={
                  profile.status === 'connected'
                    ? 'online'
                    : profile.status === 'connecting'
                    ? 'connecting'
                    : 'offline'
                }
                messageCount={profile.messageCount || 0}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onView={handleViewProfile}
              />
            ))}
          </ProfileGrid>
        ) : (
          <EmptyProfiles />
        )}
      </section>

      {/* Getting started card — only when no profiles */}
      {!loading && profiles.length === 0 && (
        <section
          aria-label="Getting started"
          className="rounded-xl border p-6"
          style={{
            background:
              'linear-gradient(135deg, rgb(34 197 94 / 0.12) 0%, rgb(34 197 94 / 0.04) 60%, transparent 100%)',
            borderColor: 'rgb(34 197 94 / 0.3)',
          }}
        >
          <div className="flex items-start gap-4">
            <div
              className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: 'rgb(34 197 94 / 0.18)' }}
            >
              <Rocket className="w-5 h-5" style={{ color: '#22C55E' }} />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-slate-100">
                Get started in 60 seconds
              </h3>
              <p className="text-sm text-slate-300 mt-1">
                Connect your first WhatsApp device. Scan a QR code, then start sending
                messages via REST API, the dashboard chat, or webhooks.
              </p>
              <Link href="/dashboard/profiles/new">
                <Button className="mt-4 bg-[#22C55E] text-[#0F172A] hover:bg-[#16A34A] font-medium">
                  <Plus className="w-4 h-4 mr-2" />
                  Add your first profile
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  // Matches the Refresh button geometry (h-8, rounded-full, text-xs) so the
  // status row reads as a single coherent toolbar.
  if (connected) {
    return (
      <span
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border"
        style={{
          background: 'rgb(34 197 94 / 0.15)',
          color: 'rgb(74 222 128)',
          borderColor: 'rgb(34 197 94 / 0.35)',
        }}
      >
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 rounded-full bg-current"
          style={{ animation: 'mw-spin 2s ease-in-out infinite' }}
        />
        <Wifi className="w-3.5 h-3.5" />
        Live
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-medium border"
      style={{
        background: 'rgb(239 68 68 / 0.15)',
        color: 'rgb(248 113 113)',
        borderColor: 'rgb(239 68 68 / 0.35)',
      }}
    >
      <WifiOff className="w-3.5 h-3.5" />
      Reconnecting…
    </span>
  );
}

function QuickAction({
  href,
  icon: Icon,
  title,
  desc,
  primary = false,
  external = false,
}: {
  href: string;
  icon: typeof Plus;
  title: string;
  desc: string;
  primary?: boolean;
  external?: boolean;
}) {
  const inner = (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
        style={{
          background: primary ? 'rgb(34 197 94 / 0.18)' : 'rgb(51 65 85 / 0.5)',
          color: primary ? '#22C55E' : 'rgb(203 213 225)',
        }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-100 group-hover:text-white transition-colors">
          {title}
        </p>
        <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{desc}</p>
      </div>
    </div>
  );
  const cls =
    'group p-4 rounded-xl border border-slate-800 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-800/50 transition-colors cursor-pointer';
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}