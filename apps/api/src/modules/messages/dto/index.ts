// MultiWA Gateway - Enhanced Messages DTOs
// apps/api/src/modules/messages/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

// Base DTO
class BaseMessageDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: '6281234567890', description: 'Phone number or JID' })
  @IsString()
  @IsNotEmpty()
  to: string;
}

// Text message
export class SendTextDto extends BaseMessageDto {
  @ApiProperty({ example: 'Hello, World!' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiPropertyOptional({ description: 'Message ID to quote/reply to' })
  @IsString()
  @IsOptional()
  quotedMessageId?: string;
}

// Image message
export class SendImageDto extends BaseMessageDto {
  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional({ description: 'Base64 encoded image' })
  @IsString()
  @IsOptional()
  base64?: string;

  @ApiPropertyOptional({ example: 'Check this out!' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsString()
  @IsOptional()
  mimetype?: string;
}

// Video message
export class SendVideoDto extends BaseMessageDto {
  @ApiPropertyOptional({ example: 'https://example.com/video.mp4' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  base64?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ example: 'video/mp4' })
  @IsString()
  @IsOptional()
  mimetype?: string;
}

// Audio message
export class SendAudioDto extends BaseMessageDto {
  @ApiPropertyOptional({ example: 'https://example.com/audio.mp3' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  base64?: string;

  @ApiPropertyOptional({ example: 'audio/mpeg' })
  @IsString()
  @IsOptional()
  mimetype?: string;

  @ApiPropertyOptional({ example: true, description: 'Send as voice note (PTT)' })
  @IsBoolean()
  @IsOptional()
  ptt?: boolean;
}

// Document message
export class SendDocumentDto extends BaseMessageDto {
  @ApiPropertyOptional({ example: 'https://example.com/doc.pdf' })
  @IsString()
  @IsOptional()
  url?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  base64?: string;

  @ApiProperty({ example: 'report.pdf' })
  @IsString()
  @IsNotEmpty()
  filename: string;

  @ApiPropertyOptional({ example: 'Here is the document' })
  @IsString()
  @IsOptional()
  caption?: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  @IsString()
  @IsOptional()
  mimetype?: string;
}

// Location message
export class SendLocationDto extends BaseMessageDto {
  @ApiProperty({ example: -6.2088 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: 106.8456 })
  @IsNumber()
  longitude: number;

  @ApiPropertyOptional({ example: 'My Location' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Jl. Example No. 123' })
  @IsString()
  @IsOptional()
  address?: string;
}

// Contact card
export class ContactInfo {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '+6281234567890' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsString()
  @IsOptional()
  email?: string;
}

export class SendContactDto extends BaseMessageDto {
  @ApiProperty({ type: [ContactInfo] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactInfo)
  contacts: ContactInfo[];
}

// Reaction
export class SendReactionDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ description: 'Message ID to react to' })
  @IsString()
  @IsNotEmpty()
  messageId: string;

  @ApiProperty({ example: '👍', description: 'Emoji reaction (empty to remove)' })
  @IsString()
  emoji: string;
}

// Reply
export class SendReplyDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ description: 'Message ID to reply to' })
  @IsString()
  @IsNotEmpty()
  quotedMessageId: string;

  @ApiProperty({ example: 'This is my reply' })
  @IsString()
  @IsNotEmpty()
  text: string;
}

// Poll message
export class SendPollDto extends BaseMessageDto {
  @ApiProperty({ example: 'What is your favorite color?' })
  @IsString()
  @IsNotEmpty()
  question: string;

  @ApiProperty({ example: ['Red', 'Green', 'Blue', 'Yellow'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  options: string[];

  @ApiPropertyOptional({ example: false, description: 'Allow multiple answer selections' })
  @IsBoolean()
  @IsOptional()
  allowMultipleAnswers?: boolean;
}

// Legacy DTO for backward compatibility
export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({ enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'poll'] })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty()
  content: any;
}

// Typing indicator
export class SendTypingDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: '6281234567890', description: 'Phone number or JID' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiProperty({ enum: ['composing', 'recording', 'available'], default: 'composing' })
  @IsString()
  @IsOptional()
  state?: 'composing' | 'recording' | 'available';

  @ApiPropertyOptional({ example: 5000, description: 'Duration in ms before clearing (default: auto)' })
  @IsNumber()
  @IsOptional()
  duration?: number;
}

// Mark as read
export class MarkAsReadDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: '6281234567890', description: 'Chat JID or phone number' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiPropertyOptional({ description: 'Specific message IDs to mark as read (omit for entire chat)', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  messageIds?: string[];
}

// Delete message from WhatsApp
export class DeleteForEveryoneDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: '6281234567890', description: 'Chat JID or phone number' })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({ description: 'WhatsApp message ID to delete' })
  @IsString()
  @IsNotEmpty()
  messageId: string;
}

// Schedule message
export class ScheduleMessageDto extends BaseMessageDto {
  @ApiProperty({ example: 'text', enum: ['text', 'image', 'video', 'audio', 'document'] })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'Message content (text, media options, etc.)' })
  content: any;

  @ApiProperty({ example: '2026-03-01T10:00:00Z', description: 'ISO 8601 datetime to send' })
  @IsString()
  @IsNotEmpty()
  scheduledAt: string;
}

