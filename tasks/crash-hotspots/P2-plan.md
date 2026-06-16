# P2 — Safety-Gates fail-closed (OT-4)

## Orchestrierung (Parallelisierung)

| Feld | Wert |
|---|---|
| Phase | P2 — Safety-Gates fail-closed (OT-4) |
| Prerequisite | **P0 merged to master** |
| Parallel-safe mit | P1, P3 (disjunkte Files; einzige `server.js`-Beruehrung ist die `assertConfig`/`listen`-Region ~921, getrennt von P1's `/api/onboard`-Region) |
| Conflict-Files | `src/server.js` (NUR ~921 `assertConfig`/`listen`-Region; baut auf P0's `listen`-Aenderungen auf) — bei Merge koordinieren |
| Empfohlener Branch | `feat/crash-p2-failclosed-gates` |
| Severity | **High** |
| Verifikation gesamt | `npm test` gruen + Boot-Refusal-Smoke-Test (NaN-Budget-Env -> Exit 1) |

> **Warum P0 zuerst:** P0 fasst den Boot-/`listen`-Pfad an (`server.js:922` `app.listen`, Boot-Block 131-166). P2 fuegt in dieselbe Boot-Region (server.js:921 `const ok = assertConfig();`) eine harte Boot-Verweigerung ein. Wird P2 vor P0 gemerged, kollidiert der `listen`-Block doppelt. Reihenfolge: erst P0 (Crash-Netz + Boot-Entkopplung), dann P2 auf dessen `listen`-Stand aufsetzen.

---

## Problem

Die unheimlichste Crash-Klasse aus der Analyse (OT-4) crasht **nicht laut, sie failt leise OPEN**: ein Safety-/Kosten-Gate schaltet sich ohne jedes Signal ab. Das verletzt CLAUDE.md Absolute Rule 1 (Safety-Gates duerfen NIE umgangen werden) und Rule 2 (Offenlegung fest verdrahtet) unsichtbar — schlimmer als ein Crash, weil kein Log, kein Alert, kein failender Test.

**Teil A — NaN-Budget deaktiviert den Budget-Guard still.** `config.js:11`:
```js
maxBudgetEur: parseFloat(process.env.MAX_BUDGET_EUR || "8"),
```
`parseFloat("acht")` -> `NaN`. Der Budget-Guard prueft (sinngemaess) `costEur >= config.maxBudgetEur`. Jeder Vergleich `x >= NaN` ist **immer `false`** -> der Guard blockt nie -> der Outbound-Call laeuft ohne Kostengrenze. Ein Tippfehler in einer Render-Env-Var schaltet damit lautlos das wichtigste Kosten-Gate ab (R4 Toll-Fraud / Kosten-Explosion). Dasselbe Muster gilt fuer **jede** numerische Env-Parse ohne `Number.isFinite`-Validierung (siehe Lokalisierung).

**Teil B — `assertConfig` throwt nie, der Boot ignoriert das Ergebnis.** `config.js:153-190`: `assertConfig()` sammelt fehlende Pflicht-Config in `missing[]`, gibt aber bei Fehlern nur `console.error(...)` aus und `return missing.length === 0;` — **kein Throw, kein Exit**. `server.js:921`:
```js
const ok = assertConfig();
const httpServer = app.listen(config.port, () => { ... });
```
`ok` wird berechnet, danach bootet der Server **bedingungslos**. `ok` wird einzig in `server.js:939` fuer eine kosmetische Log-Zeile (`if (!ok) console.log("  ACHTUNG: .env unvollstaendig ...")`) genutzt. Effekt: Ein Dienst mit fehlendem `TWILIO_AUTH_TOKEN`, fehlender `DATABASE_URL` (bei `STORE_BACKEND=pg`) oder NaN-Budget startet trotzdem und nimmt Anrufe an — mit halb-funktionalen oder abgeschalteten Garantien.

**Teil C — disclosureSentence ungetestet (Rule-2-Regression latent).** `claude.js:58-61` definiert den fest verdrahteten Offenlegungssatz; `claude.js:53` verdrahtet ihn als PFLICHT-ersten-Satz in den Outbound-System-Prompt. Der Tool-Loop / die Prompt-Konstruktion sind laut Analyse **0-coverage**. Commit `0fefd5d` hat genau diesen Satz im Fehlerpfad schon einmal reparieren muessen. Ein Refactor koennte ihn droppen, umordnen oder vom ersten Satz verdraengen — **ohne dass ein Test failt**.

**Teil D — Originate-Fehler-Response leakt rohe Provider-Message (Verifikations-Item, jetzt verifiziert).** Offenes Item aus der Analyse (`server.js:649-655`): bestaetigt. Der catch interpoliert die rohe Provider-Fehlermeldung in die HTTP-500-Antwort:
```js
} catch (err) {
  store.endCallRecord(call.id, "failed");
  res.status(500).json({
    error: err.message,                 // <-- rohe Provider-Message an den Client
    hint: "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein.",
  });
}
```
Provider-SDK-Fehler koennen URL-/Param-Fragmente (inkl. `from`/`to`-Nummern, Auth-Hinweise, Account-SID-Fragmente) enthalten. Diese ungefiltert an den Aufrufer zurueckzugeben ist ein potenzielles Secret-/Param-Leak (CLAUDE.md Rule 4/5). -> als AC5 in P2 gefaltet.

---

## Soll-Zustand (Akzeptanzkriterien)

**AC1 — `Number.isFinite`-Guards auf ALLE numerischen Env-Parses.** Jede `parseFloat`/`parseInt`-Auswertung einer Env-Variable in `config.js` wird gegen `Number.isFinite` validiert. Bei `NaN`/`Infinity`/`-Infinity` ist das Ergebnis **kein stiller no-op**, sondern wird als fataler Config-Fehler erfasst (sammelbar fuer AC3). Eine zentrale Helper-Funktion (z.B. `numEnv(name, value, { min, max, fallback })`) parst + validiert + dokumentiert die verletzte Erwartung. Betroffen (verifizierte Zeilen):

| Zeile | Feld | Aktuell |
|---|---|---|
| `config.js:11` | `maxBudgetEur` | `parseFloat(process.env.MAX_BUDGET_EUR \|\| "8")` |
| `config.js:40` | `port` | `parseInt(process.env.PORT \|\| "3000", 10)` |
| `config.js:58` | `maxCallsPerHour` | `parseInt(process.env.MAX_CALLS_PER_HOUR \|\| "6", 10)` |
| `config.js:64` | `maxNumbers` | `parseInt(process.env.MAX_NUMBERS \|\| "5", 10)` |
| `config.js:66` | `maxNumbersPerTenant` | `parseInt(process.env.MAX_NUMBERS_PER_TENANT \|\| "1", 10)` |
| `config.js:92` | `maxCallDurationS` | `Math.min(parseInt(... \|\| "180", 10), 300)` |
| `config.js:95` | `rateLimitPerMin` | `parseInt(process.env.RATE_LIMIT_PER_MIN \|\| "120", 10)` |
| `config.js:102` | `retentionDays` | `parseInt(process.env.RETENTION_DAYS \|\| "30", 10)` |
| `config.js:130` | `loginRateLimitPerMin` | `parseInt(process.env.LOGIN_RATE_LIMIT_PER_MIN \|\| "10", 10)` |
| `config.js:132` | `sessionTtlSeconds` | `parseInt(process.env.SESSION_TTL_SECONDS \|\| "3600", 10)` |

> **Safety-kritisch zuerst:** `maxBudgetEur`, `maxCallsPerHour`, `maxNumbers`, `maxNumbersPerTenant`, `maxCallDurationS` sind direkte Gate-Werte (Rule 1) — ihr NaN muss IMMER Boot-Refusal ausloesen. `maxCallDurationS:92`: das `Math.min(NaN, 300)` ergibt `NaN` (nicht `300`) -> heute waere der Max-Dauer-Cap bei NaN-Env still aus. Die uebrigen (`port`, Rate-Limits, `retentionDays`, Session-TTL) sind Robustheits-Werte; ihr NaN ebenfalls als Boot-Refusal behandeln (einheitliche fail-closed-Regel, kein Sonderfall der spaeter zur Luecke wird).

**AC2 — Negative/unsinnige Gate-Werte ebenfalls fatal.** Ein negativer `MAX_BUDGET_EUR` (z.B. `-1`) wuerde den Guard ebenso aushebeln wie NaN (`costEur >= -1` quasi immer true -> hier umgekehrt: jeder Call sofort geblockt; das ist fail-closed und akzeptabel, ABER ein negativer Wert signalisiert Fehlkonfiguration). Gate-Werte muessen ihren erlaubten Bereich erfuellen: `maxBudgetEur >= 0`, `maxCallsPerHour >= 0`, `maxNumbers >= 0`, `maxNumbersPerTenant >= 0`, `maxCallDurationS >= 1`. Verletzung -> fataler Config-Fehler (kein stiller Clamp, damit Fehlkonfiguration sichtbar wird). `0` bleibt fuer die Not-Aus-Gates (`maxCallsPerHour=0`, `maxNumbers=0`) ein **gueltiger** Wert (dokumentiert in `config.js:57/63` als "Not-Aus").

**AC3 — `assertConfig` signalisiert Fatal statt nur zu loggen.** `assertConfig()` (config.js:153) sammelt weiterhin alle Befunde, gibt sie als zusammenhaengende, **actionable** Diagnose aus (welche Var, welche Erwartung, wie zu setzen) und signalisiert dem Aufrufer **eindeutig** einen Fatal-Zustand bei (a) fehlender Pflicht-Safety-Config ODER (b) ungueltiger numerischer Config (AC1/AC2). Umsetzungsfreiheit: entweder `assertConfig()` wirft selbst (`throw new Error(...)`), oder es liefert weiterhin `false` und der Aufrufer in server.js erzwingt den Exit (AC4). **Empfehlung:** Boolean-Rueckgabe beibehalten (rueckwaerts-kompatibel mit bestehenden Tests, die `assertConfig()` aufrufen) und den Exit am Aufruf-Punkt erzwingen — so bleibt `assertConfig` ohne Seiteneffekt unit-testbar. Die reinen *Hinweis*-Checks (DASHBOARD_PASSWORD, SKIP_TWILIO_SIGNATURE_CHECK, http-Issuer-Warnung, Self-Service-Hinweis — config.js:172-188) bleiben Warnungen und loesen KEINEN Boot-Stop aus (sie sind bewusst weich).

**AC4 — `server.js:921` ehrt das Ergebnis: Boot verweigern bei ungueltiger Safety-Config.** Statt `ok` zu berechnen und zu ignorieren, refuset der Boot bei Fatal-Config sauber: **kein `app.listen`**, klare Diagnose auf stderr, `process.exit(1)`. `/voice`, `/mcp`, Dashboard werden bei Fatal-Config NICHT gemountet (der Prozess startet gar nicht erst). Koordination mit P0: P0 veraendert den `app.listen`-Pfad (server.js:922) und die store-pg-Fatal-Logik; P2 setzt die Config-Boot-Verweigerung **vor** `app.listen` und baut auf P0's diagnostiziertem-Exit-Muster (P0 AC6) auf — gleiche secret-freie Logging-Disziplin wiederverwenden.

**AC5 — Originate-Fehler-Response leakt keine rohe Provider-Message.** `server.js:649-655`: die HTTP-500-Antwort gibt **keine** rohe `err.message` mehr an den Client. Stattdessen eine generische, stabile Fehlermeldung + der bestehende statische `hint`. Die rohe Provider-Message wird **serverseitig** (Log, secret-frei wie P0-Guards) festgehalten, nicht im Response-Body. Bestehende Aufrufer/Tests, die auf `error` im 500-Body pruefen, anpassen (Caller-Check Pflicht, s.u.).

**AC6 — disclosureSentence-Regressionstest.** Ein automatisierter node:test-Case haelt fest, dass (a) `disclosureSentence(call)` mit dem fest verdrahteten Wortlaut beginnt und den `callerName`/`ownerName` einsetzt, und (b) der von `systemPrompt(call)` erzeugte **Outbound**-Prompt den Offenlegungssatz als PFLICHT-ersten-Satz enthaelt (Substring-Match auf den verdrahteten Satz + auf die "Dein allererster Satz muss exakt lauten"-Klausel aus claude.js:53). Damit kann ein Refactor den Satz nicht still droppen oder hinter andere Saetze schieben, ohne den Test rot zu faerben.

**AC7 — Bestehende Tests bleiben gruen.** Aktueller Stand der Suite bleibt 0 Failures. Neue Tests decken AC1-AC6 ab (s.u.). Legitime, vollstaendig konfigurierte Deploys booten unveraendert.

---

## Lokalisierung (verifiziert 2026-06-16)

| Datei | Stelle | Aenderung |
|---|---|---|
| `src/config.js` | 11, 40, 58, 64, 66, 92, 95, 102, 130, 132 | `numEnv()`-Helper einfuehren; jede numerische Env-Parse darueber validieren (AC1/AC2) |
| `src/config.js` | 153-190 (`assertConfig`) | numerische Fatal-Befunde einsammeln; eindeutiges Fatal-Signal + actionable Diagnose (AC3); Hinweis-Checks 172-188 bleiben weich |
| `src/server.js` | 921 | `ok` ehren: bei Fatal-Config kein `app.listen`, stderr-Diagnose, `process.exit(1)` (AC4) — auf P0's `listen`-Stand |
| `src/server.js` | 649-655 | rohe `err.message` aus 500-Response entfernen; generische Meldung + serverseitiges secret-freies Log (AC5) |
| `src/claude.js` | 53, 58-61 | KEINE Source-Aenderung — nur Regressionstest gegen den Bestand (AC6) |

**`config.js` numEnv-Helper (NEU) — Skelett:**
```js
// Numerische Env-Var parsen UND validieren. NaN/Infinity oder Bereichsverletzung
// werden NICHT still verschluckt (sonst Safety-Gate lautlos aus, OT-4), sondern
// in fatalErrors[] gesammelt -> assertConfig signalisiert Fatal -> Boot verweigert.
const fatalConfigErrors = [];
function numEnv(name, raw, { fallback, min, max, integer = true }) {
  const source = raw === undefined || raw === "" ? String(fallback) : raw;
  const n = integer ? parseInt(source, 10) : parseFloat(source);
  if (!Number.isFinite(n)) {
    fatalConfigErrors.push(`${name}="${raw}" ist keine gueltige Zahl (erwartet: ${integer ? "Ganzzahl" : "Zahl"}${min !== undefined ? `, >= ${min}` : ""}).`);
    return fallback;        // Wert irrelevant: Boot wird ohnehin verweigert
  }
  if (min !== undefined && n < min) {
    fatalConfigErrors.push(`${name}=${n} unterschreitet das Minimum ${min}.`);
    return fallback;
  }
  if (max !== undefined && n > max) return Math.min(n, max);   // Clamp nur bei Obergrenzen wie maxCallDurationS
  return n;
}
export function configFatalErrors() { return fatalConfigErrors.slice(); }
```
> `fatalConfigErrors` ist Modul-Scope; `assertConfig` liest es zusaetzlich zu `missing[]`. `numEnv` als benannte, exportierbare Funktion -> direkt unit-testbar ohne echten Boot. Default-Werte unveraendert (8 / 3000 / 6 / 5 / 1 / 180 / 120 / 30 / 10 / 3600).

**`config.js:153` assertConfig — schematische Erweiterung:**
```js
export function assertConfig() {
  const missing = [];
  // ... bestehende presence-Checks 154-164 unveraendert ...
  const fatal = configFatalErrors();            // NEU: numerische Fatal-Befunde
  if (missing.length || fatal.length) {
    console.error("\n[Konfiguration fatal] Boot wird verweigert:");
    for (const m of missing) console.error(`  - fehlt: ${m}`);
    for (const f of fatal) console.error(`  - ${f}`);
    console.error("(.env pruefen; .env.example als Vorlage)\n");
  }
  // ... bestehende WEICHE Hinweis-Checks 172-188 unveraendert (kein Boot-Stop) ...
  return missing.length === 0 && fatal.length === 0;   // NEU: fatal faellt in den Return
}
```

**`server.js:921` — Vorher/Nachher (auf P0-Stand):**
```js
// Vorher (921-940)
const ok = assertConfig();
const httpServer = app.listen(config.port, () => { ... ; if (!ok) console.log("  ACHTUNG: .env unvollstaendig ...") });

// Nachher
const ok = assertConfig();
if (!ok) {
  console.error("[boot] Start abgebrochen: Safety-/Pflicht-Konfiguration ungueltig (siehe oben).");
  process.exit(1);                 // fail-closed: lieber kein Dienst als ein Dienst ohne Gates
}
const httpServer = app.listen(config.port, () => { ... });   // unveraendert, ok-Warnzeile entfaellt
```
> **Vor Edit pruefen (P0-Koordination):** P0 fasst denselben `app.listen`-Pfad an. Sicherstellen, dass die Boot-Verweigerung VOR `app.listen` und VOR `attachMediaBridge(httpServer, ...)` (server.js:943) sitzt — sonst wuerde die Bridge an einen nie gestarteten Server gehaengt. Die `store.load()`- und Retention-Zeilen (909-919) bleiben unberuehrt.

**`server.js:649` — Vorher/Nachher:**
```js
// Vorher (649-655)
} catch (err) {
  store.endCallRecord(call.id, "failed");
  res.status(500).json({ error: err.message, hint: "Twilio-Trial: ..." });
}

// Nachher
} catch (err) {
  store.endCallRecord(call.id, "failed");
  console.error(`[place_call] originate fehlgeschlagen call=${call.id}:`, err?.message || String(err));  // serverseitig, secret-frei
  res.status(500).json({ error: "Anruf konnte nicht gestartet werden.", hint: "Twilio-Trial: Die Zielnummer muss unter 'Verified Caller IDs' verifiziert sein." });
}
```

---

## Test-Cases (Given / When / Then)

Alle Tests laufen in node:test **offline** (kein Netz, kein echtes Twilio). Numerik- und Disclosure-Tests sind reine Unit-Tests gegen exportierte Funktionen; die Boot-Refusal-Tests starten den Server als Kindprozess (Muster aus bestehenden Integrationstests: `PORT=0`, `DATA_DIR`-Override -> `data/store.json` unberuehrt) und pruefen Exit-Code + stderr.

**T-P2-01 — NaN-Budget -> numEnv sammelt Fatal.** Given `numEnv("MAX_BUDGET_EUR", "acht", { fallback: 8, min: 0, integer: false })`. When aufgerufen. Then `configFatalErrors()` enthaelt einen Eintrag, der `MAX_BUDGET_EUR` nennt.

**T-P2-02 — Gueltiges Budget -> kein Fatal, korrekter Wert.** Given `numEnv("MAX_BUDGET_EUR", "12.5", { fallback: 8, min: 0, integer: false })`. When aufgerufen. Then Rueckgabe `12.5`, `configFatalErrors()` leer.

**T-P2-03 — Negativer Gate-Wert -> Fatal.** Given `numEnv("MAX_CALLS_PER_HOUR", "-1", { fallback: 6, min: 0 })`. When aufgerufen. Then `configFatalErrors()` enthaelt einen Eintrag, der das Minimum nennt. (Abgrenzung: `"0"` -> kein Fatal, gueltiger Not-Aus.)

**T-P2-04 — maxCallDurationS NaN -> Fatal (nicht stilles 300).** Given `numEnv("MAX_CALL_DURATION_S", "lang", { fallback: 180, min: 1, max: 300 })`. When aufgerufen. Then Fatal gesammelt — beweist, dass das fruehere `Math.min(NaN,300)`-Loch geschlossen ist.

**T-P2-05 — assertConfig faellt bei numerischem Fatal.** Given gesetzte Pflicht-Env (Anthropic/Twilio/PublicUrl vorhanden) ABER ein numerischer Fatal in `configFatalErrors()`. When `assertConfig()`. Then Rueckgabe `false`; stderr-Diagnose nennt die verletzte Var.

**T-P2-06 — Boot verweigert bei NaN-Budget (Integration, KERN-Beweis).** Given Server-Kindprozess mit allen Pflicht-Env gesetzt + `MAX_BUDGET_EUR=acht`, `PORT=0`. When gestartet. Then Exit-Code 1; stderr enthaelt "[boot] Start abgebrochen" + nennt `MAX_BUDGET_EUR`; **kein** "Gateway laeuft"-Log.

**T-P2-07 — Boot verweigert bei fehlender Pflicht-Safety-Env (Integration).** Given Kindprozess **ohne** `TWILIO_AUTH_TOKEN` (Rest gesetzt), `PORT=0`. When gestartet. Then Exit-Code 1; stderr nennt `TWILIO_AUTH_TOKEN`.

**T-P2-08 — Vollstaendige Config bootet (Integration, Regressions-Schutz).** Given Kindprozess mit allen Pflicht-Env gesetzt + gueltigen Zahlen, `PORT=0`, `SKIP_TWILIO_SIGNATURE_CHECK=true`. When gestartet. Then Prozess lebt; `GET /healthz` -> 200. (Beweist: P2 bricht legitime Boots nicht.)

**T-P2-09 — disclosureSentence Wortlaut + Einsetzung.** Given `call = { callerName: "Jonas", tenantId: OWNER_TENANT_ID }`. When `disclosureSentence(call)`. Then Rueckgabe beginnt mit "Guten Tag, hier spricht ein KI-Assistent im Auftrag von " und enthaelt "Jonas" sowie "wird fuer meinen Auftraggeber zusammengefasst".

**T-P2-10 — Outbound-Prompt verdrahtet Disclosure als ersten Satz (Regression Rule 2).** Given `call = { direction: "outbound", goal: "Termin", tenantId: OWNER_TENANT_ID, ... }`. When `systemPrompt(call)`. Then Rueckgabe enthaelt den exakten `disclosureSentence(call)`-Satz UND die Klausel "Dein allererster Satz muss exakt lauten". (Inbound-Prompt enthaelt ihn NICHT — Gegenprobe optional.)

**T-P2-11 — Originate-Fehler leakt keine rohe Message (Integration oder Unit am Handler).** Given Originate-Pfad mit gefaketem Provider, dessen `originateCall` mit `new Error("connect ECONNREFUSED 10.0.0.1:443 token=abc")` rejected. When `POST /api/calls`. Then 500-Response-Body `error` ist die generische Meldung ("Anruf konnte nicht gestartet werden."); Body enthaelt NICHT die Substrings "ECONNREFUSED"/"token=abc". (Provider via bestehender DI/Fake-Seam; falls keine Seam vorhanden, als Verifikations-Item nach P4 verschieben und AC5 dort umsetzen — s. Risiken.)

---

## Betroffene Dateien

| Datei | Typ | Aenderung |
|---|---|---|
| `src/config.js` | Source | `numEnv()`-Helper + `configFatalErrors()`; alle 10 numerischen Parses darueber; `assertConfig` faellt bei Fatal |
| `src/server.js` | Source | `server.js:921` Boot-Verweigerung bei `!ok`; `server.js:649-655` Response ohne rohe `err.message` |
| `src/claude.js` | — | unveraendert (nur Test) |
| `test/config-failclosed.test.js` | Test (neu) | T-P2-01..05 (numEnv + assertConfig) |
| `test/boot-failclosed.test.js` | Test (neu) | T-P2-06..08 (Kindprozess, Exit-Code) |
| `test/disclosure-regression.test.js` | Test (neu) | T-P2-09..10 |
| `test/place-call-error.test.js` | Test (neu/ergaenzen) | T-P2-11 (falls Seam vorhanden) |

**Caller-Check vor Edit (Pflicht, CLAUDE.md):**
- `grep -rn "assertConfig" src/ test/` — sicherstellen, dass kein weiterer Aufrufer auf die alte "loggt-aber-bootet"-Semantik baut (insb. bestehende Config-Tests, die `assertConfig()` ohne Exit aufrufen — laufen weiter, da reine Boolean-Rueckgabe).
- `grep -rn "maxBudgetEur\|maxCallsPerHour\|maxNumbers\|maxCallDurationS" src/` — bestaetigen, dass alle Konsumenten der Gate-Werte mit dem validierten (statt NaN) Wert rechnen; insb. Budget-Engine UND Realtime-Bridge (CLAUDE.md-Hinweis: Tools werden von beiden genutzt).
- `grep -rn "err.message\|error: err" src/server.js` — pruefen, ob weitere 500-Responses rohe Provider-Messages leaken (analog AC5; falls ja: notieren, NICHT in P2 mit-fixen — Scope OT-4, hier nur 649-655).

---

## Verifikation

```
node --check src/config.js
node --check src/server.js
npm test                              # alle bestehenden + T-P2-01..11 gruen

# Boot-Refusal-Smoke-Test (AC1/AC4) — NaN-Budget:
PORT=0 SKIP_TWILIO_SIGNATURE_CHECK=true \
  ANTHROPIC_API_KEY=x TWILIO_ACCOUNT_SID=x TWILIO_AUTH_TOKEN=x TWILIO_NUMBER=+490 \
  PUBLIC_URL=https://example.test MAX_BUDGET_EUR=acht npm start ; echo "exit=$?"
# erwartet: exit=1, stderr "[boot] Start abgebrochen" + nennt MAX_BUDGET_EUR, KEIN "Gateway laeuft"

# Gegenprobe (AC7) — gueltige Config bootet:
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true \
  ANTHROPIC_API_KEY=x TWILIO_ACCOUNT_SID=x TWILIO_AUTH_TOKEN=x TWILIO_NUMBER=+490 \
  PUBLIC_URL=https://example.test MAX_BUDGET_EUR=8 npm start &
sleep 2 ; curl -s localhost:3999/healthz   # erwartet: {"ok":true}
```
Erwartetes Ergebnis: NaN-Budget -> Exit 1 mit actionable Diagnose; gueltige Config -> `/healthz` 200; Disclosure-Regressionstests gruen.

---

## Risiken / Pre-Mortem (1 Jahr in der Zukunft, P2 war falsch)

- **Legitime Deploys booten ploetzlich nicht mehr.** Ein Render-Deploy mit einer bisher tolerierten "leeren"/krummen Env-Var (z.B. `RATE_LIMIT_PER_MIN=` leer, oder ein versehentliches Komma) wuerde nach P2 hart fehlschlagen. **Mitigation:** (1) leere/abwesende Vars fallen auf den dokumentierten Default zurueck (numEnv-`source`-Logik) — nur **gesetzt-aber-ungueltig** ist fatal; (2) die Diagnose nennt exakt Var + Erwartung + wie zu setzen; (3) T-P2-08 + Smoke-Gegenprobe beweisen, dass eine saubere Config bootet. Vor dem Render-Rollout einmal mit der echten Env-Liste lokal gegen den Boot testen.
- **Zu aggressive Validierung sperrt gueltige Konfiguration aus.** Wenn `min`/`max`/`integer`-Erwartungen falsch gesetzt sind, koennte ein eigentlich valider Wert (z.B. `MAX_BUDGET_EUR=8` als `integer:false` korrekt, aber faelschlich `integer:true` -> `parseInt("8.5")=8` still verfaelscht) zu Datenverlust oder Fehl-Refusal fuehren. **Mitigation:** `maxBudgetEur` ist der **einzige** Float (`integer:false`), alle anderen sind Ganzzahlen — explizit pro Feld setzen, Test T-P2-02 deckt den Float-Pfad ab.
- **Fail-closed-Boot maskiert Rollback-Pfad in der Cloud.** Render startet bei Exit 1 ggf. in eine Restart-Loop. **Mitigation:** Exit-Diagnose ist eindeutig im Render-Log sichtbar (kein Crash-Stack, eine klare `[boot]`-Zeile); akzeptiertes Verhalten, weil ein Dienst ohne Budget-Gate teurer ist als ein nicht-startender Dienst (R4). Dokumentieren, dass eine Boot-Refusal-Loop = Config-Fehler, nicht Code-Bug.
- **Secret-Leak in der neuen Boot-Refusal-Diagnose.** Die Diagnose darf NIE den Wert eines Secrets ausgeben (`DATABASE_URL`, `*_TOKEN`, `OIDC_CLIENT_SECRET`). **Mitigation:** Die numEnv-Diagnose betrifft nur **numerische** Vars (keine Secrets); der presence-Check nennt nur **Namen** fehlender Vars, nie Werte (bestehende assertConfig-Logik). AC5-Log nutzt dieselbe secret-freie Disziplin wie die P0-Guards (`err.message`, nie `config`).
- **AC5 ohne Test-Seam.** Falls der Originate-Pfad keine injizierbare Provider-Seam hat, ist T-P2-11 nicht offline reproduzierbar. **Mitigation:** Dann AC5 trotzdem umsetzen (reine Response-Aenderung, statisch verifizierbar via `grep`, dass `err.message` nicht mehr im 500-Body steht) und den dynamischen Test als Verifikations-Item nach P4 (External-I/O-Coverage) verschieben — NICHT die Response-Haertung verschieben.
- **CLAUDE.md-Gates-Konsistenz:** P2 staerkt Rule 1 (Gates fail-closed) und Rule 2 (Disclosure-Regression), fasst Allowlist/Signatur-Logik selbst NICHT an und weicht KEINE Sicherung auf — es ersetzt stilles OPEN durch lautes Refusal. Keine neue abgeschaltete Sicherung, kein uebersprungener Check.
