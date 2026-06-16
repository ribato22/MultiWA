import { Global, Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

/** Makes TenantGuard injectable in any controller's @UseGuards(...). */
@Global()
@Module({
  providers: [TenantGuard],
  exports: [TenantGuard],
})
export class TenantModule {}
