# Personenbezogene Daten in Ihrem Projekt

Manche Eigenschaften enthalten Daten über eine Person, zum Beispiel die meldende Person eines Mangels oder eine auf einem Objekt genannte Person. Markieren Sie sie in der Projektdatei, damit Überblick bei einer Anfrage auf Löschung oder Auskunft weiß, was zu schwärzen oder auszugeben ist.

```yaml
melder: { type: participant, personal: { subject: actor } }
```

`subject` sagt, wessen Daten es sind:

- `actor`: die Person, die die Änderung eingereicht hat (zum Beispiel die meldende Person oder eine Live-Position)
- `property:<key>`: die Person, die in einer anderen Teilnehmer-Eigenschaft desselben Objekttyps genannt ist, zum Beispiel `property:zustaendig`
- `feature`: das Objekt selbst betrifft eine Person

Der Builder warnt, wenn eine personenbezogene Eigenschaft

- `index: true` hat (ein Index hält den Wert durchsuchbar; entfernen Sie ihn), oder
- in einer Ansicht für alle Rollen sichtbar ist. Schränken Sie sie mit `permissions.see` ein, zum Beispiel `see: { melder: [sachbearbeiter] }`.

Die Auskunft ist der [Export der Daten einer Person](../how-to/export-person-data.md); die Markierung ist die Grundlage dafür.

## Die Daten einer Person löschen

Eine Löschung ist ein gewöhnlicher Durchlauf einer Admin-Aufgabe: Sie leert die Werte der Person an den Objekten und lässt sich nicht rückgängig machen. Sie schreiben sie als Aufgabe mit einem `redact`-Schritt, zum Beispiel `then: [{ redact: { subject: actor, of: form.subject } }]` mit einem Formularfeld `subject` für die Kennung der Person (die Vorlage maengelmelder hat die Aufgabe `erase_subject`). `subject` nennt, welche Werte entfallen (dieselben Arten wie bei `personal.subject`), `of`, wessen. Es gilt:

- Die persönlichen Werte der Person werden durch leere Werte ersetzt. Auch die alten Werte im Verlauf werden überschrieben, ebenso die Kopie der Werte in den Durchläufen, die sie eingereicht haben. Nicht persönliche Werte, das Objekt selbst und wer wann was getan hat bleiben.
- Die Kopie der eingereichten Werte in einem Durchlauf wird als Ganzes geleert. Hat derselbe Durchlauf auch nicht persönliche Werte eingereicht, geht deren Kopie im Durchlaufprotokoll ebenfalls verloren; die Werte an den Objekten bleiben.
- Geräte erfahren es beim nächsten Abgleich und verwerfen die alten Werte. Ein Gerät, das nie wieder abgleicht, behält seine Kopie, bis es zurückgesetzt wird.
- Dateien (Fotos), auf die nichts mehr verweist, werden gelöscht, aber erst nachdem die Löschung gespeichert ist. Bricht der Server dazwischen ab, löscht er die Dateien beim nächsten Start fertig.
- Die Kennung der Person bleibt ohne Namen in einer Liste gelöschter Personen. Stellen Sie ein Backup wieder her, wird die Löschung für alle auf der Liste wiederholt, sodass gelöschte Daten nicht zurückkehren.
- Backups vor der Löschung enthalten die alten Werte, bis sie ablaufen. Halten Sie die Backup-Aufbewahrung kurz (`docs/process/backup.md`).
- Zweimal löschen bewirkt nichts weiter. Ein Wert, den das Gerät der Person später aus einem alten Entwurf einreicht, wird als neuer Wert gespeichert: Eine Löschung gilt für einen Zeitpunkt.
