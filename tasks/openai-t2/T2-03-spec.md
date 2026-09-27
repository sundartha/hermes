# T2-03 - Auth: `exp` Pflicht, WARN bei Nicht-OAuth in Produktion (Spec)

- IDs (gepinnt): T-12 (nur `exp`-Anteil; Scope-Anteil = T2-23), T-5
- Risiko: auth. Eigene Gegenprobe Pflicht. Auth-Code nie lokal abschwaechen.
- Branch: `phase/openai-t2-03-auth-exp`, Worktree `.../scratchpad/wt-t2-03`
- Basis-Commit: `fff3b95` (master, Merge T2-02)
- Baseline (vor jeder Aenderung, im Worktree gemessen): `oauth`, `config-prod-footguns`,
  `boot-prod-footguns`, `openai-p7-token-pruefachsen`, `openai-p6-challenge` -> `pass 54 / fail 0`.
- Quellen: Plan `tasks/PLAN-OPENAI-TECHNIK-2.md` Abschnitt T2-03 (+ Owner-Liste OW-A/OW-B),
  Anforderungen `tasks/openai-audit/00-openai-anforderungen.md` Zeilen T-5/T-12, Autonome
  Entscheidung P6 (nur WARN, keine neue Boot-Verweigerung).

## Anforderung (OpenAI-Fassung)

- T-5: "you are expected to implement an OAuth 2.1 flow that conforms to the MCP authorization spec"
  -> Hermes-Seite: Resource Server steht; offen ist nur das fehlende Signal, wenn Produktion NICHT
  im OAuth-Modus laeuft.
- T-12: Token-Pruefung serverseitig inkl. `exp`/`nbf`. Heute: `jose` 6.2.3 prueft `exp` nur, wenn
  der Claim vorhanden ist; `src/auth.js:98-102` setzt kein `requiredClaims` -> ein signiertes
  Token ohne `exp` gilt unbefristet.

## Am Code nachgesehen (Worktree, fff3b95)

- `src/auth.js:98-102` `jwtVerify(token, await getJwks(), { issuer, audience: audience(), clockTolerance: 30 })` - stimmt.
- `src/config.js:204-206` `detectProduction()` = `!!process.env.RENDER_EXTERNAL_URL` - stimmt.
- `src/config.js:2469` `productionFootguns(cfg = config, isProduction = detectProduction())` - stimmt.
- `src/config.js:2638-2651` `assertConfig()` - stimmt (ruft `fatalConfigFindings(isProduction)`, `:2577`).
- `grep -c NODE_ENV src/config.js` = **1** (nur `:34`, Testmodus).
- `MCP_AUTH=off` ist in Produktion bereits FATAL (`PRODUCTION_FOOTGUNS`, `src/config.js:2426-2427`).
- `test/helpers.js:1294-1306` `idp.sign()` setzt IMMER `setExpirationTime(exp)` - ein Token OHNE
  `exp` laesst sich heute nicht erzeugen (37 Aufrufer ausserhalb von `oauth.test.js`).
- `jwtVerify` gibt es in `src/` nur an dieser einen Stelle (kein zweiter Token-Pfad).

## Schritte

### Schritt 1 - Test-IdP kann ein Token OHNE `exp` signieren
- Was: `idp.sign()` bekommt die Moeglichkeit, `exp` wegzulassen (z.B. `exp: null` -> kein
  `setExpirationTime`). Default bleibt `"5m"` - alle bestehenden Aufrufer unveraendert.
- Wo: `test/helpers.js:1294-1306` (`startIdp` -> `sign`), Kommentar analog `noSubject`.
- IDs: T-12. Pfade: HTTP /mcp, OAuth (nur Testinfrastruktur).
- Beweis: (b) der neue Test aus Schritt 2 ("ohne exp -> 401") ist VOR Schritt 3 rot
  (Status 200 statt 401) und NACH Schritt 3 gruen. Rot-vor-Gruen im Bericht mit beiden
  Summenzeilen belegen. Zusaetzlich im Test pruefen, dass das erzeugte Token wirklich kein
  `exp` traegt (Payload lokal dekodieren, `assert.equal(payload.exp, undefined)`) - sonst
  koennte der Test aus dem falschen Grund gruen sein.

### Schritt 2 - Draht-Tests `exp` am echten HTTP-/mcp-Pfad
- Was: in `test/oauth.test.js` (Block "MCP_AUTH=oauth: Resource Server prueft Tokens") zwei
  Subtests ergaenzen:
  (a) "Token ohne exp -> 401 + WWW-Authenticate mit resource_metadata" - `idp.sign({...}, { exp: null })`,
      `mcpPost` mit `tools/list`- oder initialize-Body; erwartet 401, Header matcht
      `resource_metadata="https://agent.test/.well-known/oauth-protected-resource"` und
      `error="invalid_token"`; Body ohne `jsonrpc`-Ergebnis.
  (b) Positiv-Kontrolle "Token mit exp in der Zukunft -> kein 401" existiert bereits
      ("gueltiges Token", `oauth.test.js` letzter Subtest) - nicht duplizieren, aber im Bericht
      als Positiv-Kontrolle nennen. Abgelaufen -> 401 existiert (`oauth.test.js:66-70`).
  Optional (empfohlen): Request zusaetzlich ueber `externalIp()` (`test/helpers.js:600`) statt
  `127.0.0.1` schicken, damit kein Loopback-Sonderweg mitspielt (im OAuth-Zweig gibt es keinen,
  der Beleg ist dann aber lageunabhaengig). Skip, wenn `externalIp()` null ist - wie Bestand.
- Wo: `test/oauth.test.js` nach dem Subtest "abgelaufenes Token -> 401".
- IDs: T-12. Pfade: HTTP /mcp, OAuth.
- Beweis: (b) `NODE_ENV=test node --test --test-name-pattern="ohne exp" test/oauth.test.js` gruen;
  vor Schritt 3 rot (Status 200).

### Schritt 3 - `exp` Pflicht im Resource Server
- Was: `requiredClaims: ["exp"]` im Options-Objekt von `jwtVerify`. Als NEUE Zeile NACH
  `clockTolerance: 30,` einfuegen, damit die Zeilenverweise `src/auth.js:99` (issuer) und `:101`
  (clockTolerance) in `test/openai-p7-token-pruefachsen.test.js:5-6,23` stimmen bleiben.
  Kommentar (Deutsch, ohne Umlaute): warum (jose prueft `exp` sonst nur bei Vorhandensein; T-12)
  und dass ein Token ohne `exp` jetzt im catch-Zweig mit 401 + oauth-Challenge endet
  (Audit `grund=ERR_JWT_CLAIM_VALIDATION_FAILED`, kein Token im Log). `clockTolerance` bleibt 30,
  `nbf` bleibt optional (nicht Teil der Anforderung, nicht verschaerfen).
- EIGENER Commit (nur `src/auth.js` + Tests aus Schritt 1/2), getrennt von Schritt 4-6: das ist
  der Commit, den OW-B bei "Token ohne exp" vor dem Deploy zuruecknimmt - er muss chirurgisch
  revertierbar sein.
- Wo: `src/auth.js:98-102`.
- IDs: T-12. Pfade: HTTP /mcp OAuth. NICHT betroffen (begruendet): stdio (keine Auth-Schicht,
  keine Tokens), Token-/Legacy-Modus (statisches Bearer, kein JWT, `safeEqual`), Web-Login
  (`jwtVerify` existiert in `src/` nur hier).
- Beweis: (a) `grep -n 'requiredClaims: \["exp"\]' src/auth.js` -> genau 1 Treffer innerhalb
  des `jwtVerify`-Aufrufs; (b) Schritt-2-Test gruen; gesamter Block `oauth.test.js` +
  `openai-p7-token-pruefachsen.test.js` gruen (Positiv-Kontrolle: gueltiges Token mit `exp`
  bleibt nicht-401 bzw. 200 bei tools/list).

### Schritt 4 - reine Funktion `productionAuthHints(cfg, isProduction = detectProduction())`
- Was: neue exportierte reine Funktion in `src/config.js`, direkt nach `productionFootguns`
  (`:2469-2474`), gleiches Muster (Tabelle oder eine Bedingung, keine if-Kette; liefert Array
  von Hinweiszeilen).
  Regel:
  - `isProduction === false` -> `[]`.
  - `cfg.auth.mcpAuth === "oauth"` -> `[]`.
  - `cfg.auth.mcpAuth === "off"` -> `[]` (bereits FATAL ueber `PRODUCTION_FOOTGUNS`
    `:2426-2427`; kein Doppel-Report, Muster `warnLocalOnlyFootguns` "kein Doppel-Report").
  - sonst (`""`, `"token"`, jeder unbekannte Wert wie Tippfehler `"oath"` - der landet in
    `mcpAuth()` im statischen Bearer-Zweig) -> GENAU EINE Zeile.
  Text: fester String, nennt `MCP_AUTH`, KEINEN Wert (weder den Modus-Wert noch
  `MCP_AUTH_TOKEN`), z.B. `"[Sicherheit] MCP_AUTH ist nicht 'oauth' - /mcp laeuft im Hosting mit
  statischem Bearer statt OAuth 2.1; Claude-/ChatGPT-Connectoren erhalten 401 (T-5). Kein
  Boot-Stopp (Hinweis)."` Produktion wird NUR ueber den Parameter gelesen, kein
  `process.env`/`NODE_ENV`/`config.server.isProduction` in der Funktion.
- NICHT in `PRODUCTION_FOOTGUNS` und NICHT in `fatalConfigFindings` (sonst Sperrwirkung =
  Verstoss gegen Autonome Entscheidung P6).
- Wo: `src/config.js` nach `:2474`.
- IDs: T-5. Pfade: Boot des HTTP-Gateways (Token/Legacy-Modus in Produktion).
- Beweis: (b) Schritt 6 (Unit-Tests); (a) `grep -n "productionAuthHints" src/config.js` zeigt
  Definition + genau einen Aufruf in `assertConfig`, KEINEN in `fatalConfigFindings`
  (`:2577-2594`).

### Schritt 5 - Verdrahtung in `assertConfig()`
- Was: in `assertConfig()` (`src/config.js:2638-2651`) die Zeilen aus
  `productionAuthHints(config, isProduction)` - DERSELBE lokale `isProduction` wie fuer
  `fatalConfigFindings` - per `console.error` ausgeben, UNABHAENGIG davon, ob `missing`/`fatal`
  Eintraege haben (also nicht im `if (missing.length || fatal.length)`-Zweig und nicht in
  `reportFatalConfig`). Rueckgabewert von `assertConfig` unveraendert (Hinweise zaehlen nicht).
- Wo: `src/config.js:2638-2651`.
- IDs: T-5. Pfade: HTTP-Gateway-Boot (`src/boot.js:515`). stdio (`npm run mcp`) ruft
  `assertConfig` nicht und bedient kein `/mcp` - nicht betroffen.
- Beweis: (b) Schritt 7 (Spawn-Tests); (c) `grep -c "NODE_ENV" src/config.js` -> `1` (vorher 1).

### Schritt 6 - Unit-Tests der reinen Funktion
- Datei: `test/config-prod-footguns.test.js` (Muster `SAFE_PROD`) oder neue
  `test/openai-t2-03-auth-hints.test.js`. Keine Katalog-ID am Namensanfang (sonst landet der
  Test im Gates-Lauf) - Praefix z.B. `T2-03-...`.
- Faelle:
  1. `isProduction=true`, `mcpAuth="token"` -> Laenge 1, Zeile matcht `/MCP_AUTH/`.
  2. `isProduction=true`, `mcpAuth=""` -> Laenge 1, matcht `/MCP_AUTH/`.
  3. `isProduction=true`, `mcpAuth="oath"` (Tippfehler) -> Laenge 1.
  4. `isProduction=true`, `mcpAuth="oauth"` -> `[]`.
  5. `isProduction=true`, `mcpAuth="off"` -> `[]` UND `productionFootguns(..., true)` enthaelt
     die `MCP_AUTH=off`-Zeile (kein Signalverlust).
  6. `isProduction=false`, `mcpAuth` in {`""`,`"token"`,`"off"`} -> `[]`.
  7. Marker: `mcpAuthToken: "T203-MARKER-xyz"` (nur Testwert) + `mcpAuth="token"`,
     `isProduction=true` -> keine Zeile enthaelt den Marker.
  8. Keine Sperrwirkung an der Wurzel: `productionFootguns({...SAFE_PROD, auth: {...,
     mcpAuth: "token", mcpAuthToken: "x"}}, true)` -> `[]` (Token-Modus bleibt nicht-fatal).
- IDs: T-5. Beweis: (b) gruen, isoliert per
  `NODE_ENV=test node --test --test-name-pattern="T2-03" test/<datei>.test.js`.

### Schritt 7 - Spawn-Tests Boot-Verdrahtung
- Datei: `test/boot-prod-footguns.test.js` (Muster `PROD_SAFE`, `:13`) oder neue Datei.
- Faelle:
  1. `startServerExpectExit({ env: { ...PROD_SAFE, MCP_AUTH: "token", MCP_AUTH_TOKEN: "t" } })`
     -> `output` enthaelt die Hinweiszeile (Regex auf festen Text). Exit-Code NICHT pruefen:
     er ist 1 wegen des BESTEHENDEN Footguns `STORE_BACKEND != pg` (nicht diese Phase).
     Zusaetzlich: `output` enthaelt den `MCP_AUTH_TOKEN`-Testwert nicht.
  2. Dasselbe mit `MCP_AUTH: "oauth", OAUTH_ISSUER_URL: "https://idp.test"` -> `output`
     enthaelt die Zeile NICHT (Positiv-Kontrolle der Bedingung).
  3. Keine Sperrwirkung / kein Produktionsbegriff ausserhalb `RENDER_EXTERNAL_URL`:
     `startServer({ env: { RENDER_EXTERNAL_URL: "", NODE_ENV: "production", MCP_AUTH: "token",
     MCP_AUTH_TOKEN: "t" } })` -> bootet, `GET /healthz` 200, `srv.stdout` enthaelt die Zeile
     NICHT. (`NODE_ENV=production` belegt, dass kein zweiter Diskriminator greift. Pruefen, ob
     `NODE_ENV=production` im Spawn andere Seiteneffekte hat - falls ja, diesen Zusatz weglassen
     und nur `RENDER_EXTERNAL_URL: ""` setzen; im Bericht begruenden.)
  `RENDER_EXTERNAL_URL` und `MCP_AUTH` in jedem Fall EXPLIZIT setzen (BASE_ENV setzt beide nicht,
  sonst Drift aus der Umgebung).
- IDs: T-5. Pfade: HTTP-Gateway-Boot, Token- und Legacy-Modus (Fall 1 mit `MCP_AUTH: ""`
  optional als Variante).
- Beweis: (b) gruen isoliert; Server danach mit `ps aux | grep "[n]ode.*server.js"` = 0.

### Schritt 8 - Doku nachziehen
- `docs/OPENAI-AUTH-ABWEICHUNGEN.md`: die "exp nur wenn vorhanden / unbefristet / nicht
  geaendert"-Aussagen korrigieren - DE `:23-24`, `:140-146`, `:680-682`; EN `:260`, `:342-348`,
  `:517-519`. Neu: `exp` ist Pflicht (`src/auth.js` `requiredClaims`), Beleg Test aus Schritt 2;
  `nbf` weiterhin nur bei Vorhandensein; Scope-Teil von T-12 bleibt offen (T2-23). Die
  Owner-Pruefliste `:497`/`:639` ("`exp` - ist der Claim vorhanden?") BLEIBT - sie ist jetzt
  Deploy-Vorbedingung, nicht mehr Einschraenkung. Deutsch und Englisch inhaltsgleich.
- `PLAN-SECURITY.md`: Punkt "5. OFFEN - `exp` wird nicht verlangt" (`:5143-5151`) auf
  "umgesetzt in T2-03, Deploy-Vorbedingung OW-B" setzen (nicht loeschen, Historie bleibt);
  Risiko-Eintrag U-1/O-7 (`:5013-5030`): ergaenzen, dass es jetzt ein WARN-Signal beim Boot
  gibt (keine Sperre, Autonome Entscheidung P6) - Eintrag bleibt OFFEN.
- IDs: T-12, T-5. Beweis: (c) `grep -n "unbefristet" docs/OPENAI-AUTH-ABWEICHUNGEN.md` -> keine
  Aussage mehr, die den IST-Zustand als unbefristet beschreibt (historische Formulierung nur im
  Praeteritum); `grep -n "requiredClaims" docs/OPENAI-AUTH-ABWEICHUNGEN.md PLAN-SECURITY.md`
  nennt den Stand "umgesetzt".

### Schritt 9 - Gesamtlauf
- `npm test -- -- --test-concurrency=4 > <logs-t2-03>/full.log 2>&1`; nur `# pass`/`# fail`
  bzw. `ℹ pass`/`ℹ fail` und `not ok`-Zeilen lesen. Jeder rote Test isoliert wiederholen,
  zaehlt erst dann. `npm run lint` gruen (keine neuen Suppressions). `node --check src/auth.js`,
  `node --check src/config.js`.
- Beweis: (c) Summenzeilen im Bericht; `fail 0` bzw. jeder Rest isoliert gruen.

## Tests: was bricht, was beweist

- Bricht erwartbar: nichts. Alle bestehenden Tokens kommen aus `idp.sign()` mit Default-`exp`.
  `openai-p7-token-pruefachsen` bleibt gruen, solange die Zeilen `:99`/`:101` stehen bleiben
  (nur Kommentar-Verweise, aber sauber halten).
- Beweist neu: Schritt 2 (Draht, 401 ohne `exp`), Schritt 6 (reine Funktion), Schritt 7 (Boot).
- Keine neue Env-Variable -> kein Vier-Orte-Schritt.

## Nicht bauen (mit Grund)

- Scope-Pruefung am Token (Scope-Teil von T-12): Phase T2-23, eigener Commit + eigene
  Deploy-Vorbedingung.
- Boot-Sperre bei `MCP_AUTH != oauth`: Autonome Entscheidung P6 - nur WARN. Eine Sperre legt im
  Fehlerfall ALLES lahm, auch eingehende Anrufe.
- `nbf` Pflicht: nicht gefordert; OpenAI verlangt Ablehnung abgelaufener/noch-nicht-gueltiger
  Tokens, jose prueft `nbf`, wenn vorhanden (belegt `openai-p7` T2).
- `maxTokenAge`/`iat`-Pflicht: nicht gefordert, zusaetzliches Live-Risiko ohne Anforderung.
- Aenderung von `clockTolerance: 30`: nicht Teil der Phase (bestehender Wert).
- WARN auch fuer `MCP_AUTH=off`: bereits fatal in Produktion - Doppel-Report vermeiden.
- stdio-Pfad: keine Auth-Schicht, keine Tokens, kein `/mcp` - gegenstandslos.
- Umbenennung `SKIP_TWILIO_SIGNATURE_CHECK` o.ae.: nicht Teil der Phase.
- Aenderung `render.yaml`/`.env.example`: keine neue Variable.
- Safety-Gates, Offenlegungssatz, Kosten-/Outbound-Gates: unberuehrt.

## Pre-Mortem (ein Jahr spaeter war T2-03 ein Fehler - was ist passiert?)

1. **Produktion tot nach Deploy**: WorkOS stellt Access-Tokens ohne `exp` aus -> jedes echte
   Token 401 -> Claude-Connector des Owners und jede ChatGPT-Verbindung tot. Entschaerfung:
   Deploy-Vorbedingung OW-B (`exp` am echten Token belegt), `exp`-Pflicht als EIGENER Commit
   (Schritt 3), damit der Rueckzug ein einzelnes `git revert` ist. Rueckzugsregel: fehlt `exp`,
   Commit vor Deploy zuruecknehmen und `exp`-Pflicht als OWNER markieren.
2. **WARN wird versehentlich zur Sperre** (in `PRODUCTION_FOOTGUNS`/`fatalConfigFindings`
   gelandet): Produktion bootet nicht -> auch Inbound-Anrufe tot. Entschaerfung: Unit-Fall 8
   (`productionFootguns` bleibt `[]` bei `token`), Spawn-Fall 3 (`/healthz` 200), Code-Beleg
   Schritt 4.
3. **WARN erscheint in Produktion nie** (zweiter Produktionsbegriff ueber `NODE_ENV`) oder ein
   zweiter Diskriminator driftet: Entschaerfung: `isProduction` nur als Parameter mit Default
   `detectProduction()`, `grep -c NODE_ENV src/config.js` bleibt 1, Spawn-Fall 3 mit
   `NODE_ENV=production` ohne `RENDER_EXTERNAL_URL` -> keine Zeile.
4. **Secret-Leak im Log**: Hinweis nennt versehentlich `MCP_AUTH_TOKEN`. Entschaerfung: fester
   Text ohne Werte, Marker-Tests (Unit 7, Spawn 1).
5. **Auth-Loch durch Test-Helfer**: `idp.sign()`-Default aendert sich und alle Positiv-Tests
   laufen ploetzlich ohne `exp` - oder der Test "ohne exp" signiert doch mit `exp` und ist gruen
   aus dem falschen Grund. Entschaerfung: Default unveraendert, Rot-vor-Gruen-Nachweis
   (Schritt 1), Negativtest prueft Status 401 UND Challenge-Header.
6. **Clock-Skew-/Refresh-Folgen**: nicht betroffen - `clockTolerance` und Refresh-Verhalten
   unveraendert; ein Token mit `exp` verhaelt sich byte-gleich wie vorher.
7. Kein ungewollter Anruf, keine SMS, keine Kostenwirkung: die Phase beruehrt nur die
   Token-Annahme (strenger) und eine Log-Zeile.

## Widersprueche / Ergaenzungen zum Plan

- Der Plan nennt als Dateien nicht `test/helpers.js`; ohne Erweiterung von `idp.sign()` ist
  "Token ohne exp" mit dem Test-IdP nicht erzeugbar (`test/helpers.js:1294-1306` setzt immer
  `setExpirationTime`). Ergaenzt als Schritt 1.
- Der Plan laesst `MCP_AUTH=off` offen; "!= oauth" wuerde einen Doppel-Report zur bestehenden
  Fatal-Zeile erzeugen. Festgelegt: `off` -> kein Hinweis (bereits fatal).
- `requiredClaims` als neue Zeile NACH `clockTolerance` einfuegen, sonst veralten die
  Zeilenverweise in `test/openai-p7-token-pruefachsen.test.js:5-6,23` (`:99`, `:101`).
- T-12 wird durch T2-03 NICHT vollstaendig erfuellt (Scope-Teil in T2-23) - Plan sagt das, im
  Bericht so ausweisen.
- Alle vom Plan genannten Zeilen (`auth.js:98-102`, `config.js:204-206/:2469/:2638-2651`,
  `NODE_ENV` nur `:34`) am Code bestaetigt.

## Owner-Punkte (nach Owner-Regel)

- **OW-B (Deploy-Vorbedingung T2-03): echtes Access-Token dekodieren.** Anleitung: Access-Token
  aus einem echten Login gegen den konfigurierten Authorization-Server beschaffen (Weg laut
  Plan OW-B: gemergten master lokal im OAuth-Modus starten, MCP Inspector, OAuth-Login). Den
  mittleren JWT-Teil nur lokal base64url-dekodieren, nirgends einfuegen. Erwartet: Claim `exp`
  vorhanden, numerisch, in der Zukunft relativ zu `iat`. Ergebnis ja/nein (keine Werte) an den
  Lead. Bei "nein": T2-03-`exp`-Commit (Schritt 3) vor dem Deploy zuruecknehmen, `exp`-Pflicht
  als OWNER markieren; die WARN-Commits bleiben.
- **OW-A Deploy (danach) + Render-Boot-Log**: nach dem Deploy im Boot-Log pruefen, dass die
  Zeile "MCP_AUTH ist nicht 'oauth'" NICHT erscheint (live `MCP_AUTH=oauth`). Erscheint sie:
  Dashboard-Wert `MCP_AUTH` pruefen. Danach eigenen Claude-Connector einmal aufrufen - erwartet
  funktionierender Tool-Aufruf (kein 401).
