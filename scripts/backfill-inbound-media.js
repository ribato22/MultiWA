#!/usr/bin/env node
'use strict';
/**
 * Recover inbound WhatsApp media that was stored WITHOUT its file.
 *
 * When `downloadMedia()` failed on arrival (for example WhatsApp Web rejecting a typed download that carried no
 * mimetype), the message row kept `content.hasMedia = true` but no `mimetype` / `url`. This script downloads
 * those files again through the running WhatsApp Web page of each profile and merges them into
 * `messages.content` exactly the way a live message is stored (the inline size cap included).
 *
 * It needs the engine's browsers and DATABASE_URL, so run it INSIDE the api container, with the fixed image
 * already deployed (otherwise the same download fails the same way):
 *
 *   docker cp scripts/backfill-inbound-media.js <api-container>:/tmp/
 *   docker exec <api-container> node /tmp/backfill-inbound-media.js --since=2026-10-02             # counts only
 *   docker exec <api-container> node /tmp/backfill-inbound-media.js --since=2026-10-02 --check     # + is each message still in the page?
 *   docker exec <api-container> node /tmp/backfill-inbound-media.js --since=2026-10-02 --apply --limit=50
 *
 * Options (all --key=value except the two switches):
 *   --since=YYYY-MM-DD   required; only messages created on/after this day
 *   --until=YYYY-MM-DD   optional; before this day
 *   --profile=<id>       optional; one profile only
 *   --types=a,b          default image,video,audio,ptt,document,sticker
 *   --limit=N            how many candidates per run, oldest first (default 20)
 *   --delay-ms=N         pause between downloads (default 400)
 *   --check              look each candidate up in the page, download nothing
 *   --apply              download and WRITE; without it the database is never modified
 *
 * Only messages that WhatsApp Web still holds can be recovered (a message the page no longer has is reported as
 * unavailable and left untouched), and only while the file is still on WhatsApp's servers.
 * Idempotent: a row that already has a `mimetype` is never touched. Prints no message text, URL or key.
 */
const fs = require('fs');
const path = require('path');

const KNOWN_TYPES = ['image', 'video', 'audio', 'ptt', 'document', 'sticker'];

function parseArgs(argv) {
  const o = { apply: false, check: false, since: null, until: null, profile: null, limit: 20, delayMs: 400, types: KNOWN_TYPES };
  for (const arg of argv) {
    if (arg === '--apply') { o.apply = true; continue; }
    if (arg === '--check') { o.check = true; continue; }
    const eq = arg.indexOf('=');
    const key = eq < 0 ? arg : arg.slice(0, eq);
    const value = eq < 0 ? '' : arg.slice(eq + 1);
    if (key === '--since' || key === '--until') {
      if (!(value.length === 10 && !Number.isNaN(Date.parse(value)))) throw new Error(`${key} must be YYYY-MM-DD`);
      o[key.slice(2)] = value;
    } else if (key === '--profile') {
      if (!value) throw new Error('--profile needs an id');
      o.profile = value;
    } else if (key === '--limit' || key === '--delay-ms') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < (key === '--limit' ? 1 : 0)) throw new Error(`${key} must be a whole number`);
      if (key === '--limit') o.limit = n; else o.delayMs = n;
    } else if (key === '--types') {
      const types = value.split(',').filter(Boolean);
      const bad = types.filter((t) => !KNOWN_TYPES.includes(t));
      if (!types.length || bad.length) throw new Error(`--types must be a list of: ${KNOWN_TYPES.join(', ')}`);
      o.types = types;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  if (!o.since) throw new Error('--since=YYYY-MM-DD is required');
  return o;
}

/**
 * The part of `content` to merge into a stored message, or null when there is nothing to store.
 * `applyInboundMedia` is the engine-runtime function the live path uses (size cap and all).
 */
function contentPatch(media, applyInboundMedia, maxBytes) {
  if (!media || !media.data) return null;
  const content = applyInboundMedia({ hasMedia: true }, media, maxBytes);
  const patch = {};
  for (const key of ['mimetype', 'filename', 'hasMedia', 'mediaBytes', 'url', 'mediaOmitted']) {
    if (content[key] !== undefined && content[key] !== null) patch[key] = content[key];
  }
  return patch;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tail = (id) => String(id).slice(-8);

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const APP = process.env.APP_ROOT || '/app';
  const PNPM = path.join(APP, 'node_modules', '.pnpm');
  const storeDir = (prefix) => {
    const d = fs.readdirSync(PNPM).find((n) => n.startsWith(prefix));
    if (!d) throw new Error(`${prefix}* not found in ${PNPM}`);
    return path.join(PNPM, d, 'node_modules');
  };
  const wwebRoot = path.join(storeDir('whatsapp-web.js@'), 'whatsapp-web.js');
  const puppeteer = require(require.resolve('puppeteer', { paths: [wwebRoot] }));
  const Message = require(path.join(wwebRoot, 'src', 'structures', 'Message.js'));
  const { Pool } = require(path.join(storeDir('pg@'), 'pg'));
  const { applyInboundMedia, inboundMediaMaxBytes } = require(path.join(APP, 'packages', 'engine-runtime'));
  const sessionsDir = process.env.SESSIONS_DIR || '/data/sessions';

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const params = [o.types, o.since, o.until, o.profile, o.limit];
    const { rows } = await pool.query(
      `SELECT id, "profileId", "messageId", type, "createdAt" FROM messages
        WHERE direction = 'incoming' AND type::text = ANY($1) AND "createdAt" >= $2::date
          AND ($3::date IS NULL OR "createdAt" < $3::date)
          AND ($4::text IS NULL OR "profileId" = $4)
          AND content ->> 'hasMedia' = 'true' AND NOT (content ? 'mimetype')
        ORDER BY "createdAt" ASC LIMIT $5`,
      params,
    );
    const byProfile = new Map();
    for (const r of rows) byProfile.set(r.profileId, [...(byProfile.get(r.profileId) || []), r]);
    console.log(`${rows.length} candidate message(s) (oldest first, limit ${o.limit}) in ${byProfile.size} profile(s)`);
    for (const [profileId, list] of byProfile) {
      const perType = {};
      for (const r of list) perType[r.type] = (perType[r.type] || 0) + 1;
      console.log(`  profile ${tail(profileId)}: ${JSON.stringify(perType)}  ${list[0].createdAt.toISOString().slice(0, 10)} .. ${list[list.length - 1].createdAt.toISOString().slice(0, 10)}`);
    }
    if (!o.check && !o.apply) { console.log('Nothing downloaded. Add --check to test lookups, or --apply to recover.'); return; }

    const totals = { found: 0, missing: 0, downloaded: 0, updated: 0, unavailable: 0, errors: 0, bytes: 0 };
    for (const [profileId, list] of byProfile) {
      const dir = path.join(sessionsDir, profileId, `session-${profileId}`);
      let browser;
      try {
        const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
        browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
      } catch (e) {
        console.log(`  profile ${tail(profileId)}: no running browser (${String(e.message).slice(0, 80)}), skipped`);
        totals.errors += list.length;
        continue;
      }
      try {
        const page = (await browser.pages()).find((p) => p.url().includes('web.whatsapp.com'));
        if (!page) { console.log(`  profile ${tail(profileId)}: no WhatsApp Web page, skipped`); totals.errors += list.length; continue; }
        for (const r of list) {
          try {
            if (o.check) {
              const found = await page.evaluate(async (id) => {
                const C = window.require('WAWebCollections');
                return !!(C.Msg.get(id) || (await C.Msg.getMessagesById([id]))?.messages?.[0]);
              }, r.messageId);
              totals[found ? 'found' : 'missing']++;
              continue;
            }
            // The installed library method, run against the live page (a fake `this` is all it reads).
            const fake = Object.create(Message.prototype);
            fake.hasMedia = true; fake.id = { _serialized: r.messageId }; fake.client = { pupPage: page };
            const patch = contentPatch(await fake.downloadMedia(), applyInboundMedia, inboundMediaMaxBytes());
            if (!patch) { totals.unavailable++; console.log(`  ${tail(r.messageId)} ${r.type}: unavailable`); }
            else {
              totals.downloaded++; totals.bytes += patch.mediaBytes || 0;
              const res = await pool.query(`UPDATE messages SET content = content || $1::jsonb WHERE id = $2 AND NOT (content ? 'mimetype')`, [JSON.stringify(patch), r.id]);
              totals.updated += res.rowCount;
              console.log(`  ${tail(r.messageId)} ${r.type}: ${patch.mimetype} ${patch.mediaBytes} B${patch.mediaOmitted ? ' (over the cap, not inlined)' : ''} -> ${res.rowCount ? 'stored' : 'already had media'}`);
            }
          } catch (e) {
            totals.errors++; console.log(`  ${tail(r.messageId)} ${r.type}: error ${String(e.message).slice(0, 120)}`);
          }
          await sleep(o.delayMs);
        }
      } finally {
        await browser.disconnect();
      }
    }
    console.log(o.check ? `check: ${totals.found} still in the page, ${totals.missing} not, ${totals.errors} error(s)`
      : `done: ${totals.downloaded} downloaded (${(totals.bytes / 1048576).toFixed(1)} MiB), ${totals.updated} stored, ${totals.unavailable} unavailable, ${totals.errors} error(s)`);
  } finally {
    await pool.end();
  }
}

module.exports = { parseArgs, contentPatch };

if (require.main === module) {
  main().catch((e) => { console.error(`backfill failed: ${String(e && e.message).slice(0, 200)}`); process.exit(1); });
}
