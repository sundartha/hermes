# T2-05 - Auth: Re-Auth-Challenge im Tool-Fehlerergebnis (Spec)

- IDs (gepinnt): **T-14**. Risiko: auth. dokumentFuerOpenAI: nein.
- Branch: `phase/openai-t2-05-reauth-challenge`, Worktree `.../scratchpad/wt-t2-05`
- Basis-Commit: `1cfa474` (Merge T2-04). Gemergt und NICHT zuruecknehmen: T2-01 a941d23, T2-02 fff3b95,
  T2-03 24ff703, T2-23 c0438bd, T2-04 1cfa474.
- Baseline gemessen (Worktree, vor jeder Aenderung): die 7 betroffenen Testdateien (am6-oauth-tenant,
  request-tenant, profiles, e4-mandantentrennung-default, openai-t2-01-widget-resource-meta,
  openai-p7-token-pruefachsen, route-auth-inventory) = 72 pass / 0 fail.

## Anforderung (Quelle, woertlich)

- plugins/reference: `_meta["mcp/www_authenticate"]` | Error result | **string or string[]** |
  "RFC 7235 `WWW-Authenticate` challenges to trigger OAuth."
- plugins/build/auth: "Triggering the tool-level OAuth flow requires both metadata (`securitySchemes`
  and the resource metadata document) **and** runtime errors that carry `_meta["mcp/www_authenticate"]`."
  "Without both halves ChatGPT will not show the linking UI for that tool."
- Beispiel dort (Struktur): `result = { content:[{type:"text", text:"..."}], _meta:{ "mcp/www_authenticate":
  [ "Bearer resource_metadata=\"...\", error=\"insufficient_scope\", error_description=\"...\"" ] },
  isError:true }`. Pflichtparameter laut Beispiel: `resource_metadata`, `error`, `error_description`.
- **Festlegung:** Wert = Array mit GENAU EINEM String; der String ist eine RFC-7235-Challenge OHNE die
  einfachen Anfuehrungszeichen, die im OpenAI-Beispiel innerhalb des JSON-Strings stehen (s. Widersprueche W1).
  `error="insufficient_scope"` wie im Beispiel (Token gueltig, aber ohne Berechtigung auf diese Ressource =
  RFC 6750 "requires higher privileges"); Parameterreihenfolge wie deny401 (resource_metadata zuerst).

## Ist-Zustand am Code (Worktree 1cfa474)

- `src/routes/mcp.js:61-66` `rejectIfNoTenant`: `scopedTenant === TENANT_REJECT` -> audit
  `grund=kein_tenant` + HTTP 403 JSON `{error:"Keine Tenant-Zuordnung fuer diese Identitaet."}`; Aufruf `:131`.
- TENANT_REJECT entsteht an /mcp (Resolver `src/routes/_tenant.js:139-164`):
  (a) OAuth: `req.auth` gesetzt, `store.resolveTenant(sub)` null ODER Token ohne `sub` -> T2-05-Fall;
  (b) Token-Modus / Legacy / off: KEIN `req.auth` (nur `verifyOauth`, `src/auth.js:215`, setzt es), Aufrufer nicht
  isTrustedLocalCaller -> `operatorChannelTenant` -> REJECT. Fall (b) ist KEIN OAuth-Fall, hat keine
  Re-Auth-Moeglichkeit und bleibt 403 (belegt durch `test/openai-t2-01-widget-resource-meta.test.js` T2b).
- Challenge-Bau: `src/auth.js:118-120` `bearerChallenge(paare)` (privat), `:125-133` `deny401` baut
  `resource_metadata, scope, error, error_description`; `:164-172` `deny403InsufficientScope` (eigene Reihenfolge,
  bleibt unangetastet). `metadataUrl()` `:24`, `OAUTH_SCOPE_PARAM` `:51`.
- Alle Werkzeuge laufen ueber EINEN Registrierweg `uiTool` -> `server.registerTool(name, config, wrapHandler(...))`
  (`src/mcp-tools.js:957-962`); Widget-Resources ueber `uiRenderer.registerResource` -> `server.registerResource`
  (`src/ui/contract.js:145-158`, statisches HTML, kein api()). Sonst benutzt `registerTools` keine Server-Methode.
- Werkzeugmenge haengt an `consultAllowed` (`src/mcp-tools.js:1169`) und `allowCalendar` (`:1507`).
  `store.resolveProfile("reject")` = DEFAULT_PROFILE (`src/store/defaults.js:1069-1089`: allowCalendar false,
  allowConsult false) -> ohne Mandant dieselbe Menge wie ein Mandant OHNE gespeichertes Profil (10 Werkzeuge).
- SDK 1.29.0 `tools/call` (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:100-133`):
  Input-Validierung VOR dem Handler; `isError`-Ergebnisse umgehen die outputSchema-Pruefung (`:193`); das
  Ergebnis geht unveraendert zurueck (ob `_meta` den Draht erreicht, beweist NUR der Drahttest).
- stdio (`src/mcp-server.js`): keine Auth-Schicht, kein Tenant-Resolver, kein TENANT_REJECT-Fall -> T-14 dort
  gegenstandslos; stdio bleibt unveraendert.
- REST-Zweitschicht: `api()` sendet `X-Internal-Tenant` (`src/mcp-tools.js:65`); ein weitergereichtes "reject"
  bleibt Reject (`_tenant.js:145-147`), outbound-gates kennt TENANT_REJECT (`src/telephony/outbound-gates.js:339`).
  Das ist nur Verteidigung in der Tiefe - die Primaersicherung dieser Phase ist: der Stub ruft api() NIE.

## Schritte

### S1 - Challenge-Bauer aus auth.js exportieren (EINE Quelle)
- Was: `export function oauthBearerChallenge(error, description)` in `src/auth.js` (neben `deny401`, ~Z. 122-133):
  liefert `bearerChallenge([["resource_metadata", metadataUrl()], ["scope", OAUTH_SCOPE_PARAM], ["error", error],
  ["error_description", description]])`. `deny401` ruft ihn auf (Ausgabe byte-identisch zu heute).
  `deny403InsufficientScope` NICHT anfassen.
- IDs: T-14. Pfade: HTTP /mcp OAuth (401-Header unveraendert; neuer Aufrufer S3).
- Beweis: (b) `test/openai-p7-token-pruefachsen.test.js` und `test/openai-p6-challenge.test.js` und
  `test/openai-t2-23-scopes.test.js` gruen (401-Header unveraendert, `^Bearer resource_metadata="`);
  (a) `grep -n "oauthBearerChallenge" src/auth.js src/mcp-no-tenant.js` -> Definition + Aufruf in deny401 +
  Aufruf im Stub-Modul, KEIN zweites `resource_metadata`-Literal ausserhalb `src/auth.js`
  (`grep -rn "resource_metadata" src/ | grep -v "^src/auth.js"` -> leer).

### S2 - Fehlertext NO_TENANT_LINKED in den MCP-Texten (de/en/fr)
- Was: `src/i18n/mcp-texts.js:20-29` neue Kennung `NO_TENANT_LINKED: "no_tenant_linked"`; Text in ALLEN drei
  `errors`-Buendeln (DE ASCII-transliteriert, unpersoenlicher Stil wie Bestand; FR mit Akzenten). Inhalt: kein
  Hermes-Konto mit dieser Anmeldung verknuepft; erneut mit dem Konto anmelden, das fuer Hermes genutzt wird; ohne
  Hermes-Konto ist das Werkzeug nicht verfuegbar. KEIN Link, KEINE URL, keine Tenant-/Konto-Existenzauskunft.
  Vorschlag EN: "No Hermes account is linked to this sign-in. Please sign in with the account you use for Hermes;
  without a Hermes account this tool is not available."
- IDs: T-14. Pfade: HTTP /mcp OAuth (nur Stub nutzt den Text).
- Beweis: (b) neuer Test: fuer de/en/fr existiert `localeFor(l).mcp.errors.no_tenant_linked`, nicht leer, enthaelt
  weder "http" noch "www." noch `"`; bestehende i18n-Tests (`test/mcp-tools-i18n.test.js`) gruen.

### S3 - Neue Datei `src/mcp-no-tenant.js`: Stub-Registrierung ohne Mandant
- Was: `export function registerNoTenantStubs(server, toolContext)`:
  1. baut EINMAL je Request das Ergebnis-Objekt (eingefroren):
     `{ content:[{type:"text", text: localeFor(language).mcp.errors[NO_TENANT_LINKED]}], isError:true,
     _meta:{ "mcp/www_authenticate": [ oauthBearerChallenge("insufficient_scope", NO_TENANT_DESCRIPTION) ] } }`.
     `NO_TENANT_DESCRIPTION` = benannte ASCII-Konstante ohne `"` und `\` (z.B. "No Hermes account is linked to this
     login"). Die Metadaten-Konstante `"mcp/www_authenticate"` als benannte Konstante.
  2. Fassade als PLAIN OBJECT (keine Proxy-Magie), GENAU zwei Methoden:
     `registerTool: (name, config) => server.registerTool(name, config, stubHandler)` (der uebergebene
     Original-Handler wird VERWORFEN, nie gespeichert, nie aufgerufen) und
     `registerResource: (...args) => server.registerResource(...args)` (statische Widget-HTML).
     Jede andere Server-Methode fehlt -> TypeError -> 500 im catch der Route (fail-closed; ein kuenftiger
     zweiter Registrierweg in registerTools kann so nie still einen echten Handler durchreichen).
  3. `registerTools(fassade, { ...toolContext, scopedTenant: TENANT_REJECT })` - Metadaten (Namen, Beschreibungen,
     Schemas, annotations, _meta, Widget-Verweise) damit byte-gleich zum echten Weg; scopedTenant erzwungen
     REJECT (nie null -> kein Legacy-/Operator-Rueckfall, selbst wenn je ein echter Handler liefe).
  `stubHandler` ist synchron-trivial: `async () => result` - kein fetch, kein api(), kein Store.
- IDs: T-14. Pfade: HTTP /mcp OAuth (einziger Aufrufer S4); stdio importiert die Datei NICHT.
- Beweis: (b) neuer Unit-Test (in der neuen Testdatei): Fake-Server zeichnet registerTool-Aufrufe auf;
  `registerNoTenantStubs(fake, ctx)` unter `withFetch(zaehler, ...)` (test/helpers.js:845) -> (i) Namensmenge ==
  Namensmenge von `registerTools(fake2, gleicher ctx)`; (ii) JEDER aufgezeichnete Handler ist derselbe Stub und
  NICHT der uebergebene; (iii) jeden Handler aufrufen -> `isError===true`, `_meta["mcp/www_authenticate"]` Array
  Laenge 1, fetch-Zaehler 0; (iv) Fassade ohne `tool`/`registerToolTask` (`"tool" in fassade === false`).
  (a) `grep -n "api(\|fetch(" src/mcp-no-tenant.js` -> leer.

### S4 - Route: OAuth-Kein-Mandant -> Stub statt 403; alle anderen Modi unveraendert
- Was: `src/routes/mcp.js`:
  - `rejectIfNoTenant` (`:61-66`) nur noch fuer `scopedTenant === TENANT_REJECT && !req.auth` 403 senden
    (Token/Legacy/off: Wortlaut, Status, Audit byte-identisch). Fuer `TENANT_REJECT && req.auth` (nur OAuth
    setzt req.auth): audit `auth_failed ... path=/mcp grund=kein_tenant` BLEIBT (gleicher Wortlaut, forensischer
    Pfad), dann weiter in den Handler.
  - An der Registrierung (`:173-180`): `const register = scopedTenant === TENANT_REJECT ? registerNoTenantStubs :
    registerTools;` (eine Verzweigung; Profil/Sprache laufen wie bisher ueber `store.resolveProfile(scopedTenant)`
    und `tenantLanguage(...)` -> DEFAULT_PROFILE, consultLoop false). `applyToolSecuritySchemes(server)` bleibt
    auf dem ECHTEN Server und gilt damit auch hier (zweite Haelfte der OpenAI-Bedingung).
  - Komplexitaet: Handler bleibt unter eslint `complexity` 10 / `max-lines-per-function`; ggf. Auswahl in eine
    kleine benannte Funktion ziehen (Muster logAndResolveIdentity).
  - Kommentare `:53-60` und `src/mcp-security-schemes.js:25` an die neue Semantik anpassen.
- IDs: T-14. Pfade: HTTP /mcp OAuth (neu), HTTP Token/Legacy/off (unveraendert), stdio (unberuehrt).
- Beweis: (b) neue Testdatei `test/openai-t2-05-reauth-challenge.test.js` (S5) gruen; (c)
  `npx eslint src/routes/mcp.js src/mcp-no-tenant.js src/auth.js src/i18n/mcp-texts.js` -> 0 Fehler.

### S5 - Drahttest (Kindprozess, echte Route, Interface-IP UND localhost)
Neue Datei `test/openai-t2-05-reauth-challenge.test.js`. Spion-Gateway: `http.createServer` auf 127.0.0.1:0, zaehlt
JEDEN Request, antwortet 404 JSON; Server-Env `{ MCP_AUTH:"oauth", OAUTH_ISSUER_URL: idp.issuer, GATEWAY_URL:
spion.url }` (BASE_ENV liefert `PUBLIC_URL=https://agent.test`); Seed: Mandant C MIT sub, OHNE gespeichertes Profil,
dazu Owner-Nummer. Requests ueber `srv.externalUrl` (Interface-IP; skip nur wenn keine) UND `srv.localUrl`.
- T05-1 (unbekannter sub): initialize -> 200 + serverInfo; tools/list -> 200, Namensmenge == tools/list mit
  Token von Mandant C (10 Namen), jedes Werkzeug traegt `securitySchemes` oauth2; `tools/call place_call {to:
  TELNYX_TEST_PEER_NUMBER, objective:"..."}` -> `result.isError===true`,
  `result._meta["mcp/www_authenticate"]` ist Array Laenge 1, String beginnt mit
  `Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource"`, enthaelt
  `scope="openid email offline_access"`, `error="insufficient_scope"`, `error_description="`; Text ohne "http";
  Body enthaelt NICHT die Owner-Nummer; **Spion-Zaehler 0**; `srv.readStore().calls.length` unveraendert (0 neu);
  Log `[audit] auth_failed .*path=/mcp grund=kein_tenant`; kein `requestedBy=owner` im stdout.
- T05-2 (verifiziertes Token OHNE sub): dieselben Aussagen fuer place_call und get_my_number.
- T05-3 (zweites Werkzeug): `tools/call get_my_number` und `list_calls` -> dieselbe Challenge (gleicher String wie
  T05-1), Spion 0.
- T05-4 POSITIV-KONTROLLE (Pflicht, sonst beweist "0" nichts): Token Mandant C -> `tools/call get_my_number` ->
  Spion-Zaehler >= 1, Ergebnis OHNE `_meta["mcp/www_authenticate"]`.
- T05-5 Gleichheit mit HTTP-Header: 401-Header einer Anfrage OHNE Token hat dieselben Parameter
  `resource_metadata`/`scope` wie die Tool-Challenge (Beleg "dieselbe Funktion" am Draht).
- T05-6 Token-Modus unveraendert: `MCP_AUTH=token` + korrekter Bearer ueber Interface-IP -> HTTP 403, Body
  `{error:"Keine Tenant-Zuordnung fuer diese Identitaet."}`, kein `mcp/www_authenticate` im Body.
- T05-7 Legacy unveraendert: `MCP_AUTH=""` ohne Token ueber Interface-IP -> 401 mit `Bearer error="invalid_token"`
  (kein resource_metadata), kein JSON-RPC-Ergebnis.
- T05-8 stdio unveraendert: Kindprozess `src/mcp-server.js` mit `{...BASE_ENV, GATEWAY_URL: spion.url}`, SDK-Client
  `callTool get_my_number` -> Ergebnis OHNE `_meta["mcp/www_authenticate"]`, Spion >= 1 (echter Handler, kein
  Stub); tools/list = TOOL_COUNT_WITHOUT_CONSULT.
- T05-9 Ungueltiges Token (falsche Signatur) -> weiterhin HTTP 401 mit oauth-Challenge (kein Tool-Ergebnis).
- IDs: T-14. Pfade: HTTP OAuth, HTTP Token, HTTP Legacy, stdio.
- Beweis: (b) die Datei gruen; isoliert: `NODE_ENV=test node --test test/openai-t2-05-reauth-challenge.test.js`.

### S6 - Bestandstests nachziehen (brechen absichtlich: 403 -> Tool-Fehler mit Challenge)
Diese Tests pruefen heute 403 fuer OAuth-Kein-Mandant und werden rot:
- `test/am6-oauth-tenant.test.js:85-107` und `:109-~132` (unbekannter sub / ohne sub)
- `test/request-tenant.test.js:72-92` (V3) und `:94-~115` (V4)
- `test/profiles.test.js:316-340` (zwei Untertests "JWT OHNE email", "OHNE email UND sub")
- `test/e4-mandantentrennung-default.test.js:209-223` (E4-17 "403, keine Tool-Liste")
Umbau: Status 200 + `result.isError` + Challenge statt 403; die NIE-Owner-Aussagen (keine Owner-Nummer, kein
`requestedBy=owner`, Audit `grund=kein_tenant`) BLEIBEN. E4-17 umbenennen (Tool-Liste ist jetzt sichtbar, der
Aufruf ist gesperrt). Testkommentare, die "tenant=reject ist unerreichbar" behaupten, korrigieren.
Unveraendert gruen bleiben muessen: `test/openai-t2-01-widget-resource-meta.test.js` (T2b Token-Modus 403),
`test/openai-p7-token-pruefachsen.test.js` (nur Kommentar `:46` pruefen), `test/route-auth-inventory.test.js`
(keine neue Route, Fingerprint unveraendert), `test/openai-p3-security-schemes.test.js`.
- IDs: T-14. Pfade: HTTP OAuth.
- Beweis: (b) die vier Dateien gruen; `git diff master --stat -- test/` zeigt nur diese vier + neue Datei.

### S7 - Doku: PLAN-SECURITY.md + docs/OPENAI-AUTH-ABWEICHUNGEN.md
- `PLAN-SECURITY.md`: neue Sektion T2-05 (Pflicht laut CLAUDE.md bei sicherheitsrelevanter Aenderung): OAuth-Kein-
  Mandant liefert statt 403 initialize/tools/list und je tools/call einen Tool-Fehler mit Challenge; Stub ruft
  api() nie; Token/Legacy/off unveraendert 403/401; KEINE Produktionswerte.
- `docs/OPENAI-AUTH-ABWEICHUNGEN.md`: T-14 DE (`:45-~110`) und EN (`~:315-360`) sowie die B-1-Stellen (`:33`,
  `:94`, `:186`, `:600`, `:656`, `:772`, `:781`): Status von "bewusst nicht erfuellt / 0 Treffer" auf den neuen
  Stand; Token-Ablauf mitten im Gespraech bleibt Transport-401 (UNKNOWN, Owner-Probe O-6). Aussagen nur mit
  Code-/Testbeleg (Lehre "Einreichungsdoku aus Code").
- IDs: T-14. Pfade: Doku.
- Beweis: (c) `grep -n "0 Treffer\|www_authenticate" docs/OPENAI-AUTH-ABWEICHUNGEN.md` -> keine Stelle behauptet
  mehr 0 Treffer; `grep -rn "www_authenticate" src/` -> genau `src/mcp-no-tenant.js`.

### S8 - Gesamtlauf
- `node --check` je geaenderter src-Datei; `npm test -- -- --test-concurrency=4 > logs/voll.log 2>&1`, nur
  `# pass`/`# fail` zaehlen; jeder rote Test isoliert wiederholen
  (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`); `npx eslint .` 0 Fehler.
  Testserver danach mit `ps aux | grep "src/server.js\|mcp-server.js"` pruefen.
- Keine neue Env-Variable (GATEWAY_URL ist Bestand, nur im Test gesetzt) -> kein Vier-Orte-Schritt.

## NICHT bauen

1. Tool-Fehler statt HTTP 401 bei ungueltigem/abgelaufenem Token: wuerde MCP-initialize ohne gueltiges Token
   verlangen = Auth aufweichen (Regel 3 fail-closed). OpenAI nennt den 401-mit-Challenge-Weg selbst; Wirkung in
   ChatGPT ist Owner-Probe O-6.
2. Stub/Challenge fuer Token-, Legacy-, off-Modus: kein OAuth-Flow, eine Challenge mit resource_metadata schickte den
   Client in eine Discovery, deren Token dieser Modus nie annimmt (P6-Lead-Entscheidung 3). Bleibt 403.
3. stdio: keine Auth, kein Mandantenfall; T-14 dort gegenstandslos (OpenAI erreicht stdio nie).
4. REST-Hop-403 als Challenge (internalOnly u.ae., `docs/OPENAI-AUTH-ABWEICHUNGEN.md:98ff`): kein Re-Auth-Fall,
   ein Re-Login loest ihn nicht; nicht im Plan-Abschnitt.
5. Aenderung an `deny403InsufficientScope` / an der Scope-Erzwingung (T2-23 gemergt, nicht anfassen).
6. Automatische Mandanten-Anlage fuer unbekannte Logins: Onboarding/Billing-Pfad (Abo+KYC), eigenes Thema.
7. Rate-Limit fuer den Kein-Mandant-Pfad: T2-07.

## Pre-Mortem (ein Jahr spaeter war T2-05 ein Fehler - was ist passiert?)

1. **Fremdes Login loest Anruf auf Owner-Kosten aus.** Ursache waere: ein echter Handler laeuft im Kein-Mandant-Pfad
   und `api()` faellt ohne X-Internal-Tenant auf `operatorChannelTenant` -> BOOTSTRAP (Loopback). Entschaerft:
   (i) Fassade verwirft jeden Original-Handler; (ii) nur zwei Methoden, jeder weitere Registrierweg = TypeError/500;
   (iii) scopedTenant hart TENANT_REJECT, nie null; (iv) REST-Zweitschicht lehnt "reject" ab; (v) Test T05-1..3 mit
   Spion-Gateway (0 Requests) + Positiv-Kontrolle T05-4 + Unit-Test "jeder Handler ist der Stub"; Safety-Review
   (Opus) prueft genau die Verzweigung in routes/mcp.js und die Fassade.
2. **Token-/Legacy-Modus wird still geoeffnet.** Wenn die Bedingung an "REJECT" statt an "REJECT && req.auth"
   haengt, bekaeme ein Token-Aufrufer ueber die Interface-IP eine Werkzeugliste. Entschaerft: Bedingung an
   `req.auth` (nur verifyOauth setzt es), Tests T05-6/T05-7 + Bestand T2b.
3. **Endlosschleife Login -> kein Mandant -> Login.** ChatGPT zeigt die Verknuepfung, der Nutzer meldet sich mit
   demselben Konto an (SSO), wieder Kein-Mandant. Entschaerft: Text sagt klar "kein Hermes-Konto verknuepft",
   Challenge wird nur bei tools/call geliefert (nicht bei initialize/tools/list). Rest-Risiko akzeptiert, Owner-
   Probe OP-1 misst das Verhalten.
4. **Falscher error-Code.** ChatGPT reagiert evtl. nur auf `invalid_token` oder nur auf `insufficient_scope`.
   Festlegung folgt dem OpenAI-Beispiel; UNKNOWN bis Owner-Probe. Rueckweg: eine Konstante in
   `src/mcp-no-tenant.js`.
5. **Informationsleck.** Jedes gueltige IdP-Login sieht jetzt die Werkzeugliste + Widget-HTML (vorher 403). Inhalt ist
   ohnehin oeffentlich (Einreichung); DEFAULT-Profil -> keine Kalender-/Consult-Werkzeuge; Text nennt weder Tenant
   noch Owner-Nummer (Test prueft Owner-Nummer nicht im Body). Log `[mcp] ... tenant=reject` nur mit gehashter
   E-Mail.
6. **Transkript-Leak:** ausgeschlossen, weil kein Handler Daten liest (Spion 0, kein Store-Zugriff im Stub).
7. **Gebrochener Client.** Claude-Connector eines Nicht-Mandanten bekam frueher Verbindungsfehler, jetzt Tools mit
   Fehlertext - kein Schaden; `_meta` wird von Claude ignoriert. Kostenfall: pro Kein-Mandant-Request wird ein
   McpServer gebaut (CPU, keine Carrier-/LLM-Kosten).
8. **SDK-Update aendert Ergebnis-Durchreichung** (`_meta` gestrippt): Drahttest T05-1 wird rot.

## Owner-Punkte (nach Owner-Regel)

- OP-1 Live-Probe ChatGPT Developer Mode (nach Deploy): Connector mit einem IdP-Konto verknuepfen, dem KEIN
  Hermes-Mandant zugeordnet ist; im Chat ein Werkzeug (z.B. get_my_number) aufrufen lassen. Erwartet: Tool-Fehler
  mit dem Text "No Hermes account is linked ..." UND ChatGPT bietet die Konto-Verknuepfung an. Falls die UI NICHT
  erscheint: Ergebnis notieren (error-Code-Frage, Pre-Mortem 4).
- OP-2 Live-Probe Claude (claude.ai Connector) mit demselben Konto: Verbindung gelingt, Werkzeugaufruf liefert den
  Fehlertext, kein Absturz. Mit einem Konto MIT Mandant: Werkzeuge funktionieren unveraendert.
- OP-3 Deploy/Push. Keine Deploy-Vorbedingung (kein neuer Live-Wert; PUBLIC_URL ist seit T2-04 Pflicht).

## Widersprueche / Abweichungen vom Plan

- W1 OpenAI-Beispiel (plugins/build/auth) zeigt den Challenge-String mit einfachen Anfuehrungszeichen IM JSON-String
  (`"'Bearer resource_metadata=...'"`). Die normative Referenz (plugins/reference) verlangt "RFC 7235
  WWW-Authenticate challenges" (string oder string[]); RFC 7235 kennt diese Quotes nicht. Festlegung: ohne die
  einfachen Quotes, Array mit einem String. UNKNOWN, ob ChatGPT beides akzeptiert -> OP-1.
- W2 Plan nennt `src/routes/mcp.js:60-65`; am Code steht `rejectIfNoTenant` an `:61-66` (Aufruf `:131`).
- W3 Plan "tools/list Namensmenge gleich wie mit Mandant" ist nur gegen einen Mandanten mit DEFAULT-Profil
  wohldefiniert (10 Werkzeuge); der Owner-Mandant hat Kalender/Consult zusaetzlich. Test vergleicht mit Mandant C
  ohne gespeichertes Profil.
- W4 Plan-Pre-Mortem spricht von `scopedTenant = null`; am Code kommt im Kein-Mandant-Fall "reject" an, `null` ist
  nur der registerTools-Default (stdio). Die Gefahr ist real, wenn ein Stub-Weg registerTools OHNE scopedTenant
  aufriefe -> S3 erzwingt TENANT_REJECT.
- W5 Plan-Dateiliste nennt weder `src/i18n/mcp-texts.js` (lokalisierter Text) noch `PLAN-SECURITY.md` /
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md`; letzteres behauptet heute "0 Treffer" fuer www_authenticate und B-1 = 403
  und wird nach T2-05 falsch -> S7.
- W6 T-14 ist nach T2-05 nur fuer den B-1-Fall als Tool-Fehler erfuellt; Token-Ablauf/ungueltiges Token bleibt
  Transport-401 mit Challenge (bewusst, fail-closed); ob ChatGPT dort die Verknuepfung anbietet, ist O-6 (Owner).
- W7 Tabelle Plan `:1266` ("kein _meta challenge; B-1 = 403") beschreibt den Stand VOR T2-05 - kein Konflikt.
