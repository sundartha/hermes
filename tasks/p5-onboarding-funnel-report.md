# P5 — Onboarding-Funnel: gefuehrte Aktivierung (Report)

**Stand:** 2026-06-26 · **Branch:** `phase/p5-onboarding-funnel-fix1` (`04212f2`) -> ff-gemerged nach `master` (lokal, **nicht gepusht**) · **Gates:** Safety PASS, Clean-Code PASS · **Tests:** 1031 pass / 0 fail. Spec: `tasks/p5-onboarding-funnel-spec.md`.

## Umgesetzt (Kern aller 3 Live-Beschwerden)

- **403-Deadlock geloest:** neue Middleware `webAuthAllowPending` (auf extrahiertem `resolveWebSession`) — ein frisch eingeloggter `suspended` Tenant erreicht `setup-checkout`/`return`/`subscribe` + den neuen `GET /api/self-service/billing/status`. `closed`/unbekannt bleibt fail-closed (403/401). `/state` + alle Daten-/Settings-Routen bleiben **active-only** (kein Daten-Leak an Suspended). (`src/web-auth.js`, `src/self-service-routes.js`)
- **Volle 3-Effekt-Aktivierung als EINE Quelle:** neue `src/billing/activation.js` (`activatePaidTenant` = `setKycLevel(CARD)` + `setStatus(active)` + idempotentes, payment-gegatetes Provisioning). Genutzt von Subscribe-Route UND Stripe-Webhook (P3) — keine Duplizierung. Subscribe aktiviert jetzt synchron komplett (unabhaengig davon, ob Stripe `customer.subscription.created` liefert); Webhook bleibt idempotenter Backup. Bei `PROVISIONING_ENABLED=false`: Dry-Run, kein Kauf. (`src/billing/activation.js`, `src/billing/webhook.js`, `src/self-service-routes.js`, `src/server.js` DI)
- **Gefuehrte Aktivierung im Dashboard:** `public/tenant.html` 403-Zweig rendert jetzt die Plan-/Karte-Ansicht statt fruehem `return` -> der Suspended-User sieht die Plan-Buttons und kann sich selbst aktivieren.
- **`/` Landing-Redirect:** `GET /` -> 302 `/auth/login` (beseitigt den 404; unauth -> Login). Vor Basic-Auth gemountet, kein Auth-Loch.

## Review (manuell nachgeholt — Workflow-Pipeline starb am Spend-Limit)

Wie bei P3: `phase-impl-lean` lieferte die Impl + einen r1-Self-Fix, aber Review/Fix/Report-Subagents brachen mit `monthly spend limit` ab -> Gate kam fail-closed als BLOCKED zurueck. Dualer Review manuell nachgezogen:

- **Safety: PASS** — Deadlock-Fix fail-closed (gueltige Session noetig, eigener Tenant, kein Cross-Tenant), kein Daten-Leak, `activatePaidTenant` idempotent (kein Doppelkauf Subscribe+Webhook) + payment-gegatet, Subscribe fail-closed (kein no-card-Bypass), Signatur/Disclosure/Gates unangetastet, `/`-Redirect kein Loch. P3-Webhook-Status-Gate (`active/trialing`) nicht aufgeweicht.
- **Clean-Code: PASS** — `activatePaidTenant` als eine Quelle (G5), Provision-Seam injiziert (DIP), keine Magic-Numbers/toter Code/abgeschaltete Checks, Funktionslaengen/Nesting im Limit, Tests **nicht aufgeweicht** (i9/w4 korrekt nachgezogen, w4 sogar verschaerft).

### Verbleibende S3 (kein Blocker)

- `activatePaidTenant`/Webhook-ACTIVATE haben keinen `closed`-Guard (pre-existing, nicht durch P5 eingefuehrt; Self-Service ist via 403 hart geblockt) — optionale Defense-in-Depth.
- `setStatus(tenant, "active")` Magic-String (folgt der Bestands-Konvention).

## Bewusst NICHT im Diff

- **Spec-Item 7 (render.yaml `PUBLIC_GATEWAY_URL`):** der r1-Review-Fix hat den vorzeitigen Track-B-Domain-Cutover zurueckgenommen (net-zero render.yaml). Nur ein Regressions-Guard-Test (`render-auth-redirect.test.js`) bleibt. Korrekt out-of-scope.
- **Spec-Item 6 (apps/web Homepage-CTA):** nicht umgesetzt. Homepage hat aber bereits `Get started`->LOGIN_URL-CTAs (Signup = erster Login, Strategie R2). Optionaler kosmetischer Follow-up; kein Funktions-Blocker.

## Offen

- **Push + Deploy:** master ist ahead, **nicht gepusht** (manual-push-Protokoll). Go-live von P5 braucht: Push -> Gateway-Deploy (Render-MCP, autoDeploy off). hermes-web nur falls Item 6 noch kommt (eigener Static-Site-Rebuild).
- Env-Flags bereits live: `PAYMENT_ENABLED=true`, `PROVISIONING_ENABLED=false`.
- Restliste vor echtem Go-live: `HANDOVER-GOLIVE-JONAS.md` D2 (Stripe `customer.subscription.created`, WorkOS Staging->Prod, `sk_live`, E2E-Abnahme).
