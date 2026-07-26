# Phase W2-B1 — Sprach-Aufloesung und Prompt-Schicht

- **Gate:** PASS
- **finalBranch:** `phase/w2-b1-sprache-prompts`
- **headCommit:** `0b5c9aac1cb454fa002d79f185510e506f716897`
- **Basis:** `master` = `c3cd702`

## 1. Plan (gekuerzt)

Reine Testphase, kein Produktionscode. 15 neue Tests ueber 14 i18n-Launch-Testkatalog-IDs
(LANG-09/15b/16/17/19/23/26, PROMPT-06/07/08/17/18/22, E2E-03) plus 2
Buchhaltungs-Kommentare (LANG-21, PROMPT-21 — bereits vollstaendig gepinnt, kein neuer
Test noetig, sonst Duplikat/G5).

Bindende Polaritaets-Tabelle (§0.1 des Plans), Kurzfassung:

| ID | Art | Polaritaet | Kernaussage |
|---|---|---|---|
| LANG-09 | Mechanismus | gruen | `languageForCountry` case-insensitiv, Fallback `DEFAULT_LANGUAGE` (nicht Literal `"de"`/`"en"`) |
| LANG-15a | **SOLL** | **rot** | Entscheidung E3: `place_call.language` sollte aus dem Zod-Schema entfernt werden; heute noch da, Beschreibung nennt sogar falschen Default `'de'` |
| LANG-15b | Mechanismus | gruen | `body.language` wird serverseitig ignoriert (`resolveCallLanguage` gewinnt) |
| LANG-16 | Charakterisierung | gruen | Unrouted-Hangup fest deutsch (Ist-Zustand gepinnt, nicht als Soll erklaert) |
| LANG-17 | Mechanismus | gruen | volle Praezedenzmatrix settings/number/tenant inkl. `""`-Faellen, Endstufe `DEFAULT_LANGUAGE` |
| LANG-19 | **SOLL** | **rot** | Entscheidung E1: `updateSettings` sollte `"EN"` normalisieren statt still zu verwerfen |
| LANG-21 | Buchhaltung | — | vollstaendig durch Bestandstest gepinnt, nur Kommentar-Referenz |
| LANG-23 | Mechanismus | gruen | parallele Onboards bleiben isoliert (`withStoreLock`) |
| LANG-26 | Mechanismus | gruen | Inbound/Outbound leiten dieselbe Sprache aus derselben Nummer ab |
| PROMPT-06 | Luecke (Struktur) | gruen | `fetchPrecallBriefing` kennt keine Sprache, Aufrufer reicht keine durch |
| PROMPT-07 | Luecke | gruen | Briefing-System-Prompt ohne Sprachdirektive |
| PROMPT-08 | Sprachreinheit EN | gruen | umformuliert (Katalogtext "Labels bleiben deutsch" ist seit P11 ueberholt) |
| PROMPT-17 | Mechanismus | gruen | Legacy-Nummer-Record ohne `language`-Feld faellt sauber auf `tenant.defaultLanguage` |
| PROMPT-18 | Mechanismus | gruen | paralleler EN/DE-Call faerbt sich nicht ab (kein Modul-State) |
| PROMPT-21 | Buchhaltung | — | vollstaendig durch F7/F10/F11/F12 gepinnt, nur Kommentar-Referenz |
| PROMPT-22 | Sprachreinheit EN | gruen | wie PROMPT-08, fuer die Mandats-Sektion |
| E2E-03 | positive Invariante | gruen | `call.language` einmal bei Anlage aufgeloest, Sprachwechsel mitten im Call wirkungslos |

**Erwartete neue Rot-Faelle: genau 2** (LANG-15a, LANG-19 — beide Arbeitsergebnis, kein
Regressionsfang).

Dokumentierte Plan-Abweichungen (§0.2, alle plan-intendiert):
1. LANG-21 + PROMPT-21 ohne eigenen Test (Buchhaltung, Praezedenz aus W1/W2-B0).
2. LANG-15 mit zwei Tests (SOLL + Mechanismus), weil die ID zwei Konzepte traegt.
3. LANG-19 als SOLL statt Charakterisierung (Polaritaet aus Owner-Entscheidung D6/E1, nicht aus der Baseline-Prosa).
4. E2E-03 nutzt `POST /api/settings` statt der Self-Service-Route (gleiche Naht `store.updateSettings`, kleinerer Blast-Radius — pglite darf nie mit Server-Spawn in derselben Datei stehen).
5. Kopplungshinweis: faellt `place_call.language` weg (E3-Umsetzung), muss `EXPECTED_MARKERS` in `test/p15-mcp-tool-descriptions-en.test.js` mitgezogen werden.

Nicht-Ziele: kein Produktionscode, keine neue Dependency, keine neue Env-Var, keine
Umbenennung eines Bestandstests.

## 2. Impl-Zusammenfassung

Umsetzung exakt gemaess Plan:

- **Neue Datei:** `test/language-switch-midcall.test.js` (E2E-03, 2 Tests: Sprachwechsel waehrend laufendem Call bleibt wirkungslos; erst der naechste Call traegt die neue Sprache).
- **11 additiv erweiterte Bestandsdateien:** `test/f1-geo-port.test.js`, `test/f1-geo-store.test.js`, `test/f1-i18n-locale.test.js`, `test/f1-geo-onboard.test.js`, `test/f1-p8-outbound-lang.test.js`, `test/inbound-routing.test.js`, `test/cq-p8-briefing.test.js`, `test/assistant-context-render.test.js`, `test/cq-p6-mandate.test.js`, `test/telnyx-afix-p3-farewell.test.js`, `test/p15-mcp-tool-descriptions-en.test.js`.
- **`package.json`:** eine Kommentarzeile in der Ausnahme-Liste erweitert (LANG-21, PROMPT-21 ergaenzt), `config.i18nCatalogPattern` selbst unveraendert.
- **`tasks/i18n-tests/20-w2-b1-bericht.md`:** neuer Blockreport mit Polaritaets-Tabelle, Abweichungen, E3-Nebenbefund.

Kennzahlen aus dem Impl-Report:
- `nodeCheckPass`: true, `testsPass`: true
- `npm test`: 3295/3295 gruen (Regression, kein Verlust)
- `npm run test:gates`: 49 Tests, 44 pass, 5 fail — GAP-05, GAP-15 (x2, vorbestehend) + LANG-15, LANG-19 (neu, beabsichtigt)
- Split-Invariante: ungefiltert `node --test "test/*.test.js"` = 3344 = 3295 + 49, kein Testverlust/keine Dopplung
- `git diff master --stat -- src public apps render.yaml .env.example` = leer (kein Produktionscode geaendert)
- Smoke-Test lokal bestaetigt E2E-03 end-to-end (POST /api/settings language=en greift fuer neue Inbound-Calls, laufender Call bleibt auf urspruenglicher Sprache)

### Deviations (aus dem Impl-Report)

1. Keine Abweichungen vom Plan — alle 5 Plan-Abweichungen aus §0.2 sind plan-intendiert, nicht Impl-Entscheidung, im Bericht dokumentiert.
2. Gates-Lauf zeigt 49/44/5 statt der geschaetzten 48/43/5 (ein zusaetzlicher gruener Test gegenueber der Plan-Schaetzung) — das entscheidende Fail-Set (GAP-05, GAP-15 x2, LANG-15, LANG-19) deckt sich exakt mit dem Plan; Split-Invariante bewiesen intakt.

## 3. Safety-Urteil (final)

**Verdikt: FREIGABE.** Keine Blocker.

- `testsPassIndependently`: true, `safetyGatesIntact`: true, `disclosureIntact`: true, `authFailClosedIntact`: true, `noSecretsLeaked`: true, `scopeRespected`: true, `behaviorAsIntended`: true
- Eigener unabhaengiger Lauf im frischen Worktree (review-w2-b1 = phase/w2-b1-sprache-prompts, master ist Vorfahr): `npm test` 3295/3295 gruen, `npm run test:gates` 44/49 gruen (5 rot wie erwartet), ungefiltert 3339/3344 (5 rot), Split-Invariante bestaetigt.
- Ein initial beobachteter Ausreisser (`cq-p6-mandate-http.test.js`, HM5 "401 !== 500") war isoliert gruen und im zweiten ungefilterten Lauf ebenfalls gruen — bekannter vorbestehender Voll-Last-Spawn-Race (Seed-vor-Boot), keine Phasenwirkung, Datei nicht im Diff.
- git diff aendert ausschliesslich Tests, eine Kommentarzeile in `package.json` und den Berichtsdatei — null Zeilen Produktionscode. Damit sind Safety-Gates, der fest verdrahtete `disclosureSentence` sowie fail-closed Auth per Konstruktion unberuehrt.
- Keine neue npm-Dependency, keine Env-Aufweichung, `i18nCatalogPattern` byte-gleich.
- Secrets/PII-Scan: nur bestehende Fake-Testnummer (+4915112345678, bereits in master), keine Keys/Tokens/echten Nummern.
- Scope exakt getroffen: alle 16 Katalog-IDs aus §W2-B1 des Scope-Dokuments.

### Concerns (keine Blocker)

1. `PROMPT-06` prueft mit `assert.doesNotMatch` den kompletten Quelltext von `src/precall-briefing.js` auf `/language/` — broeselige Quelltext-Assertion, ein spaeterer Kommentar mit dem Wort "language" faerbt den Test rot ohne Verhaltensaenderung (nur Gates-Lauf betroffen).
2. LANG-23 + die beiden E2E-03-Tests sind spawn-schwer, erhoehen die Last im Gates-Lauf marginal und damit die Wahrscheinlichkeit des vorbestehenden ~12%-Voll-Last-Races leicht. Kein Fehler der Phase; Gate-Protokoll (rot nur echt, wenn isoliert rot) bleibt gueltig.
3. Charakterisierung LANG-16 pinnt den deutschen Ablehnungssatz byte-genau — korrekt markiert, muss aber aktiv mitgezogen werden, falls der Satz beim Weltstart lokalisiert wird.
4. LANG-15 (SOLL) und LANG-19 (SOLL) sind ab jetzt Dauer-Rot bis E3 bzw. E1 im Produktionscode umgesetzt sind. Duerfen NICHT durch Abschwaechen der Assertion "gefixt" werden.
5. Nebenbefund (bewusst nicht gefixt, Scope): MCP-Tool-Beschreibung `place_call.language` nennt weiterhin "default 'de'", waehrend `DEFAULT_LANGUAGE` seit P10 `"en"` ist — nutzersichtbare Falschaussage, gehoert in die E3-Phase.

## 4. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2:** keine
- **s3:**
  - PROMPT-18 (`test/f1-i18n-locale.test.js`, neuer Test): Kommentar behauptet, `Promise.all` mit `Promise.resolve(systemPrompt(...))` pruefe Nebenlaeufigkeit — `systemPrompt()` ist synchron, beide Aufrufe laufen sequenziell vor dem eigentlichen Scheduling, `Promise.all` aendert daran nichts. Die eigentlich geprufte Invariante (kein Cross-Talk zwischen zwei aufeinanderfolgenden Calls unterschiedlicher Sprache) bleibt korrekt und wertvoll — nur die Kommentar-Rahmung ist ueberzogen. Empfohlener Fix: Kommentar praezisieren oder echte Nebenlaeufigkeit erzwingen (z. B. via `setImmediate`-Wrapper).
- **s4:** keine
- **blocker:** false

**Verdikt: FREIGABE.** Diff aendert ausschliesslich Tests, einen Kommentar in
`package.json` und den Phasenbericht — null Zeilen Produktionscode. Jeder neue Test traegt
Katalog-ID + Begruendung; G5 aktiv vermieden (LANG-21/PROMPT-21 als Referenz statt Kopie);
F3/G15 vermieden (`placeCallWithLanguageWish` als eigene Funktion statt Flag-Parameter);
alle referenzierten Symbole existieren bereits im jeweiligen Dateikontext. Einziger Fund
ist S3 (kosmetischer Kommentar-Ueberzug bei PROMPT-18) — kein Blocker.

Top-Todos aus dem Audit:
1. Kommentar bei PROMPT-18 praezisieren (Promise.all testet hier keine echte Nebenlaeufigkeit, da `systemPrompt()` synchron ist).
2. Vor Merge einmal `npm test` real laufen lassen, um die im Bericht behaupteten Zahlen zu bestaetigen (der Clean-Code-Audit selbst hat die Suite nicht ausgefuehrt, reine Diff-/Symbolpruefung).

## 5. Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen direkt mit `FREIGABE`/`PASS` ohne
Blocker zurueck; die vorgeschlagenen Verbesserungen (S3-Kommentarpraezisierung,
Vor-Merge-Real-Lauf) sind offene Empfehlungen, keine durchgefuehrten Fix-Runden.
