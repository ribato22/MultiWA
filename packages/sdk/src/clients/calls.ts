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
   * A page of a profile's calls, newest first (any role; an API key needs no scope). Pass `nextCursor` back as
   * `cursor` for the next page.
   */
  async list(profileId: string, options?: ListCallsOptions): Promise<CallList> {
    return this.client.get('/calls', { profileId, ...options });
  }

  /**
   * How many calls of the organization have their follow-up open (any role; an API key needs no scope)
   */
  async openCount(): Promise<{ count: number }> {
    return this.client.get('/calls/open-count');
  }

  /**
   * Get a call by ID (any role; an API key needs no scope)
   */
  async get(id: string): Promise<Call> {
    return this.client.get(`/calls/${id}`);
  }

  /**
   * Change the follow-up or the assignee (any role; an API key needs no scope); `assignedUserId: null` unassigns
   */
  async update(id: string, data: UpdateCallOptions): Promise<Call> {
    return this.client.patch(`/calls/${id}`, data);
  }

  /**
   * Reject a call that is still ringing (any role; an API key needs no scope)
   */
  async reject(id: string): Promise<Call> {
    return this.client.post(`/calls/${id}/reject`);
  }

  /**
   * Send a text to the caller, through the send gate (any role; an API key with a scope list needs `messages:write`).
   * Without one, the profile's default call reply. Resolves to the call and the message sent: an `open` follow-up is
   * now `in_progress`, any other is left as it was.
   */
  async reply(id: string, text?: string): Promise<CallReplyResult> {
    return this.client.post(`/calls/${id}/reply`, { text });
  }

  /**
   * Create a WhatsApp call link and send it to the caller, with an optional text above it (any role; an API key with
   * a scope list needs `messages:write`). Resolves to the call, the message sent and the link: an `open` follow-up is
   * now `in_progress`, any other is left as it was.
   */
  async sendCallLink(id: string, type: 'voice' | 'video', text?: string): Promise<CallLinkResult> {
    return this.client.post(`/calls/${id}/call-link`, { type, text });
  }

  /**
   * Readiness of answering calls in the dashboard: the server, its recordings storage, and every profile with its
   * call settings (owner or admin; an API key needs no scope)
   */
  async mediaStatus(): Promise<CallsMediaStatus> {
    return this.client.get('/calls/media/status');
  }

  /**
   * The call's recording, audio/webm (owner or admin; an API key with a scope list needs `recordings:read`). Every
   * read is audited, `download: true` as a download. The client's `timeout` covers the whole download: a long
   * recording may need a larger one.
   */
  async getRecording(id: string, options?: { download?: boolean }): Promise<BinaryResponse> {
    return this.client.request('GET', `/calls/${id}/recording`, {
      query: { download: options?.download ? '1' : undefined },
      binary: true,
    });
  }

  /**
   * Delete the call's recording: the file goes, its row stays as evidence (owner or admin; an API key with a scope
   * list needs `recordings:delete`)
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
   * Upload the announcement callers hear before a recorded call (owner or admin; an API key with a scope list needs
   * `profiles:write`): mp3, wav, ogg, webm or m4a, at most 2 MB and 30 seconds. The server reads the type and the
   * length from the file itself, not from its name, which is `filename` or by default a File's own name, else
   * `announcement`.
   */
  async uploadAnnouncement(profileId: string, file: Blob | Uint8Array, filename?: string): Promise<CallAnnouncementResult> {
    const form = new FormData();
    // Read without `instanceof File`: Node 18 has no global File.
    const name = filename ?? ((file as { name?: string }).name || 'announcement');
    form.append('file', file instanceof Blob ? file : new Blob([new Uint8Array(file)]), name);
    return this.client.post(`/profiles/${profileId}/calls-announcement`, form);
  }

  /**
   * The profile's announcement, to listen to (owner or admin; an API key with a scope list needs `profiles:write`).
   * The client's `timeout` covers the whole download (up to 2 MB): a slow link may need a larger one.
   */
  async getAnnouncement(profileId: string): Promise<BinaryResponse> {
    return this.client.request('GET', `/profiles/${profileId}/calls-announcement`, { binary: true });
  }

  /**
   * Remove the announcement (owner or admin; an API key with a scope list needs `profiles:write`); refused with 409
   * (`recording_on`) while recording is on
   */
  async deleteAnnouncement(profileId: string): Promise<CallAnnouncementResult> {
    return this.client.delete(`/profiles/${profileId}/calls-announcement`);
  }
}
