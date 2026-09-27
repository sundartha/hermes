# OpenAI-Anforderungen (Soll)

Stand der Recherche: **Abruf 2026-09-18**. Quellenbasis: ausschliesslich offizielle
OpenAI-Quellen (`developers.openai.com`, `platform.openai.com`). Die Doku-Seiten tragen
**keine sichtbaren "last updated"-Marker**; wo eine Version erkennbar ist, steht sie in der
Spalte "Stand". Der Volltext-Export `https://developers.openai.com/plugins/llms-full.txt`
und `https://developers.openai.com/api/llms-full.txt` wurde am 2026-09-18 gezogen und ist
wortgleich mit den einzelnen HTML-Seiten.

**Terminologie-Warnung:** OpenAI hat "Apps SDK" / "Apps in ChatGPT" auf **"Plugins"** und
"Plugins Directory" umbenannt. `developers.openai.com/apps-sdk/*` liefert weiterhin Inhalte,
die Kanon-Pfade sind aber `developers.openai.com/plugins/*`. Aeltere Blogposts/Artikel mit
"Apps SDK submission" sind derselbe Prozess unter altem Namen.

Kategorien: **A** = explizite Anforderung mit Zitat/URL. **B** = folgt zwingend aus
Protokoll/Sicherheit, nicht woertlich gefordert. **C** = Empfehlung/"should" in der Doku.

## 1. Anbindungswege

| ID | Anforderung | Kategorie | Quelle (URL) | Stand | Wortlaut-Kern |
|---|---|---|---|---|---|
| W-1 | Developer Mode in ChatGPT = privater/Workspace-Weg, **kein** oeffentlicher | A | https://developers.openai.com/api/docs/guides/developer-mode | undatiert, Abruf 2026-09-18 | "Created apps will show under 'Drafts' in the app settings"; Eligibility "Pro, Plus, Business, Enterprise, and Education accounts on the web" |
| W-2 | Fuer privat/Workspace ausdruecklich Developer Mode statt Submission nutzen | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Only submit the plugin if you intend for it to be publicly available in the countries you define during submission. For private or workspace-only use, use developer mode instead." |
| W-3 | **Einziger oeffentlicher Weg**: Plugin-Submission-Portal -> Review -> Publish -> Plugins Directory (geteilt von ChatGPT und Codex) | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "1. Submit the plugin ... 2. OpenAI reviews ... 3. After OpenAI approves ... the developer chooses when to publish ... 4. After publication, the plugin appears in the universal Plugins Directory" |
| W-4 | Responses-API-MCP-Tool (`type: "mcp"`, `server_url`/`tunnel_id`) ist ein reiner API-Weg, macht nichts oeffentlich | A | https://developers.openai.com/api/docs/guides/tools-connectors-mcp | undatiert | "Remote MCP servers can be any server on the public Internet that implements a remote MCP server" |
| W-5 | Agents-API "MCP connections" (service- oder environment-origin, stdio) = weiterer API-Weg | A | https://developers.openai.com/api/docs/guides/agents-api/tools/mcp | undatiert | "HTTP with connection_origin: 'service' (default) - runs at OpenAI" |
| W-6 | Secure MCP Tunnel ist **fuer die oeffentliche Einreichung unzulaessig** | A | https://developers.openai.com/api/docs/guides/secure-mcp-tunnels | undatiert | "It does not support public plugin submission or distribution. Public plugins require a stable, publicly reachable HTTPS MCP endpoint." |
| W-7 | Eine bereits in ChatGPT/Codex publizierte Integration darf nicht referenziert werden; Server muss neu eingereicht werden | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "You cannot submit a plugin that references an existing, already-published integration." |

## 2. Technische Anforderungen (oeffentlicher Weg)

| ID | Anforderung | Kategorie | Quelle (URL) | Stand | Wortlaut-Kern |
|---|---|---|---|---|---|
| T-1 | Transport: **MCP streamable HTTP** an stabiler HTTPS-URL, typischerweise auf `/mcp` | A | https://developers.openai.com/plugins/build/mcp-server | undatiert | "The production endpoint must: Support the MCP streamable HTTP transport. Respond at a stable URL, typically ending in /mcp." |
| T-2 | Server auf oeffentlich erreichbarer Domain; kein lokaler/Test-Endpoint | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Your MCP server is hosted on a publicly accessible domain / You are not using a local or testing endpoint" |
| T-3 | Privater Server nur ueber oeffentlichen HTTPS-Proxy, optional mit OpenAI-mTLS und IP-Allowlist; Allowlist ersetzt keine Auth | C | https://developers.openai.com/plugins/build/mcp-server | undatiert | "deploy a public HTTPS proxy that forwards MCP requests to the private server ... An IP allowlist does not replace authentication or authorization." |
| T-4 | Developer Mode akzeptiert zusaetzlich SSE (Submission-Doku nennt nur streamable HTTP) | A | https://developers.openai.com/api/docs/guides/developer-mode | undatiert | "Supported MCP protocols: SSE and streaming HTTP." |
| T-5 | Auth-Pflicht bei privaten Daten/Aktionen: **OAuth 2.1 nach MCP-Authorization-Spec** | A | https://developers.openai.com/plugins/build/auth | verweist auf MCP-Spec **2025-11-25** | "you are expected to implement an OAuth 2.1 flow that conforms to the MCP authorization spec" |
| T-6 | Protected-Resource-Metadata unter `/.well-known/oauth-protected-resource` mit `resource` und `authorization_servers` | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | "GET https://your-mcp.example.com/.well-known/oauth-protected-resource" |
| T-7 | Authorization-Server-Metadata unter `/.well-known/oauth-authorization-server` **oder** `/.well-known/openid-configuration` | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | Pflichtfelder `issuer`, `authorization_endpoint`, `token_endpoint`, `code_challenge_methods_supported` |
| T-8 | **PKCE mit `S256` ist Pflicht** und muss in der Metadata beworben werden | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | "ChatGPT performs the authorization-code flow with PKCE using the S256 code challenge"; Server ohne S256-Advertising sind "unsupported per spec" |
| T-9 | Resource Indicators: ChatGPT haengt `resource=<canonical mcp url>` an Authorization- und Token-Request; AS muss den Wert in den Token uebernehmen (i.d.R. `aud`) | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 (RFC 8707) | "copy that value into the access token (commonly the aud claim)" |
| T-10 | Client-Registrierung: **CIMD bevorzugt** (`client_id_metadata_document_supported: true`), Token-Endpoint-Auth `none` oder `private_key_jwt`; **DCR wird weiter unterstuetzt** (`registration_endpoint`) | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | "Use Client ID Metadata Documents (CIMD) as the preferred client registration method ... Dynamic client registration remains supported when configured." |
| T-11 | Stabile Redirect-URI `https://chatgpt.com/connector_platform_oauth_redirect` nur mit RFC-9207-`iss`; sonst callback-spezifische URI `https://chatgpt.com/connector/oauth/{callback_id}` | A | https://developers.openai.com/plugins/build/auth | verweist auf MCP-Spec **2026-07-28** (authorization response validation) | "Set authorization_response_iss_parameter_supported: true ... Return iss in every authorization response" |
| T-12 | Token-Pruefung serverseitig: Signatur/JWKS, `iss`, `exp`/`nbf`, Audience/Resource-Claim, Scopes, eigene Policy | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | "Confirming the token's audience/resource claim matches your server" |
| T-13 | Bei fehlgeschlagener Pruefung `401 Unauthorized` + `WWW-Authenticate` auf die Protected-Resource-Metadata | A | https://developers.openai.com/plugins/build/auth | MCP 2025-11-25 | "Return 401 Unauthorized with a WWW-Authenticate header pointing to protected-resource metadata" |
| T-14 | Auth-UI im Gespraech nur ueber Fehlerergebnis mit `_meta["mcp/www_authenticate"]` (RFC-7235-Challenge) | A | https://developers.openai.com/plugins/reference | undatiert | "_meta['mcp/www_authenticate'] - Error result - RFC 7235 WWW-Authenticate challenges to trigger OAuth." |
| T-15 | Pro Tool `securitySchemes` deklarieren (`{"type":"noauth"}` / `{"type":"oauth2","scopes":[...]}`); Mixed Auth basiert darauf | A | https://developers.openai.com/plugins/build/auth | undatiert | "Mixed authentication ... initialize and list tools APIs use no auth, and tools use OAuth or no auth based on the security schemes set on their tool metadata." |
| T-16 | Fuer Workspace-Domain-Restriktionen: OIDC-Discovery + Scopes `openid`/`email` + UserInfo-Endpoint mit `email` und `email_verified: true` | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "the UserInfo Endpoint is required for workspace domain restrictions" |
| T-17 | Optional OpenAI-managed **mTLS**: Leaf-Zertifikat gegen "OpenAI Connectors mTLS intermediate CA", SAN dnsName `mtls.prod.connectors.openai.com`, kein Fingerprint-Pinning | C | https://developers.openai.com/plugins/build/auth | undatiert | "Use mTLS to authenticate ChatGPT as MCP client; OAuth 2.1 authenticates end users." |
| T-18 | Tool-Definition: eindeutiger Name, Title, Description, **expliziter inputSchema**, `outputSchema` fuer alles, was `structuredContent` zurueckgibt | A | https://developers.openai.com/plugins/reference | verweist auf MCP-Spec **2025-06-18** (tools) | "Declare outputSchema for any tool that returns structuredContent." |
| T-19 | Ergebnisstruktur: `structuredContent` (muss zu `outputSchema` passen), `content`, `_meta`; **nur `structuredContent` und `content` erreichen das Modell, `_meta` geht ausschliesslich an die UI-Komponente** | A | https://developers.openai.com/plugins/reference | MCP-Spec 2025-06-18 (tool result) | "Only structuredContent and content appear in the conversation transcript. The host forwards _meta to the component." |
| T-20 | Fehler im Tool-Ergebnis ueber MCP-Standard `isError: true`; darueber hinaus nur `_meta["mcp/www_authenticate"]` als OpenAI-relevanter Fehlerkanal dokumentiert | B | https://developers.openai.com/plugins/build/auth (Beispielcode `isError: true`) | undatiert | Kein eigenes OpenAI-Fehlerformat dokumentiert; MCP-Standard gilt |
| T-21 | Server-`instructions` (MCP-Initialization) werden von ChatGPT/Codex genutzt; wichtigste Inhalte in die **ersten 512 Zeichen** | C | https://developers.openai.com/plugins/build/mcp-server | verweist auf MCP-Spec 2025-06-18 (lifecycle) | "Keep the most important details in the first 512 characters. Do not repeat every tool description" |
| T-22 | `_meta["openai/toolInvocation/invoking"]` und `/invoked`: max. 64 Zeichen | A | https://developers.openai.com/plugins/reference | undatiert | "<= 64 chars" |
| T-23 | Statuszeilen/Widget-Metadaten: Standard-Key `_meta.ui.resourceUri` bevorzugt, `_meta["openai/outputTemplate"]` nur als Kompatibilitaets-Alias | A | https://developers.openai.com/plugins/reference | undatiert | "Prefer the MCP Apps standard key _meta.ui.resourceUri" |
| T-24 | Nur fuer ChatGPT **Deep Research / Company Knowledge**: standardisierte `search`- und `fetch`-Tools mit festen Schemas; `search` liefert `{results:[{id,title,url}]}`, `fetch` liefert `{id,title,text,url,metadata}`, jeweils zusaetzlich JSON-String im `content`-Array | A | https://developers.openai.com/api/docs/mcp | undatiert | "implement the standard search and fetch tool input schemas and mark other read-only tools with readOnlyHint: true" |
| T-25 | Zitationen entstehen **nur**, wenn `url` ein nicht-leerer String ist | A | https://developers.openai.com/api/docs/mcp | undatiert | "ChatGPT creates citation metadata only when url is a non-empty string." |
| T-26 | Developer Mode braucht **kein** `search`/`fetch` | A | https://developers.openai.com/api/docs/guides/developer-mode | undatiert | "Developer mode does not require search/fetch tools." |
| T-27 | Timeouts und Rate-Limits sind **Pflicht des Servers** fuer teure/extern sichtbare Tools | A | https://developers.openai.com/plugins/build/mcp-server | undatiert | "Apply timeouts and rate limits to expensive or externally visible tools." / "Rate-limit expensive or externally visible actions." |
| T-28 | Der Client liefert `_meta["openai/subject"]` (anonymisierte User-ID) ausdruecklich **fuer Rate-Limiting**; `openai/userAgent` und `openai/userLocation` sind nur Hinweise und duerfen **nie** fuer Autorisierung genutzt werden | A | https://developers.openai.com/plugins/reference | undatiert | "servers should never rely on them for authorization decisions and must tolerate their absence" |
| T-29 | Statelessness: nicht gefordert, aber das offizielle Quickstart-Beispiel faehrt den StreamableHTTP-Transport im Stateless-Modus; CORS muss `mcp-session-id` erlauben/exponieren | C | https://developers.openai.com/plugins/quickstart | undatiert | `sessionIdGenerator: undefined, // stateless mode` |
| T-30 | Bei UI: **CSP zwingend**, die exakt die Domains erlaubt, von denen die Komponente laedt (`_meta.ui.csp` mit `connectDomains`, `resourceDomains`, optional `frameDomains`) | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "you defined a content security policy (CSP) that allows the exact domains the component fetches from" |
| T-31 | Bei UI: eigener, pro Plugin eindeutiger Origin `_meta.ui.domain` erforderlich | A | https://developers.openai.com/plugins/reference | undatiert | "required when submitting a plugin with UI; must be unique per plugin" |
| T-32 | MCP-Server-Origin (`scheme`, `hostname`, `port`) ist nach Publikation **unveraenderlich**; Aenderung erfordert ein neues Plugin | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "To change the origin, create a new plugin, then complete its scan, submission, review, and publication flow." |
| T-33 | Continuous Review: OpenAI scannt den Server periodisch; geloeschte Tools verschwinden sofort, neue/geaenderte erst nach bestandenen automatischen Checks; alte Definition muss waehrenddessen lauffaehig bleiben | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Keep your server compatible with the live definition while an update is held." |
| T-34 | Cache: UI-Resource-Inhalte koennen bis zu einer Stunde aus dem Cache bedient werden | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "ChatGPT may continue serving cached resource contents for up to one hour." |
| T-35 | **EU-Datenresidenz-Projekte koennen aktuell keine MCP-Plugins einreichen** | A | https://developers.openai.com/plugins/deploy/app-review | "For now", undatiert | "For now, projects with EU data residency cannot submit plugins with MCP servers for review. Use a project with global data residency." |
| T-36 | Template-URLs (`https://{workspace}.example.com/mcp`) nur fuer "trusted developers with whom we have an established relationship"; Regelfall ist eine universelle URL | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "We only support template-based URLs for trusted developers" |

## 3. Tool-Beschreibungen, Nebenwirkungen, Bestaetigung

| ID | Anforderung | Kategorie | Quelle (URL) | Stand | Wortlaut-Kern |
|---|---|---|---|---|---|
| N-1 | `readOnlyHint`, `destructiveHint`, `openWorldHint` sind in der OpenAI-Referenz als **Required** gefuehrt (`idempotentHint` optional) | A | https://developers.openai.com/plugins/reference | verweist auf MCP-Schema **2025-11-25** | Spalte "Required" = ja fuer alle drei |
| N-2 | `readOnlyHint: true` nur, wenn das Tool nichts aendert; `false` bei create/update/delete, Mails/Nachrichten senden, Jobs starten, Logs schreiben | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Set to false if the tool can create/update/delete anything, trigger actions (send emails/messages, run jobs, enqueue tasks, write logs, start workflows)" |
| N-3 | `destructiveHint: true` bei irreversiblen Folgen - **explizit inklusive "sending messages or transactions you can't undo"** - auch wenn nur in einzelnen Modi oder ueber indirekte Seiteneffekte | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "even in only select modes, through default parameters, or through indirect side effects" |
| N-4 | `openWorldHint: true` bei Zugriff auf oeffentliches Internet oder offene externe Entitaeten, inkl. "send messages to external recipients" | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "write tools that post to public platforms, send messages to external recipients, publish content, push code, or submit forms" |
| N-5 | Zu jeder Annotation ist bei der Einreichung eine **Begruendung** zu liefern; die Begruendung ueberschreibt die Server-Werte nicht | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "describing the tool as 'functionally read-only' in the justification doesn't make the tool read-only" |
| N-6 | Falsche/fehlende Annotationen sind ein **haeufiger Ablehnungsgrund** | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Incorrect or missing action labels are a common cause of rejection." |
| N-7 | Tools **ohne** `readOnlyHint` werden vom Host als Write-Action behandelt | A | https://developers.openai.com/api/docs/guides/developer-mode | undatiert | "Tools without this hint are treated as write actions." |
| N-8 | Write-Actions erfordern in ChatGPT **standardmaessig eine manuelle Bestaetigung** pro Konversation | A | https://developers.openai.com/api/docs/mcp | undatiert | "ChatGPT currently requires manual confirmation in any conversation before write actions can be taken." |
| N-9 | Jede Aktion, die Daten aus der Umgebung heraussendet (Nachrichten, Mails, Uploads), **muss** als Write-Action sichtbar sein, damit der Client Bestaetigung oder Preview erzwingen kann | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "must be surfaced to the client as a write action so it can require user confirmation or run in preview mode" |
| N-10 | Annotationen ersetzen **keine** serverseitige Autorisierung, Validierung oder Bestaetigung; der Server muss selbst bestaetigen lassen | A | https://developers.openai.com/plugins/build/mcp-server | undatiert | "Require confirmation for consequential write actions." |
| N-11 | Seiteneffekte duerfen nie versteckt sein; Tools sollen retry-sicher sein oder es ausweisen | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Side effects should never be hidden or implicit." |
| N-12 | Tool-Namen: eindeutig im Server, Klartext, moeglichst Verb; keine werbliche/vergleichende Sprache (`pick_me`, `best`, `official`) | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Avoid misleading, overly promotional, or comparative language" |
| N-13 | Beschreibungen muessen Verhalten exakt abbilden; **kein** Bevorzugen/Herabsetzen anderer Plugins; kein Aufruf zu ueberbreiter Ausloesung | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Descriptions must not recommend overly broad triggering beyond the explicit user intent" |
| N-14 | Minimale Inputs: keine Chat-Historie, keine Roh-Transkripte, keine "just in case"-Felder, **keine praezisen Standortdaten** | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not request the full conversation history, raw chat transcripts, or broad contextual fields 'just in case'." |
| N-15 | Der Server darf den vollstaendigen Chatverlauf nicht ziehen, rekonstruieren oder erschliessen | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Your MCP server must not pull, reconstruct, or infer the full chat log" |
| N-16 | MCP-**Elicitation** ist erlaubt fuer fehlende strukturierte Angaben, aber nicht fuer Secrets oder Auth-Umgehung | A | https://developers.openai.com/plugins/build/mcp-server | undatiert | "Do not use it to collect secrets or bypass normal authentication." |

## 4. Policy- und Organisations-Anforderungen

| ID | Anforderung | Kategorie | Quelle (URL) | Stand | Wortlaut-Kern |
|---|---|---|---|---|---|
| O-1 | **Identitaetsverifikation** im OpenAI-Platform-Dashboard: individual verification (eigener Name) oder business verification (Firmenname); ohne sie Ablehnung | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Publishing under an unverified individual or business name will result in rejection." |
| O-2 | Verifikation muss in **derselben Organisation** liegen, aus der eingereicht wird | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "check that you are submitting from the same organization and project where the identity was verified" |
| O-3 | Berechtigungen: `api.apps.write` (erstellen/einreichen) und `api.apps.read` (Status); im UI "Apps Management: Write" | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "you need the api.apps.write permission" |
| O-4 | **Domain-Ownership**: exaktes Token unter `https://<challenge-base-host>/.well-known/openai-apps-challenge`; nur dieses eine Token, **kein** JSON, keine Liste | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "The challenge endpoint must return only that plugin's verification token. Do not return JSON, a list of tokens, or multiple tokens" |
| O-5 | Challenge-Base ist MCP-Hostname oder ein Parent-Host; **Pfade werden ignoriert** - zwei Plugins auf demselben Host mit unterschiedlichem Pfad teilen die Challenge-URL | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "You cannot verify them separately by putting different tenant paths in the Challenge Base URL, because the path is ignored." |
| O-6 | **Privacy Policy** (veroeffentlicht) muss mindestens nennen: Kategorien personenbezogener Daten, Zwecke, Empfaengerkategorien, Aufbewahrungsfristen, Nutzerkontrollen - und wird eingehalten | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "the categories of personal data collected, the purposes of use, the categories of recipients, data retention timelines, and any controls offered" |
| O-7 | Pflicht-URLs im Listing: Website, **Support-URL**, Privacy-Policy-URL, **Terms-URL** - oeffentlich und zur Publisher-Identitaet passend | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "Privacy policy, terms, support, and website URLs are public and match the publisher identity." |
| O-8 | **Support-Kontakt** fuer Endnutzer ist Pflicht und aktuell zu halten | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "You must provide customer support contact details where end users can reach you for help." |
| O-9 | **Reviewer-Zugang**: voll ausgestatteter Demo-Account mit Beispieldaten, **ohne MFA, SMS, E-Mail-Bestaetigung, Neuanmeldung oder privates Netz**, nicht abgelaufen | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "Plugins that require additional login steps, such as a new account sign-up or 2FA through an inaccessible account, will be rejected." |
| O-10 | **5 positive und 3 negative Testfaelle** mit Prompt, erwartetem Verhalten, Ergebnisform und Reproduktionsdaten | A | https://developers.openai.com/plugins/deploy/submission | undatiert | "Submit at least five positive test cases and three negative test cases." |
| O-11 | Weitere Pflichtangaben: Name, Kurz-/Langbeschreibung, Logo, Kategorie, Starter-Prompts, Lokalisierung, Laenderverfuegbarkeit, Release Notes, Policy-Attestationen | A | https://developers.openai.com/plugins/deploy/submission | undatiert | Tabelle "Prepare required materials" |
| O-12 | Screenshots **nur** bei UI; bei UI-losen Plugins keine einreichen | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Don't submit screenshots for plugins without UI." |
| O-13 | **Datenminimierung** in Eingabe und Antwort; keine Diagnose-/Telemetrie-/internen IDs (Session-, Trace-, Request-IDs, Zeitstempel, Logs) in Tool-Antworten | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not include diagnostic, telemetry, or internal identifiers ... unless they are strictly required" |
| O-14 | **Restricted Data verboten**: PCI-DSS-Daten, PHI, staatliche Identifikatoren, Zugangsdaten/Auth-Secrets | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not collect, solicit, or process the following categories of Restricted Data" |
| O-15 | Besondere Kategorien (DSGVO Art. 9 o.ae.) nur bei strikter Notwendigkeit + rechtswirksamer Einwilligung + prominenter Offenlegung | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "the user has provided legally adequate consent; and the collection and use is explicitly and prominently disclosed" |
| O-16 | Kein Tracking/Profiling/Surveillance ohne explizite Offenlegung, enge Zweckbindung und Nutzerkontrolle | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not engage in surveillance, tracking, or behavioral profiling" |
| O-17 | Standort: keine Roh-Standortfelder im Input-Schema; Standort nur ueber den Client-Seitenkanal (`_meta["openai/userLocation"]`, grob) | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Avoid requesting raw location fields ... obtain it through the client's controlled side channel" |
| O-18 | **Allgemeine OpenAI Usage Policies gelten zusaetzlich**; frueher freigegebene Plugins koennen nachtraeglich entfernt werden | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not engage in or facilitate activities prohibited under OpenAI usage policies." |
| O-19 | Verbotene Dienste-Kategorie enthaelt ausdruecklich **"Negative-option billing, telemarketing, or consent-bypass schemes"** | A | https://developers.openai.com/plugins/app-guidelines | undatiert | woertlich, Abschnitt "Prohibited fraudulent, deceptive, or high-risk services" |
| O-20 | Commerce nur fuer **physische Gueter**; keine digitalen Produkte/Dienste, keine Abos, kein Anzeigen oder Starten von Abo-/Upgrade-Flows, kein direkter Checkout-Link | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "plugins may conduct commerce only for physical goods ... Plugins must not display subscription plans, initiate new subscriptions, or promote upgrades." |
| O-21 | Keine Werbung; Plugin darf nicht primaer Werbetraeger sein | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Plugins must not serve advertisements" |
| O-22 | Keine **inoffiziellen Konnektoren** zu Drittdiensten und keine reinen Pass-through-Zwischenschichten | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "We cannot approve plugins that primarily function as unofficial connectors to third-party services, including pass-through intermediary software layers." |
| O-23 | Drittanbieter-Zugriff nur mit Autorisierung und im Einklang mit deren AGB; kein Umgehen von Rate-Limits/Zugriffskontrollen | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Do not bypass API restrictions, rate limits, or access controls imposed by the third party." |
| O-24 | Eignung fuer allgemeines Publikum inkl. 13-17; keine Zielgruppe unter 13; 18+ derzeit nicht moeglich | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Plugins must be suitable for general audiences, including users aged 13-17." |
| O-25 | Kein Trial-/Demo-Plugin; Plugin muss stabil, responsiv, vollstaendig sein und nicht-native Funktionalitaet bieten | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Trial or demo plugins will not be accepted." |
| O-26 | Iframes nur von der eigenen registrierbaren Domain; Fremd-Domains nur mit Begruendung und nur wenn essenziell | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "Separate tenants on a shared hosting service count as different domains" |
| O-27 | "Fair play": keine modell-lesbaren Felder, die die Auswahl anderer Plugins manipulieren | A | https://developers.openai.com/plugins/app-guidelines | undatiert | "fields ... that manipulate how the model selects or uses other plugins" |
| O-28 | Nach Freigabe muss der Entwickler **selbst publizieren**; Directory-Platzierung/Vorschlaege sind nicht beantragbar | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "You must publish before it can appear in the universal plugin directory." |
| O-29 | Presse-/Ankuendigungen vorab mit press@openai.com abstimmen | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "please first reach out to press@openai.com" |
| O-30 | Pro MCP-Server-Integration darf nur **eine Version veroeffentlicht und eine im Review** sein | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "only one version may be published at a time and only one version may be in review at a time" |
| O-31 | Entfernung bei Inaktivitaet, Instabilitaet oder Verstoss jederzeit und ohne Vorankuendigung moeglich | A | https://developers.openai.com/plugins/deploy/app-review | undatiert | "We may reject or remove any plugin from our services at any time and for any reason without notice" |

## 5. Dokumentierte Besonderheiten / Abweichungen von der MCP-Spec

| ID | Anforderung | Kategorie | Quelle (URL) | Stand | Wortlaut-Kern |
|---|---|---|---|---|---|
| X-1 | Annotationen, die die MCP-Spec als optional fuehrt, sind bei OpenAI **Required** (`readOnlyHint`, `destructiveHint`, `openWorldHint`) | A | https://developers.openai.com/plugins/reference | MCP-Schema 2025-11-25 | Spalte "Required" |
| X-2 | `_meta` im Tool-**Ergebnis** wird bewusst **nicht** an das Modell gegeben, sondern nur an die UI-Komponente | A | https://developers.openai.com/plugins/reference | undatiert | "Delivered only to the component. Hidden from the model." |
| X-3 | OpenAI-eigene `_meta`-Namensraeume neben den MCP-Apps-Standard-Keys: `openai/outputTemplate`, `openai/widgetAccessible`, `openai/visibility`, `openai/profile`, `openai/fileParams`, `openai/toolInvocation/*` | A | https://developers.openai.com/plugins/reference | undatiert | "OpenAI-specific optional/compatibility alias" |
| X-4 | Client-seitige `_meta`-Felder, die die MCP-Spec nicht kennt: `openai/locale` (BCP 47, Legacy `webplus/i18n`), `openai/userAgent`, `openai/userLocation`, `openai/subject`, `openai/session`, `openai/organization` | A | https://developers.openai.com/plugins/reference | undatiert | Tabelle "_meta fields the client provides" |
| X-5 | MCP-Apps-UI-Bridge nutzt eine **eigene** Protokollversion (`ui/initialize` mit `protocolVersion: "2026-01-26"`), unabhaengig von der MCP-Kernversion | A | https://developers.openai.com/plugins/quickstart | 2026-01-26 (im Beispielcode) | `const protocolVersion = "2026-01-26";` |
| X-6 | Widget-Sandbox: **keine** privilegierten Browser-APIs (`window.alert`, `window.prompt`, `window.confirm`, `navigator.clipboard`), keine Subframes ohne explizite `frameDomains` | A | https://developers.openai.com/plugins/guides/security-privacy | undatiert | "They cannot access privileged browser APIs" |
| X-7 | `_meta.ui.csp` unterstuetzt **kein** `redirect_domains`; dafuer bleibt der Legacy-Key `_meta["openai/widgetCSP"].redirect_domains` noetig | A | https://developers.openai.com/plugins/reference | undatiert | woertlich |
| X-8 | OpenAI-eigene MCP-Erweiterung "draft skills extension / static resource manifest" zum Import von Skills aus dem MCP-Server (Snapshot zur Einreichungszeit, **kein** Live-Update) | A | https://developers.openai.com/plugins/build/mcp-server | undatiert | "OpenAI imports skills from MCP as a submission-time snapshot." |
| X-9 | Ueber die Spec hinaus: Multi-Account-Unterstuetzung ueber ein Profil-Tool mit `_meta["openai/profile"]: true` und stabiler, nie wiederverwendeter `id` | C | https://developers.openai.com/plugins/build/auth | undatiert | "Identical across token refresh, reconnection, scope upgrades" |
| X-10 | Plugins nutzen "primarily tools"; Resources und Prompts werden genannt, aber fuer den oeffentlichen Weg nirgends als unterstuetzt/erforderlich spezifiziert | B | https://developers.openai.com/plugins/concepts/mcp-server | undatiert | "Plugins primarily use tools." |

## Nicht auffindbar / unklar

1. **OpenAI Usage Policies im Volltext.** `https://openai.com/policies/usage-policies/` liefert
   am 2026-09-18 aus dieser Umgebung durchgaengig **HTTP 403** (auch mit Browser-Headern, auch
   ueber WebFetch). Die Plugin-Guidelines verweisen normativ darauf (O-18), der Wortlaut konnte
   aber **nicht** offiziell verifiziert werden. Alles, was ueber O-19 hinausgeht, ist hier
   bewusst nicht behauptet. **Muss vor einer Einreichung aus einem Browser nachgelesen werden.**
2. **Automatisierte Telefonanrufe / Sprachagenten / Outbound-Calling als Plugin-Kategorie.**
   In der gesamten Plugin- und API-Doku (Volltext-Grep ueber beide `llms-full.txt`) gibt es
   **keine** Regel, die automatisierte Telefonanrufe erlaubt oder verbietet. Der einzige
   Treffer mit Telefonie-Bezug in den Verbotslisten ist "telemarketing ... schemes" (O-19) -
   das adressiert Telemarketing-Maschen, nicht Telefonie an sich. Ob ein Plugin, dessen Tools
   echte Anrufe ausloesen, zulaessig ist, ist **nicht dokumentiert**.
3. **KI-Offenlegungspflicht gegenueber angerufenen Dritten.** In der Plugin-Doku **nicht
   auffindbar**. Die Doku regelt Offenlegung nur gegenueber dem ChatGPT-Nutzer (Privacy Policy,
   Write-Action-Bestaetigung). Eine Art.-50-EU-AI-Act-analoge Anforderung steht dort nicht -
   das bedeutet nicht, dass sie entfaellt, sondern dass OpenAI sie nicht stellt.
4. **Verbindliche MCP-Protokollversion.** Es wird **keine** geforderte `protocolVersion` genannt.
   Die Doku verlinkt uneinheitlich auf MCP-Spec-Staende **2025-06-18** (Lifecycle/Tools/Tool-Result),
   **2025-11-25** (Authorization, ToolAnnotations-Schema, CIMD) und **2026-07-28**
   (Authorization-Response-Validation). Welcher Stand mindestens unterstuetzt werden muss:
   **nicht auffindbar**.
5. **Von OpenAI gesetzte Timeouts, Rate-Limits, Payload-Groessenlimits fuer Tool-Calls.**
   Nicht auffindbar. Dokumentiert sind nur Limits, die der **Server** setzen soll (T-27), die
   64-Zeichen-Statustexte (T-22), die 512-Zeichen-Empfehlung fuer `instructions` (T-21) und
   Skill-Bundle-Groessen (SKILL.md 256 KiB, Supporting file 1 MiB, alle Skill-Resources 5 MiB,
   Archive 8 MiB, max. 5 Skills/Scan, 100 Dateien/Skill) - Letztere betreffen **Skills**, nicht
   MCP-Tool-Antworten.
6. **Eigenes Fehlerformat.** Ausser `isError` (MCP-Standard) und `_meta["mcp/www_authenticate"]`
   ist kein OpenAI-spezifisches Fehlerformat dokumentiert; wie Fehler dem Nutzer praesentiert
   werden, ist nicht beschrieben.
7. **Statelessness als Pflicht.** Nicht gefordert. Nur das Quickstart-Beispiel faehrt stateless
   (T-29). Ob sessionbehaftete Server im Review akzeptiert werden: **nicht auffindbar**.
8. **Review-Dauer, Kosten, SLAs.** Ausdruecklich offen gelassen: "Review timelines may vary as we
   continue to build and scale our processes." Keine Gebuehren dokumentiert.
9. **Ob Developer-Mode-Plugins mit anderen Nutzern geteilt werden koennen.** Die Doku sagt nur,
   sie erscheinen unter "Drafts" und "Developer mode availability can depend on account and
   workspace policy". Eine Teilen-Funktion ist **nicht dokumentiert**.
10. **Unterstuetzungsstatus von MCP-Features** wie `resources`, `prompts`, `sampling`, `roots`,
    `notifications` in ChatGPT: **nicht auffindbar** (nur `tools`, `resources` fuer UI-Templates,
    `instructions` und `elicitation` sind belegt).
11. **`apps-sdk`-Pfade vs. `plugins`-Pfade.** `developers.openai.com/apps-sdk/app-submission-guidelines`
    liefert weiterhin Inhalt, ist aber inhaltsgleich mit `plugins/app-guidelines`. Ob die
    `apps-sdk`-Pfade gepflegt oder eingefroren sind: **nicht auffindbar**. Als Quelle wurden
    daher durchgaengig die `plugins/*`-Pfade verwendet.
