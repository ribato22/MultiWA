// MultiWA Gateway - RBAC Module
// apps/api/src/modules/rbac/rbac.module.ts

import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { RbacGuard } from './rbac.guard';

@Module({
  controllers: [RbacController],
  providers: [RbacService, RbacGuard],
  exports: [RbacService, RbacGuard],
})
export class RbacModule {}
