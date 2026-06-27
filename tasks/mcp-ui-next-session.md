# Next-Session-Prompt: MCP-UI-Kette umsetzen (lean)

> Kopiere den Block unter "PROMPT" als erste Nachricht in eine FRISCHE Session.

## PROMPT

Wir setzen die MCP-Server-Rich-UI um. Die Strategie ist ENTSCHIEDEN und liegt im Repo — **kein Re-Design, keine neuen Konzept-Diskussionen.**

**Lies ZUERST (nicht raten, nicht auf Compaction verlassen):**
- `docs/mcp-ui-strategy.md` (Strategie + Owner-Entscheidungen)
- `tasks/mcp-ui-chain.md` (Phasen P0-P5, Driver-Protokoll)
- `tasks/mcp-ui-p1-spec.md` (Detailspec erste Scheibe)
- `CLAUDE.md` Absolute Regeln + `.claude/refs/clean-code.md`

**Gepinnte Entscheidungen (NICHT neu aufmachen):** Seam-Kern MCP-nativ `ui://` (Claude MCP Apps), ChatGPT Apps SDK erst in P3; erstes Widget `get_call_status`; Token-Sync = CI-Gate (P5); zwei Host-Konventionen dauerhaft akzeptiert; Callback nur ueber authentisierten `/mcp`-Eingang (Invariante, greift P4). Ausgangslage: MCP gibt heute nur `{type:"text"}` zurueck (`src/mcp-tools.js`). NICHTS ist committet.

**Arbeitsweise — so lean wie moeglich, Lead bleibt duenn:**
- Lead liest keinen Impl-Code/Diffs selbst. Merge passiert im Lead (Stash bei Bedarf).
- **Workflow-Politik pro Phase** (Faustregel: voller dualer Review nur wo Architektur / Safety-Gate / PII-Grenze):
  - **P0** = KEIN Workflow. Ein Research-Subagent (WebSearch/WebFetch), kein Code.
  - **P1** = voller Lean-Impl-Workflow (`phase-impl-lean`), dualer Review als hartes Gate.
  - **P2** = schlank: ein Impl-Subagent + ein leichter Review-Subagent (PII/Transcript pruefen). Kein volles Programm.
  - **P3** = voller Lean-Impl-Workflow (zweiter Host-Adapter = echte Architektur).
  - **P4** = voller Lean-Impl-Workflow, STRENGSTER Review — alle Safety-Gates re-validieren (Callback loest Tools aus).
  - **P5** = schlank/direkt (Token-Sync-CI-Gate + Doku).
- **Gate zwischen Phasen: STOPP beim Owner.** Kein Auto-Pilot durch die ganze Kette — gerade weil P4 echte Anruf-Ausloesung beruehrt. Nach jeder Phase kurzer Statusbericht, dann auf Owner-Freigabe fuer die naechste warten.

**JETZT starten mit P0** (kein Code): Spawne EINEN Research-Subagent, der mit Stand 2026 KONKRET + mit Quellen belegt:
1. Rendert Claude (MCP Apps / claude.ai) heute tatsaechlich `ui://`-HTML-Resources aus einem MCP-Tool? Welches exakte Resource-Format / mimetype / `_meta`?
2. Wie erkennt der Server einen Rich-faehigen Host (Initialize-Capability / Client-Info)? — das ist der echte Engpass (Q2), bis dahin fail-closed auf Stufe 0.
3. Go/No-Go fuer P1: ist das in `mcp-ui-p1-spec.md` gewaehlte Format real renderbar, oder muss P1 das Format anpassen?
Der Subagent gibt einen kompakten Befund zurueck (kein Doc-Schreiben noetig). Lead fasst zusammen, aktualisiert ggf. die P1-Spec, und legt dem Owner go/no-go vor.

Nach P0: auf Owner-Freigabe warten, dann P1 als `phase-impl-lean`-Workflow.
