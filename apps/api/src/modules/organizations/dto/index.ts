// MultiWA Gateway - Organizations DTOs
// apps/api/src/modules/organizations/dto/index.ts
//
// Replaces `@Body() dto: any` / inline body types. The org id is taken from the
// authenticated principal in the controller, never from the body.

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'PLN Batam' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}

export class AddMemberDto {
  @ApiProperty({ example: 'agent@plnbatam.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Budi Santoso' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'agent' })
  @IsOptional()
  @IsString()
  role?: string;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  role: string;
}
