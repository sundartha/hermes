# Profile-Provisioning + Quota-Enforcement — Driver-Doc

Umbrella/Architektur + verifizierte Wurzeln + Owner-Entscheidungen: `PLAN-PROFILE-PROVISIONING.md`.
Diese Datei = **Treiber-Protokoll + autoritative Spec je Phase** (Scope / NICHT-Scope / Invarianten /
deterministisch pruefbare Checks). Verbindlich VOR jedem Phasenlauf.

Stand: **2026-06-29. ENTWURF, noch keine Phase gelaufen. Alle Owner-Entscheidungen §5 ENTSCHIEDEN.**
Master-Schalter `config.paymentEnabled` Default **AUS** = byte-identisch (EINZIGE Ausnahme: Phase A4 =
DEFAULT_PROFILE->0, deshalb ZULETZT).

Zwei Straenge + ein Abschluss-Schnitt: **GAP A (Abo -> Rechteprofil)**, **GAP B (Plan-Minuten
durchsetzen)** und **A4 (DEFAULT_PROFILE -> 0, §5.8)**. Beide enden in
`server.js`/`state-ops.js`/`plans.js` (Hotspots) -> **KEINE parallelen Worktrees, strikt seriell**.
**A4 ist der EINZIGE Schnitt OHNE `PAYMENT_ENABLED`-Gate (nicht byte-identisch) -> ZULETZT, erst nach
gruenem A2/A3 + Backfill.** Empfohlene Gesamtreihenfolge: **A1 -> A2 -> A3 -> B1a -> B1b -> B2 -> B3 -> A4**.

## Branch-Tabelle

| phaseId | branch                              | baseBranch | planDoc                       | specFile                              | maxFixRounds |
| ------- | ----------------------------------- | ---------- | ----------------------------- | ------------------------------------- | ------------ |
| A1      | `phase/profile-a1-plan-mapping`     | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| A2      | `phase/profile-a2-activation`       | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| A3      | `phase/profile-a3-backfill`         | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| B1a     | `phase/quota-b1a-period-anchor`     | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| B1b     | `phase/quota-b1b-minutes-query`     | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| B2      | `phase/quota-b2-gate`               | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 3            |
| B3      | `phase/quota-b3-visible`            | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 2            |
| A4      | `phase/profile-a4-default-zero`     | `master`   | `PLAN-PROFILE-PROVISIONING.md`| `tasks/profile-provisioning-chain.md` | 2            |

`B1` ist gesplittet (§5.4 = persistieren -> ~8-10 Dateien inkl. Geld-Schema sprengen den lean-Schnitt):
**B1a** = persistierter Periodenanker (`current_period_start`), **B1b** = reine `planMinutesExceeded`-Query.

Abhaengigkeiten (hart): A2 braucht A1; A3 braucht A2; B1a vor B1b; B1b vor B2 und B3; A-Strang (A1-A3)
vor B (geteilte Hotspots — `subscribe.js`/`webhook.js` werden von A2 UND B1a angefasst, durch die
serielle Reihenfolge kollisionsfrei); **A4 ZULETZT, braucht A3 + einmaligen planSlug-Reconcile** (sonst
Total-Sperre zahlender Bestandskunden, §5.8). Jede Phase merged in `master` bevor die naechste startet.

---

## Phase A1 — Plan->Rechte-Mapping (reines Datenmodul)

### Scope (NUR das)
- In `src/plans.js` additiv ein `planSlug -> Profil-Felder`-Mapping (z.B. `PLAN_PROFILE` +
  `planProfileFor(slug)`), das je Plan ALLE `PROFILE_FIELDS` explizit traegt: `allowedNumbers`,
  `allowedCountryCodes`, `unrestricted`, `allowCalendar`, `allowBooking`, `maxCallsPerHour`.
- Werte je Plan (§5.1, ENTSCHIEDEN): **starter und business IDENTISCH** — `allowCalendar=false`,
  `allowBooking=false`, `unrestricted=false`, `allowedNumbers=[]`, `maxCallsPerHour=null` (nur globaler
  Cap). Die Plaene unterscheiden sich NUR in `includedMinutes` (GAP B), NICHT im Profil.
  `allowedCountryCodes` so restriktiv wie heute (kein per-Profil-Freibrief).

### NICHT in Scope
- Kein `setProfile`-Aufruf, kein Gate, keine Aktivierung, kein `server.js`/`state-ops.js`-Diff.
- KEINE Spiegelung der Rechte nach `apps/web/src/lib/plans.js` (Rechte sind SERVER-only).
- `includedMinutes`/`numberCount`/`features` unveraendert.

### Invarianten / Safety
- Mapping traegt JEDES Feld explizit (gegen restriktiven DEFAULT-Rueckfall). NIE `unrestricted=true`,
  NIE eigene `allowedNumbers` (Toll-Fraud-Flaeche). `sanitizeProfile(mapping)` verlustfrei.
- `apps/web`-Spiegel bleibt 1:1 zu `PLAN_CATALOG` (Drift-Guard `test/plans-catalog.test.js` gruen).
- Kommentare deutsch ohne Umlaute, ESM, kein Build-Step, kein neuer npm-Dep.

### Deterministisch pruefbare Checks
- `node --check src/plans.js` -> ok.
- `npm test` (beide Backends) gruen; `test/plans-catalog.test.js` weiter gruen.
- Neuer Test: fuer jeden `CATALOG_SLUGS`-Slug traegt `planProfileFor(slug)` ALLE sechs
  `PROFILE_FIELDS` (kein `undefined`).
- Neuer Test (§5.1): `planProfileFor('starter')` und `planProfileFor('business')` sind feld-gleich
  (`allowCalendar/allowBooking/unrestricted===false`, `allowedNumbers===[]`, `maxCallsPerHour===null`).
- `grep -n "PLAN_PROFILE\|planProfileFor" apps/web/src/lib/plans.js` -> LEER (keine Web-Spiegelung).

### Done-Kriterium
Mapping vollstaendig je Slug, kein Konsument, Tests gruen, Web-Katalog-Drift gruen.

---

## Phase A2 — Aktivierung provisioniert plan-basiertes Profil

### Scope (NUR das)
- `src/billing/activation.js`: nach `accounts.setStatus(active)` `setProfile(account.email, tierProfile)`
  einbauen; `planSlug` aus `store.tenantSubscription(tenant)` lesen (kein neues Argument), Tier-Profil
  aus `planProfileFor` (A1).
- `src/web-auth.js` (`makeAccounts`): NEUE pg-Query `accountByTenant(tenantId)`
  (`SELECT sub,email FROM account WHERE tenant_id=$1`, RLS-exempt) als injizierter Seam.
- Beide Aufrufer (`src/billing/webhook.js`, `src/self-service-routes.js`) so verdrahten, dass
  identische Wirkung entsteht.

### NICHT in Scope
- Backfill Bestand (A3), Minuten (B*), Owner-Profil-Aenderung, SUSPEND/DELETED-Reset, DEFAULT_PROFILE-Aenderung.
- Kein neues Schema (account/profile-Tabellen unveraendert).

### Invarianten / Safety
- EINE Quelle: `setProfile` in `activation.js`, NICHT im Route-Layer (Webhook hat keine `req`-Identitaet).
- Profil-Key = `account.email` (email-first, exakt was `place_call`/`resolveProfile` liest).
- Tier-Profil traegt ALLE `PROFILE_FIELDS` (Merge==Replace, kein stale Recht bei Downgrade).
- Reihenfolge KYC -> Status -> provision unveraendert; `setProfile` zusaetzlicher idempotenter Effekt.
- Fehlender/mehrdeutiger Account -> `setProfile`-SKIP + `audit` (nur email/Keys/Tenant, nie Profil-Werte),
  **OHNE** `activatePaidTenant` zu werfen (KYC/Status/provision bleiben).
- Fehlender/unbekannter `planSlug` (`planProfileFor` ohne Mapping; Admin-Aktivierung ohne subscribe ODER
  Webhook-Reihenfolge/`planSlugOf(obj)`=null) -> ebenfalls SKIP + audit, NIE `setProfile(email, undefined)`
  (symmetrisch zu B2 "kein Plan -> blocken"). Leere `account.email` -> SKIP (Lesepfad ignoriert sie ->
  stiller DEFAULT_PROFILE).
- Merge==Replace: das vollstaendige Tier-Profil ueberschreibt ein evtl. per Admin-`POST /api/profiles`
  gesetztes `unrestricted=true`/eigene `allowedNumbers` deterministisch auf `false`/`[]` (kein stale
  Toll-Fraud-Bypass). SKIP-Faelle (Webhook vor Account-Anlage, `web-auth.js:393`) sind nachholbar: der
  naechste Aktivierungs-Trigger ODER der A3-Backfill holt das Profil nach.
- `PAYMENT_ENABLED=false` -> Aktivierungspfad unerreichbar -> kein Profil (byte-identisch).
- Safety-Gates / Offenlegung / Signatur unberuehrt. Beide Backends. Neue config-Var -> BASE_ENV + `.env.example`.

### Deterministisch pruefbare Checks
- `node --check src/billing/activation.js src/web-auth.js src/billing/webhook.js src/self-service-routes.js` -> ok.
- `npm test` (json + pglite) gruen.
- Neuer Test (beide Backends): nach `activatePaidTenant` traegt `s.profiles[account.email]` das Tier-Profil
  des `planSlug`; direkter Pfad UND Webhook-Pfad identisch; fehlender Account -> SKIP, Status=ACTIVE +
  kycLevel>=CARD trotzdem gesetzt; `PAYMENT_ENABLED=false` -> kein Profil-Eintrag.
- Neuer Test (Toll-Fraud-Downgrade): vorbestehendes Profil `unrestricted=true` + `allowedNumbers=[ziel]` ->
  nach `activatePaidTenant` traegt `s.profiles[account.email]` `unrestricted===false` UND
  `allowedNumbers===[]` (Merge wirkt als Replace, kein stale Bypass).
- Neuer Test (planSlug-loser Webhook-Pfad): Webhook-ACTIVATE ohne `metadata.plan_slug` ->
  `setProfile`-SKIP (kein leeres/`undefined`-Profil geschrieben), Status/KYC trotzdem gesetzt.
- Neuer Test: leere `account.email` -> SKIP (kein Eintrag), kein Wurf.
- `grep -n "setProfile" src/billing/activation.js` -> Treffer; `grep -rn "setProfile" src/routes src/self-service-routes.js`
  -> KEIN neuer Provisioning-Caller im Route-Layer.

### Done-Kriterium
Achsen-Bruecke geloest (tenantId -> `account.email` -> Profil), beide Pfade identisch, fail-closed SKIP,
beide Backends gruen.

---

## Phase A3 — Migration/Backfill Bestand + Owner-Profil

### Scope (NUR das)
- Neues Script `scripts/backfill-plan-profiles.js` (idempotent, fail-closed, Dry-Run/Diff), nach Muster
  `scripts/bootstrap-tenant.js`: ueber Store-Fassade, beide Backends, `await store.save()` am Ende.
- Enumeration ueber `s.tenants` (traegt `kyc_level`/`planSlug`/`currentPeriodEnd` ueber die volle
  Hydrierung), NICHT `listTenants()` (nur id/status/createdAt). Filter =
  `status===ACTIVE && KYC_ORDER(kycLevel)>=CARD && planSlug vorhanden && tenantId!==BOOTSTRAP_TENANT_ID`.
- Fuer jeden so gefilterten Subscriber via `accountByTenant` (A2) + `planProfileFor` (A1) das Tier-Profil
  auf `account.email` setzen (email-first wie Laufzeit-Lookup).
- Optionaler einmaliger `planSlug`-Reconcile (aus der Stripe-Subscription) als Vorlauf, damit slug-lose
  Bestands-Tenants (`webhook.js:171` selektiver Patch) nicht still uebersprungen werden.
- Owner-Profil-Verhalten festschreiben (§5.5): Bootstrap ueber localhost permissiv ODER explizites Owner-Profil.

### NICHT in Scope
- Kein Schema-Diff, kein neuer Laufzeit-Gate, keine `activation.js`-Aenderung.
- Kein `unrestricted`/eigene `allowedNumbers`.

### Invarianten / Safety
- Idempotent: zweiter Lauf = 0 Aenderungen. Mehrdeutiger Tenant (`account.tenant_id` nicht unique, >1
  Account) -> ueberspringen + loggen, NICHT raten (fail-closed).
- Owner/Bootstrap HART ausgenommen (`tenantId!==BOOTSTRAP_TENANT_ID`): Boot-KYC-Heal hebt ihn auf
  `id_verified>CARD`, er hat keinen Plan -> ein naiver `status=ACTIVE && kyc>=CARD`-Filter wuerde ihn
  fangen und `planProfileFor(undefined)` werfen/Muell schreiben. Identisch zur B2-Owner-Ausnahme.
- `planProfileFor` NIE mit `undefined`/`null` aufrufen: fehlender `planSlug` -> ueberspringen + loggen
  (email/tenant/Keys, nie Profil-Werte). Kein permissives Default-Profil bei fehlendem Plan.
- Backfill-Key = dieselbe `validIdentity`-Praezedenz wie Laufzeit (email-first) -> kein Drift zu DEFAULT_PROFILE.
- Vollstaendiger Tier-Snapshot ueberschreibt auch ein bestehendes `unrestricted=true` auf `false`
  (Merge==Replace, kein stehengebliebener Verifikations-Gate-Bypass nach Backfill).
- Nur email/Keys/Tenant-Count loggen, nie Profil-Werte (PII). json ohne `account`-Tabelle -> No-Op.
- Profil-Snapshot deckt sich mit A1/A2 (kein zweites Mapping).

### Deterministisch pruefbare Checks
- `node --check scripts/backfill-plan-profiles.js` -> ok.
- `npm test` (beide Backends) gruen.
- Neuer Test (pglite): Dry-Run liefert erwarteten Diff; nach Lauf traegt `s.profiles[email]` das Tier-Profil;
  zweiter Lauf 0 Aenderungen; Tenant mit 2 Accounts uebersprungen + geloggt; pg-Round-Trip
  `hydrate->flush->hydrate` haelt den Key.
- Neuer Test (pglite): Owner/Bootstrap (KYC geheilt, kein Plan) wird NICHT gebackfillt; aktiver Tenant
  ohne `planSlug` uebersprungen + geloggt; email-Key mit vorbestehendem `unrestricted=true` -> nach
  Backfill `false` + `allowedNumbers=[]`.
- json-Backend: Backfill wirft nicht, ist No-Op (`grep`/Test).

### Done-Kriterium
Script idempotent + fail-closed, Dry-Run-Diff korrekt, Owner-Profil definiert, beide Backends gruen.

---

## Phase B1a — Persistierter Periodenanker `current_period_start` (Geld-Schema)

### Scope (NUR das)
- Additive NULLABLE Tenant-Spalte `current_period_start` (wie I8) durch alle Schichten:
  `src/db/schema.sql` + `src/store/json.js` + `src/store/pg.js` (`rowToTenant`/`flushTenant`) +
  `setTenantSubscription` + `src/billing/subscribe.js` + `src/billing/webhook.js` (aus Stripe
  `current_period_start` setzen).
- Einmaliger Migrations-Backfill `current_period_start` aus dem vorhandenen `stripeCurrentPeriodEnd`
  (Bestands-Tenants haben die neue Spalte sonst NULL).

### NICHT in Scope
- Keine Query (B1b), kein Gate (B2), keine Anzeige (B3).

### Invarianten / Safety
- Additiv NULLABLE, fail-closed Default. `subscribe.js`/`webhook.js` werden auch von A2 angefasst ->
  durch "A komplett vor B" kollisionsfrei (geteilter Hotspot explizit vermerkt).
- `PAYMENT_ENABLED=false` -> byte-identisch (Spalte ungenutzt). Neue config-Var/Spalte -> BASE_ENV +
  `.env.example`, fail-closed Default. Beide Backends.

### Deterministisch pruefbare Checks
- `node --check src/store/json.js src/store/pg.js src/billing/subscribe.js src/billing/webhook.js` -> ok.
- `npm test` (json + pglite) gruen.
- Neuer Test (beide Backends): pg-Round-Trip `hydrate->flush->hydrate` haelt `current_period_start`;
  Bestands-Tenant mit `stripeCurrentPeriodEnd` aber NULL `current_period_start` -> Migrations-Backfill
  setzt den Wert.

### Done-Kriterium
Spalte additiv in beiden Backends + Round-Trip stabil, Webhook/Subscribe setzen sie, Bestands-Backfill
vorhanden, Tests gruen.

---

## Phase B1b — Per-Tenant Monats-Minuten (reine, fail-closed Query)

### Scope (NUR das)
- `src/store/state-ops.js`: neue reine Query neben `voiceMinutesUsedSince`, z.B.
  `planMinutesExceeded(s, tenantId, { includedMinutes, periodStartIso })` (`>=`), analog `budgetExceeded`
  (kein IO, kein `usageFor`-Bezug). Aufrufer reicht Plan-Aufloesung + Periodenanker herein.
- Durchreichen in Fassade `src/store.js` + `src/store/json.js` + `src/store/pg.js` (KEINE neue SQL).

### NICHT in Scope
- Kein Gate-Einbau (B2), keine Anzeige (B3), keine `quotaView`-Aenderung, kein Outbound/Inbound-Diff,
  keine Schema-Aenderung (B1a).

### Invarianten / Safety
- Reine Query, keine Mutation. Liegt auf der Minuten-Quelle (`voiceMinutesUsedSince`), NICHT `usageFor`.
- **Query-Vertrag fail-closed (§5.4, bindend):** leerer/fehlender `periodStartIso` ODER fehlende
  `includedMinutes`/Plan => `exceeded=true`. NIE `undefined` an `voiceMinutesUsedSince` durchreichen
  (`e.occurredAt >= undefined` ist immer false -> stilles `used=0` = volles Kontingent, genau die
  `quotaView`-fail-OPEN-Semantik, die das Gate NICHT erben darf). Die Anker-Ableitung fuer Bestand
  (NULL `current_period_start` + vorhandenes `currentPeriodEnd` -> abgeleitetes Fenster) macht der
  Aufrufer (B2); die Query bekommt dann einen gueltigen Anker.
- `PAYMENT_ENABLED=false` -> Ledger leer -> nie exceeded (byte-identisch).

### Deterministisch pruefbare Checks
- `node --check src/store/state-ops.js src/store.js src/store/json.js src/store/pg.js` -> ok.
- `npm test` (json + pglite) gruen.
- Neuer Test (beide Backends): used>=included -> true, sonst false; EUR-`budgetExceeded` und
  `planMinutesExceeded` unabhaengig ausloesbar (kein Doppelzaehlen); Reset-Fenster korrekt; leerer Ledger
  -> nie exceeded; **fehlender/leerer `periodStartIso` ODER fehlende `includedMinutes` -> exceeded=true**
  (fail-closed, kein `undefined`-Durchreichen).

### Done-Kriterium
Query in Fassade + beiden Backends, fail-closed Vertrag belegt, kein Achsen-Vermischen, Tests gruen.

---

## Phase B2 — Quota-Gate vor Outbound (+ Inbound) + Erschoepfungs-Verhalten

### Scope (NUR das)
- `src/server.js` Outbound (`POST /api/calls`): neues PARALLELES Glied NEBEN `budgetExceeded` (`~:1266`)
  als SEPARATES `if` mit EIGENEM `audit grund=minutes` (NIE in den `budget`-`if` gefaltet), Status 402.
  Aufruf: `store.tenantSubscription(tenantId)` -> `findPlan(planSlug)` -> `store.planMinutesExceeded(...)`,
  hinter `config.paymentEnabled`.
- Periodenanker-Ableitung (§5.4): persistierter `current_period_start` (B1a) ODER, falls NULL aber
  `currentPeriodEnd` vorhanden, daraus ABGELEITET (Bestands-Fallback); voellig fehlend -> fail-closed.
- Owner/Bootstrap-Ausnahme (`tenantId===BOOTSTRAP_TENANT_ID`) wird als ERSTE Bedingung VOR der
  "kein Plan -> blocken"-Regel evaluiert (sonst sperrt `findPlan(null)->null` den Owner).
- Inbound (`/voice`, `~:848`) wird durch Minuten NICHT gegated (§5.2 bindend); Inbound-Kostenschutz
  bleibt allein `budgetExceeded` (`~:848`).
- Optional Worst-Case-Minuten-Reservierung (§5.3) nur falls Owner Null-Ueberzug verlangt.

### NICHT in Scope
- `budgetExceeded`/`globalBudgetExceeded`/`reserveExceedsBudget` aendern/ersetzen — VERBOTEN.
- Anzeige (B3), Query-Logik (B1b), Schema (B1a), `quotaView`-Aenderung, DEFAULT_PROFILE-Aenderung.

### Invarianten / Safety
- `budgetExceeded || globalBudgetExceeded` bleibt davor/daneben unangetastet (Regel 1, Schnittmenge).
- Fail-closed ABSICHTLICH: kein Plan bei aktivem Subscriber ODER fehlender Periodenanker -> blocken
  (KEIN Fail-Open-Misfix; ein Fixer darf das nicht "reparieren"). Bestands-Tenant mit NULL
  `current_period_start` aber gueltigem `currentPeriodEnd` bezieht den abgeleiteten Anker und wird
  NICHT gesperrt. Owner-Ausnahme ueber Bootstrap-ID, NICHT ueber `tenantActiveSubscriber` (stale
  Kommentar `state-ops.js:715`).
- §5.2 bindend: Inbound NICHT durch Minuten gegated; Minuten-Erschoepfung != Inbound-Kostenstop.
- Disclosure / Signatur / Denylist / Land / Stundenlimit / perTargetCap unberuehrt.
- `PAYMENT_ENABLED=false` -> No-Op, byte-identisch. Beide Backends. Neue config-Var -> BASE_ENV + `.env.example`.

### Deterministisch pruefbare Checks
- `node --check src/server.js` -> ok.
- `npm test` (json + pglite) gruen.
- Neuer Test (beide Backends): erschoepfter Subscriber -> Outbound 402 `grund=minutes`; Budget-Gate bleibt
  separat ausloesbar (kein Doppelzaehlen); Owner/Bootstrap NIE durch Minuten gesperrt; aktiver Subscriber
  mit fehlendem Plan/Anker -> 402 (absichtlich fail-closed); Bestands-Tenant mit NULL
  `current_period_start` + gueltigem `currentPeriodEnd` -> Outbound NICHT gesperrt (abgeleiteter Anker);
  `PAYMENT_ENABLED=false` -> Call laeuft (byte-identisch); Inbound NICHT durch Minuten gegated (§5.2).
- `grep -n "budgetExceeded" src/server.js` -> Gate weiter vorhanden (nicht ersetzt).

### Done-Kriterium
Minuten-Gate als paralleles Glied eingehaengt, Budget unangetastet, Owner-Ausnahme + Erschoepfungs-Verhalten
belegt, beide Backends gruen.

---

## Phase B3 — Quota im Self-Service/Dashboard sichtbar (Resthaertung)

### Scope (NUR das)
- `src/billing/meter.js`: `quotaView`/`periodStartIso` an den Periodenanker aus B1a angleichen, damit
  Anzeige-Fenster == Gate-Fenster. DENSELBEN Bestands-Fallback wie B1b/B2 verwenden (NULL
  `current_period_start` + `currentPeriodEnd` -> abgeleiteter Anker), damit auch Bestands-Tenants
  konsistent angezeigt werden (sonst "Rest X Min, trotzdem geblockt").
- `src/self-service-routes.js`: Anzeige bleibt an `config.selfServiceEnabled && config.multiTenant`
  gekoppelt, keyt auf `req.tenant.tenantId`; optional Erschoepfungs-Flag.

### NICHT in Scope
- Keine Gate-Logik, keine neuen Routen, keine Auth-Aenderung, kein Owner-Dashboard-Umbau.

### Invarianten / Safety
- Read-only; keyt NIE auf email. Flags aus / `PAYMENT_ENABLED=false` -> Anzeige verschwindet (byte-identisch).
- Anzeige-Wert konsistent zum Gate (gemeinsamer Anker), sonst Kunden-Verwirrung ("Rest 5 Min" + Block).

### Deterministisch pruefbare Checks
- `node --check src/billing/meter.js src/self-service-routes.js` -> ok.
- `npm test` (beide Backends) gruen.
- Neuer Test: Anzeige-`remainingMinutes` nutzt denselben Periodenanker wie `planMinutesExceeded`;
  Tenant mit NULL `current_period_start` -> Anzeige-Fenster == Gate-Eingabe (abgeleiteter Anker);
  Flags aus -> kein Quota-Feld in der Response.

### Done-Kriterium
Anzeige konsistent zum durchgesetzten Gate, Flags-aus byte-identisch, Tests gruen.

---

## Phase A4 — DEFAULT_PROFILE auf 0 Calls/h (strikter Trenner, ZULETZT / go-live-Haertung)

### Scope (NUR das)
- `src/store/defaults.js`: Konstante `DEFAULT_PROFILE_MAX_CALLS_PER_HOUR` von 2 auf **0** (benannt,
  kein Magic-Number). Damit macht ein nicht-provisionierter authentifizierter Nutzer gar kein Outbound;
  nur ein Plan-Profil (A2/A3) schaltet frei (§5.8).

### NICHT in Scope
- KEIN Gate-Code-Diff (`userHourReached` blockt `maxCallsPerHour=0` bereits hart). Keine Aenderung an
  `OWNER_PROFILE`, Plan-Profilen, Audit-Gruenden, Routen. Kein Payment-Gate (DEFAULT gilt immer).

### Invarianten / Safety
- **EINZIGER Schnitt OHNE `PAYMENT_ENABLED`-Gate -> NICHT byte-identisch** (DEFAULT_PROFILE wirkt
  immer). Deshalb ZULETZT, erst nach gruenem A2/A3 + einmaligem planSlug-Reconcile + Backfill-Beleg
  (jeder Zahler hat ein Profil). Sonst faellt jeder zahlende Bestandskunde ohne provisioniertes Profil
  von 2 auf 0 = Voll-Sperre.
- `maxCallsPerHour=0` blockt hart: `userHourReached` -> `limit=min(global,0)=0`, `count>=0` immer wahr
  (`server.js:614-619`; Kommentar `:630`). Drift-Test pinnt das (kein Falsy-Missverstaendnis).
- Owner unberuehrt (localhost/leere email -> `OWNER_PROFILE`, nie DEFAULT). Harte Gates / Disclosure /
  Signatur unberuehrt. Beide Backends.

### Deterministisch pruefbare Checks
- `node --check src/store/defaults.js` -> ok.
- `npm test` (json + pglite) gruen.
- Neuer Test: `userHourReached({maxCallsPerHour:0}, requestedBy)` -> true bei 0 Calls (harter Block).
- Neuer Test: provisionierter Subscriber (A2-Tier-Profil) telefoniert weiter; Owner (leere email)
  unberuehrt.
- Bestandstests, die DEFAULT=2 pinnen, bewusst auf 0 nachgezogen + begruendet
  (`grep -rn "maxCallsPerHour\|DEFAULT_PROFILE" test/` pruefen).

### Done-Kriterium
DEFAULT=0 blockt hart, Plan-/Owner-Pfade gruen, Backfill-Beleg (jeder Zahler hat Profil) dokumentiert,
beide Backends gruen.

---

## Driver-Protokoll (duenner Lead)

0. **Owner-Entscheidungen `PLAN-PROFILE-PROVISIONING.md §5` sind ALLE ENTSCHIEDEN (2026-06-29):**
   §5.1 starter=business identisch (calendar/booking aus, `unrestricted=false`, `maxCallsPerHour=null`,
   nur `includedMinutes` unterscheiden); §5.2 nur Outbound gegated; §5.3 harte Schwelle `used>=included`
   (keine Minuten-Reserve); §5.4 `current_period_start` persistieren + Bestands-Anker aus
   `currentPeriodEnd` ableiten, voellig fehlend=blocken; §5.5 Owner nur lokal/MCP (Bootstrap-ID-Ausnahme,
   KEIN `OWNER_IDP_SUBJECT`); §5.6 global-by-email (B2C 1:1); §5.7 json=No-Op + Prod=pg; §5.8 DEFAULT->0
   als Phase A4 ZULETZT; §5.9 Re-Aktivierung gewinnt (Downgrade=Replace, Admin-Override ueberschrieben,
   SUSPEND laesst Profil stehen). §5.2/§5.4 sind bindende fail-closed Invarianten. VOR Merge faktisch zu
   belegen: Prod=`STORE_BACKEND=pg` (§5.7) UND `business.includedMinutes`=120 (Katalog-Wahrheit, NICHT 100).
1. Phasen **SEQUENZIELL** in der Reihenfolge der Branch-Tabelle (A1->A2->A3->B1a->B1b->B2->B3). KEINE
   parallelen Worktrees (geteilte Hotspots — `subscribe.js`/`webhook.js` teilen A2 und B1a; durch
   "A komplett vor B" kollisionsfrei).
2. Je Phase EIN Lauf von `.claude/workflows/phase-impl-lean.js` mit Args:
   `phaseId`, `phaseTitle`, `branch`, `baseBranch=master`, `planDoc=PLAN-PROFILE-PROVISIONING.md`,
   `specFile=tasks/profile-provisioning-chain.md`, `maxFixRounds` (aus Branch-Tabelle).
3. Der Workflow self-fixt bis `gate=PASS` und liefert einen kompakten Return + `tasks/<phaseId>-report.md`.
   Der Lead **liest nie Code/Diffs**, nur den Return + Report.
4. Bei `gate=PASS`: Lead merged den Phasen-Branch via Stash in `master` (lokal). Erst dann naechste Phase.
5. **Push NUR auf Owner-Freigabe:** `git push origin master` UND (fuer Live) `git push upstream master`
   (Deploy-Repo-Split: Render deployt upstream). Kein Auto-Push.
6. Bei `gate=BLOCKED` nach `maxFixRounds`: Lead stoppt, meldet den Blocker-Report an den Owner, kein Merge.

## Absolute Regeln (JEDE Phase — CLAUDE.md)

- Safety-Gates (Allowlist/Denylist/Land/Stundenlimit/Budget global+pro-Tenant als SCHNITTMENGE/
  Max-Dauer/Provider-Signatur fail-closed) NIE entfernen/aufweichen/per-Default umgehen.
- Minuten-Gate ist ein NEUES PARALLELES Glied — `budgetExceeded`/`globalBudgetExceeded`/
  `reserveExceedsBudget` NIE ersetzen.
- Offenlegungssatz fest verdrahtet, Auth fail-closed.
- `PAYMENT_ENABLED=false` = byte-identisch (kein Profil, kein Minuten-Block).
- `resolveProfile`-Asymmetrie (leere email -> OWNER_PROFILE) NIE auf bekannte Identitaeten ausweiten.
- Profil nur fuer bekannte, verifizierte Identitaet (`account.email` aktiver+CARD-Tenant); fehlender/
  mehrdeutiger Account -> fail-closed SKIP, kein Raten.
- Beide Backends (json + pglite) testen; neue config-Var/Spalte -> `test/helpers.js` BASE_ENV +
  `.env.example` mit fail-closed Default (test-base-env-drift).
- Unbezahlte/erschoepfte Kunden bleiben geblockt — fehlendes Feature, kein Loch; nicht aufweichen.
- Deutsche Kommentare OHNE Umlaute (ue/oe/ae), ESM, kein Build-Step, kein neuer npm-Dep ohne Freigabe.
- Nie raten — bei Unsicherheit Owner fragen.
