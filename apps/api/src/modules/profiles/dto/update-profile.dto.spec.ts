// UpdateProfileDto.callReplyMessage prefills the reply an agent sends from the Calls
// queue, and that reply is capped at 4096 characters, so the default is capped the same.

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { UpdateProfileDto } from './index';

const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const body = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: UpdateProfileDto, data: '' } as ArgumentMetadata);

describe('UpdateProfileDto callReplyMessage', () => {
  it('takes up to 4096 characters, the cap of a call reply', async () => {
    const text = 'x'.repeat(4096);
    await expect(body({ callReplyMessage: text })).resolves.toMatchObject({ callReplyMessage: text });
  });

  it('400 above 4096 characters', async () => {
    const err = await body({ callReplyMessage: 'x'.repeat(4097) }).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(err.getResponse())).toContain('callReplyMessage');
  });
});
