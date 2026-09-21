# P6 — Auth I: `WWW-Authenticate` auf allen 401-Pfaden von `/mcp` (Spec)

IDs: **T-13**, **T-5**. Basis: master `4e81f42`. Vorgeschlagener Branch: `phase/openai-p6-auth-challenge`.
Quellen: `tasks/PLAN-OPENAI-TECHNIK.md` §P6 (:677-763), `tasks/openai-p0-entscheidungen.md` (D0-3, D0-6, U-1, O-2, O-7),
`tasks/openai-audit/00-openai-anforderungen.md` Zeilen 38 (T-5) und 46 (T-13). Am Code nachgesehen, nicht abgeschrieben.

Testkommando (einzig gueltig): `npm test -- -- --test-concurrency=4`. Nur `# pass` / `# fail` zaehlen.
Grundlinie master: 6206 / 6206. Ein roter Fall zaehlt erst, wenn er ISOLIERT erneut rot ist
(`NODE_ENV=test node --test --test-concurrency=4 test/<datei>`). Ausgabe nie abschneiden.

---

## 0. Ist-Zustand (gemessen am Code, 2026-09-21)

`src/auth.js`:

| Zeile | Was | Challenge? |
|---|---|---|
| :24 | `metadataUrl()` = `${publicUrl}/.well-known/oauth-protected-resource` | – |
| :66-72 | `deny401(res, error, description)` setzt `WWW-Authenticate: Bearer resource_metadata="…", error="…", error_description="…"`, dann `res.status(401)` (:71) | ja |
| :78 | `verifyOauth`, kein Token -> `deny401(res,"invalid_token","Kein Token")` | ja |
| :90 | `verifyOauth`, Token ungueltig -> `deny401(…,"Token-Pruefung fehlgeschlagen")` | ja |
| :103 | Modus `token` **oder** Legacy `""` mit gesetztem `MCP_AUTH_TOKEN`, Bearer falsch/fehlt -> `res.status(401).json({error:"unauthorized"})` | **nein** |
| :110 | Modus `token` ohne `MCP_AUTH_TOKEN` -> `res.status(401).json({error:"unauthorized"})` | **nein** |
| :112 | `if (legacyLocalBypassAllowed(req)) return next();` (Loopback ausserhalb Produktion) | – |
| :113-116 | Legacy ohne Token, nicht-Loopback oder Produktion -> `res.status(401).json({error:"MCP_AUTH_TOKEN nicht gesetzt - …"})` | **nein** |

`grep -n "status(401)" src/auth.js` -> **4** Treffer (:71, :103, :110, :114). Die drei rohen
(:103/:110/:114) sind der Kern dieser Phase.

Pfade: `mcpAuth` sitzt genau einmal vor `POST /mcp` (`src/routes/mcp.js:112`), VOR jeder
Adapter-Wahl (mcp-nativ vs. ChatGPT) — beide Adapter teilen also denselben 401-Pfad. stdio
(`src/mcp-server.js`) hat keine Auth-Schicht und kein HTTP; dort gibt es keinen 401
(Kommentar `src/mcp-server.js:40-43`). Die Origin-Wache (`src/routes/mcp.js:102-110`) laeuft
vor `mcpAuth` und antwortet 403, nicht 401 — unberuehrt.

---

## 1. Designentscheidung dieser Phase: welche Challenge je Zweig

Lead-Entscheidung 3 bindet: eine Challenge muss fuer ihren Zweig STIMMEN.

- **oauth-Zweig (:78, :90): byte-identisch unveraendert.** Das ist der Live-Zweig (D0-3,
  Live-Messung 2026-09-20T15:31:09Z). Erwarteter Header ohne Token, woertlich:
  `Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"`.
- **token- und Legacy-Zweig (:103, :110, :114): `WWW-Authenticate: Bearer error="invalid_token"`
  — OHNE `resource_metadata`.** Begruendung: diese Zweige sprechen kein OAuth. Ein Verweis auf
  die Protected-Resource-Metadata schickte den Client in eine OAuth-Discovery, deren Token
  dieser Zweig nie annimmt (und bei leerem `OAUTH_ISSUER_URL` liefert das Dokument
  `authorization_servers: []`, `src/auth.js:124`). RFC 6750 §3 erlaubt die Bearer-Challenge
  ohne diesen Parameter. `metadataUrl()` wird in diesen Zweigen **nicht** aufgerufen — damit
  entfaellt auch das Plan-Pre-Mortem "leere `resource_metadata`-URL im Legacy-Modus".
  `error="invalid_token"` folgt der Plan-Vorgabe ("invalid_token bei falschem/fehlendem Token")
  und dem Bestand im oauth-Zweig.
- **Response-Bodies bleiben woertlich wie heute** (`{"error":"unauthorized"}` bzw. der
  Legacy-Satz). Statuscode bleibt 401. Nur der Header kommt hinzu.
- **Kein Bedingungs-, Reihenfolge- oder `next()`-Wechsel.** Die Aenderung betrifft
  ausschliesslich, WIE ein ohnehin fallender 401 gebaut wird, nie OB er faellt.

Ehrliche Einordnung T-13/T-5: der OpenAI-Wortlaut (T-13) verlangt einen Header, der "auf die
Protected-Resource-Metadata zeigt". Das ist wahrheitsgemaess nur im oauth-Zweig moeglich — und
genau der laeuft in Produktion. Nach P6 gilt: **jeder** 401 von `/mcp` traegt eine
RFC-6750-Challenge; T-13 im OpenAI-Sinn ist im oauth-Modus erfuellt; token/Legacy sind per
Definition kein OAuth 2.1 (T-5) und bleiben als nicht-einreichungsfaehige Modi bestehen
(Lead-Entscheidung 1).

---

## 2. Arbeitsschritte

### Schritt 1 — Ein einziger 401-Sender in `src/auth.js`

**Was:**
- Neue interne Funktion (Name frei, z.B. `sendBearer401(res, challenge, body)`, 3 Argumente):
  setzt `res.set("WWW-Authenticate", challenge)` und `return res.status(401).json(body)`.
  Einzige Stelle im Modul mit `status(401)` und mit `WWW-Authenticate`.
- `deny401(res, error, description)` (:66-72) baut unveraendert denselben String
  (`Bearer resource_metadata="${metadataUrl()}", error="${error}", error_description="${description}"`)
  und delegiert an den neuen Sender mit Body `{ error: description }`. Aufrufer :78/:90 unveraendert.
- Neue benannte Konstante fuer den statischen Zweig, z.B.
  `const STATIC_BEARER_CHALLENGE = 'Bearer error="invalid_token"';` mit deutschem Kommentar
  (ohne Umlaute), WARUM kein `resource_metadata` (dieser Zweig spricht kein OAuth).
- :103, :110, :114-116: `return res.status(401).json(X)` -> `return sendBearer401(res, STATIC_BEARER_CHALLENGE, X)`
  mit **woertlich identischem** `X`. Das `return` bleibt an allen drei Stellen.
- Die Kopfkommentare :64-65 und :105-107 so nachziehen, dass sie stimmen (keine Aussage mehr,
  der Header komme nur im oauth-Zweig).

**Datei:** `src/auth.js:64-72`, `:103`, `:110`, `:113-116`.
**IDs:** T-13 (Kern), T-5 (Haertung des Legacy-/token-Zweigs).
**Pfade:** HTTP `/mcp`, fuer beide Adapter (mcp-nativ und ChatGPT), weil `mcpAuth` vor der
Adapter-Wahl sitzt. stdio: nicht betroffen (keine Auth, kein HTTP).

**Beweis (fremder Pruefer):**
- (c) `grep -c "status(401)" src/auth.js` -> `1`; `grep -c 'res.set(' src/auth.js` -> `1`; beide
  Treffer liegen im Rumpf des neuen Senders (Pruefer liest die Zeilen).
- (c) `grep -n "resource_metadata" src/auth.js` -> Treffer nur in `deny401`/Kommentaren, **nicht**
  in der Konstante des statischen Zweigs.
- (c) **Fail-closed-Waechter am Diff** (muss LEER sein):
  `git diff master...phase/openai-p6-auth-challenge -U0 -- src/auth.js | grep -E '^[-+][^-+].*(next\(|if \(|safeEqual|legacyLocalBypassAllowed|mcpAuth ===|isLocalSocket|jwtVerify)'`
  -> keine Ausgabe. Belegt: keine Bedingung, kein `next()`, kein Vergleich wurde beruehrt.
- (c) `node --check src/auth.js` -> keine Ausgabe, Exit 0.

### Schritt 2 — Neue Draht-Tests `test/openai-p6-challenge.test.js`

Testnamen beginnen mit `P6-` (NICHT mit `MCP-`, `GAP-` o.ae. — die Katalog-Praefixe aus
`package.json` `config.i18nCatalogPattern` wuerden den Test still in `test:gates` verschieben).

Jeder 401-Fall prueft am **echten HTTP-Response** (kein `fakeRes`):
Status 401, Header `www-authenticate` **exakt** gleich dem erwarteten String, und — Pre-Mortem —
dass kein Tool lief: Body ist das erwartete Fehlerobjekt, hat weder `jsonrpc` noch `result`.
Body der Requests ist `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` (via `mcpPost`, `test/helpers.js:1317`).

| Fall | Aufbau | Trifft Zeile | Erwartung |
|---|---|---|---|
| P6-T1 | Spawn, `MCP_AUTH: "token"`, `MCP_AUTH_TOKEN` leer (BASE_ENV) | :110 | 401, `www-authenticate` === `Bearer error="invalid_token"`, Body `{"error":"unauthorized"}`, kein `resource_metadata` im Header |
| P6-T2a | Spawn, `MCP_AUTH: "token"`, `MCP_AUTH_TOKEN: "p6-token"`, Bearer falsch | :103 | wie T1 |
| P6-T2b | derselbe Server, ohne Authorization | :103 | wie T1 |
| P6-T2c | derselbe Server, korrektes Bearer | – | Positiv-Kontrolle: Status **!= 401** (belegt, dass der Test nicht alles ablehnt und ein gueltiger Request unveraendert durchkommt) |
| P6-T3 | Spawn, Legacy `MCP_AUTH: ""`, `MCP_AUTH_TOKEN: "p6-legacy"`, Bearer falsch | :103 (Legacy-Weg) | wie T1 |
| P6-T4 | **In-Process-Express-Mini-App mit echtem HTTP-Listener** (Port 0): `app.post("/mcp", mcpAuth, handler)`, `handler` setzt ein Flag; Config-Override ueber `makeConfigOverrides` (`test/helpers.js:1061`) mit `mcpAuth: ""`, `mcpAuthToken: ""`, `isProduction: true`; Request vom Loopback | :113-116 | 401, Header `Bearer error="invalid_token"`, Body = der Legacy-Satz woertlich, **Handler-Flag false**. Zweiter Teil: `isProduction: false` -> Handler erreicht (Bypass unveraendert, Gegenprobe) |
| P6-T5 | Spawn, `MCP_AUTH: "oauth"` + `startIdp()` (Muster `test/oauth.test.js:20-35`) | :78 | 401 und Header **byte-exakt** `Bearer resource_metadata="https://agent.test/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"`; mit gueltigem, signiertem Token -> **200** (Gegenprobe gegen Aufweichung und gegen Verschlucken des oauth-Zweigs) |

Warum T4 kein Voll-Spawn ist: Produktion erkennt der Code an `RENDER_EXTERNAL_URL`
(`src/config.js:204-206`), nicht an `NODE_ENV`. Ein Spawn mit gesetztem `RENDER_EXTERNAL_URL`
verweigert offline den Boot (`PRODUCTION_FOOTGUNS`: `STORE_BACKEND` != `pg`, `src/config.js:2438-2442`;
Muster `test/boot-prod-footguns.test.js:13`). Die Mini-App faehrt trotzdem echtes Express mit
echtem `res.set` ueber echtes HTTP — der Header ist am Draht sichtbar. Muster fuer Mini-Apps
existiert: `test/auth-p5-internal-only.test.js` (AUTH-P5-4..6). Config-Override strikt
restaurieren (`withConfigOverrides`).

**Datei:** neu `test/openai-p6-challenge.test.js`. Keine neue Env-Variable -> `BASE_ENV` unberuehrt.
**IDs:** T-13, T-5.
**Pfade:** HTTP `/mcp` (Adapter-unabhaengig, s. Schritt 1).
**Beweis:**
- (b) `NODE_ENV=test node --test --test-concurrency=4 test/openai-p6-challenge.test.js` -> `# fail 0`,
  `# pass` >= 8 (Subtests), `# skipped 0`.
- (b) **Rot-gegen-alt** (belegt, dass der Test den Punkt wirklich prueft): auf `master`
  (ohne Schritt 1) dieselbe Datei gefahren -> T1, T2a, T2b, T3, T4 **rot** (Header `null`),
  T2c und T5 gruen. Der Pruefer kopiert die Testdatei in einen master-Checkout und faehrt sie;
  erwartet genau diese Rot-Menge.
- (a) Der Pruefer liest die Datei und bestaetigt: T1-T3/T5 nutzen `startServer` (Spawn), T4
  nutzt `http`-Listener + `fetch`, **kein** `fakeRes`.

### Schritt 3 — Bestandstests: unveraendert gruen, nichts anpassen

Durchgesehen, welche Tests die Aenderung beruehren koennte:

- `test/oauth.test.js` — prueft den oauth-Zweig per Regex; bleibt **unveraendert**.
- `test/auth-mcp-bypass.test.js` (AM1, PA-17) — `fakeRes().set` ist No-Op und gibt `res` zurueck;
  der neue Sender ruft `set` VOR `status` -> Statuscodes 401 bleiben, `nexted` bleibt false. Unveraendert.
- `test/auth-p7-gate-removed.test.js:220-227` — verlangt `WWW-Authenticate` in `src/` nur in
  `auth.js`; bleibt erfuellt (der Sender liegt in `auth.js`).
- `test/security.test.js:137-183`, `test/s2-mcp-origin.test.js:430-442` (E5-H15),
  `test/e4-mandantentrennung-default.test.js:240-250`, `test/audit.test.js:88` — pruefen nur
  Status/Log bzw. oauth-Header. Unveraendert.
- `test/auth-p6-operator-routes.test.js:210-222` — betrifft `webAuthGateMiddleware` (`src/web-auth.js`), nicht `mcpAuth`.

Zusaetzlich, **nicht tragend** (nur wo eine externe Interface-IP existiert, sonst skip):
`test/security.test.js:143-146` ("extern -> 401", Legacy von nicht-Loopback) um
`assert.equal(res.headers.get("www-authenticate"), 'Bearer error="invalid_token"')` ergaenzen.
Das ist der einzige Draht-Beleg fuer :114 ueber einen echten Nicht-Loopback-Socket; weil er
maschinenabhaengig skippt, traegt T4 die Beweislast.

**Datei:** `test/security.test.js:143-146` (optional-ergaenzend); sonst keine Testdatei.
**IDs:** T-13.
**Pfade:** HTTP `/mcp`.
**Beweis:**
- (c) `git diff master...phase/openai-p6-auth-challenge -- test/oauth.test.js test/auth-mcp-bypass.test.js` -> **leer**.
- (b) `NODE_ENV=test node --test --test-concurrency=4 test/oauth.test.js test/auth-mcp-bypass.test.js test/auth-p7-gate-removed.test.js test/security.test.js test/s2-mcp-origin.test.js test/e4-mandantentrennung-default.test.js`
  -> `# fail 0`.

### Schritt 4 — `render.yaml`: die `MCP_AUTH`-Drift beseitigen (T-5-Restposten)

**Was:** `render.yaml:350-354` — `value: ""` fuer `MCP_AUTH` wird durch `sync: false` ersetzt;
der Kommentar darueber sagt: live laeuft `oauth` (D0-3, Messung 2026-09-20), der Wert wird im
Dashboard gepflegt, ein Blueprint-Sync darf ihn nicht ueberschreiben; `""`/`token` sind
nicht einreichungsfaehig (kein OAuth 2.1). `MCP_AUTH_TOKEN` (:355-358) bleibt, nur dessen
Kommentar erwaehnt, dass er bei `oauth` ungenutzt ist.

**Warum NICHT `value: oauth`:** `test/prod-env.js:37-51` parst jeden `value:`-Eintrag aus
`render.yaml` in `RENDER_ENV`/`LIVE_ENV`, und `prodEnv()` spawnt damit
(`test/prod-config-smoke.test.js`, `test/e2e-05-us-launch-full-chain.test.js`,
`test/p10-world-default-language-switch.test.js`). `REQUIRED_CONFIG` verlangt bei
`MCP_AUTH=oauth` ein `OAUTH_ISSUER_URL` in **jedem** Modus (`src/config.js:2518-2519`,
geprueft in `assertConfig` :2640), und das steht in `render.yaml` als `sync: false` ohne Wert
-> alle prodEnv-Spawns verweigerten den Boot. `sync: false` dagegen nimmt `MCP_AUTH` aus
`RENDER_ENV` heraus; `prodEnv` faellt auf `BASE_ENV.MCP_AUTH = ""` (`test/helpers.js:580`)
zurueck — exakt der heutige Wert. Null Testwirkung, Drift beseitigt.

**Datei:** `render.yaml:350-358`.
**IDs:** T-5.
**Pfade:** keiner zur Laufzeit (Render-Dienst ist dashboard-verwaltet, `render.yaml:14-17`;
ein Push macht nichts live).
**Beweis:**
- (c) `grep -n -A2 "key: MCP_AUTH$" render.yaml` -> die Zeile nach dem Key ist `sync: false`,
  kein `value:`.
- (c) `NODE_ENV=test node --input-type=module -e "const m = await import('./test/prod-env.js'); console.log('MCP_AUTH' in m.RENDER_ENV)"` -> `false`.
- (b) `NODE_ENV=test node --test --test-concurrency=4 test/prod-config-smoke.test.js test/e2e-05-us-launch-full-chain.test.js test/p10-world-default-language-switch.test.js test/env-docs-spend-cap-coherence.test.js`
  -> gleiche `# pass`/`# fail`-Zahlen wie auf master (einige davon sind Katalog-Tests und
  duerfen schon auf master rot sein — verglichen wird vorher gegen nachher, nicht gegen 0).

### Schritt 5 — `PLAN-SECURITY.md` nachziehen

**Was:**
- Neuer Abschnitt am Dateiende: `## OpenAI-P6 — Bearer-Challenge auf allen 401-Pfaden von /mcp (2026-09-21)`
  mit: vorher/nachher-Tabelle je Zweig (Status unveraendert 401, Header neu in token/Legacy),
  die Begruendung "kein `resource_metadata` ausserhalb oauth", der Fail-closed-Waechter aus
  Schritt 1, Deploy = Owner O-2.
- **Risiko-Eintrag U-1 / O-7 (offen, bewusst nicht geschlossen):** in Produktion verweigert
  kein Boot-Guard `MCP_AUTH=""`/`token` (`src/config.js:2425-2428` sperrt nur `off`). Ein
  Rueckfall des Dashboard-Werts schaltet still auf statisches Bearer (kein OAuth 2.1). Nach P6
  ist der Rueckfall wenigstens am 401 erkennbar (Challenge ohne `resource_metadata`).
  Schliessung = Owner-Entscheidung O-7; die Boot-Sperre ist bewusst NICHT gebaut (s.u.).
- Die veraltete Aussage `PLAN-SECURITY.md:2055` "(render.yaml-Blueprint traegt noch `value: ""`)"
  auf den neuen Stand (`sync: false`) korrigieren.
- `PLAN-SECURITY.md:2549` ("zwei Zeilen: Kommentar + Challenge") auf den neuen Stand
  korrigieren (Aussage "nur `src/auth.js`" bleibt wahr).

**Datei:** `PLAN-SECURITY.md` (Ende, :2055, :2549).
**IDs:** T-5, T-13.
**Pfade:** keine (Doku).
**Beweis:** (c) `grep -n "OpenAI-P6" PLAN-SECURITY.md` -> 1 Ueberschrift; `grep -n "O-7" PLAN-SECURITY.md` -> mindestens ein Treffer im neuen Abschnitt; `grep -n 'value: ""' PLAN-SECURITY.md` -> kein Treffer mehr in der MCP_AUTH-Aussage bei :2055.

### Schritt 6 — Volle Suite

**Was:** `npm test -- -- --test-concurrency=4`, Ausgabe vollstaendig in eine Datei im
Scratchpad (nicht abschneiden).
**Beweis:** (b) `# fail 0`; `# pass` = 6206 + Anzahl neuer Faelle aus Schritt 2 (und ggf. 0 aus
Schritt 3, da nur eine Assertion ergaenzt). Jeder rote Fall wird isoliert nachgefahren; nur
isoliert erneut rot zaehlt. Weniger gruen als die Grundlinie = etwas ist kaputt.
**Pfade:** alle.

---

## 3. Was NICHT gebaut wird

- **Keine Boot-Sperre** (`PRODUCTION_FOOTGUNS`-Zeile fuer `MCP_AUTH` `""`/`token`). Lead-Entscheidung 2:
  maximal live-wirksam (verweigerter Boot = auch keine Anrufe), und die Repo-Konfiguration ist
  nachweislich nicht die Produktionskonfiguration. Bleibt O-7; Risiko wird in PLAN-SECURITY gefuehrt.
- **Kein WARN-Log fuer Nicht-oauth in Produktion.** Erlaubt, aber nicht gebaut: kein Mensch liest
  Boot-Logs automatisch, der Nutzen waere gering; die Challenge-Form am 401 macht den Rueckfall
  bereits von aussen messbar (`curl -i`). Weniger Code in einer Auth-Phase.
- **Legacy-/token-Pfad nicht entfernt, nicht abgeschaltet** (Lead-Entscheidung 1, P0 D0-3).
- **Kein `resource_metadata` im token-/Legacy-Zweig** (Lead-Entscheidung 3): wuerde einen Weg weisen,
  den dieser Zweig nicht annimmt.
- **oauth-Zweig (`verifyOauth`, `deny401`-Wortlaut) nicht veraendert** — Live-Zweig, byte-identisch.
- **Keine Aenderung an `test/oauth.test.js` und `test/auth-mcp-bypass.test.js`** (Plan-AK 4; der
  `fakeRes` bleibt, er ist fuer Statuscodes korrekt, nur fuer Header blind — die Header prueft Schritt 2).
- **T-14 (`_meta["mcp/www_authenticate"]`)**: gegenstandslos, P0 D0-6 (kein Ausloesepfad); gehoert zu P7.
- **stdio**: keine Auth-Schicht, kein HTTP, kein 401 — nichts zu tun (DP-1). Wird im Report so festgehalten.
- **401 ausserhalb `/mcp`** (`src/web-auth.js:304`, `:832`, `:841`, Browser-Sitzung): nicht Teil von
  T-13 (das betrifft die geschuetzte MCP-Ressource); `test/auth-p6-operator-routes.test.js:217-221`
  pinnt dort sogar ausdruecklich `www-authenticate === null`.
- **`MCP_AUTH_TOKEN generateValue: true` in `render.yaml`** nicht angefasst: ob live ein Wert steht, ist
  UNKNOWN (O-6); eine Aenderung waere Konfigurations-Entscheidung, nicht Challenge-Arbeit.
- **Provider-Signaturpruefung `/voice`**: eigenes Gate, nicht beruehrt (Lead-Entscheidung 4).
- **Kein Deploy, kein Push, kein Merge** (O-2, Lead).

---

## 4. Pre-Mortem — ein Jahr spaeter war P6 ein Fehler

1. **`/mcp` war ohne Token offen.** Beim Umbau von `return res.status(401)…` auf den Sender fiel ein
   `return` weg, oder der Sender wurde in eine Bedingung verschoben; ein Request lief nach dem 401 in
   `next()`. *Entschaerfung:* Fail-closed-Waechter am Diff (Schritt 1, leere Ausgabe Pflicht), jeder
   Draht-Test prueft zusaetzlich "Handler nicht erreicht" (T4-Flag) bzw. "kein `jsonrpc`/`result` im
   Body" (T1-T3), und die Positiv-Kontrolle T2c zeigt, dass der Test nicht nur ablehnt.
2. **Der Claude-Connector brach nach dem Deploy.** Jemand "vereinheitlichte" `deny401` und aenderte
   die Parameter-Reihenfolge oder den `error_description`-Text des oauth-Zweigs; ein Client, der den
   Header parst, stolperte. *Entschaerfung:* oauth-Header ist in T5 **byte-exakt** gepinnt, nicht per Regex.
3. **Clients liefen im token-Modus in eine Discovery-Schleife.** Eine Challenge mit `resource_metadata`
   im token-Zweig haette auf eine Metadata mit leerem/fremdem AS verwiesen. *Entschaerfung:* Designregel
   §1, Konstante ohne `resource_metadata`, Grep-Beweis in Schritt 1. Rest-Risiko akzeptiert: ein
   MCP-Client darf bei fehlendem `resource_metadata` die Well-known-URL selbst raten
   (`/.well-known/oauth-protected-resource` ist oeffentlich, `src/auth.js:127-128`) und findet im
   token-Modus ggf. `authorization_servers: []` — er scheitert dann, wie er heute am nackten 401
   scheitert. Kein zusaetzlicher Request kommt durch.
4. **Produktion fiel still auf Legacy zurueck, und niemand merkte es (U-1).** P6 hat die Boot-Sperre
   bewusst nicht gebaut. *Entschaerfung:* PLAN-SECURITY-Risiko-Eintrag mit O-7; `render.yaml` kann
   den Wert per Blueprint-Sync nicht mehr auf `""` ziehen (`sync: false`); der Rueckfall ist am 401
   von aussen sichtbar (Challenge ohne `resource_metadata`). Akzeptiertes Restrisiko bis O-7.
5. **Die render.yaml-Korrektur legte die GAP-/E2E-Testbank lahm.** Mit `value: oauth` haetten alle
   `prodEnv()`-Spawns den Boot verweigert (REQUIRED_CONFIG). *Entschaerfung:* `sync: false` statt
   `value: oauth` (Schritt 4) und der Vorher/Nachher-Vergleich der drei prodEnv-Testdateien.
6. **Ein "gruener" Test bewies nichts.** Ein neuer Test lief ueber `fakeRes` oder landete wegen eines
   Katalog-Praefixes (`MCP-…`) im `test:gates`-Lauf und damit nie in `npm test`. *Entschaerfung:*
   Praefix `P6-`, Spawn/echtes HTTP Pflicht, und der Rot-gegen-alt-Lauf auf master (Schritt 2).
7. **Die Phase galt als "T-13 erfuellt", obwohl ein Modus den OpenAI-Wortlaut nicht erfuellt.**
   *Entschaerfung:* §1 haelt fest: T-13 im OpenAI-Sinn nur im oauth-Modus (= Produktion); token/Legacy
   tragen eine korrekte RFC-6750-Challenge, sind aber per se nicht einreichungsfaehig (T-5).

---

## 5. Widersprueche Plan / P0 / Code und ihre Aufloesung

1. **Plan-AK 1 verlangt im token-Zweig `Bearer resource_metadata=`** — widerspricht Lead-Entscheidung 3.
   Aufgeloest: token/Legacy bekommen `Bearer error="invalid_token"` ohne `resource_metadata`.
2. **P0 D0-3 sieht die Haertung als "additive Boot-Sperre ueber `PRODUCTION_FOOTGUNS`"** — die
   Lead-Entscheidung 2 verbietet sie. Aufgeloest: nicht gebaut; O-7 bleibt; Risiko-Eintrag in PLAN-SECURITY.
3. **Plan zaehlt "fuenf Stellen mit `res.status(401)`", nennt aber vier Zeilen.** Gemessen: 4 Treffer
   (:71, :103, :110, :114). Die "fuenf" sind 401-Ruecksprungwege (2 `deny401`-Aufrufe + 3 rohe), nicht
   Textstellen. DP-4 spricht an einer Stelle von "vier Ruecksprungen" — ebenfalls ungenau. Zeilennummern
   :66-72, :78, :90, :103, :110, :114-116 stimmen.
4. **Plan-AK 1 will den Legacy-Fall "mit `NODE_ENV=production`" spawnen.** Produktion haengt an
   `RENDER_EXTERNAL_URL` (`src/config.js:204-206`), nicht an `NODE_ENV`; ein Prod-Spawn verweigert
   offline den Boot (`STORE_BACKEND`-Footgun). Aufgeloest: T4 als In-Process-Express mit echtem HTTP.
5. **Plan-AK 2 ("jeder Treffer innerhalb `deny401()` oder ruft es")** — mit Designregel §1 kann der
   token-Zweig `deny401` (das `resource_metadata` setzt) nicht rufen. Aufgeloest: genau **ein**
   `status(401)` im Modul, im gemeinsamen Sender; `deny401` delegiert dorthin.
6. **Plan Schritt 3 "render.yaml korrigieren" ohne Wertangabe** — `value: oauth` bricht alle
   `prodEnv()`-Spawns (REQUIRED_CONFIG `OAUTH_ISSUER_URL`, `src/config.js:2518`, in jedem Modus).
   Aufgeloest: `sync: false`.
7. **Zeilenverweise auf `test/helpers.js` veraltet:** Plan `:569` / P0 `:571` — tatsaechlich
   `MCP_AUTH: ""` bei `:580`, `RENDER_EXTERNAL_URL: ""` bei `:583`. Folgenlos.
8. **"37 von 53" (Plan) vs. "8 von 21" (P0)** — P0 gewinnt; fuer P6 folgenlos, keine dieser Testdateien
   wird angefasst.
9. **Plan-AK 4 Ersatzweg "Assertion-Zahl in `test/oauth.test.js` als Testname gepinnt"** — existiert
   nicht (Testname `MCP_AUTH=oauth: Resource Server prueft Tokens`). Aufgeloest: nur der Diff-Vergleich
   mit expliziter Basis (Schritt 3) plus byte-exakter Header in T5.
10. **T-13-Wortlaut ("pointing to protected-resource metadata") vs. Lead-Entscheidung 3** — im
    token/Legacy-Modus nicht wahrheitsgemaess erfuellbar. Aufgeloest: T-13 gilt als erfuellt fuer den
    oauth-Modus (= Produktion, D0-3); token/Legacy sind nicht einreichungsfaehig und so dokumentiert.

## 6. UNKNOWN

- Ob der Render-Dienst ueberhaupt je per Blueprint synchronisiert wird (`render.yaml:14-17` sagt
  dashboard-verwaltet). Grund: aus dem Repo nicht lesbar. Folge: Schritt 4 ist Vorsorge, keine Live-Aenderung.
- Aktueller Live-Wert von `MCP_AUTH_TOKEN` (O-6). Grund: nur im Dashboard. Folge: Groesse des U-1-Risikos.
- Wie ChatGPT/Claude auf eine Bearer-Challenge **ohne** `resource_metadata` reagieren. Grund: kein
  Client-Mitschnitt; betrifft nur nicht-produktive Modi.
