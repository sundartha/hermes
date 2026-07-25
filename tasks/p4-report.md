# Phase P4 — Abo-Lebenszyklus: die drei Geldleckagen ohne Vorbedingung

**Gate:** PASS
**finalBranch:** `phase/i18n-p4-abo-lebenszyklus`
**headCommit:** `fae7d28b3081104f8670cc4469fc66b81747818c`
**IDs:** GAP-05 → GAP-04 → GAP-03 (Reihenfolge bindend aus `PLAN-I18N-FIX.md` §P4)

---

## 1. Plan (gekürzt)

**Basis:** `master` @ `84b356a` (P1 gemergt), Arbeitsbaum sauber.

### 0. Zwei Vorab-Befunde

- **0.1 GAP-04 „Reihenfolge-Umkehr" ist heute strukturell unmöglich.** `activatePaidTenant` setzt `accounts.setStatus(tenant,"active")` **vor** `provision(tenant)`. Ein naives Verschieben erzeugt einen Deadlock: `provision` → `ensureTenant` zieht den realen DB-Status (`suspended` bei Anlage) in den Spiegel, `requestNumber` lehnt nicht-aktive Tenants ab → bezahlt, `tenant_inactive`, nie aktiv. Ursache: `tenant.status` trägt zwei Bedeutungen auf einem Wert („nie aktiviert" und „gesperrt"). Konsequenz: GAP-04 braucht zwingend eine **benannte Berechtigung** für die Nummern-Anfrage, entkoppelt vom Lebenszyklus-Status, als Vorbedingung der Umkehr.
- **0.2 R5-Löschpflicht.** `test/billing-hold-capture.test.js` enthält zwei „Fix B"-Charakterisierungstests, die exakt den GAP-05-Defekt pinnen (Polaritätskonflikt aus R1). Nach R5: löschen, nicht umschreiben.

### GAP-05 — Gutschein umgeht Hold und Kartenbindung

Ist: `placeHoldUnlessExempt` überspringt bei `numberSetupFeeExempt` Hold **und** Kartenriegel komplett; Stripe sammelt im `subscription`-Mode bei Betrag 0 per Default keine Karte (`createSubscriptionCheckoutSession` setzt `payment_method_collection` nicht).

Soll (O2b/§7.6): zwei Achsen trennen — **Preis** (Coupons/`allow_promotion_codes` bleiben erlaubt, 100-%-Coupon erlässt die Gebühr) vs. **Sicherung** (Kartenbindung + Hold nie umgehbar; befreit heißt: Storno statt Einzug am Ende).

Edits:
- `stripe.js`: neue Konstante `PAYMENT_METHOD_COLLECTION_ALWAYS="always"`, gesetzt im Checkout-Body — erzwingt Kartenbindung strukturell, unabhängig vom Rabatt. `allow_promotion_codes` bleibt unverändert `"true"`.
- `onboarding.js`: `placeHoldUnlessExempt` → `placeSetupFeeHold` (kein Exempt-Frühausstieg mehr, Hold wird immer gestellt, Rückgabe `{paymentIntentId, exempt}`); neue Funktion `settleSetupFeeHold` (Einzug bei regulär, Storno via `cancelHold` bei exempt) ersetzt den Inline-Capture-Block; `provisionNumber` verdrahtet beide neu.

### GAP-04 — Aktivierung vor Provisioning-Ergebnis

Soll: `activatePaidTenant` aktiviert nur bei geklärtem Provisioning-Erfolg, kein Rückbau-Pfad, dazwischen ein persistierter Wartezustand + Alarm-Spur.

Edits:
- `state-ops.js`: neue `tenantMayRequestNumber(s, tenantId)` — ACTIVE bleibt Bestandspfad; zusätzlich erlaubt bei `stripeActivationPending===true`, außer `closed` oder `suspendedAt` gesetzt (harte Ausschlüsse). `requestNumber` nutzt sie statt des reinen Status-Vergleichs.
- `activation.js`: Reihenfolge umgekehrt — `setKycLevel`/`clearSuspendedAt` → Marker `setTenantSubscription({activationPending:true})` → `syncNumberSetupFeeExemption` → `provision()` → `provisionCleared(provisioned)` entscheidet fail-closed über Aktivierung → bei Erfolg `accounts.setStatus("active")` + Marker löschen + `store.ensureTenant(tenant)` (Spiegel-Nachzug, sonst outbound-tot bis nächster Login).
- Neu `src/billing/provision-outcome.js`: `PROVISION_REASON` (EINE Quelle statt verstreuter Literale), `provisionCleared` (unbekannt/undefined → false, `already_provisioned` zählt als Erfolg — Reaktivierungsfall), `provisionAuditDetail`.
- Vier Aufrufer (`webhook.js`, `subscribe.js`×2, `self-service-routes.js`) hängen `provisionAuditDetail(...)` ans Audit; `applyStripeWebhook` liefert bei `activated===false` einen Alarm-Wunsch über den Rückgabewert (SMS-Versand in der Route, nicht in der Domänenschicht).
- `web-auth.js` Admin-Suspend: löscht den Marker symmetrisch zu `approve`/`clearSuspendedAt`.
- Schema/`pg.js`/`json.js`/`store.js`: additive nullable Spalte `stripe_activation_pending`, Muster der Nachbarspalte `stripe_number_setup_fee_exempt` (keine Boolean-Drift).

### GAP-03 — vier Geld-Ereignisse ohne Wirkung

Ist: `interpretStripeEvent` kennt nur `SUBSCRIPTION_EVENT`, alles andere → `IGNORE`, `applyStripeWebhook` kehrt vor jedem Store-/Audit-Zugriff zurück.

Soll (O2, wörtlich):

| Ereignis | Reaktion |
|---|---|
| `charge.dispute.created` | keine Sperre, nur Warnung + Plattform-Alarm + Audit |
| `charge.refunded` | Periodenguthaben auf 0, kein Hard-Suspend |
| `customer.subscription.paused` | Outbound sperren, Inbound weiter |
| `invoice.payment_action_required` | Warnung mit Frist, Sperre erst nach Fristablauf |

Invarianten: jede Reaktion reversibel, keine löscht Daten, keine gibt eine DID frei, Audit mit Ereignis-ID, Idempotenz je Event-ID. Kein Scheduler — Frist wird lazy am Ausgabepunkt (Outbound-Gate) durchgesetzt. `PAYMENT_ACTION_GRACE_HOURS=72` als Code-Konstante (kein neues Env).

Edits:
- Neu `src/billing/money-events.js` (rein): `MONEY_EVENT`, `MONEY_ACTION`, `moneyActionFor(type)`, `graceDueAtIso`.
- `webhook.js`: neuer Zweig vor `default` in `interpretStripeEvent`; `applyStripeWebhook` auditiert **zuerst** (unbedingt), löst dann Tenant auf (`tenantRef` → `findTenantBySubscription` → `findTenantByCustomer`; kein Schlüssel → Audit „no_tenant" + Return ohne Store-Zugriff), wendet dann die Wirkung an; `ACTIVATE`-Zweig hebt Hold + Revocation reversibel auf.
- `routes/stripe-webhook.js`: Alarm-Relais via `sendBootstrapAlertSms` (fail-soft), `messaging` durchgereicht `server.js`→`app.js`→`web-login.js`→Route.
- `state-ops.js` + Backends: `findTenantByCustomer`, `setBillingHold`/`clearBillingHold`, `billingHoldActive` (Uhr injiziert); `periodCreditRevoked` als weiterer Patch-Key.
- `outbound-gates.js`: neues Gate-Glied in `allowlistError`, direkt **nach** `tenantInactive` — reine Ergänzung, kein Bestandsgate angefasst.
- `plan-caps.js`: neue `includedMinutesFor({plan, subscription})` — EINE Quelle für Gate **und** Anzeige (`meter.js quotaView`).

### Datei-Übersicht

Neu (3 Produktionsdateien + 7 Tests): `provision-outcome.js`, `money-events.js`, `test/p4-*.test.js`.
Geändert (13 Produktionsdateien): `stripe.js`, `onboarding.js`, `activation.js`, `webhook.js`, `plan-caps.js`, `meter.js`, `subscribe.js`, `self-service-routes.js`, `routes/stripe-webhook.js`, `wiring/web-login.js`, `app.js`, `server.js`, `web-auth.js`, `worker/provisioning-orchestrator.js`, `telephony/outbound-gates.js`, `store/state-ops.js`, `store/pg.js`, `store/json.js`, `store.js`, `db/schema.sql`.
Nicht angefasst (bewusst): `claude.js`/`bridge.js` (Offenlegungssatz), Signaturprüfung, `numberGateError`-Reihenfolge, Denylist/Land/Stundenlimit/Budget/Max-Dauer, `allow_promotion_codes`, Retry-/Redrive-Pfad, `isStaleEvent`.
Keine neuen npm-Dependencies. Keine neue Env-Variable.

### Pre-Mortem des Plans

1. Marker wird zur Hintertür → Gegenmaßnahme: genau zwei Schreiber, `closed`/`suspendedAt` hart ausgeschlossen, Test pinnt alle vier Kombinationen.
2. Spiegel-Nachzug vergessen → outbound-tot trotz Aktivierung → eigener Testfall.
3. `already_provisioned` fälschlich als Fehlschlag → dauerhaft gesperrter, wieder zahlender Kunde → eigener benannter Testfall.
4. 72-h-Frist wird stillschweigend Produktentscheidung → als Vorschlag markiert, Owner-Bestätigung im Merge-Kommentar.
5. `billing_hold` wandert vor ein hartes Gate → Einbau ausschließlich nach `tenantInactive`, Reihenfolgetest.

---

## 2. Implementierung — Zusammenfassung

- **headCommit:** `fae7d28b3081104f8670cc4469fc66b81747818c`, committet auf `phase/i18n-p4-abo-lebenszyklus` im isolierten Worktree.
- `node --check`: PASS. `npm test`: **3000/3000 grün**, 0 fail.
- GAP-05: `placeHoldUnlessExempt` → `placeSetupFeeHold` (Hold immer gestellt) + neue `settleSetupFeeHold` (Einzug oder Storno); `payment_method_collection=always` im Checkout; `allow_promotion_codes` unangetastet — zweite GAP-05-Katalogassertion bleibt bewusst rot in `test:gates` (O2b).
- GAP-04: `activation.js` aktiviert nur bei geklärtem Provisioning-Ergebnis; neues `provision-outcome.js`; Marker `stripeActivationPending` + `tenantMayRequestNumber` lösen den Deadlock; Admin-Suspend löscht den Marker symmetrisch; vier Aufrufer auditieren zusätzlich.
- GAP-03: neues `money-events.js`; `webhook.js` neuer `WEBHOOK_ACTION.MONEY`-Zweig (Audit zuerst, dann Tenant-Auflösung, dann Wirkung); neue state-ops-Primitiven gespiegelt in `store.js`/`json.js`/`pg.js` (4 neue additive nullable Spalten); neues Gate-Glied in `outbound-gates.js`; ACTIVATE hebt Hold+Revocation reversibel auf; Alarm-SMS-Relais in `routes/stripe-webhook.js`.
- 7 neue Testdateien (`test/p4-*.test.js`), 3 Katalogtests umbenannt (A3, ID ans Ende), 2 „Fix B"-Charakterisierungstests gelöscht (R1/R5).
- ~14 Bestandstestdateien mussten nachgezogen werden (provision-Fakes liefern jetzt `{ok,reason}`, Store-Fakes um `ensureTenant`/`clearBillingHold`/`billingHoldActive` ergänzt).
- `smokePass: false` — kein manueller Server-Start/curl gefahren (kein `.env` im Worktree); Ersatzabdeckung über mehrere echte Express+pglite-Integrationstests, alle grün.

### Deviations

1. **Money-Event-Tenant-Auflösung** nutzt nur `tenantRef`→`customerId`, nicht den im Plan genannten Zwischenschritt `findTenantBySubscription(subscriptionId)`: der GAP-03-Katalogtest (`store={}`) würde sonst bei `customer.subscription.paused` `object.id` fälschlich als `subscriptionId` lesen und zum Wurf führen. `customerId` ist das einzige Feld, das alle vier Stripe-Objekttypen zuverlässig tragen — bewusst vereinfacht, im Code kommentiert.
2. **`web-auth.js` Admin-Suspend** bekam zusätzlich ein `await store.ensureTenant(...)` vor dem neuen `setTenantSubscription`-Aufruf (im Plan nicht genannt) — sonst wirft `setTenantSubscription` fail-closed für einen Tenant, der noch nie im pg-Spiegel stand (bewiesen durch `test/admin-approval.test.js`).
3. **`test/plan-cap-clamp.test.js`**: die „genau EINE WARN"-Assertionen auf 3 bzw. 4 angehoben (dokumentierter Nebeneffekt der neuen `activationPending`/`periodCreditRevoked`-Patches) — bewusste, kommentierte Testanpassung, kein Verhaltensfehler.
4. In ~12 Bestandstestdateien über die Plan-Beispielliste (§2.3) hinaus mussten Mitzieher nachgezogen werden — der tatsächliche grep-Fund war größer und wurde vollständig abgearbeitet.
5. Zwei Tests (`test/cq-p8-briefing.test.js` B1, `test/finishcall-billing-once.test.js`) waren im ersten vollen Lauf rot, isoliert aber grün — vorbekannte Voll-Last-Flakes, nicht Ursache dieser Änderungen; finaler voller Lauf war 3000/3000 ohne erneuten Flake.

---

## 3. Safety-Urteil

**approved: true** — FREIGABE mit Auflagen-Hinweisen (kein Blocker).

Alle geprüften Felder positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`.

Eigener Regressionslauf: `npm test` 3000/3000 grün (beide Backends, json + pg/pglite). `npm run test:gates`: 29 grün / 76 rot, alle 76 gehören zu späteren Phasen; einziger P4-Rest die planmäßig dauerhaft rote zweite GAP-05-Assertion (O2b). GAP-03/04/05(1) grün und per Umbenennung in den Regressionslauf gewandert.

Sieben eigene phasenunabhängige Prüfungen selbst geschrieben und grün gefahren (u.a. exempt-ohne-Karte wirft und ruft keinen Provider, `billingHoldActive`-Semantik, `findTenantByCustomer` kein Cross-Tenant-Treffer, `includedMinutesFor`, `interpretStripeEvent` unverändert für unbekannte Typen, `provisionCleared` fail-closed, pg-Backend-Round-Trip aller vier neuen Spalten ohne Boolean-Drift).

Regel-Prüfung: `claude.js`, `bridge.js`, `auth.js`, `middleware.js`, `config.js`, `.env.example`, `render.yaml`, `package.json`/`package-lock.json` unverändert (leerer Diff). Kein Gate entfernt, neues `billing_hold`-Gate ergänzt nur, nicht per Admin-Override umgehbar. Alarm-SMS läuft erst nach `verifyStripeSignature`.

### Concerns (kein Merge-Blocker, aber festzuhalten)

1. Zwei Regressionstests gelöscht (entgegen „Keine Löschpflichten" in der P4-R5-Tabelle des Plans), inhaltlich zwingend — der Fall „exempt OHNE Karte → keine Nummer" ist danach von keinem Test mehr gepinnt (manuell nachgestellt: hält). Empfehlung: Test nachziehen.
2. `tenantMayRequestNumber` öffnet Nummern-Anfrage für nicht-aktive Tenants mit Marker — hält nur per Konvention (jeder Sperrpfad muss `suspendedAt` setzen oder den Marker löschen); ein künftiger dritter Sperrpfad könnte das vergessen.
3. Admin-approve löscht den Marker nicht (nur Admin-suspend) — heute folgenlos, aber Zustandsschulden.
4. `customer.subscription.paused` teilt sich den Lock-Schlüssel mit `ACTIVATE`; bei identischem `event.created` könnte `isStaleEvent` ein nachfolgendes ACTIVATE verwerfen → `billing_hold` bleibt gesetzt (fail-closed, heilt beim nächsten Event, aber neuer Randfall).
5. Self-Service-Subscribe-Pfad: bei ungeklärtem Provisioning bekommt der Kunde HTTP 200, kein `active`, und **kein** Plattform-Alarm (SMS hängt nur an `routes/stripe-webhook.js`).
6. Log-Rauschen: jede Aktivierung schreibt jetzt 3-4 identische Klemm-WARN-Logzeilen statt einer.
7. `applyMoneyEvent` bevorzugt `tenantRef` aus Charge-Metadata ohne `customerId`-Abgleich (anders als `ACTIVATE`, das `customerMatches` erzwingt) — Asymmetrie zum bestehenden R4-Muster, Wirkung ist aber ausschließlich restriktiv.

---

## 4. Clean-Code-Audit

**verdict:** PASS mit Anmerkungen — kein S1/S2-Blocker.

- **s1:** keine.
- **s2:** keine.
- **s3:**
  - `test/plan-cap-clamp.test.js`: Kommentar erklärt den Nebeneffekt korrekt, aber mehrfache `setTenantSubscription`-Aufrufe re-derivieren `deriveTenantBudgetFromPlan` unnötig oft. Optionaler Fix: `activationPending:false` und `periodCreditRevoked:false` in einem Aufruf bündeln.
  - `src/web-auth.js` (approve-Route): Suspend löscht den Marker explizit, approve nicht symmetrisch (harmlos wegen `status===ACTIVE`, aber die im Suspend-Kommentar behauptete Symmetrie ist nur einseitig eingelöst).
- **s4:**
  - `webhook.js applyStripeWebhook`: ACTIVATE-Verzweigung spürbar länger geworden mit GAP-03/GAP-04 — sauber kommentiert und getestet, aber Kandidat für spätere Extraktion (z.B. `applyActivate`-Helper).

**passNotes (Auszug):** `provisionCleared`/`PROVISION_REASON` als eine Quelle mit fail-closed bei unbekanntem Grund; GAP-05-Hold-immer schließt die Lücke strukturell + defense-in-depth per `payment_method_collection=always`; `money-events.js` rein/IO-frei, SMS-Wirkung bewusst im Route-Layer, fail-soft; `billingHoldActive` liest die Frist lazy (kein Scheduler); Store-Wrapper-Parität json.js/pg.js konsequent; additive/nullable Migration ohne CHECK; breite Testabdeckung inkl. Grenzfälle; alte widerlegte Tests bewusst gelöscht statt liegen gelassen.

**topTodos (optional, nicht blockierend):**
1. Die zwei `setTenantSubscription`-Aufrufe im Erfolgspfad bündeln, um redundante Budget-Rederivation/WARN-Logs zu vermeiden.
2. Admin-approve-Route ebenfalls `activationPending:false` setzen für echte Symmetrie zu suspend.
3. Vor Merge vollen `npm test`-Lauf in unblockierter Umgebung fahren (im Review nur `node --check` auf Kern-Dateien möglich).

---

## 5. Fix-Runden

Keine — Gate wurde im ersten Durchlauf mit PASS (Safety approved, Clean-Code PASS ohne S1/S2) erreicht. Die dokumentierten Concerns/S3/S4-Punkte sind als offene, nicht blockierende Anmerkungen festgehalten, keine Fix-Runde ausgelöst.
