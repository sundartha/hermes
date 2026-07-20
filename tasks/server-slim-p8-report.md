# Server-Slim P8 — `src/routes/api-tenant-write.js` extrahieren

**Gate: PASS**
**finalBranch:** `phase/slim-p8-api-tenant-write`
**headCommit:** `6c16a65f76e88a4d6b87cab20721d05058af506e` (Basis `41b1dc0`, P7 bereits gemergt)

---

## 1. Plan (gekuerzt)

### Ist-Zustand (verifiziert gegen `master` @ `41b1dc0`)

Die Plan-Doc-Angabe „L1464-1504" war verrottet; die drei Routen lagen real bei:

| Symbol | Reale Zeilen (server.js) |
|---|---|
| `app.post("/api/settings", …)` | 1194-1201 |
| `app.post("/api/action-items/:id/toggle", …)` | 1203-1207 |
| `app.post("/api/calendar", …)` | 1209-1234 |
| Gesamt-Block (kontig.) | 1194-1234 (41 Zeilen) |
| Mount-Nachbarn | davor `makeReadRoutes` (1185-1192), danach `makeProfileRoutes` (1236/1242) |
| `import { invalidText }` | L94 |

Dependency-Analyse aus echtem Code: `store.updateSettings`, `store.toggleActionItem`, `store.resolveProfile`, `store.addCalendarEvent`; `requireTenant(req,res)`; `audit(...)`; `internalIdentity(req)`; `OWNER_ID`; `invalidText("title", ...)` (im Modul selbst importiert). **Kein** `config.*` in den drei Handlern (per grep belegt).

Post-Move-Nutzung: `internalIdentity`/`OWNER_ID` bleiben bei L1160 (`/api/calls/:id/cancel`, bleibt bis P9) genutzt -> Imports bleiben. `invalidText` hatte nur die eine funktionale Nutzung (L1223, wandert raus) -> Import in server.js wird unbenutzt -> muss entfernt werden (G12).

Whitebox-Test-Scan: kein Test liest server.js-Quelltext und assertet die Praesenz der drei Routen-Pfade -> keine mechanische Testanpassung noetig.

### Neue Datei `src/routes/api-tenant-write.js`

Signatur: `export function makeTenantWriteRoutes({ store, audit, tenant: { requireTenant }, internalIdentity, OWNER_ID })` -> `express.Router` (ein `deps`-Objekt, F1-konform, identisch zum `makeBillingRoutes`-Muster). Enthaelt die drei Routen byte-identisch aus L1194-1234 uebernommen:

- `POST /api/settings` — `requireTenant` -> `store.updateSettings` -> Audit (nur Keys, keine Werte)
- `POST /api/action-items/:id/toggle` — `store.toggleActionItem`, 404 bei unbekannter ID
- `POST /api/calendar` — Reihenfolge `requireTenant (403) -> allowBooking (403) -> Text-/Datums-Validierung (400)` exakt erhalten; `invalidText` aus `_validation.js` importiert

### Edits an `server.js`

- Import-Block (L94-98): `invalidText`-Import entfernt, `makeTenantWriteRoutes`-Import ergaenzt (Position: direkt hinter `makeReadRoutes`)
- Die drei Inline-Handler (L1194-1234) durch einen `app.use(makeTenantWriteRoutes({...}))`-Mount an unveraenderter Position ersetzt (zwischen `makeReadRoutes` und `makeProfileRoutes`)
- Keine weiteren Edits — `internalIdentity`/`OWNER_ID`-Imports (L119-120) bleiben, da noch bei L1160 genutzt

### Tests

Kein neuer Test — reiner Refactor, Charakterisierungsluecke bereits durch Bestandssuite geschlossen: `test/api-action-items-toggle.test.js` (P0b, pinnt toggle-Route via Spawn+fetch), `i6-write-scope.test.js` (403-Scoping), `audit.test.js` (Audit-Events), `tenant-settings-calendar-map.test.js` (Store-Mapping), `api.test.js` (Happy-Path/Validierung). Alle Laufzeit-Tests, unabhaengig vom Modulort.

### Abweichungen (im Plan begruendet, SPEC-autorisiert)

- **D1** — `config` aus der Dep-Liste gestrichen: die drei Handler lesen kein `config.*` (per grep verifiziert); ein injiziertes ungenutztes `config` waere G12-Verstoss. SPEC autorisiert „Exakte Dep-Liste aus echtem Code ableiten" explizit.
- **D2** — `invalidText`-Import aus server.js entfernt (G12-Pflicht, nicht optional): nach dem Move unbenutzt, da einzige Nutzung war die verschobene `/api/calendar`-Route. Modul importiert `invalidText` selbst.
- **D3** (Klarstellung, keine Abweichung) — `internalIdentity`/`OWNER_ID` werden injiziert statt direkt importiert, passend zur Bestandskonvention (`makeOutboundGates` erhaelt dieselben zwei Symbole injiziert, DIP/G5).

### Invarianten-Mapping

INV-2/INV-6 (Mount-/Middleware-Reihenfolge, Boot-Log unveraendert), INV-7 (Singleton-Instanzen nur durchgereicht, Router einmal konstruiert+gemountet), INV-9/Absolute Regeln (`/api/calendar`-Reihenfolge 403-vor-400 byte-identisch, hinter Basic-Auth, kein Secret/Freitext im Audit), INV-10 (server.js bleibt export-frei).

### Pre-Mortem (aus dem Plan)

1. *„config still gebraucht"* — widerlegt per grep, kein `config.*` in den Handlern.
2. *„Handler-Reihenfolge im /api/calendar gedreht -> 400 vor 403 leakt Existenz"* — Reihenfolge 1:1 kopiert, `i6-write-scope`+`audit` gaten 403-vor-400.
3. *„invalidText-Import-Entfernung bricht /api/calls"* — widerlegt: `/api/calls` nutzt `invalidText` nicht.
4. *„Mount an falscher Position -> Route ungeschuetzt / Provider geblockt"* — Mount strikt zwischen read und profiles, hinter Auth-Gate; `api.test.js` (401 ohne Auth) deckt das ab.

---

## 2. Impl-Zusammenfassung

P8 exakt gemaess Plan/Spec umgesetzt: neue Datei `src/routes/api-tenant-write.js` (`makeTenantWriteRoutes`-Factory, DI-Muster wie `makeReadRoutes`/`makeBillingRoutes`) enthaelt die drei tenant-scoped Schreib-Routen (`POST /api/settings`, `POST /api/action-items/:id/toggle`, `POST /api/calendar`), byte-identisch aus `server.js` L1194-1234 verschoben.

`server.js`: `invalidText`-Import entfernt (unbenutzt nach Move), `makeTenantWriteRoutes`-Import + `app.use`-Mount an unveraenderter Position (zwischen `makeReadRoutes` und `makeProfileRoutes`) eingefuegt.

Alle Verifikationschecks aus dem Plan bestanden:
- `node --check` fuer beide Dateien OK
- `grep -c "^export" src/server.js` = 0
- Boot-Log-Zeile genau 1x
- Alte Routen aus server.js verschwunden (0 Treffer)
- 3 `router.post` im neuen Modul
- `invalidText`-Import in server.js = 0 Treffer (nur der L670-Kommentar bleibt)
- `git diff --stat src/server.js` = 19 insertions/42 deletions (Netto -23 Zeilen)
- Neue Datei korrekt als `??` erkannt

Phasen-Verifikationsset (`test/api-action-items-toggle.test.js`, `i6-write-scope.test.js`, `audit.test.js`, `tenant-settings-calendar-map.test.js`, `api.test.js`) = 57/57 gruen. Volle `npm test` (json-Default) = **2290/2290 gruen**, kein `p5-gate-proof`-Flake aufgetreten. `STORE_BACKEND=pg npm test` als globaler Env-Override schlaegt wie in den P1/P3/P4/P5-Vorlaeufer-Reports dokumentiert fehl (kein `DATABASE_URL`/erreichbares Postgres in der Sandbox) — reine Infra-Luecke, kein P8-Defekt; die ~20-30 dedizierten `*-pg.test.js`-Dateien mit eingebettetem pglite liefen im normalen `npm test`-Lauf bereits gruen mit (Teil der 2290/2290).

**Smoke-Test erfolgreich:** Server lokal gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, bootstrap-tenant fuer aktive Nummer), alle drei Routen per curl verifiziert:
- `POST /api/settings` -> 200 mit korrektem Settings-Body
- `POST /api/action-items/:id/toggle` mit unbekannter ID -> 404
- `POST /api/calendar` ohne Pflichtfelder -> 400 „title, start, end sind Pflicht"
- `POST /api/calendar` mit gueltigen Daten -> 200 mit Event

Kein neuer Test noetig (reiner Refactor, Charakterisierungsluecke laut Plan bereits durch Bestandssuite geschlossen) — SPEC-konform („Hoechstens EIN neuer Test", hier: null).

### Dateien

- Neu: `src/routes/api-tenant-write.js`
- Editiert: `src/server.js`

### Deviations

1. **D1** (im Plan begruendet, SPEC-konform): `config` aus der Dep-Liste gestrichen — die drei Handler lesen kein `config.*` (per grep verifiziert); ein injiziertes ungenutztes `config` waere ein G12-Verstoss. SPEC autorisiert dies explizit („Exakte Dep-Liste aus echtem Code ableiten").
2. **D2** (im Plan begruendet, G12-Pflicht): `invalidText`-Import aus server.js entfernt, da nach dem Move unbenutzt (einzige Nutzung war die verschobene `/api/calendar`-Route). Das neue Modul importiert `invalidText` selbst aus `_validation.js`.
3. `STORE_BACKEND=pg npm test` (globaler Env-Override) schlaegt in dieser Sandbox mit FATAL DB-Init-Fehler fehl (kein `DATABASE_URL`/erreichbares Postgres) — identisch zu den dokumentierten Befunden in den P1/P3/P4/P5-Reports, keine P8-Regression. Die tatsaechliche pg-Backend-Abdeckung laeuft ueber die ~20-30 dedizierten `*-pg.test.js`-Dateien mit eingebettetem pglite, die Teil des regulaeren `npm test` sind und dort gruen liefen.

### Clean-Code-Selbstcheck (Impl)

Reine Verschiebung (byte-identische Logik), keine Duplizierung neu eingefuehrt (G5): `invalidText` bleibt EINE Quelle in `_validation.js`. Factory-Signatur mit einem `deps`-Objekt (F1-konform, wie `makeReadRoutes`/`makeBillingRoutes`). Keine Magic Numbers ausser Bestand (0/1/-1 sowie unveraenderte HTTP-Status-Codes 400/403/404, die bereits im Original so standen). Kein toter/auskommentierter Code (C5/G9). G12: ungenutzter `invalidText`-Import in server.js entfernt. Kommentare Deutsch ohne Umlaute (per grep verifiziert, 0 Treffer). Eine Aufgabe pro Handler-Funktion (G30), Reihenfolge `requireTenant -> allowBooking -> Validierung` unveraendert (Safety-Invariante INV-9 erhalten). `server.js` bleibt export-frei (INV-10), Router einmal konstruiert+gemountet (INV-7), Mount-Reihenfolge/Boot-Log byte-identisch (INV-2/INV-6).

---

## 3. Safety-Urteil (final)

**verdict: APPROVED**

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**Concerns (nicht blockierend):**

1. SPEC-Beispiel-Verdrahtung nannte einen `config`-Dep; Impl laesst `config` weg. Korrekt, weil kein Handler `config` nutzt und die SPEC ausdruecklich „Exakte Dep-Liste aus echtem Code ableiten" vorschreibt. Kein Blocker.
2. Modul-Kommentar Zeile 11 sagt „wie in /api/calls" fuer `invalidText`; `/api/calls` in server.js nutzt `invalidText` tatsaechlich nicht direkt (nur E164/`_validation`). Rein kosmetisch ungenauer Kommentar, kein Funktionsdefekt.
3. „beide Backends" wird durch einen einzigen `npm test`-Lauf erfuellt (JSON-Default plus `*-pg.test.js`-Facade-Tests im Glob). Ein separater Voll-Suite-Lauf unter `STORE_BACKEND=pg` ist im Repo nicht konfiguriert; da P8 reine Route-Registrierung verschiebt und keine Store-Logik anfasst, ist das Backend-Verhalten orthogonal.

**independentTestSummary:** Voll `npm test` (JSON-Default + pg-Facade-Tests via pglite im `test/*.test.js`-Glob): 2290 pass / 0 fail. Gezielte P8-Tests (`api-action-items-toggle`, `i6-write-scope`, `audit`, `tenant-settings-calendar-map`, `api`): 57 pass / 0 fail. `node --check` gruen fuer beide Dateien. `grep -c '^export' src/server.js` = 0. Boot-Log-Zeile genau 1 Treffer unter `src/`. Kein isolierter Rot-Flake.

**Volltext-Verdict:** APPROVED. P8 ist eine saubere reine Verschiebung: drei tenant-scoped Schreib-Routen (`POST /api/settings`, `/api/action-items/:id/toggle`, `/api/calendar`) wandern byte-identisch in `src/routes/api-tenant-write.js` (`makeTenantWriteRoutes`-Factory, DI-Muster wie `makeReadRoutes`), gemountet an unveraenderter Position hinter dem Auth-Gate. Normalisierter Handler-Diff = identisch (einzige Abweichung sind leere Trennzeilen ohne Trailing-Whitespace). Reihenfolge `requireTenant -> allowBooking -> Validierung` exakt erhalten (403 vor 400). `invalidText`-Import-Entfernung aus server.js korrekt (einzige Nutzung war `/api/calendar`). INV-2/3/6/7/10 gehalten; `requireTenant`/`internalIdentity`/`OWNER_ID` sind die EINEN Wurzel-Instanzen. Nur 2 Dateien geaendert, keine npm-Deps, keine Testaenderungen, `claude.js`/`bridge.js` unberuehrt. Alle Tests gruen.

---

## 4. Clean-Code-Audit (final)

**verdict: PASS** — blocker: false

| Stufe | Findings |
|---|---|
| S1 | keine |
| S2 | keine |
| S3 | keine |
| S4 | keine |

**Volltext-Verdict:** Reine Verschiebung dreier tenant-scoped Schreib-Routen (`POST /api/settings`, `POST /api/action-items/:id/toggle`, `POST /api/calendar`) aus server.js nach `src/routes/api-tenant-write.js`. Diff-Vergleich bestaetigt: Handler-Body ist byte-identisch (nur Einrueckung/Router-Kontext geaendert), Reihenfolge `requireTenant -> allowBooking -> Validierung` exakt erhalten, Mount-Position unveraendert (nach `makeReadRoutes`, vor `makeProfileRoutes`), `requireTenant`/`internalIdentity`/`OWNER_ID`/`invalidText` bleiben Single-Source (injiziert bzw. re-importiert aus `_validation.js`, keine Duplikate). Keine S1/S2/S3/S4-Verstoesse gefunden. Volle Testsuite (2290/2290, inkl. `test/i6-write-scope.test.js`, `test/api-action-items-toggle.test.js`, `test/audit.test.js`, `test/profiles.test.js`, `test/f2-sms-opt-in-persist.test.js`, die genau diese drei Routen ueber echten Server-Boot treiben) laeuft gruen; `node --check` auf beiden Dateien sauber.

**passNotes:**
- G5 (Duplizierung): keine — `requireTenant`/`internalIdentity`/`OWNER_ID` werden injiziert (dieselbe Wurzel-Instanz wie in server.js), `invalidText` kommt weiterhin nur aus `_validation.js` (Import in server.js korrekt entfernt, da dort nicht mehr genutzt — verifiziert per grep, nur noch ein Kommentar referenziert es).
- DI-Muster (Router-Factory mit destrukturiertem Options-Objekt) ist identisch zu den bereits gemergten Schwester-Extraktionen (`makeReadRoutes`, `makeBillingRoutes`, `makeProfileRoutes`) — G24 (Konventionen) eingehalten.
- Modul-Kommentar in `api-tenant-write.js` benennt korrekt die Safety-Reihenfolge (403 vor 400) und die Audit-Konvention (nur Keys loggen, keine Freitext-Werte) — stimmt mit dem tatsaechlichen Code ueberein (kein C2/veralteter Kommentar).
- Keine Umlaute in Kommentaren (Projekt-Konvention eingehalten), keine toten Imports/Exporte, keine auskommentierten Codebloecke.
- Mount bleibt hinter der bestehenden `/api/*`-Basic-Auth, unveraenderte Position im Server — per Diff belegt, nicht neu verifiziert (ausserhalb des Diffs).

**topTodos (nicht blockierend):**
1. Ausserhalb dieses Diffs (byte-identisch aus master uebernommen): `POST /api/action-items/:id/toggle` ruft `requireTenant()` NICHT auf — jeder Basic-Auth-Aufrufer kann per ID ein Action-Item eines fremden Tenants togglen. War schon in master so, diese Phase aendert daran nichts (reine Verschiebung) — separates Ticket pruefen, nicht Teil von P8.
2. Optional (kein Muss): fuer diese Route-Gruppe existiert kein isolierter Parity-Unit-Test analog `test/api-read-parity.test.js` (dort motiviert durch ein konkretes PII-Leak-Risiko/streamToken). Bei P8 gibt es kein aequivalentes Leak-Risiko und die Integrationstests decken alle drei Routen bereits ab — daher optional, nicht S1.

---

## 5. Fix-Runden

Keine — Impl bestand Safety-Review und Clean-Code-Audit im ersten Anlauf (0 Blocker, 0 S1/S2-Findings).
