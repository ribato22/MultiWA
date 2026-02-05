// MultiWA Gateway - Enhanced Contacts DTOs
// apps/api/src/modules/contacts/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsNotEmpty,
  ValidateNested,
  ArrayNotEmpty,
  IsPhoneNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateContactDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: '6281234567890' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: ['customer', 'vip'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ example: { source: 'website' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateContactDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: '6281234567890' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class ContactImportItem {
  @ApiProperty({ example: '6281234567890' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: ['customer'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ImportContactsDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ type: [ContactImportItem] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ContactImportItem)
  contacts: ContactImportItem[];
}

export class ImportCsvDto {
  @ApiProperty({ example: 'profile-uuid' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ 
    example: 'phone,name,tags\n6281234567890,John Doe,customer;vip\n6287654321098,Jane Doe,prospect',
    description: 'CSV data with header row. Columns: phone (required), name, tags (semicolon-separated)'
  })
  @IsString()
  @IsNotEmpty()
  csvData: string;
}

export class ValidateBulkDto {
  @ApiProperty({ 
    example: ['6281234567890', '08123456789', '+62-812-3456-789'],
    description: 'Array of phone numbers to validate'
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  phones: string[];
}
