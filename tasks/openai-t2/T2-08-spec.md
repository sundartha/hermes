# T2-08 - Geldpfad: Hop-Fristen und Stundenlimit unter Sperre (Spec)

- ID-Umfang (gepinnt): **T-27** ("Apply timeouts and rate limits to expensive or externally visible tools.")
- Branch: `phase/openai-t2-08-hop-timeouts-hour-cap`, Worktree `.../scratchpad/wt-t2-08`, Basis `4cc2e9a` (master).
- Risiko: GELDPFAD + SAFETY-GATE (CLAUDE.md Regel 1). Stundenlimit, Ziel-Cap, Kostendecke, OUTBOUND_FROZEN,
  Abo+KYC, Denylist, Land-Gate, Max-Dauer: nur verschaerfen, nie lockern. Fail-closed: laeuft eine Frist ab
  oder wirft ein Schritt, wird NICHT gewaehlt.
- Keine neue Env-Variable (beide Fristen sind interne Transport-Grenzen, Praezedenz `PLACE_CALL_HOP_TIMEOUT_MS`).
- Kein echter Anruf, keine echte SMS, kein Prod-Zugriff. Tests mit `FAKE_ORIGINATE=true` bzw. gestubbtem voiceControl.

## Befund am Code (Worktree, master 4cc2e9a)

1. `src/mcp-tools.js:62-83` `api()` setzt nur dann ein `signal`, wenn `timeoutMs` uebergeben wird.
   `:863` `const call = (method, path, body) => api({ ... })` uebergibt KEIN `timeoutMs`. Frist haben nur
   `pollConsult` (`:867-881`, CONSULT_POLL_ABORT_MS) und `placeCallHop` (`:887-900`, PLACE_CALL_HOP_TIMEOUT_MS).
   Ohne Frist sind ALLE uebrigen Hops: `answer_consult` (`:1243`), `cancel_call` (`:1386`), `check_inbox`
   (`:1461`), dazu `get_call_status`/`await_call_event`-Abschluss (`:1190`, `:1280`, `:1339`) und alle
   `GET /api/state`-Leser (`:1403`, `:1432`, `:1486`, `:1518`, `:1558`).
2. `src/telephony/outbound-gates.js:364-371` `tenantHourReached` zaehlt `store.countOutboundCallsSince(...)`
   (synchron, In-Memory, zaehlt auch fehlgeschlagene Calls), aufgerufen in `numberGateError` `:485-496`
   (Gate `number_gate`, ~`:775`). Der Datensatz, der den Zaehler erhoeht, entsteht erst in
   `src/routes/api-calls.js:526-528` (`store.withStoreLock(() => claimCallRecord(...))`, `claimCallRecord`
   `:291-299`). Dazwischen liegen `await`s: `reserve_budget` (Lock), Pre-Call-Briefing (`:459`, LLM-Netz),
   Eroeffnungszeile (`:493`, LLM-Netz, auf dem EL-Weg immer).
3. **Rennen gemessen (Vorher-Messung, master 4cc2e9a):** Spawn-Server, `MAX_CALLS_PER_HOUR=2`,
   8 parallele `POST /api/calls` an 8 verschiedene Ziele, `FAKE_ORIGINATE=true`:
   - ohne Netz-await zwischen Gate und Claim: `[200,200,429x6]`, 2 Datensaetze (kein Rennen - die Kette
     laeuft bis createCall in Microtasks durch).
   - mit `PRECALL_BRIEFING_ENABLED=true`, `ASSISTANT_CONTEXT_ENABLED=true`, `LLM_PROVIDER=anthropic`,
     `ANTHROPIC_API_KEY=test-dummy`, `ANTHROPIC_BASE_URL` auf eine lokale LLM-Attrappe, die nach 300 ms mit
     500 antwortet: **`[200 x 8]`, 8 Datensaetze, Limit 2 -> 4-fach ueberholt.**
   Reproduzierer (ausserhalb des Repos): `.../scratchpad/logs-t2-08/race-probe2.test.mjs`
   (`cd <worktree> && NODE_ENV=test node --test <datei>`). Auf dem live laufenden EL-Weg liegt die
   Eroeffnungszeile (LLM-Aufruf) IMMER in diesem Fenster.
4. Derselbe Zaehl-dann-Anlegen-Abstand gilt fuer den Ziel-Cap `perTargetCapReached` (`:375-380`,
   `:491-496`). Parallel auf dasselbe Ziel faengt ihn die Dedup unter demselben Lock ab - ausser der erste
   Anruf endet (z.B. Originate-Fehler) bevor der zweite claimt; dann entsteht ein zweiter Datensatz ueber dem Cap.
5. `withStoreLock` (`src/store.js:443-455`) ist prozess-global, Body synchron (Invariante), Kette laeuft
   bei Wurf weiter (`src/chain-mutex.js` `.then(run, run)`) -> eine Sperre bleibt nach Fehler nicht haengen.

## Schritte

### S1 - Quoten-Pruefung als geteilte, synchrone Funktion in outbound-gates.js
- Was: Die zwei Zaehl-Pruefungen aus `numberGateError` (`:485-496`, stundenlimit + ziel_limit) in EINE
  Funktion ziehen (z.B. `callQuotaError(to, { profile, tenantId })` -> `{status:429, grund, message}` oder
  null). `numberGateError` ruft sie an GENAU derselben Stelle (denylist -> format -> land -> QUOTE ->
  allowlist), Reihenfolge/Texte/Status/Audit byte-gleich. Zusaetzlich `callQuotaDenial(ctx)` bauen, das die
  number_gate-Ablehnungsform liefert (`deny(e.status, {error: e.message}, denialAudit(e.grund, ctx,
  \` requestedBy=${ctx.requestedBy}\`))`), und aus `makeOutboundGates` als `{ gates, callQuotaDenial }`
  zurueckgeben. Rein synchron (laeuft im Lock-Body).
- Wo: `src/telephony/outbound-gates.js:364-380`, `:465-499`, `:967`.
- IDs: T-27. Pfade: REST `POST /api/calls` (einziger Einstieg fuer HTTP /mcp, stdio und Web).
- Beweis: (b) `test/outbound-gates-order.test.js`, `test/number-gate.test.js`,
  `test/gap-10-hour-limit-per-tenant.test.js` gruen ohne Aenderung; (a) `grep -n "tenantHourReached"
  src/telephony/outbound-gates.js` zeigt genau EINE Definition und genau EINEN Aufrufer (die neue Funktion).

### S2 - Verdrahtung server.js -> app.js -> makeCallRoutes, fail-closed Default
- Was: `src/server.js:95` destrukturiert zusaetzlich `callQuotaDenial`; `src/app.js` reicht es im deps-
  Buendel (`:376-390`) an `makeCallRoutes` (`:398ff`) durch. `makeCallRoutes` bekommt den Parameter mit
  einem LAUTEN, fail-closed Default nach dem Muster `elevenLabsCallNotWired` (wirft) - ein fehlverdrahteter
  Aufbau endet im bestehenden Claim-`catch` (503 `CLAIM_ERROR_MESSAGE`, Reserve zurueck, NICHT gewaehlt),
  nie in "keine Pruefung". Kein Default `() => null` (das waere fail-open).
- Wo: `src/server.js:95`, `src/app.js:376-410`, `src/routes/api-calls.js:346-370` (Parameterliste).
- IDs: T-27. Pfade: alle Outbound-Einstiege teilen diese Route.
- Beweis: (a) Code an den drei Stellen; (b) neuer Test "nicht verdrahtet -> 503, 0 Datensaetze, Reserve
  frei" (In-Process, Muster `test/sec-p6-gate-fehlerpfad.test.js#postCall`).
- Tests, die `makeCallRoutes` bauen und dadurch betroffen sein koennen (Bau-Agent misst, welche wirklich
  rot werden, und reicht dort `callQuotaDenial` aus dem echten `makeOutboundGates` bzw. einen expliziten
  Test-Stub durch): `test/sec-p6-gate-fehlerpfad.test.js`, `test/openai-s3-place-call-idempotenz.test.js`
  (Teil B), `test/al-p13-consult-channel.test.js`, `test/el-beende-versuch.test.js`,
  `test/iel-b5-status-ende.test.js`, `test/ie6-s1-katalog-umzug.test.js`, `test/check-staged-suppressions.test.js`.

### S3 - Quote im Claim-Lock erneut pruefen (Rennen schliessen)
- Was: `claimCallRecord` (`src/routes/api-calls.js:291-299`) prueft im SELBEN synchronen Lock-Abschnitt:
  1. Dedup (unveraendert zuerst: ein laufender Anruf wird zurueckgegeben, nichts gewaehlt, kein Slot);
  2. NEU `callQuotaDenial(ctx)` -> bei Ablehnung `{ denial }` zurueck, KEIN `createCall`;
  3. sonst `createCall`.
  Die Route behandelt `claim.denial` wie den Dedup-Zweig: Reserve in einem ZWEITEN kurzen Lock-Abschnitt
  zurueck (`releaseOutboundReserveCents`), `beobachteAblehnung(...)` (Audit grund=stundenlimit/ziel_limit
  + Metrik, wie bei der Gate-Ablehnung), `res.status(denial.status).json(denial.body)` - KEIN Originate,
  KEIN Consult, KEIN Timer, KEIN Kostenprofil. Die Route ist bereits ueberlang: den Ablehnungs-Ausgang als
  Modul-Helfer auslagern (Muster `gibReserveZurueckUndMelde`), nicht inline.
  Die fruehe Pruefung in `number_gate` BLEIBT (spart Briefing-/Eroeffnungs-Token fuer einen Anruf, der
  ohnehin abgelehnt wird); die Lock-Pruefung ist die verbindliche.
  Kein await im Lock-Body (Invariante `store.js` withStoreLock); keine neue Sperre, kein Re-Entrancy-Aufruf.
- Wo: `src/routes/api-calls.js:286-299`, `:524-540`.
- IDs: T-27. Pfade: REST `POST /api/calls` (HTTP /mcp, stdio, Web).
- Beweis: (b) S5-Tests; (a) im Lock-Body steht kein `await` (`sed -n` der Funktion).

### S4 - Frist fuer jeden uebrigen MCP->REST-Hop
- Was: benannte Konstante (Vorschlag `MCP_HOP_TIMEOUT_MS = 60000`, exportiert, KEIN Env-Knopf) und `call()`
  (`src/mcp-tools.js:863`) gibt sie als `timeoutMs` an `api()`. Zeitablauf (`isAbortError`) wird in `call()`
  zu `ToolError(MCP_ERROR_CODE.<NEU, z.B. HOP_TIMEOUT>)`. Neuer Code in `src/i18n/mcp-texts.js:20-33` mit
  Text in ALLEN drei Sprachen (de, fr, en; `test/mcp-tools-language.test.js:260` erzwingt Vollstaendigkeit).
  Textinhalt: Zeitablauf, die Aktion kann trotzdem ausgefuehrt worden sein, Stand erneut abfragen statt blind
  wiederholen - NIE "fehlgeschlagen" behaupten (cancel/answer laufen serverseitig weiter).
  `pollConsult` und `placeCallHop` bleiben unveraendert (eigene Fristen, eigene Abbildung).
  Wert-Herleitung am Seam (im Kommentar UND als Ungleichungs-Test, Muster `test/openai-s3-hop-frist.test.js`
  Test 1): laengster begrenzter Serverweg der uebrigen Hops ist `cancel_call` auf einen gebundenen
  EL-Inbound-Anruf = `EL_TERMINATION_RESULT_ATTEMPTS (3) x EL_ABORT_PROVIDER_TIMEOUT_MS (10000)
  + (3-1) x config.voice...resultPollMs (Default 5000)` = 40000 ms (`src/elevenlabs/outbound.js:230/238/1482-1495`,
  `src/config.js:831`). Alle anderen Ziel-Routen sind synchron (`/api/inbox/poll` `src/routes/api-inbox.js:40`,
  `/consult/answer` `api-calls.js:690`, `GET /api/state`, `GET /api/calls/:id`).
- Wo: `src/mcp-tools.js:57-83`, `:301-320` (Konstanten-Block), `:863`; `src/i18n/mcp-texts.js`.
- IDs: T-27. Pfade: HTTP /mcp UND stdio (beide ueber `registerTools`, `src/mcp-server.js:35`,
  `src/routes/mcp.js`); Token-/OAuth-Modus irrelevant (Hop ist intern). `mcp-no-tenant.js` hat Stubs, keine Hops.
- Beweis: (b) S6-Test.

### S5 - Nebenlaeufigkeits-Tests Stundenlimit (Abnahme 2)
Neue Datei, z.B. `test/openai-t2-08-stundenlimit-sperre.test.js`, KEINE Katalog-ID am Namensanfang.
- T1 (Spawn, echte Route): Reproduzierer aus Befund 3 als Test - LLM-Attrappe mit 300 ms Verzoegerung,
  `MAX_CALLS_PER_HOUR=L` (z.B. 2), N=8 parallele Anfragen an verschiedene Ziele ->
  **genau L x 200, N-L x 429**, 429-Body = bisheriger `hourLimit`-Text, `readStore().calls.length === L`.
  Positiv-Kontrolle im Test: die Attrappe wurde >= L mal getroffen (sonst ist das Fenster nicht offen und
  der Test beweist nichts). MUSS auf master rot sein (8 x 200) - Bau-Agent belegt das vor dem Fix.
- T2 (Spawn, zwei Mandanten, Seed-Muster `test/gap-10-hour-limit-per-tenant.test.js`, `MULTI_TENANT=true`,
  `X-Internal-Identity`): Mandant A N parallele am Limit, Mandant B gleichzeitig 1 Anfrage -> B bekommt 200;
  A genau L.
- T3 (In-Process, Muster sec-p6 `postCall`): `createCall` im Claim wirft einmal -> 503, 0 Datensaetze,
  Reserve frei; die NAECHSTE Anfrage desselben Mandanten -> 200 (Sperre frei, kein Slot verbraucht).
- T4 (In-Process, voiceControl-Stub wirft beim Originate): L=1, erster Anruf -> 500/502, Datensatz `failed`;
  zweiter Anruf desselben Mandanten -> 429 stundenlimit (benannte Entscheidung: ein nicht platzierter Anruf
  BEHAELT den Slot - strenger, Bestandsverhalten "zaehlt bewusst auch fehlgeschlagene",
  `state-ops.js:1745-1752`); Mandant B -> 200.
- T5 (Ziel-Cap, In-Process): `PER_TARGET_CALL_CAP=1`, erster Anruf an Ziel X endet vor dem Claim des zweiten
  (Originate wirft) -> zweiter an X -> 429 ziel_limit, nicht 2 Datensaetze.
- T6 (Dedup-Vorrang): zwei parallele Anfragen an DASSELBE Ziel bei L=1 -> eine 200 dedupliziert=false,
  eine 200 dedupliziert=true, 1 Datensatz (bestehende A1-Semantik bleibt).
- Beweis: (b) `NODE_ENV=test node --test test/openai-t2-08-stundenlimit-sperre.test.js` -> alle ok; T1 auf
  master rot (belegt), nach Fix gruen.

### S6 - Hop-Fristen-Test (Abnahme 1)
Neue Datei, z.B. `test/openai-t2-08-hop-frist.test.js`, reiner Prozess, kein Server-Spawn.
- Lokale Gateway-Attrappe (`http.createServer`, antwortet NIE), `GATEWAY_URL` darauf; `registerTools` mit
  Fake-Server (Muster `captureTools` in `test/openai-s3-hop-frist.test.js:22-33`).
- Damit der Test nicht 60 s wartet: `AbortSignal.timeout` im Test ersetzen durch eine Variante, die das
  angeforderte `ms` protokolliert und nach ~50 ms mit `DOMException(..., "TimeoutError")` abbricht; danach
  zuruecksetzen.
- Pruefen fuer `cancel_call`, `answer_consult`, `check_inbox` (und stichprobenhaft `get_call_status`):
  Ergebnis `isError === true`, Text === `MCP_TEXTS.<lang>.errors[HOP_TIMEOUT]`, protokolliertes `ms ===
  MCP_HOP_TIMEOUT_MS`. Gegenprobe: `await_call_event` protokolliert weiter `CONSULT_POLL_ABORT_MS`,
  `place_call` weiter `PLACE_CALL_HOP_TIMEOUT_MS` (unveraendert).
- Ungleichungs-Test: `MCP_HOP_TIMEOUT_MS > EL_TERMINATION_RESULT_ATTEMPTS * EL_ABORT_PROVIDER_TIMEOUT_MS +
  (EL_TERMINATION_RESULT_ATTEMPTS - 1) * config.<...>.resultPollMs`, mit Positiv-Kontrolle (Summanden > 0).
- Draht-Beleg: stdio und HTTP /mcp teilen `registerTools` -> ein Test am Handler reicht fuer das Verhalten;
  zusaetzlich (a) `grep -n "registerTools(" src/mcp-server.js src/routes/mcp.js` zeigt beide Einstiege.

### S7 - Doku
- `PLAN-SECURITY.md`: Eintrag "Stundenlimit/Ziel-Cap werden im Claim-Lock verbindlich gezaehlt (Rennen
  Gate->Claim geschlossen, gemessen 8/2 vorher); nicht platzierter Anruf behaelt den Slot; Sperre
  prozess-lokal (1 Instanz, OT-3)". Und: jeder MCP->REST-Hop hat eine Frist.
- Kein `docs/OPENAI-*`-Dokument (dokumentFuerOpenAI: nein).
- Beweis: (a) grep auf den Eintrag.

### S8 - Gesamtlauf
- `node --check` fuer jede geaenderte Datei; `npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur
  `# pass`/`# fail` zaehlen; jeder rote Test isoliert wiederholen
  (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`). Server-Reste mit `ps`
  pruefen (nicht pgrep).
- Beweis: (c) `grep -E "^# (pass|fail)" <log>` -> `# fail 0` (bzw. nur isoliert gruene Flakes).

## NICHT bauen
- Keine neue, per-Mandant gekeyte Sperre ueber den ganzen Anrufstart: sie wuerde die Anrufe EINES Mandanten
  fuer die Briefing-/Eroeffnungs-Dauer (Sekunden) serialisieren. Der bestehende globale Lock mit synchronem
  Mikro-Body schliesst das Rennen ohne diese Kosten (s. Widersprueche).
- Keine Env-Variable fuer die Hop-Frist (Operator-Knopf = Weg, die Frist abzuschalten; Praezedenz E3).
- Keine Frist fuer den serverseitigen Telnyx-Hangup-`fetch` (`src/telephony/adapters/telnyx/voice.js:282/296`,
  ohne Timeout): anderer Hop (Server->Provider), nicht T-27 am MCP-Werkzeug; als Befund notiert.
- Kein Aendern der Retry-nach-Zeitablauf-Semantik von place_call am Limit (s. Widersprueche 5).
- Kein Rate-Limit je Mandant am /mcp-Eingang (erledigt in T2-07).
- Keine Aenderung an Kostendecke, Reserve-Logik, OUTBOUND_FROZEN, KYC, Denylist, Land-Gate, Max-Dauer,
  Offenlegung.

## Pre-Mortem (ein Jahr spaeter war T2-08 ein Fehler - was geschah?)
1. **Kein Anruf geht mehr raus** - eine Sperre haengt nach einem Wurf. Entschaerft: keine neue Sperre; der
   bestehende Chain-Mutex laeuft bei Wurf weiter (`.then(run, run)`); Lock-Body bleibt synchron; T3 belegt
   "Wurf im Claim -> naechster Anruf 200".
2. **Alle Mandanten serialisiert** - Entschaerft: der globale Lock umfasst nur synchrone Mikrosekunden
   (Zaehlen + Anlegen), keine Netz-awaits; T2 belegt Mandant B unbeeintraechtigt.
3. **Fehlverdrahtung schaltet die Pruefung still ab** (Default `() => null`). Entschaerft: fail-closed Default,
   der wirft -> 503, nicht gewaehlt; Test "nicht verdrahtet".
4. **Ein Mandant ist eine Stunde gesperrt, weil Originate-Fehler Slots fressen.** Bewusst akzeptiert und
   benannt (strenger): Bestandsverhalten, die fruehe Pruefung zaehlte fehlgeschlagene Anrufe schon immer;
   nur ein Wurf VOR dem Anlegen (kein Datensatz) verbraucht keinen Slot (T3/T4).
5. **Doppelter Anruf durch Retry nach Hop-Frist** (cancel/answer). Entschaerft: Fehlertext sagt "kann
   ausgefuehrt worden sein, Stand abfragen"; cancel ist serverseitig idempotent (Datensatz terminal), answer
   auf eine beantwortete Frage -> 409 (normaler Hinweistext, `:295-299`). Kein Pfad, der waehlt.
6. **Frist zu kurz fuer cancel auf gebundenem EL-Inbound** (Render-Wert ELEVENLABS_RESULT_POLL_MS bis
   60000 -> bis 150 s). Folge nur eine ehrliche Zeitablauf-Meldung, der Hangup laeuft serverseitig weiter -
   kein Geld-, kein Anrufschaden. Ungleichungs-Test haelt den Default-Fall fest.
7. **Mehrere Instanzen** (horizontale Skalierung): prozess-lokaler Lock schliesst das Rennen dann nicht
   mehr. Bestehendes, dokumentiertes Risiko (OT-3, 1 Instanz); in PLAN-SECURITY.md beim Eintrag nennen.
8. **Gebrochener Client**: neue Fehlerkennung nur als isError-Text, keine Schema-/Namensaenderung am
   Werkzeug; kein tools/list-Unterschied.

## Widersprueche Plan <-> Code
1. Plan-Pre-Mortem "Sperre je Mandant": der Code hat EINEN prozess-globalen Store-Lock mit synchronem Body;
   die Pruefung dort zu verankern erfuellt das Ziel (keine Mandanten-Blockade) besser als eine neue
   Mandanten-Sperre ueber den ganzen (sekundenlangen) Anrufstart.
2. Plan nennt nur cancel_call/answer_consult/check_inbox ohne Frist; tatsaechlich hat JEDER Hop ueber `call()`
   keine Frist (u.a. get_call_status, list_calls, GET /api/state-Leser, der Abschluss-GET in
   await_call_event). Plan-Ziel "jeder Hop" -> Umsetzung in `call()`.
3. Das Rennen ist nur offen, wenn zwischen number_gate und Claim ein Netz-await liegt (Briefing/Eroeffnungs-
   zeile). Ohne Briefing/EL im Test: kein Rennen messbar. Der Abnahmetest muss das Fenster deshalb gezielt
   oeffnen (LLM-Attrappe mit Verzoegerung), sonst ist er ohne Positiv-Kontrolle gruen.
4. Plan nennt nur das Stundenlimit; der Ziel-Cap hat dasselbe Zaehl-dann-Anlegen-Fenster (enger Fall:
   erster Anruf endet vor dem zweiten Claim). Wird mitgeschlossen - dieselbe Funktion, strikt strenger.
5. Bestand (nicht geaendert): der E3-Text CALL_START_UNCONFIRMED verspricht "erneuter place_call liefert den
   laufenden Anruf"; am Stundenlimit lehnt number_gate den Retry aber schon VOR der Dedup mit 429 ab.
   Kein Geld-/Anrufschaden (es wird nicht gewaehlt), aber der Text stimmt am Limit nicht.
6. Plan-Zeilenangaben stimmen (mcp-tools.js:60-70 = api(), outbound-gates.js:364-379/485-496,
   api-calls.js:526).

## Owner-Punkte
- Deploy/Push nach Merge (einziges Owner-Gate). Keine Deploy-Vorbedingung: keine neue Env, kein Live-Wert,
  der die Produktion lahmlegen koennte.
