# PLAN: Tenant-/Nummern-Proliferation schliessen

Umbrella-Plan fuer die Kette aus RCA `tasks/rca-tenant-number-proliferation.md`. Owner-freigegeben
2026-07-10. Autoritative Phasen-Specs: `tasks/tenant-prolif-fix1-spec.md` (Fix 1: A+B),
spaeter `tasks/tenant-prolif-fix2-spec.md` (Fix 2: C+D+E).

## Problem (Wurzel)

Die Tenant-Identitaet haengt roh am OIDC-`sub` (`tenantIdForSubject = t_<sub>`,
`src/store/defaults.js:141`). Es gibt nirgends eine Email-Deduplizierung — jeder neue WorkOS-`sub`
fuer denselben Menschen erzeugt einen frischen Tenant, der beim Abo automatisch eine neue echte
Telnyx-DID kauft. Und es gibt keinen DID-Release-Pfad: `releaseNumber` hat genau einen Aufrufer
(Provisioning-Rollback, `src/onboarding.js:178`); Suspend/DSGVO-Loeschung geben Nummern nie frei.
Stand 2026-07-10: 4 aktive US-DIDs, Telnyx-Guthaben 3,97 USD.

## Owner-Entscheidungen

- Beide Fixes. Retroaktiv die 4 Bestands-Tenants behandeln (wahrscheinlich Cleanup statt Merge).
- DID-Release automatisch nach Grace-Period, aber ausgeliefert wird Observe-Only (Grace=0).

## Verifizierte Grundlagen (Code + Explore)

- Fix 1 ist **pg-only** (json-Store hat kein account/Email/Web-Login-Konzept; Web-Login mountet nur
  bei `STORE_BACKEND=pg`).
- Die "Mapping-Tabelle" existiert schon: `account` (sub PK, `tenant_id` NICHT-unique) traegt
  mehrere subs pro Tenant bereits schema-seitig.
- MCP-Landmine: `resolveTenant` (`state-ops.js:1600`) ist **synchron** und scannt den
  In-Memory-Spiegel ueber das skalare `tenant.idp_subject` — es liest `account` nicht. Ein per Email
  gemergter neuer sub wird im MCP-Kanal abgelehnt. Der pg-Spiegel friert `idp_subject` nach dem Boot
  ein (`ensureTenant` refresht nur `status`).
- DID-Release-State-Machine ist schon da (ACTIVE->RELEASED, SUSPENDED->RELEASED legal).
  Telnyx-`releaseNumber` (DELETE /v2/phone_numbers/{id}) ist NICHT idempotent; Twilio hat gar kein
  `releaseNumber`.
- Kein `suspended_at` existiert (weder Tenant noch Nummer) — der Grace-Anker fehlt.
- Schema migriert sich beim Boot selbst (idempotente `ALTER ... IF NOT EXISTS` in `schema.sql`,
  angewandt via `store.js` Top-Level-Await -> `pg.init()` -> `migrate()`). Kein Migrations-CLI, keine
  Versionierung — nur additive Aenderungen.

## Leitplanken (unverhandelbar)

1. `email_verified===true`-Gate (`web-auth.js` `claimsFromPayload`) bleibt hart. Kein Merge ohne
   verifizierte Email — sonst Account-Takeover. Nicht aufweichen.
2. CLAUDE.md Regel 1-7: Allowlist/Denylist/Budget/Max-Dauer/Signatur, Offenlegungssatz,
   Auth-fail-closed unberuehrt. Kein Fix umgeht ein Gate.
3. DID-Release nie sofort: Grace-Period + Idempotenz + Live-Status-Recheck vor jedem DELETE + Audit.
   Ausgeliefert wird Observe-Only (`RELEASE_GRACE_DAYS=0`).
4. Schema nur additiv/idempotent (keine Versionierungstabelle vorhanden).
5. Neue Env-Vars an 4 Orten: `config.js`, `.env.example`, `render.yaml`, `test/helpers.js` BASE_ENV
   (sonst leakt lokales `.env` in Spawn-Tests).
6. Retroaktiv: keine DID wird angefasst ohne per-Nummer-Freigabe des Owners.

## Workstreams

- **Fix 1 (Identitaet, pg-only):** Phase A (Email-Dedup am Web-Login) -> Phase B (MCP/REST-Kanal:
  sub->Tenant ueber `account`, synchroner Spiegel-Index). Spec: `tasks/tenant-prolif-fix1-spec.md`.
- **Fix 2 (DID-Lifecycle):** Phase C (`suspended_at` + Webhook-Anker) -> Phase D (Release-
  Klassifizierer + Reconcile, Observe-Only-Default) -> Phase E (`eraseTenantData` gibt Nummern frei).
- **Retroaktiv:** Phase F (DB-Sicht + per-Nummer Cleanup/Merge) — braucht Owner-DB-Zugang + das
  Fix-2-Tooling; zuletzt.

## Reihenfolge & Rollout

Fix 1 (A->B) zuerst als eigene Lean-Kette, Fix 2 (C->D->E) danach, F zuletzt. Jede Phase
eigenstaendig mit Test + dualem Review. Sicher deploybar: Fix 1 ist praeventiv (aendert nur den
Merge-Fall), Fix 2 laeuft Observe-Only (Grace=0). Deploy-Disziplin: neue Env-Vars VOR dem Code
deployen; Boot per `[boot]`-Banner verifizieren; origin UND upstream pushen (Render deployt upstream).
