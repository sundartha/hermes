# Phase KE-P9 — Belegabruf nur über abrufbare Kandidaten

- **Gate:** PASS
- **finalBranch:** `phase/ke-p9-abrufbare-kandidaten`
- **Basis:** `master` = `f892e54` (Arbeitsbaum sauber)
- **headCommit:** `3cb6f57aa498c5c6ab547750ef80e8e0d6819add`
- **Autoritativ:** `tasks/ke-p9-spec.md`

---

## 1. Plan (gekürzt)

**Blast-Radius laut Plan:** eine Quelldatei (`src/billing/cost-truing.js`), eine neue Testdatei. Kein Env, keine Dependency, kein Log-Format, kein `render.yaml`.

### Kernentscheidung

Die Bedingung „abrufbar" bestand bisher aus zwei Halbsätzen, von denen einer (`control`) erst als **Nebenprodukt des Netzabrufs** in `fetchCostRecordPoolFor` anfiel. Der Plan spaltet die Funktion entlang der Netzgrenze:

| heute | nachher |
| --- | --- |
| `fetchCostRecordPoolFor(provider, since)` = Provideraufloesung + Faehigkeitspruefung **+** Netzabruf | `costRecordControlFor(provider)` (**synchron, kein Netz**) → `control \| null` <br> `fetchCostRecordPoolFor(control, since)` (**nur Netz**) |

Damit steht `control` **vor** dem Abruf zur Verfügung, ohne Duplizierung der Auflösung und ohne zweiten Netz-Zugriff (PM-5: die einzigen `await`s bleiben in `fetchCostRecordPools`, die Buchungsschleife danach bleibt await-frei).

Die Bedingung existiert **genau einmal**:

```js
const isRetrievable = (call, control) => control !== null && providerLegIdOf(call) !== null;
```

Beide Verbraucher lesen dieselbe Funktion und dieselbe je Provider einmal aufgelöste `controls`-Map:
1. `retrievable = candidates.filter(...)` → bestimmt Provider-Menge **und** `poolSinceFor`,
2. die Buchungsschleife läuft **ausschließlich** über `retrievable`.

Weil (2) eine Teilmenge von (1) ist, entfällt der Zweig `if (!control || !legId)` in `trueOneCall` — er wäre ab jetzt toter Code (G9) und wird gelöscht; `uebersprungen=` wird zur **Mengendifferenz** `candidates.length - retrievable.length`.

**Pre-Mortem-Abdeckung:** PM-1 (zu scharf) → Test P9-2; PM-2 (zu lasch) → P9-1; PM-3 (Schranke rutscht nach vorn) → `poolSinceFor(retrievable)` bekommt alle abrufbaren Kandidaten, nie eine Teilmenge (P9-2 pinnt den Wert literal); PM-4 (leere abrufbare Menge) → identischer Ausgang zu „0 Kandidaten", Bilanz wird trotzdem geloggt → P9-1/P9-3.

**Benanntes Restrisiko:** `pools.get(call.provider)` ist nur deshalb nie `undefined`, weil Map und Schleife aus derselben `retrievable`-Liste gebaut werden — als Kommentar an der Stelle festgehalten. Ein späterer Verstoß wäre ein `TypeError` im Sweep, gefangen vom `.catch()` an der Intervall-Naht (`src/boot.js`) — kein Prozess-Crash, kein Geld-Pfad-Risiko.

### Edits A–G in `src/billing/cost-truing.js`

- **A** — veralteten TDZ-Begründungskommentar über `nonNegativeCount` entfernt (C2).
- **B** — `NO_POOL_FETCH` ersatzlos gelöscht (nach Edit C referenzlos, G12).
- **C** — `NO_COST_RECORDS` ersetzt durch: `costRecordControlFor(provider)` (synchron, `control | null`, fängt den `voiceControl`-Wurf und prüft `fetchCostRecordPool`/`assignCostRecords`), `isRetrievable(call, control)` (die eine Bedingung) und `costRecordControlsFor(candidates)` (je Provider einmal aufgelöste Map).
- **D** — `fetchCostRecordPoolFor(control, since)` nimmt die bereits aufgelöste Steuerung entgegen statt selbst aufzulösen; Body sonst unverändert.
- **E** — `fetchCostRecordPools(retrievable, controls)`: Schleife läuft nur noch über abrufbare Kandidaten, `since` wird über `retrievable` gebildet (nie über eine Teilmenge davon).
- **F** — `trueOneCall`: toter Überspring-Zweig (`if (!control || !legId) { tally.skippedCalls++; return; }`) entfernt, da die Schleife ab jetzt strukturell nur abrufbare Calls sieht.
- **G** — `sweepAllCandidates`: `controls = costRecordControlsFor(candidates)`, `retrievable = candidates.filter(...)`, `skippedCalls = candidates.length - retrievable.length`, Buchungsschleife läuft über `retrievable`. `candidateCount`/Rückgabe-Shape byte-identisch.

**Clean-Code-Bilanz laut Plan:** keine Magic Number, keine neue Konstante nötig, keine Duplizierung, ≤2 Argumente je neuer Funktion, Verschachtelungstiefe ≤2, zwei tote Konstanten + ein toter Zweig entfernt, ein veralteter Kommentar entfernt. Keine Berührung von Gates, Disclosure, Auth, Secrets.

### Neue Tests — `test/cost-truing-retrievable.test.js`

Feste Uhr `P9_NOW = "2026-07-21T18:00:00.000Z"`, netzfrei via `stubCountingFetch`, Fixturen aus `test/cost-truing-harness.js` (keine neuen Helper).

- **P9-1** (Abnahmekriterium): drei fällige Kandidaten, alle ohne Leg-Referenz, echter `telnyxVoice`-Adapter → `fetchCalls.length === 0`, `store.writes.length === 0`, `res.candidates === 3`, `res.skippedCalls === 3`.
- **P9-2** (Gegenprobe PM-1/PM-3): ein alter nicht abrufbarer Call + ein junger abrufbarer Call → Pool wird weiterhin geholt (`poolParams.length === 1`), Schranke hängt am abrufbaren Call (`since === "2026-07-21T14:00:00.000Z"`, nicht am alten `"...T07:00:00.000Z"`), `res.skippedCalls === 1`, der eine Schreibzugriff gehört dem jungen Call.
- **P9-3** (PM-4, leere abrufbare Menge): Zeile über `captureConsole` byte-genau gepinnt: `… kandidaten=3 … uebersprungen=3 anfragen=0 seiten=0 pool=0 vollstaendig=true`.

**Bestandssuite laut Plan unberührt:** `cost-truing-observe.test.js` (f) und `cost-truing-pool.test.js` (P2-6) bleiben grün, weil sie genau das Verhalten pinnen, das der Filter jetzt strukturell erzwingt. Gemessener Bestand vor der Phase: `test/cost-truing-*.test.js` → 74/74 grün.

### Deterministisch geplanter roter Lauf (vor den `src/`-Edits, am unveränderten `master` verifiziert)

```
✖ (P9-1)  actual: 6,                          expected: 0
✖ (P9-2)  actual: '2026-07-21T07:00:00.000Z', expected: '2026-07-21T14:00:00.000Z'
✖ (P9-3)  actual '… uebersprungen=3 anfragen=6 seiten=6 pool=0 vollstaendig=true'
          expected '… uebersprungen=3 anfragen=0 seiten=0 pool=0 vollstaendig=true'
ℹ tests 3 · pass 0 · fail 3
```

**Zusatzbeweis:** `grep -n "NO_COST_RECORDS\|NO_POOL_FETCH\|skippedCalls++" src/billing/cost-truing.js` → 0 Treffer erwartet.

---

## 2. Impl-Zusammenfassung

Umsetzung exakt gemäß Plan: `src/billing/cost-truing.js` entlang der Netzgrenze gespalten (`costRecordControlFor`/`costRecordControlsFor` synchron **vor** dem Abruf, `fetchCostRecordPoolFor`/`fetchCostRecordPools` nehmen die bereits aufgelöste Steuerung entgegen), **eine** Bedingung `isRetrievable` bestimmt sowohl die Provider-/Zeitschranken-Menge (`retrievable`) als auch die Buchungsschleife. Toter Überspring-Zweig in `trueOneCall` sowie `NO_COST_RECORDS`/`NO_POOL_FETCH` entfernt. `sweepAllCandidates` berechnet `skippedCalls` als Mengendifferenz `candidates.length - retrievable.length`.

**Roter Lauf:** vor den `src/`-Edits erzeugt, bestätigt exakt die im Plan vorhergesagten Werte (P9-1: 6→0 Anfragen; P9-2: `since` 07:00→14:00; P9-3: `anfragen=6→0`).

**Grüner Lauf nach den Edits:**
- 3 neue Tests grün.
- `test/cost-truing-*.test.js`-Gebiet: 77/77 grün (74 Bestand unverändert + 3 neu).
- Volle Suite zweimal 2935/2935 grün (0 fail, kein Flake beobachtet in diesem Lauf-Paar).
- `grep` auf `NO_COST_RECORDS`/`NO_POOL_FETCH`/`skippedCalls++` → 0 Treffer.
- `node --check src/billing/cost-truing.js` → keine Ausgabe (Pass).

**Smoke-Test:** Server via `test/helpers.js` `startServer()` mit `BASE_ENV` + `SKIP_TWILIO_SIGNATURE_CHECK=true` auf freiem Port gestartet: `/healthz` → 200, `POST /api/billing/cost-truing/sweep` → 200 mit `{skipped:false,candidates:0,...}` (leerer Store, Route läuft sauber durch den neuen Code-Pfad ohne Wurf).

**Clean-Code-Selbstcheck des Implementierers:** G5 (Duplizierung) — `isRetrievable` existiert genau einmal. G9/C5 (toter Code) — `NO_COST_RECORDS`, `NO_POOL_FETCH`, Überspring-Zweig entfernt, grep verifiziert 0 Treffer. C2 (veralteter Kommentar) — TDZ-Begründung entfernt. F1 (Argumente) — alle neuen/geänderten Funktionen ≤2 Argumente. G25 (Magic Numbers) — keine neuen. P15 (Lazy-Init) — `controls`-Map wird explizit vor dem Abruf aufgebaut. Verschachtelungstiefe ≤2 durchgehend. Kommentare deutsch ohne Umlaute, passend zum Bestand. Alle Edits byte-identisch zum Plan (A–G geprüft).

**Commit:** `3cb6f57` auf `phase/ke-p9-abrufbare-kandidaten`. Geänderte Dateien: `src/billing/cost-truing.js`, `test/cost-truing-retrievable.test.js` — sonst nichts. Keine Env-/Dependency-/`render.yaml`-Änderung, keine Berührung von Gates/Disclosure/Auth/Secrets.

### Deviations

**Keine.** (`"deviations": []` im Impl-Report; Dateien exakt wie im Plan vorgesehen.)

---

## 3. Safety-Urteil

**Verdikt: FREIGABE** (`approved: true`). Alle geprüften Flags positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`. Keine Blocker.

**Diff-Umfang:** genau 2 Dateien — `src/billing/cost-truing.js` (+121/-44) und `test/cost-truing-retrievable.test.js` (+100, neu). Keine Änderung an `package.json`/`package-lock.json` (keine neue Dependency), keine an `render.yaml`/`.env.example`/`src/config.js`, keine an `src/claude.js`, `src/bridge.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/server.js` oder `src/telephony/` — per `git diff --name-only` gegen diese Pfade geprüft (0 Treffer). Offenlegungssatz, alle `numberGateError`-Gates, Signaturprüfung, Basic-/MCP-Auth und Audio-Pfad byte-identisch zu `master`. Keine neue Route, kein neuer Endpunkt.

**Secrets:** einzige hinzugefügte `process.env`-Zeilen im Testkopf (`TELNYX_API_BASE`/`TELNYX_API_KEY`/`PROVIDER_CURRENCY`) mit demselben Platzhalter wie in 4 bestehenden Schwesterdateien. Kein echter Schlüssel, 0 hinzugefügte `console.*`-Zeilen.

**Verhalten — selbst nachgerechnet:**
1. **Äquivalenz der Skip-Menge:** alt `!control || !legId` in `trueOneCall`, neu `isRetrievable` + `skippedCalls = candidates.length - retrievable.length`. `costRecordControlFor` liefert ausschließlich Adapter-Objekt oder `null` (nie `undefined`), `providerLegIdOf` liefert String oder `null` — Komplementmenge ist punktgenau dieselbe. Bestandstests, die das pinnen (`cost-truing-observe` (f), `cost-truing-pool` P2-6, `api-cost-truing-sweep`), laufen unverändert grün.
2. **PM-3 entschärft:** `poolSinceFor` läuft über ALLE abrufbaren Kandidaten, nie über eine Teilmenge. `since` kann durch den Filter nur später werden, jeder abrufbare Kandidat liegt per Konstruktion innerhalb der neuen Schranke minus `POOL_SINCE_MARGIN_MS`. Ein Beleg eines abrufbaren Calls kann nicht aus dem Fenster fallen — keine fail-OPEN-Richtung.
3. **Design-Auflage erfüllt:** `isRetrievable` existiert genau einmal (`cost-truing.js:421`), speist beide Seiten aus derselben `controls`-Map; `pools.get()` kann strukturell nicht `undefined` liefern.
4. **PM-5 gewahrt:** `costRecordControlFor`/`costRecordControlsFor` rein synchron, laufen vor dem ersten `await`. Kein zusätzlicher Netz-Zugriff.
5. **Fail-closed unverändert:** unbekannter Provider → `registry.pick` wirft → `costRecordControlFor` fängt, liefert `null` → nicht abrufbar → kein Abruf/Schreibzugriff/verbrauchter Versuch. Nicht abrufbare Calls bleiben im Nenner der Deckungsquote.
6. **Keine Leiche:** `NO_POOL_FETCH`/`NO_COST_RECORDS` vollständig entfernt, repo-weiter grep 0 Treffer. Sweep-Log-Format byte-identisch, Rückgabe-Schlüssel unverändert.

**Unabhängige Testmessung (Safety-Reviewer, eigener Worktree, Branch `review-ke-p9`):**
- Voller Lauf 1 (Branch, `npm test`): 2935 tests, 2933 pass, 2 fail (167,6 s) — `test/finishcall-billing-once.test.js` + `test/g1-identity-binding.test.js`.
- Isolationslauf dieser 2 Dateien: 5/5 grün.
- Voller Lauf 2 (Branch, `npm test`): 2935/2935 grün, 0 fail (83,3 s) → die 2 Fehler aus Lauf 1 sind der bekannte Voll-Last-Spawn-Race, nicht die Phase.
- Baseline `master` (git archive, gleicher `node_modules`-Symlink): 2932/2932 grün. Rechnung geht auf: 2932 + 3 neue = 2935, kein Bestandstest entfernt/umgeschrieben.
- Beide Backends (json + pg über die 21 dedizierten `*-pg.test.js`/pglite-Dateien) grün in Lauf 2.
- Rot-vor-grün unabhängig nachgestellt: `test/cost-truing-retrievable.test.js` in den `master`-Snapshot kopiert → 3 tests, 0 pass, 3 fail, mit den echten Sachverhalten (nicht Platzhalter) als Fehlermeldung. Auf dem Branch: 3/3 grün.
- `node --check src/billing/cost-truing.js`: OK.

### Concerns (keiner blockierend)

1. **Kein Kill-Switch/Flag:** Änderung wirkt unbedingt (Spec verbietet eine neue Env-Variable ausdrücklich). Rollback nur per Redeploy möglich. Richtung fail-closed (engeres `since`, nie weiter), aber im Geld-nahen Pfad ohne Schalter.
2. **Latente Invariante-per-Konvention:** `fetchCostRecordPoolFor(control, since)` (`src/billing/cost-truing.js:448`) prüft sein `control`-Argument nicht mehr. Der Zugriff `control.fetchCostRecordPool` liegt im `try` — ein `null`/`undefined`-`control` landete still im `catch` und würde ALLE Calls dieses Providers als `unavailable` mit VERBRAUCHTEM Versuch schreiben statt als sauberes No-op. Heute unerreichbar (einziger Aufrufer iteriert `retrievable`), aber genau der Muster-Typ aus dem Clean-Code-Audit 07-15 (Invarianten per Konvention statt per Guard). Richtung wäre konservativ (kein Geld bewegt).
3. **Nicht abrufbare Calls bleiben dauerhaft Kandidaten:** kein Versuch wird verbraucht, `isTruingCandidate` schließt nur über `costTruedAt` aus. Kandidatenliste und `uebersprungen=` wachsen monoton, Nenner der Deckungsquote bleibt dauerhaft gedrückt. Ausdrücklich Owner-Entscheidung und laut Spec Kap. 2 out-of-scope — kein Scope-Verstoß, aber offener Folge-Punkt.
4. **Voll-Last-Flake:** im ersten Suite-Lauf reproduziert (`test/finishcall-billing-once.test.js` + `test/g1-identity-binding.test.js`, 401 statt 200 bzw. fehlender `billedAt`). Beide isoliert grün (5/5) und im zweiten vollen Lauf grün (2935/2935); bekannter Seed-vor-Boot-Spawn-Race, ohne Bezug zu `cost-truing`.
5. **eslint nicht lauffähig** in dieser Umgebung (`@eslint/js` fehlt im node_modules des geteilten Checkouts) — Lint konnte nicht unabhängig verifiziert werden. `node --check` ist grün.

---

## 4. Clean-Code-Audit

**Verdikt: PASS — keine Blocker.**

- **s1:** keine Funde.
- **s2:** keine Funde.
- **s3:** keine Funde.
- **s4:** keine Funde.

**Begründung:** Diff (`src/billing/cost-truing.js` + `test/cost-truing-retrievable.test.js`) ist ein sauberer, gut begründeter Refactor: Belegfähigkeit (`control`) wird jetzt VOR dem Abruf einmal je Provider aufgelöst (`costRecordControlFor`/`costRecordControlsFor`), eine einzige „abrufbar"-Bedingung (`isRetrievable`) filtert die Kandidaten, `since` wird korrekt nur noch über den abrufbaren Kandidaten gebildet statt über alle Kandidaten. Behebt einen echten Bug: ein Call ohne Beleg-Fähigkeit/Leg-Referenz blieb dauerhaft Kandidat und hätte vorher `since` für immer auf seinen alten `endedAt` fixiert — das ließ den Pool mit der Zeit unbegrenzt wachsen bis zur Seitenobergrenze (`complete:false` → alle Kandidaten `unavailable`, keine Rückerstattung mehr). Test P9-2 pinnt genau dieses Vorher-kaputt/Nachher-repariert-Szenario.

`trueOneCall` verliert den alten Skip-Zweig, weil die Schleife strukturell nur noch abrufbare Calls sieht — begründete Beseitigung eines danach unerreichbaren Zweigs, keine neue tote Lücke. Kein toter Code, keine neue Duplizierung (Fähigkeitsprüfung jetzt an genau einer Stelle), keine Magic Numbers, Nesting/Funktionslänge/Argumentzahl klar unter den Richtwerten.

**Verifiziert:** `node --check` grün, die 3 neuen Tests UND die komplette Suite (2935/2935, inkl. aller `cost-truing-*`/`api-cost-truing-sweep`/`telnyx-cost-records`-Tests) laufen grün gegen den tatsächlichen Branch-Code (per Overlay in isoliertem Worktree lokal ausgeführt, danach restauriert). Kommentare ausführlich aber sachlich richtig, keine veralteten/widersprüchlichen Reste (`NO_POOL_FETCH`/`NO_COST_RECORDS` restlos entfernt inkl. aller Referenzen), keine Umlaute-Verstöße.

**passNotes (Money-Pfad, S1-Domäne):** keine Float-Beträge neu eingeführt, keine Race-Bedingung verändert (Sweep bleibt synchron zwischen Pool-Abruf und Buchungsschleife), Idempotenz/Laufriegel unangetastet. `skippedCalls = candidates.length - retrievable.length` rechnerisch identisch zur alten inkrementellen Zählung (0-Beitrag der alten `NO_POOL_FETCH`-Stats per Handrechnung bestätigt). Rückwärts-Kompatibilität des Rückgabe-Shapes von `runCostTruingSweep` durch unveränderten Bestandstest (`cost-truing-observe.test.js`, Key-Set-Assertion) abgesichert, lief grün. Testdesign folgt Build-Operate-Check, ein Konzept je Test, netzfrei/deterministisch (feste Uhr, gestubbtes fetch), F.I.R.S.T. eingehalten. Die drei neuen Tests decken sinnvoll die Randfälle ab: alle unabrufbar, gemischt (der eigentliche Bug-Beweis), leere abrufbare Menge bei nicht-leerer Kandidatenmenge.

**topTodos:**
1. Kein Blocker, keine Pflicht-Nacharbeit aus dem Clean-Code-Katalog.
2. Optional/Prozess (kein Code-Flag): falls Team-Konvention es verlangt, KE-P9 analog zu KE-P1..P8 in `STATUS.md`/PLAN-Dokument nachtragen — der Diff selbst enthält keine Doku-Änderung.

---

## 5. Fix-Runden

**Keine.** Der Impl-Report weist `deviations: []` aus, Safety kam auf FREIGABE (`approved: true`, keine Blocker) und Clean-Code auf PASS (`blocker: false`) im ersten Durchlauf — es waren keine Nachbesserungs-Runden nötig.

---

## 6. Offene Punkte

- **Deviations laut Impl:** keine.
- **Offen aus den Safety-Concerns** (keiner blockierend, siehe Abschnitt 3):
  1. Kein Kill-Switch/Flag für die Änderung (Spec verbietet eine neue Env-Variable ausdrücklich) — Rollback nur per Redeploy.
  2. Latente Invariante-per-Konvention in `fetchCostRecordPoolFor` (`control` wird nicht mehr explizit geprüft, heute strukturell unerreichbar).
  3. Nicht abrufbare Calls bleiben dauerhaft Kandidaten und drücken den Nenner der Deckungsquote monoton — ausdrücklich Owner-Entscheidung/out-of-scope laut Spec Kap. 2.
  4. eslint war in der Review-Umgebung nicht lauffähig (`@eslint/js` fehlt) — nur `node --check` unabhängig verifiziert.
- **Aus dem Plan bewusst zurückgestellt:** keine zusätzlichen — der Plan sah für KE-P9 keine zurückgestellten Punkte vor (Blast-Radius war von vornherein auf die eine Quelldatei + eine Testdatei begrenzt).
