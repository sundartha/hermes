# Phase GATES-P4: DID-Preis aus der Provider-Antwort (GAP-11)

**Gate:** PASS
**finalBranch:** `phase/gates-p4-did-preis-fix3`

## Hinweis zur Herkunft dieses Laufs

Die Implementierung dieser Phase stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat die Implementierung NICHT neu geschrieben, sondern ausschliesslich Review und
Self-Fix nachgeholt (dualer Review: Safety/Verhalten + Clean-Code, bis PASS).

Gegenstand der Phase: nach der Owner-Reihenfolgen-Entscheidung (Nachtrag 2026-07-28,
Owner-Commit 5904fc1 in `tasks/gates-fix-chain.md`) traegt der Setup-Fee-Hold ab jetzt den
tatsaechlichen DID-Einmalpreis aus der Provider-Antwort statt der bisherigen Tabellen-Pauschale
(GAP-11).

---

## Abnahme

### 1. Gates

`npm run test:gates` auf `phase/gates-p4-did-preis-fix3`: 131 echte Tests, 110 pass, 21 fail.
Beide GAP-11-Gates in `test/f1-provisioning-geo.test.js` sind gruen:

- `GAP-11: der Hold traegt den Preis aus der Provider-Antwort, nicht die Pauschale` (neu gefasstes Gate)
- `GAP-11: Hold, Capture und der number_month-Beleg tragen denselben Betrag (eine Quelle)` (bestehendes Gate, bleibt gruen)

Gegenprobe am Basis-Commit `5fe5980`: dort 22 rote Gates. Diff der roten Testnamen Basis vs.
Branch = genau eine Zeile: das entfallene alte "GAP-11 (SOLL, rot): jedes bespielte Kauf-Land
traegt einen EXPLIZITEN holdAmountCents" — per Spec autorisiert neu gefasst. Kein anderes Gate
hat den Zustand gewechselt, kein vorher gruenes Gate ist rot geworden.

Das neue Gate ist nicht vakuum-gruen: es enthaelt die Vorbedingungs-Assertion
`assert.notEqual(erwartet=92, DEFAULT_HOLD=1234)` und faehrt den echten Orchestrator-Pfad
(`enqueueProvision` + `drainWithGeo` -> `handleProvisionJob`).

### 2. Regression

Branch: `npm test` = 3306 bestanden / 0 rot (exit 0, roher node:test-Zaehler 3327, davon 21
Datei-Wrapper). Basis `5fe5980` im selben Worktree nachgefahren: 3298 / 0.

Wachstum +8 = exakt die 8 neu mitgelieferten Regressionstests:
- 3x `searchNumbers`-Preisparsing in `telnyx-numbers`
- 3x Fallback + 1x `monthlyCostCents`-Persistenz in `f1-provisioning-geo`
- 1x `monthly_cost_cents`-Round-Trip in `store-pg-multitenant`

Zusaetzlich Namensmengen-Diff beider Laeufe gefahren: kein bestehender Test ist verschwunden,
kein neuer roter. Einzige Aenderung an einem Bestandstest ist die Umbenennung
"Hold vor Order: placeHold wirft -> failed, KEIN Provider-Call, KEIN cancelHold" ->
"... KEIN Kauf, KEIN cancelHold" (autorisierter Bereich). Kein Spawn-/Voll-Last-Flake
aufgetreten, daher keine Isolations-Nachfahrt noetig.

### 3. Produkt-Diff (nicht leer, substanziell)

Geaenderte Dateien im Worktree:
- `src/telephony/adapters/telnyx/numbers.js`
- `src/telephony/provisioning-geo.js`
- `src/telephony/ports.js`
- `src/onboarding.js`
- `src/store/state-ops.js`
- `src/store/pg.js`
- `src/db/schema.sql`

`cost_information` reist als Ganzzahl-Mikro-Cent-Preis vom Telnyx-Adapter ueber einen neuen
Port-Typ bis zum Hold, wird ueber die eine Kursquelle aus P2 (`providerToBucketRateMicro`) in
Bucket-Cent umgerechnet, fremde Waehrung wird verworfen statt umgerechnet, und
`monthlyCostCents` wird am Nummern-Datensatz plus in Postgres persistiert (neue nullable Spalte,
ALTER-only wie `country`/`language`) — die Uebergabe an P5 steht.

Fallbacks sind definiert und getestet: kein Preis / fremde Waehrung / Preis 0 -> Pauschale, NIE
0, NIE geraten; beim Monatswert bleibt eine echte 0 gueltig, ein fehlender Wert bleibt ABWESEND
statt 0. Das ist keine Testkosmetik, sondern eine echte Produktaenderung.

Scope-Abweichung geprueft und als unschaedlich bewertet: die Spec nennt fuer P4 drei Dateien
(`telnyx/numbers.js`, `onboarding.js`, `provisioning-geo.js`); der Diff beruehrt zusaetzlich
`state-ops.js`, `pg.js`, `schema.sql` und `ports.js` — erzwungen durch die verbindliche Auflage
"monthly_cost MUSS am Nummern-Datensatz persistiert werden". Keine dieser vier Dateien steht in
einer anderen Phase der laufenden Welle W2 oder in W3.

### 4. Testaenderungen (im autorisierten Rahmen)

Der Nachtrag autorisiert woertlich `prov.log === [] -> ["search:DE"]` in zwei Dateien. In
`test/billing-hold-capture.test.js` wurde zusaetzlich der Testname geaendert
("KEIN Provider-Call" -> "KEIN Kauf") — sachlich korrekt und ausschliesslich verschaerfend.
Beide Dateien pinnen die drei geforderten Zusagen jetzt explizit (kein `order:`-Eintrag, Ausgang
FAILED, kein `cancelHold`), `p4-setup-fee-hold.test.js` hat zwei davon sogar neu dazugewonnen.
Keine Zusage verloren.

---

## Safety-Review — Verdikt und Belege

**verdict: PASS** — alle vier Abnahmepunkte selbst nachgefahren und erfuellt, absolute Regeln
halten. Safety-relevante Kernaussagen:

- Denylist/Land-Gate/Budget/Signaturpruefung unberuehrt.
- Die Reihenfolge ist per Saldo strenger geworden (Karten-Gate und Zustands-Schloss
  `requested -> provisioning` liegen jetzt VOR jedem Provider-Kontakt; ein Retry einer bereits
  laufenden Provisionierung scheitert am Zustandswechsel, bevor Geld bewegt wird).
- `orderNumber` liegt weiterhin strikt hinter dem erfolgreichen Hold.
- Disclosure (`claude.js`/`bridge.js`) unberuehrt, keine neue Route, keine Auth-Aufweichung,
  keine neue Protokollierung, keine Secrets im Diff, keine neue npm-Dependency,
  `package.json` unangetastet, `node --check` auf allen sechs geaenderten JS-Dateien sauber.

Freigabe mit Auflage: wichtigster Restbefund ist die Ledger-Drift (siehe Concerns unten) — P5
muss sie schliessen.

### Concerns (kein Blocker, dokumentiert fuer P5/Folgephasen)

1. **LEDGER-DRIFT (wichtigster Befund):** `src/billing/metering.js:98` bucht
   `recordNumberMonthMeter` weiterhin `holdAmountForCountry(country, numberSetupFeeCents)`,
   waehrend Hold/Capture jetzt den Provider-Einmalpreis tragen. Der gruene Gate-Test
   "Hold, Capture und der number_month-Beleg tragen denselben Betrag" bleibt nur deshalb gruen,
   weil der Default-`fakeProvisioner` (`test/helpers.js:601`) `[{e164}]` ohne `price` liefert —
   im Preis-Pfad ist die dort gepinnte Invariante ab jetzt falsch. Live-Wirkung heute null
   (`PAYMENT_ENABLED=false`). Auflage: P5 muss diese Divergenz explizit schliessen und den
   Gate-Test in den Preis-Pfad heben.
2. **Scope-Abweichung** (siehe oben, geprueft und unschaedlich).
3. **Waehrungs-Kopplung ohne Guard:** `bucketCentsFromProviderPrice` rechnet ueber die eine
   Kursquelle `providerToBucketRateMicro` (P2), der resultierende Betrag wird aber als Hold in
   `config.billing.paymentCurrency` gestellt (`provisioning-orchestrator.js:150`). Dass
   Bucket-Waehrung == `paymentCurrency`, gilt nur per Default-Konvention (eur) und wird nirgends
   geprueft. Mit `PAYMENT_CURRENCY=usd` waere ein stiller Unterbetrag um den Kursfaktor moeglich.
   Empfehlung: Boot-Guard "paymentCurrency == Bucket-Waehrung" in einer Guard-Phase nachziehen.
4. **Produktlogische Spannung in der Owner-Vorgabe selbst** (kein Implementierungsfehler): der
   Nachtrag begruendet die Reihenfolgen-Freigabe mit "der Kunde zahlt sein Abo und sonst nichts /
   die Nummer ist unsere Kosten", waehrend das P4-Soll den Hold auf den Provider-Einmalpreis
   setzt. Faellt bei `PAYMENT_ENABLED=false` nicht auf; Owner sollte vor dem Flip klaeren, welche
   Aussage gilt.
5. **Stille Degradation bei nicht-String-Preisen:** `providerPriceOf` nutzt
   `parseDecimalToMicroCents`, das nur Strings akzeptiert. Liefert Telnyx `cost_information`
   numerisch statt als String, faellt der Preis komplett weg -> Pauschale. Richtung sicher
   (nie 0, nie geraten), aber kein Log-Signal fuer den Verlust. Beobachtbarkeits-Haken bei
   `PROVISIONING_ENABLED=true` empfohlen.
6. **Testaenderung minimal ueber den Buchstaben hinaus:** Umbenennung eines Testnamens in
   `test/billing-hold-capture.test.js`, sachlich korrekt und verschaerfend, aber vom Nachtrag
   nicht woertlich genannt — kein Blocker.
7. **`PLAN-SECURITY.md` nicht fortgeschrieben**, obwohl die Phase eine dokumentierte
   Geld-Invariante praezisiert ("kein Provider-Kontakt ohne Geld" -> "kein Kauf ohne
   reserviertes Geld"). Entscheidung ist in `tasks/gates-fix-chain.md`
   (Owner-Commit 5904fc1) und im Modulkommentar von `onboarding.js` protokolliert. Nachtragen,
   sobald der Geld-Pfad scharf geschaltet wird.

---

## Clean-Code-Audit

**verdict: PASS. Keine S1/S2-Befunde.**

- **s1:** keine
- **s2:** keine
- **s3 (unkritisch):**
  - G20/Verstaendlichkeit · `src/onboarding.js` (Kopfkommentar + R4-Praezisierungs-Block,
    ~30 Zeilen) — sehr lang, wiederholt Teile der Owner-Entscheidungs-Begruendung fast
    wortgleich zum Funktionskommentar von `placeSetupFeeHold`. Koennte bei Gelegenheit auf einen
    Verweis statt Wiederholung gekuerzt werden.
  - N1 · `src/telephony/provisioning-geo.js` — `bucketCentsFromProviderPrice` /
    `holdAmountForProviderPrice` / `monthlyCostCentsForProviderPrice` klar benannt,
    ausdrucksstark, kein Verstoss.
- **s4:** G30 · `src/onboarding.js` `provisionNumber` — Funktion durch die neue Preis-Suche
  etwas gewachsen (Karten-Gate + `beginProvisioning` + Suche + Hold + Order + Activate),
  delegiert aber sauber an `findPurchasableNumber`/`requireTenantCard`/`placeSetupFeeHold`/
  `cancelHoldIfHeld` — bleibt im Rahmen des Bucket-Brigade-Stils des Bestands, kein FLAG.

Der Diff verlagert die Provider-Preissuche sauber vor den Hold (GAP-11-Neufassung), behaelt
aber alle geldtragenden Invarianten bei: Karten-Gate jetzt sogar frueher, kein `orderNumber`
ohne erfolgreichen Hold, kein Kauf bei fehlgeschlagenem Hold, Preis-Waehrungspruefung
alles-oder-nichts, `monthlyCostCents` nullable statt 0. Alle wiederverwendeten Bausteine
(`parseDecimalToMicroCents`, `providerMicroCentsToBucketCents`, `PROVIDER_RATE_SCALE`,
`config.billing.providerCurrency`/`providerToBucketRateMicro`) existierten bereits, keine
Duplizierung. Migration additiv/nullable im etablierten Muster. Genau eine Lese-Stelle
(`hydrateTenantInto`) und eine Schreib-Stelle (`flushNumbers`) fuer die neue Spalte.

Volle Suite (3327 Tests inkl. der 4 neuen GAP-11-Fallback-Tests + Golden-Master-Round-Trip)
lokal auf dem Phase-Branch gruen. Test-Anpassungen pinnen die neue Reihenfolge explizit
dreifach (Ausgang failed, kein `order:`-Log-Eintrag, kein `cancelHold`) statt die alte
Zusicherung nur zu entfernen.

Offene Punkte (kein Blocker): ueberlangen Kopfkommentar in `onboarding.js` (R4-Praezisierung)
bei naechster Gelegenheit kuerzen/auf `placeSetupFeeHold`-Kommentar verweisen statt inhaltlich
zu duplizieren.

---

## Fix-Runden

Keine — dieser Workflow hat den vom abgestuerzten Lauf uebernommenen Stand ohne weitere
Fix-Runde direkt auf PASS gefunden (Safety: PASS, Clean-Code: PASS, keine offenen Blocker).
