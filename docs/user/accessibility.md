# Barrierefreiheit

Überblick soll sich ohne Maus, mit Screenreader, bei Sonnenlicht und mit großer Schrift bedienen lassen. Das Ziel ist WCAG 2.1 Stufe AA (BITV 2.0). Was schon erfüllt ist und was noch fehlt, steht in der Selbstbewertung `docs/process/bitv-self-check.md`. Die Erklärung zur Barrierefreiheit für Ihre Installation gibt es als Vorlage in `static/accessibility/`.

## Was Sie nutzen können
- **Tastatur:** Alles lässt sich mit Tab, Umschalt+Tab, Eingabe, Leertaste und Escape bedienen. Der erste Tabstopp ist "Zum Inhalt springen". Escape schließt ein Blatt, und der Fokus kehrt an die Stelle zurück, von der Sie kamen.
- **Liste statt Karte:** Wer die Karte nicht nutzen kann, wählt Objekte in der Liste. Die Spalten lassen sich sortieren, und eine Zeile öffnet das Objekt.
- **Screenreader:** Kopfzeile, Navigation und Hauptbereich sind ausgezeichnet. Fehler in einem Formular werden als Zusammenfassung vorgelesen, mit Links zu den Feldern. Verbindungsstatus und das Ergebnis einer Aufgabe werden angesagt.
- **Heller Außenmodus:** Schwarz auf Weiß mit Kontrast mindestens 7:1 und dickerem Fokusrahmen (Ich, Einstellungen).
- **Große Ziele:** Schaltflächen sind mindestens 44 px, Hauptaktionen 56 px hoch.
- **Weniger Bewegung:** Wenn Ihr Gerät *Bewegung reduzieren* meldet, laufen keine Animationen.
- **Kartenzoom ohne Zwei-Finger-Geste:** Die Karte hat keine Zoom-Schaltflächen. Doppeltippen (oder Doppelklick) zoomt hinein; am Computer zoomt das Mausrad. Mit der Tastatur steuern Sie die Karte, sobald sie den Fokus hat: Pfeiltasten verschieben, **+** und **−** zoomen. **Standort** in der Leiste springt zu Ihrer Position. Die Karte wird mit einem Hinweis auf die Liste angesagt.
- **Zoom und Schriftgröße:** Die Schrift richtet sich nach den Einstellungen Ihres Browsers und lässt sich vergrößern.
- **Status nie nur als Farbe:** Online, offline, nicht gesendet und abgelehnt haben je ein eigenes Symbol und einen Text.

## Bekannte Lücken
- Der Builder braucht bei sehr schmaler Anzeige waagerechtes Scrollen.
- Die Teilnehmer-App braucht bei sehr schmaler Anzeige (320 px) in der Liste waagerechtes Scrollen, weil eine lange Objekt-Kennung die Tabelle verbreitert.
- In der Teilnehmer-App liest ein Screenreader die Konfigurationshinweise (oben, bei Fehlern im Projekt) nicht als Liste vor.
- Die Karte der Teilnehmer-App ist noch nicht im Browsertest auf Barrierefreiheit geprüft. Die Liste ist es: Anmeldung, Liste, Objektblatt und Aufgabe per Tastatur bis zum Absenden.

## Eine Barriere melden
Die Kontaktstelle steht in der Erklärung zur Barrierefreiheit Ihrer Installation. Beschreiben Sie, was nicht ging, auf welcher Seite und mit welchem Gerät oder Hilfsmittel.

## Für Administratorinnen und Administratoren
Sie brauchen die Erklärung zur Barrierefreiheit, bevor Sie Überblick öffentlich einsetzen. Füllen Sie die Vorlagen (`erklaerung-zur-barrierefreiheit.de.md`, `accessibility-statement.en.md`) aus. Kontakt, Durchsetzungsstelle und Freigabe sind Pflichtangaben, die nur Sie kennen. Die Inhalte Ihrer Projekte (Beschriftungen, Fotos, Hilfetexte) verantworten Sie selbst: Beschriften Sie Fotos, und wählen Sie Farben mit ausreichend Kontrast.
