// MultiWA Gateway API - the customer lookup
// apps/api/src/modules/customers/lookup.ts
//
// An organization's own system says who a customer is, in a fixed format (LookupData). A 200 answer outside it is
// unavailable: a part of the wrong type, a text or a list past its limit. Every part is optional, `null` counts as
// absent, and unknown keys are dropped.

import type { LookupData, LookupField, LookupSection } from './customers.types';

/** The most bytes of an answer that are read. */
export const MAX_LOOKUP_BYTES = 64 * 1024;

const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Label-value pairs (the fields, a section's rows): at most `max`, a label of at most 60 characters, a value of 500. */
function pairs(v: unknown, max: number): LookupField[] | null {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: LookupField[] = [];
  for (const p of v) {
    if (!isText(p?.label, 60) || !isText(p?.value, 500)) return null;
    out.push({ label: p.label, value: p.value });
  }
  return out;
}

/** The answer as the API passes it on, or null when it breaks the format. */
export function parseLookupBody(body: unknown): LookupData | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { id, name, fields, sections } = body as Record<string, unknown>;
  if ((id != null && !isText(id, 64)) || (name != null && !isText(name, 200))) return null;
  const fieldList = pairs(fields, 50);
  if (!fieldList || (sections != null && (!Array.isArray(sections) || sections.length > 10))) return null;
  const sectionList: LookupSection[] = [];
  for (const s of (sections as any[] | null | undefined) ?? []) {
    const rows = pairs(s?.rows, 50);
    if (!rows || !isText(s?.title, 60)) return null;
    sectionList.push({ title: s.title, rows });
  }
  return {
    ...(id != null ? { id: id as string } : {}),
    ...(name != null ? { name: name as string } : {}),
    fields: fieldList,
    sections: sectionList,
  };
}
