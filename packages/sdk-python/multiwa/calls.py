"""
MultiWA Python SDK - Calls Client

Incoming WhatsApp calls: the follow-up queue, the readiness of answering them in
the dashboard, the recordings and the announcement callers hear first. Agents
answer calls in the dashboard; follow them with the ``call.*`` webhooks.
"""

from __future__ import annotations

import os
from typing import IO, Any

import httpx

from ._base import AsyncResource, SyncResource, compact
from .types import (
    AnnouncementResult,
    AudioFile,
    Call,
    CallLinkResult,
    CallPage,
    CallReplyResult,
    CallsMediaStatus,
    CallsSettings,
    DeletedRecording,
)


def _list_params(
    profile_id: str,
    outcome: str | None,
    follow_up: str | None,
    from_: str | None,
    since: str | None,
    limit: int | None,
    cursor: str | None,
) -> dict[str, Any]:
    return {
        "profileId": profile_id,
        "outcome": outcome,
        "followUp": follow_up,
        "from": from_,
        "since": since,
        "limit": limit,
        "cursor": cursor,
    }


def _update_body(
    follow_up: str | None, assigned_user_id: str | None, unassign: bool
) -> dict[str, Any]:
    # Sent as built (not through _request, which drops None): the one null the
    # API gets is the unassign.
    if unassign and assigned_user_id is not None:
        raise ValueError("Pass assigned_user_id or unassign=True, not both")
    body = compact({"followUp": follow_up, "assignedUserId": assigned_user_id})
    return {**body, "assignedUserId": None} if unassign else body


def _settings_body(
    answer_in_dashboard: bool | None, recording: bool | None, retention_days: int | None
) -> dict[str, Any]:
    return {
        "answerInDashboard": answer_in_dashboard,
        "recording": recording,
        "retentionDays": retention_days,
    }


def _announcement(
    file: bytes | bytearray | memoryview | IO[bytes], filename: str | None
) -> tuple[str, bytes | IO[bytes]]:
    # Never an empty filename: httpx would leave it out, and the server would
    # find no file in the request (400).
    own = getattr(file, "name", None)
    if not filename and isinstance(own, str):
        filename = os.path.basename(own)
    # httpx sends bytes as they are, and reads anything else as a file.
    content = bytes(file) if isinstance(file, (bytes, bytearray, memoryview)) else file
    return filename or "announcement", content


def _audio(response: httpx.Response) -> AudioFile:
    return AudioFile(
        content=response.content,
        content_type=response.headers.get("content-type", "application/octet-stream"),
    )


class CallsClient(SyncResource):
    """Synchronous Calls API client"""

    def list(
        self,
        profile_id: str,
        outcome: str | None = None,
        follow_up: str | None = None,
        from_: str | None = None,
        since: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> CallPage:
        """A page of a profile's calls, newest first (any role; an API key needs
        no scope).

        ``from_`` is the caller (a phone number or a JID), ``since`` an ISO 8601
        date, ``limit`` 1 to 100 (default 50). Pass ``next_cursor`` of a page as
        ``cursor`` for the next one.
        """
        return CallPage.model_validate(
            self._request(
                "GET",
                "/calls",
                params=_list_params(
                    profile_id, outcome, follow_up, from_, since, limit, cursor
                ),
            )
        )

    def open_count(self) -> int:
        """How many calls of the organization have their follow-up open (any
        role; an API key needs no scope)"""
        return int(self._request("GET", "/calls/open-count")["count"])

    def get(self, call_id: str) -> Call:
        """Get a call by ID (any role; an API key needs no scope)"""
        return Call.model_validate(self._request("GET", f"/calls/{call_id}"))

    def update(
        self,
        call_id: str,
        follow_up: str | None = None,
        assigned_user_id: str | None = None,
        unassign: bool = False,
    ) -> Call:
        """Change the follow-up or the assignee (any role; an API key needs no
        scope).

        ``follow_up`` is ``open``, ``in_progress`` or ``done``; the assignee is an
        active user of the organization, and ``unassign=True`` removes it.
        """
        body = _update_body(follow_up, assigned_user_id, unassign)
        return Call.model_validate(
            self._raw("PATCH", f"/calls/{call_id}", json=body).json()
        )

    def reject(self, call_id: str) -> Call:
        """Reject a call that is still ringing (any role; an API key needs no
        scope)"""
        return Call.model_validate(self._request("POST", f"/calls/{call_id}/reject"))

    def reply(self, call_id: str, text: str | None = None) -> CallReplyResult:
        """Send a text to the caller, through the send gate (any role; an API
        key with a scope list needs ``messages:write``); without ``text``, the
        profile's default call reply."""
        return CallReplyResult.model_validate(
            self._request("POST", f"/calls/{call_id}/reply", json={"text": text})
        )

    def send_call_link(
        self, call_id: str, link_type: str, text: str | None = None
    ) -> CallLinkResult:
        """Create a WhatsApp call link (``voice`` or ``video``) and send it to
        the caller, with an optional text above it (any role; an API key with a
        scope list needs ``messages:write``)."""
        return CallLinkResult.model_validate(
            self._request(
                "POST",
                f"/calls/{call_id}/call-link",
                json={"type": link_type, "text": text},
            )
        )

    def media_status(self) -> CallsMediaStatus:
        """Readiness of answering calls in the dashboard: the server, its
        recordings storage, and every profile with its call settings (owner or
        admin; an API key needs no scope)."""
        return CallsMediaStatus.model_validate(
            self._request("GET", "/calls/media/status")
        )

    def get_recording(self, call_id: str, download: bool = False) -> AudioFile:
        """The call's recording, ``audio/webm`` (owner or admin; an API key with
        a scope list needs ``recordings:read``). Every read is audited,
        ``download=True`` as a download."""
        return _audio(
            self._raw(
                "GET",
                f"/calls/{call_id}/recording",
                params={"download": "1"} if download else None,
            )
        )

    def delete_recording(self, call_id: str) -> DeletedRecording:
        """Delete the call's recording: the file goes, its row stays as
        evidence (owner or admin; an API key with a scope list needs
        ``recordings:delete``)."""
        return DeletedRecording.model_validate(
            self._request("DELETE", f"/calls/{call_id}/recording")
        )

    def update_settings(
        self,
        profile_id: str,
        answer_in_dashboard: bool | None = None,
        recording: bool | None = None,
        retention_days: int | None = None,
    ) -> CallsSettings:
        """A profile's call settings (owner or admin; an API key with a scope
        list needs ``profiles:write``, and ``recordings:delete`` too for
        ``retention_days``, 1 to 3650). A setting that cannot be turned on is
        refused with 409; ``reasons`` in the response body says why."""
        return CallsSettings.model_validate(
            self._request(
                "PUT",
                f"/profiles/{profile_id}/calls-settings",
                json=_settings_body(answer_in_dashboard, recording, retention_days),
            )
        )

    def upload_announcement(
        self,
        profile_id: str,
        file: bytes | bytearray | memoryview | IO[bytes],
        filename: str | None = None,
    ) -> AnnouncementResult:
        """Upload the announcement callers hear before a recorded call (owner or
        admin; an API key with a scope list needs ``profiles:write``): mp3, wav,
        ogg, webm or m4a, at most 2 MB and 30 seconds. The server reads the type
        and the length from the file itself, not from its name, which is
        ``filename``, else the base name of a file object's own ``name``, else
        ``announcement``."""
        return AnnouncementResult.model_validate(
            self._raw(
                "POST",
                f"/profiles/{profile_id}/calls-announcement",
                files={"file": _announcement(file, filename)},
            ).json()
        )

    def get_announcement(self, profile_id: str) -> AudioFile:
        """The profile's announcement, to listen to (owner or admin; an API key
        with a scope list needs ``profiles:write``)"""
        return _audio(self._raw("GET", f"/profiles/{profile_id}/calls-announcement"))

    def delete_announcement(self, profile_id: str) -> AnnouncementResult:
        """Remove the announcement (owner or admin; an API key with a scope list
        needs ``profiles:write``); refused with 409 (``recording_on``) while
        recording is on."""
        return AnnouncementResult.model_validate(
            self._request("DELETE", f"/profiles/{profile_id}/calls-announcement")
        )


class AsyncCallsClient(AsyncResource):
    """Asynchronous Calls API client"""

    async def list(
        self,
        profile_id: str,
        outcome: str | None = None,
        follow_up: str | None = None,
        from_: str | None = None,
        since: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> CallPage:
        """A page of a profile's calls, newest first; see ``CallsClient.list``"""
        return CallPage.model_validate(
            await self._request(
                "GET",
                "/calls",
                params=_list_params(
                    profile_id, outcome, follow_up, from_, since, limit, cursor
                ),
            )
        )

    async def open_count(self) -> int:
        """How many calls of the organization have their follow-up open; see
        ``CallsClient.open_count``"""
        return int((await self._request("GET", "/calls/open-count"))["count"])

    async def get(self, call_id: str) -> Call:
        """Get a call by ID; see ``CallsClient.get``"""
        return Call.model_validate(await self._request("GET", f"/calls/{call_id}"))

    async def update(
        self,
        call_id: str,
        follow_up: str | None = None,
        assigned_user_id: str | None = None,
        unassign: bool = False,
    ) -> Call:
        """Change the follow-up or the assignee; see ``CallsClient.update``"""
        body = _update_body(follow_up, assigned_user_id, unassign)
        return Call.model_validate(
            (await self._raw("PATCH", f"/calls/{call_id}", json=body)).json()
        )

    async def reject(self, call_id: str) -> Call:
        """Reject a call that is still ringing; see ``CallsClient.reject``"""
        return Call.model_validate(
            await self._request("POST", f"/calls/{call_id}/reject")
        )

    async def reply(self, call_id: str, text: str | None = None) -> CallReplyResult:
        """Send a text to the caller; see ``CallsClient.reply``"""
        return CallReplyResult.model_validate(
            await self._request("POST", f"/calls/{call_id}/reply", json={"text": text})
        )

    async def send_call_link(
        self, call_id: str, link_type: str, text: str | None = None
    ) -> CallLinkResult:
        """Create a WhatsApp call link and send it to the caller; see
        ``CallsClient.send_call_link``"""
        return CallLinkResult.model_validate(
            await self._request(
                "POST",
                f"/calls/{call_id}/call-link",
                json={"type": link_type, "text": text},
            )
        )

    async def media_status(self) -> CallsMediaStatus:
        """Readiness of answering calls in the dashboard; see
        ``CallsClient.media_status``"""
        return CallsMediaStatus.model_validate(
            await self._request("GET", "/calls/media/status")
        )

    async def get_recording(self, call_id: str, download: bool = False) -> AudioFile:
        """The call's recording; see ``CallsClient.get_recording``"""
        return _audio(
            await self._raw(
                "GET",
                f"/calls/{call_id}/recording",
                params={"download": "1"} if download else None,
            )
        )

    async def delete_recording(self, call_id: str) -> DeletedRecording:
        """Delete the call's recording; see ``CallsClient.delete_recording``"""
        return DeletedRecording.model_validate(
            await self._request("DELETE", f"/calls/{call_id}/recording")
        )

    async def update_settings(
        self,
        profile_id: str,
        answer_in_dashboard: bool | None = None,
        recording: bool | None = None,
        retention_days: int | None = None,
    ) -> CallsSettings:
        """A profile's call settings; see ``CallsClient.update_settings``"""
        return CallsSettings.model_validate(
            await self._request(
                "PUT",
                f"/profiles/{profile_id}/calls-settings",
                json=_settings_body(answer_in_dashboard, recording, retention_days),
            )
        )

    async def upload_announcement(
        self,
        profile_id: str,
        file: bytes | bytearray | memoryview | IO[bytes],
        filename: str | None = None,
    ) -> AnnouncementResult:
        """Upload the announcement; see ``CallsClient.upload_announcement``"""
        return AnnouncementResult.model_validate(
            (
                await self._raw(
                    "POST",
                    f"/profiles/{profile_id}/calls-announcement",
                    files={"file": _announcement(file, filename)},
                )
            ).json()
        )

    async def get_announcement(self, profile_id: str) -> AudioFile:
        """The profile's announcement, to listen to; see
        ``CallsClient.get_announcement``"""
        return _audio(
            await self._raw("GET", f"/profiles/{profile_id}/calls-announcement")
        )

    async def delete_announcement(self, profile_id: str) -> AnnouncementResult:
        """Remove the announcement; see ``CallsClient.delete_announcement``"""
        return AnnouncementResult.model_validate(
            await self._request("DELETE", f"/profiles/{profile_id}/calls-announcement")
        )
