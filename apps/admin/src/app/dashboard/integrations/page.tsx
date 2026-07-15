// MultiWA Admin - Integrations Page
// apps/admin/src/app/dashboard/integrations/page.tsx

'use client';

import { useState, useEffect } from 'react';
import {
  Plug,
  Bot,
  MessageCircle,
  Save,
  Link2,
  Info,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/lib/i18n/provider';
import { api } from '@/lib/api';

type TabKey = 'typebot' | 'chatwoot';

export default function IntegrationsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>('typebot');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // TypeBot
  const [typebotUrl, setTypebotUrl] = useState('');
  const [typebotBotId, setTypebotBotId] = useState('');
  const [typebotEnabled, setTypebotEnabled] = useState(false);

  // Chatwoot
  const [chatwootUrl, setChatwootUrl] = useState('');
  const [chatwootToken, setChatwootToken] = useState('');
  const [chatwootAccountId, setChatwootAccountId] = useState('');
  const [chatwootInboxId, setChatwootInboxId] = useState('');
  const [chatwootEnabled, setChatwootEnabled] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const { data } = await api.getIntegrationConfig();
      if (data) {
        if (data.typebot) {
          setTypebotUrl(data.typebot.apiUrl || '');
          setTypebotBotId(data.typebot.defaultBotId || '');
          setTypebotEnabled(data.typebot.enabled);
        }
        if (data.chatwoot) {
          setChatwootUrl(data.chatwoot.url || '');
          setChatwootToken(data.chatwoot.apiToken || '');
          setChatwootAccountId(data.chatwoot.accountId || '');
          setChatwootInboxId(data.chatwoot.inboxId || '');
          setChatwootEnabled(data.chatwoot.enabled);
        }
      }
    } catch {
      // Config endpoint may not exist yet, that's OK
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.saveIntegrationConfig({
        typebot: { apiUrl: typebotUrl, defaultBotId: typebotBotId, enabled: typebotEnabled },
        chatwoot: { url: chatwootUrl, apiToken: chatwootToken, accountId: chatwootAccountId, inboxId: chatwootInboxId, enabled: chatwootEnabled },
      });
      toast({
        title: 'Configuration Saved',
        description: res.data?.message || 'Integration configuration updated',
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to save configuration', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleTest = async (type: TabKey) => {
    setTesting(type);
    try {
      const res = await api.testIntegration(type);
      if (res.data?.success) {
        toast({ title: 'Connection Successful', description: res.data.message });
      } else {
        toast({ title: 'Connection Failed', description: res.data?.message || 'Unknown error', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: `Failed to test ${type} connection`, variant: 'destructive' });
    }
    setTesting(null);
  };

  type TabDef = { key: TabKey; label: string; Icon: LucideIcon; description: string; tone: string };
  const tabs: TabDef[] = [
    { key: 'typebot',  label: 'TypeBot',  Icon: Bot,            description: 'Chatbot builder for automated conversations', tone: 'text-violet-300' },
    { key: 'chatwoot', label: 'Chatwoot', Icon: MessageCircle,  description: 'Customer engagement & support platform',      tone: 'text-amber-300' },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-secondary rounded-lg w-48" />
          <div className="h-4 bg-secondary rounded w-72" />
          <div className="flex gap-3">
            <div className="h-12 bg-secondary rounded-xl w-40" />
            <div className="h-12 bg-secondary rounded-xl w-40" />
          </div>
          <div className="h-64 bg-secondary rounded-2xl" />
        </div>
      </div>
    );
  }

  type IntegrationDef = {
    key: TabKey;
    title: string;
    description: string;
    Icon: LucideIcon;
    accent: string;
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    canTest: boolean;
  };

  const sectionFor = (key: TabKey): IntegrationDef => {
    if (key === 'typebot') {
      return {
        key,
        title: 'TypeBot',
        description: 'Build conversational chatbots with a visual flow builder',
        Icon: Bot,
        accent: 'text-violet-300',
        enabled: typebotEnabled,
        setEnabled: setTypebotEnabled,
        canTest: !!typebotUrl,
      };
    }
    return {
      key,
      title: 'Chatwoot',
      description: 'Sync WhatsApp conversations with your Chatwoot helpdesk',
      Icon: MessageCircle,
      accent: 'text-amber-300',
      enabled: chatwootEnabled,
      setEnabled: setChatwootEnabled,
      canTest: !!chatwootUrl,
    };
  };

  const renderConnectionPill = (enabled: boolean) => (
    <div className="flex items-center gap-2">
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          enabled
            ? 'bg-primary shadow-[0_0_0_3px_rgb(34_197_94_/_0.18)]'
            : 'bg-muted-foreground/40'
        }`}
        aria-hidden="true"
      />
      <span className={`text-sm font-medium ${enabled ? 'text-primary' : 'text-muted-foreground'}`}>
        {enabled ? 'Connected' : 'Not Configured'}
      </span>
    </div>
  );

  const renderEnableToggle = (label: string, hint: string, enabled: boolean, setEnabled: (v: boolean) => void) => (
    <div className="flex items-center justify-between py-3 px-4 bg-secondary/40 border border-border/60 rounded-xl">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${label}`}
        onClick={() => setEnabled(!enabled)}
        className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background ${enabled ? 'bg-primary' : 'bg-secondary'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-6' : ''}`} />
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
            <Plug className="w-5 h-5" aria-hidden="true" />
          </span>
          {t('integrations.title')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('integrations.subtitle')}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-3" role="tablist" aria-label="Integration providers">
        {tabs.map(tab => {
          const Icon = tab.Icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-medium transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                active
                  ? 'bg-primary/10 text-foreground border border-primary/40 shadow-sm'
                  : 'bg-secondary/50 text-muted-foreground hover:bg-secondary/70 hover:text-foreground border border-transparent'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? tab.tone : ''}`} aria-hidden="true" />
              <div className="text-left">
                <div className="text-sm font-semibold">{tab.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* TypeBot Tab */}
      {activeTab === 'typebot' && (() => {
        const section = sectionFor('typebot');
        const Icon = section.Icon;
        return (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border bg-violet-500/10">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{section.title}</h3>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  </div>
                </div>
                {renderConnectionPill(section.enabled)}
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label htmlFor="typebot-url" className="block text-sm font-medium text-foreground mb-2">API URL</label>
                <Input
                  id="typebot-url"
                  value={typebotUrl}
                  onChange={e => setTypebotUrl(e.target.value)}
                  placeholder="https://typebot.example.com"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">The URL of your TypeBot instance</p>
              </div>
              <div>
                <label htmlFor="typebot-botid" className="block text-sm font-medium text-foreground mb-2">Default Bot ID</label>
                <Input
                  id="typebot-botid"
                  value={typebotBotId}
                  onChange={e => setTypebotBotId(e.target.value)}
                  placeholder="my-chatbot-id"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">The TypeBot flow ID to use when starting conversations</p>
              </div>
              {renderEnableToggle(
                'Enable TypeBot Integration',
                'Requires TYPEBOT_API_URL environment variable',
                section.enabled,
                section.setEnabled,
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving} className="gap-2 cursor-pointer">
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" aria-hidden="true" />
                      Save Configuration
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleTest('typebot')}
                  disabled={testing === 'typebot' || !section.canTest}
                  className="gap-2 cursor-pointer"
                >
                  {testing === 'typebot' ? (
                    <>
                      <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" aria-hidden="true" />
                      Test Connection
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Chatwoot Tab */}
      {activeTab === 'chatwoot' && (() => {
        const section = sectionFor('chatwoot');
        const Icon = section.Icon;
        return (
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border bg-amber-500/10">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{section.title}</h3>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  </div>
                </div>
                {renderConnectionPill(section.enabled)}
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="chatwoot-url" className="block text-sm font-medium text-foreground mb-2">Chatwoot URL</label>
                  <Input
                    id="chatwoot-url"
                    value={chatwootUrl}
                    onChange={e => setChatwootUrl(e.target.value)}
                    placeholder="https://chatwoot.example.com"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="chatwoot-token" className="block text-sm font-medium text-foreground mb-2">API Token</label>
                  <Input
                    id="chatwoot-token"
                    type="password"
                    value={chatwootToken}
                    onChange={e => setChatwootToken(e.target.value)}
                    placeholder="Your Chatwoot API access token"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="chatwoot-account" className="block text-sm font-medium text-foreground mb-2">Account ID</label>
                  <Input
                    id="chatwoot-account"
                    value={chatwootAccountId}
                    onChange={e => setChatwootAccountId(e.target.value)}
                    placeholder="1"
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="chatwoot-inbox" className="block text-sm font-medium text-foreground mb-2">Inbox ID</label>
                  <Input
                    id="chatwoot-inbox"
                    value={chatwootInboxId}
                    onChange={e => setChatwootInboxId(e.target.value)}
                    placeholder="1"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              {renderEnableToggle(
                'Enable Chatwoot Integration',
                'Requires CHATWOOT_URL, CHATWOOT_API_TOKEN, and CHATWOOT_ACCOUNT_ID',
                section.enabled,
                section.setEnabled,
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={handleSave} disabled={saving} className="gap-2 cursor-pointer">
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" aria-hidden="true" />
                      Save Configuration
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleTest('chatwoot')}
                  disabled={testing === 'chatwoot' || !section.canTest}
                  className="gap-2 cursor-pointer"
                >
                  {testing === 'chatwoot' ? (
                    <>
                      <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4" aria-hidden="true" />
                      Test Connection
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Info Banner */}
      <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 text-sm text-sky-200 flex items-start gap-3">
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-sky-300" aria-hidden="true" />
        <div>
          <p className="font-medium mb-1 text-sky-200">Environment variables required</p>
          <p className="text-sky-200/80">
            Integration services read configuration from environment variables. Changes made here are saved for reference, but you may need to update your <code className="px-1.5 py-0.5 bg-sky-500/20 text-sky-200 rounded text-xs font-mono">.env</code> file and restart the API server for changes to take effect.
          </p>
        </div>
      </div>
    </div>
  );
}