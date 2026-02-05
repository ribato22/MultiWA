// MultiWA Gateway API - API Key Strategy
// apps/api/src/modules/auth/strategies/api-key.strategy.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor() {
    super();
  }

  async validate(req: any) {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    // Hash the API key to find it
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    const key = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        user: {
          include: { organization: true },
        },
      },
    });

    if (!key) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check expiration
    if (key.expiresAt && new Date() > key.expiresAt) {
      throw new UnauthorizedException('API key expired');
    }

    // Update last used
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      id: key.user.id,
      email: key.user.email,
      name: key.user.name,
      role: key.user.role,
      organizationId: key.user.organizationId,
      organization: key.user.organization,
      apiKeyId: key.id,
    };
  }
}
