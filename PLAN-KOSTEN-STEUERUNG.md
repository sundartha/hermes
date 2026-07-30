# PLAN-KOSTEN-STEUERUNG

Der Owner erlebt heute Folgendes: er beauftragt Hermes, einen Anruf zu fuehren, und bekommt
`402 - "es fehlen -4.77 EUR"` zurueck. Ein Fehlbetrag mit **negativem** Vorzeichen; die Meldung
widerspricht ihrer eigenen Entscheidung. Gleichzeitig darf kein Gespraech laenger als drei
Minuten dauern, und das Dashboard zeigt einen Budget-Rest, den das Gate nicht kennt.

Die Untersuchung am 2026-07-29 hat gezeigt: der groesste Teil davon sind nicht eigenstaendige
Fehler, sondern **Kompensationen fuer eine fehlende Groesse** — die Kostensteuerung besitzt
keinen laufenden Messwert der **Carrier-Minuten**. Sie weiss vor dem Anruf, was er hoechstens
kosten *koennte*, und nach dem Anruf, was er gekostet *hat*. Waehrend er laeuft, misst sie auf
dieser Achse nichts.

Die Wurzel traegt **B1 und B2** — nicht alle fuenf Befunde. **B4 und B5 sind eigenstaendige
Defekte** (Achsen-Divergenz zwischen Anzeige und Gate, Gutschrift-Asymmetrie), die auch nach
einer perfekten Live-Messung weiterbestehen. Das ist eine Korrektur an der urspruenglichen
Fassung dieses Plans, die alle fuenf unter eine Wurzel gestellt hat.

Was daraus folgt: die harte Zeitgrenze ersetzt die fehlende Live-Messung, und der um den
Faktor 37 ueberhoehte Minutenpreis ersetzt die Gewissheit ueber die Dauer. Jede Kompensation ist
fuer sich begruendet. Zusammen machen sie das Produkt unbenutzbar.

Dieser Plan dreht die Reihenfolge um: **erst messen, dann begrenzen.**

Was dieser Plan bewusst NICHT tut: keine rollende Selbstkalibrierung des Tarifs
(Owner-Entscheidung 3 vom 2026-07-20 gilt unveraendert), keine Tarif-Tabelle je Ziel-Vorwahl
(als zu kompliziert verworfen, Owner 2026-07-29), keine Aenderung an der Denylist.

---

## Befund

Alle Zahlen sind am 2026-07-29 an der Prod-DB und den Render-Logs gemessen, nicht geschaetzt —
mit einer ausdruecklichen Ausnahme: die Herleitung in B4 reproduziert die beobachtete Meldung
nicht (s. dort).

### B1 — Der Minutenpreis ist um Faktor 37 ueberhoeht

21 Outbound-Anrufe (US-DID `+17067101188` -> `+49173…`), alle mit vollstaendigem Telnyx-Beleg:

| | |
|---|---|
| Echte Gespraechszeit | 15,5 min |
| Abgerechnet (Telnyx rundet auf 60-s-Takt) | 25 min |
| Telnyx-Ist gesamt | **2,04 EUR** |
| **Ist je angefangener Minute** | **8,18 EUR-Cent** (Spanne 3,89 – 9,23) |
| Reserviert wird (`voiceTariffDefaultCents`) | **300 ct/min** |

Der Inlandssatz (20 ct/min) greift nicht, weil `isDomesticLeg` **dieselbe** Vorwahl an Ziel UND
Absender verlangt — die DID ist US, das Ziel DE. Nicht die Kosten sind gestiegen, nur die
Annahme darueber. In den Daten ist der Moment sichtbar, an dem die Herkunfts-Achse (P5/ORIG-01)
scharf wurde: dieselben Anrufe an dieselbe Nummer springen von `est_cents=20` auf `est_cents=300`
bei unveraenderten Ist-Kosten von ~8,7 ct.

Wirkung auf das Budget: **sieben Anrufe haben 12,80 EUR gebucht und 0,69 EUR gekostet.** Damit war
die 15-EUR-Decke des betroffenen Tenants erschoepft — welche Decke das genau ist, klaert B7.

### B2 — Die Zeitgrenze ist eine Produktgrenze, obwohl sie eine Notbremse sein sollte

`MAX_CALL_DURATION_S` = 180 s (Default), harte Decke `MAX_CALL_DURATION_CAP_S` = 300 s,
hartkodiert in `src/store/defaults.js:258` und bewusst kein Operator-Knopf. Die Decke klemmt
auch den API-Parameter `max_duration_s` (`resolveMaxDurationS`, `outbound-gates.js:201`).

Der 300er-Deckel steht aber an **drei** Stellen, nicht an einer — das ist der Teil, den die erste
Fassung dieses Plans uebersehen hat:

1. `MAX_CALL_DURATION_CAP_S = 300` (`src/store/defaults.js:258`) — klemmt den Body-Override.
2. `numEnv("MAX_CALL_DURATION_S", …, { fallback: 180, min: 1, max: 300 })`
   (`src/config.js:968-972`) — klemmt den **globalen Default**, und zwar **still**: der
   `max`-Zweig von `numEnv` (`src/config.js:71`) liefert kommentarlos die Obergrenze zurueck,
   ohne `fatalConfigErrors`, ohne Log. Wer `MAX_CALL_DURATION_S=600` im Render-Dashboard setzt,
   bekommt 300 und merkt es nicht.
3. `TELNYX_DEAD_AIR_TIMEOUT_S` (`src/config.js:396-400`, `max: 300` mit dem Kommentar
   "= Cap-Ceiling") — an denselben Wert gekoppelt.

Dazu kommt: `MAX_CALL_DURATION_S` ist im Blueprint **gesetzt** (`render.yaml:391-392`, Wert
`"180"`) und in `.env.example:431`. Ein geaenderter Code-Fallback allein aendert live gar nichts.

Fuer ein Produkt, das Termine vereinbart, ist das zu kurz — eine Warteschleife frisst zwei
Minuten. Der Wert ist an B1 kalibriert: `5 min x 300 ct = 15,00 EUR` waere die komplette
Default-Decke fuer **einen** Anruf gewesen.

### B3 — Die Live-Pruefung misst auf der Carrier-Achse eine Groesse, die stillsteht

`blockingBudgetAxis` (`src/budget-gate.js:12`) laeuft seit AL-P6 bei jedem Turn und fragt
`store.budgetExceeded` — den **gebuchten** Verbrauch.

Praezisierung gegenueber der ersten Fassung (die behauptete, die Zahl stehe generell still —
das ist am Code widerlegt): **die KI-Token-Achse bewegt sich sehr wohl live.** `bookTokenUsage`
laeuft in JEDER Schleifenrunde (`src/claude.js:659` und `:775`), `store.trackUsage`
(`llm-usage.js:66`) bucht ueber `bookCents` (`state-ops.js:2127`) auf genau die Achse, die
`budgetExceeded` liest; `addResearchFeeCostCents` bucht die In-Call-Recherche ebenfalls sofort.
Der Kommentar in `claude.js:548` nennt das ausdruecklich als Grund fuer AL-P6.

Was **still steht, sind die Carrier-Minuten**: `reconcileOutboundVoiceBudget`
(`billing/metering.js:68-84`) bucht erst bei Call-Ende. Auf dieser Achse greift die Pruefung nur,
wenn ein **anderer** Anruf das Budget parallel leert — und genau diese Achse ist die teure.

### B4 — Anzeige und Gate messen verschiedene Achsen

`tenantBudgetSnapshot` (`src/store/state-ops.js:2464`) liest `usageFor().costCents` — die
**Lebenszeit**-Achse. Die **zwei tenant-scope** Gate-Praedikate (`budgetExceeded`
`state-ops.js:2427`, `reserveExceedsBudget` `state-ops.js:2445`) lesen ueber `tenantSpendOrDeny`
den Wert von `gateUsageCents` (`state-ops.js:2365`) — seit dem Flip von `BUDGET_MONTH_ENABLED`
am 2026-07-25 die **Spend-Monat**-Achse. (Die zwei globalen Praedikate `globalBudgetExceeded`
`:2650` / `globalReserveExceedsBudget` `:2678` lesen die Plattform-Variante
`gatePlatformUsageCents` `:2376`, nicht dieselbe Groesse — fuer diesen Befund sind nur die
tenant-scope Praedikate relevant. Die erste Fassung schrieb hier faelschlich "alle vier".)

Der Snapshot ist die einzige Stelle des Moduls, die an der Flag-Aufloesung vorbeigreift.

Live gemessen fuer den betroffenen Tenant: **4,23 EUR Lebenszeit gegen 12,84 EUR Spend-Monat.**

**Die Herleitung des negativen Fehlbetrags reproduziert nicht** und ist deshalb hier bewusst
nicht mehr als Rechnung gefuehrt. Drei Groessen widersprechen sich: die beobachtete Meldung nennt
`-4.77 EUR`; die urspruengliche Herleitung `300 - (1500 - 423)` ergibt `-7.77 EUR`; und sie setzt
als Reserve den **Minutensatz** (300) statt der tatsaechlichen Reserve
`tariffCentsPerMin * ceil(maxDur/60)` (`outbound-gates.js:791`, bei 180 s also 900 ct), womit
dieselbe Formel `-1.77 EUR` liefern wuerde. Welche `max_duration_s`, welcher `reserveCents` und
welcher `effectiveCapCents` tatsaechlich anlagen, ist nicht mehr rekonstruierbar.

**Der Befund selbst haengt nicht an der Zahl** und ist strukturell belegt: der Fehlbetrag ist
`reserveCents - snapshot.remainingCents` (`outbound-gates.js:440`) — eine Differenz aus zwei
Groessen, die aus **verschiedenen Achsen** stammen. Solange `remainingCents` aus der
Lebenszeit-Achse kommt und die Sperrentscheidung aus der Spend-Monat-Achse, kann diese Differenz
negativ werden. Das ist der Fix in KS-P4.

Nachzutragen bei der Umsetzung: welcher der beiden Zweige von `tenantReserveDenial`
(`outbound-gates.js:434-450`) den beobachteten Text erzeugt hat — bei `remainingCents > 0` ist es
`reserve_ueber_rest`.

Derselbe Snapshot speist `/api/state` (`src/routes/api-read.js:92`) — Dashboard und
`get_agent_status` zeigen denselben falschen Rest.

### B5 — Gutschriften erreichen die Achse nicht, die das Gate steuert

`bookCostCorrectionCents` (`state-ops.js:2246`) bucht positive Korrekturen ueber `bookCents` auf
**beide** Achsen, negative nur auf `usage.costCents` (die Lebenszeit-Achse, `:2257`, mit
`Math.max(0, …)`). Begruendung im Code: sonst liesse sich die Monatsdecke durch verspaetete
Gutschriften aus einem **abgeschlossenen** Monat aufweiten.

Das Argument ist richtig, die Umsetzung ueberschiesst: sie verwirft **alle** Gutschriften, obwohl
nur die aus abgeschlossenen Monaten problematisch sind. Die gemessene Differenz von 8,61 EUR
besteht ausschliesslich aus Juli-Anrufen, die im Juli korrigiert wurden.

**Zweite Haelfte, die die erste Fassung nicht kannte:** es gibt hinter demselben Flag **zwei**
strukturell verschiedene Gate-Achsen, und die als Code-Default dokumentierte hat den
beschriebenen Schutz gar nicht. `gateUsageCents` liefert bei `BUDGET_MONTH_ENABLED=false`
`budgetPeriodUsageCents` (`state-ops.js:2340`), also `Math.max(0, costCents - baseline)` — eine
reine **Ableitung aus `costCents`**, kein eigenes Feld. Eine negative Korrektur senkt `costCents`
und damit **automatisch** das Perioden-Fenster, voellig unabhaengig davon, ob der zugrunde
liegende Anruf vor oder nach dem Perioden-Stempel lag. Der Missbrauch, den die Asymmetrie auf der
Spend-Monat-Achse verhindert, ist auf der Perioden-Achse **heute schon moeglich**, ohne jede
KS-Phase. Und `BUDGET_MONTH_ENABLED` faellt per Env-Flip ohne Deploy auf `false` zurueck.

### B6 — Der Zeit-Backstop ist ein Timer im Arbeitsspeicher (BEANTWORTET, s. KS-P1)

`scheduleMaxDurationEnd` (`src/telephony/call-lifecycle.js:96`) armiert den harten Abbruch per
`setTimeout`. Startet der Dienst mitten im Gespraech neu — auf Render Free Tier nicht exotisch —,
ist der Timer weg, waehrend der Anruf beim Provider weiterlaeuft.

Die Frage ist inzwischen am Code beantwortet: **teils ja, teils nein.** Die Antwort steht in
KS-P1; die Luecke, die uebrig bleibt, ist der Assistant-Shim und hat eine eigene Phase (KS-P1b).

### B7 — Der Plan rechnete gegen die falsche Decke

Die erste Fassung argumentierte durchgehend mit "der 15-EUR-Monatsdecke des Tenants".
1500 ct ist `DEFAULT_TENANT_BUDGET_CENTS` (`src/config.js:634`) — der **Fallback fuer Tenants
OHNE tenant_budget-Zeile**. Jeder Tenant **mit Abo** bekommt beim Aktivierungs-Webhook eine
eigene Zeile aus dem Plan geschrieben:

- `planCapCents` (`src/billing/plan-caps.js:26`): `includedMinutes * voiceCapRateCentsPerMin * num/den`
  mit `voiceCapRateCentsPerMin = 6` (`config.js:610`) und Kopffreiheit 5/3 bzw. 5/4
  -> **Starter 30 x 6 x 5/3 = 300 ct**, **Business 120 x 6 x 5/4 = 900 ct**.
- geschrieben in `deriveTenantBudgetFromPlan` (`state-ops.js:1327-1358`,
  `setTenantBudget(..., { budgetCents: capCents, hardCapCents: capCents })`), verdrahtet in
  `src/store/json.js:778` und `src/store/pg.js:499` direkt nach `setTenantSubscription`.
- `effectiveCapCents` (`state-ops.js:2311`) **bevorzugt diese Zeile**: `if (budget) return
  budget.hardCapCents;` — sie schlaegt `defaultTenantBudgetCents`.

Damit gilt fuer jeden zahlenden Kunden eine Decke von **300 bzw. 900 ct**, nicht 1500. Das
aendert die Rechnung von KS-P0 und KS-P3 grundlegend:

| | Starter (300 ct) | Business (900 ct) | ohne Abo (1500 ct) |
|---|---|---|---|
| buchbare Minuten bei 30 ct/min | **10** | **30** | 50 |
| verkaufte inkludierte Minuten | 30 | 120 | — |
| Reserve eines 600-s-Anrufs (30 ct/min) | 300 ct = **exakt die Decke** | 300 ct | 300 ct |
| Reserve eines 1800-s-Anrufs (30 ct/min) | 900 ct = **3x Decke** | 900 ct = **exakt die Decke** | 900 ct |

Ein Starter-Kunde waere nach einem Drittel seiner bezahlten Minuten hart gesperrt: Outbound 402,
Inbound abgewiesen (`routes/voice.js:256`), laufender Call aufgelegt. Und weil
`reserveExceedsBudget` mit `>` vergleicht (`state-ops.js:2448`), macht bei einem 600-s-Anruf
**ein einziger bereits gebuchter Cent** — ein KI-Turn genuegt — aus `1 + 300 > 300` ein 402.

**Kein Boot-Guard sieht das.** `spendCapCoherence` Klausel B (`boot-guard.js:157-172`, FATAL)
ist genau die Pruefung "Worst-Case-Reserve passt unter die Tenant-Decke" — aber `boot.js:85-91`
uebergibt ihr ausschliesslich `config.billing.defaultTenantBudgetCents`. Die Plan-Decken werden
von `planCapInertFindings` (`boot-guard.js:296-311`) nur gegen den **Plattform**-Cap geprueft
(`if (cap >= platformCapCents)`), nie gegen die Worst-Case-Reserve. Der Dienst bootet gruen,
waehrend genau die zahlenden Tenants am Reserve-Gate haengen.

---

## Die gemeinsame Wurzel — und was NICHT dazugehoert

```
                        vor dem Anruf          waehrend                nach dem Anruf
   Carrier-Minuten:     Worst Case             ▓▓▓ NICHTS ▓▓▓          Ist-Kosten
                        (Tarif × Maxdauer)                             (Cost-Truing)
   KI-Token:            —                      laufend gebucht         —

   kompensiert durch:   ueberhoehter Tarif     harte Zeitgrenze
                        (B1)                   (B2)
```

Sobald der mittlere Kasten der **Carrier-Achse** gefuellt ist, verlieren zwei Kompensationen ihre
Begruendung:

- der Tarif muss nicht mehr die Dauer-Unsicherheit abdecken -> **B1 loesbar**
- die Zeitgrenze muss keine Kosten mehr begrenzen -> **B2 wird Notbremse**

**Nicht** an dieser Wurzel haengen:

- **B4** (Anzeige liest Lebenszeit, Gate liest Spend-Monat) — eine Achsen-Divergenz, die auch
  bei perfekter Live-Messung bestehen bliebe.
- **B5** (Gutschrift-Asymmetrie plus der ungeschuetzte Perioden-Zweig) — eine eigene
  Buchungsregel.
- **B7** (Plan-Decke vs. Default-Decke) — eine Kalibrierung, die von der Messung unberuehrt ist.

Die Reihenfolge der Phasen richtet sich deshalb nicht nur nach der Wurzel, sondern zusaetzlich
nach harten technischen Abhaengigkeiten (Boot-Guard, s. unten).

---

## Phasen

Reihenfolge ist load-bearing — und sie hat sich gegenueber der ersten Fassung geaendert:
**KS-P6 steht jetzt VOR KS-P3**, weil ein gemergtes KS-P3 mit dem noch auf 300 stehenden
Tarif-Fallback den Boot-Guard `spendCapCoherence` fatal ausloest und `process.exit(1)` erzwingt
(empirisch nachgerechnet, s. KS-P3). Neu eingezogen sind KS-P1b (Shim-Reattach) und KS-P3a
(Plan-Decken-Kohaerenz) — beide sind Vorbedingungen von KS-P3.

Nach den Owner-Entscheidungen vom 2026-07-29 kamen drei Aenderungen dazu: der **Starter-Bug
(E5) wird vorgezogen** und laeuft als erste Code-Phase; **KS-P7** (Sperrliste) ist neue
Vorbedingung von KS-P3, weil die Kostenluecke bei teuren Zielen ueber die Liste geloest wird und
nicht ueber die Uhr; **KS-P8** (Prozent statt Euro fuer den Nutzer) kommt ans Ende.

**Ausfuehrungsreihenfolge:**

```
KS-P0  (erledigt, Env)
KS-P1  (erledigt, Messung)
   |
KS-P9  Plattform-Achse: Gate -> Beobachtung   <- E10, ERLEDIGT (Merge 5667589)
KS-P5a Starter-Bug            <- E5, ERLEDIGT (Merge 00d480c)
KS-P10 Inbound-Sperre         <- ZURUECKGEZOGEN, nicht bauen (E11 zurueckgezogen)
KS-P6  Tarif-Fallback         <- Vorbedingung von KS-P3 (sonst Boot-Refusal)
KS-P2  Live-Verbrauch         <- die Wurzelbehebung
KS-P4  Anzeige an Gate-Achse  <- macht die Ablehnungsmeldung ehrlich
KS-P5  Gutschriften
KS-P1b Shim-Reattach          -+
KS-P3a Plan-Decken-Kohaerenz   +- Vorbedingungen von KS-P3
KS-P7  Sperrliste erweitern   -+   (Schutz VOR Lockerung)
KS-P3  (a) Reserve entkoppeln, (b) Zeitgrenze wird Notbremse
KS-P8  Prozent statt Euro     <- E4, ERLEDIGT (Merge <sha>)
```

**Nachtrag 2026-07-30 — warum KS-P9 vor KS-P5a steht.** Der erste KS-P5a-Lauf ist daran
gescheitert, dass die aus EINEM Satz abgeleitete Business-Decke (4500 ct) den Plattform-Cap
(3000 ct) uebersteigt und der Boot-Guard `PLAN_CAP_INERT` das fatal meldet. Der Plan-Agent wollte
den Guard von FATAL auf WARN senken; der Safety-Review hat das zu Recht gestoppt. Die Wurzel liegt
eine Ebene tiefer: der Plattform-Cap steht mit 3000 ct **unter** dem, was ein einziger Business-
Kunde vertraglich kauft (120 min x 30 ct = 3600 ct). Ein Notaus, der unter dem Normalbetrieb
liegt, ist eine Produktgrenze — genau das Muster aus B2. E10 loest das an der Wurzel, statt die
Zahl nachzuziehen.

Dazu eine **Aufraeum-Phase** ohne Review-Zeremonie: Spike-Schalter aus master, Render-Dienst
`hermes-spike-al-p2`, Telnyx-App `3014656686179747728`.

`KS-P5a` traegt bewusst keine eigene Nummer am Kettenende: er ist ein **Bestandsdefekt**, kein
Baustein dieses Umbaus, und wird nur deshalb hier gefuehrt, weil er dieselbe Rechenkante
beruehrt.

### KS-P0 — Minutenpreis auf die Realitaet (OWNER, kein Code)

`VOICE_TARIFF_DEFAULT_CENTS=30` im Render-Dashboard. 3,7x der gemessenen Ist-Kosten; deckt auch
Ziele ab, die teurer sind als DE.

**Korrektur zur ersten Fassung:** der Satz "liegt komfortabel ueber dem Vollkosten-Boot-Guard"
ist falsch und wird gestrichen. `voiceTariffFloorFindings` (`boot-guard.js:209`) bekommt in
`boot.js:196-197` ausschliesslich `voiceTariffDomesticCents` herein — der Guard prueft
**VOICE_TARIFF_DOMESTIC_CENTS, nie VOICE_TARIFF_DEFAULT_CENTS**. Fuer den Wert, den diese Phase
aendert, existiert im gesamten Code **keine Untergrenze**: `numEnv` laesst `min: 0` zu
(`config.js:580-583`), `spendCapCoherence` prueft nur nach oben. Wer diese Senkung abgesichert
haben will, braucht dafuer eine eigene Aufgabe (Untergrenze fuer den Worst-Case-Tarif analog
`voiceTariffFloorFindings`) — sie ist NICHT Teil dieser Phase.

**Erwartetes Ergebnis:** Reserve fuer einen 3-Minuten-Anruf faellt von 9,00 auf 0,90 EUR.
**Verifikation:** naechster Outbound; `estimated_cost_cents` in der `call`-Zeile ist 30 statt 300.
**Was diese Phase NICHT tut:** sie aendert keine Kundenpreise. `reportMeter`
(`src/billing/stripe.js:234-243`) sendet ausschliesslich `payload[value]=quantity`; der
Tarif-Cent-Wert erreicht Stripe nie.
**Was diese Phase NICHT loest:** den Starter-/Business-Fall aus B7 (10 von 30 bzw. 30 von 120
Minuten buchbar). Das ist KS-P3a.
**Risiko:** der 300er-Satz war laut Code-Kommentar der Hauptschutz gegen teure Weltziele
(`ALLOWED_COUNTRY_CODES="*"`). Die erste Fassung hat dieses Risiko beschoenigt; der korrekte
Wortlaut steht in E2 unten. `src/telephony/number-denylist.js:12-17` sagt ueber sich selbst:
"BEWUSST unvollstaendig … ist sie Beifang, **NICHT der Hauptschutz** (Hauptschutz = Kosten-Achse/
Pre-Auth)". Die Liste enthaelt strikt Sub-Ranges, **nie ganze Laendercodes** (Ausnahme: 9
karibische NANP-Vorwahlen). Konkret: `+53` (Kuba — das Szenario aus TOD 1) ist **nicht**
gelistet, ebenso wenig `+252`, `+509`, `+675`. Gewoehnliche Teilnehmernummern teurer Laender
passieren die Denylist vollstaendig. KS-P0 tauscht also den erklaerten Hauptschutz gegen den
erklaerten Beifang.

### KS-P1 — Verhalten des Zeit-Backstops beim Neustart (ERLEDIGT, Erkenntnis)

**Antwort: JA fuer den TeXML-Pfad und fuer alle beim Boot hydrierten Calls; NEIN fuer einen
Assistant-Call, dessen Zeile erst nach `hydrate()` der neuen Instanz entstand.**

Belegt:

- **Boot-Re-Arm existiert.** `rearmActiveCallTimers` (`call-lifecycle.js:142-163`) laeuft in
  `boot.js:563`, iteriert `store.load().calls.filter(status === "active")`, klassifiziert die
  Restzeit ueber `classifyCallTime` und armiert `scheduleMaxDurationEnd` **relativ zum echten
  Call-Start**, nie zur Boot-Zeit. Zombies (Restzeit <= 0) werden sofort ueber den einen
  Terminalisierungspfad beendet. Einschraenkung: `if (config.voice.voiceEngine ===
  VOICE_ENGINE.REALTIME) return;` — nur Budget-Engine, was dem Live-Zustand entspricht.
- **Re-Attach existiert** fuer alle drei `/voice/*`-Handler (`routes/voice.js:330`, `:398`,
  `:454`) ueber denselben Kern (`telephony/reattach.js:49-67`), inkl. Restzeit-Pruefung und
  Cap-Rearm. Auch der Call-Control-Ingest hat ihn (`telnyx-call-control-ingest.js:289`,
  `resolveActiveCall`).
- **Der Assistant-Shim hat ihn NICHT.** `src/telnyx-llm-shim.js:435-439`:
  `const call = store.getCallByControlId(ccid); if (!call || call.status !== "active") {
  logShimGate({ reason: "call_unresolved" … }); return res.status(HTTP_FORBIDDEN).end(); }` —
  kein `reattachActiveCall`. Ein Shim-Turn auf einer Instanz, die den Call nicht im Spiegel hat,
  wird mit 403 verworfen, ohne dass irgendetwas re-attached oder ein Cap-Timer armiert wird.
  Das ist exakt dieselbe Bugklasse, die F12-S1-1 an `/voice/status` geschlossen hat.
- **Der Provider-Cap ist KEIN unabhaengiger aeusserer Deckel.** `timeLimit` ist unser eigener
  `ctx.maxDur` (`routes/api-calls.js:237`); der Telnyx-Adapter setzt ihn als `TimeLimit`
  (`adapters/telnyx/voice.js:673`) bzw. `time_limit_secs` (`:733`) und dokumentiert an beiden
  Stellen ausdruecklich, dass die **Honorierung unbestaetigt** ist. Er waechst also mit jeder
  Erhoehung der Zeitgrenze mit, statt sie zu begrenzen.

**Abbruchkriterium (fehlte in der ersten Fassung):** Solange die Shim-Luecke offen ist, darf
KS-P3 nicht laufen. Deshalb KS-P1b.

### KS-P9 — Plattform-Achse verliert die Sperrwirkung (NEU, E10, Vorbedingung von KS-P5a)

**Owner-Entscheidung 2026-07-30.** `MAX_BUDGET_EUR` hoert auf, ein Gate zu sein, und wird zur
Beobachtungsgroesse: weiterhin gemessen, weiterhin mit Schwellenwarnung
(`PLATFORM_SPEND_WARN_PERCENT`, existiert bereits), aber ohne Sperrentscheidung.

**Begruendung.** Ein statischer, ueber alle Tenants geteilter Geldtopf kann zwei Zustaende nicht
auseinanderhalten, die fuer ihn identisch aussehen: *wir wachsen* und *etwas ist kaputt*. Beide
erhoehen die Summe. Ein Schwellwert, der das nicht unterscheidet, blockiert entweder das Geschaeft
oder verpasst den Weglauf — beides ist nicht reparierbar, indem man die Zahl anders waehlt. Dazu
kommt die Betriebslast: der Wert muesste bei jedem Wachstumsschritt von Hand im Render-Dashboard
nachgezogen werden (kein preDeploy-Hook auf dem Free Tier). Wird er einmal vergessen, sperrt er
alle zahlenden Kunden gleichzeitig.

**Der Weglauf-Fall bleibt gedeckt — an der richtigen Stelle, am Code belegt (2026-07-30):**

- Outbound setzt Abo UND KYC voraus, beides fail-closed: `kycReached` liefert ohne `kycLevel`
  `false` (`state-ops.js:1149`), `kycLevel` wird ausschliesslich bei bestaetigter Zahlung gesetzt
  (`billing/activation.js:87`), zusaetzlich `tenantActiveSubscriber` (`outbound-gates.js:317`).
  Alle Outbound-Pfade laufen durch dieselbe eine Gate-Kette (`routes/api-calls.js:120`), es gibt
  keinen zweiten Einstieg. **Ein Tenant ohne Abo erzeugt keine Carrier-Kosten.** Damit ist der
  Vermehrungsfall (jeder neue WorkOS-`sub` = neuer Tenant) auf der Kosten-Achse gegenstandslos.
  Ausnahmen ohne Massenwirkung: der Bootstrap-/Owner-Tenant (`state-ops.js:955`) und ein per
  `POST /api/profiles` gesetztes `profile.unrestricted` (Basic-Auth, kein MCP-Zugang).
- DID-Vermehrung deckeln `MAX_NUMBERS` (plattformweit, `config.js:831`) und
  `MAX_NUMBERS_PER_TENANT` (Default 1, `config.js:833`), durchgesetzt in `requestNumber`
  (`state-ops.js:1601`/`:1605`).
- Der bewusste Notaus bleibt `OUTBOUND_FROZEN` — ein Schalter, der nie versehentlich feuert,
  weil das Geschaeft laeuft.

**Umfang (die Gate-Stellen sind vollstaendig erhoben, 2026-07-30):**

- `globalBudgetExceeded` als Gate in drei Aufrufern: Outbound-Budget-Gate
  (`outbound-gates.js:749`), Inbound-Reject (`voice.js:256`), Mid-Call ueber `blockingBudgetAxis`
  (`budget-gate.js:12-15`).
- `globalReserveExceedsBudget` in `tryReserveOutboundBudget` (`state-ops.js:2698`).
- `gatePlatformUsageCents` speist beide ueber `globalSpendOrDeny` (`state-ops.js:2379`).
- **Erhalten bleibt** der Beobachtungspfad `platformSpendObservedCents` /
  `claimPlatformSpendWarning` (`state-ops.js:2746-2760`) — er ist bereits ausdruecklich als
  "AENDERT KEINE GATE-ENTSCHEIDUNG" dokumentiert (`state-ops.js:2720`) und ist nach dieser Phase
  die einzige Verwendung der Plattform-Achse.

**Die zwei Boot-Guards verlieren ihre Praemisse, nicht ihre Strenge.** `spendCapCoherence`
(`boot-guard.js:144`, `TENANT_DEFAULT_INERT`) und `planCapInertFindings` (`boot-guard.js:307/320`,
`PLAN_CAP_INERT`) begruenden sich beide woertlich damit, dass "der globale Cap immer zuerst
bindet". Bindet er nicht mehr, ist eine Tenant-Decke oberhalb der Plattform-Zahl nicht
"wirkungslos", sondern die einzig wirksame Schranke — die Aussage der Guards wird schlicht falsch.
Sie zu entfernen bzw. neu auszurichten ist deshalb **kein Abschwaechen einer Sicherung**, sondern
das Loeschen einer Behauptung ueber einen Mechanismus, den es nicht mehr gibt. Das ist die
entscheidende Abgrenzung zu D-1 aus dem ersten KS-P5a-Lauf, wo derselbe Guard bei INTAKTER
Praemisse leiser gedreht werden sollte. Klausel A/B von `spendCapCoherence`, die die
Worst-Case-Reserve gegen die TENANT-Decke haelt, bleibt erhalten — sie haengt nicht an der
Plattform-Achse. Was von `spendCapCoherence` traegt und was faellt, ist in dieser Phase am Code
zu trennen und im Bericht zu begruenden.

**Erwartetes Ergebnis:** kein Kunde wird mehr gesperrt, weil ein anderer Kunde Geld ausgegeben
hat. Die Plattform-Summe ist weiterhin messbar und warnt bei `PLATFORM_SPEND_WARN_PERCENT`.
**Verifikation:** Test, dass ein Tenant mit intakter eigener Decke telefonieren kann, waehrend die
Plattform-Summe die alte Schwelle ueberschreitet (Mutationsprobe: Bestand faerbt ihn rot); Test,
dass die Warnung weiterhin genau einmal je Periode feuert; Boot bleibt gruen.
**Absolute Regel 1:** die pro-Tenant-Decke bleibt unveraendert scharf. Diese Phase entfernt EINE
Achse der Schnittmenge, die zweite traegt allein weiter. CLAUDE.md Regel 1 ist bereits
entsprechend geaendert (E10) — die Phase setzt eine dokumentierte Entscheidung um, sie trifft
sie nicht.
**PLAN-SECURITY.md:** die entfallene Achse mit Begruendung und mit den Gegen-Gates (Abo+KYC,
`MAX_NUMBERS`, `OUTBOUND_FROZEN`) eintragen.

### KS-P10 — Inbound-Sperre (ZURUECKGEZOGEN, NICHT umsetzen)

**Status 2026-07-30: diese Phase ist gestoppt und darf nicht gebaut werden**, bis der Owner
sie ausdruecklich und in eigenen Worten beauftragt. Sie beruhte auf E11, und E11 ist
zurueckgezogen — die Lockerung war mein Vorschlag, nicht die Entscheidung des Owners, und die
Begruendung darunter ist am Code falsch (s. E11-Zeile in der Entscheidungstabelle: die
KI-Token eines Inbound-Gespraechs werden live auf die Gate-Achse gebucht, die Abweisung spart
also sehr wohl Geld).

Der Abschnitt bleibt als Befund stehen, weil die beschriebene harte Kante real ist — was daraus
folgen soll, ist offen.

**Urspruengliche Formulierung (nicht beauftragt):** Ein erschoepftes Budget darf einen
Inbound-Anruf weder abweisen noch ein laufendes Inbound-Gespraech beenden.

**Befund, am Code belegt (2026-07-30):** `voice.js:256` weist Inbound ab, sobald EINE der beiden
Achsen erschoepft ist (`store.budgetExceeded(...) || store.globalBudgetExceeded(...)`), mit Hangup
vor `createCall`. Und `/voice/turn` bedient laut eigenem Kommentar (`voice.js:324`) **beide
Richtungen** — der Mid-Call-Hangup aus `blockingBudgetAxis` (`budget-gate.js:12-15`) ueber
`budgetHangupOutcome` (`voice.js:116-119`) trifft damit Inbound-Gespraeche genauso wie Outbound.

**Warum das falsch ist:** fuer Inbound wird heute nichts gebucht (E7; `metering.js:68-69` steigt
bei Inbound sofort aus, `actual_cost_micro_cents` ist bei allen Inbound-Zeilen NULL). Die
Abweisung spart also keinen Cent und nimmt dem Kunden genau die Funktion, fuer die er bezahlt hat.

**Umfang:** die Budget-Bedingung an `voice.js:256` entfaellt fuer Inbound; der Mid-Call-Abbruch
aus `blockingBudgetAxis` wirkt nur noch auf `call.direction === "outbound"` — spiegelbildlich zu
`metering.js:69` und deckungsgleich mit Abnahmekriterium 3 von KS-P2. Der Assistant-Pfad
(`telnyx-llm-shim.js:497-498`, `killCallForBudget`) wird gleich behandelt.

**Erwartetes Ergebnis:** ein Kunde mit erschoepftem Budget nimmt weiterhin Anrufe entgegen; nur
sein Outbound ist gesperrt.
**Verifikation:** Test, dass ein Inbound-Call bei erschoepfter Tenant-Decke angenommen wird
(Mutationsprobe: der Bestand faerbt ihn rot); Test, dass ein laufendes Inbound-Gespraech bei
erschoepftem Budget NICHT aufgelegt wird; Test, dass Outbound in derselben Lage weiterhin mit 402
abgewiesen wird — die Sperrwirkung fuer Outbound ist NICHT Gegenstand dieser Phase.
**Absolute Regel 1:** diese Phase schwaecht kein Outbound-Gate. Sie begrenzt die Reichweite eines
Kosten-Gates auf die Richtung, die ueberhaupt Kosten erzeugt.
**PLAN-SECURITY.md:** die geaenderte Reichweite eintragen.

### KS-P5a — Starter-Kunde bekommt die verkauften Minuten (NEU, ERSTE Code-Phase)

**Owner-Entscheidung 2026-07-29: vorgezogen vor alles andere.** Das ist kein Baustein dieses
Umbaus, sondern ein **Bestandsdefekt auf dem Geldpfad** — er existiert heute und trifft den
ersten zahlenden Kunden.

**Die Wurzel: zwei Zahlen sagen dasselbe und stehen im Verhaeltnis 1:5.**

| | Wert | Wofuer |
|---|---|---|
| `voiceCapRateCentsPerMin` (`config.js:610`) | **6 ct/min** | daraus wird die **Decke** abgeleitet |
| Buchungssatz `voiceTariffDefaultCents` | **30 ct/min** | damit wird der **Verbrauch gebucht** |

Die Decke rechnet `includedMinutes x voiceCapRateCentsPerMin x Kopffreiheit`
(`plan-caps.js:31`), die Kopffreiheit ist 5/3 (Starter) bzw. 5/4 (Business):

| Plan | verkauft | Decke | nutzbar bei 30 ct/min |
|---|---|---|---|
| Starter | 30 min | 30 x 6 x 5/3 = **300 ct** | **10 min** |
| Business | 120 min | 120 x 6 x 5/4 = **900 ct** | **30 min** |

Business ist also noch schlechter als Starter — ein Viertel des Verkauften. Zur Einordnung: vor
KS-P0 (300 ct/min) waren es **1 von 30** bzw. **3 von 120** Minuten. Der Tarif-Fix hat den Defekt
stark gemildert, aber nicht behoben.

**ENTSCHEIDUNG (E5a, Owner 2026-07-29): es darf nur noch EINEN Satz geben.** Weder "Decke hoch"
noch "Buchungssatz runter" — beide Antworten halten zwei Zahlen am Leben, die jemand synchron
halten muss, und genau daran ist es gescheitert. Die Decke wird aus DEMSELBEN Satz abgeleitet,
mit dem gebucht wird (Worst-Case, weil die Decke vorab feststehen muss). Danach kann die Luecke
strukturell nicht mehr entstehen. `voiceCapRateCentsPerMin` entfaellt als eigene Groesse — das
ist Teil der Aenderung, kein Nebenprodukt.

**Diese Phase rechnet zuerst und aendert danach.** Die Folgekette ist laenger, als der Befund
aussieht: rechnet man Business mit 30 ct/min, ergibt das `120 x 30 x 5/4 = 4500 ct` = 45 EUR
Decke — **mehr als der gesamte Plattform-Notaus** (`MAX_BUDGET_EUR=30`, 3000 ct). Ein einziger
Business-Kunde, der sein Kontingent ausschoepft, sprengt ihn; `deriveTenantBudgetFromPlan`
(`state-ops.js:1348`) klemmt dann auf den Plattform-Cap und warnt. **`MAX_BUDGET_EUR` ist ein
Test-Wert und muss mit.** Erster Schritt der Phase ist deshalb eine Aufstellung: welcher Satz
wird tatsaechlich gebucht (Inland/Ausland, Assistant-Pfad an/aus), welche Decke folgt daraus je
Plan, und welcher Plattform-Cap traegt N zahlende Kunden gleichzeitig.

**Erwartetes Ergebnis:** ein Tenant mit Starter-Plan kann die vollen verkauften Minuten
telefonieren, ohne dass die EUR-Decke vorher greift.
**Verifikation:** ein Test, der fuer jeden Plan aus dem Katalog die verkauften Minuten gegen die
abgeleitete Decke haelt und rot wird, sobald die Decke sie nicht traegt. Der Test muss den
Bestand heute **rot** faerben — sonst prueft er nichts (Mutationsprobe).
**Absolute Regel 1:** die Decke wird angehoben, nicht abgeschafft — die Schnittmenge mit dem
Plattform-Notaus bleibt.
**PLAN-SECURITY.md:** geaenderte Decken-Herleitung mit Zahlen eintragen.

### KS-P6 — Tarif-Fallback im Code nachziehen (VORGEZOGEN, Vorbedingung von KS-P3)

`voiceTariffDefaultCents` Fallback von 300 auf 30 in `src/config.js:580-583`, dazu
`.env.example:350` und `render.yaml:322-323`. Zusaetzlich die Herleitungs-Kommentare nachziehen,
die "300 * 5 = 1500" ausschreiben: `src/config.js:625-630`, `.env.example:369`,
`render.yaml:336`.

Diese Phase steht jetzt **vor** KS-P3, weil `spendCapCoherence` mit dem **Code-Fallback**
rechnet, nicht mit dem Render-Wert — ein KS-P3 ohne sie toetet jeden Boot (s. dort).

**Verifikation:** `npm test` gruen (insbesondere `test/env-docs-spend-cap-coherence.test.js`,
das `.env.example`, `render.yaml` und den `config.js`-Fallback durch denselben Guard schickt);
Boot-Banner zeigt den neuen Satz (`boot.js:436-440`, "Worst-Case-Tarif").

### KS-P2 — Laufenden Verbrauch messen (Wurzelbehebung fuer B1/B2)

`blockingBudgetAxis` rechnet die verstrichene Zeit des laufenden Calls mit ein:

```
verbraucht = gebucht + (verstricheneMinuten × Tarif)
Rest reicht nicht mehr fuer die naechste angefangene Minute -> Abschiedssatz + auflegen
```

Die uebrige Mechanik existiert (AL-P6: Turn-Pruefung, Locale-Satz, Hangup). Der Umfang ist aber
groesser, als die erste Fassung angenommen hat — die folgenden sechs Punkte sind
**Abnahmekriterien**, nicht Kommentare:

1. **Signatur und beide Aufrufer.** `blockingBudgetAxis({ store, billing, tenantId })`
   (`budget-gate.js:12`) kennt heute keinen Call; die verstrichene Zeit ist dort nicht
   ermittelbar. Beide Aufrufer haben den Call in Reichweite und muessen nachgezogen werden:
   `src/claude.js:557` (`roundStopReason`, TeXML-Pfad) und `src/telnyx-llm-shim.js:497`
   (Assistant-Pfad). Es gibt auch **zwei getrennte Reaktionen**: `budgetHangupOutcome`
   (`routes/voice.js:116-119`, `[Say, Hangup]`) und `killCallForBudget`
   (`telnyx-llm-shim.js:469-473`, Completion + Call-Control-Terminierung). Beide werden
   abgenommen, nicht nur der Renderpfad.
2. **Kein optionaler Parameter mit sicherem Default.** `call` (bzw. `elapsedMs`) ist
   PFLICHT-Feld ohne Default — ein vergessener Aufrufer muss laut scheitern, nicht die neue
   Sicherung stumm auf 0 setzen. Praezedenz: `tariffCentsPerMin(to, from)`
   (`outbound-gates.js:189`, "from ist PFLICHT ohne Default"); Regel:
   `claude.js:554-555` ("ein Gate, das ein Aufrufer per No-op abschalten darf, ist keines") und
   CLAUDE.md ("neue abgeschaltete Sicherungen" sind hart verboten).
3. **Richtung: NUR Outbound.** `reconcileOutboundVoiceBudget` (`metering.js:68-69`) steigt bei
   Inbound sofort aus, und es gibt keine Inbound-Reserve. Ein Live-Term ohne
   Richtungsunterscheidung erzeugte einen Phantom-Verbrauch, der nie gebucht wird, bei Call-Ende
   spurlos verschwindet — und mittendrin ein **kostenloses** Inbound-Gespraech aufloest. Der Term
   gilt spiegelbildlich zu `metering.js:69` nur fuer `call.direction === "outbound"`. Test: ein
   Inbound-Call mit erschoepfter laufender Minute wird NICHT aufgelegt. (Anmerkung zur
   Vollstaendigkeit: ein Inbound-Minutensatz **ist** definiert — `callTariffCentsPerMin`
   `metering.js:41-42` liefert `tariffCentsPerMin(call.to, call.to)`; es wird nur nie etwas
   gebucht.)
4. **Tarif aus EINER Quelle.** `isDomesticLeg`/`tariffCentsPerMin` leben in
   `src/telephony/outbound-gates.js:181-192` und sind dort ausdruecklich als die eine
   Kosten-Quelle markiert. KS-P2 importiert sie, dupliziert sie nicht (G5). Dass daraus eine neue
   Modul-Kopplung Budget <-> Telephony entsteht, ist Teil der Phase und im Review zu begruenden.
5. **Fail-Richtung festlegen.** Es gibt im Repo zwei entgegengesetzte Konventionen fuer denselben
   Anker: `callStartAnchorMs` (`state-ops.js:517-519`) liefert bei fehlendem
   `answeredAt`/`startedAt` NaN, und `remainingMaxDurationMs` (`:532`) macht daraus fail-closed
   eine 0 (= sofort terminieren); `voiceMinutesOf` (`metering.js:31`) macht daraus fail-open eine
   0 (= nichts buchen). KS-P2 legt fest: `verstricheneMinuten = max(0, …)` ueber
   `callStartAnchorMs`, und ein **nicht auswertbarer Anker geht ueber dieselbe Kante wie jeder
   andere unbrauchbare Geldwert** (D7-Muster, `spendOrDeny` `state-ops.js:2400`, eigener Grund) —
   nicht ueber ein stilles 0 und niemals als NaN durch den Vergleich (`gebucht + NaN >= cap` ist
   immer false = Gate still AUS). Tests: Call ohne `answeredAt`; Call mit rueckwaerts springender
   Uhr (negative verstrichene Zeit darf den Verbrauch nie UNTER den gebuchten Wert druecken).
6. **Test-Fixtures vorbereiten.** Die in mehreren Testdateien geteilte `makeCall()`-Fixture
   (`test/telnyx-shim-harness.js:116-126`) traegt weder `to`/`from` noch
   `startedAt`/`answeredAt`. Sie wird VOR der Umsetzung ergaenzt, damit Bestandstests kontrolliert
   durch die neue Pruefung laufen und nicht zufaellig ueber NaN-Arithmetik.

**Nicht im Umfang, ausdruecklich getragen:** die **Plattform-Achse** bleibt mid-call blind.
`blockingBudgetAxis` prueft zwei Achsen (`budget-gate.js:12-16`, "Tenant-Cap UND Plattform-Notaus
bleiben eine SCHNITTMENGE"); `globalBudgetExceeded` (`state-ops.js:2650`) liest nur
`gatePlatformUsageCents`, also settled/Monat. Nach KS-P2 misst die Tenant-Achse laufend, die
Plattform-Achse weiterhin nur gebucht. Der einzige In-Flight-Schutz der Plattform ist heute
`globalReserveExceedsBudget` (`state-ops.js:2678`), das ausschliesslich am Dial-Gate laeuft
(`outbound-gates.js:474`) — und KS-P0 senkt jede einzelne Reserve um Faktor 10, laesst also rund
zehnmal so viele gleichzeitige Minuten unter demselben `MAX_BUDGET_EUR=30` (`render.yaml:317`)
zu. Das ist ein bewusst getragenes Restrisiko dieser Phase; s. TOD 11 und E6.

**Erwartetes Ergebnis:** ein Outbound-Anruf, dessen Budget waehrend des Gespraechs erschoepft,
endet mit dem Abschiedssatz — unabhaengig von der Zeitgrenze.
**Verifikation:** Test mit gestelltem Bucket knapp unter der Decke; der Turn liefert
`stopReason = budget_tenant`; **beide** Reaktionen abgenommen (TeXML `[Say, Hangup]` UND Shim
`killCallForBudget` mit `logShimGate({reason:"budget_tenant"})` + Call-Control-Terminierung).
**Absolute Regel 1:** die Vorab-Reservierung bleibt unangetastet — sie schuetzt gegen
Gleichzeitigkeit, **aber nur bis zum naechsten Neustart** (s. TOD 6; der Reserve-Ledger ist
strukturell ephemer). Diese Einschraenkung ist Teil des Phasenberichts, keine Fussnote.
**PLAN-SECURITY.md:** neue Kante eintragen (Live-Term auf der Tenant-Achse, Plattform-Achse
bewusst blind).

### KS-P4 — Anzeige an die Gate-Achse binden

`tenantBudgetSnapshot` liest `gateUsageCents` statt `usageFor().costCents`; `nowIso` wird durch
beide Store-Fassaden gereicht (vorhandenes Muster von `budgetExceeded`). Die Fassaden-Signatur
nach aussen bleibt unveraendert.

**Zusaetzlich verbindlich (fehlte in der ersten Fassung):**

- **Der D7-Riegel wandert mit — zweiseitig.** Heute prueft `tenantBudgetSnapshot`
  (`state-ops.js:2464-2468`) genau den Wert, den es liest. Die Gate-Entscheidung ist aber die
  Konjunktion aus `gateCents` UND `lifetimeCents` (`spendOrDeny` `state-ops.js:2400-2405`, mit
  der ausdruecklichen Begruendung "die D7-Reichweite darf NIE schrumpfen"). Wechselt der Snapshot
  nur die Lesequelle, entsteht der **Spiegelfall des heutigen Bugs**: vergifteter
  Lebenszeit-Zaehler, gesunder Gate-Zaehler -> das Gate sperrt, der Snapshot rendert eine
  gueltige Zahl, und `reserveCents - remainingCents` (`outbound-gates.js:440`) traegt wieder ein
  negatives Vorzeichen. Der Snapshot prueft nach dem Wechsel **beide** Werte — weiterhin ohne
  `denyCorruptUsage`-Log (die Begruendung dafuer, `state-ops.js:2461-2463`, bleibt gueltig).
- **Drei Achsen, nicht zwei.** Die Zusage "bei Flag AUS ist `gateUsageCents` identisch zur
  bisherigen Lebenszeit-Semantik" ist seit GAP-01 falsch: bei Flag AUS liest `gateUsageCents`
  das **Perioden-Fenster** (`budgetPeriodUsageCents` `state-ops.js:2340`), Lebenszeit nur
  solange nie ein `budgetPeriodKey` gestempelt wurde (`stampBudgetPeriod` `:2352`, gerufen aus
  `billing/activation.js`). Die Verifikation laeuft deshalb in **beiden** Flag-Stellungen,
  jeweils MIT gesetztem `budgetPeriodKey`.

**Erwartetes Ergebnis:** ein negativer Fehlbetrag wird strukturell unmoeglich —
`Reserve > Rest` folgt zwingend aus der Gate-Bedingung, sobald beide dieselbe Verbrauchsgroesse
lesen UND denselben Korruptions-Riegel anwenden. Das ist der Regressionstest: eine Eigenschaft,
kein Zahlenwert. Zweiter Regressionstest: Lebenszeit vergiftet, Gate-Zaehler gesund -> die
Ablehnung MUSS den ziffernfreien Sperrtext liefern, nicht eine Zahl.
**OWNER-ENTSCHEIDUNG 2026-07-29 — der Nutzer sieht ueberhaupt keine Kostenbetraege mehr.**
Damit ist die frueher diskutierte Nebenwirkung ("Dashboard zeigt eine hoehere Zahl")
gegenstandslos: die EUR-Zahl verschwindet aus der Nutzer-Oberflaeche. Der Kunde kauft Minuten,
nicht Euro — er sieht seine **Monatsnutzung in Prozent**. Das ist eine eigene Phase (KS-P8), weil
es die Anzeige-Semantik aendert und nicht nur eine Lesequelle.

KS-P4 bleibt trotzdem noetig und wird dadurch **kleiner**: `tenantBudgetSnapshot` speist ausser
dem Dashboard auch `tenantReserveDenial` (`outbound-gates.js:435-451`) — den Text, den der Owner
als `es fehlen -4.77 EUR` gesehen hat. Diese Ablehnungsmeldung bleibt, und sie muss stimmen.
Nach KS-P8 ist der Snapshot nur noch **eine** Quelle: die der Ablehnungstexte.

**Reihenfolge-Hinweis:** KS-P4 vor KS-P8. Erst die Zahl richtig machen, dann entscheiden, wer sie
zu sehen bekommt — sonst baut KS-P8 eine Prozentanzeige auf einer Bezugsgroesse, die noch die
falsche Achse liest.
**PLAN-SECURITY.md:** loest das dort dokumentierte Restrisiko 3 auf (Zeilen 678-681, sinngemaess
"`tenantBudgetSnapshot` bleibt eine LEBENSZEIT-Sicht neben einer Perioden-Entscheidung … bewusst
ausserhalb des Scopes") sowie den entsprechenden Halbsatz bei Zeile 592-596.

### KS-P5 — Gutschriften der laufenden Periode zulassen

Negative Korrekturen duerfen auf die Gate-Achse, wenn der **Anruf** zur laufenden Periode
gehoert; sonst wie bisher nur Lebenszeit.

**Umfang, praeziser als die erste Fassung:**

- **Der Bezugs-Zeitstempel ist NICHT "der Anruf liegt im laufenden Spend-Monat", sondern
  "derselbe Zeitanker wie die BELASTUNG".** Die Belastung wird heute mit der **Fassaden-Uhr**
  gebucht (`json.js:614-615` und `pg.js:385-386` erzeugen beide
  `new Date().toISOString()`; `cost-truing.js:339` reicht gar kein `nowIso` herein). Ein Anruf
  ueber die Monatsgrenze (Start 31.7. 23:58, Ende 1.8. 00:05) wurde im August belastet — eine
  nach `call.startedAt` zugeordnete Gutschrift ginge nach Juli-Logik und traefe einen Monat, der
  nie belastet wurde. Konkret: den Monatsschluessel der Schaetzbuchung am Call persistieren
  (analog `recordCallEstimatedCostCents`, `metering.js:84`) und die Gutschrift nur zulassen, wenn
  dieser Schluessel `=== usage.spendMonthKey`. Die Fassaden-Signatur-Aenderung (`json.js` +
  `pg.js`) gehoert in den Phasenumfang.
- **Der 0-Boden von `costCents` bleibt erhalten, egal welchen Pfad die Korrektur nimmt.** Er
  liegt heute ausschliesslich im `else`-Zweig von `bookCostCorrectionCents`
  (`state-ops.js:2257`), nicht in `bookCents` (`:2127`). Wird die negative Korrektur ueber
  `bookCents` geleitet, faellt er weg — und `isBookableCents` (`defaults.js:220`) verlangt
  `x >= 0`. Ein negativer `costCents` liesse `spendOrDeny` mit `deny` antworten, `budgetExceeded`
  wuerde **true** liefern und der Tenant waere mit Grund `usage_korrupt` hart gesperrt:
  kostenloser Inbound abgewiesen, laufender Call aufgelegt. Eine Gutschrift, die den Tenant
  sperrt. Und das ist erreichbar: 8,61 EUR Gutschriften stehen 4,23 EUR Lebenszeit-Bucket
  gegenueber (B4/B5). Test: Gutschrift groesser als der Lebenszeit-Bucket sperrt den Tenant NICHT.
- **`spendMonthUsageCents` bekommt denselben `Math.max(0, …)`-Riegel wie
  `budgetPeriodUsageCents`.** Die Monats-Achse hat heute keinen Boden (`state-ops.js:2075-2078`
  gegen `:2340-2343`), und bei einem Schluesselwechsel **setzt** `bookCents`
  `spendMonthCostCents = cents` (`:2131`) — ein negatives `cents` landete als negativer
  Monatsverbrauch, den `platformSpendMonthCents` (`:2376`) sogar in die Plattform-Summe
  hineinsummiert und damit die Decke fuer ALLE Tenants aufweitet. Die Schwesterfunktion hat den
  Riegel und nennt den Grund; die Monats-Achse hat ihn nur deshalb nicht, weil sie bisher nie
  negativ werden KONNTE. Mutationsprobe: Riegel entfernen -> Test rot.
- **Beide Achsen adressieren.** Der Missbrauchsschutz, den diese Phase erhalten will, existiert
  auf der Perioden-Fenster-Achse gar nicht (s. B5, zweite Haelfte). `bookCostCorrectionCents`
  braucht dort eine **eigene** Regel — Korrektur nur wirksam, wenn der Bezugsanker >= dem
  gestempelten Perioden-Anker liegt, sonst nur Lebenszeit — statt sich auf die zufaellige
  Ableitungseigenschaft von `budgetPeriodUsageCents` zu verlassen. Andernfalls gilt die Zusage
  "der Missbrauchsschutz bleibt exakt erhalten" nur fuer eine der zwei Achsen.

**Erwartetes Ergebnis:** der Missbrauchsschutz bleibt auf **beiden** Achsen erhalten (Gutschrift
aus einer abgeschlossenen Periode wird weiterhin verworfen), Korrekturen der laufenden Periode
wirken.
**Verifikation:** vier Tests — Gutschrift in der laufenden Periode wirkt; Gutschrift aus der
Vorperiode wird verworfen (jeweils fuer Flag AN und Flag AUS); dazu die beiden 0-Boden-Tests
oben.
**PLAN-SECURITY.md:** loest die Spend-Monat-Haelfte von Restrisiko 2 auf (Zeilen 674-678) und
traegt den bis dahin unbeschriebenen Perioden-Achsen-Sachverhalt nach.

### KS-P1b — Der Assistant-Shim bekommt denselben Re-Attach-Pfad (NEU, Vorbedingung von KS-P3)

`src/telnyx-llm-shim.js:435-439` loest den Call ausschliesslich ueber den Prozess-Spiegel auf und
antwortet bei einem Miss mit 403, ohne `reattachActiveCall`. Der Call laeuft beim Provider
weiter — ohne Cap-Timer, ohne Dead-Air-Watchdog (auch der ist prozesslokal). Bei 180 s Restdauer
ist das Fenster klein; KS-P3 macht daraus bis zu 1800 s.

Der Shim kommt auf denselben Seam wie `/voice/turn|outbound|status` und der
Call-Control-Ingest: `reattachActiveCall` (`call-lifecycle.js:126-134`), inkl.
Restzeit-Klassifikation und Cap-Rearm. Vertraut nur der DB, nie dem Request-Body.

**Zusaetzlich (Folge von E8): die Notbremse wird beim Re-Attach NEU berechnet, nicht
wiederhergestellt.** Da ihre Frist sich aus dem Restguthaben ableitet, ist der beim Anrufstart
gueltige Wert nach einem Neustart veraltet — zwischenzeitlich koennen andere Anrufe desselben
Tenants Guthaben verbraucht haben. Der Re-Attach liest das **aktuelle** Guthaben und armiert
daraus. Ein Leg, dessen Guthaben in der Zwischenzeit aufgebraucht wurde, wird terminalisiert,
nicht mit einer frischen Frist reanimiert.

**Erwartetes Ergebnis:** ein Assistant-Call, dessen Zeile erst nach `hydrate()` der neuen Instanz
entstand, wird beim naechsten Shim-Turn re-attached und seine Notbremse aus dem aktuellen
Guthaben nachgezogen; ein Ueber-Zeit- oder Ueber-Budget-Leg wird terminalisiert statt reanimiert.
**Verifikation:** Test mit leerem Spiegel + aktiver DB-Zeile -> kein 403, Timer armiert; Test mit
abgelaufener Restzeit -> terminalisiert, kein Turn; Test mit inzwischen erschoepftem Guthaben ->
terminalisiert.
**Blockiert:** KS-P3.

### KS-P3a — Plan-Decken gegen die Worst-Case-Reserve absichern (NEU, Vorbedingung von KS-P3)

Direkte Folge aus B7. Zwei Teile, eine Entscheidung:

1. **Boot-Guard.** Die Worst-Case-Reserve (`maxTariffCents * ceil(MAX_CALL_DURATION_CAP_S/60)`)
   wird zusaetzlich gegen `MIN(planCapCents(slug))` ueber alle `CATALOG_SLUGS` gehalten — dieselbe
   Klausel-B-Logik wie `spendCapCoherence` (`boot-guard.js:157-172`), nur mit der Plan-Decke statt
   `defaultTenantBudgetCents`. Heute gibt es diese Pruefung nicht: `planCapInertFindings`
   (`boot-guard.js:296-311`) haelt die Plan-Decken ausschliesslich gegen den Plattform-Cap.
2. **Kalibrierung.** Der Tarif (KS-P0/KS-P6) und `voiceCapRateCentsPerMin` (`config.js:610`,
   heute 6) muessen zueinander passen. Solange der Buchungssatz 30 ct/min das Fuenffache des
   Basissatzes ist, aus dem die Decke abgeleitet wird, kann ein Kunde nur ein Fuenftel seiner
   verkauften Minuten buchen. Optionen: Buchungssatz <= `voiceCapRateCentsPerMin * Kopffreiheit`
   (~10 ct/min statt 30), oder `voiceCapRateCentsPerMin` zieht mit. Das ist **eine** Entscheidung,
   nicht zwei (E5).

**Erwartetes Ergebnis:** ein Starter-Tenant kann seine 30 inkludierten Minuten unter der
abgeleiteten Decke buchen; ein Business-Tenant seine 120.
**Verifikation:** Test, der den Starter-Fall rechnet (`includedMinutes * Buchungssatz <=
planCapCents("starter", cfg)`), plus ein Boot-Guard-Test, der eine inkohaerente Kombination fatal
meldet.
**Absolute Regel 1:** dieser Schritt fuegt eine Sicherung hinzu, er entfernt keine.
**Blockiert:** KS-P3.

### KS-P3 — Zeitgrenze von Produktgrenze zu Notbremse

Erst nach KS-P6, KS-P2, KS-P1b und KS-P3a. Die Zeitgrenze begrenzt dann keine Kosten mehr,
sondern nur noch haengende Anrufe (keine Turns mehr, Modell klemmt, Verbindung tot).

**OWNER-ENTSCHEIDUNG 2026-07-29 — es gibt keine neue feste Maximaldauer.** Die nutzbare
Gespraechsdauer ist kein Konfigurationswert mehr, sondern eine **abgeleitete Groesse**:

```
nutzbare Minuten = Restguthaben des Tenants / Minutenpreis
```

Der Live-Zaehler aus KS-P2 setzt sie durch. Wer viel Guthaben hat, telefoniert lange; wer wenig
hat, kurz. Eine Zahl wie "600 s" waere nur eine kleinere Willkuer als die heutigen 180 s und
gehoert deshalb NICHT in diese Phase.

**Damit zerfaellt KS-P3 in zwei Teile, und der zweite ist der eigentliche:**

**(a) Die Vorab-Reserve wird von der Maximaldauer entkoppelt.** Heute gilt
`ctx.reserveCents = tariffCentsPerMin(...) * ceil(maxDur/60)` (`outbound-gates.js:791`) — die
Reserve waechst linear mit der erlaubten Dauer. Genau daran haengen der fatale Boot-Guard
(`worst_case_unaffordable`), der B7-Konflikt mit den Plan-Decken und die gesamte Rechnung
weiter unten. Mit einem laufenden Messwert ist diese Kopplung ueberfluessig: die Reserve muss
nur noch das **Vorlauffenster** decken, bis der Live-Zaehler zum ersten Mal greift (Richtwert:
ein bis zwei angefangene Minuten). Ihr verbleibender Zweck ist der Schutz gegen
**Gleichzeitigkeit** (mehrere Anrufe desselben Tenants, s. TOD 7), nicht mehr die Deckung des
ganzen Gespraechs.
Ohne (a) ist (b) nicht baubar, ohne dass die Reserve die Plan-Decken sprengt.

**(b) Die harte Zeitgrenze wird zur Notbremse — und auch sie ist keine feste Zahl mehr**
(Owner-Entscheidung E8). Sie greift nur noch, wenn gar keine Turns mehr kommen und der
Live-Zaehler deshalb nicht laufen kann. Ihr Wert leitet sich vom selben Guthaben ab wie die
nutzbare Dauer:

```
Notbremse = min( Restminuten + 1 Minute Puffer , absolute Obergrenze )
```

Der Puffer stellt sicher, dass im Normalbetrieb immer der Live-Zaehler zuerst bindet — die
Notbremse ist die zweite Linie, nicht die erste. Der Schaden eines haengenden Anrufs ist damit
**proportional zum Guthaben** statt auf eine willkuerliche Zahl gedeckelt: wer 3 Minuten
Guthaben hat, verliert hoechstens 4.

Die **absolute Obergrenze** bleibt noetig und hartkodiert: bei einem Tenant mit sehr grossem
Guthaben stuende die Notbremse sonst bei vielen Stunden und waere keine Sicherung mehr. Sie
begrenzt keine Kosten (das tut der Live-Zaehler), sondern nur die Lebensdauer einer technisch
toten Verbindung — und eine Notbremse gehoert nicht an einen Knopf, an dem man sie
versehentlich abdreht.

**Randfall, der in die Verifikation gehoert:** ein Tenant ohne aufloesbares Guthaben (kein Plan,
kein Kontingent) hat keine Restminuten, aus denen sich etwas ableiten liesse. Fail-closed heisst
hier: die absolute Obergrenze gilt, nicht "unbegrenzt".

**Die Kostenluecke bei teuren Zielen wird NICHT ueber die Uhr geloest** (Owner, 2026-07-29),
sondern ueber die Sperrliste — s. die neue Phase KS-P7. Schutz vor Lockerung: KS-P7 steht VOR
KS-P3.

> Die folgenden Detail-Befunde stammen aus dem Angriff auf die erste Fassung. Sie gelten
> unveraendert fuer Teil (b) — die drei Klemmen, `POOL_SINCE_MARGIN_MS` und der Boot-Guard
> reagieren auf JEDE Erhoehung der Zeitgrenze, egal wie sie begruendet ist. Die
> Reserve-Rechnung am Ende ist der Beleg dafuer, warum Teil (a) zuerst kommen muss.

**Der Umfang ist groesser als "eine Konstante":**

- **Alle drei 300er-Klemmen** aus B2 (`defaults.js:258`, `config.js:971`, `config.js:399`) plus
  die Env-Werte in `render.yaml:391-392` und `.env.example:431`. Der Owner-Teil (Render-Dashboard
  `MAX_CALL_DURATION_S`) ist von der Code-Aenderung getrennt zu fuehren — der Live-Service ist
  Dashboard-managed, der Blueprint-Wert allein schaltet nichts.
- **Die Verifikation liegt auf dem EFFEKTIVEN Wert, nicht auf `resolveMaxDurationS`.** Ein Test,
  der `MAX_CALL_DURATION_S` auf den neuen Default setzt und `config.safety.maxCallDurationS ===
  600` assertiert. `resolveMaxDurationS` (`outbound-gates.js:201-206`) bekommt den bereits
  geklemmten Wert herein und klemmt korrekt auf den neuen Cap — dieser Test wuerde gruen, waehrend
  sich am Verhalten nichts geaendert hat. Betroffen sind zusaetzlich der Inbound-Pfad und der
  Boot-Re-Arm, die `config.safety.maxCallDurationS` direkt lesen (`call-lifecycle.js:43`, `:129`,
  `:150`).
- **`POOL_SINCE_MARGIN_MS` zieht mit.** `src/billing/cost-truing.js:89-95` leitet die 1-h-Marge
  ausdruecklich daraus her, dass "MAX_CALL_DURATION_S hart bei hoechstens 300 s deckelt. Eine
  Stunde ist das Zwoelffache davon". Bei 1800 s ist es nur noch das Doppelte, und das Modul
  benennt die Fehlerrichtung selbst als **fail-open**: ein zu knappes Fenster verliert Belege und
  meldet den Pool trotzdem als vollstaendig — eine Rueckerstattung auf einer bewiesenen
  Untermenge. Entweder auf mindestens das Zwoelffache heben (6 h) oder die Marge aus
  `MAX_CALL_DURATION_CAP_S` ableiten, damit sie beim naechsten Cap-Wechsel nicht veraltet. Der
  Kommentar-Text ist Teil der Aenderung.
- **Der Boot-Guard rechnet mit dem CODE-Fallback.** Empirisch nachgerechnet gegen die echte
  Funktion: `spendCapCoherence({tenantDefaultCents:1500, platformCapCents:3000,
  maxTariffCents:300, maxCallDurationS:1800})` liefert `{code:"worst_case_unaffordable",
  fatal:true, message:"Worst-Case-Reserve 9000 Cent … uebersteigt die Tenant-Decke
  DEFAULT_TENANT_BUDGET_CENTS=1500"}`; `boot.js:103-107` beendet den Prozess mit
  `process.exit(1)`. Mit KS-P6 vorher (`maxTariffCents:30`) liefert dieselbe Funktion `[]`, und
  30 x 30 = 900 <= 1500 haelt Klausel B. Deshalb die geaenderte Reihenfolge.
  `test/env-docs-spend-cap-coherence.test.js` gehoert als Pre-Merge-Gate in die Verifikation von
  KS-P0, KS-P6 UND KS-P3, nicht nur von KS-P6. (Warum die Suite das sonst nicht faengt:
  `test/helpers.js` setzt `VOICE_TARIFF_DEFAULT_CENTS=0` und `DEFAULT_TENANT_BUDGET_CENTS=0`,
  womit der A0-Early-Return greift und Klausel B nie laeuft.)
- **Zweitwirkung auf die Reserve, mit Zahlen.** `ctx.reserveCents = tariffCentsPerMin(…) *
  ceil(maxDur/60)` (`outbound-gates.js:791`) waechst mit der Dauer mit. Bei 30 ct/min:
  600 s -> 300 ct, 1800 s -> 900 ct. Gegen `DEFAULT_TENANT_BUDGET_CENTS=1500` sind das 20 % bzw.
  60 % der Decke fuer **einen** Anruf; gegen die Plan-Decken aus B7 sind es 100 % (Starter/600 s),
  300 % (Starter/1800 s) und 100 % (Business/1800 s). Der Gewinn von KS-P0 ("Reserve faellt von
  9,00 auf 0,90 EUR") ist damit bei `max_duration_s=1800` wieder bei exakt 9,00 EUR. KS-P3a muss
  vorher stehen, sonst erzeugt diese Phase genau fuer die zahlenden Tenants ein 402.

**Erwartetes Ergebnis:** ein Terminanruf mit Warteschleife laeuft durch, ohne abgeschnitten zu
werden.
**Was NICHT versprochen wird:** dass "das Budget die bindende Grenze bleibt". Bei 30 ct/min und
`DEFAULT_TENANT_BUDGET_CENTS=1500` bindet das Budget erst nach 50 Minuten, der neue Cap nach 30 —
fuer den ersten Anruf einer Periode bindet weiterhin die ZEIT. Das ist kein Fehler (die
Produktgrenze aus B2 ist beseitigt), aber es ist nicht das, was die erste Fassung zugesagt hat.
**Verifikation:** die drei Klemmen effektiv geprueft (s.o.); Smoke-Test; Boot-Banner
(`boot.js:436-440`) zeigt Decken und Worst-Case-Tarif.
**Absolute Regel 1:** die Max-Gespraechsdauer ist ein geschuetztes Gate. Es wird **nicht
entfernt**, nur neu kalibriert; der Timer-Backstop bleibt bestehen.
**PLAN-SECURITY.md:** neue Zeit-/Kosten-Kante mit Zahlen eintragen.

### KS-P7 — Sperrliste erweitern (NEU, Vorbedingung von KS-P3)

**Owner-Entscheidung 2026-07-29:** die Kostenluecke bei teuren Zielen wird ueber die Sperrliste
geloest, nicht ueber die Gespraechsdauer. Schutz vor Lockerung — deshalb steht diese Phase VOR
KS-P3.

Ausgangslage: `src/telephony/number-denylist.js` nennt sich im eigenen Modulkommentar
ausdruecklich "BEWUSST unvollstaendig … Beifang, NICHT der Hauptschutz (Hauptschutz =
Kosten-Achse/Pre-Auth)". Solange der Worst-Case-Tarif 300 ct/min war, stimmte das. Nach KS-P0
(30 ct/min) ist die Kosten-Achse als Bremse fuer teure Ziele weitgehend weg — die Liste wird
damit vom Beifang zum Hauptschutz, ohne dass jemand sie darauf ausgelegt hat. Der Modulkommentar
ist Teil der Aenderung.

Umfang: die Liste gegen eine gepflegte IRSF-/Premium-Quelle abgleichen und die teuersten
fehlenden Ziele ergaenzen. Aus dem Angriff namentlich belegt: **`+53` (Kuba) fehlt** — genau das
Beispiel aus TOD 1. Ergaenzend zu pruefen sind die uebrigen Hochpreis-Destinationen, fuer die
`ALLOWED_COUNTRY_CODES="*"` heute den Weg offen laesst.

**Erwartetes Ergebnis:** ein Anruf auf ein bekannt teures Ziel wird mit `grund=denylist`
abgewiesen, nicht durch einen Tarif gebremst.
**Verifikation:** Positivtests (gewoehnliche Mobilnummern der betroffenen Laender kommen weiter
durch — die Liste arbeitet mit Sub-Ranges, nie mit ganzen Laendercodes, s. Modulkommentar) plus
Negativtests je neuem Praefix.
**Absolute Regel 1:** die Denylist ist ein geschuetztes Gate. Diese Phase erweitert es, sie
schwaecht es nicht.
**PLAN-SECURITY.md:** die verschobene Schutzlast (Kosten-Achse -> Denylist) dort eintragen.

### KS-P8 — Nutzer sieht Prozent statt Euro (NEU)

**Owner-Entscheidung 2026-07-29:** im Dashboard werden dem Nutzer **keine Kostenbetraege**
angezeigt. Er sieht seine **Monatsnutzung in Prozent**. Begruendung: der Kunde kauft Minuten,
keine Euro — eine EUR-Zahl ist fuer ihn weder handlungsleitend noch verstaendlich, und sie legt
unsere Kostenstruktur offen.

Die Bezugsgroesse existiert bereits und ist die richtige: die **Minuten-Achse**
(`includedMinutesFor` / `planMinutesExceeded`, `billing/plan-caps.js`, `meter.js` `quotaView`).
Sie ist bewusst eine eigene Achse neben der EUR-Achse (kein Doppelzaehlen) und traegt genau das,
was der Kunde gekauft hat.

Umfang: `/api/state.usage` und `public/tenant.html` (Self-Service) — die EUR-Felder verlassen die
Nutzer-Projektion, an ihre Stelle tritt der Prozentwert der verbrauchten Plan-Minuten. Die
Betreiber-Sicht (`public/index.html`) darf Zahlen behalten.

**Offen und in dieser Phase zu entscheiden:** was zeigt die Anzeige einem Tenant **ohne** Plan
(kein `planSlug`, also kein Minuten-Kontingent)? Ein Prozentwert ohne Bezugsgroesse ist
sinnlos — fail-closed waere "kein Kontingent hinterlegt" statt "0 %".

**Erwartetes Ergebnis:** kein EUR-Betrag mehr in der Tenant-Projektion; ein Test greppt die
Antwort von `/api/state` fuer einen Nicht-Betreiber auf Waehrungsfelder.
**Abhaengigkeit:** nach KS-P4 und nach KS-P5 (E5, Buchungssatz vs. Plan-Decke) — sonst zeigt die
Prozentanzeige denselben Fehler, nur in einer anderen Einheit.

---

## Pre-Mortem

Ein Jahr spaeter, der Umbau ist gescheitert. Was ist passiert?

**TOD 1 — Ein Kunde telefoniert zwei Stunden nach Kuba.** KS-P0 senkte den Tarif, KS-P3 hob die
Zeitgrenze, und die Live-Messung aus KS-P2 rechnet mit **unserem** 30-ct-Satz statt mit dem
echten Zielpreis. Der Anruf laeuft, bis die Zeitgrenze greift, und kostet ein Vielfaches des
Reservierten.
*Gegenmittel:* keines, das den Mechanismus trifft — das ist die ehrliche Fassung. Die
Reihenfolge (KS-P3 nicht vor KS-P2) aendert am Tarif-Irrtum nichts, und die erste Fassung hat
den Restschaden um Groessenordnungen unterschaetzt. Die tatsaechlichen Zahlen:
*(a)* Nicht "ein Anruf". Reserve UND gebuchter Schaetzwert skalieren beide mit dem Tarif; die
Reserve wird bei Call-Ende wieder freigegeben (`releaseOutboundReserve` `state-ops.js:2710`),
uebrig bleibt der gebuchte Schaetzwert. Maximale Carrier-Minuten je Tenant und Periode, bevor
der Schaetzwert sperrt = Decke / Tarif: heute (300 ct, 1500 ct Decke) **5 min**; nach
KS-P0+KS-P3 **50 min** — Faktor 10. Unter einer Starter-Decke (300 ct) sind es 10 Minuten, aber
gegen eine 3-EUR-Decke.
*(b)* Die zweite Linie ist nicht "danach": Cost-Truing setzt fruehestens nach
`COST_TRUING_DELAY_MINUTES=30` an (`config.js:513`) und laeuft im Sweep-Takt von einer Stunde
(`config.js:523-527`, `.env.example:309`). Das Fenster, in dem das Gate nur den 30-ct-Schaetzwert
sieht, ist bis zu ~1,5 Stunden lang — mehr als genug fuer die volle Serie.
Wer das nicht tragen will, laesst KS-P3 aus — B2 ist ein Komfort-, kein Sicherheitsbefund. E2
und E3 sind gegen diese Zahlen zu entscheiden, nicht gegen "ein Anruf" (s. E2/E3).

**TOD 2 — Der Live-Zaehler blockiert legitime Anrufe.** KS-P2 rechnet die laufende Minute mit,
und weil die Reserve **zusaetzlich** gebucht ist, zaehlt der Anruf doppelt gegen sich selbst und
legt nach 60 Sekunden auf.
*Gegenmittel:* `budgetExceeded` ignoriert die Reserve heute bewusst — genau deshalb. Die
KS-P2-Formel darf nur den **gebuchten** Verbrauch plus die laufende Zeit addieren, nie
`reservationFor`. Ein Test pinnt das mit einer aktiven Reserve.

**TOD 3 — KS-P5 oeffnet die Decke rueckwirkend.** Die Zuordnung greift auf den falschen
Zeitstempel (Korrektur statt Belastung), und Gutschriften aus abgeschlossenen Perioden weiten die
Decke doch auf.
*Gegenmittel:* der Test fuer den Vorperioden-Fall ist der Blocker, nicht der Happy Path.
Mutationsprobe: Zuordnung absichtlich auf `nowIso` umstellen, der Test muss rot werden. Zusatz
gegenueber der ersten Fassung: der Bezug ist der Anker der **Belastung**, nicht `call.startedAt`
(s. KS-P5) — und der Test laeuft in beiden Flag-Stellungen, weil die Perioden-Achse den Schutz
heute gar nicht hat.

**TOD 4 — Das Dashboard zeigt nach KS-P4 andere Zahlen, der Owner haelt es fuer einen neuen
Bug.** Die Aenderung ist korrekt, wirkt aber wie eine Verschlechterung — und am Monatsersten wie
eine Datenloeschung.
*Gegenmittel:* im Phasenbericht **beide** Richtungen ausdruecklich als erwartete Nebenwirkung
fuehren (hoeher bei Flag AN, niedriger/gleich bei Flag AUS, Sprung auf 0 zum Perioden-/
Monatswechsel).

**TOD 5 — Ein Neustart trifft ein 30-Minuten-Gespraech, der Timer ist weg, der Anruf laeuft bis
der Provider ihn beendet.** Genau B6.
*Gegenmittel:* KS-P1 hat das beantwortet: Boot-Re-Arm und Re-Attach existieren und greifen —
ausser im Assistant-Shim. Deshalb ist KS-P1b Vorbedingung von KS-P3, nicht optional. Der
Provider-Cap taugt **nicht** als Ersatz: er ist unser eigener `maxDur` und laut Adapter-Kommentar
unbestaetigt honoriert.

**TOD 6 — Ein Deploy trifft mehrere laufende Anrufe, der Reserve-Ledger ist leer, und die
Gleichzeitigkeits-Bremse ist offen.** `s.reservations` ist **strukturell ephemer**: nie
persistiert, nie hydriert (`state-ops.js:2661` "Strukturell ephemer (nie persistiert/hydriert)";
`json.js:298-306` filtert `reservations` beim Speichern heraus; `pg.js:395` "Reine
In-Memory-Mutation auf dem Spiegel (kein save/Flush)"; `rowToCall` hydriert `reserveCents`
nicht). Nach einem Neustart sieht `reserveExceedsBudget` `reservationFor = 0` und
`globalReserveExceedsBudget` `reservationsTotal = 0`, waehrend N Calls beim Provider weiterlaufen,
deren Kosten noch nicht gebucht sind — in diesem Fenster ist **jede** Achse blind, und ein neuer
Outbound reserviert gegen einen Cap, der die laufende Exposition nicht kennt. Heute dauert das
Fenster hoechstens 180 s; nach KS-P3 bis zu 1800 s. Die Asymmetrie ist beweisbar: fuer die
Zeitachse existiert der Boot-Re-Arm (`call-lifecycle.js:142`, `boot.js:563`), fuer den
Reserve-Ledger gibt es kein Gegenstueck.
*Gegenmittel:* KS-P2 darf sich fuer die Gleichzeitigkeit **nicht** auf die Reserve verlassen.
Zwei zulaessige Wege, einer davon ist in KS-P2 zu waehlen und zu begruenden: (a) die Reserve beim
Boot aus den aktiven Calls rekonstruieren (analog `rearmActiveCallTimers`), oder (b) der
Live-Term summiert die verstrichene Zeit **aller** aktiven Outbound-Calls des Tenants — was
zugleich TOD 7 deckt und keine Migration braucht. Die blosse Zusage "die Reserve bleibt
unangetastet" ist nach einem Deploy leer.

**TOD 7 — Ein Tenant fuehrt mehrere Anrufe gleichzeitig, und der Live-Term misst zu wenig.** Der
Live-Term ist call-lokal: jeder Turn sieht `gebucht + eigene verstrichene Zeit`; die laufende Zeit
der uebrigen N-1 Calls faellt unter den Tisch, weil `budgetExceeded` (`state-ops.js:2427`) die
Reserve laut TOD 2 nicht addieren darf. Das ist keine Doppelzaehlung, sondern eine
**Unterzaehlung**. Die Groesse, die diese Luecke heute deckt, ist genau die Reserve — die laut
TOD 6 keinen Neustart ueberlebt.
*Gegenmittel:* dieselbe Entscheidung wie TOD 6, Variante (b) deckt beide. Wird stattdessen (a)
gewaehlt, haelt KS-P2 ausdruecklich fest, dass die Gleichzeitigkeit weiterhin allein von der
Reserve gedeckt ist.

**TOD 8 — Der erste zahlende Kunde ist nach 10 von 30 verkauften Minuten gesperrt.** Die
Plan-Decke ist 300 ct (Starter) bzw. 900 ct (Business) und schlaegt
`DEFAULT_TENANT_BUDGET_CENTS`; bei 30 ct/min Buchungssatz reicht sie fuer ein Fuenftel der
verkauften Minuten. Kein Boot-Guard prueft das — `spendCapCoherence` sieht nur die Default-Decke,
`planCapInertFindings` nur den Plattform-Cap. Der Dienst bootet gruen, der Kunde bekommt 402,
sein kostenloser Inbound wird abgewiesen, und ein laufender Call wird aufgelegt.
*Gegenmittel:* KS-P3a (Boot-Guard gegen `MIN(planCapCents)` + Kalibrierung von Buchungssatz und
`voiceCapRateCentsPerMin` als EINE Entscheidung, E5). KS-P3 laeuft nicht davor.

**TOD 9 — Eine Gutschrift sperrt den Tenant.** KS-P5 leitet negative Korrekturen ueber
`bookCents` und entfernt damit unbeabsichtigt den 0-Boden von `costCents`, der ausschliesslich im
`else`-Zweig von `bookCostCorrectionCents` (`state-ops.js:2257`) sitzt. `isBookableCents`
(`defaults.js:220`) verlangt `x >= 0`; ein negativer Wert laesst `spendOrDeny` mit `deny`
antworten, `budgetExceeded` liefert **true**, der Tenant ist mit Grund `usage_korrupt` gesperrt.
Parallel landet ein negativer `spendMonthCostCents` ueber `platformSpendMonthCents`
(`state-ops.js:2376`) in der Plattform-Summe und weitet die Decke fuer ALLE Tenants.
*Gegenmittel:* beide Riegel sind Abnahmekriterien von KS-P5 (0-Boden fuer `costCents` erhalten,
`Math.max(0, …)` fuer `spendMonthUsageCents`), jeweils mit Mutationsprobe.

**TOD 10 — Der Live-Messwert ist still AUS.** Ein Call ohne `answeredAt` (verlorener
Answer-Webhook, Re-Attach nach Instanzwechsel) liefert ueber `callStartAnchorMs`
(`state-ops.js:517-519`) NaN. Erbt KS-P2 die `metering.js:31`-Konvention, ist der Call live
UNGEMESSEN (`gebucht + 0 >= cap`) — die Phase repariert B3 genau fuer die Calls nicht, bei denen
die Buchhaltung ohnehin schief steht. Laesst KS-P2 NaN durch, ist `gebucht + NaN >= cap` immer
false: das Gate ist still AUS, ohne Log, ohne Symptom. Ein NTP-Ruecksprung liefert eine negative
verstrichene Zeit und damit einen Verbrauch UNTER dem gebuchten Wert.
*Gegenmittel:* KS-P2 Abnahmekriterium 5 — `max(0, …)` plus D7-Kante fuer einen nicht auswertbaren
Anker, mit zwei Tests.

**TOD 11 — Der Plattform-Notaus wird mid-call ueberfahren.** `blockingBudgetAxis` prueft zwei
Achsen; nach KS-P2 misst nur die Tenant-Achse laufend. `globalBudgetExceeded`
(`state-ops.js:2650`) sieht weiterhin nur settled/Monat, und der einzige In-Flight-Schutz
(`globalReserveExceedsBudget`, `state-ops.js:2678`) laeuft ausschliesslich am Dial-Gate — bei um
Faktor 10 gesenkter Reserve. Bei `MAX_BUDGET_EUR=30` und 30-Minuten-Anrufen ist das kein
akademischer Fall.
*Gegenmittel:* bewusst getragen (s. KS-P2 "Nicht im Umfang"), mit E6 als ausdruecklicher
Owner-Entscheidung. Wer es nicht tragen will, gibt beiden Achsen den Laufzeit-Term — die
Plattform-Summe braucht dann die verstrichene Zeit ALLER aktiven Calls.

**TOD 12 — Cost-Truing erstattet auf einer bewiesenen Untermenge zurueck.** KS-P3 hebt die
Gespraechsdauer auf 1800 s, waehrend `POOL_SINCE_MARGIN_MS` (`cost-truing.js:95`) aus dem
300-s-Cap hergeleitet ist. Die Seitenschleife des Adapters endet, bevor der Beleg gefunden ist,
der Pool gilt trotzdem als `complete:true` — und genau diese Rueckerstattung ist die Achse, die
KS-P5 zusaetzlich oeffnet.
*Gegenmittel:* KS-P3 zieht die Marge mit (>= 12x neuer Cap) oder leitet sie aus
`MAX_CALL_DURATION_CAP_S` ab, damit sie beim naechsten Cap-Wechsel nicht veraltet.

---

## Owner-Entscheidungen (Stand 2026-07-29)

**Getroffen — bindend fuer die Umsetzung:**

| | Entscheidung | Folge |
|---|---|---|
| **E1** | Tarif **30 ct/min**. | **ERLEDIGT**: Env gesetzt und deployt, Boot-Banner 13:36:42 zeigt `Worst-Case-Tarif 30 ct/min`. Offen bleibt nur der Code-Fallback (KS-P6). |
| **E2/E3** | **Keine neue feste Maximaldauer.** Die nutzbare Dauer ergibt sich aus dem Restguthaben (`Guthaben / Minutenpreis`), durchgesetzt vom Live-Zaehler. Die Kostenluecke bei teuren Zielen wird ueber die **Sperrliste** geloest, nicht ueber die Uhr. | KS-P3 umgebaut (Reserve von der Maximaldauer entkoppeln + Notbremse), neue Phase **KS-P7** als dessen Vorbedingung. |
| **E4** | **Der Nutzer sieht keine Kostenbetraege.** Monatsnutzung in **Prozent** statt Euro. | neue Phase **KS-P8**; die frueher notierte Nebenwirkung von KS-P4 entfaellt. |
| **E5** | Der Starter-Bug (10 von 30 verkauften Minuten nutzbar) wird **als erste Phase vorgezogen**. | laeuft vor allen anderen Code-Phasen. |
| **E5a** | Dabei zieht **keiner der beiden Saetze** — es darf nur noch EINEN geben. Die Decke wird aus DEMSELBEN Satz abgeleitet, mit dem gebucht wird. | Zwei Zahlen, die jemand synchron halten muss, laufen irgendwann auseinander; genau das ist hier passiert. `voiceCapRateCentsPerMin` entfaellt als eigene Groesse. Folgekette (u.a. `MAX_BUDGET_EUR`) in KS-P5a. |
| **E6** | Die Plattform-Achse bleibt mid-call **vorlaeufig blind**. | benanntes Restrisiko mit Zahl, s. TOD 11. |
| **E8** | **Die Zeit-Notbremse ist keine feste Zahl, sondern leitet sich vom Restguthaben ab:** `Notbremse = Restminuten + 1 Minute Puffer`, gedeckelt durch eine absolute Obergrenze. | Der Schaden eines haengenden Anrufs ist damit immer proportional zum Guthaben statt auf eine willkuerliche Zahl gedeckelt; im Normalbetrieb greift sie nie, weil der Live-Zaehler frueher bindet. Umgesetzt in KS-P3 (b), Neuberechnung beim Re-Attach in KS-P1b. |
| **E10** | **`MAX_BUDGET_EUR` ist kein Gate mehr.** Die Plattform-Achse wird Beobachtung + Warnung; die Sperrwirkung entfaellt. | Ein statischer geteilter Topf kann "wir wachsen" nicht von "etwas ist kaputt" unterscheiden und muesste bei jedem Wachstumsschritt von Hand nachgezogen werden. Der Weglauf-Fall ist an der richtigen Stelle gedeckt (Abo+KYC vor Outbound, `MAX_NUMBERS`, `OUTBOUND_FROZEN`) — am Code belegt. Neue Phase **KS-P9**, CLAUDE.md Regel 1 geaendert, **E9 entfaellt**, der KS-P5a-Blocker (D-1) loest sich auf. |
| **E11** | ~~Ein erschoepftes Budget sperrt niemals Inbound.~~ | **ZURUECKGEZOGEN 2026-07-30, nicht entschieden.** Zwei Fehler: (1) Der Owner hat diese Lockerung nie in eigenen Worten verlangt — sie war ein Vorschlag von mir und wurde faelschlich als getroffene Entscheidung ins Regelwerk geschrieben. (2) Die Begruendung "Inbound bucht nichts" ist falsch: sie gilt nur fuer Carrier-Minuten. Die KI-Token werden in JEDER Schleifenrunde live auf genau die Achse gebucht, die `budgetExceeded` liest (B3, `claude.js:659/:775`) — auch bei Inbound. Ein Inbound-Gespraech kostet also sehr wohl Geld auf der Gate-Achse, und ohne das Gate kann eingehender Verkehr die Tenant-Decke unbegrenzt ueberziehen. Die Frage bleibt offen (s. unten). |
| **Prio** | **Kosten-Kette vor AL-Kette.** | AL-P7/P7b/P10b/P14/P15 warten; die AL-P2-Messung ist durch E1 wieder moeglich und laeuft nebenher. |
| **Reste** | Aufraeumen, alle drei: Spike-Schalter aus master entfernen (`af4a66e`, ersatzlos — nicht "Flag auf 0"), Render-Dienst `hermes-spike-al-p2` (`srv-d9kt9bm1egvs738asd0g`) loeschen, Telnyx-App `AL-P2 Spike Silence` (`3014656686179747728`) loeschen. | eigene Aufraeum-Phase, ohne Code-Review-Zeremonie. |

**Weiterhin offen:**

| | Frage | Empfehlung |
|---|---|---|
| **E7** | Sollen Inbound-Minuten kuenftig Geld kosten? | **jetzt nicht entscheiden.** Befund dazu: fuer Inbound laeuft heute gar kein Cost-Truing (`actual_cost_micro_cents` ist bei ALLEN Inbound-Zeilen NULL) — wir buchen die Kosten nicht nur nicht, wir kennen sie nicht. Bei einem Produkt, dessen Kernfunktion das Entgegennehmen von Anrufen ist, verdient das ein **eigenes Strategiedokument**, zusammen mit der Frage, was Inbound uns ueberhaupt kostet. KS-P2 misst bis dahin nur Outbound. |
| **E9** | ~~Welcher Plattform-Notaus (`MAX_BUDGET_EUR`) traegt N zahlende Kunden?~~ | **ENTFAELLT (2026-07-30).** Die Frage ist durch E10 gegenstandslos: es gibt keine Zahl mehr zu waehlen, weil die Plattform-Achse nicht mehr sperrt. Die Aufstellung aus KS-P5a bleibt als Groessenordnung im Bericht erhalten. |

---

## Zum Verfahren

Nicht jede Phase braucht denselben Apparat:

- **KS-P0** ist eine Env-Aenderung durch den Owner. Kein Branch, kein Review.
- **KS-P1** ist eine Messung, sie ist erledigt und im Dokument beantwortet. Kein Merge.
- **KS-P2, KS-P3, KS-P3a, KS-P5** beruehren Absolute Regel 1 (Budget-Guard,
  Max-Gespraechsdauer). Volles Lean-Template: Worktree, dualer Review (Safety + Clean-Code als
  hartes Gate), Pre-Mortem je Phase, Smoke-Test.
- **KS-P1b** beruehrt den Zeit-Backstop (Absolute Regel 1) und laeuft ebenfalls im vollen
  Template.
- **KS-P4, KS-P6** sind eng umrissen und kippen keine Gate-Entscheidung. Lean-Template ohne
  Sonderbehandlung.

**Definition of Done, zusaetzlich:** KS-P0, KS-P2, KS-P3, KS-P3a, KS-P4 und KS-P5 aktualisieren
`PLAN-SECURITY.md` (CLAUDE.md: "Bei sicherheitsrelevanten Aenderungen: PLAN-SECURITY.md
aktualisieren"). KS-P4 loest dort Restrisiko 3 auf, KS-P5 die Spend-Monat-Haelfte von Restrisiko
2; KS-P0/KS-P3/KS-P3a tragen die neuen Kosten-/Zeit-Kanten mit Zahlen ein. Ein aufgeloestes
Restrisiko, das im Sicherheitsdokument stehen bleibt, vergiftet die naechste Risikoabwaegung.

**Pre-Merge-Gate fuer KS-P0, KS-P6 und KS-P3:** `test/env-docs-spend-cap-coherence.test.js` muss
gruen sein. Er ist der einzige Test, der `config.js`-Fallback, `.env.example` und `render.yaml`
gemeinsam durch `spendCapCoherence` schickt.

Phasen einzeln mergen. **Ausnahme mit Begruendung:** KS-P6 und KS-P3 sind gekoppelt — ein
Rollback von KS-P6 nach gemergtem KS-P3 ist kein Rollback, sondern ein Boot-Refusal. Wer KS-P3
zurueckrollt, rollt KS-P6 nicht mit zurueck; wer KS-P6 zurueckrollen will, muss KS-P3 zuerst
zurueckrollen. Dasselbe gilt fuer KS-P0: ein Zuruecknehmen der Env-Variable auf 300 ist ab
gemergtem KS-P3 ein Totalausfall, kein Rollback.

---

## Geprueft und verworfen

Befunde, die feindselige Pruefer vorgebracht haben und die am Code **nicht** haltbar sind — oder
nur in einer schwaecheren Form, die hier bereits eingearbeitet ist:

- **"Die Wurzelthese faellt vollstaendig, weil die KI-Token-Achse live bucht."** Verworfen in
  dieser Staerke. Die Beobachtung stimmt (B3 ist entsprechend korrigiert), aber B1 und B2 haengen
  weiterhin nachweislich am fehlenden Carrier-Minuten-Messwert. Uebernommen ist die Einschraenkung
  auf zwei statt fuenf Befunde, nicht die Aufgabe der Wurzel.
- **"Der Inbound-Minutensatz ist gar nicht definiert."** Verworfen: `callTariffCentsPerMin`
  (`metering.js:41-42`) behandelt `direction === "inbound"` explizit mit
  `tariffCentsPerMin(call.to, call.to)`. Richtig ist nur, dass fuer Inbound nichts **gebucht**
  wird — in dieser Form uebernommen (KS-P2 Punkt 3, TOD 7-Umfeld).
- **"Die B4-Rechnung ergibt korrekt -1.77 EUR."** Verworfen als Ersatzzahl: `max_duration_s`,
  `reserveCents` und `effectiveCapCents` des betroffenen Anrufs sind nicht mehr rekonstruierbar,
  und dieses Dokument erfindet keine Messwerte. Uebernommen ist die Feststellung, dass die
  Herleitung nicht reproduziert und der Befund rein strukturell zu fuehren ist.
- **"KS-P3 liefert sein eigenes Abnahmekriterium nicht."** Verworfen in dieser Staerke: das
  Kriterium "ein Terminanruf mit Warteschleife laeuft durch" wird sehr wohl erfuellt. Verworfen
  ist nur der Zusatz "das Budget bleibt die bindende Grenze" — der ist bei
  `DEFAULT_TENANT_BUDGET_CENTS=1500` und 30 ct/min arithmetisch falsch (50 min Budget gegen
  30 min Zeit) und in KS-P3 entsprechend gestrichen.
- **"Die 12,84-EUR-Spend-Monat-Zahl ist eine Folge des B5-Bugs."** Verworfen: das ist eine
  plausible, aber unbelegte Kausalannahme. Uebernommen ist nur die strukturelle Aussage, dass die
  Perioden-Fenster-Achse `costCents` nie uebersteigen kann.
