# Phasenbericht W2-B7 — Rest (MCP, Sicherungs-Vertraege, Formate)

**Gate:** PASS
**finalBranch:** `phase/w2-b7-rest`
**Basis:** `master` = `aa24c0e`
**headCommit:** `6df6d2e0318a643626c7bdcaff9012077629ffff`

## Scope

12 IDs aus `tasks/i18n-tests/18-w2-scope.md` §W2-B7:
MCP-14, MCP-16, LAW-14, LAW-15, LAW-18, LAW-22, FMT-23, FMT-24, FMT-27, FMT-30, GAP-26, GAP-31.

## Plan (gekuerzt)

Vorher-Anker (auf `master`): `npm run test:gates` korrigiert 116/85/31, `npm test` 3295/3295/0.

Zuordnung der 12 IDs (gemessen, nicht aus dem Katalog uebernommen):

| ID | Art | Ergebnis | Datei | Tests |
|---|---|---|---|---|
| MCP-14 | SOLL + Mechanismus (R-G: neues Subjekt) | rot + gruen | `test/mcp-tools-i18n.test.js` | 2 |
| MCP-16 | Mechanismus (Nebenlaeufigkeit) | gruen | `test/mcp-tools-i18n.test.js` | 1 |
| LAW-14 | Sicherungs-Invariante (CLI fail-closed) | gruen | `test/erase-tenant-cli.test.js` (neu) | 2 |
| LAW-15 | Env-Doku-Kohaerenz (Defaults 30/7) | gruen | `test/env-docs-spend-cap-coherence.test.js` | 1 |
| LAW-18 | Mechanismus (R-G: Endwert seit P10) | gruen | `test/f1-geo-port.test.js` | 1 |
| LAW-22 | Nebenlaeufigkeit (R-G: `en`, nicht `de`) | gruen | `test/f1-geo-onboard.test.js` | 1 |
| FMT-23 | Grenzfall (CJK) | gruen | `test/g1-owner-identity-seed.test.js` | 1 |
| FMT-24 | Grenzfall (CJK) | gruen | `test/telnyx-render.test.js` | 1 |
| FMT-27 | Buchhaltung (G5: von LANG-17 abgedeckt) | – | `test/f1-geo-store.test.js` (Kommentar) | 0 |
| FMT-30 | Grenzfall (Offset-ISO) | gruen | `test/budget-month-flip.test.js` | 1 |
| GAP-26 | SOLL | rot | `test/max-duration-live-cap.test.js` | 1 |
| GAP-31 | SOLL | rot | `test/locale-field-consumers.test.js` (neu) | 1 |

Summe: 13 neue Tests (10 gruen / 3 rot), 11 IDs mit Test, 1 ID Buchhaltung, 2 neue Dateien.

### R-G-Abweichungen (verbindlich)

1. **MCP-14** — das Katalog-Subjekt (`get_call_status`/`roleCounterparty`) ist seit P12 geschlossen (T2-Pin). Gebaut wurde stattdessen gegen drei echte deutsche Stufe-0-Artefakte in `src/mcp-tools.js` (Leertext "Keine offenen Action Items.", Termin-Praefix, Verbinder " bis "). Zweiter, gruener Test beweist Host-Unabhaengigkeit des Texts (auch bei Widget).
2. **MCP-14 widerspricht S1-5b** in `test/mcp-tools.test.js` (Default-Sprache `de` vs. `language:"en"` in MCP-14a) — kein echter Widerspruch, zwei Achsen (Safety-Review Anmerkung), Fix-Auflage bleibt: Bestandspin nach `loc.mcp.*`-Fix mitziehen.
3. **LAW-18** — Katalogtext ist seit P10 halb falsch: Sprach-Endwert bei Total-Ausfall ist nicht `de`, sondern `languageForCountry(DEFAULT_COUNTRY)`; Test gegen Konstanten, nicht gegen `"de"` formuliert.
4. **LAW-22** — „je isoliert DE-Sprache" ueberholt; zwei parallele US-Onboards -> `US`/`en`; Isolationsbeweis ueber Record-Identitaet (zwei `numberId`), kein Duplikat von LANG-23 (dort verschiedene Laender).
5. **FMT-27** vollstaendig durch LANG-17 (`f1-geo-store.test.js`, 3x3-Praezedenzmatrix) abgedeckt; `number.country` nimmt an `resolveCallLanguage` nicht teil — Buchhaltung, kein zweiter Test.
6. **LAW-15** zerfaellt: „fail-closed bei 0" bereits an Konsumenten gepinnt (P2b-05/12/24/31, `retention.test.js`); neu ist nur die Zahl 30/7 selbst (Code-Fallback vs. `.env.example`).
7. **GAP-26** nur Haelfte (a) gebaut (Cap-Merkmal fehlt); Haelfte (b, Hold-/Musik-Erkennung) als getragenes Risiko notiert, keine Produktaenderung ohne Subjekt.

### Neue Dateien laut Plan

- `test/erase-tenant-cli.test.js` (LAW-14, 2 Tests, gruen) — Kindprozess-Spawn von `scripts/erase-tenant.js`, Muster `check-setup-script.test.js`; prueft fail-closed ohne `tenantId`/`--confirm` (Store byte-identisch) und Erfolgsfall (PII-freie Zaehlerzeile, Store danach 0 Calls).
- `test/locale-field-consumers.test.js` (GAP-31, 1 Test, rot) — Scan ueber `src/**/*.js` (ausserhalb `src/i18n/locales.js`) auf Konsumenten jedes `LOCALES.de`-Felds; Selbstschutz gegen Stumpfwerden per Untergrenzen-Assertion.

### Edits an Bestandsdateien (Kurzfassung)

- `test/mcp-tools-i18n.test.js`: MCP-14a (rot), MCP-14b (gruen), MCP-16 (gruen, OAuth-Spawn nach Muster `am6-oauth-tenant.test.js`); neue Modul-Konstanten (`GERMAN_STAGE0_PROBES` u.a.), Kopfkommentar aktualisiert.
- `test/env-docs-spend-cap-coherence.test.js`: `readCodeFallback`-Regex toleriert Zeilenumbruch nach `numEnv(`; neuer LAW-15-Test gegen `RETENTION_DAYS`/`DIAGNOSTIC_RETENTION_DAYS` (30/7) in `src/config.js` und `.env.example`.
- `test/diagnostic-retention.test.js`, `test/f1-geo-store.test.js`: reine Buchhaltungs-Kommentare (LAW-15-Teilhaelfte, FMT-27), keine Testnamen geaendert.
- `test/f1-geo-port.test.js`: LAW-18-Test (Total-Ausfall Geo-Ermittlung, Land=`DEFAULT_COUNTRY`, Sprache aus Tabelle).
- `test/f1-geo-onboard.test.js`: LAW-22-Test (zwei parallele US-Onboards, isolierte Records).
- `test/g1-owner-identity-seed.test.js`: FMT-23-Test (CJK-Name ohne Leerzeichen, `firstNameOf`).
- `test/telnyx-render.test.js`: FMT-24-Test (CJK-Text durch `escapeXml`/`renderDirectives` unveraendert, Bytezahl-Invariante).
- `test/budget-month-flip.test.js`: FMT-30-Test (Offset-ISO an Monatsgrenze -> UTC-Monat).
- `test/max-duration-live-cap.test.js`: GAP-26-Test (rot, `call.failureReason` fehlt am Cap-Pfad), gemeinsamer Helper `placeCappedCall` fuer beide Tests extrahiert.
- `package.json`: Kommentar-String der Ausnahmeliste um `FMT-27`/`LAW-15 (Teilhaelfte)` ergaenzt.

### Erwartetes Ergebnis laut Plan

`npm test`: 3295/3295/0 (unveraendert, alle 13 neuen Tests tragen Katalog-ID am Namensanfang -> landen in `test:gates`).
`npm run test:gates`: korrigiert 129/95/34 (116+13 / 85+10 / 31+3); neue Reds: MCP-14a, GAP-26, GAP-31.

## Impl-Zusammenfassung

- headCommit: `6df6d2e0318a643626c7bdcaff9012077629ffff`, committed auf `phase/w2-b7-rest`.
- `node --check` auf allen betroffenen/neuen Dateien: bestanden.
- `npm test`: 3295/3295/0 (bestaetigt, unveraendert zum Vorher-Anker).
- `npm run test:gates`: korrigiert 129/95/34 — exakt wie geplant hergeleitet (116+13/85+10/31+3).
- 13 neue Tests exakt wie im Plan (10 gruen, 3 rot: MCP-14a, GAP-26, GAP-31), alle drei SOLL-Tests rot-vor-Fix mit dem vorhergesagten Fehlschlag verifiziert (MCP-14a am Verbinder " bis ", GAP-26 an `call.failureReason === null`, GAP-31 an `["sttLocale"]`).
- Zwei neue Testdateien (`test/erase-tenant-cli.test.js`, `test/locale-field-consumers.test.js`), acht additiv erweiterte Bestandsdateien, zwei reine Buchhaltungskommentare, ein package.json-Kommentar-String.
- GAP-27-Charakterisierungs-Waechter bleibt 9/9 gruen (kein Mischsprach-Pin eingeschleppt).
- R-A bestaetigt: `git diff master..HEAD --stat` zeigt nur `test/*`, `package.json`, `tasks/i18n-tests/26-w2-b7-bericht.md` — kein Produktionscode.
- `node_modules`-Symlink wurde vor dem Commit entfernt (nicht committed).
- Smoke-Test: Server bootet fail-closed korrekt (verlangt `PUBLIC_URL` + aktive Owner-Nummer); volle Route-Smoke-Abdeckung kommt aus den neuen echten Spawn-Tests selbst (LAW-14 CLI-Spawn, MCP-16 OAuth-Spawn, GAP-26 `/api/calls`-Spawn).

### Deviations

- `test/f1-geo-onboard.test.js` hatte vor der Phase 8 Tests statt der im Plan geschaetzten 9 — nach dem LAW-22-Zusatz sind es 9 statt der geschaetzten 10. Reine Zaehl-Abweichung in der Plan-Vorabschaetzung, keine funktionale Abweichung.

## Safety-Urteil

**Verdikt: FREIGABE.** Approved, keine Blocker.

- testsPassIndependently: true (eigener Lauf im frischen Worktree)
- safetyGatesIntact / disclosureIntact / authFailClosedIntact / noSecretsLeaked / scopeRespected / behaviorAsIntended: alle true

Begruendung: reine Testphase — `git diff master phase/w2-b7-rest` fasst `src/`, `scripts/`, `public/`, `apps/`, `render.yaml`, `.env.example`, `package-lock.json` nicht an. Offenlegungssatz byte-identisch zu master; keine Gate-Zeile beruehrt; kein neuer Endpunkt, keine Auth-Aufweichung (MCP-16 nutzt regulaeren OAuth-Pfad, kein Bypass, kein `SKIP_*`-Env im Diff); keine Secrets, nur synthetische Testnummern; LAW-14 prueft aktiv PII-Freiheit des Erase-Logs.

Eigener unabhaengiger Testlauf: `npm test` Lauf 1 zeigte 3295/3294/1 (ein Fail in `test/telnyx-p8-inbound.test.js`, isoliert gruen, Datei vom Diff nicht beruehrt — dokumentierter Voll-Last-Flake/Seed-vor-Boot-Race); Lauf 2: 3295/3295/0, EXIT=0. `test:gates`: korrigiert 129/95/34, alle 34 Reds tragen „(SOLL, rot)", die drei neuen (MCP-14, GAP-26, GAP-31) scheitern an den vorhergesagten Stellen (Quelltext gegengeprueft: `src/mcp-tools.js` Zeilen mit " bis ", "Keine offenen Action Items.", "(Termin) "). `data/store.json` vor/nach allen Laeufen sha-identisch. `git merge-base --is-ancestor master review-w2-b7`: master ist Vorfahr, kein Stale-Base.

### Anmerkungen (nicht-blockierend)

1. Vorbestehender Voll-Last-Flake in `test/telnyx-p8-inbound.test.js` (nicht von dieser Phase, Datei unberuehrt) — ein Einzellauf kann falsch-rot erscheinen.
2. LAW-14 pinnt ein echtes Sicherungs-Gate, landet aber nur in `test:gates` (nicht Merge-Gate) — schwaechere Aufhaengung fuer eine Safety-Invariante als wuenschenswert, folgt aber der Repo-Konvention.
3. GAP-31-Detektor ist bewusst lose (kann nur unter-melden, nie ueber-melden) — heute korrekt rot auf `sttLocale`, wird nach Fix leicht stumpf.
4. Bericht ueberzeichnet den „Widerspruch" zu S1-5b leicht (zwei Achsen, kein echter Widerspruch); abgeleitete Fix-Auflage bleibt trotzdem richtig.

## Clean-Code-Audit (S1-S4)

- **s1: []** — keine Blocker.
- **s2: []** — keine.
- **s3: []** — keine.
- **s4: []** — keine.
- **blocker: false**

**Verdikt: FREIGABE.** Diff ist reiner Test-/Doku-Zuwachs, kein Produktionscode veraendert. Kompletter Diff gelesen, alle 13 betroffenen Testdateien real in separatem Worktree ausgefuehrt: 133 gruen, 6 rot — alle 6 roten tragen „(SOLL, rot)" im Namen (GAP-26, GAP-31, MCP-14a neu; LANG-19, GAP-34 x2 bereits vor diesem Diff rot, vom Diff nicht beruehrt). Alle als „gruen" deklarierten neuen Tests laufen tatsaechlich gruen, keine Diskrepanz zum Bericht. Zitierte Helper existieren alle (keine Phantom-Imports). G5-Dedup aktiv verbessert (`placeCappedCall`-Helper in `max-duration-live-cap.test.js`). Keine Umlaute in neuen Kommentaren, keine Magic Numbers ohne benannte Konstante gefunden. Kein Safety-/Auth-/Secret-Bezug (keine `src/`-Aenderung).

### passNotes (Auszug)

1. Striktes Scope-Limit auf Tests+Doku.
2. Jede neue Test-ID traegt Praefix am Namensanfang -> automatische Lauf-Trennung ohne manuelle Pflege.
3. G5-Dedup aktiv demonstriert (`placeCappedCall`).
4. FMT-27 bewusst nicht dupliziert, sondern als Kommentar-Buchhaltung auf LANG-17 verwiesen.
5. SOLL-rot-Tests klar als offene Produktbefunde beschriftet.
6. LAW-14 testet echten Kindprozess-Lauf des CLI-Skripts inkl. PII-Freiheits-Pruefung.
7. Bericht deckt sich 1:1 mit tatsaechlich gemessenem Testergebnis.

### topTodos

1. Fix-Auflage im Auge behalten: sobald `loc.mcp.emptyActionItems`/`appointmentPrefix`/`calendarRangeSeparator` gefixt werden, muss der widerspruechliche Bestandspin in `test/mcp-tools.test.js` (S1-5b) im selben Zug mitgezogen werden.
2. GAP-26/GAP-31/MCP-14a bleiben offene SOLL-Befunde fuer eine spaetere Fix-Phase — keine Aktion in W2-B7 noetig.

## Fix-Runden

Keine. Kein Fix-Zyklus war noetig — Plan, Impl, Safety- und Clean-Code-Review liefen alle direkt auf PASS/FREIGABE ohne Blocker.
