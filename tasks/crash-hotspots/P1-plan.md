# P1 — Store-Integritaet (OT-3)

## Orchestrierung (Parallelisierung)

| Feld | Wert |
|---|---|
| Phase | P1 — Store-Integritaet (OT-3) |
| Prerequisite | **P0 merged to master** (globaler Crash-Backstop muss stehen, bevor Store-Fehler kontrolliert nach oben propagiert werden) |
| Parallel-safe mit | **P2, P3** (disjunkte Files; einzige `server.js`-Beruehrung ist die `/api/onboard`-Region, getrennt von P2's Region) |
| Conflict-Files | `src/server.js` (NUR `/api/onboard`-Region 828-872) — bei Merge mit P2/P4 koordinieren |
| Empfohlener Branch | `feat/crash-p1-store-integrity` |
| Severity | **Critical** (stiller Datenverlust + Budget-Counter-Rollback schwaecht das Kosten-Gate, CLAUDE.md Regel 1) |
| Verifikation gesamt | `npm test` gruen + Smoke-Test (Concurrent-Onboard + manuell korruptes `store.json` laden) |

> **Warum nach P0:** P1 macht `save()`/`load()` fehlerwerfend statt still. Ohne den globalen `unhandledRejection`/`uncaughtException`-Handler aus P0 koennte ein neu geworfener I/O-Fehler den Prozess killen. P0 ist das Netz, P1 die quellseitige Haertung. Reihenfolge ist nicht verhandelbar.

> **CLAUDE.md-Gates unangetastet:** P1 fasst Allowlist/Disclosure/Signatur NICHT an. Es **staerkt** das Budget-Gate (Regel 1), indem es Counter-Rollback durch truncated Writes verhindert. Nur Persistenz-Robustheit + Boot-Korruptions-Verhalten aendern sich.

---

## Problem

Der JSON-Store (`src/store/json.js`, json-Default-Backend hinter der `store.js`-Fassade) ist der einzige Persistenz-Pfad fuer Calls, Tenants, Usage/Budget-Counter, Profile und Nummern. Er ist auf drei Wegen ungeschuetzt — alle drei sind **Critical** (`tasks/crash-hotspots/analysis.md`, OT-3, mcp-data #1/#2/#4):

1. **Non-atomic write (`save()`, json.js:118-121).** `fs.writeFileSync(FILE, JSON.stringify(state, null, 2))` schreibt in-place, ohne tmp+rename, ohne fsync, ohne Lock. Folgen:
   - **Truncated File bei Crash mid-write.** SIGTERM (Render-Deploy/Restart), disk-full oder Prozess-Kill waehrend des Writes hinterlaesst ein halbes File. Beim naechsten Boot ist es unparsebar → siehe Problem 2.
   - **Lost Update bei Concurrent Write.** Alle Caller teilen sich im selben Node-Prozess das Modul-globale `state` (verifiziert: `store.js:46` bindet das json-Backend als Singleton; alle 11 `store.save()`-Caller in server.js/claude.js laufen gegen dieselbe Instanz). Eine read-modify-write-Sequenz A (`load()` → mutiere → `save()`) und eine ueberlappende Sequenz B koennen sich gegenseitig ueberschreiben — last-writer-wins. Bei einem Inbound-`/voice` (Transcript-Append, claude.js:244) gleichzeitig mit einem `place_call`/Onboard (Budget-/Nummern-Mutation) gewinnt der spaetere `JSON.stringify(state)` und der fruehere Teil-State geht verloren. **Bei Usage/Budget heisst das: gezaehlte Kosten verschwinden → das Kosten-Gate unterzaehlt.**
2. **Korrupt-File-Silent-Wipe (`load()`, json.js:26-29).** Wenn `JSON.parse(fs.readFileSync(FILE))` wirft (korruptes/halbes File aus Problem 1), faengt der nackte `catch {}` den Fehler, ersetzt **stillschweigend den gesamten Store** mit `ops.makeDefaultState()` und ruft `save()` — das ueberschreibt das korrupte (aber potentiell forensisch rettbare) File mit Defaults. Eine Korruption sieht damit aus wie ein sauberer Erst-Start: alle Calls, Tenants, Usage-Counter und Profile sind weg, **kein Fehler, kein Log, keine Spur**. Genau das auth-`catch{}`-Anti-Pattern aus der Analyse.
3. **`POST /api/onboard` save() ausserhalb try/catch (server.js:848).** Nach erfolgreicher `requestNumber`-State-Mutation ruft die Route `store.save()` (Zeile 848) ohne umschliessendes try/catch. Schlaegt der Write fehl (disk-full, EACCES), wird der Fehler zur unhandled async rejection in einem `async`-Handler → mem/disk-Divergenz: der In-Memory-`state` enthaelt die neue 'requested'-Nummer, die Platte nicht. Beim naechsten Boot ist die Nummer weg, der Provider-Kauf (falls er folgt) laeuft gegen einen inkonsistenten Zustand. Die Saves bei 864/868 liegen zwar in einem try/catch, dessen catch ist aber auf **Provisioning-Fehler** zugeschnitten (502 + Provider-Release), nicht auf I/O-Fehler des Saves selbst.

---

## Soll-Zustand (Akzeptanzkriterien)

**AC1 — Atomic write.** `save()` schreibt NIE in-place. Stattdessen: in ein Temp-File im selben Verzeichnis schreiben (`<FILE>.tmp-<pid>-<rand>`), `fd.sync()` (fsync) vor dem Close, dann `fs.renameSync(tmp, FILE)` (atomarer Replace auf demselben Filesystem). Ein Crash mid-write hinterlaesst hoechstens ein verwaistes `.tmp`-File, NIE ein truncated `store.json`.

**AC2 — Write-Serialisierung (Single-Writer-Guard).** Zwei ueberlappende read-modify-write-Sequenzen koennen keinen Lost Update verursachen. Da alle Caller im selben Node-Prozess dasselbe Modul-globale `state` teilen, ist ein **prozess-lokaler Serialisierungs-Mechanismus** ausreichend und korrekt:
   - `save()` ist synchron (`writeFileSync`/`renameSync`) und damit innerhalb eines Ticks bereits atomar gegenueber anderem JS — der Lost-Update entsteht NICHT im `save()` selbst, sondern wenn ein `await` zwischen `load()` und `save()` einer Sequenz einem anderen Caller die Kontrolle gibt.
   - Loesung: Die schreibenden Routen, die ein `await` zwischen Mutation und `save()` haben (insb. `/api/onboard`, place_call-Pfad), serialisieren ihre read-modify-write-Sequenz ueber eine **Promise-Chain-Mutex** (`withStoreLock(fn)`): `let chain = Promise.resolve(); withStoreLock = fn => (chain = chain.then(fn, fn)).` Innerhalb des kritischen Abschnitts: `load()` → mutiere → `save()` ohne dazwischenliegendes fremdes `await`.
   - Im Plan-Doc explizit dokumentieren: **Innerhalb eines Node-Prozesses teilen sich alle Caller das Modul-`state`; ein prozess-lokaler Mutex genuegt. Bei einem Multi-Prozess-Deploy (heute nicht der Fall — Render free plan = 1 Instanz) waere ein File-Lock noetig — als bewusst akzeptiertes Prototyp-Risiko in `PLAN-SECURITY.md` festhalten.**
   - Pure synchrone Caller (z.B. `addTranscript`, json.js:137) brauchen keinen Mutex (kein `await` in der Sequenz), profitieren aber von AC1.

**AC3 — Korruption wird NIE still verschluckt.** `load()` unterscheidet hart zwischen:
   - **Genuine First-Boot** (File ABWESEND, `ENOENT`): Defaults sind OK, kein Alarm, normaler Start.
   - **Korruption** (File VORHANDEN, aber `JSON.parse` wirft): NIE stiller Defaults-Wipe. Stattdessen:
     1. Das korrupte File nach `<FILE>.corrupt-<ISO-timestamp>` umbenennen (forensische Bewahrung).
     2. LAUTES Logging: `console.error("[store] KORRUPTES store.json erkannt - umbenannt nach <pfad>. Store startet mit Defaults. DATENVERLUST moeglich, File pruefen.")` mit dem Pfad des `.corrupt`-Backups.
     3. Erst danach mit Defaults weiterfahren (`makeDefaultState()`), damit der Dienst (Telefonie) ueberlebt — aber sichtbar, nicht still.
   - Der Unterschied wird am Fehler-Code/`fs.existsSync` festgemacht, NICHT am Parse-Ergebnis allein.

**AC4 — `POST /api/onboard` behandelt Save-I/O-Fehler.** Die Store-Mutationen + `store.save()` in der `/api/onboard`-Route (server.js:828-872) laufen so, dass ein Write-Fehler ein **behandelter 5xx** ist (z.B. 503 `{ error: "Persistenz fehlgeschlagen" }`), KEINE unhandled async rejection. Konkret: der Save bei 848 wird in try/catch gewrappt; die bestehende try/catch um den Provisioning-Block (858-871) wird so erweitert, dass auch ein Save-Fehler dort als I/O-Fehler (nicht als Provisioning-Fehler) klassifiziert und sauber beantwortet wird. mem/disk-Divergenz wird im Fehlerfall geloggt.

**AC5 — Keine Verhaltensaenderung im Happy Path.** Erfolgreiche Saves/Loads verhalten sich byte-identisch wie bisher (gleiches JSON-Format, `null, 2`-Indent). Bestehende Tests (`retention.test.js`, `store-purge.test.js`, alle `onboarding-*`) bleiben unveraendert gruen.

---

## Lokalisierung (verifiziert 2026-06-16)

| Datei | Stelle | Aenderung |
|---|---|---|
| `src/store/json.js` | 118-121 (`save()`) | tmp+fsync+rename statt in-place writeFileSync (AC1) |
| `src/store/json.js` | 15-40 (`load()`), Wipe bei 26-29 | First-Boot vs. Korruption unterscheiden; `.corrupt`-Rename + lautes Log statt stillem Wipe (AC3) |
| `src/store/json.js` | NEU (Modul-Ebene) | `withStoreLock(fn)` Promise-Chain-Mutex exportieren (AC2) |
| `src/server.js` | 848 + 858-871 (`/api/onboard`) | `store.save()` in try/catch; I/O-Fehler → behandelter 5xx (AC4) |

**`save()` (json.js:118-121, verifiziert) — Vorher/Nachher:**
```js
// Vorher (118-121)
export function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

// Nachher (Skizze - Atomic write, AC1)
export function save() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${FILE}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(state, null, 2));
    fs.fsyncSync(fd);              // Daten muessen auf der Platte sein, BEVOR der Rename committet
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, FILE);        // atomarer Replace auf demselben FS (POSIX-Garantie)
}
```

**`load()` (json.js:15-40, verifiziert) — Vorher/Nachher (Korruptions-Pfad, AC3):**
```js
// Vorher (17-29)
try {
  state = JSON.parse(fs.readFileSync(FILE, "utf8"));
  // ... Migrationen ...
} catch {
  state = ops.makeDefaultState();   // <-- stiller Wipe + save() ueberschreibt korruptes File
  save();
}

// Nachher (Skizze)
let raw;
try {
  raw = fs.readFileSync(FILE, "utf8");
} catch (e) {
  if (e.code === "ENOENT") {        // genuine First-Boot -> Defaults OK, kein Alarm
    state = ops.makeDefaultState();
    save();
    return finishLoad();           // (seedProfilesFromEnv + seedOwnerNumber wie gehabt)
  }
  throw e;                          // unerwarteter I/O-Fehler -> nach oben (P0-Netz faengt)
}
try {
  state = JSON.parse(raw);
  // ... Migrationen 20-25 unveraendert ...
} catch {
  // File VORHANDEN aber unparsebar -> KORRUPTION, nie still wischen
  const corruptPath = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try { fs.renameSync(FILE, corruptPath); } catch (re) { console.error("[store] .corrupt-Rename fehlgeschlagen:", re.message); }
  console.error(`[store] KORRUPTES store.json erkannt - umbenannt nach ${corruptPath}. Store startet mit Defaults. DATENVERLUST moeglich, File pruefen.`);
  state = ops.makeDefaultState();
  save();                          // schreibt sauberes Default-File (das korrupte ist als .corrupt gesichert)
}
```
> **Verifizieren vor Edit:** Der Happy-Path-Teil von `load()` (Migrationen 20-25, `seedProfilesFromEnv` 30, `seedOwnerNumber` 34/38, `return state` 39) MUSS in beiden Zweigen identisch durchlaufen — am saubersten ueber einen gemeinsamen `finishLoad()`-Helper, damit kein Seed-Schritt im First-Boot- oder Korruptions-Zweig verloren geht. Sonst greift nach P3c Inbound fail-closed (Kommentar json.js:31-33).

**`withStoreLock` (json.js, NEU — AC2) — Skelett:**
```js
// Prozess-lokaler Single-Writer-Guard (OT-3 AC2). Serialisiert read-modify-write-
// Sequenzen, die ein await zwischen load() und save() haben, damit kein Lost Update
// entsteht. Innerhalb EINES Node-Prozesses teilen sich alle Caller das Modul-globale
// `state` -> ein In-Process-Mutex genuegt. Multi-Prozess-Deploy braeuchte File-Lock
// (heute n/a: Render free plan = 1 Instanz; akzeptiertes Prototyp-Risiko, PLAN-SECURITY.md).
let _writeChain = Promise.resolve();
export function withStoreLock(fn) {
  const run = () => fn();
  _writeChain = _writeChain.then(run, run);   // Fehler bricht die Kette NICHT ab
  return _writeChain;
}
```

**`/api/onboard` (server.js:828-872, verifiziert) — Save-Haertung (AC2 + AC4):**
```js
// Vorher (836-848, gekuerzt)
const s = store.load();
registerTenant(s, tenantId, { ownerName });
const reqRes = requestNumber(s, { ... });
if (!reqRes.ok) { audit(...); return res.status(...).json(...); }
store.save();                       // <-- 848: ausserhalb try/catch

// Nachher (Skizze - Save in withStoreLock + try/catch, AC2+AC4)
const reqRes = await store.withStoreLock(() => {
  const s = store.load();
  registerTenant(s, tenantId, { ownerName });
  const r = requestNumber(s, { ... });
  if (r.ok) store.save();           // Save innerhalb des kritischen Abschnitts
  return r;
}).catch((e) => {
  console.error("[onboard] Persistenz fehlgeschlagen:", e.message);
  return { ok: false, reason: "persist_error" };
});
if (!reqRes.ok && reqRes.reason === "persist_error")
  return res.status(503).json({ error: "Persistenz fehlgeschlagen" });
if (!reqRes.ok) { audit(...); return res.status(ONBOARD_REASON_STATUS[reqRes.reason] || 400).json(...); }
// ... numberId, audit, Dry-Run-Check unveraendert ...
// Der Provisioning-Block (858-871) bekommt einen zusaetzlichen Save-Fehler-Pfad:
try {
  const number = await provisionNumber(...);
  store.save();                     // 864 -> bei Fehler unten gefangen
  ...
} catch (err) {
  try { store.save(); } catch (se) { console.error("[onboard] Save nach Provisioning-Fehler fehlgeschlagen:", se.message); }
  ...
}
```
> **Caller-Check vor Edit (Pflicht, CLAUDE.md):** `grep -rn "store.save\|withStoreLock\|store.load" src/` — verifiziert: 11 `store.save()`-Caller (server.js 456/482/643/848/864/868, claude.js:244, json.js intern 128/137/...). NUR die `await`-tragenden read-modify-write-Routen (`/api/onboard`, place_call) brauchen `withStoreLock`; rein synchrone Caller (addTranscript) sind durch AC1 bereits sicher. KEINEN synchronen Caller auf das async `withStoreLock` umstellen, ohne dessen Aufrufer auf `await` zu pruefen (sonst Race statt Fix).

---

## Test-Cases (Given / When / Then)

Alle Tests `node:test`, offline, ohne `.env`. Muster aus `test/helpers.js` (Server als Kindprozess mit `PORT=0` + Temp-`DATA_DIR`) und den Unit-Tests gegen `store/json.js` direkt. Store-Unit-Tests setzen `DATA_DIR` auf ein frisches `os.tmpdir()`-Verzeichnis und importieren das json-Backend bzw. die Fassade — `data/store.json` wird NIE angefasst.

### T-P1-01: Atomic write — Crash mid-write hinterlaesst kein truncated File
- **Given** ein gueltiger Store ist geladen und einmal gespeichert.
- **When** `save()` laeuft und der Prozess unmittelbar danach (oder das tmp-File vor dem Rename) inspiziert wird.
- **Then** `store.json` ist zu JEDEM Zeitpunkt entweder der alte ODER der neue vollstaendige Inhalt — nie ein halbes File. Verifikation: nach `save()` ist `JSON.parse(readFileSync(FILE))` immer erfolgreich; ein verwaistes `.tmp`-File enthaelt nie den finalen Pfadnamen `store.json`.

### T-P1-02: Concurrent write — kein Lost Update
- **Given** zwei read-modify-write-Sequenzen mutieren disjunkte Felder (A: Usage-Counter +1, B: neue Notification), beide ueber `withStoreLock` serialisiert, mit einem `await` (Microtask) zwischen `load()` und `save()`.
- **When** beide ueberlappend gestartet werden (`Promise.all([seqA(), seqB()])`).
- **Then** der persistierte Store enthaelt BEIDE Mutationen — die Usage-Erhoehung UND die Notification. Ohne den Mutex (Negativ-Kontrolle im Test-Kommentar) wuerde die spaeter committende Sequenz die fruehere ueberschreiben. **Dies ist der Budget-Counter-Schutz aus CLAUDE.md Regel 1.**

### T-P1-03: Korrupt-File — bewahrt + geflaggt, NICHT gewischt
- **Given** im Temp-`DATA_DIR` liegt ein `store.json` mit kaputtem Inhalt (`"{ this is not json"`).
- **When** `load()` aufgerufen wird.
- **Then** (1) eine `store.json.corrupt-<timestamp>`-Datei existiert mit dem originalen kaputten Inhalt; (2) `console.error` hat eine `[store] KORRUPTES store.json`-Zeile mit dem `.corrupt`-Pfad ausgegeben; (3) der zurueckgegebene State sind Defaults (Dienst ueberlebt); (4) das NEUE `store.json` ist gueltiges JSON. KEIN stiller Datenverlust.

### T-P1-04: First-Boot — Defaults ohne Fehlalarm
- **Given** ein leeres Temp-`DATA_DIR` (kein `store.json`, `ENOENT`).
- **When** `load()` aufgerufen wird.
- **Then** der State sind Defaults, ein gueltiges `store.json` wird angelegt, und es gibt KEINE `[store] KORRUPT`-Log-Zeile (echter First-Boot wird nicht als Korruption fehlinterpretiert). Abgrenzung zu T-P1-03 ueber die An-/Abwesenheit des korrupten Files.

### T-P1-05: Onboard-Save-Failure — behandelter 5xx statt unhandled rejection
- **Given** der Server laeuft als Kindprozess (helpers.js-Muster); `store.save()` wird zum Fehlschlagen gebracht (z.B. `DATA_DIR` auf einen nach Boot read-only/entfernten Pfad gesetzt, oder ein Test-Hook der `writeFileSync` EACCES werfen laesst).
- **When** `POST /api/onboard` mit gueltiger `tenantId` aufgerufen wird.
- **Then** die Response ist ein definierter 5xx (503 `{ error: "Persistenz fehlgeschlagen" }`), der Prozess lebt weiter (kein Exit, kein `[guard] unhandledRejection` aus P0), und der Fehler ist als `[onboard] Persistenz fehlgeschlagen` geloggt.

### T-P1-06: Happy-Path-Regression — Format + Seeds unveraendert
- **Given** ein normaler Store-Lebenszyklus (Default-Boot → mutiere → `save()` → neuer `load()` in frischem Modul-Zustand).
- **When** geladen wird.
- **Then** Owner-Nummer-Seed (`seedOwnerNumber`) und `seedProfilesFromEnv` haben gegriffen (identisch zu vor P1), das JSON-Format ist `null, 2`-indented, und `retention.test.js`/`store-purge.test.js` laufen unveraendert gruen (Cross-Check: in der Verifikation mitlaufen lassen).

---

## Betroffene Dateien

| Datei | Typ | Aenderung |
|---|---|---|
| `src/store/json.js` | Source | `save()` atomic (tmp+fsync+rename); `load()` First-Boot-vs-Korruption + `.corrupt`-Rename + lautes Log; `withStoreLock` exportieren; ggf. `finishLoad()`-Helper |
| `src/server.js` | Source | `/api/onboard` (828-872): Save in `withStoreLock` + try/catch, I/O-Fehler → 503 |
| `test/store-integrity.test.js` | Test (neu) | T-P1-01, T-P1-02, T-P1-03, T-P1-04, T-P1-06 (Unit gegen json-Backend) |
| `test/onboard-persist-failure.test.js` | Test (neu) | T-P1-05 (Integration, Kindprozess via helpers.js) |
| `PLAN-SECURITY.md` | Doc | Prozess-lokaler Mutex dokumentieren; Multi-Prozess-File-Lock als akzeptiertes Prototyp-Risiko festhalten |

**Caller-Check vor Edit (Pflicht, CLAUDE.md):** `grep -rn "store.save\|store.load\|withStoreLock" src/` — Budget-Engine UND Realtime-Bridge nutzen den Store; sicherstellen, dass kein synchroner Caller auf das async `withStoreLock` umgestellt wird, ohne dessen `await`-Kontext zu pruefen.

---

## Verifikation

```
node --check src/store/json.js     # Syntax
node --check src/server.js         # Syntax
npm test                            # alle Tests gruen, T-P1-01..06 bestehen
```

Erwartetes Ergebnis: 0 Failures; T-P1-01 bis T-P1-06 bestehen; `retention.test.js`, `store-purge.test.js`, alle `onboarding-*.test.js` unveraendert gruen.

**Smoke-Test (manuell, optional aber empfohlen):**
```
# 1. Korruptions-Pfad live
PORT=3999 DATA_DIR=/tmp/p1smoke SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # bootet, legt store.json an
# Server stoppen, dann store.json kaputt machen:
echo "{ broken" > /tmp/p1smoke/store.json
PORT=3999 DATA_DIR=/tmp/p1smoke SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # -> [store] KORRUPT-Log + .corrupt-File
ls /tmp/p1smoke/                                                              # store.json.corrupt-<ts> vorhanden
# 2. Concurrent-Onboard (zwei parallele curls gegen /api/onboard) -> beide persistiert, kein Lost Update
```

---

## Risiken / Pre-Mortem (1 Jahr in der Zukunft, P1 war falsch)

- **Atomic-Rename-Semantik weicht auf dem Deploy-FS ab.** `fs.renameSync` ist nur atomar, wenn tmp und Ziel auf DEMSELBEN Filesystem liegen. Render-Disks/overlayfs koennten cross-device-Renames (`EXDEV`) werfen, wenn `os.tmpdir()` auf einem anderen Mount liegt. **Mitigation:** das tmp-File IMMER im selben Verzeichnis wie `FILE` anlegen (`${FILE}.tmp-...`), nie in `os.tmpdir()`. T-P1-01 verifiziert den Rename auf dem realen Ziel-Verzeichnis. Falls `EXDEV` trotzdem auftritt: explizit fangen, loggen, auf eine bewusst-akzeptierte Nicht-Atomic-Fallback-Strategie zurueckfallen (in PLAN-SECURITY.md dokumentieren).
- **Mutex-Deadlock / Re-Entrancy.** Wenn innerhalb eines `withStoreLock(fn)`-Bodies erneut `withStoreLock` aufgerufen wird (verschachtelt), haengt die Promise-Chain (der innere `then` wartet auf den aeusseren, der nie aufloest). **Mitigation:** `withStoreLock`-Bodies halten KEINE weiteren `withStoreLock`-Aufrufe; kritische Abschnitte sind kurz (load → mutiere → save, kein fremdes `await`). Ein Body-Throw bricht die Kette NICHT ab (`.then(run, run)`), damit ein Fehler nicht alle folgenden Writes blockiert. Im Code-Kommentar als Hard-Rule festhalten.
- **fsync-Performance.** `fsyncSync` pro `save()` kostet Latenz; bei haeufigen Transcript-Appends (claude.js:244) waehrend eines Calls koennte das spuerbar werden. **Mitigation:** akzeptiert — Korrektheit vor Latenz fuer einen Kostengate-tragenden Store; der Append-Pfad ist synchron + niedrigfrequent (pro Gespraechsturn, nicht pro Audio-Frame). Falls je ein Problem: write-coalescing in einer spaeteren Phase, NICHT hier.
- **Budget-Counter-Rollback bleibt das Kern-Kostenrisiko (CLAUDE.md Regel 1).** Genau dieser Lost-Update-Pfad (zwei Writes, einer ueberschreibt den Usage-Counter des anderen) untergraebt das Budget-Gate. **Mitigation:** AC2 + T-P1-02 sind direkt darauf gemuenzt. Falls der Mutex eine Counter-Mutation NICHT umschliesst, zaehlt das Gate weiter falsch — deshalb beim Edit JEDE Usage-mutierende read-modify-write-Sequenz auf `withStoreLock` pruefen, nicht nur `/api/onboard`.
- **Korruptions-Rename schlaegt selbst fehl (EACCES).** Wenn das `.corrupt`-Rename wirft (read-only FS), darf der Dienst nicht crashen, aber auch nicht still wischen. **Mitigation:** der Rename ist in eigenem try/catch (siehe Skizze); schlaegt er fehl, wird das geloggt UND das Default-`save()` ueberschreibt das korrupte File trotzdem nicht ueber den Rename-Pfad — Restrisiko (Default-save ueberschreibt) in PLAN-SECURITY.md als bewusst akzeptiert vermerken, da Dienst-Ueberleben Vorrang hat und das laute Log die Spur sichert.
- **First-Boot-vs-Korruption-Fehlklassifikation.** Verlaesst sich die Unterscheidung auf `e.code === "ENOENT"`, koennte ein anderer Read-Fehler (EACCES auf existierendem File) faelschlich in den Korruptions- ODER First-Boot-Pfad fallen. **Mitigation:** Read-Fehler != ENOENT werden re-thrown (P0-Netz faengt sie sichtbar), NICHT als First-Boot behandelt. T-P1-04 deckt nur den echten ENOENT-Fall ab; im Edit darauf achten, dass nur ENOENT → Defaults gilt.
