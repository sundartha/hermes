# Anruf-Lebenszyklus, Fehlerverhalten, Betriebsreife
Dimension: D11 | Quelle: Code auf Branch master

## Kurzfassung
Der Zustandsautomat ist real vorhanden und dokumentiert (`active|completed|failed|cancelled`
in `src/store/state-ops.js:314`), terminale Uebergaenge sind set-once/idempotent
(`setCallEndedAt`, `state-ops.js:659`), Abrechnung ist doppelt gegen Doppel-Buchung gesichert
(In-Memory `_finished` + persistiertes `billedAt`, `call-finish.js:265-274`), Provider-Webhooks
haben einen zweischichtigen Wiederholungs-Riegel (Prozess-Cache + persistierter Anker,
`webhook-idempotenz.js:1-16`), und Restart/Re-Attach ist explizit gebaut (`reattach.js`,
inkl. In-Flight-Request-Coalescing gegen Race). Fehlertexte an den MCP-Client sind bewusst
generisch, Stack-Traces/Rohfehler werden serverseitig geloggt, nie an den Client gereicht
(`middleware.js:184`, `mcp-tools.js:635-643`). Schlimmster reeller Befund: das System ist
laut eigener Sicherheits-Doku explizit NUR fuer Single-Instance-Betrieb korrekt (mehrere
In-Memory-Zustaende wie `inFlightByCallId`, `deliveries`-Map, Provisioning-Single-Flight sind
prozesslokal) — das ist fuer eine oeffentliche ChatGPT-Integration mit unbekanntem Lastprofil
ein Skalierungs-Blocker, kein Submission-Blocker per se, aber vor Wachstum zu klaeren.

## Pruefpunkte

### PP-D11-01 Zustandsautomat ist minimal und dokumentiert
- Status: PASS
- Evidenz: `src/store/state-ops.js:314` `status: "active", // active | completed | failed | cancelled`; Terminal-Transition ausschliesslich ueber `setCallEndedAt` (`state-ops.js:659-672`), die NUR aus `status === "active"` heraus schreibt.
- Risiko: keins am Modell selbst; der `dialing`/`in_progress`-Wortlaut in der MCP-Tool-Beschreibung (`mcp-tools.js:1002`) ist eine reine Anzeige-Abbildung, keine echte Store-Spalte — Verwechslungsgefahr fuer kuenftige Entwickler, nicht fuer den Client.
- Empfehlung: keine Aenderung noetig; ggf. Kommentar an der Mapping-Stelle ergaenzen, dass `dialing`/`in_progress` reine View-Werte sind (falls nicht schon vorhanden, nicht verifiziert).
- Prioritaet/Kategorie: P2 / C

### PP-D11-02 Terminale Uebergaenge sind idempotent (kein doppeltes Beenden)
- Status: PASS
- Evidenz: `state-ops.js:659` `if (call.status === "active") { call.status = status; ... }` — ein zweiter Aufruf auf einen bereits terminalen Call ist ein No-op; `call-finish.js:265-274` (`if (!call || call._finished) return;` + separates `if (!call.billedAt)`-Gate fuer die Abrechnung).
- Risiko: keines belegt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / B

### PP-D11-03 Doppelte/verlorene Provider-Webhooks sind behandelt
- Status: PASS
- Evidenz: `src/telephony/webhook-idempotenz.js:1-16` beschreibt zwei Schichten (Prozess-Cache liefert byte-identische Erstantwort erneut aus + persistierter Anker am Call-Datensatz ueberlebt Neustart); Anker kommen aus dem Anbieter-Ereignis (`envelopeAnchor`, Zeile 35-42; `incomingAnchors`, Zeile 47-51), nicht aus eigener Uhr.
- Risiko: Fehlt die SID (kein Anker), gilt laut Kommentar Zeile 49-50 "fail-open dort, wo heute nichts geschuetzt ist" — in Produktion liegt die SID laut Kommentar immer vor, aber das ist eine Annahme, kein hartes Invariant.
- Empfehlung: keine Code-Aenderung noetig fuer Submission; als bekanntes Restrisiko in PLAN-SECURITY.md belassen (dort bereits laut Repo-Konvention dokumentiert, nicht separat verifiziert in dieser Dimension).
- Prioritaet/Kategorie: P2 / C

### PP-D11-04 Wettlauf Webhook/MCP-Reattach bei unbekanntem Call
- Status: PASS
- Evidenz: `src/telephony/reattach.js:31-46` In-Flight-Promise-Cache pro `callId` (Request Coalescing): "ein zweiter/dritter gleichzeitiger Aufruf fuer dieselbe callId bekommt DENSELBEN Promise wie der erste"; danach `finally`-Cleanup, kein Leak.
- Risiko: die Kette wirkt nur PROZESSLOKAL (`const inFlightByCallId = new Map()` am Modul-Top) — zwei parallele Prozessinstanzen sehen die Map jeweils nur bei sich selbst (siehe D11-09).
- Empfehlung: fuer Single-Instance-Launch ausreichend; bei horizontaler Skalierung braucht dieser Mutex ein verteiltes Gegenstueck.
- Prioritaet/Kategorie: P2 / C

### PP-D11-05 Persistenz laufender Zustaende ueberlebt Prozessneustart
- Status: PASS
- Evidenz: `reattach.js` re-hydriert aktive Calls aus der DB (`attachActiveCall`), klassifiziert Restzeit neu (`classifyCallTime`) und armiert den Max-Dauer-Timer neu (`scheduleMaxDurationEnd`, Zeile 68); Budget wird beim Re-Attach NEU geprueft statt wiederhergestellt (Kommentar Zeile 58-66, KS-P1b).
- Risiko: keines am Mechanismus selbst; siehe D11-09 fuer die Grenzen bei >1 Instanz.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / B

### PP-D11-06 Fehlertexte an den MCP-Client sind sicher (kein Leak)
- Status: PASS
- Evidenz: `src/mcp-tools.js:635-644` `wrapHandler` faengt JEDEN Tool-Throw, uebersetzt bekannte `err.code`s (`loc.mcp.errors[err?.code]`) und faellt sonst auf `err?.message` oder einen lokalisierten Auffangsatz zurueck — mit explizitem Kommentar, dass `errText` "KEIN roher Gateway-Body" liefert (Zeile 82-84); `src/middleware.js:184` `errorHandler` liefert IMMER `{ error: "internal error" }`, Stack nur ins Server-Log (Zeile 178-183).
- Risiko: `err?.message` als Fallback in `wrapHandler` (Zeile 640) uebernimmt bei UNBEKANNTEM `err.code` das `message`-Feld direkt aus `api()` (`mcp-tools.js:67-74`), das wiederum `json.error` aus der REST-Antwort uebernimmt. Ist irgendeine REST-Route unter `src/routes/` nicht diszipliniert (z.B. ein `catch` Block, der `err.message` roh in `res.json({error: err.message})` schreibt, statt wie die geprueften Stellen `api-calls.js:525-552` bewusst generisch zu bleiben), liefe die rohe interne Fehlermeldung bis zum ChatGPT-Modell durch. Stichproben (`api-calls.js`, `middleware.js`) zeigen durchgaengig Disziplin; eine vollstaendige Pruefung ALLER `res.status(...).json({error: ...})`-Stellen unter `src/routes/` war in dieser Dimension nicht vollstaendig moeglich (Umfang zu gross fuer diese Prüfung, siehe offene Fragen).
- Empfehlung: eine dedizierte Grep-Pruefung `grep -rn "error: err\|error: e\.message\|error: String(err)" src/routes/` fahren und jede Fundstelle gegen das Muster in `api-calls.js:552` (secret-frei loggen, generische Meldung an Client) abgleichen.
- Prioritaet/Kategorie: P1 / B

### PP-D11-07 Faelschliche Erfolgsmeldungen (Tool meldet Erfolg trotz gescheitertem Call)
- Status: PARTIAL
- Evidenz: `place_call`/`POST /api/calls` gibt bei erfolgreichem Originate `res.json({ ok: true, callId, status: "dialing", ... })` zurueck (Kontext aus `api-calls.js` Umgebung, nicht direkt zitiert), was NUR bedeutet "der Waehlversuch wurde gestartet", nicht "der Anruf kam zustande" — laut Tool-Beschreibung selbst bewusst so kommuniziert: "Returns a call_id immediately ... You do NOT need to poll" (`mcp-tools.js:529`). Scheitert der Anruf spaeter (Provider lehnt ab), lauft der Fehlerpfad ueber `terminateAndBillCall` + `endFailedCallWithReason` (`api-calls.js:525-538`) und der Grund landet in `call.failureReason`, sichtbar ueber `get_call_status`/`await_call_event`.
- Risiko: das ist by design und in sich konsistent (place_call verspricht keinen Erfolg, nur einen `call_id`), aber ein Modell, das NICHT wartet/pollt (obwohl es das laut Instruktion in `mcp-server-instructions` fuer diese Session soll), koennte die initiale `{ok:true}`-Antwort fehlinterpretieren, wenn es die Live-Karte/Widget-Update nicht empfaengt (Fallback-Fall in der Tool-Beschreibung selbst benannt: "if no live update arrives, get_call_status remains available as a fallback").
- Empfehlung: keine Code-Aenderung; das ist eine inhaerente Eigenschaft von asynchron gestarteten Telefonanrufen und bereits in der Tool-Beschreibung offengelegt. Fuer die Submission ist wichtig, dass `get_call_status`/`await_call_event` als Pflicht-Folgeaufruf klar genug in der Beschreibung steht (ist der Fall).
- Prioritaet/Kategorie: P2 / C

### PP-D11-08 Health-/Readiness-Endpunkte
- Status: PARTIAL
- Evidenz: `src/app.js:155-157` `/healthz` liefert `{ ok: true, commit, configHash }` — reine Liveness (Prozess laeuft), OHNE Pruefung von DB-Verbindung, Store-Backend oder Provider-Erreichbarkeit. Kein separater `/readyz`- oder Dependency-Check-Endpunkt gefunden (`grep -rn "readyz" src/` liefert keinen Treffer).
- Risiko: ein Deploy/Render-Health-Check auf `/healthz` meldet "gesund", auch wenn z.B. die Postgres-Verbindung tot ist — Traffic (inkl. MCP-Calls) wird dann an eine Instanz geroutet, die jeden DB-Zugriff mit 500 quittiert.
- Empfehlung: `/healthz` um einen leichten Store-Ping erweitern oder einen separaten `/readyz` einfuehren, den Render als Health-Check-Pfad nutzt — allgemeines Hardening, keine explizite OpenAI-Anforderung.
- Prioritaet/Kategorie: P2 / C

### PP-D11-09 Horizontale Skalierung / Prozesslokaler Zustand
- Status: FAIL (fuer Mehrfach-Instanz-Betrieb; PASS fuer den dokumentierten Single-Instance-Launch)
- Evidenz: `PLAN-SECURITY.md:56` "vor Skalierung auf >1 Instanz einen pg-Advisory-Lock pro numberId; Launch ist Single-Instance."; `PLAN-SECURITY.md:3319-3320` "der Deckel zaehlt lookupLog am Call-Datensatz im SPEICHER der Instanz (pg-Store haelt Zustand im Speicher) - zwei Instanzen [...]"; `PLAN-SECURITY.md:4309` "Single-Flight und Abschluss-Riegel wirken je Prozess: zwei Instanzen waehrend einer [...]"; im Code: `reattach.js:38` `const inFlightByCallId = new Map()`, `webhook-idempotenz.js:120` `const deliveries = new Map()` — beides Modul-/Fabrik-lokaler In-Memory-State, EINE Instanz je Prozess.
- Risiko: Render/produktionsuebliches Auto-Scaling oder ein Rolling-Deploy mit kurzzeitig zwei laufenden Instanzen bricht mehrere der oben gepruesten Idempotenz-Garantien (Reattach-Coalescing, Webhook-Dedup, Provisioning-Single-Flight) an genau der Naht, an der sie am wichtigsten sind: gleichzeitige Bearbeitung desselben Calls durch zwei Prozesse.
- Empfehlung: Vor jeder Aussage "produktionsreif fuer Skalierung" muss diese Grenze explizit bleiben. Fuer die reine ChatGPT-Public-Listing-Frage (Submission) ist das kein Show-Stopper, so lange der Betrieb tatsaechlich Single-Instance faehrt — es ist aber ein Betriebsreife-Punkt, den der Owner kennen muss, BEVOR Traffic durch die Integration real skaliert (bereits in PLAN-SECURITY.md dokumentiert, hier nur bestaetigt, nicht neu entdeckt).
- Prioritaet/Kategorie: P1 / C (kein explizites OpenAI-Muss, aber fuer ehrliche Betriebsreife-Aussage zentral)

### PP-D11-10 Timeout-Verhalten auf dem MCP-Long-Poll-Pfad
- Status: PASS
- Evidenz: `mcp-tools.js:47-52` `await_call_event`/Consult-Poll traegt ein explizites `timeoutMs` (`AbortSignal.timeout`), `pollConsult` (Zeile 589-601) fangt den Abort-Fehler gezielt ab und liefert `NO_CONSULT_EVENT` statt eines `isError`, damit ein normaler Long-Poll-Timeout die Schleife nicht abbricht.
- Risiko: keines belegt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A / B

### PP-D11-11 Rate-Limiting auf dem MCP-Aufrufpfad
- Status: PARTIAL
- Evidenz: `src/app.js:130-136` globaler `createRateLimiter(config.safety.rateLimitPerMin)` greift fuer alle Requests AUSSER `/voice/*` und `isTrustedLocalCaller(req)` — externe `/mcp`-Aufrufe (echte OAuth-Clients, nicht localhost) durchlaufen den Limiter also.
- Risiko: Limiter ist NUR pro Client-IP (Kommentar `middleware.js:157` "Fixed-Window-Rate-Limiter pro Client-IP"), nicht pro Tenant/Token — ein ChatGPT-Backend, das viele Nutzer hinter derselben ausgehenden IP buendelt, teilt sich ein Kontingent; umgekehrt kein Schutz gegen einen einzelnen autorisierten Tenant, der mit wechselnden IPs viele `place_call` abfeuert (Kosten-Gate faengt das Geld ab, nicht die Rate).
- Empfehlung: pruefen, ob ein zusaetzliches Tenant-/Token-basiertes Ratenlimit auf teure Tools (`place_call`) sinnvoll ist — Hardening, keine explizite OpenAI-Pflicht (W-17 verlangt "ratenbegrenzen", ohne die Achse (IP/Tenant) vorzuschreiben).
- Prioritaet/Kategorie: P2 / C

### PP-D11-12 Circuit Breaker / Retry fuer den LLM-Pfad
- Status: PASS
- Evidenz: `src/llm.js` implementiert `withRetry` mit exponentiellem Backoff+Jitter (`backoffDelay`, Zeile 108) und einen Breaker (`makeBreaker`, Zeile 227) mit Zustand `CIRCUIT_OPEN` (Zeile 30); `runResilient` (Zeile 239-244) liefert bei offenem Breaker sofort `outcome: "breaker-open"` statt weiterer Anfragen.
- Risiko: keines belegt; das deckt den LLM-Provider-Pfad, NICHT explizit die Telnyx-/ElevenLabs-Provider-Calls im Provisioning-Drain (siehe `single-flight.js`-Kommentar, dort ausdruecklich als "akzeptiertes Restrisiko P16" fuer den Launch dokumentiert: kein Timeout/AbortController um Provider-Calls im Drain-Pfad).
- Empfehlung: keine neue — das Restrisiko ist bereits eigenstaendig im Code dokumentiert und als bewusste Launch-Entscheidung gekennzeichnet.
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)
- Wird `/healthz` tatsaechlich als Render-Health-Check-Pfad konfiguriert, und fuehrt ein DB-Ausfall dort zu einem Neustart-Loop oder zu stillem Weiterlaufen? (`render.yaml` wurde in dieser Dimension nicht gegen den Health-Check-Pfad abgeglichen.)
- Laeuft Hermes je zeitweise mit >1 Instanz (z.B. waehrend eines Rolling-Deploys auf Render), oder ist "Single-Instance" durch Plan-Konfiguration hart erzwungen? Das Repo dokumentiert die Annahme, aber die Render-Plan-Konfiguration selbst wurde in dieser Dimension nicht gepruft.
- Vollstaendige Inventur aller `res.status(...).json({error: ...})`-Stellen unter `src/routes/` auf Roh-Fehlermeldungs-Leaks (PP-D11-06) wurde nicht erschoepfend durchgefuehrt — nur Stichproben in `api-calls.js` und `middleware.js`.

## Randbefund (ausserhalb dieser Dimension)
Die MCP-Tool-Beschreibungen sind laut Kommentar (`mcp-tools.js:4-11`) bewusst einsprachig
Englisch und per Test gepinnt — das ist ein Auth/i18n-Design-Fund, keiner dieser Dimension.
