# Lessons (selbst gefundene Stolpersteine, fuer kuenftige Sessions)

- **Bug-Report-Schicht != aktiver Code-Pfad**: Der Inbound-Audio-Report (2026-06-15)
  begruendete alles mit Media-Streaming/WS/both_tracks. Der Realtime-Pfad war aber
  gar nicht aktiv (`VOICE_ENGINE=budget` in .env). IMMER zuerst die echte aktive
  Konfiguration lesen (.env + config.js), BEVOR man der Kausaltheorie des Reporters
  folgt. Die genannte Symptom-Schicht ist evtl. nicht der laufende Pfad.
- **Telnyx `<Gather input="speech">` braucht `transcriptionEngine`** (Google/Telnyx/
  Azure/Deepgram), sonst transkribiert Telnyx GAR NICHT -> kein `SpeechResult` ->
  Agent hoert den Angerufenen nie. Unterschied zu Twilio (dort reicht input+language,
  `speechModel` ist optional). Telnyx-Gather-Callback ist sonst Twilio-kompatibel
  (`SpeechResult`/`Confidence`). Quelle: Telnyx-TeXML-Gather-Doku.

- **`node --test test/` schlaegt fehl** (Node 22 in diesem Setup versucht, das
  Verzeichnis als Modul zu laden). Funktioniert: `node --test "test/*.test.js"`.
- **stdout-Assertions gegen Kindprozesse brauchen Polling**: Die HTTP-Antwort
  erreicht den Test oft, BEVOR die Log-Pipe beim Parent angekommen ist
  (Flush-Race, fiel erst im parallelen Gesamtlauf auf, nicht isoliert).
  Loesung: `waitForLog()` in `test/helpers.js`.
- **Twilio-Client offline testen**: Mit leerer `TWILIO_ACCOUNT_SID` wirft
  `calls.create()` synchron ("username is required") VOR jedem Netzzugriff -
  damit ist der place_call-Pfad bis unmittelbar vor den API-Call offline
  testbar.
- **Nicht-localhost-Verhalten testbar ohne Spoofing**: Requests an die externe
  Interface-IP des Hosts (os.networkInterfaces) haben eine echte
  Nicht-127.0.0.1-Socket-Adresse; `X-Forwarded-For` waere durch die
  Phase-1-Fixes wirkungslos.
- **dotenv fuellt nur UNgesetzte Variablen**: Test-Kindprozesse muessen ALLE
  config-relevanten Env-Vars explizit setzen (auch leer), sonst sickert eine
  lokale `.env` in die Tests.
- **"Auf welchem Branch?" / "letzte Commits": erst `git fetch --all`**, bevor
  ich antworte. `git branch -a` zeigt nur bereits gefetchte Remotes; in diesem
  Repo lagen die juengsten Commits + `tasks/todo.md` auf einem ungefetchten
  Branch (`claude/plan-security-phase-one-n5dl1h`). "Letzte Commits" per
  Commit-Zeitstempel (`%cI`) ueber ALLE Branches bestimmen, nicht per HEAD des
  gerade ausgecheckten Branches.
- **Plaene koennen gegen aelteren Code geschrieben sein**: Der OAuth-Detailplan
  (Branch inspiring-gates) verwies auf Zeilennummern/Strukturen VOR Phase 2/3.
  Vor dem Umsetzen den Plan gegen den aktuellen Code abgleichen - hier u.a.: den
  in Phase 1 gesetzten Fail-closed-Default von `/mcp` NICHT durch den im Plan
  vorgeschlagenen offenen `off`-Default ersetzen.

## BK-Chain (Buchung/Pricing-Funnel)

- **Seltener Suite-Flake (401 statt 403) unter hoher node:test-Parallelitaet**:
  Beim BK5-Merge-Lauf failte einmalig ein Auth-Assert (`actual:401, expected:403`),
  5 direkte Reruns danach 1089/1089 gruen. Ursache ist KEIN Produkt-Bug und KEIN
  shared State: `test/pg-helpers.js makePgTestStore()` baut pro Aufruf ein frisches
  `new PGlite()` (kein Singleton, `app.listen(0)`, kein env-Mutate) - jede Suite voll
  isoliert. BK5 fuegte 0 src-Files hinzu (nur Test + Report), das Produkt-Verhalten ist
  unveraendert. Der Flake ist ein seltenes Test-Infra-Timing-Artefakt (viele pglite-WASM-
  Instanzen booten gleichzeitig -> eine Session-Resolution kommt spaet -> fail-closed 401
  statt rollen-403). Lehre: bei einmaligem Auth-Flake erst `git show --stat HEAD` (src
  beruehrt?) + Re-Runs, bevor man eine Race-Hypothese im Produkt-Code jagt. Falls die Rate
  steigt: node:test-Concurrency fuer die pglite-Suiten senken, nicht den Auth-Pfad anfassen.

## Gespraechsqualitaet (G-Kette, Outbound)

- **Outbound: erster `/voice/turn` hat `SpeechResult=0` BY DESIGN** — nicht als Defekt
  fehldeuten. Bei Outbound spricht der Agent ZUERST (LLM-frei: Offenlegung + Anliegen via
  `openingText` im Erst-Gather). Der erste Turn ist also der Agent (`heard=0`, `reply>0`); die
  ERSTE transkribierte Antwort des Angerufenen (`SpeechResult>0`) kommt erst auf einem
  SPAETEREN Turn. Das G2-Erfolgssignal ist daher NICHT "erster `SpeechResult>0`" (so im
  Runbook-Entwurf OWNER-GOLIVE-GESPRAECH.md falsch formuliert, Jonas-Korrektur 2026-06-28),
  sondern: KEINE Stille vor dem ersten Agenten-Satz UND der Erst-Satz enthaelt hoerbar
  Offenlegung+Anliegen. Live-Abnahme 2026-06-28: G2 `reply=140`/`heard=0` ohne Loch; G3
  `SpeechResult:25` = voller Satz ("...Das war alles", NICHT auf das erste Wort gekuerzt);
  `STT_SPEECH_TIMEOUT_SEC` Default 2 reicht (kein Tuning).

## Prozess: Feature-Umbau = Strategie-Doc ZUERST, nicht inline bauen

- **Bei einem groesseren Feature/Umbau NICHT direkt implementieren** (Owner-Korrektur
  2026-07-01, MCP-UI-Live-Widget). Der etablierte Ablauf in diesem Repo (siehe die vielen
  `*-chain`-Memories + `PLAN-*.md`): (1) ein Agent-Team / dynamischer Workflow entwirft ein
  STRATEGIE-DOC mit MEHREREN Phasen (nur Analyse, kein Code); (2) eine FRISCHE Claude-Session
  mit dem Lean-Template geht dann jede Phase sequenziell ueber `phase-impl-lean.js` durch
  (dualer Review als Gate, Merge im Lead). Der Lead selbst schreibt/finalisiert nur das Doc +
  merged - er baut nicht das Feature in der Planungs-Session. Symptom des Fehltritts: ich fing
  nach der Forensik an, `mcp-tools.js`/Widgets direkt zu editieren, statt die Phasen-Kette zu
  entwerfen. Lehre: nach abgeschlossener Untersuchung IMMER erst fragen "Strategie-Doc + Kette
  oder direkt bauen?" - Default fuer nicht-triviale Features = Doc + Kette.
- **Orchestrierungs-Rollen: alle Subagenten (Draft/Impl/Review) laufen auf SONNET, nur der
  Lead auf Opus.** Beim `Agent`-Tool `model:'sonnet'` setzen, im `Workflow`-Skript auf JEDEM
  `agent()`-Call `model:'sonnet'` (sonst erben sie das Lead-Modell Opus). Gilt auch fuer die
  phase-impl-lean-Laeufe der Umsetzungs-Session.

## Widget-Redesign (H-Kette, 2026-07-02)

- **HTML-Kommentare duerfen Injektions-Platzhalter NIE woertlich nennen.** Ein
  Doku-Kommentar in call.html enthielt `<!--__WING_ENGINE__-->` als Text INNERHALB
  eines Kommentars: Kommentare nesten nicht, das Platzhalter-Ende schloss den
  Kommentar, der Rest leakte als sichtbarer Text — UND String.replace ersetzt nur
  das ERSTE Vorkommen. Alle Tests waren gruen; gefunden NUR im visuellen Harness-
  Check. Lehren: (1) Serve-Regressionstest "Platzhalter-Name kommt im Output nicht
  vor" (existiert jetzt: T-wing-canvas-inject-no-leak); (2) visueller Smoke gehoert
  in JEDE Widget-Phase, nicht erst ans Ketten-Ende.
- **rAF-Messungen im gesteuerten Chrome sind ohne Fenster-Sichtbarkeit wertlos.**
  Chrome drosselt requestAnimationFrame bei verdecktem Fenster auf ~30fps bzw. 0
  (hidden) — die "konstanten 36fps" des Spikes waren Occlusion-Throttling, kein
  Engine-Bottleneck. Perf IMMER zusaetzlich synchron messen (performance.now um
  render(), funktioniert auch im versteckten Tab): echte Kosten 0.4ms/Frame.
  document.visibilityState VOR jeder Browser-Messung pruefen.
- **Lead-Fix-Runde 3 nach Workflow-BLOCKED funktioniert gut:** wenn nach
  maxFixRounds genau benannte, enge Blocker uebrig sind (Test-Luecke, Specimen-
  Drift), ist ein gezielter Einzel-Agent + Lead-Verifikation (inkl. Mutations-
  Nachweis: Bug einbauen -> Test muss rot werden) billiger als ein neuer
  Workflow-Lauf — Gate-Disziplin bleibt gewahrt, weil die Blocker-Liste des
  Reviews abgearbeitet und einzeln verifiziert wird.

## 2026-07-02 — Widget-Politur (Icon/i18n/Design) — Parallel-Session + Harness

- **Parallel-Sessions im selben Working Tree: verifizierte Arbeit SOFORT
  committen.** Eine parallel laufende Session hat mit `git stash` (Reflog:
  "reset: moving to HEAD") alle uncommitteten tracked Edits weggeraeumt und
  Minuten spaeter zurueckgepoppt — untracked Dateien ueberlebten, tracked
  Edits waren zwischenzeitlich weg. Kein Schaden nur, weil zufaellig nichts
  dazwischen editiert wurde. Regel: nach jedem gruenen Verifikationsschritt
  committen (Commits sind stash-fest), fremde WIP-Dateien nie mit-stagen.
- **requestAnimationFrame feuert in unsichtbaren Tabs GAR NICHT** (empirisch:
  0 Ticks/400ms bei visibilityState=hidden). Die Wing-Canvas-Engine zeichnet
  ihr erstes Frame im RAF-Loop -> in automatisierten Chrome-Screenshots
  (Fenster im Hintergrund) bleibt der Canvas leer, obwohl live alles rendert.
  Visuelle Canvas-Verifikation braucht ein sichtbares Fenster ODER den
  Vergleich gegen eine Baseline im selben (hidden) Kontext.
- **claude.ai-Connector-Icon**: "Tool-Liste aktualisieren" refresht nur die
  Tools, NICHT das Connector-Icon; auch Hard-Reload nicht. Icon-Kandidaten
  serverseitig alle bedient (icons data-URI + https, websiteUrl, favicon.ico
  auf beiden Origins inkl. enger Basic-Auth-Ausnahme). Letzter Hebel, falls
  der Wuerfel bleibt: Connector trennen + neu verbinden (Owner, OAuth).
