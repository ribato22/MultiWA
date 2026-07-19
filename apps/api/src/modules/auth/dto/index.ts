// MultiWA Gateway API - Auth DTOs
// apps/api/src/modules/auth/dto/index.ts

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'ChangeMe1234!' })
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'My Company' })
  @IsString()
  organizationName: string;
}

export class TokenResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ example: 604800 })
  expiresIn: number;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string;
  };
}
