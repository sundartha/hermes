# Strategie & Phasenplan: Multi-Tenant-Identitaet & Laufzeit (komplementaere zweite Schicht)

> Erstellt am 2026-06-15 von einem Agent-Team (verifizierte Recherche an 5 Bereichen
> + 3 unabhaengige Architektur-Vorschlaege + 3 adversariale Gutachten + 1 Synthese).
> Verbindliche Eckpfeiler: VOLLE Multi-Tenant-Identitaet (Richtung Produktion, "Millionen
> Nutzer"-Nordstern); Owner bleibt Default-Tenant; jede Phase einzeln lauffaehig und
> deterministisch pruefbar; Bestandssuite byte-identisch gruen (Owner-Default-Pfad
> unveraendert); Self-Service/Login bis zur Reife hinter fail-closed Feature-Flag;
> gefaehrlichster Einzelumbau frueh + entkoppelt; sicherheitskritische Phasen = harte
> Gates vor dem zweiten echten Tenant.
> Liefergegenstand: PLAN. Noch keine Implementierung.
> Dies ist die ZWEITE Schicht (Identitaet/Laufzeit), komplementaer zu
> `PLAN-MULTI-TENANT-TELNYX.md` (Daten-/Routing-/Provider-/Billing-Schicht, P0-P8b gemergt).
> Phasen heissen **I-Serie** (I0-I9), strikt getrennt von der P-Serie des Bestandsplans.

## TL;DR (Empfehlung in max. 6 Saetzen)

Die Daten-/Routing-Schicht (P0-P8b) ist tenant-aware, aber die **Identitaets-/Laufzeit-Schicht
ist faktisch single-tenant**: `call.tenantId` wird inbound korrekt aufgeloest (`findTenantByNumber`,
fail-closed) und an jeden Call gehaengt, aber danach NUR fuer `trackUsage` gelesen — Begruessung,
`systemPrompt`, `disclosureSentence`, `execTool` (Kalender) und `summarizeCall` ziehen ihre
Identitaet durchgaengig aus den globalen Singletons `config.ownerName` + `store.load().settings`
+ `store.getCalendar()` (das "Jonas"-Symptom, dokumentiert in `AUDIT-MULTI-TENANCY.md`). Wir ziehen
**genau EINEN Tenant-Kontext-Seam** ein (`tenantContext(s, tenantId) -> {tenantId, ownerName,
settings, calendar}`, IO-frei, mit gekapseltem Owner-Fallback, sodass `tenantContext(s, OWNER_TENANT_ID)`
byte-identisch die heutigen Singletons liefert) und stellen jede Identitaets-Quelle darauf um, statt
verstreuter Direkt-Zugriffe — der Seam laesst sich so nie wieder transplantieren (Struktur aus
Vorschlag A). `settings`/`calendar` werden vom flachen Singleton zu `tenantId`-gekeyten Maps
**exakt nach dem bereits getesteten `usage`-Map-Muster (P4)** — das ist der **gefaehrlichste
Einzelumbau** (json ist Prod, eine falsche Migration wirkt sofort cross-tenant-persistent) und
kommt frueh, allein, mit dreifachem Gate. Die zweite Aufloesungs-Achse (Auth-Identitaet
`idp_subject/email -> tenant` fuer REST/MCP/Outbound, **fail-closed, NIEMALS fail-open auf Owner wie
`resolveProfile`**) und alle tenant-gescopten Endpunkte (L1-L6 dicht) liegen hinter einem
**globalen `MULTI_TENANT`-Feature-Flag (Default aus)** — Flag aus = Owner byte-identisch, Flag an
erst nach allen dichten Gates, kein Zwischenfenster (Einsicht aus Vorschlag B/C). Self-Service-Login
+ getrenntes Tenant-Dashboard + pg-Entpinnung kommen zuletzt (groesste Angriffsflaeche, hinter Flag).

---

## Wie das Team zu diesem Plan kam

Drei unabhaengige Vorschlaege, drei Linsen:

- **A (Architektur-Purist):** ein IO-freier `tenantContext`-Seam als Domaenen-Objekt, eingezogen
  BEVOR ein Konsument umgestellt wird; zwei Aufloesungs-Achsen (Nummer->Tenant auf dem Call-Pfad,
  Auth-Identitaet->Tenant fuer API/MCP), die in DASSELBE Objekt muenden.
- **B (Inkrementell-Minimal):** kleinster Blast-Radius pro Schritt; "reines Verschieben vor jeder
  Verhaltensaenderung"; Self-Service/Login hinter fail-closed Flag ("ein Pfad, der AUS ist, kann
  nicht missbraucht werden"); usage-Map-Muster Entitaet fuer Entitaet gespiegelt.
- **C (Security-/Leck-/Scale-first):** Tenant-Scoping als querschnittliche fail-closed Invariante
  zuerst; der gefaehrlichste Umbau (Read-Scope L1/L3) frueh + entkoppelt + hinter reversiblem
  `MULTI_TENANT`-Schalter; Outbound-Toll-Fraud als Voraussetzung von Self-Service.

**Was das Kreuzverhoer (drei Gutachten) entschieden hat:**

1. **Basis = die sichere/kleine Konvergenz aus A + B + C.** Gutachten 1 (Architektur/Seam-Lens)
   waehlt **A** als Basis, weil A als EINZIGER den Identitaets-Seam als reines, byte-identisches
   Domaenen-Objekt in einer eigenen Phase einzieht, BEVOR ein Konsument umgestellt oder eine
   Datenform geaendert wird — verifiziert moeglich, weil `call.tenantId` in JEDER Identitaets-Funktion
   bereits liegt (`systemPrompt(call)`, `disclosureSentence(call)`, `execTool(call,...)`,
   `summarizeCall(call)`) und nur fuer `trackUsage` gelesen wird. Gutachten 2 (Shippability) und
   Gutachten 3 (Safety) waehlen beide **C**, weil C als EINZIGER ein `MULTI_TENANT`-Flag bereits ueber
   die Scope-Phasen legt (kein Zwischenfenster) und den gefaehrlichsten Umbau (Read-Scope) korrekt
   isoliert. **Aufloesung:** A's `tenantContext`-Seam + B/C's globales `MULTI_TENANT`-Flag + C's
   Risiko-Inversion (Scoping zuerst, fail-closed). Wo die Gutachten uneinig waren (A-Basis vs.
   C-Basis), wurde die **sicherere/kleinere Option** gewaehlt: A's I0 (reiner Helper, kein
   Konsument, keine Datenform) ist das kleinste pruefbare Inkrement; das gemeinsame fail-closed
   Flag ist die sicherste Scharfschaltung.

2. **Kopplungsfehler-Korrekturen (gegen alle drei):**
   - **C.I0 ist zu breit** — C buendelt den Aufloesungs-Helper MIT der gefaehrlichsten Daten-Migration
     (`settings`/`calendar` Singleton->Map inkl. `json.load()`-Migration) in eine Phase, obwohl C
     selbst das Read-Scoping als gefaehrlichste Aenderung deklariert. **Beschluss:** spalten — erst
     reiner Helper (**I0**, byte-identisch), dann Map-Shape getrennt (**I2**, mit Gate).
   - **B.I0 mischt Seam-Einfuehrung MIT Konsumenten-Umstellung** — verliert den reinen Helper-Parity-
     Beweis. **Beschluss:** A's saubere Trennung I0 (nur Helper) + I1 (Konsumenten).
   - **A.I5->I6->I7 strikt linear verkettet** (`dependsOn`-Kette) ist eine kuenstliche Kopplung —
     Read-, Write- und Outbound-Scope haengen alle nur an `requestTenant` (I4), nicht aneinander.
     **Beschluss:** I5/I6/I7 duerfen parallel/in beliebiger Reihenfolge nach I4 geshippt werden,
     SOLANGE alle drei vor dem 2. echten Tenant gruen + live sind (C's saubererer Graph).

3. **Reihenfolge des gefaehrlichsten Umbaus.** Der gefaehrlichste Einzelumbau ist zweigeteilt:
   (a) die `settings`/`calendar` Singleton->Map-Migration (**I2**, weil json Prod ist und ein
   Migrationsfehler sofort cross-tenant-persistent wirkt) und (b) der Tenant-Scope auf alle
   REST/MCP-Reads (**I5**, weil ein vergessener Lesepfad Transkripte fremder Tenants ueber MCP
   leakt). Beide kommen frueh, entkoppelt, mit hartem Gate; (b) zusaetzlich hinter dem Flag.

4. **fail-open-Inversion einstimmig als scharfste Safety-Frage markiert.** Verifiziert:
   `resolveProfileFrom(!email) -> { ...OWNER_PROFILE }` (`defaults.js:173`) ist fuer RECHTE bewusst
   fail-OPEN auf Owner. `resolveTenant` DARF diese Semantik NIEMALS erben: null/unbekannte Identitaet
   auf dem geschuetzten Lese-/Schreibpfad -> Reject, kein Default-Tenant. Nur fehlendes `req.auth`
   (localhost/stdio) bleibt Owner. Das ist die nicht-verhandelbare Invariante der Auth-Achse (**I4**).

5. **Faktenbasis am HEAD `80e0d94` verifiziert (selbst gegengeprueft):** die explizite Re-Export-Liste
   (28 Namen) in `store.js:49-78` (`registerTenant`/`requestNumber`/`findNumber` laufen NICHT ueber
   diese Fassade, sondern werden in `server.js:17` direkt aus `state-ops.js` importiert -> die Aussage
   "jede neue Fassaden-Store-Fn MUSS in die Liste" bleibt richtig); `systemPrompt` (Kopf `claude.js:17`,
   liest `store.load().settings`+`config.ownerName` :18/:19), `disclosureSentence` (Kopf `:57`,
   Namens-Zeile `call.callerName || config.ownerName` :58), `summarizeCall` (Kopf `:211`,
   `config.ownerName` :223), `execTool` (Kopf `:114`) lesen global; Greeting
   `s.greeting.replaceAll("{owner}", config.ownerName)` (`server.js:291`, im Realtime-Pfad VOR dem
   frueheren `return` :287 NICHT erreicht); Outbound hart `OWNER_TENANT_ID` (`budgetExceeded` :454,
   `ownerNumberForProvider` :465, `tenantId: OWNER_TENANT_ID` :477; `internalIdentity` wird :433-435
   NUR fuer `resolveProfile`/`requestedBy` aufgeloest, NICHT fuer den Tenant); Export gepinnt
   (`server.js:564`); `resolveProfileFrom(!email)->OWNER_PROFILE` (`defaults.js:173`); Disclosure-Pin
   "im Auftrag von Jonas" (`test/disclosure-outbound.test.js`); BASE_ENV traegt `OWNER_NAME: "Jonas"`
   (`test/helpers.js:27`).

---

## Zielarchitektur

### Der Tenant-Kontext-Seam (genau EINE Aufloesung, zwei Eintrittspunkte)

Es gibt **zwei** Quellen fuer den Tenant, beide bereits anti-spoof-gehaertet, und sie muenden in
**DASSELBE Domaenen-Objekt**:

- **Call-Pfad (Telefonie):** `call.tenantId` ist die Single Source of Truth. Inbound aufgeloest in
  `server.js POST /voice/incoming` via `store.findTenantByNumber(to)` (To liegt hinter der Signatur,
  Anti-Spoof; fail-closed, kein Default-Tenant). `createCall` haengt `call.tenantId` (fail-closed ->
  `OWNER_TENANT_ID`) an JEDEN Call. Dieser Wert liegt heute schon vor JEDEM Identitaets-Text vor,
  wird aber nur fuer `trackUsage` gelesen.
- **API/MCP-Pfad (Request):** die OAuth-Identitaet `req.auth.email || req.auth.sub` (`auth.js
  verifyOauth`) bzw. der localhost-only `X-Internal-Identity`-Header (`internalIdentity`, spoofing-sicher).

**Das Domaenen-Objekt:**
```
tenantContext(s, tenantId) -> { tenantId, ownerName, settings, calendar }   // IO-frei, in state-ops.js
```
- Owner-Fallback IM Kontext gekapselt: fehlt `tenant.ownerName` -> `config.ownerName`; fehlt
  `tenant.settings` -> `defaultSettings()`; fehlt `tenant.calendar` -> Owner-Bucket.
- **Invariante:** `tenantContext(s, OWNER_TENANT_ID)` ist bei einem Tenant byte-identisch zu den
  heutigen globalen Singletons -> Bestandssuite bleibt gruen, ohne pro Test einen Wert zu pinnen.
- **Code-Review-Gate (Anti-Lock-in):** Nach I1 darf KEIN Identitaets-Konsument `config.ownerName`,
  `store.load().settings` oder `store.getCalendar()` direkt lesen — nur ueber `tenantContext`.

Die zweite Achse ist ein **Geschwister** zu `resolveProfile`, NICHT dasselbe:
```
resolveTenant(s, idpSubjectOrEmail) -> tenantId | null   // null/unbekannt -> REJECT, NIE Owner
requestTenant(req) -> tenantId                            // server.js, parallel zu internalIdentity(req)
```
`requestTenant` nutzt denselben spoofing-sicheren localhost-only `X-Internal-Identity`-Kanal
MCP->REST. Beide Achsen konvergieren in `tenantContext`.

### Pro-Tenant-Entitaeten (das `usage`-Map-Muster gespiegelt)

`s.usage` ist seit P4 eine Map `{ [tenantId]: bucket }` (`emptyUsageMap()`, lazy `usageFor(s, tenantId)`,
`globalUsageTotals` summiert ueber `Object.values`). Das ist die **fertige, getestete Blaupause**:

- `s.settings`: flaches Objekt -> `{ [tenantId]: defaultSettings() }`; `settingsFor(s, tenantId)`
  analog `usageFor`; `defaultSettingsMap()` analog `emptyUsageMap()` (Owner vorbelegt).
- `s.calendar`: flache Liste -> `{ [tenantId]: [...] }`; `calendarFor(s, tenantId)`;
  `getCalendar`/`addCalendarEvent`/`findConflict` bekommen einen `tenantId`-Parameter.
- `ownerName`: Feld am Tenant-Record (`tenant.ownerName`), gesetzt bei `registerTenant`; KEINE neue
  Plattform-Env. Owner-Tenant behaelt `config.ownerName` als seinen `ownerName` (Default-Pfad
  unveraendert).
- `idp_subject`: optionales Tenant-Feld (`tenant.idpSubject`) + Lookup fuer `resolveTenant`.
- `profiles`: bleibt vorerst global keyed-by-email (Owner-only kollisionsfrei); pro-Tenant-profiles
  ist explizit spaeterer Scope (kein BDUF, siehe offene Entscheidung).

### Auth-Modell (zwei Achsen sauber getrennt, beide fail-closed)

- **Achse A = RECHTE (Bestand, unangetastet):** `resolveProfile` -> Allowlist/Land/Stundenlimit/Kalender.
- **Achse B = TENANT (neu):** `resolveTenant` -> tenant. fail-closed: null/unbekannt -> Reject.
- Per-Tenant-Login/Self-Service-Dashboard ist eine eigene, spaete Phase HINTER einem fail-closed
  Feature-Flag. Bis dahin bleibt die Basic-Auth (`admin:dashboardPassword`, `safeEqual`) bewusst
  ein PLATTFORM-ADMIN-Werkzeug; bei aktivem `MULTI_TENANT`-Flag weist das Admin-Dashboard
  Tenant-Daten entweder explizit als Plattform-Sicht aus oder filtert pro Tenant.

### pg-Entpinnung

Schema ist bereits voll multi-tenant (`tenant_id` + FORCE RLS + `tenant_isolation`-Policy auf 10
Tabellen, inkl. `settings`/`calendar_event`/`profile`). Reiner App-Code-Umbau, kein Schema-Neubau:
`init`/`hydrate`/`flush` von der `OWNER_TENANT_ID`-Pinnung loesen (per-Tenant-GUC-Schleife
`set_config('app.current_tenant', ...)` je Tenant). `tenant.ownerName`/`idpSubject` additiv via
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (forward-compat-Muster wie `number.status`). Da json heute
Prod ist (`config.storeBackend` Default `json`), ist das spaet + entkoppelt — kein Prod-Risiko, aber
Pflicht fuer den Nordstern.

### Self-Service-Settings + getrenntes Dashboard

Pro-Tenant-Login (`idpSubject -> tenant`), getrenntes Dashboard (Datenquelle = das tenant-gefilterte
`/api/state`), Self-Service-Settings-UI (schreibt `settingsFor(requestTenant)`). Self-Service darf
Safety-Gates nur **EINSCHRAENKEN** (Schnittmenge mit globalem Maximum), NIE den Disclosure-Satz
abschalten, NIE `allowBankData`/`allowPersonalData` ueber das globale Maximum heben. Alles hinter
einem eigenen, fail-closed Reife-Flag.

---

## Datenmodell-Aenderungen

### Was pro-Tenant wird

| Entitaet | Heute | Ziel | Muster |
|---|---|---|---|
| `settings` | flaches Singleton (`makeDefaultState`) | `{ [tenantId]: settings }` Map | analog `usage` (P4) |
| `calendar` | flache Liste | `{ [tenantId]: [events] }` Map | analog `usage` (P4) |
| `ownerName` | `config.ownerName` (Env, Default "Jonas") | `tenant.ownerName` (Record-Feld), Owner-Fallback Env | neues Feld |
| `idpSubject` | existiert nicht | `tenant.idpSubject` (optional) + Lookup | neues Feld |
| `profiles` | global keyed-by-email | bleibt global (vorerst, kein BDUF) | unveraendert |
| `usage`, `calls`, `numbers` | bereits Map/tenant-aware (P4/P3) | unveraendert | Vorbild |

### Store-Contract-Landmine (explizite Re-Export-Liste)

`store.js:49-78` bindet die Backend-Funktionen ueber eine **EXPLIZITE Destructuring-Liste** (`export const
{ load, save, ... deleteProfile } = backend`), weil ESM kein `export * from <Variable>` kann. Aktuell
sind es 28 Namen (`store.js:49-78`; `registerTenant`/`requestNumber`/`findNumber` laufen NICHT ueber
diese Fassade, sondern werden in `server.js:17` direkt aus `state-ops.js` importiert — die Anzahl rottet,
deshalb prueft der I0-Smoke zahlfrei). **JEDE neue Fassaden-Store-Funktion**
(`tenantContext`/`settingsFor`/`calendarFor`/`resolveTenant`) MUSS an VIER Stellen auftauchen:
`state-ops.js` (Impl) + `json.js` (Wrapper) + `pg.js` (`makePgStore`-Objekt) + die explizite Liste in
`store.js` — sonst still `undefined` zur Laufzeit, KEIN Compile-Fehler. Beide Backends sind duenne Wrapper um `state-ops.js` und MUESSEN exakt denselben
Funktionssatz exportieren (Contract-Parity); ein vergessener Wrapper = stiller Backend-Drift.

### json.load()-Migration (Pflicht in I2)

`s.settings`/`s.calendar` von Singleton auf Map heben braucht denselben defensiven Migrations-Pfad
wie `migrateUsageToMap` (`json.js`): altes Singleton -> Owner-Bucket. Sonst brechen bestehende
`data/store.json` (json ist Prod!) + `seedState()`-Tests (`test/helpers.js`). Die Migration lebt an
EINER Stelle (`json.load()`); `defaults.js` bleibt die einzige Quelle fuer beide Backends.

### schema/RLS

KEIN Schema-Change fuer `settings`/`calendar`/`profile` (PK/Spalten + FORCE RLS existieren bereits).
Nur additiv: `tenant.owner_name` + `tenant.idp_subject` via `ALTER TABLE ADD COLUMN IF NOT EXISTS`
(I8). Die `tenant_isolation`-Policy gegen `current_setting('app.current_tenant')` bleibt unveraendert.

---

## Laufzeit-Aufloesungs-Umbau (das "Jonas"-Symptom schliessen)

Alle vier Identitaets-Funktionen tragen `call` (und damit `call.tenantId`) bereits als Argument; sie
werden auf `tenantContext(s, call.tenantId)` umgestellt. `bridge.js` (Realtime) erbt das
**automatisch**, weil es dieselben `claude.js`-Funktionen ruft und keine eigene Identitaets-Logik hat.

| Stelle | Heute (global) | Ziel (tenant-aufgeloest) |
|---|---|---|
| Begruessung `server.js /voice/incoming` | `s.greeting.replaceAll("{owner}", config.ownerName)` | `tenantContext(s, call.tenantId)` -> `.settings.greeting` + `.ownerName` |
| `systemPrompt(call)` `claude.js` | `store.load().settings` + `config.ownerName` | `tenantContext(s, call.tenantId)` |
| `disclosureSentence(call)` `claude.js` | `call.callerName || config.ownerName` | `call.callerName || tenantContext(...).ownerName` (Owner-Fallback bleibt) |
| `execTool(call,...)` Kalender `claude.js` | `store.getCalendar()` / `findConflict` / `addCalendarEvent` (global) | `calendarFor(s, call.tenantId)` durchgereicht |
| `summarizeCall(call)` `claude.js` | `config.ownerName` (3x) + `store.load().settings` | `tenantContext(s, call.tenantId)` |

**Drei Lesepunkte derselben Settings (zwingend zusammen umstellen):** `systemPrompt(call)`,
`toolDefs()` UND die Tool-Gates `allowCalendar`/`allowBooking` lesen alle `store.load().settings`.
Wird einer vergessen, entsteht eine inkonsistente Persona (Prompt sagt Kalender erlaubt, Tool ist
nicht registriert — oder umgekehrt). `toolDefs()` nimmt dafuer einen `tenantId`/Settings-Parameter.

**Disclosure (Regel 2, unantastbar):** Der Satz bleibt fest verdrahtet als erster Satz in BEIDEN
Engines. NUR die Namensquelle folgt dem Tenant; der Owner-Fallback (`config.ownerName`) bleibt, damit
`test/disclosure-outbound.test.js` ("im Auftrag von Jonas") gruen bleibt. Kein Tenant-Setting darf
ihn abschalten.

---

## Auth/REST/MCP/Outbound Tenant-Achse: wie L1-L6 fail-closed geschlossen werden

Alles hinter dem globalen `MULTI_TENANT`-Flag (Default aus -> `requestTenant === OWNER_TENANT_ID` ->
byte-identisch; an -> strikt gescoped). `requestTenant(req)` wird an derselben Stelle berechnet wie
heute `resolveProfile(identity)` (im `/mcp`-Handler und in den `internalIdentity`-Konsumenten).

| # | Leck | Pfad (verifiziert) | Fix (fail-closed) | Phase |
|---|---|---|---|---|
| L1/L3 | Cross-Tenant-Read aller Calls/Transkripte | `/api/state` (alle Calls), `/api/calls/:id` Route-Def `server.js:552` (kein `tenantId`-Abgleich, `getCall` Body-Zeile `:553`) | `/api/state` filtert calls/actionItems/notifications (`tenantCallScope`)/calendar/settings/usage UND den `agent`-Block (`server.js:542-543`: `number: config.twilioNumber`, `owner: config.ownerName` -> Tenant-Werte); `/api/calls/:id`: `call.tenantId===requestTenant` sonst **404** (kein Existenz-Leak). `get_my_number`/`get_agent_status` lesen diese Werte ueber `GET /api/state` (`mcp-tools.js:107/160`: `s.agent.number`/`s.agent.owner`) und erben das Tenant-Scoping damit AUTOMATISCH — die Aenderung sitzt im `/api/state`-agent-Block, NICHT in `mcp-tools.js`. `publicCall`-streamToken-Strip bleibt. | **I5** |
| L2 | `POST /api/settings` schreibt globale Settings | `server.js`, `updateSettings` (global) | `settingsFor(requestTenant)` | **I6** |
| L5 | Cancel ohne Scope | `POST /api/calls/:id/cancel` Route-Def `server.js:509` (`getCall` Body-Zeile `:510`), Audit ohne `requestedBy` | `call.tenantId===requestTenant` sonst 404; `requestedBy` ins Audit | **I6** |
| L6 | Export hart `OWNER_TENANT_ID` | `GET /api/tenant-data/export -> exportTenantData(OWNER_TENANT_ID)` (`server.js:564`) | `exportTenantData(requestTenant)` (Store-Fn ist bereits tenant-parametrisiert) | **I6** |
| L4 | Outbound belastet Owner-Budget + Owner-Nummer | `POST /api/calls`: `tenantId: OWNER_TENANT_ID`, `ownerNumberForProvider`, `budgetExceeded(OWNER_TENANT_ID)` (`server.js:454/465/477`) | `tenantId = requestTenant`; `from` = aktive Tenant-Nummer (fail-closed: keine eigene Nummer -> Reject); `budgetExceeded(requestTenant)` UND `globalBudgetExceeded` **PARALLEL** (Schnittmenge); `numberGateError` unveraendert | **I7** |

**Safety-Schnittmenge (Regel 1, unantastbar):** Pro-Tenant darf nur EINSCHRAENKEN. Der globale Notaus
(`globalBudgetExceeded`, `globalHourReached`) bleibt PARALLEL, wird nie ersetzt. `numberGateError`
(Denylist/E164/Land/Stundenlimit/Allowlist) unangetastet. **Auth fail-closed:** `resolveTenant(null/
unbekannt) -> Reject`, NICHT Owner (Asymmetrie zu `resolveProfileFrom`).

---

## Onboarding setzt Tenant-Identitaet

`registerTenant(s, id)` legt heute nur `{ id, status: ACTIVE }` an -> ein neuer Tenant erbt Jonas'
Identitaet. Ziel: `registerTenant(s, id, { ownerName, settings?, idpSubject? })` setzt
`tenant.ownerName` + `tenant.idpSubject` + initialisiert `settingsFor`/`calendarFor` des neuen
Tenants. `POST /api/onboard` nimmt `ownerName` (+ optional `idpSubject`/initiale Settings) entgegen
und reicht sie durch. Owner-Default-Tenant unveraendert (in `makeDefaultState` geseedet, nicht ueber
diese Route). Onboarding bleibt hinter Basic-Auth, KEIN MCP-Tool, Cap-Notbremse
(`maxNumbers`/`maxNumbersPerTenant` + `PROVISIONING_ENABLED`-Default-aus) unveraendert.

**Hinweis (Sichtbarkeits-Voraussetzung):** Ein echter End-to-End-Identitaets-Test braucht eine
**anrufbare** Tenant-Nummer. Bei `PROVISIONING_ENABLED=false` (Dry-Run) bleibt die Nummer `requested`
ohne `e164` -> `findTenantByNumber` routet nie -> die Jonas-Luecke ist gar nicht sichtbar. Owner muss
fuer den E2E-Test entscheiden: Mock-Provisioner in Tests oder echter Telnyx-Kauf gegen die Cap.

---

## Phasen-Roadmap

Prinzip: jede Phase **deterministisch pruefbar** (neuer `node:test` + Bestand byte-identisch gruen),
Owner = Default-Tenant, durchgehend lauffaehig. **I0 ist bewusst der kleinste Schritt** (reiner
Helper, kein Konsument, keine Datenform). Sicherheitskritische Phasen (I4 Auth-Achse, I2
global->pro-Tenant-Settings, I5/I6/I7 Scope, I7 Outbound-Budget/From) sind **HARTE Gates vor dem
zweiten echten Tenant**.

---

**I0 — Tenant-Kontext-Seam als reines Domaenen-Objekt (byte-identisch, kein Konsument)**
- **Ziel:** `tenantContext(s, tenantId) -> { tenantId, ownerName, settings, calendar }` in
  `state-ops.js` einfuehren, mit gekapseltem Owner-Fallback. Liest in dieser Iteration noch die
  globalen Singletons (`config.ownerName`, `s.settings`, `s.calendar`). KEIN Konsument umgestellt,
  KEINE Datenform geaendert.
- **Dateien:** `src/store/state-ops.js` (`tenantContext`); `src/store/json.js` + `src/store/pg.js`
  (Wrapper); `src/store.js` (die explizite Re-Export-Liste — `tenantContext` neu aufnehmen).
- **Soll-Zustand (DoD):** `tenantContext(s, OWNER_TENANT_ID)` liefert byte-identisch
  `{ tenantId: OWNER_TENANT_ID, ownerName: config.ownerName, settings: <heutiges Singleton>,
  calendar: <heutige Liste> }`. Die Funktion ist ueber die Fassade `store.tenantContext` aufrufbar
  (nicht `undefined`).
- **Verifikation (deterministisch):** Neuer `node:test` (rein-Unit, KEIN Spawn/pglite):
  `assert.deepEqual(tenantContext(s, OWNER_TENANT_ID).ownerName, config.ownerName)` + settings/calendar
  gleich dem Singleton; **zahlfreier Contract-Parity-Smoke** (rottet nicht): ueber die erwartete
  Export-Namen-Liste iterieren und JEDEN Namen auf `typeof store.<name> === "function"` pruefen (statt
  einer hartkodierten Zahl), inkl. des neuen `tenantContext` — faengt die Re-Export-Landmine, ohne von
  einer Anzahl abzuhaengen. `node --check` aller drei Store-Dateien. **Bestandssuite bleibt gruen
  (Owner=Default, byte-identisch).**
- **Risiko:** Re-Export-Landmine (jede neue Store-Fn synchron in `state-ops` + `json` + `pg` +
  die explizite `store.js`-Liste) -> der zahlfreie Contract-Parity-Smoke (jeder erwartete Name
  `typeof function`) als Gate.

**I1 — Call-Pfad-Identitaet ueber den Seam aufloesen (beide Engines)**
- **Ziel:** `systemPrompt(call)`, `disclosureSentence(call)`, `summarizeCall(call)`,
  `execTool(call,...)` und der Inbound-Greeting in `server.js /voice/incoming` lesen Identitaet/
  Settings/Kalender NUR noch ueber `tenantContext(s, call.tenantId)` statt `config.ownerName` /
  `store.load().settings` / `store.getCalendar()`. Alle DREI Settings-Lesepunkte (`systemPrompt`,
  `toolDefs`, Tool-Gates `allowCalendar`/`allowBooking`) gemeinsam umgestellt. `disclosureSentence`
  behaelt den Owner-Fallback. `bridge.js` erbt automatisch.
- **Dateien:** `src/claude.js` (`systemPrompt`, `disclosureSentence`, `toolDefs`, `execTool`,
  `summarizeCall`); `src/server.js` (`/voice/incoming` Greeting-Bau); `test/helpers.js`
  (Harness-Vorarbeit, siehe unten).
- **Harness-Vorarbeit (BENANNTE Voraussetzung — das heutige Harness kann das NICHT):** `seedState()`
  (`test/helpers.js:90`) seedet heute nur `calls/actionItems/notifications/settings/calendar/usage/profiles`
  — KEINE `tenants`, KEINE `numbers`. Es gibt keinen Helper fuer einen zweiten aktiven Tenant mit eigener
  Nummer + Identitaet. Diese Phase erweitert daher zuerst `seedState()` um optionale `tenants`/`numbers`
  (geseedeter aktiver Tenant B mit eigener `e164`-Nummer; `tenant.ownerName="Maria"`) und — fuer die
  spaeteren Scope-Phasen vorbereitend, aber hier schon angelegt — die Faehigkeit, einen
  `X-Internal-Identity`-Tenant-Header zu setzen (analog `test/profiles.test.js:25`). Eigener kleiner
  Verifikations-Schritt fuer die Vorarbeit: `seedState({tenants:[B], numbers:[B-aktiv]})` ->
  `store.findTenantByNumber(B-Nummer) === "B"` (rein-Unit). DIESE Vorarbeit ist die geteilte Fixture
  fuer I1(b)/I3/I5/I6/I7 — ohne sie sind deren Cross-Tenant-Asserts nicht ausfuehrbar.
- **Soll-Zustand (DoD):** Ein Inbound-Call auf die Nummer von Tenant B (mit gesetztem
  `tenant.ownerName="Maria"`) baut Begruessung + System-Prompt + Disclosure-Name mit "Maria", nicht
  "Jonas"; `get_calendar` liefert B's Kalender. Owner-Call nennt weiter "Jonas" (byte-identisch).
  Kein Identitaets-Konsument liest mehr `config.ownerName`/`store.load().settings`/`store.getCalendar`
  direkt (Code-Review-Gate).
- **Verifikation (deterministisch, ZWEI Ebenen — der curl-Check allein reicht nicht):**
  (a) **Rein-Unit (deckt den Realtime-Pfad ab, der den curl-Greeting NICHT erreicht):** `/voice/incoming`
  returnt im `VOICE_ENGINE=realtime`-Pfad VOR dem Greeting-Bau (`server.js:286-288 -> return
  render(streamDirectives(call))`); System-Prompt + Disclosure-Name laufen dort ueber `bridge.js` ->
  `claude.js`. Deshalb deterministisch ohne Spawn pruefen, dass beide Identitaets-Funktionen B's Namen
  ziehen: `assert.ok(systemPrompt(callWith({tenantId:"B"})).includes("Maria"))` UND
  `disclosureSentence({tenantId:"B", callerName:null, ...})` nennt "Maria" (beide Funktionen tragen
  `call` bereits -> kein Spawn noetig). Owner-Call (`tenantId=OWNER_TENANT_ID`) nennt weiter "Jonas".
  (b) **Spawn (deckt die Budget-Engine-Begruessung ab):** `curl POST /voice/incoming`
  (`SKIP_TWILIO_SIGNATURE_CHECK=true`, `To`=B's Nummer) -> Begruessung enthaelt B's `ownerName`.
  Dieser Spawn-Check setzt die seedState/startServer-Harness-Erweiterung aus I1-Vorarbeit voraus
  (siehe **Harness-Vorarbeit** unten — geseedeter aktiver Tenant B mit eigener Nummer).
  **`test/disclosure-outbound.test.js` bleibt gruen ("im Auftrag von Jonas").** **Bestandssuite bleibt
  gruen (Owner=Default, byte-identisch).**
- **Risiko:** Drei Settings-Lesepunkte inkonsistent -> alle in einem Commit; Disclosure-Fallback
  versehentlich entfernt -> Pinned-Test faengt es.

**I2 — settings/calendar zu pro-Tenant-Maps (GEFAEHRLICHSTER UMBAU, allein, dreifaches Gate)**
- **Ziel:** `s.settings`/`s.calendar` von flachen Singletons auf `tenantId`-gekeyte Maps heben
  (`settingsFor`/`calendarFor` analog `usageFor`; `defaultSettingsMap()`/`calendarMap()` analog
  `emptyUsageMap()`, Owner vorbelegt). `updateSettings`/`getCalendar`/`addCalendarEvent`/`findConflict`
  bekommen `tenantId`. `tenantContext` liest ab jetzt aus den Maps. `json.load()` bekommt die
  defensive Migration Singleton->Owner-Bucket (analog `migrateUsageToMap`). `tenant.ownerName` als
  optionales Feld.
- **Dateien:** `src/store/defaults.js` (`defaultSettingsMap`/`calendarMap`); `src/store/state-ops.js`
  (`settingsFor`/`calendarFor`, Ops bekommen `tenantId`, `tenantContext` liest Maps); `src/store/json.js`
  (`load()`-Migration); `src/store/pg.js` (Wrapper-Parity); `src/store.js` (Re-Export); Konsumenten in
  `claude.js`/`server.js` reichen `call.tenantId` durch.
- **Soll-Zustand (DoD):** Zwei Tenants haben getrennte `settings`/`calendar`; eine Aenderung an B's
  Settings beruehrt A's Settings nicht. Eine bestehende `data/store.json` mit flachem `settings`/`calendar`
  laedt fehlerfrei und landet im Owner-Bucket. json- und pg-Backend exportieren denselben Funktionssatz.
- **Verifikation (deterministisch, DREIFACH):** (a) Bestandssuite byte-identisch gruen (Owner-Bucket
  == heutiges Singleton); (b) Migrations-Test: alter `store.json`-Shape -> Owner-Bucket (rein-Unit);
  (c) Map-Trennungs-Test zweier synthetischer Tenants gegen `settingsFor`/`calendarFor` (rein-Unit,
  KEIN Spawn/pglite-Mix); plus Backend-Parity-Test json==pg fuer die neuen Funktionen. **Bestandssuite
  gruen.**
- **Risiko:** json ist Prod -> falsche Migration wirkt sofort cross-tenant-persistent; Backend-Drift,
  wenn ein Wrapper vergessen wird. Mitigation: das dreifache Gate; Migration an EINER Stelle.

**I3 — Onboarding setzt Tenant-Identitaet (ownerName + Map-Init)**
- **Ziel:** `registerTenant(s, id, { ownerName, settings? })` setzt `tenant.ownerName` +
  initialisiert `settingsFor`/`calendarFor` des neuen Tenants lazy. `POST /api/onboard` nimmt
  `ownerName`/Settings entgegen und reicht sie durch. (Kein `idpSubject` hier -> I4.) Owner-Default
  unveraendert.
- **Dateien:** `src/store/state-ops.js` (`registerTenant`); `src/server.js` (`POST /api/onboard`).
- **Soll-Zustand (DoD):** `onboard` mit `ownerName="Maria"` -> ein Anruf auf dessen aktive Nummer
  nennt "Maria" (schliesst den Identitaets-Kreis auf der Schreibseite). Onboarding ohne `ownerName`
  faellt auf den Owner-Fallback (rueckwaertskompatibel). Der bestehende 2-Arg-Aufruf
  `registerTenant(s, tenantId)` (`server.js:647`) bleibt rueckwaertskompatibel: `ownerName` ist optional
  (3. Arg), ohne ihn entsteht ein Tenant-Record ohne `ownerName`-Feld -> Owner-Fallback im `tenantContext`.
- **Verifikation (deterministisch):** Reiner Spawn-`node:test` (KEIN pglite): `onboard` mit `ownerName`
  -> Tenant-Record traegt `ownerName`; **die deterministische Haelfte stuetzt sich auf die
  Harness-Vorarbeit aus I1** (geseedete aktive Tenant-Nummer): `/voice/incoming` auf dessen Nummer nennt
  den Namen. Plus expliziter Parity-Vektor: bestehender 2-Arg-Aufruf `registerTenant(s, id)` erzeugt
  byte-identisch zum Bestand einen Record ohne `ownerName` (Onboarding-Bestandspfad bleibt gruen).
  **Bestandssuite gruen.** (Der E2E mit echtem Telnyx-Kauf gegen die Cap ist davon getrennt ein
  OPTIONALER manueller Smoke, nur mit Owner.)
- **Risiko:** Ohne anrufbare Nummer (Dry-Run) ist der Effekt unsichtbar -> Test seedet eine aktive
  Tenant-Nummer direkt.

**I4 — resolveTenant-Seam (idp_subject/email -> tenant), fail-closed, hinter MULTI_TENANT-Flag**
- **Ziel:** `resolveTenant(s, idpSubjectOrEmail)` als Geschwister zu `resolveProfile` einfuehren
  (null/unbekannt -> null -> Reject, NIE Owner). `requestTenant(req)` in `server.js` loest aus
  `req.auth` (MCP) bzw. dem localhost-only `X-Internal-Identity` (REST) den Request-Tenant auf, ueber
  dieselbe spoofing-sichere Bruecke. Hinter `MULTI_TENANT`-Flag (Default aus; Flag aus ->
  `requestTenant === OWNER_TENANT_ID` byte-identisch). NOCH KEIN Endpunkt filtert — nur Aufloesung
  verfuegbar + auditiert.
- **Dateien:** `src/store/state-ops.js` (`resolveTenant`); `src/store/json.js`/`pg.js`/`store.js`
  (Re-Export); `src/server.js` (`requestTenant`, `/mcp`-Handler, `MULTI_TENANT`-Flag); `src/config.js`
  (Flag); `test/helpers.js` (BASE_ENV mit neutralem fail-closed Default).
- **Soll-Zustand (DoD):** Flag an + bekanntes `idpSubject` -> richtiger `tenantId`. Flag an +
  unbekannte/leere/null-Identitaet auf geschuetztem Pfad -> Reject (NICHT Owner). Flag aus -> Owner.
  Nur fehlendes `req.auth` (localhost/stdio) bleibt Owner.
- **Verifikation (deterministisch):** Spawn-`node:test`: Negativ-Assertion (Flag an, unbekannte/null
  Identitaet -> Reject) + Positiv (bekanntes `idpSubject` -> Tenant) + Flag-aus -> Owner. **Bestandssuite
  gruen.** Code-Kommentar an `resolveTenant`, der die Asymmetrie zu `resolveProfileFrom(!email)->OWNER`
  explizit benennt.
- **Risiko:** **fail-open-Inversion** (`resolveTenant` erbt versehentlich `OWNER`) -> ganzer Scope
  umgehbar; still (owner-only-Tests gruen). Mitigation: eigene Phase ohne Read-Konsequenz, expliziter
  Negativ-Test BEVOR I5 filtert. BASE_ENV-Drift -> Flag sofort in BASE_ENV (fail-closed aus).

**I5 — Tenant-Scope auf alle REST/MCP-Reads (L1/L3 dicht, fail-closed) — HARTES GATE**
- **Ziel:** Jeden Lesepfad gegen `requestTenant` scopen: `/api/state` filtert calls/actionItems/
  notifications/calendar/settings/usage UND den `agent`-Block (`server.js:542-543`: `number:
  config.twilioNumber`, `owner: config.ownerName` -> Tenant-Werte); `/api/calls/:id` (Route-Def
  `server.js:552`) prueft `call.tenantId===requestTenant` sonst 404 (kein Existenz-Leck).
  `get_my_number`/`get_agent_status` lesen `s.agent.number`/`s.agent.owner` ueber `GET /api/state`
  (`mcp-tools.js:107/160`) und erben das Scoping AUTOMATISCH — KEINE Aenderung in `mcp-tools.js` noetig,
  die Quelle ist der `/api/state`-agent-Block. `publicCall`-streamToken-Strip bleibt. Hinter
  `MULTI_TENANT`-Flag (aus -> ungefiltert wie heute).
- **Dateien:** `src/server.js` (`GET /api/state` inkl. `agent`-Block `server.js:541-548`,
  `GET /api/calls/:id` `server.js:552`). (`src/mcp-tools.js` ist nur Verifikations-Anker, kein
  Aenderungs-Ort: die Tools erben ueber `/api/state`.)
- **Soll-Zustand (DoD):** Zweiter Tenant + zwei Identitaeten: Tenant-A-Token sieht NUR A-Calls;
  fremde `call_id`/`twilioSid` -> 404 (nicht 403). Flag aus -> byte-identisch heute.
- **Verifikation (deterministisch):** Spawn-`node:test` mit zweitem synthetischen Tenant (Harness-Vorarbeit
  aus I1) + zwei Identitaeten. **Das bindende Gate ist ein ausfuehrbarer Negativ-Test PRO Lesepfad, nicht
  die Checkliste:** eine Test-Tabelle, deren Eintraege jeden daten-beruehrenden Lesepfad aufzaehlen
  (`GET /api/state`, `GET /api/calls/:id`, lesende MCP-Tools `get_transcript`/`list_calls`/`list_action_items`/
  `get_my_number`/`get_agent_status`/`get_call_status`); je Eintrag eine Positiv- UND eine Negativ-Assertion
  (A-Identitaet sieht A; A-Identitaet auf fremde id/Ressource -> 404/leer). Die Inventar-Checkliste aller
  `/api/*`-Endpunkte + lesenden MCP-Tools bleibt als DOKUMENTATION, ist aber NICHT das Gate (eine Checkliste
  kann gruen-aber-unvollstaendig sein); jeder neue Lesepfad MUSS einen Tabellen-Eintrag bekommen.
  **Bestandssuite gruen (Flag aus).**
- **Risiko:** Maximaler stiller Blast-Radius (ein vergessener Lesepfad leakt Transkripte ueber MCP);
  Owner-only-Tests sind gruen-aber-falsch. Mitigation: zweiter Tenant Pflicht-Fixture; ausfuehrbare
  Per-Lesepfad-Test-Tabelle als Gate (nicht nur die manuelle Checkliste).

**I6 — Tenant-Scope auf Schreib-/Steuer-Pfade (L2/L5/L6 dicht) — HARTES GATE**
- **Ziel:** `POST /api/settings` -> `settingsFor(requestTenant)` (L2). `POST /api/calls/:id/cancel`:
  `call.tenantId===requestTenant` sonst 404, `requestedBy` ins Audit (L5). `GET /api/tenant-data/export`
  -> `exportTenantData(requestTenant)` statt `OWNER_TENANT_ID`-Konstante (L6). `POST /api/calendar`
  (book) scoped auf `requestTenant`. Hinter `MULTI_TENANT`-Flag.
- **Dateien:** `src/server.js` (`POST /api/settings`, `POST /api/calls/:id/cancel`,
  `GET /api/tenant-data/export`, `POST /api/calendar`).
- **Soll-Zustand (DoD):** Tenant A kann B's Settings nicht schreiben, B's laufenden Call nicht canceln,
  B's Daten nicht exportieren. Cancel-Audit traegt `requestedBy`. Flag aus -> byte-identisch.
- **Verifikation (deterministisch):** Spawn-`node:test`: A schreibt nur A's Settings; Cancel auf
  fremden Call -> 404; Export liefert nur A's Daten (durch `publicCall` gestrippt). **Bestandssuite
  gruen (Flag aus).**
- **Risiko:** Schreib-/Steuer-Mutationen + Geld/Recht; Cancel ohne `requestedBy` = forensisch nicht
  nachvollziehbar. Mitigation: separate Phase mit Mutations-/Audit-Test-Vektoren.

**I7 — Outbound tenant-aware (L4 dicht: tenantId/from/Budget), Gates parallel — HARTES GATE**
- **Ziel:** `POST /api/calls`: `tenantId = requestTenant` (statt hart `OWNER_TENANT_ID`); `from` =
  aktive Tenant-Nummer (`s.numbers` des Tenants; fail-closed: keine eigene Nummer -> Reject, NIE
  Owner-Nummer als Fremd-Tenant-Fallback); `budgetExceeded(requestTenant)` UND `globalBudgetExceeded`
  PARALLEL (Schnittmenge, globaler Notaus nie entfernt). `numberGateError`-Kette unveraendert; pro-Tenant
  nur einschraenkend. `disclosureSentence` nutzt `tenant.ownerName`-Fallback. Hinter `MULTI_TENANT`-Flag.
- **Dateien:** `src/server.js` (`POST /api/calls`-Handler): `requestTenant(req)` PARALLEL zu
  `internalIdentity(req)` berechnen (heute loest der Handler `internalIdentity` NUR fuer
  `resolveProfile`/`requestedBy` auf, `server.js:433-435`, NICHT fuer den Tenant — der Tenant ist hart
  `OWNER_TENANT_ID`, `server.js:477`); dann `tenantId = requestTenant`; `from` = aktive Tenant-Nummer
  aus `s.numbers` (fail-closed Reject wenn keine, statt `ownerNumberForProvider` `server.js:465`);
  `budgetExceeded(requestTenant)` UND `globalBudgetExceeded` PARALLEL (`server.js:454`-Stelle).
- **Soll-Zustand (DoD):** Tenant-A-Outbound nutzt A's Nummer + belastet A's Budget; ueberschrittenes
  Tenant-Budget sperrt nur A; globaler Notaus sperrt weiterhin alle. Ein Tenant OHNE eigene aktive Nummer
  faellt NICHT auf die Owner-Nummer zurueck, sondern wird **rejected** (fail-closed; Toll-Fraud-Riegel).
  Flag aus -> Owner byte-identisch.
- **Verifikation (deterministisch):** Spawn-`node:test`: A-Outbound nutzt A-Nummer+A-Budget; A-Budget
  erschoepft -> A geblockt, B nicht; globaler Notaus greift bei Summe (Regressionstest, der den globalen
  Notaus unveraendert gruen haelt); **expliziter Negativ-Vektor: Tenant ohne eigene aktive Nummer ->
  Reject, NICHT Owner-Nummer als Fallback.** **Bestandssuite gruen (Flag aus).**
- **Risiko:** Hoechster Geld-/Toll-Fraud-Blast-Radius; globaler Notaus versehentlich durch
  tenant-lokalen ersetzt. Mitigation: `from` fail-closed Reject; globaler-Notaus-Test bleibt gruen.

**I8 — pg-Backend von OWNER_TENANT_ID entpinnen (multi-tenant hydrate/flush)**
- **Ziel:** `init`/`hydrate`/`save`/`flush` ueber `s.tenants` iterieren, pro Tenant
  `set_config('app.current_tenant', ...)`; `settings`/`calendar`/`usage`/`numbers`/`profiles` aller
  Tenants hydrieren/flushen (loest die `flushNumbers`-Fremd-Tenant-Sperre + RLS-WITH-CHECK).
  `tenant`-Tabelle bekommt `owner_name` + `idp_subject` via `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
  json bleibt Prod-Default.
- **Dateien:** `src/store/pg.js` (`init`/`hydrate`/`save`/`flush`/`flushNumbers`); `src/db/schema.sql`
  + `src/db/migrate.js` (additive Spalten).
- **Soll-Zustand (DoD):** Zwei Tenants round-trippen unter pg getrennt durch hydrate/flush; ein
  Cross-Tenant-Insert wird von FORCE RLS WITH CHECK geblockt. Owner-only-pg bleibt byte-identisch.
- **Verifikation (deterministisch):** Rein-pglite-`node:test` (NIE mit Spawn mischen): zwei synthetische
  Tenants persistieren getrennt; RLS-Block-Assertion fuer Fremd-Tenant-Insert. **Bestandssuite gruen.**
- **Risiko:** Vergessener `set_config` schreibt Fremd-Tenant-Daten unter Owner-GUC, oder RLS blockt
  still. Mitigation: pglite-Test mit RLS-Assertion; spaet, weil json=Prod es maskiert (kein Prod-Risiko).
  **Gate-Bedingung NUR bei pg-Prod:** wird kein zweiter Tenant unter pg persistiert, ist I8 KEIN
  Gate vor Tenant 2 (json bleibt Prod) — Owner muss json-vs-pg-Prod vor Tenant 2 entscheiden.

**I9 — Self-Service-Login + getrenntes Tenant-Dashboard + Settings-UI (hinter Reife-Flag)**
- **Ziel:** Pro-Tenant-Login (`req.auth -> resolveTenant`), getrennt vom `admin:pw`-Plattform-Login
  (bleibt Owner/Plattform-Werkzeug). Getrenntes Dashboard pro Tenant (Datenquelle = das tenant-gefilterte
  `/api/state` aus I5). Self-Service-Settings-UI (`settingsFor(eigenerTenant)`; Gates nur einschraenkbar,
  Disclosure nie abschaltbar, `allowBankData`/`allowPersonalData` nie ueber globales Maximum). Hinter
  eigenem fail-closed Reife-Flag (Default aus).
- **Dateien:** `public/` (getrenntes Tenant-Dashboard + Settings-UI); `src/server.js` (Tenant-Login-Pfad,
  Self-Service-Settings-Route + Whitelist); `src/config.js` (`SELF_SERVICE_ENABLED`); `test/helpers.js`
  (BASE_ENV).
- **Soll-Zustand (DoD):** Flag an: Tenant-A-Session sieht/aendert nur A; B nicht erreichbar; Disclosure
  bleibt fest verdrahtet. Flag aus: heutiges Admin-Dashboard byte-identisch.
- **Verifikation (deterministisch):** Spawn-`node:test`: A-Session sieht nur A-Dashboard/Settings;
  Self-Service-Settings-Whitelist lehnt `allowBankData > Maximum` und jeden Disclosure-Abschalt-Versuch
  ab. **Bestandssuite gruen (Flag aus).**
- **Risiko:** Groesste neue Angriffsflaeche (oeffentlicher Login + Self-Service-Schreiben). NUR sicher,
  wenn I5/I6/I7 fail-closed dicht. Mitigation: hart abhaengig von I6 (Write-Scope) + I4 (Aufloesung),
  eigenes Reife-Flag.

---

### Abhaengigkeiten & Gate-Topologie

```
I0 (Seam) -> I1 (Call-Pfad) -> I2 (Map-Migration, gefaehrlichster Daten-Umbau) -> I3 (Onboarding-Identitaet)
                                                                                       |
I0 -> I4 (resolveTenant, fail-closed, Flag) ------------------------------------------+
                          |
                          +-- I5 (Read-Scope)   \
                          +-- I6 (Write-Scope)    > parallel nach I4, kein dependsOn untereinander
                          +-- I7 (Outbound)      /
I4/I6 -> I9 (Self-Service)         I4 -> I8 (pg-Entpinnung)
```

**HARTE GATE-BEDINGUNG vor dem 2. ECHTEN (zahlenden) Tenant — ALLE muessen gruen + live sein:**
- I1, I2, I5, I6, I7 gemergt UND mit einem **ECHTEN zweiten synthetischen Tenant** (eigene aktive
  Nummer + eigene Identitaet) getestet — NICHT nur Owner (`OWNER_TENANT_ID` maskiert sonst alle Lecks).
  Diese Fixture (geseedeter aktiver Tenant + Nummer + `X-Internal-Identity`-Header) wird in der
  **I1-Harness-Vorarbeit** (`seedState`/`startServer`-Erweiterung) angelegt und von I3/I5/I6/I7
  geteilt — ohne sie sind die Cross-Tenant-Asserts nicht ausfuehrbar.
- Negativ-Test der fail-closed-Asymmetrie (Flag an + unbekannte Identitaet -> Reject, nicht Owner).
- Cross-Tenant-Test (A sieht nur A; fremde `call_id` -> 404; A kann B's settings/cancel/export/Outbound
  nicht erreichen).
- Safety-Regression (`globalBudgetExceeded` + `globalHourReached` + `numberGateError` unveraendert gruen;
  `disclosure-outbound.test.js` gruen).
- **Live-Verifikation:** `git push upstream master` (Render deployt **upstream jonas986, NICHT origin**)
  + `[boot]`-Commit-Banner-Check gegen den erwarteten SHA — sonst gilt ein ungetesteter Stand faelschlich
  als live.
- I8 ist Gate nur, falls pg vor Tenant 2 Prod wird (sonst json=Prod, I8 abkoppelbar).

---

## Pre-Mortem: Top-Risiken + Mitigationen

**Rahmen: Ein Jahr in der Zukunft (06/2027) — die Identitaets-Schicht ist gescheitert. Was ist passiert?**

**R1 — Cross-Tenant-Transkript-Leak ueber MCP.**
*Was passierte:* Ein authentifizierter MCP-Client eines kleinen Tenants zog ueber `get_transcript`
jede `call_id` und las Transkripte/Summaries des groessten Kunden ab — DSGVO-Meldepflicht,
Vertrauensverlust. URSACHE: I5 wurde gebaut, aber EIN Lesepfad vergessen (`/api/calls/:id` per
`twilioSid`, `list_action_items`, ein neuer Endpunkt) ODER `resolveTenant` fiel bei null/unbekannt auf
Owner fail-OPEN (Reflex von `resolveProfileFrom(!email)->OWNER`, `defaults.js:173`). Tests liefen nur
gegen den Owner -> der `OWNER_TENANT_ID`-Default maskierte das Leck (gruen-aber-falsch).
*Mitigation:* I4 strikt fail-closed (null/unbekannt -> Reject) hinter `MULTI_TENANT`-Flag, mit
isoliertem Negativ-Test BEVOR I5 filtert; I5-Gate mit echtem zweitem Tenant + zwei Identitaeten +
Endpunkt-Inventar-Checkliste; fremde id -> 404 (kein Existenz-Leck). Code-Kommentar an `resolveTenant`,
der die Asymmetrie zu `resolveProfile` benennt.

**R2 — store.json kollabiert (Daten-Korruption in Prod).**
*Was passierte:* `data/store.json` eines Bestandskunden ist still kollabiert — `settings`/`calendar`
wurden bei der Map-Umstellung (I2) nicht migriert, der Owner-Bucket ist leer, der Agent sagt seit
Wochen Defaults. URSACHE: I2 ohne defensiven `json.load()`-Migrationspfad (`migrateUsageToMap`-Analogon
vergessen), oder die Migration kam in `json.js` aber nicht in pg-hydrate/`seedDefaults` -> Backend-Drift.
json ist Prod, also sofort sichtbar und cross-tenant-persistent.
*Mitigation:* I2 mit dreifachem Gate (Migrations-Test alter `store.json` -> Owner-Bucket;
Backend-Parity json==pg; Map-Trennung); Migration an EINER Stelle (`json.load()`); `defaults.js` als
einzige Quelle fuer beide Backends; I2 frueh und ALLEIN (nicht mit Seam I0 verschmolzen).

**R3 — Toll-Fraud auf Owner-Budget/Owner-Nummer.**
*Was passierte:* Ein Self-Service-Tenant hat ueber `/api/calls` auf Kosten des Owner-Budgets und unter
der Owner-Nummer Premium-Nummern angerufen; die Rechnung traf den Plattform-Betreiber. URSACHE:
Self-Service (I9) ging live, BEVOR Outbound (I7) tenant-aware war; ODER beim Outbound-Umbau wurde der
globale Notaus (`globalBudgetExceeded`) versehentlich durch das tenant-lokale Budget ersetzt
(Schnittmenge gebrochen).
*Mitigation:* I9 hart abhaengig von I6 (Write-Scope) + I4 (Aufloesung); I7-Gate prueft Tenant-A-Outbound
nutzt A-Nummer + A-Budget UND globaler Notaus greift weiter (parallel, nicht ersetzt); `from` fail-closed
Reject (NIE Owner-Nummer als Fremd-Tenant-Fallback); `numberGateError` unveraendert.

**R4 — Disclosure-Pflicht ausgehebelt.**
*Was passierte:* Auf einer Tenant-Nummer fehlte der KI-Hinweis im ersten Satz (EU-AI-Act/Transparenz).
URSACHE: Beim Tenant-aware-Machen (I1) wurde der Disclosure-Satz versehentlich an ein Tenant-Setting
gekoppelt (`allowDisclosureOff`) oder der Owner-Fallback fiel weg, sodass ein Tenant ohne gesetzten
`ownerName` einen leeren/abschaltbaren Satz bekam.
*Mitigation:* Regel 2 unantastbar — NUR die Namensquelle (`call.callerName || tenant.ownerName ||
config.ownerName`) folgt dem Tenant, der SATZ bleibt fest verdrahtet in beiden Engines; Self-Service-
Whitelist (I9) schliesst Disclosure explizit aus; `disclosure-outbound.test.js` bleibt gruen, plus ein
Test mit Tenant-`ownerName`, der beweist, dass NUR der Name wechselt.

**R5 — Seam nie eingezogen / Lock-in zurueck.**
*Was passierte:* Beim Hinzufuegen von `tenant.locale`/`tenant.timezone` musste man wieder alle >10
Identitaets-Stellen anfassen. URSACHE: I0 wurde uebersprungen oder mit I1/I2 verschmolzen, sodass es nie
EIN `tenantContext`-Objekt gab, durch das jede Identitaets-Quelle fliesst (verstreute
`settingsFor(s, call.tenantId)`-Direktaufrufe statt eines Domaenen-Objekts).
*Mitigation:* I0 als eigene, byte-identische Phase mit Unit-Test `tenantContext(owner) == heutige Werte`
und KEINEM umgestellten Konsumenten; Code-Review-Gate ab I1 (kein Identitaets-Konsument liest
`config.ownerName`/`store.load().settings`/`store.getCalendar` direkt).

**R6 — Store-Funktion zur Laufzeit undefined.**
*Was passierte:* `settingsFor`/`resolveTenant` war zur Laufzeit `undefined`, der Agent crashte beim
zweiten Tenant — kein Compile-Fehler hatte gewarnt. URSACHE: die explizite Re-Export-Landmine
(`store.js`): in `state-ops.js` implementiert, aber in der expliziten `store.js`-Liste ODER im
`pg.js`-`makePgStore`-Objekt vergessen. ESM kann kein `export * from <Variable>`.
*Mitigation:* Contract-Parity-Check in JEDER store-beruehrenden Phase (I0/I2/I4): neue Funktion in
`state-ops` + `json` + `pg` + Re-Export-Liste; ein Smoke-Test, der jeden exportierten Namen auf
`typeof function` prueft.

**R7 — Lokal/CI gruen, aber Drift / nie live.**
*Was passierte:* Eine sicherheitskritische Phase galt als verifiziert, lief aber alt in Prod; ODER
Baseline lokal rot / CI gruen. URSACHE: Das `MULTI_TENANT`-/`SELF_SERVICE_ENABLED`-Flag (neue config-Env)
wurde nicht mit neutralem fail-closed Default in `test/helpers.js` BASE_ENV nachgezogen -> lokales `.env`
leakte via dotenv in die Spawn-Tests; ODER `git push origin` machte nichts live, weil Render upstream
(jonas986) deployt; ODER pglite + Server-Spawn in EINER Testdatei (P6a-Stall).
*Mitigation:* Jede neue config-Env SOFORT in BASE_ENV (fail-closed aus); Test-Isolation hart
(I5/I6/I7 rein Spawn, I8 rein pglite, NIE gemischt); Live-Verifikation `push upstream master` +
`[boot]`-Banner-Check als Definition-of-Done jeder Sicherheits-Phase.

---

## Offene Entscheidungen fuer den Auftraggeber

**1. Tenant-Aufloesungs-Schluessel fuer REST/MCP: `idp_subject` oder `email`?**
`idp_subject` ist stabil/opak (gegen wechselbare/aliasbare email als Spoofing-Vektor), `email` ist
menschenlesbar. Empfehlung: `idp_subject` als Schluessel des Mappings, `email` nur Anzeige — aber Owner
muss bestaetigen, dass der IdP einen stabilen `sub` liefert (betrifft I4/I3/I8 Tenant-Tabellen-Design).

**2. 1:1 oder 1:n `idpSubject -> Tenant`?**
Loest ein `idpSubject` genau EINEN Tenant auf, oder kann ein Nutzer mehrere Tenants verwalten (Tenant-
Auswahl im Dashboard)? Das entscheidet, ob `resolveTenant` einen Einzelwert oder eine Liste + aktive-
Tenant-Wahl liefert (load-bearing fuer das Shape von `resolveTenant`, I2/I4/I9). Muss VOR I4 fallen,
sonst doch Seam-Transplantation.

**3. Dashboard-Mandantentrennung.**
Bleibt das `admin:pw`-Login dauerhaft eine reine Plattform-Sicht (sieht bewusst ALLE Tenants) und
Tenants bekommen ein voellig getrenntes OAuth-Dashboard? ODER soll das Admin-Dashboard bei aktivem
`MULTI_TENANT`-Flag ebenfalls auf einen gewaehlten Tenant filtern (dann fehlt eine Plattform-
Gesamtsicht)? (Betrifft I5/I9.)

**4. pg-Entpinnung (I8) jetzt oder erst beim 2. echten Tenant?**
Der Nordstern verlangt pg, aber I1-I7 liefern den vollen Identitaets-Nutzen bereits unter json. Bleibt
json Prod, bis ein zweiter zahlender Tenant unter pg persistiert werden soll (dann wird I8 hartes Gate),
oder soll pg vor Tenant 2 produktiv geschaltet werden?

**5. ownerName-Quelle des Owner-Tenants.**
Bleibt `config.ownerName` (Env, Default "Jonas") die kanonische Quelle/Fallback fuer den Owner-Tenant
(haelt den Disclosure-Test gruen), oder wandert der Owner-Name in den Tenant-Record (Env nur noch Seed)?
Empfehlung: Env bleibt Owner-Fallback, neue Tenants tragen ihren Namen im Record.

**6. Self-Service-Settings-Whitelist (I9).**
Welche Felder darf ein Tenant selbst aendern? Vorschlag: `agentName`/`greeting`/`allowCalendar`/
`allowBooking` JA; `allowPersonalData`/`allowBankData` NUR einschraenkend (nie ueber globales Maximum);
Disclosure NIE. Owner muss die erlaubte Whitelist freigeben.

**7. greeting-Freitext vs. kuratierte Vorlage.**
Der Tenant-`greeting` ist der ERSTE gesprochene Satz. Duerfen Tenants ihn als Freitext setzen
(PII-/Missbrauchs-Risiko) oder nur aus einer kuratierten Vorlage waehlen? (Betrifft I9; der Disclosure-
Satz bleibt davor unantastbar.)

**8. Feature-Flag-Granularitaet.**
Ein gemeinsames `MULTI_TENANT` fuer die Scope-Phasen (I4-I7) plus ein getrenntes
`SELF_SERVICE_ENABLED` fuer I9, oder noch feiner (Login vs. Settings-UI getrennt staffeln)?

**9. profiles pro Tenant.**
Bleiben `profiles` global keyed-by-email (Owner-only kollisionsfrei) oder werden sie
`profiles[tenantId][email]` (bei mehreren Tenants mit gleicher email kollidieren sie sonst)? Empfehlung:
deferred (kein BDUF), aber Owner sollte das Risiko gleicher Emails ueber Tenants quittieren.

---

## Geerbte Entscheidungen aus PLAN-MULTI-TENANT-TELNYX.md (do-not-re-litigate)

Die 8 beschlossenen Owner-Entscheidungen der Daten-/Routing-Schicht sind **verbindlich und werden
geerbt, NICHT neu aufgerollt**:

1. **Pool-Modell `tenant_id` + RLS** — `schema.sql` traegt `tenant_id` + FORCE RLS +
   `tenant_isolation`-Policy auf allen 10 Tabellen (inkl. `settings`/`calendar_event`/`profile`). Diese
   Schicht baut darauf; KEIN Schema-Change fuer `settings`/`calendar`/`profile` noetig (PK/Spalten
   existieren), I8 ist reiner App-Code (GUC-Schleife) + additive `ALTER TABLE`.
2. **Telnyx-Realtime in Scope** — `bridge.js` erbt die Identitaets-Aufloesung automatisch ueber
   `claude.js systemPrompt`/`disclosureSentence`; keine eigene Identitaets-Logik.
3. **DE-only Launch** — unveraendert; die Identitaets-Schicht fuegt kein neues Land hinzu.
4. **Server + DB in Deutschland/EU** — unveraendert.
5. **Flat + Inklusiv-Kontingent + harter Minuten-Cap** — `budgetExceeded(tenantId)` +
   `globalBudgetExceeded` (Schnittmenge, R2) bleiben; I7 macht nur den Bucket tenant-aware, entfernt
   KEINEN Notaus.
6. **EU-AI-Act Art. 50(2) deferred** — KEINE Phase aktiviert es heimlich; der gesprochene Disclosure-
   Satz bleibt davon unberuehrt fest verdrahtet.
7. **Summary-only nach Call, Retention fixer Default** — `purgeTranscript`/`pruneOldData` +
   `tenantCallScope` bleiben; `summarizeCall` wird nur in der `ownerName`-Quelle tenant-aware, der
   Retention-/Purge-Mechanismus ist unberuehrt; I5/I6 nutzen `tenantCallScope` fuer Read/Write-Scoping
   wieder.
8. **Sauberer JSON->PG-Schnitt, kein Import** — `defaults.js` als einzige Quelle fuer beide Backends;
   I2/I8 halten die Parity (frischer pg == frischer json), keine Daten-Migration zwischen Backends.

Weiter geerbt (Bestand, unberuehrt): vier provider-neutrale Ports + Telnyx-Adapter; `findTenantByNumber`
(Inbound-Routing, fail-closed, Anti-Spoof); `createCall`-`call.tenantId`-Traeger;
`numbers`/`numberAssignments`-Lifecycle + Caps; per-Tenant `eraseTenantData`/`exportTenantData`
(`tenantCallScope`, bereits tenant-parametrisiert — I6 entpinnt nur den Caller); Safety-Gates komplett
(`numberGateError`: Denylist/E164/Land/Stundenlimit/Allowlist) + Schnittmengen-Muster
(`countryGateAllowed`/`userHourReached`: Profil kann nur einschraenken); Rechteprofil-Achse
(`resolveProfile` + localhost-only `X-Internal-Identity`) — `resolveTenant` (I4) wird das Geschwister
an derselben Stelle, mit getrennter (strengerer) fail-closed-Semantik; `publicCall`-streamToken-Strip;
Audio nie durch MCP.

---

## Relevante Dateien dieses Repos (Datei + Symbol)

- `src/store/state-ops.js` — `makeDefaultState` (`settings`/`calendar` Singletons heute),
  `createCall` (`call.tenantId`), `findTenantByNumber` (Inbound-Routing fail-closed), `usageFor`
  (Map-Vorbild), `registerTenant` (heute nur `{id, status}`), `getCalendar`/`updateSettings`
  (global heute), `resolveProfile`; NEU: `tenantContext`, `settingsFor`, `calendarFor`, `resolveTenant`.
- `src/store/defaults.js` — `emptyUsageMap` (Map-Vorbild), `resolveProfileFrom` (**fail-open auf
  OWNER bei `!email` — die Landmine fuer `resolveTenant`**), `OWNER_PROFILE`/`DEFAULT_PROFILE`,
  `OWNER_TENANT_ID`; NEU: `defaultSettingsMap`/`calendarMap`.
- `src/store/json.js` — `load()` (Map-Migration analog `migrateUsageToMap`), Wrapper-Parity.
- `src/store/pg.js` — `init`/`hydrate`/`save`/`flush`/`flushNumbers` (heute hart `OWNER_TENANT_ID`,
  I8-Entpinnung), `makePgStore`-Objekt (Contract-Parity).
- `src/store.js` — die EXPLIZITE Re-Export-Liste (`store.js:49-78`, aktuell 28 Namen,
  `export const { ... } = backend`) — jede neue Fassaden-Funktion MUSS hier auftauchen.
- `src/claude.js` — `systemPrompt(call)`/`disclosureSentence(call)`/`toolDefs()`/`execTool(call,...)`/
  `summarizeCall(call)` (die Identitaets-Lesepunkte, heute global; I1-Umstellung).
- `src/bridge.js` — `instructions(call)`/Realtime-Opener (erbt `claude.js` automatisch).
- `src/server.js` — `POST /voice/incoming` (Greeting `replaceAll("{owner}", config.ownerName)`),
  `POST /api/calls` (Outbound hart `OWNER_TENANT_ID` + `ownerNumberForProvider` + `budgetExceeded`),
  `GET /api/state` (inkl. `agent`-Block `server.js:542-543` = die Quelle der MCP-Nummer/-Name)/
  `GET /api/calls/:id` (Route-Def `:552`)/`POST /api/calls/:id/cancel` (Route-Def `:509`) — alle
  ungescoped; `POST /api/settings` (global), `GET /api/tenant-data/export` (`OWNER_TENANT_ID`-gepinnt
  `server.js:564`), `POST /api/onboard`
  (`registerTenant`), `internalIdentity`/`/mcp`-Handler (`resolveProfile`-Stelle -> `requestTenant`-Seam),
  `ANON_IDENTITY`-Sentinel.
- `src/auth.js` — `verifyOauth` (`req.auth.{sub,email}` — der `idp_subject`-Seam).
- `src/mcp-tools.js` — `get_my_number`/`get_agent_status` lesen `s.agent.number`/`s.agent.owner` ueber
  `GET /api/state` (`mcp-tools.js:107/160`), NICHT `config` direkt — Quelle ist der `/api/state`-agent-Block
  (`server.js:542-543`). NUR Verifikations-Anker fuer I5, KEIN Aenderungs-Ort; alle Tools erben den
  `/api/*`-Scope automatisch.
- `src/config.js` — `ownerName` (Env, Default "Jonas"), `storeBackend` (Default `json`); NEU:
  `MULTI_TENANT`/`SELF_SERVICE_ENABLED`-Flags.
- `src/db/schema.sql` / `src/db/migrate.js` — `tenant_id` + FORCE RLS (vorhanden); NEU additiv
  `tenant.owner_name`/`tenant.idp_subject` via `ADD COLUMN IF NOT EXISTS` (I8).
- `test/helpers.js` — `BASE_ENV` (`OWNER_NAME: "Jonas"`; neue Flags fail-closed nachziehen),
  `seedState()` (Map-Migration); `test/disclosure-outbound.test.js` (Pin "im Auftrag von Jonas").
