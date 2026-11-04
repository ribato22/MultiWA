// Templates and the knowledge base by role: configuration, so an owner or admin writes them and the others read them.
import { test, expect, get, ME } from './support/fixtures';

const TEMPLATE = {
  id: 't-1', profileId: 'p-1', name: 'Welcome', category: 'greeting', messageType: 'text', content: { text: 'Hello {{name}}' },
  variables: ['name'], usageCount: 3, createdAt: '2026-10-01T03:00:00.000Z',
};
const DOC = { id: 'kb-1', name: 'FAQ', type: 'text', size: 2048, chunkCount: 4, createdAt: '2026-10-01T03:00:00.000Z' };

test('an admin writes templates and knowledge documents', async ({ page, backend }) => {
  backend.route(get('/templates', [TEMPLATE]));
  backend.route(get('/ai/knowledge/p-1', [DOC]));
  await page.goto('/dashboard/templates');
  for (const name of ['Create Template', 'Template actions']) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.goto('/dashboard/knowledge');
  for (const name of ['Add Document', 'Delete FAQ']) await expect(page.getByRole('button', { name })).toBeVisible();
});

for (const role of ['member', 'viewer']) {
  test.describe(`a ${role}`, () => {
    test.use({ user: { ...ME, role } });

    test('reads the templates but cannot create, edit, duplicate or delete one', async ({ page, backend }) => {
      backend.route(get('/templates', [TEMPLATE]));
      await page.goto('/dashboard/templates');
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
      for (const name of ['Create Template', 'Template actions']) await expect(page.getByRole('button', { name })).toHaveCount(0);
    });

    test('with no template yet, is not offered to create the first one', async ({ page, backend }) => {
      backend.route(get('/templates', []));
      await page.goto('/dashboard/templates');
      await expect(page.getByRole('heading', { name: 'No Templates Yet' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create Your First Template' })).toHaveCount(0);
    });

    test('searches the knowledge base but cannot add or delete a document', async ({ page, backend }) => {
      backend.route(get('/ai/knowledge/p-1', [DOC]));
      await page.goto('/dashboard/knowledge');
      await expect(page.getByRole('cell', { name: 'FAQ' })).toBeVisible();
      for (const name of ['Add Document', 'Delete FAQ']) await expect(page.getByRole('button', { name })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
    });
  });
}
