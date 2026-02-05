// MultiWA Gateway - Contacts Module
// apps/api/src/modules/contacts/contacts.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
