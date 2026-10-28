// UpdateProfileDto: the quiet-profile alarm settings.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { UpdateProfileDto } from './index';

const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const body = (value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: UpdateProfileDto, data: '' } as ArgumentMetadata) as Promise<Record<string, unknown>>;
const refused = async (value: unknown, field: string) => {
  const err = await body(value).then(() => null, (e) => e);
  expect(err).toBeInstanceOf(BadRequestException);
  expect(JSON.stringify(err.getResponse())).toContain(field);
};

describe('UpdateProfileDto quiet-profile alarm', () => {
  it('takes 1-72 hours, or null to turn the alarm off', async () => {
    await expect(body({ quietAlarmHours: 2 })).resolves.toMatchObject({ quietAlarmHours: 2 });
    await expect(body({ quietAlarmHours: null })).resolves.toMatchObject({ quietAlarmHours: null });
  });

  it('refuses hours outside 1-72 or not whole', async () => {
    await refused({ quietAlarmHours: 0 }, 'quietAlarmHours');
    await refused({ quietAlarmHours: 73 }, 'quietAlarmHours');
    await refused({ quietAlarmHours: 1.5 }, 'quietAlarmHours');
  });

  it('takes up to 5 WhatsApp recipients', async () => {
    const to = ['628123456789', '628123456780@s.whatsapp.net'];
    await expect(body({ quietAlarmNotify: to })).resolves.toMatchObject({ quietAlarmNotify: to });
  });

  it('refuses more than 5 recipients, or one that is not a WhatsApp number', async () => {
    await refused({ quietAlarmNotify: ['628123456781', '628123456782', '628123456783', '628123456784', '628123456785', '628123456786'] }, 'quietAlarmNotify');
    await refused({ quietAlarmNotify: ['not-a-number'] }, 'quietAlarmNotify');
  });
});
