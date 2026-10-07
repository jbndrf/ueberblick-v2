# QR-Login ausgeben und widerrufen

Jede Teilnehmerin und jeder Teilnehmer meldet sich mit einem persönlichen QR-Code an. Zuerst muss die Person in der **Teilnehmerliste** des Projekts stehen: Dort sind Name, Rollen, optionale Kontaktdaten und eine vom System erzeugte Kennung hinterlegt, und die Rollen bestimmen, welche Aufgaben die Person ausführen darf. Wer nicht in der Liste steht, kann sich nicht anmelden: der QR-Code wird abgelehnt.

## Auf der Kommandozeile

Auf dem Server (`npm run admin -- ...`):

- **In die Liste aufnehmen:** `participant add <Projekt> <Name> [rolle1,rolle2]` (der Name ist Pflicht; die Kennung wird daraus erzeugt und ausgegeben, zum Beispiel `anna-3fa9c1`). Die Rollen müssen im Projekt existieren.
- **Rollen ändern:** `participant roles <Projekt> <Kennung> <rolle1,rolle2>` (gilt ab der nächsten Anfrage)
- **Auflisten:** `participant list <Projekt>` zeigt die Liste und wie viele QR-Codes aktiv sind.
- **QR-Code ausgeben:** `participant qr <Projekt> <Kennung> [Ablauf]` gibt den Token des Codes einmal aus. Der Token ist wiederverwendbar (auf jedem Gerät) und läuft ohne Angabe eines Ablaufs nie ab; nur Widerrufen sperrt ihn. Erzeugen Sie daraus den QR-Code; er wird nicht noch einmal angezeigt.
- **Widerrufen:** `participant revoke <Projekt> <Kennung>` sperrt alle Codes der Person und meldet ihre Geräte sofort ab.
- **Deaktivieren / aktivieren:** `participant disable <Projekt> <Kennung>` lehnt Anmeldung und Codes der Person ab, bis `participant enable <Projekt> <Kennung>`. Die Codes bleiben gültig und funktionieren danach wieder.
- **Entfernen:** `participant remove <Projekt> <Kennung>` widerruft alle Codes, meldet die Person ab und blendet sie in der Liste aus. Die Person bleibt in der Historie ihrer Arbeit sichtbar.

## Auf der Seite Teilnehmende

Die Seite **Teilnehmende** (Seitenleiste, unter dem Projekt) erledigt das ohne Befehle: Person anlegen, Anmelde-Link kopieren, QR-Karten drucken, jemanden abschalten. Siehe [Teilnehmende verwalten](participants.md).

## Über die Admin-Schnittstelle

Dieselben Funktionen gibt es unter `/api/admin/p/<Projekt>/participants` für angemeldete Administratoren des Projekts (Einzelheiten in `docs/04-data-model.md`). Änderungen müssen aus der Admin-App selbst kommen (gleicher Ursprung).

## Daten der Teilnehmenden

- **Name** ist Pflicht (ein leerer Name wird abgelehnt).
- **E-Mail** (muss ein `@` enthalten) und **Telefon** sind optional. Sie sind personenbezogene Daten und Teil des Exports der Daten einer Person.
- **Rollen** werden gegen die Rollen der veröffentlichten Konfiguration und des Builder-Entwurfs geprüft. Eine Rolle, die Sie gerade im Builder angelegt haben, lässt sich sofort vergeben; eine unbekannte Rolle wird mit einer Meldung auf Deutsch und Englisch abgelehnt.
- **Eigene Spalten:** pro Projekt können Sie zusätzliche Spalten festlegen (Feldname, Bezeichnung, Typ Text, Zahl, Ja/Nein oder Datum, Standardwert, Pflichtfeld) unter `GET/PUT /api/admin/p/<Projekt>/participants/columns`. Die Werte werden bei der Person gespeichert. Eine Pflichtspalte braucht beim Anlegen und Ändern einen Wert; ein Standardwert wird beim Anlegen eingesetzt, wenn keiner angegeben ist.
- **Gäste:** Personen, die sich selbst angemeldet haben, sind markiert. Die Liste blendet sie aus, außer mit `?guests=true`.
- Änderungen an der Liste gelten sofort; sie gehören nicht zum Builder-Entwurf.

Kurzfassung der Schnittstelle (für Administratoren des Projekts, Änderungen aus der Admin-App):

- `POST participants` mit `{ name, email?, phone?, roles?, attrs? }` liefert `{ id }`.
- `PATCH participants/<id>` mit beliebigen Feldern aus `{ name, email, phone, roles, attrs, disabled }`; `disabled: true` oder `false` schaltet die Person aus oder ein.
- `DELETE participants/<id>` entfernt (blendet aus).
- Eine Ablehnung lautet `{ error: <Code>, message: { en, de } }`.

## Regeln

- **Wiederverwendbar:** Der Code funktioniert immer wieder, auf jedem Gerät, bis er abläuft oder widerrufen wird. Die Anmeldung bleibt 90 Tage bestehen und verlängert sich bei jeder Nutzung.
- Gespeichert wird der Token selbst, eindeutig in der ganzen Installation. Die Liste der Codes zeigt den Token nie.
- Bei einer Migration aus v3 wird die Teilnehmerliste aus den v3-Benutzern gefüllt (Kennung und Rollen). Jeden QR-Code geben Sie selbst aus.
- **Administratoren** melden sich mit E-Mail und Passwort (mindestens 10 Zeichen) an; der Einmalcode (TOTP) kommt nur hinzu, wenn `ADMIN_TOTP=on` ist (siehe [Anmelden](sign-in.md)). Die Sitzung endet nach 12 Stunden oder, mit „30 Tage angemeldet bleiben“, nach 30 Tagen.

## Gäste: Beitritt über einen öffentlichen Link

Eine Rolle kann Gäste zulassen, zum Beispiel für einen Mängelmelder: Wer den öffentlichen Link `/join/<Kennung>` öffnet, wird als Teilnehmer mit dieser Rolle angelegt (die Seite fragt optional nach „Ihr Name“; leer gibt `Gast`), angemeldet und landet auf der Karte. Es braucht keinen QR-Code pro Person.

- **Ein- und ausschalten** gilt sofort und gehört nicht zum Entwurf. Über die Admin-Schnittstelle: `PUT /api/admin/p/<Projekt>/roles/<Rolle>/self-join` mit `{ "enabled": true, "slug": "maengel-nord" }`, die Liste unter `GET /api/admin/p/<Projekt>/roles/self-join`. Ohne `slug` wird eine zufällige Kennung vergeben (3 bis 64 Zeichen: Kleinbuchstaben, Ziffern, Bindestrich, aber nicht an erster Stelle; in der ganzen Installation eindeutig). Eine geänderte Kennung beendet den alten Link sofort.
- **Das Öffnen des Links legt nichts an**, auch nicht in einer Link-Vorschau. Erst die Seite selbst schickt den Beitritt ab. Ein unbekannter oder ausgeschalteter Link zeigt „Nicht gefunden.“
- **Zugang zurückgeben:** Verliert ein Gast seinen Zugang, schalten Sie auf der Teilnehmerseite „Gäste anzeigen“ ein, suchen den Namen in der Tabelle und zeigen oder kopieren den Anmeldelink / QR-Code (oder erzeugen einen neuen Schlüssel). Der Gast bleibt derselbe Teilnehmer, seine Patenschaften und Meldungen bleiben seine. Erklären Sie Gästen das Verfahren selbst, zum Beispiel auf einer Infoseite.
- **Wer es schon ist:** Öffnet ein Gerät den Link erneut, auf dem schon ein Gast dieses Projekts angemeldet ist, wird derselbe Gast wieder angemeldet, kein zweiter angelegt.
- **Begrenzung:** Mit `quota` an der Rolle in der Projektdatei (`roles.<Rolle>.quota`, eine Zahl) darf eine Person höchstens so viele Objekte anlegen. Gilt für jede Person mit der Rolle, der Server lehnt weitere Anlagen mit der Meldung `quota_exceeded` ab; wird ein Objekt gelöscht, wird der Platz wieder frei. Das Gerät kennt die Zahl der bereits angelegten Objekte noch nicht und zeigt die Ablehnung erst nach dem Abgleich.
- **Ablauf:** Gäste werden nach 90 Tagen ohne Aktivität deaktiviert; Aktivität ist jede Nutzung der App, ohne Nutzung zählt der Beitritt (Anmeldung und Token enden, ihre Arbeit bleibt in der Historie). Von Hand hinzugefügte Teilnehmer sind nicht betroffen.
