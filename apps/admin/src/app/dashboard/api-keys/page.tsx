// MultiWA Admin - API Keys Page
// apps/admin/src/app/dashboard/api-keys/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

// API Key type
interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  lastUsed?: string;
  createdAt: string;
  expiresAt?: string;
}

// Available permissions
const PERMISSIONS = [
  { value: 'messages:read', label: 'Read Messages', group: 'Messages' },
  { value: 'messages:write', label: 'Send Messages', group: 'Messages' },
  { value: 'contacts:read', label: 'Read Contacts', group: 'Contacts' },
  { value: 'contacts:write', label: 'Manage Contacts', group: 'Contacts' },
  { value: 'profiles:read', label: 'Read Profiles', group: 'Profiles' },
  { value: 'profiles:write', label: 'Manage Profiles', group: 'Profiles' },
  { value: 'webhooks:read', label: 'Read Webhooks', group: 'Webhooks' },
  { value: 'webhooks:write', label: 'Manage Webhooks', group: 'Webhooks' },
  { value: 'broadcast:write', label: 'Send Broadcasts', group: 'Broadcast' },
];

export default function ApiKeysPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newKey, setNewKey] = useState<string>('');
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    permissions: [] as string[],
  });

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setLoading(true);
    const res = await api.getApiKeys();
    if (res.data) {
      setApiKeys(res.data);
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Please enter a name', variant: 'destructive' });
      return;
    }

    if (formData.permissions.length === 0) {
      toast({ title: 'Please select at least one permission', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await api.createApiKey({
        name: formData.name,
        permissions: formData.permissions,
      });
      if (res.data) {
        setNewKey(res.data.key);
        setShowCreateModal(false);
        setShowKeyModal(true);
        loadApiKeys();
        setFormData({ name: '', permissions: [] });
      }
    } catch (error) {
      toast({ title: 'Failed to create API key', variant: 'destructive' });
    }
    setSaving(false);
  };

  const confirmDelete = (apiKey: ApiKey) => {
    setKeyToDelete(apiKey);
    setShowDeleteDialog(true);
  };

  const handleDelete = async () => {
    if (!keyToDelete) return;
    
    const res = await api.deleteApiKey(keyToDelete.id);
    if (!res.error) {
      toast({ title: 'API key deleted' });
      loadApiKeys();
    } else {
      toast({ title: 'Failed to delete API key', variant: 'destructive' });
    }
    setShowDeleteDialog(false);
    setKeyToDelete(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const togglePermission = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const selectAllPermissions = () => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.length === PERMISSIONS.length 
        ? [] 
        : PERMISSIONS.map(p => p.value),
    }));
  };

  // Group permissions by category
  const groupedPermissions = PERMISSIONS.reduce((acc, perm) => {
    if (!acc[perm.group]) acc[perm.group] = [];
    acc[perm.group].push(perm);
    return acc;
  }, {} as Record<string, typeof PERMISSIONS>);

  // Render loading skeleton
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-40 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">API Keys</h1>
          <p className="text-muted-foreground mt-1">
            Manage API keys for external integrations
          </p>
        </div>
        <Button 
          onClick={() => setShowCreateModal(true)} 
          className="bg-[#25D366] hover:bg-[#128C7E]"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create API Key
        </Button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h4 className="font-medium text-blue-900 dark:text-blue-100">API Documentation</h4>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Use your API key in the <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">X-API-Key</code> header 
              or as Bearer token to authenticate requests.
            </p>
          </div>
        </div>
      </div>

      {/* API Keys Table */}
      {apiKeys.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="text-6xl mb-4">🔑</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No API Keys</h3>
          <p className="text-muted-foreground mb-6">
            Create an API key to integrate with external services
          </p>
          <Button 
            onClick={() => setShowCreateModal(true)} 
            className="bg-[#25D366] hover:bg-[#128C7E]"
          >
            Create Your First API Key
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map(apiKey => (
                <TableRow key={apiKey.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{apiKey.name}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-secondary/50 px-2 py-1 rounded font-mono">
                        {apiKey.key}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          copyToClipboard(apiKey.key);
                          toast({ title: 'Key prefix copied. Full key is only available at creation time.' });
                        }}
                        className="h-7 w-7 p-0"
                        title="Copy key prefix (full key only shown at creation)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(apiKey.permissions || []).slice(0, 2).map(p => (
                        <Badge key={p} variant="secondary" className="text-xs">
                          {p.split(':')[0]}
                        </Badge>
                      ))}
                      {(apiKey.permissions || []).length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{(apiKey.permissions || []).length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {apiKey.lastUsed 
                      ? new Date(apiKey.lastUsed).toLocaleDateString()
                      : 'Never'
                    }
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(apiKey.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmDelete(apiKey)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Usage Example */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4">Usage Example</h3>
        <div className="bg-secondary/30 rounded-lg p-4 font-mono text-sm overflow-x-auto">
          <pre className="text-muted-foreground">
{`curl -X POST https://api.example.com/api/v1/messages/send \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"profileId": "...", "to": "628xxx", "message": "Hello"}'`}
          </pre>
        </div>
      </div>

      {/* Create Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Create a new API key with specific permissions
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Key Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g., Production Integration"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Permissions</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={selectAllPermissions}
                  className="text-xs"
                >
                  {formData.permissions.length === PERMISSIONS.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              
              <div className="border border-border rounded-lg divide-y divide-border">
                {Object.entries(groupedPermissions).map(([group, perms]) => (
                  <div key={group} className="p-3">
                    <div className="text-xs font-medium text-muted-foreground uppercase mb-2">{group}</div>
                    <div className="space-y-2">
                      {perms.map(perm => (
                        <div key={perm.value} className="flex items-center gap-2">
                          <Checkbox
                            id={perm.value}
                            checked={formData.permissions.includes(perm.value)}
                            onCheckedChange={() => togglePermission(perm.value)}
                          />
                          <label htmlFor={perm.value} className="text-sm text-foreground cursor-pointer">
                            {perm.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={saving}
              className="bg-[#25D366] hover:bg-[#128C7E]"
            >
              {saving ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Key Display Modal */}
      <Dialog open={showKeyModal} onOpenChange={setShowKeyModal}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>🎉 API Key Created</DialogTitle>
            <DialogDescription>
              Copy your API key now. You won't be able to see it again!
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800 mb-4">
              <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="font-medium">Save this key securely!</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={newKey}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                onClick={() => copyToClipboard(newKey)}
                className="bg-[#25D366] hover:bg-[#128C7E]"
              >
                Copy
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowKeyModal(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke the API key "{keyToDelete?.name}". 
              Any integrations using this key will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
