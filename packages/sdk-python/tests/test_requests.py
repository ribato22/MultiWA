"""Every public SDK method sends the request the MultiWA API expects.

Each case runs against both the sync and the async client through
``httpx.MockTransport`` and checks the method, the path (with the base path),
the query parameters, the JSON body, and that the route exists in
``scripts/api-routes.snapshot.json``.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple

import httpx
import pytest
import rows

from multiwa import AsyncMultiWA, MultiWA
from multiwa.types import Broadcast, Contact, MessageResult, Profile, Webhook

BASE_URL = "https://mw.test/api/v1"
SNAPSHOT = Path(__file__).resolve().parents[3] / "scripts" / "api-routes.snapshot.json"


def _route_patterns() -> list[tuple[str, re.Pattern[str]]]:
    """Snapshot routes as (method, regex), with every ``:param`` as one segment."""
    routes = json.loads(SNAPSHOT.read_text())["routes"]
    return [
        (
            route["method"],
            re.compile(
                "/".join(
                    "[^/]+" if part.startswith(":") else re.escape(part)
                    for part in route["path"].split("/")
                )
                + "$"
            ),
        )
        for route in routes
    ]


ROUTES = _route_patterns()


def route_exists(method: str, path: str) -> bool:
    return any(m == method and rx.match(path) for m, rx in ROUTES)


class Sent(NamedTuple):
    method: str
    path: str
    params: list[tuple[str, str]]
    body: dict[str, Any] | None


class Case(NamedTuple):
    name: str  # "<resource>.<method>"; the coverage test reads it
    call: Callable[[Any], Any]
    responses: list[Any]  # JSON bodies (200) or httpx.Response objects
    sent: list[Sent]
    check: Callable[[Any], bool] = lambda result: True


def run(
    kind: str,
    call: Callable[[Any], Any],
    responses: list[Any],
    requests: list[httpx.Request] | None = None,
) -> tuple[Any, list[httpx.Request]]:
    """Run ``call`` on a fresh client; return (result, requests sent).

    Pass ``requests`` to keep what was sent when ``call`` raises.
    """
    requests = [] if requests is None else requests
    queue = [
        r if isinstance(r, httpx.Response) else httpx.Response(200, json=r)
        for r in responses
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return queue.pop(0)

    transport = httpx.MockTransport(handler)
    if kind == "sync":
        with MultiWA(BASE_URL, "test-key", transport=transport) as client:
            return call(client), requests

    async def main():
        async with AsyncMultiWA(BASE_URL, "test-key", transport=transport) as client:
            result = call(client)
            assert inspect.iscoroutine(result), "async client method must be async"
            return await result

    return asyncio.run(main()), requests


V1 = "/api/v1"
IN_A_YEAR = (datetime.now(timezone.utc) + timedelta(days=365)).replace(microsecond=0)

CASES = [
    # ---------------- messages ----------------
    Case(
        "messages.send_text",
        lambda c: c.messages.send_text("p-1", "628111", "Hi", quoted_message_id="q-1"),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/text",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "text": "Hi",
                    "quotedMessageId": "q-1",
                },
            )
        ],
        lambda r: isinstance(r, MessageResult) and r.wa_message_id is not None,
    ),
    Case(
        "messages.send_image",
        lambda c: c.messages.send_image(
            "p-1", "628111", url="https://x.test/i.jpg", caption="Look"
        ),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/image",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "url": "https://x.test/i.jpg",
                    "caption": "Look",
                },
            )
        ],
    ),
    Case(
        "messages.send_video",
        lambda c: c.messages.send_video(
            "p-1", "628111", base64="AAAA", mimetype="video/mp4"
        ),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/video",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "base64": "AAAA",
                    "mimetype": "video/mp4",
                },
            )
        ],
    ),
    Case(
        "messages.send_audio",
        lambda c: c.messages.send_audio(
            "p-1", "628111", url="https://x.test/a.ogg", ptt=True
        ),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/audio",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "url": "https://x.test/a.ogg",
                    "ptt": True,
                },
            )
        ],
    ),
    Case(
        "messages.send_document",
        lambda c: c.messages.send_document(
            "p-1", "628111", "r.pdf", url="https://x.test/r.pdf"
        ),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/document",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "filename": "r.pdf",
                    "url": "https://x.test/r.pdf",
                },
            )
        ],
    ),
    Case(
        "messages.send_location",
        lambda c: c.messages.send_location("p-1", "628111", -6.2, 106.8, name="HQ"),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/location",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "latitude": -6.2,
                    "longitude": 106.8,
                    "name": "HQ",
                },
            )
        ],
    ),
    Case(
        "messages.send_contact",
        lambda c: c.messages.send_contact("p-1", "628111", "Bob", "+62822"),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/contact",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "contacts": [{"name": "Bob", "phone": "+62822"}],
                },
            )
        ],
    ),
    Case(
        "messages.send_poll",
        lambda c: c.messages.send_poll("p-1", "628111", "Color?", ["Red", "Blue"]),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/poll",
                [],
                {
                    "profileId": "p-1",
                    "to": "628111",
                    "question": "Color?",
                    "options": ["Red", "Blue"],
                    "allowMultipleAnswers": False,
                },
            )
        ],
    ),
    Case(
        "messages.send_reaction",
        lambda c: c.messages.send_reaction("p-1", "m-1", "👍"),
        [rows.SEND_RESULT],
        [
            Sent(
                "POST",
                f"{V1}/messages/reaction",
                [],
                {"profileId": "p-1", "messageId": "m-1", "emoji": "👍"},
            )
        ],
    ),
    Case(
        "messages.list",
        lambda c: c.messages.list("p-1", limit=10, offset=20, direction="incoming"),
        [[{"id": "m-1"}]],
        [
            Sent(
                "GET",
                f"{V1}/messages/profile/p-1",
                [("limit", "10"), ("offset", "20"), ("direction", "incoming")],
                None,
            )
        ],
        lambda r: r == [{"id": "m-1"}],
    ),
    # ---------------- contacts ----------------
    Case(
        "contacts.create",
        lambda c: c.contacts.create("p-1", "628111", name="Ann", tags=["vip"]),
        [rows.CONTACT_ROW],
        [
            Sent(
                "POST",
                f"{V1}/contacts",
                [],
                {"profileId": "p-1", "phone": "628111", "name": "Ann", "tags": ["vip"]},
            )
        ],
        lambda r: isinstance(r, Contact) and r.id == "c-1",
    ),
    Case(
        "contacts.get",
        lambda c: c.contacts.get("c-1"),
        [rows.CONTACT_ROW],
        [Sent("GET", f"{V1}/contacts/c-1", [], None)],
        lambda r: isinstance(r, Contact),
    ),
    Case(
        "contacts.update",
        lambda c: c.contacts.update("c-1", name="Ann B", metadata={"a": 1}),
        [rows.CONTACT_ROW],
        [
            Sent(
                "PUT", f"{V1}/contacts/c-1", [], {"name": "Ann B", "metadata": {"a": 1}}
            )
        ],
        lambda r: isinstance(r, Contact),
    ),
    Case(
        "contacts.delete",
        lambda c: c.contacts.delete("c-1"),
        [rows.OK],
        [Sent("DELETE", f"{V1}/contacts/c-1", [], None)],
        lambda r: r == {"success": True},
    ),
    Case(
        "contacts.add_tags",
        lambda c: c.contacts.add_tags("c-1", ["new"]),
        [rows.CONTACT_ROW],
        [Sent("POST", f"{V1}/contacts/c-1/tags", [], {"tags": ["new"]})],
        lambda r: isinstance(r, Contact),
    ),
    Case(
        "contacts.remove_tags",
        lambda c: c.contacts.remove_tags("c-1", ["vip"]),
        [rows.CONTACT_ROW],
        [Sent("DELETE", f"{V1}/contacts/c-1/tags", [], {"tags": ["vip"]})],
        lambda r: isinstance(r, Contact),
    ),
    Case(
        "contacts.list",
        lambda c: c.contacts.list("p-1", search="ann", tags=["vip", "lead"]),
        [rows.CONTACT_PAGE],
        [
            Sent(
                "GET",
                f"{V1}/contacts",
                [
                    ("profileId", "p-1"),
                    ("limit", "50"),
                    ("offset", "0"),
                    ("search", "ann"),
                    ("tags", "vip"),
                    ("tags", "lead"),
                ],
                None,
            )
        ],
        lambda r: [c.id for c in r] == ["c-1"],
    ),
    # ---------------- broadcasts ----------------
    Case(
        "broadcasts.create",
        lambda c: c.broadcasts.create(
            "p-1", "Promo", ["628111", "628222"], message="Hi"
        ),
        [rows.BROADCAST_ROW],
        [
            Sent(
                "POST",
                f"{V1}/broadcast",
                [],
                {
                    "profileId": "p-1",
                    "name": "Promo",
                    "message": {"type": "text", "text": "Hi"},
                    "recipients": {"type": "contacts", "value": ["628111", "628222"]},
                },
            )
        ],
        lambda r: isinstance(r, Broadcast) and r.id == "b-1",
    ),
    Case(
        "broadcasts.create (API objects, settings, schedule)",
        lambda c: c.broadcasts.create(
            "p-1",
            "Promo",
            {"type": "tags", "value": ["vip"]},
            message={"type": "image", "url": "https://x.test/i.jpg", "text": "Sale"},
            schedule_at=IN_A_YEAR,
            settings={"delayMin": 5000, "delayMax": 15000},
        ),
        [rows.BROADCAST_ROW, {**rows.BROADCAST_ROW, "status": "scheduled"}],
        [
            Sent(
                "POST",
                f"{V1}/broadcast",
                [],
                {
                    "profileId": "p-1",
                    "name": "Promo",
                    "message": {
                        "type": "image",
                        "url": "https://x.test/i.jpg",
                        "text": "Sale",
                    },
                    "recipients": {"type": "tags", "value": ["vip"]},
                    "settings": {"delayMin": 5000, "delayMax": 15000},
                },
            ),
            Sent(
                "POST",
                f"{V1}/broadcast/b-1/schedule",
                [],
                {"scheduledAt": IN_A_YEAR.isoformat()},
            ),
        ],
        lambda r: r.status == "scheduled",
    ),
    Case(
        "broadcasts.get",
        lambda c: c.broadcasts.get("b-1"),
        [rows.BROADCAST_ROW],
        [Sent("GET", f"{V1}/broadcast/b-1", [], None)],
        lambda r: r.sent_count == 1,
    ),
    Case(
        "broadcasts.schedule",
        lambda c: c.broadcasts.schedule("b-1", "2030-01-01T09:00:00Z"),
        [{**rows.BROADCAST_ROW, "status": "scheduled"}],
        [
            Sent(
                "POST",
                f"{V1}/broadcast/b-1/schedule",
                [],
                {"scheduledAt": "2030-01-01T09:00:00Z"},
            )
        ],
        lambda r: r.status == "scheduled",
    ),
    Case(
        "broadcasts.start",
        lambda c: c.broadcasts.start("b-1"),
        [
            {"success": True, "message": "Broadcast started", "recipientCount": 2},
            rows.BROADCAST_ROW,
        ],
        [
            Sent("POST", f"{V1}/broadcast/b-1/start", [], None),
            Sent("GET", f"{V1}/broadcast/b-1", [], None),
        ],
        lambda r: isinstance(r, Broadcast) and r.status == "running",
    ),
    Case(
        "broadcasts.pause",
        lambda c: c.broadcasts.pause("b-1"),
        [{**rows.BROADCAST_ROW, "status": "paused"}],
        [Sent("POST", f"{V1}/broadcast/b-1/pause", [], None)],
        lambda r: r.status == "paused",
    ),
    Case(
        "broadcasts.resume",
        lambda c: c.broadcasts.resume("b-1"),
        [{"success": True, "message": "Broadcast resumed"}, rows.BROADCAST_ROW],
        [
            Sent("POST", f"{V1}/broadcast/b-1/resume", [], None),
            Sent("GET", f"{V1}/broadcast/b-1", [], None),
        ],
        lambda r: isinstance(r, Broadcast) and r.status == "running",
    ),
    Case(
        "broadcasts.cancel",
        lambda c: c.broadcasts.cancel("b-1"),
        [{**rows.BROADCAST_ROW, "status": "failed"}],
        [Sent("POST", f"{V1}/broadcast/b-1/cancel", [], None)],
        lambda r: r.status == "failed",
    ),
    Case(
        "broadcasts.delete",
        lambda c: c.broadcasts.delete("b-1"),
        [rows.OK],
        [Sent("DELETE", f"{V1}/broadcast/b-1", [], None)],
        lambda r: r == {"success": True},
    ),
    Case(
        "broadcasts.stats",
        lambda c: c.broadcasts.stats("b-1"),
        [rows.BROADCAST_STATS],
        [Sent("GET", f"{V1}/broadcast/b-1/stats", [], None)],
        lambda r: r["stats"]["progress"] == 50,
    ),
    Case(
        "broadcasts.list",
        lambda c: c.broadcasts.list("p-1", status="running", limit=1, offset=1),
        [
            [
                rows.BROADCAST_ROW,
                {**rows.BROADCAST_ROW, "id": "b-2"},
                {**rows.BROADCAST_ROW, "id": "b-3"},
            ]
        ],
        [
            Sent(
                "GET",
                f"{V1}/broadcast",
                [("profileId", "p-1"), ("status", "running")],
                None,
            )
        ],
        lambda r: [b.id for b in r] == ["b-2"],
    ),
    # ---------------- profiles ----------------
    Case(
        "profiles.create",
        lambda c: c.profiles.create("ws-1", "Main"),
        [rows.PROFILE_ROW],
        [
            Sent(
                "POST",
                f"{V1}/profiles",
                [],
                {"workspaceId": "ws-1", "name": "Main", "engine": "whatsapp-web-js"},
            )
        ],
        lambda r: isinstance(r, Profile) and r.name == "Main",
    ),
    Case(
        "profiles.get",
        lambda c: c.profiles.get("p-1"),
        [rows.PROFILE_ROW],
        [Sent("GET", f"{V1}/profiles/p-1", [], None)],
        lambda r: r.name == "Main",
    ),
    Case(
        "profiles.update",
        lambda c: c.profiles.update("p-1", name="Renamed"),
        [{**rows.PROFILE_ROW, "displayName": "Renamed"}],
        [Sent("PUT", f"{V1}/profiles/p-1", [], {"name": "Renamed"})],
        lambda r: r.name == "Renamed",
    ),
    Case(
        "profiles.delete",
        lambda c: c.profiles.delete("p-1"),
        [rows.OK],
        [Sent("DELETE", f"{V1}/profiles/p-1", [], None)],
        lambda r: r == {"success": True},
    ),
    Case(
        "profiles.connect",
        lambda c: c.profiles.connect("p-1"),
        [{"status": "connecting", "message": "Scan the QR code"}],
        [Sent("POST", f"{V1}/profiles/p-1/connect", [], None)],
        lambda r: r["status"] == "connecting",
    ),
    Case(
        "profiles.disconnect",
        lambda c: c.profiles.disconnect("p-1"),
        [{"status": "disconnected"}],
        [Sent("POST", f"{V1}/profiles/p-1/disconnect", [], None)],
        lambda r: r == {"status": "disconnected"},
    ),
    Case(
        "profiles.status",
        lambda c: c.profiles.status("p-1"),
        [rows.PROFILE_STATUS],
        [Sent("GET", f"{V1}/profiles/p-1/status", [], None)],
        lambda r: r["engineConnected"] is True,
    ),
    Case(
        "profiles.list",
        lambda c: c.profiles.list(workspace_id="ws-1"),
        [[rows.PROFILE_LIST_ROW]],
        [Sent("GET", f"{V1}/profiles", [("workspaceId", "ws-1")], None)],
        lambda r: [p.name for p in r] == ["Main"],
    ),
    # ---------------- webhooks ----------------
    Case(
        "webhooks.create",
        lambda c: c.webhooks.create(
            "p-1", "https://hook.test/in", ["message.received"]
        ),
        [rows.WEBHOOK_ROW],
        [
            Sent(
                "POST",
                f"{V1}/webhooks",
                [],
                {
                    "profileId": "p-1",
                    "url": "https://hook.test/in",
                    "events": ["message.received"],
                },
            )
        ],
        lambda r: isinstance(r, Webhook) and r.secret == "generated-secret",
    ),
    Case(
        "webhooks.get",
        lambda c: c.webhooks.get("wh-1"),
        [rows.WEBHOOK_ROW],
        [Sent("GET", f"{V1}/webhooks/wh-1", [], None)],
        lambda r: r.is_active is True,
    ),
    Case(
        "webhooks.update",
        lambda c: c.webhooks.update("wh-1", events=["message.sent"], is_active=False),
        [{**rows.WEBHOOK_ROW, "enabled": False}],
        [
            Sent(
                "PUT",
                f"{V1}/webhooks/wh-1",
                [],
                {"events": ["message.sent"], "enabled": False},
            )
        ],
        lambda r: r.is_active is False,
    ),
    Case(
        "webhooks.delete",
        lambda c: c.webhooks.delete("wh-1"),
        [rows.OK],
        [Sent("DELETE", f"{V1}/webhooks/wh-1", [], None)],
        lambda r: r == {"success": True},
    ),
    Case(
        "webhooks.test",
        lambda c: c.webhooks.test("wh-1"),
        [{"success": True, "message": "Test webhook delivered successfully"}],
        [Sent("POST", f"{V1}/webhooks/wh-1/test", [], None)],
        lambda r: r["success"] is True,
    ),
    Case(
        "webhooks.list",
        lambda c: c.webhooks.list("p-1"),
        [[rows.WEBHOOK_LIST_ROW]],
        [Sent("GET", f"{V1}/webhooks", [("profileId", "p-1")], None)],
        lambda r: [w.id for w in r] == ["wh-1"],
    ),
    # ---------------- raw request ----------------
    Case(
        "client.request",
        lambda c: c.request("GET", "/templates", params={"profileId": "p-1"}),
        [[]],
        [Sent("GET", f"{V1}/templates", [("profileId", "p-1")], None)],
        lambda r: r == [],
    ),
]


@pytest.mark.parametrize("kind", ["sync", "async"])
@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
def test_request(case: Case, kind: str):
    result, requests = run(kind, case.call, case.responses)

    assert len(requests) == len(case.sent)
    for request, want in zip(requests, case.sent):
        assert request.method == want.method
        assert request.url.path == want.path
        assert request.url.params.multi_items() == want.params
        assert request.headers["x-api-key"] == "test-key"
        if want.body is None:
            # A bodyless POST/DELETE with Content-Type: application/json gets a 400.
            assert request.content == b""
            assert "content-type" not in request.headers
        else:
            assert request.headers["content-type"] == "application/json"
            assert json.loads(request.content) == want.body
        assert route_exists(want.method, want.path), f"{want.method} {want.path}"
    assert case.check(result)


def _public_methods(cls: type) -> set[str]:
    return {
        name
        for name, _ in inspect.getmembers(cls, inspect.isfunction)
        if not name.startswith("_")
    }


@pytest.mark.parametrize("kind", ["sync", "async"])
def test_every_public_method_has_a_case(kind: str):
    client_cls = MultiWA if kind == "sync" else AsyncMultiWA
    client = client_cls(BASE_URL, "test-key")
    covered = {case.name.split(" ")[0] for case in CASES}
    for resource in ("messages", "contacts", "broadcasts", "profiles", "webhooks"):
        for name in _public_methods(type(getattr(client, resource))):
            if (resource, name) != (
                "profiles",
                "get_qr",
            ):  # no route: test_get_qr_raises
                assert f"{resource}.{name}" in covered


def test_sync_and_async_clients_have_the_same_methods():
    sync, aio = MultiWA(BASE_URL, "k"), AsyncMultiWA(BASE_URL, "k")
    for resource in ("messages", "contacts", "broadcasts", "profiles", "webhooks"):
        assert _public_methods(type(getattr(sync, resource))) == _public_methods(
            type(getattr(aio, resource))
        )


def test_route_check_rejects_the_old_paths():
    # The paths 1.2.0 called; the snapshot check must catch each of them.
    for method, path in [
        ("POST", f"{V1}/broadcasts"),
        ("GET", f"{V1}/broadcasts/profile/p-1"),
        ("GET", f"{V1}/contacts/profile/p-1"),
        ("PATCH", f"{V1}/contacts/c-1"),
        ("GET", f"{V1}/webhooks/profile/p-1"),
        ("PATCH", f"{V1}/webhooks/wh-1"),
        ("PATCH", f"{V1}/profiles/p-1"),
        ("GET", f"{V1}/profiles/p-1/qr"),
    ]:
        assert not route_exists(method, path), f"{method} {path}"


# ---------------- arguments the API cannot honour ----------------

REFUSED = [
    (
        lambda c: c.broadcasts.create("p-1", "Promo", ["628111"], template_id="t-1"),
        "template_id",
    ),
    (lambda c: c.broadcasts.create("p-1", "Promo", ["628111"]), "message is required"),
    (
        lambda c: c.broadcasts.create(
            "p-1", "Promo", ["628111"], message="Hi", schedule_at=datetime(2030, 1, 1)
        ),
        "timezone-aware",
    ),
    (lambda c: c.broadcasts.schedule("b-1", datetime(2030, 1, 1)), "timezone-aware"),
    (lambda c: c.contacts.create("p-1", "628111", email="a@b.test"), "email"),
    (lambda c: c.contacts.update("c-1", email="a@b.test"), "email"),
    (
        lambda c: c.webhooks.create(
            "p-1", "https://hook.test/in", ["test"], secret="s"
        ),
        "secret",
    ),
    (lambda c: c.webhooks.update("wh-1", secret="s"), "secret"),
    (lambda c: c.profiles.update("p-1", is_active=False), "active"),
]


@pytest.mark.parametrize("kind", ["sync", "async"])
@pytest.mark.parametrize(("call", "message"), REFUSED, ids=[m for _, m in REFUSED])
def test_refused_argument_raises_before_any_request(call, message: str, kind: str):
    with pytest.raises(ValueError, match=message):
        run(kind, call, [])


@pytest.mark.parametrize("kind", ["sync", "async"])
def test_get_qr_raises_and_points_to_websocket(kind: str):
    with pytest.raises(NotImplementedError, match=r"qr:update.*connection\.qr"):
        run(kind, lambda c: c.profiles.get_qr("p-1"), [])


@pytest.mark.parametrize("kind", ["sync", "async"])
def test_refused_schedule_deletes_the_draft(kind: str):
    refused = httpx.Response(
        400, json={"message": "Scheduled time must be in the future"}
    )
    sent: list[httpx.Request] = []
    with pytest.raises(httpx.HTTPStatusError):
        run(
            kind,
            lambda c: c.broadcasts.create(
                "p-1",
                "Promo",
                ["628111"],
                message="Hi",
                schedule_at="2020-01-01T00:00:00Z",
            ),
            [rows.BROADCAST_ROW, refused, rows.OK],
            sent,
        )
    assert [(r.method, r.url.path) for r in sent] == [
        ("POST", f"{V1}/broadcast"),
        ("POST", f"{V1}/broadcast/b-1/schedule"),
        ("DELETE", f"{V1}/broadcast/b-1"),
    ]


def test_error_status_raises_http_status_error():
    client = MultiWA(
        BASE_URL,
        "k",
        transport=httpx.MockTransport(lambda r: httpx.Response(404, json={})),
    )
    with pytest.raises(httpx.HTTPStatusError):
        client.contacts.get("missing")


def test_base_url_with_trailing_slash_keeps_the_prefix():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return httpx.Response(200, json=rows.PROFILE_ROW)

    MultiWA(BASE_URL + "/", "k", transport=httpx.MockTransport(handler)).profiles.get(
        "p-1"
    )
    assert seen == [f"{V1}/profiles/p-1"]
