"""
MultiWA Python SDK

Official Python SDK for MultiWA - WhatsApp Business API Gateway.
"""

from .client import AsyncMultiWA, MultiWA
from .types import (
    AudioFile,
    Broadcast,
    Call,
    CallPage,
    CallsMediaStatus,
    CallsSettings,
    Contact,
    Message,
    MessageResult,
    Profile,
    Template,
    Webhook,
)
from .webhooks import verify_webhook_signature

__version__ = "2.0.0"
__all__ = [
    "AsyncMultiWA",
    "AudioFile",
    "Broadcast",
    "Call",
    "CallPage",
    "CallsMediaStatus",
    "CallsSettings",
    "Contact",
    "Message",
    "MessageResult",
    "MultiWA",
    "Profile",
    "Template",
    "Webhook",
    "verify_webhook_signature",
]
