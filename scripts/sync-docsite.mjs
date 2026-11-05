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
 * current page's directory), and GitHub alerts (`> [!WARNING]`) turned into
 * Docusaurus admonitions (`:::warning`), which is the syntax it renders.
 *
 * Usage:
 *   node scripts/sync-docsite.mjs            # rewrite docs-site/docs from docs/
 *   node scripts/sync-docsite.mjs --check    # fail if any page is out of sync
 *
 * Docs-site pages that have NO source in docs/ (e.g. operations/demo-mode.md)
 * are left untouched. The mapping below must be kept in sync with the docs-site
 * sidebar (docs-site/sidebars.ts).
 *
 * Images a page shows from docs/screenshots/ are copied to
 * docs-site/static/img/screenshots/, and --check compares those copies too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(ROOT, 'docs');
const DST_ROOT = path.join(ROOT, 'docs-site', 'docs');
const CHECK = process.argv.includes('--check');
// ![…](./screenshots/<file>): Docusaurus serves docs-site/static/ at the site root and resolves an absolute image path
// there, under the site's baseUrl.
const IMAGE = /\]\(\.\/screenshots\/([A-Za-z0-9/_.-]+\.(?:png|jpe?g|gif|webp))\)/g;
const IMAGE_SRC = path.join(SRC_ROOT, 'screenshots');
const IMAGE_DST = path.join(ROOT, 'docs-site', 'static', 'img', 'screenshots');
/** The images the pages show, as paths under docs/screenshots/. */
const images = new Set();

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
  { src: '23-calls.md', dst: 'features/calls.md', title: 'Calls', pos: 4 },
  { src: '24-customers.md', dst: 'features/customers.md', title: 'Customers', pos: 5 },
  { src: '13-sdk-python.md', dst: 'sdks/python-sdk.md', title: 'Python SDK', pos: 1 },
  { src: '14-sdk-php.md', dst: 'sdks/php-sdk.md', title: 'PHP SDK', pos: 2 },
  { src: '15-n8n-integration.md', dst: 'sdks/n8n-integration.md', title: 'n8n Integration', pos: 3 },
  { src: '16-deployment-docker.md', dst: 'operations/deployment-docker.md', title: 'Docker Deployment', pos: 1 },
  { src: '17-development.md', dst: 'operations/development.md', title: 'Development', pos: 2 },
  { src: '18-configuration-reference.md', dst: 'operations/configuration-reference.md', title: 'Configuration Reference', pos: 3 },
  { src: '19-database-backup.md', dst: 'operations/database-backup.md', title: 'Database Backup', pos: 4 },
  { src: '20-examples.md', dst: 'guides/examples.md', title: 'Examples & Recipes', pos: 1 },
  { src: '21-releasing-and-distribution.md', dst: 'operations/releasing-and-distribution.md', title: 'Releasing & Distribution', pos: 6 },
  { src: '22-air-gapped-deploy.md', dst: 'operations/air-gapped-deploy.md', title: 'Air-gapped Deploy', pos: 7 },
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

  // ./screenshots/<file> → the copy the site serves (copied below)
  body = body.replace(IMAGE, (m, file) => {
    images.add(file);
    return `](/img/screenshots/${file})`;
  });

  return body;
}

/**
 * `> [!WARNING]` plus the `>` lines after it → `:::warning`. GitHub draws the first; Docusaurus has no such syntax and
 * would print the literal `[!WARNING]` inside a plain blockquote.
 */
const ALERTS = { NOTE: 'note', TIP: 'tip', IMPORTANT: 'info', WARNING: 'warning', CAUTION: 'danger' };
function rewriteAlerts(body) {
  return body.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:>.*\n?)+)/gm, (m, kind, text) =>
    `:::${ALERTS[kind]}\n\n${text.replace(/^> ?/gm, '').trimEnd()}\n\n:::\n`);
}

function render(p) {
  const src = path.join(SRC_ROOT, p.src);
  if (!fs.existsSync(src)) {
    console.error(`✗ source missing: docs/${p.src}`);
    return null;
  }
  const body = fs.readFileSync(src, 'utf8');
  return frontmatter(p) + rewriteAlerts(rewriteLinks(body, p.dst));
}

let failures = 0;
let imageFailures = 0;
let synced = 0;

for (const p of PAGES) {
  const generated = render(p);
  if (generated === null) {
    failures++;
    continue;
  }
  const dstFile = path.join(DST_ROOT, p.dst);
  let current = null;
  try {
    current = fs.readFileSync(dstFile, 'utf8');
  } catch {
    // First sync (or missing target) — the generated page is written below.
  }

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

for (const file of images) {
  const src = path.join(IMAGE_SRC, file);
  const dst = path.join(IMAGE_DST, file);
  if (!fs.existsSync(src)) {
    console.error(`✗ image missing: docs/screenshots/${file}`);
    imageFailures++;
    continue;
  }
  if (fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src))) continue;
  if (CHECK) {
    console.error(`✗ out of sync: docs-site/static/img/screenshots/${file} — run \`pnpm sync:docsite\``);
    imageFailures++;
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`✓ copied docs/screenshots/${file} → docs-site/static/img/screenshots/${file}`);
  }
}

// A page or an image the docs-site needs and cannot get: both modes fail, so a deploy never ships it broken.
const problems = [failures && `${failures} page(s)`, imageFailures && `${imageFailures} image(s)`].filter(Boolean).join(' and ');
if (CHECK) {
  if (problems) {
    console.error(`Docs-site sync check FAILED (${problems} drifted or missing).`);
    process.exit(1);
  }
  console.log('Docs-site sync check PASSED — all pages match docs/.');
} else {
  console.log(`Docs-site sync complete (${synced} page(s) updated, ${PAGES.length - synced - failures} already in sync).`);
  if (problems) {
    console.error(`Docs-site sync FAILED (${problems} missing in docs/).`);
    process.exit(1);
  }
}
