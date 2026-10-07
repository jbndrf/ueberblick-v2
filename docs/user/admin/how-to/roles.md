# Rollen verwalten

Die Seite **Rollen** (Seitenleiste, unter dem Projekt) listet die Rollen Ihres Projekts. Sie legen Rollen an, benennen und beschreiben sie, löschen sie und bestimmen, wer eine Rolle hat. **Berechtigungen** stellen Sie hier nicht ein: Sie liegen im Workflow-Builder, direkt am Feld und in der Berechtigungsmatrix (siehe [Rollen und Berechtigungen](roles-and-permissions.md)).

## Die Tabelle

Spalten: **Rollenname**, **Beschreibung**, **Selbstbeitritt** (ein Schalter) und **Zugewiesene Teilnehmende** (die Anzahl der Personen mit dieser Rolle). Oben suchen Sie nach Name oder Beschreibung; ein Klick auf eine Spaltenüberschrift sortiert. Zum Ändern von Name oder Beschreibung schalten Sie **Rollen inline bearbeiten** ein und klicken in die Zelle (Enter speichert, Esc bricht ab).

## Eine Rolle anlegen

1. In der untersten Zeile **Rollenname** eintragen (mindestens 2 Zeichen) und optional eine **Beschreibung**.
2. Mit dem Haken (**Zeile hinzufügen**) bestätigen.

Die Rolle steht im **Entwurf** der Projektdatei (die Schlüsselkennung bildet das System aus dem Namen). Sie erscheint in der Veröffentlichen-Leiste unter der Kopfzeile und gilt für alle mit dem nächsten **Veröffentlichen**. Vor der ersten Veröffentlichung ist ohnehin noch nichts live.

## Zeilenmenü

⋮ pro Zeile:

- **Rolle bearbeiten**: Dialog mit Rollenname und Beschreibung. Der Schlüssel der Rolle bleibt gleich, nichts, was die Rolle nennt, bricht.
- **Teilnehmende bearbeiten**: wählen Sie in einer Liste, wer die Rolle hat. Auf dem Telefon öffnet die Auswahl als Vollbild-Dialog mit Suche und **Fertig**. Tippen Sie einen neuen Namen und bestätigen Sie, um eine Person anzulegen; sie ist danach in der Auswahl. **Speichern** übernimmt alle Änderungen auf einmal. Zugewiesene Personen gelten sofort, sie gehören nicht zum Entwurf.
- **Beitritts-URL & Voreinstellungen anzeigen**: öffnet den Dialog des Selbstbeitritts (siehe unten). Ist der Selbstbeitritt der Rolle aus, sagt eine Meldung, dass Sie ihn zuerst aktivieren.
- **Rolle löschen**: fragt zuerst. Der Dialog nennt die Personen, die die Rolle haben, und die Stellen der Projektdatei, die die Rolle noch nennen (automatische Aktionen, Berechtigungen, Ansichten); diese melden nach dem Löschen ein Problem und müssen angepasst werden, bevor Sie veröffentlichen können. Die Rolle bleibt bis zum Veröffentlichen aktiv.

## Selbstbeitritt

Die Spalte **Selbstbeitritt** hat pro Rolle einen Schalter. **An** erzeugt sofort den öffentlichen Link `/join/<kennung>` der Rolle; wer ihn öffnet, wird als Gast (Name „Gast“) mit dieser Rolle angelegt und landet auf der Startansicht der Rolle (ohne eigene: auf der Karte). **Aus** sperrt den Link sofort. Schalten Sie wieder ein, gilt dieselbe Kennung wie zuvor, gedruckte Plakate funktionieren also weiter. Der Schalter gehört nicht zum Entwurf und braucht kein Veröffentlichen. Gäste werden nach 90 Tagen ohne Aktivität deaktiviert und erscheinen dann nicht mehr in der Liste (ihre Arbeit bleibt in der Historie). Aktivität ist jede Nutzung der App, auch das Senden von Änderungen.

Im Zeilenmenü öffnet **Beitritts-URL & Voreinstellungen anzeigen** den Dialog **Selbstbeitritts-Link**:

- **Beitritts-URL**: das Feld markiert sich beim Anklicken; **Kopieren** legt die URL in die Zwischenablage.
- **Max. Arbeitsabläufe pro Teilnehmer:in (0 = unbegrenzt)** mit **Speichern**: wie viele Objekte eine Person mit dieser Rolle insgesamt anlegen darf; Löschen gibt einen Platz frei. 0 hebt die Grenze auf. Das Kontingent ist Teil der Projektkonfiguration: **Speichern** legt es in den **Entwurf**, die Veröffentlichen-Leiste erscheint, und es gilt nach dem **Veröffentlichen**. Danach lehnt der Server das Anlegen über dem Kontingent ab.
- **Voreinstellungen beim Selbstbeitritt**: Name, Rolle, E-Mail (Gäste haben keine; sie melden sich mit einem Zugangsschlüssel an), Aktiv, Landet auf (die Startansicht der Rolle) und die automatische Löschung.
