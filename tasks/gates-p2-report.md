# Phase GATES-P2 — Wechselkurs: eine Quelle (GAP-08 x2)

## Kopfdaten

- **Phase:** GATES-P2 — Wechselkurs-Vereinheitlichung (GAP-08, 2 Gates)
- **Gate:** **PASS**
- **finalBranch:** `phase/gates-p2-fx-single-source-fix3`
- **Vorlaeufer:** `phase/gates-p2-fx-single-source-fix2` (BLOCKED, siehe Git-History dieser Datei) — nach Scope-Rueckbau (boot.js/boot-guard.js-Kreuz-Check entfernt) neu geprueft und PASS.

## Hinweis zur Herkunft dieses Workflows

Die Implementierung dieser Phase stammt aus dem Lauf, der am **2026-07-27 abgestuerzt** ist.
Dieser Workflow hat den Branch `phase/gates-p2-fx-single-source-fix3` in seinem finalen Stand
(Commit `7cc642b`) vorgefunden und **nur Review (Safety + Clean-Code) nachgeholt** — keine
eigene Implementierungsarbeit in diesem Durchlauf.

---

## Scope-Rueckbau gegenueber fix2

Der vorherige Stand (`fix2`, BLOCKED) hatte zusaetzlich zu `src/config.js`/`.env.example` auch
`src/boot.js` und `src/boot-guard.js` angefasst und dort ein neues fatales Boot-Gate
(`fxRateAxesDiverged`/`assertFxRateCoherent`) mit eigener zweiter Env-Variable `USD_TO_EUR`
gebaut — Scope-Ueberschreitung gegenueber der P2-Dateiliste, blockierendes Deploy-Risiko
(Live-Dashboard-Env unbekannt).

Der finale Commit `7cc642b` hat diesen Zwischenschritt bewusst zurueckgebaut: `boot.js` und
`boot-guard.js` sind gegenueber der Basis `695505e` wieder **byte-identisch**, keine eigene
`USD_TO_EUR`-Variable, kein `fxRateAxesDiverged`, keine verwaiste
`test/fx-rate-axes-coherence.test.js`. Stattdessen wird `llm.usdToEur` **rechnerisch aus
derselben** `PROVIDER_TO_BUCKET_RATE_MICRO`-Variable abgeleitet — eine echte Ein-Quelle-Loesung
statt eines Laufzeit-Kreuz-Checks zwischen zwei unabhaengigen Variablen.

---

## Abnahme

### 1. Gates (GAP-08 x2)

Beide Ziel-Gates sind **gruen**, Beleg aus dem Safety-Review:

- `test/fx-single-source.test.js:54` — "GAP-08 (SOLL, rot): der USD/EUR-Kurs ist ueber die
  Umgebung korrigierbar"
- `test/fx-single-source.test.js:63` — "GAP-08 (SOLL, rot): beide Kosten-Achsen rechnen mit
  DEMSELBEN Kurs"

Eigener Lauf: `NODE_ENV=test node test/i18n-catalog-run.mjs gates` auf `review-gates-p2-fx3`
(= `phase/gates-p2-fx-single-source-fix3`, `7cc642b`). Gesamtlauf: tests 131 / pass 97 /
fail 34 — kein GAP-08 unter den 34 roten.

**Negativkontrolle gegen die Basis:** `git show 695505e:src/config.js` zeigt `usdToEur: 0.93`
als nacktes Literal → `isEnvBacked=false` und `0.93 != 920000/1e6` — beide Gates waren an der
Basis echt rot.

Das Gruen kommt vom Produkt, nicht von einer Testaenderung: `git diff 695505e..HEAD --
test/fx-single-source.test.js` ist leer (Gate-Datei byte-identisch).

### 2. Regression (`npm test` / `test:gates`-Regressionslauf)

**3297 bestanden / 0 rot** (eigener Lauf
`NODE_ENV=test node test/i18n-catalog-run.mjs regression`, exit 0; tests 3297 / pass 3297 /
fail 0, cancelled 0, skipped 0, todo 0, 0 Zeilen "not ok").

Spec-Ziel 3295 + genau die 2 neu hinzugekommenen Regressionstests
(`test/fx-single-source-fallback-wiring.test.js`) = 3297. Kein einziger Bestandstest wurde
entfernt oder ist rot; ausser einer Kommentarzeile in `test/helpers.js` wurde keine bestehende
Testdatei angefasst. Ein erster Hintergrundlauf wurde extern abgebrochen ("Interrupted while
running") und ist verworfen — gewertet ist der vollstaendige Vordergrundlauf.

Volle Suite (Voll-Last, alle Tests): 3317/3318 gruen, der eine Fehlschlag
(`test/a4-default-profile-zero.test.js`) ist bei Isolation gruen — deckt sich mit dem bekannten
vorbestehenden ~12%-Voll-Last-Flake (Seed-vor-Boot-Race, MEMORY:
`suite-flake-p5-gate-proof-spawn-race`), keine Regression durch diesen Diff.

### 3. Produkt-Diff

Nicht leer, betrifft ausschliesslich:

- `src/config.js`

(plus `.env.example` als Dokumentation, wie von der Spec vorgesehen). Kein Griff in
`src/boot.js`/`src/boot-guard.js` mehr — das war genau die in fix2 blockierte
Scope-Ueberschreitung.

### 4. Testaenderungen

Gate-Datei `test/fx-single-source.test.js` unangetastet (byte-identisch). `test/helpers.js`
nur eine Kommentarzeile geaendert. Neu, additiv:
`test/fx-single-source-fallback-wiring.test.js` (2 Tests, ohne Katalog-ID-Praefix, laeuft im
Regressionslauf mit) — prueft den **gebauten** Wert im Kindprozess statt den Quelltext und
schliesst damit die Luecke, die der (fixierte) Quelltext-Regex-Gate-Test hat.

Auslegungsspannung zu "Zulaessige Testaenderung: keine" wurde im Safety-Review geprueft und
nicht als Blocker gewertet: (a) die Gate-Datei ist byte-identisch, (b) beide neuen Testnamen
tragen keine Katalog-ID und koennen kein Gate gruen faerben (GAP-08 kommt im Regressionslog
0x vor), (c) die Phasenregeln erlauben neue Regressionstests fuer eine neue Sperre ausdruecklich.

---

## Safety-Review (final) — Verdikt: FREIGABE (`approved: true`)

Alle vier Abnahmepunkte selbst gefahren und erfuellt:

1. **Gates gruen:** beide GAP-08-Tests gruen, an der Basis `695505e` beweisbar rot. 34 Gates
   bleiben rot, keiner davon gehoert zu P2.
2. **Regression:** 3297/0. Kein neu roter Bestandstest, kein verschwundener Test.
3. **Produkt-Diff nicht leer:** `src/config.js`. Das Gate ist gruen, WEIL sich das Produkt
   geaendert hat — kein VOICE-12-Muster.
4. **Testaenderungen:** Gate-Datei unangetastet; `test/helpers.js` nur eine Kommentarzeile;
   eine neue, additive Regressionstestdatei ohne Katalog-ID.

**Substanz des Fixes, unabhaengig nachgemessen** (Kindprozess-Sonde gegen `src/config.js`,
nicht dem Bericht geglaubt):

- Ohne Env: `usdToEur` 0.92 / micro 920000, keine Fatals.
- `PROVIDER_TO_BUCKET_RATE_MICRO=1500000`: `usdToEur` 1.5 / micro 1500000 — **eine** Variable
  bewegt beide Achsen, gluecklicher Pfad erlaubt.
- `=abc` bzw. `=0.92`: beide Achsen auf Fallback, Fatal gesetzt (Boot verweigert) — fail-closed
  intakt.

Damit ist die Zusage der Phase am gebauten Objekt belegt, nicht nur am Quelltext-Regex des
Gates.

**Absolute Regeln:** Der Produkt-Diff besteht ausschliesslich aus einem Feld in `src/config.js`
plus Kommentaren. Kein Safety-Gate (Denylist/Land/Stundenlimit/Budget-Guard/Max-Dauer/
Signaturpruefung) beruehrt, kein Endpunkt hinzugefuegt, `disclosureSentence` in `claude.js`/
`bridge.js` unveraendert, kein Auth-Pfad und kein `safeEqual` angefasst, kein Secret in
Logs/Responses (die `numEnv`-Diagnose nennt nur `PROVIDER_TO_BUCKET_RATE_MICRO`, kein
Geheimnis), kein MCP-Pfad, kein Audio. Keine neue npm-Dependency (`package.json`/
`package-lock.json` unveraendert). `render.yaml` wie von der Spec verlangt nur geprueft,
**nicht** geaendert — kein Wellen-Konflikt mit P15. Dateiliste eingehalten (`src/config.js`,
`.env.example`), kein Griff in eine Nachbarphase.

### Concerns (nicht blockierend, vor Merge zur Kenntnis zu nehmen)

1. **Bewusster Kurs-Sprung auf der KI-Achse:** `config.llm.usdToEur` faellt von 0,93 auf 0,92
   (-1,1 %). `render.yaml:210` pinnt `PROVIDER_TO_BUCKET_RATE_MICRO=920000`, der Sprung wird
   also mit dem Deploy real. Richtung: gebuchte KI-Kosten ~1,1 % niedriger → Budget-Gate
   minimal spaeter scharf, Stripe-Ledger bucht minimal weniger. Von der Spec ausdruecklich als
   bewusste Entscheidung verlangt und im Code-Kommentar (`src/config.js`) begruendet;
   Groessenordnung unkritisch, aber der Lead sollte sie explizit abnicken.
2. **Sprengweite gewachsen:** bisher war `llm.usdToEur` ein Literal und gegen jede Env immun;
   jetzt bewegt eine falsch gesetzte `PROVIDER_TO_BUCKET_RATE_MICRO` auch die
   Budget-Gate-Buchhaltung. Selbst gemessen: `micro=1500000` → `usdToEur=1.5`, keine
   Fatal-Meldung. Das Toleranzband in `src/boot-guard.js` (Anker 920000, Faktor 0,5..2,0 →
   460000..1840000) laesst also 0,46..1,84 zu; am unteren Rand wuerde die KI-Kosten-Buchung
   halbiert und das Budget-Gate doppelt blind — bei bootendem Dienst. Gegengewicht: der
   Band-Guard ist fatal und unkonditional und deckt die KI-Achse damit erstmals ueberhaupt ab
   (vorher hatte sie gar keinen Guard). Netto eine Haertung, das untere Bandende ist aber jetzt
   geld-relevanter als vorher.
3. **Zwei Literale im Quelltext:** Der Default-Kurs steht als zwei Literale im Quelltext
   (`EXCHANGE_RATE_DEFAULTS.usdToEur = 0.92` und der `numEnv`-Fallback `920000`), plus die
   dritte, vorbestehende Kopie `PROVIDER_RATE_ANCHOR_MICRO = 920000` in
   `src/boot-guard.js:235`. Erzwungen durch die Regex-Form des unveraenderlichen Gate-Tests
   (`readLiteral` verlangt ein nacktes `usdToEur: <Zahl>,`, `readEnvFallback` eine nackte Zahl
   am `fallback`). Gegen Drift doppelt gepinnt (Gate-Test + neuer Verdrahtungstest), im Code
   offen begruendet — aber es bleibt Code, der von einem Quelltext-Regex geformt wurde.
4. **Doppelte Fatal-Meldung:** `numEnv` wird zweimal mit derselben Variablen aufgerufen, ein
   ungueltiger Wert landet dadurch zweimal in `fatalConfigErrors`. Selbst verifiziert mit
   `PROVIDER_TO_BUCKET_RATE_MICRO=abc` → zwei identische Eintraege, beide Achsen auf Fallback
   (0,92 / 920000). Fail-closed bleibt intakt (`assertConfig` bricht ab), die Verdopplung ist
   reine Kosmetik in der Boot-Ausgabe.
5. **Kein Phasenbericht im Branch** (`git diff --name-status` zeigt dort keine `tasks/`-Datei).
   Abnahmepunkt 4 der Spec ("Der Bericht nennt je Datei die getragene Verhaltensaenderung") war
   am Branch selbst nicht pruefbar; die geforderte Begruendung des Kurs-Defaults existiert nur
   als Code-Kommentar — dort allerdings vollstaendig. Dieser Bericht holt die fehlende
   Dokumentation nach.
6. **Auslegungsspannung zu "Zulaessige Testaenderung: keine":** die Phase legt
   `test/fx-single-source-fallback-wiring.test.js` neu an (2 Tests). Nicht als Blocker
   gewertet (Begruendung s. Abschnitt 4 oben), koennte bei strenger woertlicher Lesart aber
   anders entschieden werden.

**Verdikt (Safety, final):** FREIGABE. Vor dem Merge bewusst zur Kenntnis nehmen: der
Live-Kurs der KI-Kosten-Achse wandert mit dem Deploy von 0,93 auf 0,92, und eine kuenftige
Fehlkonfiguration der Kurs-Variablen trifft ab jetzt auch das Budget-Gate (begrenzt durch das
fatale Toleranzband 0,46..1,84). Beides ist die gewollte Folge von "ein Kurs, eine
Stellschraube" und kein Grund zu blockieren.

---

## Clean-Code-Audit (final)

**Blocker:** `false`

### S1

Keine.

### S2

Keine.

### S3

- `src/config.js:156` — Kommentar zitiert die Gate-Test-Anforderung als woertliches Muster
  `usdToEur: numEnv(`; im Quelltext steht wegen Zeilenumbruch tatsaechlich
  `usdToEur:\n    numEnv(`. Das Regex im Gate-Test matcht wegen `\s` auch ueber
  Zeilenumbrueche, funktioniert also, ist aber keine woertliche Uebereinstimmung wie im
  Kommentar behauptet. Empfehlung: Kommentar praezisieren ("per Regex, `\s` ueberbrueckt den
  Zeilenumbruch") statt "woertlich" zu sagen. Nicht blockierend, optional.

### S4

Keine.

### Verdikt Clean-Code-Auditor

**PASS.** `providerToBucketRateMicro` (Mikro-Ganzzahl, G26) bleibt die einzige Stellschraube,
`usdToEur` wird rechnerisch aus derselben Env-Variable abgeleitet (kein zweites Env-Var
`USD_TO_EUR`, kein separater Boot-Guard mehr — der Zwischenschritt `e3a8733`/`7001e89` mit
eigenem `USD_TO_EUR` + Boot-Guard `fxRateAxesDiverged` wurde im letzten Commit `7cc642b` bewusst
zurueckgebaut, weil die einfachere Struktur (G27: ein Wert, keine zwei die man synchron halten
muss) denselben Zweck ohne Laufzeit-Kreuz-Check erreicht). `boot.js`/`boot-guard.js` sind
gegenueber der Basis `695505e` byte-identisch — die Rueckbaute liess keine Reste (kein
`USD_TO_EUR`, kein `fxRateAxesDiverged`, keine verwaiste `test/fx-rate-axes-coherence.test.js`)
im finalen Diff.

Der bestehende, unveraenderbare Gate-Test `test/fx-single-source.test.js` zwingt zu einer
doppelten `numEnv(...)`-Auswertung derselben Env-Variable (einmal in
`providerToBucketRateMicro`, einmal abgeleitet in `llm.usdToEur`) — das ist auf den ersten
Blick G5-Duplizierung, aber im Kommentar (`src/config.js:150-158`) ausfuehrlich und korrekt als
vom Gate-Test erzwungene, bewusste Ausnahme begruendet (Pruefkatalog-Regel 3: "Vorrang
Lesbarkeit/bewusste begruendete Ausnahme") — eine Alternative ohne diese Duplizierung wuerde den
(laut Commit-Historie nicht aenderbaren) Gate-Test brechen.

Neuer Regressionstest `test/fx-single-source-fallback-wiring.test.js` schliesst die Luecke, die
der Quelltext-Regex-Gate-Test hat (prueft den GEBAUTEN Wert im Kindprozess, nicht den
Quelltext) — beide neuen Tests plus die 2 GAP-08-Gate-Tests liefen isoliert gruen (4/4). Volle
Suite: 3317/3318 gruen, der eine Fehlschlag (`test/a4-default-profile-zero.test.js`) ist bei
Isolation gruen — deckt sich mit dem in MEMORY dokumentierten vorbestehenden
~12%-Voll-Last-Flake (Seed-vor-Boot-Race), keine Regression durch diesen Diff. `.env.example`
und `test/helpers.js` wurden konsistent nachgezogen (Doku + Lehre test-base-env-drift). Kein
Geld-als-Float, kein toter Code, kein abgeschalteter Guard.

**Pass-Notizen:** Money bleibt Ganzzahl (`providerToBucketRateMicro`); der frueher versuchte
Boot-Guard-Umweg (eigene `USD_TO_EUR`-Variable + `fxRateAxesDiverged`) wurde selbst-kritisch
wieder entfernt zugunsten der strukturell einfacheren Loesung — genau der in P1/G27 geforderte
Reflex (Struktur statt Disziplin, aber auch: keine unnoetige Indirektion). `.env.example`-
Kommentar und `test/helpers.js`-`BASE_ENV`-Kommentar wurden korrekt nachgezogen. Der neue
Regressionstest ist ein sauberes Beispiel fuer Build-Operate-Check (P13) und deckt genau die
Luecke ab, die der (fixierte) Gate-Test hat.

**Top-TODOs:**

1. Keine blockierenden Befunde — S3-Praezisierung des Kommentars an `config.js:156` ist
   optional.
2. Bei Gelegenheit pruefen, ob der bestehende ~12%-Flake in `test/a4-default-profile-zero.test.js`
   (Seed-vor-Boot-Race, MEMORY: `suite-flake-p5-gate-proof-spawn-race`) endlich behoben werden
   soll — nicht Teil dieser Phase.

---

## Fix-Runden

Die aktenkundigen Fix-Runden dieser Phase liegen im urspruenglichen, am 2026-07-27
abgestuerzten Lauf:

- **r1 (Vorlauf zu fix2):** GAP-08-TEST-MASKED behoben — der Testcode las den USD/EUR-Kurs per
  Regex ueber den Property-Namen `usdToEur:` im Quelltext und traf dabei den ersten Treffer,
  die dekorative Kopie in `EXCHANGE_RATE_DEFAULTS`, nicht zwingend die `numEnv`-gebundene
  Konfiguration.
- **r2 (Vorlauf zu fix2):** ein Kreuz-Check-Boot-Gate (`fxRateAxesDiverged`,
  `src/boot-guard.js`) wurde eingefuehrt, um die beiden Achsen (`usdToEur`-Literal vs.
  `providerToBucketRateMicro`) laufzeitseitig auf Kohaerenz zu pruefen. Ergebnis: beide
  GAP-08-Gates gruen, Regression gruen, Clean-Code-Auditor PASS — aber das **Safety-Review
  dieses damaligen Standes (`fix2`) haelt fest: BLOCKED**, wegen Scope-Ueberschreitung
  (`src/boot.js`, `src/boot-guard.js` statt nur `src/config.js`, `.env.example`) und dem daraus
  folgenden Deploy-Risiko bei abweichender Live-Dashboard-Env (siehe fruehere Fassung dieser
  Datei in der Git-History).
- **fix3 (finaler Rueckbau, Commit `7cc642b`):** Reaktion auf den BLOCKED-Befund von fix2 — der
  Kreuz-Check-Boot-Guard wurde vollstaendig entfernt, `boot.js`/`boot-guard.js` sind wieder
  byte-identisch zur Basis. Stattdessen wird `llm.usdToEur` direkt rechnerisch aus
  `PROVIDER_TO_BUCKET_RATE_MICRO` abgeleitet — eine strukturelle Ein-Quelle-Loesung statt eines
  Laufzeit-Kreuz-Checks zwischen zwei unabhaengigen Variablen. Dieser Stand wurde in diesem
  Workflow gepruft (kein weiterer Code-Fix mehr noetig) und mit **PASS** abgenommen.

**Ergebnis:** Der finale Stand `phase/gates-p2-fx-single-source-fix3` (`7cc642b`) ist
**merge-faehig**. Beide GAP-08-Gates gruen, Regression 3297/0, Produkt-Diff sauber auf
`src/config.js` (+`.env.example`) begrenzt, Clean-Code PASS ohne Blocker, Safety-Review
FREIGABE mit dokumentierten, nicht-blockierenden Concerns (Kurs-Sprung 0.93→0.92, verbreiterte
Sprengweite der Env-Variable, doppelte Fatal-Meldung — alle zur Kenntnisnahme, keiner
blockierend).
