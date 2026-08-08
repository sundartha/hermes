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

---

## Live-Forensik (2026-07-22, Kosten-Endspiel-Verifikation)

- **Eine auffaellige Betriebszahl NICHT durch die naechstliegende Env-Variable erklaeren.**
  `anfragen=16` statt erwarteter 6-14 wurde spontan `COST_TRUING_MAX_ATTEMPTS=20`
  zugeschrieben - plausibel, aber falsch (der Wert stand auf 5). Der Umfang haengt an
  `poolSinceFor()`: dem Minimum des `endedAt` ueber ALLE Kandidaten. Regel: bevor eine Zahl
  einer Konfiguration zugeschrieben wird, die Stelle lesen, die sie erzeugt. Eine plausible
  Erklaerung ist keine gemessene.
- **Deploy-Checklisten in `tasks/` sind Momentaufnahmen, kein Live-Zustand.** Beide
  Checklisten sagten "nicht deployed", live lief der volle Stand. EINZIGE Quelle ist der
  `[boot] deployed commit=<sha>`-Banner im Render-Log.
- **Zwei aufeinanderfolgende Sweeps sagen mehr als einer.** Der Befund (Dauer-Leerlauf) wurde
  erst sichtbar, als der zweite Sweep dieselbe `uebersprungen=`-Zahl bei geschrumpfter
  Kandidatenmenge zeigte. Bei periodischen Jobs immer >=2 Laeufe vergleichen.
- **Call-IDs sind Zeitstempel:** `call_` + `Date.now().toString(36)` in den ersten 8 Zeichen.
  Damit laesst sich ein bestimmter Anruf ohne DB-Zugriff in Sweep-Logs wiederfinden.

---

## Gate-Triage (2026-07-27, PLAN-GATES.md)

- **Ein roter SOLL-Test ist eine Behauptung, kein Beweis.** 20 Triage-Agenten haben alle 36
  roten Launch-Gates als `GUELTIG` klassifiziert - mit korrekten Belegen am Code. Zwei davon
  (GAP-23) waren trotzdem falsch: der Test setzt in seinem eigenen Setup
  `maxNumbersPerTenant: 9` und beklagt dann das Fehlen des Schutzes, den die Produktion mit
  `MAX_NUMBERS_PER_TENANT=1` laengst hat. **Regel: bei einem SOLL-Test zuerst pruefen, ob sein
  Setup eine Konfiguration herstellt, die es in Produktion nicht gibt.** Ein Agent, der nur
  Test und Zielcode liest, kann das strukturell nicht sehen.
- **Die Domaenenfrage des Owners schlaegt die Codeanalyse.** "Ein User kann doch gar keine
  zweite Nummer kaufen" hat in einem Satz zwei Phasen erledigt, die drei Agenten-Belege
  gestuetzt hatten. Bei Gates, die eine neue Sperre fordern, IMMER zuerst fragen: existiert
  die Bedrohung im Produkt ueberhaupt?
- **Nicht vom lokalen `.env`/Blueprint auf live schliessen.** Behauptung "Kunde ohne
  Tabelleneintrag bekommt eine deutsche Nummer" war falsch: `FORCE_NUMBER_COUNTRY=US`
  (`render.yaml:176`) sticht `PROVISIONING_COUNTRY=DE` aus - live bekommt JEDER eine
  US-Nummer. Ein Override, der vor der Tabelle greift, macht die ganze Tabellen-Phase live
  wirkungslos.
- **"Nichts ist hartkodiert" gilt achsenweise, nicht global.** Anruf-Kosten werden live bei
  Telnyx abgefragt (Cost-Truing), der Nummern-Hold ist eine Pauschale - und
  `searchNumbers` wirft das mitgelieferte `cost_information` weg. Vor einer Aussage ueber
  "wie das Produkt Preise behandelt" die konkrete Achse pruefen.

---

## Direkter Edit statt Phase (2026-07-29, Budget-Achsen-Divergenz)

- **"Phase" im Owner-Wort heisst Phase, nicht "jetzt sofort tippen".** Auf die Antwort
  "Phase von mir aus jetzt" wurde direkt auf master in `state-ops.js` editiert - am
  Lean-Template, am Worktree und am dualen Review vorbei. CLAUDE.md stuft alles, was
  Budget-Gates beruehrt, ausdruecklich als nicht-trivial ein: Plan Mode + Smoke-Test sind
  Pflicht, nicht Ermessen. **Regel: bei Gate-/Geld-/Auth-Code nie direkt editieren, auch
  wenn der Fix drei Zeilen gross ist.**
- **`.claude/refs/clean-code.md` VOR dem Edit lesen, nicht danach.** Es wurde erst nach der
  Ruecknahme gelesen. Der geschriebene Kommentar verstiess dann prompt gegen **C1**
  (Aenderungshistorie im Quelltext: "Vorher las diese Funktion...", gemessene Live-Werte) -
  genau das gehoert in die Commit-Message, nicht in den Code.
- **Kommentardichte ist hier selbst der Tech-Debt, kein Vorbild.** `state-ops.js` hat 3122
  Zeilen bei 1429 Kommentar- zu 1486 Codezeilen (fast 1:1) und ist die groesste Datei im
  `src/`. Sich beim Schreiben am Bestand zu orientieren (G24, Konventionen) reproduziert
  hier einen Missstand. Neue Kommentare nur, wo eine Invariante sonst unsichtbar waere.
- **Der Owner-Satz "das sollte es doch gar nicht mehr geben" ist eine Messanweisung.** Die
  Uebergabe hatte daraus eine Perioden-Anker-Hypothese gebaut; die Render-Audit-Zeile
  (`grund=reserve_ueber_rest`, `tenant=t_user_...`) zeigte in einer Abfrage, dass sogar der
  untersuchte Tenant der falsche war. **Runtime-Output vor Code-Rekonstruktion** (CLAUDE.md
  Regel 7) haette die ganze Hypothese gespart.

---

## Der Clean-Code-Auditor sieht nur den Diff, nicht das Repo (2026-08-03, KV-M0)

- **Ein Auditor, der `git diff BASE..BRANCH` liest, kann nicht sehen, was in BASE steht.**
  KV-M0 las `config.billing.flushEpochIso`; das Feld kam ueber die Basis herein (KV-P0-Merge,
  `config.js:524` + Namespace-Whitelist `:1349`). Im Diff `master..branch` kommt `config.js`
  gar nicht vor - der Auditor schloss daraus "existiert nirgends" und meldete einen S1
  ("garantierter Boot-Crash in jeder Umgebung"), inklusive einer **behaupteten empirischen
  Verifikation**, die nicht stattgefunden haben kann: die sechs betroffenen Tests waren
  gruen, die volle Suite 3803/3803.
- **Konsequenz fuer den Lead:** ein Blocker ist eine Behauptung, genau wie ein roter Test.
  Bei einem "Symbol X existiert nicht"-Blocker zuerst `git grep X <branch> -- <datei>` und
  den Test selbst laufen lassen, bevor eine Fix-Runde gestartet wird. Der Fix-Agent hat hier
  richtig gehandelt: er hat die Reproduktion versucht, sie schlug fehl, und er hat NICHTS
  committet - dadurch fiel das Gate auf BLOCKED, obwohl der Safety-Reviewer unabhaengig
  freigegeben hatte.
- **Konsequenz fuer kuenftige Skripte:** dem Clean-Code-Auditor auftragen, vor einem
  "existiert nicht"-Befund am ausgecheckten Branch zu grepen statt nur im Diff zu lesen.
- **Nebenbefund, ungefixt:** `test/auth-p9a-cache-headers.test.js` haengt oder crasht
  (`hookFailed`, `undefined.stop()`), sobald `--test-name-pattern` (also `npm run test:gates`)
  keinen seiner Testnamen matcht - file-scope `before()/after()` mit geteiltem
  `startServer()`-Spawn ohne `if (srv)`-Guard. Macht `test:gates` praktisch nicht
  end-to-end durchlaufbar. Eigene kleine Fix-Phase wert.

---

## Grosse Inhalte gehoeren in eine Datei, nicht ins StructuredOutput-Schema (2026-08-03, KV-P1)

- **Ein Schema-Feld, das eine Markdown-Tabelle verlangt, toetet den Lauf.** Das KV-P1-Skript
  forderte `costMapTable`, `triggerTable` und weitere Freitextfelder. Der Impl-Agent hatte
  die Phase fertig implementiert UND committet - und starb danach zweimal an
  `InputValidationError: StructuredOutput was called with input that could not be parsed as
  JSON` (16 KB Nutzlast). Der Workflow brach ab, bevor irgendein Review lief.
- **Der Bericht ist dann verloren, die Arbeit nicht.** Das Transcript speichert je Tool-Aufruf
  nur die ersten 2048 Zeichen - die Nutzlast laesst sich NICHT rekonstruieren. Der Commit auf
  dem Branch existiert aber. Richtiges Vorgehen: Branch pruefen (`git log master..<branch>`),
  und ein Wiederaufnahme-Skript schreiben, das Plan und Implementierung UEBERSPRINGT und bei
  der Verifikation einsteigt. Nicht neu implementieren lassen.
- **Regel fuer jedes per-run-Skript:** jedes Schema-Textfeld hoechstens ~400 Zeichen, keine
  Tabellen, keine Code-Bloecke. Umfangreiches schreibt der Agent in eine DATEI, das Feld
  traegt nur den Pfad. Die Regel gehoert als eigener Absatz in JEDEN Agenten-Prompt, nicht
  nur in die Feldbeschreibung.
- **Nebenbefund:** ein Agent kann ausserhalb seines Worktrees nicht schreiben. Wer eine Datei
  im Haupt-Repo erwartet, bekommt sie im Worktree - und der wird spaeter aufgeraeumt. Den
  Report-Agenten deshalb ausdruecklich anweisen, den Worktree-Pfad zu suchen, wenn die Datei
  im Haupt-Repo fehlt.

## Ein Riegel, der Dateien zaehlt, faengt den wahrscheinlichsten Fall nicht (2026-08-03, KV-P1b)

- Der Ein-Aufrufer-Riegel gegen Doppelbelastung pruefte, in WELCHEN DATEIEN
  `store.addVoiceUsageCostCents(` vorkommt, und verglich die Dateiliste. Ein zweiter Aufruf
  **in derselben Datei** aendert die Liste nicht - und genau dort liegt der bestehende
  Aufruf. Der Riegel deckte also alles ab ausser dem wahrscheinlichsten Fall.
- **Regel:** ein Textmuster-Riegel zaehlt Vorkommen, nicht Dateien. Und die Mutationsprobe
  muss BEIDE Faelle fahren (gleiche Datei / andere Datei) - der erste Lauf hatte nur den
  zweiten geprueft und den Riegel deshalb faelschlich fuer wirksam gehalten.

## Erst die Anbieter-Doku, dann die Diagnose (2026-08-04, GQ-Welle 0)

- **Zweimal in einer Stunde eine plausible Wurzel fuer B-1 behauptet, zweimal an einer
  Messung gestorben.** Erst "Endpointing steht auf 0,8 s" - der Wert existiert live gar
  nicht (`start_speaking_plan: null`, der Provisioner-Lauf hat ihn nie gesetzt). Dann
  "`eager_eot_threshold` wurde aktiv gesetzt, um Latenz zu sparen" - 0.8 ist der
  Telnyx-**Default**, und dieselbe Doku sagt: `eager_eot_threshold == eot_threshold`
  deaktiviert den eager-Modus bereits.
- **Der zweite Fehlschluss war teurer, weil schon gehandelt wurde:** die Live-Config war
  bereits gepatcht, als die Doku die Begruendung widerlegte. Ein Snapshot lag vor, der
  Schaden blieb null - aber nur wegen des Snapshots, nicht wegen der Vorsicht.
- **Regel:** ein Konfigurationswert ist erst dann ein Befund, wenn seine **Bedeutung** aus
  der Anbieter-Doku belegt ist - nicht schon, wenn er auffaellig aussieht. "Der Wert ist
  gesetzt" und "der Wert bewirkt X" sind zwei Behauptungen; die zweite braucht eine Quelle.
  Insbesondere: **ein Default sieht aus wie eine Entscheidung.** Vor jeder "jemand hat das
  absichtlich gesetzt"-Erzaehlung den Default nachschlagen.
- **Was richtig lief:** vor dem Eingriff `GET` auf die Live-Config und Snapshot nach
  `data/evidence/telnyx-config/` gesichert. Das ist der Grund, warum die widerlegte
  Diagnose folgenlos blieb. Bei Provider-Konfiguration IMMER erst lesen und sichern.

## Die Kartierung raet nicht - der Lead misst nach (2026-08-04, GQ-Welle 0)

- Drei von zwoelf Karten trugen eine Erklaerung, die die Nachmessung widerlegt hat. Alle
  drei Agenten hatten sauber gearbeitet und ihre Annahme als Bedingung formuliert
  ("falls der Testanruf inbound war", "Anruf an ein Fremdziel faellt strukturell durch").
  Die Bedingung war jeweils in einer SQL-Abfrage oder einer Owner-Frage pruefbar.
- **B-4:** Der Beleg-Anruf ist outbound - das angebotene Inbound-Gate greift dort nicht.
- **O-10:** Der Owner hatte nur sich selbst angerufen; die Wurzel war die leere
  `private_number`, eine Zeile ueber der geprueften Bedingung.
- **Regel:** ein Kartierungs-Schema braucht ein Feld wie `wurzel_belegt` mit dem Wert
  "hypothese-messbar" - und der Lead muss jede so markierte Karte VOR der Phasenplanung
  gegenmessen. Eine Phase auf einer ungeprueften Bedingung zu bauen kostet die ganze Phase.

## Ein Skill-Aufruf mit Fliesstext-args stirbt fail-closed (2026-08-04, GQ-S1)

- `Workflow({name: "phase-impl-lean", args: "Phase GQ-S1, Spec: ..."})` bricht mit
  `args.phaseId fehlt -> fail-closed Abbruch` ab, bevor ein Agent laeuft. Das Skript
  erwartet ein **Objekt** (`{phaseId, branch, baseBranch, planDoc, specFile, maxFixRounds}`),
  auch wenn die Skill-Beschreibung einen Fliesstext-Aufruf zeigt.
- **Das ist der gute Fall:** kein Default-Phase-Bau, kein stiller Misfire an der falschen
  Phase, null verbrauchte Token. Genau so soll ein Args-Vertrag scheitern.

## Der Lead selbst hat die Stale-Base-Regel gebrochen (2026-08-04, GQ-P2)

- Waehrend GQ-P2 im Worktree lief, habe ich einen **Doku-Commit nach `master`** gesetzt
  (Messergebnisse der Testanrufe). Ergebnis: `git merge-base --is-ancestor master <branch>`
  schlug fehl, und `git diff --stat master..<branch>` haette meine eigenen Doku-Aenderungen
  als **Loeschungen** ausgewiesen.
- Die Regel stand woertlich im Kickoff und ich hatte sie im selben Gespraech noch zitiert.
  Sie gilt fuer **jeden** `master`-Commit, auch fuer reine Dokumentation — der Blocker
  entsteht aus dem Divergieren, nicht aus dem Inhalt.
- **Rettung ohne Rebase:** `git diff master...<branch>` (DREI Punkte) vergleicht gegen den
  gemeinsamen Vorfahren und zeigt genau die Branch-Aenderungen. Danach `git merge --no-ff`
  wie ueblich — git loest das ueber den merge-base, solange die Dateimengen disjunkt sind.
- **Regel fuer den Lead:** Notizen und Kettenstand waehrend eines laufenden Laufs in der
  Datei sammeln, aber **erst nach dem Merge der Phase committen**. Ein Lauf ist erst zu Ende,
  wenn sein Branch gemergt ist — nicht, wenn die Benachrichtigung eintrifft.

## Der Anstoss kam vom Provider, nicht vom Anrufer (2026-08-04, GQ-P5)

- **Der schlimmste Defekt des Gespraechs war kein Modell-Problem.** Sechsmal "ich warte
  still" sah aus wie eine Prompt-Schwaeche. Tatsaechlich stoesst Telnyx nach
  `user_idle_reply_secs` Sekunden Stille selbst einen Turn an, und der Shim las nur die
  letzte `user`-Rolle - also die ALTE Aeusserung, die er dann erneut beantwortete.
  Der Gegenbeleg stand woertlich im Transkript: *"Ich hab nix gesagt, Digger."*
- **Ein Feld im Log hat es entschieden, nicht eine Hypothese.** `turn_probe` trug
  `lastRole` bereits seit GQ-S1 - niemand hatte es gelesen. Sechs `same`-Turns trugen
  durchgehend `lastRole: "system"`. **Wer eine Sonde baut, muss ihre Felder auch auswerten;
  eine ungelesene Sonde ist so gut wie keine.**
- **Beinahe-Fehler, teuer:** die erste Zuschnitt-Idee war "waehrend einer laufenden
  Rueckfrage nicht antworten". Nachgerechnet an den Zeitstempeln deckt das **1 von 6**
  Faellen ab - die Rueckfrage war bei den uebrigen fuenf laengst beantwortet. Die Regel aus
  dem Kickoff (erst die Zahl, dann die Phase) fing das ab, **bevor** Code entstand.
- **Reihenfolge schlaegt Riegel.** Der naheliegende Platz (ganz vorn, vor allen Gates) waere
  falsch gewesen: der Anstoss ist ein Lebenszeichen. Vor `observeTurn` platziert, haette der
  Dead-Air-Notaus genau waehrend einer Rueckfrage aufgelegt, in der der Anrufer absichtlich
  schweigt. Ein Riegel braucht immer die Frage: *was haengt sonst noch an diesem Signal?*
- **Zwei Kickoff-Befunde waren falsch und wurden am Log widerlegt:** B-5 ("`end_call` feuert
  nie") - er feuerte in turnSeq 19. N-3 ("zweiter Consult kommt nicht zustande") - kein
  Defekt, sondern `MAX_IN_CALL_CONSULTS_PER_CALL = 1`. **Auch ein Befundkatalog ist eine
  Behauptung, kein Messwert.**

## Ein Join ueber ein modell-formuliertes Feld ist kein Join (2026-08-06, GQ-Fragilitaet)

- Das Workflow-Skript hat Befund und Skeptiker-Urteil ueber den **Titel** gejoint:
  `r.urteile.find(u => u.titel === f.titel)`. Die Skeptiker haben ihre Titel mit
  `"BEFUND 1: "` praefixiert - fachlich voellig in Ordnung, das Schema verlangte nur
  "ein String". Sechs von acht Urteilen fielen aus dem Join.
- **Der Fehler ist still und faellt in die falsche Richtung:** ein nicht gefundenes Urteil
  wurde als "kein Urteil" gewertet, also als *nicht bestaetigt*. Der Lauf meldete
  "2 bestaetigt, 6 gefallen"; tatsaechlich waren es **7 bestaetigt, 1 widerlegt**. Ein
  Orchestrierungs-Bug hat fuenf belegte Befunde unsichtbar gemacht.
- **Regel:** Agenten-Ausgaben werden ueber einen **vom Skript vergebenen** Schluessel
  verbunden (Index oder eine ID, die im Prompt woertlich mitgegeben und im Schema als
  `enum` gepinnt wird) - NIE ueber ein Feld, das das Modell selbst formuliert. Wenn ein
  Join fachlich noetig ist, gehoert die Trefferquote in ein `log()`:
  `log(\`${matched}/${expected} Urteile zugeordnet\`)` haette es sofort gezeigt.
- **Zweite Lehre, teurer:** ich habe die Skript-Zahl im ersten Zug geglaubt. Die
  Diagnose-Zeile des Werkzeugs sagt woertlich, man solle vor der Interpretation eines
  unerwarteten Ergebnisses `journal.jsonl` lesen. Der Synthese-Agent hat den Widerspruch
  uebrigens selbst bemerkt ("alle 6 trugen kein Urteil mit leerem Leser-Feld, sind also
  unbewertet, nicht widerlegt") - der Agent war misstrauischer als sein Lead.

## Ein gebuendelter Schreibpfad kann den Defekt vor dem Test verstecken (2026-08-06, GQ-H1-a)

- Die Lehre "der Test muss den Defekt reproduzieren" war bekannt — und hat trotzdem fast
  nicht gegriffen. Sieben frische pg-Tests waren gruen **und blieben gruen, als ich den Fix
  probeweise wieder ausbaute**. Sie haben nichts gemessen.
- **Ursache:** `save()` ist im pg-Store fire-and-forget und wird **zusammengefasst**. Die
  Tests schrieben, loeschten und lasen in einem Zug; es lief genau EIN Flush ganz am Ende.
  Der Zwischenstand, an dem der Defekt haengt (die verworfene Zeile ist bereits persistiert),
  erreichte die DB nie. Live liegen zwischen dem Schreiben der Antwort und ihrem Verwerfen
  Sekunden und mindestens ein Flush.
- **Regel:** Bei asynchroner/gebuendelter Persistenz muss der Test den **Zeitpunkt**
  nachstellen, nicht nur die Reihenfolge der Aufrufe. Ein `await store.save()` an der Stelle,
  an der live ein Flush laege, ist Teil des Aufbaus — nicht Kosmetik.
- **Und die Gegenprobe bleibt Pflicht, auch wenn man sie schon kennt:** Fix ausbauen, Test
  laufen lassen, Rot sehen, Fix zurueck. Erst dann ist ein gruener Test ein Beleg. Hier
  brachte sie zusaetzlich einen echten Design-Fehler ans Licht — der erste Fix (Zeilen
  ZAEHLEN) war falsch, weil Schrumpfen-dann-Wachsen ohne Flush dazwischen die Zahl zufaellig
  wieder stimmen laesst, waehrend Zeile i und Segment i auseinanderlaufen. Der Abgleich muss
  ueber den INHALT gehen.

## Beim Aufraeumen eines Sonden-Signals zuerst fragen, wer das Signal sonst noch erzeugt (2026-08-06, GQ-H1-a)

- Der Riegel haengt an "Telnyx' Nachrichtenliste ist nicht gewachsen". Das ist ein sauberer
  Anbieter-Beleg — hat aber einen **zweiten Erzeuger**: die doppelte Zustellung desselben
  Requests. Dort ist die Liste ebenfalls unveraendert, die Antwort des Vorgaengers aber
  gesprochen. Der Riegel haette genau dort eine echte Aeusserung geloescht.
- Bitter: die doppelte Zustellung ist **der Befund, fuer den diese Sonde ueberhaupt gebaut
  wurde** (`prevRelation "same"`, turnSeq 1 und 2 eine Millisekunde auseinander, 04.08.).
  Das Gegenbeispiel stand im Kopfkommentar der Datei, die ich gerade aenderte.
- **Regel:** Bevor ein beobachtetes Signal eine Entscheidung traegt, die Faelle aufzaehlen,
  in denen dasselbe Signal aus einem ANDEREN Grund entsteht — und den Ausschluss so bauen,
  dass er die Bedingung nur strenger macht (er kann dann keine neuen Fehlalarme erzeugen,
  nur welche verhindern).
- Gefunden hat es nicht der Test, sondern das kritische Gegenlesen des eigenen Diffs vor dem
  Commit. Der Test kam danach — und ist ohne den Ausschluss rot.

## Ein ignorierter Parameter ist unsichtbar, bis man Fingerabdruecke vergleicht (2026-08-06, B-7)

- Die Replay-Bank schickte dieselbe Aufnahme durch `flux`, `nova-2` und `nova-3` und bekam
  dreimal **12,9 %** WER. Ich hatte den Parameter `transcription_model` gesetzt — er heisst
  aber `model`. Der falsche Name wird still ignoriert, alle drei Laeufe liefen auf demselben
  Default. Eine Minute lang stand da eine plausible, vollstaendig falsche Aussage
  ("alle Deepgram-Modelle sind gleich gut, das Problem liegt woanders").
- **Aufgefallen ist es nur am SHA der Ausgabe.** Drei angeblich verschiedene Modelle lieferten
  byte-identischen Text — bei bloss gleicher *Prozentzahl* haette ich es fuer Zufall gehalten.
- **Regel:** Wenn ein Lauf eine Variable variieren SOLL, muss die Auswertung beweisen, dass
  sie variiert hat. Fingerabdruck (Hash) je Ergebnis mitloggen und auf Kollisionen pruefen.
  Zwei identische Ergebnisse bei verschiedener Eingabe sind ein **Fehleralarm**, kein Befund.
- Verwandt, gleiche Wurzel: die Zusatzparameter `eot_threshold`/`eager_eot_threshold` an
  dieselbe Schnittstelle aenderten nichts. Ich habe daraus NICHT "die Schwellen wirken nicht"
  geschlossen — bei einer Schnittstelle, die unbekannte Parameter still schluckt, ist
  "kein Unterschied" kein Messergebnis, sondern eine offene Frage.

## Ein Selbsttest, der denselben Parser benutzt wie der Code, prueft nichts (2026-08-06, B-7)

- `scripts/stt-wer.mjs` hatte eine eingebaute Plausibilitaetspruefung: Aufnahme-Start und
  Konversations-Start duerfen nicht weiter als 3 s auseinanderliegen. Sie meldete **0,47 s** —
  waehrend die Turn-Tabelle Fenster von **7207 s** auswarf.
- **Ursache:** Telnyx liefert `created_at` bei Aufnahmen OHNE Zonenanteil
  (`2026-08-06T09:41:32`), bei Nachrichten MIT `Z`. `Date.parse` liest den ersten als
  **Ortszeit** — in Europa/Berlin 2 h daneben. Die Anker-Pruefung verglich zwei gleich falsch
  geparste Werte und war deshalb blind fuer genau den Fehler, gegen den sie gebaut war.
- **Regel:** Eine Konsistenzpruefung muss ihre beiden Seiten aus **unterschiedlichen** Quellen
  ziehen, sonst prueft sie nur sich selbst. Und: fremde Zeitstempel laufen durch EINE
  Parse-Stelle, die einen fehlenden Zonenanteil ausdruecklich behandelt — nie durch das
  blosse `Date.parse` an mehreren Stellen.
- Gefunden hat es nicht die Pruefung, sondern eine Zahl in der Ausgabe, die offensichtlich
  nicht sein konnte (7207 s in einem 75-s-Anruf). **Ausgaben, deren Groessenordnung ein Mensch
  sofort beurteilen kann, sind mehr wert als eine stille Zusicherung.**

## Das Gefuehlte messbar machen war der ganze Fortschritt (2026-08-06, B-7)

- Fuenf Phasen und drei Prompt-Runden hatten an der Gespraechsqualitaet nichts Hoerbares
  bewirkt. Was B-7 in einer Sitzung geloest hat, war kein besserer Fix, sondern eine
  **Messlatte**: Telnyx zeichnet dual-channel auf, also laesst sich der Kanal der Gegenstelle
  isolieren, von einem zweiten Erkenner abschreiben und als Wortfehlerrate gegen das stellen,
  was der Anbieter verstanden hat.
- **Die Kontrolle macht die Zahl erst belastbar:** der Agentenkanal hat eine ECHTE Ground
  Truth (wir wissen aus dem Protokoll, was der Agent gesagt hat). Dass die Referenz dort
  94-96 % zurueckholt, ist der Beweis, dass 45,7 % auf dem anderen Kanal nicht der Messung
  anzulasten sind. Eine Referenz ohne Kontrolle ist eine zweite Meinung, keine Messung.
- **Und sie hat eine eigene Streuung:** zwei Laeufe derselben Aufnahme ergaben 45,7 % und
  47,1 %. Ein Unterschied unter ~2 Punkten ist damit kein Ergebnis.
- **Regel fuer die naechste "der Agent versteht mich nicht"-Frage:** zuerst fragen, welche
  Aufzeichnung der Anbieter ohnehin schon anlegt — und ob sich daraus ein Vorher-Wert bauen
  laesst, BEVOR jemand eine Konfiguration anfasst. Ein Testanruf kostet einen Menschen,
  ein Messlauf kostet Sekunden.

## Eine Probe, die bei null Befunden schweigt, ist nicht von einer kaputten zu unterscheiden (2026-08-07, STT-A1)

- `scripts/telnyx-stt-drift.mjs` lief gegen die echte API, endete mit **Exit 0 und komplett
  leerer Ausgabe**. Das las sich wie "alles in Ordnung". Tatsaechlich hatte die Probe ihre
  halbe Aufgabe nie erledigt: die Telnyx-Einstellungen liegen unter `transcription.settings`,
  die Schleife iterierte aber `Object.keys(transcription)` — dort stehen nur
  `model/language/api_key_ref/region/settings`. **Kein Schluessel konnte je treffen.**
- Am Live-Objekt standen zu diesem Zeitpunkt `eot_threshold: 0.9` und `eot_timeout_ms: 5000`
  flux-only an einem nova-3-Modell. Die Probe war genau dafuer gebaut und hat es uebersehen.
- **Der Test hat es nicht gefangen, weil seine Fixtures dieselbe falsche Verschachtelung
  benutzten wie der Code** (`transcription: { model, eot_threshold: 0.9 }`). Beide Seiten
  waren gleich falsch — dieselbe Wurzel wie beim Zeitzonen-Selbsttest in B-7: eine Pruefung,
  die ihre beiden Seiten aus derselben Quelle zieht, prueft nur sich selbst.
- **Zwei Regeln:**
  1. Die Fixture einer Fremd-Datenform stammt aus einem **echten** Aufruf (Momentaufnahme,
     Datum, Feldliste im Kopfkommentar) — nie aus dem Kopf des Implementierers und nie aus
     dem Code, der sie liest.
  2. Ein Pruefwerkzeug gibt **immer** eine Zeile aus, auch bei null Befunden ("geprueft X
     gegen Y -> 0 Befunde"). Stille als Erfolgssignal verschluckt genau den Fall, in dem gar
     nicht geprueft wurde.
- Gefunden hat es nicht das Gate (Safety-Review approved, Clean-Code keine S1/S2) und nicht
  die Suite, sondern **das tatsaechliche Ausfuehren gegen die echte API** in der Abnahme.
  Ein Werkzeug, das in der Phase gebaut, aber nie scharf laufen gelassen wird, ist unbelegt.

## Ein Wertevergleich mit einwertigem Enum ist kein Durchreich-Beleg (2026-08-07, STT-A1)

- Die Spezifikation hatte woertlich gewarnt: Zusicherung B ("dasselbe Profil ergibt drei
  adaptertypische Schreibweisen") ist nur dann ein Beleg, wenn sie die Wahl als **Eingabe
  durchreicht**; als reiner Wertevergleich ist sie ohne den Fix gruen. Der Implementierer
  schrieb trotzdem die gruene Variante.
- **Gemessen** (zwei gezielte Sabotagen am fertigen Branch): fail-closed entfernt -> nur A
  rot. Durchreichen gekappt -> **wieder nur A rot**, B blieb beide Male gruen. Mit genau
  einem Enum-Mitglied liefert eine ignorierte Wahl denselben Wert wie eine beachtete.
- **Regel:** bevor ein Test als Beleg gilt, die Sabotage benennen, die ihn rot machen SOLL,
  und sie ausfuehren. Bei einwertigen Aufzaehlungen ist "Ausgabe hat den richtigen Wert"
  grundsaetzlich kein Beleg fuer "Eingabe wurde beachtet" — dafuer braucht es einen
  ungueltigen Wert (der wirft) oder ein zweites Mitglied.

## Eine Konstante zu flippen ist nicht dasselbe wie eine Entscheidung zu flippen (2026-08-07, C-P1/C-P1b)

- C-P1 stellte `DEFAULT_PROVIDER` von Twilio auf Telnyx. Meine Spec nannte **vier** Leser
  dieses Rueckfalls; der Plan-Agent fand **zehn**. Schlimmer: es gab **fuenf weitere,
  voellig unabhaengige** Anbieter-Defaults, die `DEFAULT_PROVIDER` gar nicht lesen - als
  Parameter-Default `(provider = PROVIDER.TWILIO)` in `registry.js` (voiceControl,
  messaging, mediaTransport, webhookEvents, voiceRenderer).
- **Vor dem Flip waren beide Antworten Twilio - konsistent. Der Flip hat die Divergenz
  ERZEUGT:** ein Call ohne Provider-Feld lief in `/voice/turn` (Parameter-Default) nach
  Twilio und in `/voice/status` (`|| DEFAULT_PROVIDER`) nach Telnyx. Dieselbe Frage, zwei
  Antworten, im selben Request-Pfad. Live erreichbar, nur zufaellig folgenlos, weil alle
  Produktionszeilen ihren Provider ausdruecklich tragen.
- **Regel:** wer eine Default-Entscheidung umstellt, grept NICHT nach dem Namen der
  Konstante, sondern nach dem **Wert** und nach allen Formen, in denen dieselbe Entscheidung
  ausgedrueckt sein kann: Parameter-Defaults, `||`-Rueckfaelle, `??`-Rueckfaelle, Fixtures,
  Kommentar-Behauptungen. Die Frage lautet "wer beantwortet 'wer gilt, wenn nichts es
  sagt?'", nicht "wer importiert `DEFAULT_PROVIDER`?".
- **Der Faenger gehoert gegen die Quelle formuliert, nicht gegen den Wert.** Der
  Bestandstest hiess "arg-lose Factories defaulten byte-identisch" und pinnte `twilioVoice`
  - er musste bei jedem Wechsel von Hand nachgezogen werden. Jetzt lautet er
  `factory() === factory(DEFAULT_PROVIDER)` ueber ALLE Factories: er ueberlebt jeden
  kuenftigen Wechsel und faengt trotzdem jeden neu hartkodierten Default.
- Gefunden hat es kein Gate (Safety approved, Clean-Code sauber) und kein Test, sondern ein
  **beilaeufiger Satz eines Inventur-Subagenten** ueber eine ganz andere Frage. Fremde
  Befunde ernst nehmen, auch wenn sie neben dem Auftrag liegen.

## Nicht auf den Workflow blockieren - die Benachrichtigung kommt von selbst (2026-08-07, Owner-Korrektur)

- Ich habe waehrend laufender Phasen wiederholt `TaskOutput` mit `block:true` gepollt und
  dazwischen Statusabfragen gefahren. Der Owner: *"Das hat noch nie eine Session gemacht.
  Die wird dann einfach, wenn das fertig ist, benachrichtigt."*
- **Richtig:** Workflow starten, danach etwas anderes tun (oder nichts), auf die
  `<task-notification>` warten. Blockieren liefert keine zusaetzliche Information und
  verbrennt Kontext, den spaeter niemand mehr hat.
- **Wenn wirklich ein Zwischenstand noetig ist**, reicht EIN billiger Blick:
  `git log master..<branch>` (kam ein Commit?) - nicht ein Poll-Zyklus aus mehreren Aufrufen.

## Der Impl-Agent kann ohne Rueckgabe sterben - zweimal in einer Session (2026-08-07, C-P2/C-P4)

- **C-P2:** Impl-Agent tot, Branch LEER, die Reviews meldeten korrekt "kein Diff vorhanden" -
  und das Gate lief trotzdem weiter. **C-P4:** derselbe Fehler ("subagent completed without
  calling StructuredOutput"), diesmal mit 59 geaenderten Dateien im Worktree, aber ohne
  Commit, ohne Review, ohne Testlauf.
- **Regel 1:** vor jedem Merge `git log master..<branch>` UND `git diff --stat`. Ein PASS
  sagt nichts darueber, ob ueberhaupt etwas gebaut wurde.
- **Regel 2:** bricht ein Lauf ab, zuerst den WORKTREE ansehen
  (`git -C .claude/worktrees/<run>-2 status --porcelain`), nicht nur den Branch. Die Arbeit
  liegt dort uncommitted und verschwindet mit dem Worktree.
- **Regel 3:** solche Arbeit auf dem Branch sichern, klar als ungeprueft beschriftet - aber
  NIE mergen. Ein Commit mit "UNGEPRUEFT - NICHT mergen" im Betreff ist besser als
  verlorene Arbeit und besser als ein stiller Merge ohne Beleg.
- Nebenbefund aus C-P4: der abgebrochene Agent hatte auch den Scope ueberschritten (Doku und
  ein Skript-Rename, die laut Spec in eine spaetere Phase gehoerten). Ein Lauf ohne Review
  faengt so etwas nicht ab - das ist der zweite Grund, warum ungeprueft nicht gemergt wird.

## 2026-08-07 (Session 2bd10950, Track-C-Abschluss C-P4-C-P6)

- **Selbstreferenzieller node_modules-Symlink im Worktree = Exit 0 ohne Messung.** Der
  REPO-Fallback der per-run-Skripte (`process.cwd()`) lieferte im Spawn-Kontext `.`;
  `ln -s "./node_modules" node_modules` im Worktree zeigt dann auf sich selbst
  ("Too many levels of symbolic links") und `npm test` beendet mit Exit 0 bei 4 Zeilen
  Output. Wer Exit-Codes statt Testzahlen liest, haette "gruen" gemeldet. Regel: REPO in
  per-run-Skripten HART pinnen (absoluter Pfad); ein Testlauf ohne gemeldete ZAHL zaehlt
  nicht als Lauf. (Entdeckt vom C-P4-Safety-Reviewer, wf_ff179540-31e.)
- **`timeout` existiert auf macOS nicht.** Ein Smoke-Test, der ihn nutzt, startet den
  Server NIE und misst 000 - das sieht aus wie "Dienst kaputt", ist aber "nie gestartet".
  Erst das Log lesen (Regel 7), dann urteilen: der echte Boot-Refusal kam von einem
  UNVERWANDTEN Guard (COST_TRUING_REQUIRED_RECORD_TYPES fehlt in der lokalen .env -
  vorbestehend, kein Phasen-Defekt).
- **Zwei unabhaengige Wege zum selben Befund sind ein starkes Signal.** Der
  C-P5-Spec-Agent (Weisse-Flecken-Erhebung) und der C-P4-Safety-Reviewer fanden
  UNABHAENGIG denselben Defekt (Betreiber-Skripte mit PROVIDER.TWILIO=undefined ->
  Provider-Filter still abgeschaltet). Parallele Spec-Erhebung neben dem Review kostet
  wenig und verdoppelt die Fangchance fuer genau die Klasse "stille Bedeutungsumkehr".

## Ein Messwerkzeug braucht eine Attrappe, sonst prueft man nur die Rechnung (2026-08-08, B1)

- Das B1-Messskript bestand `node --check`, 22 Selftest-Zusicherungen, den Trockenlauf und
  einen scharfen Lauf mit Falsch-Schluessel (fail-closed, Verzeichnis blieb leer). Alles
  gruen. Der adversarische Review fand danach **fuenf S1** - jeden einzelnen an einer
  selbstgebauten **Offline-Attrappe** der Anbieter-API, die er in ~15 min hochgezogen hat
  (lokaler HTTP-Server fuer die drei Endpunkte, Skript-Kopie mit Basis-URL aus Env und
  skaliertem `delay()`; das sind zwei geaenderte Zeilen).
- **Die Attrappe ist der eigentliche Hebel, nicht der Review.** Ohne sie kann man ein
  Messwerkzeug nur gegen den Gutfall pruefen - und der Gutfall ist nie das Problem. Alle
  fuenf S1 lagen im Fehlerfall: Endpunkt antwortet 500, Verbindung bricht ab, Zahlenformat
  wechselt, Bremse feuert mittendrin. **Diese Faelle kann kein Trockenlauf und kein
  Selftest erzeugen.** Regel: wer ein Werkzeug gegen eine fremde API baut, baut die
  Attrappe im selben Zug - sie kostet weniger als eine Fehlmessung.
- **Die Fehlerklasse war jedes Mal dieselbe: nicht die Rechnung war falsch, sondern die
  Meldung.** Die BigInt-Geldarithmetik war handnachgerechnet korrekt; trotzdem erschien
  dieselbe Abbuchung als `-1000000` je Aufruf und `-6` gesamt, weil beide Konsumenten die
  von der Funktion korrekt gelieferte `scale` wegwarfen. **Eine Ganzzahl ohne ihre Skala
  ist keine Geldangabe.** Wer Geld als Ganzzahl fuehrt, fuehrt die Skala mit, ueberall.
- **Der teuerste Befund war ein Exit 0.** Guthaben-Endpunkt durchgehend HTTP 500 ->
  Exit 0, `key_leak_check: clean`, M2 "beantwortet" mit leeren Objekten. Das liest sich
  als "es gibt keine Ist-Kosten-Quelle" - woertlich ein Entscheidungszweig der Spec. Eine
  Messung, die nie stattfand, waere als Messergebnis dem Owner vorgelegt worden. Dieselbe
  Wurzel wie bei der STT-Drift-Sonde: **eine Probe, die bei null Befunden schweigt, ist
  nicht von einer kaputten zu unterscheiden** - hier in der Variante "eine Auswertung, die
  fehlende Daten nicht von unauffaelligen Daten unterscheidet".
- **Der Fix dagegen ist immer derselbe und gehoert in jede Auswertung:** die leere Menge
  ist ein eigener Fall. `0 Treffer` ist nur dann ein Ergebnis, wenn es erfolgreiche
  Aufrufe gab; `0 Abweichungen` nur bei nicht-leerer Vergleichsmenge; `key_leak_check:
  clean` nur bei > 0 geprueften Dateien. Die Meldung nennt die Grundgesamtheit mit
  ("clean (5 Dateien, 812345 Bytes geprueft)"), sonst kann der Leser beides nicht trennen.
- **Was die Gates NICHT gefangen haetten:** kein Test (die Spec verbot einen), keine Suite,
  kein `node --check`, kein Trockenlauf. Gefangen hat es allein die Frage *"welche Sabotage
  muesste diese Zusicherung rot machen - und wird sie es?"*, 14-mal gestellt und
  ausgefuehrt. Bei der Re-Verifikation belegte dieselbe Suite die Behebung.
- **Nebenbefund, der Zeit spart:** eine Pause innerhalb einer Modellschleife laeuft je
  Modell einmal. 2 x 30 min statt 1 x 30 min hat die Laufzeit fast verdoppelt (80-95 statt
  45-55 min) - gefunden nicht durch Nachdenken, sondern weil der Reviewer die Schlafzeit
  ausgerechnet hat.
- **Spec-Konflikte benennen statt still absenken.** M1s Abnahme verlangte Verteilung "ueber
  beide Modelle und beide Betriebsarten"; ein Kreuzprodukt war per Konstruktion
  unerfuellbar (nur EIN Block streamt, und der faehrt nur ein Modell - empirisch 23/17/4/0
  ueber die vier Zellen). Der Fixer waehlte die woertliche Lesart (zwei Randpruefungen) und
  **meldete die Abweichung samt Aussagekraft-Verlust**. Genau so gehoert es: die schwaechere
  Aussage kommt in die Uebergabeliste, nicht in eine Fussnote.

## Ein Pruefkommando ohne Positiv-Kontrolle kann still 0 melden (2026-08-08, B2)

Die B2-Spec schrieb den Abnahme-Grep fuer "keine Laufzeit-Logik" so aus:
`grep -nE "function\|=>\|\bconst\b\|\blet\b" src/llm/ports.js` — und verlangte, dass er
**keine** Treffer ausserhalb von Kommentaren liefert.

- **Das Kommando war defekt.** In einem ERE ist `\|` das LITERAL "|", kein
  Alternations-Operator. Der Ausdruck suchte also nach der Zeichenkette
  `function|=>|\bconst\b|\blet\b` am Stueck — die es nirgends gibt. **Der Grep haette bei
  JEDER Datei 0 Treffer gemeldet**, auch bei einer voller Laufzeit-Logik.
- **Die Abnahme haette also gruen gemeldet, ohne irgendetwas zu pruefen.** Das ist genau
  die Klasse aus [[Ein Messwerkzeug braucht eine Attrappe]]: nicht die Rechnung war falsch,
  sondern die Meldung.
- **Gefangen hat es die Positiv-Kontrolle.** Der Impl-Agent liess denselben Grep gegen
  `src/telephony/ports.js` laufen — eine Datei, von der bekannt ist, dass sie viele
  JSDoc-Treffer traegt. Erwartet ~23, geliefert 0. Erst dieser Widerspruch entlarvte das
  Kommando; die Zieldatei allein haette nie widersprochen.
- **Regel:** ein Pruefkommando, dessen Erfolgsfall "leere Ausgabe" ist, muss **einmal gegen
  einen bekannten Positiv-Fall** laufen, bevor man seiner Null glaubt. Ohne diesen Lauf ist
  "keine Treffer" nicht von "sucht nichts" zu unterscheiden — und beides sieht im Protokoll
  identisch aus.
- **Ersatz war nicht der reparierte Grep, sondern die staerkere Frage.** Statt "kommen
  verbotene Zeichenketten vor?" wurde gepruefte: Kommentare entfernen, und der Rest der
  Datei muss **exakt** `export {};` sein. Das ist eine Positiv-Aussage ueber den
  Gesamtinhalt statt einer Negativ-Aussage ueber eine Musterliste — sie kann nicht dadurch
  gruen werden, dass das Muster nicht passt.

**Zweiter Befund derselben Phase, andere Wurzel:** die Spec belegte `toolChoice "auto" |
"required"` mit `precall-briefing.js:236`. Die Zeile stimmte, die Aussage nicht — direkt
darueber, in `:235`, steht ein **benannter** Werkzeug-Zwang (`{type:"tool", name}`), den
ein zweiwertiges Feld nicht ausdruecken kann. **Eine korrekt zitierte Zeile belegt nur, was
in ihr steht, nicht die Vollstaendigkeit der Aufzaehlung.** Wer eine Enum-Wertemenge aus
einem Zitat ableitet, muss alle Rueckgaben der Funktion ansehen, nicht eine.

## `tail` im Hintergrund-Kommando vernichtet die Diagnose (2026-08-08, B4a)

Ein Hintergrund-Testlauf wurde als `npm test 2>&1 | tail -10` gestartet. Er meldete
**`fail 1`** — und die Identitaet des roten Tests war damit **unwiederbringlich weg**: in der
Ausgabedatei standen nur die zehn Zeilen der Zusammenfassung, nicht die `not ok`-Zeile.

- **Der Grund ist der Zeitpunkt.** Bei einem Vordergrund-Lauf ist `| tail` harmlos: sieht man
  eine rote Zahl, wiederholt man den Lauf ungefiltert. Ein Hintergrund-Lauf dauert 100 s, und
  bis die Zahl auftaucht, ist der Kontext, in dem er rot wurde (Systemlast, parallele
  Kommandos), nicht mehr herstellbar. Der Wiederholungslauf war gruen — und damit ist die
  Frage "Flake oder Regression?" **dauerhaft unbeantwortbar**.
- **Regel:** Hintergrund-Laeufe schreiben die VOLLE Ausgabe in eine Datei
  (`npm test > lauf.log 2>&1`) und filtern erst beim Lesen (`grep -E "^not ok|^# fail"
  lauf.log`). Speicherplatz ist billiger als ein zweiter Lauf, der die Bedingung nicht mehr
  trifft.
- **Was hier gerettet hat:** die Zahl selbst stand in der Zusammenfassung, also war der
  Fehlschlag ueberhaupt sichtbar. Haette ich auf `| tail -3` gefiltert, waere er unbemerkt
  geblieben — der Workflow hatte `testsPass: true` gemeldet.

**Der Nebenbefund ist der wichtigere:** der Workflow meldete Gate PASS **ohne Fix-Runde**, und
der Safety-Reviewer hatte die Suite laut Schema unabhaengig gefahren. Der eigene Lauf des
Leads widersprach dem trotzdem. Genau dafuer existiert die Regel "PASS ist keine Freigabe" —
sie greift nicht nur gegen leere Branches (C-P2) und tote Impl-Agenten (C-P4), sondern auch
gegen einen Reviewer, der auf einem gluecklicheren Lauf sass.
