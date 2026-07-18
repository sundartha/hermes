# Lessons — Fragility-Remediation-Kette

Lehren aus der Ausfuehrung von `PLAN-FRAGILITY-REMEDIATION.md` (eine `phase-lean`-Session
pro Phase). Neueste zuerst.

## L1 — Pausierter Workflow != toter Workflow (Ruhemodus-Kollision), P1
**Symptom:** Mac ging waehrend des P1-Lean-Workflows in den Ruhemodus. Nach dem Aufwachen
sah `TaskList` "No tasks" -> ich schloss "Workflow tot" und startete eine MANUELLE
Fix-/Review-Kette parallel. Der Workflow war aber nur PAUSIERT und lief nach dem Aufwachen
im Hintergrund WEITER -> zwei Tracks operierten gleichzeitig am selben Repo/denselben Refs,
kollidierten auf Branch-/Worktree-Namen (ich hatte `-fix1` geloescht, das der Live-Workflow
noch brauchte), und der Workflow endete BLOCKED, weil er seinen eigenen `-fix2` nicht fand.
**Warum:** `TaskList` zeigt im Lead-Prozess nach Wiederaufnahme nicht zuverlaessig einen
noch laufenden Hintergrund-Workflow; ein force-remove eines `locked` Worktrees (`pid ...`)
ist ein starkes Signal, dass der Prozess NOCH LEBT.
**How to apply:** Vor JEDER manuellen Aktion an Phasen-Branches pruefen, ob der Workflow
wirklich beendet ist (Completion-Notification gesehen? Worktree `locked` mit lebender pid?).
Bei Unterbrechung NICHT parallel manuell arbeiten — entweder auf die Notification warten oder
den Workflow sauber stoppen, DANN uebernehmen. Ein `locked`-Worktree niemals blind
`-f -f` entfernen, solange die pid leben koennte.

## L2 — Sonnet-Cyber-Safety-Classifier kippt bei Security-Review-Inhalt, P1
**Symptom:** Die r2-Agenten des Lean-Workflows scheiterten hart: `[P1-review-cleancode-r2]`
mit "Sonnet 5 has safety measures that flagged this message for a cybersecurity topic",
`[P1-fix-r2]` mit "violates our Usage Policy". Der Inhalt war eine voellig legitime
Clean-Code-Pruefung eines Stripe-Webhook-Race-Fixes (Money-Gate). Intermittent: dieselbe
Rolle lief in frueheren Runden auf Sonnet problemlos.
**Warum:** Security-nahe Formulierungen (Race, Exploit, Gate faelschlich offen, Angreifer-
Szenario) + Sonnet triggern gelegentlich den Real-Time-Cyber-Classifier — ein False Positive
fuer defensive Arbeit, aber er bricht den Request ab.
**How to apply:** (1) Fuer die adversariale Safety-/Clean-Code-Pruefung sicherheitslastiger
Phasen (Webhooks, Auth, Gates: P1/P2/P6/P7) im Zweifel **Opus** nehmen — der Cyber-Classifier
ist Sonnet-spezifisch, Opus lief auf identischem Inhalt sauber durch. (2) Bricht ein
Workflow-Agent an genau diesem Fehler ab, ist das KEIN Code-Blocker — den einzelnen Schritt
manuell mit Opus nachziehen, nicht den ganzen Run neu. (3) Reviewer-Prompts sachlich-
defensiv halten (Verifikation/Invariante), nicht in Exploit-Sprache.

## Nutzbare Wahrheit aus P1
- Der duale Gate ZAHLT SICH AUS: der Clean-Code-Reviewer fand einen empirisch reproduzierten
  Money-/Zugangs-Gate-Defekt (Sekunden-Gleichstand von `event.created`), der byte-identisch
  gruene Tests hatte — genau die "fix hier / kaputt dort"-Klasse, gegen die die Kette laeuft.
- Merge-Protokoll bewaehrt: Phasen branchen von `master`, Owner-WIP (hermes-animation-lab,
  mcp-server-info.js) wird von den Phasen NICHT beruehrt -> `git merge --no-ff` gegen den
  dirty Working-Tree ist konfliktfrei, kein `git stash` noetig (Memory `stash-clobbered-by-worktrees`).

## L3 — Agent-Tool ohne isolation:"worktree" laeuft im ECHTEN Working-Tree, P3
**Symptom:** Ein manuell via Agent-Tool gestarteter Fix-Agent (OHNE `isolation:"worktree"`)
landete im echten Nutzer-Working-Tree (master + Owner-WIP), erkannte das per `git status`
und legte defensiv selbst einen Worktree an. Nur weil der Agent vorsichtig war, wurde der
Owner-WIP nicht angetastet.
**How to apply:** Bei manuellen Agent-Tool-Aufrufen, die committen/branchen, IMMER
`isolation:"worktree"` setzen. NB: `isolation:worktree` legt den Worktree an einem
Default-Commit an (nicht am Zielbranch) -> der Review-Agent muss den Zielbranch SELBST
auschecken UND per `git log -1` verifizieren, dass er nicht auf einem stale Worktree-Branch
(bf0d529 o.ae.) sitzt (sonst laeuft `npm test` gegen Master-Era-Code, 2198 statt aktuell).
Beide Opus-Final-Reviews (P3, P7) fingen genau diesen Staleness-Fehler selbst ab.

## L4 — Opus-Plan auf risky-Phasen -> 0 Fix-Runden (Kosten-Nutzen), Gesamtlauf
**Beobachtung:** P6 (groesster/riskantester Refactor, Outbound-Gate-Kette) lief mit Opus-Plan
in EINEM Durchgang durch (0 Fix-Runden, ~0,85M Tokens). P3 (Sonnet-Plan, "preserves") brauchte
2 Fix-Runden + 1 manuelle (~1,7M). Die Modell-Politik "Opus nur am Gate" (Safety-Review Opus
alle, Plan Opus nur risky) hat sich als kosteneffizient bewaehrt: der teurere Plan auf den
komplexen Phasen SPART Fix-Runden. Kosten skalieren mit Review-Befunden, nicht mit Diff-Groesse.
**How to apply:** Fuer strukturell komplexe/risky Phasen den Plan-Agenten auf Opus pinnen;
fuer mechanische 1:1-Phasen (P4) reicht Sonnet-Plan (dort 0 Fix-Runden bei ~0,47M).

## Gesamtergebnis
Alle 7 Fragilitaets-Phasen gemergt (master ee296c3, 2269/0). Der duale adversariale Gate hat
in 4 von 7 Phasen echte, mit gruenen Tests getarnte Money-/Gate-/Observability-Defekte gefangen
(P1 Tie-Break, P2 Rundung, P3 P8-Obs, P5 toter config-Key) — die "fix hier/kaputt dort"-Klasse,
gegen die die Kette lief. Erfolgskriterium erreicht: eine Aenderung an Stripe/Config/einem Gate
bricht jetzt einen TEST statt lautlos einen entfernten Pfad.

## PLAN-POLISH-A (Note B->A, 20 Phasen, 2026-07-18) — Lehren

- **Postage-Stamp-`filesTouched` ist nur Runde 0.** Nach Fix-Runden spiegelt der Workflow-Return die
  URSPRUENGLICHE Impl, nicht die Fixes. IMMER den ECHTEN finalBranch-Diff pruefen
  (`git diff master..<finalBranch>`). PA-17: der web-auth.js-Fix (Runde 2) fehlte in filesTouched —
  haette man ihm vertraut, waere die entscheidende Migration unentdeckt geblieben.
- **grep-Gate: Flach-Config-Treffer sind fast immer Kommentare.** Reale Code-Zugriffe finden, indem man
  Kommentarzeilen filtert (`grep -vE ":[0-9]+:[[:space:]]*(//|\*|/\*)"`). Ueber PA-16/17/18/20 waren
  ausnahmslos ALLE Flach-Treffer Doku-Kommentare — der eigentliche Code war sauber migriert.
- **Migrations-Scope per Verzeichnis, nicht per Glob.** "scripts/*.mjs" (PA-19) uebersah scripts/*.js;
  erst der Flip-Vollstaendigkeitscheck (dot+bracket+destructuring ueber ganz scripts/) fing sie. Der
  Flip-grep ist das eigentliche Sicherheitsnetz, nicht die per-Phase-Scopes.
- **WIP-Kollisions-Merge OHNE stash:** Merge beruehrt eine Datei mit uncommitteter Owner-WIP ->
  Patch-Dance statt `git stash` (worktree-geteilt, gefaehrlich): `git diff -- <f> > p.patch;
  git checkout -- <f>; git merge; git apply --3way p.patch; git reset -- <f>` (unstaged wiederherstellen).
  Klappt sauber, wenn WIP- und Merge-Regionen disjunkt sind (vorher per Hunk-Header pruefen).
- **worktree-Pfade mit Leerzeichen:** `git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}'`
  (null-safe). Naives `awk '{print $1}'` schneidet am Leerzeichen ab und entfernt LAUTLOS nichts.
- **Fail-closed-Guard-Typcheck:** `typeof x !== "number"` faengt NICHT NaN/Infinity (beide typeof "number").
  Fuer numerische Gates `!Number.isFinite(x)` -> throw (PA-10, vom Auditor nachgehaertet).
- **BLOCKED != Phase aufgeben.** PA-3 erreichte maxFixRounds mit KORREKTEM S1-Fix + einem Rest-S2. Ein
  gezielter Fix+Review-Mini-Workflow auf dem bestehenden Branch loeste den Rest, statt eine
  dependency-kritische S1-Phase (PA-6/16/20 haengen dran) zu verwerfen. "falscher Fix" (verwerfen) von
  "guter Fix + Rest-Cleanup" (fertigstellen) unterscheiden.
- **PM-1 Getter-statt-Kopie strahlt in die Tests aus.** Sobald Produktion `config.<ns>.<key>` liest,
  muss JEDER Test, der ein Fake-config baut, die Namespace-Getter ebenfalls exponieren. Loesung:
  attach-Helfer aus config.js exportieren (single source) und Test-Overrides darueber routen
  (withConfigNamespaces/makeConfigOverrides). Wert-Kopie-Configs laesen sonst still stale Werte.
- **Lead-Verifikation je Phase im Wegwerf-Worktree** (nie master mit rot-Merge verschmutzen, v.a. bei
  Owner-WIP wo `reset --hard` verboten ist): Branch-Suite gruen -> erst dann Merge. S1: rot-vor-Fix
  selbst nachstellen; RLS-Test nur unter NOBYPASSRLS beweiskraeftig (Superuser umgeht FORCE RLS).

---


## P3 (Peinlichkeits-Defekte: Cap/Reprompt/Inbound)

- **P3.3 kehrt eine bewusste Design-Entscheidung um.** Inbound-Minuten sehen den
  Budget-Guard nicht (`reconcileOutboundVoiceBudget` steigt bei Inbound aus) - der
  einzige Deckel ist `MAX_CALL_DURATION_S`. `MAX_EMPTY_TURNS` darf deshalb nie ueber 3
  gedreht werden.
