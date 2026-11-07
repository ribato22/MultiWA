"""
MultiWA Python SDK - Webhooks Client

Client for managing webhook configurations.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, cast

from ._base import AsyncResource, SyncResource
from .types import Webhook


def verify_webhook_signature(
    payload: str | bytes,
    signature: str | None,
    secret: str,
) -> bool:
    """Verify a MultiWA webhook HMAC-SHA256 signature.

    MultiWA signs every webhook with HMAC-SHA256 over the **raw request body**
    and sends it in the ``X-MultiWA-Signature`` header as ``sha256=<hex>``.
    Pass the RAW body — a re-serialized object will not match.

    Returns ``True`` when the signature is valid, ``False`` otherwise.
    """
    if not signature or not secret:
        return False
    body = payload.encode() if isinstance(payload, str) else payload
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _reject_secret(secret: str | None) -> None:
    if secret is not None:
        raise ValueError(
            "The MultiWA API generates the webhook secret itself; "
            "read it from Webhook.secret instead of passing one"
        )


class WebhooksClient(SyncResource):
    """Synchronous Webhooks API client"""

    def create(
        self,
        profile_id: str,
        url: str,
        events: list[str],
        secret: str | None = None,
    ) -> Webhook:
        """Create a webhook. The API generates its signing secret
        (``Webhook.secret``); passing ``secret`` raises ``ValueError``.
        """
        _reject_secret(secret)
        return Webhook.model_validate(
            self._request(
                "POST",
                "/webhooks",
                json={
                    "profileId": profile_id,
                    "url": url,
                    "events": events,
                },
            )
        )

    def get(self, webhook_id: str) -> Webhook:
        """Get a webhook by ID"""
        return Webhook.model_validate(self._request("GET", f"/webhooks/{webhook_id}"))

    def update(
        self,
        webhook_id: str,
        url: str | None = None,
        events: list[str] | None = None,
        is_active: bool | None = None,
        secret: str | None = None,
    ) -> Webhook:
        """Update a webhook; ``is_active`` enables or disables it.

        The secret cannot be changed: passing ``secret`` raises ``ValueError``.
        """
        _reject_secret(secret)
        return Webhook.model_validate(
            self._request(
                "PUT",
                f"/webhooks/{webhook_id}",
                json={"url": url, "events": events, "enabled": is_active},
            )
        )

    def delete(self, webhook_id: str) -> dict[str, Any]:
        """Delete a webhook"""
        return cast(
            "dict[str, Any]", self._request("DELETE", f"/webhooks/{webhook_id}")
        )

    def test(self, webhook_id: str) -> dict[str, Any]:
        """Send a test event to the webhook; returns ``{"success", "message"}``"""
        return cast(
            "dict[str, Any]", self._request("POST", f"/webhooks/{webhook_id}/test")
        )

    def list(
        self,
        profile_id: str,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Webhook]:
        """List webhooks for a profile.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = self._request("GET", "/webhooks", params={"profileId": profile_id})
        return [Webhook.model_validate(w) for w in rows[offset:][:limit]]


class AsyncWebhooksClient(AsyncResource):
    """Asynchronous Webhooks API client"""

    async def create(
        self,
        profile_id: str,
        url: str,
        events: list[str],
        secret: str | None = None,
    ) -> Webhook:
        """Create a webhook. The API generates its signing secret
        (``Webhook.secret``); passing ``secret`` raises ``ValueError``.
        """
        _reject_secret(secret)
        return Webhook.model_validate(
            await self._request(
                "POST",
                "/webhooks",
                json={
                    "profileId": profile_id,
                    "url": url,
                    "events": events,
                },
            )
        )

    async def get(self, webhook_id: str) -> Webhook:
        """Get a webhook by ID"""
        return Webhook.model_validate(
            await self._request("GET", f"/webhooks/{webhook_id}")
        )

    async def update(
        self,
        webhook_id: str,
        url: str | None = None,
        events: list[str] | None = None,
        is_active: bool | None = None,
        secret: str | None = None,
    ) -> Webhook:
        """Update a webhook; ``is_active`` enables or disables it.

        The secret cannot be changed: passing ``secret`` raises ``ValueError``.
        """
        _reject_secret(secret)
        return Webhook.model_validate(
            await self._request(
                "PUT",
                f"/webhooks/{webhook_id}",
                json={"url": url, "events": events, "enabled": is_active},
            )
        )

    async def delete(self, webhook_id: str) -> dict[str, Any]:
        """Delete a webhook"""
        return cast(
            "dict[str, Any]", await self._request("DELETE", f"/webhooks/{webhook_id}")
        )

    async def test(self, webhook_id: str) -> dict[str, Any]:
        """Send a test event to the webhook; returns ``{"success", "message"}``"""
        return cast(
            "dict[str, Any]",
            await self._request("POST", f"/webhooks/{webhook_id}/test"),
        )

    async def list(
        self,
        profile_id: str,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Webhook]:
        """List webhooks for a profile.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = await self._request("GET", "/webhooks", params={"profileId": profile_id})
        return [Webhook.model_validate(w) for w in rows[offset:][:limit]]
