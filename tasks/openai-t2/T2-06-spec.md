# T2-06 - Transport: CORS nur fuer freigegebene Origins (Spec fuer den Bau-Agenten)

- IDs (gepinnt): **T-29**. Keine weiteren.
- Branch: `phase/openai-t2-06-cors-allowed-origins`, Worktree
  `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/wt-t2-06`
- Basis-Commit: `8a5b7ce` (Merge T2-05). Gemergt und NICHT zuruecknehmen: T2-01 a941d23, T2-02 fff3b95,
  T2-03 24ff703, T2-23 c0438bd, T2-04 1cfa474, T2-05 8a5b7ce.
- Diese Datei bleibt ungetrackt im Haupt-Arbeitsbaum; nicht in den Worktree kopieren.

## Ziel in einem Satz

`/mcp` beantwortet den CORS-Preflight und setzt CORS-Header NUR fuer Origins, die BYTE-GENAU in
`MCP_ALLOWED_ORIGINS` (normalisiert) stehen; `PUBLIC_URL` ist ausgenommen (same-origin braucht kein
CORS). Bei leerer Liste (Default, heute live) ist jede `/mcp`-Antwort byte-gleich zu heute. Den Wert
setzt der Owner nach seiner Messung; der Deploy allein aendert nichts.

## Ist-Stand (am Code gemessen, Worktree 8a5b7ce)

- Kein `Access-Control-*`-Header irgendwo in `src/` (grep -i "access-control" src/ -> 0 Treffer).
- Herkunftswache `createMcpOriginGuard` in `src/middleware.js:207-218`; Praedikat `mcpOriginErlaubt`
  `:179-184`; Listenbildung `mcpErlaubteOrigins` `:160-163`; Normalisierung `normalisierterOrigin`
  `:150-153` (URL.origin, lowercase, Default-Port und Pfad fallen weg).
- Montage in `src/routes/mcp.js:134-143` (`router.use("/mcp", createMcpOriginGuard(...))`), danach
  `router.post("/mcp", mcpAuth, ...)` `:145`, GET/DELETE -> 405 `:222-225`. OPTIONS /mcp hat heute
  keine eigene Route: ohne Origin antwortet Express' Auto-OPTIONS 200 (Test E5-H09).
- Stateless: `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` `src/routes/mcp.js:207`
  -> es wird nie ein `Mcp-Session-Id` ausgegeben.
- Config: `mcpAllowedOrigins: csvEnv(process.env.MCP_ALLOWED_ORIGINS)` `src/config.js:1970`
  (Kommentar `:1963-1969`); `.env.example:1010-1013`; Boot-Refusal fuer unparsbare Eintraege
  `src/boot-guard.js:991-1002` (`*` wirft in `new URL` -> Boot-Refusal).
- Tests: `test/helpers.js:151-152` BASE_ENV hat `MCP_ORIGIN_ENFORCE: "true"`, `MCP_ALLOWED_ORIGINS: ""`
  -> KEINE neue Env-Variable, BASE_ENV bleibt.
- mcpAuth: 401-Challenge `src/auth.js:139` (deny401, OAuth), statische Challenge `:239-248` (token/Legacy),
  403 insufficient_scope `:210-213`. Legacy-Localhost-Bypass `src/auth.js:18-20` (nur Socket, nur
  ausserhalb Produktion).
- Routen-Inventar: `test/route-auth-inventory.test.js:273-298` sieht nur `layer.route` (keine
  use-Layer) und schlaegt bei verwaisten `PUBLIC_ROUTES`-Eintraegen an.
- Baseline gemessen: `NODE_ENV=test node --test test/s2-mcp-origin.test.js test/route-auth-inventory.test.js`
  -> `pass 50 / fail 0`.

## Designentscheidungen (verbindlich fuer den Bau)

1. **Eigene CORS-Liste aus derselben Quelle:** `corsOrigins = mcpErlaubteOrigins({ zusaetzlicheOrigins:
   config.safety.mcpAllowedOrigins })` (ohne `publicUrl`) - dieselbe Funktion, dieselbe Env, einmal in
   der Fabrik gebildet. Damit gilt per Konstruktion `corsOrigins` ist Teilmenge der Wachen-Liste.
2. **Byte-genauer Vergleich des ROHEN Headers:** CORS greift nur, wenn `req.headers.origin` als String
   exakt einem Element von `corsOrigins` gleicht (`corsOrigins.includes(rohwert)`), KEINE
   Normalisierung, kein Praefix/Suffix, kein Wildcard. Browser senden den Origin immer kanonisch
   (lowercase, ohne Default-Port, ohne Slash) - ein echter Browser verliert dadurch nichts.
   `Access-Control-Allow-Origin` bekommt das LISTEN-Element (identisch zum Rohwert), nie `*`.
3. **Unabhaengig von `MCP_ORIGIN_ENFORCE`:** die CORS-Entscheidung liest nur `corsOrigins`, nie den
   enforce-Schalter. Mit `MCP_ORIGIN_ENFORCE=false` wird dadurch KEIN fremder Origin gespiegelt.
4. **use-Layer, keine Route:** Montage als `router.use("/mcp", createMcpCors(...))` DIREKT nach der
   Herkunftswache und vor den Routen. Eine `router.options("/mcp", ...)`-Route wuerde (a) das
   Auto-OPTIONS ohne Origin veraendern (Allow-Header bekaeme OPTIONS) -> nicht byte-gleich, und
   (b) einen neuen Routen-Graph-Eintrag samt Fingerprint erzeugen. Die Wache ist ebenfalls ein
   use-Layer, der OPTIONS beantwortet - gleiche Bauart. Absolute Regel 3: Begruendung im
   Code-Kommentar + PLAN-SECURITY.md; ein `PUBLIC_ROUTES`-Eintrag ist NICHT moeglich (der
   Inventar-Test sieht use-Layer nicht und wuerde den Eintrag als verwaist melden). Der Preflight
   liefert keine Daten und keine Identitaet, nur Header, und nur fuer gelistete Origins.
5. **Nur exakt `/mcp`:** der Layer handelt nur bei `req.path === "/"` (innerhalb des `/mcp`-Mounts),
   sonst `next()` - kein 204 auf `/mcp/foo`.
6. **Header-Satz:**
   - jede Antwort an gelisteten Origin (alle Methoden): `Access-Control-Allow-Origin: <eintrag>`,
     `Access-Control-Expose-Headers: Mcp-Session-Id, WWW-Authenticate`, `Vary: Origin` (per
     `res.vary("Origin")`, anhaengend, nie ueberschreibend).
   - zusaetzlich bei OPTIONS: `Access-Control-Allow-Methods: POST`,
     `Access-Control-Allow-Headers: authorization, content-type, mcp-session-id, mcp-protocol-version`,
     Antwort 204 ohne Body, KEIN `next()`.
   - NIE: `Access-Control-Allow-Credentials` (Bearer im Header, keine Cookies), nie `*`.
   - `Access-Control-Max-Age`: nicht setzen (nicht verlangt; ohne Wert keine Magic Number).
   - Alle Werte als benannte Konstanten; 204 als `HTTP_NO_CONTENT`.
7. **Reihenfolge Wache -> CORS -> mcpAuth:** fremder Origin endet in der Wache (403, ohne CORS-Header);
   gelisteter Origin bekommt die Header gesetzt, BEVOR mcpAuth 401/403 schickt -> der Browser-Client
   kann die Challenge lesen.

## Schritte

### Schritt 1 - Reines Praedikat + Express-Fabrik in `src/middleware.js`
- Was: nach `createMcpOriginGuard` (`src/middleware.js:207-218`, einfuegen ab `:219`) ein reines
  Praedikat `mcpCorsOrigin(originHeader, corsOrigins)` -> Listen-Element oder `null` (byte-genauer
  Vergleich, Designentscheidung 2) und eine Fabrik `createMcpCors({ corsOrigins })` mit BENANNTER
  Middleware-Funktion (Designentscheidung 5-6). Leere Liste -> Middleware ruft sofort `next()` und
  setzt nichts. Kommentar Deutsch ohne Umlaute, mit Begruendung (Regel 3, byte-genau, enforce-unabhaengig,
  kein Credentials-Header). Funktionslaenge klein, keine Magic Numbers.
- Datei: `src/middleware.js:219` (neu).
- IDs: T-29. Pfade: HTTP `/mcp` (alle Auth-Modi, weil vor mcpAuth); stdio nicht betroffen (kein HTTP).
- Beweis: (b) Unit-Tests T2-06-U01..U05 gruen (s. Tests); (a) `grep -n "Access-Control-Allow-Origin" src/middleware.js`
  zeigt genau eine Setz-Stelle, deren Wert aus `corsOrigins` stammt, nicht aus `req.headers.origin`.

### Schritt 2 - Montage in `src/routes/mcp.js`
- Was: in `makeMcpRoutes` direkt nach dem Wachen-`router.use` (`src/routes/mcp.js:134-143`) ein zweites
  `router.use("/mcp", createMcpCors({ corsOrigins: mcpErlaubteOrigins({ zusaetzlicheOrigins:
  config.safety.mcpAllowedOrigins }) }))`. Liste einmal bilden (nicht pro Request). Import ergaenzen
  (`src/routes/mcp.js:36`). Kopfkommentar/Block-Kommentar um CORS ergaenzen (warum use-Layer, warum
  kein PUBLIC_ROUTES-Eintrag, warum PUBLIC_URL ausgenommen).
- Datei: `src/routes/mcp.js:144` (neu), `:36` (Import).
- IDs: T-29. Pfade: HTTP `/mcp` fuer OAuth, token, Legacy (Layer sitzt vor mcpAuth); stdio unberuehrt.
- Beweis: (b) Drahttests T2-06-H01..H12 gruen; (b) `test/route-auth-inventory.test.js` weiter gruen
  (kein neuer Routen-Eintrag, Fingerprint unveraendert).

### Schritt 3 - Unit-Tests (kein Server)
- Was: neue Tests in `test/s2-mcp-origin.test.js` (Plan nennt diese Datei; Namen mit Praefix `T2-06-`,
  NIE mit `MCP-`/`ORIG-` - die wuerden in den Gates-Lauf wandern):
  - T2-06-U01 Treffer: `mcpCorsOrigin("https://chatgpt.com", ["https://chatgpt.com"])` -> `"https://chatgpt.com"`.
  - T2-06-U02 aehnliche Origins -> `null`: `https://chatgpt.com.evil.tld`, `https://evilchatgpt.com`,
    `https://sub.chatgpt.com`, `http://chatgpt.com`, `https://CHATGPT.COM`, `https://ChatGPT.com`,
    `https://chatgpt.com/`, `https://chatgpt.com:443`, `https://chatgpt.com:8443`, `null`,
    `https://chatgpt.com, https://evil.example`, `""`, `undefined`, `*`.
  - T2-06-U03 leere Liste -> `null` fuer jeden Wert.
  - T2-06-U04 Teilmengen-Invariante: fuer eine Env-Liste mit Muell/Duplikaten ist jede CORS-Liste
    (`mcpErlaubteOrigins({ zusaetzlicheOrigins })`) Teilmenge von `mcpErlaubteOrigins({ publicUrl, zusaetzlicheOrigins })`
    und enthaelt `publicUrl` nicht, wenn es nicht auch in der Env-Liste steht.
  - T2-06-U05 Rueckgabewert ist nie `"*"`, auch nicht bei Liste `["https://*.chatgpt.com"]` und Origin
    `https://x.chatgpt.com` (-> `null`; Wildcard wird nicht interpretiert).
- Beweis: (b) die fuenf Tests gruen, isoliert:
  `NODE_ENV=test node --test --test-name-pattern="T2-06-U" test/s2-mcp-origin.test.js` -> `# fail 0`.

### Schritt 4 - Drahttests am echten `/mcp` (Server als Kindprozess)
- Was: neue `describe`-Bloecke in `test/s2-mcp-origin.test.js`. Helfer: `fetch` mit `method: "OPTIONS"`,
  `Origin`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: authorization, content-type`.
  Header-Pruefung ueber `[...res.headers.keys()].filter((k) => k.startsWith("access-control-"))`.
  401-Faelle ueber `srv.externalUrl` (Interface-IP, kein Localhost-Bypass) UND `srv.localUrl`; ist
  `srv.externalUrl` null, schlaegt der Test fehl statt still zu passen (oder: Muster aus
  `test/auth-p7-gate-removed.test.js` uebernehmen, das ohne externalUrl auskommt - dort nachlesen).
  - **Block A: leere Liste (BASE_ENV), MCP_AUTH=oauth**
    - T2-06-H01: OPTIONS + POST + GET mit `Origin: https://chatgpt.com` -> 403 wie heute, KEIN
      `access-control-*`-Header, kein `Vary` mit `Origin`.
    - T2-06-H02: OPTIONS ohne Origin -> 200 (Auto-OPTIONS), `allow`-Header unveraendert
      (`GET,HEAD,POST,DELETE` o.ae. - Baseline VOR dem Bau einmal messen und als Konstante pinnen),
      keine `access-control-*`-Header. POST ohne Origin ohne Token -> 401, keine `access-control-*`-Header.
    - T2-06-H03: `Origin: https://agent.test` (PUBLIC_URL) -> nicht 403, KEINE `access-control-*`-Header
      (PUBLIC_URL ist ausgenommen).
  - **Block B: `MCP_ALLOWED_ORIGINS=https://chatgpt.com`, MCP_AUTH=oauth (Muster E5-H14, mit startIdp)**
    - T2-06-H04: Preflight -> 204, `access-control-allow-origin` === `https://chatgpt.com` (exakt),
      `vary` enthaelt `Origin`, `access-control-allow-methods` === `POST`,
      `access-control-allow-headers` enthaelt `authorization`, `content-type`, `mcp-session-id`,
      `mcp-protocol-version`, `access-control-expose-headers` enthaelt `Mcp-Session-Id` und
      `WWW-Authenticate`, KEIN `access-control-allow-credentials`, leerer Body.
    - T2-06-H05: POST ohne Token (Interface-IP) -> 401 MIT `www-authenticate` (Bearer, resource_metadata)
      UND `access-control-allow-origin: https://chatgpt.com` + Expose-Headers + `Vary: Origin`.
    - T2-06-H06: POST mit gueltigem Token, `tools/list` -> 200, `access-control-allow-origin` exakt.
    - T2-06-H07: `Origin: https://evil.example` -> OPTIONS und POST 403, keine `access-control-*`-Header.
    - T2-06-H08: aehnliche Origins am Draht: `https://chatgpt.com.evil.tld`, `http://chatgpt.com`,
      `https://chatgpt.com:8443` -> 403 ohne CORS-Header; `https://CHATGPT.COM`, `https://chatgpt.com/`,
      `https://chatgpt.com:443` -> Wache laesst durch (heutiges Verhalten, E5-H06), aber KEINE
      `access-control-*`-Header und Preflight NICHT 204 (faellt auf Auto-OPTIONS 200 ohne CORS).
    - T2-06-H09: `Origin: https://agent.test` (PUBLIC_URL) -> keine CORS-Header.
    - T2-06-H10: `OPTIONS /mcp/foo` mit `https://chatgpt.com` -> nicht 204, keine CORS-Header.
    - T2-06-H11: GET `/mcp` mit gelistetem Origin -> 405 (unveraendert), CORS-Header duerfen dran sein;
      Status bleibt 405.
  - **Block C: Auth-Modi und Notventil**
    - T2-06-H12: `MCP_AUTH=token` + `MCP_AUTH_TOKEN` gesetzt + Liste gesetzt: POST ohne Token von
      `https://chatgpt.com` -> 401 mit statischer Challenge UND ACAO exakt.
    - T2-06-H13: Legacy (`MCP_AUTH=""`, kein Token) + Liste gesetzt, ueber `srv.externalUrl`: POST von
      `https://chatgpt.com` -> 401 mit ACAO; ueber `srv.localUrl` -> 200-Bypass wie heute mit ACAO
      (nur gelisteter Origin).
    - T2-06-H14: `MCP_ORIGIN_ENFORCE=false` + LEERE Liste + `Origin: https://evil.example` -> 401 (Wache
      geloest, wie E5-H15), aber KEINE `access-control-*`-Header; Preflight nicht 204.
- IDs: T-29. Pfade: HTTP /mcp; OAuth (A, B), token (H12), Legacy (H13); stdio nicht betroffen.
- Beweis: (b) alle T2-06-H* gruen, isoliert:
  `NODE_ENV=test node --test --test-name-pattern="T2-06" test/s2-mcp-origin.test.js` -> `# fail 0`.
  Positiv-Kontrolle: der Bau-Agent entfernt testweise (NICHT committen) die `includes`-Pruefung im
  Praedikat bzw. setzt ACAO auf den Rohwert -> T2-06-U02/H07/H08/H14 muessen rot werden; Ergebnis im
  Bericht nennen.

### Schritt 5 - Bestehende Tests: was bricht, was bleibt
- Erwartung: KEIN bestehender Test bricht. E5-H09 (OPTIONS ohne Origin -> 200) bleibt, weil die Liste
  in BASE_ENV leer ist und der Layer ohne Treffer `next()` ruft. E5-H14 (Liste gesetzt, POST nicht 403)
  bleibt. `route-auth-inventory` bleibt (kein neuer Routen-Eintrag).
- Beweis: (b) Gesamtlauf `npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur `# pass`/`# fail`
  lesen; jede rote Zeile isoliert nachlaufen lassen (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`).
  Gegenueber Basis 8a5b7ce: `# fail` gleich (oder 0), `# pass` = Basis + Anzahl neuer T2-06-Tests.

### Schritt 6 - Doku der Semantik-Erweiterung (keine neue Env-Variable)
- Was: `MCP_ALLOWED_ORIGINS` heisst ab jetzt "Wache laesst durch UND Browser duerfen `/mcp`-Antworten
  lesen (CORS)". Kommentare nachziehen:
  - `src/config.js:1963-1969` (Kommentar zu `mcpAllowedOrigins`): CORS-Wirkung, byte-genau, PUBLIC_URL
    ausgenommen, Widget-Sandbox-Domain gehoert NICHT auf die Liste.
  - `.env.example:1010-1013`: dieselbe Aussage, Beispiel `https://chatgpt.com` NUR nach Messung.
  - `render.yaml`: NICHT anfassen (Variable ist nicht neu; Render-Services sind Dashboard-gepflegt).
  - `test/helpers.js` BASE_ENV: unveraendert (Variable ist schon gepinnt, `:152`).
- Beweis: (a) `git diff 8a5b7ce -- src/config.js .env.example` zeigt nur Kommentaraenderungen;
  `git diff 8a5b7ce -- render.yaml test/helpers.js` ist leer.

### Schritt 7 - PLAN-SECURITY.md
- Was: neuer Abschnitt (Muster `## E5/E8 ...` `PLAN-SECURITY.md:4771`): CORS auf `/mcp` nur fuer
  byte-genau gelistete Origins; leer = inert; kein Credentials-Header; enforce-unabhaengig; Preflight
  als use-Layer ohne PUBLIC_ROUTES-Eintrag (Begruendung wie Designentscheidung 4); Owner setzt den Wert
  nach Messung; Risiko: gelisteter Origin darf `/mcp`-Antworten im Browser lesen - nur mit eigenem
  Bearer-Token, keine Ambient-Credentials. Keine Produktionswerte.
- Beweis: (a) `grep -n "Access-Control" PLAN-SECURITY.md` zeigt den Abschnitt.

### Schritt 8 - Syntax, Lint, Aufraeumen
- `node --check src/middleware.js && node --check src/routes/mcp.js`; Lint-Hook beim Commit nicht
  umgehen (nie `--no-verify`); Dateien einzeln adden, nie `git add -A`.
- Nach Tests: `ps aux | grep "[s]rc/server.js"` -> keine Zeile (pgrep ist blind).
- Beweis: (c) die Befehle, erwartet: kein Output von `node --check`, `ps`-Zaehler 0.

## Nicht bauen (mit Grund)

- **Keinen Wert fuer `MCP_ALLOWED_ORIGINS` setzen** (weder `.env.example`-Default noch render.yaml noch
  BASE_ENV): der Wert haengt an der Owner-Messung; Default bleibt leer = fail-closed.
- **Keine Aenderung an der Herkunftswache** (`createMcpOriginGuard`, Normalisierung, enforce): T-29 verlangt
  CORS, nicht eine andere Wache; die Case-Toleranz der Wache (E5-H06) bleibt.
- **Kein `router.options`-Route und kein `PUBLIC_ROUTES`-Eintrag**: s. Designentscheidung 4 (bricht
  Byte-Gleichheit bzw. waere verwaist).
- **Kein CORS auf `/.well-known/oauth-protected-resource*` und Challenge-/Login-Routen**: nicht T-29;
  ob ChatGPT ueberhaupt browserseitig spricht, ist UNKNOWN bis zur Owner-Messung. Ergibt sie
  "browserseitig", ist PRM-CORS eine eigene Folgephase.
- **Kein `Access-Control-Max-Age`**: nicht verlangt, waere eine neue Zahl ohne Messgrundlage.
- **Keine Session-Unterstuetzung** (Stateful-Transport): T-29 fordert Statelessness nicht; Hermes ist
  bereits stateless (`src/routes/mcp.js:207`). `Mcp-Session-Id` wird nur erlaubt/exponiert (Anforderungstext).
- **Keine CORS-Header auf 429 des globalen Rate-Limiters** (`src/app.js:153-157`, vor dem Router):
  Browser sieht dann einen Netzwerkfehler statt 429 - kein Leck, nur schlechtere Diagnose; Umbau des
  globalen Limiters waere Scope-Ausweitung.
- **Kein docs/OPENAI-*-Dokument**: Plan: `dokumentFuerOpenAI: nein`.
- **Kein render.yaml-Eintrag**: keine neue Variable; Live-Werte sind Dashboard-gepflegt.
- **stdio (`src/mcp-server.js`)**: kein HTTP, kein Origin, kein CORS - nichts zu bauen.

## Pre-Mortem (ein Jahr spaeter war T2-06 ein Fehler - was ist passiert?)

1. **Jeder Origin wird gespiegelt** (Tippfehler: ACAO aus `req.headers.origin`, Praedikat invertiert,
   Normalisierung statt Byte-Vergleich, `startsWith`/`endsWith`). Folge: fremde Webseiten lesen
   `/mcp`-Antworten (Transkripte!) mit. Entschaerft: Designentscheidung 2 (Rohwert byte-genau gegen
   Liste, ACAO = Listen-Element), Negativtests U02/H07/H08 fuer aehnliche Origins inkl.
   `chatgpt.com.evil.tld`, http, Gross/Klein, Port, Slash, `null`, Mehrfach-Header, Positiv-Kontrolle
   in Schritt 4.
2. **Ungewollter Anruf aus dem Browser eines Entwicklers**: Legacy-Modus lokal (`src/auth.js:18-20`)
   laesst localhost OHNE Token durch; spiegelt CORS einen fremden Origin (z.B. weil jemand
   `MCP_ORIGIN_ENFORCE=false` zum Debuggen setzt), kann eine besuchte Webseite per `fetch` an
   `http://localhost:<port>/mcp` `place_call` ausloesen und die Antwort lesen - echte Kosten.
   Entschaerft: CORS liest nie den enforce-Schalter (Designentscheidung 3), Test H14; Wache laeuft
   vor CORS; Outbound-Gates bleiben unangetastet.
3. **Transkript-Leak ueber Credentials-Modus**: `Allow-Credentials: true` + gespiegelter Origin wuerde
   Cookie-Kontext mitnehmen. Entschaerft: nie `Allow-Credentials` (H04 prueft Abwesenheit); `/mcp`
   authentifiziert per Bearer-Header, nicht per Cookie.
4. **Gebrochener Claude-Connector / Byte-Drift bei leerer Liste**: der neue Layer veraendert Header oder
   Auto-OPTIONS auch ohne Liste. Entschaerft: leere Liste -> sofort `next()`; H01/H02/H03 vergleichen
   Header-Namen und `allow`-Header gegen die vorher gemessene Baseline; use-Layer statt Route.
5. **Auth-Loch durch Preflight**: 204 auf OPTIONS ohne Auth wird fuer Subpfade oder fremde Origins
   geliefert, oder ein spaeterer Handler haengt Logik an OPTIONS. Entschaerft: nur `req.path === "/"`
   und nur gelisteter Origin (H10, H07); Preflight hat keinen Body, beruehrt weder Store noch Tools.
6. **Falscher Wert durch den Owner**: z.B. die Widget-Sandbox-Domain oder `https://*.chatgpt.com`
   landet auf der Liste. `*` allein ist Boot-Refusal (`src/boot-guard.js:991-1002`); `https://*.x` wird
   nur literal verglichen und greift fuer keinen echten Browser (U05). Doku (Schritt 6/7) nennt: nur den
   exakt gemessenen Origin, nie die Sandbox-Domain.
7. **Cache-Vergiftung**: fehlendes `Vary: Origin` liesse einen Zwischenspeicher eine Antwort mit ACAO
   fuer Origin A an Origin B ausliefern. Entschaerft: `res.vary("Origin")` auf jeder CORS-Antwort (H04/H05);
   anhaengend, ueberschreibt keinen bestehenden Vary.
8. **Browser-Client sieht die 401-Challenge nicht** und kann sich nie neu autorisieren (genau die
   Falle, wegen der E-4 das Notventil hat). Entschaerft: CORS vor mcpAuth, Expose `WWW-Authenticate`,
   H05/H12/H13 ueber Interface-IP.
9. **D0-4-Verstoss als Prozessfehler**: die fruehere autonome Entscheidung "an CORS keine Zeile" wird
   gebrochen. Entschaerft: Aenderung ist ohne Owner-Wert inert (belegt durch Block A); Lead-Notiz dieses
   Laufs ordnet Bau an; Merge-Entscheidung liegt beim Lead.

## Owner-Punkte (nur nach OWNER-REGEL)

1. **Messung im ChatGPT Developer Mode (OW-C)** - Anleitung: nach Deploy eines Stands mit T2-06 (inert)
   Hermes in ChatGPT Developer Mode verbinden, ein Werkzeug aufrufen, danach im Render-Log nach
   `grund=mcp_cross_origin origin=` und `[mcp] client-class` suchen. Erwartet: (a) keine
   `mcp_cross_origin`-Zeile -> ChatGPT spricht serverseitig ohne Origin, Liste bleibt LEER, T-29 ist mit
   dem gebauten Code erfuellt; (b) eine Zeile mit Host `<h>` -> weiter mit Punkt 2.
2. **Wert im Render-Dashboard setzen** (nur bei Fall 1b): `MCP_ALLOWED_ORIGINS=https://<h>` (exakt der
   gemessene Host, kein Pfad, kein `*`, nicht die Widget-Sandbox-Domain), Dienst neu starten. Pruefung:
   `curl -si -X OPTIONS https://<prod-host>/mcp -H "Origin: https://<h>" -H "Access-Control-Request-Method: POST"`
   -> `204`, `access-control-allow-origin: https://<h>`, `vary: Origin`, kein `allow-credentials`;
   derselbe Befehl mit `Origin: https://evil.example` -> `403` ohne `access-control-*`.
3. **Deploy/Push** - keine Deploy-Vorbedingung (ohne gesetzten Wert aendert sich nichts, Block A belegt).

## Widersprueche / UNKNOWN

- Plan nennt `src/routes/mcp.js:102-111` fuer die Wachen-Montage; tatsaechlich `:134-143` (Drift durch
  T2-01..T2-05). `src/middleware.js:207-217` stimmt.
- Autonome Entscheidung D0-4 (2026-09-20: "an CORS KEINE Zeile", solange Richtung nicht belegt) und P9
  ("nicht gebaut") widersprechen dem Bau; Plan 2.2 benennt die Reibung selbst, Lead-Notiz dieses Laufs
  ordnet Bau (inert) an. Merge-Entscheidung beim Lead.
- Wache vergleicht normalisiert (case-/slash-/default-port-tolerant, E5-H06), CORS byte-genau: Origins
  wie `https://CHATGPT.COM` passieren die Wache, bekommen aber kein CORS. Bewusste Asymmetrie (strenger),
  vom Plan nicht erwaehnt.
- Plan-Dateiliste nennt `src/config.js`/`.env.example` nicht; die Semantik von `MCP_ALLOWED_ORIGINS`
  erweitert sich aber (Browser-Lesezugriff) -> Kommentare nachziehen (Schritt 6).
- Absolute Regel 3 verlangt fuer oeffentliche Ausnahmen einen `PUBLIC_ROUTES`-Eintrag; fuer einen
  use-Layer-Preflight ist das technisch nicht moeglich (Inventar sieht nur Routen, verwaiste Eintraege
  schlagen an). Loesung: Code-Kommentar + PLAN-SECURITY.md.
- Anforderungstext T-29 zitiert `https://developers.openai.com/plugins/quickstart`, der Plan
  `.../plugins/build/app-quickstart` - gleicher Inhalt zitiert, nur URL abweichend.
- T-29 selbst ist Stufe C ("nicht gefordert"; Quickstart-Beispiel). `mcp-session-id` erlauben/exponieren
  ist fuer einen stateless Server wirkungslos, aber harmlos.
- `render.yaml` fuehrt weder `MCP_ALLOWED_ORIGINS` noch `MCP_ORIGIN_ENFORCE` (Bestandsluecke, nicht Teil
  dieser Phase).
- UNKNOWN: ob ChatGPT `/mcp` je browserseitig mit Origin anspricht - nur per Owner-Messung klaerbar.
- UNKNOWN: exakter Auto-OPTIONS-`allow`-Wert heute - der Bau-Agent misst ihn vor dem Bau (Schritt 4 H02).
