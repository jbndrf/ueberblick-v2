# Teilnehmende verwalten

Die Seite **Teilnehmende** (Seitenleiste, unter dem Projekt) ist die Liste Ihrer Feldkräfte: Sie legen Personen an, vergeben Rollen und einen Zugang, schalten jemanden ab und drucken QR-Karten. Sie arbeitet wie in v3: eine Tabelle, eine Zeile zum schnellen Anlegen und keine Unterseiten.

## Die Tabelle

Spalten: **Name**, **E-Mail**, **Telefon**, **Zugangstoken**, **Rollen**, **Status** und Ihre eigenen Felder. Oben suchen Sie; ein Klick auf eine Spaltenüberschrift sortiert, der Filterknopf daneben listet die Werte der Spalte. Zum Ändern von Name, E-Mail, Telefon, Token, Rollen und eigenen Feldern schalten Sie **Teilnehmende bearbeiten** ein und klicken in die Zelle (Enter speichert, Esc bricht ab). Der **Status**-Schalter wirkt immer: Wer abgeschaltet ist, kann sich nicht anmelden; seine Arbeit bleibt in der Historie, und er lässt sich jederzeit wieder einschalten.

Selbst beigetretene Gäste sind ausgeblendet. Schalten Sie **Gäste anzeigen** ein, um sie zu sehen.

## Eine Person anlegen

1. In der untersten Zeile **Name** eintragen (Pflicht; die Kennung erzeugt das System).
2. Optional E-Mail, Telefon und **Rollen** wählen. Im Rollenfeld können Sie einen neuen Namen tippen und mit Enter eine neue Rolle anlegen.
3. Mit dem Haken (**Zeile hinzufügen**) bestätigen. Die Person erhält sofort einen Zugangstoken.

Eigene Felder, die Sie als Pflichtfeld angelegt haben, müssen ausgefüllt sein, sonst wird die Zeile nicht hinzugefügt.

## Rollen

Eine vorhandene Rolle gilt sofort. Eine **neu getippte Rolle** wird in den Entwurf der Projektdatei geschrieben (Teilnehmende selbst gehören nicht zum Entwurf): Sie ist in der Liste sofort wählbar, aktiv wird sie für alle mit dem nächsten **Veröffentlichen**. Im Zeilenmenü (⋮) öffnet **Rollen bearbeiten** dieselbe Auswahl in einem Dialog.

## Zugang

Die Spalte **Zugangstoken** zeigt den lesbaren Token der Person. Die Kopierschaltfläche legt den **Anmelde-Link** (`…/login?token=…`) in die Zwischenablage, den Sie per Messenger senden. Im Zeilenmenü: **Neuen Token erzeugen** ersetzt den Token, **Login widerrufen** sperrt den Token und meldet alle Geräte der Person ab. Im Bearbeitungsmodus können Sie einen eigenen Token eintragen.

## QR-Karten drucken

Haken Sie Zeilen an (Kopfzeile: alle; Umschalt+Klick: ein Bereich). Dann erscheint **QR exportieren (n)**. Sie erhalten ein PDF im Format A4 mit 8 Karten je Seite (2 × 4): QR-Code und Name. Der Code enthält den Anmelde-Link, auch die Kamera eines Telefons öffnet ihn. Hat jemand keinen Token, wird er dabei erzeugt.

## Eigene Felder

Das **+** in der letzten Spaltenüberschrift öffnet **Benutzerdefinierte Felder**: Feldname, Feldtyp (Text, Zahl, Ja/Nein, Datum), Standardwert (optional) und Pflichtfeld. Sie können Felder hinzufügen, bearbeiten und löschen; beim Löschen bleiben die gespeicherten Werte der Personen erhalten. Die Reihenfolge der Felder ist die Reihenfolge der Spalten: Ziehe ein Feld am Griff an seinen Platz oder fokussiere den Griff und drücke Pfeil hoch oder Pfeil runter; auf dem Telefon gibt es „Nach oben“ und „Nach unten“.

## Zeilenmenü

⋮ pro Zeile: **Bearbeiten** (Name, E-Mail, Telefon), **Rollen bearbeiten**, **Neuen Token erzeugen**, **Login widerrufen** und **Löschen**. Löschen blendet die Person aus und sperrt ihren Zugang; ihre Arbeit bleibt in der Historie sichtbar.
