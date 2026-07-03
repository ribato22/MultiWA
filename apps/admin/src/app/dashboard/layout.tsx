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
  Languages,
  type LucideIcon,
} from 'lucide-react';
import { api, Notification } from '@/lib/api';
import { DemoBanner } from '@/components/demo-banner';
import { formatRelative, formatFull } from '@/lib/datetime';
import { useI18n } from '@/lib/i18n/provider';
import type { MessageKey } from '@/lib/i18n/messages';

type MenuItem = { key: MessageKey; href: string; Icon: LucideIcon };

const menuItems: MenuItem[] = [
  { key: 'nav.overview', href: '/dashboard', Icon: LayoutGrid },
  { key: 'nav.profiles', href: '/dashboard/profiles', Icon: Smartphone },
  { key: 'nav.chat', href: '/dashboard/chat', Icon: MessagesSquare },
  { key: 'nav.messages', href: '/dashboard/messages', Icon: MessageSquare },
  { key: 'nav.contacts', href: '/dashboard/contacts', Icon: Users },
  { key: 'nav.templates', href: '/dashboard/templates', Icon: LayoutTemplate },
  { key: 'nav.broadcast', href: '/dashboard/broadcast', Icon: Megaphone },
  { key: 'nav.automation', href: '/dashboard/automation', Icon: Zap },
  { key: 'nav.analytics', href: '/dashboard/analytics', Icon: BarChart3 },
  { key: 'nav.webhooks', href: '/dashboard/webhooks', Icon: WebhookIcon },
  { key: 'nav.integrations', href: '/dashboard/integrations', Icon: Puzzle },
  { key: 'nav.knowledge', href: '/dashboard/knowledge', Icon: Brain },
  { key: 'nav.apiKeys', href: '/dashboard/api-keys', Icon: KeyRound },
  { key: 'nav.audit', href: '/dashboard/audit', Icon: ClipboardList },
  { key: 'nav.settings', href: '/dashboard/settings', Icon: SettingsIcon },
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
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { language, setLanguage, options, t } = useI18n();
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

  // Account menu (top-right)
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    } else {
      router.push('/auth/login');
    }
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
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    router.push('/auth/login');
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Demo Mode Banner */}
      <DemoBanner />

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden cursor-pointer"
          aria-label={t('header.closeMenuOverlay')}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 ${sidebarOpen ? 'w-64' : 'md:w-20 w-64'}`}
        aria-label={t('nav.primary')}
      >
        <div className="h-full bg-card border-r border-border flex flex-col">
          {/* Logo */}
          <div className="p-4 border-b border-border">
            <Link href="/dashboard" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden ring-1 ring-border bg-secondary/30">
                <Image
                  src="/logo.png"
                  alt={t('app.name')}
                  width={40}
                  height={40}
                  className="object-contain"
                />
              </div>
              {sidebarOpen && (
                <span className="text-lg font-bold text-foreground tracking-tight">
                  {t('app.name')}
                </span>
              )}
            </Link>
          </div>

          {/* Menu */}
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto" aria-label={t('nav.sections')}>
            {menuItems.map((item) => {
              const Icon = item.Icon;
              const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
              const badge = item.href === '/dashboard/chat' ? chatUnread : 0;
              const badgeLabel = badge > 99 ? '99+' : String(badge);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  title={!sidebarOpen ? t(item.key) : undefined}
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
                  {sidebarOpen && <span className="font-medium text-sm">{t(item.key)}</span>}
                  {sidebarOpen && badge > 0 && (
                    <span
                      className="ml-auto min-w-[20px] h-5 bg-destructive text-destructive-foreground text-[11px] font-bold rounded-full flex items-center justify-center px-1.5 tabular-nums"
                      aria-label={t('chat.unread', { count: badge })}
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

      {/* Main Content */}
      <main
        className={`transition-all duration-300 ${
          sidebarOpen ? 'md:ml-64' : 'md:ml-20'
        }`}
      >
        {/* Header */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="flex items-center justify-between px-6 py-4">
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
              aria-label={mobileOpen || sidebarOpen ? t('header.closeMenu') : t('header.openMenu')}
              aria-expanded={mobileOpen || sidebarOpen}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9 p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 sm:gap-4">
              <div
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/50 p-1 shadow-sm"
                role="group"
                aria-label={t('header.language')}
              >
                <span className="hidden sm:inline-flex items-center gap-1 px-1.5 text-xs font-medium text-muted-foreground">
                  <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{t('header.language')}</span>
                </span>
                {options.map((opt) => {
                  const isActive = language === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLanguage(opt.value)}
                      aria-pressed={isActive}
                      aria-label={`${t('header.language')}: ${opt.label}`}
                      title={opt.nativeLabel}
                      className={`min-h-[36px] min-w-[36px] sm:min-h-8 sm:min-w-0 sm:px-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    >
                      <span className="sm:hidden" aria-hidden="true">
                        {opt.value.toUpperCase()}
                      </span>
                      <span className="hidden sm:inline">{opt.nativeLabel}</span>
                    </button>
                  );
                })}
              </div>

              {/* Notification Bell */}
              <div className="relative" ref={notifRef}>
                <button
                  type="button"
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-9 md:min-w-9 p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground relative transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                  onClick={() => showNotifDropdown ? setShowNotifDropdown(false) : openNotifDropdown()}
                  aria-label={unreadCount > 0 ? t('header.notificationsUnread', { count: unreadCount }) : t('header.notifications')}
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
                    aria-label={t('header.notifications')}
                    className="absolute right-0 top-full mt-2 w-96 bg-card rounded-xl shadow-2xl shadow-black/40 border border-border overflow-hidden z-50"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h3 className="font-semibold text-foreground">{t('header.notifications')}</h3>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="text-xs text-primary hover:text-primary/80 font-medium cursor-pointer"
                        >
                          {t('header.markAllRead')}
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
                          <p className="text-sm">{t('header.noNotifications')}</p>
                        </div>
                      ) : (
                        notifications.map(notif => {
                          const typeInfo = notifIcons[notif.type] ?? { Icon: Bell, tone: 'text-muted-foreground' };
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
                                  aria-label={t('header.unread')}
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
                          {t('header.notificationSettings')}
                          <ChevronRight className="w-3 h-3" aria-hidden="true" />
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Account menu */}
              <div className="relative" ref={userRef}>
                <button
                  type="button"
                  onClick={() => setShowUserMenu((v) => !v)}
                  aria-label={t('header.accountMenu')}
                  aria-expanded={showUserMenu}
                  className="inline-flex items-center gap-2 rounded-lg p-1 sm:pr-2 hover:bg-secondary/60 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <span className="w-9 h-9 rounded-full bg-primary/15 text-primary border border-primary/30 flex items-center justify-center font-medium flex-shrink-0">
                    {user.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                  <span className="hidden sm:block max-w-[160px] text-left leading-tight">
                    <span className="block text-sm font-medium text-foreground truncate">{user.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
                  </span>
                  <ChevronDown className="hidden sm:block w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                </button>

                {showUserMenu && (
                  <div
                    role="menu"
                    aria-label={t('header.accountMenu')}
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
                      {t('nav.settings')}
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors cursor-pointer focus:outline-none focus:bg-destructive/10 border-t border-border/60"
                    >
                      <LogOut className="w-4 h-4" aria-hidden="true" />
                      {t('header.signOut')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}