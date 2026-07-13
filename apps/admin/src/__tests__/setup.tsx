import '@testing-library/jest-dom/vitest';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, priority, ...rest } = props;
    void fill;
    void priority;
    return React.createElement('img', rest);
  },
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => React.createElement('div', { 'data-testid': 'dynamic-chart' }),
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    getProfiles: vi.fn().mockResolvedValue({ data: [] }),
    getDashboardStats: vi.fn().mockResolvedValue({ data: null }),
    getContacts: vi.fn().mockResolvedValue({ data: { contacts: [], total: 0 } }),
    getNotifications: vi.fn().mockResolvedValue({ data: [] }),
    getUnreadCount: vi.fn().mockResolvedValue({ data: { count: 0 } }),
    getChatUnreadCount: vi.fn().mockResolvedValue({ data: { count: 0 } }),
  },
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    'user',
    JSON.stringify({ id: '1', name: 'Test User', email: 'test@example.com', organizationId: 'org-1' }),
  );
  localStorage.setItem('accessToken', 'test-token');
  document.documentElement.dir = 'ltr';
  document.documentElement.lang = 'en';
});
