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

  // `.bin` is the right answer for a type the endpoint would REFUSE, and the wrong one
  // for a type it ACCEPTS. UploadsController.getFileCategory() admits anything with an
  // image/, video/ or audio/ prefix, not just its ALLOWED_MIMES list, and a type that is
  // accepted but unmapped is stored as `.bin` — which MessageMedia.fromUrl() resolves to
  // application/octet-stream and then, because that is truthy, never replaces with the
  // response Content-Type (MessageMedia.js:69,118). The recipient gets a file rather than
  // a picture, and on S3 the correct stored ContentType is discarded.
  it.each([
    ['image/heic', 'heic'], // an iPhone photo
    ['image/heif', 'heif'],
    ['image/avif', 'avif'],
    ['image/bmp', 'bmp'],
    ['image/tiff', 'tiff'],
    ['video/3gpp', '3gp'],
    ['video/x-matroska', 'mkv'],
    ['audio/aac', 'aac'],
    ['audio/mp4', 'm4a'],
    ['audio/amr', 'amr'],
    ['audio/flac', 'flac'],
    ['audio/x-wav', 'wav'],
    ['audio/mp3', 'mp3'],
  ])('maps %s, which the endpoint accepts, to .%s rather than .bin', (mime, expected) => {
    expect(extensionForMime(mime)).toBe(expected);
  });

  it('has no mapping that is itself an executable extension', () => {
    const active = ['html', 'htm', 'xhtml', 'xht', 'svg', 'svgz', 'xml', 'xsl', 'xslt',
                    'js', 'mjs', 'cjs', 'es', 'ecma', 'css', 'php', 'jsp', 'asp', 'sh'];
    for (const mime of ['image/heic', 'video/3gpp', 'audio/flac', 'image/png', 'text/plain']) {
      expect(active).not.toContain(extensionForMime(mime));
    }
  });
});

describe('getFileType', () => {
  const service = new UploadsService({} as never);

  // Normalised the same way extensionForMime is: the two classify the same upload for the
  // same response, so an uppercase or parameterised type must not make them disagree.
  it.each([
    ['image/png', 'IMAGE'],
    ['IMAGE/PNG', 'IMAGE'],
    ['image/heic', 'IMAGE'],
    ['audio/ogg; codecs=opus', 'AUDIO'],
    ['VIDEO/MP4', 'VIDEO'],
    ['application/pdf', 'DOCUMENT'],
    ['', 'DOCUMENT'],
  ])('classifies %s as %s', (mime, expected) => {
    expect(service.getFileType(mime)).toBe(expected);
  });

  it('agrees with extensionForMime about what an upload is', () => {
    for (const mime of ['IMAGE/PNG', 'audio/ogg; codecs=opus', 'image/heic']) {
      expect(extensionForMime(mime)).not.toBe('bin');
      expect(['IMAGE', 'VIDEO', 'AUDIO']).toContain(service.getFileType(mime));
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

// Recordings and announcements never live in the media folder (their store refuses to overlap STORAGE_PATH), and their
// keys have shapes this route refuses anyway: deeper than <folder>/<name>, under folders other than media.
describe('MediaFileController never serves a call recording or an announcement', () => {
  it.each([
    ['announcements', '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp3'],
    ['11111111-1111-4111-8111-111111111111', '3f2504e0-4f89-41d3-9a0c-0305e82c3301.webm'],
    ['probe', '3f2504e0-4f89-41d3-9a0c-0305e82c3301'],
  ])('refuses %s/%s without reading anything', async (folder, name) => {
    const storage = { read: vi.fn() };
    await expect(new MediaFileController(storage as any).getFile(folder, name, makeReply())).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.read).not.toHaveBeenCalled();
  });
});
