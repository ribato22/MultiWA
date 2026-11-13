// MultiWA Gateway API - Sentry, when SENTRY_DSN is set
// apps/api/src/instrument.ts
//
// main.ts imports this before anything else. What is sent, and what never is: @multiwa/engine-runtime's sentry.ts.
import * as Sentry from '@sentry/nestjs';
import { sentryOptions } from '@multiwa/engine-runtime';

const options = sentryOptions('api', __dirname);
if (options) Sentry.init(options);
