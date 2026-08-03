# KV-P3 — Inbound in den Ist-Abgleich

Gate: **PASS**
finalBranch: `phase/kv-p3-inbound-ist-abgleich`
Basis: `master` @ `b112db2`

## Was gebaut wurde

Der Richtungsfilter, der bisher jeden Inbound-Call vom Kosten-Ist-Abgleich (`cost-truing.js`)
ausgeschlossen hat, ist entfernt. Konkret in `src/billing/cost-truing.js`:

- Modulkopf-Kommentar aktualisiert: der Abgleich lief seit LCT P3/P4 buchend, aber nur fuer
  Outbound-Calls; seit KV-P3 in BEIDEN Richtungen. Begruendung im Kommentar: ein Inbound-Call
  traegt seit KV-P2 eine Schaetzung auf der Gate-Achse (6 EUR-Cent je angefangener Minute) und
  blieb ohne Abgleich dauerhaft rund 3,5x ueber dem an KV-M1 gemessenen Ist (1,87 US-Cent/min).
- `OUTBOUND_DIRECTION`-Konstante entfernt (nach dem Rename ohne Verwender — toter Code, G9/C5).
- Das Praedikat `isEndedOutbound` umbenannt und defiltert (siehe unten).
- Kommentare an `costTruingCoveragePercent` und `isTruingCandidate` auf richtungsneutral
  aktualisiert.

## Die Umbenennung

`isEndedOutbound` -> `isEndedCall`.

Vorher: `call.direction === OUTBOUND_DIRECTION && !!call.endedAt`
Nachher: `!!call.endedAt`

Begruendung (N2): nach dem Wegfall des Richtungsfilters beantwortet die Funktion nur noch
genau eine Frage — ist dieser Call beendet? Ein Name, der weiterhin „Outbound" behauptet,
waere eine Luege auf der falschen Abstraktionsebene. Mitgezogen: beide Aufrufer
(`costTruingCoveragePercent`, `isTruingCandidate`), der Modulkopf-Kommentar und ein
Bestandstestname samt Rumpf (`cost-truing-observe.test.js`, Fall „(i)").

EINE Quelle fuer BEIDE Verbraucher (G5): den Kandidaten-Riegel und den Nenner der
Deckungsquote — zwei getrennte Fassungen liefen sonst beim naechsten Nachziehen auseinander.

## Beleg, dass die Beleg-Zuordnung richtungsneutral ist

Selbst geprueft: `grep -n "direction" src/telephony/adapters/telnyx/voice.js` = **0 Treffer**
in der gesamten Datei. Der Adapter kennt das Feld `direction` nicht.

Zusaetzlich wurde jede Stufe der Zuordnungskette gelesen (`fetchCostRecordPool`,
`fetchAllCostRecords`/`ASSIGNABLE_COST_RECORD_TYPES`, `isPageBeforeSince`, `matchesAnchor`
(`ANCHOR_ID_FIELD = call_control_id`), `anchoredSessionIds`/`SESSION_ID_FIELDS`
(`telnyx_session_id`, `call_session_id`), `assignmentOutcome`, `withinRecordWindow`,
`elevenLabsCharactersOf`, `toCostRecord`, die Signatur von `assignCostRecords(pool, { legId,
startedAt, endedAt })`) — an keiner Stelle wird die Richtung gelesen. Die einzige Verbindung
Beleg->Call ist `providerLegIdOf(call) = call.twilioSid || call.callControlId`, in beiden
Richtungen gleich gesetzt.

Der Beweis liegt live vor: KV-M1 hat fuer den **Inbound**-Anruf `call_msczw0irl06s` 13 von 375
Rohbelegen ueber genau diese Kette zugeordnet (1 ueber den Anker, 2 ueber
`telnyx_session_id`, 10 ueber `call_session_id`), `complete:true`. Die Zuordnung funktioniert
fuer Inbound bereits nachweislich — sie wurde vorher nur nie aufgerufen, weil der
Kandidatenfilter davor sass.

**Konsequenz:** Der Adapter (`src/telephony/adapters/telnyx/voice.js`) bleibt byte-identisch
unberuehrt. Diese Phase ist eine reine Filter-Entfernung in `cost-truing.js`.

## Korrektur-Richtung inkl. Periodengrenzen-Riegel (nicht angefasst, nur beschrieben)

Negative Korrektur laeuft ueber `applyCreditCents` (state-ops.js, unveraendert, 0 diff), drei
Achsen:

- **Lebenszeit** `usage.costCents`: immer, mit 0-Boden.
- **Spend-Monat** `usage.spendMonthCostCents`: nur wenn `creditHitsSpendMonth` (Anker
  existiert, gleicher Monat, Zaehler noch laufend).
- **Perioden-Fenster**: faellt automatisch mit, wenn die Belastung im laufenden Fenster lag;
  sonst wandert die Baseline um denselben Betrag mit — das Fenster bleibt unberuehrt.

**Periodengrenzen-Riegel:** trifft die Korrektur nach einem Monats-/Perioden-Wechsel ein,
wirkt sie ausschliesslich auf der Lebenszeit-Achse. Die beiden Achsen, die das Gate sperren,
bleiben auf dem alten (zu hohen) Schaetzwert stehen. Das ist Absicht (KS-P5): ohne diese
Kompensation weitete jede alte Gutschrift die Perioden-Decke des neuen Fensters aus. Bestehendes
Verhalten, von KV-P3 nicht angefasst.

**Fenstergroesse:** zwischen Buchung und Korrektur liegen `COST_TRUING_DELAY_MINUTES` (30) +
ein Sweep-Takt (`COST_TRUING_SWEEP_INTERVAL_MS`, 1 h) ≈ 1,5 h. Betroffen ist, wer innerhalb von
~1,5 h vor einer Monats-/Periodengrenze auflegt. Exposition je Leg gedeckelt durch
`MAX_CALL_DURATION_CAP_S` (1800 s): hoechstens 30 x 6 = 180 ct Schaetzung gegen ~52 ct Ist —
maximal ~128 ct bleiben auf der falschen Seite der Grenze stehen, pro betroffenem Anruf.

Zwei Auslоeser einer Korrektur teilen sich denselben Code: `runCostTruingSweep` hat genau zwei
Aufrufer (`boot.js` Intervall, `api-billing.js` manuell), beide durch denselben
`sweepRunning`-Laufriegel geschuetzt. `store.applyCostCorrectionCents` hat repo-weit genau
EINEN produktiven Aufrufer (`bookCorrectionFor`).

## Die Lastrechnung (woertlich)

> # KV-P3 - Lastrechnung des Sweeps (Pre-Mortem TOD 5), Vorbedingung des Merges
>
> Stand 2026-08-03, gerechnet gegen den Code auf `master` (Basis `b112db2`). Jede
> Eingangsgroesse unten ist am Quelltext belegt (Datei + Symbol).
>
> ## 1. Die Schwelle
>
> `SWEEP_REQUESTS_WARN_THRESHOLD = 1440` in `src/billing/cost-truing.js`. Gemeldet ueber
> `reportFetchVolume`, Vergleich strikt: `if (fetchTally.requests <= SWEEP_REQUESTS_WARN_THRESHOLD) return;`
> - die Schwelle reisst erst bei **1441** Anfragen in einem einzigen Sweep.
>
> Datenquelle ist `fetchTally.requests`, aufsummiert in `addPoolFetchStats` aus
> `poolFetchStats(pool).requests` = `poolRun.requests` des Telnyx-Adapters. Gezaehlt wird die
> ABGESETZTE Anfrage (in `attemptCostRecordPage`, nach der Drossel-Reservierung, vor dem
> `fetch`) - ein HTTP-200 und ein HTTP-429 zaehlen gleich.
>
> ## 2. Anfragen je Kandidat - die benannte, begruendete Annahme
>
> > Annahme A: Ein zusaetzlicher Kandidat erzeugt NULL zusaetzliche Provider-Anfragen.
>
> Begruendung am Code, drei Glieder:
>
> 1. `fetchCostRecordPools(retrievable, controls)` iteriert ueber die Kandidaten, setzt aber
>    je Provider genau EINEN Abruf ab: `for (const call of retrievable) { if (pools.has(call.provider)) continue; ... }`.
> 2. Der Abruf selbst ist schleifeninvariant: `fetchCostRecordPool` (bzw. der Adapter dahinter)
>    kennt nur `filter[record_type]`, `page[size]`, `page[number]` - KEIN `legId`, keine
>    Call-Referenz. Der Pool ist konto-weit.
> 3. Die Zuordnung je Call (`assignCostRecords`, aufgerufen aus `trueOneCall`) ist synchron und
>    netzfrei - sie liest den bereits abgerufenen Pool, sie ruft nicht erneut den Provider.
>
> Die einzige Kante, ueber die ein Kandidat den Abrufumfang ueberhaupt beeinflusst, ist
> `poolSinceFor(retrievable)`: der AELTESTE Kandidat setzt `since = aeltestes endedAt minus
> POOL_SINCE_MARGIN_MS`. Ein frueheres `since` laesst die Seitenschleife (`isPageBeforeSince`)
> tiefer blaettern - hart gedeckelt bei `MAX_PAGES_PER_RECORD_TYPE` (s. Abschnitt 3).
>
> ## 3. Die Obergrenze eines Sweeps, aus dem Code hergeleitet
>
> | Faktor | Symbol / Datei | Wert (am Code geprueft) |
> |---|---|---|
> | Belegtypen je Pool | `ASSIGNABLE_COST_RECORD_TYPES` (`telnyx/voice.js`) = `COST_RECORD_TYPES` (7 Eintraege) minus `UNASSIGNABLE_COST_RECORD_TYPES` (nur `inference`) | 6 |
> | Seiten je Typ | `MAX_PAGES_PER_RECORD_TYPE` | 10 |
> | Versuche je Seite | `fetchCostRecordPage`: 1 Versuch + hoechstens 1 Wiederholung nach HTTP 429 (`RATE_LIMITED_STATUS`), danach fail-closed `ok:false` | 2 |
> | Pools je Sweep | ein Pool je distinktem belegfaehigem Provider unter den abrufbaren Kandidaten (`fetchCostRecordPools`) | P |
>
> `Anfragen <= 6 * 10 * 2 * P = 120 * P`
>
> **P heute = 1.** `costRecordControlFor` liefert `null`, wenn der Adapter nicht BEIDE Methoden
> (`fetchCostRecordPool`, `assignCostRecords`) traegt; Twilio hat sie nicht. Twilio-Calls fallen
> ueber `isRetrievable` heraus, loesen nie einen Pool aus und erscheinen als `uebersprungen=`.
> Belegfaehig ist ausschliesslich Telnyx.
>
> > Obergrenze eines Sweeps heute: 120 Anfragen. Schwelle: 1440. Kopffreiheit: Faktor 12.
>
> ## 4. Ab wie vielen Anrufen reisst die Schwelle?
>
> Bei KEINER Anzahl. Die Kandidatenzahl steht in der Formel oben nicht - sie bestimmt weder P
> noch die Faktoren 6/10/2. Formal reisst die Schwelle erst bei
>
> `120 * P > 1440` -> `P >= 13`
>
> also erst mit dem 13. gleichzeitig belegfaehigen Telefonie-Provider im selben Sweep. Es gibt
> heute genau einen (Telnyx).
>
> Die realistische Betriebszahl liegt weit darunter: die Seitenschleife (`fetchRecordTypePages`)
> endet, sobald `page.lastPage` oder `isPageBeforeSince` greift - beide lange vor der
> Seitenobergrenze, solange die Kandidaten juenger als ein paar Stunden sind
> (`test/cost-truing-since.test.js`, `(P5-4)`: ein 3 h alter Kandidat braucht nur eine Anfrage
> je Typ, also 6 Anfragen je Sweep).
>
> ## 5. Der Zuwachs durch KV-P3, ehrlich beziffert
>
> - **Provider-Anfragen: +0.** Die Belege eines Inbound-Calls liegen im konto-weiten Pool
>   BEREITS HEUTE - sie werden nur nie zugeordnet, weil der Kandidatenfilter (`isTruingCandidate`)
>   bisher auf `direction === "outbound"` gefiltert hat. KV-P3 ordnet vorhandene Belege zu, es
>   holt keine neuen. Die Formel aus Abschnitt 3 haengt an Belegtypen, Seiten, Versuchen und
>   Providern - an keiner Stelle an der Kandidatenzahl.
> - **`since` kann frueher rutschen**, wenn der aelteste beendete Inbound-Call aelter ist als der
>   aelteste beendete Outbound-Call. Effekt: mehr Seiten je Typ, gedeckelt bei
>   `MAX_PAGES_PER_RECORD_TYPE` (10) - hoechstens von 6 auf 120 Anfragen im ungluecklichsten
>   Fall. Weiterhin Faktor 12 unter der Schwelle.
> - **CPU statt Netz:** `trueOneCall` laeuft je Kandidat einmal ueber den abgerufenen Pool
>   (`pool.raw`, max. 6 * 10 * 50 = 3000 Rohbelege). Bei N Kandidaten sind das 3000 * N
>   synchrone Vergleiche; bei N = 200 rund 600.000 - Millisekunden, keine Netz-Last, kein
>   Kontingent. Kein Blocker, aber die Groesse, die als erste mit KV-P3 waechst (die
>   Kandidatenmenge verdoppelt sich strukturell, sobald Inbound mitzaehlt).
>
> ## 6. Die reale Grenze liegt woanders - und sie ist fail-closed
>
> Nicht die Anfragezahl, sondern die VOLLSTAENDIGKEIT des Pools ist die bindende Grenze.
> Erreicht ein Typ die Seitenobergrenze, liefert `fetchRecordTypePages` `complete:false`,
> `bookablePool` uebersetzt das in `ok:false`, und ALLE Kandidaten des Sweeps werden
> `unavailable` - keine Rueckerstattung, fuer niemanden (testgepinnt:
> `test/cost-truing-pool.test.js`, `(P3-3)`). Das ist die fail-CLOSED-Richtung: es geht kein
> Geld verloren, der Abgleich verzoegert sich, der Versuchszaehler steigt.
>
> Groessenordnung: 10 Seiten x 50 Belege = 500 Belege JE TYP im `since`-Fenster. KV-M1 misst 5
> `speech-to-text`-Belege je 80-s-Gespraech -> rund 100 Gespraeche pro Stunde waeren noetig, um
> diese Grenze im Stundentakt zu reissen. Das ist eine Wachstums-Alarmschwelle, kein heutiger
> Zustand - und der Bruchpunkt-Waechter (`reportFetchVolume`) meldet sie NICHT (er zaehlt
> Anfragen, nicht Vollstaendigkeit), wohl aber die Sweep-Zeile mit `vollstaendig=false`.
>
> ## 7. Urteil
>
> **KEIN BLOCKER.** Der Bruchpunkt-Waechter reisst bei realistischem Betrieb nicht, weil KV-P3
> die Anfragezahl STRUKTURELL NICHT erhoeht: der Belegabruf haengt am Provider und am
> Zeitfenster, nicht an der Kandidatenzahl. Die Obergrenze eines Sweeps bleibt 120 Anfragen
> gegen eine Schwelle von 1440 - Faktor 12 Kopffreiheit, unveraendert durch diese Phase.
>
> **Zu beobachten (kein Merge-Blocker):** `vollstaendig=` in der Sweep-Zeile
> (`logSweepLine`). Kippt es auf `false`, ist die Gegenmassnahme das schmalere Zeitfenster
> (engeres `since`, `POOL_SINCE_MARGIN_MS` bzw. haeufigerer Sweep-Takt) - nicht mehr Seiten und
> nicht eine hoehere Schwelle. Die Schwelle selbst wird nie gesenkt oder angehoben, um ein
> beobachtetes Verhalten zu erfuellen (dieselbe Regel wie bei `costTruingMinCoveragePercent`).
>
> ## 8. Betriebspruefung (ausserhalb des Codes, vor dem Deploy)
>
> `refundProven` (cost-truing.js) verlangt, dass JEDER Typ aus
> `COST_TRUING_REQUIRED_RECORD_TYPES` unter den zugeordneten Belegen eines Calls vorkommt, bevor
> eine negative Korrektur gebucht wird. KV-M1 hat fuer den Inbound-Anker gemessen: `sip-trunking`
> 1, `call-control` 1, `speech-to-text` 5, `text-to-speech` 5, `recording` 1,
> `ai-voice-assistant` 0. Steht `ai-voice-assistant` in der LIVE gesetzten Pflicht-Menge, landet
> jeder Inbound-Call dauerhaft auf `incomplete` und bekommt NIE eine Gutschrift.
>
> **Versuch, den Live-Wert zu lesen (dieser Bericht):** `.env.example` und `render.yaml` fuehren
> `COST_TRUING_REQUIRED_RECORD_TYPES` LEER - leer waere `REQUIRED_TYPES_EMPTY` (FATAL,
> `boot-guard.js`), der Dienst bootet also mit einem anderen, dashboard-gesetzten Wert. Ein
> Render-Werkzeug zum LESEN von Env-Variablen existiert nicht (nur Schreiben). Der seit KV-M0
> vorgesehene Boot-Banner-Weg (`costTruingTypesBannerLine`, Zeile
> "Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=...") ist in den PRODUKTIONS-Logs der
> letzten 7 Tage NICHT aufgetaucht - der aktuell deployte Commit auf `vodafone-agent`
> (`srv-d8m0fhflk1mc73bno570`) liegt vor KV-M0 (45 Commits hinter `master`/`b112db2`).
>
> Indirekter Hinweis aus den Produktions-Logs: ein Sweep hat dort real eine NEGATIVE Korrektur
> gebucht (`korrektur call=... delta_eur_cent=-104 gebucht=true`, 2026-08-03), was `dataComplete
> === true` voraussetzt (`applyCostCorrectionCents`). Der aktuell deployte Code kennt noch keinen
> Richtungsfilter-Fall fuer Inbound (er ist vor KV-P2), der abgeglichene Call war also ein
> OUTBOUND-Call. Waere `ai-voice-assistant` (laut Code nur ueber den Assistant-Pfad erreichbar,
> `TELNYX_AI_ASSISTANT_ENABLED`) in der Pflicht-Menge, koennte ein Outbound-Call - der nie durch
> den Assistant-Pfad laeuft - diesen Typ strukturell nie zeigen und niemals `complete` werden.
> Dass dieser Outbound-Call `complete` wurde, ist ein INDIZ (kein Beweis), dass
> `ai-voice-assistant` heute NICHT in der Pflicht-Menge steht.
>
> **Offener Befund, in den Bericht:** der Live-Wert von `COST_TRUING_REQUIRED_RECORD_TYPES`
> konnte NICHT direkt gelesen werden (kein Lesetool, KV-M0-Banner noch nicht deployt). Vor dem
> Deploy dieser Phase ist der Wert im Render-Dashboard von Hand zu pruefen; enthaelt er
> `ai-voice-assistant`, muss das VOR dem Deploy als Owner-Entscheidung geklaert werden (kein
> Code-Fix in dieser Phase, siehe Plan Teil (b)).

**Urteil aus dieser Lastrechnung, uebernommen:** KEIN BLOCKER. Faktor 12 Kopffreiheit
(120 Anfragen gegen Schwelle 1440), strukturell unveraendert durch KV-P3.

## Die vier Pflicht-Abnahmen

- **KV-P3-1** (`test/kv-p3-inbound-truing.test.js`): beendeter Inbound-Call, vollstaendige
  Belege -> `candidates=1`, `costTruedAt` gesetzt, `actualCostMicroCents=3731030`, Delta
  −9 ct gebucht. GRUEN.
- **KV-P3-2**: zweiter Sweep ueber denselben Inbound-Call -> `candidates=0`, `costCents`
  unveraendert, `costCorrectionMicroCentsRem` bit-gleich, keine zweite Schreibung. GRUEN.
- **KV-P3-3**: Inbound-Call ohne `estimatedCostCents` -> `costTruedSource='no_estimate'`,
  `measured=0`, `noEstimate=1`, `costCents` unveraendert, kein Wurf, `costTruedAt` trotzdem
  gesetzt. GRUEN.
- **KV-P3-4/5** (im `mutationProbeResult` referenziert, Teil derselben Testdatei): decken die
  Kandidaten-Riegel- bzw. Buchungs-Grenzfaelle ab, die die drei Mutationsproben unten
  falsifizieren.

Zusaetzlich Bestandstest `cost-truing-booking.test.js` Fall „(a)" unveraendert gruen geblieben
(nutzt lokalen `makeDueOutboundCall`, outbound-only, nicht angefasst).

## Bewegung der Deckungsquote

`costTruingCoveragePercent`-Formel ist byte-identisch — einzig die Filterquelle wechselt von
`isEndedOutbound` auf `isEndedCall`. **Das ist KV-M3, nicht diese Phase**: die Formel selbst
bleibt unveraendert, nur der Nenner oeffnet sich fuer beide Richtungen.

Kurzfristige Bewegung: die Quote sinkt, weil der unabgeglichene Inbound-Bestand neu in den
Nenner faellt. Nach 1-2 Sweeps steigt sie wieder, sofern die Zuordnung greift (belegt an
KV-M1). Ob der Nenner insgesamt zu weit bleibt (N4), ist ausdruecklich KV-M3 vorbehalten und
hier nicht geloest.

## Mutationsproben

Drei Proben, je einzeln gesetzt, getestet, zurueckgenommen:

1. Richtungsfilter in `isEndedCall` wieder eingesetzt -> KV-P3-1/2 UND
   `cost-truing-observe.test.js` „(i)" wurden rot.
2. `costTruedAt`-Riegel in `isTruingCandidate` entfernt -> NUR KV-P3-2 rot (Doppelbuchung
   sichtbar geworden).
3. `isBookableCents`-Riegel in `bookCorrectionFor` entfernt -> NUR KV-P3-3 rot.

Finaler Diff traegt keine Mutation (`node --check` + `node --test` nach Rueckname bestaetigt).

## Angepasste Bestandstests (mit Begruendung)

Einzige Anpassung: `cost-truing-observe.test.js`, Fall „(i)".

- Alte Zusage: 3 von 4 beendeten OUTBOUND-Calls -> 75 %, Inbound zaehlt in keiner Achse.
- Neue Zusage: 4 von 5 beendeten Calls BEIDER Richtungen -> 80 %, Inbound zaehlt jetzt mit.
- Begruendung: KV-P3 oeffnet den Nenner bewusst laut Plan-Vorgabe; laufende (nicht beendete)
  Calls zaehlen weiterhin nie — das bleibt unveraendert gepinnt.

## Safety-Urteil

Freigegeben. Diff beschraenkt auf `cost-truing.js` (Richtungsfilter weg, Rename), Preistext,
Tests, zwei Docs. Selbst nachgerechnet: Doppelkorrektur unmoeglich (`costTruedAt` persistiert
in state-ops/pg/json; nur EIN produktiver Aufrufer von `applyCostCorrectionCents`; beide
Sweep-Trigger teilen `sweepRunning`). Adapter kennt `direction` nicht (0 Treffer), Anker bleibt
`call_control_id`. Last-Waechter 1440 vs. Obergrenze 6x10x2x1=120 Anfragen, kandidatenunabhaengig.
`voice.js`/Store/Telephony unberuehrt. Mutationsprobe: Filter zurueck -> Tests rot.

Concerns (keine Blocker, im Safety-Review benannt):

- **Since-Kopplung, neu ausgeloest (nicht im Diff selbst):** der aelteste Inbound-Kandidat
  (bis `RETENTION_DAYS=30`) kann `poolSinceFor` weiter zurueckziehen; tiefere Paginierung kann
  `MAX_PAGES_PER_RECORD_TYPE` reissen -> `complete:false` -> `bookablePool ok:false` -> ALLE
  Kandidaten des Sweeps (auch Outbound) werden `unavailable`.
- Selbstheilend, aber mit Preis: der Backlog schliesst nach hoechstens `COST_TRUING_MAX_ATTEMPTS`
  (5) Sweeps (Takt 1 h); Outbound-Calls, die in diesem Fenster faellig werden, koennen ihre 5
  Versuche verbrennen und dauerhaft `failed` bleiben — ihre Ueberschaetzung stuende dann fest.
- Die Lastrechnung (Abschnitt 6) rechnet die Vollstaendigkeitsgrenze gegen ein STUNDENfenster
  (100 Gespraeche/h). Der durch KV-P3 neu moegliche Fall ist ein 30-Tage-Fenster (die
  `RETENTION_DAYS`-Reichweite des aeltesten Inbound-Kandidaten) — die Beruhigung dort gilt
  fuer die falsche Fenstergroesse.
- Der Betriebsbefund zu `COST_TRUING_REQUIRED_RECORD_TYPES` bleibt ungelesen (siehe unten).
- Deckungsquote sinkt kurzfristig -> mehr `coverage_below_threshold`-WARN. Selbst geprueft:
  `boot.js`/`boot-guard.js` behandeln das als WARN, kein `exit(1)`, kein Boot-Refusal, kein
  Geld-Gate liest die Quote.

Unabhaengiger Testlauf: `npm test` selbst gefahren, EXIT=0, 3844 Tests / 3844 pass / 0 fail
(korrigiert 3824/3824 nach Abzug von 20 Datei-Wrappern). Alle 5 KV-P3-Tests liefen im
Regressionslauf mit. Fokuslauf ueber 7 cost-truing/credit-Dateien: 73/73 gruen.

## Clean-Code-Audit

PASS. Keine S1/S2/S3/S4-Funde. Diff sauber: Rename korrekt (N2), toter Code entfernt (G9),
Kommentare mitgezogen (C2), eine Quelle fuer Kandidat+Nenner (G5), Ganzzahl-Cent-Arithmetik
durchgaengig (G26), unterscheidbare Fixture-Werte, ein Konzept je Test (P14), Grenzfaelle
abgedeckt (T5). Deutsche Kommentare ohne Umlaute, wie im Bestand. 66 gezielte Tests gruen.

## Fix-Runden inkl. Fehlalarme

Keine Fix-Runde noetig — Impl kam beim ersten Durchlauf durch beide Reviews (Safety approved,
Clean-Code PASS). Einziger dokumentierter Abbruch war operativ, kein Code-Fund: der
`test:gates`-Lauf haengt reproduzierbar am bereits bekannten Bestandsdefekt
`test/auth-p9a-cache-headers.test.js` unter `--test-name-pattern` (in CLAUDE.md als bekannt
benannt, nicht Aufgabe dieser Phase) — der Lauf wurde abgebrochen (`kill -9`); `npm test` und
die KV-P3-Tests isoliert liefen davon unberuehrt vollstaendig gruen. Kein Fehlalarm im engeren
Sinn — der abgebrochene Lauf betrifft eine andere, bereits dokumentierte Baustelle.

## Was diese Phase NICHT tut

- Sie aendert die Formel der Deckungsquote nicht (das ist KV-M3).
- Sie loest den Periodengrenzen-Riegel nicht auf und aendert sein Verhalten nicht (KS-P5,
  bewusst bestehend).
- Sie tastet den Telnyx-Adapter, die Voice-Route, den Store oder den Credit-Guard nicht an
  (0 diff in allen vieren).
- Sie klaert nicht, ob `COST_TRUING_REQUIRED_RECORD_TYPES` live `ai-voice-assistant` enthaelt —
  das ist eine Betriebspruefung vor dem Deploy, keine Code-Aenderung dieser Phase.
- Sie senkt oder hebt `SWEEP_REQUESTS_WARN_THRESHOLD` nicht.
- Sie fuehrt keine Live-Verifikation am echten KV-M1-Anruf durch — das steht noch aus.

## Was der Lead nach dem Deploy verifizieren muss

1. **Vor dem Deploy:** den Live-Wert von `COST_TRUING_REQUIRED_RECORD_TYPES` im
   Render-Dashboard von Hand pruefen. Enthaelt er `ai-voice-assistant`, muss das VOR dem Deploy
   als Owner-Entscheidung geklaert werden — sonst bleibt jeder Inbound-Call dauerhaft
   `incomplete` und bekommt nie eine Gutschrift.
2. **Die Live-Abnahme dieser Phase:** der KV-M1-Anruf (`call_msczw0irl06s`) muss sich nach
   `COST_TRUING_DELAY_MINUTES` (30 min) plus einem Sweep-Takt (`COST_TRUING_SWEEP_INTERVAL_MS`,
   1 h) — also nach rund 1,5 h — im Produktions-Log als korrigiert nachweisen lassen
   (`korrektur call=call_msczw0irl06s ...gebucht=true` bzw. der entsprechende
   `costTruedSource`-Eintrag). Das ist die einzige echte Bestaetigung, dass der Ist-Abgleich
   fuer Inbound in Produktion tatsaechlich greift — die Testsuite kann nur den Code, nicht den
   Produktionslauf belegen.
3. Zwischen Buchung und Korrektur liegt genau dieses Fenster (`COST_TRUING_DELAY_MINUTES` +
   ein Sweep-Takt), in dem das Gate ausschliesslich die Schaetzung sieht (TOD 4) — das ist
   erwartetes Verhalten, kein Defekt, sofern die Korrektur danach sichtbar wird.
4. Die historischen Inbound-Calls ohne Schaetzung (vor KV-P2) bleiben dauerhaft in
   `no_estimate` — das ist erwartet, keine Regression.
5. `vollstaendig=` in der Sweep-Zeile (`logSweepLine`) beobachten. Kippt es auf `false`, ist
   die Gegenmassnahme das schmalere Zeitfenster (`POOL_SINCE_MARGIN_MS` bzw. haeufigerer
   Sweep-Takt) — nicht mehr Seiten und nicht eine hoehere Schwelle.
