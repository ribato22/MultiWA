"""
MultiWA Python SDK - Type Definitions

Pydantic models for request/response types.
"""

from datetime import datetime
from typing import Optional, List, Any, Dict
from enum import Enum
from pydantic import BaseModel, Field


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
    """Result of sending a message"""
    success: bool
    message_id: Optional[str] = Field(None, alias="messageId")
    conversation_id: Optional[str] = Field(None, alias="conversationId")
    status: Optional[str] = None
    error: Optional[str] = None
    
    class Config:
        populate_by_name = True


class Message(BaseModel):
    """WhatsApp message"""
    id: str
    profile_id: str = Field(alias="profileId")
    conversation_id: str = Field(alias="conversationId")
    message_id: str = Field(alias="messageId")
    direction: MessageDirection
    sender_jid: str = Field(alias="senderJid")
    type: MessageType
    content: Dict[str, Any]
    status: MessageStatus
    timestamp: datetime
    
    class Config:
        populate_by_name = True


class Contact(BaseModel):
    """Contact model"""
    id: str
    profile_id: str = Field(alias="profileId")
    phone: str
    name: Optional[str] = None
    email: Optional[str] = None
    avatar: Optional[str] = None
    tags: List[str] = []
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    
    class Config:
        populate_by_name = True


class Broadcast(BaseModel):
    """Broadcast campaign"""
    id: str
    profile_id: str = Field(alias="profileId")
    name: str
    status: str
    total_recipients: int = Field(alias="totalRecipients")
    sent_count: int = Field(0, alias="sentCount")
    delivered_count: int = Field(0, alias="deliveredCount")
    failed_count: int = Field(0, alias="failedCount")
    created_at: datetime = Field(alias="createdAt")
    
    class Config:
        populate_by_name = True


class Template(BaseModel):
    """Message template"""
    id: str
    profile_id: str = Field(alias="profileId")
    name: str
    content: str
    variables: List[str] = []
    created_at: datetime = Field(alias="createdAt")
    
    class Config:
        populate_by_name = True


class Profile(BaseModel):
    """WhatsApp profile/account"""
    id: str
    name: str
    phone_number: Optional[str] = Field(None, alias="phoneNumber")
    push_name: Optional[str] = Field(None, alias="pushName")
    status: ProfileStatus
    engine: str
    is_active: bool = Field(True, alias="isActive")
    created_at: datetime = Field(alias="createdAt")
    
    class Config:
        populate_by_name = True


class Webhook(BaseModel):
    """Webhook configuration"""
    id: str
    profile_id: str = Field(alias="profileId")
    url: str
    events: List[str]
    is_active: bool = Field(True, alias="isActive")
    secret: Optional[str] = None
    created_at: datetime = Field(alias="createdAt")
    
    class Config:
        populate_by_name = True


class PaginatedResponse(BaseModel):
    """Paginated list response"""
    data: List[Any]
    total: int
    page: int
    limit: int
    has_more: bool = Field(alias="hasMore")
    
    class Config:
        populate_by_name = True
