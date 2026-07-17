// MultiWA Gateway - Accounts DTOs
// apps/api/src/modules/accounts/dto/index.ts
//
// All fields are optional + typed: this replaces `@Body() dto: any` so the global
// ValidationPipe whitelist strips unknown fields and type-checks the known ones,
// without newly-requiring anything (no client-breakage). Server-derived values
// (workspaceId, userId, engine resolution) stay in the service/controller.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateAccountDto {
  @ApiPropertyOptional({ example: 'Sales Team' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class CreateProfileDto {
  @ApiPropertyOptional({ example: 'Support Line' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ example: '628123456789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '628123456789' })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({ enum: ['whatsapp-web-js', 'baileys', 'mock'] })
  @IsOptional()
  @IsString()
  engine?: string;

  // Free-form; the service reads settings.engine. Kept as-is under whitelist.
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}
