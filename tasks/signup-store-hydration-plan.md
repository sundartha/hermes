# Fix: self-service signup invisible to the store mirror until reboot (ensureTenant)

Confirmed live (gateway log: `setTenantStripe: Tenant t_p2nosub nicht gefunden`). Real production bug, masked by tests.

## Root cause
`src/web-auth.js:98` `mintSession` -> `accounts.upsertOnFirstLogin` (`:313`) does `INSERT INTO tenant ... 'suspended'`
into the shared DB, but the store mirror `s.tenants` is hydrated from pg ONLY at boot (`src/store/pg.js:303 hydrate`
-> `:328 hydrateTenants`). A tenant created AFTER boot is in the DB `tenant` table but NOT in `s.tenants`. Every WRITE
store-op on the subscribe path resolves via `findTenant` (`state-ops.js:501`) and throws when absent: `setTenantStripe`
(`:647`), `setTenantSubscription` (`:678`), `setKycLevel` (`:591`), `setTenantGeo` (`:760`), `setPrivateNumber` (`:733`).
Read-ops are null-safe (`tenant?.`) -> subscribe returns `no_card`, then `setup-checkout`->`ensureCustomer`->`setTenantStripe`
throws -> `asyncBilling` -> 502 `billing_unavailable`. Only `/api/onboard` (`server.js:1430`, operator path) calls
`registerTenant`; the OIDC self-service path does NOT. Tests pre-seed via `ops.registerTenant` (e.g. bk5-smoke:126) -> mask it.

## STATUS-SAFETY VERDICT (Regel 1): MUST hydrate the REAL status from pg; MUST NOT hardcode ACTIVE
`ops.registerTenant` hardcodes `status: ACTIVE` (`state-ops.js:576`). Authoritative lifecycle status is accounts-owned in
the DB `tenant` row; `flushTenants` ON CONFLICT NEVER writes `status` (`pg.js:651-661`) -> `s.tenants[].status` is a
non-persisted read-cache of the DB status. THREE gates read the MIRROR status for safety/routing:
- `requestNumber` (`state-ops.js:814`): `status !== ACTIVE -> tenant_inactive` (provisioning gate).
- `tenantInactive` (`:632`, `server.js:552`): W5 defense-in-depth HARD outbound block (before allowlist relaxation).
- `tenantActiveSubscriber` (`:617`, `server.js:560`): allowlist relaxation (active + kyc>=card => static allowlist satisfied).
A mirror showing ACTIVE for a really-suspended tenant (cancelled/payment-failed) would defeat the hard block AND relax the
allowlist -> suspended tenant could place outbound calls = forbidden. Mirror status is never flushed, so hydrating the real
value is correct + side-effect-free. (registerTenant-ACTIVE stays correct for the deliberate `/api/onboard` operator path.)

## Fix

### src/store/pg.js — extract rowToTenant + add ensureTenant(tenantId)
- Refactor the per-row mapping out of `hydrateTenants` (`:334-368`) into a shared `rowToTenant(r)` helper (DRY); reuse it.
- Add async `ensureTenant(tenantId)` to makePgStore (idempotent, FAIL-SAFE):
  - `runner.withClient`: read `SELECT status FROM tenant WHERE id=$1`. If NO row -> return false (NEVER fabricate a tenant).
  - If already in mirror (`ops.findTenant`): refresh ONLY `existing.status = row.status` (the lone accounts-owned, never-
    flushed field; mirror-owned kyc/stripe/sub/identity/private_number NOT touched -> no clobber of unflushed writes). return true.
  - If absent: SELECT the full row, RE-CHECK `findTenant` synchronously immediately before push (concurrency: two parallel
    first-logins -> no await between check and push -> no duplicate), `state.tenants.push(rowToTenant(full))`, then
    `hydrateTenantInto(client, state, tenantId)` (empty for a fresh tenant, future-proof). return true.
  - Wrap in try/catch -> `console.error("[pg] ensureTenant fehlgeschlagen:", e.message)` (secret-free) -> return false
    (fail-safe: callers Login/Provision never see a rejection).
- WHY status-refresh-on-present (not pure no-op): required for the provision step (#provision below). Safe because status
  is the only accounts-owned, never-flushed field -> only moves the cache toward DB truth, never fabricates ACTIVE.

### src/store/json.js — no-op
`export async function ensureTenant() { return false; }` (web-login/self-service mounted only with STORE_BACKEND=pg
`server.js:192` -> json has no separate accounts DB to pull; export exists for facade completeness).

### src/store.js — re-export
Add `ensureTenant` to the destructured re-export binding list (missing re-export => `store.ensureTenant` undefined => TypeError).

### src/web-auth.js — thread ensureTenant into mintSession (covers callback AND dev-login, G5)
- `makeWebAuthRoutes` deps: optional `const ensureTenant = deps.ensureTenant || (async () => {});` (optional -> existing auth
  tests unchanged).
- `mintSession` (`:98`): call `await ensureTenant(tenantId)` AFTER `accounts.upsertOnFirstLogin`, BEFORE `sessions.create`.
- FAIL-OPEN argument: auth is already committed (account+session rows) when ensureTenant runs; the mirror is an operational
  cache, not part of the auth decision. A hiccup opens NO gate (missing mirror tenant -> setters keep throwing fail-CLOSED,
  the old 502, never suspended-looks-active). Swallowing the error preserves availability with zero safety cost.

### src/server.js — wiring (2 spots)
- `makeWebAuthRoutes({...})` deps (`:218`): add `ensureTenant: (tid) => store.ensureTenant(tid)` (store in scope).
- `triggerTenantProvisioning` (`:1523`) TOP: add `await store.ensureTenant(tenantId)` BEFORE withStoreLock/
  requestNumberForPaidTenant. RATIONALE: `activatePaidTenant` does setKycLevel(mirror) -> `accounts.setStatus(active)` (DB
  only, mirror untouched) -> provision. At provision time the mirror is still `suspended` (login value) while DB is `active`
  -> requestNumber reads mirror -> tenant_inactive -> provisioning silently skipped. ensureTenant's status-refresh pulls the
  committed `active` into the mirror so requestNumber passes. Put it in triggerTenantProvisioning (production seam) NOT in
  activatePaidTenant (which is called with FAKE stores in tests, e.g. p3-payment-webhook:37, without ensureTenant). Re-entrancy
  ok: ensureTenant uses withClient (DB read), not withStoreLock, runs before the lock.

## Test: test/self-service-mirror-hydration.test.js (NEW, in-process pglite, NO server-spawn)
Model on bk5-smoke-e2e (pglite + app.listen(0) + node:http) but DELIBERATELY OMIT the `ops.registerTenant` pre-seed (the
line that masks the bug). Exercise the REAL signup via `/auth/dev-login`:
- makePgTestStore; accounts/sessions on the runner; webAuthMw/webAuthPendingMw.
- Mount makeWebAuthRoutes({..., devLoginEnabled:true, ensureTenant:(tid)=>store.ensureTenant(tid)}) + makeSelfServiceRoutes
  ({store,...,billing:fakeBilling,accounts, provision}) where provision mirrors the production seam:
  `async (tid)=>{ await store.ensureTenant(tid); requestNumberForPaidTenant(store.load(), {tenantId:tid, fallbackCountry:"DE",
  maxNumbers:HIGH, maxNumbersPerTenant:HIGH}); store.save(); }`.
- POST /auth/dev-login {sub,email} -> capture session cookie (runs mintSession -> upsertOnFirstLogin + ensureTenant, NO registerTenant).
Assertions:
1. CORE REGRESSION: POST /api/self-service/billing/setup-checkout {plan:starter} -> 200 (pre-fix 502). Mirror now has
   `t_<sub>` with status "suspended" (real status hydrated, NOT ACTIVE).
2. WHOLE CHAIN: GET /api/self-service/billing/return?session_id=...&plan=starter -> 302 /tenant.html?sub=ok; mirror tenant has
   stripeSubscriptionId, stripePlanSlug "starter", kycLevel "card"; accounts.resolve(sub).status === "active"; exactly ONE
   `requested` number for the tenant (proves provision survived the mirror-status sync).
3. IDEMPOTENCY/NO FABRICATION: second dev-login = no duplicate s.tenants entry; ensureTenant(unknown id) -> false, adds nothing.
Plus unit cases in test/store-pg.test.js: ensureTenant absent->adds suspended; present->refreshes suspended->active after
accounts.setStatus; unknown id->no-op false.

## Files
src/store/pg.js, src/store/json.js, src/store.js, src/web-auth.js, src/server.js, test/self-service-mirror-hydration.test.js (new),
test/store-pg.test.js (extend). Run full root `npm test` green.

## Risks (mitigated)
- Clobber unflushed mirror writes -> refresh ONLY status on present. Concurrent first-logins -> synchronous re-check before push.
- Fabricate tenant -> false + nothing when DB row absent. Provision hiccup -> status not synced -> requestNumber skips (already
  audited webhook_provision_skipped, visible, not a silent bypass). Optional dep -> existing auth tests unchanged; activation
  seam untouched (p3 fake store unchanged).
