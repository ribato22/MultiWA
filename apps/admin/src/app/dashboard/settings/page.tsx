// MultiWA Admin - Settings Page
// apps/admin/src/app/dashboard/settings/page.tsx

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api, User, Profile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLES = [
  { value: 'admin', label: 'Admin', color: 'bg-blue-500' },
  { value: 'member', label: 'Member', color: 'bg-green-500' },
  { value: 'viewer', label: 'Viewer', color: 'bg-gray-500' },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Team state
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteData, setInviteData] = useState({ name: '', email: '', role: 'member' });
  const [inviting, setInviting] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  
  // Security dialogs
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [deletePassword, setDeletePassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [setting2FA, setSetting2FA] = useState(false);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);
  const [regeneratingCodes, setRegeneratingCodes] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<Array<{
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    device: string;
    lastActiveAt: string;
    createdAt: string;
    expiresAt: string;
  }>>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSession, setRevokingSession] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  // Storage config state
  const [storageConfig, setStorageConfig] = useState<any>({ type: 'local' });
  const [storageConfigSource, setStorageConfigSource] = useState<string | null>(null);
  const [testingStorage, setTestingStorage] = useState(false);
  const [savingStorage, setSavingStorage] = useState(false);
  const [storageTestResult, setStorageTestResult] = useState<{ success: boolean; message: string; bucketMissing?: boolean; bucketCreated?: boolean } | null>(null);

  // SMTP config state
  const [smtpConfig, setSmtpConfig] = useState<any>({ host: '', port: 587, user: '', pass: '', from: '', secure: false });
  const [smtpConfigSource, setSmtpConfigSource] = useState<string | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testEmailAddress, setTestEmailAddress] = useState('');

  // Profiles state (for Device Info)
  const [connectedProfiles, setConnectedProfiles] = useState<Profile[]>([]);

  // Settings state
  const [settings, setSettings] = useState({
    name: '',
    email: '',
    notifyOnMessage: true,
    notifyOnConnect: true,
    notifyOnDisconnect: true,
    emailNotifications: false,
  });

  useEffect(() => {
    fetchUser();
    fetchMembers();
    loadPreferences();
    check2FAStatus();
    fetchSessions();
    fetchConnectedProfiles();
    fetchStorageConfig();
    fetchSmtpConfig();
  }, []);

  const fetchStorageConfig = async () => {
    try {
      const res = await api.getStorageConfig();
      if (res.data) {
        setStorageConfig(res.data);
        setStorageConfigSource(res.data.source || 'env');
      }
    } catch {
      // Storage config not available — keep defaults
    }
  };

  const fetchSmtpConfig = async () => {
    try {
      const res = await api.getSmtpConfig();
      if (res.data) {
        setSmtpConfig(res.data);
        setSmtpConfigSource(res.data.source || 'none');
        if (user?.email) setTestEmailAddress(user.email);
      }
    } catch {
      // SMTP config not available
    }
  };

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      await api.updateSmtpConfig(smtpConfig);
      setSmtpTestResult({ success: true, message: 'SMTP configuration saved and applied' });
      fetchSmtpConfig();
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || 'Failed to save SMTP config' });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async (sendEmail?: boolean) => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await api.testSmtpConnection(
        smtpConfig,
        sendEmail && testEmailAddress ? { sendTo: testEmailAddress } : undefined,
      );
      setSmtpTestResult(res.data || res);
    } catch (err: any) {
      setSmtpTestResult({ success: false, message: err.message || 'SMTP test failed' });
    } finally {
      setTestingSmtp(false);
    }
  };

  const fetchConnectedProfiles = async () => {
    try {
      const res = await api.getProfiles();
      if (res.data) setConnectedProfiles(res.data);
    } catch {}
  };

  const check2FAStatus = async () => {
    try {
      const res = await api.me();
      if (res.data) {
        setTwoFactorEnabled(!!(res.data as any).twoFactorEnabled);
        setBackupCodesRemaining((res.data as any).backupCodesRemaining ?? 0);
      }
    } catch {}
  };

  const handleRegenerateBackupCodes = async () => {
    setRegeneratingCodes(true);
    try {
      const res = await api.regenerateBackupCodes();
      if (res.data?.backupCodes) {
        setBackupCodes(res.data.backupCodes);
        setBackupCodesRemaining(res.data.backupCodes.length);
        setShowBackupCodes(true);
        toast({ title: 'Success', description: 'New backup codes generated! Save them in a safe place.' });
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to regenerate codes', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to regenerate backup codes', variant: 'destructive' });
    }
    setRegeneratingCodes(false);
  };

  const loadPreferences = async () => {
    try {
      const res = await api.getPreferences();
      if (res.data) {
        setSettings(prev => ({
          ...prev,
          notifyOnMessage: res.data?.notifyOnMessage ?? true,
          notifyOnConnect: res.data?.notifyOnConnect ?? true,
          notifyOnDisconnect: res.data?.notifyOnDisconnect ?? true,
          emailNotifications: res.data?.emailNotifications ?? false,
        }));
      }
    } catch {}
  };

  const fetchSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await api.getSessions();
      if (res.data) {
        setSessions(Array.isArray(res.data) ? res.data : []);
      }
    } catch {}
    setLoadingSessions(false);
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSession(sessionId);
    try {
      const res = await api.revokeSession(sessionId);
      if (res.data?.success) {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
        toast({ title: 'Session Revoked', description: 'The session has been terminated' });
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to revoke session', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke session', variant: 'destructive' });
    }
    setRevokingSession(null);
  };

  const handleRevokeAllSessions = async () => {
    setRevokingAll(true);
    try {
      const res = await api.revokeAllSessions();
      if (res.data?.success) {
        toast({ title: 'Sessions Revoked', description: `${res.data.revokedCount} session(s) terminated` });
        fetchSessions();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to revoke sessions', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke sessions', variant: 'destructive' });
    }
    setRevokingAll(false);
  };

  const getDeviceIcon = (device: string) => {
    if (device.includes('Chrome')) return '🌐';
    if (device.includes('Firefox')) return '🦊';
    if (device.includes('Safari')) return '🧭';
    if (device.includes('Edge')) return '🔷';
    if (device.includes('Postman') || device.includes('API')) return '⚙️';
    if (device.includes('cURL')) return '💻';
    return '📱';
  };

  const fetchUser = async () => {
    try {
      const res = await api.me();
      if (res.data) {
        setUser(res.data);
        setSettings(prev => ({
          ...prev,
          name: res.data?.name || '',
          email: res.data?.email || '',
        }));
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updatePreferences({
        notifyOnMessage: settings.notifyOnMessage,
        notifyOnConnect: settings.notifyOnConnect,
        notifyOnDisconnect: settings.notifyOnDisconnect,
        emailNotifications: settings.emailNotifications,
      });
      toast({ title: 'Settings saved successfully' });
    } catch (error) {
      toast({ title: 'Failed to save settings', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPass !== passwordForm.confirm) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (passwordForm.newPass.length < 8) {
      toast({ title: 'Password must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await api.changePassword(passwordForm.current, passwordForm.newPass);
      if (res.error) throw new Error(res.error);
      toast({ title: 'Password changed successfully' });
      setShowPasswordDialog(false);
      setPasswordForm({ current: '', newPass: '', confirm: '' });
    } catch (error: any) {
      toast({ title: error?.message || 'Failed to change password', variant: 'destructive' });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast({ title: 'Please enter your password', variant: 'destructive' });
      return;
    }
    setDeletingAccount(true);
    try {
      const res = await api.deleteAccount(deletePassword);
      if (res.error) throw new Error(res.error);
      localStorage.clear();
      window.location.href = '/auth/login';
    } catch (error: any) {
      toast({ title: error?.message || 'Failed to delete account', variant: 'destructive' });
    } finally {
      setDeletingAccount(false);
    }
  };

  const copyApiKey = () => {
    const token = localStorage.getItem('accessToken') || '';
    navigator.clipboard.writeText(token);
    toast({ title: 'API key copied to clipboard' });
  };

  const fetchMembers = async () => {
    setLoadingMembers(true);
    try {
      const res = await api.getMembers();
      const data = Array.isArray(res) ? res : (res.data || []);
      setMembers(data);
    } catch {
      // Members not loaded
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteData.name.trim() || !inviteData.email.trim()) {
      toast({ title: 'Name and email are required', variant: 'destructive' });
      return;
    }
    setInviting(true);
    try {
      const res = await api.addMember(inviteData);
      const member = res.data || res;
      setTempPassword(member.temporaryPassword || '');
      fetchMembers();
      toast({ title: `Member ${inviteData.name} added successfully` });
      setInviteData({ name: '', email: '', role: 'member' });
    } catch (error: any) {
      toast({ title: error?.message || 'Failed to add member', variant: 'destructive' });
    } finally {
      setInviting(false);
    }
  };

  const handleChangeRole = async (memberId: string, role: string) => {
    try {
      await api.updateMemberRole(memberId, role);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role } : m));
      toast({ title: 'Role updated' });
    } catch (error: any) {
      toast({ title: error?.message || 'Failed to update role', variant: 'destructive' });
    }
  };

  const handleRemoveMember = async (member: Member) => {
    if (!confirm(`Remove ${member.name} from your organization?`)) return;
    try {
      await api.removeMember(member.id);
      setMembers(prev => prev.filter(m => m.id !== member.id));
      toast({ title: `${member.name} removed` });
    } catch (error: any) {
      toast({ title: error?.message || 'Failed to remove member', variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="bg-card rounded-2xl border border-border p-6">
          <Skeleton className="h-[400px]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your gateway settings and preferences
        </p>
      </div>

      <Tabs defaultValue="account" className="space-y-6">
        <TabsList className="bg-secondary/30">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="api">API & Webhooks</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>

        {/* Account Tab */}
        <TabsContent value="account">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-semibold text-foreground">Account Information</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    value={settings.name}
                    onChange={e => setSettings(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={settings.email}
                    disabled
                    className="bg-secondary/50"
                  />
                  <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 bg-secondary/20 rounded-xl">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl">
                  {user?.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="font-semibold text-foreground">{user?.name}</div>
                  <div className="text-sm text-muted-foreground">{user?.role || 'User'}</div>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  {user?.organizationId ? 'Organization Member' : 'Personal'}
                </Badge>
              </div>

              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-foreground">Team Members</h2>
                <p className="text-sm text-muted-foreground">Manage who has access to your organization</p>
              </div>
              {user?.role === 'owner' && (
                <Button size="sm" onClick={() => { setTempPassword(''); setShowInviteDialog(true); }}>
                  + Invite Member
                </Button>
              )}
            </div>
            <div className="divide-y divide-border">
              {loadingMembers ? (
                <div className="p-6 space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : members.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="text-4xl mb-3">👥</div>
                  <h3 className="font-semibold text-foreground mb-2">No team members yet</h3>
                  <p className="text-sm text-muted-foreground">Invite members to collaborate</p>
                </div>
              ) : (
                members.map(member => (
                  <div key={member.id} className="p-4 flex items-center gap-4 hover:bg-secondary/10 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg font-semibold">
                      {member.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">{member.name}</div>
                      <div className="text-sm text-muted-foreground truncate">{member.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.role === 'owner' ? (
                        <Badge className="bg-amber-500 text-white">Owner</Badge>
                      ) : user?.role === 'owner' ? (
                        <Select value={member.role} onValueChange={(val) => handleChangeRole(member.id, val)}>
                          <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map(r => (
                              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{member.role}</Badge>
                      )}
                      {user?.role === 'owner' && member.role !== 'owner' && (
                        <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8 p-0"
                          onClick={() => handleRemoveMember(member)}>
                          ✕
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Invite Dialog */}
          <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Invite Team Member</DialogTitle>
                <DialogDescription>Add a new member to your organization team.</DialogDescription>
              </DialogHeader>
              {tempPassword ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                    <h4 className="font-medium text-green-700 dark:text-green-400 mb-2">✅ Member Added!</h4>
                    <p className="text-sm text-green-600 dark:text-green-400 mb-3">Share this temporary password with the new member. They should change it after their first login.</p>
                    <div className="flex gap-2">
                      <Input value={tempPassword} readOnly className="font-mono bg-white dark:bg-secondary" />
                      <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(tempPassword); toast({ title: 'Password copied' }); }}>
                        Copy
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setShowInviteDialog(false); setTempPassword(''); }}>Done</Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input value={inviteData.name} onChange={e => setInviteData(prev => ({ ...prev, name: e.target.value }))} placeholder="John Doe" />
                  </div>
                  <div className="space-y-2">
                    <Label>Email Address *</Label>
                    <Input type="email" value={inviteData.email} onChange={e => setInviteData(prev => ({ ...prev, email: e.target.value }))} placeholder="john@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={inviteData.role} onValueChange={(val) => setInviteData(prev => ({ ...prev, role: val }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(r => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setShowInviteDialog(false)}>Cancel</Button>
                    <Button onClick={handleInviteMember} disabled={inviting}>
                      {inviting ? 'Creating...' : 'Create Member'}
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-semibold text-foreground">Notification Preferences</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                {/* ── Notification Types ── */}
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <div className="font-medium text-foreground">New Message Alerts</div>
                    <div className="text-sm text-muted-foreground">Get notified when you receive a message</div>
                  </div>
                  <Switch
                    checked={settings.notifyOnMessage}
                    onCheckedChange={checked => setSettings(prev => ({ ...prev, notifyOnMessage: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between py-3 border-b border-border">
                  <div>
                    <div className="font-medium text-foreground">Connection Alerts</div>
                    <div className="text-sm text-muted-foreground">Get notified when a profile connects</div>
                  </div>
                  <Switch
                    checked={settings.notifyOnConnect}
                    onCheckedChange={checked => setSettings(prev => ({ ...prev, notifyOnConnect: checked }))}
                  />
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-medium text-foreground">Disconnection Alerts</div>
                    <div className="text-sm text-muted-foreground">Get notified when a profile disconnects</div>
                  </div>
                  <Switch
                    checked={settings.notifyOnDisconnect}
                    onCheckedChange={checked => setSettings(prev => ({ ...prev, notifyOnDisconnect: checked }))}
                  />
                </div>
              </div>

              {/* ── Notification Channels ── */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Notification Channels</h3>
                <p className="text-sm text-muted-foreground">Choose how you want to receive notifications</p>

                <div className="grid gap-3">
                  {/* In-App Channel */}
                  <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-secondary/5">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-lg">🔔</span>
                      <div>
                        <div className="font-medium text-foreground">In-App Notifications</div>
                        <div className="text-xs text-muted-foreground">Bell icon + notification panel in the dashboard</div>
                      </div>
                    </div>
                    <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">Always On</Badge>
                  </div>

                  {/* Email Channel */}
                  <div className="flex items-center justify-between p-4 border border-border rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white text-lg">📧</span>
                      <div>
                        <div className="font-medium text-foreground">Email Notifications</div>
                        <div className="text-xs text-muted-foreground">
                          Send alerts to your email address
                          {user?.email && <span className="ml-1 opacity-70">({user.email})</span>}
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={settings.emailNotifications}
                      onCheckedChange={checked => setSettings(prev => ({ ...prev, emailNotifications: checked }))}
                    />
                  </div>

                  {/* WhatsApp Channel (Coming Soon) */}
                  <div className="flex items-center justify-between p-4 border border-dashed border-border rounded-xl opacity-60">
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-lg">💬</span>
                      <div>
                        <div className="font-medium text-foreground">WhatsApp Notifications</div>
                        <div className="text-xs text-muted-foreground">Receive alerts via WhatsApp message</div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-muted-foreground">Coming Soon</Badge>
                  </div>

                  {/* Push Notification Channel */}
                  <PushNotificationCard />
                </div>
              </div>

              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Preferences'}
              </Button>

              {/* ── SMTP Configuration ── */}
              <div className="space-y-4 pt-6 border-t border-border">
                <div>
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">Email Server (SMTP)</h3>
                  <p className="text-sm text-muted-foreground">Configure SMTP server for sending email notifications</p>
                </div>

                <div className="grid gap-4 p-4 border border-border rounded-xl bg-secondary/5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">SMTP Host</label>
                      <Input
                        placeholder="smtp.gmail.com"
                        value={smtpConfig.host || ''}
                        onChange={e => setSmtpConfig((prev: any) => ({ ...prev, host: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Port</label>
                      <Input
                        type="number"
                        placeholder="587"
                        value={smtpConfig.port || 587}
                        onChange={e => setSmtpConfig((prev: any) => ({ ...prev, port: parseInt(e.target.value) || 587 }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">Username / Email</label>
                      <Input
                        placeholder="user@example.com"
                        value={smtpConfig.user || ''}
                        onChange={e => setSmtpConfig((prev: any) => ({ ...prev, user: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">Password</label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={smtpConfig.pass || ''}
                        onChange={e => setSmtpConfig((prev: any) => ({ ...prev, pass: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">From Address</label>
                      <Input
                        placeholder="noreply@yourdomain.com"
                        value={smtpConfig.from || ''}
                        onChange={e => setSmtpConfig((prev: any) => ({ ...prev, from: e.target.value }))}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={smtpConfig.secure || false}
                          onCheckedChange={checked => setSmtpConfig((prev: any) => ({ ...prev, secure: checked }))}
                        />
                        <div>
                          <div className="text-sm font-medium text-foreground">SSL/TLS</div>
                          <div className="text-xs text-muted-foreground">Use port 465 for SSL</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Test & Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestSmtp(false)}
                      disabled={testingSmtp}
                    >
                      {testingSmtp ? '⏳ Testing...' : '🔌 Test Connection'}
                    </Button>

                    <div className="flex items-center gap-2">
                      <Input
                        type="email"
                        placeholder="test@email.com"
                        className="h-8 w-48 text-sm"
                        value={testEmailAddress}
                        onChange={e => setTestEmailAddress(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestSmtp(true)}
                        disabled={testingSmtp || !testEmailAddress}
                      >
                        📨 Send Test Email
                      </Button>
                    </div>

                    {smtpTestResult && (
                      <span className={`text-sm ${smtpTestResult.success ? 'text-emerald-600' : 'text-destructive'}`}>
                        {smtpTestResult.success ? '✅' : '❌'} {smtpTestResult.message}
                      </span>
                    )}
                  </div>

                  {smtpConfigSource && smtpConfigSource !== 'none' && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
                      💾 Config source: <strong>{smtpConfigSource}</strong>
                      {smtpConfigSource === 'database' ? ' — values stored in database (overrides env vars).' : ' — loaded from environment variables.'}
                    </div>
                  )}
                </div>

                <Button onClick={handleSaveSmtp} disabled={savingSmtp}>
                  {savingSmtp ? 'Saving...' : 'Save SMTP Configuration'}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* API Tab */}
        <TabsContent value="api">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-semibold text-foreground">API & Webhooks</h2>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                API keys and webhooks are managed from their dedicated pages in the sidebar.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Link href="/dashboard/api-keys" className="flex items-center gap-3 p-4 border border-border rounded-xl hover:bg-secondary/20 transition-colors">
                  <span className="text-2xl">🔑</span>
                  <div>
                    <div className="font-medium text-foreground">API Keys</div>
                    <div className="text-sm text-muted-foreground">Manage API keys and permissions</div>
                  </div>
                </Link>
                <Link href="/dashboard/webhooks" className="flex items-center gap-3 p-4 border border-border rounded-xl hover:bg-secondary/20 transition-colors">
                  <span className="text-2xl">🔗</span>
                  <div>
                    <div className="font-medium text-foreground">Webhooks</div>
                    <div className="text-sm text-muted-foreground">Configure event webhooks</div>
                  </div>
                </Link>
              </div>
              <div className="bg-secondary/20 rounded-xl p-4">
                <h4 className="font-medium text-foreground mb-2">API Documentation</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Explore our API endpoints and integrate with your applications.
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3333'}/api/docs`} target="_blank">View API Docs</a>
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-semibold text-foreground">Security Settings</h2>
            </div>
            <div className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="p-4 border border-border rounded-xl">
                  <h4 className="font-medium text-foreground mb-1">Change Password</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Update your account password
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setShowPasswordDialog(true)}>Change Password</Button>
                </div>

                <div className="p-4 border border-border rounded-xl">
                  <h4 className="font-medium text-foreground mb-1">Two-Factor Authentication</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Add an extra layer of security to your account
                  </p>

                  {twoFactorEnabled ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-green-500 text-white">Enabled</Badge>
                        <span className="text-sm text-muted-foreground">2FA is active on your account</span>
                      </div>

                      {/* Backup codes info */}
                      <div className="p-3 bg-secondary/30 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🔐</span>
                            <span className="text-sm text-muted-foreground">
                              Backup codes remaining: <strong className={backupCodesRemaining <= 2 ? 'text-orange-500' : 'text-foreground'}>{backupCodesRemaining}</strong>
                            </span>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={regeneratingCodes}
                            onClick={handleRegenerateBackupCodes}
                          >
                            {regeneratingCodes ? 'Generating...' : '🔄 Regenerate'}
                          </Button>
                        </div>
                        {backupCodesRemaining <= 2 && backupCodesRemaining > 0 && (
                          <p className="text-xs text-orange-500 mt-2">⚠️ You're running low on backup codes. Consider regenerating.</p>
                        )}
                        {backupCodesRemaining === 0 && (
                          <p className="text-xs text-red-500 mt-2">⚠️ No backup codes remaining! Regenerate now to avoid being locked out.</p>
                        )}
                      </div>

                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={setting2FA}
                        onClick={async () => {
                          setSetting2FA(true);
                          try {
                            const res = await api.disable2FA();
                            if (res.data?.success) {
                              setTwoFactorEnabled(false);
                              setTwoFactorSetup(null);
                              setBackupCodes([]);
                              setBackupCodesRemaining(0);
                              toast({ title: 'Success', description: '2FA has been disabled' });
                            } else {
                              toast({ title: 'Error', description: res.error || 'Failed to disable 2FA', variant: 'destructive' });
                            }
                          } catch {
                            toast({ title: 'Error', description: 'Failed to disable 2FA', variant: 'destructive' });
                          }
                          setSetting2FA(false);
                        }}
                      >
                        {setting2FA ? 'Disabling...' : 'Disable 2FA'}
                      </Button>
                    </div>
                  ) : twoFactorSetup ? (
                    <div className="space-y-4">
                      <div className="flex justify-center">
                        <img src={twoFactorSetup.qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48 rounded-lg border border-border" />
                      </div>
                      <p className="text-sm text-center text-muted-foreground">
                        Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                      </p>
                      <div className="bg-secondary/30 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Manual entry key:</p>
                        <code className="text-sm font-mono text-foreground select-all">{twoFactorSetup.secret}</code>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter 6-digit code"
                          value={twoFactorCode}
                          onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          maxLength={6}
                          className="font-mono text-center text-lg tracking-widest"
                        />
                        <Button
                          disabled={twoFactorCode.length !== 6 || setting2FA}
                          onClick={async () => {
                            setSetting2FA(true);
                            try {
                              const res = await api.enable2FA(twoFactorCode);
                              if (res.data?.enabled) {
                                setTwoFactorEnabled(true);
                                setBackupCodes(res.data.backupCodes);
                                setShowBackupCodes(true);
                                setTwoFactorSetup(null);
                                setTwoFactorCode('');
                                toast({ title: 'Success', description: '2FA has been enabled!' });
                              } else {
                                toast({ title: 'Error', description: res.error || 'Invalid verification code', variant: 'destructive' });
                              }
                            } catch {
                              toast({ title: 'Error', description: 'Invalid verification code', variant: 'destructive' });
                            }
                            setSetting2FA(false);
                          }}
                        >
                          {setting2FA ? 'Verifying...' : 'Verify'}
                        </Button>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => { setTwoFactorSetup(null); setTwoFactorCode(''); }}>
                        Cancel
                      </Button>
                    </div>
                  ) : showBackupCodes && backupCodes.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-foreground">Save your backup codes:</p>
                      <p className="text-xs text-muted-foreground">These codes can be used to access your account if you lose your authenticator device. Each code can only be used once.</p>
                      <div className="bg-secondary/30 rounded-lg p-3 grid grid-cols-2 gap-2">
                        {backupCodes.map((code, i) => (
                          <code key={i} className="text-sm font-mono text-foreground">{code}</code>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
                          navigator.clipboard.writeText(backupCodes.join('\n'));
                          toast({ title: 'Copied', description: 'Backup codes copied to clipboard' });
                        }}>Copy Codes</Button>
                        <Button size="sm" onClick={() => setShowBackupCodes(false)}>Done</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">Not Enabled</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={setting2FA}
                        onClick={async () => {
                          setSetting2FA(true);
                          try {
                            const res = await api.setup2FA();
                            if (res.data) {
                              setTwoFactorSetup(res.data);
                            } else {
                              toast({ title: 'Error', description: res.error || 'Failed to setup 2FA', variant: 'destructive' });
                            }
                          } catch {
                            toast({ title: 'Error', description: 'Failed to setup 2FA', variant: 'destructive' });
                          }
                          setSetting2FA(false);
                        }}
                      >
                        {setting2FA ? 'Setting up...' : 'Enable 2FA'}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="p-4 border border-border rounded-xl">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-medium text-foreground">Active Sessions</h4>
                      <p className="text-sm text-muted-foreground">
                        View and manage your active sessions
                      </p>
                    </div>
                    {sessions.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revokingAll}
                        onClick={handleRevokeAllSessions}
                        className="text-xs text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
                      >
                        {revokingAll ? 'Revoking...' : 'Revoke All Others'}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {loadingSessions ? (
                      <div className="space-y-2">
                        {[1, 2].map(i => <Skeleton key={i} className="h-14" />)}
                      </div>
                    ) : sessions.length === 0 ? (
                      <div className="flex items-center gap-3 p-3 bg-secondary/20 rounded-lg">
                        <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center">💻</div>
                        <div className="flex-1">
                          <div className="text-sm font-medium text-foreground">Current Session</div>
                          <div className="text-xs text-muted-foreground">This device</div>
                        </div>
                        <Badge className="bg-green-500 text-white">Active</Badge>
                      </div>
                    ) : (
                      sessions.map((session, index) => (
                        <div key={session.id} className="flex items-center gap-3 p-3 bg-secondary/20 rounded-lg hover:bg-secondary/30 transition-colors">
                          <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center text-lg">
                            {getDeviceIcon(session.device)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground">{session.device || 'Unknown Device'}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              {session.ipAddress && <span>{session.ipAddress}</span>}
                              {session.ipAddress && <span>·</span>}
                              <span>Active {new Date(session.lastActiveAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                          {index === 0 ? (
                            <Badge className="bg-green-500 text-white">Current</Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={revokingSession === session.id}
                              onClick={() => handleRevokeSession(session.id)}
                              className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-7 px-2"
                            >
                              {revokingSession === session.id ? '...' : 'Revoke'}
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-xl">
                  <h4 className="font-medium text-red-700 dark:text-red-400 mb-1">Danger Zone</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Once deleted, your account and all data cannot be recovered.
                  </p>
                  <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>Delete Account</Button>
                </div>

                {/* Connected Devices / WhatsApp Profiles */}
                <div className="p-4 border border-border rounded-xl">
                  <h4 className="font-medium text-foreground mb-1 flex items-center gap-2">
                    <span>📱</span> Connected Devices
                  </h4>
                  <p className="text-sm text-muted-foreground mb-3">WhatsApp profiles connected to this gateway</p>
                  {connectedProfiles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No profiles configured</p>
                  ) : (
                    <div className="space-y-2">
                      {connectedProfiles.map(profile => (
                        <div key={profile.id} className="flex items-center justify-between py-2 px-3 bg-secondary/30 rounded-lg">
                          <div className="flex items-center gap-3">
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                              profile.status === 'connected' ? 'bg-emerald-500' :
                              profile.status === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-gray-300'
                            }`} />
                            <div>
                              <p className="text-sm font-medium text-foreground">{profile.name}</p>
                              <p className="text-xs text-muted-foreground">{profile.phone || profile.sessionData?.jid || 'No phone'}</p>
                            </div>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            profile.status === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
                            profile.status === 'connecting' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                            'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>{profile.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Link href="/dashboard/profiles" className="text-xs text-blue-600 hover:underline mt-3 inline-block">Manage Profiles →</Link>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/20">
              <h2 className="font-semibold text-foreground">Storage Configuration</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Storage Type Selector */}
              <div className="space-y-2">
                <Label>Storage Type</Label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    className={`p-4 border rounded-xl text-left transition-all ${
                      storageConfig.type === 'local'
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:bg-secondary/20'
                    }`}
                    onClick={() => setStorageConfig(prev => ({ ...prev, type: 'local' }))}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white">📁</span>
                      <div>
                        <h4 className="font-medium text-foreground">Local Storage</h4>
                        <p className="text-xs text-muted-foreground">Files stored on the server filesystem</p>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`p-4 border rounded-xl text-left transition-all ${
                      storageConfig.type === 's3'
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border hover:bg-secondary/20'
                    }`}
                    onClick={() => setStorageConfig(prev => ({ ...prev, type: 's3' }))}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white">☁️</span>
                      <div>
                        <h4 className="font-medium text-foreground">S3 / MinIO</h4>
                        <p className="text-xs text-muted-foreground">Object storage compatible with AWS S3</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* S3 Configuration Fields */}
              {storageConfig.type === 's3' && (
                <div className="space-y-4 border border-border rounded-xl p-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>S3 Endpoint</Label>
                      <Input
                        value={storageConfig.s3Endpoint || ''}
                        onChange={e => setStorageConfig(prev => ({ ...prev, s3Endpoint: e.target.value }))}
                        placeholder="https://minio.example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Bucket Name</Label>
                      <Input
                        value={storageConfig.s3Bucket || ''}
                        onChange={e => setStorageConfig(prev => ({ ...prev, s3Bucket: e.target.value }))}
                        placeholder="multiwa-uploads"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Region</Label>
                      <Input
                        value={storageConfig.s3Region || ''}
                        onChange={e => setStorageConfig(prev => ({ ...prev, s3Region: e.target.value }))}
                        placeholder="us-east-1"
                      />
                    </div>
                    <div className="space-y-2 flex items-end gap-2">
                      <div className="flex-1">
                        <Label>Force Path Style</Label>
                        <p className="text-xs text-muted-foreground mb-1">Enable for MinIO and non-AWS S3</p>
                      </div>
                      <Switch
                        checked={storageConfig.s3ForcePathStyle !== false}
                        onCheckedChange={checked => setStorageConfig(prev => ({ ...prev, s3ForcePathStyle: checked }))}
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Access Key</Label>
                      <Input
                        value={storageConfig.s3AccessKey || ''}
                        onChange={e => setStorageConfig(prev => ({ ...prev, s3AccessKey: e.target.value }))}
                        placeholder="your-access-key"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Secret Key</Label>
                      <Input
                        type="password"
                        value={storageConfig.s3SecretKey || ''}
                        onChange={e => setStorageConfig(prev => ({ ...prev, s3SecretKey: e.target.value }))}
                        placeholder="your-secret-key"
                      />
                    </div>
                  </div>

                  {/* Connection Test */}
                  <div className="flex items-center gap-3 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={testingStorage}
                      onClick={async () => {
                        setTestingStorage(true);
                        setStorageTestResult(null);
                        try {
                          const res = await api.testStorageConnection(storageConfig);
                          setStorageTestResult(res.data || res);
                        } catch {
                          setStorageTestResult({ success: false, message: 'Request failed' });
                        }
                        setTestingStorage(false);
                      }}
                    >
                      {testingStorage ? '⏳ Testing...' : '🔌 Test Connection'}
                    </Button>
                    {storageTestResult && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm ${storageTestResult.success ? 'text-emerald-600' : 'text-red-500'}`}>
                          {storageTestResult.success ? '✅' : '❌'} {storageTestResult.message}
                        </span>
                        {storageTestResult.bucketMissing && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                            disabled={testingStorage}
                            onClick={async () => {
                              setTestingStorage(true);
                              try {
                                const res = await api.testStorageConnection(storageConfig, { createBucket: true });
                                setStorageTestResult(res.data || res);
                              } catch {
                                setStorageTestResult({ success: false, message: 'Failed to create bucket' });
                              }
                              setTestingStorage(false);
                            }}
                          >
                            📦 Create Bucket
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Source Indicator */}
              {storageConfigSource && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-300 flex items-start gap-2">
                  <span>ℹ️</span>
                  <p>Config source: <strong>{storageConfigSource}</strong>{storageConfigSource === 'env' ? ' — values from environment variables. Save to store in database.' : ' — values stored in database (overrides env vars).'}</p>
                </div>
              )}

              {/* Save Button */}
              <Button
                disabled={savingStorage}
                onClick={async () => {
                  setSavingStorage(true);
                  try {
                    const res = await api.updateStorageConfig(storageConfig);
                    if (res.data?.success) {
                      toast({ title: 'Saved', description: 'Storage configuration updated' });
                      setStorageConfigSource('database');
                    } else {
                      toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
                    }
                  } catch {
                    toast({ title: 'Error', description: 'Failed to save storage config', variant: 'destructive' });
                  }
                  setSavingStorage(false);
                }}
              >
                {savingStorage ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
            <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Current Password</Label>
              <Input
                type="password"
                value={passwordForm.current}
                onChange={e => setPasswordForm(prev => ({ ...prev, current: e.target.value }))}
                placeholder="Enter current password"
              />
            </div>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input
                type="password"
                value={passwordForm.newPass}
                onChange={e => setPasswordForm(prev => ({ ...prev, newPass: e.target.value }))}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={passwordForm.confirm}
                onChange={e => setPasswordForm(prev => ({ ...prev, confirm: e.target.value }))}
                placeholder="Re-enter new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>Cancel</Button>
            <Button onClick={handleChangePassword} disabled={changingPassword}>
              {changingPassword ? 'Changing...' : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Delete Account</DialogTitle>
            <DialogDescription>This action cannot be undone. Please confirm by entering your password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This action is irreversible. All your data, profiles, and organization settings will be permanently deleted.
            </p>
            <div className="space-y-2">
              <Label>Enter your password to confirm</Label>
              <Input
                type="password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder="Your password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deletingAccount}>
              {deletingAccount ? 'Deleting...' : 'Delete My Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Push Notification Card — interactive enable/disable with test button
 */
function PushNotificationCard() {
  const { isSupported, permission, isSubscribed, isLoading, error, subscribe, unsubscribe, testPush } = usePushNotifications();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  const handleToggle = async (enable: boolean) => {
    if (enable) {
      const success = await subscribe();
      if (success) {
        toast({ title: 'Push notifications enabled', description: 'You will receive browser push notifications.' });
      } else if (permission === 'denied') {
        toast({ title: 'Permission denied', description: 'Please allow notifications in your browser settings.', variant: 'destructive' });
      }
    } else {
      const success = await unsubscribe();
      if (success) {
        toast({ title: 'Push notifications disabled', description: 'You will no longer receive browser push notifications.' });
      }
    }
  };

  const handleTest = async () => {
    setTesting(true);
    const result = await testPush();
    console.log('[Push] Test diagnostics:', JSON.stringify(result, null, 2));
    setTesting(false);
    if (result?.success) {
      toast({ title: 'Test push sent!', description: `${result.message}. Check browser notifications.` });
    } else {
      const errorDetail = result?.results?.[0]?.error || result?.error || result?.message || 'Could not send test push';
      toast({ title: 'Test failed', description: errorDetail, variant: 'destructive' });
    }
  };

  if (!isSupported) {
    return (
      <div className="flex items-center justify-between p-4 border border-dashed border-border rounded-xl opacity-60">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white text-lg">📲</span>
          <div>
            <div className="font-medium text-foreground">Push Notifications</div>
            <div className="text-xs text-muted-foreground">Not supported in this browser</div>
          </div>
        </div>
        <Badge variant="outline" className="text-muted-foreground">Unsupported</Badge>
      </div>
    );
  }

  return (
    <div className="p-4 border border-border rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white text-lg">📲</span>
          <div>
            <div className="font-medium text-foreground">Push Notifications</div>
            <div className="text-xs text-muted-foreground">
              {isSubscribed ? 'Enabled — you will receive browser push alerts' : 'Enable browser push notifications'}
            </div>
          </div>
        </div>
        <Switch
          checked={isSubscribed}
          onCheckedChange={handleToggle}
          disabled={isLoading || permission === 'denied'}
        />
      </div>

      {permission === 'denied' && (
        <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
          ⚠️ Notification permission was denied. Please enable it in your browser settings, then refresh.
        </div>
      )}

      {error && permission !== 'denied' && (
        <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {isSubscribed && (
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? 'Sending...' : '🔔 Send Test Push'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Send a test push to this browser
          </span>
        </div>
      )}
    </div>
  );
}

