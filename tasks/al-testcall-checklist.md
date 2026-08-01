# AL-Kette — was der Owner noch abnehmen muss

Diese Liste ist **nicht** die Restarbeit der Kette, sondern das, was ohne den Owner bzw. ohne
einen echten Anruf nicht abnehmbar ist. Eine Phase gilt als **gebaut**, auch wenn ihre Abnahme
hier steht — sie gilt aber nie als **abgenommen**.

Regel aus `tasks/assistant-leap-chain.md` §2: die geldrelevanten Flags
(`PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`)
bleiben AUS. **Ihr Anschalten IST die Abnahme.**

## Startbestand (aus der Uebergabe, vor der ersten Phase)

1. **`BRAVE_SEARCH_API_KEY` beschaffen und setzen** (`.env` + Render-Dashboard).
   Erst fuer die Abnahme von AL-P10b noetig — zum Bauen nicht. Niemals committen.
   *(Die Uebergabe nannte hier urspruenglich `EXA_API_KEY`; der Owner hat am 28.07. auf Brave
   korrigiert — Betriebserfahrung aus einem real betriebenen Recherche-Agenten.)*
2. **O2 — Offenlegungssatz:** falls die 3-4 Sekunden gewuenscht sind, Rechtspruefung des zweiten
   Teilsatzes beauftragen. Bis dahin gilt „unveraendert" (so gebaut).
3. **O6 — Auslands-Tarif:** Ist-Werte von `VOICE_TARIFF_DEFAULT_CENTS`,
   `DEFAULT_TENANT_BUDGET_CENTS` und der Max-Gespraechsdauer im Dashboard nachlesen. Der
   Boot-Guard `worst_case_unaffordable` feuerte am 23./25.07., seit dem 27.07. nicht mehr.
   **Ist-Werte am 2026-07-29 aus dem Boot-Banner gelesen (Deploy `85ba107`):**
   Worst-Case-Tarif **300 ct/min**, Tenant-Default **1500 ct**, Plattform **3000 ct**,
   Budget-Achse auf **Spend-Monat** (`BUDGET_MONTH_ENABLED=true`, beide Ebenen).
   Der Boot-Guard schweigt weiterhin. Damit ist O6 fuer AL-P9 beantwortet — was fehlt,
   ist nur noch die Owner-Entscheidung, ob 300 ct/min der gewollte Wert ist.

## Offene Abnahmen je Phase

*(Wird von der Umsetzungs-Session fortgeschrieben, sobald die jeweilige Phase gemergt ist.)*

| Phase | Was abzunehmen ist | Woran man Erfolg erkennt | Stand |
|---|---|---|---|
| AL-P1 | Latenz-Tabelle fuer EINEN echten Anruf: `node scripts/telnyx-call-latency.mjs --call <call_id>` | Fusszeile `status=ok` (unaccounted-Median <= 300 ms). `status=unknown_component` = wichtigster Einzelbefund, **blockiert AL-P7** | offen |
| AL-P1 | Baseline aus **>= 5** gescripteten Anrufen: Median `roundtrips`/Turn, Turns/Anruf, Tokens/Anruf | `turn_ok`-Zeilen im Render-Log tragen `roundtrips`/`toolNames`/`chars`/`speechEmpty`; Mediane notiert | offen |
| AL-P1 | Eroeffnungsfenster aus **>= 3 echten Aufnahmen** (Annahme bis `speak.ended`) | gemessene Sekunden notiert — Basislinie fuer AL-P5, **nicht** hochgerechnet | offen |
| ~~AL-P1~~ | ~~Beide Schalter je Richtung schriftlich + Assistant-Flag im Boot-Banner~~ | **ERLEDIGT 2026-07-29 mit dem Deploy `85ba107`:** Banner zeigt `Voice-Engine: budget` und `Assistant-Pfad: AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)` | **erledigt** |
| AL-P1 | Feldnamen-Verifikation `conversation_id` | im Render-Log erscheint `conversation_created (call=…) -> UUID gespeichert`. Erscheint stattdessen `… OHNE conversation_id … payload_keys=…`, ist der Feldname falsch -> Ein-Zeilen-Fix aus den geloggten Schluesseln | offen |
| AL-P3 | **Basislinie ZUERST** (vor dem Provisioner-Lauf): `start_speaking_plan_extra_wait_duration_ms`-Median aus >= 5 echten Anrufen | Median notiert. Telnyx' interner Default bei `start_speaking_plan=null` ist unbekannt — ohne Basislinie ist „sinkt um >= 200 ms" nicht entscheidbar, und ein **Anstieg** waere unsichtbar | offen |
| AL-P3 | Provisioner-Lauf `node scripts/telnyx-assistant-provision.mjs` mit **explizit gesetzten** `TELNYX_ASSISTANT_ID` + `TELNYX_ELEVENLABS_MODEL` | `smokePass=true`. `K1/K2-Verifikation fehlgeschlagen: … start_speaking_wait_seconds …` = Telnyx hat still verworfen -> Schema-Slot per GET erneut pruefen | offen |
| AL-P3 | Nachher-Messung ueber >= 5 Anrufe: Rest-Anteil, `chars`-Median, `turns/Anruf`, `Tokens/Anruf` | Rest sinkt >= 200 ms **bei gleichbleibendem `chars`-Median**; `turns/Anruf` steigt <= 15 % und die Turn-Rate bleibt unter `TELNYX_SHIM_MAX_TURNS_PER_MIN` (30). Sonst zurueckdrehen; max. 2 Runden | offen |
| AL-P4 | Median `roundtrips` ueber **>= 20** Turns mit `take_message` (Prod-`turn_ok` oder Bench) | in **>= 70 %** dieser Turns `"roundtrips":1` statt 2; Median `turn_ok.latencyMs` dieser Turns **>= 800 ms** niedriger als die AL-P1-Basislinie | offen |
| AL-P4 | Gegenprobe Modellgehorsam | Anteil Turns mit `"speechEmpty":true` steigt **nicht** gegenueber der AL-P1-Basislinie; steigt er, ist Hebel B (Tool-Description) zurueckzudrehen, nicht Hebel A | offen |
| AL-P5 | Eroeffnungsfenster **nachher** aus >= 3 echten Aufnahmen (bis `speak.ended`), gegen die AL-P1-Basislinie | Worst-Case-Fenster (langer Auftrag) **<= 13 s** statt ~18 s (nachgerechnet mit der gebauten Kappe `OPENING_GOAL_MAX_CHARS=75`/`BENCH_MAX_OPENING_CHARS=229` und den in AL-P1 gemessenen 17,3-20,3 Zeichen/s: 11,3-13,2 s, s. Kommentar in src/claude.js; **11 s ist mit dieser Kappe rechnerisch nicht erreichbar**, das war die Zahl vor der Review-Anhebung 70->75); Abbruchquote (`callerTurns`) sinkt oder bleibt gleich. Klingt der Erst-Turn unvollstaendig -> `OPENING_GOAL_MAX_CHARS` (src/claude.js) **anheben**, NICHT die `situationOutbound`-Anweisung anfassen (die traegt R5/stab-p8) | offen |
| AL-P5 | Provisioner-Lauf fuer `user_idle_reply_secs=2`: `node scripts/telnyx-assistant-provision.mjs` mit **explizit gesetzten** `TELNYX_ASSISTANT_ID` + `TELNYX_ELEVENLABS_MODEL` | `smokePass=true`; danach `turns/Anruf`-Median ueber >= 5 Anrufe **<= +15 %** gegen die AL-P1-Basislinie und kein hoerbares Ins-Wort-Fallen. Sonst zurueck auf 4 (Zwischenstufe 3), max. 2 Runden. **Bis zu diesem Lauf ist die Code-Aenderung live wirkungslos.** Vormerk fuer AL-P14: `USER_IDLE_REPLY_SECS` muss >= `consultTimeoutMs` bleiben | offen |
| AL-P5 | Bench-Nachweis im naechsten `npm run convo-bench`-Lauf | Check `opening_chars_before_yield` gruen auf allen outbound-Szenarien (`<= 229 Zeichen`, `BENCH_MAX_OPENING_CHARS` in scripts/convo-bench/checks.mjs); der `value` liegt sichtbar unter dem Vor-AL-P5-Wert | offen |
| AL-P8 | Baseline auf dem Shim-Treiber: `ANTHROPIC_API_KEY` setzen, dann `npm run convo-bench run --all --repeat 5 --driver shim --out data/convo-bench/baseline-al-p8` | 15 Reports je Szenario-Repeat, `meta.driver === "shim"`, `ended_via` ueberwiegend `agent_hangup`/`turn_cap` (nicht `shim_denied`/`persona_error`), `cost_estimate_usd` in der Summenzeile plausibel (< $1). Kostet echtes Geld -> gehoert dem Owner. Ab hier weist jede Folgephase ihren Gewinn per `compare` gegen dieses Verzeichnis nach | offen |
| AL-P8 | Gegenprobe auf dem TeXML-Treiber: derselbe Lauf mit `--driver texml` | Reports vorhanden, `meta.driver === "texml"`; Differenz zu den Shim-Zahlen schwarz auf weiss notiert. Nur einmal, danach ist der TeXML-Treiber Altlast-Referenz | offen |
| AL-P9 | Bench-Luecke schliessen (`scripts/convo-bench/runner.mjs` seedet den Call direkt und ruft `fetchPrecallBriefing` nie auf, meidet `POST /api/calls` bewusst) — entweder eine eigene Phase "Briefing-Vorlauf fuer den Bench" bauen ODER den Blindtest ueber echte Anrufe fahren | eine der beiden Optionen ist umgesetzt, `PRECALL_BRIEFING_ENABLED` wirkt im gewaehlten Pfad nachweislich (Request-Zaehler > 0) | offen |
| AL-P9 | `PRECALL_BRIEFING_ENABLED=true` im Render-Dashboard setzen, NACH bestandenem Blindtest | Flag steht im Dashboard auf `true`; Rueckweg ist derselbe Schalter (zurueck auf `false`) | offen |
| AL-P9 | Blindtest 5 Anrufe MIT Briefing / 5 OHNE Briefing (erst moeglich, sobald die Bench-Luecke geschlossen ist oder ueber echte Anrufe) | 10 Aufnahmen erzeugt, sauber der jeweiligen Gruppe zugeordnet | offen |
| AL-P9 | 5 Aufnahmen blind hoeren (Gruppenzugehoerigkeit dem Hoerer unbekannt), 1-5 bewerten | Bewertung notiert (bindend, ersetzt keine Metrik) | offen |
| AL-P9 | `open_questions` in >= 3 von 10 Faellen gefuellt und zutreffend, gezaehlt am persistierten `call.context` (z.B. `srv.readStore()` lokal, `psql`-Forensikpfad in Prod) | Anteil >= 3/10 notiert; ist der Anteil niedriger, gilt das Feld als nicht belastbar | offen |
| AL-P10 | `RESEARCH_ENABLED=true` im Render-Dashboard setzen (Owner-Gate O3), NACH Preispruefung von `RESEARCH_SEARCH_FEE_CENTS` gegen die aktuelle Anthropic-Preisliste (`web_search`-Abrechnung pro Suche) | Flag steht im Dashboard auf `true`; Preis im Kommentar/Env verifiziert, nicht nur der Startwert 1 Cent uebernommen | offen |
| AL-P10 | Abnahme 2: "Tisch bei Restaurant X" — echter Anruf mit aktivem `RESEARCH_ENABLED` UND `settings.allowResearch=true` fuer den Tenant, Suchtreffer (z.B. Oeffnungszeiten) landen nachweislich im HINTERGRUND-Block | Render-Log `[precall-briefing] recherche (suchen=N, max=1, stop=…)` mit `N>=1`; `call.context.key_facts` enthaelt einen recherchierten Fakt | offen |
| AL-P10 | Abnahme 3: haelt der Timeout (`PRECALL_BRIEFING_TIMEOUT_MS`, Ist 6000 ms) mit aktiver Suche? | Anteil der Briefings mit `stop=pause_turn`/Timeout ueber >= 5 echte Anrufe notiert; reisst der Timeout regelmaessig, entweder `PRECALL_BRIEFING_TIMEOUT_MS` anheben ODER die Recherche wieder abschalten (Plan-Wortlaut, kein Mittelweg) | offen |
| AL-P10 | Self-Service-Schreibpfad fuer `allowResearch` (bewusst ausgeklammert, D8/AL-P10-Plan) — Owner-Entscheidung, ob Tenants die Recherche selbst freischalten duerfen | Owner-Entscheidung dokumentiert; falls ja, eigene kleine Folgephase (SELF_SERVICE_RESTRICT_ONLY_FIELDS o.ae.) | offen |
| AL-P10 | Herkunftsmarkierung fuer Action-Items aus Recherche-Treffern (Plan-Bullet/A3, bewusst NICHT in AL-P10 — Bahn B, kein `claude.js`-Edit) | eigene Folgephase mit `claude.js`-Besitzer (A4: ein Besitzer je Tool-Loop-Eingriff) | offen |
| AL-P11 | Bench-Abnahme (kostet echtes Geld): `npm run convo-bench` mit **5 Repeats** ueber die vier `expectedResult`-Szenarien (`friseur-voll`, `termin-duenn`, `mandat-innerhalb`, `inbound-nachricht`) | Check `result_slots_present` >= 0,8 Trefferquote **und** die `objective_achieved="unclear"`-Quote sinkt gegen den AL-P8-Referenzlauf | offen |
| AL-P11 | `EVIDENCE_RETENTION_DAYS` bleibt 0, bis die Datenschutzerklaerung (`apps/web`) woertliche Zitate Dritter + ihre Frist nennt. Danach: Wert setzen (Vorschlag 7), Sweep-Wirkung auf der Prod-DB per `psql` verifizieren | Datenschutzerklaerung nennt woertliche Zitate + Frist; `EVIDENCE_RETENTION_DAYS` im Render-Dashboard auf > 0; `psql`-Stichprobe zeigt `result->'evidence'` faellt nach der gesetzten Frist | offen |
| AL-P12 | Bench-Abnahme (kostet echtes Geld): `npm run convo-bench run --scenario zweiter-anruf-gedaechtnis --repeat 5 --driver shim` | Check `memory_fact_recalled` in **5/5** Repeats gruen (der Agent nennt den geseedeten Fakt aus Call 1 ohne Briefing) | offen |
| AL-P12 | `allowCallMemory=true` fuer den Tenant setzen (POST /api/settings, Admin-Pfad — es gibt bewusst keinen Self-Service-Schreibpfad) | Setting steht auf `true`; Rueckweg ist derselbe Schalter | offen |
| AL-P12 | Datenschutz-Vorpruefung vor dem Scharfschalten in Prod: nennt die Datenschutzerklaerung (`apps/web`) die Wiederverwendung von Gespraechsergebnissen ueber Anrufe hinweg? | Owner-Entscheidung dokumentiert (Muster O5/Deploy-Kopplung — Reihenfolge, kein Code-Gate) | offen |
| AL-P13 | Scharfschalten: `CONSULT_ENABLED=true` im Render-Dashboard (wirkt nur als Schnittmenge mit `ASSISTANT_CONTEXT_ENABLED=true`) UND `allowConsult=true` im Rechteprofil des Test-Tenants | beide Flags stehen; `GET /api/calls/<id>/consult` liefert kein 404 mehr. Rueckweg ist derselbe Schalter | offen |
| AL-P13 | **Abnahme 1:** 10 echte `place_call` aus claude.ai; gezaehlt wird, wie oft das Client-Modell `await_call_event` zieht | im Render-Log erscheint `[mcp] … tools/call await_call_event` (das Diagnose-Label traegt seit AL-P13 den Werkzeugnamen). In **>= 7 von 10** Anrufen mindestens ein Zug. Weniger heisst: Server-`instructions` + Tool-Description reichen dem Host nicht — dann ist der Kanal NICHT abgenommen, egal wie gruen die Suite ist | offen |
| AL-P13 | **Abnahme 2 (O9, ChatGPT ist Ziel):** dieselbe Messung mit **>= 5** echten `place_call` aus ChatGPT | mindestens 5 Anrufe gefahren, Zug-Quote notiert. Zieht ChatGPT gar nicht, ist das ein Host-Befund fuer AL-P14/P15, kein Code-Bug | offen |
| AL-P13 | **Abnahme 3:** Consult #0 (die `open_questions` des Briefings) wird beantwortet, BEVOR der erste Agent-Turn laeuft | in **>= 5 von 10** Anrufen traegt `call.context.key_facts` die Antwort, und `consults[0].answeredAt` liegt vor dem ersten Agent-Transkript-Eintrag (`srv.readStore()` lokal, `psql`-Forensikpfad in Prod). Setzt `PRECALL_BRIEFING_ENABLED=true` voraus — ohne Briefing gibt es keine `open_questions` und damit nie einen Consult #0 | offen |
| AL-P13 | **Abnahme 5:** Schleifentreue — das Client-Modell bleibt bis zum Anruf-Ende dran | in **>= 5 von 10** Anrufen endet die Poll-Kette mit einem `await_call_event`, das `event="done"` liefert (statt vorher abzubrechen). Zaehlbar am Log-Label; im Chat erscheint die Zusammenfassung OHNE separaten `get_transcript`-Aufruf | offen |
| AL-P13 | **Abnahme 4 (Live-Teil):** X parallele Polls ueber Y Minuten am ECHTEN `/mcp`, ohne dass sich der Client selbst mit 429 blockiert | keine `429` in den Render-Logs waehrend eines Anrufs mit durchgehendem Polling. Die Arithmetik (`60000/22000 * 4` ~ 11 Requests/min gegen `RATE_LIMIT_PER_MIN`) ist testseitig gepinnt — der Live-Beleg fehlt | offen |
| AL-P13 | **Abnahme 7:** der einmalige Berechtigungs-Hinweis am `place_call`-Ergebnis genuegt — kein Klick pro Rueckfrage | im echten claude.ai-Connector: nach einmaligem Setzen der Werkzeug-Berechtigung auf „Zulassen" kommen die Folge-Polls ohne weitere Rueckfrage durch | offen |
| AL-P13 | Datenschutz-Grenze fuer AL-P14 vormerken: in P13 stammen Consult-Fragen NUR aus `context.open_questions` (Auftrag des Nutzers), NIE aus fremder Rede | Owner-Entscheidung dokumentiert, BEVOR AL-P14 Fragen aus dem laufenden Gespraech formuliert — dann exportiert ein Consult Aussagen eines Dritten, der nie eingewilligt hat | offen |
| AL-P14 | **AL-P14-1 (Ende-zu-Ende):** ein echter Outbound-Anruf, in dem der Agent `get_consult` zieht — Fueller hoerbar, die Antwort kommt im Folge-Turn an | Aufnahme belegt den Ueberbrueckungssatz; TTFA des Fueller-Turns <= 2,5 s, ablesbar an der bestehenden Messgroesse `[telnyx-shim] turn_ok {"latencyMs":…,"toolNames":["get_consult"]}` | offen |
| AL-P14 | **AL-P14-2 (Timeout):** derselbe Anruf ohne jede `answer_consult` | hoerbarer Mandats-/`take_message`-Rueckfall, der Anruf laeuft weiter, **kein** eingefrorener Anruf; im Store steht `consults[n].status="timed_out"` | offen |
| AL-P14 | **AL-P14-3 (Doppelrede):** wie oft spricht der Agent zwischen Fueller und Antwort? | Aufnahme belegt **hoechstens einen** kurzen Halte-Satz. *Bewusste Abweichung von der Spec-Formulierung „redet nicht ein zweites Mal": ein voellig stummer Turn setzt ein ungemessenes Telnyx-Verhalten bei leerem Completion-Content voraus (der Shim wertet `speechEmpty` heute als Anomalie) — das waere Raten. Begruendung steht in `src/consult/in-call.js`.* | offen |
| AL-P14 | **AL-P14-4 (Quote, kostet echtes Geld):** `npm run convo-bench` mit **n >= 5** | `get_consult` feuert in **<= 20 %** der Turns (zaehlbar an `toolNames` im `turn_ok`-Log). **Nie feuern ist ein Erfolg**, nicht ein Fehlschlag | offen |
| AL-P14 | **AL-P14-5 (`USER_IDLE_REPLY_SECS` live nachlesen):** Ist-Wert per Objekt-`GET` am Live-Assistant ablesen und protokollieren — **nicht** aus `scripts/telnyx-assistant-provision.mjs` uebernehmen (die Datei schreibt, sie misst nicht) | Ist-Wert notiert und gegen `CONSULT_TIMEOUT_MS = 4000` bewertet; ist der Idle-Wert deutlich kleiner, wird der Halte-Turn haeufiger als erwartet | offen |
| AL-P14 | **AL-P14-6 (Freischaltung):** `IN_CALL_CONSULT_ENABLED=true` erst, **nachdem** die Datenschutzerklaerung in `apps/web` die Weitergabe von Inhalten aus dem laufenden Gespraech an den MCP-Host nennt | Datenschutzerklaerung nennt die Weitergabe (Lab -> Live ueber `docs/RUNBOOK-LAB-LIVE.md`); danach Env-Aenderung nach `tasks/al-env-changes.md`. Das Boot-Banner MUSS `In-Call-Consult: AKTIV` zeigen. Rueckweg ist derselbe Schalter | offen |
| AL-P10b | **AL-P10b-1 (Ende-zu-Ende):** ein echter Outbound-Anruf, in dem der Agent `look_up` zieht | Aufnahme belegt: der Agent nennt die nachgeschlagene Sachauskunft im Folge-Turn, ohne die Suche zu erwaehnen und ohne eine Quelle zu nennen; im Render-Log steht `[lookup] fertig call=… ok=true` | offen |
| AL-P10b | **AL-P10b-2 (maximale Stille):** dieselbe Aufnahme | zwischen Ueberbrueckungssatz und Antwort ist **keine tote Leitung** hoerbar. Setzt `THINKING_SIGNAL_ENABLED=true` UND `TELNYX_SHIM_TOKEN_STREAMING=true` voraus - ohne beides gibt es keine Bruecke und die Suchzeit wird zu Stille | offen |
| AL-P10b | **AL-P10b-3 (Suchlatenz p50/p95, O8):** ueber **>= 20** Suchen die `dauer_ms=`-Werte der `[lookup] fertig`-Zeilen einsammeln | p50 und p95 notiert und gegen `LOOKUP_TIMEOUT_MS = 2500` bewertet. Liegt p95 an der Frist, ist der Anbieter zu langsam fuer den In-Call-Pfad -> Flag zurueck auf `false` (der Bestandspfad bleibt vollstaendig erhalten) | offen |
| AL-P10b | **Owner-Aufgabe:** `BRAVE_SEARCH_API_KEY` im Render-Dashboard setzen (zum Bauen/Testen NICHT noetig, der Adapter faehrt gegen Fixtures) | Key steht im Dashboard, nirgends im Repo. Leerer Key = Feature fail-closed inaktiv, auch bei `LOOKUP_ENABLED=true` | offen |
| AL-P10b | **Owner-Aufgabe:** `allowLookup=true` im Rechteprofil des Test-Tenants setzen (Admin-Pfad) | Recht steht; Default bleibt `false` in `DEFAULT_PROFILE` UND `PAID_PLAN_PROFILE` (kein Plan-Freibrief). Rueckweg ist derselbe Schalter | offen |
| AL-P10b | **AL-P10b-4 (Freischaltung):** `LOOKUP_ENABLED=true` erst, **nachdem** die Datenschutzerklaerung in `apps/web` den **zweiten Auftragsverarbeiter** (Brave Search) nennt UND AL-P10b-1..3 bestanden sind | Datenschutzerklaerung nennt den Verarbeiter (Lab -> Live ueber `docs/RUNBOOK-LAB-LIVE.md`); danach Env-Aenderung nach `tasks/al-env-changes.md`. Rueckweg ist derselbe Schalter | offen |
| AL-P10b | **Offener Punkt (E3, bewusst NICHT in dieser Phase gebaut):** `agentToolNames()` bleibt unveraendert, das Pre-Call-Briefing sagt dem briefenden Modell weiterhin „der Agent kann nichts nachschlagen" | Owner entscheidet, ob der Briefing-Satz nachgezogen wird. Konservativ ist der Bestand: das Briefing liefert dann eher MEHR Fakten vorab - genau der Zweck von AL-P10 | offen |
| AL-P10b | **Offener Punkt (A3-Restschuld, NICHT in dieser Phase gebaut):** Herkunftsmarkierung fuer Action-Items, die auf einem Suchtreffer beruhen | Owner entscheidet, ob eine eigene Mini-Phase noetig ist. Heute ist ein Suchtreffer im HINTERGRUND von einem Briefing-Fakt nicht unterscheidbar | offen |
| AL-P7 | **AL-P7-A (Freischaltung):** `TELNYX_SHIM_TOKEN_STREAMING=true` im Render-Dashboard setzen (Bewegung nach `tasks/al-env-changes.md` protokollieren) | Boot-Banner zeigt `Token-Streaming: AKTIV (TELNYX_SHIM_TOKEN_STREAMING=true)`; `[telnyx-shim] turn_ok` traegt `"streamChunks":` mit einem Wert **> 0** | offen |
| AL-P7 | **AL-P7-B (Abnahme 1, Latenz):** >= 5 gescriptete Anrufe, danach `node scripts/telnyx-call-latency.mjs <conversation-id>` | Median `end_user_perceived_latency_ms` sinkt gegen die AL-P1-Baseline um **>= 300 ms**. Weniger -> Flag zurueck auf `false` (der alte Pfad bleibt vollstaendig erhalten) | offen |
| AL-P7 | **AL-P7-C (Abnahme 3, Widerspruch):** Aufnahmen der 5 Anrufe durchhoeren | kein Fall „Satz gesprochen, danach widersprach das Werkzeugergebnis". *(Strukturell ausgeschlossen: gestreamt wird nur eine Runde, deren Werkzeugsatz ausschliesslich Seiteneffekt-Werkzeuge enthaelt — `streamSinkFor` in `src/claude.js`. Die Probe ist die Gegenkontrolle am Ohr.)* | offen |
| AL-P7 | **AL-P7-D (Abnahme 4, Barge-in):** Owner faellt mit einem echten Satz ins Wort / sagt nur „mhm" | Ins-Wort-fallen stoppt sofort, „mhm" nicht. Reisst die Probe -> Flag zurueck auf `false` | offen |
| AL-P7b | **AL-P7b — Ueberbrueckung hoerbar:** Testanruf mit kuenstlich verzoegertem Zug | in der Aufnahme belegt: Signal binnen 1,5 s, danach die Antwort. Im Render-Log traegt die zugehoerige `turn_ok`-Zeile `"thinkingSignal":true` | offen |
| AL-P7b | **AL-P7b — kein Abschneiden (Owner-Kriterium):** dieselbe Aufnahme | die Ueberbrueckung ist vollstaendig gesprochen, die Antwort folgt danach. Reisst sie ab -> Phase zurueckdrehen (Flag-Flip) | offen |
| AL-P7b | **AL-P7b — kein Nachhaken in die eigene Wartezeit (MESSUNG, s. E5 in der Umsetzungsspec):** waehrend eines laufenden Zuges | **keine zweite** `turn_ok`-Zeile mit demselben `call=` und hoeherem `turnSeq`. Erscheint sie -> eigene Mini-Phase (In-Flight-Riegel im Shim); erst messen, dann bauen | offen |
| AL-P7b | **AL-P7b — Flag anschalten:** `THINKING_SIGNAL_ENABLED=true` im Render-Dashboard, NACH bestandenem Testanruf (setzt `TELNYX_SHIM_TOKEN_STREAMING=true` voraus) | Flag steht im Dashboard auf `true`, Boot-Banner zeigt `Denk-Signal: AKTIV`. Rueckweg ist derselbe Schalter | offen |

---

## AL-P2 (SSE-Spike) — ERLEDIGT, nichts mehr zu tun

Gemessen am 2026-07-31 auf dem Live-Dienst gegen die Mobilnummer des Owners:
**`status=incremental`** (GRUEN) — `audio_first_token_duration_ms`-Median 129 ms bei
8000 ms Rueckhalt, zweiter Anruf 99 ms bei 30 000 ms; der Telnyx-Turn-Timeout liegt
damit **ueber 30 s**. Zweitbeleg am Gehoer des Owners. Zahlen, Call-/Conversation-IDs
und Deploy stehen in `tasks/al-chain-state.md`; die Env-Bewegungen in
`tasks/al-env-changes.md`.

Der befristete Schalter ist mit **AL-P2z** ersatzlos aus dem Code entfernt (Schalter,
beide Env-Keys, `e164Env`, Footgun, Banner-Zeile, Log-Kanal, `sleepMs`, Spike-Urteil im
Messwerkzeug, Tests) — wie zugesagt als eigene Phase, nicht als „Flag auf 0". Die
verwaisten Werte `TELNYX_SSE_SPIKE_DELAY_MS`/`TELNYX_SSE_SPIKE_CALLEE` im
dashboard-gemanagten Render-Dienst loescht der Owner; sie sind wirkungslos, weil
`src/config.js` sie nicht mehr liest.

> **Ausserhalb des Code-Scopes (Owner-Uebergabe, im Bericht nennen, nicht ausfuehren):** die
> beiden Env-Schluessel im Render-Dashboard loeschen. Kein Code haengt daran (fail-safe:
> unbekannte Env-Keys werden ignoriert).
