# Server-Slim Phase P14 — Report

**Ziel:** `src/wiring/auth-gate.js` (`makeAuthGate`) extrahieren — das inline Basic-Auth-Gate fuer Dashboard + Owner-Legacy-API (Kern-Safety-Naht, `server.js` L326-375) als eigenstaendig unit-testbare Middleware-Factory
**Gate:** PASS
**finalBranch:** `phase/slim-p14-auth-gate`
**headCommit (Impl):** `7db23c258983d360b430a32bc65e27c352465ee3`

---

## 1. Plan (gekuerzt)

### Verifizierter Ist-Stand

`src/server.js` war zu Phasenbeginn **673 Zeilen** (nicht 2244 — P0-P13 bereits gemerged, HEAD `e120797`). `git diff --stat master -- src/server.js` = leer, d.h. Arbeitsbaum-`server.js` == `master`. Das Basic-Auth-Gate steht **nicht** bei der im Plan-Doc rottenden Zeilenangabe L494-543, sondern real als inline-Middleware bei **L326-375**, unmittelbar gefolgt von `app.use(express.static(config.publicDir));` (L376).

Das Gate liest exakt: `config.dashboardPassword`, `config.selfServiceEnabled`, `config.multiTenant`, `CUSTOMER_PORTAL_PATH` (server-lokale const, L192), `STRIPE_WEBHOOK_PATH` (server-lokale const, L203), `BRAND_ASSETS_PREFIX` (Import aus `mcp-server-info.js`), `isTrustedLocalCaller` (Import aus `request-tenant.js`, real definiert in `routes/_tenant.js:44`), `safeEqual` (Import aus `util.js`), `audit` (Import), plus das Node-Global `Buffer`. Die Dep-Liste deckt sich 1:1 mit der Spec. Die Exemption-Reihenfolge im echten Code entspricht INV-3 (mit `!config.dashboardPassword` als allererster Enabling-Vorbedingung). Kein bestehender Test greift den Gate-Block in `server.js` per grep an; `test/oauth.test.js` (`WWW-Authenticate`) betrifft `/mcp`-OAuth, fremd (`/mcp` ist Gate-exempt) — keine mechanische Test-Anpassung noetig. `src/wiring/auth-gate.js` und `test/auth-gate*.test.js` existierten noch nicht (kollisionsfrei).

**DIP-Konsequenz (kein G12):** alle vier Kollaboratoren (`audit`, `safeEqual`, `isTrustedLocalCaller`, `BRAND_ASSETS_PREFIX`) werden laut Spec **injiziert**, nicht vom neuen Modul importiert — `server.js` importiert sie weiter und reicht sie in `makeAuthGate(...)` durch, keine verwaisten Imports (`isTrustedLocalCaller` wird ohnehin weiter im Rate-Limit-Skip genutzt).

### (1) Neue Datei `src/wiring/auth-gate.js` (~65 LOC)

Signatur exakt laut Spec:

```js
export function makeAuthGate({
  config, audit, isTrustedLocalCaller, safeEqual, BRAND_ASSETS_PREFIX,
  paths: { STRIPE_WEBHOOK_PATH, CUSTOMER_PORTAL_PATH },
}) { /* returns (req, res, next) => {...} */ }
```

Kopfkommentar im Stil von `web-login.js`, danach eine `makeAuthGate`-Factory, die die **byte-identisch** aus L326-375 uebernommene Arrow-Middleware zurueckgibt. Keine Imports im neuen Modul (alles injiziert; `Buffer` ist Node-Global). Keine Logik-Aenderung, kein Split, kein Dedup, keine neue Konstante.

Bewusste Nicht-Aenderungen (im Plan vorab begruendet, damit der Auditor sie nicht als "Verbesserung" flaggt): die Einmal-Literale (`'Basic realm="Hermes"'`, `"admin:"`, `"Basic "`, `"auth_failed"`, `"Auth required"`, `"/healthz"`, `"/favicon.ico"`, `"/voice"`, `"/mcp"`, `"/.well-known"`) bleiben verbatim — single-use, selbsterklaerend am Verwendungsort, kein G25; zu Konstanten heben waere Scope-Creep gegen "reine Verschiebung". Die vier Safety-Rationale-Kommentarbloecke (Stripe-Exempt, T3-Icon, Favicon, `isTrustedLocalCaller`) wandern **mit** dem Code, keine `Datei:Zeile`-Referenzen (kein C2).

### (2) Edits an `src/server.js` (2 Edits)

- **Edit A:** Import `makeAuthGate` aus `./wiring/auth-gate.js` ergaenzt (nach dem `web-login.js`-Import).
- **Edit B:** der gesamte Inline-Gate-Block (L326-375) durch einen `app.use(makeAuthGate({...}))`-Mount ersetzt, mit neuem Section-Kommentar (Mount-Position/INV-2/INV-3/INV-1). `app.use(express.static(config.publicDir));` direkt darunter bleibt unveraendert. Der bestehende Section-Header-Kommentar oberhalb `/healthz` (~L219-223) bleibt unangetastet.

Netto laut Plan-Schaetzung: ~50 Zeilen raus, ~21 rein — Netto-Reduktion in `server.js`. Keine Import-Entfernung (alle 4 injizierten Symbole weiter genutzt).

### (3) Neue Test-Datei `test/auth-gate-exemption-order.test.js`

Offline In-Process-Middleware-Test (Muster `outbound-gates-order.test.js` + `auth-mcp-bypass.test.js`), kein Spawn/DB/Netz. Importiert das **echte** `safeEqual` aus `util.js` und `BRAND_ASSETS_PREFIX` aus `mcp-server-info.js`; die zwei server-lokalen Pfade (`STRIPE_WEBHOOK_PATH`, `CUSTOMER_PORTAL_PATH`) werden als injizierte Werte hartkodiert (wie `server.js` sie hereinreicht). Friert INV-3 ein:

- **Unbedingte Exemptions** (`/voice`, `/voice/incoming`, `/mcp`, `/mcp/x`, `/.well-known/oauth-authorization-server`, `STRIPE_WEBHOOK_PATH`, `/healthz`, `BRAND_ASSETS_PREFIX+"hermes-icon.png"`, `/favicon.ico`) → je `next()`, kein 401.
- **Gegenprobe geschuetzter Pfade** (`/api/state`, `/api/calls`, `/`, `/index.html`, `/tenant.html`) → 401, kein `next()`, Audit-Event `auth_failed`.
- **Flag-Gate `CUSTOMER_PORTAL_PATH`**: beide Flags AN → `next()`; nur ein Flag → 401 (Schnittmenge, kein OR).
- **Gate deaktiviert** (`dashboardPassword:""`) → jeder Pfad → `next()`.
- **`isTrustedLocalCaller`-Bypass** → `/api/state` mit stub-`true` → `next()` ohne Credentials.
- **Credential-Pfad + 401-Shape**: korrekte Basic-Auth → `next()`; falsche/fehlende → 401, `WWW-Authenticate: Basic realm="Hermes"`, `audit("auth_failed", ..., "path=/api/state")`, kein Secret im Audit-Detail.

"Hoechstens EIN neuer Test" = eine neue Datei (mehrere `test()`-Faelle darin konform, wie `outbound-gates-order.test.js`-Praezedenz). Bestehende Spawn-Tests (`security`, `single-origin-serving`, `mcp-server-icon`, `rate-limit`, `profiles`, `headers`, `auth-mcp-bypass`) bleiben unveraendert.

### (4) Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

```
node --check src/wiring/auth-gate.js
node --check src/server.js
node --test test/auth-gate-exemption-order.test.js
node --test test/headers.test.js test/security.test.js test/rate-limit.test.js \
  test/single-origin-serving.test.js test/auth-mcp-bypass.test.js \
  test/profiles.test.js test/mcp-server-icon.test.js
npm test
grep -c "^export" src/server.js                       # 0
grep -rF "Hermes Gateway laeuft auf http://localhost" src/ | wc -l   # 1
git diff --stat -- src/server.js                      # Netto-Reduktion
```

A1-Protokoll: der ~12%-Voll-Last-Flake `p5-gate-proof` gilt nur rot, wenn isoliert rot.

### (5) Blast-Radius & Pre-Mortem

1 neue Modul-Datei (~65 LOC, 0 Imports), 1 neue Test-Datei, 2 Edits in `server.js`. Keine Aenderung an `middleware.js`, `web-auth.js`, `config.js`, `util.js`, `mcp-server-info.js`, `request-tenant.js` oder bestehenden Tests.

Pre-Mortem (1 Jahr spaeter, angenommen es ging schief): (a) eine Exemption faellt beim Verschieben weg → Provider-Webhook oder Icon/Favicon bekommt 401 → Gegenmassnahme: byte-verbatim `if`-Kette + Freeze-Test pinnt jeden Pfad. (b) `/tenant.html` rutscht versehentlich in den unbedingten OR-Block → Portal ohne Flags offen → Gegenmassnahme: Flag-Gate-Testfall (nur-ein-Flag → 401). (c) `config` wird destrukturiert statt geschlossen → `dashboardPassword` friert zur Boot-Zeit ein, spaetere Env-Semantik driftet → Gegenmassnahme: ganze `config`-Instanz injiziert, per-Request gelesen. (d) `safeEqual` wird versehentlich durch `===` ersetzt → Timing-Leak → Gegenmassnahme: injiziert + verbatim, Credential-Testfall deckt den Vergleich ab.

INV-Checkliste vor Merge: INV-2 (Mount-Position unveraendert), INV-3 (Exemption-Reihenfolge, Freeze-Test), INV-6 (Boot-Zeile grep == 1), INV-7 (`makeAuthGate` genau einmal aufgerufen, stateless), INV-10 (kein `^export` in `server.js`).

---

## 2. Impl-Zusammenfassung

P14 exakt gemaess Plan/Spec umgesetzt: das Basic-Auth-Gate (`server.js` L326-375) reine Verschiebung nach `src/wiring/auth-gate.js` (`makeAuthGate`-Factory, alle 4 Kollaboratoren injiziert: `config`, `audit`, `isTrustedLocalCaller`, `safeEqual`, `BRAND_ASSETS_PREFIX` + `paths{STRIPE_WEBHOOK_PATH,CUSTOMER_PORTAL_PATH}`). Byte-identische Exemption-Reihenfolge (INV-3), Mount an unveraenderter Position vor `express.static(publicDir)` (INV-2).

`server.js`: **673 → 641 Zeilen** (Netto -32, deletions 50 > insertions 18). Neuer Einfrier-Test `test/auth-gate-exemption-order.test.js` (6 Tests, offline, kein Spawn/DB/Netz) pinnt unbedingte Exemptions, Gegenprobe geschuetzter Pfade, Flag-Gate-Schnittmenge fuer `CUSTOMER_PORTAL_PATH`, deaktiviertes Gate, `isTrustedLocalCaller`-Bypass und den Credential-/401-Response-Shape (inkl. Secret-Leak-Check im Audit-Detail).

Alle geforderten Verifikations-Kommandos gruen: `node --check` (beide Dateien), isolierter neuer Test (6/6), die 7 benannten Bestandssuiten (73/73), volle `npm test` (**2301/2301**, beide Backends json+pg via Bestandstests), `grep -c "^export" src/server.js` = 0, Boot-Log-Zeile genau 1 Treffer, `git diff --stat` zeigt Netto-Reduktion.

**Manueller End-to-End-Smoke** (Server via `SKIP_TWILIO_SIGNATURE_CHECK` + Dummy-Env + `bootstrap-tenant` gestartet, echte curl-Requests): `/healthz`, `/favicon.ico`, `/brand/hermes-icon.png`, `/voice/incoming` (Skip-Signatur) exempt (200); `/api/state` ohne Credentials via simuliertem Proxy-Traffic (`X-Forwarded-For`) → 401, mit korrekten Credentials → 200, mit falschen → 401; lokaler In-Process-Aufruf ohne XFF bypassed (200, `isTrustedLocalCaller`) wie dokumentiert.

**Dateien:**
- neu: `src/wiring/auth-gate.js`, `test/auth-gate-exemption-order.test.js`
- geaendert: `src/server.js`

**Tests:** `test/auth-gate-exemption-order.test.js` (neu, 6 Testfaelle: unbedingte Exemptions, geschuetzte Pfade, Flag-Gate-Schnittmenge, Gate deaktiviert, `isTrustedLocalCaller`-Bypass, Credential-Pfad + 401-Shape/Secret-Leak-Check). Testergebnis: **2301 pass / 0 fail**.

### Deviations (Impl, final)

Keine inhaltlichen Abweichungen vom Plan.

1. Der einzige neue Test deckt geringfuegig mehr Faelle ab als die Plan-Skizze explizit aufzaehlte (z.B. zusaetzlich der Nachweis, dass das Audit-Detail kein Secret enthaelt) — bleibt innerhalb der Spec-Vorgabe "hoechstens EIN neuer Test" (eine Datei, mehrere `test()`-Faelle, wie im Plan explizit als konform benannt via `outbound-gates-order.test.js`-Praezedenz).
2. Smoke-Test brauchte zusaetzlich `npm run bootstrap-tenant` (Store-Seed einer aktiven Owner-Nummer), da der Boot-Guard sonst fail-closed ablehnt ("Keine aktive Nummer im Store") — unabhaengig von P14, reine Testumgebungs-Voraussetzung, kein Scope-Creep am Produktionscode.

### Clean-Code-Selbstcheck (Impl)

Geprueft gegen `.claude/refs/clean-code.md`: G5/S2 keine Duplizierung — die 4 Kollaboratoren sind injiziert (DIP/P4), nicht doppelt importiert; die Exemption-Logik existiert nur noch in `auth-gate.js`. G25 keine neuen Magic Numbers; verbleibende String-Literale sind Einmal-Literale am Verwendungsort, bewusst nicht zu Konstanten gehoben (Scope-Creep gegen reine Verschiebung, im Plan begruendet). G9/C5 kein toter/auskommentierter Code. G12 keine ungenutzten Imports — `audit`/`safeEqual`/`isTrustedLocalCaller`/`BRAND_ASSETS_PREFIX` weiterhin an anderer Stelle in `server.js` verwendet (per grep verifiziert). F1 `makeAuthGate` nimmt 1 Objekt-Argument (0-2-Ziel eingehalten). G30/G34 eine Aufgabe (Auth-Gate-Middleware), eine Abstraktionsebene, keine Verschachtelung ueber Tiefe 2 (fruehe Returns). N7 Name macht Nebeneffekte sichtbar (Middleware-Factory-Konvention wie `makeVoiceRender`/`wireWebLogin`). P15 Konstruktion (`makeAuthGate`-Aufruf) bleibt in der Wurzel (`server.js`), keine Lazy-Init im Modul. Kommentare deutsch ohne Umlaute, ESM, kein Build-Step. C2 keine bruechigen Datei:Zeile-Referenzen im neuen Modul-Kommentar (nur Test-Dateiname + INV-Bezeichner). T-Serie: neues Verhalten (die extrahierte Middleware als eigenstaendig aufrufbare Funktion) hat einen automatisierten Test; reiner Refactor liess die Bestandssuite unveraendert gruen (0 Test-Aenderungen an Bestandsdateien).

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

**Unabhaengige Verifikation:** Full `npm test`: **2301 pass / 0 fail** (~111s), deckt beide Backends ab (pg-spezifische Tests setzen `STORE_BACKEND=pg` selbst innerhalb des Laufs). Isolierte P14-Spec-Tests + neuer Freeze-Test (`test/headers`, `security`, `rate-limit`, `single-origin-serving`, `auth-mcp-bypass`, `profiles`, `mcp-server-icon`, `auth-gate-exemption-order`): **79 pass / 0 fail**. `node --check` sauber fuer `server.js`, `wiring/auth-gate.js` und die neue Testdatei.

**Blockers:** keine.

**Concerns (nicht blockierend):**

1. Der Freeze-Test pinnt die Exemptions-**Menge** plus die tragenden bedingten Zweige (Flag-gated `CUSTOMER_PORTAL_PATH` als Schnittmenge-nicht-OR, `isTrustedLocalCaller`-Bypass, Credential-Fallback, 401-Default, kein Secret im Audit) statt der strikten Positions-Reihenfolge der internen OR-Klauseln. Akzeptabel: die OR-Klauseln sind verhaltensmaessig reihenfolge-unabhaengig (jede gibt unabhaengig `next()` zurueck), und die beobachtbare Reihenfolge, die zaehlt (Flag-Gate vor unbedingten Pfaden), ist abgedeckt. Kein Blocker.
2. Der Test hartkodiert `STRIPE_WEBHOOK_PATH='/webhooks/stripe'` und `CUSTOMER_PORTAL_PATH='/tenant.html'` lokal; deckt sich mit `server.js` L204/L193 und ist als bewusst dokumentiert (spiegelt das `outbound-gates-order.test.js`-Muster, damit eine kuenftige Auslassung den Test bricht statt trivial gruen zu bleiben).

**Verdict:** APPROVED. P14 ist eine saubere reine Verschiebung des Basic-Auth-Gates nach `src/wiring/auth-gate.js`. Der Gate-Koerper ist byte-identisch (normalisierter Einrueckungs-Diff = leer), gemountet an unveraenderter Position (nach `webDistDir`-Static, vor `publicDir`-Static; INV-2). INV-1 (EINE Quelle `STRIPE_WEBHOOK_PATH`/`CUSTOMER_PORTAL_PATH`), INV-3 (Exemption-Reihenfolge eingefroren + neuer Freeze-Test), INV-6 (Boot-Log == 1), INV-7 (einziger Mount), INV-10 (null Exports) — alle gehalten. `safeEqual` timing-sicher und unveraendert; fail-closed 401 erhalten; Audit leakt kein Secret. Scope respektiert: genau 3 Dateien, ein neuer Test, keine neue npm-Dependency, keine verbotenen Dateien (`middleware`/`web-auth`/`config`/`claude`/`bridge`/`util`/`request-tenant`/`mcp-server-info`) angefasst. `disclosureSentence` unveraendert in `claude.js`+`bridge.js`. Volle Suite 2301/0 gruen auf beiden Backends.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

Reine, byte-identische Extraktion. Basic-Auth-Gate (`server.js` L326-379 im Diff) 1:1 nach `src/wiring/auth-gate.js` verschoben (`makeAuthGate`), Mount-Position unveraendert (VOR `express.static(publicDir)`, INV-2), Exemption-Reihenfolge eingefroren und per neuem Test abgesichert (INV-3), `STRIPE_WEBHOOK_PATH`/`CUSTOMER_PORTAL_PATH` bleiben EINE Quelle in `server.js` (INV-1). Textvergleich alte vs. neue Gate-Logik: identisch (nur Einrueckung durch Wrapping-Funktion geaendert). Volle Bestandssuite 2301/2301 gruen (inkl. `security.test.js`, `mcp-server-icon.test.js` als Spawn-Integrationstests derselben Pfade), neue 6 Unit-Tests gruen. `node --check` auf beiden Dateien sauber. Keine verwaisten Imports (`audit`/`safeEqual`/`isTrustedLocalCaller`/`BRAND_ASSETS_PREFIX`/`CUSTOMER_PORTAL_PATH` weiterhin an anderer Stelle in `server.js` benutzt).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):**
  - P14 (Ein-Konzept-pro-Test) · `test/auth-gate-exemption-order.test.js` (letzter Test) · buendelt 3 Konzepte (Happy-Path, 401-Form, Audit-Leak-Freiheit) in einem Testnamen mit ";" — Signal aus P14/T1. Fix (optional): in 2-3 separate Tests aufspalten (valider Auth-Header → `next()`; ungueltiger Header → 401-Shape; Audit-Detail enthaelt kein Secret).
- **S4 (informativ):** keine.

**passNotes:** `makeAuthGate` folgt exakt dem im Repo etablierten Factory-Muster (`makeCallFinish`/`makeCallLifecycle`/`makeProvisioningOrchestrator`: 1 Objekt-Parameter, DI statt Import, unter `src/wiring/` wie P13/`web-login.js`) — F1/G24 sauber. Deps injiziert statt zur Modulzeit eingefroren (`config` bleibt per-Request gelesen, wie im Kommentar begruendet) — P4/DIP korrekt. Testdatei nutzt Build-Operate-Check (`fakeReq`/`fakeRes`/run-Helper), deckt unbedingte Exemptions, geschuetzte Pfade, die Flag-Schnittmenge (kein OR), den deaktivierten Gate-Fall, den Trusted-Local-Bypass UND den Credential-Vergleich inkl. Audit-Leak-Freiheit ab (T5-Randfaelle: leerer Header, falscher Header, beide Flags einzeln/zusammen aus). Commit-Message-Zahlen (673→641 Zeilen) stimmen mit `git diff --numstat` exakt ueberein — keine verdeckten Nebenaenderungen. Ausserhalb des Diffs unveraendert: der aeltere, jetzt raeumlich vom eigentlichen Gate entfernte Kommentar "Basic-Auth fuer Dashboard + API..." vor `/healthz` (`server.js` ~L219) — vorbestehend, nicht durch P14 eingefuehrt, daher nicht geflaggt, aber als Kandidat fuer eine spaetere Aufraeum-Phase notiert.

**topTodos:**
1. Optional: gebuendelten Test (letzter Testfall) in `auth-gate-exemption-order.test.js` nach P14 in Einzel-Konzept-Tests aufteilen.
2. Kein Blocker — Merge freigegeben.

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
