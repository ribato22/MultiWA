// MultiWA Admin - Customers: the organization's customer IDs, searched and paged by the server
// apps/admin/src/app/dashboard/customers/page.tsx

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IdCard, Search } from 'lucide-react';
import { api, type CustomerListPage } from '@/lib/api';
import { formatDateTime, formatFull } from '@/lib/datetime';
import { useIdLabel } from '@/components/customers/customer-details';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 25;

export default function CustomersPage() {
  const { toast } = useToast();
  const idLabel = useIdLabel();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [list, setList] = useState<CustomerListPage | null>(null); // null until the first answer
  const readFor = useRef(''); // the search the last read was for

  // A new search is asked once the typing pauses, a page turn at once; the page shown stays until the next one comes.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      readFor.current = q;
      void api.getCustomers({ q: q.trim() || undefined, page, pageSize: PAGE_SIZE }).then((res) => {
        if (stale) return;
        if (res.error) toast({ title: 'Could not load the customers', description: res.error, variant: 'destructive' });
        setList(Array.isArray(res.data?.items) ? res.data : { items: [], total: 0, page, pageSize: PAGE_SIZE });
      });
    }, q === readFor.current ? 0 : 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, page, toast]);

  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE_SIZE));
  const searched = q.trim();

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        <p className="text-muted-foreground mt-1">The customers your team has linked to WhatsApp numbers, with their notes.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1); // a search starts from the first page
          }}
          placeholder={`${idLabel}, number or name`}
          className="pl-10"
          aria-label="Search customers"
        />
      </div>

      {list === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : list.items.length === 0 ? (
        searched ? (
          <EmptyState icon={<Search className="w-8 h-8" aria-hidden="true" />} title="No customers match your search" description={`Nothing matches "${searched}".`} />
        ) : (
          <EmptyState
            icon={<IdCard className="w-8 h-8" aria-hidden="true" />}
            title="No customers yet"
            description={`Customers appear here once their ${idLabel} is linked to a WhatsApp number, from a chat's Contact Info or through the API.`}
          />
        )
      ) : (
        <>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{idLabel}</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Numbers</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/dashboard/customers/${c.id}`} className="text-primary hover:underline">{c.externalId}</Link>
                    </TableCell>
                    <TableCell className="text-foreground">{c.displayName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.linkCount}</TableCell>
                    <TableCell className="text-muted-foreground" title={c.lastActivityAt ? formatFull(c.lastActivityAt) : undefined}>
                      {c.lastActivityAt ? formatDateTime(c.lastActivityAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.noteCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-end gap-3">
              <span className="text-sm text-muted-foreground">{`Page ${page} of ${pages}`}</span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
