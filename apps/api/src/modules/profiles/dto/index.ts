// MultiWA Gateway API - Profile DTOs
// apps/api/src/modules/profiles/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsEnum, IsInt, IsBoolean, Min } from 'class-validator';

export enum EngineType {
  WHATSAPP_WEB_JS = 'whatsapp-web-js',
  BAILEYS = 'baileys',
  MOCK = 'mock',
}

const ENGINE_DESC =
  'WhatsApp engine for this profile. whatsapp-web-js (default, production) | baileys (EXPERIMENTAL: sendReaction is a no-op stub, getContacts may be unavailable) | mock (testing only). Engine changes take effect on next reconnect.';

export class CreateProfileDto {
  @ApiProperty({ example: 'uuid-of-workspace' })
  @IsString()
  workspaceId: string;

  @ApiProperty({ example: 'Main WhatsApp' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: EngineType, default: EngineType.WHATSAPP_WEB_JS, description: ENGINE_DESC })
  @IsOptional()
  @IsEnum(EngineType)
  engine?: EngineType;

  @ApiPropertyOptional({ example: 'https://webhook.site/xxx' })
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Updated Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: EngineType, description: ENGINE_DESC })
  @IsOptional()
  @IsEnum(EngineType)
  engine?: EngineType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @ApiPropertyOptional({ description: 'Auto-reject incoming voice/video calls for this profile.' })
  @IsOptional()
  @IsBoolean()
  autoRejectCalls?: boolean;

  @ApiPropertyOptional({ description: 'Optional message sent to the caller after auto-rejecting a call. Blank = reject silently.' })
  @IsOptional()
  @IsString()
  autoRejectCallMessage?: string;

  @ApiPropertyOptional({
    example: 1500,
    description: 'Minimum delay (ms) enforced between outbound messages for this profile (anti-ban pacing).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  messageDelayMs?: number;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Daily outbound message cap for this profile. Omit/null = unlimited. When reached, sends are rejected with HTTP 429.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyMessageLimit?: number | null;

  @ApiPropertyOptional({
    example: 3000,
    description: 'Max extra random milliseconds added on top of messageDelayMs per send (anti-ban jitter). 0 = fixed spacing. Actual delay is always >= messageDelayMs.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  messageDelayJitterMs?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Enable the warm-up ramp: the effective daily cap climbs from warmupStartPerDay to dailyMessageLimit over warmupRampDays days. Requires dailyMessageLimit to be set.',
  })
  @IsOptional()
  @IsBoolean()
  warmupEnabled?: boolean;

  @ApiPropertyOptional({
    example: 20,
    description: 'Starting daily cap on day 0 of the warm-up ramp.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warmupStartPerDay?: number | null;

  @ApiPropertyOptional({
    example: 14,
    description: 'Number of days for the warm-up ramp to climb from warmupStartPerDay to the daily limit.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warmupRampDays?: number | null;

  @ApiPropertyOptional({
    example: 24,
    description: 'Customer-service window (hours). A send is a "reply" (unthrottled) if the recipient messaged within this window; otherwise it is "cold".',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  serviceWindowHours?: number;

  @ApiPropertyOptional({
    example: 250,
    description: 'Daily cap for COLD (business-initiated / out-of-window) sends only — replies are not counted against it. Omit to fall back to dailyMessageLimit, then a conservative default.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  coldDailyLimit?: number | null;
}
