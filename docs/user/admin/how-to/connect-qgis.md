# QGIS verbinden

QGIS liest und bearbeitet die Objekte Ihres Projekts über den Standard OGC API Features. Jede Änderung aus QGIS wird zu einer Übermittlung (Run). Es gelten dieselben Aufgaben, Rechte und Regeln wie in der App.

## Verbinden

Mit einem Token (empfohlen): Erstellen Sie unter **Projekteinstellungen, GIS-Zugang** ein Token für den Teilnehmer, dessen Rechte QGIS bekommen soll (siehe [Projekteinstellungen](project-settings.md)).

1. Datenquellen-Manager, **WFS / OGC API - Features**, neue Verbindung. URL: `https://<Server>/api/p/<Projekt>/ogc`.
2. Authentifizierung: **Basic**, Benutzername = das Token (`ubk_…`), Passwort leer. (Ein Header `Authorization: Bearer <Token>` geht ebenso.)
3. Verbinden. Jede Objektart, die der Teilnehmer sehen darf, ist eine Sammlung (Ebene) mit der Bezeichnung aus dem Projekt, in der Sprache des Headers `Accept-Language` (sonst Deutsch, dann Englisch, dann die erste hinterlegte).

Das Token gilt bis zum **Widerrufen** oder bis zum Ablaufdatum. Ein Teilnehmer-Token liest **und schreibt**, mit genau den Rechten dieses Teilnehmers: QGIS darf nur anlegen und ändern, was der Teilnehmer auch in der App darf (siehe unten). Für **Admin-Rechte** (alles sehen und ändern, auch für Skripte und Dienste wie eine nächtliche Datenübernahme) wählen Sie beim Erstellen **Admin (meine Rechte)**: Das Token gehört Ihrem Admin-Konto und gilt nur in diesem Projekt; Verbindung wie oben (Basic, Token als Benutzername). Schreibzugriffe laufen als Aufgaben mit Ihrem Admin-Konto als Akteur. Das Token endet, wenn Sie es widerrufen oder Ihr Konto gesperrt oder gelöscht wird. Ein Cookie müssen Sie nicht mehr kopieren.

## Was möglich ist

- **Lesen:** Objekte, beschnitten auf das, was Ihre Rollen sehen dürfen, mit den Eigenschaften, die Ihre Rollen lesen dürfen. Beim Verschieben der Karte fragt QGIS nach einem Ausschnitt (bbox) und blättert große Ebenen selbst durch (`limit`, `next`).
- **Koordinaten:** GeoJSON standardmäßig in WGS84 (CRS84, Länge/Breite). Jede Sammlung nennt die weiteren Koordinatensysteme (`crs`): `EPSG:4326` (Reihenfolge Breite/Länge) und die projizierten wie `EPSG:25832`. In QGIS wählen Sie eines in den KBS-Einstellungen der Ebene. `bbox-crs` und der Header `Content-Crs` beim Schreiben nutzen dieselbe Liste.
- **Filter:** Der Objektfilter von QGIS (CQL2) grenzt eine Ebene auf dem Server ein, nach Eigenschaft oder Fläche. Ein Filter mit Flächenbedingung braucht eine bbox oder eine Geometrie, damit nicht jedes Objekt geprüft werden muss; ein zu weiter Filter antwortet `422` (`filter_too_broad`).
- **Anlegen und ändern:** mit einem Teilnehmer-Token oder einer Admin-Sitzung. QGIS sendet die geänderten Eigenschaften; Überblick führt die eine Aufgabe aus, die die Änderung trägt, als dieser Teilnehmer (der Verlauf zeigt den Teilnehmer) oder als Admin. Rollen, Bedingungen, Feldrechte und Regeln der Aufgabe gelten wie in der App, berechnete Werte werden gefüllt. Passt keine oder passen mehrere Aufgaben, lautet die Antwort `422` mit der Liste der Kandidaten. Mit `?task=<Schlüssel>` an der Adresse der Anfrage wählen Sie eine aus.
- **Nicht erlaubt:** Darf ein Teilnehmer die Aufgabe nicht ausführen, eine Eigenschaft nicht schreiben oder die Objektart nicht sehen, lautet die Antwort `403` (`forbidden`) mit Grund und Eigenschaft; es wird nichts gespeichert.
- **Abgelehnt:** Jede andere abgelehnte Übermittlung (etwa ein fehlender Pflichtwert) antwortet `422` (`run_refused`) mit Ablehnungscode und Grund. Gespeichert wird nur die abgelehnte Übermittlung.

## Was noch nicht geht

- Objekte löschen geht nur, wenn die Objektart eine Aufgabe hat, die mindestens einen Schritt ohne `of` hat und deren jeder Schritt ohne `of` den Lebenszyklus auf gelöscht setzt (`lifecycle: deleted`); QGIS führt sie aus und das Objekt wird nicht mehr ausgeliefert. Ohne eine solche Aufgabe zeigt QGIS die Ablehnung.
- Andere Koordinatensysteme als die, die eine Sammlung nennt, werden mit `400` abgelehnt.
- Objektarten, die niemand sehen darf, erscheinen nicht.

## Konformität

`GET /api/p/<Projekt>/ogc/conformance` nennt die Konformitätsklassen. Heute: OGC API Features Teil 1 Core und GeoJSON, Teil 2 CRS, Teil 3 Filter mit CQL2, Teil 4 Anlegen, Ersetzen, Ändern und Löschen (Löschen braucht eine Lösch-Aufgabe, siehe oben).

## Fehler

Fehler haben die Form `{ "error": { "code", "message", "issues" } }`. Codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `invalid_query` (400, unbekannter oder fehlerhafter Parameter), `invalid_body` (400), `run_refused` (422), `no_write_task` (422), `filter_too_broad` (422), `conflict` (409, keine Konfiguration ausgerollt).
