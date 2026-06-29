# PLAN-PROFILE-PROVISIONING.md

Strategie, um zwei Luecken zwischen Bezahlung und scharfem Dienst zu schliessen.
Entstanden aus einer Code-Forensik (5 Facetten-Investigatoren + adversariale Pre-Mortem-
Verifikation + Synthese, Stand 2026-06-29). Jede Phase = ein `phase-impl-lean`-Schnitt,
Merge im Lead.

> Status: **ENTWURF (noch nicht implementiert). Alle Owner-Entscheidungen §5 ENTSCHIEDEN (2026-06-29).**
> PAYMENT_ENABLED bleibt der Master-Gate: aus = byte-identisch (EINZIGE Ausnahme: Phase A4 = DEFAULT->0,
> der einzige nicht byte-identische Schnitt, deshalb ZULETZT). Vor Merge faktisch belegen: Prod=pg,
> `business.includedMinutes`=120.

Die zwei Luecken (beide am echten Code bestaetigt, §0):

- **GAP A — Abo provisioniert KEIN Rechteprofil.** Ein zahlender Standard-Kunde passiert das
  Zugangs-Gate, landet aber auf `DEFAULT_PROFILE` (2 Calls/h, kein Kalender, kein Booking),
  weil keine Aktivierung je `setProfile` ruft.
- **GAP B — Plan-Minuten (30 / 120) werden NICHT durchgesetzt.** `includedMinutes` ist reine
  Anzeige; kein Gate stoppt einen Call wegen verbrauchter Minuten.

---

## 0. Verifizierte Wurzeln (am Code bestaetigt)

Nur `confirmed=true`-Befunde der Investigatoren. Zeilennummern koennen rotten — jede Phase
bestaetigt sie per Read/Grep neu.

### GAP A — Profil/Aktivierung

| #   | Befund                                                                                                   | Wurzel                                                                                                                            | Beleg (file:line)                                              |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A0  | `profile`-Tabelle ist GLOBAL, PK=email, KEINE `tenant_id`, RLS `profile_global USING(true)`              | Owner-Removal P5 zog `tenant_id` aus PK + Spalte; Rechteprofile sind betreiber-/admin-weit, nicht pro Telefon-Workspace          | `src/db/schema.sql:196` (profile), `:417` (profile_global RLS)  |
| A1  | `resolveProfile(s,email)` -> leere email => `OWNER_PROFILE` (fail-OPEN), gesetzte email ohne Eintrag => `DEFAULT_PROFILE` | Fail-OPEN-Branch ist reine String-Leerheits-Pruefung (localhost/stdio), bewusst entgegengesetzt zu `resolveTenant` (fail-CLOSED) | `state-ops.js:1308-1310`; `defaults.js:359-362`               |
| A2  | `DEFAULT_PROFILE` = `maxCallsPerHour=2`, `allowCalendar=false`, `allowBooking=false`, `unrestricted=false`, leere Allowlists | restriktiver Default, aber NICHT null — der Zahler wird gedrosselt, nicht gesperrt                                                | `defaults.js:345-352` (Konstante `:327`)                       |
| A3  | `OWNER_PROFILE` = `maxCallsPerHour=null`, `allowCalendar=true`, `allowBooking=true`, `unrestricted=false`, leere Allowlists | erreichbar NUR bei leerer Identitaet (localhost/stdio); lockert das Verifikations-Gate NICHT                                       | `defaults.js:334-341`                                          |
| A4  | EINZIGER `setProfile`-Caller ist die Admin-Route `POST /api/profiles`; Aktivierung ruft KEIN `setProfile` | `activatePaidTenant` = `setKycLevel(CARD)` + `setStatus(active)` + `provision` — kein Profil-Effekt                              | `api-profiles.js:33`; `billing/activation.js:13-17`           |
| A5  | `createTenantSubscription` ruft nur `store.setTenantSubscription`, KEIN `setProfile`, aktiviert nicht selbst | direkter Subscribe-Pfad und Webhook-Pfad teilen `activatePaidTenant`; beide ohne Profil                                          | `billing/subscribe.js:56-78`; `billing/webhook.js:178`        |
| A6  | Folge: zahlender Subscriber passiert `tenantActiveSubscriber` (status=ACTIVE + kycLevel>=CARD), bleibt auf `DEFAULT_PROFILE` | Achsen-Bruch: Profil keyt auf IDENTITAET (email/sub), Aktivierung arbeitet auf `tenantId`                                        | `state-ops.js:720`; `activation.js:13`                         |
| A7  | Profil-Lesepfad (Wirkungsort) keyt EMAIL-FIRST (`req.auth.email \|\| sub`) ueber `X-Internal-Identity`     | `place_call`/`get_calendar`/Booking lesen `resolveProfile(internalIdentity)` — Profil-Key muss `account.email` treffen           | `server.js:1812`; `mcp-tools.js:35`; `server.js:1177,1421`    |
| A8  | Bruecke = `account`-Tabelle (`sub` PK, `email` NOT NULL, `tenant_id` NOT NULL FK, NICHT unique, RLS-exempt); existiert NUR in pg | im json-Backend gibt es keine `account`-Tabelle -> dort sind Profile faktisch owner-only (leere email)                          | `src/db/schema.sql:318` (account); `web-auth.js:389-474`        |
| A9  | Es gibt KEINE Query `accountByTenant` (tenant_id -> email/sub)                                            | `makeAccounts` hat nur `resolve(sub)`, `setStatus(tenantId)`, `setRole(email)`, `listTenants`, `upsertOnFirstLogin` — die Bruecke fehlt | `web-auth.js:389-474`                                          |
| A10 | `setProfile` MERGT additiv (`{...existing, ...clean}`) ueber `sanitizeProfile`-Whitelist `PROFILE_FIELDS` | bei Downgrade bliebe ein altes Recht stehen, wenn das neue Profil den Key nicht explizit setzt                                   | `state-ops.js:1332-1335`; `defaults.js:244-251`              |
| A11 | `resolveProfileFrom` mergt gespeicherten Datensatz ueber `DEFAULT_PROFILE` — fehlende Felder fallen restriktiv zurueck | ein Teilfeld-Profil (`{allowCalendar:true}`) erbt `maxCallsPerHour=2` aus DEFAULT                                                | `defaults.js:361`                                              |
| A12 | `setProfile`/`listProfiles`/`deleteProfile` in allen 3 Schichten; pg-Flush ist `deleteMissing`-basiert    | ein verlorener Key wird beim naechsten Flush geloescht -> Setter MUSS `s.profiles` konsistent halten                            | `store.js:102-105`; `json.js:544-573`; `pg.js:991-1011`     |

### GAP B — Plan-Minuten / Quota

| #   | Befund                                                                                              | Wurzel                                                                                                            | Beleg (file:line)                                          |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| B0  | `PLAN_CATALOG` (starter `includedMinutes=30`, business `120`); `includedMinutes` ist reine ANZEIGE | reines Datenmodul ohne Rechte/Limit-Felder; einziger Konsument von `includedMinutes` ist `quotaView` (Anzeige)  | `plans.js:16-49,55`                                         |
| B1  | `apps/web/src/lib/plans.js` ist 1:1-Datenkopie; Drift = roter Build                                | `assert.deepEqual(WEB_CATALOG, PLAN_CATALOG)` — jeder `includedMinutes`-Edit MUSS in BEIDEN Dateien identisch    | `test/plans-catalog.test.js:58-62`                         |
| B2  | `quotaView` rechnet used/remaining; einziger Konsument = Self-Service-Anzeige; KEIN Gate           | reine Praesentation ueber `paymentView`, gekeyt auf `tenantId`; erzwingt nichts                                  | `billing/meter.js:98-107`; `self-service-routes.js:73`     |
| B3  | Kosten-Gates heute: `budgetExceeded` (EUR) + `globalBudgetExceeded` PARALLEL + `reserveExceedsBudget`; KEIN Minuten-Gate | EUR-Achse voellig getrennt von `includedMinutes`; kein Code verknuepft Plan-Minuten mit einem Cap               | `state-ops.js:1096,1106,1207`; `server.js:1266,1277`       |
| B4  | ZWEI Verbrauchs-Quellen: (1) `usageFor` Live-Map `{calls,costEur}` fuer Budget; (2) append-only Ledger `usageEvents` + `voiceMinutesUsedSince` fuer Quota/Meter | bewusst getrennt (kein Doppelzaehlen); Minuten-Gate MUSS auf `voiceMinutesUsedSince` aufsetzen, NICHT `usageFor` | `state-ops.js:1026,1136-1151,1173-1182`                     |
| B5  | `kind=voice_minute` wird beim CALL-ENDE und NUR bei `PAYMENT_ENABLED` angehaengt                   | VOR-Call-Gate sieht nur beendete Calls; laufende Minute zaehlt nicht (fail-OPEN am Rand)                         | `server.js:961-971,1009`                                    |
| B6  | Monats-Fenster `periodStartIso = currentPeriodEnd - 1 Monat` ist als "BEWUSSTE VEREINFACHUNG, KEIN Gate" markiert | Monatsletzten-Ueberlauf (31.03 -> 03.03) verschiebt das Fenster um Tage; fuer ein Geld-Gate nicht akzeptabel    | `billing/meter.js:78-89`                                    |
| B7  | `quotaView` ist an drei Stellen fail-OPEN: kein Plan -> `null`; kein `currentPeriodEnd` -> used=0; Ledger erst bei Call-Ende | als Anzeige ok, als Gate toedlich -> Minuten-Gate braucht eigene fail-closed Funktion                           | `billing/meter.js:98-106`                                  |
| B8  | `place_call`-Gate-Kette fail-closed: KYC 403 -> Nummer 403 -> Budget 402 -> Reserve 402; Inbound `/voice` eigener Budget-Gate | ein Minuten-Gate ist ein NEUES PARALLELES Glied (Schnittmenge), das Budget NIE ersetzt                          | `server.js:1167-1282,848`                                   |

---

## 1. Achsen-Bruch & Mechanik (kurz)

**Zwei orthogonale Identitaets-Achsen treffen pro Request am Gate aufeinander:**

- **PROFIL-Achse (Rechte):** keyt auf IDENTITAET, EMAIL-FIRST (`req.auth.email || sub` ->
  `X-Internal-Identity`). Fail-OPEN auf `OWNER_PROFILE` nur bei leerer Identitaet (localhost/stdio).
  `profile` ist GLOBAL (PK=email, keine RLS, kein `tenant_id` seit Owner-Removal P5).
- **TENANT-Achse (Scope/Kosten):** keyt auf SUB (`resolveTenant(idpSubject)`). Fail-CLOSED auf
  `TENANT_REJECT`. Traegt KYC, Nummer, Budget, Quota.

Bei einem typischen OIDC-JWT sind `email` und `sub` VERSCHIEDENE Werte. Die **Aktivierung kennt
nur `tenantId`**, das Profil keyt auf `email`. Die einzige Bruecke ist die **`account`-Tabelle**
(`sub` PK, `email` NOT NULL, `tenant_id` NOT NULL FK, NICHT unique, RLS-exempt) — und sie existiert
NUR im pg-Backend. Eine Reverse-Query `accountByTenant(tenantId) -> email/sub` fehlt heute.

**Zwei getrennte Verbrauchs-Quellen (nie vermischen):**

- `usageFor(s,tenantId)` = EUR-Live-Bucket `{calls,costEur}` -> `budgetExceeded` /
  `reserveExceedsBudget`. IMMER reconciled, payment-UNABHAENGIG.
- `s.usageEvents` = Ganzzahl-Ledger -> `voiceMinutesUsedSince` / `quotaView` / Stripe-Meter.
  Nur bei `PAYMENT_ENABLED` gefuellt, erst bei Call-Ende. Das Minuten-Gate lebt auf dieser Quelle
  und ist damit automatisch payment-abhaengig.

---

## 2. Neue Invarianten / Regeln

1. **Schnittmenge nie ersetzen.** `budgetExceeded`, `globalBudgetExceeded` und
   `reserveExceedsBudget` bleiben unangetastet. Das Minuten-Gate ist ein NEUES PARALLELES Glied
   (Regel 1, Schnittmenge). EUR-Achse und Minuten-Achse bleiben getrennte Zaehlungen.
2. **Fail-closed.** Profil nur fuer eine bekannte, verifizierte Identitaet setzen — fehlende/leere
   `account.email` ODER fehlender/unbekannter `planSlug` (`planProfileFor` ohne Mapping) -> SKIP,
   NIE ein Teil-/leeres Profil (`setProfile(email, undefined)`) schreiben. Minuten-Gate:
   kein Plan bei aktivem Subscriber -> blocken (nicht "kein Limit"); Periodenanker STRENG nach §5.4
   (persistierter `current_period_start` ODER aus `currentPeriodEnd` abgeleitet; voellig fehlend ->
   blocken), NIE `used=0`=volles Kontingent durch ein an `voiceMinutesUsedSince` durchgereichtes
   `undefined`. `quotaView` (fail-OPEN-Anzeige) wird NIE als Gate wiederverwendet. §5.2 und §5.4 sind
   bindende fail-closed Invarianten (NICHT mehr offen) — sie raten am Geld-Gate nicht mit.
3. **`PAYMENT_ENABLED` = byte-identisch.** Profil-Provisioning lebt AUSSCHLIESSLICH in
   `activatePaidTenant`/Subscribe-Handler (beide payment-gegated); das Minuten-Gate liegt selbst
   hinter `config.paymentEnabled`. Aus = kein neues Profil, kein Minuten-Block, byte-identisch.
4. **resolveProfile-Asymmetrie unantastbar.** Leere email -> `OWNER_PROFILE` bleibt; NIE auf
   nicht-leere (bekannte oder unbekannte) Identitaeten ausweiten — das waere Rechte-Eskalation.
5. **EINE Quelle.** Profil-Provisioning sitzt in `activatePaidTenant` (geteilt von Webhook UND
   direktem Pfad), nicht im Route-Layer (Webhook hat keine `req`-Identitaet). Profil keyt auf
   `account.email`, nicht `sub` (sonst verfehlt `place_call` den Eintrag).
6. **Tier-Profil traegt ALLE `PROFILE_FIELDS` explizit.** Der additive `setProfile`-Merge wirkt so
   bei Downgrade als Replace (kein stale Business-Recht nach Wechsel auf Starter).
7. **Harte Gates unberuehrt.** Denylist / Land / Stundenlimit / perTargetCap / Provider-Signatur /
   Offenlegung / Allowlist-Pfad-0 (tenantInactive) lockert ein Profil-/Plan-Recht NIE; es kann nur
   weiter einschraenken (`countryGateAllowed`/`userHourReached` sind Schnittmengen).
8. **Beide Backends + BASE_ENV.** json (`s.profiles`-Map, `usageEvents`-Array) UND pg (Tabellen,
   flush/hydrate, `deleteMissing`). Jede neue config-Var -> `test/helpers.js` BASE_ENV +
   `.env.example` mit neutralem fail-closed Default (test-base-env-drift).

---

## 3. Phasenplan (klein, phase-impl-lean-tauglich)

Zwei Straenge plus ein Abschluss-Schnitt. **GAP A (A1->A2->A3)** und **GAP B (B1a->B1b->B2->B3)**
beruehren weitgehend getrennte Dateien, ABER beide enden in `server.js` (Hotspot) UND B1a teilt
`subscribe.js`/`webhook.js` mit A2. **A4 (DEFAULT_PROFILE->0, §5.8)** ist der EINZIGE Schnitt, der
NICHT hinter `PAYMENT_ENABLED` liegt (DEFAULT gilt immer) und daher NICHT byte-identisch ist -> er
laeuft ZULETZT als go-live-Haertung, erst wenn A2/A3 jeden Zahler mit Profil versorgen. Empfehlung:
**A vor B**, strikt seriell, **keine parallelen Worktrees** (Hotspot `server.js`, `state-ops.js`,
`plans.js`, `subscribe.js`/`webhook.js`). Gesamtreihenfolge: **A1->A2->A3->B1a->B1b->B2->B3->A4**.
Abhaengigkeiten hart: A2<-A1; A3<-A2; B1b<-B1a; B2<-B1b; B3<-B1b; **A4<-A3 (+ einmaliger
planSlug-Reconcile, §5.8)**. B1 ist gesplittet (§5.4=persistieren -> ~8-10 Dateien inkl. Geld-Schema):
**B1a** = persistierter Periodenanker, **B1b** = reine Query.

### A1 — Plan->Rechte-Mapping (reines Datenmodul)

- **Ziel:** Ein deterministisches `planSlug -> Profil-Felder`-Mapping definieren, das ALLE
  `PROFILE_FIELDS` explizit traegt. Noch KEIN Konsument (nur Daten + Test).
- **Dateien/Seams:** `src/plans.js` (additiv, neben `PLAN_CATALOG`, z.B. `PLAN_PROFILE` +
  `planProfileFor(slug)`). Rechte sind SERVER-only -> **KEINE** Spiegelung nach
  `apps/web/src/lib/plans.js` (anders als `includedMinutes`).
- **Scope:** nur das Mapping + `findPlan`-naher Lookup. Werte je Plan = Owner-Entscheidung §5.1.
- **NICHT-Scope:** kein `setProfile`-Aufruf, kein Gate, keine Aktivierung.
- **Invarianten:** Mapping-Objekt traegt `allowedNumbers`, `allowedCountryCodes`, `unrestricted`,
  `allowCalendar`, `allowBooking`, `maxCallsPerHour` — JEDES Feld explizit (Regel 6). NIE
  `unrestricted=true` ohne Owner-Beschluss; NIE eigene `allowedNumbers` (Toll-Fraud-Flaeche).
- **Pre-Mortem:** Teilfeld-Mapping -> stiller DEFAULT-Rueckfall (A11). Gegenmittel: Test, der prueft,
  dass jedes Mapping ALLE `PROFILE_FIELDS` setzt. Drift Katalog<->Web bei versehentlicher Web-Kopie
  -> Test-Assert "Web spiegelt NUR `PLAN_CATALOG`, nicht das Rechte-Mapping".
- **Tests:** je Plan-Slug traegt das Mapping alle Whitelist-Keys; `sanitizeProfile(mapping)` ist
  verlustfrei (kein Key faellt raus).
- **Done:** `node --check src/plans.js`, `npm test` gruen, Mapping vollstaendig je Slug.

### A2 — Aktivierung provisioniert plan-basiertes Profil

- **Ziel:** `activatePaidTenant` setzt nach `setStatus(active)` das plan-abgeleitete Profil ueber
  `setProfile`, idempotent, fail-closed, EINE Quelle. Achsen-Bruecke (tenantId -> email) geloest.
- **Dateien/Seams:**
  - `src/billing/activation.js` — `setProfile`-Effekt einbauen; `planSlug` aus
    `store.tenantSubscription(tenant)` lesen (laeuft in BEIDEN Pfaden garantiert VOR Aktivierung,
    kein neues Argument noetig).
  - `src/web-auth.js` (`makeAccounts`) — NEUE pg-Query `accountByTenant(tenantId)`
    (`SELECT sub,email FROM account WHERE tenant_id=$1`, RLS-exempt). Als Seam injiziert
    (DIP-Muster wie `accounts`/`provision`).
  - `src/billing/webhook.js` + `src/self-service-routes.js` — beide Aufrufer; nach dem Umbau
    identische Wirkung verifizieren (Webhook ohne `req`-Identitaet setzt ueber `accountByTenant`
    dasselbe Profil wie der direkte Pfad).
  - `src/store/state-ops.js`/`defaults.js` — `setProfile`/`sanitizeProfile` unveraendert wiederverwenden.
- **Scope:** NUR der Provisioning-Schritt + die Bruecken-Query. Profil-Key = `account.email`
  (email-first, A7). Tier-Snapshot aus A1.
- **NICHT-Scope:** Backfill bestehender Subscriber (A3), Minuten (B*), Owner-Profil-Aenderung,
  Deaktivierungs-Reset (§5.9).
- **Invarianten:** Reihenfolge KYC -> Status -> provision unveraendert; `setProfile` als zusaetzlicher
  Effekt (idempotent, deterministischer Snapshot). Fehlender/mehrdeutiger Account ->
  `setProfile`-SKIP + audit, **OHNE** `activatePaidTenant` zu werfen (sonst brechen KYC/Status/
  provision; idempotenter Retry holt nach). EBENSO SKIP (kein Teilprofil) bei fehlendem/unbekanntem
  `planSlug` (`planProfileFor` liefert kein Mapping — Admin-Aktivierung ohne subscribe ODER
  Webhook-Reihenfolge; NIE `setProfile(email, undefined)`, symmetrisch zu B2 "kein Plan -> blocken")
  und bei leerer `account.email` (Lesepfad ignoriert sie -> stiller DEFAULT_PROFILE). Da das
  Tier-Profil ALLE `PROFILE_FIELDS` explizit traegt, ueberschreibt der additive Merge ein evtl. per
  Admin gesetztes `unrestricted=true`/eigene `allowedNumbers` deterministisch auf `false`/`[]`
  (Merge==Replace, kein stale Toll-Fraud-Bypass, Regel 6). SKIP-Faelle (z.B. Webhook vor
  Account-Anlage, `web-auth.js:393`) sind nachholbar: der naechste Aktivierungs-Trigger ODER der
  A3-Backfill holt das Profil nach (kein proaktiver Reconcile-on-login in dieser Kette).
  Nur email/Keys/Tenant loggen, nie Profil-Werte (PII).
  `PAYMENT_ENABLED=false` -> Pfad unerreichbar -> kein Profil (Regel 3).
- **Pre-Mortem:** (a) Einbau im Route-Layer statt `activation.js` -> Webhook-Pfad vergibt nie ein
  Profil (Risiko hoch). (b) Key auf `sub` statt `email` -> `place_call` verfehlt den Eintrag, stiller
  DEFAULT_PROFILE (Tests mit leerer email bleiben gruen = maskiert). (c) Race: Webhook vor
  Account-Anlage -> `accountByTenant` leer -> SKIP statt Wurf. (d) json-Backend hat keine `account`-
  Tabelle -> Verhalten definieren (§5.7): dort owner-only/no-op.
- **Tests (json + pglite):** nach `activatePaidTenant` traegt `s.profiles[account.email]` das
  Tier-Profil; Webhook-Pfad UND direkter Pfad identisch; fehlender Account -> SKIP ohne Wurf,
  Status/KYC trotzdem gesetzt; `PAYMENT_ENABLED=false` -> kein Profil. Falls neue config-Var ->
  BASE_ENV + `.env.example`.
- **Done:** `node --check`, beide Backends gruen, Achsen-Bruecke per Test belegt.

### A3 — Migration/Backfill Bestand + Owner-Profil

- **Ziel:** Bestehende aktive Subscriber (vor A2 aktiviert) nachtraeglich auf ihr Plan-Profil
  heben; Owner-Profil-Verhalten festschreiben.
- **Dateien/Seams:** neues idempotentes Script `scripts/backfill-plan-profiles.js` nach Muster
  `scripts/bootstrap-tenant.js` (ueber Store-Fassade, beide Backends, `await store.save()`,
  Dry-Run/Diff, nur email/Keys/Tenant-Count loggen). Nutzt `accountByTenant` (A2) + `planProfileFor`
  (A1) + `validIdentity`-Praezedenz (email-first, A7).
- **Scope:** NUR Backfill aktiver+CARD-Subscriber, idempotent. Owner-Tenant: ueber localhost-Pfad
  permissiv (kein gespeichertes Profil noetig) ODER explizites Owner-Profil je §5.5.
- **NICHT-Scope:** kein Schema-Diff, kein neuer Gate.
- **Invarianten:** zweiter Lauf = No-Op; ungueltige/mehrdeutige Daten (`account.tenant_id` nicht
  unique, >1 Account) -> ueberspringen + loggen, NICHT raten (fail-closed). NIE `unrestricted`/eigene
  `allowedNumbers` setzen; vollstaendiger Tier-Snapshot ueberschreibt aber auch ein bestehendes
  `unrestricted=true` auf `false` (Merge==Replace, kein stehengebliebener Bypass). Da das
  Allowlist-Gate Bestandskunden bereits ueber `tenantActiveSubscriber`
  durchlaesst, aendert der Backfill nur Drosselung/Booking — Block-Risiko nur, falls Plan-
  `maxCallsPerHour < heute` (DEFAULT=2). json ohne `account`-Tabelle -> Backfill = no-op (§5.7).
  **Enumerations-Quelle = `s.tenants`** (traegt `kyc_level`/`planSlug`/`currentPeriodEnd` ueber die
  volle `TENANT_COLUMNS`-Hydrierung), NICHT `listTenants()` (liefert nur id/status/createdAt). Filter:
  `status===ACTIVE && KYC_ORDER(kycLevel)>=CARD && planSlug vorhanden && tenantId!==BOOTSTRAP_TENANT_ID`
  (Owner haerte raus — Boot-KYC-Heal hebt ihn auf `id_verified>CARD`, er hat keinen Plan; identisch zur
  B2-Owner-Ausnahme). `planProfileFor` NIE mit `undefined`/`null` aufrufen — fehlender `planSlug`
  (Bestands-Abo ohne gespeicherten Slug, `webhook.js:171` selektiver Patch) -> ueberspringen + loggen.
  **planSlug-Reconcile:** ein einmaliger `planSlug`-Reconcile aus der Stripe-Subscription als
  Teil/Vorlauf des Backfills, sonst bleiben slug-lose Bestandskunden still auf DEFAULT_PROFILE (A3)
  bzw. werden von B2 gesperrt.
- **Pre-Mortem:** (a) zu grosszuegiges Profil (unrestricted) -> Toll-Fraud. (b) Backfill-Key
  weicht vom Laufzeit-Lookup ab (sub statt email) -> stiller DEFAULT_PROFILE. (c) Profil-Werte ins
  Audit -> PII-Leak.
- **Tests:** Dry-Run-Diff korrekt; idempotenz (2. Lauf 0 Aenderungen); mehrdeutiger Tenant
  uebersprungen; pg-Round-Trip `hydrate->flush->hydrate` haelt den Key (A12); Owner/Bootstrap
  (KYC geheilt, kein Plan) wird NICHT gebackfillt; aktiver Tenant ohne `planSlug` uebersprungen +
  geloggt; email-Key mit vorbestehendem `unrestricted=true` -> nach Backfill `false` + `allowedNumbers=[]`.
- **Done:** Script idempotent + fail-closed, Dry-Run zeigt erwarteten Diff, beide Backends gruen.

### B1 — Per-Tenant Monats-Minuten + Reset-Fenster (gesplittet: B1a Periodenanker, B1b reine Query)

- **Ziel:** Eine fail-closed Funktion, die verbrauchte Minuten im aktuellen Abrechnungsfenster
  gegen `includedMinutes` prueft — getrennt von `quotaView` (Anzeige).
- **Dateien/Seams:** `src/store/state-ops.js` — neue reine Query neben `voiceMinutesUsedSince`,
  z.B. `planMinutesExceeded(s, tenantId, { includedMinutes, periodStartIso })` (`>=`), analog
  `budgetExceeded` (kein IO, kein `usageFor`-Bezug). Plan-Aufloesung (`findPlan`) und Periodenanker
  reicht der Aufrufer herein (state-ops bleibt katalog-/zeit-frei). Fassade `src/store.js` +
  `json.js` + `pg.js` durchreichen (KEINE neue SQL — `voiceMinutesUsedSince` existiert in beiden).
  Periodenanker = Owner-Entscheidung §5.4 (`current_period_start` persistieren ODER
  `periodStartIso`-Vereinfachung).
- **Scope:** NUR die Query (+ ggf. persistierter Periodenanker). Kein Gate-Einbau.
- **NICHT-Scope:** Outbound/Inbound-Verdrahtung (B2), Anzeige (B3).
- **Invarianten:** reine Query, keine Mutation, keine Achsen-Vermischung mit `usageFor`. Liegt
  semantisch auf der Minuten-Quelle (B4). **Query-Vertrag fail-closed (§5.4):** leerer/fehlender
  `periodStartIso` ODER fehlende `includedMinutes`/Plan => `exceeded=true`; NIE `undefined` an
  `voiceMinutesUsedSince` durchreichen (sonst stilles `used=0`). Der Aufrufer (B2) leitet bei NULL
  `current_period_start` + vorhandenem `currentPeriodEnd` den Anker aus `currentPeriodEnd` ab
  (Bestands-Fallback) — die Query bekommt dann einen gueltigen Anker und blockt NICHT.
  **Split-Bedingung (§5.4 = persistieren):** der Schema-/Persistenz-Anker
  (`current_period_start` additiv NULLABLE durch `src/db/schema.sql` + json + `pg.js rowToTenant`/
  `flushTenant` + `setTenantSubscription` + `subscribe.js` + `webhook.js`, ~8-10 Dateien,
  abrechnungsrelevant) wird als EIGENE Mikro-Phase **B1a** abgespalten; die reine
  `planMinutesExceeded`-Query ist **B1b**. `subscribe.js`/`webhook.js` teilt B1a mit A2 — durch
  "A komplett vor B" kollisionsfrei, aber explizit als geteilter Hotspot vermerken. Neue
  config-Var/Spalte -> BASE_ENV + `.env.example`, fail-closed Default.
- **Pre-Mortem:** (a) `periodStartIso`-Monatsueberlauf als Gate (B6) -> Abrechnungsfehler bei Geld.
  (b) `usageFor.costEur` statt `voiceMinutesUsedSince` -> Doppelzaehlung. (c) `currentPeriodEnd=null`
  -> used=0 -> unbegrenzt (B7); Verhalten per §5.4.
- **Tests (json + pglite):** Query liefert exceeded bei used>=included, sonst false;
  EUR-Gate und Minuten-Gate unabhaengig ausloesbar (kein Doppelzaehlen); Reset-Fenster korrekt;
  `PAYMENT_ENABLED=false` -> Ledger leer -> nie exceeded (byte-identisch).
- **Done:** Query in Fassade + beiden Backends, fail-closed, Tests gruen.

### B2 — Quota-Gate vor Outbound (+ Inbound) + Erschoepfungs-Verhalten

- **Ziel:** Das Minuten-Gate als NEUES PARALLELES Glied in die Gate-Kette einhaengen, ohne
  `budgetExceeded` zu ersetzen.
- **Dateien/Seams:** `src/server.js` — Outbound (`POST /api/calls`) neues Glied NEBEN
  `budgetExceeded` (`:1266`), Position direkt nach/neben dem Budget-Gate (gleiche Schnittmengen-
  Semantik), Status 402, `audit grund=minutes`. Aufruf: `store.tenantSubscription(tenantId)` ->
  `findPlan(planSlug)` -> `store.planMinutesExceeded(...)`. Inbound (`:848`) analog
  (`budgetExhaustedHangup`-Muster) NUR falls Owner Inbound-Block will (§5.2). Gate hinter
  `config.paymentEnabled`. Owner/Bootstrap-Tenant explizit ueber `tenantId===BOOTSTRAP_TENANT_ID`
  ausnehmen (kein Plan; `tenantActiveSubscriber` liefert fuer ihn wegen Boot-KYC-Heal TRUE).
- **Scope:** NUR das Gate-Einhaengen + Erschoepfungs-Verhalten (§5.2). Optional Worst-Case-
  Minuten-Reservierung (§5.3) analog `reserveExceedsBudget`.
- **NICHT-Scope:** Anzeige (B3), Query-Logik (B1), `quotaView`-Aenderung.
- **Invarianten (bindend):** `budgetExceeded || globalBudgetExceeded` bleibt unangetastet
  davor/daneben (Regel 1). (a) Minuten-Gate als SEPARATES `if` mit EIGENEM `audit grund=minutes`
  — NIE in den `budget`-`if` gefaltet. (b) Owner/Bootstrap-Ausnahme (`tenantId===BOOTSTRAP_TENANT_ID`)
  wird als ERSTE Bedingung VOR der "kein Plan -> blocken"-Regel evaluiert (sonst sperrt
  `findPlan(null)->null` den Owner) — NICHT ueber `tenantActiveSubscriber` (stale Kommentar
  `state-ops.js:715`). (c) Fail-closed: aktiver Subscriber mit fehlendem Plan ODER fehlendem
  Periodenanker -> blocken (B7) — das ist ABSICHT, KEIN Fail-Open-Misfix (ein Fixer darf das nicht
  "reparieren"); Bestands-Tenant mit NULL `current_period_start` aber gueltigem `currentPeriodEnd`
  bezieht den abgeleiteten Anker (§5.4-Fallback) und wird NICHT gesperrt. (d) §5.2: Inbound bleibt
  ungated; Inbound-Kostenschutz allein ueber `budgetExceeded` (`server.js:848`). Disclosure/Signatur/
  harte Gates unberuehrt. `PAYMENT_ENABLED=false` -> No-Op (Regel 3).
- **Pre-Mortem:** (a) Gate ersetzt versehentlich Budget -> Regel-1-Bruch. (b) Owner durch naiven
  "hat Plan?"-Check gesperrt -> Bootstrap-Ausnahme + Test. (c) in-flight Calls ungezaehlt (B5) ->
  Reserve (§5.3) oder akzeptiertes Restrisiko (durch `maxCallDurationS` gedeckelt).
- **Tests (json + pglite):** erschoepfter Subscriber -> Outbound 402 `grund=minutes`, Budget bleibt
  separat ausloesbar; Owner/Bootstrap NIE durch Minuten gesperrt; aktiver Subscriber mit fehlendem
  Plan/Anker -> 402 (absichtlich fail-closed); Bestands-Tenant mit NULL `current_period_start` +
  gueltigem `currentPeriodEnd` -> Outbound NICHT gesperrt (abgeleiteter Anker); `PAYMENT_ENABLED=false`
  -> byte-identisch; Inbound NICHT durch Minuten gegated (§5.2).
- **Done:** Gate parallel eingehaengt, Owner-Ausnahme belegt, beide Backends gruen.

### B3 — Quota im Self-Service/Dashboard sichtbar (Resthaertung)

- **Ziel:** Die vorhandene `quotaView`-Anzeige (existiert bereits `self-service-routes.js:73`)
  konsistent zum durchgesetzten Gate machen (gleicher Periodenanker), inklusive Rest-/Verbrauchs-
  Minuten und Erschoepfungs-Hinweis.
- **Dateien/Seams:** `src/billing/meter.js` (`quotaView`/`periodStartIso` an den persistierten
  Anker aus B1 angleichen, falls §5.4 = persistieren), `src/self-service-routes.js` (Anzeige bleibt
  an `config.selfServiceEnabled && config.multiTenant` gekoppelt, keyt auf `req.tenant.tenantId`).
- **Scope:** NUR Anzeige-Angleichung + ggf. Erschoepfungs-Flag. Keine Gate-Logik.
- **NICHT-Scope:** neue Routen, neue Auth, Owner-Dashboard-Umbau.
- **Invarianten:** read-only; keyt NIE auf email; gekoppelt an Flags (defense-in-depth).
  `PAYMENT_ENABLED=false`/Flags aus -> Anzeige verschwindet wie heute (byte-identisch). Anzeige nutzt
  DENSELBEN Bestands-Fallback wie B1/B2 (NULL `current_period_start` + `currentPeriodEnd` -> abgeleiteter
  Anker), damit Anzeige-Fenster == Gate-Fenster auch fuer Bestands-Tenants (sonst "Rest X Min, trotzdem
  geblockt").
- **Pre-Mortem:** Anzeige und Gate nutzen verschiedene Fenster -> Kunde sieht "Rest 5 Min", wird
  aber geblockt. Gegenmittel: gemeinsamer Periodenanker (B1).
- **Tests:** Anzeige-Wert = Gate-Eingabe (gleicher Anker); Flags aus -> kein Feld.
- **Done:** Anzeige konsistent zum Gate, Flags-aus byte-identisch, Tests gruen.

### A4 — DEFAULT_PROFILE auf 0 Calls/h (strikter Trenner, ZULETZT / go-live-Haertung)

- **Ziel:** `DEFAULT_PROFILE.maxCallsPerHour` von 2 auf **0** — ein nicht-provisionierter
  authentifizierter Nutzer macht gar kein Outbound; nur ein Plan-Profil schaltet frei (§5.8).
- **Dateien/Seams:** `src/store/defaults.js` (Konstante `DEFAULT_PROFILE_MAX_CALLS_PER_HOUR` 2 -> 0;
  benannt, kein Magic-Number). KEIN Gate-Code-Diff — `userHourReached` blockt `maxCallsPerHour=0`
  bereits hart (`server.js:614-619`: `limit=min(global,0)=0`, `count>=0` immer wahr; Kommentar `:630`).
- **Scope:** NUR der DEFAULT-Wert + Tests. `OWNER_PROFILE`/Plan-Profile/Gate-Logik unveraendert.
- **NICHT-Scope:** keine Gate-Aenderung, kein neuer Audit-Grund, kein Payment-Gate (DEFAULT gilt immer).
- **Invarianten:** **Dies ist der EINZIGE Schnitt der Kette, der NICHT hinter `PAYMENT_ENABLED` liegt
  und damit NICHT byte-identisch ist** (DEFAULT_PROFILE wirkt immer). Daher als LETZTER Schnitt, erst
  wenn A2/A3 + planSlug-Reconcile JEDEN Zahler mit Profil versorgt haben (Backfill-Beleg Pflicht).
  `maxCallsPerHour=0` MUSS hart blocken (Drift-Test). Owner unberuehrt (localhost -> `OWNER_PROFILE`,
  nie DEFAULT). Harte Gates/Disclosure/Signatur unberuehrt.
- **Pre-Mortem:** (a) A4 vor gruenem Backfill -> jeder zahlende Bestandskunde ohne provisioniertes
  Profil faellt von 2 auf 0 = Voll-Sperre (Verfuegbarkeits-Incident). Gegenmittel: harte Reihenfolge
  + Backfill-/planSlug-Reconcile-Beleg VOR Merge. (b) `0` als Falsy missverstanden -> Drift-Test
  beweist den harten Block (`userHourReached({maxCallsPerHour:0})` -> true bei 0 Calls). (c) ein
  Auth-Nicht-Owner-Flow, der heute legitim DEFAULT=2 nutzt -> vor Merge gegen die realen Caller pruefen
  (heute nur Owner + aktiver Subscriber).
- **Tests (json + pglite):** `userHourReached({maxCallsPerHour:0}, ...)` -> sofort gesperrt;
  provisionierter Subscriber (A2-Profil) telefoniert weiter; Owner (localhost/leere email) unberuehrt;
  Bestandstests, die DEFAULT=2 pinnen, bewusst auf 0 nachziehen + begruenden.
- **Done:** DEFAULT=0 blockt hart, Plan-/Owner-Pfade gruen, beide Backends gruen, Backfill-Beleg
  dokumentiert.

---

## 4. Verworfene Ansaetze

- **Plan-Rechte ins globale email-Profil ohne Tenant-Bindung (GAP A):** `account.email` hat KEIN
  UNIQUE; zwei Accounts mit derselben email teilen das globale Profil -> Plan-Hochstufung leakt
  tenant-uebergreifend. Verworfen zugunsten der `account`-Bruecke + Owner-Entscheidung §5.6.
- **`setProfile` im Route-Layer mit `req.tenant.email` (statt `activation.js`):** deckt den
  Webhook-Pfad NICHT ab (keine `req`-Identitaet) -> Tenant, der nur per Webhook aktiviert, bleibt
  auf DEFAULT_PROFILE. Verworfen (Regel 5).
- **Profil auf `sub` keyen:** `place_call` keyt email-first -> Eintrag wird verfehlt, stiller
  DEFAULT_PROFILE. Verworfen (A7).
- **`quotaView` direkt als Gate wiederverwenden:** drei fail-OPEN-Stellen (kein Plan/keine
  Periode/Ledger erst bei Call-Ende, B7) — als Gate toedlich. Verworfen zugunsten eigener
  fail-closed Query (B1).
- **Minuten-Gate auf `usageFor.costEur`:** Achsen-Vermischung/Doppelzaehlung mit der EUR-Achse.
  Verworfen (B4).
- **`periodStartIso = currentPeriodEnd - 1 Monat` als Gate-Fenster:** Monatsletzten-Ueberlauf
  verschiebt das Fenster um Tage -> Abrechnungsfehler. Nur als Anzeige toleriert; fuer das Gate
  persistierter `current_period_start` empfohlen (§5.4).
- **DEFAULT_PROFILE generischer "Plan-Loader" / pro Workspace variabel:** Schema ist global-by-email
  (kein `tenant_id` mehr seit P5) — pro-Workspace strukturell nicht abbildbar ohne Schema-
  Ruecktrieb. Verworfen, solange §5.6 nicht anders entscheidet.

---

## 5. Owner-Entscheidungen (ENTSCHIEDEN, 2026-06-29)

> Alle Punkte entschieden. §5.2 und §5.4 sind bindende fail-closed Invarianten (ein Geld-Gate darf
> nicht raten). Diese Entscheidungen sind VOR dem ersten Phasenlauf bindend.

1. **Rechte je Plan: `starter` und `business` tragen IDENTISCHE Rechte. ENTSCHIEDEN.**
   `allowCalendar=false`, `allowBooking=false` (Funktion bewusst verworfen — "ist eh Quatsch"),
   `unrestricted=false`, `allowedNumbers=[]`, `maxCallsPerHour=null` (= nur globaler Plattform-Cap
   `MAX_CALLS_PER_HOUR`; Minuten-Quota + Budget sind die echten Deckel). Die Plaene unterscheiden sich
   AUSSCHLIESSLICH in `includedMinutes` (`starter` 30, `business` 120 — Katalog-Wert, durchgesetzt via
   GAP B). Das Plan-Profil hat damit nur EINE Funktion: Outbound ueberhaupt freischalten (paid) vs.
   sperren (DEFAULT=0, §5.8). `allowedCountryCodes` bleibt so restriktiv wie heute (KEIN neuer
   per-Profil-Freibrief; der aktive Subscriber erfuellt den Allowlist-Zweig bereits ueber
   `tenantActiveSubscriber`, der Land-Gate bleibt global = Schnittmenge). A1-Invariante: ein Test
   belegt, dass ein paid-Subscriber einen erlaubten Outbound platzieren kann UND DEFAULT(=0) nicht.

2. **Verhalten bei Minuten-Erschoepfung & Inbound vs Outbound. ENTSCHIEDEN (bindend, VOR B2):**
   nur Outbound blocken (402 `grund=minutes`); Inbound (`/voice`) wird durch Minuten NICHT gegated.
   Begruendung: Inbound (Nachrichten/Termine) ist der Kerndienst; Outbound (aktiv, kostenintensiv)
   wird gedeckelt. **Bindende Invariante:** der Inbound-Kostenschutz laeuft weiterhin ALLEIN ueber
   `budgetExceeded` (`server.js:848`, EUR-Budget) + `maxCallDurationS` — Minuten-Erschoepfung ist
   KEIN Inbound-Kostenstop. Overage (weiter, kostet extra) spaeter separat.

3. **Worst-Case-Reservierung: NEIN — harte Schwelle `used>=included`. ENTSCHIEDEN.** Ueberzug um
   max. eine Call-Laenge akzeptiert (durch `maxCallDurationS`/300s gedeckelt; EUR-`reserveExceedsBudget`
   begrenzt die Kosten parallel). KEINE Minuten-Vorab-Reservierung in B2.

4. **Monats-Reset / Periodenanker. ENTSCHIEDEN (bindend, fail-closed — ein Geld-Gate darf nicht
   raten; VOR B1):** `current_period_start` aus dem Stripe-Webhook persistieren (additive NULLABLE
   Tenant-Spalte, wie I8). Anker-Aufloesung (verantwortlich = der B2-Aufrufer, NICHT die Query):
   - persistierter `current_period_start` vorhanden -> das ist das Fenster.
   - `current_period_start` NULL, aber `currentPeriodEnd` vorhanden (Bestands-Abo vor B1 / Spalte
     noch nicht nachgezogen) -> Anker aus `currentPeriodEnd` ABLEITEN (Bestands-Fallback,
     `periodStartIso`-Logik), NICHT fail-closed-blocken. Verhindert die Massensperrung zahlender
     Bestandskunden beim Scharfschalten von `PAYMENT_ENABLED`.
   - WEDER persistierter Anker NOCH `currentPeriodEnd` (frisches Abo, Webhook ausstehend) ->
     **fail-closed** (kein Outbound), bis der Webhook die Periode nachzieht (EUR-Schnittmenge
     begrenzt parallel).
   - Die Query `planMinutesExceeded` selbst ist fail-closed: leerer/fehlender `periodStartIso`
     ODER fehlende `includedMinutes`/Plan => `exceeded=true`. NIE `undefined` an
     `voiceMinutesUsedSince` durchreichen (sonst stilles `used=0` = volles Kontingent).
   - Die frueher hier gelistete **fail-open**-Option (volles Kontingent bei null-Periode) ist
     GESTRICHEN (kollidierte mit Regel 2). Optional einmaliger Migrations-Backfill von
     `current_period_start` aus `stripeCurrentPeriodEnd` statt Laufzeit-Ableitung.

5. **Owner nur lokal/MCP. ENTSCHIEDEN.** Der Owner telefoniert Outbound ausschliesslich ueber
   Claude/MCP + lokales Dashboard (leere Identitaet -> `OWNER_PROFILE`, `maxCallsPerHour=null`). Der
   Bootstrap-Tenant wird vom Minuten-Gate per `tenantId===BOOTSTRAP_TENANT_ID` ausgenommen. KEIN
   `OWNER_IDP_SUBJECT`, KEINE remote-OAuth-Owner-Outbound (bewusst) — damit ist der Owner NIE auf
   DEFAULT_PROFILE (auch nicht nach A4). Remote-Owner-Outbound waere eine eigene Folge-Phase
   (`OWNER_IDP_SUBJECT` + permissives Owner-Profil).

6. **Profil-Achse bleibt global-by-email (B2C 1:1). ENTSCHIEDEN.** Harte Annahme: genau 1
   Account/Tenant. Backfill ueberspringt mehrdeutige Tenants (>1 Account) fail-closed. Re-Key auf
   `account.sub` / B2B-Bindung (oder Schema-Ruecktrieb `tenant_id`) ist Folgearbeit (§6), erst wenn
   echtes B2B real wird.

7. **json-Backend = No-Op; Prod laeuft pg. ENTSCHIEDEN.** A2/A3/A4 sind im json-Store No-Op (keine
   `account`-Tabelle; Owner-Pfad ueber leere email permissiv). VOR Merge belegen, dass Prod=pg
   (`STORE_BACKEND=pg`); Test, dass json-Aktivierung/Backfill nicht wirft.

8. **DEFAULT_PROFILE -> `maxCallsPerHour=0`. ENTSCHIEDEN (eigene Phase A4 NACH A3).** Nur ein Plan
   vergibt das Outbound-Recht; ein nicht-provisionierter authentifizierter Nutzer = gar kein Outbound.
   `maxCallsPerHour=0` blockt HART (`server.js:614-619`: `limit=min(global,0)=0`, `count>=0` immer
   wahr; Kommentar `:630` bestaetigt). `allowCalendar`/`allowBooking` bleiben `false` (heute schon).
   **Sequenz-Pflicht:** A4 laeuft NACH A2+A3+planSlug-Reconcile — sonst Total-Sperre zahlender
   Bestandskunden (mit 0 statt heute 2 gibt es keine Drossel-Restkulanz mehr). Ein Provisioning-
   Verfehler wird damit zur Voll-Sperre (gewollt fail-closed: lieber sperren als leaken).

9. **Re-Aktivierung gewinnt. ENTSCHIEDEN.** Downgrade = Replace (voller Tier-Snapshot setzt alle
   Felder, A10/Regel 6 — kein stale Recht). Ein Admin-`POST /api/profiles`-Override wird von einer
   Re-Aktivierung UEBERSCHRIEBEN (kein automatisches Ueberleben; ein Admin-Sonderprofil muss nach
   einer Re-Aktivierung neu gesetzt werden). SUSPEND/DELETED laesst das Profil STEHEN (Status-Gate
   `tenantInactive` ist autoritativ, stales Profil auf gesperrtem Tenant harmlos); ein defensiver
   Profil-Reset bei SUSPEND ist optionale spaetere Mini-Phase, NICHT in dieser Kette.

---

## 6. Restrisiken / Folge-Arbeit (NICHT in dieser Kette)

- **B2B-Mehrfach-Account je Tenant:** `account.tenant_id` ist NICHT unique. Sobald ein Tenant mehrere
  Accounts hat, ist die global-by-email-Profil-Vergabe mehrdeutig (§5.6). Heute B2C-1:1; Fix =
  per-account-Profil (sub-Key) + `account.email` UNIQUE oder Schema-Ruecktrieb. Eigene Phase.
- **IdP-email-Wechsel:** Kunde aendert email beim IdP -> `resolveProfile(neue_email)` miss -> stiller
  DEFAULT_PROFILE, waehrend die Tenant-Achse (sub-stabil) weiter aufloest. Entitlements langfristig an
  die stabile Achse binden.
- **in-flight/parallele Calls:** Ledger erst bei Call-Ende gefuellt (B5). Viele gleichzeitige Calls
  koennen das Kontingent ueberziehen, bevor das erste `finishCall` zaehlt. EUR-`reserveExceedsBudget`
  deckt das teilweise; eine echte Minuten-Reserve (§5.3) oder Inflight-Zaehler ist Folgearbeit.
- **`current_period_start` Webhook-Persistenz:** falls §5.4 = persistieren, ist das ein eigener,
  abrechnungsrelevanter Datenpfad (Stripe `current_period_start` -> Tenant-Spalte) — sauber testen.
- **Stale Kommentar `state-ops.js:715-717`** behauptet `kycReached`/`tenantActiveSubscriber` liefere
  fuer den Owner `true` wegen null-Toleranz; der Code liefert FALSE bei null, der Owner passiert nur
  via `seedBootstrapKyc`. Beim Beruehren der Datei korrigieren, damit kein Fixer den Boot-Heal-Pfad
  entfernt.
- **Overage-Abrechnung** (Minuten ueber Plan kostenpflichtig weiter) ist bewusst ausgenommen — eigener
  Entwurf (Stripe-Meter existiert, aber Preis/SCA/Limit-Politik fehlen).
- **Systemische Wurzel Bestands-Periodenanker (B1a/B1b/B2/B3 + meter):** die neue NULLABLE
  `current_period_start`-Spalte hat fuer ALLE Bestands-Subscriber keinen Wert. EINE Korrektur loest
  alle B-Phasen: NULL-Anker + vorhandenes `currentPeriodEnd` -> abgeleitetes Fenster (Bestand); echtes
  fail-closed nur bei voellig fehlender Periode (frisches Abo). Ohne diesen Fallback wuerden zahlende
  Bestandskunden beim Scharfschalten bis zu einen Monat (bis zum naechsten Webhook) gesperrt — kein
  Safety-Loch (Ueber-Block), aber Verfuegbarkeits-Regress. Heute durch `PAYMENT_ENABLED=false`
  byte-identisch verdeckt; die B-Korrekturen + A3-Owner/planSlug-Guards muessen VOR `PAYMENT_ENABLED=true`
  gruen sein.
- **planSlug fehlt auf aktiven Bestands-Tenants** (`webhook.js:171` selektiver Patch setzt `planSlug`
  nur, falls im Event geliefert; `activatePaidTenant` laeuft trotzdem). Trifft A3 (SKIP -> stiller
  DEFAULT_PROFILE) UND B2 ("kein Plan -> blocken" sperrt Bestand). Ein einmaliger planSlug-Reconcile
  (aus der Stripe-Subscription) als Teil/Vorlauf von A3 heilt beide Seiten.
- **json=Prod-Annahme (§5.7):** A2/A3 sind im json-Store No-Op (keine `account`-Tabelle). Liefe IRGEND
  ein zahlender Tenant produktiv auf json, bliebe er still auf DEFAULT_PROFILE trotz Bezahlung. VOR
  Merge belegen, dass Prod=pg (json = Owner/Dev-Store) — sonst ist GAP A im json-Pfad ungeschlossen.
