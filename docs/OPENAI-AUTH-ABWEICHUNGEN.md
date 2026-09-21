# OpenAI-Einreichung: Auth-Abweichungen (T-9, T-11, T-12, T-14, T-16)

> **Zweck.** Belegdokument fuer den OpenAI-Pruefer, Phase P7 der Hermes-OpenAI-Einreichung
> (`tasks/PLAN-OPENAI-TECHNIK.md` §P7, `tasks/openai-p7-spec.md`). Massgeblicher Wortlaut ist
> ausschliesslich `tasks/openai-audit/00-openai-anforderungen.md` (die 100 fuer die Einreichung
> relevanten IDs) - **nicht** `00-mcp-spec.md`, das eine andere Norm ist und bei
> `destructiveHint` widerspricht. Alle Aussagen unten sind am 2026-09-21 gemessen (Code lesend,
> Anbieter lesend GET), nicht aus frueheren Berichten uebernommen. **Kein Login, kein Token,
> kein Schreibzugriff wurde fuer dieses Dokument verwendet.**

## 1. Architektur in drei Saetzen

Hermes ist ausschliesslich **OAuth-2.1-Resource-Server** fuer `/mcp` (`src/auth.js`), niemals
Authorization Server - es gibt keinen eigenen `/.well-known/oauth-authorization-server` und
keine eigene Login-/Consent-Seite. **WorkOS AuthKit** (`https://fearless-network-26.authkit.app`)
ist der Authorization Server; Hermes vertraut ihm ueber JWKS-Discovery und prueft jedes Bearer-
Token lokal (Signatur, Issuer, Audience, Ablauf). Die Pruefung sitzt **einmal pro HTTP-Request**
in der Middleware `mcpAuth` (`src/routes/mcp.js:113`), **vor** jedem MCP-Tool-Aufruf - es gibt
keinen zweiten Pruefpunkt und keinen Auth-Fehler, der aus einem laufenden Tool heraus entsteht.

## 2. Status je ID

Status-Vokabular: **erfuellt** / **teilweise** / **nicht anwendbar** / **nicht in unserer Hand**.
Jede Zeile mit Rest nennt eine konkrete Owner-Frage in Abschnitt 4.

### T-14 — Auth-UI im Gespraech ueber `_meta["mcp/www_authenticate"]` im Tool-Fehlerergebnis

**Status: nicht anwendbar — bewusst nicht gebaut.**

Auth scheitert bei Hermes immer **vor** dem Tool-Aufruf, auf HTTP-Ebene: `mcpAuth` laeuft als
Express-Middleware vor `POST /mcp` (`src/routes/mcp.js:113`), *bevor* irgendein MCP-Handler
erreicht wird. In `src/mcp-tools.js` existiert **kein** Auth-Fehlerzweig: die Fehlerhuelle
`errText()` (`src/mcp-tools.js:88`) und `wrapHandler` (`src/mcp-tools.js:880-895`) fangen
Tool-eigene Fehler ab (z. B. unbekannte `call_id`), nie einen Auth-Fehler. Jede Token-
Ungueltigkeit waehrend eines laufenden Gespraechs (z. B. Ablauf zwischen zwei Turns) trifft also
den **naechsten** `POST /mcp` als HTTP-401 mit Bearer-Challenge (`src/auth.js:109-111`, belegt in
`test/oauth.test.js:66-70`) — nicht als Tool-Ergebnis mit `isError:true`.

Eine zweite Fehlerklasse existiert und sieht auf den ersten Blick aehnlich aus: der interne
REST-Hop (`src/mcp-tools.js:61-80`, `api()`) kann 403 liefern, entweder weil der Request nicht
lokal ist (`src/wiring/internal-only.js:24-28`) oder weil ein Consult-Endpunkt eine
Tenant-/Plan-Regel verletzt (`src/routes/api-calls.js:692-699`). Dieser 403 kommt bei
`wrapHandler` als `isError:true`-Tool-Ergebnis an (`src/mcp-tools.js:880-895`). Er ist aber durch
Re-Authentisierung **nicht loesbar** — er ist entweder ein interner Programmierfehler oder ein
Profil-/Plan-Recht, kein abgelaufenes Token. Ein `_meta`-Feld dort waere entweder toter Code
(nie ein Re-Auth-Ausloeser dahinter) oder, schlimmer, eine Re-Auth-Schleife bei jedem
Consult-/Profilfehler. **Nicht gebaut** (CLAUDE.md verbietet toten Code hart).

**Bedingung (woertlich, Pflicht-Wiederholung vor jeder Einreichung):** diese Aussage gilt NUR,
solange Produktion `MCP_AUTH=oauth` faehrt. Im token-/Legacy-Zweig traegt der 401 seit P6 zwar
ebenfalls eine Challenge, aber **ohne** `resource_metadata` (`STATIC_BEARER_CHALLENGE`,
`src/auth.js:89`) — dann findet ChatGPT keinen OAuth-Einstieg ueber den Header. Pruefkommando:

```
curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp
```

muss eine Zeile `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/...`
enthalten. Live gemessen 2026-09-21T10:06:03Z: **enthaelt sie** (Abschnitt 3, "POST /mcp ohne
Token"). Vor jeder Einreichung erneut pruefen.

### T-12 — Token-Pruefung: Signatur/JWKS, `iss`, `exp`/`nbf`, Audience, Scopes, eigene Policy

**Status: teilweise erfuellt.**

Geprueft wird in `verifyOauth()` (`src/auth.js:91-113`) in einem einzigen `jwtVerify`-Aufruf
(`:98-102`): Signatur gegen den per JWKS-Discovery gefundenen Schluessel, `issuer` gegen
`config.auth.oauthIssuerUrl`, `audience` gegen die kanonische Resource, `exp`/`nbf` mit
`clockTolerance: 30` Sekunden. Bisher nur am Code behauptet, jetzt am echten `tools/list`-Response
belegt (**neu, diese Phase**, `test/openai-p7-token-pruefachsen.test.js`):

- `OpenAI-P7-T1`: Token mit fremdem `iss` (bei sonst gueltiger Signatur) -> **401** + Bearer-
  Challenge mit `resource_metadata`, kein `jsonrpc`-Feld im Body.
- `OpenAI-P7-T2`: Token mit `nbf` 3600 Sekunden in der Zukunft (weit jenseits der 30s
  `clockTolerance`) -> **401**.
- `OpenAI-P7-T3` (Positiv-Kontrolle): gueltiges Token **ohne** `scope`-Claim -> **200**. Belegt,
  dass das Gate nicht pauschal alles ablehnt.
- `OpenAI-P7-T4`: gueltiges Token mit einem **beliebigen** `scope`-Claim (`"nicht-vergeben"`) ->
  ebenfalls **200**. Belegt die Luecke: der Scope-Wert wird weder verlangt noch ausgewertet.

Eigene Policy (jenseits des Tokens) existiert: Tenant-Bindung ueber `sub`
(`src/routes/mcp.js:59-64`), ein gueltiges Token ohne zugeordneten Tenant erhaelt 403 (belegt in
`test/e4-mandantentrennung-default.test.js:210-220`, ID E4-17 — dort bereits erfuellt, hier nur
referenziert).

**Scope wird NICHT geprueft** — 0 Codestellen (`grep -rn "scope\|scp" src/auth.js` liefert keinen
Treffer). Konsistent mit der deklarierten Security-Scheme: `securitySchemes = [{type:"oauth2",
scopes: []}]` (`src/mcp-security-schemes.js:19-27`), Kommentar dort: leere Scope-Liste, weil der
Anbieter keinen fachlichen Scope-Claim liest oder ausstellt.

**Rest (UNKNOWN, Owner O-3):** WorkOS bewirbt nur die Identitaets-Scopes `email`,
`offline_access`, `openid`, `profile` (Abschnitt 3) — keinen ressourcenspezifischen Scope. Ob ein
echtes WorkOS-Access-Token einen `scope`- oder `scp`-Claim traegt, ist ohne einen abgeschlossenen
Login nicht messbar.

### T-9 — Authorization Server uebernimmt den `resource`-Parameter ins Token (i. d. R. `aud`)

**Status: unsere Haelfte erfuellt; Anbieterhaelfte nicht in unserer Hand.**

Wir verlangen `aud` == kanonische Resource (`audience()`, `src/auth.js:23`, geprueft in
`:100`); die Protected-Resource-Metadata kuendigt exakt diese Resource an (live gemessen:
`"resource":"https://app.sundartha.com/mcp"`, Abschnitt 3); eine Divergenz zwischen dem, was wir
pruefen, und dem, was wir ankuendigen, ist seit E5/S2-A6 **Boot-fatal**
(`src/boot-guard.js:928-950`, belegt in `test/oauth.test.js:107-119`); falsches `aud` im Token
-> 401 (`test/oauth.test.js:72-76`).

Das im Plan zunaechst genannte Feld `resource_indicators_supported` steht **nicht** im
massgeblichen Wortlaut (`00-openai-anforderungen.md` Zeile 42) — es fehlt zwar bei WorkOS
(Abschnitt 3), ist aber kein Pruefkriterium fuer T-9, nur ein Nebenbefund.

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (a)):** ob WorkOS den `resource`-Parameter (RFC 8707)
aus Authorization- und Token-Request 1:1 nach `aud` kopiert, ist nur am echten Token pruefbar.
**Folge bei Nein:** fail-closed — jedes ChatGPT-Token scheitert mit 401. Das ist ein
**Verbindungsproblem**, kein Sicherheitsproblem; die Audience-Pruefung selbst wird dafuer nicht
aufgeweicht (Safety-Gate-Regel, CLAUDE.md).

### T-11 — Stabile Redirect-URI nur mit RFC-9207-`iss`, sonst callback-spezifische URI

**Status: nicht in unserer Hand; der im Wortlaut selbst genannte Rueckfallzweig greift.**

`authorization_response_iss_parameter_supported` fehlt in **beiden** WorkOS-Dokumenten
(Abschnitt 3). Hermes ist reiner Resource Server und stellt keine Authorization-Response aus —
an diesem Feld ist kein eigener Code beteiligt, es kann nicht "gebaut" werden, ohne WorkOS'
Faehigkeiten faelschlich zu behaupten. Der massgebliche Wortlaut selbst nennt fuer den Fall des
fehlenden Felds den Rueckfall: die callback-spezifische Redirect-URI
(`https://chatgpt.com/connector/oauth/{callback_id}`) — kein Einreichungs-Blocker per Wortlaut.

**Rest (UNKNOWN, Owner O-5 / WorkOS-Frage (b)):** ob WorkOS diese Rueckfall-URI akzeptiert (ueber
CIMD/DCR — `client_id_metadata_document_supported: true` und `registration_endpoint` stehen nur
im zweiten Dokument, `oauth-authorization-server`), ist erst am ersten echten Connector-Flow
messbar.

### T-16 — Fuer Workspace-Domain-Restriktionen: OIDC-Discovery + Scopes + UserInfo mit `email_verified`

**Status: teilweise erfuellt, beim Anbieter (nur relevant, falls Workspace-Domain-Restriktionen
genutzt werden sollen).**

OIDC-Discovery antwortet HTTP 200 (`openid-configuration`, Abschnitt 3); `scopes_supported`
enthaelt `openid` und `email`; ein `userinfo_endpoint` existiert und antwortet ohne Token
korrekt mit 401 (kein 404, kein 500 — der Endpunkt existiert und verlangt ein Token).

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (c)):** ob `/oauth2/userinfo` mit einem echten Token
`email_verified: true` liefert, ist ohne Login nicht messbar. `claims_supported` fehlt in beiden
Dokumenten, steht aber **nicht** im massgeblichen Wortlaut (Zeile 49) — kein Pruefkriterium fuer
T-16, nur Nebenbefund.

## 3. Messprotokoll (roh, mit Zeitstempel)

Gemessen 2026-09-21T10:06:01Z–10:06:13Z (UTC). Nur lesende GETs plus ein tokenloser POST (liefert
401, schreibt nichts) — kein Login, kein Token, kein Cookie, kein Render-Tool.

```
=== 2026-09-21T10:06:01Z ===
--- openid-configuration ---
{"issuer":"https://fearless-network-26.authkit.app","authorization_endpoint":"https://fearless-network-26.authkit.app/oauth2/authorize","device_authorization_endpoint":"https://fearless-network-26.authkit.app/oauth2/device_authorization","grant_types_supported":["authorization_code","client_credentials","refresh_token","urn:ietf:params:oauth:grant-type:device_code"],"id_token_signing_alg_values_supported":["RS256"],"introspection_endpoint":"https://fearless-network-26.authkit.app/oauth2/introspection","jwks_uri":"https://fearless-network-26.authkit.app/oauth2/jwks","response_types_supported":["code"],"scopes_supported":["email","offline_access","openid","profile"],"subject_types_supported":["public"],"token_endpoint":"https://fearless-network-26.authkit.app/oauth2/token","token_endpoint_auth_methods_supported":["none","client_secret_basic","client_secret_post"],"userinfo_endpoint":"https://fearless-network-26.authkit.app/oauth2/userinfo"}

--- oauth-authorization-server ---
{"authorization_endpoint":"https://fearless-network-26.authkit.app/oauth2/authorize","client_id_metadata_document_supported":true,"code_challenge_methods_supported":["S256"],"device_authorization_endpoint":"https://fearless-network-26.authkit.app/oauth2/device_authorization","grant_types_supported":["authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:device_code"],"introspection_endpoint":"https://fearless-network-26.authkit.app/oauth2/introspection","issuer":"https://fearless-network-26.authkit.app","jwks_uri":"https://fearless-network-26.authkit.app/oauth2/jwks","registration_endpoint":"https://fearless-network-26.authkit.app/oauth2/register","scopes_supported":["email","offline_access","openid","profile"],"response_modes_supported":["query"],"response_types_supported":["code"],"token_endpoint":"https://fearless-network-26.authkit.app/oauth2/token","token_endpoint_auth_methods_supported":["none","client_secret_post","client_secret_basic"]}

--- userinfo (ohne Token) ---
HTTP/2 401
{"error":"unauthorized"}

--- oauth-protected-resource (Live-Gateway) ---
HTTP/2 200
{"resource":"https://app.sundartha.com/mcp","authorization_servers":["https://fearless-network-26.authkit.app"],"bearer_methods_supported":["header"]}

--- POST /mcp ohne Token (Live-Gateway) ---
HTTP/2 401
www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"
{"error":"Kein Token"}
=== Ende 2026-09-21T10:06:03Z ===

=== Sonde AS-Faehigkeiten (scripts/probe-as-faehigkeiten.mjs) === Ziel: https://app.sundartha.com  2026-09-21T10:06:13.087Z
[PASS] PRM erreichbar HTTP 200
[INFO] resource (F2) = https://app.sundartha.com/mcp
[INFO] authorization_servers[0] (F1) = https://fearless-network-26.authkit.app
[PASS] WWW-Authenticate vorhanden -> Modus oauth
[PASS] AS-Metadata erreichbar (openid-configuration HTTP 200, oauth-authorization-server HTTP 200)
[INFO] scopes_supported = email, offline_access, openid, profile
[PASS] 1/8 issuer-Gleichheit (A-06/T-7)
[PASS] 2/8 jwks_uri auf Issuer-Origin
[FAIL] 3/8 PKCE S256 beworben (T-8) - code_challenge_methods_supported: (fehlt in openid-configuration)
[FAIL] 4/8 DCR: registration_endpoint (T-10) - (fehlt in openid-configuration)
[FAIL] 5/8 CIMD beworben (T-10) - (fehlt in openid-configuration)
[PASS] 6/8 Token-Auth 'none' moeglich (T-10)
[UNKNOWN] 7/8 RFC 9207 iss-Parameter (T-11) - authorization_response_iss_parameter_supported: (fehlt)
[PASS] 8/8 userinfo_endpoint (T-16)
=== Ergebnis: PFLICHT 3/4 PASS - Befunde 4 PASS, 2 FAIL, 1 UNKNOWN
```

**Einschraenkung der Sonde:** `scripts/probe-as-faehigkeiten.mjs` wertet fuer die Befunde 3-8 nur
das **erste** Dokument (`openid-configuration`) aus. `code_challenge_methods_supported`,
`registration_endpoint` und `client_id_metadata_document_supported` stehen bei WorkOS nur im
**zweiten** Dokument (`oauth-authorization-server`, s. oben) — die Sonde meldet deshalb FAIL, wo
das Feld beim Anbieter tatsaechlich vorhanden ist. Kein Widerspruch in der Sache, nur eine
Grenze des Messwerkzeugs (nicht P7-Scope, hier nur vermerkt).

**Neue Messung gewinnt:** weicht eine kuenftige Messung von diesem Protokoll ab, gilt die neue
Messung, und dieses Dokument wird mit dem neuen Zeitstempel aktualisiert — nicht umgekehrt.
**Vor jeder Einreichung Schritt 1 (dieses Messprotokoll) erneut fahren.**

## 4. Konkrete Fragen an WorkOS (Owner-Handlungsauftrag)

a. **(T-9)** Kopiert AuthKit den `resource`-Parameter (RFC 8707) aus Authorization- und
   Token-Request in den `aud`-Claim des ausgestellten Access-Tokens?
b. **(T-11)** Kann AuthKit `iss` in Authorization-Responses setzen und
   `authorization_response_iss_parameter_supported: true` in der AS-Metadata bewerben?
c. **(T-16)** Liefert `/oauth2/userinfo` mit einem gueltigen Token `email_verified: true`?
d. **(T-8, Nebenbefund OW-7)** Warum fehlt `code_challenge_methods_supported` in
   `openid-configuration`, obwohl es in `oauth-authorization-server` steht? Welches der beiden
   Dokumente fragt ein Connector wie ChatGPT typischerweise zuerst ab?
e. **(T-12)** Gibt es bei AuthKit ressourcenspezifische (nicht nur Identitaets-) Scopes, die wir
   fuer `/mcp` verlangen und pruefen koennten?

## 5. Owner-Messung O-3 (Handlungsanweisung, nicht von einem Agenten gefahren)

Sobald ein echter, abgeschlossener WorkOS-Login vorliegt (z. B. der produktive Claude-Connector-
Flow): das Access-Token dekodieren (Base64, kein Secret noetig fuer die Payload) und pruefen:

1. `aud` — entspricht sie der Resource `https://app.sundartha.com/mcp`? (T-9)
2. `scope` / `scp` — ist ein Claim vorhanden, und wenn ja, welcher Wert? (T-12)
3. `GET /oauth2/userinfo` mit demselben Token — liefert die Antwort `email_verified: true`? (T-16)

Diese drei Werte schliessen die UNKNOWN-Reste in Abschnitt 2. Kein Agent fuehrt diesen Schritt
aus — er verlangt einen abgeschlossenen Login (Owner-Only).

## 6. Was sich aendert, wenn …

- **… WorkOS einen ressourcenspezifischen Scope ausstellt:** T-12 kann gebaut werden — Pruefung
  in `verifyOauth()` nach `jwtVerify`, fail-closed, mit Boot-Guard-Eintrag, **hinter einem
  Schalter mit Default aus** und Vier-Orte-Pflege (`src/config.js`, `.env.example`,
  `render.yaml`, `BASE_ENV` in `test/helpers.js`). `OpenAI-P7-T4` in
  `test/openai-p7-token-pruefachsen.test.js` **muss dann rot werden** — geschieht das nicht, hat
  die neue Pruefung keine Wirkung. Wird der Schalter umgelegt, muessen zusammen mit dem Test auch
  `src/mcp-security-schemes.js:21-27` (`scopes: []`) und dieses Dokument geaendert werden.
- **… WorkOS `resource` nicht nach `aud` kopiert:** jeder ChatGPT-Login scheitert am
  Einreichungstag mit 401. Das ist ein Verbindungsausfall, kein Sicherheitsausfall — die Audience-
  Pruefung wird dafuer **nicht** aufgeweicht.
- **… Produktion nicht mehr `MCP_AUTH=oauth` faehrt:** die T-14-Aussage ("Transport-Pfad deckt die
  Anforderung ab") faellt — der token-/Legacy-Zweig verweist nicht auf die Protected-Resource-
  Metadata (Abschnitt 2, T-14-Bedingung).

## 7. Offene Befunde (nicht gebaut, nur notiert)

- **B-1:** `rejectIfNoTenant` (`src/routes/mcp.js:59-64`) antwortet einem gueltigen Token ohne
  zugeordneten Tenant mit **403 ohne** `WWW-Authenticate`. RFC 6750 §3.1 saehe fuer 403
  `error="insufficient_scope"` vor; der massgebliche OpenAI-Wortlaut (T-13) verlangt die
  Challenge nur fuer 401. Ob ChatGPT bei 403 einen Konto-Wechsel-Dialog anbietet, ist UNKNOWN.
  Kein Einreichungskriterium — Befund fuer P10/Owner, hier nicht geaendert.
- **T-8 (Nebenbefund, nicht P7-Vorrat):** `code_challenge_methods_supported` fehlt in
  `openid-configuration`, steht in `oauth-authorization-server` (Abschnitt 3). Unser
  `discoverJwksUri()` probiert `openid-configuration` zuerst (`src/auth.js:31`) — fuer uns
  folgenlos (wir lesen dort nur `jwks_uri`), fuer ChatGPTs eigene Discovery-Reihenfolge UNKNOWN
  (Frage d, Abschnitt 4). Owner-Punkt, nicht gebaut.

## 8. Doppelte Pfade (Vollstaendigkeits-Check)

- **HTTP `/mcp` vs. stdio:** `mcpAuth` ist der **einzige** Auth-Pfad — er existiert nur fuer die
  HTTP-Route (`src/routes/mcp.js:113`). stdio (`src/mcp-server.js:35-46`) registriert Tools ohne
  Auth-Middleware und ruft bewusst kein `applyToolSecuritySchemes` auf; T-9/T-11/T-12/T-14/T-16
  sind fuer stdio **nicht anwendbar** (kein Token, kein OpenAI-Connector-Pfad dort).
- **mcp-nativer Adapter vs. ChatGPT-Adapter (beide ueber HTTP):** `mcpAuth` laeuft **vor** der
  Adapterwahl (`src/routes/mcp.js:113` vs. `:153`) — beide Adapter teilen denselben
  Auth-Codepfad, ein zweiter Test pro Adapter ist nicht noetig und wurde nicht gebaut.

## 9. Nicht doppelt verbucht

T-13 (Bearer-Challenge auf allen 401-Pfaden) und T-5 (dasselbe) sind **P6-Leistung**
(`test/openai-p6-challenge.test.js`); T-15 (`securitySchemes` am echten `tools/list`) ist
**P3-Leistung** (`test/openai-p3-security-schemes.test.js`). Alle drei werden hier nur
referenziert, nicht als P7-Ergebnis gefuehrt.
