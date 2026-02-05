// apps/api/src/modules/workspaces/workspaces.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as crypto from 'crypto';

@Injectable()
export class WorkspacesService {
  async findAll(organizationId: string) {
    return prisma.workspace.findMany({
      where: { organizationId },
      include: { _count: { select: { profiles: true } } },
    });
  }

  async findById(id: string) {
    const ws = await prisma.workspace.findUnique({
      where: { id },
      include: { profiles: true },
    });
    if (!ws) throw new NotFoundException('Workspace not found');
    return ws;
  }

  async create(organizationId: string, dto: any) {
    return prisma.workspace.create({
      data: {
        organizationId,
        name: dto.name,
        slug: dto.slug || this.generateSlug(dto.name),
        description: dto.description,
      },
    });
  }

  async update(id: string, dto: any) {
    return prisma.workspace.update({
      where: { id },
      data: { name: dto.name, description: dto.description },
    });
  }

  async delete(id: string) {
    await prisma.workspace.delete({ where: { id } });
    return { success: true };
  }

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  }
}
