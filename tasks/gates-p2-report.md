# Phase GATES-P2 — Wechselkurs: eine Quelle (GAP-08 x2)

## Kopfdaten

- **Phase:** GATES-P2 — Wechselkurs-Vereinheitlichung (GAP-08, 2 Gates)
- **Gate:** **BLOCKED**
- **finalBranch:** `phase/gates-p2-fx-single-source-fix2`
- **Merge:** NICHT erfolgt (Gate rot)

## Hinweis zur Herkunft dieses Workflows

Die Implementierung dieser Phase stammt aus einem Lauf, der am **2026-07-27 abgestuerzt** ist,
bevor er einen Abschlussbericht schreiben konnte. Dieser Workflow hat den Branch
`phase/gates-p2-fx-single-source-fix2` in seinem damaligen Stand vorgefunden und **nur
Review (Safety + Clean-Code) und die daraus folgenden Self-Fix-Runden nachgeholt** — die
urspruengliche Implementierungsarbeit (Plan, erste Umsetzung) wurde nicht von diesem Workflow
selbst durchgefuehrt, sondern uebernommen und geprueft.

---

## Abnahme

### 1. Gates (GAP-08 x2)

Beide Ziel-Gates sind **gruen**:

- `GAP-08 (SOLL, rot): der USD/EUR-Kurs ist ueber die Umgebung korrigierbar` → **ok 180**
- `GAP-08 (SOLL, rot): beide Kosten-Achsen rechnen mit DEMSELBEN Kurs` → **ok 181**

Beide in `test/fx-single-source.test.js`, Datei **unveraendert** gegenueber Basis-Commit
`695505e` (nicht im Diff enthalten).

**Rot-vor-Fix am Basis-Commit belegt:** `git show 695505e:src/config.js` enthaelt
`usdToEur: 0.93,` als nacktes Literal und 0 Treffer fuer `usdToEur: numEnv(` →
`isEnvBacked=false` (Test 1 waere rot) und `readLiteral=0.93 != 920000/1e6=0.92`
(Test 2 waere rot).

**Gesamtlauf `test:gates`:** 131 Tests / 97 pass / 34 fail; alle 34 Fehlschlaege gehoeren
fremden Phasen (PAY-19 x2, DID-05, DID-09, GAP-11, GAP-34 x2, GAP-09 x2, LANG-19, GAP-19 x2,
OUT-14, MCP-14, LANG-15, VOICE-12, GAP-31, GAP-06, GAP-24, GAP-26, WEB-07/08/10/13/19, GAP-30,
GAP-23 x2, GAP-05, GAP-15 x2, GAP-37, FMT-15 x2) — kein einziger fx-/Wechselkurs-Test darunter.
36 Baseline-Gates minus die 2 GAP-08 = 34, stimmig.

### 2. Regression (`npm test`)

**3303 bestanden / 0 rot** (roh 3324, davon 21 Datei-Wrapper abgezogen), skipped 0, todo 0,
EXIT=0, Dauer 90,6 s.

Ziel laut Spec: 3295/0 → Abweichung **+8 bestanden**, exakt die 8 neu hinzugefuegten Tests der
Phase (6 in `test/fx-rate-axes-coherence.test.js`: F1-01..F1-04, F2-01, F2-02; 2 in
`test/fx-single-source-fallback-wiring.test.js`).

Kein Bestandstest geaendert, umgeschrieben oder geloescht — der Diff beruehrt an `test/` nur
die 2 neuen Dateien + `BASE_ENV` in `test/helpers.js` → kein neu roter Bestandstest, keine
stille Stilllegung.

### 3. Produkt-Diff

Nicht leer, betrifft:

- `src/config.js`
- `src/boot.js`
- `src/boot-guard.js`

### 4. Testaenderungen

Im von der Spec gedeckten Rahmen (`testChangesAllowed: true`) — additive Deckung neuen
Verhaltens, keine Modifikation bestehender gruener Tests. `test/helpers.js`
(`BASE_ENV += USD_TO_EUR='0.92'`) ist trotz "zulaessige Testaenderung: keine" korrekt, weil die
verbindliche Liste von P2 genau das ausdruecklich fordert (Lehre Test-BASE_ENV-Drift: eine neue
config-Env-Var MUSS in BASE_ENV nachgezogen werden).

---

## Safety-Review (final) — Verdikt: BLOCKED

Alle vier Abnahmepunkte sind fuer sich erfuellt — beide GAP-08-Gates gruen, Regression
vollstaendig gruen (+8 = exakt die neuen Tests), Produkt-Diff nicht leer, Testaenderungen im
gedeckten Rahmen. Die Phase ist **kein VOICE-12-Fall**: das Gate ging gruen, weil sich das
Produkt tatsaechlich geaendert hat (`usdToEur` 0.93-Literal → `numEnv` mit gemeinsamem Default
0.92).

**Blockierend ist allein die Scope-Ueberschreitung:**

- P2 nennt abschliessend `**Dateien:** src/config.js, .env.example` und schaerft nach:
  "Halte den Eingriff eng: eine Quelle, ihre Leser, sonst nichts."
- Der Branch aendert zusaetzlich `src/boot.js` (+24) und `src/boot-guard.js` (+47) und baut
  dort ein neues, **fatales** Boot-Gate (`fxRateAxesDiverged` / `assertFxRateCoherent`).
- Ein Boot-Guard ist kein "Leser der Quelle". `src/boot.js` ist laut PLAN-GATES.md
  ausdruecklich anderen Phasen zugeteilt (P5/W3 und P7/W2: "P7 gegen P5: beide beruehren
  src/boot.js — deshalb liegen sie in verschiedenen Wellen", "In dieser Welle haelt P7 die
  Datei"). `src/boot-guard.js` gehoert laut Spec ueberhaupt keiner Phase.
- P2 liegt in W1 und greift damit zwei Hochrisiko-Phasen vor — keine Formalie: die Kette hat
  die Dateilisten bewusst disjunkt geschnitten.

**Deploy-Risiko aus genau dieser ungefragten Erweiterung:**

`assertFxRateCoherent` ruft `process.exit(1)`, wenn
`|USD_TO_EUR - PROVIDER_TO_BUCKET_RATE_MICRO/1e6| >= 0.005`. `USD_TO_EUR` wird in `render.yaml`
nicht deklariert (P2 darf `render.yaml` laut Spec nicht anfassen — P15 haelt die Datei), faellt
live also auf den Code-Default 0.92. `render.yaml` traegt
`PROVIDER_TO_BUCKET_RATE_MICRO=920000`, das passt — aber die Render-Services sind laut
Betriebsstand dashboard-managed (Live != render.yaml). Traegt das Live-Dashboard einen
abweichenden, von Hand korrigierten Kurs (z. B. 860000), verweigert der Dienst beim naechsten
Deploy den Start — der Ausgang, den die Spec selbst als teuersten benennt ("ein Live-Dienst,
der nicht mehr startet, ist der teuerste Fehlausgang", P7). Ein neues fatales Boot-Gate braucht
eine Owner-Entscheidung und die Pruefung der echten Dashboard-Env — beides ist hier weder
erfolgt noch aus dem Repo verifizierbar.

**Weitere Concerns (nicht blockierend):**

- Bewusster Kurssprung: gemeinsamer Default wird 0.92 (Provider-Achse gewinnt), KI-Achse faellt
  von 0.93 auf 0.92. Beide Verbraucher von `cfg.usdToEur` sind Geldpfade —
  `src/store/state-ops.js:1928` (KI-Kosten-Akku des Budget-Gates) und `:2241` (`aiCostCents`
  fuer den Stripe-Ledger). KI-Kosten werden damit ~1,08 % niedriger in EUR gebucht — kein
  Schutzverlust (kein Gate entfernt/umgangen), aber der Owner sollte 0.92 als gewollten Kurs
  bestaetigen.
- "EINE Quelle" nur zur Haelfte erreicht: `EXCHANGE_RATE_DEFAULTS.usdToEur = 0.92` und das
  Literal `920000` am `numEnv`-Fallback von `PROVIDER_TO_BUCKET_RATE_MICRO` bleiben zwei Zahlen
  im Quelltext, gekoppelt nur durch Kommentar + Gate-Test. Eine staerkere, strikt in-scope
  Loesung waere greifbar gewesen: den `usdToEur`-Fallback aus dem env-aufgeloesten
  Provider-Kurs ableiten (nur `src/config.js`) — dann haette das Setzen von
  `PROVIDER_TO_BUCKET_RATE_MICRO` die Achsen gar nicht mehr auseinandertreiben koennen, und der
  Griff nach `boot.js` waere unnoetig gewesen.
- Namens-Falle: `test/fx-single-source-fallback-wiring.test.js` matcht das Gate-Glob
  `test/fx-single-source*.test.js` der Spec. Funktional harmlos (Lauf-Trennung geht ueber
  Testnamen, nicht Dateinamen), aber irrefuehrend fuer kuenftige Suche nach "den
  GAP-08-Gates".
- Positiv, unbeauftragt: `numEnv('USD_TO_EUR', ..., {min: 0.1, integer:false})` ist
  fail-closed, Konstanten benannt (`USD_TO_EUR_MIN`, `FX_RATE_MICRO_PER_UNIT`,
  `FX_RATE_TOLERANCE`), keine Magic Numbers, keine neue npm-Dependency, `node --check` gruen
  fuer alle drei Produktdateien, Fehlertext des neuen Guards nennt nur Kurse, keine Secrets.

**Empfehlung des Reviews:** entweder der Owner erweitert die P2-Dateiliste ausdruecklich und
bestaetigt das neue fatale Gate gegen die echte Render-Env, oder der Kreuz-Check wandert nach
P7 (haelt `boot.js` ohnehin) und P2 schliesst die Divergenz in-scope, indem der
`usdToEur`-Fallback in `src/config.js` aus dem env-aufgeloesten Provider-Kurs abgeleitet wird.
Zusaetzlich vom Owner zu bestaetigen: der gemeinsame Kurs ist 0.92.

---

## Clean-Code-Audit (final)

**Blocker:** `true` (S1/S2 zaehlen als Blocker in diesem Repo, s. `.claude/refs/clean-code.md`)

### S1

Keine.

### S2

1. **G5 (S2)** — `src/config.js:1071-1076` (`usdToEur`) + `src/config.js:432-441`
   (`providerToBucketRateMicro`): Der Kurs existiert weiterhin als **zwei unabhaengig
   gepflegte Literale** (`EXCHANGE_RATE_DEFAULTS.usdToEur=0.92` und der `numEnv`-Fallback
   `providerToBucketRateMicro=920000`) statt einer Quelle — genau das Problem, das GAP-08
   ("ein gepflegter Kurs") laut Kommentar loesen sollte, bleibt strukturell bestehen; die
   Kohaerenz wird nur durch 3 Tests (`fx-single-source`, `fx-rate-axes-coherence`,
   `fx-single-source-fallback-wiring`) UND den neuen Boot-Guard erzwungen, nicht durch die
   Struktur selbst (G27: Disziplin/Tests statt Struktur). Fix: den Mikro-Fallback rechnerisch
   aus `EXCHANGE_RATE_DEFAULTS.usdToEur` ableiten, z. B.
   `fallback: Math.round(EXCHANGE_RATE_DEFAULTS.usdToEur * FX_RATE_MICRO_PER_UNIT)` — dann
   gaebe es nur noch eine echte Zahl im Code, die drei Tests wuerden zu reinen
   Regressions-Ankern statt zur einzigen Kohaerenz-Sicherung.
2. **G5 (S2, klein)** — `test/fx-single-source-fallback-wiring.test.js:20-51`
   (`readBuiltRates` / `readBuiltRatesWithoutUsdToEurEnv`): Zwei Funktionen mit identischem
   `script`-String und identischem `execFileSync`-Aufruf, die sich nur in der
   env-Berechnung unterscheiden (Form 2 aus G5: gemeinsame Schritte nicht extrahiert). Fix:
   eine Funktion `readBuiltRates(envOverrides)`, die intern optional `USD_TO_EUR` aus
   `BASE_ENV` entfernt, oder den `script`-String in eine gemeinsame Konstante auslagern.

### S3

- **G16/G26 (S3, unkritisch)** — `src/boot-guard.js` `fxRateAxesDiverged` /
  `FX_RATE_TOLERANCE=0.005`: Grenzwert ist plausibel begruendet (faengt 0.01-Differenz aus dem
  Original-Bug, tolerant genug fuer Rundung), aber willkuerlich gewaehlt ohne expliziten Bezug
  zur Mikro-Ganzzahl-Rundungsgrenze (1 Mikro-Einheit = 0.000001) — ein Kommentar mit der
  rechnerischen Herleitung waere praeziser, aber nicht blockierend.

### S4

Keine nennenswerten Befunde (Anzahl neuer Funktionen/Konstanten angemessen fuer die Aufgabe,
keine Ein-Methoden-Klassen oder unnoetige Indirektion).

### Verdikt Clean-Code-Auditor

Die Phase ist funktional korrekt und sicherheitsseitig sauber: `assertFxRateCoherent` ist
fail-closed vor jedem `process.exit`-Gate eingehaengt, die Reihenfolge in `assertBootGates` ist
korrekt aktualisiert (sechstes→siebtes Gate verschoben, achtes neu), und die vier neuen
Testdateien belegen sowohl den reinen Unit-Vergleich (`fxRateAxesDiverged`) als auch den echten
Boot-Beweis via Kindprozess (F2-01/02). Verifiziert in isolierter Kopie des Branches (kein
Git-Checkout im Worktree, nur `git show` + `rsync`), `npm install` ausgefuehrt: `node --check`
fuer alle drei geaenderten `src`-Dateien gruen, die 4 neuen/betroffenen Testdateien (16 Tests)
gruen, volle Regressions-Suite `npm test` bleibt gruen (3323/3323, nach i18n-Wrapper-Abzug
3303/3303 — keine Regression).

Der einzige echte Befund ist strukturell, nicht funktional: der Kurs ist trotz des Namens
"GAP-08: ein gepflegter Kurs" weiterhin zwei separat gepflegte Literale, deren Kohaerenz per
Tests statt per Struktur erzwungen wird (G27/G5, S2) — real, aber klein und durch die Tests
bereits vollstaendig abgesichert; kein Sicherheits- oder Korrektheitsrisiko, da ein
Auseinanderlaufen den Boot zuverlaessig blockiert.

**Top-TODOs:**

1. `config.js`: `providerToBucketRateMicro`-Fallback rechnerisch aus
   `EXCHANGE_RATE_DEFAULTS.usdToEur` ableiten statt als zweites Literal zu fuehren (echte
   Single-Source statt test-erzwungener Kohaerenz).
2. `test/fx-single-source-fallback-wiring.test.js`: `readBuiltRates`/
   `readBuiltRatesWithoutUsdToEurEnv` auf eine gemeinsame Helper-Funktion zusammenziehen.

**Pass-Notizen:** Sehr sorgfaeltige Arbeit: fail-closed-Muster konsequent uebernommen (Muster
`providerRateOutOfBand`/`assertProviderRateInBand` 1:1 gespiegelt), Kommentare erklaeren
Ursache, Reihenfolge und Testabdeckung praezise, `BASE_ENV` korrekt um `USD_TO_EUR` ergaenzt
(Lehre test-base-env-drift beachtet), Boot-Gate-Reihenfolge-Kommentar in `assertBootGates`
korrekt mitgezogen. Money-as-integer (G26) auf der Provider-Achse weiter respektiert, die
Dezimal-Achse (`usdToEur`) bewusst und begruendet als Float belassen (Kurs, kein Geldbetrag).
Boot-Beweis-Tests (F2-01/02) sind das staerkste Element — sie zeigen echtes Verhalten (Server
startet nicht / startet doch) statt nur die reine Funktion zu pruefen.

---

## Fix-Runden

- **r1:** GAP-08-TEST-MASKED behoben (einziger Blocker der Runde). Befund: Der Testcode las den
  USD/EUR-Kurs per Regex ueber den Property-Namen `usdToEur:` im Quelltext und traf dabei den
  **ersten** Treffer — die dekorative Kopie in `EXCHANGE_RATE_DEFAULTS`, nicht zwingend die
  `numEnv`-gebundene Konfiguration. Behoben.
- **r2:** Einziger Review-Blocker der Phase (S1, GAP-08 Kreuz-Check) behoben. Neue reine
  Entscheidungsfunktion `fxRateAxesDiverged` (`src/boot-guard.js`) vergleicht
  `config.llm.usdToEur` gegen `config.billing.providerToBucketRateMicro/1_000_000` mit einer
  benannten Toleranz (`FX_RATE_TOLERANCE=0.005` — faengt den urspruenglichen Bug).

**Ergebnis nach r1/r2:** Beide GAP-08-Gates gruen, Regression gruen, Clean-Code-Auditor gibt
PASS (mit S2-Empfehlungen, nicht blockierend) — **aber** das Safety-Review haelt den Branch
wegen der Scope-Ueberschreitung (`src/boot.js`, `src/boot-guard.js` statt nur
`src/config.js`, `.env.example`) weiterhin fuer **BLOCKED**. Die Phase ist damit nicht
merge-faehig; es bedarf einer Owner-Entscheidung (Dateiliste erweitern + Render-Dashboard-Env
pruefen) oder einer In-Scope-Umsetzung, die den Kreuz-Check aus `boot.js`/`boot-guard.js`
entfernt und stattdessen den Fallback rechnerisch ableitet.
