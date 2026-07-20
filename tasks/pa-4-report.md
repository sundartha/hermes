# Phase PA-4 — Detailbericht

**Fund:** S1 `numEnv()` weist teil-numerische Env-Werte (Int + Float) fail-closed ab, statt sie via `parseInt`/`parseFloat` still auf einen numerischen Prefix (Teilwert) zu kappen; Rand-Whitespace bleibt gueltig (PM-4)
**Gate:** PASS
**finalBranch:** `phase/polish-a-p4`

---

## 1. Bug-Verankerung (gegen `master`)

- **Bug (bestaetigt):** `numEnv()` in `src/config.js` prueft heute nur `Number.isFinite(parseInt(raw,10))` bzw. `Number.isFinite(parseFloat(raw))`. `parseInt`/`parseFloat` parsen jedoch nur einen numerischen **Prefix** des Strings und ignorieren den Rest still: `parseInt("120abc",10) === 120`, `parseFloat("8.5abc") === 8.5`. Ein vertippter Wert bei einem Safety-/Kosten-Gate-Env (`MAX_CALLS_PER_HOUR`, `PER_TARGET_CALL_CAP`, `MAX_BUDGET_EUR`, `MAX_CALL_DURATION_S`, `RATE_LIMIT_PER_MIN`, ...) rutscht dadurch **lautlos auf einen Teilwert** durch, statt Boot zu verweigern.
- **Reichweite:** `numEnv` wird ausschliesslich innerhalb von `src/config.js` selbst aufgerufen (verifiziert per `git grep numEnv` — nur `src/config.js` + `test/config-failclosed.test.js`); der Fix greift damit fuer alle numerischen Config-Vars ohne Aufrufer-Aenderung.
- **Referenzmuster:** Bestehender Fail-closed-Mechanismus (`fatalConfigErrors` -> `assertConfig()` -> Boot-Refusal) bleibt strukturell unveraendert; der Fix schaerft nur die Eingangsvalidierung von `numEnv` selbst.

**Blast-Radius (geplant):** reiner Robustheits-Fix an einer Parse-Funktion in `src/config.js`; kein Endpunkt, keine Signaturaenderung, keine neue Dependency. `boolEnv`/`configFatalErrors`/`assertConfig` unberuehrt.

---

## 2. Plan (gekuerzt)

### 2a. Design
Zwei benannte Muster-Konstanten (G25/G16, keine Magic-Literale inline):

```js
const NUM_ENV_INTEGER_PATTERN = /^[+-]?\d+$/;
const NUM_ENV_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
```

Reihenfolge: `.trim()` **zuerst** (PM-4) -> Voll-String-Match gegen das passende Muster -> Parse -> unveraenderte `Number.isFinite`/`min`/`max`-Logik.

Begruendungen:
1. **`.trim()` zuerst (PM-4, Pflicht):** ein Voll-String-Check ohne vorheriges Trim wuerde eine seit Monaten laufende Render-Env mit Trailing-Newline (`"6\n"`) als Muell ablehnen -> Boot-Refusal beim naechsten Deploy -> Live-Outage. `raw.trim()` wird gebildet, Muster und Parse laufen gegen `trimmed`.
2. **`[+-]?` zwingend (Regressions-Guard):** Bestandstest T-P2-03 (`numEnv("MAX_CALLS_PER_HOUR","-1",{min:0})`) erwartet die Minimum-Meldung, nicht "keine gueltige Zahl" — das Muster muss `"-1"` bis zur `min`-Pruefung durchlassen.
3. **Integer-Muster strikt (`\d+`, kein `.`):** `parseInt("8.5",10)===8` ist selbst ein stiller Teilwert und faellt exakt unter die Phasen-Invariante. Kein Bestandswert (`.env.example`, `test/**`, `src/**`, `BASE_ENV`) enthaelt einen Dezimal-String fuer ein Integer-Feld.
4. **Dezimal-Muster ohne Exponential-/Hex-Notation** (bewusste Grenze, C4-dokumentiert): einziges Float-Feld ist `MAX_BUDGET_EUR`; akzeptiert `8`, `8.`, `8.5`, `.5` (+Vorzeichen), abgelehnt `8.5abc`, `1e3`, `0x10`.
5. **`Number.isFinite(n)` bleibt zweite Klausel:** faengt Ueberlauf gueltiger Ziffernketten auf `Infinity`, was das Muster allein nicht sieht.
6. **`boolEnv` unveraendert**, `numEnv`/`boolEnv` bleiben eager (kein Lazy-Getter). Fatal-Meldung nennt weiter `${raw}` verbatim (keine Secrets betroffen, nur numerische Vars).

### 2b. Exakte Edits in `src/config.js`
- **3a:** Header-Kommentar an `fatalConfigErrors` praezisiert (nennt jetzt auch "teil-numerischer Muell", nicht nur NaN/Infinity/Bereich).
- **3b:** die beiden Muster-Konstanten inkl. WHY-Kommentar nach `const fatalConfigErrors = [];` eingefuegt.
- **3c:** `numEnv`-Body: `trimmed = raw.trim()`, `pattern` je nach `integer`-Flag gewaehlt, `n` gegen `trimmed` geparst, Bedingung auf `!pattern.test(trimmed) || !Number.isFinite(n)` erweitert. Rest der Funktion (`min`-Pruefung, `max`-Clamp, `return n`) bleibt byte-identisch.

### 2c. Neue Tests in `test/config-failclosed.test.js`
- **T-P2-07:** Int-Trailing-Muell `"120abc"` -> Fatal + Fallback (kein stiller Teilwert 120).
- **T-P2-08:** Float-Trailing-Muell `"8.5abc"` -> Fatal + Fallback (kein stiller Teilwert 8.5).
- **T-P2-09:** Rand-Whitespace bleibt gueltig (Int `"  6  "` und Float `"  8.5  "` — kein neuer Fatal, Positiv-Erhaltung PM-4).
- **T-P2-10:** Trailing-Muell an einem Gate (`RATE_LIMIT_PER_MIN`) -> `assertConfig()` verweigert Boot, Diagnose nennt die Var.

### 2d. `test/helpers.js` (BASE_ENV) — keine Aenderung
Alle numerischen BASE_ENV-Werte sind saubere Plain-Integer-Strings; gezielte Scans nach `.`, internem/Trailing-Whitespace und Ziffern-Buchstaben-Mix in `.env.example`/`test/**`/`src/**` lieferten null Treffer. Der Impl-Agent sollte den Scan erneut bestaetigen statt blind zu editieren.

### 2e. Rot-vor-Fix-Protokoll (Pflicht)
Muster-Klausel temporaer entfernen -> T-P2-07/08/10 muessen rot werden, T-P2-09 bleibt gruen (Positiv-Erhaltung) -> Fix zuruecksetzen -> alle 12 Tests gruen. Safety-Reviewer vollzieht dies unabhaengig nach.

### 2f. Deterministisch pruefbares Ergebnis (Plan-Vorgabe)
`node --check src/config.js` -> Exit 0. `node --test test/config-failclosed.test.js` -> 12/12 gruen (8 Bestand + 4 neu). `npm test` -> volle Suite gruen, +4 Tests ggue. Baseline; bekannter ~12%-Voll-Last-Flake nur werten, wenn isoliert reproduzierbar.

Betroffene Pfade: `src/config.js` (Edits 3a/3b/3c), `test/config-failclosed.test.js` (4 neue Tests), `test/helpers.js` (keine Aenderung, nur Re-Verifikation).

---

## 3. Impl-Zusammenfassung + Deviations

- **headCommit:** `34473cd87f8f212f924435a21dd231f117087863`
- **nodeCheckPass:** true — **testsPass:** true — **testPassCount:** 2374 — **testFailCount:** 0
- **committed:** true (Branch `phase/polish-a-p4`)
- **filesEdited:** `src/config.js`, `test/config-failclosed.test.js`
- **filesCreated:** keine
- **testsAddedOrChanged:**
  - T-P2-07: Int-Trailing-Muell `'120abc'` -> Fatal + Fallback (kein stiller Teilwert 120)
  - T-P2-08: Float-Trailing-Muell `'8.5abc'` -> Fatal + Fallback (kein stiller Teilwert 8.5)
  - T-P2-09: Rand-Whitespace bleibt gueltig (Int `'  6  '` und Float `'  8.5  '` — kein neuer Fatal)
  - T-P2-10: Trailing-Muell an einem Gate -> `assertConfig` verweigert Boot (nennt die Var)
- **smokePass:** true — zwei echte End-to-End-Smoke-Tests mit dem Server-Binary: (1) `MAX_CALLS_PER_HOUR="120abc"` -> Server exitet mit Code 1, Log zeigt exakt `[Konfiguration fatal] Boot wird verweigert: - MAX_CALLS_PER_HOUR="120abc" ist keine gueltige Zahl (erwartet: Ganzzahl, >= 0).` — Boot-Refusal end-to-end bestaetigt. (2) `MAX_CALLS_PER_HOUR="  6  "` (PM-4-Whitespace-Fall) nach Owner-Nummer-Seed via `bootstrap-tenant.js` -> Server bootet, `/healthz` liefert HTTP 200, Boot-Banner zeigt korrekt "max 6 Calls/h" (getrimmter Wert korrekt durchgereicht).

**cleanCodeSelfCheck (Impl):** G25/G16 — Muster als benannte Konstanten (`NUM_ENV_INTEGER_PATTERN`, `NUM_ENV_DECIMAL_PATTERN`) statt Inline-Regex-Literale. C4 — deliberate Grenze (kein Exponent/Hex) im Kommentar begruendet. C2 — Header-Kommentar an `fatalConfigErrors` aktualisiert. G5 — keine Duplizierung, ein Muster-Paar, ein `pattern`-Zweig fuer beide Faelle. P11 — neues Verhalten mit automatisierten Tests, Rot-vor-Fix durchexerziert. P15 — `numEnv` bleibt eager, Konstanten sind Modul-Top-Level. F1 — Signatur unveraendert (3 Positionsargumente + Options-Objekt). G30/G34 — `numEnv` bleibt eine Aufgabe auf einer Abstraktionsebene, keine neue Verschachtelung. Keine Magic Numbers ausser 0/1, kein toter/auskommentierter Code, keine abgeschaltete Sicherung. Diff vor Commit byte-identisch zum Plan verifiziert.

**deviations:**
1. Ein Detail des Rot-vor-Fix-Protokolls (§2e) traf beim vollen Datei-Lauf nicht exakt zu: T-P2-10 blieb bei deaktiviertem Fix im **gesamten** Datei-Lauf gruen (statt wie geplant rot), weil die vorausgehende T-P2-05 bereits einen `RATE_LIMIT_PER_MIN`-Fatal in das modulweit akkumulierende `fatalConfigErrors[]`-Array gepusht hatte (`"kaputt"`) — dieser aeltere Fatal genuegte allein, um `assertConfig()` false zurueckgeben zu lassen und die Diagnose-Zeile `RATE_LIMIT_PER_MIN` zu nennen, unabhaengig vom Fix-Status. **Isoliert** (`node --test --test-name-pattern=T-P2-10`) bestaetigte sich dagegen exakt das vom Plan vorhergesagte Rot (`assertConfig()=true` statt `false`, `AssertionError true!==false`) — der Fix beweist sich damit korrekt, nur die Demonstration im vollen Datei-Lauf war durch Testreihenfolge/Akkumulation maskiert. Als Ursache identifiziert und dokumentiert, keine Aenderung an der Testdatei-Struktur vorgenommen (Plan-Scope war exakte Umsetzung, keine Restrukturierung des Akkumulations-Musters).

---

## 4. Safety-Urteil (final)

**approved:** true
**testsPassIndependently:** true — **safetyGatesIntact:** true — **disclosureIntact:** true — **authFailClosedIntact:** true — **noSecretsLeaked:** true — **scopeRespected:** true — **behaviorAsIntended:** true

**independentTestSummary:** Beide Backends selbst laufen lassen. Volle Suite: erster Lauf 1 Fehler in `test/voice-status-lifecycle.test.js` (no-answer-Status-Race), zweiter Lauf 2374/2374 gruen. Fehler als bekannter Voll-Last-Flake (Seed-vor-Boot-Race) verifiziert: isoliert 2/2 gruen, Datei beruehrt keinen `numEnv`-Codepfad. PG-Backend (pglite) Teilmenge (`rls-with-check`, `web-auth-pg`, `bk4-quota-view`, `config-prod-footguns`) 55/55 gruen.

Unabhaengige Rot-vor-Fix-Verifikation: Fix-Bedingung temporaer auf die alte `if (!Number.isFinite(n))` zurueckgesetzt -> (a) T-P2-07 Int `'120abc'` ROT (lieferte still 120 statt Fallback 6), (b) T-P2-08 Float `'8.5abc'` ROT (still 8.5), (c) T-P2-09 Whitespace `'  6  '`/`'  8.5  '` blieb GRUEN. Fix per `git checkout` wiederhergestellt -> alle 4 wieder gruen. Direkte Ausfuehrung bestaetigte: gueltige Formen byte-identisch (plain `120`, `'  6  '`->6, `'120\n'`->120, `'+8.5'`->8.5, alle 0 Fatals = PM-4 trim-zuerst erhalten), Clamp `500>max300`->300 ohne Fatal, unter-min `-5`->Fallback+Fatal, Muell `1e3`->Fatal+Fallback. `boolEnv` im Diff unberuehrt, `numEnv`/`boolEnv` bleiben eager. Arbeitsverzeichnis am Ende sauber, `review-pa-4 == phase/polish-a-p4` (`34473cd`).

**blockers:** keine.

**concerns (nicht-blockierend):**
1. T-P2-10 (`assertConfig`-Integrationstest) wird bei zurueckgesetztem Fix nicht rot — stuetzt sich auf von frueheren Tests derselben Datei akkumulierte Fatals, `RATE_LIMIT_PER_MIN "120abc"` erzeugt unter altem Code selbst keinen Fatal. Schwaecherer Integrationstest, aber keiner der drei mandatierten Rot-vor-Fix-Faelle; (a)/(b)/(c) sind durch T-P2-07/08/09 sauber bewiesen.
2. Exponential-/Hex-Formen (`'1e3'`, `'0x10'`), die `parseInt`/`parseFloat` frueher als Teilwert akzeptierten, werden jetzt Fatal. Von der Spec explizit akzeptiert; kein dokumentiertes Env (`.env.example`/BASE_ENV) nutzt diese Formen -> kein Live-Outage-Risiko. Bewusste Verhaltensaenderung.

**verdict:** APPROVED. PA-4 ist ein reiner fail-closed S1-Fix (`numEnv` weist teil-numerischen Muell wie `'120abc'`/`'8.5abc'` ab statt still auf Teilwert zu kippen), streng auf `src/config.js` + `test/config-failclosed.test.js` begrenzt, keine neue npm-Dependency, keine Aenderung an Safety-Gates/Disclosure/Auth/Secrets. Aendert die Fail-closed-Haltung nur zu mehr Sicherheit (Boot-Refusal statt lautlos abgeschaltetem Budget-/Stundenlimit-Gate). Alle Zusatz-Invarianten erfuellt: Clamp `n>max` bleibt (kein Fatal), `n<min` bleibt Fatal, `boolEnv` unveraendert, `numEnv` eager, PM-4 trim-zuerst (Positiv-Test `'  6  '` gruen). Rot-vor-Fix unabhaengig nachvollzogen. Tests in beiden Backends gruen (2374/2374 nach Flake-Ausschluss, pglite 55/55).

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS — keine S1/S2-Blocker. Minimaler, scharf fokussierter Diff (2 Dateien, ~76 Zeilen): `numEnv()` lehnt jetzt teil-numerischen Muell (`"120abc"`) per Voll-String-Regex ab, statt ihn via `parseInt`/`parseFloat` still auf einen Teilwert zu kappen. 4 neue gezielte Tests (T-P2-07..10) + volle Suite in isoliertem Worktree-Checkout verifiziert gruen (2374/0, 0 fail).
**blocker:** false

### s1 (Blocker)
Keine.

### s2 (Blocker)
Keine.

### s3 (nicht-blockierend)
- **S3 (leicht)** · `test/config-failclosed.test.js:100-112` (T-P2-09): Testname/-body buendelt zwei Grenzfall-Konzepte (Int-Trim UND Float-Trim) in einem Test mit "und" im Namen — P14/T1-Signal (Ein-Konzept-pro-Test). Fix (optional): in zwei separate Tests splitten. Folgt aber demselben Buendelungs-Muster wie die bereits bestehenden T-P2-03/04/06 in derselben Datei (G24-Konvention-Konsistenz) — daher nur als Kleinigkeit, kein zwingender Fix.

### s4
Keine.

**passNotes:**
1. `NUM_ENV_INTEGER_PATTERN`/`NUM_ENV_DECIMAL_PATTERN` sind saubere, benannte Voll-String-Regexes ohne ReDoS-Risiko (keine verschachtelten Quantifizierer).
2. `.trim()` korrekt vor dem Pattern-Check (verhindert False-Positives bei Trailing-Newline/Spaces aus Hosting-Envs, PM-4 wurde bedacht).
3. Kommentare praezise auf Deutsch ohne Umlaute, erklaeren durchgaengig das "Warum" (Safety-/Kosten-Gate-Kontext), keine C1-C5-Verstoesse, kein toter/auskommentierter Code, keine Magic Numbers, keine abgeschalteten Sicherungen (G4).
4. Keine Duplizierung (G5) — die zwei Regex-Konstanten sind distinkt, an einer Stelle verwendet. `numEnv` bleibt < 20 Zeilen, Argumentzahl (3) unveraendert (F1 n.a., Flag-Argument `integer` war bereits vor PA-4 vorhanden, nicht neu eingefuehrt).
5. Volle Suite (`npm test`) in einem per `git worktree add --detach` isolierten Checkout von `phase/polish-a-p4` lief gruen: 2374 pass / 0 fail, inkl. der 4 neuen Tests T-P2-07 bis T-P2-10 sowie aller bestehenden `config-failclosed`-Tests.
6. Kein neuer Env-Var eingefuehrt -> `.env.example`/`render.yaml` nicht betroffen (CLAUDE.md-Pflicht n.a.).
7. Der Fix deckt nebenbei einen vorher bereits vorhandenen stillen Bug auf: `parseInt('0x10',10)` lieferte vor diesem Fix `0` (gueltig, kein Fatal) statt als Muell erkannt zu werden — jetzt korrekt Fatal.
8. `PLAN-SECURITY.md` wurde nicht angefasst; da dies eine interne Haertung eines bereits bestehenden Fail-Closed-Mechanismus (`numEnv`/OT-4) ist und keine neue Gate-Grenze/kein neuer Schwellwert eingefuehrt wird, nicht zwingend, nur als Hinweis genannt.

**topTodos:**
1. Kein Blocker — Branch ist merge-faehig so wie er ist.
2. Optional/niedrige Prioritaet: T-P2-09 in zwei separate Tests (Int-Trim, Float-Trim) splitten fuer strikte P14-Konformitaet.
3. Optional/niedrige Prioritaet: die im Kommentar dokumentierte, bewusste Ablehnung von Exponential-/Hex-Notation (`"1e10"`, `"0x10"`) liesse sich mit einem expliziten Test zusaetzlich absichern — aktuell nur durch Code-Kommentar belegt, der Kern-Mechanismus (Voll-String-Match) ist aber bereits ausreichend getestet.

---

## 6. Fix-Runden

Keine — Safety- und Clean-Code-Review haben den finalen Stand von Branch `phase/polish-a-p4` (Commit `34473cd`) direkt ohne Blocker approved (Safety: `approved=true`, keine `blockers`; Clean-Code: `s1=[]`, `s2=[]`, `blocker=false`). Der einzige S3-Hinweis (T-P2-09: zwei Konzepte in einem Test) ist als optionales `topTodo` dokumentiert, kein Gate-Blocker.

**finalBranch:** `phase/polish-a-p4`

**Gate-Ergebnis:** PASS.
