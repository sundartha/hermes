# Zwischenmessung 1 - Stand master 1a31815

| ID | technisch | Status | Beleg | Fehlt | baubar ohne Owner |
|---|---|---|---|---|---|
| T-1 | ja | ERFUELLT | src/routes/mcp.js:204 POST /mcp + :268 StreamableHTTPServerTransport (stateless), :283 GET 405; lokal gemessen (PORT=0, oauth): initialize/tools/list ueber POST /mcp -> SSE-Result; live PRM resource=https://app.sundartha.com/mcp | Deploy von master offen (live laeuft aelterer Stand) | - |
| T-2 | ja | ERFUELLT | Messung: GET https://app.sundartha.com/healthz -> 200, PRM live oeffentlich; render.yaml:738-739 PUBLIC_URL=https://app.sundartha.com; src/boot-guard.js:982-987 PUBLIC_URL im Hosting fatal, wenn nicht https | Deploy von master offen | - |
| T-3 | ja | GEGENSTANDSLOS | Server ist selbst oeffentlich (https://app.sundartha.com/healthz 200), kein privater Server hinter Proxy; ChatGPT-Egress-IP (src/routes/mcp.js:53) dient nur der Client-Klasse NACH mcpAuth (:204), ersetzt keine Auth |  | nein |
| T-4 | ja | GEGENSTANDSLOS | Host-Faehigkeit, keine Server-Pflicht: Dienst spricht streamable HTTP (src/routes/mcp.js:268), das Dev Mode und Einreichung beide akzeptieren; SSE-Alttransport nicht noetig (GET /mcp -> 405, :283) |  | nein |
| T-5 | ja | ERFUELLT | RS: src/auth.js:224-285 (JWKS/iss/aud/exp/Scope), :370-385 PRM, :149-152 401-Challenge; AS WorkOS gemessen: S256, CIMD, DCR; Tests oauth.test.js, openai-p7, openai-t2-23 gruen (128/128) | Live-Probe in ChatGPT offen; MCP_AUTH=oauth ist Render-Wert (config.js:2516 nur WARN, falls nicht oauth) | - |
| T-6 | ja | ERFUELLT | src/auth.js:370-385 (beide Pfade, resource=audience(), authorization_servers); lokal gemessen resource=https://agent.test/mcp + AS + scopes_supported; live PRM mit resource+authorization_servers | live noch ohne scopes_supported (Deploy offen) | - |
| T-7 | ja | ERFUELLT | Messung GET https://fearless-network-26.authkit.app/.well-known/oauth-authorization-server: issuer, authorization_endpoint, token_endpoint, code_challenge_methods_supported vorhanden; zusaetzlich openid-configuration |  | - |
| T-8 | ja | ERFUELLT | Messung WorkOS-AS-Metadata: code_challenge_methods_supported=["S256"] (externer AS, PRM verweist darauf) |  | - |
| T-9 | ja | OWNER | RS-Seite: aud = kanonische <PUBLIC_URL>/mcp (src/auth.js:34, :236); divergente OAUTH_AUDIENCE boot-fatal (boot-guard.js:943-957); lokal gemessen: falsche aud -> 401 | Ob WorkOS resource in aud uebernimmt: nur mit echtem Access-Token/WorkOS-Resource-Indicator-Einstellung pruefbar (render.yaml:369-372) | nein |
| T-10 | ja | ERFUELLT | Messung WorkOS-AS-Metadata: client_id_metadata_document_supported=true, token_endpoint_auth_methods_supported enthaelt none, registration_endpoint vorhanden | Live-Probe (CIMD-Registrierung durch ChatGPT) offen | - |
| T-11 | ja | OWNER | Messung: WorkOS bewirbt authorization_response_iss_parameter_supported NICHT (weder oauth-authorization-server noch openid-configuration) -> nur callback-spezifische URI moeglich; kein Hermes-Code beteiligt | Akzeptanz von https://chatgpt.com/connector/oauth/{callback_id} bei WorkOS nur per Dev-Mode-Probe/Anbieter-Einstellung pruefbar; stabile URI mangels RFC-9207-iss nicht nutzbar | nein |
| T-12 | ja | ERFUELLT | src/auth.js:229-238 jwtVerify(JWKS, issuer, audience, requiredClaims exp), :169-172/:243 Scope, Mandanten-Policy mcp-no-tenant.js; gemessen: Muell->401, falsche aud->401, fehlender Scope->403; Test OpenAI-P7 (iss,nbf,Scope) gruen | Live-Probe offen: echtes WorkOS-Token muss scope openid+email tragen, sonst nach Deploy 403 fuer alle | - |
| T-13 | ja | ERFUELLT | src/auth.js:149-152/:134-145; lokal gemessen POST /mcp ohne/mit Muell-Token -> 401 + WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource", scope, error; Test T2-23-A3 gruen |  | - |
| T-14 | ja | ERFUELLT | src/mcp-no-tenant.js:36,46; gemessen: gueltiges Token ohne Hermes-Konto -> tools/call isError:true + _meta["mcp/www_authenticate"]=[Bearer resource_metadata=..., scope=...]; Test T05-5 gruen | Live-Probe in ChatGPT offen | - |
| T-15 | ja | ERFUELLT | src/mcp-security-schemes.js:87-105 (Override, da registerTool verwirft); gemessen tools/list oauth-Modus: alle 11 Tools securitySchemes [{type:oauth2,scopes:[openid,email,offline_access]}]; P3-Tests (oauth/off/token/stdio) gruen |  | - |
| T-16 | ja | OWNER | Hermes fordert openid+email an (src/auth.js:51, PRM/Challenge/securitySchemes gemessen); WorkOS openid-configuration gemessen: userinfo_endpoint vorhanden, scopes_supported openid/email | Ob UserInfo email + email_verified:true liefert, nur mit echtem Token pruefbar | nein |
| T-17 | ja | GEGENSTANDSLOS | Optional (Klasse C); grep -i mtls src = 0 Treffer, bewusst nicht genutzt - Endnutzer-Auth laeuft ueber OAuth 2.1 (src/auth.js) |  | nein |
| T-18 | ja | ERFUELLT | gemessen tools/list: 11 eindeutige Namen, je title+description+inputSchema(type object); outputSchema an 9, ohne nur cancel_call/list_action_items, die nie structuredContent liefern (mcp-tools.js:1573); P2-Test inkl. stdio gruen |  | - |
| T-19 | ja | ERFUELLT | gemessen get_agent_status: structuredContent+content, _meta nur {hermes/locale} (mcp-tools.js:1066); SDK 1.29 validiert structuredContent gegen outputSchema (sdk server/mcp.js:185-205); Test P4 T-19/T-20 Regel gruen |  | - |
| T-20 | ja | ERFUELLT | src/mcp-tools.js:1132-1144 wrapHandler -> errText (isError); gemessen get_call_status mit unbekannter id -> isError:true; Test P4 (T-19/T-20) gruen |  | - |
| T-21 | ja | ERFUELLT | src/mcp-server-info.js:97-102/151-155; HTTP routes/mcp.js:233-237, stdio mcp-server.js:27-31; Basisblock 404 Zeichen, Consult 1382 mit Geld-/Nicht-Erfinden-Satz vorn; Tests P4 T-21 (HTTP+stdio) gruen |  | - |
| T-22 | ja | ERFUELLT | src/mcp-tools.js:959-1011; gemessen tools/list: alle 11 Tools invoking/invoked vorhanden, laengster 32 Zeichen (<=64); P2-Test Schritt 10 (HTTP) + 13 (stdio) gruen |  | - |
| T-23 | ja | ERFUELLT | src/ui/contract.js:17 UI_META_KEY; gemessen: 4 Widget-Tools tragen _meta.ui.resourceUri (ui://hermes/.../vN.html), kein openai/outputTemplate; resources/list mimeType text/html;profile=mcp-app; P2 Schritt 14 gruen |  | - |
| T-24 | ja | GEGENSTANDSLOS | Hermes ist keine Deep-Research-/Company-Knowledge-Quelle; gemessen tools/list: kein search/fetch unter den 11 Tools; Lese-Tools tragen readOnlyHint:true |  | nein |
| T-25 | ja | GEGENSTANDSLOS | Zitationen betreffen nur search/fetch-Ergebnisse (T-24); Dienst bietet keine solchen Tools (tools/list gemessen) |  | nein |
| T-26 | ja | GEGENSTANDSLOS | Lockerung, keine Pflicht: tools/list am Draht = 11 Werkzeuge ohne search/fetch (test/openai-p10a-tool-inventar.test.js 'K1-K6 ... mit dem Draht', 6/6 gruen; docs/OPENAI-TOOL-INVENTORY.md:30-40) |  | nein |
| T-27 | ja | ERFUELLT | Frist je Hop: src/mcp-tools.js:351/:361 boundedHop, :333 place_call, :1093 Poll; Drossel je Mandant src/mcp-rate-limit.js:55, routes/mcp.js:150/204; Tests mcp-rate-limit 16/16, t2-08-hop-frist 7/7, t2-08-stundenlimit 6/6 |  | - |
| T-28 | ja | ERFUELLT | Kein openai/subject/userAgent/userLocation in src (grep 0 Treffer) -> nie Auth-Basis, Fehlen toleriert; Drossel keyt auf verifizierten Mandanten statt Client-_meta: src/mcp-rate-limit.js:19-22,:42-46; MRL-j/k gruen |  | - |
| T-29 | ja | ERFUELLT | Stateless: src/routes/mcp.js:268 sessionIdGenerator undefined; CORS: src/middleware.js:254-255 (Allow mcp-session-id, Expose Mcp-Session-Id) nur fuer gelistete Origins; test/s2-mcp-origin.test.js:633-651, 61/61 gruen |  | - |
| T-30 | ja | ERFUELLT | src/ui/contract.js:90-93 UI_CSP leere connect/resourceDomains, :120-125 am resources/read-Inhalt; Messung widgetHtml 0 Netz-Ladungen; t2-01-widget-resource-meta T1-T4/T8 (OAuth/Token/stdio) 12/12 gruen | Live-Probe offen: Annahme leerer CSP-Listen im OpenAI-Review | - |
| T-31 | ja | ERFUELLT | src/ui/contract.js:120-125: ui.domain=PUBLIC_URL-Origin nur bei ChatGPT-Egress-IP (routes/mcp.js:131,251), Alias openai/widgetDomain immer; t2-01 T9/T10 gruen | Live-Probe offen: kommt der Einreichungs-Scan aus den Egress-Bereichen? Bereichsliste ist statischer Schnappschuss (chatgpt-egress-ranges.json, 2026-09-22) ohne Aktualisierung | - |
| T-32 | ja | OWNER | Origin kommt allein aus PUBLIC_URL/RENDER_EXTERNAL_URL (src/config.js:1499), kein hartkodierter Origin in src; speist ui.domain/Audience/Herkunftswache | Endgueltiger Origin (Track-B-URL-Cutover, vodafone-agent vs. Marken-Domain) muss VOR Einreichung festgelegt und im Render-Dashboard gesetzt sein - spaetere Aenderung = neues Plugin | nein |
| T-33 | ja | TEILWEISE | tools/list mandantenunabhaengig (contract.js:18-26); aber nur hoechste Widget-Version registriert: contract.js:146-148 + widget-catalog.js:172-178; Umbenennungen ohne Alias mcp-tools.js:1513-1515,:1584-1586 | Kein Mechanismus, die live freigegebene Definition waehrend eines gehaltenen Updates lauffaehig zu halten: alte ui://-Versions-URIs liefern nach Hochzaehlen 'not found', Werkzeug-Umbenennungen ohne Alias | ja |
| T-34 | ja | ERFUELLT | Versionierte URIs ui://hermes/<id>/v<n>.html (src/ui/contract.js:25), Pin-Datei src/ui/widget-versions.json; test/openai-t2-02-widget-uris.test.js S7(a)-(d) 7/7 gruen (HTML-Aenderung erzwingt neue Version) |  | - |
| T-35 | nein | OWNER | Einstellung des OpenAI-Plattform-Projekts, im Repo nicht abbildbar | Einreichung aus einem Projekt mit globaler Datenresidenz (nicht EU) - Portal-Einstellung des Owners | nein |
| T-36 | ja | ERFUELLT | Eine universelle Route POST /mcp (src/routes/mcp.js:204), Mandant aus verifiziertem Token aufgeloest (:150-152 requestTenant), keine Template-/Workspace-URL |  | - |
| X-1 | ja | ERFUELLT | test/mcp-tool-annotations.test.js:152/:186 tools/list ueber echte /mcp-Route, alle 11 Werkzeuge mit read/destructive/openWorldHint, :254 stdio=HTTP; 6/6 gruen; p10a K1-K6 (legacy/OAuth/stdio) gruen |  | - |
| X-2 | ja | ERFUELLT | Ergebnis-_meta traegt nur hermes/locale (src/mcp-tools.js:1066) bzw. Re-Auth-Challenge mit Text in content (src/mcp-no-tenant.js:44-49); Modelldaten in content/structuredContent, Widget bindet structuredContent (call.html:718) |  | - |
| X-3 | ja | ERFUELLT | Standard-Keys ui.resourceUri/ui.csp/ui.domain + openai/toolInvocation/* (src/mcp-tools.js:959-960) am Draht (openai-p2-tool-metadaten 5/5 gruen); outputTemplate bewusst nicht (Test :286); fileParams/profile ohne Anwendungsfall | Live-Probe offen: call-Widget ruft get_call_status/cancel_call per tools/call (call.html:662) ohne openai/widgetAccessible bzw. ui.visibility - verlaesst sich auf Standard-Default | - |
| X-4 | ja | ERFUELLT | Kein Lesen von openai/locale/userAgent/userLocation/subject/session/organization/webplus/i18n in src (grep 0 Treffer); Sprache aus Tenant (src/routes/mcp.js:217-221), Identitaet nur aus Token |  | - |
| X-5 | ja | ERFUELLT | src/ui/widget-bind.js:34 UI_PROTOCOL_VERSION="2026-01-26", :192 im ui/initialize; test/mcp-ui-w1-bind.test.js:162 (T-W1-AC6) 15/15 gruen |  | - |
| X-6 | ja | ERFUELLT | Messung widgetHtml() aller 4 Widgets: 0 Treffer alert/prompt/confirm/clipboard/iframe/window.open/Storage/cookie; t2-01 T8 sperrt iframe/embed/object. Kein eigener Waechtertest fuer alert/clipboard |  | - |
| X-7 | ja | GEGENSTANDSLOS | Widgets leiten nirgends um: 0 Treffer open-link/redirect/location.href/window.open in src/ui; t2-01 T8 verbietet http(s)-URLs, window.open, openExternal im ausgelieferten HTML |  | nein |
| X-8 | ja | GEGENSTANDSLOS | Server bietet keine Skills: einzige Resources sind ui://-Widgets (src/ui/contract.js:146-148, mcp-tools.js:1120), 0 Treffer 'skill'/registerPrompt in src |  | nein |
| X-9 | ja | NICHT ERFUELLT | 0 Treffer openai/profile in src; kein Profil-Werkzeug im Inventar (docs/OPENAI-TOOL-INVENTORY.md:30-40, am Draht geprueft) | Profil-Werkzeug mit _meta openai/profile=true und stabiler id (z.B. tenantId). Nur Empfehlung (Kat. C); ob Multi-Account gewuenscht ist, ist Produktentscheid | ja |
| X-10 | ja | ERFUELLT | Funktionalitaet nur als Tools (11, p10a-Inventartest gruen); Resources ausschliesslich MCP-Apps-UI (contract.js:146), keine Prompts (0 Treffer registerPrompt) |  | - |
| O-1 | nein | OWNER | Liegt im OpenAI-Platform-Dashboard und ist im Repo nicht pruefbar. Hinweis: Firmenname und Rechtsform stehen im Impressum noch als [OFFEN], die Gesellschaft ist noch nicht gegruendet (apps/web/src/data/legal/imprint.de.json:6). | Individual- oder Business-Verifikation im OpenAI-Dashboard. Der Publisher-Name muss zu Impressum und Listing passen. | nein |
| O-2 | nein | OWNER | Organisations- und Projektzuordnung im OpenAI-Portal, im Repo nicht pruefbar. | Die Einreichung muss aus derselben Organisation und demselben Projekt kommen, in denen die Identitaet verifiziert wurde. | nein |
| O-3 | nein | OWNER | Rollen und Berechtigungen in der OpenAI-Organisation, im Repo nicht pruefbar. | Die Rechte api.apps.write und api.apps.read ("Apps Management: Write") im OpenAI-Konto vergeben. | nein |
| O-4 | ja | ERFUELLT | src/app.js:247-251: liefert den Token als reinen Klartext, bei leerem Wert 404; src/route-policy.js:99. test/openai-e7-challenge.test.js 9/9 gruen (echter Server: 200 byte-exakt, kein JSON, kein WWW-Authenticate, getrimmt). | Owner: den Portal-Token als OPENAI_APPS_CHALLENGE_TOKEN in Render setzen und deployen. Live-Probe offen. | - |
| O-5 | ja | ERFUELLT | Challenge-Route und /mcp laufen in derselben Express-App (src/app.js:581-582 registerPublicRoutes; src/routes/mcp.js:204). Ein einziger Host-Token ohne Pfad- oder Tenant-Segment (src/app.js:84). | Die Challenge-Base muss der Host sein, der /mcp bedient. Ein Parent-Host (Apex/www) liefert die Route nur, wenn er auf dasselbe Gateway zeigt; das haengt an der Deploy-Topologie (Owner). Live-Probe offen. | - |
| O-6 | nein | TEILWEISE | apps/web/src/data/legal/privacy.de.json hat Abschnitte zu Datenkategorien, Zwecken, Empfaengern, Speicherdauer und Rechten. Die 30-Tage-Frist deckt sich mit src/config.js:2036; woertliche Zitate sind per Default aus (config.js EVIDENCE_RETENTION_DAYS=0). | Nur Entwurf mit [OFFEN] (Anschrift, Datenschutzbeauftragter, AVV). Aufbewahrung bei EL unbegrenzt (-1). Nicht genannt: 7-Tage-Diagnose-Transkripte (config.js:2044) und Rohtranskripte abgebrochener Anrufe bis 30 Tage (call-finish.js:302). Nicht live. | nein |
| O-7 | nein | TEILWEISE | Website https://www.sundartha.com (src/mcp-server-info.js:58). Seiten apps/web/src/pages/datenschutz.astro, agb.astro, impressum.astro; Footer-Links in apps/web/src/layouts/Hermes.astro:23-25. | Keine eigene Support-URL, nur mailto im Footer (Site.astro:147); baubar. Anbieteridentitaet in Impressum, AGB und Datenschutz noch [OFFEN]. Portal-Eintrag und Deploy macht der Owner. | ja |
| O-8 | nein | ERFUELLT | kontakt@sundartha.com steht im Footer (apps/web/src/layouts/Site.astro:50,147, Link "Contact"), im Impressum (imprint.de.json:18) und in security.txt (src/app.js:93). | Owner: den Kontakt im Portal eintragen und das Postfach aktiv betreuen. | - |
| O-9 | ja | OWNER | Im Code gibt es keinen Reviewer- oder Demo-Account-Mechanismus (grep reviewer/demo in src/ und scripts/ findet nur den Owner-Seed, src/db/migrate.js:196). Outbound setzt Abo und KYC voraus (src/telephony/outbound-gates.js:758). | Noetig: WorkOS-Konto ohne MFA und ohne E-Mail-Bestaetigung, ein bezahlter und verifizierter Tenant mit Beispiel-Anrufen in Prod und ein zulaessiges Test-Anrufziel. Alles davon braucht Anbieter-Zugang oder Prod-DB, also den Owner. | nein |
| O-10 | nein | NICHT ERFUELLT | Auf master gibt es kein Dokument mit 5 positiven und 3 negativen Testfaellen. git ls-files docs zeigt nur OPENAI-AUTH-ABWEICHUNGEN, OPENAI-POLICY-ABGLEICH und OPENAI-TOOL-INVENTORY, keines davon mit einem Testfall-Katalog. | Testfall-Katalog mit Prompt, erwartetem Verhalten, Ergebnisform und Repro-Daten. Die Repro-Daten haengen am Demo-Konto (O-9). | ja |
| O-11 | nein | OWNER | Das sind Portal-Angaben. Im Repo vorhanden: Name "hermes", Icon und websiteUrl in HERMES_SERVER_INFO (src/mcp-server-info.js:58) sowie die Marken-Assets unter public/brand/. | Kurz- und Langbeschreibung, Kategorie, Starter-Prompts, Lokalisierung, Laender, Release Notes und Attestationen im Portal. Textentwuerfe dafuer gibt es noch nicht; sie sind ohne Owner baubar. | ja |
| O-12 | nein | OWNER | Lokales tools/list ueber /mcp: mit MCP_UI_ENABLED=true tragen place_call, list_calls, get_agent_number und get_agent_status _meta.ui.resourceUri; ohne das Flag traegt kein Werkzeug UI. | Owner: den Prod-Wert von MCP_UI_ENABLED klaeren. Mit UI Screenshots der 4 Widgets einreichen, ohne UI keine. | nein |
| O-13 | ja | TEILWEISE | Whitelists pickAgentStatus und pickCall (src/mcp-tools.js:588-633), keine Action-Item-ID mehr (:1686). Gruen ueber HTTP /mcp und stdio: openai-p5a (4/4), openai-p5b (7/7), openai-t2-09 (11/11). | get_call_status liefert last_transcript_lines (woertliche Zeilen der Gegenseite) bei jedem Status (src/mcp-tools.js:193-201, im Code als offener Befund markiert). Dazu zwei Sammelfelder briefing und context in der Eingabe. | ja |
| O-14 | ja | TEILWEISE | Bankdaten-Grenze im Prompt (src/claude.js:232), allowBankData per Default false (defaults.js:619) und nur restriktiv setzbar (self-service.js:24). place_call.briefing sagt: "NO secrets, passwords or payment data". | Keine serverseitige Erkennung oder Filterung. Gesundheitsangaben und amtliche Kennnummern in briefing, context und Transkript sind nicht behandelt; Anrufe etwa bei Arztpraxen verarbeiten PHI-nahe Inhalte. | ja |
| O-15 | nein | NICHT ERFUELLT | Keine Einwilligungs- oder Hinweisstelle fuer Gesundheitsdaten o.ae. privacy.de.json nennt Art. 9 und besondere Kategorien nicht (grep ohne Treffer). briefing, context und objective in place_call sagen nichts zu besonderen Kategorien. | Owner-Entscheidung zu Rechtsgrundlage und Einwilligung plus prominente Offenlegung. Ein Minimierungshinweis in den Werkzeugtexten waere danach baubar. | nein |
| O-16 | ja | ERFUELLT | Das Beziehungsgedaechtnis laeuft nur mit allowCallMemory: Default false (src/store/defaults.js:639), Gate in state-ops.js:1805, nicht per Self-Service setzbar (self-service.js:20-24). In src/ gibt es kein Analytics- oder Tracking-SDK. | Der Prod-Wert von allowCallMemory je Tenant ist unbekannt. Ist er irgendwo an, fehlt die Offenlegung in privacy.de.json. | - |
| O-17 | ja | ERFUELLT | tools/list ueber HTTP /mcp (lokal, PORT=0) zeigt nur diese Eingaben: to, objective, briefing, constraints, mandate, context, language, max_duration_s, diagnostic, call_id, include_seen (bei Consult zusaetzlich event_id/answers). Kein Standortfeld; kein Treffer fuer location/geo in mcp-tools.js. |  | - |
| O-18 | nein | TEILWEISE | Die Gates sind da (outbound-gates.js:687-960: frozen, KYC, Denylist, Stunden- und Ziel-Limit, Budget). Aber place_call-Beschreibung, Instructions (mcp-server-info.js) und Prompt (i18n/prompts/en.js) haben keine Zweckbindung. | Den Volltext der Usage Policies muss der Owner im Browser abgleichen. Es fehlt eine Zweckbindung (Werbung, Politik, zulassungspflichtige Beratung) in Werkzeugtext, Instructions und Prompt; die ist baubar. | ja |
| O-19 | ja | TEILWEISE | Pro Tenant 6 Anrufe pro Stunde (config.js:1549), 3 je Ziel in 24 h (config.js:1558-1565), Abo und KYC (outbound-gates.js:758), fester Offenlegungssatz. Die AGB verbieten Werbeanrufe ohne Einwilligung (terms.de.json, "Pflichten des Nutzers"). | Kein Verbot von Telemarketing oder Werbeanrufen in place_call-Beschreibung, Server-Instructions oder Gespraechsprompt; der Server prueft den Anrufzweck nicht. | ja |
| O-20 | ja | ERFUELLT | Kein Werkzeug zeigt Tarife, Checkout oder Upgrade. Die Ablehnungstexte sind neutral (src/i18n/mcp-denial-texts.js, bei "minutes" kein Upgrade-Hinweis), der No-Tenant-Text hat keinen Signup-Link (mcp-texts.js:186). test openai-t2-09 11/11 gruen. | Hinweis: Der Dienst selbst ist ein ausserhalb verkauftes Digital-Abo, und place_call verbraucht Minuten. Ob OpenAI das zulaesst, entscheidet das Review. | - |
| O-21 | ja | ERFUELLT | Tool-Ausgaben sind Whitelists (src/mcp-tools.js:588-633). Die Widgets haben keine externen Links und keine Werbung (grep href/https in src/ui/widgets/*.html findet nur eine data:-SVG). Die Instructions (mcp-server-info.js) enthalten keine Werbung. |  | - |
| O-22 | ja | ERFUELLT | Die Werkzeuge sprechen die eigene REST-API an (src/mcp-tools.js call("GET","/api/state")) und haben eigene Geschaeftslogik (Gates outbound-gates.js, Billing src/billing/). Eigener Dienst mit eigener Nummer, kein Pass-through zu einem Drittdienst des Nutzers. |  | - |
| O-23 | ja | ERFUELLT | Nur offizielle APIs mit eigenen Schluesseln: Exa (src/research/adapters/exa-search.js:42), Telnyx-Adapter (src/telephony/adapters/telnyx/). Die LLM-Naht hat begrenzte Retries und einen Circuit-Breaker (src/llm.js:247,258). Kein Scraping. | Ob die Nutzung den Anbieter-AGB entspricht (z.B. Telnyx-AUP fuer automatisierte Anrufe, ElevenLabs-ToS), ist am Code nicht pruefbar; das klaert der Owner. | - |
| O-24 | nein | OWNER | Keine altersbezogenen oder nicht jugendfreien Inhalte. Die Denylist sperrt Premium- und Servicenummern (src/telephony/number-denylist.js:40-42). Die AGB (terms.de.json) nennen weder Mindestalter noch Zielgruppe. | Zielgruppe und Mindestalter sind eine Rechtsentscheidung: Vertragsschluss und Zahlungsmittel setzen Geschaeftsfaehigkeit voraus, OpenAI laesst aber keine 18+-Einstufung zu. Die Festlegung in den AGB macht der Owner. | nein |
| O-25 | ja | ERFUELLT | Lokales tools/list zeigt 9 produktive Werkzeuge, get_calendar ist entfernt (test/openai-p8-widget-ui.test.js 12/12 gruen, Pin :90; mcp-tools-i18n 4/4). Echte Telefonie ist nicht-native Funktionalitaet. | Live-Probe zu Stabilitaet und Antwortzeit offen. Nebenbefund: mandate.on_out_of_scope wirkt auf dem EL-Weg nicht (src/elevenlabs/outbound.js:615), obwohl die Beschreibung es verspricht. | - |
| O-26 | ja | ERFUELLT | src/ui/contract.js:89-92 UI_CSP connect/resourceDomains leer, kein frameDomains; 0 Treffer iframe/embed/object in src/ui; test/openai-t2-01-widget-resource-meta.test.js T1-T4/T8 (OAuth, Token, stdio) gruen 12/12 |  | - |
| O-27 | ja | ERFUELLT | Tool-/Instruktionstexte nennen/bevorzugen kein Fremd-Plugin: mcp-server-info.js:99-146, mcp-tools.js:739-829; Tests T11-n (openai-t2-11) + P4 O-27 (openai-p4-...instructions) gruen. Grenzfall: 'answer from your own tools and context first' (generisch) |  | - |
| O-28 | nein | OWNER | Portal-Prozessschritt nach Review-Freigabe; kein Code-Anteil im Repo | Owner publiziert nach Freigabe selbst; Directory-Platzierung nicht beantragen | nein |
| O-29 | nein | OWNER | Kommunikationspflicht, kein Code-Anteil | Presse/Ankuendigungen vorab mit press@openai.com abstimmen | nein |
| O-30 | nein | OWNER | Portal-Regel zur Versionsverwaltung, kein Code-Anteil | Owner haelt je Integration max. eine publizierte und eine Version im Review | nein |
| O-31 | ja | OWNER | OpenAI-Vorbehalt; technisch relevant ist Stabilitaet: render.yaml:13 plan: free fuer den Gateway-Service (Free-Plan schlaeft bei Inaktivitaet ein), healthCheckPath /healthz render.yaml:30 | Live-Plan/Uptime im Render-Dashboard pruefen (Live != render.yaml, Render-Workspace fuer Lesezugriff nicht gewaehlt); stabiler aktiver Betrieb nach Publikation | nein |
| N-1 | ja | ERFUELLT | mcp-tools.js:881-952 alle 11 Tools mit readOnly/destructive/openWorldHint; am Draht: test/mcp-tool-annotations.test.js (6/6) + test/openai-p10a-tool-inventar.test.js K1-K6 HTTP-Legacy/OAuth/stdio (6/6) gruen | Live-Probe offen (master nicht live) | - |
| N-2 | ja | ERFUELLT | readOnlyHint:true nur fuer 6 reine GET-Tools (GET /api/calls/:id, GET /api/state, api-read.js:63-107 schreibt nichts); check_inbox (POST poll) und await_call_event (schreibt Marker) false, mcp-tools.js:881-952 | Live-Probe offen (master nicht live) | - |
| N-3 | ja | ERFUELLT | destructiveHint:true bei place_call, answer_consult (indirekt: am Telefon ausgesprochen), cancel_call, mcp-tools.js:882-922; tabellentreu ueber /mcp geprueft in test/mcp-tool-annotations.test.js P1 (N-3) gruen | Live-Probe offen (master nicht live) | - |
| N-4 | ja | ERFUELLT | openWorldHint:true bei place_call, answer_consult, cancel_call (Carrier/Gegenueber), sonst nur eigener Store, mcp-tools.js:881-952; am Draht geprueft test/mcp-tool-annotations.test.js P1 gruen | Live-Probe offen (master nicht live) | - |
| N-5 | nein | OWNER | Begruendung je Tool und Hint (11 Tools) in docs/OPENAI-TOOL-INVENTORY.md:80-236, Werte gegen Draht geprueft (openai-p10a-tool-inventar gruen); Inhalt stichprobenartig codetreu | Eintrag im Einreichungsformular durch Owner. Zeilenverweise der Doku veraltet (place_call :919 statt :1171, cancel :717 statt :783, consult :658 statt :724), ohne Owner korrigierbar | nein |
| N-6 | ja | ERFUELLT | Folgeaussage zu N-1..N-4: alle Annotationen vorhanden und begruendet; test/mcp-tool-annotations.test.js + test/openai-p10a-tool-inventar.test.js gruen | Live-Probe offen (master nicht live) | - |
| N-7 | ja | ERFUELLT | Kein Tool ohne readOnlyHint: Test 'kein registriertes Werkzeug kommt ohne die drei Pflicht-Annotationen durch' + E2E /mcp in test/mcp-tool-annotations.test.js, stdio K6 in openai-p10a, gruen | Live-Probe offen (master nicht live) | - |
| N-8 | ja | ERFUELLT | Host-Verhalten; Voraussetzung erfuellt: alle 5 schreibenden Tools (place_call, await_call_event, answer_consult, cancel_call, check_inbox) readOnlyHint:false, mcp-tools.js:881-952 | Live-Probe im ChatGPT Developer Mode offen (Owner) | - |
| N-9 | ja | ERFUELLT | Alle Tools mit Aussenwirkung (place_call waehlt, answer_consult wird am Telefon weitergegeben, cancel_call sendet Hangup) readOnlyHint:false, mcp-tools.js:881-922; lesende Tools nur GET ohne Aussenkontakt | Live-Probe offen (master nicht live) | - |
| N-10 | ja | TEILWEISE | Autorisierung/Validierung serverseitig: POST /mcp mcpAuth routes/mcp.js:204, internalOnly + zod + runOutboundGates api-calls.js:458-483. Bestaetigung: 0 Treffer elicit/confirm in src/mcp-tools.js | Keine serverseitige Bestaetigung fuer place_call/answer_consult/cancel_call, nur Host-Rueckfrage via readOnlyHint:false; OpenAI: Annotationen ersetzen 'confirmation in your server' nicht | ja |
| N-11 | ja | ERFUELLT | Seiteneffekte offengelegt: place_call billed/NOT reversible/dedup (mcp-tools.js:739-740, api-calls.js:373), await_call_event 'writes to the call record', check_inbox CONSUMING; idempotentHint je Schreibtool; mcp-tool-annotations P1 gruen |  | - |
| N-12 | ja | ERFUELLT | 11 eindeutige Verb-Namen ohne Werbesprache (mcp-tools.js:1171-1711); test/openai-t2-11-werkzeugtexte.test.js T11-a/T11-n (60/60) gruen, Namensmenge K1-K6 in openai-p10a gruen |  | - |
| N-13 | ja | TEILWEISE | Keine Fremd-Plugin-Bezuege, Feldnennung geprueft (T11-d/e/e2 gruen). Abweichung: list_action_items 'Lists open action items from all calls' (mcp-tools.js:1676) filtert nur die 50 neuesten Items (api-read.js:21,77) | Beschreibung von list_action_items behauptet 'from all calls', Handler sieht nur STATE_ACTION_ITEMS=50 neueste; Text oder Kappung anpassen (geringe Schwere) | ja |
| N-14 | ja | ERFUELLT | place_call-Inputs mcp-tools.js:1176-1340 (to, objective, briefing mit 'SUMMARISE instead of copying in raw', constraints, mandate, context, language, max_duration_s, diagnostic): kein Verlauf/Transkript/Standort; Rest nur call_id/Flags |  | - |
| N-15 | ja | ERFUELLT | 0 Treffer sampling/createMessage/elicit in src; Handler lesen kein Request-_meta (0 Treffer extra/_meta-Zugriff in mcp-tools.js, routes/mcp.js); Kontext nur ueber vom Modell zusammengefasstes briefing |  | - |
| N-16 | ja | GEGENSTANDSLOS | Server nutzt keine MCP-Elicitation: grep -rni 'elicit' src = 0 Treffer, keine Elicitation-Capability in mcp-server-info.js |  | nein |
| W-1 | nein | GEGENSTANDSLOS | Plattform-Einordnung ohne Dienstpflicht; Developer-Mode-Anbindung braucht nur den vorhandenen Streamable-HTTP-Endpunkt POST /mcp (src/routes/mcp.js:204) |  | nein |
| W-2 | nein | OWNER | Prozessentscheidung; Ziel laut CLAUDE.md ist ein oeffentliches Produkt, kein Code-Anteil | Owner reicht nur bei beabsichtigter oeffentlicher Verfuegbarkeit ein und legt Laender fest; private Tests im Developer Mode | nein |
| W-3 | nein | OWNER | Portal-Prozess (Submission, Review, Publish), kein Code-Anteil | Einreichung im Plugin-Submission-Portal, Review und Publish durch Owner | nein |
| W-4 | ja | GEGENSTANDSLOS | Reiner API-Weg (Responses-API type:mcp) ohne Veroeffentlichung; fuer die Directory-Einreichung nicht benoetigt, kein Code-Anteil |  | nein |
| W-5 | ja | GEGENSTANDSLOS | Agents-API MCP connections = weiterer API-Weg ohne Veroeffentlichung; fuer die Directory-Einreichung nicht benoetigt, kein Code-Anteil |  | nein |
| W-6 | ja | ERFUELLT | Kein Tunnel: grep -rni tunnel src = 0 Treffer; oeffentlicher Render-Web-Service render.yaml:4-30; boot-guard.js:982 verweigert nicht-https PUBLIC_URL | Live-Probe offen; stabile Einreichungs-URL vor Einreichung festlegen (Track-B-URL-Cutover steht aus, Origin friert bei Einreichung ein) - Owner | - |
| W-7 | nein | OWNER | Aus dem Repo nicht pruefbar, ob bereits eine publizierte ChatGPT/Codex-Integration existiert | Owner bestaetigt: keine bestehende publizierte Integration referenziert, Server wird neu eingereicht | nein |

## Stichprobe

12 von 12 Belegen bestaetigt; widerlegt: keine. Damit aendert die Stichprobe keine Zeile (keine ERFUELLT-Zeile faellt auf TEILWEISE).

## Gesondert gemeldete Sicherheitsmaengel

- N-10: place_call (kostenpflichtiger, irreversibler Anruf an Dritte), answer_consult und cancel_call laufen ohne serverseitige Bestaetigung, sobald der Host den Aufruf zulaesst (src/mcp-tools.js:1171ff; 0 Treffer elicit/confirm). Laesst ein Host Write-Actions ohne erneute Rueckfrage zu (ChatGPT laut Doku Bestaetigung je Konversation, Claude 'always allow'), kann eine Prompt-Injection weitere Anrufe ausloesen. Begrenzt nur durch die Gates (Abo+KYC, Denylist, Land, Stundenlimit, Kostendecke, OUTBOUND_FROZEN); kein Gate-Bypass.

Nicht gepruefte IDs: keine.

## Zaehlung

Grundlage: 100 IDs, davon 79 technisch (Spalte "technisch" = ja). Regel: eine per Stichprobe widerlegte ERFUELLT-Zeile zaehlt als TEILWEISE - hier ohne Wirkung (widerlegt: keine).

| Status | technisch | nicht technisch | gesamt |
|---|---|---|---|
| ERFUELLT | 55 | 1 | 56 |
| GEGENSTANDSLOS | 11 | 1 | 12 |
| OWNER | 6 | 14 | 20 |
| TEILWEISE | 6 | 3 | 9 |
| NICHT ERFUELLT | 1 | 2 | 3 |
| Summe | 79 | 21 | 100 |

Technisch offen (TEILWEISE / NICHT ERFUELLT): T-33, O-13, O-14, O-19, N-10, N-13, X-9.
Technisch OWNER: T-9, T-11, T-16, T-32, O-9, O-31.

## Abgleich gegen die offenen Phasen T2-13 bis T2-22

Phasen-IDs laut tasks/PLAN-OPENAI-TECHNIK-2.md (Phasenkoepfe): T2-13 N-10 (Server), T2-14 N-10 (Widget), T2-15 O-14, T2-16 O-27/N-14/O-15/O-19 (+ O-18, entschieden), T2-17 T-21, T2-18 T-33, T2-19 O-7, T2-20 O-9, T2-21 O-10, T2-22 O-11.

Technische Luecken MIT offener Phase:

- T-33 -> T2-18
- O-14 -> T2-15
- O-19 -> T2-16
- N-10 -> T2-13 + T2-14 (erst zusammen erfuellt)
- O-9 -> T2-20 (Zeile steht als OWNER; baubarer Teil s. Owner-Pruefung)

Baubare, nicht technische Luecken mit offener Phase (zur Vollstaendigkeit):

- O-18 -> T2-16 (entschieden: Zweckbindung in den Werkzeugtexten)
- O-15 -> T2-16 (nur der Minimierungshinweis; Rechtsgrundlage/Einwilligung bleibt Owner)
- O-7 -> T2-19
- O-10 -> T2-21
- O-11 -> T2-22

Technische Luecken OHNE offene Phase:

- O-13: last_transcript_lines liefert woertliche Gegenseiten-Zeilen bei jedem Status. T2-15 maskiert darin nur Karte/IBAN, T2-16 engt briefing/context ein; keine offene Phase fuehrt O-13 (T2-09 gemergt).
- N-13: list_action_items-Text sagt 'from all calls', Handler sieht nur die 50 neuesten Items (api-read.js:21,77). T2-11/T2-12 sind gemergt, keine offene Phase fuehrt N-13.
- X-9: Profil-Werkzeug mit openai/profile fehlt. Der Plan stuft es bewusst als optional/weggelassen ein (PLAN-OPENAI-TECHNIK-2.md:99, :1208) - Produktentscheid, keine Phase.

Hinweis: drei offene Phasen zielen (auch) auf bereits ERFUELLT gemessene IDs - T2-16 auf O-27 und N-14, T2-17 auf T-21. Das sind Verbesserungen, keine Luecken.

## Owner-Pruefung

Regel: OWNER nur bei Deploy/Push, ChatGPT-Dev-Mode-Messung, Token dekodieren, Dashboard-Werte, Anbieter-Einstellungen, Live-Proben, Rechtstexte, Portal-Eintraege.

Regelkonform (fehlender Teil ist Owner-Arbeit): T-9, T-11, T-16 (echtes Token / WorkOS-Einstellung / Dev-Mode-Probe), T-32 (Origin-Festlegung im Render-Dashboard), T-35, O-1, O-2, O-3, O-28, O-30, W-3, W-7 (Portal), O-12 (Prod-Wert MCP_UI_ENABLED, Screenshots aus dem Host), O-24 (Rechtstext AGB), O-29 (Kommunikation, kein Code-Anteil), O-31 (Render-Dashboard/Uptime), W-2 (Einreichungs-/Laenderentscheid im Portal).

Zweifel (fehlender Teil ist in Wahrheit ganz oder teilweise baubar):

- O-9: Reviewer-Anleitung, Seed-Skript fuer Beispiel-Anrufe/Action Items und Login-Pfad sind baubar (T2-20). Owner bleibt nur: WorkOS-Konto anlegen, Seed in Prod ausfuehren, KYC/Abo des Reviewer-Tenants.
- O-11: Textentwuerfe (Beschreibungen, Kategorie, Starter-Prompts, Lokalisierung, Release Notes) sind laut Zeile selbst baubar (T2-22). Owner bleibt nur der Portal-Eintrag.
- N-5: die veralteten Zeilenverweise in docs/OPENAI-TOOL-INVENTORY.md sind ohne Owner korrigierbar; keine offene Phase fuehrt das. Owner bleibt nur der Formular-Eintrag.
