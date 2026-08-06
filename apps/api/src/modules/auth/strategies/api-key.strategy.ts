// MultiWA Gateway API - API Key Strategy
// apps/api/src/modules/auth/strategies/api-key.strategy.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

/** Persist lastUsedAt at most once per window (mirrors sessions TOUCH_THROTTLE_MS). */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

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

    // Update last used (throttled — avoid a DB write per request)
    const now = new Date();
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: now },
      });
    }

    return {
      id: key.user.id,
      email: key.user.email,
      name: key.user.name,
      role: key.user.role,
      organizationId: key.user.organizationId,
      organization: key.user.organization,
      apiKeyId: key.id,
      apiKeyScopes: key.permissions, // string[]; [] or ['*'] == full access (enforced by ApiKeyScopeGuard)
    };
  }
}
