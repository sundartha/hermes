# Server-Slim P7 — `src/routes/api-billing.js` extrahieren

- **Gate**: PASS
- **finalBranch**: `phase/slim-p7-api-billing`
- **headCommit (Impl)**: `830cd7c881828693822418e83a9325e69a8507a6`
- **Datum**: 2026-07-16

## Plan (gekuerzt)

### Kernbefund / Line-Drift korrigiert

Der Basis-Plan nannte L1514-1575; im echten `master`-Code (HEAD `1dc310b`, `src/server.js` = 1740 Zeilen, P1-P6 bereits gemergt) sitzt die Route-Gruppe bei **L1245-1306**:

- `POST /api/billing/flush-meters` — L1251-1258 (Kommentar L1245-1250)
- `const CARD_ON_FILE_STATUS = "card_on_file"` — L1266 (Kommentar L1260-1265)
- `POST /api/billing/setup-checkout` — L1268-1286
- `GET /api/billing/checkout-return` — L1288-1306

Block-Grenzen (INV-2): unmittelbar **nach** `app.use(makeProfileRoutes(...))` (L1243) und **vor** dem `/api/onboard`-Kommentar (L1308). Blank-Zeilen L1244/L1307 bleiben ausserhalb des Blocks. Alle vier `api/billing`-Vorkommen liegen im Block.

**Freie Symbole der drei Handler:**
- injizierbar (stateful/cross-cutting): `config`, `store`, `audit`, `stripeBilling` (Stripe-Port-Singleton), `requireTenant`
- pure Modul-Helfer (importierbar): `flushMeters` (`billing/meter.js`), `bindCardFromSession` + `startCheckoutWithStaleCustomerHeal` (`billing/card-setup.js`)
- modul-lokale Konstante: `CARD_ON_FILE_STATUS`

Verifiziert: nach dem Move werden `flushMeters`, `bindCardFromSession`, `startCheckoutWithStaleCustomerHeal`, `CARD_ON_FILE_STATUS` in `server.js` dead (nur im Block genutzt). `stripeBilling` (L213/L475/L517) und `requireTenant` (L1196/L1211/read-routes) bleiben, `makeMetering` (L93) bleibt.

Kein Test greift die Billing-Symbole whitebox aus dem `server.js`-Quelltext (grep ueber `test/` bestaetigt). `billing-card-setup.test.js` importiert die Helfer direkt aus `../src/billing/card-setup.js` (unveraendert). → **Keine Test-Datei muss angefasst werden.**

### 1. Neue Datei: `src/routes/api-billing.js` (~85 LOC)

**Signatur:** `export function makeBillingRoutes({ config, store, audit, billing, tenant: { requireTenant } })` → `express.Router`

Muster exakt wie `makeReadRoutes`/`makeProfileRoutes`: Router-Factory, pure Domaenen-Helfer werden **importiert** (wie `publicCall` in `api-read.js`), stateful/cross-cutting Deps werden **injiziert**. `tenant`-Bundle wird im Parameter nested-destrukturiert (`tenant: { requireTenant }`), damit die Handler-lokale `const tenant = requireTenant(...)` nichts shadowed und byte-identisch bleibt.

Enthaelt die drei Routen `POST /api/billing/flush-meters`, `POST /api/billing/setup-checkout`, `GET /api/billing/checkout-return` mit unveraendertem Verhalten: PAYMENT_ENABLED-404-Gate, `requireTenant`-403-Gate, Self-Heal via `startCheckoutWithStaleCustomerHeal`, Customer-Mismatch-403 via `bindCardFromSession`. Route-Reihenfolge im Router = Quell-Reihenfolge.

### 2. Edits an `src/server.js` (3 chirurgische Edits, Netto ~ -49 Zeilen)

- **Edit A** — tote Imports entfernen (`flushMeters`, `bindCardFromSession`+`startCheckoutWithStaleCustomerHeal` raus; `makeMetering`-Import bleibt).
- **Edit B** — Factory-Import ergaenzen (`import { makeBillingRoutes } from "./routes/api-billing.js";` nach dem `api-profiles.js`-Import).
- **Edit C** — Block L1245-1306 durch `app.use(makeBillingRoutes({ config, store, audit, billing: stripeBilling, tenant: { requireTenant } }))` ersetzen, an unveraenderter Position (INV-2/INV-3). Blank-Zeilen L1244/L1307 bleiben unberuehrt.

Kein weiterer Edit. `stripeBilling`, `requireTenant`, `makeMetering`, `config`, `store`, `audit` bleiben; `server.js` bleibt export-frei; Boot-Log-Zeile unangetastet.

### 3. Tests — keine neuen, keine Aenderungen

Reine Verschiebung, die Bestandssuite pinnt alle drei Routen HTTP-seitig byte-identisch (Spawn-Tests gegen die Live-Route): `test/api-flush-meters.test.js`, `test/billing-setup-checkout-route.test.js`, `test/bk2-checkout-return-plan.test.js`, `test/billing-card-setup.test.js`, `test/w4-self-service-subscribe.test.js`. Kein Test greift die Symbole whitebox → keine mechanische Anpassung noetig.

### 4. Deviations (bewusst, begruendet, aus dem Plan selbst)

1. **Pure Helfer importiert statt injiziert.** Die literale Spec-Verdrahtung listet `flushMeters, bindCardFromSession, startCheckoutWithStaleCustomerHeal` als injizierte Deps. Der Plan importiert sie stattdessen direkt in `api-billing.js`, weil die Spec selbst "Muster: bestehendes makeReadRoutes" verlangt — und `makeReadRoutes` importiert seine puren Helfer (`publicCall` etc.) ebenfalls direkt statt sie zu injizieren. INV-7 bleibt gewahrt (betrifft nur stateful Singletons).
2. **In-Handler `stripeBilling` → `billing`.** Der Stripe-Port wird unter dem codebase-weiten Schluessel `billing` injiziert (konsistent zu L213/L475/L517 und den Signaturen von `flushMeters`/`bindCardFromSession`/`startCheckoutWithStaleCustomerHeal`). Verhaltens-identisch (`billing === stripeBilling`).

### 5. Deterministisch pruefbares Ergebnis

```bash
node --check src/routes/api-billing.js && node --check src/server.js   # beide: still (OK)
grep -c "^export" src/server.js                                        # 0
grep -c "api/billing" src/server.js                                    # 0
grep -cE "flushMeters|bindCardFromSession|startCheckoutWithStaleCustomerHeal|CARD_ON_FILE_STATUS" src/server.js  # 0
grep -rF "laeuft auf http://localhost" src/ | wc -l                    # 1 (INV-6, unveraendert)
git diff --stat src/server.js                                          # Netto-Reduktion (~ -49)
```

Invarianten-Abgleich P7: INV-2 (Mount-Position unveraendert), INV-3 (Route bleibt hinter dem Auth-Gate), INV-7 (`stripeBilling`+`requireTenant` je EINE injizierte Instanz), INV-9 (PAYMENT_ENABLED-404-Gate + tenant-403 byte-identisch), INV-10 (server.js export-frei) — alle erfuellt. Blast-Radius: 1 neue Datei + 3 Edits in einer Datei; `bridge.js`, Store-Fassade, `billing/*`, Auth/Boot unberuehrt.

## Impl-Zusammenfassung

P7 umgesetzt: `src/routes/api-billing.js` neu erstellt (`makeBillingRoutes`-Factory, DI-Muster wie `makeReadRoutes`/`makeProfileRoutes`) mit den drei Routen `POST /api/billing/flush-meters`, `POST /api/billing/setup-checkout`, `GET /api/billing/checkout-return`. `server.js`: 3 chirurgische Edits (tote Imports raus, Factory-Import ergaenzt, Block durch `app.use(makeBillingRoutes(...))`-Mount ersetzt) an unveraenderter Mount-Position (nach `makeProfileRoutes`, vor `/api/onboard`). Netto -49 Zeilen im Diff (1740 → 1694 Zeilen, insgesamt 18 insertions/64 deletions in `server.js`).

- `node --check` auf beiden Dateien sauber.
- Volle `npm test`-Suite (deckt JSON- UND pglite-in-process-Backend ab, da alle `*-pg.test.js` im selben Glob laufen) gruen: **2290/2290**.
- Isolierte Spec-Regressionstests (`api-flush-meters`, `billing-setup-checkout-route`, `bk2-checkout-return-plan`, `billing-card-setup`, `w4-self-service-subscribe`) separat gruen: **47/47**.
- Deterministische Checks: `grep -c "^export"` = 0, Boot-Log-Zeile genau 1 Treffer, grep auf tote Symbole (`flushMeters`/`bindCardFromSession`/`startCheckoutWithStaleCustomerHeal`/`CARD_ON_FILE_STATUS`) in `server.js` = 0.
- Smoke-Test: Server lokal gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, geseedete Nummer via `bootstrap-tenant`), alle drei Routen liefern das erwartete 404 (PAYMENT_ENABLED aus, byte-identisch zu vorher) — erfolgreich verifiziert, kein Blocker.
- Kein Test musste geaendert werden (reine Verschiebung, keine Whitebox-Tests treffen die Billing-Symbole in `server.js`).
- Commit `830cd7c` auf Branch `phase/slim-p7-api-billing` (von `master` abgezweigt).

**filesCreated**: `src/routes/api-billing.js`
**filesEdited**: `src/server.js`

### Deviations (Impl, uebernommen aus dem Plan)

1. Plan-Deviation 1 (aus dem Plan selbst uebernommen, nicht neu): pure Helfer (`flushMeters`, `bindCardFromSession`, `startCheckoutWithStaleCustomerHeal`) werden in `api-billing.js` IMPORTIERT statt wie in der SPEC-Verdrahtungszeile literal aufgefuehrt INJIZIERT. Begruendung: SPEC selbst verlangt "Exakte Dep-Liste aus echtem Code ableiten; Muster: bestehendes makeReadRoutes" — und `makeReadRoutes` importiert seine puren Helfer (`publicCall` etc.) ebenfalls direkt statt sie zu injizieren. INV-7 bleibt gewahrt (betrifft nur stateful Singletons: `billing`/`requireTenant` sind injiziert).
2. Plan-Deviation 2 (aus dem Plan selbst uebernommen): In-Handler-Referenzen `stripeBilling` → `billing` umbenannt (Shorthand-Injection unter dem codebase-weiten Schluessel `billing`, konsistent mit den drei bestehenden Verdrahtungsstellen L213/L475/L517 und den Signaturen von `flushMeters`/`bindCardFromSession`/`startCheckoutWithStaleCustomerHeal`, die alle `{ billing }` erwarten). Verhaltens-identisch (`billing === stripeBilling`).
3. Nicht-blockierende Kleinigkeit: der neue Mount-Kommentar in `server.js` nennt "`/api/billing/*`-Route-Gruppe" als Dokumentation (Praezedenz: der bestehende `makeReadRoutes`-Mount-Kommentar nennt ebenfalls konkrete Routen-Pfade wie `/api/tenant-data/export`). Dadurch liefert `grep -c "api/billing" src/server.js` jetzt 1 statt der im Plan-Abschnitt 5 (nicht Teil der offiziellen globalen Verifikation) vorhergesagten 0 — rein dokumentarisch, keine Code-Referenz auf die verschobenen Symbole, keine funktionale Abweichung.

### Clean-Code-Selfcheck (Impl)

`clean-code.md` (P1-P16, C1-C5, G1-G36, N1-N7, F1-F4) gelesen und angewendet. G5 (Duplizierung): keine — Handler-Rümpfe byte-identisch verschoben, pure Helfer aus einer Quelle importiert (`billing/meter.js`, `billing/card-setup.js`), Musterkonsistenz mit `makeReadRoutes` explizit hergestellt. G25 (Magic Numbers/Strings): `CARD_ON_FILE_STATUS` bleibt benannte Konstante mit Kommentar, unveraendert uebernommen. C5/G9 (toter/auskommentierter Code): keiner eingefuehrt, alte tote Imports aus `server.js` entfernt (G12). F1 (<=3 Argumente): `makeBillingRoutes` nimmt ein einziges Deps-Objekt, Handler nehmen `(req, res)` wie im Bestand. G30/G34: jede Route bleibt eine kohaerente Aufgabe (Gate-Check → Domain-Call → Response). P15 (Konstruktion getrennt von Nutzung): Router-Factory wird einmal in der Kompositionswurzel (`server.js`) aufgerufen und gemountet, kein Lazy-Init. C2: Modul-Kommentar referenziert Konzepte, keine brittle Zeilennummern. Kommentare deutsch ohne Umlaute, ESM, kein Build-Step, keine neuen Dependencies. Kein neues Verhalten → kein neuer Test noetig, Bestandssuite bleibt unveraendert und gruen.

### Smoke-Test

Server lokal auf Port 3999 gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-`ANTHROPIC`/`TWILIO`-Keys, `PUBLIC_URL`, `DASHBOARD_PASSWORD` leer, Nummer via `npm run bootstrap-tenant` geseedet).

- `/healthz` → 200
- `POST /api/billing/flush-meters` → 404 `{"error":"metering disabled (PAYMENT_ENABLED)"}`
- `POST /api/billing/setup-checkout` → 404 `{"error":"payment disabled (PAYMENT_ENABLED)"}`
- `GET /api/billing/checkout-return` → 404 `{"error":"payment disabled (PAYMENT_ENABLED)"}`

Alle drei byte-identisch zum erwarteten Fail-Closed-Verhalten. Server danach sauber gestoppt (`pkill`).

## Safety-Urteil

**verdict: APPROVED**

- `approved`: true
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true
- `blockers`: keine

Reine, byte-identische Verschiebung der `/api/billing/*`-Route-Gruppe (flush-meters, setup-checkout, checkout-return) nach `src/routes/api-billing.js` via `makeBillingRoutes`, exakt nach `makeReadRoutes`-Muster. Nur 2 Dateien, 1 Commit, keine neue Dependency. Mount-Position unveraendert (nach `makeProfileRoutes`, vor `/api/onboard`, hinter Basic-Auth L594-600). Normalisierter Byte-Vergleich der drei Handler = identisch (einzige Delta: `stripeBilling` → injiziertes `billing` = selbe Instanz, `CARD_ON_FILE_STATUS` an Modulkopf). INV-2/INV-3/INV-7/INV-9/INV-10 erfuellt: `grep ^export src/server.js` = 0, Boot-Log-Zeile genau 1, Netto-Reduktion -46 Zeilen. PAYMENT_ENABLED-404-Gate byte-identisch, `requireTenant`-403 fail-closed erhalten, `claude.js`+`bridge.js` unberuehrt (`disclosureSentence` weiter verdrahtet), keine Secrets in Responses/Audit. Volle Suite 2290/2290 gruen auf beiden Backends.

**Concerns (keine Blocker):**
1. Die Dep-Liste weicht bewusst von der SPEC-Skizze ab — `flushMeters`/`bindCardFromSession`/`startCheckoutWithStaleCustomerHeal` werden im Modul direkt aus `billing/*` importiert statt injiziert. Folgt exakt dem von der SPEC vorgeschriebenen `makeReadRoutes`-Muster (verifiziert: `api-read.js` importiert `publicCall` etc. direkt aus `store/views.js`) und ist verhaltensidentisch. Legitime Ableitung, keine Abweichung.
2. `CARD_ON_FILE_STATUS` wandert von einer Inline-Deklaration zwischen den Handlern an den Modulkopf. Wert (`"card_on_file"`) und Verwendung identisch — rein positionale Verschiebung einer Konstante, verhaltensneutral.

**independentTestSummary**: Isolierte P7-SPEC-Tests (`api-flush-meters`, `billing-setup-checkout-route`, `bk2-checkout-return-plan`, `billing-card-setup`, `w4-self-service-subscribe`): 47/47 gruen. Volle `npm test` (json-Default + pg-selbstspawnende Tests = beide Backends): 2290 Tests, 2290 pass, 0 fail, Dauer ~75s. `node --check` fuer `src/routes/api-billing.js` und `src/server.js` beide OK. Kein `p5-gate-proof`-Flake aufgetreten.

## Clean-Code-Audit (S1-S4)

**verdict: PASS**

- **s1** (Blocker): []
- **s2** (Blocker): []
- **s3**: []
- **s4**: []
- **blocker**: false

`git diff master phase/slim-p7-api-billing` zeigt genau 2 Dateien (`src/server.js`: -82/+neuer Import, `src/routes/api-billing.js`: neu 90 Zeilen). Zeilenweiser Normalisierungs-Diff (`app.post`→`router.post`, `billing:stripeBilling`→`billing`) bestaetigt: die 3 Routen-Handler (flush-meters, setup-checkout, checkout-return) sind logisch byte-identisch verschoben, nur in eine `makeBillingRoutes`-Factory gekapselt (DI-Muster wie `makeReadRoutes`/`makeProfileRoutes`). Mount-Position unveraendert (nach `makeProfileRoutes`, vor `/api/onboard`). `billing`- und `requireTenant`-Instanzen sind nachweislich die EINEN Wurzel-Instanzen (`stripeBilling` einmalig importiert, `requireTenant` aus `makeRequestTenant(store)` an Zeile 145) — keine versteckte zweite Instanz. Keine toten Referenzen: grep auf der Branch zeigt `server.js` enthaelt weder die alten `flushMeters`/`bindCardFromSession`/`startCheckoutWithStaleCustomerHeal`-Imports noch die alten Routen mehr. Alle Imports im neuen Modul werden auch benutzt. PAYMENT_ENABLED-404-Gate, `requireTenant`-403-Gate und KEIN-MCP-Tool-Eigenschaft sind unangetastet mitgewandert (Safety-Gates intakt, Regel 1 aus CLAUDE.md).

Verifikation: `node --check` auf `server.js` und `api-billing.js` OK; volle Testsuite auf dem echten Phase-Branch-Commit (`830cd7c`, separates isoliertes Worktree, danach entfernt) ausgefuehrt: 2290/2290 pass, 0 fail, inkl. der billing-spezifischen Suiten (`billing-setup-checkout-route`, `bk2-checkout-return-plan`, `bk5-smoke-e2e`) mit allen Randfaellen (TOCTOU, Cross-Plan-Race, Customer-Mismatch, Stale-Customer-Self-Heal).

**passNotes**: Kommentare im neuen Modul sind praezise und stimmen mit dem tatsaechlichen Code ueberein (keine C2-Verstoesse). Faktoren-Bundelung `deps={config,store,audit,billing,tenant}` folgt dem etablierten Muster der Schwesterdateien. `CARD_ON_FILE_STATUS` bleibt einzige Konstantenquelle (G25), keine Duplikate. Einzige erwaehnenswerte, aber NICHT als S2 gewertete Beobachtung: die drei Handler wiederholen je einen 2-zeiligen `if (!config.paymentEnabled) return res.status(404)...`-Guard mit leicht unterschiedlichen Fehlertexten (G5-Kandidat) — dieses Muster existierte jedoch bereits VOR P7 unveraendert in `server.js` und wurde 1:1 mitverschoben, nicht neu eingefuehrt; als triviale, gut lesbare Guard-Clause bewertet der Auditor eine Extraktion als optional, nicht als Pflicht-Fix (Regel 3, Vorrang Lesbarkeit). Kein einziger S1/S2-Fund in der eigentlichen Aenderung.

**topTodos**:
1. Kein Blocker-Fix noetig — Phase kann gemergt werden.
2. Optional/spaeter (kein P7-Scope): den 3x wiederholten PAYMENT_ENABLED-404-Guard bei Gelegenheit in einen kleinen `requirePaymentEnabled(res)`-Helfer ziehen (G5), aber nur als eigenstaendiges Mini-Follow-up, nicht als Teil dieser Phase.

## Fix-Runden

Keine — der erste Impl-/Review-Durchlauf war bereits gruen (Gate=PASS ohne Blocker in Safety- oder Clean-Code-Review). Es gab keine FIXES-Runde.
