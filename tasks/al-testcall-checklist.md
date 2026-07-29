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
   Ausserhalb der Kette, aber **vor** einer Freigabe von AL-P9 zu klaeren.

## Offene Abnahmen je Phase

*(Wird von der Umsetzungs-Session fortgeschrieben, sobald die jeweilige Phase gemergt ist.)*

| Phase | Was abzunehmen ist | Woran man Erfolg erkennt | Stand |
|---|---|---|---|
| AL-P1 | Latenz-Tabelle fuer EINEN echten Anruf: `node scripts/telnyx-call-latency.mjs --call <call_id>` | Fusszeile `status=ok` (unaccounted-Median <= 300 ms). `status=unknown_component` = wichtigster Einzelbefund, **blockiert AL-P7** | offen |
| AL-P1 | Baseline aus **>= 5** gescripteten Anrufen: Median `roundtrips`/Turn, Turns/Anruf, Tokens/Anruf | `turn_ok`-Zeilen im Render-Log tragen `roundtrips`/`toolNames`/`chars`/`speechEmpty`; Mediane notiert | offen |
| AL-P1 | Eroeffnungsfenster aus **>= 3 echten Aufnahmen** (Annahme bis `speak.ended`) | gemessene Sekunden notiert — Basislinie fuer AL-P5, **nicht** hochgerechnet | offen |
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
