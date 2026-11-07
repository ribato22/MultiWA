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

RECORDING_ROW: dict[str, Any] = {
    "id": "rec-1",
    "durationSec": 190,
    "bytes": 95000,
    "partial": False,
    "announcementPlayed": True,
    "createdAt": AT,
    "deletedAt": None,
    "deleteReason": None,
}

# GET /calls/:id: a call answered in the dashboard, with its relations and recording.
CALL_ROW: dict[str, Any] = {
    "id": "c-1",
    "profileId": "p-1",
    "waCallId": "W1",
    "fromJid": "628111@s.whatsapp.net",
    "isVideo": False,
    "isGroup": False,
    "direction": "incoming",
    "outcome": "answered",
    "rejectedBy": None,
    "startedAt": AT,
    "endedAt": AT,
    "followUp": "done",
    "assignedUserId": None,
    "answeredByUserId": "u-1",
    "answeredAt": AT,
    "endedBy": "caller",
    "endReason": "caller_hangup",
    "talkSeconds": 192,
    "autoReplySentAt": None,
    "conversationId": "cv-1",
    "metadata": {},
    "createdAt": AT,
    "updatedAt": AT,
    "assignedUser": None,
    "answeredBy": {"id": "u-1", "name": "Jane"},
    "conversation": {"id": "cv-1", "name": "Ann"},
    "recording": RECORDING_ROW,
}

ANNOUNCEMENT: dict[str, Any] = {"mimeType": "audio/mpeg", "durationSec": 6.2}

CALLS_SETTINGS: dict[str, Any] = {
    "profileId": "p-1",
    "answerInDashboard": True,
    "recording": True,
    "retentionDays": 30,
    "announcement": ANNOUNCEMENT,
}

MEDIA_STATUS: dict[str, Any] = {
    "server": {
        "enabled": True,
        "worker": "up",
        "port": 40000,
        "engineHost": "api",
        "activeSessions": 0,
        "recordings": {
            "storage": "local",
            "configured": True,
            "problem": None,
            "lastCheck": {"at": AT, "ok": True},
        },
    },
    "profiles": [
        {
            **CALLS_SETTINGS,
            "name": "Main",
            "ready": False,
            "reasons": ["auto_reject_on"],
        }
    ],
}
