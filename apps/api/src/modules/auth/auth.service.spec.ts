// AuthService Unit Tests
// Tests core authentication logic with mocked dependencies

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// Mock Prisma — factory creates fresh mock functions
vi.mock('@multiwa/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organization: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    workspace: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from '@multiwa/database';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  const mockJwtService = {
    sign: vi.fn().mockReturnValue('mock-token'),
    verify: vi.fn(),
  };
  const mockTwoFactorService = {
    verifyTwoFactor: vi.fn(),
  };
  const mockSessionsService = {
    createSession: vi.fn(),
    removeSessionByToken: vi.fn(),
  };

  beforeEach(() => {
    // Reset all mocks — clears call history AND resets implementations
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.user.create).mockReset();
    vi.mocked(prisma.user.update).mockReset();
    vi.mocked(prisma.user.delete).mockReset();
    vi.mocked(prisma.organization.create).mockReset();
    vi.mocked(prisma.organization.delete).mockReset();
    vi.mocked(prisma.workspace.create).mockReset();

    mockJwtService.sign.mockReset().mockReturnValue('mock-token');
    mockJwtService.verify.mockReset();
    mockSessionsService.createSession.mockReset();
    mockSessionsService.removeSessionByToken.mockReset();
    mockTwoFactorService.verifyTwoFactor.mockReset();

    authService = new AuthService(
      mockJwtService as any,
      mockTwoFactorService as any,
      mockSessionsService as any,
    );
  });

  // ──────────── register ────────────
  describe('register', () => {
    it('should throw ConflictException if email already exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'existing' } as any);

      await expect(
        authService.register({
          email: 'test@test.com',
          password: 'password123',
          name: 'Test',
          organizationName: 'TestOrg',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create organization, workspace, and user on successful registration', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.organization.create).mockResolvedValueOnce({ id: 'org-1' } as any);
      vi.mocked(prisma.workspace.create).mockResolvedValueOnce({ id: 'ws-1' } as any);
      vi.mocked(prisma.user.create).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        role: 'owner',
        organizationId: 'org-1',
      } as any);

      const result = await authService.register({
        email: 'test@test.com',
        password: 'password123',
        name: 'Test',
        organizationName: 'TestOrg',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result).toHaveProperty('user');
      expect(prisma.organization.create).toHaveBeenCalledOnce();
      expect(prisma.workspace.create).toHaveBeenCalledOnce();
      expect(prisma.user.create).toHaveBeenCalledOnce();
    });
  });

  // ──────────── login ────────────
  describe('login', () => {
    it('should throw UnauthorizedException for wrong email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(
        authService.login({ email: 'wrong@test.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: hash,
        twoFactorEnabled: false,
        organization: { id: 'org-1' },
      } as any);

      await expect(
        authService.login({ email: 'test@test.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return requires2FA when 2FA is enabled', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        passwordHash: hash,
        twoFactorEnabled: true,
        organization: { id: 'org-1' },
      } as any);

      const result = await authService.login({ email: 'test@test.com', password: 'password123' });

      expect(result).toEqual({ requires2FA: true, userId: 'user-1' });
    });

    it('should return tokens on successful login', async () => {
      const hash = await bcrypt.hash('password123', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        role: 'owner',
        organizationId: 'org-1',
        passwordHash: hash,
        twoFactorEnabled: false,
        organization: { id: 'org-1', name: 'TestOrg' },
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any);

      const result = await authService.login({ email: 'test@test.com', password: 'password123' });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(mockSessionsService.createSession).toHaveBeenCalledOnce();
    });
  });

  // ──────────── changePassword ────────────
  describe('changePassword', () => {
    it('should throw BadRequestException for wrong current password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);

      await expect(
        authService.changePassword('user-1', 'wrongpassword', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for short new password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);

      await expect(
        authService.changePassword('user-1', 'oldpassword', 'short'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully change password', async () => {
      const hash = await bcrypt.hash('oldpassword', 10);
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        passwordHash: hash,
      } as any);
      vi.mocked(prisma.user.update).mockResolvedValueOnce({} as any);

      const result = await authService.changePassword('user-1', 'oldpassword', 'newpassword123');

      expect(result).toEqual({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ passwordHash: expect.any(String) }),
        }),
      );
    });
  });

  // ──────────── getProfile ────────────
  describe('getProfile', () => {
    it('should throw if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

      await expect(authService.getProfile('nonexistent')).rejects.toThrow(UnauthorizedException);
    });

    it('should return profile without sensitive fields', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        name: 'Test',
        passwordHash: 'secret',
        twoFactorSecret: 'secret',
        twoFactorEnabled: false,
        backupCodes: [],
        organization: { id: 'org-1' },
      } as any);

      const profile = await authService.getProfile('user-1');

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('twoFactorSecret');
      expect(profile).toHaveProperty('email', 'test@test.com');
    });
  });
});
