// processTreeRssAnonMb: the anonymous resident memory of a process tree, read from a fake /proc.
import { describe, it, expect } from 'vitest';
import { processTreeRssAnonMb } from '@multiwa/engines';

const fakeProc = (files: Record<string, string>) => ({
  readdir: (path: string) => {
    if (path !== '/proc') throw new Error('ENOTDIR');
    return [...new Set(Object.keys(files).map((f) => f.split('/')[2]))].concat(['self', 'sys']);
  },
  readFile: (path: string) => {
    if (!(path in files)) throw new Error('ENOENT');
    return files[path];
  },
});
const stat = (pid: number, comm: string, ppid: number) => `${pid} (${comm}) S ${ppid} ${pid} ${pid} 0 -1 4194560`;
const status = (kb: number | null) =>
  `Name:\tx\nVmRSS:\t${(kb ?? 0) + 4096} kB\n${kb === null ? '' : `RssAnon:\t${kb} kB\n`}RssFile:\t4096 kB\n`;

describe('processTreeRssAnonMb', () => {
  it('sums RssAnon of the root and every descendant, nothing outside the tree', () => {
    const proc = fakeProc({
      '/proc/10/stat': stat(10, 'chromium', 1),
      '/proc/10/status': status(102_400),
      '/proc/11/stat': stat(11, 'chromium --type=renderer', 10),
      '/proc/11/status': status(2_048_000),
      '/proc/12/stat': stat(12, 'weird) name (x', 11),
      '/proc/12/status': status(512),
      '/proc/20/stat': stat(20, 'postgres', 1),
      '/proc/20/status': status(999_999),
    });
    expect(processTreeRssAnonMb(10, proc)).toBe(Math.round((102_400 + 2_048_000 + 512) / 1024));
  });

  it('skips a process that exited between the listing and the read', () => {
    const proc = fakeProc({
      '/proc/10/stat': stat(10, 'chromium', 1),
      '/proc/10/status': status(1024),
      '/proc/11/stat': stat(11, 'chromium', 10), // its status is already gone
    });
    expect(processTreeRssAnonMb(10, proc)).toBe(1);
  });

  it('answers null when it cannot measure anything', () => {
    expect(processTreeRssAnonMb(10, fakeProc({}))).toBeNull(); // the process is gone
    expect(
      processTreeRssAnonMb(10, fakeProc({ '/proc/10/stat': stat(10, 'chromium', 1), '/proc/10/status': status(null) })),
    ).toBeNull(); // no RssAnon line
    expect(
      processTreeRssAnonMb(10, {
        readdir: () => {
          throw new Error('ENOENT');
        },
        readFile: () => '',
      }),
    ).toBeNull(); // no /proc
    expect(processTreeRssAnonMb(0, fakeProc({}))).toBeNull();
  });
});
