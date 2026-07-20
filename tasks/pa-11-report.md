# Phase PA-11 — `stripTrailingSlash`-Helfer in `src/config.js` (G5-Dedup, 7 Stellen)

- **Gate:** PASS
- **finalBranch:** `phase/polish-a-p11`
- **headCommit:** `6b5f13e38dbd305b0a22f803c8af5510d0b60e4b`
- **Charakter:** rein verhaltens-erhaltende G5-Dedup (S2), kein S1 — kein "rot-vor-Fix" noetig.

## Plan (gekuerzt)

Das Idiom `(...).replace(/\/$/, "")` kommt in `src/config.js` exakt 7x vor (grep-verifiziert auf `master`). Ziel: **ein** exportierter Helfer `stripTrailingSlash(url)`, alle 7 Call-Sites liefern byte-identische Werte wie zuvor.

**Die 7 Anker-Stellen:**

| # | Config-Zugriffspfad | Env-Var | Besonderheit |
|---|---|---|---|
| 1 | `config.telnyxApiBase` | `TELNYX_API_BASE` | Standard |
| 2 | `config.elevenLabsPlayTts.apiBase` | `ELEVENLABS_API_BASE` | `.trim()` VOR strip (Reihenfolge load-bearing) |
| 3 | `config.stripeApiBase` | `STRIPE_API_BASE` | Standard |
| 4 | `config.publicUrl` | `PUBLIC_URL` / `RENDER_EXTERNAL_URL` | Standard |
| 5 | `config.oauthIssuerUrl` | `OAUTH_ISSUER_URL` | Auth-adjazent; `isInsecureHttpIssuer()` bleibt unveraendert |
| 6 | `config.workosApiBase` | `WORKOS_API_BASE` | Standard |
| 7 | `resolveGatewayUrl()` return | `GATEWAY_URL` | in Funktion (call-time), nicht im `rawConfig`-Literal |

Stellen 1-6 werden eager beim Modul-Import im `rawConfig`-Objektliteral evaluiert -> Helfer muss vor dem Literal deklariert sein. Stelle 7 liegt in `resolveGatewayUrl()` (nach `config`) -> Modul-Scope genuegt.

`isInsecureHttpIssuer()` enthaelt keinen Strip; konsumiert nur den bereits gestrippten `oauthIssuerUrl` und bleibt zeilenidentisch — kein Auth-Footgun beruehrt.

**Helfer-Placement:** unmittelbar nach `export const VOICE_ENGINE = Object.freeze({...});` und vor `const rawConfig = {`, neben den bestehenden reinen Helfern (`numEnv`/`boolEnv`/`eurToCents`).

**Regex-Entscheidung:** `/\/$/` bleibt inline im Einzweck-Helfer (kein Magic-Wert, Extraktion in eine Konstante waere bei nur einer Verwendungsstelle Ueber-Fragmentierung/S4).

**Tests (Plan):**
- `test/config-shape.test.js` additiv um 3 Tests: (1) Unit des reinen Helfers (mit/ohne Slash, leer, doppelt, interne Slashes), (2) tabellarische Fresh-Import-Regression der 6 eager Sites gegen git-HEAD-Wert, (3) Trim-vor-Strip-Beweis fuer `ELEVENLABS_API_BASE` (Whitespace nach dem Slash).
- `test/config-gateway.test.js` unveraendert — Site 7 bereits durch Bestandstest ("Trailing-Slash gestrippt") abgedeckt.
- `test/helpers.js` keine Aenderung (keine neue Env-Var, keine `BASE_ENV`-Drift).

**Abnahmekriterium:** `grep 'replace(/\/$/' src/config.js` an den 7 Call-Sites -> 0 Rohidiome; `stripTrailingSlash(` -> 8 Zeilen (1 Definition + 7 Aufrufe); `isInsecureHttpIssuer` unveraendert; Voll-Suite gruen.

**Nicht-Ziele:** kein Namespace-Umbau, keine Env-Var-Umbenennung, keine Aenderung an `isInsecureHttpIssuer`/Konsumenten der 7 Config-Werte, keine neue Dependency, kein Deploy/Push.

## Impl-Zusammenfassung

PA-11 exakt gemaess Plan umgesetzt: neuer exportierter Helfer `stripTrailingSlash(url)` in `src/config.js`, platziert nach `VOICE_ENGINE`, vor `rawConfig`. Alle 7 Stellen (`telnyxApiBase`, `elevenLabsPlayTts.apiBase`, `stripeApiBase`, `publicUrl`, `oauthIssuerUrl`, `workosApiBase`, `resolveGatewayUrl`) auf den Helfer umgestellt. Trim-vor-Strip-Reihenfolge bei `ELEVENLABS_API_BASE` erhalten (Helfer bekommt bereits getrimmten String uebergeben). `isInsecureHttpIssuer()` unveraendert (kein Diff dort, per `git diff` bestaetigt).

`test/config-shape.test.js` additiv um 3 Tests erweitert: Helfer-Unit (mit/ohne Slash, leer, doppelt, interne Slashes), tabellarische Fresh-Import-Regression der 6 eager Sites (Env mit Trailing-Slash gesetzt, gegen git-HEAD-Wert geprueft), Trim-vor-Strip-Beweis fuer `ELEVENLABS_API_BASE`. `test/config-gateway.test.js` unveraendert gelassen (Site 7 bereits durch Bestandstest abgedeckt).

**Ergebnis:** volle Suite 2402/2402 gruen (vorherige Baseline + 3 neue Tests). Smoke-Test erfolgreich: Server mit Dummy-Env + `PUBLIC_URL` mit Trailing-Slash gestartet, `/healthz` = 200, Boot-Log zeigt korrekt `https://smoke.example.test/mcp` (kein doppelter Slash) — Ende-zu-Ende bestaetigt, dass der Helfer im echten Boot-Pfad greift. `node_modules`-Symlink vor Commit entfernt, nur `src/config.js` + `test/config-shape.test.js` committed (keine Report-Dateien, kein `git add -A`).

**testsAddedOrChanged:**
- `test/config-shape.test.js`: PA-11: stripTrailingSlash entfernt genau EINEN abschliessenden Slash
- `test/config-shape.test.js`: PA-11: die 6 eager URL-Configs strippen den Trailing-Slash exakt (git-HEAD-Wert)
- `test/config-shape.test.js`: PA-11: ELEVENLABS_API_BASE trimmt VOR dem Strip (Whitespace nach dem Slash)

**filesEdited:**
- `src/config.js`
- `test/config-shape.test.js`

**cleanCodeSelfCheck:** G5 (Kern-Ziel) erledigt: 7 identische Idiome auf 1 Helfer reduziert. N7: `stripTrailingSlash` ist eine reine Funktion ohne Nebeneffekt, Name = Wirkung. F1: 1 Argument. G25/G35: kein Magic-Wert; Regex inline im selbsterklaerenden Einzweck-Helfer. G10: Helfer bei den anderen reinen Config-Helfern platziert, vor `rawConfig` deklariert (6 der 7 Stellen sind eager). C2: ein praeziser Helfer-Kommentar ohne Datei:Zeile-Referenz. G12/C5/G9: kein toter/auskommentierter Code, kein neuer/ungenutzter Import. P11: reiner Refactor, Bestandssuite blieb ohne Aenderung gruen, 3 additive Behavior-Lock-Tests. Kommentare deutsch ohne Umlaute. Verschachtelungstiefe/Funktionslaenge/Argumentzahl weit unter Richtwerten (1-Zeilen-Funktion). `isInsecureHttpIssuer()` nachweislich unveraendert.

### Deviations

1. Plan Abschnitt 7 erwartete `grep -c replace(/\/$/ src/config.js -> 0` nach dem Refactor; tatsaechlich liefert dieser Grep 2 (nicht 0), weil der Plan selbst (Abschnitt 2, Edit A) vorschreibt, dass der Helfer-Kommentar den alten Idiom-Text `.replace(/\/$/,"")` woertlich zitiert UND die Helfer-Implementierung selbst zwangslaeufig `url.replace(/\/$/, "")` enthaelt (das IST die Funktion). Beide verbleibenden Treffer sind exakt die vom Plan in Abschnitt 2/3 spezifizierten Code-/Kommentar-Zeilen — wortgetreu implementiert. Der eigentliche Dedup-Beweis (0 rohe Idiome an den 7 Call-Sites, 8 `stripTrailingSlash(`-Zeilen = 1 Definition + 7 Aufrufe) ist erreicht und per grep bestaetigt; nur die woertliche Zahl aus Abschnitt 7 war in sich inkonsistent mit Abschnitt 2/3 des Plans selbst.
2. Voll-Suite-Testzahl im Plan als "Baseline 2362 + neue Tests" angegeben; tatsaechliche Baseline in diesem Worktree (nach PA-1..PA-10) war hoeher, finale Zahl 2402/2402 gruen — reine Zahlenabweichung durch zwischenzeitliche Phasen, keine funktionale Abweichung.

### Smoke-Test

Server lokal auf Port 3999 mit Dummy-Env (`ANTHROPIC_API_KEY`, `TWILIO_*`, `TELNYX_API_BASE`/`STRIPE_API_BASE`/`PUBLIC_URL`/`WORKOS_API_BASE` mit Trailing-Slash, `ELEVENLABS_API_BASE` mit Trailing-Slash+Whitespace) gestartet, Tenant per `scripts/bootstrap-tenant.js` geseedet (isoliertes `DATA_DIR`, kein Store-Kontakt des Nutzers). `GET /healthz` -> 200. Boot-Log zeigt `MCP (HTTP): https://smoke.example.test/mcp` — `PUBLIC_URL` korrekt vom Trailing-Slash befreit (kein doppelter Slash vor `/mcp`). Prozess sauber beendet, Smoke-Daten/Logs geloescht.

## Safety-Urteil (final)

**approved:** true
**verdict:** APPROVED

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**Begruendung:** Reine verhaltens-erhaltende G5-Dedup: `stripTrailingSlash(url) = url.replace(/\/$/, "")` buendelt das 7x-Idiom in `src/config.js`. Alle 7 Call-Sites konvertiert (grep: kein Rest-Idiom ausser Helfer/Kommentar), non-global Regex entfernt exakt EINEN Slash (byte-identisch), `ELEVENLABS_API_BASE` behaelt `.trim()`-vor-strip. `isInsecureHttpIssuer()` unveraendert -> kein Auth-Footgun; `oauthIssuerUrl`-Strip byte-identisch. Keine Safety-Gates, kein `claude.js`/`bridge.js` (Disclosure) und keine Auth-Vergleiche im Diff. Scope sauber: nur `config.js` + `config-shape.test.js`, keine neue npm-Dependency. Kein Deploy/Push.

**Concerns (kein Blocker):**
1. Voll-Last-Flake: `am6-oauth-tenant.test.js` fiel im ersten Voll-Suite-Lauf mit `spawn ETIMEDOUT` (127.0.0.1) aus, bestand aber isoliert (247ms) und im zweiten Voll-Lauf (voll gruen). Dokumentierter vorbestehender Seed-vor-Boot-Spawn-Race, NICHT durch PA-11 verursacht (Diff beruehrt nur URL-Trailing-Slash-Stripping, keinen Netz-/Spawn-Pfad).
2. Site 7 (`resolveGatewayUrl`, call-time) wird nicht vom neuen tabellarischen Test abgedeckt, sondern vom bestehenden `config-gateway.test.js` ("mit GATEWAY_URL -> Trailing-Slash gestrippt"); verifiziert, greift.

**independentTestSummary:** Selbst ausgefuehrt in frischem Worktree. JSON/Default-Voll-Suite: Lauf 1 = 2402 Tests, 2401 pass, 1 fail (am6-oauth-tenant spawn ETIMEDOUT), Lauf 2 = voll gruen. Fehler besteht isoliert (5/5 pass, 247ms) -> vorbestehender Voll-Last-Flake, unabhaengig von PA-11. PG-Backend-Gruppe (pglite, store-pg*/web-auth-pg/tenant-erasure-pg/rls-with-check/config-shape): 133/133 pass. PA-11-Zieltests (config-shape + config-gateway): 18/18 pass, inkl. tabellarischer git-HEAD-Regression fuer alle 6 eager URL-Configs, ELEVENLABS trim-vor-strip mit Whitespace-nach-Slash, und resolveGatewayUrl-Trailing-Slash.

## Clean-Code-Audit (final)

**verdict:** PASS (blocker: false)

**S1:** keine

**S2:** keine

**S3 (Notiz, kein Flag):**
- Ausdrucksstaerke · `src/config.js:118-122` · 5-zeiliger Doc-Kommentar fuer eine 1-zeilige Funktion ist ueppig, entspricht aber der im File etablierten Kommentardichte (vgl. `VOICE_ENGINE` direkt darueber) — keine Abweichung von G24.

**S4 (Notiz, kein Flag):**
- Anzahl · `src/config.js` · `stripTrailingSlash()` vergroessert die Public-API von `config.js` um einen weiteren exportierten Helfer — konsistent mit bereits exportierten `eurToCents`/`gatewayUrlForPort`/`boolEnv`/`numEnv` aus derselben Datei, kein Einzelfall/keine Abweichung.

**Begruendung:** G5-Dedup sauber und vollstaendig: alle 7 auf `master` identifizierten `.replace(/\/$/, "")`-Stellen in `src/config.js` (`telnyxApiBase`, `elevenLabsPlayTts.apiBase`, `stripeApiBase`, `publicUrl`, `oauthIssuerUrl`, `workosApiBase`, `resolveGatewayUrl`) sind auf den neuen `stripTrailingSlash()`-Helfer umgestellt, per Grep bestaetigt kein siebter/achter Rest-Vorkommen mehr im `src`-Baum. Verhaltens-Erhalt explizit verifiziert: die Trim-vor-Strip-Reihenfolge bei `ELEVENLABS_API_BASE` (einzige Stelle mit zusaetzlichem `.trim()`) ist unveraendert und durch einen dedizierten Regressionstest mit Whitespace-nach-Slash-Fall abgesichert. Neues Verhalten (der Helfer + alle 7 Call-Sites) ist getestet: 1 reiner Unit-Test des Helfers inkl. Grenzfaelle (leer, ohne Slash, doppelter Slash/nicht-global, interne Slashes), 1 tabellengetriebener Fresh-Import-Regressionstest ueber alle 6 eager ausgewerteten Sites gegen den bekannten git-HEAD-Wert, Site 7 (`resolveGatewayUrl`, call-time) bereits durch bestehenden `config-gateway.test.js` abgedeckt (verifiziert). Kommentare korrekt, ohne Umlaute (Grep bestaetigt), keine Magic Numbers, keine toten/auskommentierten Codeteile, keine abgeschalteten Sicherungen. `node --check src/config.js` OK, `npm test` 2402/2402 gruen, keine Flakes.

**passNotes:** Vollstaendigkeit der Extraktion per Grep ueber den gesamten Baum belegt (nicht nur behauptet): genau 7 Treffer auf `master`, genau 7 auf `stripTrailingSlash` umgestellt, 0 Reste (ausser im `scripts/set-webhooks.js`-Skript, das ausserhalb des PA-11-Scopes liegt). Platzierung des Helfers direkt vor erster Nutzung (G10). Reine Funktion ohne Nebeneffekt (P6). Tests folgen dem im Repo etablierten Fresh-Import/Query-String-Cache-Buster-Muster (`config-boolenv.test.js`) statt eigener Erfindung (N3/Konsistenz). Commit-Message beschreibt den Diff akkurat, keine Uebertreibung.

**topTodos:**
- Kein Blocker, keine Pflicht-Todos.
- Optional/kosmetisch: Doc-Kommentar an `stripTrailingSlash()` koennte gekuerzt werden, ist aber im Rahmen der Repo-Konvention vertretbar — kein Handlungsbedarf.

## Fix-Runden

Keine — Safety und Clean-Code beide im ersten Durchlauf PASS/APPROVED, keine Blocker, keine Fix-Runde noetig.
