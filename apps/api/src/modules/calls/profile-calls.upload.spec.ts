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

type Post = (payload: Buffer, headers?: Record<string, string>) => Promise<{ status?: number; body: Buffer }>;

// Over a real connection: inject gives every request a stream of its own, so it cannot show what one request leaves
// unread for the next on the same kept-alive connection.
async function onOneConnection(requests: (post: Post) => Promise<void>): Promise<void> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const sockets = new Set<unknown>();
  const post: Post = (payload, headers = MULTIPART) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/upload', method: 'POST', agent, headers: { ...headers, 'content-length': payload.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c)).on('end', () => {
        clearTimeout(deadline);
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) });
      });
    });
    // From the call, not from the socket: a request queued behind one whose socket never comes back gets none.
    const deadline = setTimeout(() => req.destroy(new Error('no answer within 2 s')), 2000);
    req.on('socket', (s) => sockets.add(s)).on('error', (e) => {
      clearTimeout(deadline);
      reject(e);
    });
    req.end(payload);
  });
  try {
    await requests(post);
    expect(sockets.size).toBe(1);
  } finally {
    agent.destroy();
    app.server.closeAllConnections(); // one stuck behind an unread body would hold the close
  }
}

describe('readUpload, on the real multipart parser', () => {
  it('one file: its bytes', async () => {
    const audio = Buffer.from('ID3 an mp3, say');
    const res = await upload(form(filePart('a.mp3', audio)));
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(audio);
  });

  it('two files: the first, and the rest is read, so the next request on the same kept-alive connection answers', () =>
    onOneConnection(async (post) => {
      // The second file is larger than what the parser holds for a reader that never comes.
      const first = Buffer.from('the first file');
      expect(await post(form(filePart('a.mp3', first), filePart('b.mp3', Buffer.alloc(512 * 1024, 1))))).toEqual({ status: 200, body: first });
      expect(await post(form(filePart('c.mp3', Buffer.from('the next one'))))).toEqual({ status: 200, body: Buffer.from('the next one') });
    }), 10_000);

  // Without a boundary the parser never starts and the plugin stops reading the request: a body larger than what the
  // sockets hold would stay on the wire, ahead of the next request.
  it('multipart/form-data without a boundary: 400, and the body is read, so the next request on the same kept-alive connection answers', () =>
    onOneConnection(async (post) => {
      const res = await post(form(filePart('a.mp3', Buffer.alloc(512 * 1024, 1))), { 'content-type': 'multipart/form-data' });
      expect([res.status, JSON.parse(res.body.toString()).message]).toEqual([400, 'The multipart/form-data body is malformed']);
      expect(await post(form(filePart('c.mp3', Buffer.from('the next one'))))).toEqual({ status: 200, body: Buffer.from('the next one') });
    }), 10_000);

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
