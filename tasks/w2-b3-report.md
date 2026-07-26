# Phase W2-B3 — Wahlziel-Normalisierung und Gate-Kette

**Gate: PASS**
**finalBranch: `phase/w2-b3-wahl-gates`**
**headCommit: `b09ef4294699931993bfc9fef2f8db9c5ca6f50c`**
**Basis: `master` = `b1bd854`**

Scope: 14 IDs aus `tasks/i18n-tests/18-w2-scope.md` §W2-B3, Baseline `tasks/i18n-tests/19-w2-baseline.md` §2.3/§3. Regel: **nur Tests, null Zeilen Produktionscode (R-A)**.

---

## 1. Plan (gekuerzt)

### Gemessene Ausgangslage
- `npm run test:gates` korrigiert: 57 / 50 pass / 7 fail
- Fail-Set: `LANG-19`, `GAP-05`, `GAP-15` (x2), `LANG-15`, `VOICE-12`, `GAP-24`
- `npm test`: 3295 / 0 (unveraendert seit W2-B1)
- `grep -c 'name: "' src/telephony/outbound-gates.js` = **17**, Modul-Kommentar sagt **"16 Glieder"** → OUT-14 bestaetigt

### Polaritaets-/Zuordnungstabelle (14 IDs)

| ID | Art | Polaritaet | Zieldatei | neuer Test? |
|---|---|---|---|---|
| OUT-03 | Mechanismus | gruen | outbound-gates-order.test.js | ja |
| OUT-12 | Charakterisierung | gruen | cost-origin-axis.test.js | ja |
| OUT-14 | SOLL | **rot** | outbound-gates-order.test.js | ja |
| OUT-15 | Mechanismus | gruen | number-gate.test.js | ja (Spawn) |
| OUT-16 | Mechanismus | gruen | e164-trunk-zero-reject.test.js | ja |
| OUT-17 | Mechanismus | gruen | dial-target-normalization.test.js | ja |
| OUT-18 | Buchhaltung | — | dial-target-normalization.test.js | nein |
| OUT-22 | Mechanismus | gruen | outbound-gates-order.test.js | ja |
| OUT-23 | Mechanismus | gruen | config-shape.test.js | ja |
| OUT-27 | Mechanismus | gruen | telnyx-p5-origination.test.js | ja |
| OUT-28 | Mechanismus | gruen | outbound-gates-order.test.js | ja |
| FMT-20 | Mechanismus | gruen | e164-trunk-zero-reject.test.js | ja |
| FMT-21 | Mechanismus | gruen | e164-trunk-zero-reject.test.js | ja |
| FMT-22 | Buchhaltung | — | dial-target-normalization.test.js | nein |

12 neue Tests (11 gruen, 1 rot), 2 Buchhaltungen. Keine neue Testdatei (bestehende Fixtures `makeDeps`/`baseCtx`/`gateBy` sind nicht exportiert; eine zweite Datei muesste sie kopieren, G5/S2).

### Reihenfolge der Umsetzung
1. Regel 0 (R-E): Branch von `master` (`b1bd854`) abzweigen, Basis verifizieren
2. Reine Helfer-Tests zuerst (e164-trunk-zero-reject, dial-target-normalization, cost-origin-axis, config-shape)
3. Mock-Gate-Tests (outbound-gates-order) inkl. OUT-14 — Rot-Ursache vor Weiterbau verifizieren ("16 != 17")
4. Spawn-Test (number-gate) und DI-Test (telnyx-p5-origination)
5. Buchhaltungs-Kommentare + `package.json`
6. Bericht

### Was NICHT gebaut wird
- Kein Produktionscode — Modul-Kommentar "16 Glieder" bleibt bewusst falsch (das ist der SOLL-Testfund, nicht der Fix)
- Keine neue Env-Variable, keine neue Dependency
- Keine Beruehrung von `src/`, `public/`, `apps/`, `scripts/`, `render.yaml`, `.env.example`

### Deterministisch pruefbares Ergebnis (Auszug)
Erwartete Testzahlen je Datei (outbound-gates-order 25/24/1 mit genau `OUT-14` als `not ok`, e164-trunk-zero-reject 12/12/0, dial-target-normalization 33/33/0, number-gate 45/45/0, cost-origin-axis 11/11/0, telnyx-p5-origination 5/5/0, config-shape 17/17/0), `npm test` unveraendert 3295/3295/0, `test:gates` 69/61/8 (Baseline-Fail-Set + `OUT-14`), ungefiltert 3364 = 3295 + 69, `git diff master --stat` nur `test/*.test.js` + `package.json` + Bericht.

---

## 2. Impl-Zusammenfassung

12 neue Tests (11 gruen, 1 rot) + 2 Buchhaltungs-Referenzen ueber 7 Bestandsdateien, keine neue Datei, null Zeilen Produktionscode.

**Gruen:**
- OUT-03 — Tenant-Profil ist Schnittmenge mit globalem Laender-Gate, kann nur senken, nie erweitern (inkl. Gegenrichtung mit `["+1"]`/`["*"]`)
- OUT-22 — leer/undefined/null-Profil wirken identisch UND oeffnen die globale Achse nicht
- OUT-28 — Praezedenz Land > Stundenlimit > Ziel-Cap an einem gueltigen US-Ziel
- OUT-15 — Notruf-Denylist gewinnt bei explizit erlaubtem +1 (Spawn-Test)
- OUT-16 — `isTrunkZeroFormatError` nie einschlaegig fuer NANP
- OUT-17 — `normNum` bereinigt US-Trennzeichen-Schreibweisen
- OUT-12 — Toll-Free-Ziele bekommen keinen Sonderrabatt (Worst-Case-Tarif)
- OUT-23 — Laendercode-Praefixe sind casing-frei per Konstruktion
- OUT-27 — Assistant-Originationspfad reicht `to` unveraendert durch (Spy-Verhalten)
- FMT-20 — E164 akzeptiert NANP-Nummern
- FMT-21 — TRUNK_ZERO_COUNTRY_CODES betrifft +1 nicht

**Rot (Arbeitsergebnis):**
- OUT-14 — Modul-Kommentar `src/telephony/outbound-gates.js` sagt "16 Glieder", gebaute Kette hat 17. Bewusst als SOLL-Test formuliert (nicht als gruener Ist-Pin der falschen Zahl), Rot-Ursache vorab isoliert verifiziert.

**Gemessene Ergebnisse:** outbound-gates-order 25/24/1, e164-trunk-zero-reject 12/12/0, dial-target-normalization 33/33/0, number-gate 45/45/0, cost-origin-axis 11/11/0, telnyx-p5-origination 5/5/0, config-shape 17/17/0, characterization-marking (GAP-27-Waechter) 9/9/0. `npm test` 3295/3295/0 unveraendert. `test:gates` 69/61/8, Fail-Set exakt Baseline + OUT-14. Ungefiltert 3364 = 3295 + 69 (Split verliert/dupliziert nichts).

### Deviations
1. Branchname: Anweisung nannte `phase/w2-b3-wahl-gates`, Plan `phase/w2-b3-wahlziel-gates` — verwendet wurde der Name aus der Anweisung.
2. Regel 0 (Stale Base): Worktree stand beim Start auf `566ccd6` (KE-P9), nicht auf `master`. Branch explizit mit `git checkout -b phase/w2-b3-wahl-gates master` auf `b1bd854` gelegt, Basis-Commit verifiziert.
3. `node_modules`-Symlink im Worktree ersetzt (Selbstverweis/ELOOP vermieden), nicht committet.
4. Plan-Abweichungen (als R-G angekuendigt): OUT-14 als SOLL/rot statt gruenem Ist-Pin; OUT-16 auf Praedikat-Ebene statt HTTP-Vergleich (beide 400-Pfade nach aussen ununterscheidbar); OUT-18-Praemisse durch OUT-25 widerlegt → Buchhaltung; FMT-22-Titel ueberholt → Buchhaltung; OUT-23 an Praefix-Struktur statt `languageForCountry`-Casing; OUT-12 ohne roten SOLL-Zwilling (fail-safe-teuer ist entschiedene Haltung, PAY-22).
5. Kein separates pglite-Store-Backend im Repo — `npm test` deckt beide Backends bereits ab (BASE_ENV pinnt `STORE_BACKEND=json`, pglite-Pfade laufen in-process in ~20 Bestandsdateien).

---

## 3. Safety-Urteil (final)

**approved: true** — keine Blocker.

- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`, `scopeRespected`: alle **true**
- `testsPassIndependently: true` — eigener Lauf im frischen Worktree bestaetigt: `npm test` 3310/3310/0 auf Branch identisch zu Master; `test:gates` Branch 8 fail (Baseline 7 + `OUT-14`), kein Bestandstest gekippt (R-F)
- Split-Invariante gegengeprueft: ungefiltert 3364 = 3295 + 69, exakt
- Beide Store-Backends verifiziert (pglite-Paritaetstests laufen tatsaechlich, nicht geskippt)

**Verdikt:** FREIGABE. Reine Test-Phase ohne Produktionscode-Aenderung (`git diff master -- src/ public/ scripts/ render.yaml .env.example` = 0 Zeilen). Safety-Gates unberuehrt und durch die neuen Tests netto gestaerkt (OUT-03/OUT-22/OUT-28/OUT-15 pinnen sicherheitsrelevante Invarianten zusaetzlich ab). Offenlegungssatz unberuehrt, keine Auth-/Endpunkt-Aenderung, keine Secrets im Diff.

**Concerns (kein Blocker, Hinweise an den Lead):**
1. Vollast-Flake im ungefilterten Lauf: 3364/3355/9 statt erwarteter 8 — Zusatzfehlschlag `assistant-context-http.test.js` (nicht W2-B3, isoliert gruen, dokumentierte Spawn-Race-Flake-Klasse)
2. OUT-14 ist ein Quelltext-Scraping-Test (Regex auf Kommentartext) — sproede gegenueber blosser Umformulierung, aber Repo-Praezedenz vorhanden
3. OUT-14 laesst den realen (harmlosen) Produktionscode-Defekt bewusst offen (Kommentar "16" vs. tatsaechlich 17 Glieder)
4. Import-Idiom uneinheitlich (`fs`/`path`/`url` statt `node:`-Praefix) — rein kosmetisch
5. `originationConfig()`-Dedup in telnyx-p5-origination.test.js ist ein kleiner, verhaltens-erhaltender Refactor knapp jenseits der 14 IDs — G5-begruendet, Werte byte-identisch geprueft

---

## 4. Clean-Code-Audit

**blocker: false**

- **s1 (Blocker-Klasse):** keine Funde
- **s2 (Blocker-Klasse):** keine Funde
- **s3:** `test/outbound-gates-order.test.js` (OUT-28, OUT-03) — beide Tests buendeln mehrere Szenarien in einer Testfunktion statt separater Tests je Konzept. Rein stilistisch, Kommentare begruenden die Buendelung nachvollziehbar; kein Blocker.
- **s4:** `test/outbound-gates-order.test.js` (OUT-28) — 3 Build-Operate-Check-Bloecke hintereinander statt 3 Testfunktionen; falls spaeter isoliert einer der drei Faelle fehlschlaegt, ist die Ursache aus dem Testnamen nicht sofort ablesbar. Optional in 3 benannte Tests aufteilen.

**Verdikt:** FREIGABE. Reine Test-Erweiterung, kein Produktionscode geaendert (verifiziert per eigenem Checkout). `npm test` 3295/3295 gruen, `test:gates` 8 rot (7 vorbestehend + `OUT-14` neu, exakt wie dokumentiert und beabsichtigt). Keine S1/S2-Funde: keine Sicherheits-/Geld-/Race-Verstoesse, kein toter/auskommentierter Code, keine schaedliche Duplizierung (im Gegenteil: `profileWithCountryCodes()`/`originationConfig()`-Helper reduzieren Duplikation, G5-konform). Grenzfaelle sauber getestet (G3/T5). Einzige Funde sind stilistische S3/S4-Anmerkungen zur Testgranularitaet.

**Offene TODOs (kein Blocker):**
1. Optional: OUT-28/OUT-03 bei Gelegenheit in benannte Einzeltests aufspalten
2. Owner-Handarbeit ausserhalb dieses Test-Diffs: Kommentar in `outbound-gates.js` auf "17 Glieder" korrigieren (der reale, harmlose Produktbefund, den OUT-14 aufdeckt)

---

## 5. Fix-Runden

**Keine.** Beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf auf FREIGABE ohne Blocker — keine Fix-Runde noetig.

---

## 6. Ergebnis

| # | Kennzahl | Wert |
|---|---|---|
| Neue/geaenderte Tests | 12 (11 gruen, 1 rot) + 2 Buchhaltungen |
| Beruehrte Testdateien | 7 (`outbound-gates-order`, `number-gate`, `dial-target-normalization`, `e164-trunk-zero-reject`, `cost-origin-axis`, `telnyx-p5-origination`, `config-shape`) |
| Sonstige Dateien | `package.json` (Kommentar-String), `tasks/i18n-tests/22-w2-b3-bericht.md` (neu) |
| Produktionscode-Zeilen | 0 |
| `npm test` | 3295 / 3295 / 0 (unveraendert) |
| `npm run test:gates` | 69 / 61 / 8 (Baseline-Fail-Set + `OUT-14`) |
| Ungefiltert | 3364 = 3295 + 69 |
| Safety | FREIGABE, keine Blocker |
| Clean-Code | FREIGABE, keine Blocker (nur s3/s4-Hinweise) |
| Fix-Runden | 0 |
