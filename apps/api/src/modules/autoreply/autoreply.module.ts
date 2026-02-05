// MultiWA Gateway - Autoreply Module
// apps/api/src/modules/autoreply/autoreply.module.ts

import { Module } from '@nestjs/common';
import { AutoreplyController } from './autoreply.controller';
import { AutoreplyService } from './autoreply.service';

@Module({
  controllers: [AutoreplyController],
  providers: [AutoreplyService],
  exports: [AutoreplyService],
})
export class AutoreplyModule {}
