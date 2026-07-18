# Kickoff-Prompt: PLAN-CONVERSATION-QUALITY-V2 (eine Session, alle agenten-tauglichen Phasen)

> Diesen Prompt in einer FRISCHEN Session als erste Nachricht einfuegen.

---

Setze `PLAN-CONVERSATION-QUALITY-V2.md` um: alle agenten-tauglichen Phasen nacheinander in DIESER Session, autonom bis zum Abschluss oder bis zum ersten nicht heilbaren Fehler.

**Deine Rolle: Lean-Lead.** Du liest NIE Quellcode und NIE Diffs — nur `PLAN-CONVERSATION-QUALITY-V2.md`, kompakte Workflow-Returns, Testresultate und Report-Dateien. Kontext klein halten; die Subagenten machen die Arbeit.

**Lies zuerst §0 des Plans (Owner-Entscheidungen E1/E2/E3).** Sie sind bindend und stehen ueber jeder Analyse im restlichen Dokument. Insbesondere E1: der Agent bucht keine Termine, kein Kalender-Sync — das ist eine Produkt-Entscheidung des Owners, keine Option.

**Reihenfolge (harte Abhaengigkeiten aus dem Plan):**

```
P1b  Buchen + Kalender abschalten      ZUERST (blockiert P4 und P5)
P1   Umlaut-Fix gesprochene Strings    (unabhaengig von P1b, aber NICHT parallel dazu)
P2a  Metriken + heardChars + Dashboard (additiv)
P2b  Diagnose-Retention + allowSummaries-Leck   [SECURITY-REVIEW]
P3   Peinlichkeits-Defekte                      [SECURITY-REVIEW]
P4   Bench haerten                     (nach P1b; Code = 1 Lauf, Messlaeufe = Owner)
P5   Prompt-Redesign                   (nach P4 und P1b)
P6   Mandat statt Rueckfrage           (traegt nach L6 die Terminlogik; NIE parallel zu P1b/P5)
P7a  Budget-Gate per-Modell-Preise     [SECURITY-REVIEW] — Pflicht VOR P7b und P8
P8   Pre-Call-Briefing                 (nach P7a)
```

Nicht in dieser Kette: **P0** (reine Owner-Phase, Anlass-Tagebuch — laeuft parallel in der echten Welt), **P7b** und **P9** (ueberwiegend Owner: Benchlaeufe, Modell-Flip, Kalibrier-Messungen). Wenn die Kette bei P8 ankommt, ist sie fertig.

**Ablauf:**

1. Pro Phase GENAU EIN `phase-impl-lean`-Workflow. Die Phase im per-run Skript HART pinnen (Scope-Text aus dem Plan hineinkopieren, NIE nur ueber `args` referenzieren — Lehre `phase-impl-workflow-args`). Modelle explizit pinnen: **Opus** = Phasen-Plan + Safety-Review, **Sonnet** = Impl / Clean-Code-Audit / Fix / Report. Subagenten erben NIE das Lead-Modell.
2. Nach PASS: Merge im Lead auf master. Vor jedem Merge: volle `npm test` gruen, `node --check` fuer geaenderte Dateien.
3. **P2b, P3 und P7a NUR mergen nach separatem Opus-Safety-Review.** Sie beruehren Retention/DSGVO, Call-Beendigung bzw. das Budget-Gate (Absolute Regel 1).
4. Nach jedem Merge: 1-Zeilen-Status an den User, dann direkt die naechste Phase. Nicht fragen, nicht warten.

**Umgang mit ⛔ NICHT-AGENTEN-ARBEIT (im Plan markiert):**
Diese Schritte NICHT versuchen, NICHT umgehen, und NICHT als Fehlschlag werten. Dazu gehoeren Probeanrufe (P1, P5), der Render-Dashboard-Flip (P2a), Bench-Messlaeufe (P4) und die Datenschutz-Zeile in `apps/web` (P2b — Website laeuft ueber den `staging`-Branch, Datei NICHT editieren, nur Textvorschlag in den Report). Implementiere den Code-Teil, sammle die offenen Owner-Schritte und berichte sie am Ende gesammelt. Eine Phase, deren Abnahme nur per Probeanruf moeglich ist, gilt als "implementiert, Abnahme offen" — nicht als rot.

**Bench-Baseline (Owner-Entscheidung): die Kette WARTET NICHT darauf.** Der Owner erhebt Baseline und Vergleich gebuendelt NACH der Kette. Konsequenz fuer dich:
- P4 gilt als PASS, sobald Code + gruene Suite stehen. Die Baseline-Zahlen NICHT erheben, NICHT schaetzen, NICHT aus alten Reports uebernehmen.
- P5 laeuft normal weiter. Sein Abnahmekriterium, das gegen die Baseline vergleicht, gilt als **"Abnahme offen"** — kein Grund zu stoppen.
- **Notiere den P4-Merge-Commit-Hash im Abschlussreport.** Der Owner braucht ihn, um die Baseline nachtraeglich auf dem echten Vorher-Stand zu erheben (`git worktree add` auf diesen Commit, dort `npm run convo-bench`), bevor er den Vergleich auf dem Endstand faehrt. Ohne diesen Hash ist der Vorher-Wert nicht mehr rekonstruierbar.

**Fail-closed-Regeln (nicht verhandelbar):**
- Erreicht eine Phase kein PASS oder bleibt ein Merge-Gate rot -> Kette STOPPEN, Zustand berichten (welche Phasen gemergt, was rot, Wurzel-Hypothese). NIE "trotzdem mergen".
- Flake-Protokoll: `p5-gate-proof` hat ~12 % Voll-Last-Flake — rot gilt nur als echt, wenn die Datei ISOLIERT (`node --test test/<datei>.test.js`) rot bleibt.
- Test-Pin-Listen im Plan ueber **Testnamen und Treffer** aufloesen, NIE ueber die dort genannten Zeilennummern (P1b loescht Dateien und verschiebt Literale — die Nummern driften).
- NIE `git stash` waehrend Worktree-Workflows laufen (`refs/stash` ist worktree-geteilt). NIE `git add -A` (im Tree liegen unrelated lokale Aenderungen). NIE force-push.
- KEIN Push — weder origin noch upstream. Die Deploy-Entscheidung liegt beim Owner (Render deployt **upstream**).
- Neue config-Env-Var? IMMER in `.env.example` UND `test/helpers.js` BASE_ENV nachziehen, sonst leakt lokales `.env` in Spawn-Tests.
- Nach einer Kontext-Kompaktierung: `PLAN-CONVERSATION-QUALITY-V2.md` (v.a. §0 und die aktuelle Phase) und den letzten Phasen-Report NEU von Platte lesen; nicht auf die Zusammenfassung verlassen.

**Was du NICHT tun sollst:** Den Plan inhaltlich neu verhandeln. Das Pre-Mortem-Verdikt (§2: wahrscheinlichste Todesursache ist fehlender Nutzen, nicht Qualitaet) ist Kontext fuer den Owner, kein Auftrag an dich — du setzt die Code-Phasen um, der Owner beantwortet P0 parallel.

**Am Ende:** Abschlussreport nach `tasks/conversation-quality-run-report.md` (Phasenliste mit Merge-Commits, Teststand, gesammelte offene Owner-Schritte inkl. faelliger Probeanrufe, Pre-Mortem-relevante Beobachtungen) + kompakte Zusammenfassung an den User. Kein Push.
