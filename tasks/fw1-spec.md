# Spec FW1 — Webhook-Haertung: unbekannte Tenants + Beanstandungs-Rueckname

Quelle: `HANDOVER-FLOW-2026-09-07.md` Befunde **F3** und **F8**. Beide sitzen im selben
Stripe-Webhook-/Aktivierungs-Bereich und werden deshalb als EINE Phase gebaut.

Nicht Teil dieser Phase (ausdruecklich): F1 (Bestandsheilung, Konto-Arbeit), F2 (LLM-Anbieter-
Guthaben/Fallback), F4 (Telnyx-Guthaben), F4b, F5 (`FORCE_NUMBER_COUNTRY`), F6, F9. Keine
Aenderung an `hasActiveSubscription`, an den Safety-Gates, am Offenlegungssatz, an der
Signaturpruefung. Keine neue npm-Dependency.

---

## FW1-A — F3: Ereignisse fuer unbekannte Tenants werden sauber verworfen

### Befund (am Code belegt, nicht abgeleitet)

Live-Log, zweimal am 2026-09-07:

```
[guard] unhandledRejection: Error: setTenantSubscription: Tenant t_user_01KWSDW4JZ… nicht gefunden
```

Die Wurzel liegt NICHT im Wurf von `setTenantSubscription` (`src/store/state-ops.js`,
`setTenantSubscription` wirft bewusst fail-closed), sondern eine Ebene darueber in der
**Tenant-Aufloesung** des Webhooks. Beide Aufloesungsstellen haben dieselbe Form:

- `applyStripeWebhook` (`src/billing/webhook.js`, Zeile der Zuweisung `const tenant = tenantRef || store.findTenantBySubscription(...)`)
- `applyMoneyEvent` (`src/billing/webhook.js`, `const tenant = tenantRef ? tenantRef : (customerId && store.findTenantByCustomer(...))`)

Der **Fallback-Zweig** ist sicher: `findTenantBySubscription`/`findTenantByCustomer` liefern eine
Zeile, die es gibt, oder `null`. Der **`tenantRef`-Zweig ist es nicht**: `tenantRef` stammt aus
`metadata.tenant_ref` des Stripe-Objekts und wird ungeprueft als existierender Tenant
weitergereicht. Stripe traegt diese Metadata am Objekt dauerhaft — auch nachdem der Tenant in
unserer Datenbank nicht mehr existiert (geloeschter Datensatz, andere Umgebung). Dann ist
`tenant` truthy, die `if (!tenant)`-Wache greift nicht, und der erste Store-Schreibzugriff wirft.

Folgen heute: `unhandledRejection` (`src/process-guards.js` laesst den Prozess bewusst
weiterlaufen), haengende Antwort an Stripe, Stripe wiederholt das Ereignis — dauerhaft
erfolglos, weil der naechste Versuch exakt dasselbe tut.

### Aenderung

1. **Neuer Store-Praedikat-Seam `tenantExists(tenantId) -> boolean`**, reine Query, kein Write:
   - `src/store/state-ops.js`: `export function tenantExists(s, tenantId)` ueber das vorhandene
     `findTenant` (EINE Quelle der Existenz-Regel, G5 — keine zweite Suchlogik).
   - `src/store/json.js` und `src/store/pg.js`: Backend-Wrapper nach dem Muster von
     `findTenantBySubscription` (reine Query, KEIN `save`).
   - `src/store.js`: Re-Export auf der Fassade. Ohne diesen Re-Export ist die Methode auf der
     Fassade `undefined` und der Webhook wirft zur Laufzeit einen TypeError — dieselbe Falle, die
     der Kommentar bei `findTenantByCustomer` bereits dokumentiert.

2. **Existenz-Gate an BEIDEN Aufloesungsstellen**, unmittelbar nach der Aufloesung und VOR jedem
   Store-Schreibzugriff. Ein aufgeloester, aber unbekannter Tenant fuehrt zu: eine Audit-Zeile,
   danach regulaere Rueckkehr (kein Wurf).
   - Lifecycle-Zweig: bestehendes Ereignis `stripe_webhook_ignored` mit dem Grund
     `unknown_tenant` und der Tenant-Id im Detail.
   - Geld-Zweig: bestehendes Ereignis `stripe_money_event_ignored` mit dem Grund
     `unknown_tenant`.
   - Die beiden Gates duerfen **keine dritte Kopie** der Bedingung erzeugen: wenn sich beide
     Stellen sauber auf einen gemeinsamen kleinen Helfer (Aufloesung + Existenz in EINER
     Funktion) ziehen lassen, ist das der Vorzug (G5/S2). Der Helfer darf die
     unterschiedliche **Aufloesungsreihenfolge** der beiden Zweige nicht verwischen (Lifecycle:
     `tenantRef` -> `subscriptionId`; Geld: `tenantRef` -> `customerId`, und dort steht das
     unbedingte Audit bewusst VOR der Aufloesung) — verwischt er sie, bleiben es zwei Stellen
     mit je eigenem Gate.

3. **Wirkung:** der Handler kehrt regulaer zurueck, die Route antwortet Stripe mit 200, Stripe
   hoert auf zu wiederholen. Das Ereignis ist ueber die Audit-Zeile (Tenant-Id + Typ)
   nachvollziehbar.

### Invarianten (nicht verhandelbar)

- Ein **bekannter** Tenant durchlaeuft jeden Zweig unveraendert — byte-identisches Verhalten.
- Das Gate greift **nur** bei truthy aufgeloestem Tenant. Der `no_tenant`-Pfad bleibt exakt wie
  heute (kein zusaetzlicher Store-Zugriff): `test/gap-03-stripe-money-events.test.js` ruft
  `applyStripeWebhook` mit `store: {}` auf — jeder Store-Zugriff auf diesem Pfad ist ein
  TypeError. Die dort verwendeten Ereignisse tragen weder `tenant_ref` noch `customer`, das Gate
  darf sie deshalb nie erreichen. Dieser Test MUSS unveraendert gruen bleiben.
- Kein Aufweichen von `setTenantSubscription`: der Wurf dort bleibt, er ist der fail-closed
  Riegel. FW1-A verhindert nur, dass er mit einem nie existierenden Tenant erreicht wird.
- Kein `try/catch` um den Aufruf als Ersatz fuer das Gate (Symptom statt Wurzel).

### Tests

- Lifecycle-Ereignis (`customer.subscription.created`/`.deleted`) mit `metadata.tenant_ref` eines
  **nicht existierenden** Tenants: kein Wurf, Audit `unknown_tenant`, **kein** Store-Write
  (Store-Double zaehlt Schreibaufrufe, Erwartung 0).
- Geld-Ereignis (`charge.refunded` -> `REVOKE_PERIOD_CREDIT`) mit unbekanntem `tenant_ref`:
  kein Wurf, Audit `unknown_tenant`, kein `setTenantSubscription`.
- Regression: dasselbe Ereignis mit **bekanntem** Tenant wirkt unveraendert (Write passiert).
- Regression: `no_tenant`-Pfad (weder `tenant_ref` noch Lookup-Treffer) unveraendert.

---

## FW1-B — F8: Beanstandungs-Rueckname gilt fuer JEDEN Aktivierungspfad

### Befund (am Code belegt)

`store.clearBillingHold(tenant)` und `setTenantSubscription(tenant, { periodCreditRevoked: false })`
stehen ausschliesslich im ACTIVATE-Zweig von `src/billing/webhook.js`, hinter `if (activated)`.
Der Self-Service-Rueckkehrpfad — `activateSubscriptionFromCheckoutSession` bzw.
`subscribeAndActivate` in `src/billing/subscribe.js`, aufgerufen aus
`src/self-service-routes.js` — ruft dieselbe gemeinsame Aktivierung
`activatePaidTenant` (`src/billing/activation.js`), bekommt die Rueckname aber **nicht**.

Ein Tenant mit vorheriger Zahlungsbeanstandung waere nach der Rueckkehr `status=active`, aber:
- das Outbound-Gate bliebe zu (`billingHoldActive`, gelesen in `src/telephony/outbound-gates.js`),
- die Periodenminuten stuenden auf 0 (`includedMinutesFor`, `src/billing/plan-caps.js`:
  `if (subscription?.periodCreditRevoked) return 0`).

Fuer die drei heutigen Produktions-Tenants ist der Fall ausgeschlossen (alle
`stripe_billing_hold = null`) — der Befund ist latent, aber echt: der erste Chargeback macht ihn
zum Blocker.

### Aenderung

Die Rueckname wandert an die EINE gemeinsame Stelle: in den Erfolgszweig von `activatePaidTenant`
(`src/billing/activation.js`), also dorthin, wo `provisionCleared(provisioned)` bereits wahr ist
und `accounts.setStatus(tenant, "active")` laeuft. Aus `webhook.js` verschwinden die beiden
Aufrufe ersatzlos; der Zweig behaelt sein `if (activated) return { activated: true }`.

**Reihenfolge im Erfolgszweig — sicherheitsrelevant, nicht umsortieren:**

1. `accounts.setStatus(tenant, "active")` + `setTenantSubscription({ activationPending: false })`
   + `store.ensureTenant(tenant)` — unveraendert.
2. `store.clearBillingHold(tenant)`
3. `setTenantSubscription(tenant, { periodCreditRevoked: false })`
4. **Nachstempeln des Budget-Fensters.** `stampBudgetPeriodIfPaid` laeuft frueh in
   `activatePaidTenant` und kehrt bei aktivem Hold bewusst ohne Stempel zurueck. Genau ein
   Rueckkehrer mit Hold traefe das: Hold geraeumt, Periodenguthaben wieder da — aber ohne
   Perioden-Anker faellt das Gate auf die strengere Lebenszeit-Achse zurueck. Deshalb nach dem
   Raeumen denselben Helfer ein zweites Mal aufrufen (er ist idempotent und liefert `true` nur
   fuer ein NEU begonnenes Fenster). `budgetPeriodStarted` im Rueckgabewert ist die
   ODER-Verknuepfung beider Aufrufe — die bestehende Audit-Zeile
   (`budget_period=reset|kept`) bleibt damit wahr.

### Invarianten (nicht verhandelbar)

- Die Rueckname bleibt an **dieselbe** Bedingung gebunden wie heute: nur ein bestaetigtes Abo
  (`CONFIRMED_SUBSCRIPTION_STATUS` filtert `past_due`/`unpaid`/`incomplete` vorher als IGNORE) UND
  ein geklaertes Provisioning-Ergebnis (`provisionCleared`). **Keine Verbreiterung** — wer nicht
  aktiviert wird, behaelt Hold und Widerruf.
- `activated === false` (Provisioning nicht geklaert): Hold bleibt gesetzt, `periodCreditRevoked`
  bleibt, kein Stempel. Fail-closed wie heute.
- Fuer den Webhook-Pfad ist die Wirkung nach der Verschiebung **identisch** zu vorher (dieselben
  zwei Schreibvorgaenge, dieselbe Bedingung) — nur die Aufrufstelle wandert.
- `store.clearBillingHold` und `store.billingHoldActive` sind ab jetzt Pflicht-Methoden fuer jeden
  Store, der `activatePaidTenant` erreicht. Test-Doubles, die sie nicht haben, werfen einen
  TypeError — betroffene Doubles ergaenzen, NICHT die Produktionslogik defensiv aufweichen
  (kein `typeof store.clearBillingHold === "function"`-Ausweichen).

### Tests

- Checkout-Return-Pfad (`activateSubscriptionFromCheckoutSession`) mit gesetztem Billing-Hold und
  `periodCreditRevoked: true`: nach erfolgreicher Aktivierung ist der Hold geraeumt,
  `periodCreditRevoked === false`, und das Budget-Fenster ist gestempelt.
- Derselbe Pfad mit **nicht geklaertem** Provisioning (`activated === false`): Hold bleibt,
  `periodCreditRevoked` bleibt `true`.
- Regression Webhook-ACTIVATE: Wirkung unveraendert (bestehende Tests muessen ohne Anpassung
  gruen bleiben; noetige Anpassungen an Test-Doubles sind zulaessig und im Bericht zu nennen).

---

## Pre-Mortem (ein Jahr spaeter, die Phase war ein Fehler — was ist passiert?)

1. **Das Existenz-Gate hat ein legitimes Ereignis verworfen.** Ein Aktivierungs-Ereignis traf ein,
   bevor die Tenant-Zeile existierte; Stripe bekam 200 und wiederholte nie wieder — ein bezahlter
   Kunde blieb ohne Aktivierung. *Bewertung:* die Tenant-Zeile entsteht beim Signup, lange vor
   jedem Checkout; ein `tenant_ref` ohne Zeile ist deshalb ein toter Verweis, kein Rennen. Der
   Zustand heute ist zudem strikt schlechter (Wurf -> haengende Antwort -> ewige, immer
   erfolglose Wiederholung). *Massnahme:* die Audit-Zeile nennt Tenant-Id UND Ereignistyp, damit
   ein solcher Fall auffindbar bleibt. **Akzeptiertes Restrisiko.**
2. **Die Rueckname hat ein Geld-Gate zu frueh geoeffnet.** Ein Tenant mit offener Beanstandung
   telefonierte auf Plattformkosten weiter. *Massnahme:* die Bedingung wird nicht angefasst —
   `activated === true` heisst bestaetigtes Abo plus geklaertes Provisioning, exakt wie heute im
   Webhook. Verschoben wird die Aufrufstelle, nicht die Bedingung.
3. **Der neue Store-Seam fehlte auf einem Backend.** `tenantExists` auf der Fassade `undefined`,
   jeder Webhook wirft. *Massnahme:* beide Backends plus Fassaden-Re-Export in derselben
   Aenderung; die Tests laufen ueber beide Backends (`npm test`).

## Deterministische Abnahme

```
node --check src/billing/webhook.js src/billing/activation.js src/store.js src/store/state-ops.js src/store/json.js src/store/pg.js
npm test
```

Erwartet: `npm test` gruen. Bekannt vorbestehend rot und NICHT von dieser Phase verursacht:
`test/kv2-10-tarifpaar.test.js` (2 Faelle, auf unveraendertem `master` reproduziert). Steigt die
Zahl der roten Tests darueber hinaus, ist die Phase nicht fertig.
