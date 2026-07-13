import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { config } from 'dotenv';

function findMonorepoRoot(startDir: string): string | null {
  let dir = resolve(startDir);

  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return null;
}

export function loadMonorepoEnv(): void {
  const envPaths = new Set<string>();

  for (const root of [findMonorepoRoot(process.cwd()), findMonorepoRoot(__dirname)]) {
    if (root) {
      envPaths.add(join(root, '.env'));
    }
  }

  envPaths.add(resolve(process.cwd(), '.env'));
  envPaths.add(resolve(__dirname, '../.env'));

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      config({ path: envPath, override: false });
    }
  }
}
