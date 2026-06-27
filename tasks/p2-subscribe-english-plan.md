# P2 — English /app dashboard + Subscribe flow (implementation spec)

Read-only explored against live code. P1 (single-origin) is already in code. Target = the unified `apps/web` `/app`
dashboard; `public/tenant.html` is the working reference to port from. Finish line: green in Stripe TEST mode,
verified via Chrome. Code comments stay German-without-umlauts (CLAUDE.md); ONLY user-facing strings become English.

## Locked owner decisions
- **D1 placement**: no-sub prompt ("Subscribe so Hermes can call for you") + plan tiles live in the **Billing
  section** (active path) AND in the reworked **pending region** (suspended path). Faithful port of tenant.html, lower risk.
- **D2 return redirect**: make the `/tenant.html -> /app` redirect **preserve the query string** (server.js) — NOT
  repoint the backend constants. Zero backend-test churn.
- **D3 language labels**: English names ("Automatic (by number)", "German", "French", "English").

## CRITICAL fix (Risk 1) — server.js query-preserving redirect
The backend still redirects card/subscribe returns to `/tenant.html?card=ok` / `?sub=ok` (self-service-routes.js
constants + server.js cancelUrl). P1's `/tenant.html -> /app` redirect (server.js ~:338 `res.redirect(302, APP_PATH)`)
DROPS the query, so BillingIsland's `?sub=ok`/`?card=ok` handler never fires. FIX: forward the original query to /app,
e.g. redirect to `APP_PATH + (req.originalUrl has search ? that search : "")`. Backend tests assert the FIRST hop
(`Location: /tenant.html?sub=ok`) which is unchanged -> green. Keep it a named, commented change.

## Part 1 — English string map (translate user-facing strings only)
- `apps/web/src/layouts/App.astro`: `<html lang="de">` -> `lang="en"`.
- `apps/web/src/pages/app/index.astro`: dashNav labels Ueberblick/Anrufe/Einstellungen/Abrechnung -> Overview/Calls/
  Settings/Billing (keep the `#anrufe/#einstellungen/#abrechnung` href+id anchors as-is, not user-facing); "Lade…"->
  "Loading…"; "Anmeldung erforderlich"/body/"Anmelden" -> "Sign in required"/"Please sign in to manage your phone
  assistant."/"Sign in"; pending region text (reworked in Part 2, translate fallback); "Etwas ist schiefgelaufen"/body/
  "Erneut versuchen" -> "Something went wrong"/"The app couldn't load just now. Check your connection and try again."/
  "Try again"; "Dein Bereich"/"Willkommen, " -> "Your area"/"Welcome, "; aria-label "Bereichsnavigation" -> "Section
  navigation"; "Diese App benoetigt JavaScript." -> "This app requires JavaScript."
- `components/app/AgentChip.astro`: "Agent-Rufnummer" -> "Agent number"; NO_NUMBER_TEXT "Noch keine Nummer zugewiesen"
  -> "No number assigned yet".
- `components/app/DashboardStats.astro`: labels Anrufe gesamt/Diese Woche/Diesen Monat/Gespraechszeit gesamt/Eingehend
  / Ausgehend/Mit Zusammenfassung -> Total calls/This week/This month/Total talk time/Inbound / Outbound/With summary;
  "Ueberblick"->"Overview"; "Aus deinem Anruf-Verlauf abgeleitet."->"Derived from your call history."; quota note ->
  "We'll show your exact remaining quota as soon as it's available in your account."
- `components/app/CallsIsland.astro`: "Anrufe"->"Calls"; "Deine letzten Telefonate (read-only)."->"Your recent calls
  (read-only)."
- `components/app/CalendarIsland.astro`: "Kalender"->"Calendar"; "Darauf greift der Agent zu."->"Your agent reads from this."
- `components/app/ActionItemsIsland.astro`: already English, no change.
- `components/app/SettingsIsland.astro`: "Einstellungen meines Agenten"->"My agent settings"; "Wirkt sofort auf das
  naechste Gespraech."->"Takes effect on the next call."; "Agent-Name"->"Agent name"; "Berechtigungen"->"Permissions";
  "Begruessung (Inbound) — {owner} wird ersetzt"->"Greeting (inbound) — {owner} is replaced"; "Sprache"->"Language";
  "Speichern"->"Save"; outcomeText "Gespeichert. Uebernommen: "/"abgelehnt: " -> "Saved. Applied: "/"rejected: ";
  saveErrorText "Sitzung abgelaufen - bitte neu anmelden."/"Nicht gespeichert." -> "Session expired - please sign in
  again."/"Not saved."
- `components/app/AuthIsland.astro`: "Anmelden"->"Sign in"; "Abmelden"->"Sign out"; whoText "Konto wartet auf Freigabe"
  ->"Account awaiting activation"; "Angemeldet als "->"Signed in as "; "Angemeldet"->"Signed in".
- `components/app/BillingIsland.astro` (also reworked Part 2): "Zahlungsmethode"->"Payment method"; subtitle ->"For paid
  features (e.g. your own phone number)."; "Zahlungsmethode hinzufuegen"->"Add payment method"; "Karte hinterlegt."/
  "Noch keine Karte hinterlegt."->"Card on file."/"No card on file yet."; "Andere Karte hinterlegen"->"Add a different
  card"; error strings -> "Session expired - please sign in again."/"Couldn't start checkout."; return msgs "Karte
  hinterlegt."/"Abgebrochen - keine Karte hinterlegt."->"Card saved."/"Cancelled - no card saved."
- `apps/web/src/lib/api.js` (TEST-ASSERTED -> update tests in lockstep): CALL_SUBTITLE_INBOUND/OUTBOUND -> "Inbound
  call"/"Outbound call"; CALL_STATUS_LABELS -> Live/Completed/Cancelled/Failed; CAL_LOCALE "de-DE"->"en-US";
  formatCallDuration units Min/Std -> "min"/"h" ("0 min","< 1 min","5 min","1 h","1 h 1 min"); SETTINGS_LANGUAGES
  labels -> "Automatic (by number)"/"German"/"French"/"English"; SETTINGS_PERMISSION_TOGGLES labels/hints -> English
  (Calendar access/Agent may view appointments; Book appointments/Agent may create appointments; Personal data/Share
  address, email, etc.; Bank details/Share payment data (not recommended)). ApiError dev messages stay German.
- `apps/web/src/lib/render.js` (TEST-ASSERTED): EMPTY_CALLS/EMPTY_ACTION_ITEMS/EMPTY_CALENDAR -> "No calls yet —
  connect your first agent!"/"No action items yet."/"No appointments yet."; APPOINTMENT_TAG "Termin"->"Appointment"
  (update only the tag assertion; goal-test-data "Termin" stays).
- `apps/web/src/lib/plans.js`: NO translation (features already English).
- Tests in lockstep: `apps/web/test/render.test.js` (subtitles/status/empty/appointment tag), `apps/web/test/stats.test.js`
  (formatCallDuration units). `test/plans-catalog.test.js` stays green (mirror data unchanged).

## Part 2 — Subscribe UI
Backend is DONE (no API changes). Contracts: GET /api/self-service/state (active-only) -> hasCard, subscription
{planSlug,currentPeriodEnd}, quota; POST /api/self-service/billing/subscribe {plan} -> ok {plan,currentPeriodEnd}+activates,
409 no_card/already_subscribed, 500 plan_unconfigured, 400 unknown_plan; POST /api/self-service/billing/setup-checkout
{plan?}->{url}; GET /api/self-service/billing/return binds card + books carried plan; GET /api/self-service/billing/status
(pending-reachable) -> {paymentEnabled,hasCard,planSlug,status}.

NEW `apps/web/src/lib/subscribe.js` (pure DOM builders + wiring, textContent-only like render.js, ONE source G5):
- `planTiles(doc, catalog)` from imported PLAN_CATALOG (name, formatPlanPrice, "/month", features, `data-plan` Subscribe button).
- `subscriptionLine(sub, catalog)` -> "Active plan: {name} (renews {date})" (currentPeriodEnd epoch -> toLocaleDateString("en-US")).
- `quotaLine(quota)` -> "{remaining} of {included} minutes remaining" or hidden when null (keys remainingMinutes/includedMinutes; confirm vs src/billing/meter.js quotaView).
- `wireSubscribe(container,{onSubscribed})` -> one delegated click listener -> subscribe state machine.
- add pure `findPlan(slug)` to `apps/web/src/lib/plans.js` (mirror src/plans.js:58-60; drift test compares data only -> safe).

Rework `components/app/BillingIsland.astro` (active path): keep card block; add subscription region. On AUTH_EVENT
AUTHENTICATED: planSlug set -> subscriptionLine + quotaLine, hide tiles; planSlug null -> no-sub prompt "Subscribe so
Hermes can call for you" + planTiles. Subscribe state machine (port tenant.html subscribePlan): subscribe(plan) ok ->
re-fetch /state + re-dispatch AUTH_EVENT (refresh all islands); 409 no_card -> startBillingSetupCheckout(plan) -> Stripe
redirect; 409 already_subscribed -> message; 401 -> "session expired". Extend showReturnMessage to read ?sub=ok|failed
("Subscription booked."/"Card saved, but the subscription couldn't be booked. Please try again.").

Rework `region-pending` in `index.astro` (suspended path): on PENDING call fetchBillingStatus(); paymentEnabled ->
render the SAME planTiles + wireSubscribe (subscribe -> 409 no_card -> guided setup-checkout {plan} -> return books+
activates -> /state now 200 -> reload/re-fetch); else keep translated "awaiting activation" text. Literal port of
tenant.html renderActivation().

`apps/web/src/lib/api.js` additions: HTTP_CONFLICT=409 const; extend ApiError with optional `code` + best-effort parse
{error} from non-2xx JSON in apiRequest (additive, still fail-closed); startBillingSubscribe(plan); extend
startBillingSetupCheckout(plan?) to send body{plan} when present (bare = byte-identical); fetchBillingStatus();
selectors subscriptionFrom(data)/quotaFrom(data); FIX stale comments (api.js ~:73-75 + BillingIsland header ~:9-14)
that falsely claim subscribe API doesn't exist.

`apps/web/src/styles/app.css`: add `.plan/.plans/.plan-badge/.plan-feature` tile styles (none exist yet), consistent
with the existing card visual language.

## Part 3 — active vs suspended switching
webAuthMw active-only -> /state 403 for suspended -> loadAuthState maps PENDING. Subscribe UI for suspended reads
/billing/status (webAuthPendingMw). After subscribe, activatePaidTenant flips active -> next /state 200 with plan.
Net: suspended -> tiles via /billing/status; active-no-card -> /state (no billing fields); active-card-no-sub -> prompt+
tiles; active-sub -> plan+quota.

## Part 4 — SPIEGEL-PFLICHT
Read tiles from build-time mirror `apps/web/src/lib/plans.js` (Starter 499/30min, Business 999/120min, eur, month;
features English; formatPlanPrice -> "€4.99"/"€9.99"), NOT a runtime /api/plans fetch. Drift guard test/plans-catalog.test.js
compares PLAN_CATALOG data only -> adding findPlan() is safe. Do NOT diverge the two plans.js copies.

## Part 5 — other risks
- Money path = dual review (subscribe triggers real recurring, test-mode). Safety gates untouched (active != outbound-capable); UI only calls already-gated routes.
- Test lockstep: translate lib strings + their tests atomically (no mixed DE/EN, no red build).
- activatePaidTenant provisioning is dry-run in test -> AgentChip shows "No number assigned yet" post-activation (no UI risk; verifier confirms).
- Chrome e2e needs local dev-login (P1 shim, already wired) -> confirm before the browser run.

## Verification
- Layer 0: root `npm test` + `cd apps/web && npm test`. Lockstep edits: apps/web/test/render.test.js, stats.test.js. plans-catalog stays green.
- Layer 1 (Chrome, Stripe TEST): gateway :3000 serving apps/web build, PAYMENT_ENABLED + sk_test + price-ids + pg +
  dev-login. Fresh no-sub user -> /app shows English "Subscribe so Hermes can call for you" + Starter/Business tiles ->
  Subscribe (no card) -> 409 no_card -> guided Stripe Checkout -> 4242 card -> return ?sub=ok -> /app -> /state 200
  active -> dashboard shows active plan + quota (+ number/empty-state), all English. Assert via network (PaymentIntent
  succeeded, livemode:false), console clean, UI state. GIF for owner.
