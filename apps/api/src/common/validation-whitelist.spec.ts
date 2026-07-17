// Locks the global ValidationPipe whitelist contract (mirrors main.ts config):
// unknown request-body fields are stripped (mass-assignment defense), and the DTO
// fields that were newly decorated in this change survive.

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ValidationPipe, ArgumentMetadata } from '@nestjs/common';
import { CreateAutoreplyDto } from '../modules/autoreply/dto';
import { AssignRoleDto } from '../modules/rbac/dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const bodyMeta = (metatype: any): ArgumentMetadata => ({ type: 'body', metatype, data: '' });

describe('ValidationPipe whitelist', () => {
  it('keeps CreateAutoreplyDto fields and strips unknown/execution-state fields', async () => {
    const out: any = await pipe.transform(
      {
        profileId: 'p1',
        keywords: ['hi'],
        response: 'hello',
        isActive: false,
        cooldownSecs: 30,
        // hostile extras that must be dropped:
        status: 'HACK',
        cursor: 9,
        id: 'forged',
      },
      bodyMeta(CreateAutoreplyDto),
    );

    expect(out.profileId).toBe('p1');
    expect(out.keywords).toEqual(['hi']);
    expect(out.response).toBe('hello');
    expect(out.isActive).toBe(false);
    expect(out.cooldownSecs).toBe(30);
    expect('status' in out).toBe(false);
    expect('cursor' in out).toBe(false);
    expect('id' in out).toBe(false);
  });

  it('rejects a CreateAutoreplyDto missing now-required fields', async () => {
    // keywords + response are required — before decorators this passed and 500'd downstream.
    await expect(pipe.transform({ profileId: 'p1' }, bodyMeta(CreateAutoreplyDto))).rejects.toBeTruthy();
  });

  it('keeps AssignRoleDto ids and strips extras', async () => {
    const out: any = await pipe.transform(
      { userId: 'u1', roleId: 'r1', organizationId: 'forged', extra: 'x' },
      bodyMeta(AssignRoleDto),
    );
    expect(out.userId).toBe('u1');
    expect(out.roleId).toBe('r1');
    expect('organizationId' in out).toBe(false); // not a field on AssignRoleDto → stripped
    expect('extra' in out).toBe(false);
  });
});
