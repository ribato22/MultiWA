// e2e global setup — create the schema in the test database before the suite runs.
// DATABASE_URL is provided by CI (the postgres service). Uses `prisma db push` (the
// repo has no migrations dir), matching how the api container bootstraps its DB.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default async function setup() {
  const schema = path.resolve(__dirname, '../../../packages/database/prisma/schema.prisma');
  const masked = process.env.DATABASE_URL?.replace(/:[^:@/]*@/, ':***@');
  console.log(`[e2e] prisma db push against ${masked}`);
  // execFileSync (no shell) — args passed as an array, no interpolation into a shell string.
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--schema', schema, '--skip-generate', '--accept-data-loss'],
    { stdio: 'inherit', env: { ...process.env } },
  );
}
