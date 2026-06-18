// MultiWA Admin - Profiles List
// apps/admin/src/app/dashboard/profiles/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Lightbulb, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { api, Profile } from '@/lib/api';
import { ProfileCard, ProfileGrid } from '@/components/ui/profile-card';
import { Button } from '@/components/ui/button';
import { EmptyProfiles } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfiles = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    
    try {
      const res = await api.getProfiles();
      if (res.data) {
        // Handle both nested response {data: [...]} and direct array [...]
        const profilesArray = Array.isArray(res.data) ? res.data : [];
        setProfiles(profilesArray);
      } else {
        console.error('Failed to fetch profiles:', res.error);
        setProfiles([]);
      }
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
      setProfiles([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchProfiles(), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = (profileId: string) => {
    window.location.href = `/dashboard/profiles/${profileId}?action=connect`;
  };

  const handleDisconnect = async (profileId: string) => {
    await api.disconnectProfile(profileId);
    fetchProfiles();
  };

  const handleView = (profileId: string) => {
    window.location.href = `/dashboard/profiles/${profileId}`;
  };

  // Loading skeletons
  const LoadingGrid = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="bg-card rounded-2xl p-6 border border-border">
          <div className="flex items-start gap-4">
            <Skeleton className="w-14 h-14 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
            <Skeleton className="h-9 flex-1 rounded-lg" />
            <Skeleton className="h-9 w-9 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Profiles
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your WhatsApp devices and connections
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchProfiles(true)}
            disabled={refreshing}
            aria-label="Refresh profile list"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${refreshing ? 'mw-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Link href="/dashboard/profiles/new">
            <Button className="gap-2">
              <Plus className="w-5 h-5" aria-hidden="true" />
              Add Profile
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && profiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 px-4 bg-secondary/40 border border-border/60 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold text-foreground tabular-nums">{profiles.length}</span>
            <span className="text-muted-foreground">Total</span>
          </div>
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="font-semibold text-primary tabular-nums">
              {profiles.filter(p => p.status === 'connected').length}
            </span>
            <span className="text-muted-foreground">Connected</span>
          </div>
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold text-muted-foreground tabular-nums">
              {profiles.filter(p => p.status === 'disconnected').length}
            </span>
            <span className="text-muted-foreground">Disconnected</span>
          </div>
        </div>
      )}

      {/* Profiles Grid */}
      {loading ? (
        <LoadingGrid />
      ) : profiles.length === 0 ? (
        <EmptyProfiles />
      ) : (
        <ProfileGrid>
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              id={profile.id}
              name={profile.displayName || profile.name || 'Unnamed Profile'}
              phone={profile.sessionData?.jid?.split('@')[0] || profile.phone}
              avatar={profile.sessionData?.avatar}
              status={
                profile.status === 'connected' ? 'online' : 
                profile.status === 'connecting' ? 'connecting' : 'offline'
              }
              messageCount={profile.messageCount || 0}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onView={handleView}
            />
          ))}
        </ProfileGrid>
      )}

      {/* Quick Tips */}
      {!loading && profiles.length > 0 && (
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h3 className="flex items-center gap-2 font-semibold text-foreground mb-3">
            <Lightbulb className="w-4 h-4 text-primary" aria-hidden="true" />
            Tips
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Keep your phone connected to the internet for stable messaging
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Profiles auto-reconnect when your server restarts
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Use the API to send messages programmatically
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

