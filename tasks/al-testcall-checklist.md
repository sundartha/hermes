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

---

## BLOCKER Nr. 1 — ohne den geht die Kette nicht weiter

**AL-P2 (SSE-Spike) braucht einen Deploy. Er ist die einzige Entscheidung, an der noch
7 Phasen haengen: AL-P7, AL-P7b, AL-P10b, AL-P14, AL-P15.**

Warum die Session ihn nicht selbst fahren konnte: Telnyx erreicht unseren Custom-LLM-Shim
ueber `base_url = <oeffentliche URL>/v1`. Der Spike misst, ob Telnyx unseren SSE-Strom
inkrementell konsumiert — dafuer muss der Verzoegerungs-Schalter **im laufenden, oeffentlich
erreichbaren Shim** stecken. Deployen war dieser Session untersagt, und einen Tunnel auf den
Entwicklungsrechner deckt die Freigabe nicht.

**Was der Owner tun muss, in dieser Reihenfolge:**

1. **Entscheiden, wo der Spike laeuft.** Zwei Wege:
   - **(a) Wegwerf-Service auf Render** mit dem Spike-Branch — beruehrt den Live-Dienst nicht.
     Sauberste Variante, kostet einen zusaetzlichen Service.
   - **(b) Tunnel** (ngrok/cloudflared) auf einen lokal laufenden Shim. Billiger, aber ein
     lokaler Server mit Live-Zugangsdaten haengt am oeffentlichen Netz.
2. **Wegwerf-Umgebung anlegen** — Freigabe liegt vor, Bestand ist gemessen:
   - Absender-DID: `+18643028341` (Tenant `owner`, seit 2026-06-28 ungenutzt)
   - Ziel-DID (nimmt ab und schweigt): `+15739090177` (seit 2026-07-24 ungenutzt)
   - **`+17067101188` NICHT anfassen** — das ist die live genutzte Nummer (Outbound 07-27).
   - **Achtung, die Uebergabe-Notiz stimmt hier nicht:** es gibt **keine** herrenlose Ersatz-DID.
     Alle drei sind `active` und je die einzige Nummer eines Tenants. Umhaengen nimmt dem
     Tenant Inbound UND Outbound — **Vorher-Zustand notieren, hinterher per Objekt-GET
     verifizieren, dass beide wieder auf `Hermes` (`2982643896460248193`) zeigen.**
   - Wegwerf-Assistant: einer der drei ungenutzten `Blank`-Assistants.
   - **NIE ueber `scripts/telnyx-assistant-provision.mjs`** — es schreibt die ganze Live-Config
     aus der lokalen `.env`.
3. **Spike fahren, Urteil festhalten:** Sprachbeginn nach ~1 s = **GRUEN** (AL-P7 ist
   gerechtfertigt), nach ~8 s = **ROT** (AL-P7 wird ersatzlos gestrichen, AL-P7b nimmt Weg B).
   Doppelt messbar: Aufnahme UND `audio_first_token_duration_ms`.
   Den Telnyx-Turn-Timeout als Zahl mitprotokollieren (5/10/20/30 s).
4. **Verzoegerungs-Schalter danach ersatzlos entfernen** — das ist Teil der Phase, nicht
   „Flag auf 0". Er wurde bewusst **gar nicht erst** auf Vorrat gebaut.
