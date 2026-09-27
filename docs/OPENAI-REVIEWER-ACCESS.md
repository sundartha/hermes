# Hermes: reviewer access / Reviewer-Zugang

The English part is the version for the OpenAI review. The German part below has the same
content; no restriction or caveat is missing from either version. Every statement about Hermes
names the code location it rests on (`file:line`, listed again in the machine-readable anchor
block at the end). Statements about the sign-in provider are operator commitments, not code
facts, and are marked as such.

## English

### 1. What OpenAI requires

> "When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected."
> Source: https://developers.openai.com/plugins/app-guidelines

> "For servers requiring authentication, our review team must be able to log into a demo account with no further configuration required."
> Source: https://developers.openai.com/plugins/deploy/app-review

> "Ensure that the provided URL and credentials are correct, do not feature MFA (including requiring SMS codes, login through systems that require SMS, email or other verification schemes)."
> Source: https://developers.openai.com/plugins/deploy/app-review

> "Ensure that the provided credentials can be used to log in successfully (test them outside any company networks, local area networks, or other internal networks)."
> Source: https://developers.openai.com/plugins/deploy/app-review

> "Confirm that the credentials have not expired."
> Source: https://developers.openai.com/plugins/deploy/app-review

> "Test account or fixture data required to reproduce it."
> Source: https://developers.openai.com/plugins/deploy/submission

> "Use test cases that reviewers can run without internal context. If your plugin requires authentication, make sure the provided demo credentials can complete each test without MFA, SMS, email confirmation, or private-network access."
> Source: https://developers.openai.com/plugins/deploy/submission

> "Reviewer credentials work without MFA, email confirmation, SMS confirmation, or private-network access."
> Source: https://developers.openai.com/plugins/deploy/submission

> "Reviewer-ready demo credentials when the server uses OAuth."
> Source: https://developers.openai.com/plugins/deploy/submission-errors

### 2. Credentials

| Field | Value |
|---|---|
| Email | `<REVIEWER_EMAIL>` |
| Password | `<REVIEWER_PASSWORD>` |
| MCP server URL | `<MCP_SERVER_URL>` |
| Test target number | `<TEST_TARGET_NUMBER>` |

The values are entered in the submission form, not in this document.

### 3. Login path

Hermes authenticates the MCP connection with OAuth only. The sign-in page, the password check,
MFA and email verification belong to the external authorization server (identity provider), not
to Hermes; Hermes itself has no password login and no MFA step for this path.

1. Add the connector with `<MCP_SERVER_URL>`. A request without a token is answered with HTTP 401
   and a `WWW-Authenticate` challenge (src/auth.js:247, src/auth.js:122).
2. The client reads the protected resource metadata at `/.well-known/oauth-protected-resource`
   (src/auth.js:384). It names the authorization server in `authorization_servers`
   (src/auth.js:376) and the scopes `openid email offline_access` (src/auth.js:61).
3. Sign in at that authorization server with `<REVIEWER_EMAIL>` and `<REVIEWER_PASSWORD>`.
   Operator commitment, not a code fact: the operator has set up this account at the provider
   with a verified email address and without MFA, and has tested the sign-in from outside any
   company network.
4. The client sends the issued access token. Hermes checks signature, issuer, audience, the
   required expiry claim and the required scopes (src/auth.js:259), then takes the account
   identity from the `sub` claim (src/auth.js:284).
5. Hermes looks up the existing Hermes account for that identity (src/routes/_tenant.js:162,
   src/store/state-ops.js:5306). The account is connected; no further step follows. Operator
   commitment, not a code fact: the identity in the access token is the same as for the web
   sign-up of the reviewer account; the operator checks this with exactly these credentials
   before submission.

### 4. What happens on first connection

- Operator commitment: the reviewer account already exists and is active with a paid
  subscription and payment-card verification. The operator created it once, with an email address
  not linked to any other Hermes account, through the regular Hermes web sign-up (the web
  login creates an account only for a verified email address, src/web-auth.js:365,
  src/web-auth.js:613; a new account starts suspended, src/web-auth.js:540) and then took out a
  regular subscription. Only the paid activation sets the verification level and requests a
  phone number (src/billing/activation.js:88, src/billing/activation.js:106).
- Connecting through ChatGPT only reads: the lookup in step 5 never creates an account and never
  requests a phone number (src/routes/_tenant.js:162, src/store/state-ops.js:5306).
- If no Hermes account matched the identity, every tool call would return the error "No Hermes
  account is linked to this login" with a sign-in challenge (src/routes/mcp.js:211,
  src/mcp-no-tenant.js:32). This is not expected for the reviewer account, because the operator
  checks the connection with exactly these credentials before submission.

### 5. Sample data

The account contains three finished incoming example calls and their open action items. The
tool `list_calls` shows the calls with summary (src/mcp-tools.js:2003); the tool
`list_action_items` shows the open items (src/mcp-tools.js:2059).

<!-- SEED-EN-BEGIN -->
- Incoming call from +12025550142: A caller from a dental practice asked to move a check-up appointment from Tuesday to Thursday afternoon.
  - Action item: Confirm the new dental check-up time for Thursday afternoon.
- Incoming call from +12025550187: A bike repair shop called to say the repair is finished and the bike can be picked up until 6 pm.
  - Action item: Pick up the bike from the repair shop before 6 pm.
- Incoming call from +12025550163: A neighbor called about the shared garden cleanup on Saturday morning and asked whether you can join.
  - Action item: Reply to the neighbor about joining the garden cleanup on Saturday.
  - Action item: Bring gardening gloves to the cleanup.
<!-- SEED-EN-END -->

The caller numbers are fictional (reserved example range +1 202 555 0100 to 0199). Please do not
call them.

### 6. Same safeguards as every customer

The reviewer account has no exception from any safeguard; it is a regular customer account.
Operator commitment: no administrator override is set for this account. Every outgoing call passes the same server-side checks as for every customer:

- a global emergency stop for all outgoing calls (src/telephony/outbound-gates.js:699);
- an active subscription and payment-card verification (src/telephony/outbound-gates.js:421,
  src/telephony/outbound-gates.js:438);
- a limit of calls per hour and a limit of repeated calls to the same number
  (src/telephony/outbound-gates.js:390, src/telephony/outbound-gates.js:401);
- a denylist and a country check for the destination (src/telephony/outbound-gates.js:522,
  src/telephony/outbound-gates.js:530);
- a per-account cost limit (src/telephony/outbound-gates.js:578);
- a maximum call duration (src/telephony/outbound-gates.js:961).

A call is only placed after the user confirms it: `prepare_call` returns a confirmation card
(src/mcp-tools.js:1617), and `place_call` without the confirmation code from that card places no
call (src/mcp-tools.js:1705).

### 7. Test calls

Please place test calls only to `<TEST_TARGET_NUMBER>`. Hermes does not technically restrict the
reviewer account to this number; only the safeguards in section 6 apply, exactly as for every
customer. Calls to other numbers reach real people.

### 8. Expiry

The example calls follow the regular retention period for finished calls
(src/store/state-ops.js:5125) and disappear after it. The operator refreshes them shortly before
submission and again during a long review, and keeps the subscription of the reviewer account
active so the credentials do not expire.

## Deutsch

### 1. Was OpenAI verlangt

Die Anforderungen im englischen Original, woertlich:

> "When submitting a plugin with an authenticated MCP server, provide a login and password for a fully featured demo account that includes sample data. Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected."
> Quelle: https://developers.openai.com/plugins/app-guidelines

> "For servers requiring authentication, our review team must be able to log into a demo account with no further configuration required."
> Quelle: https://developers.openai.com/plugins/deploy/app-review

> "Ensure that the provided URL and credentials are correct, do not feature MFA (including requiring SMS codes, login through systems that require SMS, email or other verification schemes)."
> Quelle: https://developers.openai.com/plugins/deploy/app-review

> "Ensure that the provided credentials can be used to log in successfully (test them outside any company networks, local area networks, or other internal networks)."
> Quelle: https://developers.openai.com/plugins/deploy/app-review

> "Confirm that the credentials have not expired."
> Quelle: https://developers.openai.com/plugins/deploy/app-review

> "Test account or fixture data required to reproduce it."
> Quelle: https://developers.openai.com/plugins/deploy/submission

> "Use test cases that reviewers can run without internal context. If your plugin requires authentication, make sure the provided demo credentials can complete each test without MFA, SMS, email confirmation, or private-network access."
> Quelle: https://developers.openai.com/plugins/deploy/submission

> "Reviewer credentials work without MFA, email confirmation, SMS confirmation, or private-network access."
> Quelle: https://developers.openai.com/plugins/deploy/submission

> "Reviewer-ready demo credentials when the server uses OAuth."
> Quelle: https://developers.openai.com/plugins/deploy/submission-errors

### 2. Zugangsdaten

| Feld | Wert |
|---|---|
| E-Mail | `<REVIEWER_EMAIL>` |
| Passwort | `<REVIEWER_PASSWORD>` |
| MCP-Server-URL | `<MCP_SERVER_URL>` |
| Test-Zielnummer | `<TEST_TARGET_NUMBER>` |

Die Werte stehen im Einreichungsformular, nicht in diesem Dokument.

### 3. Login-Pfad

Hermes authentifiziert die MCP-Verbindung ausschliesslich ueber OAuth. Anmeldemaske,
Passwortpruefung, MFA und E-Mail-Bestaetigung gehoeren zum externen Autorisierungsserver
(Identitaetsanbieter), nicht zu Hermes; Hermes selbst hat auf diesem Weg keinen Passwort-Login
und keinen MFA-Schritt.

1. Den Connector mit `<MCP_SERVER_URL>` hinzufuegen. Eine Anfrage ohne Token beantwortet Hermes
   mit HTTP 401 und einer `WWW-Authenticate`-Challenge (src/auth.js:247, src/auth.js:122).
2. Der Client liest die Protected Resource Metadata unter `/.well-known/oauth-protected-resource`
   (src/auth.js:384). Sie nennen den Autorisierungsserver in `authorization_servers`
   (src/auth.js:376) und die Scopes `openid email offline_access` (src/auth.js:61).
3. Beim Autorisierungsserver mit `<REVIEWER_EMAIL>` und `<REVIEWER_PASSWORD>` anmelden.
   Zusage des Betreibers, keine Code-Tatsache: der Betreiber hat dieses Konto beim Anbieter mit
   verifizierter E-Mail-Adresse und ohne MFA eingerichtet und die Anmeldung von ausserhalb jedes
   Firmennetzes geprueft.
4. Der Client sendet das ausgestellte Access-Token. Hermes prueft Signatur, Aussteller,
   Zielgruppe, den Pflicht-Ablaufclaim und die Pflicht-Scopes (src/auth.js:259) und entnimmt die
   Kontoidentitaet dem `sub`-Claim (src/auth.js:284).
5. Hermes sucht das bestehende Hermes-Konto zu dieser Identitaet (src/routes/_tenant.js:162,
   src/store/state-ops.js:5306). Das Konto ist verbunden; es folgt kein weiterer Schritt. Zusage
   des Betreibers, keine Code-Tatsache: die Identitaet im Access-Token ist dieselbe wie bei der
   Web-Anmeldung des Reviewer-Kontos; der Betreiber prueft das vor der Einreichung mit genau
   diesen Zugangsdaten.

### 4. Was bei der ersten Verbindung passiert

- Zusage des Betreibers: das Reviewer-Konto existiert bereits und ist mit bezahltem Abo und
  Kartenverifikation aktiv. Der Betreiber hat es einmal, mit einer E-Mail-Adresse, die keinem
  anderen Hermes-Konto zugeordnet ist, ueber die regulaere Hermes-Web-Anmeldung angelegt (der Web-Login
  legt ein Konto nur fuer eine verifizierte E-Mail-Adresse an, src/web-auth.js:365,
  src/web-auth.js:613; ein neues Konto startet gesperrt, src/web-auth.js:540) und danach ein
  regulaeres Abo abgeschlossen. Erst die bezahlte Aktivierung setzt die Verifikationsstufe und
  fordert eine Telefonnummer an (src/billing/activation.js:88, src/billing/activation.js:106).
- Die Verbindung ueber ChatGPT liest nur: die Suche aus Schritt 5 legt nie ein Konto an und
  fordert nie eine Telefonnummer an (src/routes/_tenant.js:162, src/store/state-ops.js:5306).
- Passte kein Hermes-Konto zur Identitaet, lieferte jeder Werkzeugaufruf den Fehler "No Hermes
  account is linked to this login" mit einer Anmelde-Challenge (src/routes/mcp.js:211,
  src/mcp-no-tenant.js:32). Beim Reviewer-Konto ist das nicht zu erwarten, weil der Betreiber
  die Verbindung vor der Einreichung mit genau diesen Zugangsdaten prueft.

### 5. Beispieldaten

Das Konto enthaelt drei beendete eingehende Beispielanrufe und ihre offenen Action Items. Das
Werkzeug `list_calls` zeigt die Anrufe mit Zusammenfassung (src/mcp-tools.js:2003); das Werkzeug
`list_action_items` zeigt die offenen Eintraege (src/mcp-tools.js:2059). Die Texte sind
englisch, so wie sie im Konto stehen:

<!-- SEED-DE-BEGIN -->
- Eingehender Anruf von +12025550142: A caller from a dental practice asked to move a check-up appointment from Tuesday to Thursday afternoon.
  - Action Item: Confirm the new dental check-up time for Thursday afternoon.
- Eingehender Anruf von +12025550187: A bike repair shop called to say the repair is finished and the bike can be picked up until 6 pm.
  - Action Item: Pick up the bike from the repair shop before 6 pm.
- Eingehender Anruf von +12025550163: A neighbor called about the shared garden cleanup on Saturday morning and asked whether you can join.
  - Action Item: Reply to the neighbor about joining the garden cleanup on Saturday.
  - Action Item: Bring gardening gloves to the cleanup.
<!-- SEED-DE-END -->

Die Anrufer-Nummern sind fiktiv (reservierter Beispielbereich +1 202 555 0100 bis 0199). Bitte
nicht anrufen.

### 6. Dieselben Sicherungen wie fuer jeden Kunden

Das Reviewer-Konto hat keine Ausnahme von irgendeiner Sicherung; es ist ein regulaeres
Kundenkonto. Zusage des Betreibers: fuer dieses Konto ist keine Administrator-Ausnahme gesetzt.
Jeder ausgehende Anruf durchlaeuft dieselben serverseitigen Pruefungen wie bei
jedem Kunden:

- ein globaler Notaus fuer alle ausgehenden Anrufe (src/telephony/outbound-gates.js:699);
- ein aktives Abo und eine Kartenverifikation (src/telephony/outbound-gates.js:421,
  src/telephony/outbound-gates.js:438);
- ein Limit fuer Anrufe pro Stunde und ein Limit fuer wiederholte Anrufe an dieselbe Nummer
  (src/telephony/outbound-gates.js:390, src/telephony/outbound-gates.js:401);
- eine Sperrliste und eine Laenderpruefung fuer das Ziel (src/telephony/outbound-gates.js:522,
  src/telephony/outbound-gates.js:530);
- eine Kostendecke je Konto (src/telephony/outbound-gates.js:578);
- eine maximale Gespraechsdauer (src/telephony/outbound-gates.js:961).

Ein Anruf wird nur gewaehlt, nachdem der Nutzer ihn bestaetigt hat: `prepare_call` liefert eine
Bestaetigungskarte (src/mcp-tools.js:1617), und `place_call` ohne den Bestaetigungscode aus dieser
Karte waehlt nicht (src/mcp-tools.js:1705).

### 7. Testanrufe

Testanrufe bitte nur an `<TEST_TARGET_NUMBER>`. Hermes beschraenkt das Reviewer-Konto technisch
nicht auf diese Nummer; es gelten nur die Sicherungen aus Abschnitt 6, genau wie fuer jeden
Kunden. Anrufe an andere Nummern erreichen echte Menschen.

### 8. Ablauf

Die Beispielanrufe folgen der regulaeren Aufbewahrungsfrist fuer beendete Anrufe
(src/store/state-ops.js:5125) und verschwinden danach. Der Betreiber frischt sie kurz vor der
Einreichung und waehrend eines langen Reviews erneut auf und haelt das Abo des Reviewer-Kontos
aktiv, damit die Zugangsdaten nicht ablaufen.

## Anker (maschinenlesbar)

<!-- ANKER-BEGIN
src/auth.js:61 | export const OAUTH_SCOPES = Object.freeze(["openid", "email", "offline_access"]);
src/auth.js:122 | res.set("WWW-Authenticate", challenge);
src/auth.js:247 | () => deny401(res, "invalid_token", "Kein Token"),
src/auth.js:259 | requiredClaims: ["exp"],
src/auth.js:284 | req.auth = { sub: payload.sub, email: payload.email || null, claims: payload };
src/auth.js:376 | authorization_servers: authorizationServers,
src/auth.js:384 | app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
src/routes/_tenant.js:162 | const tenantId = store.resolveTenant(sub || internal);
src/store/state-ops.js:5306 | export function resolveTenant(s, idpSubject) {
src/web-auth.js:365 | const email = payload.email_verified === true ? (payload.email ?? null) : null;
src/web-auth.js:613 | throw new Error("login rejected: verified email required");
src/web-auth.js:540 | VALUES ($1, '${TENANT_STATUS.SUSPENDED}', $2, $3, $4, $5)
src/billing/activation.js:88 | store.setKycLevel(tenant, KYC_LEVEL.CARD);
src/billing/activation.js:106 | const provisioned = await provision(tenant);
src/routes/mcp.js:211 | if (rejectIfNoTenant(scopedTenant, req, res)) return;
src/mcp-no-tenant.js:32 | const NO_TENANT_DESCRIPTION = "No Hermes account is linked to this login";
src/mcp-tools.js:2003 | "list_calls",
src/mcp-tools.js:2059 | "list_action_items",
src/telephony/outbound-gates.js:699 | name: "outbound_frozen",
src/telephony/outbound-gates.js:421 | function kycGateError(tenantId) {
src/telephony/outbound-gates.js:438 | function allowlistError(to, { profile, tenantId }) {
src/telephony/outbound-gates.js:390 | function tenantHourReached(profile, tenantId) {
src/telephony/outbound-gates.js:401 | function perTargetCapReached(tenantId, to) {
src/telephony/outbound-gates.js:522 | grund: "denylist",
src/telephony/outbound-gates.js:530 | grund: "land",
src/telephony/outbound-gates.js:578 | grund: "budget_tenant",
src/telephony/outbound-gates.js:961 | ctx.maxDur = resolveMaxDurationS(
src/mcp-tools.js:1617 | "prepare_call",
src/mcp-tools.js:1705 | if (!confirmResult.confirmed) {
src/store/state-ops.js:5125 | const keepCall = (c) => c.status === "active" || !c.endedAt || c.endedAt >= cutoff;
ANKER-END -->
