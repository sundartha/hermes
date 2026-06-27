# Phase p6-funnel — Onboarding-Funnel-Fix (suspended-Default) + dedizierte Plan-Auswahl

Autoritative Scope-/Invarianten-Definition fuer Phase **p6-funnel**. Setzt P0 (kanonische
Identitaet via idp_subject) und P5 (gefuehrte Aktivierung, `webAuthPendingMw`, 3-Effekt-Subscribe)
voraus. Behebt den live verifizierten Kern-Bug: **ein frischer, verifizierter WorkOS-Signup landet
direkt im User-Dashboard statt im Aktivierungs-Funnel.** `PAYMENT_ENABLED=true` /
`PROVISIONING_ENABLED=false` sind auf Render gesetzt (Testmodus, kein echter Kauf).

> **Kein Free-Tier in dieser Phase** (Jonas, explizit). Plan-Auswahl = ausschliesslich Starter /
> Business. Ein Free-Tier ist Folge-Ticket, NICHT p6-funnel.

## Problem (live verifiziert + code-gegroundet, 2026-06-26)

Symptom: neuer Signup (neue Mail ueber WorkOS AuthKit "Get Started") -> direkt User-Dashboard. Die
live `public/tenant.html` ist korrekt (renderActivation + `r.status===403`->Funnel + `data-plan`-Buttons
sind deployed). Also liefert `/api/self-service/state` ein **200** => der neue Tenant ist faelschlich
`active` statt `suspended`. Der P5-Funnel ist gebaut, wird aber nie erreicht, weil der Status falsch ist.

Code-gegroundete Root-Cause-Kandidaten (vom Plan-Agent gegen den ECHTEN Code auf `master` zu
bestaetigen — Zeilennummern hier nur als Wegweiser, NICHT uebernehmen, sie rotten):

1. **Schema-Default-Footgun:** `src/db/schema.sql` — `tenant.status TEXT NOT NULL DEFAULT 'active'`
   (CREATE TABLE) UND `ALTER TABLE tenant ADD COLUMN IF NOT EXISTS status ... DEFAULT 'active'`. Jeder
   INSERT ohne explizites `status` erzeugt einen aktiven Tenant.
2. **`upsertOnFirstLogin` (`src/web-auth.js`):** `INSERT INTO tenant (id, status, idp_subject)
   VALUES ($1,'suspended',$2) ON CONFLICT (id) DO UPDATE SET idp_subject = EXCLUDED.idp_subject`.
   Korrekt fuer einen NEUEN Tenant (suspended) und korrekt darin, den Status eines BESTEHENDEN nicht
   zu degradieren. ABER: existiert die Tenant-Zeile beim Erst-Login bereits (von einem anderen Pfad
   als `active` angelegt), greift ON CONFLICT -> Status bleibt `active`. **Das ist der Verdacht.**
3. **Kipp-Pfad (zu verifizieren, nicht zu raten):** Welcher Pfad legt die Tenant-Zeile fuer einen
   frischen WorkOS-Signup VOR/STATT `upsertOnFirstLogin` als `active` an? Prime Verdaechtige:
   - `src/store/pg.js` Tenant-Flush — `INSERT INTO tenant (...) ... ON CONFLICT (id) DO UPDATE SET
     status=EXCLUDED.status, ...` schreibt den In-Memory-Status zurueck; steht im State ein neuer
     Tenant `active`, ueberschreibt der Flush das suspended aus `upsertOnFirstLogin`.
   - `src/store/state-ops.js` `registerTenant` / der In-Memory-Default `{ id, status: ACTIVE }`.
   - `src/server.js` alter `/api/onboard`-Pfad (`registerTenant(..., status ACTIVE)`) — pruefen, ob
     er beim Web-Signup ueberhaupt getriggert wird.
   - `src/db/migrate.js` `seedDefaults` — laeuft NUR fuer `BOOTSTRAP_TENANT_ID` (Owner), nicht
     per-Signup; der Owner MUSS `active` bleiben (siehe Invariante O).

Der Plan-Agent muss den **tatsaechlichen** Pfad reproduzieren (pg-Backend, echter Signup-Pfad
upsertOnFirstLogin -> Session -> `/api/self-service/state`) und die EINE Stelle benennen, die den
frischen Tenant `active` werden laesst. Erst dann den Fix.

## Ziel / Soll-Flow

Erst-Login (OIDC/WorkOS) legt **immer einen `suspended`-Tenant** an (kanonisch, idp_subject-gebunden).
`tenant.html` zeigt die **dedizierte Plan-Auswahl** (Starter 4,99 / Business 9,99) -> Plan waehlen ->
(falls keine Karte: Stripe Checkout) -> Subscribe -> Tenant atomar `active` + `kycLevel=CARD` +
Provisioning-Trigger (Testmodus `PROVISIONING_ENABLED=false` -> Nummer `requested`, KEIN Kauf) ->
erst danach volles Dashboard. **Nie direkt nach Signup ins Dashboard.**

## Scope / Aenderungen (verbindlich)

### Part A — Status-Default-Fix (Kern, Root-Cause)

A1. **Schema:** `tenant.status` nicht mehr per Default `active` werden lassen. Entweder Default auf
    `'suspended'` ODER Default entfernen und JEDEN INSERT explizit. Gewaehlte Variante muss
    rueckwaerts-kompatibel sein (bestehende Zeilen unveraendert; `ALTER ... ADD COLUMN IF NOT EXISTS`
    aendert keine vorhandenen Werte). Begruendung im SQL-Kommentar (deutsch, ohne Umlaute).
A2. **Owner-Schutz (kritisch):** `src/db/migrate.js` `seedDefaults` legt die Owner-/Bootstrap-Zeile
    an. Diese MUSS explizit `status='active'` setzen (`INSERT INTO tenant (id, status) VALUES
    ($1,'active') ON CONFLICT DO NOTHING`), sonst sperrt der neue Default den Owner aus. Gleiches gilt
    fuer jeden anderen INSERT, der bewusst einen aktiven Tenant erzeugt (z.B. In-Memory-Bootstrap in
    `state-ops.js` bleibt `ACTIVE`).
A3. **Neuer Web-Login-Tenant = immer `suspended`:** `upsertOnFirstLogin` bleibt der kanonische
    Entstehungspfad. Der unter Problem #3 gefundene Kipp-Pfad wird so geschlossen, dass ein FRISCH
    angelegter Tenant garantiert `suspended` endet — UND ein bereits `active`/`closed` Tenant NICHT
    durch ein nachgelagertes Flush/Upsert degradiert ODER faelschlich reaktiviert wird. Die ON-CONFLICT-
    /Flush-Status-Logik muss diese beiden Faelle sauber trennen (neu=suspended, bestehend=unveraendert).
A4. **Regressionstest (Pflicht):** deterministisch, offline (pglite). Frischer Signup-Pfad
    (`upsertOnFirstLogin` gegen pglite) -> Tenant-Status `suspended`; `/api/self-service/state` fuer
    diese Session = **403**. Plus: Owner/Bootstrap-Tenant bleibt nach `migrate`/`seedDefaults`
    `active` (kein Lockout). Plus: erneuter Login desselben sub degradiert einen inzwischen `active`
    Tenant NICHT zurueck auf suspended (Idempotenz/keine Degradierung).

### Part B — Dedizierte Plan-Auswahl (Starter / Business, KEIN Free)

B1. **`public/tenant.html`:** Der 403-Zweig (renderActivation) zeigt die **dedizierte
    Plan-Auswahl-Ansicht**: zwei Plan-Karten Starter **4,99** und Business **9,99** (Preise sichtbar,
    Waehrung konsistent), Brand wie P1/P5 (Sundartha-Navy, Space Grotesk). Eine Render-Quelle
    (renderBilling) wo moeglich wiederverwenden — keine Duplizierung der Plan-Button-Logik. Flow
    unveraendert zu P5: Plan klicken -> subscribe; `no_card` (409) -> setup-checkout (Stripe) -> return
    -> erneut Plan -> active -> `refresh()` -> volles Dashboard. KEIN Free-Button, KEIN dritter Plan.
B2. **Keine neuen Endpunkte/Plan-Slugs:** `PLAN_SLUGS` bleibt `["starter","business"]`. Part B ist
    Praesentation + Sicherstellung, dass der (durch Part A) jetzt erreichte P5-Funnel die Auswahl
    dediziert und mit Preisen zeigt. Falls Preise heute hartkodiert fehlen: als benannte Konstante
    fuehren (keine Magic Numbers), Anzeige-Strings deutsch.

## Invarianten (verbindlich — Absolute Regeln)

- **O (Owner-Lockout-Schutz):** Owner/Bootstrap-Tenant ist und bleibt `active` nach jedem
  `migrate`/`seedDefaults`/Boot. Der Status-Default-Flip darf den Owner NIE aussperren.
- **AUTH fail-closed:** `webAuthMw` (active-only) bleibt unveraendert fuer `/api/self-service/state`
  und ALLE Daten-/Settings-Routen. Nur die P5-Self-Aktivierungs-Routen (`setup-checkout`, `return`,
  `subscribe`) sind via `webAuthPendingMw` suspended-erreichbar. Suspendierte sehen KEINE Tenant-Daten
  (kein Leak). Hard-Block fuer `closed` bleibt (kein Reaktivieren eines hart gesperrten Tenants).
- **Kein neues Calls/SMS/Geld-Gate-Loch:** p6-funnel fuehrt KEINEN Pfad ein, der Calls/SMS/Kauf
  ausloest. Provisioning bleibt hinter `PROVISIONING_ENABLED` (Dry-Run -> `requested`) + idempotent.
- **Signatur / Disclosure / Budget / Allowlist / Denylist / Land- / Stundenlimit / Max-Dauer**
  unangetastet. Secrets nur via env, nie geloggt/geleakt/in Responses oder MCP-Ausgaben.
- **Idempotenz:** Subscribe-seitige Aktivierung + Webhook-seitige Aktivierung (P3) duerfen zusammen
  NICHT doppelt provisionieren/belasten (vorhandener `tenantHasLiveNumber`-Guard + idempotente Setter).
- **flag-off byte-identisch:** Bei `PAYMENT_ENABLED=false` Verhalten unveraendert; der Status-Fix
  betrifft die Tenant-Entstehung unabhaengig vom Payment-Flag.

## Akzeptanz (deterministische Tests, offline, Pflicht)

1. **Root-Cause-Regression:** frischer Signup (`upsertOnFirstLogin`, pglite) -> Tenant `suspended`;
   Session -> `/api/self-service/state` = **403** (kein Daten-Leak). Vor dem Fix wuerde dieser Test
   `active`/200 sehen (der Test reproduziert den Bug -> faellt auf master rot, gruen nach Fix).
2. **Owner-Schutz:** nach `migrate`/`seedDefaults` ist `BOOTSTRAP_TENANT_ID` `active` (kein Lockout).
3. **Keine Degradierung:** Login -> subscribe -> `active`; erneuter Login desselben sub -> bleibt
   `active` (ON CONFLICT/Flush degradiert nicht).
4. **Paid-Aktivierung (P5-Regression bleibt gruen):** suspended + Karte -> subscribe -> `active` +
   `kycLevel=CARD` + Provisioning genau 1x (bei `PROVISIONING_ENABLED=false`: Nummer `requested`,
   kein Kauf). Subscribe ohne Karte -> `no_card` (409), keine Aktivierung.
5. **Plan-Auswahl-UI:** `tenant.html` zeigt im 403-Zweig genau zwei Plaene (Starter/Business) mit
   Preisen 4,99 / 9,99; ID-/Funktions-Paritaet (kein Dangling), KEIN Free-Element.
6. **`npm test` gruen** (json-Default + pglite-Backend). Neues Verhalten -> neue Tests.

## Abgrenzung (NICHT p6-funnel)

- **KEIN Free-Tier** (Folge-Ticket; bewusst aus dieser Phase ausgeschlossen, Jonas).
- KEINE Stripe-Webhook-Registrierung / WorkOS Staging->Prod (Jonas, Browser).
- KEIN `PROVISIONING_ENABLED=true` (echtes Geld).
- KEIN erzwungener Post-Login-Redirect in Stripe (P5-Entscheidung: gefuehrter Dashboard-Schritt).
- KEIN mehrstufiges Namens-/Geo-Erfassungs-Formular.
- KEIN Push nach master/prod (Lead merged + deployed separat auf explizites Kommando).

## Constraints

ESM, kein Build-Step (Gateway), kein TypeScript. Astro nur in `apps/web`. Kommentare deutsch OHNE
Umlaute (ue/oe/ae). `.claude/refs/clean-code.md` harte Gates (S1/S2 = Blocker). Keine neue npm-Dep
ohne Freigabe. Safety-Gates/Disclosure/Auth/Signatur unantastbar, fail-closed. Kleiner Blast-Radius.
