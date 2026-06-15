// MultiWA Admin - Audit Logs Page
// apps/admin/src/app/dashboard/audit/page.tsx

'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Lock,
  LogOut,
  Link2,
  Unplug,
  Send,
  Inbox,
  Search,
  Download,
  ClipboardList,
  ActivitySquare,
  CheckSquare,
  Edit3,
  XSquare,
  type LucideIcon,
} from 'lucide-react';
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

// Action categories with theme tokens + Lucide icons
type ActionInfo = { label: string; className: string; Icon: LucideIcon };
const ACTION_TYPES: Record<string, ActionInfo> = {
  create:     { label: 'Created',      className: 'bg-primary/15 text-primary border border-primary/30',         Icon: Plus },
  update:     { label: 'Updated',      className: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',         Icon: Pencil },
  delete:     { label: 'Deleted',      className: 'bg-destructive/15 text-destructive border border-destructive/30', Icon: Trash2 },
  login:      { label: 'Login',        className: 'bg-violet-500/15 text-violet-300 border border-violet-500/30', Icon: Lock },
  logout:     { label: 'Logout',       className: 'bg-secondary text-muted-foreground border border-border',     Icon: LogOut },
  connect:    { label: 'Connected',    className: 'bg-primary/15 text-primary border border-primary/30',         Icon: Link2 },
  disconnect: { label: 'Disconnected', className: 'bg-orange-500/15 text-orange-300 border border-orange-500/30', Icon: Unplug },
  send:       { label: 'Sent',         className: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',         Icon: Send },
  receive:    { label: 'Received',     className: 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30', Icon: Inbox },
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

  const getActionInfo = (action: string): ActionInfo => {
    return ACTION_TYPES[action] || {
      label: action,
      className: 'bg-secondary text-muted-foreground border border-border',
      Icon: ClipboardList,
    };
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
        <Button variant="outline" className="gap-2 cursor-pointer">
          <Download className="w-4 h-4" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search by user, action, or resource..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
            aria-label="Search audit logs"
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
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
            <ActivitySquare className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{logs.length}</div>
          <div className="text-sm text-muted-foreground">Total Events</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <CheckSquare className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums">
            {logs.filter(l => l.action === 'create').length}
          </div>
          <div className="text-sm text-muted-foreground">Created</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
            <Edit3 className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-sky-300 tabular-nums">
            {logs.filter(l => l.action === 'update').length}
          </div>
          <div className="text-sm text-muted-foreground">Updated</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <XSquare className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-destructive tabular-nums">
            {logs.filter(l => l.action === 'delete').length}
          </div>
          <div className="text-sm text-muted-foreground">Deleted</div>
        </div>
      </div>

      {/* Logs Table */}
      {filteredLogs.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/60 text-muted-foreground">
            <ClipboardList className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Audit Logs</h3>
          <p className="text-muted-foreground">
            No activity recorded for the selected filters
          </p>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-card rounded-xl border border-border overflow-hidden">
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
                const ActionIcon = actionInfo.Icon;
                return (
                  <TableRow key={log.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
                      {formatTime(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{log.userName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`gap-1.5 ${actionInfo.className}`}>
                        <ActionIcon className="w-3 h-3" aria-hidden="true" />
                        {actionInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize text-foreground">{log.resource}</span>
                      {log.resourceId && (
                        <span className="text-xs text-muted-foreground ml-1 font-mono">
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
                      {log.ipAddress || <span className="text-muted-foreground/60">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {filteredLogs.map(log => {
            const actionInfo = getActionInfo(log.action);
            const ActionIcon = actionInfo.Icon;
            return (
              <div key={log.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className={`gap-1.5 ${actionInfo.className}`}>
                    <ActionIcon className="w-3 h-3" aria-hidden="true" />
                    {actionInfo.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatTime(log.createdAt)}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{log.userName}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {log.resource}
                    {log.resourceId && (
                      <span className="ml-1 font-mono">({log.resourceId.slice(0, 8)}...)</span>
                    )}
                  </div>
                </div>
                {log.details && (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {Object.entries(log.details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                  </div>
                )}
                {log.ipAddress && (
                  <div className="text-xs text-muted-foreground font-mono">{log.ipAddress}</div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Pagination placeholder */}
      {filteredLogs.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground tabular-nums">
            Showing {filteredLogs.length} of {logs.length} events
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled className="cursor-pointer">
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled className="cursor-pointer">
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}