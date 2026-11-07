"""
MultiWA Python SDK - Messages Client

Client for messaging endpoints: send text, images, videos, polls, etc.
"""

from __future__ import annotations

from typing import Any, cast

from ._base import AsyncResource, SyncResource, compact
from .types import MessageResult


def _contact_body(
    profile_id: str, to: str, name: str, phone: str, email: str | None
) -> dict[str, Any]:
    return {
        "profileId": profile_id,
        "to": to,
        "contacts": [compact({"name": name, "phone": phone, "email": email})],
    }


class MessagesClient(SyncResource):
    """Synchronous Messages API client"""

    def _send(self, kind: str, body: dict[str, Any]) -> MessageResult:
        return MessageResult.model_validate(
            self._request("POST", f"/messages/{kind}", json=body)
        )

    def send_text(
        self,
        profile_id: str,
        to: str,
        text: str,
        quoted_message_id: str | None = None,
    ) -> MessageResult:
        """Send a text message"""
        return self._send(
            "text",
            {
                "profileId": profile_id,
                "to": to,
                "text": text,
                "quotedMessageId": quoted_message_id,
            },
        )

    def send_image(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        caption: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send an image message"""
        return self._send(
            "image",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "caption": caption,
                "mimetype": mimetype,
            },
        )

    def send_video(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        caption: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send a video message"""
        return self._send(
            "video",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "caption": caption,
                "mimetype": mimetype,
            },
        )

    def send_audio(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        mimetype: str | None = None,
        ptt: bool = False,
    ) -> MessageResult:
        """Send an audio message or voice note"""
        return self._send(
            "audio",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "mimetype": mimetype,
                "ptt": ptt,
            },
        )

    def send_document(
        self,
        profile_id: str,
        to: str,
        filename: str,
        url: str | None = None,
        base64: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send a document/file"""
        return self._send(
            "document",
            {
                "profileId": profile_id,
                "to": to,
                "filename": filename,
                "url": url,
                "base64": base64,
                "mimetype": mimetype,
            },
        )

    def send_location(
        self,
        profile_id: str,
        to: str,
        latitude: float,
        longitude: float,
        name: str | None = None,
        address: str | None = None,
    ) -> MessageResult:
        """Send a location"""
        return self._send(
            "location",
            {
                "profileId": profile_id,
                "to": to,
                "latitude": latitude,
                "longitude": longitude,
                "name": name,
                "address": address,
            },
        )

    def send_contact(
        self,
        profile_id: str,
        to: str,
        name: str,
        phone: str,
        email: str | None = None,
    ) -> MessageResult:
        """Send a contact card (vCard)"""
        return self._send("contact", _contact_body(profile_id, to, name, phone, email))

    def send_poll(
        self,
        profile_id: str,
        to: str,
        question: str,
        options: list[str],
        allow_multiple_answers: bool = False,
    ) -> MessageResult:
        """Send an interactive poll (the API takes 2 to 12 options)"""
        return self._send(
            "poll",
            {
                "profileId": profile_id,
                "to": to,
                "question": question,
                "options": options,
                "allowMultipleAnswers": allow_multiple_answers,
            },
        )

    def send_reaction(
        self,
        profile_id: str,
        message_id: str,
        emoji: str,
    ) -> MessageResult:
        """React to a message with an emoji (``""`` removes the reaction).

        ``message_id`` is MultiWA's message id (``MessageResult.message_id``
        or the ``id`` of a stored message), not WhatsApp's message id.
        """
        return self._send(
            "reaction",
            {
                "profileId": profile_id,
                "messageId": message_id,
                "emoji": emoji,
            },
        )

    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        message_type: str | None = None,
        direction: str | None = None,
    ) -> list[dict[str, Any]]:
        """List messages for a profile, newest first"""
        return cast(
            "list[dict[str, Any]]",
            self._request(
                "GET",
                f"/messages/profile/{profile_id}",
                params={
                    "limit": limit,
                    "offset": offset,
                    "type": message_type,
                    "direction": direction,
                },
            ),
        )


class AsyncMessagesClient(AsyncResource):
    """Asynchronous Messages API client"""

    async def _send(self, kind: str, body: dict[str, Any]) -> MessageResult:
        return MessageResult.model_validate(
            await self._request("POST", f"/messages/{kind}", json=body)
        )

    async def send_text(
        self,
        profile_id: str,
        to: str,
        text: str,
        quoted_message_id: str | None = None,
    ) -> MessageResult:
        """Send a text message"""
        return await self._send(
            "text",
            {
                "profileId": profile_id,
                "to": to,
                "text": text,
                "quotedMessageId": quoted_message_id,
            },
        )

    async def send_image(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        caption: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send an image message"""
        return await self._send(
            "image",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "caption": caption,
                "mimetype": mimetype,
            },
        )

    async def send_video(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        caption: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send a video message"""
        return await self._send(
            "video",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "caption": caption,
                "mimetype": mimetype,
            },
        )

    async def send_audio(
        self,
        profile_id: str,
        to: str,
        url: str | None = None,
        base64: str | None = None,
        mimetype: str | None = None,
        ptt: bool = False,
    ) -> MessageResult:
        """Send an audio message or voice note"""
        return await self._send(
            "audio",
            {
                "profileId": profile_id,
                "to": to,
                "url": url,
                "base64": base64,
                "mimetype": mimetype,
                "ptt": ptt,
            },
        )

    async def send_document(
        self,
        profile_id: str,
        to: str,
        filename: str,
        url: str | None = None,
        base64: str | None = None,
        mimetype: str | None = None,
    ) -> MessageResult:
        """Send a document/file"""
        return await self._send(
            "document",
            {
                "profileId": profile_id,
                "to": to,
                "filename": filename,
                "url": url,
                "base64": base64,
                "mimetype": mimetype,
            },
        )

    async def send_location(
        self,
        profile_id: str,
        to: str,
        latitude: float,
        longitude: float,
        name: str | None = None,
        address: str | None = None,
    ) -> MessageResult:
        """Send a location"""
        return await self._send(
            "location",
            {
                "profileId": profile_id,
                "to": to,
                "latitude": latitude,
                "longitude": longitude,
                "name": name,
                "address": address,
            },
        )

    async def send_contact(
        self,
        profile_id: str,
        to: str,
        name: str,
        phone: str,
        email: str | None = None,
    ) -> MessageResult:
        """Send a contact card (vCard)"""
        return await self._send(
            "contact", _contact_body(profile_id, to, name, phone, email)
        )

    async def send_poll(
        self,
        profile_id: str,
        to: str,
        question: str,
        options: list[str],
        allow_multiple_answers: bool = False,
    ) -> MessageResult:
        """Send an interactive poll (the API takes 2 to 12 options)"""
        return await self._send(
            "poll",
            {
                "profileId": profile_id,
                "to": to,
                "question": question,
                "options": options,
                "allowMultipleAnswers": allow_multiple_answers,
            },
        )

    async def send_reaction(
        self,
        profile_id: str,
        message_id: str,
        emoji: str,
    ) -> MessageResult:
        """React to a message with an emoji (``""`` removes the reaction).

        ``message_id`` is MultiWA's message id (``MessageResult.message_id``
        or the ``id`` of a stored message), not WhatsApp's message id.
        """
        return await self._send(
            "reaction",
            {
                "profileId": profile_id,
                "messageId": message_id,
                "emoji": emoji,
            },
        )

    async def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        message_type: str | None = None,
        direction: str | None = None,
    ) -> list[dict[str, Any]]:
        """List messages for a profile, newest first"""
        return cast(
            "list[dict[str, Any]]",
            await self._request(
                "GET",
                f"/messages/profile/{profile_id}",
                params={
                    "limit": limit,
                    "offset": offset,
                    "type": message_type,
                    "direction": direction,
                },
            ),
        )
