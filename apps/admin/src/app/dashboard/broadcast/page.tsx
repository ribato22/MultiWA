// MultiWA Admin - Broadcast Management
// apps/admin/src/app/dashboard/broadcast/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api, Contact, Profile } from '@/lib/api';
import TemplatePicker from '@/components/templates/TemplatePicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Broadcast {
  id: string;
  profileId: string;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
  message?: any;
  recipients?: any;
  stats?: any;
  recipientCount?: number;
  sentCount?: number;
  failedCount?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  scheduledAt?: string;
}

interface GroupItem {
  id: string;
  name: string;
  jid?: string;
  participantCount?: number;
}

type RecipientTab = 'manual' | 'contacts' | 'groups';
type MessageType = 'text' | 'image' | 'video' | 'audio' | 'document';

const MESSAGE_TYPES: { value: MessageType; label: string; icon: string }[] = [
  { value: 'text', label: 'Text', icon: '💬' },
  { value: 'image', label: 'Image', icon: '🖼️' },
  { value: 'video', label: 'Video', icon: '🎥' },
  { value: 'audio', label: 'Audio', icon: '🎵' },
  { value: 'document', label: 'Document', icon: '📄' },
];

export default function BroadcastPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  
  // New broadcast form
  const [newBroadcast, setNewBroadcast] = useState({
    name: '',
    profileId: '',
    message: '',
    recipients: '',
  });

  // Media support
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Contact & Group picker
  const [recipientTab, setRecipientTab] = useState<RecipientTab>('manual');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(false);

  // Template picker
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const handleTemplateSelect = (template: any, processedContent: string) => {
    setNewBroadcast(prev => ({ ...prev, message: processedContent }));
    setMessageType('text');
    setShowTemplatePicker(false);
    toast({ title: `✅ Template "${template.name}" applied` });
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch contacts/groups when profile changes
  useEffect(() => {
    if (newBroadcast.profileId) {
      fetchContactsAndGroups(newBroadcast.profileId);
    }
  }, [newBroadcast.profileId]);

  const fetchData = async () => {
    try {
      const profilesRes = await api.getProfiles();
      if (profilesRes.data) {
        const allProfiles = Array.isArray(profilesRes.data) ? profilesRes.data : [];
        setProfiles(allProfiles);
        if (allProfiles.length > 0) {
          setNewBroadcast(prev => ({ ...prev, profileId: allProfiles[0].id }));
          // Fetch broadcasts for the first connected profile
          try {
            const token = localStorage.getItem('accessToken');
            const broadcastRes = await fetch(`/api/v1/broadcast?profileId=${allProfiles[0].id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (broadcastRes.ok) {
              const broadcastData = await broadcastRes.json();
              const bList = Array.isArray(broadcastData) ? broadcastData : (broadcastData.data || []);
              setBroadcasts(bList);
            }
          } catch {
            // Broadcasts loading failed, keep empty
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchContactsAndGroups = async (profileId: string) => {
    setLoadingRecipients(true);
    const token = localStorage.getItem('accessToken');
    try {
      // Fetch contacts
      const contactsRes = await fetch(`/api/v1/contacts?profileId=${profileId}&limit=1000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (contactsRes.ok) {
        const data = await contactsRes.json();
        const contactsList = Array.isArray(data) ? data : (data.contacts || data.data || []);
        setContacts(contactsList);
      }

      // Fetch groups
      const groupsRes = await fetch(`/api/v1/groups/profile/${profileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (groupsRes.ok) {
        const data = await groupsRes.json();
        const groupsList = Array.isArray(data) ? data : (data.groups || data.data || []);
        setGroups(groupsList);
      }
    } catch (error) {
      console.error('Failed to fetch contacts/groups:', error);
    } finally {
      setLoadingRecipients(false);
    }
  };

  const toggleContact = (contact: Contact) => {
    const jid = contact.phone ? (contact.phone.replace(/\D/g, '') + '@s.whatsapp.net') : contact.id;
    setSelectedContacts(prev => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const toggleGroup = (group: GroupItem) => {
    const jid = group.jid || group.id;
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const selectAllContacts = () => {
    const filtered = filteredContacts;
    const allSelected = filtered.every(c => {
      const jid = c.phone ? (c.phone.replace(/\D/g, '') + '@s.whatsapp.net') : c.id;
      return selectedContacts.has(jid);
    });
    if (allSelected) {
      setSelectedContacts(new Set());
    } else {
      const all = new Set(filtered.map(c => c.phone ? (c.phone.replace(/\D/g, '') + '@s.whatsapp.net') : c.id));
      setSelectedContacts(all);
    }
  };

  const selectAllGroups = () => {
    const filtered = filteredGroups;
    const allSelected = filtered.every(g => selectedGroups.has(g.jid || g.id));
    if (allSelected) {
      setSelectedGroups(new Set());
    } else {
      const all = new Set(filtered.map(g => g.jid || g.id));
      setSelectedGroups(all);
    }
  };

  const getTotalRecipientCount = () => {
    let count = 0;
    if (recipientTab === 'manual') {
      count = newBroadcast.recipients.split('\n').filter(r => r.trim()).length;
    } else {
      count = selectedContacts.size + selectedGroups.size;
    }
    return count;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaFile(file);
    // Generate preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setMediaPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setMediaPreview(null);
    }
  };

  const clearMedia = () => {
    setMediaFile(null);
    setMediaPreview(null);
  };

  const handleCreateBroadcast = async () => {
    if (!newBroadcast.name || !newBroadcast.profileId) {
      toast({ title: 'Please fill all required fields', variant: 'destructive' });
      return;
    }

    if (messageType === 'text' && !newBroadcast.message) {
      toast({ title: 'Please enter a message', variant: 'destructive' });
      return;
    }

    if (messageType !== 'text' && !mediaFile) {
      toast({ title: 'Please select a media file', variant: 'destructive' });
      return;
    }

    // Build recipients list
    let recipients: string[] = [];
    if (recipientTab === 'manual') {
      if (!newBroadcast.recipients.trim()) {
        toast({ title: 'Please add recipients', variant: 'destructive' });
        return;
      }
      recipients = newBroadcast.recipients
        .split('\n')
        .map(r => r.trim())
        .filter(r => r.length > 0)
        .map(r => {
          let formatted = r.replace(/\s+/g, '').replace(/-/g, '');
          if (!formatted.includes('@')) {
            formatted = formatted.replace(/^0/, '62') + '@s.whatsapp.net';
          }
          return formatted;
        });
    } else {
      recipients = [...selectedContacts, ...selectedGroups];
    }

    if (recipients.length === 0) {
      toast({ title: 'Please select at least one recipient', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      const token = localStorage.getItem('accessToken');

      // Check if profile is connected before sending
      try {
        const profileRes = await fetch(`/api/v1/profiles/${newBroadcast.profileId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.status !== 'connected') {
            toast({ 
              title: '❌ WhatsApp not connected', 
              description: `Profile is ${profileData.status}. Please connect WhatsApp first from the Profiles page.`,
              variant: 'destructive' 
            });
            setSending(false);
            return;
          }
        }
      } catch { /* continue if check fails */ }

      let mediaUrl = '';
      let mimeType = '';
      let filename = '';

      // Upload media file first if needed (before creating broadcast record)
      if (messageType !== 'text' && mediaFile) {
        setUploadProgress('Uploading media...');

        const uploadRes = await api.uploadMedia(mediaFile);

        if (uploadRes.error || !uploadRes.data) {
          toast({ title: `Failed to upload media file: ${uploadRes.error || 'Unknown error'}`, variant: 'destructive' });
          setSending(false);
          setUploadProgress(null);
          return;
        }

        mediaUrl = uploadRes.data.url;
        mimeType = uploadRes.data.mimeType || mediaFile.type;
        filename = uploadRes.data.filename || mediaFile.name;
        setUploadProgress(null);
      }

      // Build complete message object with media URL
      const messageData: any = {
        type: messageType,
        text: newBroadcast.message || '',
      };
      if (mediaUrl) {
        messageData.url = mediaUrl;
        messageData.mimetype = mimeType;
        messageData.filename = filename;
      }

      // Create broadcast record in DB with complete message data
      let broadcastId: string | null = null;
      try {
        const createRes = await fetch('/api/v1/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            profileId: newBroadcast.profileId,
            name: newBroadcast.name,
            message: messageData,
            recipients: {
              type: 'contacts',
              value: recipients,
            },
          }),
        });
        if (createRes.ok) {
          const created = await createRes.json();
          broadcastId = created.id;
        }
      } catch {
        // Broadcast record creation failed, continue sending anyway
      }

      // Set broadcast to 'running' status before sending loop
      if (broadcastId) {
        try {
          await fetch(`/api/v1/broadcast/${broadcastId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              status: 'running',
              stats: {
                total: recipients.length,
                pending: recipients.length,
                sent: 0, delivered: 0, read: 0, failed: 0,
              },
            }),
          });
        } catch { /* ignore */ }
      }

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        setUploadProgress(`Sending ${i + 1}/${recipients.length}...`);
        try {
          let endpoint = '/api/v1/messages/text';
          let payload: any = {
            profileId: newBroadcast.profileId,
            to: recipient,
          };

          switch (messageType) {
            case 'text':
              payload.text = newBroadcast.message;
              break;
            case 'image':
              endpoint = '/api/v1/messages/image';
              payload.url = mediaUrl;
              payload.caption = newBroadcast.message || undefined;
              payload.mimetype = mimeType;
              break;
            case 'video':
              endpoint = '/api/v1/messages/video';
              payload.url = mediaUrl;
              payload.caption = newBroadcast.message || undefined;
              payload.mimetype = mimeType;
              break;
            case 'audio':
              endpoint = '/api/v1/messages/audio';
              payload.url = mediaUrl;
              payload.mimetype = mimeType;
              break;
            case 'document':
              endpoint = '/api/v1/messages/document';
              payload.url = mediaUrl;
              payload.filename = filename;
              payload.caption = newBroadcast.message || undefined;
              payload.mimetype = mimeType;
              break;
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const resData = await res.json();
            if (resData.success === false || resData.status === 'failed' || resData.status === 'pending') {
              failCount++;
              console.warn(`Broadcast send failed for ${recipient}:`, resData.error || resData.warning || resData.status);
            } else {
              successCount++;
            }
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Update broadcast record with final stats in DB
      if (broadcastId) {
        try {
          await fetch(`/api/v1/broadcast/${broadcastId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              status: failCount === recipients.length ? 'failed' : 'completed',
              stats: {
                total: recipients.length,
                pending: 0,
                sent: successCount,
                delivered: successCount,
                read: 0,
                failed: failCount,
              },
            }),
          });
        } catch { /* ignore */ }
      }

      setUploadProgress(null);
      toast({ title: `Broadcast sent: ${successCount} succeeded, ${failCount} failed` });
      setNewBroadcast({ name: '', profileId: profiles[0]?.id || '', message: '', recipients: '' });
      setSelectedContacts(new Set());
      setSelectedGroups(new Set());
      setMessageType('text');
      clearMedia();
      setIsDialogOpen(false);
      // Refresh broadcast list
      fetchData();
    } catch (error) {
      toast({ title: 'Failed to send broadcast', variant: 'destructive' });
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  const getStatusBadge = (status: Broadcast['status']) => {
    const statusConfig: Record<string, { color: string; label: string }> = {
      draft: { color: 'bg-gray-500', label: 'Draft' },
      scheduled: { color: 'bg-blue-500', label: 'Scheduled' },
      running: { color: 'bg-yellow-500', label: 'Sending' },
      paused: { color: 'bg-orange-500', label: 'Paused' },
      completed: { color: 'bg-green-500', label: 'Completed' },
      failed: { color: 'bg-red-500', label: 'Failed' },
    };
    const config = statusConfig[status] || { color: 'bg-gray-500', label: status };
    return <Badge className={`${config.color} text-white`}>{config.label}</Badge>;
  };

  const filteredContacts = contacts.filter(c =>
    (c.name || '').toLowerCase().includes(contactSearch.toLowerCase()) ||
    (c.phone || '').includes(contactSearch)
  );

  const filteredGroups = groups.filter(g =>
    (g.name || '').toLowerCase().includes(groupSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Broadcast</h1>
          <p className="text-muted-foreground mt-1">
            Send bulk messages to multiple contacts
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" disabled={profiles.length === 0}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Broadcast
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Broadcast</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Campaign Name *</Label>
                <Input
                  id="name"
                  value={newBroadcast.name}
                  onChange={e => setNewBroadcast(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., New Year Promotion"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="profile">From Profile *</Label>
                <Select
                  value={newBroadcast.profileId}
                  onValueChange={value => setNewBroadcast(prev => ({ ...prev, profileId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map(profile => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.displayName || profile.name || 'Unnamed'} ({profile.phone || 'No phone'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Message Type Selector */}
              <div className="space-y-2">
                <Label>Message Type</Label>
                <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
                  {MESSAGE_TYPES.map(mt => (
                    <button
                      key={mt.value}
                      onClick={() => { setMessageType(mt.value); if (mt.value === 'text') clearMedia(); }}
                      className={`flex-1 text-sm py-2 px-2 rounded-md transition-colors font-medium ${
                        messageType === mt.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mt.icon} {mt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Media Upload (shown for non-text types) */}
              {messageType !== 'text' && (
                <div className="space-y-2">
                  <Label>Media File *</Label>
                  {!mediaFile ? (
                    <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-colors">
                      <div className="flex flex-col items-center text-muted-foreground">
                        <span className="text-2xl mb-1">
                          {messageType === 'image' ? '🖼️' : messageType === 'video' ? '🎥' : messageType === 'audio' ? '🎵' : '📄'}
                        </span>
                        <span className="text-sm">Click to select {messageType} file</span>
                        <span className="text-xs mt-1">
                          {messageType === 'image' && 'JPG, PNG, GIF, WebP (max 5MB)'}
                          {messageType === 'video' && 'MP4, WebM (max 16MB)'}
                          {messageType === 'audio' && 'MP3, OGG, WAV (max 5MB)'}
                          {messageType === 'document' && 'PDF, DOC, XLS, PPT, TXT, ZIP (max 10MB)'}
                        </span>
                      </div>
                      <input
                        type="file"
                        className="hidden"
                        accept={
                          messageType === 'image' ? 'image/*' :
                          messageType === 'video' ? 'video/*' :
                          messageType === 'audio' ? 'audio/*' :
                          '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'
                        }
                        onChange={handleFileChange}
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                      {mediaPreview ? (
                        <img src={mediaPreview} alt="Preview" className="w-16 h-16 object-cover rounded-lg" />
                      ) : (
                        <div className="w-16 h-16 bg-secondary rounded-lg flex items-center justify-center text-2xl">
                          {messageType === 'video' ? '🎥' : messageType === 'audio' ? '🎵' : '📄'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <p className="text-sm font-medium text-foreground truncate max-w-[340px]" title={mediaFile.name}>{mediaFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={clearMedia} className="text-red-500 hover:text-red-600">
                        ✕
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Message / Caption */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message">{messageType === 'text' ? 'Message *' : `Caption${messageType === 'audio' ? ' (not supported)' : ' (optional)'}`}</Label>
                  {messageType === 'text' && newBroadcast.profileId && (
                    <button
                      onClick={() => setShowTemplatePicker(true)}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors flex items-center gap-1"
                    >
                      📋 Use Template
                    </button>
                  )}
                </div>
                <Textarea
                  id="message"
                  value={newBroadcast.message}
                  onChange={e => setNewBroadcast(prev => ({ ...prev, message: e.target.value }))}
                  placeholder={messageType === 'text' ? 'Your broadcast message...' : 'Add a caption to your media...'}
                  rows={messageType === 'text' ? 4 : 2}
                  disabled={messageType === 'audio'}
                />
                <p className="text-xs text-muted-foreground">
                  {newBroadcast.message.length} characters
                </p>
              </div>

              {/* Recipients Section with Tabs */}
              <div className="space-y-3">
                <Label>Recipients *</Label>
                <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
                  {(['manual', 'contacts', 'groups'] as RecipientTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setRecipientTab(tab)}
                      className={`flex-1 text-sm py-2 px-3 rounded-md transition-colors font-medium ${
                        recipientTab === tab
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab === 'manual' && '✏️ Manual'}
                      {tab === 'contacts' && `👤 Contacts${contacts.length > 0 ? ` (${contacts.length})` : ''}`}
                      {tab === 'groups' && `👥 Groups${groups.length > 0 ? ` (${groups.length})` : ''}`}
                    </button>
                  ))}
                </div>

                {/* Manual Tab */}
                {recipientTab === 'manual' && (
                  <div className="space-y-2">
                    <Textarea
                      id="recipients"
                      value={newBroadcast.recipients}
                      onChange={e => setNewBroadcast(prev => ({ ...prev, recipients: e.target.value }))}
                      placeholder={"628123456789\n628987654321\n..."}
                      rows={4}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {newBroadcast.recipients.split('\n').filter(r => r.trim()).length} recipients • One phone number per line
                    </p>
                  </div>
                )}

                {/* Contacts Tab */}
                {recipientTab === 'contacts' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Search contacts..."
                        value={contactSearch}
                        onChange={e => setContactSearch(e.target.value)}
                        className="flex-1"
                      />
                      <Button variant="outline" size="sm" onClick={selectAllContacts}>
                        {filteredContacts.length > 0 && filteredContacts.every(c => {
                          const jid = c.phone ? (c.phone.replace(/\D/g, '') + '@s.whatsapp.net') : c.id;
                          return selectedContacts.has(jid);
                        }) ? 'Deselect All' : 'Select All'}
                      </Button>
                    </div>
                    {loadingRecipients ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">Loading contacts...</div>
                    ) : filteredContacts.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        {contacts.length === 0 ? 'No contacts found. Sync contacts from WhatsApp first.' : 'No matching contacts'}
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {filteredContacts.map(contact => {
                          const jid = contact.phone ? (contact.phone.replace(/\D/g, '') + '@s.whatsapp.net') : contact.id;
                          const isSelected = selectedContacts.has(jid);
                          return (
                            <label
                              key={contact.id}
                              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleContact(contact)}
                                className="rounded border-gray-300 w-4 h-4 accent-primary"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{contact.name || 'Unknown'}</div>
                                <div className="text-xs text-muted-foreground">{contact.phone || 'No phone'}</div>
                              </div>
                              {(contact.tags || []).length > 0 && (
                                <div className="flex gap-1">
                                  {(contact.tags || []).slice(0, 2).map(tag => (
                                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                                  ))}
                                </div>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {selectedContacts.size > 0 && (
                      <p className="text-xs text-primary font-medium">
                        ✅ {selectedContacts.size} contact{selectedContacts.size !== 1 ? 's' : ''} selected
                      </p>
                    )}
                  </div>
                )}

                {/* Groups Tab */}
                {recipientTab === 'groups' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Search groups..."
                        value={groupSearch}
                        onChange={e => setGroupSearch(e.target.value)}
                        className="flex-1"
                      />
                      <Button variant="outline" size="sm" onClick={selectAllGroups}>
                        {filteredGroups.length > 0 && filteredGroups.every(g => selectedGroups.has(g.jid || g.id))
                          ? 'Deselect All' : 'Select All'}
                      </Button>
                    </div>
                    {loadingRecipients ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">Loading groups...</div>
                    ) : filteredGroups.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        {groups.length === 0 ? 'No groups found. Make sure the profile is connected.' : 'No matching groups'}
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {filteredGroups.map(group => {
                          const jid = group.jid || group.id;
                          const isSelected = selectedGroups.has(jid);
                          return (
                            <label
                              key={group.id}
                              className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-secondary/50 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleGroup(group)}
                                className="rounded border-gray-300 w-4 h-4 accent-primary"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{group.name || 'Unnamed Group'}</div>
                                <div className="text-xs text-muted-foreground">
                                  {group.participantCount ? `${group.participantCount} members` : 'Group'}
                                </div>
                              </div>
                              <Badge variant="outline" className="text-xs">👥</Badge>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {selectedGroups.size > 0 && (
                      <p className="text-xs text-primary font-medium">
                        ✅ {selectedGroups.size} group{selectedGroups.size !== 1 ? 's' : ''} selected
                      </p>
                    )}
                  </div>
                )}

                {/* Total count */}
                {getTotalRecipientCount() > 0 && (
                  <div className="flex items-center gap-2 p-2 bg-primary/5 rounded-lg">
                    <span className="text-sm font-medium text-primary">
                      📨 Total: {getTotalRecipientCount()} recipient{getTotalRecipientCount() !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateBroadcast} disabled={sending}>
                {sending ? (uploadProgress || 'Sending...') : `🚀 Send to ${getTotalRecipientCount()} recipient${getTotalRecipientCount() !== 1 ? 's' : ''}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* No connected profiles warning */}
      {profiles.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h3 className="font-semibold text-amber-800 dark:text-amber-300">No Connected Profiles</h3>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                You need at least one connected WhatsApp profile to send broadcasts.
              </p>
              <Button variant="outline" size="sm" className="mt-3" asChild>
                <a href="/dashboard/profiles/new">Connect Profile</a>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {(() => {
        const totalBroadcasts = broadcasts.length;
        const totalSent = broadcasts.reduce((sum, b) => sum + ((b.stats as any)?.sent || b.sentCount || 0), 0);
        const totalRecipients = broadcasts.reduce((sum, b) => sum + ((b.stats as any)?.total || ((b.recipients as any)?.value?.length) || b.recipientCount || 0), 0);
        const deliveryRate = totalRecipients > 0 ? Math.round((totalSent / totalRecipients) * 100) : 0;
        const scheduledCount = broadcasts.filter(b => b.status === 'scheduled').length;
        return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-2xl p-5 border border-border">
          <div className="text-2xl mb-1">📊</div>
          <div className="text-2xl font-bold text-foreground">{totalBroadcasts}</div>
          <div className="text-sm text-muted-foreground">Total Broadcasts</div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border">
          <div className="text-2xl mb-1">📨</div>
          <div className="text-2xl font-bold text-foreground">{totalSent}</div>
          <div className="text-sm text-muted-foreground">Messages Sent</div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border">
          <div className="text-2xl mb-1">✅</div>
          <div className="text-2xl font-bold text-green-600">{deliveryRate}%</div>
          <div className="text-sm text-muted-foreground">Delivery Rate</div>
        </div>
        <div className="bg-card rounded-2xl p-5 border border-border">
          <div className="text-2xl mb-1">📅</div>
          <div className="text-2xl font-bold text-foreground">{scheduledCount}</div>
          <div className="text-sm text-muted-foreground">Scheduled</div>
        </div>
      </div>
        );
      })()}

      {/* Recent Broadcasts */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Recent Broadcasts</h2>
        </div>
        {broadcasts.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-5xl mb-4">📢</div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No broadcasts yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first broadcast to reach multiple contacts at once
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {broadcasts.map(broadcast => {
              const stats = (broadcast.stats as any) || {};
              const recipientList = (broadcast.recipients as any)?.value || [];
              const recipientCount = broadcast.recipientCount || stats.total || recipientList.length || 0;
              const sentCount = broadcast.sentCount || stats.sent || 0;
              const failedCount = broadcast.failedCount || stats.failed || 0;

              const handleSendExisting = async () => {
                const token = localStorage.getItem('accessToken');
                const broadcastRecipients = (broadcast.recipients as any)?.value || [];
                const broadcastMessage = (broadcast.message as any);
                
                if (broadcastRecipients.length === 0) {
                  toast({ title: 'No recipients found in this broadcast', variant: 'destructive' });
                  return;
                }

                // Validate message content
                const msgType = broadcastMessage?.type || 'text';
                if (msgType !== 'text' && !broadcastMessage?.url) {
                  toast({ 
                    title: 'Cannot send: media URL missing', 
                    description: 'This broadcast has no media file stored. Please create a new broadcast with the media attached.',
                    variant: 'destructive' 
                  });
                  return;
                }
                if (msgType === 'text' && !broadcastMessage?.text) {
                  toast({ title: 'Cannot send: message text is empty', variant: 'destructive' });
                  return;
                }

                setSending(true);
                try {
                  // First check if profile is connected
                  const profileRes = await fetch(`/api/v1/profiles/${broadcast.profileId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (profileRes.ok) {
                    const profileData = await profileRes.json();
                    if (profileData.status !== 'connected') {
                      toast({ 
                        title: '❌ WhatsApp not connected', 
                        description: `Profile "${profileData.displayName || 'Unknown'}" is ${profileData.status}. Please connect WhatsApp first from the Profiles page.`,
                        variant: 'destructive' 
                      });
                      setSending(false);
                      return;
                    }
                  }

                  // Set status to running
                  await fetch(`/api/v1/broadcast/${broadcast.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      status: 'running',
                      stats: { total: broadcastRecipients.length, pending: broadcastRecipients.length, sent: 0, delivered: 0, read: 0, failed: 0 },
                    }),
                  });
                  fetchData();

                  let successCount = 0;
                  let failCount = 0;

                  for (let i = 0; i < broadcastRecipients.length; i++) {
                    const recipient = broadcastRecipients[i];
                    try {
                      let endpoint = '/api/v1/messages/text';
                      let payload: any = { profileId: broadcast.profileId, to: recipient };

                      if (msgType === 'text') {
                        payload.text = broadcastMessage?.text || '';
                      } else if (msgType === 'image') {
                        endpoint = '/api/v1/messages/image';
                        payload.url = broadcastMessage?.url;
                        payload.caption = broadcastMessage?.text || undefined;
                        payload.mimetype = broadcastMessage?.mimetype || 'image/jpeg';
                      } else if (msgType === 'document') {
                        endpoint = '/api/v1/messages/document';
                        payload.url = broadcastMessage?.url;
                        payload.filename = broadcastMessage?.filename || 'file';
                        payload.caption = broadcastMessage?.text || undefined;
                        payload.mimetype = broadcastMessage?.mimetype || 'application/octet-stream';
                      } else {
                        endpoint = `/api/v1/messages/${msgType}`;
                        payload.url = broadcastMessage?.url;
                        payload.caption = broadcastMessage?.text || undefined;
                        payload.mimetype = broadcastMessage?.mimetype;
                      }

                      const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify(payload),
                      });
                      
                      if (res.ok) {
                        const resData = await res.json();
                        // Check actual delivery status: 'pending' = not connected, 'failed' = error
                        if (resData.success === false || resData.status === 'failed' || resData.status === 'pending') {
                          failCount++;
                          console.warn(`Broadcast message failed for ${recipient}:`, resData.error || resData.warning || `status: ${resData.status}`);
                        } else {
                          successCount++;
                        }
                      } else {
                        failCount++;
                      }
                    } catch { failCount++; }
                    await new Promise(r => setTimeout(r, 1500));
                  }

                  // Update final stats
                  await fetch(`/api/v1/broadcast/${broadcast.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                      status: failCount === broadcastRecipients.length ? 'failed' : 'completed',
                      stats: { total: broadcastRecipients.length, pending: 0, sent: successCount, delivered: successCount, read: 0, failed: failCount },
                    }),
                  });

                  toast({ title: `Broadcast sent: ${successCount} success, ${failCount} failed` });
                  fetchData();
                } catch (err) {
                  toast({ title: 'Broadcast sending failed', variant: 'destructive' });
                } finally {
                  setSending(false);
                }
              };

              const handleDelete = async () => {
                const token = localStorage.getItem('accessToken');
                try {
                  await fetch(`/api/v1/broadcast/${broadcast.id}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  toast({ title: 'Broadcast deleted' });
                  fetchData();
                } catch {
                  toast({ title: 'Failed to delete broadcast', variant: 'destructive' });
                }
              };

              return (
              <div key={broadcast.id} className="p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors">
                <div>
                  <div className="font-medium text-foreground">{broadcast.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {recipientCount} recipients • {new Date(broadcast.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm">
                    <div className="text-green-600">{sentCount} sent</div>
                    {failedCount > 0 && (
                      <div className="text-red-600">{failedCount} failed</div>
                    )}
                  </div>
                  {getStatusBadge(broadcast.status)}
                  {broadcast.status === 'draft' && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleSendExisting}
                      disabled={sending}
                      className="bg-green-600 hover:bg-green-700"
                      title="Send this broadcast now"
                    >
                      ▶️ Send
                    </Button>
                  )}
                  {['completed', 'failed'].includes(broadcast.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSendExisting}
                      disabled={sending}
                      title="Resend this broadcast"
                    >
                      🔄 Resend
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    title="Delete broadcast"
                  >
                    🗑️
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tips */}
      <div className="bg-card rounded-2xl p-6 border border-border">
        <h3 className="font-semibold text-foreground mb-3">💡 Broadcast Tips</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            You can select recipients from your Contacts or Groups — no need to type numbers manually
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            Keep messages concise - shorter messages have higher engagement
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            Messages are sent with a 1.5s delay between each to avoid rate limiting
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary">•</span>
            Always comply with WhatsApp&apos;s messaging policies to avoid account restrictions
          </li>
        </ul>
      </div>
    </div>

      {/* Template Picker Modal */}
      {showTemplatePicker && newBroadcast.profileId && (
        <TemplatePicker
          profileId={newBroadcast.profileId}
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
    </>
  );
}
