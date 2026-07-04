# Handover: Hermes In-App-Connector (OAuth) - Blocker + Fix

Stand: 2026-06-28. Alles live am Server verifiziert (nicht aus Notizen). Sprache ohne Umlaute (Repo-Konvention).

## Ziel
Der In-App-Connector (claude.ai / Cowork-Desktop) soll sich mit dem Hermes-MCP
verbinden. Aktuell schlaegt das "Verbinden" fehl.

## Aktueller Live-Zustand (Ende dieser Session = sicher + nutzbar)
- `MCP_AUTH` = geloescht -> **Bearer-Modus**. `/mcp` funktioniert per Bearer-Token.
- Token liegt in `/root/.openclaw/secrets/hermes-mcp.env` (`MCP_AUTH_TOKEN`, 64 hex).
- Letzter Deploy: `dep-d90cj2a63jts73eov4n0`, commit `9799e88`, status live.
- Verifiziert: `tools/list` per Bearer liefert place_call / get_call_status / ... .

## Was bereits verifiziert + OK ist (serverseitig nichts mehr zu tun)
- `/.well-known/oauth-protected-resource` -> `resource=https://app.sundartha.com/mcp`,
  `authorization_servers=["https://caring-lyric-24-staging.authkit.app"]`. Korrekt.
- AuthKit-Metadata (`.../.well-known/oauth-authorization-server`): authorize/token/register
  vorhanden, `dcr_supported=true`.
- **DCR funktioniert**: `POST /oauth2/register` -> `201 Created` + echte `client_id`
  (manuell getestet). Beispiel-Client: `client_01KW6GG6ATW892HMFWQW66NSKC`
  (redirect_uri `https://claude.ai/api/mcp/auth_callback`, token_endpoint_auth_method `none`).
- Mit `MCP_AUTH=oauth` antwortet `/mcp` korrekt `401` + Header
  `WWW-Authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource"`
  (RFC 9728). `verifyOauth` ist also aktiv und korrekt.

## Der Blocker (NICHT vom Server aus loesbar)
1. Claudes **eigener** DCR scheitert: "Registrierung beim Anmeldedienst fehlgeschlagen"
   (refs `ofid_33a536e45bb456c4`, `ofid_10c4cd1d366ee916`). Workaround "manuelle client_id
   eintragen" bringt einen Schritt weiter.
2. Danach scheitert der **OAuth-Callback**:
   `{"type":"invalid_request_error","message":"state: Field required"}` (Anthropic
   `request_id req_011C...`). Heisst: der Redirect von AuthKit `/oauth2/authorize` kommt
   **ohne `state`** zurueck, das Claude erwartet.
3. Beides passiert **direkt zwischen Claude-Connector und AuthKit** - `app.sundartha.com`
   ist daran nicht beteiligt. Daher kein Server-Log und kein Server-seitiger Fix moeglich.

## Wahrscheinliche Ursache + Fix-Optionen
- **(Empfohlen) MCP-Server als eigener OAuth-Authorization-Server / OAuth-Proxy.** Der
  Server uebernimmt DCR + `state` + PKCE + `resource` gegenueber Claude und brokert upstream
  zu AuthKit. Das ist das uebliche Muster fuer "remote MCP + IdP" und umgeht genau diese
  DCR/state/resource-Interop-Probleme. -> Engineering-Aufgabe (eigener Lean-Schnitt).
- **WorkOS/AuthKit pruefen**: warum spiegelt `/oauth2/authorize` den `state` nicht zurueck?
  Ggf. den AuthKit-Hosted-Flow (`/user_management/authorize?provider=authkit`) statt des
  reinen OAuth2/DCR-Servers nutzen (alte "Bug-A"-Notiz). Zusaetzlich pruefen, ob die Resource
  `https://app.sundartha.com/mcp` als Audience/Target registriert sein muss
  (`invalid_target` / RFC-8707 `resource`).
- **Anthropic-Connector-Support**: die `ofid_...`-Referenzen aus den Fehlermeldungen melden.

## Reversibler Toggle (Render, dashboard-managed, service `srv-d8m0fhflk1mc73bno570`)
- OAuth AN:  env `MCP_AUTH=oauth` setzen -> Deploy. ACHTUNG: bricht den Bearer-/Claude-Code-Weg.
- OAuth AUS (aktueller Stand): env `MCP_AUTH` loeschen -> Bearer. Token in `hermes-mcp.env`.
- Render-API: `PUT`/`DELETE /v1/services/<sid>/env-vars/MCP_AUTH` + `POST /v1/services/<sid>/deploys`.
  API-Key in `/root/.openclaw/secrets/render.env`.

## Was JETZT funktioniert (Workaround zum Nutzen von Hermes)
- Claude Code:
  `claude mcp add --transport http hermes https://app.sundartha.com/mcp --header "Authorization: Bearer <TOKEN>"`
- Token holen: `ssh openclaw@34.40.125.49 'sudo cat /root/.openclaw/secrets/hermes-mcp.env'`

## Aufraeumen (optional)
- Die beim Testen erzeugten DCR-Clients in der AuthKit-**Staging**-Instanz (u.a.
  `client_01KW6GG6ATW892HMFWQW66NSKC`) sind harmlos (public client, staging) und koennen
  im WorkOS-Dashboard geloescht werden.

## Update 2026-07-03: Production-WorkOS-Client eingerichtet + Render umgestellt

Ziel dieser Session: weg vom "-staging"-Issuer, echter Production-AuthKit-Client fuer
`app.sundartha.com` (siehe Follow-up-Punkt in [[vodafone-agent-oauth-multitenant-breakage]]).
Alles im WorkOS-Dashboard gemacht (Workspace "Sundartha's Project"), von Jonas per Cowork
mit Browser-Steuerung.

**Voraussetzung geklaert:** Production-Environment war gesperrt ("Add billing information to
enable Production"). Billing wurde von Jonas selbst hinterlegt (Zahlungsdaten trage ich nie
selbst ein). Erst danach war die Application "sundartha.com's Application" (Default-App,
urspruenglich schon am 24.06. angelegt, bis heute aber inaktiv/gesperrt) nutzbar.

**WorkOS-Konfiguration (Production-Env, App `app_01KVWCMQSJHBV0D1J5ER7VR1V7`):**
- Redirect URI gesetzt (Default): `https://app.sundartha.com/auth/callback`
- Sign-up **deaktiviert** (Feature "Sign-up" -> Disabled) = invite-only. Invitations bleiben
  aktiv (Default-Expiry 7 Tage).
- Custom-Domain (`login.sundartha.com`) bewusst **nicht** eingerichtet: WorkOS verlangt
  99 USD/Monat fuer alle Custom Domains (Email/Admin-Portal/Auth-API/AuthKit gebuendelt).
  Ruecksprache mit Jonas -> Standard-Domain gewaehlt, keine Kosten, kein DNS-Schritt bei
  Squarespace noetig.

**Die drei Werte (Production):**
- Issuer-URL: `https://fearless-network-26.authkit.app` (verifiziert: `.well-known/openid-configuration`
  live erreichbar, vollstaendiges OIDC-Discovery-Dokument)
- Client-ID: `client_01KVWCMQE3OGBJ5DRHVDC12BD7`
- Client-Secret: erzeugt ueber Application -> Tab "API keys" -> Create key (Name
  `app-sundartha-com-production`, Expiration "Never"). **Nur im Passwort-Manager von Jonas.**
  Ich habe den Wert nicht gesehen und nicht selbst eingetragen (harte Regel).

**Render (`srv-d8m0fhflk1mc73bno570`, Environment-Tab) umgestellt auf Production:**
- `OAUTH_ISSUER_URL`: `https://caring-lyric-24-staging.authkit.app` -> `https://fearless-network-26.authkit.app`
- `OIDC_CLIENT_ID`: `client_01KVWCMPXRT0K2CWEJ9B2255XX` (staging) -> `client_01KVWCMQE3OGBJ5DRHVDC12BD7` (production)
- `OIDC_CLIENT_SECRET`: von Jonas selbst im Render-Dashboard eingetragen (nicht von mir)
- Gespeichert ueber "Save, rebuild, and deploy" -> Deploy "Environment updated" gestartet
  3.7.2026 ca. 11:02 Uhr. Nicht bis zum Live-Status abgewartet/verifiziert in dieser Session.

**KORREKTUR (3.7.2026, nach Code-Lese per SSH): Bug-A-Notiz ist VERALTET.** Der urspruengliche
Vorbehalt in dieser Session ("Discovery-Endpoint = /oauth2/authorize, also vermutlich
application_not_found") war falsch - er basierte auf der 7 Tage alten Memory
[[bug-a-workos-authorize-endpoint-mismatch]] und wurde NICHT gegen den aktuellen Code
geprueft. Tatsaechlicher Code-Stand (`src/web-auth.js`, Repo-Worktree
`/srv/openclaw/projects/vodafone-agent-wt/jonas-github`, Zeile 362):
`authorizeEndpoint = ${config.workosApiBase}/user_management/authorize` (config.js:
`workosApiBase` = fix `https://api.workos.com`, NICHT von `OAUTH_ISSUER_URL` abgeleitet).
Der Bug-A-Fix (Umstieg von `/oauth2/authorize` auf `/user_management/authorize?provider=authkit`)
ist also bereits im Code - vermutlich zwischen dem 25.06. und heute gemacht worden, ohne
dass die Memory aktualisiert wurde. `OAUTH_ISSUER_URL` wird vom Web-Login-Codepfad gar nicht
gelesen (nur `config.oidcClientId` + `config.oidcClientSecret`, letzteres = WorkOS-Environment-
API-Key, nicht ein separates "Client Secret" - beides ist in WorkOS technisch dasselbe
Objekt, siehe API-Keys-Seite im Dashboard, die denselben Key zeigt wie die Application-eigene
"API keys"-Unterseite).

**NEUER, ECHTER BLOCKER (verifiziert per curl, nicht nur Browser-Screenshot):**
`app.sundartha.com/auth/login` redirected korrekt zu
`api.workos.com/user_management/authorize?...&client_id=client_01KVWCMQE3OGBJ5DRHVDC12BD7&provider=authkit...`
(alle Parameter korrekt, App-Code arbeitet richtig). WorkOS selbst antwortet darauf aber mit
`302 -> https://error.workos.com/sso/client-id-invalid`. Direkter Vergleichstest mit dem
STAGING-Client-ID (`client_01KVWCMPXRT0K2CWEJ9B2255XX`) am selben Endpoint funktioniert
einwandfrei (302 zu `.../bootstrap?...`). Der neue PRODUCTION-Client-ID wird also von WorkOS
selbst nicht akzeptiert - kein Code-, Render-Env- oder Redirect-URI-Problem. Nach 60 Sekunden
Wartezeit erneut getestet, gleicher Fehler -> kein kurzes Propagations-Timing-Problem.

Reproduktion (jederzeit direkt nachvollziehbar, kein Login-Flow noetig):
```
curl -s -D - -o /dev/null "https://api.workos.com/user_management/authorize?response_type=code&client_id=client_01KVWCMQE3OGBJ5DRHVDC12BD7&redirect_uri=https%3A%2F%2Fapp.sundartha.com%2Fauth%2Fcallback&provider=authkit&code_challenge=test&code_challenge_method=S256&state=test"
```
Aktuell: `location: https://error.workos.com/sso/client-id-invalid`.
Erwartet (sobald geloest): `location: https://fearless-network-26.authkit.app/bootstrap?...`.

**Naechster Schritt (kein Code-Task mehr, sondern WorkOS-Support):**
- Erneut testen nach laengerer Wartezeit (evtl. laengere Propagation fuer einen brandneuen,
  erstmals aktiven Production-Client als die getesteten 60 Sekunden).
- Falls weiterhin `client-id-invalid`: WorkOS-Support kontaktieren mit obiger Reproduktion,
  Workspace "Sundartha", Environment Production, `client_id=client_01KVWCMQE3OGBJ5DRHVDC12BD7`.
- Pruefen, ob im WorkOS-Dashboard fuer einen frisch aktivierten Production-Client noch ein
  manueller "Publish"/Freigabe-Schritt fehlt (in der UI nicht offensichtlich gefunden).

**Zwei Verdachtspunkte am 03.07. geprueft und AUSGESCHLOSSEN (Jonas + Cowork):**
- Billing: Zahlungsmethode ist hinterlegt (VISA ****1071), Pay-as-you-go-Plan aktiv seit
  03.07. Nicht die Ursache.
- Secret-Mismatch (sk_live_ vs sk_test_ oder falscher Wert in Render): von Jonas direkt
  bestaetigt (Passwort-Manager-Eintrag gegen Render-Feld verglichen) - ist der korrekte
  Production-Key (`sk_live_...`). Nicht die Ursache.

Damit ist Config/Secret/Billing auf unserer Seite vollstaendig durchgeprueft und korrekt.
**Naechster Schritt ist WorkOS-Support**, kein weiterer eigener Diagnose- oder Config-Task.

**Kleiner Zwischenfall:** Beim Vorbereiten des Render-Feldes fuer `OIDC_CLIENT_SECRET` wurde
kurz der ALTE (Staging-)Secret-Wert im Klartext sichtbar (Render entmaskiert bei Klick ins
Feld). Nichts gespeichert, keine Weitergabe. Falls ihr auf Nummer sicher gehen wollt: alten
Staging-Client-Secret in WorkOS rotieren.

## GELOEST 2026-07-03 (~11:50): client-id-invalid war ein O/0-Tippfehler, kein WorkOS-Problem

**Root Cause:** Die echte Production-Client-ID lautet `client_01KVWCMQE30GBJ5DRHVDC12BD7`
(Ziffer NULL nach "E3"), NICHT `client_01KVWCMQE3OGBJ5DRHVDC12BD7` (Buchstabe O). WorkOS-IDs
sind ULIDs in Crockford-Base32 - dieses Alphabet enthaelt die Buchstaben O, I, L, U prinzipiell
nicht. Jede WorkOS-ID mit einem "O" ist also zwangslaeufig ein Transkriptionsfehler. Der
O-Wert stand in Render `OIDC_CLIENT_ID` (und in allen Notizen inkl. Ticket-Entwurf); der
"byte-for-byte gegen das Dashboard verifizierte" Vergleich scheiterte, weil O und 0 im
Dashboard-Font optisch praktisch identisch sind. Aufgedeckt ueber den DOM-Text der
Applications-Seite (kein OCR/Abtippen).

**Fix (per Render-API, Key vom OpenClaw-Server):**
- `PUT /v1/services/srv-d8m0fhflk1mc73bno570/env-vars/OIDC_CLIENT_ID` -> Zero-Wert gesetzt
- Deploy `dep-d93obhojs32c73cr3u20` ausgeloest -> Status live

**End-to-End verifiziert (curl):** `app.sundartha.com/auth/login` -> 302 zu
`api.workos.com/user_management/authorize?...client_id=client_01KVWCMQE30GBJ5DRHVDC12BD7...`
-> 302 zu `https://fearless-network-26.authkit.app/bootstrap?...`. Genau das erwartete
Erfolgsverhalten. WorkOS-Support-Ticket war NICHT noetig und wurde NICHT abgeschickt.

**Merkregel fuer die Zukunft:** Bei `client-id-invalid` zuerst auf O/0-Verwechslung pruefen.
WorkOS-/ULID-IDs immer per Copy-Button oder DOM kopieren, nie abtippen oder aus Screenshots
lesen. Achtung: Die aelteren Abschnitte dieses Dokuments enthalten die ID noch in der
falschen O-Schreibweise.
