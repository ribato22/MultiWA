// Registration closes after the server's first user, unless the server allows more: the pages offer it only while open.
import { test, expect, get, rendered, requestEnded } from './support/fixtures';
import { expectAccessible } from './support/axe';

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
