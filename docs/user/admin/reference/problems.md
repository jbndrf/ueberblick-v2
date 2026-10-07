# Probleme in der Projektdatei

Der Builder prüft Ihre Projektdatei laufend. Jedes Problem nennt den **Pfad** (zum Beispiel `tasks.kontrolle.when`), eine Erklärung und einen konkreten **Hinweis zur Behebung**. Bei Fehlern in Ausdrücken zeigt Überblick zusätzlich die Stelle im Ausdruck.

Erklärung und Hinweis erscheinen in der Sprache des Builders (Deutsch oder Englisch). Auch ein Fehler innerhalb eines Ausdrucks (ein Schreibfehler, ein unbekannter Name, ein falscher Typ) wird so formuliert, mit den eingesetzten Werten; die Einzelheit steht also ebenfalls in der Sprache des Builders.

**Fehler** verhindern das Veröffentlichen. **Warnungen** nicht, aber sie zeigen meist etwas, das Sie so nicht wollten.

| Problem | Art | Bedeutung und Behebung |
|---|---|---|
| Verweis ins Leere | Fehler | Ein Schlüssel nennt etwas, das es nicht gibt (Objektart, Aufgabe, Eigenschaft, Ansicht, Rolle, Option, gesperrter Pfad). Nehmen Sie einen der genannten vorhandenen Schlüssel oder legen Sie das Fehlende an. |
| Ausdruck nicht lesbar | Fehler | Der Ausdruck ist syntaktisch falsch. Der Hinweis nennt die Stelle. |
| Ausdruck passt nicht | Fehler | Ein Name oder Typ stimmt nicht, zum Beispiel eine Eigenschaft, die es nicht gibt, oder ein Vergleich von Text mit Zahl. Der Hinweis schlägt oft den richtigen Namen vor. |
| Reservierter Schlüssel | Fehler | Der Schlüssel ist ein reserviertes Wort (`self`, `form`, `value`, `actor`, `inputs`, `other`, `now`, `true`, `false`, `null`, `in`). Wählen Sie einen anderen Schlüssel. |
| Regelschleife | Fehler oder Warnung | Automatische Aktionen lösen sich gegenseitig aus. Ohne Bedingung (`when`) endet die Kette nie (Fehler). Mit Bedingung prüfen Sie, dass sie nach einem Durchlauf falsch wird (Warnung). |
| Automatische Aktion nach Aufgabe einer anderen Objektart | Fehler | Die Aktion läuft `after` einer Aufgabe, die auf einer anderen Objektart angeboten wird als ihre eigene Aufgabe. Wählen Sie eine Aufgabe derselben Objektart. |
| Zeitplan ohne Objekte | Fehler | Ein `schedule` auf einer Aufgabe, die für eine Objektart angeboten wird, hat ohne `idle` kein Objekt und wird bei jedem Takt abgelehnt. Tragen Sie `idle` ein (0 Tage = jedes Objekt). |
| Bedingungsauslöser ohne Objekt | Fehler | Eine automatische Aktion ohne Auslöser (sie löst aus, wenn ihre Bedingung `when` wahr wird) auf einer Aufgabe für `$map` oder `$none`: es gibt kein Objekt zu beobachten. Bieten Sie die Aufgabe auf einer Objektart an oder wählen Sie einen anderen Auslöser. |
| Mehrere Auslöser | Fehler | Ein `auto`-Eintrag hat mehr als einen von `after`, `change`, `elapsed`, `schedule`. Behalten Sie einen und legen Sie für die anderen einen eigenen Eintrag an. |
| Option nie setzbar | Warnung | Keine Aufgabe, kein Standardwert und keine Rollenvorgabe kann diese Option setzen. Ergänzen Sie einen Schritt unter `then` oder entfernen Sie die Option. |
| Aufgabe nie verfügbar | Warnung | Die Bedingung `when` der Aufgabe kann nie wahr werden, etwa weil sie eine nicht vorhandene Option oder Rolle nennt. |
| Abgeleitete Beziehung ohne räumliche Prüfung | Fehler | Eine `derive` muss eine räumliche Prüfung (zum Beispiel `within`, `intersects`) als eigenes `&&`-Glied enthalten. Verschachtelt hinter ODER, NICHT oder einer Bedingung (`?:`) kann sie die Kandidaten nicht eingrenzen. Beispiel: `self.datum == other.datum && intersects(self.geometrie, other.geometrie)`. |
| Abgeleitete Beziehung liest verwandte Objekte | Fehler | Die Bedingung einer `derive` liest nur eigene Eigenschaften von `self` und `other`, keine Objekte über eine Beziehung. Entfernen Sie das Lesen über eine Beziehung (`self.<relation>…`, `other.<relation>…`): die abgeleitete Beziehung wäre veraltet, wenn sich das verwandte Objekt ändert. |
| Zeit in abgeleiteter Beziehung | Fehler | Eine `derive` darf nicht `now` oder `today()` lesen: abgeleitete Beziehungen dürfen sich nicht mit der Zeit ändern. Vergleichen Sie stattdessen mit einer Eigenschaft. |
| Filter nicht als SQL ausdrückbar | Warnung | `permissions.visible_when` nutzt etwas, das der Server nicht in eine Datenbankabfrage übersetzen kann (etwa räumliche Prüfungen auf gespeicherten Geometrien). Der Server blendet dann alle Objekte dieser Art aus. Schreiben Sie den Filter mit Vergleichen auf Eigenschaften, Beziehungen und `actor`. |
| Formularfeld ohne Schreibrecht | Warnung | Ein Aufgabenformular enthält ein Feld, das keine Rolle schreiben darf, die die Aufgabe ausführen darf; jede Ausführung wird abgelehnt. Das gilt auch für schreibgeschützte und berechnete Felder. Nehmen Sie für die Eigenschaft eine Rolle in `permissions.write` auf (oder `$all`) oder entfernen Sie das Feld aus dem Formular. Die Prüfung warnt nur, wenn keine dieser Rollen das Feld schreiben darf; ein Feld, das nur einige von ihnen schreiben dürfen, wird nicht gemeldet, prüfen Sie daher jede Rolle selbst. |
| Personenbezogene Eigenschaft mit Index | Warnung | Eine als `personal` markierte Eigenschaft hat `index: true`. Entfernen Sie den Index. |
| Personenbezogene Eigenschaft für alle sichtbar | Warnung | Eine Ansicht enthält eine personenbezogene Eigenschaft, die jede Rolle sieht. Schränken Sie sie mit `permissions.see` ein. |
| Gesperrter Pfad geändert | Fehler | Die Vorlage sperrt diesen Pfad. Entfernen Sie die Änderung aus Ihrem Projekt oder nutzen Sie einen Eingabewert der Vorlage. |
| Berechnet mit Standardwert | Fehler | Eine berechnete Eigenschaft hat auch einen Standardwert. Entfernen Sie ihn: Überblick berechnet den ersten Wert beim Anlegen. |
| Berechnete Eigenschaft wird geschrieben | Fehler | Eine Aufgabe (Formularfeld, Schnellbearbeitung, Ortsschritt oder `then`-Schritt) schreibt eine berechnete Eigenschaft. Nehmen Sie sie aus der Aufgabe. |
| Berechnet im Kreis | Fehler | Berechnete Eigenschaften lesen einander (oder sich selbst). Lassen Sie eine davon eine Eigenschaft lesen, die Menschen schreiben. |
| Berechnete Eingabe nicht unterstützt | Fehler | Der Ausdruck liest eine Beziehung, ein verwiesenes Objekt, `actor`, `now` oder `today()`. Berechnet darf nur eigene Eigenschaften lesen. |
| Pfad unbekannt | Fehler | Die Änderung nennt einen Pfad, den die Vorlage nicht hat. Nutzen Sie `add` für Neues. |
| Pfad existiert schon | Fehler | Die Änderung fügt einen Pfad hinzu, den die Vorlage schon hat. Nutzen Sie `override`, um Vorhandenes zu ändern. |
| Ausgeblendetes wird verwendet | Fehler | Ein ausgeblendetes Element wird noch verwendet. Entfernen Sie den Verweis oder blenden Sie es nicht aus. |
| Offline-Paket: Ebene unbekannt | Fehler | Ein Paket nennt eine Kartenebene, die das Projekt nicht hat. Nutzen Sie einen Schlüssel aus `map.layers`. |
| Offline-Paket: Ebene nicht packbar | Fehler | Nur Ebenen aus einer PMTiles-Quelle, einer Kachel-URL oder OpenStreetMap können in ein Offline-Paket (nicht WMS oder GeoJSON). Entfernen Sie die Ebene oder nutzen Sie eine dieser Quellen. |
| Offline-Paket: Zoom-Bereich | Fehler | Der kleinste Zoom liegt über dem größten, oder ein Zoom liegt außerhalb von 0 bis 22. |
| Offline-Paket: Gebiet | Fehler | Das Gebiet muss West, Süd, Ost, Nord in Grad sein, West links von Ost und Süd unter Nord. |
| Offline-Paket zu groß | Fehler | Die geschätzte Kachelzahl oder Größe liegt über dem Limit für ein Paket. Verkleinern Sie das Gebiet, senken Sie den größten Zoom oder lassen Sie eine Ebene weg. |
| Offline-Paket: Rolle unbekannt | Fehler | Das Paket nennt eine Rolle, die das Projekt nicht hat. |

Beim Vergleich zweier Fassungen einer Projektdatei markiert Überblick **einschneidende Änderungen** (entfernte Objektarten, Eigenschaften, Beziehungen, Aufgaben, Formularfelder, automatische Aktionen, Ansichten, Ebenen, Eingaben, Rollen, Werkzeuge oder Optionen; geänderte Eigenschafts-, Eingabe- oder Geometrietypen). Dafür brauchen Sie eine Zuordnung oder Migration, bevor Sie veröffentlichen.
