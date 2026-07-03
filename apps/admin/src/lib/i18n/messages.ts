// MultiWA Admin — client i18n message catalogs (en / fa / id)

export type Language = 'en' | 'fa' | 'id';
export type TextDirection = 'ltr' | 'rtl';

export const LANGUAGE_STORAGE_KEY = 'multiwa-admin-language';

export const LANGUAGE_OPTIONS: { value: Language; label: string; nativeLabel: string }[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'fa', label: 'Persian', nativeLabel: 'فارسی' },
  { value: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
];


const en = {
  'app.name': 'MultiWA',
  'nav.overview': 'Overview',
  'nav.profiles': 'Profiles',
  'nav.chat': 'Chat',
  'nav.messages': 'Messages',
  'nav.contacts': 'Contacts',
  'nav.templates': 'Templates',
  'nav.broadcast': 'Broadcast',
  'nav.automation': 'Automation',
  'nav.analytics': 'Analytics',
  'nav.webhooks': 'Webhooks',
  'nav.integrations': 'Integrations',
  'nav.knowledge': 'Knowledge',
  'nav.apiKeys': 'API Keys',
  'nav.audit': 'Audit',
  'nav.settings': 'Settings',
  'header.notifications': 'Notifications',
  'header.notificationsUnread': 'Notifications ({count} unread)',
  'header.markAllRead': 'Mark all as read',
  'header.noNotifications': 'No notifications yet',
  'header.notificationSettings': 'Notification Settings',
  'header.unread': 'Unread',
  'header.accountMenu': 'Account menu',
  'header.signOut': 'Sign out',
  'header.openMenu': 'Open menu',
  'header.closeMenu': 'Close menu',
  'header.language': 'Language',
  'header.closeMenuOverlay': 'Close menu',
  'nav.primary': 'Primary navigation',
  'nav.sections': 'Dashboard sections',
  'chat.unread': '{count} unread',
} as const;

export type MessageKey = keyof typeof en;


const fa: Record<MessageKey, string> = {
  'app.name': 'مولتی‌وا',
  'nav.overview': 'نمای کلی',
  'nav.profiles': 'پروفایل‌ها',
  'nav.chat': 'گفتگو',
  'nav.messages': 'پیام‌ها',
  'nav.contacts': 'مخاطبین',
  'nav.templates': 'قالب‌ها',
  'nav.broadcast': 'پخش',
  'nav.automation': 'اتوماسیون',
  'nav.analytics': 'تحلیل‌ها',
  'nav.webhooks': 'وب‌هوک‌ها',
  'nav.integrations': 'یکپارچه‌سازی',
  'nav.knowledge': 'دانش',
  'nav.apiKeys': 'کلیدهای API',
  'nav.audit': 'ممیزی',
  'nav.settings': 'تنظیمات',
  'header.notifications': 'اعلان‌ها',
  'header.notificationsUnread': 'اعلان‌ها ({count} خوانده‌نشده)',
  'header.markAllRead': 'علامت‌گذاری همه به‌عنوان خوانده‌شده',
  'header.noNotifications': 'هنوز اعلانی نیست',
  'header.notificationSettings': 'تنظیمات اعلان',
  'header.unread': 'خوانده‌نشده',
  'header.accountMenu': 'منوی حساب',
  'header.signOut': 'خروج',
  'header.openMenu': 'باز کردن منو',
  'header.closeMenu': 'بستن منو',
  'header.language': 'زبان',
  'header.closeMenuOverlay': 'بستن منو',
  'nav.primary': 'ناوبری اصلی',
  'nav.sections': 'بخش‌های داشبورد',
  'chat.unread': '{count} خوانده‌نشده',
};

const id: Record<MessageKey, string> = {
  'app.name': 'MultiWA',
  'nav.overview': 'Ringkasan',
  'nav.profiles': 'Profil',
  'nav.chat': 'Obrolan',
  'nav.messages': 'Pesan',
  'nav.contacts': 'Kontak',
  'nav.templates': 'Template',
  'nav.broadcast': 'Siaran',
  'nav.automation': 'Otomatisasi',
  'nav.analytics': 'Analitik',
  'nav.webhooks': 'Webhook',
  'nav.integrations': 'Integrasi',
  'nav.knowledge': 'Pengetahuan',
  'nav.apiKeys': 'Kunci API',
  'nav.audit': 'Audit',
  'nav.settings': 'Pengaturan',
  'header.notifications': 'Notifikasi',
  'header.notificationsUnread': 'Notifikasi ({count} belum dibaca)',
  'header.markAllRead': 'Tandai semua sudah dibaca',
  'header.noNotifications': 'Belum ada notifikasi',
  'header.notificationSettings': 'Pengaturan Notifikasi',
  'header.unread': 'Belum dibaca',
  'header.accountMenu': 'Menu akun',
  'header.signOut': 'Keluar',
  'header.openMenu': 'Buka menu',
  'header.closeMenu': 'Tutup menu',
  'header.language': 'Bahasa',
  'header.closeMenuOverlay': 'Tutup menu',
  'nav.primary': 'Navigasi utama',
  'nav.sections': 'Bagian dasbor',
  'chat.unread': '{count} belum dibaca',
};

export const messages = { en, fa, id } as const;

export function isLanguage(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'fa' || value === 'id';
}

export function languageToDir(language: Language): TextDirection {
  return language === 'fa' ? 'rtl' : 'ltr';
}

export function languageToHtmlLang(language: Language): string {
  if (language === 'fa') return 'fa';
  if (language === 'id') return 'id';
  return 'en';
}

export function readStoredLanguage(): Language {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function formatMessage(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function translate(
  language: Language,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const catalog = messages[language] ?? messages.en;
  const template = (catalog[key] ?? messages.en[key] ?? key) as string;
  return formatMessage(template, params);
}