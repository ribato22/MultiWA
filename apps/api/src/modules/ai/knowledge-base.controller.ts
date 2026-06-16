// MultiWA Gateway - Knowledge Base Controller
// apps/api/src/modules/ai/knowledge-base.controller.ts

import {
  Controller, Post, Get, Delete, Body, Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { KnowledgeBaseService } from './knowledge-base.service';

@ApiTags('AI — Knowledge Base')
@Controller('ai/knowledge')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Post(':profileId/text')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Add text content to the knowledge base' })
  @ApiResponse({ status: 201, description: 'Text content indexed' })
  async addTextContent(
    @Param('profileId') profileId: string,
    @Body() body: { name: string; content: string },
  ) {
    return this.kbService.uploadDocument(profileId, body.name, body.content, 'txt');
  }

  @Get(':profileId')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List all documents in the knowledge base' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  async listDocuments(@Param('profileId') profileId: string) {
    return this.kbService.listDocuments(profileId);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'knowledgeDocument' })
  @ApiOperation({ summary: 'Delete a document from the knowledge base' })
  @ApiResponse({ status: 200, description: 'Document deleted' })
  async deleteDocument(@Param('id') id: string) {
    await this.kbService.deleteDocument(id);
    return { success: true };
  }

  @Post(':profileId/search')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Search the knowledge base' })
  @ApiResponse({ status: 200, description: 'Search results with relevance scores' })
  async search(
    @Param('profileId') profileId: string,
    @Body() body: { query: string; maxResults?: number },
  ) {
    return this.kbService.search(profileId, body.query, body.maxResults);
  }
}
