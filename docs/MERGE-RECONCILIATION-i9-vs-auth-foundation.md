# Merge-Reconciliation: i9-Multi-Tenancy (origin/master) ↔ auth-tenant-foundation (B)

> Erstellt 2026-06-16. Read-only Analyse (3 Agents) vor dem Merge von `feat/auth-tenant-foundation` in `master`.
> Refs: base `80e0d94` · upstream `origin/master` (`8a8bceb`, +25 Commits I0–I9) · feature `feat/auth-tenant-foundation` (`137be2d`, +17 Commits).

## TL;DR

- Die zwei Implementierungen sind **~80% komplementaer, nicht redundant**. Merge ist mechanisch **low-risk**.
- **Nur 1 trivialer Textkonflikt** (`src/server.js`, Import-Zeile). `config.js`, `schema.sql`, `.env.example` mergen **automatisch** (verschiedene Regionen, `merge-tree` = 0 Konfliktmarker).
- **Kein silent-break, kein erzwungenes Rewiring** (Korrektur unten): upstreams `tenant.idp_subject` ueberlebt den Merge, `resolveTenant` laeuft weiter.
- **1 echter Verifikationsschritt:** Express-Middleware-Reihenfolge in `server.js` + voller `npm test`.
- **1 nicht-blockierender Follow-up:** Identity-Dedup (`tenant.idp_subject` vs `account.sub`) — zwei Identitaetsquellen koexistieren, aber auf **disjunkten** Request-Surfaces.

## Verdict je Achse

| Achse | Verdikt | Behalten | Zusammenfuehren (spaeter) |
|---|---|---|---|
| **Login** | Komplementaer (B fuellt echte Luecke) | B: OIDC Auth-Code+PKCE + DB-Sessions. Upstream: `selfServicePatch` + `GREETING_TEMPLATES` | Self-Service-Whitelist hinter `webAuthMw` statt OAuth-`sub` haengen |
| **Tenant-Scoping** | Komplementaer (Defense-in-Depth) | **Beide** — App-Level `MULTI_TENANT` (Owner/Admin/Outbound/MCP) als Primaer; DB-Level RLS (Portal-Read) als Sekundaer | RLS-`withTenant` ueber Upstream-Schreibpfade ziehen |
| **Identity-Schema** | Redundant, koexistierend | B: `account`+`session`+`role` (normalisiert, B2B-faehig). Upstream: `tenant.idp_subject` | Eine Identitaetsquelle waehlen (B subsumiert Upstream) |

**Kernbefund Login:** Upstream i9 hat **gar keinen Browser-Login** — die "Self-Service"-Schicht ist nur eine engere Settings-Whitelist + Read-Dashboard, das seine Identitaet aus dem MCP-OAuth-`req.auth.sub` bzw. `X-Internal-Identity`-Header leiht (`server.js:61-66`, i9-Test nutzt nur `X-Internal-Identity`). Feature B liefert den einzigen echten Kunden-Login (Sessions, Suspend-Invalidierung, CSRF/state/nonce).

## Konflikt-Realitaet (verifiziert via `git merge-tree`)

| Datei | Schwere | Kern |
|---|---|---|
| `src/server.js` | **MITTEL** | 1 Konflikt-Hunk: Import-Zeile nach `provisionNumber` — upstream fuegt `self-service.js` ein, B fuegt 4 Imports (`web-auth`/`portal`/`audit-store`/`portal-pool`) ein. Textlich trivial zusammenzufuehren. **Danach Middleware-Reihenfolge manuell verifizieren.** |
| `src/config.js` | TRIVIAL | Verschiedene Insert-Punkte im Objektliteral (upstream nach `provisioningEnabled`, B nach `oauthAudience`). Auto-Merge. |
| `src/db/schema.sql` | TRIVIAL | Upstream `ALTER TABLE tenant` (oben); B neue Tabellen + RLS `WITH CHECK` (unten). 0 Konfliktmarker. |
| `.env.example` | TRIVIAL | Upstream Mitte, B Dateiende. Auto-Merge. |

### Korrektur einer Analyse-Annahme (Belege)

Eine erste Analyse behauptete, Feature B *entferne* `tenant.idp_subject`/`owner_name` (erzwungenes Rewiring + silent Tenant-Leak). **Falsch** — verifiziert:
- `git show 80e0d94:src/db/schema.sql` → base hat die Spalten **nicht** (sie kamen erst in upstream i8).
- `git diff 80e0d94..feat/auth-tenant-foundation -- src/db/schema.sql` → Feature **beruehrt diese Spalten nicht**.
- `git merge-tree 80e0d94 origin/master feat/... -- src/db/schema.sql` → **0 Konfliktmarker**.

Die "Removal"-Sicht entstand durch Diff in Richtung `origin/master..HEAD`, wo upstreams Additionen als Removal erscheinen. Konsequenz: der Merge **addiert** upstreams Spalten sauber; `resolveTenant` bricht nicht.

## Reconciliation-Plan

**Phase 0 — Master aktualisieren.** `git checkout master && git merge --ff-only origin/master` (lokal 25 hinter, reiner Fast-Forward).

**Phase 1 — Merge.** `git merge --no-ff feat/auth-tenant-foundation`. Einzigen Konflikt aufloesen (`server.js`-Imports): **beide** Import-Bloecke behalten (self-service + web-auth/portal/audit/pool).

**Phase 2 — Middleware-Reihenfolge verifizieren (sicherheitskritisch).** Im gemergten `server.js` sicherstellen:
- `/auth/*` + `/api/portal/state` + Admin-Routen (B) bleiben **VOR** der Basic-Auth-Schicht.
- `/api/self-service/*` (upstream) bleibt **NACH** der Basic-Auth-Schicht (nutzt das Owner/OAuth-Modell, nicht `webAuthMw`).
- `disclosureSentence` + Safety-Gates unberuehrt.

**Phase 3 — Test-Gate.** Voller `npm test` gruen. Falls ein `MULTI_TENANT=true`-Pfad-Test existiert: er MUSS gruen sein (sonst koennte App-Scoping still gebrochen sein — `MULTI_TENANT` default `false` verbirgt das, siehe Pre-Mortem).

**Phase 4 — Push.** `git push origin master`.

**Follow-up (separater Branch/PR, NICHT im Merge):**
1. **Identity-Dedup:** Eine Identitaetsquelle waehlen — `account.sub` (B) subsumiert `tenant.idp_subject` (upstream). Upstream-`resolveTenant`-Konsumenten (`store/pg.js`, `state-ops.js:543`) auf `account`-Join umstellen ODER bewusst beide behalten mit dokumentierter Owner-/Surface-Trennung.
2. **RLS-Erweiterung:** `withTenant`-Wrapper ueber die Upstream-Schreib-/Outbound-/MCP-Pfade ziehen (Defense-in-Depth auch dort, wo bisher nur App-Scoping greift).
3. **Login-Konvergenz:** `selfServicePatch`-Whitelist + `GREETING_TEMPLATES` hinter B's `webAuthMw` haengen.

## Pre-Mortem

- **Middleware-Reihenfolge falsch aufgeloest → Auth-Bypass.** Einziges reales Merge-Risiko. Phase 2 ist der Gate.
- **False-green-Test.** `MULTI_TENANT` default `false` → Scoping-Pfade laufen in Tests evtl. nicht. Eine gruene Suite beweist NICHT, dass App-Scoping + RLS zusammen korrekt sind. Vor Produktiv-`MULTI_TENANT=true`: dedizierter Integrationstest.
- **Identity-Redundanz unbeachtet gelassen.** Zwei Identitaetsquellen kurzfristig tragbar (disjunkte Surfaces: Upstream MCP/Owner via `idp_subject`, B Portal via `account.sub`), aber dokumentieren + Follow-up #1 einplanen, sonst Drift.

## Empfehlung

Merge ist **sicher und ueberwiegend mechanisch** — die Schreckensszenarien der ersten Sicht (erzwungenes Rewiring, silent Leak) sind durch die `merge-tree`-Verifikation widerlegt. Vorgehen: Phase 0–4 ausfuehren, Identity-Dedup + RLS-Erweiterung als Follow-up. Nicht blind `git merge` ohne Phase 2/3.

---

## Post-Merge Status (2026-06-16, nach Investigation des gemergten Trees)

Merge ausgefuehrt (`36d0d11`, 426/426 gruen). Follow-ups gegen den GEMERGTEN Stand re-evaluiert:

**#1 Identity-Dedup — ERLEDIGT** (`e44dd67`, gemerged `d7d67ce`). Befund: die zwei Kanaele waren disjunkt — `resolveTenant` matcht `tenant.idp_subject===sub`, das `upsertOnFirstLogin` nie setzte → fuer Web-Login-Tenants immer `null`. Fix (Option A, non-breaking): `upsertOnFirstLogin` setzt `idp_subject=sub` (`ON CONFLICT DO UPDATE` nur idp_subject, status unangetastet). Test: `web-auth-pg.test.js`. Beide Kanaele teilen jetzt eine Identitaetsquelle.

**#2 RLS ueber Schreibpfade — KEINE ARBEIT NOETIG.** Befund (verifiziert): i9 `pg.js` `flush()` wrappt ALLE App-Daten-Writes (settings/calls/calendar/onboard/action-items) bereits in `BEGIN + set_config('app.current_tenant',…,true)`; die 9 Datentabellen haben FORCE RLS + `WITH CHECK`. `audit_log` ist BEWUSST RLS-frei (privilegierter append-only Insert via `withClient` ohne GUC; Schema-Kommentar dokumentiert es). RLS dort zu forcen wuerde Admin/Login-Audit-Writes brechen (WITH CHECK ohne GUC → reject) → Regression, NICHT machen.

**#3 Login-Konvergenz (Self-Service hinter Web-Session) — ERLEDIGT** (`feat/self-service-web-session`, 2026-06-16). **web-session-only** umgesetzt: Self-Service haengt jetzt am echten OIDC-Browser-Login (Feature B) statt am `X-Internal-Identity`-Pfad — vollendet i9s deferred-Login-Absicht. Wie die 3 Blocker geloest wurden:
- **pg-Pflicht geloest**: die Self-Service-Routen sind jetzt im Web-Login-Block (`sessionSecret && storeBackend==='pg'`) registriert, zusaetzlich an `selfServiceEnabled && multiTenant` gegated, hinter `webAuthMw`. `requireTenant(req)` → `req.tenant.tenantId` (= `account.tenant_id` = `t_<sub>`, dieselbe Identitaetsquelle wie der Mirror-Bucket nach #1). Ohne Web-Login-Infra existieren die Routen nicht (404, fail-closed) — der `X-Internal-Identity`-Pfad ist entfernt.
- **Load-Order/TDZ geloest**: statt Inline in den Modul-Load-Block gezogen, in eine Factory `makeSelfServiceRoutes({store, webAuthMw, audit})` ausgelagert (`src/self-service-routes.js`, Muster `makeWebAuthRoutes`/`makeAdminRoutes`). Die View-Helfer (`publicCall`/`activeNumberFor`/`upcomingCalendar`) liegen jetzt store-parametrisiert in `src/store/views.js` (DIP/G5, eine Quelle fuer server.js + Factory + Test).
- **Test-Neubau geloest**: `test/i9-self-service.test.js` ist jetzt ein reiner pglite-In-Process-Test (Session-Cookie + Tenant-Daten, Muster `portal-route.test.js`) mit echtem `webAuth`/`makeAccounts`/`makeSessions`; Faelle a–f. Der Flag-/Wiring-Gate-Test (json → 404) lebt separat in `test/self-service-flag-gate.test.js` (kein pglite/Spawn-Mix, Lehre p6a-Stall).
- **Frontend**: `public/tenant.html` von Bearer-Paste/localStorage auf `/auth/login`-Redirect + Session-Cookie (same-origin) umgebaut; 401 → "Anmelden", 403 → "wartet auf Freigabe", 200 → "Abmelden".
- **Fail-closed verifiziert**: ohne Session 401, suspendierter Tenant 403, kein Owner-Leak, kein `streamToken`-Leak. Volle Suite gruen. `SELF_SERVICE_ENABLED` bleibt Default `false`.
