# Gates-Fix-Kette — Phasen-Spezifikationen (P1–P15)

Autoritative Scope-/Design-/Invarianten-Definition je Phase. Umbrella-Kontext:
[`PLAN-GATES.md`](../PLAN-GATES.md). Basis der Kette: `59300ab` (Commit von `PLAN-GATES.md`).

---

## Regeln, die fuer JEDE Phase gelten

**Regel 0 (Worktree-Basis).** Der Worktree MUSS auf `master` (bzw. dem uebergebenen
`baseBranch`) stehen. Vor der ersten Aenderung pruefen:

```
git rev-parse HEAD
git merge-base --is-ancestor <base> HEAD && echo BASIS-OK
```

Steht der Worktree auf einem anderen Commit: `git checkout -b <branch> <base>` explizit gegen
den benannten Basis-Commit, NICHT gegen den zufaelligen Worktree-HEAD.

**Abnahme (alle vier Punkte, sonst BLOCKED).**

1. Die in der Phase genannten Gates sind gruen: `npm run test:gates`
2. `npm test` = **0 rot** (Regressionsschutz, vollstaendig — nicht nur betroffene Dateien).
   Die Zahl der bestandenen Tests waechst mit jeder Welle, weil Phasen Regressionstests
   mitliefern: Basis der Kette 3295, nach Welle 1 **3296**. Massgeblich ist `fail = 0` und
   dass kein BESTEHENDER Test rot wird — nicht eine feste Gesamtzahl.
3. `git diff --name-only <base>..<branch> -- src/ public/ apps/ render.yaml` ist **nicht leer**
4. Der Bericht nennt je Datei die getragene Verhaltensaenderung

**Ein Gate geht gruen, WEIL sich das Produkt geaendert hat.** Ein Diff, der ausschliesslich
`test/` beruehrt, ist ein Fehlschlag der Phase, kein Erfolg. Praezedenzfall: In Welle W2 wurde
VOICE-12 lautlos zu einer Bestaetigung des Defekts umgeschrieben ("eine Voice-ID fuer alle
Sprachen — das IST der Beweis"); beide Reviews gaben das frei.

**Testaenderungen sind abschliessend geregelt.** Nur die unter "Zulaessige Testaenderung" in der
jeweiligen Phase genannte Aenderung ist erlaubt. Faellt ein heute gruener Test, der dort nicht
genannt ist, ist das ein **Blocker**: melden, NICHT anpassen. Es gibt keine neuen Ausnahmen.

**Ein roter Test ist eine Behauptung, kein Beweis.** GAP-23 war zwei rote Tests lang ein Befund
und ist am Ende keiner gewesen (`PLAN-GATES.md` 2.1). Vor der Umsetzung den Testanker am
echten Code pruefen: baut der Test ein produktionsfremdes Setup? Wo eine Phase eine **neue
Sperre** baut, gehoert der **glueckliche Pfad** mitgetestet (der erlaubte Fall bleibt erlaubt).

**Katalog-ID im Testnamen.** Jeder Launch-Gate-Test traegt seine Katalog-ID (`GAP-09`,
`PAY-19`, …) am Namensanfang — das ist die einzige Zuordnungsregel zwischen `npm test` und
`npm run test:gates`. Neue Tests, die Regressionsschutz sein sollen, duerfen **keine**
Katalog-ID am Namensanfang tragen.

**Scope.** NUR die eigene Phase. Keine Aufraeumarbeiten an Nachbardateien, keine neuen
npm-Dependencies, keine ungefragten Extras. Jede Phase haelt sich an ihre Dateiliste — die
Wellen sind so geschnitten, dass die Dateilisten paarweise disjunkt sind; ein Griff in eine
fremde Datei zerstoert die Parallelitaet.

---

## P1 — SCA-Sackgasse (PAY-19 x2)

**Gates:** `test/pay-19-*.test.js` — die beiden Tests bei `:108` und `:121`.
**Dateien:** `src/billing/stripe.js`, `src/billing/errors.js`.
**Risiko:** Geld — **Launch-Blocker**. Das ist die einzige Phase, bei der ein Kunde **zahlen
will und nicht kann**.

**Befund.** Eine off-session-Zahlung, die Stripe mit `authentication_required` (SCA/3DS)
ablehnt, ist heute vom generischen Fehler nicht unterscheidbar:

- Beide Faelle liefern `{"type":"Error","own":{}}`.
- `stripe.js:158` nutzt `assertOk` (`:92-94`), das den Antwort-Body **nie liest** — der
  Stripe-Fehlercode geht an der Adapter-Grenze verloren.
- `assertOkWithDetail` (`stripe.js:114-128`) kennt nur `isMissingCustomerDetail`, nicht
  `authentication_required`.

**Soll.** Der SCA-Fall ist am aufgerufenen Code als eigener, benannter Fehlerzustand
erkennbar — mit derselben Mechanik, mit der `isMissingCustomerDetail` heute schon getragen
wird. Die Wurzel liegt an der Adapter-Grenze (der verworfene Stripe-Code), **nicht** im
Aufrufer: eine Umformulierung der Fehlermeldung im Aufrufer waere die verbotene
Scheinloesung (`PLAN-GATES.md` PM-1).

**Verbindlich.**

- Die beiden Testanker sind die Spezifikation — lies sie und erfuelle sie am Produkt.
- Kein Secret-Leak: der Stripe-Fehler-Body darf **nicht** roh in Logs, API-Responses oder
  MCP-Ausgaben landen. Nur der Fehlercode/-typ wird uebernommen.
- Der Ausweg fuer den Kunden gehoert benannt (das Gate heisst SCA-**DEADEND**): der Aufrufer
  muss den Zustand von "generisch fehlgeschlagen" unterscheiden koennen.

**Zulaessige Testaenderung:** keine. Beide Tests bleiben unveraendert.

---

## P2 — Wechselkurs, eine Quelle (GAP-08 x2)

**Gates:** `test/fx-single-source*.test.js` `:54` und `:63`.
**Dateien:** `src/config.js`, `.env.example`.
**Risiko:** Geld.

**Befund.** Zwei Wahrheiten fuer denselben Kurs:

- `src/config.js:1071` `usdToEur: 0.93` — **Literal**, kein `numEnv`, also nicht konfigurierbar.
- Die Provider-Achse rechnet mit `920000` Mikro = **0.92** (`config.js:404-406`).

Eine LLM-Rechnung und eine Provider-Rechnung ueber denselben Dollar ergeben verschiedene Euro.

**Soll.** **Eine** Quelle fuer den USD→EUR-Kurs, ueber `numEnv` konfigurierbar, in
`.env.example` dokumentiert; beide Achsen lesen sie.

**Verbindlich.**

- `src/config.js` ist ein Hub (Clean-Code-Audit 2026-07-17). Drei Phasen der Kette wollen an
  diese Datei (P2, P7, P9) — sie liegen deshalb in **verschiedenen Wellen**. P2 laeuft zuerst.
  Halte den Eingriff eng: eine Quelle, ihre Leser, sonst nichts.
- Env-Variablen IMMER in `src/config.js` zentralisieren UND in `.env.example` dokumentieren.
  Zusaetzlich `render.yaml` **pruefen** — aber in dieser Phase NICHT aendern (P15 haelt die
  Datei; eine Aenderung hier ist ein Wellen-Konflikt).
- **Test-`BASE_ENV`-Drift:** eine neue config-Env-Var MUSS in `BASE_ENV` (`test/helpers.js`)
  nachgezogen werden, sonst leakt die lokale `.env` in Spawn-Tests.
- Kein Kurs-Sprung als Nebenwirkung: welcher der beiden Werte der neue gemeinsame Default
  wird, ist eine bewusste Entscheidung und gehoert in den Bericht (inkl. der Frage, welche
  Achse dadurch ihren Wert aendert).

**Zulaessige Testaenderung:** keine.

**ERLEDIGT 2026-07-27 (Runde 3, gemergt).** Drei Befunde aus dem Lauf, die spaetere Phasen
angehen:

1. **Der Gate schreibt die Implementierungsform vor.** GAP-08 liest den Kurs per
   Quelltext-Regex (`^\s*usdToEur:\s*(-?\d+(\.\d+)?)\s*,` bzw. eine Ziffer direkt hinter
   `fallback:`). Eine abgeleitete Zahl (`fallback: Math.round(… * FX_MICRO_PER_UNIT)`)
   matcht nicht — der Test wird rot. Die geforderte **eine** Zahl ist mit dem eingefrorenen
   Gate also nachweislich unvereinbar. Geloest wurde stattdessen die staerkere Haelfte:
   die zweite Env-Variable `USD_TO_EUR` ist ersatzlos weg, **beide Achsen lesen
   `PROVIDER_TO_BUCKET_RATE_MICRO`**. Divergenz zur Laufzeit ist strukturell unmoeglich.
2. **Ein neues fatales Boot-Gate ist keine Loesung, sondern ein Risiko.** Die Fix-Runden 1/2
   bauten `assertFxRateCoherent` mit `process.exit(1)` — bei dashboard-managed
   Render-Services (Live != `render.yaml`) haette ein von Hand gesetzter Kurs den Dienst am
   Start getoetet. Vollstaendig zurueckgebaut. Wer eine Kohaerenz erzwingen will, nimmt die
   Struktur, nicht den Waechter.
3. **Offen, ausserhalb der Phase:** `src/boot-guard.js` traegt `PROVIDER_RATE_ANCHOR_MICRO
   = 920000` (Anker des Toleranzbandes seit LCT P4, nicht der wirksame Kurs) — eine dritte
   Stelle mit derselben Zahl. Und der Kommentar in `test/model-price-gate.test.js`
   ("Literale, keine Env-Vars") ist seither ueberholt (C2).

**Gemeinsamer Default:** 0,92 (Wert der Provider-Achse). Die KI-Achse faellt von 0,93 auf
0,92 — KI-Kosten werden rund 1,08 % niedriger in EUR gebucht.

---

## P3 — Kauf-Land-Tabelle (DID-05, DID-09)

**Gates:** `test/f1-provisioning-geo.test.js` `:128` (DID-05) und `:141` (DID-09).
**Dateien:** `src/telephony/provisioning-geo.js`.
**Risiko:** Geld.

**Befund.**

- **DID-05:** `COUNTRY_SEARCH_PARAMS` (`provisioning-geo.js:34-38`) kennt nur FR/GB/US. CA,
  IE, AU, CH, AT, ES, IT fallen auf den Default.
- **DID-09:** kein Eintrag setzt `phoneNumberType` — der **Provider-Default** entscheidet, ob
  wir `local`, `toll-free` oder `mobile` kaufen.

**Die Phase ist zweigeteilt (`PLAN-GATES.md` 2.3).**

- **DID-05 ist latent.** `render.yaml:176-177` setzt `FORCE_NUMBER_COUNTRY: "US"` — der
  Override sticht die Laender-Tabelle, jeder Tenant bekommt eine US-Nummer (Owner-Entscheidung
  2026-07-27: **bleibt so**). Der Fix ist trotzdem richtig; er wirkt in dem Moment, in dem der
  Override faellt.
- **DID-09 ist live-relevant.** Der US-Kauf laeuft heute ohne `filter[phone_number_type]`.
  Das beruehrt **Zustellbarkeit und Preis jeder einzelnen gekauften Nummer** — unabhaengig vom
  Kauf-Land. DID-09 traegt diese Phase.

**Verbindlich.**

- **Nur** `src/telephony/provisioning-geo.js`. P4 faehrt in der naechsten Welle an
  `adapters/telnyx/numbers.js` und `onboarding.js` — dort NICHT hineingreifen.
- Der `FORCE_NUMBER_COUNTRY`-Override bleibt unangetastet und behaelt seinen Vorrang vor der
  Tabelle.
- Kein Raten bei Landes-Parametern: nur Eintraege, die der Testanker verlangt bzw. die aus
  einer belegbaren Quelle stammen. Was unbekannt ist, faellt weiterhin auf den Default.

**Zulaessige Testaenderung:** keine.

---

## P4 — DID-Preis aus der Provider-Antwort (GAP-11, neu gefasst)

**Gates:** `test/f1-provisioning-geo.test.js:200` (GAP-11) — **neu gefasst**, s.u.
**Dateien:** `src/telephony/adapters/telnyx/numbers.js`, `src/onboarding.js`,
`src/telephony/provisioning-geo.js`.
**Risiko:** Geld. **Nach P3.**

**Befund (`PLAN-GATES.md` 2.2).** Der heutige Test verlangt je Kauf-Land einen hartkodierten
`holdAmountCents`-Eintrag. Der Owner haelt dagegen: *"Es gibt nichts Hartkodiertes, die Preise
werden live bei Telnyx angefragt."* Fuer die **Anruf**-Kosten stimmt das. Am **Nummernkauf**
ist es umgekehrt — und schlimmer als der Test vermutet: `searchNumbers`
(`adapters/telnyx/numbers.js:67-77`) mappt die Telnyx-Antwort auf `{ e164: d.phone_number }`
und **wirft `cost_information` (upfront_cost, monthly_cost, currency) weg**. Danach haelt der
Code die Pauschale `numberSetupFeeCents`.

**Soll (Owner-Entscheidung 2026-07-27).** Der Preis aus der Provider-Antwort wird **behalten**
und als Hold verwendet. `cost_information` reist von `searchNumbers` bis zum Hold durch und
wird am Nummern-Datensatz gespeichert.

**Verbindlich.**

- `monthly_cost` MUSS am Nummern-Datensatz **persistiert** werden — P5 liest genau diesen
  Wert. Ohne Persistenz hat P5 keinen Betrag (harte Reihenfolge `P4 → P5`).
- **Waehrung nicht verlieren:** `currency` reist mit. Ein USD-Betrag, der als EUR gebucht
  wird, ist ein stiller Geldfehler. Umrechnung — falls noetig — ueber die **eine** Kursquelle
  aus P2.
- Fehlt `cost_information` in der Antwort (aelterer Bestand, Provider-Ausfall): definierter
  Fallback auf die bisherige Pauschale, **nicht** auf `0` und **nicht** auf einen geratenen
  Wert. Der Fallback gehoert getestet.
- Die Gate-Kette am Kauf (Budget-Guard, Land-Gate) bleibt unveraendert wirksam.

**Zulaessige Testaenderung:** `test/f1-provisioning-geo.test.js:200` (GAP-11) **neu fassen**:
Hold == Preis aus der Provider-Antwort statt Tabelleneintrag. Grund: Owner-Entscheidung
2026-07-27. Der neu gefasste Test muss den Fix **tatsaechlich pruefen** (Provider-Antwort mit
`cost_information` → Hold traegt diesen Betrag), nicht nur den Defekt bestaetigen.

### Nachtrag 2026-07-28 — die Reihenfolgen-Frage ist entschieden

Der erste Anlauf lief in einen Konflikt: um den Hold auf den Provider-Preis zu setzen, muss
die **Nummern-Suche vor den Hold** — und zwei gruene Bestandstests pinnen
`prov.log === []`, also "kein Provider-Aufruf ohne reserviertes Geld"
(`test/billing-hold-capture.test.js`, `test/p4-setup-fee-hold.test.js`).

**Entscheidung: die Suche darf vor den Hold.** Begruendung am Produkt, nicht am Test:

- Der Hold ist die **einmalige Setup-Gebuehr** `NUMBER_SETUP_FEE_CENTS`, und die ist
  **aus**: `render.yaml` fuehrt `PAYMENT_ENABLED=false` und `NUMBER_SETUP_FEE_CENTS=0`.
  **Der Kunde zahlt sein Abo und sonst nichts** (Owner, 2026-07-28) — die Nummer ist
  UNSERE Kosten, gedeckt vom Abo, kein Kundenposten.
- `searchNumbers` ist eine **Preisabfrage: kostenlos, kauft nichts**. Der geldbewegende
  Schritt ist `orderNumber`, und der bleibt strikt hinter dem Hold.
- Die Praezisierung lautet daher: **kein KAUF ohne reserviertes Geld** (statt: kein Kontakt
  zum Provider). Die inhaltliche Zusage bleibt gepinnt — was wegfaellt, ist nur die zu
  weite Formulierung `prov.log === []`.

**Zusaetzlich zulaessige Testaenderung (nur diese zwei, nur diese Assertion):** in
`test/billing-hold-capture.test.js` und `test/p4-setup-fee-hold.test.js` darf die Erwartung
`prov.log === []` auf `['search:DE']` angehoben werden. **Weiterhin gepinnt bleiben MUSS:**
kein `order:`-Eintrag ohne vorherigen Hold, `failNumber`/`failed` als Ausgang, kein
`cancelHold`. Wer diese Zusage mit-entfernt, hat die Phase gebrochen.

**Nicht zulaessig bleibt:** eine Aufweichung im Code-Kommentar ohne diesen Nachtrag. Die
Praezisierung von R4 gilt, WEIL sie hier steht — nicht, weil ein Impl-Agent sie hingeschrieben
hat.

---

## P5 — DID-Monatsmiete im Ledger (GAP-06)

**Gates:** `test/metering-unit*.test.js:167`.
**Dateien:** `src/billing/metering.js`, `src/billing/webhook.js`, `src/boot.js`,
`src/worker/provisioning-orchestrator.js`.
**Risiko:** Geld. **Nach P4.** (Hochrisiko-Phase.)

**Befund.** `recordNumberMonthMeter` hat **einen** Aufrufer
(`provisioning-orchestrator.js:175`, die Aktivierung) und keinen wiederkehrenden Pfad — also
1 statt 3 Belege. Die Monatsmiete einer DID wird nie gebucht.

**Zwei Defekte, die die Phase mitnehmen muss (2026-07-27 gefunden):**

- `recordNumberMonthMeter` (`metering.js:92-100`) bucht heute
  `holdAmountForCountry(…, numberSetupFeeCents)` — die **Einrichtungsgebuehr**, nicht die Miete.
- `NUMBER_MONTHLY_COST_CENTS=92` (`.env.example:382`, `config.js:604`) ist eine hartkodierte
  Schaetzung derselben Groesse, die an dieser Stelle gar nicht benutzt wird. Nach P4/P5 ist
  sie hoechstens noch Fallback.

**VERBINDLICH — die Phase darf das NICHT selbst entscheiden (Owner, 2026-07-27):**

- **Uhr:** die Stripe-Abo-Verlaengerung `customer.subscription.updated`. Der Webhook
  **existiert** und wird bereits verarbeitet (`src/billing/webhook.js:21-24`). Die Buchung
  liegt damit auf genau der Periode, fuer die der Kunde zahlt.
- **Netz:** **ein Schritt im bestehenden stuendlichen Sweep** (`src/boot.js:424,444`) fuer
  aktive Nummern ohne Beleg im laufenden Monat — faengt Tenants ohne Abo-Ereignis ab.
- **KEIN Cron. KEIN neuer Endpunkt. KEINE neue Ressource.** (Ein bezahlter Render-Tier ist
  dadurch nicht noetig; Render-Free-Tier kann ohnehin kein preDeploy/Shell/Jobs.)
- **Betrag:** der beim Kauf uebernommene `monthly_cost` (P4), gespeichert am
  Nummern-Datensatz. **Nicht** die Einrichtungsgebuehr, **nicht** `NUMBER_MONTHLY_COST_CENTS`,
  **nicht** aus der ersten Buchung geschaetzt, **nicht** monatlich neu abgefragt.
- **Idempotenz ist Pflicht, nicht Kuer:** **ein Beleg je Nummer und Kalendermonat**, auch wenn
  **beide** Ausloeser feuern. Das ist die zentrale Invariante der Phase und gehoert unter Test
  (beide Ausloeser nacheinander → genau ein Beleg).

**Weitere Invarianten.**

- Der KI-Kosten-Akku darf **nicht pro Inkrement gerundet** werden (sonst wird das Budget-Gate
  blind) — dieselbe Disziplin gilt fuer Cent-Betraege hier: in Cent rechnen, nicht in Float-Euro.
- Der stuendliche Sweep darf durch den neuen Schritt **nicht** blockieren oder scheitern: ein
  Fehler an einer Nummer beendet den Sweep nicht.
- Eine gekuendigte/freigegebene Nummer darf **keine** Miete mehr erzeugen.

**Zulaessige Testaenderung:** keine.

### Nachtrag 2026-07-28 — nach dem ersten, blockierten Anlauf

Der erste Anlauf endete BLOCKED. Der Review hat vier Befunde gemeldet; drei davon sind
bestaetigt und aendern die Vorgaben dieser Phase.

**1. GAP-06 ist als Gate unerfuellbar und wird neu gefasst (autorisiert).** Der Test ruft
`recordNumberMonthMeter` **einmal** auf und erwartet **drei** Belege — das kann kein
Produktcode leisten; sein eigener Kommentar nennt ihn einen R2-Beweistest ("es gibt heute
keine Handlung, die ihn gruen machen koennte"). Er misst den Befund, nicht die Anforderung.

**Sollform des neu gefassten Gates** (beides MUSS drin sein, sonst ist es keine Neufassung,
sondern eine Abschwaechung):

- *Wiederkehr:* der wiederkehrende Ausloeser, ueber drei Kalendermonate gefahren, erzeugt
  fuer **eine** aktive Nummer **drei** Belege — einen je Monat.
- *Idempotenz:* derselbe Ausloeser zweimal im **selben** Monat gefahren erzeugt **einen**
  Beleg, nicht zwei.

**2. Die Idempotenz wird an der NUMMER gefuehrt, nicht am Tenant.** Der erste Anlauf zaehlte
Belege je Tenant und liess je Beleg eine beliebige aktive Nummer aus der Faelligkeit fallen.
Der Review hat daraus eine konkrete **Doppelbuchung** hergeleitet: bei zwei Nummern A und B
bucht Stunde 1 nur B (A hat keinen gelernten Preis), in Stunde 2 absorbiert A den Zaehler und
**B wird erneut gebucht**. Heute unerreichbar (`MAX_NUMBERS_PER_TENANT=1`,
`PAYMENT_ENABLED=false`) — aber der einzige Riegel ist eine Konfigurationszahl, die genau
dafuer existiert, spaeter erhoeht zu werden.

**Verbindlich:** Der Beleg MUSS die **Nummer identifizieren**; fehlt das Feld heute, gehoert
es ergaenzt. Eine Zaehlung je Tenant ist ausdruecklich **keine** zulaessige Naeherung. Der
Fall "zwei aktive Nummern, eine schlaegt fehl" gehoert getestet.

**3. Der GAP-11-Test darf angepasst werden — aber nur ERWEITERND (autorisiert).** Dass ohne
gelernten Preis **gar nicht** gebucht wird, ist richtig und von dieser Spec verlangt (die
Einrichtungsgebuehr ist ausdruecklich kein Miet-Fallback, sonst zahlt jede Bestandsnummer sie
dauerhaft als "Miete"). Der erste Anlauf hat den Test dafuer aber **umgedreht**: aus
"genau ein Beleg mit dem richtigen Betrag" wurde "kein Beleg" — und damit fiel die
Anti-Drift-Zusage weg, die nach dem R3-Capture-Mismatch eingezogen worden war.

**Verbindlich:** `test/f1-provisioning-geo.test.js` muss nach der Aenderung **beide** Faelle
pinnen — *ohne* gelernten Preis kein Beleg (fail-closed) **und** *mit* gelerntem Preis genau
ein Beleg, der diesen Preis traegt, waehrend Hold und Capture weiter aus einer Quelle kommen.
Ein Ergebnis, das nur den Nullfall pinnt, ist ein Blocker.

**4. Dateiliste.** Zusaetzlich erlaubt ist `src/store/state-ops.js` (P6 ist gemergt, die
Wellen laufen sequentiell — die urspruengliche Kollisionssorge ist erledigt). **Verboten
bleibt `src/app.js`** (Dateiliste von P14, das noch aussteht). `src/routes/stripe-webhook.js`
und `src/wiring/web-login.js` stehen in keiner Phasenliste: entweder ohne sie loesen oder je
Datei begruenden, warum es ohne sie nicht geht.

---

## P6 — Store-Vertraege + TTS-Kontingent (LANG-19, GAP-09 x2)

**Gates:** `test/f1-geo-store.test.js:192` (LANG-19), `test/tts-quota-counter.test.js:365` und
`:391` (GAP-09).
**Dateien:** `src/store/state-ops.js`, `src/tts/directive-synth.js`, `src/routes/voice.js`.
**Risiko:** Geld/Sprache. (Hochrisiko-Phase.)

**Befund LANG-19.** `isOptionalEnumOverride` (`state-ops.js:2646-2649`) prueft
`includes(value)` **ohne** `toLowerCase`; `updateSettings:2679` macht daraufhin ein **stilles
`continue`**. Ein Sprach-Override in abweichender Schreibweise wird also kommentarlos
verschluckt — der Aufrufer erfaehrt nicht, dass seine Einstellung nicht ankam.

**Befund GAP-09.**

- `directive-synth.js:64` ruft nur `store.recordTtsCharacters` (**Plattform**-Zaehler) — es
  gibt **keinen Tenant-Schreibpfad**.
- Es gibt **keinen Quota-Check vor `synthesizeSpeech`**; `recordTtsCharacters` warnt einmalig
  und kennt keinen Zustand >100 %.

**VERBINDLICH — die Phase darf das NICHT selbst entscheiden (Owner/PM-5):** Bei **erschoepftem
Kontingent** erfolgt **Degradation auf Azure-`<Say>`**, **NICHT** eine Sperre. Ein Anruf ohne
Stimme ist bei einem Produkt, dessen einziger Zweck Sprechen ist, der schlimmere Ausgang als
eine schlechtere Stimme. Der Anruf laeuft weiter, nur ohne ElevenLabs.

**Weitere Invarianten.**

- **Glueckspfad mitpruefen:** unterhalb des Kontingents bleibt der ElevenLabs-Pfad **byte-gleich**
  wie heute. Die neue Sperre darf keinen laufenden Betrieb umleiten.
- Die Degradation muss **beobachtbar** sein (Log/Zustand), sonst faellt sie still aus.
- Der Tenant-Zaehler tritt **neben** den Plattform-Zaehler, er ersetzt ihn nicht.
- Fuer LANG-19: das stille `continue` ist die Wurzel — ein abgelehnter Override darf nicht
  lautlos verschwinden. Gross-/Kleinschreibung darf kein Grund fuer Datenverlust sein.
- Die gesprochenen DE-Strings bleiben ASCII-transliteriert (`i18n/locales.js` schreibt das
  vor; FR hat bewusst Akzente). Keine Umlaute in gesprochene DE-Texte einschmuggeln.

**Zulaessige Testaenderung:** keine.

---

## P7 — Absender-Herkunft + Boot-Guards (GAP-19 x2, OUT-14, `TELNYX_CONNECTION_ID`-Guard)

**Gates:** `test/outbound-gates-order.test.js:448` (GAP-19), `test/boot-prod-footguns.test.js:67`
(GAP-19), `test/outbound-gates-order.test.js:519` (OUT-14).
**Dateien:** `src/telephony/outbound-gates.js`, `src/boot.js`.
**Risiko:** **Safety**. **Nach P2.** (Hochrisiko-Phase.)

**Befund.**

- **GAP-19a:** voller Kettendurchlauf mit **US-DID + DE-Tenant + DE-Ziel** ergibt
  `denial === null` — die Herkunft der Absendernummer wird nicht gegen das Ziel geprueft.
- **GAP-19b:** `bootLog` (`src/boot.js`) enthaelt `FORCE_NUMBER_COUNTRY` **nicht** — ein
  Override, der jedem Tenant eine US-Nummer gibt, ist beim Start unsichtbar.
- **OUT-14:** der Kommentar `outbound-gates.js:466` nennt "16 Glieder", `gates.length` ist
  **17**. Eine Zaehlung, die von der Wirklichkeit abweicht, ist genau die Sorte
  Invariante-per-Konvention, die dieses Repo schon einmal teuer bezahlt hat.

**Zusatzauftrag (Owner-Entscheidung 2.1): Boot-Guard auf `TELNYX_CONNECTION_ID`.** Restluecke
im Nummern-Lebenszyklus: `if (connectionId) body.connection_id = connectionId` — ist die
Config leer, geht die Nummer **ohne Voice-Routing** raus und trotzdem auf `active`. Der Guard
faengt das beim Start ab, statt es am ersten echten Anruf zu entdecken.

**Verbindlich.**

- **Safety-Gates NIE aufweichen.** GAP-19 fuegt eine Pruefung **hinzu**; bestehende Glieder
  bleiben in Reihenfolge und Wirkung unveraendert.
- **Glueckspfad zwingend mittesten:** der erlaubte Fall (Herkunft passt zum Ziel) bleibt
  erlaubt. Eine zu breite Sperre wuerde live jeden Outbound-Anruf toeten — heute hat **jeder**
  Tenant eine US-Nummer (`FORCE_NUMBER_COUNTRY: "US"` bleibt), waehrend Ziele in DE liegen.
  **Lies den Testanker genau**: was er verlangt, ist die Obergrenze der neuen Sperre.
  Ueberschreitet der Fix diese Grenze, ist er ein Blocker.
- Der Boot-Guard muss zwischen "fehlt" und "gesetzt" unterscheiden und darf einen gesunden
  Start nicht verhindern; ob er `fatal` ist, richtet sich nach dem bestehenden Muster in
  `boot.js` — ein Live-Dienst, der nicht mehr startet, ist der teuerste Fehlausgang.
- Die Zaehlung in OUT-14 wird **nicht** per Kommentar-Korrektur "gefixt", sondern so, dass die
  Zahl nicht wieder auseinanderlaufen kann.
- `src/boot.js` beruehrt auch P5 — die beiden liegen deshalb in verschiedenen Wellen. In
  dieser Welle haelt **P7** die Datei.

**Zulaessige Testaenderung:** `test/did-reputation-metric.test.js` — **beide Tests stilllegen**
(GAP-23, falsch spezifiziert: Zeile 32 setzt `maxNumbersPerTenant: 9` und schaltet damit genau
den Schutz ab, dessen Fehlen der Test beklagt). **Ersatz:** ein Boot-Guard-Test fuer
`TELNYX_CONNECTION_ID`. Die Deckung bleibt ueber `test/number-lifecycle.test.js:129` und
`test/bk3-auto-provision.test.js:125-130` erhalten (beide pinnen die Ein-Nummer-Grenze gruen).

---

## P8 — Geo-Backfill-Migration (GAP-34 x2)

**Gates:** `test/f1-geo-store.test.js:399` und `:421`.
**Dateien:** `src/db/migrate.js`.
**Risiko:** **Migration** — der Schaden waere still.

**Befund.** `migrate()` (`migrate.js:160-167`) fasst `number.language` nirgends an; es gibt
keine Vorwahl-Ableitung fuer Bestandszeilen.

**VERBINDLICH — die Phase darf das NICHT selbst entscheiden (Owner/PM-3):**

- **Nur** Zeilen mit **Altwert `de` UND bekanntem Land** werden angefasst.
- **Ohne `e164`-Anker bleibt das Feld leer** (Prinzip E2, "kein Raten").
- Die Migration ist **zweimal hintereinander lauffaehig** (idempotent).

**Warum so eng:** eine zu breite Migration ueberschreibt eine **explizit gesetzte**
Tenant-Sprache — genau den Wert, mit dem der Owner am 27.07. live den DE-Anruf hergestellt hat.
Der Schaden ist still: der Agent spricht die falsche Sprache, niemand sieht einen Fehler.

**Weitere Invarianten.**

- Die Migration laeuft gegen **Postgres** (RLS/FORCE-RLS beachten) und muss zum
  json-Backend-Verhalten passen; `npm test` faehrt beide Backends.
- Kein Datenverlust an Nachbarfeldern; `number.country` nur setzen, wo es ableitbar ist.
- Ein Test muss den **doppelten Lauf** beweisen (zweiter Lauf aendert nichts).

**Zulaessige Testaenderung:** keine.

---

## P9 — Stimme regional + Locale-Felder (VOICE-12, GAP-31)

**Gates:** `test/telnyx-elevenlabs-render.test.js:80` (VOICE-12),
`test/locale-field-consumers.test.js:36` (GAP-31).
**Dateien:** beide `render.js` (Twilio- und Telnyx-Adapter),
`src/telephony/adapters/telnyx/elevenlabs-voice.js`, `src/telephony/registry.js`,
`src/i18n/locales.js`, `src/config.js`.
**Risiko:** Sprache. **Nach P2 und P7** (beide an `config.js`).

**Befund.**

- **VOICE-12:** `sayVoiceAttrs` (`render.js:73-76`) liest nur `opts.elevenLabs.voiceId` und
  ignoriert `voiceProfile` — eine Stimme fuer alle Sprachen.
- **GAP-31:** `grep -rn "\.sttLocale\b" src/` → **0 Treffer**. Beide Renderer fuehren
  stattdessen eine hart kodierte `VOICE_MAP`; das Locale-Feld existiert, wird aber von
  niemandem gelesen.

**VERBINDLICH (Owner-Entscheidung 2026-07-27).** Die Stimme loest **regional** auf:
**US-Stimme fuer die USA, britisch als Default fuer alles uebrige Englisch.** Die Phase ist
dadurch groesser als eine Tabelle — sie beruehrt `SUPPORTED_LANGUAGES` und die
Locale-Aufloesung.

**IDs (bindend):**

| Sprache | Voice-ID |
| --- | --- |
| `de` | heutige `ELEVENLABS_VOICE_ID` (unveraendert) |
| `fr` | `FFXYdAYPzn8Tw8KiHZqg` |
| `en-US` | `EST9Ui6982FZPSi7gCHi` |
| `en-GB` | `wOPou4MhRIYEqQHVxjmp` (**Default** fuer Englisch) |

**Weitere Invarianten.**

- **`de-DE` ist empirisch korrekt und darf NIE auf `de` zurueckfallen** (Live-Beleg
  Outbound-Dialog). Die Regionalaufloesung darf bestehende, funktionierende Locales nicht
  vereinfachen.
- Die deutsche Stimme aendert sich **nicht**.
- Gesprochene DE-Strings bleiben ASCII-transliteriert (`i18n/locales.js`), FR behaelt bewusst
  Akzente.
- `sttLocale` bekommt einen echten Leser — die `VOICE_MAP`-Duplikation faellt, statt neben der
  neuen Aufloesung weiterzuleben (S2-Duplizierung waere ein Clean-Code-Blocker).

**Zulaessige Testaenderung:** keine.

---

## P10 — MCP-Oberflaeche (MCP-14, LANG-15)

**Gates:** `test/mcp-tools-i18n.test.js:137` (MCP-14),
`test/p15-mcp-tool-descriptions-en.test.js:149` (LANG-15).
**Dateien:** `src/mcp-tools.js`.
**Risiko:** Sprache.

**Befund.**

- **MCP-14:** `mcp-tools.js:688/691/717` halten `"Keine offenen Action Items."`, `"(Termin) "`
  und `` `${e.start} bis ${e.end}` `` **hart deutsch** — in einer Oberflaeche, deren Weltdefault
  `en` ist.
- **LANG-15:** `mcp-tools.js:494` traegt weiterhin einen `language`-Parameter mit
  `describe("… default 'de'.")`.

**Verbindlich.**

- **Audio laeuft NIEMALS durch MCP** — nur Transkripte/Status. Unveraendert.
- Keine Secrets in MCP-Tool-Ausgaben.
- Der Weltdefault ist `en` (Produktentscheidung 2026-07-25, "WELTWEIT statt US-first").
- Datums-/Zeitformate folgen der aufgeloesten Sprache, nicht einer festen Schablone.

**Zulaessige Testaenderung:** `EXPECTED_MARKERS` in
`test/p15-mcp-tool-descriptions-en.test.js` — der entfernte `language`-Parameter ist dort als
Marker gelistet.

### Nachtrag 2026-07-28 — die Spec-Luecke ist geschlossen

Der Review hat die Phase zu Recht blockiert: **unter der obigen Liste war P10 gar nicht
abschliessbar.** LANG-15 verlangt, `place_call.language` aus dem MCP-Schema zu entfernen —
aber ein zweiter, heute gruener Bestandstest pinnt den Feldsatz des Tools **einschliesslich
dieses Feldes**: `PLACE_CALL_SHAPE` in `test/place-call-context-bridge.test.js`
("place_call-Schema bleibt strukturell unveraendert"). Beides gleichzeitig geht nicht.

**Entscheidung: die Liste wird erweitert, LANG-15 bleibt in P10.** Begruendung:

- Der Parameter ist **nachweislich wirkungslos** — der gruene Mechanismus-Test haelt fest,
  dass `body.language` serverseitig ignoriert wird und der Geo-Anker gewinnt. Entfernt wird
  also eine Attrappe, kein Verhalten.
- `PLACE_CALL_SHAPE` existiert, um **unabsichtliches** Schema-Driften zu fangen. Gegen eine
  ausdrueckliche Entscheidung, ein totes Feld zu streichen, kann ein solcher Waechter nicht
  stechen — sonst friert er den Ist-Zustand fuer immer ein.

**Zusaetzlich zulaessige Testaenderung (nur diese):** `PLACE_CALL_SHAPE` und der zugehoerige
Testtitel in `test/place-call-context-bridge.test.js` duerfen um das Feld `language`
bereinigt werden. **Gepinnt bleiben MUSS:** der uebrige Feldsatz von `place_call` samt
Optionalitaet — der Test bleibt ein Schema-Waechter, er wird nur um das gestrichene Feld
korrigiert.

**Vorher zu pruefen (Vertrag nach aussen):** `/mcp` bedient echte Clients. Ein Aufruf, der
`language` weiterhin mitschickt, darf danach **nicht hart abgelehnt** werden — bisher wurde
das Feld stillschweigend ignoriert, und genau dieses Verhalten bleibt die Zusage. Wenn das
Schema unbekannte Felder zurueckweist, ist die Toleranz ausdruecklich herzustellen und zu
testen.

---

## P11 — Telefonie-Kleinvertraege (GAP-24, GAP-26)

**Gates:** `test/telnyx-p8-inbound.test.js:135` (GAP-24),
`test/max-duration-live-cap.test.js:94` (GAP-26).
**Dateien:** `src/telnyx-inbound.js`, `src/telephony/call-lifecycle.js`.
**Risiko:** Sprache/Ops.

**Befund.**

- **GAP-24:** `telnyx-inbound.js:41` ruft `vc.startAssistant()` **ohne** `language` — obwohl
  der Adapter es kann (`voice.js:761`). Der Assistant startet damit in der Default-Sprache,
  nicht in der des Tenants.
- **GAP-26:** `terminateCappedCall` (`call-lifecycle.js:50-70`) ruft **nie**
  `recordFailureReason`. Ein wegen Maximaldauer beendeter Anruf ist hinterher nicht von einem
  beliebigen Abbruch unterscheidbar — genau die Forensik-Luecke, die dieses Repo schon einmal
  Tage gekostet hat.

**Verbindlich.**

- Die Max-Dauer-Sperre selbst bleibt unveraendert wirksam (absolute Regel). GAP-26 fuegt nur
  die **Begruendung** hinzu.
- Der Sprach-Durchstich in GAP-24 darf keine neue Sprachquelle erfinden: die Sprache kommt aus
  dem bestehenden Tenant-Kontext.

**Zulaessige Testaenderung:** der Byte-Identitaets-Test ueber `telnyx-p8-inbound.test.js:135` —
er pinnt genau den Aufruf **ohne** `language`; die Kopplung ist im Testkommentar `:128-131`
dokumentiert.

---

## P12 — Deutsche Klartexte am Server (WEB-10, WEB-13)

**Gates:** `test/self-service-error-codes.test.js:81` (WEB-10), `test/web-auth.test.js:352`
(WEB-13).
**Dateien:** `src/self-service-routes.js`, `src/routes/api-billing.js`, `src/web-auth.js`.
**Risiko:** Web. **Vor P14.**

**Befund.**

- **WEB-10:** `self-service-routes.js:366` liefert `{ error: "PUBLIC_URL fehlt" }` — ein
  deutscher Klartext **und** ein Env-Variablen-Name in einer Kunden-Antwort (zweifach falsch:
  Sprache und Interna-Leak). Gleiches Muster in `src/routes/api-billing.js:55`.
- **WEB-13:** `web-auth.js:32-37` `SESSION_EXPIRED_PAGE` ist deutsches HTML mit `lang="de"`.

**Verbindlich.**

- **Auth fail-closed bleibt.** WEB-13 aendert den **Text** der Sitzungs-abgelaufen-Seite, nicht
  ihre Wirkung. Keine Lockerung von `web-auth.js`.
- Fehler-Antworten transportieren **Codes**, keine Interna. Kein Env-Variablen-Name in einer
  Kunden-sichtbaren Antwort.
- `/app` bleibt englisch (Produktentscheidung 7.15, getragen von PAY-11/DID-18).
- P12 haelt `src/self-service-routes.js` in dieser Welle; P14 folgt in der naechsten Welle an
  derselben Datei — hier NICHT vorgreifen (keine Rueckkehr-Adressen anfassen).

**Zulaessige Testaenderung:** `test/web-auth.test.js:337` — der AM2-Ist-Pin
`assert.match(res.body, /Sitzung abgelaufen/)`; er pinnt genau den Zustand, den WEB-13 abloest
(`:346` benennt WEB-13 selbst als Gegenstueck).

---

## P13 — Dashboard `apps/web` (WEB-07, WEB-19, GAP-30)

**Gates:** `test/dashboard-i18n-surface.test.js:40` (WEB-07), `:79` (WEB-19), `:89` (GAP-30).
**Dateien:** `apps/web/src/lib/api.js`, `apps/web/src/components/…/SettingsIsland.astro`.
**Risiko:** Web. **Vor P14.**

**Befund.**

- **WEB-07:** `grep -rn agentStyle apps/web/src` → **0 Treffer**. Die Persoenlichkeit des
  Assistenten ist im neuen Dashboard nicht einstellbar.
- **WEB-19:** `grep -rn privateNumber apps/web/src public/tenant.html` → **0 Treffer**. Die
  Server-Seite ist fertig, die Oberflaeche fehlt.
- **GAP-30:** die Feldlisten laufen auseinander — `api.js:442-446` fuehrt
  `[agentName, allowBooking, allowCalendar, language]`, `self-service.js:20` erwartet
  `[agentName, agentStyle, language]`.

**Verbindlich.**

- **Marketing-Website vs. Dashboard:** `apps/web` traegt beides. Diese Phase aendert das
  **Dashboard** (`/app`), nicht die Marketing-Seiten. Design-/Content-Aenderungen an der
  Website laufen ueber `staging` (`docs/RUNBOOK-LAB-LIVE.md`) — hier nicht beruehren.
- **`/app` bleibt englisch** (Produktentscheidung 7.15). Neue Bedienelemente also in Englisch.
- **Bindende Web-Vorgaben:** EN-Marketing / DE-Legal, USD, Starter $4.99/30min,
  Business $9.99/120min — hier nicht anfassen, aber auch nicht versehentlich brechen.
- `privateNumber` ist ein **sensibles Feld**: es ist die Privatnummer des Kunden. Sie darf
  nicht in Logs, nicht in Fehlermeldungen und nicht in Marketing-Seiten landen. Wichtig auch
  fachlich: die **Absendernummer** MUSS eine Provider-DID sein, NIE die Privatnummer — die UI
  darf diesen Eindruck nicht erzeugen.
- Die drei Gates teilen sich eine Wurzel (Feldliste + fehlende Bedienelemente): **eine**
  Feldliste als Quelle, nicht drei Einzelpflaster (S2-Duplizierung waere ein Blocker).
- `public/tenant.html` **nicht** anfassen — die Datei loescht P14 in der naechsten Welle.

**Zulaessige Testaenderung:** keine.

---

## P14 — Altes Dashboard loeschen

**Gates:** keine eigenen (WEB-08 und FMT-15 x2 **entfallen ersatzlos**).
**Dateien:** `public/tenant.html`, `src/app.js`, `src/self-service-routes.js`,
`src/middleware.js`, 21 Testdateien.
**Risiko:** **Geld-Pfad!** **Nach P12 und P13.**

**Auftrag.** `public/tenant.html` loeschen (Owner-Entscheidung 2026-07-27).

**EIGENE ABNAHMEBEDINGUNG (PM-6) — ohne diesen Nachweis kein Merge:** Die
**Stripe-Rueckkehr-Adressen** (`src/self-service-routes.js:46-57`, heute
`/tenant.html?card=ok`, `?sub=ok`, …) muessen auf **`/app`** umgestellt sein **UND** `/app`
muss die Parameter **auswerten**. Faellt die Datei ohne Ersatz, landet ein Kunde nach dem
Hinterlegen seiner Karte auf einer Seite, die ihm nicht bestaetigt, dass es geklappt hat —
oder auf einem 404. Der Nachweis gehoert in den Bericht, mit der Stelle in `/app`, die die
Parameter liest.

**Verbindlich.**

- **Sicherheits-Nebenwirkung, ausdruecklich NICHT Teil dieser Phase:** `src/middleware.js:4`
  lockert die CSP **wegen** dieser Datei (Inline-`<script>`/`onclick`). Faellt sie, koennte
  die CSP enger werden — das ist ein **Folgeauftrag**, keine Aufgabe hier. Die CSP in dieser
  Phase **nicht** aendern.
- Kein `git add -A` (dieses Repo hat sich daran schon einmal einen Stripe-Kundendump in einen
  Commit geholt). Geloeschte Datei explizit mit `git rm` erfassen.
- Die 21 Testdateien, die `public/tenant.html` lesen, werden angepasst — die gemessene
  Oberflaeche existiert nach der Loeschung nicht mehr.

**Zulaessige Testaenderung:** `test/bk1-plan-price-format.test.js` (FMT-15 x2) und
`test/dashboard-i18n-surface.test.js:47` (WEB-08) **stilllegen**; die **21 Testdateien**, die
`public/tenant.html` lesen, anpassen.

---

## P15 — Deploy-Filter (GAP-37)

**Gates:** `test/render-buildfilter.test.js:83`.
**Dateien:** `render.yaml` — **NUR** `buildFilter.ignoredPaths`.
**Risiko:** Ops. Kein Live-Effekt (reine Blueprint-Kohaerenz).

**Befund.** `ignoredPaths` enthaelt `apps/web/**`, obwohl derselbe Service `buildCommand` +
`WEB_DIST_DIR=apps/web` traegt. Der Blueprint widerspricht sich selbst.

**VERBINDLICH — die Phase darf das NICHT selbst entscheiden (Owner/PM-7):** In `render.yaml`
wird **ausschliesslich** `buildFilter.ignoredPaths` geaendert. **Jede weitere geaenderte Zeile
ist ein Blocker.** Grund: `render.yaml` fuehrt `MULTI_TENANT=false` und
`SELF_SERVICE_ENABLED=false`, waehrend live **beides `true`** ist (W3, gemessen). Wer die Datei
nach einer breiteren Aenderung anwendet, schaltet Multi-Tenancy und Self-Service ab.

Beweispflicht im Bericht: `git diff <base>..<branch> -- render.yaml` zeigt **nur** Zeilen
innerhalb von `buildFilter.ignoredPaths`.

**Gemessener Kontext (2026-07-27, Render-API).** Der Gateway steht auf `autoDeploy: "no"` /
`autoDeployTrigger: "off"`, und sein Build-Kommando enthaelt `npm --prefix apps/web run build`.
Ein `buildFilter` wirkt nur auf Auto-Deploys — er wirkt hier also **gar nicht**, und jeder
manuelle Deploy baut `apps/web` ohnehin neu. Die befuerchtete Folge ("`/app` bleibt veraltet")
tritt live **nicht** ein.

**Zulaessige Testaenderung:** `test/render-buildfilter.test.js:30` (W0) **neu fassen** — die
Zeile prueft heute das **Gegenteil** von GAP-37 an derselben Blueprint-Zeile
(`:30` `assert.match(… apps/web/\*\*)` gegen `:83` `assert.doesNotMatch(… apps/web/\*\*)`).
