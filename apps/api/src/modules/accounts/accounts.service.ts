// MultiWA Gateway API - Accounts Service
// apps/api/src/modules/accounts/accounts.service.ts

import { Injectable, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { EngineManagerService } from '../profiles/engine-manager.service';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
  ) {}

  async findAll(userId: string) {
    // Get user's organization, then find all accounts in workspaces under that org
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { include: { workspaces: true } } },
    });

    if (!user) {
      return [];
    }

    const workspaceIds = user.organization?.workspaces?.map(w => w.id) || [];

    const accounts = await prisma.account.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: 'ACTIVE',
      },
      include: {
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return accounts;
  }

  async findOne(id: string) {
    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        workspace: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return account;
  }

  async create(dto: any, userId: string) {
    // Get user's first workspace
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { include: { workspaces: true } } },
    });

    const workspaceId = user?.organization?.workspaces?.[0]?.id;

    if (!workspaceId) {
      throw new NotFoundException('No workspace found');
    }

    return prisma.account.create({
      data: {
        workspaceId,
        name: dto.name || 'New Account',
        description: dto.description,
        settings: dto.settings || {},
      },
    });
  }

  async update(id: string, dto: any) {
    return prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        settings: dto.settings,
      },
    });
  }

  async remove(id: string) {
    return prisma.account.update({
      where: { id },
      data: { status: 'DELETED' },
    });
  }

  // Profile-related methods
  // Note: Profiles are linked via workspaceId, not accountId in current schema
  async getProfiles(accountId: string) {
    // Get account to get its workspaceId
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      return [];
    }
    
    return prisma.profile.findMany({
      where: { workspaceId: account.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProfile(accountId: string, dto: any) {
    this.logger.log(`Creating profile for account ${accountId}: ${JSON.stringify(dto)}`);
    
    // Get account to get its workspaceId
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new NotFoundException('Account not found');
    }

    return prisma.profile.create({
      data: {
        accountId: accountId,
        workspaceId: account.workspaceId,
        displayName: dto.name || dto.displayName,
        phoneNumber: dto.phoneNumber || dto.phone,
        status: 'DISCONNECTED',
        settings: {},
      },
    });
  }

  async getProfile(accountId: string, profileId: string) {
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return profile;
  }

  async deleteProfile(accountId: string, profileId: string) {
    return prisma.profile.delete({
      where: { id: profileId },
    });
  }

  async connectProfile(accountId: string, profileId: string) {
    this.logger.log(`Connecting profile ${profileId} for account ${accountId}`);
    
    // Use EngineManager to handle connection
    // This will initialize the engine and emit QR code via WebSocket
    const result = await this.engineManager.connectProfile(profileId);

    return { 
      success: true, 
      status: result.status,
      message: result.message,
    };
  }

  async disconnectProfile(accountId: string, profileId: string) {
    this.logger.log(`Disconnecting profile ${profileId} for account ${accountId}`);
    
    // Use EngineManager to handle disconnection
    const result = await this.engineManager.disconnectProfile(profileId);

    return { 
      success: true, 
      status: result.status,
      message: 'Disconnected',
    };
  }

  async getQr(accountId: string, profileId: string) {
    // This would integrate with the WhatsApp engine to get QR code
    // For now return a placeholder
    return {
      qr: null,
      status: 'pending',
      message: 'QR code generation in progress',
    };
  }
}
