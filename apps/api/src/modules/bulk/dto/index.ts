// MultiWA Gateway - Bulk Messaging DTO
// apps/api/src/modules/bulk/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { 
  IsString, 
  IsNotEmpty, 
  IsArray, 
  IsOptional, 
  IsNumber, 
  IsBoolean,
  IsObject,
  IsEnum,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  Min,
  Max
} from 'class-validator';
import { Type } from 'class-transformer';

export enum BulkMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
}

export class BulkMessageContent {
  @ApiPropertyOptional({ example: 'Hello {name}!' })
  @IsString()
  @IsOptional()
  text?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({ example: 'Check this out, {name}!' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ example: 'report.pdf' })
  @IsString()
  @IsOptional()
  filename?: string;
}

export class BulkMessageItem {
  @ApiProperty({ example: '628123456789@c.us' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ enum: BulkMessageType, example: 'text' })
  @IsEnum(BulkMessageType)
  type: BulkMessageType;

  @ApiProperty({ type: BulkMessageContent })
  @ValidateNested()
  @Type(() => BulkMessageContent)
  content: BulkMessageContent;

  @ApiPropertyOptional({ 
    example: { name: 'John', company: 'Acme Inc' },
    description: 'Variables for template substitution using {variable} syntax'
  })
  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;
}

export class BulkMessageOptions {
  @ApiPropertyOptional({ 
    example: 5000, 
    description: 'Delay between messages in milliseconds (min: 1000)',
    default: 3000
  })
  @IsNumber()
  @Min(1000)
  @Max(60000)
  @IsOptional()
  delayBetweenMessages?: number;

  @ApiPropertyOptional({ 
    example: true, 
    description: 'Add random 0-2s to delay to appear more human',
    default: true
  })
  @IsBoolean()
  @IsOptional()
  randomizeDelay?: boolean;

  @ApiPropertyOptional({ 
    example: false, 
    description: 'Stop the entire batch on first error',
    default: false
  })
  @IsBoolean()
  @IsOptional()
  stopOnError?: boolean;
}

export class SendBulkDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiPropertyOptional({ 
    example: 'batch_custom_123',
    description: 'Custom batch ID (auto-generated if not provided)'
  })
  @IsString()
  @IsOptional()
  batchId?: string;

  @ApiProperty({ 
    type: [BulkMessageItem],
    description: 'Array of messages to send (max 100 per request)'
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkMessageItem)
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  messages: BulkMessageItem[];

  @ApiPropertyOptional({ type: BulkMessageOptions })
  @ValidateNested()
  @Type(() => BulkMessageOptions)
  @IsOptional()
  options?: BulkMessageOptions;
}

export interface BulkBatchStatus {
  batchId: string;
  status: 'queued' | 'processing' | 'completed' | 'cancelled' | 'failed';
  progress: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    cancelled: number;
  };
  results?: Array<{
    chatId: string;
    status: 'sent' | 'failed' | 'pending' | 'cancelled';
    messageId?: string;
    error?: {
      code: string;
      message: string;
    };
  }>;
  startedAt?: Date;
  completedAt?: Date;
  estimatedCompletionTime?: Date;
}
