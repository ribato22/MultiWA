// MultiWA Gateway - Upload Controller
// apps/api/src/modules/uploads/uploads.controller.ts

import { Controller, Post, Get, Param, Res, UseGuards, Req, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBearerAuth, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { existsSync, createReadStream } from 'fs';
import { resolve, join } from 'path';
import { UploadsService } from './uploads.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

const MAX_FILE_SIZES: Record<string, number> = {
  'image': 16 * 1024 * 1024,    // 16MB
  'video': 16 * 1024 * 1024,    // 16MB
  'audio': 16 * 1024 * 1024,    // 16MB
  'document': 20 * 1024 * 1024, // 20MB
};

const ALLOWED_MIMES: Record<string, string[]> = {
  'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  'video': ['video/mp4', 'video/quicktime', 'video/webm'],
  'audio': ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
  'document': [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
  ],
};

@ApiTags('Uploads')
@Controller('uploads')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('media')
  @ApiOperation({ summary: 'Upload media file to S3/MinIO' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadMedia(@Req() request: FastifyRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await (request as any).file();

    if (!data) {
      throw new BadRequestException('No file uploaded');
    }

    const buffer = await data.toBuffer();
    const mimeType = data.mimetype;
    const filename = data.filename;
    const fileType = this.getFileCategory(mimeType);

    // Validate mime type
    if (!fileType) {
      throw new BadRequestException(
        `Unsupported file type: ${mimeType}. Allowed: images, videos, audio, documents`,
      );
    }

    // Validate size
    const maxSize = MAX_FILE_SIZES[fileType];
    if (buffer.length > maxSize) {
      throw new BadRequestException(
        `File too large. Max size for ${fileType}: ${maxSize / (1024 * 1024)}MB`,
      );
    }

    const result = await this.uploadsService.uploadFile(
      buffer,
      filename,
      mimeType,
      fileType,
    );

    return {
      success: true,
      data: {
        url: result.url,
        key: result.key,
        size: result.size,
        filename,
        mimeType,
        type: this.uploadsService.getFileType(mimeType),
      },
    };
  }

  private getFileCategory(mimeType: string): string | null {
    for (const [category, mimes] of Object.entries(ALLOWED_MIMES)) {
      if (mimes.includes(mimeType)) {
        return category;
      }
    }
    // Fallback: check by prefix
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return null;
  }
}
