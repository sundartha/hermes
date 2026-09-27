# MCP-Protokoll, Transport, OpenAI-Kompatibilitaet

Dimension: D1 | Quelle: Code auf Branch master

## Kurzfassung

Server laeuft auf `@modelcontextprotocol/sdk@1.29.0` (installiert; `package.json` erlaubt sogar
`^1.12.0`) - das ist die Legacy-Handshake-Aera (max. ausgehandelte Version `2025-11-25`, siehe
`SUPPORTED_PROTOCOL_VERSIONS` in der SDK). Die aktuelle Spec-Revision `2026-07-28` (handshake-los,
`_meta`-Versionierung, `server/discover`) wird nicht gesprochen und kann mit dieser SDK-Linie
technisch nicht gesprochen werden - fuer OpenAI ist das unproblematisch (OpenAI dokumentiert
keine Mindestversion, verweist selbst nur auf `2025-06-18`/`2025-11-25`), fuer MCP selbst ist es
die dokumentierte "SDK-Falle". Schwerster eigener Befund: der Streamable-HTTP-Handler in
`src/routes/mcp.js` prueft den `Origin`-Header **gar nicht** (DNS-Rebinding-Schutz T-06, MUSS) -
die SDK haette die Option (`enableDnsRebindingProtection`), sie wird nicht gesetzt. Zweiter
Befund: unbekannte Tool-Namen und ungueltige Tool-Argumente laufen serverseitig (SDK-Code) NICHT
als JSON-RPC-Fehler `-32602`, sondern als `isError:true`-Ergebnis - eine dokumentierte
Spec-Abweichung der SDK, kein Hermes-Code. Tool-Menge ist deterministisch **je Autorisierung**
(Tenant-Profil/Flag), nicht zufaellig - das ist laut Spec zulaessig. Ein proprietaerer, ChatGPT-
spezifischer Adapterpfad existiert bereits (`src/ui/adapters/chatgpt.js`), ist aber im Code selbst
als unvollstaendig dokumentiert (Live-Update im Call-Widget bleibt bei einem echten ChatGPT-Host
stumm). Live-Smoke-Test (`initialize`/`tools/list` per curl) ist an dieser Sandbox gescheitert:
der Server-Hintergrundprozess wird beim Ende des Bash-Tool-Aufrufs beendet, bevor `curl` ihn
erreicht (zwei Versuche, siehe PP-D1-11); Server-Log liegt vor und zeigt korrekten Boot bis zum
Abbruchpunkt.

## Pruefpunkte

### PP-D1-01 SDK-Version vs. installierte Version, Protokoll-Deckung
- Status: FAIL
- Evidenz: `package.json` -> `"@modelcontextprotocol/sdk": "^1.12.0"`; installiert
  `node_modules/@modelcontextprotocol/sdk/package.json` -> `"version": "1.29.0"`;
  `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:2-4` -> `LATEST_PROTOCOL_VERSION =
  '2025-11-25'`, `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26',
  '2024-11-05','2024-10-07']`. Kein `2026-07-28` in der Liste.
- Risiko: Ein reiner "Modern"-Client (nur `_meta`-Versionierung, kein `initialize`) scheitert an
  diesem Server vollstaendig (Spec-Matrix "Modern/Legacy: Fails", `00-mcp-spec.md` V-13/Punkt 1
  der Versions-Fallen). Fuer den konkreten OpenAI-Weg ist das laut `00-openai-anforderungen.md`
  Punkt 4 ("Nicht auffindbar") aktuell folgenlos, weil OpenAI keine Mindestversion nennt und
  selbst auf `2025-06-18`/`2025-11-25` verweist - das Risiko ist protokollseitig, nicht
  OpenAI-seitig, und kann sich mit jeder OpenAI-Doku-Aktualisierung aendern.
- Empfehlung: Vor Submission pruefen, ob OpenAIs Client tatsaechlich (wie in
  `00-openai-anforderungen.md` T-4 belegt) Streamable-HTTP + SSE im Legacy-Stil spricht (das
  deckt diese SDK-Version); ein Upgrade auf die v2-Paketfamilie ist NICHT noetig, wenn das
  zutrifft - sonst gezielt evaluieren.
- Prioritaet/Kategorie: P1 / B

### PP-D1-02 Transport-Endpunkt: genau ein POST-Pfad, GET/DELETE-Verhalten
- Status: PASS
- Evidenz: `src/routes/mcp.js:51` (`router.post("/mcp", mcpAuth, ...)`), `:128-131`
  (`router.get("/mcp", ...) => 405`, `router.delete("/mcp", ...) => 405`).
- Risiko: keins - erfuellt T-01 und ist mit T-25 (SOLL bei reinem 2026-07-28-Server 405 auf
  GET/DELETE) sogar strenger als die Legacy-Erwartung (T-L1 verlangt fuer Legacy-Clients
  eigentlich GET-SSE). Ein Dual-era- oder Legacy-2025-11-25-Client, der eine Session per GET-SSE
  oeffnen will, bekommt hier 405 statt SSE-Stream.
- Empfehlung: Keine Aenderung noetig fuer den OpenAI-Weg (Streamable HTTP genuegt laut T-1); nur
  dokumentieren, dass Legacy-GET-SSE-Clients (2025-03-26/2025-11-25) bewusst nicht bedient
  werden.
- Prioritaet/Kategorie: P2 / C

### PP-D1-03 Stateless-Betrieb: pro Request frischer Server+Transport
- Status: PASS
- Evidenz: `src/routes/mcp.js:113` (`new StreamableHTTPServerTransport({ sessionIdGenerator:
  undefined })`), Kommentar Z.7-11 ("STATELESS (INV-8, KRITISCH)... KEIN Hoisting/Caching ueber
  Requests"), `res.on("close", ...)` Cleanup Z.114-117.
- Risiko: keins bekannt; deckt sich mit OpenAIs eigenem Quickstart-Beispiel (T-29,
  `sessionIdGenerator: undefined // stateless mode`). Kehrseite: `Mcp-Session-Id` wird nie
  gesetzt/erwartet - fuer einen Client, der eine Session ueber mehrere Requests erwartet
  (Legacy T-L2), gibt es keine.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D1-04 Origin-Pruefung / DNS-Rebinding-Schutz auf `/mcp`
- Status: FAIL
- Evidenz: `src/routes/mcp.js:113` instanziiert `StreamableHTTPServerTransport` OHNE
  `allowedOrigins`/`allowedHosts`/`enableDnsRebindingProtection`;
  `node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js:70`
  (`this._enableDnsRebindingProtection = options.enableDnsRebindingProtection ?? false`) und
  `:109` (Pruefung nur `if (!this._enableDnsRebindingProtection) { return; }` - Default AUS).
  Die generische Herkunftspruefung des Gateways (`src/middleware.js:93` `createSameOriginGuard`)
  ist NICHT vor `/mcp` geschaltet (nur `src/self-service-routes.js:1014`); der Code-Kommentar in
  `src/middleware.js:67-69` haelt das explizit fest: "Anbieter-Webhooks, /mcp und
  Server-zu-Server-Aufrufer senden keinen Origin; fail-closed wuerde genau diese Aufrufer
  brechen."
- Risiko: T-06 der MCP-Spec ("Server MUSS den Origin-Header pruefen ... 403 Forbidden") ist
  unerfuellt. Ein Browser-basierter Angreifer, der einen Nutzer auf eine praeparierte Seite
  lockt, koennte (falls der Nutzer bereits ein gueltiges Bearer-Token/eine Session im Client
  haelt, oder bei `MCP_AUTH=off`/lokalem Bypass) per Cross-Origin-Fetch gegen `/mcp` senden - die
  eigentliche Absicherung ist hier ausschliesslich `mcpAuth` (Bearer-Pruefung), nicht der
  Transport selbst. Das ist kein theoretisches DNS-Rebinding-Szenario mehr, sondern schlicht:
  die vom Protokoll geforderte zweite Verteidigungslinie fehlt vollstaendig.
- Empfehlung: Origin-Whitelist fuer bekannte MCP-Client-Origins (ChatGPT/Claude-Connector-
  Domains, wo bekannt) via `allowedOrigins`/`enableDnsRebindingProtection: true` ergaenzen, ODER
  bewusst dokumentieren, warum verzichtet wird (die bestehende Begruendung deckt nur "kein
  Origin-Header" - sie beweist nicht, dass ein VORHANDENER, falscher Origin geprueft wird; das
  ist ein anderer Fall als der im Kommentar adressierte).
- Prioritaet/Kategorie: P0 / B

### PP-D1-05 Pflicht-Header `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, Header-Body-Validierung
- Status: N/A
- Evidenz: Diese Header sind laut `00-mcp-spec.md` T-15/T-18/T-19 erst ab Revision `2026-07-28`
  Pflicht ("Modern"). Die installierte SDK spricht maximal `2025-11-25` (s. PP-D1-01) und
  implementiert diese Header-Pruefungen nicht (kein Treffer fuer `Mcp-Method`/`Mcp-Name` im SDK-
  Quellcode, separat gegengeprueft).
- Risiko: entfaellt fuer den heutigen Legacy-Betrieb; wird relevant, sollte je eine SDK- oder
  OpenAI-Anforderung auf `2026-07-28` heben.
- Empfehlung: keine jetzt.
- Prioritaet/Kategorie: N/A

### PP-D1-06 Fehlerantwort bei unbekanntem Tool / ungueltigen Parametern
- Status: FAIL
- Evidenz: `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:99-138`
  (`CallToolRequestSchema`-Handler): unbekanntes Tool wirft `McpError(ErrorCode.InvalidParams,
  ...)`, das im `catch`-Block (Z.132-139) zu `createToolError(...)` -> `{content:[...],
  isError:true}` wird - NICHT zu einer JSON-RPC-Fehlerantwort mit Code `-32602`. Ausnahme ist
  nur `UrlElicitationRequired` (Z.135-137), die durchgereicht wird.
- Risiko: verletzt W-14 der MCP-Spec ("Zwei getrennte Fehlerwege: Protokollfehler als
  JSON-RPC-Error ... vs. Ausfuehrungsfehler als isError"). Ein Client, der zwischen "Tool
  existiert nicht" (Programmfehler beim Aufrufer, sollte er selbst reparieren) und "Tool
  ausgefuehrt, aber fachlich fehlgeschlagen" (kann dem Modell zur Selbstkorrektur gegeben werden,
  W-15) unterscheiden will, bekommt in beiden Faellen dasselbe Signal (`isError:true` +
  Freitext). Das ist SDK-Verhalten, kein Hermes-eigener Code (`registerTool`-Wrapper in
  `src/mcp-tools.js:626-644` reicht `err.message` nur fuer bereits von `isError:true`
  abgefangene Faelle durch, s. PP-D1-07) - Hermes uebernimmt es unveraendert.
- Empfehlung: Bei einer OpenAI-Einreichung nicht kritisch (T-20 der OpenAI-Doku dokumentiert
  ohnehin nur `isError` als Fehlerkanal, kein eigenes JSON-RPC-Erwartungsprofil) - fuer strikte
  MCP-Konformitaet waere ein SDK-Upgrade oder ein eigener Vorab-Check
  (`_registeredTools[name]` pruefen, bevor der Call an die SDK geht) noetig. Nicht als
  Hermes-Bug behandeln, sondern als bekannte SDK-Grenze dokumentieren.
- Prioritaet/Kategorie: P2 / B

### PP-D1-07 Eigene Fehlerbehandlung in `registerTools`/`wrapHandler`
- Status: PASS
- Evidenz: `src/mcp-tools.js:625-644` (`wrapHandler`): jeder Handler-Throw wird zu
  `errText(loc.mcp.errors[err?.code] || err?.message || ...)` - landet als `isError`-Text-Result,
  nie als unhandled rejection oder Rohfehler mit internen Details (Kommentar Z.622-624: "keine
  process-level unhandled rejection... kein Leak").
- Risiko: keins fuer Protokollstabilitaet. Inhaltliches Secrets-Leck-Risiko (z.B. ob
  `err.message` aus einer Upstream-API je einen Roh-Fehlertext durchreicht) ist Sache der
  Dimension Secrets/Logging (`12-secrets-logging.md`), hier nicht neu bewertet.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D1-08 `tools/list`-Determinismus und Abhaengigkeit von Zustand/Flags/Tenant
- Status: PARTIAL
- Evidenz: `src/routes/mcp.js:105-112` uebergibt `allowCalendar: profile.allowCalendar,
  consultAllowed: consultLoop` an `registerTools`; in `src/mcp-tools.js` sind `get_calendar`
  sowie `await_call_event`/`answer_consult` bedingt registriert (per Grep bestaetigt, siehe
  `02-tool-inventar.md`, dort bereits vollstaendig tabelliert - hier nicht dupliziert). Der
  `/mcp`-Handler selbst filtert nichts zusaetzlich, das SDK liefert `tools/list` aus dem, was
  `registerTools` in genau diesem Request-Server registriert hat.
- Risiko: Spec-konform, WEIL die Variation an der aufgeloesten Autorisierung (Tenant-Profil,
  `scopedTenant` aus dem verifizierten JWT/Legacy-Token, `src/routes/mcp.js:61`) haengt, nicht an
  zufaelligem Serverzustand oder Nebenwirkungen anderer Requests (W-02 erlaubt Variation "je
  Authorization" ausdruecklich). Kein Cache-Problem, da der Server ohnehin pro Request frisch
  gebaut wird (PP-D1-03). Bleibt PARTIAL statt PASS, weil ein und derselbe authentifizierte
  Aufrufer bei `MCP_AUTH=off`/Legacy-Bypass (kein `req.auth`) IMMER denselben `scopedTenant`
  bekommt (Kommentar Z.60: "Flag aus -> requestTenant === BOOTSTRAP_TENANT_ID, byte-identisch")
  - determinismus-technisch also stabil, aber die Tenant-Aufloesung selbst ist ausserhalb
  dieser Dimension zu pruefen (Auth-Dimension).
- Empfehlung: keine aus D1-Sicht; Cache-Trefferquote (W-03, SOLL) ist gegeben, solange
  `registerTools` die Tools in stabiler Reihenfolge registriert (Code-Reihenfolge ist statisch
  je Konfiguration - visuell bestaetigt beim Lesen von `src/mcp-tools.js`, keine dynamische
  Sortierung gefunden).
- Prioritaet/Kategorie: P2 / C

### PP-D1-09 Debug-/Log-Ausgaben im Protokollkanal
- Status: PASS
- Evidenz: `src/routes/mcp.js:63` (`console.log("[mcp]", ...)`) und `:121`
  (`console.error("[mcp]", err.message)`) laufen im HTTP-Kontext (Node-Prozess-stdout/-stderr,
  nicht der HTTP-Response-Body) - der JSON-RPC-Kanal ist strikt `transport.handleRequest`
  (Z.119), das Log geht nach Server-stdout (Render-Log), niemals in die Response. Fuer stdio
  (`src/mcp-server.js:32`, `console.error(...)`): geht nach **stderr**, was fuer stdio-Transport
  korrekt ist (stdout ist dort der einzige JSON-RPC-Kanal, stderr ist der dokumentierte
  Log-Weg, s. `00-mcp-spec.md` Deprecated-Tabelle: "Logging ... stderr bei stdio").
- Risiko: keins gefunden. Kein `console.log` in `src/mcp-server.js` (nur der eine
  `console.error`), kein Treffer, der versehentlich nach stdout schreibt.
- Empfehlung: keine.
- Prioritaet/Kategorie: N/A

### PP-D1-10 Proprietaere Erweiterungen / Host-spezifische Bruecken
- Status: PARTIAL
- Evidenz: `src/ui/contract.js:9-16` (MCP-native `io.modelcontextprotocol/ui`-Extension,
  eigene, schlank nachgebaute SEP-1865-Umsetzung, "kein `@modelcontextprotocol/ext-apps`-Dep")
  und `:43-46` (ChatGPT-Skybridge-Konvention `openai/outputTemplate`, disjunkter
  `text/html+skybridge`-mimeType); `src/ui/registry.js:29-38` (`uiRendererFor`) waehlt den
  Adapter anhand der vom Client deklarierten Capability. `src/ui/registry.js` Kommentarblock
  Z.14-27 dokumentiert selbst eine bekannte Luecke: das ausgelieferte Widget-HTML spricht
  ausschliesslich das MCP-native `tools/call`-postMessage-Format; ein echter ChatGPT-Host
  bekommt beim Erstaufruf `structuredContent`/`content` korrekt, aber die selbst-pollende
  Live-Karte (Self-Poll, Cancel, `get_transcript` im Call-Widget) bleibt dort funktionslos, weil
  keine host-seitige Bridge dieses Wire-Format entgegennimmt.
- Risiko: Ein Tool-Aufruf ueber ChatGPT liefert immer ein korrektes Text-/`structuredContent`-
  Ergebnis (MCP-Standard-Garantie bleibt gewahrt - kein Bruch der Grundfunktion), aber ein
  eingebettetes Widget wuerde dort NICHT wie in Claude interaktiv aktualisieren. Das ist kein
  Protokollbruch (Ignore-if-unknown fuer `_meta`), aber ein Funktionsunterschied, der bei einer
  OpenAI-Review mit UI (`_meta.ui.csp`/`_meta.ui.domain`, T-30/T-31 der OpenAI-Anforderungen)
  auffallen wuerde, falls das Team dort ueberhaupt mit UI einreicht.
  Zusaetzlich: X-5 der Spec (`00-openai-anforderungen.md`) nennt eine EIGENE
  `ui/initialize`-Handshake-Version (`protocolVersion: "2026-01-26"`) fuer die MCP-Apps-Bruecke
  bei OpenAI - dieser Handshake ist im Code nicht auffindbar (kein Treffer fuer `ui/initialize`
  in `src/ui/*`); ob der schlanke SEP-1865-Nachbau ohne ihn bei einem echten ChatGPT-Host
  ueberhaupt initialisiert, ist am Repo NICHT entscheidbar (siehe Offene Fragen).
- Empfehlung: Vor einer UI-Einreichung bei OpenAI entweder den ChatGPT-Adapterpfad vervollstaendigen
  (host-seitige Bruecke fuer das MCP-Apps-Wire-Format, falls ChatGPT es unterstuetzt) oder ohne
  UI einreichen (Stufe-0-Text, `outputSchema`/`structuredContent` reichen laut T-18/T-19 der
  OpenAI-Doku fuer den Grundbetrieb aus) und die UI-Frage explizit zurueckstellen.
- Prioritaet/Kategorie: P1 / B

### PP-D1-11 Live-Handshake-Smoke-Test (`initialize`, `tools/list`)
- Status: UNKNOWN
- Evidenz: Zwei Versuche, den Server lokal zu starten (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true
  MCP_AUTH=off DATA_DIR=<tmp> node src/server.js`, Hintergrundprozess). Beide Male schrieb der
  Server sein normales Boot-Log bis zum Punkt "Keine aktive Nummer im Store" (kein Fehler, kein
  Stacktrace) und war Sekunden spaeter nicht mehr im Prozessbaum (`ps -p <pid>` leer,
  `ps aux | grep src/server.js` leer) - kein `curl` konnte ihn erreichen (`Connection refused`).
  Ursache: der Hintergrundprozess ueberlebt das Ende des Bash-Tool-Aufrufs in dieser Sandbox
  nicht zuverlaessig (bekanntes Sandbox-Verhalten, s. Memory "Verwaiste Testserver" - hier das
  Gegenteil: der Prozess wird zu FRUEH beendet statt verwaist zurueckzubleiben). Kein
  Hinweis auf einen Boot-Bug im Server selbst.
- Risiko: Protokollverhalten (ausgehandelte `protocolVersion`, tatsaechliche `tools/list`-Reihenfolge/
  -Anzahl, reale JSON-RPC-Fehlerform) ist NICHT empirisch am laufenden Prozess belegt, nur aus
  SDK-Quellcode abgeleitet (PP-D1-01, PP-D1-06).
- Empfehlung: Smoke-Test ausserhalb dieser Sandbox nachholen (z.B. lokal auf dem Owner-Rechner
  oder in einer Umgebung, die Hintergrundprozesse ueber Tool-Aufrufe hinweg haelt).
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Spricht ChatGPTs realer MCP-Client tatsaechlich nur Legacy-Streamable-HTTP (max. `2025-11-25`),
  oder inzwischen auch `2026-07-28`? Das Repo kann nur die installierte SDK-Version zeigen, nicht
  das Verhalten des OpenAI-Clients selbst; `00-openai-anforderungen.md` Punkt 4 haelt das bereits
  als "nicht auffindbar" fest.
- Initialisiert ein echter ChatGPT-Host den hier nachgebauten SEP-1865-Adapter ueberhaupt, wenn
  der dokumentierte OpenAI-eigene `ui/initialize`-Handshake (`protocolVersion: "2026-01-26"`,
  X-5) im Code fehlt? Nur mit einem echten ChatGPT-Verbindungstest zu klaeren, nicht am
  Repo-Stand.
- Wuerde OpenAIs automatischer Review-Scan (`continuous review`, T-33) die fehlende
  Origin-Pruefung (PP-D1-04) als Ablehnungsgrund werten? Die OpenAI-Doku nennt dafuer keine
  eigene Pruefregel - unklar, ob das dort ueberhaupt geprueft wird oder erst bei einem
  MCP-Spec-Audit auffiele.

## Randbefund (ausserhalb dieser Dimension)

`registerWellKnown` (`src/auth.js:127-128`) liefert `authorization_servers: []`, wenn
`config.auth.oauthIssuerUrl` nicht gesetzt ist - ein leeres Array widerspricht A-03 der Spec
("PRM MUSS mindestens einen Eintrag enthalten"); das faellt in die Auth/OAuth-Dimension, nicht
in D1, wird hier nur als Fund vermerkt.
