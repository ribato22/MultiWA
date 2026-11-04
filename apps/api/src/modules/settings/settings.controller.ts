import { Controller, Get, Put, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiForbiddenResponse } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError } from '../../common/decorators/api-responses';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ServerOwnerOnly } from '../auth/decorators/server-owner.decorator';
import { SettingsService, StorageConfig, SmtpConfig } from './settings.service';
import { EmailService } from '@multiwa/engine-runtime';

// Storage and SMTP are the server's, shared by every organization on it: only the server's owner (the owner of the
// oldest organization) reads or changes them.
@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard)
@Roles('owner')
@ServerOwnerOnly()
@ApiBearerAuth()
@ApiAuthErrors()
@ApiForbiddenResponse({ description: "Only the server's owner manages server-wide settings" })
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  // ======= Storage endpoints =======

  @Get('storage')
  @ApiOperation({ summary: 'Get storage configuration (secrets masked)' })
  @ApiResponse({ status: 200, description: 'Storage configuration' })
  async getStorageConfig() {
    return this.settingsService.getStorageConfigMasked();
  }

  @Put('storage')
  @ApiOperation({ summary: 'Update storage configuration' })
  @ApiValidationError()
  @ApiResponse({ status: 200, description: 'Storage config updated' })
  async updateStorageConfig(@Body() body: StorageConfig) {
    await this.settingsService.updateStorageConfig(body);
    return { success: true, message: 'Storage configuration updated' };
  }

  @Post('storage/test')
  @ApiOperation({ summary: 'Test S3 storage connection' })
  @ApiQuery({ name: 'createBucket', required: false, description: 'Auto-create bucket if missing' })
  @ApiValidationError()
  @ApiResponse({ status: 200, description: 'Connection test result' })
  async testStorageConnection(@Body() body: StorageConfig, @Query('createBucket') createBucket?: string) {
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
  async getSmtpConfig() {
    return this.settingsService.getSmtpConfigMasked();
  }

  @Put('smtp')
  @ApiOperation({ summary: 'Update SMTP configuration' })
  @ApiValidationError()
  @ApiResponse({ status: 200, description: 'SMTP config updated' })
  async updateSmtpConfig(@Body() body: SmtpConfig) {
    await this.settingsService.updateSmtpConfig(body);
    // Hot-reload the email transporter with new config
    const reloadResult = await this.emailService.reconfigure();
    return { success: true, message: 'SMTP configuration updated', smtp: reloadResult };
  }

  @Post('smtp/test')
  @ApiOperation({ summary: 'Test SMTP connection' })
  @ApiQuery({ name: 'sendTo', required: false, description: 'Send test email to this address' })
  @ApiValidationError()
  @ApiResponse({ status: 200, description: 'SMTP test result' })
  async testSmtpConnection(@Body() body: SmtpConfig, @Query('sendTo') sendTo?: string) {
    // If testing with masked password, use saved config
    const hasRealPass = body.pass && !body.pass.includes('••••');
    const config = hasRealPass ? body : undefined;

    return this.settingsService.testSmtpConnection(config, {
      sendTestTo: sendTo,
    });
  }
}
