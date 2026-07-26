# W2-B5 — Phasenbericht: Provisioning und DID-Lebenszyklus

Basis: `master` (`d872725`), Umsetzung auf Branch `phase/w2-b5-provisioning-did`. Kein
Produktionscode geaendert (nur `test/*`, ein Kommentar-String in `package.json`, der
Per-Run-Wrapper und dieser Bericht).

## 1. Polaritaets-Tabelle — gemessenes Ergebnis je ID

| ID | Art | Katalog-Erwartung 07-22 | gemessen heute | Datei |
|---|---|---|---|---|
| DID-05 | SOLL | rot | **rot** | test/f1-provisioning-geo.test.js |
| DID-08 | Buchhaltung + Charakterisierung | gruen | **Referenz-Kommentar + 1 gruener Test** | test/telnyx-numbers.test.js |
| DID-09 | SOLL + Mechanismus | rot | **1 rot (Tabelle) + 1 gruen (Adapter)** | test/f1-provisioning-geo.test.js / test/telnyx-numbers.test.js |
| DID-11 | Buchhaltung | gruen | **Referenz-Kommentar (kein Test)** | test/f1-provisioning-geo.test.js |
| DID-17 | Mechanismus | gruen | **gruen** | test/tenant-prolif-d-reconcile.test.js |
| DID-19 | Mechanismus | gruen | **gruen** | test/f1-provisioning-geo.test.js |
| GAP-19 | SOLL (2 Achsen) | rot | **rot x2** | test/boot-prod-footguns.test.js / test/outbound-gates-order.test.js |
| GAP-23 | SOLL (2 Achsen) | rot | **rot x2** | test/did-reputation-metric.test.js (neu) |
| GAP-34 | SOLL (2 Achsen) | rot | **rot x2** | test/f1-geo-store.test.js |

**12 neue Tests (8 rot, 4 gruen) ueber 8 IDs, 1 ID (DID-11) als reine Buchhaltung,
EINE neue Datei.** Jeder Testname beginnt mit seiner Katalog-ID (R-B) — alle 12 wandern
automatisch in `npm run test:gates`.

## 2. Abweichungen (R-G) und Plan-Abweichungen

1. **DID-11 wird nicht gebaut** (Buchhaltung). Die Katalog-Assertion
   „`holdAmountForCountry` liefert fuer US/FR/GB/DE identischen Betrag" existiert bereits
   verteilt ueber vier Bloecke derselben Datei (DE ohne Eintrag / FR+GB ohne eigenen Tarif /
   unbekannt+leer / PAY-17 mit ZWEI Sentinels). Ein vierter Test waere dieselbe Assertion (G5).
2. **DID-08 wird geteilt.** Die Body-Haelfte („kein Regulatory-/Bundle-Feld im Order-Body")
   ist woertlich die `deepEqual`-Assertion des Bestandstests -> Referenz-Kommentar. Die
   Fehlerpfad-Haelfte bekommt einen eigenen 422-Block: `orderNumber` ruft `assertTelnyxOk`
   OHNE `attachStatus`, eine Regulatory-Ablehnung traegt deshalb KEINEN `providerStatus`;
   maschinenlesbar bleibt nur `err.providerCode`.
3. **DID-09 wird zweigeteilt** (rot in der Tabelle, gruen im Adapter). Gemessen: kein Eintrag
   in `COUNTRY_SEARCH_PARAMS` traegt `phoneNumberType`, `searchParamsForCountry("US").type`
   ist `undefined`. Der Adapter KANN den Filter (`filter[phone_number_type]` genau dann, wenn
   ein `type` kommt) — die Luecke ist beweisbar eine Tabellen-, keine Adapterluecke.
4. **DID-19 modelliert „Parallelitaet" als zwei gleichzeitig in Arbeit befindliche Nummern in
   EINEM Drain**, nicht als zwei nebenlaeufige `drain()`-Aufrufe: der Memory-Adapter markiert
   `done` erst nach `await handler` — zwei Drains gaeben einen Doppelkauf, der eine
   Eigenschaft des Fakes waere, nicht des Idempotency-Keys.
5. **GAP-19 und GAP-23 tragen je zwei Zusagen -> je zwei Tests** (P14, Muster GAP-09).
6. **GAP-34 erhaelt einen zweiten Block fuer die Land-Ableitung aus der DID-Vorwahl** —
   direkt aus Owner-Entscheidung E2; ohne ihn haette die `country`-Haelfte des ID-Titels
   keinen Test.
7. **PLAN-ABWEICHUNG (GAP-34, Pre-Mortem-Fund waehrend der Umsetzung).** Der Plan sah fuer
   den ersten GAP-34-Block genau zwei Zeilen vor (`AT` als Gegenprobe, `US` als Live-Fall).
   Gemessen ist dieser Block dann **falsch-GRUEN**, wenn `DEFAULT_LANGUAGE` auf `"de"` steht:
   `US` hat keinen Eintrag in `LANGUAGE_FOR_COUNTRY` und faellt auf den Weltdefault — bei
   `"de"` stimmt der Erwartungswert zufaellig mit dem ungeheilten Bestandswert `"de"`
   ueberein. Im In-Process-Test greift der lokale `.env`-Wert (kein `BASE_ENV`, kein Spawn),
   und dort steht der Weltdefault heute auf `"de"`. Ein gruener Test haette den fehlenden
   Backfill zum Sollzustand erklaert (genau Pre-Mortem-Risiko (i)). Behoben durch eine DRITTE
   Zeile `num_fr`: `languageForCountry("FR")` ist ein Tabellen-Eintrag und damit
   flip-unabhaengig — der Block ist jetzt unter BEIDEN Weltdefaults rot. Die US-Zeile bleibt
   als Dokumentation des Live-Falls stehen.
8. **PLAN-ABWEICHUNG (Struktur, verhaltens-erhaltend).** `ACTIVE_PURCHASE_COUNTRIES` wird in
   `test/f1-provisioning-geo.test.js` vom Hold-Abschnitt in den Konstantenblock am Dateikopf
   verschoben. Grund: die Liste hat mit DID-09 einen ZWEITEN Konsumenten im
   Suchparameter-Abschnitt weiter oben bekommen; die Deklaration steht jetzt vor beiden
   Verwendungen (G10), statt dass ein Test auf eine weiter unten deklarierte Konstante
   vorgreift. Reiner Move, kein Wertwechsel, keine Assertion beruehrt.

## 3. Lauf-Zahlen

Alle Zahlen GEMESSEN; die „vorher"-Spalte ist am Branch-Punkt `d872725` erhoben.
Zeilen 1-8 sind rohe `node --test`-Summen einer Datei (`tests / pass / fail`);
Zeilen 9-11 sind die KORRIGIERTEN Summen von `test/i18n-catalog-run.mjs`
(Datei-Wrapper abgezogen).

| # | Befehl | vorher | nachher |
|---|---|---|---|
| 1 | `node --test test/f1-provisioning-geo.test.js` | 18 / 17 / 1 | **21 / 18 / 3** (Bestand GAP-11 + neu DID-05, DID-09) |
| 2 | `node --test test/telnyx-numbers.test.js` | 12 / 12 / 0 | **14 / 14 / 0** |
| 3 | `node --test test/tenant-prolif-d-reconcile.test.js` | 7 / 7 / 0 | **8 / 8 / 0** |
| 4 | `node --test test/outbound-gates-order.test.js` | 25 / 24 / 1 | **26 / 24 / 2** (Bestand OUT-14 + neu GAP-19) |
| 5 | `node --test test/boot-prod-footguns.test.js` | 6 / 6 / 0 | **7 / 6 / 1** (GAP-19) |
| 6 | `node --test test/f1-geo-store.test.js` | 28 / 27 / 1 | **30 / 27 / 3** (Bestand LANG-19 + 2x GAP-34) |
| 7 | `node --test test/did-reputation-metric.test.js` | — (neu) | **2 / 0 / 2** |
| 8 | `node --test test/characterization-marking.test.js` | 9 / 9 / 0 | **9 / 9 / 0** (GAP-27-Waechter unveraendert gruen) |
| 9 | `npm test` (korrigiert) | 3295 / 3295 / 0 | **3295 / 3295 / 0 — unveraendert** |
| 10 | `npm run test:gates` (korrigiert) | 86 / 72 / 14 | **98 / 76 / 22** (+12 Tests, +8 rot) |
| 11 | `node --test --test-reporter=tap "test/*.test.js"` | — | **3393 / 3371 / 22** = 3295 + 98 — der Split verliert und dupliziert nichts |
| 12 | `git diff master --stat -- src public apps scripts render.yaml` | — | **leere Ausgabe** (R-A-Beweis, gegengeprueft statt Stichprobe) |
| 13 | `git diff master --name-only` (inkl. neuer Dateien) | — | 10 Dateien: 7 `test/*.test.js` (davon 1 neu), `package.json`, dieser Bericht, `.claude/workflows/w2-b5-run.js` |

`npm test` bleibt bei exakt 3295, obwohl 12 Tests dazugekommen sind: alle 12 tragen ihre
Katalog-ID am Namensanfang und wandern in den Gate-Lauf. Die neue Datei steuert genau EINEN
`1..0`-Datei-Wrapper bei (Regressionslauf: 16 -> 17 abgezogene Wrapper).

Rechenweg fuer Zeile 10, damit die Korrektur nachvollziehbar bleibt: die ROHE
node-Gate-Summe steigt nur von 484 auf 493 (+9), obwohl 12 Tests dazukommen. Grund: drei
Dateien (`boot-prod-footguns`, `telnyx-numbers`, `tenant-prolif-d-reconcile`) hatten
BISHER keinen einzigen Katalogtest und lieferten im Gate-Lauf je einen leeren
`1..0`-Wrapper; mit ihrem ersten Katalogtest sind sie keine Phantom-Wrapper mehr. Die
abgezogene Wrapper-Zahl faellt deshalb von 398 auf 395 (484-398 = 86, 493-395 = 98).

Fail-Set des Gate-Laufs, woertlich und vollstaendig (22):

```
LANG-19, GAP-05, GAP-15 (x2), LANG-15, OUT-14, VOICE-12, GAP-24,
GAP-06, GAP-08 (x2), GAP-09 (x2), GAP-11                            (Baseline nach B4, 14)
DID-05, DID-09, GAP-19 (x2), GAP-23 (x2), GAP-34 (x2)               (neu, 8)
```

Kein weiterer Fehlschlag, kein Bestandstest gekippt (R-F erfuellt, kein
Flake-Wiederholungslauf noetig — `p5-gate-proof` blieb in allen Laeufen gruen).

**Smoke (best-effort, kein Gate — R-A: es gibt keinen geaenderten Produktionscode, der zu
smoken waere).** Server auf Port 3987 mit der neutralen `BASE_ENV` + `SKIP_TWILIO_SIGNATURE_CHECK=true`:
`GET /healthz` = 200, `POST /voice/incoming` = 200 und liefert unveraendert das
`<Gather language="de-DE">` mit dem Offenlegungssatz als allererstem Satz. Der temporaere
Start-Helfer wurde danach geloescht (nicht committet).

## 4. Nebenbefunde

Gemessen, gehoeren NICHT in diese Phase gefixt (R-A):

1. **`normalize_target` haelt bereits BEIDE Fakten in der Hand.** Das Gate liest die aktive
   DID (`findActiveNumber`) UND das Herkunftsland (`store.tenantGeo`) — und nutzt beides
   ausschliesslich zur Normalisierung des Wahlziels. Danach faellt die Herkunft aus der
   Betrachtung. GAP-19 ist damit keine Datenluecke, sondern eine fehlende Auswertung: der
   Fix braucht keine neue Quelle, nur ein Glied, das die Konstellation bewertet oder
   wenigstens auditiert.
2. **Das Boot-Log kennt den Schalter nicht.** Der Start nennt jede andere Konfig-Inkohaerenz
   als `[boot] Konfig-Warnung: ...` (Tenant-Default-Budget, Deckungsquote, fehlende
   Alarm-SMS), aber `FORCE_NUMBER_COUNTRY` taucht in keiner Zeile auf — auch nicht, wenn es
   dem `PROVISIONING_COUNTRY` widerspricht. Beim Deploy ist nicht sichtbar, dass jeder neue
   Kunde eine auslaendische Rufnummer bekommt.
3. **Kein Land waehlt seine Nummernart.** `COUNTRY_SEARCH_PARAMS` fuehrt FR/GB/US
   ausschliesslich mit `telnyxCountryCode`; `phoneNumberType` ist vorgesehen, aber nirgends
   gesetzt. In den USA entscheidet damit der Telnyx-Default zwischen local, toll-free und
   mobile — drei verschiedene Preis- und Zustellprofile.
4. **Zwischen Kauf und Betrieb liegt kein Gate.** Die Kette
   `requested -> provisioning -> active` kennt keinen Registrierungs-/Verifikations-Zustand:
   `activateNumber` setzt `active` allein aufgrund eines erfolgreichen Provider-Kaufs. Ein
   Regulatory-Bundle, das der Provider noch nicht bestaetigt hat, ist im Store nicht
   abbildbar.
5. **`failureReason` wird klassifiziert, aber nie aggregiert.**
   `src/telephony/failure-reason.js` liefert ein stabiles Token je Call; es gibt im gesamten
   `src/` keine Stelle, die daraus eine Kennzahl je Absender-DID bildet. Der GAP-23-Test
   rechnet die Quote deshalb selbst — genau das ist der Befund.
6. **Der globale Cap sieht keine Karenz.** `requestNumber` zaehlt lebende Nummern, ohne zu
   unterscheiden, ob sie einem aktiven oder einem seit Monaten suspendierten Tenant gehoeren.
   Mit `RELEASE_GRACE_DAYS=0` (Observe-Only-Default) blockiert damit die DID eines toten
   Kontos den Platz eines neuen, zahlenden Signups (DID-17).

## 5. Blast-Radius

Null Produktionswirkung. Kein Produktionscode, keine Env-Variable (`BASE_ENV` in
`test/helpers.js` unberuehrt, R-D geprueft: `FORCE_NUMBER_COUNTRY`, `PROVISIONING_COUNTRY`
und `PROVISIONING_ENABLED=false` stehen bereits dort), keine neue Dependency.

**Geld-/Provider-Sicherheit:** `PROVISIONING_ENABLED` bleibt aus; jeder Provider-Kontakt
laeuft gegen `fakeProvisioner` bzw. `stubFetch` auf `https://telnyx.test` — kein echter
Kauf, keine echte Freigabe, kein Geld. Der DID-17-Test beweist ausdruecklich, dass
`releaseNumber` NIE aufgerufen wird (`prov.log` leer). Die 422-Fixture enthaelt keinen Key;
die bestehenden „kein API-Key in der Meldung"-Assertions bleiben unangetastet.

Der einzige Nicht-Test-Edit ist der Kommentar-String `config._comment_i18nCatalogPattern` in
`package.json` (Buchhaltungs-Ausnahme DID-11 nachgezogen); das wirksame
`i18nCatalogPattern` bleibt unveraendert (`DID` ist bereits Praefix).

`npm test` bleibt gruen, `npm run test:gates` gewinnt 8 rote Launch-Gates — das ist das
Arbeitsergebnis (PLAN-I18N-TESTS.md 4.1), kein Regressionsfang. Deploy-Relevanz: keine.

Kollisionsflaeche fuer parallele Bloecke (Hinweis an den Lead):
`test/f1-provisioning-geo.test.js` (B4 hat dort PAY-17 und GAP-11 angehaengt — die
B5-Edits sitzen additiv daneben, PLUS der Konstanten-Move aus Abweichung 8) und
`test/outbound-gates-order.test.js` (B3 hat dort OUT-03/OUT-22/OUT-28 angehaengt — der
B5-Edit ergaenzt `defaultStore()` um `tenantGeo` und haengt den GAP-19-Block ans Ende von
Abschnitt (b)).
