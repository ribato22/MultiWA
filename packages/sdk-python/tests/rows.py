"""Response bodies shaped like the real MultiWA API (Prisma rows as JSON)."""

from typing import Any

AT = "2026-10-28T10:00:00.000Z"

SEND_RESULT: dict[str, Any] = {
    "success": True,
    "messageId": "m-1",
    "conversationId": "cv-1",
    "status": "sent",
    "waMessageId": "true_628111@c.us_3EB0ABC",
}

CONTACT_ROW: dict[str, Any] = {
    "id": "c-1",
    "profileId": "p-1",
    "phone": "628111",
    "name": "Ann",
    "whatsappName": "Ann WA",
    "avatarUrl": "https://cdn.test/ann.jpg",
    "tags": ["vip"],
    "metadata": {"source": "web"},
    "isBlocked": False,
    "lastMessageAt": None,
    "createdAt": AT,
    "updatedAt": AT,
}

CONTACT_PAGE: dict[str, Any] = {
    "contacts": [CONTACT_ROW],
    "total": 1,
    "limit": 50,
    "offset": 0,
}

BROADCAST_ROW: dict[str, Any] = {
    "id": "b-1",
    "profileId": "p-1",
    "name": "Promo",
    "message": {"type": "text", "text": "Hi"},
    "recipients": {"type": "contacts", "value": ["628111", "628222"]},
    "status": "running",
    "scheduledAt": None,
    "startedAt": AT,
    "completedAt": None,
    "settings": {"delayMin": 3000, "delayMax": 10000, "batchSize": 50},
    "stats": {
        "total": 2,
        "pending": 1,
        "sent": 1,
        "delivered": 1,
        "read": 0,
        "failed": 0,
    },
    "resolvedRecipients": ["628111", "628222"],
    "cursor": 1,
    "createdAt": AT,
    "updatedAt": AT,
}

BROADCAST_STATS: dict[str, Any] = {
    "id": "b-1",
    "name": "Promo",
    "status": "running",
    "scheduledAt": None,
    "startedAt": AT,
    "completedAt": None,
    "stats": {**BROADCAST_ROW["stats"], "successRate": 50, "progress": 50},
    "duration": None,
}

PROFILE_ROW: dict[str, Any] = {
    "id": "p-1",
    "workspaceId": "ws-1",
    "accountId": None,
    "displayName": "Main",
    "phoneNumber": "628999",
    "pushName": "Shop",
    "status": "connected",
    "engine": "whatsapp-web-js",
    "lastConnectedAt": AT,
    "settings": {},
    "createdAt": AT,
    "updatedAt": AT,
}

# GET /profiles adds name, phone, messageCount and workspace to each row.
PROFILE_LIST_ROW: dict[str, Any] = {
    **PROFILE_ROW,
    "name": "Main",
    "phone": "628999",
    "messageCount": 3,
    "workspace": {"id": "ws-1", "name": "Default"},
}

PROFILE_STATUS: dict[str, Any] = {
    "id": "p-1",
    "name": "Main",
    "status": "connected",
    "phone": "628999",
    "lastConnectedAt": AT,
    "engineConnected": True,
}

WEBHOOK_ROW: dict[str, Any] = {
    "id": "wh-1",
    "profileId": "p-1",
    "url": "https://hook.test/in",
    "events": ["message.received"],
    "secret": "generated-secret",
    "headers": {},
    "enabled": True,
    "createdAt": AT,
    "updatedAt": AT,
}

# GET /webhooks includes the profile of each webhook.
WEBHOOK_LIST_ROW: dict[str, Any] = {
    **WEBHOOK_ROW,
    "profile": {"id": "p-1", "displayName": "Main"},
}

OK: dict[str, Any] = {"success": True}
