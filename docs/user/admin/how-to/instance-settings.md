# Instanz-Einstellungen

Die Seite **Instanz-Einstellungen** gilt für die ganze Instanz, nicht für ein Projekt: das Zustimmungsfenster (Cookie-Consent) vor der Anmeldung und die Rechtsseiten. Sie erreichen sie über den Eintrag **Instanz-Einstellungen** am Ende der Seitenleiste (unter dem Strich), im Projekt und außerhalb. Alle Administratorinnen und Administratoren dürfen sie bearbeiten; die Texte sind öffentlich sichtbar. Die Adresse ist `/admin/instance`.

## Cookie-Consent-Banner
1. **Cookie-Zustimmung vor Login erforderlich**: ist der Schalter an, sehen Teilnehmende vor der Anmeldung ein Zustimmungsfenster. Ist er aus, erscheint die Anmeldeseite direkt (nützlich für interne Installationen).
2. **Banner-Überschrift** und **Banner-Text** (HTML erlaubt) füllen das Fenster.
3. **Beschriftung Annehmen-Button** und **Beschriftung Ablehnen-Button**: bleibt ein Feld leer, gilt `Accept` beziehungsweise `Reject`.
4. **Speichern**. Die Meldung „Gespeichert.“ bestätigt es.

## Rechtsseiten
Jede Seite ist unter `/legal/<Slug>` öffentlich erreichbar (der Link steht auf der Karte und öffnet in einem neuen Tab) und steht in der Liste unter `/legal`. Seiten mit **Im Consent-Footer anzeigen** erscheinen im Zustimmungsfenster als Links.

- **Seite anlegen** (Karte **Rechtsseite hinzufügen**): **Titel**, **Slug (URL)** (leer: aus dem Titel, Umlaute werden ausgeschrieben, zum Beispiel wird `Über uns` zu `ueber-uns`) und **Inhalt (HTML erlaubt)**, dann **Seite anlegen**. Ein Slug darf nur a bis z, 0 bis 9 und Bindestrich enthalten (bis 100 Zeichen) und nicht schon vergeben sein.
- **Bearbeiten**: ändern Sie Titel, **Reihenfolge** (kleine Zahlen zuerst), den Schalter für den Consent-Footer oder den Inhalt und wählen Sie **Speichern**. Ein geänderter Slug benennt die Seite um; die alte Adresse gilt dann nicht mehr.
- **Löschen**: fragt „Diese Seite löschen?“; **Löschen** bestätigt, **Abbrechen** behält die Seite.

Auf dem Telefon stehen die Felder untereinander.
