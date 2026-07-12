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

## 2026-07-07 — C-Telnyx-Chain: Lean-Orchestrator-Setup (gilt fuer JEDE Phase P0-P11)

- **`tasks/wf-phase-impl-lean.js` REPO-Pfad ist NICHT portabel.** Die im Repo liegende
  Kopie war eine "Linux-korrigierte" Variante mit `REPO=/srv/openclaw/...`, die auf dem
  macOS-Host NICHT existiert — jeder Subagent waere an `ln -s "$REPO/node_modules"`
  gescheitert. Owner-Bestaetigung 2026-07-07: die Kette laeuft LOKAL in diesem Repo.
  Vor JEDEM Phasen-Lauf pruefen, dass `REPO="/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"`
  (mit Space — bleibt korrekt, weil im Skript ueberall in `"..."` gequotet).
- **phaseId MUSS namespaced sein (`telnyx-p<N>`), sonst Review-Branch-Kollision.** Der Driver
  leitet Review-Branches als `review-<phaseId>[-rN]` ab. `phaseId:"p1"` kollidiert mit den
  bereits existierenden `review-p1`/`review-p1-r1/2` aus der alten Launch-Fixes-Phase
  `phase/p1-cancel-cap-fix` -> `git checkout -b review-p1` schlaegt fehl. Vor jedem Lauf
  `git branch -a | grep -i "<phaseId>"` = leer pruefen. Konvention fuer diese Kette:
  phaseId `telnyx-p<N>`, branch `phase/telnyx-p<N>-...`.
- **Modell-Pins waren im Skript NICHT gesetzt.** §5.2 verlangt Opus=Plan+Safety-Review,
  Sonnet=Impl/Clean-Code-Audit/Self-Fix/Report; die Repo-Kopie hatte auf KEINEM `agent()`-Call
  ein `model`. Ohne Pin erben alle das Lead-Modell. Pro Lauf sicherstellen, dass die 6
  `model:`-Pins gesetzt sind (plan=opus, impl=sonnet, safety=opus, cleancode=sonnet,
  fix=sonnet, report=sonnet).
- **R1-Phasen (P1/P3a/P4/P4.5/P5/P6/P8/P9/P11): `gate=PASS` allein reicht NICHT zum Merge.**
  §5.5: Lead liest den Safety-Review-Abschnitt des Reports ODER faehrt einen zweiten
  Safety-Pass mit der Checklist (alle Gates 0-13 auch fuer C-Telnyx? rearm/reattach kennen
  `call_control_id` statt `twilioSid`? keine Verzweigung an `voiceEngine`? Shim 404-bei-Flag-aus
  + per-Call-gebunden + Budget-gegatet? `call.hangup`->releaseReserve+finishCall? Inbound-Budget-Gate?).
- **Worktree-Muell:** ~180 Worktrees + hunderte Branches aus alten Ketten liegen unter
  `.claude/worktrees/` (2 locked). Blockiert den Start nicht, frisst aber Disk — irgendwann
  `git worktree prune` + Branch-Cleanup (Owner-Entscheidung, nicht Teil eines Phasen-Laufs).
- **Session-Limit mid-run = dieselbe BLOCKED/phantom-Signatur wie Mac-Sleep (P4.5-Lauf 2026-07-07).**
  Wird das Nutzungs-Limit erreicht, waehrend ein phase-impl-lean-Lauf laeuft, sterben die gerade
  aktiven Agenten mit *"You've hit your session limit · resets HH:MMpm"* (steht im `<failures>`-Block
  der task-notification). Folge-Kaskade im Driver: (1) der Self-Fix-Gate `gateOk(safety,cc)` behandelt
  ein NULL-Review (toter Agent) als "nicht approved" → **spurious naechste Fix-Runde** wird getriggert,
  obwohl der reviewte Branch evtl. schon sauber war; (2) der Fix-Agent der neuen Runde stirbt auch →
  der `-fixN`-Branch wird NIE erzeugt → `finalBranch` im Postage-Stamp ist **phantom** (rev-parse
  schlaegt fehl). Recovery = P1-Muster: echten Git-Stand pruefen (`git branch -a | grep <phaseId>`),
  den HOECHSTEN existierenden Fix-Branch als "substanziell reviewt+gefixt" identifizieren, `git
  merge-base --is-ancestor master <branch>` (enthaelt er die Vorphasen?), Tests + §5.5 in einem
  detached Wegwerf-Worktree (`git worktree add --detach`) SELBST nachziehen, dann mergen. Der
  diagnostizierende Review-Agent verweigert korrekt fail-closed (kein Rubber-Stamp auf den phantom-
  Branch, kein stiller fix1-Fallback) — die Blocker sind "nicht verifizierbar", KEINE echten Verstoesse.
  Praevention: Wecker (ScheduleWakeup ~48min) setzen, wenn der Owner ein nahes Limit meldet, + `caffeinate`.

## 2026-07-10 — RCA place_call 422

**Zeitzonen-Annahme erfand eine Log-Luecke.** Ein Client-Report nannte "12:31 Uhr". Ich rechnete
das als Berlin-Zeit (= 10:31Z) und fand im Fenster 09:58-11:10Z keine `place_call`-Zeilen —
und schloss auf eine kaputte Log-Pipeline oder einen anderen Origin. Die Events lagen bei
**12:31:49Z**. Regel: Uhrzeiten aus fremden Berichten sind zeitzonenlos. Erst an einem
BEKANNTEN Event kalibrieren (Deploy-Timestamp, Nummernkauf, Boot-Banner), dann das Fenster
eng ziehen. Im Zweifel +/- 3h abfragen, bevor man eine Anomalie behauptet.

**Ein Bestandstest kann den Bug festschreiben.** `test/telnyx-call-control.test.js` prueft seit
P4 `assert.equal(body.connection_id, CONNECTION_ID)` — genau den falschen Wert. Der Test war
gruen, weil TeXML-ID und Call-Control-App-ID im Fixture DIESELBE Variable waren. Regel: Wenn
zwei semantisch VERSCHIEDENE IDs im Test denselben Wert tragen, testet der Test nichts. Fixtures
fuer verschiedene Objekttypen bekommen verschieden aussehende Werte (`conn_texml_*` vs `ccapp_*`).

**Generierte Reports vor dem Commit auf PII scannen.** Die RCA-Subagenten zogen Kunden-Emails,
Stripe-Customer-IDs und eine private Mobilnummer aus Live-APIs in die Markdown-Reports. Der
Commit lag schon, der Push wurde (zu Recht) geblockt. Regel: Bevor ein von Agenten erzeugtes
Dokument ins Repo geht, `grep -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+'` + Nummern-/ID-Scan. Und:
`git commit --amend` ist nur solange folgenlos, wie NICHTS gepusht ist — das vorher belegen
(`git branch -r --contains <sha>`).

**Der echte Provider-Fehler steht nur im Server-Log.** `server.js:1762-1766` gibt dem Client
bewusst nur "HTTP <status>" (Regel 4/5). Die Ursache (`10015 Invalid value for connection_id`)
stand die ganze Zeit im Render-Log. Bei Provider-Ablehnungen IMMER zuerst das Server-Log lesen
(CLAUDE.md Regel 7), nicht die Client-Fehlermeldung interpretieren.

## 2026-07-12 RCA-Korrektur (Owner)
- Owner-beobachtbares Verhalten (wer legte auf, was war hoerbar, welche Stimme) ZUERST beim Owner erfragen, bevor es aus Logs "erschlossen" wird. Fehldeutung "System legte auf via end_call" — die Log-Reihenfolge (hangup-Event 33.264 VOR endCallViaCallControl 33.282) belegte das Gegenteil und der Owner hatte selbst aufgelegt.
- Timestamps auf Millisekunden-Ebene vergleichen, bevor Kausalitaet behauptet wird.

## 2026-07-12 Assistant-Fix-Kette (P1-P4)

**Ein 401 tarnt sich im convo-bench als inhaltliches FAIL.** Der Bench meldete 5/5 Laeufe
`ended_via=agent_hangup` + `no_hangup_on_unintelligible_reply: false` — sah exakt aus wie
"die P4-Prompt-Regel wirkt nicht". Tatsaechlich war der `ANTHROPIC_API_KEY` im lokalen `.env`
ungueltig (401 invalid x-api-key): `agentTurn` warf, die Fehlerbehandlung sprach
`turnErrorSpeech` und beendete den Call. Verraeterisch waren `cost_estimate_usd: 0.0000`,
`judge: n/a` und `llm_calls[].outcome: "non-transient"`. Regel: Bei einem roten Bench ZUERST
`meta`/`metrics.llm_calls`/`cost_estimate_usd` im Report-JSON pruefen — ein Lauf mit null
erfolgreichen LLM-Calls beweist NICHTS ueber den Prompt. (Haertungs-Kandidat: Der Bench sollte
bei 0 erfolgreichen LLM-Calls hart abbrechen statt Checks auszuwerten.)

**Doku-Annahmen ueber Provider-APIs vor dem Bauen empirisch pruefen.** Der Plan nahm an, der
Provisioner koenne per `PUT /v2/ai/assistants/{id}` aktualisieren — die Route existiert bei
Telnyx nicht (404), Update ist `POST /v2/ai/assistants/{id}`. Ein Wegwerf-Assistant (create ->
partial update -> get -> delete) hat in wenigen Minuten sowohl den Bug als auch die
Deep-Merge-Semantik bewiesen (nicht gesendete Felder wie `time_limit_secs` und
`recording_settings` ueberleben). Ohne diesen Test waere der als "harmlos" geplante
Provisioner-Lauf entweder gescheitert oder haette Safety-Felder zurueckgesetzt.

## Eine Messung an EINER Sprache darf nie global angewandt werden (2026-07-12, K3)

Wir haben die Sprechrate von ElevenLabs forensisch aus zwei echten Anrufen gemessen
(17.3-20.3 Zeichen/s) und daraus die Farewell-Hangup-Heuristik neu kalibriert — sauber
hergeleitet, konservativ auf die LANGSAMSTE Rate gerechnet, mit Tests. Der Safety-Review
fand trotzdem einen Rueckfall: Beide Testanrufe waren DEUTSCH. Das System faehrt de/fr/en
mit einer multilingualen Stimme. Englisch hat bei gleichem Sprechtempo deutlich WENIGER
Zeichen pro Sekunde (kuerzere Woerter) — der kalibrierte Wert haette englische
Abschiedssaetze ABGESCHNITTEN. Das waere R4 gewesen, der Bug, den die Vorgaenger-Phase
gerade behoben hatte.

Verschaerfend: Die erste Korrektur (Sprach-Tabelle) war AUCH noch falsch, weil ein GLOBAL
gebliebener `minMs` die deutsche Kalibrierung durch die Hintertuer wieder in die
ungemessenen Sprachen trug (kurze en-Abschiede bekamen 2060ms statt 3000ms).

Regel: Eine Messung gilt genau fuer die Konfiguration, in der sie erhoben wurde. Der Default
fuer alles Ungemessene ist **Bestandsverhalten behalten**, nicht "der neue Wert passt schon".
Und: die Invariante als Test festnageln ("der Fallback ist fuer KEINE Eingabe kuerzer als die
alte Formel") — sonst wandert der Fehler beim naechsten Refactoring nur in eine andere
Konstante. Frag bei jeder Kalibrierung: **Woran genau habe ich gemessen, und wo wende ich es an?**
