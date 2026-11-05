'use client';
// Settings → Customers: where the customer panel reads a customer's details from (the organization's lookup endpoint),
// what the organization calls a customer's ID, and a test lookup. An owner or admin changes them; the others read them.
import { useEffect, useId, useState } from 'react';
import { api, type CustomerConfigView, type LookupTestResult } from '@/lib/api';
import { canConfigure, currentUser } from '@/lib/current-user';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

// The secret is never read back: a save keeps it, replaces it or clears it.
type Secret = { mode: 'keep' } | { mode: 'replace'; value: string } | { mode: 'clear' };

/** A test lookup's answer, in a line. */
function testText(r: LookupTestResult): string {
  if (r.state === 'not_configured') return 'No lookup URL is saved';
  const took = `(${r.latencyMs} ms)`;
  if (r.state === 'ok') return `${r.data?.name ? `Found: ${r.data.name}` : 'Found'} ${took}`;
  if (r.state === 'not_found') return `Not found ${took}`;
  return `Unavailable ${took}`;
}

export function CustomersSettings() {
  const { toast } = useToast();
  const [admin] = useState(() => canConfigure(currentUser()?.role));
  const titleId = useId();
  const labelId = useId();
  const urlId = useId();
  const timeoutId = useId();
  const secretId = useId();
  const newSecretId = useId();
  const testFieldId = useId();
  const resultId = useId();
  const [config, setConfig] = useState<CustomerConfigView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [form, setForm] = useState({ idLabel: '', lookupUrl: '', timeoutMs: '' });
  const [secret, setSecret] = useState<Secret>({ mode: 'keep' });
  const [saving, setSaving] = useState(false);
  const [testId, setTestId] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const show = (c: CustomerConfigView) => {
    setConfig(c);
    setForm({ idLabel: c.idLabel, lookupUrl: c.lookupUrl ?? '', timeoutMs: String(c.timeoutMs) });
    setSecret({ mode: 'keep' });
  };

  // Read before the form shows: a Save meanwhile would write the defaults over the stored settings.
  useEffect(() => {
    void api.getCustomerConfig().then((res) => {
      if (res.data?.idLabel) show(res.data);
      else setFailed(res.error ?? 'Could not read the customer settings');
    });
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || saving) return;
    setSaving(true);
    const res = await api.updateCustomerConfig({
      idLabel: form.idLabel.trim(),
      lookupUrl: form.lookupUrl.trim(), // empty: the lookup is off
      timeoutMs: Number(form.timeoutMs),
      // An empty replacement keeps the secret: only Clear removes it.
      ...(secret.mode === 'replace' && secret.value ? { secret: secret.value } : secret.mode === 'clear' ? { secret: '' } : {}),
    });
    setSaving(false);
    if (!res.data?.idLabel) {
      toast({ title: res.error ?? 'Could not save the customer settings', variant: 'destructive' });
      return;
    }
    show(res.data);
    toast({ title: 'Customer settings saved' });
  };

  const runTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const externalId = testId.trim();
    if (!externalId || testing) return;
    setTesting(true);
    setTested(null);
    const res = await api.testCustomerConfig(externalId);
    setTesting(false);
    setTested(res.data?.state ? testText(res.data) : res.error ?? 'The test failed');
  };

  return (
    <section aria-labelledby={titleId} className="bg-card rounded-2xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border bg-secondary/20">
        <h2 id={titleId} className="font-semibold text-foreground">Customers</h2>
        <p className="text-sm text-muted-foreground">
          Where the customer panel reads a customer's details from. Without a lookup URL, agents fill them in by hand.
        </p>
      </div>
      {failed ? (
        <p role="alert" className="p-6 text-sm text-red-400">{failed}</p>
      ) : !config ? (
        <div className="p-6">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          <form onSubmit={save}>
            <fieldset disabled={!admin || saving} className="min-w-0 space-y-4">
              <legend className="sr-only">Customer lookup</legend>
              {!admin && <p className="text-sm text-muted-foreground">Your role can read these settings but not change them.</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={labelId}>ID label</Label>
                  <Input id={labelId} required maxLength={40} value={form.idLabel} onChange={(e) => setForm({ ...form, idLabel: e.target.value })} />
                  <p className="text-xs text-muted-foreground">What your organization calls a customer's ID, such as "ID Pelanggan".</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={timeoutId}>Timeout (ms)</Label>
                  <Input
                    id={timeoutId}
                    type="number"
                    required
                    min={1000}
                    max={15000}
                    value={form.timeoutMs}
                    onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">From 1000 to 15000.</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={urlId}>Lookup URL</Label>
                <Input
                  id={urlId}
                  type="url"
                  value={form.lookupUrl}
                  placeholder="https://crm.example.com/customers/lookup"
                  onChange={(e) => setForm({ ...form, lookupUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">MultiWA adds ?id= and the customer's ID. Leave it empty to fill customers in by hand.</p>
              </div>
              <div role="group" aria-labelledby={secretId} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span id={secretId} className="text-sm font-medium text-foreground">Secret</span>
                  <Badge variant="outline">{config.hasSecret ? 'Set' : 'Not set'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Sent as a Bearer token. It is stored encrypted and never shown again.</p>
                {admin && secret.mode === 'keep' && (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setSecret({ mode: 'replace', value: '' })}>
                      {config.hasSecret ? 'Replace' : 'Add'}
                    </Button>
                    {config.hasSecret && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setSecret({ mode: 'clear' })}>Clear</Button>
                    )}
                  </div>
                )}
                {secret.mode === 'replace' && (
                  <div className="space-y-1">
                    <Label htmlFor={newSecretId}>New secret</Label>
                    <div className="flex gap-2">
                      <Input
                        id={newSecretId}
                        type="password"
                        autoComplete="new-password"
                        value={secret.value}
                        onChange={(e) => setSecret({ mode: 'replace', value: e.target.value })}
                        className="max-w-sm"
                      />
                      <Button type="button" size="sm" variant="ghost" onClick={() => setSecret({ mode: 'keep' })}>Cancel</Button>
                    </div>
                  </div>
                )}
                {secret.mode === 'clear' && (
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-amber-300">The secret is removed when you save.</p>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSecret({ mode: 'keep' })}>Cancel</Button>
                  </div>
                )}
              </div>
              {admin && <Button type="submit">{saving ? 'Saving…' : 'Save'}</Button>}
            </fieldset>
          </form>

          {admin && (
            <form onSubmit={runTest} className="space-y-2 border-t border-border pt-6">
              <Label htmlFor={testFieldId}>{`${config.idLabel} to test`}</Label>
              <div className="flex gap-2">
                <Input
                  id={testFieldId}
                  value={testId}
                  maxLength={64}
                  aria-describedby={resultId}
                  onChange={(e) => setTestId(e.target.value)}
                  className="max-w-xs"
                />
                <Button type="submit" variant="outline" disabled={!testId.trim() || testing}>{testing ? 'Testing…' : 'Test'}</Button>
              </div>
              <p id={resultId} role="status" className="text-sm text-foreground">{tested}</p>
              <p className="text-xs text-muted-foreground">The test uses the saved settings, past the cache.</p>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
