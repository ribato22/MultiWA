// packages/engine-runtime/src/lock-files.ts
//
// whatsapp-web.js drives a Chromium user-data-dir under the session folder.
// A hard crash/kill leaves Chromium "Singleton" lock files behind that block
// the next launch. Before (re)connecting, sweep them out.
//
// Shared between apps/api and apps/worker so both engine-managers clean the
// same lock set identically; see architecture/engine-worker-migration-sop.md.

import * as path from 'path';

const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

type FsLike = Pick<typeof import('fs/promises'), 'access' | 'readdir' | 'unlink'>;

export interface CleanupStaleLockFilesDeps {
  /** Sink for removed-lock messages (pass a logger.log). */
  log?: (message: string) => void;
  /** Sink for warnings (pass a logger.warn). */
  warn?: (message: string) => void;
  /** Override the fs/promises implementation (tests inject a fake). */
  fs?: FsLike;
}

/**
 * Recursively remove stale Chromium Singleton lock files under `sessionDir`.
 * No-op if the directory does not exist. Never throws — individual failures
 * are warned and skipped.
 */
export async function cleanupStaleLockFiles(
  sessionDir: string,
  deps: CleanupStaleLockFilesDeps = {},
): Promise<void> {
  const log = deps.log ?? (() => {});
  const warn = deps.warn ?? (() => {});
  const fs = deps.fs ?? (await import('fs/promises'));

  try {
    await fs.access(sessionDir);
  } catch {
    return; // Session dir doesn't exist yet, nothing to clean
  }

  try {
    const entries = await fs.readdir(sessionDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (LOCK_FILES.includes(entry.name)) {
        const lockPath = path.join((entry as any).parentPath || (entry as any).path, entry.name);
        try {
          await fs.unlink(lockPath);
          log(`Removed stale Chromium lock file: ${lockPath}`);
        } catch (e) {
          warn(`Could not remove lock file ${lockPath}: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    warn(`Error scanning for lock files: ${(e as Error).message}`);
  }
}
