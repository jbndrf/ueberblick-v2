# API-Referenz: Übermittlungen senden

Ein Run (eine Übermittlung) ist der einzige Weg, Daten zu ändern. Skripte, Assistenten und QGIS-Erweiterungen senden Runs mit diesen zwei Endpunkten. Beide brauchen eine Sitzung (Cookie aus der Anmeldung: `ub_session_participant` für Teilnehmende, `ub_session_admin` für Admins), die zum Projekt gehört.

| Endpunkt | Inhalt | Zweck |
|---|---|---|
| `POST /api/p/<projekt>/runs` | ein Run | einen Run ausführen |
| `POST /api/p/<projekt>/runs/batch` | `{ "runs": [run, ...] }` | mehrere Runs als Einheit ausführen: alle werden angenommen oder keiner |

## Ein Run

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

- `id`: eine UUIDv7, die Sie erzeugen. Sie ist der Idempotenzschlüssel: Wird dieselbe `id` noch einmal gesendet, kommt das gespeicherte Ergebnis zurück und nichts wird doppelt geschrieben.
- `task`, `configVersion`, `input`: die Aufgabe, die Version, gegen die der Run erstellt wurde, und die Formularwerte. `featureId` und `clientTime` sind optional.
- Wer es getan hat, steht nie im Inhalt. Es ist die Person oder der Admin der Sitzung. Unbekannte Felder werden mit 400 abgelehnt, damit ein Tippfehler nie still Daten verliert.

## Antworten

Jede Antwort, auch jeder Fehler, trägt auf oberster Ebene `v`: die Protokollversion (derzeit `1`, dieselbe wie bei der Synchronisation). Ein Client, der eine andere Version sieht, muss die Verbindung ablehnen.

| Status | `outcome` | Bedeutung |
|---|---|---|
| 200 | `accepted` | `runId`, `seq` (`from`, `to`) und die aufgezeichneten `observations` |
| 422 | `refused` | `runId` und `refusal` (`code`, `message`, optional `path`). Der Run bleibt als abgelehnt sichtbar. |
| 409 | `review` | die Version des Runs gibt es auf dem Server nicht mehr. Der Run muss geprüft werden, er wird nicht verworfen. |
| 503 | (Fehlerhülle `busy`) | die Projektdatenbank war zu lange gesperrt; nichts wurde gespeichert. Derselbe Run kann erneut gesendet werden (die App tut das selbst). |

Ein Batch antwortet mit 200 und `results` (je Run, in Reihenfolge) sowie einem `seq`-Bereich für alle. Wird ein Run abgelehnt, antwortet der Batch mit 422, `index` (der fehlgeschlagene Run), `runId` und `refusal`; gespeichert wird nichts. Alle Runs eines Batches haben dieselbe `configVersion`.

## Fehler

Jeder andere Fehler hat die Form `{ "error": { "code", "message", "issues" } }`:

| Status | `code` | Bedeutung |
|---|---|---|
| 400 | `invalid_body` | kein JSON oder falsche Form. `issues` nennt `path` (z. B. `runs.3.task`) und `message` |
| 401 | `unauthenticated` | keine gültige Sitzung |
| 403 | `forbidden` | die Sitzung gehört nicht zu diesem Projekt (auch bei unbekanntem Projekt) |
| 413 | `payload_too_large` | Inhalt über dem Limit (256 KiB je Run, 8 MiB je Batch) |
| 413 | `batch_too_large` | mehr als 500 Runs in einem Batch |

Die Typen aller Anfragen und Antworten sind als Zod-Schemas aus `@ueberblick/server` exportiert (`RunRequestSchema`, `BatchRequestSchema`, `RunResponseSchema`, `BatchResponseSchema`).
