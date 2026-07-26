# W2-B7 — Phasenbericht: Rest (MCP, Sicherungs-Vertraege, Formate)

Basis: `master` (`aa24c0e`), Umsetzung auf Branch `phase/w2-b7-rest`. Kein Produktionscode
geaendert (nur `test/*`, ein Kommentar-String in `package.json`, dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | Katalog-Erwartung | gemessen heute | Datei |
|---|---|---|---|---|
| MCP-14 | SOLL + Mechanismus (R-G: neues Subjekt) | gruen | **rot + gruen** | test/mcp-tools-i18n.test.js |
| MCP-16 | Mechanismus (Nebenlaeufigkeit) | gruen | **gruen** | test/mcp-tools-i18n.test.js |
| LAW-14 | Sicherungs-Invariante (CLI fail-closed) | gruen | **gruen** (2 Tests) | test/erase-tenant-cli.test.js (neu) |
| LAW-15 | Env-Doku-Kohaerenz (Defaults 30/7) | gruen | **gruen** | test/env-docs-spend-cap-coherence.test.js |
| LAW-18 | Mechanismus (R-G: Endwert seit P10) | gruen | **gruen** | test/f1-geo-port.test.js |
| LAW-22 | Nebenlaeufigkeit (R-G: `en`, nicht `de`) | unbekannt | **gruen** | test/f1-geo-onboard.test.js |
| FMT-23 | Grenzfall (CJK) | unbekannt | **gruen** | test/g1-owner-identity-seed.test.js |
| FMT-24 | Grenzfall (CJK) | unbekannt | **gruen** | test/telnyx-render.test.js |
| FMT-27 | Buchhaltung (G5: von LANG-17 abgedeckt) | gruen | – | test/f1-geo-store.test.js (Kommentar) |
| FMT-30 | Grenzfall (Offset-ISO) | gruen | **gruen** | test/budget-month-flip.test.js |
| GAP-26 | SOLL | rot | **rot** | test/max-duration-live-cap.test.js |
| GAP-31 | SOLL | rot | **rot** | test/locale-field-consumers.test.js (neu) |

**13 neue Tests (10 gruen / 3 rot), 11 IDs mit Test, 1 ID Buchhaltung, 2 neue Dateien.**
Jeder Testname beginnt mit seiner Katalog-ID (R-B) — alle 13 wandern automatisch in
`npm run test:gates`.

## 2. Abweichungen (R-G)

1. **MCP-14 — das Katalog-Subjekt ist tot, ein besseres lebt.** Der Katalog misst
   `"Gegenseite"` in `get_call_status`. Das ist seit P12 geschlossen (`pickCallStatus` →
   `texts.roleCounterparty`, gepinnt von T2 in `mcp-tools-language.test.js`). Ein gruener
   Pin darauf waere ein Duplikat. Gemessen sind heute drei echte deutsche
   Stufe-0-Artefakte in `src/mcp-tools.js` (alle sprachfrei, kein `loc.`-Bezug):
   `list_action_items` Leertext ("Keine offenen Action Items."), Termin-Praefix
   (`(Termin) `) und der `get_calendar`-Verbinder (" bis "). MCP-14a faehrt rot genau am
   Verbinder (erste Probe in der Datenliste); die Katalog-These ("ein Widget-Fix reicht
   nicht") ist als zweiter, gruener Test (MCP-14b) bewiesen: `get_calendar` traegt ein
   Widget, sein Text ist trotzdem host-unabhaengig.
2. **MCP-14 widerspricht einem Bestandspin.** `test/mcp-tools.test.js` S1-5b pinnt
   `assert.equal(toolText(result), "Keine offenen Action Items.")` gruen (Default-Sprache
   `de`, unveraendert). Muster GAP-37 (W2-B6): der Widerspruch IST der Launch-Befund - der
   Bestandstest bleibt namens-neutral gruen im Regressionslauf, MCP-14a faehrt ID-getragen
   rot im Gate-Lauf. **Fix-Auflage:** nach dem Fix (`loc.mcp.emptyActionItems` /
   `appointmentPrefix` / `calendarRangeSeparator`) muss der Bestandspin mitgezogen werden.
3. **LAW-18 — der Katalogtext ist seit P10 halb falsch.** Der Sprach-Endwert bei
   Total-Ausfall ist NICHT `de`: `resolveOnboardCountry({})` → `DEFAULT_COUNTRY` ("DE"),
   und die Sprache kommt aus `languageForCountry("DE")` = `"de"` AUS DER TABELLE, nicht aus
   `DEFAULT_LANGUAGE`. `DEFAULT_LANGUAGE` (= `"en"`) greift erst, wenn der
   Fallback-Countrycode tabellen-fremd ist. Der Test ist flip-stabil gegen
   `DEFAULT_COUNTRY`/`DEFAULT_LANGUAGE` formuliert, nie gegen `"de"`.
4. **LAW-22 — "je isoliert DE-Sprache" ist ueberholt.** Zwei parallele US-Onboards liefern
   je `US`/`en`. Bei identischem Land ist ein Sprach-Cross-Talk gar nicht sichtbar - der
   pruefbare Isolations-Beweis ist Record-Identitaet (zwei Tenants, zwei verschiedene
   `numberId`). Kein Duplikat von LANG-23 (dort verschiedene Laender, Sprach-Mix als
   Sonde).
5. **FMT-27 ist bereits vollstaendig abgedeckt (G5 → Buchhaltung).** `LANG-17` in
   `test/f1-geo-store.test.js` faehrt die 3×3-Praezedenz-Matrix inkl.
   `settings=null/"" x number gesetzt x tenant gesetzt` → number gewinnt.
   `number.country` nimmt an `resolveCallLanguage` gar nicht teil - "US-Nummer" im
   FMT-27-Titel ist dekorativ. Kein zweiter Test, nur ein Buchhaltungs-Kommentar.
6. **LAW-15 zerfaellt in zwei Haelften.** Die "fail-closed bei 0"-Haelfte ist am
   KONSUMENTEN bereits gepinnt (`test/diagnostic-retention.test.js` P2b-05/12/24/31,
   `test/retention.test.js` "RETENTION_DAYS=0") → Buchhaltungs-Kommentar. Ungepinnt war
   allein die Zahl 30/7 selbst (Code-Fallback vs. `.env.example`) → ein neuer Test in
   `test/env-docs-spend-cap-coherence.test.js` (inkl. einer verhaltens-erhaltenden
   Regex-Lockerung in `readCodeFallback`, siehe §3).
7. **GAP-26 nur Haelfte (a).** Haelfte (b) ("Agent laeuft nicht in die
   no-speech-Eskalation, Hold-/Musik-Erkennung") ist eine Produktaenderung ohne heutiges
   Subjekt; sie ist ein getragenes Risiko (siehe §5), nicht gebaut.

## 3. Edit an einer Bestandsfunktion (verhaltens-erhaltend)

`test/env-docs-spend-cap-coherence.test.js`: `readCodeFallback` toleriert jetzt einen
Zeilenumbruch zwischen `numEnv(` und dem folgenden Env-Namen
(`numEnv\(\s*"..."` statt `numEnv\("..."`). `DIAGNOSTIC_RETENTION_DAYS` steht in
`src/config.js` mehrzeilig - ohne die Lockerung findet der Parser den Fallback nicht (die
3 Bestandsaufrufe der Funktion bleiben, da einzeilig, byte-identisch gruen).

## 4. Neue Dateien

- `test/erase-tenant-cli.test.js` (LAW-14, 2 Tests): Kindprozess-Spawn von
  `scripts/erase-tenant.js` gegen ein Temp-`DATA_DIR`. Test 1 iteriert ueber beide
  Verweigerungs-Faelle (ohne tenantId, ohne `--confirm`) und beweist Store-Byte-Identitaet.
  Test 2 beweist Exit 0, die PII-freie Zaehlerzeile (`calls=1 ... privateNumber=1`) und
  dass der Transkript-Text selbst NICHT im Log auftaucht.
- `test/locale-field-consumers.test.js` (GAP-31, 1 Test, rot): scannt `src/**/*.js`
  (ausser der definierenden `src/i18n/locales.js`) nach `.<feld>`-Referenzen fuer jedes
  Feld aus `LOCALES.de`. Rot genau am erwarteten Fund: `sttLocale` hat 0 Konsumenten (die
  echte STT-Locale kommt aus Adapter-eigenen Maps, nicht aus dem Locale-Bundle).
  Selbstschutz gegen stummes Stumpfwerden: Untergrenzen-Assertion auf Quelldateizahl und
  Feldzahl.

## 5. Lauf-Zahlen (gemessen)

```
npm test          -> korrigiert 3295 / 3295 / 0   (unveraendert gegen den Vorher-Anker)
npm run test:gates -> roh 513 / 479 pass / 34 fail
                      korrigiert: tests 129 / pass 95 / fail 34
                      (Vorher-Anker: 116/85/31 + 13 neue = 129/95/34 exakt)
```

Neu rot im Gate-Lauf: `MCP-14 (SOLL, rot)`, `GAP-26 (SOLL, rot)`, `GAP-31 (SOLL, rot)` -
alle drei mit dem im Plan vorhergesagten Fehlschlag (Verbinder " bis ", `failureReason`
`null`, `["sttLocale"]`). Der GAP-27-Waechter (`test/characterization-marking.test.js`)
bleibt 9/9 gruen - kein Mischsprach-Pin eingeschleppt.

## 6. Getragene Risiken (kein Testbau, Blockreport)

- GAP-26 Haelfte (b): Hold-/Musik-Erkennung, no-speech-Eskalation am Dauer-Cap - eine
  Produktaenderung ohne heutiges Subjekt.
- LAW-13/GAP-16/GAP-17 (Policy, aus §2 der Scope-Datei) - ausserhalb dieser Phase.
- Die drei deutschen Stufe-0-Artefakte in `src/mcp-tools.js` (list_action_items-Leertext,
  Termin-Praefix, get_calendar-Verbinder) bleiben bis zum MCP-14-Fix live sichtbar fuer
  EN/FR-Tenants.

## 7. Clean-Code- und Regel-Selbstpruefung

- **R-A**: kein Produktionscode. Nur `test/*` + der Kommentar-String in `package.json`.
- **R-B**: alle 13 Testnamen tragen ihre Katalog-ID am Anfang.
- **R-C**: `npm test` bleibt bei 3295/0.
- **R-D**: keine neue Env-Variable, `BASE_ENV` unberuehrt. `MCP_AUTH`/`OAUTH_ISSUER_URL`/
  `MULTI_TENANT` in MCP-16 sind per-Test-Overrides (Praezedenz `am6-oauth-tenant.test.js`).
- **G5/S2**: kein zweiter MCP-Harness, kein zweiter Env-Doku-Parser, FMT-27 nicht
  dupliziert, `placeCappedCall` als gemeinsame Vorbereitung beider Cap-Tests in
  `max-duration-live-cap.test.js`.
- **G25**: benannte Konstanten fuer alle Zahlen/Wiederholungsliterale (`EXIT_REFUSED`,
  `SPAWN_TIMEOUT_MS`, `RETENTION_DAYS_DEFAULT`, `UTC_MONTH_KEY_AT_EDGE`,
  `CAP_FAILURE_MARKER`, `CJK_FULL_NAME`, `TABLE_FOREIGN_FALLBACK_COUNTRY`, ...).
- **GAP-27-Kompatibilitaet**: jede Assertion mit `language: "en"` im Ist-Operanden nutzt
  `match`/`doesNotMatch` oder vergleicht zwei berechnete Werte.
- **Safety**: kein Test veraendert Denylist/Land-Gate/Stundenlimit/Budget/Max-Dauer, den
  Offenlegungssatz, die Signaturpruefung, Basic-Auth oder `safeEqual`. LAW-14 prueft ein
  Gate, ohne es zu lockern. MCP-16 nutzt den regulaeren OAuth-Pfad, keinen Bypass. Kein
  Secret in einer Assertion; LAW-14 prueft aktiv PII-Freiheit des Erase-Logs.
- **Keine neue Dependency.** Kein Netz in den neuen Tests: MCP-14/MCP-16/LAW-22/GAP-26
  laufen gegen lokale HTTP-Mocks bzw. Kindprozesse mit `PORT=0` + Temp-`DATA_DIR`; LAW-14
  gegen ein Temp-`DATA_DIR`. `data/store.json` wird nie beruehrt.

## 8. Bekannte Abweichung von der Plan-Vorabschaetzung (harmlos)

`test/f1-geo-onboard.test.js` hatte vor dieser Phase 8 Tests (Plan schaetzte 9) - nach
LAW-22 sind es 9 (Plan schaetzte 10). Reine Zaehl-Abweichung in der Vorabschaetzung des
Plans, keine funktionale Abweichung.
