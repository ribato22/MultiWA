// MultiWA Gateway - Autoreply DTOs
// apps/api/src/modules/autoreply/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Quick Reply (preset response)
export class QuickReplyDto {
  @ApiProperty({ example: 'profile-uuid' })
  profileId: string;

  @ApiProperty({ example: '/greeting', description: 'Shortcut command' })
  shortcut: string;

  @ApiProperty({ example: 'Greeting Message' })
  title: string;

  @ApiProperty({ example: 'Hello! How can I help you today?' })
  message: string;
}

// Simple Keyword Autoreply
export class CreateAutoreplyDto {
  @ApiProperty({ example: 'profile-uuid' })
  profileId: string;

  @ApiProperty({ 
    example: ['halo', 'hello', 'hi'],
    description: 'Keywords that trigger this reply'
  })
  keywords: string[];

  @ApiPropertyOptional({ 
    example: 'contains',
    enum: ['exact', 'contains', 'startsWith']
  })
  matchMode?: string;

  @ApiProperty({ 
    example: 'Hello {{name}}! Welcome to our store. How can I help you?',
    description: 'Response message (supports {{name}}, {{phone}}, {{time}} variables)'
  })
  response: string;

  @ApiPropertyOptional({ example: true })
  isActive?: boolean;

  @ApiPropertyOptional({ 
    example: true,
    description: 'Only trigger in private chats (not groups)'
  })
  privateOnly?: boolean;

  @ApiPropertyOptional({ 
    example: 60,
    description: 'Cooldown in seconds per contact'
  })
  cooldownSecs?: number;
}

export class UpdateAutoreplyDto {
  @ApiPropertyOptional()
  keywords?: string[];

  @ApiPropertyOptional()
  matchMode?: string;

  @ApiPropertyOptional()
  response?: string;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiPropertyOptional()
  privateOnly?: boolean;

  @ApiPropertyOptional()
  cooldownSecs?: number;
}
