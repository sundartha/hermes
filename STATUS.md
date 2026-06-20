# Sundartha - Offene Punkte (Status)

> Das EINZIGE Status-/Offene-Punkte-Doc. Abgeschlossene Phasen stehen in der Git-History
> und in der Memory, nicht hier. Lebende Referenz-Docs (bleiben separat):
> `PLAN-SECURITY.md` (Security-Plan), `docs/RUNBOOK-OPERATOR.md` (Betrieb/Live-Gates),
> `docs/RELEASE-GATE-killer-test.md` (Release-Gate), `tasks/rebrand-sundartha.md` (Rebrand-Task),
> `tasks/lessons.md` (Lehren).
>
> **Stand:** 2026-06-20 - HEAD lokal = `7b0d877`, upstream/jonas986 (= Live) = `7b0d877`,
> origin haengt zurueck.

## Erledigt (Kontext, nicht offen)

Vollstaendig gemergt + (bis auf den origin-Rueckstand) live: Multi-Tenant-Identitaet **I0-I9**,
Telnyx-Multi-Tenant **P0-P8** (Adapter/Ports/pg/Budget/Onboarding/Payment-Code/KYC/Realtime-Port/DSGVO),
Auth-Foundation **+ Fixes F1-F5**, Crash-Hotspots **P0-P4**, P3b-R LLM-Resilienz **CP1-CP7**,
sowie der **Inbound/Outbound-STT-Fix** (de-DE + `speechTimeout="auto"` + defensives `extractSpeech`).
Der **Outbound-Dialog laeuft seit 2026-06-20 erstmals live end-to-end** (Disclosure -> Anlass -> Dialog).

---

## 1. Live-/Betreiber-Gates (nicht autonom: Mensch / Account / Geld / echter Call)

1. **STT-Live-Abschluss + Premature-close-Re-Check** - Outbound laeuft live (`7b0d877`);
   offen ist nur die formale Akzeptanz (sauberer Re-Test mit `role:caller` + Folge-Turn) und die
   Bestaetigung, dass unter `@anthropic-ai/sdk` 0.105 (CP7) kein "Premature close" mehr auftritt.
2. **Telnyx-Realtime scharf schalten** - blockiert bis Live-WS-Echo-Test gruen (Payload-Format
   mu-law vs. RTP). Code ist dormant; Live laeuft auf `VOICE_ENGINE=budget`.
3. **`TELNYX_NUMBER` produktiv setzen** - erst nach gruenem Live-Smoke (derzeit leer, fail-closed).
4. **Stripe live** - `PAYMENT_ENABLED=false`, keine Keys; Test->Live Hold/Capture verifizieren.
5. **WorkOS invite-only scharf + Staging->Production**; **Prod-Postgres** mit non-superuser/
   NOBYPASSRLS-Rolle + pgBouncer (transaction mode); **Killer-Test** fahren
   (`docs/RELEASE-GATE-killer-test.md`) VOR `MULTI_TENANT=true` in Produktion.
6. **`MCP_AUTH=oauth`** end-to-end gegen claude.ai im Dauerbetrieb; **Secrets-Hygiene**
   (Token-Rotation dokumentieren, Twilio-Subaccount auf minimale Rechte).
7. **Crash-Hotspots P3 Real-Call-Smoke** (5 Szenarien, HEIKLE STELLE in `bridge.js`) als Gate
   VOR `VOICE_ENGINE=realtime`-Aktivierung.
8. **origin nachziehen** - lokal/upstream = `7b0d877`, origin haengt 2 Commits zurueck (Backup-Sync).

> Hinweis: Deepgram-STT und Azure-NTTS sind im Telnyx-Account bereits aktiv/abgerechnet -
> das ist KEIN offenes Gate mehr (per Account-Records 2026-06-20 verifiziert).

## 2. Autonome Code-Follow-ups

> Diese Items mit Vorgehen pro Item + Workflow-Einschaetzung (ist phase-impl noetig?):
> siehe **`AUTONOM.md`**.

1. **TEMP-DIAGNOSE-Logs entfernen** - `[turn-recv]`, `[turn-ok]`, `[boot]`-Commit-Diagnose in
   `src/server.js` (alle so markiert). ERST nach Abschluss von Gate 1.1 entfernen - bis dahin
   sind sie fuer die Live-Tests noch nuetzlich.
2. **Azure TTS `speak_failed`** (intermittent) untersuchen/abfangen - schneidet sporadisch
   Disclosure/Antwort ab. Freie Stimmen-/Modellwahl bleibt (kein Voice-Swap als Fix).
3. **`/voice/status` Telnyx-Lifecycle parsen** - liest aktuell nur Twilio-Felder
   (`CallStatus`/`CallSid`); Telnyx-Hangup/Lifecycle laeuft ins Leere (haette das STT-Debugging
   stark verkuerzt).
4. **Remote-Browser-OAuth fuer Self-Service** - `req.auth` wird im REST-Pfad nur auf `/mcp`
   gelesen; Remote-Self-Service damit nur auf localhost nutzbar. Einziger funktionaler Gap der
   Identitaets-Schicht.
5. **`bridge.js handleOpenAiEvent` extrahieren** (Delta-2-Follow-up) - braucht ZUERST einen
   Charakterisierungs-Test der Frame-Ausgabe (HEIKLE STELLE). Nur relevant bei Realtime-Aktivierung.
6. **`server.js`-Decomposition (TD-4)** - God-File (~1130 LOC); bislang nur `/api/profiles`
   extrahiert. Rest-`/api`-Gruppen + `handleOpenAiEvent`. Medium, Rekurrenz-Treiber, kein akuter Crash.

## 3. Bewusst vertagt (nur Tracking, kein akuter Task)

- Allowlist-Lockerung -> Phase 2 / Rechteprofile
- pg-boss als Queue-Backend -> P8 (Stub vorhanden, Default `QUEUE_BACKEND=memory`)
- EU-AI-Act Art. 50(2) maschinenlesbare KI-Markierung -> Compliance-Phase 08/2026
- P8 Scale-Infra (PgBouncer / Read-Replicas / Partitionierung) -> bei echter Last
- P3b-R CP5/CP6 (Metrik-Seam / Breaker-Tuning) -> W4 uebersprungen; **Path B** (undici als Dep
  + expliziter Dispatcher) nur falls "Premature close" unter 0.105 erneut auftritt
- TD-8 MCP-sub-Threading (I5; aktuell fail-closed, kein Leak)

## 4. Rebrand zu "Sundartha"

Eigener, bewusst deferter Task - Details in **`tasks/rebrand-sundartha.md`** (4 Owner-Entscheidungen;
Track A autonom/null-Runtime-Risiko: package.json, MCP-Name, Banner, agentName-Default + Tests,
Dashboards inkl. "Vodafone Verified"-Badge, Doku; Track B owner-koordiniert/hoch-Risiko:
Brand-URL + Twilio/Telnyx/WorkOS/claude.ai-Cutover + Repo-Rename). Repo/Render-Service/Pfade
tragen noch den Altnamen `vodafone-agent`.
