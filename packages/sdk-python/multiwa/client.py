"""
MultiWA Python SDK - Core Client

Main client class for synchronous and asynchronous API access.
"""

from __future__ import annotations

from typing import Any

import httpx

from .broadcasts import AsyncBroadcastsClient, BroadcastsClient
from .contacts import AsyncContactsClient, ContactsClient
from .messages import AsyncMessagesClient, MessagesClient
from .profiles import AsyncProfilesClient, ProfilesClient
from .webhooks import AsyncWebhooksClient, WebhooksClient


def _normalize_base_url(base_url: str) -> str:
    """Return ``base_url`` with exactly one trailing slash.

    httpx joins ``base_url`` with the request path using URL semantics, so the
    configured base must end with a slash. Request paths must be relative
    (no leading slash) for the base path such as ``/api/v1`` to survive.
    """
    return base_url.rstrip("/") + "/"


def _headers(api_key: str) -> dict[str, str]:
    # No default Content-Type: httpx sets it when a request has a JSON body.
    # A bodyless POST or DELETE that claims application/json is refused by the
    # API with a 400 (Fastify: "Body cannot be empty when content-type is set").
    return {"X-API-Key": api_key}


class _MultiWAHttpClient(httpx.Client):
    """httpx.Client variant that preserves the API base path.

    A request path that begins with ``/`` is treated by URL semantics as
    absolute and would drop the ``/api/v1`` prefix configured on the base
    URL. Existing endpoint methods in this SDK call the HTTP client with
    leading-slash paths (for example ``/messages/text``). To keep them
    working while still preserving the configured base path, we trim the
    leading slash before httpx builds the request.
    """

    def build_request(self, method, url, **kwargs):
        if isinstance(url, str) and url.startswith("/"):
            url = url.lstrip("/")
        return super().build_request(method, url, **kwargs)


class _MultiWAAsyncHttpClient(httpx.AsyncClient):
    """Async variant of ``_MultiWAHttpClient`` with the same behavior."""

    def build_request(self, method, url, **kwargs):
        if isinstance(url, str) and url.startswith("/"):
            url = url.lstrip("/")
        return super().build_request(method, url, **kwargs)


class MultiWA:
    """
    Synchronous MultiWA API Client

    Example:
        client = MultiWA(
            base_url="https://your-instance.com/api/v1",
            api_key="your-api-key",
        )
        result = client.messages.send_text(profile_id, to, "Hello!")

    ``transport`` is passed to httpx (for example a ``httpx.MockTransport``
    in tests, or ``httpx.HTTPTransport(retries=3)``).
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
        transport: httpx.BaseTransport | None = None,
    ):
        # Keep the externally-visible base_url unchanged (no trailing slash),
        # but pass a trailing-slash version to httpx so the API prefix is
        # preserved when endpoints use either absolute or relative paths.
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

        self._http = _MultiWAHttpClient(
            base_url=_normalize_base_url(base_url),
            headers=_headers(api_key),
            timeout=timeout,
            transport=transport,
        )

        # Initialize API clients
        self.messages = MessagesClient(self._http)
        self.contacts = ContactsClient(self._http)
        self.broadcasts = BroadcastsClient(self._http)
        self.profiles = ProfilesClient(self._http)
        self.webhooks = WebhooksClient(self._http)

    def close(self) -> None:
        """Close the HTTP client"""
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Make a raw API request; ``path`` is relative to ``base_url``"""
        response = self._http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()


class AsyncMultiWA:
    """
    Asynchronous MultiWA API Client

    Example:
        async with AsyncMultiWA(
            base_url="https://your-instance.com/api/v1",
            api_key="your-api-key",
        ) as client:
            result = await client.messages.send_text(profile_id, to, "Hello!")
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 30.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

        self._http = _MultiWAAsyncHttpClient(
            base_url=_normalize_base_url(base_url),
            headers=_headers(api_key),
            timeout=timeout,
            transport=transport,
        )

        # Initialize API clients
        self.messages = AsyncMessagesClient(self._http)
        self.contacts = AsyncContactsClient(self._http)
        self.broadcasts = AsyncBroadcastsClient(self._http)
        self.profiles = AsyncProfilesClient(self._http)
        self.webhooks = AsyncWebhooksClient(self._http)

    async def close(self) -> None:
        """Close the HTTP client"""
        await self._http.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        """Make a raw API request; ``path`` is relative to ``base_url``"""
        response = await self._http.request(method, path, **kwargs)
        response.raise_for_status()
        return response.json()
