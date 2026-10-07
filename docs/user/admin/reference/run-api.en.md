# API reference: sending runs

A run is the only way to change data. Scripts, assistants and QGIS plug-ins send runs with these two endpoints. Both need a session (the cookie from the login: `ub_session_participant` for participants, `ub_session_admin` for admins) that belongs to the project.

| Endpoint | Body | Purpose |
|---|---|---|
| `POST /api/p/<project>/runs` | one run | execute one run |
| `POST /api/p/<project>/runs/batch` | `{ "runs": [run, ...] }` | execute several runs as one unit: all are accepted or none |

## A run

```json
{
  "id": "0195f3a2-7c1e-7000-8000-000000000001",
  "task": "erfassen",
  "configVersion": 1,
  "featureId": "0195f3a2-7c1e-7000-8000-0000000000aa",
  "input": { "vitalitaet": "v2", "geometrie": { "type": "Point", "coordinates": [7.1, 50.73] } },
  "clientTime": "2026-05-01T08:00:00Z"
}
```

- `id`: a UUIDv7 you create. It is the idempotency key: if you send the same `id` again, you get the stored result again and nothing is written twice.
- `task`, `configVersion`, `input`: the task, the config version the run was made against, and the form values. `featureId` and `clientTime` are optional.
- Who did it is never in the body. It is the person or admin of the session. Unknown fields are refused with 400, so a typo is never silently dropped.

## Answers

Every answer, every error included, carries `v` at the top level: the protocol version (currently `1`, the same one as for the sync). A client that sees a different version must refuse the connection.

| Status | `outcome` | Meaning |
|---|---|---|
| 200 | `accepted` | `runId`, `seq` (`from`, `to`) and the `observations` that were recorded |
| 422 | `refused` | `runId` and `refusal` (`code`, `message`, optional `path`). The run stays visible as refused. |
| 409 | `review` | the config version of the run no longer exists on the server. The run must be reviewed, it is not dropped. |
| 503 | (error envelope `busy`) | the project database stayed locked too long; nothing was written. The same run can be sent again (the app does so itself). |

A batch answers 200 with `results` (one per run, in order) and one `seq` range for all. If one run is refused, the batch answers 422 with `index` (the failing run), `runId` and `refusal`, and nothing is stored. All runs of a batch use the same `configVersion`.

## Errors

Every other error has the shape `{ "error": { "code", "message", "issues" } }`:

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_body` | not JSON or wrong shape. `issues` lists `path` (for example `runs.3.task`) and `message` |
| 401 | `unauthenticated` | no valid session |
| 403 | `forbidden` | the session does not belong to this project (also for an unknown project) |
| 413 | `payload_too_large` | body over the limit (256 KiB for one run, 8 MiB for a batch) |
| 413 | `batch_too_large` | more than 500 runs in a batch |

The types of all request and answer bodies are exported as Zod schemas (`RunRequestSchema`, `BatchRequestSchema`, `RunResponseSchema`, `BatchResponseSchema`) from `@ueberblick/server`.
