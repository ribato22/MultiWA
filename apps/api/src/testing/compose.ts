// The repo's compose files, for the guard specs that check what each service is given. Every service lists its
// environment explicitly, so a variable missing from a service never reaches its container.
import { readFileSync } from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/** The text of a compose file at the repo root. */
export const readCompose = (file: string): string => readFileSync(path.join(REPO_ROOT, file), 'utf8');

/** The `name:` service block of a compose file (two-space service indent), or null when the file has no such service. */
export function composeService(file: string, name: string): string | null {
  const text = readCompose(file);
  const start = text.search(new RegExp(`^ {2}${name}:\\s*$`, 'm'));
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next);
}
