# Phasenbericht W2-B5 — Provisioning und DID-Lebenszyklus

- **Gate:** PASS
- **finalBranch:** `phase/w2-b5-provisioning-did`
- **headCommit:** `b4acada`
- **Basis:** `master` = `d872725` (Arbeitsbaum sauber, nur `.claude/workflows/w2-b5-run.js` untracked)
- **Umfang:** 9 Katalog-IDs des i18n-Launch-Testkatalogs (DID-05, DID-08, DID-09, DID-11, DID-17, DID-19, GAP-19, GAP-23, GAP-34)
- **Regel R-A:** kein Produktionscode — Diff ausschliesslich `test/*`, ein Kommentar-String in `package.json`, Bericht, Per-Run-Wrapper

---

## 1. Plan (gekuerzt)

Bindend gelesen: `tasks/i18n-tests/18-w2-scope.md` §3 (R-A…R-G) + §W2-B5, `19-w2-baseline.md` §2.5/§3.7/§3.8, `06-nummern-provisioning.md` (DID-05/08/09/11/17/19), `11-luecken-und-e2e.md` (GAP-19/23/34), `PLAN-I18N-TESTS.md` §5 + Entscheidung E2, `.claude/refs/clean-code.md`.

### Gemessene Polaritaet (an echtem Code erhoben, nicht aus dem Katalog uebernommen)

| ID | Katalog-Erwartung 07-22 | gemessen heute | Beleg |
|---|---|---|---|
| DID-05 | rot | **rot** — `CA/IE/AU/CH/AT/ES/IT` -> alle `countryCode="DE"` | `searchParamsForCountry` |
| DID-08 | gruen | **gruen** — Body `{phone_numbers, connection_id}`, 422 wirft ohne `providerStatus` | `orderNumber`, `assertTelnyxOk` |
| DID-09 | rot | **rot** — `searchParamsForCountry("US").type === undefined`; Tabellenluecke, keine Adapterluecke | `COUNTRY_SEARCH_PARAMS`, `searchNumbers` |
| DID-11 | gruen | **gruen** — `US/FR/GB/DE` -> alle `500` (reiner Aufrufer-Default) | `holdAmountForCountry` |
| DID-17 | gruen | **gruen** — `{released:0,aborted:0,observed:1}` + `requestNumber` -> `global_cap` | `runReleaseReconcile`, `requestNumber` |
| DID-19 | gruen | **gruen** — Key ist `order_${numberId}`, keine Land-Dimension | `src/onboarding.js` |
| GAP-19 | rot | **rot (2 Achsen)** — Boot mit `FORCE_NUMBER_COUNTRY=US` bei `PROVISIONING_COUNTRY=DE` laeuft durch, ohne Boot-Log-Hinweis; volle Gate-Kette mit US-DID -> DE-Ziel liefert `denial === null` | Boot-Probe, `makeOutboundGates` |
| GAP-23 | rot | **rot (2 Achsen)** — Nachschub `requestNumber` -> `{ok:true}` trotz 100% no-answer; `activateNumber` -> `active` ohne jeden Registrierungsschritt | `state-ops` |
| GAP-34 | rot | **rot** — nach `migrate()` bleibt `US`-Zeile auf `language="de"` (Soll `languageForCountry("US")`) | `src/db/migrate.js` (pglite-Probe) |

Nebenbefund: `normalize_target` haelt bereits BEIDE Fakten in der Hand (aktive DID via `findActiveNumber` + Herkunftsland via `store.tenantGeo`) und nutzt sie nur zur Normalisierung — GAP-19 ist damit keine Datenluecke, sondern eine fehlende Auswertung.

### Neue Datei

`test/did-reputation-metric.test.js` (GAP-23, rein offline, kein Netz/Spawn/pglite): zwei SOLL-Tests — (a) eine no-answer-Quote je Absender-DID existiert und stoppt den Nachschub, (b) eine Nummer erreicht `active` nicht ohne abgeschlossenen Registrierungsschritt.

### Edits an Bestandsdateien

- **`test/f1-provisioning-geo.test.js`**: Fixture-Helfer `requestFor` entkoppelt (Basis fuer `seedRequested` UND DID-19-Zwei-Laender-Fixture); `enqueueProvision` liest `tenantId` aus dem Number-Record statt Datei-Konstante; DID-05-Test (`LAENDER_OHNE_EINTRAG`); DID-09-Test (rot, Tabelle) auf `ACTIVE_PURCHASE_COUNTRIES`; DID-11 als Buchhaltungs-Kommentar; DID-19-Mechanismus-Test (zwei Laender im selben Drain, getrennte number-id-gebundene Idempotency-Keys).
- **`test/telnyx-numbers.test.js`**: DID-08-Buchhaltungskommentar + neuer 422-Regulatory-Block (`providerStatus === undefined`, `providerCode === "10009"`); DID-09-Mechanismus-Test (Adapter reicht `type` korrekt durch, wenn vorhanden).
- **`test/tenant-prolif-d-reconcile.test.js`**: DID-17-Mechanismus-Test — Observe-Only-Grace haelt DID belegt und blockiert neuen Signup via globalen Cap.
- **`test/outbound-gates-order.test.js`**: `defaultStore()` um `tenantGeo` ergaenzt (reale Kontraktflaeche); GAP-19(b)-Test — Anruf unter fremdlaendischer Absender-DID passiert Gate-Kette lautlos.
- **`test/boot-prod-footguns.test.js`**: GAP-19(a)-Test — Kauf-Land != Herkunftsland wird beim Start nicht ausgewiesen (try/catch/finally traegt beide Soll-Varianten: Abbruch oder Durchlauf).
- **`test/f1-geo-store.test.js`**: zwei GAP-34-Bloecke — (a) Migration zieht `number.language` auf das Land nach, idempotent, ohne Kollateralschaden; (b) fehlendes Land wird aus der DID-Vorwahl abgeleitet, ohne Vorwahl bleibt es leer (E2: kein Raten).
- **`package.json`**: `_comment_i18nCatalogPattern` um `DID-11` als reine Buchhaltungs-Referenz ergaenzt; wirksames `i18nCatalogPattern`-Regex unveraendert.
- **Neu**: `tasks/i18n-tests/24-w2-b5-bericht.md`, `.claude/workflows/w2-b5-run.js` (vorher untracked, mitcommittet).

### Erwartetes Ergebnis (Lauf-Zahlen, vorher an `d872725` gemessen)

| Datei | vorher | erwartet nachher |
|---|---|---|
| `f1-provisioning-geo.test.js` | 18/17/1 | 21/18/3 |
| `telnyx-numbers.test.js` | 12/12/0 | 14/14/0 |
| `tenant-prolif-d-reconcile.test.js` | 7/7/0 | 8/8/0 |
| `outbound-gates-order.test.js` | 25/24/1 | 26/24/2 |
| `boot-prod-footguns.test.js` | 6/6/0 | 7/6/1 |
| `f1-geo-store.test.js` | 28/27/1 | 30/27/3 |
| `did-reputation-metric.test.js` | — (neu) | 2/0/2 |
| `characterization-marking.test.js` | 9/9/0 | 9/9/0 (unveraendert) |
| `npm test` | — | unveraendert gruen |
| `npm run test:gates` | — | +12 Tests, +8 rot |

12 `test()`-Bloecke ueber 8 tatsaechlich getesteten IDs (8 rot = Arbeitsergebnis, 4 gruen = Mechanismus/Charakterisierung), DID-11 als reine Buchhaltung.

---

## 2. Impl-Zusammenfassung

W2-B5 wurde umgesetzt und auf `phase/w2-b5-provisioning-did` (`b4acada`) committet. 12 neue Tests ueber 8 Katalog-IDs (8 rot, 4 gruen), 1 ID (DID-11) als reine Buchhaltung, 1 neue Testdatei (`test/did-reputation-metric.test.js`).

R-A eingehalten: `git diff master --stat -- src public apps scripts render.yaml` liefert leere Ausgabe. Einziger Nicht-Test-Edit ist der Kommentar-String `config._comment_i18nCatalogPattern` in `package.json`.

**Gemessene Polaritaet je ID (final):** DID-05 rot, DID-08 gruen (Buchhaltung + eigener 422-Test), DID-09 rot in der Tabelle / gruen im Adapter, DID-11 Buchhaltung, DID-17 gruen, DID-19 gruen, GAP-19 rot x2, GAP-23 rot x2, GAP-34 rot x2.

**Lauf-Zahlen (final, gemessen):**
- `f1-provisioning-geo` 18/17/1 -> 21/18/3
- `telnyx-numbers` 12/12/0 -> 14/14/0
- `tenant-prolif-d-reconcile` 7/7/0 -> 8/8/0
- `outbound-gates-order` 25/24/1 -> 26/24/2
- `boot-prod-footguns` 6/6/0 -> 7/6/1
- `f1-geo-store` 28/27/1 -> 30/27/3
- `did-reputation-metric` neu 2/0/2
- `characterization-marking` (GAP-27-Waechter) 9/9/0 unveraendert
- `npm test` (korrigiert): 3295/3295/0 vorher UND nachher — unveraendert gruen
- `npm run test:gates` (korrigiert): 86/72/14 -> 98/76/22, also +12 Tests / +8 rot, wie geplant
- Ungefiltert `node --test --test-reporter=tap "test/*.test.js"`: 3393/3371/22 = 3295 + 98 — Split-Invariante haelt

R-F erfuellt: kein Bestandstest gekippt, Fail-Set enthaelt nur die 14 Baseline-Roten plus die 8 neuen. `p5-gate-proof` blieb in allen Laeufen gruen.

### Deviations

1. **GAP-34 Block (a), dritte Fixture-Zeile (FR):** der Plan sah zwei Zeilen vor (AT als Gegenprobe, US als Live-Fall). Gemessen ist der Block FALSCH-GRUEN, wenn `DEFAULT_LANGUAGE` auf `de` steht — US hat keinen Eintrag in `LANGUAGE_FOR_COUNTRY` und faellt auf den Weltdefault, der im In-Process-Test (kein BASE_ENV, kein Spawn) aus der lokalen `.env` kommt und dort zufaellig `de` war. Behoben durch eine dritte Zeile `num_fr` (`languageForCountry('FR')` ist ein Tabellen-Eintrag, also flip-unabhaengig). Der Block ist jetzt unter BEIDEN Weltdefaults rot.
2. **Struktur-Move (verhaltens-erhaltend):** `ACTIVE_PURCHASE_COUNTRIES` von `test/f1-provisioning-geo.test.js` vom Hold-Abschnitt in den Konstantenblock am Dateikopf verschoben, weil DID-09 einen zweiten Konsumenten weiter oben einfuehrt. Reiner Move, kein Wertwechsel, keine Assertion beruehrt.
3. **Per-Run-Wrapper `.claude/workflows/w2-b5-run.js`** existierte im isolierten Worktree nicht (lag untracked im Haupt-Arbeitsverzeichnis), wurde unveraendert hereinkopiert und mitcommittet. `node --check` schlaegt bei ihm fehl (`Illegal return statement`) — etablierte Form dieser Workflow-Skripte, `.claude/workflows/w2-b4-run.js` verhaelt sich identisch. Kein Defekt.
4. Die Vorgehens-Anweisung `ln -s "./node_modules" node_modules` erzeugt einen Selbstverweis; Link stattdessen auf den Hauptcheckout-`node_modules` gesetzt, gitignored, nicht committet.
5. `npm run test:gates` ist nach dieser Phase mit 22 Fehlschlaegen rot — das ist das Arbeitsergebnis der Welle (14 Baseline nach W2-B4, 8 neu). `npm test` bleibt bei 3295/0 gruen.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Kern-Gates intakt (`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`; `testsPassIndependently: true`). **Blockers: keine.**

Unabhaengig gemessen im frischen Worktree (kein `.env`, node v26.4.0):
- `npm test`: 3295/3295/0 gruen
- `npm run test:gates`: 98/76/22 (2x gelaufen, identisch, kein Flake)
- Ungefiltert: 3393/3371/22 = 3295 + 98, Split-Invariante haelt
- Master-Baseline (`d872725`) selbst gemessen: `test:gates` 86/72/14 -> Delta exakt +12/+8, kein gekippter Bestandstest
- Fail-Set (22) woertlich verifiziert: 14 Bestand + 8 neu, alle 12 neuen tragen die Katalog-ID am Namensanfang
- Jeder rote neue Test scheitert am richtigen Grund (Assertion einzeln gelesen)
- Pre-Mortem-Fix gegengeprueft: GAP-34 bleibt unter beiden Weltdefaults rot

**Concerns (nicht blockierend):**
1. R-A-Wortlaut technisch ueberschritten (3 Nicht-Test-Dateien), aber praezedenzgedeckt (B1-B4 schrieben denselben Kommentar-String fort), wirksames Regex unveraendert.
2. Geteilte Fixture `tenantGeo` in `outbound-gates-order.test.js` beruehrt alle Tests der Datei, aber nachweislich folgenlos (kein Bestandstest fuehrt das Gate aus, Pass-Zahl unveraendert).
3. Schwaches Orakel in GAP-19(b): nur `assert.ok(denial)` — Hinweis fuer die spaetere Fix-Phase, den Ablehnungsgrund zusaetzlich zu pinnen.
4. Bericht-Begruendung zu Abweichung 1 ist umgebungsspezifisch (materiell folgenlos): in sauberem Worktree ohne `.env` loest der Weltdefault auf `en`, nicht `de` — Schlussfolgerung bleibt korrekt (GAP-34 ist so oder so rot).
5. `npm run lint`/`format:check` in dieser Umgebung nicht lauffaehig (vorbestehende Umgebungsluecke), Ersatz: `node --check` auf allen 7 Dateien gruen, Diff-Scan auf `eslint-disable`/`.only`/`test.skip`/TODO -> 0 Treffer.

**Verdict:** FREIGABE. Reiner Testbau-Block ohne Produktionswirkung; alle vier harten Vertraege (R-A bis R-G) nachgemessen statt uebernommen.

---

## 4. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2 (schwer):** keine
- **s3 (mittel, nicht blockierend):**
  1. `.claude/workflows/w2-b5-run.js` — Kommentar/Description nennen "9 Katalogtests", gemessen wurden 12 Tests ueber 8 tatsaechlich getestete IDs. Empfehlung: Zahl bei Gelegenheit nachziehen oder als Vorab-Schaetzung kennzeichnen.
  2. `test/did-reputation-metric.test.js` — GAP-23 zweiter Test faengt jeden Fehler aus `activateNumber()` mit leerem `catch{}` ab, ohne Fehlertyp zu pruefen; falls der spaetere Fix aus anderem Grund wirft, waere das faelschlich ein Testerfolg. Empfehlung: `catch` beim Bau des Fixes praezisieren (benannter Fehlercode/Message-Regex).
- **s4 (gering):** keine
- **blocker:** false

**Verdict:** FREIGABE. Reine Testerweiterung (test/*, ein Kommentar-String in `package.json`, neuer Workflow-Wrapper, Phasenbericht) — kein Produktionscode geaendert. Alle 8 "SOLL, rot"-Tests isoliert nachgefahren und tatsaechlich rot; alle 4 gruenen Mechanismus-/Charakterisierungstests tatsaechlich gruen. Bereits vorhandene, aus dem Scope unberuehrte rote Katalogtests sind Altlast. F.I.R.S.T. eingehalten, keine neue Duplizierung (`requestFor`/`ACTIVE_PURCHASE_COUNTRIES`-Konsolidierung ist sogar eine G5-Verbesserung). Magic Numbers benannt, Kommentare decken sich mit dem tatsaechlichen Testverhalten.

**Top-TODOs (nicht blockierend):**
1. Rote Katalogtests bleiben bewusst im Gates-Lauf stehen, bis die zugehoerige Produktivloesung kommt.
2. Workflow-Kommentar (9 vs. 12 Tests) bei Gelegenheit nachziehen.
3. GAP-23-`catch` praezisieren, sobald der echte Fail-Closed-Mechanismus gebaut wird.

---

## 5. Fix-Runden

Keine. Der Impl-Durchlauf bestand beide Reviews (Safety + Clean-Code) direkt mit `blocker: false` bzw. `approved: true` — keine Nacharbeit noetig.
