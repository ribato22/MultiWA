// MultiWA Gateway - Enhanced Contacts Controller
// apps/api/src/modules/contacts/contacts.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { CreateContactDto, UpdateContactDto, ImportContactsDto, ImportCsvDto, ValidateBulkDto } from './dto';

@ApiTags('Contacts')
@Controller('contacts')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a contact' })
  async create(@Body() dto: CreateContactDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List contacts with filtering' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tags', required: false, type: [String] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string[],
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.service.findAll(profileId, { search, tags, limit, offset });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by ID' })
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update contact' })
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete contact' })
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // Import endpoints
  @Post('import')
  @ApiOperation({ summary: 'Bulk import contacts (JSON array)' })
  async import(@Body() dto: ImportContactsDto) {
    return this.service.bulkImport(dto);
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Import contacts from CSV data' })
  async importCsv(@Body() dto: ImportCsvDto) {
    return this.service.importFromCsv(dto);
  }

  // Export endpoints
  @Get('export/csv')
  @ApiOperation({ summary: 'Export contacts to CSV' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'tags', required: false, type: [String] })
  @ApiQuery({ name: 'download', required: false, type: Boolean })
  async exportCsv(
    @Query('profileId') profileId: string,
    @Query('tags') tags?: string[],
    @Query('download') download?: boolean,
    @Res() res?: FastifyReply,
  ) {
    const result = await this.service.exportToCsv(profileId, { tags });
    
    if (download && res) {
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(result.csv);
    }
    
    return result;
  }

  // Tags endpoints
  @Post(':id/tags')
  @ApiOperation({ summary: 'Add tags to contact' })
  async addTags(@Param('id') id: string, @Body('tags') tags: string[]) {
    return this.service.addTags(id, tags);
  }

  @Delete(':id/tags')
  @ApiOperation({ summary: 'Remove tags from contact' })
  async removeTags(@Param('id') id: string, @Body('tags') tags: string[]) {
    return this.service.removeTags(id, tags);
  }

  // Validation endpoints
  @Get('profile/:profileId/validate/:phone')
  @ApiOperation({ summary: 'Validate single phone number' })
  async validatePhone(
    @Param('profileId') profileId: string,
    @Param('phone') phone: string,
  ) {
    return this.service.validatePhone(profileId, phone);
  }

  @Post('profile/:profileId/validate')
  @ApiOperation({ summary: 'Bulk validate phone numbers' })
  async validateBulk(
    @Param('profileId') profileId: string,
    @Body() dto: ValidateBulkDto,
  ) {
    return this.service.validateBulk(profileId, dto.phones);
  }

  // Sync from WhatsApp
  @Post('sync/whatsapp')
  @ApiOperation({ summary: 'Sync contacts from WhatsApp profile - fetches contacts exactly as saved in WhatsApp' })
  @ApiQuery({ name: 'profileId', required: false })
  async syncFromWhatsApp(
    @Query('profileId') profileId: string,
  ) {
    if (!profileId) {
      throw new BadRequestException('profileId is required as query param');
    }
    return this.service.syncFromWhatsApp(profileId);
  }
}
