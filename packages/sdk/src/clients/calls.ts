// MultiWA Gateway SDK - Calls Client
// packages/sdk/src/clients/calls.ts

import type { MultiWAClient } from '../client';
import type {
  BinaryResponse,
  Call,
  CallAnnouncementResult,
  CallLinkResult,
  CallList,
  CallReplyResult,
  CallsMediaStatus,
  CallsSettings,
  DeletedCallRecording,
  ListCallsOptions,
  UpdateCallOptions,
  UpdateCallsSettingsOptions,
} from '../types';

/**
 * Incoming WhatsApp calls: the follow-up queue, the readiness of answering them in the dashboard, the recordings and
 * the announcement. Agents answer calls in the dashboard; follow them with the `call.*` webhooks.
 */
export class CallClient {
  constructor(private client: MultiWAClient) {}

  /**
   * A page of a profile's calls, newest first. Pass `nextCursor` back as `cursor` for the next page.
   */
  async list(profileId: string, options?: ListCallsOptions): Promise<CallList> {
    return this.client.get('/calls', { profileId, ...options });
  }

  /**
   * How many calls of the organization have their follow-up open
   */
  async openCount(): Promise<{ count: number }> {
    return this.client.get('/calls/open-count');
  }

  /**
   * Get a call by ID
   */
  async get(id: string): Promise<Call> {
    return this.client.get(`/calls/${id}`);
  }

  /**
   * Change the follow-up or the assignee; `assignedUserId: null` unassigns
   */
  async update(id: string, data: UpdateCallOptions): Promise<Call> {
    return this.client.patch(`/calls/${id}`, data);
  }

  /**
   * Reject a call that is still ringing
   */
  async reject(id: string): Promise<Call> {
    return this.client.post(`/calls/${id}/reject`);
  }

  /**
   * Send a text to the caller, through the send gate. Without one, the profile's default call reply.
   */
  async reply(id: string, text?: string): Promise<CallReplyResult> {
    return this.client.post(`/calls/${id}/reply`, { text });
  }

  /**
   * Create a WhatsApp call link and send it to the caller, with an optional text above it
   */
  async sendCallLink(id: string, type: 'voice' | 'video', text?: string): Promise<CallLinkResult> {
    return this.client.post(`/calls/${id}/call-link`, { type, text });
  }

  /**
   * Readiness of answering calls in the dashboard: the server, its recordings storage, and every profile with its
   * call settings (owner or admin)
   */
  async mediaStatus(): Promise<CallsMediaStatus> {
    return this.client.get('/calls/media/status');
  }

  /**
   * The call's recording, audio/webm (owner or admin; an API key with a scope list needs `recordings:read`). Every
   * read is audited, `download: true` as a download.
   */
  async getRecording(id: string, options?: { download?: boolean }): Promise<BinaryResponse> {
    return this.client.request('GET', `/calls/${id}/recording`, {
      query: { download: options?.download ? '1' : undefined },
      binary: true,
    });
  }

  /**
   * Delete the call's recording: the file goes, its row stays as evidence (`recordings:delete`)
   */
  async deleteRecording(id: string): Promise<DeletedCallRecording> {
    return this.client.delete(`/calls/${id}/recording`);
  }

  /**
   * A profile's call settings (owner or admin; an API key with a scope list needs `profiles:write`, and
   * `recordings:delete` too for `retentionDays`). A setting that cannot be turned on is refused with 409: the
   * error's `details.reasons` says why.
   */
  async updateSettings(profileId: string, settings: UpdateCallsSettingsOptions): Promise<CallsSettings> {
    return this.client.put(`/profiles/${profileId}/calls-settings`, settings);
  }

  /**
   * Upload the announcement callers hear before a recorded call: mp3, wav, ogg, webm or m4a, at most 2 MB and 30
   * seconds. The server reads the type and the length from the file itself.
   */
  async uploadAnnouncement(profileId: string, file: Blob | Uint8Array, filename = 'announcement'): Promise<CallAnnouncementResult> {
    const form = new FormData();
    form.append('file', file instanceof Blob ? file : new Blob([new Uint8Array(file)]), filename);
    return this.client.post(`/profiles/${profileId}/calls-announcement`, form);
  }

  /**
   * The profile's announcement, to listen to
   */
  async getAnnouncement(profileId: string): Promise<BinaryResponse> {
    return this.client.request('GET', `/profiles/${profileId}/calls-announcement`, { binary: true });
  }

  /**
   * Remove the announcement; refused with 409 (`recording_on`) while recording is on
   */
  async deleteAnnouncement(profileId: string): Promise<CallAnnouncementResult> {
    return this.client.delete(`/profiles/${profileId}/calls-announcement`);
  }
}
