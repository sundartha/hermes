# Kickoff: Behebungskette Sicherheitstest (SEC-P0..P6)

Kopiere den Block unten als erste Nachricht in eine **frische** Session. Frisch ist Pflicht,
nicht Stil: der Lead soll duenn bleiben, und ein Lead, der mit 200k Vorgeschichte startet,
ist es nie.

---

Du bist der **Lead** einer Behebungskette. Du orchestrierst, du implementierst nicht.

Lies ZUERST, vollstaendig und ohne dich auf Zusammenfassungen zu verlassen:

- `CLAUDE.md` — Absolute Regeln. Alles in dieser Kette beruehrt Calls, SMS, Auth oder
  Budget-Gates, ist also per Definition nicht-trivial.
- `PLAN-SEC-FIX.md` — die Kette: sieben Phasen, je mit Auftrag, Abnahmekriterium und
  Abgrenzung. Das ist dein Manifest. Hier wird NICHT geplant, sondern abgearbeitet.
- `.claude/refs/workflow.md` — Pflicht, insbesondere Abschnitt 2a (was Subagenten kosten).

Die Belege zu jedem Befund stehen in `tasks/sicherheitstest-befunde.md`. **Lies sie nur, wenn
eine Phase ohne sie nicht spezifizierbar ist** — die Phasen-Specs in `PLAN-SEC-FIX.md` tragen
die Messwerte bereits.

## Deine Rolle, hart abgegrenzt

- **Du liest NIE Quellcode und NIE Diffs.** Kein `git diff` ausser `--stat`. Kein `cat` auf
  `src/**`. Wenn du wissen willst, was eine Phase getan hat, liest du ihren Report-Pfad —
  nicht den Code.
- Du faehrst jede Phase ueber `.claude/workflows/phase-impl-lean.js`, mit einer **per-run
  Kopie** des Skripts (nie das geteilte Original editieren).
- Aufruf-Form, die nachweislich funktioniert:
  `Workflow({ scriptPath, args: { phaseId, phaseTitle, branch, baseBranch, planDoc, specFile, maxFixRounds } })`
  — `args` MUSS ein echtes Objekt sein und `phaseId` tragen; fehlt es, bricht der Workflow
  fail-closed ab. Der lange Auftragstext gehoert in die `specFile`, nicht in `args`.
- **Modell-Pins sind im Skript bereits gesetzt** (Plan + Safety-Review auf Opus,
  Implementierung/Clean-Code/Fix/Report auf Sonnet). Pruefe sie in deiner per-run Kopie nach,
  aendere sie nicht ohne Grund - Vererbung waere ein Kosten-Bug.
- **`highStakes: true` MUSST du selbst setzen.** Das Skript leitet Hochrisiko aus einer
  hartkodierten Liste `["P5","P6","P7"]` ab (`phase-impl-lean.js:90`) - unsere IDs heissen
  `SEC-P<N>` und treffen diese Liste NICHT. Ohne den expliziten Schalter laeuft die
  Implementierung des Geldpfads auf dem schwaecheren Modell und der Safety-Review eine Stufe
  weicher. Setze ihn so:

  | Phase | `highStakes` | Warum |
  |---|---|---|
  | SEC-P0 Testbank | `false` | Testcode, kein Live-Pfad |
  | SEC-P1 Idempotenz | **`true`** | Geldbuchung + Anrufdatensatz |
  | SEC-P2 Lieferkette | `false` | Versionsspruenge, durch die Suite gedeckt |
  | SEC-P3 Grenzen + CSRF | **`true`** | Auth-Oberflaeche, Zustandswechsel |
  | SEC-P4 EL-Token | **`true`** | Mandantentrennung |
  | SEC-P5 Web-Haertung | **`true`** | Session-Cookie, alle Sitzungen enden |
  | SEC-P6 Gate-Antwort | **`true`** | Outbound-Gate-Kette, Absolute Regel 1 |
- **Eine Bahn zur Zeit.** Zwei parallele Workflows haben diese Maschine schon auf Load 32 bei
  15 Kernen gefahren.

## Je Phase, in dieser Reihenfolge

1. **Keine Spec schreiben.** Der Workflow sucht sich den Phasenabschnitt selbst: er
   bekommt `specFile: "PLAN-SEC-FIX.md"` und `phaseId: "SEC-P<N>"` und liest daraus den
   Abschnitt fuer genau diese Phase (`phase-impl-lean.js:113-115`). Eine eigene
   `tasks/sec-p<N>-spec.md` schreibst du NUR, wenn du beim Lesen des Phasenabschnitts eine
   Luecke siehst, die der Plan-Agent sonst raten muesste - dann ergaenzt sie ihn, ersetzt ihn
   aber nicht.
2. **Branch von `master`.** `git checkout -b sec/p<N> master` — erst den Branch, DANN lesen
   lassen; ein Worktree auf veraltetem Commit hat diese Kette schon einmal gekostet.
3. **Workflow starten**, Ergebnis abwarten, **Return-Felder nicht glauben.** Pruefe selbst:
   `git log --oneline`, `git diff --stat master..<finalBranch>`, und fahre `npm test` SELBST.
   Ein PASS des Workflows ist keine Merge-Freigabe.
4. **Abnahmekriterium der Phase** aus `PLAN-SEC-FIX.md` pruefen — deterministisch, mit dem
   dort genannten Kommando. Nicht "sieht gut aus".
5. **Merge im Lead**, klein. `finalBranch` mergen, nicht blind `branch` (kann `-fixN` heissen).
   Uncommittete Owner-Arbeit: nur *tracked* stashen.
6. **Aufraeumen im selben Zug** (CLAUDE.md, Pflicht): `tasks/sec-p<N>-report.md`, eine
   etwaige `-spec.md`, das per-run-Skript aus `.claude/workflows/runs/`. Erst committen, dann
   loeschen — sonst ist es fuer genau die Dateien unumkehrbar, die nie in der Historie waren.
   `PLAN-SEC-FIX.md` bleibt, es ist das Manifest der ganzen Kette.
7. **Kettenstand fortschreiben** in `tasks/sec-fix-chain-state.md`: Phase, Merge-Commit,
   Abnahme erfuellt ja/nein, offene Befunde. Das ist die Datei, die eine Nachfolge-Session
   liest — halte sie kurz.

## Was du NICHT tust

- Keinen `git push`, kein Deploy, kein Aendern eines Live-Env-Werts. Render deployt aus dem
  UPSTREAM-Repo; ein Push hier waere kein Test, sondern ein Release.
- **ID-01 (Besitznachweis fuer die eigene Nummer) wird nicht gebaut** — ausdrueckliche
  Owner-Entscheidung vom 2026-09-08. Wenn ein Agent ihn vorschlaegt: ablehnen.
- Keine Phase ueberspringen, weil sie langweilig aussieht. SEC-P0 ist die langweiligste und
  die wichtigste: ohne gruene Bank ist jede spaetere Abnahme wertlos.

## Reihenfolge-Riegel

**SEC-P0 muss gruen sein, bevor SEC-P1 startet.** Zwei aufeinanderfolgende volle `npm test`
mit Exit 0 — ein einzelner gruener Lauf beweist bei Flakes nichts. Erreichst du das nach
zwei Fix-Runden nicht, stoppe und melde dem Owner; fahre NICHT die naechste Phase auf einer
roten Bank.

Bei SEC-P5 gilt die im Plan genannte Kopplung: `test/headers.test.js:25` pinnt heute das
Gegenteil des Fixes und muss im SELBEN Commit umgeschrieben werden.

## Owner-Blocker, die du nur meldest

Vier Repo-Secrets fuer den Drift-Waechter, Render-Zugang, Rotation des Render-Schluessels,
Stripe. Alle vier stehen in `PLAN-SEC-FIX.md` Abschnitt 3. Du kannst sie nicht bauen — nimm
sie in den Kettenstand auf und erinnere den Owner am Ende, statt sie zu umgehen.

## Am Ende

Kettenstand fortschreiben, `PLAN-SECURITY.md` um die Entscheidungen ergaenzen, die die Kette
gefaellt hat (Idempotenz-Schluessel, `nodemailer`-Major, CSRF-Modus, Cookie-Rename — je ein
kurzer, datierter Owner-Entscheidungs-Block), und dem Owner den Stand nach Wirkung melden,
nicht nach Reihenfolge des Bauens.
