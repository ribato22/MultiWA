// MultiWA Admin - Dashboard Layout with Sidebar
// apps/admin/src/app/dashboard/layout.tsx

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutGrid,
  Smartphone,
  MessagesSquare,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  MessageSquare,
  Users,
  LayoutTemplate,
  Megaphone,
  Zap,
  BarChart3,
  Webhook as WebhookIcon,
  Puzzle,
  Brain,
  KeyRound,
  ClipboardList,
  Settings as SettingsIcon,
  Bell,
  BellOff,
  Menu,
  LogOut,
  ChevronRight,
  ChevronDown,
  MessageCircle,
  Wifi,
  WifiOff,
  Lock,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api, Notification } from '@/lib/api';
import { canConfigure, currentUser } from '@/lib/current-user';
import { EmptyState } from '@/components/ui/empty-state';
import { DemoBanner } from '@/components/demo-banner';
import { CallsProvider, forgetStoredCall } from '@/components/calls/calls-provider';
import { AvailabilityToggle } from '@/components/calls/availability-toggle';
import { IncomingCallBanner } from '@/components/calls/incoming-call-banner';
import { InCallBar } from '@/components/calls/in-call-bar';
import { formatRelative, formatFull } from '@/lib/datetime';

// `admin`: every read of the page is an owner's or admin's, so the other roles get neither its link nor the page.
type MenuItem = { name: string; href: string; Icon: LucideIcon; admin?: boolean };

const menuItems: MenuItem[] = [
  { name: 'Overview',     href: '/dashboard',              Icon: LayoutGrid },
  { name: 'Profiles',     href: '/dashboard/profiles',     Icon: Smartphone },
  { name: 'Chat',         href: '/dashboard/chat',         Icon: MessagesSquare },
  { name: 'Calls',        href: '/dashboard/calls',        Icon: PhoneIncoming },
  { name: 'Messages',     href: '/dashboard/messages',     Icon: MessageSquare },
  { name: 'Contacts',     href: '/dashboard/contacts',     Icon: Users },
  { name: 'Templates',    href: '/dashboard/templates',    Icon: LayoutTemplate },
  { name: 'Broadcast',    href: '/dashboard/broadcast',    Icon: Megaphone },
  { name: 'Automation',   href: '/dashboard/automation',   Icon: Zap },
  { name: 'Analytics',    href: '/dashboard/analytics',    Icon: BarChart3 },
  { name: 'Webhooks',     href: '/dashboard/webhooks',     Icon: WebhookIcon, admin: true },
  { name: 'Integrations', href: '/dashboard/integrations', Icon: Puzzle },
  { name: 'Knowledge',    href: '/dashboard/knowledge',    Icon: Brain },
  { name: 'API Keys',     href: '/dashboard/api-keys',     Icon: KeyRound },
  { name: 'Audit',        href: '/dashboard/audit',        Icon: ClipboardList, admin: true },
  { name: 'Settings',     href: '/dashboard/settings',     Icon: SettingsIcon },
];

type NotifTypeInfo = { Icon: LucideIcon; tone: string };
const notifIcons: Record<string, NotifTypeInfo> = {
  message:       { Icon: MessageCircle, tone: 'text-sky-300' },
  connection:    { Icon: Wifi,          tone: 'text-primary' },
  disconnection: { Icon: WifiOff,       tone: 'text-destructive' },
  broadcast:     { Icon: Megaphone,     tone: 'text-violet-300' },
  automation:    { Icon: Zap,           tone: 'text-amber-300' },
  system:        { Icon: Wrench,        tone: 'text-muted-foreground' },
  security:      { Icon: Lock,          tone: 'text-rose-300' },
  call:          { Icon: PhoneMissed,   tone: 'text-rose-300' },
};
// The call alerts (the media server died, a recording failed, the recording storage) come as `system`, with a kind
// that starts `call_` or `calls_`.
const CALL_ALERT: NotifTypeInfo = { Icon: PhoneOff, tone: 'text-amber-300' };
const notifIcon = (n: Notification): NotifTypeInfo =>
  (n.type === 'system' && /^calls?_/.test(String(n.metadata?.kind ?? '')) ? CALL_ALERT : notifIcons[n.type]) ?? { Icon: Bell, tone: 'text-muted-foreground' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close drawer when route changes (mobile)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ESC key closes drawer
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    if (mobileOpen) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [mobileOpen]);

  // Notification state
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Chat unread (org-wide) for the sidebar badge
  const [chatUnread, setChatUnread] = useState(0);

  // Open call follow-ups (org-wide) for the sidebar Calls badge
  const [callsOpen, setCallsOpen] = useState(0);

  // Account menu (top-right)
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      router.push('/auth/login');
      return;
    }
    setUser(JSON.parse(userData));
    // A role changed since sign-in reaches the UI without signing out: the server's answer updates the stored user.
    api.me().then(({ data }) => {
      const stored = currentUser();
      if (!data?.role || !stored || stored.id !== data.id) return; // failed, or signed out or in as someone else since
      if (data.role === stored.role && !!data.isServerOwner === !!stored.isServerOwner) return;
      const next = { ...stored, role: data.role, isServerOwner: data.isServerOwner };
      localStorage.setItem('user', JSON.stringify(next));
      setUser(next);
    });
  }, [router]);

  // Fetch unread count periodically
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.getUnreadCount();
      if (res.data) setUnreadCount(res.data.count);
    } catch {}
    try {
      const chat = await api.getChatUnreadCount();
      if (chat.data) setChatUnread(chat.data.count);
    } catch {}
    try {
      const calls = await api.getCallsOpenCount();
      if (calls.data) setCallsOpen(calls.data.count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 15000); // every 15s
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch notifications when dropdown opens
  const openNotifDropdown = async () => {
    setShowNotifDropdown(true);
    try {
      const res = await api.getNotifications({ limit: 20 });
      if (res.data) setNotifications(res.data.notifications);
    } catch {}
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifDropdown(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Raised over the incoming-call banner while open, a menu left open would sit over a dialog too: Escape closes it (the
  // focus in it goes back to its button), and so does the focus moving out of it (closeOnLeave).
  useEffect(() => {
    if (!showNotifDropdown && !showUserMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      for (const ref of [notifRef, userRef]) {
        if (ref.current?.contains(document.activeElement)) ref.current.querySelector('button')?.focus();
      }
      setShowNotifDropdown(false);
      setShowUserMenu(false);
    }
    // A call that rang while the tab was behind another took the focus with no blur here: back in the tab, the menu
    // goes, or it would hide the Answer that has the focus. Only then: Safari never focuses a menu's own button, so the
    // focus is outside a menu opened with the mouse.
    function onBack() {
      if (!document.activeElement?.closest('[data-call-console]')) return;
      setShowNotifDropdown(false);
      setShowUserMenu(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('focus', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('focus', onBack);
    };
  }, [showNotifDropdown, showUserMenu]);
  // The incoming-call banner floats just below the header, which a call makes taller once its bar takes a row of its own.
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const resized = new ResizeObserver(() => shellRef.current?.style.setProperty('--header-height', `${header.offsetHeight}px`));
    resized.observe(header);
    return () => resized.disconnect();
  }, [user]);
  // No target is the focus going nowhere (a click on the menu's own text): clicks have the outside-click handler.
  const closeOnLeave = (close: () => void) => (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close();
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    setUnreadCount(0);
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const handleMarkRead = async (id: string) => {
    await api.markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const handleLogout = () => {
    forgetStoredCall(user.id); // the next login in this tab must not rejoin this one's call
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.push('/auth/login');
  };

  if (!user) return null;

  const admin = canConfigure(user.role);
  const blocked = !admin && menuItems.some((item) => item.admin && pathname.startsWith(item.href));

  const shell = (
    <div ref={shellRef} className="min-h-screen bg-background">
      {/* Demo Mode Banner */}
      <DemoBanner />

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden cursor-pointer"
          aria-label="Close menu"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 ${sidebarOpen ? 'w-64' : 'md:w-20 w-64'}`}
        aria-label="Primary navigation"
      >
        <div className="h-full bg-card border-r border-border flex flex-col">
          {/* Logo */}
          <div className="p-4 border-b border-border">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ring-1 ring-border bg-secondary/30">
                <Image
                  src="/logo.png"
                  alt="MultiWA"
                  width={40}
                  height={40}
                  className="object-contain"
                />
              </div>
              {sidebarOpen && (
                <span className="text-lg font-bold text-foreground tracking-tight">
                  MultiWA
                </span>
              )}
            </Link>
          </div>

          {/* Menu */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" aria-label="Dashboard sections">
            {menuItems.filter((item) => admin || !item.admin).map((item) => {
              const Icon = item.Icon;
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const badge = item.href === '/dashboard/chat' ? chatUnread : item.href === '/dashboard/calls' ? callsOpen : 0;
              const badgeLabel = badge > 99 ? '99+' : String(badge);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  title={!sidebarOpen ? item.name : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                    isActive
                      ? 'bg-primary/15 text-primary ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  }`}
                >
                  <span className="relative flex-shrink-0">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                    {badge > 0 && !sidebarOpen && (
                      <span
                        className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center px-1 tabular-nums ring-2 ring-card"
                        aria-hidden="true"
                      >
                        {badgeLabel}
                      </span>
                    )}
                  </span>
                  {sidebarOpen && <span className="font-medium text-sm">{item.name}</span>}
                  {sidebarOpen && badge > 0 && (
                    <span
                      className="ml-auto min-w-[20px] h-5 bg-destructive text-destructive-foreground text-[11px] font-bold rounded-full flex items-center justify-center px-1.5 tabular-nums"
                      aria-label={item.href === '/dashboard/calls' ? `${badge} open` : `${badge} unread`}
                    >
                      {badgeLabel}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

        </div>
      </aside>

      {/* Main Content: where the call console gives the focus back when it has nowhere better, never to the page itself.
          It can take the focus only while it has that one (lib/call-console/focus.ts), and shows no ring. */}
      <main
        className={`outline-none transition-all duration-300 ${
          sidebarOpen ? 'md:ml-64' : 'md:ml-20'
        }`}
      >
        {/* Header */}
        {/* The header is its menus' stacking context: while one is open, it goes over the incoming-call banner (z-[60]). */}
        <header ref={headerRef} className={`sticky top-0 ${showUserMenu || showNotifDropdown ? 'z-[61]' : 'z-30'} bg-background/80 backdrop-blur-md border-b border-border`}>
          <div className="flex flex-wrap items-center justify-between gap-y-3 px-6 py-4 [container-type:inline-size]">
            <button
              type="button"
              onClick={() => {
                // Mobile: toggle drawer. Desktop: toggle collapse.
                if (window.matchMedia('(min-width: 768px)').matches) {
                  setSidebarOpen(!sidebarOpen);
                } else {
                  setMobileOpen(!mobileOpen);
                }
              }}
              aria-label={mobileOpen || sidebarOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen || sidebarOpen}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9 p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            {/* The call's bar: on a row of its own under the header's controls, and between them once the header is
                wide enough for all of it. min-w-0: a long name is cut, rather than push the controls off the screen. */}
            <div className="order-last min-w-0 basis-full empty:hidden [@container(min-width:68rem)]:order-none [@container(min-width:68rem)]:flex [@container(min-width:68rem)]:flex-1 [@container(min-width:68rem)]:justify-center [@container(min-width:68rem)]:px-4">
              <InCallBar />
            </div>
            <div className="flex items-center gap-4">
              <AvailabilityToggle />
              {/* Notification Bell */}
              <div className="relative" ref={notifRef} onBlur={closeOnLeave(() => setShowNotifDropdown(false))}>
                <button
                  type="button"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9 p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground relative transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                  onClick={() => showNotifDropdown ? setShowNotifDropdown(false) : openNotifDropdown()}
                  aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                  aria-expanded={showNotifDropdown}
                >
                  <Bell className="w-5 h-5" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1 tabular-nums ring-2 ring-background"
                      aria-hidden="true"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Notification Dropdown */}
                {showNotifDropdown && (
                  <div
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 top-full mt-2 w-96 bg-card rounded-xl shadow-2xl shadow-black/40 border border-border overflow-hidden z-50"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="font-semibold text-foreground">Notifications</h3>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-xs text-primary hover:text-primary/80 font-medium cursor-pointer"
                        >
                          Mark all as read
                        </button>
                      )}
                    </div>

                    {/* List */}
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground">
                          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/60">
                            <BellOff className="w-6 h-6 opacity-60" aria-hidden="true" />
                          </div>
                          <p className="text-sm">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.map(notif => {
                          const typeInfo = notifIcon(notif);
                          const TypeIcon = typeInfo.Icon;
                          return (
                            <button
                              key={notif.id}
                              type="button"
                              className={`w-full flex items-start gap-3 px-4 py-3 hover:bg-secondary/40 cursor-pointer transition-colors border-b border-border/60 text-left focus:outline-none focus:bg-secondary/40 ${
                                !notif.isRead ? 'bg-primary/5' : ''
                              }`}
                              onClick={() => !notif.isRead && handleMarkRead(notif.id)}
                            >
                              <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/60 flex-shrink-0 mt-0.5 ${typeInfo.tone}`}>
                                <TypeIcon className="w-4 h-4" aria-hidden="true" />
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${!notif.isRead ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>
                                  {notif.title}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{notif.body}</p>
                                <p className="text-[10px] text-muted-foreground/70 mt-1 tabular-nums" title={formatFull(notif.createdAt)}>{formatRelative(notif.createdAt)}</p>
                              </div>
                              {!notif.isRead && (
                                <span
                                  className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-2"
                                  aria-label="Unread"
                                />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Footer */}
                    {notifications.length > 0 && (
                      <div className="px-4 py-2 border-t border-border">
                        <Link
                          href="/dashboard/settings?tab=notifications"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
                          onClick={() => setShowNotifDropdown(false)}
                        >
                          Notification Settings
                          <ChevronRight className="w-3 h-3" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Account menu */}
              <div className="relative" ref={userRef} onBlur={closeOnLeave(() => setShowUserMenu(false))}>
                {/* Named by the name and email it shows (a phone screen shows only the initial), then by what it opens:
                    the visible text is part of the name (WCAG 2.5.3). */}
                <button
                  type="button"
                  onClick={() => setShowUserMenu((v) => !v)}
                  aria-expanded={showUserMenu}
                  className="inline-flex items-center gap-2 rounded-lg p-1 sm:pr-2 hover:bg-secondary/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <span aria-hidden="true" className="w-9 h-9 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center justify-center font-medium flex-shrink-0">
                    {user.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                  <span className="hidden sm:block max-w-[160px] text-left leading-tight">
                    <span className="block text-sm font-medium text-foreground truncate">{user.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
                  </span>
                  <span className="sr-only">Account menu</span>
                  <ChevronDown className="hidden sm:block w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                </button>

                {showUserMenu && (
                  <div
                    role="menu"
                    aria-label="Account"
                    className="absolute right-0 top-full mt-2 w-60 bg-card rounded-xl shadow-2xl shadow-black/40 border border-border overflow-hidden z-50"
                  >
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      onClick={() => setShowUserMenu(false)}
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm text-foreground/90 hover:bg-secondary/60 transition-colors cursor-pointer focus:outline-none focus:bg-secondary/60"
                    >
                      <SettingsIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer focus:outline-none focus:bg-destructive/10 border-t border-border/60"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">
          {blocked ? (
            <EmptyState
              icon={<Lock className="w-8 h-8" aria-hidden="true" />}
              title="Not available for your role"
              titleAs="h1"
              description="Only an owner or an admin can open this page."
              action={{ label: 'Back to the overview', href: '/dashboard' }}
            />
          ) : (
            children
          )}
        </div>
      </main>
      <IncomingCallBanner />
    </div>
  );
  // The call console wraps every dashboard page: a call outlives page changes.
  return <CallsProvider user={user}>{shell}</CallsProvider>;
}