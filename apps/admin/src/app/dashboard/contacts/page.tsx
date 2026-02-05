// MultiWA Admin - Contacts Management
// apps/admin/src/app/dashboard/contacts/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api, Contact, Profile } from '@/lib/api';
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
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
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

  useEffect(() => {
    if (selectedProfile) {
      fetchContacts();
    }
  }, [selectedProfile]);

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
    if (!selectedProfile) return;
    setLoading(true);
    try {
      const res = await api.getContacts(selectedProfile);
      if (res.data) {
        // API returns { contacts: [...], total, limit, offset }
        const contactsList = (res.data as any).contacts || (Array.isArray(res.data) ? res.data : []);
        setContacts(contactsList);
      }
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
    } finally {
      setLoading(false);
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
          title: '✅ Contacts synced from WhatsApp',
          description: `Synced: ${res.data.synced}, Created: ${res.data.created}, Updated: ${res.data.updated}`,
        });
        fetchContacts(); // Refresh the list
      } else {
        toast({ title: 'Sync failed', description: res.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  // Get unique tags from all contacts
  const allTags = [...new Set(contacts.flatMap(c => c.tags || []))];

  // Filter contacts
  const filteredContacts = contacts.filter(contact => {
    const matchesSearch = !search || 
      contact.name?.toLowerCase().includes(search.toLowerCase()) ||
      contact.phone?.includes(search) ||
      contact.email?.toLowerCase().includes(search.toLowerCase());
    
    const matchesTag = !selectedTag ||
      contact.tags?.includes(selectedTag);
    
    return matchesSearch && matchesTag;
  });

  const handleAddContact = async () => {
    if (!newContact.name || !newContact.phone) {
      toast({ title: 'Name and phone are required', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await api.createContact({
        profileId: selectedProfile,
        name: newContact.name,
        phone: newContact.phone.replace(/\s+/g, '').replace(/-/g, ''),
        email: newContact.email || undefined,
        tags: newContact.tags ? newContact.tags.split(',').map(t => t.trim()) : undefined,
        notes: newContact.notes || undefined,
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
                      <div className={`w-2 h-2 rounded-full ${profile.status === 'connected' ? 'bg-green-500' : 'bg-gray-400'}`} />
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
          >
            {syncing ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {syncing ? 'Syncing...' : 'Sync from WhatsApp'}
          </Button>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
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
                  placeholder="customer, vip"
                />
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
      {!loading && contacts.length > 0 && (
        <div className="flex items-center gap-6 py-3 px-4 bg-secondary/30 rounded-xl text-sm">
          <div>
            <span className="font-semibold text-foreground">{contacts.length}</span>
            <span className="text-muted-foreground ml-1">Total contacts</span>
          </div>
          <div>
            <span className="font-semibold text-primary">{allTags.length}</span>
            <span className="text-muted-foreground ml-1">Tags</span>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      {!loading && contacts.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedTag === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedTag(null)}
            >
              All
            </Button>
            {allTags.slice(0, 5).map(tag => (
              <Button
                key={tag}
                variant={selectedTag === tag ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              >
                {tag}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Contacts Table */}
      {loading ? (
        <div className="bg-card rounded-2xl border border-border p-4">
          <LoadingTable />
        </div>
      ) : contacts.length === 0 ? (
        <EmptyContacts />
      ) : filteredContacts.length === 0 ? (
        <div className="bg-card rounded-2xl p-12 border border-border text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No matches found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
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
              {filteredContacts.map(contact => (
                <TableRow key={contact.id} className="group">
                  <TableCell>
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={contact.avatar} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {contact.name?.charAt(0)?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell className="text-muted-foreground">{contact.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{contact.email || '-'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {(contact.tags || []).slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {(contact.tags?.length || 0) > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{(contact.tags?.length || 0) - 3}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`/dashboard/messages?to=${contact.phone}`}>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDeleteContact(contact.id)}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Quick Tips */}
      {!loading && contacts.length > 0 && (
        <div className="bg-card rounded-2xl p-6 border border-border">
          <h3 className="font-semibold text-foreground mb-3">💡 Tips</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Use tags to organize contacts into groups for broadcasts
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Import contacts via CSV from the API
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary">•</span>
              Contacts are auto-saved when people message your profiles
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

