# Phase P9 (f1-p9) - Hold/Kosten pro Land (MINIMAL) - Report

## Status

GATE: **PASS** (beide Reviews: Safety + Clean-Code, je 0 Blocker).
Tests gruen: **837/837** (gesamte Suite, json-Default + pglite-Store-Contract inline).
Isolierter Lauf `test/f1-provisioning-geo.test.js`: **14/14** (4 neue Resolver-Tests + 2 neue Drain-Durchreich-Tests + 8 bestehende).
Fix-Runden: **0**. `node --check` gruen fuer alle geaenderten Dateien.
NICHT committet (Lead committed). PROVISIONING_ENABLED bleibt false, PAYMENT_ENABLED bleibt der Gate.

## Umgesetzte Dateien + Kernentscheidungen

### 1. src/telephony/provisioning-geo.js
Neue reine Funktion `holdAmountForCountry(country, defaultHoldCents)` (Zeile 65):
- Liefert `entry.holdAmountCents`, falls in der schon bestehenden `COUNTRY_SEARCH_PARAMS`-Tabelle (aus P7) fuer das Land gesetzt; sonst den vom Aufrufer uebergebenen `defaultHoldCents`.
- Case-insensitiv (wie `searchParamsForCountry`).
- **Fail-closed**: nicht-ganzzahliger Tabellenwert wirft (kein stiller Float-Hold, R3). Money strikt Integer Cents (`Number.isInteger`-Guard).
- **Keine config-Kopplung im Default** -> Modul bleibt config-arm/testbar; der Default kommt vom Aufrufer (server.js liefert `config.numberSetupFeeCents`).
- Tabelle bekam einen optionalen `holdAmountCents`-Slot (im Header/Kommentar dokumentiert). **Konservativ bewusst KEIN abweichender Wert eingetragen** (FR/GB ohne Wert), bis der reale Telnyx-Preis per Live-Smoke bestaetigt ist.

### 2. src/server.js
- Import `holdAmountForCountry` ergaenzt (Zeile 24).
- `runProvisioningDrain` (~Zeile 1086): per-Job-Hold abgeleitet -
  `holdAmountCents = config.paymentEnabled ? holdAmountForCountry(number?.country, config.numberSetupFeeCents) : undefined`,
  in `opts` gemergt NACH `...moneyOpts` und `...geo`, nur bei vorhandenem Wert. PAYMENT_ENABLED=false -> `undefined` -> kein Money-Pfad -> byte-identisch.
- `recordNumberMonthMeter` (Zeile 580): `costCents` nutzt jetzt denselben per-Land-Wert
  `holdAmountForCountry(number.country, config.numberSetupFeeCents)`, damit das `usage_event`-Ledger (number_month-Meter) nicht vom real gehaltenen/gecaptureten Betrag driftet (Mini-R3 im Ledger).

### 3. test/f1-provisioning-geo.test.js
4 neue Resolver-Tests (DE/FR/GB/unbekannt -> Default, case-insensitiv, null/undefined/leer) + 2 neue P9-Drain-Durchreich-Tests (kein-Geld-Pfad -> undefined; Drain reicht durch).

## Bewusste Abweichungen

1. **Ablage in provisioning-geo.js statt billing/config** (Doc nannte `src/billing/*`, `src/config.js` als P9-Dateien): bewusst - die Land-Tabelle existiert seit P7 dort; ein zweiter Land->Preis-Table in billing/config waere DRY-Verletzung. `placeHold`/`captureHold` nehmen den Betrag bereits als Argument. `config.js` NICHT angefasst (MINIMAL-Scope; kein ENV-Override-Default - falls Owner spaeter ENV-Override will, separate Phase).
2. **Meter-Mitzug (recordNumberMonthMeter)** ist im Doc nicht explizit genannt, war aber zwingend fuer Konsistenz Hold==Ledger - als bewusste Praezisierung umgesetzt und dokumentiert.
3. **Konservativ (Owner-Empfehlung):** Struktur + Resolver gebaut, aber KEIN vom DE-Default abweichender `holdAmountCents` fuer FR/GB eingetragen, bis reale Telnyx-Preise per Live-Smoke bestaetigt sind. P9 ist damit "ableitbar gemacht" ohne unbestaetigte Preis-Annahme. Offene Owner-Frage: ob/welche Laender JETZT schon einen abweichenden Wert bekommen - bewusst leer gelassen, weil das ohne bestaetigten Live-Preis ein neues R3-Risiko waere.

## Invarianten (gehalten)

- **DE byte-identisch**: DE / Land-ohne-Tarif / leer / unbekannt / null / undefined -> Default = `config.numberSetupFeeCents` (Hold UND Meter), identisch zum Bestand.
- **fail-closed**: kein stiller Fallback (Default explizit vom Aufrufer); nicht-ganzzahliger Tabellenwert wirft (kein stiller Float-Hold).
- **PAYMENT_ENABLED=false** -> `holdAmountCents=undefined` -> opts byte-identisch (Spread skippt). PROVISIONING_ENABLED bleibt false -> Dry-Run byte-identisch.
- **Idempotenz-Schloesser** (Queue-Dedup, status===REQUESTED, order_/hold_-Idempotency-Keys), **Hold-vor-Order-Invariante** und **rollbackAfterOrder** UNANGETASTET - P9 aendert nur den Hold-WERT.
- **Sprach-Praezedenz/-Weiterreichung unberuehrt** (reiner Geld-Pfad); keine Offenlegung beruehrt. P9 oeffnet KEIN neues Land (Freischalt-/Land-Gate-Logik unberuehrt).
- **Money strikt Integer Cents**, keine neue npm-Dep, keine Secrets, Kommentare deutsch ohne Umlaute.
- Unveraendert: billing/*, onboarding.js, worker/provisioning.js, Renderer, i18n/locales.js, config.js, Store-Schema.

## Test-Ergebnis

- `npm test`: 837/837 pass, 0 fail (beide Backends).
- `test/f1-provisioning-geo.test.js` isoliert: 14/14 pass.
- Keine pre-existing roten Tests (kein L-CP7-3/g1-Flake in diesem Lauf).
- `node --check` gruen: provisioning-geo.js, server.js, test-Datei.

## Review-Verdikte

- **Safety-Review: PASS** - 0 Blocker. Byte-Identitaet verifiziert (paymentEnabled=false -> undefined -> Spread skippt; paymentEnabled=true + DE/kein Tarif -> Default == moneyOpts-Wert). placeHold und captureHold nutzen denselben Arg -> hold==capture pro Call (R3 cross-country adressiert). Meter auf denselben Resolver -> kein Ledger-Drift. Idempotenz/Hold-vor-Order/Rollback unberuehrt; keine neue Dep; Money Integer.
- **Clean-Code-Review: PASS** - 0 S1/S2. Resolver case-insensitiv, fail-closed Integer-Guard ist HINZUGEFUEGTE Sicherung. Keine Magic Numbers in Prod-Code (Test-Default benannt), kein toter/auskommentierter Code, kein abgeschalteter Check, Verschachtelung <=2, Funktion ~7 Zeilen.

## Offene Punkte / Smoke-Gates

- **HART DEFERRED (eigene spaetere Phase):** Telnyx 429/5xx Retry/Backoff, failed-Job-Reconciliation (R6) - wie in Spec/Plan vorgesehen, bewusst NICHT in dieser Scheibe.
- **Offene Owner-Frage:** ob/welche Laender einen vom DE-Default abweichenden `holdAmountCents` bekommen - erst nach bestaetigtem realen Telnyx-Preis per Live-Smoke (PROVISIONING_ENABLED -> true), sonst neues R3-Risiko.
- **Should (kein Blocker):** Sobald ein Land einen eigenen Tarif bekommt, Test ergaenzen, der `costCents` im usage_event == captureHold-Betrag sicherstellt (R3 im Ledger). Heute mangels Tabellen-Eintraegen noch nicht testbar.
- **Should (S4, mild):** Drain-opts-Montage wird im Test gespiegelt (Charakterisierungs-Spiegel, vor-P9-bestehend) - bei weiterer opts-Erweiterung beide Stellen mitziehen; optional gemeinsamer opts-Builder. Optional praeziserer Tabellenname (z.B. COUNTRY_PROVISIONING), sobald reale Land-Tarife eingetragen werden.
- **Commit:** noch nicht committet (Lead committed).
