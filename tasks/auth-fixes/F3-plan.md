# F3 — jwksCache-Invalidierung nach Discovery-Refresh + Kommentar-Korrektur

**Fix-ID:** F3  
**Prioritaet:** HIGH  
**Branch:** feat/auth-tenant-foundation  
**Dateien:** `src/web-auth.js`, `test/web-auth-oidc.test.js` (neu)

---

## Problem (Ist-Zustand)

`makeOidc` in `src/web-auth.js` haelt zwei unabhaengige Caches:

| Variable | Beschreibung |
|---|---|
| `discoveryCache` / `discoveryCachedAt` | OIDC Discovery-Dokument, TTL = 1 h (`DISCOVERY_TTL_MS`) |
| `jwksCache` | `RemoteJWKSet`-Instanz, NIE invalidiert |

**Bug-Pfad:** Nach TTL-Ablauf ruft `discover()` das Discovery-Dokument neu ab und
speichert ggf. eine neue `jwks_uri`. `getJwks()` prueft jedoch nur
`if (jwksCache)` — die alte `RemoteJWKSet`-Instanz bleibt. Der Kommentar
(Z. 142-144) behauptet, der TTL fange eine `jwks_uri`-Rotation auf — das ist
faktisch falsch (C2-Verstoss). Nach einer Key-URI-Rotation schlaegt JEDE
`jwtVerify`-Pruefung fehl, bis der Node-Prozess neu startet.

---

## Akzeptanzkriterien (binaer pruefbar)

AC1. Nach dem ersten `getJwks()`-Aufruf wird `jwksCache` mit einer
     `RemoteJWKSet`-Instanz belegt.

AC2. Wenn `discover()` den Cache nach TTL-Ablauf neu laedt UND die `jwks_uri`
     sich dabei aendert, ist `jwksCache` danach `null`, sodass der naechste
     `getJwks()`-Aufruf eine neue Instanz mit der aktualisierten URI erstellt.

AC3. Wenn `discover()` den Cache nach TTL-Ablauf neu laedt und die `jwks_uri`
     unveraendert bleibt, ist `jwksCache` ebenfalls `null` (einfachste korrekte
     Implementierung; Mehrkosten vernachlaessigbar, da RemoteJWKSet intern
     cacht).

AC4. Wenn `discover()` den Cache NICHT neu laedt (TTL noch gueltig), bleibt
     `jwksCache` unveraendert (keine unnoetige Invalidierung).

AC5. Der Kommentar bei `discover()` (Z. 142-144) beschreibt das tatsaechliche
     Verhalten korrekt: TTL veranlasst discovery-Refresh UND jwksCache-Reset.

AC6. Alle bestehenden Tests (`npm test`) bleiben gruen.

---

## Test-Cases (test/web-auth-oidc.test.js, neu)

Alle Tests importieren nur `makeOidc` aus `../src/web-auth.js`. Kein pg, kein
Express, kein Netz — `fetch` wird per DI-Injection durch einen sync-Fake
ersetzt (analog zu den Fake-Deps in `web-auth.test.js`).

Da `makeOidc` intern `fetch` global nutzt, wird `globalThis.fetch` fuer die
Dauer des Tests durch eine kontrollierte Stub-Funktion ersetzt und danach
wiederhergestellt.

### Hilfsfunktion: `makeOidcWithFakeFetch`

Baut eine `makeOidc`-Instanz, deren interner `fetch`-Aufruf durch einen
konfigurierbaren Stub ersetzt wird. Gibt `{ oidc, getCallCount, setJwksUri }`
zurueck.

```
Vorbedingung fuer alle Tests:
  globalThis.fetch = fakeFetch (liefert kontrollierte Discovery-JSON)
  Nach Test: globalThis.fetch wiederherstellen
```

---

### T1 — jwksCache wird beim ersten Aufruf belueckt

**Given:** Frische `makeOidc`-Instanz, `jwksCache` intern `null`.  
**When:** `getJwks()` wird zum ersten Mal aufgerufen.  
**Then:** Rueckgabe ist ein Objekt (truthy); ein zweiter Aufruf von `getJwks()`
liefert dieselbe Instanz (Referenz-Gleichheit) ohne erneuten `fetch`.

Prueft AC1. Stellt sicher, dass der Cache befuellt wird und bei gueltigem TTL
gehalten bleibt.

---

### T2 — jwksCache wird nach Discovery-Refresh auf null gesetzt

**Given:** `makeOidc`-Instanz, TTL bereits abgelaufen (discoveryCachedAt = 0
via Fake-Zeit oder via direktem Setzen der Closure-Variable durch Export-Hook).  
Konkreter Ansatz: `DISCOVERY_TTL_MS` wird per Config auf `0` gesetzt (neuer
optionaler Parameter `_discoveryTtlMs` fuer Tests, Default `3_600_000`).  
**When:** `getJwks()` wird aufgerufen (loest intern discover() aus, das den
Cache erneuert, dann `jwksCache` zuruecksetzt).  
**Then:** `getJwks()` liefert eine neue Instanz; insgesamt wurden zwei
`fetch`-Aufrufe gemacht (einmal vor, einmal nach TTL-Ablauf).

Prueft AC2/AC3.

---

### T3 — Kein jwksCache-Reset wenn TTL noch gueltig

**Given:** `makeOidc`-Instanz, `getJwks()` bereits einmal aufgerufen
(Cache warm, TTL noch gueltig — `_discoveryTtlMs` = 3_600_000, Zeit nicht
manipuliert).  
**When:** `getJwks()` ein zweites Mal aufgerufen.  
**Then:** Rueckgabe ist dieselbe Objekt-Referenz wie beim ersten Aufruf;
`fetch` wurde nur einmal aufgerufen.

Prueft AC4.

---

### T4 — Kommentar-Korrektheit (strukturell, kein Runtime-Test)

Kein Laufzeit-Test noetig (Kommentar ist statisch). Dieser AC wird durch
Code-Review des Diff abgehakt (im Plan vermerkt, kein Test-Case im Code).

---

## Implementierungs-Plan

### Schritt 1 — Testdatei anlegen (TDD: Tests zuerst, ROT)

Neue Datei `test/web-auth-oidc.test.js` mit T1, T2, T3.

Teststruktur:
- `globalThis.fetch` Stub per `test` mit `before`/`after`-Hook oder manuellem
  Save/Restore.
- `makeOidc` erhaelt optionalen dritten Parameter `{ _discoveryTtlMs }` fuer
  Testbarkeit (Default = `DISCOVERY_TTL_MS`).
- Alternativ (ohne API-Aenderung): Time-Injection via `Date.now`-Stub auf
  `globalThis`. Bevorzugte Methode: optionaler Parameter — weniger invasiv,
  lokal eingegrenzt.

### Schritt 2 — Fix in src/web-auth.js (GRUEN)

**a) Optionaler TTL-Parameter:**

```js
export function makeOidc(config, { _discoveryTtlMs = DISCOVERY_TTL_MS } = {}) {
```

Einzige API-Erweiterung; alle bestehenden Aufrufer sind unberuehrt (Default).

**b) jwksCache nach Discovery-Refresh invalidieren:**

In `discover()`, direkt nach `discoveryCache = await r.json()` / nach dem
Neuladen:

```js
// Neuladen: jwksCache zuruecksetzen, damit getJwks() die (evtl. neue)
// jwks_uri neu aufloest statt die alte RemoteJWKSet-Instanz zu behalten.
jwksCache = null;
```

Exakte Stelle: unmittelbar nach `discoveryCachedAt = Date.now()` (Z. 151),
vor `return discoveryCache`.

**c) Kommentar korrigieren (C2-Fix):**

Z. 142-144 von:
```js
// TTL, damit eine Endpoint-/jwks_uri-Rotation beim IdP ohne Prozess-Neustart
// aufgefangen wird (sonst brechen alle Logins bis zum Restart).
```
nach:
```js
// TTL fuer das Discovery-Dokument. Beim Ablauf wird jwksCache ebenfalls
// zurueckgesetzt, damit eine jwks_uri-Rotation beim IdP ohne Prozess-Neustart
// aufgefangen wird (sonst brechen alle Logins bis zum Restart).
```

### Schritt 3 — Verifikation

```
node --check src/web-auth.js
npm test
```

Alle Tests gruen. T1/T2/T3 gruen beweisen AC1-AC4.

---

## Risiken / Pre-Mortem

| Risiko | Wahrscheinlichkeit | Massnahme |
|---|---|---|
| `globalThis.fetch`-Stub verschmutzt andere Tests | mittel | Save/Restore in jedem Test-Block; Tests sind Independent (P12-I) |
| Optionaler Parameter bricht bestehende Aufrufer | niedrig | Default-Wert identisch mit bisheriger Konstante; nur neue Tests nutzen Override |
| `createRemoteJWKSet` selbst cached intern | niedrig | Bewusst akzeptiert: bei Rotation wird eine neue Instanz erstellt, die alte wird GC'd; jose-interne Cache-Dauer ist kurz |
| `discover()` wirft vor `discoveryCachedAt = Date.now()` — jwksCache bleibt gesetzt | niedrig | Fix-Stelle ist nach dem erfolgreichen `r.json()`-Aufruf; Exception-Pfad aendert beide Variablen nicht (Ist-Zustand bleibt, kein Regressions-Risiko) |

---

## Betroffene Dateien

| Datei | Aktion |
|---|---|
| `src/web-auth.js` | Fix: `discover()` setzt `jwksCache = null` nach Refresh; Kommentar korrigiert; optionaler `_discoveryTtlMs`-Parameter |
| `test/web-auth-oidc.test.js` | Neu: T1, T2, T3 (unit, kein Netz, kein pg) |

Unveraendert: `test/web-auth.test.js`, `test/web-auth-pg.test.js`, alle anderen `src/`-Dateien.
