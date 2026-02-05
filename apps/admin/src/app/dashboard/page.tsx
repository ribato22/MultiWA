// MultiWA Admin - Dashboard Overview
// apps/admin/src/app/dashboard/page.tsx

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import { api, DashboardStats, Profile } from '@/lib/api';
import { StatCard } from '@/components/ui/stat-card';
import { ProfileCard, ProfileGrid } from '@/components/ui/profile-card';
import { Button } from '@/components/ui/button';
import { EmptyProfiles } from '@/components/ui/empty-state';

// Dynamic import for Recharts (client-side only)
const MessageChart = dynamic(() => import('@/components/dashboard/MessageChart'), {
  ssr: false,
  loading: () => <div className="bg-card rounded-2xl border border-border p-6 h-80 animate-pulse" />,
});

// Icons
const Icons = {
  smartphone: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>,
  message: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>,
  users: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  broadcast: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>,
};

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);

        // Fetch stats and profiles in parallel
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

  const [wsConnected, setWsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchDataCb = useCallback(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // Initial data fetch
    fetchDataCb();

    // Connect to Socket.IO for real-time updates
    // Use API URL directly — Next.js rewrites proxy doesn't handle WebSocket
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || apiUrl;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    
    const socket = io(`${wsUrl}/ws`, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Dashboard] WebSocket connected');
      setWsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[Dashboard] WebSocket disconnected');
      setWsConnected(false);
    });

    // Listen for events that should trigger a data refresh
    socket.on('message', () => {
      fetchDataCb();
    });
    socket.on('connection:status', () => {
      fetchDataCb();
    });
    socket.on('event', () => {
      fetchDataCb();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchDataCb]);

  const handleConnect = async (profileId: string) => {
    // Will be implemented with QR code modal
    console.log('Connect profile:', profileId);
  };

  const handleDisconnect = async (profileId: string) => {
    await api.disconnectProfile(profileId);
    fetchData();
  };

  const handleViewProfile = (profileId: string) => {
    window.location.href = `/dashboard/profiles/${profileId}`;
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}! 👋
          </h1>
          <p className="text-muted-foreground mt-1">
            Here's what's happening with your WhatsApp gateway.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${wsConnected ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            {wsConnected ? 'Connected' : 'Reconnecting...'}
          </div>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
          >
            <svg 
              className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Connected Profiles"
          value={stats?.profiles.connected || 0}
          icon={Icons.smartphone}
          trend={{ value: 0 }}
          description={`${stats?.profiles.total || 0} total profiles`}
          loading={loading}
        />
        <StatCard
          title="Messages Today"
          value={stats?.messages.today || 0}
          icon={Icons.message}
          trend={{ value: 0 }}
          description={`${stats?.messages.total || 0} total messages`}
          loading={loading}
        />
        <StatCard
          title="Total Contacts"
          value={stats?.contacts.total || 0}
          icon={Icons.users}
          trend={{ value: 0 }}
          loading={loading}
        />
        <StatCard
          title="Broadcasts"
          value={stats?.broadcasts.total || 0}
          icon={Icons.broadcast}
          trend={{ value: 0 }}
          loading={loading}
        />
      </div>

      {/* Quick Actions */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Add Profile', href: '/dashboard/profiles/new', icon: '➕', description: 'Connect a new device' },
            { name: 'Send Message', href: '/dashboard/messages', icon: '✉️', description: 'Send a quick message' },
            { name: 'Create Broadcast', href: '/dashboard/broadcast', icon: '📣', description: 'Send to many contacts' },
            { name: 'View API Docs', href: '/api/docs', icon: '📚', description: 'Explore the API', external: true },
          ].map((action) => (
            action.external ? (
              <a
                key={action.name}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-accent transition-all duration-200"
              >
                <div className="text-2xl mb-2">{action.icon}</div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                  {action.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.description}
                </p>
              </a>
            ) : (
              <Link
                key={action.name}
                href={action.href}
                className="group p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-accent transition-all duration-200"
              >
                <div className="text-2xl mb-2">{action.icon}</div>
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">
                  {action.name}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {action.description}
                </p>
              </Link>
            )
          ))}
        </div>
      </div>

      {/* Message Activity Chart */}
      <MessageChart />

      {/* Profiles Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Your Profiles
          </h2>
          <Link href="/dashboard/profiles">
            <Button variant="ghost" size="sm">
              View All
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </Link>
        </div>

        {loading ? (
          <ProfileGrid>
            {[1, 2, 3].map((i) => (
              <ProfileCard
                key={i}
                id=""
                name=""
                status="offline"
                loading={true}
              />
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
                status={profile.status === 'connected' ? 'online' : profile.status === 'connecting' ? 'connecting' : 'offline'}
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
      </div>

      {/* Getting Started - Only show if no profiles */}
      {!loading && profiles.length === 0 && (
        <div className="gradient-bg rounded-2xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-2">🚀 Getting Started</h2>
          <p className="text-white/80 mb-4">
            Connect your first WhatsApp device to start sending messages.
          </p>
          <Link
            href="/dashboard/profiles/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-primary rounded-xl font-medium hover:bg-white/90 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Your First Profile
          </Link>
        </div>
      )}
    </div>
  );
}

