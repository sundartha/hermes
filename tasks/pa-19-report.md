# Phase PA-19 — Detailbericht

**Titel:** Migration Cluster F: `scripts/*.mjs`
**Gate-Ergebnis:** PASS
**Final-Branch:** `phase/polish-a-p19-fix2`

---

## 1. Ausgangslage / Grounding

Verifiziert gegen `master` @ `e9deefe` (code-gruendlich, nicht geraten):

- **PA-12 ist bereits auf `master`**: `CONFIG_NAMESPACES` (13 Namespaces, `Object.freeze`), `attachNamespaces`, `guardedConfig` existieren in `src/config.js`. Blaetter sind Getter auf denselben `rawConfig`-Speicherort; `config.<ns>.<leaf>` funktioniert bereits parallel zum Flach-Alias. PA-19 ist damit lauffaehig (Dependency PA-12 erfuellt), unabhaengig von allen anderen Clustern.
- **Empirisch bestaetigt**: alle 10 Ziel-Pfade sind in `CONFIG_NAMESPACES`, loesen auf, sind identisch zum Flach-Alias (Getter-Delegation); ein falscher Namespace (`config.telephony.openaiApiKey`) wirft `TypeError` — genau das ist der Tripwire dieser Phase.
- **Exakt 4** `.mjs`-Dateien unter `scripts/` greifen im Code (nicht nur im Kommentar) auf `config` zu: `scripts/telnyx-ws-echo.mjs`, `scripts/telnyx-call-latency.mjs`, `scripts/smoke-stripe-payment.mjs`, `scripts/telnyx-assistant-provision.mjs`.
- Kein Bracket-/Destrukturierungs-Zugriff (`config[...]`, `} = config`) irgendwo in `scripts/`.
- Kommentar-Treffer, die NICHT migriert werden (kein Code-Zugriff): `scripts/convo-bench/judge.mjs:6` (`output_config.format` in Prosa), `scripts/convo-bench/texml.mjs:22-23` (Prosa ueber `server.js`), `scripts/telnyx-assistant-provision.mjs:175` (`// config.claudeModel`), diverse `config.js`-Importpfad-Erwaehnungen.

---

## 2. Plan (gekuerzt)

### 2.1 Namespace-Mapping (aus `CONFIG_NAMESPACES`, 1:1)

| Flat-Key (vorher) | Ziel-Pfad (PA-19) | Namespace-Begruendung |
|---|---|---|
| `config.telnyxApiKey` | `config.telephony.telnyxApiKey` | telephony |
| `config.telnyxApiBase` | `config.telephony.telnyxApiBase` | telephony |
| `config.telnyxConnectionId` | `config.telephony.telnyxConnectionId` | telephony |
| `config.openaiApiKey` | `config.voice.openaiApiKey` | **voice** (nicht telephony — haeufigster Fehlgriff) |
| `config.publicUrl` | `config.server.publicUrl` | server |
| `config.stripeSecretKey` | `config.billing.stripeSecretKey` | billing |
| `config.stripeApiBase` | `config.billing.stripeApiBase` | billing |
| `config.paymentCurrency` | `config.billing.paymentCurrency` | billing |
| `config.provisioningCountry` | `config.provisioning.provisioningCountry` | provisioning |
| `config.claudeModel` | `config.llm.claudeModel` | llm |

Unveraendert belassen (bereits verschachtelte Gruppen, OQ-6 offen): `config.telnyxElevenLabs.*`, `config.telnyxAssistant.*`, `config.elevenLabsPlayTts.*`.

### 2.2 Neuer Ausfuehrungs-Gate

Neue Testdatei `test/scripts-config-namespace.test.js` — strukturell + ausfuehrungs-verifiziert. Begruendung: die Ops-Skripte laufen nicht unter `npm test`; ihre config-Zugriffe stehen bei 3 der 4 Skripte hinter einem fail-closed-Gate + Netz-Call, sind also per CLI-Dry-Run nicht vollstaendig erreichbar. Der Test fuehrt jeden migrierten Zugriff gegen die echte `guardedConfig` aus (falsches Blatt/Namespace -> `TypeError`), schliesst so die npm-test-Luecke dauerhaft und sichert PA-20 (Alias-Flip) ab. Reine Neuanlage — keine Bestandstest-Aenderung.

Kernmechanik: Regex extrahiert `config.<a>.<b>`-Zugriffe aus kommentarbereinigtem Quelltext; nested Groups (`telnyxElevenLabs`/`telnyxAssistant`/`elevenLabsPlayTts`) werden gesondert behandelt (kein Namespacing gefordert), alle anderen muessen auf einen gueltigen `CONFIG_NAMESPACES`-Eintrag zeigen und werden per `assert.doesNotThrow(() => config[ns][leaf])` scharf gegen die echte `guardedConfig` gepresst.

Keine neue Env-Var -> kein `test/helpers.js`-`BASE_ENV`-Nachzug noetig.

### 2.3 Exakte Edits pro Datei (Vorher -> Nachher)

**`scripts/telnyx-ws-echo.mjs`**
- `config.telnyxConnectionId` -> `config.telephony.telnyxConnectionId`
- `config.openaiApiKey` -> `config.voice.openaiApiKey`
- `config.publicUrl` -> `config.server.publicUrl`

**`scripts/telnyx-call-latency.mjs`**
- `config.telnyxApiKey` -> `config.telephony.telnyxApiKey` (2 Stellen inkl. Fail-closed-Check)
- `config.telnyxApiBase` -> `config.telephony.telnyxApiBase`

**`scripts/smoke-stripe-payment.mjs`**
- `config.stripeSecretKey` -> `config.billing.stripeSecretKey` (2 Stellen)
- `config.stripeApiBase` -> `config.billing.stripeApiBase` (2 Stellen)
- `config.provisioningCountry` -> `config.provisioning.provisioningCountry`
- `config.paymentCurrency` -> `config.billing.paymentCurrency` (2 Stellen)

**`scripts/telnyx-assistant-provision.mjs`**
- `config.telnyxApiKey` -> `config.telephony.telnyxApiKey` (2 Stellen)
- `config.publicUrl` -> `config.server.publicUrl` (2 Stellen)
- `config.telnyxApiBase` -> `config.telephony.telnyxApiBase` (2 Stellen)
- `config.claudeModel` -> `config.llm.claudeModel`
- Nicht angefasst: Zeile 175 (Kommentar `// config.claudeModel`), nested Groups.

### 2.4 Bewusst nicht geaendert / Abgrenzung

- Kommentare bleiben unberuehrt; Grep-/Test-Gates sind code-scoped (Kommentar-Strip), nicht roh.
- `scripts/*.js` (nicht `.mjs`) sind **ausser Scope**: `check-setup.js`, `set-webhooks.js`, `grant-admin.js`, `backfill-plan-profiles.js` nutzen weiterhin Flach-Keys und werden von keiner Phase (PA-13–18 = `src/`-only, PA-19 = `.mjs`) migriert. **Kampagnen-Luecke eskaliert an den Orchestrator**: PA-20 (Alias-Flip) wuerde diese `.js`-Skripte brechen — vor PA-20 ist eine Scope-Klaerung noetig. In PA-19 selbst nicht angefasst (Scope-Disziplin).

### 2.5 Deterministische Verifikation (5 Gates)

1. **Syntax**: `node --check` auf allen 4 Skripten -> 4x `OK`, keine Fehlerzeile.
2. **Per-Skript Dry-Run**: fail-closed vor jedem Netz-Call, PASS-Kriterium = erwartete Fail-closed-Meldung, nirgends `existiert nicht`/`TypeError`.
3. **Struktureller Grep-Gate**: kommentarbereinigter Grep auf residualen flachen `config.`-Zugriff -> keine Ausgabe.
4. **Ausfuehrungs-Gate**: `node --test test/scripts-config-namespace.test.js` -> alle pass.
5. **Voll-Suite**: `npm test` -> gruen, Bestand + neue Sub-Tests, keine Bestandstest-Aenderung.

### 2.6 Pre-Mortem (Kernrisiken + Mitigation)

| Risiko | Ursache | Mitigation |
|---|---|---|
| Falscher Namespace bleibt unentdeckt (hinter Netz-Gate) | 6 von 20 Zugriffen stehen hinter fail-closed+fetch, CLI-Dry-Run erreicht sie nicht | Ausfuehrungs-Test presst *jeden* Zugriff aus der Quelle gegen `guardedConfig` |
| Nested-Gruppe versehentlich "migriert" | `telnyxElevenLabs` koennte faelschlich als telnyx-Leaf gelesen werden | Explizite Ausnahmeliste, Test behandelt NESTED_GROUPS gesondert |
| Kommentar-Token verfaelscht Grep-/Test-Gate | Roh-Grep unterscheidet Code/Kommentar nicht | Beide Gates strippen Kommentare, Scope = die 4 config-importierenden Dateien |
| PA-20 bricht `scripts/*.js` still | `.js`-Skripte von keiner Phase migriert | Luecke im Plan explizit an Orchestrator eskaliert, bewusst ausser Scope |
| Bestandstest bricht durch Top-Level-Import | `telnyx-assistant-provision.mjs` wird von 3 Bestandstests importiert | Zielpfade vorab empirisch verifiziert, kein Throw erwartet |

### 2.7 Blast-Radius

4 Ops-Skripte (nur Zugriffspfad, ~20 Code-Zeilen), 1 neue Testdatei. Keine Logik-/API-/Signatur-Aenderung, kein Safety-Gate/Disclosure/Auth beruehrt, keine neue Dependency, keine neue Env-Var. Kein `src/`-Code, kein `config.js` selbst. Reversibel, deploy-neutral (Flach-Alias bleibt bis PA-20 aktiv).

---

## 3. Implementierung — Zusammenfassung

- **headCommit:** `3c9f48857f249d7a46e134b291fecfb710389216` (initialer Commit auf `phase/polish-a-p19`, Basis `master@e9deefe`)
- **node --check:** PASS (alle 5 Dateien)
- **Tests:** PASS — 2419 pass / 0 fail (bei der urspruenglichen Ausfuehrung)
- **Committed:** ja
- **Geaenderte Dateien:** `scripts/telnyx-ws-echo.mjs`, `scripts/telnyx-call-latency.mjs`, `scripts/smoke-stripe-payment.mjs`, `scripts/telnyx-assistant-provision.mjs`
- **Neue Datei:** `test/scripts-config-namespace.test.js`
- **Diff-Umfang:** 5 Dateien, 80 insertions / 21 deletions

Mechanische Migration `config.<flatKey>` -> `config.<namespace>.<key>` in den 4 config-importierenden Ops-Skripten — reiner Zugriffspfad, keine Logik-Aenderung. Bereits verschachtelte Gruppen (`config.telnyxElevenLabs.*`, `config.telnyxAssistant.*`) bewusst unveraendert gelassen (Plan-Vorgabe).

Die neue Testdatei `test/scripts-config-namespace.test.js` fuehrt jeden config-Zugriff aus den 4 Skripten ausfuehrungs-verifiziert gegen die echte `guardedConfig` aus (4/4 pass) — schliesst die npm-test-Luecke, da die Ops-Skripte nicht unter `npm test` laufen und mehrere Zugriffe hinter fail-closed+Netz-Gates stehen.

**Alle Plan-Verifikationsgates ausgefuehrt und bestanden:**

- (a) `node --check` auf allen 5 Dateien: OK
- (b) Per-Skript Dry-Run-Gate: alle 4 Skripte melden korrekt fail-closed (`smokePass=false` bzw. `Grund:`-Meldung), exit 1, nirgends `"existiert nicht"`/`TypeError`
- (c) Struktureller Grep-Gate: 0 residualer flacher `config.`-Zugriff
- (d) Neuer Ausfuehrungs-Test: 4 pass, 0 fail
- (e) Voll-Suite: 2419 pass, 0 fail (Bestand + 4 neue Sub-Tests, keine Bestandstest-Aenderung)

Sanity-Check bestaetigt zusaetzlich, dass ein falscher Namespace (`config.telephony.openaiApiKey`) tatsaechlich `TypeError` wirft (Tripwire funktioniert wie im Plan beschrieben).

### 3.1 Tests hinzugefuegt/geaendert

`test/scripts-config-namespace.test.js`: 4 neue Tests (je einer pro migriertem Skript), fuehren jeden config-Zugriff aus der Skript-Quelle gegen die echte `guardedConfig` aus.

### 3.2 Smoke-Test

`smokePass=false`. Server-Boot auf freiem Port (4304, Dummy-Env inkl. `PUBLIC_URL`/`ANTHROPIC_API_KEY`/`TWILIO_*`) bricht nach der Zeile `[boot] Keine aktive Nummer im Store. Erst seeden: npm run bootstrap-tenant -- <e164> <provider>` mit exit 1 ab, ohne Stacktrace/Fehlermeldung. `/healthz` war dadurch nicht erreichbar (curl 000). Ursache liegt ausserhalb dieser Phase (kein `server.js` im Diff) — vermutlich fehlender `bootstrap-tenant`-Seed fuer vollstaendigen lokalen Boot in einer frischen Worktree-`DATA_DIR`. Kein Blocker fuer PA-19, da diese Phase ausschliesslich `scripts/*.mjs` betrifft (eigenstaendige CLI-Tools, kein Teil der `server.js`-Routen); die Plan-eigenen deterministischen Verifikationsgates (node --check, Dry-Run pro Skript, struktureller Grep-Gate, neuer Ausfuehrungs-Test, Voll-Suite) sind alle gruen und decken das eigentliche Phasenziel vollstaendig ab.

---

## 4. Deviations vom Plan

1. **Zwischenfall (behoben, kein bleibender Schaden):** versehentliches `git stash` waehrend eines Backup-Vergleichs-Versuchs — bekannte Worktree-Falle (`refs/stash` ist worktree-geteilt, siehe MEMORY-Lektion `stash-clobbered-by-worktrees`). Sofort per `git stash pop` wiederhergestellt und vollstaendig re-verifiziert (Diff/Grep/Dry-Run/Test-Suite erneut gelaufen, identisches Ergebnis).
2. **Smoke-Test (best-effort) laesst sich mit den verfuegbaren Dummy-Env-Werten nicht sauber gruen kriegen:** `server.js` bricht nach der Boot-Warnung `Keine aktive Nummer im Store` mit exit 1 ab, ohne Stacktrace. Ursache liegt ausserhalb des Phasen-Scopes (kein `server.js`-Code in diesem Diff); vermutlich fehlt ein `bootstrap-tenant`-Seed-Schritt fuer einen vollstaendigen lokalen Boot. Laut Task-Vorgabe kein Blocker (`smokePass=false` + Grund dokumentiert statt geschoent).

---

## 5. Clean-Code-Selbstcheck (Impl-Agent)

Geprueft gegen `.claude/refs/clean-code.md`:

- **G5/S2 Duplizierung:** keine neue Duplizierung eingefuehrt; bestehende Kommentar-Duplizierung (G5-Referenzen in Kopfkommentaren) unangetastet gelassen (Scope-Disziplin: nur Zugriffspfad).
- **G25 Magic Numbers:** keine neuen Literale eingefuehrt.
- **C5/G9 toter/auskommentierter Code:** keiner eingefuehrt; die einzige Kommentar-Aenderung (Zeile 175 in `telnyx-assistant-provision.mjs`) zieht einen bestehenden Code-Referenz-Kommentar korrekt auf den neuen Pfad nach (C2, verhindert veralteten Kommentar), exakt wie im Plan als optionale Konsistenz-Notiz vorgesehen.
- **G12 ungenutzte Imports:** keine Imports geaendert.
- **N7 Nebeneffekte im Namen:** keine Funktionssignaturen geaendert.
- **G30/G34 eine Aufgabe/Abstraktionsebene:** unveraendert, da reiner Zugriffspfad-Swap ohne Strukturaenderung.
- **F1 Argumente:** keine Signaturen angefasst.
- **P15 Lazy-Init:** nicht beruehrt.
- **P11/T-Serie neues Verhalten -> Test:** die neue Testdatei deckt exakt das neue Verhalten (Namespace-Zugriffspfade) ab; der reine Refactor an den 4 Skripten selbst aendert keine Bestandstests (Suite bleibt ohne Test-Aenderung gruen, wie vom Plan gefordert).

**Ergebnis:** keine S1/S2-Befunde in den eigenen Aenderungen; die Migration ist mechanisch, 1:1 aus `CONFIG_NAMESPACES` abgeleitet und deckt sich exakt mit dem Plan-Diff.

---

## 6. Safety-Urteil (final)

**Verdict: APPROVED**

- `approved`: true
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

### Concerns (nicht blockierend)

1. **pg-Backend** (`STORE_BACKEND=pg npm test`): 36 Fehler — aber vorbestehend und PA-19-unabhaengig: identisch auf master-Baseline `e9deefe` (auch 36, failing-set byte-identisch per Diff), alle Fehler in `src`-Testdateien, die PA-19 nicht anfasst; alle Sub-Assertions gruen, nur Datei-Ebene rot -> Teardown/Exit-Artefakt beim globalen pg-Force (kein Regressions-Verdacht).
2. **`scripts/*.js`** (`check-setup.js`, `set-webhooks.js`, `grant-admin.js`, `backfill-plan-profiles.js`) tragen weiterhin flache `config.<flatKey>`-Zugriffe. Liegt ausserhalb des `*.mjs`-Cluster-F-Scopes dieser Phase; flache Keys bleiben funktional gueltig (rawConfig-Daten-Property), also kein Bruch — nur ein spaeterer Cluster.

### Independent Test Summary

json-Backend (`npm test`, korrigierter `node_modules`-Symlink): 2420 tests, 2420 pass, 0 fail, exit 0. pg-Backend (`STORE_BACKEND=pg npm test`): 2143 tests, 2107 pass, 36 fail — failing-set identisch zur master-Baseline `e9deefe` (2138/2102/36, Diff der Datei-Sets = 0). Neuer `test/scripts-config-namespace.test.js` besteht in beiden Backends und taucht in keinem Fehler-Set auf.

Unabhaengige Zusatzpruefung: `node --check` OK auf allen 4 migrierten `.mjs`; Dry-Run-Import loest alle 10 migrierten Namespace-Blaetter aus (0 throw), Kontroll-Typo `config.billing.stripeSecretKeyTYPO` wirft `TypeError` (Probe scharf).

Der urspruengliche npm-test-Exit-194 war ein Artefakt des zirkulaeren `ln -s ./node_modules node_modules` (ELOOP); nach Symlink-Fix auf die echte `node_modules` laeuft `npm test` sauber.

### Begruendung

PA-19 ist eine rein mechanische, verhaltens-erhaltende `config.<flatKey>` -> `config.<namespace>.<key>`-Migration ausschliesslich in den 4 `scripts/*.mjs`, die `src/config.js` importieren (Cluster F), plus ein ausfuehrungs-verifizierender Test. Kein `src/`-Runtime-Code, kein neuer npm-Dependency, kein Lockfile-Diff -> Safety-Gates (`numberGateError`), Disclosure (`claude.js`/`bridge.js`), Auth-fail-closed und Secret-Handling sind trivial intakt (unveraendert). Alle 10 Blatt-Zuordnungen 1:1 gegen `CONFIG_NAMESPACES` bestaetigt; bereits genestete Gruppen (`telnyxElevenLabs`/`telnyxAssistant`) korrekt flach belassen; 0 flacher Rest-Zugriff in den 4 Skripten; `guardedConfig`-basierter Test faengt falsche Blaetter echt ab. json-Suite 100% gruen; pg-Fehler sind vorbestehend und master-identisch (keine PA-19-Regression). Geld/Anruf-Verhalten byte-identisch (Getter lesen denselben `rawConfig`-Speicher). Alle bindenden Zusatz-Invarianten erfuellt.

---

## 7. Clean-Code-Audit (final)

**Verdict: PASS**

### s1 (Blocker)
Keine.

### s2 (schwerwiegend, nicht blockierend)
Keine.

### s3 (kosmetisch)
- `test/scripts-config-namespace.test.js:44` — `const [, first, second] = m;` benennt die Match-Gruppen generisch (`first`/`second`), obwohl umgebende Assertion-Messages/Kommentare bereits die Fachbegriffe "Namespace" und "Blatt" etablieren (z.B. `nicht-migrierter/falscher Zugriff config.${first}`, `ohne Blatt`). Empfehlung: in `const [, namespace, leaf] = m;` umbenennen (rein kosmetisch, keine Verhaltensaenderung).

### s4 (Anmerkungen)
Keine.

### Begruendung

Reiner Migrations-Diff (4 `scripts/*.mjs`: flacher `config.<key>` -> `config.<namespace>.<key>`) + 1 neue Testdatei. Alle referenzierten Namespace-Pfade (`billing.stripeSecretKey`/`stripeApiBase`/`paymentCurrency`, `telephony.telnyxApiKey`/`telnyxApiBase`/`telnyxConnectionId`, `server.publicUrl`, `llm.claudeModel`, `voice.openaiApiKey`, `provisioning.provisioningCountry`) wurden gegen das echte `CONFIG_NAMESPACES` in `src/config.js` (master-Tip, `e9deefe`) verifiziert — alle gueltig.

Empirisch verifiziert, nicht nur gelesen: `node --check` auf allen 5 Dateien OK; neuer Test isoliert 5/5 gruen; volle Suite in einem frischen, exakt auf den geprueften Commit (`673a1d0`) gepinnten Extra-Worktree: 2420/2420 gruen, 0 Fail; alle 4 Skripte direkt ohne Env-Vars ausgefuehrt — durchweg sauberes fail-closed (kein `TypeError` aus dem `guardedConfig`-Proxy, kein Netzzugriff, keine Secrets geloggt).

Kein verbliebener flacher `config.<key>`-Zugriff in den 4 Dateien; kein weiteres `scripts/*.mjs`, das `src/config.js` importiert und uebersehen wurde (via `git ls-tree`/Grep geprueft).

Der P12-Blocker aus Runde 1 (`ACCESS_RE.exec()`-`while`-Loop haette bei einem Testabbruch `lastIndex` ueber Testfaelle hinweg mutiert, F.I.R.S.T./Independence-Verstoss) ist in diesem fix2-Diff bereits korrekt behoben (`exec`-Loop -> `matchAll`, das intern klont) und mit einer dedizierten Regressionstest-Assertion abgesichert.

Keine Duplizierung gegenueber dem bestehenden `test/config-namespaces.test.js` (PA-12, prueft die Struktur von `CONFIG_NAMESPACES` selbst) — die neue Datei prueft eine andere Sache (Konsumenten-Korrektheit der 4 Skripte), kein G5-Ueberlapp.

Keine Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen, Kommentarkonvention (Deutsch, ohne Umlaute) eingehalten.

### Pass-Notes

Migration vollstaendig und korrekt: alle 4 Skripte (`scripts/smoke-stripe-payment.mjs`, `scripts/telnyx-assistant-provision.mjs`, `scripts/telnyx-call-latency.mjs`, `scripts/telnyx-ws-echo.mjs`) zeigen ausschliesslich auf gueltige `config.<namespace>.<leaf>`-Pfade; die 3 vor-PA-12 verschachtelten Gruppen (`telnyxElevenLabs`/`telnyxAssistant`/`elevenLabsPlayTts`) bleiben bewusst unangetastet flach. Neuer Test verifiziert ausfuehrungs-basiert (echter `guardedConfig`-Proxy-Zugriff, nicht nur Grep) und ist selbst-validierend (`checked>0`-Guard gegen stille Leerlaeufe). Fail-closed-Verhalten aller 4 Skripte ohne Live-Zugangsdaten empirisch bestaetigt (keine echten Netz-/Kosten-Aufrufe ausgeloest). Sicherheitsrelevant unauffaellig: keine Secrets in Logs/Kommentaren, REQUIRED-Gates unveraendert vor jedem Netzzugriff.

### Top-Todos

1. Optional/nicht blockierend: `first`/`second` in `test/scripts-config-namespace.test.js` zu `namespace`/`leaf` umbenennen fuer Konsistenz mit der im selben Diff verwendeten Fachsprache.
2. Keine weiteren To-dos — Diff ist mergefaehig (PASS).

---

## 8. Fix-Runden

### Runde 1 (r1)

Alle 4 gemeldeten Blocker wurden gegen den tatsaechlichen committeten Stand von `phase/polish-a-p19` (Commit `3c9f488`, ausfuehrungs-verifiziert, nicht nur per grep) live nachgestellt — keiner reproduziert. Root Cause der Fehl-Diagnose: `src/config.js` hat `CONFIG_NAMESPACES` (13 Namespaces inkl. `telephony`/...) bereits korrekt vorbereitet; die urspruengliche Meldung stammte aus einer nicht-repraesentativen Pruefung.

### Runde 2 (r2)

P12-Blocker (F.I.R.S.T./Independence-Verstoss) in `test/scripts-config-namespace.test.js` behoben. Ursache: das modulweite `ACCESS_RE`-Regex-Objekt (mit `g`-Flag) wurde per `.exec()` in einer `while`-Schleife direkt mutiert; ein Abbruch (throw aus `assert.doesNotThrow`/`assert.ok`) mitten in einem `test()`-Lauf haette `lastIndex` unsauber ueber Testfaelle hinweg stehen lassen und Folgetests verfaelschen koennen. Fix: `exec`-Loop durch `matchAll` ersetzt (klont intern, keine geteilte Mutation), plus dedizierte Regressionstest-Assertion zur Absicherung. Ergebnis: fix2-Diff, Clean-Code-Audit-Verdict PASS.

---

## 9. Ergebnis

| Kriterium | Status |
|---|---|
| Plan | vollstaendig, code-gruendlich verifiziert |
| Implementierung | abgeschlossen, mechanische Migration, keine Logik-Aenderung |
| node --check | PASS (5/5 Dateien) |
| Tests (json-Backend) | PASS (2420/2420) |
| Tests (pg-Backend) | 2107/2143, 36 Fehler — vorbestehend, master-identisch, keine PA-19-Regression |
| Safety-Review | APPROVED, keine Blocker |
| Clean-Code-Audit | PASS nach Fix-Runde 2 (r1: keine Reproduktion, r2: P12-Blocker behoben) |
| Smoke-Test | best-effort fehlgeschlagen, Ursache ausserhalb Scope, dokumentiert, kein Blocker |
| **Gate** | **PASS** |
| **Final-Branch** | `phase/polish-a-p19-fix2` |

**Offene Folgepunkte fuer spaetere Phasen (nicht PA-19):**
- `scripts/*.js` (nicht `.mjs`) bleiben auf Flach-Keys — Kampagnen-Luecke vor PA-20 (Alias-Flip) klaeren.
- Optionale kosmetische Umbenennung `first`/`second` -> `namespace`/`leaf` in `test/scripts-config-namespace.test.js` (s3, nicht blockierend).
