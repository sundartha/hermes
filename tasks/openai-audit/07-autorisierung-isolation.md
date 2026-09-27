# Autorisierung, Mandantentrennung, IDOR

Dimension: D7 | Quelle: Code auf Branch master

## Kurzfassung

Die Tenant-Identitaet stammt strukturell NIE aus der Tool-Eingabe - kein MCP-Tool nimmt eine
tenantId entgegen, jede Aufloesung laeuft ueber `makeTenantResolver`/`requestTenant`
(`src/routes/_tenant.js:144-168`). Die Besitzpruefung jeder uebergebenen `call_id` existiert
(`callVisibleTo`, `tenantOwnsCall`) - aber SIE IST AN `config.tenancy.multiTenant` GEKNUEPFT
und der Default ist `false` (`src/config.js:1570`). Bei `MULTI_TENANT=false` verwirft
`requestTenant` in Zeile 145 den am Gateway aufgeloesten Tenant, bevor der weitergereichte
`X-Internal-Tenant`-Header in Zeile 150 ueberhaupt gelesen wird; jeder Aufrufer, der
`mcpAuth` passiert, landet auf dem Bootstrap-/Owner-Tenant mit `OWNER_PROFILE`. Schlimmster
Befund: in der im Repo hinterlegten Deploy-Konfiguration (`render.yaml:353-358` MCP_AUTH=""
+ generiertes Einzel-Token, `render.yaml:666-667` MULTI_TENANT=false) sieht und steuert JEDER
Inhaber des einen Bearer-Tokens die Daten, Nummer, Inbox und das Budget des Owners - inklusive
`place_call`. Nur die Kombination `MCP_AUTH=oauth` UND `MULTI_TENANT=true` ergibt echte
Mandantentrennung; Postgres-RLS traegt sie NICHT, weil der pg-Store beim Boot alle Tenants in
einen globalen In-Memory-Spiegel hydriert und jede Anfrage gegen diesen Spiegel liest.

## Pruefpunkte

### PP-D7-01 Wird die Tenant-Identitaet aus dem verifizierten Token abgeleitet oder kann sie aus der Eingabe stammen?
- Status: PASS
- Evidenz: `src/routes/mcp.js:61` - `const scopedTenant = requestTenant(req)`; `src/routes/_tenant.js:152` liest ausschliesslich `req.auth.sub` (jose-verifiziertes JWT, `src/auth.js:80-86`). Keine Route liest einen Tenant aus Body/Query/Params: Grep nach `body.tenantId|body.tenant_id|query.tenant|params.tenant` ueber `src/` = 0 Treffer. Kein MCP-Tool-Schema traegt ein Tenant-Feld (`src/mcp-tools.js`, `inputSchema` aller 12 Tools).
- Risiko: keines an dieser Stelle.
- Empfehlung: Zustand halten; bei neuen Tools kein Tenant-/Owner-Feld im `inputSchema` zulassen.
- Prioritaet/Kategorie: - / B

### PP-D7-02 Kollabiert die Tenant-Achse bei MULTI_TENANT=false auf einen einzigen (Owner-)Tenant?
- Status: FAIL
- Evidenz: `src/routes/_tenant.js:145` - `if (!config.tenancy.multiTenant) return operatorChannelTenant(req);` steht VOR der Auswertung von `internalTenant(req)` (Zeile 150) und vor `req.auth.sub` (Zeile 152). `operatorChannelTenant` (Zeile 98-99) liefert fuer jeden Loopback-Aufruf ohne `X-Forwarded-For` `BOOTSTRAP_TENANT_ID`. Genau so kommt jeder MCP-Tool-Aufruf herein: `src/mcp-tools.js:56-66` ruft `resolveGatewayUrl() + path` ueber localhost; `src/wiring/internal-only.js:25` laesst ihn durch. Der am Gateway korrekt auf `reject` aufgeloeste Wert (`src/mcp-tools.js:59`, Header `X-Internal-Tenant`) wird dabei nie gelesen. Folge im Geldpfad: `src/telephony/outbound-gates.js:680` setzt `ctx.tenantId = requestTenant(ctx.req)` -> BOOTSTRAP; das Gate `tenant_reject` (Zeile 687-696) feuert nie; `resolveProfileFrom` (`src/store/defaults.js:1087`) pinnt BOOTSTRAP hart auf `OWNER_PROFILE` (`maxCallsPerHour: null`, Zeile 1064). `config.js:1570` setzt den Default `false`, `render.yaml:666-667` setzt ihn explizit auf `"false"`.
- Risiko: Jeder Aufrufer, der `mcpAuth` passiert, liest in ChatGPT die Anrufe, Transkript-Auszuege, Action Items, Inbox und Rufnummer des Owners (`GET /api/state`, `POST /api/inbox/poll`) und loest auf dessen Nummer, Abo und Kostendecke echte Anrufe aus. Es gibt in dieser Konfiguration keine zweite Barriere - die Ownership-Pruefungen sind mit demselben Flag deaktiviert (PP-D7-04).
- Empfehlung: `MULTI_TENANT=true` zur Vorbedingung des /mcp-Mounts machen (Boot-Refusal in `src/boot-guard.js`, Muster `MCP_AUTH=off`-Befund `src/config.js:2345`), statt es als Laufzeit-Flag zu fuehren; alternativ die Flag-Abfrage aus `requestTenant`/`callVisibleTo` entfernen und das Scoping unbedingt machen.
- Prioritaet/Kategorie: P0 / B

### PP-D7-03 Traegt der heute konfigurierte MCP-Auth-Modus ueberhaupt eine Nutzeridentitaet?
- Status: FAIL
- Evidenz: `render.yaml:353-354` setzt `MCP_AUTH: ""`, `render.yaml:357-358` `MCP_AUTH_TOKEN: generateValue: true`. Im Legacy-/Token-Modus vergleicht `src/auth.js:110` nur `safeEqual(req.headers.authorization, "Bearer " + token)` und setzt `req.auth` NICHT. Ohne `req.auth` gibt es keinen `sub` (`src/routes/_tenant.js:152`). Der Kommentar `render.yaml:14-17` sagt ausdruecklich, dass der Service dashboard-managed ist und die Live-Werte fuer MULTI_TENANT abweichen - der Repo-Stand belegt den Live-Wert also nicht (s. Offene Fragen).
- Risiko: Ein einziges geteiltes Bearer-Token ist per Konstruktion eine Identitaet. Fuer eine oeffentliche ChatGPT-Integration mit mehreren Endnutzern ist dieser Modus nicht tragfaehig - jeder Nutzer waere derselbe Mandant.
- Empfehlung: Fuer die oeffentliche Integration `MCP_AUTH=oauth` verbindlich setzen (Issuer/Audience sind bereits verdrahtet, `src/auth.js:23-24`, `src/auth.js:80-86`) und den Token-Modus fuer diesen Endpunkt sperren.
- Prioritaet/Kategorie: P0 / B

### PP-D7-04 Wird jede uebergebene call_id serverseitig gegen den Besitzer geprueft, und wo?
- Status: PARTIAL
- Evidenz: Die Pruefstelle existiert genau dreimal: `src/routes/api-calls.js:319` (`callVisibleTo`, genutzt Zeile 644 fuer `POST /api/calls/:id/cancel`, Zeile 583-586 fuer `GET /api/calls/:id/consult`, Zeile 618-619 fuer `POST /api/calls/:id/consult/answer`) und `src/routes/api-read.js:105` fuer `GET /api/calls/:id` (bedient `get_call_status`, `get_transcript` und den done-Zweig von `await_call_event`, `src/mcp-tools.js:882/971/1023`). Alle vier Stellen tragen dieselbe Bedingung `config.tenancy.multiTenant && ...` bzw. `!config.tenancy.multiTenant || tenantOwnsCall(...)`. Das Praedikat selbst ist strikte Gleichheit (`src/routes/_tenant.js:105`). Der Lookup dahinter ist global ueber alle Mandanten: `src/store/state-ops.js:496-498` - `s.calls.find((c) => c.id === id || c.twilioSid === id)`, ohne Tenant-Argument.
- Risiko: Die Trennung haengt an einem Env-Flag statt an der Datenzugriffsschicht. Faellt das Flag (Fehlkonfiguration, neuer Service, Rollback), liefert `getCall` sofort fremde Anruf-Datensaetze inklusive Transkript-Auszuegen - der Store selbst kennt keine Grenze.
- Empfehlung: Tenant-gescopte Lesefunktion (`getCallFor(tenantId, id)`) in `state-ops.js` einfuehren und `getCall` fuer Request-Pfade nicht mehr exportieren; die Flag-Bedingung an allen vier Stellen streichen.
- Prioritaet/Kategorie: P0 / B

### PP-D7-05 Sind die uebrigen MCP-Operationen (Inbox, Action Items, Nummer, Status, Kalender) tenant-gescopt?
- Status: PARTIAL
- Evidenz: `POST /api/inbox/poll` nimmt keine ID entgegen und scopet ueber `requireTenant` (`src/routes/api-inbox.js:41-49`, `store.takeInboxEntries(tenantId, ...)`) - hier gilt die Flag-Abhaengigkeit ebenfalls, aber es gibt kein fremdes Objekt zu adressieren. `GET /api/state` (Quelle fuer `list_calls`, `list_action_items`, `get_my_number`, `get_agent_status`, `get_calendar`; `src/mcp-tools.js:1077/1105/1150/1180/1219`) filtert ueber `store.exportTenantData(tenantId)` -> `tenantCallScope` (`src/store/state-ops.js:529-531`, strikte Gleichheit) und `activeNumberFor(s, tenantId)` (`src/routes/api-read.js:70-89`) - aber nur `if (config.tenancy.multiTenant)` (Zeile 70); sonst wird der ungefilterte Gesamtzustand `s` ausgeliefert.
- Risiko: Bei ausgeschaltetem Flag liefert `list_calls` die Anrufliste ALLER in diesem Store liegenden Mandanten, nicht nur die des Owners (Zeile 70: `: s`).
- Empfehlung: Wie PP-D7-04 - Scoping unbedingt machen; `/api/state` niemals ungefiltert antworten lassen.
- Prioritaet/Kategorie: P0 / B

### PP-D7-06 Sind die Objekt-IDs erratbar?
- Status: FAIL
- Evidenz: `src/store/state-ops.js:195-197` - `newId(prefix) = prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`. Erzeugungsstelle fuer Calls: `src/store/state-ops.js:266` (`id: newId("call")`), fuer Action Items Zeile 1866, fuer Kalendereintraege Zeile 1918. Der Zufallsanteil sind vier Base36-Zeichen (ca. 1,68 Mio Werte) aus `Math.random` - kein CSPRNG; die Datei nutzt an anderer Stelle sehr wohl `crypto.randomBytes` (Zeile 270, `streamToken`). Zum Vergleich: der Consult-Ereignis-Anker wird ueber ein Formatpraedikat gefiltert (`isConsultEventId`, Zeile 1263), die call_id nicht.
- Risiko: Die Ratbarkeit ist die zweite Verteidigungslinie hinter der Ownership-Pruefung. Ein Aufrufer, der eigene call_ids erzeugen kann, kennt Zeitstempel-Praefix und Ausgabefolge von `Math.random` (V8 xorshift128+ ist aus wenigen Ausgaben rekonstruierbar) - Enumeration fremder call_ids ist damit realistisch, sobald die Ownership-Pruefung ausfaellt (PP-D7-02/04). Der globale Per-IP-Limiter (`src/app.js:130-136`, `src/middleware.js:118-140`) bremst, verhindert es nicht.
- Empfehlung: `newId` auf `crypto.randomBytes(16).toString("hex")` umstellen (Muster steht vier Zeilen entfernt, Zeile 270); Format der `call_id` am Eingang praefixseitig validieren.
- Prioritaet/Kategorie: P1 / C

### PP-D7-07 Greift Postgres Row Level Security auf den Anfrage-Pfaden - und was tut das JSON-Backend?
- Status: FAIL
- Evidenz: RLS existiert, wirkt aber nur waehrend der Boot-Hydrierung und beim Flush: `src/store/pg.js:955-958` (`setTenant` -> `set_config('app.current_tenant', ...)`), `src/store/pg.js:965-969` (`hydrateTenant`), `src/store/pg.js:974-984` (`hydrate` laeuft in einer Schleife ueber ALLE Tenants und schreibt alle Zeilen in EINEN `state`), `src/store/pg.js:1771` und `:2718` (transaktionslokale GUC im Schreibpfad). Zur Anfragezeit liest der Store keinen SQL: `src/store/pg.js:200` - `load: () => requireState()`, `src/store/pg.js:210` - `getCall: (id) => ops.getCall(requireState(), id)`. `requireState()` ist der globale Spiegel aller Mandanten. Mehrere Tabellen sind ausdruecklich RLS-exempt (`src/store/pg.js:1075-1077` account, `:986-988` profile). Das JSON-Backend hat ueberhaupt keine Zugriffsschicht: `src/store/json.js:432-434` reicht `ops.getCall(load(), id)` durch.
- Risiko: RLS ist hier KEINE Mandantengrenze fuer Leseanfragen, sondern eine Absicherung der Hydrierung/des Flushs. Jede Aussage der Form "Postgres RLS schuetzt uns" ist fuer den MCP-Lesepfad falsch; die einzige echte Grenze ist die Anwendungs-Filterung aus PP-D7-04/05 - also das Env-Flag.
- Empfehlung: In der Dokumentation (README/PLAN-SECURITY.md) klarstellen, dass RLS nicht request-scoped wirkt; die Anwendungs-Filterung entsprechend als einzige Grenze behandeln und testen (Fuzz/Property-Test ueber alle MCP-erreichbaren Routen mit zwei Mandanten).
- Prioritaet/Kategorie: P1 / B

### PP-D7-08 Ist der In-Process-Header-Kanal (X-Internal-Tenant / X-Internal-Identity) faelschbar?
- Status: PASS
- Evidenz: `src/routes/_tenant.js:54-58` - `trustedLocalHeader` liest den Header NUR bei `isTrustedLocalCaller(req)`; das ist `isLocalSocket(req) && !isProxyForwarded(req)` (Zeile 44), also echter Loopback-Socket UND kein `X-Forwarded-For` (Zeile 34). Dieselbe Grenze bewacht alle internen Routen (`src/wiring/internal-only.js:24-28`). Der Kommentar Zeile 36-43 belegt, warum die Socket-Adresse allein nicht genuegt (hinter Render ist jeder externe Request Loopback).
- Risiko: Die Grenze haengt daran, dass der vorgelagerte Proxy `X-Forwarded-For` IMMER setzt und ein Client ihn nicht unterdruecken kann. Faellt der Proxy weg oder wird der Port direkt exponiert, kippt die Aussage. Das ist eine Topologie-Annahme, kein Code-Beweis.
- Empfehlung: Annahme explizit absichern - z.B. zusaetzlich ein prozess-internes Einmal-Geheimnis (beim Boot erzeugt) als Pflicht-Header auf den internalOnly-Routen verlangen, statt allein auf das Fehlen von XFF zu bauen.
- Prioritaet/Kategorie: P2 / C

### PP-D7-09 Sind Admin-/Betreiber-Funktionen ueber MCP erreichbar?
- Status: PASS
- Evidenz: Alle Admin-Routen haengen an Browser-Session plus Rollenpruefung: `src/web-auth.js:897/905/924` (`webAuthMw, adminMw`), `src/wiring/operator-routes.js:31` (`register(path, operatorAuth.webAuthMw, operatorAuth.adminMw, handler)`), Rollenpruefung `src/web-auth.js:871`. Die MCP-Tools rufen ausschliesslich `/api/calls*`, `/api/state`, `/api/inbox/poll` (`src/mcp-tools.js:825, 880, 882, 934, 971, 1023, 1061, 1077, 1105, 1133, 1150, 1180, 1219`) - keine `/api/admin/*`, keine `/api/onboard*`, keine Betreiber-Billing-Route.
- Risiko: keines an dieser Stelle.
- Empfehlung: -
- Prioritaet/Kategorie: - / B

### PP-D7-10 Wird die call_id sicher in die interne REST-URL eingesetzt?
- Status: PARTIAL
- Evidenz: `src/mcp-tools.js:880` (`/api/calls/${call_id}/consult${query}`), `:882`, `:934`, `:971`, `:1023`, `:1061` - `call_id` wird roh interpoliert. Das Schema ist nur `z.string()` (`src/mcp-tools.js:868`, `:1059`), es gibt keine Formatpruefung. Der Nachbarwert `after_event_id` wird korrekt kodiert (`src/mcp-tools.js:879`, `encodeURIComponent`) - die Inkonsistenz ist im selben Ausdruck sichtbar.
- Risiko: Ein `call_id` mit `../`, `?` oder `#` verschiebt den internen Aufruf auf eine andere `internalOnly`-Route (z.B. `POST /api/calls/../inbox/poll` -> Inbox des eigenen Tenants wird konsumiert, obwohl der Nutzer `cancel_call` aufgerufen hat) oder haengt Query-Parameter an. Cross-Tenant ist damit nach heutigem Routenbestand nicht erreichbar (alle Zielrouten scopen selbst), die Methodenwahl des Aufrufers laesst sich aber umlenken.
- Empfehlung: `encodeURIComponent(call_id)` an allen sechs Stellen und ein Formatpraedikat analog `isConsultEventId` (`src/store/state-ops.js:1263`) am Tool-Eingang.
- Prioritaet/Kategorie: P2 / C

### PP-D7-11 Kann ein Webhook-Ereignis oder eine Consult-Antwort eine fremde Sitzung treffen?
- Status: PARTIAL
- Evidenz: Der Consult-Weg ueber MCP ist sauber: `POST /api/calls/:id/consult/answer` prueft Reihenfolge Tenant -> Ownership -> Faehigkeit (`src/routes/api-calls.js:615-619`), und `waitForEvent` bekommt `tenantId: call.tenantId` aus dem bereits besitz-geprueften Datensatz (`src/routes/api-calls.js:595`). Der Anbieter-Weg ist schwaecher: `src/routes/webhooks-elevenlabs.js:209-221` bindet ueber `activeCallBoundTo(store, req.body?.conversation_id)` (`:164-173`, globale Suche ueber `store.load().calls`) plus `tenantTokenVerdict`. Das Mandanten-Token ist per Default NICHT verlangt: `src/config.js:787-791` `elevenLabsTenantTokenRequired` fallback `false`, ausgewertet in `src/routes/webhooks-elevenlabs.js:218` - ein FEHLENDER Wert wird akzeptiert. Davor steht nur EIN globales, fuer alle Mandanten identisches Geheimnis (`src/config.js:777` `ELEVENLABS_TOOL_TOKEN`, Routen als public deklariert in `src/route-policy.js:124` und `:139`). Wirkung im fremden Mandanten: `src/routes/webhooks-elevenlabs.js:282` bucht `bookLookupSearchFee({ tenantId: call.tenantId })`, Zeile 344 liest dessen Budget-Achse.
- Risiko: Wer das eine globale Werkzeug-Geheimnis besitzt (es liegt in der Agenten-Konfiguration beim Anbieter, nicht bei uns) und eine laufende `conversation_id` kennt oder erraet, wirkt in ein fremdes, laufendes Gespraech hinein und bucht Kosten auf dessen Mandanten. Nicht ueber MCP erreichbar, aber es ist eine Mandantengrenze.
- Empfehlung: `ELEVENLABS_TENANT_TOKEN_REQUIRED=true` scharf schalten, sobald die Werkzeug-Definition beim Anbieter den abgeleiteten Wert sendet - der Code-Pfad dafuer existiert bereits (`src/elevenlabs/tenant-tool-token.js:51-67`).
- Prioritaet/Kategorie: P1 / B

### PP-D7-12 Werden Recherche-/Lookup-Ergebnisse tenant-isoliert?
- Status: PASS
- Evidenz: `src/research/` enthaelt keinen geteilten Cache (Dateien: `in-call.js`, `lookup-guard.js`, `ports.js`, `registry.js`, `sanitize.js`, `adapters/`; Grep nach `cache`/`new Map(` = 0 Treffer). Jeder Lookup haengt am gebundenen, aktiven Anruf und bucht auf dessen Mandanten (`src/routes/webhooks-elevenlabs.js:282`); das Ergebnis geht nur in dieses Gespraech (`:297-307`).
- Risiko: keines an dieser Stelle. Die Bindung selbst haengt an PP-D7-11.
- Empfehlung: Bei Einfuehrung eines Ergebnis-Caches den Schluessel zwingend mit `tenantId` praefixen.
- Prioritaet/Kategorie: - / C

### PP-D7-13 Ist die Mandantentrennung getestet - und unter welcher Konfiguration?
- Status: PARTIAL
- Evidenz: `test/read-scope-tenant.test.js:113/142/174` und `test/i6-write-scope.test.js:39/80` starten den Server jeweils mit `env: { MULTI_TENANT: "true" }`; `test/am6-oauth-tenant.test.js:31` ebenso (plus `MCP_AUTH=oauth`). `test/read-scope-tenant.test.js:201` haelt ausdruecklich fest, dass der Fall ohne Flag ("BASE_ENV: false") das UNGEFILTERTE Verhalten ist - der Bestand testet also das Gegenteil als Soll.
- Risiko: Die gruene Testsuite belegt Mandantentrennung NUR fuer die Konfiguration, die heute nicht die dokumentierte Deploy-Konfiguration ist. Ein Leser schliesst aus "Tenant-Tests gruen" faelschlich auf "produktiv getrennt".
- Empfehlung: Einen Test ergaenzen, der mit der tatsaechlichen Produktions-Env (MCP_AUTH/MULTI_TENANT wie live) beweist, dass zwei verschiedene OAuth-Identitaeten NICHT dieselben Daten sehen - er wuerde heute rot.
- Prioritaet/Kategorie: P1 / B

## Offene Fragen (nicht am Repo entscheidbar)

- Welchen Wert haben `MULTI_TENANT` und `MCP_AUTH` im Live-Service? `render.yaml:14-17` erklaert den Service ausdruecklich fuer dashboard-managed und nennt MULTI_TENANT als abweichend; die Datei ist damit Referenz, nicht Wahrheit.
- Ist der OAuth-Issuer (WorkOS) so konfiguriert, dass nur Nutzer der eigenen Organisation ein Token fuer die `/mcp`-Audience erhalten? `src/auth.js:80-86` prueft Issuer und Audience, aber keine Organisations- oder Scope-Claim - wer sonst noch Tokens dieses Issuers bekommt, steht nicht im Repo.
- Existiert fuer neue OAuth-subs ohne Tenant ein automatischer Provisioning-Pfad ueber /mcp? `resolveTenant` liefert fuer unbekannte subs `null` -> `TENANT_REJECT` (`src/store/state-ops.js:5287-5296`); ob ChatGPT-Nutzer vorher im Web-Onboarding einen Tenant anlegen, ist eine Produktfrage, keine Code-Aussage.
- Wird `ELEVENLABS_TOOL_TOKEN` je Mandant oder global in der Anbieter-Agenten-Konfiguration hinterlegt? Der Code kennt nur einen Wert (`src/config.js:777`); die Verteilung liegt beim Anbieter.

## Randbefund (ausserhalb dieser Dimension)

`GET /api/tenant-data/export` (`src/routes/api-read.js:119-129`) liefert den vollstaendigen
Mandanten-Export inkl. unmaskierter Privatnummer und Roh-Transkripten hinter derselben
`internalOnly`-Schranke wie die MCP-Tools. Es ist heute kein MCP-Tool - ein kuenftiges Tool auf
dieser Route waere ein Bulk-Datenabfluss ueber ChatGPT.

## Gegenpruefung

- PP-D7-02: BESTAETIGT - `src/routes/_tenant.js:145` short-circuitet vor `internalTenant` (:150)/`req.auth.sub` (:152), der interne Hop ist echtes Loopback ohne XFF (`src/mcp-tools.js:56-60`, `src/wiring/internal-only.js:24-28`) und faellt damit auf `BOOTSTRAP_TENANT_ID`; ein Gegen-Gate existiert an keiner Stelle (einzige Abschwaechung: das Gateway-Rechteprofil des externen Aufrufers ist DEFAULT_PROFILE, `src/routes/mcp.js:61/76` + `src/store/defaults.js:1086-1088`, weshalb Kalender-/Consult-Werkzeuge nicht registriert werden - Lesen und `place_call` bleiben).
- PP-D7-03: BESTAETIGT - `src/auth.js:104-112` vergleicht nur das statische Token und setzt `req.auth` nicht; ergaenzend belegt: unter `MULTI_TENANT=true` ist dieser Modus nicht leck, sondern TOT (Gateway liefert `TENANT_REJECT`, `src/routes/_tenant.js:147-163` -> 403/leer, gedeckt von PLAN-SECURITY.md:2098-2100), die Gefahr entsteht erst in Kombination mit Flag aus.
- PP-D7-04: BESTAETIGT, sogar untertrieben - `src/routes/api-calls.js:319` und `src/routes/api-read.js:105` tragen die Flag-Bedingung, und bei Flag aus ist nicht nur Lesen moeglich: `POST /api/calls/:id/consult/answer` (`src/routes/api-calls.js:615-640`) und `POST /api/calls/:id/cancel` (:642-645) wirken ueber dieselbe Bedingung SCHREIBEND in ein fremdes laufendes Gespraech (s. GP-02).
- PP-D7-05: BESTAETIGT - `src/routes/api-read.js:70` liefert bei Flag aus den Roh-State (`: s`), und der Mehr-Tenant-Zustand ist auch bei Flag aus real, weil der Web-Login-Dedup ohne Flag-Abfrage Tenants anlegt (`src/web-auth.js:529-546`).
- PP-D7-07: BESTAETIGT - `src/store/pg.js:979-991` hydriert in einer Schleife alle Tenants in EINEN Spiegel, `:200` (`load`) und `:210` (`getCall`) lesen nur ihn; RLS wirkt an Hydrierung (`:965-969`) und Flush, nicht zur Anfragezeit.
- PP-D7-06: BESTAETIGT als Fakt, Risiko ueberzeichnet - `src/store/state-ops.js:195-197` ist `Date.now` + 4 Base36-Zeichen aus `Math.random` (vier Zeilen ueber `crypto.randomBytes`, :270), aber die Enumeration bringt in KEINER Konfiguration einen Gewinn (Flag an -> `src/routes/api-read.js:105` antwortet 404; Flag aus -> `:70` liefert die Liste ohnehin unaufgefordert) -> P2/C statt P1.
- PP-D7-11: BESTAETIGT - `src/routes/webhooks-elevenlabs.js:216-219` akzeptiert das Urteil FEHLT, solange `src/config.js:787-791` (Fallback `false`) aus ist, und die Wirkung bucht auf `call.tenantId` (:282/:344); die Empfehlung des Erst-Auditors greift aber nur die halbe Luecke (s. GP-04).
- PP-D7-13: BESTAETIGT - `test/read-scope-tenant.test.js:198-215` pinnt den Flag-aus-Fall ausdruecklich als ungefiltertes Soll ("B-Call bleibt sichtbar (ungefiltert)"), alle Trennungsbeweise laufen mit `env: { MULTI_TENANT: "true" }` (:113/:142/:174, `test/i6-write-scope.test.js:39/:80`).

### Vom Erst-Auditor uebersehen

#### PP-D7-GP-01 /mcp hat keine eigene Autorisierungsstufe - ein Token ohne Tenant wird am Tor nicht abgewiesen
- Status: PARTIAL
- Evidenz: `src/routes/mcp.js:61` - `const scopedTenant = requestTenant(req)`; der Wert wird geloggt (:63-69) und als Profil-Schluessel benutzt (:76), aber NIE gegen `TENANT_REJECT` geprueft. Die Sitzung wird aufgebaut, `registerTools` (:95-102) registriert Werkzeuge, die Ablehnung faellt erst je Route (`src/routes/_tenant.js:171-177`) - und bei Flag aus wird der hereingereichte `reject`-Wert auf dem internen Hop sogar verworfen (`:145` vor `:150`).
- Risiko: Die Tenant-Autorisierung ist auf N Routen verteilt statt an einer Tuer; jede neue interne Route muss die Regel erneut mitbringen. Genau dieser fehlende Torschluss ist die strukturelle Ursache von PP-D7-02.
- Empfehlung: Am `/mcp`-Handler nach `requestTenant` hart abbrechen, wenn der Tenant `TENANT_REJECT` ist; zusaetzlich `MULTI_TENANT=false` fuer das Hosting fatal machen - das Muster existiert und ist scharf (`src/config.js:2337-2347` PRODUCTION_FOOTGUNS -> `:2491` `fatalConfigFindings`, Boot-Verweigerung, nicht Warnung).
- Prioritaet/Kategorie: P1 / B

#### PP-D7-GP-02 Bei Flag aus ist der Cross-Tenant-Zugriff SCHREIBEND, nicht nur lesend
- Status: FAIL
- Evidenz: `src/routes/api-calls.js:615-618` - `requireTenant` liefert bei Flag aus BOOTSTRAP (kein 403), `callVisibleTo` (:319) ist ohne Flag immer true, `consultAllowedFor(store.resolveProfile(BOOTSTRAP))` ist wegen OWNER_PROFILE `allowConsult: true` (`src/store/defaults.js:1061`) erfuellt; `answerConsultFinal` (:175-193) schreibt den Text dann in `call.context.key_facts` eines FREMDEN Anrufs. Dieselbe Kette bei `POST /api/calls/:id/cancel` (:642-645) legt ein fremdes laufendes Gespraech auf.
- Risiko: Ein Inhaber des geteilten Bearer-Tokens kann fremdem Gespraech Inhalte unterschieben (der Text reist in den Systemprompt des sprechenden Modells) und fremde Gespraeche abbrechen - Integritaet und Verfuegbarkeit, nicht nur Vertraulichkeit.
- Empfehlung: Ownership unbedingt pruefen (Flag-Bedingung in `callVisibleTo` streichen), damit der Schreibpfad nicht an derselben Env-Variable haengt wie der Lesepfad.
- Prioritaet/Kategorie: P0 / B

#### PP-D7-GP-03 In der kollabierten Konfiguration ist das Rechteprofil als Bremse strukturell unwirksam
- Status: FAIL
- Evidenz: `src/store/defaults.js:1086-1088` - `resolveProfileFrom` gibt fuer `BOOTSTRAP_TENANT_ID` hart `OWNER_PROFILE` zurueck und ignoriert ein gespeichertes `s.profiles[BOOTSTRAP]` ausdruecklich (Kommentar :1053-1055); OWNER_PROFILE traegt `maxCallsPerHour: null` (:1064) und alle Faehigkeiten auf `true` (:1059-1063). `PROFILES_JSON` (`render.yaml:346-349`) kann daran nichts aendern.
- Risiko: Bei Flag aus laufen alle MCP-Aufrufer auf BOOTSTRAP - also ohne Stundenlimit und mit voller Faehigkeitsmenge. Der Betreiber hat in genau der Konfiguration, in der er eine Bremse braeuchte, keine.
- Empfehlung: Die Owner-Pinnung an eine explizite Betreiber-Kennzeichnung binden statt an die Tenant-ID, oder ein gespeichertes BOOTSTRAP-Profil restriktiv mergen lassen.
- Prioritaet/Kategorie: P1 / C

#### PP-D7-GP-04 Der starke Bindungsmechanismus existiert im Repo, wird von den Werkzeug-Webhooks aber nicht benutzt
- Status: PARTIAL
- Evidenz: `src/routes/webhooks-elevenlabs-init.js:158-168` bindet den Anruf ueber den pro Anruf erzeugten CSPRNG-Wert `call.streamToken` (`src/store/state-ops.js:270`) mit `safeEqual`; die beiden Werkzeug-Webhooks binden dagegen nur ueber die Anbieter-Kennung `conversation_id` (`src/routes/webhooks-elevenlabs.js:158-171`). Der abgeleitete Mandanten-Token schuetzt laut eigenem Modulkopf NICHT gegen einen Angreifer, der Plattform-Token und Mandanten-Kennung besitzt (`src/elevenlabs/tenant-tool-token.js:22-26`).
- Risiko: Die Empfehlung "Flag scharf schalten" (PP-D7-11) nimmt dem Token nur die Quer-Mandanten-Reichweite; wer das Plattform-Geheimnis hat, rechnet den Wert weiterhin selbst aus. Ein pro-Anruf-Geheimnis waere nicht berechenbar.
- Empfehlung: Denselben pro-Anruf-Wert wie im Init-Webhook als `request_body_schema`-Property mitfuehren und gegen `call.streamToken` pruefen, statt eine aus dem Mandanten abgeleitete Konstante zu vergleichen.
- Prioritaet/Kategorie: P1 / C

#### PP-D7-GP-05 Routen-Klasse und einziger realer Aufrufer passen bei der Karten-Rueckkehr nicht zusammen
- Status: PARTIAL
- Evidenz: `src/routes/api-billing.js:105` setzt `successUrl` auf `${publicUrl}/api/billing/checkout-return?...` - ein Ziel, das der Browser des Kunden aufruft; die Route selbst steht hinter `internalOnly` (:214), das jeden Proxy-Request (XFF gesetzt) mit 403 ablehnt (`src/wiring/internal-only.js:24-27`).
- Risiko: Der Pfad ist aus dem Browser strukturell unerreichbar (toter Geldpfad). Die Gefahr ist die Reparatur: wer `internalOnly` hier lockert, oeffnet eine Geld-Route, deren einzige Bindung eine `session_id` aus der Query ist (`:217-224`, Customer-Match fail-closed - aber kein Identitaetsnachweis).
- Empfehlung: Route entweder entfernen oder auf `webAuthMw` (Browser-Session) umstellen, nicht `internalOnly` lockern.
- Prioritaet/Kategorie: P2 / C
