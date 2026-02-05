// MultiWA Gateway API - Profile DTOs
// apps/api/src/modules/profiles/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUrl, IsEnum } from 'class-validator';

export enum EngineType {
  WHATSAPP_WEB_JS = 'whatsapp-web-js',
  BAILEYS = 'baileys',
}

export class CreateProfileDto {
  @ApiProperty({ example: 'uuid-of-workspace' })
  @IsString()
  workspaceId: string;

  @ApiProperty({ example: 'Main WhatsApp' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ enum: EngineType, default: EngineType.WHATSAPP_WEB_JS })
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

  @ApiPropertyOptional({ enum: EngineType })
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
}
