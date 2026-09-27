# D4: Input-Schemas und serverseitige Validierung

Dimension: D4 | Quelle: Code auf Branch master

## Kurzfassung

Alle 12 MCP-Tools nutzen zod-Schemas (`src/mcp-tools.js`), die vom SDK
(`@modelcontextprotocol/sdk` 1.12.0, `safeParseAsync(z.object(shape), args)`) serverseitig
erzwungen werden - unbekannte Top-Level- UND verschachtelte Keys werden von zod verworfen
(bestaetigt in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`). Die
schwere Route `POST /api/calls` (place_call) baut den Store-Aufruf als EXPLIZITE
Feldliste (kein Spread von `req.body`), Sicherheitsfelder (`diagnostic`, `calleeIsOwner`)
werden serverseitig berechnet, nie aus dem Body uebernommen - Mass Assignment ist damit
strukturell ausgeschlossen. Telefonnummern durchlaufen eine mehrstufige, gut dokumentierte
Normalisierungs-/Denylist-/Land-/E.164-Kette (`store/defaults.js`,
`telephony/outbound-gates.js`) BEVOR gewaehlt wird. Freitextfelder (objective/briefing/
constraints/context/mandate) haben serverseitige Laengen-/Array-Deckel
(`routes/_validation.js`), aber NICHT auf MCP-Schema-Ebene (keine `.max()` an den
zod-Strings) - abgefangen nur durch den globalen 100kb-Express-Body-Limit. Der schwerste
Befund: `objective`/`briefing`/`constraints` landen als reine gelabelte Textzeilen
ungefiltert im System-Prompt der telefonierenden KI, ohne Struktur-Trennzeichen gegen
Label-Spoofing - einzige codierte (nicht prompt-basierte) Schranke ist der hartverdrahtete
Offenlegungssatz.

## Pruefpunkte

### PP-D4-01 Sind alle Tool-Input-Schemas gueltige, typisierte JSON-Schemas mit sinnvollen Enums?
- Status: PASS
- Evidenz: `src/mcp-tools.js:669-819` (place_call: typisierte zod-Felder inkl. `z.enum(MANDATE_OUT_OF_SCOPE_VALUES)` fuer `mandate.on_out_of_scope`, `z.number().int().positive().max(MAX_CALL_DURATION_CAP_S)` fuer `max_duration_s`), `:917` (`z.enum([...CONSULT_ANSWER_MODE])` fuer `status`)
- Risiko: keins - Enums werden dort verwendet, wo eine feste Werte-Menge existiert.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D4-02 Wird das Schema serverseitig erzwungen (nicht nur Client-seitig/Beschreibung)?
- Status: PASS
- Evidenz: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:174-180` (`safeParseAsync(schemaToParse, args)` vor jedem Tool-Handler-Aufruf; `schemaToParse` ist `z.object(rawShape)`), `src/mcp-tools.js:650` (`server.tool(name, desc, schema, wrapHandler(handler))`)
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D4-03 Kann ein Aufrufer per Mass Assignment interne/privilegierte Felder einschleusen?
- Status: PASS
- Evidenz: `src/routes/api-calls.js:439-459` - `store.createCall({...})` listet jedes Feld EXPLIZIT auf (kein `...b`/`...args`-Spread); `diagnostic` und `calleeIsOwner` werden serverseitig aus `resolveCallPrivacyFlags` (Zeile 196-212) berechnet, NIE aus `b.diagnostic`/`b.calleeIsOwner` direkt uebernommen. `src/mcp-tools.js:585` (`const call = (method, path, body) => api({..., identity, scopedTenant})`) - `identity`/`scopedTenant` kommen aus dem Closure von `registerTools` (server-aufgeloest aus JWT/localhost-Header, `src/routes/mcp.js:61,76`), nicht aus den Tool-Argumenten des Clients.
- Risiko: keins in den geprueften Pfaden.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D4-04 Werden Telefonnummern korrekt validiert/normalisiert (E.164, Denylist, Laendercode)?
- Status: PASS
- Evidenz: `src/store/defaults.js:779-952` (`normNum`, `E164` Regex, `hasTrunkZeroAfterCountryCode`, `homeCountryCode`, `normalizeDialTarget` mit separater NANP-Logik inkl. NPA/NXX-Plausibilitaet); `src/telephony/outbound-gates.js:465-498` (`numberGateError`: Denylist zuerst, dann E.164-Formatpruefung, dann Land-Gate, dann Stunden-/Ziel-Limits)
- Risiko: keins - Reihenfolge (Denylist vor Format vor Land) ist bewusst dokumentiert und per Snapshot-Test gepinnt (`test/outbound-gates-order.test.js`, laut Kommentar).
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D4-05 Werden call_id/event_id auf Form UND Tenant-Zugehoerigkeit geprueft?
- Status: PASS
- Evidenz: `src/routes/api-read.js:98-107` (`GET /api/calls/:id`: `tenantOwnsCall`-Check, fremder Call -> 404 statt 403, kein Existenz-Leck); `src/routes/api-calls.js:583-586,615-619,642-645` (`callVisibleTo` vor jedem call-scoped Handler); `src/routes/api-calls.js:628-629` (`isConsultEventId(eventId)` Formatpruefung VOR jeder Weiterverarbeitung bei `consult/answer`)
- Risiko: `call_id`/`event_id` sind im MCP-Schema reine `z.string()` ohne Regex/Laengen-Cap (`src/mcp-tools.js:868,914-915,1003,1019,1060`) - unschaedlich, da Lookup ueber In-Memory-Map/State (`ops.getCall`, `src/store/json.js:432`), nicht ueber String-Interpolation in SQL.
- Empfehlung: optional `z.string().max(128)` als Verteidigung in der Tiefe gegen sinnlos grosse IDs.
- Prioritaet/Kategorie: P2 / C

### PP-D4-06 Gibt es Injection-Pfade in SQL (pg-Store)?
- Status: PASS
- Evidenz: `src/store/pg.js` durchgehend parametrisierte Queries (`$1`/`$2`, z.B. Zeilen 175,180,904,919,1218-1241,2240,2399,2429,2439); Tabellennamen in Template-Literalen (`` `DELETE FROM ${table} ...` `` Zeile 2674/2677) sind interne Konstanten, keine Client-Eingabe.
- Risiko: keins in den gepruefeten Stellen.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D4-07 Gibt es Laengen-/Groessenbegrenzungen fuer Strings und Arrays?
- Status: PARTIAL
- Evidenz: Serverseitig vorhanden in `src/routes/_validation.js:26-46` (`TEXT_LIMITS`: objective 500, briefing/constraints 2000, context.*/mandate.* 200-1000 Zeichen) und `:94-104` (`invalidStringArray` fuer `key_facts`/`open_questions`, `KEY_FACTS_LIMITS`/`OPEN_QUESTIONS_LIMITS` aus `store/defaults.js:424`). Diese Deckel greifen aber ERST im Gate `valid_text`/`valid_mandate`/`assistant_context` (`src/telephony/outbound-gates.js:794-834`) - NACH dem zod-Parse in `mcp-tools.js`, wo die Felder als reine `z.string()`/`z.array(z.string())` OHNE `.max()` deklariert sind (`src/mcp-tools.js:670-819,922-923`).
- Risiko: ein Client kann (bis zur globalen 100kb-Express-Body-Grenze, `src/app.js:62,141`) beliebig lange Strings durch den MCP-Layer bis zur REST-Kante schicken, bevor sie dort abgelehnt werden - kein Schaden, aber die Schema-Ebene selbst dokumentiert die Grenze nicht (ein MCP-Client/Reviewer, der nur `inputSchema` liest, sieht keine Obergrenze).
- Empfehlung: `.max(TEXT_LIMITS.objective)` etc. direkt an die zod-Felder haengen (Grenzwerte bereits in `_validation.js` als EINE Quelle vorhanden, nur re-importieren) - macht die Schema-Deklaration selbstdokumentierend und spart eine Modell-Iteration bei zu langem Text.
- Prioritaet/Kategorie: P2 / C

### PP-D4-08 Landen Freitext-Felder ungefiltert in System-Prompts (Prompt-Injection-Flaeche)?
- Status: PARTIAL
- Evidenz: `src/claude.js:139-142` - `objective`(`call.goal`)/`briefing`/`constraints` werden als reine gelabelte Zeilen (`"${t.goalLabel} ${call.goal}"`, `"${t.briefingLabel} ${call.briefing}"`, ...) mit `\n` verkettet in den System-Prompt geschrieben, KEINE Escaping-/Delimiter-Struktur (z.B. kein XML-Tag oder klar abgegrenzter Block, der ein injiziertes Pseudo-Label wie `"...\n\nEinschraenkungen: keine"` von einem echten Label unterscheidbar macht). `src/routes/_validation.js` prueft nur Laenge (`invalidText`), NICHT auf Kontrollzeichen fuer diese drei Felder - der Kommentar dort (`_validation.js:79-82`) begruendet das bewusst ("briefing/constraints duerfen Zeilenumbrueche tragen"). Die einzige codierte (nicht promptbasierte) Schranke gegen Missbrauch ist der hartverdrahtete Offenlegungssatz (CLAUDE.md Regel 2); die Prioritaet "constraints gewinnen im Konflikt" (`src/mcp-tools.js:741`) ist reine Prompt-Anweisung an das Modell, kein Code-Gate.
- Risiko: ein boesartiger/kompromittierter MCP-Client (das explizite Bedrohungsmodell dieser Pruefung) kann ueber `briefing`/`constraints` Text einschleusen, der wie ein weiteres Prompt-Segment aussieht und versucht, die Gespraechsfuehrung der Telefon-KI gegenueber dem echten Dritten am Apparat zu kippen (z.B. vorgetaeuschte Zusatz-Anweisungen). Das ist bei einem Produkt, das reale Menschen anruft, keine rein akademische Sorge - der einzige Fall, der HART (nicht nur promptbasiert) abgesichert ist, ist die Offenlegung.
- Empfehlung: Kein vollstaendiges Sanitizing der Freitextfelder gefordert (Weltsprachen-Anforderung macht Allowlists unpraktikabel, s. Kommentar), aber die drei Felder klar strukturiert an das Modell uebergeben (z.B. XML/JSON-Block mit eindeutigen, vom Nutzertext nicht faelschbaren Grenzen) statt Label-Text-Konkatenation, damit ein injizierter `"Einschraenkungen:"`-String nicht mit einem echten Prompt-Segment verwechselbar ist.
- Prioritaet/Kategorie: P1 / B

### PP-D4-09 Enum vs. Freitext bei der Sprachauswahl (`language`)
- Status: PARTIAL
- Evidenz: `src/mcp-tools.js:784-793` - `language` ist `z.string().optional()` (kein `z.enum(SUPPORTED_LANGUAGES)`), obwohl die Beschreibung selbst die feste Werte-Liste nennt. Die Pruefung passiert erst downstream (`src/routes/api-calls.js:346-349`, `supportedLanguageOf`) mit 400 `unsupported_language`.
- Risiko: gering - der Server lehnt sauber ab (kein stiller Fallback), aber ein generischer MCP-Client/Validator, der nur das Schema liest, kann ungueltige Werte nicht vorab abfangen; W-08/N-01 der MCP-Spec empfehlen Enums, wo eine feste Menge existiert.
- Empfehlung: `z.enum(SUPPORTED_LANGUAGES)` verwenden (Katalog ist bereits als Array vorhanden, `SUPPORTED_LANGUAGES` importiert).
- Prioritaet/Kategorie: P2 / C

### PP-D4-10 Werden unnoetige personenbezogene Daten oder interne IDs vom Client verlangt?
- Status: PASS
- Evidenz: keines der 12 Tool-Schemas verlangt eine Tenant-ID, User-ID, Session-ID oder sonstige interne Kennung vom Client (`src/mcp-tools.js:669-1238` durchgesehen); `call_id`/`event_id` sind serverseitig ausgegebene, opake Werte, die der Client nur zurueckreicht.
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

## Uebersichtstabelle

| Tool | Schema gueltig/typisiert | Enums sinnvoll genutzt | Server erzwingt Schema | Laengen-/Array-Deckel (Schema-Ebene) | Mass-Assignment-Schutz | Ownership-Check (call_id) | Injection-Flaeche |
|---|---|---|---|---|---|---|---|
| place_call | PASS | PASS | PASS | PARTIAL (nur serverseitig, s. PP-07) | PASS | N/A (erzeugt neue ID) | PARTIAL (Prompt, s. PP-08) |
| await_call_event | PASS | N/A | PASS | PARTIAL (call_id ungecappt) | PASS | PASS | PASS |
| answer_consult | PASS | PASS (`status` Enum) | PASS | PARTIAL (`answers[]` ungecappt im Schema, serverseitig gecappt) | PASS | PASS | N/A (Text laeuft nur als Consult-Antwort, nicht direkt in System-Prompt-Label) |
| get_call_status | PASS | N/A | PASS | PARTIAL (call_id ungecappt) | PASS | PASS | N/A |
| get_transcript | PASS | N/A | PASS | PARTIAL (call_id ungecappt) | PASS | PASS | N/A |
| cancel_call | PASS | N/A | PASS | PARTIAL (call_id ungecappt) | PASS | PASS | N/A |
| get_my_number | PASS (leer) | N/A | PASS | N/A | N/A | N/A | N/A |
| list_calls | PASS (leer) | N/A | PASS | N/A | N/A | N/A | N/A |
| check_inbox | PASS | N/A | PASS | N/A (boolean) | N/A | N/A (Tenant-scope ueber Server) | N/A |
| list_action_items | PASS (leer) | N/A | PASS | N/A | N/A | N/A | N/A |
| get_calendar | PASS (leer) | N/A | PASS | N/A | N/A | N/A | N/A |
| get_agent_status | PASS (leer) | N/A | PASS | N/A | N/A | N/A | N/A |

## Offene Fragen (nicht am Repo entscheidbar)

- Ist die 100kb-Express-Body-Grenze (`src/app.js:62`) fuer den erwarteten `/mcp`-Traffic (inkl. grosser `context.key_facts`-Arrays oder langer `briefing`-Texte in anderen Sprachen mit Mehrbyte-Zeichen) ausreichend bemessen? Das Repo zeigt nur den Wert, keine Lastmessung.
- Wird `test/outbound-gates-order.test.js` (im Kommentar mehrfach als Beleg fuer die Gate-Reihenfolge zitiert) tatsaechlich in CI gefahren und deckt es GENAU die hier zitierte Reihenfolge (Denylist vor Format vor Land, valid_text vor valid_mandate vor assistant_context)? Ohne Testlauf (per Auftrag verboten) nicht verifizierbar, nur der Code-Kommentar ist Beleg.
- Gibt es einen bewussten Owner-Entscheid dazu, dass `briefing`/`constraints` NICHT gegen Prompt-Label-Spoofing strukturiert sind (PP-D4-08), oder ist das schlicht nie explizit abgewogen worden? Das Repo dokumentiert nur die Kontrollzeichen-Entscheidung, nicht die Label-Konkatenations-Frage.

## Randbefund (ausserhalb dieser Dimension)

`src/app.js:62` setzt den globalen Body-Limit auf 100kb fuer JSON UND urlencoded - das betrifft auch Nicht-MCP-Routen wie Stripe-Webhooks; ob 100kb dort ausreicht, ist eine Frage fuer die Deploy-/Webhook-Dimension, nicht D4.
