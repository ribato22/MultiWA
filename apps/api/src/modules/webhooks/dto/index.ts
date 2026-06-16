// MultiWA Gateway - Webhooks DTOs
// apps/api/src/modules/webhooks/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsObject, IsOptional, IsNotEmpty, IsUrl, IsBoolean, ArrayNotEmpty } from 'class-validator';
import { AppEvents } from '../../../common/app-events';

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

// Event types for documentation. Keys are bound to the canonical AppEvents
// constants so this map and the event bus cannot drift apart.
export const WebhookEvents = {
  // Message events
  [AppEvents.MESSAGE.RECEIVED]: 'Incoming message received',
  [AppEvents.MESSAGE.SENT]: 'Outgoing message sent',
  [AppEvents.MESSAGE.DELIVERED]: 'Message delivered to recipient',
  [AppEvents.MESSAGE.READ]: 'Message read by recipient',
  [AppEvents.MESSAGE.FAILED]: 'Message delivery failed',

  // Connection events
  [AppEvents.CONNECTION.UPDATE]: 'Connection status changed',
  [AppEvents.CONNECTION.QR]: 'QR code generated',
  [AppEvents.CONNECTION.READY]: 'WhatsApp connected',
  [AppEvents.CONNECTION.DISCONNECTED]: 'WhatsApp disconnected',

  // Group events
  [AppEvents.GROUP.JOIN]: 'Bot added to group',
  [AppEvents.GROUP.LEAVE]: 'Bot removed from group',
  [AppEvents.GROUP.MESSAGE]: 'Message received in group',

  // Contact events
  [AppEvents.CONTACT.UPDATE]: 'Contact information updated',

  // Other
  test: 'Test webhook delivery',
} as const;

