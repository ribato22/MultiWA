"""
MultiWA Python SDK - Profiles Client

Client for managing WhatsApp profiles/accounts.
"""

from __future__ import annotations

from typing import Any, NoReturn, cast

from ._base import AsyncResource, SyncResource
from .types import Profile


def _update_body(name: str | None, is_active: bool | None) -> dict[str, Any]:
    if is_active is not None:
        raise ValueError("The MultiWA API has no active flag for a profile")
    return {"name": name}


def _no_qr_route() -> NoReturn:
    raise NotImplementedError(
        "The MultiWA API has no QR code route. Call connect(), then take the QR "
        "code from the WebSocket 'qr:update' event (namespace /ws, after joining "
        "the profile) or from a 'connection.qr' webhook."
    )


class ProfilesClient(SyncResource):
    """Synchronous Profiles API client"""

    def create(
        self,
        workspace_id: str,
        name: str,
        engine: str = "whatsapp-web-js",
    ) -> Profile:
        """Create a new profile"""
        return Profile.model_validate(
            self._request(
                "POST",
                "/profiles",
                json={
                    "workspaceId": workspace_id,
                    "name": name,
                    "engine": engine,
                },
            )
        )

    def get(self, profile_id: str) -> Profile:
        """Get a profile by ID"""
        return Profile.model_validate(self._request("GET", f"/profiles/{profile_id}"))

    def update(
        self,
        profile_id: str,
        name: str | None = None,
        is_active: bool | None = None,
    ) -> Profile:
        """Rename a profile.

        ``is_active`` has no API equivalent and raises ``ValueError``.
        """
        return Profile.model_validate(
            self._request(
                "PUT", f"/profiles/{profile_id}", json=_update_body(name, is_active)
            )
        )

    def delete(self, profile_id: str) -> dict[str, Any]:
        """Delete a profile (it is disconnected first)"""
        return cast(
            "dict[str, Any]", self._request("DELETE", f"/profiles/{profile_id}")
        )

    def connect(self, profile_id: str) -> dict[str, Any]:
        """Connect a profile to WhatsApp.

        Returns ``{"status", "message"}``, or ``{"status": "already_connected",
        "phone"}``. The QR code to scan arrives over the WebSocket ``qr:update``
        event and the ``connection.qr`` webhook.
        """
        return cast(
            "dict[str, Any]",
            self._request("POST", f"/profiles/{profile_id}/connect"),
        )

    def disconnect(self, profile_id: str) -> dict[str, Any]:
        """Disconnect a profile from WhatsApp; returns ``{"status"}``"""
        return cast(
            "dict[str, Any]",
            self._request("POST", f"/profiles/{profile_id}/disconnect"),
        )

    def get_qr(self, profile_id: str) -> dict[str, str]:
        """Always raises ``NotImplementedError``.

        .. deprecated:: 1.3.0
            The API has no QR code route. After ``connect()``, take the QR code
            from the WebSocket ``qr:update`` event or the ``connection.qr`` webhook.
        """
        _no_qr_route()

    def status(self, profile_id: str) -> dict[str, Any]:
        """Get the connection status: ``id``, ``name``, ``status``, ``phone``,
        ``lastConnectedAt`` and ``engineConnected``"""
        return cast(
            "dict[str, Any]", self._request("GET", f"/profiles/{profile_id}/status")
        )

    def list(
        self,
        workspace_id: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Profile]:
        """List the profiles of your organization, or of one workspace.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = self._request("GET", "/profiles", params={"workspaceId": workspace_id})
        return [Profile.model_validate(p) for p in rows[offset:][:limit]]


class AsyncProfilesClient(AsyncResource):
    """Asynchronous Profiles API client"""

    async def create(
        self,
        workspace_id: str,
        name: str,
        engine: str = "whatsapp-web-js",
    ) -> Profile:
        """Create a new profile"""
        return Profile.model_validate(
            await self._request(
                "POST",
                "/profiles",
                json={
                    "workspaceId": workspace_id,
                    "name": name,
                    "engine": engine,
                },
            )
        )

    async def get(self, profile_id: str) -> Profile:
        """Get a profile by ID"""
        return Profile.model_validate(
            await self._request("GET", f"/profiles/{profile_id}")
        )

    async def update(
        self,
        profile_id: str,
        name: str | None = None,
        is_active: bool | None = None,
    ) -> Profile:
        """Rename a profile.

        ``is_active`` has no API equivalent and raises ``ValueError``.
        """
        return Profile.model_validate(
            await self._request(
                "PUT", f"/profiles/{profile_id}", json=_update_body(name, is_active)
            )
        )

    async def delete(self, profile_id: str) -> dict[str, Any]:
        """Delete a profile (it is disconnected first)"""
        return cast(
            "dict[str, Any]", await self._request("DELETE", f"/profiles/{profile_id}")
        )

    async def connect(self, profile_id: str) -> dict[str, Any]:
        """Connect a profile to WhatsApp; see ``ProfilesClient.connect``"""
        return cast(
            "dict[str, Any]",
            await self._request("POST", f"/profiles/{profile_id}/connect"),
        )

    async def disconnect(self, profile_id: str) -> dict[str, Any]:
        """Disconnect a profile from WhatsApp; returns ``{"status"}``"""
        return cast(
            "dict[str, Any]",
            await self._request("POST", f"/profiles/{profile_id}/disconnect"),
        )

    async def get_qr(self, profile_id: str) -> dict[str, str]:
        """Always raises ``NotImplementedError``.

        .. deprecated:: 1.3.0
            The API has no QR code route. After ``connect()``, take the QR code
            from the WebSocket ``qr:update`` event or the ``connection.qr`` webhook.
        """
        _no_qr_route()

    async def status(self, profile_id: str) -> dict[str, Any]:
        """Get the connection status; see ``ProfilesClient.status``"""
        return cast(
            "dict[str, Any]",
            await self._request("GET", f"/profiles/{profile_id}/status"),
        )

    async def list(
        self,
        workspace_id: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Profile]:
        """List the profiles of your organization, or of one workspace.

        The API returns the full list; ``limit``/``offset`` are applied here.
        """
        rows = await self._request(
            "GET", "/profiles", params={"workspaceId": workspace_id}
        )
        return [Profile.model_validate(p) for p in rows[offset:][:limit]]
