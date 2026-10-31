// MultiWA Gateway - the announcement a caller hears before a recorded call
// apps/api/src/modules/calls/recordings/call-announcement.service.ts
//
// One per profile, in the recordings storage (private: it is the profile's own audio). Recording cannot be on without
// it, and it cannot be removed while recording is on: both rules sit in the settings writes themselves
// (mergeProfileSettingsIfAnnounced, removeAnnouncementUnlessRecording), so two admins at once cannot break them.
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'stream';
import { prisma } from '@multiwa/database';
import { announcementOf, mergeProfileSettings, removeAnnouncementUnlessRecording, type CallAnnouncement } from '../../profiles/profile-settings';
import { inspectAnnouncement } from './announcement-audio';
import { RECORDING_STORE, announcementKey, isAnnouncementOf, type RecordingStore } from './recording-store';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

@Injectable()
export class CallAnnouncementService {
  private readonly logger = new Logger(CallAnnouncementService.name);

  constructor(@Inject(RECORDING_STORE) private readonly store: RecordingStore) {}

  /** Stores a new announcement (its type and length read from the file) in place of the profile's previous one. */
  async upload(profileId: string, file: Buffer): Promise<{ profileId: string; announcement: Omit<CallAnnouncement, 'storageKey'> }> {
    const profile = await this.profile(profileId);
    if (this.store.problem) throw new ConflictException({ message: 'The call recordings storage is not configured on this server', reasons: ['recordings_storage_unset'] });
    const audio = await inspectAnnouncement(file);
    const announcement: CallAnnouncement = { storageKey: announcementKey(profile.organizationId, profileId, audio.ext), mimeType: audio.mimeType, durationSec: audio.durationSec };
    await this.store.put(announcement.storageKey, file, audio.mimeType);
    if (!(await mergeProfileSettings(profileId, { callsAnnouncement: announcement }))) {
      await this.forget(announcement.storageKey);
      throw new NotFoundException('Profile not found');
    }
    const previous = announcementOf(profile.settings);
    if (previous && previous.storageKey !== announcement.storageKey) await this.forget(previous.storageKey);
    return { profileId, announcement: { mimeType: announcement.mimeType, durationSec: announcement.durationSec } };
  }

  /** The profile's announcement, to listen to. */
  async read(profileId: string): Promise<{ mimeType: string; size: number; body: Readable }> {
    const profile = await this.profile(profileId);
    const announcement = announcementOf(profile.settings);
    // A key read from the settings is served only when it is the profile's own.
    if (!announcement || this.store.problem || !isAnnouncementOf(announcement.storageKey, profile.organizationId, profileId)) {
      throw new NotFoundException('This profile has no announcement');
    }
    const size = await this.store.size(announcement.storageKey);
    if (size === null) throw new NotFoundException('The announcement file is missing');
    return { mimeType: announcement.mimeType, size, body: await this.store.read(announcement.storageKey) };
  }

  /** Removes the announcement; refused while recording is on (409 recording_on). */
  async remove(profileId: string): Promise<{ profileId: string; announcement: null }> {
    const announcement = announcementOf((await this.profile(profileId)).settings);
    if (!(await removeAnnouncementUnlessRecording(profileId))) {
      if (!(await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } }))) throw new NotFoundException('Profile not found');
      throw new ConflictException({ message: 'Turn recording off before removing the announcement', reasons: ['recording_on'] });
    }
    if (announcement) await this.forget(announcement.storageKey);
    return { profileId, announcement: null };
  }

  private async profile(profileId: string): Promise<{ settings: unknown; organizationId: string }> {
    const row = await prisma.profile.findUnique({ where: { id: profileId }, select: { settings: true, workspace: { select: { organizationId: true } } } });
    if (!row?.workspace) throw new NotFoundException('Profile not found');
    return { settings: row.settings, organizationId: row.workspace.organizationId };
  }

  private async forget(key: string): Promise<void> {
    await this.store.delete(key).catch((e) => this.logger.warn(`An announcement file was not deleted (the nightly sweep will): ${clean((e as Error)?.message ?? e)}`));
  }
}
