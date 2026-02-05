// MultiWA Gateway - WebSocket Real-time Gateway
// apps/api/src/modules/websocket/realtime.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsApiKeyGuard } from '../auth/guards/ws-api-key.guard';

export interface SubscribePayload {
  sessionId?: string;
  profileId?: string;
  events: string[];
}

export interface EventPayload {
  event: string;
  sessionId?: string;
  profileId?: string;
  data: any;
  timestamp: string;
}

export interface WsMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping' | 'pong' | 'event' | 'error' | 'ack';
  payload?: any;
  requestId?: string;
}

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  
  // Client subscriptions: clientId -> { profileId, events[] }
  private subscriptions: Map<string, { profileId: string; events: Set<string> }> = new Map();
  
  // Profile connections: profileId -> Set of clientIds
  private profileClients: Map<string, Set<string>> = new Map();

  handleConnection(client: Socket) {
    const apiKey = client.handshake.query.apiKey as string;
    this.logger.log(`Client connected: ${client.id}, API Key: ${apiKey ? 'provided' : 'missing'}`);
    
    // Send connection acknowledgment
    this.sendMessage(client, {
      type: 'ack',
      payload: {
        message: 'Connected to MultiWA WebSocket API',
        clientId: client.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Clean up subscriptions
    const subscription = this.subscriptions.get(client.id);
    if (subscription) {
      const clients = this.profileClients.get(subscription.profileId);
      if (clients) {
        clients.delete(client.id);
        if (clients.size === 0) {
          this.profileClients.delete(subscription.profileId);
        }
      }
      this.subscriptions.delete(client.id);
    }
  }

  @SubscribeMessage('message')
  handleMessage(@MessageBody() message: WsMessage, @ConnectedSocket() client: Socket): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(client, message.payload, message.requestId);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(client, message.requestId);
        break;
      case 'ping':
        this.handlePing(client, message.requestId);
        break;
      default:
        this.sendError(client, 'Unknown message type', message.requestId);
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribeEvent(@MessageBody() payload: SubscribePayload, @ConnectedSocket() client: Socket): void {
    this.handleSubscribe(client, payload);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribeEvent(@ConnectedSocket() client: Socket): void {
    this.handleUnsubscribe(client);
  }

  @SubscribeMessage('ping')
  handlePingEvent(@ConnectedSocket() client: Socket): void {
    this.handlePing(client);
  }

  private handleSubscribe(client: Socket, payload: SubscribePayload, requestId?: string): void {
    if (!payload || !payload.events || payload.events.length === 0) {
      this.sendError(client, 'Events array is required', requestId);
      return;
    }

    const profileId = payload.profileId || payload.sessionId;
    if (!profileId) {
      this.sendError(client, 'profileId or sessionId is required', requestId);
      return;
    }

    // Store subscription
    this.subscriptions.set(client.id, {
      profileId,
      events: new Set(payload.events),
    });

    // Add to profile clients
    if (!this.profileClients.has(profileId)) {
      this.profileClients.set(profileId, new Set());
    }
    this.profileClients.get(profileId)!.add(client.id);

    this.logger.log(`Client ${client.id} subscribed to ${profileId} for events: ${payload.events.join(', ')}`);

    this.sendMessage(client, {
      type: 'ack',
      payload: {
        action: 'subscribed',
        profileId,
        events: payload.events,
      },
      requestId,
    });
  }

  private handleUnsubscribe(client: Socket, requestId?: string): void {
    const subscription = this.subscriptions.get(client.id);
    if (subscription) {
      const clients = this.profileClients.get(subscription.profileId);
      if (clients) {
        clients.delete(client.id);
      }
      this.subscriptions.delete(client.id);
    }

    this.sendMessage(client, {
      type: 'ack',
      payload: { action: 'unsubscribed' },
      requestId,
    });
  }

  private handlePing(client: Socket, requestId?: string): void {
    this.sendMessage(client, {
      type: 'pong',
      payload: { timestamp: new Date().toISOString() },
      requestId,
    });
  }

  /**
   * Emit event to all subscribed clients for a profile
   */
  emitEvent(profileId: string, event: string, data: any): void {
    const clients = this.profileClients.get(profileId);
    if (!clients || clients.size === 0) {
      this.logger.debug(`No clients subscribed to profile ${profileId} for event ${event}`);
      return;
    }

    const eventPayload: EventPayload = {
      event,
      profileId,
      data,
      timestamp: new Date().toISOString(),
    };

    for (const clientId of clients) {
      const subscription = this.subscriptions.get(clientId);
      if (subscription && (subscription.events.has(event) || subscription.events.has('*'))) {
        const client = this.server.sockets.sockets.get(clientId);
        if (client) {
          this.sendMessage(client, {
            type: 'event',
            payload: eventPayload,
          });
        }
      }
    }
  }

  /**
   * Emit QR code update
   */
  emitQrUpdate(profileId: string, qr: string): void {
    this.emitEvent(profileId, 'qr.updated', { qr });
  }

  /**
   * Emit session status change
   */
  emitSessionStatus(profileId: string, status: string, info?: any): void {
    this.emitEvent(profileId, 'session.status', { status, ...info });
  }

  /**
   * Emit message received
   */
  emitMessageReceived(profileId: string, message: any): void {
    this.emitEvent(profileId, 'message.received', message);
  }

  /**
   * Emit message acknowledgment (sent/delivered/read)
   */
  emitMessageAck(profileId: string, messageId: string, ack: number): void {
    const ackMap: Record<number, string> = {
      1: 'sent',
      2: 'delivered',
      3: 'read',
    };
    this.emitEvent(profileId, 'message.ack', { messageId, status: ackMap[ack] || 'unknown', ack });
  }

  /**
   * Broadcast to all clients (admin events)
   */
  broadcast(event: string, data: any): void {
    this.server.emit('event', {
      type: 'event',
      payload: {
        event,
        data,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Emit notification to all connected admin clients
   */
  emitNotification(notification: { id: string; type: string; title: string; body: string; metadata?: any; createdAt: string }): void {
    this.server.emit('notification', {
      type: 'notification',
      payload: notification,
    });
    this.logger.debug(`Notification broadcast: [${notification.type}] ${notification.title}`);
  }

  /**
   * Emit notification to a specific user room
   */
  emitToUser(userId: string, event: string, data: any): void {
    this.server.to(`user:${userId}`).emit(event, {
      type: event,
      payload: data,
    });
  }

  /**
   * Join a user-specific room (for targeted notifications)
   */
  joinUserRoom(clientId: string, userId: string): void {
    const client = this.server.sockets.sockets.get(clientId);
    if (client) {
      client.join(`user:${userId}`);
      this.logger.debug(`Client ${clientId} joined user room: ${userId}`);
    }
  }

  private sendMessage(client: Socket, message: WsMessage): void {
    client.emit('message', message);
  }

  private sendError(client: Socket, error: string, requestId?: string): void {
    this.sendMessage(client, {
      type: 'error',
      payload: { error },
      requestId,
    });
  }
}
