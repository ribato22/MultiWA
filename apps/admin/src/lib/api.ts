// MultiWA - API Client
// apps/admin/src/lib/api.ts

// Use relative path - Next.js rewrite will proxy /api/* to backend API
const API_BASE = '/api/v1';

// The API's own limit on an announcement upload (its multipart `fileSize`), in bytes.
export const ANNOUNCEMENT_MAX_BYTES = 2 * 1024 * 1024;

// How long a token refresh may take before it is given up. Long enough not to abort a slow refresh the server may
// have carried out: this browser would keep the refresh token it rotated, and the next refresh, read as reuse, would
// sign out every tab. A refresh given up for a request outside /auth/ signs out, and the tabs waiting on the lock then
// have no refresh token to send. One given up for an /auth/ request (api.me()) does not sign out: each waiting tab
// then sends the same refresh token in turn, and on a dead connection each waits its own minute.
const REFRESH_TIMEOUT_MS = 60_000;

// Types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  status: number;
  /** The body of a failed request (a 409's `reasons`, for one); null when it was not JSON. */
  body?: any;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  /** From `/auth/me` and the sign-in answer's `user`: the owner of the server's oldest organization, who alone sets storage and SMTP. */
  isServerOwner?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  displayName?: string;  // Added: displayName from database schema
  phone?: string;
  status: 'connected' | 'disconnected' | 'connecting';
  workspaceId: string;
  sessionData?: {
    jid?: string;
    name?: string;
    avatar?: string;
  };
  messageCount?: number;
  settings?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  profiles: {
    total: number;
    connected: number;
  };
  messages: {
    total: number;
    today: number;
  };
  contacts: {
    total: number;
  };
  broadcasts: {
    total: number;
  };
}

export interface Contact {
  id: string;
  profileId: string;
  phone: string;
  name?: string;
  email?: string;
  avatar?: string;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface Template {
  id: string;
  profileId: string;
  name: string;
  category?: string;
  messageType: string;
  content: any;
  variables?: string[];
  usageCount: number;
  createdAt: string;
}

export interface Automation {
  id: string;
  profileId: string;
  name: string;
  isActive: boolean;
  triggerType: string;
  triggerConfig: any;
  actions: any[];
  stats?: {
    todayCount: number;
    triggerCount: number;
    lastTriggered?: string;
  };
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

export interface Webhook {
  id: string;
  profileId: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  profileId: string;
  jid: string;
  contactId: string;
  contactName?: string;
  avatar?: string;
  name: string;
  type: 'user' | 'group';
  unreadCount: number;
  lastMessage?: {
    content: any;
    timestamp: string;
    status: string;
    type?: string;
    direction?: string;
  };
  lastMessageAt: string;
}

export type CallOutcome = 'ringing' | 'answered' | 'missed' | 'rejected' | 'answered_elsewhere' | 'unknown';
export type CallFollowUp = 'open' | 'in_progress' | 'done';
export type CallEndReason = 'hangup' | 'caller_hangup' | 'agent_lost' | 'media_failed' | 'time_limit' | 'server_restart';

/** A call's recording facts: every role sees them; owner and admin play, download and delete. */
export interface CallRecording {
  id: string;
  /** audio/webm, or video/webm for a call answered with video; an older API sends none (sound). */
  mimeType?: string;
  durationSec: number;
  bytes: number;
  /** The server stopped before the call ended: the file holds the call up to then. */
  partial: boolean;
  announcementPlayed: boolean;
  createdAt: string;
  deletedAt: string | null;
  /** 'admin' or 'retention' today; a newer API can send another (the column is plain text). */
  deleteReason: string | null;
}

export interface CallRecord {
  id: string;
  profileId: string;
  waCallId: string;
  fromJid: string;
  isVideo: boolean;
  isGroup: boolean;
  direction: string;
  outcome: CallOutcome;
  rejectedBy: string | null;
  startedAt: string;
  endedAt: string | null;
  followUp: CallFollowUp;
  assignedUserId: string | null;
  conversationId: string | null;
  answeredByUserId: string | null;
  answeredAt: string | null;
  endedBy: 'agent' | 'caller' | 'server' | null;
  endReason: CallEndReason | null;
  talkSeconds: number | null;
  assignedUser: { id: string; name: string } | null;
  answeredBy: { id: string; name: string } | null;
  conversation: { id: string; name: string | null } | null;
  recording: CallRecording | null;
}

export interface CallsAnnouncement {
  mimeType: string;
  durationSec: number;
}

/** A profile's calls settings, as `PUT /profiles/:id/calls-settings` answers them. */
export interface CallsSettings {
  profileId: string;
  answerInDashboard: boolean;
  recording: boolean;
  retentionDays: number;
  announcement: CallsAnnouncement | null;
}

/** `GET /calls/media/status` (owner and admin): the server's readiness, and each profile's settings and readiness. */
export interface CallsMediaStatus {
  server: {
    enabled: boolean;
    worker: 'up' | 'down';
    port: number | null;
    engineHost: 'api' | 'worker';
    activeSessions: number;
    recordings: {
      storage: 'local' | 's3';
      configured: boolean;
      problem: string | null;
      lastCheck: { at: string; ok: boolean; reason?: string } | null;
    };
  };
  profiles: Array<CallsSettings & { name: string; ready: boolean; reasons: string[] }>;
}

// Result of POST /notifications/push/test — the endpoint returns per-endpoint
// diagnostics (results[].error) alongside the summary, so these are optional.
export interface PushTestResult {
  success: boolean;
  sent?: number;
  message: string;
  error?: string;
  results?: Array<{ success?: boolean; error?: string; statusCode?: number }>;
}

// Customers: an ID of the organization's own system (an ID Pelanggan, say), linked to WhatsApp numbers. MultiWA keeps
// the links, notes and tags; the organization's lookup endpoint answers the rest live, in a fixed format.
export type LookupState = 'ok' | 'not_found' | 'unavailable' | 'not_configured';
export interface LookupField { label: string; value: string }
export interface LookupSection { title: string; rows: LookupField[] }
export interface LookupData { id?: string; name?: string; fields: LookupField[]; sections: LookupSection[] }
export interface LookupResult { state: LookupState; data: LookupData | null; fetchedAt: string; cached: boolean }
export interface LookupTestResult extends LookupResult { latencyMs: number }

/** Who made a link or wrote a note: a user, or a system through an API key. */
export interface ActorView { type: 'user' | 'apiKey'; id: string; name: string }
export interface CustomerLinkView { id: string; phone: string; lastUsedAt: string; createdAt: string; linkedBy: ActorView | null }
export interface CustomerNoteView { id: string; body: string; createdAt: string; updatedAt: string; author: ActorView | null }
export interface CustomerView {
  id: string; externalId: string; displayName: string | null; tags: string[]; manualFields: LookupField[];
  lastLookupAt: string | null; createdAt: string; updatedAt: string;
  links: CustomerLinkView[];
  /** The 20 newest, newest first. */
  notes: CustomerNoteView[];
}
export interface CustomerListItem {
  id: string; externalId: string; displayName: string | null; linkCount: number; noteCount: number; lastActivityAt: string | null;
}
export interface CustomerListPage { items: CustomerListItem[]; total: number; page: number; pageSize: number }
/** A customer linked to a number: the number's default comes first. */
export interface CustomerByPhoneItem { id: string; externalId: string; displayName: string | null; linkId: string; lastUsedAt: string }
export interface CustomerHistoryItem {
  kind: 'conversation' | 'call'; id: string; profileId: string; profileName: string; phone: string; at: string; summary: string;
}
/** The organization's customer settings: whether there is a secret, never the secret. */
export interface CustomerConfigView { idLabel: string; lookupUrl: string | null; hasSecret: boolean; timeoutMs: number; configured: boolean }
export interface LinkResult { created: boolean; customer: CustomerView; link: CustomerLinkView }

/** A failed request's message. A validation 400 lists every rule the request broke: one line, for a toast. */
function errorOf(data: any, status: number): string {
  const message = data?.message || data?.error;
  return (Array.isArray(message) ? message.join('; ') : message) || `Request failed with status ${status}`;
}

// API Client Class
class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('accessToken');
  }

  private getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refreshToken');
  }

  /** `sent`: the token the request that got the 401 carried. */
  private async tryRefreshToken(sent: string | null): Promise<boolean> {
    // A refresh token works once: the API reads a second use as theft and revokes the login, in every tab. A 401 that
    // comes back after a refresh since its request left (a slow link) retries with that token, never refreshes again.
    const stored = this.getToken();
    if (stored && stored !== sent) return true;
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    // The browser's tabs refresh one at a time (a Web Lock, in a secure context), and one that waited while another
    // refreshed takes that token instead of refreshing again.
    const refresh = async () => {
      const now = this.getToken();
      if (now && now !== sent) return true;
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;

      const res = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        // Every tab's refresh waits on this one: one that hangs is given up (see REFRESH_TIMEOUT_MS). An optional call:
        // an older Safari has no AbortSignal.timeout, and its TypeError would sign every 401 out.
        signal: AbortSignal.timeout?.(REFRESH_TIMEOUT_MS),
      });

      if (!res.ok) return false;

      const data = await res.json();
      const tokens = data.data || data;
      if (tokens.accessToken) {
        localStorage.setItem('accessToken', tokens.accessToken);
        if (tokens.refreshToken) localStorage.setItem('refreshToken', tokens.refreshToken);
        return true;
      }
      return false;
    };
    this.refreshPromise = (async () => {
      try {
        const locks = globalThis.navigator?.locks;
        return await (locks ? locks.request('multiwa-token-refresh', refresh) : refresh());
      } catch {
        return false;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /** fetch() with the Bearer header, for JSON and bytes alike: a 401 refreshes the token once, and a failed refresh signs out. */
  private async send(endpoint: string, options: RequestInit = {}, _isRetry = false): Promise<Response> {
    const token = this.getToken();

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: HeadersInit = {
      // Only set Content-Type for JSON bodies, not FormData (browser auto-sets multipart boundary)
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    };

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    // Auto-refresh on 401 (skip for auth endpoints and retries)
    if (response.status === 401 && !_isRetry && !endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/refresh')) {
      const refreshed = await this.tryRefreshToken(token);
      if (refreshed) {
        return this.send(endpoint, options, true);
      }
      // Refresh failed — redirect to login
      if (typeof window !== 'undefined' && !endpoint.startsWith('/auth/')) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/auth/login';
      }
    }

    return response;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const response = await this.send(endpoint, options);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        return {
          error: errorOf(data, response.status),
          status: response.status,
          body: data,
        };
      }

      return {
        data,
        status: response.status,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Network error',
        status: 0,
      };
    }
  }

  /** A route that answers bytes (a recording, an announcement), on the same auth path as request(); `signal` gives it up. */
  async fetchBlob(endpoint: string, signal?: AbortSignal): Promise<{ blob?: Blob; error?: string; status: number }> {
    try {
      const response = await this.send(endpoint, { signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        return { error: errorOf(data, response.status), status: response.status };
      }
      return { blob: await response.blob(), status: response.status };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Network error', status: 0 };
    }
  }

  // Auth
  async login(email: string, password: string) {
    return this.request<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) }
    );
  }

  async register(data: { email: string; password: string; name: string; organizationName: string }) {
    return this.request<{ accessToken: string; refreshToken: string; user: User }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(data) }
    );
  }

  async me() {
    return this.request<User>('/auth/me');
  }

  /** Public: whether the server takes new accounts (it closes after its first user, unless it allows more). */
  async registration() {
    return this.request<{ open: boolean }>('/auth/registration');
  }

  // Dashboard
  async getDashboardStats(organizationId: string) {
    return this.request<DashboardStats>(`/statistics/dashboard?organizationId=${organizationId}`);
  }

  // Statistics
  async getMessageTrend(profileId: string, options?: { granularity?: string; startDate?: string; endDate?: string }) {
    const params = new URLSearchParams({ profileId });
    if (options?.granularity) params.set('granularity', options.granularity);
    if (options?.startDate) params.set('startDate', options.startDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    return this.request<{ period: string; incoming: number; outgoing: number }[]>(`/statistics/messages/trend?${params.toString()}`);
  }

  async getContactStats(profileId: string) {
    return this.request<{ total: number; withTags: number; withoutTags: number; recentlyActive: number; growth: { date: string; count: number }[] }>(`/statistics/contacts?profileId=${profileId}`);
  }

  // Profiles
  async getProfiles() {
    return this.request<Profile[]>('/profiles');
  }

  async getProfile(id: string) {
    return this.request<Profile>(`/profiles/${id}`);
  }

  async createProfile(data: { name: string; workspaceId: string }) {
    return this.request<Profile>('/profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async connectProfile(id: string) {
    return this.request<{ qrCode?: string; status: string }>(`/profiles/${id}/connect`, {
      method: 'POST',
    });
  }

  async disconnectProfile(id: string) {
    return this.request<void>(`/profiles/${id}/disconnect`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async deleteProfile(id: string) {
    return this.request<void>(`/profiles/${id}`, {
      method: 'DELETE',
    });
  }

  // Workspaces
  async getWorkspaces() {
    return this.request<{ id: string; name: string; slug: string }[]>('/workspaces');
  }

  // Contacts
  async getContacts(
    profileId: string,
    opts?: { search?: string; tags?: string; limit?: number; offset?: number },
  ) {
    const p = new URLSearchParams({
      profileId,
      limit: String(opts?.limit ?? 50),
      offset: String(opts?.offset ?? 0),
    });
    if (opts?.search) p.set('search', opts.search);
    if (opts?.tags) p.set('tags', opts.tags);
    return this.request<{ contacts: Contact[]; total: number; limit: number; offset: number }>(
      `/contacts?${p.toString()}`,
    );
  }

  async createContact(data: { profileId: string; phone: string; name?: string; email?: string; tags?: string[]; notes?: string }) {
    // Backend DTO accepts: profileId, phone, name, tags, metadata
    // email and notes go into metadata since they're not in the Contact schema
    const { email, notes, ...rest } = data;
    const payload: any = { ...rest };
    if (email || notes) {
      payload.metadata = { ...(email ? { email } : {}), ...(notes ? { notes } : {}) };
    }
    return this.request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async deleteContact(id: string) {
    return this.request<void>(`/contacts/${id}`, {
      method: 'DELETE',
    });
  }

  async syncContactsFromWhatsApp(profileId: string) {
    return this.request<{ success: boolean; message: string; synced: number; created: number; updated: number; errors: string[] }>(
      `/contacts/sync/whatsapp?profileId=${profileId}`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  // Templates
  async getTemplates(profileId: string) {
    return this.request<Template[]>(`/templates?profileId=${profileId}`);
  }

  async createTemplate(data: { profileId: string; name: string; messageType: string; content: any; category?: string }) {
    return this.request<Template>('/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTemplate(id: string, data: { name?: string; category?: string; content?: any }) {
    return this.request<Template>(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTemplate(id: string) {
    return this.request<void>(`/templates/${id}`, {
      method: 'DELETE',
    });
  }

  async duplicateTemplate(id: string, newName: string) {
    return this.request<Template>(`/templates/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    });
  }

  // Automation
  async getAutomations(profileId: string) {
    return this.request<Automation[]>(`/automation?profileId=${profileId}`);
  }

  async createAutomation(data: any) {
    return this.request<Automation>('/automation', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAutomation(id: string, data: any) {
    return this.request<Automation>(`/automation/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAutomation(id: string) {
    return this.request<void>(`/automation/${id}`, {
      method: 'DELETE',
    });
  }

  async toggleAutomation(id: string, isActive: boolean) {
    return this.request<Automation>(`/automation/${id}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ isActive }),
    });
  }

  // API Keys
  async getApiKeys() {
    return this.request<any[]>('/api-keys');
  }

  async createApiKey(data: { name: string; permissions: string[] }) {
    return this.request<{ key: string; id: string }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteApiKey(id: string) {
    return this.request<void>(`/api-keys/${id}`, {
      method: 'DELETE',
    });
  }

  // Webhooks
  async getWebhooks(profileId?: string) {
    const query = profileId ? `?profileId=${profileId}` : '';
    return this.request<Webhook[]>(`/webhooks${query}`);
  }

  async createWebhook(data: { profileId: string; url: string; events: string[] }) {
    return this.request<Webhook>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWebhook(id: string, data: { url?: string; events?: string[]; enabled?: boolean }) {
    return this.request<Webhook>(`/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteWebhook(id: string) {
    return this.request<void>(`/webhooks/${id}`, {
      method: 'DELETE',
    });
  }

  async testWebhook(id: string) {
    return this.request<{ success: boolean; statusCode?: number; message?: string; error?: string }>(`/webhooks/${id}/test`, {
      method: 'POST',
      body: '{}',
    });
  }

  async uploadMedia(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await this.request<{ success: boolean; data: { url: string; key: string; size: number; filename: string; mimeType: string; type: string } }>('/uploads/media', {
      method: 'POST',
      body: formData,
    });
    // Unwrap double nesting: API returns { success, data: { url, ... } }
    // request() wraps as { data: { success, data: { url, ... } } }
    // We want callers to get { data: { url, ... } } directly
    if (res.data?.data) {
      return { data: res.data.data, status: res.status };
    }
    return res as any;
  }

  async getUsers() {
    return this.request<Array<{ id: string; name: string; email: string; role: string; isActive: boolean }>>('/organizations/members');
  }

  async getWebhookLogs(id: string) {
    return this.request<any[]>(`/webhooks/${id}/logs`);
  }

  // Conversations
  async getConversations(profileId: string) {
    return this.request<{ conversations: Conversation[]; total: number }>(
      `/conversations?profileId=${profileId}`
    );
  }

  // One conversation, shaped like a row of the list. The row of the API names the chat in `contact` (the list
  // computes `contactName`) and comes with its messages: one is enough, they can carry inline media.
  async getConversation(id: string) {
    const res = await this.request<Conversation & { contact?: { name: string | null } | null }>(`/conversations/${id}?messageLimit=1`);
    return res.data ? { ...res, data: { ...res.data, contactName: res.data.contact?.name ?? undefined } } : res;
  }

  // Org-wide total unread message count (for the sidebar Chat badge).
  async getChatUnreadCount() {
    return this.request<{ count: number }>('/conversations/unread-count');
  }

  // Calls
  // In `q`, `from` is the caller (a JID or phone number), not a date; the API's date filter is `since`.
  async getCalls(profileId: string, q: { outcome?: CallOutcome; followUp?: CallFollowUp; from?: string; limit?: number; cursor?: string } = {}) {
    const params = new URLSearchParams({ profileId });
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v));
    return this.request<{ calls: CallRecord[]; nextCursor: string | null }>(`/calls?${params}`);
  }

  async getCall(id: string) {
    return this.request<CallRecord>(`/calls/${id}`);
  }

  // Org-wide count of calls still waiting for a follow-up (for the sidebar Calls badge).
  async getCallsOpenCount() {
    return this.request<{ count: number }>('/calls/open-count');
  }

  async updateCall(id: string, data: { followUp?: CallFollowUp; assignedUserId?: string | null }) {
    return this.request<CallRecord>(`/calls/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  async rejectCall(id: string) {
    return this.request<CallRecord>(`/calls/${id}/reject`, { method: 'POST' });
  }

  async replyToCall(id: string, text?: string) {
    return this.request<{ call: CallRecord; message: unknown }>(`/calls/${id}/reply`, { method: 'POST', body: JSON.stringify(text ? { text } : {}) });
  }

  async sendCallLink(id: string, type: 'voice' | 'video', text?: string) {
    return this.request<{ call: CallRecord; message: unknown; link: string }>(`/calls/${id}/call-link`, { method: 'POST', body: JSON.stringify(text ? { type, text } : { type }) });
  }

  // Calls answered in the dashboard: readiness, a profile's settings and announcement, recordings (owner and admin).
  async getCallsMediaStatus() {
    return this.request<CallsMediaStatus>('/calls/media/status');
  }

  async updateCallsSettings(profileId: string, body: { answerInDashboard?: boolean; recording?: boolean; retentionDays?: number }) {
    return this.request<CallsSettings>(`/profiles/${profileId}/calls-settings`, { method: 'PUT', body: JSON.stringify(body) });
  }

  async uploadCallsAnnouncement(profileId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    const res = await this.request<{ profileId: string; announcement: CallsAnnouncement }>(`/profiles/${profileId}/calls-announcement`, {
      method: 'POST',
      body: form,
    });
    if (res.status !== 413 || res.body) return res;
    // A proxy's own size refusal (nginx answers 413 in HTML): only a file past the API's limit is too large; a smaller
    // one met a proxy whose limit is lower. A proxy counts the whole multipart request, so one set to exactly 2 MB still
    // refuses a file a little under 2 MB: 3 MB leaves room.
    const limit = `${ANNOUNCEMENT_MAX_BYTES / (1024 * 1024)} MB`;
    const error = file.size > ANNOUNCEMENT_MAX_BYTES
      ? `The file must be at most ${limit}`
      : 'The server refused a file of this size: ask your administrator to allow uploads of at least 3 MB';
    return { ...res, error };
  }

  fetchCallsAnnouncement(profileId: string, signal?: AbortSignal) {
    return this.fetchBlob(`/profiles/${profileId}/calls-announcement`, signal);
  }

  async deleteCallsAnnouncement(profileId: string) {
    return this.request<{ profileId: string; announcement: null }>(`/profiles/${profileId}/calls-announcement`, { method: 'DELETE' });
  }

  /** The recording's bytes, for a blob: URL: an <audio src> cannot send the Bearer header. Each fetch is audited. */
  fetchCallRecording(callId: string, download = false, signal?: AbortSignal) {
    return this.fetchBlob(`/calls/${callId}/recording${download ? '?download=1' : ''}`, signal);
  }

  async deleteCallRecording(callId: string) {
    return this.request<{ callId: string; recordingId: string; deletedAt: string }>(`/calls/${callId}/recording`, { method: 'DELETE' });
  }

  async getMessages(conversationId: string) {
    return this.request<any[]>(`/messages/conversation/${conversationId}`);
  }

  // On-demand "load older": pulls deeper history from WhatsApp, persists it, and
  // returns the refreshed page { synced, engineReady, messages, hasMore }.
  async loadOlderMessages(conversationId: string, limit: number) {
    return this.request<{ synced: number; engineReady: boolean; messages: any[]; hasMore: boolean }>(
      `/messages/conversation/${conversationId}/load-older?limit=${limit}`
    );
  }

  async muteConversation(conversationId: string) {
    return this.request<{ success: boolean; isMuted: boolean }>(`/conversations/${conversationId}/mute`, { method: 'PUT' });
  }

  async pinConversation(conversationId: string) {
    return this.request<{ success: boolean; isPinned: boolean }>(`/conversations/${conversationId}/pin`, { method: 'PUT' });
  }

  async markAsRead(conversationId: string) {
    return this.request<{ success: boolean }>(`/conversations/${conversationId}/read`, { method: 'PUT' });
  }

  async clearConversationMessages(conversationId: string) {
    return this.request<{ success: boolean }>(`/conversations/${conversationId}/messages`, { method: 'DELETE' });
  }

  // Send Typing Indicator
  async sendTyping(data: { profileId: string; to: string; duration?: number }) {
    return this.request<any>('/messages/typing', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Send Message
  async sendMessage(data: { profileId: string; to: string; text: string }) {
    return this.request<any>('/messages/text', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Send media messages
  async sendImageMessage(data: { profileId: string; to: string; url?: string; base64?: string; caption?: string; mimetype?: string }) {
    return this.request<any>('/messages/image', { method: 'POST', body: JSON.stringify(data) });
  }

  async sendVideoMessage(data: { profileId: string; to: string; url?: string; base64?: string; caption?: string; mimetype?: string }) {
    return this.request<any>('/messages/video', { method: 'POST', body: JSON.stringify(data) });
  }

  async sendAudioMessage(data: { profileId: string; to: string; url?: string; base64?: string; mimetype?: string }) {
    return this.request<any>('/messages/audio', { method: 'POST', body: JSON.stringify(data) });
  }

  async sendDocumentMessage(data: { profileId: string; to: string; url?: string; base64?: string; filename: string; caption?: string; mimetype?: string }) {
    return this.request<any>('/messages/document', { method: 'POST', body: JSON.stringify(data) });
  }

  // Audit Logs
  async getAuditLogs(params: { organizationId?: string; action?: string; resourceType?: string; startDate?: string; endDate?: string; limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') query.set(k, String(v)); });
    return this.request<any>(`/audit/logs?${query.toString()}`);
  }

  async getAuditSummary(organizationId?: string, days?: number) {
    const query = new URLSearchParams();
    if (organizationId) query.set('organizationId', organizationId);
    if (days) query.set('days', String(days));
    return this.request<any>(`/audit/summary?${query.toString()}`);
  }

  // Organization Members
  async getMembers() {
    return this.request<any[]>('/organizations/members');
  }

  async addMember(data: { email: string; name: string; role?: string }) {
    return this.request<any>('/organizations/members', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMemberRole(memberId: string, role: string) {
    return this.request<any>(`/organizations/members/${memberId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  }

  async removeMember(memberId: string) {
    return this.request<any>(`/organizations/members/${memberId}`, {
      method: 'DELETE',
    });
  }

  // ─── Notifications ─────────────────────────────────
  async getNotifications(options?: { unread?: boolean; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (options?.unread) query.set('unread', 'true');
    if (options?.limit) query.set('limit', String(options.limit));
    if (options?.offset) query.set('offset', String(options.offset));
    const qs = query.toString();
    return this.request<{ notifications: Notification[]; total: number }>(`/notifications${qs ? '?' + qs : ''}`);
  }

  async getUnreadCount() {
    return this.request<{ count: number }>('/notifications/unread-count');
  }

  async markNotificationRead(id: string) {
    return this.request<any>(`/notifications/${id}/read`, { method: 'PATCH' });
  }

  async markAllNotificationsRead() {
    return this.request<any>('/notifications/read-all', { method: 'PATCH' });
  }

  async deleteNotification(id: string) {
    return this.request<any>(`/notifications/${id}`, { method: 'DELETE' });
  }

  async clearAllNotifications() {
    return this.request<any>('/notifications', { method: 'DELETE' });
  }

  // ─── Preferences ─────────────────────────────────
  async getPreferences() {
    return this.request<Record<string, any>>('/auth/preferences');
  }

  async updatePreferences(prefs: Record<string, any>) {
    return this.request<any>('/auth/preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    });
  }

  // ─── System Settings ─────────────────────────────
  async getStorageConfig() {
    return this.request<any>('/settings/storage');
  }

  async updateStorageConfig(config: any) {
    return this.request<any>('/settings/storage', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async testStorageConnection(config: any, options?: { createBucket?: boolean }) {
    const qs = options?.createBucket ? '?createBucket=true' : '';
    return this.request<any>(`/settings/storage/test${qs}`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // ─── SMTP Configuration ─────────────────────────────────
  async getSmtpConfig() {
    return this.request<any>('/settings/smtp');
  }

  async updateSmtpConfig(config: any) {
    return this.request<any>('/settings/smtp', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async testSmtpConnection(config: any, options?: { sendTo?: string }) {
    const qs = options?.sendTo ? `?sendTo=${encodeURIComponent(options.sendTo)}` : '';
    return this.request<any>(`/settings/smtp/test${qs}`, {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // ─── Push Notifications ─────────────────────────────────
  async getVapidPublicKey() {
    return this.request<{ publicKey: string }>('/notifications/push/vapid-key');
  }

  async getPushSubscriptions() {
    return this.request<{ subscriptions: any[]; hasSubscription: boolean }>('/notifications/push/subscriptions');
  }

  async subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.request<any>('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  }

  async unsubscribePush(endpoint: string) {
    return this.request<any>('/notifications/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  }

  async testPush() {
    return this.request<PushTestResult>('/notifications/push/test', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  // ─── Security ─────────────────────────────────
  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<any>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async deleteAccount(password: string) {
    return this.request<any>('/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
  }

  // ─── Two-Factor Authentication ─────────────────────────────────
  async setup2FA() {
    return this.request<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }>('/auth/2fa/setup', {
      method: 'POST',
    });
  }

  async enable2FA(token: string) {
    return this.request<{ enabled: boolean; backupCodes: string[] }>('/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async disable2FA() {
    return this.request<{ success: boolean; message: string }>('/auth/2fa/disable', {
      method: 'POST',
    });
  }

  async verify2FA(userId: string, token: string) {
    return this.request<{ accessToken: string; refreshToken: string; user: User }>('/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ userId, token }),
    });
  }

  async regenerateBackupCodes() {
    return this.request<{ backupCodes: string[] }>('/auth/2fa/backup-codes', {
      method: 'POST',
    });
  }

  // ─── Session Management ─────────────────────────────────
  async getSessions() {
    return this.request<Array<{
      id: string;
      ipAddress: string | null;
      userAgent: string | null;
      device: string;
      lastActiveAt: string;
      createdAt: string;
      expiresAt: string;
    }>>('/auth/sessions');
  }

  async revokeSession(sessionId: string) {
    return this.request<{ success: boolean }>(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async revokeAllSessions() {
    return this.request<{ success: boolean; revokedCount: number }>('/auth/sessions', {
      method: 'DELETE',
    });
  }

  // ─── Delete Message ─────────────────────────────────
  async deleteForEveryone(profileId: string, chatId: string, messageId: string) {
    return this.request<{ success: boolean }>('/messages/delete-for-everyone', {
      method: 'POST',
      body: JSON.stringify({ profileId, chatId, messageId }),
    });
  }

  // ─── Message Scheduling ─────────────────────────────────
  async scheduleMessage(profileId: string, to: string, type: string, content: string, scheduledAt: string) {
    return this.request<any>('/messages/schedule', {
      method: 'POST',
      body: JSON.stringify({ profileId, to, type, content, scheduledAt }),
    });
  }

  async getScheduledMessages(profileId: string, status?: string) {
    const query = status ? `?status=${status}` : '';
    return this.request<any[]>(`/messages/schedule/${profileId}${query}`);
  }

  async cancelScheduledMessage(id: string) {
    return this.request<{ success: boolean }>(`/messages/schedule/${id}`, {
      method: 'DELETE',
    });
  }

  // ─── AI Knowledge Base ─────────────────────────────────
  async addKnowledgeDocument(profileId: string, name: string, content: string) {
    return this.request<{ id: string; name: string; chunkCount: number }>(`/ai/knowledge/${profileId}/text`, {
      method: 'POST',
      body: JSON.stringify({ name, content }),
    });
  }

  async listKnowledgeDocuments(profileId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      type: string;
      size: number;
      chunkCount: number;
      createdAt: string;
    }>>(`/ai/knowledge/${profileId}`);
  }

  async deleteKnowledgeDocument(id: string) {
    return this.request<{ success: boolean }>(`/ai/knowledge/${id}`, {
      method: 'DELETE',
    });
  }

  async searchKnowledgeBase(profileId: string, query: string, maxResults?: number) {
    return this.request<Array<{
      documentName: string;
      content: string;
      score: number;
    }>>(`/ai/knowledge/${profileId}/search`, {
      method: 'POST',
      body: JSON.stringify({ query, maxResults }),
    });
  }

  // ─── Integrations Config ─────────────────────────────────
  async getIntegrationConfig() {
    return this.request<{
      typebot?: { apiUrl: string; defaultBotId: string; enabled: boolean };
      chatwoot?: { url: string; apiToken: string; accountId: string; inboxId: string; enabled: boolean };
    }>('/integrations/config');
  }

  async saveIntegrationConfig(config: {
    typebot?: { apiUrl: string; defaultBotId: string; enabled: boolean };
    chatwoot?: { url: string; apiToken: string; accountId: string; inboxId: string; enabled: boolean };
  }) {
    return this.request<{ success: boolean; message: string }>('/integrations/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async testIntegration(type: 'typebot' | 'chatwoot') {
    return this.request<{ success: boolean; message: string }>('/integrations/test', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
  }

  // ─── Customers ─────────────────────────────────
  async getCustomers(query: { q?: string; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    const qs = params.toString();
    return this.request<CustomerListPage>(`/customers${qs ? `?${qs}` : ''}`);
  }

  async getCustomer(id: string) {
    return this.request<CustomerView>(`/customers/${id}`);
  }

  /** The customers linked to a number, its default first. */
  async getCustomersByPhone(phone: string) {
    return this.request<CustomerByPhoneItem[]>(`/customers/by-phone/${encodeURIComponent(phone)}`);
  }

  /** A customer's live lookup; `refresh` asks past the server's cache. */
  async lookupCustomer(id: string, refresh = false) {
    return this.request<LookupResult>(`/customers/${id}/lookup${refresh ? '?refresh=true' : ''}`);
  }

  /** What the lookup says of an ID not linked yet; the server stores nothing. */
  async previewCustomerLookup(externalId: string) {
    return this.request<LookupResult>(`/customers/lookup?${new URLSearchParams({ externalId })}`);
  }

  /** The chats and calls of the customer's numbers, newest first. */
  async getCustomerHistory(id: string, limit?: number) {
    return this.request<CustomerHistoryItem[]>(`/customers/${id}/history${limit ? `?limit=${limit}` : ''}`);
  }

  /** Links an ID to a number. A new ID makes the customer (201); a link that exists answers as it is (200). */
  async linkCustomer(body: { externalId: string; phone: string }) {
    return this.request<LinkResult>('/customers/links', { method: 'POST', body: JSON.stringify(body) });
  }

  /** Makes a link its number's default ID. */
  async setDefaultCustomerLink(linkId: string) {
    return this.request<CustomerLinkView>(`/customers/links/${linkId}/use`, { method: 'POST' });
  }

  /** Removes one number's link: the customer, its notes and its tags stay. */
  async unlinkCustomer(linkId: string) {
    return this.request<{ success: boolean }>(`/customers/links/${linkId}`, { method: 'DELETE' });
  }

  /** `displayName` and `manualFields` only while no lookup endpoint is configured: the server answers 409 otherwise. */
  async updateCustomer(id: string, body: { tags?: string[]; displayName?: string; manualFields?: LookupField[] }) {
    return this.request<CustomerView>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  }

  async deleteCustomer(id: string) {
    return this.request<{ success: boolean }>(`/customers/${id}`, { method: 'DELETE' });
  }

  async addCustomerNote(customerId: string, body: string) {
    return this.request<CustomerNoteView>(`/customers/${customerId}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
  }

  /** Its author, or an owner or admin, changes a note; anyone else gets 403. */
  async updateCustomerNote(customerId: string, noteId: string, body: string) {
    return this.request<CustomerNoteView>(`/customers/${customerId}/notes/${noteId}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  }

  async deleteCustomerNote(customerId: string, noteId: string) {
    return this.request<{ success: boolean }>(`/customers/${customerId}/notes/${noteId}`, { method: 'DELETE' });
  }

  async getCustomerConfig() {
    return this.request<CustomerConfigView>('/customers/config');
  }

  /** An empty `lookupUrl` turns the lookup off; a `secret` left out keeps the stored one, and an empty one clears it. */
  async updateCustomerConfig(body: { idLabel?: string; lookupUrl?: string; secret?: string; timeoutMs?: number }) {
    return this.request<CustomerConfigView>('/customers/config', { method: 'PUT', body: JSON.stringify(body) });
  }

  /** One lookup with the saved settings, past the cache. */
  async testCustomerConfig(externalId: string) {
    return this.request<LookupTestResult>('/customers/config/test', { method: 'POST', body: JSON.stringify({ externalId }) });
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export class for custom instances
export { ApiClient };
