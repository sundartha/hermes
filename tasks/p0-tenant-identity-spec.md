# Phase P0 — Tenant-Identitaet vereinheitlichen (Fix "Kein Tenant fuer diese Identitaet")

Autoritative Scope-/Invarianten-Definition fuer Phase **P0**. Umbrella: `PLAN-ONBOARDING.md`. Correctness-Bug, heute live kaputt.

## Problem (verifiziert, Code-gegroundet)

Tenant wird an ZWEI Stellen unterschiedlich erzeugt -> Identitaet nicht kanonisch:

- `upsertOnFirstLogin` (`src/web-auth.js:282-296`, PG-Pfad): `INSERT tenant (id=t_<sub>, status='suspended', idp_subject=sub)`. Bindet die Identitaet -> ueber `resolveTenant` (MCP/REST) auffindbar.
- `registerTenant` (`src/store/state-ops.js:573`): `id=<tenantId/email>`, `status=ACTIVE`, **`idp_subject` NICHT gesetzt**. Aufgerufen von `POST /api/onboard` (`src/server.js:1330`) -> legt potenziell einen ZWEITEN, nicht-idp-gebundenen Record an.

MCP/REST loest die Identitaet ueber `resolveTenant(sub)` = `tenant.idpSubject === sub` auf (`src/store/state-ops.js:1149`). Kein Treffer -> `requestTenant` gibt `TENANT_REJECT` (`src/routes/_tenant.js:93-108`, Konstante `:46`) -> `src/server.js:970` antwortet `403 "Kein Tenant fuer diese Identitaet."`. Da der Web-Login (einziger idp-bindender Pfad) zeitweise an Bug A scheiterte, lief `upsertOnFirstLogin` nie -> MCP findet nichts.

Auth-Kontext: `verifyOauth` (`src/auth.js:64-82`) setzt `req.auth.sub` aus dem JWT. Precedence in `src/routes/_tenant.js:74-83` (Flag off -> Bootstrap "owner"; `req.tenant` Web-Session; sonst `req.auth.sub` MCP). `idp_subject`-Spalte: `src/db/schema.sql:20`, hydration `src/store/pg.js:331,340`.

## Ziel / Invarianten (verbindlich)

1. **Eine kanonische Identitaet pro Person:** `idp_subject` (= WorkOS access_token `sub`) ist DER Schluessel. Web-Login UND MCP/REST muessen denselben Tenant aufloesen.
2. **Genau EIN Tenant-Record pro `idp_subject`.** `POST /api/onboard` darf KEINEN zweiten Record anlegen, sondern den per Login erzeugten (idp-gebundenen) Tenant fortschreiben (firstName/lastName/privateNumber etc.).
3. **`idp_subject` wird IMMER gesetzt**, wenn ein Tenant fuer eine authentifizierte Identitaet entsteht/aktualisiert wird — in BEIDEN Backends (`json` + `pg`). `upsertOnFirstLogin` ist heute PG-spezifisch; das idp-Binding muss im json-Store aequivalent existieren.
4. **MCP legt WEITER keinen Tenant an** (fail-closed bleibt). Der Fix ist NICHT "MCP darf Tenant anlegen", sondern "Web-Login bindet zuverlaessig + `/api/onboard` schreibt auf denselben Record". `TENANT_REJECT` fuer eine wirklich tenantlose Identitaet bleibt — und darf NIEMALS versehentlich auf "owner"/Bootstrap fallen (Asymmetrie zu resolveProfile, siehe Kommentar `_tenant.js`).
5. **Status-Lebenszyklus konsistent:** ein definierter Initial-Status. Aktivierung (suspended -> active) ist P3 (Payment); P0 aendert die Gate-Semantik NICHT. `tenantInactive`/`tenantActiveSubscriber`/Safety-Gates unveraendert.

## Vorzugs-Ansatz (Plan-Agent groundet am echten Code, darf mit Begruendung abweichen)

- Tenant-Erzeugung auf EINEN konzeptionellen Pfad konsolidieren: Identitaet = `idp_subject`; ID-Schema vereinheitlichen; `idp_subject` immer gefuellt.
- `/api/onboard`: Tenant ueber `req.auth.sub`/`idp_subject` FINDEN (oder idempotent anlegen, falls Login-Upsert noch nicht lief) und Profilfelder darauf schreiben — statt `registerTenant(email)` als Zweit-Record.
- json-Store-Pfad bekommt dasselbe idp-Binding wie der PG-Pfad.

## Akzeptanz (deterministische Tests, Pflicht — beide Backends json + pglite)

1. Dieselbe Identitaet (`sub`) ueber Web-Login-Pfad und ueber MCP/REST-Pfad (`req.auth.sub`) loest auf DENSELBEN Tenant auf (`resolveTenant(sub)` == der bei Login/Onboard erzeugte Tenant).
2. Nach `/api/onboard` existiert KEIN zweiter, nicht-idp-gebundener Tenant-Record; `firstName`/`lastName` sind am idp-gebundenen Tenant gesetzt.
3. MCP-Call einer Identitaet OHNE Tenant gibt weiterhin sauber `TENANT_REJECT` (fail-closed), NICHT owner/bootstrap.
4. `npm test` gruen (json + pglite). Neues Verhalten -> neuer Test.

## Abgrenzung (NICHT P0)

- Keine Payment-/KYC-/Provisioning-Logik (P3). Kein Status-Aktivieren.
- Keine Aenderung an Safety-Gates, Disclosure, Auth-Mechanik, `redirect_uri`/Domains, Branding/Dashboard.

## Constraints

ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae). `resolveTenant`/`requestTenant` bleiben fail-closed. Safety-Gates/Disclosure/Auth unantastbar. clean-code.md harte Gates (S1/S2 = Blocker). Kleiner Blast-Radius.

## Push/Deploy

NICHT pushen. Arbeit bleibt auf Branch/Worktree (manual-push-Protokoll). Lead merged den zurueckgegebenen `finalBranch` nach master (lokal).
