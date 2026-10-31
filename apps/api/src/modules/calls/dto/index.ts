// MultiWA Gateway - Calls DTOs
// apps/api/src/modules/calls/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { isWhatsAppRecipient } from '@multiwa/core';
import { CALL_FOLLOW_UPS, CALL_OUTCOMES } from '@multiwa/engine-runtime';
import { IsWhatsAppRecipient } from '../../../common/validators/is-whatsapp-recipient.validator';

/** Largest page of GET /calls; CallsService clamps to the same. */
export const CALLS_MAX_LIMIT = 100;

/**
 * A `from` filter as calls are stored (see resolveChatJid): a JID stays as it is, except the whatsapp-web.js
 * `@c.us`, which is stored as `@s.whatsapp.net`; a phone number becomes `<digits>@s.whatsapp.net`, a local `0`
 * prefix read as the country code like in a send (MessagesService.normalizeJid). Anything that is not a WhatsApp
 * recipient is left alone for the validator to refuse.
 */
function toCallerJid(value: unknown): unknown {
  if (typeof value !== 'string' || !isWhatsAppRecipient(value)) return value;
  const from = value.trim();
  if (from.includes('@')) return from.replace(/@c\.us$/, '@s.whatsapp.net');
  const digits = from.replace(/\D/g, '');
  return `${digits.startsWith('0') ? `62${digits.slice(1)}` : digits}@s.whatsapp.net`;
}

export class ListCallsQueryDto {
  @ApiProperty({ description: 'Profile whose calls are listed.' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiPropertyOptional({ enum: [...CALL_OUTCOMES] })
  @IsOptional()
  @IsIn([...CALL_OUTCOMES])
  outcome?: string;

  @ApiPropertyOptional({ enum: [...CALL_FOLLOW_UPS] })
  @IsOptional()
  @IsIn([...CALL_FOLLOW_UPS])
  followUp?: string;

  @ApiPropertyOptional({
    description: 'Caller: an exact JID, or a phone number (digits; `+`, spaces and dashes allowed; a local `0` prefix is read as the country code `62`), matched as `<digits>@s.whatsapp.net`.',
    example: '628111000111',
  })
  @Transform(({ value }) => toCallerJid(value))
  @IsOptional()
  @IsWhatsAppRecipient()
  from?: string;

  @ApiPropertyOptional({ description: 'Only calls that started at or after this ISO 8601 date.', example: '2026-10-26T00:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: CALLS_MAX_LIMIT, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CALLS_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor of the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class UpdateCallDto {
  @ApiPropertyOptional({ enum: [...CALL_FOLLOW_UPS] })
  @IsOptional()
  @IsIn([...CALL_FOLLOW_UPS])
  followUp?: string;

  @ApiPropertyOptional({ nullable: true, description: 'User id of the organization; null to unassign.' })
  @IsOptional()
  @IsString()
  assignedUserId?: string | null;
}

export class ReplyCallDto {
  @ApiPropertyOptional({ description: "Text sent to the caller. Default: the profile's callReplyMessage." })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;
}

export class CallLinkDto {
  @ApiProperty({ enum: ['voice', 'video'] })
  @IsIn(['voice', 'video'])
  type: 'voice' | 'video';

  @ApiPropertyOptional({ description: 'Optional text sent above the link.' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;
}

export class UpdateCallSettingsDto {
  @ApiProperty({
    description:
      "Ring the organization's agents in the dashboard when this profile gets a call, and let them answer it there. " +
      'Turning it on needs the profile to be ready (409 with the reasons otherwise).',
  })
  // The value as sent: the API-wide pipe converts implicitly, and Boolean('false') is true.
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  answerInDashboard: boolean;
}
