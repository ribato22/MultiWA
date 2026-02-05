// apps/api/src/modules/organizations/organizations.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as bcrypt from 'bcrypt';

@Injectable()
export class OrganizationsService {
  async findById(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: { workspaces: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, dto: any) {
    return prisma.organization.update({
      where: { id },
      data: { name: dto.name, settings: dto.settings },
    });
  }

  // ── Member Management ──

  async listMembers(organizationId: string) {
    return prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(organizationId: string, dto: { email: string; name: string; role?: string }) {
    // Check if email already used
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    // Create member with a temporary password
    const tempPassword = Math.random().toString(36).slice(-10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const user = await prisma.user.create({
      data: {
        organizationId,
        email: dto.email,
        name: dto.name,
        role: dto.role || 'member',
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return { ...user, temporaryPassword: tempPassword };
  }

  async updateMemberRole(organizationId: string, memberId: string, role: string) {
    const member = await prisma.user.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException('Cannot change the role of the organization owner');
    }

    return prisma.user.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  }

  async removeMember(organizationId: string, requesterId: string, memberId: string) {
    if (requesterId === memberId) {
      throw new BadRequestException('You cannot remove yourself');
    }
    const member = await prisma.user.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    await prisma.user.delete({ where: { id: memberId } });
    return { success: true };
  }
}
