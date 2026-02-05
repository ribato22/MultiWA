"use strict";
// MultiWA Gateway - WhatsApp Web.js Adapter (PRIMARY ENGINE)
// packages/engines/src/adapters/whatsapp-webjs.adapter.ts
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppWebJsAdapter = void 0;
const whatsapp_web_js_1 = require("whatsapp-web.js");
const qrcode = __importStar(require("qrcode-terminal"));
class WhatsAppWebJsAdapter {
  constructor() {
    this.engineType = "whatsapp-web-js";
    this.client = null;
    this.config = null;
    this.status = {
      isConnected: false,
      isAuthenticated: false,
    };
    this.currentQR = null;
    this.qrCallbacks = [];
  }
  async initialize(config) {
    this.config = config;
    const sessionDir = config.sessionDir || `./sessions/${config.profileId}`;
    // Platform-aware Puppeteer args
    const isLinux = process.platform === "linux";
    const defaultArgs = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
      // Linux-only flags (cause hangs on macOS)
      ...(isLinux ? ["--disable-setuid-sandbox", "--no-zygote"] : []),
    ];
    console.log(
      `[WhatsApp-WebJS] Platform: ${process.platform}, Using Chrome: ${process.env.PUPPETEER_EXECUTABLE_PATH || config.puppeteerOptions?.executablePath || "bundled"}`,
    );
    this.client = new whatsapp_web_js_1.Client({
      authStrategy: new whatsapp_web_js_1.LocalAuth({
        clientId: config.profileId,
        dataPath: sessionDir,
      }),
      puppeteer: {
        headless: config.puppeteerOptions?.headless ?? true,
        executablePath:
          process.env.PUPPETEER_EXECUTABLE_PATH ||
          config.puppeteerOptions?.executablePath,
        timeout: 60000, // 60 seconds for browser launch
        protocolTimeout: 240000, // 240 seconds for CDP protocol operations
        args: config.puppeteerOptions?.args || defaultArgs,
      },
    });
    this.setupEventHandlers();
  }
  setupEventHandlers() {
    if (!this.client) return;
    // QR Code
    this.client.on("qr", (qr) => {
      console.log(
        `[WhatsApp-WebJS] QR Code received for profile ${this.config?.profileId}`,
      );
      this.currentQR = qr;
      // Show QR in terminal for debugging
      qrcode.generate(qr, { small: true });
      // Notify callbacks
      this.qrCallbacks.forEach((cb) => cb(qr));
      this.config?.onQR?.(qr);
    });
    // Ready
    this.client.on("ready", async () => {
      console.log(
        `[WhatsApp-WebJS] Client ready for profile ${this.config?.profileId}`,
      );
      const info = this.client?.info;
      this.status = {
        isConnected: true,
        isAuthenticated: true,
        phone: info?.wid?.user,
        pushName: info?.pushname,
        lastConnectedAt: new Date(),
      };
      this.currentQR = null;
      this.config?.onReady?.(info?.wid?.user || "", info?.pushname || "");
    });
    // Authenticated
    this.client.on("authenticated", () => {
      console.log(
        `[WhatsApp-WebJS] Authenticated for profile ${this.config?.profileId}`,
      );
      this.status.isAuthenticated = true;
    });
    // Disconnected
    this.client.on("disconnected", (reason) => {
      console.log(
        `[WhatsApp-WebJS] Disconnected for profile ${this.config?.profileId}: ${reason}`,
      );
      this.status = {
        isConnected: false,
        isAuthenticated: false,
      };
      this.config?.onDisconnected?.(reason);
    });
    // Message received
    this.client.on("message", async (message) => {
      console.log(
        `[WhatsApp-WebJS] Message received: ${message.id._serialized}`,
      );
      const transformedMessage = {
        id: message.id,
        _serialized: message.id._serialized,
        from: message.from,
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        isGroup: message.from.includes("@g.us"),
        hasMedia: message.hasMedia,
        fromMe: message.fromMe,
        author: message.author,
        pushName: message.id?.participant || message._data?.notifyName,
        _data: message._data,
        downloadMedia: message.hasMedia
          ? () => message.downloadMedia()
          : undefined,
      };
      this.config?.onMessage?.(transformedMessage);
    });
    // Message ACK
    this.client.on("message_ack", (message, ack) => {
      const statusMap = {
        0: "pending",
        1: "sent",
        2: "delivered",
        3: "read",
        4: "played",
      };
      this.config?.onMessageAck?.(
        message.id._serialized,
        statusMap[ack] || "unknown",
      );
    });
  }
  async connect() {
    if (!this.client) {
      throw new Error("Client not initialized. Call initialize() first.");
    }
    console.log(
      `[WhatsApp-WebJS] Connecting profile ${this.config?.profileId}...`,
    );
    await this.client.initialize();
  }
  async disconnect() {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (e) {
        // Ignore logout errors
      }
      this.status = { isConnected: false, isAuthenticated: false };
    }
  }
  async destroy() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      this.client = null;
      this.status = { isConnected: false, isAuthenticated: false };
    }
  }
  getStatus() {
    return { ...this.status };
  }
  isReady() {
    return this.status.isConnected && this.status.isAuthenticated;
  }
  // ========== MESSAGING ==========
  async sendText(to, text, options) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const chatId = this.normalizePhoneToJid(to);
      const opts = {};
      if (options?.quotedMessageId) {
        const quotedMsg = await this.client?.getMessageById(
          options.quotedMessageId,
        );
        if (quotedMsg) opts.quotedMessageId = quotedMsg.id._serialized;
      }
      const result = await this.client?.sendMessage(chatId, text, opts);
      return {
        success: true,
        messageId: result?.id._serialized,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send text error:", error);
      return { success: false, error: error.message };
    }
  }
  async sendImage(to, media, options) {
    return this.sendMedia(to, media, "image", options);
  }
  async sendVideo(to, media, options) {
    return this.sendMedia(to, media, "video", options);
  }
  async sendAudio(to, media, options) {
    return this.sendMedia(to, media, "audio", options);
  }
  async sendDocument(to, media, options) {
    return this.sendMedia(to, media, "document", options);
  }
  async sendMedia(to, media, type, options) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const chatId = this.normalizePhoneToJid(to);
      let messageMedia;
      if (media.url) {
        messageMedia = await whatsapp_web_js_1.MessageMedia.fromUrl(media.url, {
          unsafeMime: true,
        });
      } else if (media.base64) {
        messageMedia = new whatsapp_web_js_1.MessageMedia(
          media.mimetype || "application/octet-stream",
          media.base64,
          media.filename,
        );
      } else {
        return { success: false, error: "No media provided" };
      }
      // Ensure filename is preserved (fromUrl loses original filename)
      if (media.filename) {
        messageMedia.filename = media.filename;
      }
      const sendOptions = { caption: media.caption };
      if (type === "audio") {
        sendOptions.sendAudioAsVoice = true;
      }
      if (type === "document") {
        sendOptions.sendMediaAsDocument = true;
      }
      const result = await this.client?.sendMessage(
        chatId,
        messageMedia,
        sendOptions,
      );
      return {
        success: true,
        messageId: result?.id._serialized,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error(`[WhatsApp-WebJS] Send ${type} error:`, error);
      return { success: false, error: error.message };
    }
  }
  async sendLocation(to, location, options) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const chatId = this.normalizePhoneToJid(to);
      const loc = new whatsapp_web_js_1.Location(
        location.latitude,
        location.longitude,
        {
          name: location.name,
          address: location.address,
        },
      );
      const result = await this.client?.sendMessage(chatId, loc);
      return {
        success: true,
        messageId: result?.id._serialized,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send location error:", error);
      return { success: false, error: error.message };
    }
  }
  async sendContact(to, contact, options) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const chatId = this.normalizePhoneToJid(to);
      // Method 1: Send vCard directly (more reliable - doesn't require contact to exist on phone)
      const contactData = contact;
      if (
        contactData.contacts &&
        contactData.contacts.length > 0 &&
        contactData.contacts[0].vcard
      ) {
        const vcard = contactData.contacts[0].vcard;
        const result = await this.client?.sendMessage(chatId, vcard, {
          parseVCards: true,
        });
        return {
          success: true,
          messageId: result?.id._serialized,
          timestamp: new Date(),
        };
      }
      // Method 2: Build vCard from name and phone
      if (contact.name && contact.phone) {
        const phone = contact.phone.replace(/[^0-9+]/g, "");
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL;type=CELL;type=VOICE;waid=${phone.replace("+", "")}:${phone}\nEND:VCARD`;
        const result = await this.client?.sendMessage(chatId, vcard, {
          parseVCards: true,
        });
        return {
          success: true,
          messageId: result?.id._serialized,
          timestamp: new Date(),
        };
      }
      return { success: false, error: "Contact name and phone are required" };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send contact error:", error);
      return { success: false, error: error.message };
    }
  }
  async sendReaction(messageId, emoji) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const message = await this.client?.getMessageById(messageId);
      if (!message) {
        return { success: false, error: "Message not found" };
      }
      await message.react(emoji);
      return { success: true, messageId };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send reaction error:", error);
      return { success: false, error: error.message };
    }
  }
  async sendPoll(to, poll, options) {
    try {
      if (!this.isReady()) {
        return { success: false, error: "Client not ready" };
      }
      const chatId = this.normalizePhoneToJid(to);
      // Create poll using the Poll class from whatsapp-web.js
      // The third parameter is optional metadata
      const waPoll = new whatsapp_web_js_1.Poll(poll.question, poll.options);
      const result = await this.client?.sendMessage(chatId, waPoll);
      return {
        success: true,
        messageId: result?.id._serialized,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send poll error:", error);
      return { success: false, error: error.message };
    }
  }
  /**
   * Send presence update (typing indicator) to a chat.
   * @param to - The JID of the chat
   * @param state - 'composing' to show typing, 'available' to clear it
   */
  async sendPresenceUpdate(to, state) {
    try {
      if (!this.isReady() || !this.client) return;
      const chatId = this.normalizePhoneToJid(to);
      // First, ensure our presence is online (required for typing to work)
      try {
        await this.client.sendPresenceAvailable();
      } catch (e) {
        // Non-critical
      }
      const chat = await this.client.getChatById(chatId);
      // Mark chat as seen first (required for typing indicators to be visible)
      try {
        await chat.sendSeen();
      } catch (e) {
        // Non-critical
      }
      if (state === "composing") {
        await chat.sendStateTyping();
      } else if (state === "recording") {
        await chat.sendStateRecording();
      } else {
        await chat.clearState();
      }
      console.log(`[WhatsApp-WebJS] Presence update: ${state} -> ${chatId}`);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Send presence update error:", error);
      // Non-critical — don't throw
    }
  }
  /**
   * Mark a chat or specific messages as read.
   */
  async markAsRead(chatId, messageIds) {
    try {
      if (!this.isReady() || !this.client) return;
      const normalizedId = this.normalizePhoneToJid(chatId);
      const chat = await this.client.getChatById(normalizedId);
      await chat.sendSeen();
      console.log(`[WhatsApp-WebJS] Marked as read: ${normalizedId}`);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Mark as read error:", error);
      // Non-critical — don't throw
    }
  }
  /**
   * Delete a message for everyone in the chat.
   */
  async deleteForEveryone(chatId, messageId) {
    try {
      if (!this.isReady() || !this.client) return;
      const normalizedId = this.normalizePhoneToJid(chatId);
      const chat = await this.client.getChatById(normalizedId);
      const messages = await chat.fetchMessages({ limit: 50 });
      const msg = messages.find(
        (m) => m.id?.id === messageId || m.id?._serialized === messageId,
      );
      if (msg) {
        await msg.delete(true); // true = delete for everyone
        console.log(
          `[WhatsApp-WebJS] Deleted message ${messageId} for everyone`,
        );
      } else {
        console.warn(
          `[WhatsApp-WebJS] Message ${messageId} not found in chat ${normalizedId}`,
        );
      }
    } catch (error) {
      console.error("[WhatsApp-WebJS] Delete for everyone error:", error);
      throw error;
    }
  }
  // ========== QR CODE ==========
  async getQRCode() {
    return this.currentQR;
  }
  onQR(callback) {
    this.qrCallbacks.push(callback);
    // If we already have a QR, send it immediately
    if (this.currentQR) {
      callback(this.currentQR);
    }
  }
  // ========== SESSION ==========
  async getSessionData() {
    // whatsapp-web.js handles session persistence via LocalAuth
    // For cloud storage, you'd need to export the session folder
    return null;
  }
  async restoreSession(data) {
    // whatsapp-web.js handles session restoration via LocalAuth
    return true;
  }
  // ========== HELPERS ==========
  normalizePhoneToJid(phone) {
    // If already a valid JID (contains @), handle format conversion
    if (phone.includes("@")) {
      // whatsapp-web.js uses @c.us, but our DB normalizes to @s.whatsapp.net
      // Convert back to @c.us for sending
      if (phone.includes("@s.whatsapp.net")) {
        return phone.replace("@s.whatsapp.net", "@c.us");
      }
      return phone;
    }
    // Remove all non-numeric characters for plain phone numbers
    let normalized = phone.replace(/\D/g, "");
    // Handle Indonesian numbers (0xxx -> 62xxx)
    if (normalized.startsWith("0")) {
      normalized = "62" + normalized.slice(1);
    }
    // Append @c.us for individual chats
    return `${normalized}@c.us`;
  }
  // ========== GROUPS ==========
  async getGroups() {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      console.log(`[WhatsApp-WebJS] Fetching chats for groups...`);
      const chats = await this.client.getChats();
      const groups = chats.filter((c) => c.isGroup);
      const results = [];
      for (const g of groups) {
        try {
          // Only extract basic info for list view — skip heavy participant mapping
          const participantCount = g.participants?.length || 0;
          results.push({
            id: g.id._serialized,
            name: g.name || "",
            description: g.description || "",
            participants: [], // Don't map participants for list view — too slow for 270+ groups
            participantCount: participantCount,
          });
        } catch (err) {
          console.warn(
            `[WhatsApp-WebJS] Skipping group ${g.id._serialized}: ${err.message}`,
          );
          results.push({
            id: g.id._serialized,
            name: g.name || "",
            description: "",
            participants: [],
            participantCount: 0,
          });
        }
      }
      console.log(`[WhatsApp-WebJS] GetGroups: Found ${results.length} groups`);
      return results;
    } catch (error) {
      console.error("[WhatsApp-WebJS] Get groups error:", error);
      throw error;
    }
  }
  async getGroupInfo(groupId) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      const participants = chat.participants || [];
      return {
        id: chat.id._serialized,
        name: chat.name || "",
        description: chat.description || "",
        participants: participants.map((p) => ({
          id: p.id._serialized,
          isAdmin: p.isAdmin || p.isSuperAdmin || false,
          isSuperAdmin: p.isSuperAdmin || false,
        })),
      };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Get group info error:", error);
      throw error;
    }
  }
  // ========== CONTACTS ==========
  async getContacts() {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const waContacts = await this.client.getContacts();
      const contacts = [];
      for (const contact of waContacts) {
        // Skip groups, broadcast lists, and LID (Linked Identity) contacts
        // LID contacts (@lid) are duplicates created by WhatsApp's multi-device system
        const jid = contact.id._serialized;
        if (
          jid.includes("@g.us") ||
          jid.includes("@broadcast") ||
          jid.includes("@lid")
        ) {
          continue;
        }
        const phone = jid.replace("@c.us", "").replace("@s.whatsapp.net", "");
        // Skip contacts with no valid phone number
        // Also skip very long numbers (>16 digits) which are group JIDs stored without @g.us
        if (!phone || phone.length < 5 || phone.length > 16) {
          continue;
        }
        contacts.push({
          id: jid,
          phone: phone,
          name: contact.name || contact.pushname || phone,
          pushName: contact.pushname,
          isGroup: false,
          isMyContact: contact.isMyContact,
        });
      }
      console.log(
        `[WhatsApp-WebJS] GetContacts: Found ${contacts.length} contacts`,
      );
      return contacts;
    } catch (error) {
      console.error("[WhatsApp-WebJS] Get contacts error:", error);
      throw error;
    }
  }
  async createGroup(name, participants) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const result = await this.client.createGroup(name, participants);
      return {
        id: result.gid?._serialized || "",
        name: name,
        participants: participants.map((p) => ({ id: p, isAdmin: false })),
      };
    } catch (error) {
      console.error("[WhatsApp-WebJS] Create group error:", error);
      throw error;
    }
  }
  async setGroupName(groupId, name) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.setSubject(name);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Set group name error:", error);
      throw error;
    }
  }
  async setGroupDescription(groupId, description) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.setDescription(description);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Set group description error:", error);
      throw error;
    }
  }
  async addGroupParticipants(groupId, participants) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.addParticipants(participants);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Add participants error:", error);
      throw error;
    }
  }
  async removeGroupParticipants(groupId, participants) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.removeParticipants(participants);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Remove participants error:", error);
      throw error;
    }
  }
  async promoteGroupParticipants(groupId, participants) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.promoteParticipants(participants);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Promote participants error:", error);
      throw error;
    }
  }
  async demoteGroupParticipants(groupId, participants) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.demoteParticipants(participants);
    } catch (error) {
      console.error("[WhatsApp-WebJS] Demote participants error:", error);
      throw error;
    }
  }
  async leaveGroup(groupId) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      await chat.leave();
    } catch (error) {
      console.error("[WhatsApp-WebJS] Leave group error:", error);
      throw error;
    }
  }
  async getGroupInviteLink(groupId) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      return await chat.getInviteCode();
    } catch (error) {
      console.error("[WhatsApp-WebJS] Get invite link error:", error);
      throw error;
    }
  }
  async revokeGroupInviteLink(groupId) {
    try {
      if (!this.isReady() || !this.client) {
        throw new Error("Client not ready");
      }
      const chat = await this.client.getChatById(groupId);
      if (!chat.isGroup) throw new Error("Not a group");
      return await chat.revokeInvite();
    } catch (error) {
      console.error("[WhatsApp-WebJS] Revoke invite link error:", error);
      throw error;
    }
  }
}
exports.WhatsAppWebJsAdapter = WhatsAppWebJsAdapter;
