# T2-07 - Transport: Rate-Limit je Mandant statt je IP (Spec fuer den Bau-Agenten)

- IDs (gepinnt): **T-28** - nur diese.
- Branch/Worktree: `phase/openai-t2-07-rate-limit-per-tenant`, Basis `e8a0120` (master).
- Risiko: transport. dokumentFuerOpenAI: nein (kein `docs/OPENAI-*` anfassen).
- Datei bleibt ungetrackt im Haupt-Arbeitsbaum. Nie adden, nie in den Worktree kopieren.

## Ausgangslage (im Worktree nachgelesen)

- Globaler Limiter vor Parsern und Auth, Schluessel `req.ip`: `src/app.js:151-156`
  (`createRateLimiter(config.safety.rateLimitPerMin)`, Ausnahmen `/voice`, `isTrustedLocalCaller`,
  POST Init-Webhook). Parser app-weit direkt danach: `src/app.js:159-162` (`BODY_LIMIT` = 100kb, `:62`).
- Zaehler: `makeFixedWindowCounter` `src/middleware.js:302-324` (Map + Sweep alle 5 min),
  `respondTooManyRequests` `:335-338`, `RATE_LIMIT_BODY` `:327` (nicht exportiert), `createRateLimiter` `:342-356`.
- Default `RATE_LIMIT_PER_MIN` 120: `src/config.js:1952`; `trust proxy 1`: `src/app.js:534`.
- `/mcp`-Kette: `src/routes/mcp.js` Herkunftswache `router.use("/mcp", ...)` (:133-143), CORS (:155-160),
  `router.post("/mcp", mcpAuth, handler)` (:162), `requestTenant(req)` im Handler (:166).
- `mcpAuth` `src/auth.js:233-262`, `verifyOauth` `:195-230`: kein Token `:197-199`, insufficient_scope
  `:216-218` (Signatur gueltig, 403), catch `:226-229` (`grund=${err.code}`), Token/Legacy `:238-261`.
- jose 6.2.3: Signatur vor Claims (`node_modules/jose/dist/webapi/jwt/verify.js:5,9`); `iss`/`aud`
  werden VOR `exp` geprueft (`dist/webapi/lib/jwt_claims_set.js:112-121` vor `:155`) - ein
  `ERR_JWT_EXPIRED` beweist also: Signatur unseres AS, richtiger Issuer, richtige Audience.
  `JWTExpired` traegt `payload` (`dist/webapi/util/errors.js:23-34`). JWKS-Cooldown 30 s (`dist/webapi/jwks/remote.js:72-73`).
- Muster "erst pruefen, dann zaehlen": `src/routes/webhooks-elevenlabs-init.js:133-141` (`initTokenSchranke`).
- Inventar-Test erkennt Auth am Funktionsnamen `mcpAuth` (`src/route-policy.js:42`,
  `test/route-auth-inventory.test.js:130`, `:309-318`) - die Middleware MUSS weiter `mcpAuth` heissen.
- `requestTenant` liest keinen Body (`src/routes/_tenant.js`). Ohne `req.auth` und nicht
  vertrauenswuerdig-lokal -> `TENANT_REJECT` (`_tenant.js:161`) -> im Token-Modus 403 (`routes/mcp.js:80-83`).
- Kein Code liest heute `openai/subject` (`grep -rn "openai/subject" src` = 0).
- stdio (`src/mcp-server.js`) hat keinen HTTP-Eingang, keinen Limiter; seine REST-Hops sind vertrauenswuerdig-lokal (ausgenommen).

## Zielbild

POST `/mcp` verlaesst den globalen IP-Limiter UND die app-weiten Parser. Auf der Route, in dieser Reihenfolge:
Herkunftswache -> CORS (beide unveraendert) -> `mcpAuth` (erst pruefen; jede Ablehnung zaehlt im
**Ablehnungs-Zaehler**, ab dem Limit 429 statt 401/403) -> **Mandant aufloesen + Mandanten-Zaehler**
(ab dem Limit 429) -> Parser (dieselben zwei wie global) -> Handler.

Schluessel (NUR aus verifizierten oder Netz-Quellen, nie aus unverifiziertem Token-/Body-Inhalt):

| Lage | Zaehler | Schluessel |
|---|---|---|
| kein Token, Muell-Token, falsche Signatur, falscher iss/aud, fehlendes exp, JWKS-Fehler, Token-/Legacy-Fehlschlag | Ablehnung | `ip:<req.ip>` |
| `ERR_JWT_EXPIRED` mit nicht-leerem `err.payload.sub` | Ablehnung | `sub:<sub>` |
| insufficient_scope (403) mit nicht-leerem `payload.sub` | Ablehnung | `sub:<sub>` |
| dieselben zwei ohne `sub` | Ablehnung | `ip:<req.ip>` (fail-closed) |
| OAuth, Mandant aufgeloest | Mandant | `tenant:<scopedTenant>` |
| OAuth, `TENANT_REJECT` (Stub-Fassade) | Mandant | `sub:<req.auth.sub>`, ohne sub `ip:<req.ip>` |
| kein `req.auth` (token/Legacy/off) | Mandant | `ip:<req.ip>` |
| `isTrustedLocalCaller(req)` | keiner | nicht gezaehlt (Paritaet zum globalen Limiter) |

Limit beider Zaehler: `config.safety.rateLimitPerMin`, Fenster `RATE_WINDOW_MS`, Sweep
`RATE_SWEEP_INTERVAL_MS`. Gueltiges Token wird vom Ablehnungs-Zaehler nie gezaehlt und nie gedrosselt.

## Schritte

### 1. Neues Modul `src/mcp-rate-limit.js`
- Was: `makeMcpDrosseln({ limitPerMin })` baut zwei `makeFixedWindowCounter`-Instanzen und liefert
  `{ ablehnung(req, { verifizierteSub }), mandant(req, { scopedTenant }) }` -> `{allowed, retryAfterS}`.
  Reine, exportierte Schluessel-Funktionen `ablehnungsSchluessel(req, verifizierteSub)` und
  `mandantSchluessel(req, scopedTenant)` nach der Tabelle; `isTrustedLocalCaller` -> `{allowed:true}` ohne Zaehlung.
  Kommentar: warum nicht die anonymisierte Nutzer-ID aus dem Client-`_meta` (unverifizierter Body-Wert,
  nur ein Host; der Mandant aus dem verifizierten Token ist staerker und deckt jeden Host) - OHNE das
  Literal `openai/subject` (sonst ist der grep nicht 0). Kommentar: Schluessel nur aus verifizierten
  Quellen -> Map-Wachstum begrenzt durch IPs (wie heute), Mandanten und AS-ausgestellte subs; Sweep wie heute.
- Wo: neue Datei; Wiederverwendung `src/middleware.js:302` (`makeFixedWindowCounter`), `RATE_WINDOW_MS`/`RATE_SWEEP_INTERVAL_MS` `:294-295`.
- Pfade: HTTP /mcp (OAuth + Token/Legacy/off). stdio: nicht betroffen.
- Beweis: (b) Unit-Tests in `test/mcp-rate-limit.test.js`: jede Tabellenzeile -> erwarteter Schluessel;
  vertrauenswuerdig-lokal -> nie gezaehlt (`limitPerMin: 0` und trotzdem allowed).

### 2. `src/auth.js`: Fabrik `makeMcpAuth({ ablehnungsDrossel })`, erst pruefen, dann zaehlen
- Was: `mcpAuth` wird aus einer Fabrik gebaut, die `async function mcpAuth(req, res, next)` zurueckgibt
  (Name `mcpAuth` ist Pflicht, Inventar-Test). Fehlt `ablehnungsDrossel` -> Fabrik wirft (fail-closed,
  kein ungedrosselter Default). Das modulweite `export async function mcpAuth` entfaellt.
  JEDER Ablehnungszweig (`:197-199`, `:216-218`, `:226-229`, `:240-241`, `:247-248`, `:251-254`):
  Audit wie heute (Wortlaut unveraendert), dann `ablehnungsDrossel(req, { verifizierteSub })`;
  erlaubt -> exakt die heutige Antwort (401/403 + `WWW-Authenticate`); nicht erlaubt ->
  `respondTooManyRequests` (429 + `Retry-After`). `verifizierteSub` NUR bei `err.code === "ERR_JWT_EXPIRED"`
  (`err.payload?.sub`, nur nicht-leerer String) und bei insufficient_scope (`payload.sub`), sonst `null`.
  Die Ablehnung ueber EINE interne Hilfsfunktion fuehren, nicht sechsmal kopieren.
  `RATE_LIMIT_BODY` in `src/middleware.js` exportieren (keine zweite Konstante); Achtung
  `eslint-suppressions.json`/Commit-Gate fuer `middleware.js` (Kommentar `:329-334`): Befundmenge darf sich nicht bewegen.
- Wo: `src/auth.js:195-262`; `src/middleware.js:327`.
- Pfade: HTTP /mcp OAuth UND Token/Legacy. Modus `off`: keine Ablehnung, nichts zu zaehlen.
- Beweis: (a) Code: Zaehleraufruf steht nur in Ablehnungszweigen nach der Pruefung
  (`grep -n "ablehnungsDrossel" src/auth.js`); (b) Draht-Tests aus Schritt 6.
- Bestandstests anpassen: `test/openai-p6-challenge.test.js:18` und `test/auth-mcp-bypass.test.js:9`
  importieren `mcpAuth` -> `makeMcpAuth({ ablehnungsDrossel: () => ({ allowed: true, retryAfterS: 0 }) })`,
  Asserts unveraendert.

### 3. `src/routes/mcp.js`: Drosseln verdrahten, Mandant EINMAL aufloesen, Parser hinter Auth
- Was: `makeMcpRoutes` erhaelt ueber deps die Drosseln (`mcpDrosseln`) und die Parser-Kette
  (`bodyParsers`, dieselben Instanzen wie global, Schritt 4). Route:
  `router.post("/mcp", mcpAuth, mandantDrossel, ...bodyParsers, handler)`.
  `mandantDrossel` (benannte Funktion): `const scopedTenant = requestTenant(req)`; in `res.locals` ablegen;
  `mcpDrosseln.mandant(req, { scopedTenant })`; nicht erlaubt -> 429 + `Retry-After`; sonst `next()`.
  Der Handler liest `res.locals` statt `requestTenant` erneut aufzurufen (INV-7: genau EINE Aufloesung).
  `auditNoTenant`/`rejectIfNoTenant` bleiben im Handler, unveraendert.
- Wo: `src/routes/mcp.js:162-166`, deps-Kommentar `:36-38`; Mount `src/app.js:487`.
- Pfade: HTTP /mcp, alle Modi.
- Beweis: (b) Schritt 6 (Mandant A/B, Token-Modus); `test/route-auth-inventory.test.js` gruen (Name `mcpAuth` sichtbar, Fingerprint unveraendert).

### 4. `src/app.js`: POST /mcp aus globalem Limiter und globalen Parsern nehmen
- Was: EIN Praedikat `istMcpPost(req)` (`req.method === "POST" && req.path === "/mcp"`), verwendet an
  beiden Stellen: im Limiter-Schalter (`:153-157`, POST /mcp -> `next()` ohne IP-Zaehlung) und als
  Ueberspringen der beiden globalen Parser (`:159-162`). Parser einmal bauen (mit `withParserErrors`),
  global (mit Ausnahme) und fuer `makeMcpRoutes` verwenden. GET/DELETE/OPTIONS auf /mcp bleiben im
  globalen IP-Limiter. Pfad-Varianten (`/MCP`, `/mcp/`), die Express trotzdem auf die Route
  matcht, laufen weiter durch globalen Limiter + Parser (strenger, nicht lockerer; body-parser 1.20.8
  parst nicht doppelt, `node_modules/body-parser/lib/types/json.js:106`). Kommentar oben (`:141-150`) nachziehen.
  Drosseln in `app.js` bauen: `makeMcpDrosseln({ limitPerMin: config.safety.rateLimitPerMin })`.
- Wo: `src/app.js:139-163`, `:487`.
- Pfade: HTTP /mcp. Andere Routen unveraendert.
- Beweis: (b) Schritt 6: 150-KB-Body mit ungueltigem Token -> 401 (nicht 413), mit gueltigem Token -> 413;
  kaputtes JSON ohne Token -> 401 (nicht 400); `/healthz` derselben IP nach 3 /mcp-POSTs -> 200, danach je IP gedrosselt.

### 5. Env/Doku (KEINE neue Env-Variable)
- Was: Semantik von `RATE_LIMIT_PER_MIN` ist erweitert (je IP fuer alle Routen ausser POST /mcp;
  auf POST /mcp je Mandant bzw. je IP fuer Ablehnungen). Kommentare nachziehen: `src/config.js:1948-1951`,
  `.env.example:866-867`, `render.yaml:650` (Kommentarzeile ergaenzen). `test/helpers.js` BASE_ENV
  hat den Key schon (`:216`, 1000) - keine Aenderung. `PLAN-SECURITY.md`: neuer Eintrag analog
  IEX-A7-Zeile (`:4183`): Schluessel-Tabelle, erst pruefen dann zaehlen, `ERR_JWT_EXPIRED`/insufficient_scope
  je verifizierter sub, Parser hinter Auth, benannter Rest (Pre-Mortem 2, 6, 7).
- Pfade: Doku.
- Beweis: (a) `grep -n "RATE_LIMIT_PER_MIN" .env.example render.yaml src/config.js` zeigt die neue Semantik;
  `grep -rn "openai/subject" src` -> 0 Zeilen.

### 6. Neuer Drahttest `test/mcp-rate-limit.test.js` (echter HTTP-/mcp-Pfad, gespawnter Server)
Setup: `RATE_LIMIT_PER_MIN=3`, `startIdp()`, `MCP_AUTH=oauth`, `OAUTH_ISSUER_URL`, `MULTI_TENANT=true`,
zwei Mandanten mit `idpSubject` (Muster `test/e4-mandantentrennung-default.test.js:48-70`), Requests an
`srv.localUrl/mcp` mit `X-Forwarded-For: 203.0.113.7` (nicht vertrauenswuerdig-lokal) via `mcpPost`.
Jeder Fall mit frischer XFF-IP bzw. frischem Server, damit Fenster sich nicht beeinflussen.
- (a) Mandant A 3x 200, 4. -> 429 mit `Retry-After`; Mandant B dieselbe IP -> 200.
- (b) 3 falsch signierte Tokens (`sign({}, { key: idp.wrongKey })`) -> je 401 mit `WWW-Authenticate`;
  4. -> 429; danach gueltiges Token derselben IP -> 200.
- (c) 4 abgelaufene, gueltig signierte Tokens mit 4 VERSCHIEDENEN subs, dieselbe IP -> jedes 401 mit
  `WWW-Authenticate` `resource_metadata=`, kein 429 (Egress-Schutz). Abgelaufen: `exp` in der
  Vergangenheit jenseits `clockTolerance` 30 s (z.B. `sign({sub}, { exp: nowSeconds() - 120 })`).
- (d) 4 abgelaufene Tokens DERSELBEN sub -> 3x 401, 4. -> 429 (Budget begrenzt, lead-(c)).
- (e) 4 Muell-Tokens mit 4 verschiedenen unverifizierten `sub`-Claims -> 3x 401, 4. -> 429
  (Schluessel ist die IP, nie eine unverifizierte sub -> kein Map-Wachstum durch Angreifer-Inhalt).
- (f) Kein Token 3x 401, 4. -> 429.
- (g) Parser hinter Auth: 150-KB-JSON mit Muell-Token -> 401; mit gueltigem Token -> 413; `"{kaputt"` ohne Token -> 401.
- (h) Nicht-/mcp-Route: nach 3 /mcp-POSTs von IP X -> `/healthz` von X 200 (nicht mitgezaehlt); 4x `/healthz` von Y -> 4. 429.
- (i) Token-Modus (`MCP_AUTH=token`, Test-Token): gleiche XFF 3 Anfragen mit gueltigem Token -> nicht 429
  (Status wie heute, 403 kein Mandant), 4. -> 429; falsches Token 3x 401, 4. -> 429.
- (j) Interface-IP-Gegenprobe (skip ohne `externalIp()`): Fall (a) ueber `srv.externalUrl` ohne XFF.
- (k) OAuth-Token ohne Mandant (Stub-Fassade) zaehlt je sub: zwei unbekannte subs, dieselbe IP, je 3x -> kein 429.
Beweis: (b) gruen; zusaetzlich gegen master laufen lassen und rot sehen (Positiv-Kontrolle).

### 7. Gesamtlauf
`npm test -- -- --test-concurrency=4 > <log> 2>&1`, nur `# pass`/`# fail` zaehlen; rote Tests isoliert
wiederholen (`NODE_ENV=test node --test --test-name-pattern="<name>" test/<datei>.test.js`). Server danach mit `ps` pruefen.
Erwartet bricht ohne Anpassung: `openai-p6-challenge`, `auth-mcp-bypass` (Import). Alles andere muss unveraendert gruen sein.

## Nicht bauen (mit Grund)
- Schluessel aus der Client-Nutzer-ID im `_meta`: unverifiziert, nur ein Host, fehlt bei Claude.
- Eigene Env-Variable fuer das Ablehnungs-Limit: Abnahme nutzt `RATE_LIMIT_PER_MIN`; ein zweiter Regler ohne Messung waere Raten.
- Log-Zeile je 429: Render-HTTP-Log zeigt den Status, `auth_failed` wird je Ablehnung schon auditiert; je-Anfrage-Log waere Log-Flut.
- Harte Obergrenze der Schluesselzahl in `makeFixedWindowCounter`: Schluessel nur aus IP/Mandant/AS-sub, Sweep wie heute; der Zaehler ist mit globalem Limiter und Init-Schranke geteilt.
- stdio: kein HTTP-Eingang, heute ohne Limiter.
- T-27 (Hop-Fristen, Stundenlimit): Phase T2-08; Safety-Gates (Stundenlimit, Kostendecke, Denylist, Land-Gate, Kill-Switch) unberuehrt.
- Verteilter Zaehler (Redis o.ae.): heute ebenfalls je Instanz; Mehr-Instanz-Betrieb eigene Entscheidung.
- `docs/OPENAI-*`: dokumentFuerOpenAI nein.
- `WWW-Authenticate` auf der 429: kein Beleg, dass Clients ihn dort auswerten.

## Pre-Mortem (ein Jahr spaeter war es ein Fehler)
1. ChatGPT-Nutzer haengen: abgelaufene Tokens hinter geteilten Egress-IPs zaehlten je IP -> 429 statt 401 -> kein Refresh. Entschaerft: gueltig nie gezaehlt; abgelaufen zaehlt nur je verifizierter sub (Test c/d).
2. Unauthentifizierte Flut: vorher 429 vor dem Parse je IP. Jetzt: kein Parse vor Auth (Schritt 4), jede Ablehnung zaehlt je IP, ab Limit 429. Rest: je Anfrage JWT-Decode, hoechstens eine Signaturpruefung, JWKS-Nachladen bei unbekanntem kid hoechstens alle 30 s; Flut von vielen IPs ist Sache der Hosting-Kante. Im PLAN-SECURITY-Eintrag.
3. Speicher waechst: Angreifer schickt Tokens mit zufaelliger sub. Entschaerft: Schluessel nie aus unverifiziertem Inhalt (Test e).
4. Ein Mandant sperrt sich selbst: > Limit /mcp-Anfragen je Minute (z.B. viele parallele Anruf-Polls, ca. 10,9/min je Anruf). Nur dieser Mandant betroffen; Default 120 weit darueber; Owner-Probe OW-C.
5. Neue ChatGPT-Verbindungen ohne Token hinter einer Egress-IP bekommen 429 statt 401-Challenge, wenn ein Angreifer den IP-Eimer derselben IP leert (hoechstens ein Fenster = 60 s). Bewusst akzeptiert, im PLAN-SECURITY-Eintrag.
6. Parser-Umzug bricht etwas, das vor der Route `req.body` auf /mcp las: Bestandssuite (alle /mcp-Drahttests) ist der Fang; Pfad-Varianten fallen strenger aus, nicht lockerer.
7. Auth-Loch durch Refactor: Fabrik ohne Drossel oder anonyme Middleware -> Inventar sieht /mcp ungeschuetzt. Entschaerft: Fabrik wirft ohne Drossel; Funktionsname `mcpAuth`; Inventar-Test.
8. Brute-Force des spaeteren Bestaetigungscodes (T2-13) haengt am Mandanten-Limit: Wert = `RATE_LIMIT_PER_MIN` je Mandant und Minute - dort als Rechengrundlage nennen.
9. Kein ungewollter Anruf/Kosten: Limiter aendert keine Outbound-Gates; `git diff --stat master` darf `src/telephony/**`, `src/consult/**`, Budget-/Kostenmodule nicht enthalten.
10. `isTrustedLocalCaller` haengt an fehlendem `X-Forwarded-For`; wuerde der Hosting-Proxy den Header nicht mehr setzen, waere alles ungedrosselt - Bestandsrisiko, geteilt mit dem globalen Limiter, nicht neu.

## Owner-Punkte
- OW-C Schritt 5 (Live-Probe ChatGPT Developer Mode, nach Deploy): normale Nutzung mit laufendem
  Anruf und `await_call_event`-Schleife ueber mehrere Minuten -> erwartet: kein 429, im Render-HTTP-Log keine 429 auf POST /mcp.
- Optional, Render-Dashboard: Wert `RATE_LIMIT_PER_MIN` nachsehen (gilt jetzt auch je Mandant auf /mcp). Erwartet 120 oder bewusst gesetzt; kein Deploy-Vorbedingung (die Aenderung sperrt keinen gueltigen Aufrufer strenger als heute).
- Optional, Live-Messung: ob `req.ip` hinter dem Proxy die echte Client-IP ist (Audit-Zeile `auth_failed ip=` einer eigenen Fehl-Anfrage mit eigener IP vergleichen). UNKNOWN, keine Deploy-Vorbedingung: im schlechtesten Fall ist nur der Ablehnungs-Eimer global, gueltige Tokens bleiben ungedrosselt.

## Widersprueche Plan <-> Code/Lead
1. Plan `src/middleware.js:270-282` -> heute `:302-356` (Verschiebung durch T2-06).
2. Plan `src/config.js:1945` -> heute `:1952`.
3. Plan `src/auth.js:110` (err.code) -> heute `:227`; `src/auth.js:55` (createRemoteJWKSet) -> heute `:95` (Verschiebung durch T2-23/T2-05).
4. Plan: abgelaufenes Token "zaehlt NICHT"; Lead-(c): kein Pfad ohne Mandant mit unbegrenztem Budget. Aufgeloest: zaehlt je verifizierter sub, nie je IP. Plan-Abnahme "4 abgelaufene derselben IP -> kein 429" gilt mit verschiedenen subs (Test c); dieselbe sub -> 4. = 429 (Test d).
5. Plan akzeptiert JSON-Parse vor Auth als Rest; Lead-(b): Schutz gegen unauthentifizierte Flut darf nicht wegfallen. Aufgeloest: Parser hinter Auth fuer POST /mcp. Auslegung: eine Grenze VOR der Pruefung, die auch gueltige Tokens trifft, widerspraeche Lead-(a) und IEX-A7; die Grenze fuer Unauthentifizierte ist der Ablehnungs-Eimer je IP plus kein Parse.
6. Plan "Kein Code liest openai/subject (grep 0) - Begruendung im Kommentar": der Kommentar darf das Literal nicht enthalten.
7. Plan-Tabelle legt den Limiter-Anteil von T-27 in T2-07; gepinnt ist nur T-28. T-27 wird hier nicht beansprucht.
8. Plan behandelt insufficient_scope (403, gueltige Signatur) und OAuth ohne Mandant nicht; hier: je verifizierter sub.
9. Plan-Abnahme "Token-Modus zaehlt je IP": nicht-lokal antwortet der Token-Modus heute 403 (kein Mandant), nicht 200; Test prueft "nicht 429, dann 429".
