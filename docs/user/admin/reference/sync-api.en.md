# Sync interface (reference)

Devices fetch their data through two addresses. Both need a signed-in session (participants of the project, or admins with a role in it).

| Address | Purpose |
|---|---|
| `GET /api/p/<project>/sync?since=<seq>&scope=<fingerprint>&v=3` | One page of data. `since=0` is a snapshot, otherwise the changes since `since`. More parameters: `limit` (at most 1,000 features per page), and `after` and `pin` for snapshots |
| `GET /api/p/<project>/sync/events` | The doorbell (Server-Sent Events). It only says that something changed: `event: seq` with `{from, to, head}`. The device then pulls the data itself |

- **Visibility.** Each person gets only the features their role may see (`visible_when` and `see` on the feature type), and only the properties their role may read. When a run makes a feature leave someone's scope (a reassignment, say), it appears as removed in their next delta. A feature that was never visible never appears.
- **Objects pinned to an older version.** What a person sees of an Objekt that is pinned to an older version follows the permissions of that version, not the current one.
- **Created by / at, last changed.** Each feature in the response carries `createdBy`, `createdAt` and `changedAt` (or `null` when no run brought a device time).
- **Fingerprint (`scope`).** When what a person may see changes, the device reloads everything. The answer then carries the new fingerprint and no data.
- **Errors.** `401` not signed in, `403` no access to the project, `404` unknown project, `409` with `code` `version_mismatch` (wrong protocol version) or `no_config` (no configuration deployed yet), `400` with `code` `malformed` (malformed query).
- The response is gzip-compressed when the client sends `Accept-Encoding: gzip` (browsers do). The page format is in `docs/07-sync-and-offline.md`.
