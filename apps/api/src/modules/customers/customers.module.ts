// MultiWA Gateway API - Customers Module
// apps/api/src/modules/customers/customers.module.ts

import { Module } from '@nestjs/common';
import { CustomerLookupService } from './customer-lookup.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLookupService],
})
export class CustomersModule {}
