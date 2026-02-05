// MultiWA Gateway - RBAC DTOs
// apps/api/src/modules/rbac/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'org-uuid' })
  organizationId: string;

  @ApiProperty({ example: 'Support Agent' })
  name: string;

  @ApiPropertyOptional({ example: 'Can view and send messages only' })
  description?: string;

  @ApiProperty({ 
    example: ['message:send', 'message:read', 'contact:read'],
    description: 'List of permission keys'
  })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  permissions?: string[];
}

export class AssignRoleDto {
  @ApiProperty({ example: 'user-uuid' })
  userId: string;

  @ApiProperty({ example: 'role-uuid' })
  roleId: string;
}
