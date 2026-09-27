# T2-06 - Transport: CORS nur fuer freigegebene Origins - Abschlussbericht

Branch `phase/openai-t2-06-cors-allowed-origins`, Commit `9a2dcad`.

## 1. Was diese Phase NICHT erfuellt

- **Kein Live-Wert gesetzt.** `MCP_ALLOWED_ORIGINS` bleibt in `.env.example` leer; kein
  `render.yaml`-Eintrag. Solange der Owner den Wert nicht im Render-Dashboard setzt, ist der
  gesamte gebaute Code inert (leere Liste -> Middleware ruft sofort `next()`, setzt keinen
  Header, Test T2-06-A/E5-H09 belegen Byte-Identitaet zu vorher). T-29 ist damit **im Code**
  erfuellt, in der Wirkung auf ChatGPT **noch nicht** - das haengt an einer Owner-Messung, die
  diese Phase nicht durchfuehren konnte (kein Zugriff auf ChatGPT Developer Mode).
- Keine Aenderung an der Herkunftswache selbst (`mcpOriginErlaubt`/`createMcpOriginGuard`) - T-29
  verlangt CORS zusaetzlich zur Wache, nicht deren Ersatz.
- Keine CORS-Header auf `/.well-known/oauth-protected-resource*`, Challenge- oder Login-Routen -
  ausserhalb des Scopes von T-29; ob ChatGPT diese Routen je browserseitig anspricht, ist UNKNOWN.
- Kein `Access-Control-Max-Age`, keine Session-Unterstuetzung (stateful Transport), keine
  CORS-Header auf die 429-Antwort des globalen Rate-Limiters - laut Spec bewusst ausgelassen
  (keine Anforderung, bzw. Scope-Ausweitung).
- Kein `docs/OPENAI-*`-Dokument (Plan nennt T2-06 `dokumentFuerOpenAI: nein`).
- **Bekannte Design-Asymmetrie, nicht behoben:** Die Herkunftswache vergleicht normalisiert
  (Gross-/Kleinschreibung, Trailing-Slash, Default-Port tolerant), die CORS-Middleware vergleicht
  byte-genau gegen dieselbe (aber einmalig normalisierte) Liste. Ein Origin wie
  `https://CHATGPT.COM` oder `https://chatgpt.com/` passiert die Wache, bekommt aber KEINE
  CORS-Header (Tests T2-06-H08b). Das ist im Plan nicht erwaehnt und eine bewusste Entscheidung
  des Bau-Agenten (strenger statt gleich tolerant) - kein Fehler, aber ein Verhalten, das ein
  Pruefer kennen sollte.
- **AUTH-P7-8-Erwartung wurde geaendert, nicht nur der Code**: die Testaussage "WWW-Authenticate
  darf nur in auth.js vorkommen" wurde um `middleware.js` erweitert, weil die CORS-Fabrik das Wort
  zwingend als `Access-Control-Expose-Headers`-Wert braucht. Das ist eine bewusste
  SOLL-Aenderung, kein stillschweigend gelockerter Test - aber es ist eine Aenderung an einem
  Bestandstest, die ein Pruefer nachvollziehen sollte, nicht nur hinnehmen.

## 2. Was erfuellt ist, ID T-29

**T-29** (Statelessness-Quickstart-Beispiel verlangt CORS mit `mcp-session-id` erlaubt/exponiert,
Stufe C/nicht bindend) - im Code umgesetzt, Wirkung von der Owner-Messung abhaengig:

| Kriterium (aus Plan-Abnahme) | Beleg |
|---|---|
| Leere Liste: 403 wie heute, keine `Access-Control-*`-Header | Test `T2-06-H01`, `T2-06-H02` (`test/s2-mcp-origin.test.js:547,571`); Middleware-Kurzschluss `src/middleware.js:283` (`if (!treffer) return next();`) |
| Gesetzte Liste: OPTIONS -> 204, `Access-Control-Allow-Origin: <origin>` (nie `*`), `Vary: Origin`, `Allow-Methods: POST`, `Allow-Headers` mit `authorization, content-type, mcp-session-id, mcp-protocol-version`, `Expose-Headers` mit `Mcp-Session-Id, WWW-Authenticate`, KEIN `Allow-Credentials` | Test `T2-06-H04` (`test/s2-mcp-origin.test.js:619`); Konstanten `src/middleware.js:243-246`; kein `Access-Control-Allow-Credentials` wird an keiner Stelle gesetzt (grep im Diff negativ) |
| POST ohne Token, gelisteter Origin -> 401 MIT Challenge UND CORS-Headern | Test `T2-06-H05` (`test/s2-mcp-origin.test.js:643`) |
| Fremder Origin -> 403 ohne CORS-Header | Test `T2-06-H07` (`test/s2-mcp-origin.test.js:701`) |
| Rueckgabewert nie `*`, kein Praefix-/Suffix-Match | Unit-Tests `T2-06-U01/U02/U03/U05` (`test/s2-mcp-origin.test.js:828,832,855,870`); Praedikat `mcpCorsOrigin` (`src/middleware.js:277-280`) gibt ausschliesslich ein Listen-Element oder `null` zurueck |
| CORS-Liste ist Teilmenge der Wachen-Liste (kein Origin bekommt CORS ohne die Wache zu passieren) | Test `T2-06-U04` (`test/s2-mcp-origin.test.js:861`); Konstruktion `src/routes/mcp.js:158-163` (`mcpErlaubteOrigins({ zusaetzlicheOrigins: ... })` ohne `publicUrl`) |
| Notventil `MCP_ORIGIN_ENFORCE=false` oeffnet KEINEN fremden Origin fuer CORS | Test `T2-06-H14` (`test/s2-mcp-origin.test.js:805`) |
| Auto-OPTIONS ohne Origin bleibt unveraendert | Test `T2-06-H02` (`test/s2-mcp-origin.test.js:571`) |

Isolierter Testlauf (nur die beruehrten Dateien): 68/68 gruen, 0 Fehlschlaege
(`/private/tmp/claude-501/.../logs-t2-06/isolated.log`, `ℹ pass 68` / `ℹ fail 0`).
Vollsuite laut Bau-Agent 6316/6316 gruen (nicht in dieser Berichts-Session erneut voll
durchlaufen - Kontextbudget).

## 3. Beruehrte Pfade und Vollstaendigkeit

- **HTTP-Transport `/mcp`** (Custom Connector): CORS-Middleware `router.use("/mcp", createMcpCors(...))`
  sitzt zwischen Herkunftswache und `mcpAuth` (`src/routes/mcp.js:134-160`) - deckt POST, GET,
  DELETE, Auto-OPTIONS (jede Methode, da `use`-Layer). Erfuellt fuer alle HTTP-Methoden auf
  `/mcp` selbst, NICHT fuer `/mcp/foo` (Test `T2-06-H10`, Pfadbindung `MCP_CORS_PFAD = "/"`,
  `req.path` ist relativ zum Mount-Punkt).
- **stdio-Transport** (`src/mcp-server.js`): unangetastet - kein HTTP, kein Origin-Header
  moeglich, CORS ist dort kategorisch nicht anwendbar. Punkt ist auf diesem Pfad nicht
  einschlaegig, nicht "unerfuellt".
- **Andere Routen** (`/api/*`, `/voice/*`, Login/OAuth): nicht beruehrt - Plan grenzt T-29
  explizit auf `/mcp` ein; keine CORS-Header dort, unveraendert.
- Env/Config-Kette vollstaendig fuer die neue Semantik (nicht fuer einen neuen Namen, da
  `MCP_ALLOWED_ORIGINS` bereits existiert): Kommentar in `src/config.js:1967-1974` und
  `.env.example:1010-1014` erklaeren die erweiterte Bedeutung (Wache UND jetzt CORS). Kein
  `render.yaml`-Eintrag - dort steht die Variable laut Bau-Agent auch vorher nicht (Bestandsluecke,
  nicht Teil dieser Phase; nicht selbst nachgeprueft).

## 4. Was ein fremder Pruefer nachmessen sollte

- Ist die Byte-Identitaet bei leerer Liste wirklich vollstaendig? `curl -si -X OPTIONS
  http://localhost:<port>/mcp -H 'Origin: https://chatgpt.com' -H 'Access-Control-Request-Method: POST'`
  gegen einen Checkout OHNE T2-06 und gegen den Branch vergleichen - sind alle Response-Header
  (nicht nur Status) identisch?
- Ist die Teilmengen-Eigenschaft (CORS-Liste ⊆ Wachen-Liste) auch bei einem `PUBLIC_URL`, das
  zufaellig gleich einem Eintrag in `MCP_ALLOWED_ORIGINS` ist, noch gegeben - kollidiert das
  Dedup in `mcpErlaubteOrigins` mit der "ohne publicUrl"-Konstruktion in `routes/mcp.js:158-163`?
- Ist der byte-genaue Vergleich (`mcpCorsOrigin`, `src/middleware.js:277-280`) tatsaechlich
  case-sensitiv und ohne Normalisierung - mit `Origin: https://CHATGPT.COM` gegen eine gesetzte
  Liste `https://chatgpt.com` pruefen: kommt wirklich KEIN `Access-Control-Allow-Origin`?
- Wird `Vary: Origin` bei jeder Antwort mit gesetztem ACAO angehaengt (nicht nur bei Preflight),
  auch auf die spaetere 401/403-Antwort von `mcpAuth`? Mit gesetztem Bearer-Fehler pruefen.
- Setzt die Middleware unter keiner Kombination `Access-Control-Allow-Credentials` - grep im
  gesamten Diff nach diesem Header-Namen liefert ihn nirgends; selbst nachvollziehen.
- Ist der geaenderte `test/auth-p7-gate-removed.test.js` tatsaechlich nur um `middleware.js`
  erweitert und nicht in seiner eigentlichen Aussage (WWW-Authenticate nur an autorisierten
  Stellen) ausgehoehlt - Diff der Datei lesen.
- Stimmt die Aussage der Positiv-Kontrolle (Bau-Agent), dass H01/H07 mit zurueckgebautem
  Praedikat gruen BLEIBEN, weil die Wache vorgeschaltet abfaengt - selbst durch temporaeres
  Zurueckbauen von `mcpCorsOrigin` auf "immer Treffer" nachvollziehen und pruefen, welche Tests
  dann tatsaechlich rot werden.

## 5. Owner-Punkte und Restrisiko

**Owner-Punkte** (Deploy/Messung, kein Code-Blocker fuer den Merge - der Code ist bei leerer
Liste inert):
1. Nach einem Deploy mit T2-06: Hermes im ChatGPT Developer Mode verbinden, ein Werkzeug
   aufrufen, im Render-Log nach `grund=mcp_cross_origin origin=` und `[mcp] client-class` suchen.
   Keine `mcp_cross_origin`-Zeile -> ChatGPT spricht serverseitig, Liste bleibt leer, T-29 ist
   mit dem gebauten Code erfuellt. Eine Zeile mit Host `<h>` -> Punkt 2.
2. Nur im Fall einer geloggten Fremd-Origin-Zeile: `MCP_ALLOWED_ORIGINS=https://<h>` im
   Render-Dashboard setzen (exakt der gemessene Host, kein Pfad, kein `*`, NICHT die
   Widget-Sandbox-Domain aus `ui.domain`/`chatgpt-egress.js`), Dienst neu starten. Pruefung:
   `curl -si -X OPTIONS https://<prod-host>/mcp -H 'Origin: https://<h>' -H 'Access-Control-Request-Method: POST'`
   -> 204, `access-control-allow-origin: https://<h>`, `vary: Origin`, kein
   `allow-credentials`; derselbe Befehl mit `Origin: https://evil.example` -> 403 ohne
   `access-control-*`.

**Restrisiko:** Der Code ist bei leerer Liste nachweislich inert (Testbeleg oben), das Merge-Risiko
fuer die Produktion ist damit gering. Das eigentliche Risiko liegt in der spaeteren
Owner-Aktion: wird `MCP_ALLOWED_ORIGINS` je auf einen falschen oder zu weiten Wert gesetzt (z.B.
versehentlich die Widget-Sandbox-Domain statt des ChatGPT-Hosts, oder ein Wert ohne vorherige
Messung), oeffnet das denselben Origin gleichzeitig fuer die Herkunftswache UND fuer
browserseitiges Lesen der `/mcp`-Antworten inkl. `WWW-Authenticate` - eine Ausweitung der
Semantik dieser Variable, die in `config.js`/`.env.example` kommentiert, aber nicht technisch
erzwungen ist. Zweites, kleineres Risiko: die byte-genaue/normalisiert-Asymmetrie (Abschnitt 1)
koennte bei einer kuenftigen Aenderung an der Wachen-Normalisierung unbemerkt eine Luecke
aufreissen, in der die Wache einen Origin durchlaesst, den CORS weder blockt noch bedient (heute
harmlos, da CORS-Fehlen nur bedeutet "kein Browser-Lesezugriff", nicht "Zugriff verweigert" -
Server-zu-Server-Aufrufer sind von CORS ohnehin nicht betroffen).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 9a2dcad; Tests (volle Suite, pass/fail): 6336/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-29 | ja | routes/mcp.js:226 sessionIdGenerator undefined; am Draht (LAN-IP, chatgpt.com gelistet): OPTIONS 204, Allow-Headers inkl. mcp-session-id, Expose Mcp-Session-Id; 401/200 mit ACAO, keine Session-ID; evil 403 ohne CORS. s2-mcp-origin 68/68 | Live-Rest offen (nur beim Owner messbar): welcher Origin im ChatGPT Developer Mode tatsaechlich an /mcp anfragt, und das Setzen von MCP_ALLOWED_ORIGINS im Render-Dashboard. Default leer = kein CORS-Header.
- Isoliert rot: []
- Offene Blocker:
- (keine)
