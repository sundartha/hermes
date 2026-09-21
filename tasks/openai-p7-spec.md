# P7 — Auth II: Abweichungen belegen (Scope, Metadaten, Fehlerkanal) — Spec

IDs: **T-9**, **T-11**, **T-12**, **T-14**, **T-16**. Basis: master `5bd5aa9`.
Vorgeschlagener Branch: `phase/openai-p7-auth-belege`.
Quellen: `tasks/PLAN-OPENAI-TECHNIK.md` §P7 (:770-841), `tasks/openai-p0-entscheidungen.md`
§2 D0-6 (:139-176), D0-7 (:178-203), §3, §4 O-3, U-9;
`tasks/openai-audit/00-openai-anforderungen.md` Zeilen 42 (T-9), 44 (T-11), 45 (T-12),
47 (T-14), 49 (T-16). `00-mcp-spec.md` ist NICHT massgeblich und wird nicht zitiert.
Alles unten ist am Code bzw. live nachgesehen (2026-09-21), nicht aus Berichten uebernommen.

**Art der Phase: Dokumentation.** Kein Produktionscode. Einzige Codeaenderung: EINE neue
Testdatei, die zwei bisher nur am Code belegte Aussagen (Issuer- und nbf-Pruefung) und eine
ehrliche Luecke (Scope wird nicht ausgewertet) belastbar macht.

Testkommando (einzig gueltig): `npm test -- -- --test-concurrency=4`. Nur `# pass` / `# fail`
zaehlen, nie der Exit-Code. Grundlinie master: **6215 / 6215**. Ein roter Fall zaehlt erst,
wenn er ISOLIERT erneut rot ist (`NODE_ENV=test node --test --test-concurrency=4 test/<datei>`).
Ausgabe nie abschneiden (in eine Datei im Scratchpad umleiten, dann lesen).

**Worktree-Falle:** `tasks/**` ist in diesem Repo zum grossen Teil UNTRACKT (u.a.
`tasks/PLAN-OPENAI-TECHNIK.md`, `tasks/openai-p0-entscheidungen.md`, diese Spec). Ein
Worktree von master enthaelt sie NICHT. Das Beleg-Dokument gehoert deshalb nach `docs/`
(getrackt, ueberlebt ausserdem die Pflicht-Aufraeumung nach dem Merge, die
`tasks/<phase>-report.md` loescht). Plan-Korrekturen in `tasks/` macht der Lead im
Haupt-Checkout, nicht die Phase.

---

## 0. Ist-Zustand (gemessen, 2026-09-21)

### 0.1 Code (datei:zeile, master `5bd5aa9`)

| Stelle | Was dort steht |
|---|---|
| `src/auth.js:23` | `audience()` = `OAUTH_AUDIENCE` oder `${publicUrl}/mcp` |
| `src/auth.js:24` | `metadataUrl()` = `${publicUrl}/.well-known/oauth-protected-resource` |
| `src/auth.js:30-48` | `discoverJwksUri()`: probiert ZUERST `/.well-known/openid-configuration`, dann `/.well-known/oauth-authorization-server`; liest NUR `jwks_uri` |
| `src/auth.js:66-70` | `sendBearer401()` — einziger 401-Sender des Moduls (seit P6) |
| `src/auth.js:74-77` | `deny401()` — oauth-Challenge MIT `resource_metadata` |
| `src/auth.js:89` | `STATIC_BEARER_CHALLENGE` — token/Legacy-Challenge OHNE `resource_metadata` (P6) |
| `src/auth.js:91-113` | `verifyOauth()`: `jwtVerify` mit `issuer`, `audience`, `clockTolerance: 30` (:98-102); `req.auth = {sub, email, claims}` (:107); jeder Fehler -> `deny401` (:109-111) |
| `src/auth.js:116-138` | `mcpAuth()`: oauth -> `verifyOauth`; token/Legacy -> statische Challenge |
| `src/auth.js:142-150` | `registerWellKnown()`: EIN Dokument (`resource`, `authorization_servers`, `bearer_methods_supported`) auf ZWEI Pfaden (:148, :149) |
| `src/routes/mcp.js:113` | `router.post("/mcp", mcpAuth, ...)` — Auth vor JEDEM Tool, einmal pro HTTP-Request |
| `src/routes/mcp.js:59-64` | `rejectIfNoTenant()`: gueltiges Token ohne Tenant -> **403** (ohne `WWW-Authenticate`) |
| `src/routes/mcp.js:161-162` | `applyToolSecuritySchemes(server)` — nur HTTP |
| `src/mcp-security-schemes.js:19-27` | `securitySchemes = [{type:"oauth2", scopes: []}]`, Kommentar: leere Scope-Liste "weil der Anbieter keinen fachlichen Scope-Claim liest oder ausstellt" (E1, D0-7) |
| `src/mcp-server.js:35-46` | stdio: `registerTools()` ohne Auth, bewusst KEIN `applyToolSecuritySchemes` |
| `src/mcp-tools.js:61-80` | `api()`: interner REST-Hop; bei `!res.ok` Fehler mit `err.httpStatus` |
| `src/mcp-tools.js:88` | `errText()` — `{content, isError:true}`, kein `_meta` |
| `src/mcp-tools.js:328` | `notAccepted()` |
| `src/mcp-tools.js:880-895` | `wrapHandler`: jeder Throw -> `errText(err.message ...)` |
| `src/mcp-tools.js:1207-1210` | einzige Leser von `err.httpStatus`: Consult-Status 400/409, kein Auth-Status |
| `src/i18n/mcp-texts.js:20-29` | `MCP_ERROR_CODE`: **5** Codes, keiner auth-bezogen |
| `src/wiring/internal-only.js:24-28` | REST-Hop-Wache: nicht-lokal -> 403 `Forbidden` |
| `src/routes/api-calls.js:692-699` | `consult/answer`: Tenant-REJECT -> 403; Consult nicht freigegeben -> 403 |
| `src/boot-guard.js:928-950` | `kanonischeAudience()` / `audienceFindings()`: divergentes `OAUTH_AUDIENCE` -> fataler Boot-Befund |
| `src/app.js:184-190` | zweite Well-known-Route `/.well-known/openai-apps-challenge` (Domain-Ownership, KEINE OAuth-Metadata), dann `registerWellKnown(app)` |
| `grep -rn "scope\|scp" src/auth.js` | 0 Treffer |
| `grep -rn "req.auth.claims\|payload.scope\|payload.scp" src/` | 0 Treffer |
| `grep -nE "401\|403\|Unauthorized" src/mcp-tools.js` | 1 Treffer, `:160` — Kommentar ueber einen SIP-Code (`invite-403-D51`), kein Auth-Zweig |

### 0.2 Tests, die schon existieren (werden NICHT neu verbucht)

| Test | Belegt |
|---|---|
| `test/oauth.test.js:51-59` | oauth ohne Token -> 401 + `resource_metadata` (T-13, P6/Bestand) |
| `test/oauth.test.js:61-82` | Muell-Token, abgelaufen (`exp`), falsche Audience, fremde Signatur -> 401 |
| `test/oauth.test.js:107-119` | divergentes `OAUTH_AUDIENCE` -> Boot verweigert |
| `test/e4-mandantentrennung-default.test.js:210-220` | E4-17: gueltiges Token ohne Tenant -> 403, keine Tool-Liste |
| `test/openai-p6-challenge.test.js` | P6-T1..T5: Challenge auf allen 401-Pfaden, kein `jsonrpc` bei 401 |
| `test/openai-p3-security-schemes.test.js` | T-15 am echten `tools/list` |

**Nicht getestet (Luecke):** falscher `iss` -> 401; `nbf` in der Zukunft -> 401; dass ein
`scope`-Claim weder verlangt noch ausgewertet wird. Genau diese drei macht Schritt 2 belastbar.

### 0.3 Anbieter und Live-Gateway (lesende GETs, kein Login, kein Token)

Gemessen 2026-09-21T09:56:59Z-09:57:11Z (UTC):

| Kommando | Ergebnis |
|---|---|
| `curl -sS https://fearless-network-26.authkit.app/.well-known/openid-configuration` | HTTP 200. Schluessel: `issuer, authorization_endpoint, device_authorization_endpoint, grant_types_supported, id_token_signing_alg_values_supported, introspection_endpoint, jwks_uri, response_types_supported, scopes_supported=[email,offline_access,openid,profile], subject_types_supported, token_endpoint, token_endpoint_auth_methods_supported, userinfo_endpoint=https://fearless-network-26.authkit.app/oauth2/userinfo`. **Fehlen:** `code_challenge_methods_supported`, `claims_supported`, `authorization_response_iss_parameter_supported`, `resource_indicators_supported`, `registration_endpoint`, `client_id_metadata_document_supported` |
| `curl -sS https://fearless-network-26.authkit.app/.well-known/oauth-authorization-server` | HTTP 200. Schluessel: `authorization_endpoint, client_id_metadata_document_supported=true, code_challenge_methods_supported=[S256], device_authorization_endpoint, grant_types_supported, introspection_endpoint, issuer, jwks_uri, registration_endpoint, scopes_supported=[email,offline_access,openid,profile], response_modes_supported=[query], response_types_supported=[code], token_endpoint, token_endpoint_auth_methods_supported`. **Fehlen:** `userinfo_endpoint`, `claims_supported`, `authorization_response_iss_parameter_supported`, `resource_indicators_supported` |
| `curl -sS -i https://fearless-network-26.authkit.app/oauth2/userinfo` | HTTP 401, Body `{"error":"unauthorized"}` (ohne Token nicht weiter messbar) |
| `curl -sS -i https://app.sundartha.com/.well-known/oauth-protected-resource` | HTTP 200, `{"resource":"https://app.sundartha.com/mcp","authorization_servers":["https://fearless-network-26.authkit.app"],"bearer_methods_supported":["header"]}` |
| `curl -sS -i -X POST https://app.sundartha.com/mcp -H 'content-type: application/json' -d '{}'` | HTTP 401, `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"` = **Produktion laeuft im oauth-Zweig** |
| `node scripts/probe-as-faehigkeiten.mjs https://app.sundartha.com` | Bestehende Sonde (`docs/RUNBOOK-AS-METADATA.md`): PFLICHT 3/4 PASS; `3/8 PKCE S256 (T-8)` **FAIL**, `4/8 DCR` FAIL, `5/8 CIMD` FAIL, `7/8 RFC 9207 (T-11)` UNKNOWN, `8/8 userinfo_endpoint (T-16)` PASS. Achtung: die Sonde wertet nur das ERSTE Dokument (openid-configuration) aus — S256/DCR/CIMD stehen im zweiten. |

---

## 1. Die ehrliche Aussage je ID (Inhalt des Beleg-Dokuments)

Wortlaut-Grundlage ist ausschliesslich `00-openai-anforderungen.md`. Status-Vokabular:
**erfuellt / teilweise / nicht erfuellt / nicht anwendbar / nicht in unserer Hand**, jeweils
mit UNKNOWN-Rest, wo einer bleibt.

| ID | Anforderung (Kern) | Status | Beleg | Rest |
|---|---|---|---|---|
| **T-14** | Auth-UI im Gespraech ueber Fehlerergebnis mit `_meta["mcp/www_authenticate"]` | **nicht anwendbar — bewusst nicht gebaut** | Auth faellt pro HTTP-Request VOR jedem Tool (`src/routes/mcp.js:113`); in `src/mcp-tools.js` existiert kein Auth-Fehlerzweig (0.1); jede Token-Ungueltigkeit waehrend eines Gespraechs (z.B. Ablauf) trifft den naechsten POST als HTTP-401 mit Challenge (`src/auth.js:109-111`, Test `oauth.test.js:66-70`). Die 403-Klasse des internen REST-Hops (`internal-only.js:27`, `api-calls.js:692-699`) kommt zwar als `isError`-Ergebnis an, ist aber durch Re-Auth NICHT loesbar (Profil-/Plan-Recht bzw. interner Bug) — ein Challenge-Feld dort loeste eine Re-Auth-Schleife aus. | **Bedingung:** "Re-Auth wird ueber den Transport-401 ausgeloest" gilt nur, solange Produktion `MCP_AUTH=oauth` faehrt (live gemessen 0.3). Im token/Legacy-Zweig traegt der 401 seit P6 eine Challenge OHNE `resource_metadata` (`src/auth.js:89`) — dann gibt es keinen OAuth-Einstieg. |
| **T-12** | Token-Pruefung: Signatur/JWKS, `iss`, `exp`/`nbf`, Audience, **Scopes**, eigene Policy | **teilweise** | Signatur/JWKS, `iss`, `aud`, `exp`/`nbf` (`src/auth.js:98-102`; Tests `oauth.test.js` + neu Schritt 2); eigene Policy = Tenant-Bindung ueber `sub` (`routes/mcp.js:59-64`, E4-17). **Scope wird NICHT geprueft** (0 Treffer, 0.1) — neu durch Test belegt (Schritt 2). | Scope-Achse **UNKNOWN (Anbieter/Owner O-3)**: WorkOS bewirbt nur `email, offline_access, openid, profile` (0.3), keinen ressourcenspezifischen Scope; ob ein echtes Token `scope`/`scp` traegt, braucht einen Login. Konsistent mit `securitySchemes.scopes = []` (`mcp-security-schemes.js:21-27`). |
| **T-9** | AS uebernimmt `resource` in das Token (i.d.R. `aud`) | **unsere Haelfte erfuellt; Anbieterhaelfte nicht in unserer Hand** | Wir verlangen `aud` == kanonische Resource (`src/auth.js:23`, `:100`), die PRM kuendigt genau diese an (live: `resource = https://app.sundartha.com/mcp`), Divergenz ist Boot-fatal (`boot-guard.js:937-950`, Test `oauth.test.js:107`), falsches `aud` -> 401 (`oauth.test.js:72-76`). | Ob WorkOS `resource` 1:1 nach `aud` kopiert: **UNKNOWN**, nur am echten Token pruefbar (O-3). Folge bei Nein: fail-closed, JEDES ChatGPT-Token scheitert mit 401 — kein Sicherheits-, aber ein Verbindungsproblem. Das im Plan genannte Feld `resource_indicators_supported` steht NICHT im massgeblichen Wortlaut (s. Widersprueche); es fehlt beim Anbieter, ist aber kein Pruefkriterium. |
| **T-11** | Stabile Redirect-URI nur mit RFC-9207-`iss` (`authorization_response_iss_parameter_supported: true`), **sonst** callback-spezifische URI | **nicht in unserer Hand; der Rueckfallzweig der Anforderung greift** | Feld fehlt in BEIDEN Anbieter-Dokumenten (0.3). Hermes ist Resource Server, stellt keine Authorization-Response aus — kein Code von uns ist beteiligt. Der OpenAI-Wortlaut selbst nennt den Rueckfall (`https://chatgpt.com/connector/oauth/{callback_id}`). | Ob WorkOS diese Redirect-URI ueber CIMD/DCR (`client_id_metadata_document_supported: true`, `registration_endpoint`, nur im 2. Dokument) akzeptiert: **UNKNOWN** bis zum ersten echten Connector-Flow (O-5). |
| **T-16** | Fuer Workspace-Domain-Restriktionen: OIDC-Discovery + Scopes `openid`/`email` + UserInfo mit `email` und `email_verified: true` | **teilweise erfuellt, beim Anbieter** | OIDC-Discovery: HTTP 200 (0.3); `openid` und `email` in `scopes_supported`; `userinfo_endpoint` vorhanden, antwortet ohne Token 401. Nur relevant, wenn Workspace-Domain-Restriktionen genutzt werden sollen. | `email_verified: true` im UserInfo: **UNKNOWN (Owner O-3)** — ohne Token nicht messbar. `claims_supported` fehlt, steht aber NICHT im massgeblichen Wortlaut. |

Doppelzaehlung ausgeschlossen: T-13 (Challenge, P6), T-5 (P6) und T-15 (`securitySchemes`, P3)
werden im Dokument nur **referenziert**, nicht als P7-Leistung gefuehrt.

**Nebenbefund (T-8, nicht P7-Vorrat, OW-7):** heute erneut gemessen — `code_challenge_methods_supported`
fehlt in `openid-configuration`, steht in `oauth-authorization-server` (`["S256"]`). Unser
`discoverJwksUri` probiert `openid-configuration` zuerst (`src/auth.js:31`) — fuer uns folgenlos
(wir lesen nur `jwks_uri`), fuer ChatGPTs Discovery-Reihenfolge UNKNOWN. Die Sonde meldet
deshalb T-8 FAIL. Wird im Dokument als offener Owner-Punkt gefuehrt, nicht gebaut.

**Offener Befund B-1 (nicht bauen, nur notieren):** `rejectIfNoTenant` (`src/routes/mcp.js:59-64`)
antwortet einem gueltigen Token ohne Tenant mit 403 OHNE `WWW-Authenticate`. RFC 6750 §3.1 sieht
fuer 403 `error="insufficient_scope"` vor; der massgebliche OpenAI-Wortlaut (T-13) verlangt die
Challenge nur fuer 401. Ob ChatGPT bei 403 einen Konto-Wechsel anbietet, ist UNKNOWN. Kein
Einreichungskriterium → Befund fuer P10/Owner, keine Aenderung.

---

## 2. Arbeitsschritte

### Schritt 1 — Live-Messprotokoll erheben (lesend)

- **Was:** Die fuenf `curl`-Kommandos aus 0.3 plus `node scripts/probe-as-faehigkeiten.mjs
  https://app.sundartha.com` erneut ausfuehren, Rohausgabe mit UTC-Zeitstempel (`date -u`)
  erfassen. Nur GET bzw. der tokenlose POST aus 0.3 (liefert 401, schreibt nichts). Kein
  Login, kein Token, kein Cookie, kein Render-Tool.
- **Wo:** Ergebnis wandert woertlich in Schritt 3 (Abschnitt "Messprotokoll"). Keine eigene Datei.
- **IDs:** T-9, T-11, T-16 (Anbieter), T-14-Bedingung (oauth-Zweig live), T-12 (Scope-Achse).
- **Pfade:** keiner unserer Pfade; nur Anbieter-HTTP und das Live-Gateway lesend.
- **Beweis (c):** Der Pruefer fuehrt dieselben Kommandos aus. Erwartet:
  `curl -sS https://fearless-network-26.authkit.app/.well-known/oauth-authorization-server | python3 -c 'import json,sys;d=json.load(sys.stdin);print([k for k in ["authorization_response_iss_parameter_supported","resource_indicators_supported","claims_supported"] if k in d], d["scopes_supported"])'`
  -> `[] ['email', 'offline_access', 'openid', 'profile']`; dasselbe gegen `openid-configuration`
  -> `[] [...]` und zusaetzlich `"userinfo_endpoint" in d` -> `True`;
  `curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp` -> Zeile
  `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/...`. Weicht eine
  Anbieter-Antwort ab (WorkOS hat nachgeruestet), gilt die NEUE Messung und das Dokument
  aendert den Status — nicht umgekehrt.

### Schritt 2 — EIN neuer Test: `test/openai-p7-token-pruefachsen.test.js`

- **Was:** Neue Datei (einzige Codeaenderung der Phase). Muster wie `test/oauth.test.js:20-35`:
  `startIdp()` + `startServer({ env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer,
  OAUTH_AUDIENCE: MCP_AUDIENCE, OWNER_IDP_SUBJECT: "user-1" } })` — lokal, `PORT=0`,
  Temp-`DATA_DIR` (liefert `startServer` bereits), nie gegen Produktion. Vier Faelle, POST
  `tools/list` via `mcpPost`:
  1. `OpenAI-P7-T1: fremder Issuer -> 401 + oauth-Challenge, kein jsonrpc` —
     `idp.sign({}, { iss: FREMDER_ISSUER })` mit benannter Konstante
     `FREMDER_ISSUER = "https://fremder-issuer.test"`; Assertions: Status 401,
     `www-authenticate` matcht `/^Bearer resource_metadata="/`, Body hat kein `jsonrpc`.
  2. `OpenAI-P7-T2: nbf in der Zukunft (jenseits clockTolerance) -> 401` —
     `idp.sign({ nbf: jetztSek + NBF_VORLAUF_SEK })`, benannte Konstante
     `NBF_VORLAUF_SEK = 3600` (Kommentar: weit jenseits der 30 s `clockTolerance`,
     `src/auth.js:101`). `SignJWT` uebernimmt `nbf` aus dem Payload; `test/helpers.js`
     wird NICHT geaendert.
  3. `OpenAI-P7-T3 (Positiv-Kontrolle): gueltiges Token OHNE scope-Claim -> 200` — belegt,
     dass kein Scope verlangt wird (und dass das Gate nicht einfach alles ablehnt).
  4. `OpenAI-P7-T4: beliebiger scope-Claim wird nicht ausgewertet -> 200` —
     `idp.sign({ scope: BELIEBIGER_SCOPE })`, Konstante z.B. `"nicht-vergeben"`. Testname und
     Kopfkommentar sagen ausdruecklich: dieser Test PINNT eine dokumentierte Luecke (T-12,
     `docs/OPENAI-AUTH-ABWEICHUNGEN.md`); wird eine Scope-Pruefung gebaut, MUSS er rot werden
     und zusammen mit `src/mcp-security-schemes.js:21-27` und dem Dokument geaendert werden.
  Namenspraefix `OpenAI-P7-` trifft weder `config.i18nCatalogPattern` noch
  `config.abnahmePattern` (geprueft: `^(Charakterisierung )?(DID|E2E|...)-[0-9]`,
  `^ABNAHME-`) — die Faelle laufen in `npm test`.
- **Wo:** `test/openai-p7-token-pruefachsen.test.js` (neu). NICHT `test/oauth.test.js`
  (Abnahmekriterium 4 des Plans verlangt dort leeren Diff).
- **IDs:** T-12 (iss, nbf, Scope-Achse).
- **Pfade:** nur HTTP `/mcp` im oauth-Zweig. stdio hat keine Token-Pruefung
  (`src/mcp-server.js:35-46`) — dort nicht anwendbar, nicht nachbauen. Adapter
  mcp-nativ/ChatGPT: `mcpAuth` laeuft VOR `registerTools` und der Adapterwahl
  (`routes/mcp.js:113` vs. `:153`) — beide teilen denselben Pfad, kein zweiter Test noetig.
- **Beweis (b):** `NODE_ENV=test node --test --test-concurrency=4 test/openai-p7-token-pruefachsen.test.js`
  -> `# pass 4`, `# fail 0` (Unter-Tests mitgezaehlt, falls als `ctx.test` strukturiert: die
  Zahl im Bericht nennen). **Gegenprobe gegen Wirkungslosigkeit (Pflicht, im Bericht
  dokumentieren, danach zuruecksetzen):** in einer Wegwerf-Kopie `issuer:` aus
  `src/auth.js:99` entfernen -> T1 muss rot werden; `clockTolerance` auf einen sehr grossen
  Wert -> T2 rot. Ohne diese Gegenprobe beweist T1/T2 nichts. Die Wegwerf-Aenderung darf NICHT
  im Branch landen (`git diff master...HEAD -- src/` leer).

### Schritt 3 — Beleg-Dokument `docs/OPENAI-AUTH-ABWEICHUNGEN.md`

- **Was:** Neues, getracktes Dokument, auf Englisch-tauglich knappem Deutsch ODER zweisprachig
  (Owner-Entscheidung offen, Default: Deutsch wie Bestand, mit einer englischen
  Kurzfassung je ID, weil der Leser ein OpenAI-Pruefer ist). Inhalt:
  1. Einleitung: Architektur in drei Saetzen (Hermes = OAuth-Resource-Server, WorkOS AuthKit =
     Authorization Server, Auth pro HTTP-Request vor jedem Tool).
  2. Tabelle aus §1 dieser Spec, je ID: Wortlaut-Kern (aus `00-openai-anforderungen.md`),
     Status, Beleg (datei:zeile / Testname / Kommando), UNKNOWN-Rest, Bedingung.
  3. Messprotokoll aus Schritt 1, roh, mit Zeitstempel.
  4. Die **Bedingung** zu T-14 woertlich: "gilt nur, solange Produktion `MCP_AUTH=oauth`
     faehrt; Pruefkommando: `curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp`
     muss `resource_metadata=` enthalten".
  5. Owner-Fragen an WorkOS, je als konkreter Satz (Plan-Pre-Mortem 3): (a) "Kopiert AuthKit
     den `resource`-Parameter (RFC 8707) aus Authorization- und Token-Request in `aud`?" (T-9);
     (b) "Kann AuthKit `iss` in Authorization-Responses setzen und
     `authorization_response_iss_parameter_supported: true` bewerben?" (T-11); (c) "Liefert
     `/oauth2/userinfo` `email_verified`?" (T-16); (d) "Warum fehlt
     `code_challenge_methods_supported` in `openid-configuration`?" (T-8, OW-7); (e) "Gibt es
     ressourcenspezifische Scopes?" (T-12).
  6. Owner-Messung O-3 (ein echtes Token dekodieren: `aud`, `scope`/`scp`; UserInfo mit
     demselben Token: `email_verified`) als Handlungsanweisung — ohne dass ein Agent sie faehrt.
  7. Abschnitt "Was sich aendert, wenn …": WorkOS stellt Scope aus -> T-12 bauen (Schalter
     Default aus, vier Orte); `resource` landet nicht in `aud` -> Verbindungsausfall, nicht
     Sicherheitsausfall; Produktion nicht mehr oauth -> T-14-Aussage faellt.
  8. Befund B-1 (403 ohne Challenge) und Nebenbefund T-8.
- **Wo:** `docs/OPENAI-AUTH-ABWEICHUNGEN.md` (neu). Link darauf aus `docs/RUNBOOK-AS-METADATA.md`
  (eine Zeile, Abschnitt 1) — damit der naechste Leser der Sonde die Einordnung findet.
- **IDs:** T-9, T-11, T-12, T-14, T-16.
- **Pfade:** Dokument nennt je ID die Pfade: HTTP `/mcp` (einziger Auth-Pfad), stdio (keine
  Auth, `src/mcp-server.js:38-46`, nicht OpenAI-relevant), mcp-nativ/ChatGPT-Adapter (Auth
  vor Adapterwahl, identisch).
- **Beweis (a)+(c):** Der Pruefer oeffnet jede im Dokument genannte `datei:zeile` und findet
  dort die zitierte Aussage; er fuehrt jedes Kommando aus und vergleicht. Stichprobe
  mechanisch: `grep -c "UNKNOWN" docs/OPENAI-AUTH-ABWEICHUNGEN.md` >= 4 (T-9-aud, T-11-Redirect,
  T-12-Scope, T-16-email_verified); `grep -n "MCP_AUTH=oauth" docs/OPENAI-AUTH-ABWEICHUNGEN.md`
  trifft den T-14-Bedingungssatz; `grep -nE "erfuellt|erledigt" docs/OPENAI-AUTH-ABWEICHUNGEN.md`
  zeigt fuer T-11/T-16 KEIN unbedingtes "erfuellt". Kein Satz der Form "liegt beim Anbieter"
  ohne UNKNOWN-Rest und Owner-Frage (Plan-Abnahme 3).

### Schritt 4 — `PLAN-SECURITY.md`: Abschnitt "OpenAI-P7"

- **Was:** Neuer Abschnitt nach dem OpenAI-P6-Abschnitt (endet `PLAN-SECURITY.md:~5072`):
  (1) T-12 Scope-Achse als bewusste, dokumentierte Abweichung (Scope wird nicht geprueft,
  Ersatz: aud + Tenant-Bindung), mit Verweis auf Test T4 als Pinning; (2) T-14 als nicht
  anwendbar mit der oauth-Bedingung; (3) Anbieter-Abhaengigkeiten T-9/T-11/T-16 als offene
  Punkte mit Verweis auf das Dokument; (4) Befund B-1. Keine Aenderung an bestehenden
  Abschnitten. Kein Launch-Blocker wird geschlossen.
- **Wo:** `PLAN-SECURITY.md`, Ende des OpenAI-P6-Abschnitts.
- **IDs:** T-12, T-14 (plus Verweise T-9/T-11/T-16).
- **Pfade:** keine (Doku).
- **Beweis (a):** `grep -n "OpenAI-P7" PLAN-SECURITY.md` -> Abschnittsueberschrift;
  `git diff master...HEAD -- PLAN-SECURITY.md` enthaelt NUR `+`-Zeilen (keine `-`-Zeile:
  nichts Bestehendes umformuliert).

### Schritt 5 — Gesamtlauf und Diff-Grenzen

- **Was:** `npm test -- -- --test-concurrency=4 > <scratchpad>/p7-voll.txt 2>&1`, dann die
  `# pass`/`# fail`-Zeilen lesen. Soll: **6219 / 6219** (6215 + 4; bei `ctx.test`-Struktur
  entsprechend nach isoliertem Lauf nachgerechnet). Jeder rote Fall wird isoliert wiederholt;
  nur isoliert rot zaehlt.
- **Wo:** keine Datei.
- **IDs:** alle (Regressionsschutz).
- **Pfade:** alle.
- **Beweis (b)+(a):** `# fail 0`; und
  `git diff --stat master...HEAD` zeigt GENAU: `test/openai-p7-token-pruefachsen.test.js`,
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md`, `docs/RUNBOOK-AS-METADATA.md`, `PLAN-SECURITY.md`.
  `git diff master...HEAD -- src/ render.yaml .env.example test/oauth.test.js test/helpers.js`
  ist **leer**. Dateien einzeln adden, kein `git add -A`, kein Push, kein Merge.

---

## 3. Was in dieser Phase NICHT gebaut wird

1. **T-14 `_meta["mcp/www_authenticate"]`** — kein Ausloeser: Auth scheitert vor dem Tool; die
   einzigen tool-seitigen 403 (REST-Hop) sind durch Re-Auth nicht loesbar. Ein Feld dort waere
   toter Code oder, schlimmer, eine Re-Auth-Schleife bei jedem Consult-/Profilfehler.
2. **T-12 Scope-Pruefung** — der Anbieter stellt keinen ressourcenspezifischen Scope aus
   (bewirbt nur Identitaets-Scopes). Eine fail-closed Pruefung sperrte jeden Bestandstoken aus
   (Claude-Connector live), eine fail-open Pruefung waere Theater.
3. **Eigene AS-Metadata** (`authorization_response_iss_parameter_supported`, `claims_supported`,
   `resource_indicators_supported`) — Hermes ist kein Authorization Server; ein eigenes
   `/.well-known/oauth-authorization-server` wuerde Faehigkeiten behaupten, die WorkOS nicht hat
   (Falschangabe gegenueber dem Client).
4. **403-Challenge fuer `rejectIfNoTenant` (Befund B-1)** — nicht vom massgeblichen Wortlaut
   verlangt, Wirkung bei ChatGPT UNKNOWN, Auth-Code-Aenderung ohne Owner-Freigabe (O-2-Logik).
5. **Fix der Sonde `probe-as-faehigkeiten.mjs`** (wertet nur das erste Dokument aus) — Messwerkzeug,
   nicht P7-Scope; im Dokument als Einschraenkung vermerkt.
6. **T-8 PKCE-Advertising** — Anbieter, OW-7; nur gemeldet.
7. **Keine Aenderung an `test/oauth.test.js`, `test/helpers.js`, `src/**`, Env, `render.yaml`.**
   Keine neue Env-Variable (also auch kein BASE_ENV-Eintrag).

---

## 4. Pre-Mortem — ein Jahr spaeter war P7 ein Fehler

1. **Das Dokument wurde bei der Einreichung als "T-14 erfuellt" gelesen, dann fiel Produktion
   auf `MCP_AUTH=""` zurueck** (Dashboard-Fehlgriff; `render.yaml` ist seit P6 `sync:false`,
   schuetzt also nur gegen Blueprint-Sync). Der 401 trug keinen `resource_metadata` mehr,
   ChatGPT konnte nicht re-authentisieren, Nutzer steckten fest. *Entschaerfung:* die Bedingung
   steht woertlich mit Pruefkommando im Dokument (Schritt 3.4); Status heisst "nicht anwendbar
   unter Bedingung", nie "erfuellt". Restrisiko (U-1/O-7: Boot-Guard deckt `""`/`token` in
   Produktion nicht) bleibt Owner-Entscheidung, hier nur referenziert.
2. **Test T4 (Scope ignoriert) wurde als "Scope-Verhalten ist korrekt" missverstanden** und
   blockierte spaeter eine echte Scope-Pruefung — jemand "reparierte" den Test statt das
   Dokument. *Entschaerfung:* Testname und Kopfkommentar sagen "pinnt eine dokumentierte
   Luecke", nennen die zwei Mitaenderungsorte (`mcp-security-schemes.js:21-27`, Dokument).
3. **WorkOS kopiert `resource` nicht nach `aud`.** Am Einreichungstag scheitert jeder
   ChatGPT-Login mit 401; das Dokument hatte T-9 als "unsere Haelfte erfuellt" gefuehrt, und
   niemand hatte die Owner-Messung O-3 gefahren. *Entschaerfung:* T-9-Rest ist UNKNOWN mit der
   konkreten WorkOS-Frage (a) und der Messanleitung; das Dokument benennt die Folge
   (Verbindungsausfall, fail-closed). Kein Aufweichen der Audience-Pruefung als "Fix" —
   das waere ein Gate-Abbau und ist ausgeschlossen.
4. **Anbieter ruestet nach, Dokument veraltet.** WorkOS liefert spaeter
   `authorization_response_iss_parameter_supported`, das Dokument sagt weiter "fehlt", der
   Pruefer haelt es fuer unsorgfaeltig. *Entschaerfung:* jede Anbieter-Aussage traegt
   Zeitstempel und Kommando; Schritt 1 regelt: neue Messung gewinnt. Vor der Einreichung
   Schritt 1 erneut fahren (im Dokument als Pflicht vermerkt).
5. **Das Dokument landete in `tasks/` und wurde bei der Pflicht-Aufraeumung nach dem Merge
   geloescht** — zur Einreichung war die Abweichungsbegruendung weg. *Entschaerfung:* Ablage
   in `docs/` (getrackt), nicht als `tasks/openai-p7-report.md`.
6. **Doppelt verbucht:** der Phasenbericht zaehlte T-13/T-15 erneut als P7-Leistung, die
   Abdeckungstabelle wies mehr Erfuelltes aus, als es gibt. *Entschaerfung:* §1 fuehrt sie nur
   als Referenz; Abnahme prueft das.
7. **Die Wegwerf-Gegenprobe (Schritt 2) landete versehentlich im Branch** (`issuer:` entfernt) —
   eine Auth-Aufweichung durch eine Dokuphase. *Entschaerfung:* Schritt 5 verlangt leeren Diff
   auf `src/`; der Lead prueft `git diff --stat` vor dem Merge.

---

## 5. Widersprueche Plan / P0 / Code und ihre Aufloesung

| # | Steht dort | Gemessen | Aufloesung |
|---|---|---|---|
| W-1 | Plan §P7: `src/auth.js:119-129` (PRM), `:81-84` (jwtVerify), `:66-70` (Challenge); `mcp-tools.js:82-84` (`errText`), `:314-317` (`notAccepted`) | P6 hat verschoben: PRM `:142-150`, jwtVerify `:98-102`, `sendBearer401` `:66-70`, `deny401` `:74-77`; `errText` `:88`, `notAccepted` `:328` | Code gewinnt; Spec zitiert die heutigen Zeilen. |
| W-2 | Plan: "Unser Server erzeugt genau EIN eigenes Well-known-Dokument" | EIN OAuth-Dokument (PRM) auf ZWEI Pfaden (`auth.js:148-149`) plus `/.well-known/openai-apps-challenge` (`app.js:184`, Domain-Ownership, keine OAuth-Metadata) | Formulierung im Beleg-Dokument: "genau ein OAuth-Metadata-Dokument, keine AS-Metadata". |
| W-3 | Plan/P0: T-9 = fehlendes `resource_indicators_supported`, T-16-Metadata = fehlendes `claims_supported` | Keines der beiden Felder steht im massgeblichen Wortlaut (`00-openai-anforderungen.md:42`, `:49`). T-9 verlangt Verhalten (resource -> aud), T-16 Discovery + Scopes + UserInfo mit `email_verified` | Massgebliche Liste gewinnt. T-9 = aud-Kopie (UNKNOWN), T-16 = teilweise erfuellt (Discovery/Scopes/UserInfo live da), Rest `email_verified` UNKNOWN. Die Felder werden als "fehlt, aber kein Pruefkriterium" erwaehnt, nicht als Luecke. |
| W-4 | Plan OW-6: "T-11 ist potenziell ein Einreichungs-Blocker" | Der Wortlaut von T-11 enthaelt selbst den Rueckfallzweig (callback-spezifische URI); `tasks/openai-fix/S5-authorization-server.md:59` stuft ebenfalls "kein Blocker" | Kein Blocker per Wortlaut; UNKNOWN bleibt nur, ob WorkOS die Rueckfall-URI per CIMD/DCR annimmt. |
| W-5 | P0 D0-6/U-9: `grep -nE "401\|403\|Unauthorized" src/mcp-tools.js` -> keine Treffer | 1 Treffer `:160` (Kommentar, SIP-Code `invite-403`) | Aussage unveraendert (kein Auth-Zweig), Grep-Beleg im Dokument mit Treffer und Einordnung. |
| W-6 | P0: `mcp-texts.js:20-29` kennt "genau 4" Fehlercodes | 5 (`CALL_START_UNCONFIRMED`, E3) | Keiner auth-bezogen, Schluss unveraendert; Zahl korrigiert. |
| W-7 | P0 D0-6: "danach existiert keine Stelle, die einen Auth-Fehler als Tool-Ergebnis erzeugen koennte" | Der REST-Hop kann 403 liefern (`internal-only.js:27`, `api-calls.js:692-699`), `wrapHandler` macht daraus ein `isError`-Ergebnis | Praezisiert: es gibt Berechtigungs-Fehler als Tool-Ergebnis, aber keinen, den Re-Auth loest -> T-14 weiter nicht anwendbar; Begruendung im Dokument genau so. |
| W-8 | P0 D0-6 Punkt 1: token/Legacy antworten "mit nacktem 401 ohne Header" | Seit P6 statische Challenge `Bearer error="invalid_token"` ohne `resource_metadata` (`auth.js:89`, `:124/:131/:135`) | P0 ist durch P6 ueberholt; die Bedingung "nur oauth-Zweig verweist auf die PRM" bleibt richtig und wird so formuliert. |
| W-9 | Plan-Abnahme 1 (T-14 gebaut, Negativtest) | T-14 nicht gebaut | Abnahme 1 entfaellt; es gilt Abnahme 2 (Messung wiederholbar) — Schritte 1/3. |
| W-10 | Plan §P7 "Dateien": `src/mcp-tools.js`, `src/auth.js`, Tests | Keine `src/`-Aenderung | P0 gewinnt (Dokuphase). |
| W-11 | Sonde `probe-as-faehigkeiten.mjs` meldet T-8/DCR/CIMD FAIL | Diese Felder stehen im zweiten Anbieter-Dokument | Kein Widerspruch in der Sache, sondern Sonden-Einschraenkung (nur erstes Dokument); im Dokument vermerkt, nicht gefixt. |

---

## 6. UNKNOWN

| # | Was | Warum nicht klaerbar | Wer |
|---|---|---|---|
| U-P7-1 | Traegt ein echtes WorkOS-Access-Token `scope`/`scp`? | Braucht abgeschlossenen Login | Owner O-3 |
| U-P7-2 | Kopiert WorkOS `resource` nach `aud`? (indiziert ja, weil der Claude-Connector live gegen dieselbe Audience-Pruefung laeuft — aber nicht gemessen) | Token noetig | Owner O-3 / WorkOS (a) |
| U-P7-3 | Liefert `/oauth2/userinfo` `email_verified: true`? | Token noetig | Owner O-3 |
| U-P7-4 | Akzeptiert WorkOS die callback-spezifische ChatGPT-Redirect-URI? | Erster echter Connector-Flow | Owner O-5 |
| U-P7-5 | Welches Discovery-Dokument fragt ChatGPT zuerst (T-8)? | Client-Verhalten | Owner OW-7 |
| U-P7-6 | Reaktion von ChatGPT auf 403 ohne Challenge (B-1) | Client-Verhalten | Owner / P10 |
| U-P7-7 | Sprache des Beleg-Dokuments fuer den OpenAI-Pruefer (DE mit EN-Kurzfassung als Default) | Produktentscheidung | Owner |
