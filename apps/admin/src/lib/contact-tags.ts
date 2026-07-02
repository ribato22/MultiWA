import type { CSSProperties } from 'react';

import type { Contact, ContactImportItem } from '@/lib/api';

export type ContactMetadata = {
  email?: string;
  notes?: string;
  primaryTag?: string;
  tagColors?: Record<string, string>;
  [key: string]: unknown;
};

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function getContactMetadata(contact: Contact): ContactMetadata {
  const raw = contact.metadata;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as ContactMetadata;
}

export function getContactEmail(contact: Contact): string | undefined {
  const meta = getContactMetadata(contact);
  if (typeof meta.email === 'string' && meta.email.trim()) {
    return meta.email;
  }
  return contact.email;
}

export function getContactNotes(contact: Contact): string | undefined {
  const meta = getContactMetadata(contact);
  if (typeof meta.notes === 'string' && meta.notes.trim()) {
    return meta.notes;
  }
  return contact.notes;
}

export function getTagColorMap(contact: Contact): Record<string, string> {
  const colors = getContactMetadata(contact).tagColors;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [tag, color] of Object.entries(colors)) {
    if (typeof color === 'string' && HEX_COLOR.test(color.trim())) {
      out[tag] = color.trim();
    }
  }
  return out;
}

export function getTagBadgeStyle(tag: string, colorMap: Record<string, string>): CSSProperties | undefined {
  const color = colorMap[tag];
  if (!color) return undefined;
  return {
    backgroundColor: `${color}22`,
    borderColor: color,
    color,
  };
}

export interface ParsedTagInput {
  tags: string[];
  tagColors: Record<string, string>;
  primaryTag?: string;
}


export function parseTagInput(raw: string): ParsedTagInput {
  const tags: string[] = [];
  const tagColors: Record<string, string> = {};
  let primaryTag: string | undefined;

  for (const part of raw.split(',').map(p => p.trim()).filter(Boolean)) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      const name = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      if (!name) continue;
      if (HEX_COLOR.test(value)) {
        tagColors[name] = value;
        if (!tags.includes(name)) tags.push(name);
        continue;
      }
    }
    if (!tags.includes(part)) tags.push(part);
  }

  if (tags.length === 1) {
    primaryTag = tags[0];
  }

  return { tags, tagColors, primaryTag };
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function parseDelimitedRow(line: string, delimiter: ',' | '\t' | ';'): string[] {
  if (delimiter === ',') {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
  }

  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

function detectDelimiter(headerLine: string): ',' | '\t' | ';' {
  const counts = {
    ',': (headerLine.match(/,/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
  };
  if (counts['\t'] >= counts[','] && counts['\t'] >= counts[';'] && counts['\t'] > 0) return '\t';
  if (counts[';'] > counts[',']) return ';';
  return ',';
}

function parseMetadataField(raw?: string): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function buildImportItem(
  phone: string,
  name?: string,
  tagsRaw?: string,
  metadataRaw?: string,
  primaryTag?: string,
): ContactImportItem | null {
  const normalized = normalizePhoneDigits(phone);
  if (!normalized) return null;

  const tags =
    tagsRaw?.trim()
      ? tagsRaw.split(/[;,]/).map(t => t.trim()).filter(Boolean)
      : undefined;

  let metadata = parseMetadataField(metadataRaw) ?? {};
  if (primaryTag?.trim()) {
    metadata = { ...metadata, primaryTag: primaryTag.trim() };
  }

  const item: ContactImportItem = { phone: normalized };
  if (name?.trim()) item.name = name.trim();
  if (tags?.length) item.tags = tags;
  if (Object.keys(metadata).length > 0) item.metadata = metadata;
  return item;
}

export function parseContactsImportFile(text: string, fileName: string): ContactImportItem[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    const parsed: unknown = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const items: ContactImportItem[] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const record = row as Record<string, unknown>;
      const phone = String(record.phone ?? record.Phone ?? record.number ?? '').trim();
      const item = buildImportItem(
        phone,
        typeof record.name === 'string' ? record.name : undefined,
        Array.isArray(record.tags) ? record.tags.join(';') : typeof record.tags === 'string' ? record.tags : undefined,
        typeof record.metadata === 'object' && record.metadata !== null ? JSON.stringify(record.metadata) : undefined,
        typeof record.primaryTag === 'string' ? record.primaryTag : undefined,
      );
      if (item) items.push(item);
    }
    return items;
  }

  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headerCols = parseDelimitedRow(lines[0], delimiter).map(h => h.trim().toLowerCase());
  const phoneIdx = headerCols.findIndex(h => ['phone', 'number', 'mobile', 'whatsapp'].includes(h));
  const nameIdx = headerCols.findIndex(h => ['name', 'fullname', 'full_name'].includes(h));
  const tagsIdx = headerCols.findIndex(h => ['tags', 'tag', 'labels'].includes(h));
  const metadataIdx = headerCols.findIndex(h => ['metadata', 'meta', 'json'].includes(h));
  const primaryTagIdx = headerCols.findIndex(h => ['primarytag', 'primary_tag', 'primary'].includes(h));

  const hasHeader = phoneIdx >= 0;
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const items: ContactImportItem[] = [];

  if (!hasHeader) {
    for (const line of dataLines) {
      const phone = line.split(/[,;\t]/)[0]?.trim() || line.trim();
      const item = buildImportItem(phone);
      if (item) items.push(item);
    }
    return items;
  }

  for (const line of dataLines) {
    const cols = parseDelimitedRow(line, delimiter);
    const item = buildImportItem(
      cols[phoneIdx] ?? '',
      nameIdx >= 0 ? cols[nameIdx] : undefined,
      tagsIdx >= 0 ? cols[tagsIdx] : undefined,
      metadataIdx >= 0 ? cols[metadataIdx] : undefined,
      primaryTagIdx >= 0 ? cols[primaryTagIdx] : undefined,
    );
    if (item) items.push(item);
  }

  return items;
}

export function collectTagColorFilters(contacts: Contact[]): string[] {
  const colors = new Set<string>();
  for (const contact of contacts) {
    for (const color of Object.values(getTagColorMap(contact))) {
      colors.add(color.toLowerCase());
    }
  }
  return [...colors].sort();
}