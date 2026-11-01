// The admin's API client, against a stubbed fetch (no browser, no server).
import { test, expect } from '@playwright/test';
import { api } from '@/lib/api';

const calls: string[] = [];
function answerWith(status: number, body: unknown, type = 'application/json') {
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  }) as typeof fetch;
}

test('a refused change keeps its error body: the reasons of a 409 reach the page', async () => {
  answerWith(409, { message: 'Recording calls is not available for this profile', reasons: ['no_announcement'] });
  const res = await api.updateCallsSettings('p-1', { recording: true });
  expect(res).toMatchObject({ status: 409, error: 'Recording calls is not available for this profile', body: { reasons: ['no_announcement'] } });
});

test('a recording comes back as bytes, its download asks for an attachment, and a byte route’s error reads as its message', async () => {
  answerWith(200, 'RIFF-bytes', 'audio/webm');
  const ok = await api.fetchCallRecording('c-1');
  expect(ok.status).toBe(200);
  expect(await ok.blob!.text()).toBe('RIFF-bytes');
  await api.fetchCallRecording('c-1', true);
  expect(calls.slice(-2)).toEqual(['/api/v1/calls/c-1/recording', '/api/v1/calls/c-1/recording?download=1']);
  answerWith(404, { message: 'This call has no recording' });
  expect(await api.fetchCallRecording('c-1')).toEqual({ status: 404, error: 'This call has no recording' });
});

test('an upload a proxy refused for its size (an HTML 413) still reads as the size limit', async () => {
  answerWith(413, '<html><body>413 Request Entity Too Large</body></html>', 'text/html');
  const res = await api.uploadCallsAnnouncement('p-1', new File([new Uint8Array(10)], 'notice.mp3', { type: 'audio/mpeg' }));
  expect(res).toMatchObject({ status: 413, error: 'The file must be at most 2 MB' });
});
