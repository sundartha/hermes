# T4 — `server.js` Routen-Dekomposition (`/api/*`)

> Strategie-Dokument (PURE ANALYSE, kein Code). Verifiziert am Code-Stand von
> `src/server.js` (1145 LOC) am 2026-06-20. Liefert Ziel, Architektur-Skizze,
> Routen-Inventur, Abhaengigkeits-Matrix, Pre-Mortem und einen phasierten,
> einzeln testbaren Plan. Kein finaler Diff — der Boss gibt die Phasen frei.

---

## 1. Kontext & Problem (am Code verifiziert)

`src/server.js` ist die God-Datei des Gateways (1145 LOC). Sie buendelt vier
Verantwortungen in einer Datei:

1. **Boot/Wiring** — express-App, trust-proxy, Queue-Singleton, Rate-Limit, Body-
   Limit, Basic-Auth, static, guardedBoot-Web-Login-Block, retention, `app.listen`.
2. **`/voice/*`-Webhooks** — `incoming`, `turn`, `outbound`, `status` (NICHT in Scope).
3. **`/api/*`-REST** — Dashboard + MCP-Tools (Scope dieser Aufgabe).
4. **`/mcp`** — Streamable-HTTP-MCP (NICHT in Scope, bleibt inline).

Bereits extrahiert (Vorbilder, DI-Factory-Muster `makeXxxRoutes({...})`):

| Gruppe                            | Modul                                                  | Mount in server.js      |
| --------------------------------- | ------------------------------------------------------ | ----------------------- |
| `/api/profiles` (GET/POST/DELETE) | `src/routes/api-profiles.js` (`makeProfileRoutes`)     | Z. 927                  |
| `/api/self-service/*`             | `src/self-service-routes.js` (`makeSelfServiceRoutes`) | Z. 200 (im guardedBoot) |
| Admin (`/admin/*`)                | `src/web-auth.js` (`makeAdminRoutes`)                  | Z. 189 (im guardedBoot) |
| Web-Login (`/auth/*`)             | `src/web-auth.js` (`makeWebAuthRoutes`)                | Z. 161 (im guardedBoot) |

**Problem:** Die verbleibenden `/api/*`-Handler haengen direkt an `app` und teilen
sich **Modul-Scope-Helfer** (Tenant-Aufloesung, Nummern-Gates, Validierung,
Call-Lifecycle), von denen einige auch von `/voice/*` und `/mcp` benutzt werden.
Eine Extraktion ist deshalb NICHT „Block ausschneiden, einfuegen" — sie zwingt
zuerst eine saubere Naht fuer die geteilten Helfer.

### 1.1 Verbleibende `/api/*`-Routen in `server.js` (vollstaendig, verifiziert)

| #   | Methode + Pfad                      | Zeilen   | Auth                       | Mutiert                  | Risiko              |
| --- | ----------------------------------- | -------- | -------------------------- | ------------------------ | ------------------- |
| 1   | `GET  /api/portal/state`            | 175–183  | webAuthMw (im guardedBoot) | nein (read)              | mittel (Sonderfall) |
| 2   | `POST /api/calls`                   | 673–786  | Basic-Auth                 | **echte Calls + Kosten** | **HOCH**            |
| 3   | `POST /api/calls/:id/cancel`        | 789–812  | Basic-Auth                 | Call-Ende                | hoch                |
| 4   | `GET  /api/state`                   | 823–855  | Basic-Auth                 | nein (read)              | niedrig             |
| 5   | `GET  /api/calls/:id`               | 857–867  | Basic-Auth                 | nein (read)              | niedrig             |
| 6   | `GET  /api/tenant-data/export`      | 874–881  | Basic-Auth                 | nein (read)              | niedrig             |
| 7   | `POST /api/settings`                | 883–890  | Basic-Auth                 | Tenant-Settings          | niedrig             |
| 8   | `POST /api/action-items/:id/toggle` | 892–896  | Basic-Auth                 | Action-Item              | niedrig             |
| 9   | `POST /api/calendar`                | 898–919  | Basic-Auth                 | Termin                   | niedrig–mittel      |
| 10  | `POST /api/billing/flush-meters`    | 935–941  | Basic-Auth                 | Stripe-Meter             | mittel (Geld)       |
| 11  | `POST /api/onboard`                 | 952–1023 | Basic-Auth                 | Tenant + Nummer-Job      | mittel–hoch         |

`/api/profiles` (Z. 927) ist bereits extrahiert. `/mcp` (Z. 1062) ist kein `/api/*`
und bleibt inline.

---

## 2. Ziel & Akzeptanzkriterien

### Ziel

Die verbleibenden `/api/*`-Routen inkrementell aus `server.js` in kohaerente
Module unter `src/routes/` extrahieren — **verhaltens-erhaltend** (reine
Verschiebung, keine Logik-Aenderung), nach dem etablierten DI-Factory-Muster.
Endzustand: `server.js` enthaelt nur noch Boot/Wiring, `/voice/*`, `/mcp` und
eine Reihe `app.use(makeXxxRoutes({...}))`-Mounts.

### Akzeptanzkriterien (Definition of Done)

1. **Nach JEDER Phase**: `npm test` vollstaendig gruen (keine neue rote/uebersprungene Spec).
2. **Byte-identisches Verhalten**: gleiche Pfade, Status-Codes, Response-Shapes,
   Audit-Events und Log-Zeilen VOR und NACH jeder Phase. Beleg = die bestehenden
   dynamischen Tests (Server als Kindprozess), ergaenzt um eine Paritaets-Spec pro
   neuem Modul (Vorbild: `test/api-routes.test.js`, T-P4-08).
3. **Keine aufgeweichte Sicherung** (Regel 1/3): Basic-Auth-Abdeckung von `/api/*`,
   fail-closed Tenant-Reject, Nummern-Gates, KYC-Gate, Budget-Gate, Offenlegung,
   Max-Dauer-Timer bleiben Wort-fuer-Wort gleich, nur an neuem Ort.
4. **Eine Quelle pro Helfer** (G5): geteilte Helfer werden EINMAL extrahiert/injiziert,
   nie kopiert. Kein toter/auskommentierter Code zurueck in `server.js`.
5. **`node --check`** auf jeder geaenderten Datei + `clean-code-reviewer`-Verdikt
   SAUBER pro Phase.

### Nicht-Ziele (Scope-Grenze, Regel 6)

- `/voice/*`-Handler werden NICHT verschoben.
- `/mcp`-Handler bleibt inline.
- Keine API-Vertragsaenderung, keine neuen Endpunkte, keine Umbenennung von Pfaden.
- Boot/Wiring (Rate-Limit, Basic-Auth, static, guardedBoot, retention, listen) bleibt in `server.js`.

---

## 3. Architektur-Skizze

### 3.1 Zielstruktur `src/routes/`

```
src/routes/
  api-profiles.js     (bestand)         makeProfileRoutes({ store, audit })
  _tenant.js          (NEU, Phase 1)    makeTenantResolver({ store, config })
  _validation.js      (NEU, Phase 2)    E164, TEXT_LIMITS, invalidText  (reine Fns)
  api-read.js         (NEU, Phase 3)    makeReadRoutes({ store, config, audit, tenant })
  api-tenant.js       (NEU, Phase 4)    makeTenantWriteRoutes({ store, audit, tenant, ... })
  outbound-gates.js   (NEU, Phase 5)    makeOutboundGates({ store, config })  (oder src/telephony/)
  api-calls.js        (NEU, Phase 5/6)  makeCallRoutes({ store, config, audit, tenant, gates, armMaxDurationTimer, finishCall, outboundFrom })
  api-billing.js      (NEU, Phase 7)    makeBillingRoutes({ store, config, audit, billing })
  api-onboard.js      (NEU, Phase 8)    makeOnboardRoutes({ store, config, audit, queue, runDrain })
  api-portal.js       (NEU, optional 9) makePortalRoutes({ portalStore, webAuthMw })
```

### 3.2 Das geteilte-Helfer-Problem (load-bearing)

Die `/api`-Handler sind nicht autark. Eine Extraktion erzwingt zuerst, die
Modul-Scope-Helfer sauber zu schneiden. Drei Klassen (alle am Code verifiziert):

**(A) Tenant-/Identitaets-Aufloesung — von VIELEN `/api`-Routen UND `/mcp` genutzt:**

| Helfer             | Def.   | Aufrufer (verifiziert)                                                                                              |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `isLocalSocket`    | Z. 45  | rate-limit-MW (110), basic-auth-MW (216), `internalIdentity` (53)                                                   |
| `internalIdentity` | Z. 52  | `requestTenant` (81), `/api/calls` (683), `/api/calls/:id/cancel` (798), `/api/calendar` (903)                      |
| `requestTenant`    | Z. 78  | `requireTenant` (95), `/api/calls` (686), `cancel` (795), `/api/state` (825), `/api/calls/:id` (864), `/mcp` (1065) |
| `requireTenant`    | Z. 94  | `/api/tenant-data/export` (875), `/api/settings` (884), `/api/calendar` (899)                                       |
| `tenantOwnsCall`   | Z. 396 | `cancel` (795), `/api/calls/:id` (864)                                                                              |
| Konstanten         | —      | `OWNER_ID` (58), `ANON_IDENTITY` (61), `TENANT_REJECT` (66)                                                         |

→ **Loesung:** Factory `makeTenantResolver({ store, config })` in `src/routes/_tenant.js`,
die `{ isLocalSocket, internalIdentity, requestTenant, requireTenant, tenantOwnsCall }`

- die Konstanten liefert. `server.js` baut EINE Instanz im Modul-Scope, nutzt sie in
  der Middleware UND `/mcp`, und **injiziert dieselbe Instanz** in jede Route-Factory.
  Kein zweiter Resolver (G5/DIP), keine TDZ auf Modul-Helfer.
  `isLocalSocket` ist eine reine Funktion ohne Deps — kann auch separat exportiert und
  sowohl von der Middleware als auch vom Resolver importiert werden.

**(B) Cross-cutting mit `/voice` — bleiben in `server.js`, werden INJIZIERT:**

| Helfer                | Def.   | Voice-Aufrufer                       | API-Aufrufer                  |
| --------------------- | ------ | ------------------------------------ | ----------------------------- |
| `armMaxDurationTimer` | Z. 403 | `/voice/incoming` (453)              | `/api/calls` (772)            |
| `finishCall`          | Z. 588 | `/voice/status` (652), Bridge (1144) | `/api/calls/:id/cancel` (810) |

→ Diese DUERFEN nicht nach `src/routes/` wandern (Voice ist out of scope und braucht
sie weiter). Sie bleiben in `server.js` und werden als Dependency in `makeCallRoutes`
gereicht. Das haelt die Naht klein und vermeidet Doppel-Definition.

**(C) API-only Helfer — wandern MIT ihrer Route (keine Voice-Bindung):**

| Cluster        | Helfer                                                                                                                                                                                                                              | Nur-Aufrufer                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Validierung    | `E164` (272), `TEXT_LIMITS` (273), `invalidText` (276)                                                                                                                                                                              | `/api/calls` (714–717), `/api/calendar` (910) → **geteilt zwischen 2 API-Routen** |
| Nummern-Gates  | `EMERGENCY_SHORT_CODES`, `PREMIUM_PREFIXES`, `HOUR_MS`, `isDenied`, `matchesPrefix`, `countryGateAllowed`, `hourWindowStart`, `globalHourReached`, `userHourReached`, `allowlistError`, `kycGateError`, `numberGateError` (297–361) | ausschliesslich `/api/calls` (699, 706)                                           |
| Absendernummer | `outboundFrom` (663)                                                                                                                                                                                                                | ausschliesslich `/api/calls` (723)                                                |
| State-Slices   | `STATE_CALLS/ACTION_ITEMS/CALENDAR/NOTIFICATIONS` (816)                                                                                                                                                                             | ausschliesslich `/api/state`                                                      |
| Onboard        | `ONBOARD_REASON_STATUS` (950), `runProvisioningDrain` (1029), `recordNumberMonthMeter` (576)                                                                                                                                        | ausschliesslich `/api/onboard`-Pfad                                               |
| Billing/Meter  | `recordVoiceMinuteMeter` (559), `MS_PER_MINUTE` (552)                                                                                                                                                                               | `finishCall` (voice-seitig) → bleibt mit `finishCall`                             |

→ Validierung (C-Validierung) wird von ZWEI API-Routen geteilt → eigenes Mini-Modul
`_validation.js`, importiert von beiden. Nummern-Gates sind ein kohaerenter „Outbound-
Gate"-Block, der mit `/api/calls` wandert (eigene Datei `outbound-gates.js` als
Factory, weil `globalHourReached`/`userHourReached`/`kycGateError` `store`+`config`
brauchen).

### 3.3 DI-Vertrag pro Factory (Skizze, KEIN finaler Code)

```js
// server.js (nach voller Dekomposition, Skizze)
const tenant = makeTenantResolver({ store, config }); // EINE Instanz
// ... Middleware nutzt tenant.isLocalSocket / tenant.requestTenant ...
app.use(makeReadRoutes({ store, config, audit, tenant }));
app.use(makeTenantWriteRoutes({ store, audit, tenant }));
const gates = makeOutboundGates({ store, config });
app.use(
  makeCallRoutes({
    store,
    config,
    audit,
    tenant,
    gates,
    outboundFrom,
    armMaxDurationTimer,
    finishCall,
  }),
);
app.use(makeBillingRoutes({ store, config, audit, billing: stripeBilling }));
app.use(
  makeOnboardRoutes({
    store,
    config,
    audit,
    queue: provisioningQueue,
    runDrain: runProvisioningDrain,
  }),
);
```

Jede Factory liefert einen `express.Router()` mit denselben Pfaden/Handlern wie heute.
`server.js` mountet sie an derselben Reihenfolge-Position (Mounting-Order ist fuer
`/api/*` irrelevant — disjunkte Pfade — aber zur Sicherheit identische Reihenfolge halten).

---

## 4. Abhaengigkeits-Matrix (Import-Quellen je Modul)

Importe stammen aus heute schon existierenden Modulen (keine neuen Deps, Regel-Konvention):

| Modul               | store | config | audit (util) | views                                         | telephony/registry                   | sonstige                                                                              |
| ------------------- | ----- | ------ | ------------ | --------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `_tenant.js`        | ✓     | ✓      | —            | —                                             | —                                    | store/defaults (OWNER_TENANT_ID)                                                      |
| `_validation.js`    | —     | —      | —            | —                                             | —                                    | reine Konstanten/Fns                                                                  |
| `api-read.js`       | ✓     | ✓      | ✓            | publicCall, upcomingCalendar, activeNumberFor | —                                    | tenant (DI)                                                                           |
| `api-tenant.js`     | ✓     | —      | ✓            | —                                             | —                                    | tenant (DI), `_validation`                                                            |
| `outbound-gates.js` | ✓     | ✓      | —            | —                                             | —                                    | store/defaults (KYC_OUTBOUND_MIN, PROVIDER)                                           |
| `api-calls.js`      | ✓     | ✓      | ✓            | findActiveNumber                              | voiceControl, ownerNumberForProvider | tenant, gates, `_validation`, `outboundFrom`, `armMaxDurationTimer`+`finishCall` (DI) |
| `api-billing.js`    | ✓     | ✓      | ✓            | —                                             | —                                    | billing/stripe, billing/meter (flushMeters)                                           |
| `api-onboard.js`    | ✓     | ✓      | ✓            | —                                             | numberProvisioning                   | store/state-ops, worker/provisioning, queue (DI), validIdentity (api-profiles)        |
| `api-portal.js`     | —     | —      | —            | publicCall                                    | —                                    | portalStore + webAuthMw (DI, nur im guardedBoot)                                      |

---

## 5. Phasenplan

**Einstufung: NORMAL** (verhaltens-erhaltend, gut getestet, aber sicherheits-naher
Code). Strikt sequenziell von niedrigem zu hohem Risiko. **Jede Phase ist fuer sich
mit `npm test` verifizierbar.** Reihenfolge ist load-bearing: Phase 1 (Resolver) und
Phase 2 (Validierung) sind Voraussetzung fuer mehrere spaetere Phasen.

> **Hinweis zur Parallelisierbarkeit:** JEDE Phase editiert `server.js` (Block loeschen
>
> - Import + Mount-Zeile). Nach der Regel „zwei Phasen, die dieselbe Datei anfassen,
>   sind NICHT parallel" sind daher **alle Phasen untereinander `parallelisierbar: nein`**
>   (gemeinsame Datei `server.js`). Was sich parallel VORBEREITEN laesst, ist der reine
>   Modul-Entwurf der NEUEN Datei; die Integration (server.js-Edit + Test) muss serialisieren.

---

### Phase 0 — Vorbedingung: A1/A4/A6 abwarten + rebasen

- **Aktion:** keine Code-Aenderung. Warten, bis A1 (`/voice/status`-Provider-Parsing),
  A4 (Remote-OAuth, aendert `requestTenant`) und A6 (Rebrand, beruehrt Strings in ganz
  `server.js`) in `master` sind. Danach rebasen.
- **Begruendung:** Alle drei editieren `server.js` aktiv; A4 editiert exakt
  `requestTenant()` (siehe Phase-1-Kollision). Decomposition VOR ihrem Merge garantiert
  Konflikt. Diese Aufgabe ist explizit aufschiebbar.
- **Test:** `npm test` gruen auf dem frischen Rebase-Stand (Baseline).

### Phase 1 — Tenant-/Identitaets-Resolver extrahieren → `src/routes/_tenant.js`

- **Routen:** keine (reiner Helfer-Schnitt, enabling refactor).
- **Verschiebt:** `isLocalSocket`, `internalIdentity`, `requestTenant`, `requireTenant`,
  `tenantOwnsCall` + Konstanten `OWNER_ID`, `ANON_IDENTITY`, `TENANT_REJECT` in
  `makeTenantResolver({ store, config })`.
- **Dateien:** `src/routes/_tenant.js` (NEU), `src/server.js` (Helfer raus, Factory-
  Instanz rein, Middleware + `/mcp` + Inline-Routen auf `tenant.*` umstellen),
  `test/tenant-resolver-parity.test.js` (NEU).
- **Deps des Moduls:** `store`, `config` (DI), `OWNER_TENANT_ID` aus `store/defaults`.
- **parallelisierbar: nein** (server.js).
- **Test:** `npm test` — Regression v.a. `request-tenant.test.js`, `read-scope-tenant.test.js`,
  `i6-write-scope.test.js`, `security.test.js`, `resolve-tenant.test.js`, `tenant-budget-cap.test.js`.
- **Pre-Mortem:**
  - **R1.1 (kritisch, A4-Kollision):** A4 modifiziert `requestTenant()` und beschrieb
    selbst eine noetige Extraktion fuer den Test-Seam (Strategie-Doc
    `a4-remote-oauth-tenant-gap.md`, 2026-06-23 entfernt — **A4 ist gemergt**, Details in
    der Git-History). → **Vor Phase 1 pruefen, ob A4 den Resolver schon extrahiert hat.**
    Wenn ja: Phase 1 entfaellt teilweise — T4 KONSUMIERT die A4-Naht statt sie neu zu
    bauen. Wenn nein: Phase 1 muss A4s `req.tenant`-vor-`req.auth`-Logik 1:1 mit
    uebernehmen. **Niemals zwei Resolver.**
  - **R1.2:** `requestTenant` ist fail-closed (vorhandene-aber-unbekannte Identitaet
    → `TENANT_REJECT`, NIE Owner). Ein subtiler Fehler beim Verschieben oeffnet ein
    Tenant-Leck. → Paritaets-Test deckt alle drei Pfade ab (fehlend→Owner,
    unbekannt→Reject, bekannt→tenantId).
  - **R1.3:** `isLocalSocket` wird von Middleware UND Resolver genutzt — bei Extraktion
    nicht doppeln. → eine Quelle, beide importieren.

### Phase 2 — Validierungs-Helfer extrahieren → `src/routes/_validation.js`

- **Routen:** keine (enabling, von Phase 4 + Phase 5 gebraucht).
- **Verschiebt:** `E164`, `TEXT_LIMITS`, `invalidText` (reine Fns, keine Deps).
- **Dateien:** `src/routes/_validation.js` (NEU), `src/server.js` (raus), kein neuer
  Server-Test noetig (durch `api.test.js`/`number-gate.test.js` abgedeckt).
- **parallelisierbar: nein** (server.js).
- **Test:** `npm test` — `api.test.js`, `number-gate.test.js`, `i6-write-scope.test.js`.
- **Pre-Mortem:**
  - **R2.1:** `TEXT_LIMITS` deckt `objective/briefing/constraints/caller_name/title`
    ab — eine vergessene Konstante bricht still die Laengenpruefung (400→200). →
    vollstaendige Map mitnehmen, `i6-write-scope.test.js` belegt `title`-Pfad.

### Phase 3 — Read-/Export-Routen → `src/routes/api-read.js`

- **Routen:** `GET /api/state` (4), `GET /api/calls/:id` (5), `GET /api/tenant-data/export` (6).
- **Factory:** `makeReadRoutes({ store, config, audit, tenant })`.
- **Dateien:** `src/routes/api-read.js` (NEU), `src/server.js` (Bloecke raus + Mount),
  `test/api-read-parity.test.js` (NEU). Verschiebt auch `STATE_*`-Konstanten.
- **Deps:** `store`, `config`, `audit`, `tenant` (requestTenant/requireTenant/tenantOwnsCall),
  `publicCall`, `upcomingCalendar`, `activeNumberFor` aus `store/views`.
- **parallelisierbar: nein** (server.js); braucht Phase 1.
- **Test:** `npm test` — `api.test.js`, `read-scope-tenant.test.js`, `tenant-context.test.js`,
  `headers.test.js`, `security.test.js`, `media-token.test.js` (streamToken-Leak-Guard via publicCall).
- **Pre-Mortem:**
  - **R3.1:** `publicCall` muss `streamToken` weiter strippen (gleiche Invariante wie
    `/api/state`) — bei Direkt-`res.json(call)` leckt das WS-Token. → `media-token.test.js`
    bleibt gruen; Paritaets-Test asserted Abwesenheit von `streamToken`.
  - **R3.2:** Owner-PII (`ownerNumber`, `allowedNumbers`) nur in Owner-Sicht. Die
    `isOwnerView`-Verzweigung exakt mitnehmen.

### Phase 4 — Tenant-Write-Routen → `src/routes/api-tenant.js`

- **Routen:** `POST /api/settings` (7), `POST /api/action-items/:id/toggle` (8), `POST /api/calendar` (9).
- **Factory:** `makeTenantWriteRoutes({ store, audit, tenant })` (+ `_validation`).
- **Dateien:** `src/routes/api-tenant.js` (NEU), `src/server.js` (Bloecke raus + Mount),
  `test/api-tenant-parity.test.js` (NEU).
- **Deps:** `store`, `audit`, `tenant` (requireTenant, internalIdentity), `invalidText`
  (aus `_validation`), `OWNER_ID`.
- **parallelisierbar: nein** (server.js); braucht Phase 1 + 2.
- **Test:** `npm test` — `api.test.js`, `i6-write-scope.test.js`, `profiles.test.js`
  (booking-denied via Profil), `audit.test.js`, `tenant-settings-calendar-map.test.js`.
- **Pre-Mortem:**
  - **R4.1:** `/api/action-items/:id/toggle` hat HEUTE bewusst KEINEN Tenant-Guard
    (toggelt per id). Verhaltens-erhaltend heisst: KEINEN hinzufuegen. → nicht „mitfixen".
  - **R4.2:** `/api/calendar` haengt am `allowBooking`-Profil-Recht UND `requireTenant`
    (Reihenfolge: Tenant-Reject 403 VOR booking-denied 403). Reihenfolge exakt halten.

### Phase 5 — Outbound-Gates + Call-Routen → `src/routes/outbound-gates.js` + `src/routes/api-calls.js`

- **Routen:** `POST /api/calls` (2) **[sicherheitskritisch]**, `POST /api/calls/:id/cancel` (3).
- **Aufteilbar (empfohlen):** 5a = `cancel` (leichter: braucht `tenant.tenantOwnsCall`
  - `finishCall`-DI), 5b = `POST /api/calls` (die Geld-/Gate-Schwergewicht-Route).
- **Factory:** `makeOutboundGates({ store, config })` liefert `numberGateError`,
  `kycGateError`; `makeCallRoutes({ store, config, audit, tenant, gates, outboundFrom,
armMaxDurationTimer, finishCall })`.
- **Dateien:** `src/routes/outbound-gates.js` (NEU, der ganze 297–361-Block),
  `src/routes/api-calls.js` (NEU, + `outboundFrom`), `src/server.js` (Bloecke raus +
  `armMaxDurationTimer`/`finishCall` als DI rein, Mount), `test/api-calls-parity.test.js` (NEU).
- **Deps:** `tenant`, `gates`, `store`, `config`, `audit`, `voiceControl`,
  `ownerNumberForProvider`, `findActiveNumber`, `_validation.invalidText`, **injiziert:**
  `armMaxDurationTimer`, `finishCall` (bleiben in server.js wegen Voice-Bindung).
- **parallelisierbar: nein** (server.js); braucht Phase 1 + 2.
- **Test:** `npm test` — `api.test.js`, `number-gate.test.js`, `kyc-gate-outbound.test.js`,
  `kyc-gate.test.js`, `place-call-error.test.js`, `outbound-tenant.test.js`,
  `onboarding-outbound.test.js`, `audit.test.js`, `i6-write-scope.test.js`,
  `media-token.test.js`, `disclosure-outbound.test.js`.
- **Pre-Mortem (HOCH — Regel 1):**
  - **R5.1 (kritisch):** `/api/calls` ist die einzige Route, die echte Calls + Kosten
    ausloest. Die GESAMTE Gate-Kette in fester Reihenfolge — Tenant-Reject → KYC →
    Nummern-Gates (denylist→E.164→Land→global-h→user-h→allowlist) → Freitext →
    `outboundFrom` (Toll-Fraud-Riegel) → Budget-Schnittmenge → originate → Max-Dauer-
    Timer — muss BYTE-IDENTISCH bleiben. Eine vertauschte/verlorene Stufe = Kosten-
    Explosion oder ungewollter Anruf. → Paritaets-Test pro Gate (Status-Code + grund).
  - **R5.2:** `armMaxDurationTimer` per DI — wird NACH erfolgreichem originate gearmt
    (Z. 772, nur `voiceEngine !== "realtime"`). Reihenfolge + Guard exakt.
  - **R5.3:** `finishCall` (cancel-Pfad) ist idempotent (`_finished`-Flag) und wird von
    drei Stellen angestossen. Injektion darf die Identitaet der Instanz nicht
    duplizieren — EINE `finishCall`-Referenz aus server.js.
  - **R5.4:** Originate-Fehler darf NIE die rohe Provider-Message leaken (Z. 776–784).
    → `place-call-error.test.js` bleibt gruen.

### Phase 6 — Billing-Flush → `src/routes/api-billing.js`

- **Routen:** `POST /api/billing/flush-meters` (10).
- **Factory:** `makeBillingRoutes({ store, config, audit, billing })`.
- **Dateien:** `src/routes/api-billing.js` (NEU), `src/server.js` (raus + Mount),
  `test/api-billing-parity.test.js` (NEU — **Luecke: derzeit kein Test referenziert
  `/api/billing`**).
- **Deps:** `store`, `config` (paymentEnabled), `audit`, `flushMeters` (billing/meter),
  `stripeBilling` (billing/stripe).
- **parallelisierbar: nein** (server.js).
- **Test:** `npm test` + NEUE Parity-Spec (404 ohne PAYMENT_ENABLED; `{sent,failed}` mit).
- **Pre-Mortem:**
  - **R6.1:** Ohne `PAYMENT_ENABLED` → 404 (fail-closed). Diese Verzweigung exakt halten,
    sonst laeuft Metering still ungegated. Da heute KEIN dedizierter Test existiert,
    ist eine Parity-Spec hier Pflicht, nicht optional.

### Phase 7 — Onboarding → `src/routes/api-onboard.js`

- **Routen:** `POST /api/onboard` (11).
- **Factory:** `makeOnboardRoutes({ store, config, audit, queue, runDrain })`.
- **Dateien:** `src/routes/api-onboard.js` (NEU, + `ONBOARD_REASON_STATUS`),
  `src/server.js` (raus + Mount; `runProvisioningDrain` + `provisioningQueue` bleiben
  vorerst in server.js und werden injiziert), `test/api-onboard-parity.test.js` (NEU).
- **Deps:** `store`, `config`, `audit`, `validIdentity` (aus api-profiles), `registerTenant`,
  `requestNumber`, `recordProvisioningJob` (store/state-ops), **injiziert:** `queue`
  (Singleton), `runDrain` (fire-and-forget).
- **parallelisierbar: nein** (server.js).
- **Test:** `npm test` — `onboarding-route.test.js`, `onboarding-identity.test.js`,
  `onboard-persist-failure.test.js`, `onboarding-outbound.test.js`, `onboarding-service.test.js`.
- **Pre-Mortem:**
  - **R7.1:** `/api/onboard` haelt einen prozess-lokalen kritischen Abschnitt
    (`store.withStoreLock`) + 503-bei-Persist-Fehler + fire-and-forget-Drain. Der
    `void runProvisioningDrain()`-Anstoss NACH der Response muss erhalten bleiben. →
    `onboard-persist-failure.test.js` deckt den 503-Pfad.
  - **R7.2:** `runProvisioningDrain` referenziert den Modul-Scope-`provisioningQueue`-
    Singleton + `recordNumberMonthMeter`. Wandert der Drain spaeter ganz ins Modul,
    muss die Queue-Instanz EINE bleiben (sonst zwei Queues → verlorene Jobs). →
    vorerst Drain in server.js lassen, nur injizieren (kleinste Blast-Radius).

### Phase 8 — (optional) Portal-Read → `src/routes/api-portal.js`

- **Routen:** `GET /api/portal/state` (1).
- **Sonderfall:** lebt INNERHALB des `guardedBoot`-Web-Login-Blocks (Z. 175–183),
  haengt an `webAuthMw` (NICHT Basic-Auth) und an `portalStore`, das NUR dort
  konstruiert wird. Strukturell anders als der Rest.
- **Factory:** `makePortalRoutes({ portalStore, webAuthMw })`, gemountet im guardedBoot.
- **Dateien:** `src/routes/api-portal.js` (NEU), `src/server.js` (Inline-Route im
  guardedBoot durch Mount ersetzen), Test: `portal-route.test.js` (bestand).
- **parallelisierbar: nein** (server.js).
- **Test:** `npm test` — `portal-route.test.js`, `portal-rls-killer.test.js`.
- **Pre-Mortem:**
  - **R8.1:** Niedrigste Prioritaet — der Block ist klein und in einem konditionalen
    Boot-Pfad. Nur extrahieren, wenn Konsistenz gewuenscht ist; sonst akzeptierbar inline.
  - **R8.2:** `portalStore`/`webAuthMw` existieren nur bei `sessionSecret + pg`. Die
    Factory wird NUR im guardedBoot gemountet → bei Flag aus byte-identisch (Route 404).

---

## 6. Parallelisierungs-Matrix

| Phase               | Neue Datei | Editiert `server.js`? | Parallel zu anderen T4-Phasen? | Braucht vorher      |
| ------------------- | ---------- | --------------------- | ------------------------------ | ------------------- |
| 0 Warten            | —          | nein                  | —                              | A1, A4, A6 gemerged |
| 1 `_tenant`         | ✓          | **ja**                | nein                           | 0 (+ A4-Abgleich)   |
| 2 `_validation`     | ✓          | **ja**                | nein                           | 0                   |
| 3 `api-read`        | ✓          | **ja**                | nein                           | 1                   |
| 4 `api-tenant`      | ✓          | **ja**                | nein                           | 1, 2                |
| 5 `api-calls`+gates | ✓✓         | **ja**                | nein                           | 1, 2                |
| 6 `api-billing`     | ✓          | **ja**                | nein                           | 0                   |
| 7 `api-onboard`     | ✓          | **ja**                | nein                           | 0                   |
| 8 `api-portal`      | ✓          | **ja**                | nein                           | 0                   |

**Fazit:** Innerhalb von T4 ist NICHTS parallel — gemeinsame Datei `server.js`. Die
Phasen serialisieren in Reihenfolge 0→1→2→{3,4,5}→{6,7,8}. Die geschweiften Gruppen
haben keine inhaltliche Abhaengigkeit untereinander, kollidieren aber weiter ueber
`server.js`, also strikt nacheinander mergen.

**Parallel zu T4 (andere Tracks):** Solange T4 laeuft, sollte NICHTS anderes `server.js`
anfassen (genau die Lehre aus A1/A4/A6). T4 selbst sollte als zusammenhaengender Track
laufen, sobald A1/A4/A6 durch sind.

---

## 7. Pre-Mortem — global („Es ist schiefgegangen. Warum?")

1. **Tenant-Leck durch Resolver-Drift (R1.2).** Beim Verschieben von `requestTenant`
   wurde der fail-closed-Pfad (`TENANT_REJECT`) subtil veraendert → ein fremder Tenant
   sieht/cancelt fremde Calls. _Gegenmittel:_ Paritaets-Test fuer alle drei
   Identitaets-Pfade + `read-scope-tenant`/`i6-write-scope` als Gate.
2. **Doppelter Resolver / Doppelte Queue (R1.1, R7.2).** Zwei Quellen derselben Logik
   driften auseinander. _Gegenmittel:_ EINE Instanz im Modul-Scope, ueberall injiziert;
   `isLocalSocket`/`finishCall`/`provisioningQueue` nie kopieren.
3. **A4-Merge-Konflikt (R1.1).** T4 Phase 1 und A4 editieren dieselbe Funktion. Beide
   gleichzeitig → harter Konflikt oder schlimmer: stiller Logik-Verlust beim Aufloesen.
   _Gegenmittel:_ Phase 0 strikt einhalten; nach A4 pruefen, ob der Resolver schon
   extrahiert ist und ihn KONSUMIEREN.
4. **Kosten-Explosion durch Gate-Drift (R5.1).** Eine verlorene/umsortierte Gate-Stufe
   in `/api/calls` laesst gesperrte Nummern durch. _Gegenmittel:_ Phase 5 als eigene,
   spaete Phase mit Gate-fuer-Gate-Parity-Test; `clean-code-reviewer` mit Fokus Regel 1.
5. **Stilles Verhalten geaendert, Test merkt nichts.** Eine Route ohne dedizierten Test
   (`/api/billing/flush-meters`) wird verschoben und subtil veraendert. _Gegenmittel:_
   Phase 6 bringt die fehlende Parity-Spec ZUERST.
6. **streamToken-Leak (R3.1).** Read-Route serialisiert `call` direkt statt `publicCall`.
   _Gegenmittel:_ `media-token.test.js` + Parity-Assertion.
7. **„Mitgefixt" statt verschoben.** Beim Extrahieren wird eine vermeintliche
   Inkonsistenz (z.B. fehlender Tenant-Guard bei `action-items/toggle`) „verbessert" →
   Verhaltens-Aenderung, Scope-Bruch (Regel 6). _Gegenmittel:_ reine Verschiebung;
   Auffaelligkeiten dokumentieren, NICHT in dieser Aufgabe aendern.

---

## 8. Verifikation / DoD-Checkliste (pro Phase + final)

```
# Pro Phase
1. node --check src/server.js && node --check src/routes/<neu>.js
2. npm test                          -> 0 fail, 0 skip-neu (volle Suite)
3. neue <modul>-parity.test.js gruen (gleiche Pfade/Status/Shapes/Audit)
4. git diff: server.js NUR Block raus + Import + Mount; kein toter/auskommentierter Rest
5. clean-code-reviewer -> Verdikt SAUBER (Fokus: Regel 1 Safety-Gates, G5 eine Quelle)

# Final (nach letzter Phase)
6. grep: keine app.<verb>("/api/ mehr direkt in server.js (ausser /mcp, /voice)
7. server.js spuerbar kuerzer; /api/* vollstaendig in src/routes/*
8. Smoke: PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start + curl /healthz, /api/state
```

---

## 9. Zusammenfassung der load-bearing Entscheidungen

- **Erst die Naht, dann die Routen.** Phase 1 (`makeTenantResolver`) + Phase 2
  (`_validation`) sind enabling refactors ohne Routen-Bewegung — ohne sie waeren die
  spaeteren Phasen Copy-Paste-Duplikate der geteilten Helfer.
- **Voice-gebundene Helfer (`armMaxDurationTimer`, `finishCall`) bleiben in `server.js`
  und werden injiziert** — niemals nach `src/routes/` verschieben (Voice out of scope).
- **A4 zuerst.** A4 editiert `requestTenant` und beschreibt selbst eine Extraktion;
  T4 konsumiert die Naht statt sie zu duplizieren. Phase 0 ist Pflicht.
- **Innerhalb T4 ist nichts parallel** (alle teilen `server.js`); die Phasen
  serialisieren von niedrigem (read) zu hohem (`/api/calls`) Risiko.
- **Risiko-Reihenfolge:** read (3) → tenant-write (4) → calls/gates (5) →
  billing/onboard/portal (6–8). Die Geld-/Call-Route kommt bewusst NACH den
  ungefaehrlichen Lesepfaden, wenn das Muster schon belegt ist.

### Relevante Dateien

- `src/server.js` (Quelle, 1145 LOC) — alle Routen + Helfer verifiziert
- `src/routes/api-profiles.js`, `src/self-service-routes.js`, `src/web-auth.js` — Factory-Vorbilder
- `test/api-routes.test.js` (T-P4-08) — Parity-Test-Vorbild
- A4-Resolver-Extraktions-Seam (Synergie/Kollision) — Strategie-Doc `a4-remote-oauth-tenant-gap.md`
  2026-06-23 entfernt (A4 gemergt); siehe Git-History
- Tests je Routengruppe: `api.test.js`, `read-scope-tenant.test.js`, `number-gate.test.js`,
  `kyc-gate-outbound.test.js`, `place-call-error.test.js`, `i6-write-scope.test.js`,
  `onboarding-route.test.js`, `portal-route.test.js`, `media-token.test.js`
  </content>
  </invoke>
