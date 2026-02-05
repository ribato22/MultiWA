// MultiWA Admin - WhatsApp-style Chat Interface
// apps/admin/src/app/dashboard/chat/page.tsx

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, Profile, Conversation } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

// Message interface
interface Message {
  id: string;
  messageId?: string; // WhatsApp serialized message ID
  conversationId: string;
  content: any;
  type: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  timestamp: string;
  senderName?: string;
}

// Format phone number for display
const formatPhone = (phone: string) => {
  if (!phone) return '';
  const cleaned = phone.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@c.us', '');
  if (cleaned.startsWith('62')) {
    return `+${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)}-${cleaned.slice(5, 9)}-${cleaned.slice(9)}`;
  }
  return cleaned;
};

// Fix media URLs that use Docker-internal hostname
const fixMediaUrl = (url?: string): string => {
  if (!url) return '';
  // Replace Docker-internal minio hostname with localhost
  return url.replace(/http:\/\/minio:9000/g, 'http://localhost:9000');
};

// Check if a name looks like a raw JID (e.g. "120363421805328930@g.us" or "6282283011108@s.whatsapp.net" or all digits)
const isJidLikeName = (name: string) => {
  if (!name) return true;
  const trimmed = name.trim();
  // Check for full JID pattern
  if (trimmed.includes('@s.whatsapp.net') || trimmed.includes('@g.us') || trimmed.includes('@c.us')) return true;
  // Check for all-digit string
  return /^[0-9]+$/.test(trimmed);
};

// Get best display name for a conversation
const getDisplayName = (conv: any) => {
  // If contactName from backend is available, always prefer it
  if (conv.contactName) return conv.contactName;
  // If name exists and doesn't look like a raw JID, use it (e.g. actual group names synced from WA)
  if (conv.name && !isJidLikeName(conv.name)) return conv.name;
  // For groups, show "Group Chat" since we don't have the group name yet
  if (conv.type === 'group' || conv.jid?.includes('@g.us')) {
    return 'Group Chat';
  }
  // Fallback to formatted phone number for individual chats
  return formatPhone(conv.jid || conv.contactPhone || '') || conv.name || 'Unknown';
};

// Format timestamp
const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// Message status icon
const MessageStatus = ({ status }: { status: string }) => {
  switch (status) {
    case 'pending':
      return <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2"/></svg>;
    case 'sent':
      return <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>;
    case 'delivered':
      return (
        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 13l4 4L16 7" /><path d="M8 13l4 4L22 7" />
        </svg>
      );
    case 'read':
      return (
        <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 13l4 4L16 7" /><path d="M8 13l4 4L22 7" />
        </svg>
      );
    case 'failed':
      return <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    default:
      return null;
  }
};

export default function ChatPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showThreeDotMenu, setShowThreeDotMenu] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState('smileys');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const socketRef = useRef<Socket | null>(null);

  // Emoji categories
  const emojiCategories: Record<string, { label: string; emojis: string[] }> = {
    smileys: { label: '😊', emojis: ['😊', '😂', '🤣', '😍', '🥰', '😘', '😜', '🤔', '😎', '🥳', '😴', '🤯', '😱', '😇', '🫡', '🙄'] },
    gestures: { label: '👍', emojis: ['👍', '👎', '👏', '🙌', '🤝', '💪', '🤞', '✌️', '🤟', '👋', '🫶', '🙏', '✋', '🤙', '👊', '🤘'] },
    hearts: { label: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💕', '💖', '💗', '💝', '💘', '❣️', '💔', '🫀'] },
    objects: { label: '🎉', emojis: ['🎉', '🎊', '🏆', '🎯', '🎵', '📱', '💻', '📸', '🔑', '💡', '📌', '📎', '✏️', '📝', '📋', '📊'] },
    symbols: { label: '✅', emojis: ['✅', '❌', '⭐', '🔥', '💯', '⚡', '💫', '🌟', '✨', '🎯', '🚀', '💎', '🏅', '🎗️', '🔔', '📢'] },
    nature: { label: '🌿', emojis: ['🌿', '🌸', '🌺', '🌻', '🌼', '🍀', '🌙', '☀️', '🌈', '🔥', '💧', '⛄', '🌊', '🌴', '🍁', '🌾'] },
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  // WebSocket connection for real-time message status updates
  useEffect(() => {
    if (!selectedProfile) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333';
    const socket = io(`${apiUrl}/ws`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected, joining profile:', selectedProfile);
      socket.emit('join', { profileId: selectedProfile });
    });

    socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
    });

    socket.on('reconnect', (attempt) => {
      console.log('[WS] Reconnected after', attempt, 'attempts');
      socket.emit('join', { profileId: selectedProfile });
    });

    // Real-time message status updates (sent → delivered → read)
    socket.on('message:ack', (data: { profileId: string; messageId: string; status: string }) => {
      console.log('[WS] message:ack received:', data);
      if (data.profileId === selectedProfile) {
        setMessages(prev => prev.map(msg => {
          // Match by WhatsApp messageId (primary match)
          if (msg.messageId && msg.messageId === data.messageId) {
            return { ...msg, status: data.status as Message['status'] };
          }
          return msg;
        }));
      }
    });

    // Real-time incoming messages
    // Backend emits: { type: 'message:received', message: savedMessage, conversation }
    socket.on('message', (data: any) => {
      console.log('[WS] message received:', data);
      const msg = data.message || data;
      const msgProfileId = msg.profileId || data.profileId;
      const msgDirection = msg.direction || data.direction;
      
      if (msgProfileId === selectedProfile && msgDirection === 'incoming') {
        setMessages(prev => {
          // Avoid duplicates
          if (prev.some(m => m.id === msg.id || (m.messageId && msg.messageId && m.messageId === msg.messageId))) return prev;
          return [...prev, msg as Message];
        });
        // Refresh conversations to update last message
        loadConversations().then(() => {
          // If this message belongs to the currently open conversation, 
          // mark it as read immediately so badge doesn't increment
          setSelectedConversation(current => {
            if (current && msg.conversationId === current.id) {
              api.markAsRead(current.id).catch(() => {});
              // Also clear badge in conversation list
              setConversations(prev => prev.map(c =>
                c.id === current.id ? { ...c, unreadCount: 0 } : c
              ));
            }
            return current;
          });
        });
      }
    });

    return () => {
      socket.emit('unsubscribe:profile', { profileId: selectedProfile });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [selectedProfile]);

  useEffect(() => {
    if (selectedProfile) {
      loadConversations();
    }
  }, [selectedProfile]);

  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
      // Mark as read when opening a conversation
      if (selectedConversation.unreadCount > 0) {
        api.markAsRead(selectedConversation.id).catch(() => {});
        // Clear unread badge in local state
        setConversations(prev => prev.map(c =>
          c.id === selectedConversation.id ? { ...c, unreadCount: 0 } : c
        ));
        setSelectedConversation(prev => prev ? { ...prev, unreadCount: 0 } : prev);
      }
    }
  }, [selectedConversation?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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

  const loadConversations = async () => {
    const res = await api.getConversations(selectedProfile);
    if (res.data) {
      const rawConvs = res.data.conversations || [];
      // Filter out status@broadcast (WhatsApp broadcast status updates)
      const filteredConvs = rawConvs.filter((conv: Conversation) => 
        !conv.jid?.includes('status@broadcast') && !conv.jid?.includes('@broadcast')
      );
      // Deduplicate by normalized JID (strip @c.us / @s.whatsapp.net / @g.us suffixes)
      // This handles legacy @c.us vs current @s.whatsapp.net for the same phone number
      const normalizeJid = (jid: string) => jid?.replace(/@(s\.whatsapp\.net|c\.us|g\.us)$/, '') || jid;
      const jidMap = new Map<string, Conversation>();
      for (const conv of filteredConvs) {
        const key = normalizeJid(conv.jid);
        const existing = jidMap.get(key);
        if (!existing) {
          jidMap.set(key, conv);
        } else {
          // Keep the one with the most recent lastMessageAt, sum unreadCounts
          const existingTime = new Date(existing.lastMessageAt || 0).getTime();
          const newTime = new Date(conv.lastMessageAt || 0).getTime();
          if (newTime > existingTime) {
            jidMap.set(key, { ...conv, unreadCount: conv.unreadCount + existing.unreadCount });
          } else {
            jidMap.set(key, { ...existing, unreadCount: existing.unreadCount + conv.unreadCount });
          }
        }
      }
      setConversations(Array.from(jidMap.values()));
    }
  };

  const loadMessages = async (conversationId: string) => {
    const res = await api.getMessages(conversationId);
    if (res.data) {
      // API returns { messages: [...], hasMore } or possibly an array
      const raw = res.data as any;
      const msgArray = Array.isArray(raw) ? raw : (raw.messages || []);
      setMessages(msgArray);
    }
  };

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedConversation || sending) return;

    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      conversationId: selectedConversation.id,
      content: { text: messageInput },
      type: 'text',
      direction: 'outgoing',
      status: 'pending',
      timestamp: new Date().toISOString(),
    };

    // Optimistic update
    setMessages(prev => [...prev, tempMessage]);
    const messageText = messageInput;
    setMessageInput('');

    try {
      // Send typing indicator before the message (non-blocking)
      api.sendTyping({
        profileId: selectedProfile,
        to: selectedConversation.jid,
        duration: 2000,
      }).catch(() => {}); // fire-and-forget

      // Wait a short moment for typing to appear, then send
      await new Promise(resolve => setTimeout(resolve, 1500));

      const res = await api.sendMessage({
        profileId: selectedProfile,
        to: selectedConversation.jid,
        text: messageText,
      });

      if (res.data) {
        // Update message with real data including WhatsApp messageId for ack matching
        setMessages(prev => prev.map(m => 
          m.id === tempId ? { ...m, id: res.data.messageId || tempId, messageId: res.data.waMessageId, status: 'sent' } : m
        ));
      } else {
        setMessages(prev => prev.map(m => 
          m.id === tempId ? { ...m, status: 'failed' } : m
        ));
        toast({ title: 'Failed to send message', variant: 'destructive' });
      }
    } catch (error) {
      setMessages(prev => prev.map(m => 
        m.id === tempId ? { ...m, status: 'failed' } : m
      ));
      toast({ title: 'Failed to send message', variant: 'destructive' });
    }
    setSending(false);
  };

  // Handle file attachment upload and send
  const handleFileUpload = async (file: File) => {
    if (!selectedConversation || !selectedProfile) return;

    const mimeType = file.type;
    let msgType = 'document';
    if (mimeType.startsWith('image/')) msgType = 'image';
    else if (mimeType.startsWith('video/')) msgType = 'video';
    else if (mimeType.startsWith('audio/')) msgType = 'audio';

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const tempMessage: Message = {
      id: tempId,
      conversationId: selectedConversation.id,
      content: { text: `📎 Sending ${file.name}...`, filename: file.name },
      type: msgType,
      direction: 'outgoing',
      status: 'pending',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMessage]);

    try {
      // 1. Upload file to get URL
      const uploadRes = await api.uploadMedia(file);
      const mediaUrl = uploadRes.data?.url;
      if (!mediaUrl) throw new Error('Upload failed - no URL returned');

      // 2. Send message using appropriate endpoint
      const to = selectedConversation.jid;
      let res: any;
      switch (msgType) {
        case 'image':
          res = await api.sendImageMessage({ profileId: selectedProfile, to, url: mediaUrl, mimetype: mimeType });
          break;
        case 'video':
          res = await api.sendVideoMessage({ profileId: selectedProfile, to, url: mediaUrl, mimetype: mimeType });
          break;
        case 'audio':
          res = await api.sendAudioMessage({ profileId: selectedProfile, to, url: mediaUrl, mimetype: mimeType });
          break;
        default:
          res = await api.sendDocumentMessage({ profileId: selectedProfile, to, url: mediaUrl, filename: file.name, mimetype: mimeType });
          break;
      }

      if (res.data) {
        setMessages(prev => prev.map(m =>
          m.id === tempId ? { ...m, id: res.data.id, status: 'sent', content: { ...m.content, url: mediaUrl, text: undefined } } : m
        ));
        toast({ title: `${msgType.charAt(0).toUpperCase() + msgType.slice(1)} sent` });
      } else {
        throw new Error('Send failed');
      }
    } catch (error) {
      setMessages(prev => prev.map(m =>
        m.id === tempId ? { ...m, status: 'failed', content: { text: `❌ Failed to send ${file.name}` } } : m
      ));
      toast({ title: `Failed to send ${file.name}`, variant: 'destructive' });
    }
  };

  // Clear chat messages (persistent — calls backend API)
  const handleClearChat = async () => {
    if (!selectedConversation) return;
    if (!window.confirm('Are you sure you want to clear this chat? This action cannot be undone.')) return;
    try {
      await api.clearConversationMessages(selectedConversation.id);
      setMessages([]);
      toast({ title: 'Chat cleared' });
    } catch (error) {
      toast({ title: 'Failed to clear chat', variant: 'destructive' });
    }
  };

  // Toggle mute (persistent)
  const handleToggleMute = async () => {
    if (!selectedConversation) return;
    try {
      const res = await api.muteConversation(selectedConversation.id);
      if (res.data) {
        const meta = (selectedConversation as any).metadata || {};
        const updated = { ...selectedConversation, metadata: { ...meta, isMuted: res.data.isMuted } };
        setSelectedConversation(updated as any);
        setConversations(prev => prev.map(c => c.id === selectedConversation.id ? updated as any : c));
        toast({ title: res.data.isMuted ? 'Notifications muted' : 'Notifications unmuted' });
      }
    } catch (error) {
      toast({ title: 'Failed to toggle mute', variant: 'destructive' });
    }
  };

  // Toggle pin (persistent)
  const handleTogglePin = async () => {
    if (!selectedConversation) return;
    try {
      const res = await api.pinConversation(selectedConversation.id);
      if (res.data) {
        const meta = (selectedConversation as any).metadata || {};
        const updated = { ...selectedConversation, metadata: { ...meta, isPinned: res.data.isPinned } };
        setSelectedConversation(updated as any);
        setConversations(prev => prev.map(c => c.id === selectedConversation.id ? updated as any : c));
        toast({ title: res.data.isPinned ? 'Chat pinned' : 'Chat unpinned' });
      }
    } catch (error) {
      toast({ title: 'Failed to toggle pin', variant: 'destructive' });
    }
  };
  const insertEmoji = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };

  // Filter and sort conversations (pinned first)
  const filteredConversations = conversations
    .filter(conv => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        conv.name?.toLowerCase().includes(query) ||
        conv.contactName?.toLowerCase().includes(query) ||
        conv.jid?.toLowerCase().includes(query) ||
        conv.contactId?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      const aPinned = (a as any).metadata?.isPinned ? 1 : 0;
      const bPinned = (b as any).metadata?.isPinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return 0; // keep original order for un-pinned
    });

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  };

  // Handle delete message
  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedProfile || !selectedConversation) return;
    setDeletingMessageId(messageId);
    try {
      const res = await api.deleteForEveryone(selectedProfile, selectedConversation.jid, messageId);
      if (res.data?.success) {
        setMessages(prev => prev.filter(m => (m.messageId || m.id) !== messageId));
        toast({ title: 'Message Deleted', description: 'Message has been deleted' });
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to delete message', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to delete message', variant: 'destructive' });
    }
    setDeletingMessageId(null);
    setShowDeleteConfirm(null);
  };

  // Handle schedule message
  const handleScheduleMessage = async () => {
    if (!messageInput.trim() || !scheduleDateTime || !selectedProfile || !selectedConversation) return;
    setScheduling(true);
    try {
      const scheduledAt = new Date(scheduleDateTime).toISOString();
      const res = await api.scheduleMessage(selectedProfile, selectedConversation.jid, 'text', messageInput.trim(), scheduledAt);
      if (res.data) {
        // Add scheduled message to chat display immediately
        const scheduledMsg: Message = {
          id: res.data.id || `scheduled-${Date.now()}`,
          conversationId: selectedConversation.id,
          content: messageInput.trim(),
          type: 'text',
          direction: 'outgoing',
          status: 'pending',
          timestamp: scheduledAt,
          senderName: 'You (Scheduled)',
        };
        setMessages(prev => [...prev, scheduledMsg]);
        
        toast({ title: '⏰ Message Scheduled', description: `Will be sent on ${new Date(scheduleDateTime).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}` });
        setMessageInput('');
        setScheduleDateTime('');
        setShowSchedulePicker(false);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to schedule message', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to schedule message', variant: 'destructive' });
    }
    setScheduling(false);
  };

  // Render loading skeleton
  if (loading) {
    return (
      <div className="h-[calc(100vh-120px)] flex">
        <div className="w-96 border-r border-border p-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          {[1, 2, 3, 4, 5].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] flex bg-card rounded-2xl border border-border overflow-hidden">
      {/* Conversation Sidebar */}
      <div className="w-96 border-r border-border flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border bg-secondary/30">
          <Select value={selectedProfile} onValueChange={setSelectedProfile}>
            <SelectTrigger className="w-full mb-3">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map(profile => (
                <SelectItem key={profile.id} value={profile.id}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${profile.status === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {profile.displayName || profile.name || 'Unnamed'}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              placeholder="Search or start new chat"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-sm text-muted-foreground">No conversations yet</p>
            </div>
          ) : (
            filteredConversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => setSelectedConversation(conv)}
                className={`flex items-center gap-3 p-4 cursor-pointer hover:bg-secondary/50 transition-colors border-b border-border ${
                  selectedConversation?.id === conv.id ? 'bg-secondary' : ''
                }`}
              >
                <Avatar className="w-12 h-12">
                  <AvatarImage src={conv.avatar} />
                  <AvatarFallback className="bg-[#25D366] text-white">
                    {getInitials(getDisplayName(conv))}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground truncate flex items-center gap-1">
                      {(conv as any).metadata?.isPinned && <span className="text-xs">📌</span>}
                      {getDisplayName(conv)}
                      {(conv as any).metadata?.isMuted && <span className="text-xs opacity-60">🔇</span>}
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      {conv.lastMessageAt ? formatTime(conv.lastMessageAt) : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-sm text-muted-foreground truncate flex-1">
                      {conv.lastMessage
                        ? conv.lastMessage.content?.text
                          || conv.lastMessage.content?.caption
                          || (conv.lastMessage.type === 'image' ? '🖼️ Image'
                            : conv.lastMessage.type === 'video' ? '🎥 Video'
                            : conv.lastMessage.type === 'audio' ? '🎵 Audio'
                            : conv.lastMessage.type === 'document' ? '📄 Document'
                            : conv.lastMessage.type === 'location' ? `📍 ${conv.lastMessage.content?.name || 'Location'}`
                            : conv.lastMessage.type === 'vcard' || conv.lastMessage.type === 'contact' ? '👤 Contact'
                            : conv.lastMessage.type === 'sticker' ? '🏷️ Sticker'
                            : conv.lastMessage.type === 'poll' ? '📊 Poll'
                            : conv.lastMessage.type === 'ptt' ? '🎙️ Voice message'
                            : '💬 Message')
                        : 'No messages'}
                    </p>
                    {conv.unreadCount > 0 && (
                      <Badge className="bg-[#25D366] text-white text-xs ml-2">
                        {conv.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedConversation ? (
          <>
            {/* Chat Header */}
            <div className="p-4 border-b border-border bg-secondary/30 flex items-center gap-4">
              <Avatar className="w-10 h-10">
                <AvatarImage src={selectedConversation.avatar} />
                <AvatarFallback className="bg-[#25D366] text-white">
                  {getInitials(getDisplayName(selectedConversation))}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">
                  {getDisplayName(selectedConversation)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {formatPhone(selectedConversation.jid || selectedConversation.contactId)}
                </p>
              </div>
              <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setShowThreeDotMenu(!showThreeDotMenu)}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </Button>
                {showThreeDotMenu && (
                  <div className="absolute right-0 top-10 bg-card border border-border rounded-xl shadow-lg py-1 z-20 w-48">
                    <button onClick={() => { setShowThreeDotMenu(false); setShowContactInfo(!showContactInfo); }} className="w-full px-4 py-2.5 text-sm text-left hover:bg-secondary flex items-center gap-3">
                      <span>👤</span> Contact Info
                    </button>
                    <button onClick={() => { setShowThreeDotMenu(false); handleToggleMute(); }} className="w-full px-4 py-2.5 text-sm text-left hover:bg-secondary flex items-center gap-3">
                      <span>{(selectedConversation as any)?.metadata?.isMuted ? '🔔' : '🔇'}</span>
                      {(selectedConversation as any)?.metadata?.isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                    </button>
                    <button onClick={() => { setShowThreeDotMenu(false); handleTogglePin(); }} className="w-full px-4 py-2.5 text-sm text-left hover:bg-secondary flex items-center gap-3">
                      <span>📌</span>
                      {(selectedConversation as any)?.metadata?.isPinned ? 'Unpin Chat' : 'Pin Chat'}
                    </button>
                    <hr className="my-1 border-border" />
                    <button onClick={() => { setShowThreeDotMenu(false); handleClearChat(); }} className="w-full px-4 py-2.5 text-sm text-left hover:bg-secondary text-red-500 flex items-center gap-3">
                      <span>🗑️</span> Clear Chat
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Messages Area */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-3"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'0.03\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}
            >
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🔐</div>
                    <p className="text-muted-foreground">Messages are end-to-end encrypted</p>
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div
                    key={`${msg.id}-${idx}`}
                    className={`flex group ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* Delete button for outgoing messages (appears on hover) */}
                    {msg.direction === 'outgoing' && (
                      <div className="flex items-center mr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {showDeleteConfirm === (msg.messageId || msg.id) ? (
                          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-border p-1">
                            <button
                              onClick={() => handleDeleteMessage(msg.messageId || msg.id)}
                              disabled={deletingMessageId === (msg.messageId || msg.id)}
                              className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            >
                              {deletingMessageId === (msg.messageId || msg.id) ? '...' : 'Delete'}
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(null)}
                              className="text-xs px-2 py-1 text-muted-foreground hover:bg-secondary rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowDeleteConfirm(msg.messageId || msg.id)}
                            className="p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors"
                            title="Delete message"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2 overflow-hidden ${
                        msg.direction === 'outgoing'
                          ? 'bg-[#DCF8C6] dark:bg-[#005C4B] text-foreground rounded-br-sm'
                          : 'bg-white dark:bg-gray-800 text-foreground rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {/* Message Content */}
                      {msg.type === 'text' && (
                        <p className="whitespace-pre-wrap break-words">{msg.content?.text}</p>
                      )}
                      {msg.type === 'image' && (
                        <div>
                          {msg.content?.url ? (
                            <>
                              <img 
                                src={fixMediaUrl(msg.content.url)} 
                                alt="Image" 
                                className="rounded-lg max-w-full max-h-64 object-cover cursor-pointer"
                                onClick={() => window.open(fixMediaUrl(msg.content?.url), '_blank')}
                              />
                              {msg.content?.caption && (
                                <p className="mt-2 text-sm">{msg.content.caption}</p>
                              )}
                            </>
                          ) : (
                            <div className="bg-secondary/30 rounded-lg p-4 flex items-center gap-3 min-w-[200px]">
                              <span className="text-3xl">📷</span>
                              <div>
                                <p className="text-sm font-medium">Photo</p>
                                <p className="text-xs text-muted-foreground">Image not available</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {msg.type === 'video' && (
                        <div>
                          <video 
                            src={fixMediaUrl(msg.content?.url)} 
                            controls
                            className="rounded-lg max-w-full max-h-64"
                          />
                          {msg.content?.caption && (
                            <p className="mt-2 text-sm">{msg.content.caption}</p>
                          )}
                        </div>
                      )}
                      {msg.type === 'audio' && (
                        <div className="min-w-[200px]">
                          <audio src={fixMediaUrl(msg.content?.url)} controls className="w-full" />
                        </div>
                      )}
                      {msg.type === 'document' && (
                        <div>
                          <a 
                            href={fixMediaUrl(msg.content?.url)} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 bg-secondary/50 rounded-lg p-3 hover:bg-secondary/70 transition-colors cursor-pointer no-underline text-inherit max-w-[300px] overflow-hidden"
                          >
                            <div className="text-3xl">📄</div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{msg.content?.filename || 'Document'}</p>
                              <p className="text-xs text-muted-foreground">Document</p>
                            </div>
                            <div className="text-muted-foreground">⬇️</div>
                          </a>
                          {(msg.content?.caption || msg.content?.text) && (
                            <p className="mt-2 text-sm">{msg.content.caption || msg.content.text}</p>
                          )}
                        </div>
                      )}
                      {msg.type === 'location' && (
                        <a
                          href={`https://www.google.com/maps?q=${msg.content?.latitude || 0},${msg.content?.longitude || 0}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <div className="bg-secondary/50 rounded-lg p-3 hover:bg-secondary/70 transition-colors">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-2xl">📍</span>
                              <span className="font-medium">{msg.content?.name || msg.content?.description || 'Location'}</span>
                            </div>
                            {msg.content?.address && (
                              <p className="text-xs text-muted-foreground ml-9">{msg.content.address}</p>
                            )}
                            {msg.content?.latitude && msg.content?.longitude && (
                              <p className="text-xs text-muted-foreground ml-9">{msg.content.latitude.toFixed(6)}, {msg.content.longitude.toFixed(6)}</p>
                            )}
                            <p className="text-xs text-blue-500 mt-1 ml-9">Open in Google Maps →</p>
                          </div>
                        </a>
                      )}
                      {(msg.type === 'vcard' || msg.type === 'contact' || msg.type === 'contacts') && (() => {
                        // Parse vCard for contact info (handles both pre-parsed and raw vCard)
                        let displayName = msg.content?.displayName || msg.content?.name || '';
                        let phone = msg.content?.phone || '';
                        const vcardStr = msg.content?.vcard || msg.content?.text || '';
                        if (!displayName && vcardStr) {
                          const fnMatch = vcardStr.match(/FN:(.*)/i);
                          if (fnMatch) displayName = fnMatch[1].trim();
                        }
                        if (!phone && vcardStr) {
                          const telMatch = vcardStr.match(/TEL[^:]*:([\d+\-\s]+)/i);
                          if (telMatch) phone = telMatch[1].trim();
                        }
                        return (
                          <div className="bg-secondary/50 rounded-lg p-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xl">👤</div>
                              <div>
                                <p className="font-medium">{displayName || 'Contact'}</p>
                                {phone && <p className="text-xs text-muted-foreground">{phone}</p>}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      {(msg.type === 'poll' || msg.type === 'poll_creation') && (
                        <div className="bg-secondary/50 rounded-lg p-3 min-w-[220px]">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">📊</span>
                            <p className="font-medium">{msg.content?.pollName || msg.content?.question || msg.content?.text || 'Poll'}</p>
                          </div>
                          {msg.content?.allowMultipleAnswers === false && (
                            <p className="text-xs text-muted-foreground ml-7 mb-2">Select one</p>
                          )}
                          {msg.content?.allowMultipleAnswers === true && (
                            <p className="text-xs text-muted-foreground ml-7 mb-2">Select multiple</p>
                          )}
                          {(msg.content?.pollOptions || msg.content?.options || []).map((opt: any, i: number) => (
                            <div key={i} className="ml-7 py-1.5 text-sm flex items-center gap-2 border-b border-border/30 last:border-0">
                              <span className="w-5 h-5 rounded-full border-2 border-muted-foreground/40 flex items-center justify-center text-[10px] shrink-0"></span>
                              <span>{typeof opt === 'string' ? opt : opt?.name || opt?.optionName || JSON.stringify(opt)}</span>
                              <span className="ml-auto text-xs text-muted-foreground">0</span>
                            </div>
                          ))}
                          {(msg.content?.pollOptions || msg.content?.options || []).length === 0 && !msg.content?.pollName && !msg.content?.question && (
                            <p className="text-sm text-muted-foreground ml-7">{msg.content?.text || 'No poll data'}</p>
                          )}
                        </div>
                      )}
                      {(msg.type === 'event' || msg.type === 'event_creation') && (
                        <div className="bg-secondary/50 rounded-lg p-3 min-w-[220px]">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-lg">📅</span>
                            <p className="font-medium">{msg.content?.eventName || msg.content?.text || 'Event'}</p>
                          </div>
                          {msg.content?.eventStartTime && (
                            <div className="ml-7 flex items-center gap-2 text-sm text-muted-foreground mb-1">
                              <span>🕐</span>
                              <span>{new Date(msg.content.eventStartTime * 1000).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                              {msg.content?.eventEndTime && (
                                <span>– {new Date(msg.content.eventEndTime * 1000).toLocaleString('id-ID', { timeStyle: 'short' })}</span>
                              )}
                            </div>
                          )}
                          {msg.content?.eventLocation && (
                            <div className="ml-7 flex items-center gap-2 text-sm text-muted-foreground mb-1">
                              <span>📍</span>
                              <span>{msg.content.eventLocation}</span>
                            </div>
                          )}
                          {msg.content?.eventDescription && (
                            <p className="ml-7 text-sm text-muted-foreground mt-1">{msg.content.eventDescription}</p>
                          )}
                        </div>
                      )}
                      {msg.type === 'sticker' && (
                        <div className="w-32 h-32 flex items-center justify-center">
                          {msg.content?.url ? (
                            <img src={fixMediaUrl(msg.content.url)} alt="Sticker" className="max-w-full max-h-full object-contain" />
                          ) : (
                            <div className="text-6xl">🏷️</div>
                          )}
                        </div>
                      )}
                      {/* Fallback for unknown types */}
                      {!['text', 'image', 'video', 'audio', 'document', 'location', 'vcard', 'contact', 'contacts', 'poll', 'poll_creation', 'event', 'event_creation', 'sticker', 'chat'].includes(msg.type) && (
                        <div className="bg-secondary/50 rounded-lg p-3 text-sm">
                          <p className="text-muted-foreground italic">📎 {msg.type} message</p>
                          {msg.content?.text && <p className="mt-1">{msg.content.text}</p>}
                        </div>
                      )}

                      {/* Timestamp and Status */}
                      <div className={`flex items-center gap-1 mt-1 ${msg.direction === 'outgoing' ? 'justify-end' : ''}`}>
                        <span className="text-xs text-muted-foreground">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.direction === 'outgoing' && <MessageStatus status={msg.status} />}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 border-t border-border bg-secondary/30">
              <div className="flex items-center gap-3">
                {/* Emoji Button */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <span className="text-xl">😊</span>
                  </Button>
                  
                  {showEmojiPicker && (
                    <div className="absolute bottom-12 left-0 bg-card border border-border rounded-2xl shadow-xl z-20 w-[320px]">
                      {/* Category tabs */}
                      <div className="flex gap-1 p-2 border-b border-border">
                        {Object.entries(emojiCategories).map(([key, cat]) => (
                          <button
                            key={key}
                            onClick={() => setEmojiCategory(key)}
                            className={`p-1.5 rounded-lg text-lg transition-colors ${
                              emojiCategory === key ? 'bg-secondary' : 'hover:bg-secondary/50'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                      {/* Emoji grid */}
                      <div className="p-2 max-h-[200px] overflow-y-auto">
                        <div className="grid grid-cols-8 gap-0.5">
                          {emojiCategories[emojiCategory].emojis.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => insertEmoji(emoji)}
                              className="text-xl w-9 h-9 flex items-center justify-center hover:bg-secondary rounded-lg transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Attachment Button */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => { setShowAttachMenu(!showAttachMenu); setShowEmojiPicker(false); }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </Button>
                  {showAttachMenu && (
                    <div className="absolute bottom-12 left-0 bg-card border border-border rounded-2xl shadow-xl z-20 p-3 w-56">
                      <p className="text-xs text-muted-foreground mb-2 font-medium">Attach file</p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { icon: '📷', label: 'Camera', accept: 'image/*', capture: true },
                          { icon: '🖼️', label: 'Image', accept: 'image/*' },
                          { icon: '🎥', label: 'Video', accept: 'video/*' },
                          { icon: '📄', label: 'Document', accept: '.pdf,.doc,.docx,.xls,.xlsx' },
                          { icon: '🎵', label: 'Audio', accept: 'audio/*' },
                          { icon: '👤', label: 'Contact' },
                        ].map(item => (
                          <button
                            key={item.label}
                            onClick={() => {
                              setShowAttachMenu(false);
                              if (item.accept && attachRef.current) {
                                attachRef.current.accept = item.accept;
                                attachRef.current.click();
                              }
                            }}
                            className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-secondary transition-colors"
                          >
                            <span className="text-xl">{item.icon}</span>
                            <span className="text-xs text-muted-foreground">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <input ref={attachRef} type="file" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }} />
                </div>

                {/* Input */}
                <Input
                  ref={inputRef}
                  value={messageInput}
                  onChange={e => {
                    setMessageInput(e.target.value);
                    // Send real-time typing indicator (debounced, max once per 3s)
                    if (selectedConversation && selectedProfile && e.target.value) {
                      const now = Date.now();
                      if (now - lastTypingSentRef.current > 3000) {
                        lastTypingSentRef.current = now;
                        api.sendTyping({ profileId: selectedProfile, to: selectedConversation.jid }).catch(() => {});
                      }
                    }
                  }}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  placeholder="Type a message"
                  className="flex-1"
                />

                {/* Schedule Button */}
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!messageInput.trim()}
                    onClick={() => { setShowSchedulePicker(!showSchedulePicker); setShowEmojiPicker(false); setShowAttachMenu(false); }}
                    className="text-muted-foreground hover:text-foreground"
                    title="Schedule message"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                    </svg>
                  </Button>
                  {showSchedulePicker && (
                    <div className="absolute bottom-12 right-0 bg-card border border-border rounded-2xl shadow-xl z-20 p-4 w-72">
                      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                        Schedule Message
                      </h4>
                      <input
                        type="datetime-local"
                        value={scheduleDateTime}
                        onChange={e => setScheduleDateTime(e.target.value)}
                        min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-secondary/30 text-sm text-foreground mb-3 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!scheduleDateTime || scheduling}
                          onClick={handleScheduleMessage}
                          className="flex-1 bg-[#25D366] hover:bg-[#128C7E] text-white text-xs"
                        >
                          {scheduling ? 'Scheduling...' : '⏰ Schedule'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setShowSchedulePicker(false); setScheduleDateTime(''); }}
                          className="text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Send Button */}
                <Button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sending}
                  className="bg-[#25D366] hover:bg-[#128C7E]"
                  size="sm"
                >
                  {sending ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* No Conversation Selected */
          <div className="flex-1 flex items-center justify-center bg-secondary/10">
            <div className="text-center">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-secondary/50 flex items-center justify-center">
                <svg className="w-12 h-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">MultiWA Chat</h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Select a conversation from the sidebar to view messages and start chatting
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Contact Info Sidebar */}
      {showContactInfo && selectedConversation && (
        <div className="w-80 border-l border-border flex flex-col bg-card">
          {/* Header */}
          <div className="p-4 border-b border-border bg-secondary/30 flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Contact Info</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowContactInfo(false)}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </Button>
          </div>

          {/* Profile Card */}
          <div className="p-6 text-center border-b border-border">
            <Avatar className="w-20 h-20 mx-auto mb-3">
              <AvatarImage src={(selectedConversation as any).avatar} />
              <AvatarFallback className="bg-[#25D366] text-white text-2xl">
                {getInitials(getDisplayName(selectedConversation))}
              </AvatarFallback>
            </Avatar>
            <h4 className="font-semibold text-lg text-foreground">
              {getDisplayName(selectedConversation)}
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              {formatPhone(selectedConversation.jid || '')}
            </p>
            <Badge className="mt-2" variant="outline">
              {selectedConversation.type === 'group' ? '👥 Group' : '👤 Personal'}
            </Badge>
          </div>

          {/* Details */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Phone */}
            <div className="bg-secondary/30 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">📱 Phone</p>
              <p className="text-sm font-medium text-foreground">
                {formatPhone(selectedConversation.jid || '')}
              </p>
            </div>

            {/* JID */}
            <div className="bg-secondary/30 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">🔗 WhatsApp ID</p>
              <p className="text-xs font-mono text-foreground break-all">
                {selectedConversation.jid}
              </p>
            </div>

            {/* Messages Count */}
            <div className="bg-secondary/30 rounded-xl p-3">
              <p className="text-xs text-muted-foreground mb-1">💬 Messages</p>
              <p className="text-sm font-medium text-foreground">
                {messages.length} messages in this conversation
              </p>
            </div>

            {/* First & Last Message */}
            {messages.length > 0 && (
              <div className="bg-secondary/30 rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">📅 Activity</p>
                <div className="space-y-1">
                  <p className="text-xs text-foreground">
                    <span className="text-muted-foreground">First: </span>
                    {new Date(messages[0]?.timestamp || '').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-foreground">
                    <span className="text-muted-foreground">Last: </span>
                    {new Date(messages[messages.length - 1]?.timestamp || '').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
            )}

            {/* Tags */}
            {(selectedConversation as any).contact?.tags?.length > 0 && (
              <div className="bg-secondary/30 rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-2">🏷️ Tags</p>
                <div className="flex flex-wrap gap-1">
                  {(selectedConversation as any).contact.tags.map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="pt-2 space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-sm"
                onClick={() => window.open(`/dashboard/contacts?phone=${encodeURIComponent(selectedConversation?.jid?.split('@')[0] || '')}`, '_self')}
              >
                👤 View in Contacts
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
