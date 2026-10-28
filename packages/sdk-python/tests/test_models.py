"""The models parse the response shapes the MultiWA API really returns."""

import rows

from multiwa.types import (
    Broadcast,
    Contact,
    Message,
    MessageResult,
    Profile,
    ProfileStatus,
    Template,
    Webhook,
)


def test_broadcast_counts_come_from_stats():
    b = Broadcast.model_validate(rows.BROADCAST_ROW)
    assert (b.total_recipients, b.sent_count, b.delivered_count, b.failed_count) == (
        2,
        1,
        1,
        0,
    )
    assert b.profile_id == "p-1"
    assert b.started_at is not None
    assert b.scheduled_at is None


def test_broadcast_with_empty_stats_counts_zero():
    b = Broadcast.model_validate({**rows.BROADCAST_ROW, "stats": {}})
    assert (b.total_recipients, b.sent_count, b.delivered_count, b.failed_count) == (
        0,
        0,
        0,
        0,
    )


def test_broadcast_still_builds_from_field_names():
    b = Broadcast(
        id="b-1",
        profile_id="p-1",
        name="Promo",
        status="draft",
        sent_count=3,
        created_at="2026-10-28T10:00:00Z",
    )
    assert b.sent_count == 3


def test_profile_name_from_display_name():
    p = Profile.model_validate(rows.PROFILE_ROW)
    assert p.name == "Main"
    assert p.phone_number == "628999"
    assert p.status is ProfileStatus.CONNECTED
    assert p.is_active is True  # the API has no such flag


def test_profile_list_row_and_unnamed_profile():
    assert Profile.model_validate(rows.PROFILE_LIST_ROW).name == "Main"
    unnamed = {**rows.PROFILE_ROW, "displayName": None}
    assert Profile.model_validate(unnamed).name is None


def test_webhook_is_active_comes_from_enabled():
    assert Webhook.model_validate(rows.WEBHOOK_ROW).is_active is True
    disabled = Webhook.model_validate({**rows.WEBHOOK_LIST_ROW, "enabled": False})
    assert disabled.is_active is False
    assert disabled.secret == "generated-secret"


def test_contact_avatar_and_email():
    c = Contact.model_validate(rows.CONTACT_ROW)
    assert c.avatar == "https://cdn.test/ann.jpg"
    assert c.email is None  # not stored by the API
    assert c.tags == ["vip"]
    assert c.metadata == {"source": "web"}


def test_send_result_carries_both_ids():
    r = MessageResult.model_validate(rows.SEND_RESULT)
    assert (r.message_id, r.wa_message_id, r.status) == (
        "m-1",
        "true_628111@c.us_3EB0ABC",
        "sent",
    )
    queued = MessageResult.model_validate(
        {
            "success": True,
            "messageId": "m-2",
            "conversationId": "cv-1",
            "status": "queued",
        }
    )
    assert queued.wa_message_id is None
    failed = MessageResult.model_validate(
        {**rows.SEND_RESULT, "success": False, "status": "failed", "error": "boom"}
    )
    assert failed.error == "boom"


def test_stored_message_with_types_outside_the_enums():
    m = Message.model_validate(
        {
            "id": "m-1",
            "profileId": "p-1",
            "conversationId": "cv-1",
            "messageId": "pending_1",
            "direction": "incoming",
            "senderJid": "628111@s.whatsapp.net",
            "type": "sticker",
            "content": {},
            "status": "queued",
            "timestamp": rows.AT,
        }
    )
    assert (m.type, m.status) == ("sticker", "queued")


def test_template_content_is_an_object():
    t = Template.model_validate(
        {
            "id": "t-1",
            "profileId": "p-1",
            "name": "welcome",
            "category": "utility",
            "messageType": "text",
            "content": {"text": "Hello {{name}}"},
            "variables": ["name"],
            "usageCount": 0,
            "createdAt": rows.AT,
            "updatedAt": rows.AT,
        }
    )
    assert t.content == {"text": "Hello {{name}}"}
