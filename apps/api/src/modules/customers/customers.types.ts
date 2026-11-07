// MultiWA Gateway API - customer profile types
// apps/api/src/modules/customers/customers.types.ts
//
// The shapes the /customers routes answer with. The dashboard mirrors them in apps/admin/src/lib/api.ts.

export type LookupState = 'ok' | 'not_found' | 'unavailable' | 'not_configured';
export interface LookupField { label: string; value: string }
export interface LookupSection { title: string; rows: LookupField[] }
export interface LookupData { id?: string; name?: string; fields: LookupField[]; sections: LookupSection[] }
export interface LookupResult { state: LookupState; data: LookupData | null; fetchedAt: string; cached: boolean }
export interface LookupTestResult extends LookupResult { latencyMs: number }

export interface ActorView { type: 'user' | 'apiKey'; id: string; name: string }
export interface CustomerLinkView { id: string; phone: string; lastUsedAt: string; createdAt: string; linkedBy: ActorView | null }
export interface CustomerNoteView { id: string; body: string; createdAt: string; updatedAt: string; author: ActorView | null }
export interface CustomerView {
  id: string; externalId: string; displayName: string | null; tags: string[]; manualFields: LookupField[];
  lastLookupAt: string | null; createdAt: string; updatedAt: string;
  links: CustomerLinkView[]; notes: CustomerNoteView[];          // notes: the 20 newest
}
export interface CustomerListItem {
  id: string; externalId: string; displayName: string | null; linkCount: number; noteCount: number; lastActivityAt: string | null;
}
export interface CustomerListPage { items: CustomerListItem[]; total: number; page: number; pageSize: number }
export interface CustomerByPhoneItem { id: string; externalId: string; displayName: string | null; linkId: string; lastUsedAt: string }
export interface CustomerHistoryItem {
  kind: 'conversation' | 'call'; id: string; profileId: string; profileName: string; phone: string; at: string; summary: string;
}
export interface CustomerConfigView { idLabel: string; lookupUrl: string | null; hasSecret: boolean; timeoutMs: number; configured: boolean }
export interface LinkResult { created: boolean; customer: CustomerView; link: CustomerLinkView }
