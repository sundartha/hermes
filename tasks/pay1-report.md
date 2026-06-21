# Phase Pay1 — Detailbericht

**Phase:** Pay1 — Stripe-Customer pro Tenant + payment_method speichern (Backend)
**Gate:** PASS
**finalBranch:** `phase/pay1-stripe-customer`
**HEAD:** `7de86319647e7a79a9b8da0f89dbf156971c778b` (von `master` `1086e4c`)
**Tests:** 693/693 grün (679 Baseline + 14 neu + pg-Roundtrip-Assert), `fail 0`
**Committet:** ja (node_modules-Symlink NICHT committet)
**Smoke:** grün (realer Server-Boot PORT=4097, healthz=200; beide neuen Routen bei PAYMENT_ENABLED=aus → 404, byte-identisch)

---

## Plan (gekürzt)

**Baseline (selbst verifiziert):** `master` = `1086e4c`, `npm test` = 679/679 grün. Pay1 ist additiv; `PAYMENT_ENABLED`-aus muss byte-identisch bleiben. Blast-Radius: 7 Quell-Dateien + 1 SQL + 3 neue Testdateien (keine neue Env-Var → `.env.example`/`render.yaml` unberührt).

**Schlüssel-Funde:**
- `config.stripeApiBase` defaultet bei leerer Env auf `https://api.stripe.com` → der Route-Test gegen Fake-Stripe MUSS `STRIPE_API_BASE=<fake-url>` setzen (sonst Live-Netz). `STRIPE_API_BASE` steht bereits in `BASE_ENV` (leer).
- Kein `store-contract`/Surface-Count-Test; der „36 Funktionen"-Wert ist nur ein Kommentar in `src/store.js`. Neue Fassaden-Funktion(en) → Kommentar + Re-Export-Block anpassen, sonst toter/falscher Kommentar (C2) bzw. fehlende Bindung.
- Tenant-scoped Muster: `const tenant = requireTenant(req, res); if (!tenant) return;` (fail-closed 403 bei TENANT_REJECT).
- Fake-Stripe-Vorlage existiert (`startTelnyxProvisioningMock` in helpers.js) als Mini-`http.createServer`.
- `assertOk` nutzt nur `HTTP ${res.status}` → kein Secret-Leak (Adapter erbt dieses Muster).

**Edits (Vorher/Nachher) gemäß Plan:**
1. `src/billing/ports.js` — drei JSDoc-Typedefs (`SetupCheckoutParams`, `SetupCheckoutResult`, `CheckoutResult`) + drei Port-Methoden im `BillingPort`-Typedef (`createCustomer`, `createSetupCheckoutSession`, `getCheckoutSessionResult`). Kein Stripe-Objekt nach außen, nur opake Referenzen.
2. `src/billing/stripe.js` — drei Adapter-Methoden, Pfad-/Mode-Konstanten (`CUSTOMERS_PATH`, `CHECKOUT_SESSIONS_PATH`, `CHECKOUT_SETUP_MODE="setup"`); wiederverwendet `authHeaders`/`assertOk`/`url` (kein Secret-Leak; fehlendes `payment_method` → klarer Fehler statt stillem null).
3. `src/store/state-ops.js` — `setTenantStripe` (selektiver Patch via `!== undefined`, fehlender Tenant wirft, Muster wie `setKycLevel`). Empfehlung: zusätzlich reine Query `tenantStripe` gegen die dreifache `store.load()`-Lese-Duplizierung (G5/S2/G36).
4. `src/store/json.js` — Fassaden-Wrapper (Parity zu `setKycLevel`).
5. `src/store/pg.js` — Fassaden-Wrapper + Hydrierung (nur-nicht-null, Muster `kyc_level`) + Flush-Upsert.
6. `src/db/schema.sql` — zwei additive NULLABLE Spalten `stripe_customer_id`, `stripe_payment_method_id` (idempotent `ADD COLUMN IF NOT EXISTS`).
7. `src/store.js` — Re-Export-Binding + Count-Kommentar mitziehen.
8. `src/server.js` — zwei Routen hinter `PAYMENT_ENABLED` (404-Gate als erste Zeile), Basic-Auth (Bestand), tenant-scoped (`requireTenant` → 403), KEIN MCP-Tool: `POST /api/billing/setup-checkout` (Customer idempotent anlegen → setup-Mode-Checkout-URL) und `GET /api/billing/checkout-return` (customer+payment_method aus Session lesen, **fail-closed Customer-Match-Invariante** gegen fremde `session_id` → 403, kein Store). `CARD_ON_FILE_STATUS`-Konstante.

**Tests:**
- `test/state-ops-tenant-stripe.test.js` — reine ops + json-Roundtrip (kein Netz/Server/pglite).
- `test/stripe-setup-checkout.test.js` — Adapter-Units mit `fetch`-Stub (URL+Body+Parse je Methode; fehlendes payment_method wirft; Secret-Leak-Guard `doesNotMatch(/sk_test|Bearer/)`).
- `test/billing-setup-checkout-route.test.js` — Spawn gegen Fake-Stripe (`STRIPE_API_BASE`): Flag-aus 404; Happy-Path; Customer-Mismatch 403; TENANT_REJECT 403. Doku: `NUMBER_SETUP_FEE_CENTS=500` im Happy-Path zwingend (assertConfig-Boot-Refusal sonst).

**Pre-Mortem (vor Umsetzung benannte Risiken):** Cross-tenant-PM-Bindung (→ Customer-Match-Invariante); Live-Netz im Test (→ `STRIPE_API_BASE`/fetch-Stub); Secret-Leak in Fehlern (→ assertOk + Leak-Guard-Test); stilles Gate-Aus (→ 404-First-Zeile + Test); Daten-Drift json↔pg (→ nur-nicht-null-Hydrierung); falscher Surface-Count (→ Count + Re-Export mitziehen); assertConfig-Boot-Refusal (→ FEE_CENTS im Happy-Path-Test).

**Abgrenzung (NICHT in Pay1):** kein `placeHold`-Change (Pay2), keine `tenant.html`-UI/302-Redirect/`hasCard`-Sichtbarkeit (Pay3), kein E2E-Smoke/Script (Pay4), kein MCP-Tool, keine neue Dependency, kein `sk_live`, kein echter Nummernkauf, keine neue Env-Var.

---

## Implementierungs-Zusammenfassung

Pay1 exakt gemäß Plan umgesetzt, mit der vom Plan empfohlenen **Zwei-Fassaden-Variante** (`setTenantStripe` + `tenantStripe`). Branch `phase/pay1-stripe-customer` (von `master` `1086e4c`), HEAD `7de8631`. Additiv: `PAYMENT_ENABLED`-aus byte-identisch (Spawn-Test beweist beide Routen 404).

- **Port/Adapter:** neue Methoden `createCustomer`, `createSetupCheckoutSession`, `getCheckoutSessionResult` (fetch + Bearer, kein Secret-Leak, fehlendes `payment_method` → klarer Fehler).
- **State/Store:** `setTenantStripe` (Mutation) + `tenantStripe` (Query, liefert STETS `{customerId, paymentMethodId}` mit null statt undefined) in state-ops als einzige Quelle; json- und pg-Fassaden-Parity; pg-Hydrierung/Flush um beide Spalten erweitert (nur-nicht-null, Muster `kyc_level`).
- **Schema:** zwei additive NULLABLE Spalten.
- **Routen:** `POST /api/billing/setup-checkout` und `GET /api/billing/checkout-return` hinter `PAYMENT_ENABLED` + Basic-Auth + `requireTenant`, mit fail-closed Customer-Match-Invariante (cross-tenant `session_id` → 403, kein Store). Karte wird im setup-Mode OHNE Abbuchung gespeichert.
- **Tests:** 693/693 grün (679 Baseline + 14 neu + pg-Roundtrip-Assert), `node --check` auf alle geänderten Dateien sauber, Server-Boot-Smoke grün.

### Geänderte/erstellte Dateien (im Worktree, committet auf den Branch)

Quell-Edits:
- `src/billing/ports.js`
- `src/billing/stripe.js`
- `src/store/state-ops.js`
- `src/store/json.js`
- `src/store/pg.js`
- `src/store.js`
- `src/server.js`
- `src/db/schema.sql`

Test-Edits/Neu:
- `test/state-ops-tenant-stripe.test.js` (neu, 5 Tests: selektiver Patch, fail-closed wirft, null-Grenzfall, json-Roundtrip, Re-Export-Landmine)
- `test/stripe-setup-checkout.test.js` (neu, 5 Tests: createCustomer/createSetupCheckoutSession/getCheckoutSessionResult URL+Body+Parse, fehlendes payment_method wirft, Secret-Leak-Guard)
- `test/billing-setup-checkout-route.test.js` (neu, 4 Tests: Flag-aus 404, Happy-Path, Customer-Mismatch 403, TENANT_REJECT 403)
- `test/store-pg-multitenant.test.js` (erweitert: `setTenantStripe` + pg-Roundtrip-Assert analog `kyc_level`)

### Deviations (vom Plan)

1. **Surface-Count in `store.js`:** Plan ging von 36→38 aus; der reale Bestand hatte aber bereits **37** Namen (Kommentar war seit längerem stale auf 36). Mit den 2 neuen Fassaden-Funktionen ist die WAHRE Zahl **39**. Kommentar + Doc auf 39 korrigiert (C2: kein falscher Kommentar) statt auf das im Plan genannte 38.
2. **Empfohlene Plan-Variante umgesetzt** (zwei Fassaden-Funktionen `setTenantStripe` + `tenantStripe`), nicht die Minimal-Variante mit nur `setTenantStripe`. Das eliminiert die `store.load()`-Train-Wreck (G36) und die dreifache Lese-Duplizierung (G5/S2) im server.js-Handler — genau wie der Plan unter 2h als Empfehlung vorgab.
3. **`requireTenant`-Import:** server.js nutzt die bereits vorhandene, gebundene `requireTenant`-Instanz (aus `./request-tenant.js`, re-exportiert `_tenant.js`), nicht ein neuer Import direkt aus `_tenant.js` wie im Plan beschrieben.

---

## Safety-Urteil

**APPROVED.** Phase Pay1 (Stripe-Customer pro Tenant + Card-on-File-Backend) ist sauber und respektiert alle absoluten Regeln.

- **Tests unabhängig verifiziert:** `npm test` (json + pglite pg backend) = 693/693, `fail 0`. Pay1-spezifische Dateien isoliert (stripe-setup-checkout, state-ops-tenant-stripe, billing-setup-checkout-route, store-pg-multitenant) = 17/17 pass. `node --check` für alle geänderten src-Dateien OK. Tests offline (Fake-Stripe + gemocktes fetch), kein echter Stripe-Call.
- **Safety-Gates intakt:** numberGateError/Allowlist/Denylist/Budget/KYC unberührt; neue Routen lösen weder Call/SMS noch echtes Geld aus (setup-Mode = Karte speichern OHNE Abbuchung). Money irrelevant in Pay1 (kein Charge), kein `sk_live`, kein Nummernkauf.
- **Disclosure intakt:** `claude.js` + `bridge.js` byte-identisch.
- **Auth fail-closed:** beide Routen hinter Basic-Auth (nach Middleware, `safeEqual`, nicht in Exemption-Liste), `requireTenant` → 403 bei TENANT_REJECT, plus starke cross-tenant Customer-Match-Invariante gegen fremde `session_id`. `PAYMENT_ENABLED` aus = beide Routen 404 (byte-identisch, getestet).
- **Keine Secrets geleakt:** `STRIPE_SECRET_KEY` nie geloggt/in Responses/in MCP; Fehler tragen nur HTTP-Status (Leak-Guard-Test); `cus_`/`pm_` sind opake Referenzen, NICHT via `/api/state`/Views/MCP/Dashboard exponiert; audit loggt nur `tenant=<id>`.
- **Scope respektiert:** eng auf Pay1 begrenzt (12 Dateien, 1 Commit), keine ungefragten Extras, KEIN neuer npm-Dep, keine config/env/render-Änderung.

**Concerns (non-blocking):**
- Die neuen async-Routen haben kein explizites try/catch. Unter Express 4.22.2 wird eine Adapter-/Store-Rejection NICHT automatisch an errorHandler weitergereicht (worst case: hängender Request / unhandledRejection). Spiegelt aber exakt die bestehende flush-meters/onboard-Konvention (kein Pay1-Regress, außerhalb Scope) und leakt nichts — das Secret erreicht keinen Fehlerpfad (Leak-Guard-Test belegt: nur HTTP-Status in Fehlermeldung).
- Live-Stripe-Pfad weiterhin UNBESTÄTIGT — alle Tests gegen Fake-Stripe/gemocktes fetch. Owner-Smoke im Test-Mode (`sk_test`) noch offen, wie im Adapter-Kommentar geparkt. Pay1 ist reiner Backend-/Card-on-File-Scope, kein echter Charge.

---

## Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Verstöße. Sauber strukturierte Pay1-Scheibe (Karten-Erfassung via Stripe Checkout setup-Mode). 14 neue Tests grün, volle Suite 693/693.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (minor, nicht blockierend):**
  - **PAY-S3-1 · `src/billing/stripe.js` `createCustomer`** — Kein Stripe-Idempotency-Key, anders als `placeHold`/`reportMeter` im selben Adapter. Bei zwei schnell aufeinanderfolgenden `setup-checkout`-Requests desselben Tenants (vor dem ersten `store.save()`) können zwei Stripe-Customer entstehen (harmloses Duplikat; Karten-Bindung bleibt durch die Customer-Match-Invariante geschützt). Optional: stabilen Idempotency-Key (z. B. `'customer_'+tenantRef`) wie bei `placeHold` setzen.
  - **PAY-S3-2 · `src/server.js` `GET /api/billing/checkout-return`** — Stripes Browser-Redirect-Ziel (`successUrl`) liefert rohes JSON (`{status:'card_on_file'}`) statt eines Redirects ins Dashboard; der cancel-Pfad geht dagegen auf `tenant.html?card=canceled`. Asymmetrie → User landet nach Erfolg auf einer JSON-Seite. Optional: nach erfolgreicher Bindung `res.redirect` auf `tenant.html?card=saved` (oder dokumentieren, dass `tenant.html` den Return per fetch konsumiert). Reine UX/Ausdrucksstärke, kein Korrektheits-/Sicherheitsdefekt.
- **S4 (Stil/Doku):** keine.

**Pass-Notes:** Vollständige Test-Abdeckung des neuen Verhaltens (P11/T1): state-ops-Unit + json-Roundtrip + Adapter-fetch-Mock + Spawn-Routentests inkl. PAYMENT_ENABLED-404-Gate, Happy-Path, Customer-Mismatch-403 und TENANT_REJECT-403. Selektiver Patch (`customerId`/`paymentMethodId` unabhängig via `!== undefined`), fail-closed bei fehlendem Tenant (wirft), `tenantStripe` liefert STETS `{customerId, paymentMethodId}` mit null statt undefined (Grenzfall getestet). Auth fail-closed (Regel 3); bewusst KEIN MCP-Tool (R4) mit Code-Begründung. Secrets (Regel 4): Leak-Guard-Test, `cus_`/`pm_` als opake Nicht-Secrets korrekt eingestuft. Geld (G26): keine Floats eingeführt. pg: hydrate/flush um beide Spalten erweitert, additiv NULLABLE wie `kyc_level`, Round-Trip getestet, kein json↔pg-Drift. Keine Magic-Strings (`CARD_ON_FILE_STATUS`, `CHECKOUT_SETUP_MODE` benannt), kein toter/auskommentierter Code, kein neuer Dependency, keine neue Env-Var. Re-Export-Count `store.js` sauber 36→39 mitgezogen + Test gegen Re-Export-Landmine.

---

## Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) ergaben beim ersten Durchlauf PASS/APPROVED ohne S1/S2-Blocker; die zwei S3-Nits sind bewusst nicht-blockierend belassen (optional vor Merge). 0 Fix-Runden.
