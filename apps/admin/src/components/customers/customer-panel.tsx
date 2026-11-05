'use client';
// The customer behind a WhatsApp number, in a chat's Contact Info and a call's detail: the IDs linked to the number
// (its default first), linking another, and the details of the one shown.
import { useEffect, useId, useState } from 'react';
import { api, type ApiResponse, type CustomerByPhoneItem, type CustomerView, type LookupResult } from '@/lib/api';
import { canAct, currentUser } from '@/lib/current-user';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CustomerDetails, useIdLabel } from './customer-details';

/** The number of a one-to-one chat's JID, digits only. A group, or a number WhatsApp hides (`@lid`), has none. */
export const phoneOfJid = (jid?: string | null): string | null =>
  (jid ?? '').match(/^(\d{8,15})@(?:s\.whatsapp\.net|c\.us)$/)?.[1] ?? null;

/** What the lookup says of an ID typed to link: a hint only, as an ID it does not know can still be linked. */
function previewText(res: ApiResponse<LookupResult>): string | null {
  if (res.status === 400) return res.error ?? null; // the server's rule for an ID
  const state = res.data?.state;
  if (state === 'ok') return res.data?.data?.name ? `Found: ${res.data.data.name}` : 'Found';
  if (state === 'not_found') return 'Not found';
  if (state === 'not_configured') return null; // no lookup to ask
  return "Can't check now";
}

/** `phone`: digits, country code first. `profileId`: the profile whose contact of the number lends its tags. */
export function CustomerPanel({ phone, profileId }: { phone: string; profileId?: string }) {
  const { toast } = useToast();
  // A viewer looks: picking an ID only switches what is shown, and there is nothing to link.
  const [agent] = useState(() => canAct(currentUser()?.role));
  const idLabel = useIdLabel();
  const headingId = useId();
  const pickerId = useId();
  const inputId = useId();
  const hintId = useId();
  const [linked, setLinked] = useState<CustomerByPhoneItem[] | null>(null); // null while being read
  const [selected, setSelected] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    void api.getCustomersByPhone(phone).then((res) => {
      if (stale) return;
      const list = Array.isArray(res.data) ? res.data : [];
      setLinked(list);
      setSelected(list[0]?.id ?? null); // the number's default
      if (res.error) setFailed(res.error);
    });
    // The search matches part of a number: the contact is the one whose number this is.
    if (profileId) {
      void api.getContacts(profileId, { search: phone, limit: 5 }).then((res) => {
        if (!stale) setContactTags(res.data?.contacts?.find((c) => c.phone === phone)?.tags ?? []);
      });
    }
    return () => {
      stale = true;
    };
  }, [phone, profileId]);

  useEffect(() => {
    setCustomer(null);
    if (!selected) return;
    let stale = false;
    void api.getCustomer(selected).then((res) => {
      if (stale) return;
      if (res.data?.id) {
        setCustomer(res.data);
        setFailed(null);
      } else setFailed(res.error ?? 'Could not read the customer');
    });
    return () => {
      stale = true;
    };
  }, [selected]);

  // The typed ID is checked once the typing pauses; a newer one drops the older one's answer.
  useEffect(() => {
    setPreview(null);
    const externalId = typed.trim();
    if (!externalId) return;
    let stale = false;
    const timer = setTimeout(() => {
      void api.previewCustomerLookup(externalId).then((res) => {
        if (!stale) setPreview(previewText(res));
      });
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [typed]);

  const pick = (id: string) => {
    setSelected(id);
    const item = linked?.find((c) => c.id === id);
    if (!agent || !item) return;
    // The ID an agent picked last is the number's default.
    void api.setDefaultCustomerLink(item.linkId).then((res) => {
      if (res.error) toast({ title: `Could not make ${item.externalId} the default`, description: res.error, variant: 'destructive' });
    });
  };

  const link = async (e: React.FormEvent) => {
    e.preventDefault();
    const externalId = typed.trim();
    if (!externalId || linking) return;
    setLinking(true);
    setLinkError(null);
    const res = await api.linkCustomer({ externalId, phone });
    setLinking(false);
    if (!res.data?.customer) {
      setLinkError(res.error ?? 'Could not link it');
      return;
    }
    const { customer: made, link: newLink, created } = res.data;
    // Shown at once and first: a new link is the number's newest, so its default.
    setLinked((prev) => [
      { id: made.id, externalId: made.externalId, displayName: made.displayName, linkId: newLink.id, lastUsedAt: newLink.lastUsedAt },
      ...(prev ?? []).filter((c) => c.id !== made.id),
    ]);
    setSelected(made.id);
    setTyped('');
    toast({ title: `${idLabel} ${made.externalId} ${created ? 'linked' : 'was already linked'}` });
  };

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-secondary/20 p-3 space-y-3">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">Customer</h3>
      {failed && <p role="alert" className="text-xs text-red-400">{failed}</p>}
      {linked === null ? (
        <p role="status" className="text-xs text-muted-foreground">Loading…</p>
      ) : linked.length === 0 ? (
        <p className="text-xs text-muted-foreground">{`No ${idLabel} is linked to this number yet.`}</p>
      ) : (
        <div className="space-y-1">
          <Label htmlFor={pickerId} className="text-xs text-muted-foreground">{idLabel}</Label>
          <Select value={selected ?? undefined} onValueChange={pick}>
            <SelectTrigger id={pickerId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {linked.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.displayName ? `${c.externalId} · ${c.displayName}` : c.externalId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {customer && <CustomerDetails key={customer.id} customer={customer} onChange={setCustomer} contactTags={contactTags} />}
      {agent && (
        <form onSubmit={link} className="space-y-1 border-t border-border pt-3">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">{`New ${idLabel}`}</Label>
          <Input
            id={inputId}
            value={typed}
            maxLength={64}
            autoComplete="off"
            aria-describedby={hintId}
            aria-invalid={!!linkError}
            onChange={(e) => {
              setTyped(e.target.value);
              setLinkError(null);
            }}
          />
          <p id={hintId} role="status" className="text-xs text-muted-foreground">{preview}</p>
          {linkError && <p role="alert" className="text-xs text-red-400">{linkError}</p>}
          <Button type="submit" size="sm" disabled={!typed.trim() || linking}>{`Link ${idLabel}`}</Button>
        </form>
      )}
    </section>
  );
}
