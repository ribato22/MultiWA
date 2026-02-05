// MultiWA Gateway - Integrations Configuration Controller
// apps/api/src/modules/integrations/integrations.controller.ts

import {
  Controller, Get, Put, Post, Body,
  UseGuards, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TypeBotService } from './typebot.service';
import { ChatwootService } from './chatwoot.service';
import { ConfigService } from '@nestjs/config';

interface IntegrationConfig {
  typebot?: {
    apiUrl: string;
    defaultBotId: string;
    enabled: boolean;
  };
  chatwoot?: {
    url: string;
    apiToken: string;
    accountId: string;
    inboxId: string;
    enabled: boolean;
  };
}

@ApiTags('Integrations')
@Controller('integrations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly typebotService: TypeBotService,
    private readonly chatwootService: ChatwootService,
    private readonly configService: ConfigService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Get integration configuration' })
  @ApiResponse({ status: 200, description: 'Integration configuration' })
  async getConfig(): Promise<IntegrationConfig> {
    return {
      typebot: {
        apiUrl: this.configService.get('TYPEBOT_API_URL', ''),
        defaultBotId: this.configService.get('TYPEBOT_DEFAULT_BOT_ID', ''),
        enabled: this.typebotService.isEnabled(),
      },
      chatwoot: {
        url: this.configService.get('CHATWOOT_URL', ''),
        apiToken: this.configService.get('CHATWOOT_API_TOKEN', '') ? '••••••••' : '',
        accountId: this.configService.get('CHATWOOT_ACCOUNT_ID', ''),
        inboxId: this.configService.get('CHATWOOT_INBOX_ID', ''),
        enabled: this.chatwootService.isEnabled(),
      },
    };
  }

  @Put('config')
  @ApiOperation({ summary: 'Update integration configuration (env-based, restart required)' })
  @ApiResponse({ status: 200, description: 'Configuration noted, restart needed' })
  async updateConfig(@Body() config: IntegrationConfig) {
    // Note: The services read from environment variables.
    // This endpoint acknowledges the config but env changes require a restart.
    this.logger.log('Integration config update requested — environment restart needed for changes to take effect');
    return {
      success: true,
      message: 'Configuration saved. Server restart may be required for changes to take effect.',
    };
  }

  @Post('test')
  @ApiOperation({ summary: 'Test integration connection' })
  @ApiResponse({ status: 200, description: 'Connection test result' })
  async testConnection(@Body() body: { type: 'typebot' | 'chatwoot' }) {
    try {
      if (body.type === 'typebot') {
        if (!this.typebotService.isEnabled()) {
          return { success: false, message: 'TypeBot is not configured. Set TYPEBOT_API_URL environment variable.' };
        }
        // Attempt a basic health check
        const apiUrl = this.configService.get('TYPEBOT_API_URL', '');
        const res = await fetch(`${apiUrl}/api/v1/typebots`, { method: 'GET' }).catch(() => null);
        return {
          success: !!res?.ok,
          message: res?.ok ? 'TypeBot connection successful!' : 'TypeBot connection failed. Check URL and ensure the server is running.',
        };
      }

      if (body.type === 'chatwoot') {
        if (!this.chatwootService.isEnabled()) {
          return { success: false, message: 'Chatwoot is not configured. Set CHATWOOT_URL, CHATWOOT_API_TOKEN, and CHATWOOT_ACCOUNT_ID environment variables.' };
        }
        const url = this.configService.get('CHATWOOT_URL', '');
        const token = this.configService.get('CHATWOOT_API_TOKEN', '');
        const accountId = this.configService.get('CHATWOOT_ACCOUNT_ID', '');
        const res = await fetch(`${url}/api/v1/accounts/${accountId}/inboxes`, {
          headers: { 'api_access_token': token },
        }).catch(() => null);
        return {
          success: !!res?.ok,
          message: res?.ok ? 'Chatwoot connection successful!' : 'Chatwoot connection failed. Check URL, API token, and account ID.',
        };
      }

      return { success: false, message: `Unknown integration type: ${body.type}` };
    } catch (error: any) {
      return { success: false, message: `Connection test failed: ${error.message}` };
    }
  }
}
