# PLAN-BUCHUNG-PRICING.md

**Strategie-Dok fuer OpenClaw (Engineering-Spur, Lean-Workflow `phase-impl-lean.js`).**
Stand: 26.06.2026 · Repo: `jonas986/vodafone-agent` · Code-gegroundet (verifiziert gegen `src/`, `apps/web/`, `public/tenant.html`, `render.yaml`).

> Hinweis Sprache: Dieses Dok bewusst OHNE Umlaute (ue/oe/ae/ss) geschrieben, damit es 1:1 als `planDoc` von der Engineering-Kette ingestiert werden kann (CLAUDE.md-Konvention fuer Code/Docs der Kette). Display-Texte im Produkt duerfen Umlaute haben.

---

## 0. In einem Satz

Der Kunde soll im eingeloggten Produkt-Dashboard die **gleiche Pricing-Ansicht wie auf der Website** sehen (Tarif-Kacheln mit Preis + Leistungen statt nackter Buttons), einen Tarif **direkt per Stripe** buchen, woraufhin **automatisch eine Telnyx-Rufnummer** bereitgestellt wird, die zusammen mit Plan und verbleibendem **Minuten-/Token-Kontingent** im Dashboard erscheint.

---

## 1. Umbrella-Kontext

Das Produkt (`vodafone-agent`, Render-Service `srv-d8m0fhflk1mc73bno570`, live auf `app.sundartha.com`) ist ein telefonierender KI-Agent mit Multi-Tenant-Self-Service. Marketing-Seite (`apps/web/`, Astro -> Render-Static `hermes-web`, `www.sundartha.com`) zeigt unter `/preise` zwei Tarife. Beide teilen das Repo, deployen aber getrennt (siehe `render.yaml` buildFilter/ignoredPaths).

**Geschaeftlicher Kern dieser Kette:** den Funnel **Pricing -> Checkout -> Provisioning -> Dashboard** schliessen, damit ein Kunde ohne manuelles Eingreifen vom Tarif-Klick bis zur nutzbaren Rufnummer kommt.

---

## 2. Ist-Zustand (verifiziert, NICHT raten)

Vieles existiert bereits. Diese Kette ist primaer **Glue + Praesentation + die fehlende Auto-Provisioning-Verkettung** — kein Greenfield.

### 2.1 Was existiert

- **Marketing-Pricing** `apps/web/src/pages/preise.astro`: zwei Tarife als statisches Markup (`plans`-Array), CTA "Choose plan" funnelt nur auf `LOGIN_URL`. KEIN Stripe, KEIN Checkout. Kommentar im File: "echter Checkout kommt in W4".
  - Starter: `$4.99/mo` — 30 min calls, 1 number, answer+summarise, call history.
  - Business (featured "Popular"): `$9.99/mo` — 120 min calls, 1 number, outgoing calls, priority support.
- **Backend-Abo-Logik** `src/billing/subscribe.js`: `createTenantSubscription({store, billing, config, tenant, planSlug})` erstellt ein echtes monatliches Stripe-Recurring. `PLAN_SLUGS = ["starter","business"]`. Slug -> Price-Id ueber `config.stripeStarterPriceId` / `config.stripeBusinessPriceId`. Fail-closed-Gates in Reihenfolge: unknown_plan -> plan_unconfigured -> already_subscribed (409) -> no_card. Aktiviert NICHT selbst (Status-Flip im Route-Layer ueber `accounts.setStatus`).
- **Self-Service-Routen** `src/self-service-routes.js` (web-session-only; nur aktiv mit `SESSION_SECRET` + `STORE_BACKEND=pg` + `MULTI_TENANT=true` + `SELF_SERVICE_ENABLED=true`):
  - `GET  /api/self-service/state` — tenant-gefilterte Lese-Sicht (Nummer, hasCard, Abo-Status).
  - `POST /api/self-service/billing/setup-checkout` — liefert Stripe-Checkout-URL (Karte hinterlegen) -> Browser-Redirect.
  - `GET  /api/self-service/billing/return` — Stripe-Rueckkehr-Handler.
  - `POST /api/self-service/billing/subscribe` — bucht den Plan (ruft `createTenantSubscription`). `subscribeRejectStatus(reason)` mappt Gruende -> HTTP-Status.
- **Dashboard** `public/tenant.html` (auth-gated, `/app`): zeigt Agent-Rufnummer (`#agentNum`), Karten-Block (`#billingCard`, nur bei PAYMENT_ENABLED/hasCard), und einen **W4-Abo-Block** (`#subBlock`) mit zwei nackten Buttons "Starter abonnieren" / "Business abonnieren". Mit aktivem Abo: Plan + Verlaengerungsdatum, Buttons aus. 403 zeigt "Choose your plan to activate your account."
- **Provisioning** `src/worker/provisioning.js`, `src/telephony/adapters/telnyx/numbers.js`: Telnyx-Nummernkauf, gegated ueber `PROVISIONING_ENABLED` (false = Dry-Run, kein Geld), `MAX_NUMBERS`, `MAX_NUMBERS_PER_TENANT`.
- **Stripe-Webhook** `src/billing/webhook.js`: empfaengt Subscription-Events (Endpoint live: `POST /webhooks/stripe`, Test-Mode).
- **Gates (render.yaml)**: `PAYMENT_ENABLED`, `PROVISIONING_ENABLED`, `MULTI_TENANT`, `SELF_SERVICE_ENABLED`, `STRIPE_STARTER_PRICE_ID`, `STRIPE_BUSINESS_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`. Live (Stand 26.06.): alle vier Gate-Flags = `true` (echtes Provisioning aktiv).

### 2.2 Was FEHLT (die eigentliche Arbeit dieser Kette)

1. **Eine geteilte Plan-Quelle (Single Source of Truth).** Tarife sind in `preise.astro` hartkodiert; das Backend kennt nur Slugs + Price-Id-Config. Preise/Leistungen koennen zwischen Marketing und Produkt auseinanderlaufen.
2. **Pricing-Ansicht im Produkt.** Im Dashboard gibt es nur nackte Buttons, keine Kacheln mit Preis/Leistungen/Featured-Badge wie auf `/preise`.
3. **Auto-Provisioning nach Abo.** Es ist NICHT verifiziert verdrahtet, dass ein aktiv gewordenes Abo (Webhook) automatisch einen Nummernkauf fuer den Tenant ausloest. Heute wird die Owner-Nummer geseedet; der Self-Service-Tenant-Pfad "Abo -> eigene Nummer" ist die Luecke.
4. **Kontingent-/Token-Anzeige.** Dashboard zeigt die Nummer, aber nicht das verbleibende Minuten-/Token-Kontingent des gebuchten Plans.
5. **Waehrungs-Inkonsistenz.** Marketing zeigt `$`, die Stripe-Price-Ids sind in **EUR** (4,99 EUR / 9,99 EUR). Muss vereinheitlicht werden.

---

## 3. Harte Invarianten (unantastbar in JEDER Phase — aus CLAUDE.md)

- **`PAYMENT_ENABLED` ist DER Gate:** Flag aus = byte-identisches Verhalten. Neue Geld-/Billing-Routen geben ohne `PAYMENT_ENABLED` **404** zurueck. Geld immer als **Ganzzahl-Cents**.
- **Test-Mode in der gesamten Bau-Kette:** KEIN `sk_live`, KEIN echter Nummernkauf waehrend der Implementierung. `PROVISIONING_ENABLED=false` (Dry-Run) im Smoke. Echtes Geld = separater Owner-Schritt (Abschnitt 7).
- **Safety-Gates** (`numberGateError`: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- **Auth fail-closed:** Self-Service-Routen hinter `webAuthMw` (Web-Session). Neue Endpunkte standardmaessig hinter Auth. Timing-sichere Vergleiche.
- **Kein PII-/Id-Leak:** Lese-Sichten tenant-gefiltert (Muster `/api/self-service/state`), keine Stripe-Customer-/Subscription-Ids im Frontend; abgeleitete boolesche/aggregierte Werte.
- **Secrets nur via env**, nie loggen/leaken.
- **Stack:** ESM, kein Build-Step im Gateway, kein TypeScript, Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht einen `node:test`-Test (laeuft offline ohne `.env`).
- **Scope-Disziplin:** NUR die jeweilige Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies ohne explizite Spec-Freigabe.

---

## 4. Zielbild (End-to-End-Flow)

1. Kunde loggt sich ein (`/auth/login`, WorkOS), landet im Dashboard `/app`.
2. Hat er keinen aktiven Plan: das Dashboard zeigt die **Pricing-Kacheln** (Starter/Business, Preis + Leistungen + "Popular"-Badge) — identische Daten wie `/preise`.
3. Klick auf "Plan waehlen": ist keine Karte hinterlegt -> Stripe-Checkout (hosted, Test-Mode) -> Rueckkehr -> Abo-Buchung; ist eine Karte da -> direkte Buchung (`/billing/subscribe`).
4. Stripe bestaetigt das Abo (Webhook `customer.subscription.created/updated`, Status active) -> der Tenant wird aktiviert (`accounts.setStatus`) UND **automatisch eine Telnyx-Nummer provisioniert** (sofern er noch keine hat und unter den Limits liegt).
5. Dashboard zeigt: **Rufnummer** (E.164, formatiert), **aktiver Plan**, **verbleibendes Minuten-/Token-Kontingent** des laufenden Abrechnungszeitraums.

---

## 5. Phasenplan (strikt seriell, BK0 -> BK5)

Konvention pro Phase: **Ziel · Scope (in/out) · betroffene Dateien · Deterministisch erwartetes Ergebnis · Verifikation**. Jede Phase laeuft als eigener `phase-impl-lean.js`-Aufruf (Abschnitt 8). Verifikation IST der Feedback-Loop (Workflow-Regel 7): laufen lassen, vergleichen, fixen, bis PASS.

### BK0 — Plan-Katalog als Single Source of Truth (Fundament, KEINE Geld-Aenderung)
- **Ziel:** Eine geteilte, deklarative Plan-Quelle (slug, name, amountCents, currency, includedMinutes, numberCount, features[]). Backend liest sie; Marketing-`preise.astro` und In-App-Pricing konsumieren dieselbe Quelle.
- **In:** neues Modul `src/plans.js` (oder `config`-Erweiterung) mit dem Katalog (Preise als Ganzzahl-Cents, currency=`eur`); read-only Endpoint `GET /api/plans` (oder Erweiterung von `/api/self-service/state` um `planCatalog`); `preise.astro` und `subscribe.js`-Slugs gegen den Katalog ziehen.
- **Out:** kein Checkout, keine UI-Umstellung im Dashboard.
- **Dateien:** `src/plans.js` (neu), `src/self-service-routes.js` (read), `src/billing/subscribe.js` (Slug-Quelle vereinheitlichen, NICHT Logik aendern), `apps/web/src/pages/preise.astro` (aus Katalog rendern), `apps/web/src/lib/`.
- **Erwartet:** `GET /api/plans` liefert genau 2 Plaene mit `amountCents` 499/999 und `currency:"eur"`, Slugs `starter`/`business` deckungsgleich mit `PLAN_SLUGS`. `preise.astro` rendert dieselben Werte (EUR, nicht `$`).
- **Verifikation:** `npm test` (neuer Katalog-Test: Slugs == PLAN_SLUGS, Cents-Ganzzahlen, currency eur); `apps/web` Render-Test; `node --check`.

### BK1 — Pricing-Ansicht im Dashboard (Frontend, gegated, KEIN Geld)
- **Ziel:** Den nackten `#subBlock` durch Tarif-Kacheln ersetzen (Preis, Leistungen, "Popular"-Badge), Daten aus `GET /api/plans`. Aktiver Plan wird als solcher markiert.
- **In:** `public/tenant.html` Pricing-Kachel-UI; rendert ohne Abo die Kacheln mit CTA, mit Abo den aktiven Plan + Verlaengerungsdatum (bestehende `#subStatus`-Logik beibehalten).
- **Out:** Checkout-Verdrahtung (BK2), Provisioning (BK3).
- **Dateien:** `public/tenant.html` (Markup + JS-Render), ggf. kleine CSS-Erweiterung.
- **Erwartet:** Bei `PAYMENT_ENABLED=true` zeigt `/app` zwei Kacheln mit Preisen+Leistungen; bei aktivem Abo erscheint der aktive Plan als Badge, keine doppelte Buchungsoption. Bei `PAYMENT_ENABLED` aus: Block bleibt unsichtbar (byte-identisch).
- **Verifikation:** Smoke gegen lokalen Server (`SKIP_TWILIO_SIGNATURE_CHECK=true`, curl `/app` + `/api/self-service/state`), DOM-Marker-Check; bestehende `pages`/`render`-Tests gruen.

### BK2 — Checkout-Verkettung: Kachel-CTA -> Stripe (GELD, gegated `PAYMENT_ENABLED`)
- **Ziel:** CTA jeder Kachel verdrahtet den vorhandenen Flow: keine Karte -> `POST /billing/setup-checkout` (hosted Stripe Checkout, Redirect) -> `GET /billing/return` -> `POST /billing/subscribe {plan}`; Karte vorhanden -> direkt `subscribe`.
- **In:** Frontend-Verdrahtung in `tenant.html`; Route-Glue, sodass nach `billing/return` der ausgewaehlte Plan gebucht wird (Plan-Mitnahme ueber Session/Query, kein Id-Leak).
- **Out:** Auto-Provisioning (BK3). KEINE neue Stripe-Surface (hosted Checkout wiederverwenden, kein PCI-Eigenformular).
- **Dateien:** `public/tenant.html`, `src/self-service-routes.js` (return -> subscribe Glue), ggf. `src/billing/subscribe.js` (nur falls Gate-Reason fehlt).
- **Erwartet (Test-Mode, Fake-BillingPort):** `POST /billing/subscribe {plan:"starter"}` mit Karte-on-file -> `200 {status:"subscribed"}`, `store` haelt `subscriptionId`; ohne Karte -> Redirect zu Checkout; unbekannter Slug -> 400; bereits aboniert -> 409; `PAYMENT_ENABLED` aus -> **404**.
- **Verifikation:** `node:test` mit injiziertem Fake-BillingPort (alle Gate-Reasons -> Status-Mapping); curl-Smoke gegen lokalen Server; `PAYMENT_ENABLED`-aus-Test beweist 404 + byte-identisch.

### BK3 — Auto-Provisioning nach Abo-Aktivierung (gegated `PROVISIONING_ENABLED`, Dry-Run in der Kette)
- **Ziel:** Wird ein Abo aktiv (Stripe-Webhook subscription active), und hat der Tenant noch keine aktive Nummer und liegt unter `MAX_NUMBERS(_PER_TENANT)`, wird **automatisch** ein Telnyx-Nummernkauf angestossen und die Nummer dem Tenant zugewiesen.
- **WICHTIG (Plan-Phase zuerst):** Erst `src/billing/webhook.js` + `src/worker/provisioning.js` lesen und die HEUTIGE Verkettung verifizieren — existiert ein Link schon teilweise? Nur die nachweisbare Luecke schliessen.
- **In:** Webhook-Handler: bei subscription active idempotent ein Provisioning-Job enqueuen/ausfuehren; Zuweisung im Store. Idempotent (zweiter Webhook = kein zweiter Kauf, Muster Idempotency-Key).
- **Out:** echter Kauf. In der Kette bleibt `PROVISIONING_ENABLED=false` -> Dry-Run reserviert eine Pseudo-Nummer, kein Geld. Safety-/Land-Gates unveraendert.
- **Dateien:** `src/billing/webhook.js`, `src/worker/provisioning.js`, `src/store.js` (Zuweisung), ggf. `src/onboarding.js`.
- **Erwartet (Dry-Run):** simulierter signierter Webhook (Test-Secret) "subscription active" -> Provisioning-Job laeuft -> Store enthaelt eine (Dry-Run-)Nummer fuer den Tenant; erneuter identischer Webhook -> keine zweite Nummer; Limit ueberschritten -> kein Kauf, Audit-Eintrag.
- **Verifikation:** `node:test` auf Webhook-Handler (Signatur, Idempotenz, Limit) + Provisioning-Worker mit Dry-Run-Adapter; kein Netzwerk, kein Geld.

### BK4 — Dashboard: Rufnummer + Plan + Kontingent ("Tokens") anzeigen (Frontend + Lese-API, KEIN Geld)
- **Ziel:** Dashboard zeigt die zugewiesene Rufnummer (existiert: `#agentNum`), den aktiven Plan, und das **verbleibende Minuten-/Token-Kontingent** des laufenden Zeitraums (aus `meter`/Usage abgeleitet).
- **Begriff "Tokens":** = verbleibende **Gespraechsminuten** des Monatskontingents (Starter 30, Business 120). Falls ihr ein anderes Credit-/Token-Modell wollt, hier festlegen (Owner-Entscheidung 7.2).
- **In:** Lese-Sicht um `{plan, includedMinutes, usedMinutes, remainingMinutes}` erweitern (tenant-gefiltert, abgeleitet, kein Id-Leak); Dashboard-Render.
- **Out:** Echtzeit-Metering-Umbau, Rechnungs-PDF, Plan-Wechsel/Cancel (Folge-Ticket).
- **Dateien:** `src/self-service-routes.js` (state-Erweiterung), `src/billing/meter.js` (Usage-Read), `public/tenant.html`.
- **Erwartet:** `GET /api/self-service/state` enthaelt Plan + Kontingentfelder; `/app` zeigt Nummer + Plan + "X von Y Minuten verbleibend". Ohne Abo: neutraler Leerzustand.
- **Verifikation:** `node:test` (Ableitung used/remaining, Grenzwerte 0/voll); Smoke gegen lokalen Server (DOM-Marker).

### BK5 — Test-Mode Smoke end-to-end + Report (Verifikation)
- **Ziel:** Den ganzen Funnel im Test-Mode beweisen.
- **Setup:** lokaler Server mit `PAYMENT_ENABLED=true`, `MULTI_TENANT=true`, `SELF_SERVICE_ENABLED=true`, `STORE_BACKEND=pg` (oder Test-Store), `PROVISIONING_ENABLED=false` (Dry-Run), Stripe-TEST-Keys, `SKIP_TWILIO_SIGNATURE_CHECK=true`.
- **Ablauf (jeweils erwarteter Status/Store-State dokumentiert):** Login -> Pricing-Kacheln sichtbar -> Plan waehlen -> (Karte hinterlegen) -> subscribe (200, subscriptionId im Store) -> simulierter Webhook active -> Tenant aktiv + Dry-Run-Nummer zugewiesen -> Dashboard zeigt Nummer + Plan + Kontingent.
- **Verifikation:** geskriptetes curl-Smoke (in `tasks/`), `npm test` gesamt gruen, Report nach `tasks/bk-chain-report.md`.

---

## 6. Lean-Workflow: konkrete Aufrufe

Pro Phase ein Aufruf von `phase-impl-lean.js` (args-driven, fail-closed; KEIN resume). Der Lead merged danach den ZURUECKGEGEBENEN `finalBranch`.

```
Workflow({ scriptPath: ".claude/workflows/phase-impl-lean.js", args: {
  phaseId: "BK0",
  phaseTitle: "Plan-Katalog als Single Source of Truth",
  branch: "phase/bk0-plan-catalog",
  baseBranch: "master",
  planDoc: "PLAN-BUCHUNG-PRICING.md",
  maxFixRounds: 2
}})
```

Folgephasen analog: `BK1`/`phase/bk1-pricing-view`, `BK2`/`phase/bk2-checkout-wire`, `BK3`/`phase/bk3-auto-provision`, `BK4`/`phase/bk4-dashboard-quota`, `BK5`/`phase/bk5-smoke`. Optional je Phase eine `specFile` (z.B. `tasks/bk2-checkout.md`) anlegen, wenn der Scope-Abschnitt hier zu knapp wird — die Phasen-Sektion oben ist dann die autoritative Quelle.

**Reihenfolge strikt seriell.** BK2 setzt BK0/BK1 voraus; BK3 setzt ein gebuchtes Abo (BK2) voraus; BK4 zeigt, was BK2/BK3 erzeugen.

---

## 7. Owner-Entscheidungen (offen — bitte vor BK0 fixieren)

1. **Waehrung & Preise:** Anzeige in **EUR** vereinheitlichen (Starter 4,99 EUR, Business 9,99 EUR), `$` in `preise.astro` ist ein Bug. Stimmen die Betraege mit den hinterlegten Stripe-Price-Ids? *(Empfehlung: ja, EUR, Betraege wie Price-Ids.)*
2. **"Tokens"-Semantik:** = verbleibende Gespraechsminuten des Monatskontingents. Alternative: separates Credit-/Token-Guthaben. *(Empfehlung: Minuten-Kontingent, weil Tarife in Minuten definiert sind — kein neues Abrechnungsmodell.)*
3. **Checkout-Form:** hosted Stripe Checkout (Redirect, bestehend, keine neue PCI-Surface) vs. eingebettetes Payment Element. *(Empfehlung: hosted Checkout beibehalten.)*
4. **Provisioning-Trigger:** Nummernkauf strikt erst bei Abo-`active` (Webhook), nicht beim Klick. *(Empfehlung: ja — kein Kauf ohne bestaetigte Zahlung.)*
5. **Plan-Wechsel/Kuendigung:** in dieser Kette NUR Anzeige, Up-/Downgrade + Cancel als Folge-Ticket. *(Empfehlung: ja, Scope halten.)*

---

## 8. Go-Live (Owner-only, AUSSERHALB der autonomen Kette)

Die Bau-Kette bleibt durchgehend Test-Mode (kein echtes Geld). Echtbetrieb ist ein bewusster Owner-Schritt am Render-Service `vodafone-agent`:
- `STRIPE_SECRET_KEY` auf Live-Key, Live-Price-Ids hinterlegen, Live-Webhook-Secret.
- `PROVISIONING_ENABLED=true` => abgeschlossener Checkout loest **echten Telnyx-Nummernkauf (echtes Geld)** aus, auch wenn Stripe im Testmodus laeuft (bekannte Stolperfalle aus dem Projekt).
- `MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT` als Kosten-Notbremse pruefen.
- Manuelles Deploy (hermes-web autoDeploy=yes; vodafone-agent autoDeploy=off, bewusst).

---

## 9. Verworfene / abgegrenzte Ansaetze

- **Pricing-Daten doppelt pflegen** (Marketing + Produkt getrennt): verworfen -> Single Source of Truth (BK0), sonst Preis-Drift.
- **Eigenes Kartenformular im Dashboard:** verworfen -> hosted Stripe Checkout, keine PCI-Surface.
- **Nummernkauf beim Tarif-Klick:** verworfen -> erst bei bestaetigtem Abo (Webhook), kein Kauf ohne Zahlung.
- **Neues Token-/Credit-Abrechnungsmodell:** ausserhalb des Scopes -> Minuten-Kontingent wiederverwenden.

---

## 10. Restrisiken / Folge-Arbeit (NICHT in dieser Kette)

- Plan-Wechsel/Upgrade/Downgrade + Kuendigung (nur Anzeige hier).
- Echtzeit-Metering-Genauigkeit / Rechnungs-PDFs.
- Mehrere Nummern pro Tenant (`MAX_NUMBERS_PER_TENANT>1`).
- Dunning/fehlgeschlagene Zahlungen jenseits des Webhook-Events `invoice.payment_failed` (Endpoint existiert, Lifecycle-Politur offen).
