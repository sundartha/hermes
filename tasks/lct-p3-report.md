# Phase-Report: P3 — Kosten-Abgleich im Beobachtungsmodus

**Plan-Quelle:** PLAN-LIVE-COST-TRACING.md, Abschnitt "### P3" (autoritativ, inkl. Kap. 2.6, Kap. 4, PM-4)
**Umfang:** Periodischer Sweep gleicht beendete Outbound-Calls gegen Provider-Kostendaten ab und schreibt **ausschließlich** die vier in P2 angelegten Felder (`actualCostMicroCents`, `costTruedAt`, `costTruedSource`, `costTruingAttempts`). **Es wird NICHTS gebucht** — kein Gate, kein Meter, keine Budget-/Usage-Achse wird angefasst. Der Sweep *misst*, er *bucht nicht*.
**Gate-Ergebnis: PASS**
**finalBranch:** `phase/lct-p3-cost-truing-observe-fix1`
**headCommit (vor Fix-Runde r1):** `09fe26e8825ea9719c985d076b2c336532949f4e`
**Basis:** `master @ 8974b2c` (P1 + P2 bereits gemergt)
**Datum:** 2026-07-20

---

## 1. Plan (gekürzt)

### 1.1 Die eine Aussage der Phase

Der Beweis ist **negativ**: nach einem Sweep sind `usage.costCents` und `spendMonthCostCents` byte-identisch zu vorher. Geschrieben werden ausschließlich vier P2-Felder, die `publicCall` (`src/store/views.js`) bereits strippt und die kein Gate, kein Meter und keine Projektion liest. Kein Anfassen von `metering.js`, `call-finish.js`, `outbound-gates.js`, Budget-Pfaden in `state-ops.js`.

### 1.2 Neue Datei: `src/billing/cost-truing.js`

Factory nach dem Muster `makeMetering` (store + config im Closure, alle Kollaboratoren injiziert — DIP, offline unit-testbar). Exportiert `costTruingCoveragePercent(state)` (reine Leseprojektion, Nenner 0 → 0) und `makeCostTruing({ store, config, voiceControl, audit, now })` → `{ runCostTruingSweep }`.

Kernstücke, wörtlich aus dem Plan:

- **Laufriegel** — modul-lokaler `sweepRunning`-Boolean, **gesetzt vor dem ersten `await`**, freigegeben im `finally`. Begründung im Plan: Intervall-Trigger und manueller Endpunkt teilen sich denselben Riegel; ein nach dem `await` gesetzter Riegel schützt genau die Überlappungslücke NICHT. Ein zweiter Aufruf während eines laufenden Sweeps ist ein protokolliertes No-op (`{skipped:true, reason:"sweep_running"}`), kein Fehler.
- **Kandidaten-Prädikat** — beendeter Outbound-Call, `costTruedAt === null`, persistierter Versuchszähler `< costTruingMaxAttempts`, Aufschub `costTruingDelayMinutes` seit `endedAt` verstrichen. Ein prozess-lokaler (nicht persistierter) Zähler würde auf Render Free-Tier bei jedem Restart genullt und den Job unbegrenzt gegen tote Calls laufen lassen.
- **Ein Call abgleichen (`trueOneCall`)** — fehlende Adapter-Fähigkeit (`getVoiceCostRecords`) oder fehlende Leg-Referenz ist ein sauberer No-op: kein Wurf, kein Feld-Schreiben, kein verbrauchter Versuch. Der Port wirft nie (`try/catch` als zweite Sicherungslinie); `ok:false`, leere Antwort und unparsbare Summe sind vom Typ her von einer gemessenen Null unterscheidbar und heißen **niemals** "keine Kosten" (PM-4).
- **Leere Pflicht-Menge (`classifyRecords`)** — `requiredRecordTypes.length > 0 && requiredRecordTypes.every(...)`: die Länge-Prüfung ist der Riegel, weil "jeder Typ ist vertreten" über der leeren Menge allquantifiziert wahr wäre. Leer heißt deshalb `'incomplete'` ("nichts bewiesen"), nie `'telnyx_detail_records'`. Kein geratener Nicht-leer-Default.
- **Deckungsquote (`costTruingCoveragePercent`)** — Zähler: Calls mit `costTruedSource === 'telnyx_detail_records'`; Nenner: alle beendeten Outbound-Calls. **Nenner 0 → 0**, kein Freispruch (die 0-Zeilen-Antwort ist die fail-open-Variante genau der Zahl, die ab P4 den Flip freigibt). `Math.floor`, nicht `round` — Abweichung geht Richtung "zu wenig Deckung".
- **Sichtbarkeit** — die Quote wird am Ende **jedes** Sweeps geloggt, unabhängig davon, ob sie unter der Schwelle liegt. Unter der Schwelle: entprellter Befund `coverage_below_threshold` (Debounce-Fenster `costAlertDebounceMs`), nach `costTruingCoverageStallSweeps` aufeinanderfolgenden Unterschreitungen zusätzlich `coverage_stalled`.
- **Drift-WARN** — vergleicht `actualCostMicroCents` (USD-Mikro-Cent) gegen `estimatedCostCents` (EUR-Cent) **ohne Umrechnung** — bewusste, offen benannte Abweichung: reine Log-Zeile, kein Gate, keine Persistenz, beide Einheiten im Text, Kursfehler ~8 % gegen eine 50-%-Schwelle. `providerToBucketRateMicro` bekommt in P3 keinen Verbraucher.

### 1.3 Edits an Bestandsdateien (Auszug)

- `src/store/defaults.js` — Enum `COST_TRUING_SOURCE` (`DETAIL_RECORDS`/`INCOMPLETE`/`UNAVAILABLE`), eine Quelle für Store/Job/Tests.
- `src/store/state-ops.js` — einziger Schreibpfad `recordCallCostTruingResult` + `nextCostTruingAttempt` (eine Quelle für Kandidaten-Prüfung UND Zähler-Inkrement).
- `src/store/json.js` + `src/store/pg.js` — Wrapper-Parität, kein Schema-/Migrations-Edit, kein Index.
- `src/store.js` — Fassaden-Re-Export.
- `src/config.js` — sieben neue Felder im `billing`-Namespace (s. Abschnitt 9).
- `src/boot.js` — `setInterval(...).unref()` nach `assertBootGates`, **kein Lauf beim Boot** (bewusste Abweichung von beiden Vorbild-Jobs: der Sweep macht Provider-IO ohne Timeout/AbortController, ein hängender Abruf darf nicht an der Boot-Sequenz hängen).
- `src/routes/api-billing.js` — `POST /api/billing/cost-truing/sweep`, hinter bestehender `/api/*`-Basic-Auth, **kein MCP-Tool**, bewusst **ohne** `PAYMENT_ENABLED`-Gate (sonst im Live-Betrieb unauslösbar; der Endpunkt bewegt kein Geld).
- `src/app.js` / `src/server.js` — `costTruing` einmalig beim Boot verdrahtet (eine Instanz = ein Laufriegel pro Prozess).
- `.env.example` / `render.yaml` / `test/helpers.js` (BASE_ENV) / `test/config-namespaces.test.js` (Zähler-Nachzug).

### 1.4 Bewusst nicht angefasst

`metering.js`, `call-finish.js`, `outbound-gates.js`, alle Budget-/Reserve-/Usage-Pfade in `state-ops.js`, `boot-guard.js` (der Guard gegen die leere Pflicht-Menge gehört ausschließlich nach P4, hängt an einem hier noch nicht existierenden Flag), `schema.sql`, `views.js` (`publicCall` strippt die Felder bereits), `public/*`, `mcp-tools.js`.

### 1.5 Rot-vor-Fix-Reihenfolge (verbindlich vorgeschrieben)

1. Testdatei vollständig vor jeder Implementierungszeile schreiben, gegen unveränderten `master` fahren, wörtliche Fehlermeldung in den Report.
2. Nach grüner Suite: **Mutations-Probe** je Riegel (Zeile einzeln entschärfen → roten Fall notieren → zurücksetzen) — ein Riegel, der sich entfernen lässt, ohne dass ein Test rot wird, existiert im Sinne des Plans nicht.
3. Ein roter Test zählt nur, wenn er isoliert rot ist (vorbestehender ~12-%-Voll-Last-Flake).
4. Suite nicht grün → melden, kein Abschalten/Überspringen/Anpassen von Erwartungen.

---

## 2. Implementierungs-Zusammenfassung

PLAN P3 auf Branch `phase/lct-p3-cost-truing-observe` umgesetzt und committed (`09fe26e8`, Basis `master@8974b2c`), nach Fix-Runde r1 auf `phase/lct-p3-cost-truing-observe-fix1` überführt (s. Abschnitt 8).

Neues Modul `src/billing/cost-truing.js`: `makeCostTruing({store, config, voiceControl, audit, now})` liefert `runCostTruingSweep({trigger})`; exportiert `costTruingCoveragePercent(state)`, `COST_TRUING_SWEEP_INTERVAL_MS`, `SWEEP_TRIGGER`. Der Sweep gleicht beendete Outbound-Calls gegen `getVoiceCostRecords` ab und schreibt ausschließlich die vier P2-Felder über den einzigen neuen Schreibpfad `recordCallCostTruingResult`. Sieben neue Config-Felder im `billing`-Namespace, dokumentiert in `.env.example`/`render.yaml`, gepinnt in `test/helpers.js` BASE_ENV, `CONFIG_NAMESPACES.billing` 20→27 Schlüssel nachgezogen.

**Testergebnis (Stand vor Fix-Runde r1):** volle Suite 2705/2705 grün. Nach Fix-Runde r1: 2708/2708 grün (unabhängig reproduziert, s. Abschnitt 6).

### 2.1 Deviations (Abweichungen vom Plantext, vom Implementierer selbst benannt)

1. **`test/telnyx-cost-records.test.js` wurde angefasst**, obwohl weder in der Plan-Liste "unverändert grün bleibender Dateien" noch in der Liste der betroffenen P3-Dateien genannt. Grund: die Datei pinnte als P1-Akzeptanzkriterium "`getVoiceCostRecords` hat keinen Aufrufer" — genau diese Invariante hebt der P3-Kern (der Sweep ist der erste vorgesehene Aufrufer) explizit auf. Test umgebaut zu einer `FORBIDDEN_CALLER_FILES`-Liste: bestätigt, dass der Aufrufer nur in `cost-truing.js` steht und nie in `metering.js`/`call-finish.js`/`outbound-gates.js`. Wertung: Verschärfung der ursprünglichen Schutzabsicht, keine Aufweichung.
2. **Modul-Kopfkommentar in `cost-truing.js` an zwei Stellen umformuliert** (statt `SELECT` → "naive, direkt abgesetzte Anfrage"; statt `providerToBucketRateMicro` → umschreibende Formulierung), weil der wörtliche Plan-Text sonst die eigenen grep-basierten Akzeptanzkriterien aus Plan-Abschnitt 6 (0 Treffer für beide Suchmuster) verletzt hätte. Bedeutung vollständig erhalten, nur die exakten Grep-Zielstrings vermieden.
3. **Testfall (b) verschärft:** jeder der sechs Sweep-Läufe im Test läuft auf einer frisch instanziierten `makeCostTruing`-Fabrik (simuliert einen Prozess-Restart). Die ursprüngliche Fassung (eine Fabrik-Instanz für alle 6 Läufe) hätte die geforderte Mutations-Probe "persistierten Zähler durch In-Memory-Zähler ersetzen" **nicht** rot werden lassen — ein In-Memory-Zähler hätte innerhalb desselben Closures über mehrere Aufrufe identisch zu einem persistierten funktioniert. Verschärfung im Sinne des Plans, keine Abweichung von seiner Absicht.
4. **`countOutcome(tally, measured, closed)`** war im Plan nur als Signatur/Aufrufstelle vorgegeben, der Funktionskörper nicht ausformuliert (bewusste Lücke). Implementiert als: `measured===null && closed` → `failed++`; `measured===null && !closed` → `unavailable++`; `measured.source===DETAIL_RECORDS` → `measured++`; sonst `incomplete++`. Konsistent mit den im Plan benannten Tally-Feldern.

---

## 3. Rot-vor-Fix-Nachweis (wörtliche Fehlermeldung)

`test/cost-truing-observe.test.js` (15 Fälle a–k inkl. h1–h3/j1–j3) vollständig **vor** jeder Implementierungszeile geschrieben und gegen unveränderten `master` (`8974b2c`) gefahren:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/billing/cost-truing.js' imported from '.../test/cost-truing-observe.test.js'
```

1 Testdatei, 0 pass, 1 fail — isoliert gefahren (Einzeldatei), kein Voll-Last-Flake-Risiko.

**Mutations-Proben** (7 aus der Plan-Tabelle, je einzeln entschärft → roten Fall notiert → zurückgesetzt, danach diff-verifiziert byte-identisch zum Implementierungsstand):

| # | Mutation | Roter Fall |
|---|---|---|
| 1 | Laufriegel-Set nach dem `await` in `trueOneCall` verschoben | (g) — Deadlock/Timeout, ein noch stärkerer roter Beweis als eine reine Assertion |
| 2 | Riegel gegen die leere Pflicht-Menge entfernt | (h1) |
| 3 | Nenner-0-Fall auf `100` statt `0` gesetzt | (i) |
| 4 | `emitFinding` für `coverage_below_threshold` auskommentiert | (j1) |
| 5 | `shouldEmitFinding` immer `true` | (j1) |
| 6 | Persistierter Versuchszähler durch In-Memory-Zähler ersetzt | (b) — fiel erst nach der unter Abschnitt 2.1/#3 dokumentierten Testverschärfung rot |
| 7 | Riegel gegen leere Records-Liste aus `classifyRecords` entfernt | (k) |

Ein Riegel, der sich entfernen lässt, ohne dass ein Test rot wird, existiert im Sinne des Plans nicht — alle sieben geprüften Riegel bestehen die Probe.

---

## 4. Die harten Zusagen der Phase (mit Beleg)

| # | Zusage | Status | Beleg |
|---|---|---|---|
| 1 | **Buchung unverändert** — der Sweep schreibt kein Gate, keinen Meter, keine Budget-/Usage-Achse | ✅ erfüllt | Einziger Schreibpfad ist `store.recordCallCostTruingResult` → `state-ops.recordCallCostTruingResult`, das ausschließlich vier P2-Felder am Call setzt. Grep über `cost-truing.js`/`api-billing.js`/`boot.js`: kein Treffer für `costCents`, `spendMonthCostCents`, `bookCents`, `addVoiceUsageCostCents`, `markBilled`, `gateUsageCents`. `metering.js`/`call-finish.js`/`outbound-gates.js` im Diff unberührt (per `git diff --stat` + `telnyx-cost-records.test.js`-Dateiscan geprüft). Test (a): `usage.costCents`/`spendMonthCostCents` vor/nach Sweep `deepStrictEqual`. |
| 2 | **Laufriegel vor dem ersten `await`** | ✅ erfüllt | `runCostTruingSweep`: `sweepRunning=true` steht vor `return await sweepAllCandidates(trigger)`, Freigabe im `finally`. Test (g) konstruiert echte Nebenläufigkeit (Provider-Promise künstlich offengehalten): zweiter Lauf während des ersten → `{skipped:true, reason:"sweep_running"}`, Adapter genau 1× gerufen, Zähler steigt um 1 statt 2, genau 1 Schreibvorgang; dritter Lauf danach wieder normal (Riegel klemmt nicht). Mutations-Probe 1 (Riegel hinter den `await` verschoben) macht (g) rot. |
| 3 | **Zähler persistiert, nicht in-memory** | ✅ erfüllt | `costTruingAttempts` liegt am Call (P2-Feld), einzige Schreibstelle `nextCostTruingAttempt`/`recordCallCostTruingResult`. Test (b) instanziiert für jeden der sechs Läufe eine frische Fabrik — genau der Unterschied, der einen Closure-Zähler enttarnt hätte. Mutations-Probe 6 bestätigt: In-Memory-Ersatz macht (b) rot. |
| 4 | **Leere Pflicht-Menge → `incomplete`, nie `telnyx_detail_records`** | ✅ erfüllt | `classifyRecords`: `complete = requiredRecordTypes.length > 0 && every(...)`. Code-Default ist leer (`config.js`, `.env.example`, `render.yaml`). Tests h1/h2/h3 mit identischen Records gegen leere/erfüllte/unerfüllte Menge. Mutations-Probe 2 bestätigt. |
| 5 | **Nenner 0 → 0** (nie 100, nie NaN) | ✅ erfüllt | `costTruingCoveragePercent`: `if (ended.length === 0) return 0`. Test (i): `assert.strictEqual(..., 0)` plus explizite Gegenproben gegen 100 und `NaN`. Mutations-Probe 3 bestätigt. |
| 6 | **Quote wird gemeldet, nicht nur berechnet** | ✅ erfüllt | `reportCoverage` loggt die Quote am Ende jedes Sweeps (Test j3 pinnt die Logzeile auch ohne Befund). Unter Schwelle: genau ein entprellter Befund `coverage_below_threshold` über `console.warn` UND `audit` (Test j1: 1× / 0× im Debounce-Fenster / wieder 1× danach); Stillstands-Eskalation `coverage_stalled` (Test j2). Der HTTP-Endpunkt gibt `coveragePercent` zusätzlich im Body zurück. Mutations-Proben 4+5 bestätigen. |
| 7 | **Alle Tenants** (keine RLS-Falle, kein eigenes SQL) | ✅ erfüllt | Der Job arbeitet auf `store.load().calls`; `pg.js hydrate()` hängt die Calls jedes Tenants an die flache Liste an. `grep client.query\|pool\|SELECT` in `cost-truing.js` → 0 Treffer. Test (d): zwei Tenants, je ein fälliger Call → beide abgeglichen; Stub-Store bewusst ohne Query-Fähigkeit. |
| 8 | **Keine PII in Logs/Audit/HTTP-Antwort** | ✅ erfüllt | Sweep-Log nur Zähler, Befund nur Code/Quote/Schwelle/Sweeps, HTTP-Antwort nur Zähler+Quote, Drift-WARN trägt nur `call.id` + zwei Beträge. Tests (e)/(j1) sowie der API-Test prüfen explizit mit markanten PII-Fixturen gegen Log-, Audit- und Response-Ausgabe. |

---

## 5. Safety-Urteil (final)

**Verdikt: FREIGABE (approved).**

Alle geprüften Achsen positiv: Tests unabhängig reproduziert (2708/2708, kein Flake beobachtet), Rot-vor-Fix glaubwürdig, alle acht Zusagen aus Abschnitt 4 einzeln am Code + per Test bewiesen, Auth fail-closed (`POST /api/billing/cost-truing/sweep` hinter bestehender `/api/*`-Basic-Auth, ohne Credentials → 401), kein Fail-open-Pfad (`ok:false`, Portwurf, leere Records-Liste, unparsbare/negative Summe führen alle auf `measured=null` → `'unavailable'`, nie auf 0 oder "vollständig"), Scope eingehalten (keine neue Dependency, keine Änderung an `claude.js`, `telephony/`, `auth.js`, `web-auth.js`, `middleware.js`, Offenlegungssatz unangetastet).

### 5.1 Concerns (keine Blocker, Auflagen für P4/Betrieb)

1. **Endgültiger Abschluss bei leerer Pflicht-Menge:** solange `COST_TRUING_REQUIRED_RECORD_TYPES` leer bleibt (Code-/Live-Default), wird jeder erfolgreich abgerufene Call dauerhaft als `'incomplete'` geschlossen (`costTruedAt` gesetzt) und bleibt für immer im Nenner der Deckungsquote, nie im Zähler. Richtung ist fail-closed (Quote wird gedrückt, Flip verzögert), aber operativ heißt das: **die Pflicht-Menge muss gesetzt sein, bevor nennenswerter Verkehr durch den Sweep läuft**, sonst erreicht die Mindestquote strukturell nie die Schwelle. P4b braucht ggf. einen Re-Open-Pfad. Gehört als Betriebs-Auflage in den P4-Plan.
2. **Gemessene Null:** `classifyRecords` liefert bei vorhandenen Records mit Summe 0 ein `measured`-Objekt mit `actualCostMicroCents=0`; bei vollständiger Typ-Menge wäre `source='telnyx_detail_records'`. In P3 harmlos (nichts wird gebucht), ab P4 wäre das eine Vollrückerstattung der Schätzung bei formal beweisbarer Datenlage — derselbe Ausfallmodus wie PM-4, nur über eine echte statt einer fehlenden Antwort. P4 braucht einen expliziten Guard.
3. **Währungsgemischte Drift-Prozentzahl:** `warnOnCostDrift` vergleicht USD-Mikro-Cent gegen EUR-Cent und gibt daraus eine Prozentzahl aus. Sauber begründet und als reine Log-Ausgabe gekennzeichnet (kein Gate, keine Persistenz), plandeckend — die Zahl ist aber systematisch um den Kursfaktor verzerrt und darf nicht als Kalibrierungsgröße gelesen werden. P4 muss den Vergleich auf den umgerechneten Wert umstellen.
4. **Stillstands-Zähler prozess-lokal:** `sweepsBelowThreshold` wird von einem Free-Tier-Restart genullt; `coverage_stalled` kann bei häufigen Restarts nie auslösen. Im Code als akzeptiertes Restrisiko dokumentiert; die tragende, bei jedem Sweep neu aus Daten abgeleitete Meldung `coverage_below_threshold` ist davon unberührt. Der Versuchszähler (`costTruingAttempts`) — der einzige, den der Plan als persistiert fordert — liegt korrekt am Call.
5. **Bestands-Calls ohne P2-Felder:** `isTruingCandidate` prüft `costTruedAt !== null`; ein Call mit `undefined` (theoretisch, falls Normalisierung ausbliebe) fiele aus dem Job. Hydrierung in `json.js`/`pg.js` normalisiert heute auf `null` bzw. `0`, Pfad ist geschlossen — bleibt aber eine Invariante per Konvention.

---

## 6. Unabhängiger Testlauf (Safety-Review)

Eigener Lauf im frischen Worktree (Branch `review-lct-p3-r1` auf `phase/lct-p3-cost-truing-observe-fix1`): `npm test` = **2708 Tests, 2708 pass, 0 fail**, 0 cancelled/skipped, 77,8 s. Die Postgres-Backend-Tests (pglite, ~30 Dateien) laufen in derselben Suite mit und sind grün. Zusätzlich isoliert: `test/cost-truing-observe.test.js` + `test/api-cost-truing-sweep.test.js` + `test/telnyx-cost-records.test.js` = 57/0. Kein Flake beobachtet. `npx eslint` ließ sich im Worktree wegen eines Symlink-Artefakts (`ERR_MODULE_NOT_FOUND @eslint/js`) nicht ausführen — Umgebungsartefakt, kein Code-Befund.

---

## 7. Clean-Code-Audit (final)

**Verdikt: PASS.** Keine S1/S2-Befunde. Alle Schwellen/Intervalle sind benannte, in `config.js` konfigurierbare Konstanten, keine Funktion über 100 Zeilen, keine Verschachtelung über 4, keine Signatur über 3 Argumente (Objekt-Bündelung durchgehend), keine Duplizierung zwischen Sweep-Schleife und Coverage-Berechnung (`isEndedOutbound` wird geteilt), keine toten Schalter, keine Umlaute in Kommentaren, 2708/2708 Tests grün.

**s1 (Blocker):** keine.
**s2 (schwerwiegend):** keine.

**s3 (Politur):**
1. `test/cost-truing-observe.test.js` Fall (b) — die von `runCostTruingSweep` zurückgegebene `tally.failed`-Zählung wurde ursprünglich nicht direkt assertiert (nur die persistierten Call-Felder). **Als Blocker P11/T1 eingestuft und in Fix-Runde r1 behoben** (s. Abschnitt 8).

**s4 (Kosmetik):**
1. `src/billing/cost-truing.js` vs. `src/boot.js` (`RETENTION_SWEEP_INTERVAL_MS`) — `COST_TRUING_SWEEP_INTERVAL_MS` trägt zufällig denselben Literalwert (6 h) wie der vorbestehende Retention-Job, sind aber bewusst getrennte, domänenspezifische Konstanten. Kein Fix nötig; nur zur Kenntnis für den Fall, dass beide Jobs künftig dieselbe Kadenz teilen müssten.

**Top-Todos:** keine Blocker vor Merge. Außerhalb des Diff-Scopes, aber im Code selbst dokumentiert: der Laufriegel ist prozess-lokal und wird beim ersten Skalierungsschritt (2. Render-Instanz) wirkungslos — bereits als bewusste, später zu ersetzende Annahme im Modul-Kopfkommentar festgehalten.

**Geprüfte Kategorien:** G5 (Duplizierung) — `nextCostTruingAttempt` ist die eine Quelle für Kandidaten-Prüfung UND Zähler-Inkrement; `COST_TRUING_SOURCE` ist die eine Enum-Quelle; `SWEEP_TRIGGER`/`COST_TRUING_SWEEP_INTERVAL_MS` werden importiert statt dupliziert. G25 (Magic Numbers) — alle Schwellen benannte Konstanten oder Config-Werte. G26 (Geld-Präzision) — durchgehend Ganzzahl-Arithmetik, kein Float auf dem Geld-Pfad, USD bleibt USD (grep-bewiesen). G30/G34 — jede Funktion ein klarer Einzelzweck, längste (`trueOneCall`) ~47 Zeilen, Verschachtelung ≤2. F1 (≤3 Argumente) — durchgehend eingehalten, Optionsobjekte wo nötig. C5/G9 (kein toter/auskommentierter Code) — alle Mutations-Proben vollständig zurückgesetzt und diff-verifiziert. DIP — `voiceControl` kommt aus der Telephony-Registry, kein direkter Adapter-Import. Auth fail-closed — eigener Test.

---

## 8. Fix-Runden

**r1** (nach initialem Clean-Code-Blocker P11/T1, oben als s3-Punkt geführt): neuer HTTP-/Verdrahtungs-Test `test/api-cost-truing-sweep.test.js` (Muster `test/api-flush-meters.test.js`, Spawn via `startServer`, netzfrei) ergänzt, u. a. mit dem Fall "leerer Store: `POST /api/billing/cost-truing/sweep` → 200 und `deepEqual` auf die volle Zähler-Shape". Damit ist die Rückgabewert-Form des Sweeps (inkl. `failed`) jetzt auch über den HTTP-Pfad direkt assertiert, nicht nur über die persistierten Call-Felder. Ergebnis nach Fix: Safety-Review und Clean-Code-Audit beide PASS auf `phase/lct-p3-cost-truing-observe-fix1` (finalBranch), Testzahl 2705 → 2708.

Die Quelle des Fix-Eintrags r1 war im übergebenen Material nach dem oben zitierten Satz abgeschnitten; der vollständige Wortlaut der weiteren Testfälle (B, C, …) lag diesem Report nicht vor.

---

## 9. Neue Env-Variablen und live benötigte Werte

Sieben neue Felder im `billing`-Namespace von `src/config.js`, alle in `.env.example` und `render.yaml` dokumentiert und in `test/helpers.js` (BASE_ENV) auf die Code-Defaults gepinnt.

| Env-Variable | Code-Default | Live-Bedarf |
|---|---|---|
| `COST_TRUING_DELAY_MINUTES` | `180` | Default fahren lassen; die CDR-Latenz ist laut Plan (Kap. 2.6) **unbelegt** — Wert nach dem ersten Live-Beleg empirisch nachziehen, nicht raten. |
| `COST_TRUING_MAX_ATTEMPTS` | `5` | Default fahren lassen. |
| `COST_TRUING_REQUIRED_RECORD_TYPES` | **leer (`""`)** | **Kritischer Wert.** Muss aus einer echten Live-Messung befüllt werden — der Plan nennt als Kandidaten aus der Messung vom 2026-07-20: `sip-trunking, call-control, speech-to-text, text-to-speech, recording, inference, ai-voice-assistant` (der Typ `call` existiert **nicht**). Solange die Variable leer bleibt (aktueller Zustand, bewusst so für die Beobachtungsphase), schließt der Sweep jeden erfolgreich abgerufenen Call dauerhaft als `'incomplete'` (Safety-Concern 1, Abschnitt 5.1) — das ist der Zweck von P3: erst beobachten, dann die Menge auf Basis echter Daten setzen, **nicht** vor genügend Beobachtungsdaten befüllen. |
| `COST_TRUING_MIN_COVERAGE_PERCENT` | `80` | Default fahren lassen; ist die Vorbedingungs-Schwelle für den P4/P4b-Flip und darf laut Plan **nie gesenkt werden**, um eine Vorbedingung künstlich zu erfüllen. |
| `COST_TRUING_COVERAGE_STALL_SWEEPS` | `8` (≈ 2 Tage bei 6-h-Kadenz) | Default fahren lassen. |
| `COST_DRIFT_WARN_PERCENT` | `50` | Default fahren lassen; die Prozentzahl ist wegen der Währungsvermischung (Safety-Concern 3) ohnehin nicht als Kalibrierungsgröße zu lesen. |
| `COST_ALERT_DEBOUNCE_MS` | `86400000` (24 h) | Default fahren lassen. |

Keine der sieben Variablen ist zum Live-Betrieb der Phase **zwingend** zu setzen — alle Defaults sind lauffähig, der Sweep arbeitet im Beobachtungsmodus. Einzige Variable mit echtem operativem Handlungsbedarf ist `COST_TRUING_REQUIRED_RECORD_TYPES`, und zwar erst **nach** einer Beobachtungsperiode mit den Live-Defaults, nicht vorher.

---

## Anhang: Quellenhinweis zu personenbezogenen Daten

Die Quelltexte (Plan, Impl-Report, Safety-Urteil, Clean-Code-Audit, Fix-Eintrag) wurden vor dem Schreiben dieses Reports auf personenbezogene Daten geprüft (Telefonnummern, Namen, E-Mail-Adressen, Kunden-IDs). Es wurden keine gefunden — Verweise auf "Rufnummer der Fixture", "tenant.ownerName" oder "Transkript-Fragment" in den Testfall-Beschreibungen sind abstrakte Bezeichnungen von Testkonstrukten, keine tatsächlichen Werte. Lokale Dateisystempfade in der Quelle (Worktree-Pfade unter `.claude/worktrees/wf_a9bd1265-c98-2/`) enthalten keine Drittdaten und wurden in diesem Report auf repo-relative Pfadangaben reduziert.
