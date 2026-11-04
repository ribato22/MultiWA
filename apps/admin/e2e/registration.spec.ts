// Registration closes after the server's first user, unless the server allows more: the pages offer it only while open.
import { test, expect, gate, get, on, rendered, requestEnded, type FakeBackend } from './support/fixtures';
import { expectAccessible } from './support/axe';

/** `/auth/registration` held until the test opens the gate, then answering `open`. */
function held(backend: FakeBackend, open: boolean) {
  const slow = gate();
  backend.route(on('GET', '/auth/registration', async () => {
    await slow.passed;
    return { json: { open } };
  }));
  return slow;
}
const untilAsked = (backend: FakeBackend) => expect.poll(() => backend.requests.some((r) => r.path === '/auth/registration')).toBe(true);

test('the landing page offers Get Started and Start Free Trial while registration is open', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: true }));
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/auth/register');
  await expect(page.getByRole('link', { name: 'Start Free Trial' })).toHaveAttribute('href', '/auth/register');
});

test('the landing page offers Sign in instead once registration is closed', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: false }));
  const asked = requestEnded(page, '/auth/registration');
  await page.goto('/');
  const signIn = page.getByRole('link', { name: 'Sign in' });
  await expect(signIn).toHaveCount(2); // in place of each of them, while it asks too
  await asked;
  await rendered(page);
  for (const link of await signIn.all()) await expect(link).toHaveAttribute('href', '/auth/login');
  await expect(page.locator('a[href="/auth/register"]')).toHaveCount(0);
});

test('the login page offers "Create one" while registration is open', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: true }));
  await page.goto('/auth/login');
  await expect(page.getByRole('link', { name: 'Create one' })).toHaveAttribute('href', '/auth/register');
});

test('the login page leaves "Create one" out once registration is closed', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: false }));
  const asked = requestEnded(page, '/auth/registration');
  await page.goto('/auth/login');
  await asked;
  await rendered(page);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText("Don't have an account?")).toHaveCount(0);
});

test('the register page says registration is closed, with no form to fill in', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: false }));
  await page.goto('/auth/register');
  const closed = page.getByRole('status');
  await expect(closed.getByRole('heading', { name: 'Registration is closed' })).toBeVisible();
  await expect(closed).toContainText('Ask an admin to add you.');
  await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expectAccessible(page, '[role="status"]');
});

test('the register page keeps its form while registration is open', async ({ page, backend }) => {
  backend.route(get('/auth/registration', { open: true }));
  const asked = requestEnded(page, '/auth/registration');
  await page.goto('/auth/register');
  await asked;
  await rendered(page);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('the register page shows neither its form nor the closed message while it asks', async ({ page, backend }) => {
  const slow = held(backend, false);
  await page.goto('/auth/register');
  await untilAsked(backend);
  await rendered(page);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Registration is closed' })).toHaveCount(0);
  slow.open();
  await expect(page.getByRole('heading', { name: 'Registration is closed' })).toBeVisible();
});

test('the register page keeps its form when the check fails', async ({ page, backend }) => {
  backend.route(on('GET', '/auth/registration', { status: 500, json: { message: 'Internal server error' } }));
  const answered = requestEnded(page, '/auth/registration');
  await page.goto('/auth/register');
  await answered;
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
});
