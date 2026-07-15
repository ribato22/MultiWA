// MultiWA Admin - Webhooks Page
// apps/admin/src/app/dashboard/webhooks/page.tsx

'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Webhook as WebhookIcon,
  Inbox,
  Send,
  CheckCircle2,
  Eye,
  Link2,
  UserPlus,
  Users,
  Activity,
  Pause,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { api, Profile, Webhook } from '@/lib/api';
import { formatDate } from '@/lib/datetime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useI18n } from '@/lib/i18n/provider';

// Available webhook events
type WebhookEvent = { value: string; label: string; Icon: LucideIcon; tone: string };
const WEBHOOK_EVENTS: WebhookEvent[] = [
  { value: 'message.received',  label: 'Message Received',  Icon: Inbox,         tone: 'text-sky-300' },
  { value: 'message.sent',      label: 'Message Sent',      Icon: Send,          tone: 'text-primary' },
  { value: 'message.delivered', label: 'Message Delivered', Icon: CheckCircle2,  tone: 'text-primary' },
  { value: 'message.read',      label: 'Message Read',      Icon: Eye,           tone: 'text-violet-300' },
  { value: 'connection.update', label: 'Connection Update', Icon: Link2,         tone: 'text-amber-300' },
  { value: 'contact.created',   label: 'Contact Created',   Icon: UserPlus,      tone: 'text-rose-300' },
  { value: 'group.update',      label: 'Group Update',      Icon: Users,         tone: 'text-orange-300' },
];

export default function WebhooksPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [webhookToDelete, setWebhookToDelete] = useState<Webhook | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    url: '',
    events: [] as string[],
  });

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadWebhooks();
    }
  }, [selectedProfile]);

  const loadProfiles = async () => {
    const res = await api.getProfiles();
    if (res.data) {
      setProfiles(res.data);
      if (res.data.length > 0) {
        setSelectedProfile(res.data[0].id);
      }
    }
    setLoading(false);
  };

  const loadWebhooks = async () => {
    setLoading(true);
    const res = await api.getWebhooks(selectedProfile);
    if (res.data) {
      setWebhooks(res.data);
    }
    setLoading(false);
  };

  const openCreateModal = () => {
    setEditingWebhook(null);
    setFormData({ url: '', events: [] });
    setShowModal(true);
  };

  const openEditModal = (webhook: Webhook) => {
    setEditingWebhook(webhook);
    setFormData({
      url: webhook.url,
      events: webhook.events || [],
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.url.trim()) {
      toast({ title: 'Please enter a URL', variant: 'destructive' });
      return;
    }

    if (!formData.url.startsWith('http://') && !formData.url.startsWith('https://')) {
      toast({ title: 'URL must start with http:// or https://', variant: 'destructive' });
      return;
    }

    if (formData.events.length === 0) {
      toast({ title: 'Please select at least one event', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (editingWebhook) {
        const res = await api.updateWebhook(editingWebhook.id, {
          url: formData.url,
          events: formData.events,
        });
        if (res.data) {
          toast({ title: 'Webhook updated successfully' });
          loadWebhooks();
        }
      } else {
        const res = await api.createWebhook({
          profileId: selectedProfile,
          url: formData.url,
          events: formData.events,
        });
        if (res.data) {
          toast({ title: 'Webhook created successfully' });
          loadWebhooks();
        }
      }
      setShowModal(false);
    } catch (error) {
      toast({ title: 'Failed to save webhook', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleToggle = async (webhook: Webhook) => {
    const res = await api.updateWebhook(webhook.id, { enabled: !webhook.enabled });
    if (res.data) {
      toast({ title: `Webhook ${res.data.enabled ? 'enabled' : 'disabled'}` });
      loadWebhooks();
    }
  };

  const handleTest = async (webhook: Webhook) => {
    setTesting(webhook.id);
    try {
      const res = await api.testWebhook(webhook.id);
      if (res.data?.success) {
        toast({ title: `Test successful. ${res.data.message || ''}` });
      } else {
        toast({
          title: `Test failed: ${res.data?.message || res.data?.error || res.error || 'Unknown error'}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({ title: 'Test failed: Network error', variant: 'destructive' });
    }
    setTesting(null);
  };

  const confirmDelete = (webhook: Webhook) => {
    setWebhookToDelete(webhook);
    setShowDeleteDialog(true);
  };

  const handleDelete = async () => {
    if (!webhookToDelete) return;
    
    const res = await api.deleteWebhook(webhookToDelete.id);
    if (!res.error) {
      toast({ title: 'Webhook deleted' });
      loadWebhooks();
    } else {
      toast({ title: 'Failed to delete webhook', variant: 'destructive' });
    }
    setShowDeleteDialog(false);
    setWebhookToDelete(null);
  };

  const toggleEvent = (event: string) => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event],
    }));
  };

  const selectAllEvents = () => {
    setFormData(prev => ({
      ...prev,
      events: prev.events.length === WEBHOOK_EVENTS.length 
        ? [] 
        : WEBHOOK_EVENTS.map(e => e.value),
    }));
  };

  // Render loading skeleton
  if (loading && webhooks.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('webhooks.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('webhooks.subtitle')}
          </p>
        </div>
        <Button
          onClick={openCreateModal}
          className="gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Add Webhook
        </Button>
      </div>

      {/* Profile Filter */}
      <div className="flex gap-4">
        <Select value={selectedProfile} onValueChange={setSelectedProfile}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Select profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map(profile => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.displayName || profile.name || 'Unnamed'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
            <WebhookIcon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{webhooks.length}</div>
          <div className="text-sm text-muted-foreground">Total Webhooks</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Activity className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums">
            {webhooks.filter(w => w.enabled).length}
          </div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-muted-foreground/10 text-muted-foreground">
            <Pause className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {webhooks.filter(w => !w.enabled).length}
          </div>
          <div className="text-sm text-muted-foreground">Paused</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
            <Layers className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {new Set(webhooks.flatMap(w => w.events)).size}
          </div>
          <div className="text-sm text-muted-foreground">Event Types</div>
        </div>
      </div>

      {/* Webhooks List */}
      {webhooks.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <WebhookIcon className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Webhooks</h3>
          <p className="text-muted-foreground mb-6">
            Create a webhook to receive real-time event notifications
          </p>
          <Button onClick={openCreateModal} className="gap-2 cursor-pointer">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Your First Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map(webhook => (
            <div
              key={webhook.id}
              className="bg-card rounded-xl border border-border p-5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
            >
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                {/* Left side */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge
                      variant="secondary"
                      className={webhook.enabled
                        ? 'gap-1.5 bg-primary/15 text-primary border border-primary/30'
                        : 'gap-1.5 bg-secondary text-muted-foreground border border-border'}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${webhook.enabled ? 'bg-primary' : 'bg-muted-foreground/60'}`} aria-hidden="true" />
                      {webhook.enabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>

                  <div className="font-mono text-sm text-foreground bg-secondary/40 border border-border/60 rounded-lg px-3 py-2 mb-3 truncate">
                    {webhook.url}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {webhook.events.map(event => {
                      const eventInfo = WEBHOOK_EVENTS.find(e => e.value === event);
                      const EventIcon = eventInfo?.Icon;
                      return (
                        <Badge key={event} variant="outline" className="text-xs gap-1">
                          {EventIcon && <EventIcon className={`w-3 h-3 ${eventInfo?.tone ?? ''}`} aria-hidden="true" />}
                          {eventInfo?.label || event}
                        </Badge>
                      );
                    })}
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground tabular-nums">
                    Created {formatDate(webhook.createdAt)}
                  </div>
                </div>

                {/* Right side - Actions */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Switch
                    checked={webhook.enabled}
                    onCheckedChange={() => handleToggle(webhook)}
                    aria-label="Toggle webhook"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTest(webhook)}
                    disabled={testing === webhook.id}
                    className="cursor-pointer"
                  >
                    {testing === webhook.id ? 'Testing...' : 'Test'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditModal(webhook)} className="cursor-pointer">
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => confirmDelete(webhook)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payload Example */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4">Webhook Payload Example</h3>
        <div className="bg-secondary/30 rounded-lg p-4 font-mono text-sm overflow-x-auto">
          <pre className="text-muted-foreground">
{`{
  "event": "message.received",
  "timestamp": "2026-02-05T12:30:00Z",
  "profileId": "profile-uuid",
  "data": {
    "from": "628123456789",
    "message": {
      "type": "text",
      "content": "Hello World"
    }
  }
}`}
          </pre>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingWebhook ? 'Edit Webhook' : 'Add Webhook'}
            </DialogTitle>
            <DialogDescription>
              Configure a webhook endpoint to receive event notifications
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="webhook-url" className="text-sm font-medium text-foreground">
                Webhook URL <span className="text-destructive" aria-label="required">*</span>
              </label>
              <Input
                id="webhook-url"
                placeholder="https://your-server.com/webhook"
                value={formData.url}
                onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Must be a publicly accessible HTTPS endpoint
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Events</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAllEvents}
                  className="text-xs cursor-pointer"
                >
                  {formData.events.length === WEBHOOK_EVENTS.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>

              <div className="border border-border rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto bg-secondary/30">
                {WEBHOOK_EVENTS.map(event => {
                  const EventIcon = event.Icon;
                  return (
                    <div key={event.value} className="flex items-center gap-2">
                      <Checkbox
                        id={event.value}
                        checked={formData.events.includes(event.value)}
                        onCheckedChange={() => toggleEvent(event.value)}
                      />
                      <label
                        htmlFor={event.value}
                        className="text-sm text-foreground cursor-pointer flex items-center gap-2"
                      >
                        <EventIcon className={`w-3.5 h-3.5 ${event.tone}`} aria-hidden="true" />
                        <span>{event.label}</span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer"
            >
              {saving ? 'Saving...' : editingWebhook ? 'Update Webhook' : 'Add Webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this webhook. 
              You will no longer receive event notifications at this URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer">
              Delete Webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
