# Phasenreport P5 — Herkunfts-Achse der Tarifierung

**Titel:** Wurzel der Geld-Kette — Tarifierung haengt an Ziel UND Herkunft, nicht mehr nur am Ziel
**Gate:** PASS
**finalBranch:** `phase/i18n-p5-herkunfts-achse-v2`
**headCommit:** `940fa62`
**Basis:** `master` = `71a07fe` (P1/P2/P3/P4/P9 gemergt)

---

## 1. Ausgangslage / Problem

`tariffCentsPerMin(to)` entschied den Minutensatz bisher NUR anhand des Ziels: traegt `to` eine
bekannte Inlands-Vorwahl (`+49`/`+33`/`+44`), gab es den guenstigen Inlandssatz — unabhaengig
davon, von welcher DID aus tatsaechlich angerufen wurde. Live traegt praktisch jeder Tenant eine
US-DID; ein Anruf US-DID → deutsches Ziel wurde damit faelschlich zum Inlandssatz (20 ct/min)
statt zum Auslands-Worst-Case (300 ct/min) bepreist — eine strukturelle Unterberechnung an der
Wurzel der Geld-Kette (ORIG-01/02/03 im i18n-Launch-Testkatalog).

---

## 2. Plan (gekuerzt)

**Vorab-Messung (isolierte `git archive`-Probe, kein geschaetzter Wert):**

| Lauf | vorher (master) | nachher (probe) |
| --- | --- | --- |
| `npm test` | 3081 / 0 rot | 3091 / 0 rot |
| `npm run test:gates` | 77 Tests, 26 gruen, 51 rot, 39 rote Katalog-IDs | 74 Tests, 25 gruen, 49 rot, 36 rote Katalog-IDs |

Rot-Delta exakt: `ORIG-01`, `ORIG-02`, `ORIG-03` weg; neu rot genau eine weitere Blattzeile unter
der bereits roten ID `GAP-33` ("es fehlen 3.00 EUR" = 300 ct x 3 min gegen 600 ct) — die von der
Owner-Fassung angekuendigte ehrliche Zwischenlage, keine neue rote ID.

**Kern-Entscheidungen (D1–D11):**

- **D1** — `tariffCentsPerMin(to, from)`: zwei Positionsparameter, `Function.length === 2` als
  Abnahmekriterium (ORIG-01). Kein Objekt-Parameter (haette `length === 1`).
- **D2** — fail-closed strukturell: fehlende/nicht-string Herkunft trifft keinen Praefix →
  teuerster Satz. Kein reparierbarer `if (!from)`-Sonderpfad.
- **D3** — "Inland" = GLEICHE bekannte Inlands-Vorwahl an BEIDEN Enden. Nicht "beide irgendwo in
  der Liste" (sonst `+49→+33` = Inland) und nicht "gleiches Land" allgemein (sonst `+1→+1` =
  Inland — fuer `+1` ist kein Inlandssatz gemessen). `US→US` bleibt Ausland — beabsichtigt,
  gepinnt, zugleich Grund fuer die haertere GAP-33-Rotfaerbung.
- **D4** — `isDomesticLeg` teilt NICHT `matchesPrefix` (kennt `"*"`-Wildcard des Land-Gates; bei
  `ALLOWED_COUNTRY_CODES="*"`, Live-Zustand, waere sonst jedes Ziel weltweit "Inland").
- **D5** — `domesticPrefixOf` liefert den TREFFER, nicht bool (Bestandsmuster `deniedPrefix`).
- **D6** — Richtungs-Weiche in `metering.js`, nicht `outbound-gates.js`: die eigene DID steht
  richtungsabhaengig an verschiedenen Enden (outbound: `call.from`; inbound: `call.to`). Umgesetzt
  als `callTariffCentsPerMin(call)` — EINE Quelle fuer Buchung UND Reconcile (G5).
- **D7** — Inbound: eigene DID an BEIDEN Enden (`tariffCentsPerMin(call.to, call.to)`) — B2-Auflage.
  Ein unbedingter Inlandssatz waere eine ~15-fache Unterberechnung fuer US-DID-Tenants gewesen.
- **D8** — `cost-calibration.js` (Drift-Waechter) zieht mit: `isDriftSample` verlangt Praefix an
  BEIDEN Enden, nur das reine Praedikat `hasCountryPrefix` importiert (kein `tariffCentsPerMin`,
  per Regex-Test P5-12 gepinnt). Getragenes Risiko: live (alle DIDs US) meldet der Waechter
  dauerhaft `insufficient_samples`.
- **D9** — `tariffCentsPerMin` bleibt in `outbound-gates.js` (kein Umzug nach `billing/tariff.js`
  — Import-Churn in 6 Dateien ohne Verhaltensgewinn).
- **D10** — kein neues Env, keine neue Dependency, keine geaenderte Zahl.
- **D11** — Direction-Literal `"inbound"` statt neuer Konstante (Bestandsmuster folgen).

**Umfang:** Produktionscode 3 Dateien (`outbound-gates.js`, `metering.js`, `cost-calibration.js`)
+ 2 Kommentar-Dateien (`config.js`, `.env.example`), ~25 effektive Zeilen. Kein neues/entferntes/
umsortiertes Gate.

**Deploy-Auflage (bereits im Plan festgehalten):** P5 darf NICHT allein live gehen — zwischen P5
und P7 kann ein Tenant mit Standard-Budget gar nicht mehr telefonieren (GAP-33 haerter rot). Erst
zusammen mit/unmittelbar vor P7 deployen.

---

## 3. Implementierung — Zusammenfassung

**Produktionscode:**

- `src/telephony/outbound-gates.js`: neu `hasCountryPrefix(number, prefix)` (exportiert,
  fail-closed bei Nicht-String), `domesticPrefixOf(number)` (Treffer statt bool),
  `isDomesticLeg(to, from)`. `tariffCentsPerMin(to, from)` jetzt mit `Function.length === 2`,
  `from` ohne Default. Gate `compute_reserve` reicht `ctx.fromNumber` durch (garantiert gesetzt,
  da `resolve_outbound` in der Kette davorsteht und ohne aktive Tenant-Nummer 403 gibt).
- `src/billing/metering.js`: neu `callTariffCentsPerMin(call)` — outbound `(call.to, call.from)`,
  inbound `(call.to, call.to)`. Beide Aufrufstellen (`recordVoiceMinuteMeter`,
  `reconcileOutboundVoiceBudget`) nutzen sie; LCT-P2-Invariante (ein Ausdruck, ein Wert, erst
  buchen dann persistieren, keine Rundung pro Inkrement) bleibt woertlich unangetastet.
- `src/billing/cost-calibration.js`: `isDriftSample` verlangt Praefix an beiden Enden, importiert
  `hasCountryPrefix`, nicht `tariffCentsPerMin`.
- `src/config.js` + `.env.example`: nur Kommentar-Wahrheit nachgezogen, kein Wert geaendert.
  `render.yaml` unberuehrt.

**Tests:**

- `test/cost-origin-axis.test.js` (neu, 10 Tests, offline/Fake-Store, Katalog-IDs im Namensrumpf
  statt am Anfang → laufen in `npm test`, Auflage A3): Vorbedingung Satz-Ungleichheit, ORIG-01
  (`Function.length === 2`), Inland nur bei gleicher Vorwahl an beiden Enden (inkl. `+33`-Ziel
  von `+49`-DID und `US→US`), fail-closed (undefined/null/fehlendes Argument), ORIG-02
  (US-DID→DE-Ziel = Auslandssatz), Gegenprobe DE-DID→DE-Ziel, ORIG-03 doppelt (Inbound US-DID =
  Default, Inbound DE-DID = Inlandssatz), Reserve==Buchung ueber das echte `compute_reserve`-Gate,
  Richtungs-Weiche `callTariffCentsPerMin`.
- `test/orig-01-05-cost-origin.test.js`: auf die gruene Charakterisierung `ORIG-05` reduziert;
  `ORIG-01/02/03` als Sachverhalt in die neue Datei uebernommen (R5-Nachziehpflicht), toter Code
  (Imports/Helfer/Konstanten) entfernt.
- Drei Mitzieher: `test/cost-calibration.test.js`, `test/metering-unit.test.js`,
  `test/pay-04-starter-reserve-charakterisierung.test.js`.
- Acht Bestandsdateien mit Fixture-Wahrheit (neue Konstante `DOMESTIC_TEST_NUMBER` in
  `test/helpers.js`, EINE Quelle statt sechsfach): `outbound-reserve-gate`,
  `outbound-reserve-backstop`, `outbound-reserve-release-success`,
  `outbound-reserve-concurrency-http`, `outbound-reconcile-finishcall`,
  `finishcall-billing-once`, `max-duration-rearm`, `telnyx-p6-boot-rearm`.
- `test/prod-config-smoke.test.js` und `PLAN-I18N-FIX.md`: byte-identisch, absichtlich
  unangetastet (B1/B3).

**Messung (Impl-Report, gemessen):**

```
npm test              -> 3091 / 3091 gruen, 0 rot, Exit 0
npm run test:gates     -> 74 Tests, 25 gruen, 49 rot, Exit 1 (gewollt)
```

Rot-Delta gegen Baseline exakt wie vorhergesagt: `ORIG-01/02/03` verschwinden, neu nur
`GAP-33: Outbound ins Inland ...` (Fehlertext woertlich "es fehlen 3.00 EUR").

**Smoke ohne echten Anruf:**

1. Manueller Smoke gegen echten Serverprozess: identisches `POST /api/calls` auf `+4915112345678`,
   nur Absender-DID variiert. DE-DID (`+4930111222333`) → 20 ct/min × 3 = 60 ct, Gate passiert bis
   Originate (500 Twilio-Trial). US-Default-DID (`+15005550006`) → 400 ct/min × 3 = 1200 ct, 402
   "es fehlen 2.00 EUR".
2. `test/prod-config-smoke.test.js` (in der Suite enthalten): US-DID → `+4915112345678` liefert
   402 "es fehlen 3.00 EUR" = 300 ct/min × 3 min gegen 600 ct — der geforderte Beleg und zugleich
   die zweite rote GAP-33-Blattzeile.

**Deviations (aus dem Impl-Report):**

1. Getragenes Risiko (D8): Tarif-Drift-Waechter meldet live dauerhaft `insufficient_samples`,
   solange jede Tenant-DID US ist — nicht alarmierbar, aber sichtbar.
2. Getragen: Abrechnung laufender Anrufe aendert sich ab Deploy (US-DID→DE-Ziel: 20→300 ct/min).
   Absicht, nicht Nebeneffekt; nicht rueckwirkend.
3. Getragen: `GAP-33` wird haerter rot — von der Owner-Fassung woertlich vorhergesagt, Aufloesung
   in P7. Keine neue rote Katalog-ID.
4. Getragen (D3): `US→US` bleibt Ausland — kein gemessener `+1`-Inlandssatz. Zahlenfrage ist P7.
5. Getragen (D9): `tariffCentsPerMin` bleibt in `outbound-gates.js`, kein Umzug.
6. **Deploy-Auflage, nicht automatisierbar:** P5 darf NICHT allein live gehen. Zwischen P5 und P7
   kann ein Tenant mit Standard-Budget (600 ct) gar nicht mehr telefonieren. Empfehlung: P5
   mergen, aber erst gemeinsam mit/unmittelbar vor P7 deployen. Ebenfalls offen: Kosten-Reconcile
   gegen echten Telnyx-Beleg, A6 (`/healthz`-Commit-Check).
7. Worktree-Artefakt: selbstreferenzierender `node_modules`-Symlink (ELOOP) liess den ersten
   `npm test`-Lauf mit Exit 194 abbrechen; auf den echten Repo-Pfad umgebogen, danach lief alles.
   Gitignored, nicht committet.

---

## 4. Safety-Urteil (final)

**Verdikt: FREIGABE** (`approved: true`, keine Blocker).

- **Safety-Gates intakt:** Kein Gate hinzugefuegt/entfernt/umsortiert/aufgeweicht. Diff in
  `outbound-gates.js` besteht aus genau zwei Hunks (Tarif-Helfer, `compute_reserve`); keine Zeile
  mit `numberGateError`/Land-Gate/Stundenlimit/Budget/Max-Dauer/`safeEqual` beruehrt. Neue
  Inlands-Menge ist eine echte TEILMENGE der alten — der gebuchte Satz kann nur steigen oder
  gleich bleiben, nie sinken. Strukturell unmoeglich, dass das Budget-Gate dadurch blind wird.
- **Offenlegung intakt:** `claude.js`/`bridge.js`/`locales.js` — Diff von 0 Zeilen.
- **Auth fail-closed intakt:** kein neuer Endpunkt, kein Auth-Pfad im Diff.
- **Keine Secrets geleakt:** keine neue `console`/`log`/`process.env`-Zeile im src-Diff.
- **Scope eingehalten:** 19 Dateien, 1 neu, keine neue Dependency, `render.yaml` unveraendert,
  `.env.example` nur Kommentar. `PLAN-I18N-FIX.md` und `prod-config-smoke.test.js` byte-identisch
  belassen (B1/B3 eingehalten — kein "Testabschalten, um GAP-33 gruen zu halten").
- **Unabhaengiger Testlauf (frischer Worktree, 940fa62):** `npm test` 3091/3091 gruen (Delta +10
  exakt = neue Testdatei), `npm run test:gates` 74/25 gruen/49 rot, Rot-Delta exakt aufgeklaert
  (−3 ORIG, +1 GAP-33-Blattzeile). Beide Store-Backends (json+pg) gruen.
- **Pre-Mortems durchgespielt:** vergessener Aufrufer → strukturell durch `Function.length===2`
  + fail-closed real gegen `undefined`/`null`/`Number`/`Object` geprueft (immer 300 ct). Reserve
  vs. Buchung end-to-end verifiziert (`ctx.fromNumber` = `api-calls.js`-Persistenz =
  `callTariffCentsPerMin`-Ruecklesen). Inbound mit 0 bepreist trat NICHT ein — inbound-Pfad ist
  logisch identisch zu master.

**Concerns (kein Merge-Blocker, aber festgehalten):**

1. **Deploy-Gate:** mit ausgelieferten Live-Werten (jede DID US) friert Outbound praktisch
   komplett ein (auch Inland), reproduziert (GAP-33 kippt gruen→rot). P5 nicht allein deployen,
   nur zusammen mit P7.
2. Abnahmekriterium "Merge-Kommentar mit datei:zeile je Aufrufer" nur teilweise erfuellt in der
   Commit-Message; verifizierte Liste vom Reviewer nachgeliefert:
   - `outbound-gates.js:765` `tariffCentsPerMin(ctx.to, ctx.fromNumber)` — Herkunft = aktive
     Tenant-DID aus `resolve_outbound`.
   - `metering.js:40` `tariffCentsPerMin(call.to, call.to)` — inbound, eigene DID beidseitig.
   - `metering.js:41` `tariffCentsPerMin(call.to, call.from)` — outbound.
   - `metering.js:57` + `:80` `callTariffCentsPerMin(call)`.
   - `cost-calibration.js:60/61` `hasCountryPrefix(call.to|call.from, prefix)` — reines
     Praedikat, kein Tarif-Lookup.
3. `ORIG-04` bleibt offen, blinder Fleck waechst: Drift-Waechter meldet live dauerhaft
   `insufficient_samples` (observe-only, kein Gate betroffen), Kosten-Beobachtbarkeit der
   Inlands-Achse faktisch auf null bis ORIG-04.
4. `test/metering-unit.test.js` bleibt teils tautologisch (unveraendert ggue. master, keine
   Regression) — die nicht-tautologische Pinnung liegt korrekt in `cost-origin-axis.test.js`.

---

## 5. Clean-Code-Audit (final)

**Verdikt: PASS** (`blocker: false`).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (kosmetisch, kein Blocker):**
  - `src/billing/metering.js`, Kommentar bei `reconcileOutboundVoiceBudget` verweist noch auf
    `tariffCentsPerMin` statt `callTariffCentsPerMin` — inhaltlich weiterhin korrekt, aber der
    Name zeigt nicht mehr auf die tatsaechlich aufgerufene Funktion.
- **S4 (kosmetisch, kein Blocker):**
  - `src/billing/metering.js:63` — eine Zeile 110 Zeichen lang, durch Reflow beim Diff entstanden,
    keine Funktionsaenderung.

**Passnotes:** fail-closed-Design konsequent durchgehalten; G5 (Duplizierung) aktiv vermieden
durch geteiltes `hasCountryPrefix`-Praedikat statt Praefix-Logik-Kopie; G26 (Praezision) gewahrt
(Ganzzahl-Cents durchgehend); G31 (zeitliche Kopplung) durch Gate-Reihenfolge tatsaechlich
erzwungen, nicht nur per Konvention dokumentiert. Vollstaendiger isolierter Testlauf des Auditors:
3120/3121 gruen, der eine Einzelausreisser (`finishcall-billing-once.test.js`) reproduzierte sich
im Einzellauf nicht — passt zum in MEMORY dokumentierten vorbestehenden Spawn-Race-Flake dieser
Suite, keine P5-Regression.

**Top-TODOs (nicht blockierend):**

1. Kommentar in `metering.js` (`reconcileOutboundVoiceBudget`) von `tariffCentsPerMin` auf
   `callTariffCentsPerMin` aktualisieren.
2. Lange Zeile in `metering.js:63` bei naechster Beruehrung umbrechen.
3. Kein Blocker — Phase P5 kann gemergt werden.

---

## 6. Fix-Runden

Keine. Beide Reviews (Safety und Clean-Code) kamen im ersten Durchlauf auf PASS/FREIGABE ohne
Blocker; die identifizierten S3/S4-Punkte sind rein kosmetisch und wurden als offene TODOs
festgehalten statt in einer eigenen Fix-Runde nachgezogen.

---

## 7. Ergebnis / Einordnung

P5 korrigiert die Wurzel der Geld-Kette: die Tarifierung eines Legs haengt jetzt an Ziel UND
Herkunft statt nur am Ziel, strukturell fail-closed in die teurere Richtung. Die Aenderung kann
keinen Anruf erlauben, den `master` abgelehnt haette — sie macht die Kosten-Achse ausschliesslich
strenger. Gate = PASS, Freigabe erteilt, keine offenen Blocker. Einzige harte Nebenbedingung:
**P5 darf nicht isoliert deployt werden** — zwischen P5 und P7 (Tarif-Defaults + Budget-Kohaerenz)
friert Outbound unter den ausgelieferten Live-Werten praktisch vollstaendig ein.
