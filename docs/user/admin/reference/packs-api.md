# API-Referenz: Offline-Pakete

Ein Offline-Paket ist ein Gebiet der Kartenebenen, das Geräte herunterladen können. Der Server baut jedes Paket aus den PMTiles-, Kachel-URL- und OpenStreetMap-Ebenen des Projekts (die Kacheln kommen über den Kachel-Proxy, siehe `tile-proxy.md`), je Paket und Ebene eine PMTiles-Datei. Diese zwei Endpunkte zeigen, wie weit der Bau ist, und starten einen fehlgeschlagenen Bau neu. Sie brauchen eine Admin-Sitzung (Cookie `ub_session_admin`) mit Zugriff auf das Projekt. Ein Paket selbst (Gebiet, Zoom, Ebenen) steht in der Projektdatei unter `map.packs` und gilt mit dem nächsten Veröffentlichen.

| Endpunkt | Antwort |
|---|---|
| `GET /api/admin/p/<projekt>/packs` | `{ "packs": [ ... ] }`, ein Eintrag je Paket der veröffentlichten Version |
| `POST /api/admin/p/<projekt>/packs/<schluessel>/rebuild` | `{ "queued": 1 }`; `409`, wenn das Paket keinen fehlgeschlagenen Bau hat, `404` bei unbekanntem Schlüssel |

## Bau-Zustände

| Zustand | Bedeutung |
|---|---|
| `queued` | Wartet auf den Bau-Dienst. Jedes Veröffentlichen reiht die noch nicht gebauten Pakete ein. |
| `building` | Der Dienst kopiert Kacheln aus der Quelle. Der Fortschritt wird nach jedem Stapel gespeichert; nach einem Neustart des Servers geht es dort weiter. |
| `ready` | Die Datei ist vollständig und kann an Geräte ausgeliefert werden. |
| `failed` | Der Bau hat nach seinen Wiederholungen aufgegeben (zum Beispiel war der Kachel-Server nicht erreichbar, oder die Quelle hat im Gebiet keine Kacheln). Der Grund steht in `error`. Mit `rebuild` versuchen Sie es erneut. |

Der Zustand eines Pakets ist `failed`, sobald eine Ebene fehlgeschlagen ist, sonst `building`, wenn eine Ebene gebaut wird, sonst `ready`, wenn alle Ebenen fertig sind, sonst `queued`.

## Ein Paket in der Antwort

| Feld | Bedeutung |
|---|---|
| `key`, `label`, `bounds`, `min_zoom`, `max_zoom`, `roles` | die Definition aus der Projektdatei (`roles` ist `null` für alle) |
| `hash` | der Inhalts-Hash des Pakets: Gebiet, Zoomstufen und die Ebenen mit ihren Quellen. Name und Rollen gehören nicht dazu, ihre Änderung baut also nichts neu. Ein Veröffentlichen mit unverändertem Hash nutzt die gebauten Dateien weiter. |
| `estimate` | `tiles` und `bytes`, die das Paket voraussichtlich braucht (dieselbe Schätzung wie in der Prüfung) |
| `state`, `error` | der Bau-Zustand und bei `failed` der Grund |
| `progress` | `tiles_done`, `tiles_total` und bisher geschriebene `bytes`, alle Ebenen zusammen |
| `bytes` | Größe der Dateien (beim Bau: was bisher geschrieben ist) |
| `built_at` | wann die letzte Ebene fertig wurde; `null`, bis jede Ebene `ready` ist |
| `layers` | je Ebene: `layer`, `state`, `progress`, `estimate` und, wenn fertig, `max_zoom` (die höchste Zoomstufe, die die Datei wirklich enthält; sie ist niedriger als die des Pakets, wenn die Quelle früher endet), `tiles` und `sha256` |

Ändert ein Veröffentlichen ein Paket, werden seine neuen Dateien unter dem neuen Hash gebaut. Die Dateien eines Hashs, den die veröffentlichte Version nicht mehr nennt, löscht der nächste Bau-Lauf.

## Was Geräte bekommen

Geräte nutzen zwei Endpunkte unter `/api/p/<projekt>/packs`. Sie brauchen eine Teilnehmer-Sitzung des Projekts (Cookie `ub_session_participant`) und gehören nicht zum Abgleich von Durchläufen und Objekten.

| Endpunkt | Antwort |
|---|---|
| `GET /api/p/<projekt>/packs` | das Manifest: `{ "packs": [ ... ] }` mit den Paketen, die diese Person laden darf. Mit `If-None-Match` und dem letzten `ETag` kommt `304`, wenn sich nichts geändert hat. |
| `GET /api/p/<projekt>/packs/<hash>/<ebene>.pmtiles` | eine Ebenen-Datei. Unterstützt `Range` (ein fortgesetzter Download fragt `bytes=<n>-`), antwortet `206` und `416` bei einem Bereich hinter dem Dateiende. |

Wer ein Paket sieht:
- `roles` des Pakets fehlt oder enthält eine Rolle der Person, und
- die Person sieht mindestens eine Ebene des Pakets. Sieht sie nur einen Teil der Ebenen, steht das Paket mit den sichtbaren Ebenen im Manifest.

Ein Paket erscheint erst im Manifest, wenn alle seine Ebenen `ready` sind. Eine Datei, die die Person nicht laden darf, die es nicht gibt oder die noch nicht fertig ist, antwortet `404`; so lässt sich nicht erkennen, welche Pakete es gibt. Ein Eintrag im Manifest hat `key`, `label` (in der Sprache der Anfrage), `hash`, `bounds`, `min_zoom`, `max_zoom`, `bytes` und `built_at`, je Ebene `layer`, `tile_type`, `url`, `bytes`, `sha256`, `max_zoom` und `tiles`. Das Gerät lädt eine Ebene nur neu, wenn sich ihr `sha256` geändert hat.

Pakete werden nach jedem Veröffentlichen im Hintergrund gebaut. Mit der Umgebungsvariable `PACK_BUILD=0` lässt sich das Bauen abschalten (Tests); standardmäßig ist es an.
