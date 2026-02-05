// MultiWA Admin - Audit Logs Page
// apps/admin/src/app/dashboard/audit/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Audit log types
interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

// Action categories with colors
const ACTION_TYPES: Record<string, { label: string; color: string; icon: string }> = {
  'create': { label: 'Created', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: '➕' },
  'update': { label: 'Updated', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: '✏️' },
  'delete': { label: 'Deleted', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: '🗑️' },
  'login': { label: 'Login', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400', icon: '🔐' },
  'logout': { label: 'Logout', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400', icon: '🚪' },
  'connect': { label: 'Connected', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: '🔗' },
  'disconnect': { label: 'Disconnected', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', icon: '🔌' },
  'send': { label: 'Sent', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: '📤' },
  'receive': { label: 'Received', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400', icon: '📥' },
};

// Resource types
const RESOURCES = [
  { value: 'all', label: 'All Resources' },
  { value: 'profile', label: 'Profiles' },
  { value: 'message', label: 'Messages' },
  { value: 'contact', label: 'Contacts' },
  { value: 'template', label: 'Templates' },
  { value: 'automation', label: 'Automation' },
  { value: 'webhook', label: 'Webhooks' },
  { value: 'api_key', label: 'API Keys' },
  { value: 'user', label: 'Users' },
];

export default function AuditPage() {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('7d');

  useEffect(() => {
    loadAuditLogs();
  }, [resourceFilter, dateFilter]);

  const loadAuditLogs = async () => {
    setLoading(true);
    try {
      // Calculate date range from dateFilter
      const now = new Date();
      let startDate: string | undefined;
      if (dateFilter === '24h') startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      else if (dateFilter === '7d') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      else if (dateFilter === '30d') startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      else if (dateFilter === '90d') startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

      const res = await api.getAuditLogs({
        resourceType: resourceFilter !== 'all' ? resourceFilter : undefined,
        startDate,
        limit: 100,
      });

      if (res.data) {
        // API may return { logs: [...], total: N } or just an array
        const logsArray = Array.isArray(res.data) ? res.data : (res.data.logs || res.data.data || []);
        setLogs(logsArray.map((log: any) => ({
          id: log.id,
          userId: log.userId || '',
          userName: log.userName || log.user?.name || 'System',
          action: log.action?.split('.').pop() || log.action || 'unknown',
          resource: log.resourceType || log.action?.split('.')[0] || 'system',
          resourceId: log.resourceId,
          details: log.details || log.metadata,
          ipAddress: log.ipAddress || log.ip,
          userAgent: log.userAgent,
          createdAt: log.timestamp || log.createdAt,
        })));
      } else {
        setLogs([]);
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      setLogs([]);
    }
    setLoading(false);
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getActionInfo = (action: string) => {
    return ACTION_TYPES[action] || { label: action, color: 'bg-gray-100 text-gray-800', icon: '📋' };
  };

  // Filter logs by search
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Render loading skeleton
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
          <p className="text-muted-foreground mt-1">
            Track all actions and changes in your organization
          </p>
        </div>
        <Button variant="outline">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            placeholder="Search by user, action, or resource..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={resourceFilter} onValueChange={setResourceFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Resource" />
          </SelectTrigger>
          <SelectContent>
            {RESOURCES.map(r => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-full sm:w-32">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Last 24h</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{logs.length}</div>
          <div className="text-sm text-muted-foreground">Total Events</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-green-600">
            {logs.filter(l => l.action === 'create').length}
          </div>
          <div className="text-sm text-muted-foreground">Created</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-blue-600">
            {logs.filter(l => l.action === 'update').length}
          </div>
          <div className="text-sm text-muted-foreground">Updated</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-red-600">
            {logs.filter(l => l.action === 'delete').length}
          </div>
          <div className="text-sm text-muted-foreground">Deleted</div>
        </div>
      </div>

      {/* Logs Table */}
      {filteredLogs.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Audit Logs</h3>
          <p className="text-muted-foreground">
            No activity recorded for the selected filters
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>IP Address</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map(log => {
                const actionInfo = getActionInfo(log.action);
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {formatTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{log.userName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`${actionInfo.color}`}>
                        {actionInfo.icon} {actionInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize text-foreground">{log.resource}</span>
                      {log.resourceId && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({log.resourceId.slice(0, 8)}...)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      {log.details && (
                        <span className="text-sm text-muted-foreground truncate block">
                          {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">
                      {log.ipAddress || '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination placeholder */}
      {filteredLogs.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {filteredLogs.length} of {logs.length} events
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
