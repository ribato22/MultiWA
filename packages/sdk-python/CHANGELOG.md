# Changelog

All notable changes to the Python SDK (`multiwa` on PyPI) are documented in
this file. Its version follows the MultiWA release (tag `sdk-python-v<version>`).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-03

### Added

- `client.calls`, sync and async, for every calls route: `list` (with its
  filters and cursor; `from_` is the caller, `since` an ISO 8601 string or a
  timezone-aware `datetime`), `open_count`, `get`, `update`
  (`unassign=True` removes the assignee; with `assigned_user_id` too it raises
  `ValueError`), `reject`, `reply`, `send_call_link` (`link_type` is `voice` or
  `video`), `media_status`, `get_recording`, `delete_recording`,
  `update_settings`, `upload_announcement`, `get_announcement` and
  `delete_announcement`. Each method's docstring names the role it needs and
  the scope an API key with a scope list needs.
- `upload_announcement` takes bytes, a `bytearray`, a `memoryview` or a binary
  file object, sent under `filename`, else the file object's own name, else
  `announcement`; a path raises `TypeError`.
- A recording and an announcement come back as an `AudioFile` (`content`,
  `content_type`).
- Models: `Call`, `CallPage`, `CallsMediaStatus`, `CallsSettings` and
  `AudioFile`, exported from `multiwa`; `CallRecording`, `CallAnnouncement` and
  the results of the call actions in `multiwa.types`.

## [1.3.0] - 2026-10-29

### Fixed

- **Every method calls a route that exists.** Broadcasts used `/broadcasts/...`
  (the API's route is `/broadcast/...`), so every broadcast method got a 404.
  `contacts.list` and `webhooks.list` used `.../profile/{id}` instead of
  `?profileId=`; `contacts.update`, `webhooks.update` and `profiles.update` used
  `PATCH` instead of `PUT`.
- **Bodyless POST and DELETE requests work.** The client sent
  `Content-Type: application/json` on every request, and the API answers a
  bodyless request with that header with 400 ("Body cannot be empty when
  content-type is set to 'application/json'"). That broke `contacts.delete`,
  `profiles.connect`, `profiles.disconnect`, `profiles.delete`,
  `webhooks.test`, `webhooks.delete` and the broadcast actions.
- `contacts.remove_tags` raised `TypeError`.
- Request bodies match the API: an unset option is left out instead of sent as
  `null`, broadcasts send `message` and `recipients` objects, and
  `webhooks.update(is_active=...)` sends `enabled`.
- The models parse what the API returns: `Broadcast` reads its counts from
  `stats`; `Profile.name` comes from `displayName` (it is optional);
  `Webhook.is_active` comes from `enabled`; `Contact.avatar` comes from
  `avatarUrl`; `Message.type` and `Message.status` accept every stored value
  (`sticker`, `queued`, ...); `Template.content` is the stored object.
- `contacts.list` reads the `contacts` of the page the API returns.
- `multiwa.__version__` said `1.0.0`.

### Added

- `broadcasts.schedule(id, scheduled_at)` and `broadcasts.resume(id)`.
- `broadcasts.create(settings=...)` for the pacing (`delayMin`, `delayMax`,
  `batchSize`, `retryFailed`, `retryAttempts`).
- The async client has every method of the sync client (it lacked, among
  others, the broadcast `pause`, `cancel`, `delete` and `stats`).
- `MessageResult.wa_message_id`, and `Broadcast.scheduled_at`, `started_at` and
  `completed_at`.
- A `transport=` argument on `MultiWA` and `AsyncMultiWA`, passed to httpx.
- Tests (`tests/`) for every method of both clients against the API's route
  table.

### Changed

- `broadcasts.create`: `recipients` takes the API object
  (`{"type": "tags" | "contacts" | "all", "value": [...]}`); a plain list of
  phone numbers still works and is sent as `{"type": "contacts", ...}`.
  `message` takes a message object; a `str` is sent as
  `{"type": "text", "text": ...}`. `message` is required. `schedule_at` (an
  ISO 8601 string or a timezone-aware datetime) creates the draft and then
  schedules it; if the API refuses the schedule, the draft is deleted and the
  error raised. `template_id` has no API equivalent and raises `ValueError`.
- `broadcasts.start` and `broadcasts.resume` return the broadcast as it is
  after the action (the API answers with a status message only).
- `broadcasts.list`, `profiles.list` and `webhooks.list`: the API returns the
  whole list, so `limit` and `offset` are applied by the SDK; `limit` now
  defaults to `None` (everything).
- Arguments the API silently dropped now raise `ValueError`: `email` in
  `contacts.create`/`contacts.update` (keep it in `metadata`), `secret` in
  `webhooks.create`/`webhooks.update` (the API generates it; read
  `Webhook.secret`), and `is_active` in `profiles.update`.
- Methods that return the API's JSON as a dict are typed `dict[str, Any]`.

### Deprecated

- `profiles.get_qr()` raises `NotImplementedError`: the API has no QR route.
  After `connect()`, take the QR code from the WebSocket `qr:update` event or
  a `connection.qr` webhook.

## [1.2.0] - 2026-07-21

Version aligned with the repository's 1.2.0 release; earlier changes are in the
repository [CHANGELOG](https://github.com/ribato22/MultiWA/blob/main/CHANGELOG.md).
