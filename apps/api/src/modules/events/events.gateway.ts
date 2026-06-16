// MultiWA Gateway - Events Gateway (WebSocket)
// apps/api/src/modules/events/events.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

// CORS origins are driven by env so production isn't pinned to localhost.
const WS_CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: WS_CORS_ORIGINS,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwt: JwtService) {}

  @WebSocketServer()
  server: Server;

  // Track connected clients by profile ID
  private clients: Map<string, Set<string>> = new Map();

  async handleConnection(client: Socket) {
    // Authenticate the socket in the handshake. An unauthenticated client must
    // never receive another tenant's pairing QR codes or messages.
    const auth = await this.authenticate(client);
    if (!auth) {
      this.logger.warn(`Rejected unauthenticated socket: ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.userId = auth.userId;
    client.data.organizationId = auth.organizationId;
    this.logger.log(`Client connected to /ws: ${client.id} (org ${auth.organizationId})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up client from all profile rooms
    this.clients.forEach((clientSet, profileId) => {
      clientSet.delete(client.id);
      if (clientSet.size === 0) {
        this.clients.delete(profileId);
      }
    });
  }

  // Handle 'join' event (frontend: socket.emit('join', { profileId }))
  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { profileId: string },
  ) {
    const { profileId } = data || ({} as any);
    const organizationId = client.data?.organizationId;

    if (!organizationId || !profileId || !(await this.ownsProfile(profileId, organizationId))) {
      this.logger.warn(`Client ${client.id} denied join for profile ${profileId}`);
      return { success: false, error: 'Forbidden' };
    }

    this.logger.log(`Client ${client.id} joining profile room: ${profileId}`);
    client.join(`profile:${profileId}`);

    if (!this.clients.has(profileId)) {
      this.clients.set(profileId, new Set());
    }
    this.clients.get(profileId)!.add(client.id);

    return { success: true, profileId };
  }

  @SubscribeMessage('subscribe:profile')
  async handleSubscribeProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { profileId: string },
  ) {
    return this.handleJoin(client, data);
  }

  @SubscribeMessage('unsubscribe:profile')
  handleUnsubscribeProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { profileId: string },
  ) {
    const { profileId } = data;
    this.logger.log(`Client ${client.id} leaving profile room: ${profileId}`);

    client.leave(`profile:${profileId}`);

    const clientSet = this.clients.get(profileId);
    if (clientSet) {
      clientSet.delete(client.id);
      if (clientSet.size === 0) {
        this.clients.delete(profileId);
      }
    }

    return { success: true, profileId };
  }

  /** Resolve { userId, organizationId } from a JWT or API key in the handshake. */
  private async authenticate(
    client: Socket,
  ): Promise<{ userId: string; organizationId: string } | null> {
    const handshake: any = client.handshake || {};
    const bearer =
      typeof handshake.headers?.authorization === 'string'
        ? handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined;
    const token = handshake.auth?.token || bearer || handshake.query?.token;
    const apiKey =
      handshake.auth?.apiKey || handshake.headers?.['x-api-key'] || handshake.query?.apiKey;

    if (token && typeof token === 'string') {
      try {
        const payload: any = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET });
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, organizationId: true, isActive: true },
        });
        if (user && user.isActive) {
          return { userId: user.id, organizationId: user.organizationId };
        }
      } catch {
        /* fall through to API key */
      }
    }

    if (apiKey && typeof apiKey === 'string') {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const key = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: { user: { select: { id: true, organizationId: true, isActive: true } } },
      });
      if (key && (!key.expiresAt || new Date() <= key.expiresAt) && key.user?.isActive) {
        return { userId: key.user.id, organizationId: key.user.organizationId };
      }
    }

    return null;
  }

  /** True when the profile belongs to the given organization. */
  private async ownsProfile(profileId: string, organizationId: string): Promise<boolean> {
    return !!(await prisma.profile.findFirst({
      where: { id: profileId, workspace: { organizationId } },
      select: { id: true },
    }));
  }

  // Emit QR code update (frontend: socket.on('qr:update', data))
  emitQrUpdate(profileId: string, qrCode: string) {
    this.logger.log(`Emitting qr:update for profile: ${profileId}`);
    this.server.to(`profile:${profileId}`).emit('qr:update', { profileId, qrCode });
  }

  // Emit connection status (frontend: socket.on('connection:status', data))
  // For status='error', the third argument is a human-readable reason instead of
  // a phone number; the payload exposes it as the `reason` field so the frontend
  // can surface it in a recoverable error alert.
  emitConnectionStatus(profileId: string, status: string, phoneOrReason?: string) {
    this.logger.log(`Emitting connection:status '${status}' for profile: ${profileId}`);
    const payload: Record<string, unknown> = {
      profileId,
      status,
    };
    if (phoneOrReason !== undefined) {
      if (status === 'error') {
        payload.reason = phoneOrReason;
      } else {
        payload.phoneNumber = phoneOrReason;
        // Legacy compatibility: some clients read `phone` instead of `phoneNumber`.
        payload.phone = phoneOrReason;
      }
    }
    this.server.to(`profile:${profileId}`).emit('connection:status', payload);
  }

  // Legacy emit methods for compatibility
  emitQr(profileId: string, qrData: { qr: string; status: string }) {
    this.emitQrUpdate(profileId, qrData.qr);
  }

  emitStatus(profileId: string, status: string, data?: any) {
    this.emitConnectionStatus(profileId, status, data?.phoneNumber);
  }

  // Emit message event
  emitMessage(profileId: string, message: any) {
    this.server.to(`profile:${profileId}`).emit('message', message);
  }

  // Emit connection success with phone info
  emitConnected(profileId: string, data: { phone: string; pushName?: string }) {
    this.logger.log(`Profile ${profileId} connected: ${data.phone}`);
    this.emitConnectionStatus(profileId, 'connected', data.phone);
  }

  // Emit disconnection
  emitDisconnected(profileId: string, reason?: string) {
    this.logger.log(`Profile ${profileId} disconnected: ${reason}`);
    this.emitConnectionStatus(profileId, 'disconnected');
  }

  // Emit message acknowledgment (sent/delivered/read)
  emitMessageAck(profileId: string, messageId: string, status: string) {
    this.server.to(`profile:${profileId}`).emit('message:ack', { profileId, messageId, status });
  }
}
