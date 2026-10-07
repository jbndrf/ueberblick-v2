# API reference: offline packs

An offline pack is a region of the map layers that devices can download. The server builds each pack from the project's PMTiles, tile URL and OpenStreetMap layers (the tiles come through the tile proxy, see `tile-proxy.md`), one PMTiles file per pack and layer. These two endpoints show how far that is and retry a failed build. They need an admin session (cookie `ub_session_admin`) with access to the project. A pack itself (area, zoom, layers) is defined in the project file under `map.packs` and goes live with the next deploy.

| Endpoint | Answer |
|---|---|
| `GET /api/admin/p/<project>/packs` | `{ "packs": [ ... ] }`, one entry per pack of the deployed version |
| `POST /api/admin/p/<project>/packs/<key>/rebuild` | `{ "queued": 1 }`; `409` when the pack has no failed build, `404` for an unknown key |

## Build states

| State | Meaning |
|---|---|
| `queued` | Waiting for the build worker. Every deploy queues the packs that are not built yet. |
| `building` | The worker is copying tiles out of the source. Progress is saved after every batch; a server restart continues where it stopped. |
| `ready` | The file is complete and can be served to devices. |
| `failed` | The build gave up after its retries (for example the tile host was not reachable, or the source has no tiles in the area). The reason is in `error`. Use `rebuild` to try again. |

A pack's state is `failed` if any of its layers failed, else `building` if any is building, else `ready` once every layer is ready, else `queued`.

## A pack in the answer

| Field | Meaning |
|---|---|
| `key`, `label`, `bounds`, `min_zoom`, `max_zoom`, `roles` | the definition from the project file (`roles` is `null` for everyone) |
| `hash` | the content hash of the pack: area, zooms and the layers with their sources. Label and roles are not part of it, so changing them does not rebuild anything. A deploy that leaves the hash unchanged reuses the built files. |
| `estimate` | `tiles` and `bytes` the pack should need (the same estimate the checker uses) |
| `state`, `error` | the build state and, when failed, the reason |
| `progress` | `tiles_done`, `tiles_total` and `bytes` written so far, all layers together |
| `bytes` | size of the files (while building: what is written so far) |
| `built_at` | when the last layer finished; `null` until every layer is `ready` |
| `layers` | per layer: `layer`, `state`, `progress`, `estimate`, and once ready `max_zoom` (the highest zoom the file really holds, which is lower than the pack's when the source stops earlier), `tiles` and `sha256` |

When a deploy changes a pack, its new files are built under the new hash. The files of a hash that the deployed version no longer lists are deleted by the next build run.

## What devices get

Devices use two endpoints under `/api/p/<project>/packs`. They need a participant session of the project (cookie `ub_session_participant`) and are not part of the sync of runs and features.

| Endpoint | Answer |
|---|---|
| `GET /api/p/<project>/packs` | the manifest: `{ "packs": [ ... ] }` with the packs this person may download. Send `If-None-Match` with the last `ETag` and the answer is `304` when nothing changed. |
| `GET /api/p/<project>/packs/<hash>/<layer>.pmtiles` | one layer file. Supports `Range` (a resumed download asks for `bytes=<n>-`), answers `206`, and `416` for a range past the end. |

Who sees a pack:
- the pack's `roles` is absent or contains one of the person's roles, and
- the person sees at least one of the pack's layers. A pack with layers that are only partly visible is listed with the visible layers only.

A pack appears in the manifest only when every layer of it is `ready`. A file that the person may not download, that does not exist or that is not ready answers `404`, so nobody can tell which packs exist. A manifest entry has `key`, `label` (in the language of the request), `hash`, `bounds`, `min_zoom`, `max_zoom`, `bytes` and `built_at`, and per layer `layer`, `tile_type`, `url`, `bytes`, `sha256`, `max_zoom` and `tiles`. The device downloads a layer again only when its `sha256` changed.

Packs are built in the background after every deploy. Set the environment variable `PACK_BUILD=0` to turn the building off (tests); it is on by default.
