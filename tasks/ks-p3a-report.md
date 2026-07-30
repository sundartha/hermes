# Phase KS-P3a — Plan-Decken gegen die Worst-Case-Reserve absichern

**Gate:** PASS
**finalBranch:** `phase/ks-p3a-plan-decken` (Basis `master` @ `9309310`)

**Fachliche Abnahme in einem Satz, am Code nachrechenbar:**
Der Boot haelt jetzt die Worst-Case-Reserve EINES Anrufs
(`VOICE_TARIFF_DEFAULT_CENTS · ceil(MAX_CALL_DURATION_CAP_S/60)`) gegen
`MIN(planCapCents(slug))` ueber alle `CATALOG_SLUGS` und verweigert den Start (exit 1),
wenn die kleinste Plan-Decke sie nicht traegt — bisher wurde ausschliesslich
`DEFAULT_TENANT_BUDGET_CENTS` dagegen gehalten, also genau **nicht** die Decke eines
zahlenden Tenants.

---

## 1. Scope: Teil 2 der Phasen-Spec ist durch KS-P5a erledigt

`PLAN-KOSTEN-STEUERUNG.md` Abschnitt `### KS-P3a` nennt zwei Teile. `tasks/ks-chain-spec.md`
enthaelt keinen KS-P3a-Abschnitt, autoritativ ist damit der Plan-Text.

| Teil | Stand |
|---|---|
| 1. Boot-Guard gegen `MIN(planCapCents)` | **diese Phase** (unten) |
| 2. Kalibrierung Buchungssatz ↔ `voiceCapRateCentsPerMin` (E5) | **bereits erledigt durch KS-P5a (`00d480c`)** |

**Fundstelle Teil 2:** `voiceCapRateCentsPerMin` / `VOICE_CAP_RATE_CENTS_PER_MIN` existiert
repo-weit nicht mehr (nur noch als Historie in `PLAN-*.md` / `tasks/*`). `planCapCents`
(`src/billing/plan-caps.js`) rechnet `includedMinutes * cfg.voiceTariffDefaultCents *
num/den` — DERSELBE Satz, mit dem `tariffCentsPerMin` (Worst-Case-Zweig) bucht. Einen
zweiten Deckel-Basissatz, gegen den kalibriert werden koennte, gibt es nicht mehr. Teil 2
wurde deshalb **nicht erneut gebaut** (Vermeidung einer Doppel-Implementierung, keine
Scope-Kuerzung).

## 2. Die Kuerzungs-Rechnung (warum der Guard trotz KS-P5a nicht ueberfluessig ist)

Mit Satz `T`:

```
planCapCents(starter)  = 30 · T · 5/3 =  50T
planCapCents(business) = 120 · T · 5/4 = 150T
Worst-Case-Reserve     = T · ceil(MAX_CALL_DURATION_CAP_S / 60) = T · 5   (Cap = 300 s)
```

`T` kuerzt sich aus der Ungleichung heraus. Die einzige lebende Variable ist
`ceil(MAX_CALL_DURATION_CAP_S/60)` gegen `includedMinutes · num/den` (= 50 beim Starter).

**Auslöseschwelle (Uebergabe an KS-P3): der Guard feuert ab `MAX_CALL_DURATION_CAP_S > 3000 s`.**
Genau diese Konstante (`src/store/defaults.js:259`, heute `300`) hebt KS-P3 an — die
Sicherung steht damit *vor* dem Eingriff.

**Beleg, gemessen** (Schritt 8 des Plans):

```
$ node -e "import('./src/billing/plan-caps.js').then(async m=>{const {CATALOG_SLUGS}=await import('./src/plans.js');for(const T of [0,30,300])console.log(T, JSON.stringify(CATALOG_SLUGS.map(s=>[s,m.planCapCents(s,{voiceTariffDefaultCents:T})])), 'reserve', T*5)})"
0   [["starter",0],["business",0]]         reserve 0
30  [["starter",1500],["business",4500]]   reserve 150
300 [["starter",15000],["business",45000]] reserve 1500
```

Alle drei Saetze kohaerent → Boot bleibt bei `T=0` (Testsuite), `T=30` (live) und `T=300`
gruen. Der Guard ist kein toter Code (G9): die Bedingung haengt an Argumenten, beide Zweige
sind getestet, und der Ausloeser ist eine Code-Konstante, die die naechste Phase aendert.

## 3. Blast-Radius

| Datei | Art |
|---|---|
| `src/boot-guard.js` | 2 verhaltensgleiche Extraktionen (`worstCaseReserveCents`, `derivePlanCaps`) + 1 Befund-Code + neuer Export `planCapReserveFindings` |
| `src/boot.js` | Import + Verdrahtung in `assertSpendCapCoherence` + Doc-Kommentar |
| `test/ks-p3a-plan-cap-reserve-guard.test.js` | neu, 5 Tests |
| `test/boot-failclosed.test.js` | additiv, 1 Spawn-Test |
| `PLAN-SECURITY.md` | additiv, 1 Abschnitt |
| `tasks/ks-p3a-report.md` | neu |

Kein Laufzeitpfad, kein Gate entfernt/abgesenkt, kein Env-Schluessel, keine Dependency,
keine DB-Migration, keine Owner-Aufgabe. `budgetExceeded`, `reserveExceedsBudget`,
`effectiveCapCents`, `tryReserveOutboundBudget`, `deriveTenantBudgetFromPlan` sind
unberuehrt. `MAX_CALL_DURATION_CAP_S` selbst wurde NICHT angefasst (das ist KS-P3).

## 4. Mutationsprobe (Reihenfolge ist Teil der Verifikation)

| # | Schritt | Ergebnis |
|---|---|---|
| 1 | *Nur* `test/ks-p3a-plan-cap-reserve-guard.test.js` angelegt, dann `node --test` darauf | **ROT** — `SyntaxError: The requested module '../src/boot-guard.js' does not provide an export named 'planCapReserveFindings'`, `# pass 0 / # fail 1` |
| 2 | Edits A–D, `node --check src/boot-guard.js && node --check src/boot.js` | Exit 0, keine Ausgabe |
| 3 | `node --test test/ks-p3a-plan-cap-reserve-guard.test.js` | `# pass 5 / # fail 0` |
| 4 | `node --test test/spend-cap-coherence.test.js test/plan-cap-unclamped.test.js test/env-docs-spend-cap-coherence.test.js test/ks-p5a-plan-cap-carries-sold-minutes.test.js` | `# pass 20 / # fail 0` — **ohne jede Testanpassung** (Beleg: Edit A/B war reines Refactoring) |
| 5 | `node --test test/boot-failclosed.test.js` | `# pass 11 / # fail 0`, inkl. des neuen KS-P3a-Spawn-Tests |
| 6 | `npm test` | **gruen**: `tests 3585 / pass 3585 / fail 0` (korrigiert um Datei-Wrapper) |
| 7 | `npm run test:gates` | `tests 129 / pass 126 / fail 3` — unveraendert gegenueber der dokumentierten master-Baseline (3 rot). Die KS-P3a-Testnamen tragen kein i18n-Katalog-Praefix, landen also im Regressionslauf |

**Abweichung zum Plan (kosmetisch):** Schritt 1 erwartete „5/5 fail mit `TypeError`". Weil der
Import statisch ist (ESM), scheitert bereits das Modul-Laden — `SyntaxError`, 1 fail. Gleich
definitiv, nur ein anderer Fehlertyp.

Zusaetzliche Mutationsprobe im Test selbst: Fall (c) pinnt `>` gegen `>=`
(Reserve === Decke → `[]`, Reserve === Decke + 1 → FATAL); Fall (d) pinnt, dass ein
werfender `capForSlug` uebersprungen wird, ohne dass der Guard wirft (Parity zu
`test/plan-cap-unclamped.test.js (j4)`).

## 5. Smoke-Test (echter Server-Start, Live-Satz)

`startServer({ VOICE_TARIFF_DEFAULT_CENTS: "30", SKIP_TWILIO_SIGNATURE_CHECK: "true" })`:

```
healthz status: 200
Start abgebrochen im stdout? false
Plan-Decken-Befund im stdout? false
  Kosten-Decken:  Tenant-Default 0 ct | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min
```

Derselbe Pfad ist automatisiert in `test/boot-failclosed.test.js` abgedeckt.

## 6. Bewusst getragenes Restrisiko

1. **Der Guard prueft die ABGELEITETE Decke, nicht eine per Hand gesetzte `tenant_budget`-Zeile.**
   Eine manuell zu niedrig geschriebene Decke faengt er nicht.
2. **Er greift beim Boot, nicht beim Schreiben.** Eine Konfiguration, die erst nach dem Start
   inkohaerent wuerde, meldet er erst beim naechsten Neustart.
3. **Der feuernde Zweig ist ueber Env strukturell nicht erreichbar** (`MAX_CALL_DURATION_CAP_S`
   ist eine Code-Konstante, der Satz kuerzt sich raus) — es gibt deshalb keinen
   Spawn-Refusal-Test wie `T-P3-12`, nur die reine Wahrheitstabelle plus den gruenen
   Live-Satz-Spawn.

## 7. Pre-Mortem, nachgehalten

| Risiko | Gegenmittel im gelieferten Stand |
|---|---|
| „Der Guard hat den Boot in Produktion gekillt." | Rechnung + Messung bei T=0/30/300 gruen; Spawn-Test mit dem Live-Satz 30. Wenn KS-P3 den Cap ueber 3000 s hebt, verweigert der Boot — das ist der Zweck, und die Meldung nennt beide Hebel. |
| „Der Guard hat still versagt." (Wurf von `capForSlug` → `uncaughtException`-Netz → lautloser `exit(0)`) | Wurf-Fang liegt in **einem** gemeinsamen Helfer `derivePlanCaps`; beide Plan-Decken-Guards bauen darauf auf und werfen strukturell nie. Test (d) pinnt es. |
| „Zwei Guards melden dieselbe Sache doppelt." | Nicht ableitbare Slugs meldet ausschliesslich `planCapUnderivableFindings`; `planCapReserveFindings` ueberspringt sie und liefert bei leerer Menge `[]`. Test (e) pinnt es. |
| „Wir haben ein Gate aufgeweicht." | Eine FATAL-Sicherung kommt HINZU; keine entfernt, kein `fatal: true → false`, kein Laufzeitpfad angefasst, kein neuer Env-Schluessel. |
