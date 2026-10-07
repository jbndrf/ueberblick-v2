# API-Referenz: eigene Kacheln hochladen

Eigene Kartenkacheln lassen sich ohne Kachelserver einbinden: eine ZIP-Datei mit Kacheln (`z/x/y.png`, `.jpg` oder `.webp`), eine MBTiles-Datei oder eine PMTiles-Datei. Der Server macht aus jedem Upload ein PMTiles-Archiv und liefert es an das Projekt aus. Die Endpunkte brauchen eine Admin-Sitzung (Cookie `ub_session_admin`) mit Zugang zum Projekt. Die Admin-Seite nutzt dieselben Endpunkte: **Projekteinstellungen, Kartenebenen, Layer hinzufügen, Hochladen**.

| Endpunkt | Wirkung |
|---|---|
| `POST /api/admin/projects/<key>/tiles/uploads` | Startet einen Upload. Inhalt `{ "kind": "zip" \| "mbtiles" \| "pmtiles", "name": "Luftbild 2026", "size": 123456, "format": "png" }` (`format`: `png`, `jpg` oder `webp`, optional). Antwort: der Upload mit seiner `id`. |
| `PUT /api/admin/projects/<key>/tiles/uploads/<id>?offset=<n>` | Sendet einen Teil (der Inhalt sind die rohen Bytes, höchstens 16 MiB). `offset` ist die Zahl der bisher gesendeten Bytes. |
| `POST /api/admin/projects/<key>/tiles/uploads/<id>/finish` | Startet die Verarbeitung, sobald alle Bytes angekommen sind. |
| `GET /api/admin/projects/<key>/tiles/uploads/<id>` | Der Stand: `receiving`, `queued`, `processing`, `done` oder `failed`, mit `received`, `progress` (Kacheln fertig und gesamt) und dem `result` oder dem `error`. |
| `DELETE /api/admin/projects/<key>/tiles/uploads/<id>` | Bricht einen noch nicht abgeschlossenen Upload ab und löscht seine temporären Dateien. |
| `DELETE /api/admin/projects/<key>/tiles/<archive>` | Löscht ein fertiges Archiv. Mit `409` und der Liste `references` abgelehnt, solange eine Kartenebene oder ein Offline-Paket der veröffentlichten Version oder des aktuellen Entwurfs (mit `(Entwurf)` markiert) es noch benutzt. |

Beginnt ein Teil nicht beim nächsten erwarteten Byte, antwortet der Server mit `409` und `received`: Machen Sie ab diesem Byte weiter. Das Ergebnis eines fertigen Uploads sind `url`, `bounds`, `minZoom`, `maxZoom` und `format`; `url` ist die Adresse für eine Kartenebene vom Typ `pmtiles`. Teilnehmende des Projekts lesen das Archiv unter dieser Adresse.

Ein nicht abgeschlossener Upload wird nach 24 Stunden beim Start des Servers entfernt. Grenzen: 2 GB je Upload, 1.000.000 Kacheln, 4 MiB je Kachel, 3 offene Uploads je Projekt. Eine Ablehnung hat einen `reason`: `too_large`, `too_many_tiles`, `tile_too_large`, `zip_bomb`, `not_tiles`, `corrupt`, `wrong_format`, `bad_chunk`, `incomplete` oder `too_many_uploads`.
