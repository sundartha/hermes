# NEXT-SESSION: Launch-Fixes umsetzen (F1-F12, Lean-Lead)

> Start-Prompt fuer eine FRISCHE Session:
> "Lies NEXT-SESSION-LAUNCH-FIXES-IMPL.md und fuehre den Auftrag aus."

## Auftrag

Setze die 12 Phasen aus **`PLAN-LAUNCH-FIXES.md`** (verbindlich, einzige
fachliche Quelle) um: OUT-05 (F1-F2), PROV-01 (F3-F7), A6/DEPLOY-04 (F8-F12).
Reihenfolge und Abhaengigkeiten stehen in Abschnitt 4+5 des Plans und sind
bindend: **F1 -> F2 -> F3 -> F4 -> F5 -> F6 -> F7 -> F8 -> F9 -> F10 -> F11 -> F12.**

Harte Abhaengigkeiten: F2->F1; F5->F3+F4; F7->F4+F5; F10->F9; F12->F9+F10
(+F8 weich). F6 ist unabhaengig, aber Pflicht VOR jeder Payment-Live-
Scharfschaltung.

## Rolle: duenner Lead (Lean-Template)

- Der Lead liest **NIE selbst Produkt- oder Testcode** und bleibt **<100k
  Tokens**. Code lesen/schreiben tun ausschliesslich die per-Phase-Workflows.
- Der Lead liest nur: `PLAN-LAUNCH-FIXES.md`, die Phasen-Reports, git- und
  Test-AUSGABEN (Kommando-Output, keine Quelldateien).
- Pro Phase **EIN** Workflow (`phase-impl-lean` bzw. per-run Skript nach
  demselben Muster: Plan -> Impl im eigenen Worktree -> dualer Review
  Safety/Verhalten + Clean-Code-Auditor, S1/S2 = Blocker -> Self-Fix bis PASS
  -> kompakter Return + Report-Datei).
- **Merge macht der Lead selbst** (nie der Workflow).

## Args-Misfire-Falle (Pflicht, bekannte Lektion)

- Die Phase wird **IMMER im per-run Skript hart gepinnt** (Phasen-ID, Branch,
  Auftragstext als Literal im Skript — KEIN args-Fallback, der auf eine
  Default-Phase laufen kann; ein Misfire = verbrannter Lauf).
- Vor JEDEM Phasenstart prueft der Lead den echten Git-Stand selbst:
  `git log --oneline -3` + `git branch --show-current` — sind alle
  Vorgaenger-Phasen wirklich auf `master` gemergt? Erst dann starten.

## Git-Regeln

- **Branch-Schema `fix/<phase>`** — exakte Branch-Namen aus
  `PLAN-LAUNCH-FIXES.md` Abschnitt 4 (z.B. `fix/out05-reserve-ledger`).
- **Vorbereitungs-Schritt:** `PLAN-LAUNCH-FIXES.md` liegt auf dem Branch
  `docs/launch-fixes-strategy` (Worktree
  `.claude/worktrees/launch-fixes-strategy`). Sobald der Haupt-Checkout frei
  ist, diesen Branch zuerst nach `master` mergen (reiner Doku-Merge). Solange
  er belegt ist: den Plan aus dem Worktree-Pfad lesen und den Merge
  aufschieben.
- **Merge-Koordination:** Merges nach `master` passieren im Haupt-Checkout
  und NUR, wenn der frei ist (parallele Test-Session beendet oder ihr Stand
  auf `test/launch-run-1` committet). Vorher pruefen: `git worktree list` +
  `git status` im Haupt-Checkout. Solange belegt: Phasen-Branches
  fertigstellen, Merges aufschieben (die Kette kann in Worktrees weiterlaufen,
  solange die Abhaengigkeits-Basis stimmt).
- **NICHTS pushen** (weder `origin` noch `upstream`) ohne explizite
  Owner-Freigabe. Render deployt `upstream`; bis der A6-Fix (F12) gemergt
  UND freigegeben ist, gilt **Deploy-Freeze bei aktivem Traffic**
  (Plan Abschnitt 5.1: nur in nachweislich anruf-freien Fenstern).
- **KEIN `git stash`** — `refs/stash` ist worktree-geteilt; waehrend
  isolation:worktree-Workflows laufen, kann ein stash/pop fremde Aenderungen
  klobbern. Stattdessen WIP-Commit.

## Test-Konventionen (an jeden Phasen-Workflow weitergeben)

- `node:test`; `npm test` laeuft ohne Netz und ohne `.env`.
- Integrationstests spawnen den Server als Kindprozess mit `PORT=0` und
  `DATA_DIR`-Temp (`data/store.json` wird nie angefasst).
- Neue Config-Env-Vars IMMER in `BASE_ENV` (`test/helpers.js`) nachziehen,
  mit neutralem fail-closed Default — sonst leakt lokales `.env` in
  Spawn-Tests. Betroffen in dieser Kette: `RESERVE_RELEASE_GRACE_MS`,
  `FAKE_ORIGINATE`, `PROVISIONING_REDRIVE_MAX_AGE_MS`,
  `SHUTDOWN_DRAIN_TIMEOUT_MS`.
- pglite-Tests und Server-Spawn-Tests NIE in derselben Testdatei.
- Test-first: der neue Test der Phase ist erst rot und wird in DERSELBEN
  Phase gruen. **`npm test` ist nach jeder Phase KOMPLETT gruen** — diese
  Kette hat laut Plan (0.3) KEINE bewusst rot gelassenen Spaeter-Phase-Tests;
  sollte ein Workflow doch einen dokumentiert-erwarteten Rot-Test einer
  spaeteren Phase hinterlassen wollen, ist das ein Abweichungs-Befund fuer
  den Report, kein Freibrief.

## Effizienz-Regeln (Loops gedeckelt, Wanduhr parallel)

1. **Self-Fix-Deckel (Konvergenz-Wache):** Der Review->Self-Fix-Loop jeder
   Phase laeuft, solange jede Runde messbaren Fortschritt zeigt. Nach
   **2 erfolglosen Fix-Runden** bricht der Workflow ab und eskaliert an den
   Lead, statt weiter zu iterieren. "Erfolglos" heisst praezise: derselbe
   S1/S2-Befund ueberlebt die Runde unveraendert, ODER das
   Verifikationskommando schlaegt mit demselben Fehler fehl. Zwei identische
   Runden bedeuten fast immer: das Problem liegt OBERHALB des Workflows
   (Plan-Luecke, widerspruechliche Review-Kriterien, echte Owner-Frage) —
   dann entscheidet der Lead (workflow.md Regel 7: provably blocked).
   Review-Befunde ausserhalb des Phasen-Scopes (Geschmack, Nachbar-Code)
   gehoeren als Notiz in den Report, NICHT in eine weitere Fix-Runde.
2. **Apparat an Phasengroesse anpassen:** S-Phasen (F3, F6, F8) sind
   Ein-Funktions-Aenderungen mit exakt benannten Dateien im Plan. Dualer
   Review bleibt (Money-Pfad), aber KEINE breite Exploration: der Workflow
   liest die im Plan genannten Dateien plus direkte Caller, nicht das Repo.
   Laeuft eine S-Phase auf M/L-Niveau (Tokens/Dauer), ist das ein
   Warnsignal und im Report zu begruenden.
3. **Unabhaengige Phasen parallel implementieren:** F1, F3, F4 und F8 haben
   keine Abhaengigkeiten untereinander — ihre Workflows duerfen parallel
   laufen (je eigener Worktree, KEIN git stash). NUR die Merges nach
   `master` bleiben strikt sequenziell in Plan-Reihenfolge. Ein
   Phasen-Branch, der auf Vorgaengern aufbaut (F2 auf F1; F5 auf F3+F4;
   F7 auf F4+F5; F10 auf F9; F12 auf F9+F10), startet erst, wenn seine
   Vorgaenger auf `master` sind. F9 ist zwar formal unabhaengig, fasst aber
   wie F2 `finishCall` an — NICHT parallel zu ausstehendem F2 starten
   (Merge-Auflage Plan 3.2). Bei Konflikten gilt: Merge-Reihenfolge schlaegt
   Parallelitaet (Phasen-Branch rebasen, nicht die Reihenfolge aendern).

## Ablauf pro Phase

1. Git-Stand pruefen (Args-Misfire-Abschnitt oben).
2. Per-run Workflow starten, Phase hart gepinnt. Auftrag des Workflows =
   der EXAKTE Phasen-Abschnitt aus `PLAN-LAUNCH-FIXES.md` (Inhalt, erwartetes
   Ergebnis, Verifikationskommando, Restrisiken) plus die defekt-spezifischen
   Design-Abschnitte (Kapitel 1/2/3) als Kontext. Merge-Auflagen aus dem Plan
   mitgeben (insbesondere F9: den OUT-05-`releaseReserve`-Aufruf in
   `finishCall` NICHT entfernen/verschieben).
3. Der Workflow schreibt eine **Report-Datei pro Phase**
   (`tasks/report-<phase>.md`), der Lead liest NUR den Report.
4. Verifikation im Lead: das Verifikationskommando der Phase aus dem Plan
   ausfuehren (Output lesen) — erst bei Gruen weiter.
5. Merge nach `master` (Koordination oben). Der PLAN-SECURITY.md-Eintrag der
   Phase (Plan Abschnitt 6: OUT-05 nach F2, PROV-01 nach F5 ergaenzt F6/F7,
   A6 nach F12) gehoert zur jeweiligen Phase, nicht ans Ketten-Ende.
6. `tasks/todo.md` fortschreiben (erwartetes Ergebnis + Verifikation +
   beobachteter Output je Phase — workflow.md Regel 7).

## Sicherheits-Rahmen

- `CLAUDE.md` gilt vollstaendig; Absolute Regel 1 (Safety-/Budget-Gates,
  Schnittmenge, fail-closed, Max-Dauer, Signaturpruefung) wird in KEINER
  Phase aufgeweicht — die Plan-Kapitel 1.4/2.4/3.4 sind der Massstab.
- Keine echten Anrufe, kein Prod, kein Render/Stripe/Telnyx-Zugriff.
- Offene Owner-Fragen (Plan Abschnitt 7) NICHT selbst entscheiden. Die
  Code-Defaults sind bewusst fail-closed gewaehlt
  (`PROVISIONING_REDRIVE_MAX_AGE_MS=0` = Observe-Only,
  `RESERVE_RELEASE_GRACE_MS=15000`, `SHUTDOWN_DRAIN_TIMEOUT_MS=8000`) —
  implementieren wie geplant, Scharfschaltung/Zielwerte bleiben Owner-Sache.

## Abnahme (nicht Teil der Merge-Kette)

Der DEPLOY-04-Drill (Plan, Ende Abschnitt 4: Deploy waehrend aktivem
Test-Call, Call laeuft weiter, Cap greift, Minuten genau einmal gebucht)
passiert separat nach Owner-Freigabe — er braucht Deploy/Staging und ist
damit nicht autonom (workflow.md Regel 7: parken und flaggen).

## Abschluss-Report der Impl-Session

1. Je Phase: Branch, Merge-Commit, Verifikations-Output (Kurzform).
2. Abweichungen vom Plan (falls ein Review/Workflow etwas erzwungen hat).
3. Stand Merge-Koordination (was ist auf `master`, was wartet).
4. Erinnerung an die offenen Owner-Fragen (Plan Abschnitt 7) + Hinweis,
   dass NICHTS gepusht wurde.
