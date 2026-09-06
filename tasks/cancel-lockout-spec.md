# Spec CL1 — Kuendigung darf keinen ausweglosen Zustand hinterlassen

Autoritativ fuer Phase `CL1`. Analyse, Live-Beleg und Pre-Mortem: `PLAN-CANCEL-LOCKOUT.md`
(verbindlich mitzulesen). Diese Spec regelt Scope, Invarianten und Abgrenzung.

## Problem in einem Satz

Ein durch Kuendigung beendeter Vertrag hinterlaesst `status=suspended` PLUS eine stehengebliebene
`stripeSubscriptionId`. Das Dashboard-Gate liest den Status (403 -> Plan-Picker), das Checkout-Gate
liest die Id (409 `already_subscribed`) — der Tenant kann den Zustand nicht mehr verlassen. Am
Produktionsdatensatz belegt (`PLAN-CANCEL-LOCKOUT.md` Abschnitt 2a).

## Owner-Entscheidung (bindend fuer diese Phase)

**"Geparkt", nicht "beendet".** Der gekuendigte Tenant bleibt `suspended` und wird durch ein NEUES
Abo reaktiviert (`activatePaidTenant` setzt `clearSuspendedAt` + `active`). Es wird KEIN
Status-Wechsel auf `closed` gebaut. Gespraechshistorie und Tenant-Identitaet bleiben erhalten.

## Bausteine (alle in dieser Phase)

### B1 — Ereignis-Typ bis in den SUSPEND-Zweig durchreichen

`interpretStripeEvent` (`src/billing/webhook.js`) faltet `customer.subscription.deleted` und
`invoice.payment_failed` beide auf `action=suspend` und verliert dabei den Typ. Der SUSPEND-Zweig
muss unterscheiden koennen, OB das Stripe-Abo noch existiert.

- WELCHE Events suspendieren, aendert sich NICHT (weiterhin genau diese beiden).
- Die Unterscheidung gehoert in die reine Interpretation, nicht in eine zweite Auswertung des
  Roh-Events im Effekt-Zweig (G5: eine Auswertungsstelle).

### B2 — Referenz nur beim echten Vertragsende entwerten

Im SUSPEND-Zweig (`applySuspend`, `src/billing/webhook.js`):

- `customer.subscription.deleted` -> `store.setTenantSubscription(tenant, { subscriptionId: null, ... })`.
- `invoice.payment_failed` -> an den Abo-Referenzen wird NICHTS geaendert.

**Invariante (Geld, unantastbar):** ein Tenant im Dunning behaelt seine `subscriptionId`. Wird sie
dort geleert, kann derselbe Kunde ein ZWEITES Abo kaufen, waehrend das erste weiterlaeuft —
Doppelabbuchung. Das ist der Schutz, den `hasActiveSubscription` (`src/billing/subscribe.js:82-84`)
leistet; er bleibt unveraendert bestehen und wird NICHT auf `status` umgebaut.

Beim Bauen am Code zu klaeren (nicht raten, pruefen und im Report begruenden):
1. Wird `planSlug` mitgeleert? Er speist `deriveTenantBudgetFromPlan` (`src/store/pg.js:699`) und
   `showTiles` (`apps/web/src/components/app/BillingIsland.astro:238`).
2. Akzeptiert `setTenantSubscription` (`src/store/state-ops.js:2174-2219`) `null` im Patch, oder ist
   der Setter fail-closed gegen Null-Werte? Beide Store-Backends (json + pg) muessen es tragen.

### B3 — Bestandsdaten heilen (Reconcile gegen Stripe)

Ein aufrufbares Skript/Kommando, das fuer Tenants mit gesetzter `subscriptionId` und
`status != active` die Subscription bei Stripe abruft und das Feld NUR dann leert, wenn Stripe sie
als nicht mehr existent bzw. `canceled`/`incomplete_expired` meldet.

- **Kein Blind-Update.** Ein Tenant mit lebendem Abo darf seine Referenz nie verlieren (sonst
  laeuft die Abbuchung weiter und Kuendigen/Resume ist unmoeglich).
- Default ist Trockenlauf (nur Bericht); Schreiben nur mit ausdruecklichem Schalter.
- Fehlerhafte/unerreichbare Stripe-Antwort -> Tenant unveraendert lassen (fail-closed).

### B4 — Sackgasse "Vielleicht spaeter" schliessen

`dismissPlanChoice` (`apps/web/src/lib/subscribe.js:316-321`) blendet heute alle Bedienelemente aus
und hinterlaesst eine Ansicht ohne Link, Button oder Retry. Der Zustand braucht einen echten
Ausgang (Weg zurueck zur Plan-Auswahl und/oder Logout). Kein Zustand ohne Bedienelement.

### B5 — Verwaiste `account`-Zeile / mehrdeutiger Lookup

Der Vertragsende-Cleanup loescht den WorkOS-User, laesst dessen `account`-Zeile aber stehen. Kehrt
der Kunde zurueck, entsteht eine zweite Zeile auf demselben Tenant; `accountByTenant`
(`src/web-auth.js:632-639`) liefert bei mehr als einer Zeile `null` und Email-abhaengige Funktionen
degradieren still (`src/self-service-routes.js:289`, `:473`). Am Produktionsdatensatz bereits
eingetreten.

Regel: `accountByTenant` wird deterministisch — **juengste Zeile gewinnt, solange alle Zeilen
dieselbe Email tragen**. Tragen sie UNTERSCHIEDLICHE Emails, bleibt es fail-closed bei `null`
(dann ist die Empfaengerfrage echt mehrdeutig und darf nicht geraten werden).

## Abgrenzung (NICHT in dieser Phase)

- Kein `closed`-Status beim Vertragsende (Owner-Entscheidung oben).
- `hasActiveSubscription` wird NICHT auf `status` umgebaut (Doppelabbuchungs-Risiko).
- Das active-only-Gate von `POST /api/admin/tenants/:id/approve` bleibt, wie es ist (eigene
  Sicherheitsentscheidung, `PLAN-CANCEL-LOCKOUT.md` Abschnitt 7 Punkt 4).
- Kein Stripe-Billing-Portal, keine neue Reaktivierungs-Route.
- Keine neuen npm-Dependencies.

## Tests (Pflicht, `node:test`)

1. `customer.subscription.deleted` -> `status=suspended` UND `subscriptionId === null`.
2. `invoice.payment_failed` -> `subscriptionId` UNVERAENDERT (Doppelabbuchungs-Schutz).
3. Nach (1): `POST /api/self-service/billing/setup-checkout` antwortet NICHT 409.
4. Nach (2): `setup-checkout` antwortet WEITERHIN 409 `already_subscribed`.
5. B3-Reconcile laesst ein lebendes Abo unangetastet; leert nur den gekuendigten Fall; Trockenlauf
   schreibt nichts.
6. B5: zwei `account`-Zeilen gleicher Email -> juengste gewinnt; zwei Zeilen unterschiedlicher
   Email -> `null`.

## Verifikation

`npm test` gruen (vollstaendig, einmal am Ende), `node --check` auf jede beruehrte Datei,
Smoke-Test lokal (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + curl auf
`/api/self-service/state` und `setup-checkout`).
