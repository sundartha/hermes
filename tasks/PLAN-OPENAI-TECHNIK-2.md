# PLAN-OPENAI-TECHNIK-2 - technische Restarbeiten der OpenAI-Einreichung, Runde 2

Basis: master `288376b`. Liste: `tasks/openai-audit/00-openai-anforderungen.md` (100 IDs, davon
81 technisch, 19 nicht technisch). Ausgangsmessung: Anhang A. Keine Produktionswerte, keine
Secrets in dieser Datei; `<origin>` steht fuer den Einreichungs-Origin (Wert = Owner).

Stand der Ausgangsmessung: 39 ERFUELLT, 7 GEGENSTANDSLOS, 4 OWNER, 31 in 23 Phasen.

Owner-Entscheidungen 2026-09-22 sind eingearbeitet: Einreichung MIT Widget-UI (auch in ChatGPT
sichtbar), Breaking Changes an Werkzeugen erlaubt (u.a. `get_transcript` umbenennen). Die
"Autonomen Entscheidungen" aus `tasks/openai-technik-stand.md` gelten; die einzige Reibung
(D0-4 gegen T-29) ist in Abschnitt 2.2 aufgeloest und fuer den Lead markiert.

Kritiker-Runde 2 (beide Blocker am Code/an der Quelle bestaetigt und eingearbeitet, daher keine
Kritik-Einwaende): (1) die endgueltigen Toolnamen stehen fest in T2-11 (Tabelle) samt exakter
Namensmengen je Pfad; (2) N-10 verlangt einen fuer den Menschen sichtbaren Schritt - der
Bestaetigungscode steht nur im Ergebnis-`_meta` (laut OpenAI fuer das Modell unsichtbar) und
erreicht das Modell erst durch einen Klick in der Karte. Dafuer ist die Widget-Haelfte eine eigene
Phase (heute T2-14).

Kritiker-Runde 3 (alle fuenf Blocker am Code/an der Quelle bestaetigt und eingearbeitet, daher
keine Kritik-Einwaende; Belege stehen an der jeweiligen Phase):
(1) `confirmation_code` ist im `inputSchema` von `place_call` OPTIONAL, die Pflicht setzt der
Handler durch - SDK 1.29 prueft das Schema vor dem Handler und macht aus einem fehlenden
Pflichtargument ein `isError` mit "MCP error -32602: Input validation error ..." ohne Handlertext
(T2-13); (2) N-12/N-13 werden an allen sichtbaren Texten gemessen (Titel, `annotations.title`,
`openai/toolInvocation/*`, Beschreibung), nicht nur am Namen (T2-11); (3) Produktion heisst in
T2-03 `detectProduction()` (= `RENDER_EXTERNAL_URL`), keine zweite Definition ueber `NODE_ENV`;
(4) T2-07 prueft zuerst und zaehlt nur Ungueltige (IEX-A7), abgelaufene gueltig signierte Tokens
zaehlen nicht, der Rest der JWT-Flut ist benannt; (5) die Widget-Haelfte der Umbenennung ist die
eigene Phase T2-12 (Risiko widget) mit Draht-Gegenprobe des Call-Widgets. Dadurch heissen die
frueheren T2-12..T2-21 jetzt T2-13..T2-22.

Kritiker-Runde 4 (ein Blocker, am Code und an der Quelle bestaetigt und eingearbeitet, daher keine
Kritik-Einwaende): T-16 stand als OWNER mit "Im Repo nichts zu bauen", hat aber einen baubaren
Resource-Server-Anteil. Gemessen am Code: das PRM-Dokument (`src/auth.js:143-150`) hat kein
`scopes_supported`, die 401-Challenge des OAuth-Zweigs (`src/auth.js:74-77`) kein `scope=`,
`TOOL_SECURITY_SCHEMES` deklariert `scopes: []` (`src/mcp-security-schemes.js:26-28`). Nach der
MCP-Scope-Wahl fragt ein spec-treuer Client dann GAR keinen Scope an (Zitat in T2-23) - auch der
MCP Inspector, mit dem OW-B `email_verified` belegen soll. Neue Phase **T2-23** (Risiko auth,
eigene Gegenprobe); sie behaelt ihre Nummer, damit die Querverweise T2-04..T2-22 stabil bleiben,
und laeuft nach T2-03, vor T2-04. OWNER bleibt nur, was die Owner-Regel deckt: das echte Token
und die UserInfo-Antwort des AS (OW-B). Eine Nuance, die den Blocker nicht aufhebt: fuer ChatGPT
schreibt OpenAI, es frage die vom AS beworbenen OIDC-Scopes "by default" an - ob das vor oder
hinter der MCP-Scope-Wahl greift, ist nicht dokumentiert; fuer Claude und den Inspector gilt die
Luecke sicher. Folge fuer T-12: wer Scopes in `securitySchemes` markiert, muss sie laut OpenAI am
Token pruefen ("contains the scopes you marked as required"); der Scope-Teil von T-12 liegt
deshalb ebenfalls in T2-23, getrennt committet und mit eigener Deploy-Vorbedingung.

---

## 1. Abdeckung

### 1a. Technische IDs, die NICHT erfuellt sind (42)

| ID | Einordnung | Grund / Beleg |
|---|---|---|
| T-3 | GEGENSTANDSLOS | Kein privater Server hinter Proxy, sondern oeffentlicher Dienst; Auth haengt nicht an der IP (`src/auth.js:18-20` Loopback-Bypass in Produktion aus, `/mcp` immer hinter `mcpAuth`, `src/routes/mcp.js:113`). |
| T-5 | T2-03 | Resource-Server-Seite steht; offen: `exp` (T-12) und fehlendes Signal bei Nicht-OAuth in Produktion. Der Rest (E2E-Login) haengt an T-9/T-11 (Owner). |
| T-9 | OWNER | Echtes Access-Token dekodieren (`aud`). Repo-Seite fertig: `aud`-Erwartung und PRM.resource aus derselben `audience()` (`src/auth.js:23,100,144`), falsches `aud` -> 401 (`test/oauth.test.js:72-76`). |
| T-11 | OWNER | Live-Probe in ChatGPT: nimmt der AS die callback-spezifische Redirect-URI an? Hermes ist reiner Resource-Server und sendet keine Authorization-Response. |
| T-12 | T2-03 + T2-23 | `jwtVerify` ohne `requiredClaims` (`src/auth.js:98-102`): Token ohne `exp` gilt unbefristet (T2-03). Scope-Teil: sobald T2-23 Scopes in `securitySchemes` markiert, muss der RS sie am Token pruefen; heute 0 Pruefstellen (`docs/OPENAI-AUTH-ABWEICHUNGEN.md:166`). Erfuellt erst nach beiden. |
| T-14 | T2-05 | Kein Tool-Ergebnis mit `_meta["mcp/www_authenticate"]`; Fall "gueltiges Token, kein Mandant" endet heute als HTTP 403. |
| T-16 | T2-23 | Resource-Server-Anteil baubar (Kritiker-Runde 4): PRM ohne `scopes_supported` (`src/auth.js:143-150`), 401-Challenge ohne `scope=` (`src/auth.js:74-77`), `securitySchemes` mit `scopes: []` (`src/mcp-security-schemes.js:26-28`) - ein spec-treuer Client fragt dadurch `openid`/`email` nicht an. AS-Seite (Discovery, `openid`/`email` beworben, `userinfo_endpoint` antwortet 401 ohne Token) belegt in `docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 2 T-16. Owner-gebundener Rest nach der Owner-Regel: echtes Token + UserInfo-Antwort (`email`, `email_verified: true`) = OW-B. Erfuellt erst nach T2-23 UND OW-B. |
| T-17 | GEGENSTANDSLOS | OpenAI nennt mTLS nur fuer private Server: "If the MCP server must remain private, deploy a public HTTPS proxy ... Use OpenAI-managed mTLS to authenticate ChatGPT as the MCP client" (https://developers.openai.com/plugins/build/mcp-server). Hermes ist oeffentlich (wie T-3), Kategorie C. Zusaetzlich kann das Hosting keine Client-Zertifikate pruefen (offener Feature-Request https://feedback.render.com/features/p/client-certificate-support). |
| T-21 | T2-17 | Consult-Modus: Schleifen-Kern beginnt erst bei Zeichen 404, Quittung `status=working` hinter Zeichen 512. |
| T-23 | T2-01 | Skybridge-Adapter liefert bei `params.capabilities` im Request NUR `openai/outputTemplate` (`src/ui/registry.js:57`, `src/routes/mcp.js:158`). |
| T-24 | GEGENSTANDSLOS | Kein Deep Research / Company Knowledge; kein `search`/`fetch` am Draht (HTTP 12, stdio 10 Tools). |
| T-25 | GEGENSTANDSLOS | Folgt aus T-24; kein Tool-Output mit `url`-Feld. |
| T-27 | T2-08 | Hop-Fristen fehlen bei `cancel_call`/`answer_consult`/`check_inbox` (`src/mcp-tools.js:60-70`); Stundenlimit zaehlt ohne Sperre (`src/telephony/outbound-gates.js:364-379`). Limiter-Anteil (je IP statt je Mandant) liegt in T2-07. |
| T-28 | T2-07 | Einziger `/mcp`-Limiter zaehlt je `req.ip` vor der Auth (`src/app.js:151-157`, `src/middleware.js:270-282`). |
| T-29 | T2-06 | Kein CORS-Header in `src/`; Wert von `MCP_ALLOWED_ORIGINS` setzt der Owner nach Messung (OW-C). |
| T-30 | T2-01 | `_meta.ui.csp` haengt am Tool, `resources/read` liefert nur `uri`/`mimeType`/`text` (`src/ui/contract.js:144-160`). |
| T-31 | T2-01 | Wie T-30 fuer den Origin (`src/ui/contract.js:131-134`). |
| T-32 | T2-04 | Stiller Rueckfall auf den Hosting-Host, wenn `PUBLIC_URL` fehlt (`src/config.js:1499`). |
| T-33 | T2-18 | Nichts verhindert entfernte/umbenannte Tools oder neue Pflichtargumente; kein Update-Runbook. |
| T-34 | T2-02 | Statische URI `ui://hermes/<id>` (`src/ui/contract.js:18-20`), Inhalt haengt von der Mandanten-Sprache ab (`:158`). |
| N-10 | T2-13 + T2-14 | Keine serverseitige Bestaetigung vor dem Waehlen; heute nur Host-Bestaetigung (ChatGPT einmal je Konversation, N-8). Server-Teil T2-13, sichtbarer Schritt T2-14; erfuellt erst nach beiden. |
| N-11 | T2-11 | `answer_consult` verschweigt, dass die Antwort beim Angerufenen ankommen kann (Beschreibung vs. `src/mcp-tools.js:630`). |
| N-12 | T2-11 + T2-12 | `get_transcript` liefert nie ein Transkript, Titel und Statuszeilen behaupten es auch (`src/mcp-tools.js:682,750`); `get_my_number` liefert die Agenten-Nummer. Serverseite T2-11, Karten T2-12. |
| N-13 | T2-11 + T2-12 | `get_agent_status` nennt seine Felder nicht, sichtbare Texte von `get_transcript` (T2-11); `get_calendar` zeigt Demo-Daten (`src/store/defaults.js:19-23`) und faellt mit seiner Karte (T2-12). |
| N-14 | T2-16 | `briefing` fordert breit "context from the chat so far"; `context` ist ein zusaetzlicher Sammeltrichter. |
| N-16 | GEGENSTANDSLOS | Keine Elicitation (grep `elicit` in `src/`: 0). Bleibt so: T2-13 nutzt bewusst keine (zustandsloser Transport, siehe dort); der sichtbare Schritt laeuft ueber die Karte (T2-14, `ui/message`). |
| O-4 | OWNER | Wert des Challenge-Tokens, Dashboard, Deploy. Code fertig: `src/app.js:219-223`, `test/openai-e7-challenge.test.js` 9/9. |
| O-6 | OWNER | Rechtstext-Inhalte (Empfaenger OpenAI, EN-Fassung, offene Marken), `retention_days` beim Sprach-Anbieter, `RETENTION_DAYS` im Dashboard. Einhaltung im Code belegt (Retention-Sweep `src/boot.js:1255-1256`). Faktenblatt fuer den Owner entsteht in T2-10. |
| O-7 | T2-19 | Keine Support-URL (nur `mailto`). Impressum/EN-Rechtstexte sind Rechtstext = Owner. |
| O-9 | T2-20 | Kein Reviewer-Runbook, kein Seed-Skript. Anlegen in Produktion = Owner. |
| O-10 | T2-21 | Kein einreichungsfertiges EN-Dokument; Vorarbeit `tasks/openai-audit/16-review-testfaelle.md` nutzt `get_calendar`. |
| O-11 | T2-22 | Kein Listing-Entwurf. Name/Kategorie/Laender/Attestation = Owner. |
| O-13 | T2-09 | Interne ID in `list_action_items` (`src/mcp-tools.js:1438-1441`); roher `json.error` inkl. Env-Namen (`src/mcp-tools.js:73`, `outbound-gates.js:667`). |
| O-14 | T2-15 | Kein Ausschluss in den meisten Freitextfeldern, keine serverseitige Pruefung, Restricted Data der Gegenseite ungefiltert im Output. |
| O-15 | T2-16 | Keine Minimierungsanweisung fuer Gesundheitsangaben in Feldbeschreibungen. Rechtstext-Anteil = Owner (OW-J). |
| O-18 | T2-10 | Kein belegter Abgleich Usage Policies gegen Hermes im Repo. |
| O-19 | T2-16 | Keine Zweckbindung gegen Telemarketing in Beschreibung/Instructions. |
| O-20 | T2-09 | 402-Text "Bitte Tarif anpassen" erreicht `place_call` (`outbound-gates.js:894-900` via `src/mcp-tools.js:73`). |
| O-25 | T2-12 | Demo-Kalender auf der Werkzeug-Oberflaeche (Tool und Karte fallen gemeinsam, Verwaisungs-Pruefung in beide Richtungen). Widget-Vollstaendigkeit via T2-01; Live-Stabilitaet = Owner-Probe OW-D. |
| O-27 | T2-16 | `place_call.briefing` (`src/mcp-tools.js:955`) und `.context` (`:1024`) nennen "Claude/Gemini" und "calendar, mail, files, chat". |
| X-8 | GEGENSTANDSLOS | Skills-Extension ist laut OpenAI fuer den Fall "when you want to version ... skills"; Hermes liefert keine Skills (`resources/list` nur 5 `ui://`-Widgets, grep `skill` in `src/`: 0). |
| X-9 | GEGENSTANDSLOS | Optional (Kat. C, "connections work without"). Hermes bindet genau einen Mandanten je Login (`src/routes/mcp.js:116`); Multi-Account ist kein Produktmerkmal. Ein zusaetzliches Tool vergroesserte nur die Review-Flaeche. |

### 1b. ERFUELLT (39) - Stichproben-Basis fuer den Kritiker

| ID | Beleg |
|---|---|
| W-6 | Kein Tunnel in `src/`; https-Pflicht im Hosting (`src/boot-guard.js:980-985`). |
| T-1 | Zustandsloser Streamable-HTTP an `POST /mcp` (`src/routes/mcp.js:113-175`); Draht: initialize 200, GET 405. |
| T-2 | `PUBLIC_URL` https ohne Pfad erzwungen (`src/boot-guard.js:955-985`). |
| T-6 | PRM mit `resource`=`audience()` und AS (`src/auth.js:142-150`); `test/oauth.test.js:107,139`. |
| T-7 | AS-Metadata gemessen (`docs/OPENAI-AUTH-ABWEICHUNGEN.md:566-570`). |
| T-8 | `code_challenge_methods_supported: [S256]` im RFC-8414-Dokument (ebd. :569). |
| T-10 | CIMD `true`, DCR-Endpunkt, `none` (ebd. :569). |
| T-13 | 401 + `WWW-Authenticate ... resource_metadata=` (`src/auth.js:74-77,95,111`); p6-T5, p7-T1. |
| T-15 | `securitySchemes` oauth2 am HTTP-Draht (`src/mcp-security-schemes.js:26-53`); stdio bewusst ohne (Autonome Entscheidung P3). T2-23 aendert den `scopes`-Wert; die Draht-Gegenprobe (12/12 HTTP, 0/10 stdio) ist dort Abnahmekriterium (4). |
| T-18 | name/title/description/inputSchema an allen Tools, HTTP und stdio (Draht). |
| T-19 | SDK prueft `structuredContent` gegen `outputSchema` (`@modelcontextprotocol/sdk/server/mcp.js:185-205`). |
| T-20 | `errText` setzt `isError` (`src/mcp-tools.js:88`), `wrapHandler` faengt jeden Throw. |
| T-22 | invoking/invoked <= 32 Zeichen an allen Tools (`src/mcp-tools.js:737-765`). |
| T-36 | Eine feste Route, Mandant aus dem Token (`src/routes/mcp.js:112-116`). |
| N-1 | Alle drei Hints boolean an allen Tools (`src/mcp-tools.js:653-731`), `test/openai-p10a-tool-inventar.test.js`. |
| N-2 | `readOnlyHint:true` nur fuer reine GET-Tools (`src/routes/api-read.js:63-107`). |
| N-3 | `destructiveHint:true` fuer `place_call`, `cancel_call`, `answer_consult`. |
| N-4 | `openWorldHint:true` fuer dieselben drei; Regel `docs/OPENAI-TOOL-INVENTORY.md:79-100`. |
| N-5 | Begruendung je Tool `docs/OPENAI-TOOL-INVENTORY.md:68-236`, gegen den Draht gepinnt. |
| N-6 | Folgt aus N-1..N-4; `test/mcp-tool-annotations.test.js`. |
| N-7 | Kein Tool ohne `readOnlyHint` (HTTP 12/12, stdio 10/10). |
| N-8 | Alle schreibenden Tools `readOnlyHint:false`. |
| N-9 | Aussendende Tools sind Write-Actions; kein SMS/Mail/Upload-Tool. |
| N-15 | Kein sampling/elicit/roots (grep 0), frischer Server je POST (`src/routes/mcp.js:159`). |
| O-5 | Challenge an der Host-Wurzel derselben App wie `/mcp` (`src/app.js:219`), `src/route-policy.js:99`. |
| O-16 | Widget-CSP leer, E-Mail im Log gehasht (`src/routes/mcp.js:73-79`). |
| O-17 | Kein Standortfeld im Input-Schema (Draht, alle Unterfelder). |
| O-21 | Keine Werbung in tools/list, instructions, resources (Draht HTTP+stdio). |
| O-22 | Einziger `fetch` an die eigene Gateway (`src/mcp-tools.js:60-80`). |
| O-23 | Nur offizielle API-Hosts, Drossel `src/telephony/adapters/telnyx/rate-limit.js`. |
| O-26 | 0 iframe/frame/object/embed in den 5 Widgets (Draht). |
| X-1 | Hints an allen Tools inkl. Consult (`test/mcp-tool-annotations.test.js:192`). |
| X-2 | Ergebnisse tragen nur `content`+`structuredContent`. Nach T2-13 traegt `prepare_call` bewusst Ergebnis-`_meta` (nur fuer die Karte) - Gegenprobe in T2-14 (h). |
| X-3 | toolInvocation an allen Tools, `ui.resourceUri` an Widget-Tools (`test/openai-p2-*` 5/5). Muss nach T2-01 erneut gelten (Gegenprobe dort). |
| X-4 | Client-`_meta` (locale, subject, userLocation ...) aendert das Ergebnis nicht (Draht byteidentisch). |
| X-5 | `ui/initialize` mit `2026-01-26` (`src/ui/widget-bind.js:34-36,180-189`). |
| X-6 | Keine privilegierten APIs, kein fetch/XHR, nur `parent.postMessage` (Draht-Scan). |
| X-7 | Kein openExternal/href/window.open im Widget, also kein `redirect_domains` noetig. Muss nach T2-01/T2-02 erneut gelten. |
| X-10 | `prompts/list` -32601, Resources nur Widgets. |

### 1c. Nicht technisch (19)

| ID | Warum nicht technisch |
|---|---|
| W-1 | Beschreibt den Developer-Mode-Weg; keine Anforderung an Code/Konfiguration. |
| W-2 | Wahl des Vertriebswegs (privat vs. Submission) = Konto-/Geschaeftsentscheidung. |
| W-3 | Einreichungsvorgang im OpenAI-Portal. |
| W-4 | Beschreibt den Responses-API-Weg; stellt nichts an den Server. |
| W-5 | Beschreibt den Agents-API-Weg; stellt nichts an den Server. |
| W-7 | Einreichungsregel (keine publizierte Integration referenzieren). |
| T-4 | Aussage ueber den Client (SSE im Developer Mode). |
| T-26 | Aussage ueber den Client (Developer Mode braucht kein search/fetch). |
| T-35 | Eigenschaft des OpenAI-Projekts (EU-Datenresidenz), Kontoeinstellung. |
| O-1 | Identitaetsverifikation im OpenAI-Dashboard. |
| O-2 | Organisationszuordnung im OpenAI-Konto. |
| O-3 | Rollen/Berechtigungen im OpenAI-Konto. |
| O-8 | Welcher Support-Kontakt es ist, ist eine Geschaeftsangabe; die URL steckt in O-7. |
| O-12 | Screenshots entstehen in ChatGPT (Live-Probe), nicht im Repo. |
| O-24 | Eignung 13-17 ist eine AGB-/Rechtstextfrage (kollidiert ggf. mit einer 18+-Klausel; Owner). |
| O-28 | Publizieren nach Freigabe = Handlung im Portal. |
| O-29 | Presseabstimmung. |
| O-30 | Versionsregel im Portal. |
| O-31 | OpenAIs Vorbehalt; die Stabilitaetspflicht steckt in O-25. |

---

## 2. Harte Nuesse

### 2.1 T-30 / T-31 / T-23 / T-34 - Widget in Claude UND ChatGPT

Primaerquellen (woertlich):

- https://developers.openai.com/plugins/reference - "`_meta.ui.csp` | Resource contents | object |
  Preferred metadata surface for standard widget CSP fields: `connectDomains`, `resourceDomains`,
  and optional `frameDomains`."
- ebd. - "`_meta.ui.domain` | Resource contents | string (origin) | Dedicated origin for hosted
  components (required when submitting a plugin with UI; must be unique per plugin). Defaults to
  `https://web-sandbox.oaiusercontent.com`."
- ebd. - "`_meta[\"openai/widgetDomain\"]` | Resource contents | string (origin) | OpenAI-specific
  compatibility alias for `_meta.ui.domain` in ChatGPT."
- https://claude.com/docs/connectors/building/mcp-apps/troubleshooting - "Claude validates the value
  against your connector URL and shows an `Invalid ui.domain format` or `ui.domain mismatch` error
  instead of rendering the app when validation fails. The value must be exactly
  `{hash}.claudemcpcontent.com`, where `{hash}` is the first 32 hexadecimal characters of the
  SHA-256 digest of your full connector URL."
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx -
  "**Host-dependent:** The format and validation rules for this field are determined by each host.
  ... If omitted, Host uses default sandbox origin (typically per-conversation)."
- https://developers.openai.com/plugins/build/chatgpt-ui - "For broader MCP Apps compatibility, use
  `_meta.ui.resourceUri`. ChatGPT also honors `_meta[\"openai/outputTemplate\"]` as a compatibility
  alias." / "The plugin review process checks the declared policy against the UI behavior."
- https://developers.openai.com/plugins/deploy/app-review - "ChatGPT may continue serving cached
  resource contents for up to one hour."
- https://developers.openai.com/plugins/build/mcp-server - "For optional UI, version resource
  identifiers when HTML, JavaScript, or CSS changes in a way that could break a cached component."

Loesung (T2-01, T2-02): EIN anfrageunabhaengiger Resource-Inhalt fuer HTTP und stdio:
`contents[0]._meta = { ui: { csp: { connectDomains: [], resourceDomains: [] } },
"openai/widgetDomain": <Origin aus PUBLIC_URL> }` - und bewusst KEIN `_meta.ui.domain`.
Begruendung: jeder `ui.domain`-Wert ausser dem exakten Hash der Connector-URL laesst Claude das
Widget verweigern; ohne das Feld rendert Claude mit Standard-Origin (das Widget laedt nichts von
aussen, braucht also keinen stabilen Origin). ChatGPT bekommt den Origin ueber den offiziellen
Alias. Die Host-Erkennung entfaellt, weil der Inhalt fuer beide Hosts derselbe ist.

Verworfen: statisches `ui.domain` (Claude: "Invalid ui.domain format"); `ui.domain` = Claude-Hash
(haengt an der exakten Connector-URL, fuer ChatGPT falsches Format, fuer stdio ungueltig);
Host-Erkennung pro Request (`resources/read` traegt keine dokumentierten `openai/*`-Felder,
User-Agent undokumentiert, IP-Bereiche proxy-anfaellig); zustandsbehafteter Transport (grosser
Umbau, nicht restart-fest, OpenAI-Quickstart ist zustandslos).

T-34: URI traegt eine Version (OpenAI-Beispiel selbst: `ui://project-board/v1.html`), das HTML ist
fuer alle Mandanten byte-gleich (alle Sprachfassungen eingebettet), die Sprache kommt mit dem
Tool-Ergebnis. Grund gegen "Sprache in der URI": die Tool-Definition wird bei der Einreichung als
Snapshot geprueft (T-33); eine mandantenabhaengige `resourceUri` in `tools/list` waere dort nur in
einer Sprache sichtbar.

UNKNOWN (nur Live-Probe klaert es, vorbereitet als OW-D/OW-C/OW-E): akzeptiert der OpenAI-Scan den
Alias statt `ui.domain`? Ignoriert Claude `openai/*`-Schluessel am Inhalt? Prueft ChatGPT den
Domain-Wert gegen den Server-Origin? Rueckfall, falls OpenAI den Alias ablehnt: eigener
ChatGPT-Pfad mit `ui.domain` - beruehrt Audience/PRM/`route-policy.js`, also eigene Auth-Phase
danach, nicht vorab.

### 2.2 T-29 - CORS und Origin

Primaerquellen:

- https://developers.openai.com/plugins/build/app-quickstart - `"Access-Control-Allow-Headers":
  "content-type, mcp-session-id", "Access-Control-Expose-Headers": "Mcp-Session-Id", ...
  sessionIdGenerator: undefined, // stateless mode`
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports - "If the `Origin`
  header is present and invalid, servers **MUST** respond with HTTP 403 Forbidden."
- https://developers.openai.com/plugins/build/chatgpt-ui - "| Call a tool from the UI | `tools/call`
  | `window.openai.callTool` |" (Widget-Aufrufe laufen ueber die Host-Bridge, nicht direkt an `/mcp`.)

Ist: `createMcpOriginGuard` vor `mcpAuth` (`src/routes/mcp.js:102-111`); fremder Origin -> 403
(`src/middleware.js:207-217`, Logzeile `grund=mcp_cross_origin`); Liste = `PUBLIC_URL` +
`MCP_ALLOWED_ORIGINS` (leer). `test/s2-mcp-origin.test.js` E5-H14 belegt: mit
`MCP_ALLOWED_ORIGINS=https://chatgpt.com` kein 403. Kein `Access-Control-*`-Header in `src/`.

Vorbereiteter Wert: `MCP_ALLOWED_ORIGINS=https://chatgpt.com` NUR wenn die Owner-Messung (OW-C)
genau diesen Origin im Log zeigt; sonst exakt der gemessene `https://<host>`; ohne Logzeile leer.
Die Widget-Sandbox-Domain gehoert NICHT auf die Liste.

Warum trotzdem Code (T2-06): kommt die Anfrage browserseitig, reicht der Wert allein nicht - der
Preflight bekaeme keine CORS-Antwort. T2-06 baut CORS so, dass es NUR fuer Origins greift, die die
Herkunftswache ohnehin zulaesst; bei leerer Liste ist jede Antwort byte-gleich zu heute.

**Reibung mit D0-4 (fuer den Lead):** D0-4 sagt "an CORS KEINE Zeile", solange die Richtung nicht
belegt ist. Ziel von D0-4 ist "keine Lockerung auf Verdacht" - das bleibt gewahrt, denn ohne den
Owner-Wert aendert sich nichts. Woertlich haelt T2-06 D0-4 nicht. Empfehlung: bauen und mergen
(inert). Haelt der Lead D0-4 woertlich: T2-06 bauen und pruefen, Branch NICHT mergen; der Owner
merged ihn nur, wenn OW-C "browserseitig" ergibt. In beiden Faellen ist T-29 danach nur noch am
Owner-Wert offen.

### 2.3 O-27 - Fair play und die place_call-Texte

Primaerquellen (https://developers.openai.com/plugins/app-guidelines): "Plugins must not include
descriptions, titles, tool annotations, or other model-readable fields, at either the tool or
plugin level, that manipulate how the model selects or uses other plugins or their tools ... or
interfere with fair discovery." / "Descriptions must not favor or disparage other plugins or
services or attempt to influence the model to select them over another plugin's tools."

Befund: nur zwei Stellen, beide in `place_call` (`src/mcp-tools.js:955` briefing: "(calendar, mail,
files, chat)" und "(not as Claude/Gemini)"; `:1024` context: "NEVER as Claude/Gemini"). Die
instructions auf master sind bereits bereinigt (`src/mcp-server-info.js:118-124`); live (728f053)
steht die Aufzaehlung noch - das behebt erst ein Deploy.

Bench-Versuch (Pflicht laut Kickoff, 2026-09-22 im Planungslauf gefahren): `convo-bench`,
Szenario friseur-voll, n=1 -> `ended_via=persona_error`, Anbieterfehler "Your credit balance is too
low to access the Anthropic API." Damit ist die Vorher/Nachher-Messung **belegter Owner-Grund**
(Guthaben). Zusaetzlich strukturell: die Bench liest diese Texte nie - `scripts/convo-bench/
runner.mjs:112-125` (`buildCallSeed`) schreibt das Briefing direkt in den Anruf-Datensatz, und
kein Skript unter `scripts/` importiert `src/mcp-tools.js` (grep). Sie wuerde also Rauschen messen.

Baubarer Teil (T2-16): Ersatzwortlaut (Wirkung erhalten, Test-Anker unveraendert), Draht-Scan-Test
auf beiden Pfaden, UND ein Messwerkzeug auf der Aufrufer-Seite (das Modell, das `place_call`
befuellt): `tools/list` alt vs. neu, `place_call` erzwungen, NICHT ausgefuehrt, n>=5 je Szenario,
3 Szenarien (eine je Klasse der Wissensluecke), Metriken (a) Selbstnennung als
Claude/Gemini/ChatGPT = 0, (b) Luecken-Klasse korrekt, neu >= alt, (c) erfundene Fakten = 0. Mit
Attrappen-Modus und Positiv-Kontrolle, damit es ohne Guthaben pruefbar ist. Die Messung selbst
fuehrt der Owner nach dem Aufladen aus (Deploy-Vorbedingung von T2-16).

### 2.4 Rate-Limit 120/min pro IP hinter geteilten Egress-IPs (T-27/T-28)

Primaerquellen:

- https://developers.openai.com/api/docs/guides/ip-addresses - "An IP allowlist identifies traffic
  from an OpenAI-operated network, not a specific user or workspace, and does not replace request
  authentication or authorization when your integration requires them."
- https://developers.openai.com/plugins/reference - "`_meta[\"openai/subject\"]` | Tool calls |
  string | Anonymized user id sent to MCP servers for the purposes of rate limiting and
  identification"
- https://developers.openai.com/plugins/build/mcp-server - "Apply timeouts and rate limits to
  expensive or externally visible tools." / "Rate-limit expensive or externally visible actions."
- https://docs.claude.com/en/api/ip-addresses - "These are the stable IP addresses that Anthropic
  uses for outbound requests (for example, when making MCP tool calls to external servers)."

Ist: ein globaler Limiter vor Parsern und Auth, Schluessel `req.ip`, festes 60-s-Fenster,
Default 120 (`src/config.js:1945`), `trust proxy 1` (`src/app.js:534`). Hinter geteilten Egress-IPs
teilen sich alle ChatGPT- (und Claude-)Nutzer einen Eimer.

Loesung (T2-07): `/mcp` aus dem globalen IP-Limiter nehmen; auf der Route (a) Fehlversuch-Zaehler je
IP, der NUR `mcpAuth`-Ablehnungen zaehlt - Reihenfolge wie IEX-A7: ERST pruefen, gueltiges Token
nie gezaehlt und nie gedrosselt, nur ein ungueltiges zaehlt und bekommt ab dem Limit 429 statt 401
(`src/routes/webhooks-elevenlabs-init.js:133-140`: `if (initTokenGueltig(...)) return next();`
vor `zaehler(req.ip)`); ein abgelaufenes, aber gueltig signiertes Token (`ERR_JWT_EXPIRED`) zaehlt
NICHT - es ist der normale Refresh-Anlass legitimer Clients hinter geteilten Egress-IPs, und
jose prueft die Signatur vor den Claims (`node_modules/jose/dist/webapi/jwt/verify.js:5,9`), also
kann nur unser AS so ein Token ausgestellt haben; (b) nach `requestTenant` Schluessel
`tenant:<id>` im OAuth-Modus, sonst `ip:<req.ip>` (Token-/Legacy-Modus unveraendert). NICHT
`openai/subject`: unverifizierter Body-Wert, nur ChatGPT; der Mandant aus dem verifizierten Token
ist staerker und deckt Claude mit ab. Last-Einordnung: ca. 10,9 Polls/min je Mandant bei laufendem
Anruf (AL-P13-45), weit unter dem Default.

UNKNOWN: ob `req.ip` hinter dem Hosting-Proxy die echte Client-IP ist (ungemessen). Liegt ein
weiterer Proxy davor, war das IP-Limit schon heute faktisch global - T2-07 entschaerft das, weil
nur noch Fehlversuche je IP zaehlen.

---

## 3. Phasen

Ausfuehrungsreihenfolge = Reihenfolge der Abschnitte unten; T2-23 steht deshalb zwischen T2-03 und
T2-04 (Nummer bewusst nicht umsortiert, Kritiker-Runde 4). Auth-Phasen: T2-03 -> T2-23 -> T2-04 ->
T2-05 (T2-23 nach T2-03, weil beide `verifyOauth` aendern; vor T2-05, weil T2-05 den Challenge-Bauer
exportiert und `scope=` dann erbt).
Reihenfolge: Abhaengigkeiten zuerst (Widget-Dateien vor Umbenennungen, Umbenennungen vor
Bestaetigung/instructions/Vertrag, Code vor den OpenAI-Dokumenten), sonst nach Risiko.
**Zwischenmessung nach T2-10** (Haelfte). Fuer jede Phase gilt: Beweis am echten Draht (`tools/list`,
`resources/read`, `tools/call` ueber `POST /mcp` im Kindprozess mit `PORT=0` und Temp-`DATA_DIR`,
dazu stdio-Kindprozess), nie am Registrierungsobjekt; alle betroffenen Pfade (HTTP OAuth, HTTP
Token/Legacy, stdio, mit/ohne Consult); jede Verhaltensaenderung zieht Kommentare und
`docs/OPENAI-TOOL-INVENTORY.md` mit; neue Env-Var in `src/config.js`, `.env.example`, `render.yaml`
und `BASE_ENV` der Tests. Safety-Gates und Offenlegungssatz bleiben unangetastet.

### T2-01 - Widget: csp und Origin am Resource-Inhalt, Skybridge-Adapter raus
- Risiko: widget. IDs: T-30, T-31, T-23. dokumentFuerOpenAI: nein.
- Ziel: `resources/read` liefert `contents[0]._meta.ui.csp` und `_meta["openai/widgetDomain"]`
  (Abschnitt 2.1); Tool-Deskriptoren tragen nur noch `_meta.ui.resourceUri` (+ toolInvocation);
  der tote ChatGPT-Adapter verschwindet.
- Dateien: `src/ui/contract.js`, `src/ui/adapters/mcp-native.js`, `src/ui/adapters/chatgpt.js`
  (loeschen), `src/ui/registry.js`, `src/routes/mcp.js` (nur die `uiHost`-Zeile), Tests
  `test/openai-p8-widget-ui.test.js` (P8-C/D umdrehen, P8-I/J neu pinnen), `test/mcp-ui.test.js`
  (:632-680 auf `resources/read`), `test/openai-p2-tool-metadaten.test.js` (Schritt 14),
  `test/openai-p10a-ui-capabilities.test.js`.
- Abnahme (Draht, HTTP OAuth + HTTP Legacy + stdio, `MCP_UI_ENABLED=true`,
  `PUBLIC_URL=https://probe.example`): (1) fuer alle 5 URIs aus `resources/list` hat
  `resources/read` -> `contents[0]._meta.ui.csp` = `{connectDomains:[],resourceDomains:[]}` und
  `contents[0]._meta["openai/widgetDomain"]` = `https://probe.example`; (2) nirgends in
  `resources/read` oder `tools/list` ein Schluessel `ui.domain` (Waechtertest mit Positiv-Kontrolle);
  (3) `tools/list` mit `params.capabilities` im Request (Skybridge-Form) ist byte-gleich zu ohne;
  kein `openai/outputTemplate`; (4) ohne `PUBLIC_URL` (stdio) fehlt `openai/widgetDomain`, `csp`
  bleibt; (5) `find src -name chatgpt.js` leer, `grep -r capabilityDeclaresChatgptUi src` leer;
  (6) X-3/X-7 gelten weiter (toolInvocation an allen Tools, kein `redirect_domains`).
- Pre-Mortem: Ein Jahr spaeter rendert das Widget in Claude nicht mehr, weil Claude die jetzt am
  Inhalt deklarierte leere CSP strenger durchsetzt als vorher (am Tool ignoriert) und das Widget
  doch etwas laedt (Font, data:-URL, Inline-Quelle) - und in ChatGPT lehnt der Scan den Alias ab.
  Gegenmassnahme: Draht-Scan-Test "keine externe Quelle im HTML" bleibt Pflicht und laeuft gegen
  JEDES ausgelieferte Widget; Owner-Proben OW-D (Claude) und OW-C/OW-E (ChatGPT) direkt nach dem
  Deploy; Rueckfall ohne Code: `MCP_UI_ENABLED=false`; Rueckfall-Design fuer den Alias steht in 2.1.
- Owner-Vorbereitung: OW-C, OW-D, OW-E (Abschnitt 4). Deploy-Vorbedingung: keine.

### T2-02 - Widget: cache-feste, sprachunabhaengige Resource-URIs
- Risiko: widget. IDs: T-34. dokumentFuerOpenAI: nein. Nach T2-01.
- Ziel: URIs tragen eine Version; das HTML ist fuer alle Mandanten byte-gleich; die Sprache kommt
  mit dem Tool-Ergebnis; eine HTML-Aenderung ohne Versionssprung faellt im Test auf.
- Dateien: `src/ui/contract.js` (URI-Fabrik), `src/ui/widget-catalog.js` (:175),
  `src/ui/widget-bind.js`, `src/ui/widgets/*.html` (i18n-Einbettung), Tool-Ergebnis der
  Widget-Tools in `src/mcp-tools.js` (nur das Sprachfeld), Tests `test/mcp-ui-widget-i18n.test.js`,
  `test/mcp-ui-i18n-divergence.test.js`, `test/openai-p8-widget-ui.test.js`, neue Pin-Datei
  Hash->Version.
- Abnahme: (1) Draht HTTP: `resources/read` fuer einen DE- und einen EN-Mandanten (zwei
  OAuth-Tokens) liefert byte-gleichen `text`; (2) jede `resourceUri` in `tools/list` steht in
  `resources/list` (HTTP + stdio) und enthaelt ein Versionssegment; (3) Test: aendert sich der
  SHA-256 eines Widget-HTML ohne neue Version in der Pin-Datei -> rot (Positiv-Kontrolle: ein
  Byte im HTML aendern); (4) Widget-Tool-Ergebnis traegt das Sprachfeld (Draht), und der
  Bind-Test zeigt DE-Text bei `de`, EN-Text bei `en`; (5) Groesse je Widget-HTML vorher/nachher im
  Bericht, Zuwachs <= 10 % (F4: Payload ist schon ca. 243 KB).
- Pre-Mortem: Das HTML mit allen Sprachen sprengt eine Host-Groessengrenze, oder das Widget zeigt
  beim ersten Render (vor dem Ergebnis) die falsche Sprache, und Nutzer sehen flackernde Texte.
  Gegenmassnahme: Groessenbudget als Test; Default-Sprache `en` bis das Ergebnis da ist, im Bericht
  als bewusste Folge benannt; nur die tatsaechlich unterstuetzten Locales einbetten.
- Owner-Vorbereitung: keine eigene (OW-D/OW-C pruefen das Rendern). Deploy-Vorbedingung: keine.

### T2-03 - Auth: `exp` Pflicht, WARN bei Nicht-OAuth in Produktion
- Risiko: auth. IDs: T-12, T-5. dokumentFuerOpenAI: nein.
- Ziel: `jwtVerify` verlangt `exp` (`requiredClaims: ["exp"]`); beim Boot in Produktion mit
  `MCP_AUTH` != `oauth` eine WARN-Zeile ohne Sperrwirkung (Autonome Entscheidung P6: keine neue
  Boot-Verweigerung fuer diesen Fall). **"Produktion" heisst hier ausschliesslich
  `detectProduction()`** (`src/config.js:204-206`, = `RENDER_EXTERNAL_URL` gesetzt; "EINE Quelle
  des Diskriminators (G5)", Kommentar `:200-203`) - KEIN `NODE_ENV`-Profil (Kritiker-Runde 3,
  Blocker 3; `NODE_ENV` liest `src/config.js` heute nur an `:34` fuer den Testmodus). Bauform nach
  dem Muster `productionFootguns(cfg, isProduction = detectProduction())` (`src/config.js:2469`):
  eine reine Funktion, z.B. `productionAuthHints(cfg, isProduction = detectProduction())`, die eine
  Liste von Hinweiszeilen liefert; `assertConfig()` (`src/config.js:2638-2651`) ruft sie mit
  DEMSELBEN `isProduction` wie `fatalConfigFindings` und gibt die Zeilen per `console.error` aus -
  unabhaengig davon, ob Fatal-Befunde vorliegen, und NICHT als Teil von `fatalConfigFindings`
  (sonst Sperrwirkung).
- Dateien: `src/auth.js` (:98-102), `src/config.js` (neue reine Funktion + Aufruf in `assertConfig`),
  `test/oauth.test.js` bzw. neue Datei, `PLAN-SECURITY.md`, `docs/OPENAI-AUTH-ABWEICHUNGEN.md`
  (bisherige "bewusst nicht erfuellt"-Stelle zu `exp` korrigieren).
- Abnahme: ueber die echte Route mit Test-IdP: Token ohne `exp` -> 401 mit
  `WWW-Authenticate ... resource_metadata=`; Token mit `exp` in der Zukunft -> 200; abgelaufen -> 401
  (Bestand). WARN: (1) Unit-Test der reinen Funktion (Muster `test/config-prod-footguns.test.js`):
  `isProduction=true` und `mcpAuth` in {`token`, `""`} -> genau eine Zeile, die `MCP_AUTH` nennt;
  `mcpAuth="oauth"` -> leere Liste; `isProduction=false` -> leere Liste; mit gesetztem
  `mcpAuthToken`-Markerwert enthaelt keine Zeile diesen Wert. (2) Verdrahtung am Boot, Muster
  `test/boot-prod-footguns.test.js` (`PROD_SAFE` mit `RENDER_EXTERNAL_URL`): `startServerExpectExit`
  mit `PROD_SAFE` + `MCP_AUTH=token` -> die Ausgabe enthaelt die WARN-Zeile; mit `MCP_AUTH=oauth`
  (+ Test-Issuer https) nicht. Der Spawn endet offline trotzdem mit Exit 1 - das ist der BESTEHENDE
  Footgun `STORE_BACKEND != pg` (`test/openai-p6-challenge.test.js:110-114` belegt das), nicht
  diese Phase; der Test prueft die Zeile, nicht den Exit-Code. (3) Keine Sperrwirkung: ohne
  `RENDER_EXTERNAL_URL`, mit `MCP_AUTH=token` bootet der Server wie heute (`/healthz` 200) und gibt
  die Zeile NICHT aus; Code-Stelle: die neue Funktion steht nicht in `fatalConfigFindings`.
  (4) Keine zweite Produktionsdefinition: `grep -c "NODE_ENV" src/config.js` ist vor und nach der
  Phase gleich, und die neue Funktion liest Produktion nur ueber ihren Parameter.
- Pre-Mortem: Nach dem Deploy lehnt `/mcp` jedes echte Token ab, weil der AS Access-Tokens ohne
  `exp` ausstellt - Claude-Connector des Owners und jede ChatGPT-Verbindung sind tot.
  Gegenmassnahme: Deploy-Vorbedingung. Zweitens: die WARN haengt an einem eigenen
  Produktionsbegriff (`NODE_ENV`), den das Hosting nicht so setzt wie erwartet - sie erscheint in
  Produktion nie, oder ein zweiter Diskriminator driftet vom ersten weg und spaetere Gates lesen den
  falschen. Gegenmassnahme: Kriterium (4) und der Parameter `isProduction = detectProduction()`.
- Deploy-Vorbedingung: OW-B - ein echtes Access-Token traegt `exp`. Fehlt es: diesen Commit vor dem
  Deploy zuruecknehmen und `exp`-Pflicht als OWNER markieren.

### T2-23 - Auth: Scope-Angabe des Resource-Servers (PRM, 401-Challenge, securitySchemes)
- Risiko: auth. IDs: T-16 (Resource-Server-Anteil; erfuellt erst mit OW-B), T-12 (Scope-Anteil;
  `exp`-Anteil in T2-03). dokumentFuerOpenAI: ja - NUR die Abschnitte T-12 und T-16 in
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md` (deutsche Fassung und englische Fassung 2b), die schreibt Opus;
  der Code-Teil nicht. Laeuft nach T2-03, vor T2-04 (siehe Kopf von Abschnitt 3).
- Befund (am Code, master `288376b`): `registerWellKnown` (`src/auth.js:143-150`) liefert nur
  `resource`, `authorization_servers`, `bearer_methods_supported`; `deny401` (`src/auth.js:74-77`)
  baut `Bearer resource_metadata="...", error="...", error_description="..."` ohne `scope=`;
  `TOOL_SECURITY_SCHEMES = [{ type: "oauth2", scopes: [] }]` (`src/mcp-security-schemes.js:26-28`),
  gepinnt in `test/openai-p3-security-schemes.test.js:37`. Die Token-Pruefung liest keinen
  `scope`/`scp` (`src/auth.js:98-104`; Positiv-Kontrollen `OpenAI-P7-T3`/`-T4`,
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md:156-159`).
- Quellen (woertlich):
  - MCP 2025-11-25, Authorization, Scope Selection Strategy
    (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): "1. **Use
    `scope` parameter** from the initial `WWW-Authenticate` header in the 401 response, if provided
    2. **If `scope` is not available**, use all scopes defined in `scopes_supported` from the
    Protected Resource Metadata document, omitting the `scope` parameter if `scopes_supported` is
    undefined." - ebd.: "MCP servers **SHOULD** include a `scope` parameter in the
    `WWW-Authenticate` header" - ebd.: "The `scopes_supported` field is intended to represent the
    minimal set of scopes necessary for basic functionality".
  - Ebd., Runtime Insufficient Scope Errors: "`HTTP 403 Forbidden` status code" mit
    "`error=\"insufficient_scope\"`", "`scope=\"required_scope1 required_scope2\"`" und
    "`resource_metadata`".
  - OpenAI (https://developers.openai.com/plugins/build/auth): "Advertise and enable the `openid`
    and `email` scopes." - "Advertise a UserInfo Endpoint that returns the user's `email` claim and
    `email_verified: true`." - "If your provider advertises OIDC scopes (for example, `openid`,
    `email`, `profile`) in `scopes_supported` of its `.well-known/oauth-authorization-server` or
    `.well-known/openid-configuration` document, ChatGPT requests those scopes by default during the
    OAuth flow." - Beispiele: PRM `"scopes_supported": ["files:read", "files:write"]`,
    `"securitySchemes": [ { "type": "oauth2", "scopes": ["docs.write"] } ]`. Zur Token-Pruefung
    (zitiert in `docs/OPENAI-AUTH-ABWEICHUNGEN.md:132`): "... and contains the scopes you marked as
    required."
- Ziel: EINE Scope-Menge `S = ["openid", "email", "offline_access"]`, als eingefrorene exportierte
  Konstante in `src/auth.js` (einzige Stelle, an der die Literale als Code stehen), gelesen von:
  (a) PRM, beide Pfade (`/.well-known/oauth-protected-resource` und `.../mcp`):
  `scopes_supported: S`, NUR wenn `authorization_servers` nicht leer ist (ohne AS keine
  Scope-Angabe); (b) `deny401` (nur OAuth-Zweig): `Bearer resource_metadata="...",
  scope="openid email offline_access", error="...", error_description="..."` - `resource_metadata`
  bleibt ERSTER Parameter (`test/openai-p7-token-pruefachsen.test.js:47` prueft `^Bearer
  resource_metadata="`); `STATIC_BEARER_CHALLENGE` (Token-/Legacy-Zweig) bleibt byte-gleich;
  (c) `TOOL_SECURITY_SCHEMES = [{ type: "oauth2", scopes: S }]` am HTTP-Draht, stdio weiterhin ohne
  `securitySchemes` (Autonome Entscheidung P3, unveraendert).
  Warum genau diese Menge: `openid` + `email` verlangt T-16. `offline_access` gehoert dazu, weil ein
  spec-treuer Client nach der Aenderung NUR noch die Challenge-Menge anfragt - ohne
  `offline_access` bekaeme er kein Refresh-Token, und jede Verbindung liefe mit dem Access-Token ab.
  `profile` nicht (Minimalmenge laut Spec). Alle drei bewirbt der AS (`docs/OPENAI-AUTH-ABWEICHUNGEN.md`
  Abschnitt 3; Fixture `test/probe-as-faehigkeiten.test.js:60`) - kein erfundener Scope. Keine neue
  Env-Var: die Menge ist eine Produktentscheidung, keine Umgebungseigenschaft; Rueckweg = Revert.
  **Zwei Commits:** Commit A = (a)-(c). Commit B = Scope-Pruefung am Token (T-12): nach `jwtVerify`
  muss das Token jedes Element von S tragen, gelesen aus `scope` (leerzeichengetrennter String)
  oder `scp` (Array oder String); fehlt eines -> HTTP 403 mit `WWW-Authenticate: Bearer
  error="insufficient_scope", scope="openid email offline_access", resource_metadata="...",
  error_description="..."`, Audit `grund=insufficient_scope` ohne Token- oder Claim-Inhalt, kein
  `next()`. B ist getrennt, weil nur B die Produktion lahmlegen kann (Deploy-Vorbedingung unten).
  Kommentar `src/mcp-security-schemes.js:18-23` ("Die Scope-Liste bleibt leer ... erfundene
  Scope-Liste waere eine Falschangabe (E1, D0-7)") wird ersetzt - D0-7 ("kein Scope
  konsumiert/beworben") ist durch T-16 ueberholt: S ist die vom AS beworbene Identitaetsmenge, keine
  Hermes-Berechtigung; die fachliche Zugriffsgrenze bleibt Audience + Mandantenbindung
  (`src/routes/mcp.js:116`).
- Dateien: `src/auth.js` (Konstante, `deny401`, `verifyOauth`, `registerWellKnown`),
  `src/mcp-security-schemes.js` (Import statt Literal, Kommentar), `test/openai-p3-security-schemes.test.js`
  (:37 Erwartung), `test/openai-p6-challenge.test.js` (:24 erwarteter OAuth-Challenge-String),
  `test/openai-p7-token-pruefachsen.test.js` (T3/T4 bewusst auf 403 drehen, nur Commit B), neue
  Datei `test/openai-t2-23-scopes.test.js`, `docs/OPENAI-AUTH-ABWEICHUNGEN.md` (T-12, T-16; Opus),
  `docs/OPENAI-TOOL-INVENTORY.md` (securitySchemes-Wert), `PLAN-SECURITY.md`.
- Abnahme (Kindprozess `PORT=0`, Temp-`DATA_DIR`, Test-IdP wie `test/oauth.test.js`,
  `MCP_AUTH=oauth`, `PUBLIC_URL=https://agent.test`):
  (1) `GET /.well-known/oauth-protected-resource` und `GET /.well-known/oauth-protected-resource/mcp`
  -> `scopes_supported` deepEqual `["openid","email","offline_access"]`; `MCP_AUTH=token` ohne
  `OAUTH_ISSUER_URL` -> `authorization_servers` leer und `scopes_supported` fehlt.
  (2) `POST /mcp` ohne Token -> 401, `www-authenticate` exakt `Bearer
  resource_metadata="https://agent.test/.well-known/oauth-protected-resource", scope="openid email
  offline_access", error="invalid_token", error_description="Kein Token"`; Muell-Token -> 401 mit
  demselben `resource_metadata=` und `scope=`.
  (3) `MCP_AUTH=token` (mit und ohne `MCP_AUTH_TOKEN`) und Legacy (`MCP_AUTH=""`) -> Header exakt
  `Bearer error="invalid_token"` (kein `scope=`, kein `resource_metadata`) - Bestandstests
  `test/openai-p6-challenge.test.js` P6-T1 unveraendert gruen.
  (4) `tools/list` ueber `POST /mcp` mit gueltigem Test-Token: jedes Werkzeug traegt
  `securitySchemes` deepEqual `[{"type":"oauth2","scopes":["openid","email","offline_access"]}]`
  (alle Werkzeuge der Liste, mit und ohne Consult); stdio-Kindprozess `tools/list`: kein Werkzeug
  mit `securitySchemes`.
  (5) Nur Commit B: Test-Token mit `scope: "openid email offline_access"` -> 200; mit
  `scp: ["openid","email","offline_access"]` -> 200; mit `scope: "openid email"` -> 403, Header
  enthaelt `error="insufficient_scope"`, `scope="openid email offline_access"` und
  `resource_metadata=`; ohne `scope`/`scp` -> 403; in jedem 403-Fall lief kein Werkzeug (Body ohne
  JSON-RPC-`result`) und die Audit-Ausgabe enthaelt keinen Teil des Tokens.
  (6) Eine Quelle: in `src/mcp-security-schemes.js` steht kein Scope-Literal als Code (Import aus
  `src/auth.js`); `grep -n '"offline_access"' src/*.js` trifft genau die Konstante.
- Pre-Mortem ("ein Jahr spaeter war T2-23 ein Fehler"):
  (1) Am Deploy-Tag ist jeder Connector tot: der AS stellt Access-Tokens ohne `scope`/`scp` aus
  (oder ohne `offline_access` darin), Commit B antwortet jedem mit 403 - Claude-Connector des Owners
  und jede ChatGPT-Verbindung fallen gleichzeitig aus. Gegenmassnahme: B getrennt committet,
  Deploy-Vorbedingung; fehlt der Beleg, wird B vor dem Deploy zurueckgenommen und der Scope-Teil
  von T-12 bleibt als dokumentierte Abweichung stehen.
  (2) Verbindungen reissen nach Minuten ab: der Client fragt nur noch die Challenge-Menge an; ohne
  `offline_access` kaeme kein Refresh-Token. Gegenmassnahme: `offline_access` in S; OW-B prueft,
  dass die Verbindung ein Refresh-Token erhaelt.
  (3) Neue Verknuepfungen scheitern mit `invalid_scope`, weil "beworben" nicht "freigeschaltet"
  heisst. Gegenmassnahme: S ist Teilmenge der beworbenen Menge; OW-B fuehrt den Login mit genau S
  durch, BEVOR deployt wird.
  (4) Ein Skript mit statischem Token bekommt ploetzlich eine OAuth-Scope-Angabe und laeuft in eine
  Discovery, deren Token dieser Zweig nie annimmt. Gegenmassnahme: Kriterium (3).
  (5) Die Doku an OpenAI behauptet eine Scope-Pruefung, die nach einem Rueckzug von B nicht mehr
  existiert. Gegenmassnahme: der Abschnitt T-12 in `docs/OPENAI-AUTH-ABWEICHUNGEN.md` wird erst
  nach dem OW-B-Ergebnis endgueltig; bis dahin fuehrt er beide Ausgaenge woertlich.
- Owner-Vorbereitung: OW-B (Abschnitt 4), Variante mit dem gebauten Stand lokal - die Live-Instanz
  macht vor dem Deploy noch keine Scope-Angabe, ein Inspector gegen Live fragte also keinen Scope an.
- Deploy-Vorbedingung: OW-B mit S. Commit A braucht: Login mit genau S gelingt, ein Refresh-Token
  wird ausgegeben. Commit B braucht zusaetzlich: das dekodierte Access-Token traegt `scope` oder
  `scp` mit allen drei Werten. Fehlt nur das: B vor dem Deploy zuruecknehmen.

### T2-04 - Auth/Origin: `PUBLIC_URL` in Produktion Pflicht
- Risiko: auth. IDs: T-32. dokumentFuerOpenAI: nein.
- Ziel: In Produktion kein stiller Rueckfall auf den Hosting-Host (`src/config.js:1499`); fehlt
  `PUBLIC_URL`, verweigert der Boot mit einer Meldung, die die Variable nennt. Ausserhalb
  Produktion bleibt der Rueckfall. Doku: Origin ist nach Publikation unveraenderlich.
- Dateien: `src/config.js`, `src/boot-guard.js` (:889-985), Boot-Guard-Test, `PLAN-SECURITY.md`,
  `.env.example` (Hinweis).
- Abnahme: Kindprozess im Produktionsprofil ohne `PUBLIC_URL`, mit gesetztem Hosting-Host -> Exit
  != 0, Meldung nennt `PUBLIC_URL`; mit `PUBLIC_URL` -> lauscht, PRM.resource = `PUBLIC_URL/mcp`;
  Nicht-Produktion ohne `PUBLIC_URL` -> Rueckfall wie heute.
- Pre-Mortem: Die Produktion lief bisher auf dem Rueckfall; nach dem Deploy startet sie nicht, und
  mit ihr fallen eingehende Anrufe aus. Gegenmassnahme: Deploy-Vorbedingung; Meldung eindeutig.
- Deploy-Vorbedingung: OW-G - `PUBLIC_URL` ist im Dashboard gesetzt und gleich dem
  Einreichungs-Origin. Pruefbar auch ohne Dashboard: die Live-PRM (`/.well-known/oauth-protected-resource`)
  nennt als `resource` den Marken-Host, nicht den Hosting-Host.

### T2-05 - Auth: Re-Auth-Challenge im Tool-Fehlerergebnis
- Risiko: auth. IDs: T-14. dokumentFuerOpenAI: nein.
- Ziel: Fall "gueltiges OAuth-Token, kein Mandant" (heute HTTP 403, `src/routes/mcp.js:60-65`)
  wird auf MCP-Ebene beantwortet: `initialize` und `tools/list` wie gewohnt (gleiche Werkzeugnamen),
  jedes `tools/call` -> `isError: true` mit `_meta["mcp/www_authenticate"]`, dessen Challenge aus
  DERSELBEN Funktion kommt wie der HTTP-Header (`src/auth.js`), dazu ein neutraler Text ohne Link.
  Format woertlich aus https://developers.openai.com/plugins/build/auth uebernehmen, nicht raten.
- Dateien: `src/routes/mcp.js`, `src/auth.js` (Challenge-Bauer exportieren), neue kleine Datei fuer
  die Stub-Registrierung ohne Mandant, neue Testdatei.
- Abnahme (echte Route, Test-IdP, `sub` ohne Mandant): initialize 200; `tools/list` Namensmenge
  gleich wie mit Mandant; `tools/call place_call` -> `isError` true, `_meta["mcp/www_authenticate"]`
  enthaelt `resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource"` und (aus T2-23,
  derselbe Bauer) `scope="openid email offline_access"`; im Temp-Store
  entsteht KEIN Anruf und die Gateway-REST-Route wird NICHT getroffen (Zaehler/Spy); Token-/
  Legacy-Modus unveraendert; `test/route-auth-inventory.test.js` gruen.
- Pre-Mortem: Ein Jahr spaeter hat ein Fremder mit gueltigem Login, aber ohne Mandant, Anrufe auf
  Kosten des Bootstrap-/Owner-Mandanten ausgeloest, weil ein Handler mit `scopedTenant = null` in
  den Legacy-Rueckfall lief. Gegenmassnahme: der Kein-Mandant-Pfad registriert Stubs, die `api()`
  nie aufrufen (Code-Stelle + Test "0 REST-Aufrufe"); Safety-Review Opus prueft genau diese
  Verzweigung; zweites Risiko Endlosschleife Login->kein Mandant->Login: Text sagt klar, dass kein
  Hermes-Konto verknuepft ist.
- Deploy-Vorbedingung: keine (reiner Fehlerpfad, fail-closed).

### T2-06 - Transport: CORS nur fuer freigegebene Origins
- Risiko: transport. IDs: T-29. dokumentFuerOpenAI: nein. Siehe 2.2 (Reibung mit D0-4).
- Ziel: Fuer Origins, die die Herkunftswache zulaesst (`PUBLIC_URL` ausgenommen, nur
  `MCP_ALLOWED_ORIGINS`), beantwortet `/mcp` den Preflight und setzt CORS-Header; bei leerer Liste
  aendert sich nichts.
- Dateien: `src/middleware.js` (Herkunftswache), `src/routes/mcp.js` (OPTIONS vor `mcpAuth`),
  `test/s2-mcp-origin.test.js`, `PLAN-SECURITY.md`.
- Abnahme (echte Route): (1) leere Liste: OPTIONS/POST mit `Origin: https://chatgpt.com` -> 403
  wie heute, keine `Access-Control-*`-Header auf irgendeiner `/mcp`-Antwort (Header-Vergleich);
  (2) `MCP_ALLOWED_ORIGINS=https://chatgpt.com`: OPTIONS -> 204 mit
  `Access-Control-Allow-Origin: https://chatgpt.com` (nie `*`), `Vary: Origin`, Allow-Methods
  `POST`, Allow-Headers mit `authorization, content-type, mcp-session-id, mcp-protocol-version`,
  Expose-Headers mit `Mcp-Session-Id, WWW-Authenticate`, KEIN `Allow-Credentials`; POST ohne Token
  -> 401 mit Challenge UND CORS-Headern; `Origin: https://evil.example` -> 403 ohne CORS-Header.
- Pre-Mortem: Ein Tippfehler spiegelt jeden Origin, und fremde Seiten lesen `/mcp`-Antworten mit.
  Gegenmassnahme: der CORS-Pfad liest dieselbe Liste wie die Wache (eine Quelle), Test mit fremdem
  Origin bei gesetzter Liste; kein Credentials-Header (Bearer, keine Cookies).
- Owner-Vorbereitung: OW-C (Messung, dann Wert). Deploy-Vorbedingung: keine (inert).

### T2-07 - Transport: Rate-Limit je Mandant statt je IP
- Risiko: transport. IDs: T-28. dokumentFuerOpenAI: nein. Loesung in 2.4.
- Dateien: `src/app.js` (:151-157), `src/routes/mcp.js`, `src/auth.js` (Ablehnungsgrund nach
  aussen reichen), `src/middleware.js` (`makeFixedWindowCounter` wiederverwenden), neue `test/mcp-rate-limit.test.js`, `PLAN-SECURITY.md`.
- Abnahme (`RATE_LIMIT_PER_MIN=3`, OAuth-Test-IdP, `X-Forwarded-For: 203.0.113.7`): Mandant A 3x 200,
  4. Aufruf 429 mit `Retry-After`; Mandant B von derselben IP 200; 3 ungueltig signierte Tokens ->
  je 401 mit `WWW-Authenticate`, das 4. -> 429, danach gueltiges Token von derselben IP 200 (erst
  pruefen, dann zaehlen); 4 abgelaufene, gueltig signierte Tokens derselben IP -> jedes 401 mit
  `WWW-Authenticate ... resource_metadata=`, kein 429; eine Nicht-`/mcp`-Route bleibt je IP
  gedrosselt; Token-Modus zaehlt je IP. Kein Code liest `openai/subject` (grep 0) - Begruendung im
  Kommentar. Code-Stelle: der Zaehler wird erst NACH dem Pruefergebnis und nur im Ablehnungszweig
  aufgerufen (der Grund kommt aus `err.code`, den `verifyOauth` schon loggt, `src/auth.js:110`).
- Pre-Mortem: (1) Ein Jahr spaeter koennen sich ChatGPT-Nutzer zu Stosszeiten nicht mehr
  verbinden: hinter OpenAIs geteilten Egress-IPs laufen viele abgelaufene Tokens ein (normaler
  Refresh), sie zaehlen als Fehlversuch, ab dem Limit bekommt der Client 429 statt 401 mit
  Challenge, stoesst keinen Refresh an und bleibt haengen - oder, bei "Sperre vor der Pruefung",
  wird sogar das gueltige Token des naechsten Nutzers derselben IP abgewiesen. Gegenmassnahme:
  Reihenfolge wie IEX-A7 (gueltig nie gedrosselt) und `ERR_JWT_EXPIRED` zaehlt nicht - beides in
  der Abnahme. (2) `/mcp` ist fuer Unauthentifizierte nur noch ueber den Fehlversuch-Zaehler
  gedrosselt, und eine Flut ungueltiger Tokens kostet weiter Arbeit. Benannter Rest, bewusst
  akzeptiert und im PLAN-SECURITY-Eintrag festgehalten: je Anfrage (a) JSON-Parse bis `BODY_LIMIT`
  - die Parser laufen app-weit VOR der Route (`src/app.js:159-162`), (b) ein JWT-Decode, (c)
  hoechstens eine Signaturpruefung (jose prueft die Signatur zuerst, Muell scheitert schon am
  Decode), (d) ein JWKS-Nachladen bei unbekanntem `kid` hoechstens alle 30 s
  (`createRemoteJWKSet` ohne Optionen, `src/auth.js:55`; jose-Default `cooldownDuration` 30000,
  `node_modules/jose/dist/webapi/jwks/remote.js:72-73`). Ab dem Limit antwortet der Server 429,
  die Pruefung laeuft trotzdem - die Drossel spart die Antwort, nicht die Pruefung. Eine Flut von
  vielen IPs faengt der Zaehler je IP nicht; das ist Sache der Hosting-Kante, nicht dieser Phase.
  Replay abgelaufener Tokens ist ungezaehlt, kostet aber je Anfrage nur (a)-(c) und setzt ein
  echtes, von unserem AS ausgestelltes Token voraus.
- Owner-Vorbereitung: OW-C Schritt 5 (kein 429 unter normaler Nutzung). Deploy-Vorbedingung: keine.

### T2-08 - Geldpfad: Hop-Fristen und Stundenlimit unter Sperre
- Risiko: geldpfad. IDs: T-27. dokumentFuerOpenAI: nein.
- Ziel: jeder MCP->REST-Hop hat eine Frist (benannte Konstante; heute fehlt sie bei `cancel_call`,
  `answer_consult`, `check_inbox`); die Stundenlimit-Pruefung zaehlt und reserviert atomar (unter
  derselben Sperre wie die Dedup, `src/routes/api-calls.js:526`), so dass parallele Aufrufe das
  Limit nicht ueberholen. Das Gate wird nur strenger, nie lockerer.
- Dateien: `src/mcp-tools.js` (Hop-Aufrufe), `src/telephony/outbound-gates.js` (:364-379, :485-496),
  `src/routes/api-calls.js`, Tests.
- Abnahme: (1) Test: Gateway-Attrappe antwortet nie -> `cancel_call`/`answer_consult`/`check_inbox`
  enden nach der Frist mit `isError`; (2) Nebenlaeufigkeits-Test ueber die echte REST-Route mit
  Stundenlimit L und N > L parallelen Anfragen (Fake-Originate) -> genau L angenommen, Rest
  abgelehnt mit dem bisherigen Status; (3) alle bestehenden Gate-Tests gruen.
- Pre-Mortem: Die Sperre serialisiert alle Mandanten oder bleibt nach einem Fehler haengen, und
  plotzlich geht kein Anruf mehr raus; oder ein fehlgeschlagener Verbindungsaufbau verbraucht
  einen Slot und sperrt einen Mandanten eine Stunde. Gegenmassnahme: Sperre je Mandant,
  `finally`-Freigabe, Test "Fehler im Originate gibt die Sperre frei"; ob ein nicht platzierter
  Anruf den Slot behaelt, entscheidet die Phase in Richtung strenger und benennt es.
- Deploy-Vorbedingung: keine.

### T2-09 - Geldpfad: neutrale Fehlertexte an der MCP-Grenze
- Risiko: geldpfad. IDs: O-13, O-20. dokumentFuerOpenAI: nein.
- Ziel: `api()` reicht keinen rohen `json.error` mehr durch; eine Tabelle bildet einen
  maschinenlesbaren Ablehnungsgrund auf neutrale englische Texte ab (kein Tarif-/Upgrade-Hinweis,
  kein Env-Name, kein "HTTP <status>", kein "fetch failed"); `list_action_items` gibt keine interne
  ID aus. Die REST-Antworten der Gates bekommen dazu ADDITIV ein Feld mit dem Grund (Quelle: der
  bereits vorhandene `denialAudit`-Schluessel); Entscheidung und Status der Gates bleiben
  unveraendert; das Dashboard behaelt seine Texte. `err.httpStatus` bleibt (AL-P13 braucht 400/409).
- Dateien: `src/mcp-tools.js` (:60-92, :1438-1441), `src/telephony/outbound-gates.js` (`deny`,
  nur Body), ggf. `src/i18n/gate-texts.js`, Tests.
- Abnahme (Draht, HTTP + stdio): mit `PAYMENT_ENABLED` und erschoepften Plan-Minuten (Fixture)
  liefert `place_call` `isError` mit Text ohne `Tarif|upgrade|plan|pricing` und ohne deutsche
  Woerter; mit `OUTBOUND_FROZEN=true` kein `OUTBOUND_FROZEN` im Text; Gateway nicht erreichbar -> kein
  `fetch failed`; `list_action_items` ohne `[<id>]`; derselbe Aufruf ueber REST liefert denselben
  Status wie vorher und es entsteht kein Anruf; `answer_consult` unterscheidet 400/409 wie bisher.
- Pre-Mortem: Die Texte werden so generisch, dass der Nutzer nicht erfaehrt, warum sein Anruf nicht
  rausging, und die instructions-Regel "tell the user what failed" laeuft ins Leere; oder ein neuer
  Gate-Grund faellt stumm in "unknown". Gegenmassnahme: jeder vorhandene Grund hat einen eigenen,
  sachlichen Text (Test iteriert ueber alle `denialAudit`-Schluessel); unbekannter Grund -> neutraler
  Text PLUS Warn-Log serverseitig.
- Deploy-Vorbedingung: keine.

### T2-10 - Dokument: Abgleich mit den Usage Policies, Faktenblatt Datenschutz
- Risiko: dokument. IDs: O-18. dokumentFuerOpenAI: nein (intern), trotzdem Opus (zitiert Policies).
- Ziel: `docs/OPENAI-POLICY-ABGLEICH.md`: jede einschlaegige Klausel der Usage Policies und App
  Guidelines woertlich mit URL -> Hermes-Mechanismus mit Code-Stelle oder benannte Luecke; darunter
  die Pruefung "high-stakes decisions ... without human review" gegen `mandate.decide_freely` und
  `accept_best`. Zweiter Teil: Faktenblatt fuer die Rechtstexte (O-6/O-15, Owner): welche Daten,
  Zweck, Aufbewahrung nach Code-Default (keine Produktionswerte), Empfaenger inkl. OpenAI als
  Quelle der Tool-Aufrufe, Art.-9-Beruehrung (Arzttermine).
- Abnahme: jede Aussage ueber ein Werkzeug nennt Handler-Zeile und ist gegen den `tools/list`-Text
  gegengelesen; jede Policy-Klausel ist woertlich zitiert; gefundene Code-Luecken stehen als Liste
  am Ende und gehen VOR T2-16 als Zusatzauftrag an den Lead (nicht im Dokument versteckt).
- Pre-Mortem: Das Dokument erklaert eine Policy als erfuellt, die es nicht ist (Plausibilitaet statt
  Code), und der Owner attestiert darauf. Gegenmassnahme: Opus, Handler zuerst lesen, jede Zeile
  mit Beleg, Verifizierer prueft 5 Stichproben am Code.
- Owner-Vorbereitung: Faktenblatt fuer OW-J. Deploy-Vorbedingung: keine.

**Zwischenmessung hier** (nach 11 von 23 Phasen: T2-01..T2-10 und T2-23).

### T2-11 - Werkzeug-Oberflaeche: ehrliche Namen, Titel und Beschreibungen (Serverseite)
- Risiko: sonstig. IDs: N-12, N-13, N-11 (N-12/N-13 erst zusammen mit T2-12 vollstaendig).
  dokumentFuerOpenAI: nein. Nach T2-02. Beruehrt `src/ui/**` NICHT - die Widget-Haelfte ist T2-12.
  **T2-11 und T2-12 gehen nur gemeinsam live**: nach T2-11 allein ruft das Call-Widget noch
  `get_transcript` (`src/ui/widgets/call.html:231`), den der Server dann nicht mehr kennt - das
  Anruf-Ergebnis erscheint in der Karte nie. Das ist ein Zwischenstand INNERHALB der Kette (sie
  pusht nie); die Gegenprobe in T2-12 (d) ist genau an diesem Zwischenstand rot.
- **Endgueltige Toolnamen (fest, kein Ermessen der Phase):**

  | heute | nach T2-11/T2-12 | Beleg fuer die Wahl |
  |---|---|---|
  | `get_transcript` | `get_call_result` (T2-11) | liefert `result_summary`, `objective_achieved` und die Ergebnis-Karte (`outcome`, `commitments`, `counterparty_commitments`, `open_points`, `next_step`) - `src/mcp-tools.js:220-228`, `src/call-result.js:94-103`; nie ein Transkript (`src/mcp-tools.js:1292-1294`). "summary" traefe nur eines von acht Feldern (N-13). |
  | `get_my_number` | `get_agent_number` (T2-11) | liefert `agent.number`, die Nummer des Telefon-Agenten (`src/mcp-tools.js:1340-1362`), nicht die des Nutzers. |
  | `get_calendar` | entfaellt (T2-12, zusammen mit seiner Karte) | Demo-Daten (`src/store/defaults.js:19-23`). |
  | `place_call`, `get_call_status`, `cancel_call`, `list_calls`, `check_inbox`, `list_action_items`, `get_agent_status`, `await_call_event`, `answer_consult` | unveraendert | - |

  `prepare_call` kommt erst in T2-13 dazu.
- **Sichtbare Texte (Kritiker-Runde 3, Blocker 2):** der Name allein ist nicht, was Modell und
  Nutzer sehen. Heute behaupten auch Titel und Statuszeilen ein Transkript: `title: "Get call
  transcript"` (`src/mcp-tools.js:682`, landet in `annotations.title`) und
  `invoking: "Reading the call transcript"` / `invoked: "Transcript read"` (`src/mcp-tools.js:750`,
  als `_meta["openai/toolInvocation/invoking"|"invoked"]` in `tools/list`, `src/mcp-tools.js:737-738,785`).
  Vorgabe: `get_call_result` -> Titel "Get call result", invoking "Reading the call result",
  invoked "Call result read" (je <= 64 Zeichen, T-22-Test). `get_agent_number` behaelt Titel
  "Agent phone number" und "Looking up the agent number" / "Agent number read"
  (`src/mcp-tools.js:694-695,756` - schon ehrlich). Die Beschreibung von `get_call_result` darf
  "transcript" nur im Verneinungssatz tragen ("This tool NEVER returns the raw transcript",
  `src/mcp-tools.js:1280`). NICHT angefasst: `get_call_status` nennt "the last transcript lines"
  zu Recht - es liefert `last_transcript_lines` (`src/mcp-tools.js:183-195,1258`).
- Ziel: die zwei Umbenennungen oben in Registrierung, `TOOL_ANNOTATIONS`, Statuszeilen-Tabelle,
  Beschreibungen und Server-instructions (`src/mcp-server-info.js:90-99` nennt `get_transcript`);
  `get_agent_status` nennt jedes Feld seines `outputSchema` in der Beschreibung; `answer_consult`
  traegt den Satz "The agent may relay your answer to the person on the call." woertlich in der
  Beschreibung (N-11). Alle Kommentare AUSSERHALB von `src/ui/`, die die zwei alten Namen nennen
  (`src/mcp-tools.js`, `src/mcp-server-info.js`, `src/store/json.js`, `src/store/state-ops.js`,
  `src/elevenlabs/outbound.js`, `src/conversation/conversation-ports.js`, `src/routes/_tenant.js`,
  `src/routes/api-read.js`, `src/routes/api-inbox.js`, `src/i18n/failure-reason-texts.js:99`),
  ziehen mit - ein Kommentar mit altem Namen luegt ab dieser Phase. `get_calendar`, `allowCalendar`
  und alles unter `src/ui/` bleiben fuer T2-12.
- Dateien: `src/mcp-tools.js`, `src/mcp-server-info.js`, die Kommentar-Stellen oben,
  `docs/OPENAI-TOOL-INVENTORY.md` (Tabelle "Umbenennungen"), Tests (`openai-p10a-tool-inventar`,
  `mcp-tool-annotations`, `p15-mcp-tool-descriptions-en`, `mcp-tools*`,
  `openai-p4-ergebnisstruktur-instructions`, `al-p11-result-card`, `mcp-fehlergrund-rueckweg`,
  `a8-abschluss-zusammenfassung`, `openai-p5b-geldpfad`, `read-scope-tenant`, `elevenlabs-*` -
  dort nur Kommentare/Testnamen), neue `test/openai-t2-werkzeugtexte.test.js`. Die Website
  (`apps/web/src/components/HermesDemo.astro:39,69`) zieht T2-19 nach (nur ueber das Labor).
- Abnahme (Draht, Kindprozess `PORT=0`, Temp-`DATA_DIR`; HTTP OAuth mit Test-IdP, HTTP
  Token/Legacy, je mit und ohne Consult, dazu stdio-Kindprozess):
  (a) `tools/list`: `get_call_result` und `get_agent_number` vorhanden, `get_transcript` und
  `get_my_number` fehlen; sonst ist die Namensmenge je Pfad und Profil gleich der vor der Phase
  (`get_calendar` erscheint weiter dort, wo er heute erscheint - er faellt erst in T2-12);
  (b) sichtbare Texte am Draht (NICHT am Registrierungsobjekt): fuer `get_call_result` enthalten
  `title` (falls gesetzt), `annotations.title`, `_meta["openai/toolInvocation/invoking"]` und
  `_meta["openai/toolInvocation/invoked"]` keinen Treffer fuer `/transcript/i`; die `description`
  enthaelt `/transcript/i` nur im Verneinungssatz - der Test schneidet genau diesen Satz heraus und
  findet danach 0 Treffer; fuer `get_agent_number` enthalten dieselben vier Texte `/agent/i` und
  keinen Treffer fuer `/\bmy\b/i`; kein sichtbarer Text irgendeines Tools und nicht
  `initialize.result.instructions` enthaelt `get_transcript` oder `get_my_number`
  (Positiv-Kontrolle im Test: dieselbe Pruefung findet `get_call_result` in den instructions);
  (c) `grep -rn "get_transcript\|get_my_number" src scripts --exclude-dir=ui` liefert 0 Zeilen;
  (d) `answer_consult`-Beschreibung am Draht enthaelt den N-11-Satz woertlich;
  (e) jeder Schluessel aus dem `outputSchema` von `get_agent_status` (am Draht gelesen) steht in
  dessen Beschreibung (Test berechnet die Schluessel aus dem Draht, keine gepflegte Liste);
  (f) `tools/call get_call_result` liefert dieselben `structuredContent`-Schluessel wie heute
  `get_transcript` (Vergleich gegen `TRANSCRIPT_OUTPUT`, `src/mcp-tools.js:243-248`);
  `tools/call get_transcript` liefert jetzt einen Fehler (Breaking Change belegt, nicht still).
- Pre-Mortem: (1) Die Namen sind neu, aber Titel und Statuszeile sagen weiter "Transcript" - der
  Reviewer sieht im Bestaetigungsdialog "Reading the call transcript" und lehnt nach N-13 ab, obwohl
  unsere Abnahme gruen war, weil sie nur Namen verglich. Gegenmassnahme: Kriterium (b) liest alle
  sichtbaren Texte vom Draht. (2) Die Server-instructions nennen weiter `get_transcript`; das Modell
  ruft nach einem gescheiterten Anruf ein Tool, das es nicht gibt, und der Nutzer erfaehrt den
  Fehlergrund nie (genau der Fall aus `src/mcp-server-info.js:90-99`). Gegenmassnahme: (b) prueft
  `instructions` am Draht mit Positiv-Kontrolle. (3) Der Owner deployt T2-11 ohne T2-12 - die
  Karte zeigt kein Ergebnis mehr. Gegenmassnahme: Hinweis oben, OW-A, Gegenprobe T2-12 (d).
- Owner-Vorbereitung: nach Deploy den eigenen Claude-Connector neu verbinden (OW-A).

### T2-12 - Widget: Karten ziehen die Umbenennung nach, Kalender-Karte und -Tool entfallen
- Risiko: widget. IDs: N-12, N-13 (Karten-Haelfte; vollstaendig mit T2-11), O-25.
  dokumentFuerOpenAI: nein. Direkt nach T2-11, nur gemeinsam mit T2-11 live.
- Warum eigene Phase (Kritiker-Runde 3, Blocker 5): hier aendert sich, was die Karten tun und
  zeigen. Der bestehende Call-Widget-Test (`test/mcp-ui-w1-call-widget.test.js:260-333`) prueft das
  Widget isoliert gegen die Zeichenkette `"get_transcript"` - er bliebe nach T2-11 gruen, obwohl
  die Karte einen Namen ruft, den der Server nicht mehr kennt. Die Gegenprobe (d) koppelt deshalb
  Widget und Server am Draht.
- Ziel: (1) Call-Widget: `TOOL_GET_TRANSCRIPT = "get_transcript"` (`src/ui/widgets/call.html:231`)
  wird eine Konstante auf `get_call_result`, samt Kommentaren (`:200,450,566,595,642-670`;
  Bezeichner wie `fetchTranscriptOnce` gehen mit, `last_transcript_lines` bleibt - das ist ein
  `get_call_status`-Feld). (2) My-Number-Widget: sichtbare Beschriftung und `@dsCard`-Name
  `get_my_number` (`src/ui/widgets/my-number.html:1,30`) -> `get_agent_number`; die interne
  Kennung `my-number` (URI-Teil, kein Toolname) bleibt - eine Umbenennung verschoebe nur
  Cache-Schluessel ohne Anforderung. (3) `get_calendar` faellt als Tool UND als Karte in einem
  Zug: Registrierung (`src/mcp-tools.js:1449-1454`), `TOOL_ANNOTATIONS`/Statuszeile
  (`:719,763`), `CALENDAR_OUTPUT`/`pickCalendarEntry` (`:525-536`), der dann tote Parameter
  `allowCalendar` von `registerTools` (`src/mcp-tools.js:794-812`, Aufrufer `src/routes/mcp.js:162`),
  `WIDGET_CALENDAR` (`src/ui/widget-catalog.js:23`), `src/ui/widgets/calendar.html` (loeschen),
  Kalender-Texte in `src/ui/widget-i18n.js`, Kommentare (`src/ui/widget-bind.js:22`,
  `src/ui/registry.js:36`, `src/mcp-tools.js:465`). Der Store und das Profilfeld bleiben
  unberuehrt (Store-Schema, keine Plugin-Flaeche). UNKNOWN fuer die Phase: ob der Telefon-Agent
  die Demo-Kalenderdaten liest - dann NUR die MCP-Oberflaeche aendern und benennen.
  (4) Widget-Versionen: call und my-number bekommen neue Hash-Pins (cache-feste URIs aus T2-02).
- Dateien: `src/ui/widgets/call.html`, `src/ui/widgets/my-number.html`,
  `src/ui/widgets/calendar.html` (loeschen), `src/ui/widget-catalog.js`, `src/ui/widget-i18n.js`,
  `src/ui/widget-bind.js`, `src/ui/registry.js`, `src/mcp-tools.js` (nur Kalender-Teile),
  `src/routes/mcp.js` (`allowCalendar`), `docs/OPENAI-TOOL-INVENTORY.md`, Tests
  (`mcp-ui-w1-call-widget`, `mcp-ui`, `mcp-ui-i18n-divergence`, Widget-Hash-Pins aus T2-02), neue
  `test/openai-t2-widget-namen.test.js`.
- Abnahme (Draht, Kindprozess `PORT=0`, Temp-`DATA_DIR`; HTTP OAuth, HTTP Token/Legacy, stdio):
  (a) `tools/list`, ohne Consult und stdio: Namensmenge GENAU {`cancel_call`, `check_inbox`,
  `get_agent_number`, `get_agent_status`, `get_call_result`, `get_call_status`,
  `list_action_items`, `list_calls`, `place_call`} (9); HTTP MIT Consult: diese 9 plus
  {`answer_consult`, `await_call_event`} (11);
  (b) `resources/list`: Widget-Kennungen genau {`agent-status`, `call`, `calls`, `my-number`};
  Verwaisungs-Pruefung in beide Richtungen: jede `_meta.ui.resourceUri` aus `tools/list` steht in
  `resources/list`, und jede gelistete Resource wird von mindestens einem Tool referenziert (O-25);
  (c) `resources/read` jedes gelisteten Widgets enthaelt keinen der drei alten Namen; das
  My-Number-Widget enthaelt `get_agent_number`; jedes enthaelt weiter csp/domain aus T2-01;
  die URIs von call und my-number unterscheiden sich von ihren Pins vor der Phase;
  (d) **Gegenprobe Call-Widget am Draht:** der Test holt den Call-Widget-Text per `resources/read`
  vom laufenden Server (nicht aus der Datei), faehrt ihn im node:vm-Fake-Window
  (`test/mcp-ui-w1-call-widget.test.js`-Muster, `parent.postMessage` wird mitgeschnitten) ueber
  `in_progress` bis `completed` und prueft: jeder `params.name` jeder gesendeten
  `tools/call`-Nachricht steht in der `tools/list`-Namensmenge DESSELBEN Servers; Positiv-Kontrolle:
  die gesendete Menge ist nicht leer und enthaelt `get_call_status` und genau einmal
  `get_call_result`. Am Zwischenstand nach T2-11 (Widget unveraendert) ist dieser Test rot - das
  ist seine Beweiskraft;
  (e) `grep -rn "get_transcript\|get_my_number\|get_calendar" src scripts` liefert 0 Zeilen; in
  `test/` stehen die alten Namen nur in Assertions, die ihr Fehlen pruefen; das Inventar nennt sie
  nur in der Tabelle "Umbenennungen";
  (f) der Sandbox-Scan aus X-6 bleibt fuer jedes Widget gruen.
- Pre-Mortem: (1) Ein Jahr spaeter zeigt die Anruf-Karte in ChatGPT nach Anrufende nie ein
  Ergebnis: sie ruft einen Namen, den der Server nicht kennt, und alle Tests waren gruen, weil der
  Widget-Test das Widget isoliert prueft. Gegenmassnahme: Gegenprobe (d) mit Positiv-Kontrolle.
  (2) Die Kalender-Karte steht noch in `resources/list`, ihr Tool ist weg - der Scan meldet eine
  verwaiste UI (O-25). Gegenmassnahme: (b) in beide Richtungen. (3) Ein Host cached die alte
  Call-Karte und ruft weiter `get_transcript`. Gegenmassnahme: neue URI je Inhaltsaenderung (c),
  Mechanik aus T2-02. (4) Das Loeschen von `allowCalendar` aendert still, welche Tools ein
  restriktives Profil sieht. Gegenmassnahme: (a) je Pfad; kein anderes Tool hing an dem Parameter
  (`src/mcp-tools.js:1454` ist die einzige Lesestelle, Phase belegt per grep).
- Owner-Vorbereitung: keine eigene; OW-A (Connector neu verbinden) und OW-D (Karte in ChatGPT)
  decken sie ab. Deploy-Vorbedingung: nur zusammen mit T2-11.

### T2-13 - Geldpfad: serverseitige Bestaetigung vor dem Waehlen
- Risiko: geldpfad. IDs: N-10 (Serverteil; erfuellt erst mit T2-14). dokumentFuerOpenAI: nein (die
  Begruendung fliesst in T2-21/T2-22). Nach T2-12. **T2-13 und T2-14 gehen nur gemeinsam live**:
  nach T2-13 allein kann niemand mehr waehlen, weil erst T2-14 den Code sichtbar macht.
- Primaerquellen (woertlich):
  - https://developers.openai.com/plugins/build/mcp-server - "Annotations help ChatGPT and Codex
    choose appropriate confirmation and safety behavior." / "Require confirmation for consequential
    write actions." / "Treat `_meta` as hidden from the model, not as a substitute for
    authorization or secure storage."
  - https://developers.openai.com/plugins/reference - "Only `structuredContent` and `content` appear
    in the conversation transcript. The host forwards `_meta` to the component so you can hydrate UI
    without exposing the data to the model." (Anforderung X-2: "Delivered only to the component.
    Hidden from the model.")
  - https://developers.openai.com/api/docs/mcp - "ChatGPT currently requires manual confirmation in
    any conversation before write actions can be taken." - das ist Host-Bestaetigung EINMAL je
    Konversation (N-8), keine je Anruf und keine serverseitige.
- **Warum ein Code im Ergebnis-`_meta` und nicht im Text:** stuende das Bestaetigungs-Token in
  `content` oder `structuredContent`, saehe das Modell es und koennte `prepare_call` -> `place_call`
  in einem Zug verketten, ohne dass ein Mensch etwas sieht - die Bestaetigung waere nur formal. Im
  Ergebnis-`_meta` ist der Code laut OpenAI fuer das Modell unsichtbar und erreicht nur die Karte;
  in das Modell gelangt er erst durch einen Klick des Nutzers (T2-14). Der Code ist KEINE
  Autorisierung (Zitat oben): alle Gates laufen beim Waehlen unveraendert.
- Ziel: neues Tool `prepare_call` (wirklich lesend): nimmt dieselben Argumente wie `place_call`,
  normalisiert das Ziel ueber das bestehende `normalize_target`-Gate, prueft das Format und liefert
  (1) in `content`/`structuredContent` eine Vorschau mit `status: "awaiting_confirmation"`,
  normalisiertem `to`, `objective` und den kostenrelevanten Feldern - OHNE Code; (2) in
  `_meta["hermes/confirmation_code"]` einen kurzen, abtippbaren, zustandslosen Code = HMAC ueber
  Mandant + normalisiertes `to` + `objective` + kostenrelevante Felder + Zeitfenster, gekuerzt;
  Laenge, Alphabet und Fenster als benannte Konstanten, dazu `expires_at` im selben `_meta`.
  Gebunden ist genau, was die Vorschau dem Menschen zeigt; `briefing`/`context` nicht (umformulierter
  Kontext soll nicht scheitern). `prepare_call` bindet das Call-Widget (`enableWidgetUi(WIDGET_CALL)`),
  keine neue Resource. `place_call` bekommt das Feld `confirmation_code` und waehlt nur bei
  Treffer; sonst `isError` mit der Vorschau und dem Satz, dass der Nutzer den Anruf in der
  Hermes-Karte bestaetigen muss. **Das Feld ist im `inputSchema` OPTIONAL, die Pflicht setzt der
  Handler durch** (Kritiker-Runde 3, Blocker 1): das MCP-SDK 1.29.0 prueft die Argumente gegen das
  Schema, BEVOR der Handler laeuft (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:125`
  `validateToolInput`, `:166-178` wirft `McpError(InvalidParams, "Input validation error: ...")`),
  und der `catch` macht daraus ein `isError` mit dem Text "MCP error -32602: Input validation
  error: Invalid arguments for tool place_call: ..." (`:135-141`, `createToolError` `:152`; Meldungsformat `dist/esm/types.js:2031`) - ohne
  Handlertext. Als Pflichtfeld waere die Vorschau aus (b) und der Host-Hinweis aus Pre-Mortem (2)
  also unerreichbar. Optional im Schema schwaecht nichts: das Schema ist nicht das Gate, der
  Handler ist es, und er behandelt fehlend, leer und falsch gleich (kein Anruf). Die Beschreibung
  von `place_call` und die des Feldes sagen, dass ohne gueltigen Code nicht gewaehlt wird und der
  Code nur aus der Hermes-Karte kommt. Ein Kommentar an der Schema-Zeile nennt den SDK-Grund, damit
  niemand das Feld spaeter "haertet". Welche Felder kostenrelevant sind, legt die Phase am Code fest und
  listet sie im Inventar. Replay im Fenster faengt die bestehende Dedup. Brute-Force-Rechnung
  (Codelaenge gegen das Rate-Limit aus T2-07) steht als Kommentar an der Konstante. Keine
  MCP-Elicitation (zustandsloser Transport: die Antwort kaeme bei einer anderen Serverinstanz an).
  `cancel_call` (schadensmindernd) und `answer_consult` (sekundenkritisch, nur innerhalb eines
  bereits bestaetigten Anrufs) bekommen keine zweite Stufe - Begruendung im Inventar.
- Dateien: `src/mcp-tools.js`, neue Datei fuer Code-Bau/-Pruefung, `src/mcp-server-info.js`
  (Sequenz in einem Satz), `docs/OPENAI-TOOL-INVENTORY.md`, `PLAN-SECURITY.md` (neuer Schritt und
  seine Host-Abhaengigkeit), Tests; Schluessel per HKDF aus einem in Produktion Pflicht-Secret (die
  Phase belegt am Boot-Guard, welches; findet sie keins, neue Env-Var -> Deploy-Vorbedingung).
- Abnahme (Draht, HTTP OAuth/Legacy mit und ohne Consult, stdio, Fake-Originate):
  (a) `tools/call prepare_call`: der Code steht in `result._meta["hermes/confirmation_code"]` und
  kommt in `JSON.stringify(result.content)` und `JSON.stringify(result.structuredContent)` NICHT vor
  (Substring-Suche nach dem Codewert); `structuredContent.status === "awaiting_confirmation"`;
  (b) `place_call` ohne `confirmation_code`, mit leerem String und mit einem erfundenen Code ->
  jeweils `isError`, der Text stammt aus dem HANDLER: er enthaelt das normalisierte `to`, den
  `objective` und den Satz ueber die Bestaetigung in der Hermes-Karte (inkl. Hinweis, dass ein Host
  ohne Karte nicht waehlen kann) und enthaelt NICHT "Input validation error"; kein Anruf im Store,
  REST `POST /api/calls` nicht getroffen;
  (c) Code aus (a) -> Anruf angelegt (der Test liest den Code aus `_meta` und simuliert damit den
  Weg Karte -> Nutzer -> Modell), danach `await_call_event` mit dem `call_id` wie heute;
  (d) geaendertes `to` oder `objective` -> `isError`, kein Anruf; Fenster abgelaufen (Uhr injiziert)
  -> `isError`; Code eines anderen Mandanten -> `isError`;
  (e) `prepare_call` veraendert den Store nicht (Hash vorher = nachher) und schreibt kein Gate-Audit;
  (f) `tools/list`: `prepare_call` `readOnlyHint:true, destructiveHint:false, openWorldHint:false`,
  `place_call`-Annotationen unveraendert; `confirmation_code` steht in
  `inputSchema.properties` von `place_call` und NICHT in `inputSchema.required` (am Draht gelesen),
  seine Beschreibung nennt die Pflicht; Code-Stelle: der Kommentar an der Schema-Zeile nennt den
  SDK-Grund (`mcp.js:125,166-178`);
  (g) Namensmengen aus T2-12 plus `prepare_call` (10 ohne, 12 mit Consult).
- Pre-Mortem: (1) Ein Host reicht Ergebnis-`_meta` doch ans Modell weiter, das Modell bestaetigt
  sich selbst, alle Tests bleiben gruen, und die Bestaetigung ist wieder nur formal - unbemerkt.
  Gegenmassnahme: OW-C/OW-D fragen das Modell VOR dem Klick nach dem Code (erwartet: kennt ihn
  nicht); leakt ein Host, ist der Rueckfall in Abschnitt 5 beschrieben (Waehlen nur aus der App).
  (2) Das Team waehlt aus Claude Code oder stdio (kein Widget) und kann ploetzlich nicht mehr
  anrufen, merkt es erst beim naechsten Testanruf. Gegenmassnahme: der `isError`-Text von
  `place_call` sagt, dass dieser Host die Bestaetigungskarte nicht zeigen kann; Inventar und OW-A
  nennen die Folge ausdruecklich. (3) `prepare_call` schreibt doch (Audit, Normalisierungs-Cache) und
  ist faelschlich als lesend annotiert - Ablehnungsgrund N-6. Gegenmassnahme: Kriterium (e).
  (4) Die Kette bricht nach T2-13 ab, der Owner deployt diesen Stand, und niemand kann waehlen.
  Gegenmassnahme: Hinweis oben und in OW-A: T2-13 nur zusammen mit T2-14.
  (5) Jemand "haertet" spaeter das Schema und macht `confirmation_code` zur Pflicht (oder ein
  SDK-Update aendert die Reihenfolge) - ab da sieht jeder Host ohne Code nur "Input validation
  error", das Modell weiss nicht, dass es eine Karte braucht, und Pre-Mortem (2) tritt still ein.
  Gegenmassnahme: Kriterium (f) prueft `required` am Draht, Kriterium (b) prueft den Handlertext;
  beide werden in diesem Fall rot.
- Deploy-Vorbedingung: `MCP_UI_ENABLED` im Dashboard NICHT `false` (sonst rendert keine Karte, der
  Code wird nie sichtbar, und jeder MCP-Anruf scheitert) - OW-G; dazu neue Env-Var, falls die Phase
  eine braucht (Wert im Dashboard, OW-G).

### T2-14 - Widget: Bestaetigungs-Ansicht im Call-Widget
- Risiko: widget. IDs: N-10 (sichtbarer Schritt; erst zusammen mit T2-13 erfuellt).
  dokumentFuerOpenAI: nein. Nach T2-13 (und damit nach T2-01/T2-02).
- Primaerquellen (woertlich): https://developers.openai.com/plugins/build/chatgpt-ui - "ChatGPT
  implements the open MCP Apps standard for UI returned by an MCP server."; "Send a follow-up
  message" ueber `ui/message` (Alias `window.openai.sendFollowUpMessage`).
  https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx -
  `ui/message`: "Send message content to the host's chat interface", `role: "user"`, "Host SHOULD
  add the message to the conversation context, preserving the specified role."
- Ziel: das Call-Widget (`src/ui/widgets/call.html`) bekommt den Zustand
  `status === "awaiting_confirmation"`: zeigt normalisierte Nummer, Auftrag und die kostenrelevanten
  Felder aus `structuredContent` und einen Knopf "Anruf bestaetigen" (Texte ueber
  `src/ui/widget-i18n.js`, alle Sprachen). Den Code liest es aus `params._meta` von
  `ui/notifications/tool-result`. NUR der Klick sendet genau eine `ui/message` (`role: "user"`) mit
  Nummer, Auftrag und Code; danach ist der Knopf gesperrt. Antwortet der Host mit Fehler oder gar
  nicht (Frist als benannte Konstante), zeigt die Karte den Code mit dem Satz "Gib diesen Code im
  Chat ein" - ohne Zwischenablage-API (X-6). Abgelaufen (`expires_at`) -> Hinweis "neu vorbereiten",
  kein Senden. Das Widget ruft `place_call` NIE selbst: das Modell braucht den `call_id` aus
  `place_call`, um die Consult-Schleife (`await_call_event`) zu fahren.
- Dateien: `src/ui/widgets/call.html`, `src/ui/widget-i18n.js`, Tests
  (`test/mcp-ui-w1-call-widget.test.js`-Muster: node:vm-Fake-Window, `parent.postMessage` wird
  mitgeschnitten), Widget-Hash-Pins aus T2-02 -> neue Widget-Version, `docs/OPENAI-TOOL-INVENTORY.md`
  (Ablauf in einem Absatz).
- Abnahme (Fake-Window mit dem tatsaechlich ausgelieferten `resources/read`-Text des Call-Widgets):
  (a) `ui/notifications/tool-result` mit Vorschau + `_meta`-Code, KEIN Klick, dazu ein zweites
  Rendern -> 0 Nachrichten mit `method: "ui/message"`; (b) ein Klick -> genau 1 `ui/message`,
  `params.role === "user"`, Text enthaelt Code, Nummer und Auftrag; (c) Doppelklick -> weiterhin 1;
  (d) Host antwortet mit JSON-RPC-Fehler auf `ui/message` -> Code sichtbar im DOM, kein
  `navigator.clipboard`-Zugriff; (e) `expires_at` in der Vergangenheit -> 0 `ui/message`, Hinweistext
  sichtbar; (f) das Widget sendet in keinem Fall `tools/call` mit `name: "place_call"`;
  (g) `resources/read` des Call-Widgets am Draht (HTTP und stdio) enthaelt weiterhin csp/domain aus
  T2-01 und besteht den Sandbox-Scan aus X-6; (h) X-2 gilt weiter: ausser `prepare_call` traegt kein
  Tool-Ergebnis ein `_meta` mit Nutzdaten.
- Pre-Mortem: Die Karte schickt die Bestaetigung schon beim Rendern oder beim erneuten Aufbau aus
  dem Verlauf - jeder Seiten-Reload bestaetigt still einen weiteren Anruf, und die Bestaetigung ist
  wieder formal. Gegenmassnahme: Senden ausschliesslich im Klick-Handler, Kriterien (a) und (c). Oder:
  ein Host kennt `ui/message` nicht, der Nutzer sieht nur einen toten Knopf und bricht ab.
  Gegenmassnahme: Rueckfall "Code anzeigen", Kriterium (d); Live-Beleg in OW-C/OW-D.
- Owner-Vorbereitung: OW-C Schritt (6) und OW-D (Bestaetigungsprobe). Deploy-Vorbedingung: wie T2-13
  (`MCP_UI_ENABLED` nicht `false`).

### T2-15 - Restricted Data: Eingabepruefung, Ausgabe-Maskierung, Feldhinweise
- Risiko: sonstig. IDs: O-14. dokumentFuerOpenAI: nein.
- Ziel: MCP-seitig (vor dem REST-Hop) lehnen `place_call`/`prepare_call`/`answer_consult` Freitext
  mit Luhn-gueltigen Kartennummern (13-19 Ziffern, mit Trennern) und gueltigen IBANs (mod 97) ab -
  ausgenommen das Feld `to` und Token mit fuehrendem `+`; MCP-Ausgaben (Zusammenfassung,
  `last_transcript_lines`, Action Items) maskieren dieselben Muster; jede Freitext-Feldbeschreibung
  schliesst Zahlungsdaten, Ausweisnummern, Gesundheitsakten und Zugangsdaten aus.
- Dateien: neue kleine Pruef-/Maskier-Datei, `src/mcp-tools.js` (Validierung + Views + Feldtexte),
  Tests.
- Abnahme (Draht): Karte `4111 1111 1111 1111` im `objective` -> `isError`, kein Anruf; deutsche
  Handynummer ohne `+`, Datum, Uhrzeit, Kundennummer (nicht Luhn) -> kein Fehlalarm (Tabelle von
  Gegenbeispielen im Test); gespeicherter Anruf mit Karte im Transkript -> Tool-Ausgabe maskiert,
  Store unveraendert; Feldbeschreibungen am Draht enthalten den Ausschluss.
- Pre-Mortem: Die Pruefung blockt legitime Auftraege (Bestellnummer, die zufaellig Luhn-gueltig
  ist) - Nutzer koennen ihren Friseur nicht mehr anrufen. Gegenmassnahme: Ablehnung nennt Feld und
  Kategorie, damit der Nutzer umformuliert; Gegenbeispiel-Tabelle; Luhn nur ab 13 Ziffern.
- Deploy-Vorbedingung: keine; die Feldtext-Aenderung an `place_call` faellt unter die Messung von T2-16.

### T2-16 - place_call-Texte neutral und minimal, Messwerkzeug Aufrufer-Seite
- Risiko: sonstig. IDs: O-27, N-14, O-15, O-19. dokumentFuerOpenAI: nein. Siehe 2.3.
- Ziel: (a) O-27: `:955` "(calendar, mail, files, chat)" -> "from your own tools and context";
  "(not as Claude/Gemini)" -> "(not as the chat assistant writing this briefing)"; `:1024` "NEVER as
  Claude/Gemini" -> "NEVER as the chat assistant filling in this field" (Test-Anker bleiben);
  (b) N-14: `briefing` fordert nur das fuer den Anruf Noetige statt "context from the chat so far";
  `context` bekommt einen engen Zweck je Unterfeld statt "ADDITIONAL" - je Feld eine
  Notwendigkeits-Begruendung im Inventar; (c) O-15: Gesundheits-/Art.-9-Angaben nur im fuer den
  Termin noetigen Mindestmass; (d) O-19: Zweckklausel (kein Telemarketing, keine Werbe-, Verkaufs-
  oder Inkasso-Kampagnen) in `place_call` und in den instructions; (e) Messwerkzeug
  `scripts/briefing-bench/` mit Attrappen-Modus.
- Dateien: `src/mcp-tools.js` (place_call-Texte), `src/mcp-server-info.js` (Zweckklausel),
  `docs/OPENAI-TOOL-INVENTORY.md`, neuer Draht-Scan-Test, `scripts/briefing-bench/*`.
- Abnahme: Draht HTTP + stdio + `initialize.instructions`: kein
  `/\b(claude|gemini|chatgpt|copilot|openai)\b/i`, kein `/calendar, mail|mail, files/` in irgendeinem
  String (Positiv-Kontrolle: derselbe Scan schlaegt auf `288376b` an); Anker in
  `test/p15-mcp-tool-descriptions-en.test.js`, `test/gq-b1-briefing-openness.test.js`,
  `test/place-call-context-bridge.test.js` gruen; `briefing-bench` im Attrappen-Modus erkennt eine
  eingeschleuste Selbstnennung (Positiv-Kontrolle) und laeuft deterministisch.
- Pre-Mortem: Die neutralere Formulierung laesst das Chat-Modell Briefings schreiben, in denen der
  Agent sich als "Claude" vorstellt oder Luecken erfindet - schlechtere Anrufe, niemand merkt es,
  weil nie gemessen wurde. Gegenmassnahme: Deploy-Vorbedingung Messung; Text-Aenderungen in einem
  eigenen Commit, damit der Rueckbau ein Revert ist.
- Deploy-Vorbedingung: OW-H - `briefing-bench` echt, n>=5 je Szenario, alt (`288376b`) gegen neu:
  (a) = 0, (b) neu >= alt, (c) = 0. Verfehlt -> Text-Commit zuruecknehmen, O-27 als offen melden.

### T2-17 - Server-instructions: Kern in die ersten 512 Zeichen
- Risiko: sonstig. IDs: T-21. dokumentFuerOpenAI: nein. Nach T2-11, T2-12, T2-13, T2-14, T2-16.
- Ziel: In jedem Modus (Consult an/aus, HTTP/stdio) stehen in den ersten 512 Zeichen: Geld-Satz,
  Sequenz `prepare_call` -> Nutzer bestaetigt in der Hermes-Karte -> `place_call` mit dem Code aus
  der Nachricht des Nutzers -> `await_call_event` bis `done`, und im Consult-Modus die
  sofortige Quittung `answer_consult` mit `status="working"`. "Nicht wiederholen bei not-placed" und
  "nie Antworten erfinden" bleiben erhalten (dahinter erlaubt).
- Dateien: `src/mcp-server-info.js`, Tests (T-21-Tests aus P4).
- Abnahme: `initialize` am Draht (HTTP Consult an/aus, stdio): `instructions.slice(0,512)` enthaelt
  `prepare_call`, `place_call`, `confirmation_code`, `await_call_event`, `done`; mit Consult zusaetzlich `answer_consult` und
  `working`; Gesamttext enthaelt weiter `not-placed` und das Erfindungsverbot.
- Pre-Mortem: Beim Verdichten faellt die Regel "bei not-placed nicht erneut anrufen" weg, und Modelle
  waehlen nach einem Fehler dreimal - echte Kosten. Gegenmassnahme: Test auf die Pflichtsaetze im
  Gesamttext; keine Aenderung an den Saetzen selbst, nur Reihenfolge und Verdichtung des Kerns.
- Deploy-Vorbedingung: keine.

### T2-18 - Kompatibilitaets-Vertrag und Update-Runbook
- Risiko: sonstig. IDs: T-33. dokumentFuerOpenAI: nein. Letzte Code-Phase (nach allen Breaking Changes).
- Primaerquelle: https://developers.openai.com/plugins/deploy/app-review - "Keep your server compatible
  with the live definition while an update is held." / https://developers.openai.com/plugins/build/mcp-server -
  "Keep published tool names and schemas backward compatible. Add fields or tools without breaking
  existing contracts."
- Ziel: Vertrags-Datei aus dem Draht (Toolnamen, Pflichtargumente, Typen, outputSchema-Felder,
  Resource-URIs); Test: Entfernen/Umbenennen eines Tools, neues Pflichtargument, Typwechsel oder
  entfernte URI -> rot, ausser mit neuem Vertragseintrag samt Begruendung. Runbook
  `docs/RUNBOOK-MCP-UPDATE.md`: waehrend eines gehaltenen Updates alte Definition lauffaehig halten,
  Widget-URI bei Bruch neu versionieren und alte weiter ausliefern, Tools erst nach Publikation
  entfernen, Scan erneut fahren.
- Abnahme: Test gegen den Draht HTTP + stdio gruen; Positiv-Kontrolle: Pflichtfeld in einem Tool
  hinzufuegen -> rot; Runbook verweist nur auf existierende Dateien/Kommandos.
- Pre-Mortem: Der Vertrag wird bei jeder Aenderung stumpf neu gepinnt, und der Test schuetzt nichts.
  Gegenmassnahme: Neu-Pinnen nur ueber einen Eintrag mit Pflicht-Begruendung; Test prueft, dass
  jede Aenderung einen Eintrag hat.
- Deploy-Vorbedingung: keine.

### T2-19 - Support-Seite (Website, ueber das Labor)
- Risiko: sonstig. IDs: O-7. dokumentFuerOpenAI: nein.
- Ziel: oeffentliche Support-Seite in `apps/web` (EN, Marketing-Regel): wie man Hilfe bekommt
  (vorhandener oeffentlicher Kontakt), wie man den Connector in ChatGPT/Claude trennt, wie man
  Daten loeschen laesst, Verweis auf Datenschutz/AGB. Kein Rechtstext-Inhalt, keine neue externe
  Quelle. Autonome Entscheidung P10b: Website nur ueber `staging` und Labor - der Branch geht von
  `staging` ab und wird von der Kette NICHT auf master gemergt. Im selben Branch zieht die Demo-Zeile
  der Startseite die Toolnamen aus T2-11 nach (`apps/web/src/components/HermesDemo.astro:39,69` nennt
  heute `get_transcript` und `get_calendar`).
- Dateien: `apps/web/src/pages/support.astro` (o.ae.), Footer-Link,
  `apps/web/src/components/HermesDemo.astro`, `docs/RUNBOOK-LAB-LIVE.md` lesen.
- Abnahme: `npm run build` in `apps/web` gruen; gebaute Seite unter `/support` vorhanden und im Footer
  verlinkt; kein neuer externer Host im HTML (CSP unveraendert);
  `grep -rn "get_transcript\|get_my_number\|get_calendar" apps/web/src` liefert 0 Zeilen.
- Pre-Mortem: Die Seite verspricht Reaktionszeiten oder Loeschwege, die es nicht gibt, und wird so
  zum Review-Befund. Gegenmassnahme: jede Prozessaussage verweist auf einen existierenden Weg (Code
  oder Rechtstext); keine Fristen.
- Owner-Vorbereitung: OW-K. Deploy-Vorbedingung: Labor-Abnahme laut Runbook.

### T2-20 - Reviewer-Zugang: Anleitung, Seed-Skript, Login-Pfad
- Risiko: dokument. IDs: O-9. dokumentFuerOpenAI: ja (Reviewer-Anleitung EN).
- Ziel: (1) `docs/OPENAI-REVIEWER-ACCESS.md`: Konto ohne MFA/SMS/E-Mail-Bestaetigung/Neuanmeldung,
  was beim ersten Login passiert (belegt am Code: vorhandener Mandant -> direkt verbunden; ohne
  Mandant -> T2-05-Text), sichere Testziel-Nummer, Ablaufkontrolle; (2) `scripts/seed-reviewer-demo.mjs`:
  legt fuer eine ausdruecklich genannte Mandanten-ID Beispiel-Anrufe und Action Items an, idempotent,
  setzt NIE Abo-, KYC- oder Verifikationsfelder; (3) Pruefung am Code, dass der erste OAuth-Login
  eines vorhandenen Mandanten keinen Onboarding-Schritt ausloest.
- Abnahme: Seed-Test auf Temp-`DATA_DIR`: danach liefern `list_calls`/`list_action_items` am Draht die
  Beispieldaten; Store-Diff enthaelt KEIN Abo-/KYC-/Verifikationsfeld; zweiter Lauf aendert nichts;
  ohne Mandanten-ID Abbruch. Jede Aussage im Dokument mit Code-Stelle.
- Pre-Mortem: Das Seed-Skript wird spaeter "praktisch" erweitert und schaltet einen Mandanten ohne
  Zahlung frei - Outbound-Gate umgangen. Gegenmassnahme: Test verbietet diese Felder ausdruecklich;
  Skript schreibt nur ueber die Store-Funktionen fuer Anrufe/Action Items.
- Owner-Vorbereitung: OW-L. Deploy-Vorbedingung: keine.

### T2-21 - Review-Testfaelle (5 positiv, 3 negativ)
- Risiko: dokument. IDs: O-10. dokumentFuerOpenAI: ja. Nach T2-11..T2-20.
- Ziel: `docs/OPENAI-REVIEW-TESTCASES.md` (EN; DE-Fassung nicht glatter): je Fall Prompt, erwartetes
  Verhalten, erwartete Ergebnisform (Feldnamen aus dem Draht), Reproduktionsdaten (Seed aus T2-20,
  Testziel aus OW-L); Negativfaelle z.B. Denylist-Ziel, Kreditkarte im Auftrag (T2-15),
  Telemarketing-Auftrag. Kein `get_calendar`; aktuelle Namen (T2-11/T2-12). Jeder Anruf-Fall beschreibt den
  Bestaetigungsschritt: `prepare_call` -> Reviewer klickt "Anruf bestaetigen" in der Karte (T2-14) ->
  `place_call`; ein Negativfall: ohne Klick wird nicht gewaehlt.
- Abnahme: fuer jeden Fall ein Test, der den erwarteten Tool-Aufruf ueber `/mcp` mit
  Fake-Originate faehrt und die dokumentierte Ergebnisform prueft; OpenAI-Regel woertlich zitiert
  ("Submit at least five positive test cases and three negative test cases."); keine internen Kennungen.
- Pre-Mortem: Ein Testfall beschreibt Verhalten aus Plausibilitaet, der Reviewer sieht etwas
  anderes, Ablehnung. Gegenmassnahme: jeder Fall ist ein gruener Test am Draht.
- Owner-Vorbereitung: in OW-M eintragen. Deploy-Vorbedingung: keine.

### T2-22 - Listing-Entwurf
- Risiko: dokument. IDs: O-11. dokumentFuerOpenAI: ja. Nach T2-21.
- Ziel: `docs/OPENAI-LISTING.md`: Kurz-/Langbeschreibung (am echten Tool-Verhalten geprueft),
  Starter-Prompts (jeder deckt einen T2-21-Fall), Lokalisierung, Laender-Vorschlag abgeleitet aus
  dem Land-Gate (Code-Stelle, keine Produktionswerte), Release Notes aus der Git-Historie, Logo
  (`public/brand/hermes-icon.png`, Format gegen die Submission-Seite geprueft), Checkliste der
  Policy-Attestationen mit Verweis auf T2-10. Name/Kategorie/Laender final = Owner.
- Abnahme: jede Behauptung mit Beleg (Tool-Beschreibung am Draht oder Code-Stelle); jeder
  Starter-Prompt verweist auf einen gruenen T2-21-Test; keine Werbe-/Vergleichssprache (O-21/O-27-Scan
  auch ueber dieses Dokument).
- Pre-Mortem: Die Langbeschreibung verspricht Faehigkeiten, die das Plugin nicht hat, oder nennt
  Wettbewerber - Ablehnung wegen O-27. Gegenmassnahme: derselbe Draht-Scan wie T2-16 laeuft ueber
  das Dokument.
- Owner-Vorbereitung: OW-M. Deploy-Vorbedingung: keine.

---

## 4. Owner-Liste (nur Punkte nach der Owner-Regel)

- **OW-A Deploy/Push** der gemergten Kette. Vorher die Deploy-Vorbedingungen abhaken: T2-03 (OW-B
  `exp`), T2-23 (OW-B Login mit Scope-Menge S + Refresh-Token; fuer Commit B zusaetzlich `scope`/`scp`
  im Token, sonst B zuruecknehmen), T2-04 (OW-G `PUBLIC_URL`), T2-11/T2-12 (beide gemergt - nie nur T2-11, sonst ruft die
  Anruf-Karte einen Namen, den der Server nicht mehr kennt), T2-13/T2-14 (beide gemergt - nie nur T2-13; OW-G
  `MCP_UI_ENABLED` nicht `false`; neue Env-Var, falls T2-13 eine eingefuehrt hat), T2-16 (OW-H
  Messung). Danach den eigenen Claude-Connector neu verbinden (neue Toolnamen aus T2-11). Erwartet:
  Connector zeigt genau `answer_consult`, `await_call_event`, `cancel_call`, `check_inbox`,
  `get_agent_number`, `get_agent_status`, `get_call_result`, `get_call_status`, `list_action_items`,
  `list_calls`, `place_call`, `prepare_call` (mit Consult; ohne Consult ohne die ersten beiden); kein
  `get_transcript`, `get_my_number`, `get_calendar`. Bewusste Folge: aus Hosts ohne Karte (Claude
  Code, stdio) laesst sich per MCP nicht mehr waehlen (T2-13, Abschnitt 5).
- **OW-B Echtes Access-Token dekodieren** (T-9, T-16, Vorbedingung T2-03 und T2-23). Muss mit dem
  GEBAUTEN Stand laufen (nach Merge von T2-23, vor dem Deploy), denn erst dieser Stand nennt dem
  Client die Scope-Menge S = `openid email offline_access`; ein Inspector gegen die heutige
  Live-Instanz fragt nach der MCP-Scope-Wahl gar keinen Scope an und kann `email_verified` nicht
  belegen. Schritte: (1) Gemergten master lokal starten, im OAuth-Modus gegen den echten AS, mit
  der Live-Audience: `PORT=3999 MCP_AUTH=oauth OAUTH_ISSUER_URL=<issuer> OAUTH_AUDIENCE=https://<origin>/mcp
  PUBLIC_URL=http://localhost:3999 npm start` (Werte aus dem eigenen `.env`/Dashboard, nichts
  davon in eine Datei schreiben). (2) `curl -si -X POST http://localhost:3999/mcp` - erwartet: 401,
  `www-authenticate` enthaelt `scope="openid email offline_access"`. (3) `npx
  @modelcontextprotocol/inspector`, Streamable HTTP, URL `http://localhost:3999/mcp`, OAuth-Login
  durchlaufen - erwartet: die Autorisierungs-URL im Browser traegt `scope=openid+email+offline_access`
  (bzw. `%20`-getrennt), der AS zeigt keinen `invalid_scope`-Fehler, der Login gelingt, die
  Auth-Ansicht zeigt ein Refresh-Token. (4) Das Access-Token nur lokal dekodieren (mittlerer
  JWT-Teil, base64url), nirgends einfuegen. Erwartet: `aud` = `https://<origin>/mcp`, `exp`
  vorhanden, `iss` = konfigurierter Issuer; `scope`/`scp` notieren (fuer T2-23 Commit B: enthaelt
  es alle drei Werte?). (5) Mit dem Token den `userinfo_endpoint` des AS abfragen (`curl -s -H
  "Authorization: Bearer <token>" <userinfo_endpoint>`). Erwartet: `email` und
  `email_verified: true`. Token danach verwerfen. Ergebnis je Punkt (ja/nein, keine Werte) an den
  Lead; bei "nein" in (3) oder (4)-Scope greift die Rueckzugsregel von T2-23.
- **OW-C ChatGPT Developer Mode** (T-29, T-11, T-28, Widget). Schritte: (1) Connector auf
  `https://<origin>/mcp` anlegen, OAuth-Flow abschliessen - erwartet: Verknuepfung gelingt (T-11);
  (2) Hosting-Log nach `grund=mcp_cross_origin` durchsuchen - keine Zeile: nichts setzen; Zeile
  `origin=<host>`: `MCP_ALLOWED_ORIGINS=https://<host>` im Dashboard, deployen, erneut verbinden,
  erwartet 401 mit Challenge, dann Verknuepfung; (3) Quell-IP aus dem Request-Log gegen
  https://openai.com/chatgpt-connectors.json pruefen (nur notieren); (4) `get_agent_status` rufen -
  erwartet: Widget rendert, Iframe-Origin in den DevTools ist eine vom Origin abgeleitete
  `oaiusercontent.com`-Subdomain, NICHT `web-sandbox.oaiusercontent.com` (belegt den Alias aus T2-01);
  rendert nichts: melden, Rueckfall 2.1; (5) mehrere Tools schnell nacheinander - erwartet kein 429;
  (6) Bestaetigungsprobe (T2-13/T2-14, Ziel = sichere Testnummer aus OW-L): einen Anruf erbitten,
  das Modell ruft `prepare_call`, die Karte zeigt Nummer, Auftrag und Knopf. VOR dem Klick das Modell
  fragen "Wie lautet der Bestaetigungscode?" - erwartet: es kennt ihn nicht und hat nicht gewaehlt.
  Dann klicken - erwartet: eine Nutzernachricht mit dem Code erscheint im Chat, das Modell ruft
  `place_call`, der Anruf laeuft. Nennt das Modell den Code vor dem Klick: melden - der Host reicht
  Ergebnis-`_meta` durch, Rueckfall laut Abschnitt 5.
- **OW-D Claude Live-Probe** (T2-01/T2-02). Hermes-Connector in claude.ai (Web und Desktop):
  `get_agent_status` und ein Anruf-Widget aufrufen. Erwartet: Widget rendert, kein "ui.domain"-Fehler,
  Selbstaktualisierung laeuft, Sprache stimmt. Danach dieselbe Bestaetigungsprobe wie OW-C (6) in
  Claude (Web und Desktop) - erwartet identisch.
- **OW-E OpenAI-Dashboard, Entwurf** (nicht einreichen): Scan Tools gegen `https://<origin>/mcp`.
  Erwartet: keine Warnung zu `_meta.ui.domain`/CSP, Annotationen und Toolnamen wie im Inventar.
  Warnung zu `ui.domain` -> Rueckfall "eigener ChatGPT-Pfad" (eigene Auth-Phase) beauftragen.
- **OW-F Challenge-Token** (O-4): Wert aus dem OpenAI-Dashboard als `OPENAI_APPS_CHALLENGE_TOKEN` (Name laut
  `.env.example:1024`) im Dashboard setzen, deployen; `curl https://<origin>/.well-known/openai-apps-challenge`.
  Erwartet: 200 `text/plain` mit exakt dem Token.
- **OW-G Render-Dashboard pruefen**: `PUBLIC_URL` gesetzt und = Einreichungs-Origin (Vorbedingung
  T2-04); `MCP_AUTH=oauth`; `MCP_UI_ENABLED` an (Vorbedingung T2-13/T2-14: steht er auf `false`,
  kann nach dem Deploy niemand mehr per MCP waehlen); `CONSULT_ENABLED` wie gewollt; `RETENTION_DAYS`
  passend zur Datenschutzerklaerung (O-6). Werte nirgends ins Repo schreiben.
- **OW-H Messung place_call-Texte** (O-27, Vorbedingung T2-16): Guthaben bei einem LLM-Anbieter
  aufladen, dann `scripts/briefing-bench` laut dessen README gegen `288376b` und gegen den Endstand,
  n>=5 je Szenario. Erwartet: Selbstnennung 0, Luecken-Klasse neu >= alt, erfundene Fakten 0.
  Optional danach `npm run convo-bench` (n>=5) als Telefon-Regressionsnetz.
- **OW-I Sprach-Anbieter**: `retention_days` passend zur Datenschutzerklaerung setzen (O-6).
- **OW-J Rechtstexte** (O-6, O-15, O-24, O-7-Rest): Datenschutzerklaerung mit OpenAI/ChatGPT als
  Empfaenger, Art.-9-Hinweis, EN-Fassung, offene Marken; Impressum-Publisher; Altersfrage 13-17 vs.
  AGB. Grundlage: Faktenblatt aus T2-10.
- **OW-K Website**: T2-19-Branch in `staging`, Labor pruefen (`docs/RUNBOOK-LAB-LIVE.md`), dann master
  und Deploy der Website. Erwartet: `https://<website>/support` oeffentlich 200.
- **OW-L Reviewer-Konto** (O-9): AS-Nutzer ohne MFA anlegen, Mandant mit Abo+KYC (echte Zahlung,
  echte Verifikation - kein Bypass), sichere Testziel-Nummer festlegen (Vorschlag: eine eigene DID mit
  Inbound-Agent), `scripts/seed-reviewer-demo.mjs` fuer diesen Mandanten ausfuehren. Erwartet: Login
  ohne Zusatzschritt, `list_calls` zeigt die Beispieldaten.
- **OW-M Einreichung**: Testfaelle (T2-21), Listing (T2-22), Name/Kategorie/Laender,
  Attestationen, Screenshots (O-12) im Portal eintragen.

---

## 5. Was NICHT gebaut wird - und warum

- **mTLS (T-17)**: OpenAI nennt es fuer private Server; Hermes ist oeffentlich; das Hosting kann keine
  Client-Zertifikate pruefen.
- **Eigene Hermes-Ressourcen-Scopes (z.B. je Werkzeug `calls:write`) und `profile` (T2-23)**: der AS
  bewirbt nur Identitaets-Scopes (`docs/OPENAI-AUTH-ABWEICHUNGEN.md` Abschnitt 3); ein erfundener
  Scope in PRM/Challenge wuerde beim AS mit `invalid_scope` enden und jede neue Verknuepfung
  toeten. `profile` braucht Hermes nicht (Minimalmenge). Die Zugriffsgrenze bleibt Audience +
  Mandantenbindung.
- **Scope-Menge als Env-Var (T2-23)**: die Menge ist eine Produktentscheidung, keine
  Umgebungseigenschaft; eine Env-Var waere ein zweiter, ungetesteter Wahrheitsort (Dashboard) und
  fuenf Dateien mehr. Rueckweg ist der Revert von Commit B bzw. A.
- **UserInfo-Endpunkt, `email_verified`, OIDC-Discovery (T-16, AS-Seite)**: gehoeren dem
  Autorisierungsserver; Hermes ist reiner Resource-Server und stellt keinen eigenen AS. Pruefung am
  echten Token = OW-B.
- **Profil-Tool (X-9)**: optional; ein Mandant je Login; mehr Review-Flaeche ohne Nutzen.
- **IP-Allowlist aus `chatgpt-connectors.json` (T-3)**: identifiziert laut OpenAI keinen Nutzer,
  ersetzt keine Auth, laufender Pflegeaufwand.
- **search/fetch, Skills, Elicitation (T-24, T-25, X-8, N-16)**: kein Deep Research, keine Skills;
  Elicitation scheitert am zustandslosen Transport, deshalb auch nicht fuer N-10.
- **Bestaetigungscode im Tool-Text (`content`/`structuredContent`) oder eine reine "frag den
  Nutzer"-Anweisung fuer N-10**: das Modell saehe den Code und koennte `prepare_call` -> `place_call`
  ohne sichtbaren Schritt verketten; die Bestaetigung waere nur formal (Kritiker-Blocker Runde 2).
- **Bestaetigungsweg fuer Hosts ohne Karte** (Claude Code, stdio, `MCP_UI_ENABLED=false`), etwa ein
  Link in die Web-App: braeuchte eine neue, zustandsbehaftete Bestaetigungs-Route hinter
  `webAuthMw` samt App-Seite - ein zusaetzlicher Geldpfad-Endpunkt ohne Einreichungs-Anforderung
  (ChatGPT und Claude Web/Desktop zeigen die Karte). Folge, bewusst: aus diesen Hosts wird per MCP
  nicht mehr gewaehlt; es gibt keine echten Nutzer, und `POST /api/calls` bleibt `internalOnly`
  (`src/routes/api-calls.js:394`). Wird der Bedarf real, ist das eine eigene Phase.
- **Waehlen direkt aus der Karte** (`place_call` nur fuer die App sichtbar,
  `_meta.ui.visibility: ["app"]`, die Karte ruft `tools/call place_call`): dann erfuehre das Modell
  den `call_id` nicht und die Consult-Schleife (`await_call_event`) risse. Das ist der dokumentierte
  Rueckfall NUR fuer den Fall, dass OW-C (6) oder OW-D zeigt, dass ein Host Ergebnis-`_meta` an das
  Modell weiterreicht; der `call_id` liefe dann ueber `ui/update-model-context`.
- **Statisches oder gehashtes `_meta.ui.domain`, Host-Erkennung, zustandsbehafteter Transport**:
  siehe 2.1 (bricht Claude bzw. grosser, nicht restart-fester Umbau).
- **CORS `*`, vorsorglich gesetzter Origin, `openai/subject` als Limiter-Schluessel, pauschal hoeheres
  Limit**: siehe 2.2/2.4.
- **Boot-Sperre bei `MCP_AUTH` != `oauth`**: Autonome Entscheidung P6 - nur WARN (T2-03).
- **Website-Sicherheitsheader** (Referrer-Policy, security.txt, HSTS-preload): Autonome Entscheidung
  P10b, Owner-Punkt aus Runde 1.
- **Aenderung der Telefon-Agent-Prompts fuer O-19**: die Zweckbindung sitzt an der Stelle, die das
  Plugin steuert (Beschreibung, instructions); die Live-Prompts sind kalibriert und liegen teils beim
  Sprach-Anbieter.
- **Entfernen des `context`-Feldes (N-14)**: Zweck wird enger formuliert statt entfernt, weil der
  Kontext-Bruecken-Pfad getestet und anrufwirksam ist; die Notwendigkeit je Feld steht im Inventar.
- **Demo-Kalender im Store**: nur die MCP-Oberflaeche aendert sich (T2-12); der Store ist nicht Teil
  der Plugin-Flaeche.
- **Minutenabrechnung von `place_call`** (O-20-Randfrage): Geschaeftsmodell, keine Code-Luecke.
- **convo-bench als Messung fuer O-27**: liest die Beschreibungen nicht (2.3).
- **Rechtstext-Inhalte, Produktionswerte, Challenge-Wert, Anbieter-Einstellungen**: Owner.

---

## Anhang A - Ausgangsmessung (81 technische IDs, master `288376b`)

Status: E = ERFUELLT, T = TEILWEISE, O = OFFEN, G = GEGENSTANDSLOS. Belege ausfuehrlich in 1a/1b.

| ID | Status | Beleg | Luecke |
|---|---|---|---|
| W-6 | E | kein Tunnel, https-Pflicht `boot-guard.js:980` | - |
| T-1 | E | `routes/mcp.js:113-175`, Draht | - |
| T-2 | E | `boot-guard.js:955-985` | - |
| T-3 | G | oeffentlicher Dienst, Auth nicht an IP | - |
| T-5 | T | PRM/401/JWT gebaut, oauth-Tests gruen | `exp`, kein WARN bei Nicht-OAuth; E2E = Owner |
| T-6 | E | `auth.js:142-150` | - |
| T-7 | E | Messung `OPENAI-AUTH-ABWEICHUNGEN.md:566-570` | - |
| T-8 | E | S256 im RFC-8414-Dokument | Nebenbefund: `probe-as-faehigkeiten.mjs` liest nur OIDC (Hygiene) |
| T-9 | T | `aud`=`audience()`, Test falsches aud | echtes Token (Owner) |
| T-10 | E | CIMD/DCR/`none` gemessen | - |
| T-11 | T | kein falsches `iss`-Versprechen | Live-Flow (Owner) |
| T-12 | T | Signatur/iss/aud/nbf geprueft | `exp` nicht Pflicht; `scope`/`scp` ungeprueft (0 Stellen) |
| T-13 | E | 401 + resource_metadata | - |
| T-14 | O | grep 0 | kein `_meta` challenge; B-1 = 403 |
| T-15 | E | HTTP oauth2, stdio bewusst ohne | - |
| T-16 | T | AS-Discovery/AS-scopes gemessen | RS nennt keine Scopes: PRM ohne `scopes_supported`, 401 ohne `scope=`, `securitySchemes` `scopes: []` (Kritiker-Runde 4); `email_verified` (Owner, OW-B) |
| T-17 | O | grep 0 mtls | optional, nur privat -> G |
| T-18 | E | Draht HTTP+stdio | - |
| T-19 | E | SDK-Pruefung | - |
| T-20 | E | `mcp-tools.js:88` | - |
| T-21 | T | 403 Zeichen ohne Consult | Consult: Kern hinter 512 |
| T-22 | E | <= 32 Zeichen | - |
| T-23 | T | resourceUri an 5 Tools | Skybridge-Pfad nur outputTemplate |
| T-24 | G | kein search/fetch | - |
| T-25 | G | folgt T-24 | - |
| T-27 | T | place_call-Frist, Gates, Limiter | Limiter je IP, Hops ohne Frist, Stundenlimit-Rennen |
| T-28 | T | Hints nie gelesen | Limit nicht je Nutzer |
| T-29 | T | zustandslos, GET/DELETE 405 | kein CORS; chatgpt.com -> 403 |
| T-30 | T | csp am Tool, leer korrekt | fehlt am Resource-Inhalt |
| T-31 | T | domain am Tool | fehlt am Inhalt; Format host-abhaengig |
| T-32 | T | ein Origin, Boot-Riegel | stiller Rueckfall `config.js:1499` |
| T-33 | T | Hash-Pins erkennen Aenderungen | kein Kompatibilitaetsschutz, kein Runbook |
| T-34 | O | URIs statisch | Cache/Sprache |
| T-36 | E | eine Route, Mandant aus Token | - |
| N-1 | E | Draht 12/12, 10/10 | - |
| N-2 | E | nur GET-Tools lesend | - |
| N-3 | E | drei destruktive Tools | - |
| N-4 | E | drei Open-World-Tools | - |
| N-5 | E | Inventar gepinnt | - |
| N-6 | E | Tests 26/26 | - |
| N-7 | E | kein Tool ohne Hint | - |
| N-8 | E | Write-Tools false | - |
| N-9 | E | aussendende Tools Write | - |
| N-10 | T | Auth/zod/Gates | keine serverseitige Bestaetigung, kein fuer den Menschen sichtbarer Schritt (T2-13 + T2-14) |
| N-11 | T | Dedup, ehrliche Texte | answer_consult-Weitergabe verschwiegen |
| N-12 | T | eindeutige Verbnamen | get_transcript/get_my_number irrefuehrend, auch Titel/Statuszeilen (`src/mcp-tools.js:682,750`) |
| N-13 | T | kein Fremdbezug | Demo-Kalender, Titel/Beschreibung |
| N-14 | T | kein Verlaufsfeld | breites briefing, context-Trichter |
| N-15 | E | kein sampling/elicit | - |
| N-16 | G | keine Elicitation | - |
| O-4 | T | Route + 9 Tests | Wert (Owner) |
| O-5 | E | Host-Wurzel | - |
| O-6 | T | Retention-Sweep | Rechtstext, Anbieter-Retention (Owner) |
| O-7 | T | Website/Rechtstext-Seiten | keine Support-URL; Impressum/EN (Owner) |
| O-9 | O | kein Runbook/Seed | baubar + Anlegen (Owner) |
| O-10 | T | Vorarbeit DE | kein EN-Dokument, get_calendar |
| O-11 | O | Logo vorhanden | kein Entwurf |
| O-13 | T | Whitelists P5a | interne ID, rohe Fehlertexte |
| O-14 | T | Ausschluss in 2 Feldern, bankData-Regel | Rest-Felder, keine Pruefung, Output ungefiltert |
| O-15 | T | keine Art.-9-Felder | keine Minimierungsanweisung; Rechtstext (Owner) |
| O-16 | E | CSP leer, Log gehasht | - |
| O-17 | E | kein Standortfeld | - |
| O-18 | T | Mechanismen vorhanden | kein belegter Abgleich |
| O-19 | T | Mengen-/Zugangsbremsen | keine Zweckbindung |
| O-20 | T | Draht ohne Upgrade | 402-Text "Tarif anpassen" |
| O-21 | E | keine Werbung | - |
| O-22 | E | eigene Gateway | - |
| O-23 | E | offizielle APIs | - |
| O-25 | T | kein Fake-Originate, echte REST | Demo-Kalender, Widget-Meta; Live (Owner) |
| O-26 | E | 0 iframes | - |
| O-27 | T | instructions bereinigt | place_call :955/:1024 |
| X-1 | E | Hints inkl. Consult | - |
| X-2 | E | kein Ergebnis-_meta | nach T2-13/T2-14 nachmessen (`prepare_call` traegt Karten-`_meta`) |
| X-3 | E | toolInvocation, resourceUri | nach T2-01 nachmessen |
| X-4 | E | byteidentisch | - |
| X-5 | E | ui/initialize 2026-01-26 | - |
| X-6 | E | Sandbox-Scan | - |
| X-7 | E | kein openExternal | nach T2-01/T2-02 nachmessen |
| X-8 | G | keine Skills | - |
| X-9 | O | kein Profil-Tool | optional -> G |
| X-10 | E | prompts -32601 | - |

Zaehlung Anhang A: 39 E, 31 T, 6 O, 5 G = 81. Nach Einordnung (Abschnitt 1): 39 ERFUELLT,
7 GEGENSTANDSLOS (T-3, T-17, T-24, T-25, N-16, X-8, X-9), 4 OWNER (T-9, T-11, O-4, O-6),
31 in Phasen (T-16 seit Kritiker-Runde 4 in T2-23).
