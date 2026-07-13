# NEXT-SESSION: Fix-Strategie vor Launch (OUT-05, PROV-01, A6)

> Start-Prompt fuer eine FRISCHE Session:
> "Lies NEXT-SESSION-LAUNCH-FIXES-STRATEGY.md und fuehre den Auftrag aus."

## Auftrag

Entwickle das verbindliche Strategie-Dokument **`PLAN-LAUNCH-FIXES.md`**
(Repo-Root) fuer die drei bekannten Launch-Blocker-Defekte aus dem
Pre-Launch-Audit (`PLAN-LAUNCH-TESTS.md`) und schneide daraus eine
Phasen-Kette fuer eine SEPARATE Ausfuehrungs-Session.

Diese Session ist eine reine STRATEGIE-Session: Analyse, Design,
Phasenschnitt, Prompts. **KEINE Implementierung, keine Aenderung an
Produkt- oder Testcode.**

## Owner-Entscheidungen (fixiert — NICHT neu verhandeln)

1. **ALLE drei Defekte werden VOR dem Launch gefixt — auch A6.**
   Deploy-Freeze ist nur Uebergangs-Auflage bis der A6-Fix live ist,
   kein Endzustand.
2. Die Umsetzung laeuft danach nach dem Lean-Template: duenner Lead
   (<100k Tokens, liest NIE selbst Code), pro Phase ein Workflow,
   Merge im Lead.

## Arbeitsverzeichnis: EIGENES Worktree (Pflicht, allererster Schritt)

Der Haupt-Checkout gehoert der parallel laufenden Test-Session (Branch
`test/launch-run-1`, eigener `tasks/todo.md`-Scratch). Deshalb arbeitet
diese Session VOLLSTAENDIG in einem eigenen Worktree:

- Als allererster Schritt Worktree anlegen und dorthin wechseln
  (EnterWorktree-Tool nutzen; manuell waere es
  `git worktree add ../vodafone-agent-strategy -b docs/launch-fixes-strategy master`).
- ALLE Dateien dieser Session (`PLAN-LAUNCH-FIXES.md`,
  `NEXT-SESSION-LAUNCH-FIXES-IMPL.md`, `tasks/todo.md`) entstehen IM
  Worktree und werden dort auf `docs/launch-fixes-strategy` committet.
- NICHT nach `master` mergen und nichts im Haupt-Checkout anfassen —
  `master` ist im Haupt-Checkout ausgecheckt und kann von hier aus gar
  nicht ausgecheckt werden (Git verbietet denselben Branch in zwei
  Worktrees). Der Merge passiert spaeter durch Owner oder Impl-Session.
- Im Abschluss-Report Branch-Name + Worktree-Pfad nennen.
- Erinnerung: KEIN `git stash` — refs/stash ist worktree-GETEILT.

## Die drei Defekte (Ausgangslage aus dem Audit)

1. **OUT-05 — Budget-/Reserve-Race bei parallelen place_call:**
   Die Kosten-Reserve landet nicht atomar im Budget-Bucket; N parallele
   place_call koennen gleichzeitig durch einen fast erschoepften Cap
   rutschen (pro-Tenant UND global). Fix-Kandidat laut Audit:
   `withStoreLock` um Check+Reserve — aber Design muss klaeren: beide
   Backends (json UND pg), Release-Pfad wenn der Call scheitert,
   Verhaeltnis Reserve vs. tatsaechliche Kostenbuchung.
   Referenz-Test (noch zu schreiben, gehoert der Fix-Kette):
   `test/outbound-budget-concurrency.test.js` — genau 1x 200, K-1x 402.

2. **PROV-01 — Provisioning-Crash-Recovery:**
   Stirbt der Prozess zwischen Onboard-Response und Queue-Drain, haengt
   die Nummer dauerhaft in `requested`; `POST /api/onboard/retry` gibt
   409/already_provisioned, weil occupiesCapacity `requested` als belegt
   zaehlt. Design muss klaeren: Wie wird ein staler `requested`-Zustand
   erkannt und repariert, Idempotenz (NIE Doppel-Nummernkauf = echtes
   Geld), Stripe-Hold-Storno, Sichtbarkeit fuer den Kunden.

3. **DEPLOY-04 / A6 — Deploy toetet laufende Calls:**
   Neue Instanz kennt den in-memory Call-State nicht; der
   Reconcile-Flush loescht sogar die pg-Row des aktiven Calls. Wurzelfix
   = Call-State ueberlebt Restart: Rehydrierung aus Postgres, Timer
   (u.a. Max-Dauer) neu armieren, Reconcile darf aktive Calls nicht
   loeschen, Webhooks fuer unbekannte callId re-attachen statt Hangup.
   Groesster der drei Umbauten, Abnahme = DEPLOY-04-Drill
   (Deploy waehrend aktivem Call, Call laeuft weiter).

Startpunkte fuer die Kartografen (unverifiziert — Reader pruefen selbst):
Outbound-Route + Gate-Kette in `src/server.js`, Budget/Usage in
`src/store/state-ops.js`, Reserve-Gate-Tests `test/outbound-reserve-gate.test.js`;
Provisioning: `src/onboarding.js`, `src/worker/provisioning.js`, `src/queue/`,
`test/bk3-auto-provision.test.js`; A6: Call-Map/Lifecycle in `src/server.js`,
Reconcile/Flush in `src/store/pg.js`, Timer-Logik (Max-Dauer), `src/boot-guard.js`.

## Methode: Dynamic Workflow (Empfehlung, so umsetzen)

Ein Workflow (Tool `Workflow`), NICHT lose Agent-Teams — deterministischer
Ablauf, StructuredOutput, Resume aus Cache bei Abbruch. Aufbau:

1. **Map** — 3 Sonnet-Reader (read-only), je einer pro Defekt: Wurzel
   im Code verifizieren (Dateipfade + Zeilen), betroffene Invarianten,
   vorhandene Testabdeckung. Tokeneffizient: Grep + gezielte Ausschnitte.
2. **Design** — 3 Opus-Designer, je einer pro Defekt, bekommen die
   jeweilige Karte: Fix-Design mit Alternativen + begruendeter
   Entscheidung, Test-first-Definition (welcher neue Test, erst rot,
   nach Fix gruen), Backend-Paritaet json+pg, Rollback-Plan.
3. **Pre-Mortem/Review** — Opus-Adversarial pro Design: "Der Fix ist
   live und hat etwas SCHLIMMERES kaputt gemacht als den Defekt — was?"
   (Deadlock durch neuen Lock, legitime Calls blockiert, Doppelkauf
   trotz Fix, Rehydrierung reanimiert Zombie-Calls, ...). Befunde
   fliessen ins Design zurueck (eine Revisionsrunde).
4. **Synthese** — Opus schreibt `PLAN-LAUNCH-FIXES.md`.

WICHTIGE LEHRE aus dem Audit-Lauf: StructuredOutput-Schemas KLEIN halten
(Arrays mit maxItems deckeln, Brevity-Anweisung in den Prompt, lange
Inhalte in die Dokument-Datei schreiben statt in den StructuredOutput)
und kritische Einzel-Agenten fail-soft wrappen (try/catch), sonst kann
ein abgeschnittener Tool-Call den ganzen Lauf killen.

## Anforderungen an PLAN-LAUNCH-FIXES.md

- Pro Defekt: verifizierte Wurzelanalyse (Dateipfade), Fix-Design,
  verworfene Alternativen mit Grund, betroffene Absolute Regeln
  (Gates/Disclosure/fail-closed NIEMALS aufweichen — Regel 1),
  Test-first-Definition, Rollback-Plan.
- **Phasenschnitt F1..Fn**: kleine, einzeln mergebare Phasen. Jede Phase
  traegt (workflow.md Regel 7): deterministisch pruefbares erwartetes
  Ergebnis + exakte Verifikationsmethode (Kommando). Reihenfolge und
  Abhaengigkeiten explizit. A6 wird vermutlich 2-4 Phasen (Reconcile-
  Schutz zuerst — kleinster Schritt, verhindert Datenverlust; dann
  Rehydrierung; dann Timer/Webhook-Re-Attach; Abnahme-Drill separat).
- Pre-Mortem-Ergebnis pro Phase (akzeptierte Restrisiken benannt).
- Empfohlene Reihenfolge der Gesamt-Kette (Vorschlag: OUT-05 zuerst =
  kleinster Money-Fix, dann PROV-01, dann A6-Phasen; im Design
  begruenden oder begruendet abweichen).

## Zweites Deliverable: Prompt fuer die Ausfuehrungs-Session

Am Ende **`NEXT-SESSION-LAUNCH-FIXES-IMPL.md`** schreiben (Lean-Lead-
Prompt), mit mindestens:

- Lead-Regeln: liest NIE Code, bleibt <100k, feuert pro Phase
  `phase-impl-lean` bzw. einen per-run Workflow, mergt selbst.
- **Phase IMMER im per-run Skript hart pinnen** und echten Git-Stand
  vor jedem Phasenstart selbst pruefen (bekannte args-Misfire-Falle:
  Skript kann sonst auf hardcodierten Fallback laufen = verbrannter Lauf).
- Branch-Schema `fix/<phase>`, Merge nach master im Lead, NICHTS pushen
  (weder origin noch upstream) ohne explizite Owner-Freigabe — Render
  deployt upstream, und bis der A6-Fix gemergt UND freigegeben ist gilt
  Deploy-Freeze bei aktivem Traffic.
- Merge-Koordination: Merges nach `master` passieren im Haupt-Checkout
  und NUR wenn der frei ist (parallele Test-Session beendet oder ihr
  Stand committet auf `test/launch-run-1`). Vorher pruefen:
  `git worktree list` + `git status` im Haupt-Checkout. Solange belegt:
  Phasen-Branches fertigstellen und Merge aufschieben.
- Test-Konventionen: node:test, `PORT=0` + `DATA_DIR`-Temp, neue
  Config-Env-Vars IMMER in BASE_ENV (`test/helpers.js`) nachziehen,
  pglite und Server-Spawn NIE in einer Testdatei mischen.
- KEIN `git stash`, solange isolation:worktree-Workflows laufen.
- Nach jeder Phase: `npm test` komplett gruen (ausser dokumentiert
  erwartete Rot-Tests spaeterer Phasen), Report-Datei pro Phase.

## Koordination mit paralleler Test-Session

- Parallel laeuft ggf. der Testlauf (`NEXT-SESSION-LAUNCH-TESTRUN.md`)
  auf Branch `test/launch-run-1` — der fasst NUR `test/` + Protokoll an.
- Die Tests fuer OUT-05 und PROV-06 gehoeren der FIX-Kette (test-first
  in der Impl-Session); der Testlauf ist entsprechend instruiert, sie
  NICHT zu schreiben.
- Diese Strategie-Session arbeitet am Code strikt read-only und schreibt
  nur: `PLAN-LAUNCH-FIXES.md`, `NEXT-SESSION-LAUNCH-FIXES-IMPL.md`,
  `tasks/todo.md`.

## Harte Regeln

- `CLAUDE.md` gilt vollstaendig (inkl. `.claude/refs/workflow.md`:
  `tasks/todo.md` mit erwartetem Ergebnis + Verifikation befuellen;
  `.claude/refs/clean-code.md` als Design-Massstab).
- Keine echten Anrufe, kein Prod, kein Render/Stripe/Telnyx, nichts pushen.
- Bei sicherheitsrelevanten Design-Entscheidungen pruefen, ob
  `PLAN-SECURITY.md` einen Eintrag braucht (im Strategie-Dok vermerken).
- Echte Owner-Entscheidungen (falls das Design welche aufdeckt) NICHT
  selbst treffen: als offene Frage in den Abschluss-Report.

## Abschluss-Report (letzte Nachricht der Session)

1. Kernentscheidung je Defekt in 3-5 Saetzen
2. Phasenliste mit grober Groessenschaetzung und Reihenfolge
3. Offene Owner-Fragen (nur echte Entscheidungen, keine Rueckversicherung)
4. Pfade: `PLAN-LAUNCH-FIXES.md`, `NEXT-SESSION-LAUNCH-FIXES-IMPL.md`
