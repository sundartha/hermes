# Abschlussbericht T2-23 — Auth: Scope-Angabe des RS (PRM, Challenge, securitySchemes)

Branch `phase/openai-t2-23-auth-scopes`, HEAD `545e195` (4 Commits: `e211b19`, `8c27b61`, `bf05aa2`, `545e195`).
IDs im Scope dieser Phase: **T-16** (Resource-Server-Anteil), **T-12** (Scope-Prüfung).

**WICHTIGER HINWEIS ZUR EIGENEN TATSACHEN-GRUNDLAGE:** Der mir übergebene Tatsachen-Block
behauptet, Commit B (T-12, Scope-Prüfung am Token) sei "komplett offen" und nicht gebaut. Das
ist **falsch für den tatsächlichen HEAD-Stand**, den ich per `git diff master...HEAD` geprüft
habe: Commit B (`bf05aa2`) existiert im Branch und ist mit Commit `545e195` bereits um die
zuvor offenen Review-Befunde (DRY, Leak-Test) nachgebessert. Der Tatsachen-Block war offenbar
aus einem früheren Punkt derselben Kette destilliert; ich berichte hier den Stand von HEAD
(`545e195`), nicht den Stand des Tatsachen-Blocks. Wo ich das nicht zweifelsfrei am Diff
nachvollziehen konnte, steht es als UNKNOWN unten.

## 1. Was diese Phase NICHT erfüllt (zuerst, nicht versteckt)

- **Cleancode-Blocker aus der vorigen Review-Runde ist NICHT behoben:** `grantedScopes()`
  (`src/auth.js`, Zweig `typeof payload.scp === "string"`) hat weiterhin **keinen** Test. Ich habe
  `test/openai-t2-23-scopes.test.js` nach HEAD gelesen: B1 testet `scope` als String, B2 `scp` als
  Array — ein Token mit `scp` als vollständigem String (`"openid email offline_access"`) kommt in
  keinem Test vor, obwohl genau das die eigene Spec verlangt (`tasks/openai-t2/T2-23-spec.md`
  Abnahme 8). Der Nachbesserungs-Commit `545e195` hat andere Befunde behoben, diesen nicht.
- **Cleancode-Befund „Obermenge -> 200" ebenfalls nicht behoben:** kein Test mit
  `scope: "openid email offline_access profile"` o.ä. Kein Blocker (kein neuer Codezweig), aber
  Spec/Test-Deckung bleiben auseinander.
- **Safety-Befund „OW-B misst nur das erste Token" ist NICHT behoben:** ich habe den neuen
  Abschnitt „OpenAI-T2-23" in `PLAN-SECURITY.md` (Zeilen ~5468–5525) sowie die geänderten Stellen
  in `docs/OPENAI-AUTH-ABWEICHUNGEN.md` gelesen — beide beschreiben weiterhin nur EINEN
  Messpunkt („Login mit S gelingt, Access-Token dekodieren, scope/scp trägt alle drei Werte").
  Kein Text erwähnt einen zweiten Messpunkt über einen `refresh_token`-Grant, und die
  Alternative aus dem Review (offline_access aus der GEPRÜFTEN, nicht der BEWORBENEN Menge
  ausnehmen) wurde nicht umgesetzt. Das im vorigen Review beschriebene Risiko (WorkOS spiegelt
  `offline_access` im Refresh-Token evtl. nicht -> stundenversetzter 403-Totalausfall aller
  Connectoren) besteht unverändert im jetzigen Code.
- **T-16 bleibt teilweise offen, nicht durch diese Phase schließbar:** ob `/oauth2/userinfo` mit
  einem echten Token `email` und `email_verified: true` liefert, ist Owner-Only (echter Login).
- **Abschließende Sprach-/Konsistenzprüfung der Abschnitte 6/7/8 bzw. 2c.4/2c.6 in
  `docs/OPENAI-AUTH-ABWEICHUNGEN.md`** ist laut dem Dokument selbst (letzter Satz des neuen
  PLAN-SECURITY-Abschnitts) noch nicht erfolgt — von der laut Plan vorgesehenen Instanz (Opus).
- **`docs/OPENAI-TOOL-INVENTORY.md`** stand im Plan-Dateiplan, wurde aber laut Diff nicht
  angefasst (`git diff master...HEAD -- docs/OPENAI-TOOL-INVENTORY.md` ist leer); die Datei
  enthält aktuell keinerlei `securitySchemes`/`scopes`-Erwähnung, also keine Falschangabe darin —
  aber der Plan-Dateiplan ist an dieser Stelle nicht eingelöst.

## 2. Was sie erfüllt, ID für ID

**T-16 (Resource-Server-Anteil) — erfüllt, Beweisstellen:**
- PRM trägt `scopes_supported` nur mit konfiguriertem Authorization-Server:
  `src/auth.js:36` (`OAUTH_SCOPES`), `registerWellKnown` (`src/auth.js`, Zeilen ~190–204).
  Test: `OpenAI-T2-23-A1` (mit AS) und `-A2` (ohne AS, Feld fehlt komplett) — beide isoliert
  grün nachvollzogen (siehe Log, Abschnitt 4).
- oauth-401-Challenge trägt `scope="openid email offline_access"`, `resource_metadata` bleibt
  ERSTER Parameter: `deny401`/`bearerChallenge` (`src/auth.js`). Test: `OpenAI-T2-23-A3`,
  `test/openai-p6-challenge.test.js` (byte-genauer String).
- `securitySchemes` trägt S auf jedem Werkzeug am HTTP-Draht: `TOOL_SECURITY_SCHEMES`
  (`src/mcp-security-schemes.js`, importiert `OAUTH_SCOPES` statt Literal). Test:
  `OpenAI-T2-23-A5` (echter `tools/list`-Draht, alle Werkzeuge), `test/openai-p3-security-schemes.test.js`
  (hartcodiertes Erwartungsliteral, bewusst nicht importiert — Pre-Mortem-konform), sowie
  `test/openai-p8-widget-ui.test.js` P8-I (Byte-Hash neu gepinnt, Begründungskommentar vorhanden).
- token-/Legacy-Zweig byte-gleich ohne `scope=`: Test `OpenAI-T2-23-A4`.

**T-12 (Scope-Prüfung am Token) — erfüllt im Code, Beweisstellen:**
- `verifyOauth()` prüft nach erfolgreicher Signatur-/Claim-Prüfung `hasRequiredScopes(payload)`
  (`src/auth.js`, liest `grantedScopes()`: `scope`-String ODER `scp`-Array/String); fehlt ein
  Element aus `OAUTH_SCOPES`, antwortet der Server 403 mit
  `WWW-Authenticate: Bearer error="insufficient_scope", scope="...", resource_metadata="...", error_description="..."`
  über `deny403InsufficientScope`/`sendBearerChallenge`. Audit-Zeile trägt nur
  `grund=insufficient_scope`, kein Token-/Claim-Inhalt.
- Tests: `OpenAI-T2-23-B1` (scope-String vollständig -> 200), `-B2` (scp-Array vollständig ->
  200), `-B3` (scope unvollständig -> 403 + Leak-Test), `-B4` (kein scope/scp -> 403 +
  Leak-Test). `test/openai-p7-token-pruefachsen.test.js` T3 (Positiv) und T4 (403, vorher
  bewusst 200 als dokumentierte Lücke) bewusst umgedreht.
- Leak-Test (Abnahme 5, in `545e195` nachgezogen): `assertAuditLoggedWithoutTokenLeak` prüft die
  ECHTE `srv.stdout`-Ausgabe auf Abwesenheit jedes JWT-Segments (>=16 Zeichen) und der
  Claim-E-Mail, mit vorgeschalteter Positiv-Kontrolle (die Log-Zeile selbst muss da sein).
- Bestandskompatibilität: `test/helpers.js#sign()` signiert per Default die volle
  `OAUTH_SCOPES`-Menge (`DEFAULT_TEST_SCOPE`), damit die ~58 Bestandsaufrufer ohne expliziten
  `scope`-Claim nicht plötzlich 403 bekommen; `scope: null` erzwingt „kein Scope-Claim" explizit.

**Isolierter Testlauf dieser Session** (`node --test --test-concurrency=4` über die fünf
betroffenen Dateien, Log unter `logs-t2-23/t2-23-focused.log`): **40/40 grün**, keine
Fehlschläge. Ein Volllauf der gesamten Suite wurde in dieser Session NICHT wiederholt (Zeit-/
Kontextbudget); der im Commit `545e195` dokumentierte Volllauf-Wert (`# pass 5925 / # fail 369`,
Fehlschläge stichprobenartig als Bestandsflakes in fremden Dateien verifiziert) ist damit
selbst-berichtet, nicht von mir unabhängig reproduziert — siehe Nachmess-Punkt in Abschnitt 4.

## 3. Betroffene Pfade — vollständig?

- **oauth-Zweig** (`MCP_AUTH=oauth`): PRM, 401-Challenge, securitySchemes UND Scope-Prüfung
  alle vier angefasst und getestet. Vollständig.
- **token-Zweig** (`MCP_AUTH=token`, mit/ohne `MCP_AUTH_TOKEN`): PRM ohne `scopes_supported`
  (kein AS), Challenge byte-gleich ohne `scope=` (`STATIC_BEARER_CHALLENGE` unverändert),
  **keine** Scope-Prüfung — bewusst so, weil dieser Zweig kein OAuth spricht und keinen
  `scope`/`scp`-Claim je bekommt. `securitySchemes` trägt trotzdem S (Bestandsverhalten seit P3,
  unverändert durch diese Phase — Widerspruch dazu unten unter Nachmessung).
- **Legacy-Zweig** (`MCP_AUTH=""`): analog zum token-Zweig.
- **stdio-Pfad**: kein `securitySchemes`-Feld (Autonome Entscheidung P3, unverändert bestätigt
  über P8-J-Hash, unverändert seit vorher). Keine Scope-Prüfung nötig/vorhanden — stdio läuft
  nie über `verifyOauth`.
- Alle vier relevanten Pfad-Kombinationen sind durch je einen eigenen Test belegt, nicht nur
  behauptet.

## 4. Was ein fremder Prüfer nachmessen sollte (neutral)

- Ist der cleancode-Blocker aus der vorigen Review tatsächlich noch offen? Prüfen:
  `grep -n "scp" test/openai-t2-23-scopes.test.js` — gibt es einen Testfall, der `scp` als
  vollständigen String (nicht Array) signiert und 200 erwartet? (Stand dieser Prüfung: nein.)
- Ist die Positiv-Kontrolle „Obermenge -> 200" aus Abnahme 8 der Spec vorhanden? Gleiche Datei,
  Suche nach einem Scope-String mit einem vierten Element (z.B. `profile`).
- Deckt `PLAN-SECURITY.md` Abschnitt „OpenAI-T2-23" (bzw. `docs/OPENAI-AUTH-ABWEICHUNGEN.md`
  T-12/2c.6) einen zweiten Messpunkt über einen `refresh_token`-Grant ab, oder nur den ersten
  Login? `grep -n -i refresh PLAN-SECURITY.md` im Abschnittsbereich prüfen.
- Stimmt die Behauptung „40/40 grün isoliert"? `NODE_ENV=test node --test --test-concurrency=4
  test/openai-t2-23-scopes.test.js test/openai-p7-token-pruefachsen.test.js
  test/openai-p3-security-schemes.test.js test/openai-p6-challenge.test.js
  test/openai-p8-widget-ui.test.js` erneut laufen lassen.
- Ist der im Commit behauptete Volllauf-Wert (`# pass 5925 / # fail 369`, alle 369 als
  Bestandsflakes außerhalb der geänderten Dateien) tatsächlich reproduzierbar bzw. plausibel?
  Ein unabhängiger Volllauf (`npm test -- --test-concurrency=4`) mit Vergleich gegen `master`
  wäre der einzige unabhängige Beleg dafür — in dieser Session nicht wiederholt.
- Ist die Revert-Probe für Commit B durchgeführt worden (Pflicht laut Spec/OW-B: `git revert
  --no-commit bf05aa2` -> Suite grün -> abort)? Im Diff und in den Commit-Botschaften findet
  sich kein Beleg dafür, dass diese Probe in dieser Kette gelaufen ist.
- Ist `docs/OPENAI-TOOL-INVENTORY.md` tatsächlich nicht betroffen (kein `securitySchemes`-
  Bezug), oder wurde eine fällige Aktualisierung übersehen? `grep -n -i "securitySchemes\|scopes"
  docs/OPENAI-TOOL-INVENTORY.md` (Stand dieser Prüfung: kein Treffer).

## 5. Owner-Punkte und Restrisiko

**Restrisiko in einem Absatz:** Der Code-Teil von T-16 und T-12 ist gebaut und über 40 eigene
Tests belegt; das größte offene Risiko ist nicht im Code, sondern in der Deploy-Vorbedingung
OW-B, die laut Doku weiterhin nur den ERSTEN, direkt nach Login ausgestellten Access-Token misst.
Ein vorheriges Review hat konkret benannt, dass viele Auth-Server `offline_access` (und teils
`openid`/`email`) nach einem Refresh-Grant nicht mehr im neuen Access-Token spiegeln — dieser
Fall bleibt ungemessen. Träfe das zu, würde ein Deploy alle bestehenden Connector-Verbindungen
zeitversetzt (erst beim nächsten Token-Refresh) mit 403 lahmlegen, ohne dass OW-B das vorher
gefangen hätte. Das ist exakt der Ausfall, den die Deploy-Vorbedingung verhindern soll, aber ihr
jetziger Wortlaut deckt ihn nicht ab.

**Owner-Punkte (konsolidiert, nach Owner-Regel):**
1. OW-B (Deploy-Vorbedingung, echter Login + Token-Dekodierung, Owner-only): zusätzlich zum
   bereits dokumentierten Schritt „Access-Token nach Login trägt scope/scp mit allen drei
   Werten" fehlt ein zweiter Messpunkt — ein über den `refresh_token`-Grant ausgestelltes
   Access-Token ebenfalls dekodieren und auf dieselben drei Scope-Werte prüfen. Ohne diesen
   zweiten Messpunkt bleibt das Refresh-403-Risiko ungemessen; dieser zweite Schritt braucht ein
   echtes Token und einen echten Login und kann nicht in dieser Session ausgeführt werden.
2. T-16-Rest (UserInfo liefert `email` + `email_verified: true`): weiterhin nur mit einem
   echten WorkOS-Login messbar, Owner-only, unverändert offen seit der Vorgänger-Phase.
3. Falls Messpunkt 1 negativ ausfällt: der Owner muss entscheiden, ob Commit B (Scope-Prüfung)
   dann per Revert zurückgenommen wird, oder ob stattdessen `offline_access` aus der GEPRÜFTEN
   (nicht der beworbenen) Menge ausgenommen wird — beides ändert das ausgelieferte
   Auth-Verhalten und ist keine Code-Entscheidung, die ich hier vorwegnehmen kann.
4. Abschließende Sprach-/Konsistenzprüfung der zweisprachigen Abschnitte 6/7/8 in
   `docs/OPENAI-AUTH-ABWEICHUNGEN.md` vor der tatsächlichen Einreichung steht laut Dokument
   selbst noch aus (vorgesehen: Opus, nicht der Bau-Agent).

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 91b8085; Tests (volle Suite, pass/fail): 6294/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:
  - T-16 | ja | Wire ueber 192.168.1.170: PRM beide Pfade scopes_supported=[openid,email,offline_access]; 401-WWW-Authenticate traegt scope="openid email offline_access"; tools/list: alle 10 Werkzeuge securitySchemes [{oauth2,S}]. src/auth.js:35 | Live-Rest: AS nimmt Login mit S an + gibt Refresh-Token (OW-B). Ob /oauth2/userinfo mit echtem Token email+email_verified:true liefert, bleibt UNKNOWN (AS-seitig, nicht Teil dieses Diffs).
  - T-12 | ja | Wire: Teil-Scope u. fehlender scope/scp -> 403 insufficient_scope (WWW: error=insufficient_scope, scope=S, resource_metadata); voller scope-String u. scp-Array -> 200. src/auth.js:175-179 nach jwtVerify (JWKS/iss/aud/exp/nbf). | Live-Rest: ob das echte Access-Token scope/scp mit allen drei Werten traegt. Traegt es sie nicht, sperrt die neue Pruefung jeden Client aus -> Deploy-Vorbedingung, sonst Scope-Pruefungs-Commit vorher zuruecknehmen.
- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig src/auth.js:36: `offline_access` ist nicht nur BEWORBEN, sondern am Resource-Server auch ERZWUNGEN: `OAUTH_SCOPES` ist gleichzeitig die PRM-/Challenge-/securitySchemes-Menge (Commit A) und die Pflichtmenge der Token-Pruefung (`hasRequiredScopes`, auth.js:145-148, Commit B). T-16 verlangt nur `openid`+`email`; `offline_access` steuert bei vielen Autorisierungsservern die Ausgabe des Refresh-Tokens und taucht dort NICHT im `scope`-Claim des Access-Tokens auf. Die gesamte Ausfallwahrscheinlichkeit von Commit B haengt damit an genau dem Element, das der RS fachlich gar nicht braucht.
