# Phase Pay2 — Detailbericht

**Kurzfassung:** `placeHold` nutzt jetzt den in Pay1 gespeicherten Stripe-Customer + payment_method und belastet die hinterlegte Karte `off_session` (kein 3DS-Redirect, kein `return_url`). Damit ist die Wurzel des frueheren `confirm`-ohne-payment_method-400 (siehe Memory `stripe-test-mode-smoke`) behoben. `provisionNumber` verriegelt fail-closed: ohne hinterlegte Karte kein Hold und kein Provider-Call.

| Feld | Wert |
|---|---|
| Gate | **PASS** |
| finalBranch | `phase/pay2-placehold-pm` |
| Commit (Worktree) | `7fe259d54d0a84c4ec7e0767e5bb0949868badf8` |
| Tests | 696 pass / 0 fail (Baseline 693 + 3 neu) |
| `node --check` | sauber auf allen 6 Dateien |
| Smoke | gruen (`/healthz` 200; `/api/billing/setup-checkout` ohne `PAYMENT_ENABLED` -> 404) |
| Neuer npm-Dependency | keiner |
| Fix-Runden | 0 |

> Hinweis: Commit liegt nur auf `phase/pay2-placehold-pm` (Worktree). Merge nach `master`/`origin`/`upstream` ist Lead-Sache und in dieser Phase nicht erfolgt.

---

## Plan (gekuerzt)

**Ziel:** `placeHold` reicht den gespeicherten Customer + payment_method mit `off_session=true` durch; `provisionNumber` loest das Zahlungsmittel des Tenants auf und ist fail-closed ohne Karte. Reine Erweiterung bestehender Funktionen + neue Tests, **keine neue Datei**, **keine Server-Aenderung**.

**Grounding (Stand `master`, 693/693):** Pay1 ist gemergt (`7de8631`, `6e28c46`); additive Felder `tenant.stripeCustomerId`/`stripePaymentMethodId` (json + pg + `schema.sql`), `setTenantStripe`/`tenantStripe` (state-ops + Fassade), Routen `/api/billing/setup-checkout` + `/api/billing/checkout-return` existieren. Sauberer Leser `tenantStripe(s, tenantId) -> { customerId, paymentMethodId }` (null statt undefined) ist die richtige Quelle in `provisionNumber` — bewusste, clean-code-getriebene Abweichung von der Spec-Formulierung "`findTenant` lesen".

**Geplante Edits:**
1. `src/billing/ports.js` — `HoldParams`-Typedef additiv um `customerId`/`paymentMethodId` erweitern. `offSession` ist **kein** Port-Parameter (adapter-intern fix `true`, Money-Safety: nicht konfigurierbar).
2. `src/billing/stripe.js` — Konstante `OFF_SESSION = "true"`; `placeHold`-Body um `customer`, `payment_method`, `off_session` erweitern; ueberholten Kopf-Kommentar (C2: "geparkter Owner-Schritt payment_method/automatic_payment_methods") auf den off_session-Pfad aktualisieren.
3. `src/onboarding.js` — `tenantStripe` importieren; im `if (billing)`-Zweig VOR `placeHold` Customer+PM aufloesen, fail-closed bei fehlendem Zahlungsmittel (`failNumber` + Throw, kein Hold, kein Provider-Call), ids durchreichen.
4. `src/server.js` — **keine Aenderung** (`runProvisioningDrain` baut `deps.billing`/opts bereits korrekt; Sourcing liegt in `provisionNumber`, das `s` hat).

**Tests (Plan):** neuer `placeHold`-Body-Test in `test/stripe-setup-checkout.test.js` (Stub-Wiederverwendung statt Duplizierung); `seedRequested` in `test/billing-hold-capture.test.js` seedet eine Karte (`cardless`-Schalter fuer den Fail-closed-Pfad); 2 neue Pay2-Verhaltenstests (fail-closed ohne Karte / Durchreichen mit Karte). Erwartung: `pass 696`. `onboarding-service.test.js` (payment-off) bleibt unveraendert gruen = Byte-Identitaets-Beweis.

**Deterministisch geprueft:** `node --check` (Exit 0) + `npm test` (`pass 696, fail 0`) + gezielter `node --test` auf die betroffenen Dateien.

---

## Implementierungs-Zusammenfassung

Vollstaendig gemaess Plan umgesetzt:

- **`src/billing/stripe.js`** — `placeHold` sendet jetzt `customer`, `payment_method`, `off_session=true` (benannte Konstante `OFF_SESSION="true"`, Stil wie `CHECKOUT_SETUP_MODE`). Rest von `placeHold` (fetch/assertOk/return) unveraendert. Kopf-Kommentar (C2) auf den off_session-Pfad aktualisiert.
- **`src/billing/ports.js`** — `HoldParams`-Typedef additiv um `customerId`/`paymentMethodId` als opake Referenzen ergaenzt.
- **`src/onboarding.js`** — `provisionNumber` loest im billing-Zweig VOR `placeHold` das Zahlungsmittel ueber `tenantStripe(s, number.tenantId)` auf. Fail-closed (R4): fehlt `customerId` ODER `paymentMethodId` -> `failNumber` (requested -> failed) + Throw, **kein** `placeHold`, **kein** Provider-Call, kein bezahlter Orphan, kein 400 von Stripe. Bei vorhandener Karte werden `customerId`/`paymentMethodId` an `placeHold` durchgereicht.
- **`src/server.js`** — bewusst **nicht** angefasst (kleiner Blast-Radius).

**Tests (3 neu):**
- `test/stripe-setup-checkout.test.js`: NEU placeHold-Body-Test (customer + payment_method + off_session=true, manual capture).
- `test/billing-hold-capture.test.js`: `seedRequested` seedet jetzt eine Karte (`cardless`-Schalter) + 2 NEUE Pay2-Tests (fail-closed ohne Karte / Durchreichen mit Karte).

**Verifikation:** 696/696 gruen, `node --check` sauber auf allen 6 Dateien, Smoke gruen (`/healthz` 200; billing-Route ohne `PAYMENT_ENABLED` -> 404 = Gate byte-identisch). `node_modules`-Symlink nicht committet.

### Deviations

1. **`test/provisioning-worker.test.js` ebenfalls angepasst (vom Plan nicht erfasst).** Der Plan nannte `test/billing-hold-capture.test.js` als einzige Bestandstest-Aenderung. `provisioning-worker.test.js` liegt jedoch im selben Blast-Radius: 2 seiner Tests (`enqueue -> drain -> active`, `configure-Fehler -> Rollback`) treiben den billing-Pfad ueber den Worker und brachen am neuen fail-closed-Guard ab (failed statt active/released). Notwendige Folge der bewussten Verhaltensaenderung -> `seedRequested` seedet dort jetzt ebenfalls eine Karte (gleiches Muster wie billing-hold-capture; payment-off-Tests in der Datei bleiben unberuehrt). **Keine Logik geaendert, nur Seeding.** Aendert keinen Test-Count.
2. **Test-Count deckt sich.** Plan-Erwartung `pass 696` (Baseline 693 + 3 neu) wurde exakt erreicht; der provisioning-worker-Seed addiert/entfernt keinen Test.

---

## Safety-Urteil

**APPROVED.** Tests gruen auf beiden Backends; alle absoluten Regeln gehalten.

- `testsPassIndependently`: ja (696/696, 0 skipped, ~44.7s; PG-Backend nachgefahren: store-pg/multitenant/rls/budget/erasure/purge/integrity 55/55, web-auth-pg 33/33, alle pglite-gestuetzt; Pay2-Dateien isoliert 20/20).
- `safetyGatesIntact`: ja — `numberGateError`/Safety-Gates unberuehrt, Diff enthaelt keine Gate-Zeile.
- `disclosureIntact`: ja — `claude.js`/`bridge.js` byte-identisch, `disclosureSentence` fest verdrahtet.
- `authFailClosedIntact`: ja — auth/signature/middleware/server.js nicht angefasst.
- `noSecretsLeaked`: ja — `customer`/`payment_method` sind opake `cus_`/`pm_`-Referenzen (keine Secrets); kein Logging hinzugefuegt; Secret-Key bleibt ausschliesslich im `Authorization`-Header (`authHeaders`).
- `scopeRespected`: ja — 6 Dateien (3 src JSDoc/Adapter/Orchestrierung + 3 Tests), kein neuer npm-Dep, kein `.env`/`render`/`docs`/`config`-Diff.
- `behaviorAsIntended`: ja — `PAYMENT_ENABLED` bleibt DER Gate; neuer Karten-Check komplett innerhalb `if (billing)`, else-Zweig unveraendert -> Flag aus = byte-identisch (payment-off-Parity-Test gruen). Money weiter Ganzzahl Cents.

**Concerns (nicht-blockierend):**
- **Live-Pfad UNBESTAETIGT.** `off_session=true` / `customer` / `payment_method` sind doku-basiert gegen die Stripe-API, noch kein Live-Test-Mode-Smoke (im Code-Kommentar selbst markiert, deckt sich mit Memory `stripe-test-mode-smoke`). Kein Code-Blocker, aber vor `sk_live` MUSS der Owner-Smoke gruen sein.
- `tenantStripe(s, missingTenant)` gibt `{null, null}` statt zu werfen; der fail-closed `if (!customerId || !paymentMethodId)`-Check faengt das korrekt ab (kein Leck).
- Kein Push-Status geprueft: Aenderung nur auf `phase/pay2-placehold-pm`; Merge ist Lead-Sache.

---

## Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-FLAGs. Kleiner, fokussierter Diff (6 Dateien, +84/-6), der den Pay1-State-Seam (`tenantStripe`/`setTenantStripe`) sauber konsumiert. Money-Safety (R4) und alle Safety-Gates intakt; neues Verhalten mit 3 neuen Tests + 2 angepassten Seeds belegt.

### S1 (Blocker)
Keine.

### S2 (Blocker)
Keine.

### S3 (sollte behoben werden)
- **S3-1 · `src/billing/stripe.js`** — `confirm:"true"` (und ggf. `capture_method:"manual"`) stehen weiterhin als rohe Inline-String-Form-Werte, waehrend `off_session` direkt daneben jetzt die benannte Konstante `OFF_SESSION="true"` nutzt (G11 Inkonsistenz / G25). Konsequenterweise auch `confirm`/`capture_method` als benannte Konstanten. Vorbestehend, durch die neue Nachbar-Konstante nur sichtbarer geworden — bewusste Kleinigkeit.
- **S3-2 · Test-Fixtures** — die Werte `"cus_1"`/`"pm_1"` werden in 3 Testdateien (`billing-hold-capture`, `provisioning-worker`, `stripe-setup-checkout`) als nackte Literale wiederholt (G25/G16). Akzeptabel fuer Test-Fixtures; optional eine geteilte Konstante in `test/helpers.js` (neben `fakeBilling`). Kein echter Verstoss.
- **S3-3 · `src/billing/stripe.js` `placeHold`** — `placeHold` liefert nur `{ paymentIntentId }` und prueft den PaymentIntent-Status NICHT (vorbestehend, nicht im Diff geaendert). Mit dem NEUEN `off_session=true`+confirm-Pfad wird der Stripe-Status `requires_action` (z.B. 3DS-pflichtige Karte) erstmals real erreichbar: Stripe liefert dann 200 mit `status != 'requires_capture'` statt 4xx, `assertOk` wirft nicht, der Flow laeuft weiter und `captureHold` scheitert spaeter fail-closed. Kommentar nennt korrekt "live UNBESTAETIGT/Owner-Smoke". Als Owner-Smoke-Punkt vormerken, ob ein expliziter Status-Check (`== 'requires_capture'`) noetig ist. KEIN S1, da Status-Handling ausserhalb des Diff-Scopes liegt und der spaetere Capture fail-closed bleibt.

### S4 (Nit)
Keine.

**Pass-Notes:** Money strikt Ganzzahl-Cents (`amount = String(amountCents)`, keine Floats). Fail-closed sauber: fehlt `customerId` ODER `paymentMethodId` -> `failNumber` + Throw VOR `placeHold` und VOR Provider-Call -> kein bezahlter Orphan, kein Stripe-400 (genau die Wurzel aus `stripe-test-mode-smoke`). `off_session` als benannte Konstante (G25). Kommentare erklaeren das Warum (off_session statt `automatic_payment_methods`/`return_url`), sind aktuell, kein toter/auskommentierter Code. Keine positionalen Argumente — Erweiterung ueber Objekt-Destrukturierung (F1 n.z.). JSDoc in `ports.js` fuer `customerId`/`paymentMethodId` nachgezogen. Tests gut strukturiert (Build-Operate-Check), je ein Konzept, Grenzfall `cardless` explizit getestet, payment-off-Parity unveraendert gruen. Keine Safety-Gate-/Auth-/Secret-Verletzung; `cus_`/`pm_`-Referenzen sind laut state-ops opak.

**Top-Todos (Folge / Owner-Smoke):**
1. Owner-Test-Mode-Smoke: echten `off_session`-Hold mit 3DS-pflichtiger Testkarte fahren und pruefen, ob Stripe `status=requires_action` (200, nicht 4xx) liefert; falls ja, in `placeHold` einen expliziten Status-Check (`== 'requires_capture'`) ergaenzen, statt sich auf den spaeteren Capture-Fail zu verlassen (S3-3).
2. Optional/klein: `confirm` (und `capture_method`) analog zu `OFF_SESSION` als benannte Konstanten in `stripe.js` fuer Konsistenz (S3-1).

---

## Fix-Runden

**0 Fix-Runden.** Erste Implementierung war direkt PASS (Safety APPROVED + Clean-Code PASS ohne S1/S2). Keine Nachbesserungen noetig.

---

## Betroffene Dateien (absolute Pfade)

Geaendert:
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/billing/ports.js` (HoldParams-Typedef)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/billing/stripe.js` (placeHold-Body + OFF_SESSION + Kopfkommentar)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/onboarding.js` (tenantStripe-Sourcing + fail-closed-Guard)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/test/stripe-setup-checkout.test.js` (NEU: placeHold-Body-Test)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/test/billing-hold-capture.test.js` (seedRequested-Karte + 2 Pay2-Tests)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/test/provisioning-worker.test.js` (Deviation: seedRequested-Karte, nur Seeding)

Unveraendert, aber relevant:
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/server.js` (`runProvisioningDrain` — bewusst nicht angefasst)
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/src/worker/provisioning.js`
- `/Users/antonio/Mein Unternehmen/MCP/vodafone-agent/test/onboarding-service.test.js` (payment-off-Byte-Identitaets-Beweis)
