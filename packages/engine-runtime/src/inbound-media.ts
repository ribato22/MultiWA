// MultiWA Gateway - Inbound media handling (shared engine runtime)
// packages/engine-runtime/src/inbound-media.ts
//
// Single implementation of "store a downloaded inbound WhatsApp media on the
// message content", shared by the api and worker engine-manager forks (which
// otherwise carry an identical copy and drift). Adds a size cap: arbitrarily
// large base64 data URLs in the messages table bloat Postgres and are a DoS
// vector, so oversized media is not inlined.

export interface InboundMediaLike {
  mimetype?: string;
  filename?: string;
  /** base64-encoded media payload (no data: prefix). */
  data?: string;
}

export interface InboundMediaContent {
  mimetype?: string;
  filename?: string;
  hasMedia?: boolean;
  url?: string;
  /** Set when the media exceeded the cap and was NOT inlined. */
  mediaOmitted?: boolean;
  /** Decoded size of the media in bytes (present whenever `data` was). */
  mediaBytes?: number;
}

const DEFAULT_MAX_INBOUND_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB

/** Cap for inlining inbound media as a base64 data URL. Override with MAX_INBOUND_MEDIA_BYTES. */
export function inboundMediaMaxBytes(): number {
  const n = Number(process.env.MAX_INBOUND_MEDIA_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_INBOUND_MEDIA_BYTES;
}

/** Decoded byte length of a base64 string (ignoring padding subtleties). */
function base64Bytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

/**
 * Populate `content` from a downloaded inbound media object. The base64 data URL
 * is inlined ONLY when it is under the size cap (default 5 MB); oversized media
 * is flagged (`mediaOmitted`) instead of stored, so a single large video can't
 * bloat the messages table / exhaust the DB. Returns the (mutated) content.
 */
export function applyInboundMedia<T extends InboundMediaContent>(
  content: T,
  media: InboundMediaLike | null | undefined,
  maxBytes: number = inboundMediaMaxBytes(),
): T {
  if (!media) return content;
  content.mimetype = media.mimetype;
  content.filename = media.filename;
  content.hasMedia = true;
  if (media.data) {
    const bytes = base64Bytes(media.data);
    content.mediaBytes = bytes;
    if (bytes <= maxBytes) {
      content.url = `data:${media.mimetype};base64,${media.data}`;
    } else {
      content.mediaOmitted = true;
    }
  }
  return content;
}
