# Daten einer Person exportieren

Wenn jemand wissen möchte, welche Daten Ihr Projekt über sie oder ihn enthält (DSGVO Art. 15), oder die Daten in einem nutzbaren Format verlangt (Art. 20), exportieren Sie sie als eine ZIP-Datei. Antworten Sie innerhalb eines Monats.

Sie brauchen die Teilnehmer-ID der Person oder, bei einem Objekt, das von einer Person handelt (`personal: { subject: feature }`), die Objekt-ID. Markieren Sie zuvor die personenbezogenen Eigenschaften (siehe *Personenbezogene Daten in Ihrem Projekt*).

## Was die ZIP-Datei enthält

- `participant.json`: Name, Rollen und Attribute der Person
- `runs.ndjson`: jede von der Person eingereichte Änderung, auch abgelehnte
- `messages.ndjson`: Chat-Nachrichten der Person und Nachrichten, die sie oder ein von ihr betroffenes Objekt erwähnen (`via`: `author` oder `mentioned`)
- `observations.ndjson`: jeder eingegebene Wert samt früheren Ständen, dazu Werte über die Person, die andere in personenbezogenen Eigenschaften erfasst haben
- `features.geojson`: die betroffenen Objekte (Kartendaten, RFC 7946)
- `blobs/`: ihre Anhänge (Fotos, Dateien), benannt nach Prüfsumme
- `manifest.json`: die Dateiliste, die Konfigurationsversion und die Namen der personenbezogenen Eigenschaften, damit die Dateien ohne die App lesbar sind

`.ndjson`-Dateien enthalten ein JSON-Objekt pro Zeile und lassen sich in jedem Texteditor oder Datenwerkzeug öffnen. Daten anderer Personen am selben Objekt sind nicht enthalten.

Werte, die andere in einer personenbezogenen Eigenschaft (`property:<key>`) erfasst haben, die die Person nennt, sind für die Zeit enthalten, in der die Person dort genannt war.

Was die Person über andere erfasst hat, wird nicht herausgegeben. Hat sie einen personenbezogenen Wert geschrieben, der zu einer anderen Person gehört (zum Beispiel eine Telefonnummer in einer Eigenschaft, die eine Kollegin nennt), fehlt dieser Wert in `observations.ndjson`, und in `runs.ndjson` steht statt seiner `{ "$redacted": "other_subject" }`, damit die Datei zeigt, dass etwas ausgelassen wurde. Bei einer abgelehnten Änderung, in der nichts erkennen lässt, zu wem ein personenbezogener Wert gehört, wird er genauso ersetzt.

## Gut zu wissen

- Jeder Export wird mit Ihrem Konto, der ID der Person und der Uhrzeit protokolliert. Das Protokoll enthält keine Werte.
- Nicht mehr gespeicherte Anhänge stehen im Manifest unter `missing_blobs`.
- Der Export liest nur. Er ändert nichts; zum Löschen dient die Löschaufgabe (eigenes Thema).
- Eine Bedienoberfläche ist geplant; bis dahin löst Ihr Serverbetreiber den Export aus.
