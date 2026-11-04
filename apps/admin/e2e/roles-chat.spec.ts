// The chat by role: a viewer reads, a member works the chat, clearing it is an owner's or admin's.
import { test, expect, get, requestEnded, ME, PROFILE, type FakeBackend } from './support/fixtures';
import type { Page } from '@playwright/test';

/** A chat with unread messages, and a message sent from the dashboard (it has a delete-for-everyone). */
const CONV = { id: 'conv-1', profileId: PROFILE.id, jid: '628111000111@s.whatsapp.net', contactId: 'ct-1', name: 'Pak Joko', type: 'user', unreadCount: 2 };
const SENT = { id: 'm-1', messageId: 'wa-1', conversationId: 'conv-1', content: { text: 'Hello' }, type: 'text', direction: 'outgoing', status: 'sent', timestamp: '2026-11-01T03:00:00.000Z' };

async function openChat(page: Page, backend: FakeBackend) {
  backend.route(get('/conversations', { conversations: [CONV], total: 1 }));
  backend.route(get('/messages/conversation/conv-1', { messages: [SENT], hasMore: false }));
  const loaded = requestEnded(page, '/messages/conversation/conv-1');
  await page.goto('/dashboard/chat?profile=p-1&conv=conv-1');
  await loaded;
  await expect(page.getByText('Hello', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
}
const markedRead = (backend: FakeBackend) => backend.requests.some((r) => r.method === 'PUT' && r.path === '/conversations/conv-1/read');
const menuItem = (page: Page, name: string) => page.getByRole('button', { name });

test('an admin can clear a chat', async ({ page, backend }) => {
  await openChat(page, backend);
  await expect(menuItem(page, 'Clear Chat')).toBeVisible();
});

test.describe('a viewer', () => {
  test.use({ user: { ...ME, role: 'viewer' } });

  test('reads the chat with no composer, no delete, no chat actions, and leaves it unread for the team', async ({ page, backend }) => {
    await openChat(page, backend);
    await expect(page.getByText('Your role can read this chat but not send messages.')).toBeVisible();
    await expect(page.getByPlaceholder('Type a message')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete message' })).toHaveCount(0);
    await expect(menuItem(page, 'Contact Info')).toBeVisible();
    for (const name of ['Mute Notifications', 'Pin Chat', 'Clear Chat']) await expect(menuItem(page, name)).toHaveCount(0);
    await page.waitForTimeout(500); // a mark-read would be out by now
    expect(markedRead(backend)).toBe(false);
  });

  test('leaves a message that comes into the open chat unread too', async ({ page, backend }) => {
    await openChat(page, backend);
    await expect.poll(() => backend.joined).toContain(PROFILE.id);
    const reloaded = requestEnded(page, '/conversations?'); // the list, read again for the message
    const incoming = { ...SENT, id: 'm-2', messageId: 'wa-2', profileId: PROFILE.id, content: { text: 'Are you there?' }, direction: 'incoming' };
    backend.emitToProfile(PROFILE.id, 'message', { type: 'message:received', message: incoming, conversation: CONV });
    await expect(page.getByText('Are you there?', { exact: true })).toBeVisible();
    await reloaded;
    await page.waitForTimeout(500); // a mark-read would be out by now
    expect(markedRead(backend)).toBe(false);
  });
});

test.describe('a member', () => {
  test.use({ user: { ...ME, role: 'member' } });

  test('sends, deletes for everyone, mutes and pins, but cannot clear the chat; opening it marks it read', async ({ page, backend }) => {
    await openChat(page, backend);
    await expect(page.getByPlaceholder('Type a message')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete message' })).toHaveCount(1);
    for (const name of ['Mute Notifications', 'Pin Chat']) await expect(menuItem(page, name)).toBeVisible();
    await expect(menuItem(page, 'Clear Chat')).toHaveCount(0);
    await expect.poll(() => markedRead(backend)).toBe(true);
  });
});
