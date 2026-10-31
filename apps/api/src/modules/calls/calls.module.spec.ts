// Nothing injects CallRecordingsCron: only being a provider of CallsModule makes Nest build it, schedule the nightly
// recordings job and subscribe the reaction to a public storage. Without it every spec of the cron still passes.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CallsModule } from './calls.module';
import { CallRecordingsCron } from './recordings/call-recordings.cron';

describe('CallsModule', () => {
  it('provides the nightly recordings job and the reaction to a public storage', () => {
    expect(Reflect.getMetadata('providers', CallsModule)).toContain(CallRecordingsCron);
  });
});
