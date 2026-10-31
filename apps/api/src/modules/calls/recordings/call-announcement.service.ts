// MultiWA Gateway - the announcement a caller hears before a recorded call
// apps/api/src/modules/calls/recordings/call-announcement.service.ts
//
// One per profile, in the recordings storage (private: it is the profile's own audio). Recording cannot be on without
// it, and it cannot be removed while recording is on: both rules sit in the settings writes themselves
// (mergeProfileSettingsIfAnnounced, removeAnnouncementUnlessRecording), so two admins at once cannot break them.
//
// Replacing or removing an announcement changes the settings only: its file is left to the nightly sweep, which
// deletes an announcement no profile points at once it is an hour old. A call that has just read the key can still
// play the file, and the sweep is the one delete path, with its own key check.
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Readable } from 'stream';
import { prisma } from '@multiwa/database';
import { announcementOf, mergeProfileSettings, removeAnnouncementUnlessRecording, type CallAnnouncement } from '../../profiles/profile-settings';
import { inspectAnnouncement } from './announcement-audio';
import { RECORDING_STORE, announcementKey, isAnnouncementOf, storageFailed, type RecordingStore } from './recording-store';

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
    await this.store.put(announcement.storageKey, file, audio.mimeType).catch(storageFailed(this.logger, `The announcement of profile ${clean(profileId)} was not stored`));
    if (!(await mergeProfileSettings(profileId, { callsAnnouncement: announcement }))) throw new NotFoundException('Profile not found');
    return { profileId, announcement: { mimeType: announcement.mimeType, durationSec: announcement.durationSec } };
  }

  /** The profile's announcement, to listen to; for a HEAD (`head`) sized, not read. */
  async read(profileId: string, head = false): Promise<{ mimeType: string; size: number; body: Readable | null }> {
    const profile = await this.profile(profileId);
    const announcement = announcementOf(profile.settings);
    // A key read from the settings is served only when it is the profile's own.
    if (!announcement || this.store.problem || !isAnnouncementOf(announcement.storageKey, profileId)) {
      throw new NotFoundException('This profile has no announcement');
    }
    const failed = storageFailed(this.logger, `The announcement of profile ${clean(profileId)} was not served`);
    const size = await this.store.size(announcement.storageKey).catch(failed);
    if (size === null) throw new NotFoundException('The announcement file is missing');
    const body = head ? null : await this.store.read(announcement.storageKey).catch((e: unknown) => {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') throw new NotFoundException('The announcement file is missing'); // gone since its size was read
      return failed(e);
    });
    return { mimeType: announcement.mimeType, size, body };
  }

  /** Removes the announcement; refused while recording is on (409 recording_on). */
  async remove(profileId: string): Promise<{ profileId: string; announcement: null }> {
    await this.profile(profileId); // a 404 before any write
    if (!(await removeAnnouncementUnlessRecording(profileId))) {
      if (!(await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true } }))) throw new NotFoundException('Profile not found');
      throw new ConflictException({ message: 'Turn recording off before removing the announcement', reasons: ['recording_on'] });
    }
    return { profileId, announcement: null };
  }

  private async profile(profileId: string): Promise<{ settings: unknown; organizationId: string }> {
    const row = await prisma.profile.findUnique({ where: { id: profileId }, select: { settings: true, workspace: { select: { organizationId: true } } } });
    if (!row?.workspace) throw new NotFoundException('Profile not found');
    return { settings: row.settings, organizationId: row.workspace.organizationId };
  }
}
