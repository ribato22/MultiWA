// MultiWA Gateway API - Auth Service
// apps/api/src/modules/auth/auth.service.ts

import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
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
    private readonly config: ConfigService,
  ) {}

  // Refresh tokens are signed/verified with a SEPARATE secret from access tokens
  // (JWT_REFRESH_SECRET, validated at boot in main.ts). This cryptographically
  // isolates the two token classes: a leaked access-token secret cannot forge a
  // refresh token (and vice versa), and a refresh token cannot be replayed as an
  // access token — JwtStrategy verifies access tokens with JWT_SECRET only.
  private get refreshSecret(): string {
    return this.config.get<string>('JWT_REFRESH_SECRET') as string;
  }

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
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(refreshToken, { secret: this.refreshSecret });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Unknown token — not in the store (e.g. issued before rotation existed, or
    // forged). Reject; the holder re-authenticates once.
    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse of an already-rotated token → someone is replaying an old token.
    // Revoke the whole family so neither the attacker nor the victim can refresh.
    if (stored.revokedAt) {
      await this.revokeFamily(stored.family);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      await this.revokeFamily(stored.family);
      throw new UnauthorizedException('Invalid token');
    }

    // Rotate: revoke the presented token, mint a new pair in the SAME family.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.generateTokens(
      user,
      { ipAddress: stored.ipAddress ?? undefined, userAgent: stored.userAgent ?? undefined },
      stored.family,
    );
  }

  /**
   * Logout — revoke the current access session AND the user's refresh tokens, so
   * a logged-out client cannot mint new access tokens via /auth/refresh.
   */
  async logout(accessToken: string): Promise<void> {
    await this.sessionsService.removeSessionByToken(accessToken);
    // decode (unverified) is enough — the caller was already authenticated to
    // reach logout; a garbage token decodes to null and no-ops.
    const payload = this.jwtService.decode(accessToken) as { sub?: string } | null;
    if (payload?.sub) {
      await prisma.refreshToken.updateMany({
        where: { userId: payload.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { passwordHash: _passwordHash, twoFactorSecret: _twoFactorSecret, backupCodes, ...profile } = user;
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

    if (newPassword.length < 12) {
      throw new BadRequestException('New password must be at least 12 characters');
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
    // Rotation lineage. Fresh logins start a new family; /auth/refresh reuses the
    // rotated token's family so reuse detection spans the whole chain.
    family?: string,
  ): Promise<TokenResponseDto> {
    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.refreshSecret,
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
    });

    // Persist the refresh token (hashed) so it is revocable + rotatable. Without
    // this a stateless refresh JWT would keep minting access tokens after logout.
    await this.storeRefreshToken(user.id, refreshToken, family ?? crypto.randomUUID(), sessionContext);

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

  // Store a refresh token as a SHA-256 hash (never the raw JWT), with its expiry
  // taken from the token's own `exp` claim so the row and the JWT agree.
  private async storeRefreshToken(
    userId: string,
    rawToken: string,
    family: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const decoded = this.jwtService.decode(rawToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawToken),
        family,
        expiresAt,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      },
    });
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private async revokeFamily(family: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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
