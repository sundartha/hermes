# AUTONOMER AUFTRAG (Fortsetzung, erteilt 18.09.2026 nach den Owner-Entscheidungen)

Solange diese Datei existiert, ist der Auftrag offen und wird OHNE Rueckfrage fortgesetzt - auch
nach Sessionabbruch oder Nutzungslimit.

## Stand

- Audit fertig: `tasks/OPENAI-MCP-READINESS.md`, Teilberichte `tasks/openai-audit/`.
- Plan fertig: `PLAN-OPENAI.md`. Die vier Owner-Entscheidungen E-1..E-4 sind GETROFFEN und dort
  als Tabelle festgeschrieben. Nicht erneut erfragen.
- Gemergt (lokal, NICHT gepusht): E1 = AS-Sonde + Runbook (228359c), E2 = Tool-Annotations
  (6102101). Testbank danach 6087 gruen / 0 rot.
- Specs `tasks/openai-fix/S1..S5`. S6 und S7 FEHLEN und muessen erst geschrieben werden.

## Auftrag in dieser Reihenfolge

1. **Messen** (Feststellungsaufgaben F-b, F-c, F-e, F-f, F-g, F-h, F-i aus PLAN-OPENAI.md).
   Ergebnis nach `docs/RUNBOOK-LIVE-WERTE.md`, datiert. Entblockt Etappe 3, 4 und 8.
2. **Die fehlenden Specs S6 (Challenge-Route) und S7 (Rechtstexte) schreiben** - Format wie
   `tasks/openai-fix/S5-authorization-server.md`, je Aenderung ein deterministisches
   Erwartungsergebnis UND die Verifikationsmethode, sonst ist der Punkt nicht umsetzungsreif.
3. **Etappen bauen**, in der Reihenfolge von PLAN-OPENAI.md, eine Bahn zur Zeit, ueber
   `phase-impl-lean`. Jetzt baubar: Etappe 5 (Origin-Wache mit Notventil, E-4 entschieden).
   Weitere Etappen, sobald ihre Messung bzw. ihr Spec vorliegt.

## Regeln (unveraendert)

- Lead orchestriert und liest KEINEN Produktionscode; keine woertlichen Kommando-Ausgaben
  verlangen (Kostenformel Kontext x Turns, `.claude/refs/workflow.md` 2a).
- `phase-impl-lean` IMMER mit args als OBJEKT (`phaseId` Pflicht) und einer eigenen specFile;
  Fliesstext-args brechen fail-closed ab. Nach dem Start frueh pruefen, dass der Plan-Prompt die
  richtige Phasen-ID traegt.
- Merge nur im Lead: finalBranch aus dem Return (kann `-fixN` tragen),
  `git merge-base --is-ancestor master <finalBranch>`, log+diff ansehen, dann `merge --no-ff`,
  danach `npm test -- --test-concurrency=4`. Testergebnis NUR an `# pass`/`# fail` lesen, dem
  Exit-Code nicht trauen. Ein roter Test zaehlt erst, wenn er ISOLIERT rot ist. Worktrees des
  Laufs danach mit `git worktree remove --force` aufraeumen.
- **NICHT pushen** (Push deployt, der Dienst telefoniert mit echten Menschen - Owner-Sache).
- **NIE `--no-verify`.** Der pre-commit-Hook lintet den Arbeitsbaum; im Haupt-Arbeitsbaum schlaegt
  er fehl, weil die FREMDE untrackte `docs/architektur/erzeuge-karte.mjs` 35 Lint-Errors hat.
  Deshalb Worktree. Diese Datei wird NICHT angefasst, geloescht, gefixt oder ignoriert.
- Keine absolute Regel aus CLAUDE.md aufweichen. Kein Scope-Zuwachs.
- Prod-Zugriff nur LESEND. Wird ein Befehl vom Classifier geblockt: melden, nicht umgehen.
- caffeinate: PID-Datei
  `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/6a45b341-22e4-45ff-aae9-310531d85281/scratchpad/caffeinate.pid`,
  Lebendigkeit mit `ps -p` (nie pgrep), alle 2 h erneuern, AUS sobald nur noch Etappen uebrig
  sind, die den Owner brauchen. Fremde caffeinate-Prozesse nicht anfassen.

## Fertig, wenn

Alle Etappen gebaut sind, die ohne den Owner gehen. Dann: caffeinate aus, diese Datei loeschen,
Kosten mit `node scripts/workflow-kosten.mjs` messen, EIN Bericht an den Owner.
