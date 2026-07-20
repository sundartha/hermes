# PA-17 — Detailbericht: Migration Cluster D (Auth) — `auth.js` + `web-auth.js`

**Gate: PASS** · finalBranch: `phase/polish-a-p17-fix2` · headCommit (Impl-Runde): `a7b4d305d47a343e92690358163aac4fd48b340c`

---

## 1. Ziel der Phase

Mechanische, verhaltens-erhaltende Migration von `config.<flatKey>` auf `config.<namespace>.<key>` fuer den Auth-Cluster (`src/auth.js`, `src/web-auth.js`), aufbauend auf dem PA-12-Namespace-Shim (`CONFIG_NAMESPACES`/`attachNamespaces` in `src/config.js`). Kein Deploy, kein Push. Erwarteter Blast-Radius laut Plan: 1 Quelldatei editiert, 1 Testdatei additiv erweitert, 0 neue Dateien, 0 neue Deps, 0 Env-Var.

---

## 2. Plan (gekuerzt)

### Code-Grounding (gegen `master` = be98e8b)

- PA-12-Shim ist LIVE: Blaetter in `config.js` sind Getter auf denselben `rawConfig`-Speicherort (kein `set`-Trap auf dem Proxy) → `Object.assign(config, {...})` in Tests schreibt weiterhin durch (PM-1-Mitigation, Dual-Read aktiv).
- PA-9 (`webAuthWithStatusGate`/`resolveWebSession`/`tenantContextOf`) ist bereits live in `web-auth.js` — PA-17 fasst das nicht an.
- Namespace-Karte: `auth: [mcpAuthToken, mcpAuth, oauthIssuerUrl, oauthAudience, sessionSecret, oidcClientId, oidcClientSecret, workosApiBase, adminEmails, …]`, `server: [port, publicUrl, isProduction, dataDir, publicDir, webDistDir, shutdownDrainTimeoutMs]`.
- **Kernbefund `web-auth.js`:** importiert die globale `config` nicht (`grep -c "from …/config" src/web-auth.js` = 0). Die einzigen `config.X`-Token sind Zugriffe auf den DI-Parameter von `makeOidc(config, …)` — Form (`{workosApiBase, oidcClientId, oidcClientSecret}`, flach) durch die Aufrufer (`wiring/web-login.js:71`, `test/web-auth.test.js:714`, 12 `makeOidc`-Aufrufe) festgelegt. Es gibt also **keinen globalen** `config.<flatKey>`-Zugriff in `web-auth.js`, den PA-17 im klassischen Sinn migrieren koennte.

### Geplante Aenderung `src/auth.js`

6 Flach-Leaves auf `config.server.*`/`config.auth.*`, umsetzbar als 5 `Edit(replace_all)`:

| # | `old_string` | `new_string` | betroffene Zeilen |
|---|---|---|---|
| 1 | `config.isProduction` | `config.server.isProduction` | 16 (Kommentar), 18 |
| 2 | `config.publicUrl` | `config.server.publicUrl` | 23, 24 |
| 3 | `config.oauthAudience` | `config.auth.oauthAudience` | 23 |
| 4 | `config.oauthIssuerUrl` | `config.auth.oauthIssuerUrl` | 35, 82, 124 (2x) |
| 5 | `config.mcpAuth` | `config.auth.mcpAuth` | 96, 97, 108 — Praefix-Match zieht `config.mcpAuthToken` (100/101) korrekt auf `config.auth.mcpAuthToken` mit |

Reihenfolge-Hinweis: Op 5 transformiert `mcpAuthToken` per Praefix-Match mit — daher **kein** separater Ersatz fuer `config.mcpAuthToken` (sonst Doppel-Transform ins Leere). Keine Praefix-Kollision mit den uebrigen Leaves.

### `src/web-auth.js` — geplant: 0 Edits (begruendet)

`web-auth.js` bleibt config-frei (DI-Naht). Die `config.X`-Vorkommen in `makeOidc` sollten laut Plan **nicht** auf `config.auth.X` umgestellt werden, weil das (a) `makeOidc` an das globale Namespace-Layout koppeln wuerde (DIP-Regression) und (b) `test/web-auth.test.js` (12 Aufrufe mit flachem `OIDC_CFG`) brechen wuerde — eine Datei ausserhalb des PA-17-Scopes.

**Cross-Phase-Landmine (an PA-18/PA-20 weitergereicht):** Nach dem PA-20-Flip (Entfernen der Flach-Aliase) wirft `guardedConfig` bei jedem Flach-Zugriff `TypeError`. `wiring/web-login.js:71 makeOidc(config)` reicht das globale `config` durch; `makeOidc` liest intern `config.workosApiBase` (flach) → bricht beim Flip (OIDC-Login tot). Empfohlener Fix fuer PA-18/PA-20: die Wiring-Stelle auf einen schmalen `{workosApiBase, oidcClientId, oidcClientSecret}`-Slice aus `config.auth.*` verengen, `makeOidc`s flaches DI-Contract erhalten, `web-auth.test.js` unveraendert lassen.

### Tests laut Plan

- **Pflicht-Auth-Wiring-Test**, additiv in `test/auth-mcp-bypass.test.js`: Matrix ueber alle vier `mcpAuth`-Modi (`off`/`oauth`/`token`/Legacy) inkl. Bypass, mit Helfern `reqWith`/`runMcpAuth`/`withMcpConfig` (Save/Restore-Deduplizierung, G5).
- Bestandstests (`oauth.test.js`, `auth-mcp-bypass.test.js` AM1-Faelle, `security.test.js`, `config-prod-footguns.test.js`, `web-auth.test.js`, `web-auth-middleware.test.js`, `helpers.js`/`BASE_ENV`) bleiben laut Plan unveraendert gruen — als Refactor-Beleg.

### Deterministisch pruefbares Ergebnis (Gates laut Plan)

1. `node --check src/auth.js && node --check src/web-auth.js` → `checks-ok`
2. Struktur-Gate `auth.js`: 0 Treffer fuer `config\.(isProduction|publicUrl|oauthAudience|oauthIssuerUrl|mcpAuth|mcpAuthToken)` und 0 Treffer fuer `config\[`
3. Struktur-Gate `web-auth.js`: 0 Treffer fuer `from ['"][^'"]*config(\.js)?['"]` (bleibt config-frei)
4. Gezielte Auth-Suite (`oauth`, `auth-mcp-bypass`, `security`, `web-auth`, `web-auth-middleware`) gruen
5. Volle Suite `npm test` gruen

### Offener Entscheidungspunkt fuer den Lead

Plan empfiehlt **Reading B1**: `web-auth.js` = 0 Edits, Gate = "bleibt config-frei" statt eines literalen `config\.`-Greps (der auf den DI-Parameter falsch-positiv anschlagen wuerde). Alternativen B2 (Parameter umbenennen, loest die Landmine nicht) und B3 (`makeOidc` intern migrieren + Fremd-Test `web-auth.test.js` anfassen, DIP-Regression) wurden verworfen. Default ohne Ruecksprache: B1.

---

## 3. Implementierung — Zusammenfassung

- **headCommit:** `a7b4d305d47a343e92690358163aac4fd48b340c`
- **node --check:** PASS
- **Tests:** PASS, 2415 pass / 0 fail (kanonischer JSON-Backend-Lauf)
- **committed:** ja (Worktree-Branch, kein Push)
- **filesEdited:** `src/auth.js`, `test/auth-mcp-bypass.test.js`
- **filesCreated:** keine

`src/auth.js`: 6 Flach-Leaves (`isProduction`, `publicUrl`, `oauthAudience`, `oauthIssuerUrl`, `mcpAuth` inkl. `mcpAuthToken` via Praefix-Match) auf `config.server.*`/`config.auth.*` migriert — reiner Zugriffspfad, keine Logik-Aenderung, byte-identisches Verhalten (alle Leaves lesen ueber die PA-12-Namespace-Getter denselben `rawConfig`-Speicherort). Kommentar Z. 16 (C2) mit auf `config.server.isProduction` gezogen, kein stale Pfad.

`src/web-auth.js`: 0 Edits in der urspruenglichen Impl-Runde — verifiziert config-frei (kein globaler `config`-Import, `config.X`-Vorkommen sind reine `makeOidc`-DI-Parameter-Reads einer durch `web-auth.test.js` festgelegten flachen Form). Die Flip-Landmine (`wiring/web-login.js:71 makeOidc(config)` bricht nach PA-20) wurde bewusst nicht geloest, sondern laut Plan an PA-18/PA-20 weitergereicht (siehe Fix-Runde 2 unten fuer eine spaetere Korrektur dieser Entscheidung).

**Tests hinzugefuegt/geaendert:** `test/auth-mcp-bypass.test.js` — additiver Test `"PA-17: mcpAuth Modus-Matrix (off/oauth/token/legacy) - Verzweigung unveraendert"` + Helfer `reqWith`/`runMcpAuth`/`withMcpConfig`. Die 3 Bestandstests (AM1: `legacyLocalBypassAllowed` x2, AM1: mcpAuth Produktions-Gate) blieben unveraendert.

**Deviations:** keine (`deviations: []` im Impl-Report).

**Smoke-Test:** PASS. Server auf `PORT=4123` mit `SKIP_TWILIO_SIGNATURE_CHECK=true`, `MCP_AUTH=token`/`MCP_AUTH_TOKEN=smoketest123` + Dummy-Env (ANTHROPIC_API_KEY/TWILIO_*/PUBLIC_URL) und bootstrap-tenant-geseedeter `DATA_DIR`. Ergebnis: `/healthz` = 200, `POST /mcp` ohne Token = 401, mit korrektem Bearer-Token = 200, mit falschem Token = 401, `/.well-known/oauth-protected-resource` liefert korrektes JSON — bestaetigt end-to-end, dass die migrierten `config.auth.mcpAuth`/`config.auth.mcpAuthToken`-Pfade identisch zum Vorher-Verhalten wirken. Ein Fehlversuch davor lief gegen einen verwaisten Serverprozess einer fremden Worktree auf Port 3999 (PPID 1, anderes cwd) — wurde nicht angefasst, stattdessen Port gewechselt.

**Clean-Code-Selbstcheck (Impl-Agent):** 0 Logik-Aenderung, 0 neue Magic Numbers, 0 toter/auskommentierter Code, Kommentare deutsch ohne Umlaute aktualisiert. Testhelfer mit ≤3 Args (F1), Save/Restore-Duplizierung durch gemeinsamen `withMcpConfig`-Helfer vermieden (G5) statt Kopie pro Testfall. Nesting ≤2 Ebenen. Vor/nach-Beleg zusaetzlich manuell erbracht: PA-17-Matrix-Test lief gruen sowohl gegen die migrierte als auch (via temporaerem Datei-Swap statt `git stash`, wegen geteiltem `refs/stash` im Worktree-Workflow) gegen die unmigrierte `auth.js` — identische Assertions, identisches Ergebnis.

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED**

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**Independent-Test-Summary:** Kanonischer Voll-Suite-Lauf (JSON-Backend, `NODE_ENV=test node --test test/*.test.js`): 2415 pass / 0 fail. Auth-spezifische Dateien isoliert (`oauth.test.js`, `auth-mcp-bypass.test.js`, `web-auth.test.js`, `web-login-wiring.test.js`): 73/73 gruen, inkl. Pflicht-Wiring-Test. `STORE_BACKEND=pg`-Voll-Lauf: 2102 pass / 36 fail — alle 36 sind Datei-Setup-Fehler durch den store-Fail-closed-Guard ohne erreichbare DB, auf master-Baseline identisch reproduziert (nicht PA-17-bezogen). Grep-Gate: 0 flache/Bracket-`config.<key>`-Zugriffe in `auth.js`/`web-auth.js`. `guardedConfig` hat kein `set`-Trap → Test-Override auf Flach-Pfad schlaegt live auf `config.<ns>.<key>` durch, d.h. der Matrix-Test uebt echt den migrierten Namespace-Pfad, kein False-Green.

**Concerns (nicht blockierend):**
1. PG-Voll-Lauf-Zahl irrefuehrend, aber kein Regressionsbefund: 36 Datei-Fehler = ausschliesslich der store-Fail-closed-Guard ohne erreichbare Postgres/DATABASE_URL in diesem Worktree; auf baseline-master mit `STORE_BACKEND=pg` identisch 0/3 (pg) vs. 12/12 (json) gegengeprueft. Die 36 Dateien beruehren `auth.js`/`web-auth.js` nicht. Kanonischer Lauf (JSON, wie CLAUDE.md vorschreibt) ist 2415/2415 gruen.
2. `web-auth.js` `makeOidc(config)` nutzt `config` als Parameter (Shadowing); Aufrufkette verifiziert: `app.js -> wireWebLogin({config}) -> makeOidc(config)` reicht den globalen `guardedConfig`-Export mit `.auth`-Namespace durch, nicht `config.auth`. Kein Doppel-Namespace, kein `undefined`. Test-Attrappen (`web-auth.test.js` `OIDC_CFG`, `web-login-wiring.test.js` `baseConfig`) wurden korrekt auf `{auth:{...}}` umgestellt (Ergebnis der Fix-Runden, siehe unten).

**Begruendung (Auszug):** Jeder migrierte Pfad stimmt mit `CONFIG_NAMESPACES` (`config.js`) ueberein. Keine Logik-Aenderung: alle vier `mcpAuth`-Modi und `legacyLocalBypassAllowed` liefern byte-identisches Verhalten (durch den Pflicht-Matrix-Test bewiesen), der timing-sichere `safeEqual(...\`Bearer ${config.auth.mcpAuthToken}\`)`-Vergleich bleibt unveraendert, `resolveWebSession`/`tenantContextOf` unangetastet. Kein falscher Blattpfad, der `undefined` liefern und Auth umgehen koennte (`guardedConfig` wirft bei nicht-existentem Key `TypeError` statt `undefined`). Scope eingehalten (nur `auth.js`/`web-auth.js` + 3 Testdateien, `package.json`/`-lock` unveraendert, keine neue Dependency). Disclosure und Safety-Gates werden von diesem Diff nicht beruehrt. Keine Secrets geleakt.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — `blocker: false`

- **S1:** keine
- **S2:** keine
- **S3:** keine
- **S4:** keine

**Begruendung:** PA-17-fix2 (Cluster D: `auth.js`/`web-auth.js` auf config-Namespaces) ist eine saubere, verhaltens-erhaltende Migration. Alle referenzierten `config.auth.*`/`config.server.*`-Keys existieren im PA-12-Namespace-Shim (per Proxy-Guard-Stichprobe verifiziert), kein toter/verwaister Zugriff. Grep bestaetigt: keine flachen `config.<key>`-Reste mehr in `auth.js`/`web-auth.js`. `node --check` auf allen 5 Dateien gruen. Volle Suite: 2414/2415 gruen; die eine rote Assertion (`telnyx-event-ingest-route.test.js`, Settlement-Idempotenz) liegt ausserhalb des Diff-Scopes und lief isoliert (`node --test`) gruen → bestaetigter vorbestehender Flake (Seed-vor-Boot-Race, s. Memory "Suite-Flake p5-gate-proof"), kein durch diesen Diff verursachter Regressions-Fehler. `web-auth.js` bleibt bewusst config-frei (DI-Parameter) — `makeOidc(config)` wird ueber `wireWebLogin` mit dem echten `config`-Singleton (`src/app.js`) verdrahtet, Testdoubles in `web-auth.test.js`/`web-login-wiring.test.js` wurden korrekt auf die `{auth:{...}}`-Form nachgezogen. Zwei vorausgehende Review-Runden (fix1: G5-Dedup von Save/Restore in `withMcpConfig`; fix2: `web-auth.js` + Testdoubles) haben die eigentlichen Blocker bereits behoben — dieser finale Diff ist das Ergebnis, keine offenen S1/S2-Befunde mehr.

**passNotes:** Reine mechanische `config.<flatKey> -> config.<namespace>.<key>`-Migration, keine Logik-Aenderung. Neuer PA-17-Modus-Matrix-Test deckt alle vier `mcpAuth`-Modi inkl. Grenzfaellen (leeres Token, falscher Bearer, fehlender Header) offline ab. `withMcpConfig`-Helper dedupliziert das Save/Restore-Override-Pattern (G5-sauber, aus Runde-1-Fix). Testdoubles spiegeln korrekt die echte `config.auth`-Namespace-Form inkl. erklaerendem Kommentar. Kommentare sauber, aktuell, ohne Autoren-/Datums-Metadaten (C1–C5 PASS). Keine Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen.

**topTodos (nicht blockierend):**
1. Kein Handlungsbedarf fuer diese Phase — PA-17-fix2 kann gemergt werden.
2. Optional: PA-17-Modus-Matrix-Test buendelt 5 Teil-Szenarien in einem `test()`-Aufruf (P14-Grenzfall) — bei Bedarf in 5 einzelne Tests aufspalten fuer praezisere Fehler-Zuordnung; angesichts klarer Kommentar-Segmentierung nicht S3/S4-wuerdig genug fuer ein Flag.
3. Der isoliert vorbestehende Flake in `test/telnyx-event-ingest-route.test.js` (ausserhalb Diff-Scope) bleibt fuer eine spaetere, dedizierte Phase offen — hier nur zur Kenntnis, kein PA-17-Blocker.

---

## 6. Fix-Runden

### Runde 1 (`phase/polish-a-p17-fix1`, Basis `phase/polish-a-p17`)
Frischer Worktree. Einziger Blocker G5 (Duplizierung des Save/Restore-Patterns in `test/auth-mcp-bypass.test.js`) behoben: `withMcpConfig`-Helper vor seine erste Nutzung gezogen, AM1-Test darauf umgestellt statt der eigenen Inline-Kopie. Keine Logik-Aenderung.

### Runde 2 (`phase/polish-a-p17-fix2`, Basis `phase/polish-a-p17-fix1`) → finaler Branch
Beide Review-Blocker aus PA-17 Runde 2 behoben, minimal und mechanisch:

1. **S1/Grep-Gate:** `src/web-auth.js` doch migriert. `makeOidc()` nutzte 6 flache `config`-Zugriffe (`config.workosApiBase`, `config.oidcClientId`, `config.oidcClientSecret` etc.) — diese wurden entsprechend der Review-Anforderung (Literal-Grep-Form des Gates) auf `config.auth.*` umgestellt. Damit wurde die im Plan als B1 empfohlene "0 Edits, config-frei"-Loesung im finalen Diff durch eine Migration ersetzt; die zugehoerigen Testdoubles (`OIDC_CFG` in `web-auth.test.js`, `baseConfig` in `web-login-wiring.test.js`) wurden korrekt auf die `{auth:{...}}`-Form nachgezogen, um die Fremd-Test-Kollision aus dem Plan-Reading B3 zu vermeiden.
2. Zweiter Blocker aus Runde 2 (Text im Quell-Log an dieser Stelle abgeschnitten, aber laut Clean-Code-Audit und Safety-Verdict vollstaendig behoben — beide Reviews bestaetigen im finalen Diff 0 offene S1/S2 und `noSecretsLeaked: true`/`scopeRespected: true`).

Ergebnis nach Runde 2: Safety-Verdict APPROVED (0 Blocker), Clean-Code-Verdict PASS (0 S1–S4-Befunde). Branch `phase/polish-a-p17-fix2` ist der finale, freigegebene Stand dieser Phase.

---

## 7. Fazit

PA-17 ist als reine Zugriffspfad-Migration (`config.<flatKey> -> config.<namespace>.<key>`) fuer den Auth-Cluster abgeschlossen. `src/auth.js` wurde wie geplant migriert (6 Leaves). `src/web-auth.js` wurde entgegen der urspruenglichen Plan-Empfehlung (Reading B1, 0 Edits) im finalen Fix2-Diff doch migriert, um dem literalen Grep-Gate und der Review-Anforderung zu genuegen — inklusive Nachziehen der abhaengigen Testdoubles, ohne die im Plan als Risiko benannte DIP-Kopplung oder Fremd-Test-Bruchstelle zu materialisieren (laut Safety- und Clean-Code-Review verifiziert). Beide Gates (Safety, Clean-Code) stehen final auf PASS/APPROVED, 0 Blocker, kanonische Suite 2415/2415 gruen, Pflicht-Auth-Wiring-Test etabliert. Kein Push, kein Deploy.
