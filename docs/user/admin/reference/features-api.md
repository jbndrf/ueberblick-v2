# API-Referenz: die Objektliste

Die Datentabelle im Admin-Bereich zeigt die Objekte einer Objektart seitenweise. Diese Endpunkte beantworten sie und die Seite eines Objekts. Sie brauchen eine Admin-Sitzung (Cookie `ub_session_admin`) mit Zugriff auf das Projekt.

| Endpunkt | Antwort |
|---|---|
| `GET /api/admin/p/<projekt>/features` | `{ "rows": [...], "next": "<cursor>" oder null, "total": 60000 }` |
| `GET /api/admin/p/<projekt>/features/distinct` | `[ { "value": "...", "count": 12 }, ... ]`, höchstens 500 Werte |
| `GET /api/admin/p/<projekt>/features/<id>/history` | `{ "runs": [...], "next": "<cursor>" oder null }`, die Änderungen eines Objekts |
| `POST /api/admin/p/<projekt>/features/<id>/correct` | `{ "runId", "seq" }`, die Admin-Korrektur |
| `POST /api/admin/p/<projekt>/features` | `{ "runId", "id" }`, eine neue Zeile (Admin-Anlage) |
| `POST /api/admin/p/<projekt>/features/<id>/lifecycle` | `{ "runId" }`, ein Objekt auf gelöscht setzen |

## Parameter von `features`

| Parameter | Bedeutung |
|---|---|
| `type` | die Objektart (Pflicht) |
| `q` | Suche: Teiltext ohne Beachtung der Groß-/Kleinschreibung in den Textwerten (Text, Auswahl, Zahl) und in der Spalte des Erstellers; Buchstaben außerhalb A-Z (etwa ä) passen nur in gleicher Schreibweise |
| `sort`, `dir` | die Spalte und `asc` (Standard) oder `desc`; Zeilen ohne Wert stehen bei `asc` zuerst und bei `desc` zuletzt; Text wird ohne Beachtung der Groß-/Kleinschreibung sortiert |
| `filter.<spalte>` | die gewünschten Werte, durch Komma getrennt (`filter.stage=erfasst,geprueft`); ein Komma im Wert wird `\,` geschrieben; `__empty__` trifft Zeilen ohne Wert; mehrere `filter.`-Parameter gelten zugleich (UND), die Werte eines Filters alternativ (ODER) |
| `lifecycle` | die anzuzeigenden Zustände, durch Komma getrennt: `active`, `completed`, `archived`, `deleted`. Ohne Angabe wird alles außer `deleted` gezeigt |
| `limit` | Zeilen je Seite, 1 bis 500 (Standard 50) |
| `cursor` | der Wert `next` der vorigen Seite; er passt nur zu gleichem `sort` und `dir` |

Spalten sind die Eigenschafts-Schlüssel der Objektart und die Systemspalten `$id`, `$lifecycle`, `$created_by`, `$created_at` und `$changed_at`. Dasselbe `$`-Kürzel gilt in `sort`, `filter.`, `column`, im Cursor und in der Zeile; ein Eigenschafts-Schlüssel beginnt nie mit `$`, eine Eigenschaft namens `id` oder `lifecycle` bleibt also eine eigene Spalte. Eine Eigenschaft vom Typ `multiselect` lässt sich filtern, aber nicht sortieren; `localized_text` und `file` weder noch. Wahrheitswerte filtert man als `true` und `false`, Zahlen als Zahlen.

Eine Zeile enthält die Werte der Eigenschaften (ohne Geometrie), `$id`, `$lifecycle`, `$created_by`, `$created_at`, `$changed_at`, `$seq` und den Ankerpunkt als `lon` und `lat`. `$seq` ist der Wert, gegen den `expected_seq` in `features/<id>/correct` geprüft wird; er ist keine Spalte und lässt sich nicht sortieren oder filtern. `total` zählt alle Zeilen, die den Filtern entsprechen, über alle Seiten.

Das Blättern kommt ohne Versatz aus: Jede Seite kostet gleich viel, egal wie tief, und zwischenzeitlich geschriebene Zeilen lassen keine Zeile doppelt erscheinen oder überspringen.

## `features/distinct`

Nimmt `type`, `column` und dieselben `q`, `filter.<spalte>` und `lifecycle` wie die Liste. Antwortet mit den Werten der Spalte und ihrer Anzahl, die häufigsten zuerst. Der Filter der Spalte selbst bleibt unberücksichtigt, damit ein Filtermenü weiter die übrigen Werte anbieten kann. `value` ist `null` bei Zeilen ohne Wert.

## `features/<id>/history`

Die Änderungen eines Objekts, die neueste zuerst: `{ "runs": [...], "next": "<cursor>" oder null }`, höchstens 50 je Seite; `cursor` ist der `next`-Wert der vorigen Seite (nichts anderes ist als Parameter erlaubt). Das Objekt kann in jedem Lebenszyklus sein, auch gelöscht; für eine unbekannte Kennung antwortet `not_found` (404). Eine Änderung hat `id`, `task`, `actor` (`id`, `kind`, `name` oder `null`; bei einem Lauf eines Admins ist `name` die E-Mail des Kontos), `receivedAt`, `clientTime` (`null` bei einer Änderung auf dem Server), `configVersion`, `outcome` (`accepted` oder `refused`), bei `refused` die `refusal` (`code`, `message`) und die `observations` (`property`, `result`, `time`), die sie an diesem Objekt geschrieben hat (bei einer abgelehnten leer). Sie zeigt die Änderungen, die ein Objekt betrafen (`runs.feature_id`); eine abgelehnte Änderung, die ein Objekt neu anlegen wollte, gehört zu keinem Objekt und steht in keiner Liste.

## `features/<id>/correct`

`POST` mit `{ "values": { "<eigenschaft>": wert }, "expected_seq": 12 }` (`expected_seq` ist optional). Nur für Admins des Projekts. Ein Aufruf ist **ein Lauf** der Systemaufgabe „Admin-Korrektur“ (`$correct`) auf dem Objekt: Jeder Wert wird gegen seine Eigenschaft geprüft; die Stufe, `$`-Schlüssel, unbekannte Eigenschaften und unpassende Werte werden abgelehnt. Ein leerer Wert löscht die Eigenschaft; ein unveränderter schreibt nichts. Regeln und berechnete Werte reagieren wie bei jedem Lauf. `expected_seq` ist das `$seq` der Zeile aus der Liste; stimmt es nicht mehr, antwortet `conflict` (409) und nichts wird geschrieben. Antwort: `{ "runId", "seq" }` (`seq` ist das neue `$seq` des Objekts). Eine Ablehnung ist `run_refused` (422) mit `issues: [{ "path": "input.values.<eigenschaft>", "message" }]`; `invalid_body` (400) bei einem Körper ohne `values`; 404 für ein unbekanntes Objekt. Die Zeilen der Liste tragen dafür zusätzlich `$seq`.

## `features` (POST)

`POST` mit `{ "type": "<objektart>", "values": { "<eigenschaft>": wert } }`. Nur für Admins des Projekts. Ein Aufruf ist **ein Lauf** der Systemaufgabe Admin-Anlage (`$create`): ein neues Objekt der Objektart, mit `$type` und dem Ersteller. Jeder Wert wird gegen seine Eigenschaft geprüft; leere Werte entfallen, Eigenschaften ohne Wert bekommen ihren Standardwert, ein fehlendes Pflichtfeld wird abgelehnt (`required_missing`). Die Stufe lässt sich nicht setzen (sie beginnt am Start des Prozesses). Antwort `201` mit `{ "runId", "id" }`. Eine Ablehnung ist `run_refused` (422) mit `issues`; `invalid_body` (400) ohne `type` oder `values`; 404 für eine unbekannte Objektart; `conflict` (409) vor der ersten Veröffentlichung. Die Seite einer Tabelle nutzt das für „Zeile hinzufügen“.

## `features/<id>/lifecycle`

`POST` mit `{ "state": "deleted" }` (oder `active`, `completed`, `archived`). Nur für Admins. Ein Aufruf ist **ein Lauf** der Systemaufgabe „Lebenszyklus“ (`$lifecycle`) auf dem Objekt; derselbe Zustand schreibt nichts. Antwort `{ "runId" }`; `invalid_body` (400) für einen unbekannten Zustand; 404 für ein unbekanntes Objekt. Die Tabellenseite nutzt das für „Zeile löschen“.

## Fehler

Ein Fehler ist `{ "error": { "code", "message" } }`: `invalid_query` (400) bei unbekanntem Parameter oder unbekannter Spalte, `not_found` (404) bei unbekannter Objektart, `conflict` (409) vor dem ersten Deploy, 401 und 403 ohne Admin-Sitzung für das Projekt.
