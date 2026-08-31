# Befunde waehrend der Kette KV2-1..KV2-10

Gesammelt vom Lead beim Merge-Gegenlesen. Keiner davon war ein Merge-Blocker;
alle sind gemessen, nicht vermutet.

## F-1 (offen): `el-fixtures-echte-antworten.test.js` pinnt eine Wanduhr-Millisekunde

Beim Vollauf nach dem KV2-4-Merge rot mit `149001 !== 149000` ("der Anker liegt exakt
call_duration_secs vor dem Gespraechsende", Zeile 212). Dreimal isoliert nachgefahren:
5/5 gruen. Der Test rechnet den Buchungsanker gegen `Date.now()` und vergleicht auf die
exakte Millisekunde - unter Last verschiebt sich das um 1 ms und der Test faellt.

NICHT von der Kette verursacht: letzte Aenderung an der Datei ist `fe046f8`
(outbound-e5), also vor KV2-1. Behebung waere eine Toleranz (z.B. `<= 2 ms`) statt
`strictEqual`.

## F-2 (offen): der EL-Fixture-Test faehrt einen Fake-Store OHNE `recordCallCostEvidence`

Im selben Lauf 19-mal im Log:
`[el-kosten-beleg] Belegschreibung fehlgeschlagen (call=...): store.recordCallCostEvidence is not a function`

Alle 19 aus derselben Datei (`test/el-fixtures-echte-antworten.test.js`). Der
Produktionspfad ist versorgt - `src/store.js:148` re-exportiert die Operation, `json.js`
und `pg.js` haben sie, und `kosten-beleg.js` bekommt den Store per Parameter (DIP,
`outbound.js:978`). Es trifft also nur das Test-Double.

Warum es trotzdem zaehlt: der fail-soft-Zweig aus KV2-4 verschluckt den Fehlschlag
lautlos, und zwar ausgerechnet in dem Test, der die EL-Antworten gegen echte Fixtures
prueft - also an der realistischsten Stelle laeuft der Belegweg NICHT mit. Wer spaeter
annimmt, dieser Test decke den Belegweg ab, irrt.

Natuerlicher Ort zum Schliessen: KV2-9 (Reifung des EL-Belegs).

## F-3 (Umgebung, nicht Code): `npm test` bricht haengende Worker nie ab

`test/testbaenke-run.mjs` faehrt `node --test` ohne `--test-timeout`, der Default ist 0
(= kein Timeout). Zweimal beobachtet: ein Worker haengt (`el-consult-neustart.test.js`,
spaeter `graceful-shutdown.test.js`), der Wrapper gibt trotzdem seine Summe aus und
beendet sich - der Kindprozess laeuft weiter und verseucht als Fremdlast den NAECHSTEN
Lauf. Genau daraus entstanden die wandernden Einzelfehler nach dem KV2-2-Merge
(Lauf 1: 6 rot, Lauf 2: 1 rot, jedes Mal andere Tests, alle isoliert gruen).

Gegenmittel im Betrieb: vor jedem Lauf `pkill -9 -f "node --test"`. Eine echte Behebung
waere ein `--test-timeout` im Wrapper - das ist aber eine eigene Entscheidung
(ein Timeout macht langsame Spawn-Tests rot) und gehoert nicht in diese Kette.

## F-4 (offen, Owner-Entscheidung 2026-08-31): zwei wortgleiche Summierfunktionen

`src/billing/sweep-kostenbeleg.js:sumMicroCents` und
`src/billing/cost-truing.js:sumRecordMicroCents` summieren beide Ganzzahl-Betraege ueber
Records mit safe-integer-Pruefung je Betrag und Abbruch bei ungueltigem Wert - fast
wortgleich. Der Autor benennt die Duplizierung selbst im Kommentar ueber `sumMicroCents`.

Warum sie steht: das Zusammenfuehren verlangt einen Eingriff in `makeCostTruing`, und
deren Zeilenbudget (292) ist per eslint-suppressions gepinnt - eine Anhebung ist eine
Owner-Freigabe, kein Nebeneffekt einer Phase. KV2-5 hat den Blocker deshalb nach zwei
Fix-Runden stehen lassen (BLOCKED), statt das Gate eigenmaechtig zu bewegen. Das ist das
richtige Verhalten.

Owner-Entscheidung 2026-08-31: gemergt, Befund bleibt offen. Zusammenfuehren gehoert in
eine Folge-Phase MIT der Freigabe, das Budget neu zu pinnen.

## F-5 (offen, Owner-Entscheidung 2026-08-31): reale Rufnummern in getrackter Doku

Der KV2-5-Kritiker meldete als S1, dass `tasks/kostenv2/befund-telnyx.md` reale
Rufnummern traegt (zwei DIDs, ein Ziel, eine deutsche Privatnummer).

Gemessen, bevor entschieden wurde:
- Der KV2-5-Diff fuegt KEINE einzige neue Nummer hinzu (`git diff` auf die Datei,
  gefiltert auf E.164-Muster: leer). Die Nummern stammen aus dem Doku-Commit `8ce6de4`,
  mit dem der Lead die untrackte Vorsession-Doku ueberhaupt erst commitfaehig gemacht hat.
- Dieselben vier Nummern stehen bereits in 10 bis 26 anderen getrackten Dateien
  (`git grep -l` gegen HEAD, je Nummer gezaehlt).

Owner-Entscheidung 2026-08-31: nur notieren, nicht handeln. Begruendung: eine Redaktion
im Arbeitsbaum entfernt die Nummern NICHT aus der Historie - dafuer braeuchte es ein
History-Rewrite, das den Upstream-Split (Render deployt jonas986) beruehrt und weit
ausserhalb dieser Kette liegt. Eine Redaktion in nur dieser einen Datei waere Kosmetik.
