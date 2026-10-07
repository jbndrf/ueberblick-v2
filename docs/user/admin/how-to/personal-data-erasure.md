# Daten einer Person löschen

Wenn eine Person die Löschung ihrer Daten verlangt (DSGVO Art. 17), löschen Sie ihre personenbezogenen Werte. Das Löschen kann nicht rückgängig gemacht werden. Exportieren Sie die Daten vorher (siehe *Daten einer Person exportieren*), wenn Sie sie der Person aushändigen müssen.

Das Löschen ist eine gewöhnliche Übermittlung einer Aufgabe mit einem `redact`-Schritt, zum Beispiel `erase_subject` in der Mängelmelder-Vorlage (siehe die Konzeptseite zu personenbezogenen Daten). Es gibt keine eigene Schnittstelle zum Löschen. Sie führen die Aufgabe wie jede andere Übermittlung aus, mit `POST /api/p/<projekt>/runs`, und tragen die ID der Person als `subject` ein:

```json
{ "id": "<neue Run-ID>", "task": "erase_subject", "configVersion": 1, "input": { "subject": "<Teilnehmer-ID oder Objekt-ID>" } }
```

- Wer die Aufgabe ausführen darf, steht in der Projektdatei: Die `when`-Regel der Aufgabe nennt die Rollen (in der Vorlage Sachbearbeitung und Administratoren). Alle anderen werden abgewiesen, und nichts wird gelöscht.
- Eine Bestätigung gehört, falls gewünscht, zum Formular der Aufgabe: Fügen Sie Ihrer Aufgabe ein Bestätigungsfeld mit einer `when`-Regel hinzu.
- Die Aufgabe bestimmt, welche Werte verschwinden: Ihr `redact`-Schritt nennt die Art des Betroffenen, gelöscht werden die in der Projektdatei als `personal` markierten Eigenschaften. Systemeigenschaften (`$type`, `$lifecycle`) sind nicht löschbar.

Hat Ihr Projekt als `personal` markierte Eigenschaften, aber keine Aufgabe mit einem `redact`-Schritt, zeigt der Builder die Warnung `personal_without_redact`. Sie bedeutet, dass das Projekt eine Löschanfrage noch nicht erfüllen kann. Beheben Sie das, indem Sie eine Aufgabe mit einem `redact`-Schritt hinzufügen, wie oben beschrieben. Es ist nur eine Warnung, Sie können zwischenzeitlich weiter am Projekt arbeiten.

## Was gelöscht wird

- Die Werte stehen danach als leer im aktuellen Stand, und die früheren Stände und die Eingaben der Änderungen, die sie erfasst haben, werden überschrieben.
- Anhänge (Fotos, Dateien), die kein Wert mehr verwendet, sind sofort nach der Antwort vom Server gelöscht. Wird der Server dazwischen beendet, holt er das beim nächsten Start nach.
- Die Löschung selbst bleibt als Änderung im Protokoll, mit der ID der Person, aber ohne ihre Werte.

## Gut zu wissen

- Datenträger-Kopien und Backups behandelt dies nicht: Gelöschte Dateien werden entfernt, aber nicht auf dem Datenträger überschrieben. Planen Sie dafür eine verschlüsselte Platte und die Backup-Aufbewahrung ein (siehe *Datensicherung*).
- Chat-Nachrichten der Person werden gelöscht. Wird die Person oder ein gelöschtes Objekt in anderen Nachrichten erwähnt, bleibt die Nachricht stehen, die Erwähnung wird durch `[removed]` ersetzt. Der Server sendet die geänderten Nachrichten erneut an die Geräte, Kopien werden beim nächsten Laden des Chats ersetzt.
