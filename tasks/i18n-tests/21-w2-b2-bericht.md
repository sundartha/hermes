# W2-B2 — Phasenbericht: Telefonie-Render, STT/TTS, Assistant-Pfad

Basis: `master` (`80f788e`), Umsetzung auf Branch `phase/w2-b2-telefonie-render`. Kein
Produktionscode geaendert (nur `test/*`, ein Kommentar in `package.json`, dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | erwartete Polaritaet | gemessen | Datei |
|---|---|---|---|---|
| VOICE-05 | Mechanismus | gruen | **gruen** | test/geo-registry.test.js (neu) |
| VOICE-09 | Mechanismus | gruen | **gruen** | test/api.test.js (neu) |
| VOICE-12 | Buchhaltung | — | Referenz-Kommentar | test/telnyx-elevenlabs-render.test.js |
| VOICE-18 | Buchhaltung | — | Referenz-Kommentar | test/telnyx-call-control.test.js |
| VOICE-19 | Buchhaltung | — | Referenz-Kommentar | test/telnyx-call-control.test.js |
| VOICE-22 | Mechanismus | gruen | **gruen** | test/directive-render.test.js (neu) |
| VOICE-23 | Charakterisierung | gruen | **gruen** | test/render-adapter-language-parity.test.js (neu) |
| VOICE-24 | Buchhaltung | — | Referenz-Kommentar | test/telnyx-assistant-config.test.js |
| VOICE-25 | Mechanismus | gruen | **gruen** | test/render-adapter-language-parity.test.js (neu) |
| VOICE-29 | Mechanismus | gruen | **gruen** | test/render-adapter-language-parity.test.js (neu) |
| GAP-24 | SOLL | rot | **rot** | test/telnyx-p8-inbound.test.js (neu) |

Ergebnis deckt sich exakt mit Plan §0: 7 neue Tests (6 gruen, 1 rot), 4 Buchhaltungen ohne
eigenen Test. Die Katalog-Erwartungen "rot" fuer VOICE-18/VOICE-19 (Stand 07-22) sind
ueberholt (Baseline §3.4) — Verhalten ist bereits korrekt und durch Bestandstests belegt,
deshalb Buchhaltung statt neuem Testbau.

## 2. Abweichungen (R-G)

1. **GAP-24 wird NICHT in Katalog-Breite gebaut.** Nur Teil (b) der drei Katalogforderungen
   ("jeder `startAssistant` traegt einen Sprach-Hint") ist Gegenstand dieses Tests. Teil (a,
   "unterschiedliche Assistant-Referenzen je Sprache") bleibt ein dokumentiert getragenes
   Risiko (eine globale Assistant-Instanz, `tasks/i18n-tests/19-w2-baseline.md` §7), keine
   gefallene Produktentscheidung — ein Pin darauf waere ein erfundenes Soll. Teil (c, "das
   Provisioner-Skript bricht ohne Env ab") ist bereits durch
   `test/telnyx-assistant-config.test.js` (`missingRequired`) abgedeckt; ein zweiter Test
   waere Duplikat (G5).
2. **VOICE-09 wird an `POST /api/settings` gemessen, nicht an
   `POST /api/self-service/settings`.** Beide muenden in `store.updateSettings` (dieselbe
   `OPTIONAL_ENUM_FIELDS`-Validierung); die Self-Service-Route braucht Web-Login + pglite,
   das gehoert nicht in eine Datei mit Server-Spawn (Lehre p6a-Stall, Praezedenz W2-B1 §2.4).
3. Katalog-Erwartung "rot" fuer VOICE-18/VOICE-19 (07-22) ist ueberholt: Fail-open auf
   `"auto"` fuer unbekannte Sprachen und `{}` ohne `language` sind seit der
   Assistant-Fix-Kette bereits Bestandsverhalten und dort getestet
   (`test/telnyx-call-control.test.js`) — Buchhaltung statt neuem Testbau.
4. **Kopplung dokumentiert** (§2.4 des Plans): der gruene Inbound-Byte-Identitaets-Test
   ("startInboundAiAssistant: call.language gesetzt -> startAssistant OHNE language-Feld")
   und der rote GAP-24-Test daneben in `test/telnyx-p8-inbound.test.js` behaupten das
   Gegenteil voneinander. Wer den Inbound-Sprach-Hint nachruestet, MUSS beide Tests in einer
   Aenderung anpassen — der Byte-Identitaets-Test wird dann sachlich falsch und muss
   umgeschrieben werden, nicht nur GAP-24 auf gruen gestellt.

## 3. Lauf-Zahlen

| # | Befehl | Ergebnis |
|---|---|---|
| 1 | `NODE_ENV=test node --test test/geo-registry.test.js` | 3/3 pass (vorher 2/2) |
| 2 | `NODE_ENV=test node --test test/directive-render.test.js` | 15/15 pass (vorher 14/14) |
| 3 | `NODE_ENV=test node --test test/render-adapter-language-parity.test.js` | 3/3 pass (neue Datei) |
| 4 | `NODE_ENV=test node --test test/api.test.js` | 20/20 pass (vorher 19/19) |
| 5 | `NODE_ENV=test node --test test/telnyx-p8-inbound.test.js` | 10 Tests, 9 pass, genau **1** `not ok`: GAP-24 |
| 6 | `NODE_ENV=test node --test test/characterization-marking.test.js` | 9/9 pass (GAP-27-Waechter bleibt gruen) |
| 7 | `npm test` | 3310 rohe node:test-Ergebnisse, davon 15 Datei-Wrapper abgezogen -> **korrigiert 3295/3295 pass/0 fail** (unveraendert gegenueber W2-B1) |
| 8 | `npm run test:gates` | 468 rohe Ergebnisse, davon 412 Datei-Wrapper abgezogen -> **korrigiert 56/50 pass/6 fail** (W2-B1: 49/44/5) |
| 9 | `node --test "test/*.test.js"` (ungefiltert) | **3351 Tests** = 3295 + 56, 3345 pass, 6 fail — Split verliert und dupliziert nichts |
| 10 | `git diff master --stat` | ausschliesslich `package.json` + die 7 betroffenen `test/*`-Dateien (plus die neue, untracked `test/render-adapter-language-parity.test.js`) — Null Dateien unter `src/`, `public/`, `apps/`, `scripts/` |

Fail-Set in Zeile 8/9 exakt: `GAP-05`, `GAP-15` (x2), `LANG-15`, `LANG-19`, `GAP-24` — kein
weiterer Fehlschlag. Die ersten 5 sind Bestand (unveraendert seit W2-B1); `GAP-24` ist der
einzige neue Fehlschlag dieser Phase, und rot ist hier das Arbeitsergebnis
(PLAN-I18N-TESTS.md 4.1).

## 4. Nebenbefund

Keiner ueber die im Plan bereits benannten Punkte hinaus. GAP-24 bestaetigt praezise die in
`19-w2-baseline.md` §2.2 vermerkte TEIL-Abdeckung: der Ingest-Pfad (`startAssistant` mit
`call.language`) traegt den STT-Hint, der Inbound-Pfad (`src/telnyx-inbound.js`) bewusst
nicht (Kommentar "STT-Sprach-Hint dort ist P6-Scope"). Fuer einen EN-Tenant entscheidet
damit weiterhin die globale Assistant-Config ueber die Transkriptionssprache seines
Inbound-Anrufs.

## 5. Blast-Radius

7 Bestands-Testdateien (nur additiv erweitert: `test/geo-registry.test.js`,
`test/api.test.js`, `test/directive-render.test.js`, `test/telnyx-p8-inbound.test.js`,
`test/telnyx-elevenlabs-render.test.js`, `test/telnyx-call-control.test.js`,
`test/telnyx-assistant-config.test.js`), 1 neue Testdatei
(`test/render-adapter-language-parity.test.js`), 1 Kommentarzeile in `package.json`, dieser
Bericht. Null Zeilen Produktionscode.
