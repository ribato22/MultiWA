// MultiWA Gateway API - Server Owner Decorator
// apps/api/src/modules/auth/decorators/server-owner.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const SERVER_OWNER_KEY = 'serverOwnerOnly';

/** The route is for the server's owner (isServerOwner) only, on top of its @Roles. Checked by the auth guards. */
export const ServerOwnerOnly = () => SetMetadata(SERVER_OWNER_KEY, true);
