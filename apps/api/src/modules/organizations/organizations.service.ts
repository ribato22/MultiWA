// apps/api/src/modules/organizations/organizations.service.ts
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { prisma } from '@multiwa/database';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { withoutLookupSecret } from '../customers/customer-settings';

// Roles that may be assigned through member-management endpoints. `owner` is
// deliberately excluded: ownership is set when the org is created and is not
// mintable here, so an admin can never escalate a member (or themselves) to
// owner via addMember/updateMemberRole.
const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'];

/** Who asks for a team change: their id and role, from the request. */
type Requester = { id: string; role: string };

@Injectable()
export class OrganizationsService {
  private assertAssignableRole(role: string | undefined) {
    if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) {
      throw new BadRequestException(
        `Invalid role "${role}". Allowed: ${ASSIGNABLE_ROLES.join(', ')}`,
      );
    }
  }

  async findById(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: { workspaces: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return withoutLookupSecret(org);
  }

  // settings.customers holds the customer lookup's settings, written by PUT /customers/config, which checks the URL and
  // encrypts the secret. An update here keeps them, whatever settings it is sent. The row is locked before they are
  // read, so a save of them made meanwhile is not written back over.
  async update(id: string, dto: any) {
    const { name, settings } = dto;
    if (!settings || typeof settings !== 'object') {
      return withoutLookupSecret(await prisma.organization.update({ where: { id }, data: { name, settings } }));
    }
    const { customers: _sent, ...rest } = settings;
    return withoutLookupSecret(
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${id} FOR UPDATE`;
        const current = await tx.organization.findUnique({ where: { id }, select: { settings: true } });
        const kept = (current?.settings as Record<string, unknown> | null)?.customers;
        return tx.organization.update({ where: { id }, data: { name, settings: kept === undefined ? rest : { ...rest, customers: kept } } });
      }),
    );
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

  async addMember(organizationId: string, requester: Requester, dto: { email: string; name: string; role?: string }) {
    this.assertAssignableRole(dto.role);
    if (dto.role === 'admin' && requester.role !== 'owner') {
      throw new ForbiddenException('Only the owner can add an admin');
    }

    // Check if email already used
    const existing = await prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }

    // Create member with a temporary password. Must be cryptographically random:
    // Math.random() is a predictable PRNG, so a temp LOGIN password minted with it
    // is guessable -> account takeover before first login.
    const tempPassword = crypto.randomBytes(12).toString('base64url');
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

  async updateMemberRole(organizationId: string, requester: Requester, memberId: string, role: string) {
    this.assertAssignableRole(role);
    if (requester.id === memberId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const member = await prisma.user.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException('Cannot change the role of the organization owner');
    }
    if ((member.role === 'admin' || role === 'admin') && requester.role !== 'owner') {
      throw new ForbiddenException('Only the owner can make someone admin or change an admin');
    }

    return prisma.user.update({
      where: { id: memberId },
      data: { role },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  }

  async removeMember(organizationId: string, requester: Requester, memberId: string) {
    if (requester.id === memberId) {
      throw new BadRequestException('You cannot remove yourself');
    }
    const member = await prisma.user.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }
    if (member.role === 'admin' && requester.role !== 'owner') {
      throw new ForbiddenException('Only the owner can remove an admin');
    }

    await prisma.user.delete({ where: { id: memberId } });
    return { success: true };
  }
}
