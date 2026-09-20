// Stored-media route + upload hardening.
//
// The bug this closes: LocalStorageAdapter.getUrl() returned
// `<base>/uploads/media/<key>` while `key` already began with its folder, so the
// URL came out as `/uploads/media/media/<uuid>` — a path nothing served. And
// MessageMedia.fromUrl() never checks `response.ok`: it fetched this API's own
// 404 JSON body, pinned the mimetype from the `.png` in the URL, and handed
// those bytes to WhatsApp as the image. Every media send through an upload
// failed that way, at a 0% all-time success rate, while the API answered 201.
//
// The second half is the extension. It used to be
// `originalName.split('.').pop()` — taken verbatim from the caller while only
// the MIME was validated — so a genuine PNG uploaded as `payload.html` was
// stored as `<uuid>.html`. Harmless while nothing served those files; an XSS
// vector the moment something did. Serving them and sanitising them therefore
// belong in the same change.

import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

import { LocalStorageAdapter } from './local-storage.adapter';
import { extensionForMime, UploadsService } from './uploads.service';
import { MediaFileController } from './media-file.controller';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function makeReply() {
  const headers: Record<string, string> = {};
  const reply: any = {
    header(k: string, v: string) {
      headers[k] = v;
      return reply;
    },
    send: vi.fn(),
    headers,
  };
  return reply;
}

describe('extensionForMime', () => {
  it('derives the extension from the MIME, never from the caller', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('application/pdf')).toBe('pdf');
  });

  it('ignores MIME parameters', () => {
    // A real value seen from voice notes.
    expect(extensionForMime('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensionForMime('IMAGE/PNG')).toBe('png');
  });

  it('never yields an executable extension for an unknown type', () => {
    for (const mime of ['text/html', 'application/x-sh', 'image/svg+xml', '', undefined as any]) {
      expect(extensionForMime(mime)).toBe('bin');
    }
  });
});

describe('UploadsService key generation', () => {
  it('stores under the MIME-derived extension, not the caller filename', async () => {
    const storage: any = {
      upload: vi.fn(async (_b: Buffer, key: string) => ({ url: `u/${key}`, key, size: 1 })),
      delete: vi.fn(),
      getUrl: vi.fn(),
      exists: vi.fn(),
    };
    const service = new UploadsService(storage);

    // A genuine PNG, uploaded under a filename that asks to be stored as HTML.
    await service.uploadFile(Buffer.from('x'), 'payload.html', 'image/png');

    const key = storage.upload.mock.calls[0][1] as string;
    expect(key).toMatch(/^media\/[0-9a-f-]{36}\.png$/);
    expect(key).not.toContain('html');
  });
});

describe('LocalStorageAdapter', () => {
  let base: string;
  let adapter: LocalStorageAdapter;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'multiwa-storage-'));
    adapter = new LocalStorageAdapter(base, 'https://gw.example.com/');
  });

  it('hands out a URL this API actually serves, with the folder exactly once', () => {
    const url = adapter.getUrl(`media/${UUID}.png`);
    expect(url).toBe(`https://gw.example.com/uploads/file/media/${UUID}.png`);
    expect(url).not.toMatch(/media\/media/); // the original bug
  });

  it('reads a stored file back', async () => {
    mkdirSync(join(base, 'media'), { recursive: true });
    writeFileSync(join(base, 'media', `${UUID}.png`), Buffer.from('hello'));
    const buf = await adapter.read(`media/${UUID}.png`);
    expect(buf?.toString()).toBe('hello');
  });

  it('returns null rather than escaping the storage root', async () => {
    // A file that a traversal would actually reach — otherwise this passes
    // because the resolved path happens not to exist, and would keep passing
    // with the guard deleted. (It did, until the negative control caught it.)
    const parent = mkdtempSync(join(tmpdir(), 'multiwa-parent-'));
    const root = join(parent, 'storage');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(parent, 'secret.txt'), Buffer.from('TOP SECRET'));

    const a = new LocalStorageAdapter(root, 'https://gw.example.com');

    expect(await a.read('../secret.txt')).toBeNull();
    expect(await a.read('media/../../secret.txt')).toBeNull();
    // Sanity: the file really is reachable by that path, so the null above is
    // the guard refusing and not the file being absent.
    expect(existsSync(join(root, '..', 'secret.txt'))).toBe(true);
  });

  it('returns null for a missing file', async () => {
    expect(await adapter.read(`media/${UUID}.png`)).toBeNull();
  });
});

describe('MediaFileController', () => {
  let base: string;
  let controller: MediaFileController;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'multiwa-storage-'));
    mkdirSync(join(base, 'media'), { recursive: true });
    writeFileSync(join(base, 'media', `${UUID}.png`), Buffer.from('PNGDATA'));
    controller = new MediaFileController(new LocalStorageAdapter(base, 'https://gw.example.com'));
  });

  it('serves a stored file', async () => {
    const reply = makeReply();
    await controller.getFile('media', `${UUID}.png`, reply);
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('PNGDATA'));
    expect(reply.headers['Content-Type']).toBe('image/png');
  });

  it('sends headers that stop a browser executing a stored file', async () => {
    const reply = makeReply();
    await controller.getFile('media', `${UUID}.png`, reply);
    expect(reply.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(reply.headers['Content-Security-Policy']).toContain('sandbox');
    expect(reply.headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(reply.headers['Content-Disposition']).toContain('attachment');
  });

  it('refuses anything that is not <uuid>.<ext>', async () => {
    for (const name of [
      '../../../etc/passwd',
      `${UUID}.png/../../x`,
      'index.html',
      `${UUID}.png.html`,
      `${UUID}`,
    ]) {
      await expect(controller.getFile('media', name, makeReply())).rejects.toThrow(NotFoundException);
    }
  });

  it('refuses a folder it does not hand out URLs for', async () => {
    await expect(controller.getFile('sessions', `${UUID}.png`, makeReply())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('does not echo an unknown extension back as its own content type', async () => {
    writeFileSync(join(base, 'media', `${UUID}.bin`), Buffer.from('x'));
    const reply = makeReply();
    await controller.getFile('media', `${UUID}.bin`, reply);
    expect(reply.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('404s when the adapter cannot read (S3 serves its own URLs)', async () => {
    const s3Like: any = { getUrl: () => '', upload: vi.fn(), delete: vi.fn(), exists: vi.fn() };
    const c = new MediaFileController(s3Like);
    await expect(c.getFile('media', `${UUID}.png`, makeReply())).rejects.toThrow(NotFoundException);
  });
});
