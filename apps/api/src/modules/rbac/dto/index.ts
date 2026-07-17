// MultiWA Gateway - RBAC DTOs
// apps/api/src/modules/rbac/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  // Always overwritten from the authenticated principal in the controller — never
  // trusted from the client, so validation is optional (the controller sets it before use).
  @ApiPropertyOptional({ example: 'org-uuid' })
  @IsOptional()
  @IsString()
  organizationId: string;

  @ApiProperty({ example: 'Support Agent' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Can view and send messages only' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    example: ['message:send', 'message:read', 'contact:read'],
    description: 'List of permission keys',
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class AssignRoleDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'role-uuid' })
  @IsString()
  roleId: string;
}
