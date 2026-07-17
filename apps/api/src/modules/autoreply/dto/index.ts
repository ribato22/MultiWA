// MultiWA Gateway - Autoreply DTOs
// apps/api/src/modules/autoreply/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

// Quick Reply (preset response)
export class QuickReplyDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  profileId: string;

  @ApiProperty({ example: '/greeting', description: 'Shortcut command' })
  @IsString()
  shortcut: string;

  @ApiProperty({ example: 'Greeting Message' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'Hello! How can I help you today?' })
  @IsString()
  message: string;
}

// Simple Keyword Autoreply
export class CreateAutoreplyDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  profileId: string;

  @ApiProperty({
    example: ['halo', 'hello', 'hi'],
    description: 'Keywords that trigger this reply',
  })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional({
    example: 'contains',
    enum: ['exact', 'contains', 'startsWith'],
  })
  @IsOptional()
  @IsIn(['exact', 'contains', 'startsWith'])
  matchMode?: string;

  @ApiProperty({
    example: 'Hello {{name}}! Welcome to our store. How can I help you?',
    description: 'Response message (supports {{name}}, {{phone}}, {{time}} variables)',
  })
  @IsString()
  response: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Only trigger in private chats (not groups)',
  })
  @IsOptional()
  @IsBoolean()
  privateOnly?: boolean;

  @ApiPropertyOptional({
    example: 60,
    description: 'Cooldown in seconds per contact',
  })
  @IsOptional()
  @IsInt()
  cooldownSecs?: number;
}

export class UpdateAutoreplyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['exact', 'contains', 'startsWith'])
  matchMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  response?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  privateOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  cooldownSecs?: number;
}
