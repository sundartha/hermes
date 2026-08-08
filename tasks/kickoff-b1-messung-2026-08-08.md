# Kickoff: Track B, Phase B1 — DeepSeek-Messung ausfuehren (2026-08-08)

Prompt fuer die naechste Session. Autor: Lead-Session 2bd10950 (Track-C-Abschluss).
Regel dieser Datei: GEMESSEN traegt ein Kommando, alles andere ist als Vermutung zu behandeln.

## 1. Der Auftrag

Fuehre die B1-Messung gegen die echte DeepSeek-API aus und lege dem Owner die
Kostenmodell-Entscheidungsvorlage vor. **`tasks/b1-spec.md` ist die autoritative
Spezifikation** — Messfragen M1-M8, Versuchsaufbau, Abnahme, Pre-Mortem. Nichts davon
neu erfinden; wo die Spec und die Wirklichkeit kollidieren, gilt die Messung, und die
Abweichung kommt in den Report.

Ausdruecklich NICHT in dieser Phase: Code in `src/` (der LLM-Port selbst ist B2 und
braucht die Owner-Entscheidung NACH der Messung). B1 baut genau EIN Wegwerf-Messskript
`scripts/deepseek-b1-messung.mjs` gemaess Spec.

## 2. Aktueller Stand (GEMESSEN am 2026-08-08)

| Behauptung | Kommando |
|---|---|
| Track C (Twilio raus) ist KOMPLETT und LIVE; Produktion bootet OHNE Twilio-Keys (Owner hat sie aus der Render-Env geloescht) | `curl -s https://vodafone-agent.onrender.com/healthz` -> ok:true, commit 6aec118 |
| master = upstream/master = origin/master, Suite gruen | `git fetch --all && git log --oneline -1`; letzter Volllauf 4027/4027 Exit 0 |
| B1-Spec liegt vor, Doku-verifiziert | `tasks/b1-spec.md` (Commit 30799ea) |
| DEEPSEEK_API_KEY: liegt in der RENDER-Env (dort nutzlos, kein Code liest ihn), **lokal FEHLT er** | `node -e "import('dotenv').then(d=>{d.config();console.log(process.env.DEEPSEEK_API_KEY?'gesetzt':'FEHLT')})"` |

**Erster Handgriff der Session:** das Key-Kommando oben ausfuehren. FEHLT er noch,
Owner bitten, ihn in die lokale `.env` einzutragen — NICHT versuchen, ihn aus Render
zu lesen (geht mit den vorhandenen Werkzeugen nicht; der MCP-Zugang ist schreibend).

## 3. Zuerst lesen (Reihenfolge)

1. `CLAUDE.md` — Absolute Regeln (Regel 4: Secrets nie loggen — der Key darf in KEINER
   Skript-Ausgabe, keinem Commit, keinem Report auftauchen)
2. `.claude/refs/workflow.md` + `.claude/refs/clean-code.md` — Pflicht
3. `tasks/b1-spec.md` — die Spec dieser Phase, vollstaendig
4. `PLAN-ANBIETER-PORT.md` Teil 2 — Umbrella. ACHTUNG: dort steht noch die
   Preistabellen-Praemisse, der der Owner widersprochen hat. Es gilt die Owner-Korrektur
   (in der B1-Spec eingearbeitet): **es zaehlt, was der Anbieter tatsaechlich abbucht.**
5. `tasks/todo.md` (Kettenstand Track C am Ende) und `tasks/lessons.md` (letzte Abschnitte:
   Symlink-Falle, timeout-fehlt-auf-macOS, Exit-0-ohne-Messung)

## 4. Arbeitsweise (so hat die Kette bisher funktioniert — beibehalten)

- **Lead bleibt duenn.** Der Lead orchestriert, liest Specs/Reports/Diff-Stats, aber
  keinen Implementierungs-Code. Arbeit machen Subagenten/Workflows.
- **Modell-Politik:** Opus fuer Plan/Spec/Safety-Review, Sonnet fuer Impl/Audit/Fix/Report.
  Pins explizit pro agent(), nie erben lassen.
- Fuer B1 reicht statt des vollen phase-impl-lean ein schlanker Zuschnitt: EIN
  Impl-Agent (Sonnet) baut das Messskript gemaess Spec-Abschnitt Versuchsaufbau, der
  Lead prueft VOR dem Scharfschalten nur zwei Dinge selbst: (a) `node --check`, (b) der
  Key erscheint in keiner Ausgabe (Probelauf mit Dummy-Key gegen einen Mock/`--dry-run`,
  wenn die Spec einen vorsieht). Erst dann der echte Lauf (Kostenrahmen der Spec: < 1 USD).
  Bei jeder Unsicherheit: volle Workflow-Vorlage `.claude/workflows/runs/c-p6.js` kopieren
  (traegt den REPO-Hart-Pin gegen die Symlink-Falle) und Review-Stufen dazunehmen.
- **PASS ist keine Freigabe:** vor jedem Merge `git log master..<branch>` und
  `git diff --stat` selbst ansehen (Lehre C-P2: leerer Branch trotz PASS).
- **EINE Test-Bahn zur Zeit** (Volllast-Flakes), Workflows vorher sichtbar ankuendigen,
  Verbrauch nachher nennen.
- **Pre-Mortem vor Entscheidungen**, weisse Flecken selbst erheben statt Dokumenten
  glauben, rote Tests isoliert nachmessen bevor sie als Befund gelten.
- Nach dem Merge einer Phase: Prozessmuell im selben Zug raeumen (erst committen, dann
  loeschen), Memory (`anbieter-port-plan`) nachziehen.

## 5. Der Weg nach B1 (nur zur Orientierung, nicht vorgreifen)

1. Messergebnisse gegen die Wenn-Dann-Tabelle der Spec halten -> Entscheidungsvorlage
   an den Owner (Kostenmodell: cost-truing-artiger Abgleich vs. aufgeschluesselte Raten).
2. ERST nach der Owner-Entscheidung: B2 (der eigentliche Port am Seam `src/llm.js` /
   `src/llm-usage.js`) als normale phase-impl-lean-Phase mit Spec. Die B1-Neufunde
   gehoeren in die B2-Spec: `reasoning_tokens` als Kostenposition,
   `stream_options.include_usage`, Rate-Limit haelt Anfragen bis 10 min offen (gegen
   `LLM_REQUEST_TIMEOUT_MS=3500`).
3. Offene Owner-Punkte ausserhalb Track B: WER-Nachmessung Track A (zurueckgestellt;
   die 20,3 %-Messung vom 08-08 ist NICHT belastbar — 59 Woerter, Echo-Turns,
   Eigennamen-Dominanz; Drift per Sonde ausgeschlossen).
