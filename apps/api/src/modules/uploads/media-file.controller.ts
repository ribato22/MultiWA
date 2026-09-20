// MultiWA Gateway - Stored media file route
// apps/api/src/modules/uploads/media-file.controller.ts
//
// Serves the URL LocalStorageAdapter.getUrl() hands out. Nothing served that
// path before, and MessageMedia.fromUrl() does not check `response.ok`: it
// fetched this API's own 404 JSON body, pinned the mimetype from the `.png` in
// the URL, and handed those bytes to WhatsApp as the image. Every media send
// that went through an upload failed that way, with a 0% all-time success rate.
//
// WHY THIS ROUTE IS UNAUTHENTICATED
//   whatsapp-web.js fetches the URL from Node with no credentials, so an
//   authenticated route cannot work here. What stands in for auth:
//     - the key is a v4 uuid, so the path is unguessable;
//     - only a strict `<folder>/<uuid>.<ext>` shape is accepted, and the
//       adapter refuses any resolved path outside the storage root;
//     - the response is sent with headers that stop a browser treating a stored
//       file as active content.
//   It is a deliberate trade: media the operator is already sending out over
//   WhatsApp, reachable by anyone holding an unguessable URL.
//
// It lives in its own controller because UploadsController carries a
// class-level JwtOrApiKeyGuard and this repo has no @Public() escape hatch —
// a second controller is a smaller change than introducing one.

import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { STORAGE_ADAPTER, type IStorageAdapter } from './storage.interface';

/** Folders the adapter is allowed to hand out URLs for. */
const ALLOWED_FOLDERS = new Set(['media']);

/** `<uuid>.<ext>` and nothing else — no traversal, no second dot, no shell characters. */
const FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/;

/** Content types that may be echoed back. Anything else is sent as a download. */
const SAFE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  pdf: 'application/pdf',
};

@ApiExcludeController()
@Controller('uploads')
export class MediaFileController {
  constructor(
    @Inject(STORAGE_ADAPTER)
    private readonly storage: IStorageAdapter,
  ) {}

  @Get('file/:folder/:name')
  async getFile(
    @Param('folder') folder: string,
    @Param('name') name: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!ALLOWED_FOLDERS.has(folder) || !FILENAME.test(name)) {
      throw new NotFoundException('File not found');
    }

    // S3 serves its own URLs, so the adapter there has no read(). Answering 404
    // is correct: nothing should be pointing at this route in that setup.
    if (typeof this.storage.read !== 'function') {
      throw new NotFoundException('File not found');
    }

    const buffer = await this.storage.read(`${folder}/${name}`);
    if (!buffer) {
      throw new NotFoundException('File not found');
    }

    const ext = name.split('.').pop()!;
    const contentType = SAFE_TYPES[ext] ?? 'application/octet-stream';

    reply
      // Never let a browser sniff a stored file into something executable. The
      // stored extension is derived from the validated MIME (see
      // uploads.service.ts), and these headers are the second line of defence.
      .header('Content-Type', contentType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Content-Disposition', `attachment; filename="${name}"`)
      .header('Cache-Control', 'private, max-age=3600')
      .send(buffer);
  }
}
