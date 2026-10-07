# Icons und Farben der Objekte festlegen

Auf der Karte erkennen Teilnehmende den Zustand eines Objekts an seinem **Icon** und seiner **Farbe**: zum Beispiel ein rotes Warndreieck für *Mangel offen*. Sie legen das auf der **Datenseite einer Objektart** fest, mit dem Knopf **Icons** (neben „CSV importieren“ und „Builder“). Er öffnet den **Icon-Designer**.

## Die Eigenschaft wählen

Ganz oben steht **Eigenschaft für Icons und Filter**. Zur Wahl stehen **keine** und jede Auswahl-Eigenschaft der Objektart, auch die **Status-Eigenschaft** (die Stufen des Ablaufs). Mehrfachauswahl-Eigenschaften werden nicht angeboten: ein Objekt braucht genau einen Wert, der sein Icon bestimmt. Dieselbe Eigenschaft gruppiert die Objekte auch in den Einfach-Filtern und in den Cluster-Details der Karte. Wer diese Eigenschaft in seiner Rolle nicht lesen darf (Sichtbarkeit pro Eigenschaft), sieht die Objektart ohne Einteilung: Icon und Farbe der Objektart, keine Wert-Schalter, -Zeilen oder -Zähler.

Wechseln Sie die Eigenschaft, bleiben die Einträge, deren Wert es auch in der neuen Eigenschaft gibt. Gibt es Einträge ohne passenden Wert, fragt der Designer vorher, welche entfernt würden. Mit **keine** entfernen Sie die Eigenschaft samt aller Einträge.

## Das Standard-Icon

Der erste Block legt das **Standard-Icon** der Objektart fest. Es gilt, wenn für einen Wert nichts festgelegt ist, und für Objekte, deren Eigenschaft keinen Wert hat. **Icon festlegen** (oder **Bearbeiten**) öffnet den Editor, der Papierkorb entfernt Icon und Farbe wieder. Ohne Standard-Icon zeichnet die Karte einen farbigen Punkt.

## Ein Icon je Wert

Mit einer gewählten Eigenschaft folgt **Icons je Wert**: eine Zeile je Wert der Eigenschaft, in der Sprache der Oberfläche beschriftet. Bei der Status-Eigenschaft zeigt ein Kennzeichen, welche Stufe **Start**, **Schritt** oder **Ende** ist. **Festlegen** (oder **Bearbeiten**) öffnet den Editor, der Papierkorb entfernt den Eintrag; die Zeile zeigt dann wieder **Standard**. Eine Zeile ohne eigenes Icon zeigt das Standard-Icon blass.

## Der Editor

- **Vorlagen:** Kreis, Quadrat, Dreieck, Raute, Sechseck, Fünfeck, Pin, Flagge, Kreuz. Pin und Flagge speichert die Projektdatei als Icon-Namen, die anderen als eingebettetes SVG.
- **Eigenes SVG:** eine SVG-Datei hochladen oder den Code einfügen. Der Designer prüft das SVG wie das Veröffentlichen auch: höchstens 50 KB, nur einfache Formen, keine Skripte, keine Verweise auf andere Dateien. Ein ungültiges SVG wird an Ort und Stelle abgelehnt und nicht gespeichert.
- **Icon-Farbe:** eine Farbe. Sie färbt die Vorlage, den Punkt und die Linien und Flächen der Objektart. Ein eigenes SVG behält seine eigenen Farben.
- **Größe (px):** 8 bis 128, Standard 32. Andere Werte werden abgelehnt.
- **Badge:** ein kleines Zeichen oben rechts (Häkchen, Frage, Warnung, Info, X, Uhr). Nur bei Vorlagen.
- **Vorschau** zeigt das Ergebnis sofort. **Icon speichern** schreibt es in den **Entwurf**.

Rahmen, Hintergrund, Schatten und Pin-Form gibt es nicht mehr: v3 hat sie nie anders als ausgeschaltet gespeichert.

## Veröffentlichen

Jede Änderung steht sofort im Entwurf der Projektdatei, die Veröffentlichen-Leiste zeigt sie. Auf der Karte erscheinen die Icons mit dem nächsten **Veröffentlichen**.
