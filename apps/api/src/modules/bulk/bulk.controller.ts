// MultiWA Gateway - Bulk Messaging Controller
// apps/api/src/modules/bulk/bulk.controller.ts

import { 
  Controller, 
  Get, 
  Post, 
  Param, 
  Body, 
  Query,
  UseGuards 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiParam, ApiQuery } from '@nestjs/swagger';
import { BulkService } from './bulk.service';
import { SendBulkDto } from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Bulk Messaging')
@Controller('bulk')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class BulkController {
  constructor(private readonly bulkService: BulkService) {}

  @Post('send')
  @ApiOperation({ 
    summary: 'Send bulk messages with variable substitution',
    description: 'Sends messages to multiple recipients with support for template variables like {name}, {company}. Returns a batch ID for tracking.'
  })
  async sendBulk(@Body() dto: SendBulkDto) {
    return this.bulkService.sendBulk(dto);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List all batches for a profile' })
  @ApiQuery({ name: 'profileId', required: true })
  async listBatches(@Query('profileId') profileId: string) {
    return this.bulkService.listBatches(profileId);
  }

  @Get('batch/:batchId')
  @ApiOperation({ summary: 'Get batch status with detailed results' })
  @ApiParam({ name: 'batchId', description: 'Batch ID returned from send-bulk' })
  @ApiQuery({ name: 'profileId', required: true })
  async getBatchStatus(
    @Param('batchId') batchId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.bulkService.getBatchStatus(batchId, profileId);
  }

  @Post('batch/:batchId/cancel')
  @ApiOperation({ summary: 'Cancel a batch in progress' })
  @ApiParam({ name: 'batchId', description: 'Batch ID to cancel' })
  @ApiQuery({ name: 'profileId', required: true })
  async cancelBatch(
    @Param('batchId') batchId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.bulkService.cancelBatch(batchId, profileId);
  }
}
