"""
MultiWA Python SDK - Shared request plumbing for the resource clients.
"""

from __future__ import annotations

from typing import Any

import httpx


def compact(data: dict[str, Any]) -> dict[str, Any]:
    """Drop ``None`` values, so an unset option is left out instead of sent as null."""
    return {key: value for key, value in data.items() if value is not None}


def _options(
    params: dict[str, Any] | None, json: dict[str, Any] | None
) -> dict[str, Any]:
    return {
        "params": compact(params) if params else None,
        "json": None if json is None else compact(json),
    }


class SyncResource:
    """Base class of the synchronous resource clients."""

    def __init__(self, http: httpx.Client):
        self._http = http

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        response = self._http.request(method, path, **_options(params, json))
        response.raise_for_status()
        return response.json()


class AsyncResource:
    """Base class of the asynchronous resource clients."""

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        response = await self._http.request(method, path, **_options(params, json))
        response.raise_for_status()
        return response.json()
