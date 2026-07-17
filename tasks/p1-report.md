# Phase P1 — Money-Gates härten: Integer-Cents-Kern, Reserve-Positivitäts-Guard, vollständige Meter-Abbildung

**Gate: PASS**
**finalBranch:** `phase/cc-p1-money-gates`
**Scope (PLAN-CLEAN-CODE.md):** S1-1, S1-6, S1-7 — Kohärenter EIN-Lauf, kein neuer npm-Dependency, keine neue Env-Var.

---

## 1. Ziel der Phase

Drei zusammenhängende Money-Gate-Härtungen aus `PLAN-CLEAN-CODE.md`:

- **S1-1** — Der Usage-Bucket führt Geld heute als JS-Float (`costEur`); Float-Arithmetik über viele Inkremente riskiert Drift/Rundungsfehler am Budget-Gate. Ziel: Ganzzahl-Cents als autoritativer Geldwert (G26).
- **S1-6** — Der Reserve-Dauer-Parser (`parseInt(raw||def,10)||DEFAULT`) fängt nur `0`/`null`/`NaN` ab; negative Zahlen sind in JS truthy und rutschen durch bis zu einer potenziell **negativen** Reserve, die den Reserve-Ledger senken statt erhöhen könnte. Ziel: Positivitäts-Guard, fail-closed.
- **S1-7** — `STRIPE_METER_EVENT_NAME` bildete nicht alle real produzierten `usage_event`-Sorten ab (insbesondere `sms` fehlte, obwohl `call-finish.js` bereits SMS-Events erzeugt). Ziel: vollständige Meter-Abbildung + Boot-Assertion, die künftige Lücken fail-closed abfängt.

**Verbindlich als Safety-BLOCKER definiert** (aus dem Strategie-Plan, s. Memory `clean-code-strategy-plan`): die KI-Kosten-Akkumulation (`trackUsage`) darf **niemals pro Inkrement auf ganze Cents runden** — Haiku-Sub-Cent-Turns (≪ 0,5 Cent) dürfen nicht strukturell auf 0 fallen, sonst wird das Budget-Gate für genau diese Kostenklasse blind.

---

## 2. Plan (gekürzt)

### 2.0 Kern-Designentscheidung (BLOCKER-Auflösung) — verbindlich

**Bucket-Geldmodell „costCents + Sub-Cent-Rest" (spec-treu):** Der Usage-Bucket führt Geld als `costCents` (Ganzzahl, autoritativ) plus `costMicroCentsRem` (Ganzzahl-Mikro-Cents, `[0, MICRO_CENTS_PER_CENT)`, strukturell **ephemer**). Die Voice-Achse (`addVoiceUsageCostCents`) addiert ganze Cents exakt in `costCents`. Die KI-Achse (`trackUsage`) akkumuliert **exakt in Mikro-Cents** und bucht nur den vollen Cent-Übertrag nach `costCents`; der Sub-Cent-Rest reist über die Inkremente mit → Sub-Cent-Turns werden nie pro Inkrement auf 0 gerundet (BLOCKER erfüllt).

**Kein `costMicroCents`-Einheitsfeld**, weil die Spec `costCents` literal als autoritatives Feld benennt (`usage.costCents += costCents`, Persistenz über `costCents/CENTS_PER_EUR`, „globalUsageTotals summiert costCents (Integer-Summe)", „vergleichen rein Integer"). Der Rest-Ansatz hält diese Aussagen wörtlich und isoliert die Sub-Cent-Komplexität auf den einen Produzenten (`trackUsage`). Der BLOCKER-erlaubte „mitgeführte Rest über Inkremente" wird als **Ganzzahl**-Rest (Mikro-Cents) umgesetzt (sauberer als ein Float-Rest).

**Gate-Vergleich = rein Integer Cents, floor an der Kante:** Alle vier Prädikate vergleichen `costCents` gegen `capCents` ohne `/CENTS_PER_EUR`.
- `budgetExceeded`/`globalBudgetExceeded` (`>=`, ganzzahliger Cap) sind **bit-identisch** zum heutigen Float-Gate — für ganzzahligen Cap gilt `floor(x) >= cap ⟺ x >= cap`.
- Die zwei Reserve-Prädikate (`>`) floren den settled Sub-Cent-Rest an der Vergleichskante (BLOCKER erlaubt „erst an der Vergleichskante EINMAL geflooert"). Effekt < 1 Cent, dominiert vom Worst-Case-Reserve-Überschätzer (ceil-Minuten × Worst-Case-Tarif); Sub-Cent-Turns gehen nicht aus der Akkumulation verloren.

`MICRO_CENTS_PER_CENT = 1_000_000` (1 Mikro-Cent = 1e-6 Cent). Rundungsfehler/Turn ≤ 5e-7 Cent, Wertebereich weit unter 2^53.

`costMicroCentsRem` ist strikt ephemer (Muster `reservations`/`_finished`): json-`save()` strippt es, pg persistiert es nicht (keine Spalte); beide Backends hydrieren es als `0` (Reset bei Neustart, < 1 Cent, akzeptiert). `aiCostCents` (Stripe-Ledger-Pfad, `claude.js`) bleibt unverändert.

**Display-Projektion (Minor 1):** `costEur` wird an **einer** Kante abgeleitet — `src/routes/api-read.js` `/api/state`. `mcp-tools.js` ist ein MCP-**Client**, der `/api/state` per HTTP liest → keine Dreifach-Ableitung (G5); der MCP-/Widget-Kontrakt (`costEur: z.number()`) bleibt byte-identisch.

### 2.1 Neue Datei
`test/outbound-gates.test.js` — Unit-Tests für `resolveMaxDurationS` (S1-6).

### 2.2 Edits (Vorher → Nachher, Kernpunkte)

| Datei | Kern-Edit |
|---|---|
| `src/store/defaults.js` | Neue Konstanten `MICRO_CENTS_PER_CENT`, `globalCapCents(cfg)`; `DEFAULT_CALL_DURATION_S`/`MAX_CALL_DURATION_CAP_S` aus `outbound-gates.js` hierher verschoben (G5/G13, leaf-Modul für mcp-tools ohne Gate-Factory-Kopplung); `emptyUsage()` liefert `{ costCents: 0, costMicroCentsRem: 0 }` statt `costEur`. |
| `src/store/state-ops.js` | `globalUsageTotals` summiert Mikro-Cents mit Übertrag (exakt, cross-Tenant); `trackUsage` akkumuliert Mikro-Carry (BLOCKER-Kern, kein Per-Inkrement-Rounding); `addVoiceUsageCostCents` addiert ganze Cents direkt; `effectiveCapEur`→`effectiveCapCents`; alle vier Prädikate (`budgetExceeded`, `reserveExceedsBudget`, `globalBudgetExceeded`, `globalReserveExceedsBudget`) rein Integer; `tryReserveOutboundBudget` neu fail-closed gegen `reserveCents < 0` bzw. `NaN` (`!(x>=0)` fängt beides). |
| `src/store/json.js` | Neuer Helper `bucketToCents` (Alt-Shape `costEur`-Float → Ganzzahl-Cents, `costMicroCentsRem` defaultet auf 0); `migrateUsageToMap` nutzt ihn in beiden Zweigen; `save()`-Replacer strippt zusätzlich `costMicroCentsRem` (ephemer wie `_finished`). |
| `src/store/pg.js` | `rowToUsage` leitet `costCents` verlustfrei aus dem exakten `NUMERIC`-`cost_eur`-Feld ab (`costMicroCentsRem: 0`, ephemer); `flushUsage` schreibt `costCents/CENTS_PER_EUR` in die unveränderte `cost_eur`-Spalte (keine Schema-Migration). |
| `src/routes/api-read.js` | Neuer lokaler Helper `usageView(u, config)` als **einzige** Display-Ableitungskante: explizite Whitelist `{inputTokens, outputTokens, calls, costEur, maxBudgetEur}`, kein Leak von `costCents`/`costMicroCentsRem`. |
| `src/mcp-tools.js` | Nur zod-Defense-in-Depth (S1-6): `max_duration_s: z.number().int().positive().max(MAX_CALL_DURATION_CAP_S).optional()`. Keine Display-Änderung — liest weiter das von api-read abgeleitete `costEur`. |
| `src/telephony/outbound-gates.js` | Neuer Export `resolveMaxDurationS(raw, cfg)` — Wurzelfix: erster endlich-und-strikt-positiver Kandidat aus `[Body, config-Default, Hard-Default]`, dann hart auf `MAX_CALL_DURATION_CAP_S` geklemmt; ersetzt den `parseInt(raw||def,10)||DEFAULT`-Trap. `compute_reserve` ruft ihn auf. |
| `src/billing/stripe.js` | `STRIPE_METER_EVENT_NAME` `export`, neuer Eintrag `sms: "sms_messages"`. Deploy-Dependency dokumentiert: Meter muss im Stripe-Dashboard existieren. |
| `src/boot-guard.js` | Neue pure Funktion `meterMappingGaps(usageEventKinds, meterEventNames)` — liefert Sorten ohne Mapping (leer = vollständig). |
| `src/boot.js` | Viertes fail-closed Boot-Gate in `assertBootGates`: fehlende Meter-Abbildung → `console.error` + `process.exit(1)` (Scope-Ergänzung, s. §2.5). |

### 2.3 Betroffene Bestandstests (Prinzip)
Tests, die die API/MCP-Ebene lesen (`/api/state.usage.costEur`), bleiben **unverändert grün** (costEur wird weiterhin abgeleitet ausgeliefert). Nur Tests, die den rohen Bucket (Ops-Ebene/`readStore()`) lesen/deepEqualn, werden auf `costCents`/`costMicroCentsRem` umgestellt: `store-pg.test.js`, `store-pg-tenant-budget.test.js`, `tenant-erasure.test.js`, `outbound-reserve-reconcile.test.js`, `max-duration-rearm.test.js`, `telnyx-p6-boot-rearm.test.js`, `outbound-reconcile-finishcall.test.js`, `finishcall-billing-once.test.js`, `tenant-budget-cap.test.js` (Kommentar-Hygiene). Als „migrations-gedeckt" (keine Änderung erwartet) explizit ausgewiesen: `helpers.js`, `b2-quota-gate`, `outbound-tenant`, `telnyx-p5-gate-proof`, `bootstrap-tenant`, `telnyx-p8-inbound`, `mcp-ui`, `reservation-ledger`, `outbound-gates-order`.

### 2.4 Neue/erweiterte Tests (Kern)
- **`tenant-budget-cap.test.js`**: `addVoiceUsageCostCents` exakt; `globalUsageTotals` Integer-Summe; Grenzfälle cap-1/cap/cap+1; **BLOCKER-Test** — 6000 Sub-Cent-Turns (0,093 Cent/Turn) summieren über einen Cap von 500 Cent, präzise (nicht per-Schritt gerundete) Ground-Truth, `budgetExceeded===true`, `costCents>=500`; präzise Rekonstruktions-Assertion (`< 1e-9` Abweichung zur exakten EUR-Summe).
- **`test/outbound-gates.test.js` (neu)**: `resolveMaxDurationS` gegen `-300→180`, `0→180`, `NaN→180`, `undefined→180`, `""→180`, `"250"→250`, `250→250`, `99999→300` (Cap), `301→300`, `1→1`.
- **`reservation-ledger.test.js`**: `tryReserveOutboundBudget` mit negativem/`NaN` `reserveCents` → `false`, Ledger unverändert; `0` bleibt valide.
- **`outbound-gates-order.test.js`**: `compute_reserve` mit `max_duration_s:-300` → `ctx.maxDur===180` (Config-Default, NICHT -300), `reserveCents` bleibt positive Ganzzahl.
- **`api-flush-meters.test.js`**: neuer SMS-`usage_event` → `flushMeters` → `{sent:1, failed:0}` (beweist das neue Mapping wirft nicht mehr).
- **`boot-guard.test.js`**: `meterMappingGaps` — vollständige Map → `[]`; künstlich unvollständige Map → `["sms"]`.

### 2.5 Scope-Ergänzungen ggü. Spec-Dateiliste (begründet)
- `src/boot.js`: nicht in der ursprünglichen Spec-Liste, aber zwingend — sonst wäre `meterMappingGaps` toter Code; `assertBootGates` ist die kanonische Bündelung aller fail-closed Boot-Gates.
- `src/routes/api-read.js`: bereits per Safety-Review-Minor als Display-Kante ergänzt.
- Zusätzliche additive Testfälle in `outbound-gates-order.test.js`, `reservation-ledger.test.js`, `boot-guard.test.js`.
- Verschiebung von `DEFAULT_CALL_DURATION_S`/`MAX_CALL_DURATION_CAP_S` nach `defaults.js` (G5/G13).

### 2.6 Deterministisches Ergebnis (DoD) — Kern-Gates
`node --check` auf 10 Zieldateien; `npm test` 0 Failures; grep-Nachweise: `costEur *+=` leer im gesamten `src/`, `.costEur` leer in `state-ops.js`, `CENTS_PER_EUR` nur in `trackUsage`, `MICRO_CENTS_PER_CENT`/`costMicroCentsRem`/`Math.floor(totalMicro)` im Mikro-Carry sichtbar, `sms:` im Stripe-Mapping, `meterMappingGaps` definiert+aufgerufen, `reserveCents >= 0`-Guard vorhanden; Smoke `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + `curl /healthz`.

### 2.7 Pre-Mortem / Risiken (aus dem Plan)
1. Fehl-autorisierter Call durch fail-open `NaN` bei halb-migriertem Store → alle Konstruktionspfade defaulten strikt auf 0 (entschärft, testgedeckt).
2. Kosten-Explosion durch negative Reserve → doppelt entschärft (`resolveMaxDurationS` + `tryReserveOutboundBudget`-Guard), Tests -300/0/NaN + Integration.
3. Umsatzverlust SMS bleibt, falls Stripe-Meter `sms_messages` im Dashboard fehlt → als Deploy-Dependency dokumentiert, Boot-Guard erzwingt nur das Code-Mapping.
4. Doppelbuchung/Drift, falls `costEur` weiter parallel akkumuliert würde → grep-DoD beweist eine Quelle.
5. Budget-Gate-Regression durch Rundung (der BLOCKER selbst) → Mikro-Cent-Carry + präziser Ground-Truth-Test + Sub-Cent-über-Cap-Test; `>=`-Prädikate bit-identisch für Ganzzahl-Cap.
6. Reserve-Gate-Sensitivität (< 1 Cent Floor-Kante) → dokumentierter, spec-sanktionierter Fallback-Pfad (Mikro-Cent-exakter Reserve-Vergleich) beschrieben, falls je verlangt.

Absolute Regeln explizit gewahrt: kein Gate entfernt/aufgeweicht, Gate-Reihenfolge unverändert, `reserve_budget` bleibt letztes Gate, Disclosure/Auth/Secrets unberührt, keine neue Env-Var, kein neuer Dependency.

---

## 3. Implementierung — Zusammenfassung

- **headCommit:** `a6a18dd74a6e077451692ae54d53537aeeeb2b2d`
- `node --check`: PASS (alle 11 geänderten `src`-Dateien)
- Tests: PASS — **2314 / 0** (Baseline 2301/0, **+13**)
- Committed: ja (auf Phase-Branch, im Worktree)
- Smoke: PASS

**Umsetzung (Kern):** Der Usage-Bucket führt Geld jetzt als Ganzzahl `costCents` + ephemerem `costMicroCentsRem` statt als JS-Float `costEur` (G26). `trackUsage` (KI-Achse) akkumuliert exakt in Mikro-Cents und bucht nur den vollen Cent-Übertrag nach `costCents` — Sub-Cent-Turns (≪ 0,5 Cent) fallen nie mehr pro Inkrement auf 0 (**Safety-BLOCKER**). Alle vier Budget-Prädikate vergleichen rein Integer `costCents`; die zwei Reserve-Prädikate floren den settled Sub-Cent-Rest erst an der Vergleichskante (spec-sanktioniert, < 1 Cent, vom Worst-Case-Reserve-Überschätzer dominiert). `tryReserveOutboundBudget` ist jetzt fail-closed gegen negatives/NaN `reserveCents`. `resolveMaxDurationS` in `outbound-gates.js` ersetzt den `x || DEFAULT`-Trap (negative Body-Werte waren truthy und rutschten bis zu einer negativen Reserve durch); `mcp-tools.js` erhält eine spiegelnde zod-DiD. `costEur` wird nur noch an einer Kante abgeleitet (`routes/api-read.js` `usageView`, Whitelist ohne `costCents`/`costMicroCentsRem`-Leak); `json.js`/`pg.js` migrieren bzw. persistieren `costCents`. Stripe-Meter-Mapping um `sms:"sms_messages"` ergänzt + neue Boot-Assertion (`meterMappingGaps`, viertes fail-closed Gate in `boot.js`) verhindert stillen Umsatzverlust bei künftig unvollständiger `usage_event`→Meter-Abbildung.

**Dateien erstellt:**
- `test/outbound-gates.test.js`

**Dateien editiert (14):**
`src/store/defaults.js`, `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/routes/api-read.js`, `src/mcp-tools.js`, `src/telephony/outbound-gates.js`, `src/telephony/call-finish.js`, `src/billing/stripe.js`, `src/boot-guard.js`, `src/boot.js`, plus 11 Testdateien: `reservation-ledger.test.js`, `outbound-gates-order.test.js`, `api-flush-meters.test.js`, `boot-guard.test.js`, `tenant-budget-cap.test.js`, `store-pg.test.js`, `store-pg-tenant-budget.test.js`, `tenant-erasure.test.js`, `outbound-reserve-reconcile.test.js`, `max-duration-rearm.test.js`, `telnyx-p6-boot-rearm.test.js`, `outbound-reconcile-finishcall.test.js`, `finishcall-billing-once.test.js`, `api-read-parity.test.js`.

**Neue/geänderte Tests (13 neu):**
- `test/outbound-gates.test.js` (neu, 4 Fälle: `resolveMaxDurationS` Positivitäts-/Cap-Guard)
- `test/reservation-ledger.test.js` (+1: `tryReserveOutboundBudget` fail-closed bei negativ/NaN)
- `test/outbound-gates-order.test.js` (+1: `compute_reserve` mit negativem Body-`max_duration_s`)
- `test/tenant-budget-cap.test.js` (+5: `addVoiceUsageCostCents` exakt, `globalUsageTotals` Integer-Summe, Grenzfall cap-1/cap/cap+1, BLOCKER Sub-Cent-Turns über Cap, präzise Rekonstruktion)
- `test/api-flush-meters.test.js` (+1: SMS-`usage_event`-Meter-Flush)
- `test/boot-guard.test.js` (+1: `meterMappingGaps`)
- 8 Bestandstests rein an Assertions angepasst (`costEur`→`costCents`), keine Verhaltensänderung
- `test/api-read-parity.test.js` — Bestandstest angepasst (siehe Deviations)

**Smoke:** Server gebootet mit Dummy-Env (analog `test/helpers.js` `BASE_ENV`) + `SKIP_TWILIO_SIGNATURE_CHECK=true` + `OWNER_NUMBER_SEED`. Boot-Banner erscheint (kein `meterMappingGaps`-Refusal), `/healthz` → 200 `{ok:true}`, `/api/state.usage` → `{inputTokens:0,outputTokens:0,calls:0,costEur:0,maxBudgetEur:8}` — keine internen Felder (`costCents`/`costMicroCentsRem`) geleakt.

**cleanCodeSelfCheck (Impl-seitig):** G5 (Duplizierung) — `DEFAULT_CALL_DURATION_S`/`MAX_CALL_DURATION_CAP_S` nach `defaults.js` konsolidiert, `bucketToCents` in `json.js` extrahiert, `usageView` als die eine Ableitungsstelle für `costEur`. G25 (Magic Numbers) — `MICRO_CENTS_PER_CENT` benannt. G26 (Präzision) — Geld jetzt Ganzzahl statt Float, das explizite Phasenziel. G30/G34 — `trackUsage`/`resolveMaxDurationS`/`meterMappingGaps` bleiben kurze Einzweck-Funktionen. F1 (≤3 Argumente) — eingehalten. C2 (überholte Kommentare) — alle betroffenen `costEur`/`effectiveCapEur`-Kommentare aktualisiert. Kein toter/auskommentierter Code, keine ungenutzten Imports. Deutsche Kommentare ohne Umlaute. Neues Verhalten je mit Test.

### Deviations vom Plan

1. **`test/api-read-parity.test.js` nicht im Plan als änderungsbedürftig gelistet, brach aber real.** Der Mock `usageOf: () => ({ spentEur: 2 })` testete die alte Spread-Semantik (`api-read.js` reichte jedes Feld unverändert durch). Die vom Plan geforderte Whitelist (`usageView`, kein `costCents`/`costMicroCentsRem`-Leak) ist mit beliebigem Pass-Through unvereinbar. Fix: Mock auf realistischen Bucket-Shape umgestellt (`{inputTokens,outputTokens,costCents,costMicroCentsRem,calls}`), Assertion von `spentEur` auf die abgeleitete `costEur` + explizite Kein-Leak-Checks. Notwendige Konsequenz aus dem im Plan selbst geforderten Whitelist-Vertrag, keine Abweichung vom Plan-Verhalten.
2. Zusätzliche C2-Kommentar-Hygiene über die Plan-Liste hinaus (`state-ops.js` bei `setTenantIdentityIfAbsent`/`planMinutesExceeded`, `telephony/call-finish.js`, `outbound-reserve-reconcile.test.js` Kopf-Kommentar, `tenant-budget-cap.test.js` Zeilen 30/80, Testnamen in `reservation-ledger.test.js`/`store-pg-tenant-budget.test.js`) — reine Hygiene, keine Verhaltensänderung.

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

**Concerns (nicht blockierend):**
1. **OPERATIONAL (dokumentiert, kein Code-Risiko):** der neue SMS-Meter `event_name` `sms_messages` muss im Stripe-Dashboard als Meter existieren, sonst wird SMS-Umsatz bei `reportMeter` Stripe-seitig abgelehnt. Als Pre-Mortem-Risiko (3) + Owner-Smoke im Plan geführt; Code-seitig korrekt.
2. **MINOR (Invariante-per-Konstruktion, kein P1-Regress):** `trackUsage` vertraut darauf, dass `usage.costMicroCentsRem` definiert ist (`undefined + microInc = NaN` würde das Gate blind machen). Alle Bucket-Konstruktionspfade (`emptyUsage`, `bucketToCents`, `rowToUsage`, `usageFor ||= emptyUsage()`) setzen das Feld; `globalUsageTotals` ist zusätzlich mit `|| 0` defensiv. Dieselbe Invariante-per-Konstruktion galt vorher für `costEur` — kein neues Risiko; optional könnte `trackUsage` die Lesung zusätzlich härten.
3. **MINOR (beabsichtigt):** `usage.costEur` in der API wechselt von hochpräzisem Float auf `costCents/100` (cent-gerundet). Feldkontrakt bleibt, reine Anzeige-Präzision (Dashboard zeigt ohnehin `toFixed(3)`) — erwartete Härtung.

**Unabhängige Verifikation:** Default/json-Suite 2314 pass / 0 fail (exit 0). pg-Backend via pglite (in-Suite `store-pg*.test.js`) grün; fokussierte P1-Dateien 111/0. Globaler `STORE_BACKEND=pg`-Override → 33 Failures, verifiziert als rein umgebungsbedingt (Server-Kindprozesse fail-closen beim Boot mangels erreichbarer echter Postgres/`DATABASE_URL` — `[store] FATAL: pg-Backend nicht initialisierbar ... AggregateError`), keine P1-Datei betroffen. Smoke: voller Boot inkl. neuem Meter-Gate erfolgreich, `/healthz` → `{"ok":true}` HTTP 200. `node --check` aller 11 geänderten `src`-Dateien OK.

**Begründung (Kern):** P1 härtet die drei Geld-Gates + Metering fail-closed ohne eine einzige Aufweichung. Der Safety-BLOCKER ist vollständig erfüllt: der KI-Kosten-Live-Gate-Akkumulator (`trackUsage`) führt Mikro-Cents mit mitgeführtem Sub-Cent-Rest und rundet nie pro Inkrement auf ganze Cents; das Whole-Cent-Rounding (`aiCostCents`) sitzt ausschliesslich an der Stripe-Ledger-Grenze, nicht am Gate. Alle vier Budget-Prädikate vergleichen Integer-Cents gegen Cents ohne `/CENTS_PER_EUR` (für ganzzahlige Caps bit-identisch zum früheren Float-Gate, aber präziser). `costEur` wird nirgends mehr akkumuliert (grep bestätigt), nur an der einen API-Projektionskante abgeleitet; `costCents`/`costMicroCentsRem` leaken nicht in die API. `tryReserveOutboundBudget` ist fail-closed bei negativem/NaN `reserveCents`; `resolveMaxDurationS` verhindert die negative Reserve (S1-6) und ist für legitime Eingaben verhaltensgleich. SMS-Meter-Mapping ergänzt + Boot-Vollständigkeitsprüfung fail-closed (S1-7). Disclosure, Signatur- und Auth-Pfade unberührt; keine neue npm-Dependency; Scope strikt auf P1 (+ im Safety-Review benannte Display-Kanten). Keine Blocker.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS** (kein Blocker) — 0× S1, 0× S2, 1× S3, 2× S4
**Blocker: false**

Vollständiger Diff (26 Dateien, 443+/120-) gegen `master` geprüft, `node --check` auf allen 9 geänderten `src`-Dateien grün, `npm test` auf dem Phase-Branch komplett grün (2314/2314, 0 fail).

### S1 (kritisch)
Keine Findings.

### S2 (schwerwiegend)
Keine Findings.

### S3 (moderat)
1. **G26 · `src/store/state-ops.js:1362-1371,1543-1548`** (`reserveExceedsBudget`/`globalReserveExceedsBudget`) — Der Sub-Cent-Rest (`costMicroCentsRem`) wird an der Reserve-Vergleichskante geflooert → bis zu < 1 Cent Kulanz *vor* dem Cap, *bevor* die Vorab-Reservierung greift (`budgetExceeded`/`globalBudgetExceeded` bleiben dagegen mathematisch exakt, weil der Cap ganzzahlig ist und `floor(x)>=cap ⟺ x>=cap` für Ganzzahl-Cap gilt — der Effekt betrifft nur die Reserve-Formel). Im Code bereits explizit dokumentiert und als vom Worst-Case-Reserve-Überschätzer dominiert begründet — kein Blocker, aber real und < 1 Cent pro Tenant. *Empfehlung, falls je sicherheitskritisch:* `costMicroCentsRem` mit `Math.ceil` statt Flooring in den Reserve-Vergleich aufnehmen; ansonsten bewusste dokumentierte Ausnahme.

### S4 (geringfügig)
1. **T1 · `src/mcp-tools.js:403-409`** (place_call `max_duration_s` Zod-Schema) — die neue `.int().positive().max(MAX_CALL_DURATION_CAP_S)`-Grenze hat keinen eigenen Test, der eine tatsächliche Ablehnung (negativ/0/zu groß) bei einem echten MCP-Tool-Call beweist; getestet ist nur der nachgelagerte Wurzelfix (`resolveMaxDurationS` + `compute_reserve`-Gate). *Optional:* Test, der `place_call` mit `max_duration_s=-5/0/9999` aufruft und `isError`/Validierungsfehler erwartet.
2. **C2 · `src/db/schema.sql:227`** (Kommentar bei `cost_eur`-Spalte, **nicht** Teil dieses Diffs) — Kommentar beschreibt noch den alten In-Memory-Float-Spiegel, der durch diesen Diff auf `costCents`+`costMicroCentsRem` umgestellt wurde — sachlich überholt (C2), aber ausserhalb des Diffs. *Bei nächster Berührung von `schema.sql` nachziehen.*

### Top-Todos
- Kein Handlungsbedarf vor Merge — die zwei S3/S4-Funde sind bewusste, begründete Abwägungen bzw. Drive-by-Kommentar-Staleness ausserhalb des Diffs, kein Korrektheits-/Sicherheitsrisiko.
- Optional (niedrige Priorität): direkter Ablehnungstest für die neue Zod-Grenze in `mcp-tools.js` (T1).
- Bei nächster `schema.sql`-Berührung den `cost_eur`-Kommentar nachziehen (C2, kosmetisch).

### Pass-Notes (Kern)
Sehr sauberer Money-Gates-Diff. Zwei **echte, vorbestehende** Sicherheits-/Money-Bugs mit Wurzelfix behoben:
(a) Ein negativer `max_duration_s`-Body-Wert war im alten `parseInt(x||def,10)||DEFAULT`-Trap truthy und rutschte bis zu einer **negativen Reserve** durch, die `tryReserveOutboundBudget` den Reserve-Ledger absenken liess (Budget-Gate-Bypass) — jetzt durch `resolveMaxDurationS` (Boden > 0, robust gegen NaN/negativ/leer) **und** einen zusätzlichen fail-closed-Guard in `tryReserveOutboundBudget` doppelt abgesichert, beides testgedeckt.
(b) `STRIPE_METER_EVENT_NAME` hatte vor diesem Diff kein Mapping für `kind:'sms'`, obwohl `call-finish.js` bereits real SMS-`usage_events` erzeugte — jeder SMS-Flush wäre endlos auf „failed" gelaufen (Umsatz nie gemeldet); jetzt gefixt plus ein neues Boot-Gate (`meterMappingGaps`), das jede künftige Lücke zwischen `USAGE_EVENT_KIND` und `STRIPE_METER_EVENT_NAME` beim Start abfängt (Gate-Reihenfolge korrekt erhalten, vor `rearmActiveCallTimers`).

Die Integer-Cents-Migration (G26) ist vollständig durchgezogen: `costCents` als autoritativer Wert, saubere Mikro-Cent-Akkumulation in `trackUsage` gegen genau den dokumentierten P1-Safety-BLOCKER — verifiziert mit einem 6000-Turn-Stresstest. `budgetExceeded`/`globalBudgetExceeded` sind für ganzzahlige Caps beweisbar bit-identisch zum alten Float-Gate. Migrationspfad (`bucketToCents`/`migrateUsageToMap`) verarbeitet altes flaches `costEur`-Shape wie bereits gemappte Alt-Buckets korrekt und idempotent — verifiziert durch mehrere unveränderte Legacy-Testdateien, die weiterhin rohe `costEur`-Fixtures seeden und grün bleiben. `/api/state`-Projektion (`usageView`) whitelisted jetzt explizit statt roh zu spreaden — `costCents`/`costMicroCentsRem` können die API nicht mehr leaken (G8-Verbesserung, testgedeckt). Saubere Konstanten-Konsolidierung ohne Duplizierung. Keine toten Imports, kein auskommentierter Code, kein `eslint-disable`/`.skip`/`.only` im Diff.

---

## 6. Fix-Runden

**Keine.** Der Branch hat beide Reviews (Safety und Clean-Code) im ersten Durchlauf ohne Blocker bestanden — kein Self-Fix-Zyklus erforderlich (`=== FIXES ===` blieb leer).

---

## 7. P1-Safety-BLOCKER — explizite Erfüllungsprüfung

**Status: ERFÜLLT.**

Der im Strategie-Plan (`PLAN-CLEAN-CODE.md`, Memory `clean-code-strategy-plan`) festgehaltene Blocker lautet: *„KI-Kosten-Akku nicht pro Inkrement runden (sonst Budget-Gate blind)."*

Begründung der Erfüllung:
- `trackUsage` (die KI-Achse, einziger Produzent von Sub-Cent-Kosten) akkumuliert **exakt in Mikro-Cents** (`MICRO_CENTS_PER_CENT = 1_000_000`) und bucht nur den vollen Cent-Übertrag (`Math.floor(totalMicro / MICRO_CENTS_PER_CENT)`) nach `costCents`; der Rest (`totalMicro % MICRO_CENTS_PER_CENT`) reist als `costMicroCentsRem` verlustfrei über die nächsten Inkremente mit. Es gibt **keine** Stelle, an der ein einzelner Turn-Betrag vor der Akkumulation auf ganze Cents gerundet wird.
- Explizit gegenverifiziert durch den BLOCKER-Test in `tenant-budget-cap.test.js`: 6000 Turns à 0,093 Cent (≪ 0,5 Cent, würde bei Per-Inkrement-`Math.round` jeweils auf 0 fallen) summieren sich präzise über einen Cap von 500 Cent; `budgetExceeded` schlägt korrekt an, `costCents >= 500`. Eine hypothetische Per-Inkrement-Rundung würde diesen Test **rot** machen (`costCents===0`) — der Test zementiert also die Abwesenheit des Fehlers, nicht den Fehler selbst.
- Whole-Cent-Rundung existiert im Code weiterhin, aber ausschliesslich an zwei bewusst getrennten, unkritischen Stellen: (1) `aiCostCents` an der Stripe-Ledger-Grenze (`claude.js`, ausserhalb des Live-Gate-Akkumulators) und (2) die Vergleichskante der zwei Reserve-Prädikate (`reserveExceedsBudget`/`globalReserveExceedsBudget`), wo der bereits *settled* Rest einmalig geflooert wird — spec-sanktioniert, < 1 Cent Effekt, vom Clean-Code-Audit als S3 dokumentiert, nicht als Blocker.
- Sowohl Safety- als auch Clean-Code-Review bestätigen unabhängig voneinander, dass der Akkumulator selbst nie pro Inkrement rundet (Safety: „Der Safety-BLOCKER ist vollständig erfüllt"; Clean-Code: BLOCKER-Test als Kernbeleg genannt, keine S1/S2-Findings gegen den Akkumulationspfad).

---

## 8. Ergebnis

| Metrik | Wert |
|---|---|
| Scope | S1-1, S1-6, S1-7 |
| Geldmodell | `costCents` (Ganzzahl, autoritativ) + `costMicroCentsRem` (ephemer, Mikro-Cent-Rest) statt `costEur` (Float) |
| Safety-BLOCKER (kein Per-Inkrement-Runden) | **ERFÜLLT** — Mikro-Cent-Carry in `trackUsage`, testgedeckt (6000-Turn-Stresstest) |
| Neue/erweiterte Tests | 13 neu (+ 1 Bestandstest strukturell angepasst über Plan hinaus) |
| Bestandstests angepasst | 11 (reine Assertions, keine Verhaltensänderung) |
| Volle Suite | 2314 / 2314 grün, 0 Fail (Baseline 2301, +13) |
| Safety | APPROVED, keine Blocker, 3 dokumentierte Concerns (1 operational, 2 minor) |
| Clean-Code | PASS, S1/S2 leer, 1× S3 (dokumentierte Reserve-Floor-Kante), 2× S4 |
| Fix-Runden | 0 |
| Neue npm-Dependency | keine |
| Neue Env-Var | keine |
| headCommit | `a6a18dd74a6e077451692ae54d53537aeeeb2b2d` |
