// MultiWA Gateway - what the calls routes answer, for the OpenAPI document
// apps/api/src/modules/calls/dto/responses.ts
//
// The routes return plain objects, raw JSON without an envelope; these classes only describe them. Dates are ISO 8601.
import { ApiProperty } from '@nestjs/swagger';
import { CALL_FOLLOW_UPS, CALL_OUTCOMES } from '@multiwa/engine-runtime';
import { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS } from '../../profiles/profile-settings';

const DATE = { type: String, format: 'date-time' } as const;
const DATE_OR_NULL = { ...DATE, nullable: true } as const;
const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'];

export class CallPersonDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;
}

export class CallConversationDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;
}

export class CallRecordingDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: Number, description: 'Seconds.' })
  durationSec: number;

  @ApiProperty({ type: Number, description: 'Size of the file.' })
  bytes: number;

  @ApiProperty({ type: Boolean, description: 'It may end before its call did: a restart, a recorder that did not stop cleanly, or a write that failed.' })
  partial: boolean;

  @ApiProperty({ type: Boolean })
  announcementPlayed: boolean;

  @ApiProperty(DATE)
  createdAt: string;

  @ApiProperty({ ...DATE_OR_NULL, description: 'Set once its file is deleted: the row stays as evidence.' })
  deletedAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: '`admin` or `retention`.' })
  deleteReason: string | null;
}

export class CallDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  profileId: string;

  @ApiProperty({ type: String, description: "WhatsApp's id of the call." })
  waCallId: string;

  @ApiProperty({ type: String, example: '628111000111@s.whatsapp.net' })
  fromJid: string;

  @ApiProperty({ type: Boolean })
  isVideo: boolean;

  @ApiProperty({ type: Boolean })
  isGroup: boolean;

  @ApiProperty({ type: String, example: 'incoming' })
  direction: string;

  @ApiProperty({ type: String, enum: [...CALL_OUTCOMES] })
  outcome: string;

  @ApiProperty({ type: String, nullable: true, description: '`auto`, `agent` or `device`.' })
  rejectedBy: string | null;

  @ApiProperty(DATE)
  startedAt: string;

  @ApiProperty({ ...DATE_OR_NULL, description: 'When it stopped ringing; for an answered call, when the conversation ended.' })
  endedAt: string | null;

  @ApiProperty({ type: String, enum: [...CALL_FOLLOW_UPS] })
  followUp: string;

  @ApiProperty({ type: String, nullable: true })
  assignedUserId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'The agent who answered it in the dashboard, once `outcome` is `answered`.' })
  answeredByUserId: string | null;

  @ApiProperty(DATE_OR_NULL)
  answeredAt: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Who ended a call answered in the dashboard: `agent`, `caller` or `server`.' })
  endedBy: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why it ended: `hangup`, `caller_hangup`, `agent_lost`, `media_failed`, `time_limit` or `server_restart`.',
  })
  endReason: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Seconds the agent and the caller talked; null when not known.' })
  talkSeconds: number | null;

  @ApiProperty(DATE_OR_NULL)
  autoReplySentAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  conversationId: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata: Record<string, unknown>;

  @ApiProperty(DATE)
  createdAt: string;

  @ApiProperty(DATE)
  updatedAt: string;

  @ApiProperty({ type: () => CallPersonDto, nullable: true })
  assignedUser: CallPersonDto | null;

  @ApiProperty({ type: () => CallPersonDto, nullable: true })
  answeredBy: CallPersonDto | null;

  @ApiProperty({ type: () => CallConversationDto, nullable: true })
  conversation: CallConversationDto | null;

  @ApiProperty({ type: () => CallRecordingDto, nullable: true, description: "The recording's facts; the audio is GET /calls/{id}/recording." })
  recording: CallRecordingDto | null;
}

export class CallListDto {
  @ApiProperty({ type: () => [CallDto] })
  calls: CallDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Pass it as `cursor` for the next page; null on the last one.' })
  nextCursor: string | null;
}

export class CallCountDto {
  @ApiProperty({ type: Number })
  count: number;
}

export class CallMessageDto {
  @ApiProperty({ type: Boolean })
  success: boolean;

  @ApiProperty({ type: String, description: "MultiWA's id of the stored message." })
  messageId: string;

  @ApiProperty({ type: String })
  conversationId: string;

  @ApiProperty({ type: String, description: '`sent`, or `queued` with DURABLE_SEND or ENGINE_HOST=worker.' })
  status: string;

  @ApiProperty({ type: String, required: false, description: "WhatsApp's id of the message, once it went out." })
  waMessageId?: string;
}

export class CallReplyResultDto {
  @ApiProperty({ type: () => CallDto })
  call: CallDto;

  @ApiProperty({ type: () => CallMessageDto })
  message: CallMessageDto;
}

export class CallLinkResultDto extends CallReplyResultDto {
  @ApiProperty({ type: String, description: 'The WhatsApp call link sent to the caller.' })
  link: string;
}

export class CallAnnouncementDto {
  @ApiProperty({ type: String, enum: AUDIO_TYPES })
  mimeType: string;

  @ApiProperty({ type: Number, example: 6.2, description: 'Seconds.' })
  durationSec: number;
}

export class CallsSettingsDto {
  @ApiProperty({ type: String })
  profileId: string;

  @ApiProperty({ type: Boolean })
  answerInDashboard: boolean;

  @ApiProperty({ type: Boolean })
  recording: boolean;

  @ApiProperty({ type: Number, minimum: 1, maximum: MAX_RETENTION_DAYS, example: DEFAULT_RETENTION_DAYS })
  retentionDays: number;

  @ApiProperty({ type: () => CallAnnouncementDto, nullable: true })
  announcement: CallAnnouncementDto | null;
}

export class CallsProfileStatusDto extends CallsSettingsDto {
  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Boolean, description: 'Whether its calls can be answered in the dashboard now.' })
  ready: boolean;

  @ApiProperty({ type: [String], example: ['auto_reject_on'], description: 'Why not, each a code (see the API specification); empty when ready.' })
  reasons: string[];
}

export class CallsStorageCheckDto {
  @ApiProperty(DATE)
  at: string;

  @ApiProperty({ type: Boolean })
  ok: boolean;

  @ApiProperty({ type: String, required: false, description: '`storage_not_private` or `storage_check_failed`.' })
  reason?: string;
}

export class CallsRecordingsStorageDto {
  @ApiProperty({ type: String, enum: ['local', 's3'] })
  storage: string;

  @ApiProperty({ type: Boolean })
  configured: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Which setting is missing or refused; null when configured.' })
  problem: string | null;

  @ApiProperty({ type: () => CallsStorageCheckDto, nullable: true, description: 'The last check that the storage refuses reads without credentials.' })
  lastCheck: CallsStorageCheckDto | null;
}

export class CallsMediaServerDto {
  @ApiProperty({ type: Boolean, description: 'CALLS_MEDIA_ENABLED.' })
  enabled: boolean;

  @ApiProperty({ type: String, enum: ['up', 'down'] })
  worker: string;

  @ApiProperty({ type: Number, nullable: true, description: 'CALLS_MEDIA_PORT; null while disabled.' })
  port: number | null;

  @ApiProperty({ type: String, enum: ['api', 'worker'], description: 'ENGINE_HOST: calls are answered in the dashboard only with `api`.' })
  engineHost: string;

  @ApiProperty({ type: Number, description: "The organization's calls connected or connecting in the dashboard." })
  activeSessions: number;

  @ApiProperty({ type: () => CallsRecordingsStorageDto })
  recordings: CallsRecordingsStorageDto;
}

export class CallsMediaStatusDto {
  @ApiProperty({ type: () => CallsMediaServerDto })
  server: CallsMediaServerDto;

  @ApiProperty({ type: () => [CallsProfileStatusDto] })
  profiles: CallsProfileStatusDto[];
}

export class DeletedCallRecordingDto {
  @ApiProperty({ type: String })
  callId: string;

  @ApiProperty({ type: String })
  recordingId: string;

  @ApiProperty(DATE)
  deletedAt: string;
}

export class CallAnnouncementResultDto {
  @ApiProperty({ type: String })
  profileId: string;

  @ApiProperty({ type: () => CallAnnouncementDto, nullable: true, description: 'Null once removed.' })
  announcement: CallAnnouncementDto | null;
}

export class CallsRefusalDto {
  @ApiProperty({ type: String, example: 'Answering calls in the dashboard is not available for this profile' })
  message: string;

  @ApiProperty({ type: [String], example: ['auto_reject_on', 'web_calling_disabled'], description: 'Why, each a code (see the API specification).' })
  reasons: string[];
}
