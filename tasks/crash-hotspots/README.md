# Crash-Hotspot-Remediation — Phasen-Index & Orchestrierung

Basierend auf `analysis.md` (5 parallele Sub-Agents, 2026-06-16). Dieses Verzeichnis ist die
Handoff-Quelle fuer die phasenweise Abarbeitung ueber mehrere Sessions.

## Dateien

| Datei | Inhalt |
|---|---|
| `analysis.md` | Befund-Analyse: Oberthemen OT-1..OT-5, Top-Hotspots, Evidenz |
| `P0-plan.md` | Phase 0 — Crash-Backstop & Boot-Entkopplung (OT-1) |
| `P1-plan.md` | Phase 1 — Store-Integritaet (OT-3) |
| `P2-plan.md` | Phase 2 — Safety-Gates fail-closed (OT-4) |
| `P3-plan.md` | Phase 3 — Realtime-Audio-Haertung (OT-2) |
| `P4-plan.md` | Phase 4 — Test-Coverage & server.js-Decomposition (OT-5) |
| `README.md` | dieses Doc |

## Nutzung (Multi-Session-Handoff)

Jedes `Pn-plan.md` ist **self-contained und paste-ready**: in einer frischen Session oeffnen
oder dem Main-Agent geben. Es enthaelt Problem, Akzeptanzkriterien, exakte Fundstellen
(file:line), Test-Cases (Given/When/Then), Verifikations-Befehle und Risiken. Implementierung
per `superpowers:executing-plans` bzw. TDD. workflow.md Regel 7 ist erfuellt: jedes Doc traegt
ein deterministisches Erwartungsergebnis + Verifikationsmethode.

## Ausfuehrungs-Reihenfolge & Parallelisierung

**Kurzantwort "geht parallel?": teilweise.** `server.js` ist God-File und wird von P0/P1/P2/P4
beruehrt → nicht alles gleichzeitig. Sichere Reihenfolge:

```
P0  (solo, ZUERST)
        |  merge to master
        v
 +------+------+
 P1     P2     P3      (parallel, je eigener worktree/branch)
 +------+------+
        |  alle gemerged
        v
P4  (solo, ZULETZT)
```

| Phase | OT | Haupt-Files | Branch | Parallel-safe mit | Prereq | Severity |
|---|---|---|---|---|---|---|
| P0 | OT-1 | process-guards.js (neu), server.js (boot), portal-pool.js, store.js, mcp-server.js | `feat/crash-p0-backstop` | — (solo, zuerst) | keine | Critical |
| P1 | OT-3 | store/json.js, server.js (/api/onboard) | `feat/crash-p1-store-integrity` | P2, P3 | P0 | Critical |
| P2 | OT-4 | config.js, server.js (~921), claude.js | `feat/crash-p2-failclosed-gates` | P1, P3 | P0 | High |
| P3 | OT-2 | bridge.js, telephony/adapters/twilio/media.js | `feat/crash-p3-audio-hardening` | P1, P2 | P0 | Critical |
| P4 | OT-5 | server.js (gesamt), web-auth.js, mcp-tools.js | `feat/crash-p4-coverage-decomp` | — (solo, zuletzt) | P0,P1,P2 | Medium |

**Conflict-Matrix (server.js):** P0 (Boot-Block + listen), P1 (/api/onboard-Region), P2 (~921
assertConfig/listen), P4 (gesamt). → P1/P2 fassen verschiedene Regionen an (worktrees ok,
geringes Merge-Risiko). **P3 ist disjunkt** (kein server.js) = sauberste Parallelisierung.
**P4 muss zuletzt + solo**, weil die Decomposition server.js grossflaechig umbaut.

**Merge-Disziplin:** P0 zuerst nach master. Dann P1/P2/P3 auf den neuen master rebasen (eigene
worktrees, `superpowers:using-git-worktrees` → kein Session-Interleaving). P4 zuletzt auf den
dann aktuellen master rebasen. Jede Phase merged erst nach gruenem `npm test` + Smoke-Test.

## Decisions

- **AC4 in P0 — `uncaughtException`-Policy: ENTSCHIEDEN 2026-06-16 = loggen + weiterlaufen**
  (kein `process.exit`, kein graceful-shutdown-Pfad). Begruendung: Exit = alle Calls weg;
  Guard ist nur Last-Resort-Netz, echter Fix sind quellseitige try/catch (P3).

## Pfad-/Fakten-Korrekturen aus der Doc-Verifikation (ueberschreiben analysis.md wo abweichend)

- Twilio-Media-Adapter: real `src/telephony/adapters/twilio/media.js` (nicht `src/adapters/...`), von `bridge.js` via `telephony/registry.js:36` `mediaTransport()` geladen (kein Direkt-Import). `msg.start`-Deref bei :14-15 ohne `?.` (Telnyx-Referenz safe).
- `GET /auth/login`-Handler real bei `web-auth.js:84` (:95 ist der `authorizeUrl`-await im Body).
- `src/server.js` = 944 LOC. Es existiert bereits eine 4-arg-Error-Middleware (`server.js:115`), aber body-parser-spezifisch + VOR den `/auth`-Mounts → faengt deren async-Rejections strukturell nicht. P4 spezifiziert separate catch-all NACH den Mounts + per-Route try/catch.

## Offene Verifikations-Items

- **`server.js:649-655` BESTAETIGTER Leak:** `:652` gibt `error: err.message` im 500-JSON zurueck → rohe Provider-Message an Client (Rules 4/5). **Fix-Owner: P2 (AC5);** P4 hat ihn als bedingten Fallback (T-P4-09).
- Telnyx inbound-STT live + `TimeLimit`/Budget-Cap → separat, nur per Real-Call pruefbar.

## Status

- [x] analysis.md
- [x] P0-plan.md
- [x] P1-plan.md / P2-plan.md / P3-plan.md / P4-plan.md
- [x] AC4-Decision: uncaughtException = loggen + weiterlaufen (kein exit) — 2026-06-16
- [ ] Umsetzung P0 → P1∥P2∥P3 → P4 (Folge-Sessions)
