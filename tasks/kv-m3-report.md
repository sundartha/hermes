# Phase KV-M3 — Die Deckungsquote misst, was belegbar ist

Gate: **PASS**
finalBranch: `phase/kv-m3-deckungsquote`

## Befund N4 (kurz)

`costTruingCoveragePercent` zaehlte im Nenner bislang **jeden beendeten Call**, unabhaengig
davon, ob er ueberhaupt je einen Provider-Beleg bekommen konnte (nie beantwortet, ohne
buchbare Schaetzung, oder ausserhalb des Zeitfensters, in dem der Provider Belege
vorhaelt). Das druegt die Quote systematisch nach unten, ohne dass die niedrige Zahl
irgendetwas Falsches im Buchungssystem anzeigt — sie zeigt nur, dass der Nenner zu weit
gefasst war.

## Was gebaut wurde

- **`coverageBucketOf(call, nowMs)`** in `src/billing/cost-truing.js`: EIN Praedikat mit
  vier sich gegenseitig ausschliessenden Ausgaengen (`eligible`, `nie_beantwortet`,
  `ohne_schaetzung`, `ausserhalb_fenster`) statt eines Booleans.
- **`coverageBreakdown(state, nowMs)`**: EIN Durchlauf ueber die beendeten Calls, der
  Nenner, Zaehler und alle drei Nebenzaehler gemeinsam bildet. `costTruingCoveragePercent`
  und die Sweep-Log-Zeile leiten sich beide aus demselben Breakdown-Objekt ab
  (`percentFromBreakdown`) — keine zweite Iteration, keine zweite Formel.
- **`PROVIDER_COST_RECORD_WINDOW_DAYS = 7`** (exportierte, benannte Konstante, KEINE
  Env-Variable) als das Provider-Belegfenster, das vor dieser Phase nirgends im Code
  existierte.

## Das "belegbar"-Praedikat und wo es lebt

`coverageBucketOf(call, nowMs)` lebt in `src/billing/cost-truing.js`, direkt unter
`isEndedCall`/`endedAtMs`. Es ist bewusst **kein** Alias von `isTruingCandidate` (das
fragt "ist dieser Call jetzt fuer einen weiteren Sweep-Versuch faellig", inkl.
`costTruedAt`-Riegel/Attempt-Zaehler). "Belegbar" fragt stattdessen: "kann dieser Call
ueberhaupt je einen Beleg bekommen?" — eine reine Klassifikation ohne Attempt-Zustand.

Reihenfolge der Pruefungen: (1) nie beantwortet -> (2) ohne buchbare Schaetzung -> (3)
ausserhalb des Belegfensters -> sonst eligible. Nenner UND alle drei Nebenzaehler lesen
ausschliesslich diese eine Funktion (G5) — eine zweite, getrennt gepflegte Fassung liefe
beim naechsten Nachziehen auseinander, genau wie `isEndedCall` es vor KV-P3 tat.

## Entscheidung zum Belegfenster

Im Code war das Fenster vor dieser Phase an keiner Stelle vorhanden (grep auf
`last_7_days`/`7 Tage`/`sieben Tage` in `src/`: 0 Treffer — der Befund selbst). Wert:
**7 Tage**, zitiert aus einer Messung in `tasks/kosten-inventar.md:546`
("`detail_records` reicht nur `last_7_days`"), kein erfundener Wert.

Bewusst **keine** Env-Variable: ein Wert, den ein Operator herunterdrehen kann, um Calls
vorzeitig aus dem Nenner zu nehmen, waere eine Sicherung, die an ihre eigene Verletzung
angepasst werden koennte — ein zu klein gesetztes Fenster wuerde die Quote kuenstlich
nach oben treiben und den WARN still aushebeln. Ein zu grosses Fenster ist dagegen
harmlos (druegt die Quote hoechstens, hebt sie nie faelschlich). Als exportierte
Konstante `PROVIDER_COST_RECORD_WINDOW_MS` koppeln Tests direkt gegen sie (kein zweites
"7" im Testcode).

## Log-Zeile, wortlaut

Vorher:
```
[cost-truing] deckung=25% schwelle=80%
```

Nachher:
```
[cost-truing] deckung=100% schwelle=80% ohne_schaetzung=14 nie_beantwortet=9 ausserhalb_fenster=0
```

Platzierung: die **immer gedruckte** Zeile in `reportCoverage` (nicht die entprellte
`emitCoverageFinding`-WARN-Zeile). Begruendung: gerade wenn die Quote gut aussieht, feuert
die WARN nicht — dann waeren die drei Nebenzaehler sonst an der einzigen Stelle
unsichtbar, an der ein Hinsehen noetig waere. Die entprellte Finding-Zeile bleibt
byte-identisch (testgepinnt).

## Gemischte Fixture (ALT- vs. NEU-Zahl)

KV-M3-1-Fixture: 6 beendete Calls (2 proven + 1 unproven belegbar, 1 nie_beantwortet,
1 ohne_schaetzung, 1 ausserhalb_fenster, darunter 1 Inbound-Call).

- ALTE Formel (Nenner = alle 6 beendeten): `floor(2*100/6) = 33%`
- NEUE Formel (Nenner = 3 belegbare): `floor(2*100/3) = 66%`

## Verhalten bei leerem Nenner

`0` — nicht `NaN`, nicht `Infinity`, nicht `100`. `percentFromBreakdown({eligible:0,...})`
gibt `0` zurueck. Gepinnt in KV-M3-2 (Unit) und zusaetzlich end-to-end ueber den
HTTP-Endpunkt in `api-cost-truing-sweep.test.js` Fall (A).

## Inbound-Fall (KV-P3)

Inbound-Calls zaehlen im Nenner mit, wenn sie die drei Bedingungen erfuellen (beantwortet,
buchbare Schaetzung, im Fenster) — dieselbe Klassifikation ohne Sonderpfad fuer
Inbound/Outbound. `kv-p3-inbound-truing.test.js` (KV-P3-5) wurde angepasst (fehlende
`estimatedCostCents` an den Fixture-Calls ergaenzt), die erwarteten Zahlen (100/100/66)
blieben identisch.

## Mutationsprobe

`coverageBucketOf` temporaer auf "immer ELIGIBLE" gesetzt (die alte Semantik). Ergebnis:
KV-M3-1/3/4 wurden korrekt rot. KV-M3-2 blieb zufaellig bei 0% (eligible=2, proven=0) —
das war vom Plan selbst vorhergesagt und deshalb KV-M3-3 als garantiert kippender
Zusatztest angelegt worden. Mutation zurueckgenommen, `node --check` + alle vier Tests
wieder gruen, finaler Diff als mutationsfrei bestaetigt.

## Nebenwirkung: Tarif-Untergrenzen-Hinweis verstummt (Owner-Entscheidung 5a)

**Diese Phase laesst eine bestehende Warnung verstummen.** Wirkungsweg konkret: die
verengte Formel treibt `costTruingCoveragePercent` im Plan-Beispiel von 25% auf 100%.
`voiceTariffFloorFindings` in `src/boot-guard.js` feuert nur in der Konjunktion
`belowFloor && thinCoverage` — `thinCoverage` vergleicht `coveragePercent` gegen
`COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80). Springt die Quote ueber diese Schwelle,
wird `thinCoverage` `false`, die Konjunktion liefert `[]`, und
`warnVoiceTariffBelowFullCost` druckt danach keine WARN mehr — obwohl der zugrundeliegende
Zustand (Tarif unter Vollkosten) unveraendert fortbesteht. Kein Byte in `boot.js` oder
`boot-guard.js` wurde geaendert; der Effekt laeuft ausschliesslich ueber den veraenderten
Rueckgabewert von `costTruingCoveragePercent`.

**Ehrlich benannt: der einzige Schutz dagegen, dass danach niemand mehr hinschaut, sind
die drei Nebenzaehler in derselben Log-Zeile — kein Mechanismus.** Es gibt keinen
zweiten, unabhaengigen Alarm, der auslaeuft, wenn diese verstummte WARN uebersehen wird;
es gibt nur eine Zeile im Log, die jemand lesen muss. Das ist schwaecher als ein
Mechanismus (z.B. ein eigener, von der Deckungsquote unabhaengiger Tarif-Unterhalb-Alarm
waere ein Mechanismus). Diese Schwaeche ist der Grund fuer den Abschnitt "Was der Lead
nach dem Deploy pruefen muss" unten — sie kompensiert das Fehlen eines Mechanismus nicht,
sie macht nur das Nachschauen an einer Stelle moeglich.

## Angepasste Bestandstests

- `test/cost-truing-observe.test.js`: drei Faelle angepasst (fehlende
  `answeredAt`/`estimatedCostCents` an Fixture-Calls ergaenzt, sonst waeren Prozentsaetze
  ungewollt gekippt), Object.keys-Pinning um die 3 neuen `coverage*`-Felder erweitert
  (9 -> 12 Felder).
- `test/kv-p3-inbound-truing.test.js` (KV-P3-5): `estimatedCostCents` an allen 3
  Fixture-Calls ergaenzt, erwartete Zahlen blieben identisch.
- `test/cost-truing-booking.test.js`: ein Fall inhaltlich umgeschrieben — vorher druegten
  NO_ESTIMATE/INCOMPLETE die Quote identisch, jetzt verlaesst NO_ESTIMATE den Nenner
  (100%), INCOMPLETE bleibt drin (50%); das ist die beabsichtigte Verhaltensaenderung
  dieser Phase.
- `test/api-cost-truing-sweep.test.js`: zwei Faelle um die 3 `coverage*`-Felder sowie
  fehlende `estimatedCostCents` ergaenzt (sonst waere ein Fall ungewollt von 50% auf 0%
  gekippt).
- `test/helpers.js` (`outboundEndedCall`/`outboundCallsSeed`, geteilt von
  `cost-truing-booking-guard.test.js` und `voice-tariff-full-cost-guard.test.js`):
  `answeredAt`/`estimatedCostCents` ergaenzt — eigener Fund der Umsetzung, im Plan nicht
  gelistet; ohne diesen Fix waeren alle `outboundCallsSeed`-Calls dauerhaft als
  `nie_beantwortet` klassifiziert worden.

## Safety-Urteil

Approved. Kein Blocker. Bestaetigt: Nebenzaehler vorhanden, Praedikat nicht zu weit
gefasst, kein blockierender Pfad veraendert, Schwelle unangetastet, Truing-Logik
unangetastet, Inbound zaehlt mit, leerer Nenner sicher (0), keine Secrets geleakt,
bestehende Assertions nicht abgeschwaecht, Safety-Gates intakt, `PLAN-SECURITY.md`
aktualisiert. Einzige Anmerkung (kein Blocker): `MS_PER_MINUTE` ist lokal in
`cost-truing.js` dupliziert zu `utils/timer.js` — praeexistent, nicht Teil dieses Diffs.

## Clean-Code-Audit

Verdict: sauber umgesetzt. EIN Praedikat (`coverageBucketOf`) und EIN Durchlauf
(`coverageBreakdown`) liefern Nenner, Zaehler und die drei Nebenzaehler gemeinsam, keine
Duplizierung (G5). Fenster/Schwelle als benannte Konstanten (G25), Ganzzahl-Prozent mit
`floor` und Nenner-0-Schutz (G26). Keine Umlaute im Code, kein toter Code, keine
ungenutzten Imports.

Einziger Fund (S3, kein Blocker): `src/billing/cost-truing.js:159` — die
Fensterpruefung `endedMs === null || nowMs - endedMs > PROVIDER_COST_RECORD_WINDOW_MS`
ist ein zusammengesetzter Ausdruck direkt im `if`, kein benanntes Praedikat. Vorschlag:
in eine eigene Funktion (z.B. `isOutsideProviderWindow`) extrahieren. Nicht behoben in
dieser Phase (S3, kein Blocker).

## Fix-Runden inkl. Fehlalarme

- Plan-Formel fuer `PROVIDER_COST_RECORD_WINDOW_MS` war dimensional falsch (Faktor 60 zu
  klein: 10.08 Mio statt 604.8 Mio ms fuer 7 Tage) — in der Umsetzung selbst gefunden und
  korrigiert.
- `test/helpers.js`-Fixture-Luecke (`outboundEndedCall`) war im Plan nicht gelistet,
  wurde in der Umsetzung selbst gefunden und behoben (siehe oben).
- `npm run test:gates` haengt am bekannten, vorbestehenden `auth-p9a-cache-headers`-Problem
  (dokumentierte Repo-Lehre, nicht Teil dieser Phase) — Lauf abgebrochen, die betroffene
  Datei isoliert gruen bestaetigt (5/5), der Rest der Gates-Suite ohne diese Datei separat
  gefahren: 572/575 gruen; die 3 roten sind vorbestehende "SOLL rot"-Gate-Befunde
  (GAP-05, GAP-15 x2), unabhaengig von KV-M3.
- Kein Fehlalarm ohne echte Ursache — beide gefundenen Abweichungen (Formel, Fixture)
  waren reale Luecken im Plan, keine falschen Verdachte.

`npm test`: 3828/3828 gruen (Safety-Review spaeter mit 3848/3848 gruen bestaetigt, keine
Flakes beobachtet).

## Was diese Phase NICHT tut

- Die Schwelle `COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80) ist unveraendert.
- Die Abgleich-/Truing-Logik selbst (welche Calls einen Sweep-Versuch bekommen,
  `isTruingCandidate`, Attempt-Zaehler, `costTruedAt`-Riegel) ist unveraendert.
- Keine Zeile der Landkarten-/Kandidatenauswahl-Logik wurde gekippt — nur der Nenner der
  Deckungsquote und die Sichtbarkeit der drei Nebenzaehler in Log und Rueckgabewert.

## Was der Lead nach dem Deploy pruefen muss

Die erste Sweep-Log-Zeile in Produktion ablesen (Format:
`[cost-truing] deckung=X% schwelle=Y% ohne_schaetzung=A nie_beantwortet=B ausserhalb_fenster=C`)
und die vier Zahlen — Deckungsquote sowie alle drei Nebenzaehler — in
`tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md` eintragen. Das ist keine Formsache: solange
niemand diese Zeile liest, ist die in dieser Phase verstummte Tarif-Untergrenzen-Warnung
(Owner-Entscheidung 5a, s.o.) ohne jede Beobachtung — die Nebenzaehler sind der einzige,
mechanismus-lose Ersatz dafuer.
