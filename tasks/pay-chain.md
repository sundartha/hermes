# Pay-Chain: Karten-/Customer-Erfassung beim Onboarding (Stripe Test-Mode)

Autoritative Scope-/Design-/Invarianten-/Abgrenzungs-Definition fuer die Sub-Phasen
Pay1-Pay4. Verbindlich VOR dem Umbrella-Kontext. Jede Phase ist eigenstaendig
(eigener Gate + `npm test`), Merge im Lead, sequentiell (Pay2 baut auf Pay1 usw.).

## Umbrella-Kontext

Ziel: der Stripe Hold/Capture-Flow (P6b1) laeuft end-to-end im TEST-MODE durch.
Heute schlaegt `placeHold` (`src/billing/stripe.js`) fehl, weil `confirm=true` OHNE
`payment_method` und OHNE `customer` gesendet wird -> Stripe HTTP 400 ("must provide
a return_url ... or automatic_payment_methods[allow_redirects]=never"). In dieser
Session per Smoke verifiziert: MIT einem am Customer gespeicherten payment_method
laeuft Hold->Capture sauber (`requires_capture` -> `succeeded`).

**Owner-Entscheidung (fix, gilt fuer die ganze Kette):** Karten-Erfassung ueber
**Stripe Checkout im `setup`-Mode** (Stripe-gehostete Seite, Redirect). Die Karte wird
am Stripe-Customer gespeichert OHNE Abbuchung; der spaetere Hold/Capture nutzt den
gespeicherten Customer + payment_method `off_session`. PCI-leicht (SAQ A), SCA/3DS von
Stripe erledigt.

### Harte Invarianten (CLAUDE.md, unantastbar in JEDER Phase)

- **`PAYMENT_ENABLED` ist DER Gate.** Flag aus (Default) = byte-identisch zum heutigen
  Verhalten. Neue Routen geben bei `PAYMENT_ENABLED` aus **404** zurueck (fail-closed,
  Muster wie `/api/billing/flush-meters`). Additive NULLABLE Spalten/Felder sind fuer
  bestehende Daten byte-identisch.
- **Safety-Gates / Disclosure / Auth NIE aufweichen.** Neue Routen stehen hinter der
  bestehenden Basic-Auth (deckt `/api/*` ab) und sind KEIN MCP-Tool (kein offener
  ungegateter Geld-Endpunkt, R4). Geld-Endpunkte tenant-scoped (`requestTenant`).
- **Secrets nur via env.** `STRIPE_SECRET_KEY` nie loggen/leaken/in Responses oder
  MCP-Ausgaben. `stripe_customer_id` / `payment_method_id` sind KEINE Secrets (opake
  Referenzen wie `pi_...`) -> duerfen gespeichert/zurueckgegeben werden.
- **Geld immer als GANZZAHL Cents** (G26, nie Float). Domaenensprache: KEIN Stripe-Objekt
  verlaesst den Adapter (nur opake ids/urls als Strings).
- **Keine neuen npm-Dependencies** (global `fetch`, Node 22.x). ESM, kein Build-Step,
  kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae). Tests `node:test`,
  offline, beide Backends (json-Default + pglite). Neues Verhalten -> neuer Test.

### Ausdruecklich NICHT in dieser Session

- Live-Key `sk_live` / echtes Geld. Nur `STRIPE_SECRET_KEY=sk_test_...`.
- Echter Nummernkauf: `PROVISIONING_ENABLED` bleibt aus bzw. Dry-Run. Der end-to-end
  Hold/Capture-Smoke (Pay4) nutzt einen **Fake-Provisioner** + **echtes Stripe-Test**
  (kein realer Nummernkauf, kein Live-Key).
- Track B (URL/Repo/Infra), `git push` upstream/origin. Reine lokale Implementierung.

### Datenmodell-Erweiterung (additiv, NULLABLE)

Tenant bekommt zwei additive NULLABLE Referenzen (Muster wie `kyc_level`/`owner_name`):
- json: `tenant.stripeCustomerId`, `tenant.stripePaymentMethodId`
- pg (`src/db/schema.sql`): `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`
  und `... stripe_payment_method_id TEXT;` (idempotent; tenant-Tabelle hat KEINE RLS).
  Hydrierung (`hydrateTenants` in `src/store/pg.js`): SELECT + `if (r.x != null)`-Muster
  wie `owner_name`. Flush (`flushTenants`): in den Upsert aufnehmen (Muster wie kyc_level).

---

## Pay1 - Stripe-Customer pro Tenant + payment_method speichern (Backend)

**Zweck:** Karten-Erfassung-Backend ueber Stripe Checkout (setup). Kein UI (= Pay3),
aber per HTTP/curl/Test vollstaendig fahrbar. Kein toter Code (jede neue Funktion hat
einen Aufrufer in dieser Phase: Adapter <- Route <- Test).

**Billing-Port (`src/billing/ports.js`)** - drei neue Methoden (JSDoc-Typedefs,
KEIN Stripe-Objekt nach aussen):
- `createCustomer({ tenantRef }) -> { customerId }`
- `createSetupCheckoutSession({ tenantRef, customerId, successUrl, cancelUrl }) -> { url, sessionId }`
- `getCheckoutSessionResult(sessionId) -> { customerId, paymentMethodId }`

**Stripe-Adapter (`src/billing/stripe.js`)** - REST v1, `application/x-www-form-urlencoded`,
`authHeaders`/`assertOk`/`url`-Helfer wiederverwenden (keine Duplizierung, G5/S2):
- `createCustomer`: `POST /v1/customers`, `metadata[tenant_ref]=tenantRef` (Audit, kein
  Secret) -> `{ customerId: json.id }`.
- `createSetupCheckoutSession`: `POST /v1/checkout/sessions` mit `mode=setup`,
  `customer=customerId`, `success_url`, `cancel_url`, `metadata[tenant_ref]=tenantRef`
  -> `{ url: json.url, sessionId: json.id }`.
- `getCheckoutSessionResult`: `GET /v1/checkout/sessions/{id}?expand[]=setup_intent`
  -> `{ customerId: json.customer, paymentMethodId: json.setup_intent?.payment_method }`.
  Fehlt das payment_method -> klarer Fehler (Karte nicht gespeichert), kein stilles null.

**Store** (additive Felder s.o.) + **state-ops (`src/store/state-ops.js`)**:
- `setTenantStripe(s, tenantId, patch)` - setzt NUR uebergebene Keys aus
  `{ customerId?, paymentMethodId? }` (Muster/Validierung wie `setKycLevel`: fehlender
  Tenant wirft, reine Mutation, kein IO; Wrapper saved). Eine Funktion, <=3 Args (F1).
- Fassade-Parity in `src/store/json.js` UND `src/store/pg.js` wie `setKycLevel`
  (Wrapper + save/flush). Falls ein Surface-Count-/Contract-Test existiert
  (`store-contract`), den erwarteten Count anpassen.

**Routen (`src/server.js`)** - hinter `PAYMENT_ENABLED` (sonst 404, fail-closed,
Muster `flush-meters`), Bestand-Basic-Auth deckt `/api/*`, KEIN MCP-Tool, tenant-scoped
(`requestTenant`). `stripeBilling` wie bisher direkt importiert:
- `POST /api/billing/setup-checkout`: `requestTenant` -> tenantId; hat der Tenant noch
  keinen `stripeCustomerId` -> `createCustomer` + `setTenantStripe({customerId})` + save;
  dann `createSetupCheckoutSession` mit `successUrl =
  ${config.publicUrl}/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}` und
  `cancelUrl = ${config.publicUrl}/tenant.html?card=canceled`. Fehlt `config.publicUrl`
  -> 500 mit klarer Meldung (kein Leak). Antwort: `{ url }`. Audit `billing_setup_checkout`.
- `GET /api/billing/checkout-return?session_id=...`: `requestTenant`; ohne session_id ->
  400. `getCheckoutSessionResult(sessionId)`; **Sicherheits-Invariante (fail-closed):**
  zurueckgegebene `customerId` MUSS dem gespeicherten `tenant.stripeCustomerId` des
  anfragenden Tenants entsprechen -> sonst **403**, KEIN Store (verhindert
  cross-tenant-PM-Bindung). Sonst `setTenantStripe({customerId, paymentMethodId})` + save
  + Audit `billing_card_saved`. Antwort Pay1: `{ status: "card_on_file" }` (Redirect auf
  die UI kommt in Pay3).

**Tests (offline):**
- Adapter-Units mit `fetch`-Stub: createCustomer/createSetupCheckoutSession/
  getCheckoutSessionResult bauen die korrekten Requests (Pfad/Body/Query), parsen die
  ids, leaken NIE den Secret-Key in Fehlern.
- state-ops `setTenantStripe`: setzt nur uebergebene Keys; fehlender Tenant wirft.
- Store-Roundtrip (mind. json) fuer die neuen Felder.
- Routen: `PAYMENT_ENABLED` aus -> beide Routen 404 (byte-identisch). `PAYMENT_ENABLED`
  an -> Happy-Path gegen einen **Fake-Stripe** (kleiner http-Server im Test, gesetzt
  via `STRIPE_API_BASE`): setup-checkout legt Customer an + liefert url; checkout-return
  speichert pm; cross-tenant/mismatch -> 403.

**Deterministisch pruefbar:** `node --check` aller geaenderten .js; `npm test` gruen
(Anzahl waechst). `PAYMENT_ENABLED` aus = byte-identisch (404-Tests).

---

## Pay2 - placeHold nutzt gespeicherten Customer + payment_method

**Zweck:** der bestehende Hold/Capture/Rollback-Pfad bleibt strukturell unveraendert;
`placeHold` zieht jetzt den gespeicherten Customer + payment_method `off_session` heran
(behebt die 400-Wurzel ohne return_url, weil off_session keine Redirects erlaubt).

**Adapter (`src/billing/stripe.js`) `placeHold`** - Body zusaetzlich:
`customer=customerId`, `payment_method=paymentMethodId`, `off_session=true` (bestehend:
`amount`, `currency`, `capture_method=manual`, `confirm=true`, `metadata[tenant_ref]`,
Idempotency-Key-Header). `automatic_payment_methods` NICHT noetig (off_session).

**Port (`src/billing/ports.js`)** `HoldParams`-Typedef um `customerId`, `paymentMethodId`
erweitern (GANZZAHL Cents bleibt).

**Orchestrierung (`src/onboarding.js` `provisionNumber`)** - nur im `billing`-Zweig
(payment-off bleibt byte-identisch): VOR `placeHold` den Tenant aus dem State aufloesen
(`findTenant(s, number.tenantId)`) und dessen `stripeCustomerId` + `stripePaymentMethodId`
lesen. **Fail-closed (Money-Safety R4):** fehlt eines davon -> `failNumber` + Throw
("kein hinterlegtes Zahlungsmittel"), KEIN `placeHold`, KEIN Provider-Call. Sonst die
beiden ids in `placeHold` durchreichen. `runProvisioningDrain` (`src/server.js`) muss
NICHT geaendert werden (Sourcing liegt in `provisionNumber`, das `s` schon hat).

**Tests:**
- `placeHold`-Body (fetch-Stub) enthaelt customer + payment_method + off_session=true
  (+ confirm + capture_method=manual).
- `provisionNumber` mit billing + Tenant OHNE Karte -> fail-closed (kein placeHold-Aufruf
  am Fake-Billing-Spy, Nummer -> failed).
- `provisionNumber` mit billing + Tenant MIT Karte -> placeHold bekommt die Tenant-ids,
  Happy-Path erreicht weiter `active`.
- payment-off (billing=null) byte-identisch (Bestandstests bleiben ohne Aenderung gruen).

**Deterministisch pruefbar:** `node --check`; `npm test` gruen.

---

## Pay3 - tenant.html Karten-UI (Checkout-Redirect)

**Zweck:** der Tenant startet die Karten-Erfassung aus dem Self-Service-Dashboard.
Backend-Routen existieren aus Pay1; Pay3 ergaenzt nur die UI + Sichtbarkeit.

**Gate:** erreichbar nur bei `config.multiTenant && config.selfServiceEnabled` (Muster
der I9-Self-Service-UI) UND `PAYMENT_ENABLED` (sonst keine Backend-Routen). Flag aus =
`public/tenant.html` byte-identisch.

- `public/tenant.html`: Button "Zahlungsmethode hinzufuegen" -> `POST
  /api/billing/setup-checkout` -> `window.location = url` (Redirect zu Stripe). Nach
  Rueckkehr Status "Karte hinterlegt" anzeigen, wenn ein payment_method vorliegt.
- `GET /api/billing/checkout-return` (Pay1) auf Redirect zur UI umstellen
  (`302 -> /tenant.html?card=ok`) statt JSON. Tests entsprechend justieren.
- Sichtbarkeit: ein boolescher Tenant-Status `hasCard` (abgeleitet, KEIN id-Leak im
  Owner-Dashboard) im Tenant-View von `/api/state` bzw. der Tenant-Self-Service-Sicht.

**Tests:** Karten-UI nur bei aktiven Flags vorhanden (sonst tenant.html byte-identisch);
`hasCard`-Ableitung; checkout-return-Redirect.

**Deterministisch pruefbar:** `node --check`; `npm test` gruen; Flags aus byte-identisch.

---

## Pay4 - Test-Mode-Smoke end-to-end + Report

**Zweck:** beweisen, dass Onboard -> Customer -> payment_method -> Hold -> Capture im
**Stripe TEST-MODE** durchlaeuft, OHNE Live-Key und OHNE echten Nummernkauf.

- Smoke-Skript `scripts/smoke-stripe-payment.mjs` (kein Teil von `npm test`; nutzt
  Netz + Test-Key, wird vom LEAD ausgefuehrt): liest `STRIPE_SECRET_KEY` und **bricht
  fail-closed ab, wenn es NICHT mit `sk_test_` beginnt** (nie versehentlich live). Schritte:
  (1) `createCustomer`; (2) Test-payment_method `pm_card_visa` an den Customer attachen
  (`POST /v1/payment_methods/pm_card_visa/attach`, `customer=...`) + als default setzen;
  (3) `provisionNumber` mit `deps = { provisioner: <Fake>, billing: stripeBilling }`
  gegen echtes Stripe-Test (Fake-Provisioner kauft KEINE echte Nummer); (4) belegen, dass
  der PaymentIntent `requires_capture` -> `succeeded` erreicht. Ausgabe: kompakter
  Status, KEIN Secret. Geld immer Ganzzahl-Cents.
- Offline-Guard-Test: das Smoke-Skript verweigert `sk_live`-Keys (ohne Netz pruefbar).
- Report `tasks/pay4-report.md` (vom Workflow-Report-Agenten zusaetzlich befuellt):
  was fuer ECHTES Geld noch fehlt (Live-Key, Meter im Dashboard, `stripe_customer_id`-
  Reife/Lebenszyklus, SCA-Edge `authentication_required`).

**Deterministisch pruefbar:** `node --check`; `npm test` gruen (Offline-Guard). Der echte
Netz-Smoke wird vom Lead mit dem Test-Key gefahren (nicht im Worktree-Agenten).
