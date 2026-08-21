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

- [x] 2026-08-21: Kickoff. Planungs-Workflow gelaufen (8x Opus, Run wf_39c81dc7-fbd,
      ~1,37M Subagent-Token). Pre-Mortem-Blocker R-1..R-3 und Clean-Code-S2 (3x)
      EINGEARBEITET; ccBlockerOffen=false.
- [x] Etappen-Dokument committet: 12ddec4 (PLAN-ANRUF-INBOX.md Revision 2,
      .fortschritt/entscheidungen.md mit offenen Fragen an Antonio + Annahmen).
      Nebenbefund behoben: 7 verwaiste OC-Worktrees + gemergte OC-Branches entfernt
      (blockierten den Pre-Commit-Lint).
- [x] INBOX-P1 GEMERGT: 935b7f4 (PASS nach 1 Fix-Runde; Suite 5074 pass / 0 fail).
      Merge-Korrektur im Lead: Fix-Runde hatte Suppression-Eintraege unbeteiligter
      Dateien geloescht -> 9 Lint-Fehler; aus master wiederhergestellt. Zwei Lehren
      in tasks/lessons.md (Worktree-Reste fluten eslint; Suppression-Tabu).
      Nebenzug der Fix-Runde: finishCall entzerrt (complexity 32->21, Mail-Block
      in eigene Funktionen, Pins dokumentiert nachgezogen). Report committet (08fea2a).
- [ ] INBOX-P2 (POST /api/inbox/poll, makeInboxRoutes, takeInboxEntries als EINE
      pure Store-Op, resultCardView-Umzug nach src/call-result.js):
      GEMERGT: fee7fc5 (PASS nach 3 Fix-Runden, davon r3 nach Resume mit
      maxFixRounds 2->4: Whitelist-FORM per deepEqual Object.keys gepinnt).
      Suite 5075 pass / 0 fail; volles Lint 0 Fehler; Suppressions diszipliniert
      (nur Diff-eigene Dateien, resultCardView-Komplexitaet 11 -> <10).
      Report committet (cc33d8e).
- [x] INBOX-P3 GEMERGT: ea9e943 (PASS ohne Fix-Runde; check_inbox via uiTool,
      keine zweite Projektion, EN-Beschreibung gepinnt, test:gates nicht roeter).
      Report committet. VOLLE SUITE auf gemergtem master: 5111 pass / 0 fail.
- [x] End-zu-End-Nachweis am laufenden lokalen System (2026-08-21, master ea9e943,
      Temp-DATA_DIR, kein echter Netz-/Provider-Zugriff): ALLE DREI SZENARIEN PASS.
      A) Simulierter Inbound-Verlauf ueber /voice/* -> inboxEntryAt gesetzt; LLM
         absichtlich unerreichbar -> summary_unavailable-Pfad (R-1) belegt: Eintrag
         entsteht trotz Summary-Ausfall (finally in call-finish.js).
      B) check_inbox ueber den ECHTEN /mcp-Pfad: 1. Aufruf liefert den Eintrag
         (caller korrekt, kein transcript/facts/evidence), 2. Aufruf "No new calls."
      C) Anruf ohne substanzielle Anrufer-Zeile -> inboxEntryAt=null, erscheint
         auch mit include_seen=true nicht.
      OFFEN bleibt nur der Live-Testanruf nach Deploy = Owner-Entscheidung F-10
      in .fortschritt/entscheidungen.md.
- [x] Aufraeumen nach gemergter Kette: Reports p1-p3 + per-run-Skripte inbox-p1/p2 +
      oc-p3 geloescht (alle committet -> Historie in git); inbox-p3.js bleibt
      neueste Impl-Vorlage, inbox-plan.js bleibt Planungs-Vorlage.
- [x] Ergebnis-Seite fuer Antonio: .fortschritt/anruf-inbox-ergebnis.md

Etappen-Abnahmen im Detail: PLAN-ANRUF-INBOX.md (Abnahmekatalog je Etappe).
Kernentscheidungen: E-1 Projektion statt neuer Entitaet (2 nullable ISO-Marker am
Call); E-2 eigenes fail-closed-Praedikat (2 substanzielle Anrufer-Zeilen ODER 12
Zeichen; callerHasSpoken ist das FALSCHE Praedikat); E-3 gesehen = serverseitig
pro Tenant, Marker je Anruf, implizit beim Abruf; E-4 POST (verbraucht Zustand),
eigene Factory; E-5 resultCardView wiederverwenden; E-6 kein neues Env-Flag.

## Betriebsregeln fuer Uebernehmer

- Lead liest KEINEN Code selbst; alles ueber Subagenten/Workflows (Memory
  [[lean-phase-orchestration]]). EIN Workflow zur Zeit ([[al-parallelism-load-limit]]).
- Vor JEDEM Merge: git diff --stat selbst ansehen ([[workflow-pass-is-not-merge-approval]]);
  NICHT mergen, waehrend eine Welle laeuft.
- Worktree-Falle: erst `git checkout -b <branch> master`, dann lesen
  ([[workflow-worktree-stale-base]]).
- Neue Env-Vars: config.js, .env.example, render.yaml UND test/helpers.js BASE_ENV.
