// MultiWA Admin - Integrations Page
// apps/admin/src/app/dashboard/integrations/page.tsx

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

type TabKey = 'typebot' | 'chatwoot';

export default function IntegrationsPage() {
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
        title: '✅ Configuration Saved',
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
        toast({ title: '✅ Connection Successful', description: res.data.message });
      } else {
        toast({ title: '❌ Connection Failed', description: res.data?.message || 'Unknown error', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: `Failed to test ${type} connection`, variant: 'destructive' });
    }
    setTesting(null);
  };

  const tabs: { key: TabKey; label: string; icon: string; description: string }[] = [
    { key: 'typebot', label: 'TypeBot', icon: '🤖', description: 'Chatbot builder for automated conversations' },
    { key: 'chatwoot', label: 'Chatwoot', icon: '💬', description: 'Customer engagement & support platform' },
  ];

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-lg">🔌</span>
          Integrations
        </h1>
        <p className="text-muted-foreground mt-1">
          Connect third-party services to extend your WhatsApp gateway
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-3">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-xl font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-purple-500/10 to-indigo-500/10 text-purple-700 dark:text-purple-300 border-2 border-purple-500/30 shadow-sm'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground border-2 border-transparent'
            }`}
          >
            <span className="text-xl">{tab.icon}</span>
            <div className="text-left">
              <div className="text-sm font-semibold">{tab.label}</div>
            </div>
          </button>
        ))}
      </div>

      {/* TypeBot Tab */}
      {activeTab === 'typebot' && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🤖</span>
                <div>
                  <h3 className="text-lg font-bold text-foreground">TypeBot</h3>
                  <p className="text-sm text-muted-foreground">Build conversational chatbots with a visual flow builder</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${typebotEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className={`text-sm font-medium ${typebotEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {typebotEnabled ? 'Connected' : 'Not Configured'}
                </span>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">API URL</label>
              <Input
                value={typebotUrl}
                onChange={e => setTypebotUrl(e.target.value)}
                placeholder="https://typebot.example.com"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">The URL of your TypeBot instance</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Default Bot ID</label>
              <Input
                value={typebotBotId}
                onChange={e => setTypebotBotId(e.target.value)}
                placeholder="my-chatbot-id"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">The TypeBot flow ID to use when starting conversations</p>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-secondary/30 rounded-xl">
              <div>
                <p className="text-sm font-medium text-foreground">Enable TypeBot Integration</p>
                <p className="text-xs text-muted-foreground">Requires TYPEBOT_API_URL environment variable</p>
              </div>
              <button
                onClick={() => setTypebotEnabled(!typebotEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${typebotEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${typebotEnabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white">
                {saving ? 'Saving...' : '💾 Save Configuration'}
              </Button>
              <Button variant="outline" onClick={() => handleTest('typebot')} disabled={testing === 'typebot' || !typebotUrl}>
                {testing === 'typebot' ? 'Testing...' : '🔗 Test Connection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chatwoot Tab */}
      {activeTab === 'chatwoot' && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-3xl">💬</span>
                <div>
                  <h3 className="text-lg font-bold text-foreground">Chatwoot</h3>
                  <p className="text-sm text-muted-foreground">Sync WhatsApp conversations with your Chatwoot helpdesk</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${chatwootEnabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className={`text-sm font-medium ${chatwootEnabled ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {chatwootEnabled ? 'Connected' : 'Not Configured'}
                </span>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Chatwoot URL</label>
                <Input
                  value={chatwootUrl}
                  onChange={e => setChatwootUrl(e.target.value)}
                  placeholder="https://chatwoot.example.com"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">API Token</label>
                <Input
                  type="password"
                  value={chatwootToken}
                  onChange={e => setChatwootToken(e.target.value)}
                  placeholder="Your Chatwoot API access token"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Account ID</label>
                <Input
                  value={chatwootAccountId}
                  onChange={e => setChatwootAccountId(e.target.value)}
                  placeholder="1"
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Inbox ID</label>
                <Input
                  value={chatwootInboxId}
                  onChange={e => setChatwootInboxId(e.target.value)}
                  placeholder="1"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between py-3 px-4 bg-secondary/30 rounded-xl">
              <div>
                <p className="text-sm font-medium text-foreground">Enable Chatwoot Integration</p>
                <p className="text-xs text-muted-foreground">Requires CHATWOOT_URL, CHATWOOT_API_TOKEN, and CHATWOOT_ACCOUNT_ID</p>
              </div>
              <button
                onClick={() => setChatwootEnabled(!chatwootEnabled)}
                className={`relative w-12 h-6 rounded-full transition-colors ${chatwootEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${chatwootEnabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>
            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white">
                {saving ? 'Saving...' : '💾 Save Configuration'}
              </Button>
              <Button variant="outline" onClick={() => handleTest('chatwoot')} disabled={testing === 'chatwoot' || !chatwootUrl}>
                {testing === 'chatwoot' ? 'Testing...' : '🔗 Test Connection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-3">
        <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
        </svg>
        <div>
          <p className="font-medium mb-1">Environment variables required</p>
          <p>Integration services read configuration from environment variables. Changes made here are saved for reference, but you may need to update your <code className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 rounded text-xs">.env</code> file and restart the API server for changes to take effect.</p>
        </div>
      </div>
    </div>
  );
}
