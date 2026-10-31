// MultiWA Gateway - Webhooks DTOs
// apps/api/src/modules/webhooks/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsObject, IsOptional, IsNotEmpty, IsUrl, IsBoolean, ArrayNotEmpty } from 'class-validator';
import { AppEvents, type AppEventName } from '@multiwa/core';

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
// constants, and `satisfies` makes the type check fail for an event that has no
// entry here (or an entry that is no event), so this map and the event bus
// cannot drift apart. `test` is the one name that is not an AppEvent.
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

  // Call events
  [AppEvents.CALL.RECEIVED]: 'Incoming call started ringing',
  [AppEvents.CALL.ANSWERED]: 'Incoming call answered by an agent in the dashboard',
  [AppEvents.CALL.REJECTED]: 'Incoming call rejected (automatically, by an agent, or on the phone)',
  [AppEvents.CALL.ENDED]: 'Incoming call stopped ringing without being rejected (missed, or answered on another device), or a call answered in the dashboard ended',
  [AppEvents.CALL.UPDATED]: 'Call changed after it stopped ringing (late outcome, follow-up or assignee)',
  [AppEvents.CALL.RECORDING_DELETED]: "A call's recording was deleted: by an admin, or at the end of its profile's retention period",

  // Other
  test: 'Test webhook delivery',
} as const satisfies Record<AppEventName | 'test', string>;

