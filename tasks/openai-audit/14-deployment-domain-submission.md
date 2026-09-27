# Audit D14: Deployment, Domain, Web-Absicherung, Submission-Metadaten, Abhaengigkeiten
Dimension: D14 | Quelle: Code auf Branch master

## Kurzfassung
Deployment ist real (Render, Frankfurt), HTTPS/HSTS/CSP sauber, Cookies korrekt geflaggt, Auth-Inventar erzwungen per Test. Der schwerste Befund liegt ausserhalb des Codes: OpenAI lehnt laut eigener Doku aktuell MCP-Plugin-Submissions von Projekten mit EU-Datenresidenz kategorisch ab (T-35) - render.yaml pinnt `region: frankfurt`, die DB laeuft nach eigener Datenschutzerklaerung ebenfalls in Frankfurt, das ist die dokumentierte Datenresidenz. Zweitens fehlt die Domain-Ownership-Challenge (`/.well-known/openai-apps-challenge`) vollstaendig - ohne sie ist keine Submission moeglich. Drittens ist der Dienst fuer einen externen Pruefer real NICHT ohne Weiteres testbar: jeder Outbound-Call-Test verlangt Abo (Zahlung) + KYC-Stufe `card`, ein produktives Postgres-Backend und einen echten Login via WorkOS-OIDC. Viertens sind Rechtstexte (Privacy/Impressum/AGB) mit mehreren `[OFFEN: ...]`-Platzhaltern (Firmenanschrift, Telefonnummer, Widerrufs-Klausel) live im Web-Build vorhanden, was O-6/O-7 beruehrt. npm audit findet zwei moderate, gefixte Lecks (qs via express) - kein Blocker.

## Pruefpunkte

### PP-D14-01 Oeffentliche Domain, HTTPS erzwungen, keine Dev-URL im Produktionspfad
- Status: PASS
- Evidenz: `render.yaml:5-30` (Service `vodafone-agent`, `region: frankfurt`, `healthCheckPath: /healthz`); `src/config.js:1443` `publicUrl: PUBLIC_URL || RENDER_EXTERNAL_URL`; `src/middleware.js:32` HSTS `max-age=15552000; includeSubDomains` fuer `sundartha.com, www.sundartha.com, app.sundartha.com, vodafone-agent.onrender.com` (Kommentar nennt die Hostnamen explizit); `src/config.js:2417` Boot-Assertion `!config.server.publicUrl || .includes("CHANGE-ME")` verhindert den Start mit dem ngrok-Platzhalter aus `.env.example:921`. `src/mcp-server-info.js:63` `websiteUrl: "https://www.sundartha.com"`. `grep` nach `localhost/ngrok/127.0.0.1/http://` in `src/config.js`, `src/mcp-server-info.js`, `.env.example` traf ausschliesslich Kommentare, Default-Platzhalter und den bewusst erlaubten lokalen Test-IdP (`src/config.js:2315-2320`, ausdruecklich auf `127.0.0.1|localhost|[::1]` beschraenkt).
- Risiko: keins im Code selbst; der externe Client sieht `app.sundartha.com` (Auth-Origin/App) und `sundartha.com`/`www.sundartha.com` (Marketing), das Gateway zusaetzlich unter `vodafone-agent.onrender.com`.
- Empfehlung: keine.
- Prioritaet/Kategorie: - / -

### PP-D14-02 Getrennte Prod-/Staging-/Lokal-Endpunkte
- Status: PARTIAL
- Evidenz: `render.yaml:694-780` beschreibt einen zweiten Render-Service `hermes-web` (Marketing, statisch); MEMORY/CLAUDE.md nennen zusaetzlich `hermes-web-staging` fuer Website-Aenderungen (Doku, nicht in `render.yaml` als Blueprint-Service sichtbar - laut Kommentar `render.yaml:697-699,742` sind beide Web-Services **dashboard-managed**, render.yaml ist "Referenz, nicht Live-Wahrheit"). Fuer den Gateway/MCP-Dienst selbst existiert laut Repo NUR ein Produktions-Service (`vodafone-agent`); kein separates Staging fuer `/mcp`.
- Risiko: eine Submission/ein Review-Test laeuft zwangsweise gegen den produktiven MCP-Endpunkt (echte Telefonie/Kosten-Gates), kein isoliertes Staging fuer den Connector-Pfad.
- Empfehlung: falls ein risikoarmer Reviewer-Zugriff gewuenscht ist, separaten `/mcp`-Staging-Service mit eigenem Tenant erwaegen - nicht zwingend, da Outbound ohnehin hinter Abo+KYC liegt (s. PP-D14-08).
- Prioritaet/Kategorie: P2 / C

### PP-D14-03 EU-Datenresidenz vs. OpenAI-Plugin-Submission (T-35)
- Status: FAIL
- Evidenz: `tasks/openai-audit/00-openai-anforderungen.md:68` (T-35): "For now, projects with EU data residency cannot submit plugins with MCP servers for review." `render.yaml:8-12` pinnt den App-Server explizit auf `region: frankfurt` ("Datenresidenz DE/EU (Entscheidung #4)"). `apps/web/src/data/legal/privacy.de.json:42` bestaetigt gegenueber Endnutzern: "der Betrieb unserer Anwendung und der Datenbank selbst findet in Frankfurt statt." Das ist die dokumentierte Datenresidenz-Entscheidung des Produkts, nicht nur die Server-Region.
- Risiko: eine Einreichung im OpenAI-Plugin-Portal wird nach eigener Doku fuer ein Projekt mit EU-Datenresidenz abgelehnt bzw. ist gar nicht erst moeglich, unabhaengig davon, wie gut der Code ist.
- Empfehlung: mit dem OpenAI-Team/Dokumentation klaeren, ob "Projekt" hier den OpenAI-Platform-Projekt-Datenresidenz-Setting meint (getrennt von der Hermes-eigenen Serverregion) - falls ja, ein OpenAI-Platform-Projekt mit globaler Datenresidenz fuer die Submission anlegen, unabhaengig vom Hermes-Hosting. Das ist eine Kontoentscheidung bei OpenAI, keine Code-Aenderung, aber ein echter Blocker, bis geklaert.
- Prioritaet/Kategorie: P0 / A

### PP-D14-04 Domain-Ownership-Challenge fuer Submission
- Status: FAIL
- Evidenz: `tasks/openai-audit/00-openai-anforderungen.md:99-100` (O-4/O-5) verlangt `GET https://<challenge-base-host>/.well-known/openai-apps-challenge` mit exakt einem Token, kein JSON. `grep -rn "openai-apps-challenge" src/ apps/web` liefert keinen Treffer - die Route existiert nicht.
- Risiko: ohne diese Route kann die Domain im OpenAI-Submission-Portal nicht verifiziert werden - harter Blocker fuer jede Einreichung, unabhaengig von PP-D14-03.
- Empfehlung: statische Route `GET /.well-known/openai-apps-challenge` ergaenzen, die ausschliesslich den von OpenAI zugewiesenen Klartext-Token zurueckgibt (kein JSON), auf `PUBLIC_ROUTES` in `src/route-policy.js` eintragen (analog zu den bestehenden `/.well-known/oauth-protected-resource*`-Eintraegen, `src/route-policy.js:84-93`).
- Prioritaet/Kategorie: P0 / A

### PP-D14-05 Sicherheits-Header (CSP/HSTS/nosniff/Referrer-Policy)
- Status: PASS
- Evidenz: `src/middleware.js:14-42` `securityHeaders()`: CSP `default-src 'self'; script-src 'self'` (kein `unsafe-inline`/`unsafe-eval`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS 180 Tage `includeSubDomains`; `/api/*`-Antworten zusaetzlich `Cache-Control: no-store` (Zeile 44). Marketing-Static-Site traegt eigene, sogar striktere CSP mit `base-uri 'self'; object-src 'none'` (`render.yaml:761-767`).
- Risiko: keins identifiziert.
- Empfehlung: keine.
- Prioritaet/Kategorie: - / -

### PP-D14-06 Cookie-Flags (Session)
- Status: PASS
- Evidenz: `src/web-auth.js:94-97` `cookieAttrs()`: `HttpOnly; Secure; SameSite=Lax; Path=/`, bewusst OHNE `Domain`-Attribut (Kommentar Zeile 116-117: verhindert Subdomain-Uebernahme des Cookies).
- Risiko: keins.
- Empfehlung: keine.
- Prioritaet/Kategorie: - / -

### PP-D14-07 CORS am `/mcp`-Endpunkt (T-29)
- Status: UNKNOWN
- Evidenz: `grep -rn "cors\|Access-Control" src/` liefert keinen Treffer im gesamten `src/`-Baum - es existiert weder eine CORS-Middleware noch ein `Access-Control-*`-Header irgendwo im Gateway. `src/routes/mcp.js:36-44` bestaetigt den Stateless-Modus (`sessionIdGenerator: undefined`); `00-openai-anforderungen.md:62` (T-29, Kategorie C) nennt als Quickstart-Beispiel, dass CORS `mcp-session-id` erlauben/exponieren muss.
- Risiko: da `/mcp` per Bearer-Token/OAuth abgesichert ist und von einem Server-zu-Server-Client (ChatGPT-Backend, kein Browser) aufgerufen wird, ist fehlendes CORS fuer den Aufruf selbst wahrscheinlich irrelevant (kein Same-Origin-Problem ohne Browser-Kontext) - das kann dieses Audit aber nicht abschliessend aus dem Repo beurteilen, weil unklar ist, ob irgendein Teil des Handshakes browserseitig laeuft.
- Empfehlung: mit der MCP-SDK-Dokumentation/OpenAI-Quickstart abgleichen, ob fuer den gewaehlten Stateless-Modus ueberhaupt CORS-Header noetig sind; falls ja, gezielt `Access-Control-Expose-Headers: mcp-session-id` auf der `/mcp`-Route ergaenzen.
- Prioritaet/Kategorie: P2 / C

### PP-D14-08 Externe Testbarkeit ohne Entwicklereingriff
- Status: FAIL
- Evidenz: (a) KYC-Gate: `src/telephony/outbound-gates.js:391-400` - jeder Outbound-Call verlangt `store.kycReached(tenantId, KYC_OUTBOUND_MIN)`, sonst 403 `grund: "kyc"`. (b) Abo-Gate: `src/telephony/outbound-gates.js:409-433` verlangt `store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)`, sonst `subscriptionInactive`. (c) Login: `src/web-auth.js` fuehrt ausschliesslich ueber WorkOS-AuthKit-OIDC (kein `dev-login` in Produktion, der existierende `/auth/dev-login` ist laut `src/web-auth.js:331` "NUR lokal, hinter deps.devLoginEnabled"). (d) `OWNER_SELF_CALL_TENANT_IDS` (`src/config.js:1858`, Default leer) ist eine harte Allowlist, die die abgeschwaechte Offenlegungs-Ausnahme ausschliesslich fuer explizit gepinnte Tenants freigibt - ein externer Pruefer bekaeme also unter keinen Umstaenden diese Ausnahme, ohne dass der Betreiber ihn per Env eintraegt. (e) `PAYMENT_ENABLED`/`PROVISIONING_ENABLED` sind produktiv scharf (impliziert durch `.env.example:262,321,498` Default `false`, aber laut MEMORY/CLAUDE.md live aktiv seit den Geldpfad-Ketten).
- Risiko: ein OpenAI-Reviewer kann `place_call` (das zentrale, aussagekraeftigste Tool) real nicht testen, ohne eine Kreditkarte zu hinterlegen, ein Abo abzuschliessen und eine KYC-Stufe zu erreichen - das widerspricht O-9 ("ohne MFA, SMS, E-Mail-Bestaetigung ... voll ausgestatteter Demo-Account") direkt, sofern OpenAI dafuer keinen Ausnahmeprozess vorsieht.
- Empfehlung: fuer den Review-Prozess entweder (a) einen vorab bezahlten/KYC-verifizierten Demo-Tenant fest bereitstellen und dessen Zugangsdaten NICHT im Repo, sondern separat an OpenAI uebergeben, oder (b) klaeren, ob OpenAI fuer kostenpflichtige/regulierte Dienste einen alternativen Nachweis (Video, Sandbox-Modus) akzeptiert. Keine Code-Aenderung an den Gates selbst - die sind Absolute Regel 1 und duerfen nicht aufgeweicht werden.
- Prioritaet/Kategorie: P0 / A (O-9)

### PP-D14-09 Submission-Metadaten: Logo/Icon, Homepage, Support
- Status: PARTIAL
- Evidenz: Icon vorhanden und MCP-`initialize` bekannt gemacht: `src/mcp-server-info.js:60-71` (`icons[0]` data-URI, `icons[1]` `https://.../brand/hermes-icon.png`, `public/brand/hermes-icon.png` existiert laut `CLAUDE.md`-Architekturabschnitt). Homepage: `websiteUrl: "https://www.sundartha.com"` (`src/mcp-server-info.js:63`). Support-Kontakt: `kontakt@sundartha.com` mehrfach im Web-Build (`apps/web/src/layouts/Site.astro:50`, `Hermes.astro:16`, `pages/kuendigen.astro:13`). Privacy/Terms/Imprint-Seiten existieren (`apps/web/src/lib/legal.js:14-26`, `/datenschutz`, `/impressum`, `/agb`). Produktname/Beschreibung: `HERMES_SERVER_INFO.name: "hermes"` (`src/mcp-server-info.js:37`).
- Risiko: `apps/web/src/data/legal/privacy.de.json:10` und `terms.de.json:38` und `imprint.de.json:18` enthalten wortwoertliche `[OFFEN: ...]`-Platzhalter (fehlende Firmenanschrift/Rechtsform, fehlende Telefonnummer nach § 5 DDG, ungeklaerte Widerrufsklausel). Diese Texte sind LIVE im Web-Build eingebunden (`apps/web/src/pages/index.astro:30-32`), stehen also einem OpenAI-Reviewer beim Aufruf der Privacy-URL genauso vor Augen wie einem Endnutzer. Das beruehrt O-6 ("Privacy Policy muss ... genannt werden - und wird eingehalten") und O-7 (URLs "muessen ... zur Publisher-Identitaet passen").
- Empfehlung: `[OFFEN: ...]`-Platzhalter in Privacy/Impressum/AGB vor jeder Submission schliessen (Firmenanschrift, Rechtsform, Telefonnummer) - das ist ein Rechtstext-Launch-Blocker, unabhaengig vom MCP-Code, aber Voraussetzung fuer O-6/O-7.
- Prioritaet/Kategorie: P0 / A

### PP-D14-10 Sicherheitsrelevante Abhaengigkeiten (Version + Schwachstellen)
- Status: PARTIAL
- Evidenz: installierte Versionen (per `node_modules/*/package.json`): `@anthropic-ai/sdk@0.105.0`, `@modelcontextprotocol/sdk@1.29.0` (package.json verlangt `^1.12.0`), `express@4.22.2`, `jose@6.2.3`, `pg@8.21.0`, `ws@8.21.0`, `zod@3.25.76`. `npm audit --omit=dev --json` (offline, gegen die vorhandene `node_modules`/Lockfile) meldet 2 moderate Findings, beide via `qs` (transitive Dependency von `express`): GHSA-x5fp-wj9c-mxmx und GHSA-4mjr-xmp4-gh2g, `fixAvailable: true`, `metadata.vulnerabilities: {moderate:2, high:0, critical:0}`.
- Risiko: keine kritische/hohe Schwachstelle; die moderaten `qs`-Findings betreffen Array-Parsing von Query-Strings (DoS-Charakter, CVSS 3.7/5.3) - im MCP-POST-Pfad mit JSON-Body vermutlich nicht der primaere Angriffsvektor, aber ein Upgrade ist risikofrei verfuegbar.
- Empfehlung: `npm audit fix` fuer `express`/`qs` einplanen (kein Upgrade in diesem Audit durchgefuehrt, wie angewiesen).
- Prioritaet/Kategorie: P2 / C

### PP-D14-11 CSRF-Schutz / Origin-Pruefung
- Status: PASS
- Evidenz: `src/middleware.js:47-75` `crossOriginRequest()`: schreibende Methoden werden gegen den `Origin`-Header + `Host` geprueft, kein Origin (Webhooks, `/mcp`, Server-zu-Server) faellt bewusst durch (`false`), unparsbarer Origin -> `true` (blockiert), sonst Host-Vergleich case-insensitiv. `SAFE_METHODS` (`GET/HEAD/OPTIONS`) ausgenommen.
- Risiko: keins im Rahmen der Dimension identifiziert; die Origin-Pruefung deckt Browser-Formulare/Fetch ab, nicht MCP (das braucht keinen CSRF-Schutz, da kein Browser-Cookie-Kontext).
- Empfehlung: keine.
- Prioritaet/Kategorie: - / -

## Randbefund (ausserhalb dieser Dimension)
`src/telephony/outbound-gates.js:391-400` und `433` zeigen die KYC-/Abo-Gate-Logik sehr klar strukturiert - das ist ein Sicherheits-, nicht ein Deployment-Thema und gehoert vermutlich in die Auth/Gates-Dimension eines anderen Agenten.

## Offene Fragen (nicht am Repo entscheidbar)
- Bezieht sich T-35 (EU-Datenresidenz-Verbot) auf das OpenAI-Platform-Projekt-Setting oder auf den tatsaechlichen Serverstandort des MCP-Hosts? Das Repo kann nur den eigenen Serverstandort (Frankfurt) belegen, nicht OpenAIs Definition von "Projekt".
- Verlangt WorkOS AuthKit (der OIDC-Provider hinter dem Login) standardmaessig E-Mail-Bestaetigung oder MFA? Das liegt in der WorkOS-Dashboard-Konfiguration, nicht im Repo.
- Gibt es bei OpenAI einen anerkannten Ausnahmeprozess fuer kostenpflichtige/regulierte Reviewer-Tests (O-9 vs. Zahlungspflicht+KYC)? Nicht aus offiziellen Quellen im Anforderungsdokument ersichtlich.
- Ist `hermes-web-staging` tatsaechlich als eigener Render-Service angelegt? `render.yaml` zeigt nur `vodafone-agent` und `hermes-web`; laut Kommentaren sind Web-Services dashboard-managed, die Live-Wahrheit ist im Repo nicht einsehbar.
