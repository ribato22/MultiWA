// MultiWA Admin - Automation Page
// apps/admin/src/app/dashboard/automation/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, Profile, Automation } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
import { useToast } from '@/hooks/use-toast';

// Trigger types
const TRIGGER_TYPES = [
  { value: 'keyword', label: 'Keyword Match', icon: '🔤', description: 'Trigger when message contains specific keywords' },
  { value: 'regex', label: 'Pattern Match', icon: '🔣', description: 'Trigger using regular expression pattern' },
  { value: 'new_contact', label: 'New Contact', icon: '👤', description: 'Trigger when a new contact messages' },
  { value: 'all', label: 'All Messages', icon: '📨', description: 'Trigger on every incoming message' },
];

// Action types
const ACTION_TYPES = [
  { value: 'reply', label: 'Send Reply', icon: '💬', description: 'Send an automatic reply message' },
  { value: 'send_image', label: 'Send Image', icon: '🖼️', description: 'Send an image with optional caption' },
  { value: 'send_video', label: 'Send Video', icon: '🎬', description: 'Send a video with optional caption' },
  { value: 'send_audio', label: 'Send Audio', icon: '🎵', description: 'Send audio file or voice note' },
  { value: 'send_document', label: 'Send Document', icon: '📄', description: 'Send a document file' },
  { value: 'send_poll', label: 'Send Poll', icon: '📊', description: 'Send an interactive poll' },
  { value: 'send_location', label: 'Send Location', icon: '📍', description: 'Send a location pin' },
  { value: 'send_contact', label: 'Send Contact', icon: '👤', description: 'Send a contact card (vCard)' },
  { value: 'add_tag', label: 'Add Tag', icon: '🏷️', description: 'Add a tag to the contact' },
  { value: 'remove_tag', label: 'Remove Tag', icon: '🏷️', description: 'Remove a tag from the contact' },
  { value: 'assign_agent', label: 'Assign Agent', icon: '🧑‍💼', description: 'Assign conversation to a team member' },
  { value: 'ai_reply', label: 'AI Reply', icon: '🤖', description: 'Generate AI-powered reply using OpenAI' },
  { value: 'webhook', label: 'Call Webhook', icon: '🌐', description: 'Send data to external URL' },
  { value: 'delay', label: 'Add Delay', icon: '⏱️', description: 'Wait before next action' },
];

export default function AutomationPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [pollOptionInput, setPollOptionInput] = useState('');
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(1);
  
  // Form state
  const [formData, setFormData] = useState<{
    name: string;
    triggerType: string;
    triggerConfig: { keywords: string[]; pattern: string };
    actions: Array<{ type: string; config: Record<string, any> }>;
  }>({
    name: '',
    triggerType: 'keyword',
    triggerConfig: { keywords: [] as string[], pattern: '' },
    actions: [{ type: 'reply', config: { message: '' } }],
  });
  const [keywordInput, setKeywordInput] = useState('');

  useEffect(() => {
    loadProfiles();
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      loadAutomations();
    }
  }, [selectedProfile]);

  const loadUsers = async () => {
    const res = await api.getUsers();
    if (res.data) {
      setUsers(Array.isArray(res.data) ? res.data : []);
    }
  };

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

  const loadAutomations = async () => {
    setLoading(true);
    const res = await api.getAutomations(selectedProfile);
    if (res.data) {
      setAutomations(res.data);
    }
    setLoading(false);
  };

  const openCreateModal = () => {
    setEditingAutomation(null);
    setFormData({
      name: '',
      triggerType: 'keyword',
      triggerConfig: { keywords: [], pattern: '' },
      actions: [{ type: 'reply', config: { message: '' } }],
    });
    setStep(1);
    setShowModal(true);
  };

  const openEditModal = (automation: Automation) => {
    setEditingAutomation(automation);
    // Convert flat actions from API ({type, message, ...}) to form format ({type, config: {message, ...}})
    const formActions = (automation.actions || []).map((action: any) => {
      const { type, ...rest } = action;
      return { type, config: Object.keys(rest).length > 0 ? rest : { message: '' } };
    });
    setFormData({
      name: automation.name,
      // Normalize legacy trigger types for backward compatibility
      triggerType: automation.triggerType === 'all_messages' ? 'all' : automation.triggerType,
      triggerConfig: automation.triggerConfig || { keywords: [], pattern: '' },
      actions: formActions.length > 0 ? formActions : [{ type: 'reply', config: { message: '' } }],
    });
    setStep(1);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({ title: 'Please enter a name', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Flatten actions from {type, config: {message}} to {type, message, ...}
      // to match the backend AutomationAction DTO structure
      const flattenedActions = formData.actions.map(action => {
        const { type, config } = action;
        const flat: any = { type, ...config };
        // Convert single tag to tags array for backend
        if ((type === 'add_tag' || type === 'remove_tag') && flat.tag && !flat.tags) {
          flat.tags = flat.tag.split(',').map((t: string) => t.trim()).filter(Boolean);
          delete flat.tag;
        }
        return flat;
      });

      if (editingAutomation) {
        const res = await api.updateAutomation(editingAutomation.id, {
          name: formData.name,
          triggerType: formData.triggerType,
          triggerConfig: formData.triggerConfig,
          actions: flattenedActions,
        });
        if (res.data) {
          toast({ title: 'Automation updated successfully' });
          loadAutomations();
        }
      } else {
        const res = await api.createAutomation({
          profileId: selectedProfile,
          name: formData.name,
          triggerType: formData.triggerType,
          triggerConfig: formData.triggerConfig,
          actions: flattenedActions,
        });
        if (res.data) {
          toast({ title: 'Automation created successfully' });
          loadAutomations();
        }
      }
      setShowModal(false);
    } catch (error) {
      toast({ title: 'Failed to save automation', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleToggle = async (automation: Automation) => {
    const res = await api.toggleAutomation(automation.id, !automation.isActive);
    if (res.data) {
      toast({ title: `Automation ${res.data.isActive ? 'enabled' : 'disabled'}` });
      loadAutomations();
    }
  };

  const handleDelete = async (automation: Automation) => {
    if (!confirm(`Delete automation "${automation.name}"?`)) return;
    
    const res = await api.deleteAutomation(automation.id);
    if (!res.error) {
      toast({ title: 'Automation deleted' });
      loadAutomations();
    }
  };

  const addKeyword = () => {
    if (keywordInput.trim() && !formData.triggerConfig.keywords.includes(keywordInput.trim())) {
      setFormData(prev => ({
        ...prev,
        triggerConfig: {
          ...prev.triggerConfig,
          keywords: [...prev.triggerConfig.keywords, keywordInput.trim()],
        },
      }));
      setKeywordInput('');
    }
  };

  const removeKeyword = (keyword: string) => {
    setFormData(prev => ({
      ...prev,
      triggerConfig: {
        ...prev.triggerConfig,
        keywords: prev.triggerConfig.keywords.filter(k => k !== keyword),
      },
    }));
  };

  const updateAction = (index: number, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      actions: prev.actions.map((action, i) => 
        i === index ? { ...action, config: { ...action.config, [field]: value } } : action
      ),
    }));
  };

  // Filter automations
  const filteredAutomations = automations.filter(a => 
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Stats
  const activeCount = automations.filter(a => a.isActive).length;
  const totalTriggers = automations.reduce((sum, a) => sum + (a.stats?.triggerCount || 0), 0);

  // Render loading skeleton
  if (loading && automations.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
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
          <h1 className="text-2xl font-bold text-foreground">Automation</h1>
          <p className="text-muted-foreground mt-1">Create automated responses and workflows</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/automation/builder">
            <Button variant="outline" className="gap-2">
              🔧 Visual Builder
            </Button>
          </Link>
          <Button onClick={openCreateModal} className="bg-[#25D366] hover:bg-[#128C7E]">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Automation
          </Button>
        </div>
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
            placeholder="Search automations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{automations.length}</div>
          <div className="text-sm text-muted-foreground">Total Automations</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{automations.length - activeCount}</div>
          <div className="text-sm text-muted-foreground">Inactive</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="text-2xl font-bold text-foreground">{totalTriggers}</div>
          <div className="text-sm text-muted-foreground">Total Triggers</div>
        </div>
      </div>

      {/* Automations List */}
      {filteredAutomations.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="text-6xl mb-4">🤖</div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Automations Yet</h3>
          <p className="text-muted-foreground mb-6">
            Create automated workflows to respond to messages automatically
          </p>
          <Button onClick={openCreateModal} className="bg-[#25D366] hover:bg-[#128C7E]">
            Create Your First Automation
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAutomations.map(automation => {
            const trigger = TRIGGER_TYPES.find(t => t.value === automation.triggerType) || TRIGGER_TYPES[0];
            
            return (
              <div
                key={automation.id}
                className="bg-card rounded-xl border border-border p-5 hover:shadow-lg transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left side */}
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 rounded-xl bg-secondary/50 flex items-center justify-center text-2xl">
                      {trigger.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{automation.name}</h3>
                        <Badge variant={automation.isActive ? 'default' : 'secondary'} className={automation.isActive ? 'bg-green-500' : ''}>
                          {automation.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        Trigger: {trigger.label}
                        {automation.triggerConfig?.keywords?.length > 0 && (
                          <span className="ml-2">
                            Keywords: {automation.triggerConfig.keywords.slice(0, 3).join(', ')}
                            {automation.triggerConfig.keywords.length > 3 && ` +${automation.triggerConfig.keywords.length - 3} more`}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Actions: {automation.actions?.length || 0}</span>
                        <span>•</span>
                        <span>Triggered: {automation.stats?.triggerCount || 0} times</span>
                        {automation.stats?.lastTriggered && (
                          <>
                            <span>•</span>
                            <span>Last: {new Date(automation.stats.lastTriggered).toLocaleString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side - Actions */}
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={automation.isActive}
                      onCheckedChange={() => handleToggle(automation)}
                    />
                    <Button variant="outline" size="sm" onClick={() => openEditModal(automation)}>
                      Edit
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => handleDelete(automation)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAutomation ? 'Edit Automation' : 'Create Automation'}
            </DialogTitle>
            <DialogDescription>
              Step {step} of 3: {step === 1 ? 'Basic Info' : step === 2 ? 'Trigger Setup' : 'Actions'}
            </DialogDescription>
          </DialogHeader>

          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-6">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  s <= step ? 'bg-[#25D366] text-white' : 'bg-secondary text-muted-foreground'
                }`}>
                  {s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${s < step ? 'bg-[#25D366]' : 'bg-secondary'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Automation Name <span className="text-red-500">*</span>
                </label>
                <Input
                  placeholder="e.g., Welcome Message for New Contacts"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Trigger Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {TRIGGER_TYPES.map(trigger => (
                    <div
                      key={trigger.value}
                      onClick={() => setFormData(prev => ({ ...prev, triggerType: trigger.value }))}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        formData.triggerType === trigger.value 
                          ? 'border-[#25D366] bg-[#25D366]/5' 
                          : 'border-border hover:border-[#25D366]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{trigger.icon}</span>
                        <div>
                          <div className="font-medium text-foreground">{trigger.label}</div>
                          <div className="text-xs text-muted-foreground">{trigger.description}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Trigger Config */}
          {step === 2 && (
            <div className="space-y-4">
              {formData.triggerType === 'keyword' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Keywords</label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter keyword and press Enter"
                        value={keywordInput}
                        onChange={e => setKeywordInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                      />
                      <Button type="button" onClick={addKeyword} variant="outline">Add</Button>
                    </div>
                    {formData.triggerConfig.keywords.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {formData.triggerConfig.keywords.map((keyword, i) => (
                          <Badge key={i} variant="secondary" className="px-3 py-1">
                            {keyword}
                            <button onClick={() => removeKeyword(keyword)} className="ml-2 hover:text-red-500">×</button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    The automation will trigger when an incoming message contains any of these keywords (case-insensitive)
                  </p>
                </div>
              )}

              {formData.triggerType === 'regex' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Regular Expression Pattern</label>
                  <Input
                    placeholder="e.g., ^(hi|hello|hey)"
                    value={formData.triggerConfig.pattern || ''}
                    onChange={e => setFormData(prev => ({
                      ...prev,
                      triggerConfig: { ...prev.triggerConfig, pattern: e.target.value },
                    }))}
                    className="font-mono"
                  />
                  <p className="text-sm text-muted-foreground">
                    Advanced: Use regex patterns for more complex matching
                  </p>
                </div>
              )}

              {formData.triggerType === 'new_contact' && (
                <div className="bg-secondary/30 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">👤</span>
                    <div>
                      <div className="font-medium text-foreground">New Contact Trigger</div>
                      <div className="text-sm text-muted-foreground">
                        This automation will trigger when someone messages you for the first time
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {formData.triggerType === 'all' && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4 border border-yellow-200 dark:border-yellow-800">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">⚠️</span>
                    <div>
                      <div className="font-medium text-foreground">All Messages Trigger</div>
                      <div className="text-sm text-muted-foreground">
                        Warning: This will trigger on every incoming message. Use with caution.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Actions (Multiple) */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Actions ({formData.actions.length})</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    actions: [...prev.actions, { type: 'reply', config: { message: '' } }],
                  }))}
                >
                  ➕ Add Action
                </Button>
              </div>

              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {formData.actions.map((action, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-3 relative bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Action #{idx + 1}</span>
                      {formData.actions.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive h-6 px-2 text-xs"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            actions: prev.actions.filter((_, i) => i !== idx),
                          }))}
                        >
                          🗑️ Remove
                        </Button>
                      )}
                    </div>

                    <Select
                      value={action.type}
                      onValueChange={v => setFormData(prev => ({
                        ...prev,
                        actions: prev.actions.map((a, i) =>
                          i === idx ? { type: v, config: {} } : a
                        ),
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTION_TYPES.map(at => (
                          <SelectItem key={at.value} value={at.value}>
                            {at.icon} {at.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Reply */}
                    {action.type === 'reply' && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Type your automatic reply message...&#10;&#10;Use {{name}} for personalization"
                          value={action.config?.message || ''}
                          onChange={e => updateAction(idx, 'message', e.target.value)}
                          rows={3}
                        />
                        <div className="flex flex-wrap gap-2">
                          {['{{name}}', '{{phone}}'].map(v => (
                            <Button
                              key={v} type="button" variant="outline" size="sm" className="text-xs font-mono"
                              onClick={() => updateAction(idx, 'message', (action.config?.message || '') + v)}
                            >
                              {v}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Send Image */}
                    {action.type === 'send_image' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input placeholder="https://example.com/image.jpg" value={action.config?.url || ''} onChange={e => updateAction(idx, 'url', e.target.value)} className="flex-1" />
                          <Button type="button" variant="outline" disabled={uploadingFile} onClick={async () => {
                            const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
                            input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; setUploadingFile(true); try { const res = await api.uploadMedia(file); if (res.data?.url) { updateAction(idx, 'url', res.data.url); updateAction(idx, 'mimetype', res.data.mimeType); toast({ title: 'Uploaded' }); } } catch { toast({ title: 'Upload failed', variant: 'destructive' }); } setUploadingFile(false); }; input.click();
                          }}>{uploadingFile ? '⏳' : '📁'} Upload</Button>
                        </div>
                        {action.config?.url && <p className="text-xs text-muted-foreground truncate">✅ {action.config.url}</p>}
                        <Input placeholder="Caption (optional)" value={action.config?.caption || ''} onChange={e => updateAction(idx, 'caption', e.target.value)} />
                      </div>
                    )}

                    {/* Send Video */}
                    {action.type === 'send_video' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input placeholder="https://example.com/video.mp4" value={action.config?.url || ''} onChange={e => updateAction(idx, 'url', e.target.value)} className="flex-1" />
                          <Button type="button" variant="outline" disabled={uploadingFile} onClick={async () => {
                            const input = document.createElement('input'); input.type = 'file'; input.accept = 'video/*';
                            input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; setUploadingFile(true); try { const res = await api.uploadMedia(file); if (res.data?.url) { updateAction(idx, 'url', res.data.url); updateAction(idx, 'mimetype', res.data.mimeType); toast({ title: 'Uploaded' }); } } catch { toast({ title: 'Upload failed', variant: 'destructive' }); } setUploadingFile(false); }; input.click();
                          }}>{uploadingFile ? '⏳' : '📁'} Upload</Button>
                        </div>
                        {action.config?.url && <p className="text-xs text-muted-foreground truncate">✅ {action.config.url}</p>}
                        <Input placeholder="Caption (optional)" value={action.config?.caption || ''} onChange={e => updateAction(idx, 'caption', e.target.value)} />
                      </div>
                    )}

                    {/* Send Audio */}
                    {action.type === 'send_audio' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input placeholder="https://example.com/audio.mp3" value={action.config?.url || ''} onChange={e => updateAction(idx, 'url', e.target.value)} className="flex-1" />
                          <Button type="button" variant="outline" disabled={uploadingFile} onClick={async () => {
                            const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*';
                            input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; setUploadingFile(true); try { const res = await api.uploadMedia(file); if (res.data?.url) { updateAction(idx, 'url', res.data.url); updateAction(idx, 'mimetype', res.data.mimeType); toast({ title: 'Uploaded' }); } } catch { toast({ title: 'Upload failed', variant: 'destructive' }); } setUploadingFile(false); }; input.click();
                          }}>{uploadingFile ? '⏳' : '📁'} Upload</Button>
                        </div>
                        {action.config?.url && <p className="text-xs text-muted-foreground truncate">✅ {action.config.url}</p>}
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id={`ptt-${idx}`} checked={action.config?.ptt || false} onChange={e => updateAction(idx, 'ptt', e.target.checked)} />
                          <label htmlFor={`ptt-${idx}`} className="text-sm">Send as voice note (PTT)</label>
                        </div>
                      </div>
                    )}

                    {/* Send Document */}
                    {action.type === 'send_document' && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input placeholder="https://example.com/document.pdf" value={action.config?.url || ''} onChange={e => updateAction(idx, 'url', e.target.value)} className="flex-1" />
                          <Button type="button" variant="outline" disabled={uploadingFile} onClick={async () => {
                            const input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip';
                            input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; setUploadingFile(true); try { const res = await api.uploadMedia(file); if (res.data?.url) { updateAction(idx, 'url', res.data.url); updateAction(idx, 'filename', res.data.filename); updateAction(idx, 'mimetype', res.data.mimeType); toast({ title: 'Uploaded' }); } } catch { toast({ title: 'Upload failed', variant: 'destructive' }); } setUploadingFile(false); }; input.click();
                          }}>{uploadingFile ? '⏳' : '📁'} Upload</Button>
                        </div>
                        {action.config?.url && <p className="text-xs text-muted-foreground truncate">✅ {action.config.filename || action.config.url}</p>}
                        <Input placeholder="Filename (e.g. document.pdf)" value={action.config?.filename || ''} onChange={e => updateAction(idx, 'filename', e.target.value)} />
                        <Input placeholder="Caption (optional)" value={action.config?.caption || ''} onChange={e => updateAction(idx, 'caption', e.target.value)} />
                      </div>
                    )}

                    {/* Send Poll */}
                    {action.type === 'send_poll' && (
                      <div className="space-y-2">
                        <Input placeholder="What do you prefer?" value={action.config?.question || ''} onChange={e => updateAction(idx, 'question', e.target.value)} />
                        <label className="text-sm font-medium">Options (min 2, max 12)</label>
                        <div className="space-y-1">
                          {(action.config?.options || []).map((opt: string, i: number) => (
                            <div key={i} className="flex gap-2 items-center">
                              <span className="text-sm text-muted-foreground w-6">{i + 1}.</span>
                              <Input value={opt} readOnly className="flex-1" />
                              <Button type="button" variant="ghost" size="sm" onClick={() => {
                                const opts = [...(action.config?.options || [])]; opts.splice(i, 1); updateAction(idx, 'options', opts);
                              }}>✕</Button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Input placeholder="Add option..." value={pollOptionInput} onChange={e => setPollOptionInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (pollOptionInput.trim() && (action.config?.options || []).length < 12) { updateAction(idx, 'options', [...(action.config?.options || []), pollOptionInput.trim()]); setPollOptionInput(''); } } }} />
                          <Button type="button" variant="outline" size="sm" disabled={(action.config?.options || []).length >= 12}
                            onClick={() => { if (pollOptionInput.trim()) { updateAction(idx, 'options', [...(action.config?.options || []), pollOptionInput.trim()]); setPollOptionInput(''); } }}>+ Add</Button>
                        </div>
                      </div>
                    )}

                    {/* Send Location */}
                    {action.type === 'send_location' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Latitude</label>
                            <Input type="number" step="any" placeholder="-6.2088" value={action.config?.latitude || ''} onChange={e => updateAction(idx, 'latitude', parseFloat(e.target.value))} />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Longitude</label>
                            <Input type="number" step="any" placeholder="106.8456" value={action.config?.longitude || ''} onChange={e => updateAction(idx, 'longitude', parseFloat(e.target.value))} />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (navigator.geolocation) {
                              navigator.geolocation.getCurrentPosition(
                                (pos) => {
                                  updateAction(idx, 'latitude', pos.coords.latitude);
                                  updateAction(idx, 'longitude', pos.coords.longitude);
                                },
                                (err) => alert('Unable to get location: ' + err.message)
                              );
                            } else {
                              alert('Geolocation is not supported by this browser.');
                            }
                          }}
                          className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                        >
                          📱 Use current location
                        </button>
                        <Input placeholder="Location name (optional)" value={action.config?.name || ''} onChange={e => updateAction(idx, 'name', e.target.value)} />
                        <Input placeholder="Address (optional)" value={action.config?.address || ''} onChange={e => updateAction(idx, 'address', e.target.value)} />
                      </div>
                    )}

                    {/* Send Contact */}
                    {action.type === 'send_contact' && (
                      <div className="space-y-2">
                        <Input placeholder="Contact Name" value={action.config?.contactName || ''} onChange={e => updateAction(idx, 'contactName', e.target.value)} />
                        <Input placeholder="Phone Number (e.g. 628123456789)" value={action.config?.contactPhone || ''} onChange={e => updateAction(idx, 'contactPhone', e.target.value)} />
                      </div>
                    )}

                    {/* Add Tag / Remove Tag */}
                    {(action.type === 'add_tag' || action.type === 'remove_tag') && (
                      <div className="space-y-2">
                        <Input placeholder={action.type === 'add_tag' ? 'e.g., new-lead, interested' : 'e.g., new-lead'}
                          value={action.config?.tag || ''} onChange={e => updateAction(idx, 'tag', e.target.value)} />
                      </div>
                    )}

                    {/* Assign Agent */}
                    {action.type === 'assign_agent' && (
                      <div className="space-y-2">
                        <Select value={action.config?.assignedUserId || ''} onValueChange={v => updateAction(idx, 'assignedUserId', v)}>
                          <SelectTrigger><SelectValue placeholder="Select a team member" /></SelectTrigger>
                          <SelectContent>
                            {users.map(u => (
                              <SelectItem key={u.id} value={u.id}>👤 {u.name} ({u.email})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* AI Reply */}
                    {action.type === 'ai_reply' && (
                      <div className="space-y-2">
                        <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded border border-blue-200 dark:border-blue-800">
                          <p className="text-xs font-medium text-blue-700 dark:text-blue-300">🤖 Uses OpenAI for contextual replies</p>
                        </div>
                        <Textarea placeholder="System prompt (optional)..." value={action.config?.systemPrompt || ''} onChange={e => updateAction(idx, 'systemPrompt', e.target.value)} rows={3} />
                      </div>
                    )}

                    {/* Webhook */}
                    {action.type === 'webhook' && (
                      <div className="space-y-2">
                        <Input placeholder="https://your-server.com/webhook" value={action.config?.url || ''} onChange={e => updateAction(idx, 'url', e.target.value)} />
                      </div>
                    )}

                    {/* Delay */}
                    {action.type === 'delay' && (
                      <div className="space-y-2">
                        <Input type="number" placeholder="Delay in seconds" value={action.config?.seconds || ''} onChange={e => updateAction(idx, 'seconds', parseInt(e.target.value))} />
                      </div>
                    )}

                    {/* Simulate Typing — for all send actions */}
                    {['reply', 'send_text', 'send_image', 'send_video', 'send_audio', 'send_document', 'send_location', 'send_contact', 'send_poll', 'ai_reply'].includes(action.type) && (
                      <div className="mt-2 p-2.5 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-lg border border-indigo-100 dark:border-indigo-800/30">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={action.config?.simulateTyping || false}
                            onChange={e => updateAction(idx, 'simulateTyping', e.target.checked)}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <div>
                            <span className="text-xs font-medium text-foreground">⌨️ Simulate Typing</span>
                            <p className="text-[10px] text-muted-foreground">Shows "typing..." indicator before sending</p>
                          </div>
                        </label>
                        {action.config?.simulateTyping && (
                          <div className="mt-2">
                            <label className="text-[10px] text-muted-foreground">Typing Duration (seconds)</label>
                            <Input
                              type="number"
                              min={1}
                              max={15}
                              className="w-20 h-7 text-xs"
                              value={action.config?.typingDuration || 3}
                              onChange={e => updateAction(idx, 'typingDuration', parseInt(e.target.value) || 3)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between">
            <div>
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(s => s - 1)}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              {step < 3 ? (
                <Button onClick={() => setStep(s => s + 1)} className="bg-[#25D366] hover:bg-[#128C7E]">
                  Next
                </Button>
              ) : (
                <Button 
                  onClick={handleSave} 
                  disabled={saving}
                  className="bg-[#25D366] hover:bg-[#128C7E]"
                >
                  {saving ? 'Saving...' : editingAutomation ? 'Update' : 'Create Automation'}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
