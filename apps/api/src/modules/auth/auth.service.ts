// MultiWA Gateway API - Auth Service
// apps/api/src/modules/auth/auth.service.ts

import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { prisma } from '@multiwa/database';
import { LoginDto, RegisterDto, TokenResponseDto } from './dto';
import { TwoFactorService } from './two-factor.service';
import { SessionsService } from './sessions.service';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly twoFactorService: TwoFactorService,
    private readonly sessionsService: SessionsService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenResponseDto> {
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Create organization and user
    const organization = await prisma.organization.create({
      data: {
        name: dto.organizationName,
        slug: this.generateSlug(dto.organizationName),
      },
    });

    // Create default workspace
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: organization.id,
        name: 'Default',
        slug: 'default',
      },
    });

    await prisma.account.create({
      data: {
        workspaceId: workspace.id,
        name: 'Default Account',
        description: 'Automatically created for WhatsApp profiles',
        settings: {},
      },
    });

    // Create user
    const passwordHash = await this.hashPassword(dto.password);
    const user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: 'owner',
      },
    });

    return this.generateTokens(user);
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<TokenResponseDto | { requires2FA: true; userId: string }> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
      include: { organization: true },
    });

    if (!user || !await this.verifyPassword(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      return { requires2FA: true, userId: user.id };
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokens(user, { ipAddress, userAgent });
  }

  /**
   * Complete login with 2FA verification.
   */
  async loginWith2FA(
    userId: string,
    token: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
    const isValid = await this.twoFactorService.verifyTwoFactor(userId, token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid two-factor authentication code');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user) throw new UnauthorizedException('User not found');

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokens(user, { ipAddress, userAgent });
  }

  async refreshToken(refreshToken: string): Promise<TokenResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid token');
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /**
   * Logout — revoke current session.
   */
  async logout(accessToken: string): Promise<void> {
    await this.sessionsService.removeSessionByToken(accessToken);
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { passwordHash, twoFactorSecret, backupCodes, ...profile } = user;
    return {
      ...profile,
      twoFactorEnabled: user.twoFactorEnabled,
      backupCodesRemaining: user.twoFactorEnabled ? (backupCodes?.length ?? 0) : 0,
    };
  }

  async getPreferences(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user.preferences || {};
  }

  async updatePreferences(userId: string, preferences: Record<string, any>) {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences },
    });
    return { success: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const isValid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) throw new BadRequestException('Current password is incorrect');

    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const newHash = await this.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    return { success: true };
  }

  async deleteAccount(userId: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const isValid = await this.verifyPassword(password, user.passwordHash);
    if (!isValid) throw new BadRequestException('Password is incorrect');

    // If user is org owner, delete the entire organization (cascades)
    if (user.role === 'owner') {
      await prisma.organization.delete({ where: { id: user.organizationId } });
    } else {
      await prisma.user.delete({ where: { id: userId } });
    }

    return { success: true };
  }

  private async generateTokens(
    user: any,
    sessionContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<TokenResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '30d' });

    // Every issued access token is bound to a server-side session so logout and
    // session revocation actually invalidate it (JwtStrategy checks the session
    // on each request). Centralized here so no issuance path can forget it.
    await this.sessionsService.createSession(
      user.id,
      accessToken,
      sessionContext?.ipAddress,
      sessionContext?.userAgent,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 604800, // 7 days
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    // Support bcrypt hashes (start with $2b$, $2a$, $2y$)
    if (storedHash.startsWith('$2')) {
      return bcrypt.compare(password, storedHash);
    }
    // Legacy PBKDF2 format (salt:hash)
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      + '-' + crypto.randomBytes(4).toString('hex');
  }
}
