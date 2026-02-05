// MultiWA Gateway - Groups Controller
// apps/api/src/modules/groups/groups.controller.ts

import { 
  Controller, 
  Get, 
  Post, 
  Patch, 
  Delete,
  Param, 
  Body, 
  Query,
  UseGuards 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity, ApiParam, ApiQuery } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { 
  CreateGroupDto, 
  UpdateGroupDto,
  AddParticipantsDto, 
  RemoveParticipantsDto,
  PromoteParticipantsDto,
  DemoteParticipantsDto 
} from './dto';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Groups')
@Controller('groups')
@UseGuards(JwtOrApiKeyGuard)
@ApiBearerAuth()
@ApiSecurity('api-key')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get('profile/:profileId')
  @ApiOperation({ summary: 'Get all groups for a profile' })
  @ApiParam({ name: 'profileId', description: 'Profile ID' })
  async getAll(@Param('profileId') profileId: string) {
    return this.groupsService.getAll(profileId);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Get detailed group info including participants' })
  @ApiParam({ name: 'groupId', description: 'Group ID (e.g., 628xxx-xxx@g.us)' })
  @ApiQuery({ name: 'profileId', required: true })
  async getById(
    @Param('groupId') groupId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.groupsService.getById(profileId, groupId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new WhatsApp group' })
  async create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Update group info (name, description)' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async update(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupsService.update(groupId, dto);
  }

  @Post(':groupId/participants/add')
  @ApiOperation({ summary: 'Add participants to a group' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async addParticipants(
    @Param('groupId') groupId: string,
    @Body() dto: AddParticipantsDto,
  ) {
    return this.groupsService.addParticipants(groupId, dto);
  }

  @Post(':groupId/participants/remove')
  @ApiOperation({ summary: 'Remove participants from a group' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async removeParticipants(
    @Param('groupId') groupId: string,
    @Body() dto: RemoveParticipantsDto,
  ) {
    return this.groupsService.removeParticipants(groupId, dto);
  }

  @Post(':groupId/participants/promote')
  @ApiOperation({ summary: 'Promote participants to group admin' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async promoteParticipants(
    @Param('groupId') groupId: string,
    @Body() dto: PromoteParticipantsDto,
  ) {
    return this.groupsService.promoteParticipants(groupId, dto);
  }

  @Post(':groupId/participants/demote')
  @ApiOperation({ summary: 'Demote participants from group admin' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  async demoteParticipants(
    @Param('groupId') groupId: string,
    @Body() dto: DemoteParticipantsDto,
  ) {
    return this.groupsService.demoteParticipants(groupId, dto);
  }

  @Post(':groupId/leave')
  @ApiOperation({ summary: 'Leave a group' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  @ApiQuery({ name: 'profileId', required: true })
  async leave(
    @Param('groupId') groupId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.groupsService.leave(profileId, groupId);
  }

  @Get(':groupId/invite-link')
  @ApiOperation({ summary: 'Get group invite link' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  @ApiQuery({ name: 'profileId', required: true })
  async getInviteLink(
    @Param('groupId') groupId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.groupsService.getInviteLink(profileId, groupId);
  }

  @Post(':groupId/invite-link/revoke')
  @ApiOperation({ summary: 'Revoke and regenerate group invite link' })
  @ApiParam({ name: 'groupId', description: 'Group ID' })
  @ApiQuery({ name: 'profileId', required: true })
  async revokeInviteLink(
    @Param('groupId') groupId: string,
    @Query('profileId') profileId: string,
  ) {
    return this.groupsService.revokeInviteLink(profileId, groupId);
  }
}
