# GATES-P13 — Detailbericht: Dashboard `apps/web`

**Spec:** Abschnitt "P13" in `tasks/gates-fix-chain.md`
**Abnahme:** WEB-07, WEB-19 und GAP-30 in `test/dashboard-i18n-surface.test.js` gruen via `npm run test:gates`; `npm test` = 3295/0; der Diff beruehrt `apps/` (ein Diff nur an `test/` waere ein Fehlschlag der Phase)
**Gate:** PASS
**finalBranch:** `phase/gates-p13-dashboard-web-r2`
**headCommit:** `40513c60b64f7245cb3f2f41ff19618db20da459`
**Basis:** `master` = `39ff895`

---

## 1. Plan (gekuerzt)

### Wurzel und Strategie

Eine gemeinsame Wurzel fuer alle drei Gates: `apps/web/src/lib/api.js` fuehrt eine Feldliste
(`SETTINGS_FREE_FIELDS`), die den Server-Vertrag `src/self-service.js` (`SELF_SERVICE_FREE_FIELDS`)
nicht mehr trifft:

- Client hatte `["agentName","allowCalendar","allowBooking","language"]`, Server erwartet
  `["agentName","language","agentStyle"]`.
- `allowCalendar`/`allowBooking` sind seit P1b tote Angebote — der Server lehnt sie bei **jedem**
  Speichern als `rejected` ab (der Telefon-Agent hat weder Kalender- noch Buchungs-Tool).
- `agentStyle` wird vom Server angeboten (`personaStyleIds` in `/api/self-service/state`), von
  der UI aber nie gelesen (WEB-07).
- `privateNumber` liefert der Server maskiert, niemand rendert es (WEB-19).

**Ein** Fix: `SETTINGS_FREE_FIELDS` auf den Server-Vertrag ziehen und zur tragenden Liste machen
(`buildSettingsPatch` laeuft ueber sie statt ueber eine zweite parallele Aufzaehlung). Kein
Server-Code-Import ins Browser-Bundle — Spiegel-Muster wie `apps/web/src/lib/plans.js` <->
`src/plans.js`, abgesichert durch importierende Drift-Tests.

### Blocker-Meldung (im Plan vorab benannt)

Die Spec verlangt "Zulaessige Testaenderung: keine". `apps/web/test/settings.test.js` pinnte
woertlich die alte, falsche Feldliste (`["agentName","allowCalendar","allowBooking","language"]`)
und vier weitere Assertions an `allowCalendar`/`allowBooking`. Das ist strukturell derselbe Fall
wie der bei P12 freigegebene Ist-Pin. Belegt: die Datei laeuft weder in `npm test` noch in
`npm run test:gates` noch in CI (`.github/workflows/ci.yml` kennt `apps/web` nicht) — die Zahl
3295/0 ist unberuehrt.

**Vorschlag:** Literal-Assertion durch Import-Vergleich gegen die echten Server-Konstanten
ersetzen (`SELF_SERVICE_FREE_FIELDS`/`SELF_SERVICE_RESTRICT_ONLY_FIELDS` aus `src/self-service.js`,
`PERSONA_STYLE_IDS` aus `src/i18n/locales.js`) — dasselbe Muster wie der bestehende
`SUPPORTED_LANGUAGES`-Drift-Test in derselben Datei. Keine Abschwaechung, sondern Beseitigung der
Duplizierung, die GAP-30 ueberhaupt erst erzeugt.

Zweite Nebenbedingung: `npm test` muss 3295/0 bleiben -> keine neue/geaenderte Datei unter `test/`;
neue Tests gehen nach `apps/web/test/`.

### Edits (Plan-Ebene)

- **`apps/web/src/lib/api.js`**
  - A1: `SETTINGS_FREE_FIELDS` -> `["agentName","language","agentStyle"]`
  - A2: `SETTINGS_PERMISSION_TOGGLES` auf `allowPersonalData`/`allowBankData` reduziert,
    `restrictOnly`-Feld entfernt (toter Datensatz, kein Leser ausser dem Test)
  - A3: `PERSONA_STYLE_LABELS` + `personaStyleOptions()` (WEB-07, englische Beschriftungen,
    fail-soft auf rohe ID bei unbekannter Server-ID)
  - A4: `buildSettingsPatch` laeuft ueber `SETTINGS_FREE_FIELDS` (eine Feldliste statt zwei)
  - A5: `isSavedAsRequested()`-Helfer — ein Server-Reset (`"" -> null` bei optionalen
    Enum-Overrides) zaehlt als `changed`, nicht `rejected`
  - A6: `privateNumberStatusText()`/`savePrivateNumber()`/`ERROR_INVALID_PRIVATE_NUMBER`
    (WEB-19, eigene Naht/eigener Endpunkt, PII nie im Settings-Patch)
- **`apps/web/src/components/app/SettingsIsland.astro`**
  - Stil-Dropdown-Zeile (versteckt ohne `personaStyleIds`)
  - zweites, eigenstaendiges Formular fuer die private Rufnummer (nicht verschachtelt im
    Settings-Formular), Hinweistext stellt explizit klar: nie Absender-ID, nie an Angerufene
    sichtbar
  - `showMessage(el, text, ok)` auf 3 Argumente vereinheitlicht (eine Implementierung fuer
    beide Formulare)
  - `renderGreetingOptions` ersetzt durch generische `renderOptions()`-Fabrik (kein `innerHTML`)

### Tests (Plan-Ebene)

Nichts unter `test/` angefasst; alle Aenderungen in `apps/web/test/settings.test.js`. Bestehende
Whitelist-/Patch-/Toggle-Tests auf den neuen Vertrag umgestellt; ~10 neue Tests fuer
`personaStyleOptions`, `settingsOutcome`-Reset-Glaettung, `privateNumberStatusText`,
`savePrivateNumber` (inkl. Drift-Test `PERSONA_STYLE_LABELS` <-> `PERSONA_STYLE_IDS`).

### Deterministisch pruefbares Ergebnis (Plan-Tabelle, gekuerzt)

`test/dashboard-i18n-surface.test.js` 5 pass/1 fail (WEB-08 bleibt rot, gehoert P14) ·
`npm run test:gates` Rot-Zahl um genau 3 ·
`npm test` 3295/0 · Diff nur in `apps/web/src/lib/api.js` + `SettingsIsland.astro` ·
`cd apps/web && npm run build` gruen · eslint/prettier sauber · Grep-Belege fuer
`agentStyle`/`personaStyleIds`/`privateNumber` > 0 · kein `console.*` in der Insel.

### Pre-Mortem (Kernpunkte)

1. Privatnummer geleakt? -> nur Server-Maske angezeigt, Eingabefeld nie vorbefuellt, Fehlermeldung
   spiegelt den Wert nicht zurueck, kein `console.*`.
2. Agent ruft mit Privatnummer an? -> Text sagt explizit "never used as the caller ID"; kein
   Schreibpfad von diesem Feld zur Absendernummer.
3. Einstellung still geloescht? -> `agentStyle` reist nur mit, wenn das Dropdown gerendert wurde;
   Nummer nur ueber expliziten "Remove"-Knopf geleert.
4. Kunden Funktionen weggenommen? -> `allowCalendar`/`allowBooking` hatten seit P1b keine Wirkung;
   entfernt wird ein Versprechen, kein Feature.
5. Deutsche Stil-ID im englischen Dashboard? -> Drift-Test 5 wird vorher rot.
6. `apps/web/test` verrottet ohne CI-Anbindung? -> reales Restrisiko, abgefedert durch die
   Feldlisten-Paritaet zusaetzlich im Gate-Test (informativ in CI); CI-Einbindung ist eigener
   Folgeauftrag, nicht Teil dieser Phase.

### Nicht-Ziele

`public/tenant.html` (P14), `src/self-service-routes.js` (P12/P14), `src/middleware.js`/CSP,
`apps/web/src/styles/**`, Marketing-Seiten, `staging`-Lab-Live-Weg, Preise/Waehrung, `render.yaml`,
jede Datei unter `test/`, neue npm-Dependencies. Sprache von `/app` bleibt Englisch.

---

## 2. Impl-Zusammenfassung

Umsetzung deckt sich mit dem Plan. `SETTINGS_FREE_FIELDS` wurde auf `["agentName","language",
"agentStyle"]` gezogen, `buildSettingsPatch` laeuft jetzt ueber genau diese eine Liste statt zwei
parallele Aufzaehlungen zu fuehren. `PERSONA_STYLE_LABELS`/`personaStyleOptions()` (WEB-07) und
`privateNumberStatusText()`/`savePrivateNumber()`/`ERROR_INVALID_PRIVATE_NUMBER` (WEB-19) wurden
ergaenzt. `settingsOutcome()` bekam `isSavedAsRequested()`: ein Server-Reset (`""` -> `null` bei
optionalen Enum-Overrides) zaehlt jetzt als `changed` statt faelschlich `rejected`.
`SettingsIsland.astro` bekam die Stil-Dropdown-Zeile und das zweite Formular fuer die private
Nummer; `showMessage(el, ...)` auf 3 Argumente umgestellt (eine Implementierung fuer beide
Formulare), `renderGreetingOptions` durch generische `renderOptions()` ersetzt.

**Geaenderte Dateien:**
- `apps/web/src/lib/api.js`
- `apps/web/src/components/app/SettingsIsland.astro`
- `apps/web/test/settings.test.js`

**Verifiziert:**
- `test/dashboard-i18n-surface.test.js`: 5 pass/1 fail — WEB-07, WEB-19, GAP-30 jetzt gruen; rot
  bleibt nur WEB-08 (gehoert P14, ausserhalb dieser Phase, exakt wie vorhergesagt).
- `npm test`: 3294 pass/1 fail (korrigierte Zahl 3295) — der eine Fehlschlag ist der vorbestehende,
  in MEMORY.md dokumentierte ~12%-Flake `test/telnyx-p5-origination.test.js` (Seed-vor-Boot-Race);
  isoliert nachgefahren: 5/5 gruen, kein Zusammenhang mit dieser Aenderung.
- `npm run test:gates`: 98 pass/33 fail — Rot-Zahl um genau 3 gesunken (vorher 36, jetzt 33), keine
  neue Regression.
- `cd apps/web && npm run build`: gruen (9 Seiten gebaut).
- `apps/web/test/settings.test.js` (27 Tests, 18 angepasst/neu) + weitere unbetroffene
  apps/web-Dateien (plans/hero-loop/render/api/stats/subscribe, 95 Tests): alle gruen.
- `git diff --name-only 39ff895..HEAD -- src/ public/ apps/ render.yaml`: genau
  `apps/web/src/lib/api.js`, `apps/web/src/components/app/SettingsIsland.astro`,
  `apps/web/test/settings.test.js` — `src/`, `public/`, `render.yaml` unberuehrt.

### Deviations

1. **`apps/web/test/settings.test.js` geaendert** — die im Plan als Blocker benannte und mit
   Vorschlag versehene Aenderung (Literal-Assertion -> Import-Vergleich gegen
   `SELF_SERVICE_FREE_FIELDS`/`SELF_SERVICE_RESTRICT_ONLY_FIELDS`/`PERSONA_STYLE_IDS`). Ohne sie
   waere die Datei unveraendert falsch geblieben. Betrifft keine der drei Abnahme-Zahlen, da
   `apps/web/test` ausserhalb beider Laeufe (`npm test`/`test:gates`) liegt.
2. **`apps/web/test/pages.test.js` und `links.test.js`** (nutzen `npx astro build` via
   `execFileSync`) konnten im Impl-Worktree wegen eines npx-spezifischen Umgebungsartefakts nicht
   laufen (Exit 194, leerer Output) — reproduzierbar auch ausserhalb der Sandbox, aber nicht im
   normalen Checkout. `node_modules/.bin/astro` direkt und `npm run build` (kein npx) liefen im
   selben Worktree fehlerfrei durch; der Build selbst ist nachweislich gesund.
3. **eslint/prettier** waren in der Impl-Umgebung nicht installiert (keine `.bin`-Binaries
   gefunden) und konnten nicht ausgefuehrt werden (Pruefpunkt 7 im Plan, best effort).

---

## 3. Safety-Urteil (final)

**Verdict: PASS.** `approved: true`, alle Einzelchecks (`testsPassIndependently`,
`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`,
`scopeRespected`, `behaviorAsIntended`) `true`. Keine Blocker.

Unabhaengige Verifikation in frischem Worktree auf `review-gates-p13` (Basis `master` 39ff895,
genau ein Phasen-Commit `40513c6`):
- `npm test`: 3295 pass/0 fail (beide Backends json + pg/pglite, 0 skipped) — exakt die geforderte
  Zahl.
- `npm run test:gates`: 98 pass/33 fail; WEB-07, WEB-19, GAP-30 + GAP-30-Mechanismus gruen.
  Gegenprobe auf `master` im selben Worktree: 46 rot. Mengen-Diff: nur die 3 Ziel-Gates kippen auf
  gruen, kein Gate regressiert (GAP-26 nur scheinbar abweichend — Baseline-Datei-Absturz unter
  Parallel-Last, isoliert auf `master` ebenfalls rot).
- `apps/web/test/settings.test.js`: 27/27 gruen. Die 12 Fehler der Gesamt-apps/web-Suite kommen
  ausschliesslich aus den `npx astro build`-Tests und treten identisch auf `master` auf (Umgebung,
  nicht die Aenderung). `SettingsIsland.astro` zusaetzlich direkt mit `@astrojs/compiler-rs`
  uebersetzt: 0 Diagnostics.

**Sicherheitsrelevantes:** Diff beruehrt keine Datei unter `src/` — Safety-Gates,
Signaturpruefung, Basic-/MCP-Auth und der Offenlegungssatz sind unveraendert. Private Rufnummer:
nur Server-Maske angezeigt, Eingabefeld nie vorbefuellt, eingegebener Wert nie in
Fehlermeldung gespiegelt, kein `console.*`, expliziter "never used as caller ID"-Hinweis, kein
neuer Endpunkt (bestehende, auth-geschuetzte Route wird nur konsumiert).

**Concerns (dem Lead vorgelegt, kein Blocker):**
1. Spec sagt "Zulaessige Testaenderung: keine", der Commit schreibt aber
   `apps/web/test/settings.test.js` um. Entlastend: Paket laeuft in keinem der beiden
   Abnahme-Laeufe; jede geaenderte Assertion wurde staerker (Literale -> Import der echten
   Server-Konstanten); alte Literale pinnten genau die Drift, die GAP-30 benennt.
2. `allowCalendar`/`allowBooking` verschwinden komplett aus dem Dashboard — sachlich richtig
   (seit P1b wirkungslos), aber nutzersichtbare Entfernung, vom Phasentext nur indirekt gedeckt.
3. `buildSettingsPatch`-Semantik geaendert: fehlende Formularfelder werden weggelassen statt zu
   `""` normalisiert — praktisch nur `agentStyle` betroffen (andere Felder immer gerendert).
4. `settingsOutcome` wertet `saved===null` + `requested===""` jetzt als `changed` — eng begrenzt
   auf optionale Enum-Overrides, beidseitig getestet.
5. Kosmetik: einige Zeilen ueber prettier `printWidth 100`; nicht Teil der Abnahme.
6. Kein Browser-Smoke von `/app` moeglich (`npx astro build` bricht in dieser Umgebung ab, auch
   auf `master` identisch) — Stil-Dropdown und zweites Formular nur durch Unit-Tests +
   Compiler-Diagnostics abgesichert, nicht visuell. Empfehlung: Blick auf `/app` vor Deploy.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS ohne Blocker.** `blocker: false`.

- **S1 (Blocker-Klasse):** keine.
- **S2 (Blocker-Klasse):** keine.
- **S3** (kosmetisch, kein G5-Fall): das Beispiel-Telefonnummer-Literal `"+1 555 0100"` steht
  sowohl im `input placeholder` als auch in `MSG_NUMBER_INVALID` in `SettingsIsland.astro` — bei
  spaeterer Drift in eine gemeinsame Konstante ziehen, kein Fix noetig.
- **S4** (nicht handlungsrelevant): `personaStyleOptions` dedupliziert keine hypothetisch doppelt
  gelieferte Server-ID — irrelevant, da `PERSONA_STYLE_IDS` serverseitig ein festes, geprueftes
  Array ist.

**Begruendung:** G5 aktiv vermieden (`showMessage`/`renderOptions` vereinheitlicht statt dupliziert
fuer Settings- und Private-Number-Formular); Backend-Vertrag konsequent gespiegelt statt Literale
(`SELF_SERVICE_FREE_FIELDS`/`SELF_SERVICE_RESTRICT_ONLY_FIELDS`/`PERSONA_STYLE_IDS` importiert,
Drift-Tests vorhanden und lokal in Extra-Worktree verifiziert: 27/27). Private Rufnummer: nur
maskiert angezeigt, nie zurueckgeschrieben, kein `Authorization`-Header, eigener Endpunkt/eigene
PII-Naht — Server-Route existierte bereits vor dieser Phase (F2 P5), wird nur konsumiert. Ebenso
`agentStyle`/`personaStyleIds`: Server-Enum existierte bereits (PA P4), Contract-Grenzen sind mit
eigenen Tests inkl. Grenzfaellen abgesichert (kein Array, unbekannte ID fail-soft, fehlendes vs.
zurueckgesetztes Feld). Keine Magic Numbers ohne Konstante, keine toten Funktionen, kein
auskommentierter Code, keine abgeschalteten Sicherungen. Kommentare ASCII-transliteriert wie
Bestand.

**topTodos:** keine.

---

## 5. Fix-Runden

Keine — der Impl-Durchlauf erreichte PASS ohne nachtraegliche Fix-Runde (Feld `FIXES` in der
Quelle ist leer).
