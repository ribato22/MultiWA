// MultiWA Admin - Automation Page
// apps/admin/src/app/dashboard/automation/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Plus,
  Search,
  Wrench,
  Bot,
  Trash2,
  Upload,
  Loader2,
  X,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  User,
  UserPlus,
  Inbox,
  MessageSquare,
  Image as ImageIcon,
  Video,
  Music,
  FileText,
  BarChart3,
  Tag,
  Tags,
  UserCog,
  Webhook as WebhookIcon,
  Timer,
  Regex,
  Type as TypeIcon,
  Pencil,
  PlayCircle,
  PauseCircle,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import { api, Profile, Automation } from '@/lib/api';
import { formatRelative, formatFull } from '@/lib/datetime';
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
import { useI18n } from '@/lib/i18n/provider';

// Trigger types
type TriggerDef = { value: string; label: string; Icon: LucideIcon; tone: string; description: string };
const TRIGGER_TYPES: TriggerDef[] = [
  { value: 'keyword',     label: 'Keyword Match', Icon: TypeIcon, tone: 'text-primary',      description: 'Trigger when message contains specific keywords' },
  { value: 'regex',       label: 'Pattern Match', Icon: Regex,    tone: 'text-violet-300',   description: 'Trigger using regular expression pattern' },
  { value: 'new_contact', label: 'New Contact',   Icon: UserPlus, tone: 'text-sky-300',      description: 'Trigger when a new contact messages' },
  { value: 'all',         label: 'All Messages',  Icon: Inbox,    tone: 'text-amber-300',    description: 'Trigger on every incoming message' },
];

// Action types
type ActionDef = { value: string; label: string; Icon: LucideIcon; tone: string; description: string };
const ACTION_TYPES: ActionDef[] = [
  { value: 'reply',         label: 'Send Reply',     Icon: MessageSquare, tone: 'text-primary',    description: 'Send an automatic reply message' },
  { value: 'send_image',    label: 'Send Image',     Icon: ImageIcon,     tone: 'text-sky-300',    description: 'Send an image with optional caption' },
  { value: 'send_video',    label: 'Send Video',     Icon: Video,         tone: 'text-rose-300',   description: 'Send a video with optional caption' },
  { value: 'send_audio',    label: 'Send Audio',     Icon: Music,         tone: 'text-amber-300',  description: 'Send audio file or voice note' },
  { value: 'send_document', label: 'Send Document',  Icon: FileText,      tone: 'text-violet-300', description: 'Send a document file' },
  { value: 'send_poll',     label: 'Send Poll',      Icon: BarChart3,     tone: 'text-violet-300', description: 'Send an interactive poll' },
  { value: 'send_location', label: 'Send Location',  Icon: MapPin,        tone: 'text-emerald-300',description: 'Send a location pin' },
  { value: 'send_contact',  label: 'Send Contact',   Icon: User,          tone: 'text-sky-300',    description: 'Send a contact card (vCard)' },
  { value: 'add_tag',       label: 'Add Tag',        Icon: Tag,           tone: 'text-primary',    description: 'Add a tag to the contact' },
  { value: 'remove_tag',    label: 'Remove Tag',     Icon: Tags,          tone: 'text-orange-300', description: 'Remove a tag from the contact' },
  { value: 'assign_agent',  label: 'Assign Agent',   Icon: UserCog,       tone: 'text-violet-300', description: 'Assign conversation to a team member' },
  { value: 'ai_reply',      label: 'AI Reply',       Icon: Bot,           tone: 'text-sky-300',    description: 'Generate AI-powered reply using OpenAI' },
  { value: 'webhook',       label: 'Call Webhook',   Icon: WebhookIcon,   tone: 'text-amber-300',  description: 'Send data to external URL' },
  { value: 'delay',         label: 'Add Delay',      Icon: Timer,         tone: 'text-muted-foreground', description: 'Wait before next action' },
];

export default function AutomationPage() {
  const { t } = useI18n();
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
          <h1 className="text-2xl font-bold text-foreground">{t('automation.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('automation.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/automation/builder">
            <Button variant="outline" className="gap-2 cursor-pointer">
              <Wrench className="w-4 h-4" aria-hidden="true" />
              Visual Builder
            </Button>
          </Link>
          <Button onClick={openCreateModal} className="gap-2 cursor-pointer">
            <Plus className="w-4 h-4" aria-hidden="true" />
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
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Search automations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
            aria-label="Search automations"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
            <Bot className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{automations.length}</div>
          <div className="text-sm text-muted-foreground">Total Automations</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <PlayCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums">{activeCount}</div>
          <div className="text-sm text-muted-foreground">Active</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-muted-foreground/10 text-muted-foreground">
            <PauseCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{automations.length - activeCount}</div>
          <div className="text-sm text-muted-foreground">Inactive</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
            <Activity className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{totalTriggers}</div>
          <div className="text-sm text-muted-foreground">Total Triggers</div>
        </div>
      </div>

      {/* Automations List */}
      {filteredAutomations.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Bot className="w-8 h-8" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Automations Yet</h3>
          <p className="text-muted-foreground mb-6">
            Create automated workflows to respond to messages automatically
          </p>
          <Button onClick={openCreateModal} className="gap-2 cursor-pointer">
            <Plus className="w-4 h-4" aria-hidden="true" />
            Create Your First Automation
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAutomations.map(automation => {
            const trigger = TRIGGER_TYPES.find(t => t.value === automation.triggerType) || TRIGGER_TYPES[0];
            const TriggerIcon = trigger.Icon;

            return (
              <div
                key={automation.id}
                className="bg-card rounded-xl border border-border p-5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 group"
              >
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  {/* Left side */}
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary/60 border border-border/60 flex-shrink-0">
                      <TriggerIcon className={`w-5 h-5 ${trigger.tone}`} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground truncate">{automation.name}</h3>
                        <Badge
                          variant="secondary"
                          className={automation.isActive
                            ? 'gap-1.5 bg-primary/15 text-primary border border-primary/30'
                            : 'gap-1.5 bg-secondary text-muted-foreground border border-border'}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${automation.isActive ? 'bg-primary' : 'bg-muted-foreground/60'}`} aria-hidden="true" />
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
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                        <span>Actions: {automation.actions?.length || 0}</span>
                        <span aria-hidden="true">·</span>
                        <span>Triggered: {automation.stats?.triggerCount || 0} times</span>
                        {automation.stats?.lastTriggered && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span title={formatFull(automation.stats.lastTriggered)}>Last: {formatRelative(automation.stats.lastTriggered)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right side - Actions */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Switch
                      checked={automation.isActive}
                      onCheckedChange={() => handleToggle(automation)}
                      aria-label={`Toggle ${automation.name}`}
                    />
                    <Button variant="outline" size="sm" onClick={() => openEditModal(automation)} className="cursor-pointer">
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(automation)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                      aria-label={`Delete ${automation.name}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
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
                  s <= step ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}>
                  {s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${s < step ? 'bg-primary' : 'bg-secondary'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="automation-name" className="text-sm font-medium text-foreground">
                  Automation Name <span className="text-destructive" aria-label="required">*</span>
                </label>
                <Input
                  id="automation-name"
                  placeholder="e.g., Welcome Message for New Contacts"
                  value={formData.name}
                  onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Trigger Type</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Trigger type">
                  {TRIGGER_TYPES.map(trigger => {
                    const TriggerIcon = trigger.Icon;
                    const active = formData.triggerType === trigger.value;
                    return (
                      <button
                        key={trigger.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setFormData(prev => ({ ...prev, triggerType: trigger.value }))}
                        className={`p-4 rounded-xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                          active
                            ? 'border-primary bg-primary/10 ring-1 ring-primary/40'
                            : 'border-border bg-secondary/30 hover:border-border/80 hover:bg-secondary/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/60 ${trigger.tone}`}>
                            <TriggerIcon className="w-4 h-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">{trigger.label}</div>
                            <div className="text-xs text-muted-foreground">{trigger.description}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
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
                          <Badge key={i} variant="secondary" className="px-3 py-1 gap-1.5">
                            {keyword}
                            <button
                              type="button"
                              onClick={() => removeKeyword(keyword)}
                              aria-label={`Remove keyword ${keyword}`}
                              className="inline-flex items-center hover:text-destructive cursor-pointer"
                            >
                              <X className="w-3 h-3" aria-hidden="true" />
                            </button>
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
                <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
                      <UserPlus className="w-5 h-5" aria-hidden="true" />
                    </span>
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
                <div className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/30">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                      <AlertTriangle className="w-5 h-5" aria-hidden="true" />
                    </span>
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
                <span className="text-sm font-medium text-foreground tabular-nums">Actions ({formData.actions.length})</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 cursor-pointer"
                  onClick={() => setFormData(prev => ({
                    ...prev,
                    actions: [...prev.actions, { type: 'reply', config: { message: '' } }],
                  }))}
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add Action
                </Button>
              </div>

              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {formData.actions.map((action, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 space-y-3 relative bg-secondary/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground tabular-nums">Action #{idx + 1}</span>
                      {formData.actions.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2 text-xs cursor-pointer"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            actions: prev.actions.filter((_, i) => i !== idx),
                          }))}
                          aria-label={`Remove action ${idx + 1}`}
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                          Remove
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
                        {ACTION_TYPES.map(at => {
                          const Icon = at.Icon;
                          return (
                            <SelectItem key={at.value} value={at.value}>
                              <span className="inline-flex items-center gap-2">
                                <Icon className={`w-3.5 h-3.5 ${at.tone}`} aria-hidden="true" />
                                {at.label}
                              </span>
                            </SelectItem>
                          );
                        })}
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
                          }}>{uploadingFile ? (<><Loader2 className="w-3.5 h-3.5 mw-spin mr-1" aria-hidden="true" />Uploading</>) : (<><Upload className="w-3.5 h-3.5 mr-1" aria-hidden="true" />Upload</>)}</Button>
                        </div>
                        {action.config?.url && <p className="inline-flex items-center gap-1.5 text-xs text-primary truncate"><CheckCircle2 className="w-3 h-3 flex-shrink-0" aria-hidden="true" />{action.config.url}</p>}
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
                          }}>{uploadingFile ? (<><Loader2 className="w-3.5 h-3.5 mw-spin mr-1" aria-hidden="true" />Uploading</>) : (<><Upload className="w-3.5 h-3.5 mr-1" aria-hidden="true" />Upload</>)}</Button>
                        </div>
                        {action.config?.url && <p className="inline-flex items-center gap-1.5 text-xs text-primary truncate"><CheckCircle2 className="w-3 h-3 flex-shrink-0" aria-hidden="true" />{action.config.url}</p>}
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
                          }}>{uploadingFile ? (<><Loader2 className="w-3.5 h-3.5 mw-spin mr-1" aria-hidden="true" />Uploading</>) : (<><Upload className="w-3.5 h-3.5 mr-1" aria-hidden="true" />Upload</>)}</Button>
                        </div>
                        {action.config?.url && <p className="inline-flex items-center gap-1.5 text-xs text-primary truncate"><CheckCircle2 className="w-3 h-3 flex-shrink-0" aria-hidden="true" />{action.config.url}</p>}
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
                          }}>{uploadingFile ? (<><Loader2 className="w-3.5 h-3.5 mw-spin mr-1" aria-hidden="true" />Uploading</>) : (<><Upload className="w-3.5 h-3.5 mr-1" aria-hidden="true" />Upload</>)}</Button>
                        </div>
                        {action.config?.url && <p className="inline-flex items-center gap-1.5 text-xs text-primary truncate"><CheckCircle2 className="w-3 h-3 flex-shrink-0" aria-hidden="true" />{action.config.filename || action.config.url}</p>}
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const opts = [...(action.config?.options || [])]; opts.splice(i, 1); updateAction(idx, 'options', opts);
                                }}
                                aria-label={`Remove option ${i + 1}`}
                                className="text-destructive hover:bg-destructive/10 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </Button>
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
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 hover:underline cursor-pointer"
                        >
                          <MapPin className="w-3 h-3" aria-hidden="true" />
                          Use current location
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
                              <SelectItem key={u.id} value={u.id}>
                                <span className="inline-flex items-center gap-2">
                                  <User className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                                  {u.name} ({u.email})
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* AI Reply */}
                    {action.type === 'ai_reply' && (
                      <div className="space-y-2">
                        <div className="p-2 bg-sky-500/10 rounded border border-sky-500/30">
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300">
                            <Bot className="w-3.5 h-3.5" aria-hidden="true" />
                            Uses OpenAI for contextual replies
                          </p>
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
                      <div className="mt-2 p-2.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={action.config?.simulateTyping || false}
                            onChange={e => updateAction(idx, 'simulateTyping', e.target.checked)}
                            className="w-4 h-4 accent-indigo-400"
                          />
                          <div>
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <Pencil className="w-3 h-3" aria-hidden="true" />
                              Simulate Typing
                            </span>
                            <p className="text-[10px] text-muted-foreground">Shows &quot;typing...&quot; indicator before sending</p>
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
                <Button variant="outline" onClick={() => setStep(s => s - 1)} className="cursor-pointer">
                  Back
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowModal(false)} className="cursor-pointer">
                Cancel
              </Button>
              {step < 3 ? (
                <Button onClick={() => setStep(s => s + 1)} className="cursor-pointer">
                  Next
                </Button>
              ) : (
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="gap-2 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : editingAutomation ? (
                    'Update'
                  ) : (
                    <>
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Create Automation
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
