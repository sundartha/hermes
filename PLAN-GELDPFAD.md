# PLAN-GELDPFAD — Behebungskette zum Geldpfad-Vorfall vom 11.09.2026

Stand 2026-09-11. **Ein** Entwurfsdokument fuer die gesamte Kette (nicht eines je Phase), plus
je Phase eine duenne Arbeitsanweisung weiter unten. Dieses Dokument sagt, WAS in welcher
Reihenfolge gebaut wird und WORAN man deterministisch erkennt, dass es fertig ist.

**Herkunft aller Messwerte:** die Zeitstempel, HTTP-Antworten und Betraege des Vorfalls stammen
aus den Render-Logs des Dienstes und dem Stripe-Dashboard vom 11.09.2026. Die Angaben zu
Guthaben, Rufnummern und Bestellungen stammen aus dem Telnyx-Portal desselben Tages. Aussagen
ueber Code stehen ausschliesslich mit Datei und Zeile; was dort nicht belegt ist, steht hier
nicht.

## Der Vorfall, in drei Zeilen

Mandant `t_user_01KXH2B75WJ75W3JYYXDPPSK3R`, Stripe-Kunde `cus_UwasrqbPddbGXh`,
Zahlungsmethode `pm_1TwhhW3d0y9L6Epq2hGs8DO4` vom Typ **`link`** — nicht `card`.

| Zeit (CEST) | Aufruf | Ergebnis |
|---|---|---|
| 09:49:24 | `POST /v1/subscriptions` (business, 9,99 EUR) | 402 `insufficient_funds` |
| 10:31:15 | `POST /v1/subscriptions` (starter, 4,99 EUR) | **200**, Rechnung `IKHKABW9-0020` auf BEZAHLT, "Kein Gutschein angewendet" |
| 10:31:21 | `POST /v1/payment_intents` `amount=92 currency=eur capture_method=manual off_session=true` | 402 `payment_method_provider_decline` / `insufficient_funds` |

Derselbe Zahlungsweg traegt 4,99 EUR und lehnt sechs Sekunden spaeter 0,92 EUR ab. Es ist kein
Deckungsproblem und kein Betragsfehler: der Hold-Betrag ist gegengerechnet (Telnyx
`upfront_cost` "1.00000" USD -> `parseDecimalToMicroCents` -> `providerMicroCentsToBucketCents`
mit `PROVIDER_TO_BUCKET_RATE_MICRO` -> exakt 92 EUR-Cent). Gerechnet ist das mit dem **Default**
920000 (`src/config.js:1107`, dokumentiert in `.env.example:582`, Toleranzband-Anker
`src/boot-guard.js:295`); der Live-Wert ist env-ueberschreibbar, die Rechnung gilt also fuer den
Default und nicht zwingend fuer die Konfiguration des Vorfalls. Der Unterschied ist die
**Transaktionsart**: getrennte Autorisierung und Erfassung statt normaler Zahlung.

Stripe dokumentiert unter `/payments/place-a-hold-on-a-payment-method`, Abschnitt
"Einschraenkungen der Zahlungsmethode", dass getrennte Autorisierung und Erfassung Karten,
Affirm, Afterpay, Cash App Pay, Klarna und PayPal unterstuetzen. **`link` steht nicht auf
dieser Liste.** Link ist eine Wallet ueber Karten, US-Bankkonten und BNPL — ein Bankkonto
traegt nie einen Hold. Dieselbe Seite warnt zusaetzlich, Kartennetzwerke duerften
Kleinstautorisierungen untersagen, die der Haendler nicht einzuziehen gedenkt.

**Eingetretener Schaden:** 4,99 EUR eingezogen, Nummer auf `failed`, der Kunde hat nichts. Das
trifft strukturell jeden Link-Zahler, nicht nur diesen Mandanten.

**Telnyx war unbeteiligt.** `/v2/number_orders` enthaelt fuer den 11.09. keine Bestellung. Das
Guthaben war mit 1,79 USD bei drei aktiven Rufnummern zu je 1 USD Monatsmiete der **naechste**
Blocker, nicht dieser — es ist am selben Tag auf 6,79 USD aufgeladen worden (Abschnitt 3.1).

## 0. Reichweite

**Drin:** Sichtbarkeit des Zustands "zahlender Mandant ohne Nummer", der Ablehnungsgrund des
Holds als Diagnose UND als Steuerinformation, die Eignungspruefung der Zahlungsmethode vor dem
Hold, der ereignisgetriebene und der zeitgesteuerte Wiederanlauf nach einem gescheiterten Hold,
die Korrektur eines nachweislich falschen Kommentars im Geldpfad, und ein Waechter gegen
Preis-Drift zwischen Katalog und Stripe.

**Bewusst DRAUSSEN, weil Geschaeftsentscheidung, nicht Code-Korrektur:** die Frage, ob ein
Vollpreis-Kunde die Einrichtungsgebuehr zahlt, und ob die Befreiung weiter an der
Rechnungssumme (`invoiceTotal===0`, `src/billing/stripe.js:421`) haengen soll. Der Befund steht
in Abschnitt 3 als Owner-Blocker; gebaut wird in dieser Kette nur die Kommentarkorrektur
(GP-P5), die kein Verhalten aendert.

**Nicht baubar, weil an fremden Konten oder Geld:** Telnyx-Guthaben, die
Nachweisdokumente fuer `+4921194289148`, und die Erstattung oder Nachlieferung fuer den
Kunden des Vorfalls. Diese drei stehen in Abschnitt 3 als Owner-Blocker, nicht als Phase.

## 1. Reihenfolge und ihre Begruendung

Die Reihenfolge ist nicht Geschmack. Sie folgt aus zwei Saetzen, die beide am Code belegt sind
und beide im Pre-Mortem (Abschnitt 2b) wiederkehren:

1. **Wer den Zahlungsweg aendert, bevor er ihn beobachten kann, aendert ihn blind.** Dieser
   Vorfall wurde ausschliesslich durch manuelle DB-Forensik sichtbar. Geht GP-P2 in einem
   Randfall daneben, ist das Ergebnis wieder ein stiller zahlender Kunde ohne Nummer — und
   wieder merkt es niemand.
2. **Ein Wiederanlauf, der nicht enden kann, ist kein Fix, sondern ein Kostenvektor.**
   `occupiesCapacity` (`src/store/state-ops.js:2569`) zaehlt `failed` und `released` nicht zur
   Kapazitaet, und die Idempotenz-Schluessel haengen an der `numberId`
   (`order_${numberId}` `src/onboarding.js:126`, `hold_${numberId}` `src/onboarding.js:269`).
   Jeder Neuanlauf erzeugt also eine neue `numberId` mit frischen Schluesseln und stoesst nie
   an `MAX_NUMBERS_PER_TENANT` — genau den Deckel, der laut Owner-Entscheidung E10 gegen
   DID-Vermehrung uebrig ist.

Die Spalte **Groesse** steuert den Zuschnitt des Laufs und bestimmt zugleich `maxFixRounds`
vollstaendig — der Lead hat dort keinen freien Parameter mehr:

| Groesse | Zuschnitt | `maxFixRounds` |
|---|---|---|
| `S` | wenige Dateien, ein Testfile, eine Nahtstelle | `1` |
| `M` | zwei bis drei Nahtstellen (z.B. Store-Feld plus Route plus Test), aber ein Thema | `2` (= Skript-Default, `.claude/workflows/phase-impl-lean.js:75`) |
| `L` | mehrere Nahtstellen ueber Adapter, Store und Aufrufer hinweg; volle Behandlung | `3` |

Mehr Runden heissen nicht "gruendlicher": laeuft eine Phase in die letzte Runde, ist der
Phasenschnitt falsch, nicht das Budget. Ein sauberes BLOCKED ist dann das richtige Ergebnis.

| Phase | Titel | Groesse | Warum an dieser Stelle |
|---|---|---|---|
| GP-P0 | Sichtbarkeit: zahlender Mandant ohne Nummer | S | Bewegt kein Geld, loest keinen Anruf aus, beruehrt keine Absolute Regel — und schliesst den schwersten Teil des Befunds sofort: dass heute niemand je erfaehrt, dass ein Kunde zahlt und nichts bekommt. Gleichzeitig das einzige Instrument, das spaeter beweist, ob GP-P2 in Produktion gewirkt hat |
| GP-P1 | Ablehnungsgrund: Diagnose UND Steuerung | S | Offline, rein, billig. Liefert die Information, die im Vorfall fehlte, und die getypte Klassifikation, ohne die GP-P4 "strukturell nie erfolgreich" nicht von "temporaer ungedeckt" unterscheiden kann. Zuerst, damit messbar ist, dass sich die Ablehnungsklasse nach GP-P2 tatsaechlich aendert |
| GP-P2 | Eignung der Zahlungsmethode statt blosser Existenz | L | Die tatsaechliche Codestelle des Bugs. `requireTenantCard` heisst schon heute wie ein Eignungs-Gate und ist eines nicht |
| GP-P3 | Wiederanlauf nach Kartenwechsel + Versuchsdeckel | M | Ohne GP-P2 eine Schleife, die nichts kauft und Provider-Suchen verbrennt. Ohne den Deckel ein Umgehungsweg um `MAX_NUMBERS_PER_TENANT`. Beides muss vorher liegen |
| GP-P4 | Zeitgesteuerter Wiederanlauf | M | Braucht zwingend die GETYPTE Klassifikation aus GP-P1 und den Zaehler aus GP-P3. Ein blinder Zeit-Sweep gegen eine strukturell unfaehige Zahlungsmethode verbrennt Versuche und erzeugt dabei neue Nummern-Datensaetze |
| GP-P5 | R4-Kommentar auf das korrigieren, was der Code tut | S | Reine Kommentarkorrektur, kein Verhalten. Getrennt von GP-P2, weil beide in die Hold-/Settle-Kette greifen: landen sie zusammen, ist eine Geld-Regression nicht mehr zuzuordnen |
| GP-P6 | Preis-Waechter Katalog gegen Stripe | M | Als einziger Befund rein latent: kein aktueller Defekt, kein Kunde betroffen, kein Geld falsch geflossen. Ihn vor die real eingetretene Kaputtheit zu ziehen, waere eine Fehlallokation |

**Gilt fuer jede Phase:**

- Eine Phase gilt erst als fertig, wenn ihr Abnahmekriterium (unten, deterministisch) erfuellt
  ist UND `npm test` gruen bleibt. Rot in `npm run test:gates` oder `npm run test:abnahme` ist
  erlaubt — das sind Launch-Baenke, keine Regressionsbaenke.
- **Jede neue Env-Variable wird neutral in `BASE_ENV` (`test/helpers.js`) gepinnt**, sonst leakt
  die echte `.env` in jeden Spawn-Test (Lehre `test-base-env-drift`). Die Kette fuehrt genau
  fuenf ein. Name und Default stehen hier, damit keine Phase eine Groesse erfindet und kein
  Abnahmekriterium eine unbenannte Frist voraussetzt; alle fuenf gehoeren zusaetzlich in
  `.env.example` (Konvention `CLAUDE.md`):

  | Env | Phase | Default | Wofuer |
  |---|---|---|---|
  | `PAID_WITHOUT_NUMBER_GRACE_MS` | GP-P0 | `3600000` (1 h) | wie lange ein aktiver Subscriber ohne Live-Nummer bleiben darf, bevor der Selektor ihn meldet |
  | `PROVISIONING_RETRY_MAX_ATTEMPTS` | GP-P3 | `3` | Versuchsdeckel je Mandant; erschoepft -> `needs_manual_reconcile` |
  | `PROVISIONING_RETRY_MIN_INTERVAL_MS` | GP-P4 | `86400000` (24 h) | Mindestfrist zwischen zwei automatischen Anstoessen desselben Mandanten (Entprellung) |
  | `PRICE_DRIFT_MIN_INTERVAL_MS` | GP-P6 | **`86400000` (24 h)** — Owner-Entscheidung 2026-09-11, Frage 12 | Mindestabstand zweier Preis-Pruefungen. Der Waechter haengt weiter im Stunden-Sweep, prueft aber nur einmal am Tag: Stripe-Preise aendern sich seltener als Telefonie-Konfiguration, und jede Pruefung ist ein Anbieter-Aufruf |
  | `PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER` | GP-P6 | `3` | aufeinanderfolgende `unknown`-Laeufe, bevor der Waechter die eigene Unwissenheit meldet |

  Die Defaults sind begruendete Vorschlaege, keine Messwerte: 1 h, weil der Sweep im
  Stunden-Takt laeuft und eine kuerzere Frist nur Rauschen meldet; 24 h, weil ein
  stuendlicher Wiederanlauf einen Deckel von 3 in drei Stunden verbrennt; drei `unknown`-Laeufe,
  weil ein einzelner Netzfehler keine Betreiber-Meldung wert ist, ein dauerhaft fehlendes
  Read-Scope aber sehr wohl (Frage 13: Scope im Testmodus belegt, Live wahrscheinlich). Wer sie
  aendern will, aendert einen Env-Wert, keinen Code.
- **`src/billing/stripe.js` wird sequenziell angefasst.** GP-P1 (`assertOkClassified`/
  `billingErrorFor`), GP-P2 (`getCheckoutSessionResult`/`getSubscriptionCheckoutResult`) und
  der Owner-Blocker aus Abschnitt 3 (`retrieveSubscription`) beruehren dieselbe Datei in
  verschiedenen Funktionen. Kein inhaltlicher Konflikt, aber ein Merge-Risiko bei
  Parallelbetrieb.

## 2. Die Phasen

### GP-P0 — Sichtbarkeit: zahlender Mandant ohne Nummer

**Ausgang, gemessen.** Der Vorfall vom 11.09. wurde ausschliesslich durch manuelle DB-Forensik
sichtbar. Kein Log, keine Mail, kein Dashboard-Signal meldet den Zustand "aktives Abo, keine
Live-Nummer". Der Klassifikator des Boot-Sweeps ueberspringt den Fall per Konstruktion:
`if (job.status !== PROVISIONING_JOB_STATUS.QUEUED) continue` (`src/store/state-ops.js:3080`)
— und `test/prov01-classify.test.js:65` pinnt dieses Verhalten ausdruecklich als gewollt.

**Auftrag.** Ein **reiner Selektor** im Muster von `classifyQueuedProvisioningJobs` findet
aktive Subscriber, die laenger als `PAID_WITHOUT_NUMBER_GRACE_MS` keine Live-Nummer haben, und
meldet je Zustandsaenderung **genau eine** Log-/Audit-Zeile ueber die bereits geteilte
Eskalations-Primitive `meldeBetreiberNotiz`. Der Selektor laeuft als weiterer unabhaengiger
Zweig im bestehenden Stunden-Takt — kein neuer Timer, keine neue Ressource. **Beobachtung, keine
Handlung:** diese Phase kauft nichts und stoesst nichts an.

**Belegte Stellen.**
- `src/store/state-ops.js:3080` — `classifyQueuedProvisioningJobs` ignoriert alles ausser `QUEUED`
- `test/prov01-classify.test.js:65` — Fall (vii) pinnt "done/failed-Job wird ignoriert"
- `src/store/views.js:123` — `FAILED`-Enum, Kommentar "Retry noetig (Fix C)", nie umgesetzt
- `src/boot.js:1084` — Muster fuer einen unabhaengigen Zweig im Stunden-Sweep (`runSweepTick`)
- `src/telephony/outage-report.js:122` — `meldeBetreiberNotiz`, bereits von zwei Waechtern geteilt
- `src/worker/provisioning-orchestrator.js:202,204` — wo der Fehlerzustand heute endet: DB-Feld plus eine `console.error`-Zeile, sonst nichts

**Abnahmekriterium.** Ein Test-Mandant mit aktivem, verifiziertem Abo
(`tenantActiveSubscriber===true`) und genau einer Nummer im Status `failed`:
1. Ein Sweep-Lauf erzeugt fuer diesen Mandanten **genau einen** Befund-Datensatz.
2. Ein zweiter Lauf ohne Zustandsaenderung erzeugt **keinen weiteren** (Entprellung).
3. Positiv-Kontrolle im selben Test: ein Mandant mit aktiver Nummer erzeugt **null** Befunde —
   sonst misst der Test einen Selektor, der alles meldet.
4. Ein Mandant ohne aktives Abo erzeugt **null** Befunde.

**Verifikationsmethode.** Neuer `node:test` nach dem Muster `test/prov01-classify.test.js`:
reiner Klassifikator, `state` rein, `nowMs` injiziert, kein Server-Spawn, kein Netz. Der
tatsaechliche Mailversand wird NICHT in `node:test` verifiziert — er bleibt fail-soft wie
`probeMailBoot`; dafuer genuegt der Rauchtest beim ersten realen Lauf.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Kein automatischer Kauf, kein
Wiederanlauf, kein Stripe-Call, kein Dashboard-Text, keine Aenderung an `provisionNumber` oder
an irgendeinem Gate. Die Trennung Beobachtung/Handlung ist bewusst (Muster: der `hold`-Korb in
`reconcileOrphanedProvisioning`).

**`highStakes`: `false`** — reiner Selektor, bewegt kein Geld, loest keinen Anruf und keine SMS
aus.

---

### GP-P1 — Ablehnungsgrund des Holds: Diagnose UND Steuerung

**Ausgang, gemessen.** Im Render-Log des 11.09. steht als einzige Spur
`Stripe placeHold fehlgeschlagen: HTTP 402` — ohne `decline_code`. Der geparste Stripe-Koerper
wird nicht aus Versehen verworfen, sondern per explizitem Verweis auf Regel 4:
`src/billing/stripe.js:157` sagt "nur Code/Typ werden uebernommen (Regel 4)". Diese Begruendung
ist zu breit. Regel 4 schuetzt Secrets — und die liegen ausschliesslich im Request-Header, wie
der Kommentar an `src/billing/stripe.js:165` selbst festhaelt. `error.code`,
`error.decline_code` und `error.type` sind kontrolliertes Stripe-Vokabular, kein Geheimnis.

Die Klassifikation, fuer die Stufe 2 gebaut wurde, ist fuer `placeHold` ausserdem tot: ihr
einziger Aufrufer faengt generisch (`src/onboarding.js:272`), und der einzige
`instanceof`-Konsument im ganzen Repo (`src/billing/card-setup.js:50`) fragt
`CustomerMissingError` ab, nie `PaymentAuthenticationRequiredError`.

**Auftrag.** `assertOkClassified` liest weiterhin nur den geparsten Body, liefert den
Ablehnungsgrund aber **zweimal**: als schmales **getyptes Feld** am Fehlerobjekt (fuer
Steuerung, ohne dass je jemand Freitext parsen muss) UND als festen Enum-Anhang an
`failureMessage()` (fuer Menschendiagnose in Log und `lastError`). Die Whitelist ist genau
`error.code` / `error.decline_code` / `error.type` — feste Enums, nie Freitext, nie
verschachtelte Objekte wie `payment_intent`, `payment_method` oder `billing_details`. Im selben
Zug werden zwei nachweislich falsche Kommentare korrigiert: `src/billing/stripe.js:157`
(Regel-4-Begruendung zu breit), `src/billing/stripe.js:139-141` (Behauptung, die Message sei in
allen drei Zweigen dieselbe — nach diesem Fix ist sie es nicht mehr) und
`src/self-service-routes.js:224` (behauptet "op+Status, kein Secret", waehrend bei
Stufe-3-Aufrufern der volle Provider-Rohtext an `.message` haengt).

**Belegte Stellen.**
- `src/billing/stripe.js:139-141` — Kommentar: Message in allen drei Zweigen identisch
- `src/billing/stripe.js:156-159` — Stufe 2, `assertOkClassified`; `failureMessage()` bekommt kein drittes Argument
- `src/billing/stripe.js:165-168` — Stufe 3, `assertOkWithDetail`; Begruendung nennt Secrets, nicht PII
- `src/billing/stripe.js:205` — `placeHold` ist der einzige Aufrufer von Stufe 2
- `src/onboarding.js:272` — `catch (holdErr)`, generisch, kein `instanceof`
- `src/billing/card-setup.js:50` — einziger `instanceof`-Konsument im Repo
- `src/worker/provisioning-orchestrator.js:202` — `err.message` wird zu `job.lastError`
- `src/worker/provisioning-orchestrator.js:204` — Fundstelle des Live-Log-Satzes
- `src/store/state-ops.js:3037`, `src/store/pg.js:2491` — `lastError` ist ein dauerhaftes DB-Feld, nicht nur eine Log-Zeile
- `src/self-service-routes.js:224,232` — der Kommentar behauptet etwas Falsches; Zeile 232 ist die Stelle, an der der Stufe-3-Rohtext tatsaechlich ins Log faellt
- `test/pay-19-sca-authentication-required.test.js:14` — "ein Freitext ist kein Vertrag"
- `test/billing-hold-capture.test.js:64` — pinnt nur `/HTTP 402/`, keinen exakten Text

**Abnahmekriterium.** Ein simulierter `placeHold`-402 (Muster `makeStripeStub`) mit dem Body
`{error:{code:'card_declined', decline_code:'insufficient_funds', type:'card_error',
message:'Your card was declined.'}}`:
1. Der geworfene Error traegt ein **getyptes Feld** mit genau diesen drei Enum-Werten.
2. Seine `.message` enthaelt sowohl `HTTP 402` als auch `decline_code=insufficient_funds`.
3. **Positiv-Kontrolle:** derselbe Body zusaetzlich mit `error.payment_method.billing_details.email`
   — diese E-Mail taucht **weder** in `.message` **noch** in `job.lastError` auf.
4. **Struktur-Waechter** (Muster: die drei Waechter aus SEC-P6): kein Modul unter `src/` liest
   `err.message` per `includes`/`match`/`indexOf` zur Steuerung; Ausnahmen stehen mit
   Begruendung in einer im Test hartkodierten Liste. Positiv-Kontrolle: ein synthetischer
   Zusatz macht den Waechter rot.

**Verifikationsmethode.** Neuer `node:test` nach dem Muster
`test/pay-19-sca-authentication-required.test.js` — `makeStripeStub`, rein offline, kein Netz,
kein Stripe-Konto. `test/billing-hold-capture.test.js:64` bleibt unveraendert gruen (die
Substring-Pruefung `/HTTP 402/` bricht nicht). Kein Smoke-Test noetig: die Phase aendert keine
Request-Form.

**Zusatzauftrag, Owner-Entscheidung 2026-09-11 (Frage 6).** Der bestehende
Stufe-3-Rohtext-Pfad bei `createSubscription` wird **in dieser Phase mitgefixt**, nicht auf
spaeter vertagt. `src/self-service-routes.js:232` schreibt den vollstaendigen Stripe-Fehlerkoerper
in `console.error` — mit Name, E-Mail und Anschrift des Kunden. Genau daraus stammt die Diagnose
vom 11.09., und genau deshalb ist der Pfad belegt und nicht theoretisch. Er faellt auf dieselbe
schmale Enum-Ausgabe zurueck, die diese Phase ohnehin baut. Der falsche Kommentar an `:224`
wird dabei korrigiert.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Kein Wechsel von `placeHold` auf
Stufe 3, kein Rohtext an `.message` oder in die DB, keine Aenderung am `placeHold`-Body, keine
Aenderung an den Fehlerklassen in `src/billing/errors.js`. Der Zusatzauftrag oben ist eine
**Verengung** des Protokollierten, nie eine Erweiterung: wo heute mehr steht, steht nachher
weniger.

**`highStakes`: `false`** — die Phase liest einen bereits geparsten Fehlerkoerper, aendert keine
Request-Form, kein Gate und keine Geldrechnung; sie fuegt ein Feld und einen Enum-Anhang hinzu.
Die PII-Positiv-Kontrolle aus Punkt 3 ist trotzdem hartes Abnahmekriterium und darf
nicht als "nice to have" behandelt werden: `lastError` landet dauerhaft in Postgres.

---

### GP-P2 — Eignung der Zahlungsmethode statt blosser Existenz

**Ausgang, gemessen.** `requireTenantCard` (`src/onboarding.js:223-230`) prueft ausschliesslich
Existenz: `if (!card.customerId || !card.paymentMethodId)`. Der Store kennt vom Zahlungsmittel
nur die opake Id — `setTenantStripe` (`src/store/state-ops.js:2243`) nimmt genau
`{ customerId, paymentMethodId }` entgegen, `tenantStripe` (`:2255`) liefert genau diese beiden
Felder. **Ein Typ-Feld existiert nicht**, weder im Schema noch an einer Schreibstelle.
`placeHold` (`src/billing/stripe.js:178-206`) sendet deshalb fuer jede gespeicherte Id dieselbe
Form (`capture_method=manual`, `confirm=true`, `off_session=true`) und nimmt damit implizit an,
jede hinterlegte Zahlungsmethode koenne Autorisierung und Erfassung trennen. Stripe
dokumentiert fuer `link` das Gegenteil.

Zwei Praezisierungen, am Code nachgesehen, die die Umsetzung sonst ins Leere laufen lassen:
- `getCheckoutSessionResult` (`src/billing/stripe.js:287`) expandiert **nur**
  `expand[]=setup_intent` (`:288`) und liest `json.setup_intent.payment_method` als **String-Id**
  (`:294`). Der
  Typ ist dort nicht vorhanden; der Expand muss auf `setup_intent.payment_method` vertieft
  werden.
- `getSubscriptionCheckoutResult` (`src/billing/stripe.js:351`) expandiert bereits
  `subscription.default_payment_method` und traegt das PM-Objekt wirklich. Dort wirft
  `paymentMethodIdOf` (`src/billing/webhook.js:230`) den Typ weg.

Eine Leseseite braucht also eine Request-Aenderung, eine nicht.

**Auftrag.** Den Typ der Zahlungsmethode an der Quelle festhalten, ueber **eine einzige
gemeinsame Bind-Funktion** persistieren (erzwungene Konstruktion statt Disziplin an vier
Stellen), und `requireTenantCard` von einer Existenz- auf eine echte Eignungspruefung heben.
Die Pruefung ist eine **Allowlist** bekannter hold-faehiger Typen, niemals eine Denylist gegen
`link`: alles Unbekannte faellt fail-closed durch, mit einer Meldung, die den Typ-Grund nennt
statt einer Stripe-Rundreise und eines generischen `insufficient_funds`.

Die naheliegende Praevention `payment_method_types` in den beiden Checkout-Aufbauten ist
**nicht Teil dieser Phase** — sie haengt an einem Dashboard-Schritt des Owners und steht als
vierter Blocker in Abschnitt 3.1. Grund fuer die Trennung: der Auftrag "setze es" und die
Abgrenzung "nicht vor dem Dashboard-Schritt" machten "fertig" fuer einen Agenten
unentscheidbar, und der Fehlerfall ist genau Pre-Mortem 4 (jeder Abo-Abschluss scheitert,
Umsatz still auf null).

**Belegte Stellen.**
- `src/onboarding.js:223-230` — `requireTenantCard`, reine Existenzpruefung
- `src/onboarding.js:90` — `requireTenantCard` ist der allererste Schritt vor jedem Provider-Kontakt
- `src/onboarding.js:254-262` — `placeSetupFeeHold` reicht `customerId`/`paymentMethodId` unveraendert durch
- `src/billing/stripe.js:178-206` — `placeHold`, identische Form fuer jede Id
- `src/billing/stripe.js:142-158` — `billingErrorFor` kennt keinen Zweig fuer "traegt keine getrennte Autorisierung"
- `src/billing/stripe.js:262-280`, `:314-339` — beide Checkout-Aufbauten ohne `payment_method_types`
- `src/billing/stripe.js:288` — Expand nur `setup_intent`; `:294` — `payment_method` wird als String-Id gelesen
- `src/billing/stripe.js:351` — Expand `subscription.default_payment_method`, PM-Objekt vorhanden
- `src/billing/webhook.js:230` — `paymentMethodIdOf` extrahiert nur die Id, ein `type` geht verloren
- Vier Schreibstellen fuer `paymentMethodId`: `src/billing/card-setup.js:79`,
  `src/billing/subscribe.js:180`, `src/billing/subscribe.js:203`, `src/billing/webhook.js:441`
- Eine Loeschstelle: `src/billing/card-setup.js:53` (`{customerId:null, paymentMethodId:null}`)
- `src/store/state-ops.js:2243-2249` — `setTenantStripe` kennt nur zwei Felder
- `src/store/state-ops.js:2255-2259` — `tenantStripe` liefert nur zwei Felder
- `test/p4-setup-fee-hold.test.js:29` — deckt exempt/nicht-exempt und Hold-Fehler ab, keinen Typ-Fall
- `test/gap-05-number-hold.test.js:26` — pinnt "Hold ist Pflicht auch bei 100-Prozent-Gutschein"

**Abnahmekriterium.** Vier getrennte Teile — Bindepfad und Provisionierungspfad sind
verschiedene Objekte und werden getrennt geprueft:
1. **Bindepfad, je realer Schreibstelle ein Fall:** nach `card-setup.js:79`,
   `subscribe.js:180`, `subscribe.js:203` und `webhook.js:441` traegt der Mandant ein
   **nicht-null** `paymentMethodType`. Der Loeschpfad `card-setup.js:53` nullt den Typ
   mit. Zusaetzlich ein **Adapter-Fixture-Test** gegen `getCheckoutSessionResult` — er prueft
   die Adapterfunktion selbst statt eines Fakes und ist das einzige Gegenmittel gegen
   Pre-Mortem 2. Drei Pruefsaetze, jeder als Aufruf-liefert-Y:
   - Fixture in der **heutigen unexpandierten** Antwortform (`setup_intent.payment_method` ist
     eine String-Id, `src/billing/stripe.js:294`): `getCheckoutSessionResult(sid)` liefert die
     Id unveraendert wie heute **und** `paymentMethodType === null` — kein `undefined`, kein
     Wurf.
   - Fixture mit **expandiertem** PM-Objekt (`setup_intent.payment_method =
     {id:'pm_x', type:'card'}`): derselbe Aufruf liefert dieselbe Id **und**
     `paymentMethodType === 'card'`.
   - Die vom Adapter **abgesetzte Request-URL** enthaelt `expand[]=setup_intent.payment_method`.
     Ohne diesen dritten Satz sind die ersten beiden auch dann gruen, wenn der Expand nie
     vertieft wurde — und genau dann ist das Typ-Feld in Produktion dauerhaft `null`.
2. **Provisionierungspfad:** `setTenantStripe(..., {paymentMethodType:'link'})` fuehrt dazu,
   dass `provisionNumber` `billing.placeHold` **nie** aufruft (`callCount===0`), die Nummer
   kontrolliert auf `failed` wechselt und die Fehlermeldung den Typ-Grund nennt, nicht
   `insufficient_funds`. Derselbe Aufbau mit `'card'` bleibt **byte-identisch** zum heutigen
   Verhalten (`placeHold` wird wie bisher aufgerufen).
3. **Allowlist-Negativtest:** ein frei erfundener Typ `'xyz_wallet'` wird abgelehnt. Ohne
   diesen Fall ist die Allowlist-Eigenschaft nicht gepinnt und der naechste Edit weicht sie
   still zu einer Denylist auf.
4. **Null-Politik und GAP-05:** das Verhalten bei `paymentMethodType===null` (jeder heutige
   Bestands-Mandant, additiv-nullable ohne Backfill) ist ausdruecklich entschieden und als Test
   gepinnt — Default fail-closed. Zusaetzlich ein Regressionsfall wie
   `test/gap-05-number-hold.test.js`: ein per Gutschein befreiter Mandant mit hold-unfaehiger
   Methode scheitert **vor** dem Hold, nicht danach.

**Verifikationsmethode.** `node:test` nach dem Muster `test/p4-setup-fee-hold.test.js`
(Fake-Billing um `paymentMethodType` erweitert) und `test/gap-05-number-hold.test.js`. Reine
State-/Fake-Tests, kein echter Stripe-Call.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Keine Aenderung an
`settleSetupFeeHold` und an der Capture-vs-Cancel-Entscheidung — das ist eine andere
Pipeline-Stufe (Abschnitt 3, Owner-Blocker). **Kein `payment_method_types` im Code, Punkt** —
weder vor noch nach dem Dashboard-Schritt; dieser Vorgang ist vollstaendig aus der Kette
herausgeloest und liegt in Abschnitt 3.1. Schlaegt ein Agent ihn vor, ist das ein Blocker, kein
Detail. Kein Backfill bestehender Mandanten ohne Owner-Antwort. Keine
Sofortbuchung-statt-Hold — das ist eine eigene Entscheidung (Abschnitt 4).

**`highStakes`: `true`** — Fail-closed-Gate direkt vor dem Geldpfad, und die Null-Politik kann
bei einem Fehler **alle** Bestands-Mandanten aussperren.

---

### GP-P3 — Wiederanlauf nach Kartenwechsel + Versuchsdeckel

**Ausgang, gemessen.** Nach einem abgelehnten Hold ist der Mandant fuer beide automatischen
Pfade unsichtbar: die Nummer ist terminal `failed` (`src/onboarding.js:132`), der Job `FAILED`
(`src/worker/provisioning-orchestrator.js:202`), und der Klassifikator sieht nur `QUEUED`
(`src/store/state-ops.js:3080`). `resolveProvisionRetry`/`findStuckRequestedProvision`
(`src/billing/provision-trigger.js:65` bzw. `:77-79`) sucht ausschliesslich `REQUESTED` plus
`QUEUED`-Job.
Selbst eine reparierte Karte startet nichts neu: `bindCardFromSession`
(`src/self-service-routes.js:702`) loest **kein** `triggerTenantProvisioning` aus. Der Kunde
sieht im Dashboard nur einen passiven Text ohne Aktion
(`apps/web/src/components/app/AgentChip.astro:80`, Text aus
`apps/web/src/lib/api.js:237`). Der einzige verbleibende Weg ist admin-only
(`src/routes/api-onboard.js:257`).

**Auftrag.** Zwei Dinge, die zusammengehoeren. (a) Nach einem erfolgreichen
`bindCardFromSession` mit einer hold-faehigen Methode ruft der Server die **bestehende**
`triggerTenantProvisioning`, wenn der Mandant auf `failed` steht — kein zweiter Kaufpfad, und
das Abo-/KYC-Gate wird explizit mitgebracht, weil es laut `provision-trigger.js` beim Aufrufer
liegt und dort nicht dupliziert ist. (b) Ein **persistierter Versuchszaehler je Mandant, der
`failed`-Nummern mitzaehlt**, Deckel `PROVISIONING_RETRY_MAX_ATTEMPTS` (Default `3`,
Abschnitt 1), mit hartem terminalem Uebergang nach `needs_manual_reconcile`.
Ohne diesen Zaehler darf (a) nicht gebaut werden. Dazu der Dashboard-Text mit einer echten
Aktion auf die bereits existierende Route `/api/self-service/billing/setup-checkout`.

**Belegte Stellen.**
- `src/self-service-routes.js:702` — `bindCardFromSession` loest heute nichts aus; die Route sitzt bereits hinter `webAuthMw`
- `src/billing/provision-trigger.js:77-79` — `findStuckRequestedProvision` matcht `failed` nie (Aufrufer `resolveProvisionRetry`, `:65`)
- `src/store/state-ops.js:2569` — `occupiesCapacity` zaehlt `failed`/`released` nicht zur Cap
- `src/onboarding.js:126`, `:269` — Idempotenz-Schluessel an der `numberId`
- `src/routes/api-onboard.js:257` — `POST /api/onboard/retry` ist admin-only
- `src/store/views.js:123` — `FAILED`-Enum
- `apps/web/src/lib/api.js:237` — `numberPlaceholderText`, rein und unit-testbar
- `apps/web/src/components/app/AgentChip.astro:80` — passiver Text, keine Aktion

**Abnahmekriterium.**
1. Ein erfolgreicher `bindCardFromSession` fuer einen Mandanten im Status `failed` ruft
   `triggerTenantProvisioning` **genau einmal**, ohne dass ein Client oder Operator die
   Retry-Route aufruft. `numberStatusFor` liefert danach einen Wert aus
   `{requested, provisioning}` (Anzeige-Enum `NUMBER_DISPLAY_STATUS`,
   `src/store/views.js:119-126`) und **nie** `failed` — "oder besser" ist keine Ordnung, die
   ein Test kennt, deshalb ist die zulaessige Menge hier aufgezaehlt.
2. Derselbe Aufbau bei **erschoepftem Versuchszaehler**: `triggerTenantProvisioning`
   `callCount===0`, der Mandant wechselt auf `needs_manual_reconcile`.
3. Derselbe Aufbau **ohne aktives, verifiziertes Abo**: `callCount===0`. Diese Route wird durch
   die Aenderung von einer reinen Karten-Speicher-Route zu einer geldbewegenden Route und muss
   das Gate selbst tragen.
4. `numberPlaceholderText` liefert heute einen reinen String (`tPair(en, de)`,
   `apps/web/src/lib/i18n.js:85`, Aufrufer `apps/web/src/lib/api.js:240`). Nach dieser Phase
   traegt der `failed`-Fall zusaetzlich eine Aktion. Mechanisch gepinnt wird nicht der Wortlaut,
   sondern:
   - die Aktion traegt `href === "/api/self-service/billing/setup-checkout"` — genau die im
     Auftrag genannte Route, keine zweite und kein neuer Endpunkt;
   - mit `getLang()==='en'` und mit `getLang()==='de'` ist das Label jeweils nicht leer und die
     beiden Labels sind **nicht identisch** (identisch hiesse: der DE-Pfad faellt auf EN
     zurueck, Konvention `<NAME>_DE` aus `apps/web/src/lib/api.js:225-230`);
   - `active`, `provisioning`, `blocked` und `none` tragen **keine** Aktion.
   Die Rueckgabeform (String plus Feld gegen Objekt `{text, action}`) entscheidet die Umsetzung;
   gepinnt sind Route, Sprachen und Abwesenheit in den uebrigen Faellen.

**Verifikationsmethode.** `node:test` ueber die bestehende
`self-service-routes`-Test-Factory (in-process, Fake-Billing und Fake-Provisioner, Muster
`test/prov01-retry-redrive.test.js` und `test/p2-onboard-retry.test.js`) — voll deterministisch,
kein echter Stripe- oder Telnyx-Call. Punkt 4 ist ein reiner Unit-Test gegen
`apps/web/src/lib/api.js` (die Funktion ist bewusst DOM-frei).

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Kein zeitgesteuerter Sweep (das ist
GP-P4). Kein zweiter Kaufpfad und keine Kopie des Hold-vor-Order/Rollback-Kerns —
ausschliesslich die bestehende `triggerTenantProvisioning`. Keine Aenderung an
`MAX_NUMBERS`/`MAX_NUMBERS_PER_TENANT` oder an `occupiesCapacity` selbst; der Deckel wird durch
den neuen Zaehler **ergaenzt**, nicht ersetzt.

**`highStakes`: `true`** — die Phase macht aus einer Speicher-Route eine geldbewegende und
beruehrt den letzten verbliebenen Deckel gegen DID-Vermehrung.

---

### GP-P4 — Zeitgesteuerter Wiederanlauf

**Ausgang, gemessen.** `reconcileOrphanedProvisioning` laeuft nur einmal fire-and-forget beim
Start (`src/boot.js:1285`), und `PROVISIONING_REDRIVE_MAX_AGE_MS=0` (Default, `.env.example:355`)
heisst Observe-Only: selbst der `QUEUED`-Redrive-Zweig kauft in dieser Konfiguration nie
automatisch nach. Fuer `failed` existiert gar kein Zweig.

**Auftrag.** Ein weiterer unabhaengiger Zweig im bestehenden Stunden-Takt, der zahlende
Mandanten ohne Live-Nummer erneut anstoesst — aber **nur**, wenn die getypte Klassifikation aus
GP-P1 die letzte Ablehnung als **temporaer** ausweist und der Versuchszaehler aus GP-P3 nicht
erschoepft ist. Eine strukturell nie erfolgreiche Ablehnung (ungeeigneter Typ) fuehrt nie zu
einem Versuch.

**Belegte Stellen.**
- `src/boot.js:1084` — Muster fuer einen weiteren unabhaengigen Zweig im Stunden-Sweep
- `src/boot.js:1285` — `reconcileOrphanedProvisioning` laeuft nur einmal beim Start
- `.env.example:355` — `PROVISIONING_REDRIVE_MAX_AGE_MS=0`, Observe-Only
- `src/billing/stripe.js:142` — heute keine Klassifikation von `insufficient_funds`/`provider_decline`
- `src/store/state-ops.js:2569` — `occupiesCapacity` zaehlt `failed` nicht
- `src/billing/provision-trigger.js:65` — der bestehende Anstoss-Pfad

**Abnahmekriterium.**
1. Mandant, dessen letzte Ablehnung **strukturell** ist (Typ-Gate aus GP-P2): der Sweep stoesst
   **nicht** an (`callCount===0`).
2. Mandant, dessen letzte Ablehnung **temporaer** ist und dessen Zaehler frei ist: **genau ein**
   Anstoss.
3. Derselbe Mandant, zweiter Lauf ohne Zustandsaenderung, `nowMs` injiziert (nie Systemuhr,
   sonst ist der Fall nicht deterministisch): bei
   `nowMs + PROVISIONING_RETRY_MIN_INTERVAL_MS / 2` kommt **kein** weiterer Aufruf hinzu
   (`callCount` unveraendert), bei `nowMs + PROVISIONING_RETRY_MIN_INTERVAL_MS * 2` kommt
   **genau einer** hinzu. Die Mindestfrist ist damit als Groesse gepinnt, nicht als Absicht.
4. Zaehler erschoepft: `needs_manual_reconcile`, kein Anstoss.
5. Die Unterscheidung in (1) und (2) liest **ausschliesslich** das getypte Feld aus GP-P1 —
   der Struktur-Waechter aus GP-P1 Punkt 4 bleibt gruen.

**Verifikationsmethode.** Reiner Klassifikator-Test mit injiziertem `nowMs` (Muster
`test/prov01-classify.test.js`) plus ein Sweep-Test mit Fake-Trigger ueber die bestehende
Test-Factory. Kein Netz, kein echter Stripe-Call.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Kein neuer Timer, keine neue
Ressource. Keine Aenderung an den Gates, kein Umgehen von `MAX_NUMBERS` oder
`MAX_NUMBERS_PER_TENANT`. Keine Erweiterung der Klassifikation aus GP-P1 — wenn die dort
gelieferten Enums nicht reichen, ist das ein Befund gegen GP-P1, kein Anlass, hier Freitext zu
parsen.

**`highStakes`: `true`** — automatischer Kaufanstoss auf dem Pfad, der strukturell an
`MAX_NUMBERS_PER_TENANT` vorbeilaeuft.

---

### GP-P5 — R4-Kommentar auf das korrigieren, was der Code tut

**Ausgang, am Code nachgesehen.** Der R4-PRAEZISIERUNG-Kommentar (`src/onboarding.js:35-56`,
Owner-Entscheidung 27./28.07.2026) behauptet eine generelle Abschaltung der Einrichtungsgebuehr
und den Satz "der Kunde zahlt sein Abo und sonst nichts". Der Code setzt das nicht um:
`settleSetupFeeHold` (`src/onboarding.js:284`, Einzug-/Storno-Zweig `:290-291`) zieht ein, sobald
der Mandant nicht befreit ist, und die Befreiung haengt an `invoiceTotal===0`
(`src/billing/stripe.js:421,:424`, in `retrieveSubscription` ab `:414`). Der Boot-Waechter
bestaetigt, dass der Wert 0 nur im `PAYMENT_ENABLED=false`-Pfad gilt (`src/config.js:2521` mit
`isPositiveIntegerFee` in `src/config.js:2562`, dokumentiert in `.env.example:562`). Sobald ein
echter Vollpreis-Kunde mit hold-faehiger Karte eintrifft, wird ihm die Gebuehr nach heutigem
Code eingezogen — im woertlichen Widerspruch zum zitierten Kommentar.

**Auftrag.** Den Kommentar auf das beschreiben, was der Code **tut**. Die Owner-Frage dazu ist
seit dem 11.09.2026 beantwortet (Abschnitt 3.2): die Einrichtungsgebuehr ist **gewollt**, die
R4-Position vom 28.07. ist damit ueberholt. Der neue Kommentar benennt diese Entscheidung mit
Datum, beschreibt den Einzug-/Storno-Zweig wahrheitsgemaess und nennt als Befreiungsquelle die
Rechnungssumme — ausdruecklich als bewusst gewaehlten Stellvertreter, nicht als Zufall. Reine
Kommentarkorrektur, kein Verhalten: die Signalquelle bleibt unangetastet.

**Belegte Stellen.**
- `src/onboarding.js:35-56` — der falsche Kommentar
- `src/onboarding.js:108` — GAP-05: der Hold wird IMMER gestellt, unabhaengig von `exempt`
- `src/onboarding.js:259-260` — `exempt` wird in `placeSetupFeeHold` nur gelesen und durchgereicht
- `src/onboarding.js:290-291` — `if (exempt) cancelHold` sonst `captureHold`
- `src/billing/stripe.js:421,:424` — `numberSetupFeeExempt = invoiceTotal===0` (in `retrieveSubscription`, ab `:414`)
- `src/store/state-ops.js:2304`, `:2404` — Schreib- und Lesepfad, fail-closed Default `false`
- `src/config.js:2521`, `:2562`, `.env.example:562` — Gebuehr 0 gilt nur bei `PAYMENT_ENABLED=false`
- `src/self-service-routes.js:111`, `:348` — der Setup-Tarif wird dem Kunden vor dem Checkout angezeigt

**Abnahmekriterium.** Alle vier Punkte sind Kommandos mit erwartetem Ergebnis, keine
Textbeurteilung — auch Punkt 1 und 2, die fruehere Fassung war an genau dieser Stelle nicht
pruefbar.

1. Die beiden falschen Zeichenketten sind weg. Beide Kommandos liefern **0 Treffer**:
   ```
   grep -cF "abgeschaltet - der Kunde zahlt sein Abo und sonst nichts" src/onboarding.js
   grep -cF "ist per Konfiguration" src/onboarding.js
   ```
   (Heute liefert das erste 1, in `src/onboarding.js:39`. Das ist die Positiv-Kontrolle: wer
   das Kommando vor der Phase faehrt, sieht die 1 und weiss, dass es sucht, was es soll.)
2. Es wurde **keine Logikzeile** angefasst. Dieses Kommando liefert **0 Zeilen**:
   ```
   git diff -U0 master..<finalBranch> -- src/onboarding.js \
     | grep -E '^[+-]' | grep -vE '^[+-]{3}' | grep -vE '^[+-]\s*(//|\*|/\*)'
   ```
   Es zeigt jede geaenderte Zeile, die **kein** Kommentar ist. `git diff --stat` kann das
   nicht entscheiden — es nennt nur Datei und Zeilenzahl. Der Lead darf dieses eine gefilterte
   Kommando fahren, ohne seine Rolle zu verlassen: es gibt keinen Code aus, sondern zaehlt.
3. `git diff --stat master..<finalBranch>` nennt **ausschliesslich** `src/onboarding.js`.
4. `npm test` bleibt **ohne jede Test-Aenderung** gruen. Das ist die Clean-Code-Regel fuer reine
   Refactors und hier zugleich der Beweis, dass kein Verhalten beruehrt wurde.

**Was an die Stelle des falschen Satzes gehoert:** eine Beschreibung dessen, was der Code
wirklich tut — die Gebuehr ist konfiguriert und groesser null (der Boot-Waechter
`src/config.js:2521` erzwingt das bei `PAYMENT_ENABLED=true`), und ob sie eingezogen oder
storniert wird, entscheidet allein `numberSetupFeeExempt`. Der Kommentar darf keine generelle
Abschaltung mehr behaupten, weil es sie nicht gibt.

**Verifikationsmethode.** Die Bestandssuite, unveraendert. Kein neuer Test — neues Verhalten
braucht einen Test, und diese Phase erzeugt bewusst keines.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Die Signalquelle der Befreiung
(`invoiceTotal===0` gegen ein explizites Coupon-Signal) wird **nicht** angefasst; sie ist
Owner-Blocker. `captureHold`/`cancelHold` bleiben unveraendert. Die Gebuehr wird weder
abgeschafft noch fuer irgendjemanden anders berechnet.

**`highStakes`: `false`** — kein Verhalten, keine Logikzeile. Der verhaltensaendernde Teil
desselben Befunds ist Owner-Blocker und waere `true`.

---

### GP-P6 — Preis-Waechter Katalog gegen Stripe

**Ausgang, am Code nachgesehen.** `src/plans.js:13-15` entkoppelt den **angezeigten** Preis
(`amountCents`) bewusst vom **abgebuchten** Preis (Stripe-Price-Id) und sagt im eigenen
Kopfkommentar, dass die Uebereinstimmung Owner-Verantwortung ist und der Katalog Stripe nicht
liest. Der einzige Automatismus (`test/plans-catalog.test.js`) deckt zwei **andere** Kanten
desselben Dreiecks: Katalog gegen Katalog (Zeile 68) und "Slug hat ueberhaupt eine Price-Id"
(Zeile 59). Die Kante Katalog-Betrag gegen Stripe-Betrag ist unbewacht. Latentes Risiko, kein
aktueller Defekt — dieser Vorfall hatte eine andere Ursache.

**Auftrag.** Zwei getrennte Waechter mit unterschiedlicher Schwere. (a) Ein **lokaler,
netzfreier Boot-Guard** nach dem `unpricedModels`/`isPositiveIntegerFee`-Muster: bei
`PAYMENT_ENABLED=true` muss jeder Katalog-Slug eine nicht-leere Stripe-Price-Id haben, sonst
FATAL — er darf fatal sein, weil er ausschliesslich Config gegen Config prueft. (b) Ein
**eigenes schlankes Modul** nach dem exakten Mechanismus von `outbound-drift-watch`:
Boot-Sonde fire-and-forget nach `app.listen` plus ein Zweig im bestehenden Stunden-Sweep, `GET
/v1/prices/{id}` ueber einen injizierbaren, rein lesenden Port, Vergleich Betrag und Waehrung
gegen `PLAN_CATALOG`, Abweichung -> entprellte Betreiber-Meldung, Netzfehler -> gezaehlter
`unknown`-Befund ohne Boot- oder Prozess-Abbruch.

**Der Takt ist entschieden: taeglich** (Owner, 11.09.2026, Frage 12). Der Zweig haengt weiter
am bestehenden Stunden-Sweep, prueft aber nur, wenn seit der letzten Pruefung
`PRICE_DRIFT_MIN_INTERVAL_MS` vergangen sind — und dieser Wert ist `86400000`. Begruendung:
Stripe-Preise aendern sich seltener als Telefonie-Konfiguration, und jede Pruefung ist ein
Anbieter-Aufruf. Der Wert ist der Default im Code; ein spaeteres Nachziehen bleibt ein
Env-Wert und keine Codezeile.

**Belegte Stellen.**
- `src/plans.js:13-15` — dokumentierte Entkopplung, Katalog liest Stripe nicht
- `src/plans.js:20`, `:36` — `amountCents` 499 und 999
- `apps/web/src/lib/plans.js:1` — physische Spiegelkopie, identische Betraege
- `test/plans-catalog.test.js:59`, `:68` — die beiden bereits gedeckten Kanten
- `src/billing/subscribe.js:31` — `priceIdForPlan()`, kein Betragsvergleich
- `src/config.js:1485` — Price-Ids direkt aus Env, keine Wert-Pruefung
- `src/boot-guard.js:227` — `unpricedModels`, Muster fuer einen rein lokalen FATAL-Guard
- `src/config.js:2521`, `:2562` — `isPositiveIntegerFee`, Muster "FATAL nur im Payment-Pfad"
- `src/telephony/outbound-drift-watch.js:187` — `runBootProbe` plus `runDriftSweep`
- `src/boot.js:1303` — Boot-Sonde fire-and-forget, "Anbieter-IO gehoert nie an die Boot-Sequenz"
- `src/boot.js:1084` — Sweep-Zweig im Stunden-Takt
- `src/telephony/outage-report.js:122`, `:157` — geteilte Eskalations-Primitiven
- `src/billing/stripe.js:174` — `url()`-Helper und der bestehende `fetch`/`authHeaders`-Stil

**Abnahmekriterium.**
1. Ein injizierter Price-Read, der fuer `STRIPE_STARTER_PRICE_ID` einen `unit_amount` von 599
   statt 499 liefert, erzeugt binnen **eines** Sweep-Laufs genau einen Befund-Datensatz **und**
   genau eine Betreiber-Meldung ueber denselben Kanal wie `outbound-drift-watch`.
2. Ein zweiter Lauf ohne Zustandsaenderung erzeugt **keine zweite Meldung** (Entprellung). Das
   ist nicht Kosmetik: die Eskalation endet in Audit -> Mail -> SMS, und eine SMS ist ein
   kostenpflichtiger Ausgangskanal.
3. Ein **werfender** Read (Netzfehler) erzeugt einen gezaehlten `unknown`-Befund, **keine**
   Meldung, keinen Wurf nach aussen und keinen Prozess-Abbruch. Die Unwissenheit eskaliert
   danach selbst, beziffert: nach genau `PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER` (Default `3`)
   **aufeinanderfolgenden** `unknown`-Laeufen erzeugt der Waechter **genau eine**
   Betreiber-Meldung; der vierte, fuenfte und jeder weitere `unknown`-Lauf erzeugt **keine**
   weitere. Ein dazwischenliegender erfolgreicher Read setzt den Zaehler zurueck. Ohne diese
   Zusage maskiert ein fehlendes Schluessel-Scope (Owner-Frage 13) den Preis-Drift fuer immer.
4. Ein Boot mit `PAYMENT_ENABLED=true` und leerem `STRIPE_BUSINESS_PRICE_ID` beendet den
   Prozess mit `exit(1)` **vor** `app.listen()`, ganz ohne Netzzugriff.
5. Ein Boot mit `PAYMENT_ENABLED=false` und leerer Price-Id startet **unveraendert** — sonst
   stirbt jeder Entwickler- und Testboot.

**Verifikationsmethode.** Zwei `node:test`-Tests nach vorhandenem Muster: die Faelle 4 und 5
analog den bestehenden `boot-guard.test.js`-Faellen fuer `unpricedModels`/`assertPricedModels`
(kein Netzaufruf noetig); die Faelle 1 bis 3 analog `outbound-drift-watch.test.js` mit
injiziertem Read-Mock. **Kein Test gegen die echte Stripe-API** — Netzabhaengigkeit, Flakiness,
Kosten; `outbound-drift-watch` loest dasselbe Problem bereits ueber injizierbare Ports.

**Abgrenzung — was diese Phase ausdruecklich NICHT tut.** Kein Netz-Check in der Boot-Sequenz.
Kein Einfrieren von `PAYMENT_ENABLED` bei erkannter Abweichung — das waere ein **neues Gate**
und braucht eine bewusste Owner-Entscheidung wie seinerzeit bei E10 und OC, kein impliziter
Nebeneffekt eines Waechters. Keine Aenderung an `PLAN_CATALOG` oder an den Preisen selbst. Kein
neuer Befund-Typ **innerhalb** von `outbound-drift-watch.js`: dessen Vokabular ist
telephony-spezifisch, eine Stripe-Preispruefung dort waere eine fachfremde Beimischung.

**`highStakes`: `true`** — nicht wegen Geldbewegung (die Phase bewegt keine), sondern weil sie
einen FATAL-Boot-Guard einfuehrt. Die Hochrisiko-Definition des Workflow-Skripts nennt genau
diesen Fall: "ein Live-Dienst, der nicht mehr startet"
(`.claude/workflows/phase-impl-lean.js:87-91`). Dass die Phase selbst kein Geld bewegt, senkt
die Einstufung nicht — der Schaden liegt hier im Nichtstarten, nicht in der Buchung.

## 2b. Pre-Mortem

Ein Jahr in der Zukunft, die Kette ist gescheitert. Was ist passiert? Acht Wege, rueckwaerts
gelesen. Wo ein Risiko bewusst getragen wird, steht es als **akzeptiertes Restrisiko** da — nicht
als Versehen.

**1. Die Eignungspruefung wurde als Denylist gebaut und laesst alles Neue durch.**
Der Umsetzende schreibt die naheliegende Zeile "wenn `type === 'link'`, ablehnen". Stripe fuehrt
spaeter einen weiteren Wallet-Typ ein, oder ein Bestands-Mandant traegt einen Typ, an den
niemand dachte. Das Gate laesst ihn durch, `placeHold` scheitert wieder mit generischem
Decline, und der Fix gilt als erledigt, waehrend derselbe Schaden weiterlaeuft.
*Gegenmittel:* Allowlist statt Denylist, plus der Negativtest auf einen erfundenen Typ
(GP-P2, Abnahme 3). Ohne diesen Test ist die Allowlist-Eigenschaft nicht gepinnt.
*Akzeptiertes Restrisiko:* ein neuer, tatsaechlich hold-faehiger Stripe-Typ wird zunaechst
faelschlich abgelehnt, bis jemand ihn eintraegt. Falsch-negativ ist hier billiger als
falsch-positiv.

**2. Das Typ-Feld bleibt fuer immer null, weil der Expand nie vertieft wurde.**
`getCheckoutSessionResult` expandiert nur `setup_intent`, und `json.setup_intent.payment_method`
ist eine String-Id (`src/billing/stripe.js:294`). Der Code schreibt brav `undefined` in den
Store, alle Tests mit selbstgebauten Fakes sind gruen, und in Produktion ist jeder ueber diesen
Weg gebundene Mandant typlos. Je nach Null-Politik werden danach entweder alle blockiert oder
gar nichts geprueft.
*Gegenmittel:* der Fixture-Test gegen die echte unexpandierte Antwortform (GP-P2, Abnahme 1) —
er prueft die Adapterfunktion, nicht den Fake.
*Akzeptiertes Restrisiko:* der Fixture bildet die Stripe-Antwort nach, nicht die Stripe-API.
Eine Formaenderung bei Stripe faellt erst im Betrieb auf.

**3. Bestands-Mandanten sind ausgesperrt und haben keinen Weg zurueck.**
Das Typ-Feld ist additiv-nullable, es gibt keinen Backfill. Die neue Pruefung faellt bei `null`
korrekt fail-closed. Jeder bestehende Mandant bekommt ab dem Deploy keine Nummer mehr. Er
hinterlegt brav eine Karte neu, der Typ wird geschrieben — und trotzdem passiert nichts, weil
`bindCardFromSession` kein Provisioning anstoesst. Zahlender Kunde, gueltige Karte, keine
Nummer: derselbe Schaden wie im Grundvorfall, nur mit anderer Ursache.
*Gegenmittel:* GP-P3 ist Auflage auf GP-P2, nicht spaetere Kuer. Die Null-Politik wird
ausdruecklich entschieden und als Test gepinnt (GP-P2, Abnahme 4).
*Akzeptiertes Restrisiko:* zwischen dem Merge von GP-P2 und dem von GP-P3 existiert ein Fenster,
in dem betroffene Mandanten nur ueber die Admin-Retry-Route bedient werden koennen. Da laut
Bestandswissen alle aktiven Accounts intern sind, ist das Fenster vertretbar — aber es ist ein
Fenster, kein Nicht-Problem.

**4. Der Checkout ist tot und niemand merkt es.**
`payment_method_types:['card']` wird gesetzt, der Typ ist im Dashboard nicht aktiviert oder
kollidiert mit dem setup-Mode. Stripe antwortet 400, `assertOkWithDetail` wirft, der
Billing-Wrapper liefert brav 502. Jeder Abo-Abschluss scheitert ab sofort, die Fehlermeldung ist
generisch, und weil kein Kunde meldet, was er nie hatte, laeuft der Umsatz still auf null.
*Gegenmittel:* erst im Stripe-Dashboard deaktivieren (wirkt sofort, kein Deploy-Risiko),
Code-Aenderung danach und nur, nachdem eine Testmodus-Session in **beiden** Modi noch eine `url`
zurueckliefert (GP-P2, Verifikation).
*Akzeptiertes Restrisiko:* die Dashboard-Variante ist in `git` nicht nachvollziehbar; Test- und
Live-Konto koennen auseinanderlaufen, ohne dass ein Commit das zeigt.

**5. Der automatische Wiederanlauf kauft in einer Schleife Nummern.**
Die Karte eines Mandanten flattert. Der Wiederanlauf feuert, findet die alte Nummer terminal auf
`failed`, faellt auf den Neuanforderungspfad zurueck und erzeugt eine neue `numberId` mit
frischen Idempotenz-Schluesseln. Weil `occupiesCapacity` `failed` nicht mitzaehlt, greift
`MAX_NUMBERS_PER_TENANT` nie. Nach einem Jahr stehen Dutzende DIDs mit Monatsmiete auf dem
Konto — derselbe Mechanismus, der schon einmal zur Nummern-Vermehrung gefuehrt hat, diesmal
automatisiert.
*Gegenmittel:* der persistierte Versuchszaehler, der `failed`-Nummern mitzaehlt, mit hartem
terminalem Uebergang (GP-P3, Abnahme 2). Ohne ihn darf der Wiederanlauf nicht gebaut werden.
*Akzeptiertes Restrisiko:* ein Mandant mit echtem, aber voruebergehendem Deckungsproblem
verbraucht seine Versuche und landet im Handbetrieb. Das ist gewollt: eine Warteschlange beim
Betreiber ist billiger als unbegrenzte Carrier-Miete.

**6. Aus der Diagnose wurde unbemerkt Steuerung.**
GP-P1 liefert den Ablehnungsgrund nur als Substring in `.message`. Ein halbes Jahr spaeter
braucht GP-P4 die Unterscheidung "strukturell" gegen "temporaer", und jemand grept die Message.
Danach aendert ein harmloser Wortlaut-Edit die Zeichenkette, die Unterscheidung faellt still
aus, der Sweep haelt eine tote Zahlungsmethode fuer temporaer und probiert endlos weiter —
direkt in Szenario 5 hinein.
*Gegenmittel:* Steuerung liest ausschliesslich das getypte Feld, die Message bleibt reine
Menschendiagnose. Als Test formuliert, nicht als Vorsatz (GP-P1, Abnahme 4).
*Akzeptiertes Restrisiko:* zwei Transportwege fuer dieselbe Information im selben Modul sind
redundant und muessen konsistent gehalten werden.

**7. Die naechste Ablehnungsklasse trifft uns genauso blind.**
GP-P2 sperrt `link` aus, der Fall gilt als geloest. Dann greift die zweite, in der Stripe-Doku
ausdruecklich genannte Einschraenkung: Kartennetzwerke duerfen Kleinstautorisierungen untersagen,
die der Haendler nicht einzuziehen gedenkt. Eine echte Karte besteht das Typ-Gate und wird
trotzdem beim 92-Cent-Hold abgelehnt. Weil GP-P0 nie gebaut wurde, faellt es wieder nur bei
manueller Forensik auf — ein Jahr spaeter, mit unbekannt vielen stillen Faellen dazwischen.
*Gegenmittel:* GP-P0 vor GP-P2. Die Beobachtung ist das Instrument, das ueberhaupt erst beweist,
ob GP-P2 in Produktion gewirkt hat, und sie deckt die Klasse ab, die GP-P2 grundsaetzlich nicht
abdecken kann.
*Akzeptiertes Restrisiko:* die Netzwerk-Ablehnung von Kleinstautorisierungen wird von dieser
Kette **nicht behoben**, nur sichtbar gemacht. Das ist bewusst so — die Behebung waere eine
andere Entscheidung (Sofortbuchung statt Hold), und die ist am 11.09.2026 gefallen: **hart
ablehnen, kein Sofortbuchung-Zweig** (Frage 3). Der Mandant hinterlegt eine Karte, Punkt.

**8. Die bereits eingezogenen 4,99 EUR bleiben liegen.**
Die Kette behebt die Mechanik, aber niemand erstattet die konkrete Rechnung. Sie steht auf
bezahlt, der Kunde hat nie etwas bekommen. Bei einem internen Mandanten ist das folgenlos, als
Muster bei echten Kunden ist es der Anfang eines Rueckbuchungsfalls.
*Gegenmittel:* als eigener operativer Vorgang neben der Kette fuehren, nicht darin — und die
Owner-Frage dazu **vor** dem Kettenstart beantworten, damit sie nicht untergeht (Abschnitt 3).
*Akzeptiertes Restrisiko:* die Kette liefert keinen automatischen Erstattungspfad fuer diesen
Fehlerzustand; jeder kuenftige Fall bleibt Handarbeit, bis GP-P0 ihn wenigstens meldet.

## 3. Owner-Blocker (keine Phase, nicht vom Assistenten baubar)

### 3.1 Blocker: zwei offen, zwei erledigt

| Was | Stand (Telnyx-Portal / Stripe-Dashboard, 11.09.2026) | Wirkung, solange offen |
|---|---|---|
| ~~**Telnyx-Guthaben**~~ **ERLEDIGT 11.09.2026** | aufgeladen auf **6,79 USD** (vorher 1,79), gemessen ueber `GET /v2/balance` | Deckt die Monatsmiete der drei aktiven Rufnummern (je 1 USD) und ein bis zwei neue Nummern (1 USD einmalig plus 1 USD monatlich). **Knapp, nicht reichlich:** vor jeder Phase, die einen echten Kauf ausloest, erneut messen |
| **Deutsche Nummer `+4921194289148`** | seit 01.09.2026 auf `requirement-info-pending`; Telnyx erwartet Nachweisdokumente | Die Nummer ist nicht nutzbar. Kein Code-Pfad kann das aufloesen — die Dokumente muss der Owner einreichen |
| ~~**Der Kunde des Vorfalls**~~ **ERLEDIGT 11.09.2026** | 4,99 EUR bezahlt (Rechnung `IKHKABW9-0020`), keine Rufnummer erhalten. Der Mandant ist ein **internes Konto des Betreibers** (dieselbe Identitaet, der auch der Render-Workspace gehoert) | Keine Erstattung, kein Backfill, keine Kundenkommunikation (Fragen 1 und 2). Das Geld ging von eigener Karte auf eigenes Stripe-Konto |
| **Link als Zahlungsart im Checkout** | aktiv; die Zahlungsmethode des Vorfalls (`pm_1TwhhW3d0y9L6Epq2hGs8DO4`) ist vom Typ `link`. `grep payment_method_types src/` liefert heute nichts — der Code schraenkt die Typen nirgends ein | **Owner-Entscheidung 11.09.2026, Frage 4: nur Karte.** Link ist im Stripe-Dashboard unter Zahlungsmethoden zu deaktivieren. Solange das nicht geschehen ist, erzeugt jeder neue Abschluss potenziell wieder eine nicht hold-faehige Methode; GP-P2 faengt das fail-closed ab, verhindert es aber nicht. Reiner **Dashboard-Schritt**, kein Code |

**Zum Link-Blocker, ausdruecklich:** `payment_method_types` im Code zu setzen, ist die
naheliegende Alternative und wurde **bewusst aus der Kette genommen**. Ein falscher oder im
Dashboard nicht aktivierter Wert laesst jeden Checkout-Aufbau scheitern — das ist Pre-Mortem 4
(Umsatz still auf null), und der Fehler traefe beide Aufbauten zugleich. Entscheidet der Owner
sich doch dafuer, gilt: eigener Vorgang nach dem Dashboard-Schritt, und er braucht ein eigenes
Abnahmekriterium der Form "`createSetupCheckoutSession` und `createSubscriptionCheckoutSession`
liefern im Stripe-Testmodus je eine nicht-leere `url`" — in beiden Modi, sonst ist er nicht
abgenommen.

### 3.2 Owner-Entscheidung 2026-09-11: die Einrichtungsgebuehr bleibt, das Signal auch

Dieser Abschnitt war bis zum 11.09.2026 ein Blocker. Er ist es nicht mehr. Der Owner hat zwei
Fragen beantwortet, und beide Antworten machen **weniger** Arbeit, nicht mehr:

**(1) Die Einrichtungsgebuehr ist gewollt.** Der Kunde zahlt sie zusaetzlich zum Abo. Damit ist
die R4-Position vom 28.07.2026 ("der Kunde zahlt sein Abo und sonst nichts") **ueberholt** — sie
war es faktisch schon, denn der in der Oberflaeche ausgewiesene Mechanismus
(`src/self-service-routes.js:111`, `:348`) wurde zweieinhalb Wochen zuvor gebaut und nie
zurueckgenommen. Der Kommentar hinkte der Wirklichkeit hinterher, nicht umgekehrt.

**(2) Die Befreiung bleibt an der Rechnungssumme.** `invoiceTotal===0` -> befreit ->
`cancelHold` bleibt unveraendert (`src/billing/stripe.js:421`, `src/onboarding.js:290-291`).
Kein Signalwechsel, keine Beobachtungsphase, keine Codeaenderung an dieser Stelle. Die
urspruenglich befuerchtete Gefahr — eine reale Abbuchung bei Mandanten, die heute nichts zahlen
— entsteht gar nicht erst, weil das Signal bleibt, wie es ist.

**Akzeptiertes Restrisiko, ausdruecklich.** Aus (2) zusammen mit dem unveraendert
weiterlaufenden Dauergutschein (Abschnitt 3.4) folgt: **wer den Gutschein ueber hundert Prozent
traegt, zahlt weder Abo noch Einrichtungsgebuehr.** Die Nullrechnung befreit, unabhaengig davon,
warum sie null ist. Fuer die internen Konten der Testphase ist das gewollt. Vor dem ersten
fremden Kunden ist es zu pruefen — entweder verliert der Gutschein seine Unbegrenztheit, oder
die Befreiung braucht doch ein eigenes Signal. Solange keines von beidem passiert, ist jeder
Gutschein-Traeger ein Vollgratis-Zugang.

Was daraus folgt: GP-P5 korrigiert den Kommentar auf die Entscheidung vom 11.09. und wartet auf
nichts. Eine Phase fuer die Signalquelle gibt es nicht, weil es nichts zu bauen gibt.

### 3.3 Beantwortete Owner-Fragen (Stand 2026-09-11)

Alle dreizehn Fragen, die dieser Plan bei seiner Erstellung offen liess, sind beantwortet. Sie
stehen hier mit der Antwort, weil eine Phase, die eine davon anders auslegt, falsch gebaut ist.

| # | Frage | Antwort vom 11.09.2026 | Wirkung |
|---|---|---|---|
| 1 | Betroffenen Mandanten manuell umstellen? | **Entfaellt.** Der Mandant ist ein internes Konto des Betreibers (dieselbe Identitaet, der auch der Render-Workspace gehoert), kein fremder Kunde | Kein Backfill, keine Kundenkommunikation |
| 2 | Die 4,99 EUR getrennt erstatten? | **Entfaellt**, gleicher Grund: Geld von eigener Karte auf eigenes Stripe-Konto | Kein operativer Vorgang |
| 3 | Nicht hold-faehige Methode hart ablehnen? | **Ja, hart ablehnen.** Der Mandant hinterlegt eine Karte | GP-P2 wie geplant. Kein Sofortbuchung-Zweig, auch nicht spaeter |
| 4 | Welche Zahlungsarten im Checkout? | **Nur Karte.** Link verschwindet | Vierter Blocker in 3.1 wird konkret: Link im Dashboard deaktivieren |
| 5 | `paymentMethodType===null` bei Bestand? | **Fail-closed.** Unbekannt gilt als ungeeignet | GP-P2 wie geplant, GP-P3 ist der Rueckweg |
| 6 | Den PII-Log-Pfad mitfixen? | **Ja, in dieser Kette** | GP-P1 erweitert sich um `src/self-service-routes.js:224`, `:232` |
| 7 | Link-Verhalten empirisch gegenpruefen? | **Nein.** Die Allowlist entscheidet am Typ, nicht am Fehlerkoerper | Kein Stripe-Testmodus-Vorgang. Restrisiko: Pre-Mortem 1 (Falsch-negativ) bleibt bewusst stehen |
| 8 | `job.lastError` denselben Zusatz geben? | **Ja.** Der Grund bleibt auffindbar, auch nach Log-Rotation | GP-P1 schreibt den Enum-Anhang auch in die Datenbank |
| 9 | Gilt die R4-Position weiter? | **Nein, ueberholt. Die Gebuehr ist gewollt** | Abschnitt 3.2, GP-P5 benennt die neue Position |
| 10 | Befreiungssignal wechseln? | **Nein, Rechnungssumme bleibt** | Keine Codeaenderung. Restrisiko in 3.2 |
| 11 | Was mit dem Dauergutschein? | **Bleibt unveraendert** | Akzeptiertes Restrisiko, siehe 3.2 und 3.4 |
| 12 | Takt des Preis-Waechters? | **Taeglich** | `PRICE_DRIFT_MIN_INTERVAL_MS=86400000` statt 1 h. Ein Konfigurationswert, keine Codezeile |
| 13 | Reicht das Stripe-Lese-Scope? | **Ja, sehr wahrscheinlich.** Der Live-Schluessel ist ein Standardschluessel (`sk_live_`), kein eingeschraenkter (`rk_live_`); die Probe `GET /v1/prices` liefert im Testmodus HTTP 200 | GP-P6 kann gebaut werden. Bewiesen ist der Testmodus, nicht Live — scheitert der erste Live-Aufruf mit 403, ist das Scope die Ursache und kein Codefehler |

### 3.4 Der Dauergutschein bleibt offen — als Risiko, nicht als Aufgabe

Der Gutschein ueber hundert Prozent laeuft ohne Einloeselimit, ohne Ablaufdatum und
"wiederkehrend" statt "einmalig". Der Owner hat am 11.09.2026 entschieden, ihn **unveraendert
zu lassen** — er traegt die interne Testphase.

Das ist kein Versehen und keine Phase dieser Kette. Es ist ein bewusst gehaltenes Risiko mit
einem klaren Faelligkeitsdatum: **vor dem ersten fremden Kunden.** Wer diesen Gutschein-Code
erhaelt, bekommt Abo und Rufnummer dauerhaft kostenlos, weil die Nullrechnung zugleich von der
Einrichtungsgebuehr befreit (Abschnitt 3.2). Beide Wirkungen zusammen sind der Grund, warum der
Eintrag hier steht und nicht nur in einer Fussnote.

## 4. Ausdruecklich NICHT Teil dieser Kette

- **Der fehlende Freigabe-Pfad fuer nicht mehr genutzte Rufnummern.** Bekanntes, **eigenes**
  Thema. Es beruehrt dieselbe Kostenachse (DID-Monatsmiete), hat aber eine andere Ursache und
  eine andere Loesung. Gehoert nicht hierher.
- **Die Mandanten-Vermehrung ueber wechselnde Anmelde-Kennungen** (ein neuer Identity-Subject
  erzeugt einen neuen Mandanten und damit einen neuen Nummernkauf). Ebenfalls bekanntes,
  **eigenes** Thema mit eigener Historie. Gehoert nicht hierher — auch wenn GP-P3 mit dem
  Versuchsdeckel eine benachbarte Kostenachse beruehrt.
- **Die Abschaffung der Einrichtungsgebuehr** und der Wechsel der Befreiungs-Signalquelle —
  Owner-Blocker, Abschnitt 3.2. In der Kette liegt davon nur die Kommentarkorrektur (GP-P5).
- **Sofortbuchung statt Hold** (`capture_method=automatic` plus Erstattung). Kein
  eigenstaendiger Fix: er setzt die Typ-Erkennung aus GP-P2 voraus, fuehrt einen dauerhaften
  Grenzkostenposten ein (Stripe erstattet die Verarbeitungsgebuehr in der Regel nicht) und
  wiederholt strukturell die Schadensklasse des Grundvorfalls — eine unerklaerte Belastung auf
  dem Kontoauszug. Nur nach ausdruecklicher Owner-Entscheidung (Frage 3).
- **Die Netzwerk-Ablehnung von Kleinstautorisierungen.** Diese Kette macht sie sichtbar (GP-P0),
  sie behebt sie nicht. Siehe Pre-Mortem 7.
- ~~Der bestehende Stufe-3-Rohtext-Log-Pfad bei `createSubscription`~~ — **seit der
  Owner-Entscheidung vom 11.09.2026 (Frage 6) doch Teil der Kette.** Er wird in GP-P1
  mitgefixt, nicht nur im Kommentar korrigiert (`src/self-service-routes.js:224`, `:232`).
- **Die Besitz-Verifikation der hinterlegten eigenen Nummer.** Steht als Launch-Blocker in
  `PLAN-SECURITY.md` und ist kein Geldpfad-Thema.
- **Jede Aenderung an `MAX_NUMBERS`, `MAX_NUMBERS_PER_TENANT`, `OUTBOUND_FROZEN` oder der
  pro-Mandant-Kostendecke.** Diese Kette haertet die Gates, sie fasst sie nicht an.
