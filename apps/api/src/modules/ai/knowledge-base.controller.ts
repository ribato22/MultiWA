// MultiWA Gateway - Knowledge Base Controller
// apps/api/src/modules/ai/knowledge-base.controller.ts

import {
  Controller, Post, Get, Delete, Body, Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { KnowledgeBaseService } from './knowledge-base.service';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';

@ApiTags('AI — Knowledge Base')
@Controller('ai/knowledge')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class KnowledgeBaseController {
  constructor(private readonly kbService: KnowledgeBaseService) {}

  @Post(':profileId/text')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'Add text content to the knowledge base',
    description: 'Indexes a named block of plain text so the AI assistant can retrieve it during conversations for this profile.',
  })
  @ApiParam({ name: 'profileId', description: 'ID of the profile that owns the knowledge base.' })
  @ApiResponse({ status: 201, description: 'Text content indexed' })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async addTextContent(
    @Param('profileId') profileId: string,
    @Body() body: { name: string; content: string },
  ) {
    return this.kbService.uploadDocument(profileId, body.name, body.content, 'txt');
  }

  @Get(':profileId')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'List all documents in the knowledge base',
    description: 'Returns every document currently indexed in the knowledge base for the given profile.',
  })
  @ApiParam({ name: 'profileId', description: 'ID of the profile whose knowledge base documents are listed.' })
  @ApiResponse({ status: 200, description: 'List of documents' })
  @ApiNotFound('Profile')
  async listDocuments(@Param('profileId') profileId: string) {
    return this.kbService.listDocuments(profileId);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'knowledgeDocument' })
  @ApiOperation({
    summary: 'Delete a document from the knowledge base',
    description: 'Permanently removes a single indexed document and its embeddings by document ID.',
  })
  @ApiParam({ name: 'id', description: 'ID of the knowledge base document to delete.' })
  @ApiResponse({ status: 200, description: 'Document deleted' })
  @ApiNotFound('Knowledge document')
  async deleteDocument(@Param('id') id: string) {
    await this.kbService.deleteDocument(id);
    return { success: true };
  }

  @Post(':profileId/search')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({
    summary: 'Search the knowledge base',
    description: 'Runs a semantic search over the profile\'s indexed documents and returns the most relevant matches with relevance scores.',
  })
  @ApiParam({ name: 'profileId', description: 'ID of the profile whose knowledge base is searched.' })
  @ApiResponse({ status: 200, description: 'Search results with relevance scores' })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async search(
    @Param('profileId') profileId: string,
    @Body() body: { query: string; maxResults?: number },
  ) {
    return this.kbService.search(profileId, body.query, body.maxResults);
  }
}
