// MultiWA Gateway API - Accounts Service
// apps/api/src/modules/accounts/accounts.service.ts

import { Injectable, NotFoundException, Logger, Inject, forwardRef } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import { EngineManagerService } from '../profiles/engine-manager.service';
import { EngineCommandsService } from '../engine-commands/engine-commands.service';
import { isWorkerEngine } from '../../common/engine-host';

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(forwardRef(() => EngineManagerService))
    private readonly engineManager: EngineManagerService,
    private readonly engineCommands: EngineCommandsService,
  ) {}

  async findAll(userId: string) {
    // Get user's organization, then find all accounts in workspaces under that org
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: { include: { workspaces: true } } },
    });

    if (!user || !user.organization) {
      return [];
    }

    let workspaceIds = user.organization.workspaces?.map(w => w.id) || [];

    // Self-heal: an organization must always have at least one workspace.
    // Users created outside the normal register() flow can lack one, which
    // previously surfaced as "No account found" when creating a profile.
    if (workspaceIds.length === 0) {
      this.logger.warn(`Organization ${user.organization.id} has no workspace — creating default`);
      const workspace = await prisma.workspace.create({
        data: {
          organizationId: user.organization.id,
          name: 'Default',
          slug: 'default',
        },
      });
      workspaceIds = [workspace.id];
    }

    let accounts = await prisma.account.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: 'ACTIVE',
      },
      include: {
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (accounts.length === 0) {
      const account = await prisma.account.create({
        data: {
          workspaceId: workspaceIds[0],
          name: 'Default Account',
          description: 'Automatically created for WhatsApp profiles',
          settings: {},
        },
        include: {
          workspace: true,
        },
      });
      accounts = [account];
    }

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

    // Honor the engine chosen in the create UI. The admin sends it as
    // settings.engine; older callers may send `engine`. Persist to the
    // authoritative `engine` column (what EngineManager.resolveEngineType reads),
    // falling back to the production default for a missing/unknown value — so
    // the Baileys option in the UI is no longer silently dropped.
    const VALID_ENGINES = ['whatsapp-web-js', 'baileys', 'mock'];
    const requestedEngine = dto.settings?.engine ?? dto.engine;
    const engine = VALID_ENGINES.includes(requestedEngine) ? requestedEngine : 'whatsapp-web-js';

    return prisma.profile.create({
      data: {
        accountId: accountId,
        workspaceId: account.workspaceId,
        displayName: dto.name || dto.displayName,
        phoneNumber: dto.phoneNumber || dto.phone,
        status: 'DISCONNECTED',
        engine,
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
    
    // Initialize the engine (emits QR via WebSocket). Delegate to the worker over
    // the engine-commands queue when ENGINE_HOST=worker.
    const result = isWorkerEngine()
      ? await this.engineCommands.connectProfile(profileId)
      : await this.engineManager.connectProfile(profileId);

    return {
      success: true,
      status: result.status,
      message: result.message,
    };
  }

  async disconnectProfile(accountId: string, profileId: string) {
    this.logger.log(`Disconnecting profile ${profileId} for account ${accountId}`);

    const result = isWorkerEngine()
      ? await this.engineCommands.disconnectProfile(profileId)
      : await this.engineManager.disconnectProfile(profileId);

    return { 
      success: true, 
      status: result.status,
      message: 'Disconnected',
    };
  }

  async getQr(_accountId: string, _profileId: string) {
    // This would integrate with the WhatsApp engine to get QR code
    // For now return a placeholder
    return {
      qr: null,
      status: 'pending',
      message: 'QR code generation in progress',
    };
  }
}
