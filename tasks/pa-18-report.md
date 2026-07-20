# PA-18 — Migration Cluster E (Rest src) — Report

**Ziel:** Letzte src-Migration vor dem PA-20-Flip — Zugriffspfad-Migration `config.<flatKey>` → `config.<namespace>.<key>` fuer den verbliebenen Rest-Cluster src/server+boot+metrics+mcp+geo+queue + ALLE restlichen src-Importeure, die noch flach lasen.
**Gate:** PASS
**finalBranch:** `phase/polish-a-p18`
**headCommit (Impl):** `8295688a81c6e18dbe022a76492ca4c3d893978d`

---

## 1. Plan (gekuerzt)

**Typ:** rein mechanische, verhaltens-erhaltende Zugriffspfad-Migration. Kein Logik-, Safety-, Signatur- oder Auth-*Entscheidungs*-Pfad wird geaendert — nur die Wert-Quelle (Getter auf denselben `rawConfig`-Slot, seit PA-12 dual-read garantiert durch `test/config-namespaces.test.js` fuer alle 99 Keys). Basis: `master` (PA-12–PA-17 + PA-19 gemergt, `960974e`).

### Faktenlage (auf master verifiziert)

- `CONFIG_NAMESPACES` (13 Gruppen) existiert; `attachNamespaces` haengt jede Gruppe als nicht-enumerable Getter-Fassade auf denselben `rawConfig`-Slot. Flach-Alias bleibt aktiv (Entfernung erst PA-20).
- **Nested-in-nested Blaetter:** `telnyxAssistant` liegt unter `telnyx`, `elevenLabsPlayTts` unter `voice`. Also: `config.telnyxAssistant.X` → `config.telnyx.telnyxAssistant.X`; `config.elevenLabsPlayTts` → `config.voice.elevenLabsPlayTts`.
- **Konvention der Vorgaenger-Phasen (PA-16-Report bindend):** nur **Code-Zugriffe** migrieren, **Kommentare** unangetastet lassen (vorbestehendes, nicht-blockierendes S3). Struktur-Gate = „0 Flach-Zugriffe im Code, Kommentar-Treffer erlaubt".
- **Keine** Bracket-Zugriffe, **keine** Destrukturierung in PA-18-Scope. **Keine neue Env-Var** → `BASE_ENV` in `test/helpers.js` unveraendert.

### Scope — 25 src-Dateien mit echten Code-Zugriffen

`src/app.js`, `src/boot.js`, `src/geo/registry.js`, `src/llm.js`, `src/mcp-server-info.js`, `src/mcp-server.js`, `src/metrics.js`, `src/portal-pool.js`, `src/queue/registry.js`, `src/routes/_tenant.js`, `src/routes/api-billing.js`, `src/routes/api-calls.js`, `src/routes/api-onboard.js`, `src/routes/api-read.js`, `src/routes/mcp.js`, `src/self-service-routes.js`, `src/server.js`, `src/store.js`, `src/telnyx-call-control-ingest.js`, `src/telnyx-conversation-watchdog.js`, `src/telnyx-llm-shim.js`, `src/telnyx-origination.js`, `src/tts/directive-synth.js`, `src/wiring/auth-gate.js`, `src/wiring/web-login.js`.

Zuordnung je Datei (Zeile: alt → Ziel-Namespace), u.a.: `rateLimitPerMin`→`safety.`, `webDistDir`/`publicDir`/`port`/`shutdownDrainTimeoutMs`→`server.`, `sessionSecret`/`dashboardPassword`/`adminEmails`/`devLoginEnabled`/`sessionTtlSeconds`/`loginCookieTtlSeconds`/`loginRateLimitPerMin`→`auth.`, `storeBackend`/`databaseUrl`/`queueBackend`→`store.`, `retentionDays`/`releaseGraceMs`→`privacy.`/`provisioning.`, `voiceEngine`/`openaiApiKey`/`elevenLabsPlayTts`→`voice.`, `outboundFrozen`/`allowedCountryCodes`/`maxCallsPerHour`→`safety.`, `llmRequestTimeoutMs`/`llmBreakerThreshold`/`llmBreakerWindowMs`/`llmBreakerCooldownMs`/`llmMaxRetries`/`llmBackoffMs`/`claudeModel`→`llm.`, `mcpUiEnabled`/`multiTenant`/`assistantContextEnabled`→`tenancy.`, `metricsEnabled`→`metrics.`, `geoEnabled`/`geoDbPath`/`provisioningCountry`/`forceNumberCountry`/`maxNumbers`/`maxNumbersPerTenant`/`provisioningEnabled`→`provisioning.`, `telnyxAssistant.*`→`telnyx.telnyxAssistant.*` (nested-in-nested), `paymentEnabled`/`numberSetupFeeCents`/`paymentCurrency`/`stripeCustomerRetryDelayMs`/`defaultTenantBudgetCents`→`billing.`.

**No-Edit (0 Code-Zugriff, geprueft):** `src/mcp-tools.js`, `src/routes/_validation.js`, `src/middleware.js`, `src/audit-store.js`, `src/queue/pg-boss.js`, `src/geo/maxmind.js`, `src/geo/resolve.js`.

**Transformationsregel (mechanisch):** identifier-genaues Ersetzen gemaess Tabelle; nur Zugriffspfad, kein Reflow ausser bei Zeilenlaenge; bei Mehrfach-Vorkommen pro Zeile die ganze Zeile ersetzen (kein globales `replace_all`).

### Elevated-Sensitivity / Invarianten-Spannung (bindend)

Vier in-Scope-Dateien enthalten Auth-/Money-nahe Zugriffe, die von PA-13/17 nicht erfasst wurden (PA-17 migrierte nur `auth.js`+`web-auth.js`; PA-13 nur `billing/*`+`onboarding`+`sms-summary`). Der bindende Gate „0 Flach-Zugriff in ganz src/" kann ohne sie nicht erfuellt werden → Aufloesung: einschliessen, aber mit PA-17-Sorgfalt (Zeile-fuer-Zeile-Review), `safeEqual`/fail-closed/Exemption-Reihenfolge/HMAC/Signatur bleiben byte-identisch:

- `src/wiring/auth-gate.js` — Basic-Auth (`dashboardPassword`); `safeEqual` + Exemption-Block unveraendert.
- `src/wiring/web-login.js` — OIDC/Session-Wiring; nur Wert-Quelle, keine Middleware-Verdrahtung geaendert.
- `src/self-service-routes.js` + `src/routes/api-billing.js` — Stripe-Money-Pfad; `PAYMENT_ENABLED`-Gate identisch.

Der Offenlegungssatz liegt in `claude.js`/`bridge.js` (PA-16, out of scope). Safety-Gates (`outboundFrozen`, `allowedCountryCodes`, `maxCallsPerHour`) werden in `boot.js` nur ausgegeben (Banner), nicht ausgewertet — Auswertung liegt in `outbound-gates.js` (PA-15), unangetastet.

### Tests — notwendige Fixture-Reshapes

Grund (PA-16-Muster): Tests mit hand-gerolltem flachem Fake-`config`, injiziert in ein migriertes DI-Modul, brechen (`config.<ns>` = `undefined` → `TypeError`). Fix = Fake ueber `withConfigNamespaces(...)` auf die Dual-Surface heben (Assertions unveraendert).

**Sicher, kein Reshape:** `geo-registry`/`queue-registry` (mutieren am echten Singleton), `l0-metrics` (uebergibt `enabled` explizit), Telnyx-Ingest-Tests (nutzen echten Singleton), `tenant-resolver-parity` (`{store}` → `config=defaultConfig`), sowie alle bereits `withConfigNamespaces`-nutzenden Suiten (bk2/bk5/self-service-mirror-hydration/billing-payment-gate/p5-onboarding-funnel/w4/i9).

**Breaker → Reshape (11 im Plan geplante Dateien):** `test/helpers.js` + `test/config-namespaces-helper.js` (`fakeTelnyxShimConfig` verlagert + gewrappt, `helpers.js` bleibt config.js-import-frei — Landmine `test-base-env-drift`), `test/telnyx-shim-harness.js` (`WATCHDOG_TEST_CONFIG`), `test/directive-synth.test.js` (`fakeConfig`), `test/auth-gate-exemption-order.test.js` (Hybrid-Fixture, **nicht** blind `withConfigNamespaces` — sonst wuerde der Getter-Overwrite literal-nested `tenancy` loeschen; gezielt `dashboardPassword`→`auth.dashboardPassword` nachstrukturiert), `test/api-read-parity.test.js`, `test/bk4-self-service-quota.test.js`, `test/f2-self-service-private-number.test.js`, `test/f2-self-service-state-private-number.test.js`, `test/telnyx-p5-origination.test.js`, `test/telnyx-p8-inbound.test.js`, `test/telnyx-stab-p9-watchdog.test.js`/`-k0-turn-seq.test.js` (nur Import-Umbiegung).

### Neue Datei (empfohlen, mit explizitem Fallback) — permanenter Struktur-Gate

`test/src-config-namespace.test.js` als Spiegel von `test/scripts-config-namespace.test.js` (PA-19-Praezedenz) wurde als **empfohlene** Option vorgeschlagen, mit explizit sanktioniertem Fallback: „Falls der Lead minimalen Scope bevorzugt: Fallback = der reine Shell-Grep-Gate ... ohne neue Testdatei" (siehe Deviations).

### Reihenfolge, Blast-Radius

Deps erfuellt (PA-13–17+19 gemergt). Working-tree-Kollision `src/mcp-server-info.js`/`test/mcp-server-icon.test.js` (uncommitted, nur Kommentar-Block) als irrelevant identifiziert und im Haupt-Working-Tree belassen — Worktree branchet sauber von master. Ein einziger `phase-impl-lean`-Lauf, kein Deploy, kein Push.

### Pre-Mortem (Kurzfassung)

| Risiko | Mitigation |
|---|---|
| Falscher Namespace-Blattname rutscht durch | `guardedConfig` wirft `TypeError` bei falschem Blatt; Struktur-Test/Voll-Suite fangen es; Mapping gegen `CONFIG_NAMESPACES` gegengeprueft |
| Auth fail-open durch `undefined` Secret | Zeile-fuer-Zeile-Review auth-gate/web-login; `auth-gate-exemption-order`/`single-origin-auth`/`oauth` gruen; `safeEqual` unberuehrt |
| Env-Drift-Katastrophe (110 Fails) | `fakeTelnyxShimConfig` verlagert, `helpers.js` bleibt config.js-frei; isolierte Suite verifiziert |
| Test gruen trotz kaputtem Wert | `withConfigNamespaces`/`attachNamespaces` sind Getter auf denselben Slot (PA-12-Invariante) |
| Nested-Group falsch geflacht | Explizit als `telnyx.telnyxAssistant.X`/`voice.elevenLabsPlayTts` gepinnt |

### Deterministische Abnahme (Plan-Vorgabe)

```bash
for f in <25 src-Dateien>; do node --check "$f"; done            # alle exit 0
git grep -nE 'config\.[a-zA-Z]' -- src/ | grep -v config.js | grep -vE '(safety|billing|provisioning|auth|llm|telnyx|voice|telephony|tenancy|server|store|metrics|privacy)' | grep -vE '(//|\*|/\*)'
npm test                                                          # 0 fail
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start & curl -s localhost:3999/healthz   # 200
```

**Definition of Done:** alle 25 src-Dateien namespaced; Struktur-Gate 0 Code-Flach-Zugriff in src/; Voll-Suite gruen; `/healthz=200`; keine Absolute Regel aufgeweicht; kein Deploy/Push; Flach-Alias bleibt fuer PA-20 aktiv.

---

## 2. Impl-Zusammenfassung

PA-18 (Migration Cluster E, Rest src) exakt gemaess Plan umgesetzt: alle 25 geplanten src-Dateien (`app.js`, `boot.js`, `geo/registry.js`, `llm.js`, `mcp-server-info.js`, `mcp-server.js`, `metrics.js`, `portal-pool.js`, `queue/registry.js`, `routes/_tenant.js`, `routes/api-billing.js`, `routes/api-calls.js`, `routes/api-onboard.js`, `routes/api-read.js`, `routes/mcp.js`, `self-service-routes.js`, `server.js`, `store.js`, `telnyx-call-control-ingest.js`, `telnyx-conversation-watchdog.js`, `telnyx-llm-shim.js`, `telnyx-origination.js`, `tts/directive-synth.js`, `wiring/auth-gate.js`, `wiring/web-login.js`) von flachem `config.<key>` auf `config.<namespace>.<key>` umgestellt, inkl. der Nested-in-nested-Faelle (`config.telnyx.telnyxAssistant.X`, `config.voice.elevenLabsPlayTts`).

**Struktur-Gate verifiziert:** 0 verbliebene `config.<flatKey>`-Code-Zugriffe in src/ (Kommentare/Import-Pfade/`config.js` selbst ausgenommen; Bracket-Zugriff und Destrukturierung explizit auf 0 geprueft).

**18 Test-Fixture-Dateien** wurden auf die Namespace-Dual-Surface gehoben:
- 14 aus dem Plan (§3 der 11 Punkte, teils mehrere Dateien je Punkt).
- **4 zusaetzliche, ausserhalb des Plans durch den verpflichtenden isolierten Vollsuite-Lauf entdeckte Breaker:** `test/graceful-shutdown.test.js` (`FAKE_CONFIG.shutdownDrainTimeoutMs`), `test/llm.test.js` (`llmConfig()`-Fixture mit allen 6 LLM-Feldern), `test/telnyx-p6-cap-callcontrol.test.js` (Quelltext-Marker-String zeigte auf den alten Flach-Pfad), `test/web-login-wiring.test.js` (`baseConfig`-Hybrid-Fixture mit mehreren neu-migrierten `wireWebLogin`-Feldern).

`fakeTelnyxShimConfig` wurde von `test/helpers.js` nach `test/config-namespaces-helper.js` verlagert (haelt `helpers.js` frei von einem `config.js`-Import, vermeidet den bekannten `test-base-env-drift`-Bug) und dort mit `withConfigNamespaces` gewrappt.

Keine Safety-/Auth-/Signatur-Logik veraendert (nur Wert-Quelle); Disclosure-Satz, Gates, `safeEqual`-Vergleiche byte-identisch. Kein Deploy, kein Push.

**Testergebnisse:** Voll-Suite **2420/2420 gruen** in zwei unabhaengigen isolierten Laeufen, `testFailCount: 0`.

**Boot-Smoke:** Server manuell gebootet (PORT=0, minimaler Env, `SKIP_TWILIO_SIGNATURE_CHECK=true`). Boot-Banner korrekt mit namespaced Werten (Voice-Engine: budget, Outbound: aktiv, Nummern-Gates: Land * | max 100 Calls/h). `GET /healthz` → 200, `GET /api/plans` → 200, `GET /api/state` → 200 mit gueltigem JSON, `POST /voice/incoming` → 200 mit korrekt gerendertem TwiML (Gather+Say+Redirect). Graceful Shutdown per SIGTERM sauber beendet.

**Dateien:**
- geaendert (25 src): `src/app.js`, `src/boot.js`, `src/geo/registry.js`, `src/llm.js`, `src/mcp-server-info.js`, `src/mcp-server.js`, `src/metrics.js`, `src/portal-pool.js`, `src/queue/registry.js`, `src/routes/_tenant.js`, `src/routes/api-billing.js`, `src/routes/api-calls.js`, `src/routes/api-onboard.js`, `src/routes/api-read.js`, `src/routes/mcp.js`, `src/self-service-routes.js`, `src/server.js`, `src/store.js`, `src/telnyx-call-control-ingest.js`, `src/telnyx-conversation-watchdog.js`, `src/telnyx-llm-shim.js`, `src/telnyx-origination.js`, `src/tts/directive-synth.js`, `src/wiring/auth-gate.js`, `src/wiring/web-login.js`
- geaendert (18 test): `test/api-read-parity.test.js`, `test/auth-gate-exemption-order.test.js`, `test/bk4-self-service-quota.test.js`, `test/config-namespaces-helper.js`, `test/directive-synth.test.js`, `test/f2-self-service-private-number.test.js`, `test/f2-self-service-state-private-number.test.js`, `test/graceful-shutdown.test.js`, `test/helpers.js`, `test/llm.test.js`, `test/telnyx-k0-turn-seq.test.js`, `test/telnyx-llm-shim.test.js`, `test/telnyx-p5-origination.test.js`, `test/telnyx-p6-cap-callcontrol.test.js`, `test/telnyx-p8-inbound.test.js`, `test/telnyx-shim-harness.js`, `test/telnyx-stab-p9-watchdog.test.js`, `test/web-login-wiring.test.js`
- neu angelegt: keine (`filesCreated: []` — die im Plan §4 empfohlene neue Struktur-Test-Datei wurde bewusst nicht angelegt, s. Deviations)

### Deviations (final)

1. **Kein neuer Struktur-Gate-Test.** Die im Plan §4 „empfohlene" Datei `test/src-config-namespace.test.js` wurde **nicht** angelegt. Der Plan sanktioniert explizit den Fallback („Falls der Lead minimalen Scope bevorzugt: Fallback = der reine Shell-Grep-Gate ... ohne neue Testdatei"). Begruendung: eine korrekte kuratierte src-Dateiliste (inkl. bewusster Ausschluesse wie `mcp-tools.js`/`ui/*` wegen lokaler `config`-Parameter) waere selbst eine nicht-triviale, fehleranfaellige Flaeche gewesen (falsch-negativ bei Unvollstaendigkeit, falsch-positiv bei Ueberdeckung) — Kosten/Nutzen fiel gegen eine neue Dauerinstitution aus. Stattdessen wurde der geforderte GREP-Gate (Definition-of-Done Punkt b) manuell verifiziert: 0 verbliebene `config.<flatKey>`-Code-Zugriffe in src/ (Bracket-Zugriff und Destrukturierung explizit gegengeprueft, beide leer).
2. **4 zusaetzliche Test-Breaker ausserhalb des Plans.** Plan-Abschnitt 3 listete 11 zu reshapende Testdateien (14 tatsaechliche Dateien inkl. Mehrfachnennungen). Der verpflichtende isolierte Vollsuite-Lauf deckte 4 weitere Breaker auf, die der Plan nicht erfasst hatte: `test/graceful-shutdown.test.js`, `test/llm.test.js`, `test/telnyx-p6-cap-callcontrol.test.js`, `test/web-login-wiring.test.js`. Alle vier identifiziert, gefixt und einzeln + im Vollsuite-Kontext gruen verifiziert — im Sinne der plan-eigenen Vorgabe „isolierte Voll-Suite laufen lassen ... bei Drift Fallback = Call-Site-Wrapping".

### Clean-Code-Selbstcheck (Impl)

Rein mechanische Zugriffspfad-Migration, keine Logikaenderung. Keine Duplizierung eingefuehrt (G5): `withConfigNamespaces` bleibt die EINE Wrap-Funktion, `fakeTelnyxShimConfig` dorthin verlagert statt dupliziert. Keine Magic Numbers/toter Code/auskommentierter Code eingefuehrt. Kommentare deutsch ohne Umlaute, konsistent mit Bestand. Funktionsgrenzen/Verschachtelungstiefe unveraendert. Bei Hybrid-Fixtures (`auth-gate-exemption-order.test.js`, `web-login-wiring.test.js`) bewusst **nicht** blind `withConfigNamespaces` verwendet, sondern gezielt nachstrukturiert (sonst haette der Getter-Overwrite literal-nested Vorwerte wie `tenancy`/`auth` stillschweigend geloescht — selbst im Plan als Risiko benannt). Keine neuen Verhaltens-Assertions noetig (reiner Refactor) — die 18 Testdatei-Aenderungen sind Fixture-Reshapes ohne Aenderung der Assertions selbst (bis auf einen aktualisierten Quelltext-Marker-String in `telnyx-p6-cap-callcontrol.test.js`, der den migrierten Code-Pfad widerspiegelt).

---

## 3. Safety-Urteil

**approved: true**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Blockers:** keine.

**Concerns (nicht blockierend):**

1. Erster Voll-Last-Lauf zeigte 1 transienten Fehler (`test/api-read-parity.test.js:228` „GET /api/calls/:id publicCall R3.1" → 401 statt 200). Dokumentierter ~12% Seed-vor-Boot-Parallel-Last-Flake, **keine** PA-18-Regression: die betroffene Route laeuft in einer nackten express-App ohne Auth-Middleware und kann strukturell gar kein 401 erzeugen; isoliert 10/10 (3x) gruen; sauberer Einzel-Voll-Lauf 2420/2420/0. Die Datei-Aenderung wickelt nur `makeConfig` in `withConfigNamespaces` (fuegt nicht-enumerable Getter hinzu) — kein Auth-Pfad.
2. `src/store.js` (Fassade) und die src-Wurzel `telnyx-*`-Dateien werden angefasst, obwohl „store"/„telephony-Rest" nominell frueheren Phasen zugeordnet sind. Konsistent: PA-16 migrierte `src/store/*` und `src/telephony/*`, liess diese Wurzel-Leftovers aber flach. Der bindende 0-Rest-Gate der Abschlussphase verlangt genau deren Migration; `src/store/*`/`src/telephony/*` selbst bleiben unberuehrt (per name-only bestaetigt). In-Scope ueber die Catch-all-Klausel „jede weitere src-Datei, die noch `config.<flatKey>` liest".

**Independent Test Summary:** Sauberer isolierter Voll-Suite-Lauf (`npm test`, beide Backends via eingebettetem pglite — 128 Testdateien referenzieren PGlite): 2420 tests, 2420 pass, 0 fail, 0 cancelled, EXIT=0. Zusaetzlich `test/api-read-parity.test.js` isoliert 3x: 10/10 pass. Ein frueherer Lauf hatte 2419/2420 (1x `api-read-parity` 401) = dokumentierter vorbestehender Parallel-Last-Flake, isoliert gruen, strukturell unmoeglich aus dem PA-18-Diff. Struktureller Grep-Gate: 0 ausfuehrbare flache `config.<flatKey>` in src/ ausser `config.js` (alle 48 Treffer sind Kommentare). `node_modules`-Symlink im Worktree war self-referentiell und musste vor den Testlaeufen auf den echten Pfad umgebogen werden.

**Verdict:** APPROVED. PA-18 ist eine reine, verhaltens-erhaltende config-Namespace-Migration der verbliebenen src-Importeure — EIN Commit auf master, nur Zugriffspfad, keine Logik. Alle 48 verwendeten (Namespace, Leaf)-Zuordnungen gegen `CONFIG_NAMESPACES` verifiziert, inkl. sicherheitskritischer: `dashboardPassword`→`auth` (Fail-closed-Basic-Auth erhalten, `safeEqual` unveraendert), `outboundFrozen`/`allowedCountryCodes`/`maxCallsPerHour`/`rateLimitPerMin`→`safety`, `sessionSecret`/`adminEmails`/`devLoginEnabled`→`auth`, `shimSharedSecret` via `telnyx.telnyxAssistant` (Empty-Secret-Trap unveraendert). Getter lesen denselben `rawConfig`-Slot → byte-identische Werte, Flach-Alias bleibt bis PA-20 aktiv. Safety-Gates (`outbound-gates.js`/`signature.js`/`numberGateError`), Offenlegung (`claude.js`+`bridge.js` unangetastet, `disclosureSentence` unveraendert), Auth-Pfade und Stripe-Webhook nicht angefasst. Keine neuen npm-Deps, keine Secret-Logs, kein Audio ueber MCP. Struktureller 0-Rest-Gate erfuellt. Kein Deploy/Push durchgefuehrt.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS — keine Blocker.** `blocker: false`.

PA-18 ist ein sauberer, rein mechanischer Migrations-Diff (letzte Migrationsphase, „Cluster E — Rest src"). Alle Namespace-Zuordnungen gegen `CONFIG_NAMESPACES` in `src/config.js` geprueft und zu 100% korrekt. Volle Testsuite selbst nachgefahren: 2420/2420 gruen, `node --check` auf allen 25 geaenderten src-Dateien fehlerfrei. Kein verbliebener flacher Code-Zugriff in src/ (nur unveraenderte Alt-Kommentare, ausserhalb des Diffs).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (Nebenbefund, nicht blockierend):**
  - `test/telnyx-shim-harness.js:144` — Kommentar „matcht `fakeTelnyxShimConfig()`-Default (helpers.js)." nennt den falschen Dateiort — dieselbe Datei importiert `fakeTelnyxShimConfig` 3 Zeilen weiter oben (Zeile 9, Teil dieses Diffs) bereits aus `./config-namespaces-helper.js`, nicht mehr aus `helpers.js`. Fix: Klammer-Referenz auf `(config-namespaces-helper.js)` aendern.
- **S4:** keine.

**passNotes:** Alle geprueften `config.<flatKey>`-Zugriffe in den 25 geaenderten src-Dateien exakt gegen die `CONFIG_NAMESPACES`-Deklaration verifiziert (z.B. `rateLimitPerMin`→`safety`, `dashboardPassword`/`sessionSecret`/`adminEmails`→`auth`, `publicUrl`/`webDistDir`/`publicDir`→`server`, `telnyxAssistant`→`telnyx`, `storeBackend`/`databaseUrl`/`queueBackend`→`store`, `retentionDays`→`privacy`, usw.) — keine einzige Fehlzuordnung gefunden. Der bestehende `guardedConfig`-Proxy (fail-fast `TypeError` bei falschem/verschobenem Key, G27) ist ein starkes strukturelles Sicherheitsnetz, das eine falsche Zuordnung sofort als Testfehler haette auffallen lassen — Vollsuite lief unabhaengig gruen (2420/2420, 0 fail), Commit-Behauptung damit bestaetigt. Testfixtures wurden lueckenlos im Gleichschritt migriert. Die Verschiebung von `fakeTelnyxShimConfig` nach `test/config-namespaces-helper.js` reduziert Duplizierung (EINE Quelle) statt welche einzufuehren und ist sauber mit dem `test-base-env-drift`-Wissen begruendet (Kommentar erklaert Warum, nicht nur Was). Keine Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen, keine SRP/DIP-Verstoesse — der Diff ist reine 1:1-Pfadumschreibung ohne neue Logik. Rest-Vorkommen von `config.<flatKey>` in src/ existieren ausschliesslich in unveraenderten Alt-Kommentaren (ausserhalb des Diff-Scopes) und sind funktional unschaedlich (dual-read bleibt gueltig).

**topTodos:**
1. Kommentar-Tippfehler in `test/telnyx-shim-harness.js:144` korrigieren (Dateireferenz „helpers.js" → „config-namespaces-helper.js") — kosmetisch, kein Blocker.

---

## 5. Fix-Runden

Keine. Der Clean-Code-Audit fand nur einen einzelnen S3-Nebenbefund (kosmetischer Kommentar-Fehler in `test/telnyx-shim-harness.js:144`) — kein S1/S2-Blocker, daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
