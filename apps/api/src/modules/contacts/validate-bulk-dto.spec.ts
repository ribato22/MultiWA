// A bulk validation takes at most 1000 numbers: each is a database lookup.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ValidateBulkDto } from './dto';

const errorsFor = async (count: number) => validate(plainToInstance(ValidateBulkDto, { phones: Array.from({ length: count }, (_, i) => `62811${i}`) }));

describe('ValidateBulkDto', () => {
  it('takes 1000 numbers', async () => {
    expect(await errorsFor(1000)).toEqual([]);
  });

  it('refuses 1001', async () => {
    const [error] = await errorsFor(1001);
    expect(error?.constraints).toHaveProperty('arrayMaxSize');
  });
});
