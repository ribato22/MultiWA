// MultiWA Gateway - Automation DTOs
// apps/api/src/modules/automation/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty, IsBoolean, IsArray, IsObject, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Trigger configuration types
export class KeywordTriggerConfig {
  @ApiProperty({ example: ['halo', 'hello', 'hi'] })
  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @ApiPropertyOptional({ 
    example: 'contains',
    enum: ['exact', 'contains', 'startsWith', 'endsWith', 'word']
  })
  @IsOptional()
  @IsString()
  matchMode?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  caseSensitive?: boolean;
}

export class RegexTriggerConfig {
  @ApiProperty({ example: '^(order|pesan)\\s+(.+)$' })
  @IsString()
  @IsNotEmpty()
  pattern: string;

  @ApiPropertyOptional({ example: 'i' })
  @IsOptional()
  @IsString()
  flags?: string;
}

// Condition types
export class AutomationCondition {
  @ApiProperty({ 
    example: 'is_group',
    enum: ['is_group', 'not_group', 'is_private', 'message_type', 'time_range', 'day_of_week', 'contact_tag', 'match_text']
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ description: 'Condition value (varies by type)' })
  @IsOptional()
  value?: any;

  @ApiPropertyOptional({ description: 'Condition field (e.g. message.text)' })
  @IsOptional()
  @IsString()
  field?: string;

  @ApiPropertyOptional({ description: 'Condition operator (e.g. contains, equals)' })
  @IsOptional()
  @IsString()
  operator?: string;

  @ApiPropertyOptional({ example: ['customer', 'vip'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: 9 })
  @IsOptional()
  @IsNumber()
  startHour?: number;

  @ApiPropertyOptional({ example: 17 })
  @IsOptional()
  @IsNumber()
  endHour?: number;

  @ApiPropertyOptional({ example: [1, 2, 3, 4, 5] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  days?: number[];
}

// Action types
export class AutomationAction {
  @ApiProperty({ 
    example: 'reply',
    enum: ['reply', 'send_image', 'send_video', 'send_audio', 'send_document', 'send_poll', 'send_location', 'send_contact', 'add_tag', 'remove_tag', 'webhook', 'assign_agent', 'ai_reply', 'delay', 'stop_processing']
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  // For reply / send_text action
  @ApiPropertyOptional({ example: 'Hello {{name}}! Thanks for contacting us.' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ example: 'text' })
  @IsOptional()
  @IsString()
  messageType?: string;

  // For media actions (send_image, send_document)
  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded file content' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ example: 'Check out this image!' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ example: 'report.pdf' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  // For send_poll action
  @ApiPropertyOptional({ example: 'What do you prefer?' })
  @IsOptional()
  @IsString()
  question?: string;

  @ApiPropertyOptional({ example: ['Option A', 'Option B', 'Option C'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  // For tag actions
  @ApiPropertyOptional({ example: ['contacted', 'lead'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // For webhook action
  @ApiPropertyOptional({ example: 'POST' })
  @IsOptional()
  @IsString()
  method?: string;

  // For ai_reply action
  @ApiPropertyOptional({ example: 'You are a helpful customer service assistant.' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  // For assign_agent action
  @ApiPropertyOptional({ example: 'user-uuid' })
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  // For delay action
  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  seconds?: number;

  // For send_audio action
  @ApiPropertyOptional({ example: false, description: 'Push to talk (voice note)' })
  @IsOptional()
  @IsBoolean()
  ptt?: boolean;

  // For send_location action
  @ApiPropertyOptional({ example: -6.2088 })
  @IsOptional()
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 106.8456 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Head Office' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Jl. Example No. 1, Jakarta' })
  @IsOptional()
  @IsString()
  address?: string;

  // For send_contact action
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: '628123456789' })
  @IsOptional()
  @IsString()
  contactPhone?: string;
}

// Main DTOs
export class CreateAutomationDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: 'Welcome Message' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ 
    example: 'keyword',
    enum: ['keyword', 'regex', 'new_contact', 'message_type', 'all', 'webhook', 'schedule']
  })
  @IsString()
  @IsNotEmpty()
  triggerType: string;

  @ApiProperty({ 
    example: { keywords: ['halo', 'hi'], matchMode: 'contains' },
    description: 'Trigger configuration (varies by triggerType)'
  })
  @IsObject()
  triggerConfig: any;

  @ApiPropertyOptional({ type: [AutomationCondition] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationCondition)
  conditions?: AutomationCondition[];

  @ApiProperty({ type: [AutomationAction] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationAction)
  actions: AutomationAction[];

  @ApiPropertyOptional({ example: 60, description: 'Cooldown in seconds between triggers per contact' })
  @IsOptional()
  @IsNumber()
  cooldownSecs?: number;

  @ApiPropertyOptional({ example: 100, description: 'Maximum triggers per day' })
  @IsOptional()
  @IsNumber()
  maxTriggersPerDay?: number;
}

export class UpdateAutomationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  triggerType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  triggerConfig?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationCondition)
  conditions?: AutomationCondition[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationAction)
  actions?: AutomationAction[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cooldownSecs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  maxTriggersPerDay?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  priority?: number;
}

export class TestAutomationDto {
  @ApiProperty({ example: 'Halo, saya mau order makanan' })
  @IsString()
  @IsNotEmpty()
  message: string;
}
