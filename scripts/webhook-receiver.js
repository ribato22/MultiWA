#!/usr/bin/env node
/**
 * MultiWA Webhook Receiver - Testing & Auto-Reply Server
 *
 * Usage:
 *   node scripts/webhook-receiver.js [port]
 *
 * Default port: 9999
 *
 * Environment Variables:
 *   WEBHOOK_SECRET   - HMAC secret for signature verification
 *   AUTO_REPLY       - Set to "true" to enable auto-forward to group
 *   API_URL          - MultiWA API base URL (default: http://localhost:3000)
 *   API_EMAIL        - Login email for API auth
 *   API_PASSWORD     - Login password for API auth
 *   PROFILE_ID       - WhatsApp profile ID to send from
 *   GROUP_JID        - Target group JID (default: Me&Me group)
 *
 * Examples:
 *   # Basic receiver (no auto-reply)
 *   node scripts/webhook-receiver.js
 *
 *   # With auto-reply to Me&Me group
 *   AUTO_REPLY=true API_EMAIL=admin@example.com API_PASSWORD=your-password \
 *   PROFILE_ID=57882eed-7c68-4100-8ef0-98b318b0fce2 node scripts/webhook-receiver.js
 */

const http = require("http");
const crypto = require("crypto");

// === Configuration ===
const PORT = parseInt(process.argv[2] || "9999", 10);
const SECRET = process.env.WEBHOOK_SECRET || "";

// Auto-Reply Configuration
const AUTO_REPLY = process.env.AUTO_REPLY === "true";
const API_URL = process.env.API_URL || "http://localhost:3000";
const API_EMAIL = process.env.API_EMAIL || "";
const API_PASSWORD = process.env.API_PASSWORD || "";
const PROFILE_ID = process.env.PROFILE_ID || "";
const GROUP_JID = process.env.GROUP_JID || "120363421805328930@g.us"; // Me&Me group

let requestCount = 0;
let apiToken = null;
let tokenExpiresAt = 0;

// === API Helper Functions ===

async function apiLogin() {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: API_EMAIL, password: API_PASSWORD }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Login failed: ${res.status}`);
    }

    const data = await res.json();
    apiToken = data.accessToken;
    // Token expires in `expiresIn` seconds, refresh 5 min before
    tokenExpiresAt = Date.now() + (data.expiresIn - 300) * 1000;
    console.log("  🔑 API login successful");
    return apiToken;
  } catch (error) {
    console.error("  ❌ API login failed:", error.message);
    return null;
  }
}

async function getToken() {
  if (apiToken && Date.now() < tokenExpiresAt) {
    return apiToken;
  }
  return await apiLogin();
}

async function apiSend(endpoint, payload) {
  let token = await getToken();
  if (!token) {
    console.error("  ❌ Cannot send: no valid API token");
    return false;
  }

  const doFetch = async (t) => {
    return fetch(`${API_URL}/api/v1/messages/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${t}`,
      },
      body: JSON.stringify({
        profileId: PROFILE_ID,
        to: GROUP_JID,
        ...payload,
      }),
    });
  };

  try {
    let res = await doFetch(token);
    if (res.status === 401) {
      apiToken = null;
      token = await apiLogin();
      if (!token) return false;
      res = await doFetch(token);
    }
    if (!res.ok) throw new Error(`Send failed: ${res.status}`);
    return true;
  } catch (error) {
    console.error(`  ❌ API send (${endpoint}) failed:`, error.message);
    return false;
  }
}

async function sendToGroup(text) {
  const ok = await apiSend("text", { text });
  if (ok) console.log("  ✅ Text summary sent to Me&Me group");
  return ok;
}

async function sendMediaToGroup(type, url, caption, mimetype, filename) {
  if (!url) return false;

  const endpointMap = {
    image: "image",
    video: "video",
    audio: "audio",
    document: "document",
    ptt: "audio",
  };
  const endpoint = endpointMap[type];
  if (!endpoint) return false;

  const payload = { url, mimetype: mimetype || undefined };
  if (caption) payload.caption = caption;
  if (endpoint === "document") payload.filename = filename || "file";

  const ok = await apiSend(endpoint, payload);
  if (ok) console.log(`  ✅ Media (${type}) forwarded to Me&Me group`);
  return ok;
}

// === Message Formatting ===

function formatWebhookSummary(event, data) {
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });

  if (event === "message:received") {
    const msg = data.message || data;
    const sender = msg.senderName || msg.from || msg.senderJid || "Unknown";
    const type = msg.type || "text";
    const phone = msg.from || msg.senderJid || "";

    let preview = "";
    if (type === "text") {
      preview = msg.body || msg.text || msg.content?.text || "(empty)";
      if (preview.length > 200) preview = preview.substring(0, 200) + "...";
    } else if (type === "image") {
      preview = `🖼️ Image${msg.caption ? `: ${msg.caption}` : ""}`;
    } else if (type === "video") {
      preview = `🎬 Video${msg.caption ? `: ${msg.caption}` : ""}`;
    } else if (type === "audio" || type === "ptt") {
      preview = "🎵 Audio/Voice message";
    } else if (type === "document") {
      preview = `📎 Document: ${msg.filename || msg.content?.filename || "file"}`;
    } else if (type === "sticker") {
      preview = "🏷️ Sticker";
    } else if (type === "location") {
      preview = `📍 Location: ${msg.latitude || ""},${msg.longitude || ""}`;
    } else if (type === "contact" || type === "vcard") {
      preview = "👤 Contact card";
    } else {
      preview = `[${type}]`;
    }

    return [
      `📩 *Pesan Masuk* — ${timestamp}`,
      `👤 Dari: ${sender}`,
      `📱 No: ${phone}`,
      `📝 Tipe: ${type}`,
      `💬 ${preview}`,
    ].join("\n");
  }

  if (event === "message:sent") {
    const msg = data.message || data;
    const to = msg.to || msg.recipientJid || "Unknown";
    const type = msg.type || "text";
    return [
      `📤 *Pesan Terkirim* — ${timestamp}`,
      `📱 Ke: ${to}`,
      `📝 Tipe: ${type}`,
    ].join("\n");
  }

  if (event === "connection:status") {
    const status = data.status || "unknown";
    const phone = data.phoneNumber || "";
    const icons = {
      connected: "🟢",
      disconnected: "🔴",
      connecting: "🟡",
    };
    return `${icons[status] || "⚪"} *Status Koneksi*: ${status}${phone ? ` (${phone})` : ""} — ${timestamp}`;
  }

  // Generic event
  return [
    `🔔 *Webhook Event: ${event}* — ${timestamp}`,
    JSON.stringify(data, null, 2).substring(0, 300),
  ].join("\n");
}

// === HTTP Server ===

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        received: requestCount,
        autoReply: AUTO_REPLY,
      }),
    );
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", async () => {
    requestCount++;
    const timestamp = new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
    });

    console.log("\n" + "=".repeat(60));
    console.log(`📥 Webhook #${requestCount} received at ${timestamp}`);
    console.log("=".repeat(60));

    // Headers
    const event = req.headers["x-multiwa-event"] || "unknown";
    const signature = req.headers["x-multiwa-signature"] || "";
    console.log(`  Event:     ${event}`);
    console.log(`  Path:      ${req.url}`);
    console.log(`  Signature: ${signature || "(none)"}`);

    // Verify HMAC if secret is available
    if (SECRET && signature) {
      const expected =
        "sha256=" +
        crypto.createHmac("sha256", SECRET).update(body).digest("hex");

      const isValid = signature === expected;
      console.log(`  Verified:  ${isValid ? "✅ Valid" : "❌ Invalid"}`);
      if (!isValid) {
        console.log(`    Expected: ${expected}`);
        console.log(`    Got:      ${signature}`);
      }
    }

    // Parse and display body
    let data = null;
    try {
      data = JSON.parse(body);
      console.log("\n  📦 Payload:");
      console.log(
        JSON.stringify(data, null, 4)
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    } catch (e) {
      console.log("\n  📦 Raw Body:");
      console.log("    " + (body || "(empty)"));
    }

    // Auto-reply: forward to Me&Me group
    if (AUTO_REPLY && data) {
      console.log("\n  🤖 Auto-Reply:");

      // 1. Send text summary
      const summary = formatWebhookSummary(event, data);
      await sendToGroup(summary);

      // 2. Forward media if present (for message events)
      if (event === "message:received" || event === "message:sent") {
        const msg = data.message || data;
        const type = msg.type || "text";
        const mediaUrl = msg.url || msg.mediaUrl || msg.content?.url || "";
        const caption = msg.caption || msg.content?.caption || "";
        const mimetype = msg.mimetype || msg.content?.mimetype || "";
        const filename = msg.filename || msg.content?.filename || "";

        if (
          mediaUrl &&
          ["image", "video", "audio", "ptt", "document"].includes(type)
        ) {
          await sendMediaToGroup(type, mediaUrl, caption, mimetype, filename);
        }
      }
    }

    console.log("\n" + "-".repeat(60));

    // Send response
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        received: true,
        event,
        requestNumber: requestCount,
      }),
    );
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║         MultiWA Webhook Receiver                    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  🚀 Listening on http://0.0.0.0:${PORT}`);
  console.log(`  📡 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`  💡 Health:      http://localhost:${PORT}/health`);

  if (SECRET) {
    console.log(`  🔐 HMAC Secret: ${SECRET.slice(0, 8)}...`);
  } else {
    console.log(
      `  ⚠️  No WEBHOOK_SECRET set — signature verification disabled`,
    );
  }

  if (AUTO_REPLY) {
    console.log("");
    console.log("  🤖 Auto-Reply: ENABLED");
    console.log(`     API:      ${API_URL}`);
    console.log(`     Email:    ${API_EMAIL}`);
    console.log(`     Profile:  ${PROFILE_ID || "(not set!)"}`);
    console.log(`     Group:    ${GROUP_JID}`);

    if (!API_EMAIL || !API_PASSWORD || !PROFILE_ID) {
      console.log("");
      console.log(
        "  ⚠️  Missing required env vars for auto-reply: API_EMAIL, API_PASSWORD, PROFILE_ID",
      );
    }
  } else {
    console.log("");
    console.log("  💤 Auto-Reply: DISABLED");
    console.log(
      "     Enable: AUTO_REPLY=true API_EMAIL=... API_PASSWORD=... PROFILE_ID=... node scripts/webhook-receiver.js",
    );
  }

  console.log("");
  console.log("  Waiting for webhooks...");
  console.log("");
});
