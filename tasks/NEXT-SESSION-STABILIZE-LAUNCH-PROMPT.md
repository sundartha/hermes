# Launch-Prompt — Stabilisierung/Wurzel-Lösung (frische Session)

**In eine FRISCHE Claude-Code-Session einfügen.** Ziel: die Wurzel-Lösung aus `PLAN-STABILIZE-LAUNCH.md` umsetzen — robust für Millionen, keine Pflaster.

---

Lies zuerst (NEU, nicht auf Compaction verlassen):
- `PLAN-STABILIZE-LAUNCH.md` (Repo-Root) — der Fahrplan. §2 = Evidenz, §4 = Phasen/Graph, §5 = Pre-Mortem.
- Memories: `stabilize-launch-plan`, `telnyx-remediation-chain-state`, `suite-flake-p5-gate-proof-spawn-race`, `workflow-model-policy`, `lean-phase-orchestration`, `i8-design-decisions`.

**Owner-Direktive (2026-07-11):** „Richtige Lösung, robust für Millionen; egal ob heute nicht telefonierbar." → **KEIN Flag-Flip** auf die Budget-Engine (nur Notfall-Fallback). Der AI-Assistant-Pfad wird richtig repariert.

**Bereits erledigt (diese Vorsession):** P1 (Render: Auto-Deploy=Off, Health-Check=/healthz — verifiziert). Deploys ab jetzt NUR manuell via Render-Dashboard „Manual Deploy" im No-Call-Fenster (`git push upstream master` deployt NICHT mehr automatisch, aber Dashboard-Deploy zieht `master`).

## Sofort parallel starten (kein Owner-Input, kein echter Anruf nötig)
Je Phase **ein `phase-impl-lean`-Workflow**, Phase im per-run-Skript HART pinnen. Modelle explizit pinnen (NIE Fable): Opus = Plan + Safety-Review, Sonnet = Impl/Audit/Fix/Report.

- **P5** — PII-sichere `messages`-Shape + `speechEmpty`-Log (hinter `TELNYX_SHIM_DEBUG_SHAPE`, SAFE-1-Guard Pflicht).
- **P7** — Empty-Turn-Guard + content-basierter `suppressEndCall` + gebundener Bootstrap (`src/claude.js`; NUR Turn-Logik, Regel 1/2 unberührt; BEIDE Aufrufer testen — Budget + Shim).
- **P8** — Disclosure/Goal-Vertrag (`onAnswered` vs. systemPrompt; Regel 2: Disclosure byte-identisch erster Satz, Contract-Test).
- **P10** — A6 Rehydrate/Reconcile-Schutz/Draining (Achtung Landmine I8: `tenantId`-Hydration testen, sonst CASCADE).
- **P11** — Widget-Host-Trace: `curl`-Teil sofort (live `/mcp initialize` gegen `app.sundartha.com`: Extension-Key/mimeType?), `MCP_UI_ENABLED`-Live-Wert. Owner liefert iframe-DevTools-Trace nach.

## Gegatet (erst nach Vorbedingung)
- **P6** (spec-konformer Stream, handhabt stream:true UND false robust) und **P9** (Watchdog/Loop-Guard) — bauen ja, aber **scharfstellen erst nach P4-Owner-Evidenz** (§2.2-Diskriminator: leere vs. nicht-leere assistant-Message in Telnyx-Insights).
- **P12** (Widget-Bind robust) — nach P11-Trace; nur den von P11 belegten Contract-Key/mimeType pinnen.

## Owner-Gates (NUR der Owner kann; §6 im Plan)
- **P2 (DRINGEND, Katastrophe):** `hermes-db` FREE läuft **2026-07-24** ab → Backup + Paid/Migration.
- **P4:** Telnyx-Portal-Evidenz (Conversation-Insights-Diskriminator, `stream`-Richtung, Deepgram-Timing/Sprache, ElevenLabs-402 auf `elevenlabs_prod`, Assistant-GET-Read-Back). Ohne P4 KEIN Assistant-Verify-Anruf (sonst verbrannt).
- **P13:** Connector remove+re-add + Icon-Screenshot (Branding-Code ist sauber — KEINE `icons[]`-Edits).

## Regeln
- Gate-Protokoll: `npm test` rot ist nur echt, wenn die Datei **isoliert** rot ist (`telnyx-p5-gate-proof` = bekannter Flake → re-run).
- Safety-Gates (Regel 1) + Offenlegung (Regel 2) unantastbar. Secrets/PII nie loggen (Regel 4).
- Pro Assistant-Fix genau EIN überwachter Owner-Testanruf — erst NACH P4-Evidenz.
