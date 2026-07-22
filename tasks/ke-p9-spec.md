# KE-P9 — Belegabruf nur ueber abrufbare Kandidaten

**Stand:** 2026-07-22. Basis: `master` (`c62a432`), live deployed ist `5c2c59e`
(Boot-Banner verifiziert). Diese Phase ist ein Nachzug zur gelaufenen KE-Kette.

---

## 1. Der Befund (live gemessen, nicht hergeleitet)

Zwei aufeinanderfolgende Sweeps am 2026-07-22 auf dem Live-Dienst
(`srv-d8m0fhflk1mc73bno570`, Render-Log):

```
09:15:15  sweep trigger=interval kandidaten=33 gemessen=3 unvollstaendig=0
          ohne_schaetzung=27 unbestimmt=0 uebersprungen=3
          anfragen=16 seiten=16 pool=697 vollstaendig=true

10:15:15  sweep trigger=interval kandidaten=3 gemessen=0 unvollstaendig=0
          ohne_schaetzung=0 unbestimmt=0 uebersprungen=3
          anfragen=11 seiten=11 pool=474 vollstaendig=true
```

**Der zweite Sweep macht 11 Anfragen und holt 474 Belege, um 3 Calls zu
ueberspringen.** Nichts gemessen, nichts gebucht. Das wiederholt sich stuendlich.

### Ursachenkette (jede Stufe am Code belegt)

1. `providerLegIdOf = (call) => call.twilioSid || call.callControlId || null`
   — `cost-truing.js:71`.
2. `trueOneCall`: `if (!control || !legId) { tally.skippedCalls++; return; }` —
   `cost-truing.js:464-468`. Das `return` steht **vor** jedem Schreibzugriff:
   kein `closedAt`, kein verbrauchter Versuch.
3. `isTruingCandidate` schliesst nur ueber `costTruedAt !== null` aus
   (`cost-truing.js:157`) — ein uebersprungener Call bleibt damit **dauerhaft**
   Kandidat. Beide Sweeps oben zeigen dieselbe `uebersprungen=3`.
4. `poolSinceFor(candidates)` bildet die Zeitschranke als Minimum des `endedAt`
   ueber **alle** Kandidaten (`cost-truing.js:104-111`) — auch ueber die, fuer die
   nie ein Beleg zugeordnet wird.
5. `fetchCostRecordPools(candidates)` holt den Pool **vor** der Buchungsschleife
   (`cost-truing.js:444-449`), also bevor feststeht, dass kein Kandidat abrufbar ist.
6. `since` steuert direkt die Seitenzahl: `isPageBeforeSince`
   (`adapters/telnyx/voice.js:577`) ist die einzige Abbruchbedingung neben
   `lastPage`.

### Warum das mehr als Verschwendung ist

`since` ist auf dem `endedAt` des aeltesten nicht-abrufbaren Calls eingefroren.
Das Fenster waechst mit jedem Tag, der Pool mit dem gesamten Kontoverkehr.
Erreicht **ein** Typ die Seitenobergrenze `MAX_PAGES_PER_RECORD_TYPE = 10`
(`voice.js:63`), liefert `fetchRecordTypePages` `complete:false` (`voice.js:579`),
`bookablePool` uebersetzt das zu `ok:false` (`cost-truing.js:408-411`) — und dann
bleiben **alle** Kandidaten `unavailable`: keine Rueckerstattung mehr, fuer
niemanden. `tasks/ke-DEPLOY-CHECKLIST.md` Kap. 4.5 nennt `vollstaendig=false`
woertlich einen Rollback-Grund.

Der Bruchpunkt-Waechter aus KE-P8 (Schwelle 1440 Anfragen) schlaegt dabei **nicht**
an: er misst die Anfragezahl, und die bleibt zweistellig, waehrend der Pool zulaeuft.

### Bewusst NICHT belegt (Grenzen der Messung)

- Alter/Provider/Status der drei Calls: die Prod-DB war per `psql` nicht
  erreichbar (`SSL connection has been closed unexpectedly`). Laut
  `PLAN-KOSTEN-ENDSPIEL.md` sind es `status=failed`-Anrufe ohne Leg-Referenz
  (Origination scheiterte nach ~350 ms) — **fuer diesen Fix irrelevant**, weil die
  Bedingung `!control || !legId` beide moeglichen Ursachen deckt.
- `since` wird nicht geloggt, ist also nur indirekt belegt (Pool fiel 697 -> 474,
  als 30 Kandidaten wegfielen, blieb bei 3 verbliebenen aber gross).
- Wann die Seitenobergrenze konkret reisst: Extrapolation, keine Messung.

---

## 2. Auftrag

Pool-Abruf **und** Zeitschranke duerfen nur noch von Kandidaten bestimmt werden,
die tatsaechlich abrufbar sind. Ein Call ohne aufloesbare Leg-Referenz (oder mit
einem Provider ohne Beleg-Methoden) ist strukturell nie abgleichbar und darf
weder den Umfang noch das Zeitfenster des Abrufs bestimmen.

### Die zentrale Design-Auflage

Die Bedingung „ist dieser Call abrufbar" darf **nicht** ein zweites Mal parallel
entstehen. Sie gehoert in **eine** Funktion, die sowohl `trueOneCall` als auch die
Kandidatenmenge fuer `fetchCostRecordPools`/`poolSinceFor` benutzen.

Begruendung: genau dieser Fehlertyp — derselbe Sachverhalt an zwei Stellen
getrennt gepflegt — ist in dieser Kette bereits dreimal gefangen worden (LCT P5
Ueberlauf-vs-Datenknappheit, LCT P4 `incomplete` doppelt belegt, LCT P6 Slug-Faelle).
Zwei auseinanderlaufende Praedikate wuerden hier bedeuten: ein Call gilt fuer den
Abruf als nicht abrufbar, wird aber in der Schleife trotzdem abgeglichen — oder
umgekehrt, ein abrufbarer Call faellt still aus dem Fenster und wird nie gemessen.

Achtung bei der Aufteilung: `control` stammt heute aus `fetchCostRecordPoolFor`
(Provideraufloesung + Faehigkeitspruefung, `cost-truing.js:418-434`) und ist damit
erst NACH dem Abruf bekannt. Die Vorfilterung darf daher nicht naiv `control`
verlangen — der Umsetzungsplan muss zeigen, wie beide Seiten dieselbe Wahrheit
benutzen, ohne die Provideraufloesung zu duplizieren oder einen zweiten
Netz-Zugriff einzufuehren (PM-5: zwischen Pool-Abruf und Buchungsschleife liegt
strukturell kein Netz-`await`).

### Ausdruecklich NICHT Teil dieser Phase

- Calls ohne Leg-Referenz terminal abschliessen (Owner-Entscheidung 2026-07-22:
  **nur Abruf-Filter**). Sie bleiben in der Kandidatenliste und werden weiter als
  `uebersprungen=` gezaehlt — nur kosten sie keinen Abruf mehr.
- Jede Aenderung an Zuordnung (`assignCostRecords`, `anchoredSessionIds`,
  `via_`-Zaehler), Buchung (`applyCostCorrectionCents`), Deckungsquote
  (`costTruingCoveragePercent`) oder am Sweep-Log-Format.
- Neue Env-Variable, neue Dependency, `render.yaml`, Deploy.

---

## 3. Abnahmekriterium (deterministisch, rot vor gruen)

Neuer Test: ein Sweep, dessen Kandidaten **ausschliesslich** nicht abrufbar sind
(kein `twilioSid`, kein `callControlId`), loest

- **0** Anfragen aus (heute: 11 live / im Test die Seitenzahl des Bestands),
- **0** Schreibzugriffe,
- **0** verbrauchte Versuche,
- und zaehlt die Calls unveraendert als `uebersprungen=`.

Zweiter Test (Gegenprobe gegen einen zu scharfen Filter): eine **gemischte**
Kandidatenmenge — ein alter nicht-abrufbarer Call plus ein junger abrufbarer —
holt den Pool weiterhin, und die Zeitschranke richtet sich nach dem **abrufbaren**
Call, nicht nach dem alten. Dieser Test ist die eigentliche Sicherung: er faellt,
wenn der Filter versehentlich abrufbare Calls ausschliesst.

Der rote Lauf ist **vor** den `src/`-Edits zu erzeugen und woertlich zu
protokollieren.

Zusaetzlich: `node --check` auf jede geaenderte Datei, volle Suite `npm test`
gruen (Basis-Zahl vorher selbst messen, nicht aus einem Report zitieren — die
Suite hatte zuletzt 2906 Tests und einen bekannten Voll-Last-Flake in
`test/f1-geo-onboard.test.js`, der isoliert gruen ist).

---

## 4. Pre-Mortem (vor der Umsetzung zu entschaerfen)

1. **Filter zu scharf** — ein abrufbarer Call faellt aus dem Fenster, wird nie
   gemessen, die Schaetzung bleibt stehen. Richtung ist fail-closed (zulasten der
   Marge, nie des Kunden), aber es waere **stiller** Verlust. Gegenmittel: die
   geteilte Bedingung (Auflage oben) + der zweite Abnahmetest.
2. **Filter zu lasch** — nichts aendert sich, der Leerlauf bleibt. Faengt der
   erste Abnahmetest.
3. **Zeitschranke rutscht nach vorn, waehrend ein abrufbarer Call noch aelter
   ist** — dann wuerden Belege verpasst und der Pool trotzdem `complete:true`
   melden: eine Rueckerstattung auf bewiesener Untermenge, also die fail-OPEN-
   Richtung im Geldpfad. Genau davor warnt der Kommentar zu
   `POOL_SINCE_MARGIN_MS` (`cost-truing.js:83-95`). Der Plan muss zeigen, dass die
   Schranke ueber **alle** abrufbaren Kandidaten gebildet wird, nie ueber eine
   Teilmenge davon.
4. **Leere abrufbare Menge bei nicht-leerer Kandidatenmenge** — der Pfad ist neu
   (heute unmoeglich, weil immer abgerufen wird). Er muss dasselbe tun wie „gar
   keine Kandidaten": 0 Anfragen, kein Wurf, Bilanz weiterhin korrekt geloggt.

---

## 5. Kontext-Verweise

- `PLAN-KOSTEN-ENDSPIEL.md` — die Zielarchitektur A-lite, deren Zusage
  („ein Belegabruf je Sweep statt je Kandidat") diese Phase vervollstaendigt.
- `tasks/ke-p5-report.md` — Einfuehrung von `poolSinceFor`; Abschnitt 8 benennt
  die Seitenobergrenze bereits als offenes Restrisiko fuer die Live-Beobachtung.
- `tasks/ke-DEPLOY-CHECKLIST.md` Kap. 4.5 — `vollstaendig=false` ist Rollback-Grund.
- `.claude/refs/clean-code.md` — hartes Gate (S1/S2 = Blocker).
