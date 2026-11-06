"""
MultiWA Python SDK - Type Definitions

Pydantic models for request/response types.
"""

# No ``from __future__ import annotations`` here: pydantic evaluates these
# annotations at runtime, and ``X | None`` needs Python 3.10.
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class MessageType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    LOCATION = "location"
    CONTACT = "contact"
    POLL = "poll"
    REACTION = "reaction"


class MessageDirection(str, Enum):
    INCOMING = "incoming"
    OUTGOING = "outgoing"


class MessageStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"


class ProfileStatus(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"


# ============ Response Models ============


class MessageResult(BaseModel):
    """Result of sending a message.

    ``message_id`` is MultiWA's id of the stored message (use it for
    ``send_reaction``); ``wa_message_id`` is WhatsApp's id, set once the
    message went out. ``status`` is ``queued``, ``sent`` or ``failed``.
    """

    model_config = ConfigDict(populate_by_name=True)

    success: bool
    message_id: Optional[str] = Field(None, alias="messageId")
    conversation_id: Optional[str] = Field(None, alias="conversationId")
    status: Optional[str] = None
    wa_message_id: Optional[str] = Field(None, alias="waMessageId")
    error: Optional[str] = None


class Message(BaseModel):
    """WhatsApp message.

    ``type`` and ``status`` are plain strings: stored messages also use values
    outside ``MessageType``/``MessageStatus`` (``sticker``, ``queued``, ...).
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    conversation_id: str = Field(alias="conversationId")
    message_id: str = Field(alias="messageId")
    direction: MessageDirection
    sender_jid: str = Field(alias="senderJid")
    type: str
    content: dict[str, Any]
    status: str
    timestamp: datetime


class Contact(BaseModel):
    """Contact model.

    ``email`` is always ``None``: the API stores no email for a contact.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    phone: str
    name: Optional[str] = None
    email: Optional[str] = None
    avatar: Optional[str] = Field(None, alias="avatarUrl")
    tags: list[str] = []
    metadata: dict[str, Any] = {}
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class Broadcast(BaseModel):
    """Broadcast campaign. The counts are read from the API's ``stats`` object."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    name: str
    status: str
    total_recipients: int = Field(0, alias="totalRecipients")
    sent_count: int = Field(0, alias="sentCount")
    delivered_count: int = Field(0, alias="deliveredCount")
    failed_count: int = Field(0, alias="failedCount")
    scheduled_at: Optional[datetime] = Field(None, alias="scheduledAt")
    started_at: Optional[datetime] = Field(None, alias="startedAt")
    completed_at: Optional[datetime] = Field(None, alias="completedAt")
    created_at: datetime = Field(alias="createdAt")

    @model_validator(mode="before")
    @classmethod
    def _counts_from_stats(cls, data: Any) -> Any:
        stats = data.get("stats") if isinstance(data, dict) else None
        if not isinstance(stats, dict):
            return data
        return {
            "totalRecipients": stats.get("total", 0),
            "sentCount": stats.get("sent", 0),
            "deliveredCount": stats.get("delivered", 0),
            "failedCount": stats.get("failed", 0),
            **data,
        }


class Template(BaseModel):
    """Message template"""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    name: str
    content: Any
    variables: list[str] = []
    created_at: datetime = Field(alias="createdAt")


class Profile(BaseModel):
    """WhatsApp profile/account.

    ``name`` is the API's ``name`` (profile list) or ``displayName`` (every
    other route). ``is_active`` is not provided by the API and is always ``True``.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: Optional[str] = Field(
        None, validation_alias=AliasChoices("name", "displayName")
    )
    phone_number: Optional[str] = Field(None, alias="phoneNumber")
    push_name: Optional[str] = Field(None, alias="pushName")
    status: ProfileStatus
    engine: str
    is_active: bool = Field(True, alias="isActive")
    created_at: datetime = Field(alias="createdAt")


class Webhook(BaseModel):
    """Webhook configuration. ``is_active`` is the API's ``enabled``."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    url: str
    events: list[str]
    is_active: bool = Field(True, alias="enabled")
    secret: Optional[str] = None
    created_at: datetime = Field(alias="createdAt")


# ============ Calls ============


class CallPerson(BaseModel):
    """The user a call is assigned to, or the agent who answered it."""

    id: str
    name: str


class CallConversation(BaseModel):
    """The caller's chat."""

    id: str
    name: Optional[str] = None


class CallRecording(BaseModel):
    """A call's recording: its facts. The audio is ``calls.get_recording()``.

    ``partial``: it may end before its call did (a restart, a recorder that did
    not stop cleanly, or a write that failed). Once its file is deleted,
    ``deleted_at`` and ``delete_reason`` (``admin`` or ``retention``) are set.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    #: ``audio/webm``, or ``video/webm`` for a call answered with video.
    mime_type: str = Field("audio/webm", alias="mimeType")
    duration_sec: int = Field(alias="durationSec")
    bytes: int
    partial: bool
    announcement_played: bool = Field(alias="announcementPlayed")
    created_at: datetime = Field(alias="createdAt")
    deleted_at: Optional[datetime] = Field(None, alias="deletedAt")
    delete_reason: Optional[str] = Field(None, alias="deleteReason")


class Call(BaseModel):
    """An incoming WhatsApp call.

    ``outcome`` is ``ringing``, ``answered`` (in the dashboard), ``missed``,
    ``rejected``, ``answered_elsewhere`` or ``unknown``; ``follow_up`` is
    ``open``, ``in_progress`` or ``done``. A call answered in the dashboard also
    has ``answered_by_user_id``, ``answered_at``, ``ended_by``, ``end_reason`` and
    ``talk_seconds``.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: str = Field(alias="profileId")
    wa_call_id: str = Field(alias="waCallId")
    from_jid: str = Field(alias="fromJid")
    is_video: bool = Field(alias="isVideo")
    is_group: bool = Field(alias="isGroup")
    direction: str
    outcome: str
    rejected_by: Optional[str] = Field(None, alias="rejectedBy")
    started_at: datetime = Field(alias="startedAt")
    ended_at: Optional[datetime] = Field(None, alias="endedAt")
    follow_up: str = Field(alias="followUp")
    assigned_user_id: Optional[str] = Field(None, alias="assignedUserId")
    answered_by_user_id: Optional[str] = Field(None, alias="answeredByUserId")
    answered_at: Optional[datetime] = Field(None, alias="answeredAt")
    ended_by: Optional[str] = Field(None, alias="endedBy")
    end_reason: Optional[str] = Field(None, alias="endReason")
    talk_seconds: Optional[int] = Field(None, alias="talkSeconds")
    auto_reply_sent_at: Optional[datetime] = Field(None, alias="autoReplySentAt")
    conversation_id: Optional[str] = Field(None, alias="conversationId")
    metadata: dict[str, Any] = {}
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    assigned_user: Optional[CallPerson] = Field(None, alias="assignedUser")
    answered_by: Optional[CallPerson] = Field(None, alias="answeredBy")
    conversation: Optional[CallConversation] = None
    recording: Optional[CallRecording] = None


class CallPage(BaseModel):
    """A page of calls, newest first.

    Pass ``next_cursor`` as ``cursor`` for the next page; it is ``None`` on the
    last one.
    """

    model_config = ConfigDict(populate_by_name=True)

    calls: list[Call]
    next_cursor: Optional[str] = Field(None, alias="nextCursor")


class CallReplyResult(BaseModel):
    """The call and the message sent to the caller: an ``open`` follow-up is now
    ``in_progress``, any other is left as it was."""

    call: Call
    message: MessageResult


class CallLinkResult(CallReplyResult):
    """``CallReplyResult`` with the WhatsApp call link that was sent."""

    link: str


class CallAnnouncement(BaseModel):
    """The announcement callers hear before a recorded call.

    ``mime_type`` and ``duration_sec`` (seconds) are read from the file itself.
    """

    model_config = ConfigDict(populate_by_name=True)

    mime_type: str = Field(alias="mimeType")
    duration_sec: float = Field(alias="durationSec")


class CallsSettings(BaseModel):
    """A profile's call settings."""

    model_config = ConfigDict(populate_by_name=True)

    profile_id: str = Field(alias="profileId")
    answer_in_dashboard: bool = Field(alias="answerInDashboard")
    recording: bool
    retention_days: int = Field(alias="retentionDays")
    announcement: Optional[CallAnnouncement] = None


class CallsProfileStatus(CallsSettings):
    """A profile of the media status: its call settings, and whether its calls
    can be answered in the dashboard now (``reasons`` says why not)."""

    name: str
    ready: bool
    reasons: list[str] = []
    #: Its video calls are answered with video now.
    video: bool = False


class StorageCheck(BaseModel):
    """The last check that the recordings storage refuses reads without credentials."""

    at: datetime
    ok: bool
    reason: Optional[str] = None


class RecordingsStorage(BaseModel):
    """Where recordings go (``local`` or ``s3``), and whether that works.

    ``problem`` names the missing or refused setting.
    """

    model_config = ConfigDict(populate_by_name=True)

    storage: str
    configured: bool
    problem: Optional[str] = None
    last_check: Optional[StorageCheck] = Field(None, alias="lastCheck")


class CallsVideoCalls(BaseModel):
    """The organization's calls answered with video now (``active``), and the
    server's cap on them (``max``, CALLS_MAX_VIDEO_CALLS, for every organization)."""

    active: int
    max: int


class CallsMediaServer(BaseModel):
    """The media server: ``enabled`` is CALLS_MEDIA_ENABLED, ``engine_host`` is
    ENGINE_HOST (calls are answered in the dashboard only with ``api``)."""

    model_config = ConfigDict(populate_by_name=True)

    enabled: bool
    worker: str
    port: Optional[int] = None
    engine_host: str = Field(alias="engineHost")
    active_sessions: int = Field(alias="activeSessions")
    video_calls: Optional[CallsVideoCalls] = Field(None, alias="videoCalls")
    recordings: RecordingsStorage


class CallsMediaStatus(BaseModel):
    """``GET /calls/media/status`` (owner or admin)."""

    server: CallsMediaServer
    profiles: list[CallsProfileStatus]


class DeletedRecording(BaseModel):
    """A recording deleted: its file is gone, its row stays as evidence."""

    model_config = ConfigDict(populate_by_name=True)

    call_id: str = Field(alias="callId")
    recording_id: str = Field(alias="recordingId")
    deleted_at: datetime = Field(alias="deletedAt")


class AnnouncementResult(BaseModel):
    """A profile's announcement after an upload, or ``None`` once removed."""

    model_config = ConfigDict(populate_by_name=True)

    profile_id: str = Field(alias="profileId")
    announcement: Optional[CallAnnouncement] = None


class AudioFile(BaseModel):
    """Audio the API answered with: the bytes and their Content-Type
    (``audio/webm`` for a recording)."""

    # Out of repr(): a recording is megabytes.
    content: bytes = Field(repr=False)
    content_type: str


class PaginatedResponse(BaseModel):
    """Paginated list response"""

    model_config = ConfigDict(populate_by_name=True)

    data: list[Any]
    total: int
    page: int
    limit: int
    has_more: bool = Field(alias="hasMore")
