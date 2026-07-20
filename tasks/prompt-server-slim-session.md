# Kickoff-Prompt: PLAN-SERVER-SLIM Komplett-Lauf (eine Session, alle Phasen)

> Diesen Prompt in einer FRISCHEN Session als erste Nachricht einfuegen.

---

Setze PLAN-SERVER-SLIM.md KOMPLETT um: alle Phasen P0a, P0b, P1-P15 (PX entfaellt) nacheinander in DIESER Session, autonom bis zum Abschluss oder bis zum ersten nicht heilbaren Fehler.

**Deine Rolle: Lean-Lead.** Du liest NIE Quellcode und NIE Diffs — nur PLAN-SERVER-SLIM.md, kompakte Workflow-Returns, Testresultate und Report-Dateien. Kontext klein halten; die Subagenten machen die Arbeit.

**Ablauf:**
0. Falls `PLAN-SERVER-SLIM.md` untracked ist: EINZELN committen (nur diese Datei — NIE `git add -A`, im Tree liegen unrelated lokale Aenderungen, die unangetastet bleiben). Worktrees forken vom HEAD, sonst sehen die Agenten den Plan nicht.
1. Pro Phase GENAU EIN phase-impl-lean-Workflow. Die Phase im per-run Skript HART pinnen (Scope-Text aus dem Plan hineinkopieren, NIE nur ueber args referenzieren — Lehre phase-impl-workflow-args). Modelle explizit pinnen: Opus = Phasen-Plan + Safety-Review, Sonnet = Impl/Clean-Code-Audit/Fix/Report. Subagenten erben NIE das Lead-Modell.
2. Nach PASS: Merge im Lead auf master. VOR jedem Merge pruefen: Invarianten-Checkliste aus PLAN-SERVER-SLIM.md (INV-1..INV-11, die pro Phase als load-bearing markierten besonders) + globale Verifikation: volle `npm test` gruen, `node --check` fuer neue Dateien + `src/server.js`, `grep -c "^export" src/server.js` = 0, Boot-Log-Zeile wortwoertlich genau 1 Treffer, `git diff --stat` zeigt Netto-Reduktion in server.js. Bei P9/P11/P12/P15 zusaetzlich das SMOKE-Rezept aus dem Plan-Anhang.
3. P15 NUR mergen nach separatem Opus-Safety-Review (Pflicht laut Plan; hoechster Blast-Radius: Middleware-Ordnung + Boot-Gate-Sequenz + Boot-Log-Kontrakt).
4. Nach jedem Merge: 1-Zeilen-Status an den User, dann direkt die naechste Phase starten. Nicht fragen, nicht warten.

**Fail-closed-Regeln (nicht verhandelbar):**
- Erreicht eine Phase kein PASS oder bleibt ein Merge-Gate rot -> Kette STOPPEN, Zustand berichten (welche Phasen gemergt, was rot, Wurzel-Hypothese). NIE "trotzdem mergen".
- Flake-Protokoll: `p5-gate-proof` hat ~12% Voll-Last-Flake — rot gilt nur als echt, wenn die Datei ISOLIERT (`node --test test/<datei>.test.js`) rot bleibt.
- NIE `git stash` waehrend Worktree-Workflows laufen (refs/stash ist worktree-geteilt). NIE `git add -A`. NIE force-push.
- KEIN Push — weder origin noch upstream. Deploy-Entscheidung liegt beim Owner (Render deployt upstream!).
- Nach einer Kontext-Kompaktierung: PLAN-SERVER-SLIM.md (v.a. Invarianten + aktuelle Phase) und den letzten Phasen-Report NEU von Platte lesen; nicht auf die Zusammenfassung verlassen.

**Am Ende:** Abschlussreport nach `tasks/server-slim-run-report.md` (Phasenliste mit Merge-Commits, Teststand, Pre-Mortem-relevante Beobachtungen, offene Punkte) + kompakte Zusammenfassung an den User. Kein Push.
