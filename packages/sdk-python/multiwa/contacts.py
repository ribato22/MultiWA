"""
MultiWA Python SDK - Contacts Client

Client for managing WhatsApp contacts.
"""

from __future__ import annotations

from typing import Any, cast

from ._base import AsyncResource, SyncResource
from .types import Contact


def _reject_email(email: str | None) -> None:
    if email is not None:
        raise ValueError(
            "The MultiWA API stores no email for a contact; "
            "keep it in metadata instead, e.g. metadata={'email': ...}"
        )


def _list_params(
    profile_id: str,
    limit: int,
    offset: int,
    search: str | None,
    tags: list[str] | None,
) -> dict[str, Any]:
    # A list value is sent as a repeated parameter: ?tags=a&tags=b
    return {
        "profileId": profile_id,
        "limit": limit,
        "offset": offset,
        "search": search,
        "tags": tags or None,
    }


class ContactsClient(SyncResource):
    """Synchronous Contacts API client"""

    def create(
        self,
        profile_id: str,
        phone: str,
        name: str | None = None,
        email: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Contact:
        """Create a contact. An existing phone number is updated instead
        (tags and metadata are merged).

        ``email`` is not supported by the API and raises ``ValueError``.
        """
        _reject_email(email)
        return Contact.model_validate(
            self._request(
                "POST",
                "/contacts",
                json={
                    "profileId": profile_id,
                    "phone": phone,
                    "name": name,
                    "tags": tags,
                    "metadata": metadata,
                },
            )
        )

    def get(self, contact_id: str) -> Contact:
        """Get a contact by ID"""
        return Contact.model_validate(self._request("GET", f"/contacts/{contact_id}"))

    def update(
        self,
        contact_id: str,
        name: str | None = None,
        email: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Contact:
        """Update a contact. ``tags`` and ``metadata`` replace the stored values.

        ``email`` is not supported by the API and raises ``ValueError``.
        """
        _reject_email(email)
        return Contact.model_validate(
            self._request(
                "PUT",
                f"/contacts/{contact_id}",
                json={"name": name, "tags": tags, "metadata": metadata},
            )
        )

    def delete(self, contact_id: str) -> dict[str, Any]:
        """Delete a contact"""
        return cast(
            "dict[str, Any]", self._request("DELETE", f"/contacts/{contact_id}")
        )

    def add_tags(
        self,
        contact_id: str,
        tags: list[str],
    ) -> Contact:
        """Add tags to a contact"""
        return Contact.model_validate(
            self._request("POST", f"/contacts/{contact_id}/tags", json={"tags": tags})
        )

    def remove_tags(
        self,
        contact_id: str,
        tags: list[str],
    ) -> Contact:
        """Remove tags from a contact"""
        return Contact.model_validate(
            self._request("DELETE", f"/contacts/{contact_id}/tags", json={"tags": tags})
        )

    def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        search: str | None = None,
        tags: list[str] | None = None,
    ) -> list[Contact]:
        """List contacts for a profile. ``tags`` matches contacts with any of them."""
        page = self._request(
            "GET",
            "/contacts",
            params=_list_params(profile_id, limit, offset, search, tags),
        )
        return [Contact.model_validate(c) for c in page["contacts"]]


class AsyncContactsClient(AsyncResource):
    """Asynchronous Contacts API client"""

    async def create(
        self,
        profile_id: str,
        phone: str,
        name: str | None = None,
        email: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Contact:
        """Create a contact. An existing phone number is updated instead
        (tags and metadata are merged).

        ``email`` is not supported by the API and raises ``ValueError``.
        """
        _reject_email(email)
        return Contact.model_validate(
            await self._request(
                "POST",
                "/contacts",
                json={
                    "profileId": profile_id,
                    "phone": phone,
                    "name": name,
                    "tags": tags,
                    "metadata": metadata,
                },
            )
        )

    async def get(self, contact_id: str) -> Contact:
        """Get a contact by ID"""
        return Contact.model_validate(
            await self._request("GET", f"/contacts/{contact_id}")
        )

    async def update(
        self,
        contact_id: str,
        name: str | None = None,
        email: str | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Contact:
        """Update a contact. ``tags`` and ``metadata`` replace the stored values.

        ``email`` is not supported by the API and raises ``ValueError``.
        """
        _reject_email(email)
        return Contact.model_validate(
            await self._request(
                "PUT",
                f"/contacts/{contact_id}",
                json={"name": name, "tags": tags, "metadata": metadata},
            )
        )

    async def delete(self, contact_id: str) -> dict[str, Any]:
        """Delete a contact"""
        return cast(
            "dict[str, Any]", await self._request("DELETE", f"/contacts/{contact_id}")
        )

    async def add_tags(
        self,
        contact_id: str,
        tags: list[str],
    ) -> Contact:
        """Add tags to a contact"""
        return Contact.model_validate(
            await self._request(
                "POST", f"/contacts/{contact_id}/tags", json={"tags": tags}
            )
        )

    async def remove_tags(
        self,
        contact_id: str,
        tags: list[str],
    ) -> Contact:
        """Remove tags from a contact"""
        return Contact.model_validate(
            await self._request(
                "DELETE", f"/contacts/{contact_id}/tags", json={"tags": tags}
            )
        )

    async def list(
        self,
        profile_id: str,
        limit: int = 50,
        offset: int = 0,
        search: str | None = None,
        tags: list[str] | None = None,
    ) -> list[Contact]:
        """List contacts for a profile. ``tags`` matches contacts with any of them."""
        page = await self._request(
            "GET",
            "/contacts",
            params=_list_params(profile_id, limit, offset, search, tags),
        )
        return [Contact.model_validate(c) for c in page["contacts"]]
