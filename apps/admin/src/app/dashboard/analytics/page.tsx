// MultiWA Admin - Analytics Page
// apps/admin/src/app/dashboard/analytics/page.tsx

'use client';

import { useState, useEffect, useMemo } from 'react';
import { api, Profile, DashboardStats, Automation } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DateRange = '7d' | '30d' | '90d';

// Simple bar chart component (CSS-only, no external deps)
function BarChart({ data, label, color }: { data: number[]; label: string; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {data.map((val, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div
              className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${(val / max) * 100}%`,
                backgroundColor: color,
                minHeight: val > 0 ? '4px' : '0px',
              }}
              title={`${val}`}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-center text-muted-foreground mt-2">{label}</p>
    </div>
  );
}

// Donut chart component (SVG)
function DonutChart({ segments, size = 120 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200 dark:text-gray-700" />
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dashArray = `${pct * c} ${c}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="10"
              strokeDasharray={dashArray}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="transition-all duration-500"
            />
          );
          offset += pct * c;
          return el;
        })}
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-xl font-bold fill-current text-foreground">
          {total}
        </text>
      </svg>
      <div className="space-y-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-medium text-foreground">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);

  useEffect(() => {
    loadData();
  }, [selectedProfile]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [profilesRes, statsRes] = await Promise.all([
        api.getProfiles(),
        api.getDashboardStats(selectedProfile !== 'all' ? selectedProfile : ''),
      ]);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (statsRes.data) setStats(statsRes.data);

      // Load automations for selected or first profile
      const targetProfileId = selectedProfile !== 'all' 
        ? selectedProfile 
        : (profilesRes.data && profilesRes.data.length > 0 ? profilesRes.data[0].id : null);
      
      if (targetProfileId) {
        const autoRes = await api.getAutomations(targetProfileId);
        if (autoRes.data) setAutomations(autoRes.data);
      }
    } catch (error) {
      console.error('Failed to load analytics data:', error);
    }
    setLoading(false);
  };

  // Real chart data from API
  const [messageChartData, setMessageChartData] = useState<number[]>([]);
  const [contactGrowthData, setContactGrowthData] = useState<number[]>([]);

  useEffect(() => {
    loadChartData();
  }, [dateRange, selectedProfile, profiles]);

  const loadChartData = async () => {
    try {
      // Use the first profile if 'all' is selected (backend requires profileId)
      const profileId = selectedProfile !== 'all' 
        ? selectedProfile 
        : (profiles.length > 0 ? profiles[0].id : null);
      
      if (!profileId) return;

      // Calculate date range
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      // Fetch message trend data
      const trendRes = await api.getMessageTrend(profileId, {
        granularity: 'day',
        startDate,
        endDate,
      });
      if (trendRes.data && Array.isArray(trendRes.data)) {
        setMessageChartData(trendRes.data.map((d: any) => (d.incoming || 0) + (d.outgoing || 0)));
      } else {
        setMessageChartData([]);
      }

      // Fetch contact growth data
      const contactRes = await api.getContactStats(profileId);
      if (contactRes.data?.growth && Array.isArray(contactRes.data.growth)) {
        setContactGrowthData(contactRes.data.growth.map((d: any) => d.count || 0));
      } else {
        setContactGrowthData([contactRes.data?.total || 0]);
      }
    } catch (error) {
      console.error('Failed to load chart data:', error);
    }
  };

  // Automation stats
  const automationStats = useMemo(() => {
    const active = automations.filter(a => a.isActive).length;
    const inactive = automations.length - active;
    const totalTriggers = automations.reduce((sum, a) => sum + (a.stats?.triggerCount || 0), 0);
    return { active, inactive, totalTriggers };
  }, [automations]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground mt-1">Message volume, contacts, and automation insights</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedProfile} onValueChange={setSelectedProfile}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All profiles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Profiles</SelectItem>
              {profiles.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.displayName || p.name || 'Unnamed'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <span className="text-xl">💬</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Messages</p>
              <p className="text-2xl font-bold text-foreground">{(stats?.messages?.total || 0).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            📈 {stats?.messages?.today || 0} today
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <span className="text-xl">👥</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Contacts</p>
              <p className="text-2xl font-bold text-foreground">{(stats?.contacts?.total || 0).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Across {stats?.profiles?.total || 0} profiles
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <span className="text-xl">📢</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Broadcasts Sent</p>
              <p className="text-2xl font-bold text-foreground">{(stats?.broadcasts?.total || 0).toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Campaign messages
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Automations</p>
              <p className="text-2xl font-bold text-foreground">{automations.length}</p>
            </div>
          </div>
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {automationStats.active} active
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message Volume Chart */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-1">Message Volume</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Daily messages over the last {dateRange === '7d' ? '7 days' : dateRange === '30d' ? '30 days' : '90 days'}
          </p>
          <BarChart
            data={messageChartData}
            label={`${messageChartData.reduce((a, b) => a + b, 0).toLocaleString()} total`}
            color="#3b82f6"
          />
        </div>

        {/* Contact Growth Chart */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-1">Contact Growth</h3>
          <p className="text-sm text-muted-foreground mb-4">
            New contacts per day
          </p>
          <BarChart
            data={contactGrowthData}
            label={`${contactGrowthData.reduce((a, b) => a + b, 0).toLocaleString()} new contacts`}
            color="#22c55e"
          />
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Status */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Profile Status</h3>
          <DonutChart
            segments={[
              { label: 'Connected', value: stats?.profiles?.connected || 0, color: '#22c55e' },
              { label: 'Disconnected', value: (stats?.profiles?.total || 0) - (stats?.profiles?.connected || 0), color: '#ef4444' },
            ]}
          />
        </div>

        {/* Automation Performance */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Automation Performance</h3>
          <DonutChart
            segments={[
              { label: 'Active', value: automationStats.active, color: '#22c55e' },
              { label: 'Inactive', value: automationStats.inactive, color: '#94a3b8' },
            ]}
          />
          <div className="mt-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Triggers</span>
              <span className="font-semibold text-foreground">{automationStats.totalTriggers.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Top Automations */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Top Automations</h3>
          {automations.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-4xl">🤖</span>
              <p className="text-sm text-muted-foreground mt-2">No automations yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {automations
                .sort((a, b) => (b.stats?.triggerCount || 0) - (a.stats?.triggerCount || 0))
                .slice(0, 5)
                .map((auto, i) => (
                  <div key={auto.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}.</span>
                      <span className="text-sm text-foreground truncate">{auto.name}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground flex-shrink-0 ml-2">{auto.stats?.triggerCount || 0}×</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
