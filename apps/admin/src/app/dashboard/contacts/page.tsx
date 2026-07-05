// MultiWA Admin - Contacts Management
// apps/admin/src/app/dashboard/contacts/page.tsx

'use client';

import { useState, useEffect, type ChangeEvent } from 'react';
import {
  Plus,
  RefreshCw,
  Search,
  SearchX,
  MessageCircle,
  Trash2,
  Lightbulb,
  Users,
  Tag,
  Upload,
  Palette,
} from 'lucide-react';
import {
  api,
  Contact,
  ContactImportItem,
  ContactImportResult,
  Profile,
} from '@/lib/api';
import {
  collectTagColorFilters,
  getContactEmail,
  getTagBadgeStyle,
  getTagColorMap,
  parseContactsImportFile,
  parseTagInput,
} from '@/lib/contact-tags';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyContacts } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function ContactsPage() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importPreviewCount, setImportPreviewCount] = useState(0);
  const [importResult, setImportResult] = useState<ContactImportResult | null>(null);
  const [importItems, setImportItems] = useState<ContactImportItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // True once the first fetch has resolved. Search/stats bars gate on this
  // (not `loading`) so a search-triggered refetch never unmounts the search
  // input — which would otherwise steal focus mid-typing.
  const [hasLoaded, setHasLoaded] = useState(false);
  const PAGE_SIZE = 50;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  // New contact form
  const [newContact, setNewContact] = useState({
    name: '',
    phone: '',
    email: '',
    tags: '',
    notes: ''
  });

  useEffect(() => {
    loadProfiles();
  }, []);

  // Debounced server-side fetch whenever the profile, search, or tag changes.
  useEffect(() => {
    if (!selectedProfile) return;
    const t = setTimeout(() => fetchContacts(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfile, search, selectedTag]);

  const loadProfiles = async () => {
    const res = await api.getProfiles();
    if (res.data) {
      setProfiles(res.data);
      if (res.data.length > 0) {
        setSelectedProfile(res.data[0].id);
      }
    }
    if (!res.data?.length) setLoading(false);
  };
  const fetchContacts = async () => {


  // Server-side search + pagination. reset=true replaces the list (new query);
  // reset=false appends the next page ("Load more").
  const fetchContacts = async (reset = true) => {
    if (!selectedProfile) return;
    const offset = reset ? 0 : contacts.length;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const res = await api.getContacts(selectedProfile);
      if (res.data) {
        setContacts(res.data.contacts ?? []);
      }
      const res = await api.getContacts(selectedProfile, {
        search: search.trim() || undefined,
        tags: selectedTag || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      const data: any = res.data || {};
      const list: Contact[] = data.contacts || (Array.isArray(res.data) ? res.data : []);
      setTotal(typeof data.total === 'number' ? data.total : list.length);
      setContacts(prev => (reset ? list : [...prev, ...list]));
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setHasLoaded(true);
    }
  };

  const handleSyncFromWhatsApp = async () => {
    if (!selectedProfile) {
      toast({ title: 'Select a profile first', variant: 'destructive' });
      return;
    }
    setSyncing(true);
    try {
      const res = await api.syncContactsFromWhatsApp(selectedProfile);
      if (res.data) {
        toast({
          title: 'Contacts synced from WhatsApp',
          description: `Synced: ${res.data.synced}, Created: ${res.data.created}, Updated: ${res.data.updated}`,
        });
        fetchContacts(true); // Refresh the list
      } else {
        toast({ title: 'Sync failed', description: res.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const allTags = [...new Set(contacts.flatMap(c => c.tags || []))];
  const allTagColors = collectTagColorFilters(contacts);

  const filteredContacts = contacts.filter(contact => {
    const email = getContactEmail(contact);
    const matchesSearch =
      !search ||
      contact.name?.toLowerCase().includes(search.toLowerCase()) ||
      contact.phone?.includes(search) ||
      email?.toLowerCase().includes(search.toLowerCase());

    const matchesTag = !selectedTag || contact.tags?.includes(selectedTag);

    const colorMap = getTagColorMap(contact);
    const matchesColor =
      !selectedColor ||
      contact.tags?.some(
        tag => colorMap[tag]?.toLowerCase() === selectedColor.toLowerCase(),
      );

    return matchesSearch && matchesTag && matchesColor;
  });
  // Search + tag filtering are now server-side (see fetchContacts); render `contacts` directly.

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone) {
      toast({ title: 'Name and phone are required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const parsed = parseTagInput(newContact.tags);
      const metadata: Record<string, unknown> = {};
      if (Object.keys(parsed.tagColors).length > 0) {
        metadata.tagColors = parsed.tagColors;
      }
      if (parsed.primaryTag) {
        metadata.primaryTag = parsed.primaryTag;
      }
      const res = await api.createContact({
        profileId: selectedProfile,
        name: newContact.name,
        phone: newContact.phone.replace(/\s+/g, '').replace(/-/g, ''),
        email: newContact.email || undefined,
        tags: parsed.tags.length ? parsed.tags : undefined,
        notes: newContact.notes || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      
      if (res.data) {
        toast({ title: 'Contact added successfully' });
        setNewContact({ name: '', phone: '', email: '', tags: '', notes: '' });
        setIsDialogOpen(false);
        fetchContacts();
      } else {
        toast({ title: res.error || 'Failed to add contact', variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Failed to add contact', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImportFileName('');
      setImportPreviewCount(0);
      setImportItems([]);
      setImportResult(null);
      return;
    }
    setImportFileName(file.name);
    setImportResult(null);
    try {
      const text = await file.text();
      const items = parseContactsImportFile(text, file.name);
      setImportItems(items);
      setImportPreviewCount(items.length);
      if (!items.length) {
        toast({ title: 'No contacts found in file', variant: 'destructive' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid file format';
      toast({ title: 'Failed to parse file', description: message, variant: 'destructive' });
      setImportItems([]);
      setImportPreviewCount(0);
    }
  };

  const handleRunImport = async () => {
    if (!selectedProfile) {
      toast({ title: 'Select a profile first', variant: 'destructive' });
      return;
    }
    if (!importItems.length) {
      toast({ title: 'Choose a file with contacts first', variant: 'destructive' });
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await api.importContacts(selectedProfile, importItems);
      if (res.data) {
        setImportResult(res.data);
        toast({
          title: 'Import finished',
          description: `Created: ${res.data.created}, Updated: ${res.data.updated}, Failed: ${res.data.failed}`,
        });
        fetchContacts();
      } else {
        toast({ title: 'Import failed', description: res.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Import failed';
      toast({ title: 'Import failed', description: message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const renderContactTags = (contact: Contact) => {
    const colorMap = getTagColorMap(contact);
    const tags = contact.tags || [];
    return (
      <div className="flex gap-1 flex-wrap">
        {tags.slice(0, 3).map(tag => (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs border"
            style={getTagBadgeStyle(tag, colorMap)}
          >
            {tag}
          </Badge>
        ))}
        {tags.length > 3 && (
          <Badge variant="outline" className="text-xs">
            +{tags.length - 3}
          </Badge>
        )}
      </div>
    );
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    
    try {
      await api.deleteContact(id);
      toast({ title: 'Contact deleted' });
      fetchContacts();
    } catch (error) {
      toast({ title: 'Failed to delete contact', variant: 'destructive' });
    }
  };

  // Loading skeleton
  const LoadingTable = () => (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32 mb-2" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-muted-foreground mt-1">
            Manage your WhatsApp contacts and tags
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profiles.length > 0 && (
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map(profile => (
                  <SelectItem key={profile.id} value={profile.id}>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          profile.status === 'connected'
                            ? 'bg-primary shadow-[0_0_0_3px_rgb(34_197_94_/_0.15)]'
                            : 'bg-muted-foreground/40'
                        }`}
                        aria-hidden="true"
                      />
                      {profile.displayName || profile.name || 'Unnamed'}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleSyncFromWhatsApp}
            disabled={syncing || !selectedProfile}
            aria-label="Sync contacts from WhatsApp"
          >
            <RefreshCw
              className={`w-4 h-4 ${syncing ? 'mw-spin' : ''}`}
              aria-hidden="true"
            />
            {syncing ? 'Syncing...' : 'Sync from WhatsApp'}
          </Button>
          <Dialog
            open={isImportOpen}
            onOpenChange={open => {
              setIsImportOpen(open);
              if (!open) {
                setImportFileName('');
                setImportPreviewCount(0);
                setImportItems([]);
                setImportResult(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={!selectedProfile}>
                <Upload className="w-4 h-4" aria-hidden="true" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Import contacts</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="import-file">File (.json, .csv, .txt, .tsv)</Label>
                  <Input
                    id="import-file"
                    type="file"
                    accept=".json,.csv,.txt,.tsv,text/csv,text/plain,application/json"
                    onChange={handleImportFileChange}
                  />
                  {importFileName && (
                    <p className="text-sm text-muted-foreground">
                      {importFileName} — {importPreviewCount} contact{importPreviewCount === 1 ? '' : 's'} ready
                    </p>
                  )}
                </div>
                {importResult && (
                  <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm space-y-1">
                    <p>
                      Created: <span className="font-medium tabular-nums">{importResult.created}</span>
                      {' · '}
                      Updated: <span className="font-medium tabular-nums">{importResult.updated}</span>
                      {' · '}
                      Failed: <span className="font-medium tabular-nums">{importResult.failed}</span>
                    </p>
                    {importResult.errors?.length > 0 && (
                      <ul className="text-destructive text-xs list-disc pl-4 max-h-24 overflow-y-auto">
                        {importResult.errors.slice(0, 8).map((err, i) => (
                          <li key={`import-err-${i}`}>{err}</li>
                        ))}
                        {importResult.errors.length > 8 && (
                          <li>…and {importResult.errors.length - 8} more</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportOpen(false)}>Close</Button>
                <Button onClick={handleRunImport} disabled={importing || !importItems.length}>
                  {importing ? 'Importing…' : 'Run import'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-5 h-5" aria-hidden="true" />
              Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Contact</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={newContact.name}
                  onChange={e => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  value={newContact.phone}
                  onChange={e => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="628123456789"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={newContact.email}
                  onChange={e => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="john@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input
                  id="tags"
                  value={newContact.tags}
                  onChange={e => setNewContact(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="customer, vip, lead:#3b82f6"
                />
                <p className="text-xs text-muted-foreground">
                  Use tag:#hex for colored tags (e.g. vip:#22c55e).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={newContact.notes}
                  onChange={e => setNewContact(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional notes..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAddContact} disabled={saving}>
                {saving ? 'Saving...' : 'Add Contact'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Stats Bar */}
      {hasLoaded && (contacts.length > 0 || !!search || !!selectedTag) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 px-4 bg-secondary/40 border border-border/60 rounded-xl text-sm">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="font-semibold text-foreground tabular-nums">{total}</span>
            <span className="text-muted-foreground">Contacts</span>
          </div>
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="font-semibold text-primary tabular-nums">{allTags.length}</span>
            <span className="text-muted-foreground">Tags</span>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      {hasLoaded && (contacts.length > 0 || !!search || !!selectedTag) && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="pl-10"
              aria-label="Search contacts"
            />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              variant={selectedTag === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedTag(null)}
            >
              All tags
            </Button>
            {allTags.slice(0, 5).map(tag => (
              <Button
                key={tag}
                variant={selectedTag === tag ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              >
                {tag}
              </Button>
            ))}
            {allTagColors.length > 0 && (
              <>
                <span className="text-muted-foreground text-xs flex items-center gap-1 px-1">
                  <Palette className="w-3 h-3" aria-hidden="true" />
                  Color
                </span>
                <Button
                  variant={selectedColor === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedColor(null)}
                >
                  Any
                </Button>
                {allTagColors.map(color => (
                  <Button
                    key={color}
                    variant={selectedColor === color ? 'default' : 'outline'}
                    size="sm"
                    className="gap-2"
                    onClick={() => setSelectedColor(color === selectedColor ? null : color)}
                    aria-label={`Filter by color ${color}`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-border"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  </Button>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Contacts Table */}
      {loading && !hasLoaded ? (
        <div className="bg-card rounded-2xl border border-border p-4">
          <LoadingTable />
        </div>
      ) : contacts.length === 0 && !search && !selectedTag ? (
        <EmptyContacts />
      ) : contacts.length === 0 ? (
        <div className="bg-card rounded-2xl p-12 border border-border text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
            <SearchX className="w-7 h-7" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No matches found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-card rounded-2xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map(contact => (
                <TableRow key={contact.id} className="group">
                  <TableCell>
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={contact.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {contact.name?.charAt(0)?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{contact.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{contact.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{getContactEmail(contact) || <span className="text-muted-foreground/60">—</span>}</TableCell>
                  <TableCell>{renderContactTags(contact)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        aria-label={`Message ${contact.name}`}
                      >
                        <a href={`/dashboard/messages?to=${contact.phone}`}>
                          <MessageCircle className="w-4 h-4" aria-hidden="true" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteContact(contact.id)}
                        aria-label={`Delete ${contact.name}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-2">
          {contacts.map(contact => (
            <div key={contact.id} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
              <Avatar className="w-10 h-10 flex-shrink-0">
                <AvatarImage src={contact.avatar} />
                <AvatarFallback className="bg-primary/10 text-primary">
                  {contact.name?.charAt(0)?.toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground truncate">{contact.name}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 -mt-1 -mr-2 cursor-pointer"
                    onClick={() => handleDeleteContact(contact.id)}
                    aria-label={`Delete ${contact.name}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground font-mono">{contact.phone}</div>
                {getContactEmail(contact) && (
                  <div className="text-sm text-muted-foreground truncate">{getContactEmail(contact)}</div>
                )}
                {(contact.tags || []).length > 0 && (
                  <div className="mt-2">{renderContactTags(contact)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
        {contacts.length < total && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => fetchContacts(false)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : `Load more (${contacts.length} of ${total})`}
            </Button>
          </div>
        )}
        </>
      )}

      {/* Quick Tips */}
      {!loading && contacts.length > 0 && (
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h3 className="flex items-center gap-2 font-semibold text-foreground mb-3">
            <Lightbulb className="w-4 h-4 text-primary" aria-hidden="true" />
            Tips
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Use tags to organize contacts into groups for broadcasts
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Import contacts from JSON, CSV, or TXT using the Import button above
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              Contacts are auto-saved when people message your profiles
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}