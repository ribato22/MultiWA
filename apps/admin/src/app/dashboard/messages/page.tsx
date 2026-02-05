// MultiWA Admin - Messages with File Upload Support
// apps/admin/src/app/dashboard/messages/page.tsx

'use client';

import { useState, useEffect, useRef } from 'react';
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

const messageTypes: { value: MessageType; label: string; icon: string }[] = [
  { value: 'TEXT', label: 'Text', icon: '💬' },
  { value: 'IMAGE', label: 'Image', icon: '🖼️' },
  { value: 'VIDEO', label: 'Video', icon: '🎥' },
  { value: 'AUDIO', label: 'Audio', icon: '🎵' },
  { value: 'DOCUMENT', label: 'Document', icon: '📄' },
  { value: 'LOCATION', label: 'Location', icon: '📍' },
  { value: 'POLL', label: 'Poll', icon: '📊' },
  { value: 'CONTACT', label: 'Contact', icon: '👤' },
];

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
    setStatus(`✅ Template "${template.name}" applied`);
  };

  const handleScheduleMessage = async () => {
    if (!selectedProfile || !recipient || !scheduleDateTime) {
      setStatus('❌ Please select profile, recipient, and schedule time');
      return;
    }
    if (messageType === 'TEXT' && !textContent) {
      setStatus('❌ Please enter message text');
      return;
    }
    // Format recipient
    let formattedRecipient = recipient.replace(/\s+/g, '').replace(/-/g, '');
    if (!formattedRecipient.includes('@')) {
      formattedRecipient = formattedRecipient.replace(/^0/, '62') + '@s.whatsapp.net';
    }
    setScheduling(true);
    setStatus('⏰ Scheduling message...');
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
        setStatus(`✅ Message scheduled for ${formattedTime}`);
        setTextContent('');
        setScheduleDateTime('');
        setShowSchedulePicker(false);
        setSentMessages(prev => [{ to: selectedRecipientName || recipient, type: `${messageType} (Scheduled)`, time: new Date() }, ...prev.slice(0, 4)]);
      } else {
        setStatus(`❌ Failed to schedule: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      setStatus('❌ Failed to schedule message');
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
      setStatus(`❌ Upload failed: ${error.message}`);
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
      setStatus('❌ Please select profile and enter recipient');
      return;
    }

    if (messageType === 'TEXT' && !textContent) {
      setStatus('❌ Please enter message text');
      return;
    }

    if (messageType === 'LOCATION' && (!latitude || !longitude)) {
      setStatus('❌ Please enter latitude and longitude');
      return;
    }

    if (messageType === 'POLL') {
      if (!pollQuestion) { setStatus('❌ Please enter a poll question'); return; }
      const validOptions = pollOptions.filter(o => o.trim());
      if (validOptions.length < 2) { setStatus('❌ Poll needs at least 2 options'); return; }
    }

    if (messageType === 'CONTACT' && (!contactName || !contactPhone)) {
      setStatus('❌ Please enter contact name and phone'); return;
    }

    if (['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(messageType)) {
      if (useFileUpload && !selectedFile) {
        setStatus('❌ Please select a file to upload');
        return;
      }
      if (!useFileUpload && !mediaUrl) {
        setStatus('❌ Please enter media URL');
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
        setStatus('⌨️ Simulating typing...');
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
        setStatus('📤 Uploading file...');
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
        setStatus('✅ Message sent successfully!');
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
        setStatus(`❌ Failed: ${result.error?.message || result.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to send:', error);
      setStatus('❌ Failed to send message');
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
          <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-48 mb-4"></div>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-100 dark:border-gray-800">
            <div className="h-40 bg-gray-200 dark:bg-gray-800 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Send WhatsApp messages with file upload support</p>
      </div>

      {profiles.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-12 border border-gray-100 dark:border-gray-800 text-center">
          <div className="text-6xl mb-4">📱</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Connected Profiles</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">Connect a WhatsApp profile first</p>
          <a href="/dashboard/profiles/new" className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors">
            Add Profile
          </a>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Send Message Form */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-r from-emerald-500 to-green-600">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send Message
                </h2>
              </div>
              
              <div className="p-6 space-y-5">
                {/* Profile Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">From Profile</label>
                  <select
                    value={selectedProfile}
                    onChange={(e) => setSelectedProfile(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Recipient</label>
                  
                  {/* Recipient Mode Tabs */}
                  <div className="flex gap-1 mb-2">
                    <button
                      onClick={() => { setRecipientMode('manual'); setSelectedRecipientName(''); }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                        recipientMode === 'manual'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      ✏️ Manual
                    </button>
                    <button
                      onClick={() => setRecipientMode('contact')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                        recipientMode === 'contact'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      👤 Contact ({contacts.length})
                    </button>
                    <button
                      onClick={() => setRecipientMode('group')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                        recipientMode === 'group'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                      }`}
                    >
                      👥 Group ({groups.length})
                    </button>
                  </div>

                  {/* Manual Input */}
                  {recipientMode === 'manual' && (
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="628xxxxxxxxxx"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  )}

                  {/* Contact Picker */}
                  {recipientMode === 'contact' && (
                    <div className="space-y-2">
                      {selectedRecipientName ? (
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                          <span className="flex-1 text-emerald-700 dark:text-emerald-300">
                            👤 {selectedRecipientName}
                          </span>
                          <button
                            onClick={() => { setRecipient(''); setSelectedRecipientName(''); }}
                            className="text-emerald-600 hover:text-emerald-800 text-sm"
                          >
                            ✕ Clear
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={recipientSearch}
                            onChange={(e) => setRecipientSearch(e.target.value)}
                            placeholder="Search contacts..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                          />
                          <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl">
                            {loadingRecipients ? (
                              <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                            ) : filteredContacts.length === 0 ? (
                              <div className="p-4 text-center text-gray-500 text-sm">
                                {contacts.length === 0 ? 'No contacts saved yet' : 'No contacts match'}
                              </div>
                            ) : (
                              filteredContacts.map((contact) => (
                                <button
                                  key={contact.id}
                                  onClick={() => selectContact(contact)}
                                  className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 border-b last:border-0 border-gray-100 dark:border-gray-800 transition-colors"
                                >
                                  <div className="font-medium text-gray-900 dark:text-white text-sm">{contact.name}</div>
                                  <div className="text-xs text-gray-500">{contact.phone}</div>
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
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                          <span className="flex-1 text-blue-700 dark:text-blue-300">
                            👥 {selectedRecipientName}
                          </span>
                          <button
                            onClick={() => { setRecipient(''); setSelectedRecipientName(''); }}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            ✕ Clear
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={recipientSearch}
                            onChange={(e) => setRecipientSearch(e.target.value)}
                            placeholder="Search groups..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
                          />
                          <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl">
                            {loadingRecipients ? (
                              <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                            ) : filteredGroups.length === 0 ? (
                              <div className="p-4 text-center text-gray-500 text-sm">
                                {groups.length === 0 ? 'No groups found' : 'No groups match'}
                              </div>
                            ) : (
                              filteredGroups.map((group) => (
                                <button
                                  key={group.id}
                                  onClick={() => selectGroup(group)}
                                  className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 border-b last:border-0 border-gray-100 dark:border-gray-800 transition-colors"
                                >
                                  <div className="font-medium text-gray-900 dark:text-white text-sm">{group.name}</div>
                                  {group.participantCount && (
                                    <div className="text-xs text-gray-500">{group.participantCount} participants</div>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Message Type</label>
                  <div className="flex flex-wrap gap-2">
                    {messageTypes.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => {
                          setMessageType(type.value);
                          setSelectedFile(null);
                          setMediaUrl('');
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className={`px-4 py-2 rounded-xl font-medium text-sm transition-all flex items-center gap-2 ${
                          messageType === type.value
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span>{type.icon}</span>
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content based on type */}
                {messageType === 'TEXT' ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Message</label>
                      {selectedProfile && (
                        <button
                          onClick={() => setShowTemplatePicker(true)}
                          className="px-3 py-1 rounded-lg text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors flex items-center gap-1"
                        >
                          📋 Use Template
                        </button>
                      )}
                    </div>
                    <textarea
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      rows={4}
                      placeholder="Type your message here..."
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                    />
                  </div>
                ) : ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(messageType) ? (
                  <div className="space-y-4">
                    {/* Toggle URL / Upload */}
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => setUseFileUpload(false)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          !useFileUpload
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        🔗 URL
                      </button>
                      <button
                        onClick={() => setUseFileUpload(true)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          useFileUpload
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        📁 Upload File
                      </button>
                    </div>

                    {!useFileUpload ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          {messageType} URL
                        </label>
                        <input
                          type="url"
                          value={mediaUrl}
                          onChange={(e) => setMediaUrl(e.target.value)}
                          placeholder="https://example.com/file.jpg"
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Select File
                        </label>
                        <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center hover:border-emerald-500 transition-colors">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={getAcceptTypes()}
                            onChange={handleFileSelect}
                            className="hidden"
                            id="fileUpload"
                          />
                          <label htmlFor="fileUpload" className="cursor-pointer">
                            {selectedFile ? (
                              <div className="flex items-center justify-center gap-3">
                                <span className="text-4xl">
                                  {messageType === 'IMAGE' ? '🖼️' : messageType === 'VIDEO' ? '🎥' : messageType === 'AUDIO' ? '🎵' : '📄'}
                                </span>
                                <div className="text-left">
                                  <p className="font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
                                  <p className="text-sm text-gray-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="text-4xl mb-2">📤</div>
                                <p className="text-gray-600 dark:text-gray-400">Click to select a file</p>
                                <p className="text-xs text-gray-400 mt-1">or drag and drop</p>
                              </>
                            )}
                          </label>
                        </div>
                        {uploading && (
                          <div className="mt-3">
                            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-emerald-500 transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-500 mt-1 text-center">Uploading... {uploadProgress}%</p>
                          </div>
                        )}
                      </div>
                    )}

                    {messageType === 'DOCUMENT' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Filename</label>
                        <input
                          type="text"
                          value={fileName}
                          onChange={(e) => setFileName(e.target.value)}
                          placeholder="document.pdf"
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </div>
                    )}

                    {(messageType === 'IMAGE' || messageType === 'VIDEO' || messageType === 'DOCUMENT') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Caption (optional)</label>
                        <input
                          type="text"
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          placeholder="Add a caption..."
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Location form */}
                {messageType === 'LOCATION' && (
                  <div className="space-y-4">
                    {/* Coordinate inputs with map preview hint */}
                    <div className="bg-gradient-to-br from-blue-50 to-emerald-50 dark:from-blue-900/20 dark:to-emerald-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">📍</span>
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">Coordinates</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Latitude *</label>
                          <input
                            type="number" step="any" value={latitude} onChange={e => setLatitude(e.target.value)}
                            placeholder="-6.2088"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Longitude *</label>
                          <input
                            type="number" step="any" value={longitude} onChange={e => setLongitude(e.target.value)}
                            placeholder="106.8456"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
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
                        className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                      >
                        📱 Use current location
                      </button>
                    </div>
                    {/* Location details */}
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Location Name (optional)</label>
                        <input
                          type="text" value={locationName} onChange={e => setLocationName(e.target.value)}
                          placeholder="e.g. Head Office"
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Address (optional)</label>
                        <input
                          type="text" value={locationAddress} onChange={e => setLocationAddress(e.target.value)}
                          placeholder="Jl. Example No. 123, Jakarta"
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Poll form */}
                {messageType === 'POLL' && (
                  <div className="space-y-4">
                    {/* Poll question */}
                    <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl p-4 border border-purple-100 dark:border-purple-800">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">📊</span>
                        <h4 className="font-medium text-gray-900 dark:text-white text-sm">Poll Question</h4>
                      </div>
                      <input
                        type="text" value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
                        placeholder="What is your favorite color?"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                      />
                    </div>
                    {/* Poll options */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Options *</label>
                        <span className="text-xs text-gray-400">{pollOptions.filter(o => o.trim()).length}/12</span>
                      </div>
                      <div className="space-y-2">
                        {pollOptions.map((opt, i) => (
                          <div key={i} className="flex gap-2 items-center">
                            <span className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xs font-medium flex-shrink-0">{i + 1}</span>
                            <input
                              type="text" value={opt}
                              onChange={e => { const n = [...pollOptions]; n[i] = e.target.value; setPollOptions(n); }}
                              placeholder={`Option ${i + 1}`}
                              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                            />
                            {pollOptions.length > 2 && (
                              <button onClick={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                                className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-500 hover:bg-red-200 text-sm flex items-center justify-center flex-shrink-0">✕</button>
                            )}
                          </div>
                        ))}
                        {pollOptions.length < 12 && (
                          <button onClick={() => setPollOptions([...pollOptions, ''])}
                            className="w-full px-4 py-2.5 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 hover:border-purple-500 hover:text-purple-500 transition-colors text-sm flex items-center justify-center gap-1">
                            <span>+</span> Add Option
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Multiple answers toggle */}
                    <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300 cursor-pointer bg-gray-50 dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700">
                      <input type="checkbox" checked={allowMultipleAnswers} onChange={e => setAllowMultipleAnswers(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-purple-500 focus:ring-purple-500" />
                      <div>
                        <p className="font-medium">Allow multiple answers</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Recipients can select more than one option</p>
                      </div>
                    </label>
                  </div>
                )}

                {/* Contact card form */}
                {messageType === 'CONTACT' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact Name *</label>
                      <input
                        type="text" value={contactName} onChange={e => setContactName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number *</label>
                      <input
                        type="text" value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                        placeholder="+6281234567890"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email (optional)</label>
                      <input
                        type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                        placeholder="john@example.com"
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                )}

                {/* Status */}
                {status && (
                  <div className={`p-3 rounded-xl text-sm ${
                    status.includes('✅') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    status.includes('❌') ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                    {status}
                  </div>
                )}

                {/* Simulate Typing Toggle */}
                <div className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⌨️</span>
                    <div>
                      <p className="text-sm font-medium">Simulate Typing</p>
                      <p className="text-xs text-muted-foreground">Show typing indicator before sending</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSimulateTyping(!simulateTyping)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${simulateTyping ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${simulateTyping ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Typing Duration Slider (visible when typing is enabled) */}
                {simulateTyping && (
                  <div className="p-3 bg-secondary/30 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duration</span>
                      <span className="text-sm font-medium text-foreground">{typingDuration}s</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={typingDuration}
                      onChange={(e) => setTypingDuration(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1s</span>
                      <span>5s</span>
                      <span>10s</span>
                    </div>
                  </div>
                )}

                {/* Schedule Picker */}
                {showSchedulePicker && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2">
                    <label className="text-sm font-medium text-blue-700 dark:text-blue-300">⏰ Schedule for:</label>
                    <input
                      type="datetime-local"
                      value={scheduleDateTime}
                      onChange={e => setScheduleDateTime(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-blue-200 dark:border-blue-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleScheduleMessage}
                        disabled={scheduling || !scheduleDateTime || !recipient || (messageType === 'TEXT' ? !textContent : false)}
                        className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        {scheduling ? 'Scheduling...' : '⏰ Schedule'}
                      </button>
                      <button
                        onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); }}
                        className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Send & Schedule Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={sendMessage}
                    disabled={sending || uploading || scheduling || !recipient || (
                      messageType === 'TEXT' ? !textContent :
                      messageType === 'LOCATION' ? (!latitude || !longitude) :
                      messageType === 'POLL' ? (!pollQuestion || pollOptions.filter(o => o.trim()).length < 2) :
                      messageType === 'CONTACT' ? (!contactName || !contactPhone) :
                      ((!useFileUpload && !mediaUrl) || (useFileUpload && !selectedFile))
                    )}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {sending || uploading ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {uploading ? 'Uploading...' : 'Sending...'}
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </svg>
                        Send {messageTypes.find(t => t.value === messageType)?.label}
                      </>
                    )}
                  </button>
                  {messageType === 'TEXT' && (
                    <button
                      onClick={() => setShowSchedulePicker(!showSchedulePicker)}
                      disabled={sending || uploading || scheduling}
                      className={`px-4 py-3 font-medium rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
                        showSchedulePicker
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                      }`}
                      title="Schedule message"
                    >
                      ⏰
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Recent Messages */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white">Recent Sent</h3>
              </div>
              <div className="p-4">
                {sentMessages.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                    No messages sent yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {sentMessages.map((msg, idx) => (
                      <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                        <div className="flex items-center gap-2 text-sm">
                          <span>{messageTypes.find(t => t.value === msg.type)?.icon || '📨'}</span>
                          <span className="font-medium text-gray-900 dark:text-white">{msg.to}</span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {msg.type} • {msg.time.toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tips */}
            <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-4">
              <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">💡 File Upload</h4>
              <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
                <li>• <strong>Image:</strong> Max 5MB (JPG, PNG)</li>
                <li>• <strong>Video:</strong> Max 16MB (MP4)</li>
                <li>• <strong>Audio:</strong> Max 5MB (MP3)</li>
                <li>• <strong>Document:</strong> Max 10MB (PDF, DOC)</li>
              </ul>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">
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
