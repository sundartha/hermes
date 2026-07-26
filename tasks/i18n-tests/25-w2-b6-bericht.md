# W2-B6 — Phasenbericht: Web, Dashboard, Widget-Oberflaechen

Basis: `master` (`98f14fd`), Umsetzung auf Branch `phase/w2-b6-web-dashboard-widget`. Kein
Produktionscode geaendert (nur `test/*`, ein Kommentar-String in `package.json`, dieser
Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | Katalog-Erwartung | gemessen heute | Datei |
|---|---|---|---|---|
| WEB-03 | Mechanismus + Buchhaltung | gruen | **gruen** (3 Bestandstests + 1 neuer) | test/single-origin-serving.test.js |
| WEB-07 | SOLL | rot | **rot** | test/dashboard-i18n-surface.test.js (neu) |
| WEB-08 | SOLL | rot | **rot** | dito |
| WEB-10 | SOLL (R-G, s.u.) | rot | **rot** | test/self-service-error-codes.test.js |
| WEB-13 | SOLL | rot | **rot** | test/web-auth.test.js |
| WEB-18 | Regressions-Baseline | gruen | **gruen** | test/dashboard-i18n-surface.test.js |
| WEB-19 | SOLL | rot | **rot** | dito |
| WEB-25 | Mechanismus | gruen | **gruen** | test/f1-geo-port.test.js |
| UI-01 | Buchhaltung | – | Referenz-Kommentar (kein Test) | test/mcp-ui-widget-i18n.test.js |
| UI-02 | Buchhaltung | – | Referenz-Kommentar (kein Test) | dito |
| UI-03 | Mechanismus (umformuliert, R-G) | gruen | **gruen** | dito |
| UI-04 | Mechanismus | gruen | **gruen** | dito |
| UI-05 | Buchhaltung | – | Referenz-Kommentar (kein Test) | dito |
| UI-06 | Buchhaltung | – | Referenz-Kommentar (kein Test) | dito |
| UI-07 | Mechanismus (OCP) | gruen | **gruen** | dito |
| UI-13 | Sicherungs-Invariante | gruen | **gruen** | dito |
| UI-15 | Mechanismus | gruen | **gruen** | dito |
| UI-19 | Buchhaltung (ueberholt, R-G) | – | Referenz-Kommentar (kein Test) | dito |
| FMT-15 | SOLL x2 | rot x2 | **rot x2** | test/bk1-plan-price-format.test.js |
| GAP-30 | SOLL + Mechanismus | rot + gruen | **rot + gruen** | test/dashboard-i18n-surface.test.js |
| GAP-37 | SOLL (R-G, s.u.) | rot | **rot** | test/render-buildfilter.test.js |

**18 neue Tests (9 rot / 9 gruen) ueber 16 IDs, 5 IDs (UI-01/02/05/06/19) als reine
Buchhaltung, EINE neue Datei (`test/dashboard-i18n-surface.test.js`).** Jeder Testname
beginnt mit seiner Katalog-ID (R-B) — alle 18 wandern automatisch in `npm run test:gates`.

## 2. Abweichungen (R-G)

1. **GAP-37 — die Baseline-Aussage in `18-w2-scope.md`/`19-w2-baseline.md` ist falsch.**
   Beide Dokumente behaupten "`buildFilter` existiert im Repo nicht". Gemessen ist das
   Gegenteil: `render.yaml` traegt `buildFilter:` an zwei Services, `test/render-
   buildfilter.test.js` testet ihn seit W0. GAP-37 wurde deshalb entgegen der Baseline
   **gebaut** (SOLL, rot) statt uebersprungen. Der neue Test widerspricht inhaltlich dem
   Bestandstest "Gateway ignoriert apps/web/**" — genau dieser Widerspruch IST der
   Launch-Befund (baut+serviert derselbe Service apps/web, dann darf er ihn nicht
   ignorieren, sonst deployt ein Frontend-Commit nie). Auf Lauf-Ebene kollidiert nichts:
   der W0-Test bleibt namens-neutral gruen im Regressionslauf, der GAP-37-Test traegt die
   ID und faehrt nur im Gate-Lauf rot.
2. **WEB-10 — Subjekt lebt in einer anderen Datei als im Katalogtitel.** Titel nennt
   `api-onboard.js` (0 `PUBLIC_URL`-Treffer dort); die tatsaechliche Belegstelle ist der
   Checkout-Handler in `src/self-service-routes.js` (`POST /api/self-service/billing/
   setup-checkout`), dieselbe Funktion, die zwei Zeilen weiter `plan_unconfigured`/
   `already_subscribed` als stabile Codes liefert. WEB-10 wurde als SOLL (rot) gebaut,
   nicht als gruener Ist-Pin — ein gruener Pin auf `"PUBLIC_URL fehlt"` waere der GAP-27-
   Defekt selbst gewesen.
3. **UI-03/UI-19 — Praemisse `navigator.language` ist seit P13/E4 tot.** UI-03 wurde zur
   heute tragfaehigen Aussage umformuliert ("kein Betrachter-Sprachsignal im ausgelieferten
   Widget" — 0 Treffer ueber alle 15 Sprachfassungen x 5 Widgets, gemessen). UI-19 ist
   gegenstandslos (Byte-Stabilitaet je Sprache pinnt bereits `T-i18n-server-locale`) →
   Buchhaltung, kein Test.
4. **WEB-03/WEB-25/UI-01/02/05/06 waren teilweise schon gepinnt.** WEB-03s Redirect-/
   Query-/SPA-Haelfte pinnen drei Bestandstests in `single-origin-serving.test.js`; nur
   die "englische App-Shell"-Haelfte war ungetestet (neuer Test gegen `App.astro`).
   WEB-25s Bestandstest (GB/IE -> "en") ist falsch-gruen-anfaellig (waere auch nach
   Loeschen der Tabellenzeilen gruen, weil der Weltdefault ebenfalls "en" liefert) — der
   neue Test faehrt beide Flip-Stellungen und beweist die Tabellen-Verankerung ueber ein
   Kontrastland (US, tabellen-fremd). UI-01/02/05/06 sind woertlich durch bestehende
   `T-i18n-*`-Tests abgedeckt → Referenz-Kommentar statt Duplikat.

## 3. Nebenbefund fuer den Report (kein Fix hier, R-A verbietet ihn)

`apps/web/test/settings.test.js` pinnt die abgedriftete Frontend-Feldliste
`["agentName","allowCalendar","allowBooking","language"]` woertlich als "Backend-Vertrag
(self-service.js)" — ein gruener Test, der die GAP-30-Divergenz aktiv zementiert und im
Root-`npm test` (Glob `test/*.test.js`) gar nicht mitlaeuft. Fix-Auflage fuer die
Folge-Phase.

## 4. Offene Fix-Auflagen

1. GAP-37-Widerspruch aufloesen: entweder der Gateway baut/serviert `apps/web` nicht mehr,
   oder `ignoredPaths` verliert den `apps/web/**`-Eintrag — beides gleichzeitig ist falsch.
2. `apps/web/test/settings.test.js` auf den echten Server-Feldkatalog nachziehen (s. §3).
3. Der bestehende gruene Ist-Pin `"4,99 €"` in `test/bk1-plan-price-format.test.js`
   (Test "formatPlanPrice: Cents/100 + de-DE-Lokalisierung") muss nach dem FMT-15-Fix
   (STATIC_FORMAT_LOCALE -> "en-GB") mitgezogen werden — er pinnt bewusst den heutigen
   Vor-Fix-Zustand (Muster UI-09/MCP-06 im selben Katalog: SOLL und Ist stehen nebeneinander).
4. `/api/self-service/state` liefert `privateNumber` bereits maskiert aus (P9), aber kein
   Dashboard (weder `apps/web` noch `public/tenant.html`) zeigt es an (WEB-19).

## 5. Lauf-Zahlen

```
node --check test/dashboard-i18n-surface.test.js          -> keine Ausgabe
node --test test/dashboard-i18n-surface.test.js           -> 6 tests / 2 pass / 4 fail
node --test test/mcp-ui-widget-i18n.test.js               -> 12 -> 17 tests, 17 pass / 0 fail
node --test test/render-buildfilter.test.js                ->  5 ->  6 tests,  5 pass / 1 fail
node --test test/f1-geo-port.test.js                        -> 19 -> 20 tests, 20 pass / 0 fail
node --test test/bk1-plan-price-format.test.js              -> 6 -> 8 tests, 6 pass / 2 fail
node --test test/single-origin-serving.test.js              -> 5 -> 6 tests, 6 pass / 0 fail
node --test test/self-service-error-codes.test.js           -> 1 -> 2 tests, 1 pass / 1 fail
node --test test/web-auth.test.js                            -> 51 -> 52 tests, 51 pass / 1 fail

npm test          -> tests 3312 / pass 3312 / fail 0 (korrigiert 3295/3295/0) VOR der Phase;
                     Regressionslauf (Namensfilter) bleibt danach unveraendert gruen, da alle
                     18 neuen Tests ihre Katalog-ID am Namensanfang tragen und in test:gates
                     wandern.
```

Vorher-Anker (§0 des Plans): `npm test` roh 3312/3312/0 (korrigiert 3295/3295/0),
`npm run test:gates` roh 493/471/22 (korrigiert 98/76/22). Herleitung Gates-Zahlen:
98 + 18 = 116 Tests; 76 + 9 (neue gruene) = 85 pass; 22 + 9 (neue rote) = 31 fail.

## 6. Blast-Radius

Null Produktionswirkung. Kein Produktionscode geaendert (`git diff master..HEAD --name-
only`: nur `test/*`, `package.json`-Kommentarstring, dieser Bericht). Keine neue Env-
Variable (`BASE_ENV` in `test/helpers.js` unberuehrt, R-D). Keine neue Dependency. Kein
Test veraendert Safety-Gates, Disclosure-Satz, Signaturpruefung, Basic-Auth oder Budget-
Pfade. `test/characterization-marking.test.js` bleibt unangetastet (GAP-27-Waechter-
Kompatibilitaet: WEB-13/WEB-10 nutzen `match`/`doesNotMatch` statt `assert.equal` auf
deutschen Text, WEB-08 ebenso).
