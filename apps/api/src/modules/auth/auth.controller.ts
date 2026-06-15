// MultiWA Gateway API - Auth Controller
// apps/api/src/modules/auth/auth.controller.ts

import { Controller, Post, Body, Get, Patch, Delete, UseGuards, Request, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SessionsService } from './sessions.service';
import { LoginDto, RegisterDto, TokenResponseDto } from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AllowInDemo } from '../../common/guards/demo.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactorService: TwoFactorService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user and organization' })
  @ApiResponse({ status: 201, description: 'User registered successfully', type: TokenResponseDto })
  async register(@Body() dto: RegisterDto): Promise<TokenResponseDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @AllowInDemo()
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful (or requires 2FA)' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Request() req: any,
  ) {
    const ip = req.ip || req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    return this.authService.login(dto, ip, ua);
  }

  @Post('2fa/verify')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @AllowInDemo()
  @ApiOperation({ summary: 'Complete login with 2FA verification code' })
  @ApiResponse({ status: 200, description: 'Login successful', type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid 2FA code' })
  async verify2FA(
    @Body() body: { userId: string; token: string },
    @Request() req: any,
  ): Promise<TokenResponseDto> {
    const ip = req.ip || req.connection?.remoteAddress;
    const ua = req.headers?.['user-agent'];
    return this.authService.loginWith2FA(body.userId, body.token, ip, ua);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @AllowInDemo()
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed', type: TokenResponseDto })
  async refresh(@Body('refreshToken') refreshToken: string): Promise<TokenResponseDto> {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke current session' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Headers('authorization') auth: string) {
    const token = auth?.replace('Bearer ', '');
    if (token) {
      await this.authService.logout(token);
    }
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  async me(@Request() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get notification preferences' })
  @ApiResponse({ status: 200, description: 'User preferences' })
  async getPreferences(@Request() req: any) {
    return this.authService.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  async updatePreferences(@Request() req: any, @Body() body: Record<string, any>) {
    return this.authService.updatePreferences(req.user.id, body);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Current password incorrect or new password too short' })
  async changePassword(
    @Request() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(req.user.id, body.currentPassword, body.newPassword);
  }

  @Delete('account')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete user account' })
  @ApiResponse({ status: 200, description: 'Account deleted' })
  @ApiResponse({ status: 400, description: 'Password incorrect' })
  async deleteAccount(
    @Request() req: any,
    @Body() body: { password: string },
  ) {
    return this.authService.deleteAccount(req.user.id, body.password);
  }

  // ==========================================
  // Two-Factor Authentication Endpoints
  // ==========================================

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA setup QR code' })
  @ApiResponse({ status: 200, description: 'QR code and secret returned' })
  async setup2FA(@Request() req: any) {
    return this.twoFactorService.setupTwoFactor(req.user.id);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA by verifying TOTP code' })
  @ApiResponse({ status: 200, description: '2FA enabled, backup codes returned' })
  async enable2FA(
    @Request() req: any,
    @Body() body: { token: string },
  ) {
    return this.twoFactorService.enableTwoFactor(req.user.id, body.token);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA with password confirmation' })
  @ApiResponse({ status: 200, description: '2FA disabled' })
  async disable2FA(@Request() req: any) {
    await this.twoFactorService.disableTwoFactor(req.user.id);
    return { success: true, message: 'Two-factor authentication disabled' };
  }

  @Post('2fa/backup-codes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate 2FA backup codes' })
  @ApiResponse({ status: 200, description: 'New backup codes generated' })
  async regenerateBackupCodes(@Request() req: any) {
    return this.twoFactorService.regenerateBackupCodes(req.user.id);
  }

  // ==========================================
  // Session Management Endpoints
  // ==========================================

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active sessions' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  async getSessions(@Request() req: any) {
    return this.sessionsService.getActiveSessions(req.user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  async revokeSession(
    @Request() req: any,
    @Param('id') sessionId: string,
  ) {
    await this.sessionsService.revokeSession(req.user.id, sessionId);
    return { success: true };
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all other sessions' })
  @ApiResponse({ status: 200, description: 'All other sessions revoked' })
  async revokeAllSessions(
    @Request() req: any,
    @Headers('authorization') auth: string,
  ) {
    const token = auth?.replace('Bearer ', '');
    const count = await this.sessionsService.revokeAllSessions(req.user.id, token);
    return { success: true, revokedCount: count };
  }
}
