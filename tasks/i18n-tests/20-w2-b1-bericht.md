# W2-B1 — Phasenbericht: Sprach-Aufloesung und Prompt-Schicht

Basis: `master` (Umsetzung auf Branch `phase/w2-b1-sprache-prompts`). Kein Produktionscode
geaendert (nur `test/*`, ein Kommentar in `package.json`, dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | erwartete Polaritaet | gemessen | Datei |
|---|---|---|---|---|
| LANG-09 | Mechanismus | gruen | **gruen** | test/f1-geo-port.test.js |
| LANG-15a | SOLL | rot | **rot** | test/p15-mcp-tool-descriptions-en.test.js |
| LANG-15b | Mechanismus | gruen | **gruen** | test/f1-p8-outbound-lang.test.js |
| LANG-16 | Charakterisierung | gruen | **gruen** | test/inbound-routing.test.js |
| LANG-17 | Mechanismus | gruen | **gruen** | test/f1-geo-store.test.js |
| LANG-19 | SOLL | rot | **rot** | test/f1-geo-store.test.js |
| LANG-21 | Buchhaltung | — | Referenz-Kommentar | test/f1-i18n-locale.test.js |
| LANG-23 | Mechanismus | gruen | **gruen** | test/f1-geo-onboard.test.js |
| LANG-26 | Mechanismus | gruen | **gruen** | test/f1-p8-outbound-lang.test.js |
| PROMPT-06 | Luecke (Struktur) | gruen | **gruen** | test/cq-p8-briefing.test.js |
| PROMPT-07 | Luecke | gruen | **gruen** | test/cq-p8-briefing.test.js |
| PROMPT-08 | Sprachreinheit EN | gruen | **gruen** | test/assistant-context-render.test.js |
| PROMPT-17 | Mechanismus | gruen | **gruen** | test/f1-geo-store.test.js |
| PROMPT-18 | Mechanismus | gruen | **gruen** | test/f1-i18n-locale.test.js |
| PROMPT-21 | Buchhaltung | — | Referenz-Kommentar | test/telnyx-afix-p3-farewell.test.js |
| PROMPT-22 | Sprachreinheit EN | gruen | **gruen** | test/cq-p6-mandate.test.js |
| E2E-03 | positive Invariante | gruen | **gruen** | test/language-switch-midcall.test.js (neu) |

Ergebnis deckt sich exakt mit Plan §0.1: 2 rote SOLL-Tests (LANG-15a, LANG-19), alle
uebrigen 13 neuen Tests gruen, 2 Buchhaltungen ohne eigenen Test.

## 2. Abweichungen (R-G)

1. LANG-21 + PROMPT-21 tragen keinen eigenen Test (Buchhaltung, Praezedenz W1/W2-B0) —
   Referenz-Kommentare an den bestehenden Pin-Tests (`f1-i18n-locale.test.js`,
   `telnyx-afix-p3-farewell.test.js`).
2. LANG-15 traegt zwei Tests (SOLL in `p15-mcp-tool-descriptions-en.test.js` + Mechanismus
   in `f1-p8-outbound-lang.test.js`) — die ID deckt zwei Konzepte (P14).
3. LANG-19 ist als SOLL gebaut (nicht Charakterisierung) — Polaritaet aus Entscheidung E1
   (Cluster D6), nicht aus dem reinen Ist-Zustand.
4. E2E-03 nutzt `POST /api/settings` statt `POST /api/self-service/settings` — beide muenden
   in `store.updateSettings`; die Self-Service-Route braucht Web-Login + pglite, das nicht in
   dieselbe Datei wie ein Server-Spawn gehoert (Lehre p6a-Stall).
5. Kopplung dokumentiert: sobald E3 umgesetzt wird (place_call.language entfernt), faellt der
   Pfad `place_call.language` zugleich aus `EXPECTED_MARKERS` in
   `test/p15-mcp-tool-descriptions-en.test.js` — Kommentar direkt am neuen Test.

## 3. Lauf-Zahlen

| Lauf | Befehl | Ergebnis |
|---|---|---|
| Gezielter Subset (Plan-Schritt 2) | `node --test` ueber die 11 betroffenen Dateien | 134 Tests, 132 pass, **genau 2** `not ok` (LANG-15, LANG-19) |
| GAP-27-Waechter | `node --test test/characterization-marking.test.js` | 9/9 pass |
| Regression | `npm test` | 3295/3295 pass, 0 fail |
| Gates | `npm run test:gates` | korrigiert 49/44 pass/5 fail — GAP-05, GAP-15 (x2, unveraendert) + LANG-15, LANG-19 (neu, Arbeitsergebnis) |
| Invariante (Split) | `node --test "test/*.test.js"` ungefiltert | 3344 Tests, 3339 pass, 5 fail — deckt sich exakt mit 3295 (Regression) + 49 (Gates), kein Testverlust/keine Dopplung |

Hinweis: Schritt 5 des Plans nennt 48/43/5 als erwartete Gate-Zahl; gemessen sind es 49/44/5
(ein zusaetzlicher gruener Test gegenueber der Plan-Schaetzung). Die fuer den Beweis
entscheidende Groesse — das Fail-Set — deckt sich exakt: GAP-05, GAP-15 (zweimal), LANG-15,
LANG-19. Kein weiterer Fehlschlag.

## 4. Nebenbefund (E3, LANG-15a)

`place_call.language` (`src/mcp-tools.js`) traegt eine nutzersichtbare Falschaussage: die
Beschreibung nennt `default 'de'`, waehrend der tatsaechliche Code-Default seit P10
`DEFAULT_LANGUAGE = "en"` ist. Das Feld ist zugleich serverseitig wirkungslos
(`resolveCallLanguage` liest es nie, s. LANG-15b). Entscheidung E3 (Cluster D11) sieht die
Entfernung vor — nicht Teil dieser Phase (Scope: nur Tests, kein Produktionscode).

## 5. Blast-Radius

11 Bestands-Testdateien (nur additiv erweitert), 1 neue Testdatei
(`test/language-switch-midcall.test.js`), 1 Kommentarzeile in `package.json`, dieser Bericht.
Null Zeilen Produktionscode.
