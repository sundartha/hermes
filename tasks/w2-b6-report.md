# Phasenreport W2-B6 — Web, Dashboard, Widget-Oberflaechen

**Gate:** PASS
**finalBranch:** `phase/w2-b6-web-dashboard-ui`
**Basis:** `master` = `98f14fd`
**headCommit (Impl):** `b75d71299b495d21b7e661e6042ba3912dd3d9ed`

> Hinweis: Der Plan und die Impl-Session sprechen vom Branchnamen `phase/w2-b6-web-dashboard-widget`;
> die Safety-Review-Session vermerkt ausdruecklich, dass der im Auftrag genannte Name
> `phase/w2-b6-web-dashboard-ui` im Repo nicht existiert. Als `finalBranch` dieses Berichts gilt
> gemaess Auftrag `phase/w2-b6-web-dashboard-ui`; der tatsaechlich verwendete Arbeitsbranch war
> `phase/w2-b6-web-dashboard-widget` (Commit `b75d712`).

---

## 1. Umfang

21 Katalog-IDs des i18n-Launch-Testkatalogs, Themenfeld Web/Dashboard/Widget-Oberflaechen:
WEB-03, WEB-07, WEB-08, WEB-10, WEB-13, WEB-18, WEB-19, WEB-25, UI-01, UI-02, UI-03, UI-04,
UI-05, UI-06, UI-07, UI-13, UI-15, UI-19, FMT-15, GAP-30, GAP-37.

Regel R-A: ausschliesslich `test/*`, der Kommentar-String `_comment_i18nCatalogPattern` in
`package.json` und der Blockreport. Kein `src/`, `public/`, `apps/web/`, `render.yaml`.

---

## 2. Plan (gekuerzt)

**Ausgangslage (gemessen an `98f14fd`):** `npm test` roh 3312/3312/0, korrigiert 3295/3295/0.
`npm run test:gates` roh 493/471/22, korrigiert 98/76/22. Dieses Zahlenpaar ist der Vorher-Anker.

**R-G-Entscheidungen vor dem Testbau** (Praemissen der Katalog-/Baseline-Dokumente widerlegt oder
veraltet, IDs trotzdem gebaut statt uebersprungen):

- **GAP-37**: Die Baseline-Dokumente (`18-w2-scope.md`, `19-w2-baseline.md`) behaupten, `buildFilter`
  existiere im Repo nicht (0 Treffer ausserhalb `node_modules`). Gemessen ist das Gegenteil:
  `render.yaml` traegt `buildFilter` an zwei Services (`vodafone-agent`, `hermes-web`), und
  `test/render-buildfilter.test.js` testet ihn bereits seit W0. → ID wird gebaut, SOLL, rot. Der
  neue Test widerspricht inhaltlich einem bestehenden gruenen W0-Test ("Gateway ignoriert
  apps/web/\*\* im buildFilter") — genau dieser Widerspruch ist der eigentliche Launch-Befund
  (PLAN-I18N-TESTS.md W27/PM-OPS-11): baut/serviert der Gateway `apps/web` weiterhin, darf er es
  nicht gleichzeitig ignorieren. Fix ist eine Folge-Phase, nicht W2-B6.
- **WEB-10**: Katalogtitel nennt `api-onboard.js`, die Belegstelle liegt tatsaechlich in
  `self-service-routes.js` (`POST /api/self-service/billing/setup-checkout`, Fehlerfeld
  `"PUBLIC_URL fehlt"` als deutscher Klartext, waehrend Nachbarcodes wie `plan_unconfigured`
  stabile Codes liefern). → ID wird gebaut, aber als SOLL (rot) gegen den P9-Fehlercode-Vertrag.
- **UI-03/UI-19**: Praemisse `navigator.language`-Fallback ist seit P13/E4 tot (0 Treffer im
  ausgelieferten Widget-HTML aller 5 Widgets x 3 Sprachen). UI-03 wird zur heute tragfaehigen
  Aussage umformuliert ("kein Betrachter-Sprachsignal im ausgelieferten Widget", gruen, neu);
  UI-19 wird als gegenstandslos verbucht (Buchhaltung, kein Test).
- **WEB-03/WEB-25/UI-01/02/05/06**: teils bereits durch Bestandstests gepinnt (Buchhaltung); je
  ein neuer Test fuer den bisher ungepinnten Rest (englische App-Shell bei WEB-03, Tabellen-
  Verankerung statt zufaelliger Weltdefault-Uebereinstimmung bei WEB-25).
- **Nebenbefund (kein Fix hier, R-A verbietet Produktionscode)**: `apps/web/test/settings.test.js`
  pinnt eine bereits abgedriftete Frontend-Feldliste als Backend-Vertrag — zementiert die
  GAP-30-Divergenz, laeuft aber nicht im Root-`npm test`. Auflage fuer die Fix-Phase.

**Neue Datei:** `test/dashboard-i18n-surface.test.js` (6 Tests: WEB-07, WEB-08, WEB-18, WEB-19,
GAP-30 x2), mit gemeinsamem Sammel-Helper `sourceFilesUnder`/`filesMatching` (G5, statt dreifacher
Kopie).

**Additive Edits an Bestandsdateien:**
- `test/mcp-ui-widget-i18n.test.js`: 5 neue Tests (UI-03/04/07/13/15) + 5 Buchhaltungs-Kommentare
  (UI-01/02/05/06/19) ueber bestehenden Tests, keine Namens-/Assertions-Aenderung an Bestand.
- `test/single-origin-serving.test.js`: WEB-03 (App-Shell-Haelfte, `<html lang="en">` in
  `apps/web/src/layouts/App.astro`).
- `test/web-auth.test.js`: WEB-13 (Session-abgelaufen-Seite darf nicht hart deutsch sein;
  `match`/`doesNotMatch` statt `assert.equal`, um den GAP-27-Waechter nicht zu triggern).
- `test/self-service-error-codes.test.js`: WEB-10; `setup()` additiv auf ein Optionsobjekt
  `{paymentEnabled, publicUrl}` erweitert (Default-Werte halten Bestandsaufrufe byte-identisch).
- `test/bk1-plan-price-format.test.js`: FMT-15 x2 (Fallback-Locale vor `/state`-Antwort folgt dem
  Weltdefault statt hart `de-DE`).
- `test/render-buildfilter.test.js`: GAP-37 (Widerspruch Build+Serve vs. ignoredPaths).
- `test/f1-geo-port.test.js`: WEB-25 (GB/IE tabellen-verankert unter beiden Flip-Schalterstellungen,
  Kontrast gegen ein tabellenfremdes Land).
- `package.json`: nur Kommentar-String erweitert (`i18nCatalogPattern` selbst unveraendert).

**Deterministisch erwartetes Ergebnis (Plan §6):** `npm test` korrigiert unveraendert 3295/3295/0;
`npm run test:gates` korrigiert 116/85/31 (Herleitung 98+18=116, 76+9=85, 22+9=31).

**Pre-Mortem (Plan §7):** Risiken benannt und entschaerft — Tests, die durch Wegfall der
geprueften Eigenschaft faelschlich gruen wuerden (WEB-25, UI-15, beide mit expliziter
Flip-Schalterstellung + `finally`-Reset); ein Defekt, der versehentlich als Sollzustand zementiert
wird (kein neuer Test pinnt deutschen Text byte-genau, WEB-13/WEB-10/WEB-08 bewusst als SOLL bzw.
`doesNotMatch`); GAP-37 spaeter entschaerft statt den Deploy-Widerspruch geloest (Test assertiert
Praemisse getrennt von Schlussfolgerung); Testbau fasst Produktionscode an (verneint, Diff nur
`test/*` + `package.json`-Kommentar + Bericht); Safety-Gates unberuehrt (keine Aenderung an
`numberGateError`, `disclosureSentence`, Signaturpruefung, Basic-Auth, Budget-Pfaden).

---

## 3. Impl-Zusammenfassung

Phase exakt gemaess Plan umgesetzt auf Branch `phase/w2-b6-web-dashboard-widget` (Basis `master`
`98f14fd`), committed als `b75d712`.

- **Neu:** `test/dashboard-i18n-surface.test.js` (6 Tests), `tasks/i18n-tests/25-w2-b6-bericht.md`.
- **Editiert:** `package.json`, `test/mcp-ui-widget-i18n.test.js`, `test/single-origin-serving.test.js`,
  `test/web-auth.test.js`, `test/self-service-error-codes.test.js`, `test/bk1-plan-price-format.test.js`,
  `test/render-buildfilter.test.js`, `test/f1-geo-port.test.js`.
- **Gemessenes Ergebnis:** `npm test` korrigiert 3295/3295/0 (roh 3313, ein zusaetzlicher
  Datei-Wrapper durch die neue Datei, von `countPhantomWrapperEntries` abgezogen). `npm run
  test:gates` korrigiert 116/85/31 (vorher 98/76/22 — Delta exakt +18/+9 rot/+9 gruen, deckt sich
  mit Plan-Herleitung). `test/characterization-marking.test.js` (GAP-27-Waechter) bleibt 9/9 gruen.
- **Smoke:** Server ueber `startServer()`-Test-Harness gebootet, `healthz` 200. Kein manueller
  `PORT=3999`-Start (Begruendung: Harness stellt bereits den vollen Safety-Gate-Env-Satz bereit).
- **Diff-Nachweis:** `git diff master..HEAD --name-only` liefert ausschliesslich `package.json`,
  `tasks/i18n-tests/25-*.md` und 8 Dateien unter `test/`. Kein `src/`, `public/`, `apps/`,
  `render.yaml`, `scripts/`. Keine neue npm-Dependency (dependencies/devDependencies byte-identisch).

**Deviations (wie im Plan als R-G vorgesehen, kein spontaner Abweich):**
1. GAP-37 entgegen der Baseline-Dokumente tatsaechlich gebaut, da `render.yaml` `buildFilter`
   nachweislich an zwei Services enthaelt.
2. WEB-10 Belegstelle ist `src/self-service-routes.js` statt des Katalogtitels `api-onboard.js`.
3. UI-03 umformuliert (`navigator.language`-Praemisse tot seit P13/E4), UI-19 als gegenstandslos
   gebucht — beides laut Plan vorgesehen, keine unautorisierte Abweichung.

---

## 4. Safety-Urteil (final)

**approved: true — FREIGABE.**

Alle Einzelurteile positiv: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`,
`authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`,
keine Blocker.

**Kernbegruendung:** reine Test-/Doku-Phase mit null Produktionswirkung. Der Diff beruehrt keine
Datei unter `src/`, `public/`, `apps/`, `scripts/` oder `render.yaml` — nur `test/*`, einen
Kommentar-String in `package.json` und den Phasenbericht. Damit sind die Regeln 1-5 (Safety-Gates,
Offenlegung, Auth fail-closed, Secrets, Audio-Pfad) strukturell unberuehrbar. Kein neuer Endpunkt,
keine neue Env-Variable, keine neue Dependency.

**Eigene Verifikation der Safety-Review:** Branch `review-w2-b6` = `phase/w2-b6-web-dashboard-widget`
(`b75d712`); `git merge-base master HEAD == master` bestaetigt (keine Stale Base). Regression `npm
test` roh 3313/3313/0, korrigiert 3295/3295/0 — deckt sich exakt mit dem Vor-Phasen-Anker. Gates
korrigiert 116/85/31 (Lauf 2+3 stabil, Lauf 1 hatte 32 = bekannter Voll-Last-Flake `p5-gate-proof`).
Eigene Baseline-Erhebung an `98f14fd` (gleicher Worktree/Umgebung): Gates korrigiert 98/76/22 —
Delta zum Branch exakt +18/+9/+9, und die 9 neuen roten sind namentlich genau die deklarierten
SOLL-rot-Tests (FMT-15 x2, GAP-30, GAP-37, WEB-07, WEB-08, WEB-10, WEB-13, WEB-19). Kein vorher
gruener Gate-Test kippt. Zweiter Backend-Modus (`STORE_BACKEND=pg`) auf Branch und Baseline
byte-gleich (2965 korrigiert / 2917 pass / 48 fail beide) — Branch-Delta auf dieser Achse null (der
Modus ist strukturell nicht fuer Spawn-Tests unterstuetzt, `BASE_ENV` pinnt `json`). Secret-/
Rufnummern-Grep ueber gesamten Diff: 0 Treffer. WEB-10-Geldrisiko explizit geprueft: Handler bricht
vor jedem Stripe-Aufruf mit 500 ab (leeres Billing-Stub), kein Netz, kein Hold.

**Concerns (keine Blocker, aber Auflagen fuer die Fix-Phase):**
1. GAP-37 kollidiert frontal mit dem W0-Deploy-Isolations-Guard (`test/render-buildfilter.test.js`,
   Test "Gateway ignoriert apps/web/\*\* im buildFilter") — dieser Guard ist eine SICHERUNG, kein
   Kosmetiktest: er verhindert, dass ein reiner Frontend-Commit das live telefonierende Gateway
   redeployt. **Bindende Auflage:** nur die Richtung "Gateway baut/serviert apps/web nicht mehr"
   ist als Fix zulaessig; `ignoredPaths` darf NICHT gekuerzt werden.
2. Neue Kopplung Root-Suite → `apps/web`: `test/dashboard-i18n-surface.test.js` importiert
   `SETTINGS_FREE_FIELDS`/`SETTINGS_RESTRICT_ONLY_FIELDS` aus `apps/web/src/lib/api.js`. Ein
   kuenftiger Umbau/Umzug dieser Datei reisst damit den gruenen `npm test`-Lauf mit, nicht nur
   `test:gates`. Heute unkritisch, aber neue Bruchstelle.
3. WEB-19 fordert per SOLL, dass `privateNumber` in einem Dashboard angezeigt wird; das Feld ist
   PII und wird von `/api/self-service/state` nur maskiert geliefert (P9). Der Test unterscheidet
   das nicht. **Bindende Auflage:** der Fix darf nur den maskierten Wert rendern, sonst wird aus
   einem UI-Befund ein PII-Leak.
4. WEB-08 (`new Function()`-Extraktion aus `tenant.html`) und WEB-18 (nackte Zahl
   `allCallSites.length === 3`) sind fragil gegen harmloses Reformatting — test-only, ohne
   Produktionswirkung.
5. GAP-37 formal eine Erweiterung gegenueber dem freigegebenen Phasenumfang (Baseline sagte "nicht
   bauen"), sachlich richtig und sauber als R-G dokumentiert.
6. Umgebungs-Limitierung: `npx eslint` laeuft im Worktree nicht (`ERR_MODULE_NOT_FOUND
   '@eslint/js'` ueber node_modules-Symlink) — nicht dem Branch anzulasten, Lint nicht gefahren.
7. Suite-Flake: erster `test:gates`-Lauf 32 rot, Laeufe 2/3 stabil 31 — deckt sich mit dem bekannten
   ~12%-Voll-Last-Flake; keiner der neuen Tests betroffen.

---

## 5. Clean-Code-Audit (final)

**Blocker: false. Verdikt: FREIGABE.**

- **s1 (Blocker):** keine.
- **s2 (schwerwiegend):** keine.
- **s3 (minor):** eine Fundstelle —
  *P6 (Nebeneffekte-Namensklarheit)* in `test/f1-geo-port.test.js:112-131` (WEB-25):
  `setWorldDefaultLanguageEnabled(true)` wird sowohl mitten im Testkoerper als auch nochmal im
  `finally`-Block aufgerufen — redundant, kein Bug (das `finally` greift ohnehin bei
  Assertion-Fehler), aber der Leser muss kurz pruefen, ob der zweite Aufruf einen Zweck hat.
  Fix-Vorschlag: mittleren Reset weglassen oder per Kommentar klarstellen, dass er bewusst den
  Kontrastteil des Tests einleitet.
- **s4:** keine.

**Begruendung:** Diff ist ausschliesslich Test-/Katalogarbeit. Alle 9 als "SOLL, rot" deklarierten
Tests schlagen tatsaechlich fehl (per Einzellauf verifiziert), alle als "Mechanismus/gruen"
deklarierten sind tatsaechlich gruen — Polaritaets-Tabelle im Bericht deckt sich mit der gemessenen
Realitaet. Alle 18 neuen Testnamen tragen ihr Katalog-ID-Praefix korrekt (Routing ueber
`config.i18nCatalogPattern`), wandern also automatisch in `test:gates`. Voller `npm test`-Lauf
bestaetigt gruen (3295/3295). Keine Safety-Gates, kein Auth, keine Secrets, kein Audio-Pfad
beruehrt. Keine Duplizierung (Sammel-Helper `sourceFilesUnder`/`filesMatching` bewusst extrahiert,
nicht kopiert). Kein toter/auskommentierter Code, keine unbegruendeten Magic Numbers, keine
abgeschalteten Sicherungen. `setup()`-Signaturaenderung in `self-service-error-codes.test.js`
abwaertskompatibel (Default-Parameter).

**Top-TODOs (nicht blockierend):**
1. Optional redundanten Zwischen-Reset in WEB-25 (`test/f1-geo-port.test.js`) aufraeumen oder
   kommentieren.
2. Die 9 SOLL-rot-Tests bleiben offene Produktbefunde (WEB-07/08/19, WEB-10, WEB-13, FMT-15 x2,
   GAP-30, GAP-37) — gehoeren in die Fix-Phase, nicht in diesen Review.
3. Vor Merge sicherstellen, dass `test:gates` den Lauf so partitioniert wie erwartet (Stichprobe
   bereits gemacht, volle Gate-Suite nicht separat verifiziert).

---

## 6. Fix-Runden

Keine. Der Impl-Durchlauf traf im dualen Review (Safety + Clean-Code) direkt auf FREIGABE ohne
Blocker (`s1`/`s2` leer, `blockers: []`); es waren keine Selbst-Fix-Iterationen noetig. Alle
Concerns/S3-Funde wurden als Auflagen fuer eine spaetere Fix-Phase dokumentiert, nicht in dieser
Phase behoben (R-A verbietet Produktionscode-Aenderungen in diesem Umfang; die einzige S3-Fundstelle
ist rein test-intern und wurde als optionales TODO belassen).

---

## 7. Offene Auflagen fuer Folge-Phasen

1. GAP-37-Widerspruch aufloesen — NUR durch "Gateway baut/serviert `apps/web` nicht mehr", niemals
   durch Kuerzen von `ignoredPaths` (das wuerde den W0-Deploy-Isolations-Guard zerstoeren).
2. WEB-19-Fix darf `privateNumber` ausschliesslich maskiert rendern (PII-Schutz gemaess P9).
3. `apps/web/test/settings.test.js` zementiert aktuell die GAP-30-Divergenz als "Backend-Vertrag" —
   bei der GAP-30-Fix-Phase mitziehen.
4. Nach dem FMT-15-Fix muss der bestehende gruene Ist-Pin `"4,99 €"` in
   `test/bk1-plan-price-format.test.js` angepasst werden.
5. `/api/self-service/state` liefert `privateNumber`, das aktuell kein Frontend konsumiert (Luecke,
   die WEB-19 beschreibt).
6. Optional: redundanten Zwischen-Reset in `test/f1-geo-port.test.js` (WEB-25) bereinigen oder
   kommentieren.
