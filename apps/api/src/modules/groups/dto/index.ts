// MultiWA Gateway - Groups DTO
// apps/api/src/modules/groups/dto/index.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsArray, IsOptional, ArrayMinSize } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ example: 'Family Group' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ 
    example: ['6281234567890', '6289876543210'],
    description: 'Phone numbers to add as initial participants'
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  participants: string[];

  @ApiPropertyOptional({ example: 'Our family chat group' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class AddParticipantsDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ 
    example: ['6281234567890', '6289876543210'],
    description: 'Phone numbers to add to the group'
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  participants: string[];
}

export class RemoveParticipantsDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ 
    example: ['6281234567890'],
    description: 'Phone numbers to remove from the group'
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  participants: string[];
}

export class UpdateGroupDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiPropertyOptional({ example: 'New Group Name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;
}

export class PromoteParticipantsDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ 
    example: ['6281234567890'],
    description: 'Phone numbers to promote to admin'
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  participants: string[];
}

export class DemoteParticipantsDto {
  @ApiProperty({ example: 'profile-123' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ 
    example: ['6281234567890'],
    description: 'Phone numbers to demote from admin'
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  participants: string[];
}
