// MultiWA Gateway API - Profile DTOs
// apps/api/src/modules/profiles/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsEnum, IsInt, Min } from 'class-validator';

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
}
