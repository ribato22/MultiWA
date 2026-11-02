// MultiWA Gateway - Resident memory of a process tree (Linux /proc)
// packages/engines/src/adapters/process-memory.ts

import { readdirSync, readFileSync } from 'fs';

/** The two reads processTreeRssAnonMb needs, so a test can hand it a fake /proc. */
export interface ProcReader {
  readdir(path: string): string[];
  readFile(path: string): string;
}

const realProc: ProcReader = {
  readdir: (path) => readdirSync(path),
  readFile: (path) => readFileSync(path, 'utf8'),
};

/**
 * Anonymous resident memory, in MB, of process `rootPid` and all its descendants, or null when /proc cannot
 * tell (not Linux, or the process is gone). RssAnon rather than VmRSS: Chromium's processes share their library
 * pages, and anon-rss is what the kernel's OOM killer reported at 4.9 GB on 2026-10-31.
 */
export function processTreeRssAnonMb(rootPid: number, proc: ProcReader = realProc): number | null {
  if (!Number.isInteger(rootPid) || rootPid <= 0) return null;
  let names: string[];
  try {
    names = proc.readdir('/proc');
  } catch {
    return null;
  }
  const children = new Map<number, number[]>();
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    let stat: string;
    try {
      stat = proc.readFile(`/proc/${name}/stat`);
    } catch {
      continue; // exited between the listing and the read
    }
    // "pid (comm) state ppid ...": comm may hold spaces and ')', so the fields start after the LAST ')'.
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    if (!Number.isInteger(ppid)) continue;
    const siblings = children.get(ppid) ?? [];
    siblings.push(Number(name));
    children.set(ppid, siblings);
  }
  let kb = 0;
  let measured = false;
  const pending = [rootPid];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const pid = pending.pop() as number;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const anon = proc.readFile(`/proc/${pid}/status`).match(/^RssAnon:\s+(\d+) kB/m);
      if (anon) {
        kb += Number(anon[1]);
        measured = true;
      }
    } catch {
      // exited meanwhile: it holds no memory any more
    }
    pending.push(...(children.get(pid) ?? []));
  }
  return measured ? Math.round(kb / 1024) : null;
}
