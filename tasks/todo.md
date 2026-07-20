# TODO — Fragilitaets-Remediation

Strategie: `PLAN-FRAGILITY-REMEDIATION.md`. Roh-Designs: `tasks/fragility-cluster-designs.json`.
Ausfuehrung: eine `phase-impl-lean`-Session pro Phase, in FRISCHEM Kontext (siehe PLAN Abschnitt 6).
Jede Phase ist "done" erst, wenn ihre Verifikation IN DIESER Session lief und das beobachtete
Ergebnis unten protokolliert ist.

Legende: [ ] offen · [~] in Arbeit · [x] fertig+verifiziert

---

## P1 — C1 Stripe-Webhook-Race (S1-1, preserves, M) — [x] FERTIG+MERGED (master 699e310)
- [x] `makeKeyedChainMutex()` in `src/chain-mutex.js` (additiv, self-cleaning Map)
- [x] `applyStripeWebhookSerialized()` in `src/billing/webhook.js` (Keyed-Mutex + Event-ID-Dedup + `created`-Monotonie)
- [x] `src/server.js` Stripe-Route ruft die serialisierte Variante
- [x] **Clean-Code-Gate fand echten S1:** Ordnungswache verwarf bei GLEICHEM `event.created` (Sekunde) das zweite Event pauschal -> SUSPEND konnte gegen zeitgleiches ACTIVATE verloren gehen (Outbound-Gate faelschlich offen). Fix: `eventAnchorOf()` + fail-closed Tie-Break (SUSPEND schlaegt zeitgleiches ACTIVATE, deterministisch reihenfolge-unabhaengig) + symmetrischer `Number.isFinite`-Guard auf `lastApplied.createdAt` (NaN-Anker-Vergiftung). 3 Gleichstand- + 1 NaN-Regressionstest.
- **Erwartetes Ergebnis:** zwei konkurrierende Events (`payment_failed` vs. `active`) enden IMMER im korrekten Zustand; nie `active`+`kycLevel=CARD` nach Zahlungsfehler — auch bei identischem `event.created`; identisches Event zweimal = No-op; verschiedene Tenants serialisieren nicht gegeneinander. ERREICHT.
- **Verifikation:** `npm test` -> **2209 pass / 0 fail** (merged master, beide Backends). Duales Review: Opus-Safety APPROVED (Gates/Disclosure/Invariante intakt), Opus-Clean-Code final PASS (0 S1/S2). Bericht: `tasks/p1-report.md`.
- **Ergebnis:** MERGED `phase/p1-fix-nan` (e52800e) -> master `699e310` via `--no-ff`. Alle P1-Worktrees/Branches aufgeraeumt.

## P2 — C2 Geld/Typ + pg/json-Paritaet (S1-2/3, preserves, L) — [x] FERTIG+MERGED (master 5e49509)
- [x] `maxBudgetEur` (Float) -> `maxBudgetCents` (Cents-Integer, `eurToCents()`); Env `MAX_BUDGET_EUR` + externer API/MCP-Kontrakt (`s.usage.maxBudgetEur`) bleiben EUR; alle 6 Callsites (state-ops.js, api-read.js, server.js) nachgezogen
- [x] `objectiveAchieved` in `pg.js` symmetrisch de-serialisiert (Boolean-Rundlauf)
- [x] neuer `test/store-pg-json-parity.test.js` (pglite Re-Open + json Temp-DATA_DIR, `deepStrictEqual`) — nagelt die Meta-Lehre (json-Dev-Unsichtbarkeit) strukturell fest
- [x] Fix-Runde 1: EUR->Cents-Rundung in reine exportierte `eurToCents()` extrahiert + Unit (S1-COV-1)
- **Erwartetes Ergebnis:** Budget-Gate in Cents; `objectiveAchieved` Boolean ueber pg-Rundlauf; pg/json `deepStrictEqual`; externer Kontrakt EUR. ERREICHT.
- **Verifikation:** `npm test` -> **2222 pass / 0 fail** (merged master). Gate PASS (Opus-Safety approved, Clean-Code 0 Restblocker). Bericht: `tasks/p2-report.md`.
- **Ergebnis:** MERGED `phase/p2-money-cents-pgjson-parity-fix1` (c4a49fb) -> master `5e49509`. Worktrees/Branches aufgeraeumt. Kein Classifier-Trip.
- **Zurueckgestellt:** `usage.costEur` -> Cents (S1-4) = eigener spaeterer Cluster.

## P3 — C5 finishCall-Settlement erzwingen (Struct-4, preserves, M) — [x] FERTIG+MERGED (master dceb5a1)
- [x] Fail-Fast-Guard in `terminateAndBillCall` (`throw` TypeError wenn `bill` kein Function, VOR jedem Seiteneffekt)
- [x] Alle 5 Terminierungspfade ueber den Gateway (terminateCappedCall, /voice/status, place_call-catch, cancel_call, Telnyx onHangup); `billThunk` = EINE Quelle (G5)
- [x] **Echter Bug gefixt:** place_call-Dial-Fehlschlag lief nie durch Settlement/Notification/Reserve-Freigabe; manuelles doppeltes `releaseReserve` entfernt (finishCall idempotent)
- [x] **3 Blocker gefunden+gefixt:** S1-1 (fehlender Regressionstest), G5 (bill-Thunk-Dup), P8 (Obs-Regression: fire-and-forget bill() verlor callId-Korrelation -> `.catch` mit secret-freiem Kontext-Log an allen 5 Pfaden)
- **Erwartetes Ergebnis:** `terminateAndBillCall` wirft ohne `bill`; doppelte Terminierung idempotent; Dial-Fehlschlag laeuft erstmals durch die volle Settlement-Kette. ERREICHT.
- **Verifikation:** `npm test` -> **2231 pass / 0 fail** (merged master). Gate PASS (Opus-Final-Review: alle 5 Pfade, Fail-Fast, Obs-Fix secret-frei+Timing OK, 0 S1/S2). Bericht: `tasks/p3-report.md`.
- **Ergebnis:** MERGED `phase/p3-fix-obs` (8f687da) -> master `dceb5a1`. 2 Workflow-Fix-Runden + 1 manuelle (P8-Obs) via Opus-Fallback. Alle Worktrees/Branches aufgeraeumt.
- **Restrisiko notiert:** `bridge.js` = 6. Pfad, bewusst nicht hier (P7/Restrisiko).

## P4 — C4 Webhook-Parsing-Port (Struct-2, none, S) — [x] FERTIG+MERGED (master cb92e2b) — Warm-up
- [x] Port `WebhookEvents` in `ports.js`; Adapter `twilio/webhook-events.js` + `telnyx/webhook-events.js` (Code 1:1 verhaltens-erhaltend)
- [x] Registry-Zeile `webhookEvents(provider)`; 3 Call-Sites in `server.js` umgestellt; kein `if(provider===)`-Parse-Zweig mehr
- **Erwartetes Ergebnis:** identisches Parse-Verhalten je Provider (Telnyx-Sonderfelder + `SAFE_CAUSE_TOKEN`-Regex + Transcript-Vorrang gepinnt); dritter Provider braucht nur Adapter + Registry-Zeile. ERREICHT.
- **Verifikation:** `npm test` -> **2241 pass / 0 fail** (merged master; neu `test/webhook-events.test.js`). Gate PASS in EINEM Durchgang (0 Fix-Runden, 0 Blocker, ~473k Tokens). Bericht: `tasks/p4-report.md`.
- **Ergebnis:** MERGED `phase/p4-webhook-events-port` (f816782) -> master `cb92e2b`. Guenstigste Phase (risikoarme 1:1-Verschiebung, `none`-Gate).

## P5 — C6a Config-Proxy-Guard + Grouping (Struct-3, preserves, M) — [x] FERTIG+MERGED (master 3513b51)
- [x] Proxy-Guard `guardedConfig()` (rekursiv, wirft TypeError bei Zugriff auf unbekannten Key flach+verschachtelt; Arrays/Symbole durch; kein set-Trap) — mit `test/config-shape.test.js`
- [x] Gruppe `telnyxAssistant` (10 Keys) nach `config.telnyxAssistant.*` verschachtelt; Safety-Gate-Keys bleiben flach
- [x] **Guard fing sofort echten Bug:** toter `config.ownerNumber`-Zugriff in `scripts/check-setup.js` (seit P2b tot) -> `npm run check`-Crash statt lautlos undefined (Safety-Blocker, Fix-Runde 1)
- **Erwartetes Ergebnis:** Zugriff auf nicht-existenten Key wirft TypeError; legitimer Zugriff liefert Default. ERREICHT (der Kern-Mechanismus + telnyxAssistant als Demonstration).
- **Verifikation:** `npm test` -> **2253 pass / 0 fail** (merged master, 2x bestaetigt; 1 vorbestehender 401/500-Voll-Last-Flake, isoliert gruen). Gate PASS (1 Fix-Runde). Bericht: `tasks/p5-report.md`.
- **Ergebnis:** MERGED `phase/p5-config-proxy-guard-fix1` (edd0248) -> master `3513b51`.
- **BEWUSST ZURUECKGESTELLT (plan-konform inkrementell):** Gruppen `billing` / `webLogin` / `mcp` — der Guard schuetzt sie kuenftig; Grouping ist ein billiger Folge-Slice, wenn gewuenscht. Safety-Gate-Keys bleiben absichtlich flach (Plan).
- **Skizze (nicht jetzt):** C6b state-ops-Split (Barrel-Reexport, S4, getriggert).

## P6 — C3 Outbound-Gate-Kette extrahieren (Struct-1, RISKY, L) — [x] FERTIG+MERGED (master fd333f1)
- [x] `src/telephony/outbound-gates.js` `makeOutboundGates({...})` -> geordnetes `{name,run(ctx)}`-Array (16 Gates, EXAKTE Reihenfolge)
- [x] private Helfer/Exporte gewandert; `reserve_budget` bleibt fail-closed letztes Gate
- [x] `POST /api/calls` durchlaeuft die Kette in EINER Schleife (ctx als Transport); Verhalten byte-identisch (Reihenfolge/Audit/Status/Fehlertext)
- **Erwartetes Ergebnis:** Gate-Reihenfolge byte-identisch; Gate hinzufuegen/umsortieren = Ein-Zeilen-Array-Diff; `reserve_budget` letztes Gate. ERREICHT.
- **Verifikation:** `npm test` -> **2270 pass / 0 fail** (merged master; neu `test/outbound-gates-order.test.js`: Order-Snapshot `deepStrictEqual` + 1 Ablehnungsfall je Gate; alle Outbound-Integrationstests gruen) · **Opus-Safety-Review PASS**. Gate PASS in EINEM Durchgang (0 Fix-Runden — Opus-Plan auf risky zahlte sich aus). Bericht: `tasks/p6-report.md`.
- **Ergebnis:** MERGED `phase/p6-outbound-gates-extract` (d4ab072) -> master `fd333f1`. Groesster Hebel, sauber.

## P7 — C7 bridge.js-Guard-Paritaet + Dedup + tote Seeds (S2, RISKY, M) — [x] FERTIG+MERGED (master ee296c3)
- [x] P1: `shouldSuppressEndCall()` + `END_CALL_WAIT_INSTRUCTION` aus `claude.js` exportiert (byte-identische Extraktion); `bridge.js` gatet `end_call` + `shapeForSpeech` aufs Transkript (additiv, HEIKLE Timer/Barge-in unberuehrt)
- [x] P2: `tenantOwnsCall` + `safeEqual` aus EINER Quelle (Dedup)
- [x] P3: tote Seeds `seedBootstrapPrivateNumber`/`seedBootstrapIdentity` entfernt (0 Produktions-Aufrufer; Dangling-Branches referenzieren nur schema.sql, werden nicht gemergt)
- **Erwartetes Ergebnis:** Realtime beendet Outbound-Call NICHT mehr vor der ersten Antwort (Paritaet zur Budget-Engine); Transkript ohne Markdown-Reste; keine Duplikate. ERREICHT (per Unit + strukturell verifiziert).
- **Verifikation:** `npm test` -> **2269 pass / 0 fail** (merged master). Gate PASS (1 Fix-Runde) + **dediziertes Opus-Barge-in-Review PASS**: Pre-Mortem-Kollision (response.create vs Barge-in) STRUKTURELL ausgeschlossen (state-getrennt, activeResponse=false vor Wait-Instruction, Barge-in-Cancel trifft nur Audio ohne function_call). Bericht: `tasks/p7-report.md`.
- **Ergebnis:** MERGED `phase/p7-bridge-guard-parity-fix1` (e7fc80a) -> master `ee296c3`.
- **OFFEN (Owner):** echter Realtime-Probe-Anruf als POST-Merge-Validierung (VOICE_ENGINE=realtime). Rest-Risiko gering + auf realtime-only begrenzt (nicht Live-Default=budget). Checkliste unten.

---

## Zurueckgestellt (bewusst, spaeter)
- [ ] S1-4 `usage.costEur` -> Cents (eigener Cluster)
- [ ] C6b `state-ops.js`-Split (S4, getriggert)
- [ ] `bridge.js` als vollwertiger 6. Terminierungspfad (aus C5-Pre-Mortem)

## Review-Sektion — ABGESCHLOSSEN (alle 7 Phasen gemerged)

**Ergebnis:** P1-P7 gemergt auf `master` (Kette 699e310 -> 5e49509 -> dceb5a1 -> cb92e2b -> 3513b51 -> fd333f1 -> **ee296c3**). Voll-Suite **2269 pass / 0 fail**. Kette-Start-Baseline war 2198 -> +71 neue Invarianten-/Verhaltens-Tests. Externer API-/MCP-Kontrakt unveraendert; keine Absolute Regel aufgeweicht.

**Was der adversariale Gate real gefangen hat (der Kernwert):**
- P1: verifizierter S1-Money-/Zugangs-Gate-Defekt (Tie-Break bei gleichem `event.created`) MIT gruenen Tests -> fail-closed gefixt; + NaN-Anker-Vergiftung (defensiv).
- P2: ungetestete EUR->Cents-Rundung (S1-COV-1).
- P3: 3 Befunde inkl. P8-Observability-Regression (fire-and-forget verlor callId-Korrelation auf Settlement-Pfad).
- P5: Proxy-Guard deckte toten `config.ownerNumber`-Zugriff auf (npm-check-Crash statt lautlos undefined).

**Strukturelle Invarianten jetzt erzwungen (statt Konvention):** Stripe-Webhook-Serialisierung+Dedup+Monotonie; Geld=Cents repo-weit + pg/json-Paritaetstest; `terminateAndBillCall` = einziger Settlement-Gateway (bill Pflicht); WebhookEvents-Port (One-Switch); Config-Proxy-Guard (fail-closed); Outbound-Gate-Order-Snapshot; bridge.js-Guard-Paritaet.

**Effizienz-Beobachtung:** Kosten skalieren mit Review-Befunden, nicht Zeilen. P4/P6 (0 Fix-Runden) ~0,5-0,85M Tokens; P3 (2 Runden) ~1,7M. Opus-Plan auf risky P6 -> 0 Fix-Runden (zahlte sich aus). Lehren -> `tasks/lessons.md`.

**OFFEN (Owner):** P7 echter Realtime-Probe-Anruf (Post-Merge-Validierung, Checkliste in der Abschluss-Nachricht). Bewusst zurueckgestellt: S1-4 `usage.costEur`->Cents; C6b state-ops-Split; P5-Gruppen billing/webLogin/mcp; bridge.js als vollwertiger 6. Terminierungspfad.

---

## PLAN-POLISH-A — Strategie-Session (2026-07-17, NUR Planung, kein Prod-Code)

**Auftrag:** Phasiertes Strategie-Dokument `PLAN-POLISH-A.md` (Repo-Root) fuer die finale
Qualitaets-Runde (Note B -> Note A). Umfang: 3 bestaetigte S1 + 9 S2-Cluster + config.js-Hub
inkrementell entschaerfen. Quelle: `tasks/clean-code-confirm-audit-2026-07-17.md`.

- **Erwartetes Ergebnis (deterministisch):** Datei `PLAN-POLISH-A.md` existiert im Repo-Root
  und enthaelt (pruefbar): Ziel/Umfang/Nicht-Ziele · Pre-Mortem · pro Phase
  {ID, Titel, Dateien, Invarianten, Teststrategie, Clean-Code-Fokus, Abhaengigkeiten,
  Abnahmekriterium} · explizites Ausfuehrungs-Modell · kopierbarer Kickoff-Prompt.
  Jeder der 15 Befunde ist gegen den AKTUELLEN Code re-verifiziert (Datei/Zeile/Schweregrad).
- **Verifikation:** `PLAN-POLISH-A.md` lesen, alle Pflicht-Sektionen + jede Phase auf
  Vollstaendigkeit pruefen; Anker-Korrekturen aus Phase A eingearbeitet. KEIN `npm test`
  noetig (kein Code geaendert). KEIN Deploy.
- **Vorgehen:** EIN Dynamic Workflow — A(13 Sonnet: Befunde adversariell re-verifizieren) ->
  B(1 Opus: dependency-geordnete Phasenliste) -> C(N Sonnet: Plan adversariell reviewen) ->
  D(1 Opus: strukturierte Synthese). Lead schreibt `PLAN-POLISH-A.md` aus D-Output +
  Ausfuehrungs-Modell + Kickoff-Prompt. Lead liest KEINEN Prod-Code (nur Anker-Stichproben).
- [x] FERTIG: `PLAN-POLISH-A.md` geschrieben (11 Sektionen, 20 Phasen PA-1..PA-20).
  Workflow `wf_92d5e3ce-764` (32 Agenten, 0 Fehler, ~1,88M Tokens): alle 15 Anker existieren noch,
  **3 adversariell herabgestuft** (S2-bridge-term=Wiring-Test statt Money-Fix; S2-webauth=S3-Politur;
  S2-smscap=fail-closed-Guard). config-Hub: 99 Keys / Fan-in 31 src (72 repo) -> 13 Namespaces,
  Shim-zuerst. Enthaelt Pre-Mortem (10), Ausfuehrungs-Modell, 6 offene Fragen (OQ-1..6), Kickoff-Prompt.
  **Verifikation:** `grep -cE '^#### PA-'` = 20; alle Pflicht-Sektionen present; 0 Umlaute. KEIN Prod-Code
  geaendert, kein Deploy. Naechster Schritt: Owner-Go + OQ-1..6 klaeren, dann Ausfuehrungs-Session.
