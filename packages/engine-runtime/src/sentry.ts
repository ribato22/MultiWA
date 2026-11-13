// Sentry for the api and the worker: on only when SENTRY_DSN is set, errors only (no tracing), and nothing
// personal leaves the process. A WhatsApp gateway's errors carry phone numbers, chat ids and message text, so
// every event is scrubbed here before it is sent:
//   - a request keeps its method and its path (no query string, headers, cookies or body), and no user is set;
//   - phone numbers, chat ids and emails are replaced in every message and breadcrumb;
//   - a Prisma error keeps its first line and its reason: the lines between print the query, with its data;
//   - console breadcrumbs (log lines) are dropped, other breadcrumbs keep their url path, method and status;
//   - the browser errors installBrowserRejectionGuard ignores on purpose are not reported either.
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { isBrowserLifecycleError } from './engine-lifecycle';

export type SentryService = 'api' | 'worker';

const CHAT_ID = /(?<![\w.+-])[\d+-]{5,}(?::\d+)?@(?:c\.us|s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)\b/gi;
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Eight or more characters of digits and separators, not inside a word or an id (a UUID's digit runs stay).
const NUMBER = /(?<![\w-])\+?\d[\d ().-]{6,}\d(?![\w-])/g;
const PRISMA_INVOCATION = /Invalid `[^`]+` invocation/;
const MAX_TEXT = 1000;

/** A text that may go to Sentry, without the phone numbers, chat ids and emails in it. */
export function redactText(text: string): string {
  return text.replace(CHAT_ID, '<chat-id>').replace(EMAIL, '<email>').replace(NUMBER, '<number>').slice(0, MAX_TEXT);
}

// A Prisma error's message is its first line, a code frame that prints the query's arguments (message text,
// numbers), and its reason on the last line: only the first and the last are kept.
function cleanText(text: string): string {
  const head = text.match(PRISMA_INVOCATION);
  if (head) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const reason = lines[lines.length - 1];
    text = reason && !PRISMA_INVOCATION.test(reason) ? `${head[0]}: ${reason}` : head[0];
  }
  return redactText(text);
}

const pathOf = (url: string) => redactText(url.split(/[?#]/)[0]);

interface Breadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface ScrubbedEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  request?: { method?: string; url?: string };
  user?: unknown;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Breadcrumb[];
}

/** Sentry's beforeBreadcrumb: no console breadcrumbs, and nothing personal in the others. */
export function scrubSentryBreadcrumb<T extends object>(breadcrumb: T): T | null {
  const b = breadcrumb as Breadcrumb;
  if (b.category === 'console') return null;
  if (typeof b.message === 'string') b.message = cleanText(b.message);
  if (b.data) {
    const { url, method, status_code } = b.data;
    b.data = {
      ...(typeof url === 'string' ? { url: pathOf(url) } : {}),
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof status_code === 'number' ? { status_code } : {}),
    };
  }
  return breadcrumb;
}

/** Sentry's beforeSend: drops a browser lifecycle error, scrubs everything else (see the top of this file). */
export function scrubSentryEvent<T extends object>(event: T): T | null {
  const e = event as ScrubbedEvent;
  const values = e.exception?.values ?? [];
  if (values.some((v) => isBrowserLifecycleError(v.value ?? ''))) return null;
  for (const v of values) if (typeof v.value === 'string') v.value = cleanText(v.value);
  if (typeof e.message === 'string') e.message = cleanText(e.message);
  if (e.logentry) {
    if (typeof e.logentry.message === 'string') e.logentry.message = cleanText(e.logentry.message);
    delete e.logentry.params;
  }
  if (e.request) e.request = { method: e.request.method, url: e.request.url ? pathOf(e.request.url) : undefined };
  delete e.user;
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map((b) => scrubSentryBreadcrumb(b)).filter((b): b is Breadcrumb => b !== null);
  return event;
}

/** The version in the nearest package.json at or above `dir` (an app's own), if any. */
export function packageVersion(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    const file = join(d, 'package.json');
    if (existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version;
    if (dirname(d) === d) return undefined;
  }
}

/**
 * Sentry.init's options for the api or the worker, or undefined when SENTRY_DSN is not set (Sentry stays off).
 * `dir` is the calling app's directory, for its version (the release `multiwa@<version>`).
 */
export function sentryOptions(service: SentryService, dir: string, env: NodeJS.ProcessEnv = process.env) {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return undefined;
  const version = packageVersion(dir);
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'production',
    ...(version ? { release: `multiwa@${version}` } : {}),
    sendDefaultPii: false,
    initialScope: { tags: { service } },
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: scrubSentryBreadcrumb,
  };
}
