# Sync-Schnittstelle (Referenz)

Geräte holen ihre Daten über zwei Adressen. Beide brauchen eine angemeldete Sitzung (Teilnehmer des Projekts, oder Administratoren mit einer Rolle im Projekt).

| Adresse | Zweck |
|---|---|
| `GET /api/p/<projekt>/sync?since=<seq>&scope=<fingerabdruck>&v=3` | Eine Seite Daten. `since=0` ist ein Schnappschuss, sonst die Änderungen seit `since`. Weitere Parameter: `limit` (höchstens 1000 Objekte je Seite), bei Schnappschüssen `after` und `pin` |
| `GET /api/p/<projekt>/sync/events` | Türklingel (Server-Sent Events). Sagt nur, dass sich etwas geändert hat: `event: seq` mit `{from, to, head}`. Das Gerät holt danach die Daten selbst ab |

- **Sichtbarkeit.** Jede Person erhält nur die Objekte, die ihre Rolle sehen darf (`visible_when` und `see` an der Objektart), und nur die Eigenschaften, die ihre Rolle lesen darf. Verliert ein Objekt durch einen Lauf die Sichtbarkeit (etwa durch Neuzuweisung), steht es in der nächsten Änderungsliste als gelöscht. Objekte, die nie sichtbar waren, tauchen nie auf.
- **Objekte auf einer älteren Version.** Was eine Person von einem Objekt sieht, das an eine ältere Version gebunden ist, richtet sich nach den Berechtigungen dieser Version, nicht nach der aktuellen.
- **Erstellt von / am, Zuletzt geändert.** Jedes Objekt in der Antwort trägt `createdBy`, `createdAt` und `changedAt` (oder `null`, wenn kein Lauf eine Gerätezeit mitgebracht hat).
- **Fingerabdruck (`scope`).** Ändert sich, was eine Person sehen darf, lädt das Gerät alles neu. Die Antwort trägt dann den neuen Fingerabdruck und keine Daten.
- **Fehler.** `401` nicht angemeldet, `403` kein Zugriff auf das Projekt, `404` unbekanntes Projekt, `409` mit `code` `version_mismatch` (falsche Protokollversion) oder `no_config` (noch keine Konfiguration eingespielt), `400` mit `code` `malformed` (fehlerhafte Abfrage).
- Die Antwort ist gzip-komprimiert, sofern der Client `Accept-Encoding: gzip` sendet (Browser tun das). Das Seitenformat steht in `docs/07-sync-and-offline.md`.
