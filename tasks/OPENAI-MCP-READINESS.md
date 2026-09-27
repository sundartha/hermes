# Hermes MCP - Bereitschaft fuer eine oeffentliche ChatGPT-Integration (Ist-Aufnahme)

**Geprueft wurde:** der MCP-Server von Hermes in 15 Dimensionen (Protokoll/Transport, Werkzeug-Inventar, Werkzeug-Semantik, Eingabevalidierung, Antwort-Minimierung, Authentifizierung, Autorisierung/Mandantentrennung, Consult-Kanal, Prompt-Injection/Vertrauensgrenzen, reale Aussenwirkung/Missbrauch, Lebenszyklus/Betrieb, Secrets/Logging, Daten/Aufbewahrung/Loeschung, Deployment/Domain/Submission, Testabdeckung) gegen `tasks/openai-audit/00-openai-anforderungen.md` (OpenAI-Soll, Abruf 2026-09-18) und `tasks/openai-audit/00-mcp-spec.md` (MCP-Soll, Revision 2026-07-28). Nachgetragen sind drei Teilberichte: die Review-Testfaelle (`tasks/openai-audit/16-review-testfaelle.md`, 19 Faelle - 5 positiv, 8 negativ, 6 Sicherheit), die Resources-Flaeche (`tasks/openai-audit/17-resources-flaeche.md`, D17) und Host/Origin des Endpunkts (`tasks/openai-audit/18-host-und-origin.md`, D18).

**NICHT geprueft wurde:** der laufende Produktionsdienst (keine Live-Messung, kein Testanruf, keine Testsuite ausgefuehrt, kein Handshake gegen `https://.../mcp` ausser einem gescheiterten Sandbox-Smoke-Test, `01-protokoll-transport.md` PP-D1-11), die Konfiguration im Render-Dashboard (die Dienste sind dashboard-verwaltet, `render.yaml:14-17` erklaert sich selbst zur Referenz und nicht zur Wahrheit), die Faehigkeiten des Authorization Servers (WorkOS), die Vertragslage mit Anbietern, sowie alles, was ausserhalb dieses Repositorys liegt (Domain-Eigentum bei OpenAI, Unternehmensverifikation, tatsaechliche Aufbewahrung in Produktion).

**Worauf sich alle Aussagen stuetzen:** ausschliesslich der Code auf Branch `master` (Stand `6324b1e`), gelesen, nicht ausgefuehrt. Jede Aussage traegt eine Datei-/Zeilenangabe oder das Wort UNKNOWN. Wo ein Teilbericht eine Gegenpruefung hat, gilt das Urteil des Gegenpruefers.

## Kurzfassung fuer Eilige

Der MCP-Server ist technisch solide gebaut und in mehreren Achsen ueberdurchschnittlich diszipliniert, aber er ist fuer eine **oeffentliche** Einreichung nicht bereit: es fehlen drei formale Einreichungs-Voraussetzungen, die Werkzeug-Metadaten erfuellen die OpenAI-Pflichtfelder nicht, und die entscheidende Auth-Haelfte liegt unbelegt beim Identitaetsanbieter.

Die drei schwerwiegendsten Befunde:

1. **Kein einziges der 12 Werkzeuge traegt `annotations`** (`readOnlyHint`/`destructiveHint`/`openWorldHint`) - Grep ueber `src/` liefert 0 Treffer (`02-tool-inventar.md` PP-D2-01, `03-tool-semantik-annotations.md` PP-D3-07, `10-externe-aktionen-missbrauch.md` PP-D10-03). OpenAI fuehrt alle drei als Required (N-1) und nennt falsche/fehlende Labels als haeufigen Ablehnungsgrund (N-6).
2. **`place_call` loest einen echten, kostenpflichtigen Anruf ohne jede Idempotenz und ohne jede Frist auf dem internen Hop aus** (`src/mcp-tools.js:585` ohne `timeoutMs`; `src/routes/api-calls.js:334-341` ohne Idempotenz-Schluessel) - ein Timeout plus Retry erzeugt einen zweiten realen Anruf beim selben Menschen (`10-externe-aktionen-missbrauch.md` PP-D10-04/05, beide gegengeprueft BESTAETIGT).
3. **Formale Einreichungs-Blocker ausserhalb des MCP-Codes**: die Domain-Challenge-Route `/.well-known/openai-apps-challenge` existiert nicht (Grep ohne Treffer, `14-deployment-domain-submission.md` PP-D14-04), die Rechtstexte tragen live `[OFFEN: ...]`-Platzhalter (`apps/web/src/data/legal/privacy.de.json:10`, `terms.de.json:38`, `imprint.de.json:18`), und ein externer Pruefer kann `place_call` ohne Abo und KYC nicht testen (`src/telephony/outbound-gates.js:391-400`, `:409-433`).

Die drei Dinge, die bereits tragfaehig sind:

1. **Eingabevalidierung und Mass-Assignment-Schutz**: alle 12 Werkzeuge nutzen zod-Schemas, die das SDK serverseitig erzwingt (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:174-180`); `POST /api/calls` baut den Store-Aufruf als explizite Feldliste (`src/routes/api-calls.js:439-459`), sicherheitsrelevante Felder werden serverseitig berechnet (`:196-212`).
2. **Die Gate-Kette vor dem realen Anruf**: 18 Glieder, reihenfolge- und laengen-gepinnt, fail-closed (`src/telephony/outbound-gates.js:656-965`), mit echten Limits (Kill-Switch, 6 Anrufe/h, 3/Ziel/24h, Denylist inkl. Notrufe, Landfilter, KYC/Abo, Tenant-Kostendecke mit atomarer Reserve, harte Max-Dauer).
3. **Token-Pruefung und Datenminimierung**: JWT gegen Remote-JWKS mit Issuer, Audience und Ablauf bei JEDEM Request (`src/auth.js:75-88`, negativ getestet in `test/oauth.test.js:57-121`); jedes Werkzeug projiziert ueber eine benannte `pick*`-Whitelist, kein Rohobjekt-Spread (`src/mcp-tools.js:164-173`, `:206-215`, `:401-411`).

Geprueft und entkraeftet (taucht unten nicht als Befund auf): die Behauptung, die Consult-Antwort sei ein ungefilterter P0-Egress (`09-...` PP-D9-05, WIDERLEGT: Kappe 10x200 existiert deterministisch vor dem Store, Quelle ist die Auftraggeber-Seite), ein fehlender Ziffern-/E-Mail-Filter auf der Consult-Frage als Luecke (`08-consult.md` PP-D8-06, WIDERLEGT: Empfaenger-Asymmetrie, derselbe Inhalt erreicht den Host regulaer ueber `result_summary`), die Fehlzustellung einer Consult-Antwort als Server-Defekt (PP-D8-08, WIDERLEGT: braucht einen Client-Fehler plus zwei parallele Rueckfragen), Steuerzeichen in der Consult-Antwort als neue Faehigkeit (PP-D8-10, WIDERLEGT: `briefing`/`constraints` koennen das bereits, und auf dem EL-Weg erreicht die Antwort den HINTERGRUND-Block nicht), der Live-Schalterstand des Consult-Kanals als unentscheidbar (PP-D8-19, WIDERLEGT: drei von vier Faktoren sind aus jedem `/mcp`-Handshake ablesbar), und `cancel_call` als ungetesteter Refactor-Pfad (`05-response-leaks.md` PP-D5-02, WIDERLEGT: `test/el-beende-versuch.test.js:411-429` pinnt den Antwortkoerper).

## Zahlenbild

Gezaehlt sind die Pruefpunkte der Teilberichte inklusive der Zusatzbefunde der Gegenpruefer; von einem Gegenpruefer widerlegte Befunde sind aus der Wertung genommen und in der letzten Spalte gefuehrt.

| Dim | Thema | PASS | PARTIAL | FAIL | UNKNOWN | N/A | Summe | widerlegt |
|---|---|---|---|---|---|---|---|---|
| D1 | MCP-Protokoll, Transport, OpenAI-Kompatibilitaet | 4 | 2 | 3 | 1 | 1 | 11 | 0 |
| D2 | Werkzeug-Inventar | 0 | 4 | 2 | 0 | 0 | 6 | 0 |
| D3 | Namen, Beschreibungen, Nebenwirkungs-Kennzeichnung | 1 | 7 | 6 | 0 | 0 | 14 | 0 |
| D4 | Input-Schemas und serverseitige Validierung | 7 | 3 | 0 | 0 | 0 | 10 | 0 |
| D5 | Antworten: Datenlecks und Datenminimierung | 6 | 6 | 1 | 0 | 0 | 13 | 1 |
| D6 | Authentifizierung des MCP-Clients | 5 | 8 | 7 | 1 | 1 | 22 | 0 |
| D7 | Autorisierung, Mandantentrennung, IDOR | 4 | 8 | 6 | 0 | 0 | 18 | 0 |
| D8 | Consult-Mechanismus | 9 | 8 | 3 | 1 | 0 | 21 | 3 |
| D9 | Prompt-Injection und Vertrauensgrenzen | 3 | 10 | 6 | 0 | 1 | 20 | 1 |
| D10 | Reale externe Aktionen, Idempotenz, Missbrauch | 4 | 6 | 7 | 0 | 1 | 18 | 0 |
| D11 | Lebenszyklus, Fehlerverhalten, Betriebsreife | 8 | 3 | 1 | 0 | 0 | 12 | 0 |
| D12 | Secrets und Logging | 7 | 5 | 1 | 0 | 0 | 13 | 0 |
| D13 | Dateninventar, Aufbewahrung, Loeschung, Policy | 6 | 3 | 1 | 3 | 0 | 13 | 0 |
| D14 | Deployment, Domain, Web, Submission, Dependencies | 4 | 3 | 3 | 1 | 0 | 11 | 0 |
| D15 | Automatisierte Testabdeckung | 15 | 2 | 4 | 1 | 0 | 22 | 0 |
| D17 | Resources-Flaeche (`ui://`-Ressourcen) | 3 | 3 | 1 | 0 | 0 | 7 | 0 |
| D18 | Host und Origin des `/mcp`-Endpunkts | 1 | 1 | 3 | 0 | 0 | 5 | 0 |
| **Summe** | | **87** | **82** | **55** | **8** | **4** | **236** | **5** |

Lesehilfe: die Zahlen sind Pruefpunkte, keine Defekte. Ein FAIL in D15 heisst "kein Test", nicht "Code kaputt"; ein FAIL in D6 kann eine fehlende Funktion (Scopes) oder eine fehlende Haertung (Widerruf) sein. Die Dimensionen mit der hoechsten FAIL-Dichte sind D18 (3/5), D3 (6/14), D6 (7/22), D7 (6/18), D10 (7/18) und D9 (6/20) - also Host/Origin, Werkzeug-Metadaten, Auth-Feinheiten, Mandantentrennung, Aussenwirkung und Fremdtext-Behandlung. `16-review-testfaelle.md` traegt keine Pruefpunkte und ist deshalb nicht in der Tabelle: es liefert 19 Testfaelle (5 positiv, 8 negativ, 6 Sicherheit) fuer O-10, jeder mit einer eigenen Spalte "Ist-Zustand belegt?".

## Einreichungs-Blocker (P0)

Aufgenommen ist nur, was eine Einreichung entweder formal unmoeglich macht, nach OpenAI-Doku ein dokumentierter Ablehnungsgrund ist, oder einen realen, nicht rueckholbaren Schaden an einem Dritten ausloesen kann. Jede Zeile traegt einen Beleg.

### P0-1 Kein Werkzeug traegt `annotations` - Kategorie A

- **Was fehlt:** `readOnlyHint`, `destructiveHint`, `openWorldHint` (und `idempotentHint`) an allen 12 Werkzeugen.
- **Beleg:** `grep -rn "readOnlyHint\|destructiveHint\|openWorldHint\|idempotentHint\|annotations" src/` = 0 Treffer; die 12 Registrierungen liegen in `src/mcp-tools.js:666, 858, 892, 999, 1015, 1058, 1069, 1096, 1126, 1149, 1172, 1210`. Beide benutzten Registrierungswege unterstuetzen das Feld (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:141, :146, :155`) - es ist keine technische Grenze.
- **Warum es blockiert:** OpenAI fuehrt die drei Felder als Required (N-1, `00-openai-anforderungen.md:75`) und nennt "Incorrect or missing action labels" ausdruecklich als haeufigen Ablehnungsgrund (N-6, `:80`). Zugleich behandelt der Host jedes Werkzeug ohne `readOnlyHint` als Write-Action (N-7, `:81`). Die Folge - acht reine Lesewerkzeuge hinter einer Bestaetigung und keine Trennschaerfe mehr fuer `place_call` - ist damit eine begruendete MOEGLICHKEIT, keine gemessene Tatsache: ob und wie ein echter ChatGPT-Host bestaetigt, fuehrt die Matrixzeile N-8 ausdruecklich als UNKNOWN (Host-Verhalten, am Repo nicht entscheidbar). Der Ablehnungsgrund N-6 steht unabhaengig davon.
- **Kategorie:** A (N-1, N-6, N-7 sind woertliche Zitate aus der OpenAI-Doku).

### P0-2 Domain-Ownership-Challenge-Route existiert nicht - Kategorie A

- **Was fehlt:** `GET /.well-known/openai-apps-challenge`, die ausschliesslich den von OpenAI zugewiesenen Klartext-Token liefert.
- **Beleg:** `grep -rn "openai-apps-challenge" src/ apps/web` = 0 Treffer (`14-deployment-domain-submission.md` PP-D14-04). Das Muster fuer eine oeffentliche Well-Known-Route existiert bereits (`src/route-policy.js:86-95` fuer `/.well-known/oauth-protected-resource*`, registriert in `src/app.js:167`).
- **Warum es blockiert:** ohne diese Route ist die Domain im Submission-Portal nicht verifizierbar (O-4, `00-openai-anforderungen.md:99`); der Pfad wird ignoriert, es zaehlt der Host (O-5, `:100`).
- **Kategorie:** A.

### P0-3 Rechtstexte tragen live `[OFFEN: ...]`-Platzhalter - Kategorie A

- **Was fehlt:** Firmenanschrift/Rechtsform, Telefonnummer nach Paragraph 5 DDG, eine geklaerte Widerrufsklausel.
- **Beleg:** `apps/web/src/data/legal/privacy.de.json:10`, `apps/web/src/data/legal/terms.de.json:38`, `apps/web/src/data/legal/imprint.de.json:18`; eingebunden im Web-Build ueber `apps/web/src/pages/index.astro:30-32`, Seitenliste `apps/web/src/lib/legal.js:14-26`.
- **Warum es blockiert:** die Privacy-Policy-URL und die Terms-URL sind Pflichtangaben und muessen oeffentlich und zur Publisher-Identitaet passend sein (O-7, `00-openai-anforderungen.md:102`); die Policy muss die geforderten Angaben tatsaechlich enthalten (O-6, `:101`). Ein Reviewer sieht die Platzhalter beim ersten Aufruf.
- **Kategorie:** A.

### P0-4 Kein Reviewer-Zugang zu `place_call` ohne Zahlung und KYC - Kategorie A

- **Was fehlt:** ein voll ausgestatteter Demo-Zugang, der das zentrale Werkzeug ohne zusaetzliche Anmeldeschritte bedienen kann.
- **Beleg:** KYC-Gate `src/telephony/outbound-gates.js:391-400` (`store.kycReached(tenantId, KYC_OUTBOUND_MIN)`, sonst 403 `grund: "kyc"`); Abo-Gate `:409-433` (`store.tenantActiveSubscriber`, sonst `subscriptionInactive`); Login ausschliesslich ueber WorkOS-OIDC, der Dev-Login ist in Produktion boot-fatal (`src/config.js:2363-2368`, `src/web-auth.js:331`).
- **Warum es blockiert:** O-9 (`00-openai-anforderungen.md:104`) verlangt einen Demo-Account ohne Neuanmeldung, ohne 2FA und ohne unzugaengliche Bestaetigungsschritte; "Plugins that require additional login steps ... will be rejected". Die Gates selbst duerfen nicht aufgeweicht werden (CLAUDE.md Absolute Regel 1) - die Loesung liegt also im Bereitstellen eines vorbezahlten, KYC-verifizierten Tenants, nicht im Code.
- **Kategorie:** A.

### P0-5 Aus welchem OpenAI-Projekt eingereicht wird, ist nicht festgelegt (EU-Datenresidenz) - Kategorie A

- **Was fehlt:** die Festlegung und der Nachweis, dass die Einreichung aus einem OpenAI-Projekt mit **globaler** Datenresidenz erfolgt.
- **Beleg:** T-35 (`00-openai-anforderungen.md:68`): "For now, projects with EU data residency cannot submit plugins with MCP servers for review. Use a project with global data residency." Der eigene Serverstandort ist Frankfurt (`render.yaml:8-12`, bestaetigt gegenueber Endnutzern in `apps/web/src/data/legal/privacy.de.json:42`).
- **Warum es blockiert:** ohne ein Projekt mit globaler Residenz ist die Einreichung im Portal nicht moeglich. **Praezisierung gegenueber dem Teilbericht** (`14-...` PP-D14-03 wertet das als FAIL): der Wortlaut von T-35 adressiert das OpenAI-Projekt-Setting ("Use a project with global data residency"), nicht den Hosting-Ort des MCP-Servers. Die Frankfurt-Pinnung ist damit **kein** Beleg fuer einen Verstoss, sondern nur der Grund, die Frage zu stellen. Was tatsaechlich fehlt, ist die Klaerung auf Kontoebene - siehe auch Abschnitt "Nicht am Repo entscheidbar".
- **Kategorie:** A (T-35 ist ein woertliches Zitat), Umsetzung ausserhalb des Codes.

### P0-6 `place_call` ohne Frist auf dem internen Hop und ohne Idempotenz - Kategorie A (Frist) / B (Idempotenz)

- **Was fehlt:** ein Timeout auf dem internen REST-Aufruf und irgendeine Deduplizierung des Anrufstarts.
- **Beleg:** `src/mcp-tools.js:585` (`const call = (method, path, body) => api({...})` ohne `timeoutMs`; `api()` setzt `signal` nur bei gesetztem `timeoutMs`, `:57-66`; einzige Ausnahme ist `pollConsult`, `:588-603`). `POST /api/calls` (`src/routes/api-calls.js:334-341`) nimmt keinen Idempotenz-Schluessel entgegen, `:439` legt bedingungslos einen neuen Datensatz an; `rg "idempot" src/` trifft nur Provisioning und die Reserve-Freigabe (`src/store/pg.js:1253`, `src/store/state-ops.js:405`). Der Anbieter-Anrufstart blockiert ueber die gesamte Klingelphase (Messnotiz 40,3 s in `src/elevenlabs/outbound.js:1806ff`). Verschaerfend: der Handler hat keinen aeusseren `try` (Beginn erst `src/routes/api-calls.js:471`), eine Ausnahme davor endet als `unhandledRejection` (`src/process-guards.js:21`) ohne jede Antwort an den Client.
- **Warum es blockiert:** T-27 (`00-openai-anforderungen.md:60`) macht Timeouts und Rate-Limits fuer teure oder extern sichtbare Werkzeuge zur Pflicht des Servers; `place_call` ist der Musterfall und hat keinen Timeout. Die Folge ist nicht abstrakt: Timeout plus Retry ergibt einen zweiten echten Anruf bei einem realen Menschen und eine zweite Carrier-Kosten-Buchung. Ob ein echter ChatGPT-Host automatisch wiederholt, ist UNKNOWN (`10-...`, Offene Fragen).
- **Kategorie:** A fuer die fehlende Frist (T-27), B fuer die fehlende Idempotenz (Sicherheitsarchitektur, von OpenAI nicht woertlich gefordert; N-11 `:85` verlangt lediglich, dass Tools retry-sicher sind **oder es ausweisen** - ausgewiesen ist es nirgends).

### P0-7 Mandantentrennung haengt an einem Laufzeit-Flag, dessen Default sie abschaltet - Kategorie B

- **Was fehlt:** eine Trennung, die nicht an `config.tenancy.multiTenant` haengt, und ein Boot-Riegel, der die unsichere Kombination verhindert.
- **Beleg:** `src/routes/_tenant.js:145` (`if (!config.tenancy.multiTenant) return operatorChannelTenant(req);`) steht VOR der Auswertung von `internalTenant(req)` (`:150`) und `req.auth.sub` (`:152`); der interne Hop ist echtes Loopback ohne `X-Forwarded-For` (`src/mcp-tools.js:56-60`, `src/wiring/internal-only.js:24-28`) und faellt damit auf `BOOTSTRAP_TENANT_ID`, dem `src/store/defaults.js:1086-1088` hart `OWNER_PROFILE` zuweist (`maxCallsPerHour: null` heisst dort "keine Profil-Senkung", nicht "kein Stundenlimit" - s. Folge-Absatz). Alle vier Besitzpruefungen tragen dieselbe Flag-Bedingung (`src/routes/api-calls.js:319` genutzt `:583-586`, `:618-619`, `:644`; `src/routes/api-read.js:105`), und `GET /api/state` liefert bei Flag aus den Roh-State (`src/routes/api-read.js:70`, `: s`). Der Zugriff ist dabei nicht nur lesend: `POST /api/calls/:id/consult/answer` schreibt in `call.context.key_facts` eines fremden Anrufs und `POST /api/calls/:id/cancel` legt ein fremdes laufendes Gespraech auf (`07-...` PP-D7-GP-02, FAIL). Default `false` in `src/config.js:1570`, explizit `"false"` in `render.yaml:666-667`. Postgres-RLS traegt die Grenze nicht: `src/store/pg.js:974-984` hydriert alle Mandanten in EINEN Spiegel, `:200`/`:210` lesen nur diesen. Die gruene Testsuite belegt Trennung ausschliesslich mit `MULTI_TENANT: "true"` (`test/read-scope-tenant.test.js:113/142/174`) und pinnt den Flag-aus-Fall ausdruecklich als ungefiltertes Soll (`:198-215`).
- **Folge fuer die Limits (bisher nirgends zusammengefuehrt):** faellt jeder MCP-Nutzer auf `BOOTSTRAP_TENANT_ID` (`src/routes/_tenant.js:145`), dann teilen ALLE Nutzer dieselben pro-Tenant-Deckel: EINE Stundendecke (`src/telephony/outbound-gates.js:364-369`, gezaehlt als `store.countOutboundCallsSince(hourWindowStart(), { tenantId })`), EINEN Pro-Ziel-Cap (`:374-378`), EINE Kostendecke (`:875-877`, `store.budgetExceeded(ctx.tenantId, config.billing)`) und EINE Geld-Reserve (`:907`). Davon unabhaengig, aber in dieselbe Richtung wirkend: der Rate-Limiter keyt allein auf `req.ip` (`src/middleware.js:157-168`, P1-23) - bei einem gehosteten Connector ein gemeinsamer Eimer. Wer zuerst 6 Anrufe in der Stunde macht, sperrt alle anderen; die Decke des Bootstrap-Tenants deckelt die Summe aller. Die Korrektur dazu: `OWNER_PROFILE.maxCallsPerHour: null` (`src/store/defaults.js:1056-1065`) hebt das Stundenlimit NICHT auf - `src/telephony/outbound-gates.js:365-368` loest `null` auf `config.safety.maxCallsPerHour` auf, und der Kommentar `src/store/defaults.js:1051-1052` sagt genau das ("maxCallsPerHour=null -> effektiv der Pro-Tenant-Default"). Verschaerfend bleibt dagegen, dass das Profil des Bootstrap-Tenants Outbound ueber den Subscriber-Pfad ueberhaupt freischaltet (`:1048-1055`), also fuer JEDEN MCP-Nutzer, der auf ihn kollabiert.
- **Warum es blockiert:** eine oeffentliche Integration bedeutet viele Endnutzer an einem Endpunkt. Trennung, die an einer Umgebungsvariablen haengt, deren Default sie abschaltet und deren Live-Wert am Repo nicht belegbar ist (`render.yaml:14-17`), ist fuer diesen Fall keine Trennung. Der Live-Wert ist UNKNOWN - der strukturelle Befund (Flag statt Datenzugriffsschicht, kein Torschluss am `/mcp`-Handler, `07-...` PP-D7-GP-01) ist am Repo entscheidbar und unabhaengig davon.
- **Kategorie:** B.

### P0-8 Die Authorization-Server-Seite ist nirgends belegt - Kategorie A

- **Was fehlt:** der Nachweis, dass der live konfigurierte Authorization Server CIMD oder DCR beherrscht, `S256` bewirbt, `iss` in Authorization-Responses liefert und den `resource`-Parameter in den Token uebernimmt.
- **Beleg:** `grep` ueber `src/` findet `registration_endpoint`, `client_id_metadata_document_supported`, `code_challenge_methods_supported`, `authorization_response_iss_parameter_supported` und `resource_indicator` **null Mal** (`06-authentifizierung.md` PP-D6-05, gegengeprueft BESTAETIGT). `/.well-known/oauth-authorization-server` wird nur als Konsument gelesen (`src/auth.js:29-48`, ausschliesslich nach `jwks_uri`). Der Issuer-Wert selbst steht nicht im Repo (`render.yaml:360-361` `sync: false`, `.env.example:966` leer); dass ueberhaupt einer existiert, folgt nur daraus, dass `MCP_AUTH=oauth` ohne Issuer boot-fatal ist (`src/config.js:2421`).
- **Warum es blockiert:** T-10 (`00-openai-anforderungen.md:43`) verlangt CIMD als bevorzugten Weg und DCR als unterstuetzte Alternative; ohne eines von beidem kann ChatGPT keinen Client anlegen und die Integration ist unabhaengig von der Codequalitaet nicht moeglich. T-8 (`:41`) macht `S256`-Advertising zur Pflicht ("Server ohne S256-Advertising sind unsupported per spec"), T-11 (`:44`) verlangt fuer die stabile Redirect-URI RFC-9207-`iss`, T-9 (`:42`) die Uebernahme von `resource` in den Token.
- **Kategorie:** A. Am Repo NICHT entscheidbar (siehe Abschnitt "Nicht am Repo entscheidbar") - aber ohne diesen Nachweis ist eine Einreichung nicht sinnvoll, deshalb steht der fehlende Nachweis hier.

### P0-9 Die Datenschutzerklaerung ist nicht gegen die Live-Konfiguration abgeglichen - Kategorie A

- **Was fehlt:** ein dokumentierter Abgleich der Policy-Aussagen mit den tatsaechlich gesetzten Schaltern und Anbietern.
- **Beleg:** `apps/web/src/data/legal/privacy.de.json:38` erklaert Websuche/Recherche ausdruecklich als "derzeit abgeschaltet ... nicht aktiv; vor einer Aktivierung ergaenzen wir diese Erklaerung" und nennt als Sprachmodell-Anbieter ausschliesslich Anthropic. Im Code existieren beide Gegenstuecke: `src/research/adapters/exa-search.js:1-8` (Exa als zweiter Auftragsverarbeiter, Owner-Entscheidung 2026-08-01) und `src/llm/provider.js:4` (`LLM_PROVIDER = {ANTHROPIC, DEEPSEEK}`). `grep -n "Exa" apps/web/src/data/legal/privacy.de.json` = 0 Treffer. Die Blueprint-Werte sind `false`/`anthropic` (`render.yaml:390-401`, `:373-377`), der Live-Wert ist UNKNOWN (dashboard-verwaltet). `render.yaml:390-401` macht die Nennung in der Datenschutzerklaerung selbst zur Vorbedingung des Anschaltens.
- **Warum es blockiert:** O-6 (`00-openai-anforderungen.md:101`) verlangt eine veroeffentlichte Policy, die Kategorien, Zwecke, Empfaenger und Fristen nennt - **und eingehalten wird**. Ist Recherche oder DeepSeek live, ist die Policy in der Empfaengerfrage falsch, und der Code verstoesst gegen seine eigene, ausgeschriebene Vorbedingung. Der Abgleich selbst ist unbedingt erforderlich; sein Ergebnis kann das Repo nicht liefern.
- **Kategorie:** A.

### P0-10 Welcher Origin angekuendigt wird, haengt an einer Variablen, die der Blueprint fuer unnoetig erklaert - Kategorie B

- **Was fehlt:** eine ausdrueckliche Festlegung von `PUBLIC_URL` auf den Origin, unter dem eingereicht wird, und ein Boot-Riegel, der den angekuendigten gegen den erwarteten Origin prueft (heute prueft er nur "gesetzt und kein Platzhalter", `src/config.js:2417-2418`).
- **Beleg:** `src/config.js:1443` (`PUBLIC_URL || RENDER_EXTERNAL_URL || ""`); im Gateway-Block von `render.yaml` existiert KEIN `PUBLIC_URL`-Eintrag, `render.yaml:686` erklaert ihn ausdruecklich fuer unnoetig ("Render setzt RENDER_EXTERNAL_URL automatisch"). Derselbe Wert speist Token-Audience (`src/auth.js:23`, erzwungen `:83`), `PRM.resource` (`:123`), den Metadaten-Verweis im 401 (`:24`, `:69-71`) und die Icon-URL (`src/mcp-server-info.js:66`). Ein repo-interner Messbefund vom 2026-07-02 haelt fest, dass `PUBLIC_URL` real auf `onrender.com` zeigte, waehrend der Connector unter `app.sundartha.com` lief (`src/mcp-server-info.js:13-17`) - die Divergenz ist nicht hypothetisch. Welcher Host `/mcp` bedient, ist nirgends gebunden: `src/routes/mcp.js:51` montiert die Route mit `mcpAuth` und ohne `allowedHosts`/`req.hostname`-Vergleich, beide Hosts antworten (`render.yaml:22` `PUBLIC_GATEWAY_URL=https://app.sundartha.com`; `18-host-und-origin.md` PP-D18-02).
- **Warum es blockiert:** kuendigt der Server `resource=<onrender-Host>/mcp` an, waehrend im Portal der Marken-Host eingereicht wird, sendet der Client `resource=<Marken-Host>/mcp` und die Audience-Pruefung schlaegt fehl (`src/auth.js:83`) - die Integration authentifiziert dann niemanden, unabhaengig von jeder Codequalitaet. Der Live-Wert ist am Repo UNKNOWN (dashboard-verwaltet, `render.yaml:14-17`) und muss am Dienst gelesen werden; der Leseweg existiert (`src/elevenlabs/init-webhook-ziel.js:84`, `:103-137`).
- **Kategorie:** B (`18-...` PP-D18-01 und PP-D18-03, beide P0/B).

### P0-11 Die Einreichung friert den Origin ein, waehrend der Rebrand laut Plan offen ist - Kategorie A

- **Was fehlt:** die Entscheidung, unter welchem Host und Origin `/mcp` eingereicht wird - getroffen VOR der Einreichung.
- **Beleg:** T-32 (`00-openai-anforderungen.md:65`, Kategorie A, woertlich: "To change the origin, create a new plugin, then complete its scan, submission, review, and publication flow."; genannt sind `scheme`, `hostname`, `port`). Gegenstueck im Projekt: der Infra-/URL-Cutover (Track B) ist in `CLAUDE.md`, Abschnitt "Naming", ausdruecklich als offen dokumentiert, Repo- und Dienstname tragen weiter `vodafone-agent`. Die Challenge-Route muss auf demselben Host oder einem Parent liegen (O-5, `:100`); bei `onrender.com` gehoert der Parent Render, bei `app.sundartha.com` steht `sundartha.com` zur Verfuegung (`18-...` PP-D18-05).
- **Warum es blockiert:** eine Einreichung unter dem heutigen Fallback-Origin bindet das Plugin dauerhaft an einen markenfremden Host einer Fremdanbieter-Domain; der geplante Cutover erzwingt danach ein NEUES Plugin mit vollem Scan, Review und Publikation - die erreichte Publikation ist verloren. Die Entscheidung ist keine Codeaenderung, geht aber P0-2 voraus: eine Challenge-Route, die vor der Entscheidung gebaut wird, sitzt moeglicherweise auf dem falschen Host.
- **Kategorie:** A (T-32 ist ein woertliches Zitat; `18-...` PP-D18-04 fuehrt den Punkt als P0/A), Entscheidung ausserhalb des Codes.

### P0-12 Origin-Pruefung auf `/mcp` fehlt vollstaendig - Kategorie B

- **Was fehlt:** eine Pruefung des `Origin`-Headers am `/mcp`-Endpunkt.
- **Beleg:** `src/routes/mcp.js:113` instanziiert `StreamableHTTPServerTransport` ohne `allowedOrigins`/`allowedHosts`/`enableDnsRebindingProtection`; der SDK-Default ist aus (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js:70`, Pruefung uebersprungen `:109`). Die generische Herkunftswache des Gateways ist nicht vor `/mcp` geschaltet (`src/middleware.js:93`, nur `src/self-service-routes.js:1014`); der Kommentar `src/middleware.js:67-69` begruendet das mit Aufrufern, die KEINEN Origin senden - der Fall "vorhandener, falscher Origin" ist damit nicht abgedeckt (`01-protokoll-transport.md` PP-D1-04, dort P0/B).
- **Warum es hier steht und nicht unter Hardening:** T-06 der MCP-Spec ist ein MUSS ("Server MUSS den Origin-Header pruefen ... 403 Forbidden"). Die frueher an dieser Stelle notierte Begruendung "OpenAI prueft es nach eigener Doku nicht" war falsch: derselbe Teilbericht fuehrt genau diese Frage als offen ("unklar, ob das dort ueberhaupt geprueft wird oder erst bei einem MCP-Spec-Audit auffiele", `01-...` Offene Fragen). Ein UNKNOWN ueber das Verhalten des Pruefers senkt die Prioritaet einer unerfuellten Spec-Pflicht nicht - er kann sie nur nicht bestaetigen.
- **Kategorie:** B.

## Vor der Einreichung zu erledigen (P1)

Reihenfolge innerhalb der Gruppen ohne Bedeutung; jede Zeile mit Beleg.

**Werkzeug-Metadaten und -Beschreibungen**

- P1-1 `place_call` verspricht unbedingt eine sich selbst aktualisierende Live-Karte und "You do NOT need to poll" (`src/mcp-tools.js:529`), waehrend `src/ui/registry.js:23-33` am eigenen Code festhaelt, dass diese Karte bei einem echten ChatGPT-Host stumm bleibt. Bei aktivem Consult-Kanal steht derselbe Satz zusaetzlich im direkten Widerspruch zum angehaengten Poll-Gebot (`:543-547`, `:861-866`). Folge: der Anruf laeuft, das Ergebnis erreicht niemanden. (`03-...` PP-D3-01/PP-D3-06, dort P0/B - hier P1, weil es kein Einreichungs-Hindernis ist, sondern ein Produktdefekt im Zielclient; N-13 `:87` verlangt allerdings, dass Beschreibungen das Verhalten exakt abbilden.) Kategorie A/B-Grenzfall, hier B.
- P1-2 `get_transcript` behauptet, das Roh-Transkript werde nicht aufbewahrt (`src/mcp-tools.js:1018`), waehrend das Feld `diagnostic` derselben Datei das Gegenteil sagt (`:818`, Traeger `src/diagnostic-retention.js`). Falsche Datenschutzauskunft, vom Host woertlich weitergereicht. Kategorie B.
- P1-3 `place_call` nennt die minutengenaue Geldbuchung nicht (`src/billing/metering.js:126` -> `src/store/state-ops.js:4105`) und sagt nicht, dass am anderen Ende ein realer, nicht einwilligender Mensch sitzt (`03-...` PP-D3-03/04). Kategorie C.
- P1-4 `securitySchemes` fehlt an allen Werkzeugen (`grep` = 0 Treffer). T-15 (`:48`) verlangt es fuer Mixed Auth. **Einschraenkung der Gegenpruefung:** das installierte SDK kennt das Feld selbst nicht (`grep` in `node_modules/@modelcontextprotocol/sdk/dist/esm/` = 0, Version 1.29.0) - das ist eine SDK-Versionsluecke, kein Weglassen im Repo-Code. `package.json:49` deklariert `^1.12.0`, also eine Caret-Range und keine Pinnung (s. den SDK-Punkt unter Hardening). Kategorie A.
- P1-5 `cancel_call` und `list_action_items` laufen ueber den Legacy-`tool()`-Pfad ohne `outputSchema` (`src/mcp-tools.js:1057-1062`, `:1149`); `cancel_call` reicht den REST-Body ungefiltert durch (`:1061`). Heute folgenlos (Route baut ein kleines Objekt, `src/routes/api-calls.js:642-697`, byte-gepinnt in `test/el-beende-versuch.test.js:411-429`), aber die einzige Stelle ohne eigene Whitelist. Kategorie B.
- P1-6 `list_action_items` gibt eine interne Item-ID aus, die kein Werkzeug entgegennimmt (`src/mcp-tools.js:1158`); das Nachbarmodul vermeidet genau das mit ausgeschriebener Begruendung (`src/store/state-ops.js:800-802`). O-13 (`:108`) verbietet interne Identifikatoren in Antworten. Kategorie A.
- P1-7 `check_inbox` spreadet die REST-Antwort (`src/mcp-tools.js:457-460`, `...rest`), und der einzige Strukturtest vergleicht relativ zur Quelle (`test/inbox-mcp-tool.test.js:165-168`) - ein neues Feld in `inboxEntryView` erreicht den Client, ohne dass ein Test rot wird. Kategorie B.
- P1-8 `outputSchema` filtert nicht: das SDK validiert und verwirft das Parse-Ergebnis (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:185-206`), der Handler-Rueckgabewert geht unveraendert raus (`:132-133`). Kommentare wie "Stufe 0 schema-validiert" (`src/mcp-tools.js:175`, `:227`, `:375`) suggerieren eine Schranke, die nicht existiert. Kategorie B.
- P1-9 `get_transcript` antwortet auf dem haeufigsten Fehlbedienungspfad (Transkript waehrend des laufenden Anrufs, `src/mcp-tools.js:1024`) ohne `structuredContent`, obwohl es `outputSchema` deklariert - das SDK wirft und liefert den internen Validierungstext statt des lokalisierten Hinweises (`mcp.js:196-199`, `:141`). Kein Test faengt es, weil die Tests einen Fake-Server ohne SDK-Validierung nutzen (`test/mcp-tools-language.test.js:32-44`). Kategorie B.

**Auth und Autorisierung**

- P1-10 401-Antworten tragen nur im `oauth`-Modus eine Challenge: `deny401` (`src/auth.js:66-72`) wird ausschliesslich aus `verifyOauth` gerufen (`:78`, `:90`), die drei anderen 401-Ausgaenge (`:103`, `:110`, `:114`) antworten nackt. T-13 (`:46`)/A-04 verlangen `WWW-Authenticate` mit Verweis auf die Protected-Resource-Metadata. Kategorie A.
- P1-11 `_meta["mcp/www_authenticate"]` fehlt ganz (`grep` ausserhalb `src/auth.js` = 0); Fehlerergebnisse tragen nur `isError` + Text (`src/mcp-tools.js:84`). T-14 (`:47`) nennt das als einzigen Weg, im Gespraech eine Re-Authentifizierung auszuloesen. Kategorie A.
- P1-12 Ein gueltiges Token ohne Tenant-Zuordnung endet als HTTP 200 mit `isError` statt als 403 (`src/routes/mcp.js:61` nutzt `requestTenant`, der 403-Pfad liegt nur in `requireTenant`, `src/routes/_tenant.js:180-187`); lesende Werkzeuge liefern sogar HTTP 200 mit leeren Listen (`src/routes/api-read.js:62-70`). A-14 verlangt 403 fuer "authentifiziert, aber nicht berechtigt"; `PLAN-SECURITY.md:2064-2065` fuehrt die Luecke bereits. Kategorie B.
- P1-13 Keine Scopes: kein `scope`-Claim wird gelesen, kein `scopes_supported`, kein `insufficient_scope` (`grep` ueber `src/` = 0; `src/auth.js:86` uebernimmt `{sub, email, claims}`). Lesen und kostenwirksames Anrufen haengen am selben Token; die einzige Achse ist das Tenant-Rechteprofil (`src/routes/mcp.js:76` -> `src/store/defaults.js:1086-1089`). A-15/A-16 fordern Least Privilege und eine Scope-Challenge. Kategorie B.
- P1-14 Kein Widerruf: kein Introspection-/Revocation-Aufruf, und der MCP-Pfad prueft keinen Tenant-Status (`src/store/state-ops.js:5288-5298` liest nur den sub-Index). **Praezisierung der Gegenpruefung:** der kostenwirksame Anruf eines gesperrten Tenants wird sehr wohl abgewiesen (`store.tenantInactive` in `src/telephony/outbound-gates.js:413`); offen bleiben die LESENDEN Werkzeuge (Transkripte, Inbox) bis `exp`. Kategorie B.
- P1-15 `MCP_AUTH` akzeptiert jeden Wert: `src/config.js:1975` liest `(process.env.MCP_AUTH || "").toLowerCase()` ohne `trim()`, ohne Enum, ohne Validierung; verglichen wird nur gegen drei Literale (`src/auth.js:96`, `:97`, `:108`). Jeder Tippfehler faellt still in den statischen Bearer-Zweig (`:100-103`), und `MCP_AUTH_TOKEN` ist in Produktion per `render.yaml:357-358` immer gesetzt. Kategorie B.
- P1-16 `verifyOauth` prueft keine Pflichtclaims, keinen Token-Typ und keine Algorithmus-Allowlist (`src/auth.js:81-85`: nur `issuer`, `audience`, `clockTolerance: 30`). Ein ID-Token derselben Umgebung mit passender `aud` passiert. Kategorie B.
- P1-17 `OAUTH_AUDIENCE` ist ein freier String ohne jede Pruefung (`src/config.js:1980`) und speist beides: `jwtVerify` (`src/auth.js:83`) und `PRM.resource` (`:123`). Auf einen nicht-kanonischen Wert gesetzt (z.B. die geteilte WorkOS-`client_id`, `src/config.js:1990-1992`), akzeptiert `/mcp` jedes Token derselben Umgebung. Kategorie B.
- P1-18 Der live wirksame Auth-Modus ist nicht abgesichert: `render.yaml:353-354` traegt `MCP_AUTH: value: ""`, die einzige Live-Aussage ist eine Messnotiz (`PLAN-SECURITY.md:2052-2060`, inklusive des dort selbst notierten "keine Boot-Sonde dafuer"); `src/config.js:2344-2369` prueft nur `off`, kein Guard erkennt einen Ruecksprung AUS `oauth`. Kategorie B.
- P1-19 Keine Audit-Spur fuer eine ERFOLGREICHE MCP-Authentifizierung: `src/auth.js` auditiert nur Fehlversuche (`:77`, `:89`, `:102`, `:113`); der dauerhafte Trail (`src/durable-audit.js:20`) wird auf diesem Pfad nicht gerufen. Kategorie B.
- P1-20 Postgres-RLS ist keine Anfrage-Grenze (`src/store/pg.js:974-984`, `:200`, `:210`) - die Dokumentation muss das klarstellen, weil sonst aus "RLS aktiv" falsch auf "mandantengetrennt" geschlossen wird. Kategorie B.
- P1-21 Die Anbieter-Werkzeug-Webhooks binden Sitzungen ueber ein global geteiltes Geheimnis; der abgeleitete Mandanten-Token DARF fehlen (`src/routes/webhooks-elevenlabs.js:216-221`, Default `false` in `src/config.js:787-791`). Wer das Plattform-Geheimnis und eine aktive `conversation_id` hat, wirkt in ein fremdes laufendes Gespraech und bucht auf dessen Mandanten (`:282`, `:344`). Der starke Mechanismus existiert (`call.streamToken`, `src/routes/webhooks-elevenlabs-init.js:158-168`), wird hier aber nicht benutzt. Kategorie B.

**Reale Aussenwirkung**

- P1-22 Stundenlimit und Pro-Ziel-Cap sind TOCTOU-behaftet: reine Reads ohne Lock (`src/telephony/outbound-gates.js:364-378`), der zaehlbare Datensatz entsteht erst `src/routes/api-calls.js:439`, und davor liegt ein awaited Netzaufruf (`:428`). Parallele Aufrufe passieren alle. Kategorie B.
- P1-23 Das Rate-Limit keyt ausschliesslich auf `req.ip` (`src/middleware.js:157-168`); `_meta["openai/subject"]`, das OpenAI ausdruecklich fuer Rate-Limiting liefert (T-28, `:61`), wird nirgends gelesen (`rg "openai/subject" src/` = 1 Kommentar in `src/ui/ports.js:18`). Bei einem gehosteten Connector ist das ein gemeinsamer Eimer fuer alle Nutzer. Kategorie A.
- P1-24 Keine Obergrenze fuer gleichzeitige Anrufe eines Tenants: kein Nebenlaeufigkeits-Glied in der Kette, `activeCallsFor` hat genau einen Leser und der rechnet Geld, nicht Anzahl (`src/budget-gate.js:22`). Kategorie C.
- P1-25 Die Antwort verschweigt die serverseitig normalisierte Zielnummer und die Absender-DID (`src/telephony/outbound-gates.js:705-720`, `:840-860`; `CALL_OUTPUT` in `src/mcp-tools.js:177-183`, `:322-327`). Weder Modell noch Nutzer sehen, welche E.164-Nummer wirklich gewaehlt wurde. Kategorie B.
- P1-26 Kein serverseitiger Bestaetigungsschritt fuer den ersten Anruf an ein unbekanntes Ziel; kein Vorschau-Modus, keine Elicitation (`rg "elicit" src/` = 0). N-10 (`:84`) verlangt "Require confirmation for consequential write actions" und sagt ausdruecklich, dass Annotationen die serverseitige Bestaetigung nicht ersetzen. Kategorie A.
- P1-27 `cancel_call` sichert den Leitungsabbruch nicht zu (`src/routes/api-calls.js:690-696`, `line_hangup_confirmed: false`); der bindende harte Deckel auf dem EL-Weg ist der Anbieter-Deckel 600 s (`src/elevenlabs/outbound.js:174`, `:207-210`), nicht die 1800 s aus `src/store/defaults.js:390`. Kategorie B.
- P1-28 `answer_consult` ist ein extern wirksames Werkzeug, nicht hausintern: der Modell-Text geht als Werkzeug-Ergebnis an den Anbieter zurueck (`src/routes/webhooks-elevenlabs.js:99-103`, `:110-116`) und wird dem Dritten am Telefon vorgesprochen. Ohne Annotation, ohne Bestaetigung, ohne Vorschau. N-3/N-4/N-9 (`:77`, `:78`, `:83`). Kategorie A.

**Consult und Fremdtext**

- P1-29 Der Zitat-Riegel der Rueckfrage laeuft auf dem live betriebenen EL-Weg ins Leere: `containsVerbatimQuote` gibt ohne `caller`-Zeilen `false` zurueck (`src/utils/text.js:57-60`), und Transkriptzeilen entstehen dort erst nach Gespraechsende (`src/elevenlabs/outbound.js:1075` in `persistProviderResult`). Der Dateikopf nennt den Ausgang selbst "fail-OPEN, ohne Fehler, ohne Warnung" (`src/conversation/consult-raised.js:270-276`). Restschutz: `stripQuotedSpans` und 200 Zeichen. Derselbe tote Riegel sitzt im Schwester-Egress zu Exa (`src/research/lookup-guard.js:74`). Kategorie B.
- P1-30 Tor-Divergenz: `consultAllowedForCall` (`src/consult/gate.js:41-43`) prueft `inCallConsultEnabled` NICHT, der annehmende Webhook verlangt es (`src/routes/webhooks-elevenlabs.js:425-431`). Bei `CONSULT_ENABLED=true` + `IN_CALL_CONSULT_ENABLED=false` kuendigt der Agent eine Rueckfrage an und bekommt 404 mitten im bezahlten Gespraech. Der Gate-Kommentar verbietet genau diese zweite Formulierung (`src/consult/gate.js:27-34`). **Korrektur der Evidenz durch die Gegenpruefung:** der Werkzeugsatz haengt nicht daran, weil `outboundAgentConfigFor` repo-weit keinen Laufzeit-Aufrufer hat (`src/conversation/elevenlabs-agent-config.js:123`) - live entscheidet allein die dynamische Variable `consult_available` (`src/elevenlabs/outbound.js:947`). Kategorie B.
- P1-31 Die gate-abhaengige Prompt-/Werkzeugfassung des EL-Agenten ist toter Code; der gepushte Agent traegt `get_consult` statisch (`elevenlabs/agent_configs/outbound-agent.template.json`, `.tools.get_consult`), einziger Riegel ist eine Prompt-Zeile. Kategorie B.
- P1-32 Keine MCP-Antwort markiert fremd-stammenden Text als nicht vertrauenswuerdig (`src/mcp-tools.js:169-171`, `:211`, `:409`, `:468-471`); `grep` nach "untrusted"/"never instructions" trifft ausschliesslich `src/i18n/prompts/en.js:382`. `check_inbox` fordert den Host sogar auf, daraus "what to do now" zu lesen (`src/mcp-tools.js:481-485`), waehrend `place_call` im Werkzeugsatz liegt. Kategorie C.
- P1-33 Die Per-Tenant-Einstellungen `allowPersonalData`/`allowBankData` werden nur im Budget-Prompt gelesen (`src/claude.js:231-232`) und in der Berechtigungsanzeige (`src/mcp-tools.js:351-352`) - auf dem ElevenLabs-Weg reisen sie nicht mit (`src/elevenlabs/outbound.js:936-983`). Dass eine Weitergabe-Grenze als dynamische Variable reisen KANN, belegt `mandateText` (`:622-627`). Kategorie B.
- P1-34 Kein Redaction-Schritt fuer Hochrisiko-Inhalte aus dem Gespraech (`grep` findet nur die Log-Maske `src/util.js:17,25` und `src/self-service-routes.js:138`). Ein am Telefon diktierter Code oder eine Kartennummer landet im Transkript und in der Zusammenfassung, die den Transkript-Purge (`src/telephony/call-finish.js:337`) ueberlebt - und in Inbox, `list_calls`, Mail und SMS. **Teilkorrektur der Gegenpruefung:** die Zusammenfassung ueberdauert nicht unbegrenzt, der ganze Datensatz faellt nach `RETENTION_DAYS` (Default 30, `src/config.js:1939`, `src/store/state-ops.js:5101-5112`); der Mail-/SMS-Abfluss bleibt davon unberuehrt. Kategorie C.
- P1-35 Der HINTERGRUND-Block trennt Suchtreffer nicht von Auftraggeber-Angaben: `addLookupFacts` (`src/store/state-ops.js:1399-1407`) und `answerConsult` (`:1372-1393`) schreiben in DASSELBE `call.context.key_facts` mit demselben Deckel, gerendert als eine Zeile (`src/claude.js:365-366`); der Rahmen `lookUpFactsFrame` wirkt nur im Werkzeug-Ergebnis des EL-Wegs. Kategorie C.
- P1-36 `take_message` ist eine zweite, UNGEDECKELTE Tuer in den Systemprompt: `src/claude.js:679` schreibt `input.message` ungeprueft ueber `store.addActionItem` (`src/store/state-ops.js:1862-1876`, keine Laengenpruefung), derselbe Text rendert im selben Anruf zurueck (`src/claude.js:344`, `:395-402`) und reist unmarkiert an den Host (`src/mcp-tools.js:1149-1162`). Kategorie C.
- P1-37 Der OUTBOUND-Anrufstart prueft host-gelieferten Freitext nicht auf Platzhalter-Injektion: `src/elevenlabs/outbound.js:953-958` reicht `objective`/`constraints`/`background`/`mandate`/`callee` ungeprueft durch, waehrend der Inbound-Weg jede Variable auf `{{` prueft und fail-closed abbricht (`src/elevenlabs/inbound-initiation.js:191-201`, `:220-228`). Der `tenant_token` liegt in derselben Variablen-Karte (`src/elevenlabs/outbound.js:981`). Ob der Anbieter rekursiv aufloest: UNKNOWN. Kategorie B.
- P1-38 Freitextfelder landen als reine Label-Zeilen ohne Struktur-Trennzeichen im System-Prompt (`src/claude.js:139-142`); `_validation.js` prueft nur Laenge, Kontrollzeichen sind fuer `briefing`/`constraints` bewusst erlaubt (`src/routes/_validation.js:79-92`). Einzige hart codierte Schranke bleibt der Offenlegungssatz. Kategorie B.

**Daten, Aufbewahrung, Loeschung**

- P1-39 Die Policy behauptet eine "vollstaendige Loeschung deiner Anruf- und Kontodaten" (`apps/web/src/data/legal/privacy.de.json:54`), der einzige Loeschweg ist ein CLI-Skript, das nach eigenem Kommentar Settings/Profile/Nummern/Kalender/Usage stehen laesst (`scripts/erase-tenant.js:1-9`, `src/store/state-ops.js:527-560`); `TENANT_STATUS.CLOSED` wird nirgends in `src/` geschrieben, es gibt keinen Netz-Endpunkt und keinen Audit-Eintrag. O-6 (`:101`). **Ergaenzung, weil sich der Satz sonst als "es gibt keinen Datenzugang" liest:** ein Export-Endpunkt EXISTIERT und ist tenant-gescoped - `GET /api/tenant-data/export` (`src/routes/api-read.js:119-123`, `internalOnly` + `requireTenant`, Audit-Eintrag `data_export` `:122`), dieselbe Quelle nutzt der Self-Service-Pfad (`src/self-service-routes.js:370`). Er ist aber laut Gegenpruefung nur ein TEIL-Export: dieselbe Call-/Transkript-/ActionItem-Teilmenge wie das Erase, ohne Settings, Profil, KYC und Stripe-Referenzen (`13-...` PP-D13-09, dort P2/C). Die oben fehlende Netz-Route und der fehlende Audit-Eintrag betreffen ausschliesslich die LOESCHUNG; der Code sagt das selbst (`src/routes/api-read.js:115-118`: "Die Loeschung (Art. 17) hat KEINEN Endpunkt - nur Script"). Kategorie A.
- P1-40 Vertragsende loest Nummernfreigabe und WorkOS-Loeschung aus, aber keine Datenloeschung (`src/billing/contract-end-cleanup.js:66-108` ruft `store.eraseTenantData` nicht; `src/release-reconcile.js:222` beschreibt die Komposition als noch nicht gebaut). Kategorie B.
- P1-41 Konto-/Abrechnungs-Stammdaten haben keine Frist (`src/db/schema.sql:13-160`, kein Retention-Bezug; `pruneOldData` deckt nur Calls/Notifications/ActionItems/Diagnose/Evidenz ab). Die Policy-Frist "Vertragsdauer" wird damit nie vollzogen. Kategorie B.

**Betrieb und Tests**

- P1-42 Der Dienst ist explizit nur fuer Single-Instance-Betrieb korrekt (`reattach.js:38`, `webhook-idempotenz.js:120` prozesslokale Maps; `PLAN-SECURITY.md:56`, `:3319-3320`, `:4309`). Ein Rolling-Deploy mit zwei Instanzen bricht mehrere Idempotenz-Garantien genau dort, wo sie zaehlen. Kategorie C.
- P1-43 Kein Test ruft `tools/list` real gegen `/mcp` (`grep -rn "tools/list" test/*.test.js` trifft nur Kommentare und eine Label-Funktion; `test/helpers.js:1297` baut nur `tools/call`). Der ausgelieferte Werkzeugkatalog - das Erste, was ein Host sieht - ist e2e unverifiziert. **Divergenz zum Teilbericht, hier offengelegt:** `15-testabdeckung.md` PP-D15-02 fuehrt den Punkt als P0/A (W-02/W-07 der MCP-Spec als Pflicht); hier P1, weil der ausgelieferte Katalog am Code lesbar ist und ein fehlender Test die Einreichung formal nicht verhindert. Die Einstufung des Teilberichts ist die strengere und bleibt bestehen. Kategorie B.
- P1-44 Fast alle `tools/call`-Tests laufen gegen `registerTools(fakeServer, ctx)` statt den echten SDK-Transport; echte `mcpPost`-Tests existieren nur fuer vier Lesewerkzeuge (`test/am6-oauth-tenant.test.js:40`, `test/mcp-tools-i18n.test.js:209-210`, `test/mcp-tools-language.test.js:305`, `test/inbox-mcp-tool.test.js:300-318`). Kategorie B.
- P1-45 Kein Test deckt Prompt-Injection aus dem Gespraechsinhalt ab (`grep -rln "injection" test/*.test.js` trifft nur Lookup-Guard und Widget-Template-Injection) und keiner die Idempotenz eines doppelten `place_call` (`test/outbound-per-target-cap.test.js:24` ist ein Rate-Limit, die ersten drei Anrufe gehen real raus). **Divergenz zum Teilbericht, hier offengelegt:** PP-D15-18 fuehrt die fehlende Injektions-Abdeckung als P0/B; hier P1, weil kein fehlender Test fuer sich einen Dritten erreicht - der inhaltliche Befund steht als P1-32, P1-36 und P1-37 am Code. Die Einstufung des Teilberichts bleibt die strengere. Kategorie B.
- P1-46 Keine systematischen Negativ-Tests fuer verletzte Pflichtfelder je Werkzeug (`test/place-call-context-bridge.test.js:96` pinnt nur die Schema-Struktur). Kategorie B.
- P1-47 Der Fehlertext-Fallback `err?.message` (`src/mcp-tools.js:640`) uebernimmt `json.error` der REST-Antwort; eine vollstaendige Inventur aller `res.status(...).json({error: ...})`-Stellen unter `src/routes/` wurde nicht gefahren (Stichproben zeigen Disziplin, z.B. `src/routes/api-calls.js:550-569`). Kategorie B.
- P1-48 Secret-Historie nur musterbasiert geprueft (2578 Commits, keine Treffer) - generische Hex-Secrets ohne Praefix waeren so nicht gefunden worden; ein entropie-basierter Scanner ist nicht gelaufen (`12-secrets-logging.md` PP-D12-03). Kategorie C.
- P1-49 Telnyx-Least-Privilege und Umgebungstrennung sind in `PLAN-SECURITY.md:1109` offen (`- [ ]`). Kategorie C.
- P1-50 Der ChatGPT-Adapterpfad ist im eigenen Code als unvollstaendig dokumentiert, und der von OpenAI dokumentierte `ui/initialize`-Handshake (`protocolVersion: "2026-01-26"`, X-5) fehlt (`grep "ui/initialize" src/ui/*` = 0). Bei einer Einreichung MIT UI kommen T-30/T-31 (`_meta.ui.csp`, `_meta.ui.domain`) hinzu: beide fehlen vollstaendig (`grep` nach `ui.csp`, `ui.domain`, `connectDomains`, `resourceDomains` in `src/` = 0; gesetzt sind nur `resourceUri` und `outputTemplate`, `src/ui/adapters/mcp-native.js:9-13`, `src/ui/adapters/chatgpt.js:6-10`). Betroffen sind die 5 registrierten `ui://hermes/*`-Resources (`src/ui/contract.js:60-77`, gerufen aus `src/mcp-tools.js:620`); `17-resources-flaeche.md` PP-D17-06 fuehrt das als P1/A, weil T-30/T-31 dort selbst Kategorie A tragen - ob sie auch fuer einen reinen Developer-Mode-Connector gelten, ist in `00-openai-anforderungen.md` selbst nicht getrennt (offene Frage dort). Kategorie B, fuer T-30/T-31 A.

## Hardening (P2)

Jede Zeile traegt wie in P0 und P1 ihre Kategorie: A = belegte OpenAI-Pflicht mit Zitat, B = folgt zwingend aus Protokoll oder Sicherheitsarchitektur, C = Empfehlung. Die frueher hier gefuehrte fehlende Origin-Pruefung steht jetzt als P0-12 - ihre alte Begruendung ("OpenAI prueft es nicht") war ein UNKNOWN, kein Beleg.
- Unbekannte Werkzeuge und ungueltige Parameter kommen als `isError` statt JSON-RPC `-32602` (`mcp.js:99-138`) - SDK-Verhalten, kein Hermes-Code; W-14 der MCP-Spec. Kategorie B.
- Die gelesene SDK-Linie 1.29.0 spricht maximal `2025-11-25` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:2-4`); ein reiner Modern-Client (2026-07-28) scheitert. `package.json:49` traegt `^1.12.0` - eine Caret-Range, KEINE Pinnung: jede 1.x-Minor ist zulaessig. Die Version 1.29.0 ist damit nur fuer den lokal installierten Baum belegt (`node_modules/@modelcontextprotocol/sdk/package.json`), nicht zwingend fuer den Deploy: `package-lock.json` fuehrt 1.29.0, aber der Wurzel-Build laeuft mit `npm install` und nicht mit `npm ci` (`render.yaml:22`), waehrend nur `apps/web` `ci` nutzt (`render.yaml:22`, `:704`). Die Protokoll-Aussage aus `01-...` PP-D1-01 gilt deshalb fuer den gelesenen Baum, nicht nachweisbar fuer die laufende Instanz. Fuer OpenAI heute folgenlos (keine Mindestversion dokumentiert). Kategorie B.
- Laengen-Caps fehlen auf Schema-Ebene (`objective`/`briefing`/`constraints`/`key_facts`/`open_questions`, `src/mcp-tools.js:670-819`); serverseitig gedeckelt in `src/routes/_validation.js:26-46` und ueber das 100kb-Body-Limit (`src/app.js:62`). Kategorie C (N-14 verlangt minimale Eingaben, nicht Caps im Schema).
- `language` ist Freitext statt Enum, obwohl der Katalog als Array vorliegt (`src/mcp-tools.js:784-793`). Kategorie C.
- `call_id`/`event_id` roh in die interne URL interpoliert (`src/mcp-tools.js:880`, `:882`, `:934`, `:971`, `:1023`, `:1061`), waehrend `after_event_id` im selben Ausdruck kodiert wird (`:879`). Kategorie B.
- `call_id` aus `Date.now` plus vier `Math.random`-Zeichen (`src/store/state-ops.js:195-197`), obwohl `crypto.randomBytes` vier Zeilen entfernt benutzt wird (`:270`). Gegenpruefung: Enumeration bringt in keiner Konfiguration einen Gewinn. Kategorie B.
- `get_agent_status` liefert exakte LLM-Modell-Kennung und Voice-Engine an den Host (`src/config.js:523` -> `src/mcp-tools.js:365-366`); Budget-Ablehnungstexte tragen EUR-Werte in die MCP-Antwort (`src/i18n/gate-texts.js:43-50`), waehrend `/api/state` sie ausdruecklich entfernt (`src/routes/api-read.js:24-34`). Kategorie C (Betreiber-Interna und Geldbetraege, keine internen Identifikatoren im Sinne von O-13).
- `get_call_status` liefert sechs wortwoertliche Transkriptzeilen (`src/mcp-tools.js:169-172`), waehrend `get_transcript` dem Modell Minimierung zusagt. Kategorie C (der Beschreibungs-Widerspruch selbst ist P1-2).
- `get_agent_status.permissions` ist zusammengesetzter Freitext statt drei Bool-Felder (`src/mcp-tools.js:349-354`, `:385`). Kategorie C.
- `answer_consult` markiert HTTP 400/409 nicht als `isError` (`src/mcp-tools.js:950-960`) - bewusste Abweichung, nur im Kommentar dokumentiert. Kategorie B (T-20).
- `title` fehlt an allen Werkzeugen (W-07/W-09 der MCP-Spec); `get_my_number` ist ohne Beschreibung mehrdeutig (`src/mcp-tools.js:1069`). Kategorie B.
- Kein Readiness-Check: `/healthz` liefert `{ok, commit, configHash}` ohne Dependency-Pruefung (`src/app.js:155-157`), kein `/readyz`. Kategorie C.
- Kein env-gesteuertes Log-Level (`src/config.js` ohne `LOG_LEVEL`); Prod-Verbosity gleich Dev-Verbosity. Kategorie C.
- Kein dedizierter Log-Redactor; Schutz beruht auf Whitelisting an der Quelle (`src/metrics.js:1-4`, `:22-28`) ohne technischen Regressionsschutz. Kategorie C.
- Secret-Rotation ist ein manuelles Runbook ohne Durchsetzung (`PLAN-SECURITY.md:1117-1143`). Kategorie C.
- `npm audit --omit=dev`: 2 moderate Findings via `qs`/`express`, `fixAvailable: true` (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g). Kategorie C.
- TLS zur Datenbank haengt allein am `sslmode` in der `DATABASE_URL` (`src/portal-pool.js:52` ohne `ssl:`-Objekt). Kategorie B.
- Die Geld-Reserve kann bei einem Abbruch zwischen Reservierung (`src/telephony/outbound-gates.js:935-958`) und `createCall` (`src/routes/api-calls.js:439`) dauerhaft stehen bleiben und kuenftige legitime Anrufe mit 402 abweisen (`src/store/state-ops.js:4465-4470`). Kategorie B.
- `consults[].questions` und die aus einer Antwort stammenden `key_facts` haben keinen eigenen kurzen Aufbewahrungs-Durchgang, anders als die woertlichen Zitate (`src/store/state-ops.js:5145-5160`). Kategorie C.
- Die Diagnose-Sonderfrist (7 Tage, Eigenanrufe) ist in der Datenschutzerklaerung nicht als eigene Speicherdauer genannt (`13-...` PP-D13-13). Kategorie A (O-6 verlangt die Aufbewahrungsfristen in der veroeffentlichten Policy).
- `get_consult` fehlt `calleeIsOwner` auf dem Budget-Weg (`src/consult/in-call.js:87-97`), die Tor-Bedingung ist dort zum zweiten Mal ausgeschrieben. Kategorie B.
- Die Server-Instruktionen versprechen dem Host die In-Call-Schleife ohne `IN_CALL_CONSULT_ENABLED` (`src/routes/mcp.js:91`, `src/mcp-server-info.js:84-104`). Kategorie C.
- Stufe 0/1 der EL-Consult-Fristen sind laut Code ausdruecklich vorlaeufig und unvermessen (`src/config.js:1640-1643`). Kategorie C.
- Keine Anomalie-Erkennung; der Hebel (Operator-Sperre) existiert bereits (`src/web-auth.js:924`), die Erkennung fehlt. Kategorie C.
- CORS-Header existieren nirgends (`grep "cors\|Access-Control" src/` = 0); fuer einen Server-zu-Server-Client wahrscheinlich irrelevant, am Repo nicht abschliessend beurteilbar (T-29). Kategorie C (T-29 ist dort selbst Kategorie C).
- Kein separater Staging-Endpunkt fuer `/mcp` (`render.yaml` kennt nur `vodafone-agent`), jeder Review-Test laeuft gegen Produktion. Kategorie C.
- `GATEWAY_URL` ist in `.env.example`/`render.yaml` nicht dokumentiert (`src/config.js:2307-2311`), falsch gesetzt ein Exfiltrationspfad fuer die internen Identitaets-Header. Kategorie B.
- Der stdio-MCP-Pfad hat keine Authentifizierung und laeuft mit `OWNER_PROFILE` (`src/mcp-server.js:26-28` -> `src/store/defaults.js:1056-1065`); bewusste Single-Operator-Annahme (`PLAN-SECURITY.md:2046-2049`), aber nicht im Auth-Inventar gefuehrt. Kategorie B.
- `GET /api/billing/checkout-return` steht hinter `internalOnly`, wird aber vom Kundenbrowser aufgerufen (`src/routes/api-billing.js:105`, `:214`) - toter Geldpfad, dessen Reparatur gefaehrlich waere. Kategorie C.
- `check_inbox` konsumiert; der Rueckweg `include_seen` existiert (`src/routes/api-inbox.js:45-49`), die Beschreibung nennt ihn nicht als Wiederherstellungsweg. Kategorie C.
- Jeder `resources/read` liefert das komplette Widget-HTML inline, bis zu 246.398-247.563 Bytes beim `call`-Widget (live nachgemessen, `17-resources-flaeche.md` PP-D17-05); Ursache ist ein ~170-KB-PNG als Data-URI, das in alle 5 Widgets einkopiert wird (`src/ui/wing-image-data.js:8`, eingebunden `src/ui/widget-catalog.js:126-136`, Kommentar `:134` nennt die Groesse selbst). Keine harte Grenze verletzt, kein Datenrisiko - unnoetige Payload ohne Caching. Kategorie C.
- Kein Test sendet `resources/list` oder `resources/read` ueber die echte `/mcp`-Route: alle Treffer stubben den Server (`test/mcp-tools.test.js:35`, `test/mcp-ui.test.js:67`, `:517`), als String-Literal kommen die Methoden in `test/` nicht vor (`17-...` PP-D17-07). Dass `resources/*` dieselbe `mcpAuth`-Pruefung traegt wie `tools/*`, ist damit eine Code-Lese-Schlussfolgerung (`src/routes/mcp.js:51`, SDK-Dispatch `mcp.js:339-380`), kein Testbefund. Kategorie C.
- Die Resource-Menge ist in genau einer Dimension zustandsabhaengig: `WIDGET_CALENDAR` wird nur bei `allowCalendar` registriert (`src/mcp-tools.js:1170-1177`), sonst 4 statt 5 Resources - die Praesenz einer Resource ist damit ein schwacher Seitenkanal auf ein Tenant-Merkmal. Unter dem Default `MULTI_TENANT=false` (`src/config.js:1570`) kollabiert das Profil ohnehin auf den Bootstrap-Tenant und die Liste ist konstant (`17-...` PP-D17-02). Kategorie C.

## Tool-Matrix

"Annotation ist" ist fuer alle 12 Werkzeuge leer (`grep` = 0 Treffer, siehe P0-1); der Spec-Default ist damit `readOnly=false`, `destructive=true`, `openWorld=true` (`00-mcp-spec.md` N-01). "Auth" ist fuer alle identisch `mcpAuth` auf `POST /mcp` (`src/routes/mcp.js:52`); "Scope" existiert nirgends (P1-13).

| Tool | Zweck | liest/schreibt | reale Aussenwirkung | Auth | Scope | Annotation ist/soll | Datenschutz-Risiko | Status |
|---|---|---|---|---|---|---|---|---|
| `place_call` | startet einen echten Anruf mit Auftrag (`src/mcp-tools.js:666-822`) | schreibt (`POST /api/calls`, `:825`) | **ja**: realer Anruf an einen Dritten, minutengenaue Geldbuchung (`src/billing/metering.js:126`), nicht rueckholbar | mcpAuth + 18 Gates (`src/telephony/outbound-gates.js:656-965`) | keiner | keine / `readOnly=false, destructive=true, idempotent=false, openWorld=true` | hoch: `objective`/`briefing`/`context` gehen in den Prompt eines Gespraechs mit einem Dritten (`src/claude.js:139-142`) | FAIL (P0-1, P0-6, P1-1, P1-3, P1-25, P1-26) |
| `await_call_event` | Long-Poll auf Consult-/Abschluss-Ereignis (`:857-889`) | liest (Long-Poll + GET) | nein | mcpAuth, nur bei `consultAllowed` (`src/consult/gate.js:19-23`) | keiner | keine / `readOnly=true, openWorld=true` | mittel: liefert `questions` aus fremder Rede an den Host (P1-29) | PARTIAL |
| `answer_consult` | Antwort des Auftraggebers in ein laufendes Gespraech (`:891-963`) | schreibt (`:934`) | **ja**: der Text wird dem Dritten vorgesprochen (`src/routes/webhooks-elevenlabs.js:99-116`) | mcpAuth, nur bei `consultAllowed` | keiner | keine / `readOnly=false, destructive=false, idempotent=false, openWorld=true` | hoch: Kalender-/Mail-/Dateiinhalte koennen ausgesprochen werden (`src/mcp-server-info.js:94-96`) | FAIL (P0-1, P1-28) |
| `get_call_status` | Status, Dauer, letzte 6 Transkriptzeilen (`:998-1007`) | liest (`GET /api/calls/:id`) | nein | mcpAuth + `tenantOwnsCall` (`src/routes/api-read.js:105`, flagabhaengig) | keiner | keine / `readOnly=true, openWorld=true` | mittel: woertliche Rede des Dritten verlaesst den Dienst (`:169-172`) | PARTIAL |
| `get_transcript` | Zusammenfassung und Ergebniskarte, kein Rohtranskript (`:1014-1050`) | liest | nein | mcpAuth + Ownership | keiner | keine / `readOnly=true, openWorld=true` | mittel: Beschreibung sagt Minimierung zu, die nur fuer dieses Werkzeug gilt (P1-2) | PARTIAL |
| `cancel_call` | Abbruchversuch (`:1057-1062`) | schreibt | **ja** (versucht Leitungsabbruch, nicht zugesichert, `src/routes/api-calls.js:690-696`) | mcpAuth + `callVisibleTo` | keiner | keine / `readOnly=false, destructive=true, idempotent=true, openWorld=true` | niedrig, aber ungefilterte REST-Antwort (P1-5) | FAIL (P0-1, P1-5, P1-27) |
| `get_my_number` | DID des Agenten (`:1068-1087`) | liest (`GET /api/state`) | nein | mcpAuth | keiner | keine / `readOnly=true, openWorld=false` | niedrig (eigene Nummer) | PARTIAL |
| `list_calls` | Anrufliste mit Gegenstelle und Zusammenfassung (`:1095-1114`) | liest | nein | mcpAuth, Scoping flagabhaengig (`src/routes/api-read.js:70`) | keiner | keine / `readOnly=true, openWorld=false` | mittel: Rufnummern Dritter und Zusammenfassungen ohne Herkunftsmarkierung (P1-32) | PARTIAL |
| `check_inbox` | Eingangsliste, markiert Eintraege als gesehen (`:1125-1144`) | **schreibt** (`POST /api/inbox/poll`) | nein | mcpAuth | keiner | keine / `readOnly=false, idempotent=false, openWorld=false` | hoch: direktester Kanal von einem fremden Anrufer in den Host-Kontext (`:468-471`, P1-32) | FAIL (P0-1, P1-7) |
| `list_action_items` | offene Aufgaben als Text (`:1149-1162`) | liest | nein | mcpAuth | keiner | keine / `readOnly=true, openWorld=false` | mittel: interne Item-ID (P1-6), ungedeckelter Fremdtext (P1-36) | FAIL (P1-5, P1-6) |
| `get_calendar` | naechste Kalendereintraege (`:1170-1197`) | liest | nein | mcpAuth, nur bei `allowCalendar` (`src/plans.js:112`: fuer bezahlte Plaene `false`) | keiner | keine / `readOnly=true, openWorld=false` | mittel: Termine des Nutzers | PARTIAL |
| `get_agent_status` | Nummer, Engine, Modell, Nutzung, Rechte (`:1209-1238`) | liest | nein | mcpAuth | keiner | keine / `readOnly=true, openWorld=false` | niedrig fuer Nutzerdaten, aber Betreiber-Interna (Modellkennung, Engine) | PARTIAL |

Bedingte Registrierung: `await_call_event`/`answer_consult` nur bei `consultAllowed`, `get_calendar` nur bei `allowCalendar` (`src/mcp-tools.js:856`, `:1170`); `src/routes/mcp.js:105-112` steuert nur diese Flags, es gibt keinen nachtraeglichen Filter. Der stdio-Pfad hat immer `get_calendar` und nie das Consult-Paar (`src/mcp-server.js:26-28`).

## OAuth-Matrix

| Anforderung | Beleg im Code | Status |
|---|---|---|
| T-5 OAuth 2.1 nach MCP-Authorization-Spec bei privaten Daten | `src/auth.js:95-117` (`mcpAuth`, Modus `oauth`), `:75-88` (`verifyOauth`) | ERFUELLT |
| T-6 PRM unter `/.well-known/oauth-protected-resource` mit `resource` + `authorization_servers` | `src/auth.js:121-129` (`registerWellKnown`, beide Pfade), registriert `src/app.js:167`, oeffentlich gelistet `src/route-policy.js:86-95` | TEILWEISE: `authorization_servers` ist `[]` bei leerem Issuer (`src/auth.js:124`), verletzt A-03; nur in den Modi ohne OAuth erreichbar (`src/config.js:2421` macht `oauth` ohne Issuer boot-fatal) |
| T-7 AS-Metadata (`oauth-authorization-server` oder `openid-configuration`) | nur als Konsument gelesen (`src/auth.js:29-48`), nie ausgeliefert - der Dienst ist Resource Server | UNKNOWN (liegt beim IdP, siehe P0-8) |
| T-8 PKCE `S256` beworben | `grep code_challenge_methods_supported src/` = 0; der eigene Browser-Login kann S256 (`src/web-auth.js:411-419`), das ist nicht die ChatGPT-Registrierung | UNKNOWN (P0-8) |
| T-9 Resource Indicators, `resource` -> `aud` | Audience-Erwartung `src/auth.js:23` (`oauthAudience || <publicUrl>/mcp`), geprueft `:83`; ob der AS `resource` uebernimmt: nicht im Repo | UNKNOWN (P0-8), Risiko ueber `OAUTH_AUDIENCE` (P1-17) |
| T-10 CIMD bevorzugt, DCR unterstuetzt | `grep client_id_metadata_document_supported\|registration_endpoint src/` = 0 | UNKNOWN (P0-8) |
| T-11 Redirect-URI mit RFC-9207-`iss` | `grep authorization_response_iss_parameter_supported src/` = 0 | UNKNOWN (P0-8) |
| T-12 Serverseitige Token-Pruefung (Signatur/JWKS, `iss`, `exp`/`nbf`, Audience) | `src/auth.js:75-88` (`jwtVerify` gegen `createRemoteJWKSet`, `issuer`, `audience`, `clockTolerance: 30`); negativ getestet `test/oauth.test.js:57-73` | ERFUELLT, ohne Algorithmus-Allowlist und ohne `requiredClaims` (P1-16) |
| T-13 401 mit `WWW-Authenticate` auf die PRM | `src/auth.js:66-72` (`deny401`), gerufen nur aus `verifyOauth` (`:78`, `:90`); drei weitere 401 antworten nackt (`:103`, `:110`, `:114`) | TEILWEISE (P1-10) |
| T-14 `_meta["mcp/www_authenticate"]` im Fehlerergebnis | kein Treffer ausserhalb `src/auth.js`; `errText` baut `{content, isError}` ohne `_meta` (`src/mcp-tools.js:84`) | OFFEN (P1-11) |
| T-15 `securitySchemes` je Werkzeug | `grep securitySchemes src/ test/ apps/` = 0; das installierte SDK 1.29.0 kennt das Feld selbst nicht (`package.json:49` traegt `^1.12.0`, eine Caret-Range, keine Pinnung) | OFFEN (P1-4) |
| T-16 OIDC-Discovery + `openid`/`email` + UserInfo fuer Workspace-Restriktionen | Browser-Login nutzt WorkOS User Management (`src/config.js:1993`, `src/web-auth.js:406-407`); UserInfo-Endpunkt fuer den MCP-Kanal nicht belegt | UNKNOWN |
| T-17 OpenAI-managed mTLS (optional) | kein `mtls`-Bezug in `src/` oder `render.yaml`; TLS terminiert Render | N/A (Kategorie C) |
| A-02 Server ist Resource Server, nie Authorization Server | kein `/authorize`, kein `/token` im Repo (`src/auth.js:1-3`) | ERFUELLT |
| A-12 Nur eigene Tokens akzeptieren (Audience-Bindung) | `src/auth.js:23` + `:83`; Override-Pfad getestet `test/oauth.test.js:87-118` | ERFUELLT, aber `OAUTH_AUDIENCE` ungeprueft frei (P1-17) |
| A-13 Token im `Authorization`-Header, nie im Query | `src/auth.js:95` liest nur `req.headers.authorization` | ERFUELLT |
| A-14 401 vs. 403 korrekt getrennt | alle Auth-Fehler 401; "authentifiziert, aber kein Tenant" endet als HTTP 200 mit `isError` (`src/routes/mcp.js:61`, `src/routes/_tenant.js:180-187`) bzw. 200 mit leeren Listen (`src/routes/api-read.js:62-70`) | OFFEN (P1-12) |
| A-15/A-16 Scopes, Least Privilege, `insufficient_scope` | kein Scope-Konzept im Repo (`grep payload.scope\|scp\|scopes_supported\|insufficient_scope src/` = 0) | OFFEN (P1-13) |
| A-01/A-04 Pruefung pro Request, keine Sitzung | Middleware laeuft bei jedem POST (`src/routes/mcp.js:52`), Transport stateless (`:113`), kein Token-Cache (`src/auth.js:51-57`) | ERFUELLT |
| Widerruf/Invalidierung eines laufenden Zugriffs | kein `introspect`/`revoke`; Tenant-Status wird auf dem MCP-Pfad nicht geprueft (`src/store/state-ops.js:5288-5298`); Ausgangspfad prueft `tenantInactive` (`src/telephony/outbound-gates.js:413`) | TEILWEISE (P1-14) |
| Bypass-Pfade in Produktion geschlossen | Socket-Bypass nur ausserhalb Produktion (`src/auth.js:19-21`, getestet `test/auth-mcp-bypass.test.js:37-45`), `MCP_AUTH=off` boot-fatal (`src/config.js:2344-2347`, `:2546-2557`), interne Header nur ohne `X-Forwarded-For` (`src/routes/_tenant.js:34-44`) | ERFUELLT, ausser: unbekannter `MCP_AUTH`-Wert faellt still auf statisches Token (P1-15) und stdio ohne Auth (P2) |
| Timing-sicherer Vergleich | `src/auth.js:95` -> `src/util.js:5-9` (`crypto.timingSafeEqual`) | ERFUELLT |

## Datenschutz-Matrix

"geht an ChatGPT" heisst: erreicht ueber ein MCP-Werkzeug den Host. "geht an Dritte" heisst: verlaesst den Dienst Richtung Anbieter oder Angerufener.

| Datenart | erhoben | gespeichert | geht an ChatGPT | geht an Dritte | Aufbewahrung | Loeschung | Status |
|---|---|---|---|---|---|---|---|
| Zielrufnummer (E.164) | ja, aus dem Tool-Argument `to`, serverseitig normalisiert (`src/telephony/outbound-gates.js:705-720`) | ja, am Anruf-Datensatz (`src/db/schema.sql:211-393`) | nur nachtraeglich als `counterparty` in `list_calls` (`src/mcp-tools.js:412`), NICHT in der `place_call`-Antwort | ja, an den Telefonie-/Voice-Anbieter | `RETENTION_DAYS`, Default 30 (`src/config.js:1939`) | mit dem Datensatz (`src/store/state-ops.js:5101-5112`) | PARTIAL (P1-25) |
| Anrufernummer (inbound) | ja, aus dem Provider-Webhook | ja | ja, als `caller` in `check_inbox` (`src/store/state-ops.js:786-798`) | nein | wie Datensatz | wie Datensatz | PASS (zweckgebunden) |
| Eigene hinterlegte Nummer des Nutzers | ja, ueber `POST /api/self-service/private-number` (`src/self-service-routes.js:401`) | ja, Spalte `private_number` (`src/db/schema.sql:13-160`) | nein | ja, als SMS-Ziel (`src/sms-summary.js:25-58`) | unbegrenzt (keine Frist, P1-41) | einzige Spalte, die `eraseTenantData` loescht (`src/store/state-ops.js:527-560`) | PARTIAL (nicht eigentums-verifiziert, CLAUDE.md Launch-Blocker) |
| `objective`/`briefing`/`constraints`/`mandate` | ja, vom Host | ja, am Anruf | nein (nicht zurueckgegeben) | ja, in den Prompt des Voice-Agenten (`src/elevenlabs/outbound.js:953-958`), damit potenziell gesprochen (`09-...` A-4) | wie Datensatz | wie Datensatz | PARTIAL (P1-38, P1-37) |
| `context.key_facts` (Auftraggeber + Suchtreffer + Consult-Antworten, gemischt) | ja | ja (`src/store/state-ops.js:1325-1335`, `:1399-1407`) | nur als Zaehler `context_received` (`src/mcp-tools.js:825-836`) | ja, im HINTERGRUND-Block bzw. als Werkzeug-Ergebnis | wie Datensatz, kein eigener kurzer Durchgang | wie Datensatz | PARTIAL (P1-35) |
| Roh-Transkript | ja (ASR) | ja, `transcript_segment` (`src/db/schema.sql:552-561`) | nur die letzten 6 Zeilen ueber `get_call_status` (`src/mcp-tools.js:169-172`) | nein | Purge nach der Zusammenfassung (`src/telephony/call-finish.js:337`), Ausnahme Eigenanrufe 7 Tage (`src/diagnostic-retention.js:23-70`) | ja, `purgeTranscript` als einzige Mutationsquelle (`src/store/state-ops.js:512-515`) | PASS mit Beschreibungs-Widerspruch (P1-2) |
| Zusammenfassung (eigene oder Anbieter-Zusammenfassung) | ja | ja, `call.summary` (Anbieter-Text unveraendert, `src/elevenlabs/outbound.js:434-435`, `:1077`) | ja, `get_transcript`, `check_inbox`, `list_calls` | ja, per Mail und SMS | wie Datensatz (30 Tage) | wie Datensatz | PARTIAL (P1-34: keine Redaction; `09-...` PP-D9-G3) |
| Ergebniskarte / `evidence` (woertliche Zitate) | ja | ja, `result` JSONB | Karte ja (`src/call-result.js:94-103`), `evidence`/`facts` NEIN | nein | `EVIDENCE_RETENTION_DAYS`, Default 0 (`src/store/state-ops.js:5153-5160`) | eigener Durchgang | PASS |
| Action Items (aus `take_message`) | ja, ungekappt (`src/claude.js:679`) | ja, `action_item` (`src/db/schema.sql:564-573`) | ja, `list_action_items` + `check_inbox`, mit interner ID | nein | wie Datensatz | wie Datensatz | FAIL (P1-6, P1-36) |
| Consult-Fragen (aus fremder Rede formuliert) | ja | ja, `consults` JSONB (`src/store/state-ops.js:1276-1294`) | **ja**, das ist der Zweck (`src/consult/delivery.js:85-95`) | nein | wie Datensatz, kein kurzer Durchgang | wie Datensatz | PARTIAL (P1-29, P2-Retention) |
| Consult-Antworten (Kalender/Mail/Dateien des Nutzers) | ja, vom Host | ja, in `key_facts` | nein | **ja**, dem Angerufenen vorgesprochen | wie Datensatz | wie Datensatz | PARTIAL (P1-28) |
| Kalendereintraege | ja (Store) | ja, `calendar_event` (`src/db/schema.sql:576-583`) | ja, `get_calendar` | nein | keine Frist (`pruneOldData` deckt sie nicht ab) | nicht von `eraseTenantData` erfasst | PARTIAL (P1-39, P1-41) |
| Konto-/Login-Identitaet (E-Mail, WorkOS-`sub`) | ja | ja, `account`/`tenant` | nein (nur `owner` in `get_agent_status`) | WorkOS | keine Frist | NICHT geloescht (`scripts/erase-tenant.js:1-9`) | FAIL (P1-39) |
| KYC-Stufe, Stripe-Kunden-/Abo-IDs | ja | ja, `tenant` (`src/db/schema.sql:13-160`) | nein | Stripe | keine Frist | NICHT geloescht | FAIL (P1-39, P1-41) |
| Audit-Log | ja | ja, append-only, ohne FK und ohne RLS (`src/db/schema.sql:1010-1013`) | nein | nein | ueberdauert bewusst jede Tenant-Loeschung | bewusst nie | PASS (dokumentierte Ausnahme) |
| Betriebs-Logs (stdout) | ja | bei Render | nein | Render | UNKNOWN (Plattform-Einstellung) | UNKNOWN | UNKNOWN |
| Suchanfragen (Recherche) | ja, aus dem Gespraech | `lookup_log` JSONB | nein | **ja**, an Exa (`src/research/adapters/exa-search.js:1-8`) | wie Datensatz | wie Datensatz | UNKNOWN, ob live (P0-9) |
| Gespraechsinhalte an das Sprachmodell | ja | nein (nur Ergebnis) | nein | **ja**, an Anthropic, per Schalter auch DeepSeek (`src/llm/provider.js:4`) | n/a | n/a | UNKNOWN, welcher Anbieter live (P0-9) |
| Audio | **nein** an MCP (CLAUDE.md Absolute Regel 5, getestet `test/mcp-audio-text-only.test.js:21`) | keine Tonaufzeichnung laut Policy (`privacy.de.json`) | nein | Anbieter (Leitung) | n/a | n/a | PASS |

## Consult - eigene Sicherheitsbetrachtung

Der Consult-Kanal ist die einzige Stelle, an der Hermes nicht Werkzeug, sondern Fragender ist: der telefonierende Agent fragt den uebergeordneten Agenten (ChatGPT) mitten im Gespraech. Das dreht die Vertrauensrichtung um und verdient eine eigene Betrachtung.

### Ablauf wie implementiert

1. **Zwei Ausloeser.** Consult #0 entsteht beim Waehlen aus `context.open_questions`, nur wenn das Profil es erlaubt (`src/routes/api-calls.js:325-330`, `emitOpeningConsult`). Die In-Call-Rueckfrage loest das Sprach-Modell selbst aus, indem es `get_consult` ruft. Einen Regel-Automatismus ohne Modell-Entscheidung gibt es ausser Consult #0 nicht (`08-consult.md` PP-D8-01, PASS).
2. **Tor.** `consultAllowedForCall` (`src/consult/gate.js:41-43`) fordert `consultEnabled`, `assistantContextEnabled`, `profile.allowConsult` und `calleeIsOwner !== true`, alle fail-closed als `=== true` formuliert. Der annehmende Webhook fordert zusaetzlich `inCallConsultEnabled` und Richtung `outbound` (`src/routes/webhooks-elevenlabs.js:425-431`). Genau diese Divergenz ist P1-30. Der Budget-/Telnyx-Weg formuliert die Bedingung ein zweites Mal und laesst `calleeIsOwner` weg (`src/consult/in-call.js:87-97`).
3. **Kontingent.** Eine In-Call-Rueckfrage je Anruf (`src/consult/in-call.js:56`, `MAX_IN_CALL_CONSULTS_PER_CALL = 1`), gezaehlt statusunabhaengig (`src/store/state-ops.js:1556-1558`), von beiden Wegen aus derselben Zahl gelesen. Gleichzeitige Halter: 2 je Anruf, 4 je Tenant (`src/consult/delivery.js:24-25`), und der blockierende Webhook zaehlt auf dieselben Zaehler (`:121-128`).
4. **Egress-Filter der Frage.** `sanitizeConsultQuestion` (`src/consult/question.js:32-38`) strippt Anfuehrungszeichen-Spannen, prueft auf woertliches Zitat und kappt auf 200 Zeichen.
5. **Ablage.** Die Frage haengt am Anruf (`src/store/state-ops.js:1276-1294`), die Kennung ist `"c" + Index`, also `"c0"` fuer die erste Rueckfrage jedes Anrufs (`:1247-1249`).
6. **Zustellung.** Long-Poll `GET /api/calls/:id/consult`, Haltezeit 22 000 ms, Abbruchmarge 3 000 ms (`src/consult/delivery.js:17-20`), clientseitig als `AbortSignal.timeout` gespiegelt (`src/mcp-tools.js:588-603`); Zeitablauf wird zu `event="none"`, nicht zu einem Fehler.
7. **Antwort.** `answer_consult` -> `POST /api/calls/:id/consult/answer` -> `answerConsultFinal` (`src/routes/api-calls.js:175-193`) -> `validateAssistantContext` -> `invalidStringArray` mit `KEY_FACTS_LIMITS = {maxItems: 10, maxLen: 200}` (`src/store/defaults.js:424`). Verstoss = 400, Antwort verworfen, Consult bleibt offen. Geschrieben wird ausschliesslich `call.context.key_facts` (`src/store/state-ops.js:1325-1335`, `:1387`).
8. **Zum Agenten.** EL-Weg: die Fakten sind das Werkzeug-Ergebnis (`src/routes/webhooks-elevenlabs.js:99-103`, `:110-116`). Budget-Weg: sie stehen im HINTERGRUND-Block (`src/claude.js:365-368`), plus ein Steuertext, der zum sofortigen Nennen auffordert (`src/i18n/prompts/en.js:360-364`). Woertlich gesprochen wird auf beiden Wegen nur der server-eigene Ueberbrueckungssatz (`src/i18n/locales.js:431/433`).

### Uebertragene Daten

An den Client geht genau `{event, eventId, questions}` (`src/consult/delivery.js:85-95`, `src/routes/api-calls.js:606`), bei `event="done"` zusaetzlich die bestehende Whitelist (`status`, `failure_reason`, `result_summary`, `objective_achieved`, Ergebniskarte; `src/mcp-tools.js:253-271` -> `:206-215`). Kein Roh-Transkript, keine Rufnummer, keine Tenant-ID, keine Provider-Kennung, kein Audio (`src/routes/api-calls.js:573-578`). Der INHALT der `questions` ist Modell-Text aus dem laufenden Gespraech und damit nicht garantiert PII-frei - das ist der eigentliche Gegenstand von P1-29.

### Korrelation

Die Rueckfrage haengt am Anruf, der Anruf am Tenant. Lesen: `internalOnly` + `callVisibleTo` (fremder Tenant -> 404) + Faehigkeit (`src/routes/api-calls.js:583-591`). Schreiben: `requireTenant` (403), `callVisibleTo` (404), Faehigkeit (403), Formwache `isConsultEventId` (400) vor dem Audit-Eintrag (`:615-638`). Eine Sitzungsbindung existiert nicht - `/mcp` ist stateless (`src/routes/mcp.js:113`), jeder Client desselben Tenants darf antworten; das ist Absicht. Die Kennung `"c0"` ist nicht global eindeutig; der Gegenpruefer hat den daraus abgeleiteten Fehlzustellungs-Befund **widerlegt** (`src/store/state-ops.js:1355-1366` adressiert ueber die vom Client selbst gepaarte `call_id`, tenant-gebunden; eine Fehlzustellung braucht einen Client-Fehler plus zwei gleichzeitig offene Rueckfragen desselben Tenants) - global eindeutige Kennungen bleiben P2-Haertung.

### Timeout-Verhalten

Unbegrenztes Warten existiert nirgends. Offen-Frist der Rueckfrage 47 000 ms (`src/config.js:1628-1632`), danach `DEADLINE_PASSED` (`src/store/state-ops.js:1380-1381`). Budget-Weg-Wartezeit im Turn 4 000 ms (`src/config.js:1616-1620`), ausgewertet als Wanduhr-Frist im naechsten Turn (`src/store/state-ops.js:1695-1723`) - die Leitung laeuft weiter. EL-Weg gestaffelt ab Entstehung: Zustellung 5 000, Quittung 10 000, Antwort 30 000 ms (`src/conversation/consult-raised.js:53-57`, `src/config.js:1644-1666`), letzte Stufe ohne Vorbedingung, geklemmt auf `EL_CONSULT_STAGE_MAX_MS = 55 000` (`src/config.js:72`), Anbieterfrist 60 s (`elevenlabs/agent_configs/outbound-agent.template.json`, `response_timeout_secs`). Dort HAELT der Webhook den Request offen und friert die Leitung ein (`src/conversation/consult-raised.js:11-15`, Warteschleife `:206-265`) - bis zu 30 s, in denen der Mensch nach dem Ueberbrueckungssatz nichts mehr hoert; gegen die Stille wirken `pre_tool_speech=force`, `interruption_mode=allow` und `tool_call_sound=None`. Die Fristen der Stufen 0 und 1 sind laut Code ausdruecklich vorlaeufig und unvermessen (`src/config.js:1640-1643`), nur Stufe 2 ist an fuenf historischen Faellen hergeleitet. Prozessneustart und geordneter Drain sind abgedeckt (Drain-Flag `src/consult/delivery.js:136-143`, Verwaisungs-Marker `src/conversation/consult-raised.js:198-263`, Netz beim Start `src/boot.js:1163-1178`, Kontingent-Semantik `src/store/state-ops.js:1513-1526`), getestet in `test/el-consult-neustart.test.js`.

### Wenn ChatGPT die Information nicht hat oder nicht antwortet

- **Weiss nicht:** die Server-Instruktion verlangt ausdruecklich, das zu senden statt zu erfinden (`src/mcp-server-info.js:105-107`); der Text wird dann als Fakt uebernommen und ausgesprochen. Eine kanonische Unbekannt-Antwort (`status="unknown"`) existiert nicht - P2.
- **Nutzer nicht anwesend:** ausdrueckliche Normalannahme; der Client soll nicht warten (`src/mcp-tools.js`, Beschreibung von `answer_consult`).
- **Keine Antwort:** Zeitablauf, dann der Steuertext `consultTimeout` ("No answer came back ... Decide within your mandate or record the request as a message", `src/i18n/prompts/en.js:370-373`) - ein sprechbarer Satz, kein Werkzeugfehler.
- **Leer oder verweigert:** 400 (`src/routes/api-calls.js:177-179`), der Consult bleibt offen und laeuft in dieselbe Frist.
- **Mehrdeutig:** kein eigener Pfad; jeder angenommene Text ist "die Antwort". Teilweise entschaerft, weil der Marker `consultAnswered` nur bei `answeredFacts > 0` gesetzt wird (`src/store/state-ops.js:1574-1579`).
- **Nichts quittiert innerhalb Sekunden:** der Server nimmt an, dass niemand antworten kann, und laesst den Agenten weitermachen (Instruktionsblock `src/mcp-server-info.js:84-104`).

### Injektions-Angriffspfade mit Bewertung

| Pfad | Mechanik | Bewertung |
|---|---|---|
| Angerufener erzwingt die Rueckfrage | Der Prompt verlangt es ausdruecklich: "CALL IT WHEN: the other party asks for a detail that is not in your task ... Call get_consult FIRST" (`elevenlabs/agent_configs/outbound-agent.template.json`, Abschnitt CONSULT TOOL). Die Frage wird aus fremder Rede formuliert und verlaesst den Server Richtung MCP-Host. | **durchfuehrbar und so gewollt**; begrenzt auf eine Rueckfrage je Anruf. `src/config.js:1601-1610` nennt genau diesen Export fremder Rede als Grund des eigenen Schalters und macht die Nennung in der Datenschutzerklaerung zur Vorbedingung (P0-9, P1-29). |
| Woertliches Zitat des Angerufenen an den Host | `containsVerbatimQuote` liefert ohne `caller`-Zeilen `false` (`src/utils/text.js:57-60`), und auf dem EL-Weg entstehen die erst nach Gespraechsende (`src/elevenlabs/outbound.js:1075`). | **durchfuehrbar auf dem EL-Weg** (bis 200 Zeichen), **blockiert auf dem Budget-Weg**. P1-29. |
| Privatdaten des Nutzers werden dem Fremden vorgelesen | Der Angerufene formuliert die Frage, die Server-Instruktion weist den Host an, aus Kalender/Mail/Dateien zu antworten (`src/mcp-server-info.js:94-96`), und die Antwort geht als Werkzeug-Ergebnis an das sprechende Modell (`src/routes/webhooks-elevenlabs.js:99-103`). | **durchfuehrbar**, Bremsen sind Prompt-Text und Kontingent 1. Der Gegenpruefer hat die haerteste Fassung dieses Befundes (P0 wegen fehlender Kappe/Rahmen) **widerlegt**: die Kappe 10x200 existiert deterministisch vor dem Store, und die Quelle ist die vertrauenswuerdige Auftraggeber-Seite. Es bleibt: die Entscheidung, WELCHE Antwort ausgesprochen werden darf, liegt beim Modell, und die Per-Tenant-Grenzen `allowPersonalData`/`allowBankData` reisen auf diesem Weg nicht mit (P1-33). |
| Zusaetzliche Prompt-Zeilen ueber die Antwort | `invalidStringArray` prueft Typ, Anzahl, Laenge, nicht Steuerzeichen (`src/routes/_validation.js:104-113`), waehrend `promptLineRejection` im selben Modul existiert (`:93-98`). | **widerlegt** als neue Faehigkeit: derselbe Client schreibt ueber `goal`/`briefing`/`constraints` bereits mehrzeilig in denselben Prompt (`src/routes/_validation.js:87-92`, ausgeschriebene Entscheidung), und auf dem EL-Weg erreicht die Antwort den HINTERGRUND-Block gar nicht (`src/elevenlabs/outbound.js:665-676` baut ihn einmal beim Waehlen). Eine privilegierte Backend-Aktion ist darueber nicht erreichbar (`src/store/state-ops.js:1387` ist der einzige Schreibweg; `execTool` kennt `get_consult` nicht). |
| Fremde Auslosung ueber die Anbieter-Webhooks | Ein plattformweites Geheimnis (`x-hermes-tool-token`, `src/routes/webhooks-elevenlabs.js:459-463`) plus Bindung an die Anbieter-`conversation_id` (`:169-180`); der abgeleitete Mandanten-Token darf fehlen (`:216-221`, Default `false`). | **durchfuehrbar fuer den Besitzer des Plattform-Geheimnisses** (es liegt beim Anbieter): Rueckfrage im Namen eines fremden Mandanten, dessen Leitung bis 30 s gehalten, Kosten auf dessen Achse (`:282`, `:344`). Gegenmassnahme gebaut, aber abgeschaltet - P1-21. |
| Werkzeugfehler mitten im Gespraech | Tor-Divergenz (P1-30) und der statisch mitgelieferte Werkzeugsatz des Anbieters (P1-31): der Agent kuendigt eine Rueckfrage an und bekommt 404. | **durchfuehrbar durch Fehlkonfiguration**, nicht durch einen Angreifer; Schaden ist ein improvisierender Agent im bezahlten Gespraech. |
| Dauerhafte Ablage fremder Rede | Der Fragetext liegt so lange wie der Anruf-Datensatz; es gibt keinen kurzen Durchgang wie fuer woertliche Zitate (`src/store/state-ops.js:5145-5160`). | **bestaetigt**, P2; fuer die Datenschutzerklaerung die schwerer zu erklaerende Haelfte des Kanals. |
| Poll-Schleife ohne moegliche Frage | Der Instruktionsblock haengt allein an `consultAllowedFor(profile)` (`src/routes/mcp.js:91`) und beschreibt die In-Call-Lage woertlich, ohne dass `IN_CALL_CONSULT_ENABLED` darin vorkommt. | **bestaetigt**, P2: Kosten durch Dauer-Polls und eine falsche Faehigkeitszusage an das fremde Modell. |

## Vertrauensgrenzen

```
 [1] Nutzer
      | Chat: Auftrag, Kontext, Consult-Antworten
      v
 [2] ChatGPT / MCP-Host  ................................. ausserhalb unseres Codes
      | HTTPS POST /mcp, JSON-RPC (tools/list, tools/call)
      | Auth: OAuth-2.1-Bearer, JWKS+iss+aud+exp je Request (src/auth.js:75-88)
      v
 [3] Hermes Gateway /mcp  (src/routes/mcp.js:52-113, stateless, ein Server je POST)
      | In-Process-HTTP an 127.0.0.1 + X-Internal-Identity/X-Internal-Tenant
      | Auth: isTrustedLocalCaller = Loopback UND kein X-Forwarded-For (_tenant.js:34-44)
      v
 [4] Hermes Backend / REST  (src/routes/api-*.js)  ->  [4a] Store (Postgres RLS nur bei
      |                                                      Hydrierung/Flush, pg.js:974-984)
      |                                               ->  [4b] LLM-Provider (Anthropic,
      |                                                      per Schalter DeepSeek)
      |                                               ->  [4c] Stripe / WorkOS / Mail
      | Anrufstart nach 18 Gates (outbound-gates.js:656-965)
      v
 [5] Voice-Agent (ElevenLabs Agents-Platform)  <-- Prompt-Variablen, Eroeffnung, tenant_token
      |    ^                                         (outbound.js:936-983)
      |    | Werkzeug-Webhooks: get_consult, look_up
      |    | Auth: EIN plattformweites Geheimnis + conversation_id
      |    | (webhooks-elevenlabs.js:459-463, :169-180); Mandanten-Token optional
      v    |
 [6] Telefonie-Provider (Telnyx)  <-- Ed25519-Signaturpruefung fail-closed auf /voice/*
      |
      v
 [7] Angerufener Mensch  ................................. unauthentisiert, nicht vertrauenswuerdig
      ^
      | ASR-Text -> Prompt; kann [5] zu get_consult/look_up bewegen
      |
 [8] Suchdienst (Exa)  <-- sanitizeLookupQuery (lookup-guard.js:66-74), Treffer gerahmt
                            als "DATA, never instructions" (prompts/en.js:381-383)
```

| Grenze | Auth | uebertragene Daten | Vertrauensniveau | Angriffsflaeche |
|---|---|---|---|---|
| [1] -> [2] Nutzer -> ChatGPT | keine (nicht unser System) | Auftrag, Kontext, Consult-Antworten | vertrauenswuerdig (der Auftraggeber) | ausserhalb unseres Codes |
| [2] -> [3] ChatGPT -> `/mcp` | OAuth-2.1-Bearer je Request (`src/auth.js:95-117`) | `to`, `objective`, `briefing`, `constraints`, `mandate`, `context`, `call_id`, Consult-Antworten | im Namen des Nutzers, aber modellgeneriert | beliebiger Freitext ohne Schema-Cap (P2), beliebiges Ziel (P1-26), `Origin` ungeprueft (P2), keine Scopes (P1-13), kein Widerruf (P1-14) |
| [3] -> [4] MCP-Schicht -> Backend | `isTrustedLocalCaller` (`src/routes/_tenant.js:34-44`), `internalOnly` (`src/wiring/internal-only.js:24-28`) | derselbe Nutzinhalt plus aufgeloeste Identitaet in Headern | intern | Topologie-Annahme (Proxy setzt immer XFF); Tenant kann per Flag verworfen werden (P0-7); rohe `call_id`-Interpolation (P2) |
| [4] -> [4a] Backend -> Store | DB-Credentials; RLS nur bei Hydrierung/Flush | alles | intern | RLS ist keine Anfrage-Grenze (P1-20); TLS haengt am Connection-String (P2) |
| [4] -> [4b] Backend -> LLM | API-Key | Systemprompt inkl. Auftrag, Briefing, Hintergrund, Gespraechsverlauf | Auftragsverarbeiter | in der Policy nur Anthropic genannt (P0-9) |
| [4] -> [5] Backend -> Voice-Agent | Anbieter-API-Key; Override-Whitelist (`src/elevenlabs/convai.js:132`, `:186-200`), `assertAntwortSicher` (`src/elevenlabs/inbound-initiation.js:220-228`) | Prompt-Variablen, Eroeffnungssatz, `tenant_token` | unser Text, fremde Ausfuehrung | outbound ohne `{{`-Pruefung (P1-37); Offenlegungs-Pruefung nur auf dem Eroeffnungspfad (`convai.js:228-249`) |
| [5] -> [4] Voice-Agent -> Werkzeug-Webhooks | EIN plattformweites Geheimnis (`safeEqual`), Bindung ueber `conversation_id`, Mandanten-Token optional | `question`, `query`, `conversation_id`, `tenant_token` | **nicht vertrauenswuerdig** (Inhalt vom Angerufenen getrieben) | fremde Sitzung uebernehmbar mit dem Plattform-Geheimnis (P1-21); Zitat-Riegel inert (P1-29) |
| [6] -> [4] Telefonie-Provider -> `/voice/*` | Ed25519-Signatur, fail-closed (CLAUDE.md Absolute Regel 1) | `From`, `To`, SIP-Header, Statusereignisse | **nicht vertrauenswuerdig** (Caller-ID faelschbar) | Caller-ID-Spoofing erzeugt Owner-Ton (`src/routes/voice.js:327-334`), keine Daten-/Werkzeugfreigabe |
| [7] -> [5] Angerufener -> Voice-Agent | keine | gesprochene Sprache (ASR) | **nicht vertrauenswuerdig, unauthentisiert** | vollstaendige Prompt-Injection-Flaeche; gebremst durch geschlossenen Vier-Werkzeug-Satz (`src/claude.js:630-640`, `:671-687`), Kontingente (2 Suchen, 1 Rueckfrage), Egress-Filter; KEIN Verbotssatz gegen das Vorlesen von Auftrag/Hintergrund (P2) |
| [8] -> [4] Suchdienst -> Backend | keine (HTTP-Antwort) | Treffer-Strings | **nicht vertrauenswuerdig** | indirekte Injektion; gerahmt auf dem EL-Weg (`src/i18n/prompts/en.js:381`), auf dem Budget-Weg nur unter dem schwachen HINTERGRUND-Guardrail (P1-35) |
| [4] -> [1] Hermes -> Nutzer (MCP/Mail/SMS) | wie [2]/[3] bzw. Mail-/SMS-Anbieter | Zusammenfassung, Ergebniskarte, Inbox, Action Items | Inhalt fremd-stammend | keine Untrusted-Markierung (P1-32), keine Redaction (P1-34) |

## OpenAI-Anforderungs-Matrix

Status: ERFUELLT / TEILWEISE / OFFEN / UNKNOWN / N/A. Kategorie wie in `00-openai-anforderungen.md` (A = explizite Anforderung mit Zitat, B = folgt zwingend, C = Empfehlung).

| ID | Beleg in Hermes | Datei/Stelle | Status | erforderliche Massnahme | Kat. |
|---|---|---|---|---|---|
| W-1 | Developer Mode nicht genutzt/nicht dokumentiert | - | N/A | - | A |
| W-2 | oeffentlicher Weg ist das Ziel dieses Audits | - | N/A | - | A |
| W-3 | Submission-Portal-Weg noch nicht begangen | - | OFFEN | Einreichung erst nach P0-1..P0-9 | A |
| W-4 | Responses-API-Weg nicht genutzt | - | N/A | - | A |
| W-5 | Agents-API-MCP-Weg nicht genutzt | - | N/A | - | A |
| W-6 | kein Tunnel im Einsatz, stabile HTTPS-URL vorhanden | `src/config.js:1443` | ERFUELLT | - | A |
| W-7 | keine bereits publizierte Integration referenziert; Abwesenheit belegt durch `grep -rniE "plugin_id\|already-published\|apps\.write\|chatgpt-plugin\|ai-plugin\.json" src/ apps/` = 0 Treffer - im Repo existiert keine Plugin-Kennung und kein Verweis auf eine publizierte Integration | `grep` = 0 | ERFUELLT fuer die Repo-Seite; ob im OpenAI-Konto eine publizierte Integration existiert, ist am Repo nicht entscheidbar (UNKNOWN) | im Portal pruefen | A |
| T-1 | Streamable HTTP auf `/mcp`, stabile URL | `src/routes/mcp.js:51-113` | ERFUELLT | - | A |
| T-2 | oeffentliche Domain, Render, HTTPS erzwungen | `render.yaml:5-30`, `src/middleware.js:32` | ERFUELLT | - | A |
| T-3 | kein privater Server, kein Proxy noetig | - | N/A | - | C |
| T-4 | SSE nicht bedient (GET -> 405) | `src/routes/mcp.js:128-131` | N/A (nur Developer Mode) | - | A |
| T-5 | OAuth 2.1 im Modus `oauth` | `src/auth.js:95-117` | ERFUELLT | - | A |
| T-6 | PRM unter beiden Pfaden | `src/auth.js:121-129` | TEILWEISE | leeres `authorization_servers` vermeiden, `scopes_supported` ergaenzen | A |
| T-7 | AS-Metadata beim IdP | `src/auth.js:29-48` (nur Konsument) | UNKNOWN | AS-Metadata abrufen und dokumentieren | A |
| T-8 | S256-Advertising nicht belegt | `grep` = 0 | UNKNOWN | AS pruefen (P0-8) | A |
| T-9 | `resource` -> `aud` nicht belegt | `src/auth.js:23`, `:83` | UNKNOWN | AS pruefen; `OAUTH_AUDIENCE` an die kanonische URL binden | A |
| T-10 | CIMD/DCR nicht belegt | `grep` = 0 | UNKNOWN | AS pruefen (P0-8, harter Gate) | A |
| T-11 | RFC-9207-`iss` nicht belegt | `grep` = 0 | UNKNOWN | AS pruefen (P0-8) | A |
| T-12 | Token-Pruefung vollstaendig | `src/auth.js:75-88` | ERFUELLT | Algorithmus-Allowlist, `requiredClaims` (P1-16) | A |
| T-13 | 401 + `WWW-Authenticate` nur im oauth-Modus | `src/auth.js:66-72`, `:103/:110/:114` | TEILWEISE | `deny401` fuer alle 401 (P1-10) | A |
| T-14 | `_meta["mcp/www_authenticate"]` fehlt | `src/mcp-tools.js:84` | OFFEN | im Fehlerergebnis mitgeben (P1-11) | A |
| T-15 | `securitySchemes` fehlt | `grep` = 0 | OFFEN | setzen, SDK-Luecke pruefen (P1-4) | A |
| T-16 | UserInfo/Workspace-Restriktionen nicht belegt | `src/web-auth.js:406-407` | UNKNOWN | nur relevant bei Workspace-Domain-Restriktion | A |
| T-17 | kein mTLS | `grep mtls` = 0 | N/A | optional | C |
| T-18 | `inputSchema` ueberall explizit; `outputSchema` bei 10 von 12 | `src/mcp-tools.js:669-1238`; Ausnahmen `:1057-1062`, `:1149` | TEILWEISE | zwei Legacy-Werkzeuge heben (P1-5) | A |
| T-19 | `structuredContent`/`content` konsistent, `_meta` nur an die UI | `src/ui/contract.js:9-16`, `:43-46` | TEILWEISE | Fruehausgang von `get_transcript` ohne `structuredContent` (P1-9) | A |
| T-20 | Fehler als `isError` | `src/mcp-tools.js:630-647` | ERFUELLT | Ausnahme `answer_consult` dokumentieren (P2) | B |
| T-21 | Server-`instructions` vorhanden | `src/mcp-server-info.js:78-107` | TEILWEISE | In-Call-Teil an das richtige Praedikat binden (P2), Laenge gegen 512 Zeichen pruefen | C |
| T-22 | `openai/toolInvocation/*` nicht gesetzt | `grep` = 0 | OFFEN | optional, nur bei Statuszeilen | A |
| T-23 | `_meta.ui.resourceUri` vs. `openai/outputTemplate` | `src/ui/contract.js:43-46` (Skybridge-Alias) | TEILWEISE | bei UI-Einreichung Standard-Key bevorzugen | A |
| T-24 | kein `search`/`fetch` | - | N/A (nur Deep Research) | - | A |
| T-25 | keine Zitationen beansprucht | - | N/A | - | A |
| T-26 | - | - | N/A | - | A |
| T-27 | Limits vorhanden (6/h, 3/Ziel/24h, Kostendecke, Max-Dauer), aber KEIN Timeout auf dem internen Hop und IP-basiertes Rate-Limit | `src/telephony/outbound-gates.js:364-378`, `src/mcp-tools.js:585`, `src/middleware.js:157-168` | TEILWEISE | Frist setzen (P0-6), Limit-Achse auf Tenant/Subject (P1-23), TOCTOU schliessen (P1-22) | A |
| T-28 | `openai/subject` wird nicht gelesen | `rg "openai/subject" src/` = 1 Kommentar | OFFEN | fuer Rate-Limiting nutzen (P1-23) | A |
| T-29 | stateless wie im Quickstart; keine CORS-Header | `src/routes/mcp.js:113`; `grep cors` = 0 | TEILWEISE | klaeren, ob CORS noetig ist (P2) | C |
| T-30 | `_meta.ui.csp` nicht gesetzt | `src/ui/*` | OFFEN bei UI-Einreichung | ohne UI einreichen oder CSP definieren (P1-50) | A |
| T-31 | `_meta.ui.domain` nicht gesetzt | `src/ui/*` | OFFEN bei UI-Einreichung | wie T-30 | A |
| T-32 | Origin nach Publikation unveraenderlich; eine Einreichung unter dem heutigen Fallback-Origin friert einen markenfremden Host ein, waehrend Track B laut `CLAUDE.md` offen ist - ein spaeterer Wechsel erzwingt ein NEUES Plugin mit vollem Scan/Review | `00-openai-anforderungen.md:65`, `render.yaml:5-30`, `:686`, `src/mcp-server-info.js:13-17` | OFFEN/BLOCKER | Host und Origin VOR der Einreichung entscheiden (P0-11), `PUBLIC_URL` explizit darauf setzen (P0-10) | A |
| T-33 | Continuous Review | - | zu beachten | alte Definition lauffaehig halten | A |
| T-34 | UI-Cache 1 h | - | N/A ohne UI | - | A |
| T-35 | EU-Datenresidenz | `render.yaml:8-12`, `privacy.de.json:42` | UNKNOWN/BLOCKER | Einreichung aus einem Projekt mit globaler Residenz (P0-5) | A |
| T-36 | universelle URL, keine Template-URL | `src/config.js:1443` | ERFUELLT | - | A |
| N-1 | keine Annotationen | `grep` = 0 | OFFEN | alle 12 Werkzeuge annotieren (P0-1) | A |
| N-2 | `readOnlyHint` inhaltlich korrekt bestimmbar | Soll-Tabelle `03-...` PP-D3-08 | OFFEN | mit P0-1 | A |
| N-3 | `destructiveHint` fuer `place_call`/`cancel_call`/`answer_consult` | `src/mcp-tools.js:825`, `:1061`, `:934` | OFFEN | mit P0-1 und P1-28 | A |
| N-4 | `openWorldHint` fuer alles, was nach aussen wirkt | dito | OFFEN | mit P0-1 | A |
| N-5 | Begruendungen je Annotation | - | OFFEN | bei der Einreichung mitliefern | A |
| N-6 | fehlende Labels als Ablehnungsgrund | - | OFFEN | mit P0-1 | A |
| N-7 | ohne Hint = Write-Action | Folge fuer 8 Lesewerkzeuge | OFFEN | mit P0-1 | A |
| N-8 | Host-Bestaetigung fuer Write-Actions | Host-Verhalten | UNKNOWN | - | A |
| N-9 | Datenabfluss als Write-Action sichtbar | `answer_consult` nicht markiert | OFFEN | P1-28 | A |
| N-10 | serverseitige Bestaetigung fuer folgenreiche Schreibaktionen | kein Bestaetigungsschritt, `rg elicit` = 0 | OFFEN | P1-26 | A |
| N-11 | Seiteneffekte nie versteckt, retry-sicher oder ausgewiesen | `check_inbox` nennt seinen Konsum (`:481-485`); Kostenbuchung von `place_call` NICHT genannt; keine Idempotenz und kein Ausweis | TEILWEISE | P1-3, P0-6 | A |
| N-12 | Werkzeugnamen eindeutig, Klartext, keine Werbesprache | 11 von 12 praezise, `get_my_number` mehrdeutig | ERFUELLT | `title` setzen (P2) | A |
| N-13 | Beschreibungen bilden das Verhalten exakt ab | Widersprueche in `place_call` und `get_transcript` | TEILWEISE | P1-1, P1-2, P1-3 | A |
| N-14 | minimale Eingaben, keine Roh-Transkripte, kein Standort | kein Tenant-/User-/Session-Feld in den 12 Schemas (`04-...` PP-D4-10); Grenzen nur in der Beschreibung | TEILWEISE | Caps ins Schema (P2) | A |
| N-15 | kein Ziehen des Chatverlaufs; Abwesenheit belegt durch `grep -niE "chat_?log\|chat_?history\|conversation_?history\|\bmessages\b" src/mcp-tools.js` = 0 Treffer - keines der 12 Input-Schemas nimmt Verlauf, Nachrichtenliste oder Chat-Kontext entgegen | `src/mcp-tools.js` (`grep` = 0) | ERFUELLT | - | A |
| N-16 | Elicitation nicht genutzt | `rg elicit` = 0 | N/A | - | A |
| O-1 | Identitaetsverifikation bei OpenAI | ausserhalb des Repos | UNKNOWN | vor der Einreichung durchfuehren | A |
| O-2 | gleiche Organisation | ausserhalb des Repos | UNKNOWN | pruefen | A |
| O-3 | `api.apps.write` | ausserhalb des Repos | UNKNOWN | pruefen | A |
| O-4 | Challenge-Route | `grep` = 0 | OFFEN | P0-2 | A |
| O-5 | Challenge-Base = Host, Pfad ignoriert | - | zu beachten | mit P0-2 | A |
| O-6 | Privacy Policy vollstaendig und eingehalten | `[OFFEN:]`-Platzhalter, Loeschversprechen ohne Code-Deckung, Anbieter nicht abgeglichen. Angebotene Nutzerkontrollen (von O-6 ausdruecklich verlangt): Teil-Export ueber `GET /api/tenant-data/export` (`src/routes/api-read.js:119-123`, ohne Settings/Profil/KYC/Stripe, `13-...` PP-D13-09) und Setzen der eigenen Nummer (`src/self-service-routes.js:401`); die Loeschung hat KEINEN Endpunkt, nur ein CLI-Skript (`src/routes/api-read.js:115-118`, `scripts/erase-tenant.js:1-9`) | OFFEN | P0-3, P0-9, P1-39 | A |
| O-7 | Pflicht-URLs oeffentlich und passend | Seiten existieren (`apps/web/src/lib/legal.js:14-26`), Support `kontakt@sundartha.com`, Website `https://www.sundartha.com` (`src/mcp-server-info.js:63`) | TEILWEISE | P0-3 | A |
| O-8 | Support-Kontakt | `apps/web/src/layouts/Site.astro:50` | ERFUELLT | - | A |
| O-9 | Reviewer-Zugang ohne zusaetzliche Schritte | KYC-/Abo-Gates, WorkOS-Login | OFFEN | P0-4 | A |
| O-10 | 5 positive und 3 negative Testfaelle: es liegen 19 vor - 5 positive, 8 negative, 6 Sicherheitsfaelle, je mit Prompt, Werkzeug, Argumenten, erwartetem Verhalten, Ergebnisform und einer eigenen Spalte "Ist-Zustand belegt?" | `tasks/openai-audit/16-review-testfaelle.md` | TEILWEISE | Reproduktionsdaten ergaenzen (Demo-Tenant, Testnummer - haengt an P0-4); die als "nur SOLL" markierten Faelle vor der Einreichung am Code verifizieren; der `answer_consult`-Sonderfall ist als S3 dokumentiert | A |
| O-11 | Name, Beschreibungen, Logo, Kategorie, Starter-Prompts, Laender | Name/Icon/Website vorhanden (`src/mcp-server-info.js:37`, `:60-71`), der Rest nicht | TEILWEISE | zusammenstellen | A |
| O-12 | Screenshots nur bei UI | - | zu beachten | ohne UI keine einreichen | A |
| O-13 | Datenminimierung, keine internen IDs | 11 Werkzeuge whitelisten; `list_action_items` gibt eine interne ID aus; `get_agent_status` gibt Modellkennung; Budget-Texte geben EUR | TEILWEISE | P1-6, P2 | A |
| O-14 | keine Restricted Data | keine PCI-/PHI-/Ausweisdaten-Felder; aber keine Redaction fuer am Telefon genannte Kartennummern/Codes | TEILWEISE | P1-34 | A |
| O-15 | besondere Kategorien nur bei Notwendigkeit | Gespraechsinhalte koennen sie enthalten, keine Einwilligung des Angerufenen | TEILWEISE | P1-34, Offenlegungssatz bleibt die Grundlage | A |
| O-16 | kein Tracking/Profiling | `src/metrics.js:1-4` PII-frei | ERFUELLT | - | A |
| O-17 | keine Roh-Standortfelder | keines der 12 Schemas | ERFUELLT | - | A |
| O-18 | Usage Policies gelten zusaetzlich | Volltext war nicht abrufbar (`00-openai-anforderungen.md:145-149`) | UNKNOWN | vor der Einreichung aus dem Browser lesen | A |
| O-19 | kein Telemarketing/Consent-Bypass | kein Batch/Kampagne/Wiederwahl (`10-...` PP-D10-11); Denylist hartkodiert (`src/telephony/number-denylist.js:12-80`); Offenlegungssatz fest verdrahtet | ERFUELLT, mit Vorbehalt zur Begruendung | Argumentation fuer die Einreichung vorbereiten; ob Telefonie-Plugins ueberhaupt zulaessig sind, ist NICHT dokumentiert (`:150-155`). **Vorbehalt:** PP-D10-11 leitet die Durchsatzdecke aus PRO-TENANT-Limits ab (`MAX_CALLS_PER_HOUR` 6, `PER_TARGET_CALL_CAP` 3) - das setzt die Mehrmandanten-Annahme voraus. Unter dem Default `MULTI_TENANT=false` (`src/config.js:1570`) fallen alle MCP-Nutzer auf EINEN Tenant und teilen EINE Decke (P0-7); das macht die Summe strenger, nicht laxer, nimmt der Decke aber die Zuordnung zum einzelnen Nutzer. Das Urteil ERFUELLT haengt daran nicht: es stuetzt sich darauf, dass ueberhaupt kein Batch-, Kampagnen- oder Wiederwahl-Konstrukt existiert (Grep = 0) | A |
| O-20 | Commerce nur physische Gueter, keine Abo-Flows | kein MCP-Werkzeug beruehrt Checkout/Abo (`07-...` PP-D7-09) | ERFUELLT | Abo-Hinweise aus Werkzeugtexten heraushalten | A |
| O-21 | keine Werbung; Abwesenheit belegt durch `grep -rniE "advertis\|sponsor\|promo(tion)?\|werbung" src/mcp-tools.js src/mcp-server-info.js` = 0 Treffer in allen Werkzeug- und Servertexten, die ein Host zu sehen bekommt | `grep` = 0 | ERFUELLT | - | A |
| O-22 | kein inoffizieller Konnektor, kein Pass-through. Eine Abwesenheits-Suche taugt hier nicht (Pass-through ist keine Zeichenkette), der Beleg ist deshalb positiv: eigene Provider-Abstraktion mit eigenen Adaptern (`src/telephony/registry.js`, `src/telephony/adapters/telnyx/*`), eigene 18-gliedrige Gate-Kette vor jedem Anruf (`src/telephony/outbound-gates.js:656-968`), eigene Nummern-Provisionierung (`src/worker/provisioning.js`) und eigener Gespraechs-/Ergebnisbestand (`src/db/schema.sql:211-393`); kein Werkzeug reicht einen Drittdienst-Aufruf unveraendert durch (jede Antwort geht ueber eine `pick*`-Whitelist, `src/mcp-tools.js:164-173`) | `src/telephony/outbound-gates.js:656-968` | ERFUELLT | - | A |
| O-23 | Drittanbieter-AGB und Rate-Limits | Telnyx/ElevenLabs/Exa als eigene Vertraege | UNKNOWN | Vertragslage pruefen | A |
| O-24 | allgemeines Publikum inkl. 13-17 | keine Altersgrenze im Code | UNKNOWN | Produktentscheidung dokumentieren | A |
| O-25 | kein Trial/Demo, stabil und vollstaendig | Dienst laeuft produktiv; Single-Instance-Grenze (P1-42) | TEILWEISE | P1-42 kennen | A |
| O-26 | Iframes nur eigene Domain | ohne UI nicht relevant | N/A | - | A |
| O-27 | Fair Play, keine Manipulation anderer Plugins | Beschreibungen nennen "nicht als Claude/Gemini" als Negativliste (`src/mcp-tools.js:698`, `:761`) | ERFUELLT | Formulierung neutralisieren (P2) | A |
| O-28 | selbst publizieren | - | zu beachten | - | A |
| O-29 | Presse vorab abstimmen | - | zu beachten | - | A |
| O-30 | eine Version publiziert, eine im Review | - | zu beachten | - | A |
| O-31 | Entfernung jederzeit moeglich | - | zu beachten | - | A |
| X-1 | Annotationen bei OpenAI Required | siehe N-1 | OFFEN | P0-1 | A |
| X-2 | `_meta` erreicht das Modell nicht | `src/ui/contract.js:9-16` | ERFUELLT (Kenntnis) | keine Nutzlast in `_meta` erwarten | A |
| X-3 | OpenAI-`_meta`-Namensraeume | `openai/outputTemplate` genutzt (`src/ui/contract.js:43-46`) | TEILWEISE | bei UI-Einreichung pruefen | A |
| X-4 | Client-seitige `_meta`-Felder | keines wird gelesen | OFFEN | `openai/subject` nutzen (P1-23) | A |
| X-5 | UI-Bridge mit eigener Protokollversion `2026-01-26` | `grep "ui/initialize" src/ui/*` = 0 | OFFEN bei UI | P1-50 | A |
| X-6 | Widget-Sandbox ohne privilegierte APIs | `src/ui/widgets/*` nicht gegen diese Liste geprueft | UNKNOWN | bei UI-Einreichung pruefen | A |
| X-7 | `redirect_domains` nur als Legacy-Key | ohne UI nicht relevant | N/A | - | A |
| X-8 | Skills-Extension | nicht genutzt | N/A | - | A |
| X-9 | Multi-Account-Profil-Werkzeug | nicht vorhanden | N/A | optional | C |
| X-10 | Plugins nutzen primaer Tools: 12 Werkzeuge plus 5 statische `ui://hermes/*`-Resources aus EINER Registrierungsstelle (`src/ui/contract.js:60-77`, gerufen aus `src/mcp-tools.js:620` fuer die 5 UI-Werkzeuge `:822`, `:1074`, `:1102`, `:1177`, `:1216`), keine Resource-Templates (`grep ResourceTemplate src/` = 0), Inhalt tenant-frei und nur nach Sprache indiziert (`src/ui/contract.js:18-20`, `src/ui/widget-catalog.js:170-177`), Daten fliessen ausschliesslich ueber `structuredContent`. `resources/list`/`resources/read` laufen ueber dieselbe `mcpAuth`-Route wie `tools/call` (`src/routes/mcp.js:51`, SDK-Dispatch `mcp.js:339-380`), Master-Schalter `MCP_UI_ENABLED` Default an (`src/config.js:1574-1575`). Damit genau der von OpenAI belegte Fall "Resources fuer UI-Templates" - aber die dort als Pflicht gefuehrten `_meta.ui.csp`/`_meta.ui.domain` fehlen vollstaendig (`grep` = 0, `17-resources-flaeche.md` PP-D17-06) | `src/ui/contract.js:60-77`, `src/mcp-tools.js:620` | TEILWEISE | ohne UI einreichen oder T-30/T-31 im `chatgptRenderer` ergaenzen (`src/ui/adapters/chatgpt.js:6-10`, P1-50) | B |

## Nicht am Repo entscheidbar

Diese Punkte sind NICHT als FAIL zu werten. Sie sind offen, weil die Antwort ausserhalb dieses Repositorys liegt.

**OpenAI-Konto und Prozess**

1. Aus welchem OpenAI-Projekt eingereicht wird und ob dessen Datenresidenz global ist (T-35, P0-5).
2. Identitaetsverifikation (individual oder business), gleiche Organisation, `api.apps.write` (O-1 bis O-3).
3. Der Volltext der OpenAI Usage Policies - `https://openai.com/policies/usage-policies/` lieferte am 2026-09-18 aus der Recherche-Umgebung durchgaengig HTTP 403 (`00-openai-anforderungen.md:145-149`). Alles ueber O-19 hinaus ist bewusst nicht behauptet.
4. Ob ein Plugin, dessen Werkzeuge echte Telefonanrufe ausloesen, ueberhaupt zulaessig ist - in der gesamten Plugin- und API-Doku nicht geregelt (`:150-155`).
5. Ob OpenAI fuer kostenpflichtige oder regulierte Dienste einen Ausnahmeprozess zu O-9 kennt (P0-4).
6. Ob ChatGPT bei einem Timeout auf `tools/call` automatisch wiederholt - das entscheidet, ob P0-6 ein theoretischer oder ein sicherer Doppelanruf ist.
7. Ob OpenAIs Continuous-Review-Scan die fehlende Origin-Pruefung, fehlende Annotationen oder den Unterschied "aktuell sicher" vs. "strukturell abgesichert" ueberhaupt prueft.
8. Ob ChatGPTs realer MCP-Client Legacy-Streamable-HTTP (max. `2025-11-25`) spricht - OpenAI nennt keine Mindestversion (`:160-164`).
9. Ob ein echter ChatGPT-Host den hier nachgebauten SEP-1865-Adapter initialisiert, obwohl der dokumentierte `ui/initialize`-Handshake fehlt (X-5).
10. Ob OpenAI `sundartha.com` als Parent-Host fuer eine Challenge zu `app.sundartha.com` akzeptiert - O-5 (`00-openai-anforderungen.md:100`) sagt "MCP-Hostname oder ein Parent-Host", ohne die Parent-Definition zu nennen (P0-2, P0-11).
11. Ob T-32 auch fuer einen Host-Wechsel VOR der Publikation gilt (nur Scan und Submission erfolgt) - der Wortlaut (`:65`) spricht von "publication", die Vorstufen sind dort nicht geregelt (P0-11).

**Authorization Server (WorkOS)**

12. Der Live-Wert von `OAUTH_ISSUER_URL` (`render.yaml:360-361` `sync: false`).
13. Ob der AS CIMD oder DCR beherrscht (T-10) - ohne eines von beidem ist die Integration unmoeglich (P0-8).
14. Ob seine Metadata `code_challenge_methods_supported: ["S256"]` (T-8) und `authorization_response_iss_parameter_supported: true` (T-11) bewirbt.
15. Ob er `resource` (RFC 8707) in den Token uebernimmt - davon haengt ab, ob `OAUTH_AUDIENCE` die kanonische MCP-URL sein kann (P1-17).
16. Der Live-Wert von `OAUTH_AUDIENCE` und ob Browser-Session-Tokens dieselbe Audience tragen (geteilte `client_id`, `src/config.js:1990-1992`).
17. Ob der Issuer so konfiguriert ist, dass nur Nutzer der eigenen Organisation ein Token fuer die `/mcp`-Audience erhalten.
18. Ob WorkOS AuthKit E-Mail-Bestaetigung oder MFA verlangt (relevant fuer O-9).

**Produktionskonfiguration (Render-Dienste sind dashboard-verwaltet, `render.yaml:14-17`)**

19. Der Live-Wert von `MCP_AUTH` - der Blueprint traegt `""`, die einzige Messung ist eine Notiz (`PLAN-SECURITY.md:2052-2060`), es gibt keine Boot-Sonde (P1-18).
20. Der Live-Wert von `MULTI_TENANT` - davon haengt ab, ob P0-7 bereits wirksam oder schlafend ist.
21. Die Live-Werte von `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `CONSULT_ENABLED`, `IN_CALL_CONSULT_ENABLED` (P0-9; drei der vier Consult-Faktoren sind allerdings aus jedem `/mcp`-Handshake ablesbar, `08-...` Gegenpruefung zu PP-D8-19 - nur `IN_CALL_CONSULT_ENABLED` bleibt offen).
22. Der Live-Wert von `LLM_PROVIDER` (Anthropic oder DeepSeek, P0-9).
23. Die Live-Werte der Gates: `ALLOWED_COUNTRY_CODES` (der Wert `"*"` schaltet den Landfilter praktisch aus, `src/config.js:1475`), `MAX_CALLS_PER_HOUR`, `PER_TARGET_CALL_CAP`, `PAYMENT_ENABLED`, `OWNER_SELF_CALL_TENANT_IDS`.
24. Ob `ELEVENLABS_TENANT_TOKEN_REQUIRED` live `true` ist (P1-21).
25. Ob `DATABASE_URL` `sslmode=require` traegt (P2).
26. Ob `/healthz` als Render-Health-Check konfiguriert ist und wie ein DB-Ausfall dort wirkt.
27. Ob der Dienst je mit mehr als einer Instanz laeuft, etwa waehrend eines Rolling-Deploys (P1-42).
28. Ob `hermes-web-staging` als eigener Dienst existiert.
29. Ob die `sync: false`-Werte zwischen Staging und Produktion getrennt sind.
30. Der Live-Wert von `PUBLIC_URL` - `render.yaml` traegt ihn nicht und erklaert ihn ausdruecklich fuer unnoetig (`render.yaml:686`), die Kette faellt damit auf `RENDER_EXTERNAL_URL` (`src/config.js:1443`). Er entscheidet Token-Audience (`src/auth.js:23`, erzwungen `:83`) und `PRM.resource` (`:123`); der Leseweg am Dienst existiert (`src/elevenlabs/init-webhook-ziel.js:84`, `:103-137`). P0-10.
31. Unter welchem Host `/mcp` heute tatsaechlich angesprochen wird - der Endpunkt ist an keinen Host gebunden (`src/routes/mcp.js:51`, kein `allowedHosts`/`req.hostname`-Vergleich), und beide Kandidaten sind belegt (`render.yaml:22` Marken-Host, `src/mcp-server-info.js:13-17` Messbefund `onrender.com`). Welcher eingereicht wird, ist eine Owner-Entscheidung. P0-10, P0-11.

**Anbieter, Vertraege, Betrieb**

32. Ob der Telnyx-Key ein Scoped Key mit Spend-Limit ist (`PLAN-SECURITY.md:1109` fuehrt es als offenen Punkt).
33. Ob ElevenLabs den `tenant_token` heute tatsaechlich mitsendet - die Vorlage deklariert ihn als "PUSH-ABSICHT UND KEINE MESSUNG".
34. Ob ElevenLabs einen laufenden Gespraechsverlauf an Werkzeug-Webhooks liefert - ohne diese Tatsache ist P1-29 nicht ohne Verhaltensaenderung zu schliessen.
35. Ob der Anbieter Variablenwerte rekursiv aufloest (P1-37).
36. Ob der EL-Loeschversuch die Leitung tatsaechlich kappt - der Code sagt ausdruecklich, das sei nicht belegt (`src/routes/api-calls.js:686-689`).
37. Render-Plattform-Log-Retention und Verschluesselung ruhend (in der Policy selbst als `[OFFEN]` markiert).
38. Ob generische, praefixlose Secrets je in der Historie lagen - ein entropiebasierter Scanner ist nicht gelaufen (P1-48).
39. Der Live-Protokollstand: `initialize` und `tools/list` wurden nicht gegen einen laufenden Prozess gemessen (Sandbox-Abbruch, `01-...` PP-D1-11).

## Wo anzufangen waere

Reine Reihenfolge-Empfehlung, keine Loesungsentwuerfe.

**Etappe 1 - klaeren und entscheiden, bevor gebaut wird.** P0-11 (unter welchem Host und Origin eingereicht wird), P0-10 (`PUBLIC_URL` ausdruecklich darauf festlegen), P0-5, P0-8, sowie die Punkte 1 bis 18 und 19 bis 24 aus "Nicht am Repo entscheidbar", dazu die Punkte 30 und 31 (Live-Wert von `PUBLIC_URL`, tatsaechlich angesprochener Host). Begruendung: P0-8 kann die Einreichung unabhaengig von jeder Codeaenderung unmoeglich machen. P0-11 geht der gesamten Etappe 2 voraus, weil T-32 den Origin mit der Publikation einfriert (`00-openai-anforderungen.md:65`) und die Challenge-Route auf genau diesen Host oder dessen Parent gehoert (O-5, `:100`) - vor der Entscheidung gebaut ist sie Wegwerf-Arbeit, und eine Einreichung unter dem heutigen Fallback-Origin macht den in `CLAUDE.md` als offen dokumentierten Track-B-Cutover zu einem NEUEN Plugin mit neuem Review. Die Live-Schalterstaende entscheiden ueber die Schwere von P0-7, P0-9, P1-21, P1-29 und P1-33 - wer vorher baut, baut moeglicherweise am falschen Ende.

**Etappe 2 - die formalen Einreichungs-Voraussetzungen.** P0-2 (erst nach der Origin-Entscheidung aus Etappe 1, sonst sitzt die Route auf dem falschen Host), P0-3, P0-4, P0-9, dazu O-11 und die noch fehlenden Reproduktionsdaten zu den 19 bereits vorliegenden Testfaellen (O-10, `tasks/openai-audit/16-review-testfaelle.md`). Begruendung: das sind abgeschlossene, voneinander unabhaengige Arbeiten ohne Eingriff in die Laufzeit; sie blockieren die Einreichung, kosten aber kein Risiko.

**Etappe 3 - die Werkzeug-Metadaten.** P0-1, dann P1-4, P1-5, P1-6, P1-7, P1-8, P1-9, sowie `title` (P2). Begruendung: P0-1 ist der dokumentierte Ablehnungsgrund mit der besten Aufwand-Wirkung-Relation, und die uebrigen Punkte sitzen in denselben zwoelf Deskriptoren - sie einmal anzufassen statt fuenfmal ist der guenstigere Weg.

**Etappe 4 - was einen Dritten real treffen kann.** P0-6, dann P1-22, P1-25, P1-26, P1-28, P1-23. Begruendung: das ist die einzige Gruppe, in der ein Defekt einen unbeteiligten Menschen anruft oder ihm etwas vorspricht; sie geht allem Uebrigen im Code vor.

**Etappe 5 - die Mandantengrenze und der Endpunkt selbst.** P0-7, P0-12 (Origin-Pruefung auf `/mcp`, code-lokal und von allem Uebrigen unabhaengig), dann P1-12, P1-20, P1-21 und der Test aus P1-43/P1-44, der die Trennung unter der tatsaechlichen Produktions-Konfiguration beweist. Begruendung: eine oeffentliche Integration bedeutet viele Endnutzer an einem Endpunkt; solange die Grenze an einer Umgebungsvariablen haengt, ist jede andere Haertung zweitrangig.

**Etappe 6 - Beschreibungen und Fremdtext.** P1-1, P1-2, P1-3, P1-32, P1-33, P1-29, P1-30, P1-31. Begruendung: P1-1 ist der Punkt, an dem ein Anruf laeuft und das Ergebnis niemanden erreicht - ein Produktdefekt im Zielclient, der sich bei der Review unmittelbar zeigt; die uebrigen betreffen die Behandlung fremder Rede und haengen an derselben Entscheidung, wie Herkunft markiert wird.

**Etappe 7 - Auth-Feinheiten.** P1-10, P1-11, P1-13, P1-14, P1-15, P1-16, P1-17, P1-18, P1-19. Begruendung: alles davon ist fuer die Einreichung nicht formal erforderlich, aber jeder Punkt kostet im Betrieb Sichtbarkeit oder Least Privilege; sie liegen dicht beieinander in `src/auth.js` und `src/routes/mcp.js`.

**Etappe 8 - Daten, Aufbewahrung, Loeschung.** P1-39, P1-40, P1-41, P1-34, dazu die Retention-Punkte aus P2. Begruendung: das Loeschversprechen der Policy ist der einzige Punkt, an dem eine oeffentliche Zusage dem Code nachweislich widerspricht (O-6); der Rest derselben Gruppe folgt daraus.

**Etappe 9 - Tests und Betrieb.** P1-43, P1-44, P1-45, P1-46, P1-47, P1-42, dann die P2-Liste. Begruendung: Regressionsschutz sichert die Etappen 3 bis 8 ab, statt sie vorzubereiten - deshalb danach, aber vor der Einreichung, weil T-33 einen wiederkehrenden Scan vorsieht.
