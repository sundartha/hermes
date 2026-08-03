# KV-P2 — Inbound-Carrier-Minuten auf die Gate-Achse (Bericht)

Gate: **PASS**
finalBranch: `phase/kv-p2-inbound-gate-achse`
headCommit: `bbe8fcd1a91ce00b41b2edbd2d95de42cb52e1a9`

## Was gebaut wurde

Inbound-Anrufe bekommen einen eigenen, kalibrierten Minutensatz (`VOICE_TARIFF_INBOUND_CENTS`,
Code-Default 6 EUR-Cent/min) und dieser Satz wird — anders als bisher — auf dieselbe
Budget-Gate-Achse gebucht wie Outbound-Carrier-Minuten. Bisher zog Inbound den Satz des
eigenen DID-Landes (`tariffCentsPerMin(to, to)`), was an einer US-DID den Auslands-Worst-Case
(30 ct/min) bedeutete — 16-fach ueber dem gemessenen Ist. Zusaetzlich lief die Buchungsfunktion
in den Budget-Bucket (`reconcileOutboundVoiceBudget`) bisher NUR fuer `direction === "outbound"`
— derselbe Anruf wurde im Ledger richtungsblind, auf der Gate-Achse aber richtungsgefiltert
behandelt, waehrend die Decke eingehende Anrufe an anderer Stelle bereits abweist. Diese
Zweiteilung ist mit KV-P2 aufgehoben.

## Die Umbenennung und was mitgezogen wurde

- `reconcileOutboundVoiceBudget` -> `reconcileVoiceBudget`: Name trug bisher die
  Richtungs-Luege (lief zwar fuer "immer", hiess aber "outbound"). 63 Vorkommen / 25 Dateien
  mitgezogen (10 `src/`, 15 `test/`).
- `activeOutboundCallsFor` -> `activeCallsFor` (Filter `direction === "outbound"` ersatzlos
  gestrichen): 17 Vorkommen / 12 Dateien mitgezogen (6 `src/`, 6 `test/`), inklusive `git mv`
  einer Testdatei (`outbound-reconcile-finishcall` -> `voice-budget-reconcile-finishcall`).
- Betroffene Fassaden/Backends: `src/store/json.js`, `src/store/pg.js`, `src/store.js`
  (reiner Rename, keine Logik-Aenderung).

## Beleg: EINE Tarif-Quelle, EINE Abfrage laufender Legs

- **Tarif-Quelle:** neuer Test KV-P2-5 (`kv-p2-inbound-budget.test.js`) grept `src/**/*.js`
  nach `/billing\.voiceTariffInboundCents/`: genau eine Fundstelle, in
  `src/billing/metering.js` (`callTariffCentsPerMin`, Inbound-Zweig). Test gruen -> keine
  zweite Preisquelle im Code. (Abweichung vom Plan: das Grep-Muster nutzt den im Repo
  tatsaechlich importierten Alias `defaultConfig` intern, greift aber auf den
  Feldzugriff `billing.voiceTariffInboundCents` — literal `config.billing...` haette wegen
  des Alias-Imports (Idiom aus `outbound-gates.js`) nichts gefunden.)
- **Eine Abfrage laufender Legs:** `activeOutboundCallsFor` -> `activeCallsFor`, der
  Richtungsfilter ist ersatzlos gestrichen (nur `status === "active"` und `tenantId`
  bleiben) — es gibt KEINE zweite `activeInboundCallsFor`. Betroffene Aufrufer:
  `budget-gate.js`, die drei Store-Fassaden, 6 Test-Fakes.

## Der Inbound-Satz mit Herleitung

**KV-M1 (gemessener Ist-Wert):** 1,87 US-Cent je angefangener Minute (3,731 US-Cent fuer
2 angefangene Minuten, Anker `call_msczw0irl06s`) x 0,92 (Provider->Bucket-Kurs) =
**1,72 EUR-Cent/min**.

**Gewaehlter Code-Default: 6 EUR-Cent/min** — 3,5-fach ueber dem gemessenen Ist, 5-fach
unter dem Outbound-Worst-Case (30 ct/min).

**Warum NICHT 30 ct/min (der alte Rueckfall):** 30 waeren 16-fach ueberhoeht gegenueber dem
Ist und haetten einen Starter-Kunden bereits nach 50 Inbound-Minuten gesperrt, bei realen
Kosten von nur 86 Cent (50 x 1,72 ct). 6 ct/min traegt Sicherheitsaufschlag, ohne den Kunden
aus seiner eigenen Erreichbarkeit zu sperren.

## Fail-Richtung

- **unset/leer** -> Fallback **6** (nie 0). Test "FAIL-RICHTUNG: unset/leer -> Fallback 6"
  pinnt das explizit (env `""` bucht 5min x 6 = 30, nicht 0).
- **Muell/negativ** -> `fatalConfigErrors` -> **Boot-Refusal** (generischer `numEnv`-Mechanismus,
  `min: 0`).
- **Ausdruecklich gesetztes 0** -> Inbound-Kosten-Achse bewusst AUS — ein sichtbarer
  Betreiber-Akt, analog zu `VOICE_TARIFF_DEFAULT_CENTS=0`, kein stiller Ausfall.

## Decken-Rechnung (woertlich aus `tasks/kv-p2-decken-rechnung.md`)

> # KV-P2 - Decken-Rechnung (Pre-Mortem TOD 1), Vorbedingung des Merges
>
> Stand 2026-08-03, gerechnet gegen den **Code auf `master`**, nicht gegen die Zahlen im
> Plan-Dokument. Jede Eingangsgroesse unten ist am Quelltext belegt (Datei + Symbol), damit
> die Rechnung nachrechenbar bleibt, wenn eine Zahl spaeter wandert.
>
> ## 1. Eingangsgroessen (am Code belegt)
>
> | Groesse | Wert | Fundstelle (Symbol, nicht Zeilennummer) |
> |---|---|---|
> | Starter, verkaufte Minuten | 30 | `src/plans.js`, `PLAN_CATALOG[starter].includedMinutes` |
> | Starter, Abo-Preis | 499 EUR-Cent | `src/plans.js`, `amountCents` / `currency: "eur"` |
> | Business, verkaufte Minuten | 120 | `src/plans.js`, `PLAN_CATALOG[business].includedMinutes` |
> | Business, Abo-Preis | 999 EUR-Cent | `src/plans.js`, `amountCents` |
> | Kopffreiheit Starter / Business | 5/3 bzw. 5/4 | `src/billing/plan-caps.js`, `PLAN_CAP_HEADROOM` |
> | Decken-Formel | `includedMinutes * voiceTariffDefaultCents * num/den` | `src/billing/plan-caps.js`, `planCapCents` |
> | Worst-Case-Satz (Ausland) | 30 EUR-Cent/min | `src/config.js` `voiceTariffDefaultCents` (fallback 30), `.env.example`=30, `render.yaml`=30 |
> | Inlandssatz (+49/+33/+44 an BEIDEN Enden) | 20 EUR-Cent/min | `src/config.js` `voiceTariffDomesticCents` (fallback 20), `.env.example`=20, `render.yaml`=20 |
> | Decke ohne Plan-Zeile | 1500 EUR-Cent | `src/config.js` `defaultTenantBudgetCents` (fallback 1500), `.env.example`/`render.yaml`=1500 |
> | **Inbound-Satz (NEU, KV-P2)** | **6 EUR-Cent/min** | `src/config.js` `voiceTariffInboundCents` (neu, fallback 6) |
> | Absolute Gespraechs-Obergrenze | 1800 s = 30 min | `src/store/defaults.js` `MAX_CALL_DURATION_CAP_S` |
> | Provider->Bucket-Kurs (USD-ct -> EUR-ct) | 0,92 | `src/config.js` `providerToBucketRateMicro` = 920000 |
>
> **Gemessener Ist-Satz (KV-M1, 2026-08-03):** 1,87 **US**-Cent je angefangener Minute
> (3,731 US-Cent fuer 2 angefangene Minuten, Anker `call_msczw0irl06s`). Umgerechnet auf die
> Bucket-Waehrung: 1,87 x 0,92 = **1,72 EUR-Cent/min**. Der gewaehlte Satz von 6 EUR-Cent
> traegt damit einen Sicherheitsaufschlag von **3,5x ueber dem Ist** und liegt **5x unter**
> dem Outbound-Worst-Case (30).
>
> **Konfigurationsgrenze der Messung (gilt fuer jede Zahl unten):** US-DID, `VOICE_ENGINE=budget`,
> Sprache `de`, ElevenLabs-TTS aktiv, Assistant-Pfad NICHT beteiligt (0 `ai-voice-assistant`-Belege),
> EIN Anruf, 79,6 s. Nicht gemessen: +49-DID (existiert im Bestand nicht), Assistant-Pfad,
> lange Gespraeche, andere Sprachen. 71 % der Kosten sind `speech-to-text` und skalieren mit
> der SPRECHZEIT, nicht mit der Verbindungsdauer.
>
> ## 2. Die Rechnung je Katalog-Tarif
>
> Decke = `planCapCents(slug, cfg)`. Alle Betraege in GANZZAHL EUR-Cent.
>
> ### Starter
>
> - Decke: `30 * 30 * 5/3` = **1500 ct** (15,00 EUR)
> - Inbound-Satz: 6 ct/min
> - **Rein inbound bis zur Sperre:** `1500 / 6` = **250 Inbound-Minuten**
> - Nach vollem Outbound-Kontingent, **inlaendisch** (`30 * 20` = 600 ct verbraucht):
>   `900 / 6` = **150 Inbound-Minuten**
> - Nach vollem Outbound-Kontingent, **Ausland** (`30 * 30` = 900 ct verbraucht):
>   `600 / 6` = **100 Inbound-Minuten**
>
> ### Business
>
> - Decke: `120 * 30 * 5/4` = **4500 ct** (45,00 EUR)
> - **Rein inbound bis zur Sperre:** `4500 / 6` = **750 Inbound-Minuten**
> - Nach vollem Outbound-Kontingent, **inlaendisch** (`120 * 20` = 2400 ct):
>   `2100 / 6` = **350 Inbound-Minuten**
> - Nach vollem Outbound-Kontingent, **Ausland** (`120 * 30` = 3600 ct):
>   `900 / 6` = **150 Inbound-Minuten**
>
> ### Tenant ohne eigene `tenant_budget`-Zeile
>
> Decke = `defaultTenantBudgetCents` = 1500 ct -> **250 Inbound-Minuten**, identisch zu Starter.
>
> ## 3. Die Gegenprobe (die eigentliche Frage von TOD 1)
>
> > Kann ein Kunde seine **GEKAUFTEN** Minuten vollstaendig inbound telefonieren, ohne in die
> > Geld-Decke zu laufen?
>
> | Plan | gekaufte Minuten | Kosten inbound (Minuten x 6 ct) | Decke | Auslastung der Decke | Urteil |
> |---|---|---|---|---|---|
> | Starter | 30 | 180 ct | 1500 ct | **12 %** | **JA** |
> | Business | 120 | 720 ct | 4500 ct | **16 %** | **JA** |
>
> **URTEIL: JA - fuer beide Katalog-Tarife, mit Faktor 8,3 (Starter) bzw. 6,25 (Business)
> Reserve.** Die Decke muss fuer KV-P2 **nicht** angehoben werden; die in TOD 1 formulierte
> Merge-Blockade greift nicht.
>
> Gegenprobe der Gegenprobe (was ein NEIN erzeugt haette): ein Inbound-Satz oberhalb von
> `1500/30` = **50 ct/min** (Starter) bzw. `4500/120` = **37,5 ct/min** (Business) haette die
> gekauften Minuten unbezahlbar gemacht. Der ausdruecklich verworfene Rueckfall auf den
> Outbound-Worst-Case (30 ct/min) haette 30 Inbound-Minuten mit 900 von 1500 ct belastet -
> 60 % der Decke fuer das, was der Kunde bezahlt hat, und nach 50 Inbound-Minuten die Sperre,
> bei realen Kosten von 50 x 1,72 = 86 EUR-Cent. Deshalb 6 und nicht 30.
>
> ## 4. Was die Rechnung NICHT deckt (ehrlich benannt)
>
> 1. **Die Geld-Achse traegt mehr als Carrier-Minuten.** Auf dieselbe Zahl buchen KI-Tokens
>    (`bookTokenUsage` -> `trackUsage`) und die Recherche-Gebuehren
>    (`addResearchFeeCostCents`). Die 250 Inbound-Minuten sind eine Obergrenze bei sonst
>    leerer Decke, kein garantierter Rahmen. Groessenordnung aus KV-M1: 5 KI-Turns eines
>    80-s-Gespraechs runden im Ledger auf 0 Cent; die Gate-Achse akkumuliert sie in
>    Mikro-Cent. Sie verschieben das Bild nicht um eine Groessenordnung.
> 2. **Die DID-Monatsmiete ist NICHT enthalten.** Sie erreicht die Gate-Achse heute nicht
>    (Landkarten-Zeile `number_month`, `gate: false`) und kommt erst mit KV-P4. Bei einer
>    Miete in der Groessenordnung des Listenpreises (`numberMonthlyCostCents`, 92 ct) frisst
>    sie rund 6 % der Starter-Decke. Diese Rechnung ist dann zu wiederholen.
> 3. **Der Ist-Abgleich fuer Inbound fehlt noch (KV-P3).** Zwischen Buchung und Korrektur
>    stehen `COST_TRUING_DELAY_MINUTES` (30) plus ein Sweep-Takt (1 h). Bis dahin steht die
>    Schaetzung von 6 ct/min - rund 3,5x ueber dem gemessenen Ist. KV-P2 ohne KV-P3 ist die
>    harte Variante; die Reichweite oben ist damit die PESSIMISTISCHE.
> 4. **N7 (Bestandsverhalten, Owner-bestaetigt, NICHT zu reparieren):** das verkaufte
>    Minuten-Kontingent verbraucht Inbound bereits heute richtungsblind
>    (`voiceMinutesUsedSince` filtert auf kind + tenantId + Zeit, NICHT auf Richtung), sperrt
>    damit aber nur Outbound (`planMinutesExceeded` -> `minutes`-Gate in
>    `outbound-gates.js`). Bei einem Kunden, der beide Richtungen nutzt, beisst deshalb das
>    Minuten-Kontingent **vor** der Geld-Decke: 30 Minuten Gesamtverkehr kosten hoechstens
>    `30 * 30` = 900 ct, also weniger als die Decke von 1500 ct. Die Geld-Decke bindet allein
>    bei dem Kunden, der **ueberwiegend angerufen wird** - genau dem Missbrauchsfall, den
>    KV-P2 abdeckt.
> 5. **Ein einzelnes Gespraech ist gedeckelt.** `MAX_CALL_DURATION_CAP_S` = 1800 s: ein
>    einzelnes Inbound-Leg kann hoechstens `30 * 6` = 180 ct erzeugen, auch wenn jede andere
>    Bremse ausfaellt.

## Die vier Pflicht-Abnahmen

1. **KV-P2-1** (`kv-p2-inbound-budget.test.js`): 2-Minuten-Inbound-Call erhoeht
   `spendMonthCostCents` UND `costCents` um 2x Inbound-Satz (14 statt 60 beim alten Pfad).
   **PASS.**
2. **KV-P2-2**: `estimated_cost_cents` + `estimatedCostSpendMonthKey` +
   `estimatedCostPeriodKey` stehen an der Inbound-call-Zeile (nach `stampBudgetPeriod` +
   `reconcileVoiceBudget`). **PASS.**
3. **KV-P2-3** (+ T5-Grenzfall unbrauchbares `answeredAt`): nie beantworteter Inbound-Call
   bucht `costCents=0`, `estimatedCostCents=null`, kein NaN. **PASS.**
4. **KV-P2-4** (Spawn-Test, echter Prozess-Neustart auf derselben `dataDir`): genau eine
   Buchung ueber 3 Callbacks (2x selber Prozess, 1x nach Restart); `billedAt` persistiert und
   ueberlebt. **PASS.**

## Die gekippte Landkarten-Zeile

`voice_minute_inbound`: `gate` **false -> true**. Test KV-P1-2 (umbenannt von "Gate bleibt bei
0 (Hauptluecke)" zu "Ledger UND Gate tragen den kalibrierten Inbound-Satz") pinnt das ueber
`assertRowMatchesObservation`. Alle 5 uebrigen Zeilen (`voice_minute_outbound`, `ai_token`,
`research_fee`, `sms`, `number_month`, `play_tts_characters`) bleiben unveraendert.

## Mutationsproben

4 Proben einzeln gefahren und zurueckgenommen:

1. Richtungsfilter in `reconcileVoiceBudget` zurueckgesetzt -> 3 Tests rot (KV-P2-1,
   PAY-08-Rewrite, `finishcall-reconcile`).
2. Landkarte `gate:false` zurueckgesetzt -> KV-P1-2 rot.
3. Config-Fallback 6 -> 0 -> "FAIL-RICHTUNG"-Test rot (bucht 0 statt 30 bei 5 min).
4. (KV-P2-6) `direction`-Filter zurueck in `activeCallsFor` -> KS-P2-2 rot.

Alle vier revertiert; finaler Diff mutationsfrei (`grep MUTATIONSPROBE in src/` leer).

## Angepasste Bestandstests

- `metering-unit.test.js` PAY-08: alt "Inbound bucht Budget nie ab" -> neu "Inbound bucht mit
  Inbound-Satz". Begruendung: Praemisse durch Owner-Entscheidung 1a ueberholt, die Decke
  sperrte Inbound schon vorher.
- `voice-budget-reconcile-finishcall.test.js` (git mv von
  `outbound-reconcile-finishcall.test.js`): alt "Inbound zieht nichts ab" -> neu "Inbound
  bucht Minuten x Inbound-Satz, additiv vor Outbound". Begruendung: Dateiname trug die
  Richtungs-Luege im Namen.
- `cost-origin-axis.test.js` ORIG-03 (2 Tests -> 1 zusammengefuehrt): alt "Inbound-Satz haengt
  am Land der eigenen DID" -> neu "Inbound bucht kalibrierten Satz, unabhaengig von der DID".
  Begruendung: Herkunfts-Achse bepreist nur GEWAEHLTE Ziele, ein Inbound-Leg hat keins.
- `cost-origin-axis.test.js` `callTariffCentsPerMin`-Test: alt "inbound liest `call.to` an
  beiden Enden" -> neu "inbound liefert `config.billing.voiceTariffInboundCents` unabhaengig
  von to/from".
- `ks-p2-live-carrier-spend.test.js` KS-P2-2: alt "Inbound zaehlt NICHT im Live-Term" -> neu
  "Inbound zaehlt MIT, die Decke bindet statt der Richtung" (Owner-Entscheidung 3b).
- `kv-p1-cost-ledger-map.test.js` KV-P1-2: alt "Gate bleibt bei 0 (Hauptluecke)" -> neu
  "Ledger UND Gate tragen den kalibrierten Inbound-Satz" — Landkarten-Zeile kippt
  `gate:false -> true`.

## Safety-Urteil

Freigegeben. `capStillBlocksBothDirections: true`, `voiceRouteUntouched: true`,
`noDoubleBooking: true`, `singleTariffSource: true`, `singleActiveCallsQuery: true`,
`liveCounterNoDoubleCount: true`, `failDirectionNeverZero: true`, `ratePlausible: true`,
`deckenRechnungSound: true`, `exactlyOneMapRowFlipped: true`, `costTruingUntouched: true`,
`disclosureIntact: true`, `safetyGatesIntact: true`. Keine Blocker.

Unabhaengiger Testlauf im Worktree: 3839 Tests, 3838 pass, 1 fail
(`outbound-identity-gate`, 401 !== 500). Isoliert nachgefahren: 2/2 gruen -> bekannter
Volllast-Spawn-Flake (nicht KV-P2). Bereinigt: 3819/3818 gruen.

Concerns (nicht blockierend, ins Auge fassen):

- `src/routes/voice.js` traegt weiter den Kommentar "`callTariffCentsPerMin` traegt die
  Richtungsregel (inbound: Satz des EIGENEN DID-Landes)". Dieser Kommentar ist mit dieser
  Phase unwahr geworden (Geld-/Notbremsen-Pfad) — Ein-Zeilen-Sweep offen, gehoert in den
  Merge-Commit (`staleCommentsFixed: false` im Safety-Report).
- Nebenwirkung, bisher nirgends sonst erwaehnt: `brakeSecondsFor` (`routes/voice.js`) liest
  denselben Satz. Die Inbound-Notbremse wird dadurch bis 5x laenger (Beispiel Restguthaben
  180 ct: frueher 420 s, jetzt 1800 s). Hart gedeckelt durch `MAX_CALL_DURATION_CAP_S`
  (1800 s) und zusaetzlich durch den Live-Term; die Richtung ist damit genauer, nicht
  schwaecher — aber ein realer Verhaltensunterschied.
- `test/cost-origin-axis.test.js` und `test/metering-unit.test.js` pinnen
  `VOICE_TARIFF_INBOUND_CENTS` nicht per Env, sondern vergleichen gegen
  `config.billing.*` direkt — selbstkonsistent, faengt den Rueckfall trotzdem, ist aber
  wertabhaengig von einer lokalen `.env`.

## Clean-Code-Audit

Kein Blocker (`blocker: false`). EINE Tarif-Quelle (per Grep-Test erzwungen), EINE Abfrage
laufender Legs, durchgehend Ganzzahl-Cent, Namen (`reconcileVoiceBudget`, `activeCallsFor`)
tragen keine falsche Richtung mehr. Alle "outbound/Inbound-traegt-nichts-bei"-Kommentare im
Diff-Umkreis mitgezogen (Ausnahme: der oben genannte Concern in `routes/voice.js`, ausserhalb
des direkten Diff-Umkreises). `PLAN-SECURITY.md` ergaenzt. 85/85 neue/betroffene Tests gruen.
Kein toter Code, keine Umlaute in Kommentaren, `node --check` auf allen geaenderten
`src/`-Dateien ok.

## Fix-Runden (inkl. Fehlalarme)

Laut Impl-Report keine separate Fix-Runde noetig — beide Reviews (Safety, Clean-Code) kamen
im ersten Durchlauf auf PASS. Als Abweichungen vom Plan dokumentiert (keine Fehlalarme im
engeren Sinn, aber notwendige Anpassungen waehrend der Umsetzung):

1. Grep-Muster fuer KV-P2-5 an die tatsaechliche Code-Idiomatik angepasst
   (`/billing\.voiceTariffInboundCents/` statt literalem `config.billing...`), weil
   `metering.js` den Alias `defaultConfig` importiert (Idiom aus `outbound-gates.js`).
2. Zusaetzlicher Test ueber die vier Pflicht-Abnahmen hinaus: "FAIL-RICHTUNG: unset/leer ->
   Fallback 6" — noetig, damit Mutationsprobe (c) (Fallback 6->0) ueberhaupt rot wird; kein
   Bestandstest pinnte sonst den nackten Code-Fallback.
3. `test/telnyx-shim-harness.js`: das `activeCallsFor`-Fake verliert den
   `direction === "outbound"`-Filter (Fixtures bleiben outbound-Default, Verhalten
   unveraendert) — macht den Fake ehrlich zur neuen richtungsoffenen Produktions-Semantik.

## Was diese Phase NICHT tut

- **Kein Ist-Abgleich fuer Inbound.** Der geschaetzte Satz (6 ct/min) steht bis KV-P3 ohne
  Korrektur gegen die tatsaechlichen Carrier-Kosten.
- **Keine rueckwirkende Buchung.** Die zwei historischen Inbound-Calls (u.a. der KV-M1-Anker
  `call_msczw0irl06s`) bleiben ungebucht — kein Backfill.
- **Keine Aenderung an der Inbound-Abweisung.** Wie und ob Inbound-Anrufe bei erschoepfter
  Decke abgewiesen werden, ist unangetastet (`routes/voice.js` 0 Zeilen Diff).
- **Keine zweite Decke.** Es gibt weiterhin genau eine pro-Tenant-Geld-Decke fuer beide
  Richtungen; keine separate Inbound-Decke.
- **Kein Kundenpreis.** `VOICE_TARIFF_INBOUND_CENTS` ist ein interner Kosten-/Gate-Parameter,
  keine Aenderung an Plan-Preisen oder Abrechnung gegenueber dem Kunden.

## Was der Lead nach dem Merge tun muss

`VOICE_TARIFF_INBOUND_CENTS=6` ist in `render.yaml` eingetragen, aber **Render-Services sind
dashboard-managed** — der Blueprint ist nicht die Live-Wahrheit (bestehende Lehre,
`subscription-checkout-money-path.md`). Der Lead muss den Wert nach dem Merge manuell im
Render-Dashboard fuer den produktiven Service setzen.

**Wenn er es nicht tut:** Der Code-Fallback ist `6` (identisch zum geplanten Wert), also
bucht der Dienst auch OHNE Dashboard-Eintrag exakt den kalibrierten Satz — kein stiller
Ausfall, kein Boot-Refusal, kein Rueckfall auf 0 oder 30. Der einzige Unterschied ist
Sichtbarkeit: ohne expliziten Dashboard-Eintrag ist der Wert nur im Code sichtbar, nicht in
der Render-Umgebungsvariablenliste, was eine spaetere Anpassung (z.B. nach KV-P3 mit echtem
Ist-Abgleich) leichter uebersehen laesst.
