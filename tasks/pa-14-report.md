# PA-14 — Detailbericht

**Phase:** PA-14 · Migration Cluster A2: Boot-Gates (`assertConfig` / `productionFootguns` / `isSelfServiceLive`)
**Gate:** PASS
**finalBranch:** `phase/polish-a-p14`
**Basis:** `master` @ `97c40e3` (PA-12-Shim + PA-13-A1 bereits gemergt)
**headCommit (Worktree):** `98b38c994d71e3b487481bdc22f85a246179c9e3`

---

## 1. Plan (gekuerzt)

### Kern-Designentscheidung + Korrektur der Plan-Dateiliste

Die urspruengliche Phasen-Zeile listete nur `src/config.js`. Das unterzaehlt: `productionFootguns(cfg = config, …)` und `isSelfServiceLive(cfg)` lesen den Parameter `cfg`, der intern (von `assertConfig`) mit dem namespaced `config` belegt wird, aber in **4 Testdateien** mit flachen Objektliteralen. Die Phase verlangt „Boot-Gates namespaced" woertlich — Umstellung dieser Funktions-Bodies ist **PA-20-Pflicht**: sobald PA-20 die Flach-Aliase entfernt, wuerde ein verbliebenes `cfg.mcpAuth` bei jedem Boot mit `TypeError` sterben. Reale Dateiliste also: `src/config.js` + 4 Testdateien (spaeter in der Umsetzung auf 6 Testdateien erweitert, siehe Deviations).

Die assertConfig-basierten Tests (`config-payment-guard`, `config-failclosed`, `config-boolenv`, `single-origin-boot-guard`, `telnyx-p10-config` assertConfig-Teil, `config-prod-footguns` T-P0-5-08/09), die den echten `config` per `withConfigOverrides`/`withConfig` mutieren, bleiben **unveraendert** — der Proxy hat kein Set-Trap, schreibt in `rawConfig[key]`, Namespace-Getter delegieren auf denselben Slot (PA-12-Garantie).

Zusaetzlich: `resolveGatewayUrl()`s `config.port` → `config.server.port` — einziger weiterer flacher Modul-Global-Zugriff in `config.js`, sonst schlaegt das Struktur-Grep-Gate fehl und PA-20 wuerde spaeter brechen.

Kein neuer Quellcode-File, keine neue Env-Var, keine Dependency, keine Signaturaenderung, kein Gate-Logik-Umbau (ausser praezisierter telnyx-Nullsicherheit).

### Namespace-Mapping (aus `CONFIG_NAMESPACES`)

| flach | → namespaced |
|---|---|
| `anthropicApiKey` | `llm.anthropicApiKey` |
| `twilioSid`,`twilioToken`,`telnyxApiKey`,`telnyxConnectionId` | `telephony.*` |
| `publicUrl`,`webDistDir`,`port` | `server.*` |
| `mcpAuth`,`oauthIssuerUrl`,`sessionSecret`,`dashboardPassword` | `auth.*` |
| `storeBackend`,`databaseUrl` | `store.*` |
| `paymentEnabled`,`stripeSecretKey`,`stripeWebhookSecret`,`numberSetupFeeCents` | `billing.*` |
| `provisioningEnabled` | `provisioning.provisioningEnabled` |
| `skipTwilioSignatureCheck` | `safety.skipTwilioSignatureCheck` |
| `telnyxAssistant` (nested Gruppe) | `telnyx.telnyxAssistant` |
| `selfServiceEnabled`,`multiTenant` | `tenancy.*` |

### Exakte Edits — `src/config.js`

- **Edit A** — `resolveGatewayUrl()`: `config.port` → `config.server.port`.
- **Edit B** — `productionFootguns(cfg = config, isProduction = detectProduction())`: Signatur unveraendert; die rohe `process.env.DEV_LOGIN_ENABLED === "true"`-Zeile bleibt **wortidentisch** (zweites Schloss). 5 flache Praedikate → `cfg.auth.dashboardPassword`, `cfg.auth.mcpAuth`, `cfg.safety.skipTwilioSignatureCheck`, `cfg.auth.oauthIssuerUrl`, `cfg.store.storeBackend`; telnyx-Zugriffe bekommen eine zusaetzliche `?.`-Ebene (`cfg.telnyx?.telnyxAssistant?.…`), weil Fixtures den `telnyx`-Namespace auslassen duerfen.
- **Edit C** — `isSelfServiceLive(cfg)`: `cfg.selfServiceEnabled && cfg.multiTenant` → `cfg.tenancy.selfServiceEnabled && cfg.tenancy.multiTenant`.
- **Edit D** — `assertConfig()`: alle 20 Praedikate auf `config.<ns>.<key>` umgestellt (Reihenfolge/Logik unveraendert). Interne Aufrufe `productionFootguns(config, isProduction)` und `isSelfServiceLive(config)` bleiben wortidentisch (uebergeben weiter `config`). `detectProduction()`/Snapshot/`numEnv`/`boolEnv` unberuehrt.
- **Edit E** — Trivialer C2-Kommentar-Fix im DEV_LOGIN-Block (`config.devLoginEnabled` → `config.auth.devLoginEnabled` im Kommentartext).
- **Bewusst nicht angefasst:** Grouping-Kommentar an `rawConfig.telnyxAssistant` (beschreibt weiterhin gueltiges Flach-Alias-Verhalten bis PA-20).

### Exakte Edits — Test-Fixtures (4 geplante Dateien) + 1 neuer Regressionstest

Muster: flache Fixtures → namespaced Struktur via genestetem Spread (`{ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, key: val } }`), bewusst ohne Flach→Namespace-Helfer (haette `CONFIG_NAMESPACES`-Wissen dupliziert, G5).

- `test/config-prod-footguns.test.js`: `SAFE_PROD` + alle Call-Sites (T-P0-5-01/03/04/05/06/07, T-P0-1-AC1-01..04) namespaced; die `withConfig`-Tests T-P0-5-08/09 unveraendert.
- `test/telnyx-p10-config.test.js`: lokales `SAFE_PROD` + 3 productionFootguns-Fixtures namespaced; assertConfig/`withConfig`-Tests unveraendert.
- `test/single-origin-auth.test.js`: lokales `SAFE_PROD` namespaced; **neuer Regressionstest** „DEV_LOGIN_ENABLED-Roh-Pruefung ist unabhaengig vom config-Objekt" (rohe Env `"true"`, `cfg.auth.devLoginEnabled === false` → Footgun muss trotzdem greifen).
- `test/config-self-service-live.test.js`: 5 `isSelfServiceLive(...)`-Aufrufe auf `{ tenancy: { selfServiceEnabled, multiTenant } }` umgestellt.

### Deterministisch pruefbares Ergebnis (geplante Gates)

1. `node --check src/config.js` → Exit 0.
2. Struktur-Grep-Gate: 0 flache Leaf-Zugriffe (`config`/`cfg`) auf `CONFIG_NAMESPACES`-Blaetter in `src/config.js`, Kommentarzeilen ausgefiltert.
3. Fokussierte Tests der 6 betroffenen Dateien → alle `pass`.
4. Volle Suite `npm test` → 0 Failing (erwartet Baseline+1 durch den neuen Test).
5. Boot-Smoke: `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` → `curl /healthz` → `200`.
6. Optionaler Anti-Regressions-Beleg: telnyx-`?.`-Ebene temporaer zuruecksetzen → `telnyx-p10-config` muss rot werden (Beweis, dass Fixtures den migrierten Body wirklich treffen), danach restaurieren.

### Invarianten-Checkliste (Auszug)

- `process.env.DEV_LOGIN_ENABLED === "true"` in `productionFootguns` byte-identisch (kein `cfg.auth.devLoginEnabled`).
- Keine weitere rohe `process.env`-Pruefung auf `config.<ns>` umgestellt.
- `assertConfig`-Reihenfolge, `missing`/`fatal`-Zusammenbau, Rueckgabe-Bedingung unveraendert.
- Signaturen der drei Funktionen unveraendert; interne Aufrufe uebergeben weiter `config`.
- Safety-Gates, Offenlegungssatz, Auth-fail-closed nicht beruehrt (reiner Lese-Pfad).

### Blast-Radius & Pre-Mortem (Kern-Risiken)

- Vergessene Fixture → sofortiger `TypeError`, kein stilles Gruen (Grep-Gate + Anti-Regressions-Beleg fangen das).
- Falsche `?.`-Tiefe bei telnyx → SAFE_PROD-Footgun-Tests werfen sofort.
- DEV_LOGIN-Roh-Pruefung versehentlich auf `cfg` umgestellt → neuer Regressionstest wird rot.
- `config.port` uebersehen → Grep-Gate FAIL und spaeterer PA-20-Bruch.

### Explizit nicht Teil von PA-14

Kein Alias-Flip (PA-20), keine Importeur-Migration, kein `telnyxAssistant`-Grouping-Kommentar-Rewrite, keine `helpers.js`/`config-namespaces.test.js`-Aenderung, keine neue Env-Var, kein Deploy/Push.

---

## 2. Impl-Zusammenfassung

- **headCommit:** `98b38c994d71e3b487481bdc22f85a246179c9e3`
- **node --check:** PASS
- **Tests:** PASS — 2409 pass / 0 fail
- **committed:** ja (im Phase-Worktree/-Branch)

**Umsetzung exakt gemaess Plan:** `assertConfig()`, `productionFootguns()` und `isSelfServiceLive()` in `src/config.js` lesen jetzt `config.<namespace>.<key>` statt `config.<key>` flach. `resolveGatewayUrl()`s `config.port` → `config.server.port` als einziger weiterer Rest-Flachzugriff. Gate-Logik/Reihenfolge/`isProduction`-Snapshot/Console-Output unveraendert (reiner Access-Path-Umbau); die rohe `process.env.DEV_LOGIN_ENABLED`-Pruefung (zweites unabhaengiges Schloss) bleibt bewusst auf `process.env`, NICHT auf `config.auth.devLoginEnabled` umgestellt. Struktur-Grep-Gate (0 flache Leaf-Zugriffe in `config.js`) gruen; Anti-Regressions-Beleg (telnyx-`?.`-Ebene temporaer zurueckgesetzt) zeigte den erwarteten Rot-Ausschlag und wurde restauriert. Die 4 laut Plan betroffenen Testdateien (`config-prod-footguns`, `telnyx-p10-config`, `single-origin-auth` inkl. neuem DEV_LOGIN-Unabhaengigkeits-Regressionstest, `config-self-service-live`) auf namespaced Fixtures umgeschrieben; die assertConfig-basierten `withConfig`-Tests (mutieren den echten `config`) blieben unangetastet. Volle Suite 2409/0 (Baseline+1 neuer Test), Boot-Smoke (Dummy-Env + `OWNER_NUMBER_SEED`, `SKIP_TWILIO_SIGNATURE_CHECK`) → `/healthz` 200. Kein Deploy, kein Push.

### Geaenderte Dateien

- `src/config.js`
- `test/config-prod-footguns.test.js`
- `test/telnyx-p10-config.test.js`
- `test/single-origin-auth.test.js`
- `test/config-self-service-live.test.js`
- `test/auth-gate-exemption-order.test.js` *(ausserhalb der urspruenglichen Plan-Dateiliste — siehe Deviations)*
- `test/web-login-wiring.test.js` *(ausserhalb der urspruenglichen Plan-Dateiliste — siehe Deviations)*

Keine neuen Dateien.

### Tests hinzugefuegt/geaendert

- `test/single-origin-auth.test.js`: neuer Test „DEV_LOGIN_ENABLED-Roh-Pruefung ist unabhaengig vom config-Objekt" (Regression aus der Zusatz-Invariante).
- `test/config-prod-footguns.test.js`: `SAFE_PROD` + alle 13 Fixtures auf namespaced Struktur umgeschrieben (Verhalten/Assertions unveraendert).
- `test/telnyx-p10-config.test.js`: lokales `SAFE_PROD` + 3 `productionFootguns`-Fixtures namespaced (assertConfig/`withConfig`-Tests unveraendert).
- `test/single-origin-auth.test.js`: `SAFE_PROD` namespaced.
- `test/config-self-service-live.test.js`: alle 5 `isSelfServiceLive`-Aufrufe auf `{ tenancy: {...} }` umgestellt.
- `test/auth-gate-exemption-order.test.js` (ausserhalb der Plan-Liste, direkte Folge derselben `isSelfServiceLive`-Migration): `makeGate`-Fixture + 4 Flag-Kombis auf `config.tenancy.{selfServiceEnabled,multiTenant}` umgestellt, `dashboardPassword` bleibt flach.
- `test/web-login-wiring.test.js` (ausserhalb der Plan-Liste, gleicher Grund): `baseConfig.tenancy` + S2-16-Override auf namespaced Struktur umgestellt.

### Deviations vom Plan

Blast-Radius-Korrektur ueber die Plan-Behauptung hinaus: der Plan sagte „nur 4 Testdateien injizieren flache Literale" fuer `isSelfServiceLive`/`productionFootguns`. Beim vollen `npm test`-Lauf brachen zusaetzlich `test/auth-gate-exemption-order.test.js` und `test/web-login-wiring.test.js` mit `TypeError`, weil sie fuer die Wiring-Layer (`src/wiring/auth-gate.js`, `src/wiring/web-login.js`) eigene flache Fake-config-Objekte injizieren, die intern via `isSelfServiceLive(config)` laufen. Das ist eine direkte, unausweichliche mechanische Folge der vom Plan selbst geforderten `isSelfServiceLive`-Migration (kein Gate-Logik-Umbau, reine Fixture-Reparatur) — beide Dateien wurden namespaced (nur das `tenancy`-Feld; alle anderen flachen Felder bleiben unveraendert, da die Wiring-Module sie weiterhin flach lesen). Ohne diesen Fix waere die Suite nicht gruen gewesen; mit Fix ist sie es (2409/0).

### Smoke-Test

**smokePass:** ja. Server auf `PORT=3999` mit `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-ANTHROPIC/TWILIO-Keys, `PUBLIC_URL`, `DASHBOARD_PASSWORD`, `OWNER_NUMBER_SEED` (`+15005551234`) und temp `DATA_DIR` gestartet: Boot-Banner erschien, `assertConfig()` lief mit den namespaced Reads sauber durch, `curl /healthz` → `200`. Server danach gestoppt, temp-Datenverzeichnis entfernt.

### Clean-Code-Self-Check (Impl-Agent)

Reiner Access-Path-Umbau, keine neue Funktion/Datei/Argument/Magic-Number. Kein toter/auskommentierter Code. C2-Kommentar in `productionFootguns` aktualisiert (`config.devLoginEnabled` → `config.auth.devLoginEnabled`), keine neuen Datei:Zeile-Verweise. Keine Duplizierung eingefuehrt (G5): Test-Fixtures nutzen genesteten Spread statt eines Flach→Namespace-Helfers, der `CONFIG_NAMESPACES`-Wissen dupliziert haette. Verschachtelungstiefe/Funktionslaenge unveraendert (nur Property-Pfade laenger). ESM, kein Build-Step, Kommentare deutsch ohne Umlaute. Neues Verhalten (DEV_LOGIN-Unabhaengigkeits-Invariante) hat einen eigenen Test; reiner Refactor liess die Bestandssuite ohne Logik-Aenderung gruen.

---

## 3. Safety-Urteil (final)

**verdict:** APPROVE

- approved: ja
- testsPassIndependently: ja
- safetyGatesIntact: ja
- disclosureIntact: ja
- authFailClosedIntact: ja
- noSecretsLeaked: ja
- behaviorAsIntended: ja
- scopeRespected: ja
- blockers: keine
- concerns: keine

**Unabhaengiger Testlauf:** Volle Suite (Default JSON-Backend): 2409 Tests, 2409 pass, 0 fail, 0 skipped, Dauer ~76s. PG-Backend wird in-process via pglite mitgeprueft (`web-auth-pg`, `rls-with-check`, Erase/Usage-Event-Persistenz, `registerTenant`-Roundtrip, `assertNoBypassRls` F5-Guard) — alle gruen im selben Lauf; kein separates `STORE_BACKEND=pg`-Skript noetig (`BASE_ENV` pinnt json; pg-Tests provisionieren pglite selbst). Betroffene Dateien isoliert: `config-prod-footguns`, `config-self-service-live`, `config-payment-guard`, `boot-failclosed`, `single-origin-auth`, `telnyx-p10-config`, `web-login-wiring`, `auth-gate-exemption-order` → 56 Tests, 56 pass, 0 fail. Hinweis: der `ln -s ./node_modules node_modules`-Schritt aus der Task-Vorlage ist zirkulaer/selbst-referenzierend; der Symlink wurde auf das Haupt-Repo-`node_modules` umgebogen, um Tests laufen zu lassen (kein Code-Problem).

**Begruendung (Kurzfassung):** PA-14 ist eine saubere, rein mechanische Access-Path-Migration der Boot-Gate-Funktionen (`resolveGatewayUrl`, `productionFootguns`, `assertConfig`, `isSelfServiceLive`) von `config.<key>` auf `config.<namespace>.<key>` gemaess `CONFIG_NAMESPACES`. Alle 26 Umschreibungen sind korrekt gemappt (inkl. der subtilen telephony-vs-telnyx-Trennung); Laufzeit-Verifikation von 23 flach-vs-namespaced-Paaren auf dem echten `guardedConfig`-Objekt zeigt 0 Wertabweichungen — Flag-off-Verhalten ist byte-identisch. Keine Gate-LOGIK geaendert: alle fuenf `productionFootguns`, der telnyx-Turn-Cap-Footgun und jede `assertConfig`-Missing-Var-Pruefung behalten identische Bedingungen. Die kritische Defense-in-Depth-Invariante bleibt unangetastet — die rohe `process.env.DEV_LOGIN_ENABLED === "true"`-Pruefung ist unveraendert (nur ihr Kommentar-Verweis wurde aktualisiert), und ein neuer Regressionstest in `single-origin-auth.test.js` beweist, dass sie unabhaengig feuert, wenn `cfg.auth.devLoginEnabled === false`. Optional-Chaining korrekt erhalten. Grep-Gate sauber: keine Rest-Flach-Zugriffe in `config.js` ausser Kommentar-/String-Erwaehnungen und der einen bewussten rohen `process.env`-Stelle. Scope respektiert: nur `src/config.js` + 7 Testdateien, `package.json`/`package-lock.json` unveraendert (keine neuen Deps), `claude.js`/`bridge.js` unberuehrt (Offenlegung intakt), keine Logging-/Secret-Aenderungen. Keine Blocker.

---

## 4. Clean-Code-Audit (final)

**verdict:** PASS (kein Blocker)

PA-14 ist eine sauber begrenzte, mechanische Migration von 4 Boot-Gate-Funktionen (`resolveGatewayUrl`, `productionFootguns`, `isSelfServiceLive`, `assertConfig`) in `src/config.js` von flachen `config.<key>`- auf namespaced `config.<ns>.<key>`-Zugriffe, plus Anpassung der 6 zugehoerigen Testdateien. Jede migrierte Feldzugriffs-Zuordnung wurde einzeln gegen die bestehende `CONFIG_NAMESPACES`-Deklaration (auth/telephony/safety/store/billing/tenancy/telnyx/server/llm/provisioning, aus PA-12/13, unveraendert) kreuzgeprueft — alle Zuordnungen stimmen. Volle Suite im Phase-Branch-Worktree gruen (2409/2409, 0 Fail), `node --check` sauber.

### S1 (Blocker)

Keine.

### S2

Keine.

### S3

1. **G24 · `src/config.js:937`** — Prettier `printWidth=100` verletzt (102 Zeichen: `(!Number.isInteger(config.billing.numberSetupFeeCents) || config.billing.numberSetupFeeCents <= 0)`); auf `master` war die flache Vorgaengerzeile (`config.numberSetupFeeCents`) noch konform — die Migration hat die Zeile ueber die Grenze geschoben, ohne sie neu umzubrechen. **Fix:** `npx prettier --write src/config.js` (bricht automatisch mehrzeilig um).
2. **G24 · `src/config.js:995`** — Prettier `printWidth=100` verletzt (102 Zeichen: `if (isSelfServiceLive(config) && !(config.auth.sessionSecret && config.store.storeBackend === "pg")))`); auf `master` war diese Zeile mit den flachen Feldern noch konform. **Fix:** `npx prettier --write src/config.js`.
3. **G24 · `test/config-prod-footguns.test.js:126,132,136,142`** (T-P0-1-AC1-01..04) — dieselben Zeilen waren auf `master` mit flachem `storeBackend: "..."` 86-91 Zeichen (konform); nach Verschachtelung in `store: { ...SAFE_PROD.store, storeBackend: ... }` jetzt 113-118 Zeichen, neu ueber der Grenze. **Fix:** `npx prettier --write test/config-prod-footguns.test.js`.
4. **G24 · `test/config-self-service-live.test.js:11,15,19,23,27,28`** — Datei war auf `master` vollstaendig Prettier-konform (0 Verstoesse); durch die Verschachtelung `{ tenancy: { selfServiceEnabled, multiTenant } }` liegen jetzt alle 5 Testkoerper (102-111 Zeichen) ueber `printWidth=100`. **Fix:** `npx prettier --write test/config-self-service-live.test.js`.
5. **C2 (geringfuegig) · `test/config-self-service-live.test.js:1-4`** — Kopfkommentar beschreibt weiterhin nur die historisch von `isSelfServiceLive()` abgeloeste FLACHE Bedingung (`config.selfServiceEnabled && config.multiTenant`), erwaehnt nicht, dass die Funktion selbst seit PA-14 `cfg.tenancy.<key>` liest; kein Widerspruch zum Code, nur unvollstaendig — kein Fix noetig, optionale Praezisierung.

### S4

Keine.

### Pass-Notizen

Vollstaendige, konsistente Migration: alle 4 Boot-Gate-Funktionen lesen jetzt einheitlich ueber die Namespaces, keine gemischten Flach-/Namespaced-Zugriffe innerhalb derselben Funktion mehr. Feld-fuer-Feld-Abgleich gegen `CONFIG_NAMESPACES` bestaetigt: `llm.anthropicApiKey`, `telephony.{twilioSid,twilioToken,telnyxApiKey,telnyxConnectionId}`, `server.{publicUrl,webDistDir,port}`, `auth.{mcpAuth,oauthIssuerUrl,dashboardPassword,sessionSecret}`, `store.{storeBackend,databaseUrl}`, `billing.{paymentEnabled,stripeSecretKey,stripeWebhookSecret,numberSetupFeeCents}`, `telnyx.telnyxAssistant.{enabled,assistantId,callControlAppId,shimSharedSecret,shimMaxTurnsPerMin}`, `tenancy.{selfServiceEnabled,multiTenant}`, `provisioning.provisioningEnabled` — alle vorhanden, korrekt gemappt. Optional-Chaining (`cfg.telnyx?.telnyxAssistant?.X`) in `productionFootguns()` bewusst beibehalten (injizierbares `cfg`-Testargument), nicht-optionale Zugriffe in `assertConfig()` bewusst (operiert immer auf dem realen `config`-Singleton) — konsistent mit dem Vor-Migrations-Stil, keine neue Inkonsistenz (G11). PM-1-Garantie (`Object.assign(config, flatOverrides)` schlaegt via Proxy-Getter 1:1 auf `config.<ns>.<key>` durch) korrekt genutzt und durch die bestehenden `withConfig()`-Testhelfer verifiziert. Neuer Regressionstest in `test/single-origin-auth.test.js` (DEV_LOGIN_ENABLED-Roh-Pruefung unabhaengig vom `cfg`-Objekt) ist eine sinnvolle, eng auf PA-14 bezogene Ergaenzung (kein Scope-Creep). Keine Safety-Gates aufgeweicht, keine Auth-/Secret-Handhabung veraendert, keine neuen Argumente/Funktionen/Verschachtelungstiefen. Volle Suite 2409/2409 gruen, `node --check` sauber.

### Top-Todos

1. `npx prettier --write src/config.js test/config-prod-footguns.test.js test/config-self-service-live.test.js` (bzw. `npm run format`) — 2 neue >100-Zeichen-Zeilen in `src/config.js` (937, 995) + mehrere in den zwei Testdateien, alle nachweislich erst durch diesen Diff eingefuehrt (G24/S3), vor Merge beheben.
2. Optional: Kopfkommentar `test/config-self-service-live.test.js:1-4` um einen Hinweis ergaenzen, dass `isSelfServiceLive()` seit PA-14 `cfg.tenancy.<key>` liest (kein Blocker).

---

## 5. Fix-Runden

Keine — im Quellprotokoll wurde kein `FIXES`-Abschnitt uebermittelt (Platzhalter leer). Die im Clean-Code-Audit gelisteten S3-Befunde (Prettier `printWidth=100`) sind zum Zeitpunkt dieses Berichts als offene Top-Todos dokumentiert, nicht als bereits durchgefuehrte Fix-Runde.
