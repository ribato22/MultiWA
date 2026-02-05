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

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: [
      'http://localhost:3001',
      'http://localhost:3001',
      'http://localhost:3000',
    ],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  // Track connected clients by profile ID
  private clients: Map<string, Set<string>> = new Map();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected to /ws namespace: ${client.id}`);
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

  // Handle 'join' event from frontend (matches frontend: socket.emit('join', { profileId }))
  @SubscribeMessage('join')
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { profileId: string },
  ) {
    const { profileId } = data;
    this.logger.log(`Client ${client.id} joining profile room: ${profileId}`);
    
    client.join(`profile:${profileId}`);
    
    if (!this.clients.has(profileId)) {
      this.clients.set(profileId, new Set());
    }
    this.clients.get(profileId)!.add(client.id);
    
    return { success: true, profileId };
  }

  @SubscribeMessage('subscribe:profile')
  handleSubscribeProfile(
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

  // Emit QR code update (matches frontend: socket.on('qr:update', data))
  emitQrUpdate(profileId: string, qrCode: string) {
    this.logger.log(`Emitting qr:update for profile: ${profileId}`);
    this.server.to(`profile:${profileId}`).emit('qr:update', { profileId, qrCode });
  }

  // Emit connection status (matches frontend: socket.on('connection:status', data))
  emitConnectionStatus(profileId: string, status: string, phoneNumber?: string) {
    this.logger.log(`Emitting connection:status '${status}' for profile: ${profileId}`);
    this.server.to(`profile:${profileId}`).emit('connection:status', { 
      profileId, 
      status,
      phoneNumber,
    });
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
