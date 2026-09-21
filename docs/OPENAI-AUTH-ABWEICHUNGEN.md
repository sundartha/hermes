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
> Die **englische Fassung (Abschnitt 2b) ist vollstaendig und eigenstaendig**: sie traegt jede
> Einschraenkung und jedes UNKNOWN aus Abschnitt 2. Sie ist nicht optimistischer als der
> deutsche Text; wo beide je auseinanderlaufen, gilt die vorsichtigere Aussage.

## 1. Architektur kurz

Hermes ist ausschliesslich **OAuth-2.1-Resource-Server** fuer `/mcp` (`src/auth.js`), niemals
Authorization Server - es gibt keinen eigenen `/.well-known/oauth-authorization-server` und
keine eigene Login-/Consent-Seite. **WorkOS AuthKit** (`https://fearless-network-26.authkit.app`)
ist der Authorization Server; Hermes vertraut ihm ueber JWKS-Discovery und prueft jedes Bearer-
Token lokal: Signatur, Issuer, Audience; `exp`/`nbf` **nur, wenn der jeweilige Claim im Token
vorhanden ist** (ein signiertes Token ohne `exp` wird unbefristet angenommen, Details T-12).

Die Token-Pruefung sitzt **einmal pro HTTP-Request** in der Middleware `mcpAuth`
(`src/routes/mcp.js:113`), **vor** jedem MCP-Tool-Aufruf; waehrend eines Tool-Aufrufs wird das
Token nicht erneut geprueft. Es gibt aber **zwei weitere Stellen**, an denen ein bereits
authentifizierter Request abgelehnt wird:

- **`rejectIfNoTenant`** (`src/routes/mcp.js:60-65`, aufgerufen `:118`): gueltiges Token, aber
  keine Tenant-Zuordnung -> HTTP 403 **ohne** `WWW-Authenticate`, auditiert als `auth_failed`
  (Befund B-1, Abschnitt 7).
- **Der interne REST-Hop der Tools** (`api()`, `src/mcp-tools.js:60-81`): liefert der Gateway
  dort 403 (z. B. `internalOnly`, `src/wiring/internal-only.js:24-28`, ebenfalls auditiert als
  `auth_failed`), kommt das beim Client als Tool-Ergebnis mit `isError: true` an
  (`wrapHandler`, `src/mcp-tools.js:880-897`). Aufzaehlung der Faelle unter T-14.

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
`src/mcp-security-schemes.js:19-27`, angewandt in `src/routes/mcp.js:162`) und die
Protected-Resource-Metadata (`src/auth.js:141-150`). Die zweite Haelfte fehlt: **kein**
Tool-Ergebnis traegt `_meta["mcp/www_authenticate"]` (`grep -rn www_authenticate src/` liefert
0 Treffer). Nach dem Wortlaut der Primaerquelle zeigt ChatGPT deshalb **keine
tool-bezogene Verknuepfungs-UI**. Das ist eine Luecke, keine Nicht-Anwendbarkeit.

**Was stattdessen passiert.** Die Token-Pruefung laeuft als Express-Middleware vor
`POST /mcp` (`src/routes/mcp.js:113`), bevor irgendein MCP-Handler erreicht wird. Ein Token,
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
   `wrapHandler`, `src/mcp-tools.js:880-897`). Quellen eines 403 dort:
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
HTTP-Antwort) — Owner-Entscheidung, nicht Teil dieser Dokumentationsphase.

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

**Status: teilweise erfuellt.**

**Anforderung (Primaerquelle, woertlich):** "verify the token's signature and `iss`." — "Deny
tokens that have expired or have not yet become valid (`exp`/`nbf`)." — "Confirm the token was
minted for your server (`aud` or the `resource` claim) and contains the scopes you marked as
required."

Geprueft wird in `verifyOauth()` (`src/auth.js:91-113`) in einem einzigen `jwtVerify`-Aufruf
(`:98-102`): Signatur gegen den per JWKS-Discovery gefundenen Schluessel, `issuer` gegen
`config.auth.oauthIssuerUrl`, `audience` gegen die kanonische Resource, `clockTolerance: 30`
Sekunden.

**Einschraenkung `exp`/`nbf`:** `jose` (6.2.3) prueft `nbf` und `exp` **nur, wenn der Claim
vorhanden ist** (`node_modules/jose/dist/webapi/lib/jwt_claims_set.js:142` und `:150`,
`if (payload.exp !== undefined)`). `src/auth.js:98-102` setzt **kein** `requiredClaims`. Folge:
ein vom Anbieter signiertes Token **ohne `exp`** wird **unbefristet** angenommen, eines ohne
`nbf` ohne Gueltigkeitsbeginn. Ob echte WorkOS-Access-Tokens `exp` tragen, ist am echten Token
nicht gemessen (Abschnitt 5, O-3); der Code verlangt es jedenfalls nicht. Offener
Haertungspunkt (`requiredClaims: ['exp']`) in `PLAN-SECURITY.md`, nicht in dieser Phase
geaendert. Belegt ist nur: ein Token **mit** abgelaufenem `exp` -> 401
(`test/oauth.test.js:66-70`, prueft den Status).

Am echten `tools/list`-Response belegt (**neu, diese Phase**,
`test/openai-p7-token-pruefachsen.test.js`):

- `OpenAI-P7-T1`: Token mit fremdem `iss` (bei sonst gueltiger Signatur) -> **401** + Bearer-
  Challenge mit `resource_metadata`, kein `jsonrpc`-Feld im Body.
- `OpenAI-P7-T2`: Token mit `nbf` 3600 Sekunden in der Zukunft (weit jenseits der 30s
  `clockTolerance`) -> **401**.
- `OpenAI-P7-T3` (Positiv-Kontrolle): gueltiges Token **ohne** `scope`-Claim -> **200**. Belegt,
  dass das Gate nicht pauschal alles ablehnt.
- `OpenAI-P7-T4`: gueltiges Token mit einem **beliebigen** `scope`-Claim (`"nicht-vergeben"`) ->
  ebenfalls **200**. Belegt die Luecke: der Scope-Wert wird weder verlangt noch ausgewertet.

Eigene Policy (jenseits des Tokens) existiert: Tenant-Bindung ueber `sub`; ein gueltiges Token
ohne zugeordneten Tenant erhaelt 403 (`rejectIfNoTenant`, `src/routes/mcp.js:60-65`, belegt in
`test/e4-mandantentrennung-default.test.js:210-220`, ID E4-17 — dort bereits erfuellt, hier nur
referenziert). Diese 403 traegt keine Challenge (B-1).

**Scope wird NICHT geprueft** — 0 Codestellen (`grep -rn "scope\|scp" src/auth.js` liefert keinen
Treffer). Konsistent mit der deklarierten Security-Scheme: `securitySchemes = [{type:"oauth2",
scopes: []}]` (`src/mcp-security-schemes.js:19-27`) — wir markieren keinen Scope als
erforderlich. Das erfuellt den Wortlaut nur formal; eine fachliche Scope-Pruefung fehlt.

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (e)):** WorkOS bewirbt nur die Identitaets-Scopes
`email`, `offline_access`, `openid`, `profile` (Abschnitt 3) — keinen ressourcenspezifischen
Scope. Ob ein echtes WorkOS-Access-Token ueberhaupt einen `scope`- oder `scp`-Claim traegt (und
mit welchem Wert), ist ohne einen abgeschlossenen Login nicht messbar. Die Luecke schliesst sich
nur, wenn (1) WorkOS einen ressourcenspezifischen Scope anbietet **und** (2) ein echtes Token ihn
nachweislich traegt — beides offen.

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

**Status: teilweise erfuellt, beim Anbieter (nur relevant, falls Workspace-Domain-Restriktionen
genutzt werden sollen).**

**Anforderung (Primaerquelle, woertlich):** "Advertise a UserInfo Endpoint that returns the
user's `email` claim and `email_verified: true`." — "the UserInfo Endpoint is required for
workspace domain restrictions."

OIDC-Discovery antwortet HTTP 200 (`openid-configuration`, Abschnitt 3); `scopes_supported`
enthaelt `openid` und `email`; ein `userinfo_endpoint` existiert und antwortet ohne Token
mit 401 (kein 404, kein 500 — der Endpunkt existiert und verlangt ein Token).

**Rest (UNKNOWN, Owner O-3 / WorkOS-Frage (c)):** ob `/oauth2/userinfo` mit einem echten Token
das Feld **`email`** und **`email_verified: true`** liefert, ist ohne Login nicht messbar.
**Nebenbefund:** `claims_supported` fehlt in beiden WorkOS-Dokumenten. Die Primaerquelle nennt
das Feld nicht (kein Pruefkriterium fuer T-16) — aber damit ist auch aus den Metadaten nicht
ablesbar, ob `email`/`email_verified` geliefert werden.

## 2b. English version (per ID, for the OpenAI reviewer)

This section is complete on its own: it carries every limitation and every UNKNOWN from
Section 2 and is not more optimistic than the German text. Requirement quotes are verbatim
from the OpenAI primary sources, read on 2026-09-21:
https://developers.openai.com/plugins/build/auth and
https://developers.openai.com/plugins/reference. File:line references point into this
repository. "Section 3" is the raw measurement log below; "Section 4" lists our open questions
to WorkOS; "Section 5" lists measurements that need a real, completed login.

**Architecture.** Hermes is an OAuth 2.1 resource server for `/mcp` only; WorkOS AuthKit
(`https://fearless-network-26.authkit.app`) is the authorization server. Every bearer token is
verified locally once per HTTP request in the `mcpAuth` middleware (`src/routes/mcp.js:113`),
before any MCP tool runs: signature (JWKS), issuer, audience; `exp`/`nbf` **only if the claim is
present** (see T-12). The token is not re-checked during a tool call. Two further places can
reject an already-authenticated request: `rejectIfNoTenant` (`src/routes/mcp.js:60-65`, called
at `:118`) returns HTTP 403 **without** a `WWW-Authenticate` challenge for a valid token that
maps to no tenant (logged as `auth_failed`); and the tools' internal REST hop (`api()`,
`src/mcp-tools.js:60-81`) can receive a 403, which reaches the client as a tool result with
`isError: true` (`src/mcp-tools.js:880-897`).

### T-14 — in-conversation auth UI only via an error result carrying `_meta["mcp/www_authenticate"]`

**Status: deliberately not met. Whether the transport-level 401 path substitutes for it:
UNKNOWN.**

Requirement: "`_meta["mcp/www_authenticate"]` — Error result — RFC 7235 WWW-Authenticate
challenges to trigger OAuth." (plugins/reference); "Triggering the tool-level OAuth flow
requires both metadata (`securitySchemes` and the resource metadata document) **and** runtime
errors that carry `_meta["mcp/www_authenticate"]`. [...] Without both halves ChatGPT will not
show the linking UI for that tool." (plugins/build/auth)

What we have: the first half — `securitySchemes` on every tool
(`src/mcp-security-schemes.js:19-27`, applied in `src/routes/mcp.js:162`) and protected-resource
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
appears (Section 5, O-6).

Cases that today carry no `_meta` field:

1. **Valid token, no tenant** (`rejectIfNoTenant`): HTTP 403 without a challenge, at the HTTP
   layer (not even a tool result). This case **can be resolved by re-authenticating** with an
   account that has a tenant, so a re-auth trigger here would **not** be dead code. Open
   finding (Section 7, B-1).
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
part of this documentation phase.

Condition: the transport 401 carries `resource_metadata` only while production runs
`MCP_AUTH=oauth`; in the static-token/legacy mode the 401 carries `Bearer error="invalid_token"`
without `resource_metadata` (`src/auth.js:89`). Verify before every submission:
`curl -sS -D - -o /dev/null -X POST https://app.sundartha.com/mcp` must contain a
`www-authenticate: Bearer resource_metadata="https://app.sundartha.com/...` line. Measured live
2026-09-21T10:06:03Z: it does (Section 3).

### T-12 — token check: signature/JWKS, `iss`, `exp`/`nbf`, audience, scopes, own policy

**Status: partially met.**

Requirement: "verify the token's signature and `iss`." — "Deny tokens that have expired or have
not yet become valid (`exp`/`nbf`)." — "Confirm the token was minted for your server (`aud` or
the `resource` claim) and contains the scopes you marked as required."

`verifyOauth()` (`src/auth.js:91-113`) checks, in one `jwtVerify` call (`:98-102`), signature
against the JWKS-discovered key, issuer and audience, with a 30-second clock tolerance.

**Limitation on `exp`/`nbf`:** the `jose` library (6.2.3) checks `nbf` and `exp` **only when the
claim is present** (`jwt_claims_set.js:142` and `:150`), and `src/auth.js:98-102` sets no
`requiredClaims`. A token signed by the provider **without `exp` would be accepted without time
limit**; one without `nbf` has no start of validity. Whether real WorkOS access tokens carry
`exp` has not been measured on a real token (Section 5, O-3); our code does not require it.
Hardening (`requiredClaims: ['exp']`) is recorded as an open item and not changed in this phase.
What is proven: a token **with** an expired `exp` -> 401 (`test/oauth.test.js:66-70`).

Proven end-to-end against the real `tools/list` HTTP response
(`test/openai-p7-token-pruefachsen.test.js`): T1 foreign issuer -> 401 with a
`resource_metadata` challenge and no JSON-RPC body; T2 `nbf` one hour in the future -> 401;
T3 (positive control) valid token without a `scope` claim -> 200; T4 valid token with an
arbitrary `scope` value -> also 200.

Own policy beyond the token: tenant binding via `sub`; a valid token without a tenant gets 403
(`src/routes/mcp.js:60-65`, `test/e4-mandantentrennung-default.test.js:210-220`), without a
challenge (see T-14, case 1).

**Scope is not checked** — zero occurrences of `scope`/`scp` in `src/auth.js`. `securitySchemes`
declares an empty scope list to match (`src/mcp-security-schemes.js:19-27`), i.e. we mark no
scope as required. That satisfies the wording only formally; there is no functional scope check.

**UNKNOWN:** WorkOS advertises only identity scopes (`email`, `offline_access`, `openid`,
`profile`; Section 3), no resource-specific scope. Whether a real WorkOS access token carries a
`scope` or `scp` claim at all, and with which value, cannot be measured without a completed
login (Section 5, O-3). The gap can only close if (1) WorkOS offers a resource-specific scope
(Section 4e) **and** (2) a real token is shown to carry it — both open.

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
be checked on a real token (Section 4a, Section 5 O-3). If it does not: every ChatGPT login fails
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
(Section 4b).

### T-16 — for workspace-domain restrictions: OIDC discovery + scopes + UserInfo with `email` and `email_verified`

**Status: partially met, on the provider side (only relevant if workspace-domain restrictions
are used).**

Requirement: "Advertise a UserInfo Endpoint that returns the user's `email` claim and
`email_verified: true`." — "the UserInfo Endpoint is required for workspace domain
restrictions."

OIDC discovery returns HTTP 200 and advertises the `openid` and `email` scopes; a
`userinfo_endpoint` exists and rejects a tokenless request with 401 (not 404/500). All measured,
Section 3.

**UNKNOWN:** whether `/oauth2/userinfo` returns the **`email`** claim and **`email_verified:
true`** for a real token cannot be measured without a completed login (Section 4c, Section 5
O-3). Side finding: WorkOS does **not** advertise `claims_supported` (absent from both
documents). The primary source does not name that field, so it is not a criterion for T-16 — but
the metadata therefore do not tell us whether `email`/`email_verified` are delivered.

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
3. `exp` — ist der Claim vorhanden? (T-12, `exp`-Einschraenkung)
4. `GET /oauth2/userinfo` mit demselben Token — liefert die Antwort `email` und
   `email_verified: true`? (T-16)

**O-6.** (T-14) Connector in ChatGPT verknuepfen, das Token ungueltig werden lassen (Ablauf
abwarten oder Sitzung bei WorkOS widerrufen), im selben Gespraech einen Tool-Aufruf ausloesen:
erscheint die Verknuepfungs-UI (Neu-Anmeldung) oder nur eine Fehlermeldung?

Diese Werte schliessen die UNKNOWN-Reste in Abschnitt 2. Kein Agent fuehrt diese Schritte aus —
sie verlangen einen abgeschlossenen Login (Owner-Only).

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
  einen Konto-Wechsel anbietet, ist UNKNOWN. Befund fuer P10/Owner, hier nicht geaendert.
- **`exp` nicht verlangt (T-12):** `jwtVerify` in `src/auth.js:98-102` setzt kein
  `requiredClaims`; ein signiertes Token ohne `exp` wird unbefristet angenommen. Haertung
  `requiredClaims: ['exp']` ist in `PLAN-SECURITY.md` als offener Punkt eingetragen (Owner-
  Freigabe, eigene Phase), hier nicht geaendert.
- **T-8 (Nebenbefund, nicht P7-Vorrat):** `code_challenge_methods_supported` fehlt in
  `openid-configuration`, steht in `oauth-authorization-server` (Abschnitt 3). Unser
  `discoverJwksUri()` probiert `openid-configuration` zuerst (`src/auth.js:31`) — fuer uns
  folgenlos (wir lesen dort nur `jwks_uri`), fuer ChatGPTs eigene Discovery-Reihenfolge UNKNOWN
  (Frage d, Abschnitt 4). Owner-Punkt, nicht gebaut.

## 8. Doppelte Pfade (Vollstaendigkeits-Check)

- **HTTP `/mcp` vs. stdio:** `mcpAuth` ist der **einzige** Token-Pruefpfad — er existiert nur fuer
  die HTTP-Route (`src/routes/mcp.js:113`). stdio (`src/mcp-server.js:35-46`) registriert Tools
  ohne Auth-Middleware und ruft bewusst kein `applyToolSecuritySchemes` auf;
  T-9/T-11/T-12/T-14/T-16 sind fuer stdio **nicht anwendbar** (kein Token, kein
  OpenAI-Connector-Pfad dort).
- **mcp-nativer Adapter vs. ChatGPT-Adapter (beide ueber HTTP):** `mcpAuth` laeuft **vor** der
  Adapterwahl (`src/routes/mcp.js:113` vs. `:153`) — beide Adapter teilen denselben
  Auth-Codepfad, ein zweiter Test pro Adapter ist nicht noetig und wurde nicht gebaut.

## 9. Nicht doppelt verbucht

T-13 (Bearer-Challenge auf allen 401-Pfaden) und T-5 (dasselbe) sind **P6-Leistung**
(`test/openai-p6-challenge.test.js`); T-15 (`securitySchemes` am echten `tools/list`) ist
**P3-Leistung** (`test/openai-p3-security-schemes.test.js`). Alle drei werden hier nur
referenziert, nicht als P7-Ergebnis gefuehrt.
