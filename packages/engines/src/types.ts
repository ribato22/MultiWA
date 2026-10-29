// MultiWA Gateway - Engine Types
// packages/engines/src/types.ts

export type EngineType = 'whatsapp-web-js' | 'baileys' | 'mock';

export interface EngineConfig {
  profileId: string;
  sessionDir?: string;
  puppeteerOptions?: {
    headless?: boolean;
    executablePath?: string;
    args?: string[];
  };
  onQR?: (qr: string) => void;
  /** The QR was scanned (or a stored session accepted); 'ready' should follow shortly. */
  onAuthenticated?: () => void;
  onReady?: (phone: string, pushName: string) => void;
  onDisconnected?: (reason: string) => void;
  onMessage?: (message: any) => void;
  onMessageAck?: (messageId: string, status: string) => void;
  onCall?: (call: IncomingCall) => void;
  /**
   * A WhatsApp call-log message ("Missed voice call"): the call's final outcome. whatsapp-web.js
   * reports one only for a call it reported `ringing` since the last disconnect, with its `callId`.
   */
  onCallLog?: (entry: CallLogEntry) => void;
  /**
   * Call media (answering calls from the dashboard). Set from the SERVER switch CALLS_MEDIA_ENABLED,
   * never per profile: it changes how the browser is launched, which only takes effect at launch.
   */
  callMedia?: { enabled: boolean };
}

/**
 * What an engine reports about an incoming call. whatsapp-web.js reports only `ringing` and
 * `ended` (the outcome comes as a call log, see `onCallLog`); Baileys reports all five and no call logs.
 * - `ringing`: the incoming offer (Baileys calls it `offer`; Baileys' own `ringing` status is ignored)
 * - `accepted`: Baileys: answered on another device of this account (we never answer)
 * - `rejected`: Baileys: declined, by this account's phone or by us
 * - `missed`: Baileys: the offer rang out unanswered (`timeout`)
 * - `ended`: it stopped being the active call and the engine cannot tell how
 */
export type CallState = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended';

/**
 * Normalized incoming WhatsApp call, engine-agnostic. `from`, `isVideo` and `isGroup` are
 * reliable on `ringing`; on later states they are best-effort, so match a call by `id`.
 */
export interface IncomingCall {
  /** Engine call id, passed back to `rejectCall`. */
  id: string;
  /** Caller JID as the engine reports it (`…@c.us`, `…@s.whatsapp.net` or `…@lid`); may be empty on a later state. */
  from: string;
  isVideo: boolean;
  isGroup: boolean;
  /** Absent = 'ringing' (the offer). */
  state?: CallState;
}

/** Final outcome carried by a WhatsApp call-log message. */
export type CallLogOutcome = 'missed' | 'rejected' | 'answered_elsewhere';

/** A call-log message, normalized. Match it to a call by `callId` when present, otherwise by caller and time. */
export interface CallLogEntry {
  /** The call-log message id (dedupe key). */
  messageId: string;
  /**
   * The engine call id this log belongs to, when WhatsApp's message id carries it (whatsapp-web.js:
   * `<fromMe>_<peer>_<callId>[_<participant>]`, the participant field being there in group logs only).
   * Match a call by it before falling back to caller and time.
   */
  callId?: string;
  from: string;
  isVideo: boolean;
  outcome: CallLogOutcome;
  timestamp: Date;
}

/** Kind of WhatsApp call link. */
export type CallLinkType = 'voice' | 'video';

export interface SendMessageOptions {
  quotedMessageId?: string;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp?: Date;
}

export interface EngineStatus {
  isConnected: boolean;
  isAuthenticated: boolean;
  phone?: string;
  pushName?: string;
  lastConnectedAt?: Date;
}

export interface MediaOptions {
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
}

export interface LocationOptions {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ContactOptions {
  name: string;
  phone: string;
}

export interface PollOptions {
  question: string;
  options: string[];
  allowMultipleAnswers?: boolean;
}

export interface GroupParticipant {
  id: string;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  description?: string;
  participants: GroupParticipant[];
  participantCount?: number;
  owner?: string;
  createdAt?: Date;
  isAdmin?: boolean;
}

export interface ContactInfo {
  id: string;           // WhatsApp JID
  phone: string;        // Phone number
  name: string;         // Contact name (as saved in WhatsApp)
  pushName?: string;    // WhatsApp push name (user-set name)
  profilePicUrl?: string;
  isGroup?: boolean;
  isMyContact?: boolean;
}

/**
 * Resolved real identity behind a WhatsApp JID. WhatsApp multi-device uses a
 * hidden "LID" (@lid) identity that is distinct from the phone-number JID for
 * the same person; this maps between them and surfaces the best display name.
 */
export interface ResolvedIdentity {
  phoneJid: string | null;   // normalized @s.whatsapp.net JID, or null if WA can't resolve it
  lidJid: string | null;     // the @lid form, when known
  name?: string;             // best display name (saved name > pushname > verified)
  pushName?: string;
}

/** A single message returned by history sync (lightweight; no media download). */
export interface RecentChatMessage {
  id: string;
  fromMe: boolean;
  from: string;
  author?: string;
  body: string;
  type: string;
  timestamp: number; // engine-native (seconds or ms)
  hasMedia: boolean;
}

/** A recent chat with its latest messages, used to backfill the dashboard on connect. */
export interface RecentChat {
  jid: string;
  name: string;
  isGroup: boolean;
  messages: RecentChatMessage[];
}

/** Why an engine cannot carry call audio right now. */
export type CallMediaUnsupportedReason =
  | 'not_ready'               // the WhatsApp Web page is not connected
  | 'web_calling_disabled'    // WhatsApp Web's calling UI gate is off for this account
  | 'voip_stack_unavailable'  // no voip stack, or not the in-browser one
  | 'module_missing'          // a WhatsApp Web module the call recipes need is gone (WhatsApp changed)
  | 'hooks_missing'           // our call-media hooks are not on this document (the init script did not run, or failed)
  | 'not_prepared'            // the hooks are here, but the page setup (the microphone permission) has not succeeded
  | 'page_error';             // the probe itself failed, or reported something this side does not know

export interface CallMediaSupport {
  supported: boolean;
  reasons: CallMediaUnsupportedReason[];
  /** WhatsApp Web build, when known. */
  waVersion?: string | null;
}

/**
 * Call-media primitives of an engine that runs WhatsApp Web in a browser (whatsapp-web.js only).
 * Every method that takes a call id refuses another one: answer, hangUp, playAnnouncement and startRecording
 * act on WhatsApp's ACTIVE call only; stopRecording stops only the recording of that call (also after it ended).
 * Every method runs in the browser page, and on a hung page any of them can wait up to puppeteer's protocol timeout
 * (the adapter sets 240 s), whatever deadline it has inside the page: the coordinator puts its own deadline around
 * these calls.
 */
export interface CallMediaEngine {
  getSupport(): Promise<CallMediaSupport>;
  /**
   * Answer the ringing call; resolves once it is connected, rejects when it is not ringing or does not connect in
   * time. WhatsApp's accept cannot be cancelled, so a call can still connect AFTER this rejected "did not connect in
   * time". After that rejection the caller MUST call `hangUp(callId)`, ignore its error, and release the call.
   * It does not refuse a video call: this engine is voice-only and never looks at the call type, so the coordinator
   * decides which calls to answer.
   */
  answer(callId: string, opts?: { timeoutMs?: number }): Promise<{ connectedAfterMs: number }>;
  /** End the call the way WhatsApp Web's End button does; rejects when the voip stack does not end it in time (10 s). */
  hangUp(callId: string): Promise<void>;
  /**
   * Play audio to the caller through the call's microphone; the agent input is held silent meanwhile. One
   * announcement at a time: a second one rejects ("Announcement already playing") and leaves the first alone. One that
   * has not ended 5 s after its own length (a suspended or torn-down audio context never reaches the end) rejects
   * ("Announcement did not finish"), is cut off, and gives the agent input back. The line is free again either way.
   */
  playAnnouncement(callId: string, audio: Buffer): Promise<{ durationMs: number }>;
  /**
   * Record the call in stereo (left: the caller, right: what the caller hears); WebM/Opus chunks go to onChunk in
   * order. One recording at a time: another start rejects "Already recording" and leaves the running one alone.
   * A recording ends with its call: it stops by itself 250-500 ms after its call is over (WhatsApp's active call is
   * another call or none, or the engine's call tracking reported the call ended), so it never records the next call.
   * That is a backstop: stop a recording when its call is reported `ended`, and never start one for a call that was.
   * `stopRecording(callId)` is still required, to collect the last chunks, get `durationMs`, and free the slot (a
   * start before that rejects "Already recording"). A recorder that fails stops the same way, and stopRecording then
   * rejects.
   * onChunk must not throw: a chunk it refuses is lost, and stopRecording reports the loss. The engine logs one
   * warning (never audio) when it had to guess which stream is the caller; the left channel is then in doubt.
   * A start that rejects may still have begun recording in the page (it timed out in Node after the page began). Then
   * the caller MUST call `stopRecording(callId)`, ignore its error, before the next start, and discard the chunks that
   * start received: they are not a recording. The exception depends on the caller's OWN state, never on the error text:
   * while it holds a running recording of this call (an earlier start that resolved and was not stopped), a rejected
   * second start must NOT be followed by a stop, which would end that recording. (The page says "Already recording"
   * for an orphan recorder too, and there the stop is the cure.) Chunks are routed by call id, so another call's audio
   * never reaches onChunk; a later recording of the SAME call, after a stop that failed, may begin with the last
   * chunks of the earlier attempt.
   */
  startRecording(callId: string, onChunk: (chunk: Buffer) => void): Promise<void>;
  /**
   * Stop recording; resolves after the last chunk was delivered, with `durationMs` up to the moment the recorder
   * stopped (for one that ended with its call: 250-500 ms after the call ended, not this later stop). Rejects when the
   * recorder failed or chunks were lost (the message says which, and how many of how many; both are reported
   * together); the recorder is freed either way. ANY rejection can mean an incomplete recording, not only those:
   * "Not recording" after a page reload, "Client not ready", a puppeteer error after the browser closed. Treat the
   * file as partial. A stop never overtakes its own start: one that arrives while the start still runs waits for it.
   * It needs no WhatsApp readiness, so it also works after a disconnect, while the page still holds the recorder.
   */
  stopRecording(callId: string): Promise<{ durationMs: number }>;
}

/**
 * Base interface for WhatsApp engines
 * All engine adapters must implement this interface
 */
export interface IWhatsAppEngine {
  readonly engineType: EngineType;
  
  // Lifecycle
  initialize(config: EngineConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;
  
  // Status
  getStatus(): EngineStatus;
  isReady(): boolean;
  
  // Messaging
  sendText(to: string, text: string, options?: SendMessageOptions): Promise<MessageResult>;
  sendImage(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendVideo(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendAudio(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendDocument(to: string, media: MediaOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendLocation(to: string, location: LocationOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendContact(to: string, contact: ContactOptions, options?: SendMessageOptions): Promise<MessageResult>;
  sendReaction(messageId: string, emoji: string): Promise<MessageResult>;
  sendPoll(to: string, poll: PollOptions, options?: SendMessageOptions): Promise<MessageResult>;

  // Presence & Chat State
  sendPresenceUpdate(to: string, state: 'composing' | 'available' | 'recording'): Promise<void>;
  
  // Read Receipts
  markAsRead(chatId: string, messageIds?: string[]): Promise<void>;
  
  // Message management
  deleteForEveryone(chatId: string, messageId: string): Promise<void>;

  // Calls
  /** Reject an incoming call by its engine id (see `EngineConfig.onCall`). Rejects when the call is not ringing any more. */
  rejectCall(callId: string): Promise<void>;
  /**
   * Create a WhatsApp call link (https://call.whatsapp.com/...). It is a plain call link:
   * anyone who has it can join, without approval. Resolves null only when this engine has
   * no call-link API; rejects when the client is not ready or WhatsApp returns no link.
   */
  createCallLink(type: CallLinkType): Promise<string | null>;
  /** Call media, when this engine has it AND the server switch is on; undefined otherwise (Baileys, mock). */
  callMedia?: CallMediaEngine;

  // QR Code
  getQRCode(): Promise<string | null>;
  onQR(callback: (qr: string) => void): void;
  
  // Session
  getSessionData(): Promise<any>;
  restoreSession(data: any): Promise<boolean>;

  // Groups
  getGroups(): Promise<GroupInfo[]>;
  getGroupInfo(groupId: string): Promise<GroupInfo>;

  // Contacts - fetch contacts from WhatsApp
  getContacts(): Promise<ContactInfo[]>;

  // Save/remove a contact in the WhatsApp ACCOUNT's addressbook (optional; supported
  // by whatsapp-web.js, not Baileys). Unlike the MultiWA contacts DB, this writes to
  // WhatsApp itself, moving an "unknown" number into a known contact — which WhatsApp
  // treats more leniently. syncToPhone=true also saves it to the phone's address book.
  saveWhatsAppContact?(phone: string, firstName: string, lastName?: string, syncToPhone?: boolean): Promise<void>;
  deleteWhatsAppContact?(phone: string): Promise<void>;

  // Resolve a JID's real identity (maps @lid <-> phone number + best name).
  // Returns null when the engine can't resolve it.
  resolveIdentity(jid: string): Promise<ResolvedIdentity | null>;

  // History sync (optional): recent chats with their latest messages, used to
  // backfill the dashboard on connect. Best-effort; adapters may omit it.
  getRecentChats?(chatLimit: number, perChatMessages: number): Promise<RecentChat[]>;

  // On-demand "load older" (optional): the most recent `limit` messages of a single
  // chat (newest->oldest). Increasing `limit` across calls walks further back.
  fetchChatMessages?(chatId: string, limit: number): Promise<RecentChatMessage[]>;

  createGroup(name: string, participants: string[]): Promise<GroupInfo>;
  setGroupName(groupId: string, name: string): Promise<void>;
  setGroupDescription(groupId: string, description: string): Promise<void>;
  addGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  removeGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  promoteGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  demoteGroupParticipants(groupId: string, participants: string[]): Promise<void>;
  leaveGroup(groupId: string): Promise<void>;
  getGroupInviteLink(groupId: string): Promise<string>;
  revokeGroupInviteLink(groupId: string): Promise<string>;
}

