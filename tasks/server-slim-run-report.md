# Server-Slim-Run — Abschlussreport (2026-07-16)

**Ergebnis: ALLE Phasen P0a, P0b, P1-P15 umgesetzt und auf master gemergt. PX entfiel (Owner-Entscheid Q3). NICHT gepusht — Deploy entscheidet der Owner.**

## Zielbild erreicht

| Metrik | vorher | nachher |
|---|---|---|
| `src/server.js` | 2244 Zeilen | **185 Zeilen** (Ziel <300) |
| `grep -c "^export" src/server.js` | 0 | 0 (INV-10 gehalten) |
| `grep -c "app.post\|app.get\|app.use" src/server.js` | viele | **0** |
| Boot-Log-Zeile | server.js, 1x | **boot.js, repo-weit exakt 1x, byte-identisch** (INV-6) |
| Testsuite | 2269 pass | **2301 pass / 0 fail** (+32 neue Tests) |

Neue Module: `src/app.js` (409, buildApp + benannte Registrare), `src/boot.js` (159, bootServer + Gate-Kette), `src/billing/metering.js`, `src/tts/directive-synth.js`, `src/telephony/voice-render.js`, `src/telephony/call-finish.js`, `src/telephony/call-lifecycle.js`, `src/worker/provisioning-orchestrator.js`, `src/routes/{api-billing,api-tenant-write,api-calls,api-onboard,voice,mcp,stripe-webhook}.js`, `src/wiring/{web-login,auth-gate}.js`.

## Phasen-Uebersicht (jede: phase-impl-lean-Workflow, PASS, 0 Fix-Runden, Merge nach Gates)

| Phase | Merge-Commit | Inhalt | server.js |
|---|---|---|---|
| P0a | 70ed55b | Charakterisierungs-Test flush-meters | 2244 |
| P0b | 87bfdbf | Charakterisierungs-Test action-items-toggle | 2244 |
| P1 | 7b0103a | billing/metering.js | 2195 |
| P2 | 6eb2af3 | tts/directive-synth.js | 2154 |
| P3 | 1f05568 | telephony/voice-render.js | 2105 |
| P4 | c87d08c | telephony/call-finish.js (Geld-Pfad) | 2018 |
| P5 | 4afd919 | telephony/call-lifecycle.js (Max-Dauer-Cap) | 1924 |
| P6 | 1dc310b | worker/provisioning-orchestrator.js (TDZ-Call-Sites) | 1740 |
| P7 | 41b1dc0 | routes/api-billing.js | 1694 |
| P8 | 919ba01 | routes/api-tenant-write.js | 1671 |
| P9 | ab10983 | routes/api-calls.js (Outbound-Money-Path) + SMOKE | 1522 |
| P10 | f280d0a | routes/api-onboard.js | 1307 |
| P11 | 0870585 | routes/voice.js (TTS vor Sig-MW gepinnt) + SMOKE | 936 |
| P12 | 8d57e6a | routes/mcp.js (stateless, INV-8) + SMOKE | 868 |
| P13 | e120797 | wiring/web-login.js + routes/stripe-webhook.js (Q1-Marker) | 673 |
| P14 | 5476ae9 | wiring/auth-gate.js (Exemption-Einfrier-Test) | 641 |
| P15 | 919c72d | app.js + boot.js Kompositionswurzel + SMOKE | **185** |

## Gates (vor JEDEM Merge, im frischen Detached-Worktree)

- `node --check` neue Dateien + server.js; volle `npm test` gruen (nie ein echtes Rot in 17 Gate-Laeufen);
  `^export`-Grep = 0; Boot-Log-Zeile wortwoertlich genau 1 Treffer; `git diff --stat` Netto-Reduktion.
- P6/P13 zusaetzlich: INV-11-Pflichttests (pg+session Happy-Path) isoliert gruen (35/35 bzw. 60/60),
  kein `deaktiviert` im Happy-Pfad-Log.
- P9/P11/P12/P15: SMOKE-Rezept aus dem Plan-Anhang (healthz, /api/plans, GET /mcp=405,
  /voice/incoming byte-identisch zur master-Baseline, POST /api/calls {}=400 unter FAKE_ORIGINATE,
  Auth-Stichprobe: /api/state remote=401/lokal=200, Exempt-Pfade nicht-401, Root-Redirect 302,
  Bootlog exakt 1x).
- **P15: separater Opus-Safety-Review (Pflicht laut Plan) — VERDICT: APPROVED**, alle INV-1..INV-11
  am echten Code verifiziert, eigener voller Testlauf 2301/0, keine Blocker.

## Q1-Entscheid umgesetzt

`wireWebLogin` loggt im Erfolgsfall `[boot] Web-Login aktiv` (eigene Zeile, per Spawn-Test
asserted inkl. Abwesenheit von `deaktiviert`) — die fail-open-Unsichtbarkeit des guardedBoot-Blocks
(Pre-Mortem 1) ist dauerhaft geschlossen.

## Abweichungen (alle reviewt und begruendet)

- **Whitebox-Quelltext-Guards** (call-termination-order, reattach-active-call,
  telnyx-p6-cap-callcontrol, telnyx-p9-flag-matrix, telnyx-observability-secret-guard,
  telnyx-assistant-route-drift): mechanische Regex-/Zeiger-Anpassungen, weil die Tests den rohen
  server.js-Quelltext auf verschobene/umbenannte Referenzen greppen. Assertionsstaerke jeweils
  identisch; vom Safety-Reviewer (Opus) explizit als notwendig bestaetigt (P15-Fall durch Plan-A4
  gedeckt).
- **Impl-Umgebungs-Findings** (kein Code-Defekt): Voll-Last-`npm test` haengt auf dieser Maschine
  gelegentlich unter Default-Concurrency (Workaround --test-concurrency=4); der dokumentierte
  ~12%-p5-gate-proof-Flake trat 2x auf und war isoliert jeweils gruen; `STORE_BACKEND=pg` global
  ohne erreichbare DB schlaegt identisch auch auf master fehl (Umgebungsluecke, kein Regressions-Signal).
- `/voice/incoming` liefert in der Smoke-Umgebung (bootstrap-tenant-Seed, Dummy-Env) einen
  hoeflichen Hangup statt `<Gather>` — auf master byte-identisch reproduziert, also vorbestehendes
  Verhalten der Testumgebung, keine Regression.

## Nicht getan (bewusst)

- **KEIN Push** (origin/upstream) — Deploy-Entscheidung liegt beim Owner
  (Achtung Deploy-Split: Render deployt upstream jonas986, `git push origin` macht nichts live).
- G30-Intra-Splits + G5-1-Dedup: Folgearbeit innerhalb der neuen Heimatmodule (Plan A2).
- PX (BODY_LIMIT->config): gestrichen per Q3; Konstante wanderte unveraendert nach app.js.

## Artefakte

- Phasen-Reports: `tasks/server-slim-p0a…p15-report.md` (Detail pro Phase)
- Phasen-Branches `phase/slim-*` bleiben lokal stehen (Merge-Historie via --no-ff nachvollziehbar)
- Workflow-Worktrees unter `.claude/worktrees/wf_*` (harness-verwaltet)
