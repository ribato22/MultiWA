// MultiWA Gateway - Worker engine-command processor
// apps/worker/src/engine/engine-command-processor.ts
//
// Consumes the BullMQ 'engine-commands' queue (produced by the API's
// EngineCommandsService) and runs the operation against the worker-hosted engine.
// Result-bearing commands return a value the API awaits via QueueEvents.

import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EngineManagerService } from './engine-manager.service';

export class EngineCommandProcessor {
  private readonly logger = new Logger(EngineCommandProcessor.name);

  constructor(private readonly engineManager: EngineManagerService) {}

  async process(job: Job): Promise<any> {
    const { profileId } = job.data ?? {};
    switch (job.name) {
      case 'connect-profile':
        return this.engineManager.connectProfile(profileId);
      case 'disconnect-profile':
        return this.engineManager.disconnectProfile(profileId);
      case 'get-status':
        return this.engineManager.getEngineStatus(profileId);
      case 'contacts-sync':
        return this.requireEngine(profileId).getContacts();
      case 'presence-update':
        return this.requireEngine(profileId).sendPresenceUpdate(job.data.to, job.data.state);
      case 'mark-read':
        return this.requireEngine(profileId).markAsRead(job.data.chatId, job.data.messageIds);
      case 'delete-for-everyone':
        return this.requireEngine(profileId).deleteForEveryone(job.data.chatId, job.data.messageId);
      case 'group-op':
        return this.handleGroupOp(profileId, job.data.op, job.data.params ?? {});
      default:
        throw new Error(`Unknown engine command: ${job.name}`);
    }
  }

  private requireEngine(profileId: string): any {
    const engine = this.engineManager.getEngine(profileId);
    if (!engine) {
      const err: any = new Error(`Profile ${profileId} not connected`);
      err.code = 'ENGINE_NOT_CONNECTED';
      throw err;
    }
    return engine;
  }

  private toWaJids(participants: string[]): string[] {
    return participants.map((p) => (p.includes('@c.us') ? p : `${p.replace(/\D/g, '')}@c.us`));
  }

  // Mirrors apps/api GroupsService at service-method granularity.
  private async handleGroupOp(profileId: string, op: string, params: any): Promise<any> {
    const engine = this.requireEngine(profileId);
    switch (op) {
      case 'getAll': {
        const groups = await engine.getGroups();
        return groups.map((g: any) => ({
          id: g.id,
          name: g.name,
          description: g.description || '',
          owner: '',
          createdAt: new Date(),
          participantsCount: g.participantCount || g.participants?.length || 0,
        }));
      }
      case 'getById': {
        const group = await engine.getGroupInfo(params.groupId);
        if (!group) throw new Error(`Group ${params.groupId} not found`);
        return {
          id: group.id,
          name: group.name,
          description: group.description || '',
          owner: group.owner,
          createdAt: group.createdAt,
          participantsCount: group.participants?.length || 0,
          participants: group.participants?.map((p: any) => ({
            id: p.id,
            phone: p.id.replace('@c.us', '').replace('@s.whatsapp.net', ''),
            isAdmin: p.isAdmin || false,
            isSuperAdmin: p.isSuperAdmin || false,
          })),
        };
      }
      case 'create': {
        const participants = this.toWaJids(params.participants ?? []);
        const group = await engine.createGroup(params.name, participants);
        if (params.description && group.id) {
          await engine.setGroupDescription(group.id, params.description);
        }
        return {
          id: group.id,
          name: params.name,
          description: params.description || '',
          owner: group.owner || '',
          createdAt: new Date(),
          participantsCount: participants.length,
        };
      }
      case 'update': {
        if (params.name) await engine.setGroupName(params.groupId, params.name);
        if (params.description !== undefined) await engine.setGroupDescription(params.groupId, params.description);
        return { success: true };
      }
      case 'addParticipants':
        await engine.addGroupParticipants(params.groupId, this.toWaJids(params.participants ?? []));
        return { success: true, added: params.participants };
      case 'removeParticipants':
        await engine.removeGroupParticipants(params.groupId, this.toWaJids(params.participants ?? []));
        return { success: true, removed: params.participants };
      case 'promoteParticipants':
        await engine.promoteGroupParticipants(params.groupId, this.toWaJids(params.participants ?? []));
        return { success: true };
      case 'demoteParticipants':
        await engine.demoteGroupParticipants(params.groupId, this.toWaJids(params.participants ?? []));
        return { success: true };
      case 'leave':
        await engine.leaveGroup(params.groupId);
        return { success: true };
      case 'getInviteLink':
        return { link: await engine.getGroupInviteLink(params.groupId) };
      case 'revokeInviteLink':
        return { link: await engine.revokeGroupInviteLink(params.groupId) };
      default:
        throw new Error(`Unknown group op: ${op}`);
    }
  }
}
