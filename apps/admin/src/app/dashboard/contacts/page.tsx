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
  Pencil,
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
  getContactMetadata,
} from '@/lib/contact-tags';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useI18n } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/contacts/TagInput';
import { ColorPicker } from '@/components/contacts/ColorPicker';
import { ColorFilter } from '@/components/contacts/ColorFilter';
import { Textarea } from '@/components/ui/textarea';
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

export default function ContactsPage() {
  const { t } = useI18n();
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
  
  const emptyContactForm = {
    name: '',
    phone: '',
    email: '',
    tags: [] as string[],
    tagColors: {} as Record<string, string>,
    contactColor: null as string | null,
    notes: '',
  };
  const [newContact, setNewContact] = useState(emptyContactForm);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editContact, setEditContact] = useState(emptyContactForm);

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
  // Server-side search + pagination. reset=true replaces the list (new query);
  // reset=false appends the next page ("Load more").
  const fetchContacts = async (reset = true) => {
    if (!selectedProfile) return;
    const offset = reset ? 0 : contacts.length;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
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

  const getContactColor = (contact: Contact): string | null => {
    const color = contact.metadata?.contactColor;
    return typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)
      ? color
      : null;
  };
  const allTags = [...new Set(contacts.flatMap(c => c.tags || []))];
  const allTagColors = [...new Set([
    ...collectTagColorFilters(contacts),
    ...contacts.map(getContactColor).filter((color): color is string => color !== null),
  ])];

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
      getContactColor(contact)?.toLowerCase() === selectedColor.toLowerCase() ||
      contact.tags?.some(tag => colorMap[tag]?.toLowerCase() === selectedColor.toLowerCase());
    return matchesSearch && matchesTag && matchesColor;
  });
  const displayContacts = filteredContacts;

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone) {
      toast({ title: t('contacts.requiredFields'), variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const metadata: Record<string, unknown> = {};
      metadata.tagColors = { ...newContact.tagColors };
      if (newContact.contactColor) {
        metadata.contactColor = newContact.contactColor;
      }
      if (newContact.tags.length === 1) {
        metadata.primaryTag = newContact.tags[0];
      }
      const res = await api.createContact({
        profileId: selectedProfile,
        name: newContact.name,
        phone: newContact.phone.replace(/\s+/g, '').replace(/-/g, ''),
        email: newContact.email || undefined,
        tags: newContact.tags.length ? newContact.tags : undefined,
        notes: newContact.notes || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      
      if (res.data) {
        toast({ title: t('contacts.addSuccess') });
        setNewContact(emptyContactForm);
        setIsDialogOpen(false);
        fetchContacts();
      } else {
        toast({ title: res.error || t('contacts.addFailed'), variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: t('contacts.addFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openEditContact = (contact: Contact) => {
    const md = contact.metadata ?? {};
    setEditingContact(contact);
    setEditContact({
      name: contact.name ?? '',
      phone: contact.phone,
      email: getContactEmail(contact) ?? '',
      tags: contact.tags ?? [],
      tagColors: getTagColorMap(contact),
      contactColor: getContactColor(contact),
      notes: typeof md.notes === 'string' ? md.notes : contact.notes ?? '',
    });
  };

  const handleEditContact = async () => {
    if (!editingContact || !editContact.name || !editContact.phone) return;
    setSaving(true);
    const newMeta: Record<string, unknown> = { ...(getContactMetadata(editingContact) as Record<string, unknown>) };
    if (editContact.email) newMeta.email = editContact.email;
    else delete newMeta.email;
    if (editContact.notes) newMeta.notes = editContact.notes;
    else delete newMeta.notes;
    if (Object.keys(editContact.tagColors).length > 0) newMeta.tagColors = editContact.tagColors;
    else delete newMeta.tagColors;
    if (editContact.contactColor) newMeta.contactColor = editContact.contactColor;
    else delete newMeta.contactColor;
    try {
      const res = await api.updateContact(editingContact.id, {
        name: editContact.name,
        phone: editContact.phone.replace(/\s+/g, '').replace(/-/g, ''),
        tags: editContact.tags,
        metadata: newMeta,
      });
      if (res.data) {
        toast({ title: t('contacts.save') });
        setEditingContact(null);
        fetchContacts();
      } else {
        toast({ title: res.error || t('contacts.save'), variant: 'destructive' });
      }
    } catch {
      toast({ title: t('contacts.save'), variant: 'destructive' });
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
    if (!confirm(t('contacts.deleteConfirm'))) return;
    
    try {
      await api.deleteContact(id);
      toast({ title: t('contacts.deleteSuccess') });
      fetchContacts();
    } catch (error) {
      toast({ title: t('contacts.deleteFailed'), variant: 'destructive' });
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
          <h1 className="text-2xl font-bold text-foreground">{t('contacts.title')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('contacts.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profiles.length > 0 && (
            <Select value={selectedProfile} onValueChange={setSelectedProfile}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder={t('contacts.selectProfile')} />
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
                      {profile.displayName || profile.name || t('common.unnamed')}
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
            {syncing ? t('contacts.syncing') : t('contacts.syncFromWhatsapp')}
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
                {t('contacts.import')}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t('contacts.import.title')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="import-file">{t('contacts.import.file')}</Label>
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
              {t('contacts.addContact')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('contacts.addNewContact')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('contacts.name')} *</Label>
                <Input
                  id="name"
                  value={newContact.name}
                  onChange={e => setNewContact(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('contacts.namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">{t('contacts.phone')} *</Label>
                <Input
                  id="phone"
                  value={newContact.phone}
                  onChange={e => setNewContact(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder={t('contacts.phonePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t('contacts.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={newContact.email}
                  onChange={e => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                  placeholder={t('contacts.emailPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('contacts.tags')}</Label>
                <TagInput
                  tags={newContact.tags}
                  tagColors={newContact.tagColors}
                  suggestions={allTags}
                  onChange={(tags, tagColors) =>
                    setNewContact(prev => ({ ...prev, tags, tagColors }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t('contacts.tagsHint')}
                </p>
              </div>
              <ColorPicker
                value={newContact.contactColor}
                onChange={color => setNewContact(prev => ({ ...prev, contactColor: color }))}
              />
              <div className="space-y-2">
                <Label htmlFor="notes">{t('contacts.notes')}</Label>
                <Textarea
                  id="notes"
                  value={newContact.notes}
                  onChange={e => setNewContact(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder={t('contacts.notesPlaceholder')}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>{t('contacts.cancel')}</Button>
              <Button onClick={handleAddContact} disabled={saving}>
                {saving ? t('contacts.saving') : t('contacts.addContact')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={editingContact !== null} onOpenChange={open => !open && setEditingContact(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('contacts.editContact')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">{t('contacts.name')} *</Label>
                <Input id="edit-name" value={editContact.name} onChange={e => setEditContact(prev => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">{t('contacts.phone')} *</Label>
                <Input id="edit-phone" value={editContact.phone} onChange={e => setEditContact(prev => ({ ...prev, phone: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">{t('contacts.email')}</Label>
                <Input id="edit-email" type="email" value={editContact.email} onChange={e => setEditContact(prev => ({ ...prev, email: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t('contacts.tags')}</Label>
                <TagInput tags={editContact.tags} tagColors={editContact.tagColors} suggestions={allTags} onChange={(tags, tagColors) => setEditContact(prev => ({ ...prev, tags, tagColors }))} />
              </div>
              <ColorPicker value={editContact.contactColor} onChange={color => setEditContact(prev => ({ ...prev, contactColor: color }))} />
              <div className="space-y-2">
                <Label htmlFor="edit-notes">{t('contacts.notes')}</Label>
                <Textarea id="edit-notes" value={editContact.notes} onChange={e => setEditContact(prev => ({ ...prev, notes: e.target.value }))} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingContact(null)}>{t('contacts.cancel')}</Button>
              <Button onClick={handleEditContact} disabled={saving}>{saving ? t('contacts.saving') : t('contacts.save')}</Button>
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
            <span className="text-muted-foreground">{t('contacts.statsContacts')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" aria-hidden="true" />
            <span className="font-semibold text-primary tabular-nums">{allTags.length}</span>
            <span className="text-muted-foreground">{t('contacts.statsTags')}</span>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      {hasLoaded && (contacts.length > 0 || !!search || !!selectedTag) && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('contacts.searchPlaceholder')}
              className="ps-10"
              aria-label={t('contacts.searchPlaceholder')}
            />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Button
              variant={selectedTag === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedTag(null)}
            >
              {t('contacts.allTags')}
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
            <ColorFilter
              colors={allTagColors}
              value={selectedColor}
              onChange={setSelectedColor}
            />
          </div>
        </div>
      )}

      {/* Contacts Table */}
      {loading && !hasLoaded ? (
        <div className="bg-card rounded-2xl border border-border p-4">
          <LoadingTable />
        </div>
      ) : displayContacts.length === 0 && !search && !selectedTag && !selectedColor ? (
        <EmptyContacts />
      ) : displayContacts.length === 0 ? (
        <div className="bg-card rounded-2xl p-12 border border-border text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground">
            <SearchX className="w-7 h-7" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">{t('contacts.noMatchesTitle')}</h3>
          <p className="text-muted-foreground">{t('contacts.noMatchesDesc')}</p>
        </div>
      ) : (
        <>
        <div className="hidden md:block bg-card rounded-2xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>{t('contacts.tableName')}</TableHead>
                <TableHead>{t('contacts.tablePhone')}</TableHead>
                <TableHead>{t('contacts.tableEmail')}</TableHead>
                <TableHead>{t('contacts.tableTags')}</TableHead>
                <TableHead className="text-end">{t('contacts.tableActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayContacts.map(contact => (
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
                  <TableCell className="text-end">
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
                        onClick={() => openEditContact(contact)}
                        aria-label={`Edit ${contact.name}`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
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
          {displayContacts.map(contact => (
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
                  <div className="flex items-center -mt-1 -me-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditContact(contact)}
                      aria-label={`Edit ${contact.name}`}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
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
              {loadingMore ? t('contacts.loadingMore') : t('contacts.loadMore', { loaded: contacts.length, total })}
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
            {t('contacts.tips.title')}
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              {t('contacts.tips.1')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              {t('contacts.tips.2')}
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5" aria-hidden="true">•</span>
              {t('contacts.tips.3')}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}