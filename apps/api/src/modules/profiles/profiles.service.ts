// MultiWA Gateway API - Profiles Service
// apps/api/src/modules/profiles/profiles.service.ts

import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { CreateProfileDto, UpdateProfileDto } from './dto';
import { EngineManagerService } from './engine-manager.service';

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
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
        webhookUrl: dto.webhookUrl,
        webhookSecret: dto.webhookSecret,
      },
    });
  }

  async update(id: string, dto: UpdateProfileDto) {
    await this.findOne(id);

    return prisma.profile.update({
      where: { id },
      data: {
        displayName: dto.name,
        webhookUrl: dto.webhookUrl,
        webhookSecret: dto.webhookSecret,
      },
    });
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

    // Use EngineManager to handle connection
    // This will initialize the engine and emit QR code via WebSocket
    const result = await this.engineManager.connectProfile(id);
    
    return { 
      status: result.status,
      message: result.message,
    };
  }

  async disconnect(id: string) {
    await this.findOne(id);

    // Use EngineManager to handle disconnection
    const result = await this.engineManager.disconnectProfile(id);

    return { status: result.status };
  }

  async getStatus(id: string) {
    const profile = await this.findOne(id);
    const engineStatus = this.engineManager.getEngineStatus(id);
    
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

