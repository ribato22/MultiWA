// MultiWA Gateway - API Keys Service
// apps/api/src/modules/api-keys/api-keys.service.ts

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeysService {
  // Generate a new API key
  async create(userId: string, name: string, permissions: string[] = []) {
    // Generate a random API key with prefix
    const rawKey = `mwa_${crypto.randomBytes(32).toString('hex')}`;
    const prefix = rawKey.substring(0, 12);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
        prefix,
        permissions,
      },
    });

    // Return the raw key only on creation — it cannot be retrieved later
    return {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey,
      prefix: apiKey.prefix,
      permissions: apiKey.permissions,
      createdAt: apiKey.createdAt,
    };
  }

  // List all API keys for a user (masked)
  async findAll(userId: string) {
    const keys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        permissions: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return keys.map(k => ({
      ...k,
      key: `${k.prefix}••••••••••••`,
    }));
  }

  // Delete an API key
  async delete(id: string, userId: string) {
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.userId !== userId) throw new ForbiddenException('Not your API key');

    await prisma.apiKey.delete({ where: { id } });
    return { success: true };
  }
}
