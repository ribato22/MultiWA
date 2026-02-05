import { Controller, Get, Put, Post, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettingsService, StorageConfig, SmtpConfig } from './settings.service';
import { EmailService } from '../notifications/email.service';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Admin-only guard: only owner/admin can access settings
   */
  private ensureAdmin(req: any) {
    const role = req.user?.role;
    if (!role || !['owner', 'admin'].includes(role)) {
      throw new ForbiddenException('Only admins can manage system settings');
    }
  }

  // ======= Storage endpoints =======

  @Get('storage')
  @ApiOperation({ summary: 'Get storage configuration (secrets masked)' })
  @ApiResponse({ status: 200, description: 'Storage configuration' })
  async getStorageConfig(@Request() req: any) {
    this.ensureAdmin(req);
    return this.settingsService.getStorageConfigMasked();
  }

  @Put('storage')
  @ApiOperation({ summary: 'Update storage configuration' })
  @ApiResponse({ status: 200, description: 'Storage config updated' })
  async updateStorageConfig(@Request() req: any, @Body() body: StorageConfig) {
    this.ensureAdmin(req);
    await this.settingsService.updateStorageConfig(body);
    return { success: true, message: 'Storage configuration updated' };
  }

  @Post('storage/test')
  @ApiOperation({ summary: 'Test S3 storage connection' })
  @ApiQuery({ name: 'createBucket', required: false, description: 'Auto-create bucket if missing' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  async testStorageConnection(
    @Request() req: any,
    @Body() body: StorageConfig,
    @Query('createBucket') createBucket?: string,
  ) {
    this.ensureAdmin(req);

    // If testing with masked keys, use saved config instead
    const hasRealKeys = body.s3AccessKey && !body.s3AccessKey.includes('••••');
    const config = hasRealKeys ? body : undefined;

    return this.settingsService.testStorageConnection(config, {
      createBucketIfMissing: createBucket === 'true',
    });
  }

  // ======= SMTP endpoints =======

  @Get('smtp')
  @ApiOperation({ summary: 'Get SMTP configuration (secrets masked)' })
  @ApiResponse({ status: 200, description: 'SMTP configuration' })
  async getSmtpConfig(@Request() req: any) {
    this.ensureAdmin(req);
    return this.settingsService.getSmtpConfigMasked();
  }

  @Put('smtp')
  @ApiOperation({ summary: 'Update SMTP configuration' })
  @ApiResponse({ status: 200, description: 'SMTP config updated' })
  async updateSmtpConfig(@Request() req: any, @Body() body: SmtpConfig) {
    this.ensureAdmin(req);
    await this.settingsService.updateSmtpConfig(body);
    // Hot-reload the email transporter with new config
    const reloadResult = await this.emailService.reconfigure();
    return { success: true, message: 'SMTP configuration updated', smtp: reloadResult };
  }

  @Post('smtp/test')
  @ApiOperation({ summary: 'Test SMTP connection' })
  @ApiQuery({ name: 'sendTo', required: false, description: 'Send test email to this address' })
  @ApiResponse({ status: 200, description: 'SMTP test result' })
  async testSmtpConnection(
    @Request() req: any,
    @Body() body: SmtpConfig,
    @Query('sendTo') sendTo?: string,
  ) {
    this.ensureAdmin(req);

    // If testing with masked password, use saved config
    const hasRealPass = body.pass && !body.pass.includes('••••');
    const config = hasRealPass ? body : undefined;

    return this.settingsService.testSmtpConnection(config, {
      sendTestTo: sendTo,
    });
  }
}
