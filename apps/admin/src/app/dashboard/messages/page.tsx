// MultiWA Admin - Messages with File Upload Support
// apps/admin/src/app/dashboard/messages/page.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Pencil,
  User,
  Users,
  Send,
  Plus,
  X,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  MapPin,
  BarChart3,
  MessageSquare,
  FileUp,
  Search,
  Clock,
  Calendar,
  Loader2,
  AlertCircle,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import TemplatePicker from '@/components/templates/TemplatePicker';

interface Profile {
  id: string;
  displayName: string;
  phoneNumber: string | null;
  status: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags?: string[];
}

interface Group {
  id: string;
  name: string;
  participantCount?: number;
}

type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'LOCATION' | 'POLL' | 'CONTACT';
type RecipientMode = 'manual' | 'contact' | 'group';

const messageTypes: { value: MessageType; label: string; Icon: LucideIcon }[] = [
  { value: 'TEXT',     label: 'Text',     Icon: MessageSquare },
  { value: 'IMAGE',    label: 'Image',    Icon: ImageIcon },
  { value: 'VIDEO',    label: 'Video',    Icon: Video },
  { value: 'AUDIO',    label: 'Audio',    Icon: Music },
  { value: 'DOCUMENT', label: 'Document', Icon: FileText },
  { value: 'LOCATION', label: 'Location', Icon: MapPin },
  { value: 'POLL',     label: 'Poll',     Icon: BarChart3 },
  { value: 'CONTACT',  label: 'Contact',  Icon: User },
];

const MEDIA_ICON_MAP: Partial<Record<MessageType, LucideIcon>> = {
  IMAGE: ImageIcon,
  VIDEO: Video,
  AUDIO: Music,
  DOCUMENT: FileText,
};

export default function MessagesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [recipient, setRecipient] = useState('');
  const [messageType, setMessageType] = useState<MessageType>('TEXT');
  const [textContent, setTextContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [fileName, setFileName] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [simulateTyping, setSimulateTyping] = useState(false);
  const [typingDuration, setTypingDuration] = useState(3);
  const [loading, setLoading] = useState(true);
  const [sentMessages, setSentMessages] = useState<{to: string; type: string; time: Date}[]>([]);
  
  // File upload states
  const [useFileUpload, setUseFileUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Location states
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');

  // Poll states
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [allowMultipleAnswers, setAllowMultipleAnswers] = useState(false);

  // Contact card states
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  // Contact/Group picker states
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('manual');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectedRecipientName, setSelectedRecipientName] = useState('');
  
  // Template picker state
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Schedule states
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const handleTemplateSelect = (template: any, processedContent: string) => {
    setTextContent(processedContent);
    setMessageType('TEXT');
    setShowTemplatePicker(false);
    setStatus(`Template "${template.name}" applied`);
  };

  const handleScheduleMessage = async () => {
    if (!selectedProfile || !recipient || !scheduleDateTime) {
      setStatus('Please select profile, recipient, and schedule time');
      return;
    }
    if (messageType === 'TEXT' && !textContent) {
      setStatus('Please enter message text');
      return;
    }
    // Format recipient
    let formattedRecipient = recipient.replace(/\s+/g, '').replace(/-/g, '');
    if (!formattedRecipient.includes('@')) {
      formattedRecipient = formattedRecipient.replace(/^0/, '62') + '@s.whatsapp.net';
    }
    setScheduling(true);
    setStatus('Scheduling message...');
    try {
      const token = localStorage.getItem('accessToken');
      const scheduledAt = new Date(scheduleDateTime).toISOString();
      const res = await fetch('/api/v1/messages/schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          profileId: selectedProfile,
          to: formattedRecipient,
          type: messageType.toLowerCase(),
          content: textContent,
          scheduledAt,
        }),
      });
      const result = await res.json();
      if (res.ok) {
        const formattedTime = new Date(scheduleDateTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
        setStatus(`Message scheduled for ${formattedTime}`);
        setTextContent('');
        setScheduleDateTime('');
        setShowSchedulePicker(false);
        setSentMessages(prev => [{ to: selectedRecipientName || recipient, type: `${messageType} (Scheduled)`, time: new Date() }, ...prev.slice(0, 4)]);
      } else {
        setStatus(`Failed to schedule: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      setStatus('Failed to schedule message');
    } finally {
      setScheduling(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  // Fetch contacts and groups when profile changes
  useEffect(() => {
    if (selectedProfile) {
      fetchContactsAndGroups(selectedProfile);
      fetchRecentMessages(selectedProfile);
    }
  }, [selectedProfile]);

  const fetchProfiles = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/v1/profiles', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const profilesArray = Array.isArray(data) ? data : (data.data || []);
        setProfiles(profilesArray);
        if (profilesArray.length > 0) {
          setSelectedProfile(profilesArray[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentMessages = async (profileId: string) => {
    try {
      const token = localStorage.getItem('accessToken');
      const convRes = await fetch(`/api/v1/conversations?profileId=${profileId}&limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (convRes.ok) {
        const convData = await convRes.json();
        const conversations = convData.conversations || [];
        // Collect recent messages from all conversations
        const recentMsgs: {to: string; type: string; time: Date; content?: string}[] = [];
        for (const conv of conversations.slice(0, 5)) {
          const msgRes = await fetch(`/api/v1/conversations/${conv.id}/messages?limit=5`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (msgRes.ok) {
            const messages = await msgRes.json();
            const msgArray = Array.isArray(messages) ? messages : (messages.messages || []);
            for (const msg of msgArray) {
              if (msg.direction === 'outgoing') {
                recentMsgs.push({
                  to: conv.contactName || (conv.name && !/^[0-9]+(@g\.us|@s\.whatsapp\.net)?$/.test(conv.name) && conv.name !== conv.jid ? conv.name : null) || (() => {
                    const jid = conv.jid || '';
                    if (jid.includes('@g.us')) return 'Group Chat';
                    const cleaned = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
                    if (cleaned.startsWith('62')) return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)}-${cleaned.slice(5, 9)}-${cleaned.slice(9)}`;
                    return cleaned || 'Unknown';
                  })(),
                  type: msg.type?.toUpperCase() || 'TEXT',
                  time: new Date(msg.timestamp || msg.createdAt),
                  content: msg.content?.text || msg.content?.caption || '',
                });
              }
            }
          }
        }
        // Sort by time desc and take first 5
        recentMsgs.sort((a, b) => b.time.getTime() - a.time.getTime());
        setSentMessages(prev => [
          ...recentMsgs.slice(0, 5),
          ...prev.filter(p => !recentMsgs.some(r => r.time.getTime() === p.time.getTime())),
        ].slice(0, 5));
      }
    } catch (error) {
      console.error('Failed to fetch recent messages:', error);
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

  const selectContact = (contact: Contact) => {
    const phone = contact.phone.replace(/\D/g, '');
    const formattedPhone = phone.startsWith('0') ? '62' + phone.slice(1) : phone;
    setRecipient(formattedPhone);
    setSelectedRecipientName(contact.name);
  };

  const selectGroup = (group: Group) => {
    setRecipient(group.id); // Group ID already contains @g.us
    setSelectedRecipientName(group.name);
  };

  // Filter contacts/groups by search
  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    c.phone.includes(recipientSearch)
  );

  const filteredGroups = groups.filter(g => 
    g.name.toLowerCase().includes(recipientSearch.toLowerCase())
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setFileName(file.name);
    }
  };

  const uploadFile = async (): Promise<string | null> => {
    if (!selectedFile) return null;

    setUploading(true);
    setUploadProgress(10);

    try {
      const token = localStorage.getItem('accessToken');
      const formData = new FormData();
      formData.append('file', selectedFile);

      setUploadProgress(30);

      const res = await fetch('/api/v1/uploads/media', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      setUploadProgress(90);

      const result = await res.json();
      console.log('Upload result:', result);

      if (res.ok && result.success) {
        setUploadProgress(100);
        return result.data.url;
      } else {
        throw new Error(result.error?.message || 'Upload failed');
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      setStatus(`Upload failed: ${error.message}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const buildContent = (url: string) => {
    switch (messageType) {
      case 'TEXT':
        return { text: textContent };
      case 'IMAGE':
      case 'VIDEO':
      case 'AUDIO':
        return {
          url,
          caption: caption || undefined,
        };
      case 'DOCUMENT':
        return {
          url,
          filename: fileName || 'document',
          caption: caption || undefined,
        };
      default:
        return { text: textContent };
    }
  };

  const sendMessage = async () => {
    if (!selectedProfile || !recipient) {
      setStatus('Please select profile and enter recipient');
      return;
    }

    if (messageType === 'TEXT' && !textContent) {
      setStatus('Please enter message text');
      return;
    }

    if (messageType === 'LOCATION' && (!latitude || !longitude)) {
      setStatus('Please enter latitude and longitude');
      return;
    }

    if (messageType === 'POLL') {
      if (!pollQuestion) { setStatus('Please enter a poll question'); return; }
      const validOptions = pollOptions.filter(o => o.trim());
      if (validOptions.length < 2) { setStatus('Poll needs at least 2 options'); return; }
    }

    if (messageType === 'CONTACT' && (!contactName || !contactPhone)) {
      setStatus('Please enter contact name and phone'); return;
    }

    if (['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(messageType)) {
      if (useFileUpload && !selectedFile) {
        setStatus('Please select a file to upload');
        return;
      }
      if (!useFileUpload && !mediaUrl) {
        setStatus('Please enter media URL');
        return;
      }
    }

    // Format recipient
    let formattedRecipient = recipient.replace(/\s+/g, '').replace(/-/g, '');
    if (!formattedRecipient.includes('@')) {
      formattedRecipient = formattedRecipient.replace(/^0/, '62') + '@s.whatsapp.net';
    }

    setSending(true);
    setStatus('Sending...');

    try {
      // Send typing indicator if enabled
      if (simulateTyping) {
        setStatus('Simulating typing...');
        const token = localStorage.getItem('accessToken');
        try {
          await fetch('/api/v1/messages/typing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ profileId: selectedProfile, to: formattedRecipient, duration: typingDuration * 1000 }),
          });
          await new Promise(resolve => setTimeout(resolve, (typingDuration - 1) * 1000));
        } catch (e) { /* non-critical */ }
        setStatus('Sending...');
      }
      const token = localStorage.getItem('accessToken');
      
      // Upload file if using file upload
      let finalUrl = mediaUrl;
      if (messageType !== 'TEXT' && useFileUpload && selectedFile) {
        setStatus('Uploading file...');
        const uploadedUrl = await uploadFile();
        if (!uploadedUrl) {
          setSending(false);
          return;
        }
        finalUrl = uploadedUrl;
        setStatus('Sending message...');
      }

      const content = buildContent(finalUrl);
      
      // Determine endpoint and body based on message type
      const typeEndpointMap: Record<string, string> = {
        TEXT: 'text',
        IMAGE: 'image',
        VIDEO: 'video',
        AUDIO: 'audio',
        DOCUMENT: 'document',
        LOCATION: 'location',
        POLL: 'poll',
        CONTACT: 'contact',
      };
      
      const endpoint = typeEndpointMap[messageType] || 'text';
      
      // Build body based on message type
      let body: any = {
        profileId: selectedProfile,
        to: formattedRecipient,
      };
      
      if (messageType === 'TEXT') {
        body.text = textContent;
      } else if (messageType === 'IMAGE') {
        body.url = finalUrl;
        body.caption = caption || undefined;
      } else if (messageType === 'VIDEO') {
        body.url = finalUrl;
        body.caption = caption || undefined;
      } else if (messageType === 'AUDIO') {
        body.url = finalUrl;
      } else if (messageType === 'DOCUMENT') {
        body.url = finalUrl;
        body.filename = fileName || 'document';
        body.caption = caption || undefined;
      } else if (messageType === 'LOCATION') {
        body.latitude = parseFloat(latitude);
        body.longitude = parseFloat(longitude);
        body.name = locationName || undefined;
        body.address = locationAddress || undefined;
      } else if (messageType === 'POLL') {
        body.question = pollQuestion;
        body.options = pollOptions.filter(o => o.trim());
        body.allowMultipleAnswers = allowMultipleAnswers;
      } else if (messageType === 'CONTACT') {
        body.contacts = [{ name: contactName, phone: contactPhone, email: contactEmail || undefined }];
      }
      
      const res = await fetch(`/api/v1/messages/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      console.log('Send result:', result);

      if (res.ok && result.success !== false) {
        setStatus('Message sent successfully!');
        setSentMessages(prev => [{to: selectedRecipientName || recipient, type: messageType, time: new Date()}, ...prev.slice(0, 4)]);
        // Reset fields
        if (messageType === 'TEXT') {
          setTextContent('');
        } else if (messageType === 'LOCATION') {
          setLatitude(''); setLongitude(''); setLocationName(''); setLocationAddress('');
        } else if (messageType === 'POLL') {
          setPollQuestion(''); setPollOptions(['', '']); setAllowMultipleAnswers(false);
        } else if (messageType === 'CONTACT') {
          setContactName(''); setContactPhone(''); setContactEmail('');
        } else {
          setMediaUrl('');
          setCaption('');
          setFileName('');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      } else {
        setStatus(`Failed: ${result.error?.message || result.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to send:', error);
      setStatus('Failed to send message');
    } finally {
      setSending(false);
      setUploadProgress(0);
    }
  };

  const getAcceptTypes = () => {
    switch (messageType) {
      case 'IMAGE': return 'image/*';
      case 'VIDEO': return 'video/*';
      case 'AUDIO': return 'audio/*';
      case 'DOCUMENT': return '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip';
      default: return '*/*';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-secondary rounded w-48 mb-4"></div>
          <div className="bg-card rounded-2xl p-6 border border-border">
            <div className="h-40 bg-secondary rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Messages</h1>
        <p className="text-muted-foreground mt-1">Send WhatsApp messages with file upload support</p>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-card rounded-2xl p-12 border border-border text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Send className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Connected Profiles</h3>
          <p className="text-muted-foreground mb-6">Connect a WhatsApp profile first</p>
          <a href="/dashboard/profiles/new" className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors cursor-pointer">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add Profile
          </a>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Send Message Form */}
          <div className="lg:col-span-2">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border bg-primary/10">
                <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                  Send Message
                </h2>
              </div>
              
              <div className="p-6 space-y-5">
                {/* Profile Selector */}
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-2">From Profile</label>
                  <select
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName || 'Unnamed'} ({p.phoneNumber})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Recipient Section */}
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-2">Recipient</label>
                  
                  {/* Recipient Mode Tabs */}
                  <div className="flex gap-1 mb-2" role="tablist" aria-label="Recipient source">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={recipientMode === 'manual'}
                      onClick={() => { setRecipientMode('manual'); setSelectedRecipientName(''); }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                        recipientMode === 'manual'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary/60 text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      Manual
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={recipientMode === 'contact'}
                      onClick={() => setRecipientMode('contact')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                        recipientMode === 'contact'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary/60 text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" aria-hidden="true" />
                      Contact ({contacts.length})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={recipientMode === 'group'}
                      onClick={() => setRecipientMode('group')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                        recipientMode === 'group'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary/60 text-muted-foreground hover:bg-secondary/80'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      Group ({groups.length})
                    </button>
                  </div>

                  {/* Manual Input */}
                  {recipientMode === 'manual' && (
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="628xxxxxxxxxx"
                      className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                    />
                  )}

                  {/* Contact Picker */}
                  {recipientMode === 'contact' && (
                    <div className="space-y-2">
                      {selectedRecipientName ? (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-primary/10 border border-primary/30">
                          <User className="w-4 h-4 text-primary flex-shrink-0" aria-hidden="true" />
                          <span className="flex-1 text-primary truncate">{selectedRecipientName}</span>
                          <button
                            type="button"
                            onClick={() => { setRecipient(''); setSelectedRecipientName(''); }}
                            className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-sm cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                            Clear
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={recipientSearch}
                            onChange={(e) => setRecipientSearch(e.target.value)}
                            placeholder="Search contacts..."
                            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                          />
                          <div className="max-h-40 overflow-y-auto border border-border rounded-xl">
                            {loadingRecipients ? (
                              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
                            ) : filteredContacts.length === 0 ? (
                              <div className="p-4 text-center text-muted-foreground text-sm">
                                {contacts.length === 0 ? 'No contacts saved yet' : 'No contacts match'}
                              </div>
                            ) : (
                              filteredContacts.map((contact) => (
                                <button
                                  key={contact.id}
                                  onClick={() => selectContact(contact)}
                                  className="w-full px-4 py-2 text-left hover:bg-secondary/40 border-b last:border-0 border-border transition-colors"
                                >
                                  <div className="font-medium text-foreground text-sm">{contact.name}</div>
                                  <div className="text-xs text-muted-foreground">{contact.phone}</div>
                                </button>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Group Picker */}
                  {recipientMode === 'group' && (
                    <div className="space-y-2">
                      {selectedRecipientName ? (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-sky-500/15 border border-sky-500/30">
                          <Users className="w-4 h-4 text-sky-300 flex-shrink-0" aria-hidden="true" />
                          <span className="flex-1 text-sky-300 truncate">{selectedRecipientName}</span>
                          <button
                            type="button"
                            onClick={() => { setRecipient(''); setSelectedRecipientName(''); }}
                            className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 text-sm cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                            Clear
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={recipientSearch}
                            onChange={(e) => setRecipientSearch(e.target.value)}
                            placeholder="Search groups..."
                            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
                          />
                          <div className="max-h-40 overflow-y-auto border border-border rounded-xl">
                            {loadingRecipients ? (
                              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
                            ) : filteredGroups.length === 0 ? (
                              <div className="p-4 text-center text-muted-foreground text-sm">
                                {groups.length === 0 ? 'No groups found' : 'No groups match'}
                              </div>
                            ) : (
                              filteredGroups.map((group) => (
                                <button
                                  key={group.id}
                                  onClick={() => selectGroup(group)}
                                  className="w-full px-4 py-2 text-left hover:bg-secondary/40 border-b last:border-0 border-border transition-colors"
                                >
                                  <div className="font-medium text-foreground text-sm">{group.name}</div>
                                  {group.participantCount && (
                                    <div className="text-xs text-muted-foreground">{group.participantCount} participants</div>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Message Type Tabs */}
                <div>
                  <label className="block text-sm font-medium text-foreground/90 mb-2">Message Type</label>
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Message type">
                    {messageTypes.map((type) => {
                      const Icon = type.Icon;
                      const active = messageType === type.value;
                      return (
                        <button
                          key={type.value}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => {
                            setMessageType(type.value);
                            setSelectedFile(null);
                            setMediaUrl('');
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className={`px-4 py-2 rounded-xl font-medium text-sm transition-all inline-flex items-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                            active
                              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                              : 'bg-secondary/60 text-foreground/90 hover:bg-secondary/80'
                          }`}
                        >
                          <Icon className="w-4 h-4" aria-hidden="true" />
                          {type.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Content based on type */}
                {messageType === 'TEXT' ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-foreground/90">Message</label>
                      {selectedProfile && (
                        <button
                          type="button"
                          onClick={() => setShowTemplatePicker(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                        >
                          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                          Use Template
                        </button>
                      )}
                    </div>
                    <textarea
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      rows={4}
                      placeholder="Type your message here..."
                      className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent resize-none"
                    />
                  </div>
                ) : ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(messageType) ? (
                  <div className="space-y-4">
                    {/* Toggle URL / Upload */}
                    <div className="inline-flex items-center gap-1 p-1 bg-secondary/50 rounded-lg" role="tablist" aria-label="Media source">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={!useFileUpload}
                        onClick={() => setUseFileUpload(false)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                          !useFileUpload
                            ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                        URL
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={useFileUpload}
                        onClick={() => setUseFileUpload(true)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                          useFileUpload
                            ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
                        Upload File
                      </button>
                    </div>

                    {!useFileUpload ? (
                      <div>
                        <label className="block text-sm font-medium text-foreground/90 mb-2">
                          {messageType} URL
                        </label>
                        <input
                          type="url"
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="https://example.com/file.jpg"
                          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                        />
                      </div>
                    ) : (() => {
                      const MediaIcon = MEDIA_ICON_MAP[messageType] ?? FileText;
                      return (
                        <div>
                          <label className="block text-sm font-medium text-foreground/90 mb-2">
                            Select File
                          </label>
                          <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/50 hover:bg-secondary/30 transition-colors">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept={getAcceptTypes()}
                              onChange={handleFileSelect}
                              className="hidden"
                              id="fileUpload"
                            />
                            <label htmlFor="fileUpload" className="cursor-pointer block">
                              {selectedFile ? (
                                <div className="flex items-center justify-center gap-3">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                                    <MediaIcon className="w-6 h-6" aria-hidden="true" />
                                  </span>
                                  <div className="text-left">
                                    <p className="font-medium text-foreground">{selectedFile.name}</p>
                                    <p className="text-sm text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/60 text-muted-foreground">
                                    <FileUp className="w-6 h-6" aria-hidden="true" />
                                  </span>
                                  <p className="text-muted-foreground">Click to select a file</p>
                                  <p className="text-xs text-muted-foreground/70 mt-1">or drag and drop</p>
                                </>
                              )}
                            </label>
                          </div>
                          {uploading && (
                            <div className="mt-3">
                              <div className="h-2 bg-secondary/60 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all duration-300"
                                  style={{ width: `${uploadProgress}%` }}
                                />
                              </div>
                              <p className="text-xs text-muted-foreground mt-1 text-center tabular-nums">Uploading... {uploadProgress}%</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {messageType === 'DOCUMENT' && (
                      <div>
                        <label className="block text-sm font-medium text-foreground/90 mb-2">Filename</label>
                        <input
                          type="text"
                          value={fileName}
                          onChange={(e) => setFileName(e.target.value)}
                          placeholder="document.pdf"
                          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                        />
                      </div>
                    )}

                    {(messageType === 'IMAGE' || messageType === 'VIDEO' || messageType === 'DOCUMENT') && (
                      <div>
                        <label className="block text-sm font-medium text-foreground/90 mb-2">Caption (optional)</label>
                        <input
                          type="text"
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          placeholder="Add a caption..."
                          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Location form */}
                {messageType === 'LOCATION' && (
                  <div className="space-y-4">
                    {/* Coordinate inputs with map preview hint */}
                    <div className="bg-gradient-to-br from-sky-500/10 to-primary/10 rounded-xl p-4 border border-sky-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <MapPin className="w-4 h-4 text-sky-300" aria-hidden="true" />
                        <h4 className="font-medium text-foreground text-sm">Coordinates</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Latitude *</label>
                          <input
                            type="number" step="any" value={latitude} onChange={e => setLatitude(e.target.value)}
                            placeholder="-6.2088"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Longitude *</label>
                          <input
                            type="number" step="any" value={longitude} onChange={e => setLongitude(e.target.value)}
                            placeholder="106.8456"
                            className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (navigator.geolocation) {
                            navigator.geolocation.getCurrentPosition(pos => {
                              setLatitude(pos.coords.latitude.toString());
                              setLongitude(pos.coords.longitude.toString());
                            });
                          }
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 hover:underline cursor-pointer"
                      >
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        Use current location
                      </button>
                    </div>
                    {/* Location details */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Location Name (optional)</label>
                        <input
                          type="text" value={locationName} onChange={e => setLocationName(e.target.value)}
                          placeholder="e.g. Head Office"
                          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Address (optional)</label>
                        <input
                          type="text" value={locationAddress} onChange={e => setLocationAddress(e.target.value)}
                          placeholder="Jl. Example No. 123, Jakarta"
                          className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Poll form */}
                {messageType === 'POLL' && (
                  <div className="space-y-4">
                    {/* Poll question */}
                    <div className="bg-violet-500/10 rounded-xl p-4 border border-violet-500/20">
                      <div className="flex items-center gap-2 mb-3">
                        <BarChart3 className="w-4 h-4 text-violet-300" aria-hidden="true" />
                        <h4 className="font-medium text-foreground text-sm">Poll Question</h4>
                      </div>
                      <input
                        type="text" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
                        placeholder="What is your favorite color?"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-violet-500/50 focus:border-transparent text-sm"
                      />
                    </div>
                    {/* Poll options */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-muted-foreground">Options *</label>
                        <span className="text-xs text-muted-foreground/70 tabular-nums">{pollOptions.filter(o => o.trim()).length}/12</span>
                      </div>
                      <div className="space-y-2">
                        {pollOptions.map((opt, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <span className="w-6 h-6 rounded-full bg-violet-500/15 text-violet-300 flex items-center justify-center text-xs font-medium flex-shrink-0 tabular-nums">{i + 1}</span>
                            <input
                              type="text" value={opt}
                              onChange={e => { const n = [...pollOptions]; n[i] = e.target.value; setPollOptions(n); }}
                              placeholder={`Option ${i + 1}`}
                              className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-violet-500/50 focus:border-transparent text-sm"
                            />
                            {pollOptions.length > 2 && (
                              <button
                                type="button"
                                onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                                aria-label={`Remove option ${i + 1}`}
                                className="w-8 h-8 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors">
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ))}
                        {pollOptions.length < 12 && (
                          <button
                            type="button"
                            onClick={() => setPollOptions([...pollOptions, ''])}
                            className="w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-violet-500/60 hover:text-violet-300 transition-colors text-sm flex items-center justify-center gap-1.5 cursor-pointer">
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            Add Option
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Multiple answers toggle */}
                    <label className="flex items-center gap-3 text-sm text-foreground/90 cursor-pointer bg-secondary/40 rounded-xl p-3 border border-border">
                      <input type="checkbox" checked={allowMultipleAnswers} onChange={e => setAllowMultipleAnswers(e.target.checked)}
                        className="w-4 h-4 rounded border-border accent-violet-500" />
                      <div>
                        <p className="font-medium">Allow multiple answers</p>
                        <p className="text-xs text-muted-foreground">Recipients can select more than one option</p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Contact card form */}
                {messageType === 'CONTACT' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-foreground/90 mb-1">Contact Name *</label>
                      <input
                        type="text" value={contactName} onChange={e => setContactName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/90 mb-1">Phone Number *</label>
                      <input
                        type="text" value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                        placeholder="+6281234567890"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground/90 mb-1">Email (optional)</label>
                      <input
                        type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                        placeholder="john@example.com"
                        className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground focus:ring-2 focus:ring-primary/50 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}

                {/* Status */}
                {status && (() => {
                  const isSuccess = /^(Message scheduled|Message sent|Template ).*/.test(status);
                  const isError = /^(Please |Failed|Upload failed).*/.test(status);
                  const StatusIcon = isSuccess ? CheckCircle2 : isError ? AlertCircle : Loader2;
                  const cls = isSuccess
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : isError
                      ? 'bg-destructive/10 text-destructive border-destructive/30'
                      : 'bg-sky-500/10 text-sky-300 border-sky-500/30';
                  return (
                    <div
                      role="status"
                      aria-live="polite"
                      className={`flex items-start gap-2 p-3 rounded-xl text-sm border ${cls}`}
                    >
                      <StatusIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${!isSuccess && !isError ? 'mw-spin' : ''}`} aria-hidden="true" />
                      <span>{status}</span>
                    </div>
                  );
                })()}

                {/* Simulate Typing Toggle */}
                <div className="flex items-center justify-between p-3 bg-secondary/40 border border-border/60 rounded-xl">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Simulate Typing</p>
                      <p className="text-xs text-muted-foreground">Show typing indicator before sending</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={simulateTyping}
                    aria-label="Toggle simulate typing"
                    onClick={() => setSimulateTyping(!simulateTyping)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background ${simulateTyping ? 'bg-primary' : 'bg-secondary'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${simulateTyping ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Typing Duration Slider (visible when typing is enabled) */}
                {simulateTyping && (
                  <div className="p-3 bg-secondary/40 border border-border/60 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duration</span>
                      <span className="text-sm font-medium text-foreground tabular-nums">{typingDuration}s</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={typingDuration}
                      onChange={(e) => setTypingDuration(Number(e.target.value))}
                      className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                      aria-label="Typing duration in seconds"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                      <span>1s</span>
                      <span>5s</span>
                      <span>10s</span>
                    </div>
                  </div>
                )}

                {/* Schedule Picker */}
                {showSchedulePicker && (
                  <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-xl space-y-2">
                    <label className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-300">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      Schedule for:
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduleDateTime}
                      onChange={e => setScheduleDateTime(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-sky-500/30 bg-card text-foreground focus:ring-2 focus:ring-sky-500/50"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleScheduleMessage}
                        disabled={scheduling || !scheduleDateTime || !recipient || (messageType === 'TEXT' ? !textContent : false)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        {scheduling ? 'Scheduling...' : 'Schedule'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); }}
                        className="px-3 py-2 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground rounded-lg cursor-pointer transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Send & Schedule Buttons */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={sending || uploading || scheduling || !recipient || (
                      messageType === 'TEXT' ? !textContent :
                      messageType === 'LOCATION' ? (!latitude || !longitude) :
                      messageType === 'POLL' ? (!pollQuestion || pollOptions.filter(o => o.trim()).length < 2) :
                      messageType === 'CONTACT' ? (!contactName || !contactPhone) :
                      ((!useFileUpload && !mediaUrl) || (useFileUpload && !selectedFile))
                    )}
                    className="flex-1 px-4 py-3 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background"
                  >
                    {sending || uploading ? (
                      <>
                        <Loader2 className="mw-spin w-5 h-5" aria-hidden="true" />
                        {uploading ? 'Uploading...' : 'Sending...'}
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" aria-hidden="true" />
                        Send {messageTypes.find(t => t.value === messageType)?.label}
                      </>
                    )}
                  </button>
                  {messageType === 'TEXT' && (
                    <button
                      type="button"
                      onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                      disabled={sending || uploading || scheduling}
                      aria-label={showSchedulePicker ? 'Hide schedule picker' : 'Schedule message'}
                      aria-expanded={showSchedulePicker}
                      className={`px-4 py-3 font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/50 ${
                        showSchedulePicker
                          ? 'bg-sky-600 text-white'
                          : 'bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25'
                      }`}
                    >
                      <Clock className="w-5 h-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Messages */}
          <div className="lg:col-span-1">
            <div className="bg-card rounded-2xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="font-semibold text-foreground">Recent Sent</h3>
              </div>
              <div className="p-4">
                {sentMessages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No messages sent yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {sentMessages.map((msg, idx) => {
                      const entry = messageTypes.find(t => t.value === msg.type);
                      const Icon = entry?.Icon ?? Send;
                      return (
                        <div key={idx} className="p-3 bg-secondary/40 border border-border/60 rounded-xl">
                          <div className="flex items-center gap-2 text-sm">
                            <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden="true" />
                            <span className="font-medium text-foreground truncate">{msg.to}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                            {msg.type} · {msg.time.toLocaleTimeString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Tips */}
            <div className="mt-4 bg-sky-500/10 border border-sky-500/20 rounded-2xl p-4">
              <h4 className="inline-flex items-center gap-1.5 font-medium text-sky-300 mb-2">
                <FileUp className="w-4 h-4" aria-hidden="true" />
                File Upload
              </h4>
              <ul className="text-sm text-sky-200/80 space-y-1">
                <li>• <strong className="text-sky-200">Image:</strong> Max 5MB (JPG, PNG)</li>
                <li>• <strong className="text-sky-200">Video:</strong> Max 16MB (MP4)</li>
                <li>• <strong className="text-sky-200">Audio:</strong> Max 5MB (MP3)</li>
                <li>• <strong className="text-sky-200">Document:</strong> Max 10MB (PDF, DOC)</li>
              </ul>
              <p className="text-xs text-sky-200/70 mt-2">
                Files uploaded to S3 storage
              </p>
            </div>
          </div>
        </div>
      )}
    </div>

      {/* Template Picker Modal */}
      {showTemplatePicker && selectedProfile && (
        <TemplatePicker
          profileId={selectedProfile}
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplatePicker(false)}
          variables={{
            name: selectedRecipientName || '',
            phone: recipient || '',
          }}
        />
      )}
    </>
  );
}