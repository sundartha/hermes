# Server-Slim Phase P10 — Report

**Ziel:** `src/routes/api-onboard.js` extrahieren (`POST /api/onboard`, `POST /api/onboard/retry`)
**Gate:** PASS
**finalBranch:** `phase/slim-p10-api-onboard`
**headCommit (Impl):** `164f611`

---

## 1. Plan (gekuerzt)

### 0. Realitaets-Abgleich
`src/server.js` war zu Phasenbeginn **1522 Zeilen** (P0-P9 hatten bereits verduennt). Zu verschiebender Block (verbatim): **L1090-1303** (Header-Kommentar + `ONBOARD_REASON_STATUS` + `geoLookup`-Singleton + beide Routen + Retry-Reason-Maps).

| Spec-Angabe (verrottet) | Echte Fundstelle |
|---|---|
| `ONBOARD_REASON_STATUS` L1584 | **L1097** |
| `geoLookup`-Singleton L~1600 | **L1101** |
| `POST /api/onboard` L1584-1740 | **L1103-1253** |
| `RETRY_REASON_STATUS/MESSAGE` L1751 | **L1264 / L1275** |
| `POST /api/onboard/retry` L1751-1790 | **L1280-1303** |

### 1. Zentrale Design-Entscheidung: Injektion vs. Direktimport
Folgt exakt dem etablierten, bereits gemergten Muster von `api-calls.js` (P9) und `api-billing.js` (P7):

- **Injiziert** (Laufzeit-Instanzen / Kompositionswurzel-Singletons, INV-7): `store`, `config`, `audit`, `provisioning`.
- **Direktimportiert aus der Heimat** (reine Funktionen + statische Konstanten, G5 "eine Quelle", G11 Konsistenz mit den Schwester-Routern): `validIdentity`, `checkSubAlreadyMerged`, `resolveOnboardCountry`, `languageForCountry`, `normalizePrivateNumber`/`registerTenant`/`setTenantGeo`/`requestNumber`, `tenantIdForSubject`/`shouldPersistProvisionResult`/`KYC_OUTBOUND_MIN`/`PROVIDER`, `geoLookupAdapter`.

**geoLookup-Singleton (INV-7):** Phase-Spec ist hier autoritativ ("Konstruktions-Ort so waehlen, dass weiterhin genau ein geoLookup-Singleton existiert"). `geoLookupAdapter` wird direktimportiert und **einmal am Kopf des Factory-Koerpers** aufgerufen: `const geoLookup = geoLookupAdapter();`. Da `makeOnboardRoutes` genau einmal ge-`app.use`'t wird, bleibt es genau ein Singleton pro Prozess. Kein Per-Request-Lazy-Init.

Verifiziert: keine geoLookup-Injektion noetig, da `GEO_ENABLED` in `test/helpers.js:176` hart auf `"false"` gepinnt ist (Spawn-Tests -> Null-Adapter); der IP->Land-Pfad ist separat unit-getestet in `f1-geo-port.test.js` via `makeStubGeoLookup` — nicht durch `makeOnboardRoutes`.

### 2. Neue Datei `src/routes/api-onboard.js`
Signatur: `export function makeOnboardRoutes({ store, config, audit, provisioning })` -> `Router`.

Handler-Koerper byte-identisch aus `server.js` L1103-1253 bzw. L1280-1303 kopiert (nur `app.post` -> `router.post`); alle Inline-Safety-Kommentare wandern verbatim mit. Imports: `Router` (express), `validIdentity` (api-profiles.js), `checkSubAlreadyMerged` (onboard-guard.js), `geoLookupAdapter` (geo/registry.js), `resolveOnboardCountry` (geo/resolve.js), `languageForCountry` (i18n/locales.js), `PROVIDER`/`KYC_OUTBOUND_MIN`/`tenantIdForSubject`/`shouldPersistProvisionResult` (store/defaults.js), `registerTenant`/`setTenantGeo`/`normalizePrivateNumber`/`requestNumber` (store/state-ops.js).

### 3. Edits an `src/server.js` (Edits A-G)
- **A** — defaults-Import: `KYC_OUTBOUND_MIN`, `tenantIdForSubject`, `shouldPersistProvisionResult` entfernt (`PROVIDER`/`normNum` bleiben, anderweitig genutzt).
- **B** — i18n-Import: `languageForCountry` raus, `localeFor` bleibt (7 weitere Nutzungen).
- **C** — state-ops-Import: `registerTenant`, `normalizePrivateNumber`, `requestNumber`, `setTenantGeo` raus (`setTenantIdentityIfAbsent` + Provisioning-/Lifecycle-Ops bleiben).
- **D** — 3 ganze Import-Zeilen entfernt: `geoLookupAdapter` (geo/registry.js), `resolveOnboardCountry` (geo/resolve.js), `checkSubAlreadyMerged` (onboard-guard.js).
- **E** — api-profiles-Import: `validIdentity` raus (nur Onboard nutzte es).
- **F** — neuer Route-Import ergaenzt: `import { makeOnboardRoutes } from "./routes/api-onboard.js";` (nach `makeCallRoutes`).
- **G** — Onboard-Block (L1090-1303) durch `app.use(makeOnboardRoutes({ store, config, audit, provisioning }));` ersetzt, Mount-Position unveraendert (nach `makeBillingRoutes`, vor `/mcp`).

### 4. Tests
Kein neuer Test, keine Test-Aenderung geplant (reine Verschiebung, byte-identisches HTTP-Verhalten). 5 bestehende Spec-Tests decken beide Routen ab (u.a. `onboarding-route`, `onboarding-identity`, `onboard-persist-failure`, `f1-geo-onboard`, `p2-onboard-retry`). Verifiziert: kein Whitebox-Test grept `server.js` nach Onboard-/Geo-Symbolen.

### 5. Deterministisch pruefbares Ergebnis
`node --check` beide Dateien; `grep -c "^export" src/server.js` = 0; `grep -c 'app.post("/api/onboard' src/server.js` = 0; Boot-Log-Zeile genau 1 Treffer; 5 Spec-Test-Dateien gruen; `npm test` gruen (beide Backends); `git diff --stat src/server.js` Netto-Reduktion (~-210 Z.).

### 6. Invarianten-Compliance
INV-2 (Mount-Reihenfolge in-place erhalten), INV-6 (Boot-Log unangetastet), INV-7 (ein `provisioning`-Singleton injiziert, ein `geoLookup`-Singleton via Einmal-Mount), INV-9 (Safety-Gates verbatim: `withStoreLock`-Kern, Nummern-Caps, `persist_error`->503, KYC-Gate bei Retry), INV-10 (kein Export aus `server.js`).

### 7. Pre-Mortem / Blast-Radius
Klein. Risiko-Kern: (a) versehentlich einen noch genutzten Import entfernen — jedes der 12 zu entfernenden Symbole per `grep -nw` als onboard-only verifiziert; (b) geoLookup-Doppelinstanz — durch Konstruktion am Factory-Kopf + Einmal-Mount ausgeschlossen; (c) verlorene Safety-Rationale-Kommentare — alle Inline-Kommentare wandern verbatim mit.

---

## 2. Impl-Zusammenfassung

`POST /api/onboard` und `POST /api/onboard/retry` als `makeOnboardRoutes({ store, config, audit, provisioning })`-Factory (express.Router) aus `server.js` extrahiert, reine Verschiebung ohne Logik-Aenderung. `geoLookup` bleibt EIN Singleton (jetzt im Factory-Kopf konstruiert, ein Mount = eine Instanz, INV-7). Der `withStoreLock`-kritische Abschnitt (load -> registerTenant -> setTenantGeo -> requestNumber -> save, kein fremdes `await` dazwischen), Nummern-Caps und `persist_error`->503 wandern byte-identisch mit. Pure Helfer/Konstanten (`validIdentity`, `checkSubAlreadyMerged`, `resolveOnboardCountry`, `languageForCountry`, `registerTenant`/`setTenantGeo`/`normalizePrivateNumber`/`requestNumber`, `PROVIDER`/`KYC_OUTBOUND_MIN`/`tenantIdForSubject`/`shouldPersistProvisionResult`, `geoLookupAdapter`) direktimportiert aus ihrer Heimat statt injiziert (G5/G11-Konsistenz mit dem gemergten `api-calls.js`/`api-billing.js`-Muster).

`server.js`: **1522 -> 1307 Zeilen (-215)**, bleibt export-frei (`grep -c '^export'` = 0). Alle 5 Spec-Tests gruen (22 Tests), volle Suite gruen (**2290/2290, 0 fail**, beide Backends json+pglite). `node --check` auf beiden Dateien OK, Boot-Log-Zeile genau 1 Treffer, Mount-Reihenfolge (INV-2) unveraendert (profiles -> billing -> onboard -> mcp).

**Smoke-Test:** Server via `test/helpers.js` `startServer()` (SKIP_TWILIO_SIGNATURE_CHECK=true, Temp-DATA_DIR). `POST /api/onboard` mit neuem Tenant -> 200, Dry-Run (`provisioning:disabled`), Nummer `requested`. `POST /api/onboard/retry` fuer denselben (nicht-zahlenden) Tenant -> 403 "Kein aktiver, verifizierter Subscriber" (Geld-Safety-Gate bestaetigt intakt). `GET /healthz` -> 200.

**Dateien:**
- neu: `src/routes/api-onboard.js`
- geaendert: `src/server.js` (Edits A-G)

**Tests:** keine hinzugefuegt/geaendert (`testsAddedOrChanged: []`), Testergebnis 2290 pass / 0 fail.

### Deviations
1. **Injizierte Dep-Liste = `{ store, config, audit, provisioning }`** statt der 17 Spec-Token. Pure Funktionen/Konstanten direktimportiert aus der Heimat. Grund: exakte Ableitung aus echtem Code + G5/G11-Konsistenz mit dem gemergten `api-calls.js`/`api-billing.js`-Muster (die diese Regel selbst dokumentieren); Verhalten byte-identisch (gleiche Quellen), Spawn-Tests unberuehrt.
2. **geoLookup-Konstruktionsort wandert** von `server.js` in den `makeOnboardRoutes`-Factory-Koerper (Phase-Spec explizit: "Konstruktions-Ort so waehlen"). Erfuellt die Substanz von INV-7 (genau eine Instanz, ein Mount, kein Split-Brain); weicht nur vom woertlichen "in der Wurzel konstruiert" ab — durch die autoritative Phase-Spec explizit gedeckt.
3. **Kein neuer Test** (Spec erlaubt "hoechstens EINEN"): reine Verschiebung, Bestandssuite deckt beide Routen Spawn-basiert ab, kein Whitebox-Grep betroffen.

---

## 3. Safety-Urteil

**approved: true** — alle Kernkriterien erfuellt:

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengige Verifikation:** Symlinked `node_modules`, `review-slim-p10` aus `phase/slim-p10-api-onboard` ausgecheckt. `node --check` gruen auf `src/server.js` und `src/routes/api-onboard.js`. Volle `npm test` (json-Default-Backend + pglite-gestuetzte pg-Tests im selben Glob = beide Backends): erster Lauf 1 Fehlschlag (`telnyx-event-ingest-route` settlement-idempotency), der isoliert UND bei sauberem Vollast-Re-Run gruen war (2290/0) -> bestaetigt den dokumentierten Vollast-Spawn-Race-Flake, unabhaengig von P10. P10-spezifische Tests (`onboarding-route`, `f1-geo-onboard`, `onboarding-identity`, `onboard-persist-failure`, `p2-onboard-retry`) = 22/22 pass. pg-gestuetzte Onboarding-/Provisioning-Tests (`p5-onboarding-funnel`, `store-pg-drain-flushes`, `tenant-prolif-d-reconcile`, `prov01-drain-singleflight`, `prov01-boot-reconcile`) = 27/27 isoliert pass. `grep -c '^export' src/server.js` = 0; Boot-Log-Zeile genau 1 Treffer; keine Test-Dateien geaendert; nur 2 Dateien angefasst; keine `package.json`-/Dependency-Aenderung.

**Blockers:** keine.

**Concerns (nicht blockierend):**
1. Abweichung von der woertlichen SPEC-Dep-Liste: nur `{ store, config, audit, provisioning }` injiziert; die reinen Helfer (`validIdentity`/`checkSubAlreadyMerged`/`geoLookupAdapter`/`resolveOnboardCountry`/`languageForCountry`/`registerTenant`/`setTenantGeo`/`normalizePrivateNumber`/`requestNumber`/`tenantIdForSubject`/`shouldPersistProvisionResult`/`PROVIDER`/`KYC_OUTBOUND_MIN`) werden direkt aus ihren Heimat-Modulen importiert. Im Modul-Header dokumentiert, folgt dem P9-`normNum`/`makeCallRoutes`-Praezedenzfall, verhaltenserhaltend (gleiche Funktionen, gleiche Quelle); die zustandsbehafteten Singletons `geoLookup` (einmal in der einmal-gemounteten Factory gebaut) und `provisioning` (injizierte P6-Instanz) bleiben einzigartig -> INV-7 erfuellt.
2. Zwei Retry-Reason-Map-Konstanten (`RETRY_REASON_STATUS`/`RETRY_REASON_MESSAGE`) wurden von zwischen den beiden Handlern an den Modul-Anfang gehoben; verhaltensmaessig neutral (reine Literale, einzige Aufrufstelle im retry-Handler).

**Verdict:** APPROVED. P10 ist eine saubere reine Verschiebung der Onboard-/Retry-Routengruppe nach `src/routes/api-onboard.js` via `makeOnboardRoutes({store,config,audit,provisioning})`, byte-identisch hinter dem `/api/*`-Basic-Auth-Gate zwischen dem Billing-Mount und `/mcp` gemountet. Whitespace-normalisierter Diff der verschobenen Handler ist identisch bis auf den Factory-Wrapper und die inerte Const-Umpositionierung. Alle Geld-Safety-Gates (Nummern-Caps 403/409/429, fail-closed Dry-Run, `withStoreLock`-kritischer Abschnitt, `persist_error`->503, Retry-KYC-Subscriber-403, `triggerTenantProvisioning`-Wiederverwendung) unveraendert mitgewandert. Offenlegung (`claude.js`/`bridge.js`) unangetastet, Auth fail-closed erhalten, keine Secrets geleakt, INV-2/6/7/10 gewahrt. Volle Suite gruen (2290/0) bei sauberem Re-Run; der einzige Flake ist der dokumentierte Vollast-Spawn-Race, isoliert gruen und unabhaengig von P10.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):**
  - `src/routes/api-onboard.js:33-46` (`RETRY_REASON_STATUS`/`RETRY_REASON_MESSAGE`) — G10 Vertical Separation leicht verschlechtert: im Original stand `RETRY_REASON_STATUS`/`MESSAGE` unmittelbar vor dem `/api/onboard/retry`-Handler; jetzt liegen beide Konstanten am Datei-Anfang, ~190 Zeilen vor ihrer einzigen Verwendung (`router.post("/api/onboard/retry")` bei Zeile ~235). Optional: die beiden `RETRY_*`-Konstanten direkt vor den retry-Handler verschieben (`ONBOARD_REASON_STATUS` kann oben bleiben, wird frueher im selben Handler-Cluster gebraucht).
- **S4 (nicht blockierend, pre-existing):**
  - `src/routes/api-onboard.js:70` (`geoLookupAdapter()`) — G13/P4 (minor): `geoLookupAdapter()` liest intern das global importierte `config`-Modul (`src/geo/registry.js` importiert `config` direkt) statt das in `makeOnboardRoutes` injizierte `config`-Argument zu nutzen — Inkonsistenz zum sonst konsequenten DI-Muster der Datei. Verhalten unveraendert (reine Verschiebung aus `server.js`, dort galt dieselbe Indirektion). Kein Fix noetig fuer P10 selbst; bei Gelegenheit `geoLookupAdapter(config)` parametrisieren, um die injizierte Instanz durchzureichen.

**passNotes:** Reine Verschiebung verifiziert per Normalisierungs-Diff (Handler-Koerper identisch bis auf Konstanten-Hoisting). Alle betroffenen Symbole existieren und werden korrekt (weiter-)verwendet; keine verwaisten Imports/Referenzen in `server.js`. Mount-Reihenfolge relativ zu `makeCallRoutes`/`makeBillingRoutes` unveraendert -> keine Route-Shadowing-Gefahr. Konventionen eingehalten: keine Umlaute in Kommentaren, DI-Pattern konsistent mit Nachbar-Factories, pure Helfer direkt importiert statt injiziert (wie `normNum` in `makeCallRoutes`, dokumentiert). Bestehende Onboarding-Tests decken die verschobene Logik weiterhin ab; volle Suite 2290/2290 gruen auf dem Phase-Commit.

**topTodos:**
1. Kein Blocker — Phase P10 kann gemergt werden.
2. Optional (S3, kosmetisch): `RETRY_REASON_STATUS`/`RETRY_REASON_MESSAGE` naeher an ihren Verwendungsort (retry-Handler) ruecken statt an den Datei-Anfang.
3. Spaeter/Tech-Debt (S4, nicht P10-spezifisch): `geoLookupAdapter()` sollte die injizierte `config`-Instanz nutzen statt intern das globale `config`-Modul zu importieren.

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
