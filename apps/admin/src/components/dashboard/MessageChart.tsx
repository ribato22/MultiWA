// MultiWA Admin - Message Analytics Chart (Real Data)
// apps/admin/src/components/dashboard/MessageChart.tsx

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';

interface ChartDataPoint {
  date: string;
  sent: number;
  received: number;
}

interface MessageChartProps {
  profileId?: string;
  className?: string;
}

export default function MessageChart({ profileId, className }: MessageChartProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Get all profiles if no specific profileId
        let targetProfileId = profileId;
        if (!targetProfileId) {
          const profilesRes = await api.getProfiles();
          if (profilesRes.data && profilesRes.data.length > 0) {
            targetProfileId = profilesRes.data[0].id;
          }
        }

        if (!targetProfileId) {
          // No profiles — show empty state
          setChartData(generateEmptyWeek());
          return;
        }

        // Fetch 7-day trend from statistics API
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 6);

        const res = await api.request<Array<{ period: string; incoming: number; outgoing: number }>>(
          `/statistics/messages/trend?profileId=${targetProfileId}&granularity=day&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
        );

        if (res.data && res.data.length > 0) {
          const mapped = res.data.map((item) => {
            const d = new Date(item.period);
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            return {
              date: dayName,
              sent: item.outgoing || 0,
              received: item.incoming || 0,
            };
          });
          setChartData(mapped);
        } else {
          // No messages data — show empty week
          setChartData(generateEmptyWeek());
        }
      } catch (err: any) {
        console.warn('Failed to load message trend:', err.message);
        setError(err.message);
        setChartData(generateEmptyWeek());
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [profileId]);

  return (
    <div className={`bg-card rounded-2xl border border-border p-6 ${className || ''}`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-semibold text-foreground">Message Activity</h3>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading...' : error ? 'Using cached data' : 'Last 7 days'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#25D366]" />
            <span className="text-muted-foreground">Sent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#128C7E]" />
            <span className="text-muted-foreground">Received</span>
          </div>
        </div>
      </div>

      <div className="h-64" style={{ minHeight: '256px', minWidth: 0 }}>
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground">Loading chart data...</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#25D366" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#128C7E" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#128C7E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                width={40}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area
                type="monotone"
                dataKey="sent"
                stroke="#25D366"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSent)"
              />
              <Area
                type="monotone"
                dataKey="received"
                stroke="#128C7E"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorReceived)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// Generate an empty 7-day week for fallback
function generateEmptyWeek(): ChartDataPoint[] {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: d.toLocaleDateString('en-US', { weekday: 'short' }),
      sent: 0,
      received: 0,
    });
  }
  return days;
}
