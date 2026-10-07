# Status eines Eintrags: aktiv, abgeschlossen, archiviert, gelöscht

Jeder Eintrag (Objekt) hat einen Systemstatus, den Lebenszyklus: **aktiv**, **abgeschlossen**, **archiviert** oder **gelöscht**. Ein neuer Eintrag ist aktiv.

- Nur eine Übermittlung (ein Run) setzt den Status. Fügen Sie in einer Aufgabe oder einer automatischen Aktion den Schritt Lebenszyklus setzen (`lifecycle: <Zustand>` in der Projektdatei) hinzu und wählen Sie den Zustand. Sonst ändert nichts den Status, auch keine Bildschirmmaske direkt.
- **Abgeschlossene** Einträge bleiben auf den Geräten und können weiter bearbeitet werden. Eine spätere Übermittlung kann sie wieder auf aktiv setzen.
- **Archivierte** und **gelöschte** Einträge verschwinden bei der nächsten Synchronisierung von den Geräten, und jede weitere Änderung daran wird mit dem Grund `case_closed` abgelehnt. In den Admin-Ansichten sehen Sie sie weiterhin.
- Für **gelöscht** ist die Löschberechtigung (`permissions.delete`) des Typs nötig. Ohne sie wird die Übermittlung als `not_permitted` abgelehnt.
- Auch automatische Aktionen können den Status setzen, zum Beispiel zwei Jahre abgeschlossen, dann archivieren.
