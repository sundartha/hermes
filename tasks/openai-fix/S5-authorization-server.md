# Schnitt S5: Authorization-Server-Seite: DCR, PKCE, Resource Indicators
Blocker: P0-8 | Anforderungs-IDs: T-7, T-8, T-9, T-10, T-11, T-6 (Feldliste), A-02, A-03, A-04, A-05, A-06, A-11, A-12 | Kategorie: A (T-8/T-9/T-10/T-11 belegte OpenAI-Pflicht), B (SSRF-/Kanonizitaets-Haertung)

## Vorfrage zuerst: wer baut, wer stellt ein, wer kann etwas nicht

Hermes ist MCP-seitig **reiner Resource Server**, kein Authorization Server: es gibt kein
`/authorize`, kein `/token`, kein `/register` im Repo (`src/auth.js:1-3`; `grep -rn
"registration_endpoint\|authorization_endpoint" src/` = 0 Treffer). Der Authorization
Server ist **WorkOS AuthKit**. Beleg im Repo, nicht geraten:

- `.env.example:981` "Nur bei MCP_AUTH=oauth: Issuer-URL des IdP (z.B. WorkOS AuthKit)"
- `.env.example:1091` "OAUTH_ISSUER_URL wird mit /mcp geteilt (WorkOS AuthKit Issuer)"
- `src/config.js:2027` derselbe Satz am Feld `oauthIssuerUrl`
- `src/auth.js:26-29` der JWKS-Discovery-Kommentar nennt ausdruecklich "so dokumentiert WorkOS AuthKit"
- `PLAN-SECURITY.md:1114` "nur OIDC-Client + AuthKit-Issuer"
- `src/config.js:2044` `workosApiBase` Default `https://api.workos.com`, Browser-Login gegen
  `/user_management/authorize|authenticate` (`src/web-auth.js:405-407`), laut
  `src/config.js:2042-2043` mit **geteilter `client_id`** zum `/mcp`-Kanal

Der **Wert** von `OAUTH_ISSUER_URL` steht nicht im Repo (`render.yaml:360-361` `sync: false`,
`.env.example:983` leer) -> UNKNOWN, siehe F1.

### (a) Was WIR im Code bauen — 4 Aenderungen
A1 Metadata-Konsum haerten (Issuer-Gleichheit, jwks_uri-Origin, Fetch-Frist).
A2 PRM fail-closed + Feldergaenzung.
A3 Kanonizitaet der Resource-URI als Produktions-Footgun.
A4 Feststellungs-Sonde als Skript (kein Laufzeitpfad).

### (b) Was beim Anbieter EINGESTELLT wird (kein Code, WorkOS-Dashboard)
| ID | Einstellung | Ort laut Anbieter-Doku | Quelle |
|---|---|---|---|
| B1 | Kanonische MCP-URL als **Resource Indicator** eintragen ("Register your MCP server's URL as a Resource Indicator ... AuthKit will stamp tokens issued for your server with a matching `aud` claim") | Dashboard: Connect -> Configuration | https://workos.com/blog/build-stateless-mcp-server-2026-07-28-authkit , https://workos.com/docs/authkit/mcp |
| B2 | **CIMD einschalten** — "Client ID Metadata Document is off by default, but you should enable it in the WorkOS Dashboard under Connect -> Configuration" | dito | https://workos.com/docs/authkit/mcp |
| B3 | **DCR parallel anlassen** — "Keep DCR active in parallel until you're confident every client you support has moved over" | dito | https://workos.com/blog/build-stateless-mcp-server-2026-07-28-authkit |
| B4 | Nach B1-B3 die AS-Metadata erneut abrufen und den Schnappschuss ablegen (Lehre "Provider-Config erst belegen": erst GET+Snapshot, dann patchen) | - | F5 |

### (c) Was der Anbieter kann / nicht kann — Faehigkeiten mit Beleg
Quelle der Feldliste: `GET <issuer>/.well-known/oauth-authorization-server`, woertlich
dokumentiert unter https://workos.com/docs/authkit/mcp :

```
authorization_endpoint, token_endpoint, introspection_endpoint,
registration_endpoint, issuer,
code_challenge_methods_supported: ["S256"],
grant_types_supported: ["authorization_code","refresh_token"],
scopes_supported: ["email","offline_access","openid","profile"],
response_types_supported: ["code"], response_modes_supported: ["query"],
token_endpoint_auth_methods_supported: ["none","client_secret_post","client_secret_basic"]
```

| Anforderung | Kann der AS das? | Beleg | Konsequenz |
|---|---|---|---|
| T-7 AS-Metadata unter `oauth-authorization-server` **und** `openid-configuration` | JA, beide | Doku oben; `openid-configuration` separat dokumentiert mit `issuer/authorization_endpoint/token_endpoint/userinfo_endpoint/jwks_uri` (https://workos.com/docs/reference/workos-connect/metadata/openid-configuration) | nichts zu tun; unser Discovery-Fallback (`src/auth.js:31`) passt auf beide |
| T-8 PKCE `S256` beworben | JA | `code_challenge_methods_supported: ["S256"]` | nichts zu bauen; F4 belegt es am LIVE-Issuer |
| T-9 `resource` -> `aud` (RFC 8707) | JA, nach Eintrag | "Access tokens will be issued with an `aud` claim that matches the requested `resource`" | B1 + A3: die kanonische MCP-URL ist die Audience, `OAUTH_AUDIENCE` wird in Produktion nicht mehr frei |
| T-10 CIMD bevorzugt | JA, aber **Default AUS** | "off by default ... enable it in the WorkOS Dashboard" | B2 |
| T-10 DCR als Alternative | JA | `registration_endpoint` in der Metadata, Dashboard-Schalter | B3 |
| T-10 Token-Endpoint-Auth `none` oder `private_key_jwt` | `none` JA | `token_endpoint_auth_methods_supported` enthaelt `"none"` | nichts zu tun |
| T-11 RFC-9207 `iss` in Authorization-Responses / `authorization_response_iss_parameter_supported` | **UNKNOWN** — in der WorkOS-Doku an keiner Stelle erwaehnt; der eigene WorkOS-Artikel zu RFC 9207 (https://workos.com/blog/oauth-mix-up-attacks-rfc-9207) sagt nichts ueber die eigene Unterstuetzung | - | Feststellungsaufgabe F4. **Kein Blocker**: ohne `iss` entfaellt nur die stabile Redirect-URI `https://chatgpt.com/connector_platform_oauth_redirect`, ChatGPT nutzt dann die callback-spezifische `https://chatgpt.com/connector/oauth/{callback_id}` (T-11, `00-openai-anforderungen.md:44`). Zu bauen ist dafuer nichts — der Client bringt seine Redirect-URI per CIMD/DCR mit |
| T-16 UserInfo mit `email`/`email_verified` (nur fuer Workspace-Domain-Restriktionen) | UserInfo-Endpunkt existiert (`/oauth2/userinfo`); ob `email_verified` geliefert wird: **UNKNOWN** | openid-configuration-Referenz oben | F4 notiert es; nur relevant, wenn Workspace-Restriktionen gewollt sind — sonst ohne Folge |
| Eigene/granulare MCP-Scopes (`mcp:read`, `mcp:call`) | **UNKNOWN** — die dokumentierte `scopes_supported`-Liste kennt nur `email/offline_access/openid/profile`; ein Custom-Scope-Weg ist in der MCP-Doku nicht dokumentiert | dito | **gehoert nicht in diesen Schnitt**, aber die Feststellung F4 liefert dem Scope-Schnitt die Tatsachenbasis. Kann der AS keine eigenen Scopes, ist A-15/A-16 dort nicht per Token loesbar |
| Widerruf/Introspection | `introspection_endpoint` existiert | dito | Tatsache fuer den Widerruf-Schnitt (P1-14), hier keine Aenderung |

UNKNOWN wird **nicht** wegplaniert: F4 ist eine Messung, keine Bauaufgabe, und ihr Ergebnis
ist Vorbedingung fuer A1 (s. Abhaengigkeiten).

## Ist-Zustand
- `src/auth.js:23` `audience()` = `config.auth.oauthAudience || \`${config.server.publicUrl}/mcp\``. Derselbe Wert speist `jwtVerify` (`:83`) UND `PRM.resource` (`:123`).
- `src/config.js:2031` `oauthAudience: process.env.OAUTH_AUDIENCE || ""` — freier String, keine URI-/Host-Pruefung, kein Eintrag in `REQUIRED_CONFIG` (`:2455-2500`) und keiner in `PRODUCTION_FOOTGUNS` (`:2375-2422`).
- `src/auth.js:30-48` `discoverJwksUri`: zwei Well-known-Pfade, nimmt das erste `jwks_uri` (`:41`). **Kein** Vergleich des Feldes `issuer` im Dokument gegen `config.auth.oauthIssuerUrl`, **keine** Origin-Bindung von `jwks_uri`, **kein** Fetch-Timeout (`:35` nacktes `fetch`).
- `src/auth.js:81-85` `jwtVerify` prueft `issuer`, `audience`, `clockTolerance: 30` — die Token-Seite ist in Ordnung (und negativ getestet, `test/oauth.test.js:57-73`).
- `src/auth.js:121-129` PRM: genau drei Felder (`resource`, `authorization_servers`, `bearer_methods_supported`), beide Pfade, unkonditional registriert (`src/app.js:167`), oeffentlich eingetragen (`src/route-policy.js:86-95`, gepinnt `test/route-auth-inventory.test.js:177-178`). `authorization_servers` ist `[]`, wenn kein Issuer gesetzt ist (`:124`).
- `src/config.js:2472` macht `MCP_AUTH=oauth` ohne Issuer boot-fatal — das leere Array ist also nur in den Modi `""`/`token`/`off` erreichbar.
- `scripts/check-setup.js:137-189` prueft AS-Metadata und PRM bereits — aber gegen die **lokale** Config und nur auf `jwks_uri` bzw. `authorization_servers`; keine der vier T-8/T-10/T-11-Felder wird betrachtet.
- Live-Werte von `OAUTH_ISSUER_URL`, `OAUTH_AUDIENCE`, `MCP_AUTH`: nicht im Repo (`render.yaml:353-361`; `MCP_AUTH` traegt im Blueprint `""`, die einzige Live-Aussage ist die Messnotiz `PLAN-SECURITY.md:2052-2056`).

## Soll-Zustand
1. Die AS-Metadata wird nur akzeptiert, wenn ihr Feld `issuer` (trailing slash normalisiert) **string-gleich** `config.auth.oauthIssuerUrl` ist und `jwks_uri` dieselbe Origin wie der Issuer hat; beide Discovery-Fetches haben eine Frist. Sonst: kein JWKS, jeder `/mcp`-Request 401.
2. `GET /.well-known/oauth-protected-resource[/mcp]` liefert **niemals** ein Dokument mit leerem `authorization_servers`: ohne Issuer 404. Mit Issuer enthaelt es `resource`, `authorization_servers` (>=1), `bearer_methods_supported`, `resource_name`.
3. In Produktion ist `OAUTH_AUDIENCE` entweder leer oder exakt `${PUBLIC_URL}/mcp`; jeder andere Wert verweigert den Boot. Damit gilt: `PRM.resource` == erwartete Token-Audience == der bei WorkOS eingetragene Resource Indicator == die kanonische MCP-URL (A-11).
4. Die AS-Faehigkeiten T-7/T-8/T-9/T-10/T-11 sind fuer den LIVE-Issuer mit einem wiederholbaren Kommando belegt, das Ergebnis liegt als Schnappschuss in `docs/`.

## Aenderungen

### A1 — `src/auth.js:30-48` `discoverJwksUri` haerten
Im Schleifenkoerper nach `await r.json()`:
- `issuer`-Feld lesen, beidseitig trailing slash abschneiden, gegen `config.auth.oauthIssuerUrl` **strikt** vergleichen (`!==` -> `lastErr` setzen, `continue`). Grund: A-06 ist die einzige Zusage, die eine untergeschobene Metadata-Antwort entdeckt; ein String-Vergleich ohne Normalisierung (ausser dem slash, den `src/config.js:2029` ohnehin auf unserer Seite schneidet) ist genau das, was RFC 9207/A-06 verlangen — keine URL-Normalisierung, kein Host-Fuzzy.
- `new URL(jwks_uri).origin !== new URL(config.auth.oauthIssuerUrl).origin` -> ablehnen. Grund: `jwks_uri` bestimmt, welcher oeffentliche Schluessel Tokens legitimiert. Ein Dokument, das dorthin auf einen Fremdhost zeigt, ist ein Schluessel-Substitutions-Pfad; die Origin-Bindung kostet eine Zeile.
- `fetch(..., { signal: AbortSignal.timeout(OAUTH_METADATA_TIMEOUT_MS) })` mit `const OAUTH_METADATA_TIMEOUT_MS = 3000` als benannte Konstante im Modul (keine Magic Number). Grund: ohne Frist haengt der erste `/mcp`-Request am nicht antwortenden IdP, bis der Client aufgibt — ein haengender Auth-Pfad ist schlechter als ein 401.
Keine neue Env-Variable: die Frist ist eine Konstante, kein Betriebsschalter.

### A2 — `src/auth.js:121-129` PRM fail-closed + `resource_name`
- Am Anfang beider Handler: `if (!config.auth.oauthIssuerUrl) return res.status(404).json({ error: "not_found" })`. Grund A-03: ein Dokument mit `authorization_servers: []` ist schlechter als keines — es behauptet OAuth und nennt keinen Server, der Client hat danach keinen Weg mehr. Kein Registrierungs-Gate (`if` um `app.get`), weil der Routenbestand sonst flag-abhaengig wird und damit aus `test/route-auth-inventory.test.js` verschwindet (Blindfleck 3, `docs/RUNBOOK-AUTH-REVIEW.md`).
- `resource_name: "Hermes"` ergaenzen (RFC 9728 optional, Anzeigename im Consent-Dialog). Konstante im Modul, nicht aus `HERMES_SERVER_INFO` importiert — `src/auth.js` haengt heute an keinem MCP-Modul, und eine Abhaengigkeit fuer einen String ist nicht zu bezahlen.
- **Nicht** hier: `scopes_supported` (A-15) — gehoert zum Scope-Schnitt, der die Werte erst definiert. Bis dahin ist das Feld absichtlich abwesend; A-18 ("`offline_access` nicht in `scopes_supported` fuehren") ist damit trivial erfuellt.

### A3 — `src/config.js` Produktions-Footgun "kanonische Resource-URI"
Neuer Eintrag in `PRODUCTION_FOOTGUNS` (`src/config.js:2375-2422`), Muster `isInsecureHttpIssuer`:
```
trifftZu: (cfg) => !!cfg.auth.oauthAudience && cfg.auth.oauthAudience !== `${cfg.server.publicUrl}/mcp`
befund: "OAUTH_AUDIENCE weicht von der kanonischen MCP-URL ab ..."
```
Die Praedikat-Reihenfolge ist bindend: der `!!`-Teil steht vorn, damit der Ausdruck bei
leerem Wert kurzschliesst und `cfg.server` nicht liest (die Bestands-Fixture `SAFE_PROD`,
`test/config-prod-footguns.test.js:19-23`, hat keinen `server`-Namespace).
Warum ein Footgun und nicht `REQUIRED_CONFIG`: der Wert ist gueltig-abwesend (Default =
kanonisch). Warum nicht nur eine Warnung: die Abweichung ist genau der Zustand, in dem
`/mcp` Tokens einer fremden Resource annimmt (PP-D6-07) **und** `PRM.resource` etwas
anderes behauptet als der Pfad, unter dem es liegt. Warum Produktion-only: der
Override-Pfad ist lokal getestet (`test/oauth.test.js:88-121`) und bleibt dort gueltig.
Begleitend: `.env.example:984-986` und `render.yaml` (Kommentar am Issuer-Block, `:359-361`)
tragen den Satz nach, dass `OAUTH_AUDIENCE` in Produktion leer bleibt und der Resource
Indicator stattdessen bei WorkOS eingetragen wird (Konvention: Env-Doku).

### A4 — `scripts/probe-as-faehigkeiten.mjs` (neu, ~80 Zeilen)
Ein Argument: die oeffentliche Basis-URL des Gateways. Drei Schritte, Exit 0 nur wenn alle
Pflichtzeilen PASS sind (Muster `scripts/probe-auth.sh`: Erwartung steht im Skript, Ziel als
Pflichtargument):
1. `GET <base>/.well-known/oauth-protected-resource` -> gibt `resource` und
   `authorization_servers[0]` aus. Damit sind F1 (Live-Issuer) und F2 (Live-Audience)
   **von aussen** feststellbar, ohne Render-Dashboard und ohne Secret.
2. `POST <base>/mcp` ohne Token -> 401 **mit** `WWW-Authenticate` heisst `MCP_AUTH=oauth`
   (F3); 401 ohne Challenge heisst Legacy/Token-Modus. Kein Koerper wird ausgewertet.
3. `GET <issuer>/.well-known/oauth-authorization-server` und
   `/.well-known/openid-configuration` -> je Feld eine Zeile: `issuer`-Gleichheit (A-06,
   und damit die Vorbedingung von A1), `code_challenge_methods_supported` enthaelt `S256`
   (T-8, PASS/FAIL), `registration_endpoint` vorhanden (T-10/DCR),
   `client_id_metadata_document_supported === true` (T-10/CIMD),
   `token_endpoint_auth_methods_supported` enthaelt `none` (T-10),
   `authorization_response_iss_parameter_supported === true` (T-11; fehlt das Feld ->
   Ausgabe `UNKNOWN`, nicht FAIL — das Feld ist SHOULD, s. (c)), `userinfo_endpoint`
   vorhanden (T-16), `scopes_supported` wird nur ausgegeben.
Sicherheitszusagen im Kopfkommentar: kein Token, kein Cookie, kein Secret als Argument oder
in der Ausgabe; alle drei Dokumente sind oeffentliche Metadata (Regel 4 beruehrt nichts,
eine Issuer-URL ist kein Credential). Kein `package.json`-Script noetig (`node scripts/...`),
damit kein neuer Eintrag in die Befehlsliste driftet.

### F1-F5 — Feststellungsaufgaben (kein Code, Ergebnis ist ein Dokument)
| ID | Feststellung | Wie |
|---|---|---|
| F1 | Live-Wert `OAUTH_ISSUER_URL` | A4 Schritt 1 (`authorization_servers[0]`) |
| F2 | Live-Wert `OAUTH_AUDIENCE` | A4 Schritt 1 (`resource`) — **vor** dem Deploy von A3 |
| F3 | Live-Auth-Modus von `/mcp` | A4 Schritt 2 |
| F4 | AS-Faehigkeiten T-8/T-10/T-11/T-16 am Live-Issuer, Ist-Stand VOR B1-B3 | A4 Schritt 3 |
| F5 | dieselbe Messung NACH B1-B3 | A4 Schritt 3, zweiter Lauf |
Ablage: **eine** neue Datei `docs/RUNBOOK-AS-METADATA.md` — Kommando, Datum, Rohausgabe von
F4 und F5, plus die Entscheidung zur Redirect-URI (stabil vs. callback-spezifisch), die aus
dem `iss`-Feld folgt. Sie ist ausserdem die Quelle, die `PLAN-SECURITY.md` bisher fehlt
(dort nur die Messnotiz `:2052-2056`).

## Erwartungsergebnis und Verifikation

| Aenderung | deterministisches Erwartungsergebnis | Verifikationsbefehl/Testdatei |
|---|---|---|
| A1 Issuer-Gleichheit | Mini-IdP liefert Metadata mit `issuer: "https://fremd.example"`, Token korrekt signiert und mit passender `aud`/`iss` -> `POST /mcp` = **401** (ohne die Aenderung: 200) | neuer Test in `test/oauth.test.js`; `test/helpers.js#startIdp` bekommt die Option `issuerInDoc` (Default = echter Issuer, alle Bestandsaufrufe unveraendert) |
| A1 jwks_uri-Origin | Mini-IdP-Metadata mit `jwks_uri` auf einem ZWEITEN lokalen Port (andere Origin), sonst alles gueltig -> `POST /mcp` = **401** | dito, `startIdp`-Option `jwksUri` |
| A1 Frist | IdP antwortet auf den Metadata-Pfad nie -> `POST /mcp` = **401** in < `OAUTH_METADATA_TIMEOUT_MS + 2000` ms (statt Haengen) | dito, `startIdp`-Option `hangMetadata: true`; Testdauer ~3 s, bewusst in Kauf genommen |
| A2 404 ohne Issuer | `MCP_AUTH=""`, `OAUTH_ISSUER_URL=""` -> `GET /.well-known/oauth-protected-resource` = **404**; beide Pfade | neuer Test in `test/oauth.test.js` |
| A2 Felder mit Issuer | `GET /.well-known/oauth-protected-resource` = 200 und der Koerper ist exakt `{resource, authorization_servers:[issuer], bearer_methods_supported:["header"], resource_name:"Hermes"}`; `authorization_servers.length >= 1` | `test/oauth.test.js:28-40` erweitern (Bestand prueft schon `resource` und `authorization_servers`) |
| A2 Route bleibt oeffentlich | `test/route-auth-inventory.test.js` bleibt gruen (beide Pfade weiterhin registriert und in `src/route-policy.js`) | `node --test test/route-auth-inventory.test.js` |
| A3 Footgun | `productionFootguns({...SAFE_PROD, server:{publicUrl:"https://agent.test"}, auth:{...,oauthAudience:"https://fremd.example/mcp"}}, true)` enthaelt genau einen Befund mit `/OAUTH_AUDIENCE/`; mit `oauthAudience:""` und mit `"https://agent.test/mcp"` = `[]` | `test/config-prod-footguns.test.js` (neuer Fall T-P0-5-xx; die Fixture `SAFE_PROD` bekommt dafuer `server: { publicUrl: "https://agent.test" }` und `auth.oauthAudience: ""`) |
| A3 Boot-Refusal | Kindprozess mit `RENDER_EXTERNAL_URL` + `OAUTH_AUDIENCE=https://fremd.example/mcp` beendet sich mit **Exit 1** und nennt `OAUTH_AUDIENCE` in der Ausgabe | `test/boot-prod-footguns.test.js` (Muster `:37-40`) |
| A4 Sonde, Negativkontrolle | `node scripts/probe-as-faehigkeiten.mjs` **ohne** Argument -> Exit != 0, keine Netzanfrage (Lehre "Pruefkommando ohne Positiv-Kontrolle": ein Lauf, der nichts prueft, darf nicht gruen aussehen) | `node scripts/probe-as-faehigkeiten.mjs; echo $?` |
| A4 Sonde, Positivlauf | gegen die Live-URL: jede der acht Zeilen traegt PASS/FAIL/UNKNOWN, `S256` = PASS | `node scripts/probe-as-faehigkeiten.mjs https://<live-host>` (Smoke, kein Test) |
| F4/F5 | `docs/RUNBOOK-AS-METADATA.md` existiert und enthaelt zwei datierte Rohausgaben (vor/nach B1-B3) sowie die Redirect-URI-Entscheidung | Sichtpruefung; `grep -c "^## Messung" docs/RUNBOOK-AS-METADATA.md` >= 2 |
| Gesamtlauf | keine Regression | `npm test -- --test-concurrency=4` (Lehre: volle Parallelitaet macht die Bank rot) |
| Syntax | - | `node --check src/auth.js && node --check src/config.js && node --check scripts/probe-as-faehigkeiten.mjs` |

Nicht umsetzungsreif und als solches markiert: **keiner** der Punkte — B1-B3 sind
Dashboard-Handlungen des Owners und tragen ihre Verifikation in F5.

## Blast Radius
- **`src/auth.js` ist der Auth-Pfad des LIVE laufenden Claude-Connectors** (`MCP_AUTH=oauth` live gemessen, `PLAN-SECURITY.md:2052-2056`). Jede Aenderung an A1 kann `/mcp` fuer alle heutigen Nutzer auf 401 stellen. Genau ein Fall tut das: wenn das Feld `issuer` in der Live-Metadata **nicht** `OAUTH_ISSUER_URL` entspricht. Deshalb ist F4 Vorbedingung (s. Abhaengigkeiten), nicht Beiwerk. Entlastend, aber kein Beweis: der Token-`iss` entspricht dem Config-Wert schon heute (`src/auth.js:82`, sonst waere der Connector tot) — das Metadata-**Feld** ist damit nicht belegt.
- Aufrufer von `discoverJwksUri`: nur `getJwks` (`src/auth.js:53-57`), nur aus `verifyOauth` (`:81`). Keine weitere Stelle (`grep -rn "discoverJwksUri\|getJwks" src/` = diese Datei). `scripts/check-setup.js:141-161` hat eine **zweite, eigene** Kopie derselben Discovery-Schleife — sie wird von A1 NICHT angefasst und driftet dadurch; bewusst akzeptiert (Setup-Check, kein Sicherheitspfad), aber im Spec benannt.
- PRM-Konsumenten: `metadataUrl()` (`src/auth.js:24`) zeigt im 401-Header auf denselben Pfad. Ein 404 auf das Dokument bei gleichzeitigem Verweis darauf kann nur im Modus `""`/`token`/`off` entstehen — dort ruft `deny401` nicht (`src/auth.js:96-116`, drei nackte 401). Keine neue Inkonsistenz; der nackte 401 ist Gegenstand eines anderen Schnitts (P1-10).
- Tests, die sicher anzufassen sind: `test/oauth.test.js`, `test/config-prod-footguns.test.js` (Fixture), `test/boot-prod-footguns.test.js`, `test/helpers.js` (`startIdp`-Optionen). `startIdp` wird ausserdem von `test/profile-tenant-key.test.js:20`, `test/profiles.test.js:267`, `test/auth-p7-gate-removed.test.js:116` benutzt — die neuen Optionen sind additiv mit Default-Werten, sonst brechen diese drei.
- Env/Flags: keine neue Variable. `OAUTH_AUDIENCE` verliert in Produktion seine Freiheit (Doku in `.env.example`, `render.yaml`).
- Live-Konfiguration: B1-B3 aendern das WorkOS-Dashboard der Produktions-Umgebung. B2/B3 sind additiv (CIMD an, DCR bleibt an) und koennen bestehende Clients nicht verlieren. B1 (Resource Indicator) ist der Eintrag, ohne den ChatGPT-Tokens **keine** passende `aud` bekommen — wird er falsch gesetzt (z.B. mit trailing slash oder ohne `/mcp`), antwortet `/mcp` auf jedes ChatGPT-Token mit 401. Das ist der wahrscheinlichste Fehlerzustand nach diesem Schnitt.
- `PLAN-SECURITY.md` wird fortgeschrieben (sicherheitsrelevante Aenderung, Regel "Vor Edits").

### Pre-Mortem (ein Jahr spaeter, die Entscheidung war falsch)
1. **A3 hat die Produktion nicht gebootet.** Live stand ein nicht-kanonischer `OAUTH_AUDIENCE` (der Override existiert genau dafuer, `test/oauth.test.js:88-95` nennt "WorkOS Resource Indicator" als Anlass), der Footgun schlug zu, der Dienst war nach dem Deploy unten. -> Gegenmittel: F2 **vor** dem Merge, per A4 von aussen messbar. Ist der Live-Wert nicht kanonisch, ist A3 nicht zu deployen, sondern vorher B1 zu setzen; und wenn WorkOS die kanonische URL nicht als Resource Indicator annimmt, ist A3 eine Owner-Entscheidung (Footgun -> Warnung).
2. **A1 hat den Claude-Connector abgeschaltet.** Die Live-Metadata trug `issuer` mit trailing slash oder einen anderen Host als `OAUTH_ISSUER_URL`; der strikte Vergleich verwarf sie, JWKS fehlte, alle Tokens 401. -> Gegenmittel: F4 zuerst, beidseitige slash-Normalisierung, und der Fehlerweg bleibt derselbe 401-Pfad (kein Crash, Audit-Zeile mit Grund).
3. **CIMD/DCR waren an, und ChatGPT kam trotzdem nicht durch**, weil die Registrierung an etwas anderem hing (Scopes, Consent, Redirect-URI). -> Gegenmittel: F5 ist eine Messung des AS, kein Nachweis eines erfolgreichen ChatGPT-Flows. Der Nachweis bleibt der erste echte Verbindungsversuch; dieser Schnitt liefert nur die Vorbedingungen und sagt das ausdruecklich.

## Beruehrte absolute Regeln
- **Regel 3 (AUTH FAIL-CLOSED)**: dieser Schnitt liegt vollstaendig darin. Alle drei Code-Aenderungen **verengen**: A1 lehnt Metadata ab, die heute akzeptiert wird; A2 liefert 404 statt eines unbrauchbaren Dokuments; A3 verweigert einen Boot, der heute durchgeht. Es kommen strikt weniger Requests durch. Keine Aufweichung, kein neuer Bypass, kein neuer oeffentlicher Endpunkt (die zwei bestehenden bleiben in `src/route-policy.js` eingetragen).
- **Regel 4 (SECRETS)**: A4 gibt Issuer-URL, `resource` und Metadata-Felder aus — alles oeffentliche Dokumente. Das Skript nimmt **kein** Token und kein Cookie, weder als Argument noch aus der Umgebung, und gibt keinen Antwortkoerper von `/mcp` aus. `docs/RUNBOOK-AS-METADATA.md` enthaelt keine Secrets (die Issuer-URL ist `sync: false`, aber kein Credential — falls der Owner das anders sieht, ist der Schnappschuss ohne Host zu fuehren; das waere eine Owner-Entscheidung, keine Bauaufgabe).
- **Regel 6 (SCOPE)**: ausdruecklich NICHT in diesem Schnitt: Scopes/`securitySchemes` (P1-4/P1-13), `deny401` fuer alle 401 (P1-10), 403/`insufficient_scope` (P1-11/P1-12), `algorithms`-Allowlist und `requiredClaims` (P1-16), `MCP_AUTH`-Enum-Validierung (P1-15), Tenant-Status-Pruefung/Widerruf (P1-14), `MCP_AUTH=oauth`-Erzwingung in Produktion (P1-16/D6-16).
- Safety-Gates (Regel 1) und Offenlegung (Regel 2): nicht beruehrt — kein Pfad dieses Schnitts fuehrt zu Calls, SMS oder Prompt-Text.

## Abhaengigkeiten
1. **F4 vor A1.** Der strikte Issuer-Vergleich darf erst gebaut werden, wenn die Live-Metadata gemessen ist; sonst ist der Merge ein Blindflug auf den laufenden Connector. F4 braucht keinen Code aus diesem Schnitt ausser A4 — Reihenfolge deshalb: A4 -> F1-F4 -> A1/A2 -> B1-B3 -> F5 -> A3.
2. **F2 vor A3** (Boot-Refusal, s. Pre-Mortem 1).
3. **Host-/Origin-Entscheidung (P0-10, P0-11) vor B1 und vor A3.** Die kanonische MCP-URL ist die Grundlage von Resource Indicator, `PRM.resource` und Token-`aud`. Wechselt der Origin spaeter von `*.onrender.com` auf `app.sundartha.com`, sind B1, `PUBLIC_URL` und jedes ausgestellte Token betroffen. Ein Eintrag bei WorkOS auf den falschen Host ist teurer als das Warten auf die Entscheidung.
4. **Scope-Schnitt nach diesem.** `scopes_supported` im PRM (A-15) und `securitySchemes` je Werkzeug (T-15) setzen voraus, dass feststeht, ob AuthKit eigene Scopes ausstellen kann — das liefert F4 als Tatsache (heutige Doku: nur `email/offline_access/openid/profile`).
5. **Owner-Entscheidung, falls F4 `authorization_response_iss_parameter_supported` nicht liefert:** callback-spezifische Redirect-URI akzeptieren (Weg ohne Code) — das ist die erwartete Antwort, nur formell zu bestaetigen.
6. **Owner-Entscheidung, falls F2 einen nicht-kanonischen Live-`OAUTH_AUDIENCE` zeigt und WorkOS die kanonische URL nicht annimmt:** A3 als Warnung statt Boot-Refusal. Nur dann.

## Offene Fragen
- Welchen Host traegt die Live-`OAUTH_ISSUER_URL`: eine AuthKit-Domain (`https://<projekt>.authkit.app`, so das dokumentierte Format) oder ein `api.workos.com`-Pfad? Davon haengt ab, ob `issuer`-Feld und Config heute schon string-gleich sind (A1).
- Ist die WorkOS-Umgebung des `/mcp`-Kanals dieselbe wie die des Browser-Logins? `src/config.js:2042-2043` behauptet eine geteilte `client_id`, das ist ein Kommentar, kein Code-Zwang. Falls ja: tragen die Tokens des Browser-Logins die MCP-Audience? Nach B1 duerfen sie es nicht (A-12) — mit A3 messbar, mit dem heutigen freien `OAUTH_AUDIENCE` nicht.
- Braucht der PRM-Endpunkt CORS-Header (`Access-Control-Allow-Origin`), falls ein Client ihn aus dem Browser liest? Weder MCP-Spec noch OpenAI-Doku sagen dazu etwas; heute wird kein Header gesetzt. UNKNOWN, nicht geplant.
- Gilt die Kappung "ein Resource Indicator pro WorkOS-Umgebung" oder sind mehrere zulaessig (Staging + Produktion am selben Mandanten)? Nicht dokumentiert; entscheidet, ob Staging einen eigenen WorkOS-Mandanten braucht.

## Pre-Mortem

Gegenstand: die drei Zeilen unter "### Pre-Mortem" im Blast Radius (`:181-184`) sind
gepruefte, aber unvollstaendige Vorarbeit. Zwei von ihnen benennen den falschen Schaden
bzw. das unzureichende Gegenmittel (PM-1, PM-2), einen Pfad enthaelt der Schnitt selbst in
seiner Reihenfolge (PM-3). Alle Belege unten am Code gelesen, nicht aus dem Spec uebernommen.

### PM-1 — A1 Origin-Bindung schaltet den Live-Connector ab (Kette: A1 -> kein JWKS -> jedes Token 401)
`src/auth.js:41` nimmt `jwks_uri` heute ungeprueft, `:55` baut daraus den Remote-JWKS,
`:81` ruft `getJwks()` VOR jeder Token-Pruefung. A1 verwirft die Metadata, wenn
`new URL(jwks_uri).origin !== new URL(issuer).origin`. Genau diese Konstellation ist bei
WorkOS plausibel (AuthKit-Issuer auf einer Projekt-Domain, JWKS auf der API-Domain) und im
Repo mit **null** Zeilen belegt: `grep -rn jwks src/ scripts/ docs/ *.md .env.example
render.yaml` liefert ausschliesslich `src/auth.js:29,40,41,42,52,54,55,56,61` und
`scripts/check-setup.js:140-162` — Code, kein Live-Wert.
**Bewertung: offen.** Das Spec erklaert F4 zur Vorbedingung von A1 (`:193`), aber die
Messliste in A4 Schritt 3 (`:124-132`) fuehrt `jwks_uri` NICHT — F4 kann die Vorbedingung
also nicht belegen. Die eigene Pre-Mortem-Zeile 2 (`:183`) nennt nur das `issuer`-Feld und
damit die harmlosere Haelfte von A1. Schaden: der live verbundene Connector ist tot,
Ursache am Deploy nicht sichtbar (nur 401 + Audit-Zeile `src/auth.js:89`).

### PM-2 — A3 nimmt die Telefonie mit, nicht nur /mcp (Kette: Footgun trifft zu -> exit(1) -> kein app.listen)
`src/boot.js:499-506`: `assertConfig()` false -> `process.exit(1)`, im Kommentar woertlich
"kein app.listen, kein /voice, kein /mcp". `assertConfig` faltet `productionFootguns` in
seine Fatal-Menge (`src/config.js:2592-2607`). Der neue Footgun liest `cfg.server.publicUrl`
(`src/config.js:1494`: `PUBLIC_URL || RENDER_EXTERNAL_URL`) — einen Wert, den das Spec
nirgends misst.
**Bewertung: teilweise gedeckt, Gegenmittel unzureichend.** Pre-Mortem 1 (`:182`) nennt den
Schaden "der Dienst war unten" und laesst offen, dass damit **Inbound-Anrufe** ausfallen,
nicht eine Connector-Bequemlichkeit. Schlimmer: F2 (`:142`) misst `resource` — das ist
`audience()` (`src/auth.js:23`) und damit `OAUTH_AUDIENCE || publicUrl + "/mcp"`. Der
Rueckgabewert ist genau dort mehrdeutig, wo es zaehlt: `resource == X` unterscheidet nicht
zwischen "OAUTH_AUDIENCE leer, publicUrl == X" (Footgun feuert nie, Kurzschluss `:100`) und
"OAUTH_AUDIENCE == X, publicUrl != X" (Footgun feuert, Boot weg). F2 kann die
Footgun-Vorhersage nicht treffen.
Der fehlende zweite Messwert liegt bereits offen: der 401 traegt
`resource_metadata="${config.server.publicUrl}/.well-known/oauth-protected-resource"`
(`src/auth.js:24` + `:69`) — also den Live-`publicUrl`. A4 Schritt 2 (`:122-123`) wirft ihn
weg und prueft nur die Existenz des Headers.

### PM-3 — B1 vor dem Angleichen der Audience (Kette: Resource Indicator gesetzt -> neue Tokens tragen aud=kanonisch -> audience() erwartet den alten Wert -> jedes neue Token 401)
`src/auth.js:83` vergleicht gegen **genau einen** erwarteten Wert; eine Uebergangsphase mit
zwei akzeptierten Audiences existiert nicht. Wenn der Live-`OAUTH_AUDIENCE` heute nicht die
kanonische URL ist (der Override-Pfad ist eigens getestet, `test/oauth.test.js:88-96`, mit
"WorkOS Resource Indicator" als Anlass), dann stellt B1 die ausgestellte `aud` um, waehrend
unsere Erwartung stehen bleibt. Alte Tokens laufen aus, neue scheitern — der Connector
stirbt verzoegert, was die Zuordnung zur Ursache zerstoert.
**Bewertung: offen, und vom Spec erzeugt.** Die Reihenfolge `:193` setzt B1 VOR A3. Vor
allem aber: der eigentliche Betreiberschritt "`OAUTH_AUDIENCE` auf Render leeren/angleichen"
steht in **keiner** Aenderung, keiner Tabelle und keiner Feststellungsaufgabe. A3 verweigert
nur einen Boot; es setzt nichts. Der Schnitt hat damit eine Luecke zwischen B1 und dem
Riegel, der genau den kaputten Zustand beschreibt.

### PM-4 — A1 macht aus einer Ablehnung eine Dauerlast (Kette: Ablehnung -> kein Negativ-Cache -> 2 Fetches je Request -> IdP drosselt -> /mcp UND Browser-Login tot)
`src/auth.js:53-57` cacht **nur den Erfolg** (`jwks` bleibt `null`, wenn `discoverJwksUri()`
wirft), und `:81` ruft `getJwks()` vor der Signaturpruefung — also fuer **jedes** Token,
auch fuer Muell. Nach einer A1-Ablehnung laeuft folglich pro Request die volle Schleife
`src/auth.js:31-46` mit zwei Pfaden; mit der neuen Frist haelt jeder Request bis 2 x 3000 ms.
Ziel ist derselbe Anbieter, den der Browser-Login benutzt (`src/config.js:2044`
`workosApiBase`, `src/web-auth.js:405-406`) — eine Drosselung oder IP-Sperre bei WorkOS
nimmt das Kunden-Dashboard mit.
Zweite Haelfte desselben Pfades: `OAUTH_METADATA_TIMEOUT_MS`-Frist 3000 ms ist kuerzer als ein realer
IdP-Cold-Start. Heute wartet der Request und gewinnt; nach A1 ergibt 3,1 s Antwortzeit 401
fuer alle. Ein Retry ist nicht geplant.
**Bewertung: offen.** Kein Punkt des Specs erwaehnt Negativ-Cache, Backoff oder die
Verdopplung durch die Zwei-Pfad-Schleife. A1 erzeugt einen Ablehnungsgrund, der heute nicht
existiert, und trifft damit auf einen Pfad ohne jede Daempfung.

### PM-5 — B2/B3 weiten aus, wer ein von uns akzeptiertes Token bekommt (Kette: CIMD/DCR an -> fremder Client + Nutzer-Consent -> Token mit passendem iss+aud -> unsere Werkzeuge)
`src/auth.js:81-86` prueft `issuer`, `audience`, `clockTolerance` — und sonst nichts:
`grep -n "azp\|client_id" src/auth.js` = 0 Treffer. Nach B1 ist die `aud` die kanonische
MCP-URL, also fuer **jeden** Client derselbe Wert; nach B2/B3 kann sich ein beliebiger
Dritter an derselben WorkOS-Umgebung registrieren. Ein Token, das unser Resource Server
akzeptiert, beweist danach nur noch "ein Nutzer dieser WorkOS-Umgebung hat irgendwem
zugestimmt", nicht mehr "das ist der Claude-Connector". Schadensrichtung: Tenant-Anlage je
neuem `sub` (dokumentierte Vermehrungs-Kette) und Zugriff auf Transkripte/Inbox im Namen des
Nutzers. Der Anruf-/Kostenschaden bleibt gedeckt, aber nur weil Regel 1 unabhaengig davon
greift (Outbound = Abo+KYC) — nicht durch etwas in diesem Schnitt.
**Bewertung: offen und nicht benannt.** Das Spec fuehrt B1-B3 als "kein Code" (`:29-36`) und
stellt die Frage "welche Clients darf dieser Resource Server akzeptieren" nicht. Die Frage,
ob die `/mcp`-WorkOS-Umgebung dieselbe ist wie die des Browser-Logins, steht unter Offene
Fragen (`:202`) — waehrend B2/B3 schon auf genau dieser Umgebung geplant sind. Das ist eine
Reihenfolge-Umkehrung: die Frage gehoert vor die Dashboard-Handlung.

### PM-6 — A2 404 im Rollback-Fall (Kette: Ruecksprung MCP_AUTH -> Issuer leer -> PRM 404 -> Client findet keinen AS)
`render.yaml:353-354` traegt weiterhin `MCP_AUTH` mit `value: ""`, live gemessen ist `oauth`
(`PLAN-SECURITY.md:2051-2056`, dort ausdruecklich als "Restrisiko ohne Boot-Sonde"
notiert). Ein Blueprint-Sync oder ein Rollback auf diese Werte laesst
`config.auth.oauthIssuerUrl` leer werden -> A2 liefert 404 statt eines Dokuments.
**Bewertung: gewollt und strikt fail-closed (A-03), Folge aber nicht im Spec.** Der 404 ist
die richtige Antwort; neu ist, dass der Rollback-Zustand danach ein anderes Symptom zeigt
("not found" statt eines unbrauchbaren Dokuments). Kein Schaden, aber eine Diagnose-Aenderung,
die in `docs/RUNBOOK-AS-METADATA.md` gehoert.

### Unbelegte Annahmen ueber den Live-Zustand
- **U1 `PUBLIC_URL` (bzw. `RENDER_EXTERNAL_URL`) live** — UNKNOWN, und Vorbedingung des
  A3-Praedikats (s. PM-2). `PLAN-SECURITY.md:2052` nennt `https://app.sundartha.com/mcp` als
  gemessenen 401-Host; das ist der Request-Host, nicht der Env-Wert.
- **U2 `OAUTH_AUDIENCE` existiert in `render.yaml` gar nicht** — `grep -n OAUTH_AUDIENCE
  render.yaml` = 0 Treffer (nur `OAUTH_ISSUER_URL` auf `:360-361`). Spec `:111` will
  "render.yaml (Kommentar am Issuer-Block, `:359-361`)" nachtragen; das ist zutreffend als
  *Kommentar*, aber wer daraus einen `- key: OAUTH_AUDIENCE` mit `value: ""` macht, legt eine
  Waffe: der Dienst `vodafone-agent` ist dashboard-verwaltet (Blueprint traegt `MCP_AUTH: ""`,
  live steht `oauth`) — ein spaeterer Blueprint-Sync wuerde einen im Blueprint mit `value`
  definierten Key auf den Blueprint-Wert ziehen. Nur als Kommentar eintragen, nie als Key.
- **U3 Origin des Live-`jwks_uri`** — UNKNOWN (s. PM-1).
- **U4 Identitaet der WorkOS-Umgebung fuer `/mcp` und Browser-Login** — `src/config.js:2042-2043`
  behauptet eine geteilte `client_id`; das ist ein Kommentar, kein Code-Zwang. Vorbedingung
  fuer B2/B3 (s. PM-5), nicht nur Offene Frage.
- Was das Spec richtig hat: dass der Live-Auth-Modus nicht aus `render.yaml` folgt (`:75`).
  Es zieht daraus aber nur den Schluss "UNKNOWN", nicht den zweiten: derselbe Grund gilt fuer
  `PUBLIC_URL` und `OAUTH_AUDIENCE`, und der Blueprint ist fuer diese Keys kein Zielort.

### Beruehrte absolute Regeln — Nachtrag zur Selbsteinschaetzung (`:186-190`)
- **Regel 3, Code-Seite: bestaetigt.** A1/A2/A3 verengen ausschliesslich; `src/auth.js:127-128`
  bleiben registriert, `src/route-policy.js:86-95` und der gepinnte Fingerprint
  (`test/route-auth-inventory.test.js:176-178`) unveraendert. Es kommen strikt weniger
  Requests durch.
- **Regel 3, Anbieter-Seite: NICHT bestaetigt.** B2/B3 weiten die Menge der Akteure, die ein
  von uns akzeptiertes Token erlangen koennen (PM-5). Das Spec ordnet sie nicht ein, weil sie
  "kein Code" sind — Regel 3 fragt aber nicht, wer den Schalter umlegt. Einzutragen als
  bewusst akzeptiertes Risiko **oder** Owner-Entscheidung; eine Client-Bindung (`azp`) ist
  Gegenstand eines eigenen Schnitts, nicht dieses.
- **Regel 1: nicht beruehrt, bestaetigt** (kein Pfad dieses Schnitts fuehrt zu Call/SMS/Prompt).
  Einschraenkung: dass PM-5 kein Kostenschaden wird, liegt allein an Abo+KYC ausserhalb dieses
  Schnitts — nicht an einer Zusage in ihm.
- **Regel 4: bestaetigt.** A4 gibt nur oeffentliche Metadata aus; Praezedenz existiert
  (`scripts/check-setup.js:161` gibt `jwks_uri` heute schon aus).

### Verifikations-Luecken
- **V1, falsche Zusage.** A1-Frist-Test (`:157`) verspricht 401 in
  `< OAUTH_METADATA_TIMEOUT_MS + 2000` ms. Die Discovery probiert zwei Pfade **seriell**
  (`src/auth.js:31-33`); haengt der IdP auf beiden, ist die untere Grenze 2 x 3000 ms. Der
  Test wird rot oder flakey. Entweder Erwartung auf `2 * TIMEOUT + Puffer` oder `hangMetadata`
  nur auf einem Pfad (dann aber mit dem Beleg, dass der zweite Pfad 404 liefert).
- **V2, nicht falsifizierbar.** F4/F5 werden mit `grep -c "^## Messung" >= 2` verifiziert
  (`:165`) — zwei leere Abschnitte sind gruen. Die Verifikation muss verlangen, dass je
  Messung Datum, Kommando und die Pflichtzeilen im Abschnitt stehen.
- **V3, nicht falsifizierbar.** A4-Negativkontrolle (`:163`) prueft nur "ohne Argument ->
  Exit != 0". Das belegt nicht, dass ein **FAIL** als Exit != 0 durchschlaegt — ein Skript,
  das immer 0 liefert, besteht sie. Zweite Kontrolle: gegen einen Host ohne PRM muss der Lauf
  FAIL melden UND Exit != 0.
- **V4, ungeprueft begruendete Invariante.** Die Kurzschluss-Reihenfolge im A3-Praedikat
  (`:103-105`) ist die Begruendung dafuer, dass Bestands-Fixtures ohne `server`-Namespace
  nicht brechen (`test/config-prod-footguns.test.js:19-23` bestaetigt: kein `server`). Heute
  existiert kein Test, der `auth.oauthAudience` ueberhaupt setzt (`grep -rn oauthAudience
  test/` = 0 Treffer). Die Reihenfolge ist damit nur durch einen Kommentar geschuetzt — es
  braucht einen Fall "oauthAudience gesetzt, `server` fehlt -> kein Wurf".
- **V5, fehlender Verifikationsschritt.** Kein Punkt prueft, dass der Live-`publicUrl` und der
  Live-`resource` uebereinstimmen, bevor A3 deployt wird (PM-2). Das ist der einzige Messwert,
  der A3 von einem Blindflug in eine Entscheidung verwandelt.
- Was tragfaehig ist: der A1-Issuer-Test (`:155`) ist echt falsifizierbar — das Token traegt
  `iss` = lokaler IdP (passend zu `src/auth.js:82`), nur das Metadata-**Feld** luegt; ohne A1
  findet die Discovery `jwks_uri` und der Request kommt durch. Ebenso der A2-404-Test: heute
  liefert derselbe Aufruf 200 mit leerem Array (`src/auth.js:124`).

### Mergefaehigkeit des Schnitts
In **einer** Phase nicht mergefaehig. Der Merge ist hier der Deploy und der Deploy ist der
Boot (`src/boot.js:499-506`) — A3 entscheidet beim Start, ob der Dienst existiert. Saubere
Zerlegung, jede Stufe einzeln mergefaehig:
1. A4 + A2 (rein verengend, kein Live-Wissen noetig, kein Boot-Pfad),
2. F1-F4 inklusive der zwei fehlenden Messwerte (`jwks_uri`-Origin, `publicUrl` aus dem
   `WWW-Authenticate`),
3. A1 — erst wenn U3 belegt ist; bei fremder Origin ist die Origin-Bindung eine
   Owner-Entscheidung, keine Bauaufgabe,
4. `OAUTH_AUDIENCE`-Angleich **und** B1 in EINEM Wartungsfenster (PM-3),
5. A3 als Riegel danach, nie davor.
B2/B3 sind von 1-5 unabhaengig, haengen aber an U4 (PM-5).

### Nachzubessern im Spec
1. A4 Schritt 3 muss `jwks_uri` und den Vergleich seiner Origin mit der Issuer-Origin als
   eigene PASS/FAIL-Zeile fuehren; F4 wird ohne sie nicht zur Vorbedingung von A1 (PM-1).
2. A1 braucht eine ausdrueckliche Weiche: ist der Live-`jwks_uri` cross-origin, ist die
   Origin-Bindung eine Owner-Entscheidung (Alternative: Bindung an eine dokumentierte,
   gemessene Origin) — nicht "kostet eine Zeile".
3. A4 Schritt 2 muss `resource_metadata` aus dem `WWW-Authenticate` parsen (`src/auth.js:24`
   + `:69`) und der Sonde eine Zeile "A3-Vorhersage: Footgun feuert JA/NEIN" abnoetigen.
   Ohne sie ist A3 nicht entscheidbar (PM-2).
4. Pre-Mortem 1 im Blast Radius auf den echten Schaden korrigieren: Boot-Refusal = kein
   `/voice`, also **Inbound-Telefonie aus**, nicht nur Connector.
5. Neue, fehlende Aenderung aufnehmen: "`OAUTH_AUDIENCE` live angleichen" als benannter
   Betreiberschritt mit Erwartungsergebnis (`resource == ${publicUrl}/mcp`) und
   Verifikation (A4 Schritt 1), gebunden an dasselbe Fenster wie B1 (PM-3).
6. Reihenfolge `:193` korrigieren: A3 nach dem Audience-Angleich, nicht nach B1; B1 nie ohne
   den Angleich im selben Fenster.
7. A1 braucht eine Daempfung oder die ausdrueckliche Feststellung, dass keine gebaut wird:
   Negativ-Cache/Backoff fehlen, und `getJwks()` laeuft vor der Signaturpruefung
   (`src/auth.js:81`) — jeder Muell-Token stoesst die Schleife an (PM-4). Mindestens: die
   Frist einmal statt je Pfad, plus ein Satz zum Cold-Start-Risiko bei 3000 ms.
8. V1: Erwartungsergebnis des Frist-Tests auf die serielle Zwei-Pfad-Schleife rechnen.
9. V3/V2: zweite A4-Negativkontrolle (FAIL -> Exit != 0) und eine inhaltliche Verifikation
   fuer `docs/RUNBOOK-AS-METADATA.md` statt `grep -c "^## Messung"`.
10. V4: Testfall fuer die Kurzschluss-Reihenfolge des A3-Praedikats (oauthAudience gesetzt,
    `server`-Namespace fehlt).
11. B2/B3 unter "Beruehrte absolute Regeln" (Regel 3) eintragen, mit dem fehlenden
    Client-Bezug (`azp`/`client_id` werden nirgends geprueft) als benanntes, akzeptiertes
    Risiko oder Owner-Entscheidung; U4 wird von einer Offenen Frage zur Vorbedingung von
    B2/B3 (PM-5).
12. `render.yaml`: `OAUTH_AUDIENCE` nur als Kommentar nachtragen, ausdruecklich NICHT als
    `- key:` mit `value` — der Dienst ist dashboard-verwaltet, ein Blueprint-Key mit leerem
    Wert ist ein latenter Ueberschreiber (U2).
13. "Mergefaehigkeit": die fuenf Stufen aus diesem Abschnitt als verbindliche Merge-Reihenfolge
    ins Spec aufnehmen; A3 gehoert in einen eigenen Commit.

## Pre-Mortem (zweiter Durchgang, additiv)

Der Abschnitt `:206-409` existierte bereits und wurde nachgeprueft, nicht ersetzt. Ergebnis der
Nachpruefung am Code: PM-1 bis PM-6, U1-U4 und V1-V5 halten (Belege stichprobenartig gegengelesen:
`src/auth.js:41/53-55/81-83/124`, `src/boot.js:498-506`, `src/config.js:2592-2607`,
`test/config-prod-footguns.test.js:18-22` ohne `server`-Namespace, `grep -rn oauthAudience test/`
= 0 Treffer camelCase, `grep -n OAUTH_AUDIENCE render.yaml` = 0 Treffer). **Falsifiziert** wurde
eine hier zuerst vermutete Kette: `cfg.server.publicUrl` ist `stripTrailingSlash`-normalisiert
(`src/config.js:1494`), ein doppelter Schraegstrich in `${publicUrl}/mcp` entsteht also nicht.
Drei Schadenspfade fehlen jedoch.

### PM-7 — A2 ist am falschen Merkmal fail-closed (Kette: Rollback MCP_AUTH, Issuer bleibt -> PRM behauptet OAuth, /mcp prueft statisches Token -> Connector tot, Diagnose zeigt in die falsche Richtung)
A2 haengt die Existenz des Dokuments an `config.auth.oauthIssuerUrl` (`src/auth.js:124`), nicht am
tatsaechlichen Modus von `/mcp` (`src/auth.js:92-94`). Der gefaehrliche Zustand ist nicht "Issuer
leer" (den deckt A2), sondern "Issuer gesetzt, Modus nicht oauth": `render.yaml:353-354` traegt
`MCP_AUTH` mit `value: ""`, live steht `oauth`; `OAUTH_ISSUER_URL` ist `sync: false`
(`render.yaml:360-361`) und ueberlebt einen Blueprint-Sync also, waehrend `MCP_AUTH` auf `""`
gezogen wird. Danach liefert das PRM weiter 200 mit `authorization_servers:[issuer]`, `/mcp`
validiert aber `MCP_AUTH_TOKEN` (`render.yaml:357-358`, `generateValue: true`) und antwortet
401 **ohne** `WWW-Authenticate` (`src/auth.js:99-102`). Kein Gate faengt das: `PRODUCTION_FOOTGUNS`
prueft nur `mcpAuth === "off"` (`src/config.js:2396`), `REQUIRED_CONFIG` nur die Rueckrichtung
(`src/config.js:2472`, oauth ⇒ Issuer). `PLAN-SECURITY.md:2051-2056` nennt genau diesen Ruecksprung
als Restrisiko und ausdruecklich "Keine Boot-Sonde dafuer vorhanden".
**Bewertung: offen.** A2 verengt einen Fall, der live nicht eintritt (oauth ohne Issuer ist
boot-fatal, `src/config.js:2472`), und laesst den Fall offen, der live eintreten kann. PM-6
(`:290-298`) betrachtet dieselbe Rollback-Quelle, nimmt aber an, dass der Issuer mit verschwindet.

### PM-8 — A3 vergleicht ungleich normalisierte Werte und nennt den Grund nicht (Kette: Live-`OAUTH_AUDIENCE` mit Schraegstrich -> Footgun trifft zu -> exit(1) -> kein /voice, Inbound-Telefonie aus, Ursache aus dem Log nicht ableitbar)
`cfg.server.publicUrl` ist normalisiert (`src/config.js:1494`), `cfg.auth.oauthAudience` ist der
**rohe** Env-Wert (`src/config.js:2031`). Das A3-Praedikat (`:100`) vergleicht strikt mit `!==`.
Ein live gesetzter Wert `https://app.sundartha.com/mcp/` ist semantisch die kanonische URL, trifft
das Praedikat aber -> `productionFootguns` -> `fatalConfigFindings` -> `assertConfig` false
(`src/config.js:2592-2607`) -> `process.exit(1)` in `assertBootGates` (`src/boot.js:498-506`, im
Kommentar woertlich "kein app.listen, kein /voice, kein /mcp"). Der zweite Teil ist der
Diagnose-Killer: die Footgun-Konvention gibt bewusst **nur Var-Namen, nie Werte** aus
(`src/config.js:2381-2382`) — der Betreiber sieht "OAUTH_AUDIENCE weicht ab", nicht *worin*.
Das Spec begruendet fuer A1 ausdruecklich die beidseitige Schraegstrich-Normalisierung (`:87`),
fuer A3 (`:100`) fehlt jede Aussage dazu.
**Bewertung: offen.** PM-2 (`:227-244`) kennt die Boot-Folge, benennt als Ausloeser aber nur den
`publicUrl`-Unterschied. Der Normalisierungs-Bruch ist ein zweiter, unabhaengiger Ausloeser — und
der wahrscheinlichere, weil er bei einem *richtig gemeinten* Wert zuschlaegt.

### PM-9 — Die Sonde hat keinen definierten 404-Fall, den A2 gerade erschafft (Kette: Stufe 1 merged A2+A4 -> PRM kann 404 -> Sonde wertet 404 nicht aus -> F1/F2 unbeantwortet -> A3 wird blind deployt)
A4 Schritt 1 (`:119-121`) liest `resource` und `authorization_servers[0]` und setzt dabei 200
voraus — heute korrekt, weil `src/auth.js:127-128` unkonditional antworten. Nach A2 ist 404 ein
gueltiger Live-Befund, und die Merge-Reihenfolge des Specs legt A4 und A2 in **dieselbe** Stufe
(`:366`). Ein 404 ist danach doppeldeutig (Issuer leer vs. Route weg vs. falscher Host) und
ausgerechnet der Messwert F2, der A3 entscheidbar macht (`:142`), ist in genau diesem Fall von
aussen nicht mehr lesbar.
**Bewertung: offen, vom Schnitt selbst erzeugt** — dieselbe Klasse wie PM-3: die Verengung
trifft das Messinstrument, das die Verengung rechtfertigen soll. Nebenbefund ohne Schaden: Schritt 2
schreibt je Lauf eine `auth_failed`-Zeile auf den Forensik-Kanal (`src/auth.js:77`); eine
Alarmkette daran existiert nicht (`grep -rn auth_failed src/` = nur Schreiber), also nur Rauschen.

### Nachzubessern im Spec (Fortsetzung der Liste `:375-409`)
14. A2-Bedingung am Modus statt am Issuer fuehren: Dokument nur, wenn `config.auth.mcpAuth ===
    "oauth"` (und dann ist der Issuer per `src/config.js:2472` ohnehin da). Erwartungsergebnis:
    `MCP_AUTH=token` + gesetzter `OAUTH_ISSUER_URL` -> beide PRM-Pfade **404**; `MCP_AUTH=oauth`
    -> 200. Verifikation: neuer Fall in `test/oauth.test.js` (Spawn mit genau dieser Env-Kombination).
    Ohne 14 verengt A2 einen Zustand, der live unerreichbar ist (PM-7).
15. A3: entweder beide Seiten des Vergleichs gleich normalisieren (`stripTrailingSlash` auf
    `oauthAudience` in `src/config.js:2031`, damit Config-Wert und Praedikat nicht auseinanderlaufen)
    oder ausdruecklich festhalten, dass ein Schraegstrich Boot-Refusal bedeutet. Erwartungsergebnis:
    `oauthAudience: "https://agent.test/mcp/"` mit `publicUrl: "https://agent.test"` ergibt
    `productionFootguns(...) === []`. Verifikation: Fall in `test/config-prod-footguns.test.js`
    neben dem Fall aus `:161`. Zusaetzlich: der Befundtext muss den Betreiber auf den erwarteten
    Wert zeigen, ohne einen Wert auszugeben — zulaessig ist die Formel "erwartet:
    ${PUBLIC_URL}/mcp" als Wortlaut, nicht der Ist-Wert (`src/config.js:2381-2382`) (PM-8).
16. A4 Schritt 1: 404 als eigene, benannte Ausgabezeile ("PRM fehlt -> F1/F2 nicht feststellbar,
    A3 NICHT deployen") und Exit != 0. Erwartungsergebnis: `node scripts/probe-as-faehigkeiten.mjs
    <host-ohne-prm>` -> Ausgabe enthaelt FAIL, `echo $?` != 0. Das deckt zugleich V3 (`:344-347`)
    (PM-9).
17. Merge-Reihenfolge (`:362-373`) korrigieren: F1/F2 messen, **dann** A2 — A4 allein in Stufe 1,
    A2 erst in Stufe 2. Begruendung im Spec: eine Verengung, die das Messinstrument mit erfasst,
    gehoert hinter die Messung (PM-9, gleiche Klasse wie PM-3).
18. A4 gegen `scripts/check-setup.js:138-186` abgrenzen: Schritt 1 und 2 existieren dort bereits
    (lokal, `mcpAuth === "oauth"`-gated). Entweder begruenden, warum das externe Gegenstueck eine
    dritte Kopie sein muss, oder die gemeinsame Pruefung in eine Stelle ziehen — das Spec benennt
    die Zwei-Kopien-Drift bei A1 selbst (`:174`) und wuerde hier die dritte anlegen.
