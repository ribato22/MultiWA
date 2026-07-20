// MultiWA Gateway API - Profiles Service
// apps/api/src/modules/profiles/profiles.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { EngineManagerService } from './engine-manager.service';
import { EngineCommandsService } from '../engine-commands/engine-commands.service';
import { isWorkerEngine } from '../../common/engine-host';

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
    // Engine commands client — used to drive the worker-hosted engine when
    // ENGINE_HOST=worker; unused (idle) when ENGINE_HOST=api.
    private readonly engineCommands: EngineCommandsService,
  ) {}

  async findAll(organizationId: string, workspaceId?: string) {
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId },
      select: { id: true },
    });

    const workspaceIds = workspaceId 
      ? [workspaceId] 
      : workspaces.map(w => w.id);

    const profiles = await prisma.profile.findMany({
      where: { workspaceId: { in: workspaceIds } },
      include: { 
        workspace: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Map fields for frontend compatibility
    return profiles.map(({ _count, ...profile }) => {
      let parsedSessionData = null;
      try {
        if (profile.sessionData) {
          parsedSessionData = typeof profile.sessionData === 'string' 
            ? JSON.parse(profile.sessionData) 
            : profile.sessionData;
        }
      } catch {}

      return {
        ...profile,
        name: profile.displayName,
        phone: profile.phoneNumber,
        sessionData: parsedSessionData,
        messageCount: _count?.messages || 0,
      };
    });
  }

  async findOne(id: string) {
    const profile = await prisma.profile.findUnique({
      where: { id },
      include: { workspace: true },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  async create(dto: CreateProfileDto, user: any) {
    // Verify workspace belongs to user's organization
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: dto.workspaceId,
        organizationId: user.organizationId,
      },
    });

    if (!workspace) {
      throw new BadRequestException('Workspace not found');
    }

    return prisma.profile.create({
      data: {
        workspaceId: dto.workspaceId,
        displayName: dto.name,
        engine: dto.engine ?? 'whatsapp-web-js',
        webhookUrl: dto.webhookUrl,
        webhookSecret: dto.webhookSecret,
      },
    });
  }

  async update(id: string, dto: UpdateProfileDto) {
    const existing = await this.findOne(id);

    // Build the update payload conditionally so a partial update never clobbers
    // existing columns with undefined/null.
    const data: Record<string, unknown> = {
      displayName: dto.name,
      webhookUrl: dto.webhookUrl,
      webhookSecret: dto.webhookSecret,
    };
    if (dto.messageDelayMs !== undefined) data.messageDelayMs = dto.messageDelayMs;
    if (dto.dailyMessageLimit !== undefined) data.dailyMessageLimit = dto.dailyMessageLimit;
    if (dto.messageDelayJitterMs !== undefined) data.messageDelayJitterMs = dto.messageDelayJitterMs;
    if (dto.warmupStartPerDay !== undefined) data.warmupStartPerDay = dto.warmupStartPerDay;
    if (dto.warmupRampDays !== undefined) data.warmupRampDays = dto.warmupRampDays;
    if (dto.serviceWindowHours !== undefined) data.serviceWindowHours = dto.serviceWindowHours;
    if (dto.coldDailyLimit !== undefined) data.coldDailyLimit = dto.coldDailyLimit;
    if (dto.warmupEnabled !== undefined) {
      data.warmupEnabled = dto.warmupEnabled;
      // Anchor the ramp at "today" each time warm-up is turned on (false -> true),
      // so the cap always starts fresh from warmupStartPerDay. Tweaking the numbers
      // while it is already on does not restart the ramp.
      const wasEnabled = (existing as any).warmupEnabled === true;
      if (dto.warmupEnabled && !wasEnabled) data.warmupStartedAt = new Date();
    }
    if (dto.engine !== undefined) data.engine = dto.engine;
    // Auto-reject-call config lives in the settings JSON — merge so we never clobber
    // other settings keys.
    if (dto.autoRejectCalls !== undefined || dto.autoRejectCallMessage !== undefined) {
      const settings = { ...(((existing as any).settings as Record<string, unknown>) || {}) };
      if (dto.autoRejectCalls !== undefined) settings.autoRejectCalls = dto.autoRejectCalls;
      if (dto.autoRejectCallMessage !== undefined) settings.autoRejectCallMessage = dto.autoRejectCallMessage;
      data.settings = settings;
    }

    const updated = await prisma.profile.update({ where: { id }, data });

    // An engine change only takes effect on the next reconnect (we do not force a
    // disconnect here — that would risk corrupting a live session).
    if (dto.engine !== undefined && dto.engine !== (existing as any).engine) {
      return {
        ...updated,
        warning:
          'Engine change will take effect on next reconnect. Clear the engine-specific session directory before reconnecting.',
      };
    }
    return updated;
  }

  async delete(id: string) {
    await this.findOne(id);
    
    // Disconnect if connected
    await this.disconnect(id).catch(() => {});
    
    await prisma.profile.delete({ where: { id } });
    return { success: true };
  }

  async connect(id: string) {
    const profile = await this.findOne(id);

    if (profile.status === 'connected') {
      return { status: 'already_connected', phone: profile.phoneNumber };
    }

    // Initialize the engine (emits QR via WebSocket). When ENGINE_HOST=worker the
    // engine lives in the worker, so delegate over the engine-commands queue.
    const result = isWorkerEngine()
      ? await this.engineCommands.connectProfile(id)
      : await this.engineManager.connectProfile(id);

    return {
      status: result.status,
      message: result.message,
    };
  }

  async disconnect(id: string) {
    await this.findOne(id);

    const result = isWorkerEngine()
      ? await this.engineCommands.disconnectProfile(id)
      : await this.engineManager.disconnectProfile(id);

    return { status: result.status };
  }

  async getStatus(id: string) {
    const profile = await this.findOne(id);
    const engineStatus = isWorkerEngine()
      ? await this.engineCommands.getEngineStatus(id)
      : this.engineManager.getEngineStatus(id);
    
    return {
      id: profile.id,
      name: profile.displayName,
      status: profile.status,
      phone: profile.phoneNumber,
      lastConnectedAt: profile.lastConnectedAt,
      engineConnected: engineStatus.isConnected,
    };
  }
}

