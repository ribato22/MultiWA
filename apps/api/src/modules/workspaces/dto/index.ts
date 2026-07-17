// MultiWA Gateway - Workspaces DTOs
// apps/api/src/modules/workspaces/dto/index.ts
//
// Replaces `@Body() dto: any`. All-optional + typed (no client-breakage). The
// organizationId is taken from the authenticated principal in the controller.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Marketing' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'marketing', description: 'URL slug (auto-generated from name if omitted)' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateWorkspaceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
