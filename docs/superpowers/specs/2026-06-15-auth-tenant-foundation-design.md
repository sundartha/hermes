# Auth + Tenant-Foundation (Sub-Projekt B) — Design

**Datum:** 2026-06-15
**Status:** Design (vor Implementierungs-Plan)
**Council:** `~/Larry/drafts/2026-06-15_council_auth-tenant-foundation.md` (5/5 + Chairman, in dieses Design eingearbeitet)
**Kontext-Doku:** `PLAN-SECURITY.md` (bei Implementierung fortschreiben), `CLAUDE.md` (Absolute Regeln)

---

## 1. Kontext & Ziel

Der vodafone-agent ist heute ein owner-only-Prototyp (statisches Basic-Auth, JSON-Store-Default). Er soll ein echtes, deploytes Multi-Tenant-SaaS werden: oeffentliche Marketing-/Pricing-Seite (Sub-Projekt A) + Login + per-Kunde-Portal (Sub-Projekt C) + Billing/Real-Provisioning (Sub-Projekt D).

**Strategischer Rahmen:** Gebaut fuer Vodafone, wird aber in eine eigene Firma ueberfuehrt. **Primaerfokus B2C** (Privatkunden = wichtigste Zielgruppe), **danach B2B**. Das validiert den Tenancy-Grain dieses Designs: ein Tenant = ein Privatkunde (Einzelnutzer). B2B/Org-Mehrnutzer ist spaeterer Scope — das Schema bleibt dafuer erweiterbar (s. 4.1), wird aber jetzt NICHT gebaut (kein Org/Membership-Layer, keine JOIN-Indirektion im heissen Call-Pfad).

**B ist das Fundament:** Wer darf rein, wie werden Kunden hart voneinander getrennt, welche Zugriffe sind erlaubt. B ist irreversibel und muss perfekt sein — die teuren-zu-retrofitenden Entscheidungen sitzen hier.

**Irreduzibles Ziel (First-Principles):** Ein Mandanten-Isolationsmechanismus, der verhindert, dass Aktionen (Anrufe, Budget-Verbrauch, Datenlecks) ueber Kunden-Grenzen wirken — auf einem System, das echte Telefonie-Kosten und Transkripte Dritter beruehrt. Isolation muss **hard**, nicht best-effort sein.

---

## 2. Scope

**B liefert:**
- Registrierung (E-Mail+Passwort ueber Provider) + E-Mail-Verifikation + **Approval-Gate** auf `tenant.status` (`suspended`→`active`).
- Browser-Login (Authorization-Code-Flow + serverseitige Session) fuer verifizierte + freigegebene Nutzer.
- **Rate-Limiting** auf Registrierung/Login/Callback ab Tag 1.
- Minimaler **Admin-Approve/Suspend-Endpunkt** (admin-allowlist, fail-closed) — kein direkter DB-Zugriff fuer Approval.
- Identity→Tenant-Aufloesung; pg-Backend aktiv; **erzwungene RLS-Isolation**.
- Alle `/api/*`-Lesepfade von owner-only → auf den authentifizierten Tenant umgestellt, fail-closed.
- **Audit-Log**, **Session-Invalidierung**, **CASCADE-Loeschung** (Art. 17) — im Fundament, nicht spaeter.

**B liefert NICHT:**
- Portal-UI (Nummern/Historie/Budget-Ansicht) → **C**.
- Billing/Stripe/Real-Provisioning → **D** (`PROVISIONING_ENABLED` bleibt `false`).
- Marketing-/Pricing-Seite → **A**.
- Org-/Team-Tenancy (mehrere Nutzer pro Tenant), Member-Invite-UX → spaeter (Schema bleibt erweiterbar, s. 4.1).
- Outbound-Trigger fuer Kunden — `place_call`/`onboard` bleiben **owner-only bis D**. Kunden-web-auth = **READ-only**.

**Ehrliche Grenze:** Ein frisch freigegebener Kunde hat einen isolierten, aber leeren Tenant (keine Nummer, keine Calls). B beweist Auth + Isolation; das sichtbare Portal kommt in C direkt danach.

---

## 3. Architektur

### 3.1 Login-/Registrierungs-Flow (Provider: WorkOS AuthKit)

**Provider-Rationale unter B2C-first:** AuthKit deckt **beide Phasen ohne Provider-Swap** — B2C jetzt (E-Mail+Passwort, Social-Login Google/Apple, Magic-Auth, Reset; Privatkunden-UX) und B2B/Org+SSO/SAML spaeter. Free bis 1M MAU. Bewahrt unser bestehendes `app.current_tenant`-RLS-Muster (Supabase Auth wuerde sein eigenes `auth.jwt()`-RLS mitbringen → Reibung). Wegen der Swap-Disziplin (s.u.) ist die Wahl ohnehin nicht fatal — finaler Provider-Pick kann im Plan bestaetigt werden; Selektionsachse fuer B2C = Consumer-Login-UX + Social-Auth.

1. Browser → Registrierung/Login (AuthKit). AuthKit uebernimmt **Passwort, E-Mail-Verifikation, Reset**.
2. Authorization-Code-Flow → unser **Callback** → OIDC-Tokens.
3. JWT verifiziert ueber den **bestehenden `auth.js`-OIDC-Pfad** (jose/JWKS, issuer/audience). → serverseitige **Session** (Cookie httpOnly/secure/sameSite, Session-Zeile in DB).
4. **Erst-Login neuer Identitaet:** Tenant `status='suspended'` anlegen + `account(sub→tenant_id)` mappen. Approval (Admin-Endpunkt) → `'active'`.
5. **Pro Request:** `webAuth`-Middleware → Session (gegen `session.invalidated_at` pruefen) → tenantId → DB-Arbeit im **erzwungenen Wrapper** (s. 3.3). Tenant ≠ `active` → 403 (fail-closed).

**Provider-Disziplin (Council Tension 1):** Das WorkOS-SDK lebt **ausschliesslich** in der Auth-Schicht. Nur OIDC-Claims (`sub`, `email`) verlassen sie — **kein WorkOS-Typ in der Business-Logik**. Provider-Swap = Config-Change (Issuer-URL), nicht Refactor.

### 3.2 Prinzipale & Identity

| Prinzipal | Auth-Pfad | Scope |
|---|---|---|
| **Kunde** | Session-Cookie → `webAuth` → tenant-scoped | READ-only (B) |
| **Owner/Admin** | AuthKit admin-role (E-Mail-Allowlist in `config.js`) *oder* localhost-`internalIdentity` (CLI/MCP) | Admin (approve/suspend, Operator-Konsole) |
| **Public Webhooks** | unveraendert: `/voice/*` (Twilio-Signatur), `/mcp` (`mcpAuth`), `/healthz` | eigene Gates |

**Invariante:** `internalIdentity` vertraut **nur** localhost-Header. Ein Remote-Request ist **nie** Owner — Admin-Rechte remote nur ueber AuthKit admin-role.

### 3.3 Isolation — erzwungener RLS-Wrapper (Council Blocker #1)

**Architektur-Korrektur (Code-Befund 2026-06-15):** Das vorhandene pg-Backend (`src/store/pg.js`) ist ein **Single-Tenant-Owner-Spiegel** — synchron, prozess-global, hydriert nur den Owner, setzt `app.current_tenant` einmal pro Connection (session-weit), nicht pro Request (Code-Kommentar: "single-tenant/ein-Prozess"). Es taugt **nicht** fuer per-Request-Multi-Tenant-Reads.

Daher **Zwei-Pfad-Architektur:**
- **Owner-Spiegel-Store** (`store.js`, sync) = Agent-/Operator-Runtime. **Unveraendert** — beruehrt NICHT `bridge.js` (HEIKLE STELLE: Barge-in/Call-Ende).
- **NEU: `portalStore`** — ein eigenes async, **per-Request, RLS-wrapped, tenant-scopetes** Daten-Modul fuer Kunden-Reads (eigener pg-Pool). Das ist der erzwungene Wrapper. In B sind Kunden-Tenants leer (Nummern/Calls erst mit D), daher klein: beweist Isolation + liefert "dein (leerer) Tenant".

Der Wrapper (`portalStore`) als einziger Trust-Anker fuer Kunden-Daten:

- Jede tenant-gescopte DB-Arbeit laeuft in einer **expliziten Transaktion**, die mit `SET LOCAL app.current_tenant = $tenantId` beginnt. `SET LOCAL` ist txn-scoped → pool-/pgBouncer-sicher (kein Cross-Connection-Leak).
- Der Wrapper **verweigert** jeden Query, dem kein `SET LOCAL` in derselben Txn vorausging (kein Roh-`pool.query` im tenant-Pfad). Erzwungen, nicht dokumentiert.
- **Zwei Linien** (Bestand): app-seitiger `tenant_id`-Filter (primaer) + RLS `app.current_tenant` (sekundaer, faengt vergessene Filter).
- Der **identity→tenant-Resolver** (`account`-Tabelle) ist die einzige RLS-exempte Query (laeuft VOR gesetztem `current_tenant`). Sie ist privilegiert und **read-only ausserhalb der Auth-Schicht nicht aufrufbar** — Test-Coverage erzwingt, dass kein anderer Pfad ungefilterten Zugriff erbt.

---

## 4. Datenmodell

Aufbauend auf dem vorhandenen pg-Schema (`src/db/schema.sql`, RLS bereits definiert). Neu in B:

### 4.1 `account` (Resolver, RLS-exempt)
```
account(
  sub        TEXT PRIMARY KEY,      -- IdP-subject (stabil)
  email      TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',  -- member|admin
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
- **Grain-Entscheidung (Council):** `account.tenant_id` ist **kein** UNIQUE → das Schema traegt spaeter mehrere Accounts pro Tenant (Org), OHNE jetzt Org/Membership-Indirektion zu bauen. Der Resolver bleibt **direkt** `sub→tenant_id`. Keine JOINs im heissen Pfad.
- RLS-exempt (Resolver-Rolle), da Lookup vor `current_tenant` laeuft.

### 4.2 `session` (Invalidierung)
```
session(
  id            TEXT PRIMARY KEY,
  sub           TEXT NOT NULL REFERENCES account(sub) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ
)
```
- Jeder Request prueft `invalidated_at IS NULL AND expires_at > now()`.
- Bei `tenant.status`-Wechsel auf `suspended|closed` → **alle Sessions des Tenants** `invalidated_at = now()`. Suspendierter Tenant ist sofort tot, nicht erst bei Cookie-Expiry.

### 4.3 `audit_log` (immutable, append-only)
```
audit_log(
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_sub  TEXT,            -- wer (NULL = system/owner-localhost)
  tenant_id  TEXT,            -- betroffener Tenant; BEWUSST KEIN FK (muss Tenant-Loeschung ueberdauern, Compliance)
  action     TEXT NOT NULL,   -- z.B. tenant_approve, tenant_suspend, login, place_call
  detail     TEXT             -- keine Secrets, keine Transkript-Inhalte
)
```
- Geschrieben im Mutations-Wrapper **vor** jedem state-aendernden Call. Kein UPDATE/DELETE-Recht (append-only; Schreibrecht nur ueber privilegierte Funktion).
- Deckt Council-Pflicht: "wer autorisierte welchen Outbound, wer aenderte Status" rekonstruierbar (Art. 15).

### 4.4 `tenant.status`-Lifecycle
`suspended` (nach Verify, wartet auf Freigabe) → `active` → `closed`. Bereits im Schema. Approval/Suspend nur ueber Admin-Endpunkt, jede Transition ins `audit_log`.

### 4.5 CASCADE-Loeschung (Art. 17)
Alle `tenant_id`-FKs mit `ON DELETE CASCADE` (im Bestand groesstenteils vorhanden → **vollstaendig verifizieren** inkl. `account`/`session`/`audit_log`-Bezug). Tenant-Loeschung = ein `DELETE FROM tenant WHERE id=$1`, atomar. (Hinweis: `audit_log.tenant_id` bewusst **ohne** CASCADE pruefen — Compliance-Trail darf Loeschung ueberdauern; Detail-Entscheidung s. 9.)

---

## 5. Auth & Route-Protection

- **`/api/*` Default:** hinter `webAuth`, tenant-scoped, fail-closed (keine gueltige Session → 401). Migration vom heutigen owner-Basic-Auth.
- **Admin-Endpunkte** (`/api/admin/tenants/:id/approve|suspend`, Tenant-Liste, Operator-Konsole): admin-role-Gate (E-Mail-Allowlist), getrennt vom Kunden-Scope, jede Aktion auditiert.
- **Cost/Write-Gate:** Kunden-web-auth = READ. `place_call`/`onboard` bleiben owner-only bis D (Pre-Mortem Kostenexplosion).
- **Rate-Limiting:** Registrierung, Login, Callback ab Tag 1 (Credential-Stuffing-/Abuse-Vektor auf oeffentlich exponiertem Telefon-Agent).

---

## 6. Security-Gates & Error-Handling (Absolute Regeln)

| Regel | Umsetzung in B |
|---|---|
| Safety-Gates (Allowlist, Budget-Guard, Max-Dauer, Twilio-Signatur) | unveraendert; per-Tenant-Budget (`budgetExceeded`) bleibt scharf |
| Offenlegungssatz | nicht beruehrt (Outbound bleibt owner-only) |
| AUTH fail-closed | neue Endpunkte default hinter `webAuth`/admin-role; `safeEqual` fuer Allowlist-Vergleiche |
| Secrets | WorkOS-Keys, DATABASE_URL, Session-Secret nur via env; nie loggen/leaken |
| Audio nie durch MCP | nicht beruehrt |

**Fehlerpfade:** unverifiziert → kein Login; unapproved (`suspended`) → 403; Session invalidiert/abgelaufen → 401; Wrapper ohne `SET LOCAL` → harter Fehler (nie stiller Fremdzugriff).

---

## 7. Konfiguration (neu, in `config.js` + `.env.example` + `render.yaml`)

- `STORE_BACKEND=pg`, `DATABASE_URL` (Secret)
- `OAUTH_ISSUER_URL`, `OAUTH_AUDIENCE` (WorkOS AuthKit)
- `SESSION_SECRET` (Cookie-Signatur)
- `ADMIN_EMAILS` (Allowlist, kommagetrennt)
- Rate-Limit-Schwellen (z.B. `LOGIN_RATE_MAX`, Fenster)

---

## 8. Tests & Definition of Done (messbar)

**B ist fertig, wenn:**
1. **Killer-Test gruen** (Council Blocker): pgBouncer Transaction-Pooling (reale Render-Config), 2 Tenants, 50 parallele Requests, an zufaelligen Stellen injizierte Query-Fehler ohne Rollback → **kein** `tenant_id` der einen Seite taucht in Ergebnissen der anderen auf. Nicht 100 % sauber → Fundament neu bewerten, bevor irgendetwas darauf gebaut wird.
2. Isolations-Test: eingeloggter Kunde liest ueber `/api/*` ausschliesslich eigene Daten; Fremd-`tenant_id` → leer/403.
3. Wrapper-Test: Roh-Query ohne `SET LOCAL` schlaegt hart fehl.
4. Session-Invalidierung: `suspend` → laufende Session sofort tot.
5. CASCADE-Loeschung: `DELETE tenant` entfernt alle abhaengigen Zeilen; Test verifiziert Vollstaendigkeit.
6. fail-closed: unauth `/api/*` → 401; Remote-Request nie Owner; Cost-Endpunkte fuer Kunden gesperrt.
7. Rate-Limiting greift auf Login/Registrierung.

Test-Stil: `node:test`, Server als Kindprozess mit `PORT=0`, gegen eine Test-pg (pglite/Container), `data/store.json` nie angefasst.

---

## 9. Akzeptierte / offene Detail-Entscheidungen

- **`audit_log` vs CASCADE:** Behalten-bei-Tenant-Loeschung (Compliance) vs Art.-17-Vollloeschung. Vorschlag: `actor_sub`/`tenant_id` anonymisieren statt Zeile loeschen. **Im Plan final entscheiden.**
- **Stale-Account-Hygiene:** ewig `suspended` Tenants → spaetere Auto-Regel (Council Drift-Hinweis); in B nur dokumentiert, nicht gebaut.
- **WorkOS-Org-Membership-Revocation** als alternativer Session-Invalidierungs-Pfad: pruefen, ob AuthKit propagiert — sonst greift unsere Session-Tabelle (primaer).

## 10. Bau-Reihenfolge (fuer den Plan)

1. **Zuerst beweisen, dann bauen:** `portalStore`-Modul (async, per-Request `SET LOCAL`-Wrapper, eigener pg-Pool) bauen + Killer-Test gruen. Owner-Spiegel-Store bleibt unberuehrt. Kein Feature-Code davor.
2. Schema-Erweiterung (`account`, `session`, `audit_log`) + CASCADE-Verifikation + Migrate-Runner (`db/migrate.js`).
3. `auth.js` → Browser-Login (Auth-Code-Flow + Session) hinter OIDC-Interface; Rate-Limiting.
4. `webAuth`-Middleware + Kunden-`/api/*` ueber `portalStore` (tenant-scoped); Admin-Approve/Suspend-Endpunkt; Session-Invalidierung an `status` haengen.
5. Tests (Abschnitt 8) + `PLAN-SECURITY.md` fortschreiben.
