# Ein v3-Projekt übernehmen

Sie haben ein Projekt in Überblick v3 und wollen es in v4 weiterführen. Die Konfiguration wird automatisch umgewandelt. Die Daten (Objekte, Eingaben, Verlauf) übernehmen Sie in einem eigenen Schritt, siehe *Die Daten übernehmen*.

## Was Sie bekommen
- **Eine Vorlage** mit allem, was das Projekt ausmacht: Rollen, Objektarten, Aufgaben, automatische Aktionen und Ansichten. Sie wird als Version 1.0.0 angelegt.
- **Anpassungen** (Overlay), die auf diese Vorlage aufbauen. Dort steht, was zu Ihrem Projekt gehört, zum Beispiel die Kartenposition. Spätere Vorlagenversionen lassen sich so übernehmen, ohne dass Ihre Anpassungen verloren gehen.
- **Einen Bericht.** Er nennt zu **jedem** Element des v3-Projekts, was daraus wurde.

## Der Bericht
Jedes Element steht mit seinem v3-Pfad im Bericht (zum Beispiel `workflows.baum.tasks.kontrolle`) und hat einen von drei Zuständen:

| Zustand | Bedeutung | Was Sie tun |
|---|---|---|
| `mapped` (übernommen) | gibt es in v4 mit gleicher Bedeutung | nichts |
| `approximated` (angenähert) | wurde umgewandelt, aber v4 drückt es anders aus; der Grund steht dabei | Grund lesen, prüfen, ob das Ergebnis passt |
| `dropped` (nicht übernommen) | gibt es in v4 (noch) nicht; der Grund steht dabei | entscheiden, ob Sie es anders lösen müssen |

Der Bericht ist vollständig: kein Element fehlt.

## Was aus v3 wird
- Ein **Workflow** wird eine **Objektart**. Die Phase (Stage) wird eine Auswahl-Eigenschaft `stage`, die Geometrie eine Eigenschaft `geom`.
- **Felder** werden **Eigenschaften**. Bei Auswahlfeldern bekommt jede Option einen festen Schlüssel; das Label bleibt sichtbar.
- **Eigene Tabellen** werden Objektarten ohne Geometrie. Felder, die daraus wählen, verweisen auf sie.
- **Aufgaben** (Schaltflächen) werden Aufgaben. Die Bedingungen einer Aufgabe werden zu einer Bedingung, die vorhanden ist, solange sie wahr ist. **Ist eine Bedingung nicht umwandelbar, gilt sie als nicht erfüllt.** Die Aufgabe ist dann nicht verfügbar, bis Sie die Bedingung von Hand ergänzen. So bekommt niemand durch die Umwandlung mehr Rechte.
- **Automatisierungen und automatische Aufgaben** werden **automatische Aktionen**, jeweils mit einer Systemaufgabe.
- **Private Fälle** werden zu einer Eigenschaft *Erstellt von* mit Zeilenfilter: Teilnehmer sehen nur ihre eigenen Objekte.
- **Rollen** bekommen eine App mit Startansicht und den Ansichten, die sie sehen dürfen.
- Die **Kartenposition** kommt in die Anpassungen.

## So werden einzelne v3-Teile umgewandelt
- **Berechnete Felder.** Die Rollen der Aufgabe, die das Feld berechnet, dürfen es schreiben, sonst niemand. Ein berechnetes Feld, das keine Aufgabe setzt, schreiben nur Regeln.
- **Textsuche.** *enthält* ignoriert Groß- und Kleinschreibung, wie in v3.
- **Felder mit mehreren verknüpften Fällen.** Sie werden eine Beziehung mit vielen Einträgen beim Besitzer; jedes verknüpfte Objekt zeigt auf seinen Besitzer zurück.
- **Personale Daten.** E-Mail-Felder sowie Textfelder und Teilnehmerauswahlen, deren Schlüssel oder Bezeichnung ein ganzes Wort enthält, das eine Person oder einen Weg zu ihr nennt (zum Beispiel *Melder*, *Telefon*, *Kontakt*, *Adresse*; *Mobilität* zählt nicht), werden als personenbezogene Daten der Person markiert, die sie eingegeben hat. `convert` listet jedes Feld mit Grund auf; prüfen Sie die Liste und korrigieren Sie sie in der Vorlage. Eine Auswahl wie *zuständig* (die Bearbeiterin) wird nicht markiert: Sie gehört nicht zu den personenbezogenen Daten dessen, der sie zugewiesen hat. Gibt es solche Felder, enthält die Vorlage auch die Aufgabe *Person löschen* (`erase_subject`), die nur Admins ausführen dürfen, und eine Objektart *Löschung* für ihre Durchläufe. Ohne sie könnte niemand eine Person löschen (siehe *Daten einer Person löschen*).

## Was nicht mitkommt
Hintergrundkarten und Overlays, Infoseiten, Einwilligungstexte, gespeicherte Filter-Voreinstellungen, Kontingente je Rolle, Zeitregeln *nach n Tagen in einer Phase*, Protokolleinträge (Snapshots) und Formelfunktionen wie `round` oder `min`. Der Bericht nennt jeweils den Grund. Hintergrundkarten stellen Sie in der App ein.

## Verhalten prüfen (Vergleichsprüfung)
Der Bericht sagt, was umgewandelt wurde. Die Vergleichsprüfung zeigt, ob sich das Projekt noch **gleich verhält**: Aufgezeichnete v3-Läufe (wer hat welche Aufgabe auf welchem Objekt ausgeführt, angenommen oder abgelehnt, mit welchem Ergebnis) werden im umgewandelten Projekt wiederholt. Jeder Unterschied kommt mit Grund in eine Liste.

| Ursache | Bedeutung |
|---|---|
| im Bericht | ein Eintrag `approximated` oder `dropped` erklärt es; seine Nummer steht dabei |
| bekannt | jemand hat den Unterschied vorab mit Begründung notiert |
| nicht umwandelbar | der Lauf nennt etwas, das es in v4 nicht gibt (Aufgabe, Feld, Option, Wert) |
| ungeklärt | nichts erklärt es: ein Fehler in der Umwandlung oder eine falsche Aufzeichnung. Vor der Übernahme klären. |

Die Prüfung ist mit echten Läufen erst möglich, wenn Sie einen Export der v3-Aufgabenläufe liefern. Bis dahin ist sie an synthetischen Läufen erprobt. Aufbau der Läufe und des Berichts: `apps/migrate/README.md`.

## Die Daten übernehmen
Die Datenübernahme macht aus jedem v3-Fall ein Objekt und spielt seinen Verlauf als Import-Läufe nach, in der Reihenfolge, in der v3 ihn aufgezeichnet hat. Jeder Wert behält den Zeitpunkt, zu dem er beobachtet wurde (`phenomenon_time`), auch Eingaben, die ein Gerät offline erfasst und später geliefert hat. Nichts wird an den Regeln vorbei geschrieben: Die Läufe haben die Akteursart `import` und durchlaufen dieselben Prüfungen wie jeder andere Lauf.

1. **Zuerst die Konfiguration umwandeln** (oben). Die Datenübernahme braucht ihr Ergebnis.
2. **Das Importprojekt vorbereiten.** Es ist das umgewandelte Projekt plus zwei Aufgaben je Objektart, die nur der Import nutzen darf (`<Art>_import`, `<Art>_import_update`), und **ohne automatische Aktionen** (`auto`-Einträge): Die v3-Automatisierungen sind beim Aufzeichnen des Verlaufs schon gelaufen und dürfen nicht noch einmal laufen.
3. **Die Datenübernahme starten.** Sie arbeitet in Paketen. Jedes Paket ist unteilbar. Wird sie unterbrochen, machen Sie ab dem zuletzt gespeicherten Prüfpunkt weiter; Läufe, die der Server schon hat, werden nicht doppelt geschrieben.
4. **Das vollständige Projekt bereitstellen** (nächste Version).

Was mit den Daten geschieht:
- **Position.** Der v3-Schwerpunkt wird nicht übernommen. v4 leitet den Ankerpunkt jedes Objekts aus der Geometrie ab; die Markierung einer Fläche liegt also auf der Fläche. Die Höhe (Z) einer Position bleibt erhalten.
- **Text** wird normalisiert (NFC) gespeichert, ein `ä` ist also immer dasselbe Zeichen.
- **Verweise** werden zuletzt geschrieben, wenn alle Objekte existieren, mit dem Zeitpunkt, an dem v3 sie geschrieben hat. Eine Beziehung mit vielen Einträgen wird bei den verknüpften Objekten geschrieben; hat v3 die Liste verkürzt, werden die entfernten Objekte geleert. Eine Auswahl aus einer eigenen Tabelle findet ihre Zeile über die Nummer oder über den Wert einer Spalte, wenn dieser eindeutig ist.
- **Rechte.** Die Übernahme gibt niemandem mehr Rechte als v3: Die Importaufgaben sind nur für den Import sichtbar, und schreibgeschützte Felder aus v3 bleiben für Teilnehmer schreibgeschützt.

**Der Datenbericht** nennt jeden Datensatz, der nicht vollständig übernommen werden konnte, mit seiner v3-Nummer und dem Grund: ein Fall ohne Position (v4-Objekte brauchen eine), ein Workflow oder Feld, das das umgewandelte Projekt nicht hat, eine Option oder ein Status ohne Entsprechung, ein Verweis auf einen nicht übernommenen Datensatz, Dateien (der Export enthält keine Dateiinhalte) und Läufe, die der Server abgelehnt hat. Alles andere wird geschrieben.

Aufbau des Exports, die Aufrufe und die Geschwindigkeit (60.000 Objekte deutlich unter 10 Minuten): `apps/migrate/README.md`. Bis Sie einen Export der echten v3-Daten liefern, ist die Übernahme an synthetischen Daten erprobt.

## Der Ablauf bis zur Übernahme
Die ganze Übernahme ist als Runbook beschrieben: `docs/process/cutover-runbook.md`. Kurz:

1. **Exportieren.** Aus dem laufenden v3-Projekt: Projektdefinition, Daten und aufgezeichnete Aufgabenläufe. *Das braucht Zugriff auf Ihr echtes v3 und geschieht durch Sie.*
2. **Umwandeln:** `migrate convert v3-projekt.yaml --out ordner` schreibt Vorlage, Anpassungen und Bericht.
3. **Vergleichsprüfung:** `migrate diffcheck v3-projekt.yaml v3-laeufe.yaml`. Ergebnis 0 heißt: keine ungeklärte Abweichung.
4. **Daten in eine Kopie übernehmen:** `migrate import v3-projekt.yaml v3-daten.yaml --dir ordner`.
5. **Pilot auf der Kopie.** *Durch Sie:* Ihre Leute arbeiten mindestens eine Woche in v4, v3 bleibt das führende System.
6. **Freigabe.** Bericht, Vergleichsprüfung und Datenbericht sind durchgesehen, der Pilot hat keine offenen schweren Befunde, die Datensicherung ist getestet.
7. **Umstellung.** *Durch Sie:* v3 wird eingefroren (nur lesen), die Übernahme wird mit dem endgültigen Export wiederholt, v4 wird freigegeben.
8. **Zurück.** Vor der ersten Arbeit in v4 geben Sie v3 einfach wieder frei. Danach fließt Arbeit aus v4 nicht zurück nach v3; entscheiden Sie am ersten Arbeitstag, ob Sie in v4 weitermachen. Halten Sie v3 mindestens 30 Tage unverändert vor.

**Vorab ausprobieren:** `migrate dry-run` spielt die ganze Kette an einem Beispielprojekt durch. So sehen Sie, dass das Werkzeug funktioniert, bevor Sie echte Daten anfassen. Aufgerufen werden alle Befehle mit `npm run migrate -w @ueberblick/migrate -- <Befehl>` (hier gekürzt als `migrate`).

## Danach
1. Bericht durchgehen, zuerst die Einträge `dropped`, dann `approximated`.
2. Das Ergebnis im Builder öffnen. Es enthält keine Fehler (es wird beim Umwandeln geprüft); Hinweise, zum Beispiel zu Optionen, die keine Aufgabe setzt, sind normal.
3. Erst wenn Sie zufrieden sind, die Daten übernehmen und danach den Datenbericht durchgehen.
