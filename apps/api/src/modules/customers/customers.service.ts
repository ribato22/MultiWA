// MultiWA Gateway API - Customers Service
// apps/api/src/modules/customers/customers.service.ts
//
// A customer is an ID in the organization's own system (externalId), linked to WhatsApp numbers: many to many, and the
// link a number used last is its default. Every read and write is scoped to the caller's organization: another
// organization's id answers 404. The service audits its own changes with the ids of what it made or changed, never a
// number, a note's text or a secret.

import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { assertWebhookUrlSafe, WebhookUrlError } from '@multiwa/engine-runtime';
import { encrypt } from '../../common/crypto/secret-box';
import { pageSize } from '../../common/page-size';
import { linkablePhone, normalizePhone } from '../../common/phone';
import { AuditAction, AuditService } from '../audit/audit.service';
import { ADMIN_ROLES } from '../auth/roles';
import { CustomerLookupService, readCustomerConfig, type CustomerConfig } from './customer-lookup.service';
import type {
  ActorView, CustomerByPhoneItem, CustomerConfigView, CustomerHistoryItem, CustomerLinkView, CustomerListPage, CustomerNoteView, CustomerView,
  LinkResult, LookupField, LookupResult, LookupTestResult,
} from './customers.types';

/** Who makes a request: the signed-in user, their organization and role, the API key it came with, and from where. */
export interface Actor {
  userId: string;
  organizationId: string;
  role: string;
  apiKeyId?: string;
  ip?: string;
  userAgent?: string;
}

/** What PATCH /customers/:id may change; its DTO holds these to their limits. */
export interface CustomerChanges {
  tags?: string[];
  displayName?: string | null;
  manualFields?: LookupField[];
}

/** What PUT /customers/config may change; its DTO holds these to their limits. */
export interface ConfigChanges {
  idLabel?: string;
  lookupUrl?: string;
  secret?: string;
  timeoutMs?: number;
}

const configView = (c: CustomerConfig): CustomerConfigView => ({
  idLabel: c.idLabel,
  lookupUrl: c.lookupUrl,
  hasSecret: c.lookupSecretEnc !== null,
  timeoutMs: c.timeoutMs,
  configured: c.lookupUrl !== null,
});

/** A customer's ID in the organization's system: 1 to 64 of A-Z, a-z, 0-9, '.', '_' and '-'. */
const EXTERNAL_ID = /^[A-Za-z0-9._-]{1,64}$/;

const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** The ID as stored: trimmed. Else 400 "Invalid customer ID". */
export function toExternalId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!EXTERNAL_ID.test(id)) throw new BadRequestException('Invalid customer ID');
  return id;
}

/** The number as stored (common/phone.ts). Else 400 "Invalid phone number": a group or an @lid has none. */
export function toPhone(raw: unknown): string {
  const phone = typeof raw === 'string' ? linkablePhone(raw) : null;
  if (!phone) throw new BadRequestException('Invalid phone number');
  return phone;
}

type Who = { userId: string | null; apiKeyId: string | null };
type LinkRow = { id: string; phone: string; lastUsedAt: Date; createdAt: Date; linkedByUserId: string | null; linkedByApiKeyId: string | null };
type NoteRow = { id: string; body: string; createdAt: Date; updatedAt: Date; authorUserId: string | null; authorApiKeyId: string | null };
type NameOf = (who: Who) => ActorView | null;

const linkedBy = (l: LinkRow): Who => ({ userId: l.linkedByUserId, apiKeyId: l.linkedByApiKeyId });
const authoredBy = (n: NoteRow): Who => ({ userId: n.authorUserId, apiKeyId: n.authorApiKeyId });

const linkView = (l: LinkRow, nameOf: NameOf): CustomerLinkView => ({
  id: l.id,
  phone: l.phone,
  lastUsedAt: l.lastUsedAt.toISOString(),
  createdAt: l.createdAt.toISOString(),
  linkedBy: nameOf(linkedBy(l)),
});

const noteView = (n: NoteRow, nameOf: NameOf): CustomerNoteView => ({
  id: n.id,
  body: n.body,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
  author: nameOf(authoredBy(n)),
});

/** The manual fields as stored: the {label, value} pairs of text, whatever else the JSON holds. */
const fieldsOf = (json: unknown): LookupField[] =>
  Array.isArray(json)
    ? json.filter((f) => typeof f?.label === 'string' && typeof f?.value === 'string').map((f) => ({ label: f.label, value: f.value }))
    : [];

/** The row `find` reads, else the one `create` makes; a create that loses a race to the same unique key reads the winner's. */
async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<{ row: T; created: boolean }> {
  const found = await find();
  if (found) return { row: found, created: false };
  try {
    return { row: await create(), created: true };
  } catch (e) {
    const winner = (e as { code?: string })?.code === 'P2002' ? await find() : null;
    if (!winner) throw e;
    return { row: winner, created: false };
  }
}

/**
 * A write to a row read a moment ago. A delete made in between takes the row: Prisma raises P2025 for a change to it and
 * P2003 for a create that points at it, and either answers 404 with this message. Any other error goes through.
 */
async function orNotFound<T>(write: Promise<T>, message: string): Promise<T> {
  try {
    return await write;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'P2025' || code === 'P2003') throw new NotFoundException(message);
    throw e;
  }
}

/** A note's text as stored: trimmed, of 1 to 2000 characters. */
function toNoteBody(raw: unknown): string {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (!body || body.length > 2000) throw new BadRequestException('A note has 1 to 2000 characters');
  return body;
}

/** The text as a pattern for contains and startsWith: Prisma hands a `%`, `_` or `\` in it to LIKE as it is, where it is a wildcard or an escape. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** A page number from the query: 1 unless it is a whole number of at least 1. */
const pageOf = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
};

/** The latest of these times, or null for none. */
const latest = (times: Date[]): string | null => (times.length ? new Date(Math.max(...times.map((t) => t.getTime()))).toISOString() : null);

/** A profile as the history names it. */
const lineName = (p: { displayName: string | null; phoneNumber: string | null }) => p.displayName ?? p.phoneNumber ?? '';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly lookups: CustomerLookupService,
    private readonly auditService: AuditService,
  ) {}

  /** A customer with its links (the default first), tags, manual fields and 20 newest notes, and who made each. */
  async findOne(organizationId: string, id: string): Promise<CustomerView> {
    const customer = await this.owned(organizationId, id);
    // The notes in a query of their own, which puts their LIMIT in the SQL.
    const [links, notes] = await Promise.all([
      prisma.customerLink.findMany({ where: { customerId: customer.id }, orderBy: { lastUsedAt: 'desc' } }),
      prisma.customerNote.findMany({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const nameOf = await this.names(organizationId, [...links.map(linkedBy), ...notes.map(authoredBy)]);
    return {
      id: customer.id,
      externalId: customer.externalId,
      displayName: customer.displayName,
      tags: customer.tags,
      manualFields: fieldsOf(customer.manualFields),
      lastLookupAt: customer.lastLookupAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      links: links.map((l) => linkView(l, nameOf)),
      notes: notes.map((n) => noteView(n, nameOf)),
    };
  }

  /** The customers linked to a number, the one it used last (its default) first. */
  async byPhone(organizationId: string, rawPhone: unknown): Promise<CustomerByPhoneItem[]> {
    const links = await prisma.customerLink.findMany({
      where: { organizationId, phone: toPhone(rawPhone) },
      orderBy: { lastUsedAt: 'desc' },
      include: { customer: { select: { id: true, externalId: true, displayName: true } } },
    });
    return links.map((l) => ({
      id: l.customer.id,
      externalId: l.customer.externalId,
      displayName: l.customer.displayName,
      linkId: l.id,
      lastUsedAt: l.lastUsedAt.toISOString(),
    }));
  }

  /**
   * Links a number to a customer ID, making the customer when the ID is new and the link when it is missing. A link
   * that exists is answered with created: false and becomes its number's default (its lastUsedAt is now); nothing else
   * changes, and nothing is audited.
   */
  async link(actor: Actor, rawExternalId: unknown, rawPhone: unknown): Promise<LinkResult> {
    const externalId = toExternalId(rawExternalId);
    const phone = toPhone(rawPhone);
    const { organizationId } = actor;
    const { row: customer } = await findOrCreate(
      () => prisma.customer.findUnique({ where: { organizationId_externalId: { organizationId, externalId } } }),
      () => prisma.customer.create({ data: { organizationId, externalId } }),
    );
    const { row: link, created } = await findOrCreate(
      () => prisma.customerLink.findUnique({ where: { customerId_phone: { customerId: customer.id, phone } } }),
      () =>
        orNotFound(
          prisma.customerLink.create({
            data: { organizationId, customerId: customer.id, phone, linkedByUserId: actor.userId, linkedByApiKeyId: actor.apiKeyId ?? null },
          }),
          'Customer not found',
        ),
    );
    if (created) this.audit(actor, AuditAction.CUSTOMER_LINK, customer.id, { customerId: customer.id, linkId: link.id });
    // Linking a number to an ID it already has says which ID the number is about now: it becomes the default.
    else await orNotFound(prisma.customerLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } }), 'Link not found');
    const view = await this.findOne(organizationId, customer.id);
    return { created, customer: view, link: view.links.find((l) => l.id === link.id) ?? linkView(link, () => null) };
  }

  /** Makes a link its number's default: the link a number used last is the one an agent sees first. */
  async useLink(actor: Actor, linkId: string): Promise<CustomerLinkView> {
    const link = await prisma.customerLink.findFirst({ where: { id: linkId, organizationId: actor.organizationId } });
    if (!link) throw new NotFoundException('Link not found');
    const used = await orNotFound(prisma.customerLink.update({ where: { id: link.id }, data: { lastUsedAt: new Date() } }), 'Link not found');
    return linkView(used, await this.names(actor.organizationId, [linkedBy(used)]));
  }

  /** Removes one link; the customer, its notes and its tags stay. */
  async unlink(actor: Actor, linkId: string): Promise<{ success: true }> {
    const link = await prisma.customerLink.findFirst({
      where: { id: linkId, organizationId: actor.organizationId },
      select: { id: true, customerId: true },
    });
    // deleteMany: a link removed meanwhile is not found either, rather than a failed delete.
    if (!link || (await prisma.customerLink.deleteMany({ where: { id: link.id } })).count === 0) throw new NotFoundException('Link not found');
    this.audit(actor, AuditAction.CUSTOMER_UNLINK, link.customerId, { customerId: link.customerId, linkId: link.id });
    return { success: true };
  }

  /** Changes the tags; the name and the manual fields only while no lookup is configured (they come from it then). */
  async update(actor: Actor, id: string, changes: CustomerChanges): Promise<CustomerView> {
    const customer = await this.owned(actor.organizationId, id);
    const manual = changes.displayName !== undefined || changes.manualFields !== undefined;
    if (manual && (await this.lookups.config(actor.organizationId)).lookupUrl) {
      throw new ConflictException('The name and the fields come from the lookup while one is configured');
    }
    await orNotFound(
      prisma.customer.update({
        where: { id: customer.id },
        data: {
          ...(changes.tags !== undefined ? { tags: [...new Set(changes.tags.map((t) => t.trim()).filter(Boolean))] } : {}),
          ...(changes.displayName !== undefined ? { displayName: changes.displayName?.trim() || null } : {}),
          ...(changes.manualFields !== undefined ? { manualFields: changes.manualFields.map(({ label, value }) => ({ label, value })) } : {}),
        },
      }),
      'Customer not found',
    );
    this.audit(actor, AuditAction.CUSTOMER_UPDATE, customer.id, { customerId: customer.id });
    return this.findOne(actor.organizationId, customer.id);
  }

  /** Deletes a customer; its links and notes go with it. */
  async remove(actor: Actor, id: string): Promise<{ success: true }> {
    const { count } = await prisma.customer.deleteMany({ where: { id, organizationId: actor.organizationId } });
    if (count === 0) throw new NotFoundException('Customer not found');
    this.audit(actor, AuditAction.CUSTOMER_DELETE, id, { customerId: id });
    return { success: true };
  }

  /** Customers by ID (prefix), name (anywhere in it), any case, or a number's digits; the recently changed first. */
  async list(organizationId: string, query: { q?: unknown; page?: unknown; pageSize?: unknown }): Promise<CustomerListPage> {
    const take = Math.min(pageSize(Number(query.pageSize), 25), 100);
    const page = pageOf(query.page);
    const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
    const where: any = { organizationId };
    if (q) {
      // A number's digits only for a query that is a number: an ID like AB-123 is no phone number. They are looked for as
      // typed and with a leading 0 read as 62: that 0 starts a local number (0811… is 62811…), or only a part of one (0001).
      const digits = /^[\d\s()+-]+$/.test(q) ? [...new Set([q.replace(/\D/g, ''), normalizePhone(q)])].filter(Boolean) : [];
      const text = likeLiteral(q);
      where.OR = [
        { externalId: { startsWith: text, mode: 'insensitive' } },
        { displayName: { contains: text, mode: 'insensitive' } },
        ...digits.map((d) => ({ links: { some: { phone: { contains: d } } } })),
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * take,
        take,
        include: {
          links: { select: { lastUsedAt: true } },
          // Each one's newest note. Prisma reads the times of the page's notes in full and keeps one each: fine for a
          // page of at most 100 customers; a groupBy would do if a customer ever had thousands of notes.
          notes: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { notes: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);
    return {
      items: rows.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        displayName: c.displayName,
        linkCount: c.links.length,
        noteCount: c._count.notes,
        lastActivityAt: latest([...c.links.map((l) => l.lastUsedAt), ...c.notes.map((n) => n.createdAt)]),
      })),
      total,
      page,
      pageSize: take,
    };
  }

  /** The notes, newest first. */
  async notes(organizationId: string, id: string, page?: unknown, size?: unknown): Promise<{ items: CustomerNoteView[]; total: number }> {
    const customer = await this.owned(organizationId, id);
    const take = Math.min(pageSize(Number(size), 20), 100);
    const where = { customerId: customer.id };
    const [rows, total] = await Promise.all([
      prisma.customerNote.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (pageOf(page) - 1) * take, take }),
      prisma.customerNote.count({ where }),
    ]);
    const nameOf = await this.names(organizationId, rows.map(authoredBy));
    return { items: rows.map((n) => noteView(n, nameOf)), total };
  }

  /** Adds a note, written by the caller (and the API key it came with). */
  async addNote(actor: Actor, id: string, rawBody: unknown): Promise<CustomerNoteView> {
    const body = toNoteBody(rawBody);
    const customer = await this.owned(actor.organizationId, id);
    const note = await orNotFound(
      prisma.customerNote.create({
        data: { customerId: customer.id, body, authorUserId: actor.userId, authorApiKeyId: actor.apiKeyId ?? null },
      }),
      'Customer not found',
    );
    this.audit(actor, AuditAction.CUSTOMER_NOTE_CREATE, customer.id, { customerId: customer.id, noteId: note.id });
    return noteView(note, await this.names(actor.organizationId, [authoredBy(note)]));
  }

  /** Edits a note: its author's own, or any for an owner or an admin. */
  async editNote(actor: Actor, id: string, noteId: string, rawBody: unknown): Promise<CustomerNoteView> {
    const body = toNoteBody(rawBody);
    const note = await this.changeableNote(actor, id, noteId);
    const edited = await orNotFound(prisma.customerNote.update({ where: { id: note.id }, data: { body } }), 'Note not found');
    this.audit(actor, AuditAction.CUSTOMER_NOTE_UPDATE, note.customerId, { customerId: note.customerId, noteId: note.id });
    return noteView(edited, await this.names(actor.organizationId, [authoredBy(edited)]));
  }

  /** Deletes a note, on the terms of an edit. */
  async deleteNote(actor: Actor, id: string, noteId: string): Promise<{ success: true }> {
    const note = await this.changeableNote(actor, id, noteId);
    if ((await prisma.customerNote.deleteMany({ where: { id: note.id } })).count === 0) throw new NotFoundException('Note not found');
    this.audit(actor, AuditAction.CUSTOMER_NOTE_DELETE, note.customerId, { customerId: note.customerId, noteId: note.id });
    return { success: true };
  }

  /**
   * The organization's one-to-one chats and calls with the customer's numbers, across its profiles, newest first. A chat
   * counts its messages; a call says its kind and outcome. Nothing of it is stored with the customer.
   */
  async history(organizationId: string, id: string, limit?: unknown): Promise<CustomerHistoryItem[]> {
    const customer = await this.owned(organizationId, id);
    const take = Math.min(pageSize(Number(limit), 20), 50);
    const links = await prisma.customerLink.findMany({ where: { customerId: customer.id }, select: { phone: true } });
    if (links.length === 0) return [];
    // Chats and calls are stored under @s.whatsapp.net, but a send keeps the @c.us of a JID it was given.
    const jids = links.flatMap(({ phone }) => [`${phone}@s.whatsapp.net`, `${phone}@c.us`]);
    const profile = { workspace: { organizationId } };
    const line = { select: { displayName: true, phoneNumber: true } } as const;
    const [chats, calls] = await Promise.all([
      prisma.conversation.findMany({
        where: { type: 'user', jid: { in: jids }, profile },
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        take,
        select: { id: true, profileId: true, jid: true, lastMessageAt: true, updatedAt: true, profile: line, _count: { select: { messages: true } } },
      }),
      prisma.call.findMany({
        where: { isGroup: false, fromJid: { in: jids }, profile },
        orderBy: { startedAt: 'desc' },
        take,
        select: { id: true, profileId: true, fromJid: true, startedAt: true, isVideo: true, outcome: true, profile: line },
      }),
    ]);
    const items: CustomerHistoryItem[] = [
      ...chats.map((c) => ({
        kind: 'conversation' as const,
        id: c.id,
        profileId: c.profileId,
        profileName: lineName(c.profile),
        phone: c.jid.split('@')[0],
        at: (c.lastMessageAt ?? c.updatedAt).toISOString(),
        summary: `${c._count.messages} message${c._count.messages === 1 ? '' : 's'}`,
      })),
      ...calls.map((c) => ({
        kind: 'call' as const,
        id: c.id,
        profileId: c.profileId,
        profileName: lineName(c.profile),
        phone: c.fromJid.split('@')[0],
        at: c.startedAt.toISOString(),
        summary: `${c.isVideo ? 'Video' : 'Voice'} call, ${c.outcome.replace(/_/g, ' ')}`,
      })),
    ];
    return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, take);
  }

  /**
   * The live lookup of a customer. An ok answer newer than the stored one leaves its name (for the list and the search)
   * and its time; nothing else of an answer is stored.
   */
  async lookup(actor: Actor, id: string, refresh: boolean): Promise<LookupResult> {
    const customer = await this.owned(actor.organizationId, id);
    const result = await this.lookups.lookup(actor.organizationId, customer.externalId, { userId: actor.userId, refresh });
    const fetchedAt = new Date(result.fetchedAt);
    if (result.state === 'ok' && (!customer.lastLookupAt || customer.lastLookupAt < fetchedAt)) {
      // updateMany: a customer deleted meanwhile is no error here.
      await prisma.customer.updateMany({
        where: { id: customer.id },
        data: { lastLookupAt: fetchedAt, ...(result.data?.name ? { displayName: result.data.name } : {}) },
      });
    }
    return result;
  }

  /** The lookup of an ID before it is linked, for an agent to check it: it stores nothing, and the lookup service bounds it per API key, else per user. */
  async preview(actor: Actor, rawExternalId: unknown): Promise<LookupResult> {
    return this.lookups.preview(actor.organizationId, toExternalId(rawExternalId), actor);
  }

  /** The note, when it is this customer's in the caller's organization (else 404) and the caller may change it (else 403). */
  private async changeableNote(actor: Actor, customerId: string, noteId: string) {
    const note = await prisma.customerNote.findFirst({ where: { id: noteId, customerId, customer: { organizationId: actor.organizationId } } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorUserId !== actor.userId && !ADMIN_ROLES.includes(actor.role)) {
      throw new ForbiddenException("Only a note's author, an owner or an admin changes it");
    }
    return note;
  }

  /** The lookup settings: whether a secret is set, never the secret. */
  async getConfig(organizationId: string): Promise<CustomerConfigView> {
    return configView(await this.lookups.config(organizationId));
  }

  /**
   * Changes the lookup settings in Organization.settings.customers. The URL passes the webhooks' SSRF rule here, and again
   * before each call; an empty one turns the lookup off. An omitted secret is kept and an empty one cleared; a new one
   * is stored encrypted, and no answer carries it.
   */
  async setConfig(actor: Actor, changes: ConfigChanges): Promise<CustomerConfigView> {
    // Checked and encrypted before the organization is locked: the URL check resolves its host, and the lock is not held for that.
    const patch: Partial<CustomerConfig> = {};
    if (changes.idLabel !== undefined) {
      const label = changes.idLabel.trim();
      if (!label || label.length > 40) throw new BadRequestException('The ID label has 1 to 40 characters');
      patch.idLabel = label;
    }
    if (changes.lookupUrl !== undefined) {
      const url = changes.lookupUrl.trim();
      if (url) {
        try {
          await assertWebhookUrlSafe(url);
        } catch (e) {
          if (e instanceof WebhookUrlError) throw new BadRequestException(e.message);
          throw e;
        }
      }
      patch.lookupUrl = url || null;
    }
    if (changes.secret !== undefined) patch.lookupSecretEnc = changes.secret ? encrypt(changes.secret) : null;
    if (changes.timeoutMs !== undefined) patch.timeoutMs = changes.timeoutMs;
    // The row is locked before the settings are read: a save that read them before another's write would write them back over it.
    const next = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${actor.organizationId} FOR UPDATE`;
      const org = await tx.organization.findUnique({ where: { id: actor.organizationId }, select: { settings: true } });
      const customers = { ...readCustomerConfig(org?.settings), ...patch };
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: { settings: { ...(org?.settings as object | null), customers } },
      });
      return customers;
    });
    this.lookups.forget(actor.organizationId);
    this.audit(actor, AuditAction.CUSTOMER_CONFIG_UPDATE, null, {});
    return configView(next);
  }

  /** One lookup with the saved settings, bypassing the cache, and how long it took. */
  async testConfig(organizationId: string, rawExternalId: unknown): Promise<LookupTestResult> {
    return this.lookups.test(organizationId, toExternalId(rawExternalId));
  }

  /** The caller's organization's customer, else 404: another organization's is not found either. */
  private async owned(organizationId: string, id: string) {
    const customer = await prisma.customer.findFirst({ where: { id, organizationId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  /** Who made each link or note: a key by its name, else its user by theirs; nobody for one since deleted. */
  private async names(organizationId: string, who: Who[]): Promise<NameOf> {
    const ids = (pick: (w: Who) => string | null) => [...new Set(who.map(pick).filter((id): id is string => !!id))];
    const [userIds, keyIds] = [ids((w) => w.userId), ids((w) => w.apiKeyId)];
    const [users, keys] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true } }) : [],
      keyIds.length ? prisma.apiKey.findMany({ where: { id: { in: keyIds }, user: { organizationId } }, select: { id: true, name: true } }) : [],
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name] as const));
    const keyName = new Map(keys.map((k) => [k.id, k.name] as const));
    return ({ userId, apiKeyId }) => {
      if (apiKeyId && keyName.has(apiKeyId)) return { type: 'apiKey', id: apiKeyId, name: keyName.get(apiKeyId)! };
      if (userId && userName.has(userId)) return { type: 'user', id: userId, name: userName.get(userId)! };
      return null;
    };
  }

  /** An audit entry with ids only. A failed one is logged, not thrown: the change is made by then. */
  private audit(actor: Actor, action: AuditAction, customerId: string | null, metadata: Record<string, string>): void {
    this.auditService
      .log({
        action,
        userId: actor.userId,
        organizationId: actor.organizationId,
        resourceType: 'customer',
        ...(customerId ? { resourceId: customerId } : {}),
        metadata,
        ip: actor.ip,
        userAgent: actor.userAgent,
      })
      .catch((e) => this.logger.warn(`The audit of ${action} failed: ${clean((e as Error)?.message ?? e)}`));
  }
}
