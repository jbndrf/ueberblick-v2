# Daten importieren und exportieren

Der Import legt Objekte aus einer Datei an, der Export schreibt Objekte in ein GeoPackage. Der Import hat einen Endpunkt (für fortgeschrittene Nutzer und Werkzeuge wie QGIS); die Oberfläche sind zwei Assistenten: „CSV importieren“ auf der Datenseite einer Objektart (siehe *Die Daten einer Objektart ansehen*) und „GeoJSON importieren“ in der Seitenleiste, der eine neue Objektart anlegt; die Schnittstelle nimmt auch GeoPackage. Der Export steht auf der Seite Projekte: **GeoPackage exportieren** und **Daten exportieren (CSV)** im ⋮-Menü einer Projektkarte (siehe *Ein Projekt erstellen*), dazu als Endpunkte.

## Import
Formate: **CSV**, **GeoJSON** und **GeoPackage**. Ein Import ist eine Reihe von Durchläufen (Läufen) einer Aufgabe, die das Objekt anlegt, mit dem Akteur `import`. Es gelten deshalb dieselben Regeln, Pflichtwerte und Automatismen wie bei der Erfassung von Hand, und jeder Lauf steht im Verlauf des Objekts.

**Tabellen.** „CSV importieren“ gibt es auch auf der Seite einer Tabelle (siehe *Tabellen*): jede Zeile wird dort als Admin-Anlage angelegt, ohne Aufgabe und ohne Koordinaten; in der Schnittstelle nennt die Zuordnung dann `task: "$create"` und `type`.

**Zuordnung.** Sie nennen die Aufgabe und ordnen jedem Formularfeld eine Spalte der Datei zu. Bei CSV nennen Sie außerdem die Spalten für x, y und optional z (Höhe). Dezimalkomma und Semikolon werden erkannt. Ein Text wird in der Unicode-Form NFC gespeichert, damit `Ä` immer dasselbe Zeichen ist.

**Rollen-Spalten.** Eine Spalte für eine Eigenschaft vom Typ „Rolle“ darf den Rollenschlüssel oder die Bezeichnung der Rolle enthalten (mehrere mit `|`, wenn die Eigenschaft Mehrfachauswahl erlaubt). Eine unbekannte Rolle meldet die Zeile als fehlerhaft.

**Rechte.** Der Import-Akteur braucht die Rollen, die die `when`-Bedingung der Aufgabe verlangt; sonst lehnt die Aufgabe ab.

**Koordinatensystem.** Die Datei muss ihr Koordinatensystem angeben, sonst wird der Import abgelehnt (`crs_undeclared`). GeoPackage und GeoJSON mit `crs`-Angabe tragen es selbst, ein GeoJSON ohne `crs`-Angabe gilt als WGS84 (RFC 7946), ein angegebenes, nicht unterstütztes System wird abgelehnt; bei CSV wählen Sie es aus (zum Beispiel EPSG:25832). Die Koordinaten werden nach WGS84 umgerechnet; die Höhe bleibt unverändert. Liegen die umgerechneten Koordinaten außerhalb der Erde, war das System falsch gewählt und die Zeile wird gemeldet.

**Wenn eine Zeile fehlerhaft ist** gibt es zwei Modi:
- **Alles oder nichts** (Standard): Eine fehlerhafte Zeile lehnt die ganze Datei ab. Es wird nichts geschrieben; die Meldung nennt die Zeilennummern und den Grund. Bei sehr vielen Fehlern hört die Prüfung nach 1000 auf.
- **Fehlerhafte überspringen**: Die guten Zeilen werden importiert, die fehlerhaften mit Zeilennummer gemeldet. Die Läufe sind dann einzeln, nicht eine gemeinsame Einheit.

Die **Zeilennummer** zählt die Datenzeilen ab 1 (CSV ohne Kopfzeile, GeoJSON: das n-te Objekt, GeoPackage: Reihenfolge der Tabelle). Zeile 0 meint die ganze Datei.

Grenze: 10 000 Objekte dauern etwa 2,5 Sekunden. Nicht unterstützt sind Shapefiles.

## GeoJSON als neue Objektart importieren
In der Seitenleiste öffnet das **+** der Gruppe Objektarten das Menü mit **GeoJSON importieren**. Der Assistent macht aus einer GeoJSON-Datei (FeatureCollection) eine **neue Objektart** mit allen Objekten der Datei:
1. **Hochladen:** Wählen Sie die Datei (`.geojson` oder `.json`). Ist sie kein gültiges JSON, keine FeatureCollection oder hat sie keine Features, steht der Grund unter dem Feld.
2. **Prüfen:** Der Name der Objektart steht schon da (der Dateiname ohne Endung; Sie können ihn ändern). Darunter: die Zahl der Features und der Geometrietyp (bei gemischten Geometrien alle gefundenen Typen). Für jede Eigenschaft der Datei zeigt eine Zeile den **erkannten Feldtyp** (Kurztext, Langtext, Zahl, Ganzzahl, Ja/Nein, Datum, Datum und Uhrzeit); in der Auswahl können Sie ihn ändern. Im Zweifel erkennt der Assistent Text, damit nichts verloren geht; Zahlen mit führender Null (Postleitzahlen) bleiben Text.
3. **Veröffentlichen und importieren:** Die Objektart wird zuerst im Entwurf angelegt, mit je einer Eigenschaft pro Spalte, einer Geometrie-Eigenschaft und einer Aufgabe, die die Objekte anlegt. Dann wird der Entwurf veröffentlicht (**alle** noch unveröffentlichten Änderungen des Entwurfs gehen mit live; Probleme zeigt der Assistent mit einem Link in den Builder) und die Features werden als Läufe importiert. Der Balken zeigt „n von m importiert“; fehlerhafte Features werden übersprungen und mit Zeilennummer gemeldet. „Zu den Objekten“ öffnet die Datenseite der neuen Objektart.

Die neue Objektart hat keine Rollen und keine Rechte: Teilnehmende sehen sie erst, wenn Sie ihr im Builder Rollen und Aufgaben geben. Enthält die Datei keine Geometrie, entsteht eine Tabelle statt einer Objektart.

## Import über die Schnittstelle
Nur für Admins des Projekts; das Projekt muss schon veröffentlicht sein (sonst `not_published`). Alle Aufrufe senden `multipart/form-data` mit der Datei (`file`) und der Zuordnung als JSON (`mapping`); das Format ergibt sich aus der Dateiendung oder dem Feld `format`.
- **Probelauf:** `POST /api/admin/p/<Projekt>/import/plan` schreibt nichts und antwortet mit den Zahlen (`valid`, `problem_rows`), den Fehlern (höchstens 200) und einer Vorschau der ersten 10 Zeilen, wie sie geschrieben würden. Regeln und Rechte prüft erst der echte Import.
- **Import:** `POST /api/admin/p/<Projekt>/import` mit zusätzlich `mode` (`atomic` oder `skip`) und `replace` (`true`/`false`). Die Antwort ist sofort eine Auftrags-Kennung (`job`). `GET /api/admin/p/<Projekt>/import/<job>` zeigt den Stand: `state` (`queued`, `running`, `done`, `failed`), `rows_done`, `rows_total`, `imported`, `outcome` (`accepted` oder `refused`) und die Fehler. Nach einem Neustart des Servers steht ein unterbrochener Auftrag auf `failed`. Größte Datei: 100 MB (sonst 413 `file_too_large`).
- **Feste Werte** (v3: In Stufe importieren): `mapping.constants` ist eine Zuordnung Eigenschaft → Wert, die für jede Zeile gilt, auch für die Stufe, zum Beispiel `{ "stage": "kontrolliert" }`. Der Wert muss zur Eigenschaft passen (bei der Stufe: eine ihrer Optionen), sonst wird abgelehnt. Er überschreibt, was die Aufgabe für diese Eigenschaft selbst setzt.
- **Alles ersetzen:** `replace: true` setzt zuerst alle vorhandenen Objekte der Objektart auf `gelöscht` und importiert dann die Datei, alles in einer Einheit. Lehnt irgendetwas ab, bleibt der alte Bestand unverändert. Es braucht `mode: atomic` (sonst 422 `replace_needs_atomic`).

## Export
Der Export schreibt ein **GeoPackage** (WGS84, Höhe bleibt erhalten) mit einer Tabelle je Objekttyp. Wer exportiert, bekommt genau die Zeilen und Spalten, die er auch in der App sieht; Berechtigungen und Zeilenfilter gelten wie beim Abgleich. Ein Export, der wieder importiert wird, liefert dieselben Werte zurück.
