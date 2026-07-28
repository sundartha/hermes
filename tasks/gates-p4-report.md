# Phase GATES-P4: DID-Preis aus der Provider-Antwort (GAP-11, neu gefasst)

- **Gate**: BLOCKED
- **finalBranch**: `phase/gates-p4-did-preis-fix2`

## Hinweis zur Herkunft dieses Laufs

Die Implementierung stammt aus einem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat die urspruengliche Umsetzung NICHT neu geplant oder neu gebaut,
sondern nur **Review + Self-Fix nachgeholt**: dualer Review (Safety + Clean-Code)
gegen den vorgefundenen Implementierungsstand, danach zwei Fix-Runden gegen
gemeldete Blocker.

## Abnahme

| Kriterium | Ergebnis | Beleg |
|---|---|---|
| Gates gruen | ja | `npm run test:gates` auf dem Branch: 131 Tests, 110 pass / 21 fail. Beide GAP-11-Tests gruen: der neue Test "GAP-11: der Hold traegt den Preis aus der Provider-Antwort, nicht die Pauschale" (ok 165, faehrt den echten Pfad `drainWithGeo -> provisionNumber` mit Fake-Provisioner/Fake-Billing) und der Bestandstest "GAP-11: Hold, Capture und der number_month-Beleg tragen denselben Betrag (eine Quelle)" (ok 164). Vergleichslauf am Basis-Commit `5fe5980`: 131 Tests, 109 pass / 22 fail. Diff der Rotlisten hat genau einen Eintrag: den entfernten, am Base roten Test "GAP-11 (SOLL, rot): jedes bespielte Kauf-Land traegt einen EXPLIZITEN holdAmountCents" (Base-Datei `test/f1-provisioning-geo.test.js` Zeile 200 — exakt die per Spec zulaessige Neufassung). Kein anderes Gate gekippt, kein Gate zur Bestaetigung des Defekts umgeschrieben (kein VOICE-12-Muster). |
| Regression (`npm test`) | **NICHT gruen** | 3306 Tests, 3304 bestanden / 2 ROT: `test/billing-hold-capture.test.js:59` ("Hold vor Order: placeHold wirft -> failed, KEIN Provider-Call, KEIN cancelHold") und `test/p4-setup-fee-hold.test.js:51` ("exempt + placeHold wirft -> failNumber, KEIN orderNumber"). Beide erwarten `prov.log === []`, sehen jetzt `['search:DE']`. Isoliert nachgefahren (kein Voll-Last-Flake): 13/13 gruen am Base `5fe5980`, 11/13 auf dem Branch — deterministischer Assertion-Fehler in reinen Unit-Tests ohne Server-Spawn. |
| Produkt-Diff nicht leer | ja | 7 Produktdateien im Diff (siehe unten) |
| Testaenderungen zulaessig | **verletzt** | Die Phase verengt die Repo-Invariante R4 ("Hold vor JEDEM Provider-Call") unautorisiert auf "Hold vor jedem GELD-bewegenden Provider-Call" — genau das bringt die zwei Bestandstests zum Kippen. Die Ketten-Regel (`tasks/gates-fix-chain.md`) verbietet das ausdruecklich: "Faellt ein heute gruener Test, der dort nicht genannt ist, ist das ein Blocker: melden, NICHT anpassen. Es gibt keine neuen Ausnahmen." |

**productDiffFiles** (aus dem Safety-Review, Worktree-Pfade):
- `src/db/schema.sql`
- `src/onboarding.js`
- `src/store/pg.js`
- `src/store/state-ops.js`
- `src/telephony/adapters/telnyx/numbers.js`
- `src/telephony/ports.js`
- `src/telephony/provisioning-geo.js`

## Safety-Review (final)

- `approved`: false
- `gatesGreen`: true, `testsPassIndependently`: false
- `productDiffNonEmpty`: true, `testChangesAllowed`: false
- `safetyGatesIntact`: false, `disclosureIntact`: true, `authFailClosedIntact`: true, `noSecretsLeaked`: true
- `scopeRespected`: false, `behaviorAsIntended`: false

### Blocker

1. **Abnahme 2 gerissen** — `npm test` hat `fail=2` statt `fail=0`. Zwei heute gruene Bestandstests des Geld-Pfads sind rot geworden, ohne dass die Phase sie angefasst hat (`test/billing-hold-capture.test.js:59`, `test/p4-setup-fee-hold.test.js:51`). Beide erwarten `prov.log === []` und sehen jetzt `['search:DE']`. Isoliert nachgefahren: 13/13 gruen am Base `5fe5980`, 11/13 auf dem Branch — kein Voll-Last-Flake, sondern deterministisch.
2. **Unautorisierte Aufweichung der Geld-Invariante R4** — `src/onboarding.js:28-47` verengt R4 per Kommentar eigenmaechtig von "Hold VOR jedem Provider-Call" auf "Hold vor jedem GELD-bewegenden Provider-Call (order)". Die P4-Spec (`tasks/gates-fix-chain.md`) autorisiert das nirgends — sie nennt nur "Hold == Preis aus der Provider-Antwort". Genau diese Aufweichung ist das, was die beiden Bestandstests pinnen ("kein Provider-Call ohne reserviertes Geld"). Der Impl-Agent hat die Tests korrekterweise NICHT umgeschrieben, aber die Phase ist damit BLOCKED und braucht eine Owner-Entscheidung: entweder P4 bekommt die beiden Tests ausdruecklich in die "Zulaessige Testaenderung" aufgenommen und die Spec-Passage zu R4 nachgezogen, oder es braucht einen Entwurf, der R4 haelt (z. B. Hold weiter in Hoehe der Pauschale als konservative Obergrenze, Capture dann in Hoehe des Provider-Preises — `captureHold` darf unter dem Hold liegen). Diese Entscheidung darf der Reviewer nicht treffen.

### Concerns

- **Scope**: 4 Produktdateien ausserhalb der P4-Dateiliste (Spec nennt nur `adapters/telnyx/numbers.js`, `onboarding.js`, `provisioning-geo.js`): `src/db/schema.sql`, `src/store/pg.js`, `src/store/state-ops.js`, `src/telephony/ports.js`. Sachlich vertretbar (die bindende Vorgabe "monthly_cost MUSS am Nummern-Datensatz persistiert werden" ist sonst nicht erfuellbar, Eingriffe minimal, kein Wellen-Konflikt), aber ueber die abschliessende Dateiliste hinaus — gehoert in die Spec nachgezogen statt stillschweigend erweitert.
- **Neuer Import-Zyklus**: `src/telephony/provisioning-geo.js -> src/billing/cost-calibration.js -> src/billing/metering.js -> src/telephony/provisioning-geo.js` (`metering.js:9` importiert `holdAmountForCountry`). Laeuft heute nur, weil keine der beteiligten Dateien die Importe auf Modul-Top-Level auswertet. Eine spaetere Top-Level-Konstante waere ein TDZ-Absturz beim Boot.
- **Seam-Drift**: der Kopfkommentar `src/onboarding.js:4` behauptet weiterhin "KEIN config-Zugriff — Parameter werden hereingereicht". Stimmt nicht mehr: `holdAmountForProviderPrice`/`monthlyCostCentsForProviderPrice` lesen `config.billing.providerCurrency` und `providerToBucketRateMicro`.
- **Waehrungs-Kopplung ohne Waechter**: der umgerechnete Betrag ist in BUCKET-Waehrung (EUR ueber `PROVIDER_TO_BUCKET_RATE_MICRO`), gebucht wird er bei Stripe in `config.billing.paymentCurrency` (Default `eur`). Heute deckungsgleich, aber `PAYMENT_CURRENCY != EUR` machte den Hold still zum falschen Waehrungsbetrag. Kein Guard, kein Test.
- **Selbst offengelegtes Restrisiko** (`onboarding.js:42-47`): ein Tenant mit hinterlegter, aber am Hold abgelehnter Karte loest je Provisionierungsversuch einen zusaetzlichen read-only Telnyx-Suchaufruf aus, bevor der Hold scheitert. Nur Provider-Traffic, kein Geldfluss — aber direkte Folge der Umsortierung.

### Verdict (Safety, wörtlich zusammengefasst)

BLOCKED. Die Phase erfuellt Abnahme 1 (Gates), 3 (Produkt-Diff) und in der Sache auch die inhaltlichen P4-Auflagen sehr sauber — sie scheitert an Abnahme 2 und 4.

Was gut ist (kein VOICE-12-Muster): der Gate wurde gruen, WEIL sich das Produkt geaendert hat. `searchNumbers` wirft `cost_information` nicht mehr weg, der Preis reist als geparster `ProviderNumberPrice` (Ganzzahl Mikro-Cent + Waehrung) ueber die Port-Grenze, wird ueber die eine Kursquelle aus P2 umgerechnet und als Hold verwendet; Hold == Capture bleibt eine Zahl; `monthly_cost` landet als `monthlyCostCents` am Nummern-Datensatz UND als additiv-nullable Spalte in Postgres. Alle vier Fallbacks (keine `cost_information` / fremde Waehrung / Preis 0 / unparsbar) fallen auf die Pauschale zurueck, nie auf 0 und nie geraten, und sind getestet. Alles-oder-nichts beim Teilpreis ist die richtige Wahl.

Woran es scheitert: um "Hold == Preis aus der Provider-Antwort" zu erfuellen, muss die Preissuche vor den Hold. Damit faellt die Repo-Invariante R4 ("Hold vor JEDEM Provider-Call") — und mit ihr zwei heute gruene Geld-Pfad-Tests. Der Impl-Agent hat sie ehrlich stehen lassen statt sie umzuschreiben (richtig) und die Verengung ausfuehrlich im Kopfkommentar offengelegt (auch richtig) — aber er hat sie sich selbst genehmigt. Die Ketten-Regel verbietet das ausdruecklich.

Die geld-tragende Kerninvariante "kein `orderNumber` ohne erfolgreichen Hold" haelt weiterhin strikt, das Karten-Gate sitzt sogar frueher als zuvor, und die absoluten Gates (Denylist/Land/Stundenlimit/Budget/Max-Dauer/Signaturpruefung), der Offenlegungssatz und die Auth-Kante sind vom Diff nicht beruehrt — `safetyGatesIntact` steht nur deshalb auf false, weil eine dokumentierte Geld-Sicherungs-Invariante des Provisionierungspfads unautorisiert verengt wurde, nicht weil eines der aufgezaehlten Gates angefasst waere. Keine neue npm-Dependency, kein Secret-Leak, kein neues Logging.

Naechster Schritt (Owner, nicht Agent): entscheiden, ob R4 fuer den read-only Suchaufruf ausdruecklich verengt wird — dann gehoeren die beiden Tests in die "Zulaessige Testaenderung" von P4 und die Spec-Passage zu R4 muss nachgezogen werden — oder ob ein Entwurf gefordert wird, der R4 haelt (Hold weiter ueber die Pauschale als konservative Obergrenze, Capture dann in Hoehe des Provider-Preises). Erst danach ist die Phase mergefaehig.

## Clean-Code-Audit

- `blocker`: true
- **Verdict**: BLOCKER — `npm test` ist auf dem Branch ROT (2 fehlschlagende, nicht im Diff angepasste Bestandstests), verstoesst gegen die harte Repo-Regel "npm test MUSS gruen sein". Die eigentliche Preis-Logik (Telnyx `cost_information` -> Hold/Miete) ist sauber gebaut, gut dokumentiert und mit neuen Tests abgedeckt, aber die Reihenfolgen-Aenderung (Preissuche jetzt VOR dem Hold) wurde nicht gegen alle bestehenden Money-Safety-Tests durchgezogen.

### S1 (Blocker)

- **GATES-P4-S1-1** · `test/billing-hold-capture.test.js:59-75` — Test "Hold vor Order: placeHold wirft -> failed, KEIN Provider-Call, KEIN cancelHold" schlaegt fehl: `prov.log` ist jetzt `['search:DE']` statt `[]`. Ursache: `onboarding.js` ruft seit P4/GAP-11 `findPurchasableNumber()` (`searchNumbers`) VOR `placeSetupFeeHold` auf, aber der Bestandstest wurde nicht an die neue, im Code selbst dokumentierte Reihenfolge angepasst. Verifiziert per `node --test` auf dem realen Branch-Checkout (`bcc79bd`), reproduzierbar. Fix-Optionen: Assertion auf `['search:DE']` aendern + Kommentar praezisieren, oder — falls die alte Reihenfolge fuer diese Baseline erwartet wird — die Reihenfolge revidieren. In jedem Fall darf `npm test` nicht rot gemergt werden.
- **GATES-P4-S1-2** · `test/p4-setup-fee-hold.test.js:51-65` — Test "exempt + placeHold wirft -> failNumber, KEIN orderNumber" schlaegt fehl: `prov.log` ist `['search:DE']` statt `[]`. Identische Ursache wie S1-1. Fix: Assertion auf `['search:DE']` aendern und Kommentarwortlaut pruefen (inhaltlich stimmt "kein Provider-Kauf ohne gestellten Hold" weiterhin — nur die Assertion auf `prov.log` ist zu eng).

### S2

Keine.

### S3 (informativ, kein Verstoss)

- G20/N-Serie · `onboarding.js` — Funktionsnamen wie `requireTenantCard`, `findPurchasableNumber`, `attachNumberPaymentIntent` sagen praezise, was sie tun.
- P8 · `src/telephony/adapters/telnyx/numbers.js:69-79` (`providerPriceOf`) — klare Alles-oder-nichts-Semantik, gut begruendeter Kommentar.

### S4

Keine.

### Top-Todos

1. S1-1 und S1-2 beheben: entweder die zwei betroffenen Bestandstests an die neue, im Code dokumentierte Reihenfolge (Preissuche vor Hold) anpassen, oder die Reihenfolge zurueckdrehen — Entscheidung liegt beim Owner/Autor, aber `npm test` muss danach gruen sein.
2. Vor Merge erneut vollstaendig `npm test` auf dem Phase-Branch laufen lassen (nicht nur die neu hinzugefuegten Testdateien) — dieser Review hat gezeigt, dass ein reiner Diff-Blick auf neue/geaenderte Testdateien die Regression in unveraenderten Nachbardateien nicht gefunden haette.

### Pass-Notes

Fachlich starke Umsetzung: der neue Preis-Pfad (Telnyx `cost_information` -> `providerPriceOf` -> `holdAmountForProviderPrice`/`monthlyCostCentsForProviderPrice`) ist alles-oder-nichts, verwirft Teilpreise und fremde Waehrungen explizit (nie 0 raten, nie stillschweigend umrechnen), nutzt den bereits vorhandenen strikten Money-Parser (`cost-parse.js`) und die bereits vorhandene eine Kursquelle (`providerMicroCentsToBucketCents`) statt Duplizierung. Schema-Migration additiv/nullable mit klarer NULL-vs-0-Semantik (`monthly_cost_cents`). `state-ops.js` trennt `beginProvisioning` (reiner Zustandswechsel) sauber von `attachNumberPaymentIntent` — gut begruendet mit dem Doppelkauf-Fenster-Argument. Neue Tests (telnyx-numbers, f1-provisioning-geo, store-pg-multitenant) sind ordentlich mit Build-Operate-Check aufgebaut und decken Fallback-Faelle (kein Preis, fremde Waehrung, Preis 0) ab. Die Reihenfolgen-Aenderung selbst ist im Code ausfuehrlich begruendet und als bewusste Praezisierung dokumentiert — nur das Nachziehen der zwei Nachbartests wurde versaeumt.

## Fix-Runden

- **r1**: Blocker 1 wurde geprueft, bestaetigt und begruendet NICHT durch eine weitere Testaenderung stillgelegt. Fix: `test/billing-hold-capture.test.js` und `test/p4-setup-fee-hold.test.js` wurden per `git checkout 5fe5980 -- <datei>` exakt auf den Stand vor der Phase zurueckgesetzt (die unautorisierte Aufweichung wurde nicht durch Testanpassung legalisiert).
- **r2**: Alle drei gemeldeten Blocker wurden erneut geprueft und ALLE als strukturell unausweichlich begruendet zurueckgewiesen — exakt wie Runde 1, mit staerkerer, expliziterer Herleitung. Kern des Konflikts: die P4-Spec (`tasks/gates-fix-chain.md`, Abschnitt P4-Soll) traegt eine explizite, dokumentierte Anforderung ("Hold == Preis aus der Provider-Antwort"), die strukturell nicht ohne Verletzung von R4 ("Hold vor JEDEM Provider-Call") umsetzbar ist, solange R4 nicht zugleich fuer den read-only Preis-Suchaufruf gelockert wird. Diese Entscheidung liegt beim Owner, nicht beim Agenten — die Phase bleibt daher BLOCKED.

## Fazit

GATES-P4 ist inhaltlich (Preislogik, Fallback-Verhalten, Schema-Erweiterung, Testabdeckung des neuen Pfads) sauber umgesetzt, scheitert aber an einer echten Zielkonflikt-Situation zwischen der P4-Spec-Anforderung ("Hold == Provider-Preis", erfordert Preissuche vor Hold) und der Repo-Invariante R4 ("Hold vor JEDEM Provider-Call"). Zwei Fix-Runden haben den Konflikt bestaetigt statt aufgeloest, weil die Aufloesung eine Owner-Entscheidung erfordert (R4 explizit fuer read-only Suchaufrufe lockern und die Spec/Tests entsprechend nachziehen, oder einen R4-treuen Entwurf mit Pauschale-als-Obergrenze + `captureHold` unter dem Hold verlangen). Der Branch `phase/gates-p4-did-preis-fix2` bleibt BLOCKED und ist nicht mergefaehig.
