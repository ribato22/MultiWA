import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { redactUrlCredentials } from './redis-cache.adapter';

describe('redactUrlCredentials', () => {
  it.each([
    ['redis://:s3cret@redis:6379', 'redis://***@redis:6379'],
    ['redis://default:s3cret@redis:6379/0', 'redis://***@redis:6379/0'],
    ['rediss://user:p%40ss@cache.example.com:6380', 'rediss://***@cache.example.com:6380'],
    ['redis://:pa@ss@redis:6379', 'redis://***@redis:6379'],
  ])('hides the credentials in %s', (url, expected) => {
    expect(redactUrlCredentials(url)).toBe(expected);
  });

  it('leaves a URL without credentials alone', () => {
    expect(redactUrlCredentials('redis://localhost:6379')).toBe('redis://localhost:6379');
    expect(redactUrlCredentials('redis://redis:6379/0')).toBe('redis://redis:6379/0');
  });

  it('never leaves the password behind', () => {
    expect(redactUrlCredentials('redis://:hunter2@redis:6379')).not.toContain('hunter2');
  });
});

// The password used to be logged verbatim at every startup. The helper above is only
// worth anything while the log call keeps using it, so pin the call site too.
describe('RedisCacheAdapter startup log', () => {
  const source = readFileSync(path.join(__dirname, 'redis-cache.adapter.ts'), 'utf8');

  it('logs the redacted URL, never the raw one', () => {
    expect(source).toContain('redactUrlCredentials(this.redisUrl)');
    expect(source).not.toMatch(/\$\{this\.redisUrl\}/);
  });
});
