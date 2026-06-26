# Phase P0 — Tenant-Identitaet vereinheitlichen (Fix "Kein Tenant")

> **Gate: PASS** · **finalBranch: `phase/p0-tenant-identity`** (1 Commit, additiv, lokaler Merge nach `master` freigegeben — manual-push-Protokoll)
> Commit: `a56e06ba782ebefb3c8946dc9ed21e4771c570e4` · HEAD-Basis: `a56e06b` · Tests: 1011 pass / 0 fail (json + pglite) · Smoke: HTTP 200 (idp-gebundener Tenant), ungueltiges `idpSubject` → 400

## 1. Auftrag

Wurzel des "Kein Tenant"-Bugs beheben: Web-Login und MCP/REST mussten denselben Tenant-Record aufloesen. Der Fehler ist **datenmodell-seitig**, nicht auth-seitig — onboard-erzeugte Tenants trugen kein `idpSubject` und waren damit fuer `resolveTenant` (das auf `tenant.idpSubject` keyt) unsichtbar. Kleiner Blast-Radius (4 Quelldateien additiv), keine Aenderung an Auth-Mechanik, keine Tenant-Aktivierung (Aktivierung bleibt exklusiv P3).

## 2. Plan (gekuerzt)

**Designentscheidung (am echten Code gegroundet) — drei verifizierte Fakten:**

1. `resolveTenant(s, sub)` (`src/store/state-ops.js`, keyt auf `tenant.idpSubject`) ist **backend-agnostisch** — beide Backends (`json.js`, `pg.js`) delegieren an dieselbe state-ops-Funktion. Fix dort = Fix fuer beide Backends in EINER Stelle (G5).
2. `registerTenant` erzeugte `{id, status: ACTIVE}` + `applyOwnerIdentity`, setzte aber **kein `idpSubject`** → onboard-Tenants sind fuer `resolveTenant` unsichtbar (= Wurzel "MCP findet nichts").
3. Das `t_${sub}`-ID-Schema war **hartcodiert** in `web-auth.js` (`upsertOnFirstLogin`, einzige Stelle). Damit derselbe `sub` denselben Record adressiert, muss diese Ableitung EINE geteilte Quelle werden (G5/G22).

**Kern des Fix (vier Dateien, additiv):**

- Kanonische ID-Ableitung `tenantIdForSubject(sub)` als EINE Quelle in `defaults.js` (benannte Konstante `TENANT_ID_PREFIX = "t_"`); `web-auth.js` nutzt sie (verhaltens-erhaltender Refactor — `tenantIdForSubject("u1") === "t_u1"`).
- `registerTenant` wird idp-aware: `idpSubject` **set-on-create**; auf einem bereits existierenden Record nur **set-if-absent / complete-if-absent** (fehlende Identitaetsfelder ergaenzen) — **Status bleibt unangetastet** (P0 aktiviert nicht, Invariante 5). `normalizePrivateNumber` validiert in BEIDEN Zweigen VOR jeder Mutation (fail-closed, kein halb gebundener Record).
- `/api/onboard`: gesetztes `idpSubject` (WorkOS sub) ist die Identitaet → kanonische `tenantId` deterministisch daraus, Record wird idp-gebunden. Ohne `idpSubject` = Owner-/Operator-Pfad byte-identisch (Rueckwaerts-Kompat zu allen Bestandstests). Gesetztes-aber-ungueltiges `idpSubject` → 400 (kein stiller Owner-Fallback).

**Was NICHT geaendert wird (bewusst):** `resolveTenant`/`requireTenant`/`TENANT_REJECT`/403-Pfad (fail-closed, unveraendert); `upsertOnFirstLogin`-Status (`suspended`) und `registerTenant`-Create-Status (`active`); `pg.js`/`schema.sql`/`json.js` (kein Edit — `idpSubject` round-trippt bereits ueber Hydrierung + `flushTenants`, Spalte `idp_subject` existiert); Auth-Middleware, `redirect_uri`, Domains, Dashboard.

**Residuum (bewusst ausserhalb P0):** Der `pg`-Store haelt einen In-Memory-Spiegel, der nur bei `init()` hydriert; `upsertOnFirstLogin` schreibt ueber den separaten `portalRunner`-Pool direkt in die DB. Ein reiner "login-only, nie onboarded"-Tenant ist fuer MCP-`resolveTenant` daher erst nach Reboot sichtbar. P0 verdrahtet keinen Kunden-Signup→onboard-Caller (`grep` bestaetigt: kein Frontend-Caller von `/api/onboard`), daher wird der Cross-Pool-Pfad heute nicht ausgeloest. Empfehlung: Folge-Phase vor/mit P3 (auth-angrenzend, groesserer Blast-Radius).

## 3. Implementierung — Zusammenfassung

P0 exakt gemaess Plan umgesetzt (4 Quelldateien additiv, 1 neue + 1 ergaenzte Testdatei):

- **`src/store/defaults.js`** — neue Konstante `TENANT_ID_PREFIX = "t_"` + exportierte `tenantIdForSubject(sub)` als EINE kanonische ID-Quelle.
- **`src/store/state-ops.js`** — `registerTenant` idp-aware: set-on-create bindet `idpSubject`; auf bestehendem Record set-if-absent (ergaenzt nur fehlende `ownerName`/`privateNumber`/`idpSubject`), Status NIE angefasst. `normalizePrivateNumber` validiert in beiden Zweigen vor jeder Mutation.
- **`src/web-auth.js`** — `upsertOnFirstLogin` von hartcodiertem `t_${sub}` auf `tenantIdForSubject(sub)` umgestellt (verhaltens-erhaltend, identischer Wert).
- **`src/server.js`** — `/api/onboard` bindet bei gesetztem `idpSubject` deterministisch an `tenantIdForSubject(sub)`; ungueltiges `idpSubject` → 400; ohne `idpSubject` byte-identischer Owner-Pfad.

**Kernergebnis (deterministisch getestet, json UND pglite):** nach `registerTenant(s, tenantIdForSubject(sub), { idpSubject: sub })` gilt `resolveTenant(s, sub) === tenantIdForSubject(sub)` — Web-Login-Pfad (`t_<sub>`) und MCP/REST-Pfad (`req.auth.sub`) loesen denselben Tenant auf.

**Verifikation:** `node --check` gruen auf allen 6 Dateien · volle Suite `1011 pass / 0 fail` (json + pglite) · manueller End-to-End-Smoke (json-Store, Port 4071, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `MULTI_TENANT=true`, geseedete aktive Owner-Nummer): `POST /api/onboard {idpSubject:"sub-smoke",firstName:"Smokey"}` → HTTP 200, Response `tenantId "t_sub-smoke"`, persistierter Tenant traegt `idpSubject="sub-smoke"`; `POST /api/onboard {idpSubject:"  "}` → HTTP 400 (fail-closed); kein zweiter (email-artiger) Record.

**Dateien:**

- geaendert: `src/store/defaults.js`, `src/store/state-ops.js`, `src/web-auth.js`, `src/server.js`, `test/onboarding-identity.test.js`
- neu: `test/p0-tenant-identity.test.js`

**Tests (neu/ergaenzt):**

- `test/p0-tenant-identity.test.js` (neu): json set-on-create bindet `idpSubject` · pglite `idp_subject` Round-Trip (flush+hydrate, real ausgefuehrt, ~748ms, nicht skipped) · complete-if-absent auf gebundenem Record (Status bleibt `suspended`) · set-if-absent ueberschreibt bestehende Identitaet NICHT · `tenantIdForSubject` deterministisch.
- `test/onboarding-identity.test.js` (ergaenzt): `POST /api/onboard` mit `idpSubject` → genau ein idp-gebundener Tenant `t_<sub>`; Whitespace-`idpSubject` → 400; Bestandsfall (`{tenantId}` ohne `idpSubject`) unveraendert gruen.

**Deviations:**

1. **Keine inhaltliche Abweichung vom Plan.** Transparenz-Hinweis Tooling: der `npm test`-Wrapper beendet sich in der Sandbox mit Exit 194 ohne Test-Output (reines Wrapper/Umgebungs-Artefakt). Das exakte Script-Kommando `NODE_ENV=test node --test "test/*.test.js"` direkt ausgefuehrt liefert Exit 0 / 1011 pass / 0 fail — massgeblicher Gate ist gruen.
2. **Plan-§6-Residuum** (bewusst, dokumentiert): pg-In-Memory-Spiegel hydriert nur bei `init()`; reiner login-only-nie-onboarded-Tenant erst nach Reboot fuer MCP sichtbar. In P0 nicht ausgeloest (kein Signup→onboard-Caller); empfohlen als Folge-Phase vor/mit P3.
3. **Identitaetsquelle** (Safety-Concern, nicht-blockierend): Spec-Vorzugsansatz nannte `req.auth.sub`; Implementierung nimmt `idpSubject` aus dem Request-Body. Begruendung im Code-Kommentar: `/api/onboard` liegt hinter globaler Admin-Basic-Auth (oder localhost), nicht hinter OIDC → es gibt keinen `req.auth.sub` auf diesem Request; Caller ist der vertrauenswuerdige Owner/Operator; `idpSubject` wird via `validIdentity` fail-closed geprueft. Spec erlaubt begruendete Abweichung.

## 4. Safety-Urteil — APPROVED

Unabhaengiger Lauf in frischem Worktree (Branch `review-p0` von `phase/p0-tenant-identity`, `node_modules` auf Main-Worktree gelinkt).

| Check | Ergebnis |
|---|---|
| Tests laufen unabhaengig | PASS — volle Suite 1011/1011/0 (NODE_ENV=test, beide Backends in einem Lauf; pglite in-memory via `@electric-sql/pglite`, kein Netz/keine .env). Isolierte P0-Files 10/10 pass, pglite flush+hydrate Round-Trip real (748ms, nicht skipped). |
| Safety-Gates intakt | PASS — Allowlist/Denylist/Land-Gate/Stundenlimit/Budget/Max-Dauer + Twilio-HMAC/Telnyx-Ed25519 unberuehrt; kein neuer Endpunkt |
| Disclosure intakt | PASS — `disclosureSentence`-Quellen (`claude.js`/`bridge.js`) nicht im Diff |
| Auth fail-closed | PASS — `resolveTenant`/`_tenant.js`/403-Pfad unveraendert; ungueltiges `idpSubject` → 400 (kein stiller Owner-Fallback); `safeEqual` unangetastet |
| Keine Secrets geleakt | PASS — `sub` ist opake IdP-User-Id (kein Token, bereits heute Teil von Tenant-IDs/`req.auth.sub`/Audit); generische Fehlertexte; keine neue Roh-`sub`-Logzeile |
| Verhalten wie beabsichtigt | PASS — set-/complete-if-absent setzt `idp_subject` in beiden Backends, ohne Status/bestehende Felder zu ueberschreiben (Aktivierung bleibt P3); reiner Neuanlage-Pfad ohne `idpSubject` byte-identisch |
| Scope eingehalten | PASS — 1 Commit, 4 src + 2 test Files, keine neue npm-Dependency (`package.json`/lock unveraendert), kein neuer Endpunkt |

**Verdict:** APPROVED. `tenantIdForSubject` als EINE Quelle (G5/G25, benannte Konstante `t_`) konsolidiert Web-Login (`upsertOnFirstLogin`) und `/api/onboard` auf dieselbe kanonische Tenant-ID → Fix "Kein Tenant". Freigabe zum lokalen Merge nach `master`.

**Concerns (kein Blocker):**

1. Identitaetsquelle `idpSubject` (Body) statt `req.auth.sub` — siehe Deviation 3; fail-closed via `validIdentity`, Caller vertrauenswuerdig, Begruendung im Code.
2. Kein expliziter Automated-Test fuer Spec-AC3 (MCP-Identitaet ohne Tenant → `TENANT_REJECT`, NICHT owner/bootstrap). Nicht-blockierend: `resolveTenant`/`src/routes/_tenant.js` nicht im Diff, durch Bestands-Tests gedeckt, Invariante haelt by construction. Dedizierter P0-Regressionstest waere ideal gewesen.
3. `registerTenant` fuer existierende Records nicht mehr byte-identisch zu `master` (frueher sofortiger no-op return; jetzt complete-if-absent). Bewusst & spec-konform (Invariante 2 fortschreiben, Invariante 5 keine Aktivierung): NIE Overwrite, Status nie geaendert. Via HTTP-Route kein neues Fehler-Surface (Route validiert `privateNumber` vor dem Lock).

## 5. Clean-Code-Audit — PASS (kein Blocker)

| Severity | Findings |
|---|---|
| **S1 (Blocker)** | keine |
| **S2 (Blocker)** | keine |
| **S3 (sollte)** | **S3-1** (minor, optional) · `src/server.js:1297-1303` (`/api/onboard`) · G16/G26 — `idpSubject` wird von `validIdentity` bis 254 Zeichen erlaubt; `tenantIdForSubject` prependet `t_` → bis 256 Zeichen → faellt erst am naechsten `validIdentity(tenantId)`-Check durch und liefert die irrefuehrende Meldung "tenantId ist Pflicht (...)" statt eines `idpSubject`-Fehlers. Verhalten ist fail-closed (kein Security-/Korrektheits-Issue), nur Diagnose-Klarheit. Fix (optional): `idpSubject` gegen `IDENTITY_MAX_LEN - 2` pruefen bzw. eigene Fehlermeldung. Rein theoretischer Edge (reale WorkOS-subs ~30 Zeichen). |
| **S4 (nice)** | keine |

**Verdict:** PASS — keine S1/S2-Verstoesse. Sauberer, gut getesteter Diff (1011/1011 gruen, inkl. pglite-Round-Trip). Ein optionaler S3-Kleinkram-Hinweis (irrefuehrende 400-Meldung bei >252-Zeichen-`idpSubject`), nicht merge-blockierend.

**Pass-Notes:** G5/G25 vorbildlich — `tenantIdForSubject` + `TENANT_ID_PREFIX` zentralisieren die zuvor in `web-auth.js` inline verstreute `t_${sub}`-Ableitung → EINE Quelle fuer Web-Login UND idp-gebundenen Onboard-Pfad, Drift ausgeschlossen (Diff REDUZIERT Duplizierung). Fail-closed durchgaengig: ungueltiges `idpSubject` → 400; `normalizePrivateNumber` wandert in `registerTenant` VOR jede Mutation (validate-before-mutate). set-if-absent/complete-if-absent ueberschreibt bestehende Identitaet/Status NIE (P0 aktiviert bewusst NICHT; Aktivierung = P3) — exakt so getestet. Tests vollstaendig: ops-Ebene (json) + Fassaden-Round-Trip (pglite flush+hydrate von `idp_subject`) + Route-Ebene (Server-Spawn). Namen klar (`bodyTenantId`/`sub`/`idpSubject`), keine Magic Strings, kein toter/auskommentierter Code, kein Secret-/PII-Leak, kein Safety-Gate beruehrt. Argument-Anzahl ok (ein Options-Objekt, neuer Key `idpSubject` optional → F1), Funktionslaenge unkritisch (`registerTenant` < 30 Zeilen, Tiefe ≤ 2). ESM, kein Build-Step, kein TypeScript.

## 6. Fix-Runden

Keine. Beide Reviewer (Safety + Clean-Code) gaben in **Runde 1** APPROVED / PASS ohne Blocker. Der S3-Finding ist explizit nicht-blockierend dokumentiert und als optionale Folge-Aufraeumung offen gelassen (kein Code in diesem Bericht-Task geaendert).

**Offene Top-Todos (optional, Folge-Ticket):**

1. Mergebar wie vorliegend — keine blockierenden To-dos.
2. Optional (S3): `idpSubject`-Laenge gegen `IDENTITY_MAX_LEN - len("t_")` pruefen bzw. eigene Fehlermeldung, damit ein ueberlanger `sub` nicht die irrefuehrende "tenantId ist Pflicht"-400 ausloest.
3. Folge-Phase vor/mit P3 (Residuum, §2): pg-Spiegel-Staleness fuer login-only-Tenants aufloesen (`store.resolveTenant` im pg-Pfad gegen die DB ODER Onboard/Login auf EINE Schreibquelle ziehen); Tenant-Aktivierung gehoert exklusiv an den Stripe-Webhook (P3-Vorbedingung).

## 7. Blast-Radius & Live-Schalten

- **Geaendert:** `src/store/defaults.js`, `src/store/state-ops.js`, `src/web-auth.js`, `src/server.js`, `test/onboarding-identity.test.js`. **Neu:** `test/p0-tenant-identity.test.js`. **Unberuehrt:** `pg.js`/`schema.sql`/`json.js`, alle Gates/Auth/Disclosure/Secrets, `resolveTenant`/`_tenant.js`/403-Pfad, Auth-Middleware, Dashboard, `render.yaml`, `.env.example`. Null neue npm-Dependency, kein neuer Endpunkt.
- **Pre-Mortem (ein Jahr spaeter, es ging schief):** (1) "MCP findet Tenant nach Live-Login trotzdem nicht" → pg-Spiegel-Staleness, in P0 nicht abgedeckt (kanonischer Onboard-Pfad schreibt durch die Fassade; login-only bleibt bis Reboot offen) → Folge-Phase. (2) "Onboard aktiviert suspendierten Kunden ungewollt" → existing-Zweig fasst Status NIE an; gefaehrlicher Cross-Pool-Pfad in P0 nicht verdrahtet; als P3-Vorbedingung dokumentiert. (3) "Zweiter Record entsteht doch" → verhindert: bei gesetztem `idpSubject` ist die `tenantId` deterministisch → idempotenter `registerTenant`-Treffer.
- **Live-Schalten:** merge `phase/p0-tenant-identity` → `master` + Render-Deploy des **Gateway**-Service `vodafone-agent`. **Aktuell NICHT gepusht** (manual-push-Protokoll). `node_modules`-Symlink des Worktrees NICHT committed.
