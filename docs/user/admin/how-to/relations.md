# Beziehungen verwalten

Die Seite **Beziehungen** (Seitenleiste, unter dem Projekt) legt fest, welche Objektarten zusammengehören: zum Beispiel *eine Kontrolle gehört zu einem Baum*. Der **Baum** ist die **Eltern-Objektart**, die **Kontrolle** die **Kind-Objektart**. Jede Beziehung steht als eigene Zeile in einer Liste.

## Die Liste

Pro Zeile: der **Name** der Beziehung, darunter Eltern → Kind, Kennzeichen für die **Anbindung** (**Verbindlich** oder **Optional**) und die **Multiplizität** (**Einzeln** oder **Mehrere**) und, wenn die Beziehung aus der Vorlage kommt, das Kennzeichen **Vorlage**. Rechts stehen der Stift (**Beziehung bearbeiten**) und der Papierkorb (**Beziehung löschen**). Ohne Beziehungen zeigt die Seite **Noch keine Beziehungen**.

## Eine Beziehung erstellen

1. **Beziehung erstellen** öffnen.
2. Einen **Namen** eintragen, zum Beispiel *Inspektionen*. Der Name erscheint am Eltern-Objekt als Liste seiner Kind-Objekte.
3. **Eltern-Objektart** und **Kind-Objektart** wählen. Beide müssen verschieden sein.
4. Die **Multiplizität** wählen: **Einzeln** (ein Kind-Objekt je Eltern-Objekt) oder **Mehrere**.
5. Die **Anbindung** wählen: **Verbindlich** (Kind-Objekte können nur vom Eltern-Objekt aus erstellt werden) oder **Optional** (auch eigenständig erstellbar; beim Erstellen verknüpfbar).
6. Wählen, was passiert, **wenn das Eltern-Objekt gelöscht wird**: **Kinder mitlöschen**, **Kinder trennen** (Voreinstellung) oder **Löschen blockieren**.
7. **Geometrie beim Erstellen** wählen (siehe unten). Hat die Kind-Objektart keine eigene Geometrie, ist **Vom Eltern-Objekt übernehmen** voreingestellt.
8. **Erstellen**.

Die Beziehung steht im **Entwurf** der Projektdatei: die Kind-Objektart bekommt ein Verweisfeld auf die Eltern-Objektart, die Eltern-Objektart die Liste ihrer Kind-Objekte. Die Veröffentlichen-Leiste zeigt die Änderung, live ist sie mit dem nächsten **Veröffentlichen**. Lehnt die Projektdatei die Änderung ab (zum Beispiel, weil eine Regel die Liste anders liest), bleibt der Dialog offen und nennt den Grund.

## Anbindung und Löschen: sichtbare Aufgaben

Die beiden Auswahlfelder sind keine versteckte Einstellung. Sie stehen als gewöhnliche Aufgaben und Schritte im Builder, benannt nach der Beziehung, und dort lassen sie sich wie alles andere ansehen und ändern:

- **Anbindung.** Die Aufgabe *Name* **anlegen** an der Eltern-Objektart erstellt ein Kind-Objekt und trägt das Eltern-Objekt ein. **Verbindlich** macht das Verweisfeld der Kind-Objektart zum Pflichtfeld, ein Kind-Objekt ohne Eltern-Objekt wird dann abgelehnt. **Optional** lässt das Feld frei. Das Formular der Aufgabe bleibt leer, bis Sie im Builder Felder hinzufügen.
- **Kinder mitlöschen.** Die Löschen-Aufgabe der Eltern-Objektart löscht zuerst die Kind-Objekte und dann das Eltern-Objekt, in einem Lauf. Darf die ausführende Person nur ein Kind-Objekt nicht löschen, wird der ganze Lauf abgelehnt und nichts geändert. Pro Schritt sind höchstens 100 Kind-Objekte erlaubt.
- **Kinder trennen.** Die Löschen-Aufgabe leert zuerst das Verweisfeld der Kind-Objekte. Auch hier gilt: Darf die Person ein Kind-Objekt nicht ändern, wird alles abgelehnt.
- **Löschen blockieren.** Die Löschen-Aufgabe ist nur verfügbar, solange das Eltern-Objekt keine Kind-Objekte hat.

Hat die Eltern-Objektart noch keine Löschen-Aufgabe (eine Aufgabe, deren Schritt den Lebenszyklus auf **gelöscht** setzt), legen **Kinder mitlöschen** und **Löschen blockieren** eine an (**Löschen**); bei **Kinder trennen** gibt es nichts zu tun, solange nichts gelöscht werden kann.

## Bearbeiten

Der Stift öffnet denselben Dialog mit den bisherigen Werten, auch Anbindung und Löschverhalten werden aus den Aufgaben und Schritten gelesen. Wählen Sie eine andere Eltern- oder Kind-Objektart, zieht das Verweisfeld mit seinen Aufgaben und Schritten um. Speichern Sie dieselbe Auswahl noch einmal, ändert sich nichts: die Einträge werden umgeschrieben, nie verdoppelt. Ändern Sie den Namen, zieht die Bezeichnung der erzeugten Aufgabe mit, solange Sie sie nicht selbst geändert haben.

## Löschen

**Beziehung löschen** fragt zuerst. Der Dialog nennt, wie viele (aktive) Objekte der Kind-Objektart mit einem Eltern-Objekt verknüpft sind (genau, auch bei sehr vielen), und die Stellen der Projektdatei, die die Beziehung noch nennen; diese melden nach dem Löschen ein Problem und müssen angepasst werden, bevor Sie veröffentlichen können. Die zur Beziehung erzeugten Aufgaben und Schritte werden mit entfernt. Die Beziehung bleibt bis zum Veröffentlichen aktiv.

## Geometrie beim Erstellen

Das Auswahlfeld hängt von der Kind-Objektart ab. Es ändert nie die Felder der Kind-Objektart; eine Geometrie legen Sie weiterhin im Builder bei den Feldern an oder entfernen sie dort.

- **Die Kind-Objektart hat keine eigene Geometrie:** **Vom Eltern-Objekt übernehmen** (Voreinstellung wie in v3) schreibt `inherit_position: true` an die Beziehung. Die Kind-Objekte liegen dann auf dem Eltern-Objekt und wandern mit ihm; beim Anlegen ist kein Pin nötig. **Keine eigene Geometrie** schreibt nichts: die Kind-Objekte haben keine Position und erscheinen nicht auf der Karte.
- **Die Kind-Objektart hat eine eigene Geometrie:** es gilt nur **Eigene Geometrie zeichnen**. Das Feld zeigt das, ist gesperrt und nennt den Grund.

Beim Bearbeiten wird die Auswahl aus der Projektdatei gelesen (`inherit_position` und die Geometrie der Kind-Objektart). Bekommt die Kind-Objektart später eine Geometrie, obwohl die Beziehung noch übernimmt, meldet die Projektdatei `inherit_with_own_geometry`: die Zeile ist rot gekennzeichnet, das Feld nennt das Problem, und **Eigene Geometrie zeichnen** löst es.
