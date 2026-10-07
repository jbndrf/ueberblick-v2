# Ein Objekt ansehen

Klicke auf der Datenseite einer Objektart auf eine Zeile. Es öffnet sich die Seite dieses Objekts: alles, was du über das eine Objekt wissen willst, und was mit ihm geschehen ist. Sie ist nur zum Lesen; ändern kannst du ein Objekt in der App der Teilnehmenden oder, als Admin, im Bearbeitungsmodus der Datenseite (siehe *Die Daten einer Objektart ansehen*).

**Zurück:** „Zurück zu den Objekten“ oben links führt zur Tabelle zurück, so wie du sie verlassen hast: Suche, Sortierung und Filter bleiben, solange du im selben Browser-Tab bleibst. Die Stelle, bis zu der du gescrollt hast, bleibt nicht erhalten.

**Kopf:** der Anzeigename des Objekts, darunter die Objektart. Dann „Stufe“ (nur bei Objektarten mit Prozess), „Status“ (aktiv, abgeschlossen, archiviert oder gelöscht; gelöschte Objekte lassen sich hier ebenfalls öffnen), „Erstellt von“ (der Name der Person; ist sie nicht mehr in der Liste, steht ihre Kennung da), „Erstellt am“ und „Zuletzt geändert“.

**Standort:** bei Objektarten mit Geometrie die Form auf der Basiskarte des Projekts (wie die Vorschau in der Tabelle, aber so breit wie die Seite) und darunter die Koordinaten. Hat das Objekt keinen Standort, steht „Kein Standort festgelegt“ da.

## Daten

Jede Eigenschaft des Objekts mit ihrem Namen und Wert, in der Reihenfolge der Objektart. Eigenschaften, die du im Formular einem eigenen Tab gegeben hast, stehen in einer eigenen Gruppe; alle anderen unter „Allgemein“. Stufe und Standort stehen im Kopf und im Standort-Feld, nicht noch einmal in der Liste. Werte sehen aus wie in der App: Namen statt Kennungen, Auswahlwerte als Marken, Dateien als Vorschaubilder (Klick vergrößert). Ein Objekt ohne Werte zeigt „Keine Daten für dieses Objekt erfasst.“

## Aktivität

Alles, was mit dem Objekt geschehen ist, das neueste zuerst, gruppiert nach den Stufen, die es durchlaufen hat (bei einer Stufe, die das Objekt mehrmals besucht hat, `(2/3)`). Jede Zeile nennt, was getan wurde („Standort aktualisiert“, „2 Felder aktualisiert“ oder die Aufgabe), die Aufgabe, die Person und die Zeit. Ein Klick auf die Zeile zeigt die Werte, die dabei geschrieben wurden. Die grüne Zeile ist die Erstellung des Objekts.

Auch **Änderungen, die der Server abgelehnt hat**, stehen in der Liste, mit der Marke „Abgelehnt“; ihr Detail nennt den Grund. Sie haben keinen Wert geändert.

Je 50 Änderungen werden geladen; „Mehr laden“ holt die nächsten, bis die Erstellung erreicht ist.

## Protokoll einer Änderung

Unter jeder Zeile der Aktivität (bei einem Stufenwechsel hinter der Zeit unter der Stufenüberschrift) steht **Protokoll öffnen**. Das öffnet diese eine Ausführung als ausgefülltes Formular, nur zum Lesen: **Protokoll vom <Datum>, <Person>**, darunter die Aufgabe und alle Felder des Aufgabenformulars mit den Werten, die damals geschrieben wurden. Eine Änderung, die der Server abgelehnt hat, hat kein Protokoll.

Das Formular ist das, mit dem die Änderung gemacht wurde: Wurde das Formular seither umgebaut, siehst du die alte Fassung. Felder, die die ansehende Person nicht lesen darf, fehlen ganz; als Admin siehst du alle Felder. Felder, die damals ausgeblendet waren oder nicht geschrieben wurden, erscheinen leer. Hatte die Aufgabe kein Formular (etwa eine schnelle Bearbeitung), zeigt das Protokoll die Eigenschaften, die sie geschrieben hat.

Ein Verweis auf ein anderes Objekt (zum Beispiel der Baum einer Maßnahme) zeigt dessen Namen, so wie die Seite des Objekts ihn in der Überschrift führt, in der Aktivität und im Protokoll. Auch ein gelöschtes Objekt steht mit seinem Namen da. Gibt es zu der ID gar kein Objekt, steht dort die Kurz-ID wie `#4139` (`#` und die letzten vier Zeichen der ID), nie die lange ID. Dieselbe Kurz-ID zeigen die Tabelle der Objekte und der Chat. In der Suche der Tabelle findet `#4139` (oder `4139`) auch das Objekt, dessen ID mit diesen Zeichen endet.

**Als PDF exportieren** öffnet den Druckdialog des Browsers; wähle dort das Speichern als PDF. Gedruckt werden nur Titel und Formular, ohne Seitenleiste und Knöpfe. **Zurück zur Aktivität** führt zur Objektseite zurück.
