# Assistenten (MCP)

Ein KI-Assistent kann beim Bearbeiten der Projektdatei helfen. Er liest die Datei, **schlägt Änderungen vor** und probiert sie im Simulator aus. Er kann selbst nichts ändern: **Sie bestätigen** jede Änderung, bevor sie gespeichert wird. Auch veröffentlicht wird nichts; das Veröffentlichen ist immer Ihre eigene Aktion auf der Seite "Versionen".

## Was ein Assistent kann
| Werkzeug | Was es tut | Speichert es etwas? |
|---|---|---|
| `read_config` | Die wirksame Projektdatei (ganz oder ein Abschnitt wie `tasks`) | Nein |
| `read_problems` | Die Problemliste, die Sie im Builder sehen | Nein |
| `read_schema` | Was die Datei enthalten darf (JSON-Schema) | Nein |
| `propose` | Probiert Änderungen (Ops) im Entwurf im Speicher aus: zeigt, was sich ändert, den neuen Overlay-Text und die Probleme | Nein |
| `simulate` | Führt die Datei (mit vorgeschlagenen Änderungen) auf einem Testobjekt aus: welche Aufgaben angeboten werden, und einen Probelauf einer Aufgabe | Nein |
| `apply` | Speichert die Änderungen im Entwurf | Ja, nur mit Ihrer Bestätigung |

## Verbinden
Der Endpunkt ist `POST /api/mcp/<Projekt>` (MCP über HTTP, JSON-Nachrichten). Sie müssen als Admin des Projekts angemeldet sein, wie für den Builder. Der Assistent arbeitet am einen Arbeitsentwurf des Projekts, demselben, den der Builder zeigt.

## Eine Änderung bestätigen
1. Der Assistent zeigt Ihnen seinen Vorschlag: die Änderungen und die daraus entstehenden Probleme.
2. Sie bestätigen ihn im Builder. (Vorerst wird nur geprüft, dass die Anfrage von der Builder-Seite selbst kommt; eine stärkere Prüfung ist geplant, Entscheidung A-018.) Der Assistent erhält damit ein Bestätigungs-Token, gültig **10 Minuten** und genau für diese Änderungen auf diesem Stand des Entwurfs.
3. Der Assistent speichert die Änderung mit `apply` und dem Token.

Hat inzwischen jemand den Entwurf geändert, wird `apply` abgelehnt (`stale_revision`) und nichts geschrieben, genau wie wenn zwei Personen im Builder bearbeiten. Der Assistent liest den Entwurf dann neu und schlägt erneut vor. Der Builder zeigt dann "Der Entwurf wurde woanders geändert. Laden Sie die Seite neu, um den aktuellen Stand zu sehen." mit dem Knopf "Neu laden".

## Grenzen
Eingaben eines Assistenten gelten als nicht vertrauenswürdig: höchstens 50 Änderungen auf einmal, höchstens 200.000 Zeichen, Werte höchstens 32 Ebenen tief und Texte höchstens 16.384 Zeichen. Ein Ausdruck, den ein Assistent schreibt, darf höchstens 16.384 Zeichen lang und 16 Ebenen tief verschachtelt sein (Ihre eigenen Dateien erlauben mehr). Ein Vorschlag, der eine Grenze verletzt, wird mit Begründung abgelehnt.

Den Schlüssel für die Bestätigung legt die Server-Einstellung `UEBERBLICK_MCP_SECRET` fest. Ohne sie erzeugt der Server bei jedem Start einen neuen Schlüssel; offene Vorschläge müssen dann nach einem Neustart erneut bestätigt werden.
