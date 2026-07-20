# PA-13 — Detailbericht

**Phase:** PA-13 — Migration Cluster A1 (`billing/*` + `worker/*` + `onboarding` + `sms-summary`, Money-Importeure ohne Routen)
**finalBranch:** `phase/polish-a-p13`
**headCommit:** `39ea54c8cd9388e2a94048faa087c7cb2e488118`
**Gate:** **PASS**

---

## 1. Ausgangslage

PA-12 ist auf `master` gemergt (5fca70f). `src/config.js` exportiert `CONFIG_NAMESPACES` und haengt via `attachNamespaces(rawConfig, …)` 13 nicht-enumerable Namespace-Objekte an; jedes Blatt ist ein Getter auf denselben `rawConfig`-Speicherort. Der Flach-Alias bleibt bis PA-20 aktiv.

PA-2 (enqueue-nach-Persistenz) und PA-10 (dailySmsCap fail-closed-Guard) sind bereits in den Zieldateien vorhanden und bleiben in ihrer Logik unangetastet — nur der Zugriffspfad auf `config` aendert sich.

**Entscheidende Erkenntnis:** Von den Zieldateien importiert nur `src/billing/stripe.js` das globale `config` direkt. Alle uebrigen bekommen `config` per Dependency Injection (Parameter). In Produktion reichen alle Aufrufer (`server.js`, `self-service-routes.js`, `routes/api-billing.js`, `routes/stripe-webhook.js`, `call-finish.js`) das globale `config` (mit Namespaces) durch — die DI-Migration ist deshalb zwingend fuer den PA-20-Flip.

**Konsequenz fuer Tests:** Unit-Tests injizieren flache Hand-Mocks. Sobald migrierter Code `config.billing.paymentEnabled` liest, wirft ein flacher Mock `TypeError`. Deshalb brauchen betroffene Test-Fixtures die Namespace-Oberflaeche — ueber einen Getter-Helfer, nicht per Hand-Verschachtelung (sonst PM-1-Stale-Risiko bei Spread-Overrides wie `{ ...CONFIG, paymentEnabled }`).

---

## 2. Plan (gekuerzt)

### 2.1 Neue Infrastruktur
- `src/config.js`: `attachNamespaces` von modul-privat auf `export function attachNamespaces(...)` — additiv, keine Verhaltensaenderung (OQ-A im Plan, als Default umgesetzt).
- `test/helpers.js`: geplanter Helfer `withConfigNamespaces(flatConfig)`, der `attachNamespaces(flatConfig, CONFIG_NAMESPACES)` anwendet und dasselbe Objekt zurueckgibt — analog zur Produktions-Verdrahtung, verhaltensneutral fuer Pfade ohne Namespace-Zugriff.

### 2.2 Quell-Edits (6 Dateien, rein mechanisch)
Namespace-Zuordnung strikt aus `CONFIG_NAMESPACES`:
- **billing:** `stripeSecretKey`, `stripeApiBase`, `paymentCurrency`, `numberSetupFeeCents`, `paymentEnabled`, `stripeStarterPriceId`, `stripeBusinessPriceId`
- **voice:** `sendSmsSummary`, `dailySmsCap`
- **provisioning:** `provisioningRedriveMaxAgeMs`, `provisioningCountry`, `forceNumberCountry`, `maxNumbers`, `maxNumbersPerTenant`, `provisioningEnabled`

Betroffene Dateien: `src/billing/stripe.js`, `src/billing/metering.js`, `src/billing/subscribe.js` (Bracket-Zugriff `config[key]` → `config.billing[key]`), `src/billing/payment-gate.js`, `src/sms-summary.js`, `src/worker/provisioning-orchestrator.js`. Begleitend Kommentar-/String-Referenzen (C2) mit-migriert. `src/onboarding.js` und `src/worker/provisioning.js` sowie der Rest von `billing/*` haben 0 config-Zugriffe → keine Edits.

### 2.3 Test-Edits (14 Dateien + Helfer)
Jeder Hand-Mock, der einen migrierten DI-Zugriff (direkt oder ueber eine flache Route mit migriertem Unterhelfer) erreicht, wird am Injektionspunkt — nach allen Spreads/Overrides — mit `withConfigNamespaces(...)` gewrappt. Direkte Unit-Tests (8): `billing-payment-gate`, `metering-unit`, `billing-subscribe`, `plans-catalog`, `f2-p8-cost-cap`, `f2-p9-dedup-persist`, `f2-sms-summary-plan`, `provisioning-enqueue-order`. Route-Tests, die eine migrierte Billing-Unterroute treffen (6): `p5-onboarding-funnel`, `i9-self-service`, `w4-self-service-subscribe`, `self-service-mirror-hydration`, `bk5-smoke-e2e`, `bk2-checkout-return-plan`. Explizit **nicht** betroffen: Spawn-/Integrationstests (echtes config), Stripe-Adapter-Tests, die das globale config patchen, Self-Service-Route-Tests ohne migrierte Unterroute, sowie `config-money-manifest`/`config-payment-guard`.

### 2.4 Verifikation (geplant)
`node --check` auf allen 6 Quelldateien; zwei Grep-Gates (kein flacher Dot-Zugriff auf ein Blatt-Key, kein direkter Bracket-Zugriff); volle Suite gruen (Baseline 2362); gezielte Einzeltests; Boot-Smoke via `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + `curl /healthz`. Kein Push, kein Deploy, Merge im Lead mit gezieltem `git add` (kein `git add -A`).

### 2.5 Offene Lead-Entscheidung
OQ-A: `attachNamespaces`-Export in `config.js` (Default, empfohlen) vs. Reimplementierung der Getter-Schleife in `test/helpers.js` (kein config.js-Touch, kleine G5-Duplikation). Default wurde umgesetzt.

---

## 3. Implementierung — Zusammenfassung

PA-13 wurde exakt nach Plan umgesetzt und committed (`39ea54c` auf `phase/polish-a-p13`).

- 6 Quelldateien mechanisch auf `config.<namespace>.<key>` migriert (billing/voice/provisioning gemaess `CONFIG_NAMESPACES` aus PA-12).
- `src/onboarding.js` und `src/worker/provisioning.js` hatten wie im Plan angenommen 0 config-Zugriffe — keine Edits.
- Beide strukturellen Grep-Gates (kein flacher Dot-Zugriff, kein Bracket-Zugriff auf die 99 Blaetter) sind leer/sauber.
- 14 Testdateien auf `withConfigNamespaces()` nachgezogen (Getter-Delegation, PM-1-sicher gegen Spread-Overrides).
- `node --check` gruen auf allen 7 geaenderten Quelldateien.
- Volle Suite: **2408 pass / 0 fail / 0 skip / 0 todo**, dreimal in Folge reproduziert (inkl. Lauf gegen den finalen Commit).
- Smoke-Test: Server gegen frisch geseedeten JSON-Store gestartet (`bootstrap-tenant.js`), `/healthz` → 200. Beide migrierten `PAYMENT_ENABLED`-Gate-Routen real erreicht: `POST /api/billing/setup-checkout` → 404 `{"error":"payment disabled (PAYMENT_ENABLED)"}`, `POST /api/billing/flush-meters` → 404 `{"error":"metering disabled (PAYMENT_ENABLED)"}` — beweist, dass `requirePaymentEnabled` `config.billing.paymentEnabled` korrekt aus echtem (nicht gemocktem) Boot-Config liest.

### Geaenderte/erstellte Dateien
**Quelle (7):** `src/config.js`, `src/billing/stripe.js`, `src/billing/metering.js`, `src/billing/subscribe.js`, `src/billing/payment-gate.js`, `src/sms-summary.js`, `src/worker/provisioning-orchestrator.js`

**Tests (14, angepasst):** `test/billing-payment-gate.test.js`, `test/metering-unit.test.js`, `test/billing-subscribe.test.js`, `test/plans-catalog.test.js`, `test/f2-p8-cost-cap.test.js`, `test/f2-p9-dedup-persist.test.js`, `test/f2-sms-summary-plan.test.js`, `test/provisioning-enqueue-order.test.js`, `test/p5-onboarding-funnel.test.js`, `test/i9-self-service.test.js`, `test/w4-self-service-subscribe.test.js`, `test/self-service-mirror-hydration.test.js`, `test/bk5-smoke-e2e.test.js`, `test/bk2-checkout-return-plan.test.js`

**Neu:** `test/config-namespaces-helper.js`

---

## 4. Deviation vom Plan (mit Root-Cause)

**Geplant:** `withConfigNamespaces` sollte in `test/helpers.js` liegen (Plan-Abschnitt 1.2).

**Was passierte:** Die planvorgesehene Umsetzung wurde ausprobiert und gegen die volle Suite getestet — sie zeigte **110 echte Fehlschlaege** ueber die gesamte Suite verteilt, alle ausserhalb des PA-13-Scopes (u.a. `telnyx-call-control`, `claude-identity`, `disclosure-regression`, `store-purge`/`-integrity`, `tenant-erasure`, `retention`, `g1-identity-binding`, `l2`/`l3`, `personal-assistant-characterization`, `afix-p4`, `c1-auftragstreue`, `f1-i18n-locale`, `turn-fallback-locale`).

**Root Cause (verifiziert, auch gegen `master` reproduziert — dieselbe Datei isoliert lief dort gruen):** Ein statischer `import ... from "../src/config.js"` in `helpers.js` wertet `config.js` aus, sobald irgendein Testfile `helpers.js` importiert — das geschieht *vor* dem eigenen `process.env`-Setup vieler Testdateien, die bewusst das etablierte Muster "env setzen, dann `config.js` dynamisch importieren" nutzen (ein Kommentar in `helpers.js` bei `makeConfigOverrides` warnt bereits explizit davor — vgl. Lehre `test-base-env-drift`).

**Fix:** `withConfigNamespaces` wurde in eine neue, separate Datei `test/config-namespaces-helper.js` ausgelagert, die *nur* von den 14 tatsaechlich betroffenen PA-13-Testdateien importiert wird (keine davon nutzt das env-vor-config-Muster). `test/helpers.js` blieb dadurch **byte-identisch** zum Stand vor PA-13.

**Nach dem Fix:** Vollsuite dreimal in Folge **2408/2408 gruen** (0 Fehlschlaege), inkl. Lauf gegen den finalen Commit.

**Einordnung:** Sicherheits-/Korrektheits-Reparatur (G26-Klasse: stiller fail-open-Stale-Bug), keine Stil-Abweichung.

**Zweite, unwesentliche Abweichung:** OQ-A aus dem Plan (`attachNamespaces` in `config.js` exportieren) wurde wie empfohlen als additive Ein-Zeilen-Aenderung umgesetzt — das ist keine echte Abweichung, sondern die im Plan vorgesehene Default-Wahl.

### Clean-Code-Selbstcheck (Implementierung)
Gegen `.claude/refs/clean-code.md` geprueft: G5 (keine Duplizierung) — Test-Helfer nutzt das bereits exportierte `attachNamespaces`/`CONFIG_NAMESPACES` statt eigener Kopie; G25 (keine Magic Numbers) — n.z. (reine Zugriffspfad-Umstellung); G9/C5 (kein toter/auskommentierter Code) — PASS; G12 (keine ungenutzten Imports) — PASS (`node --check` + gruene Suite belegen das); C2 (Kommentare aktuell) — alle Kommentar-/String-Referenzen auf migrierte Blatt-Keys mit-migriert; F1 (≤3 Argumente) — unveraendert; G30/G34 (eine Aufgabe/Abstraktionsebene) — unveraendert; P15 (kein Lazy-Init-Antipattern) — n.z.

---

## 5. Safety-Urteil (final)

**approved: true** — alle Einzelkriterien PASS: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **Keine Blocker.**

**Unabhaengiger Test-Nachvollzug:** Volle Suite selbst ausgefuehrt (`NODE_ENV=test node --test test/*.test.js`): **2408 pass / 0 fail / 0 skipped / 0 todo**, ~100s. pg-Backend via `pglite` (`makePgTestStore`) ist in-suite abgedeckt, ein Lauf deckt daher beide Backends. Isoliert nachgezogen: `config-money-manifest` + `config-payment-guard` = 6/6 gruen. `node --check` gruen auf allen 7 migrierten Quelldateien + Test-Helper.

**Concerns (keine Blocker):**
1. `config.js` erhielt `export` auf `attachNamespaces` (vorher modul-privat). Runtime-neutral (macht nur die Funktion importierbar), notwendig fuer den neuen Test-Helfer, `CONFIG_NAMESPACES` war bereits exportiert. Keine Logik-Aenderung.
2. `test/config-namespaces-helper.js` mutiert sein Argument via `Object.defineProperty`. An allen Aufrufstellen ist das Argument ein frisches Spread-Objekt (`{ ...CONFIG }`) — kein Aliasing des geteilten Modul-`CONFIG`. Zwei vorher direkt weitergereichte `CONFIG`-Faelle (`bk5`, `self-service-mirror-hydration`) wurden korrekt auf `{ ...CONFIG }` umgestellt.

**Verdict (Wortlaut):** APPROVED. PA-13 ist eine saubere, rein mechanische Config-Namespace-Migration. Grep-Gate PASS: 0 verbliebene Flach-Zugriffe (96 Scalar-Keys) in `billing/*`, `worker/*`, `sms-summary.js`, `onboarding.js`; kein Bracket-/Destrukturierungs-Zugriff; pre-nested Objekte unveraendert; jeder migrierte Key trifft die korrekte Namespace-Zuordnung laut `CONFIG_NAMESPACES`. Verhalten byte-identisch (Shim-Getter delegieren live auf denselben Flach-Slot, Flach-Alias bleibt aktiv). Safety-Gates (`numberGateError`/Outbound-Gates in `src/telephony`) unberuehrt; Provisioning-/Metering-/Budget-Logik unveraendert, nur Zugriffspfad; `dailySmsCap`-fail-closed-Guard erhalten und weiterhin per Test bewiesen. Disclosure (`claude.js`+`bridge.js`) und Auth (`web-auth.js`/`auth.js`) nicht angefasst; keine neuen Endpunkte; keine Secret-Leaks. Kein neuer npm-Dep, keine env/render-Aenderung, `onboarding.js` zu Recht ausgelassen (0 Config-Zugriffe). Eigene Test-Laeufe gruen (2408/0). Keine Blocker.

---

## 6. Clean-Code-Audit (final)

**S1 (Blocker):** keine
**S2:** keine
**S3:**
- N7 · `test/config-namespaces-helper.js:24-26` — Funktionsname `withConfigNamespaces` folgt der JS-`with`-Konvention (impliziert "liefert eine Kopie/neuen Wert"), tatsaechlich mutiert die Funktion das uebergebene Objekt in-place via `Object.defineProperty` (`attachNamespaces`) und gibt dasselbe Objekt zurueck. Optionaler Rename (z. B. `attachConfigNamespacesTo`) oder so belassen — der Nebeneffekt ist im Kommentar direkt darueber bereits ausfuehrlich dokumentiert (inkl. "NACH allen Spreads anwenden"-Warnung); Vorrang-Lesbarkeit-Regel greift, daher nur als Kosmetik-Hinweis, nicht als echter Verstoss gewertet.

**S4:** keine

**Blocker: false — Verdict: PASS**, keine Blocker. PA-13 ist ein eng geschnittener, mechanischer Refactor: `config.<key>` → `config.<namespace>.<key>` (billing/voice/provisioning) in `src/billing/metering.js`, `payment-gate.js`, `stripe.js`, `subscribe.js`, `src/sms-summary.js`, `src/worker/provisioning-orchestrator.js`; `src/config.js` exportiert lediglich das schon vorhandene `attachNamespaces` zusaetzlich (1 Zeile). Verhalten byte-identisch, keine neue Logik, keine neuen Magic Values, keine abgeschalteten Sicherungen.

**Pass-Notes (Verifikationstiefe):**
1. Alle migrierten `config.billing.*`/`config.provisioning.*`/`config.voice.*`-Zugriffe stimmen exakt mit den in `CONFIG_NAMESPACES` (`src/config.js`) deklarierten Key-Listen ueberein — keine Tippfehler/fehlenden Keys.
2. Jede der 6 betroffenen `src`-Dateien ist vollstaendig migriert (grep zeigt keinen verbliebenen flachen `config.*`-Zugriff mehr) — keine G11-Inkonsistenz durch halbfertige Migration.
3. Alle Produktions-Aufrufer (`server.js`, `self-service-routes.js`, `stripe-webhook.js`, `api-billing.js`, `call-finish.js`) reichen denselben globalen config-Singleton durch, der `CONFIG_NAMESPACES` bereits am Boot angehaengt hat — keine Laufzeit-`TypeError`s.
4. Neuer Test-Helper `test/config-namespaces-helper.js` baut keine eigene Namespace-Logik, sondern importiert und nutzt `attachNamespaces`/`CONFIG_NAMESPACES` aus `src/config.js` wieder (DRY, G5-konform).
5. Bewusst eigene Datei statt `helpers.js`, mit nachvollziehbarer Begruendung (env-vor-config-Lehre) — per grep verifiziert, dass keine der 13 betroffenen Testdateien das "process.env setzen, dann config importieren"-Muster nutzt; die Begruendung ist zutreffend, nicht nur behauptet.
6. Alle `withConfigNamespaces(...)`-Aufrufe wenden die Funktion nach etwaigen Spreads/Overrides an (Frozen-`CONFIG`-Objekte werden vorher per `{...CONFIG}` kopiert, keine `TypeError` durch `defineProperty` auf frozen object).
7. Vollstaendiger Testlauf in isoliertem Worktree (`node --check` auf allen 7 touched src-Dateien gruen; `npm test`: 2408/2408 gruen, 0 fail/skip) — insbesondere auch die nicht im Diff enthaltenen Testdateien, die dieselben Module nutzen (`api-flush-meters`, `billing-stripe-idempotent-headers`, `prov01-capture-idempotent`, `stripe-cancel-hold-adapter`, `stripe-setup-checkout`), liefen unveraendert durch, da sie den echten config-Singleton importieren.
8. Diff-Scope ist sauber: nur die 22 tatsaechlich fachlich betroffenen Dateien, keine `tasks/*.md`- oder PLAN-Dateien im Commit.

**Top-TODOs:**
- Kein Blocker offen — Phase kann gemergt werden.
- Folgephase (falls geplant): dieselbe Namespace-Migration auf die noch flach lesenden Aufrufer nachziehen (`self-service-routes.js`, `routes/stripe-webhook.js`, `routes/api-billing.js`, `telephony/call-finish.js` nutzen weiterhin `config.paymentEnabled`/`config.numberSetupFeeCents`/etc. flach) — aktuell bewusst inkrementell, kein Fehler dieser Phase.
- Optional/kosmetisch: `withConfigNamespaces`-Namensgebung ueberdenken (siehe S3), nicht blockierend.

---

## 7. Fix-Runden

Keine — Safety- und Clean-Code-Review liefen jeweils direkt auf PASS/APPROVED ohne Blocker. Keine Nacharbeits-Runde noetig.

---

## 8. Ergebnis

| Kriterium | Ergebnis |
|---|---|
| Gate | **PASS** |
| finalBranch | `phase/polish-a-p13` |
| headCommit | `39ea54c8cd9388e2a94048faa087c7cb2e488118` |
| node --check | gruen (alle 7 Quelldateien) |
| Testsuite | 2408 pass / 0 fail / 0 skip (dreimal reproduziert) |
| Smoke-Test | bestanden (echter Boot, 2 migrierte Gate-Routen via curl gegen 404 verifiziert) |
| Safety | APPROVED, keine Blocker |
| Clean-Code | PASS, keine Blocker (1 S3-Kosmetik-Hinweis) |
| Fix-Runden | 0 |
| Push/Deploy | keiner (planungsgemaess) |
