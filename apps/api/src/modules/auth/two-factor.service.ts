// MultiWA Gateway - Two-Factor Authentication Service
// apps/api/src/modules/auth/two-factor.service.ts

import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as crypto from 'crypto';

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  /**
   * Generate a TOTP secret and return setup data including QR code.
   */
  async setupTwoFactor(userId: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is already enabled');
    }

    const QRCode = await import('qrcode');

    const secret = generateSecret();
    const otpauthUrl = generateURI({ label: user.email, issuer: 'MultiWA', secret });

    // Generate QR code as Data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // Store secret temporarily (not yet enabled)
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });

    this.logger.log(`2FA setup initiated for user: ${user.email}`);

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Verify a TOTP code and enable 2FA. Returns backup codes.
   */
  async enableTwoFactor(userId: string, token: string): Promise<{
    enabled: boolean;
    backupCodes: string[];
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.twoFactorSecret) {
      throw new BadRequestException('Call /auth/2fa/setup first');
    }
    if (user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is already enabled');
    }

    // Verify the token
    const result = verifySync({ token, secret: user.twoFactorSecret });
    const isValid = typeof result === 'object' ? result.valid : result;

    if (!isValid) {
      throw new BadRequestException('Invalid verification code. Please try again.');
    }

    // Generate backup codes
    const backupCodes = this.generateBackupCodes(8);

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        backupCodes,
      },
    });

    this.logger.log(`2FA enabled for user: ${user.email}`);

    return { enabled: true, backupCodes };
  }

  /**
   * Verify a TOTP token or backup code during login.
   */
  async verifyTwoFactor(userId: string, token: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    // Try TOTP first
    const totpResult = verifySync({ token, secret: user.twoFactorSecret });
    const isValidTotp = typeof totpResult === 'object' ? totpResult.valid : totpResult;
    if (isValidTotp) return true;

    // Try backup code
    const backupIdx = user.backupCodes.indexOf(token.toUpperCase());
    if (backupIdx !== -1) {
      // Remove used backup code
      const updatedCodes = [...user.backupCodes];
      updatedCodes.splice(backupIdx, 1);
      await prisma.user.update({
        where: { id: userId },
        data: { backupCodes: updatedCodes },
      });
      this.logger.log(`Backup code used for user: ${user.email} (${updatedCodes.length} remaining)`);
      return true;
    }

    return false;
  }

  /**
   * Disable 2FA after password verification.
   */
  async disableTwoFactor(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
        backupCodes: [],
      },
    });

    this.logger.log(`2FA disabled for user: ${user.email}`);
  }

  /**
   * Check if user has 2FA enabled.
   */
  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });
    return user?.twoFactorEnabled ?? false;
  }

  /**
   * Regenerate backup codes for a user with 2FA enabled.
   */
  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const backupCodes = this.generateBackupCodes(8);

    await prisma.user.update({
      where: { id: userId },
      data: { backupCodes },
    });

    this.logger.log(`Backup codes regenerated for user: ${user.email}`);

    return { backupCodes };
  }

  /**
   * Generate random backup codes.
   */
  private generateBackupCodes(count: number): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }
}
