# T2-03 Abschlussbericht — Auth: `exp` Pflicht, WARN bei Nicht-OAuth in Produktion

Branch `phase/openai-t2-03-auth-exp`, Commit `238a1824a86092746fa3e9059b6a2bc5579d73a7`.
Scope dieser Phase: **nur T-12 und T-5** (nicht der Scope-Teil von T-12, der liegt in T2-23).

## 1. Was diese Phase NICHT erfuellt

- **T-12 ist nach dieser Phase nicht vollstaendig erfuellt.** Nur der `exp`-Teil ist gebaut.
  Der Scope-Teil von T-12 (Token-Scopes gegen `securitySchemes` pruefen) ist laut Plan
  ausdruecklich **T2-23**, eigener Commit, eigene Deploy-Vorbedingung. `nbf` bleibt weiterhin
  ungeprueft, wenn der Claim fehlt — das war nie Teil dieser Phase.
- **Keine Boot-Sperre bei `MCP_AUTH != oauth`.** Das ist keine Luecke, sondern eine bewusste
  Owner-/Autonome Entscheidung (P6, `tasks/openai-technik-stand.md`): eine Sperre waere
  live-wirksam und koennte beim naechsten Deploy die ganze Produktion (inkl. eingehender
  Anrufe) stilllegen, weil die Repo-Konfiguration nachweislich nicht die Produktionskonfiguration
  ist. Gebaut ist nur ein WARN-Log-Eintrag ohne Sperrwirkung.
- **Ob echte WorkOS-Access-Tokens `exp` tragen, ist ungemessen.** Das ist keine Code-Luecke,
  sondern die Deploy-Vorbedingung OW-B (Owner-Regel, siehe unten). Wird `requiredClaims: ["exp"]`
  deployt, ohne dass ein echtes Token gemessen wurde, und stellt der AS Tokens ohne `exp` aus,
  bekommt jede `/mcp`-Anfrage 401 — Claude-Connector und ChatGPT-Verbindungen waeren tot.
- **`O-7` (Schliessung der Nicht-OAuth-Luecke) bleibt offen**, ausdruecklich in
  `PLAN-SECURITY.md` vermerkt — T2-03 fuegt nur das WARN-Signal hinzu, entscheidet die
  Schliessungsfrage nicht.

## 2. Was sie erfuellt, ID fuer ID

### T-5 — Auth-Pflicht: Signal bei Nicht-OAuth in Produktion (WARN, keine Sperre)

- `src/config.js`, neue Funktion `productionAuthHints` (nach `productionFootguns`, Zeile
  ~2476-2489): liefert einen Hinweistext genau dann, wenn `isProduction` wahr ist UND
  `cfg.auth.mcpAuth` weder `"oauth"` noch `"off"` ist. `"off"` ist bereits ueber
  `productionFootguns`/`PRODUCTION_FOOTGUNS` fatal — kein Doppel-Report fuer denselben Zustand.
  Produktionsbegriff kommt ausschliesslich ueber den Parameter `isProduction` (= Aufrufer
  reicht `detectProduction()` durch), keine zweite Definition ueber `NODE_ENV` in dieser
  Funktion.
- Verdrahtung in `assertConfig()` (`src/config.js`, Ende der Funktion): die Hinweise werden
  ueber `console.error` ausgegeben, zaehlen aber **nicht** in `missing`/`fatal` und damit nicht
  in den Rueckgabewert (`return missing.length === 0 && fatal.length === 0`) — belegt keine
  Sperrwirkung.
- Tests: `test/openai-t2-03-auth-hints.test.js` (8 Unit-Tests der reinen Funktion,
  T2-03-01..08 — Produktion+`token`/leer/Tippfehler -> genau eine Zeile mit `MCP_AUTH`;
  Produktion+`oauth`/`off` -> keine Zeile; nicht-Produktion -> nie eine Zeile; Text leakt
  keinen Token-Wert; `productionFootguns` bleibt fuer den Token-Modus nicht-fatal),
  `test/openai-t2-03-boot-auth-hints.test.js` (3 Spawn-Tests, T2-03-B1..B3 — echter
  Boot-Prozess mit `MCP_AUTH=token` zeigt die Zeile im Log, mit `MCP_AUTH=oauth` nicht,
  ein Boot ganz ohne `RENDER_EXTERNAL_URL` bootet ohne Zeile und `/healthz` bleibt 200).
  Alle 11 selbst nachgefahren: `NODE_ENV=test node --test test/openai-t2-03-auth-hints.test.js
  test/openai-t2-03-boot-auth-hints.test.js` → 11/11 gruen (im Rahmen des gemeinsamen Laufs
  unten mitgezaehlt).
- Doku: `PLAN-SECURITY.md` (Ergaenzung zum bestehenden T-5-Abschnitt, expliziter Verweis auf
  `productionAuthHints`, ausdruecklich "Dieser Eintrag bleibt OFFEN").

### T-12 (nur `exp`-Teil, ohne Scope) — `exp` ist jetzt Pflichtclaim

- `src/auth.js:106`, im `jwtVerify`-Aufruf: `requiredClaims: ["exp"]` ergaenzt (vorher fehlte
  die Zeile komplett — `jose` prueft `exp` sonst nur, wenn der Claim vorhanden ist). Fehlt
  `exp`, wirft `jwtVerify`, der bestehende catch-Zweig liefert 401 + `WWW-Authenticate`.
- `test/helpers.js`: `idp.sign()` kann jetzt `exp: null` signieren (Token ganz ohne
  `exp`-Claim). Umgesetzt ueber zwei getrennte `SignJWT`-Ketten in `buildJwt()`
  (mit/ohne `.setExpirationTime()`), nicht per if-Verzweigung in `sign()` selbst — laut
  Bau-Notiz, um die Komplexitaets- bzw. Suppressions-Zaehlung der Datei nicht zu verschieben.
  Selbst gelesen: `test/helpers.js:1297-1311` — Struktur bestaetigt, zwei separate Ketten.
- `test/oauth.test.js`, neuer Subtest "Token ohne exp -> 401 + WWW-Authenticate mit
  resource_metadata" (Zeilen 74-98): signiert ein Token ohne `exp`, prueft per
  Payload-Dekodierung, dass `exp` wirklich fehlt (Test-Setup-Beleg), dann 401 +
  `error="invalid_token"` + korrekte `resource_metadata`-URL, gegen `srv.localUrl` und —
  wenn eine externe Interface-IP existiert — zusaetzlich gegen `srv.externalUrl`. Selbst
  ausgefuehrt (isoliert, `test/oauth.test.js` allein): gruen.
- Doku: `docs/OPENAI-AUTH-ABWEICHUNGEN.md`, DE+EN, drei Stellen aktualisiert (Architektur-
  Uebersicht, Detailabschnitt "Einschraenkung nbf/exp", OW-B-Checkliste) — an allen dreien
  jetzt "`exp` Pflicht" statt "nur wenn vorhanden", mit Verweis auf OW-B als Deploy-
  Vorbedingung. Selbst per Diff gelesen, inhaltlich konsistent mit dem Code.

## 3. Beruehrte Pfade — Vollstaendigkeit

- **HTTP-`/mcp` (Streamable HTTP)**: einziger Pfad, der `verifyOauth()`/`jwtVerify` durchlaeuft
  (`src/routes/mcp.js` -> `src/auth.js`). Der neue Test deckt ihn ueber `srv.localUrl` und
  optional `srv.externalUrl` ab — beide sind derselbe Server/Code, keine zweite Implementierung.
  **T-12 ist damit auf dem einzigen Pfad erfuellt, der existiert.**
- **stdio-Transport (`src/mcp-server.js`)**: traegt laut Autonomer Entscheidung (P3,
  `openai-technik-stand.md`) **gar keine Auth-Schicht** — `mcpAuth` haengt ausschliesslich an
  `src/routes/mcp.js`. `requiredClaims` betrifft ihn nicht, weil dort nie `jwtVerify` laeuft.
  Das ist kein Luecken-Rest dieser Phase, sondern Bestandsarchitektur.
- **T-5 (WARN)**: nur die Boot-Sequenz (`assertConfig()`, einmal beim Prozessstart). Kein
  Laufzeit-/Pro-Request-Pfad betroffen — by design (reines Boot-Signal).
- Insgesamt: die Aenderung ist auf allen Pfaden konsistent, weil es fuer den geschuetzten
  Anteil (HTTP `/mcp`) nur einen Codepfad gibt und der ungeschuetzte Pfad (stdio) unveraendert
  bleibt.

## 4. Was ein fremder Pruefer nachmessen sollte

- Ist `requiredClaims: ["exp"]` tatsaechlich in `src/auth.js` im aktiven `jwtVerify`-Aufruf
  gesetzt, und nicht in einem toten/ungenutzten Zweig? (`src/auth.js:106`, Aufrufer
  `verifyOauth()`.)
- Rot-vor-Gruen: liefert ein Token ohne `exp` gegen den echten Server tatsaechlich 401, und
  war das vor dem Commit `238a182`/dem `requiredClaims`-Commit noch 200? (Der Bericht behauptet
  das ueber `NODE_ENV=test node --test test/oauth.test.js` als Vorher/Nachher-Vergleich; ein
  Pruefer kann das mit `git stash`/`git show master:src/auth.js` gegen den aktuellen Stand
  selbst nachvollziehen.)
- Ist `productionAuthHints` wirklich rein additiv — aendert `assertConfig()`'s Rueckgabewert
  sich, wenn nur `MCP_AUTH=token` in Produktion gesetzt wird, sonst nichts? (`src/config.js`,
  Funktionsende, Rueckgabezeile.)
- Erscheint die WARN-Zeile in einem echten Boot-Prozess mit `RENDER_EXTERNAL_URL` gesetzt und
  `MCP_AUTH != oauth/off`, und bleibt sie bei `MCP_AUTH=oauth` aus? (Spawn-Probe, wie in
  `test/openai-t2-03-boot-auth-hints.test.js` T2-03-B1/B2 vorgezeichnet.)
- Deckt `nbf` weiterhin keine Pflicht ab — ist das im Diff und in der Doku konsistent so
  dargestellt, oder behauptet irgendeine Stelle mehr, als gebaut wurde?
- Laeuft die volle Testsuite in diesem Worktree isoliert gruen (`npm test -- --
  --test-concurrency=4`), und stimmt die Pass-Zahl mit der hier berichteten ueberein?

## 5. Owner-Punkte und Restrisiko

Konsolidiert (die vier Roh-Eintraege im Auftrag beschreiben zwei Handlungen mit
Ueberschneidung):

**OW-B (Deploy-Vorbedingung, zwingend vor jedem Deploy dieser Kette):** ein echtes
WorkOS-Access-Token dekodieren (Base64, mittlerer JWT-Teil, nirgends einfuegen) und pruefen,
ob `exp` vorhanden, numerisch und zeitlich nach `iat` liegt. Fehlt `exp`: den Commit mit
`requiredClaims: ["exp"]` in `src/auth.js` vor dem Deploy per `git revert` zuruecknehmen — die
WARN-Commits (T-5) bleiben davon unberuehrt stehen. Grund: ohne diese Pruefung koennte ein
Deploy jede echte `/mcp`-Anfrage (Claude-Connector des Owners, jede ChatGPT-Verbindung) mit 401
lahmlegen, wenn der AS Tokens ohne `exp` ausstellt.

**OW-A (nach dem Deploy):** Render-Boot-Log pruefen, dass die WARN-Zeile
"MCP_AUTH ist nicht 'oauth'" NICHT erscheint (live gilt `MCP_AUTH=oauth`). Erscheint sie, den
Dashboard-Wert `MCP_AUTH` pruefen. Danach einmal ein Tool im eigenen Claude-Connector aufrufen
— erwartet: Erfolg, kein 401.

**Restrisiko:** Der Code ist fail-closed und additiv sauber gebaut (durch eigene Tests
belegt, isoliert nachgefahren, 6285/0 in der vollen Suite). Das verbleibende Risiko liegt
vollstaendig in OW-B — einem ungemessenen Live-Wert, den nur der Owner pruefen kann. Wird OW-B
uebersprungen, ist der Blast-Radius total (kompletter Auth-Ausfall fuer `/mcp`), aber der
Fix ist ein einzeiliger, chirurgisch isolierter Revert, kein Rollback der ganzen Phase.

## Testbeleg

Ziel-Tests isoliert (`NODE_ENV=test node --test test/oauth.test.js
test/openai-t2-03-auth-hints.test.js test/openai-t2-03-boot-auth-hints.test.js`): 26/26 gruen,
0 rot.

Volle Suite in diesem Worktree (`npm test -- -- --test-concurrency=4`): `# pass 6285`,
`# fail 0` (selbst ausgefuehrt und geloggt, Logdatei
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/bd9573f0-5514-4611-89e2-53dd73e46bd1/scratchpad/logs-t2-03/fulltest.txt`).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: FAIL (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 238a182 (letzter bestehender Commit der Phase; kein neuer Commit noetig); Tests (volle Suite, pass/fail): 6285/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-12 | nein | src/auth.js:98-107 jwtVerify mit JWKS, issuer, audience, requiredClaims:["exp"]. Draht (Interface-IP, MCP_AUTH=oauth): ohne exp 401, abgelaufen 401, gueltig 200. Live offen: ob echtes AS-Token exp traegt. | Scopes werden nicht geprueft: Token mit scope:"nicht-vergeben" -> 200 am Draht; grep scope in src/auth.js leer. nbf nur, wenn vorhanden. Der Anforderungstext nennt Scopes ausdruecklich.
  - T-5 | ja | Draht, OAuth-Modus, Interface-IP: PRM /.well-known/oauth-protected-resource 200 (resource+authorization_servers), /mcp ohne Token 401 WWW-Authenticate resource_metadata; aud/iss/exp geprueft (src/auth.js:91-155). | OAuth nur bei MCP_AUTH=oauth; die Phase ergaenzt nur einen WARN-Hinweis (config.js productionAuthHints). Live offen: ob Prod oauth setzt. Keine Scope-Challenge (insufficient_scope).
- Isoliert rot: []
- Offene Blocker:
  - T-12: Scopes werden nicht geprueft: Token mit scope:"nicht-vergeben" -> 200 am Draht; grep scope in src/auth.js leer. nbf nur, wenn vorhanden. Der Anforderungstext nennt Scopes ausdruecklich.
  - safety/wichtig src/auth.js:106: requiredClaims: ["exp"] ist korrekt fail-closed gebaut. Ob echte WorkOS-Access-Tokens exp tragen, ist aber weiterhin ungemessen. Die Deploy-Vorbedingung OW-B steht in PLAN-SECURITY.md (Punkt 5) und in docs/OPENAI-AUTH-ABWEICHUNGEN.md, taucht im Code-Diff aber nicht auf.
