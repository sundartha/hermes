# Kettenstand: Anruf-Inbox (eingehende Anrufe fuer KI-Assistenten abfragbar)

Auftrag (Owner, 2026-08-21): Neues MCP-Werkzeug — verbundener KI-Assistent fragt ab:
(1) neue eingehende Anrufe seit dem letzten Nachschauen? (2) Handlungsbedarf?
Je Anruf: wer rief an, was wollte er, was wurde zugesagt, was ist zu tun (Ergebnis,
nicht Roh-Transkript; leer = kurz und eindeutig leer). Plus Server-Verdrahtung:
Inbound-Anruf endet -> Eintrag entsteht automatisch.

Harte Vorgaben aus dem Auftrag:
- "neu" vs "gesehen" muss ueber mehrere Sitzungen desselben Kunden tragen (serverseitig).
- Nie angekommene Anrufe erzeugen KEINEN Eintrag (fail-closed; Ist-Verbuchung pruefen).
- PII/Gespraechsinhalte: nie in Logs, nie in Beispieldaten.
- Autonom durcharbeiten; Fragen an Antonio MIT Empfehlung in .fortschritt/entscheidungen.md,
  Arbeit laeuft mit der empfohlenen Annahme weiter.
- Modellwahl Subagenten: Opus = Urteilen (Bestandsaufnahme/Entwurf/Pre-Mortem/Review),
  Sonnet = Ausfuehren (Umsetzung/Tests/Botengaenge).
- Fertig heisst: Werkzeug am laufenden System belegt (echter Inbound-Anruf -> Eintrag,
  MCP-Client holt ab, nie angekommener Anruf -> kein Eintrag); Tests gruen; Review durch;
  Commits deutsch; EINE Seite fuer Antonio ohne Fachbegriffe.

## Artefakte

- Etappen-Dokument: PLAN-ANRUF-INBOX.md (entsteht im Planungs-Lauf)
- Entscheidungsliste: .fortschritt/entscheidungen.md (entsteht im Planungs-Lauf)
- Planungs-Workflow: .claude/workflows/runs/inbox-plan.js (Run-ID wf_39c81dc7-fbd)
- Abschluss-Seite fuer Antonio: am Ende der Kette (ohne Fachbegriffe)

## Stand

- [x] 2026-08-21: Kickoff. Planungs-Workflow gestartet (8x Opus: 4 Leser parallel ->
      Entwurf -> Pre-Mortem + Clean-Code-Review parallel -> Revision). LAEUFT.
- [ ] Etappen-Dokument fertig + committet
- [ ] Etappen umgesetzt (je Etappe: phase-impl-lean-artiger Lauf, Merge im Lead,
      Aufraeumen der Prozessdateien im Merge-Zug)
- [ ] End-zu-End-Nachweis am laufenden System
- [ ] Seite fuer Antonio

## Betriebsregeln fuer Uebernehmer

- Lead liest KEINEN Code selbst; alles ueber Subagenten/Workflows (Memory
  [[lean-phase-orchestration]]). EIN Workflow zur Zeit ([[al-parallelism-load-limit]]).
- Vor JEDEM Merge: git diff --stat selbst ansehen ([[workflow-pass-is-not-merge-approval]]);
  NICHT mergen, waehrend eine Welle laeuft.
- Worktree-Falle: erst `git checkout -b <branch> master`, dann lesen
  ([[workflow-worktree-stale-base]]).
- Neue Env-Vars: config.js, .env.example, render.yaml UND test/helpers.js BASE_ENV.
