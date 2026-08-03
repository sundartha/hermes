# KV-P3 - Lastrechnung des Sweeps (Pre-Mortem TOD 5), Vorbedingung des Merges

Stand 2026-08-03, gerechnet gegen den Code auf `master` (Basis `b112db2`). Jede
Eingangsgroesse unten ist am Quelltext belegt (Datei + Symbol).

## 1. Die Schwelle

`SWEEP_REQUESTS_WARN_THRESHOLD = 1440` in `src/billing/cost-truing.js`. Gemeldet ueber
`reportFetchVolume`, Vergleich strikt: `if (fetchTally.requests <= SWEEP_REQUESTS_WARN_THRESHOLD) return;`
- die Schwelle reisst erst bei **1441** Anfragen in einem einzigen Sweep.

Datenquelle ist `fetchTally.requests`, aufsummiert in `addPoolFetchStats` aus
`poolFetchStats(pool).requests` = `poolRun.requests` des Telnyx-Adapters. Gezaehlt wird die
ABGESETZTE Anfrage (in `attemptCostRecordPage`, nach der Drossel-Reservierung, vor dem
`fetch`) - ein HTTP-200 und ein HTTP-429 zaehlen gleich.

## 2. Anfragen je Kandidat - die benannte, begruendete Annahme

> Annahme A: Ein zusaetzlicher Kandidat erzeugt NULL zusaetzliche Provider-Anfragen.

Begruendung am Code, drei Glieder:

1. `fetchCostRecordPools(retrievable, controls)` iteriert ueber die Kandidaten, setzt aber
   je Provider genau EINEN Abruf ab: `for (const call of retrievable) { if (pools.has(call.provider)) continue; ... }`.
2. Der Abruf selbst ist schleifeninvariant: `fetchCostRecordPool` (bzw. der Adapter dahinter)
   kennt nur `filter[record_type]`, `page[size]`, `page[number]` - KEIN `legId`, keine
   Call-Referenz. Der Pool ist konto-weit.
3. Die Zuordnung je Call (`assignCostRecords`, aufgerufen aus `trueOneCall`) ist synchron und
   netzfrei - sie liest den bereits abgerufenen Pool, sie ruft nicht erneut den Provider.

Die einzige Kante, ueber die ein Kandidat den Abrufumfang ueberhaupt beeinflusst, ist
`poolSinceFor(retrievable)`: der AELTESTE Kandidat setzt `since = aeltestes endedAt minus
POOL_SINCE_MARGIN_MS`. Ein frueheres `since` laesst die Seitenschleife (`isPageBeforeSince`)
tiefer blaettern - hart gedeckelt bei `MAX_PAGES_PER_RECORD_TYPE` (s. Abschnitt 3).

## 3. Die Obergrenze eines Sweeps, aus dem Code hergeleitet

| Faktor | Symbol / Datei | Wert (am Code geprueft) |
|---|---|---|
| Belegtypen je Pool | `ASSIGNABLE_COST_RECORD_TYPES` (`telnyx/voice.js`) = `COST_RECORD_TYPES` (7 Eintraege) minus `UNASSIGNABLE_COST_RECORD_TYPES` (nur `inference`) | 6 |
| Seiten je Typ | `MAX_PAGES_PER_RECORD_TYPE` | 10 |
| Versuche je Seite | `fetchCostRecordPage`: 1 Versuch + hoechstens 1 Wiederholung nach HTTP 429 (`RATE_LIMITED_STATUS`), danach fail-closed `ok:false` | 2 |
| Pools je Sweep | ein Pool je distinktem belegfaehigem Provider unter den abrufbaren Kandidaten (`fetchCostRecordPools`) | P |

`Anfragen <= 6 * 10 * 2 * P = 120 * P`

**P heute = 1.** `costRecordControlFor` liefert `null`, wenn der Adapter nicht BEIDE Methoden
(`fetchCostRecordPool`, `assignCostRecords`) traegt; Twilio hat sie nicht. Twilio-Calls fallen
ueber `isRetrievable` heraus, loesen nie einen Pool aus und erscheinen als `uebersprungen=`.
Belegfaehig ist ausschliesslich Telnyx.

> Obergrenze eines Sweeps heute: 120 Anfragen. Schwelle: 1440. Kopffreiheit: Faktor 12.

## 4. Ab wie vielen Anrufen reisst die Schwelle?

Bei KEINER Anzahl. Die Kandidatenzahl steht in der Formel oben nicht - sie bestimmt weder P
noch die Faktoren 6/10/2. Formal reisst die Schwelle erst bei

`120 * P > 1440` -> `P >= 13`

also erst mit dem 13. gleichzeitig belegfaehigen Telefonie-Provider im selben Sweep. Es gibt
heute genau einen (Telnyx).

Die realistische Betriebszahl liegt weit darunter: die Seitenschleife (`fetchRecordTypePages`)
endet, sobald `page.lastPage` oder `isPageBeforeSince` greift - beide lange vor der
Seitenobergrenze, solange die Kandidaten juenger als ein paar Stunden sind
(`test/cost-truing-since.test.js`, `(P5-4)`: ein 3 h alter Kandidat braucht nur eine Anfrage
je Typ, also 6 Anfragen je Sweep).

## 5. Der Zuwachs durch KV-P3, ehrlich beziffert

- **Provider-Anfragen: +0.** Die Belege eines Inbound-Calls liegen im konto-weiten Pool
  BEREITS HEUTE - sie werden nur nie zugeordnet, weil der Kandidatenfilter (`isTruingCandidate`)
  bisher auf `direction === "outbound"` gefiltert hat. KV-P3 ordnet vorhandene Belege zu, es
  holt keine neuen. Die Formel aus Abschnitt 3 haengt an Belegtypen, Seiten, Versuchen und
  Providern - an keiner Stelle an der Kandidatenzahl.
- **`since` kann frueher rutschen**, wenn der aelteste beendete Inbound-Call aelter ist als der
  aelteste beendete Outbound-Call. Effekt: mehr Seiten je Typ, gedeckelt bei
  `MAX_PAGES_PER_RECORD_TYPE` (10) - hoechstens von 6 auf 120 Anfragen im ungluecklichsten
  Fall. Weiterhin Faktor 12 unter der Schwelle.
- **CPU statt Netz:** `trueOneCall` laeuft je Kandidat einmal ueber den abgerufenen Pool
  (`pool.raw`, max. 6 * 10 * 50 = 3000 Rohbelege). Bei N Kandidaten sind das 3000 * N
  synchrone Vergleiche; bei N = 200 rund 600.000 - Millisekunden, keine Netz-Last, kein
  Kontingent. Kein Blocker, aber die Groesse, die als erste mit KV-P3 waechst (die
  Kandidatenmenge verdoppelt sich strukturell, sobald Inbound mitzaehlt).

## 6. Die reale Grenze liegt woanders - und sie ist fail-closed

Nicht die Anfragezahl, sondern die VOLLSTAENDIGKEIT des Pools ist die bindende Grenze.
Erreicht ein Typ die Seitenobergrenze, liefert `fetchRecordTypePages` `complete:false`,
`bookablePool` uebersetzt das in `ok:false`, und ALLE Kandidaten des Sweeps werden
`unavailable` - keine Rueckerstattung, fuer niemanden (testgepinnt:
`test/cost-truing-pool.test.js`, `(P3-3)`). Das ist die fail-CLOSED-Richtung: es geht kein
Geld verloren, der Abgleich verzoegert sich, der Versuchszaehler steigt.

Groessenordnung: 10 Seiten x 50 Belege = 500 Belege JE TYP im `since`-Fenster. KV-M1 misst 5
`speech-to-text`-Belege je 80-s-Gespraech -> rund 100 Gespraeche pro Stunde waeren noetig, um
diese Grenze im Stundentakt zu reissen. Das ist eine Wachstums-Alarmschwelle, kein heutiger
Zustand - und der Bruchpunkt-Waechter (`reportFetchVolume`) meldet sie NICHT (er zaehlt
Anfragen, nicht Vollstaendigkeit), wohl aber die Sweep-Zeile mit `vollstaendig=false`.

## 7. Urteil

**KEIN BLOCKER.** Der Bruchpunkt-Waechter reisst bei realistischem Betrieb nicht, weil KV-P3
die Anfragezahl STRUKTURELL NICHT erhoeht: der Belegabruf haengt am Provider und am
Zeitfenster, nicht an der Kandidatenzahl. Die Obergrenze eines Sweeps bleibt 120 Anfragen
gegen eine Schwelle von 1440 - Faktor 12 Kopffreiheit, unveraendert durch diese Phase.

**Zu beobachten (kein Merge-Blocker):** `vollstaendig=` in der Sweep-Zeile
(`logSweepLine`). Kippt es auf `false`, ist die Gegenmassnahme das schmalere Zeitfenster
(engeres `since`, `POOL_SINCE_MARGIN_MS` bzw. haeufigerer Sweep-Takt) - nicht mehr Seiten und
nicht eine hoehere Schwelle. Die Schwelle selbst wird nie gesenkt oder angehoben, um ein
beobachtetes Verhalten zu erfuellen (dieselbe Regel wie bei `costTruingMinCoveragePercent`).

## 8. Betriebspruefung (ausserhalb des Codes, vor dem Deploy)

`refundProven` (cost-truing.js) verlangt, dass JEDER Typ aus
`COST_TRUING_REQUIRED_RECORD_TYPES` unter den zugeordneten Belegen eines Calls vorkommt, bevor
eine negative Korrektur gebucht wird. KV-M1 hat fuer den Inbound-Anker gemessen: `sip-trunking`
1, `call-control` 1, `speech-to-text` 5, `text-to-speech` 5, `recording` 1,
`ai-voice-assistant` 0. Steht `ai-voice-assistant` in der LIVE gesetzten Pflicht-Menge, landet
jeder Inbound-Call dauerhaft auf `incomplete` und bekommt NIE eine Gutschrift.

**Versuch, den Live-Wert zu lesen (dieser Bericht):** `.env.example` und `render.yaml` fuehren
`COST_TRUING_REQUIRED_RECORD_TYPES` LEER - leer waere `REQUIRED_TYPES_EMPTY` (FATAL,
`boot-guard.js`), der Dienst bootet also mit einem anderen, dashboard-gesetzten Wert. Ein
Render-Werkzeug zum LESEN von Env-Variablen existiert nicht (nur Schreiben). Der seit KV-M0
vorgesehene Boot-Banner-Weg (`costTruingTypesBannerLine`, Zeile
"Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=...") ist in den PRODUKTIONS-Logs der
letzten 7 Tage NICHT aufgetaucht - der aktuell deployte Commit auf `vodafone-agent`
(`srv-d8m0fhflk1mc73bno570`) liegt vor KV-M0 (45 Commits hinter `master`/`b112db2`).

Indirekter Hinweis aus den Produktions-Logs: ein Sweep hat dort real eine NEGATIVE Korrektur
gebucht (`korrektur call=... delta_eur_cent=-104 gebucht=true`, 2026-08-03), was `dataComplete
=== true` voraussetzt (`applyCostCorrectionCents`). Der aktuell deployte Code kennt noch keinen
Richtungsfilter-Fall fuer Inbound (er ist vor KV-P2), der abgeglichene Call war also ein
OUTBOUND-Call. Waere `ai-voice-assistant` (laut Code nur ueber den Assistant-Pfad erreichbar,
`TELNYX_AI_ASSISTANT_ENABLED`) in der Pflicht-Menge, koennte ein Outbound-Call - der nie durch
den Assistant-Pfad laeuft - diesen Typ strukturell nie zeigen und niemals `complete` werden.
Dass dieser Outbound-Call `complete` wurde, ist ein INDIZ (kein Beweis), dass
`ai-voice-assistant` heute NICHT in der Pflicht-Menge steht.

**Offener Befund, in den Bericht:** der Live-Wert von `COST_TRUING_REQUIRED_RECORD_TYPES`
konnte NICHT direkt gelesen werden (kein Lesetool, KV-M0-Banner noch nicht deployt). Vor dem
Deploy dieser Phase ist der Wert im Render-Dashboard von Hand zu pruefen; enthaelt er
`ai-voice-assistant`, muss das VOR dem Deploy als Owner-Entscheidung geklaert werden (kein
Code-Fix in dieser Phase, siehe Plan Teil (b)).
