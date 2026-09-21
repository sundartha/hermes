# OpenAI-Einreichung: technische Schlussabnahme

Gepruefter Stand: master 21ff856. Massgeblich: `tasks/openai-audit/00-openai-anforderungen.md` (100 IDs).
Datum: 2026-09-21. Quelle der Einzelurteile: vier Teilpruefungen, dazu eigene Stichprobe (s. unten).

## DIE ZAHL

**41 von 84 technischen IDs erfuellt.**

| Status | Anzahl |
|---|---|
| ERFUELLT | 41 |
| TEILWEISE | 22 |
| NICHT ERFUELLT | 3 |
| GEGENSTANDSLOS | 13 |
| GEGATET | 4 |
| NICHT IN UNSERER HAND | 1 |
| **Summe technisch** | **84** |
| Ausgeschlossen OWNER | 16 |
| Ausgeschlossen RECHTSTEXT (ganz) | 0 (Rechtstext-Anteile in O-6, O-15, O-16 herausgerechnet, ID bleibt technisch) |
| **Summe** | **100** |

Ohne GEGENSTANDSLOS: 41 von 71 anwendbaren technischen IDs erfuellt.

### Vollstaendigkeit
- Die Liste hat genau 100 eindeutige IDs: W-1..7 (7), T-1..36 (36), N-1..16 (16), O-1..31 (31), X-1..10 (10). Per grep an der Datei geprueft.
- Die Bereiche der vier Pruefer zusammen: 17 + 19 + 26 + 38 = 100. Keine ID fehlt, keine ist doppelt.

### Geltungsbereich: 84 statt geplanter 72
Die Planungsdatei darf ich nicht lesen, deshalb kann ich die Zusammensetzung der 72 nicht belegen (UNKNOWN). Eine rechnerisch passende Erklaerung fuer die Differenz von 12:
- 6 IDs stellen keine Anforderung an den Server und sind hier technisch, aber GEGENSTANDSLOS: W-1, W-4, W-5, T-4, T-26, O-31.
- 6 gemischte IDs zaehlen nach der Auftragsregel ("nur den technischen Teil bewerten") als technisch: N-5, O-6, O-7, O-15, O-16, O-23.
Es gilt die Liste. Die Planungszahl ist kein Soll.

### Querschnitt: LIVE ist nicht master
`GET https://app.sundartha.com/healthz` liefert commit 728f053 (selbst gemessen, 2026-09-21). Alle ERFUELLT-Urteile, die sich auf master stuetzen (u.a. T-15, T-21, O-13-Teile, O-27-Teil), sind live erst nach einem Deploy wirksam. Ohne Deploy des geprueften Stands ist nichts davon einreichungsfaehig.

## Tabelle aller 100 IDs

| ID | kurz | Status | Beleg (kurz) | offen |
|---|---|---|---|---|
| W-1 | Developer Mode = privater Weg | GEGENSTANDSLOS | beschreibt ChatGPT-Produktmerkmal, keine Serverpflicht | - |
| W-2 | privat -> Developer Mode | AUSGESCHLOSSEN (OWNER) | Vertriebsentscheidung | Owner |
| W-3 | Portal -> Review -> Publish | AUSGESCHLOSSEN (OWNER) | Einreichungsvorgang | Owner |
| W-4 | Responses-API-MCP = API-Weg | GEGENSTANDSLOS | kein OpenAI-SDK, 0 Treffer responses.create/tunnel_id | - |
| W-5 | Agents-API-MCP = API-Weg | GEGENSTANDSLOS | wie W-4 | - |
| W-6 | kein Tunnel, oeffentliches HTTPS | ERFUELLT | Live POST /mcp -> 401 mit Bearer-Challenge, PRM 200 (nachgemessen) | - |
| W-7 | keine publizierte Integration referenzieren | AUSGESCHLOSSEN (OWNER) | Kontotatsache | Owner |
| T-1 | streamable HTTP auf /mcp | ERFUELLT | src/routes/mcp.js stateless Transport; lokal initialize 200; live 401/405 | - |
| T-2 | oeffentliche Domain | ERFUELLT | live https://app.sundartha.com/mcp 401 (nachgemessen) | Deploy-Stand 728f053 |
| T-3 | privater Server via Proxy | GEGENSTANDSLOS | Hermes ist oeffentlich; Auth trotzdem Pflicht (401) | - |
| T-4 | Dev Mode akzeptiert SSE | GEGENSTANDSLOS | Client-Faehigkeit; GET /mcp 405 | - |
| T-5 | OAuth 2.1 nach MCP-Spec | TEILWEISE | RS-Seite: test/oauth.test.js gruen | End-to-End unbelegt; Luecken T-9, T-12, T-14 |
| T-6 | PRM mit resource + authorization_servers | ERFUELLT | src/auth.js registerWellKnown (nachgesehen); live PRM nachgemessen | - |
| T-7 | AS-Metadata | ERFUELLT | WorkOS oauth-authorization-server 200 mit Pflichtfeldern | openid-configuration ohne S256 |
| T-8 | PKCE S256 beworben | ERFUELLT | live: code_challenge_methods_supported ["S256"] (nachgemessen) | - |
| T-9 | resource -> aud | TEILWEISE | RS prueft audience (src/auth.js jwtVerify) | AS-Seite braucht echten Login: UNKNOWN |
| T-10 | CIMD/none/DCR | ERFUELLT | live: CIMD true, registration_endpoint, auth none (nachgemessen) | - |
| T-11 | RFC-9207-iss fuer stabile Redirect-URI | NICHT IN UNSERER HAND | WorkOS bewirbt authorization_response_iss_parameter_supported nicht (nachgemessen) | Callback-URI-Weg unbelegt |
| T-12 | Token-Pruefung vollstaendig | TEILWEISE | jwtVerify issuer/audience (nachgesehen); p7-Tests gruen | kein requiredClaims exp (Token ohne exp -> 200); Scopes ungeprueft |
| T-13 | 401 + WWW-Authenticate auf PRM | ERFUELLT | deny401 src/auth.js (nachgesehen); p6-Test gruen | - |
| T-14 | _meta mcp/www_authenticate | NICHT ERFUELLT | grep www_authenticate src = 0 (nachgemessen) | bauen |
| T-15 | securitySchemes pro Tool | ERFUELLT | src/mcp-security-schemes.js (nachgesehen), p3-Test gruen | live noch nicht deployed |
| T-16 | Workspace-Domain: OIDC/email_verified | TEILWEISE | OIDC-Discovery live, userinfo_endpoint vorhanden | email_verified nur mit Login messbar; nur falls Domain-Restriktion gewollt |
| T-17 | optional mTLS | NICHT ERFUELLT | 0 Treffer mtls; Kategorie C | optional, kein Blocker |
| T-18 | Tool-Definition vollstaendig | ERFUELLT | 12 Tools gemessen; cancel_call/list_action_items ohne structuredContent (nachgesehen) | - |
| T-19 | structuredContent passt zu outputSchema | ERFUELLT | p4-Test gruen | - |
| T-20 | isError | ERFUELLT | errText src/mcp-tools.js:88 (nachgesehen) | - |
| T-21 | instructions, 512 Zeichen | ERFUELLT | Basis 403 Zeichen, Geld-Satz zuerst (selbst ausgegeben) | Consult-Schleife teils > 512 |
| T-22 | toolInvocation <= 64 | ERFUELLT | max 32 Zeichen gemessen; p2-Test | - |
| T-23 | ui.resourceUri statt outputTemplate | TEILWEISE | mcp-nativ korrekt | ChatGPT-Adapter nur Alias (nur mit UI) |
| T-24 | search/fetch nur Deep Research | GEGENSTANDSLOS | keine search/fetch-Tools, kein DR-Ziel | - |
| T-25 | Zitationen nur mit url | GEGENSTANDSLOS | haengt an T-24 | - |
| T-26 | Dev Mode ohne search/fetch | GEGENSTANDSLOS | entlastende Feststellung | - |
| T-27 | Timeouts/Rate-Limits | TEILWEISE | place_call Hop-Timeout, Stundenlimit pro Tenant (outbound-gates.js:364, nachgesehen) | cancel_call ohne Timeout; Nicht-Anruf-Tools nur per IP (OpenAI-Egress geteilt) |
| T-28 | openai/subject; Hints nicht fuer Auth | ERFUELLT | 0 Treffer openai/* in src; Auth nur ueber Token | subject ungenutzt (Angebot) |
| T-29 | stateless + CORS | TEILWEISE | stateless gemessen | kein CORS; Kategorie C |
| T-30 | UI-CSP am Resource-Inhalt | GEGATET | resources/read ohne _meta; src/ui/contract.js:80-107 sagt es selbst (nachgesehen); Primaerquelle Zeile 7687 | Owner-Probe O-P8-2/O-P8-3 oder UI aus (nur mit UI) |
| T-31 | ui.domain am Resource-Inhalt | GEGATET | wie T-30; Primaerquelle Zeile 7688 "required when submitting a plugin with UI" | wie T-30 (nur mit UI) |
| T-32 | Origin endgueltig | ERFUELLT | live PRM resource https://app.sundartha.com/mcp (nachgemessen) | config.js:1499 faellt still auf RENDER_EXTERNAL_URL zurueck |
| T-33 | Continuous Review kompatibel | TEILWEISE | P8-I/J und p10a erkennen Aenderungen | kein Schutz gegen brechende Schema-Aenderung; greift ab 1. Update |
| T-34 | UI-Cache 1 h, versionierte URIs | TEILWEISE | stabile ui://hermes/* URIs | keine Versionierungskonvention (nur mit UI) |
| T-35 | keine EU-Datenresidenz | AUSGESCHLOSSEN (OWNER) | Projekteinstellung bei OpenAI | Owner |
| T-36 | universelle URL | ERFUELLT | eine /mcp-Route, Mandant aus Token; PRM live | - |
| N-1 | drei Hints an jedem Tool | ERFUELLT | TOOL_ANNOTATIONS src/mcp-tools.js:650-731 (nachgesehen); Tests gruen | - |
| N-2 | readOnly nur ohne Aenderung | ERFUELLT | 7 readOnly-Tools nur GET /api/state bzw. /api/calls/:id, dort keine Schreibaufrufe (nachgesehen) | - |
| N-3 | destructive bei Irreversiblem | ERFUELLT | place_call/answer_consult/cancel_call true (nachgesehen) | - |
| N-4 | openWorld bei externen Empfaengern | ERFUELLT | genau place_call/answer_consult/cancel_call true (nachgesehen) | - |
| N-5 | Begruendung je Annotation (techn. Teil) | ERFUELLT | docs/OPENAI-TOOL-INVENTORY.md + p10a-Test gruen | Eintragen = Owner |
| N-6 | Annotationen = haeufiger Ablehnungsgrund | ERFUELLT | wie N-1..N-4 | - |
| N-7 | ohne readOnly = Write | ERFUELLT | kein Tool ohne readOnlyHint | - |
| N-8 | Write braucht Bestaetigung | ERFUELLT | Writes als readOnly false erkennbar | Wirkung auf Consult-Frist ungemessen |
| N-9 | Aussendende Aktionen = Write | ERFUELLT | place_call/answer_consult/cancel_call readOnly false | - |
| N-10 | Server bestaetigt selbst | TEILWEISE | Auth + Validierung vorhanden | keine serverseitige Bestaetigung fuer place_call |
| N-11 | Seiteneffekte offen, retry-sicher | ERFUELLT | Beschreibungen + Dedup-Hinweis | - |
| N-12 | Namen nicht irrefuehrend | TEILWEISE | 12 Verb-Namen | get_transcript liefert kein Transkript |
| N-13 | Beschreibungen exakt | TEILWEISE | kein Fremd-Bevorzugen | get_calendar liefert Demo-/leeren Kalender |
| N-14 | minimale Inputs | TEILWEISE | keine Historie/Standortfelder | briefing + context doppelter Kontext-Trichter |
| N-15 | kein Chatverlauf ziehen | ERFUELLT | 0 Client-Requests (sampling/elicit) | - |
| N-16 | Elicitation-Regeln | GEGENSTANDSLOS | keine Elicitation | - |
| O-1 | Identitaetsverifikation | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-2 | gleiche Organisation | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-3 | api.apps-Rechte | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-4 | Challenge-Token als Klartext | GEGATET | src/app.js:219-223 (nachgesehen); e7-Test gruen; live 404 leer | Owner setzt OPENAI_APPS_CHALLENGE_TOKEN |
| O-5 | Challenge am Host | ERFUELLT | fester Pfad an der Wurzel; live Handler aktiv | Challenge Base = app.sundartha.com |
| O-6 | Privacy eingehalten (techn. Teil) | TEILWEISE | RETENTION_DAYS + pruneOldData | retention_days beim Anbieter -1; Loeschweg nur CLI |
| O-7 | URLs oeffentlich (techn. Teil) | TEILWEISE | Datenschutz/AGB/Impressum 200 | keine Support-URL; Rechtsseiten nur deutsch |
| O-8 | Support-Kontakt | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-9 | Reviewer-Demo-Account | AUSGESCHLOSSEN (OWNER) | muss bezahlt + KYC sein | Owner |
| O-10 | 5+3 Testfaelle | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-11 | Listing-Angaben | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-12 | Screenshots nur bei UI | AUSGESCHLOSSEN (OWNER) | Vorfrage UI an/aus | Owner |
| O-13 | Datenminimierung / keine internen IDs | TEILWEISE | Whitelists vorhanden | list_action_items gibt [ai_...]-ID aus (mcp-tools.js:1441, nachgesehen); OUTBOUND_FROZEN-Name im Text (outbound-gates.js:667, nachgesehen); HTTP-Status/Transportfehler durchgereicht |
| O-14 | keine Restricted Data | TEILWEISE | briefing/key_facts verbieten Secrets/Zahlungsdaten | andere Freitexte, Consult-Kanal, Ergebnisse ungefiltert |
| O-15 | Art.-9-Daten (techn. Teil) | TEILWEISE | keine Art.-9-Felder | keine Mechanik fuer Art.-9-Inhalte aus Gespraechen |
| O-16 | kein Tracking (techn. Teil) | ERFUELLT | Widgets laden nichts; [mcp]-Log mit gehashter Mail (routes/mcp.js:68-79, nachgesehen) | Offenlegung = Rechtstext |
| O-17 | keine Standortfelder | ERFUELLT | Feldliste ohne Standort | - |
| O-18 | Usage Policies | GEGATET | openai.com/policies 403 aus dieser Umgebung | Owner liest und gleicht ab |
| O-19 | kein Telemarketing | TEILWEISE (herabgestuft) | Stundenlimit/Ziel-Cap/Abo+KYC (outbound-gates.js:364-379, :485-496, nachgesehen) | keine Zweckbindung; Zulaessigkeit von Anruf-Plugins undokumentiert |
| O-20 | kein Abo/Upgrade im Plugin | TEILWEISE | keine Plan-/Checkout-Links | outbound-gates.js:900 "Bitte Tarif anpassen" (nachgesehen); Signup-Flow UNKNOWN |
| O-21 | keine Werbung | ERFUELLT | grep mit Positivkontrolle | - |
| O-22 | kein Pass-through | ERFUELLT | Tools sprechen nur mit eigener REST-API | - |
| O-23 | Drittanbieter autorisiert (techn. Teil) | ERFUELLT | offizielle APIs, Drossel, 429-Backoff | AGB-Konformitaet = Owner |
| O-24 | Zielgruppe 13-17 | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-25 | kein Demo, stabil | TEILWEISE | FAKE_ORIGINATE aus; echte Funktion | master nicht live; Stabilitaet nur per Testanruf |
| O-26 | Iframes nur eigene Domain | ERFUELLT | 0 iframe in Widgets | - |
| O-27 | Fair play | TEILWEISE | instructions bereinigt | briefing (mcp-tools.js:955) nennt weiter "calendar, mail, files, chat" (nachgesehen) |
| O-28 | selbst publizieren | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-29 | Presse | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-30 | eine Version live, eine im Review | AUSGESCHLOSSEN (OWNER) | - | Owner |
| O-31 | Entfernung jederzeit | GEGENSTANDSLOS | Vorbehalt von OpenAI, keine Serverpflicht | - |
| X-1 | drei Hints Required | ERFUELLT | wie N-1 | - |
| X-2 | Ergebnis-_meta nur UI | GEGENSTANDSLOS | kein Handler liefert Ergebnis-_meta | - |
| X-3 | OpenAI-_meta-Namensraeume | ERFUELLT | toolInvocation-Keys, ui.resourceUri | - |
| X-4 | Client-_meta tolerieren | ERFUELLT | Aufruf mit allen openai/*-Feldern ohne Fehler | - |
| X-5 | ui/initialize 2026-01-26 | ERFUELLT | src/ui/widget-bind.js:34; Test | - |
| X-6 | Widget-Sandbox | ERFUELLT | 0 alert/confirm/prompt/clipboard/iframe | - |
| X-7 | redirect_domains Legacy | GEGENSTANDSLOS | keine openExternal-Ziele | - |
| X-8 | Skills-Extension | GEGENSTANDSLOS | keine Skills | - |
| X-9 | Profil-Tool (optional) | NICHT ERFUELLT | kein openai/profile; Kategorie C | optional, kein Blocker |
| X-10 | primaer Tools | ERFUELLT | prompts/list -32601, resources nur UI | - |

## EINREICHUNGS-BLOCKER

Pflicht nach Wortlaut (Kategorie A/B) und nicht ERFUELLT. Kategorie-C-IDs (T-3, T-17, T-21, T-29, X-9) sind keine Blocker.

### Technisch offen
| ID | Status | Was fehlt | nur mit UI? |
|---|---|---|---|
| (quer) | - | master 21ff856 ist nicht live (live 728f053) | nein |
| T-5 | TEILWEISE | folgt aus T-9/T-12/T-14 | nein |
| T-12 | TEILWEISE | exp nicht erzwungen; Scopes ungeprueft | nein |
| T-14 | NICHT ERFUELLT | kein _meta["mcp/www_authenticate"] in Fehlerergebnissen | nein |
| T-23 | TEILWEISE | ChatGPT-Adapter liefert nur openai/outputTemplate | ja |
| T-27 | TEILWEISE | cancel_call ohne Timeout; Rate-Limit nicht pro Nutzer | nein |
| T-33 | TEILWEISE | kein Kompatibilitaetsschutz fuer publizierte Definition | nein (greift ab 1. Update) |
| T-34 | TEILWEISE | keine versionierten ui://-URIs | ja |
| N-10 | TEILWEISE | keine serverseitige Bestaetigung fuer place_call | nein |
| N-12 | TEILWEISE | get_transcript irrefuehrend benannt | nein |
| N-13 | TEILWEISE | get_calendar-Beschreibung verschweigt Demo-/Leer-Kalender | nein |
| N-14 | TEILWEISE | briefing + context als doppelter optionaler Kontext | nein |
| O-13 | TEILWEISE | Action-Item-ID, OUTBOUND_FROZEN-Name, rohe HTTP-/Transportfehler | nein |
| O-14 | TEILWEISE | Restricted-Data-Ausschluss nicht in allen Freitexten/Consult/Ergebnissen | nein |
| O-15 | TEILWEISE | keine Mechanik fuer Art.-9-Inhalte (oder Owner-Entscheidung) | nein |
| O-20 | TEILWEISE | "Bitte Tarif anpassen" in Tool-Antwort | nein |
| O-27 | TEILWEISE | Quellen-Aufzaehlung in briefing-Beschreibung | nein |
| O-6 | TEILWEISE | Loeschweg nur per CLI (techn. Teil) | nein |

### Wartet auf den Owner
| ID | Status | Was aussteht | nur mit UI? |
|---|---|---|---|
| (quer) | - | Deploy von master auf den Upstream-Render-Dienst | nein |
| T-9 | TEILWEISE | Messung mit echtem Login, ob WorkOS aud = https://app.sundartha.com/mcp setzt | nein |
| T-30 | GEGATET | Live-Probe O-P8-2/O-P8-3 oder UI fuer Einreichung abschalten (MCP_UI_ENABLED Default true) | ja |
| T-31 | GEGATET | wie T-30 | ja |
| O-4 | GEGATET | OPENAI_APPS_CHALLENGE_TOKEN setzen, live nachmessen | nein |
| O-6 | TEILWEISE | retention_days beim Anbieter -1 -> endlich (Launch-Blocker) | nein |
| O-7 | TEILWEISE | Support-URL festlegen/schaffen; englische Rechtsseiten | nein |
| O-18 | GEGATET | Usage Policies im Browser lesen und abgleichen | nein |
| O-19 | TEILWEISE | Zweckbindung gegen Werbeanrufe entscheiden; Zulaessigkeit bleibt Review-Frage | nein |
| O-25 | TEILWEISE | Testanrufe fuer Stabilitaet | nein |
| T-16 | TEILWEISE | nur falls Workspace-Domain-Restriktion gewollt: email_verified per Login messen | nein |

### Nicht in unserer Hand
| ID | Was |
|---|---|
| T-11 | WorkOS bewirbt kein RFC-9207-iss; ChatGPT nutzt dann die callback-spezifische URI (kein Blocker, solange dieser Weg funktioniert - ungemessen) |

### Weitere Risiken (keine eigene ID)
- /mcp-Herkunftswache: Request mit `Origin: https://chatgpt.com` -> 403 ohne Challenge, solange MCP_ALLOWED_ORIGINS leer ist (Pruefer gemessen). Ob der ChatGPT-Connector einen Origin sendet: UNKNOWN.
- Per-IP-Limiter 120/min drosselt ueber OpenAIs geteilte Egress-IPs nutzeruebergreifend.

## HERABGESTUFT

| ID | Pruefer-Urteil | neu | Grund |
|---|---|---|---|
| O-19 | ERFUELLT | TEILWEISE | Die Codestellen stimmen (outbound-gates.js:364-379 Definition, :485-496 Anwendung - beide Zeilenangaben der Pruefer sind richtig). Sie belegen aber nur Mengenbremsen (6/h pro Tenant, 3/24 h pro Ziel), keine Zweckbindung. Ein Tenant kann weiterhin Werbeanrufe im Rahmen der Limits fuehren. Der Pruefer nennt das selbst als offen. "Kein Telemarketing" ist damit nicht voll belegt. |

### Stichprobe (selbst nachgesehen oder nachgemessen, alle ausser O-19 getragen)
| ID | Beleg | Ergebnis |
|---|---|---|
| T-6 | src/auth.js registerWellKnown: resource=audience(), authorization_servers | getragen |
| T-8, T-10, T-11 | Live-GET WorkOS AS-Metadata: S256, CIMD true, DCR, auth none, kein iss-Parameter | getragen |
| T-12 | jwtVerify nur issuer/audience/clockTolerance, kein requiredClaims | TEILWEISE bestaetigt |
| T-13 | deny401 mit resource_metadata; p6-Test gruen | getragen |
| T-14 | grep www_authenticate src = 0 | NICHT ERFUELLT bestaetigt |
| T-15 | applyToolSecuritySchemes; Primaerquelle Zeile 1643 (Top-Level primaer, _meta nur Back-compat) | getragen |
| T-18 | cancel_call/list_action_items ohne outputSchema und ohne structuredContent | getragen |
| T-21 | MCP_BASE_INSTRUCTIONS 403 Zeichen, beginnt mit not-placed-Satz | getragen |
| T-30/T-31 | src/ui/contract.js: Resource-Inhalt ohne _meta; Primaerquelle 7687/7688 | GEGATET getragen |
| T-32 | live PRM resource https://app.sundartha.com/mcp; config.js:1499 Fallback | getragen, Risiko bestaetigt |
| N-1/X-1, N-3, N-4 | TOOL_ANNOTATIONS-Tabelle vollstaendig gelesen | getragen |
| N-2 | api-read.js /api/state, /api/calls/:id ohne Schreibaufrufe; Primaerquelle 5554 "write logs" meint Tool-Aktion | getragen |
| O-4 | src/app.js:219-223 | getragen |
| O-13, O-20 | mcp-tools.js list_action_items `[${a.id}]`; outbound-gates.js:667, :900 | TEILWEISE bestaetigt |
| O-16 | routes/mcp.js hashEmail im [mcp]-Log | getragen |
| O-27 | mcp-tools.js:955 enthaelt "calendar, mail, files, chat" und "Claude/Gemini" | TEILWEISE bestaetigt |

Testlauf (gezielt, NODE_ENV=test, --test-concurrency=4): mcp-tool-annotations, oauth, openai-p10a-tool-inventar, openai-p3, openai-p6, openai-p7, openai-p4, openai-p8, openai-e7, openai-p2, openai-p5a: 82 pass / 0 fail.

## SICHERHEIT

Kein Pruefer hat ein angefasstes Safety-Gate gemeldet. Pruefer 4 hat 728f053..21ff856 an den Gate-Dateien geprueft (nur Kommentare in call-lifecycle.js). Pruefer 2 und ich sehen die Gate-Kette in outbound-gates.js unveraendert (Stundenlimit pro Tenant, Ziel-Cap, OUTBOUND_FROZEN). Nebenbefund ohne Gate-Wirkung: der OUTBOUND_FROZEN-Ablehnungstext nennt den Env-Namen (outbound-gates.js:667), entgegen dem Kommentar an :482. Das ist Datenminimierung (O-13), keine Aufweichung des Gates.
