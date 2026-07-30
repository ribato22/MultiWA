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
import { EngineCommandsService } from '../engine-commands/engine-commands.service';
import { isWorkerEngine } from '../../common/engine-host';
import { prisma } from '@multiwa/database';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InternalEvents } from '../../metrics/internal-events';

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
    // Routes group operations to the worker-hosted engine when ENGINE_HOST=worker.
    private readonly engineCommands: EngineCommandsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Report which source served a group list. `fallback` means the live engine call
   * failed, which is the early-warning signal that the engine's chat Store broke —
   * previously this degradation was silent (only a log line) and went unnoticed for
   * ~10 days. Never allowed to affect the response.
   */
  private reportGroupFetch(profileId: string, source: 'live' | 'fallback', count: number): void {
    try {
      this.eventEmitter.emit(InternalEvents.ENGINE_GROUP_FETCH, { profileId, source, count });
    } catch {
      /* telemetry must never break the group list */
    }
  }

  /**
   * Get all groups for a profile
   */
  async getAll(profileId: string): Promise<GroupInfo[]> {
    // Try the live engine first (freshest membership counts), but never let a flaky
    // engine call empty the group list: whatsapp-web.js getGroups can throw (e.g. a
    // WhatsApp Web build whose group Store isn't hooked) while send still works. Fall
    // back to the groups persisted from message history so the picker stays usable.
    try {
      const live = isWorkerEngine()
        ? await this.engineCommands.groupOp(profileId, 'getAll', {})
        : await this.getFromLiveEngine(profileId);
      if (Array.isArray(live) && live.length > 0) {
        this.reportGroupFetch(profileId, 'live', live.length);
        return live;
      }
    } catch (error: any) {
      this.logger.warn(`Live getGroups failed for ${profileId} (${error?.message}); using stored groups`);
    }
    const stored = await this.getGroupsFromDb(profileId);
    this.reportGroupFetch(profileId, 'fallback', stored.length);
    return stored;
  }

  private async getFromLiveEngine(profileId: string): Promise<GroupInfo[]> {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      this.logger.warn(`Profile ${profileId} not connected; using stored groups`);
      return [];
    }
    // Add timeout to prevent indefinite hang (30 seconds)
    const timeoutMs = 30000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`getGroups timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    const groups = await Promise.race([engine.getGroups(), timeoutPromise]);
    this.logger.log(`Mapping ${groups.length} live groups for profile ${profileId}`);
    return groups.map(g => ({
      id: g.id,
      name: g.name,
      description: g.description || '',
      owner: '',
      createdAt: new Date(),
      participantsCount: g.participantCount || g.participants?.length || 0,
    }));
  }

  /**
   * Fallback source: groups persisted from message history (conversations of type
   * "group"). Resilient to engine / WhatsApp-Web-version issues that break the live
   * getGroups call, so the group picker never silently empties.
   */
  private async getGroupsFromDb(profileId: string): Promise<GroupInfo[]> {
    const convs = await prisma.conversation.findMany({
      where: { profileId, OR: [{ type: 'group' }, { jid: { endsWith: '@g.us' } }] },
      orderBy: { updatedAt: 'desc' },
    });
    return convs.map((c) => ({
      id: c.jid,
      name: c.name || 'Group Chat',
      description: '',
      owner: '',
      createdAt: c.createdAt,
      participantsCount: 0,
    }));
  }

  /**
   * Get detailed group info including participants
   */
  async getById(profileId: string, groupId: string): Promise<GroupInfo> {
    if (isWorkerEngine()) return this.engineCommands.groupOp(profileId, 'getById', { groupId });
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
        owner: group.owner || '',
        createdAt: group.createdAt || new Date(),
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'create', { name: dto.name, description: dto.description, participants: dto.participants });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'update', { groupId, name: dto.name, description: dto.description });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'addParticipants', { groupId, participants: dto.participants });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'removeParticipants', { groupId, participants: dto.participants });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'promoteParticipants', { groupId, participants: dto.participants });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(dto.profileId, 'demoteParticipants', { groupId, participants: dto.participants });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(profileId, 'leave', { groupId });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(profileId, 'getInviteLink', { groupId });
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
    if (isWorkerEngine()) return this.engineCommands.groupOp(profileId, 'revokeInviteLink', { groupId });
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
