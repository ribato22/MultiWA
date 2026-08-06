#!/usr/bin/env node
/**
 * Syncs the public docs (docs/) into the Docusaurus site (docs-site/docs/).
 *
 * docs/ is the single source of truth. Each docs-site page is generated as:
 *
 *     <sidebar frontmatter> + docs/<NN-...>.md
 *
 * with the internal `./NN-*.md` cross-links rewritten to paths that resolve
 * within docs-site/docs/ (Docusaurus resolves relative links against the
 * current page's directory).
 *
 * Usage:
 *   node scripts/sync-docsite.mjs            # rewrite docs-site/docs from docs/
 *   node scripts/sync-docsite.mjs --check    # fail if any page is out of sync
 *
 * Docs-site pages that have NO source in docs/ (e.g. operations/demo-mode.md)
 * are left untouched. The mapping below must be kept in sync with the docs-site
 * sidebar (docs-site/sidebars.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(ROOT, 'docs');
const DST_ROOT = path.join(ROOT, 'docs-site', 'docs');
const CHECK = process.argv.includes('--check');

// docs/<src> → docs-site/docs/<dst> + Docusaurus frontmatter
const PAGES = [
  { src: 'README.md', dst: 'intro.md', title: 'Documentation Index', pos: 0 },
  { src: '01-project-overview.md', dst: 'getting-started/project-overview.md', title: 'Project Overview', pos: 1 },
  { src: '02-requirements.md', dst: 'getting-started/requirements.md', title: 'Requirements', pos: 2 },
  { src: '03-quick-start.md', dst: 'getting-started/quick-start.md', title: 'Quick Start', pos: 3 },
  { src: '04-system-architecture.md', dst: 'architecture/system-architecture.md', title: 'System Architecture', pos: 1 },
  { src: '05-database-design.md', dst: 'architecture/database-design.md', title: 'Database Design', pos: 2 },
  { src: '06-engine-abstraction.md', dst: 'architecture/engine-abstraction.md', title: 'Engine Abstraction', pos: 3 },
  { src: '07-api-specification.md', dst: 'api/api-specification.md', title: 'API Specification', pos: 1 },
  { src: '08-websocket-api.md', dst: 'api/websocket-api.md', title: 'WebSocket API', pos: 2 },
  { src: '09-webhook-events.md', dst: 'api/webhook-events.md', title: 'Webhook Events', pos: 3 },
  { src: '10-messaging.md', dst: 'features/messaging.md', title: 'Messaging', pos: 1 },
  { src: '11-groups.md', dst: 'features/groups.md', title: 'Groups', pos: 2 },
  { src: '12-automation.md', dst: 'features/automation.md', title: 'Automation', pos: 3 },
  { src: '13-sdk-python.md', dst: 'sdks/python-sdk.md', title: 'Python SDK', pos: 1 },
  { src: '14-sdk-php.md', dst: 'sdks/php-sdk.md', title: 'PHP SDK', pos: 2 },
  { src: '15-n8n-integration.md', dst: 'sdks/n8n-integration.md', title: 'n8n Integration', pos: 3 },
  { src: '16-deployment-docker.md', dst: 'operations/deployment-docker.md', title: 'Docker Deployment', pos: 1 },
  { src: '17-development.md', dst: 'operations/development.md', title: 'Development', pos: 2 },
  { src: '18-configuration-reference.md', dst: 'operations/configuration-reference.md', title: 'Configuration Reference', pos: 3 },
  { src: '19-database-backup.md', dst: 'operations/database-backup.md', title: 'Database Backup', pos: 4 },
  { src: '20-examples.md', dst: 'guides/examples.md', title: 'Examples & Recipes', pos: 1 },
  { src: '21-releasing-and-distribution.md', dst: 'operations/releasing-and-distribution.md', title: 'Releasing & Distribution', pos: 6 },
];

function frontmatter(p) {
  return `---\nsidebar_position: ${p.pos}\ntitle: "${p.title}"\n---\n\n`;
}

/** Rewrite `./NN-xx.md(#anchor)` and `./README.md` links to docs-site links. */
function rewriteLinks(body, currentDst) {
  const targetFromSrc = (file) => PAGES.find((p) => p.src === file) || null;
  const toRel = (target) => path.posix.relative(path.posix.dirname(currentDst), target.dst);

  // ./NN-xx.md → mapped docs-site page (relative path, Docusaurus-resolvable)
  body = body.replace(/\[([^\]]*)\]\(\.\/([0-9]{2}-[a-z0-9-]+\.md)(#[^)]*)?\)/g, (m, text, file, hash) => {
    const target = targetFromSrc(file);
    if (!target) return m;
    return `[${text}](<${toRel(target)}${hash ?? ''}>)`;
  });

  // ./README.md ("Documentation Index") → the generated index page
  body = body.replace(/\[([^\]]*)\]\(\.\/README\.md\)/g, (m, text) => {
    const target = targetFromSrc('README.md');
    return `[${text}](<${toRel(target)}>)`;
  });

  // Repo-relative links (../SECURITY.md) → point at the GitHub repo
  body = body.replace(/\]\(\.\.\/([A-Za-z0-9.-]+\.md)\)/g, (m, file) => {
    return `](https://github.com/ribato22/MultiWA/blob/main/${file})`;
  });

  return body;
}

function render(p) {
  const src = path.join(SRC_ROOT, p.src);
  if (!fs.existsSync(src)) {
    console.error(`✗ source missing: docs/${p.src}`);
    return null;
  }
  const body = fs.readFileSync(src, 'utf8');
  return frontmatter(p) + rewriteLinks(body, p.dst);
}

let failures = 0;
let synced = 0;

for (const p of PAGES) {
  const generated = render(p);
  if (generated === null) {
    failures++;
    continue;
  }
  const dstFile = path.join(DST_ROOT, p.dst);
  const current = fs.existsSync(dstFile) ? fs.readFileSync(dstFile, 'utf8') : null;

  if (CHECK) {
    if (current !== generated) {
      console.error(`✗ out of sync: docs-site/docs/${p.dst} — run \`pnpm sync:docsite\` ` +
        `(or update docs/${p.src} and re-sync)`);
      failures++;
    }
  } else {
    if (current !== generated) {
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.writeFileSync(dstFile, generated);
      console.log(`✓ synced docs/${p.src} → docs-site/docs/${p.dst}`);
      synced++;
    }
  }
}

if (CHECK) {
  if (failures > 0) {
    console.error(`Docs-site sync check FAILED (${failures} page(s) drifted).`);
    process.exit(1);
  }
  console.log('Docs-site sync check PASSED — all pages match docs/.');
} else {
  console.log(`Docs-site sync complete (${synced} page(s) updated, ${PAGES.length - synced} already in sync).`);
}