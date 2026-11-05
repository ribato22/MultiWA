// MultiWA Gateway API - Customers DTOs
// apps/api/src/modules/customers/dto/index.ts
//
// The bodies' types and limits. CustomersService checks the customer ID and the number itself, so that each is refused
// with one fixed message ("Invalid customer ID", "Invalid phone number"), and trims what it stores.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from '../customer-lookup.service';

export class LinkCustomerDto {
  @ApiProperty({ example: '1234567890', description: "The customer's ID in the organization's system: 1 to 64 of A-Z, a-z, 0-9, '.', '_' and '-'." })
  @IsString()
  externalId: string;

  @ApiProperty({ example: '6281100000001', description: 'A phone number (a leading 0 is read as 62) or the JID of a one-to-one chat. A group cannot be linked.' })
  @IsString()
  phone: string;
}

export class ManualFieldDto {
  @ApiProperty({ example: 'Tarif/Daya', maxLength: 60 })
  @IsString()
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: 'R1 / 1300 VA', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  value: string;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ type: [String], maxItems: 20, description: 'At most 20, of at most 32 characters each; stored trimmed, without repeats.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200, description: 'Only while no lookup is configured (else 409); null clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @ApiPropertyOptional({ type: [ManualFieldDto], maxItems: 20, description: 'Only while no lookup is configured (else 409).' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ManualFieldDto)
  manualFields?: ManualFieldDto[];
}

export class NoteDto {
  @ApiProperty({ example: 'Prefers a call after 16:00', minLength: 1, maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  body: string;
}

export class CustomerConfigDto {
  @ApiPropertyOptional({ example: 'ID Pelanggan', maxLength: 40, description: 'What the customer ID is called. Default: "Customer ID".' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  idLabel?: string;

  @ApiPropertyOptional({ example: 'https://crm.example.com/customers/lookup', description: 'Empty turns the lookup off.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  lookupUrl?: string;

  @ApiPropertyOptional({ description: 'Sent as `Authorization: Bearer <secret>`. Write-only: omitted keeps it, empty clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  // A header value: visible ASCII, without spaces or line breaks.
  @Matches(/^[\x21-\x7e]*$/, { message: 'secret must be visible ASCII characters, without spaces' })
  secret?: string;

  @ApiPropertyOptional({ minimum: MIN_TIMEOUT_MS, maximum: MAX_TIMEOUT_MS, default: DEFAULT_TIMEOUT_MS })
  @IsOptional()
  @IsInt()
  @Min(MIN_TIMEOUT_MS)
  @Max(MAX_TIMEOUT_MS)
  timeoutMs?: number;
}

export class TestLookupDto {
  @ApiProperty({ example: '1234567890' })
  @IsString()
  externalId: string;
}
