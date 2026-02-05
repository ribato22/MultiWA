// MultiWA Gateway - Broadcast DTOs
// apps/api/src/modules/broadcast/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class BroadcastRecipients {
  @ApiProperty({ 
    example: 'tags',
    enum: ['tags', 'contacts', 'all'],
    description: 'How to select recipients'
  })
  @IsEnum(['tags', 'contacts', 'all'])
  type: 'tags' | 'contacts' | 'all';

  @ApiProperty({ 
    example: ['customer', 'vip'],
    description: 'Tag names (if type=tags) or contact IDs (if type=contacts)'
  })
  @IsArray()
  @IsString({ each: true })
  value: string[];
}

export class BroadcastSettings {
  @ApiPropertyOptional({ example: 3000, description: 'Minimum delay between messages (ms)' })
  @IsOptional()
  @IsNumber()
  delayMin?: number;

  @ApiPropertyOptional({ example: 10000, description: 'Maximum delay between messages (ms)' })
  @IsOptional()
  @IsNumber()
  delayMax?: number;

  @ApiPropertyOptional({ example: 50, description: 'Messages per batch before pause' })
  @IsOptional()
  @IsNumber()
  batchSize?: number;

  @ApiPropertyOptional({ example: true, description: 'Retry failed messages' })
  @IsOptional()
  retryFailed?: boolean;

  @ApiPropertyOptional({ example: 3, description: 'Number of retry attempts' })
  @IsOptional()
  @IsNumber()
  retryAttempts?: number;
}

export class CreateBroadcastDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: 'February Promo' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ 
    example: { type: 'text', text: 'Hello {{name}}! Check our promo: {{link}}' },
    description: 'Message content (supports template variables)'
  })
  @IsNotEmpty()
  message: any;

  @ApiProperty({ type: BroadcastRecipients })
  @ValidateNested()
  @Type(() => BroadcastRecipients)
  recipients: BroadcastRecipients;

  @ApiPropertyOptional({ type: BroadcastSettings })
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastSettings)
  settings?: BroadcastSettings;
}

export class UpdateBroadcastDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  message?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastRecipients)
  recipients?: BroadcastRecipients;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastSettings)
  settings?: BroadcastSettings;
}

export class ScheduleBroadcastDto {
  @ApiProperty({ 
    example: '2026-02-05T09:00:00Z',
    description: 'When to start the broadcast (ISO 8601)'
  })
  @IsString()
  @IsNotEmpty()
  scheduledAt: string;
}
