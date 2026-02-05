// MultiWA Admin - Webhooks Page
// apps/admin/src/app/dashboard/webhooks/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api, Profile, Webhook } from '@/lib/api';
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

// Available webhook events
const WEBHOOK_EVENTS = [
  { value: 'message.received', label: 'Message Received', icon: '📥' },
  { value: 'message.sent', label: 'Message Sent', icon: '📤' },
  { value: 'message.delivered', label: 'Message Delivered', icon: '✅' },
  { value: 'message.read', label: 'Message Read', icon: '👁️' },
  { value: 'connection.update', label: 'Connection Update', icon: '🔗' },
  { value: 'contact.created', label: 'Contact Created', icon: '👤' },
  { value: 'group.update', label: 'Group Update', icon: '👥' },
];

export default function WebhooksPage() {
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
        toast({ title: `✅ Test successful! ${res.data.message || ''}` });
      } else {
        toast({ 
          title: `❌ Test failed: ${res.data?.message || res.data?.error || res.error || 'Unknown error'}`, 
          variant: 'destructive' 
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
          <h1 className="text-2xl font-bold text-foreground">Webhooks</h1>
          <p className="text-muted-foreground mt-1">
            Receive real-time notifications for events
          </p>
        </div>
        <Button 
          onClick={openCreateModal} 
          className="bg-[#25D366] hover:bg-[#128C7E]"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
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
          <div className="text-2xl font-bold text-foreground">{webhooks.length}</div>
          <div className="text-sm text-muted-foreground">Total Webhooks</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-green-600">
            {webhooks.filter(w => w.enabled).length}
          </div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {webhooks.filter(w => !w.enabled).length}
          </div>
          <div className="text-sm text-muted-foreground">Paused</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {new Set(webhooks.flatMap(w => w.events)).size}
          </div>
          <div className="text-sm text-muted-foreground">Event Types</div>
        </div>
      </div>

      {/* Webhooks List */}
      {webhooks.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="text-6xl mb-4">🌐</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Webhooks</h3>
          <p className="text-muted-foreground mb-6">
            Create a webhook to receive real-time event notifications
          </p>
          <Button 
            onClick={openCreateModal} 
            className="bg-[#25D366] hover:bg-[#128C7E]"
          >
            Create Your First Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map(webhook => (
            <div
              key={webhook.id}
              className="bg-card rounded-xl border border-border p-5 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left side */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={webhook.enabled ? 'default' : 'secondary'} className={webhook.enabled ? 'bg-green-500' : ''}>
                      {webhook.enabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                  
                  <div className="font-mono text-sm text-foreground bg-secondary/30 rounded-lg px-3 py-2 mb-3 truncate">
                    {webhook.url}
                  </div>
                  
                  <div className="flex flex-wrap gap-1">
                    {webhook.events.map(event => {
                      const eventInfo = WEBHOOK_EVENTS.find(e => e.value === event);
                      return (
                        <Badge key={event} variant="outline" className="text-xs">
                          {eventInfo?.icon} {eventInfo?.label || event}
                        </Badge>
                      );
                    })}
                  </div>
                  
                  <div className="mt-3 text-xs text-muted-foreground">
                    Created {new Date(webhook.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {/* Right side - Actions */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={webhook.enabled}
                    onCheckedChange={() => handleToggle(webhook)}
                  />
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleTest(webhook)}
                    disabled={testing === webhook.id}
                  >
                    {testing === webhook.id ? 'Testing...' : 'Test'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditModal(webhook)}>
                    Edit
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => confirmDelete(webhook)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
              <label className="text-sm font-medium text-foreground">
                Webhook URL <span className="text-red-500">*</span>
              </label>
              <Input
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
                <label className="text-sm font-medium text-foreground">Events</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAllEvents}
                  className="text-xs"
                >
                  {formData.events.length === WEBHOOK_EVENTS.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              
              <div className="border border-border rounded-lg p-3 space-y-2 max-h-64 overflow-y-auto">
                {WEBHOOK_EVENTS.map(event => (
                  <div key={event.value} className="flex items-center gap-2">
                    <Checkbox
                      id={event.value}
                      checked={formData.events.includes(event.value)}
                      onCheckedChange={() => toggleEvent(event.value)}
                    />
                    <label htmlFor={event.value} className="text-sm text-foreground cursor-pointer flex items-center gap-2">
                      <span>{event.icon}</span>
                      <span>{event.label}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="bg-[#25D366] hover:bg-[#128C7E]"
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete Webhook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
