# Phase KS-P1b — Assistant-Shim bekommt denselben Re-Attach-Pfad

**Gate: PASS**
**finalBranch:** `phase/ks-p1b-shim-reattach-fix1`

## Auftrag

Zwei Deliverables:

1. Der Telnyx-Assistant-Shim (`src/telnyx-llm-shim.js`) löst den Call bisher NUR über den Prozess-Spiegel (`store.getCallByControlId`) auf und antwortet bei einem Miss mit 403 — ohne `reattachActiveCall`. Der Call läuft beim Provider ohne Cap-Timer und ohne Dead-Air-Watchdog weiter. Der Shim soll auf denselben Re-Attach-Seam wie `/voice/turn|outbound|status` und den Call-Control-Ingest gehoben werden.
2. Die Notbremse wird beim Re-Attach **neu berechnet, nicht wiederhergestellt** (Folge von E8): ein Leg, dessen Guthaben zwischenzeitlich aufgebraucht wurde, wird terminalisiert statt mit frischer Frist reanimiert.

**Ausdrücklich nicht Teil dieser Phase:** die guthaben-abgeleitete Frist selbst (`Notbremse = min(Restminuten + 1 min, absolute Obergrenze)`) ist KS-P3 und darauf blockiert, nicht umgekehrt. `classifyCallTime` (`src/store/state-ops.js`) rechnet die Restzeit bei jedem Re-Attach bereits heute frisch aus dem DB-Anker — es gibt keine gespeicherte Deadline, die restauriert würde. Ändert KS-P3 die Ableitung, ändert es genau diese eine Funktion, und der Re-Attach zieht ohne weiteren Eingriff mit.

Ebenfalls nicht: kein neuer Env-Schalter, keine `.env.example`/`render.yaml`-Änderung, keine neue Dependency, keine Änderung an `MAX_CALL_DURATION_S` oder den 300er-Klemmen (KS-P3), kein Anfassen von `disclosureSentence`, `outbound-gates.js`, `metering.js`.

---

## Plan (gekürzt)

### Kern-Entwurfsentscheidungen

- **E-1 (neue Store-Query statt zweiter Re-Attach-Kern):** `reattachActiveCall`/`store.attachActiveCall` suchen über die `callId`; der Shim kennt nur die `call_control_id` aus `extra_metadata` (E1, Anti-Spoofing). Neue Store-Methode `attachActiveCallByControlId(callControlId)` in **beiden** Backends (`test/store-backend-parity.test.js` macht eine einseitige Ergänzung automatisch rot).
- **E-2 (ccid-Variante delegiert, dupliziert nicht):** `reattachActiveCallByControlId(ccid)` lädt die Zeile über die ccid und ruft dann den **unveränderten** `reattachActiveCall(call.id)`. Grund: Der Kern hält einen In-Flight-Promise-Cache pro `callId` (RACE-1); zwei verschiedene Schlüssel für denselben Call würden das Coalescing aushebeln → zwei parallel armierte Timer, ein Leak. Preis: auf dem seltenen Miss-Pfad zwei DB-Scans statt einem, bewusst akzeptiert. Nebeneffekt: der zweite Durchlauf liefert über den pg-RACE-GUARD die Spiegel-Instanz zurück.
- **E-3 (Guthaben-Prüfung im geteilten Kern, nicht im Shim):** kein neues Prädikat — es wird ausschließlich `blockingBudgetAxis` (`src/budget-gate.js`) angewandt, dieselbe Geld-Achse, die Shim-Turn, Dial-Gate und Inbound-Reject bereits lesen. G5 (eine Stelle für alle fünf Aufrufer), Absolute Regel 1 (verschärft, weicht nichts auf). Benannter Blast-Radius: ein Leg mit erschöpfter Tenant-Decke, das nach einem Instanzwechsel über `/voice/turn` re-attached wird, bekommt künftig einen harten Hangup statt des höflichen `budgetExhaustedHangup` — nur in der Schnittmenge Spiegel-Miss × Decke erschöpft, immer in die sichere Richtung. Reihenfolge im Kern: Zeit zuerst (genauerer Cap-Grund), dann Geld.
- **E-4 (eigener Terminalisierungs-Grund, EIN Terminalisierungspfad):** `CAP_FAILURE_REASON` für eine Geld-Terminalisierung zu recyceln wäre eine Lüge im Record (C2/G2) und würde die GAP-26-Forensik-Lücke wieder aufreißen. Interner `terminateActiveCall({...})` mit einem Objekt-Argument (F1), darüber zwei intentions-benannte Wrapper: `terminateCappedCall` (Signatur/Call-Sites unverändert) und `terminateOverBudgetCall`. `status: "completed"` für den Budget-Fall (Leg war technisch gesund). INV-9 bleibt: Provider-Leg zuerst (awaited), dann buchen.
- **E-5 (`blockingBudgetAxis` injiziert, nicht importiert):** folgt derselben Konvention wie `cappedEndedAtMs`/`classifyCallTime` (G11), kein Zyklus-Risiko, offline fakebar.

### Neue Dateien

Nur eine, und die ist ein Test (`test/ks-p1b-shim-reattach.test.js`). Kein neues Produktivmodul — jeder Baustein hat bereits seinen Ort.

### Betroffene Bestandsdateien (Plan)

`src/store/json.js` (neue `attachActiveCallByControlId` = `getCallByControlId`), `src/store/pg.js` (zwei parametrisierte SQL-Konstanten + generalisierter `attachActiveCallRow`-Scan, EIN Scan für beide Suchachsen), `src/store.js` (Re-Export), `src/telephony/reattach.js` (Kopfkommentar-Vertrag nachgezogen, Budget-Zweig in `runReattach`, neue `budgetAxisFor`/`terminateOverBudgetCall`-Deps), `src/telephony/call-lifecycle.js` (`BUDGET_FAILURE_REASON`, `terminateActiveCall`-Kern, `terminateCappedCall`/`terminateOverBudgetCall`-Wrapper, `reattachActiveCallByControlId`), `src/server.js` (`blockingBudgetAxis` als Dep verdrahtet), `src/app.js` (Shim-Mount bekommt `reattachActiveCallByControlId: lifecycle.reattachActiveCallByControlId`, Zeile muss einzeilig bleiben wegen `telnyx-assistant-route-drift.test.js`), `src/telnyx-llm-shim.js` (`logShimReattach`, Dep ohne Default, `resolveOrReattachActiveCall`, Schritt 4 des Handlers verkürzt), `PLAN-SECURITY.md`, `tasks/ks-p1b-report.md`.

### Tests (Plan)

Neu `test/ks-p1b-shim-reattach.test.js` (KS-P1b-1…6, Unit gegen `makeTelnyxLlmShim` mit Fakes, kein Spawn/Netz). Geändert `test/reattach-active-call.test.js` (KS-P1b-7 Geld-Achse sperrt, KS-P1b-8 Reihenfolge Zeit-vor-Geld), `test/store-pg-reattach-active-call.test.js` (KS-P1b-9/10, pglite, fail-closed auf unbekannte/leere/null-ccid), `test/telnyx-shim-harness.js` + `test/telnyx-llm-shim.test.js` (Default-Dep, damit Bestandstests byte-identisch grün bleiben). Unverändert als Gate mitgeführt: `test/store-backend-parity.test.js`, `test/cap-failure-reason.test.js`, `test/telnyx-assistant-route-drift.test.js`, `test/voice-unknown-call-log.test.js`, `test/voice-status-lifecycle.test.js`, `test/telnyx-event-ingest-machine.test.js`.

Mutationsproben-Matrix im Plan: (1) Schritt 4 im Shim auf Bestand zurücksetzen → KS-P1b-1/2 rot; (2) Budget-Zweig aus `runReattach` entfernen → KS-P1b-7 rot; (3) `attachActiveCallByControlId` nur in `pg.js`, nicht `json.js` → `store-backend-parity` rot; (4) ccid-Guard in `pg.js` entfernen → KS-P1b-10 rot (siehe Deviation: widerlegt).

---

## Implementierungs-Zusammenfassung

KS-P1b vollständig umgesetzt: der Telnyx-Assistant-Shim liegt jetzt auf demselben Re-Attach-Seam wie `/voice/turn|outbound|status` und der Call-Control-Ingest; der Re-Attach berechnet die Notbremse neu statt sie wiederherzustellen.

Kern der Änderung:

1. Neue Store-Query `attachActiveCallByControlId` in **beiden** Backends — in `pg.js` über einen generalisierten, parametrisierten Scan (`attachActiveCallRow`), der die id- und die ccid-Achse mit EINER Implementierung bedient; RLS-Tenant-Loop und RACE-GUARD unverändert.
2. `lifecycle.reattachActiveCallByControlId` lädt die Zeile über die ccid und delegiert dann an den unveränderten `reattachActiveCall(call.id)` — bewusst zweistufig wegen RACE-1-Coalescing.
3. Der Kern prüft nach der Zeit-Achse zusätzlich die Geld-Achse über `blockingBudgetAxis` — dasselbe Prädikat wie Shim-Turn und Dial-Gate, kein neues Gate; ein Leg mit erschöpfter Tenant-Decke wird terminalisiert statt reanimiert.
4. Eigener Forensik-Token `BUDGET_FAILURE_REASON` neben `CAP_FAILURE_REASON`, vollzogen über EINEN grund-parametrisierten Terminalisierungspfad (`terminateActiveCall`) mit zwei intentions-benannten Wrappern — INV-9, Reihenfolge und Idempotenz unberührt, `terminateCappedCall`-Signatur und alle drei Call-Sites unverändert.

**Ergebnis:** `node --check` auf allen acht geänderten Quelldateien grün; volle Regressionssuite 3578 pass / 0 fail; drei der vier Mutationsproben erwartungsgemäß rot (die vierte widerlegt, s. Deviations); Smoke gegen die echte Route bestanden. `git diff --stat` trifft die Plan-Dateiliste plus zwei begründete Bestands-Testanpassungen — kein `.env.example`, kein `render.yaml`, kein `config.js`, kein `outbound-gates.js`.

**headCommit (Erstversuch, vor Fix-Runde 1):** `7fb572a5f64f0923372eb3dbe832ffb661833284`

### Deviations

1. Zwei Bestandstests mussten über die Plan-Dateiliste hinaus angepasst werden — unvermeidliche Folge der geplanten `terminateCappedCall`-Refaktorierung: (a) `test/call-termination-order.test.js` — Quelltext-Anker `async function terminateCappedCall(` zeigt jetzt auf `async function terminateActiveCall(` (Prüfgegenstand unverändert); (b) `test/telnyx-p6-cap-callcontrol.test.js` — derselbe Anker in T6, plus `budgetAxisFor:()=>null` und `terminateOverBudgetCall` in `makeReattachDeps`. Ohne diese Anpassungen wäre `npm test` rot gewesen.
2. Mutationsprobe 4 des Plans ist **widerlegt**, nicht bestanden: das Entfernen des ccid-Riegels (`ccid ? ... : null`) in `pg.js` lässt KS-P1b-10 grün — `WHERE call_control_id = NULL` trifft in SQL wegen NULL-Semantik ohnehin nie eine Zeile. Der Riegel bleibt (er spart den Tenant-Loop-Scan), aber der Kommentar behauptet nicht mehr, er sei ein Sicherheitsnetz — dokumentiert in PLAN-SECURITY.md und hier.
3. Der Test-Default für `reattachActiveCallByControlId` wurde nur in den zwei geplanten `makeHandler`-Buildern ergänzt. `test/telnyx-k0-turn-seq.test.js` und `test/telnyx-stab-p9-watchdog.test.js` konstruieren `makeTelnyxLlmShim` direkt ohne den Dep — bleiben grün, weil alle Fälle den Spiegel treffen. Bewusst nicht angefasst (Scope); ein künftiger Spiegel-Miss dort würde mit TypeError brechen (beabsichtigter fail-loud-Effekt, G27).
4. `npm test` brach im Sandbox-Wrapper reproduzierbar mit Exit 194 und leerer Ausgabe ab; die direkte Invocation `NODE_ENV=test node test/i18n-catalog-run.mjs regression` (exakt was `package.json` ausführt) lief vollständig durch: Exit 0, 3578 pass / 0 fail. Kein inhaltlicher Zusammenhang mit dieser Phase.
5. `npm run test:gates` wurde nicht gefahren (laut Ketten-Spec darf er rot bleiben, von dieser Phase unberührt).

---

## Safety-Urteil (final)

**Verdict: FREIGEGEBEN (approved: true)**

Alle Sub-Kriterien erfüllt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`. Keine Blocker.

Zusammenfassung der Prüfung:

- **Regel 1 (Safety-Gates):** kein Gate entfernt/aufgeweicht. `blockingBudgetAxis` ist wortgleich dasselbe Prädikat wie Shim-Turn/Dial-Gate — kein zweites Gate. `src/budget-gate.js`, `outbound-gates.js`, `config.js`, `metering.js` byte-identisch zu master. INV-9 hält (zwei Wrapper über einen Kern). Reihenfolge Zeit-vor-Geld über KS-P1b-8 gepinnt.
- **Regel 2 (Offenlegung):** `src/claude.js`/`src/bridge.js` byte-identisch, `disclosureSentence` unberührt.
- **Regel 3 (Auth fail-closed):** kein neuer Endpunkt; Re-Attach sitzt NACH Existenz-Gate und Bearer-Prüfung. Dep ohne Default (G27), Verdrahtung über KS-P1b-6 am Quelltext gepinnt.
- **Regel 4 (Secrets):** Logs führen nur die server-generierte callId, nie die call_control_id. Diff-Scan sauber (E.164, sk_live/test, SIDs, Bearer, password/api_key — 0 Treffer).
- **Regel 6 (Scope):** keine neue Dependency, kein neuer Env-Schlüssel, keine `.env.example`/`render.yaml`-Änderung.

Eigene unabhängige Tests (Branch `phase/ks-p1b-shim-reattach-fix1` @ 4b99add, master 19f6441 ist Vorfahre): `npm test` 3599 roh/3579 korrigiert pass, 0 fail, 97,2s; `npm run test:gates` 126 pass/3 fail (GAP-05 + 2× GAP-15, vorbestehende Produktbefunde, unberührt). Eigene Mutationsproben bestätigen Tragfähigkeit (Geld-Zweig deaktiviert → 2 rot; Shim-Reset auf Bestand → 3 rot). Eigene Ende-zu-Ende-Verdrahtungsprobe mit echtem Shim + echtem Lifecycle + echter `blockingBudgetAxis` bestätigt beide Pfade (freie Decke: 1 agentTurn; erschöpfte Decke: 403, 0 agentTurn-Aufrufe, `failureReason='budget-exhausted'`, `status='completed'`). Byte-Identität gegen master für alle sicherheitskritischen Dateien geprüft (leer). Keine verwaisten Server-Prozesse.

### Concerns (nicht-blockierend)

1. **`/voice/status`-Kante im Bericht nicht ursprünglich benannt:** der Geld-Zweig sitzt im geteilten Kern, wirkt also auch auf `routes/voice.js:455`. Ein verspäteter Provider-Status-Callback nach Instanzwechsel kann bei erschöpfter Decke den Record mit `status='completed'`/`failureReason='budget-exhausted'` terminalisieren statt den echten Provider-Status zu persistieren — Geld unberührt (billedAt-idempotent), reine Forensik-Degradation in engem Fenster.
2. **Neue Wurf-Fläche im Re-Attach-Kern:** `store.attachActiveCall`/`attachActiveCallByControlId` sind in `pg.js` fail-safe (try/catch → null), `blockingBudgetAxis` ist es nicht. Ein Wurf dort rejected die reattach-Promise; die drei `/voice/*`-Aufrufer haben kein umgebendes try/catch → 500 statt fail-closed Hangup. In Prod sind beide Store-Funktionen reine In-Memory-Leseprojektionen, Risiko klein.
3. **Fail-open bei fehlendem `call.tenantId`:** der Geld-Zweig fällt bei unbekanntem Tenant fail-open (spent=0 gegen Default-Decke), nicht fail-closed. Verifiziert, dass `rowToCall` (I8) `tenant_id` heute immer hydriert — kein struktureller Riegel gegen einen künftigen null-tenantId, anders als bei der Zeit-Achse.
4. **`resolveOrReattachActiveCall` läuft vor dem per-Call-Rate-Gate:** eine unauflösbare ccid löst pro Request einen vollen Tenant-Loop-Scan aus, den `shimRateHit` nicht bremst (keine callId). Nur mit statischem Bearer-Secret erreichbar und zusätzlich durch den globalen Rate-Limiter gedeckt — kein Gate-Defekt, neue DB-Kosten.
5. ESLint im Worktree nicht lauffähig (`ERR_MODULE_NOT_FOUND '@eslint/js'`) — Lint konnte nicht unabhängig bestätigt werden; `node --check` sauber, `npm test` grün.
6. Präzisierung "flag-off byte-identisch": gilt für den Shim-Teil und den Spiegel-Treffer-Pfad. Die Geld-Achse im Re-Attach-Kern ist bewusst unkonditional und wirkt auf allen vier Bestands-Aufrufern (E8-Vorgabe) — kein flag-geschütztes Inkrement.

---

## Clean-Code-Audit (final)

**Verdict: PASS** (blocker: false)

- **S1 (Blocker):** keine.
- **S2:** keine.
- **S3:** keine.
- **S4 (vermerkt, kein Fix nötig):** `src/telnyx-llm-shim.js` (`resolveOrReattachActiveCall`) deckt drei Ausgänge ab (Spiegel-Treffer / Reattach-Erfolg / zwei Miss-Fälle) und loggt in jedem Zweig separat — grenzwertig G30, aber die drei Fälle sind eng zusammengehörig (EIN Vertrag mit 3 Antworten); weitere Zerlegung würde die Kohärenz eher verschlechtern.

**Begründung:** Sauberer, gut begründeter Fix-Commit (Review-Blocker-Runde-1-Fix), der die im Erstversuch offene Lücke schließt (Shim verwarf re-attachbaren Call mit 403 statt ihn zu retten) plus die Geld-Achsen-Prüfung beim Re-Attach (E8). Alle vier absoluten Regeln unberührt. `store.js`/`json.js`/`pg.js`-Parität sauber ergänzt (Parity-Test fängt Drift automatisch). G5-Deduplizierung vorbildlich: `attachActiveCallRow` als EIN Scan für beide Suchachsen, `terminateActiveCall` als EIN Terminalisierungspfad für Zeit- und Geld-Achse mit F1-konformem Objekt-Argument. Vollständige, gezielte Tests inkl. echter Verdrahtung (`budget-failure-reason.test.js` fährt die echte `blockingBudgetAxis` statt nur Spies), Backend-Parität, Shim-Verhalten und Verdrahtungs-Regression. Eigener Vollauf: 3579 Tests, 0 rot im sauberen Lauf (ein erster Lauf zeigte 2 rote Tests, Wiederholungslauf komplett grün — bekanntes Flake-Muster p5-gate-proof-Spawn-Race, kein echter Befund).

`PLAN-SECURITY.md` korrekt und vollständig aktualisiert. `pg.js`: parametrisierte Queries, keine SQL-Injection-Fläche, RLS-Tenant-Loop unverändert übernommen. `reattach.js`: In-Flight-Coalescing (RACE-1) bleibt intakt, da die zweite Stufe weiterhin über `callId` coalesced. Reihenfolge Zeit-vor-Geld nachvollziehbar begründet und getestet (KS-P1b-8). Terminologie/Grund-Token (`BUDGET_FAILURE_REASON`, `reattach_terminalized`) sauber von bestehenden CAP-Token abgegrenzt (G2/G11).

**topTodos:** keine.

---

## Fix-Runden

**Runde 1 (fix1, Ergebnis: `phase/ks-p1b-shim-reattach-fix1`):** S1-Blocker aus der ersten Review-Runde behoben — neuer Regressionstest `test/budget-failure-reason.test.js` exerziert die **echte** Geld-Achse-Verdrahtung im Re-Attach-Pfad (`makeCallLifecycle()` mit echtem `blockingBudgetAxis` aus `budget-gate.js` und echtem `reattachActiveCallCore` aus `reattach.js`, statt der bisherigen Spies für budgetAxisFor/terminateOverBudgetCall). Nach dieser Fix-Runde: Safety-Review FREIGEGEBEN, Clean-Code-Audit PASS ohne S1/S2.

---

## Ergebnis / Status

- **Gate:** PASS
- **finalBranch:** `phase/ks-p1b-shim-reattach-fix1`
- **Tests:** 3578–3579 pass, 0 fail (Regressionssuite); `test:gates` unberührt (3 vorbestehende rote Befunde, GAP-05/GAP-15)
- **committed:** true

### Feststellung für KS-P3 (damit dort nicht gesucht wird)

Die Frist-Ableitung selbst ist **nicht** Teil dieser Phase. `classifyCallTime` rechnet die Restzeit bei jedem Re-Attach frisch aus dem DB-Anker; es gibt keine gespeicherte Deadline, die restauriert würde. KS-P3 ändert genau diese eine Funktion, der Re-Attach zieht ohne weiteren Eingriff mit.
