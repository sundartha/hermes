# MCP-Spezifikation (Soll)

Recherchestand: 2026-09-18. Aktuelle Protokollversion: **2026-07-28** (Current).
Vorgaenger-Revisionen: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 (alle "Legacy",
weil handshake-basiert; 2024-11-05 zusaetzlich mit dem alten HTTP+SSE-Transport).

Begriffe der Spec (`/specification/2026-07-28/basic/versioning`):
- **Modern** = Version/Identitaet/Capabilities als Pro-Request-Metadaten (`_meta`), ab 2026-07-28.
- **Legacy** = Sitzung per `initialize`-Handshake, 2025-11-25 und aelter.
- **Dual-era** = Implementierung, die beides kann.

Der zentrale Bruch fuer einen remote MCP-Server: **2026-07-28 hat den Handshake und die
Protokoll-Sitzung entfernt.** Kein `initialize`, kein `Mcp-Session-Id`, kein GET-SSE-Stream,
kein `Last-Event-ID`. Jeder Request traegt Version, Client-Identitaet und Client-Capabilities
selbst; der Server akzeptiert oder lehnt jeden Request einzeln ab.

SDK-Stand (npm, 2026-09-18):
- `@modelcontextprotocol/sdk` = **1.30.0** (2026-07-27) — die v1-Linie, Legacy-Aera.
- `@modelcontextprotocol/core|client|server` = **2.0.0** (2026-07-27) — neue Paketaufteilung,
  unterstuetzt die Revision 2026-07-28 (`serverInfo` aus `DiscoverResult` in `_meta` verschoben,
  `clientInfo` im Request-Umschlag optional).

| ID | Anforderung | Pflicht/Optional | Spec-Stelle (URL + Version) |
|---|---|---|---|
| V-01 | Versionskennungen sind Datumsstrings `YYYY-MM-DD`; erhoeht wird nur bei rueckwaerts-inkompatiblen Aenderungen | Pflicht (Format) | https://modelcontextprotocol.io/specification/versioning (2026-09 abgerufen) |
| V-02 | Aktuelle Version ist 2026-07-28; Revisionen sind Draft/Current/Final | Pflicht (Kenntnis) | https://modelcontextprotocol.io/specification/versioning |
| V-03 | KEINE Verhandlung per Handshake mehr. Jeder Request deklariert seine Version in `_meta` unter `io.modelcontextprotocol/protocolVersion` | Pflicht | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| V-04 | `_meta` Pflichtfelder pro Request: `io.modelcontextprotocol/protocolVersion` (Pflicht), `io.modelcontextprotocol/clientCapabilities` (Pflicht, leeres Objekt erlaubt), `io.modelcontextprotocol/clientInfo` (SHOULD, Schema-optional) | Pflicht / SHOULD | schema.ts 2026-07-28, `RequestMetaObject`, https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts |
| V-05 | Server MUSS Capabilities pro Request lesen und darf sie NICHT aus frueheren Requests ableiten | Pflicht | schema.ts 2026-07-28, `clientCapabilities` |
| V-06 | Bei nicht unterstuetzter Version: `UnsupportedProtocolVersionError` (Code `-32022`) mit `data.supported[]` und `data.requested` | Pflicht | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| V-07 | Client SOLL aus `supported` waehlen und den Request wiederholen | SHOULD (Client) | ebd. |
| V-08 | Server MUSS `server/discover` implementieren (liefert `supportedVersions`, `capabilities`, `instructions`, `_meta.serverInfo`) | Pflicht (Server) | https://modelcontextprotocol.io/specification/2026-07-28/server/discover |
| V-09 | Client-seitiger Aufruf von `server/discover` ist optional; auf stdio SOLL ein Dual-era-Client damit sondieren | Optional / SHOULD | ebd. |
| V-10 | `serverInfo` ist selbstberichtet; Clients SOLLEN daraus keine Sicherheits- oder Verhaltensentscheidung ableiten | SHOULD NOT | ebd. |
| V-11 | Optionale Erweiterungen laufen ueber `capabilities.extensions` (Map Extension-ID -> Settings), ID mit Pflicht-Praefix | Optional | https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning |
| V-12 | Wird eine Extension nur von einer Seite unterstuetzt, MUSS die unterstuetzende Seite auf Kernverhalten zurueckfallen oder mit Fehler ablehnen | Pflicht | ebd. |
| V-13 | Dual-era-Server DARF beide Aeren am selben Endpunkt bedienen; `initialize` waehlt Legacy, `_meta` waehlt Modern | Optional | ebd. |
| V-14 | Ein Nur-Modern-Server SOLL in seinem Fehler auf `initialize` die unterstuetzten Versionen nennen (Legacy-Clients haben keinen Fall-forward) | SHOULD | ebd. |
| T-01 | Server MUSS genau EINEN HTTP-Endpunktpfad ("MCP endpoint") anbieten, der POST unterstuetzt | Pflicht | https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http |
| T-02 | Jede JSON-RPC-Nachricht des Clients ist ein eigener HTTP POST | Pflicht | ebd. |
| T-03 | Client MUSS `Accept` mit BEIDEN Typen senden: `application/json` und `text/event-stream`; Server darf pro Request eines von beiden antworten, Client MUSS beides koennen | Pflicht | ebd. |
| T-04 | POST-Body ist genau EIN JSON-RPC-Request oder eine Notification; Client DARF KEINE JSON-RPC-Responses senden (Aenderung ggue. 2025-11-25) | Pflicht | ebd. |
| T-05 | Akzeptierte Notification -> `202 Accepted` ohne Body; sonst HTTP-Fehlerstatus (z.B. 400) | Pflicht | ebd. |
| T-06 | Server MUSS den `Origin`-Header pruefen; ist er vorhanden und ungueltig -> **403 Forbidden** (DNS-Rebinding-Schutz) | Pflicht | ebd., Abschnitt "Security & Endpoint" |
| T-07 | Lokal laufende Server SOLLEN nur an 127.0.0.1 binden; Authentisierung SOLL fuer alle Verbindungen implementiert sein | SHOULD | ebd. |
| T-08 | SSE-Antwortstrom ist auf genau den einen Request bezogen: Server DARF nur zugehoerige Notifications senden und MUSS KEINE eigenstaendigen JSON-RPC-Requests darauf senden | Pflicht | ebd., "Receiving Messages" |
| T-09 | Server-zu-Client-Interaktionen (Sampling, Elicitation, Roots) laufen NICHT mehr als Server-Requests, sondern als `InputRequiredResult` + Retry (MRTR, SEP-2322) | Pflicht (Verhalten) | https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr |
| T-10 | Die finale JSON-RPC-Response SOLL den Strom beenden | SHOULD | Streamable HTTP 2026-07-28 |
| T-11 | Langlebige Aenderungs-Notifications nur ueber den Antwortstrom von `subscriptions/listen`; Progress/Log laufen NICHT darueber | Pflicht (Ort) | ebd. + /basic/patterns/subscriptions |
| T-12 | Bei SSE SOLL der Server `X-Accel-Buffering: no` setzen; fuer lange Stroeme Keep-alive-Kommentarzeilen (`:\r\n`) | SHOULD | ebd. |
| T-13 | Resumable SSE via `Last-Event-ID` wird NICHT mehr unterstuetzt | Entfallen | ebd. |
| T-14 | Schliessen des SSE-Antwortstroms MUSS als Cancellation gelten; Server MUSS danach nichts mehr zu dem Request senden | Pflicht | ebd., "Cancellation" |
| T-15 | Jeder POST MUSS den Header `MCP-Protocol-Version` tragen, identisch zum `_meta`-Wert; bei Abweichung 400 + `HeaderMismatch` (`-32020`) | Pflicht | ebd., "Protocol Version Header" |
| T-16 | Nicht unterstuetzte Version -> `400 Bad Request` + `UnsupportedProtocolVersionError` mit `supported` | Pflicht | ebd. |
| T-17 | Unbekannte Methode -> `404 Not Found` + JSON-RPC `-32601` (unterscheidet uns von einem Legacy-HTTP+SSE-404) | Pflicht | ebd. |
| T-18 | Standard-Header `Mcp-Method` (aus `method`) bei allen Requests und `Mcp-Name` (aus `params.name`/`params.uri`) bei `tools/call`, `resources/read`, `prompts/get` sind REQUIRED | Pflicht | ebd., "Standard Request Headers" |
| T-19 | Server, die den Body verarbeiten, MUESSEN Header gegen Body validieren; Abweichung/fehlender Pflichtheader -> 400 + `-32020` | Pflicht | ebd., "Server Validation" |
| T-20 | Nicht ASCII-darstellbare Headerwerte MUESSEN als `=?base64?<b64>?=` kodiert werden; Server MUESSEN vor dem Vergleich dekodieren | Pflicht | ebd., "Value Encoding" |
| T-21 | Header-NAMEN case-insensitiv vergleichen, Header-WERTE sind case-sensitiv | Pflicht | ebd., "Case Sensitivity" |
| T-22 | `x-mcp-header` im `inputSchema` spiegelt Parameter in `Mcp-Param-{Name}`; Server-seitig optional, Client-seitig MUSS unterstuetzt werden | Optional (Server) / Pflicht (Client) | ebd. + /server/tools#x-mcp-header |
| T-23 | Sensible Parameter (Passwoerter, Keys, PII) SOLLEN NICHT mit `x-mcp-header` markiert werden | SHOULD NOT | /specification/2026-07-28/server/tools |
| T-24 | Statelessness: das Protokoll hat keine Sitzung mehr. Zustand ueber Tool-Calls hinweg laeuft ueber explizite Handles als Tool-Argumente (nicht-normative Empfehlung) | Optional/Empfehlung | /specification/2026-07-28/server/tools, "Stateful Tools" |
| T-25 | Nur-2026-07-28-Server SOLLEN auf GET/DELETE am MCP-Endpunkt mit `405 Method Not Allowed` antworten, `Mcp-Session-Id` ignorieren (nicht praegen, nicht spiegeln), `Last-Event-ID` ignorieren | SHOULD | ebd., "Earlier Streamable HTTP Revisions" |
| T-26 | Server, die Clients vor 2025-06-18 bedienen wollen, DUERFEN einen fehlenden `MCP-Protocol-Version`-Header als `2025-03-26` deuten; sonst MUSS der Request abgelehnt werden | Optional / Pflicht | ebd. |
| T-L1 | (Legacy 2025-11-25) MCP-Endpunkt MUSS POST **und GET** unterstuetzen; GET oeffnet SSE oder antwortet 405 | Pflicht in Legacy | https://modelcontextprotocol.io/specification/2025-11-25/basic/transports |
| T-L2 | (Legacy) Sitzung optional per `MCP-Session-Id` im `InitializeResult`; Client MUSS ihn danach mitsenden; Server ohne Header (ausser initialize) SOLL 400; beendete Sitzung -> 404; Client DELETE beendet, Server darf 405 antworten | Optional (Sitzung), dann Pflicht | ebd. |
| T-L3 | (Legacy) Stroeme resumable via `Last-Event-ID`; fehlender Versionsheader wird als `2025-03-26` gedeutet; ungueltige Version -> 400 | Optional / Pflicht | ebd. |
| A-01 | Authorization ist insgesamt OPTIONAL; wer sie bei HTTP anbietet, SOLL dieser Spec folgen. stdio SOLL sie NICHT nutzen (Credentials aus der Umgebung) | Optional / SHOULD | https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization |
| A-02 | Der MCP-Server ist **OAuth-2.1-Resource-Server**, nie Authorization Server; der MCP-Client ist der OAuth-Client | Pflicht (Rolle) | ebd., "Roles" |
| A-03 | Server MUSS Protected Resource Metadata (RFC 9728) implementieren; PRM MUSS `authorization_servers` mit mindestens einem Eintrag enthalten | Pflicht | ebd. + /basic/authorization/authorization-server-discovery |
| A-04 | PRM-Bekanntgabe ueber mindestens einen Weg: `WWW-Authenticate: Bearer resource_metadata="..."` bei 401 ODER Well-Known-URI `/.well-known/oauth-protected-resource[/<pfad des mcp-endpunkts>]` | Pflicht (eine der beiden) | /basic/authorization/authorization-server-discovery |
| A-05 | Authorization Server MUSS mindestens eine Discovery bieten: RFC 8414 ODER OIDC Discovery 1.0; Clients MUESSEN beide koennen und die Well-Known-Reihenfolge (Path-Insertion vor Path-Appending) einhalten | Pflicht | ebd. |
| A-06 | Client MUSS das AS-Metadatendokument validieren: `issuer` im Dokument identisch zur konstruierten Issuer-URL, sonst nicht verwenden | Pflicht (Client) | ebd. |
| A-07 | Client-Registrierung: Client ID Metadata Documents sind der bevorzugte Weg (SHOULD fuer AS und Clients); Alternativen Pre-Registrierung oder DCR | SHOULD / Optional | /specification/2026-07-28/basic/authorization + /basic/authorization/client-registration |
| A-08 | Dynamic Client Registration (RFC 7591) ist nur noch MAY und **deprecated** (Rueckwaertskompatibilitaet) | Optional, deprecated | https://modelcontextprotocol.io/specification/2026-07-28/deprecated |
| A-09 | PKCE: der Flow ist OAuth 2.1, PKCE (`code_challenge`/`code_verifier`) gehoert zwingend zum Authorization-Code-Flow | Pflicht | /specification/2026-07-28/basic/authorization ("Generate PKCE parameters"), OAuth 2.1 draft-13 |
| A-10 | Resource Indicators (RFC 8707): Client MUSS `resource` in Authorization- UND Token-Request senden, mit der kanonischen URI des MCP-Servers, unabhaengig davon, ob der AS es unterstuetzt | Pflicht (Client) | ebd., "Resource Parameter Implementation" |
| A-11 | Kanonische URI: absolute https-URI ohne Fragment, moeglichst spezifisch, ohne abschliessenden Slash | SHOULD | ebd. |
| A-12 | Token-Audience: Server MUSS pruefen, dass das Token **fuer ihn** ausgestellt wurde (RFC 8707 Abschnitt 2); nur eigene Tokens akzeptieren, keine fremden annehmen oder weiterreichen | Pflicht | ebd., "Token Handling" |
| A-13 | Token im `Authorization: Bearer`-Header bei JEDEM HTTP-Request; NIE im Query-String | Pflicht | ebd., "Access Token Usage" |
| A-14 | Ungueltiges/abgelaufenes Token -> **401**; fehlende Scopes/Rechte -> **403**; fehlerhafter Authorization-Request -> **400** | Pflicht | ebd., "Error Handling" |
| A-15 | Bei 401 SOLL der Server `scope=` im `WWW-Authenticate` mitgeben (Least Privilege); Client MUSS diese Scopes als massgeblich fuer die aktuelle Operation behandeln | SHOULD / Pflicht | ebd., "Scope Selection Strategy" |
| A-16 | Bei unzureichendem Scope zur Laufzeit SOLL der Server 403 mit `error="insufficient_scope"`, `scope=`, `resource_metadata=` antworten und ALLE benoetigten Scopes in EINER Challenge nennen | SHOULD | ebd., "Scope Challenge Handling" |
| A-17 | Issuer-Identifikation RFC 9207: AS SOLL `iss` in Authorization-Responses (auch Fehler) setzen und `authorization_response_iss_parameter_supported` melden; Client MUSS `iss` gegen den gemerkten Issuer per einfachem String-Vergleich pruefen, ohne Normalisierung | SHOULD (AS) / Pflicht (Client) | ebd., "Authorization Response Validation" |
| A-18 | Refresh-Tokens: Server (Resource) SOLL `offline_access` NICHT in `WWW-Authenticate`-Scope oder `scopes_supported` fuehren | SHOULD NOT | ebd., "Refresh Tokens" |
| A-19 | Mehrere `authorization_servers`: Client MUSS Registrierungs-/Tokenzustand je AS getrennt halten | Pflicht (Client) | /basic/authorization/authorization-server-discovery |
| W-01 | Server, die Tools anbieten, MUESSEN die Capability `tools` deklarieren (`listChanged` optional) | Pflicht | https://modelcontextprotocol.io/specification/2026-07-28/server/tools |
| W-02 | `tools/list` MUSS die aktuell verfuegbaren Tools liefern; die Menge DARF NICHT pro Verbindung oder als Nebenwirkung anderer Requests variieren — sie DARF aber je Authorization variieren | Pflicht | ebd., "Capabilities" |
| W-03 | Tools SOLLEN in deterministischer Reihenfolge geliefert werden (Cache-/Prompt-Cache-Trefferquote) | SHOULD | ebd. |
| W-04 | `tools/list` unterstuetzt Pagination (`cursor` -> `nextCursor`) und Caching (`ttlMs`, `cacheScope`); Ergebnisse tragen `resultType` | Optional (Nutzung), Pflicht (Semantik) | ebd. + /server/utilities/pagination |
| W-05 | Cursor sind opake Tokens: Client DARF sie nicht parsen/veraendern, DARF keine feste Seitengroesse annehmen, leerer String ist ein gueltiger Cursor | Pflicht (Client) | /specification/2026-07-28/server/utilities/pagination |
| W-06 | Ungueltiger Cursor SOLL `-32602` (Invalid params) ergeben | SHOULD | ebd. |
| W-07 | Tool-Pflichtfelder: `name` (aus BaseMetadata) und `inputSchema`. Optional: `title`, `description`, `icons`, `outputSchema`, `annotations`, `_meta` | Pflicht | schema.ts 2026-07-28, `interface Tool` |
| W-08 | `inputSchema` MUSS ein gueltiges JSON-Schema-Objekt mit `type: "object"` sein (nicht `null`); ohne `$schema` gilt Draft 2020-12; ohne Parameter `{"type":"object","additionalProperties":false}` empfohlen | Pflicht | /specification/2026-07-28/server/tools, "Data Types" |
| W-09 | Anzeigename-Reihenfolge: `title`, dann `annotations.title`, dann `name` | Pflicht (Client-Darstellung) | schema.ts 2026-07-28, `Tool.annotations` |
| W-10 | Tool-Namen SOLLEN 1-128 Zeichen, case-sensitiv, nur `A-Za-z0-9_-.`, serverweit eindeutig sein | SHOULD | /specification/2026-07-28/server/tools, "Tool Names" |
| W-11 | Ist `outputSchema` gesetzt, MUSS der Server konforme `structuredContent` liefern; Clients SOLLEN validieren | Pflicht / SHOULD | ebd., "Output Schema" |
| W-12 | `structuredContent` darf jeder JSON-Wert sein; zur Rueckwaertskompatibilitaet SOLL die serialisierte JSON zusaetzlich als TextContent im `content` liegen | SHOULD | ebd., "Structured Content" |
| W-13 | Unstrukturierte Inhalte: `text`, `image`, `audio`, `resource_link`, `resource` (embedded), jeweils mit optionalen `annotations` (audience/priority/lastModified) | Optional | ebd., "Tool Result" |
| W-14 | Zwei getrennte Fehlerwege: Protokollfehler als JSON-RPC-Error (unbekanntes Tool, malformed Request -> `-32602`, Serverfehler) vs. Ausfuehrungsfehler als Ergebnis mit `isError: true` | Pflicht | ebd., "Error Handling" |
| W-15 | Clients SOLLEN Ausfuehrungsfehler (`isError`) an das Modell geben (Selbstkorrektur); Protokollfehler DUERFEN weitergereicht werden | SHOULD / MAY | ebd. |
| W-16 | Reservierte JSON-RPC-Codes: `-32700` Parse, `-32600` InvalidRequest, `-32601` MethodNotFound, `-32602` InvalidParams, `-32603` Internal; MCP-eigen: `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion | Pflicht | /specification/2026-07-28/schema (Error Codes) |
| W-17 | Server MUESSEN Tool-Eingaben validieren, Zugriffsrechte durchsetzen, Aufrufe ratenbegrenzen und Ausgaben saeubern | Pflicht | /specification/2026-07-28/server/tools, "Security Considerations" |
| W-18 | Ein Mensch SOLL Tool-Aufrufe ablehnen koennen; Clients SOLLEN Eingaben vor dem Aufruf zeigen und Timeouts setzen | SHOULD | ebd. |
| W-19 | `notifications/tools/list_changed` geht nur an Clients, die einen `subscriptions/listen`-Strom mit `toolsListChanged: true` offen haben | SHOULD (bei deklariertem listChanged) | ebd., "List Changed Notification" |
| W-20 | `tools/call` DARF mit `InputRequiredResult` (`resultType: "input_required"`, `inputRequests`, optional `requestState`) antworten; der Retry traegt `inputResponses` und eine ANDERE JSON-RPC-`id` | Optional (Server) | ebd., "Input Required Tool Results" |
| N-01 | `ToolAnnotations` Feldnamen und Defaults: `title` (string, kein Default), `readOnlyHint` (Default **false**), `destructiveHint` (Default **true**, nur sinnvoll wenn `readOnlyHint == false`), `idempotentHint` (Default **false**, dito), `openWorldHint` (Default **true**) | Optional (Feld), Pflicht (Bedeutung) | schema.ts 2026-07-28, `interface ToolAnnotations` |
| N-02 | Alle Annotation-Felder sind **Hints** — sie sind KEINE Garantie fuer das Tool-Verhalten, auch `title` nicht | Pflicht (Verstaendnis) | ebd., Doc-Kommentar zu `ToolAnnotations` |
| N-03 | Clients MUESSEN Tool-Annotations als **nicht vertrauenswuerdig** behandeln, solange sie nicht von einem vertrauenswuerdigen Server stammen; Tool-Nutzungsentscheidungen duerfen nicht darauf beruhen | Pflicht (Client) | /specification/2026-07-28/server/tools, Warnung unter "Tool" |
| P-01 | Pflicht fuer jeden Server 2026-07-28: einzelner POST-Endpunkt, Origin-Pruefung, Header-Body-Validierung, `server/discover`, korrekte Fehlercodes | Pflicht | s. T-01, T-06, T-19, V-08, W-16 |
| P-02 | Optional: Tools, Resources, Prompts, Completion, Authorization, Pagination, Caching, `subscriptions/listen`, Extensions (MCP Apps, Tasks) | Optional | /specification/2026-07-28 (Uebersicht) + /basic/versioning (Extensions) |
| P-03 | Deklarierte Capability = Pflicht zur Beantwortung der zugehoerigen Methoden; nicht deklariert -> `-32601` mit Begruendung in `data` | Pflicht | /specification/2026-07-28/schema (MethodNotFoundError) |

## Deprecated / Versions-Fallen

Quelle des Registers: https://modelcontextprotocol.io/specification/2026-07-28/deprecated
(Feature-Lifecycle SEP-2596; ein deprecated Feature bleibt mindestens zwoelf Monate,
Ausnahme "expedited removal" mindestens neunzig Tage).

| Feature | Deprecated seit | Migrationsweg | Frueheste Entfernung |
|---|---|---|---|
| HTTP+SSE-Transport (2024-11-05, GET-`endpoint`-Event + separater POST-Endpunkt) | 2025-03-26 | Streamable HTTP | drei Monate nachdem SEP-2596 Final wird |
| Roots | 2026-07-28 | Verzeichnisse/Dateien als Tool-Parameter, Resource-URIs oder Serverkonfiguration | erste Revision am/nach 2027-07-28 |
| Sampling | 2026-07-28 | direkt gegen die LLM-Provider-API | erste Revision am/nach 2027-07-28 |
| Logging (`notifications/message`, `logging/setLevel` -> `_meta.logLevel`) | 2026-07-28 | stderr bei stdio, OpenTelemetry fuer Observability | erste Revision am/nach 2027-07-28 |
| Dynamic Client Registration (RFC 7591) | 2026-07-28 | Client ID Metadata Documents | erste Revision am/nach 2027-07-28 |
| `includeContext: "thisServer"` / `"allServers"` (Sampling) | 2025-11-25 | Feld weglassen oder `"none"` | folgt der Sampling-Entfernung |

Entfernt wurde unter der Policy bisher nichts.

Versions-Fallen, die einen Bestandsserver 2026-07-28 zu Fall bringen:

1. **`initialize` ist weg.** Ein Server, der nur den Handshake kennt, ist "Legacy". Ein
   moderner Client bricht dort ab (Matrix "Modern/Legacy: Fails"). Nur ein Dual-era-Server
   bedient beide.
2. **`Mcp-Session-Id` ist weg.** Ein 2026-07-28-Server praegt und echot keine Session-IDs
   mehr und ignoriert eingehende. Wer Zustand braucht, nimmt explizite Handles in
   Tool-Argumenten (T-24).
3. **GET/DELETE am MCP-Endpunkt sind weg** -> `405 Method Not Allowed` (T-25). Der
   standalone GET-SSE-Strom der Revisionen 2025-03-26 bis 2025-11-25 existiert nicht mehr;
   Ersatz ist `subscriptions/listen`.
4. **`Last-Event-ID`/Resumability ist weg.** Stroeme sind nicht wiederaufnehmbar.
5. **Server-initiierte JSON-RPC-Requests auf SSE sind verboten.** Sampling/Elicitation/Roots
   laufen ueber MRTR (`InputRequiredResult` + Retry mit neuer `id`).
6. **Client sendet keine JSON-RPC-Responses mehr** im POST-Body (in 2025-11-25 erlaubt).
7. **Neue Pflicht-Header:** `MCP-Protocol-Version`, `Mcp-Method`, bei Namensmethoden
   `Mcp-Name` — inklusive Pflicht zur Header-gegen-Body-Validierung mit `-32020`. Ein
   Server, der diese Validierung nicht macht, ist der Grund, warum die Spec sie fordert
   (Load-Balancer routet nach Header, Server fuehrt nach Body aus).
8. **`notifications/cancelled` gilt auf Streamable HTTP nicht mehr** — Abbruch ist das
   Schliessen des Antwortstroms.
9. **404 vs. 400 als Fallback-Signal:** ein moderner Server muss unbekannte Methoden mit
   404 + `-32601` und Versionsfehler mit 400 + `-32022` beantworten, sonst deutet ein
   Dual-era-Client ihn als Legacy-HTTP+SSE-Server.
10. **DCR abschalten heisst noch nicht fertig:** wer heute OAuth ueber DCR loest, steht auf
    einem deprecated Pfad; Zielbild ist Client ID Metadata Documents.
11. **SDK-Falle:** `@modelcontextprotocol/sdk@1.30.0` ist die v1/Legacy-Linie. Die Revision
    2026-07-28 spricht erst die v2-Paketfamilie (`@modelcontextprotocol/core|client|server`
    2.0.0, 2026-07-27).
