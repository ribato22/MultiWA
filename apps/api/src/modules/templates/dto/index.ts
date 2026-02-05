// MultiWA Gateway - Templates DTOs
// apps/api/src/modules/templates/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsObject, IsEnum } from 'class-validator';

export class CreateTemplateDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: 'Welcome Message' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ 
    example: 'marketing',
    enum: ['marketing', 'utility', 'notification', 'other']
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ 
    example: 'text',
    enum: ['text', 'image', 'video', 'document']
  })
  @IsString()
  @IsNotEmpty()
  messageType: string;

  @ApiProperty({ 
    example: { text: 'Hello {{name}}! Welcome to {{company}}.' },
    description: 'Template content with {{variable}} placeholders'
  })
  @IsObject()
  content: any;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  content?: any;
}

export class PreviewTemplateDto {
  @ApiProperty({ 
    example: { name: 'John', company: 'Acme Inc' },
    description: 'Variables to replace in template'
  })
  @IsObject()
  variables: Record<string, string>;
}

