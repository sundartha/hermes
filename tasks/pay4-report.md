# Pay4 — Test-Mode-Smoke end-to-end + Report (letzte Pay-Phase)

**Status:** Gate = **PASS** (kein Blocker)
**finalBranch:** `phase/pay4-smoke-fix1`
**Commit (Impl-HEAD):** `508f21cf05c1905fdda280779851825bd13e60ff`
**Tests:** 708/708 gruen (fail 0); +4 Pay4-Offline-Guard-Tests (Baseline 704 + 4)
**Dependencies:** keine neue npm-Dependency (globales `fetch`, Node 22.x)
**Smoke (live, Lead):** Test-Mode-Netz-Smoke **GRUEN** — `smokePass=true`; PaymentIntent `pi_3Tkl9J3QGz3ubjYA00YzmZ3z` `status=succeeded`, `amount_received=500`, `currency=eur`, `capture_method=manual`, `livemode=false`. Dabei ein Skript-Bug gefunden + gefixt (`pm_card_visa`-Klon beim Attach, s. Abschnitt 5a).

---

## 1. Plan (gekuerzt)

Pay4 ist die **letzte** Pay-Phase. Zweck: beweisen, dass `Onboard -> Customer -> payment_method -> Hold -> Capture` im Stripe **TEST-MODE** durchlaeuft, **ohne** Live-Key und **ohne** echten Nummernkauf.

Liefergegenstaende:
1. Smoke-Skript `scripts/smoke-stripe-payment.mjs` — **kein** Teil von `npm test`, nutzt Netz + Test-Key, wird vom **Lead** ausgefuehrt. Fail-closed-Abbruch wenn `STRIPE_SECRET_KEY` nicht mit `sk_test_` beginnt. Schritte: (1) createCustomer (2) `pm_card_visa` attachen + als default setzen (3) `provisionNumber` mit Fake-Provisioner + echtem Stripe-Test (4) belegen `requires_capture -> succeeded`. Ausgabe kompakt, **kein Secret**. Geld als Ganzzahl-Cents.
2. **Offline-Guard-Test**: das Smoke-Skript verweigert `sk_live`-Keys (ohne Netz pruefbar).
3. Report `tasks/pay4-report.md`: was fuer echtes Geld noch fehlt.

### Pre-Mortem (1 Jahr spaeter, Pay4 war falsch)

- **Risiko A — versehentlicher Live-Charge.** Skript laeuft mit `sk_live`-Key, kauft echte Nummer / belastet echte Karte. -> **Entschaerfung:** zweifacher fail-closed Guard (Key-Praefix-Check `sk_test_` als reine Funktion, vom Test geprueft; Fake-Provisioner kauft strukturell nie). `PROVISIONING_ENABLED`/Live-Key bleiben unberuehrt.
- **Risiko B — Secret leakt in Smoke-Ausgabe/Report.** -> **Entschaerfung:** nur opake ids (`cus_`/`pi_`/`pm_`) + Status; Key wird nie geloggt; Fehler nennen nur HTTP-Status. Report enthaelt keine Werte.
- **Risiko C — Smoke landet in `npm test`, macht CI netzabhaengig/flaky.** -> **Entschaerfung:** Skript ist `.mjs` (Glob ist `test/*.test.js`), kein verpflichtendes neues npm-Script; der einzige neue **Test** ist der reine Offline-Guard.
- **Risiko D — Guard-Logik ist ungetestet und bricht still.** -> **Entschaerfung:** Guard als **exportierte reine Funktion** im `.mjs`, vom Offline-Test importiert.

**Blast-Radius:** 1 neue Skript-Datei, 1 neue Testdatei, 1 neuer Report. **Kein** Edit an `src/` (Adapter/Onboarding/Store sind durch Pay1-Pay3 bereits vollstaendig). Kein neues npm-Script (bewusste Nicht-Aenderung an `package.json`, analog `scripts/telnyx-ws-echo.mjs`).

### Load-bearing Detail: `isMain`-Guard

`import { isTestKey }` laedt das `.mjs` als Modul. Damit `main()` beim Import NICHT laeuft (sonst echter Netz-Call/`process.exit` waehrend `npm test`), steht der Top-Level-Aufruf hinter einem Guard:
```js
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((err) => report(false, [`Smoke fehlgeschlagen: ${err.message}`]));
```
Dies ist load-bearing: ohne den Guard wuerde `npm test` haengen/failen.

---

## 2. Implementierungs-Zusammenfassung

Pay4 exakt nach Plan umgesetzt. Drei neue Dateien, **KEIN `src/`-Edit**, keine neue npm-Dependency (224 insertions, 0 deletions, 0 src/-Edits).

- **`scripts/smoke-stripe-payment.mjs`** — beweist `Onboard -> Customer -> payment_method -> Hold -> Capture` gegen Stripe TEST-MODE. Zweifacher fail-closed Schutz: exportierte reine Guard-Funktion `isTestKey` (nur `sk_test_`, nie live) + Fake-Provisioner (kauft strukturell nie). Geld als Ganzzahl-Cents (`SMOKE_AMOUNT_CENTS=500`), Ausgabe nur opake `cus_`/`pi_`-ids + Status, kein Secret. `isMain`-Guard verhindert `main()` beim Import -> `npm test` bleibt netzfrei.
  - **Belegt `requires_capture -> succeeded`** strukturell ueber `provisionNumber`: `placeHold` (`capture_method=manual` + `confirm=true` + `off_session` -> PaymentIntent `requires_capture`) gefolgt von `captureHold` (`/capture` -> `succeeded`). Erreicht die Nummer `active` mit `paymentIntentId`, ist der gesamte Hold->Capture-Zyklus gegen echtes Stripe-Test bewiesen (kein zusaetzlicher PI-Status-Read noetig: `assertOk` im Adapter wirft bei jedem Nicht-2xx, d.h. `active` <=> beide Stripe-Calls 2xx).
  - **`attachTestCard`** isoliert die Test-Karten-Mechanik (attach + default setzen) bewusst nur im Smoke (kein toter Produktionscode im Adapter; in Produktion macht das die Stripe-Checkout-Setup-Session aus Pay1).
- **`test/pay4-smoke-guard.test.js`** — 4 Offline-Tests fuer `isTestKey` (Grenzbedingungen: `sk_test`/`sk_live`/leer/null/undefined/Nicht-String). Importiert NUR die reine Guard-Funktion -> kein Netz, kein Secret, kein `process.exit`.
- **`tasks/pay4-report.md`** — dieser Report inkl. "was fuer echtes Geld noch fehlt".

Dateien:
- Neu: `scripts/smoke-stripe-payment.mjs`
- Neu: `test/pay4-smoke-guard.test.js`
- Neu: `tasks/pay4-report.md`
- Edits an `src/`: **keine**

Verifikation: `node --check` auf beiden neuen Dateien OK; `npm test` 708 pass / 0 fail (Baseline 704 + 4, exakt wie Plan); fail-closed bewiesen (`STRIPE_SECRET_KEY=sk_live_x` -> `smokePass=false`, Exit 1, kein Netz-Call). `package.json`/`package-lock` unveraendert.

### Deviations

1. **Report-Muster nicht aus Datei kopiert:** Der Plan referenziert `tasks/pay3-report.md` und `tasks/pay-chain.md` als Muster; im Impl-Branch existierten diese (vermutlich Session-/Ort-bedingt) NICHT. Report-Struktur daher aus der Plan-Beschreibung (Status/finalBranch/Commit/Tests/Dependencies/Smoke + Abschnitte) aufgebaut. Inhaltlich vollstaendig (alle 4 Pflicht-Punkte "was fuer echtes Geld noch fehlt").
2. **`fakeProvisioner`-Reuse (Plan-Primaerwahl):** aus `test/helpers.js` wiederverwendet (G5/S2: eine Quelle des Test-Doubles) statt Inline-Stub-Fallback. Reines in-memory Test-Double, kein Netz — zulaessig im Skript.
3. **Robusteres `requestNumber`-Handling:** `requestNumber` liefert `{ok, number}` (nicht direkt `{number}`). `main()` prueft `requested.ok` und meldet sonst fail-closed `report(false, …)`, bevor `requested.number.id` verwendet wird (robuster als das destrukturierend annehmende Plan-Snippet). Keine Verhaltensabweichung im Happy-Path.

---

## 3. Safety-Urteil

**APPROVED.** Pay4 ist eine rein additive Phase (3 neue Dateien, 224 insertions, 0 deletions, 0 src/-Edits, 0 neue npm-Dependency). Alle absoluten Regeln intakt.

Kernpunkte:
- **SAFETY-GATES:** unberuehrt. Der Smoke laeuft strukturell durch `provisionNumber` inkl. fail-closed Money-Safety; kein neuer Geld-Endpunkt, nur node-Skript; Fake-Provisioner -> kein echter Kauf. `sk_live` fail-closed abgewiesen.
- **DISCLOSURE:** byte-identisch (`claude.js`/`bridge.js` nicht im Diff).
- **AUTH FAIL-CLOSED:** kein Auth-/Route-/Signatur-Code beruehrt; Skript-Guard `isTestKey` nur `sk_test_`, erste Anweisung in `main()`, unabhaengig als fail-closed bewiesen.
- **SECRETS:** `STRIPE_SECRET_KEY` nur im Bearer-Header; `report()`/Fehler nur opake ids + HTTP-Status; mit `sk_live` unabhaengig getestet -> nie ausgegeben.
- **PAYMENT_ENABLED bleibt DER Gate**, Flag-aus byte-identisch; Geld als Ganzzahl-Cents; kein `sk_live`, kein echter Nummernkauf.

Unabhaengiger Test-Lauf (frischer Worktree `review-pay4-r1` von `phase/pay4-smoke-fix1`, node_modules-Symlink): **708 pass / 0 fail / 0 skipped / 0 todo**, Dauer ~29s. Beide Backends abgedeckt: JSON-Store (Default, spawn-basierte Integrationstests) UND pg via pglite (`rls-with-check`, `billing-hold-capture`, `tenant-erasure-pg`, `state-ops-tenant-stripe` gruen). Die 4 `isTestKey`-Tests gruen. `node --check` auf beide neue Dateien OK. Fail-closed-Guard unabhaengig verifiziert: `STRIPE_SECRET_KEY=sk_live_SHOULD_NEVER_APPEAR` -> `smokePass=false`, Exit 1, KEIN Netz-Call, der Live-Key wurde NICHT ausgegeben; ohne Key -> ebenfalls Exit 1.

Concerns (kein Blocker):
- **Minor (vom Autor selbst benannt):** `scripts/smoke-stripe-payment.mjs` importiert `fakeProvisioner` aus `test/helpers.js` — ein `scripts/->test/`-Import als leichte Schichtumkehr. Da das Skript nie Teil von `npm test` ist und rein in-memory laeuft, kein Produktions-Impact; G5/eine-Quelle-Argument ist vertretbar. Fallback (Inline-Stub) ist dokumentiert.
- **Out of scope fuer Pay4 (korrekt deferred):** echter Test-Mode-Netz-Smoke mit `sk_test_`-Key, Stripe-Meter-Anlage im Dashboard, `stripe_customer_id`-Lebenszyklus bei Art.17-Erase und SCA/3DS-Recovery-Flow fehlen noch fuer echtes Geld (siehe Abschnitt 6).

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS (kein Blocker).** Pay4-Diff (3 neue Dateien, 0 src/-Edits) ist sauber. Keine S1/S2-Verstoesse.

- **S1 (Blocker):** keine.
- **S2 (schwer):** keine.
- **S3 (mittel):** 2 Hinweise, jeweils **bewusst NICHT geflaggt**:
  - *G33/G5 (grenzwertig)* `attachTestCard`: Die zwei `fetch`-Bloecke teilen das Muster `if (!res.ok) throw new Error(... HTTP ${res.status})`. Pfad/Body/Fehlertext unterscheiden sich aber deutlich (attach vs. set-default); eine Extraktion (`postForm(path, body, label)`) wuerde 2 Aufrufe verkuerzen, aber den linearen Build->Operate-Fluss eher verschleiern. Vorrang Lesbarkeit -> nur S3-Hinweis.
  - *P5/Konvention* `report()`: mischt Command (`console.log`) + Nebeneffekt (`process.exit`). NICHT geflaggt: spiegelt 1:1 die etablierte Schwester-Konvention `scripts/telnyx-ws-echo.mjs:report()`; ein Smoke-Harness als main-Ebene darf terminieren. Nur Konsistenz-Notiz.
- **S4 (niedrig):** 1 Hinweis, bewusst NICHT geflaggt:
  - *Schichtgrenze (G13, grenzwertig)* `scripts/smoke-stripe-payment.mjs`: Skript unter `scripts/` importiert aus `test/helpers.js` (`fakeProvisioner`). Korrekt im Sinne von G5/S2 (eine Quelle des Test-Doubles), aber Skript->test/ kehrt die uebliche Abhaengigkeitsrichtung um. Im Report als bewusste Abweichung inkl. Fallback (3-Zeilen-Inline-Stub) dokumentiert. Akzeptable, begruendete Ausnahme.

Positiv hervorgehoben: Magic Numbers durchweg benannt (`TEST_KEY_PREFIX`, `TEST_PAYMENT_METHOD`, `SMOKE_AMOUNT_CENTS=500` Cents, `*_PATH`). Klare Build->Operate->Check-Gliederung in `main()` mit Schritt-Kommentaren. P15 sauber: Skript = main-Ebene, verdrahtet `stripeBilling`+`fakeProvisioner`+in-memory-State und reicht an `provisionNumber` durch. DIP eingehalten (injizierter Fake-Provisioner kauft strukturell nie). G5/S2 respektiert. `attachTestCard` isoliert Test-Karten-Mechanik (kein toter Adapter-Code, F4/G9). Tests F.I.R.S.T.-konform (kein Netz, kein geteilter Zustand, je ein Konzept). Funktionen kurz, <=3 Argumente, flache Verschachtelung. Kommentare deutsch ohne Umlaute. Geld als Ganzzahl-Cents (kein Float). Secret-Key wird NIE geloggt/zurueckgegeben/in Fehlertexte gespiegelt (nur HTTP-Status + opake `cus_`/`pi_`-ids). `isMain`-Guard verhindert Netz-Call/`process.exit` beim Import. Alle gegen `src/` und `test/helpers.js` geprueften Signaturen stimmen (`provisionNumber`, `stripeBilling.createCustomer/placeHold/captureHold`, `registerTenant`, `requestNumber{.ok,.number.id,.reason}`, `setTenantStripe`, `NUMBER_STATUS.ACTIVE`, config-Felder).

Top-Todos (nicht-blockierend):
- Optional (S3): wenn `attachTestCard` waechst, `postForm(path, body, label)`-Helper fuer die zwei `fetch`+ok-Checks erwaegen — solange es den linearen Fluss nicht verschleiert.
- Optional (S4): falls die Schichtumkehr Skript->`test/helpers.js` spaeter stoert, den dokumentierten 3-Zeilen-Inline-Stub-Fallback ziehen.

---

## 5. Fix-Runden

**0 inhaltliche Fix-Runden.** Eine Review-Runde (r1) brachte drei vermeintliche Blocker, die auf dem Impl-Branch (`phase/pay4-smoke`, HEAD `508f21c`) jedoch **NICHT reproduzierbar** waren: sie wurden gegen einen STALE Snapshot des Codes erzeugt (vor den Pay1/Pay2-Commits `7de8631` und `84b67f4`, die genau diese Punkte bereits behoben hatten). Es wurde nichts geaendert. Gate war effektiv im ersten validen Durchlauf PASS (Safety APPROVED, Clean-Code PASS mit nur S3/S4-Kleinkram). `finalBranch = phase/pay4-smoke-fix1`.

---

## 5a. Live-Smoke-Ergebnis (Lead, echtes Stripe-Test)

Vom Lead mit `sk_test_…` aus `.env` gefahren (`node scripts/smoke-stripe-payment.mjs`):

```
smokePass=true
  customer=cus_UkFeRNdTOitR99
  paymentIntent=pi_3Tkl9J3QGz3ubjYA00YzmZ3z
  numberStatus=active (erwartet: active)
  betrag=500 Cents eur (Hold->Capture durchgelaufen)
```

Direkter PI-Read zur Bestaetigung: `status=succeeded`, `amount=500`, `amount_received=500`,
`currency=eur`, `capture_method=manual`, `livemode=false`. Damit ist
`Onboard -> Customer -> payment_method -> Hold -> Capture` end-to-end gegen echtes
Stripe-Test bewiesen; die urspruengliche 400-Wurzel (`confirm` ohne `payment_method`) ist
weg.

**Gefundener + gefixter Skript-Bug (Wurzel statt Symptom):** Erster Lauf scheiterte mit
`set default_payment_method ... HTTP 400`. Empirische Diagnose (Stripe-Fehlerbody, kein
Raten): `pm_card_visa` ist ein GETEILTES Test-Token, das Stripe **beim Attach klont** —
jeder Attach liefert eine NEUE `pm_…`-id. Das Skript speicherte aber das Token selbst
(`pm_card_visa`), das NICHT am Customer attached ist -> Folgeaufrufe (default-PM,
off_session-charge) klonen erneut eine unattached PM -> 400. **Fix:** `attachTestCard`
liest die echte attachte id aus dem Attach-Response und nutzt/speichert diese (fuer
default-PM + `setTenantStripe` + spaeteres `placeHold`). `npm test` weiter 708/708 gruen
(reine Skript-Aenderung, `isTestKey`/Guard unberuehrt).

Relevanz fuer Produktion: in Pay1/Pay3 entsteht die echte, attachte `pm_…`-id ueber die
Stripe-Checkout-Setup-Session (`getCheckoutSessionResult` liest `setup_intent.payment_method`)
— dort tritt das Klon-Problem NICHT auf (kein geteiltes Token). Der Bug war
smoke-spezifisch.

---

## 6. Was fuer ECHTES Geld noch fehlt

Pay4 beweist den Stripe-**Test-Mode**-Zyklus (Fake-Provisioner, `pm_card_visa`, kein echter Kauf, kein Live-Key). Fuer den produktiven Geld-Fluss steht weiterhin aus — jeweils eine eigene Phase, NICHT Pay4:

- **Live-Key + echter Nummernkauf:** `sk_live` + `PROVISIONING_ENABLED=true` + echter Nummernkauf (heute bewusst aus). Das ist KEIN reiner Env-Flip — der Smoke nutzt einen Fake-Provisioner; der reale Kauf-Pfad muss separat gegen echte Provider gefahren werden.
- **Stripe-Dashboard-Meter:** die P6b3-Meter (`voice_minutes`/`ai_tokens`/`number_months`) muessen im Stripe-Dashboard angelegt sein, sonst schlaegt `reportMeter` fehl (Owner-Smoke noetig).
- **`stripe_customer_id`-Reife/Lebenszyklus:** Customer-Loeschung bei Tenant-Erase (Art.17), pg-Persistenz (heute via `flushTenants`), Recycling.
- **SCA/3DS-Edge (`authentication_required`):** `off_session`-Charge kann bei echten Karten 3DS verlangen (`pm_card_visa` tut das nie) — der Capture-Pfad braucht dann einen Recovery-Flow.

**Lead-Anleitung fuer den echten Test-Mode-Netz-Smoke** (mit `sk_test_…` in `.env`, Netz):
```
node scripts/smoke-stripe-payment.mjs
```
Erwartet: `smokePass=true` + `customer=cus_…`, `paymentIntent=pi_…`, `numberStatus=active`, `betrag=500 Cents eur` — **kein** Secret in der Ausgabe.

Fail-closed-Probe (ohne Netz, jederzeit):
```
STRIPE_SECRET_KEY=sk_live_x node scripts/smoke-stripe-payment.mjs
```
Erwartet: `smokePass=false` + Zeile "… KEIN sk_test_-Key (fail-closed, nie live)", Exit 1, kein Netz-Call.
