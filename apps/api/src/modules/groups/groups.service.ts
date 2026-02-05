// MultiWA Gateway - Groups Service
// apps/api/src/modules/groups/groups.service.ts

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { 
  CreateGroupDto, 
  UpdateGroupDto,
  AddParticipantsDto, 
  RemoveParticipantsDto,
  PromoteParticipantsDto,
  DemoteParticipantsDto 
} from './dto';
import { EngineManagerService } from '../profiles/engine-manager.service';

export interface GroupInfo {
  id: string;
  name: string;
  description: string;
  owner: string;
  createdAt: Date;
  participantsCount: number;
  participants?: GroupParticipant[];
}

export interface GroupParticipant {
  id: string;
  phone: string;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
}

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly engineManager: EngineManagerService,
  ) {}

  /**
   * Get all groups for a profile
   */
  async getAll(profileId: string): Promise<GroupInfo[]> {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      // Return empty array if engine not connected (instead of throwing error)
      this.logger.warn(`Profile ${profileId} not connected, returning empty groups`);
      return [];
    }

    try {
      // Add timeout to prevent indefinite hang (30 seconds)
      const timeoutMs = 30000;
      const groupsPromise = engine.getGroups();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`getGroups timed out after ${timeoutMs}ms`)), timeoutMs)
      );
      
      const groups = await Promise.race([groupsPromise, timeoutPromise]);
      
      this.logger.log(`Mapping ${groups.length} groups for profile ${profileId}`);
      
      return groups.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description || '',
        owner: '',
        createdAt: new Date(),
        participantsCount: g.participantCount || g.participants?.length || 0,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to get groups for ${profileId}: ${error.message}`);
      // Return empty array instead of throwing - engine may be disconnected
      return [];
    }
  }

  /**
   * Get detailed group info including participants
   */
  async getById(profileId: string, groupId: string): Promise<GroupInfo> {
    const engine = await this.engineManager.getEngine(profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${profileId} not found or not connected`);
    }

    try {
      const group = await engine.getGroupInfo(groupId);
      if (!group) {
        throw new NotFoundException(`Group ${groupId} not found`);
      }

      return {
        id: group.id,
        name: group.name,
        description: group.description || '',
        owner: group.owner,
        createdAt: group.createdAt,
        participantsCount: group.participants?.length || 0,
        participants: group.participants?.map(p => ({
          id: p.id,
          phone: p.id.replace('@c.us', '').replace('@s.whatsapp.net', ''),
          isAdmin: p.isAdmin || false,
          isSuperAdmin: p.isSuperAdmin || false,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get group info: ${error.message}`);
      throw new BadRequestException(`Failed to get group info: ${error.message}`);
    }
  }

  /**
   * Create a new group
   */
  async create(dto: CreateGroupDto): Promise<GroupInfo> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      // Format phone numbers to WhatsApp format
      const participants = dto.participants.map(p => 
        p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`
      );

      const group = await engine.createGroup(dto.name, participants);
      
      // Set description if provided
      if (dto.description && group.id) {
        await engine.setGroupDescription(group.id, dto.description);
      }

      return {
        id: group.id,
        name: dto.name,
        description: dto.description || '',
        owner: group.owner || '',
        createdAt: new Date(),
        participantsCount: participants.length,
      };
    } catch (error) {
      this.logger.error(`Failed to create group: ${error.message}`);
      throw new BadRequestException(`Failed to create group: ${error.message}`);
    }
  }

  /**
   * Update group info (name, description)
   */
  async update(groupId: string, dto: UpdateGroupDto): Promise<{ success: boolean }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      if (dto.name) {
        await engine.setGroupName(groupId, dto.name);
      }
      if (dto.description !== undefined) {
        await engine.setGroupDescription(groupId, dto.description);
      }
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to update group: ${error.message}`);
      throw new BadRequestException(`Failed to update group: ${error.message}`);
    }
  }

  /**
   * Add participants to a group
   */
  async addParticipants(groupId: string, dto: AddParticipantsDto): Promise<{ success: boolean; added: string[] }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      const participants = dto.participants.map(p => 
        p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`
      );

      await engine.addGroupParticipants(groupId, participants);
      
      return { success: true, added: dto.participants };
    } catch (error) {
      this.logger.error(`Failed to add participants: ${error.message}`);
      throw new BadRequestException(`Failed to add participants: ${error.message}`);
    }
  }

  /**
   * Remove participants from a group
   */
  async removeParticipants(groupId: string, dto: RemoveParticipantsDto): Promise<{ success: boolean; removed: string[] }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      const participants = dto.participants.map(p => 
        p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`
      );

      await engine.removeGroupParticipants(groupId, participants);
      
      return { success: true, removed: dto.participants };
    } catch (error) {
      this.logger.error(`Failed to remove participants: ${error.message}`);
      throw new BadRequestException(`Failed to remove participants: ${error.message}`);
    }
  }

  /**
   * Promote participants to admin
   */
  async promoteParticipants(groupId: string, dto: PromoteParticipantsDto): Promise<{ success: boolean }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      const participants = dto.participants.map(p => 
        p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`
      );

      await engine.promoteGroupParticipants(groupId, participants);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to promote participants: ${error.message}`);
      throw new BadRequestException(`Failed to promote participants: ${error.message}`);
    }
  }

  /**
   * Demote participants from admin
   */
  async demoteParticipants(groupId: string, dto: DemoteParticipantsDto): Promise<{ success: boolean }> {
    const engine = await this.engineManager.getEngine(dto.profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${dto.profileId} not found or not connected`);
    }

    try {
      const participants = dto.participants.map(p => 
        p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`
      );

      await engine.demoteGroupParticipants(groupId, participants);
      
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to demote participants: ${error.message}`);
      throw new BadRequestException(`Failed to demote participants: ${error.message}`);
    }
  }

  /**
   * Leave a group
   */
  async leave(profileId: string, groupId: string): Promise<{ success: boolean }> {
    const engine = await this.engineManager.getEngine(profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${profileId} not found or not connected`);
    }

    try {
      await engine.leaveGroup(groupId);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to leave group: ${error.message}`);
      throw new BadRequestException(`Failed to leave group: ${error.message}`);
    }
  }

  /**
   * Get group invite link
   */
  async getInviteLink(profileId: string, groupId: string): Promise<{ link: string }> {
    const engine = await this.engineManager.getEngine(profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${profileId} not found or not connected`);
    }

    try {
      const link = await engine.getGroupInviteLink(groupId);
      return { link };
    } catch (error) {
      this.logger.error(`Failed to get invite link: ${error.message}`);
      throw new BadRequestException(`Failed to get invite link: ${error.message}`);
    }
  }

  /**
   * Revoke group invite link
   */
  async revokeInviteLink(profileId: string, groupId: string): Promise<{ link: string }> {
    const engine = await this.engineManager.getEngine(profileId);
    if (!engine) {
      throw new NotFoundException(`Profile ${profileId} not found or not connected`);
    }

    try {
      const link = await engine.revokeGroupInviteLink(groupId);
      return { link };
    } catch (error) {
      this.logger.error(`Failed to revoke invite link: ${error.message}`);
      throw new BadRequestException(`Failed to revoke invite link: ${error.message}`);
    }
  }
}
