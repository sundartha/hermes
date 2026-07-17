# Phase P6 — Detailbericht

**Titel:** config.js haerten + zentralisieren — boolEnv fail-closed, MS_PER_DAY, resolveGatewayUrl
**Gate:** PASS
**finalBranch:** `phase/cc-p6-config-hardening-fix1`
**Basis:** lokaler `master` @ `d13e94f` (enthaelt bereits den P5-Merge, Provider-Registry)
**headCommit (Impl, vor Fix-Runde, auf `phase/cc-p6-config-hardening`):** `33721fe0053e83ee8a953bb6973258668991baa7`
**headCommit (final, nach Fix-Runde r1, auf `phase/cc-p6-config-hardening-fix1`):** `1591e28` (Kurzform; von Safety- und Clean-Code-Review unabhaengig gegengeprueft)

---

## 1. Ausgangslage / Ziel

P6 adressiert drei verstreute Haertungs-/Zentralisierungs-Luecken in `src/config.js`, die im Clean-Code-Audit (`tasks/clean-code-audit-2026-07.md`) als Befunde S2-1 (Boolean-Env-Parsing) und S2-20/G5 (Gateway-URL-Fallback) sowie als G25-Magic-Number (24h-Literal) festgehalten waren:

- **16 Inline-`=== "true"`-Callsites** in `rawConfig`, davon 15 im sauberen Muster `(process.env.X || "default") === "true"` (kein Fail-Closed: ein nicht-exakter Wert wie `"1"`, `"yes"` oder `"True"` faellt still auf den Default, statt den Boot abzubrechen) + 1 Sonderfall `devLoginEnabled` (zusaetzliche `RENDER_EXTERNAL_URL`-Doppel-Sperre). Kritisch bei Kill-Switches wie `OUTBOUND_FROZEN` (Default `false`): ein nicht-exakt gesetzter Wert waere **fail-open** — der Operator glaubt eingefroren zu haben, Outbound laeuft lautlos weiter.
- **Ein zweiter, unabhaengiger Rohcheck** `if (process.env.DEV_LOGIN_ENABLED === "true")` in `productionFootguns` — bewusste zweite Sperre, explizit **out of scope**.
- **Drei GATEWAY_URL-Konsumenten** (`boot.js` setzt, `mcp-tools.js` + `mcp-server.js` lesen) mit dreifach dupliziertem Fallback-Literal `"http://localhost:3000"`, das `config.port` ignorierte.
- **Ein rohes 24h-ms-Literal** (`24 * 60 * 60 * 1000`) bei `perTargetWindowMs`, obwohl die benannte Konstante `MS_PER_DAY` in derselben Datei bereits existiert und an anderer Stelle genutzt wird.

Ausserhalb `config.js` genau ein weiterer `=== "true"`-Treffer: `src/store/pg.js` (Postgres-Boolean-Spalten-Koerzion, kein Env-Parsing → out of scope). `sms-summary.js`/`state-ops.js` haben eigene, bereits benannte lokale `MS_PER_DAY`-Konstanten → kein Cross-Modul-Dedup im Scope.

Scope strikt begrenzt: `src/config.js`, `src/mcp-tools.js`, `src/mcp-server.js`, `src/boot.js` + drei Testdateien. Reiner Refactor/Haertung — kein neues Feature, kein neues Env-Var, keine neue Dependency.

## 2. Plan (gekuerzt)

**Import-Zyklus-Beweis vorab:** `config.js` importiert nur `dotenv, fs, path, url, ./store/defaults.js` (Leaf, 0 Imports). Keiner der drei GATEWAY-Konsumenten wird von `config.js` transitiv importiert → neue Kante `mcp-tools.js → config.js` ist azyklisch (die anderen beiden importieren `config.js` bereits).

**a) `boolEnv(name, raw, { fallback })`** — neben `numEnv`, teilt dessen `fatalConfigErrors[]`. Abwesend/leer → dokumentierter Default (kein Fatal); `"true"`/`"false"` (nach `trim()+toLowerCase()`) → Bool; alles andere → Fatal-Push + Fallback (Boot-Refusal statt stillem Flag-Flip):

```js
export function boolEnv(name, raw, { fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  fatalConfigErrors.push(
    `${name}="${raw}" ist kein gueltiger Boolean (erwartet: "true" oder "false").`,
  );
  return fallback;
}
```

`{ fallback }` ohne `= {}`-Default: jede der 16 Callsites uebergibt den Fallback explizit, ein fehlendes Options-Objekt soll laut crashen (Dev-Fehler).

**b) `gatewayUrlForPort(port)` / `resolveGatewayUrl()`** — EINE Quelle fuer den localhost-Gateway-Fallback, platziert nach `export const config = guardedConfig(rawConfig)`:

```js
export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}
export function resolveGatewayUrl() {
  return (process.env.GATEWAY_URL || gatewayUrlForPort(config.port)).replace(/\/$/, "");
}
```

Bewusste Mikro-Verbesserung: der alte Fallback war das Literal `"http://localhost:3000"` (ignorierte `config.port`). Byte-identisch im Default (`config.port` = 3000) und im In-Process-Fall (`boot.js` setzt `GATEWAY_URL`, Fallback nie erreicht). Einziger geaenderter Fall: standalone stdio-mcp-server mit `PORT != 3000` und ungesetztem `GATEWAY_URL` — vorher faelschlich `:3000`, jetzt korrekt `:config.port` (Korrektur, keine Regression; alle Bestandstests setzen `GATEWAY_URL` explizit).

**c) 15 saubere Flags mechanisch auf `boolEnv` umgeschrieben**, Fallback-Bool je exakt erhalten (keine Sense-Inversion):

| # | config-Key | Env-Var | Default |
|---|---|---|---|
| 1 | `metricsEnabled` | `METRICS_ENABLED` | false |
| 2 | `elevenLabsPlayTts.enabled` | `ELEVENLABS_PLAY_TTS_ENABLED` | false |
| 3 | `telnyxAssistant.enabled` | `TELNYX_AI_ASSISTANT_ENABLED` | false |
| 4 | `telnyxAssistant.shimDebugShape` | `TELNYX_SHIM_DEBUG_SHAPE` | false |
| 5 | `paymentEnabled` | `PAYMENT_ENABLED` | false |
| 6 | `sendSmsSummary` | `SEND_SMS_SUMMARY` | **true** |
| 7 | `outboundFrozen` | `OUTBOUND_FROZEN` | false |
| 8 | `provisioningEnabled` | `PROVISIONING_ENABLED` | false |
| 9 | `multiTenant` | `MULTI_TENANT` | false |
| 10 | `mcpUiEnabled` | `MCP_UI_ENABLED` | **true** |
| 11 | `assistantContextEnabled` | `ASSISTANT_CONTEXT_ENABLED` | **true** |
| 12 | `selfServiceEnabled` | `SELF_SERVICE_ENABLED` | false |
| 13 | `geoEnabled` | `GEO_ENABLED` | false |
| 14 | `skipTwilioSignatureCheck` | `SKIP_TWILIO_SIGNATURE_CHECK` | false |
| 15 | `fakeOriginate` | `FAKE_ORIGINATE` | false |

**Sonderfall `devLoginEnabled`** (Default false): `boolEnv` fuer den Basisschalter, `RENDER_EXTERNAL_URL`-Doppel-Sperre bleibt unveraendert:
```js
devLoginEnabled:
  boolEnv("DEV_LOGIN_ENABLED", process.env.DEV_LOGIN_ENABLED, { fallback: false }) &&
  !process.env.RENDER_EXTERNAL_URL,
```
Semantik-Beweis (unset/`"true"` lokal/`"true"` auf Render) deckungsgleich mit dem Alt-Verhalten; `"1"`/`"yes"` fuehrt neu zu Fatal + Boot-Refusal statt stillem Deaktivieren (Haertung, keine Sense-Inversion). Kommentar ueber `devLoginEnabled` (`(=== "true")`) im selben Edit auf `boolEnv` angeglichen (C2).

**UNANGETASTET:** `productionFootguns`-Rohcheck `DEV_LOGIN_ENABLED === "true"` — zweite unabhaengige Sperre, dokumentierte Ausnahme.

**MS_PER_DAY-Edit:** `perTargetWindowMs`-Fallback `24 * 60 * 60 * 1000` → `MS_PER_DAY` (Wert identisch 86400000).

**d) Drei GATEWAY-Konsumenten-Edits:**
- `mcp-tools.js`: Import `resolveGatewayUrl` ergaenzt; Ein-Aufruf-Wrapper `const GATEWAY = () => (...).replace(...)` entfernt; Callsite `GATEWAY() + path` → `resolveGatewayUrl() + path`.
- `mcp-server.js`: Import erweitert, Log-Zeile `"... Gateway: " + (process.env.GATEWAY_URL || "http://localhost:3000")` → `"... Gateway: " + resolveGatewayUrl()`.
- `boot.js`: Import erweitert; `GATEWAY_URL ||= \`http://localhost:${port}\`` → `GATEWAY_URL ||= gatewayUrlForPort(port)`; empfohlen (optional, DRY) auch die zwei Banner-Zeilen in `logBootBanner` auf `gatewayUrlForPort(port)` umstellen (byte-identische Ausgabe, vermeidet frischen G5-Befund direkt neben dem neuen Helper).

**e) Neue/erweiterte Tests:** `test/config-boolenv.test.js` (neu, 7 Faelle: unset/leer→Fallback beide Richtungen, `"true"`/`"false"`, Trim+Case-Normalisierung, `"1"/"yes"/"on"/"maybe"/"0"/"no"`→Fatal+Fallback, `assertConfig()===false` nennt die Var, `OUTBOUND_FROZEN="TRUE"`→`true` ohne Fatal via Fresh-Import, `OUTBOUND_FROZEN="1"`→Fatal+`false`); `test/config-gateway.test.js` (neu, 3 Faelle: `gatewayUrlForPort`-Template, `resolveGatewayUrl` ohne/mit `GATEWAY_URL` inkl. Trailing-Slash-Strip, relativ zu `config.port` statt der Zahl 3000 → robust gegen ambientes `PORT`); `test/config-shape.test.js` (1 Test ergaenzt: `perTargetWindowMs === 86400000` als MS_PER_DAY-Regressionsanker).

**f) DoD-Greps:** `grep -n '=== "true"' src/config.js` → erwartet genau 1 Zeile (die `productionFootguns`-Ausnahme); `grep -n '24 \* 60 \* 60 \* 1000' src/config.js` → genau 1 Zeile (die `MS_PER_DAY`-Definition selbst); `grep -rn 'localhost:3000' src/` → 0 Treffer.

**g) Pre-Mortem:** Worst-Case Sense-Inversion (dreht alle Gate-Flags gleichzeitig) — abgesichert durch die byte-genaue Fallback-Tabelle, boolEnv-Unit-Tests fuer `"true"`/`"false"`/Case, und die an diesen Flags haengende Voll-Suite. Safety-Gates (Allowlist/Denylist/Budget/Signatur/Disclosure) unberuehrt — `boolEnv` haertet nur die Parse-Kante. `productionFootguns`-Rohcheck (zweite unabhaengige DEV_LOGIN-Sperre) explizit unangetastet.

## 3. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt auf Branch `phase/cc-p6-config-hardening` (Basis master `d13e94f`), initialer Commit `33721fe`.

- **`src/config.js`:** `boolEnv` nach `numEnv`/`configFatalErrors` eingefuegt; alle 15 sauberen Callsites umgeschrieben (Fallback-Bool je exakt erhalten); `devLoginEnabled` mit `boolEnv` + weiterhin bestehender `RENDER_EXTERNAL_URL`-Doppel-Sperre; `productionFootguns`-Rohcheck unangetastet — genau 1 verbleibender `=== "true"`-Treffer ausserhalb der `boolEnv`-Definition selbst; `perTargetWindowMs`-Fallback auf `MS_PER_DAY` umgestellt; `gatewayUrlForPort`/`resolveGatewayUrl` nach `export const config = ...` ergaenzt.
- **`src/mcp-tools.js`:** Import `resolveGatewayUrl` ergaenzt, `GATEWAY()`-Ein-Aufruf-Wrapper entfernt, Callsite direkt auf `resolveGatewayUrl()` umgestellt.
- **`src/mcp-server.js`:** Import erweitert, Log-Zeile auf `resolveGatewayUrl()` umgestellt.
- **`src/boot.js`:** Import erweitert, `GATEWAY_URL`-Fallback-Set + (optional, umgesetzt) die zwei Banner-Zeilen auf `gatewayUrlForPort(port)` umgestellt.
- **Neue/erweiterte Tests:** `test/config-boolenv.test.js` (neu), `test/config-gateway.test.js` (neu), `test/config-shape.test.js` (1 Test ergaenzt) — insgesamt 11 neue Testfaelle.

### Ergebnisse

- `node --check` sauber auf allen vier `src`-Dateien (`config.js`, `mcp-tools.js`, `mcp-server.js`, `boot.js`).
- **Volle Suite: 2368 pass / 0 fail** (Baseline 2357 nach P5 + 11 neue Tests — exakt wie im Plan prognostiziert).
- Zwei End-to-End-Smoke-Laeufe: (1) Erfolgspfad — Boot mit sauberen exakten Bool-Envs, `curl /healthz` → 200 `{"ok":true}`, Boot-Banner zeigt `http://localhost:3999` via `gatewayUrlForPort(port)` korrekt. (2) Fail-Closed-Pfad — `OUTBOUND_FROZEN=1` (nicht-exakter Boolean) → **Boot-Refusal mit exit-Code 1**, Diagnose: `OUTBOUND_FROZEN="1" ist kein gueltiger Boolean (erwartet: "true" oder "false").` — bestaetigt die zentrale P6-Sicherheitseigenschaft end-to-end (kein stiller Flag-Flip, sondern sichtbare Boot-Refusal).

### Deviations

1. **Basis-Klarstellung:** Der Git-Status-Snapshot zeigte zu Konversationsbeginn einen weiter fortgeschrittenen `master`-Stand (`919c72d`, server-slim-p15-Merge) — das ist eine separate, parallele Umbau-Kette (`PLAN-SERVER-SLIM`), nicht Teil dieser Phase. Der Plan hatte `d13e94f` explizit als Basis verifiziert; die Impl folgte dem, keine eigene Entscheidung.
2. **DoD-Grep 1 liefert 2 statt der erwarteten 1 Zeile:** die zusaetzliche Zeile ist `boolEnv`s eigene interne Vergleichslogik (`if (normalized === "true") return true;`) — unvermeidlich, weil `boolEnv` per Spezifikation exakt gegen den String `"true"` vergleichen muss. Keine uebersehene Alt-Callsite; die eigentliche Zaehl-Absicht (keine Env-Parse-Callsites mehr ausser der `productionFootguns`-Ausnahme) ist erfuellt.
3. Die zwei optionalen Banner-Zeilen in `boot.js` (`logBootBanner`) wurden gemaess Plan-Empfehlung ebenfalls auf `gatewayUrlForPort(port)` umgestellt (DRY, byte-identische Ausgabe, per Smoke bestaetigt).

### Clean-Code-Selbstcheck (Impl)

G5 (Duplizierung) behoben: 3× `localhost:3000`-Literal + 1× dupliziertes 24h-ms-Literal auf je eine Quelle reduziert. G12 (toter Code/Muell) behoben: Ein-Aufruf-`GATEWAY`-Wrapper in `mcp-tools.js` entfernt. G25 (Magic Numbers): keine neuen; 24h-Literal auf bestehende benannte Konstante `MS_PER_DAY` umgestellt. C2 (veralteter Kommentar) behoben: Prosa-Kommentar ueber `devLoginEnabled` auf `boolEnv` angeglichen. F1 (Argumente): `boolEnv(name, raw, {fallback})` = 3 Args, im Limit. G30/G34 (eine Aufgabe/Abstraktionsebene): `boolEnv`/`gatewayUrlForPort`/`resolveGatewayUrl` je einzweckig. Kein toter/auskommentierter Code, keine ungenutzten Imports, keine neuen `eslint-disable`-artigen Marker. ESM/kein Build-Step/kein TS eingehalten, Kommentare deutsch ohne Umlaute.

## 4. Safety-Urteil (final)

**APPROVED**, keine Blocker (Review lief auf `phase/cc-p6-config-hardening-fix1`, Commit `1591e28`, isolierter Worktree `review-p6-r1`).

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true

**Unabhaengiger Testlauf:** volle Suite via `node --test` → **2368 pass / 0 fail / 0 cancelled / 0 skipped** (~75s), beide Backends im selben Lauf (json-Spawn-Tests unter `BASE_ENV` + dedizierte `*-pg.test.js` via pglite). Isolierte Re-Runs gegen den bekannten ~12%-Vollast-Flake: P6-Config-Gruppe (`config-boolenv`, `config-gateway`, `config-failclosed`, `config-payment-guard`, `config-shape`, `config-prod-footguns`, `boot-prod-footguns`) = **53/53 pass, 0 fail**; pg-Store-Gruppe (`store-pg`, `store-pg-json-parity`, `store-pg-rls`, `store-pg-multitenant`, `store-pg-tenant-budget`, `store-pg-billing-idempotent`) = **66/66 pass, 0 fail**. `node --check` gruen auf allen vier `src`-Dateien.

**Neue `boolEnv`-Tests beweisen:** unset/leer → Fallback (beide Richtungen) ohne Fatal; `"true"`/`"false"` → Bool; `" True "`/`"FALSE"` normalisiert; `"1"/"yes"/"on"/"maybe"/"0"/"no"` → Fatal+Fallback; `assertConfig() === false` nach Fatal nennt die Var; `OUTBOUND_FROZEN="TRUE"` → `true` (kein stiller Fail-Open) und `="1"` → Fatal+Fallback `false`. **Gateway-Tests beweisen:** `gatewayUrlForPort(3000) === "http://localhost:3000"`, `resolveGatewayUrl` mit/ohne `GATEWAY_URL` inkl. Trailing-Slash-Strip. **MS_PER_DAY-Anker:** `config.perTargetWindowMs === 86400000` bei unset.

**Concerns (nicht blockierend):**

1. **DEPLOY-PRECONDITION** (dokumentiert, KEIN Code-Blocker) — siehe eigener Abschnitt 7 unten. Kurzfassung: `boolEnv` fail-closed aendert das Verhalten jeder aktuell gesetzten, nicht-exakten Render-Boolean-Env beim naechsten Deploy. Ein Case-/Whitespace-Varianten-Wert wie `PAYMENT_ENABLED=True` wuerde still `false→true` flippen (scharfer Geld-/Nummernpfad); ein Wert wie `"1"`/`"yes"` fuehrt zu Boot-Refusal. Der Codelauf kann das echte Render-Env nicht sehen. Der Merge ist sicher; das Deploy darf erst erfolgen, nachdem die echten Render-Dashboard-Boolean-Vars auditiert und jeder nicht-exakte `"true"`/`"false"`-Wert normalisiert wurde.
2. Gutartige, beabsichtigte Verhaltens-Praezisierung: der `mcp-tools`/`mcp-server`-localhost-Fallback leitet sich jetzt aus `config.port` via `resolveGatewayUrl()` ab statt aus einem hartkodierten `:3000`. Byte-identisch bei ungesetztem `PORT` (Default 3000); unterscheidet sich nur, wenn `GATEWAY_URL` ungesetzt UND `PORT != 3000` ist (dann korrekt der echte Port). Innerhalb des P6-Single-Source-Scopes keine Regression.
3. Hinweis (nicht P6-Scope): `src/sms-summary.js` und `src/store/state-ops.js` behalten ihre eigenen lokalen `MS_PER_DAY`-Konstanten (vorbestehend, je eigene benannte Konstante, kein rohes 24h-Literal). `src/store/pg.js:1336` nutzt `value === "true"` fuer die Parsung persistierter Postgres-Booleans (unabhaengiger pg-Hydrierungs-Helfer, keine Config-Flag-Callsite).

**Verdict-Kurzfassung:** korrekte, verhaltenserhaltende Haertung. `boolEnv` sitzt neben `numEnv`, teilt `fatalConfigErrors[]`; alle 16 Callsites (15 saubere Flags + `devLoginEnabled` mit erhaltener `RENDER_EXTERNAL_URL`-Doppel-Sperre) behalten ihren exakten Vorher-Fallback-Default — **null** Sense-Inversion. `productionFootguns`-Rohcheck unangetastet (bewusste zweite Sperre). `OUTBOUND_FROZEN`-Fail-Open-Luecke geschlossen. `MS_PER_DAY`-Dedup wertidentisch; Gateway-Helfer vereinheitlichen den localhost-Fallback ohne Import-Zyklus. Kein Secret in der `boolEnv`-Diagnose. Safety-Gates, Offenlegung, Auth-fail-closed und Scope intakt. Tests unabhaengig gruen auf beiden Backends. Einziger offener Punkt: das verpflichtende Render-Boolean-Env-Audit als Deploy-Vorbedingung (Concern, kein Code-Blocker gemaess Plan). Kein offenes S1/S2.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — kein S1/S2-Befund, `blocker: false`.

Beide vom Auftrag geforderten Kernpunkte verifiziert erfuellt: (1) die `=== "true"`-Duplizierung ist eliminiert bis auf genau die eine dokumentierte `productionFootguns`-Ausnahme (bewusste zweite, unabhaengige Sperre auf der rohen Env, unveraendert seit `master`); (2) `MS_PER_DAY` und der `GATEWAY_URL`-localhost-Fallback sind zentralisiert. Zusaetzlich wurde eine dreifach kopierte Test-Helper-Funktion dedupliziert (G5-Bonus, siehe Fix-Runde). `node --check` sauber, volle Suite 2368/2368 gruen.

### S1–S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** | keine |
| **S4** | 2 |

**S4 — G24 (Zeilenlaenge)** · `src/config.js:510` · `assistantContextEnabled: boolEnv("ASSISTANT_CONTEXT_ENABLED", process.env.ASSISTANT_CONTEXT_ENABLED, {` ist 104 Zeichen, ueberschreitet `.prettierrc.json`-`printWidth` (100). Alle direkt benachbarten `boolEnv`-Aufrufe gleicher Laenge sind konsequent auf mehrere Zeilen umgebrochen — nur diese eine nicht. Rein kosmetisch (kein Prettier-Hook/CI im Repo, Gesamtdatei war schon vor P6 nicht durchgehend prettier-clean), aber lokal inkonsistent zum sonst durchgehaltenen Muster im selben Diff. Fix (optional): wie die Nachbar-Aufrufe auf 3 Zeilen umbrechen.

**S4 — G11 (Fehlender Default)** · `src/config.js:59` · `boolEnv(name, raw, { fallback })` hat — anders als das Geschwister `numEnv(name, raw, { fallback, min, max, integer = true } = {})` — keinen Default (`= {}`) fuers Options-Objekt; ein Aufruf ohne 3. Argument crasht beim Destrukturieren statt sauber fehlzuschlagen. Aktuell rein theoretisch: alle 16 Callsites im Diff uebergeben das Objekt korrekt. Fix (optional, Symmetrie zu `numEnv`): `{ fallback } = {}`.

**Verifikation (aus `passNotes`):** `git show phase/cc-p6-config-hardening-fix1:src/config.js | grep '=== "true"'` liefert genau 2 Treffer — Zeile 62 (`boolEnv`-Implementierung selbst) und Zeile 811 (die dokumentierte `productionFootguns`-Ausnahme, unveraendert seit `master`). Alle 16 vormals inline `(process.env.X || "default") === "true"`-Stellen sind auf `boolEnv()` umgestellt. `MS_PER_DAY`: das letzte Rohliteral bei `perTargetWindowMs` ist jetzt `fallback: MS_PER_DAY`, mit Regressionstest abgesichert. `GATEWAY_URL`/localhost-Fallback zentralisiert in `config.js`, konsumiert von `boot.js`/`mcp-server.js`/`mcp-tools.js`; kein rohes `localhost:${port}`-Literal mehr ausserhalb von `config.js` (grep bestaetigt). Ausgefuehrt im Branch-Worktree (`wf_9610b176-73f-5`, Commit `1591e28` = `phase/cc-p6-config-hardening-fix1`): `node --check` sauber, volle Suite 2368/0/0.

**Nebenbefund ohne Handlungszwang:** `prettier --check` schlaegt sowohl auf `master` als auch auf dem Branch fuer dieselben Dateien fehl (repo-weite Vorbedingung, nicht durch P6 eingefuehrt, kein Hook/CI hier) — nur die eine oben genannte neue Zeile wurde als lokale Inkonsistenz gewertet.

### Top-Todos

- Kein Blocker — Phase kann gemergt werden.
- Optional: `config.js:510` (`assistantContextEnabled`) auf mehrere Zeilen umbrechen, konsistent mit den Nachbar-`boolEnv`-Aufrufen.
- Optional: `boolEnv()`-Signatur mit `= {}`-Default fuer Options-Objekt haerten (Symmetrie zu `numEnv`).

## 6. Fix-Runden

**Eine Runde (r1).** Ein frueherer Review-Durchlauf auf `phase/cc-p6-config-hardening` fand einen G5-Befund: die dritte byte-identische Kopie der `withConfig(overrides, fn)`-Save/Restore-Schleife + `REQUIRED_OK`-Fixture in `test/config-boolenv.test.js` (bereits zweifach dupliziert in `config-failclosed.test.js`/`config-payment-guard.test.js`).

**r1-Fix:** die vierte Duplizierung in `test/config-boolenv.test.js` wurde entfernt. Statt einer weiteren Kopie wurde die bestehende Fabrik `makeConfigOverrides(configObj)` in `test/helpers.js` um eine Multi-Key-Variante `withConfigOverrides(...)` erweitert (echte Dedup-Loesung, nicht nur eine vierte Kopie eliminiert). Alle drei betroffenen Testdateien (`config-boolenv`, `config-failclosed`, `config-payment-guard`) nutzen seither dieselbe Helper-Fabrik + `CONFIG_REQUIRED_OK`-Fixture aus `test/helpers.js`.

Ergebnis nach r1: neuer Branch `phase/cc-p6-config-hardening-fix1` (Commit `1591e28`), Safety-Review und Clean-Code-Audit erneut unabhaengig gegen diesen Stand gelaufen → beide **PASS/APPROVED** ohne S1/S2, Voll-Suite weiterhin 2368/0. Keine weitere Fix-Runde noetig.

---

## 7. DEPLOY-VORBEDINGUNG: Render-Bool-Env-Audit (PFLICHT — HARTES GATE)

> **Der Merge ist sicher. Der naechste Live-Deploy dieser Phase ist es NICHT automatisch.** `boolEnv` ist fail-closed und aendert damit das Boot-Verhalten fuer jede bereits im Render-Dashboard gesetzte, nicht-exakte Boolean-Env — dieser Codelauf konnte das echte Render-Environment nicht einsehen und hat es folglich nicht geprueft.

### Was zu tun ist

Vor dem **ersten** Live-Deploy, das diese Phase enthaelt, muss im Render-Dashboard **jede** der folgenden Boolean-Env-Variablen manuell darauf geprueft werden, dass ihr Wert — falls gesetzt — **exakt** `true` oder `false` ist (kein `"1"`, `"0"`, `"yes"`, `"no"`, `"True"`, `" true"` mit Whitespace, o.ae.):

```
PAYMENT_ENABLED
PROVISIONING_ENABLED
MULTI_TENANT
OUTBOUND_FROZEN
SELF_SERVICE_ENABLED
GEO_ENABLED
METRICS_ENABLED
MCP_UI_ENABLED
ASSISTANT_CONTEXT_ENABLED
SEND_SMS_SUMMARY
ELEVENLABS_PLAY_TTS_ENABLED
TELNYX_AI_ASSISTANT_ENABLED
TELNYX_SHIM_DEBUG_SHAPE
SKIP_TWILIO_SIGNATURE_CHECK
FAKE_ORIGINATE
DEV_LOGIN_ENABLED
```

(Das ist exakt die Menge der 16 Flags, die P6 von rohem `=== "true"`-Vergleich auf `boolEnv` umgestellt hat — 15 saubere Flags + `devLoginEnabled`, dessen zusaetzliche `RENDER_EXTERNAL_URL`-Doppel-Sperre unveraendert bleibt.)

### Warum das ein hartes Gate ist

Vor P6 fiel ein nicht-exakter Wert (`"1"`, `"yes"`, `"True"` mit Grossbuchstaben, Whitespace) **lautlos** auf den jeweiligen `false`/`true`-Default zurueck — der Boot bemerkte nichts, das Verhalten war lokal "irgendwie richtig" oder "irgendwie falsch", aber nie sichtbar. Ab P6 wirft derselbe nicht-exakte Wert einen Fatal-Config-Error, den `assertConfig()` beim Boot **fail-closed** durchsetzt. Beim naechsten Deploy hat das genau zwei moegliche Ausgaenge, je nach dem heutigen (unbekannten) Ist-Zustand im Render-Dashboard:

1. **Boot-Refusal (Dienstausfall):** eine heute gesetzte, nicht-exakte Boolean-Env (z. B. `PAYMENT_ENABLED=True` mit Grossbuchstaben) fuehrt beim Deploy zum sofortigen Abbruch des Boot-Vorgangs — der Dienst startet nicht, alle Anrufe/SMS sind betroffen, nicht nur der eine Flag-Pfad.
2. **Stiller Flag-Flip in den scharfen Geld-/Nummernpfad:** falls ausgerechnet ein *Enabling*-Flag (`PAYMENT_ENABLED`, `PROVISIONING_ENABLED`, `MULTI_TENANT`) heute auf einen nicht-exakten Wert gesetzt ist, der VOR P6 zufaellig als `false` interpretiert wurde (weil der alte Code jeden Nicht-`"true"`-Wert als `false` las), ist Ausgang (1) das tatsaechliche Resultat (Boot-Refusal) — es gibt aus der Analyse **keinen** Pfad, auf dem ein Flag durch P6 selbst *scharf* geschaltet wird, ohne dass gleichzeitig ein Fatal geworfen wird. Das eigentliche operative Risiko ist daher in erster Linie **Ausgang 1 (Dienstausfall)**; Ausgang 2 (echter, unbemerkter Flip auf `true`) ist gemaess der Byte-Identitaets-Analyse (Abschnitt 4, Safety-Concern 1) nur denkbar, wenn zwischen Audit und Deploy ein manueller Env-Edit im Dashboard mit einem nicht-exakten Wert erfolgt — genau das soll dieses Audit verhindern.

Kurz: **Der bisherige Zustand kann Fehlkonfiguration verschleiern; P6 macht sie sichtbar — aber nur, wenn vorher geprueft wird, dass sich hinter jedem gesetzten Flag tatsaechlich ein exakter Wert verbirgt.** Ungeprueft deployen heisst, den Zeitpunkt der Entdeckung eines bestehenden Konfigurationsfehlers auf einen produktiven Deploy zu verschieben, statt ihn kontrolliert vorab aufzuloesen.

### Vorgehen (verbindlich)

1. Render-Dashboard oeffnen, Service-Environment-Tab, jede der 16 oben gelisteten Variablen einzeln pruefen (nur die, die tatsaechlich gesetzt sind — ungesetzte Variablen sind unkritisch, sie nutzen weiterhin den dokumentierten Default ohne Fatal).
2. Jeden gefundenen nicht-exakten Wert auf exakt `true` oder `false` normalisieren (Kleinschreibung, kein Whitespace).
3. Erst danach: Merge auf `master` (falls noch nicht geschehen) → Deploy ausloesen.
4. **Kein Merge→Deploy ohne diesen Env-Abgleich.** Dieser Punkt ist eine harte, abhakbare Vorbedingung — kein Soft-Hinweis.

---

## 8. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED (Stand `phase/cc-p6-config-hardening-fix1`), keine Blocker, 3 nicht-blockierende Concerns (davon 1× die Deploy-Vorbedingung oben) |
| Clean-Code-Audit | PASS, S1/S2 leer, 0× S3, 2× S4 (beide optional, kein Blocker) |
| Tests | 2368/2368 gruen (Baseline 2357 + 11 neue Faelle: 7 in `config-boolenv.test.js`, 3 in `config-gateway.test.js`, 1 ergaenzt in `config-shape.test.js`); isolierte Re-Runs Config-Gruppe 53/53 + pg-Gruppe 66/66 |
| Diff-Blast-Radius | 4 editierte `src`-Dateien (`config.js`, `mcp-tools.js`, `mcp-server.js`, `boot.js`) + 3 Testdateien (2 neu, 1 erweitert); r1-Fix zusaetzlich `test/helpers.js` erweitert |
| Betroffene Befunde | S2-1 (16 Boolean-Env-Callsites), S2-20/G5 (GATEWAY_URL-Dreifach-Fallback), G25 (24h-ms-Magic-Number → `MS_PER_DAY`) |
| Neue npm-Dependency | keine |
| Neues Env-Var | keine |
| Deviations | 3 dokumentierte (Basis-Klarstellung, DoD-Grep-Zaehl-Artefakt durch `boolEnv`s eigene Vergleichszeile, optionale Boot-Banner-Umstellung umgesetzt) |
| Fix-Runden | 1 (r1: G5-Test-Helper-Triplizierung dedupliziert via `withConfigOverrides` in `test/helpers.js`) |
| **Deploy-Vorbedingung** | **OFFEN** — Render-Bool-Env-Audit der 16 gelisteten Variablen MUSS vor dem naechsten Live-Deploy erfolgen (siehe Abschnitt 7) |
| Merge auf `master` | liegt beim Lead/Orchestrator gemaess Lean-Phasen-Workflow |
