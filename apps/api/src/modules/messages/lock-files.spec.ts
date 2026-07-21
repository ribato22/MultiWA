import { describe, it, expect, vi } from 'vitest';
import { cleanupStaleLockFiles } from '@multiwa/engine-runtime';

// A minimal fs/promises stub. readdir returns Dirent-like entries with `name`
// and `parentPath` so the helper can rebuild each lock path.
function fakeFs(opts: {
  accessThrows?: boolean;
  entries?: { name: string; parentPath: string }[];
  readdirThrows?: boolean;
  unlinkThrowsFor?: string[];
}) {
  const unlinked: string[] = [];
  const fs = {
    access: vi.fn(async () => {
      if (opts.accessThrows) throw new Error('ENOENT');
    }),
    readdir: vi.fn(async () => {
      if (opts.readdirThrows) throw new Error('EACCES');
      return (opts.entries ?? []) as any;
    }),
    unlink: vi.fn(async (p: string) => {
      if (opts.unlinkThrowsFor?.some((s) => p.includes(s))) throw new Error('EBUSY');
      unlinked.push(p);
    }),
  };
  return { fs, unlinked };
}

describe('cleanupStaleLockFiles', () => {
  it('no-ops silently when the session dir does not exist', async () => {
    const { fs, unlinked } = fakeFs({ accessThrows: true });
    const warn = vi.fn();
    await cleanupStaleLockFiles('/data/sessions/x', { fs: fs as any, warn });
    expect(fs.readdir).not.toHaveBeenCalled();
    expect(unlinked).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('removes exactly the three Chromium Singleton lock files, ignoring other files', async () => {
    const { fs, unlinked } = fakeFs({
      entries: [
        { name: 'SingletonLock', parentPath: '/s/p' },
        { name: 'SingletonSocket', parentPath: '/s/p' },
        { name: 'SingletonCookie', parentPath: '/s/p' },
        { name: 'Default', parentPath: '/s' },
        { name: 'session.json', parentPath: '/s/p' },
      ],
    });
    const log = vi.fn();
    await cleanupStaleLockFiles('/s', { fs: fs as any, log });
    expect(unlinked.sort()).toEqual(['/s/p/SingletonCookie', '/s/p/SingletonLock', '/s/p/SingletonSocket']);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('warns and continues when a single unlink fails (never throws)', async () => {
    const { fs, unlinked } = fakeFs({
      entries: [
        { name: 'SingletonLock', parentPath: '/s/p' },
        { name: 'SingletonSocket', parentPath: '/s/p' },
      ],
      unlinkThrowsFor: ['SingletonLock'],
    });
    const warn = vi.fn();
    await expect(cleanupStaleLockFiles('/s', { fs: fs as any, warn })).resolves.toBeUndefined();
    expect(unlinked).toEqual(['/s/p/SingletonSocket']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not remove lock file'));
  });

  it('warns (not throws) when the directory scan fails', async () => {
    const { fs } = fakeFs({ readdirThrows: true });
    const warn = vi.fn();
    await expect(cleanupStaleLockFiles('/s', { fs: fs as any, warn })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Error scanning for lock files'));
  });
});
