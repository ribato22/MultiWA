// MultiWA Gateway - Chat JID resolution (shared engine runtime)
// packages/engine-runtime/src/jid.ts
//
// The JID a chat is stored under. Same rule as handleInboundMessage (inbound-message.ts):
// whatsapp-web.js `@c.us` becomes `@s.whatsapp.net`, and a DM from an `@lid` identity
// maps to the phone JID when the engine can resolve it.

export type IdentityResolver = (jid: string) => Promise<{ phoneJid?: string | null; name?: string | null } | null | undefined>;

export interface ResolvedChatJid {
  jid: string;
  /** The @lid the chat arrived under, when it did. */
  lidJid: string | null;
  name?: string;
}

/**
 * The JID a chat is stored under. Pass the engine's resolver bound
 * (`engine.resolveIdentity.bind(engine)`); unresolved means `jid === lidJid`.
 */
export async function resolveChatJid(
  raw: string,
  resolveIdentity: IdentityResolver | null | undefined,
  onError: (err: Error) => void,
): Promise<ResolvedChatJid> {
  if (raw.includes('@g.us')) return { jid: raw, lidJid: null };
  let jid = raw.replace('@c.us', '@s.whatsapp.net');
  if (!jid.includes('@lid')) return { jid, lidJid: null };
  const lidJid = jid;
  let name: string | undefined;
  if (resolveIdentity) {
    try {
      const ident = await resolveIdentity(jid);
      if (ident?.phoneJid) jid = ident.phoneJid;
      if (ident?.name) name = ident.name;
    } catch (err) {
      onError(err as Error);
    }
  }
  return name ? { jid, lidJid, name } : { jid, lidJid };
}
