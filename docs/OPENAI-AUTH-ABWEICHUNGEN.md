# OpenAI-Einreichung: Auth-Abweichungen (T-9, T-11, T-12, T-14, T-16)

> **Zweck.** Belegdokument fuer den OpenAI-Pruefer, Phase P7 der Hermes-OpenAI-Einreichung.
> Massgeblich ist die **OpenAI-Primaerquelle**: https://developers.openai.com/plugins/build/auth
> (T-9, T-11, T-12, T-14, T-16) und https://developers.openai.com/plugins/reference (T-14,
> Feldtabelle). Die woertlichen Zitate unten sind am 2026-09-21 gegen diese Seiten gelesen.
> Alle Aussagen ueber Hermes und den Anbieter sind am 2026-09-21 gemessen (Code lesend,
> Anbieter lesend GET), nicht aus frueheren Berichten uebernommen. **Fuer die Live-Messung
> wurde kein Login, kein echtes Token und kein Schreibzugriff verwendet** (die Tests in
> `test/` signieren eigene Tokens gegen einen lokalen Test-IdP).
>
> Die **englische Fassung (Abschnitte 2b+2c) ist vollstaendig und eigenstaendig**: sie traegt jede
> Einschraenkung und jedes UNKNOWN aus Abschnitt 2 sowie aus den Abschnitten 3-8. Sie ist nicht
> optimistischer als der deutsche Text; wo beide je auseinanderlaufen, gilt die vorsichtigere
> Aussage.

## 1. Architektur kurz

Hermes ist ausschliesslich **OAuth-2.1-Resource-Server** fuer `/mcp` (`src/auth.js`), niemals
Authorization Server - es gibt keinen eigenen `/.well-known/oauth-authorization-server` und
keine eigene Login-/Consent-Seite. **WorkOS AuthKit** (`https://fearless-network-26.authkit.app`)
ist der Authorization Server; Hermes vertraut ihm ueber JWKS-Discovery und prueft jedes Bearer-
Token lokal: Signatur, Issuer, Audience, **`exp` ist Pflicht** (`requiredClaims`, seit T2-03);
`nbf` weiterhin **nur, wenn der Claim im Token vorhanden ist** (Details T-12).

Die Token-Pruefung sitzt **einmal pro HTTP-Request** in der Middleware `mcpAuth`
(`src/routes/mcp.js:126`), **vor** jedem MCP-Tool-Aufruf; waehrend eines Tool-Aufrufs wird das
Token nicht erneut geprueft. Es gibt aber **zwei weitere Stellen**, an denen ein bereits
authentifizierter Request abgelehnt wird:

- **`rejectIfNoTenant`** (`src/routes/mcp.js:60-65`, aufgerufen `:118`): gueltiges Token, aber
  keine Tenant-Zuordnung -> HTTP 403 **ohne** `WWW-Authenticate`, auditiert als `auth_failed`
  (Befund B-1, Abschnitt 7).
- **Der interne REST-Hop der Tools** (`api()`, `src/mcp-tools.js:60-81`): liefert der Gateway
  dort 403 (z. B. `internalOnly`, `src/wiring/internal-only.js:24-28`, ebenfalls auditiert als
  `auth_failed`), kommt das beim Client als Tool-Ergebnis mit `isError: true` an
  (`wrapHandler`, `src/mcp-tools.js:885-902`). Aufzaehlung der Faelle unter T-14.

## 2. Status je ID

Status-Vokabular: **erfuellt** / **teilweise** / **bewusst nicht erfuellt** / **nicht in unserer
Hand**; offene Punkte sind als **UNKNOWN** mit Messweg gefuehrt. Jede Zeile mit Rest nennt eine
konkrete Frage in Abschnitt 4 oder eine Messung in Abschnitt 5.

### T-14 — Auth-UI im Gespraech NUR ueber ein Fehlerergebnis mit `_meta["mcp/www_authenticate"]`

**Status: bewusst nicht erfuellt.** Ob der Transport-Pfad (HTTP 401 + Challenge) die
Auth-UI im Gespraech ersetzt: **UNKNOWN.**

**Anforderung (Primaerquelle, woertlich):**

- plugins/reference, Feldtabelle: `_meta["mcp/www_authenticate"]` — "Error result — RFC 7235
  WWW-Authenticate challenges to trigger OAuth."
- plugins/build/auth: "Triggering the tool-level OAuth flow requires both metadata
  (`securitySchemes` and the resource metadata document) **and** runtime errors that carry
  `_meta["mcp/www_authenticate"]`." — "Without both halves ChatGPT will not show the linking UI
  for that tool."

**Ist-Zustand.** Die erste Haelfte ist vorhanden: `securitySchemes` an jedem Tool (P3,
`src/mcp-security-schemes.js:19-27`, angewandt in `src/routes/mcp.js:182`) und die
Protected-Resource-Metadata (`src/auth.js:141-150`). Die zweite Haelfte fehlt: **kein**
Tool-Ergebnis traegt `_meta["mcp/www_authenticate"]` (`grep -rn www_authenticate src/` liefert
0 Treffer). Nach dem Wortlaut der Primaerquelle zeigt ChatGPT deshalb **keine
tool-bezogene Verknuepfungs-UI**. Das ist eine Luecke, keine Nicht-Anwendbarkeit.

**Was stattdessen passiert.** Die Token-Pruefung laeuft als Express-Middleware vor
`POST /mcp` (`src/routes/mcp.js:126`), bevor irgendein MCP-Handler erreicht wird. Ein Token,
das zwischen zwei Turns ungueltig wird, trifft den **naechsten** `POST /mcp` als HTTP 401 mit
Bearer-Challenge inkl. `resource_metadata` (`deny401`, `src/auth.js:74`, Aufrufe `:95`/`:111`;
Challenge belegt fuer den OAuth-Zweig in `test/openai-p7-token-pruefachsen.test.js`,
`OpenAI-P7-T1`) — nicht als Tool-Ergebnis mit `isError: true`.

**UNKNOWN: wie ChatGPT auf diesen Transport-401 mitten im Gespraech reagiert.** Die
Primaerquelle ist hier zweideutig. Einerseits: "respond with `401 Unauthorized` and a
`WWW-Authenticate` header that points back to your protected-resource metadata. This tells the
client to run the OAuth flow again." und "reject it and rely on the `WWW-Authenticate`
challenge to prompt ChatGPT to re-authorize with the correct parameters." Andererseits: "Without
both halves ChatGPT will not show the linking UI for that tool." Ob der Transport-401 im
laufenden Gespraech eine Neu-Verknuepfung ausloest oder nur einen Fehler anzeigt, ist nicht
belegt. **Messweg (Owner, Abschnitt 5, O-6):** Connector in ChatGPT verknuepfen, das Token
ungueltig werden lassen (Ablauf abwarten oder Sitzung bei WorkOS widerrufen), im selben
Gespraech einen Tool-Aufruf ausloesen, beobachten ob die Verknuepfungs-UI erscheint.

**Faelle, in denen heute kein `_meta`-Feld kommt:**

1. **B-1 — gueltiges Token, kein Tenant** (`rejectIfNoTenant`, `src/routes/mcp.js:60-65`): 403
   **ohne** Challenge, auf HTTP-Ebene, also nicht einmal ein Tool-Ergebnis. Dieser Fall ist
   **durch Re-Authentisierung loesbar** (Anmeldung mit einem Konto, dem ein Tenant zugeordnet
   ist). Ein Re-Auth-Ausloeser waere hier **kein toter Code**. Offener Befund (Abschnitt 7).
2. **REST-Hop-403 als `isError`-Tool-Ergebnis** (`api()`, `src/mcp-tools.js:60-81`, gefangen in
   `wrapHandler`, `src/mcp-tools.js:885-902`). Quellen eines 403 dort:
   - `internalOnly` — Request nicht vertrauenswuerdig lokal (`src/wiring/internal-only.js:24-28`);
     ein interner Konfigurations-/Programmierfehler;
   - `requireTenant` REJECT (z. B. `src/routes/api-calls.js:691`) und das
     Tenant-REJECT-Gate der Outbound-Kette (`src/telephony/outbound-gates.js:689-691`) —
     Verteidigung in der Tiefe, weil `rejectIfNoTenant` diesen Fall am `/mcp`-Eingang schon
     abweist;
   - Consult-Kanal fuer den Tenant nicht freigegeben (`src/routes/api-calls.js:696-699`);
   - `POST /api/calls` reicht Ablehnungen der Outbound-Gates als 403 durch
     (`src/routes/api-calls.js:419-422`, Kette in `src/telephony/outbound-gates.js`, u. a.
     `OUTBOUND_FROZEN` `:657-668`, KYC `:394-401`, Abo/Freigabe `:407ff`, Denylist `:461ff`).

   Keiner dieser 403 ist durch Neu-Anmeldung desselben Kontos loesbar (interne Grenze, Plan-/
   Profilrecht, Sicherheits-Gate). Ein `_meta`-Feld dort loeste eine Neu-Verknuepfung aus, die
   das Problem nicht behebt. Deshalb **dort bewusst nicht gebaut**.

**Warum insgesamt nicht gebaut:** fuer Fall 2 waere das Feld falsch (s. o.). Fuer Fall 1 und
fuer den Token-Ablauf mitten im Gespraech waere es sinnvoll, verlangt aber eine
Entwurfsentscheidung am Live-Auth-Pfad (Ablehnung als Tool-Fehlerergebnis statt als
HTTP-Antwort) — Owner-Entscheidung, nicht Teil dieses Dokuments.

**Bedingung (woertlich, Pflicht-Wiederholung vor jeder Einreichung):** der Transport-401 traegt
`resource_metadata` NUR, solange Produktion `MCP_AUTH=oauth` faehrt. Im token-/Legacy-Zweig
traegt der 401 seit P6 zwar ebenfalls eine Challenge, aber **ohne** `resource_metadata`
(`STATIC_BEARER_CHALLENGE`, `src/auth.js:89`) — dann findet ChatGPT keinen OAuth-Einstieg ueber
den Header. Pruefkommando:

```
curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp
```

muss eine Zeile `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/...`
enthalten. Live gemessen 2026-09-21T10:06:03Z: **enthaelt sie** (Abschnitt 3, "POST /mcp ohne
Token"). Vor jeder Einreichung erneut pruefen.

### T-12 — Token-Pruefung: Signatur/JWKS, `iss`, `exp`/`nbf`, Audience, Scopes, eigene Policy

**Status: code-seitig vollstaendig erfuellt (T2-23, Commit B). Owner-Bestaetigung vor dem
Deploy offen (OW-B) — schlaegt sie fehl, wird Commit B laut Plan zurueckgenommen und dieser
Abschnitt wieder auf "teilweise erfuellt" zurueckgesetzt.**

**Anforderung (Primaerquelle, woertlich):** "verify the token's signature and `iss`." — "Deny
tokens that have expired or have not yet become valid (`exp`/`nbf`)." — "Confirm the token was
minted for your server (`aud` or the `resource` claim) and contains the scopes you marked as
required."

Geprueft wird in `verifyOauth()` (`src/auth.js:91-113`) in einem einzigen `jwtVerify`-Aufruf
(`:98-102`): Signatur gegen den per JWKS-Discovery gefundenen Schluessel, `issuer` gegen
`config.auth.oauthIssuerUrl`, `audience` gegen die kanonische Resource, `clockTolerance: 30`
Sekunden.

**Einschraenkung `nbf`, `exp` jetzt Pflicht (T2-03):** `jose` (6.2.3) prueft `nbf` und `exp`
frueher **nur, wenn der Claim vorhanden war** (`node_modules/jose/dist/webapi/lib/jwt_claims_set.js:142`
und `:150`, `if (payload.exp !== undefined)`). Seit T2-03 setzt `src/auth.js:98-106`
`requiredClaims: ['exp']`: ein vom Anbieter signiertes Token **ohne `exp`** wird jetzt
abgelehnt (401 + oauth-Challenge, `test/oauth.test.js`, Subtest "Token ohne exp"), nicht mehr
unbefristet angenommen. `nbf` bleibt weiterhin **nur** geprueft, wenn der Claim vorhanden ist
(nicht Teil dieser Anforderung, s. T2-03-Spec "Nicht bauen"). Ob echte WorkOS-Access-Tokens
`exp` tragen, ist am echten Token weiterhin nicht gemessen (Abschnitt 5, O-3) - das ist die
Deploy-Vorbedingung OW-B fuer T2-03, nicht Teil des Codes. Belegt ist: ein Token **mit**
abgelaufenem `exp` -> 401 (`test/oauth.test.js:66-70`, prueft den Status) UND ein Token **ohne**
`exp` -> 401 (Rot-vor-Gruen-Nachweis im T2-03-Bericht).

Am echten `tools/list`-Response belegt (`test/openai-p7-token-pruefachsen.test.js`, Faelle
T1-T4):

- `OpenAI-P7-T1`: Token mit fremdem `iss` (bei sonst gueltiger Signatur) -> **401** + Bearer-
  Challenge mit `resource_metadata`, kein `jsonrpc`-Feld im Body.
- `OpenAI-P7-T2`: Token mit `nbf` 3600 Sekunden in der Zukunft (weit jenseits der 30s
  `clockTolerance`) -> **401**.
- `OpenAI-P7-T3` (Positiv-Kontrolle): gueltiges Token **mit** vollstaendiger Scope-Menge ->
  **200**. Belegt, dass das Gate ein korrekt beliefertes Token nicht pauschal ablehnt.
- `OpenAI-P7-T4`: gueltiges Token, dem ein **erzwungenes** Scope-Element fehlt (`"openid"`, ohne
  `email`) -> **403** mit `WWW-Authenticate: Bearer error="insufficient_scope", ...`, kein
  `jsonrpc`-Feld im Body. Seit T2-23 Commit B wird der fehlende erzwungene Scope durchgesetzt.

Fuenf weitere Faelle in `test/openai-t2-23-scopes.test.js` (`OpenAI-T2-23-B1`..`B4`, `B3b`): volle
Scope-Menge als `scope`-String -> 200; volle Menge als `scp`-Array -> 200; nur die ERZWUNGENE
Menge, ohne `offline_access` -> 200 (B3, s. u. — der Nachtrag, der genau diesen Fall korrigiert);
ein erzwungenes Element fehlt -> 403 (B3b); komplett ohne `scope`/`scp` -> 403 (B4) — die 403-Faelle
jeweils mit derselben Challenge (`error`, `scope`, `resource_metadata`, `error_description`, in
dieser Reihenfolge, weiterhin mit der VOLLEN beworbenen Menge inkl. `offline_access` im
`scope=`-Parameter).

Eigene Policy (jenseits des Tokens) existiert: Tenant-Bindung ueber `sub`; ein gueltiges Token
ohne zugeordneten Tenant erhaelt 403 (`rejectIfNoTenant`, `src/routes/mcp.js:60-65`, belegt in
`test/e4-mandantentrennung-default.test.js:210-220`, ID E4-17 — dort bereits erfuellt, hier nur
referenziert). Diese 403 traegt keine Challenge (B-1).

**Scope WIRD geprueft (T2-23 Commit B, `src/auth.js` `hasRequiredScopes`/`grantedScopes`):** nach
erfolgreicher Signatur-/Claim-Pruefung liest der Resource Server `scope` (leerzeichengetrennter
String) oder `scp` (Array oder String) aus dem Token und verlangt jedes Element der ERZWUNGENEN
Menge `ENFORCED_OAUTH_SCOPES` = `openid`, `email` — NICHT die volle beworbene Menge `S`
(`OAUTH_SCOPES` = `openid`, `email`, `offline_access`, die PRM/Challenge/`securitySchemes` seit
Commit A bewerben, `src/mcp-security-schemes.js`). `offline_access` ist ausgenommen
(`GRANT_ONLY_SCOPES`, `src/auth.js`): es ist ein Grant-Scope, der nur die Ausgabe eines
Refresh-Tokens steuert und bei einem spec-treuen IdP typischerweise nicht im Access-Token
steht — eine Erzwingung haette nach dem Deploy jeden gueltigen Aufruf mit 403 abgelehnt (Fund
eines Safety-Reviews derselben Phase, s. `PLAN-SECURITY.md` Abschnitt "OpenAI-T2-23", Nachtrag
2026-09-22). Fehlt eines der erzwungenen Elemente, antwortet der Server 403 `insufficient_scope`,
ohne dass ein Werkzeug laeuft (kein `jsonrpc`-`result` im Body) und ohne Token- oder
Claim-Inhalt im Audit-Log (nur `grund=insufficient_scope`).

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (e), Deploy-Vorbedingung OW-B — Risiko jetzt niedriger):**
WorkOS bewirbt die Identitaets-Scopes `email`, `offline_access`, `openid`, `profile`
(Abschnitt 3) — `S` ist eine Teilmenge davon, kein ressourcenspezifischer Scope. Ob ein echtes,
von WorkOS ausgestelltes Access-Token tatsaechlich einen `scope`- oder `scp`-Claim mit `openid`
und `email` traegt, ist ohne einen abgeschlossenen Login nicht messbar — das ist weiterhin OW-B.
Anders als vor dem Nachtrag haengt daran aber NICHT mehr das Schicksal von `offline_access`: das
wird nicht mehr erzwungen, ein Access-Token ohne diesen Claim (der erwartbare Fall bei einem
spec-treuen IdP) bleibt gueltig. Bestaetigt OW-B `openid`+`email` nicht, ist jede
Connector-Verbindung ab Deploy tot (403 statt 200) — das Szenario ist unveraendert vorhanden,
nur eben nicht mehr durch einen Scope ausgeloest, den kein Access-Token je traegt.

### T-9 — Authorization Server uebernimmt den `resource`-Parameter ins Token (i. d. R. `aud`)

**Status: unsere Haelfte erfuellt; Anbieterhaelfte nicht in unserer Hand (UNKNOWN).**

**Anforderung (Primaerquelle, woertlich):** "Expect ChatGPT to append
`resource=https%3A%2F%2Fyour-mcp.example.com` to both the authorization and token requests." —
"Configure your authorization server to copy that value into the access token (commonly the
`aud` claim)."

Wir verlangen `aud` == kanonische Resource. Die erwartete Audience (`audience()`,
`src/auth.js:23`) und die in der Protected-Resource-Metadata angekuendigte `resource`
(`src/auth.js:144`) kommen aus **derselben Funktion**; die Pruefung nutzt sie in `:100`. Live
gemessen: `"resource":"https://app.sundartha.com/mcp"` (Abschnitt 3). Boot-fatal ist genau ein
Fall: `OAUTH_AUDIENCE` gesetzt und ungleich `publicUrl + /mcp` (`src/boot-guard.js:937-950`,
belegt in `test/oauth.test.js:107-119`). Falsches `aud` im Token -> 401
(`test/oauth.test.js:72-76`).

**Nebenbefund:** WorkOS bewirbt **kein** `resource_indicators_supported` (fehlt in beiden
Dokumenten, Abschnitt 3). Die OpenAI-Primaerquelle nennt dieses Feld nicht (gelesen
2026-09-21), es ist also kein Pruefkriterium fuer T-9 — aber aus den Metadaten laesst sich
damit auch **nicht** ablesen, ob WorkOS RFC 8707 unterstuetzt.

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (a)):** ob WorkOS den `resource`-Parameter (RFC 8707)
aus Authorization- und Token-Request 1:1 nach `aud` kopiert, ist nur am echten Token pruefbar.
**Folge bei Nein:** fail-closed — jedes ChatGPT-Token scheitert mit 401. Das ist ein
**Verbindungsproblem**, kein Sicherheitsproblem; die Audience-Pruefung selbst wird dafuer nicht
aufgeweicht.

### T-11 — Stabile Redirect-URI nur mit RFC-9207-`iss`, sonst callback-spezifische URI

**Status: nicht in unserer Hand; der in der Primaerquelle genannte Rueckfallzweig greift.**

**Anforderung (Primaerquelle, woertlich):** "`authorization_response_iss_parameter_supported`:
set this to `true` only when your authorization server returns an `iss` parameter in every
authorization response." — "If your authorization server does not meet the issuer
identification requirements above, ChatGPT uses the callback-ID-specific redirect URI
`https://chatgpt.com/connector/oauth/{callback_id}`."

`authorization_response_iss_parameter_supported` fehlt in **beiden** WorkOS-Dokumenten
(Abschnitt 3). Hermes ist reiner Resource Server und stellt keine Authorization-Response aus —
an diesem Feld ist kein eigener Code beteiligt, es kann nicht "gebaut" werden, ohne WorkOS'
Faehigkeiten faelschlich zu behaupten. Die Primaerquelle selbst nennt fuer diesen Fall den
Rueckfall (callback-spezifische Redirect-URI) — per Wortlaut kein Einreichungs-Blocker.

**Rest (UNKNOWN, WorkOS-Frage (b)):** ob WorkOS diese Rueckfall-URI akzeptiert (ueber
CIMD/DCR — `client_id_metadata_document_supported: true` und `registration_endpoint` stehen nur
im zweiten Dokument, `oauth-authorization-server`), ist erst am ersten echten Connector-Flow
messbar.

### T-16 — Fuer Workspace-Domain-Restriktionen: OIDC-Discovery + Scopes + UserInfo mit `email` und `email_verified`

**Status: Resource-Server-Anteil erfuellt (T2-23 Commit A); Rest teilweise erfuellt, beim
Anbieter (nur relevant, falls Workspace-Domain-Restriktionen genutzt werden sollen).**

**Anforderung (Primaerquelle, woertlich):** "Advertise a UserInfo Endpoint that returns the
user's `email` claim and `email_verified: true`." — "the UserInfo Endpoint is required for
workspace domain restrictions."

OIDC-Discovery antwortet HTTP 200 (`openid-configuration`, Abschnitt 3); `scopes_supported`
enthaelt `openid` und `email`; ein `userinfo_endpoint` existiert und antwortet ohne Token
mit 401 (kein 404, kein 500 — der Endpunkt existiert und verlangt ein Token). Das war die
Anbieter-(AS-)Haelfte, unveraendert seit P7.

**Resource-Server-Anteil GEBAUT (T2-23 Commit A):** der Resource Server selbst bewirbt dieselbe
Scope-Menge `S` = `openid`, `email`, `offline_access` jetzt an drei Stellen — Protected-Resource-
Metadata (`scopes_supported: S`, NUR mit konfiguriertem Authorization-Server,
`test/openai-t2-23-scopes.test.js` `OpenAI-T2-23-A1`), der oauth-401-Bearer-Challenge
(`scope="openid email offline_access"`, `OpenAI-T2-23-A3`) und `securitySchemes` auf jedem
Werkzeug (`OpenAI-T2-23-A5`, echter `tools/list`-HTTP-Draht). Ein spec-treuer Client liest laut
MCP-Spec (Scope Selection Strategy) diese beworbene Menge und fragt `openid`/`email` damit
tatsaechlich an — vorher (P7) war die beworbene Menge leer (`scopes: []`).

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (c)):** ob `/oauth2/userinfo` mit einem echten Token
das Feld **`email`** und **`email_verified: true`** liefert, ist ohne Login nicht messbar — das
ist die einzige noch offene Haelfte, ausschliesslich beim Anbieter. **Nebenbefund:**
`claims_supported` fehlt in beiden WorkOS-Dokumenten. Die Primaerquelle nennt das Feld nicht
(kein Pruefkriterium fuer T-16) — aber damit ist auch aus den Metadaten nicht ablesbar, ob
`email`/`email_verified` geliefert werden.

## 2b. English version (per ID, for the OpenAI reviewer)

This section, together with Section 2c below, is complete on its own: it carries every
limitation and every UNKNOWN from Section 2 and is not more optimistic than the German text.
Requirement quotes are verbatim from the OpenAI primary sources, read on 2026-09-21:
https://developers.openai.com/plugins/build/auth and
https://developers.openai.com/plugins/reference. File:line references point into this
repository. "Section 3" is the raw measurement log below (verbatim, not duplicated in
English; it contains some German literal output, translated in 2c.1). Section 4 (our open questions to WorkOS) and Section 5 (measurements that need a
real, completed login) are German-only; their English equivalents are 2c.2 and 2c.3 below.

**Architecture.** Hermes is an OAuth 2.1 resource server for `/mcp` only; WorkOS AuthKit
(`https://fearless-network-26.authkit.app`) is the authorization server. Every bearer token is
verified locally once per HTTP request in the `mcpAuth` middleware (`src/routes/mcp.js:126`),
before any MCP tool runs: signature (JWKS), issuer, audience, **`exp` is now required**
(`requiredClaims`, since T2-03); `nbf` still **only if the claim is present** (see T-12). The
token is not re-checked during a tool call. Two further places can
reject an already-authenticated request: `rejectIfNoTenant` (`src/routes/mcp.js:60-65`, called
at `:118`) returns HTTP 403 **without** a `WWW-Authenticate` challenge for a valid token that
maps to no tenant (logged as `auth_failed`); and the tools' internal REST hop (`api()`,
`src/mcp-tools.js:60-81`) can receive a 403, which reaches the client as a tool result with
`isError: true` (`src/mcp-tools.js:885-902`).

### T-14 — in-conversation auth UI only via an error result carrying `_meta["mcp/www_authenticate"]`

**Status: deliberately not met. Whether the transport-level 401 path substitutes for it:
UNKNOWN.**

Requirement: "`_meta["mcp/www_authenticate"]` — Error result — RFC 7235 WWW-Authenticate
challenges to trigger OAuth." (plugins/reference); "Triggering the tool-level OAuth flow
requires both metadata (`securitySchemes` and the resource metadata document) **and** runtime
errors that carry `_meta["mcp/www_authenticate"]`. [...] Without both halves ChatGPT will not
show the linking UI for that tool." (plugins/build/auth)

What we have: the first half — `securitySchemes` on every tool
(`src/mcp-security-schemes.js:19-27`, applied in `src/routes/mcp.js:182`) and protected-resource
metadata (`src/auth.js:141-150`). What we do not have: the second half — no tool result carries
`_meta["mcp/www_authenticate"]` (zero occurrences in `src/`). By the wording of the primary
source, ChatGPT will therefore **not** show the tool-level linking UI. This is a gap, not a
case of "not applicable".

What happens instead: token verification runs as HTTP middleware in front of `POST /mcp`. A
token that becomes invalid between turns hits the *next* `POST /mcp` as HTTP 401 with a bearer
challenge including `resource_metadata` (`src/auth.js:74`, used at `:95`/`:111`; challenge
asserted in `test/openai-p7-token-pruefachsen.test.js`, case T1) — never as a tool result.

**UNKNOWN — how ChatGPT reacts to that transport-level 401 in the middle of a conversation.**
The primary source is ambiguous here: it says the 401 + `WWW-Authenticate` "tells the client to
run the OAuth flow again" and to "rely on the `WWW-Authenticate` challenge to prompt ChatGPT to
re-authorize with the correct parameters", but also that "without both halves ChatGPT will not
show the linking UI for that tool". We have not measured which applies. How to measure: link
the connector in ChatGPT, let the token become invalid (wait for expiry or revoke the session
at WorkOS), trigger a tool call in the same conversation, and observe whether the linking UI
appears (2c.3, O-6).

Cases that today carry no `_meta` field:

1. **Valid token, no tenant** (`rejectIfNoTenant`): HTTP 403 without a challenge, at the HTTP
   layer (not even a tool result). This case **can be resolved by re-authenticating** with an
   account that has a tenant, so a re-auth trigger here would **not** be dead code. Open
   finding (2c.4, B-1).
2. **403 from the internal REST hop, arriving as an `isError` tool result.** Sources: the
   `internalOnly` guard (request not trusted-local, `src/wiring/internal-only.js:24-28`) — an
   internal configuration/programming fault; a tenant REJECT in `requireTenant`
   (`src/routes/api-calls.js:691`) or in the outbound gate chain
   (`src/telephony/outbound-gates.js:689-691`) — defence in depth, since `rejectIfNoTenant`
   already rejects this case at the `/mcp` entrance; the consult channel not being enabled for
   the tenant (`src/routes/api-calls.js:696-699`); and `POST /api/calls` passing through
   rejections from the outbound safety gates (`src/routes/api-calls.js:419-422`, chain in
   `src/telephony/outbound-gates.js`: global outbound kill switch `:657-668`, KYC `:394-401`,
   subscription/permit `:407ff`, denylist `:461ff`, among others). None of these can be fixed by
   the same user signing in again; a `_meta` field there would trigger a re-link that cannot
   help, so it is deliberately not emitted there.

Why not built overall: for case 2 the field would be wrong. For case 1 and for token expiry
mid-conversation it would make sense, but it requires a design change on the live auth path
(rejecting as a tool error result instead of an HTTP response); that decision is open and not
part of this document.

Condition: the transport 401 carries `resource_metadata` only while production runs
`MCP_AUTH=oauth`; in the static-token/legacy mode the 401 carries `Bearer error="invalid_token"`
without `resource_metadata` (`src/auth.js:89`). Verify before every submission:
`curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp` must contain a
`www-authenticate: Bearer resource_metadata="https://app.sundartha.com/...` line. Measured live
2026-09-21T10:06:03Z: it does (Section 3).

### T-12 — token check: signature/JWKS, `iss`, `exp`/`nbf`, audience, scopes, own policy

**Status: fully met in code (T2-23, Commit B). Owner confirmation still open before deploy
(OW-B) — if it fails, Commit B is reverted per the plan and this section reverts to "partially
met".**

Requirement: "verify the token's signature and `iss`." — "Deny tokens that have expired or have
not yet become valid (`exp`/`nbf`)." — "Confirm the token was minted for your server (`aud` or
the `resource` claim) and contains the scopes you marked as required."

`verifyOauth()` (`src/auth.js:91-113`) checks, in one `jwtVerify` call (`:98-102`), signature
against the JWKS-discovered key, issuer and audience, with a 30-second clock tolerance.

**Limitation on `nbf`, `exp` now required (T2-03):** the `jose` library (6.2.3) used to check
`nbf` and `exp` **only when the claim was present** (`jwt_claims_set.js:142` and `:150`). Since
T2-03, `src/auth.js:98-106` sets `requiredClaims: ['exp']`: a token signed by the provider
**without `exp` is now rejected** (401 + oauth challenge, `test/oauth.test.js`, subtest "Token
ohne exp"), no longer accepted without time limit. `nbf` still has no start of validity if
absent (not part of this requirement). Whether real WorkOS access tokens carry `exp` is still
not measured on a real token (2c.3, O-3) - that is deploy precondition OW-B for T2-03, not part
of the code. What is proven: a token **with** an expired `exp` -> 401 (`test/oauth.test.js:66-70`)
AND a token **without** `exp` -> 401 (red-then-green proof in the T2-03 report).

Proven end-to-end against the real `tools/list` HTTP response
(`test/openai-p7-token-pruefachsen.test.js`): T1 foreign issuer -> 401 with a
`resource_metadata` challenge and no JSON-RPC body; T2 `nbf` one hour in the future -> 401;
T3 (positive control) valid token with the full scope set -> 200; T4 valid token missing an
**enforced** scope element (`"openid"`, missing `email`) -> **403** with
`WWW-Authenticate: Bearer error="insufficient_scope", ...` and no JSON-RPC body. Five more cases
in `test/openai-t2-23-scopes.test.js` (`OpenAI-T2-23-B1`..`B4`, `B3b`): full scope as a `scope`
string -> 200; full scope as an `scp` array -> 200; only the ENFORCED set, without
`offline_access` -> 200 (B3 — see the addendum below, which is exactly the fix for this case);
missing an enforced element -> 403 (B3b); no `scope`/`scp` at all -> 403 (B4) — the 403 cases with
the same challenge order each time (`error`, `scope`, `resource_metadata`, `error_description`,
still carrying the full advertised set including `offline_access` in the `scope=` parameter).

Own policy beyond the token: tenant binding via `sub`; a valid token without a tenant gets 403
(`src/routes/mcp.js:60-65`, `test/e4-mandantentrennung-default.test.js:210-220`), without a
challenge (see T-14, case 1).

**Scope IS checked (T2-23 Commit B, `src/auth.js` `hasRequiredScopes`/`grantedScopes`):** after
signature/claim verification succeeds, the resource server reads `scope` (space-separated
string) or `scp` (array or string) from the token and requires every element of the ENFORCED set
`ENFORCED_OAUTH_SCOPES` = `openid`, `email` — **not** the full advertised set `S` (`OAUTH_SCOPES`
= `openid`, `email`, `offline_access`, still advertised in the PRM, the 401 challenge and
`securitySchemes` since Commit A). `offline_access` is excluded (`GRANT_ONLY_SCOPES`,
`src/auth.js`): it is a grant scope that only controls whether a refresh token is issued and,
with a spec-compliant IdP, typically does not appear in the access token itself — enforcing it
would have rejected every valid call with 403 after deploy (a safety-review finding from the
same phase, see `PLAN-SECURITY.md`, section "OpenAI-T2-23", addendum 2026-09-22). If one of the
enforced elements is missing, the server answers 403 `insufficient_scope`, no tool runs (no
`jsonrpc` `result` in the body), and the audit log carries no token or claim content (only
`reason=insufficient_scope`).

**UNKNOWN (deploy precondition OW-B — risk now lower):** WorkOS advertises only identity scopes
(`email`, `offline_access`, `openid`, `profile`; Section 3) — `S` is a subset of those, not a
resource-specific scope. Whether a real WorkOS-issued access token actually carries a `scope` or
`scp` claim with `openid` and `email` cannot be measured without a completed login — that is
still OW-B. Unlike before this addendum, `offline_access` no longer hangs on that answer: it is
no longer enforced, so an access token without it (the expected case for a spec-compliant IdP)
stays valid. If OW-B does not confirm `openid`+`email`, every connector connection is still dead
from deploy on (403 instead of 200) — that scenario is unchanged, it is just no longer triggered
by a scope no access token would ever carry.

### T-9 — authorization server copies the `resource` parameter into the token (usually `aud`)

**Status: our half met; the provider's half is not in our control (UNKNOWN).**

Requirement: "Expect ChatGPT to append `resource=...` to both the authorization and token
requests." — "Configure your authorization server to copy that value into the access token
(commonly the `aud` claim)."

We require `aud == https://app.sundartha.com/mcp`. The expected audience and the `resource`
announced in the protected-resource metadata come from the **same function** (`audience()`,
`src/auth.js:23`, used for the check at `:100` and for the metadata at `:144`), so they cannot
diverge at runtime. Boot is refused in exactly one case: `OAUTH_AUDIENCE` is set and differs from
`publicUrl + /mcp` (`src/boot-guard.js:937-950`, `test/oauth.test.js:107-119`). A wrong `aud` in
the token -> 401 (`test/oauth.test.js:72-76`).

Side finding: WorkOS does **not** advertise `resource_indicators_supported` (absent from both
discovery documents, Section 3). The OpenAI primary source does not name that field, so it is not
a criterion for T-9 — but it also means the metadata do not tell us whether WorkOS supports
RFC 8707.

**UNKNOWN:** whether WorkOS actually copies the RFC 8707 `resource` parameter into `aud` can only
be checked on a real token (2c.2 item a, 2c.3 O-3). If it does not: every ChatGPT login fails
closed with 401 — a connectivity problem, not a security one; the audience check is not weakened
to work around it.

### T-11 — stable redirect URI only with RFC 9207 `iss`, otherwise a callback-specific URI

**Status: not in our control; the fallback named by the primary source applies.**

Requirement: "`authorization_response_iss_parameter_supported`: set this to `true` only when your
authorization server returns an `iss` parameter in every authorization response." — "If your
authorization server does not meet the issuer identification requirements above, ChatGPT uses
the callback-ID-specific redirect URI `https://chatgpt.com/connector/oauth/{callback_id}`."

`authorization_response_iss_parameter_supported` is absent from both WorkOS discovery documents
(Section 3). Hermes is a pure resource server and issues no authorization response, so no code
of ours participates in this field. By the primary source's own wording the callback-specific
redirect URI is used instead — not a submission blocker.

**UNKNOWN:** whether WorkOS accepts that callback-specific redirect URI (via CIMD or DCR —
`client_id_metadata_document_supported: true` and `registration_endpoint` appear only in the
`oauth-authorization-server` document) can only be measured in a first real connector flow
(2c.2, item b).

### T-16 — for workspace-domain restrictions: OIDC discovery + scopes + UserInfo with `email` and `email_verified`

**Status: resource-server share met (T2-23 Commit A); remainder partially met, on the provider
side (only relevant if workspace-domain restrictions are used).**

Requirement: "Advertise a UserInfo Endpoint that returns the user's `email` claim and
`email_verified: true`." — "the UserInfo Endpoint is required for workspace domain
restrictions."

OIDC discovery returns HTTP 200 and advertises the `openid` and `email` scopes; a
`userinfo_endpoint` exists and rejects a tokenless request with 401 (not 404/500). All measured,
Section 3. That was the provider (AS) half, unchanged since P7.

**Resource-server share BUILT (T2-23 Commit A):** the resource server itself now advertises the
same scope set `S` = `openid`, `email`, `offline_access` in three places — the protected-resource
metadata (`scopes_supported: S`, only with a configured authorization server,
`test/openai-t2-23-scopes.test.js` `OpenAI-T2-23-A1`), the oauth 401 bearer challenge
(`scope="openid email offline_access"`, `OpenAI-T2-23-A3`) and `securitySchemes` on every tool
(`OpenAI-T2-23-A5`, real `tools/list` HTTP wire). A spec-compliant client therefore actually
requests `openid`/`email` now; before (P7) the advertised set was empty (`scopes: []`).

**UNKNOWN:** whether `/oauth2/userinfo` returns the **`email`** claim and **`email_verified:
true`** for a real token cannot be measured without a completed login (2c.2 item c, 2c.3
O-3) — this is the only remaining half, and it sits entirely with the provider. Side finding:
WorkOS does **not** advertise `claims_supported` (absent from both documents). The primary
source does not name that field, so it is not a criterion for T-16 — but the metadata therefore
do not tell us whether `email`/`email_verified` are delivered.

## 2c. English appendix (for the OpenAI reviewer)

Together with Section 2b above, this section makes the English version complete on its own: it
carries the English equivalents of Sections 3-8 (limitation of the probe script and the
"newer measurement wins" rule, the WorkOS questions, the owner-only measurements, the
what-changes-if consequences, the open findings, and the duplicate-path check). Every
limitation and every UNKNOWN is carried over
1:1 from the German text below; nothing here is phrased more optimistically. Section 3 itself
(the raw measurement log) is reproduced verbatim and is deliberately **not** duplicated here —
read it directly below in Section 3. It is mostly endpoint URLs, JSON and the probe script's
`[PASS]`/`[FAIL]`/`[UNKNOWN]` labels, but it is **not** entirely language-neutral: some lines
are German because they are literal output, and translating them would falsify the log. They
are translated in 2c.1 below.

### 2c.1 Probe limitation and "a newer measurement wins" (Section 3)

**Probe limitation:** `scripts/probe-as-faehigkeiten.mjs` evaluates findings 3-8 against only
the **first** discovery document (`openid-configuration`). `code_challenge_methods_supported`,
`registration_endpoint` and `client_id_metadata_document_supported` are advertised by WorkOS
only in the **second** document (`oauth-authorization-server`, see the raw log in Section 3) -
the probe therefore reports FAIL where the provider actually has the field. Not a contradiction
in substance, only a limitation of the measurement tool (outside the scope of this document,
noted here only).

**German literal output in Section 3, translated:**

- `--- userinfo (ohne Token) ---` — section label of the measurement run: "userinfo (without a
  token)". Likewise `--- POST /mcp ohne Token (Live-Gateway) ---`: "POST /mcp without a token
  (live gateway)".
- `error_description="Kein Token"` and `{"error":"Kein Token"}` — the Hermes gateway's own error
  text, sent verbatim by `src/auth.js:95`: "No token".
- `=== Sonde AS-Faehigkeiten (scripts/probe-as-faehigkeiten.mjs) ===` — header of the probe
  script: "Probe: authorization-server capabilities". `Ziel:` = "target".
- `WWW-Authenticate vorhanden -> Modus oauth` — "WWW-Authenticate present -> mode oauth".
- `issuer-Gleichheit` — "issuer equality"; `(fehlt in openid-configuration)` / `(fehlt)` —
  "(missing in openid-configuration)" / "(missing)"; `moeglich` — "possible".
- `=== Ergebnis: PFLICHT 3/4 PASS - Befunde 4 PASS, 2 FAIL, 1 UNKNOWN` — "Result: REQUIRED 3/4
  PASS - findings 4 PASS, 2 FAIL, 1 UNKNOWN".

**A newer measurement wins:** if a future measurement diverges from the log in Section 3, the
newer measurement governs, and this document is updated with the new timestamp - never the
other way round. **Re-run Section 3's probe before every submission.**

### 2c.2 Concrete questions for WorkOS (owner action item; German original: Section 4)

a. **(T-9)** Does AuthKit copy the `resource` parameter (RFC 8707) from the authorization and
   token requests into the issued access token's `aud` claim?
b. **(T-11)** Can AuthKit set `iss` on authorization responses and advertise
   `authorization_response_iss_parameter_supported: true` in its AS metadata?
c. **(T-16)** Does `/oauth2/userinfo`, given a valid token, return `email` and
   `email_verified: true`?
d. **(T-8, side finding OW-7)** Why is `code_challenge_methods_supported` missing from
   `openid-configuration` although it is present in `oauth-authorization-server`? Which of the
   two documents does a connector like ChatGPT typically query first?
e. **(T-12)** Does AuthKit offer resource-specific (not just identity) scopes that we could
   require and check for `/mcp`?

### 2c.3 Owner-only measurements (action item, not run by an agent; German original: Section 5)

**O-3.** Once a real, completed WorkOS login exists (e.g. the production Claude connector
flow): decode the access token (base64, no secret needed for the payload) and check:

1. `aud` - does it match the resource `https://app.sundartha.com/mcp`? (T-9)
2. `scope` / `scp` - is a claim present, and if so, which value? (T-12)
3. `exp` - is the claim present, numeric, in the future relative to `iat`? (T-12, deploy
   precondition OW-B for T2-03: if missing, the `requiredClaims` commit is reverted before
   deploy)
4. `GET /oauth2/userinfo` with the same token - does the response carry `email` and
   `email_verified: true`? (T-16)

**O-6.** (T-14) Link the connector in ChatGPT, let the token become invalid (wait for expiry or
revoke the session at WorkOS), trigger a tool call in the same conversation: does the linking UI
(re-authentication) appear, or only an error message?

These values close the remaining UNKNOWNs in Section 2 / 2b. No agent runs these steps - they
require a completed login (owner-only).

### 2c.4 Open findings, not built, only recorded (German original: Section 7)

- **B-1:** `rejectIfNoTenant` (`src/routes/mcp.js:60-65`) answers a valid token with no tenant
  mapping with **403 without** `WWW-Authenticate`. RFC 6750 §3.1 would suggest
  `error="insufficient_scope"` for a 403; the OpenAI wording (T-13) only requires the challenge
  for 401. The case is resolvable by account switch (signing in with an account that has a
  tenant) and is therefore exactly the case for which a re-auth trigger (T-14) would make sense.
  Whether ChatGPT offers an account switch on this 403 is UNKNOWN. Open item for the owner, not
  changed here.
- **`exp` required since T2-03, scope check since T2-23 Commit B (T-12 fully met in code):**
  `jwtVerify` in `src/auth.js:98-106` sets `requiredClaims: ['exp']`; a signed token without
  `exp` has been rejected since (401), no longer accepted without time limit (`PLAN-SECURITY.md`
  updated accordingly). Since T2-23 Commit B, `verifyOauth` also checks `scope`/`scp` against
  `ENFORCED_OAUTH_SCOPES` (`openid`, `email` — **not** the full advertised `OAUTH_SCOPES`, which
  still includes the grant scope `offline_access`; addendum 2026-09-22, see `PLAN-SECURITY.md`);
  if one of the enforced elements is missing, the server answers 403 `insufficient_scope`. What
  remains open is only the owner confirmation OW-B (a real WorkOS token carries `openid` and
  `email`) before deploy — without it, Commit B is reverted per the plan. `offline_access` is no
  longer part of that confirmation: it was never expected to be enforceable, and now isn't.
- **T-8 (side finding, outside the requirements covered by this document):** `code_challenge_methods_supported` is missing from
  `openid-configuration`, present in `oauth-authorization-server` (Section 3). Our
  `discoverJwksUri()` tries `openid-configuration` first (`src/auth.js:31`) - inconsequential for
  us (we only read `jwks_uri` there), but UNKNOWN for ChatGPT's own discovery order (question d,
  2c.2). Owner item, not built.

### 2c.5 Duplicate paths (completeness check; German original: Section 8)

- **HTTP `/mcp` vs. stdio:** `mcpAuth` is the **only** token-check path - it exists only on the
  HTTP route (`src/routes/mcp.js:126`). stdio (`src/mcp-server.js:35-46`) registers tools without
  the auth middleware and deliberately never calls `applyToolSecuritySchemes`;
  T-9/T-11/T-12/T-14/T-16 are **not applicable** to stdio (no token, no OpenAI connector path
  there) - this is a limitation of scope, not a claim that stdio meets them.
- **mcp-native adapter (since T2-01 the only one, ChatGPT-/Skybridge adapter removed):**
  `mcpAuth` runs **before** renderer selection (`src/routes/mcp.js:126` vs. `:169`) - only one
  renderer exists for every host now, a second auth test per adapter has become moot (it was not
  needed before either, since both adapters shared the same auth code path).

### 2c.6 What changes if ... (German original: Section 6)

- **... WorkOS starts issuing a resource-specific scope:** BUILT (phase T2-23, Commit B,
  `bf05aa2`, enforced/advertised split addendum `91b8085`/current commit) - no switch,
  `verifyOauth()` checks `scope`/`scp` after `jwtVerify` fail-closed for every request, against
  `ENFORCED_OAUTH_SCOPES` (`openid`, `email`), not the full advertised `S`. The repository test
  case that previously asserted an arbitrary `scope` value is accepted (case T4 in
  `test/openai-p7-token-pruefachsen.test.js`) is deliberately rewritten and now pins the opposite
  (missing an enforced element -> 403); a new case (`OpenAI-T2-23-B3`) pins that the enforced set
  *without* `offline_access` is sufficient -> 200. Two outcomes, depending on the still
  outstanding owner result OW-B (deploy precondition, `PLAN-SECURITY.md` section
  "OpenAI-T2-23"): if a real WorkOS token carries `scope`/`scp` with `openid` and `email`, Commit B
  stays live and this section as well as Section 2 (T-12) read "fully met in code" — `offline_access`
  is irrelevant to that outcome now. If `openid`/`email` are missing, ONLY Commit B is reverted
  before deploy (rollback = reverting this commit, not a feature switch) - T-12 then falls back to
  "partially met" and this section as well as Section 2 must be updated to match.
- **... WorkOS does not copy `resource` into `aud`:** every ChatGPT login fails with 401 on
  submission day. That is a connectivity failure, not a security failure - the audience check is
  **not** weakened to work around it.
- **... O-6 shows that ChatGPT offers no re-linking for the in-conversation transport 401:**
  then a token expiring mid-conversation has no user-facing path; a tool error result carrying
  `_meta["mcp/www_authenticate"]` (for token expiry and B-1) becomes an owner decision on the
  live auth path (T-14).
- **... production no longer runs `MCP_AUTH=oauth`:** the transport 401 no longer points at the
  protected-resource metadata (`STATIC_BEARER_CHALLENGE`, `src/auth.js:89`); ChatGPT finds no
  OAuth entry point via the header. Whether the transport path even covers T-14 is UNKNOWN
  regardless (O-6).

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
Grenze des Messwerkzeugs (ausserhalb des Umfangs dieses Dokuments, hier nur vermerkt).

**Neue Messung gewinnt:** weicht eine kuenftige Messung von diesem Protokoll ab, gilt die neue
Messung, und dieses Dokument wird mit dem neuen Zeitstempel aktualisiert — nicht umgekehrt.
**Vor jeder Einreichung Schritt 1 (dieses Messprotokoll) erneut fahren.**

## 4. Konkrete Fragen an WorkOS (Owner-Handlungsauftrag)

a. **(T-9)** Kopiert AuthKit den `resource`-Parameter (RFC 8707) aus Authorization- und
   Token-Request in den `aud`-Claim des ausgestellten Access-Tokens?
b. **(T-11)** Kann AuthKit `iss` in Authorization-Responses setzen und
   `authorization_response_iss_parameter_supported: true` in der AS-Metadata bewerben?
c. **(T-16)** Liefert `/oauth2/userinfo` mit einem gueltigen Token `email` und
   `email_verified: true`?
d. **(T-8, Nebenbefund OW-7)** Warum fehlt `code_challenge_methods_supported` in
   `openid-configuration`, obwohl es in `oauth-authorization-server` steht? Welches der beiden
   Dokumente fragt ein Connector wie ChatGPT typischerweise zuerst ab?
e. **(T-12)** Gibt es bei AuthKit ressourcenspezifische (nicht nur Identitaets-) Scopes, die wir
   fuer `/mcp` verlangen und pruefen koennten?

## 5. Owner-Messungen (Handlungsanweisung, nicht von einem Agenten gefahren)

**O-3.** Sobald ein echter, abgeschlossener WorkOS-Login vorliegt (z. B. der produktive
Claude-Connector-Flow): das Access-Token dekodieren (Base64, kein Secret noetig fuer die
Payload) und pruefen:

1. `aud` — entspricht sie der Resource `https://app.sundartha.com/mcp`? (T-9)
2. `scope` / `scp` — ist ein Claim vorhanden, und wenn ja, welcher Wert? (T-12)
3. `exp` — ist der Claim vorhanden, numerisch, in der Zukunft relativ zu `iat`? (T-12,
   Deploy-Vorbedingung OW-B fuer T2-03: fehlt er, wird der `requiredClaims`-Commit vor dem
   Deploy zurueckgenommen)
4. `GET /oauth2/userinfo` mit demselben Token — liefert die Antwort `email` und
   `email_verified: true`? (T-16)

**O-6.** (T-14) Connector in ChatGPT verknuepfen, das Token ungueltig werden lassen (Ablauf
abwarten oder Sitzung bei WorkOS widerrufen), im selben Gespraech einen Tool-Aufruf ausloesen:
erscheint die Verknuepfungs-UI (Neu-Anmeldung) oder nur eine Fehlermeldung?

Diese Werte schliessen die UNKNOWN-Reste in Abschnitt 2. Kein Agent fuehrt diese Schritte aus —
sie verlangen einen abgeschlossenen Login (Owner-Only).

## 6. Was sich aendert, wenn …

- **… WorkOS einen ressourcenspezifischen Scope ausstellt:** GEBAUT (Phase T2-23, Commit B,
  `bf05aa2`) — kein Schalter, `verifyOauth()` prueft `scope`/`scp` nach `jwtVerify` fail-closed
  fuer jeden Request. Der Repo-Testfall, der zuvor die Annahme eines beliebigen `scope`-Werts
  belegte (Fall T4 in `test/openai-p7-token-pruefachsen.test.js`), ist bewusst umgeschrieben und
  pinnt jetzt das Gegenteil (unvollstaendiger Scope -> 403). Zwei Ausgaenge, je nach dem noch
  ausstehenden Owner-Ergebnis OW-B (Deploy-Vorbedingung, `PLAN-SECURITY.md` Abschnitt
  "OpenAI-T2-23"): traegt ein echtes WorkOS-Token `scope`/`scp` mit allen drei Werten aus `S`,
  bleibt Commit B scharf und dieser Abschnitt sowie Abschnitt 2 (T-12) gelten als "code-seitig
  vollstaendig erfuellt". Fehlt das, wird NUR Commit B vor dem Deploy zurueckgenommen (Rueckweg =
  Revert dieses Commits, kein Feature-Schalter) — dann faellt T-12 wieder auf "teilweise erfuellt"
  zurueck und dieser Abschnitt sowie Abschnitt 2 sind entsprechend nachzuziehen.
- **… WorkOS `resource` nicht nach `aud` kopiert:** jeder ChatGPT-Login scheitert am
  Einreichungstag mit 401. Das ist ein Verbindungsausfall, kein Sicherheitsausfall — die Audience-
  Pruefung wird dafuer **nicht** aufgeweicht.
- **… O-6 zeigt, dass ChatGPT auf den Transport-401 im Gespraech keine Neu-Verknuepfung
  anbietet:** dann ist der Token-Ablauf mitten im Gespraech ohne Nutzerpfad; ein
  Tool-Fehlerergebnis mit `_meta["mcp/www_authenticate"]` (fuer Token-Ablauf und B-1) wird zur
  Owner-Entscheidung am Live-Auth-Pfad (T-14).
- **… Produktion nicht mehr `MCP_AUTH=oauth` faehrt:** der Transport-401 verweist nicht mehr auf
  die Protected-Resource-Metadata (`STATIC_BEARER_CHALLENGE`, `src/auth.js:89`); ChatGPT findet
  ueber den Header keinen OAuth-Einstieg. Ob der Transport-Pfad T-14 ueberhaupt abdeckt, ist
  unabhaengig davon UNKNOWN (O-6).

## 7. Offene Befunde (nicht gebaut, nur notiert)

- **B-1:** `rejectIfNoTenant` (`src/routes/mcp.js:60-65`) antwortet einem gueltigen Token ohne
  zugeordneten Tenant mit **403 ohne** `WWW-Authenticate`. RFC 6750 §3.1 saehe fuer 403
  `error="insufficient_scope"` vor; der OpenAI-Wortlaut (T-13) verlangt die Challenge nur fuer
  401. Der Fall ist per Kontowechsel loesbar (Anmeldung mit einem Konto mit Tenant) und damit
  genau der Fall, fuer den ein Re-Auth-Ausloeser (T-14) sinnvoll waere. Ob ChatGPT bei diesem 403
  einen Konto-Wechsel anbietet, ist UNKNOWN. Offener Punkt fuer den Owner, hier nicht geaendert.
- **`exp` verlangt seit T2-03, Scope-Pruefung seit T2-23 Commit B (T-12 damit code-seitig
  vollstaendig):** `jwtVerify` in `src/auth.js:98-106` setzt `requiredClaims: ['exp']`; ein
  signiertes Token ohne `exp` wird seither abgelehnt (401), nicht mehr unbefristet angenommen
  (`PLAN-SECURITY.md` entsprechend nachgezogen). Seit T2-23 Commit B prueft `verifyOauth`
  zusaetzlich `scope`/`scp` gegen `OAUTH_SCOPES`; fehlt ein Element, folgt 403
  `insufficient_scope`. Offen bleibt NUR die Owner-Bestaetigung OW-B (echtes WorkOS-Token traegt
  alle drei Scopes) VOR dem Deploy — ohne sie wird Commit B laut Plan zurueckgenommen.
- **T-8 (Nebenbefund, ausserhalb der in diesem Dokument behandelten Anforderungen):** `code_challenge_methods_supported` fehlt in
  `openid-configuration`, steht in `oauth-authorization-server` (Abschnitt 3). Unser
  `discoverJwksUri()` probiert `openid-configuration` zuerst (`src/auth.js:31`) — fuer uns
  folgenlos (wir lesen dort nur `jwks_uri`), fuer ChatGPTs eigene Discovery-Reihenfolge UNKNOWN
  (Frage d, Abschnitt 4). Owner-Punkt, nicht gebaut.

## 8. Doppelte Pfade (Vollstaendigkeits-Check)

- **HTTP `/mcp` vs. stdio:** `mcpAuth` ist der **einzige** Token-Pruefpfad — er existiert nur fuer
  die HTTP-Route (`src/routes/mcp.js:126`). stdio (`src/mcp-server.js:35-46`) registriert Tools
  ohne Auth-Middleware und ruft bewusst kein `applyToolSecuritySchemes` auf;
  T-9/T-11/T-12/T-14/T-16 sind fuer stdio **nicht anwendbar** (kein Token, kein
  OpenAI-Connector-Pfad dort).
- **mcp-nativer Adapter (seit T2-01 der einzige, ChatGPT-/Skybridge-Adapter entfernt):**
  `mcpAuth` laeuft **vor** der Renderer-Wahl (`src/routes/mcp.js:126` vs. `:169`) — es gibt
  seit T2-01 nur noch einen Renderer fuer JEDEN Host, ein zweiter Auth-Test pro Adapter
  ist damit gegenstandslos geworden (er war schon vorher nicht noetig, da beide Adapter
  denselben Auth-Codepfad teilten).

## 9. Nicht doppelt verbucht

T-13 (Bearer-Challenge auf allen 401-Pfaden) und T-5 (dasselbe) sind **P6-Leistung**
(`test/openai-p6-challenge.test.js`); T-15 (`securitySchemes` am echten `tools/list`) ist
**P3-Leistung** (`test/openai-p3-security-schemes.test.js`). Alle drei werden hier nur
referenziert, nicht als P7-Ergebnis gefuehrt.
