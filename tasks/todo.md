# GQ-H1-a — Verworfene Antworten raus aus dem Transkript

Owner-Entscheidung 2026-08-06: H1-a zuerst, danach P2 (Modell-A/B), danach P3 (Persona).

## Das Problem, am Log belegt

Telnyx' Eager-EOT fordert bei uns eine Antwort an, sobald es den Sprecher fuer fertig haelt.
Redet die Gegenstelle weiter, **verwirft** Telnyx die Antwort und fragt mit dem vollstaendigen
Satz erneut. Wir haben die verworfene Antwort trotzdem gerechnet, bezahlt — und ins Transkript
geschrieben (`src/claude.js:1196`, unbedingt nach jedem fertigen Turn).

Folge: Kontext des naechsten Turns, Zusammenfassung und Owner-Nachricht enthalten Antworten,
die **nie gesprochen wurden**. Ein Agent, dessen Kontext behauptet, er habe etwas bereits
gesagt, verhaelt sich zwangslaeufig unsinnig.

## Das Signal — kein Rateschluss

Telnyx schickt bei jedem Request seine **eigene** Sicht der Konversation mit
(`req.body.messages`, im Shim bereits als `messagesCount`/`roleCounts` ausgewertet).
Waechst diese Liste zwischen zwei Requests **nicht**, hat Telnyx unsere Antwort verworfen.

Belegt an `call_msgf3r21x0w0` (Render-Log, `turn_probe`):

| turnSeq | chars | prevRelation | messagesCount | Antwort |
|---|---|---|---|---|
| 4 | 25 | other | 6 | **verworfen** |
| 5 | 51 | extends | 6 | behalten |
| 6 | 23 | other | 8 | behalten |
| 7 | 33 | other | 10 | **verworfen** |
| 8 | 68 | extends | 10 | **verworfen** |
| 9 | 106 | extends | 10 | behalten |
| 10 | 42 | other | 12 | — |

Gegenprobe: Telnyx' Konversations-API liefert fuer denselben Anruf 12 Nachrichten,
davon 5 vom Assistenten — bei 8 substanziellen Turns auf unserer Seite. 3 verworfen.
Die Zeichenzahlen passen lueckenlos (turn 4 = 25 Zeichen „Was wuerde ich das wissen?",
turn 5 = 51 Zeichen derselbe Satz zu Ende gesprochen).

## Die Falle in der Persistenz (vor dem Bauen gefunden)

`flushTranscript` (`src/store/pg.js:1595`) ist **index-basiert append-only**: es zaehlt die
vorhandenen DB-Zeilen und fuegt nur `call.transcript[i]` fuer `i >= existing` ein. Ein
`splice` im Speicher wuerde
1. die DB-Zeile **nicht** loeschen, und
2. die Indizes verschieben — danach ist `existing > length`, die Schleife laeuft nie mehr,
   und **alle** weiteren Segmente dieses Calls landen still nicht mehr in der DB.

Der Fix muss die Entfernung also bis in die Persistenz durchziehen. Sonst tauscht er einen
sichtbaren Defekt gegen stillen Datenverlust.

## Umsetzung

| # | Was | Datei |
|---|---|---|
| 1 | Sonde meldet zusaetzlich, ob Telnyx' Nachrichtenliste seit dem letzten Request gewachsen ist (rein beobachtend, entscheidet nichts) | `src/telnyx-turn-probe.js` |
| 2 | Shim entscheidet: nicht gewachsen + Vorgaenger hat eine agent-Zeile geschrieben -> Zeile verwerfen, PII-freie Logzeile | `src/telnyx-llm-shim.js` |
| 3 | Store-Operation „letzte agent-Zeile dieses Calls entfernen" | `src/store/state-ops.js`, `src/store.js` |
| 4 | `flushTranscript` raeumt entfernte Segmente auch in der DB ab (Wurzel der Falle oben) | `src/store/pg.js` |

Bewusst **nicht** Teil dieser Phase: die verworfenen Turns gar nicht erst auszufuehren. Das
hiesse, die Fortsetzung der Gegenstelle vorherzusagen, und tauscht Latenz gegen Tokens. Der
richtige Hebel dafuer ist Eager-EOT in der Telnyx-Konfiguration (H1-b, Owner/Portal).

## Abnahme

Die Abnahme des Kickoffs ist **ueberholt** (H1-c): „gesprochene Antworten: 3 -> 1" misst
etwas, das Telnyx bereits erledigt — der Anrufer hat nie drei Antworten gehoert. Neu:

| Messung | heute | Ziel | Verifikation |
|---|---|---|---|
| agent-Zeilen im Transkript je wachsender Aeusserung | 3 | **1** | `node --test test/gq-h1-haken-repro.test.js` |
| persistierte Segmente nach einer Entfernung (pg) | Zeile bleibt + Folge-Segmente gehen verloren | **DB spiegelt den Speicher** | neuer Test gegen `flushTranscript` |
| Modell-Latenz `shim_turn` | 1107-1972 ms | **unveraendert** (der Fix laeuft nach dem Turn, nicht davor) | keine Wartezeit im Pfad |
| `npm test` | 3996 gruen | **gruen** | `npm test` |

## Pre-Mortem

Ein Jahr weiter, die Phase war falsch — was ist passiert?

1. **Wir haben echte, gesprochene Zeilen geloescht.** Das Gedaechtnis ist auf die andere Art
   vergiftet: der Agent weiss nicht mehr, was er gesagt hat, und wiederholt sich.
   -> Entschaerfung: die Entfernung haengt am **Nichtwachsen** der Anbieterliste, nicht an
   `prevRelation === "extends"`. Ein „extends" ohne Verwerfen laesst die Zeile stehen.
2. **Stiller Datenverlust in der DB** (die Falle oben). -> eigener Test, Punkt 4.
3. **Der Fix kostet Latenz.** -> Er laeuft nach dem Turn auf dem naechsten Request, nicht im
   Sprechpfad. Latenz-Zeile in der Abnahme.
