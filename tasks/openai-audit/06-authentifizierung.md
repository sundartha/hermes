# D6 - Authentifizierung des MCP-Clients

Dimension: D6 | Quelle: Code auf Branch master

## Kurzfassung

`/mcp` (POST) haengt an genau einer Middleware (`src/auth.js` -> `mcpAuth`) mit vier Modi:
`oauth` (JWT gegen Remote-JWKS, Issuer + Audience + Ablauf geprueft), `token` (statisches
Bearer, timing-sicher), `""` (Legacy, ausserhalb Produktion localhost-only, in Produktion 401)
und `off` (in Produktion Boot-fatal). Die Resource-Server-Rolle ist sauber getroffen: kein
eigener Authorization Server, RFC-9728-Metadata unter beiden Pfaden, 401 mit
`WWW-Authenticate`+`resource_metadata` - aber NUR im `oauth`-Modus. Es gibt KEINE Scopes:
kein `scope`-Claim wird gelesen, kein `securitySchemes` an einem Tool, keine Trennung von
Lesen und Schreiben - jedes gueltige Token erreicht alle Werkzeuge des aufgeloesten Tenants,
inklusive des kostenwirksamen `place_call` (gebremst nur durch Tenant-Profil und
Outbound-Gates). Kein Widerruf: ein Token bleibt bis `exp` gueltig, der MCP-Pfad prueft
keinen Tenant-/Account-Status. Schlimmster Befund: die gesamte fuer ChatGPT entscheidende
Authorization-Server-Seite (CIMD/DCR, S256-Advertising, RFC-9207-`iss`, Resource Indicators)
liegt bei WorkOS und ist im Repo an keiner Stelle belegt - der Issuer-Wert selbst steht nicht
im Repo (`render.yaml:360` `sync: false`).

## Pruefpunkte

### PP-D6-01 Welche Auth-Verfahren akzeptiert POST /mcp tatsaechlich, in welcher Reihenfolge
- Status: PASS
- Evidenz: `src/auth.js:89-127` (`mcpAuth`) - Reihenfolge: `config.auth.mcpAuth === "oauth"` -> `verifyOauth`; `=== "off"` -> `next()` ohne Pruefung; sonst statisches Bearer, wenn `config.auth.mcpAuthToken` gesetzt (`safeEqual(req.headers.authorization, "Bearer <token>")`); ohne Token: Modus `"token"` -> 401, Legacy `""` -> `legacyLocalBypassAllowed`. Mount: `src/routes/mcp.js:52` `router.post("/mcp", mcpAuth, ...)`, eingehaengt in `src/app.js:420`. Modi definiert in `src/config.js:1967-1980`.
- Risiko: Es gibt genau EINEN Modus zur Zeit (kein Parallelbetrieb Legacy+OAuth). Ein Umschalten auf `""`/`token` macht den OAuth-Connector stumm (in Produktion 401 fuer jeden externen Request).
- Empfehlung: Keine Code-Aenderung noetig; den Modus als Boot-Sonde sichtbar machen (s. PP-D6-16).
- Prioritaet/Kategorie: P2 / C

### PP-D6-02 Verhalten ohne Token: 401 und WWW-Authenticate
- Status: PARTIAL
- Evidenz: `src/auth.js:66-73` (`deny401`) setzt `WWW-Authenticate: Bearer resource_metadata="...", error=..., error_description=...` - wird aber NUR aus `verifyOauth` gerufen (`src/auth.js:78, 87`). Die drei anderen 401-Ausgaenge (`src/auth.js:107`, `:118`, `:122-125`) antworten mit nacktem JSON, ohne `WWW-Authenticate`. Positiv gepinnt fuer den oauth-Modus in `test/oauth.test.js:41-49`.
- Risiko: In `token`-/Legacy-Modus bekommt ein Client kein Discovery-Signal (T-13, A-04) - ChatGPT sieht ein 401 ohne Challenge und kann den Auth-Flow nicht anstossen.
- Empfehlung: `deny401` fuer ALLE 401-Ausgaenge von `mcpAuth` nutzen (Challenge auch ohne OAuth-Modus senden).
- Prioritaet/Kategorie: P1 / A

### PP-D6-03 Standard, Identity Provider, Lage von Authorization- und Token-Endpunkt
- Status: PARTIAL
- Evidenz: Der Dienst ist reiner Resource Server (`src/auth.js:1-3`, kein `/authorize`, kein `/token` im Repo - Gegenprobe: kein Treffer fuer `registration_endpoint`/`authorization_endpoint` in `src/`). Authorization Server = `config.auth.oauthIssuerUrl` (`src/config.js:1978`), Wert NICHT im Repo (`render.yaml:359-361` `sync: false`, `.env.example:966` leer). Fuer den BROWSER-Login ist der IdP belegt als WorkOS User Management (`src/config.js:1993` `workosApiBase` Default `https://api.workos.com`, `src/web-auth.js:406-407` authorize/authenticate-Endpunkte), und `src/config.js:1990-1992` sagt ausdruecklich "Geteilte client_id mit dem /mcp-Kanal".
- Risiko: Welcher Issuer live gilt, ist am Repo nicht entscheidbar; damit ist auch nicht belegbar, welche AS-Faehigkeiten (PP-D6-05) tatsaechlich zur Verfuegung stehen.
- Empfehlung: Den Live-Wert von `OAUTH_ISSUER_URL` und die Antwort seiner AS-Metadata einmal dokumentieren (Runbook), bevor eine ChatGPT-Submission gestellt wird.
- Prioritaet/Kategorie: P1 / A

### PP-D6-04 Protected Resource Metadata (RFC 9728) - Existenz, Inhalt, Erreichbarkeit
- Status: PARTIAL
- Evidenz: `src/auth.js:125-129` (`registerWellKnown`) bedient `GET /.well-known/oauth-protected-resource` UND `.../oauth-protected-resource/mcp` mit `{resource, authorization_servers, bearer_methods_supported:["header"]}`. Registriert unkonditional in `src/app.js:167`, oeffentlich eingetragen in `src/route-policy.js:86-95`. `resource` = `config.auth.oauthAudience || ${publicUrl}/mcp` (`src/auth.js:23`).
- Risiko: (a) `authorization_servers` ist ein LEERES Array, wenn `OAUTH_ISSUER_URL` leer ist (`src/auth.js:122`) - das verletzt A-03 ("mindestens ein Eintrag") und liefert einem Client ein unbrauchbares Dokument, statt gar keins; (b) kein `scopes_supported`, kein `resource_name` (A-15/Least-Privilege-Signal fehlt); (c) das Dokument ist auch im Legacy-/Token-Modus da und behauptet OAuth, das dann nicht gilt.
- Empfehlung: Das Dokument nur ausliefern, wenn ein Issuer konfiguriert ist (sonst 404), und `scopes_supported` ergaenzen, sobald es Scopes gibt.
- Prioritaet/Kategorie: P1 / B

### PP-D6-05 AS-Metadata, PKCE/S256-Advertising, DCR bzw. CIMD, Redirect-URI/iss
- Status: UNKNOWN
- Evidenz: Im Repo existiert NICHTS davon - `grep` ueber `src/` findet `registration_endpoint`, `client_id_metadata_document_supported`, `code_challenge_methods_supported`, `authorization_response_iss_parameter_supported` nirgends; `/.well-known/oauth-authorization-server` wird nur als KONSUMENT gelesen (`src/auth.js:31`, Fallback-Discovery fuer JWKS), nie ausgeliefert. Der Browser-Login zeigt lediglich, dass UNSER eigener Client S256 kann (`src/web-auth.js:66-70`, `:411-419` `code_challenge_method: "S256"`), das ist nicht die Client-Registrierung von ChatGPT.
- Risiko: T-8, T-10 und T-11 sind Anforderungen an den Authorization Server. Unterstuetzt der live konfigurierte WorkOS-Mandant weder CIMD noch DCR, kann ChatGPT sich nicht registrieren und die Integration ist nicht moeglich - unabhaengig davon, wie korrekt dieser Server Tokens prueft.
- Empfehlung: AS-Metadata des Live-Issuers abrufen und gegen T-7/T-8/T-10/T-11 pruefen; ohne CIMD/DCR wird ein eigener, vorgelagerter Authorization Server noetig.
- Prioritaet/Kategorie: P0 / A

### PP-D6-06 Token-Validierung im Detail (Signatur, Issuer, Ablauf, Clock-Skew, JWKS)
- Status: PASS
- Evidenz: `src/auth.js:75-88` - `jwtVerify(token, await getJwks(), { issuer: config.auth.oauthIssuerUrl, audience: audience(), clockTolerance: 30 })`; JWKS ueber `createRemoteJWKSet` (`src/auth.js:53-57`), URI per Discovery aus `openid-configuration` ODER `oauth-authorization-server` (`src/auth.js:29-48`). `exp`/`nbf` prueft `jose` implizit. Negativ gepinnt: abgelaufen, falsche Audience, fremder Signaturschluessel, Muell-Token -> je 401 (`test/oauth.test.js:57-73`).
- Risiko: Kein expliziter Algorithmus-Allowlist-Parameter (`algorithms`) - `jose` waehlt anhand des JWKS-Schluessels, eine Allowlist waere die strukturelle statt der abgeleiteten Zusage. `discoverJwksUri` hat keinen Fetch-Timeout und prueft nicht, ob die gemeldete `jwks_uri` zur Issuer-Origin gehoert (Issuer ist Betreiber-Config, in Produktion https-erzwungen, `src/config.js:2353-2356`).
- Empfehlung: `algorithms: ["RS256", ...]` explizit setzen; `jwks_uri`-Origin gegen den Issuer pruefen; `AbortSignal.timeout` auf die Discovery-Fetches.
- Prioritaet/Kategorie: P2 / C

### PP-D6-07 Audience-/Resource-Bindung (nur eigene Tokens annehmen)
- Status: PARTIAL
- Evidenz: `src/auth.js:23` - erwartete Audience = `config.auth.oauthAudience || ${config.server.publicUrl}/mcp`; dieselbe Funktion speist `resource` im PRM (`src/auth.js:121`). Der Override-Pfad ist getestet (`test/oauth.test.js:87-118`: Token mit kanonischer `aud` wird bei gesetztem Override abgelehnt).
- Risiko: `OAUTH_AUDIENCE` ist ein freier String (`src/config.js:1980`). Wird er auf einen nicht-kanonischen Wert gesetzt (z.B. die WorkOS-`client_id`, weil der IdP keine Resource Indicators kann), akzeptiert `/mcp` jedes Token derselben WorkOS-Umgebung - inklusive der Tokens, die der Browser-Login ausstellt (geteilte `client_id`, `src/config.js:1990-1992`). Zugleich weicht `PRM.resource` dann von der kanonischen MCP-URL ab, die ChatGPT als `resource` sendet (T-9).
- Empfehlung: `OAUTH_AUDIENCE` beim Boot gegen die kanonische MCP-URL validieren (URI-Form, gleicher Host) oder den Override entfernen, sobald der IdP RFC 8707 beherrscht.
- Prioritaet/Kategorie: P1 / B

### PP-D6-08 Pruefung pro Request oder gecacht
- Status: PASS
- Evidenz: `verifyOauth` laeuft als Middleware fuer JEDEN POST (`src/routes/mcp.js:52`); es gibt keinen Token-/Ergebnis-Cache im Modul (`src/auth.js` haelt nur `jwks`, `:51-57`). Der Transport ist stateless, pro Request neu gebaut (`src/routes/mcp.js:12-18`, `:120`), also gibt es auch keine Session, die eine Pruefung ueberspringen koennte.
- Risiko: Keines erkannt.
- Empfehlung: Beibehalten.
- Prioritaet/Kategorie: P2 / C

### PP-D6-09 Widerruf, Refresh, Invalidierung eines laufenden Zugriffs
- Status: FAIL
- Evidenz: Kein Introspection-/Revocation-Aufruf im Repo (kein Treffer fuer `introspect`/`revoke` in `src/auth.js`); der MCP-Pfad prueft keinen Tenant-Status: `src/routes/mcp.js:61` `requestTenant(req)` -> `src/routes/_tenant.js:152-167` (`store.resolveTenant(sub)`) -> `src/store/state-ops.js:5287-5296` liest nur den sub->tenant-Index, ohne `status`/`suspendedAt`. Der Browser-Pfad tut genau das Gegenteil: aktive DB-Session + Active-only-Gate (`src/web-auth.js:848-850`).
- Risiko: Ein gekuendigter, suspendierter oder bei WorkOS geloeschter Nutzer behaelt bis `exp` des Access-Tokens vollen MCP-Zugriff auf seinen Tenant (Lesen von Transkripten; Schreibpfade zusaetzlich durch Outbound-Gates gebremst, aber nicht durch Auth). Ein Notaus fuer EINEN Nutzer existiert auf diesem Kanal nicht.
- Empfehlung: Im `/mcp`-Handler nach der Tenant-Aufloesung den Tenant-Status pruefen (active) und bei allem anderen 403 senden; optional JWT-Lebensdauer kurz halten.
- Prioritaet/Kategorie: P1 / B

### PP-D6-10 Legacy-/statisches Token: timing-sicherer Vergleich
- Status: PASS
- Evidenz: `src/auth.js:95` `safeEqual(req.headers.authorization || "", "Bearer " + config.auth.mcpAuthToken)`; `src/util.js:5-9` - Laengenvergleich plus `crypto.timingSafeEqual`. Zusaetzlich greift das globale Rate-Limit auf `/mcp` (`src/app.js:320-325`, ausgenommen sind nur `/voice` und genuin lokale Aufrufer).
- Risiko: Ein statisches Token ist fuer ChatGPT ohnehin unbrauchbar (kein OAuth-Flow); als Betriebs-Modus taugt es nur fuer curl.
- Empfehlung: Fuer die oeffentliche Integration ausschliesslich `oauth` fahren.
- Prioritaet/Kategorie: P2 / C

### PP-D6-11 Unterscheidung 401 und 403
- Status: PARTIAL
- Evidenz: Auth-Fehler -> 401 (`src/auth.js:71, 96, 107, 118, 123`). Ein gueltiges Token OHNE Tenant-Zuordnung fuehrt NICHT zu 403 am MCP-Endpunkt: `src/routes/mcp.js:61` nutzt `requestTenant` (nicht `requireTenant`), `scopedTenant` wird dann `"reject"` (`src/routes/_tenant.js:82, 167`), der Request laeuft mit `DEFAULT_PROFILE` weiter (`src/store/defaults.js:1069-1077`) und die 403 entsteht erst im internen REST-Hop (`src/routes/_tenant.js:180-187`), verpackt als Tool-Ergebnis mit `isError` (`src/mcp-tools.js:84`) auf HTTP 200.
- Risiko: A-14/A-16 verlangen 403 fuer "authentifiziert, aber nicht berechtigt". Ein Client kann "Login ok, aber kein Konto" nicht von "Werkzeug ist fehlgeschlagen" unterscheiden; ChatGPT zeigt dem Nutzer keinen Auth-Hinweis.
- Empfehlung: Bei `TENANT_REJECT` im `/mcp`-Handler direkt 403 mit `WWW-Authenticate: Bearer error="insufficient_scope", resource_metadata=...` antworten.
- Prioritaet/Kategorie: P1 / B

### PP-D6-12 Bypass-Pfade und ihre Bedingungen in Produktion
- Status: PASS
- Evidenz: (a) Legacy-Socket-Bypass nur ausserhalb Produktion (`src/auth.js:19-21` `legacyLocalBypassAllowed`, `isProduction = !!RENDER_EXTERNAL_URL`, `src/config.js:199-201`), in Produktion 401 (getestet `test/auth-mcp-bypass.test.js:37-45`). (b) `MCP_AUTH=off` ist in Produktion Boot-fatal (`src/config.js:2344-2347` Footgun -> `:2492` `fatalConfigFindings` -> `:2546-2557` `assertConfig`). (c) `internalOnly`/`isTrustedLocalCaller` verlangt echtes Loopback UND kein `X-Forwarded-For` (`src/routes/_tenant.js:34-44`) - hinter Render traegt jeder externe Request XFF, die internen Header `X-Internal-Identity`/`X-Internal-Tenant` sind damit nicht spoofbar (`src/routes/_tenant.js:54-71`). (d) `DEV_LOGIN_ENABLED=true` ist in Produktion Boot-fatal (`src/config.js:2363-2368`), betrifft ohnehin nur den Browser-Login. Keine Test-Hintertuer im Auth-Pfad gefunden (kein `NODE_ENV`-Zweig in `src/auth.js`).
- Risiko: Restflaeche: `GATEWAY_URL` (`src/config.js:2307-2311`) ueberschreibt das Ziel der internen REST-Aufrufe, ist aber in `.env.example` und `render.yaml` NICHT dokumentiert (Gegenprobe: nur `PUBLIC_GATEWAY_URL` dort). Falsch gesetzt gingen die internen Identitaets-Header an einen fremden Host - kein Auth-Bypass, aber ein Exfiltrationspfad.
- Empfehlung: `GATEWAY_URL` dokumentieren und beim Boot auf Loopback einschraenken.
- Prioritaet/Kategorie: P2 / C

### PP-D6-13 Scopes: Existenz, serverseitige Pruefung, Voll-Zugriff, Lesen/Schreiben getrennt
- Status: FAIL
- Evidenz: Kein Scope-Konzept im Repo - `grep` ueber `src/` findet weder `payload.scope`/`scp` noch `scopes_supported` noch `insufficient_scope`. `verifyOauth` uebernimmt nur `sub`, `email` und die Rohclaims (`src/auth.js:82`). Autorisierung laeuft ausschliesslich ueber das Tenant-Rechteprofil: `src/routes/mcp.js:76` `store.resolveProfile(scopedTenant)` mit den Feldern `allowCalendar`/`allowConsult`/`allowLookup`/`maxCallsPerHour` (`src/store/defaults.js:761-763, 1056-1077`); der Bootstrap-Tenant bekommt hart `OWNER_PROFILE` (`src/store/defaults.js:1086-1088`), also den Voll-Zugriff. Lesen und Schreiben sind NICHT getrennt: `list_calls`/`get_transcript` und `place_call` haengen am selben Token.
- Risiko: Kein Least Privilege (A-15/A-16). Ein einmal erteiltes Token erlaubt kostenwirksames Telefonieren im Namen des Nutzers; der Nutzer kann bei der Zustimmung nicht zwischen "nur lesen" und "darf anrufen" waehlen.
- Empfehlung: Mindestens zwei Scopes (lesen/anrufen) einfuehren, im PRM als `scopes_supported` fuehren, pro Werkzeug serverseitig pruefen und bei Fehlen 403 `insufficient_scope` senden.
- Prioritaet/Kategorie: P1 / B

### PP-D6-14 Pro-Werkzeug deklarierte securitySchemes (T-15)
- Status: FAIL
- Evidenz: Kein Treffer fuer `securitySchemes` in `src/mcp-tools.js`, `src/mcp-server-info.js`, `src/ui/`. Die Werkzeuge werden ohne Auth-Metadaten registriert (`src/mcp-tools.js:561-600` `registerTools`).
- Risiko: OpenAI leitet Mixed Auth aus diesen Metadaten ab; ohne sie gibt es keine Aussage darueber, welches Werkzeug OAuth verlangt.
- Empfehlung: Je Werkzeug `securitySchemes` setzen (`{"type":"oauth2","scopes":[...]}`), passend zu PP-D6-13.
- Prioritaet/Kategorie: P1 / A

### PP-D6-15 Auth-Aufforderung aus einem Werkzeug-Ergebnis (_meta["mcp/www_authenticate"], T-14)
- Status: FAIL
- Evidenz: Kein Treffer fuer `www_authenticate` ausserhalb von `src/auth.js` (dort nur der HTTP-Header). Fehlerergebnisse tragen nur `isError` + Text (`src/mcp-tools.js:84`).
- Risiko: Ein Berechtigungsfehler mitten im Gespraech (z.B. Tenant nicht zugeordnet, s. PP-D6-11) loest in ChatGPT keine Re-Authentifizierung aus; der Nutzer sieht nur eine Fehlermeldung.
- Empfehlung: Fuer genau die Faelle "authentifiziert, aber nicht berechtigt" `_meta["mcp/www_authenticate"]` im Fehlerergebnis mitgeben.
- Prioritaet/Kategorie: P1 / A

### PP-D6-16 Ist der live wirksame Auth-Modus am Repo belegbar
- Status: PARTIAL
- Evidenz: `render.yaml:353-354` traegt `MCP_AUTH: value: ""` (Legacy), `MCP_AUTH_TOKEN: generateValue: true` (`:357-358`), `OAUTH_ISSUER_URL: sync: false` (`:360-361`). Die einzige Aussage ueber den Live-Zustand ist eine Messnotiz in `PLAN-SECURITY.md:2052-2056` ("POST /mcp laeuft live unter MCP_AUTH=oauth, 2026-08-02 gemessen") - inklusive des dort selbst notierten Restrisikos, dass der Blueprint noch `""` traegt und es "keine Boot-Sonde dafuer" gibt.
- Risiko: Ein Blueprint-Apply oder ein Rollback schaltet `/mcp` still von OAuth auf Legacy; in Produktion antwortet dann jeder externe Request mit 401 (fail-closed, aber der Connector ist tot) - und es gibt keinen Mechanismus, der das beim Boot meldet.
- Empfehlung: `MCP_AUTH=oauth` in Produktion beim Boot erzwingen (Footgun-Liste) oder mindestens im `/healthz`-Fingerabdruck sichtbar machen.
- Prioritaet/Kategorie: P1 / B

### PP-D6-17 OpenAI-managed mTLS (T-17)
- Status: N/A
- Evidenz: Kein mTLS-Bezug im Repo (kein Treffer fuer `mtls` in `src/`, `render.yaml`); TLS terminiert Render.
- Risiko: Keines - T-17 ist optional (Kategorie C in der Soll-Liste).
- Empfehlung: Nicht verfolgen, solange OAuth traegt.
- Prioritaet/Kategorie: P2 / C

## Offene Fragen (nicht am Repo entscheidbar)

- Welcher Issuer ist live in `OAUTH_ISSUER_URL` gesetzt? Der Wert ist `sync: false` (`render.yaml:360`) und steht nirgends im Repo.
- Unterstuetzt dieser Authorization Server Client ID Metadata Documents oder Dynamic Client Registration? Ohne eines von beidem kann ChatGPT keinen Client anlegen (T-10). Im Repo gibt es keine AS-Seite.
- Bewirbt seine Metadata `code_challenge_methods_supported: ["S256"]` (T-8) und `authorization_response_iss_parameter_supported: true` (T-11)? Der Repo-Code liest die Metadata nur nach `jwks_uri` (`src/auth.js:29-48`).
- Uebernimmt er den `resource`-Parameter (RFC 8707) in den Token (`aud`)? Davon haengt ab, ob `OAUTH_AUDIENCE` die kanonische MCP-URL sein kann oder ein Ersatzwert gesetzt werden muss (PP-D6-07).
- Welchen Wert hat `OAUTH_AUDIENCE` live? Nur der Live-Wert entscheidet, ob die Audience-Pruefung tenant-/dienst-spezifisch oder nur umgebungsweit ist.
- Ist die WorkOS-Instanz fuer den `/mcp`-Kanal dieselbe wie fuer den Browser-Login (geteilte `client_id`, `src/config.js:1990-1992`)? Dann waere zu pruefen, ob Browser-Session-Tokens die MCP-Audience tragen.

## Randbefund (ausserhalb dieser Dimension)

Ein 403 aus dem internen REST-Hop erreicht den Client als HTTP 200 mit `isError`-Text
(`src/mcp-tools.js:68-76`, `:84`) - fuer die Fehler-/Ergebnisdimension relevant, weil damit
jede Berechtigungs- und Gate-Ablehnung als generischer Werkzeugfehler erscheint.

## Gegenpruefung

Quelle: Code auf Branch master, jede Stelle selbst geoeffnet. Hinweis: die Zeilennummern des
Erst-Auditors sind in `src/auth.js` durchgehend um 2-6 Zeilen verschoben (er nennt `deny401`
bei :66-73, `mcpAuth` bei :89-127, `registerWellKnown` bei :125-129; tatsaechlich :66-72,
:95-117, :121-129). Die INHALTE stimmen an den korrigierten Stellen - kein Befund faellt
daran.

- D6-01: BESTAETIGT - `grep` ueber `src/ docs/ *.md` findet `registration_endpoint`,
  `client_id_metadata_document_supported`, `code_challenge_methods_supported`,
  `authorization_response_iss_parameter_supported` und `resource_indicator` NULL Mal;
  `src/auth.js:30-48` liest die AS-Metadata ausschliesslich nach `jwks_uri`, `render.yaml:360-361`
  traegt `OAUTH_ISSUER_URL` als `sync: false`. Ergaenzend (entlastet die Behauptung NICHT, praezisiert
  sie): `src/config.js:2421` macht `MCP_AUTH=oauth` ohne Issuer boot-fatal, d.h. es gibt einen
  Issuer - nur steht sein Wert und seine Faehigkeitenliste nicht im Repo.
- D6-02: BESTAETIGT - die drei Nicht-OAuth-401 liegen bei `src/auth.js:103`, `:110` und `:114`
  (nicht :107/:118/:122-125) und antworten nackt; `deny401` (`src/auth.js:66-72`) wird nur aus
  `verifyOauth` (`:78`, `:90`) gerufen, und `test/auth-p7-gate-removed.test.js:110-113` schreibt
  dieselbe Aussage als Kommentar fest ("der Legacy-Bearer-Pfad (MCP_AUTH_TOKEN) tut das nicht");
  `test/auth-p7-gate-removed.test.js:220-224` belegt zusaetzlich, dass `WWW-Authenticate` sonst
  nirgends in `src/` gesetzt wird.
- D6-03: BESTAETIGT - `grep` nach `scopes_supported`, `insufficient_scope`, `payload.scope` und
  `scp` ueber `src/` liefert NULL Treffer; `src/auth.js:86` uebernimmt `{sub, email, claims}`, und
  die einzige Autorisierungsachse ist `store.resolveProfile` (`src/routes/mcp.js:76` ->
  `src/store/defaults.js:1086-1089`), das Lesen und `place_call` nicht trennt.
- D6-04: BESTAETIGT, Prioritaet aber zu hoch angesetzt - `securitySchemes` hat NULL Treffer in
  `src/`, `test/` und `apps/`, und `registerTools` (`src/mcp-tools.js:576-600`) setzt keine
  Auth-Metadaten; Gegen-Evidenz zur Behebbarkeit: das gepinnte SDK
  (`package.json:49` `^1.12.0`, installiert 1.29.0) kennt `securitySchemes` selbst nirgends
  (`grep` in `node_modules/@modelcontextprotocol/sdk/dist/esm/` = NULL) - das ist eine
  Spec-/SDK-Versionsluecke, kein Weglassen im Repo-Code.
- D6-05: BESTAETIGT - `www_authenticate` kommt ausserhalb `src/auth.js:64-72` nirgends vor, und
  `errText` (`src/mcp-tools.js:84`) baut genau `{content:[text], isError:true}` ohne `_meta`;
  `wrapHandler` (`src/mcp-tools.js:630-648`) ist die EINE Kante, die jeden Fehler dorthin fuehrt.
- D6-06: BESTAETIGT, aber ZU BREIT formuliert - `store.tenantInactive` existiert und sperrt
  suspendierte/geschlossene Tenants hart, jedoch ausschliesslich im Ausgangspfad
  (`src/telephony/outbound-gates.js:413`, einzige Fundstelle in `src/` ausser
  `release-reconcile.js`/`billing/activation.js`); `src/routes/` enthaelt KEINEN Status-Check, und
  `resolveTenant` (`src/store/state-ops.js:5288-5298`) liest nur `subIndex`/`idpSubject`. Der
  kostenwirksame Anruf eines gesperrten Tenants wird also mit 403 abgewiesen - was bis `exp`
  offen bleibt, sind die LESENDEN Werkzeuge (Transkripte, Inbox).
- D6-07: BESTAETIGT, Reichweite kleiner als behauptet - `src/auth.js:124` liefert `[]` bei leerem
  Issuer und `src/app.js:167` registriert das Dokument unkonditional, aber `src/config.js:2421`
  verweigert den Boot bei `MCP_AUTH=oauth` ohne Issuer: das leere Array ist nur in den Modi
  `""`/`token`/`off` erreichbar, in denen ohnehin kein OAuth-Client bedient wird.
- D6-08: BESTAETIGT - `src/config.js:1980` liest `OAUTH_AUDIENCE` als freien String ohne jede
  Pruefung (keine URI-/Host-Validierung, kein Eintrag in `REQUIRED_CONFIG` oder in den
  Produktions-Footguns `src/config.js:2344-2369`), und `audience()` (`src/auth.js:23`) speist
  BEIDES: `jwtVerify` (`:83`) und `PRM.resource` (`:123`); die geteilte `client_id` ist in
  `src/config.js:1990-1992` dokumentiert (Kommentar, nicht code-erzwungen).
- D6-09: BESTAETIGT und noch untertrieben - `src/routes/mcp.js:61` nutzt `requestTenant`, der
  403-Pfad liegt nur in `requireTenant` (`src/routes/_tenant.js:180-187`) und wird von `errText`
  (`src/mcp-tools.js:84`) zu HTTP 200 + `isError`; fuer die LESE-Werkzeuge entsteht nicht einmal
  das: `src/routes/api-read.js:62-70` scopt mit `requestTenant` und liefert fuer Tenant `reject`
  HTTP 200 mit leeren Listen - ohne `isError`. `PLAN-SECURITY.md:2064-2065` benennt genau diese
  Luecke bereits.
- D6-10: BESTAETIGT - `render.yaml:353-354` traegt `MCP_AUTH: value: ""`, `:357-358`
  `MCP_AUTH_TOKEN: generateValue: true`, `:360-361` `OAUTH_ISSUER_URL: sync: false`; die einzige
  Live-Aussage ist `PLAN-SECURITY.md:2057-2060` inklusive des dort selbst notierten "Keine
  Boot-Sonde dafuer vorhanden". Kein Guard erkennt ein Zuruecksprung AUS `oauth` heraus
  (`src/config.js:2344-2369` prueft nur `off`).

### Vom Erst-Auditor uebersehen

#### PP-D6-18 MCP_AUTH akzeptiert jeden Wert - ein Tippfehler schaltet still auf statisches Token
- Status: FAIL
- Evidenz: `src/config.js:1975` `mcpAuth: (process.env.MCP_AUTH || "").toLowerCase()` - kein
  `trim()`, kein Enum, keine Validierung; verglichen wird nur gegen `"oauth"` (`src/auth.js:96`),
  `"off"` (`:97`) und `"token"` (`:108`). Jeder andere Wert (`"oauth "`, `"Oauth\n"`, `"oath"`)
  faellt still in den statischen Bearer-Zweig `src/auth.js:100-103`. Kein Eintrag in
  `REQUIRED_CONFIG` (`src/config.js:2412-2428`) und keiner in den Produktions-Footguns
  (`:2344-2369`) prueft den Wert.
- Risiko: In Produktion ist `MCP_AUTH_TOKEN` per `render.yaml:357-358` immer gesetzt. Ein
  Tippfehler im Dashboard-Wert degradiert `/mcp` damit von OAuth auf ein statisches Bearer-Token,
  ohne Boot-Fehler, ohne Logzeile und ohne `WWW-Authenticate` - dasselbe Ergebnis, das D6-10 nur
  als Blueprint-/Rollback-Risiko beschreibt, aber ohne jede Aenderung an der Konfigurations-Absicht.
- Empfehlung: `mcpAuth` gegen eine gefrorene Werteliste pruefen und einen unbekannten Wert
  boot-fatal machen (Muster `fatalConfigFindings`); zusaetzlich `trim()`.
- Prioritaet/Kategorie: P1 / B

#### PP-D6-19 verifyOauth prueft keinen Token-Typ und keine Pflichtclaims
- Status: PARTIAL
- Evidenz: `src/auth.js:81-85` uebergibt `jwtVerify` nur `issuer`, `audience` und
  `clockTolerance: 30` - kein `requiredClaims`, kein `typ`-/`token_use`-Check, keine
  `algorithms`-Allowlist. Ein ID-Token derselben Umgebung mit passender `aud` passiert die
  Pruefung; `req.auth` ist dann gesetzt (`:86`).
- Risiko: Ein Token, das nicht als Zugriffstoken fuer diese Resource gedacht war, gilt als
  Authentifizierung. Der Schaden bleibt heute begrenzt, weil ein Token ohne `sub` bei
  `src/routes/_tenant.js:152` und `:166-167` auf `resolveTenant(null)` -> `TENANT_REJECT` faellt
  (fail-closed) - aber ein ID-Token MIT `sub` des Nutzers loest denselben Tenant auf wie sein
  Access-Token.
- Empfehlung: `requiredClaims: ["sub"]` und eine explizite `algorithms`-Allowlist setzen; wenn
  der IdP einen Typ-Marker liefert (`typ`/`token_use`), ihn pruefen.
- Prioritaet/Kategorie: P1 / B

#### PP-D6-20 Keine Audit-Spur fuer eine ERFOLGREICHE MCP-Authentifizierung
- Status: FAIL
- Evidenz: `src/auth.js` auditiert ausschliesslich Fehlversuche (`:77`, `:89`, `:102`, `:113`).
  Der Erfolg erzeugt nur eine Diagnosezeile mit gehashter Mail
  (`src/routes/mcp.js:62-68` `console.log("[mcp]", ...)`), und `audit()` selbst ist reines stdout
  (`src/util.js:48-50`); der dauerhafte Trail (`src/durable-audit.js:20`
  `makeDurableAudit`) wird auf dem `/mcp`-Auth-Pfad nicht gerufen (kein Import in `src/auth.js`
  oder `src/routes/mcp.js`).
- Risiko: Zusammen mit dem fehlenden Widerruf (D6-06) gibt es fuer einen gestohlenen Token keinen
  belastbaren Nachweis, WER ihn benutzt hat - nur fluechtige Render-Logs, und dort ohne
  Token-/Subject-Bezug ausser dem E-Mail-Hash.
- Empfehlung: Einen `mcp_auth_ok`-Eintrag (Subject-Hash, Tenant, Werkzeugname) in den dauerhaften
  Audit-Store schreiben - dieselbe Naht wie die Call-Ereignisse.
- Prioritaet/Kategorie: P1 / B

#### PP-D6-21 Der stdio-MCP-Pfad hat KEINE Authentifizierung und laeuft mit Owner-Rechten
- Status: PARTIAL
- Evidenz: `src/mcp-server.js:26-28` ruft `registerTools(server, { uiHost })` OHNE `identity` und
  OHNE `scopedTenant`; `src/mcp-tools.js:57-59` setzt die Header `X-Internal-Identity`/
  `X-Internal-Tenant` dann nicht, `src/routes/_tenant.js:145`/`:165` faellt auf
  `operatorChannelTenant` -> `BOOTSTRAP_TENANT_ID`, und `src/store/defaults.js:1056-1065`
  vergibt dafuer hart `OWNER_PROFILE` (`allowCalendar/allowConsult/allowLookup/allowBooking` true,
  `maxCallsPerHour: null`). `mcpAuth` kommt auf diesem Transport nicht vor.
- Risiko: Wer den Prozess auf dem Host starten und das Gateway ueber Loopback erreichen kann, hat
  ohne Token volle Owner-Rechte inklusive `place_call`. Das ist eine bewusste
  Single-Operator-Annahme (dokumentiert in `PLAN-SECURITY.md:2046-2049`), aber PP-D6-12 zaehlt die
  Bypass-Pfade auf und nennt diesen nicht - fuer eine OpenAI-Submission ist er die zweite,
  ungeprueft bedienbare Tuer zu denselben Werkzeugen.
- Empfehlung: Den stdio-Transport nicht ausliefern oder an ein eigenes Geheimnis binden; mindestens
  im Auth-Inventar als bewusste Ausnahme fuehren (analog `src/route-policy.js`).
- Prioritaet/Kategorie: P2 / C

#### PP-D6-22 Lesende Werkzeuge liefern bei fehlender Berechtigung LEERE Daten statt eines Fehlers
- Status: FAIL
- Evidenz: `src/routes/api-read.js:62-70` nutzt `requestTenant` (nicht `requireTenant`) und scopt
  ueber `store.exportTenantData(tenantId)`; mit `tenantId === "reject"` ist das Ergebnis HTTP 200
  mit leeren `calls`/`actionItems`/`notifications`. Alle lesenden Werkzeuge erben das
  (`src/routes/api-read.js:59-61` nennt `list_calls`/`list_action_items`/`get_my_number`/
  `get_agent_status`). `PLAN-SECURITY.md:2064-2065` benennt das als bewusst offenes
  Abnahmekriterium.
- Risiko: Ein authentifizierter Nutzer ohne Tenant-Zuordnung (frisch eingeloggt, gekuendigt, in
  WorkOS geloeschter aber nicht propagierter Account) sieht "keine Anrufe" statt "kein Zugriff" -
  weder der Nutzer noch ChatGPT kann daraus einen Auth-/Berechtigungszustand ableiten, und es gibt
  keinen Ausloeser fuer eine Re-Authentifizierung. Das ist der leisere Zwilling von D6-09.
- Empfehlung: Auf `TENANT_REJECT` im `/mcp`-Handler direkt 403 antworten (siehe PP-D6-11), statt
  die Leere durch alle Lesepfade zu tragen.
- Prioritaet/Kategorie: P1 / B
