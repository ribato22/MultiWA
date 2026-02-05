// MultiWA Gateway Core - Profile Repository Port
// packages/core/src/ports/profile-repository.port.ts

import type { Profile, CreateProfileInput, UpdateProfileInput } from '../entities/profile.entity';

export interface IProfileRepository {
  findById(id: string): Promise<Profile | null>;
  findByWorkspaceId(workspaceId: string): Promise<Profile[]>;
  findByPhone(phone: string): Promise<Profile | null>;
  create(input: CreateProfileInput): Promise<Profile>;
  update(id: string, input: UpdateProfileInput): Promise<Profile>;
  updateStatus(id: string, status: Profile['status']): Promise<void>;
  updateSessionData(id: string, sessionData: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
}
