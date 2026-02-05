// MultiWA Admin - Templates Page
// apps/admin/src/app/dashboard/templates/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { api, Profile, Template } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

// Template categories
const CATEGORIES = [
  { value: 'greeting', label: 'Greeting', icon: '👋' },
  { value: 'promotion', label: 'Promotion', icon: '🎉' },
  { value: 'notification', label: 'Notification', icon: '🔔' },
  { value: 'support', label: 'Support', icon: '💬' },
  { value: 'reminder', label: 'Reminder', icon: '⏰' },
  { value: 'thankyou', label: 'Thank You', icon: '🙏' },
  { value: 'other', label: 'Other', icon: '📝' },
];

// Variable hints
const VARIABLE_HINTS = [
  { name: '{{name}}', desc: 'Contact name' },
  { name: '{{phone}}', desc: 'Phone number' },
  { name: '{{date}}', desc: 'Current date' },
  { name: '{{time}}', desc: 'Current time' },
];

export default function TemplatesPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: 'other',
    content: '',
  });

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadTemplates();
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
    setLoading(false);
  };

  const loadTemplates = async () => {
    setLoading(true);
    const res = await api.getTemplates(selectedProfile);
    if (res.data) {
      setTemplates(res.data);
    }
    setLoading(false);
  };

  const openCreateModal = () => {
    setEditingTemplate(null);
    setFormData({ name: '', category: 'other', content: '' });
    setShowModal(true);
  };

  const openEditModal = (template: Template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      category: template.category || 'other',
      content: typeof template.content === 'object' ? template.content.text || '' : template.content,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      toast({ title: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (editingTemplate) {
        // Update existing template
        const res = await api.updateTemplate(editingTemplate.id, {
          name: formData.name,
          category: formData.category,
          content: { text: formData.content },
        });
        if (res.data) {
          toast({ title: 'Template updated successfully' });
          loadTemplates();
        }
      } else {
        // Create new template
        const res = await api.createTemplate({
          profileId: selectedProfile,
          name: formData.name,
          messageType: 'text',
          content: { text: formData.content },
          category: formData.category,
        });
        if (res.data) {
          toast({ title: 'Template created successfully' });
          loadTemplates();
        }
      }
      setShowModal(false);
    } catch (error) {
      toast({ title: 'Failed to save template', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleDelete = async (template: Template) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    
    const res = await api.deleteTemplate(template.id);
    if (!res.error) {
      toast({ title: 'Template deleted' });
      loadTemplates();
    } else {
      toast({ title: 'Failed to delete template', variant: 'destructive' });
    }
  };

  const handleDuplicate = async (template: Template) => {
    const res = await api.duplicateTemplate(template.id, `${template.name} (Copy)`);
    if (res.data) {
      toast({ title: 'Template duplicated' });
      loadTemplates();
    }
  };

  const insertVariable = (variable: string) => {
    setFormData(prev => ({
      ...prev,
      content: prev.content + variable,
    }));
  };

  // Filter templates
  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Render loading skeleton
  if (loading && templates.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Templates</h1>
          <p className="text-muted-foreground mt-1">Create and manage message templates</p>
        </div>
        <Button onClick={openCreateModal} className="bg-[#25D366] hover:bg-[#128C7E]">
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Template
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Select value={selectedProfile} onValueChange={setSelectedProfile}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Select profile" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map(profile => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.displayName || profile.name || 'Unnamed'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(cat => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.icon} {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{templates.length}</div>
          <div className="text-sm text-muted-foreground">Total Templates</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {templates.filter(t => t.category === 'greeting').length}
          </div>
          <div className="text-sm text-muted-foreground">Greetings</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {templates.filter(t => t.category === 'promotion').length}
          </div>
          <div className="text-sm text-muted-foreground">Promotions</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">
            {templates.reduce((sum, t) => sum + (t.usageCount || 0), 0)}
          </div>
          <div className="text-sm text-muted-foreground">Total Uses</div>
        </div>
      </div>

      {/* Templates Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Templates Yet</h3>
          <p className="text-muted-foreground mb-6">
            Create message templates to save time and ensure consistency
          </p>
          <Button onClick={openCreateModal} className="bg-[#25D366] hover:bg-[#128C7E]">
            Create Your First Template
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map(template => {
            const category = CATEGORIES.find(c => c.value === template.category) || CATEGORIES[6];
            const content = typeof template.content === 'object' ? template.content.text || '' : template.content;
            
            return (
              <div
                key={template.id}
                className="bg-card rounded-xl border border-border p-5 hover:shadow-lg transition-all duration-200 group"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{category.icon}</span>
                    <Badge variant="secondary" className="text-xs">
                      {category.label}
                    </Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditModal(template)}>
                        ✏️ Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(template)}>
                        📋 Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => handleDelete(template)}
                        className="text-red-600"
                      >
                        🗑️ Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Name */}
                <h3 className="font-semibold text-foreground mb-2 truncate">{template.name}</h3>

                {/* Preview */}
                <div className="bg-secondary/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                    {content}
                  </p>
                </div>

                {/* Variables */}
                {template.variables && template.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {template.variables.map((v, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-mono">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border">
                  <span>Used {template.usageCount || 0} times</span>
                  <span>{new Date(template.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate ? 'Update your message template' : 'Create a reusable message template'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Template Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="e.g., Welcome Message"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Category</label>
              <Select
                value={formData.category}
                onValueChange={v => setFormData(prev => ({ ...prev, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.icon} {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Content */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  Message Content <span className="text-red-500">*</span>
                </label>
                <span className="text-xs text-muted-foreground">
                  {formData.content.length} characters
                </span>
              </div>
              <Textarea
                placeholder="Type your message here...&#10;&#10;Use {{name}} for personalization"
                value={formData.content}
                onChange={e => setFormData(prev => ({ ...prev, content: e.target.value }))}
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            {/* Variable Hints */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Quick Variables</label>
              <div className="flex flex-wrap gap-2">
                {VARIABLE_HINTS.map(v => (
                  <Button
                    key={v.name}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(v.name)}
                    className="text-xs font-mono"
                  >
                    {v.name}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Click to insert variables that will be replaced with actual values
              </p>
            </div>

            {/* Preview */}
            {formData.content && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Preview</label>
                <div className="bg-[#DCF8C6] dark:bg-[#025144] rounded-lg p-4 max-w-[80%] ml-auto">
                  <p className="text-sm whitespace-pre-wrap">
                    {formData.content
                      .replace(/\{\{name\}\}/g, 'John')
                      .replace(/\{\{phone\}\}/g, '+62812345678')
                      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
                      .replace(/\{\{time\}\}/g, new Date().toLocaleTimeString())}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
                    </svg>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="bg-[#25D366] hover:bg-[#128C7E]"
            >
              {saving ? 'Saving...' : editingTemplate ? 'Update Template' : 'Create Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
