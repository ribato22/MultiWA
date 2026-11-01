import { test, expect, PROFILE } from './support/fixtures';

test('a dashboard page runs against the fake backend: REST in the browser, realtime on the fake socket', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible();
  await expect.poll(() => backend.joined).toContain(PROFILE.id); // the page's own socket joined the profile's room
  expect(backend.requests.some((r) => r.path === '/calls' && r.headers.authorization === 'Bearer test-token')).toBe(true);
});

test('pages let this origin use the microphone', async ({ page }) => {
  const res = await page.goto('/auth/login');
  expect(res?.headers()['permissions-policy']).toContain('microphone=(self)');
});
