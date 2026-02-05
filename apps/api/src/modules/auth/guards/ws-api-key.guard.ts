// MultiWA Gateway - WebSocket API Key Guard
// apps/api/src/modules/auth/guards/ws-api-key.guard.ts

import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(WsApiKeyGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: Socket = context.switchToWs().getClient();
    const apiKey = this.extractApiKey(client);

    if (!apiKey) {
      this.logger.warn(`WebSocket connection rejected: No API key provided`);
      throw new WsException('API key is required');
    }

    // TODO: Validate API key against database
    // For now, we accept any non-empty API key
    // In production, you would validate against the api_keys table

    return true;
  }

  private extractApiKey(client: Socket): string | null {
    // Check query parameter
    const queryApiKey = client.handshake.query.apiKey as string;
    if (queryApiKey) {
      return queryApiKey;
    }

    // Check headers
    const headers = client.handshake.headers;
    if (headers['x-api-key']) {
      return headers['x-api-key'] as string;
    }

    // Check auth header
    const authHeader = headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return null;
  }
}
