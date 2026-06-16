# P0 — Crash-Backstop & Boot-Entkopplung (OT-1)

## Orchestrierung (Parallelisierung)

| Feld | Wert |
|---|---|
| Phase | P0 — Fundament (OT-1) |
| Prerequisite | **keine — ZUERST mergen** |
| Parallel-safe mit | **keine — SOLO** (aendert Boot-Pfad + `server.js`-Boot-Block, den P1/P2/P4 ebenfalls anfassen; ist der Safety-Backstop, auf den alle anderen Phasen aufbauen) |
| Conflict-Files | `src/server.js` (Boot-Block 120-180 + `app.listen` 922), `src/mcp-server.js` |
| Empfohlener Branch | `feat/crash-p0-backstop` |
| Severity | **Critical** (kappt Blast-Radius aller weiteren Phasen) |
| Verifikation gesamt | `npm test` gruen + Smoke-Test (Server mit kaputter Portal-DB starten) |

> **Warum solo + zuerst:** P0 installiert das globale Crash-Netz und entkoppelt den Boot-Pfad. Erst wenn es gemerged ist, ist es sicher, P1/P2/P3 parallel laufen zu lassen (der Backstop faengt deren Restfehler ab, und der server.js-Boot-Block ist dann stabil).

---

## Problem

**Teil A — kein globales Crash-Netz.** `grep -rnE 'process\.on|uncaughtException|unhandledRejection' src/` → **NONE FOUND**. Jeder entkommene Throw/Rejection killt den Prozess. Da EIN Node-Prozess ALLE gleichzeitigen Calls + das Web-Stack bedient, bedeutet das: **ein Fehler = alle laufenden Calls weg**, nicht nur einer. Konkrete Quellen (aus der Analyse): die WS-`message`-Handler in `bridge.js`, fire-and-forget `finishCall()`/`onCallEnded?.()`, der Tool-Loop in `claude.js`.

**Teil B — gekoppelter Boot-Pfad.** Drei ungeschuetzte top-level `await`s reissen beim Start den ganzen Prozess runter:
- `server.js:134` `const portalRunner = await createPortalRunner();` — im `if (config.sessionSecret && config.storeBackend === "pg")`-Block (131), **kein try/catch**. Wirft die F5-Rollen-Assertion oder ist die Portal-DB unerreichbar → Prozess startet nicht — **inkl. Telefonie, die den Portal-Pool gar nicht braucht**.
- `portal-pool.js:52` `const client = await pool.connect();` — liegt **eine Zeile ueber** seinem eigenen `try` (try ab :53). connect-Fehler bubbelt ungefangen + der Pool wird nie `end()`-et (Pool-Leak).
- `store.js:46` `const backend = ... ? await createPgBackend() : jsonBackend;` — top-level await; unerreichbare `DATABASE_URL` → Modul-Eval rejected → roher pg-Fehler (evtl. Connection-String-Fragment im Stack).

**Teil C — ESM-Eval-Order (kritisch fuer die Umsetzung).** `server.js` importiert (direkt/indirekt) `store.js`. In ESM werden importierte Module evaluiert, **bevor** der Body des importierenden Moduls laeuft. Ein in `server.js`-Body registrierter Handler kaeme also **zu spaet** fuer eine `store.js`-Boot-Rejection. Der Guard muss als **Side-Effect eines Imports installiert werden, der VOR `store.js` in der Importliste steht**.

---

## Soll-Zustand (Akzeptanzkriterien)

**AC1.** Neues Modul `src/process-guards.js` installiert beim Import (top-level Side-Effect) Handler fuer `unhandledRejection` und `uncaughtException`. Logging strukturiert und **secret-frei**: nur `err.message`/`err.stack`, NIE `config`, Connection-String oder Env.

**AC2.** `import "./process-guards.js";` ist die **literal erste Zeile** von `src/server.js` UND `src/mcp-server.js` — vor jedem anderen lokalen Import (insb. vor allem, was `store.js` zieht). Damit sind die Guards live, bevor irgendein Boot-`await` evaluiert.

**AC3.** `unhandledRejection`-Policy: **loggen, NICHT exiten.** Eine einzelne Async-Edge (z.B. fehlgeschlagene Summary) darf nicht alle Calls killen.

**AC4. [ENTSCHIEDEN 2026-06-16: weiterlaufen]** `uncaughtException`-Policy: **loggen + Prozess WEITERLAUFEN lassen** (kein `process.exit`, kein graceful-shutdown-Pfad im Guard). Begruendung: `process.exit` wuerde alle gleichzeitigen Calls killen. Bewusste, dokumentierte Abweichung vom Node-Default (Zustand nach `uncaughtException` laut Node-Doku undefiniert) — akzeptiertes Risiko, weil dieser Handler nur das Last-Resort-Netz ist; der eigentliche Fix sind quellseitige try/catch (P3). Umsetzung: nur lautes `[guard]`-Logging, kein Exit.

**AC5.** `createPortalRunner()`-Aufruf (`server.js:134`) in try/catch. Bei Fehler: lauter Log → Web-Login/Portal/Admin/Self-Service-Block wird **uebersprungen** (Routen existieren nicht → 404), aber Boot laeuft weiter. `/voice/*`, `/healthz`, `/mcp`, Owner-Dashboard funktionieren. **Portal-pg-Fail toetet Telefonie NICHT mehr.**

**AC6.** `store.js` pg-Backend-Fehler (`createPgBackend` reject): gefangen mit **klarer fataler Diagnose** (kein Connection-String im Log) + definierter `process.exit(1)`. Das IST eine harte Dependency (pg-Store = Persistenz auch fuer Telefonie); Ziel ist sauberer diagnostizierter Fatal statt roher Rejection — **KEIN stiller json-Fallback** (waere Backend-Split-Brain / Daten-Inkonsistenz-Risiko).

**AC7.** `portal-pool.js:52` `pool.connect()` in den try-Block ziehen → bei connect-Fehler laeuft `pool.end()` (kein Pool-Leak), Fehler propagiert kontrolliert (von AC5 gefangen).

**AC8.** Bestehende Tests (Stand: 329) bleiben gruen. Neue Tests decken AC1-AC7 ab (s.u.). Smoke-Test beweist AC5.

---

## Lokalisierung (verifiziert 2026-06-16)

| Datei | Stelle | Aenderung |
|---|---|---|
| `src/process-guards.js` | **NEU** | `installProcessGuards()` + top-level Side-Effect-Install; secret-freies Logging |
| `src/server.js` | Zeile 1 | `import "./process-guards.js";` als ERSTE Zeile |
| `src/server.js` | 131-166 | try/catch um den Portal-/Web-Login-Block (AC5); `app.listen`-Pfad unberuehrt |
| `src/mcp-server.js` | Zeile 1 | `import "./process-guards.js";` als ERSTE Zeile |
| `src/portal-pool.js` | 48-60 | `connect()` in try (AC7) |
| `src/store.js` | 13-46 | `createPgBackend` try/catch + diagnostizierter `process.exit(1)` (AC6) |

**`portal-pool.js` (verifiziert) — Vorher/Nachher:**
```js
// Vorher (49-60)
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const client = await pool.connect();          // <-- ausserhalb try
try { await assertNoBypassRls(...); }
catch (e) { client.release(); await pool.end(); throw e; }
client.release();

// Nachher
const pool = new pg.Pool({ connectionString: config.databaseUrl });
let client;
try {
  client = await pool.connect();              // <-- jetzt im try
  await assertNoBypassRls({ query: (t, p) => client.query(t, p) });
} catch (e) {
  if (client) client.release();
  await pool.end();
  throw e;                                    // kontrolliert -> server.js:134 faengt (AC5)
}
client.release();
```

**`server.js:131` (verifiziert) — schematisch:**
```js
if (config.sessionSecret && config.storeBackend === "pg") {
  try {
    const portalRunner = await createPortalRunner();
    const oidc = makeOidc(config);
    // ... makeAccounts/makeSessions/Routes/Admin/Self-Service (134-180 unveraendert im try) ...
  } catch (e) {
    console.error("[boot] Web-Login/Portal deaktiviert (Portal-Pool-Fehler):", e.message);
    // KEIN throw -> Boot laeuft weiter; /voice, /healthz, /mcp, Owner-Dashboard unberuehrt
  }
}
```
> **Verifizieren vor Edit:** Basic-Auth-Schicht + `express.static` werden NACH diesem Block registriert (Kommentar `server.js:120-130`). Sicherstellen, dass sie ausserhalb des try liegen → Owner-Dashboard-Schutz bleibt aktiv, auch wenn der Portal-Block uebersprungen wird.

**`process-guards.js` (NEU) — Skelett:**
```js
// Globales Crash-Netz (OT-1). Side-Effect-Install beim Import -> MUSS als
// erste Importzeile in server.js + mcp-server.js stehen (vor store.js),
// damit Boot-Rejections gefangen werden (ESM-Eval-Order).
export function onUnhandledRejection(reason) {
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  console.error("[guard] unhandledRejection:", msg);   // bewusst KEIN exit (AC3)
}
export function onUncaughtException(err) {
  console.error("[guard] uncaughtException:", err?.stack || err?.message || String(err));
  // AC4 ENTSCHIEDEN: weiterlaufen - KEIN process.exit (Exit = alle Calls weg).

}
export function installProcessGuards() {
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);
}
installProcessGuards();   // Side-Effect beim Import
```
> Handler als benannte Funktionen exportieren → direkt unit-testbar ohne echten Prozess-Crash.

---

## Test-Cases (Given / When / Then)

**T-P0-01 — Guards registriert.** Given frischer Import von `process-guards.js`. When geladen. Then `process.listenerCount("unhandledRejection") >= 1` und `...("uncaughtException") >= 1`.

**T-P0-02 — unhandledRejection loggt, exitet nicht.** Given `console.error`-Spy. When `onUnhandledRejection(new Error("x"))`. Then `console.error` aufgerufen mit "[guard] unhandledRejection"; Funktion kehrt zurueck (kein throw, kein exit).

**T-P0-03 — uncaughtException loggt secret-frei.** Given Error mit Message ohne Secret. When `onUncaughtException(err)`. Then Log enthaelt `err.stack`; Log enthaelt NICHT den String aus `config.databaseUrl`/Secrets (assert auf abwesende Substrings).

**T-P0-04 — portal-pool connect-Fehler -> pool.end + throw.** Given Fake-`pg.Pool`, dessen `connect()` rejected. When `createPortalRunner()`. Then `pool.end()` aufgerufen, Fehler propagiert, kein unhandled Pool. (Pool via DI/Fake; ggf. kleine Test-Seam.)

**T-P0-05 — Boot-Entkopplung (KERN-Beweis, Integration).** Given Server-Kindprozess mit `SESSION_SECRET` gesetzt, `STORE_BACKEND=pg`, **kaputter** `DATABASE_URL`, `PORT=0`. When gestartet. Then Prozess lebt; `GET /healthz` → 200; `GET /auth/login` → 404 (Web-Login nicht gemountet); Boot-Log enthaelt "[boot] Web-Login/Portal deaktiviert".

**T-P0-06 — store-pg-Fatal ist diagnostiziert + secret-frei.** Given `STORE_BACKEND=pg` + kaputter `DATABASE_URL`. When Boot. Then Exit-Code 1; stderr enthaelt klare Meldung; stderr enthaelt NICHT den Connection-String.

**T-P0-07 — Guard-Import-Order (Regressions-Schutz).** Given `src/server.js` + `src/mcp-server.js`. When erste nicht-leere Importzeile gelesen. Then sie ist `import "./process-guards.js";` (statischer Datei-Check; verhindert Re-Regression durch spaetere Refactors).

---

## Betroffene Dateien

| Datei | Typ | Aenderung |
|---|---|---|
| `src/process-guards.js` | Source (neu) | Guard-Modul, Side-Effect-Install, secret-frei |
| `src/server.js` | Source | Guard-Import Zeile 1; try/catch um Portal-Block (131-166) |
| `src/mcp-server.js` | Source | Guard-Import Zeile 1 |
| `src/portal-pool.js` | Source | `connect()` in try (48-60) |
| `src/store.js` | Source | `createPgBackend` try/catch + diagnostizierter exit(1) |
| `test/process-guards.test.js` | Test (neu) | T-P0-01..03, 06, 07 |
| `test/boot-decoupling.test.js` | Test (neu) | T-P0-05 (Integration, Kindprozess) |
| `test/portal-pool-assertion.test.js` | Test | T-P0-04 ergaenzen (bestehendes File) |

**Caller-Check vor Edit (Pflicht, CLAUDE.md):** `grep -rn "createPortalRunner\|createPgBackend" src/` — sicherstellen, dass kein weiterer Caller von der Fehler-Semantik abhaengt.

---

## Verifikation

```
node --check src/process-guards.js
node --check src/server.js
node --check src/mcp-server.js
node --check src/portal-pool.js
node --check src/store.js
npm test                              # alle Tests gruen (329 + neue)

# Smoke-Test Boot-Entkopplung (AC5):
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true SESSION_SECRET=x \
  STORE_BACKEND=pg DATABASE_URL=postgres://bad:bad@127.0.0.1:1/none npm start &
sleep 2
curl -s localhost:3999/healthz            # erwartet: {"ok":true}
curl -s -o /dev/null -w '%{http_code}' localhost:3999/auth/login   # erwartet: 404
```
Erwartetes Ergebnis: Server lebt trotz kaputter Portal-DB, `/healthz` 200, `/auth/login` 404, Boot-Log meldet deaktiviertes Web-Login.

---

## Risiken / Pre-Mortem (1 Jahr in der Zukunft, P0 war falsch)

- **uncaughtException-continue maskiert korrupten Zustand.** Nach `uncaughtException` ist der Prozess laut Node-Doku in undefiniertem Zustand → koennte falsche Daten liefern. **ENTSCHIEDEN (AC4): weiterlaufen** — akzeptiertes Risiko, weil Exit alle Calls killt. Mitigation: P0-Handler ist nur Backstop; quellseitige try/catch in P3 sind der echte Fix; lautes Logging macht den Vorfall sichtbar.
- **Guard macht Bugs unsichtbar.** Wenn Logging zu leise ist, werden geschluckte Rejections zum stillen Outage (genau das auth-`catch{}`-Anti-Pattern aus der Analyse). Mitigation: lautes, eindeutiges `[guard]`-Logging; spaeter ggf. Alerting.
- **Import-Order-Fragilitaet.** Verschiebt ein Refactor den Guard-Import unter `store.js`, entkommen Boot-Rejections wieder. Mitigation: T-P0-07 (statischer First-Line-Check) + Kommentar.
- **Verhaltensaenderung Boot.** Vorher: Portal-pg-Fail = kein Boot (fail-closed). Nachher: Boot ohne Web-Login. **Sicherheits-Check:** Darf NICHT versehentlich Owner-Daten ohne Auth exponieren → nur die Portal-/Web-Login-Routen werden uebersprungen; Basic-Auth fuer Owner-Dashboard bleibt (liegt nach dem Block). In T-P0-05 zusaetzlich pruefen: `GET /` ohne Basic-Auth → 401.
- **CLAUDE.md-Gates unangetastet:** P0 fasst Allowlist/Budget/Disclosure/Signatur NICHT an. Nur Crash-Verhalten + Boot-Robustheit.
