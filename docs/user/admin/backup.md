# Datensicherung

Alle Datenbanken und hochgeladenen Dateien Ihrer Instanz werden laufend in einen Ordner auf Ihrem Server gesichert, zum Beispiel ein eingehängtes NAS.

## Einschalten
1. In der Datei `.env` den Ordner eintragen: `BACKUP_DIR=/mnt/nas/ueberblick` (der Ordner muss existieren; ein NAS wird vorher auf dem Server eingehängt).
2. `docker compose --profile backup up -d` ausführen. Ab jetzt läuft der Dienst `backup` neben der App (zum Abschalten: `docker compose --profile backup stop backup`). Bei jedem weiteren `docker compose up -d` muss `--profile backup` wieder angegeben werden, sonst wird der Dienst nicht mitgestartet.

## Prüfen, dass es funktioniert
- `docker compose --profile backup ps` zeigt `backup` als laufend.
- Im Ordner `BACKUP_DIR` liegen nach etwa einer Minute die Unterordner `databases`, `files` und `journal`.
- `docker compose --profile backup logs backup` zeigt Zeilen mit `"event":"config"` (die gesicherten Datenbanken) und keine Zeilen mit `problem`.
- **Neue Projekte** werden automatisch aufgenommen, spätestens nach etwa einer Minute.

## Wiederherstellen
Auf dem Server, im Ordner der Installation, mit gestoppter App:

```
docker compose --profile backup down
docker compose --profile backup run --rm backup restore
docker compose --profile backup up -d
```

Ist der Ordner `data` nicht leer, bricht der Befehl ab und ändert nichts. Mit `restore --force` wird der vorhandene Inhalt von `data` ersetzt (erst nachdem die Sicherung geprüft wurde). Es wird nichts weiter installiert: der Befehl läuft im Sicherungs-Image.

Der Befehl stellt alle Datenbanken und alle Dateien wieder her und wendet Löschungen personenbezogener Daten erneut an. Er bricht ab, ohne etwas zu veröffentlichen, wenn der Datenordner nicht leer ist, das Löschprotokoll fehlt oder eine Datenbank nicht stimmt.

## Was gesichert wird und wie lange
- **Verlust im Ernstfall:** höchstens wenige Sekunden an Eingaben.
- **Aufbewahrung:** 30 Tage (von Ihrer Datenschutzbeauftragten oder Ihrem Datenschutzbeauftragten zu bestätigen). Sie können auf jeden Stand der letzten 30 Tage zurück.
- **Dateien:** Fotos und Anhänge werden minütlich in den Unterordner `files` kopiert. Wird eine Datei gelöscht (zum Beispiel bei einer Löschung personenbezogener Daten), wird sie dort ebenfalls entfernt.
- Eingaben, die Geräte noch nicht gesendet hatten, bleiben auf den Geräten und werden nach der Wiederherstellung synchronisiert.
- **Prüfung:** Ihr Betreiber testet die Wiederherstellung regelmäßig (mindestens monatlich).

**Gelöschte personenbezogene Daten bleiben gelöscht.** Wurden die Daten einer Person gelöscht, bringt eine Wiederherstellung sie nicht zurück: Ihr Betreiber wendet vor dem Start der wiederhergestellten Datenbank alle Löschungen aus dem Löschprotokoll erneut an. Das Protokoll liegt außerhalb des Sicherungsspeichers. **Grenze dieses Schutzes:** Eine Löschung, die nach dem letzten Export des Löschprotokolls erfolgte, wird nicht erneut angewendet und würde nach einer Wiederherstellung wieder auftauchen. Betreiber müssen das Protokoll nach jeder Löschung und zusätzlich mindestens stündlich exportieren. Ältere Sicherungen enthalten die Daten bis zu ihrem Ablauf noch, deshalb ist die Aufbewahrung begrenzt.

**Eine fehlgeschlagene Wiederherstellung ändert nichts.** Der Befehl ersetzt die alten Daten erst, nachdem die Sicherung vollständig geprüft ist; schlägt eine Prüfung fehl, ändert er nichts im Datenordner und der Server startet wie gewohnt. Eine unterbrochene Wiederherstellung kann den Ordner `.restore-old` mit alten Daten hinterlassen: Ihr Betreiber sieht ihn an und entfernt ihn, oder der Befehl mit `--force` ersetzt ihn.
