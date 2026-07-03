# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**

---

# Task: Strategie Launch-Fixes (OUT-05, PROV-01, A6) — 2026-07-03

Auftrag: `NEXT-SESSION-LAUNCH-FIXES-STRATEGY.md`. Reine STRATEGIE-Session:
Analyse, Design, Phasenschnitt, Prompts. KEINE Implementierung, Code strikt
read-only. Alles entsteht in DIESEM Worktree auf `docs/launch-fixes-strategy`,
KEIN Merge nach master, NICHTS pushen, KEIN `git stash`.

- [x] 1. Eigenes Worktree, allererster Schritt
  - Erwartet: Session arbeitet in `.claude/worktrees/launch-fixes-strategy`
    auf Branch `docs/launch-fixes-strategy`, Basis = lokaler `master` (361e55b)
  - Verifikation: `git worktree list` + `git log --oneline -1`
  - Ergebnis: erledigt — EnterWorktree, Branch umbenannt
    (`worktree-launch-fixes-strategy` -> `docs/launch-fixes-strategy`),
    `reset --hard 361e55b` (HEAD bestaetigt)

- [x] 2. Dynamic Workflow: Map (3x Sonnet, read-only) -> Design (3x Opus) ->
  Pre-Mortem (3x Opus, adversarial) -> Revision (1 Runde) -> Synthese
  - Erwartet: `PLAN-LAUNCH-FIXES.md` existiert im Worktree-Root und enthaelt
    pro Defekt: verifizierte Wurzelanalyse (Dateipfade), Fix-Design,
    verworfene Alternativen mit Grund, betroffene Absolute Regeln,
    Test-first-Definition, Rollback-Plan, Pre-Mortem-Restrisiken; dazu
    Phasenschnitt F1..Fn (je Phase deterministisches erwartetes Ergebnis +
    exaktes Verifikationskommando + Abhaengigkeiten), empfohlene Reihenfolge
    mit Begruendung, PLAN-SECURITY.md-Vermerk, offene Owner-Fragen
  - Verifikation: Datei lesen und Punkt fuer Punkt gegen den Abschnitt
    "Anforderungen an PLAN-LAUNCH-FIXES.md" der Auftragsdatei pruefen
  - Ergebnis: erledigt — Workflow `wf_2c4a33ed-720`, 13/13 Agenten ohne
    Fehler; Datei komplett gelesen (1123 Zeilen), ALLE Pflicht-Abschnitte
    vorhanden: Kap. 1-3 je Defekt (Wurzel mit Datei:Zeile, Design,
    Alternativen, Regel-Nachweis, Test-first, Rollback, Restrisiken),
    Kap. 4 Phasen F1-F12 (je Ergebnis+Kommando+Abhaengigkeiten+Groesse),
    Kap. 5 Reihenfolge begruendet (Owner-Vorgabe uebernommen), Kap. 6
    PLAN-SECURITY-Eintraege, Kap. 7 sechs Owner-Fragen. A6 = 5 Phasen,
    Reconcile-Schutz zuerst (F8), Drill separat — wie gefordert

- [x] 3. `NEXT-SESSION-LAUNCH-FIXES-IMPL.md` (Lean-Lead-Prompt) schreiben
  - Erwartet: enthaelt Lead-Regeln (liest NIE Code, <100k, mergt selbst),
    Phase-Pinning im per-run Skript + Git-Stand-Check vor Phasenstart,
    Branch-Schema `fix/<phase>`, Push-Verbot ohne Owner-Freigabe +
    Deploy-Freeze-Hinweis, Merge-Koordination mit Test-Session
    (`git worktree list` + `git status` im Haupt-Checkout), Test-Konventionen
    (node:test, PORT=0, DATA_DIR-Temp, BASE_ENV, pglite/Spawn-Trennung),
    kein `git stash`, npm test gruen + Report-Datei pro Phase
  - Verifikation: `grep -c` auf die Pflicht-Stichworte (fix/, BASE_ENV,
    git stash, worktree list, <100k, Owner-Freigabe) — jeweils >= 1 Treffer
  - Ergebnis: erledigt — alle 10 geprueften Stichworte >= 1 Treffer
    (fix/<phase>, BASE_ENV, git stash, git worktree list, <100k,
    Owner-Freigabe, hart gepinnt, PORT=0, pglite, Report-Datei)
  - Nachtrag (Owner-Review): Abschnitt "Effizienz-Regeln" ergaenzt —
    Self-Fix-Deckel (2 erfolglose Runden -> Eskalation an den Lead,
    Konvergenz-Definition), S-Phasen ohne breite Exploration (F3/F6/F8),
    unabhaengige Phasen F1/F3/F4/F8 parallel implementieren bei strikt
    sequenziellen Merges (F9 nicht parallel zu offenem F2 wegen finishCall)

- [x] 4. Commit auf `docs/launch-fixes-strategy`
  - Erwartet: genau die drei Session-Dateien (`PLAN-LAUNCH-FIXES.md`,
    `NEXT-SESSION-LAUNCH-FIXES-IMPL.md`, `tasks/todo.md`) committet,
    `git status` danach clean, Haupt-Checkout unberuehrt
  - Verifikation: `git log -1 --stat` + `git status --short`
  - Ergebnis: erledigt — Commit `5475d45` (amended: Todo-Abschluss), 3 Dateien,
    status clean; Workflow-Zwischendokumente (map/design/premortem je Defekt)
    lagen im Worktree-Root und wurden ins Session-Scratchpad verschoben
    (nicht committet, gehoeren nicht ins Repo)

- [x] 5. Abschluss-Report als letzte Nachricht
  - Erwartet: Kernentscheidung je Defekt (3-5 Saetze), Phasenliste mit
    Groesse+Reihenfolge, offene Owner-Fragen, Pfade beider Deliverables,
    Branch-Name + Worktree-Pfad
  - Verifikation: Abgleich gegen Abschnitt "Abschluss-Report" der Auftragsdatei
