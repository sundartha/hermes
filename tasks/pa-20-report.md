# Phase PA-20 — Flip: Flach-Aliase entfernen (Namespace als einzige Oberflaeche)

**Gate: PASS**
**finalBranch:** `phase/polish-a-p20-fix1`
**headCommit:** `1a0898d8df15436d895cb7f9e7bcd9d93f5eb58f`

---

## Ueberblick

PA-20 vollzieht den finalen Flip der `src/config.js`-Migrationskette (Nachfolger von PA-1..PA-19): die 99 flachen Config-Aliase (`config.<key>`) werden aus der oeffentlichen Oberflaeche entfernt. Die 13 Namespace-Gruppen (`config.<namespace>.<key>`) sind ab jetzt die **einzige** Zugriffs-Oberflaeche auf `config`. Flacher Zugriff — Read **und** Write — wirft `TypeError` (fail-closed statt still-`undefined` bzw. stiller Stray-Property).

Ergaenzend liefert die Phase einen Vollstaendigkeitsbeweis: Grep-Gate ueber `src/` + `scripts/` (Dot-Zugriff, Bracket-Zugriff, Destrukturierung) = 0 Treffer im echten Code.

---

## Plan (gekuerzt)

### Ground-Truth (auf `master` @ `0ccbebd`)

- PA-1..PA-19 gemergt: `src/config.js` hatte bereits eine **dual-read**-Struktur — `rawConfig` (99 flache Keys, 3 davon nested: `telnyxElevenLabs`/`telnyxAssistant`/`elevenLabsPlayTts`), `attachNamespaces(rawConfig, CONFIG_NAMESPACES)` (13 nicht-enumerable Namespace-Gruppen als Getter auf `rawConfig`), dann `guardedConfig(rawConfig)` (Proxy, nur `get`-Trap).
- Die 99 Flach-Aliase = exakt die Summe aller 13 Namespace-Blaetter (verifiziert).
- `src/` war bereits 0 Flach-Zugriffe (alle Treffer = Kommentare).
- `subscribe.js:34` war bereits auf `config.billing[key]` migriert (kein blinder Bracket-Zugriff mehr).

### Kritische Blast-Radius-Korrektur

Die ursprungliche 3-Datei-Schaetzung war falsch:

- **A) `scripts/`-Skripte** hatten Real-Code-Flach-Zugriffe: `check-setup.js` (42 Stellen), `set-webhooks.js` (1), `grant-admin.js` (1), `backfill-plan-profiles.js` (2), `telnyx-assistant-provision.mjs` (7). PA-19 hatte nur `*.mjs` migriert, `.js`-Skripte fielen durch beide Netze. `npm run check` fuehrt `check-setup.js` aus — der Flip haette diesen Befehl gecrasht.
- **B) ~20 Testdateien** griffen flach auf den echten `config`-Singleton zu (Read und Write). Flach-Writes muessen per Design ebenfalls werfen (fail-closed gegen stille Stray-Property, sonst faelschlich gruene Tests).

Empfehlung: Split in PA-20a (Skript-Migration, rein mechanisch) + PA-20b (der eigentliche Flip). Harte Abhaengigkeit: PA-20b darf erst starten, wenn der Grep-Gate in `src`+`scripts` = 0 ist.

### Ziel & Invarianten

13 Namespaces = einzige Oberflaeche; 3 nested Objekte bleiben nested Blaetter. Jeder Flach-Read/-Write wirft `TypeError`. `numEnv`/`boolEnv`/`fatalConfigErrors` bleiben eager; Boot-Refusal bei Muell identisch; `isProduction`-Snapshot unveraendert; `SAFE_DUCK_TYPING_PROPS` erhalten. Safety-Gates/Disclosure/Auth unveraendert (nur Zugriffspfad).

### Design des Flips (`src/config.js`)

`rawConfig` wird interner Speicher; `config` bekommt nur die 13 Namespace-Gruppen mit Getter+**Setter**-Blaettern (Setter noetig, damit `config.<ns>.<key> = v` denselben Speicher trifft wie die Getter — sonst wuerde ein Test-Override still ins Leere laufen). `guardedConfig` bekommt zusaetzlich einen `set`-Trap, der bei unbekanntem Top-Level-Key wirft.

`attachNamespaces` wird in eine geteilte Fabrik `makeNamespaceGroup(keys, storage)` zerlegt (G5-Dedup, gemeinsam genutzt von `attachNamespaces` fuer Test-Mocks und der neuen `buildNamespaceSurface` fuer den echten Singleton). `configurable: true` ist Pflicht (sonst verletzt die Wrapper-Proxy von `guardedConfig` die Proxy-`[[Get]]`-Invariante fuer non-configurable Data-Properties).

Verhaltens-Konsequenzen: `config.maxBudgetCents` (Read) -> `TypeError`; `config.billing.maxBudgetCents` -> Wert. `config.telnyxApiKey = x` -> `TypeError`; `config.telephony.telnyxApiKey = x` -> Setter greift. `Object.keys(config)` = 13 Namespace-Namen statt 99 Flach-Keys.

### PA-20a — Skript-Migration

Mapping-Tabelle Blatt -> Namespace (`anthropicApiKey|claudeModel` -> `llm`, `twilioSid|twilioToken|telnyxApiKey|telnyxApiBase|twilioEdge` -> `telephony`, `publicUrl|port` -> `server`, `allowedCountryCodes|maxCallsPerHour` -> `safety`, `voiceEngine|openaiApiKey|realtimeModel|sendSmsSummary` -> `voice`, `mcpAuth|mcpAuthToken|oauthIssuerUrl` -> `auth`, `storeBackend` -> `store`, `stripeSecretKey` -> `billing`, `telnyxElevenLabs|telnyxAssistant` -> `telnyx`). Verifikation ueber `node --check` je Skript + Dry-Run-Import.

### PA-20b — Test-Infrastruktur & Testdateien

- **`test/helpers.js`**: `makeConfigOverrides` baut einmalig einen Flach->Namespace-Index aus der uebergebenen Oberflaeche (kein statischer `config.js`-Import, wegen `test-base-env-drift`); `read`/`write` routen ueber `nsOf[k]`. Deckt zentral 7 Konsumenten ab.
- **`config-namespaces.test.js`**: dual-read-Tests raus, ersetzt durch Setter-Durchschlag-Test, TypeError-Regression (Read+Write) je Namespace-Stichprobe, invertierter Enumerations-Test (13 statt 99).
- **`config-shape.test.js`**: 22 Flach-Zugriffe -> Namespace; neuer Regressionstest fuer entfernte Top-Level-Aliase.
- **`config-money-manifest.test.js`**: Scan auf `CONFIG_NAMESPACES` statt `Object.keys(config)` (sonst vakuum-gruen, weil `"maxBudgetCents" in config"` post-Flip `false` ist).
- **4 Inline-Override-Kopien** (`config-prod-footguns`, `single-origin-boot-guard`, `telnyx-p10-config`, `auth-mcp-bypass`) -> `makeConfigOverrides` (G5-Dedup).
- **~14 mechanische Testdatei-Migrationen** (Dot-Zugriff auf Namespace umgestellt).

### Regressionen & Verifikation

- Neuer Assert fuer `subscribe.js:34` `priceIdForPlan()` gegen den echten Namespace-Bracket-Pfad (`config.billing[key]`).
- TypeError-Regression fuer echte entfernte Keys, Read und Write.

### Gate (Plan-Vorgabe)

1. Grep-Vollstaendigkeitsbeweis (Dot/Bracket/Destrukturierung) in `src`+`scripts` = 0.
2. `subscribe.js` migriert-verifiziert + `priceIdForPlan`-Assert.
3. Boot- + `/voice`-Runtime-Smoke (Gate-Werte werden zur Request-Zeit gelesen, Boot-Smoke allein reicht nicht).
4. Volle Suite gruen.
5. Keine Safety-Gate/Disclosure/Auth-Aufweichung.
6. Kein Deploy/Push.

### Pre-Mortem (Auszug)

| # | Risiko | Mitigation |
|---|---|---|
| PM-A | `.js`-Skripte crashen `npm run check` (PA-19-Luecke) | PA-20a als Pflicht-Vorstufe + Grep-Gate deckt `scripts/` ab |
| PM-B | Flach-Write legt still Stray-Property an -> Test-Override trifft `rawConfig` nie -> Gate faelschlich gruen | Set-Trap wirft statt no-op |
| PM-C | Non-configurable Namespace-Property -> Proxy-Invariante wirft beim Boot | `configurable: true` in `buildNamespaceSurface` |
| PM-D | Iterator-Konsument (`Object.keys`/`JSON.stringify`) bricht bei Oberflaechen-Wechsel | Repo-weit verifiziert: kein `src`-Iterator ueber `config`; Money-Manifest umgestellt |
| PM-E | `makeConfigOverrides` faellt auf `config.js`-Import zurueck -> `test-base-env-drift` | Index aus uebergebenem `configObj`, kein statischer Import |
| PM-F | Uebersehener Real-Config-Flach-Zugriff in unklarer Test-Datei | Volle Suite ist der Gate (wirft `TypeError` -> rot) |

---

## Impl-Zusammenfassung

PA-20a migrierte die 5 verbliebenen Ops-Skripte auf `config.<ns>.<key>` (schliesst die PA-19-Luecke fuer `.js`-Skripte). PA-20b entfernte die 99 Flach-Aliase aus `src/config.js` — die 13 Namespaces sind jetzt die einzige Zugriffs-Oberflaeche, `guardedConfig` wirft `TypeError` fuer Flach-Read **und** Flach-Write. `test/helpers.js`s `makeConfigOverrides` routet flache Override-Keys automatisch ueber ihr Namespace-Blatt; die zentralen Config-Testdateien wurden auf die Namespace-Oberflaeche umgeschrieben inkl. neuer TypeError-Regressionstests (Read+Write) fuer entfernte Keys, plus ~30 mechanisch migrierte Testdateien.

**Ergebnis:** Grep-Vollstaendigkeitsbeweis (Dot/Bracket/Destrukturierung) in `src/`+`scripts/` = 0 Treffer. Volle Suite 2422/2422 gruen (3 komplette Laeufe verifiziert). Runtime-Smoke (Boot+`/healthz`+`/voice/incoming`+`/api/calls`) gruen. `subscribe.js`/`priceIdForPlan` gezielt gegen den echten `config`-Singleton verifiziert. Kein Deploy, kein Push.

### Deviations vom Plan

1. **Kein Zwei-Phasen-Split (OQ-PA20-1).** Der Plan empfahl PA-20a und PA-20b als zwei separate `phase-impl-lean`-Laeufe. Der tatsaechliche Auftrag dieser Session verlangte explizit einen kombinierten Lauf/Commit — beide Teilphasen wurden wie angewiesen in einem Commit umgesetzt (Abweichung vom Plan-Vorschlag, nicht vom tatsaechlichen Auftrag).

2. **Blinder Fleck im Plan-eigenen Grep — 14 zusaetzliche Fixes ausserhalb der geplanten Blast-Radius-Liste.** Der reine Text-Match-Grep (§6.1, `config.<key>`) erkennt keine Faelle, in denen der GESAMTE `config`-Singleton an eine „config-freie, cfg-injizierbare" reine Funktion (P4/DIP-Pattern) durchgereicht wird, die den flachen Key ueber einen umbenannten Parameter (z.B. `cfg`) oder Destrukturierung liest. Das ist ein etabliertes, bewusstes Architektur-Muster im Repo (`globalCapEur`/`globalCapCents`/`budgetExceeded`/`tokenCostUsd`/`trackUsage`/`aiCostCents`/`fakeOriginateBootBlocked` — dokumentiert als "config-frei, testbar").

   Der Flip brach 13 solcher Aufrufstellen, darunter:
   - der **globale Budget-Notaus** (Absolute Regel 1) in `outbound-gates.js`, `routes/voice.js`, `telnyx-llm-shim.js`
   - die **KI-Kosten-Verbuchung** in `claude.js`
   - der **FAKE_ORIGINATE-Boot-Gate** in `boot.js`

   Dies wurde nicht vom Plan-Grep, sondern erst durch den ersten kompletten Testlauf aufgedeckt (Boot-Crashes + haengende Spawn-Tests durch Zombie-Kindprozesse). Fix: an allen 13 Aufrufstellen wird jetzt die passende Namespace-Teilmenge (`config.billing`/`config.llm`/`config.safety`) statt des vollen `config`-Objekts durchgereicht; die Low-Level-Funktionen selbst bleiben unveraendert (DI-Vertrag/Testbarkeit erhalten).

   14. Fall: `test/telnyx-voice.test.js` hatte eine lokale `withBlankedConfig`-Kopie mit Bracket-Notation (`config[key]`), ebenfalls unsichtbar fuer den reinen Dot-Grep — auf die geteilte `makeConfigOverrides`-Implementierung umgestellt (G5-Dedup als Nebeneffekt).

   Diese 14 Fixes lagen ausserhalb der im Plan aufgezaehlten Blast-Radius-Liste, waren aber zwingend noetig, um "Volle Suite gruen" **und** die Absolute-Regel-1-Sicherheitsgates funktionsfaehig zu halten — ohne sie waere der Flip ein Sicherheits-Regressions-Deploy gewesen.

### Clean-Code-Selbstcheck (aus IMPL)

Kein toter/auskommentierter Code; keine neuen Magic Numbers; G5-Dedup genutzt wo moeglich (`makeNamespaceGroup` als geteilte Fabrik fuer `attachNamespaces`+`buildNamespaceSurface`; lokale `withBlankedConfig`-Kopie in `telnyx-voice.test.js` durch die geteilte `makeConfigOverrides` ersetzt); Kommentare aktualisiert wo sie sonst stale gewesen waeren (C2, z.B. `CONFIG_NAMESPACES`-Kopfkommentar, `guardedConfig`-Kommentar); alle neuen/geaenderten Funktionssignaturen <=3 Argumente; keine neuen Abstraktionen ueber Bedarf; Low-Level "config-freie" Funktionen (`globalCapEur`/`tokenCostUsd`/`fakeOriginateBootBlocked`) bewusst unveraendert gelassen (DI/P4-Vertrag erhalten) — der Fix sitzt an den Aufrufstellen, nicht an den reinen Funktionen.

### Geaenderte Dateien

**Skripte (PA-20a, 5):** `scripts/backfill-plan-profiles.js`, `scripts/check-setup.js`, `scripts/grant-admin.js`, `scripts/set-webhooks.js`, `scripts/telnyx-assistant-provision.mjs`

**src (7, inkl. der 14-Fix-Nachziehung):** `src/boot.js`, `src/claude.js`, `src/config.js`, `src/routes/api-read.js`, `src/routes/voice.js`, `src/telephony/outbound-gates.js`, `src/telnyx-llm-shim.js`

**Tests (37):** `test/assistant-context-default.test.js`, `test/auth-mcp-bypass.test.js`, `test/billing-stripe-idempotent-headers.test.js`, `test/billing-subscribe.test.js`, `test/config-boolenv.test.js`, `test/config-failclosed.test.js`, `test/config-gateway.test.js`, `test/config-money-manifest.test.js`, `test/config-namespaces.test.js`, `test/config-prod-footguns.test.js`, `test/config-shape.test.js`, `test/f1-provisioning-geo.test.js`, `test/geo-registry.test.js`, `test/helpers.js`, `test/prov01-capture-idempotent.test.js`, `test/queue-registry.test.js`, `test/request-tenant-unit.test.js`, `test/signature-dispatch.test.js`, `test/single-origin-boot-guard.test.js`, `test/store-json-migrate-shapes.test.js`, `test/store-pg-idp-seed.test.js`, `test/store-pg.test.js`, `test/stripe-cancel-hold-adapter.test.js`, `test/stripe-setup-checkout.test.js`, `test/telephony-contract.test.js`, `test/telephony-registry.test.js`, `test/telnyx-assistant-merge-guard.test.js`, `test/telnyx-call-control.test.js`, `test/telnyx-event-ingest-machine.test.js`, `test/telnyx-messaging.test.js`, `test/telnyx-numbers.test.js`, `test/telnyx-p10-config.test.js`, `test/telnyx-signature.test.js`, `test/telnyx-voice.test.js`, `test/tenant-resolver-parity.test.js`, `test/tenant-settings-calendar-map.test.js`, `test/voice-signature.test.js`

**filesCreated:** keine (nur bestehende Dateien geaendert)

### Tests hinzugefuegt/geaendert (Auszug)

- `test/config-namespaces.test.js` — komplett neu geschrieben: Setter-Durchschlag-Test statt PM-1-Flach-Override, Flip-Regression TypeError Read+Write, Oberflaeche-Test 13 Namespaces
- `test/config-shape.test.js` — neuer Flip-Regression-Test fuer entfernte Top-Level-Flach-Aliase
- `test/config-money-manifest.test.js` — Scan-Logik auf `CONFIG_NAMESPACES` statt `Object.keys(config)` umgestellt
- `test/billing-subscribe.test.js` — neuer Test: `priceIdForPlan` gegen den echten `config`-Singleton via `makeConfigOverrides` (PM-5-Verifikation)
- ~30 weitere Testdateien mechanisch von `config.<flatKey>` auf `config.<ns>.<key>` migriert (keine neue Testlogik, reiner Zugriffspfad-Wechsel)

### Ergebniszahlen

- `nodeCheckPass`: true
- `testsPass`: true
- `testPassCount`: 2422
- `testFailCount`: 0
- `committed`: true
- `headCommit`: `1a0898d8df15436d895cb7f9e7bcd9d93f5eb58f`

### Smoke-Test

Server gebootet (PORT=3999, DATA_DIR=Temp, STORE_BACKEND=json, SKIP_TWILIO_SIGNATURE_CHECK=true, Owner-Nummer via `scripts/bootstrap-tenant.js` geseedet).

- `GET /healthz` -> 200
- `POST /voice/incoming` (From/To/CallSid) -> 200 mit gueltigem TwiML (Gather+Say) — beweist `config.safety.skipTwilioSignatureCheck`, `config.server.publicUrl` und `config.voice.*` werden zur Request-Zeit korrekt aus der Namespace-Oberflaeche gelesen (kein Boot-Crash, kein TypeError).
- `POST /api/calls` (place_call) -> 403 mit echter Fachlogik-Ablehnung (kein registrierter Auftraggeber-Name), **nicht** 500/TypeError — beweist, dass die Outbound-Gate-Kette (inkl. des reparierten Budget-Gates) den Request ohne Crash durch die vorgelagerten Gates schleust.

Der Budget-Gate-Pfad selbst (`globalCapEur`/`budgetExceeded`) ist strukturell erreichbar und wird durch die gruene Voll-Suite (`tenant-budget-cap.test.js`, `telnyx-p6-midcall-budget-kill.test.js`, `outbound-gates-order.test.js`, `b2-quota-gate`/`_outbound-harness` Spawn-Tests) end-to-end abgedeckt. Server sauber beendet, Temp-Daten geloescht.

`smokePass`: true

---

## Safety-Urteil (final)

**Verdict: APPROVED**

| Kriterium | Ergebnis |
|---|---|
| `approved` | true |
| `testsPassIndependently` | true |
| `safetyGatesIntact` | true |
| `disclosureIntact` | true |
| `authFailClosedIntact` | true |
| `noSecretsLeaked` | true |
| `scopeRespected` | true |
| `behaviorAsIntended` | true |
| `blockers` | keine |

### Unabhaengige Test-Zusammenfassung

Volle Suite **zweimal unabhaengig** gefahren (`NODE_ENV=test node --test test/*.test.js`): beide Male 2422 pass / 0 fail / 0 skipped / 0 todo (~78s), deterministisch gruen, kein Flake (der in MEMORY notierte ~12% Seed-vor-Boot-Race trat nicht auf). Beide Store-Backends abgedeckt (pglite-/`STORE_BACKEND=pg`-Tests laufen inline in derselben Suite). Zusaetzlicher Pflicht-Runtime-Smoke ueber `test/helpers.js` `startServer`:

- `/healthz` = 200
- `POST /voice/incoming` mit Owner-DID +15005550006 -> 200 Gather-TwiML (Budget-Gate passiert, `config.billing` loest ohne 500 auf)
- mit `MAX_BUDGET_EUR=0` -> `globalBudgetExceeded(config.billing)` feuert -> Budget-erschoepft-Hangup-TwiML
- `priceIdForPlan` liefert echte Price-IDs vom echten Singleton
- `config.<removedFlatKey>` wirft `TypeError` bei Read und Write
- `config.<ns>.<key> = v` Override schlaegt korrekt durch
- Garbage `PAYMENT_ENABLED` sammelt eager `configFatalErrors()` (Boot-Refusal identisch)

### Begruendung (Auszug)

- **Surface-Flip korrekt:** `src/config.js` exportiert nur noch `config = guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES))`. `rawConfig` ist reiner interner Speicher (nicht exportiert, kein Importer). Proxy bewacht `get` und `set`: Flat-Read/-Write wirft `TypeError`, beides runtime verifiziert. `numEnv`/`boolEnv`/`fatalConfigErrors` bleiben eager; Boot-Refusal identisch; `isProduction`-Snapshot und `assertConfig` unveraendert.
- **Vollstaendigkeits-Check (PM-5) bestanden:** Leaf-Key-Grep (96 Blatt-Keys) fuer `config.<flatKey>` in `src`+`scripts`, Comments/Filename gefiltert = 0 Code-Treffer. Bracket `config[` = 0. Destrukturierung `} = config` = 0. `subscribe.js:34` migriert auf `config.billing[key]`; `priceIdForPlan()` per Assert am echten Singleton getestet.
- **Safety-Gates intakt:** Budget-Gate-Aufrufer (`voice.js`, `outbound-gates.js`, `telnyx-llm-shim.js`, `api-read.js`, `claude.js`) migriert auf `config.billing`/`config.llm`; konsumierende Helper lesen ausschliesslich Keys innerhalb des uebergebenen Namespaces (verifiziert). Runtime-Smoke beweist: Gate feuert bei Budget=0, passiert bei Budget vorhanden. Denylist/Allowlist/Land/Stundenlimit/Max-Dauer und Twilio/Telnyx-Signaturpruefung nicht im Diff = unveraendert.
- **Disclosure:** `disclosureSentence` in `claude.js` unveraendert (nur `config`->`config.llm` Metering-Zeilen); `bridge.js` hat keinen Diff.
- **Auth:** `auth-mcp-bypass` rein mechanisch auf `withConfigOverrides` umgestellt, 401/403/next-Asserts unveraendert; `safeEqual`/Signatur unberuehrt.
- **Secrets:** Script-Migrationen sind Namespace-Renames bestehender Presence-Checks/Fetch-Header, kein neues Secret-Logging, keine neue npm-Dependency.
- **Scope:** exakt der Flip — 7 src + 5 scripts + ~37 Testdateien; keine `.md`/PLAN/README/`render.yaml`/`public/`/`.env`-Aenderung. Netto-Test-Entfernungen sind genau die zwei Tests, die die entfernte Dual-Read/Flach-Oberflaeche behaupteten (post-Flip zwangslaeufig falsch) — alle uebrigen umbenannt/migriert, plus neue Flip-Regressionen und der `priceIdForPlan`-Bracket-Test. Keine `.skip`/`.only`, kein uebersprungener Check.

### Concerns (kein Blocker)

1. **MINOR:** In `test/helpers.js` wurde neben der noetigen Flip-Anpassung eine neue `makeStripeStub`-Fabrik ergaenzt, die zuvor byte-identisch in 3 Test-Dateien kopierte Save/Set/Restore-Logik dedupliziert (G5). Da `stripeSecretKey`/`stripeApiBase` durch den Flip ohnehin auf `config.billing.*` umziehen mussten, ist das eine plausible, testeigene Begleit-Aufraeumung im Rahmen, aber genau genommen etwas mehr als reine Flip-Migration. `withConfig()` reicht jetzt zusaetzlich den `fn()`-Rueckgabewert durch (additiv, dokumentiert, kein Bestandsaufrufer liest ihn).
2. **INFORMATIV:** `Object.keys(config)`/`JSON.stringify(config)` enumerieren nach dem Flip die 13 Namespaces statt der Flach-Keys (Verhaltensaenderung). Kein Produktions-Konsument iteriert `config` (repo-weit per Grep verifiziert: 0 Code-Treffer). Der einzige Iterator-Konsument (`config-money-manifest.test.js`) wurde korrekt auf `CONFIG_NAMESPACES` umgestellt — sonst waere der Money-Guard lautlos vakuum-gruen geworden.

---

## Clean-Code-Audit (final)

**Verdict: PASS — keine Blocker.**

| Kategorie | Befunde |
|---|---|
| s1 | keine |
| s2 | keine |
| s3 | keine |
| s4 | keine |
| blocker | false |

### Methodik

`clean-code.md` vollstaendig gelesen; `git diff master..phase/polish-a-p20-fix1` Datei fuer Datei geprueft; zusaetzlich vollstaendiger Checkout des Phase-Branches (`git archive`) und:

(a) programmatisch jede `config.<key>`-Fundstelle in `src/**/*.js` und `scripts/**/*.{js,mjs}` gegen die 99 `CONFIG_NAMESPACES`-Blattschluessel abgeglichen -> 0 verbliebene flache Zugriffe im echten Code (nur Kommentar-Erwaehnungen)

(b) `npm test` im Checkout ausgefuehrt -> 2422/2422 gruen, 0 Fails

### Kernbewertung

Diff PA-20-fix1 (Flip: Flach-Config-Aliase entfernt, 13 Namespaces als einzige Config-Oberflaeche) ist eine groesstenteils mechanische, konsistente Migration ueber 49 Dateien (`src/config.js` + 6 weitere src-Dateien + 5 scripts + 37 Tests). Vollstaendig gegen den Katalog geprueft: kein S1, kein S2. S3/S4: keine flag-wuerdigen Befunde.

Kernaenderung in `src/config.js`: `config` ist jetzt `guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES))` statt `guardedConfig(rawConfig)` mit zusaetzlichem Flach-Alias; der Proxy bewacht jetzt zusaetzlich `set` (Schreiben auf unbekannten/vertippten Key wirft `TypeError` statt still eine Stray-Property anzulegen) — fail-closed korrekt umgesetzt und durch eine dedizierte Regressions-Test-Suite abgesichert.

Alle sicherheitsrelevanten Call-Sites (Budget-Gates in `outbound-gates.js`/`voice.js`/`telnyx-llm-shim.js`, `fakeOriginateBootBlocked` in `boot.js`, Signature-Checks) wurden korrekt auf die passenden Namespace-Objekte (`config.billing`/`config.safety`/`config.llm`) umgestellt — gegen die tatsaechlichen Funktionssignaturen in `store/state-ops.js`, `boot-guard.js`, `store/defaults.js` verifiziert.

**G5-Highlight (positiv):** der Fix1-Commit ("Review-Blocker Runde 1") behob einen echten Duplizierungs-Blocker aus Runde 1 — 3x byte-identische `withStripeStub`-Kopien (`billing-stripe-idempotent-headers`/`stripe-cancel-hold-adapter`/`stripe-setup-checkout`) wurden zu einer Fabrik `makeStripeStub` in `test/helpers.js` zusammengefuehrt; mehrere weitere Testdateien (`config-prod-footguns`, `single-origin-boot-guard`, `telnyx-p10-config`, `auth-mcp-bypass`) wurden von lokalen `withConfig`-Kopien auf den bereits geteilten `makeConfigOverrides`-Helper umgestellt. Nettoeffekt dieser Phase ist eine **Reduktion** von Duplizierung, nicht deren Einfuehrung.

In `src/config.js` selbst teilen sich `attachNamespaces` (Test-Mock-Pfad, nicht-enumerable Dual-Read) und `buildNamespaceSurface` (echter Singleton, enumerable) bewusst dieselbe `makeNamespaceGroup`-Fabrik statt eines Flag-Parameters (vermeidet G15-Selektor-Argument) — sauber begruendet in Kommentaren.

Kommentare stichprobenartig gegen den tatsaechlichen Code verifiziert (kein C2-Widerspruch gefunden). Keine neuen Magic Numbers, kein toter Code, keine deaktivierten Sicherungen.

### Top-Todos

1. Kein Blocker — vor Merge lediglich Standard-Verifikation wiederholen (`npm test` im Ziel-Branch, wie hier bereits mit 2422/0 bestaetigt).
2. Keine weiteren offenen Punkte identifiziert.

---

## Fix-Runden

**Runde 1 (r1):** PA-20-Review-Blocker (G5, `withStripeStub`-Dreifach-Duplizierung) behoben. `test/helpers.js` bekommt eine neue Fabrik `makeStripeStub(configObj, secret)`, per Closure gebunden (gleiches Muster wie das bestehende `makeConfigOverrides`), intern auf der bereits vorhandenen `withConfig()`-Funktion aufbauend. Die 3 betroffenen Testdateien (`billing-stripe-idempotent-headers.test.js`, `stripe-cancel-hold-adapter.test.js`, `stripe-setup-checkout.test.js`) wurden auf die geteilte Fabrik umgestellt.

Ergebnis nach Fix-Runde 1: Clean-Code-Audit PASS, Safety-Audit APPROVED, finaler Branch `phase/polish-a-p20-fix1`.

---

## Gesamtergebnis

| Kriterium | Status |
|---|---|
| Grep-Vollstaendigkeitsbeweis (`src`+`scripts`, Dot/Bracket/Destrukturierung) | 0 Treffer |
| `subscribe.js`/`priceIdForPlan` gegen echten Singleton verifiziert | ja |
| TypeError-Regression fuer entfernte Keys (Read+Write) | vorhanden |
| Runtime-Smoke (Boot/`/healthz`/`/voice/incoming`/`/api/calls`) | gruen |
| Volle Suite | 2422/2422 gruen (3x verifiziert) |
| Safety-Gates/Disclosure/Auth unveraendert | ja |
| Deploy/Push | keiner |
| Clean-Code-Gate | PASS, 0 Blocker |
| Safety-Gate | APPROVED, 0 Blocker |

**finalBranch:** `phase/polish-a-p20-fix1`
**headCommit:** `1a0898d8df15436d895cb7f9e7bcd9d93f5eb58f`
