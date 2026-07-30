# Phase KS-P5a — Starter-Kunde bekommt die verkauften Minuten (E5/E5a)

**Gate:** PASS
**finalBranch:** `phase/ks-p5a-starter-minuten` (Basis `master` @ `6ad5e5d`)

**Fachliche Abnahme in einem Satz, am Code nachrechenbar:**
`planCapCents("starter", {voiceTariffDefaultCents: 30}) === 1500` und
`1500 ≥ 30·30 + 30·5 = 1050` — der Starter-Kunde telefoniert seine 30 verkauften Minuten
inklusive des letzten Anrufs, ohne dass die EUR-Decke vorher greift.

---

## Aufstellung (Grundlage fuer Owner-Entscheidung E9)

### 1. Welcher Satz wird tatsaechlich gebucht?

Die Gate-Achse (`usage.costCents`, gelesen von `budgetExceeded`/`reserveExceedsBudget`)
bekommt Voice-Minuten **ausschliesslich** ueber `reconcileOutboundVoiceBudget` →
`addVoiceUsageCostCents` (`src/billing/metering.js`). Der Satz kommt aus
`callTariffCentsPerMin` → `tariffCentsPerMin` (`src/telephony/outbound-gates.js`):

| Fall | gebuchter Satz | Fundstelle |
|---|---|---|
| **Inland** (dieselbe bekannte Vorwahl aus `voiceTariffDomesticPrefixes` an Ziel UND Absender) | `voiceTariffDomesticCents` = 20 ct/min | `isDomesticLeg` / `tariffCentsPerMin` |
| **Alles andere**, inkl. des Live-Falls US-DID → DE-Mobil | `voiceTariffDefaultCents` = **300 ct/min (Code)** / **30 ct/min (live)** | `tariffCentsPerMin` (Worst-Case-Zweig) |
| Ziel oder Absender ohne aufloesbare Vorwahl | Worst-Case-Zweig (fail-closed) | `isDomesticLeg` → `null` |
| **Inbound** | bucht **nichts** auf die Gate-Achse (`reconcileOutboundVoiceBudget` steigt bei `direction !== "outbound"` sofort aus). `recordVoiceMinuteMeter` schreibt nur ein `usageEvent` (Stripe-Meter/Ledger) — `recordUsageEvent` fasst den Budget-Bucket nicht an | `src/billing/metering.js` |
| **Assistant-Pfad AN vs. AUS** | **kein Unterschied am gebuchten Voice-Satz** — `tariffCentsPerMin` haengt nur an `to`/`from`. Der Assistant-Pfad wirkt auf die *Ist*-Kosten (0,094 USD/Anruf) und auf die Schwelle `voiceTariffFullCostFloorCents` (10 statt 5), nicht auf die Buchung | `tariffCentsPerMin`, `voiceTariffFullCostFloorCents` |
| (Nachbar-Buchungen auf derselben Achse) | KI-Token (`trackUsage`, Mikro-Cent-Carry), SMS (`smsCostCents`), Suchgebuehr, Korrekturbuchung (`applyCostCorrectionCents`) | `src/store/state-ops.js` |

**Fazit 1:** Die Decke muss gegen `voiceTariffDefaultCents` gerechnet werden — den
Worst-Case-Zweig. Inland (20) bucht guenstiger und passt darunter erst recht; die Decke irrt
damit weiterhin nach oben, wie es eine Decke soll.

### 2. Welche Decke folgt daraus je Plan?

Formel nach der Aenderung: `includedMinutes * voiceTariffDefaultCents * num/den` mit
Kopffreiheit Starter 5/3, Business 5/4. Ganzzahligkeit ist fuer **jeden** ganzzahligen Satz T
garantiert: Starter `30·T·5/3 = 50T`, Business `120·T·5/4 = 150T`.

| Plan | verkauft | Decke bei T=30 (live) | Decke bei T=300 (Code-Fallback) | Kosten der verkauften Minuten (T=30) | Kopffreiheit-Rest | getragene Minuten |
|---|---|---|---|---|---|---|
| Starter | 30 min | **1500 ct (15 €)** | 15000 ct (150 €) | 900 ct | 600 ct | 50 (≥ 30 ✓) |
| Business | 120 min | **4500 ct (45 €)** | 45000 ct (450 €) | 3600 ct | 900 ct | 150 (≥ 120 ✓) |

**Der letzte Anruf zaehlt mit.** Worst-Case-Reserve eines Anrufs =
`T · ceil(MAX_CALL_DURATION_CAP_S/60)` = `T·5` (`MAX_CALL_DURATION_CAP_S = 300`,
`src/store/defaults.js`). Damit der Kunde die *letzte* verkaufte Minute noch anrufen darf,
muss gelten `M·T + 5·T ≤ M·T·num/den`, also `M ≥ 7,5` (Starter, 5/3) bzw. `M ≥ 20`
(Business, 5/4). Mit 30 bzw. 120 verkauften Minuten ist beides erfuellt —
**satzunabhaengig**. Genau das pinnt der neue Test.

### 3. Welcher Plattform-Cap traegt N gleichzeitig ausschoepfende zahlende Kunden?

Bei T=30 ct/min, Worst-Case-Lesart (jeder Tenant brennt seine **volle Decke** ab):

| N | nur Starter (15 €/Kunde) | nur Business (45 €/Kunde) |
|---|---|---|
| 1 | 15 € | 45 € |
| 3 | 45 € | 135 € |
| 5 | 75 € | 225 € |
| 10 | 150 € | 450 € |

Realistische Lesart (nur die **verkauften Minuten** werden telefoniert: Starter 9 €,
Business 36 €):

| N | nur Starter | nur Business |
|---|---|---|
| 1 | 9 € | 36 € |
| 3 | 27 € | 108 € |
| 5 | 45 € | 180 € |
| 10 | 90 € | 360 € |

Faustformel (Decken-Lesart, T=30): `MAX_BUDGET_EUR ≥ 15 € · N_starter + 45 € · N_business`.
Bei T=300 (heutiger Code-Fallback) das Zehnfache.

### 4. Was traegt der heutige Wert 3000 ct (30 €), und ab welchem N klemmt er?

**Er klemmt bei keinem N mehr** — seit KS-P9/E10 trifft die Plattform-Achse keine
Sperrentscheidung; `MAX_BUDGET_EUR` ist die Bezugsgroesse von `PLATFORM_SPEND_WARN_PERCENT`
(Render: 80) und der Pro-Tenant-Fallback bei Sentinel `DEFAULT_TENANT_BUDGET_CENTS=0`. Statt
„klemmt" lautet die Frage „ab wann warnt er":

| Lesart (T=30) | erste Warnung (80 % = 2400 ct) | Schwelle 3000 ct ueberschritten |
|---|---|---|
| Decken-Summe | 2 Starter (3000) bzw. 1 Business (4500) | 2 Starter / 1 Business |
| tatsaechlich verkaufte Minuten | 3 Starter (2700) bzw. 1 Business (3600) | 4 Starter / 1 Business |

Also: **30 € tragen heute drei bis vier Starter-Kunden oder null Business-Kunden, bevor die
Warnung dauerhaft feuert.** Zusatz-Vorbehalt: `BUDGET_MONTH_ENABLED` steht in Code und
`render.yaml` auf `false` (Lebenszeit-Topf), laut Betriebsnotiz live seit 07-25 auf `true`
(Perioden-Topf) — die Tabelle gilt je nach Flag „pro Periode" oder „einmalig fuer immer". Im
Lebenszeit-Modus ist der Wert nach dem ersten Monat mit drei Startern dauerhaft ueber der
Warnschwelle, und die Warnung ist ab dann Rauschen.

**Die Zahl selbst ist Geschaeftsentscheidung E9 und wurde in dieser Phase nicht angefasst**
(weder Code-Default noch `.env.example` noch `render.yaml`).

---

## Design-Entscheidungen

- **D-1 (E5a woertlich):** `voiceCapRateCentsPerMin` entfaellt **ersatzlos** — Env-Key,
  config-Eintrag, Namespace-Eintrag, `.env.example`, `render.yaml`. Kein Synchron-Halten
  zweier Zahlen, keine Alias-Bruecke, kein Deprecation-Schalter.
  **Feststellung zur Spec-Pflichtfrage** („darf `deriveTenantBudgetFromPlan` die Plan-Decke
  noch klemmen?"): **Die Klemme ist bereits weg — KS-P9 hat sie entfernt.** Im Code steht an
  der Stelle nur noch der Begruendungskommentar. In dieser Phase wurde daran **nichts**
  editiert. Damit ist die urspruengliche D-1 des ersten Laufs (`PLAN_CAP_INERT` von FATAL
  auf WARN senken) gegenstandslos: `PLAN_CAP_INERT`, `planCapInertFindings` und
  `tenantCapRowInertFindings` existieren seit KS-P9 nicht mehr. **Kein Boot-Guard wurde
  abgesenkt.**
- **D-2 (Satz 0 darf keine 0-Decke schreiben):** `voiceTariffDefaultCents` ist per `min: 0`
  abschaltbar, und die gesamte Spawn-Suite faehrt `VOICE_TARIFF_DEFAULT_CENTS: "0"`
  (`test/helpers.js` BASE_ENV). Eine 0-Decke waere kein strengeres Gate, sondern
  Telefonie-Totalausfall fuer den Tenant (`effectiveCapCents` liefert die Zeile,
  `budgetExceeded` ist ab dem ersten Cent true). Behandlung an der **Schreibkante**
  (`deriveTenantBudgetFromPlan`), nicht in `planCapCents` — das Modul sagt selbst, die
  No-op-Entscheidung liege an der Schreibkante. Idiom-Vorbild im selben Modul:
  `seedTenantDefaultBudget` („0/undefined -> kein Seed (kein 0-Cap-Tenant)"). Eigenes
  Grund-Label `grund=tarif_null`, getrennt von `grund=slug_unbekannt` — zwei Sachverhalte
  teilen sich keine Log-Zeile.
- **D-3 (kein neues Gate, kein neuer Schalter):** keine neue Env, keine neue Dependency,
  keine neue Quelldatei im `src/`-Baum. Genau eine neue Testdatei.
- **D-4 (Boot-Guards unangetastet):** kein `fatal: true → false`.

**Pre-Mortem (vorab benannt).** Gescheitert waere die Phase, wenn (a) irgendwo eine 0-Decke
geschrieben wuerde und ein Kunde stumm nicht mehr telefonieren koennte → D-2 + eigener Test;
(b) die Decke so hoch waere, dass ein Bug Geld verbrennt → die Tenant-Decke bleibt *das*
Geld-Gate in voller Schaerfe, sie steigt nur auf die verkaufte Menge, und Abo+KYC,
`OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, Per-Target-Cap, Max-Dauer,
Signaturpruefung sind unberuehrt; (c) jemand spaeter wieder einen zweiten Deckel-Satz
einfuehrt → der Key ist ersatzlos weg, `planCapCents` liest denselben Wert wie
`tariffCentsPerMin`, und der neue Test rechnet die Invariante an **beiden** Saetzen nach.

---

## Umsetzung

**Produktivcode (3 Dateien, 4 semantische Aenderungen):**

- `src/billing/plan-caps.js` — der eine Ausdruck liest `cfg.voiceTariffDefaultCents` statt
  `cfg.voiceCapRateCentsPerMin`; Kopffreiheit- und Formel-Kommentar auf die neue Wahrheit
  (inkl. der Invariante `M·T + 5·T ≤ M·T·num/den`). Signatur `planCapCents(slug, cfg)`
  unveraendert.
- `src/config.js` — `voiceCapRateCentsPerMin` samt Env-Lesung ersatzlos geloescht; der
  gemeinsame Tarif-Kommentar nennt jetzt den vierten Konsumenten (Plan-Decke) und die
  0-Satz-Semantik; `CONFIG_NAMESPACES.billing` 36 → 35 Keys.
- `src/store/state-ops.js` — `deriveTenantBudgetFromPlan`: neuer Fall (4) im Doc-Header plus
  No-op-Zweig `capCents <= 0` mit `console.warn(... grund=tarif_null ...)`.

**Konfiguration/Doku (4 Dateien):** `.env.example` (Block geloescht, zwei erklaerende Zeilen
ueber `VOICE_TARIFF_DEFAULT_CENTS`), `render.yaml` (dito), `PLAN-SECURITY.md` (neuer
Abschnitt `KS-P5a`), `STATUS.md` (Punkt 10 ersetzt — die falsche Aussage wurde **entfernt**,
nicht leiser gestellt; verbleibend offen ist allein E9). `MAX_BUDGET_EUR`,
`DEFAULT_TENANT_BUDGET_CENTS`, `PLAN_CAP_HEADROOM`, `src/boot-guard.js`, `src/boot.js`,
`src/plans.js`, `apps/web/src/lib/plans.js`, `PLAN-KOSTEN-STEUERUNG.md` und
`PLAN-ASSISTANT-LEAP.md` blieben bewusst unberuehrt.

**Tests (8 angepasst, 1 neu):**

- **NEU** `test/ks-p5a-plan-cap-carries-sold-minutes.test.js` — 4 Tests, reine Rechnung +
  Ops-Ebene, kein Spawn, kein pglite, keine `process.env`-Manipulation (der Satz kommt als
  `cfg` herein → immun gegen eine lokale `.env`). Testnamen ohne Katalog-Praefix → landet im
  Regressionslauf `npm test`, wo Rot etwas heisst.
- `test/helpers.js` — tote `VOICE_CAP_RATE_CENTS_PER_MIN`-Zeile aus `BASE_ENV` entfernt
  (genau die Drift, die die Lehre `test-base-env-drift` verhindern soll).
- `test/plan-cap-derivation.test.js`, `test/plan-cap-unclamped.test.js`,
  `test/gap-01-period-budget-axis.test.js` — Kopf-Env + Fixturen auf
  `VOICE_TARIFF_DEFAULT_CENTS` umbenannt, **Wert 6 bewusst beibehalten**: alle gepinnten
  Decken (300/900) und Verbrauchszahlen (400, 648) bleiben unveraendert (kleinster
  Blast-Radius; diese Dateien pruefen das Verdrahten der Aufrufer, nicht den Tarifwert).
- `test/boot-failclosed.test.js` — handgepflegte Spiegelkonstante gestrichen, der Satz kommt
  jetzt aus `BASE_ENV.VOICE_TARIFF_DEFAULT_CENTS`, also aus **derselben** Quelle, mit der
  der gemessene Spawn-Server bootet (G5/G25).
- `test/pay-04-starter-reserve-charakterisierung.test.js` — **Aussage gedreht**: aus der
  Charakterisierung eines Defekts wird der belegte Sollzustand. Der Test rechnet jetzt mit
  `config.billing` fuer Decke UND Reserve und ist damit satz-unabhaengig; die hartkodierten
  Praemissen 300/1500 und der brittle Verweis auf `render.yaml:287-291` entfallen. Bleibt
  Katalogtest (`PAY-04:`) und deckt weiter den *anderen* Ausschnitt ab (Reserve-Rechnung
  ueber `tariffCentsPerMin` + `MAX_CALL_DURATION_CAP_S`) — die eigentliche
  KS-P5a-Regressionsprotektion haengt damit nicht am Lauf, in dem Rot erlaubt ist.
- `test/config-namespaces.test.js` — `billing` 36 → 35, `EXPECTED_TOTAL_KEYS` 134 → 133,
  `checked` 125 → 124, an beide Tally-Ketten je eine KS-P5a-Zeile angehaengt (Stil der Datei).
- `test/config-money-manifest.test.js` — toter Verweis auf `voiceCapRateCentsPerMin` im
  Kommentar entfernt (C5); das Muster-Argument selbst (`PerMonth`-Endung) bleibt.

---

## Verifikation

| Schritt | Ergebnis |
|---|---|
| `node --check` auf `plan-caps.js`, `config.js`, `state-ops.js` + alle geaenderten Testdateien | keine Ausgabe |
| **Mutationsprobe** (neue Testdatei allein, VOR den Code-Edits) | **4/4 ROT** — `planCapCents` las `cfg.voiceCapRateCentsPerMin`, das in der Fixtur nicht existiert → `NaN`. `NaN >= x` ist false (Test 1), `NaN !== 1500` (Test 2), abgeleitete Decke `NaN` (Test 3), `NaN <= 0` ist false → heute haette `setTenantBudget` eine `NaN`-Decke geschrieben statt No-op (Test 4) |
| Neue Testdatei nach den Code-Edits | 4/4 pass |
| Repo-weiter grep `voiceCapRateCentsPerMin\|VOICE_CAP_RATE_CENTS_PER_MIN` | nur noch `PLAN-KOSTEN-STEUERUNG.md`, `PLAN-ASSISTANT-LEAP.md`, `tasks/ks-chain-spec.md`, `tasks/ks-p5a-report.md` (Historie, bewusst) |
| `npm test` (Regressionslauf) | **gruen: 3537 / 3537, fail 0** |
| `npm run test:gates` | 129 Tests, 126 pass, **3 rot**: GAP-05 (`allow_promotion_codes`), GAP-15 (2x, Rechtstext-Platzhalter/EN-Fassung). Alle drei vorbestehende Produktbefunde, keiner beruehrt diese Phase. **`PAY-04` ist gruen.** |
| Boot bei T=300 (`VOICE_TARIFF_DEFAULT_CENTS=300`) | `Hermes Gateway laeuft auf ...`, kein `[boot] Start abgebrochen`, Banner `Kosten-Decken: Tenant-Default 1500 ct \| Plattform-Warnschwelle 3000 ct \| Worst-Case-Tarif 300 ct/min`, `curl /healthz` → **200** |
| Boot bei T=30 (`VOICE_TARIFF_DEFAULT_CENTS=30`) | dito, Banner `... Worst-Case-Tarif 30 ct/min`, `curl /healthz` → **200** |

**Boot-Kohaerenz nachgerechnet:** `spendCapCoherence` rechnet ausschliesslich
`voiceTariffDefaultCents · ceil(300/60)` gegen `defaultTenantBudgetCents` — 300·5 = 1500 ≤
1500 ✓ bzw. 30·5 = 150 ≤ 1500 ✓. `planCapUnderivableFindings` prueft nur Ableitbarkeit, kein
Zahlenverhaeltnis. Es gibt seit KS-P3a-Ausstand ohnehin keinen Guard mehr, der Plan-Decken
gegen irgendeine Zahl haelt.

---

## Nachbarbefunde (nicht Teil dieser Phase)

- **E9 bleibt offen:** `MAX_BUDGET_EUR` (30 €) ist seit KS-P9 nur noch Warnschwelle, liegt
  aber ab 2 Startern bzw. 1 Business-Kunden unter der Summe der verkauften Decken. Die
  Warnung wuerde ab dann Dauerzustand. Aufstellung oben, Entscheidung beim Owner.
- **`PAY-04` war der einzige Katalogtest, dessen Praemisse diese Phase falsifiziert** — er
  ist gedreht und gruen. Die Nachbarn GAP-32 (Boot-Guard-Schaerfe) und GAP-33 (Auslandsziel
  kommt bis zum Provider durch) sind unberuehrt.
- **`PLAN-ASSISTANT-LEAP.md` und `PLAN-KOSTEN-STEUERUNG.md` enthalten weiterhin die
  historischen 300/900-Zahlen.** Bewusst **nicht** rueckwirkend umgeschrieben: das sind
  Planungsdokumente mit Zeitstempel, keine Spezifikation des Ist-Zustands.
- **Verhaltensaenderung ausserhalb der Decke:** genau eine — Tenants, die unter einer
  0-Kosten-Achse ein Abo schreiben, bekommen keine `tenant_budget`-Zeile mehr (statt bisher
  300/900 ct aus dem Fixtur-Satz 6). Betrifft in Produktion niemanden (live laeuft T=30) und
  in Tests nur den Fallback-Pfad, den `effectiveCapCents` Stufe (2)/(3) ohnehin abdeckt.
- **Deploy-Vorbehalt (kein Blocker dieser Phase):** bestehende `tenant_budget`-Zeilen werden
  **nicht** nachgezogen. Tenants mit einer alten plan-abgeleiteten Zeile (300/900 ct)
  behalten sie, bis der naechste Stripe-Patch die Ableitung erneut ausloest. Das ist
  dasselbe Muster wie bei GAP-32/P7 und vor dem Deploy am Prod-Postgres zu pruefen.
