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
  GatewayMetadata,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import type { RealtimeEmitter } from '@multiwa/core';
import * as crypto from 'crypto';
import { InternalEvents } from '../../metrics/internal-events';

// CORS origins are driven by env so production isn't pinned to localhost.
const WS_CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** The /ws namespace's options: every gateway on it (this one, CallsGateway) declares the same. */
export const WS_GATEWAY_OPTIONS: GatewayMetadata = {
  namespace: '/ws',
  cors: {
    origin: WS_CORS_ORIGINS,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
};

/** Who a socket is: its user and organization, and how it logged in. */
export interface SocketPrincipal {
  userId: string;
  organizationId: string;
  /** Present for an API-key socket (`[]` or `['*']` means full access), absent for a dashboard login (JWT). */
  apiKeyScopes?: string[];
}

@WebSocketGateway(WS_GATEWAY_OPTIONS)
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, RealtimeEmitter {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(private readonly jwt: JwtService, private readonly eventEmitter: EventEmitter2) {}

  // With a namespace, Nest injects the namespace (not the root Server): its adapter holds the rooms.
  @WebSocketServer()
  server: Namespace;

  // Track connected clients by profile ID
  private clients: Map<string, Set<string>> = new Map();

  async handleConnection(client: Socket) {
    // Authenticate the socket in the handshake. An unauthenticated client must
    // never receive another tenant's pairing QR codes or messages.
    // Nest does not await this hook before it dispatches the client's messages,
    // so every handler awaits the same promise (authOf).
    const auth = await this.authOf(client);
    // Left while it was being authenticated: its handleDisconnect has run already and socket.io ignores a closed
    // socket's join, so it must not touch presence.
    if (!client.connected) return;
    if (!auth) {
      this.logger.warn(`Rejected unauthenticated socket: ${client.id}`);
      client.disconnect(true);
      return;
    }
    // A dashboard login joins its user's room: the call coordinator rings, and talks to, a user on every dashboard socket
    // they have open, and the room is their presence. An API-key socket joins none: an integration that stays connected
    // would keep its user online for ever, always rung and never lost.
    if (auth.apiKeyScopes === undefined) {
      const room = this.userRoom(auth.userId);
      client.join(room);
      client.data.userId = auth.userId; // read by handleDisconnect: only a socket that joined can take its user offline
      if (this.server?.adapter?.rooms.get(room)?.size === 1) this.emitInternal(InternalEvents.WS_USER_ONLINE, { userId: auth.userId });
    }
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
    // socket.io has taken the socket out of its rooms by now: an empty user room means the user's last dashboard
    // socket left.
    const userId: string | undefined = client.data?.userId;
    if (userId && !this.isUserOnline(userId)) this.emitInternal(InternalEvents.WS_USER_OFFLINE, { userId });
  }

  /**
   * The socket's principal, authenticated ONCE per socket: the promise is kept on the socket and shared by every
   * gateway on /ws, since Nest runs their connection hooks in no set order and dispatches messages before they end.
   * A lookup that throws (the database is down) refuses the socket like a bad credential: Nest drops the hooks'
   * promises, so a rejection would reach the process's rejection guard, which rethrows it and the api exits.
   */
  authOf(client: Socket): Promise<SocketPrincipal | null> {
    return (client.data.auth ??= this.authenticate(client).catch((e) => {
      this.logger.warn(`Could not authenticate socket ${client.id}: ${clean((e as Error)?.message ?? e)}`);
      return null;
    }));
  }

  // Handle 'join' event (frontend: socket.emit('join', { profileId }))
  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { profileId: string },
  ) {
    const { profileId } = data || ({} as any);
    const auth = await this.authOf(client);
    // Left while it was being authenticated: its handleDisconnect has cleaned up already, so record nothing.
    if (!client.connected) return { success: false, error: 'Disconnected' };
    const organizationId = auth?.organizationId;

    if (!organizationId || !profileId || !(await this.ownsProfile(profileId, organizationId))) {
      this.logger.warn(`Client ${client.id} denied join for profile ${clean(profileId)}`);
      return { success: false, error: 'Forbidden' };
    }

    this.logger.log(`Client ${client.id} joining profile room: ${clean(profileId)}`);
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
    this.logger.log(`Client ${client.id} leaving profile room: ${clean(profileId)}`);

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

  /** Resolve the socket's principal from a JWT or API key in the handshake. */
  private async authenticate(
    client: Socket,
  ): Promise<SocketPrincipal | null> {
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
        // Always an array for an API key, also when its column holds NULL: its absence is what marks a dashboard login.
        return { userId: key.user.id, organizationId: key.user.organizationId, apiKeyScopes: key.permissions ?? [] };
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

  /** Emit to every dashboard socket of these users (a socket in several of their rooms gets it once). */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length) this.server.to(userIds.map((id) => this.userRoom(id))).emit(event, payload);
  }

  /** The users with at least one dashboard socket on /ws (the adapter drops a room with its last socket). */
  onlineUserIds(): string[] {
    const prefix = this.userRoom('');
    const rooms = this.server?.adapter?.rooms;
    return rooms ? [...rooms.keys()].filter((r) => r.startsWith(prefix)).map((r) => r.slice(prefix.length)) : [];
  }

  isUserOnline(userId: string): boolean {
    return !!this.server?.adapter?.rooms.get(this.userRoom(userId))?.size;
  }

  private userRoom(userId: string): string {
    return `user:${userId}`;
  }

  /** The internal bus never breaks a socket hook. */
  private emitInternal(event: string, payload: Record<string, unknown>): void {
    try {
      this.eventEmitter.emit(event, payload);
    } catch (e) {
      this.logger.warn(`Failed to emit '${event}': ${clean((e as Error)?.message ?? e)}`);
    }
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

  // Emit a call change (ringing, rejected, ended, follow-up/assignee updated)
  emitCallUpdate(profileId: string, call: Record<string, unknown>) {
    this.server.to(`profile:${profileId}`).emit('call:update', { ...call, profileId });
  }
}
