# API reference: uploading your own tiles

You can bring your own map tiles without a tile server: a ZIP of tiles (`z/x/y.png`, `.jpg` or `.webp`), an MBTiles file or a PMTiles file. The server turns each upload into one PMTiles archive and serves it to the project. These endpoints need an admin session (cookie `ub_session_admin`) with access to the project. The admin page uses the same endpoints: **Project settings, Map layers, Add layer, Upload**.

| Endpoint | What it does |
|---|---|
| `POST /api/admin/projects/<key>/tiles/uploads` | Starts an upload. Body `{ "kind": "zip" \| "mbtiles" \| "pmtiles", "name": "Luftbild 2026", "size": 123456, "format": "png" }` (`format`: `png`, `jpg` or `webp`, optional). Answer: the upload with its `id`. |
| `PUT /api/admin/projects/<key>/tiles/uploads/<id>?offset=<n>` | Sends one chunk (the body is the raw bytes, at most 16 MiB). `offset` is the number of bytes sent so far. |
| `POST /api/admin/projects/<key>/tiles/uploads/<id>/finish` | Starts processing once all bytes have arrived. |
| `GET /api/admin/projects/<key>/tiles/uploads/<id>` | The state: `receiving`, `queued`, `processing`, `done` or `failed`, with `received`, `progress` (tiles done and total), and the `result` or the `error`. |
| `DELETE /api/admin/projects/<key>/tiles/uploads/<id>` | Cancels an upload that is not finished and removes its temporary files. |
| `DELETE /api/admin/projects/<key>/tiles/<archive>` | Removes a finished archive. Refused with `409` and the list `references` while a map layer or an offline pack of the live version or of the current draft (marked `(Entwurf)`) still uses it. |

If a chunk does not start at the next expected byte, the answer is `409` with `received`: continue from that byte. The result of a finished upload is `url`, `bounds`, `minZoom`, `maxZoom` and `format`; `url` is the address to put into a map layer of type `pmtiles`. Participants of the project read the archive from that address.

An upload that is not finished within 24 hours is removed when the server starts. Limits: 2 GB per upload, 1,000,000 tiles, 4 MiB per tile, 3 open uploads per project. A refusal has a `reason`: `too_large`, `too_many_tiles`, `tile_too_large`, `zip_bomb`, `not_tiles`, `corrupt`, `wrong_format`, `bad_chunk`, `incomplete` or `too_many_uploads`.
