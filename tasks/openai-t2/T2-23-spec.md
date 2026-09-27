# T2-23 Spec - Auth: Scope-Angabe des Resource-Servers (PRM, 401-Challenge, securitySchemes)

IDs (gepinnt): T-16 (Resource-Server-Anteil; erfuellt erst mit OW-B), T-12 (Scope-Anteil; exp seit T2-03).
Branch `phase/openai-t2-23-auth-scopes`, Worktree `.../scratchpad/wt-t2-23`, Basis `24ff703` (master, T2-03 gemergt).
Baseline im Worktree: p3-security-schemes, p6-challenge, p7-token-pruefachsen, oauth -> 34 pass / 0 fail.

## Ziel

EINE Scope-Menge `S = ["openid", "email", "offline_access"]` als eingefrorene exportierte Konstante in
`src/auth.js` (einzige Stelle mit den Literalen als Code). Gelesen von PRM, oauth-401-Challenge,
securitySchemes (Commit A) und der Scope-Pruefung am Token (Commit B, getrennt, zuruecknehmbar).
Keine neue Env-Var (Produktentscheidung; Rueckweg = Revert). Kein Safety-Gate, keine Offenlegung,
kein Call-/SMS-Pfad beruehrt.

## Pfade

- HTTP /mcp, MCP_AUTH=oauth: PRM-Scopes, Challenge mit `scope=`, securitySchemes S, Scope-Pruefung (B).
- HTTP /mcp, MCP_AUTH=token und Legacy (""): Challenge BYTE-GLEICH `Bearer error="invalid_token"`, keine Scope-Pruefung.
- PRM: in JEDEM Modus ausgeliefert; `scopes_supported` nur wenn `authorization_servers` nicht leer.
- stdio (`src/mcp-server.js`): weiterhin KEIN securitySchemes, keine Auth (Autonome Entscheidung P3).
- MCP_AUTH=off: unveraendert `next()`.

## Commit A (T-16 RS-Anteil) - Schritte

1. Konstante `OAUTH_SCOPES` (Name frei, sprechend) = `Object.freeze(["openid","email","offline_access"])`,
   exportiert, in `src/auth.js` oben bei `audience`/`metadataUrl` (~:22-24). Kommentar: warum genau
   diese Menge (openid+email = T-16; offline_access = sonst kein Refresh-Token, weil spec-treue Clients
   nur noch die Challenge-Menge anfragen; kein profile = Minimalmenge; keine eigenen Hermes-Scopes, AS
   bewirbt nur Identitaets-Scopes). Pfad: alle (Quelle).
   Beweis (a)+(c): `grep -n '"offline_access"' src/*.js` -> genau 1 Treffer (die Konstante).
2. PRM `registerWellKnown` (`src/auth.js:147-155`): `scopes_supported: [...S]` NUR wenn
   `config.auth.oauthIssuerUrl` gesetzt; sonst Feld abwesend (nicht `[]`). Beide Pfade
   (`/.well-known/oauth-protected-resource` und `/mcp`) nutzen dasselbe `doc()`.
   Beweis (b): neuer Test, Kindprozess, `MCP_AUTH=oauth` + Test-IdP -> beide Pfade `scopes_supported`
   deepEqual S; `MCP_AUTH=token` ohne `OAUTH_ISSUER_URL` -> `authorization_servers` `[]` und
   `"scopes_supported" in doc === false`.
3. Challenge-Bau (`src/auth.js:64-77`): `deny401` baut
   `Bearer resource_metadata="<metadataUrl>", scope="openid email offline_access", error="...", error_description="..."`
   (`S.join(" ")`, resource_metadata BLEIBT ERSTER Parameter - `test/openai-p7-token-pruefachsen.test.js:47`
   prueft `^Bearer resource_metadata="`). Empfehlung: kleiner reiner Baustein, der die Parameterliste
   zusammensetzt, damit Commit B (403) denselben Baustein nutzt statt eines zweiten String-Literals.
   `STATIC_BEARER_CHALLENGE` (:89) BYTE-GLEICH lassen. Pfad: nur oauth.
   Beweis (b): neuer Test, `POST /mcp` ohne Token -> 401, `www-authenticate` EXAKT
   `Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource", scope="openid email offline_access", error="invalid_token", error_description="Kein Token"`;
   Muell-Token -> 401 mit demselben `resource_metadata=` und `scope=`.
4. Token-/Legacy-Challenge unveraendert - Negativ-Beweis. Pfad: token, Legacy.
   Beweis (b): `test/openai-p6-challenge.test.js` P6-T1..T4 unveraendert gruen (keine Aenderung an
   deren Erwartungen). Neuer Test ergaenzt: MCP_AUTH=token ohne Token-Var, MCP_AUTH=token mit Var +
   falsches Bearer, Legacy mit Var + falsches Bearer -> Header exakt `Bearer error="invalid_token"`,
   kein `scope=`, kein `resource_metadata`. Legacy OHNE `MCP_AUTH_TOKEN` NUR ueber
   `srv.externalUrl` (Interface-IP, `test/helpers.js:599 externalIp`) messen - ueber localhost greift
   der Dev-Bypass und es gibt gar keinen 401; ist `externalUrl` null, Test mit `ctx.skip` + Grund.
5. securitySchemes (`src/mcp-security-schemes.js:18-28`): `TOOL_SECURITY_SCHEMES =
   Object.freeze([Object.freeze({ type: "oauth2", scopes: <S aus auth.js> })])` - Import, kein Literal.
   Kommentar :18-23 ("Scope-Liste bleibt leer ... Falschangabe (E1, D0-7)") ersetzen: D0-7 durch T-16
   ueberholt; S ist die vom AS beworbene Identitaetsmenge, keine Hermes-Berechtigung; fachliche
   Zugriffsgrenze bleibt Audience + Mandantenbindung (`src/routes/mcp.js:130-131`, rejectIfNoTenant).
   Import `auth.js` -> `config.js`/`util.js`/`jose`: pruefen, dass kein Zyklus entsteht
   (`src/auth.js` importiert mcp-security-schemes nicht - ok). Pfad: HTTP (alle Modi, wie bisher); stdio ohne.
   Beweis (b): echter `tools/list`-Output ueber `POST /mcp` mit gueltigem Test-Token (MCP_AUTH=oauth,
   Test-IdP, `OWNER_IDP_SUBJECT=user-1`), mit und ohne Consult-Schalter: JEDES Werkzeug
   `securitySchemes` deepEqual `[{"type":"oauth2","scopes":["openid","email","offline_access"]}]`;
   stdio-Kindprozess (`test/openai-p3-security-schemes.test.js` Schritt 7) weiterhin an KEINEM Werkzeug.
   Registrierungsobjekte beweisen nichts (registerTool verwirft still).
6. Bestandstests nachziehen (Commit A): `test/openai-p3-security-schemes.test.js:39`
   `EXPECTED_SECURITY_SCHEMES` -> S (auch Meldungstext :64 und Lerntest :122 nutzt die Konstante -
   Lerntest bleibt sinngemaess gruen); `test/openai-p6-challenge.test.js:23-24` `OAUTH_CHALLENGE` ->
   neuer exakter String mit `scope=` (P6-T5 "Bestand byte-exakt"). `test/oauth.test.js` und
   `test/s2-mcp-origin.test.js` pruefen per Regex/Einzelfeld -> sollten ohne Aenderung gruen bleiben.
   Beweis (b): diese Dateien gruen.
7. Doku Commit A: `docs/OPENAI-TOOL-INVENTORY.md` (securitySchemes-Wert), `PLAN-SECURITY.md`
   (Scope-Angabe in PRM/Challenge/securitySchemes, Rueckweg Revert). `docs/OPENAI-AUTH-ABWEICHUNGEN.md`
   Abschnitte T-12/T-16 (DE + EN 2b) schreibt Opus, NICHT der Bau-Agent (Plan). Beweis (a).

## Commit B (T-12 Scope-Anteil) - EIGENER Commit, vor dem Deploy zuruecknehmbar

8. `verifyOauth` (`src/auth.js:91-118`): nach erfolgreichem `jwtVerify`, VOR `req.auth=`/`next()`:
   gewaehrte Scopes aus `payload.scope` (String, leerzeichengetrennt) oder `payload.scp` (Array oder
   String) lesen (reine Hilfsfunktion, unbekannte Typen -> leere Menge = fail-closed); fehlt EIN
   Element von S -> HTTP 403 (benannte Konstante `HTTP_FORBIDDEN`), `WWW-Authenticate: Bearer
   resource_metadata="...", error="insufficient_scope", scope="openid email offline_access",
   error_description="..."` (Reihenfolge: resource_metadata zuerst, wie 401), Body nur `{error: ...}`,
   `audit("auth_failed", req, "path=/mcp grund=insufficient_scope")` OHNE Token-/Claim-Inhalt, KEIN
   `next()`. Der Kommentar :64-65 ("Einzige Stelle ... 401-Code") ist anzupassen (jetzt Bearer-Antworten
   401 und 403 ueber EINEN Sender). Sender-Signatur max. 3 Argumente (Richtwert). Pfad: nur oauth;
   token/Legacy unberuehrt.
   Beweis (b), neuer Test (MCP_AUTH=oauth, Test-IdP, OWNER_IDP_SUBJECT=user-1, `tools/list`):
   `scope:"openid email offline_access"` -> 200; `scp:[...S]` -> 200; `scp:"openid email offline_access"`
   -> 200; `scope:"openid email"` -> 403, Header enthaelt `error="insufficient_scope"`,
   `scope="openid email offline_access"`, `resource_metadata=`; ohne scope/scp -> 403; in jedem 403-Fall
   Body ohne `jsonrpc`/`result`; die gecapturte Server-Ausgabe (stdout/stderr des Kindprozesses)
   enthaelt keinen Teil des Tokens (z.B. keines der drei JWT-Segmente) und die Zeile
   `grund=insufficient_scope`. Zusaetzlich Positiv-Kontrolle "scope mit Zusatzwert (openid email
   offline_access profile)" -> 200 (Obermenge ok).
9. Test-IdP-Default (`test/helpers.js:1313-1320`, `sign`): OHNE Anpassung werden in Commit B alle
   bestehenden OAuth-Tests rot, die `idp.sign()` ohne scope signieren und 200 erwarten (19 Dateien
   rufen `.sign(`: am6-oauth-tenant, e4-mandantentrennung-default, ie4-..., iel-b8-weiche,
   mcp-tools-i18n, oauth, openai-p7, openai-p10a-tool-inventar, openai-t2-01-widget-resource-meta,
   openai-p8-widget-ui, openai-p6-challenge, profile-tenant-key, profiles, request-tenant,
   sec-p1-webhook-idempotenz, s2-mcp-origin, security, signature-dispatch, telnyx-signature - nicht alle
   OAuth-/mcp-relevant). Loesung: `sign` setzt per Default `scope: "openid email offline_access"`,
   wenn `claims` weder `scope` noch `scp` traegt; neue Option `noScope: true` laesst ihn weg (Muster wie
   `noSubject`/`exp: null`). Dieser Helper-Default gehoert in Commit B (bei Revert von B faellt er mit).
   Beweis (b): volle Suite gruen.
10. `test/openai-p7-token-pruefachsen.test.js` bewusst drehen (Commit B): T3 "gueltiges Token ohne
   scope-Claim" -> `noScope: true`, Erwartung 403; T4 `scope:"nicht-vergeben"` -> 403; Kopfkommentar
   :1-11 anpassen (Luecke geschlossen). Eine separate Positiv-Kontrolle (Token mit S -> 200) muss in
   derselben Datei stehen, damit das Gate nicht "lehnt alles ab" besteht. Beweis (b).
11. PLAN-SECURITY.md (Commit B): Scope-Pruefung, fail-closed, Deploy-Vorbedingung OW-B, Rueckzugsregel.

## Abschluss-Messungen (Bau-Agent)

- `node --check src/auth.js src/mcp-security-schemes.js`
- `npm test -- -- --test-concurrency=4 > logs/full.log 2>&1`, nur `# pass`/`# fail` zaehlen, rote Tests
  isoliert wiederholen (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`).
- Nach Commit A UND nach Commit B je ein Suitenlauf (B muss per Revert allein zuruecknehmbar sein:
  `git revert --no-commit <B>` im Worktree -> Suite gruen -> `git revert --abort`/reset).
- `grep -n '"offline_access"' src/*.js` -> 1 Treffer; `grep -n "scopes" src/mcp-security-schemes.js`
  -> kein Literal-Array ausser dem Import-Bezug.
- Testserver hinterher mit `ps aux | grep [s]rc/server.js` pruefen (pgrep blind).

## Nicht bauen

- Eigene Hermes-Ressourcen-Scopes (calls:write o.ae.) und `profile`: AS bewirbt nur Identitaets-Scopes;
  erfundener Scope -> `invalid_scope` beim AS -> jede neue Verknuepfung tot.
- Scope-Menge als Env-Var: zweiter ungetesteter Wahrheitsort; Rueckweg = Revert.
- Per-Werkzeug unterschiedliche Scopes / Step-up-Autorisierung: ein Auth-Mount-Punkt, keine fachliche
  Scope-Unterscheidung.
- securitySchemes im token-/Legacy-HTTP-Modus abschalten oder modusabhaengig machen: bestehendes
  P3/T-15-Verhalten (dort deklariert der HTTP-Draht auch heute oauth2 unabhaengig vom Modus); eigene
  Entscheidung, nicht T-12/T-16.
- stdio mit securitySchemes: Autonome Entscheidung P3 (keine Auth auf stdio, oauth2 waere Falschangabe).
- UserInfo, email_verified, OIDC-Discovery: AS-Seite, Owner (OW-B).
- `docs/OPENAI-AUTH-ABWEICHUNGEN.md` T-12/T-16: schreibt Opus, nicht der Bau-Agent; T-12-Abschnitt erst
  nach OW-B endgueltig, bis dahin beide Ausgaenge (B bleibt / B zurueckgenommen) woertlich.
- Challenge-Aenderung fuer die `resource_metadata`-URL / PUBLIC_URL: T2-04/T2-05.

## Pre-Mortem (am Code geschaerft)

1. Deploy-Tag, alle Connectoren tot: das echte WorkOS-Access-Token traegt kein `scope`/`scp` oder
   `offline_access` fehlt darin (viele AS fuehren offline_access nicht im Access-Token) -> Commit B
   antwortet jedem mit 403; Claude-Connector des Owners und jede ChatGPT-Verbindung fallen gleichzeitig
   aus. Schlimmer: ein spec-treuer Client reagiert auf 403 insufficient_scope mit Step-up-Re-Auth und
   bekommt wieder dasselbe Token -> Login-Schleife. Entschaerfung: B getrennt, Deploy-Vorbedingung
   OW-B(4); UNKNOWN bis dahin; ohne Beleg B vor dem Deploy reverten.
2. Verbindungen reissen nach Minuten ab (kein Refresh-Token): Client fragt nur noch die Challenge-Menge
   an. Entschaerfung: offline_access in S; OW-B(3) prueft Refresh-Token.
3. `invalid_scope` bei neuer Verknuepfung (beworben != freigeschaltet): S Teilmenge der beworbenen
   Menge (Fixture `test/probe-as-faehigkeiten.test.js:60`); OW-B Login mit genau S vor Deploy.
4. Skript mit statischem Token bekommt OAuth-Scope-Angabe: Schritt 4 haelt Token-/Legacy-Challenge
   byte-gleich.
5. Doku behauptet Scope-Pruefung, die nach Revert von B fehlt: Doku-Abschnitt T-12 erst nach OW-B final.
6. Auth-Loch durch Helper-Default (Schritt 9): Tests signieren kuenftig per Default MIT Scope; ein
   spaeterer Fehler, der die Pruefung ausschaltet, faellt nur auf, wenn die Negativ-Tests (noScope,
   Teilmenge, scp-Varianten) existieren - deshalb Schritt 8 mit Negativ- UND Positiv-Kontrollen.
7. Fail-open durch Parserfehler (z.B. `scp` als Objekt, `scope` als Array, Gross-/Kleinschreibung):
   unbekannte Typen -> leere Menge -> 403; exakter Stringvergleich je Scope, kein Praefix/Fuzzy.
8. Token-Leak im Audit: nur `grund=insufficient_scope`, nie Claim-/Tokenwerte (Test prueft Ausgabe).
Kein Einfluss auf Anrufe, SMS, Kosten-Gates, Offenlegung: nur /mcp-Auth und Metadaten.

## Widersprueche Plan vs. Code (Stand 24ff703)

- Plan nennt `registerWellKnown` bei `src/auth.js:143-150` und `jwtVerify` bei `:98-104`; nach T2-03
  steht `registerWellKnown` bei :147-155, `jwtVerify` bei :98-107 (requiredClaims exp). Inhalt wie
  beschrieben.
- Plan nennt Kommentar `src/mcp-security-schemes.js:18-23`; tatsaechlich :19-23 (Absatz ab :19).
- Plan-Abnahme (5) nennt nur scp als Array; Ziel-Text erlaubt scp auch als String - Spec testet beides.
- Plan listet `test/helpers.js` nicht unter Dateien; ohne Scope-Default im Test-IdP bricht Commit B
  die OAuth-Bestandstests (Schritt 9).
- Plan-Abnahme (3) "Legacy (MCP_AUTH="")": ohne `MCP_AUTH_TOKEN` gibt es ueber localhost keinen 401
  (Dev-Bypass) - Messung nur ueber Interface-IP sinnvoll.
- securitySchemes wird auf dem HTTP-Draht in JEDEM Auth-Modus angehaengt (`src/routes/mcp.js:182`),
  auch token/Legacy - mit S dann eine OAuth-Scope-Angabe in einem Modus ohne OAuth. Bestandsverhalten
  aus P3, nicht in dieser Phase geaendert (s. Nicht bauen).
- Kommentar `src/auth.js:64-65` behauptet "einzige Stelle ... 401"; mit Commit B gibt es auch 403 mit
  Bearer-Challenge -> Kommentar anpassen.

## Owner-Punkte

- OW-B (Deploy-Vorbedingung, nach Merge von T2-23, vor Deploy): gemergten master lokal im OAuth-Modus
  gegen den echten AS starten (Werte aus eigenem .env, nirgends ablegen); `curl -si -X POST
  http://localhost:3999/mcp` -> 401 mit `scope="openid email offline_access"`; MCP Inspector OAuth-Login
  -> Autorisierungs-URL traegt die drei Scopes, kein `invalid_scope`, Refresh-Token vorhanden; Access-Token
  lokal dekodieren -> `scope`/`scp` enthaelt alle drei Werte? UserInfo -> email + email_verified:true.
  Ergebnis ja/nein. Commit A braucht: Login mit S gelingt + Refresh-Token. Commit B braucht zusaetzlich
  alle drei Werte im Token - sonst B vor Deploy reverten.
- OW-A Deploy/Push erst nach OW-B.
