// MultiWA Gateway - Webhooks DTOs
// apps/api/src/modules/webhooks/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsObject, IsOptional, IsNotEmpty, IsUrl, IsBoolean, ArrayNotEmpty } from 'class-validator';

export class CreateWebhookDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  url: string;

  @ApiProperty({ 
    example: ['message.received', 'message.sent', 'connection.update'],
    description: 'Events to subscribe to'
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];

  @ApiPropertyOptional({ 
    example: { 'Authorization': 'Bearer token' },
    description: 'Custom headers to send'
  })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

export class UpdateWebhookDto {
  @ApiPropertyOptional({ example: 'https://example.com/webhook' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// Event types for documentation
export const WebhookEvents = {
  // Message events
  'message.received': 'Incoming message received',
  'message.sent': 'Outgoing message sent',
  'message.delivered': 'Message delivered to recipient',
  'message.read': 'Message read by recipient',
  'message.failed': 'Message delivery failed',
  
  // Connection events
  'connection.update': 'Connection status changed',
  'connection.qr': 'QR code generated',
  'connection.ready': 'WhatsApp connected',
  'connection.disconnected': 'WhatsApp disconnected',
  
  // Group events
  'group.join': 'Bot added to group',
  'group.leave': 'Bot removed from group',
  'group.message': 'Message received in group',
  
  // Contact events
  'contact.update': 'Contact information updated',
  
  // Other
  'test': 'Test webhook delivery',
} as const;

