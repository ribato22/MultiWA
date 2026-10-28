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


class PaginatedResponse(BaseModel):
    """Paginated list response"""

    model_config = ConfigDict(populate_by_name=True)

    data: list[Any]
    total: int
    page: int
    limit: int
    has_more: bool = Field(alias="hasMore")
