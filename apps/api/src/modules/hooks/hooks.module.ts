// MultiWA Gateway - Hooks Module
// apps/api/src/modules/hooks/hooks.module.ts

import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HooksService } from './hooks.service';
import { HooksController } from './hooks.controller';

/**
 * Global event hooks module using EventEmitter2.
 * Provides internal event bus + external webhook dispatching.
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      wildcard: true,        // Allow 'message.*' patterns
      delimiter: '.',         // Event namespace delimiter
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
  controllers: [HooksController],
  providers: [HooksService],
  exports: [HooksService],
})
export class HooksModule {}
