# Strategie: Abo-Abschluss + Unifizierung auf sundartha.com

> Status: **Analyse + Plan** (kein Produktionscode geaendert). Erstellt aus einem 3-Agenten-Investigations-Team.
> Owner-Entscheidungen gesetzt: **(D1) Unifizieren auf sundartha.com (eine Website, ein Origin)** ·
> **(D2) Ziellinie = gruen im Stripe-Test-Mode** (kein echtes Geld; Prod-Go-Live separat owner-gated) ·
> **(D3) Stripe-Setup autonom via API** (vorhandener `sk_test`-Key).

## 1. Owner-Vision (Soll-Flow)

1. Kunde geht auf die Website (sundartha.com).
2. "Get Started" → Account registrieren **und im selben Flow** direkt ein Abo abschliessen.
3. Der Abo-Schritt ist **ueberspringbar**.
4. Danach landet der Kunde auf **einer** Seite mit seinen Statistiken …
5. … der ihm **zugeordneten Nummer** …
6. … und dem **Anrufverlauf** (vorerst nur Anrufverlauf).
7. Ohne Abo steht dort: "Buche ein Abo, damit Hermes fuer dich anrufen kann." Mit Abo: ueber "Login" anmelden →
   dieselbe Seite (Anrufverlauf + Nummer).

**Kernforderung:** einheitlich, eine Website. Heute fuehlt es sich an, als werde man bei "Login"/"Get Started"
auf eine *ganz andere Website* weitergeleitet — unelegant. Genau das wird behoben.

## 2. Warum es heute zwei Dashboards gibt (Ursache der Unelganz)

- **`public/tenant.html`** — das **alte, eingebaute** Dashboard, ausgeliefert vom **Backend-Server selbst**
  (gleicher Origin wie API + Login). Funktioniert technisch, sieht aber schlicht aus.
- **`apps/web`** (sundartha.com, Astro-Static-Site `hermes-web`) — die **neuere, schoene** Seite, spaeter als
  **separater** Service auf **eigener Domain** gebaut. Huebsch, aber Cross-Origin zu Login/API → Weiterleitung
  auf `vodafone-agent.onrender.com`, und sein `/app`-Dashboard ist cross-origin tot (relative `/api`-Calls +
  Gateway-Cookie greifen nicht).

**Loesung:** Die schoene `apps/web`-App wird **vom selben Server wie API/Login** ausgeliefert (Single-Origin).
Damit verschwindet die Domain-Weiterleitung automatisch, das Cross-Origin-Problem loest sich von selbst, und
`tenant.html` wird als Nutzer-Seite **abgeschafft** (seine Logik existiert bereits als API und wird wiederverwendet).

## 3. Kernbefund (Wurzel, nicht Symptom)

**Der Abo-/Subscribe-Backend-Code ist vollstaendig UND bereits live** (Render `vodafone-agent.onrender.com`,
Deploy `d34d026`). Es fehlt **kein** Backend-Code. Zwei voneinander unabhaengige Ursachen:

### A) Config-Gate `PAYMENT_ENABLED` (Default aus)
- `src/config.js:108` Default **false** → alle Billing-Schreibrouten 404, UI versteckt Billing-Block.
- `MULTI_TENANT` + `SELF_SERVICE_ENABLED` sind in Prod bereits **an** (verifiziert: `/billing/status` → 401, nicht 404).
- **Boot-Falle:** Bei `PAYMENT_ENABLED=true` verlangt der Boot-Guard `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  **und** `NUMBER_SETUP_FEE_CENTS` ganzzahlig `> 0` (`render.yaml:97` setzt `"0"` → Boot-Stop ohne Fix).
  Ausserdem `STRIPE_STARTER_PRICE_ID`/`STRIPE_BUSINESS_PRICE_ID` (sonst `plan_unconfigured`, HTTP 500).

### B) Frontend: zwei Origins (siehe §2)

### Backend kann "Abo bei Registrierung" bereits halb
Carried-plan-Flow existiert: `setup-checkout {plan}` → `/billing/return?...&plan=` bucht + aktiviert automatisch.
Es fehlt nur die **Durchreichung des Plan-Slugs durch den OIDC-Login**.

## 4. Architektur-Entscheidung: Single-Origin

Der Gateway (Express) serviert den gebauten `apps/web`-Output am Root; `/api`, `/auth`, `/webhooks` bleiben am
selben Origin. Lokal = **ein** Server auf `localhost:3000` serviert alles (Marketing + App + API + Login). Damit:
- keine CORS-/Cross-Origin-Cookie-Komplexitaet (same-origin "just works"),
- die bestehenden relativen `/api`-Calls von `apps/web` funktionieren sofort,
- `tenant.html` als Nutzer-Seite abgeschafft.

Der Prod-Domain-Cutover (sundartha.com → unifizierter Service, OIDC-Redirect-URIs) ist **Track-B / Go-Live (P4)**
und liegt ausserhalb der Test-Mode-Ziellinie.

## 5. Verifikations-/Feedback-Loop ("Agenten sind nicht blind")

- **Layer 0 — Offline:** `npm test`, insb. `test/bk5-smoke-e2e.test.js` (ganzer Funnel, pglite, Fake-Billing).
  Nach jeder Aenderung.
- **Layer 1 — Lokaler Full-Stack im Stripe-TEST-Mode + Chrome (der e2e-Loop):** Gateway `:3000` serviert die
  unifizierte App, `PAYMENT_ENABLED=true`, **echte** Stripe-Test-Keys/Price-IDs, Postgres, lokaler Login.
  Chrome (claude-in-chrome) faehrt die echte UI: registrieren → Plan → Stripe-Test-Karte `4242…` → zurueck →
  aktiv. **Assertions via Netzwerk (PaymentIntent `succeeded`, `livemode:false`), Console und UI-State.** GIF fuer den Owner.
- **Layer 2 — Prod:** erst bei Go-Live, nur nach registriertem/verifiziertem Webhook (golive R6).

**Bekannter Blocker fuer den Browser-Loop:** lokaler Login (Prod = WorkOS-OIDC, lokal keine Creds). P0 klaert,
ob ein Test/Dev-Login-Pfad existiert oder ein **fail-closed Dev-Login-Shim** (nur mit explizitem Local-Flag, nie
in Prod) noetig ist — letzteres ist auth-sensibel und bekommt dualen Review.

## 6. Phasen

### Phase 0 — Money-Path-Beweis + lokaler Harness · *Impl-Workflow: OVERKILL → Subagents (+ Lead bei Stripe/Verifikation)*
- **Ziel:** (a) Stripe-Test-Setup autonom anlegen (Produkte/Preise via `sk_test` → Price-IDs). (b) Lokalen Stack
  booten (`PAYMENT_ENABLED=true`, echte Stripe-Test-Keys, Postgres, Test-Env getrennt von der normalen `.env`).
  (c) **Echten** Stripe-Test-Pfad am API-Level beweisen (gemintete Session wie in den Tests → `setup-checkout`/
  `subscribe` → echte Stripe-Test-Objekte). (d) Lokalen Login fuer den Browser klaeren. (e) Prod-"zwei-Websites"-
  Schmerz per Chrome belegen (GIF).
- **Verifikation:** Layer 0 gruen; reale Stripe-Test-Checkout-Session/Subscription entsteht; Stack bootet.
- **Owner-Abhaengigkeit:** keine (Test-Mode autonom). Evtl. owner-assistierter Prod-Login fuer den Dashboard-Repro.

### Phase 1 — Single-Origin-Unifizierung · *Impl-Workflow: NOETIG*
- **Ziel:** Gateway serviert den `apps/web`-Build am Root (ein Origin); `tenant.html` als Nutzer-Seite abgeschafft;
  Login + Dashboard same-origin; Dashboard zeigt **Anrufverlauf + zugeordnete Nummer** (aus `/api/self-service/state`).
- **Warum Impl-Workflow:** beruehrt `server.js` (statisches Serving, oeffentliche vs. geschuetzte Pfade, Auth
  fail-closed Regel 3) + Build-Pipeline → mehrstufig, dualer Review.
- **Verifikation:** Chrome — App laedt same-origin, Login funktioniert, Dashboard rendert Calls/Nummer, **keine**
  Weiterleitung auf die onrender-Domain.

### Phase 2 — Abo-UI im unifizierten Dashboard + Subscribe · *Impl-Workflow: NOETIG*
- **Ziel:** Plan-Kacheln + Abonnieren-Button in `apps/web` (Port aus `tenant.html`-Logik), No-Abo-Hinweis
  ("Buche ein Abo …"), Stale-Kommentare korrigiert.
- **Verifikation:** Chrome e2e — eingeloggter Nutzer ohne Abo sieht Hinweis → Abonnieren → Stripe-Test-Checkout
  → zurueck → aktiv → Dashboard zeigt Plan + Nummer. PI `succeeded`/`livemode:false`.

### Phase 3 — Get-Started: Registrieren + Abo in einem Flow · *Impl-Workflow: NOETIG*
- **Ziel:** Plan auf Get-Started/Preise waehlen → registrieren/Login → automatischer Checkout `{plan}` → aktiv →
  Dashboard. Abo-Schritt **ueberspringbar** (Skip → Dashboard mit "Buche ein Abo"-Hinweis).
- **Warum Impl-Workflow:** carry-plan durch OIDC beruehrt web-auth + onboarding + billing + Safety-Gates → dualer Review.
- **Verifikation:** Chrome e2e voller Funnel (mit + ohne Skip).

### Phase 4 — Prod Go-Live + Domain-Cutover · *Owner-gated Ops-Checkliste · DEFERRED (D2 = Test-Mode)*
- Track-B: sundartha.com → unifizierter Service, OIDC-Redirect-URIs, Stripe-Live-Keys + registrierter/verifizierter
  Webhook, Render-Env-Cutover, dann `PAYMENT_ENABLED=true` in Prod, Smoke. Reihenfolge zwingend (golive R6).

## 7. Gelockte Entscheidungen

- **D1 = Single-Origin auf sundartha.com**, `tenant.html` als Nutzer-Seite abschaffen.
- **D2 = Ziellinie gruen im Stripe-Test-Mode** (P0–P3). P4 (Prod) separat, owner-gated.
- **D3 = Stripe-Setup autonom** via `sk_test`-API (Test-Mode). Live-Keys erst bei P4.

## 8. Owner-Abhaengigkeiten (hart)

- Test-Mode: **keine** (autonom via `sk_test`).
- P4/Go-Live: Stripe-**Live**-Keys + registrierter Webhook + Render-Env-Werte (kann ich via Render-MCP vorbereiten,
  Freigabe/Werte beim Owner). Nicht Teil der aktuellen Ziellinie.
