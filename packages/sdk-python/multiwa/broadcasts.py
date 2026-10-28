"""
MultiWA Python SDK - Broadcasts Client

Client for managing broadcast campaigns.
"""

from __future__ import annotations

import contextlib
from datetime import datetime
from typing import Any, Union, cast

import httpx

from ._base import AsyncResource, SyncResource
from .types import Broadcast

# {"type": "tags" | "contacts" | "all", "value": [...]}, or a plain list of
# phone numbers (sent as type "contacts").
Recipients = Union[list[str], dict[str, Any]]
# {"type": "text", "text": ...} or another message object, or plain text.
BroadcastMessage = Union[str, dict[str, Any]]


def _create_body(
    profile_id: str,
    name: str,
    recipients: Recipients,
    template_id: str | None,
    message: BroadcastMessage | None,
    settings: dict[str, Any] | None,
) -> dict[str, Any]:
    if template_id is not None:
        raise ValueError(
            "The broadcast API has no template_id; pass the content as message "
            "(a str, or a message object such as {'type': 'text', 'text': ...})"
        )
    if message is None:
        raise ValueError("message is required")
    return {
        "profileId": profile_id,
        "name": name,
        "message": (
            {"type": "text", "text": message} if isinstance(message, str) else message
        ),
        "recipients": (
            {"type": "contacts", "value": recipients}
            if isinstance(recipients, list)
            else recipients
        ),
        "settings": settings,
    }


def _iso(when: str | datetime) -> str:
    if isinstance(when, str):
        return when
    if when.tzinfo is None:
        raise ValueError(
            "A schedule datetime must be timezone-aware (or pass ISO 8601)"
        )
    return when.isoformat()


class BroadcastsClient(SyncResource):
    """Synchronous Broadcasts API client"""

    def create(
        self,
        profile_id: str,
        name: str,
        recipients: Recipients,
        template_id: str | None = None,
        message: BroadcastMessage | None = None,
        schedule_at: str | datetime | None = None,
        settings: dict[str, Any] | None = None,
    ) -> Broadcast:
        """Create a broadcast campaign (a draft, until scheduled or started).

        ``recipients``: ``{"type": "tags" | "contacts" | "all", "value": [...]}``
        (tag names, or contact ids / phone numbers), or a list of phone
        numbers. ``message``: a message object such as
        ``{"type": "text", "text": ...}``, or plain text. ``settings``: pacing,
        e.g. ``{"delayMin": 3000, "delayMax": 10000, "batchSize": 50}``.

        With ``schedule_at`` (a future time) the draft is scheduled right away;
        if the API refuses the schedule, the draft is deleted and the error raised.
        ``template_id`` has no API equivalent and raises ``ValueError``.
        """
        body = _create_body(
            profile_id, name, recipients, template_id, message, settings
        )
        scheduled_at = None if schedule_at is None else _iso(schedule_at)
        broadcast = Broadcast.model_validate(
            self._request("POST", "/broadcast", json=body)
        )
        if scheduled_at is None:
            return broadcast
        try:
            return self.schedule(broadcast.id, scheduled_at)
        except httpx.HTTPError:
            with contextlib.suppress(httpx.HTTPError):
                self.delete(broadcast.id)
            raise

    def get(self, broadcast_id: str) -> Broadcast:
        """Get a broadcast by ID"""
        return Broadcast.model_validate(
            self._request("GET", f"/broadcast/{broadcast_id}")
        )

    def schedule(self, broadcast_id: str, scheduled_at: str | datetime) -> Broadcast:
        """Schedule a draft broadcast for a future time"""
        return Broadcast.model_validate(
            self._request(
                "POST",
                f"/broadcast/{broadcast_id}/schedule",
                json={"scheduledAt": _iso(scheduled_at)},
            )
        )

    def start(self, broadcast_id: str) -> Broadcast:
        """Start a draft or scheduled broadcast now (a paused one is resumed)"""
        self._request("POST", f"/broadcast/{broadcast_id}/start")
        return self.get(broadcast_id)

    def pause(self, broadcast_id: str) -> Broadcast:
        """Pause a running broadcast"""
        return Broadcast.model_validate(
            self._request("POST", f"/broadcast/{broadcast_id}/pause")
        )

    def resume(self, broadcast_id: str) -> Broadcast:
        """Resume a paused broadcast where it stopped"""
        self._request("POST", f"/broadcast/{broadcast_id}/resume")
        return self.get(broadcast_id)

    def cancel(self, broadcast_id: str) -> Broadcast:
        """Cancel a broadcast (the API marks it ``failed``)"""
        return Broadcast.model_validate(
            self._request("POST", f"/broadcast/{broadcast_id}/cancel")
        )

    def delete(self, broadcast_id: str) -> dict[str, Any]:
        """Delete a broadcast that is not running"""
        return cast(
            "dict[str, Any]", self._request("DELETE", f"/broadcast/{broadcast_id}")
        )

    def stats(self, broadcast_id: str) -> dict[str, Any]:
        """Get broadcast statistics, with ``successRate`` and ``progress`` in percent"""
        return cast(
            "dict[str, Any]", self._request("GET", f"/broadcast/{broadcast_id}/stats")
        )

    def list(
        self,
        profile_id: str,
        limit: int | None = None,
        offset: int = 0,
        status: str | None = None,
    ) -> list[Broadcast]:
        """List broadcasts for a profile, newest first.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = self._request(
            "GET", "/broadcast", params={"profileId": profile_id, "status": status}
        )
        return [Broadcast.model_validate(b) for b in rows[offset:][:limit]]


class AsyncBroadcastsClient(AsyncResource):
    """Asynchronous Broadcasts API client"""

    async def create(
        self,
        profile_id: str,
        name: str,
        recipients: Recipients,
        template_id: str | None = None,
        message: BroadcastMessage | None = None,
        schedule_at: str | datetime | None = None,
        settings: dict[str, Any] | None = None,
    ) -> Broadcast:
        """Create a broadcast campaign; see ``BroadcastsClient.create``"""
        body = _create_body(
            profile_id, name, recipients, template_id, message, settings
        )
        scheduled_at = None if schedule_at is None else _iso(schedule_at)
        broadcast = Broadcast.model_validate(
            await self._request("POST", "/broadcast", json=body)
        )
        if scheduled_at is None:
            return broadcast
        try:
            return await self.schedule(broadcast.id, scheduled_at)
        except httpx.HTTPError:
            with contextlib.suppress(httpx.HTTPError):
                await self.delete(broadcast.id)
            raise

    async def get(self, broadcast_id: str) -> Broadcast:
        """Get a broadcast by ID"""
        return Broadcast.model_validate(
            await self._request("GET", f"/broadcast/{broadcast_id}")
        )

    async def schedule(
        self, broadcast_id: str, scheduled_at: str | datetime
    ) -> Broadcast:
        """Schedule a draft broadcast for a future time"""
        return Broadcast.model_validate(
            await self._request(
                "POST",
                f"/broadcast/{broadcast_id}/schedule",
                json={"scheduledAt": _iso(scheduled_at)},
            )
        )

    async def start(self, broadcast_id: str) -> Broadcast:
        """Start a draft or scheduled broadcast now (a paused one is resumed)"""
        await self._request("POST", f"/broadcast/{broadcast_id}/start")
        return await self.get(broadcast_id)

    async def pause(self, broadcast_id: str) -> Broadcast:
        """Pause a running broadcast"""
        return Broadcast.model_validate(
            await self._request("POST", f"/broadcast/{broadcast_id}/pause")
        )

    async def resume(self, broadcast_id: str) -> Broadcast:
        """Resume a paused broadcast where it stopped"""
        await self._request("POST", f"/broadcast/{broadcast_id}/resume")
        return await self.get(broadcast_id)

    async def cancel(self, broadcast_id: str) -> Broadcast:
        """Cancel a broadcast (the API marks it ``failed``)"""
        return Broadcast.model_validate(
            await self._request("POST", f"/broadcast/{broadcast_id}/cancel")
        )

    async def delete(self, broadcast_id: str) -> dict[str, Any]:
        """Delete a broadcast that is not running"""
        return cast(
            "dict[str, Any]",
            await self._request("DELETE", f"/broadcast/{broadcast_id}"),
        )

    async def stats(self, broadcast_id: str) -> dict[str, Any]:
        """Get broadcast statistics, with ``successRate`` and ``progress`` in percent"""
        return cast(
            "dict[str, Any]",
            await self._request("GET", f"/broadcast/{broadcast_id}/stats"),
        )

    async def list(
        self,
        profile_id: str,
        limit: int | None = None,
        offset: int = 0,
        status: str | None = None,
    ) -> list[Broadcast]:
        """List broadcasts for a profile, newest first.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = await self._request(
            "GET", "/broadcast", params={"profileId": profile_id, "status": status}
        )
        return [Broadcast.model_validate(b) for b in rows[offset:][:limit]]
