# Phase PA-9 — Detailbericht

**Titel:** Higher-Order Status-Gate fuer `webAuth`/`webAuthAllowPending`
**Gate:** PASS
**finalBranch:** `phase/polish-a-p9`
**Basis:** `master` @ `9c962c54f5ecb6e65402934f7a93508f6ed92342`
**headCommit (Worktree):** `77b4e8fdc6f018a876dc3c6d519a27770723c118`

---

## 1. Ziel & Typ

Reine verhaltens-erhaltende Dedup (G5/G26) im Auth-Pfad `src/web-auth.js`, strikt Snapshot-identisch. Kein Deploy, kein Push. Blast-Radius exakt 2 Dateien: `src/web-auth.js` (Refactor) + `test/web-auth-middleware.test.js` (Coverage-Verstaerkung). Keine neuen Dateien, keine neue Dependency, keine neue Env-Var.

---

## 2. Plan (gekuerzt)

### Faktenlage
Die beiden exportierten Factories in `src/web-auth.js` unterscheiden sich ausschliesslich in der Status-Verzweigung; Session-Aufloesung, 401-Pfade, `req.tenant`-Setzen und der `catch`-Zweig sind byte-identisch:

- `webAuth`: verweigert bei `ctx.acct.status !== TENANT_STATUS.ACTIVE` -> 403. Allow-Praedikat: `status === ACTIVE`.
- `webAuthAllowPending`: verweigert bei `!PENDING_ALLOWED_STATUS.has(ctx.acct.status)` -> 403. Allow-Praedikat: bestehendes benanntes `PENDING_ALLOWED_STATUS = Object.freeze(new Set([ACTIVE, SUSPENDED]))`.

Bereits extrahiert und unveraendert zu lassen: `resolveWebSession(deps, req)` (kein Status-Gate) und `tenantContextOf({acct, sub})`. `TENANT_STATUS` = `{active, suspended, closed}` (3 Werte, `Object.freeze`).

Verifizierte Randfakten: kein Test asserted `.name` der Middlewares; keine interne Referenz auf `webAuth(`/`webAuthAllowPending(` oberhalb ihrer Definition (hoisting-sicher fuer `export function` -> `export const`); alle Aufrufer (`src/wiring/web-login.js:85/88` + ~12 Testdateien) rufen strikt `webAuth(deps)`/`webAuthAllowPending(deps)`.

### Kern-Design
Neue Funktion `webAuthWithStatusGate(statusAllowed)` in `src/web-auth.js` (keine neue Datei): Higher-Order-Factory, nimmt EIN Status-Praedikat `(status) => boolean`, liefert die bekannte `(deps) => middleware`-Factory. Nebeneffekt (`req.tenant`-Setzen) laeuft ausschliesslich im erlaubten Zweig.

`webAuth` und `webAuthAllowPending` werden zu `const`-Exports, die auf `webAuthWithStatusGate` delegieren:
```js
export const webAuth = webAuthWithStatusGate((status) => status === TENANT_STATUS.ACTIVE);
export const webAuthAllowPending = webAuthWithStatusGate((status) =>
  PENDING_ALLOWED_STATUS.has(status),
);
```
Unveraendert bleiben: `resolveWebSession`, `tenantContextOf`, `PENDING_ALLOWED_STATUS`, `safeEqual`/Cookie-Signatur-Mechanik, `TENANT_STATUS`-Import.

Bewusst akzeptierter, nicht-beobachtbarer Trade-off: innere Middleware-Closures heissen nach dem Merge beide `webAuthGateMiddleware`, `webAuth.name`/`webAuthAllowPending.name` werden `makeWebAuthMiddleware`. Kein Test/Code liest diese Namen (grep-verifiziert) — G5 (eine Mechanik) schlaegt die minimal geringere Stacktrace-Unterscheidbarkeit.

Asymmetrie der Praedikate ist bewusst (kein G11): `webAuth` nutzt `=== ACTIVE` (ein Wert), `webAuthAllowPending` das bestehende Set (mehrere Werte) — ein Set fuer den Ein-Wert-Fall waere Ueber-Abstraktion.

### Test-Edits (`test/web-auth-middleware.test.js`)
6 Bestandstests bleiben textuell unveraendert (Refactor-Beleg). Drei additive Aenderungen:
1. Import um `webAuthAllowPending` erweitert.
2. `mount(deps, factory = webAuth)` generalisiert (Default-Parameter, Bestandsaufrufe unveraendert).
3. Neue 4x2-Status-Gate-Matrix (4 Status x 2 Middlewares = 8 Tests) ans Dateiende angehaengt: `active/suspended/closed/unexpected` x `webAuth/webAuthAllowPending`, mit vollem `deepEqual` auf `req.tenant` im 200-Fall (nicht nur Statuscode). Erwartete Matrix:
   - `active`: webAuth=200, pending=200
   - `suspended`: webAuth=403, pending=200 (einzige divergierende Zelle)
   - `closed`: webAuth=403, pending=403
   - `unexpected` (ausserhalb TENANT_STATUS-Enum, beweist Default-Deny): webAuth=403, pending=403

### Pruefverfahren (deterministisch)
- **Schritt A (Golden-Snapshot "vor"):** Test-Edits gegen unveraenderten `src/web-auth.js` -> erwartet 14 pass / 0 fail (6 Bestand + 8 Matrix).
- **Schritt B ("nach" == "vor"):** `src/web-auth.js`-Refactor anwenden, `node --check` + Tests erneut -> erwartet identisch 14 pass / 0 fail.
- **Schritt C (struktureller Dedup-Beweis via grep):** keine alten benannten Middleware-Funktionen mehr; `webAuthWithStatusGate` 1x Def + 2x Use; `resolveWebSession`/`tenantContextOf` weiterhin vorhanden.
- **Schritt D (Voll-Suite):** `npm test` gruen, Baseline +8 (neue Matrix-Tests); betroffene Nachbar-Suiten (admin-approval, billing-payment-gate, bk2/bk4/bk5, i9-self-service, p5-onboarding-funnel, portal-route, self-service-mirror-hydration, w4-self-service-subscribe, web-login-wiring) muessen gruen bleiben. Kein Smoke-Server noetig (kein Boot-/Routing-Verhalten geaendert).

### Invarianten-Checkliste (Abnahme)
- `webAuthWithStatusGate(predicate)` existiert; beide Middlewares delegieren darauf (kein dupliziertes Skelett).
- Fail-closed 401/403 in beiden Pfaden strukturell gleich; gewollte Divergenz nur im Status-Praedikat.
- `resolveWebSession`/`tenantContextOf` bleiben die eine Aufloesungsquelle.
- 4x2-Matrix inkl. Happy-Path fuer beide Middlewares mit vollem `req.tenant`-`deepEqual`.
- Voll-Suite gruen; keine Absolute Regel aufgeweicht; kein Deploy/Push.
- Datei-Serialisierung: PA-9 laeuft vor PA-17 (beide fassen `web-auth.js` an) — reiner Scheduling-Hinweis, kein Code-Impact hier.

---

## 3. Impl-Zusammenfassung

`webAuthWithStatusGate(statusAllowed)` als gemeinsames Higher-Order-Skelett extrahiert; `webAuth` und `webAuthAllowPending` delegieren als `const`-Factories darauf (nur noch `statusAllowed`-Praedikat als Divergenz: `ACTIVE` vs. `PENDING_ALLOWED_STATUS`-Set). `resolveWebSession`/`tenantContextOf`/`PENDING_ALLOWED_STATUS`/`TENANT_STATUS`-Import unveraendert.

Testdatei erweitert um `webAuthAllowPending`-Import, generalisiertes `mount(deps, factory = webAuth)` und die volle 4x2-Status-Matrix (8 Zellen, Happy-Path inkl. vollem `req.tenant`-`deepEqual`) — 6 Bestandstests textuell unveraendert.

Zwei-Schritt-Beweis exakt wie geplant durchgefuehrt: Schritt A (Matrix gegen unveraenderten `src/web-auth.js`) = 14/0 gruen; Schritt B (Matrix gegen refaktorierten `src/web-auth.js`) = identisch 14/0 gruen — 8-Zellen-Snapshot mechanisch als identisch bewiesen. Struktureller Dedup-Grep (Schritt C) bestaetigt: keine der alten benannten Middleware-Funktionen mehr vorhanden, `webAuthWithStatusGate` 1x definiert + 2x genutzt (plus 1 Kommentar-Treffer, siehe Deviations), `resolveWebSession`/`tenantContextOf` unangetastet.

**Kennzahlen:**
- `node --check`: PASS (beide geaenderten Dateien)
- Tests: PASS — 2396 pass / 0 fail (Baseline 2388 + 8 neue Matrix-Tests)
- Smoke: PASS — Server mit refaktoriertem `src/web-auth.js` bootet fehlerfrei (`/healthz` -> 200); kein tieferer Route-Smoke noetig (reine Auth-Middleware-Fabrik ohne Boot-/Routing-Aenderung, Business-Logik durch die 8-Zellen-Matrix abgedeckt)
- Committed: ja, Commit `77b4e8f` auf Branch `phase/polish-a-p9`, nur die 2 geplanten Dateien staged/committed, kein Push, kein Deploy

**Geaenderte Dateien (im Impl-Worktree):**
- `src/web-auth.js`
- `test/web-auth-middleware.test.js`

**cleanCodeSelfCheck (Impl-Agent):** G5/G26 (Dedup) — `webAuthWithStatusGate(statusAllowed)` extrahiert das identische Session-/Fail-closed-Skelett, einzige Divergenz das Praedikat. N7: Nebeneffekt (`req.tenant` setzen) im Namen der aeusseren Middleware sichtbar. F1: Higher-Order-Factory mit 1 Argument. G25: `PENDING_ALLOWED_STATUS` bleibt benannte Quelle (unveraendert). Keine Magic Numbers, kein toter/auskommentierter Code, kein `eslint-disable`, keine neuen Deps/Env-Vars. C2: keine bruechigen Datei:Zeile-Kommentare. Testdatei: G5 in `mount()` ueber Default-Parameter, P12 (Matrix-Tests unabhaengig+offline+self-validating via `deepEqual`), P14 (1 Konzept je Testfall/Zelle).

### Deviations
1. Vorbereitungsschritt "`ln -s ./node_modules node_modules`" war als reiner Selbst-Symlink fehlerhaft (leer/broken); tatsaechlicher `node_modules`-Ordner liegt 3 Ebenen hoeher im Hauptrepo-Root. Symlink entsprechend korrigiert, NICHT committet (git status bestaetigt 0 getrackte `node_modules`-Eintraege).
2. `git grep -c webAuthWithStatusGate` liefert 4 statt der im Plan erwarteten 3 (1 Def + 2 Uses): Differenz kommt vom Section-Divider-Kommentar `// ---- webAuthWithStatusGate (...)`, der ebenfalls matcht — konsistent mit der Datei-eigenen Kommentar-Konvention (dieselbe Ueberzaehlung zeigt sich bei `resolveWebSession`/`tenantContextOf`: Plan/Grep liefert 6 statt einer "sauberen" Zahl). Rein kosmetische Diskrepanz, keine strukturelle Abweichung — Def+2 Uses sind exakt wie geplant vorhanden.
3. `npm test` deckt json- und pglite-Backend nicht als zwei separate npm-Runs ab (kein eigenes Skript dafuer im Repo) — pglite-gestuetzte Tests (z.B. `b1a-period-anchor-pg.test.js`, `assistant-context-persist-pg.test.js`) liefen im selben `npm test`-Durchlauf mit (2396/0 gesamt), keine getrennte Ausfuehrung noetig/moeglich.

---

## 4. Safety-Urteil (final)

**approved:** true
**verdict:** APPROVED

Reine verhaltens-erhaltende G5/G26-Dedup: `webAuthWithStatusGate(statusAllowed)` ist die gemeinsame Factory, `webAuth` (active-only) und `webAuthAllowPending` (active|suspended) delegieren darauf. Kontrollfluss byte-aequivalent zum Bestand verifiziert — fail-closed 401/403 in beiden Pfaden strukturell identisch, gewollte Divergenz nur im Status-Praedikat. `resolveWebSession`/`tenantContextOf`/`safeEqual` unveraendert und weiterhin einzige Aufloesungsquelle (nicht dupliziert, nicht umgangen); Factory-Signatur `webAuth(deps)` erhalten, Caller in `wiring/web-login.js` unberuehrt. Neuer Test sperrt die 8-Zellen-Golden-Truth-Table mechanisch und deckt sich mit dem Vor-Refactor-Verhalten. Scope strikt eingehalten (nur 2 Dateien, keine neue npm-Dep, kein neues Logging/Leak). Safety-Gates, Disclosure (`claude.js`+`bridge.js`) und Signaturpruefung nicht beruehrt.

**Teilbefunde:**
- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true
- blockers: keine

**Unabhaengiger Testlauf (Reviewer, frischer Worktree, Branch `review-pa-9` von `phase/polish-a-p9`):** Ziel-Auth-Tests (`web-auth-middleware.test.js` inkl. neuer 4x2-Matrix + `web-auth-pg.test.js` pglite-Integration + `web-auth.test.js`): 84 pass / 0 fail. Voll-Suite: Lauf 1 = 1 fail in `test/telnyx-event-ingest-route.test.js:74` (call.hangup Settlement-Idempotenz) — unrelated zu `web-auth.js`, bekannter ~12% Voll-Last-Spawn-Race (Seed-vor-Boot). Lauf 2 = 2396/2396 pass, 0 fail. Flaky Test isoliert 2x gruen (2/2, 2/2). Gate-Protokoll erfuellt: rot nur echt, wenn isoliert rot -> kein Regress durch PA-9. `node --check` gruen fuer `web-auth.js` + Testdatei.

**Concerns (nicht-blockierend):** Die innere Middleware-Funktion wurde zu `webAuthGateMiddleware` umbenannt; veraltete Kommentare in `src/server.js:52` und `src/routes/_tenant.js:111` sprechen weiter von `webAuthMiddleware`. Rein dokumentarischer Drift, kein Verhaltens-/Sicherheitseffekt (kein Code liest `.name`, grep bestaetigt).

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS
**blocker:** false

PA-9 ist ein sauberer, verhaltens-erhaltender G5-Dedup: `webAuth`/`webAuthAllowPending` waren zwei fast identische try/catch-Middleware-Bodies (Session aufloesen -> Status-Gate -> `req.tenant` setzen -> next, Fehler -> 401) und sind jetzt eine Higher-Order-Factory `webAuthWithStatusGate(statusAllowed)` mit genau einem Divergenzpunkt (dem Status-Praedikat). Logik bit-fuer-bit nachvollzogen: `!== ACTIVE` -> `status === ACTIVE`-Praedikat negiert, `!PENDING_ALLOWED_STATUS.has(status)` -> Set-Praedikat negiert — identisch. Verifiziert nicht nur durch Lesen, sondern per Laufzeit: temporaerer Worktree fuer `phase/polish-a-p9` angelegt, `node --check` sauber, neue Golden-Status-Gate-Matrix (8 Faelle inkl. Default-Deny bei unbekanntem Status) UND die volle Suite gruen (2396/2396, 0 fail). Caller (`src/wiring/web-login.js`) ruft weiterhin `webAuth(deps)`/`webAuthAllowPending(deps)` unveraendert auf — keine Signaturaenderung, kein Breakage. Kommentare aktuell und praezise (keine C1-C5-Verstoesse), keine Magic Numbers/Strings, `TENANT_STATUS`/`PENDING_ALLOWED_STATUS` werden wiederverwendet statt dupliziert.

### S1 (Blocker)
Keine.

### S2
Keine.

### S3
- **G20 · `src/web-auth.js:700-701`** — Beide Middleware-Varianten laufen jetzt durch dieselben inneren Closure-Namen (`makeWebAuthMiddleware`, `webAuthGateMiddleware`) statt vorher `webAuthMiddleware` vs. `webAuthAllowPendingMiddleware` — Stacktraces/Express-Introspektion koennen die zwei Varianten nicht mehr am Funktionsnamen unterscheiden (nur noch am Predicate-Verhalten). Kein Codepfad im Repo liest `.name` dieser Exports (grep negativ), daher rein kosmetisch. Fix (optional): Debug-Name je Variante setzen, z.B. `Object.defineProperty(mw, 'name', { value: label })` in der Factory, oder als zweites Argument einen Label-String durchreichen.

### S4
Keine.

**passNotes:** Vollstaendige Kette gruen: `node --check` ok, neue 8-Fall-Matrix + volle Suite (2396/2396) auf dem tatsaechlichen Branch-Commit (`77b4e8f`) ausgefuehrt, nicht nur gelesen. Kommentarbloecke ueber `webAuthWithStatusGate`/`webAuth`/`webAuthAllowPending` sind praezise, decken die fail-closed-Semantik und die einzige gewollte Divergenz klar ab. Testdatei folgt Build-Operate-Check (P13) sauber ueber die Helfer `accountFor`/`expectedTenant`, deckt Grenzfaelle (closed, ausserhalb des Enums) ab (G3/T5) und beweist Default-Deny explizit. Keine toten/auskommentierten Codeteile, keine neuen Magic Numbers, keine abgeschalteten Sicherungen.

**topTodos:**
- Optional, nicht blockierend: den zwei Middleware-Varianten unterscheidbare Debug-Namen geben (z.B. per Label-Parameter oder `Object.defineProperty` auf `.name`), damit Stacktraces/Logs `webAuth` vs. `webAuthAllowPending` wieder am Funktionsnamen erkennen lassen.

---

## 6. Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf auf PASS/APPROVED ohne Blocker; die einzigen Befunde (Safety-Concern zu veralteten Kommentaren in `src/server.js`/`src/routes/_tenant.js`, Clean-Code S3 zu Closure-Debug-Namen) sind explizit als nicht-blockierend und rein kosmetisch eingestuft — kein Fix-Zyklus erforderlich.

---

## 7. Ergebnis

Gate PASS. `phase/polish-a-p9` ist bereit fuer den Merge im Lead (kein Push/Deploy durch diese Phase selbst). Offen bleibt nur die optionale, nicht-blockierende Kosmetik (Debug-Namen der inneren Middlewares, veraltete `webAuthMiddleware`-Kommentare in `src/server.js`/`src/routes/_tenant.js`) — beide ohne Sicherheits- oder Verhaltenseffekt.
