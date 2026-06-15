'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Wrench,
  Loader2,
  CheckCircle2,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { api, Profile } from '@/lib/api';
import { DesktopOnlyGuard } from '@/components/ui/desktop-only-guard';

// Dynamic import to avoid SSR issues with reactflow
const FlowBuilder = dynamic(
  () => import('@/components/automation/FlowBuilder'),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-[70vh]">
      <div className="text-center">
        <Loader2 className="w-10 h-10 text-primary mw-spin mx-auto mb-4" aria-hidden="true" />
        <p className="text-muted-foreground">Loading Flow Builder...</p>
      </div>
    </div>
  )}
);

// Convert flow nodes/edges into automation rules for the API
function convertFlowToAutomations(nodes: any[], edges: any[], profileId: string) {
  const automations: any[] = [];

  // Find trigger nodes
  const triggerNodes = nodes.filter(n => n.type === 'trigger');

  for (const triggerNode of triggerNodes) {
    const data = triggerNode.data || {};
    
    // Walk the graph from this trigger to find connected actions/conditions
    const actions: any[] = [];
    const conditions: any[] = [];
    const visited = new Set<string>();
    const queue = [triggerNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      // Find edges from current node
      const outEdges = edges.filter(e => e.source === currentId);
      for (const edge of outEdges) {
        const targetNode = nodes.find(n => n.id === edge.target);
        if (!targetNode) continue;

        if (targetNode.type === 'condition') {
          const condData = targetNode.data || {};
          // Map FlowBuilder condition fields to rule engine conditions
          const field = condData.field || 'message.text';
          const operator = condData.operator || 'contains';
          const value = condData.value || condData.conditionValue || '';
          
          // Convert FlowBuilder field/operator to rule engine condition types
          let condType = condData.conditionType || 'is_private';
          if (field === 'message.text') {
            condType = 'match_text';
          } else if (field === 'conversation.type') {
            condType = operator === 'equals' && value === 'group' ? 'is_group' : 'is_private';
          } else if (field === 'message.type') {
            condType = 'message_type';
          }
          
          conditions.push({
            type: condType,
            field,
            operator,
            value,
            tags: condData.tags ? condData.tags.split(',').map((t: string) => t.trim()) : undefined,
          });
          queue.push(targetNode.id);
        } else if (targetNode.type === 'action') {
          const actData = targetNode.data || {};
          const actionType = actData.actionType || 'send_text';
          const config = (actData.config || {}) as any;
          // Map FlowBuilder action types to rule engine action types
          const ruleActionType = actionType === 'send_text' ? 'reply' : actionType;
          
          const actionEntry: any = { type: ruleActionType };
          
          switch (actionType) {
            case 'send_text':
              actionEntry.message = config.text || actData.message || actData.replyMessage || '';
              break;
            case 'send_image':
              actionEntry.url = config.url || '';
              actionEntry.caption = config.caption || '';
              actionEntry.mimetype = config.mimetype || 'image/jpeg';
              break;
            case 'send_document':
              actionEntry.url = config.url || '';
              actionEntry.filename = config.filename || 'document';
              actionEntry.caption = config.caption || '';
              actionEntry.mimetype = config.mimetype || 'application/octet-stream';
              break;
            case 'send_poll':
              actionEntry.question = config.question || '';
              actionEntry.options = config.options || [];
              break;
            case 'send_video':
              actionEntry.url = config.url || '';
              actionEntry.caption = config.caption || '';
              actionEntry.mimetype = config.mimetype || 'video/mp4';
              break;
            case 'send_audio':
              actionEntry.url = config.url || '';
              actionEntry.mimetype = config.mimetype || 'audio/mpeg';
              actionEntry.ptt = config.ptt || false;
              break;
            case 'send_location':
              actionEntry.latitude = config.latitude || 0;
              actionEntry.longitude = config.longitude || 0;
              actionEntry.name = config.name || '';
              actionEntry.address = config.address || '';
              break;
            case 'send_contact':
              actionEntry.contactName = config.contactName || '';
              actionEntry.contactPhone = config.contactPhone || '';
              break;
            case 'add_tag':
            case 'remove_tag':
              actionEntry.tags = actData.tags
                ? actData.tags.split(',').map((t: string) => t.trim())
                : config.tags || [];
              break;
            case 'assign_agent':
              actionEntry.assignedUserId = config.assignedUserId || '';
              break;
            case 'ai_reply':
              actionEntry.systemPrompt = config.systemPrompt || '';
              break;
            case 'webhook':
              actionEntry.url = actData.webhookUrl || config.url || '';
              actionEntry.method = actData.webhookMethod || config.method || 'POST';
              break;
          }
          
          actions.push(actionEntry);
          queue.push(targetNode.id);
        } else if (targetNode.type === 'delay') {
          const delayData = targetNode.data || {};
          actions.push({
            type: 'delay',
            seconds: parseInt(delayData.seconds || delayData.delaySeconds || '5', 10),
          });
          queue.push(targetNode.id);
        }
      }
    }

    // Determine trigger type and config
    // Map FlowBuilder trigger types to rule engine types (handle both old and new values)
    let triggerType = data.triggerType || 'all';
    let triggerConfig: any = {};

    // Normalize old trigger type values to rule engine values
    if (triggerType === 'message.received') triggerType = 'all';
    if (triggerType === 'message.keyword') triggerType = 'keyword';
    if (triggerType === 'contact.created') triggerType = 'new_contact';
    if (triggerType === 'all_messages') triggerType = 'all';

    // Auto-promote: if triggerType is 'all' but there are match_text conditions on message.text,
    // promote to 'keyword' trigger and move the text values into triggerConfig.keywords.
    // This handles the case where the user sets trigger=all and adds a condition node with text matching.
    if (triggerType === 'all' && conditions.length > 0) {
      const textConditions = conditions.filter((c: any) =>
        c.type === 'match_text' && (c.field === 'message.text' || c.field === 'Message Text')
      );
      if (textConditions.length > 0) {
        triggerType = 'keyword';
        const keywords = textConditions.map((c: any) => c.value).filter(Boolean);
        const matchMode = textConditions[0]?.operator === 'equals' ? 'exact'
          : textConditions[0]?.operator === 'startsWith' ? 'startsWith'
          : textConditions[0]?.operator === 'endsWith' ? 'endsWith'
          : 'contains';
        triggerConfig = { keywords, matchMode };
        // Remove consumed match_text conditions from the conditions array
        for (const tc of textConditions) {
          const idx = conditions.indexOf(tc);
          if (idx >= 0) conditions.splice(idx, 1);
        }
      }
    }

    if (triggerType === 'keyword') {
      // Extract keywords from trigger node data (filters.keyword or keywords field)
      const keywordStr = data.keywords || data.keyword || (data.filters as any)?.keyword || '';
      const keywords = keywordStr.split(',').map((k: string) => k.trim()).filter(Boolean);
      triggerConfig = { keywords, matchMode: data.matchMode || 'contains' };
      
      // If no keywords found in trigger, check condition nodes for text match values
      if (keywords.length === 0 && conditions.length > 0) {
        const textConditions = conditions.filter((c: any) => 
          c.type === 'match_text' || c.field === 'message.text' || c.field === 'Message Text'
        );
        for (const tc of textConditions) {
          if (tc.value) keywords.push(tc.value);
        }
        if (keywords.length > 0) {
          triggerConfig = { keywords, matchMode: 'contains' };
        }
      }
    } else if (triggerType === 'regex') {
      triggerConfig = { pattern: data.pattern || data.regex || '', flags: data.flags || 'i' };
    } else if (triggerType === 'new_contact') {
      triggerConfig = {};
    } else if (triggerType === 'all') {
      triggerConfig = {};
    }

    if (actions.length === 0) {
      // Add a default no-op action if no actions connected
      actions.push({ type: 'reply', message: 'Auto-reply from Flow Builder' });
    }

    automations.push({
      profileId,
      name: data.label || data.name || `Flow Rule ${automations.length + 1}`,
      isActive: true,
      triggerType,
      triggerConfig,
      conditions,
      actions,
    });
  }

  return automations;
}

export default function AutomationBuilderPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'draft' | 'saved' | 'error'>('idle');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');

  useEffect(() => {
    api.getProfiles().then(res => {
      if (res.data && res.data.length > 0) {
        setProfiles(res.data);
        setSelectedProfile(res.data[0].id);
      }
    });
  }, []);

  const handleSave = async (nodes: any[], edges: any[]) => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      // 1. Always save visual layout to localStorage as draft
      const flowData = {
        nodes: nodes.map(n => ({
          id: n.id, type: n.type, position: n.position, data: n.data,
        })),
        edges: edges.map(e => ({
          id: e.id, source: e.source, target: e.target,
          sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        })),
      };
      localStorage.setItem('multiwa-flow-draft', JSON.stringify(flowData));

      // 2. Convert flow to automation rules and save via API
      if (!selectedProfile) {
        setSaveStatus('draft');
        setTimeout(() => setSaveStatus('idle'), 3000);
        return;
      }

      const automationRules = convertFlowToAutomations(nodes, edges, selectedProfile);

      if (automationRules.length === 0) {
        setSaveStatus('draft');
        setTimeout(() => setSaveStatus('idle'), 3000);
        return;
      }

      // Save each automation rule to the API
      let successCount = 0;
      for (const rule of automationRules) {
        const res = await api.createAutomation(rule);
        if (res.data) successCount++;
      }

      if (successCount > 0) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 4000);
      } else {
        setSaveStatus('draft');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    } catch (error) {
      console.error('Failed to save flow:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 4000);
    } finally {
      setSaving(false);
    }
  };

  // Load saved draft
  const loadDraft = () => {
    try {
      const draft = localStorage.getItem('multiwa-flow-draft');
      if (draft) return JSON.parse(draft);
    } catch {}
    return null;
  };

  const draft = loadDraft();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push('/dashboard/automation')}
            aria-label="Back to automation list"
            className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Wrench className="w-5 h-5 text-primary" aria-hidden="true" />
              Visual Flow Builder
            </h1>
            <p className="text-sm text-muted-foreground">
              Design automation flows with drag-and-drop
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Profile selector */}
          {profiles.length > 0 && (
            <select
              value={selectedProfile}
              onChange={(e) => setSelectedProfile(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="Profile"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.displayName || p.id}
                </option>
              ))}
            </select>
          )}

          {/* Save status indicator */}
          {saveStatus === 'saved' && (
            <span
              role="status"
              aria-live="polite"
              className="text-sm text-primary inline-flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Saved to API
            </span>
          )}
          {saveStatus === 'draft' && (
            <span
              role="status"
              aria-live="polite"
              className="text-sm text-amber-300 inline-flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" aria-hidden="true" />
              Draft saved (add trigger nodes to save to API)
            </span>
          )}
          {saveStatus === 'error' && (
            <span
              role="status"
              aria-live="assertive"
              className="text-sm text-destructive inline-flex items-center gap-1.5"
            >
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              Save failed
            </span>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 border border-border/60 px-3 py-1.5 rounded-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-primary" aria-hidden="true" /> Trigger
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 ml-2" aria-hidden="true" /> Condition
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 ml-2" aria-hidden="true" /> Action
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 ml-2" aria-hidden="true" /> Delay
          </div>
        </div>
      </div>

      {/* Flow Builder */}
      <div className="flex-1 relative" style={{ height: 'calc(100vh - 130px)', minHeight: '500px' }}>
        <DesktopOnlyGuard
          pageName="Visual Flow Builder"
          reason="Drag-and-drop canvas needs a larger screen for comfortable use."
          minWidth="md"
        >
          <FlowBuilder
            initialNodes={draft?.nodes}
            initialEdges={draft?.edges}
            onSave={handleSave}
          />
        </DesktopOnlyGuard>
      </div>
    </div>
  );
}