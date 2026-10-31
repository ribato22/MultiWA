// readUpload against the real @fastify/multipart, registered on a bare Fastify as app.factory.ts registers it: the
// bodies a client can send, and the status Nest would answer each with. The other specs stub request.file().
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { HttpException } from '@nestjs/common';

vi.mock('./calls.service', () => ({ CallsService: class {} }));
vi.mock('./recordings/call-announcement.service', () => ({ CallAnnouncementService: class {} }));

import { readUpload } from './profile-calls.controller';
import { ANNOUNCEMENT_MAX_BYTES } from './recordings/announcement-audio';

const BOUNDARY = 'multiwa-spec-boundary';
const MULTIPART = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };
const filePart = (filename: string, content: Buffer) => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`),
  content,
  Buffer.from('\r\n'),
]);
const form = (...parts: Buffer[]) => Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);

let app: FastifyInstance;
beforeEach(async () => {
  app = Fastify();
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // as app.factory.ts
  app.post('/upload', (request) => readUpload(request, ANNOUNCEMENT_MAX_BYTES));
  // As Nest's exception filter answers: an HttpException with its status, an error with a statusCode with that one,
  // anything else 500.
  app.setErrorHandler((e: FastifyError, _request, reply) => {
    void reply.code(e instanceof HttpException ? e.getStatus() : e.statusCode ?? 500).send({ message: e.message });
  });
});
afterEach(() => app.close());

const upload = (payload: Buffer, headers: Record<string, string> = MULTIPART) => app.inject({ method: 'POST', url: '/upload', headers, payload });

describe('readUpload, on the real multipart parser', () => {
  it('one file: its bytes', async () => {
    const audio = Buffer.from('ID3 an mp3, say');
    const res = await upload(form(filePart('a.mp3', audio)));
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(audio);
  });

  // Over a real connection: inject gives every request a stream of its own, so it cannot show this.
  it('two files: the first, and the rest is read, so the next request on the same kept-alive connection answers', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const sockets = new Set<unknown>();
    const post = (payload: Buffer) => new Promise<{ status?: number; body: Buffer }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/upload', method: 'POST', agent, timeout: 2000, headers: { ...MULTIPART, 'content-length': payload.length } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      });
      req.on('socket', (s) => sockets.add(s)).on('timeout', () => req.destroy(new Error('no answer within 2 s'))).on('error', reject);
      req.end(payload);
    });
    try {
      // The second file is larger than what the parser holds for a reader that never comes.
      const first = Buffer.from('the first file');
      expect(await post(form(filePart('a.mp3', first), filePart('b.mp3', Buffer.alloc(512 * 1024, 1))))).toEqual({ status: 200, body: first });
      expect(await post(form(filePart('c.mp3', Buffer.from('the next one'))))).toEqual({ status: 200, body: Buffer.from('the next one') });
      expect(sockets.size).toBe(1);
    } finally {
      agent.destroy();
      app.server.closeAllConnections(); // one stuck behind an unread body would hold the close
    }
  }, 10_000);

  it('a file over the limit: 413', async () => {
    const res = await upload(form(filePart('big.mp3', Buffer.alloc(ANNOUNCEMENT_MAX_BYTES + 1, 1))));
    expect(res.statusCode).toBe(413);
    expect(res.json().message).toBe('The file must be at most 2 MB');
  });

  it('multipart/form-data without a boundary: 400, not 500', async () => {
    const res = await upload(form(filePart('a.mp3', Buffer.from('mp3'))), { 'content-type': 'multipart/form-data' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('The multipart/form-data body is malformed');
  });

  it('a body cut in the middle of the file: 400, not 500', async () => {
    const whole = form(filePart('a.mp3', Buffer.alloc(4096, 1)));
    const res = await upload(whole.subarray(0, 2048));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('The multipart/form-data body is malformed');
  });
});
