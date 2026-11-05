// MultiWA Admin - a customer: its numbers, what the lookup says, its tags and notes, and the chats and calls of its numbers
// apps/admin/src/app/dashboard/customers/[id]/page.tsx

'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MessagesSquare, PhoneIncoming, Trash2, Unlink, UserX } from 'lucide-react';
import { api, type CustomerHistoryItem, type CustomerLinkView, type CustomerView } from '@/lib/api';
import { canAct, canConfigure, currentUser } from '@/lib/current-user';
import { formatDateTime, formatFull } from '@/lib/datetime';
import { refocus } from '@/lib/focus';
import { CustomerDetails, useIdLabel } from '@/components/customers/customer-details';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

/** Where a history entry opens: the chat itself, or the Calls of the call's profile. */
const historyHref = (h: CustomerHistoryItem) =>
  h.kind === 'conversation' ? `/dashboard/chat?profile=${h.profileId}&conv=${h.id}` : `/dashboard/calls?profile=${h.profileId}`;

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  // An agent unlinks a number; an owner or admin deletes the customer.
  const [role] = useState(() => currentUser()?.role);
  const idLabel = useIdLabel();
  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const [failure, setFailure] = useState<{ status: number; error?: string } | null>(null);
  const [history, setHistory] = useState<CustomerHistoryItem[] | null>(null);
  const [historyFailure, setHistoryFailure] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0); // a Retry reads the history again
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const numbers = useRef<HTMLUListElement>(null);
  const noNumbers = useRef<HTMLParagraphElement>(null);
  // An unlink or the delete is on its way: one at a time. The buttons wait as aria-disabled, not disabled: the one
  // pressed keeps the focus.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    void api.getCustomer(id).then((res) => {
      if (stale) return;
      if (res.data?.id) setCustomer(res.data);
      else setFailure({ status: res.status, error: res.error });
    });
    return () => {
      stale = true;
    };
  }, [id]);

  useEffect(() => {
    let stale = false;
    void api.getCustomerHistory(id, 50).then((res) => {
      if (stale) return;
      setHistoryFailure(res.error ?? null);
      if (!res.error) setHistory(Array.isArray(res.data) ? res.data : []);
    });
    return () => {
      stale = true;
    };
  }, [id, historyAttempt]);

  const retryHistory = () => {
    historyHeading.current?.focus(); // Retry goes with the error: the focus moves to the heading, not to the page
    setHistoryFailure(null);
    setHistory(null);
    setHistoryAttempt((n) => n + 1);
  };

  /** `at`: the number's place in the list. */
  const unlink = async (link: CustomerLinkView, at: number) => {
    if (busy || !window.confirm(`Unlink +${link.phone}? The customer, its notes and its tags stay.`)) return;
    setBusy(true);
    const res = await api.unlinkCustomer(link.id);
    setBusy(false);
    if (res.error) {
      toast({ title: 'Could not unlink the number', description: res.error, variant: 'destructive' });
      return;
    }
    flushSync(() => setCustomer((c) => c && { ...c, links: c.links.filter((l) => l.id !== link.id) }));
    // The Unlink pressed went with its number: the focus goes on to the next number's, else to the line that says none is left.
    const buttons = numbers.current?.querySelectorAll('button');
    refocus(buttons?.[Math.min(at, buttons.length - 1)] ?? noNumbers.current);
    toast({ title: `+${link.phone} unlinked` });
  };

  const remove = async () => {
    if (busy || !customer || !window.confirm(`Delete ${idLabel} ${customer.externalId}, with its links and notes?`)) return;
    setBusy(true);
    const res = await api.deleteCustomer(customer.id);
    if (res.error) {
      setBusy(false);
      toast({ title: 'Could not delete the customer', description: res.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Customer deleted' });
    router.push('/dashboard/customers');
  };

  if (failure) {
    return (
      <EmptyState
        icon={<UserX className="w-8 h-8" aria-hidden="true" />}
        title={failure.status === 404 ? 'Customer not found' : 'Could not load the customer'}
        titleAs="h1"
        description={failure.status === 404 ? "It was deleted, or it is not one of your organization's." : failure.error}
        action={{ label: 'All customers', href: '/dashboard/customers' }}
      />
    );
  }
  if (!customer) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <Link href="/dashboard/customers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        All customers
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground break-words">{customer.displayName || customer.externalId}</h1>
          <p className="text-muted-foreground mt-1">{idLabel} <span className="font-mono">{customer.externalId}</span></p>
        </div>
        {canConfigure(role) && (
          <Button variant="destructive" aria-disabled={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden="true" />
            Delete customer
          </Button>
        )}
      </div>

      <section aria-labelledby="customer-numbers" className="bg-card rounded-2xl border border-border p-5 space-y-3">
        <h2 id="customer-numbers" className="font-semibold text-foreground">Numbers</h2>
        {customer.links.length === 0 ? (
          <p ref={noNumbers} tabIndex={-1} className="text-sm text-muted-foreground">No number is linked any more.</p>
        ) : (
          <ul ref={numbers} className="divide-y divide-border">
            {customer.links.map((l, at) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-foreground">+{l.phone}</p>
                  <p className="text-xs text-muted-foreground" title={formatFull(l.createdAt)}>
                    {`Linked ${formatDateTime(l.createdAt)}`}
                    {l.linkedBy ? ` by ${l.linkedBy.name}${l.linkedBy.type === 'apiKey' ? ' (API key)' : ''}` : ''}
                  </p>
                </div>
                {canAct(role) && (
                  <Button size="sm" variant="ghost" aria-label={`Unlink +${l.phone}`} aria-disabled={busy} onClick={() => void unlink(l, at)}>
                    <Unlink aria-hidden="true" />
                    Unlink
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="bg-card rounded-2xl border border-border p-5">
        <CustomerDetails customer={customer} onChange={setCustomer} headingLevel="h2" />
      </div>

      <section aria-labelledby="customer-history" className="bg-card rounded-2xl border border-border p-5 space-y-3">
        <h2 id="customer-history" ref={historyHeading} tabIndex={-1} className="font-semibold text-foreground">History</h2>
        {historyFailure ? (
          <div className="flex items-center justify-between gap-2">
            <p role="alert" className="text-sm text-red-400">{`Could not load the history: ${historyFailure}`}</p>
            <Button size="sm" variant="outline" onClick={retryHistory}>Retry</Button>
          </div>
        ) : history === null ? (
          <Skeleton className="h-16 w-full" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chats or calls with these numbers yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => {
              const Icon = h.kind === 'conversation' ? MessagesSquare : PhoneIncoming;
              return (
                <li key={`${h.kind}:${h.id}`}>
                  <Link
                    href={historyHref(h)}
                    className="flex items-center gap-3 rounded-lg py-2 hover:bg-secondary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm text-foreground">{h.summary}</span>
                      <span className="block text-xs text-muted-foreground">
                        {`${h.kind === 'conversation' ? 'Chat' : 'Call'} · ${h.profileName} · +${h.phone}`}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground" title={formatFull(h.at)}>{formatDateTime(h.at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
