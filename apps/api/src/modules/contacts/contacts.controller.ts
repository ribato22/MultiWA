// MultiWA Gateway - Enhanced Contacts Controller
// apps/api/src/modules/contacts/contacts.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { ApiAuthErrors, ApiValidationError, ApiNotFound } from '../../common/decorators/api-responses';
import { ContactsService } from './contacts.service';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { RequireTenant } from '../../common/tenant/require-tenant.decorator';
import { CreateContactDto, UpdateContactDto, ImportContactsDto, ImportCsvDto, ValidateBulkDto, SaveWhatsAppContactDto } from './dto';

@ApiTags('Contacts')
@Controller('contacts')
@UseGuards(JwtOrApiKeyGuard, TenantGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
@ApiAuthErrors()
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Post()
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Create a contact' })
  @ApiValidationError()
  async create(@Body() dto: CreateContactDto) {
    return this.service.create(dto);
  }

  @Get()
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'List contacts with filtering' })
  @ApiQuery({ name: 'profileId', required: true })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'tags', required: false, type: [String] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async findAll(
    @Query('profileId') profileId: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string[] | string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    // A single ?tags=x arrives as a string; the service expects an array.
    const tagList = tags ? (Array.isArray(tags) ? tags : [tags]) : undefined;
    return this.service.findAll(profileId, { search, tags: tagList, limit, offset });
  }

  @Get(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'contact' })
  @ApiOperation({ summary: 'Get contact by ID' })
  @ApiNotFound('Contact')
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'contact' })
  @ApiOperation({ summary: 'Update contact' })
  @ApiValidationError()
  @ApiNotFound('Contact')
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireTenant({ from: 'param', key: 'id', resource: 'contact' })
  @ApiOperation({ summary: 'Delete contact' })
  @ApiNotFound('Contact')
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  // Import endpoints
  @Post('import')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Bulk import contacts (JSON array)' })
  @ApiValidationError()
  async import(@Body() dto: ImportContactsDto) {
    return this.service.bulkImport(dto);
  }

  @Post('import/csv')
  @RequireTenant({ from: 'body', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Import contacts from CSV data' })
  @ApiValidationError()
  async importCsv(@Body() dto: ImportCsvDto) {
    return this.service.importFromCsv(dto);
  }

  // Export endpoints
  @Get('export/csv')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
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
  @RequireTenant({ from: 'param', key: 'id', resource: 'contact' })
  @ApiOperation({ summary: 'Add tags to contact' })
  @ApiValidationError()
  @ApiNotFound('Contact')
  async addTags(@Param('id') id: string, @Body('tags') tags: string[]) {
    return this.service.addTags(id, tags);
  }

  @Delete(':id/tags')
  @RequireTenant({ from: 'param', key: 'id', resource: 'contact' })
  @ApiOperation({ summary: 'Remove tags from contact' })
  @ApiValidationError()
  @ApiNotFound('Contact')
  async removeTags(@Param('id') id: string, @Body('tags') tags: string[]) {
    return this.service.removeTags(id, tags);
  }

  // Validation endpoints
  @Get('profile/:profileId/validate/:phone')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Validate single phone number' })
  @ApiNotFound('Profile')
  async validatePhone(
    @Param('profileId') profileId: string,
    @Param('phone') phone: string,
  ) {
    return this.service.validatePhone(profileId, phone);
  }

  @Post('profile/:profileId/validate')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Bulk validate phone numbers' })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async validateBulk(
    @Param('profileId') profileId: string,
    @Body() dto: ValidateBulkDto,
  ) {
    return this.service.validateBulk(profileId, dto.phones);
  }

  // Sync from WhatsApp
  @Post('sync/whatsapp')
  @RequireTenant({ from: 'query', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: 'Sync contacts from WhatsApp profile - fetches contacts exactly as saved in WhatsApp' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async syncFromWhatsApp(
    @Query('profileId') profileId: string,
  ) {
    if (!profileId) {
      throw new BadRequestException('profileId is required as query param');
    }
    return this.service.syncFromWhatsApp(profileId);
  }

  // Save a number into the WhatsApp account's addressbook (whatsapp-web.js only).
  // Writes to WhatsApp itself (not just the MultiWA DB), turning an unknown number
  // into a known contact.
  @Post('profile/:profileId/save-to-whatsapp')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: "Save a contact into the WhatsApp account's addressbook (whatsapp-web-js only)" })
  @ApiValidationError()
  @ApiNotFound('Profile')
  async saveToWhatsApp(
    @Param('profileId') profileId: string,
    @Body() dto: SaveWhatsAppContactDto,
  ) {
    return this.service.saveToWhatsApp(profileId, dto.phone, dto.firstName, dto.lastName, dto.syncToPhone);
  }

  @Delete('profile/:profileId/whatsapp/:phone')
  @RequireTenant({ from: 'param', key: 'profileId', resource: 'profile' })
  @ApiOperation({ summary: "Delete a contact from the WhatsApp account's addressbook (whatsapp-web-js only)" })
  @ApiNotFound('Profile')
  async deleteFromWhatsApp(
    @Param('profileId') profileId: string,
    @Param('phone') phone: string,
  ) {
    return this.service.deleteFromWhatsApp(profileId, phone);
  }
}
