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
import { Namespace, RemoteSocket, Socket } from 'socket.io';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '@multiwa/database';
import type { RealtimeEmitter } from '@multiwa/core';
import * as crypto from 'crypto';
import { InternalEvents } from '../../metrics/internal-events';
import { ADMIN_ROLES } from '../auth/roles';
import { apiKeyLacksScope } from '../auth/guards/api-key-scope.guard';

// CORS origins are driven by env so production isn't pinned to localhost.
const WS_CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3001,http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

/** An access token's key in the sessions table: the same hash as SessionsService.hashToken (the token is never stored). */
const sessionTokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** How often the credentials of every socket are checked again: a revoked device or integration is gone within this. */
const SOCKET_SWEEP_MS = 60_000;

/** A socket whose credentials could not be checked is closed after this long, plus up to the jitter (see handleConnection). */
const UNCHECKED_HOLD_MS = 5_000;
const UNCHECKED_HOLD_JITTER_MS = 10_000;
/** After a warning about sockets whose credentials could not be checked, the next ones are only counted this long. */
const UNCHECKED_WARN_MS = 60_000;

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
  /** A dashboard login's session (`sessions.tokenHash`, never the token itself): its sockets last only as long as it does. */
  sessionTokenHash?: string;
  /** An API-key socket's key (`apiKeys.id`, never the key itself): its sockets last only as long as it does. */
  apiKeyId?: string;
}

/** What a sweep needs of a socket: `fetchSockets` gives these for the sockets of every node. */
type SweptSocket = Pick<RemoteSocket<any, any>, 'id' | 'data' | 'disconnect'>;
/** A credential's row (a session, an API key) with its user, as a sweep reads it. */
type CredentialRow = { expiresAt: Date | null; user: { isActive: boolean } | null };

@WebSocketGateway(WS_GATEWAY_OPTIONS)
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy, RealtimeEmitter {
  private readonly logger = new Logger(EventsGateway.name);
  private sweepTimer?: NodeJS.Timeout;
  /**
   * The sockets whose credentials could not be checked since the last warning, the latest error, and the timer of the
   * quiet minute after that warning (none: the next one is warned at once).
   */
  private unchecked: { count: number; error: unknown; quiet?: NodeJS.Timeout } = { count: 0, error: undefined };

  constructor(private readonly jwt: JwtService, private readonly eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => void this.sweepSockets(), SOCKET_SWEEP_MS).unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    clearTimeout(this.unchecked.quiet);
  }

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
    if (!auth && client.data.authUnchecked) {
      // Not refused: its credentials could not be checked. A closed transport is one the client reconnects by itself,
      // and the next handshake checks them again; a refusal would leave it off until a reload. Not closed at once
      // either: socket.io-client resets its reconnect backoff whenever a connection opens, so a socket closed at once
      // is back within about a second, every tab and integration, each time with lookups against a database that is
      // trying to recover. Held open a few seconds, jittered so that they do not all come back together. Until then
      // it has no principal and joins no room; its joins answer Unavailable and its call commands unavailable, not the
      // Forbidden and not_allowed of a refusal, which a client may take as final.
      setTimeout(() => {
        if (client.connected) client.conn.close();
      }, UNCHECKED_HOLD_MS + Math.random() * UNCHECKED_HOLD_JITTER_MS).unref();
      return;
    }
    if (!auth) {
      this.logger.warn(`Rejected unauthenticated socket: ${client.id}`);
      client.disconnect(true);
      return;
    }
    // Every socket joins the rooms through which a revocation reaches it at once: its user's, and the one of the API key
    // or session that opened it (disconnectUser, disconnectApiKey, disconnectSession).
    client.join(this.principalRoom(auth.userId));
    if (auth.apiKeyId) {
      client.join(this.apiKeyRoom(auth.apiKeyId));
      client.data.apiKeyId = auth.apiKeyId; // checked again by the sweep
    }
    // A dashboard login joins its user's room: the call coordinator rings, and talks to, a user on every dashboard socket
    // they have open, and the room is their presence. An API-key socket joins none: an integration that stays connected
    // would keep its user online for ever, always rung and never lost.
    if (auth.apiKeyScopes === undefined) {
      const room = this.userRoom(auth.userId);
      client.join(room);
      if (auth.sessionTokenHash) client.join(this.sessionRoom(auth.sessionTokenHash));
      client.data.userId = auth.userId; // read by handleDisconnect: only a socket that joined can take its user offline
      client.data.sessionTokenHash = auth.sessionTokenHash; // checked again by the sweep
      if (this.server?.adapter?.rooms.get(room)?.size === 1) this.emitInternal(InternalEvents.WS_USER_ONLINE, { userId: auth.userId });
    }
    this.logger.log(`Client connected to /ws: ${client.id} (org ${auth.organizationId})`);
  }

  handleDisconnect(client: Socket) {
    // Not for a socket whose credentials could not be checked: noteUnchecked counted it, and while the database is down
    // it is closed and back every few seconds, so a line for each would flood the log.
    if (!client.data?.authUnchecked) this.logger.log(`Client disconnected: ${client.id}`);
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
   * A lookup that throws (the database is down) gives no principal either, and marks the socket `authUnchecked`, so
   * that handleConnection closes it, a few seconds on, instead of refusing it. It never rejects: Nest drops the hooks'
   * promises, so a rejection would reach the process's rejection guard, which rethrows it and the api exits.
   */
  authOf(client: Socket): Promise<SocketPrincipal | null> {
    return (client.data.auth ??= this.authenticate(client).catch((e) => {
      client.data.authUnchecked = true;
      this.noteUnchecked(client, (e as Error)?.message ?? e);
      return null;
    }));
  }

  /**
   * While the database is down every socket is unchecked, and each comes back every few seconds. The first is warned at
   * once, so the log shows when an outage began. Those in the minute after a warning are only counted (no line each:
   * Nest's default logger prints debug lines in production too), and make one warning at its end, with the latest
   * error; that warning starts another such minute. A minute with none ends it: the next one is warned at once again.
   */
  private noteUnchecked(client: Socket, error: unknown): void {
    if (this.unchecked.quiet) {
      this.unchecked.count++;
      this.unchecked.error = error;
      return;
    }
    this.logger.warn(`Could not check the credentials of socket ${client.id} (it is closed after a few seconds, and reconnects): ${clean(error)}`);
    this.quietUnchecked();
  }

  private quietUnchecked(): void {
    this.unchecked.quiet = setTimeout(() => {
      const { count, error } = this.unchecked;
      this.unchecked = { count: 0, error: undefined };
      if (!count) return;
      this.logger.warn(
        `Could not check the credentials of ${count} more socket(s) in the last minute (each is closed after a few seconds, and reconnects); the latest error: ${clean(error)}`,
      );
      this.quietUnchecked();
    }, UNCHECKED_WARN_MS).unref();
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
    // Its credentials could not be checked: not Forbidden, which a client may take as final. It is closed in a few
    // seconds, and is to join again once it has reconnected.
    if (!auth && client.data.authUnchecked) return { success: false, error: 'Unavailable' };
    const organizationId = auth?.organizationId;

    if (!organizationId || !profileId || !(await this.ownsProfile(profileId, organizationId))) {
      this.logger.warn(`Client ${client.id} denied join for profile ${clean(profileId)}`);
      return { success: false, error: 'Forbidden' };
    }

    this.logger.log(`Client ${client.id} joining profile room: ${clean(profileId)}`);
    client.join(`profile:${profileId}`);
    // Who may get the profile's QR on this socket, if an owner or admin (emitQrUpdate). A QR links a phone, which an API
    // key may do only with profiles:write, as on GET .../qr: without it, the socket gets the room's other events only.
    if (!apiKeyLacksScope(auth!, 'profiles:write')) client.data.qrUserId = auth!.userId;

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
      let payload: any = null;
      try {
        payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET });
      } catch {
        /* an invalid or expired token: fall through to API key */
      }
      // Outside that try: a lookup that throws is no bad token, and reaches authOf.
      if (payload) {
        // As on the HTTP API (JwtStrategy), the token needs a live session: a login that was logged out or revoked
        // keeps a valid token for days, and must not open a socket that is rung and answers calls.
        const tokenHash = sessionTokenHash(token);
        const [user, session] = await Promise.all([
          prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, organizationId: true, isActive: true } }),
          prisma.session.findUnique({ where: { tokenHash }, select: { expiresAt: true } }),
        ]);
        if (user && user.isActive && session && session.expiresAt > new Date()) {
          return { userId: user.id, organizationId: user.organizationId, sessionTokenHash: tokenHash };
        }
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
        return { userId: key.user.id, organizationId: key.user.organizationId, apiKeyScopes: key.permissions ?? [], apiKeyId: key.id };
      }
    }

    return null;
  }

  /**
   * A socket is authenticated once, at its handshake. Deleting its API key, logging out or revoking its session, and
   * removing its user disconnect it at once (disconnectApiKey, disconnectSession, disconnectUser); this is the safety net
   * for every other change. Every minute the credentials of every socket on /ws are checked again, in one query per
   * kind: a dashboard socket's session, an API-key socket's key. A socket whose credential is gone (a key deleted; a
   * session logged out, revoked, or its user deleted), has expired, or whose user was deactivated is disconnected, which
   * runs the usual path: the user goes offline, and the call coordinator hangs up the call of an agent lost for longer
   * than its grace. A sweep that fails changes nothing.
   */
  private async sweepSockets(): Promise<void> {
    try {
      // Through the adapter: with one that spans nodes, the sockets of the other nodes too.
      const sockets: SweptSocket[] = await this.server.fetchSockets();
      const dashboards = sockets.filter((s) => s.data?.sessionTokenHash);
      if (dashboards.length) {
        const rows = await prisma.session.findMany({
          where: { tokenHash: { in: [...new Set(dashboards.map((s) => s.data.sessionTokenHash as string))] } },
          select: { tokenHash: true, expiresAt: true, user: { select: { isActive: true } } },
        });
        const byHash = new Map(rows.map((r) => [r.tokenHash, r] as const));
        for (const s of dashboards) this.closeIfLapsed(s, 'session', byHash.get(s.data.sessionTokenHash));
      }
      const integrations = sockets.filter((s) => s.data?.apiKeyId);
      if (integrations.length) {
        const rows = await prisma.apiKey.findMany({
          where: { id: { in: [...new Set(integrations.map((s) => s.data.apiKeyId as string))] } },
          select: { id: true, expiresAt: true, user: { select: { isActive: true } } },
        });
        const byId = new Map(rows.map((r) => [r.id, r] as const));
        for (const s of integrations) this.closeIfLapsed(s, 'API key', byId.get(s.data.apiKeyId));
      }
    } catch (e) {
      this.logger.warn(`Could not check the sockets' credentials: ${clean((e as Error)?.message ?? e)}`);
    }
  }

  /** Disconnects a socket whose credential's row is gone (undefined), has expired, or belongs to a user who is inactive. */
  private closeIfLapsed(socket: SweptSocket, what: string, row: CredentialRow | undefined): void {
    const why = !row
      ? `its ${what} is gone`
      : row.expiresAt && row.expiresAt <= new Date()
        ? `its ${what} has expired`
        : !row.user?.isActive
          ? 'its user is inactive'
          : undefined;
    if (!why) return;
    this.logger.log(`Closing socket ${clean(socket.id)}: ${why}`);
    socket.disconnect(true);
  }

  /** A deleted API key: every socket it opened is disconnected at once. */
  disconnectApiKey(apiKeyId: string): void {
    this.disconnectRoom(this.apiKeyRoom(apiKeyId), `Disconnecting the sockets of API key ${clean(apiKeyId)}: the key was deleted`);
  }

  /** A logged-out or revoked session: the sockets it opened (a dashboard's tabs). */
  disconnectSession(tokenHash: string): void {
    this.disconnectRoom(this.sessionRoom(tokenHash), 'Disconnecting the sockets of a session: it was logged out or revoked');
  }

  /**
   * Every session of a user revoked but one (all, with none given): their dashboard sockets, less that session's. An API
   * key is no session, and keeps its sockets.
   */
  disconnectOtherSessions(userId: string, keepTokenHash?: string): void {
    this.disconnectRoom(
      this.userRoom(userId),
      `Disconnecting the dashboard sockets of user ${clean(userId)}: their other sessions were revoked`,
      keepTokenHash ? this.sessionRoom(keepTokenHash) : undefined,
    );
  }

  /** A removed user: every socket of theirs, a dashboard login's and an API key's. */
  disconnectUser(userId: string): void {
    this.disconnectRoom(this.principalRoom(userId), `Disconnecting the sockets of user ${clean(userId)}: the user was removed`);
  }

  /**
   * Disconnects the sockets in a room, less those also in `except`, on every node. Never throws: it runs after the
   * change it follows was made, and the sweep closes what this could not.
   */
  private disconnectRoom(room: string, logLine: string, except?: string): void {
    try {
      this.logger.log(logLine);
      const sockets = this.server.in(room);
      (except ? sockets.except(except) : sockets).disconnectSockets(true);
    } catch (e) {
      this.logger.warn(`Could not disconnect the sockets of a revoked credential (the next sweep will): ${clean((e as Error)?.message ?? e)}`);
    }
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

  /** Every socket of a user, whatever it logged in with: the `user:` room holds dashboard sockets only, as their presence. */
  private principalRoom(userId: string): string {
    return `principal:${userId}`;
  }

  private apiKeyRoom(apiKeyId: string): string {
    return `apikey:${apiKeyId}`;
  }

  private sessionRoom(tokenHash: string): string {
    return `session:${tokenHash}`;
  }

  /** The internal bus never breaks a socket hook. */
  private emitInternal(event: string, payload: Record<string, unknown>): void {
    try {
      this.eventEmitter.emit(event, payload);
    } catch (e) {
      this.logger.warn(`Failed to emit '${event}': ${clean((e as Error)?.message ?? e)}`);
    }
  }

  // Emit QR code update (frontend: socket.on('qr:update', data)). A QR links a phone to the profile: only the owners
  // and admins in the profile's room get it, by their role now, not when they joined, and on an API key only with
  // profiles:write (handleJoin).
  async emitQrUpdate(profileId: string, qrCode: string): Promise<void> {
    try {
      const sockets = await this.server.in(`profile:${profileId}`).fetchSockets();
      const userIds = [...new Set(sockets.map((s) => s.data?.qrUserId).filter((id): id is string => typeof id === 'string'))];
      if (userIds.length === 0) return;
      const admins = new Set(
        (await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true, role: { in: [...ADMIN_ROLES] } }, select: { id: true } })).map((u) => u.id),
      );
      this.logger.log(`Emitting qr:update for profile: ${clean(profileId)}`);
      for (const s of sockets) if (admins.has(s.data?.qrUserId)) s.emit('qr:update', { profileId, qrCode });
    } catch (e) {
      this.logger.warn(`Failed to emit 'qr:update': ${clean((e as Error)?.message ?? e)}`);
    }
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
