# Phase P5 — Onboarding-Funnel: gefuehrte Aktivierung (Signup -> Plan -> Pay -> aktiv)

Autoritative Scope-/Invarianten-Definition fuer Phase **P5**. Setzt P0 (kanonische Identitaet) und P3 (Webhook-Aktivierung) voraus. Behebt die drei live gemeldeten Bruchstellen: "Anmeldungsprozess weg", "Login fuehrt ohne Auth direkt auf User-Seite", "Bezahlschritt fehlt". Entscheidung (Jonas): **gefuehrter Schritt im Dashboard** (kein erzwungener Redirect). `PAYMENT_ENABLED=true`/`PROVISIONING_ENABLED=false` sind auf Render bereits gesetzt (Testmodus, kein echter Kauf).

## Problem (verifiziert, Code-gegroundet — 4-Agent-Analyse 2026-06-26)

1. **403-Deadlock (Henne-Ei), Kern-Bug:** Neuer Tenant = `suspended`. `webAuthMw` gibt fuer `status!==active` **403** (`src/web-auth.js:387`). Alle Self-Service-Routen inkl. `POST /api/self-service/billing/subscribe` + `setup-checkout` haengen an `webAuthMw` (`src/self-service-routes.js:134,180`). Aktiv wird man NUR im Subscribe-Handler (`accounts.setStatus(active)`, `:192`) — der fuer Suspended unerreichbar ist. **Selbst-Aktivierung unmoeglich.**
2. **UI-Sackgasse:** `public/tenant.html` 403-Zweig (`:187`) macht fruehes `return` VOR `renderBilling()` -> die Plan-Buttons (`#billingCard`, default `display:none`) erscheinen nie. Der Suspended-User liest "Waehle einen Plan", sieht aber keine.
3. **Subscribe aktiviert nur 1 von 3 Effekten:** Der Subscribe-Handler setzt nur `status=active`, NICHT `setKycLevel(CARD)` und NICHT Provisioning. KYC+Nummer kommen heute NUR ueber den Webhook (`customer.subscription.created/updated`, P3). Da die Subscription per `createSubscription(error_if_incomplete)` sofort `active` geboren wird, ist das Event `customer.subscription.created` — ein `.updated` zieht nicht zuverlaessig nach. Haengt also an korrekter Stripe-Event-Subscription.
4. **Kein Landing auf `/`:** `app.sundartha.com/` -> 404 (kein Index, kein Redirect). Plus Homepage `apps/web/src/pages/index.astro` ohne sichtbaren Signup-CTA.

## Ziel / Soll-Flow

Erst-Login (OIDC) legt `suspended`-Tenant an -> `tenant.html` zeigt **gefuehrte Aktivierungs-Ansicht** (Plan waehlen Starter/Business; falls keine Karte: zuerst Karte ueber Stripe Checkout) -> Subscribe -> Tenant atomar `active` + `kycLevel=CARD` + Provisioning-Trigger -> volles Dashboard (Nummer + Anrufe). Kein erzwungener Redirect; der Schritt lebt im Dashboard.

## Scope / Aenderungen (verbindlich)

1. **Billing-Onboarding-Middleware (Deadlock-Fix):** Neue Middleware-Variante (z.B. `webAuthAllowPending`) — valide Session + Tenant aufloesen (fail-closed: kein/ungueltiges Cookie -> 401), aber `status===active` NICHT verlangen. NUR auf den Self-Aktivierungs-Routen anwenden: `POST /api/self-service/billing/setup-checkout`, `GET /api/self-service/billing/return`, `POST /api/self-service/billing/subscribe`. Das active-only `webAuthMw` bleibt unveraendert fuer `/api/self-service/state` und ALLE Daten-/Settings-Routen. Suspendierte duerfen sich aktivieren, sehen aber KEINE Tenant-Daten (kein Leak). Hard-Block fuer `closed`/geloeschte Accounts bleibt (kein Reaktivieren eines hart gesperrten Tenants).
2. **Volle 3-Effekt-Aktivierung im Subscribe-Handler** (`src/self-service-routes.js`): nach erfolgreichem `createTenantSubscription` zusaetzlich `store.setKycLevel(tenant, CARD)` + `triggerTenantProvisioning(tenant)` — synchron, idempotent, payment-gegatet (bei `PROVISIONING_ENABLED=false` Dry-Run, Nummer `requested`, KEIN Kauf). Macht die Aktivierung unabhaengig von der Stripe-Event-Subscription. Der Webhook bleibt idempotenter Backup (kein Doppel-Effekt: Guard + idempotente Setter). Erfordert Injektion des Provision-Seams in `makeSelfServiceRoutes` (DI; `triggerTenantProvisioning` lebt in `server.js`).
3. **Billing-Status fuer Suspended:** schlanker Endpoint (z.B. `GET /api/self-service/billing/status`, hinter der neuen Middleware) der `{ paymentEnabled, hasCard, planSlug|null, status }` liefert — genug, dass die Aktivierungs-Ansicht "Karte noetig?" / "Plan waehlen" korrekt fuehrt, OHNE die volle (active-only) `/state`-View zu oeffnen.
4. **`public/tenant.html` gefuehrte Aktivierung:** 403-Zweig rendert die Aktivierungs-Ansicht (Plan-Buttons + Karte-hinzufuegen) statt fruehem `return`. Flow: Plan klicken -> subscribe; bei `no_card` (409) -> setup-checkout (Stripe) -> return -> erneut Plan -> active -> `refresh()` -> volles Dashboard. Brand/Markup wie P1 (Sundartha-Navy, Space Grotesk).
5. **`/` Landing-Redirect (Gateway):** `app.get("/")` -> 302 auf `/auth/login` (beseitigt 404; unauth -> Login). Kleinst moegliche Aenderung, vor der Basic-Auth gemountet wie `/auth/*`.
6. **Homepage-CTA (`apps/web/src/pages/index.astro`):** sichtbaren "Jetzt starten"-CTA ergaenzen -> `LOGIN_URL` (konsistent mit Strategie R2 "Login = Registrierung"). Minimal, Design-konsistent.
7. **render.yaml Drift:** `PUBLIC_GATEWAY_URL` im `hermes-web`-Block auf `https://app.sundartha.com` ziehen (sonst setzt ein Blueprint-Re-Sync den Funnel-Login-Origin zurueck). `PAYMENT_ENABLED` bleibt `sync:false` (Dashboard-managed).

## Invarianten (verbindlich — Absolute Regeln)

- **AUTH fail-closed:** Die neue Middleware verlangt eine GUELTIGE Session + bindet jede Wirkung an den EIGENEN Tenant (kein Cross-Tenant). Nur die drei Self-Aktivierungs-Routen sind suspended-erreichbar; alles andere bleibt active-only. Keine Daten ohne active.
- **Kein neues Calls/SMS-Gate-Loch:** P5 fuehrt keinen Pfad ein, der Calls/SMS ausloest. Provisioning bleibt hinter `PROVISIONING_ENABLED` (Dry-Run) + idempotent.
- **Signatur/Disclosure/Budget/Allowlist** unangetastet. Secrets nur via env, nie geloggt/geleakt.
- **Idempotenz:** Subscribe-seitige Aktivierung + Webhook-seitige Aktivierung duerfen zusammen NICHT doppelt provisionieren/belasten (vorhandener `tenantHasLiveNumber`-Guard + idempotente Setter).

## Akzeptanz (deterministische Tests, offline, Pflicht)

1. Suspended-Tenant erreicht `setup-checkout`/`subscribe` (neue Middleware: 200/erwartete Codes, NICHT 403); `/api/self-service/state` bleibt fuer Suspended **403** (kein Daten-Leak).
2. `subscribe` auf Suspended mit Karte-on-file -> Tenant `active` + `kycLevel=CARD` + Provisioning genau 1x (bei `PROVISIONING_ENABLED=false`: Nummer `requested`, kein Kauf). `tenantActiveSubscriber(tenant, CARD) === true`.
3. Subscribe ohne Karte -> `no_card` (409), keine Aktivierung.
4. Doppelter Subscribe / Subscribe + nachfolgendes Webhook-`created(active)` -> keine Doppel-Provisionierung (Idempotenz).
5. `GET /` -> 302 `/auth/login`.
6. `npm test` gruen (json + pglite). Neues Verhalten -> neue Tests. tenant.html: ID-/Funktions-Paritaet (kein Dangling).

## Abgrenzung (NICHT P5)

- KEINE Stripe-Webhook-Registrierung / WorkOS Staging->Prod (Jonas, Browser).
- KEIN `PROVISIONING_ENABLED=true` (P4, echtes Geld).
- KEIN erzwungener Post-Login-Redirect in Stripe (bewusst verworfen zugunsten gefuehrter Dashboard-Schritt).
- KEIN mehrstufiges Namens-/Geo-Erfassungs-Formular (Folge-Ticket; Geo faellt vorerst auf config-Default).

## Constraints

ESM, kein Build-Step (Gateway), kein TypeScript. Astro nur in `apps/web`. Kommentare deutsch OHNE Umlaute. clean-code.md harte Gates (S1/S2 = Blocker). Safety-Gates/Disclosure/Auth/Signatur unantastbar, fail-closed. NICHT pushen (Lead merged + deployed separat).
