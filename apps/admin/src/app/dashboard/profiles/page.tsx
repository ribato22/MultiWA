// MultiWA Admin - Profiles List
// apps/admin/src/app/dashboard/profiles/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
          <Link href="/dashboard/profiles/new">
            <Button className="gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Profile
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Bar */}
      {!loading && profiles.length > 0 && (
        <div className="flex items-center gap-6 py-3 px-4 bg-secondary/30 rounded-xl text-sm">
          <div>
            <span className="font-semibold text-foreground">{profiles.length}</span>
            <span className="text-muted-foreground ml-1">Total profiles</span>
          </div>
          <div>
            <span className="font-semibold text-emerald-600">
              {profiles.filter(p => p.status === 'connected').length}
            </span>
            <span className="text-muted-foreground ml-1">Connected</span>
          </div>
          <div>
            <span className="font-semibold text-gray-500">
              {profiles.filter(p => p.status === 'disconnected').length}
            </span>
            <span className="text-muted-foreground ml-1">Disconnected</span>
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
          <h3 className="font-semibold text-foreground mb-3">💡 Tips</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Keep your phone connected to the internet for stable messaging
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Profiles auto-reconnect when your server restarts
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Use the API to send messages programmatically
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

