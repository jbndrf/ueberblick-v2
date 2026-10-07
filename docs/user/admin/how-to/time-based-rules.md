# Zeitgesteuerte automatische Aktionen

Eine automatische Aktion kann auch auf die Uhr reagieren statt auf eine Eingabe. Solche Aktionen laufen **nur auf dem Server**, nie auf dem Gerät. Eine automatische Aktion ist ein `auto`-Eintrag der Aufgabe, die sie ausführt. Beim Auslösen entsteht eine Eingabe des Akteurs `system` für diese Aufgabe. Sie unterliegt denselben Prüfungen wie jede andere Eingabe; die Aufgabe sollte also `actor.kind == 'system'` zulassen.

## Nach einem Datum (`elapsed`)

```yaml
tasks:
  system_faellig:
    on: baum
    when: "actor.kind == 'system'"
    auto:
      kontrolle_wird_faellig:
        elapsed: { from: self.faellig_am, offset: "-days(14)" }
        when: "self.stage != 'erledigt' && self.kontrolle_faellig == false"
```

- Fällig ist die Aktion bei `from` plus `after` plus `offset` (`after` und `offset` sind Zeitspannen wie `days(30)` oder `months(1)`).
- `self` ist das Objekt der Aufgabe, in der der Eintrag steht. Die Aktion wird für jedes Objekt dieser Art einzeln geplant.
- Der Termin wird neu berechnet, wenn ein Objekt entsteht oder wenn sich eine Eigenschaft ändert, die in `from`, `after` oder `offset` vorkommt. Andere Änderungen lassen ihn unberührt. Auch die Änderung eines *verknüpften* Objekts oder einer Projekteingabe (`inputs.*`) berechnet ihn nicht neu; das geschieht erst, wenn das Objekt selbst geändert wird oder beim nächsten Veröffentlichen der Konfiguration.
- Ist `from` leer oder ist das Objekt archiviert oder gelöscht, gibt es keinen Termin.
- Ein Termin löst **genau einmal** aus, beim ersten Durchlauf des Servers nach dem Zeitpunkt (auch nach einem Ausfall). Der Server schaut alle 30 Sekunden nach (`TIMERS_INTERVAL_S`). Nach dem Veröffentlichen einer Konfiguration plant der Server die Termine aller vorhandenen Objekte neu. Ob die Aktion dann wirklich läuft, entscheidet `when` erst in diesem Augenblick.
- Ein reines Datum gilt als 00:00 Uhr UTC.
- Die Projektdatei wird beim Speichern geprüft: `from` muss ein Datum oder eine Zeit sein, `after` und `offset` müssen Zeitspannen sein. Ein Fehler wird mit dem genauen Pfad angezeigt, zum Beispiel `tasks.system_faellig.auto.kontrolle_wird_faellig.elapsed.offset`.

## Nach Zeitplan (`schedule`)

```yaml
tasks:
  nachtlauf:
    on: $none
    when: "actor.kind == 'system'"
    auto:
      nachts:
        schedule: "0 6 * * *"        # täglich 06:00 UTC
```

Fünf Felder: Minute, Stunde, Tag des Monats, Monat, Wochentag (0 und 7 = Sonntag). Erlaubt sind `*`, Zahlen, Bereiche (`9-17`), Listen (`1,15`) und Schritte (`*/15`). Sind Tag des Monats und Wochentag beide gesetzt, genügt eine der beiden Angaben. Nach einem Serverausfall läuft die Aktion einmal, nicht für jeden verpassten Zeitpunkt.

Ein Zeitplan, den der Parser nicht lesen kann (zum Beispiel `61 6 * * *`), wird **beim Veröffentlichen abgelehnt**: Der Fehler nennt `tasks.<aufgabe>.auto.<name>.schedule` und die Stelle des Fehlers. Eine solche Aktion erreicht den Server nie.

Findet ein Zeitplan innerhalb von rund acht Jahren keinen Zeitpunkt (zum Beispiel `0 0 31 2 *`, den 31. Februar), zeigt die Versionsansicht (Planschritt, Block **Warnungen** über den Änderungen) und das Ergebnis des Veröffentlichens eine **Warnung** mit dem Pfad `tasks.<aufgabe>.auto.<name>.schedule`. Die Konfiguration wird trotzdem veröffentlicht, die Aktion läuft aber nie. Der Server schreibt außerdem pro automatischer Aktion und Konfigurationsversion eine Warnzeile ins Protokoll (`timer.dropped`).

### Nur wenn inaktiv ≥ Tage (`idle`)

```yaml
tasks:
  erinnern:
    on: baum                         # eine Aufgabe, die für die Objektart angeboten wird
    when: "actor.kind == 'system'"
    auto:
      erinnern_ruhende:
        schedule: "0 2 * * *"
        idle: days(30)
```

Mit `idle` läuft der Zeitplan nicht einmal, sondern besucht bei jedem Zeitpunkt **jedes Objekt** der Objektart der Aufgabe und löst nur für die Objekte aus, deren letzte Änderung mindestens so lange zurückliegt (hier 30 Tage). `when` des Eintrags wird für jedes Objekt einzeln geprüft (`self` ist das Objekt). Große Objektarten arbeitet der Server in Portionen zu 50 Objekten ab (höchstens 1000 je automatischer Aktion und Durchlauf, höchstens 40 Sekunden) und setzt beim nächsten Durchlauf fort; ein Objekt, bei dem etwas schiefgeht, hält die übrigen nicht auf; ein neuer Zeitpunkt startet keinen zweiten Durchlauf, solange einer läuft. Eine ausgelöste Eingabe ändert das Objekt, es wird also erst nach erneuter Ruhezeit wieder erfasst.

Im Editor der automatischen Aktion steht das Feld **Nur wenn inaktiv ≥ Tage** beim Auslöser **Zeitplan**, unter dem Cron. Leer oder 0 bedeutet: jedes Objekt (`idle: days(0)`). Ein Zeitplan auf einer Aufgabe, die für eine Objektart angeboten wird, braucht immer `idle` (sonst lehnt die Prüfung beim Speichern ab: `auto_schedule_without_idle`); eine Aufgabe ohne Objektart kann kein `idle` haben (`tasks.<aufgabe>.auto.<name>.idle`). Darüber steht **In Phase**: Die Aktion läuft dann nur für Objekte, die in dieser Phase sind („Beliebige Phase“ = alle).
