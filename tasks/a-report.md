# Phase A — Cap-Zaehlung robust + Skip sichtbar machen

**Gate:** PASS
**finalBranch:** `phase/a-cap-fix-fix1`

## Plan (gekuerzt)

**0. Korrektur der Root-Cause-Annahme:** `PLAN-PROVISIONING-CAP.md` unterstellte, `liveNumbers` zaehle vermutlich auch tote/Test-Nummern mit — nie verifiziert. Code-Lektuere (state-ops.js, defaults.js, onboarding.js, billing/webhook.js) zeigt: es gibt keine sicher ausschliessbare "tote Nummer"-Kategorie, ohne Invariante "im Zweifel mitzaehlen" zu verletzen. `RELEASED`/`FAILED` sind bereits ausgeschlossen (terminal); alle anderen Zustaende sind entweder laufender Kaufversuch oder real gemietete, kostenpflichtige Nummer. Gefundene, bewusst NICHT gefixte Nebenbaustelle: `applyStripeWebhook` setzt bei Kuendigung nur `status="suspended"`, die Nummer bleibt `active` (Cap+Kosten laufen weiter) — eigener Bug, ausserhalb Scope.

**Konsequenz:** "Zaehlung" wird zur Haertung ohne Verhaltensaenderung (A-1: benannte Bedingung + Regressionstest). Der eigentliche Wert liegt in **Sichtbarkeit** (A-2): ein `global_cap`-Skip erzeugte bisher kein Signal ausserhalb des Audit-Logs.

**A-1 — `liveNumbers` (state-ops.js):** doppelte Negation inline durch benanntes Praedikat `occupiesCapacity(number)` ersetzt (reiner Refactor, 0 Verhaltensaenderung), abgesichert durch Regressionstest (RELEASED/FAILED belegen keine Kapazitaet).

**A-2 — Skip sichtbar machen (Fix B):**
- Neue Konstante `GLOBAL_CAP_REASON = "global_cap"` in `defaults.js`.
- `requestNumber` (state-ops.js) hinterlaesst bei global_cap einen Skip-Marker am Tenant (`numberProvisionSkipReason`/`-At`) via neue private Helfer `markNumberProvisionSkipped`/`clearNumberProvisionSkip`; Marker wird bei erfolgreichem Folge-Request geloescht (Invariante: recoverabler Status).
- `numberStatusFor` (views.js) bekommt neuen Anzeige-Status `"blocked"`, Prioritaet ACTIVE > PROVISIONING > REQUESTED > BLOCKED > NONE — eine echte Nummer ueberlagert den Marker strukturell immer.
- `server.js`: beide Aufrufer von `requestNumber` (`/api/onboard`, `triggerTenantProvisioning`) persistieren den Skip jetzt auch im `reason===GLOBAL_CAP_REASON`-Fall (vorher nur bei `r.ok`) — sonst verschwindet der Marker beim naechsten `store.load()`.
- Postgres: additive nullable Spalten `number_provision_skip_reason`/`number_provision_skip_at` in `schema.sql`, synchron in `pg.js` (`TENANT_COLUMNS`, `rowToTenant`, `flushTenants`). JSON-Backend braucht keine Aenderung (volles `JSON.stringify`).
- UI-Rendering von `numberStatus` bewusst ausserhalb des Scopes (weder `tenant.html` noch `index.html` rendern das Feld heute ueberhaupt — vorbestehende Luecke, nicht durch diese Phase verursacht).

**Deterministisches Ergebnis:** `npm test` gruen inkl. 3 neuer state-ops/views-Tests + erweitertem BK3-T3b + neuem pg-Roundtrip-Test; Syntax-Gate `node --check` auf allen 5 Prod-Dateien. Blast-Radius: 6 bestehende Dateien editiert, 0 neue Dateien/Dependencies/Endpunkte, keine Aenderung an Safety-Gates/Disclosure/Auth.

## Implementierung — Zusammenfassung

Umgesetzt exakt gemaess Plan auf Branch `phase/a-cap-fix` (von master), finaler Commit `a47ff12a15d94f85a597dc79680bda97c656bf0e`.

- **A-1:** `occupiesCapacity(number)` in `src/store/state-ops.js` extrahiert (reiner Refactor), Regressionstest ergaenzt.
- **A-2/Fix B:** `GLOBAL_CAP_REASON` in `defaults.js`; `requestNumber` setzt/loescht Skip-Marker via `markNumberProvisionSkipped`/`clearNumberProvisionSkip`; `numberStatusFor` liefert neuen Status `"blocked"`; `server.js` persistiert den Skip an beiden Call-Sites explizit auch im Skip-Fall; `pg.js` + `schema.sql` um zwei additive nullable Tenant-Spalten erweitert, `TENANT_COLUMNS`/`rowToTenant`/`flushTenants` synchron gehalten.
- 6 neue Tests (node --check + `npm test` gruen, **1470 pass / 0 fail**, Delta +6 zum master-Stand: 1262 → 1268 `test()`-Calls).
- Smoke-Test live durchgefuehrt: Server lokal (PORT=3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `MAX_NUMBERS=0`), `POST /api/onboard` → HTTP 429 `{"error":"Nummer-Anfrage abgelehnt (global_cap)"}` (byte-identisch zum Bestand); `data/store.json` zeigt persistierten `numberProvisionSkipReason=global_cap` + Zeitstempel fuer geblockte Tenants.
- `node_modules`-Symlink vor Commit entfernt, working tree clean. Keine Aenderung an Safety-Gates/Disclosure/Auth, 0 neue Dependencies, 0 neue Endpunkte.

**headCommit (Impl):** `a47ff12a15d94f85a597dc79680bda97c656bf0e`
**nodeCheckPass:** true · **testsPass:** true · **testPassCount:** 1470 · **testFailCount:** 0 · **committed:** true

**Files edited:** `src/store/defaults.js`, `src/store/state-ops.js`, `src/store/views.js`, `src/server.js`, `src/db/schema.sql`, `src/store/pg.js`, `test/number-lifecycle.test.js`, `test/bk3-auto-provision.test.js`, `test/number-status-view.test.js`, `test/store-pg.test.js`
**Files created:** keine

**Tests added/changed:**
- `test/number-lifecycle.test.js`: liveNumbers/requestNumber RELEASED/FAILED-Regressionstest (A-1)
- `test/number-lifecycle.test.js`: requestNumber global_cap setzt Skip-Marker (Fix B)
- `test/number-lifecycle.test.js`: Skip-Marker verschwindet bei erfolgreichem Folge-Request (Invariante 3)
- `test/bk3-auto-provision.test.js`: BK3-T3b um Skip-Marker-Assertion erweitert (Webhook-Pfad)
- `test/number-status-view.test.js`: numberStatusFor globaler Cap-Skip → "blocked"
- `test/number-status-view.test.js`: spaeter aktive Nummer ueberlagert Skip-Marker
- `test/store-pg.test.js`: numberProvisionSkipReason/-At ueberleben store.save()+Re-Hydrierung (pg)

**Deviations:** keine.

## Safety-Urteil (final)

**Verdict: APPROVED**

- `testsPassIndependently`: true — `npm test` unabhaengig im Review-Worktree (`review-a-r1`, HEAD=688d642, node_modules symlinked auf Hauptrepo) erneut ausgefuehrt: **1471/1471 gruen, 0 fail**, ~98.6s. `store-pg.test.js` separat: 28/28 gruen, inkl. neuem Persistenz-Test. `node --check` auf allen 9 geaenderten `.js`-Dateien fehlerfrei. Keine `.only`/`.skip`.
- `safetyGatesIntact`: true · `disclosureIntact`: true · `authFailClosedIntact`: true · `noSecretsLeaked`: true · `scopeRespected`: true · `behaviorAsIntended`: true.
- Scope strikt eingehalten: nur `state-ops.js`/`defaults.js`/`pg.js`/`views.js`, `schema.sql`, `server.js` (Import-Wire) + 4 Testdateien. Keine neue npm-Dependency, keine Aenderung an `claude.js`/`bridge.js` (Disclosure unangetastet), keine Aenderung an `auth.js`/`web-auth.js`/`middleware.js` (Auth fail-closed unangetastet).
- Fix A (`occupiesCapacity`) verifiziert als reiner Namens-Refactor, 0 Verhaltensaenderung, per Regressionstest abgesichert.
- Fix B (Skip-Marker) verifiziert als reine Observability: kein Trigger, kein Retry, kein Cap-Bypass. `numberStatusFor` priorisiert ACTIVE/PROVISIONING/REQUESTED strikt vor BLOCKED — eine echte Nummer ueberlagert den Marker immer (getestet). Kein Cross-Tenant-Leak: alle `numberStatusFor`-Caller nutzen ausschliesslich die authentifizierte eigene `tenantId`; rohe Skip-Felder werden nirgends direkt in API-Responses gespiegelt (nur der abgeleitete `"blocked"`-String).
- pg.js: neue Spalten korrekt in `TENANT_COLUMNS`, INSERT, ON-CONFLICT-UPDATE und `rowToTenant` verdrahtet, per eigenem Round-Trip-Test bestaetigt.
- Review-Runde-1-Blocker (G5/S2 Code-Duplikation) sauber behoben via `shouldPersistProvisionResult`, an beiden Call-Sites (`/api/onboard` + `triggerTenantProvisioning`) verwendet und getestet.

**Concerns (kosmetisch, kein Blocker):** `clearNumberProvisionSkip()` setzt `numberProvisionSkipReason`/`-At` bei jedem erfolgreichen `requestNumber` auf `null`, auch fuer Tenants ohne je einen Skip — fuegt 2 zusaetzliche null-wertige Keys zum Tenant-Record hinzu, wo vorher keine existierten. Funktional folgenlos (`numberStatusFor` prueft explizit `=== GLOBAL_CAP_REASON`, `null`/`undefined` verhalten sich identisch), aber nicht byte-identisch auf Storage-Ebene fuer Tenants ausserhalb des Cap-Skip-Pfads.

**Blockers:** keine.

## Clean-Code-Audit (final)

**Verdict: PASS** — S1-S4: keine Findings, `blocker: false`.

Branch `phase/a-cap-fix-fix1`, 10 Dateien, +202/-17. Vollstaendiger `node:test`-Lauf im isolierten Worktree: 1470 pass, 1 fail (`read-scope-tenant.test.js:173`, `ECONNREFUSED`/fetch-failed) — isoliert erneut ausgefuehrt: 4/4 gruen → Netzwerk-Flake der Test-Infra, kein Zusammenhang mit dem Diff (Datei ausserhalb des Scopes). `node --check` auf allen 5 geaenderten Prod-Dateien: OK.

**PassNotes:**
- Diff ist primaer Duplizierungs-Reduktion (G5): `shouldPersistProvisionResult()` ersetzt die woertlich duplizierte `if (r.ok) store.save()`-Logik an beiden Call-Sites durch eine Quelle in `defaults.js`.
- `occupiesCapacity()` extrahiert das De-Morgan-invertierte RELEASED/FAILED-Praedikat aus `liveNumbers()` als benannte Zwischenvariable (G28/G33, vermeidet doppelte Negation).
- Alle neuen Funktionen (`markNumberProvisionSkipped`, `clearNumberProvisionSkip`, `occupiesCapacity`, `shouldPersistProvisionResult`) klein, 1 Zweck, sprechende Namen (P2/N1).
- Kein Zyklus: `views.js` importiert neu `findTenant` aus `state-ops.js`, `state-ops.js` importiert NICHT zurueck aus `views.js`.
- DB-Migration folgt exakt dem etablierten Muster (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, kein CHECK, `TEXT` fuer app-generierte ISO-Timestamps — konsistent mit Bestand wie `started_at`/`answered_at`/`assigned_at`/`released_at`, nicht `TIMESTAMPTZ` wie bei DB-verwalteten `created_at`).
- Jede neue Verhaltensaenderung hat einen Test (Skip setzen/loeschen, `"blocked"`-Display + Ueberlagerung, Webhook-Pfad-Sichtbarkeit, pg-Persistenz-Roundtrip, Regressions-Lock fuer unveraenderte RELEASED/FAILED-Ausklammerung).
- Kommentare erklaeren WARUM (Invarianten aus `PLAN-PROVISIONING-CAP.md`), kein Redundanz-/Ueberholt-Kommentar. Kein toter/auskommentierter Code, keine Magic Numbers, keine abgeschalteten Sicherungen.

**Top-Todos:**
1. Keine Blocker offen — Phase A ist mergefaehig.
2. Der eine fehlgeschlagene Test (`read-scope-tenant.test.js`, `ECONNREFUSED`) sollte als Flake im Testlauf beobachtet werden (isoliert 4/4 gruen) — kein Fix-Bedarf in diesem Diff, aber im Auge behalten falls er in CI wiederkehrt.

## Fix-Runden

**r1:** Branch `phase/a-cap-fix-fix1` (von `phase/a-cap-fix`) erstellt, um den Review-Runde-1-Blocker (G5/S2 Code-Duplikation bei der `if (r.ok) store.save()`-Logik an beiden Call-Sites) zu beheben — geloest via zentraler `shouldPersistProvisionResult()`-Funktion, an `/api/onboard` und `triggerTenantProvisioning` verwendet und getestet.

`node_modules`-Symlink-Notiz: der literale Befehl `ln -s "./node_modules" node_modules` waere selbst-referenziell gewesen (Worktree liegt unter `.claude/worktrees/<name>/`, nicht direkt im Repo-Root) — stattdessen `ln -s "../../../node_modules"` verwendet, um korrekt auf das Hauptrepo-`node_modules` zu verweisen.
