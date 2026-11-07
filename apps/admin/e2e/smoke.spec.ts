import { test, expect, PROFILE } from './support/fixtures';

test('a dashboard page runs against the fake backend: REST in the browser, realtime on the fake socket', async ({ page, backend }) => {
  await page.goto('/dashboard/calls');
  await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible(); // not the empty state's "No calls here"
  await expect.poll(() => backend.joined).toContain(PROFILE.id); // the page's own socket joined the profile's room
  await expect.poll(() => backend.requests.some((r) => r.path === '/calls' && r.headers.authorization === 'Bearer test-token')).toBe(true);
});

test('pages let this origin use the microphone and the camera, never a frame of another origin', async ({ page }) => {
  const res = await page.goto('/auth/login');
  expect(res?.headers()['permissions-policy']).toContain('microphone=(self)');
  expect(res?.headers()['permissions-policy']).toContain('camera=(self)');
});
