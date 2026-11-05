'use client';
// One customer: what the organization's lookup says of it now, or the details typed by hand while no lookup is set
// up; its tags; the team's notes. The chat's customer panel, the call detail and the customer's page show it.
import { Fragment, useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { api, type CustomerNoteView, type CustomerView, type LookupField, type LookupResult } from '@/lib/api';
import { canAct, canConfigure, currentUser } from '@/lib/current-user';
import { formatFull, formatRelative } from '@/lib/datetime';
import { refocus } from '@/lib/focus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

/** The name of a customer's ID until the organization's own is read. */
export const DEFAULT_ID_LABEL = 'Customer ID';

/** What the organization calls a customer's ID, such as "ID Pelanggan", from its customer settings. */
export function useIdLabel() {
  const [label, setLabel] = useState(DEFAULT_ID_LABEL);
  useEffect(() => {
    let stale = false;
    void api.getCustomerConfig().then(({ data }) => {
      if (!stale && data?.idLabel) setLabel(data.idLabel);
    });
    return () => {
      stale = true;
    };
  }, []);
  return label;
}

/** The customer, as the page that shows it keeps it: the details change it in place. */
export type SetCustomer = Dispatch<SetStateAction<CustomerView | null>>;
type Heading = 'h2' | 'h4';

// The server's limits on what an agent types.
const MAX_FIELDS = 20;
const MAX_TAGS = 20;

/** Label and value pairs, as plain text: what a lookup sends comes from another system. */
function Pairs({ pairs }: { pairs: LookupField[] }) {
  if (!pairs.length) return null;
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 text-xs">
      {pairs.map((p, i) => (
        <Fragment key={i}>
          <dt className="text-muted-foreground break-words">{p.label}</dt>
          <dd className="text-foreground break-words">{p.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * One customer: what the lookup says of it now, with Refresh past the server's cache, or the details typed by hand
 * while no lookup is set up; its tags, beside `contactTags` (the number's contact's, read-only); the team's notes.
 * `headingLevel`: h4 inside a panel, h2 on the customer's page.
 */
export function CustomerDetails({ customer, onChange, contactTags, headingLevel = 'h4' }: {
  customer: CustomerView;
  onChange: SetCustomer;
  contactTags?: string[];
  headingLevel?: Heading;
}) {
  // A save answered after the page moved on to another customer is dropped, not applied to the one shown now.
  const change = useCallback<SetCustomer>(
    (next) => onChange((c) => (c?.id === customer.id ? (typeof next === 'function' ? next(c) : next) : c)),
    [onChange, customer.id],
  );
  // null until the first answer: a Refresh keeps what is shown until the next one comes.
  const [lookup, setLookup] = useState<LookupResult | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0); // only the newest read lands
  const askButton = useRef<HTMLButtonElement>(null);
  /** `pressed`: an agent asked, and the button pressed may give way to the one the answer shows. */
  const load = useCallback(async (refresh = false, pressed = false) => {
    const n = ++seq.current;
    setBusy(true);
    const res = await api.lookupCustomer(customer.id, refresh);
    if (n !== seq.current) return;
    const name = res.data?.state === 'ok' ? res.data.data?.name : undefined;
    flushSync(() => {
      setBusy(false);
      setLookup(res.data?.state ? res.data : 'failed');
      // The server keeps the name a lookup gives: the customer is called that from now on.
      if (name) change((c) => (c && c.displayName !== name ? { ...c, displayName: name } : c));
    });
    if (pressed) refocus(askButton.current);
  }, [customer.id, change]);
  useEffect(() => {
    void load();
  }, [load]);

  // aria-disabled, not disabled: the button keeps the focus while the lookup runs.
  const ask = (label: 'Refresh' | 'Retry', refresh: boolean) => (
    <Button ref={askButton} type="button" size="sm" variant={refresh ? 'ghost' : 'outline'} aria-disabled={busy} onClick={() => !busy && void load(refresh, true)}>
      <RefreshCw className={busy ? 'mw-spin' : undefined} aria-hidden="true" />
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      {lookup === null ? (
        <p role="status" className="text-xs text-muted-foreground">Looking up…</p>
      ) : lookup === 'failed' || lookup.state === 'unavailable' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-amber-300">The lookup is unavailable right now.</p>
          {ask('Retry', false)}
        </div>
      ) : lookup.state === 'not_found' ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Not found: the lookup has no customer with this ID.</p>
          {ask('Refresh', true)}
        </div>
      ) : lookup.state === 'not_configured' ? (
        <ManualFields customer={customer} onChange={change} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-foreground break-words">{lookup.data?.name || customer.displayName || customer.externalId}</p>
            {ask('Refresh', true)}
          </div>
          {/* Every part is optional in what an endpoint sends. */}
          <Pairs pairs={lookup.data?.fields ?? []} />
          {(lookup.data?.sections ?? []).map((s, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs font-semibold text-foreground break-words">{s.title}</p>
              <Pairs pairs={s.rows ?? []} />
            </div>
          ))}
        </div>
      )}
      <CustomerTags customer={customer} onChange={change} contactTags={contactTags} H={headingLevel} />
      <CustomerNotes customer={customer} onChange={change} H={headingLevel} />
    </div>
  );
}

/** The name and fields typed by hand while no lookup is set up: an agent edits them. */
function ManualFields({ customer, onChange }: { customer: CustomerView; onChange: SetCustomer }) {
  const { toast } = useToast();
  const [agent] = useState(() => canAct(currentUser()?.role));
  const nameId = useId();
  const [form, setForm] = useState<{ name: string; fields: LookupField[] } | null>(null); // null: not editing
  const [saving, setSaving] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);

  /** Closes the form, the customer saved or not, and gives the focus back to Edit details, which opened it. */
  const leave = (saved?: CustomerView) => {
    flushSync(() => {
      if (saved) onChange(saved);
      setForm(null);
    });
    refocus(editButton.current);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    const manualFields = form.fields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
      .filter((f) => f.label || f.value);
    const res = await api.updateCustomer(customer.id, { displayName: form.name.trim(), manualFields });
    setSaving(false);
    if (!res.data?.id) {
      // The form stays as typed: a lookup set up meanwhile answers 409.
      toast({ title: res.error ?? 'Could not save the details', variant: 'destructive' });
      return;
    }
    leave(res.data);
  };
  const setField = (i: number, part: Partial<LookupField>) =>
    setForm((f) => f && { ...f, fields: f.fields.map((x, j) => (j === i ? { ...x, ...part } : x)) });

  if (!form) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">No lookup is set up: these details are filled in by hand.</p>
        {customer.displayName && <p className="font-medium text-foreground break-words">{customer.displayName}</p>}
        <Pairs pairs={customer.manualFields ?? []} />
        {agent && (
          <Button
            ref={editButton}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setForm({ name: customer.displayName ?? '', fields: (customer.manualFields ?? []).map((f) => ({ ...f })) })}
          >
            <Pencil aria-hidden="true" />
            Edit details
          </Button>
        )}
      </div>
    );
  }
  return (
    <form onSubmit={save} className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor={nameId} className="text-xs">Name</Label>
        <Input id={nameId} autoFocus value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      {form.fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <Input aria-label={`Field ${i + 1} label`} placeholder="Label" value={f.label} maxLength={60} onChange={(e) => setField(i, { label: e.target.value })} />
          <Input aria-label={`Field ${i + 1} value`} placeholder="Value" value={f.value} maxLength={500} onChange={(e) => setField(i, { value: e.target.value })} />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove field ${i + 1}`}
            onClick={() => setForm({ ...form, fields: form.fields.filter((_, j) => j !== i) })}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
      {form.fields.length < MAX_FIELDS && (
        <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, fields: [...form.fields, { label: '', value: '' }] })}>
          <Plus aria-hidden="true" />
          Add field
        </Button>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => leave()}>Cancel</Button>
      </div>
    </form>
  );
}

/** The customer's tags, which an agent changes, and beside them the number's contact's, read-only. */
function CustomerTags({ customer, onChange, contactTags, H }: { customer: CustomerView; onChange: SetCustomer; contactTags?: string[]; H: Heading }) {
  const { toast } = useToast();
  const [agent] = useState(() => canAct(currentUser()?.role));
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);
  const tagInput = useRef<HTMLInputElement>(null);

  const save = async (tags: string[]) => {
    setSaving(true);
    const res = await api.updateCustomer(customer.id, { tags });
    setSaving(false);
    if (!res.data?.id) {
      toast({ title: res.error ?? 'Could not save the tags', variant: 'destructive' });
      return false;
    }
    flushSync(() => onChange(res.data));
    return true;
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = tag.trim();
    if (!t || saving) return;
    if (customer.tags.includes(t) || (await save([...customer.tags, t]))) setTag('');
  };
  const remove = async (t: string) => {
    if (await save(customer.tags.filter((x) => x !== t))) refocus(tagInput.current); // the button pressed went with its tag
  };

  return (
    <div className="space-y-2">
      <H className="text-xs font-semibold text-foreground">Tags</H>
      {customer.tags.length ? (
        <ul aria-label="Customer tags" className="flex flex-wrap gap-1">
          {customer.tags.map((t) => (
            <li key={t}>
              <Badge variant="secondary" className="gap-1 font-normal">
                {t}
                {agent && (
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    disabled={saving}
                    onClick={() => void remove(t)}
                    className="rounded-sm hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No tags yet.</p>
      )}
      {agent && customer.tags.length < MAX_TAGS && (
        <form onSubmit={add} className="flex gap-2">
          <Input ref={tagInput} aria-label="New tag" value={tag} maxLength={32} onChange={(e) => setTag(e.target.value)} className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={!tag.trim() || saving}>Add tag</Button>
        </form>
      )}
      {!!contactTags?.length && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">The contact's tags, read-only</p>
          <ul aria-label="Contact tags" className="flex flex-wrap gap-1">
            {contactTags.map((t) => (
              <li key={t}>
                <Badge variant="outline" className="font-normal">{t}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The team's notes, newest first: an agent adds them and changes their own; an owner or admin changes any. */
function CustomerNotes({ customer, onChange, H }: { customer: CustomerView; onChange: SetCustomer; H: Heading }) {
  const { toast } = useToast();
  const [me] = useState(() => currentUser());
  const agent = canAct(me?.role);
  const admin = canConfigure(me?.role);
  const newNoteId = useId();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const newNote = useRef<HTMLTextAreaElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>()); // each note's Edit button, by note
  const editButton = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) editButtons.current.set(id, el);
    else editButtons.current.delete(id);
  };
  // An API key's note is nobody's own: an owner or admin changes it.
  const mayChange = (n: CustomerNoteView) => admin || (agent && n.author?.type === 'user' && n.author.id === me?.id);
  const setNotes = (change: (notes: CustomerNoteView[]) => CustomerNoteView[]) => onChange((c) => c && { ...c, notes: change(c.notes) });
  /** Closes note `id`'s edit, `saved` or not, and gives the focus back to the Edit button that opened it. */
  const stopEditing = (id: string, saved?: CustomerNoteView) => {
    flushSync(() => {
      setEditing(null);
      if (saved) setNotes((notes) => notes.map((n) => (n.id === saved.id ? saved : n)));
    });
    refocus(editButtons.current.get(id));
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    const res = await api.addCustomerNote(customer.id, body);
    setBusy(false);
    const note = res.data;
    if (!note?.id) {
      toast({ title: res.error ?? 'Could not add the note', variant: 'destructive' });
      return;
    }
    setDraft('');
    setNotes((notes) => [note, ...notes]);
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = editing?.body.trim();
    if (!editing || !body || busy) return;
    setBusy(true);
    const res = await api.updateCustomerNote(customer.id, editing.id, body);
    setBusy(false);
    const note = res.data;
    if (!note?.id) {
      toast({ title: res.error ?? 'Could not save the note', variant: 'destructive' });
      return;
    }
    stopEditing(note.id, note);
  };
  const remove = async (note: CustomerNoteView) => {
    if (busy || !window.confirm('Delete this note?')) return;
    setBusy(true);
    const res = await api.deleteCustomerNote(customer.id, note.id);
    setBusy(false);
    if (res.error) {
      toast({ title: res.error, variant: 'destructive' });
      return;
    }
    flushSync(() => setNotes((notes) => notes.filter((n) => n.id !== note.id)));
    refocus(newNote.current); // the Delete pressed went with its note
  };

  return (
    <div className="space-y-2">
      <H className="text-xs font-semibold text-foreground">Notes</H>
      {agent && (
        <form onSubmit={add} className="space-y-1">
          <Label htmlFor={newNoteId} className="sr-only">New note</Label>
          <Textarea id={newNoteId} ref={newNote} rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="A note for the team" />
          <Button type="submit" size="sm" disabled={!draft.trim() || busy}>Add note</Button>
        </form>
      )}
      {customer.notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes yet.</p>
      ) : (
        <ul aria-label="Notes" className="space-y-2">
          {customer.notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-border p-2 space-y-1">
              {editing?.id === n.id ? (
                <form onSubmit={saveEdit} className="space-y-1">
                  <Textarea
                    aria-label="Edit note"
                    autoFocus
                    rows={3}
                    maxLength={2000}
                    value={editing.body}
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={!editing.body.trim() || busy}>Save note</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => stopEditing(n.id)}>Cancel</Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words">{n.body}</p>
              )}
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span title={formatFull(n.createdAt)}>
                  {n.author ? `${n.author.name}${n.author.type === 'apiKey' ? ' (API key)' : ''}` : 'Unknown'} · {formatRelative(n.createdAt)}
                </span>
                {mayChange(n) && editing?.id !== n.id && (
                  <span className="flex">
                    <Button ref={editButton(n.id)} type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Edit note" onClick={() => setEditing({ id: n.id, body: n.body })}>
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Delete note" onClick={() => void remove(n)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
