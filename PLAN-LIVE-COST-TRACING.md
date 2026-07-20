# PLAN-LIVE-COST-TRACING — Ist-Kosten statt Schaetzung

Stand: 2026-07-20. Basis: `master @ 9fbb7ef`.
Vorgaenger-Kette: PLAN-BUDGET-AXES P1-P7 gemergt (`450fd12`/`590a6c0`, Suite 2638/0;
das Dokument `PLAN-BUDGET-AXES.md` liegt seit `a0431fa` nur noch in der Historie — s. Kasten
in Kapitel 8, Entscheidung 4),
**nicht deployed**, `BUDGET_MONTH_ENABLED=false`. Dieses Dokument setzt das NICHT als
wirksam voraus (s. Kapitel 7).

---

## 1. Lage

Der Dienst bucht Anrufkosten als `minuten * konfigurierter_tarif` — auch **nach** dem
Anruf. `src/billing/metering.js:50-55` ruft dieselbe Funktion `tariffCentsPerMin(to)`
(`src/telephony/outbound-gates.js:144-148`), die schon die Vorab-Reserve berechnet hat.
An **keiner** Stelle im Repo wird je gegen einen Provider-Preis geprueft: es gibt keinen
Treffer fuer `usage_reports`, `detail_records`, `realCost` oder aehnliches (R1 §5).
`usage.costCents` ist damit kein Kostenwert, sondern ein Tarif-Proxy — eine Groesse, die
aussieht wie Geld und wie Geld benutzt wird (Budget-Gate, Dashboard, Reserve), aber nie
gegen die Wirklichkeit gehalten wurde.

Der konfigurierte Tarif war `VOICE_TARIFF_DOMESTIC_CENTS=20`. `.env.example` bezeichnet
ihn selbst als "Worst-Case-Default, live mit dem Provider-Tarif abgleichen". Der Abgleich
ist nie erfolgt. Gemessen wurden 3,9 ct/min Telefonie — **USD-Cent**, weil Telnyx in USD
abrechnet (Beleg in Kap. 4). Der Tarif 20 ist dagegen EUR-nativ. Zum Plan-Kurs 0,92
(`PROVIDER_TO_BUCKET_RATE_MICRO`, s. P2) entsprechen die 3,9 USD-ct genau **3,59 EUR-ct/min**;
der Tarif lag also um **Faktor 5,6** daneben, nicht um 5,1. Das Ergebnis: 779 gebuchte
(EUR-)Cent, wo 282 USD-Cent real angefallen waren, und ein eingefrorener Outbound-Betrieb
gegen einen Deckel, den echtes Geld nie erreicht hatte.

### Praezisierung der Schwere

Zwei Korrekturen an der Erst-Rahmung dieses Vorfalls, beide gegen die eigene Erzaehlung:

1. **Ueberbuchung ist fail-CLOSED, nicht fail-open.** Ein zu hoher Tarif bucht zu viel,
   reserviert zu viel und blockt zu frueh. Das ist teuer an Nutzen, aber nie an Geld. Die
   Dringlichkeit dieses Plans folgt **nicht** aus akuter Kostengefahr, sondern daraus, dass
   die Zahl blind ist: sie koennte genauso gut in die andere Richtung falsch sein, und
   niemand haette es gesehen. Wer eine Groesse nie misst, hat keinen Anspruch darauf, dass
   ihr Vorzeichen guenstig ist.
2. **Der genannte "Faktor 2,1" laesst sich aus den genannten Zahlen nicht reproduzieren.**
   779 / 282 = 2,76. Ob die Differenz aus unterschiedlichen Bezugsfenstern (Lebenszeit-Topf
   vs. 31-Tage-Messfenster) oder aus einem Rechenfehler stammt, ist hier **UNBELEGT**. Der
   Plan haengt an keiner Stelle an diesem Faktor; er haengt an den ct/min aus Kapitel 2.

---

## 2. Messung (Beweis, nicht neu herleiten)

Quelle: Telnyx Usage Reports,
`GET /v2/usage_reports?product=<p>&dimensions=<d>&metrics=cost,billed_sec,completed&start_date=<ISO>&end_date=<ISO>`
(Fenster max. 31 Tage), Fenster 2026-06-19T00:00:00Z bis 2026-07-20T00:00:00Z, sowie
`GET /v1/user/subscription` bei ElevenLabs (read-only) und die Prod-DB.

### 2.1 Variable Kosten je Gespraechsminute

| Kostenart | gemessen | heute gebucht? | Schreibstelle |
| --- | --- | --- | --- |
| Telefonie (`sip-trunking` + `call-control`) | 3,9 ct/min | ja, als `minuten * tarif` | `metering.js:50-55` |
| Speech-to-Text (`speech-to-text`, Deepgram im Gather) | 0,6 ct/min | **NEIN** | — |
| Text-to-Speech (`text-to-speech`, Telnyx) | 0,6 ct/min | **NEIN** | — |
| `recording` + `inference` | 0,05 ct/min | **NEIN** | — |
| Claude-Tokens | 0,27 ct/min | ja, exakt (Mikro-Cent) | `llm-usage.js:61-65` |
| **Variabel gesamt** | **5,4 ct/min** | — | — |
| `ai-voice-assistant` (nur Assistant-Pfad) | **+5,0 ct/min** | **NEIN** | s. 2.2 |
| ElevenLabs | 6,00 USD/Monat FIX | **NEIN** | s. 2.3 |
| DID-Miete | **1,00 USD/Monat je Nummer (Listenpreis, belegt)** | **NEIN** | s. 2.4 |

**Alle ct/min-Werte dieses Kapitels sind USD-Cent** (Telnyx-Kontowaehrung, Beleg in Kap. 4);
die Tarif- und Deckel-Groessen des Repos sind dagegen EUR-Cent. Wo dieses Dokument beide
nebeneinanderstellt, steht der Kurs dabei oder die Naeherung ist als solche gekennzeichnet.

Von den 5,4 ct/min sind 0,27 bereits ueber `trackUsage` erfasst. Der Voice-Anteil, den ein
Tarif abbilden muesste, ist damit **5,13 ct/min** — nicht 20.

**Die 3,9 ct/min sind ein Aggregat ueber alle Ziele des Messfensters und NICHT nach Zielland
aufgeschluesselt — das ist UNBELEGT.** `tariffCentsPerMin` deckt mit dem einen Skalar
`voiceTariffDomesticCents` aber **drei** Laender ab (`VOICE_TARIFF_DOMESTIC_PREFIXES =
["+49","+33","+44"]`, `config.js:99`). Der Verkehr des Fensters war ueberwiegend DE; fuer
`+33` und `+44` liegt **keine** eigene Messung vor. Jede Aussage dieses Plans ueber "den
gemessenen Satz" gilt deshalb zunaechst nur fuer `+49`. P4b zieht daraus die Konsequenz
(praefix-weise Freigabe), P5 macht die fehlende Datenlage je Praefix sichtbar.

**Die Namen in der Klammerspalte sind `product`-Werte der Usage-Reports-Achse, auf der
gemessen wurde — NICHT die `record_type`-Enum-Werte der Detail-Records-API.** Beide Achsen
sind verschieden benannt (die Detail-Records-API fuehrt u.a. abgekuerzte Formen), und
welcher Enum-Wert je Kostenart dort tatsaechlich erscheint, ist **UNBELEGT**. Der Plan
schreibt diese Namen deshalb an keiner Stelle als Code-Konstante fest: die Pflicht-Menge
`COST_TRUING_REQUIRED_RECORD_TYPES` wird in P3 **empirisch aus echten API-Antworten**
abgeleitet, nicht aus dieser Tabelle abgeschrieben. Wo dieses Dokument in Prosa von
"speech-to-text"/"text-to-speech" spricht, meint es die Kostenart, nicht den Enum-Wert.
Ein falsch abgeschriebener Name traefe auf den fail-closed-Pfad (kein Typ passt ->
`'incomplete'` -> keine Rueckerstattung), waere also teuer an Nutzen und nicht an Geld —
aber er waere vermeidbar, und P3 vermeidet ihn durch Messen.

### 2.2 Neu gefunden: `ai-voice-assistant` als eigenstaendige Position

Im Messfenster: 0,95 USD ueber 17 verbundene Calls / 19 abgerechnete Minuten, exakt flach
0,05 USD je angefangener Minute (Minuten aufgerundet, min. 1 je verbundenem Call). Das ist
**additiv** zu `sip-trunking` + `call-control` + STT + TTS. Sobald der Telnyx-Assistant-Pfad
(`src/telephony/adapters/telnyx/voice.js:234-244`) breit genutzt wird, verdoppeln sich die
variablen Kosten nahezu (5,4 -> 10,4 ct/min). Live laeuft heute die Budget-Engine; die 19
Minuten stammen aus dem gescheiterten Assistant-Experiment. Das ist keine aktuelle
Kostenposition, sondern eine **scharfe Mine unter einem Feature-Flag**.

**Stand nach Owner-Entscheidung 5 (2026-07-20):** der Assistant-Pfad wird verworfen, nicht
nur ausgelassen. Die Mine bleibt aber so lange scharf, wie der Code sie tragen kann —
deshalb rechnet P4b bis zum vollzogenen Rueckbau unveraendert gegen die 10,4 ct/min.

### 2.3 ElevenLabs (Live-Abruf 2026-07-20)

| Feld | Wert |
| --- | --- |
| tier | starter |
| character_limit | 39.981 Zeichen/Monat |
| character_count | 2.805 (7,0 %) |
| Reset | 2026-08-03, 10:50 UTC |
| naechste Rechnung | 6,00 USD Subtotal (714 US-Cent inkl. Steuer) |

Der Fixpreis 6,00 USD/Monat ist damit **belegt**. Global, nicht pro Tenant
(`src/config.js:228-246`, keine Tenant-Ueberschreibung).

### 2.4 DID-Miete: Rechnungsposten nicht abrufbar, Listenpreis sehr wohl

**Korrektur gegenueber der ersten Fassung dieses Kapitels, die "nicht per API messbar" und
"Betrag UNBELEGT" behauptete. Das war zu stark.** Nachgemessen am 2026-07-20 (read-only):

| Endpunkt | Ergebnis |
| --- | --- |
| `GET /v2/usage_reports/options` | 36 Produkte, **kein** Nummern-/DID-Produkt |
| `GET /v2/phone_numbers` | 3 aktive Nummern, Typ `local`, Land US — **kein** Kostenfeld (nur `billing_group_id`) |
| `GET /v2/number_orders` | Kaufauftrag **ohne** Preisangabe |
| `GET /v2/billing_groups` | leer (0 Ergebnisse) |
| `GET /v2/invoices/{id}` | nur Metadaten, keine Line-Items |
| `v2/ledger`, `v2/account_transactions`, `v2/monthly_charges` | 404 |
| `GET /v2/available_phone_numbers?filter[country_code]=US` | **`cost_information: { monthly_cost: "1.00000", upfront_cost: "1.00000", currency: "USD" }`** |

Praezise formuliert: **der Rechnungsposten — was uns tatsaechlich belastet wurde — ist per
API nicht abrufbar; der LISTENPREIS je Nummerntyp ist es.** Fuer US-Local: **1,00 USD/Monat
plus 1,00 USD einmalig**, bei 3 aktiven Nummern also **3,00 USD/Monat Listenpreis**. Telnyx
fuehrt die tatsaechliche Belastung weiterhin als "Monthly Recurring Charges" nur im Portal.

Damit faellt auch die alte Begruendung "nicht messbar, also nicht zurechenbar": pro Tenant
gilt strikt **eine** Nummer, die Miete ist also sehr wohl **pro Tenant zurechenbar**. Die
Schlussfolgerung dieses Plans bleibt trotzdem, dass sie **nicht** in `costCents` gehoert —
aber aus vier anderen, staerkeren Gruenden (Owner-Entscheidung 6, Kapitel 8; ausgefuehrt in
P7).

Quelle fuer den Plan: `cost_information.monthly_cost` aus dem
`available_phone_numbers`-Endpunkt. Gepflegt wird der Wert als Konfiguration
(`NUMBER_MONTHLY_COST_CENTS`, s. Anhang) und **nicht** je Boot live abgerufen — eine
Anzeige-Groesse rechtfertigt keine Netzabhaengigkeit im Startpfad, und der Listenpreis
bewegt sich in Jahren. Der Endpunkt ist ab hier die belegte Herkunft des Werts, nicht mehr
ein Ablesen im Portal.

### 2.5 Widerlegte Hypothesen

| Hypothese | Befund |
| --- | --- |
| "Der Provider-Webhook traegt die Kosten" | NEIN. `call.hangup` hat kein Kostenfeld; unser eigener Reader `webhook-events.js:41-53` liest nur `CallDuration` + Hangup-Ursachen. |
| "`usage_reports` reicht fuer die Abrechnung" | NEIN. Nur aggregiert nach Dimensionen, kein Einzel-Call. |
| "Die CDR-Usage-Reports-API liefert Kosten im JSON" | NEIN. Nur Report-Metadaten + CSV-URL. |
| "KI ist der Kostentreiber" | NEIN. Claude ist ~5 % der variablen Kosten (0,27 von 5,4). Die Telefonie dominiert mit ~72 % (3,9 von 5,4). |
| "83 Zeichen/Minute ist eine gemessene Groesse" | NEIN, **UNBELEGT**. Keine Konstante im Code; reale Agenten-Turns liegen bei 100-190 Zeichen. S. D7. |
| "Die Tenant-Decken stehen auf 3 / 9 EUR" | NEIN. Im Code steht **ein flacher 600-ct-Default fuer alle** (`config.js:387`). 3/9 EUR ist eine Owner-Entscheidung ohne Code-Entsprechung. S. D8. |

### 2.6 Die einzige Quelle mit Einzel-Call-Granularitaet

`GET /v2/detail_records?filter[record_type]=<typ>` liefert **pro Datensatz** `cost`, `rate`,
`currency`, `rate_measured_in`. Das ist der einzige Endpunkt, auf dem Stufe 1 ueberhaupt
baubar ist. **Verzug bis zur Verfuegbarkeit: keine dokumentierte SLA gefunden — UNBELEGT.**
Empirisch erscheinen Calls vom Vortag bereits am Folgetag, also Stunden statt Tage; das ist
eine Beobachtung, keine Zusicherung, und der Entwurf darf sich nicht darauf stuetzen.

---

## 3. Befunde

| ID | Befund | Beleg | Schwere | Behoben in |
| --- | --- | --- | --- | --- |
| **D1** | Nach dem Anruf wird `minuten * tariffCentsPerMin(to)` gebucht — dieselbe Vorab-Schaetzung wie fuer die Reserve, nie ein Ist-Wert | `src/billing/metering.js:50-55` | S1 | P4 |
| **D2** | `voiceTariffDomesticCents` Fallback 20, ausdruecklich als "live abzugleichen" dokumentiert, nie abgeglichen; kein Mechanismus, der Drift sichtbar macht | `src/config.js:363-366`, `.env.example` | S1 | P3 + P5 (**nur Sichtbarkeit/Alarm**); die ENV-Senkung selbst ist **P4b**, s.u. |
| **D3** | STT, TTS, Recording, Inference (1,25 ct/min zusammen, 23 % der variablen Kosten) laufen in KEINER Kostenachse | Kap. 2.1 | S1 | P4 |
| **D4** | `ai-voice-assistant` ist eine additive Position von ~5 ct/min, die an einem Feature-Flag haengt | Kap. 2.2 | S1 | **Kein schwebendes Risiko mehr, sondern eine Entscheidung: der Assistant-Pfad wird GANZ VERWORFEN** (Owner-Entscheidung 5, 2026-07-20; die Budget-Engine bleibt der einzige Weg). Der **Rueckbau des Pfads ist ausdruecklich NICHT Teil dieses Plans** (Scope) — er betrifft `src/telephony/adapters/telnyx/voice.js` (`startAssistant`, `ai_assistant_start`) und `src/config.js` (`telnyx.telnyxAssistant`, `TELNYX_AI_ASSISTANT_ENABLED`) und ist als **Folgearbeit** zu fuehren. Bis der Pfad wirklich aus dem Code ist, bleibt er aktivierbar; deshalb rechnet **P4b** weiter mit den 10,4 **USD**-ct/min der aktivierbaren Konfiguration (zum Kurs 0,92 = 9,568, aufgerundet **10 EUR-ct** — `voiceTariffDomesticCents` ist EUR-nativ). Eine Absichtserklaerung entfernt keinen Code-Pfad |
| **D5** | Waehrungsbruch (**prospektiv**, nicht heute wirksam): Telnyx rechnet USD; der Ziel-Bucket `cost_eur NUMERIC` fuehrt heute korrekt EURO (`pg.js:1115` schreibt `costCents / CENTS_PER_EUR`, `hydratedCostCents` `pg.js:911` liest `* CENTS_PER_EUR`). Wuerde man USD-Ist-Kosten naiv in denselben Bucket speisen, wuerden sie als EUR-Cents gelesen | `src/db/schema.sql:248,256-259`, `src/store/pg.js:905-916,1115` | S1 | P2 (getrennt gefuehrt) + P4 (Umrechnung) |
| **D6** | Plattform-Fixkosten (ElevenLabs 6,00 USD/Monat belegt, DID-Miete 1,00 USD/Monat je Nummer als **Listenpreis** belegt — der Rechnungsposten selbst bleibt per API unzugaenglich) existieren in keinem Kostenmodell | Kap. 2.3/2.4 | S2 | P7 (nur Sichtbarkeit) |
| **D7** | Das ElevenLabs-Kontingent ist eine unsichtbare Wand: keine Zaehlung, kein Alarm, bei Erschoepfung faellt TTS still auf `<Say>` zurueck | `src/tts/directive-synth.js:44-51` | S1 | P7 |
| **D8** | Tenant-Decke ist ein flacher 600-ct-Default fuer jeden Tenant, gesetzt bei Registrierung VOR der Plan-Wahl; `createTenantSubscription` fasst sie nie an | `config.js:387`, `state-ops.js:747-759`, `billing/subscribe.js:92-112` | S1 | P6 — **Vorbedingung: Entscheidung 8** (`MAX_BUDGET_EUR`=800 ct traegt die entschiedene Business-Decke von 900 ct nicht; die Anhebung geschieht in PLAN-BUDGET-AXES vor der Auslieferung von P6; **Bauort-Hinweis: die Datei liegt seit `a0431fa` nur noch in der Historie — s. Kasten in Entscheidung 4**. Bleibt die Anhebung aus, scheitert der Boot fatal ueber `spendCapCoherence`, nicht der Zahlungspfad) |
| **D9** | Es gibt keinen Zustand "vorlaeufig geschaetzt, Ist-Wert steht aus". `billedAt` ist binaer; nach `finishCall` ist der Buchungspfad fuer den Call dicht | `src/telephony/call-finish.js:39-49` | S2 | P2 |
| **D10** | Kein Index auf `call.tenant_id`, `call.started_at`, `call.call_control_id` oder `usage_event.call_id` — ein CDR-Abgleich per Provider-ID oder Zeitfenster liefe unindiziert | `src/db/schema.sql` (nur `account_email_idx`, `number.e164`) | S2 | **NICHT behoben — bewusst.** P3 stellt keine eigene SQL-Query (RLS-Begruendung dort); der Abgleich laeuft ueber den In-Memory-Spiegel, den `hydrateTenantInto` (`pg.js:669-675`) ohnehin vollstaendig laedt. Ein Index ohne Aufrufer waere toter Code (CLAUDE.md). Wird erst relevant, wenn P3 je auf einen SQL-Lesepfad umgestellt wird — dann als eigene Phase mit `set_config('app.current_tenant', ...)` nach Vorbild `hydrateTenant`. |
| **D11** | Die gebuchte Dauer ist die selbst gemessene Wanduhr (`answeredAt`..`endedAt`), nicht die Provider-Dauer — zwei unabhaengige Fehlerquellen (Dauer UND Preis) in einer Zahl | `src/billing/metering.js:17-27` | S2 | P3 (sichtbar) |
| **D12** | Ein negativer Korrekturbetrag ist heute strukturell nicht buchbar: `isBookableCents` verlangt `x >= 0` und `addVoiceUsageCostCents` verwirft alles andere als Korruption | `src/store/defaults.js:199-201`, `state-ops.js:1627-1633` | Design-Randbedingung | P4 |

---

## 4. Begriffsmodell

Der Plan fuehrt genau vier neue Begriffe ein. Jeder ist gegen die bestehenden abgegrenzt.

- **Schaetzkosten** (`estimatedCostCents` / `estimated_cost_cents`, Ganzzahl Cents — heute
  namenlos in `metering.js:54` berechnet und **nirgends gespeichert**):
  `minuten * tariffCentsPerMin(to)`. Das ist der Wert, den der Dienst heute bucht. Der Begriff
  wird eingefuehrt, damit die bestehende Zahl endlich einen ehrlichen Namen hat; sie
  verschwindet nicht, sie wird zum benannten Vorlaeufigen.

  **Sie wird ab P2 persistiert, und das ist keine Bequemlichkeit, sondern eine
  Sicherheitsanforderung.** Die Korrekturbuchung in P4 ist `Ist - Schaetzung`. Wuerde die
  Schaetzung zur Abgleichzeit aus `tariffCentsPerMin(to)` **neu berechnet**, haenge die
  Korrektur an einer Groesse, deren Aenderung dieser Plan selbst einplant (P4b senkt den
  Tarif; P3 verzoegert den Abgleich um `COST_TRUING_DELAY_MINUTES`, Default 180 — der
  ENV-Wechsel faellt genau in dieses Fenster). Konkret: 30 Calls a 3 Minuten, gebucht zu
  6 ct/min (540 ct). Der Owner hebt den Tarif danach auf 25. Der naechste Abgleich rechnet
  Schaetzung = 75 ct je Call gegen ein Ist von ~16 ct und bucht 30 x -59 ct — `usage.costCents`
  faellt auf den 0-Boden, und weil `gateUsageCents` bei `BUDGET_MONTH_ENABLED=false`
  (Live-Default) genau `bucket.costCents` liest (`state-ops.js:1675-1678`) und
  `MAX_BUDGET_EUR` ein **geteilter Lebenszeit-Topf** ist, steht der Plattform-Topf danach
  wieder offen, obwohl das Geld real ausgegeben wurde. Die Gegenrichtung erzeugt spiegelbildlich
  eine Phantom-Nachbuchung. Deshalb gilt verbindlich: **gebucht und gespeichert wird
  derselbe Wert, an derselben Stelle, im selben Schritt** — `reconcileOutboundVoiceBudget`
  schreibt `estimatedCostCents` genau dort, wo es bucht. Die Korrektur bildet die Differenz
  **ausschliesslich** gegen diesen persistierten Wert und rekonstruiert ihn nie.
- **Ist-Kosten** (`actualCostMicroCents` / `actual_cost_micro_cents`): die Summe der vom
  Provider je Datensatz ausgewiesenen `cost`-Werte fuer EINEN Call, in **Mikro-Cents,
  Ganzzahl**. Mikro-Cents, weil ein einzelner Detail-Record bei 0,0122 USD (= 1,22 Cent)
  liegt und eine Ganzzahl-Cent-Rundung je Record einen relativen Fehler von 18 % bis
  (bei kleineren Records) 100 % traegt. Die Einheit existiert im Repo bereits
  (`MICRO_CENTS_PER_CENT = 1_000_000`, `defaults.js:169`) — es ist bewusst KEINE neue
  Geldkodierung, sondern die vorhandene.

  **Die Einheit des Provider-Felds ist der gefaehrlichste Umrechnungsschritt des ganzen
  Plans und wird deshalb hier festgeschrieben.** Telnyx liefert `cost` als Dezimalstring in
  der **Hauptwaehrungseinheit** (USD), nicht in Cent: der oben genannte Record `0.0122`
  bedeutet 1,22 Cent. Das ist mit der Messung aus Kapitel 2 konsistent — 3,9 ct/min
  Telefonie entsprechen `cost`-Werten der Groessenordnung `0.039` je Minute, nicht `3.9`.
  Der Umrechnungsfaktor von der Provider-Hauptwaehrung auf Mikro-Cent ist damit
  **10^8** (`CENTS_PER_UNIT = 100` mal `MICRO_CENTS_PER_CENT = 1_000_000`), **nicht 10^6**.

  **Status dieser Aussage: belegt aus der Provider-Doku und aus der eigenen Messung,
  aber nicht an einem echten `detail_records`-Aufruf verifiziert — bis dahin eine
  ANNAHME.** P1 macht die Verifikation deshalb zur Abnahmebedingung (s. dort). Waere der
  Faktor um 100 zu klein, laege das Ist fuer JEDEN Call bei ~1 % der Schaetzung, bei
  formal vollstaendiger Datenlage — also die faktische Vollrueckerstattung jeder
  Schaetzung. Das ist derselbe Ausfallmodus wie PM-4 und wird vom
  Vollstaendigkeits-Praedikat aus P4 **nicht** erkannt, weil die Records ja da sind. Die
  Einheit ist damit keine Formalie, sondern eine Sicherung.
- **Korrekturbuchung** (`costCorrectionCents`): die vorzeichenbehaftete Differenz
  `Ist - Schaetzung`, in Ganzzahl-Cents, gebucht **nach** dem Call ueber einen eigenen,
  vorzeichenfaehigen Pfad. Sie ersetzt die Schaetzung nicht rueckwirkend, sie korrigiert
  den Saldo.
- **Nebenkosten-Aufschlag** (`voiceOverheadCentsPerMin`): der Anteil der variablen Kosten,
  der pro Call nachweislich anfaellt, aber (moeglicherweise) nicht per Call-ID auf einen
  Call zurueckfuehrbar ist — STT, TTS, Recording, Inference. Eine konfigurierte,
  aus Kapitel 2 abgeleitete Ganzzahl.

**Namenswahl bindend, Kollisionen aktiv geklaert:**

- Nicht "Kosten" allein — der Begriff ist in `costCents` (Lebenszeit-Achse) und
  `spendMonthCostCents` (Monats-Achse) doppelt vergeben. Dieser Plan fuehrt **keine dritte
  Achse** ein. Ist-Kosten sind eine **Herkunftsangabe**, keine Achse: sie aendern, WORAUS
  die beiden bestehenden Achsen gefuellt werden, nicht WIE VIELE es sind.
- Nicht "Reconciliation" fuer den Buchungsschritt — das Wort ist in
  `reconcileOutboundVoiceBudget` (`metering.js:50`) und im DID-Release-Reconciler
  (`wiring/web-login.js:50-56`) bereits belegt. Der neue Job heisst **Kosten-Abgleich**
  (`cost-truing`, Modul `src/billing/cost-truing.js`).
- Nicht "Tarif" fuer den Ist-Wert. `tariffCentsPerMin` bleibt, was es ist: eine
  **Vorab-Schaetzung fuer die Reserve**. Dieser Plan nimmt ihr die Zweitrolle als
  Abrechnungsgroesse.

In einem Satz: **die Reserve bleibt eine Schaetzung, die Buchung wird eine Messung.**

---

## 5. P0 — bewusst leer (und warum das die Kernaussage ist)

PLAN-BUDGET-AXES hatte ein P0: eine reine ENV-Aenderung, sofort wirksam, ohne Deploy. Der
naheliegende P0 hier waere `VOICE_TARIFF_DOMESTIC_CENTS=20` auf den gemessenen Wert zu
senken. **Dieser Plan tut das ausdruecklich NICHT als ersten Schritt.**

Begruendung: `tariffCentsPerMin` speist heute **zwei** Verbraucher — die Reserve
(`outbound-gates.js:657-664`) und die Buchung (`metering.js:54`). Eine ENV-Senkung senkt
beide gleichzeitig. Die Reserve zu senken ist harmlos bis nuetzlich; die **Buchung** zu
senken heisst, den Verbrauchszaehler zu verlangsamen, bevor irgendjemand weiss, was der
Anruf wirklich gekostet hat. Genau diese Bewegung — Bremse loesen auf Basis einer Zahl,
die man nicht misst — ist die Ursache des Vorfalls, nur mit umgekehrtem Vorzeichen. Ein
falscher Wert, den man nach unten korrigiert, ohne die Messung zu haben, ist kein Fortschritt
gegenueber einem falschen Wert, den man nach oben geraten hat.

**Der Tarif darf erst sinken, wenn die Buchung ueberwiegend nicht mehr an ihm haengt** (nach
P4, und nachweislich: die Abgleich-Deckungsquote aus P4b ist genau dieses "ueberwiegend" als
Zahl). **Wichtig, weil eine fruehere Fassung dieses Kapitels hier zu viel versprochen hat:**
P4 loest die Buchung **nicht vollstaendig** vom Tarif. `metering.js:50-55` bucht unveraendert
`minuten * tariffCentsPerMin(call.to)`; P4 legt nur eine Korrektur fuer die **erfolgreich und
vollstaendig abgeglichenen** Calls darueber. Fuer alle anderen bleibt der Tarif der
Buchungswert. Bis P4b bleibt die Ueberbuchung stehen — sie ist fail-closed und kostet Nutzen,
nicht Geld. Das ist Absolute Regel 1, angewandt auf die eigene Ungeduld.

Der P0, den dieser Plan nicht als ersten Schritt macht, ist damit **nicht gestrichen, sondern
verschoben**: er heisst **P4b** und steht als eigene Phase in Kapitel 6. Ohne diese Phase
saehe D2 in der Befundtabelle behoben aus, obwohl keine Phase den Tarif je senkt.

**Ehrliche Bilanz:** Damit bleibt der Betrieb bis P4/P5 im heutigen Zustand — bei einer
Lebenszeit-Decke von 800 Cent und 20 ct/min sind das ~40 Gespraechsminuten, jemals. Das
Entsperren des Betriebs ist eine **Cap-Frage** (MAX_BUDGET_EUR, PLAN-BUDGET-AXES P0/Frage 1),
keine Tarif-Frage. Wer den Betrieb sofort braucht, hebt den Deckel — bewusst, sichtbar, als
Owner-Entscheidung — statt den Zaehler heimlich langsamer laufen zu lassen.

---

## 6. Phasen

### P1 — CDR-Seam am Voice-Port (kein Aufrufer, keine Buchung)

**Behebt:** Fundament fuer D1/D3. **Aufwand:** M. **Abhaengig:** —

#### Ziel

Der Telnyx-Adapter kann die Ist-Kosten-Datensaetze eines Calls abrufen; niemand ruft ihn auf.

#### Kern

Neue **optionale** Methode am bestehenden `VoiceControl`-Port
(`src/telephony/ports.js:70-89`, dort wo `originateViaCallControl` u.a. bereits als
Telnyx-only dokumentiert sind). **Kein neuer Port**, kein neuer Eintrag in `registry.js` —
nur ein zusaetzliches Feld auf dem bestehenden `telnyxVoice`-Objekt
(`adapters/telnyx/voice.js:126-266`), das `headers()`, `assertTelnyxOk` und
`parseTelnyxResource` wiederverwendet.

```
getVoiceCostRecords({ legId, startedAt, endedAt })
  -> { ok: true, records: [{ recordType, costMicroCents, currency, billedSec, legId }] }
   | { ok: false, reason }
```

Twilio: **nicht implementiert**, bewusst. Twilio traegt zwar ein `price`-Feld direkt an der
Call-Resource, deckt laut Doku aber nur Connectivity (nicht AMD/TTS/SIP-REFER) — eine
Twilio-Implementierung waere also eine ANDERE Semantik unter demselben Namen. Fehlt die
Methode, faellt der Aufrufer (P3) auf "kein Abgleich" zurueck; das ist der konservative Fall.

**Geld-Parsing (G26, verbindlich):** Telnyx liefert `cost` als Dezimal**string** in der
**Hauptwaehrungseinheit** (USD), nicht in Cent — s. Kapitel 4, dort auch die Begruendung
und der ANNAHME-Status. `parseDecimalToMicroCents(str)` arbeitet **rein string-basiert**
(Vorzeichen, Vor-/Nachkomma trennen, auf **8** Nachkommastellen auffuellen bzw.
abschneiden — 8 = `log10(10^8)`, die Stellenzahl des Faktors Hauptwaehrung -> Mikro-Cent)
und beruehrt nie `parseFloat`. Nicht-parsebar, negativ oder nicht-endlich -> **kein
Record**, nicht "0". Ein stillschweigend zu 0 gewordener Preis ist die gefaehrlichste Zahl
in diesem ganzen Plan (s. P4).

**Der Faktor 10^8 steht nicht als nackte Zahl im Code**, sondern als
`MICRO_CENTS_PER_CURRENCY_UNIT = CENTS_PER_EUR * MICRO_CENTS_PER_CENT` aus den beiden
bereits vorhandenen Konstanten zusammengesetzt (`defaults.js`), mit Kommentar. Eine
zweite, unabhaengig gepflegte 100 waere genau die Drift, an der der naechste
Einheiten-Fehler entsteht.

**Live-Verifikation der Einheit ist Abnahmebedingung dieser Phase, nicht ein spaeterer
Schritt.** Vor dem Merge von P1 wird EIN echter `detail_records`-Aufruf gegen einen
bekannten Call gefahren und der gelieferte `cost`-String gegen die Dauer und den aus
Kapitel 2 bekannten Satz gehalten (Erwartung: ~`0.039` je Minute Telefonie, nicht `3.9`
und nicht `0.00039`). Ergebnis und Roh-String gehoeren in den Phasen-Report. Ohne diesen
Beleg darf P2 nicht starten: P1 ist schema-frei und billig zu korrigieren, ab P2 haengt
eine persistierte Geldgroesse an dem Faktor.

**Waehrung (D5):** `currency` wird **mitgefuehrt, nicht umgerechnet**. Weicht sie von
`config.billing.providerCurrency` (neu, Default `USD`) ab, ist der Record ungueltig. Die
USD/EUR-Frage wird in P2 entschieden, nicht hier versteckt.

#### Betroffene Dateien

`src/telephony/ports.js`, `src/telephony/adapters/telnyx/voice.js`,
`src/telephony/adapters/telnyx/cost-parse.js` (neu), `src/config.js`, `.env.example`,
`render.yaml` (`PROVIDER_CURRENCY` — auch wenn das Ergebnis der Pruefung "kein Eintrag noetig,
Default USD reicht" lautet, gehoert der Schritt in die Phase; CLAUDE.md verlangt ihn fuer
**jede** neue Env-Var, und kein Test prueft `render.yaml` gegen `config.js`),
`test/telnyx-cost-records.test.js` (neu).

#### Akzeptanzkriterium

- Alle Bestandstests unveraendert gruen; kein Produktionspfad ruft die Methode auf.
- **Die Einheit ist an einem echten `detail_records`-Aufruf belegt** (s. Kern), Roh-String
  im Phasen-Report.
- `parseDecimalToMicroCents("0.0122")` === `1220000` (= 1,22 Cent); `("0")` === `0`;
  `("1")` === `100000000` (1 USD = 100 Cent).
- `("0.000000004")` schneidet auf `0` ab und wird als gueltiger 0-Record gefuehrt (echte
  Null ist etwas anderes als fehlende Daten — s. P4).
- `("abc")`, `("")`, `(null)`, `("-0.01")`, `("1e-3")` -> jeweils ungueltig, kein Record.
- Fremdwaehrung -> Record verworfen, Grund geloggt.

#### Rot-vor-Fix-Test

Neu `test/telnyx-cost-records.test.js`, heute vollstaendig rot (Modul + Methode existieren
nicht):
(a) Parser-Tabelle inkl. aller Grenzfaelle oben, **ohne** Float-Zwischenschritt (der Test
pinnt `0.1 + 0.2`-Klassen-Faelle: `("0.07")` + `("0.01")` summiert exakt `8000000`).
(a2) **Einheiten-Riegel:** ein Record ueber einen 60-Sekunden-Call mit dem aus Kapitel 2
belegten Satz (`cost: "0.039"`) ergibt `3900000` Mikro-Cent = 3,9 Cent. Faellt rot aus,
sobald jemand den Faktor auf 10^6 zurueckdreht — dann waeren es 0,039 Cent.
(b) Fingierte Telnyx-Antwort mit gemischten `record_type`s -> alle Records mit korrekten
`costMicroCents`.
(c) HTTP 500 / Timeout -> `{ ok: false }`, kein Wurf.
(d) Antwort mit `currency: "EUR"` bei `providerCurrency=USD` -> Record verworfen.

#### Schutzniveau

**Unveraendert.** Reiner Zuwachs an Faehigkeit, kein Aufrufer.

#### Risiko

Ein spaeterer Aufrufer koennte `{ ok: false }` als "Kosten = 0" missverstehen. Deshalb ist
die Rueckgabe ein Ergebnis-Objekt und niemals eine nackte Zahl — die Unterscheidung
"gemessen 0" vs. "nicht gemessen" ist im Typ erzwungen, nicht per Konvention (G31).

---

### P2 — Ist-Kosten am Call persistieren (additiv, inert)

**Behebt:** D5, D9 (Fundament). **Aufwand:** L. **Abhaengig:** P1
**HARTE VORBEDINGUNG: die `hermes-db`-Frage muss geloest sein.**

#### Harte Vorbedingung

`hermes-db` (Render Free Tier) laeuft am **2026-07-24** ab; heute ist der 2026-07-20. P2
fuehrt eine Schema-Migration ein. **P1 ist schema-frei und kann sofort laufen; P2 erst nach
Abloesung/Verlaengerung der DB.** Diese Frist teilt sich P2 mit PLAN-BUDGET-AXES P4 — beide
Ketten haengen an derselben Datenbank. Positiv verifiziert: `migrate()` laeuft bei Connect
(`src/store/pg.js:60-84`), also kein preDeploy, keine Shell, Free-Tier-tauglich.

#### Kern

Der Call-Record (`state-ops.js:160-224`, einzige Shape-Quelle beider Backends) bekommt **fuenf**
Felder, alle `null`/`0` im Default:

- `estimatedCostCents` — Ganzzahl Cents, **der tatsaechlich gebuchte Schaetzbetrag**.
  Geschrieben von `reconcileOutboundVoiceBudget` (`metering.js:50-55`) an genau der Stelle, an
  der gebucht wird — nicht spaeter rekonstruiert. Begruendung s. Kapitel 4.
- `actualCostMicroCents` — Ganzzahl Mikro-Cents, Summe aller gueltigen Records
- `costTruedAt` — Zeitstempel des Abgleichs (loest D9: der binaere `billedAt`-Zustand
  bekommt endlich ein Gegenstueck fuer "Ist-Wert steht aus")
- `costTruedSource` — `'telnyx_detail_records'` | `'unavailable'` | `'incomplete'`
- `costTruingAttempts` — Ganzzahl, Default `0`. **Persistiert**, weil `COST_TRUING_MAX_ATTEMPTS`
  aus P3 sonst nicht implementierbar ist: ein In-Memory-Zaehler wird auf dem Render-Free-Tier
  (schlafender Dyno, haeufige Neustarts) bei jedem Restart genullt, erreicht die Obergrenze nie
  und laesst den Job unbegrenzt gegen tote Calls laufen — genau das Gegenteil der Absicht, und
  die Zahl der offenen Calls als Ausfall-Indikator (PM-4) waere durch die Dauer-Wiedervorlage
  unbrauchbar.

Migration additiv/idempotent in `src/db/schema.sql` (Muster der Zeilen 181-205):

```
ALTER TABLE call ADD COLUMN IF NOT EXISTS estimated_cost_cents INTEGER;
ALTER TABLE call ADD COLUMN IF NOT EXISTS actual_cost_micro_cents BIGINT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_trued_at TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_trued_source TEXT;
ALTER TABLE call ADD COLUMN IF NOT EXISTS cost_truing_attempts INTEGER NOT NULL DEFAULT 0;
```

**Kein Index.** Ein `call_cost_pending_idx` haette keinen Aufrufer: P3 stellt ausdruecklich
keine eigene SQL-Query (RLS-Begruendung dort), sondern arbeitet auf dem In-Memory-Spiegel, den
`hydrateTenantInto` (`pg.js:669-675`) beim Boot ohnehin vollstaendig laedt. Ein Index, dessen
Begruendung im selben Plan widerrufen wird, ist toter Code (CLAUDE.md). D10 bleibt deshalb
offen und ist in Kapitel 3 als solches gefuehrt — nicht als stillschweigend erledigt.

**Kein Backfill.** Bestandszeilen bleiben `NULL` = "nie abgeglichen". Ein Backfill liefe bei
jedem Boot erneut (`migrate()` fuehrt das komplette Skript ungebremst aus,
`src/db/migrate.js:19-22`) und braeuchte einen eigenen Konvergenz-Guard — den er hier nicht
braucht, weil er entfaellt. **Zusaetzlich verboten**, weil `migrate()` auf EINER Connection
mit `app.current_tenant` fest auf `BOOTSTRAP_TENANT_ID` laeuft (`pg.js:62-63`): ein Backfill
auf der FORCE-RLS-Tabelle `call` saehe nur die Zeilen des Bootstrap-Tenants — ein bislang nie
durchlaufener Pfad.

**Waehrungs-Entscheidung (D5), verbindlich:** `actualCostMicroCents` speichert die
**Provider-Waehrung unveraendert** (heute USD). Es wird **nicht** in den EUR-benannten Bucket
umgerechnet. Die Umrechnung ist eine Gate-Frage und lebt an genau einer Stelle in P4
(`providerToBucketRateMicro`, konfiguriert, Ganzzahl). Grund: eine Umrechnung an der
Persistenzkante macht die gespeicherte Zahl unrekonstruierbar, sobald sich der Kurs aendert —
und die gespeicherte Zahl ist der Forensik-Wert, an dem der naechste Vorfall aufgeklaert wird.

**Der Kurs selbst ist eine Sicherung, keine Konstante.** `PROVIDER_TO_BUCKET_RATE_MICRO` gibt
an, wie viele **Mikro-Einheiten des Ziel-Buckets (EUR-Cent)** auf **eine Mikro-Einheit der
Provider-Waehrung (USD-Cent)** entfallen. Default **920000** (entspricht 0,92 EUR je USD,
Stand 2026-07 — eine **ANNAHME**, vom Owner quartalsweise von Hand zu pflegen, s. Entscheidung 7). Er ist die einzige
Groesse, bei der "nicht gesetzt" faktisch "keine Kosten" bedeuten koennte, deshalb dreifach
abgesichert:

1. `numEnv(..., { min: 1 })` — strikt groesser 0. Ein `fallback: 0` waere regelkonform und
   wuerde nie fatal (`numEnv` gibt bei fehlender Var kommentarlos den Fallback zurueck,
   `config.js:38-60`); genau das ist hier verboten.
2. Ein **Boot-Guard** in `assertBootGates`, der den Kurs gegen ein Toleranzband um einen im
   Code gepinnten Anker haelt. **Die Bandgrenzen und der Anker sind benannte Konstanten, keine
   Literale:** `PROVIDER_RATE_ANCHOR_MICRO` (der gepinnte Referenzwert — **derselbe Zahlenwert
   wie der ENV-Default 920000, aber eine eigene Code-Konstante**, damit eine Aenderung des
   Defaults den Anker nicht stillschweigend mitzieht und das Band gegen sich selbst prueft),
   `PROVIDER_RATE_BAND_MIN_FACTOR = 0.5` und `PROVIDER_RATE_BAND_MAX_FACTOR = 2.0`, alle drei
   in `src/boot-guard.js`. Jede andere Schwelle dieses Plans traegt Namen und Ort; diese auch.

   **Die Stufe des Guards ist phasenabhaengig, und das ist eine bewusste Korrektur.** In P2
   ist der Kurs ein **WARN**, kein `exit(1)`: er hat in P2 und P3 nachweislich keinen
   Verbraucher (die Umrechnung entsteht erst in P4, s.o. "Waehrungs-Entscheidung"), und ein
   Boot-Refusal tauschte hier einen Schaden von **null** gegen den **Totalausfall der
   Telefonie** — kein `/voice`, keine Inbound-Annahme, kein Outbound, auf einem Free Tier mit
   haeufigen Restarts bis zur naechsten manuellen Env-Korrektur. Genau diese Abwaegung fuehrt
   das Repo bereits vor: `warnUnpricedModels` (`boot.js:70-81`) ist ausdruecklich "NUR WARN,
   kein exit(1): ein Boot-Refusal tauschte hier ein Kostenproblem gegen einen Totalausfall der
   Telefonie". **In P4 — der Phase, in der der Kurs erstmals Geld bewegt — wird derselbe Guard
   auf FATAL gehoben** (s. dort).

   **Unkonditional bleibt er in beiden Stufen — ausdruecklich NICHT an
   `COST_TRUING_BOOKING_ENABLED` gekoppelt.** Das ist gegen die naheliegende Fassung
   entschieden ("pruefen, wenn es zaehlt"), aus zwei Gruenden. Erstens kostet die Pruefung
   bei Flag AUS nichts: ein Kurs im Band ist ohnehin der Normalfall, und wer einen
   kaputten Kurs setzt, will es in jedem Fall wissen. Zweitens — und das ist der tragende
   Grund — **P8 entfernt das Flag**. Eine an das Flag gekoppelte Bedingung verschwindet
   dann entweder mit ihm, oder sie bleibt als `cfg.costTruingBookingEnabled === undefined`
   stehen, was falsy ist und den Guard lautlos tot schaltet. Genau in dem Moment, in dem
   die Korrekturbuchung bedingungslos aktiv wird, waere der Kurs unbewacht. Eine Sicherung,
   die an einem Schalter mit Verfallsdatum haengt, hat dasselbe Verfallsdatum. Die Stufe
   (WARN/FATAL) haengt an der Phase, die Existenz der Pruefung an nichts.
3. Ein Kurs von 0 ist damit unmoeglich, und ein Vertipper um Zehnerpotenzen wird spaetestens
   in P4 gefangen — der naheliegende Fall ist `PROVIDER_TO_BUCKET_RATE_MICRO=920` statt
   `920000`, weil 0,92 die kommunizierte Groesse ist. `numEnv(..., { min: 1 })` laesst 920
   anstandslos durch (`min` prueft nur `> 0`, `config.js:38-60`); erst das Band faengt ihn
   (in P2 als laute Meldung, ab P4 als Boot-Verweigerung). Waere er es nicht, waere
   `Ist ~ 0` fuer **jeden** Call
   bei formal vollstaendiger Datenlage — also die volle Rueckerstattung jeder Schaetzung jedes
   Calls. Das ist woertlich PM-4, nur durch die Umrechnung statt durch die CDR-API hereingekommen,
   und PM-4s Gegenmassnahme (Typunterscheidung `{ok:false}` vs. gemessene 0) greift dort **nicht**,
   weil die Messung ja erfolgreich war.

Dass der Wert auf Render vergessen wird, ist der wahrscheinliche Fall, nicht der exotische —
der Live-Service ist Dashboard-managed und wird manuell deployt, Code liegt regelmaessig
laenger ungedeployt auf `master`,
und Env-Vars wurden in dieser Codebasis schon einmal nach dem Code deployt (Telnyx-
Call-Control-App-ID). Deshalb der Boot-Guard und nicht nur ein Default.

#### Betroffene Dateien

`src/store/state-ops.js`, `src/store/defaults.js`, `src/db/schema.sql`,
`src/billing/metering.js` (**neu in dieser Liste**: `reconcileOutboundVoiceBudget` 50-55
schreibt `estimatedCostCents` im selben Schritt, in dem es bucht), `src/store/pg.js`
(**drei** Stellen: `flushCalls` 1123-1194 inkl. `ON CONFLICT DO UPDATE SET` — **alle fuenf**
Felder mutieren nach Create, gehoeren also anders als `context`/`mandate` ins UPDATE-SET; und
`rowToCall` 828-888), `src/store/json.js` (nur falls Alt-Shape-Merge noetig),
`src/config.js`, `.env.example`, `render.yaml` und `src/boot-guard.js`
(**`PROVIDER_TO_BUCKET_RATE_MICRO` samt Boot-Guard wird in DIESER Phase eingefuehrt, nicht
erst in P4** — der Kern oben spezifiziert die dreifache Absicherung, also gehoeren alle
vier Dateien hierher; CLAUDE.md verlangt `config.js` + `.env.example` + `render.yaml` fuer
jede neue Env-Var in der Phase, die sie einfuehrt, und ein Guard, der zwei Phasen spaeter
scharf wird, ist zwei Phasen lang keine Sicherung),
`test/call-actual-cost-roundtrip.test.js` (neu), `test/boot-guard-*.test.js`,
`test/store-pg-*.test.js`.

#### Akzeptanzkriterium

- Alle Gate- und Store-Tests byte-identisch gruen; kein Gate liest die neuen Felder.
- Rundlauf ueber **beide** Backends verlustfrei, inkl. Mutation nach Create.
- Bestandszeilen ohne Wert hydrieren zu `null` (bzw. `costTruingAttempts` zu `0`) ohne Fehler
  und ohne Log-Rauschen.
- **Ein gebuchter Outbound-Call traegt danach `estimatedCostCents` — und zwar exakt den Wert,
  der gebucht wurde.** Das ist das eigentliche Kriterium dieser Phase.
- Ein zweiter `migrate()`-Lauf aendert nichts.
- `actual_cost_micro_cents` ist BIGINT — kein NUMERIC, kein Float, keine zweite
  Geldkodierung neben `cost_eur`/`spend_month_cost_cents`.
- **Der Kurs-Guard ist scharf und haengt an keinem Flag** — ein Kurs ausserhalb des Bandes
  erzeugt in dieser Phase genau eine **WARN**, auch bei `COST_TRUING_BOOKING_ENABLED`
  ungesetzt. **Der Boot laeuft** (Begruendung im Kern: in P2/P3 hat der Kurs keinen
  Verbraucher). Die FATAL-Stufe ist Akzeptanzkriterium von **P4**, nicht von dieser Phase.
- Die Bandgrenzen liegen als benannte Konstanten (`PROVIDER_RATE_BAND_MIN_FACTOR` /
  `_MAX_FACTOR`) neben dem ebenfalls benannten `PROVIDER_RATE_ANCHOR_MICRO` — kein Literal
  `0.5`/`2.0`/`920000` im Guard-Rumpf.

#### Rot-vor-Fix-Test

Neu `test/call-actual-cost-roundtrip.test.js`, heute rot (Felder existieren nicht):
(a) Call anlegen, `actualCostMicroCents = 51300`, flush, hydrate -> Wert erhalten (pg **und**
json).
(b) Call anlegen OHNE die Felder, flush, hydrate -> `null`, kein `NaN`, kein `0`
(`costTruingAttempts` -> `0`).
(c) `costTruedSource = 'incomplete'` **und** `costTruingAttempts = 3` nach Create gesetzt ->
ueberleben einen zweiten Flush (pinnt, dass die Spalten im `ON CONFLICT DO UPDATE SET` stehen —
der klassische Drift-Fehler dieses Moduls).
(d) `migrate()` zweimal auf derselben DB -> keine Exception.
(e) `reconcileOutboundVoiceBudget` ueber einen 3-Minuten-Call bei Tarif 6 -> gebucht 18 ct
**und** `estimatedCostCents === 18`. Danach Tarif auf 25 wechseln, Call erneut hydrieren ->
`estimatedCostCents` bleibt `18` (pinnt, dass der Wert gespeichert und nicht abgeleitet ist).
(f) **Kurs-Guard, ohne jedes Flag-Setup:** `PROVIDER_TO_BUCKET_RATE_MICRO=920` (der
Zehnerpotenz-Vertipper) -> genau eine WARN, **Boot laeuft weiter**; `=920000` -> keine
Meldung. Der Test setzt `COST_TRUING_BOOKING_ENABLED` bewusst **nicht** und pinnt damit
zweierlei: dass der Guard unkonditional ist (P8 kann ihn nicht mitnehmen) und dass er in
dieser Phase den Dienst nicht abschiesst. Die FATAL-Variante desselben Falls pinnt P4(o).

#### Schutzniveau

**Unveraendert.** Kein Gate liest die Felder, der Deploy ist verhaltens-identisch.

#### Risiko

Vergessenes `ON CONFLICT DO UPDATE SET` laesst den Wert nach dem naechsten Flush wieder auf
den Create-Zustand (`null`) fallen — der Abgleich waere dann dauerhaft "nie gelaufen" und
P3 wuerde denselben Call endlos erneut abfragen. Testfall (c) existiert genau dafuer.

---

### P3 — Kosten-Abgleich im Beobachtungsmodus (misst, bucht NICHT)

**Behebt:** D2, D4, D11 (Sichtbarkeit). **Aufwand:** L. **Abhaengig:** P2

#### Ziel

Der Dienst weiss fuer jeden beendeten Call, was er wirklich gekostet hat — und wie weit die
Schaetzung danebenlag —, ohne dass sich eine einzige Gate-Entscheidung aendert.

#### Kern

Neues Modul `src/billing/cost-truing.js` (Muster `metering.js`: `store` + `config` im
Closure, keine Telefonie-Logik im Server, kein Netz-IO im Store).

**Nicht in `finishCall`.** Der Hot-Path bleibt unberuehrt: die CDR-Daten liegen zum
Zeitpunkt des Auflegens nachweislich nicht garantiert vor (Kap. 2.6), ein synchroner Abruf
wuerde entweder den Teardown blockieren oder verlaesslich `null` liefern. `call-finish.js`
wird in dieser Phase **nicht angefasst**.

**Ausloeser:** In-Prozess-`setInterval(...).unref()`, exakt das Muster von
`src/boot.js:184-185` (Retention, 6h) und `src/wiring/web-login.js:50-56`
(DID-Release-Reconciler, 6h). Kein neuer Scheduler-Dependency, kein Render-Cron (gibt es
nicht). Das Intervall bekommt einen benannten Modul-Konstanten (`COST_TRUING_SWEEP_INTERVAL_MS`,
Default 6 h) nach dem Vorbild von `RETENTION_SWEEP_INTERVAL_MS` — keine nackte Zahl im
`setInterval` (G26/Magic-Number). Zusaetzlich ein extern anstossbarer Endpunkt hinter
Basic-Auth nach dem Muster `POST /api/billing/flush-meters`
(`src/routes/api-billing.js:35-41`) — fuer den Betrieb und fuer den Live-Beleg, nicht als
Ersatz fuer das Intervall.

**Zwei Ausloeser heissen zwei moeglicherweise gleichzeitige Laeufe, und das ist ab P4 ein
Geld-Problem.** Node ist single-threaded, aber der Job `await`et pro Call einen
Provider-Abruf; feuert das Intervall, waehrend der manuelle Endpunkt noch auf eine Antwort
wartet, sehen **beide** Laeufe `costTruedAt === null` fuer denselben Call, berechnen beide
eine Korrektur und buchen ab P4 beide. Der Idempotenz-Riegel `costTruedAt` schuetzt nur
gegen **sequenzielle** Wiederholung, nicht gegen Verschraenkung. Deshalb verbindlich schon
in dieser Phase: ein **modul-lokaler Laufriegel** (ein Boolean im Closure, den sich beide
Ausloeser teilen; ein zweiter Aufruf ist ein protokolliertes No-op und kein Fehler). Der
Riegel gehoert nach P3 und nicht nach P4, weil er sonst genau in der Phase fehlt, in der
er erstmals Geld bewegt — und weil er sich hier, wo nichts gebucht wird, gefahrlos testen
laesst. Ein Prozess-uebergreifender Riegel ist bewusst NICHT vorgesehen: Render laeuft hier
mit einer Instanz, und ein DB-Lock waere eine eigene Infrastruktur fuer ein Problem, das
diese Topologie nicht hat. Diese Voraussetzung gehoert in den Modul-Kommentar, damit sie
beim ersten Skalierungsschritt auffaellt.

**Aufschub-Konstante:** abgeglichen wird nur, was mindestens `COST_TRUING_DELAY_MINUTES`
(Default **180**, benannt, konfigurierbar) beendet ist. Der Wert ist explizit eine
Konfiguration und keine Konstante im Code, weil die zugrundeliegende CDR-Latenz UNBELEGT ist
(Kap. 2.6) — er wird nach dem ersten Live-Beleg nachgezogen, nicht geraten und vergessen.

**Der Pfad pro Tenant, nicht global** (RLS): der Job laeuft ueber `store.load()` /
In-Memory-Mirror / `store.save()` und erbt damit die Pro-Tenant-Schleife von
`hydrate()`/`flush()` (`pg.js:581-593`, `948-966`). Er setzt **niemals** selbst eine eigene
SQL-Query gegen den Pool ab — unter FORCE ROW LEVEL SECURITY liefert das 0 Zeilen oder, bei
klebender GUC auf einer Pool-Connection, die Zeilen des FALSCHEN Tenants.

**Geschrieben werden nur die P2-Felder.** Zusaetzlich eine WARN-Zeile, wenn
`|Ist - Schaetzung| / Schaetzung > costDriftWarnPercent` (`COST_DRIFT_WARN_PERCENT`, Default
**50**). Das ist die Kontrolle, deren Fehlen D2 ausmacht: der konfigurierte Tarif wird ab
hier **dauerhaft** gegen die Wirklichkeit gehalten, statt einmalig.

**Zur Nebenkosten-Frage (D3) liefert P3 die Antwort, die dieser Plan heute nicht hat:** ob
die Records fuer `speech-to-text`, `text-to-speech`, `recording` und `ai-voice-assistant`
ueberhaupt eine Leg-ID tragen, die auf unseren Call zeigt, ist **UNBELEGT** — die
Detail-Record-Doku belegt Kostenfelder pro Record, nicht die Joinbarkeit jedes record_type.
P3 protokolliert je Call, **welche** record_types gefunden wurden. Nach einer Woche
Beobachtung steht fest, ob P4 pro Call summieren kann (Fall A) oder ob die Nebenkosten als
`voiceOverheadCentsPerMin` pauschal draufmuessen (Fall B). Diese Frage wird in P3
**beantwortet, nicht in P4 angenommen** — genau der Fehler, den dieser Plan aufarbeitet.

**P3 liefert damit zugleich die Pflicht-Menge fuer P4.** Die beobachtete Menge der
record_types, die bei einem gesunden Call zuverlaessig erscheinen, wird am Ende des
Beobachtungszeitraums als `COST_TRUING_REQUIRED_RECORD_TYPES` festgeschrieben. Ohne diese
Menge hat P4 kein Vollstaendigkeits-Praedikat, sondern nur ein Anwesenheits-Praedikat — s. dort.
`costTruedSource` wird in P3 bereits nach dieser Menge gesetzt (`'incomplete'`, wenn ein
erwarteter Typ fehlt), auch wenn in dieser Phase noch nichts gebucht wird.

**Die leere Pflicht-Menge ist der gefaehrlichste Zustand dieser Variable, und ihre
LAUFZEIT-Regel wird deshalb hier getroffen, nicht erst in P4.** Das Praedikat aus P4 lautet "jeder Typ aus der Menge
ist vertreten" — ueber der LEEREN Menge ist das allquantifiziert wahr, also fuer **jeden**
Call erfuellt. Eine leere Menge verwandelt den Vollstaendigkeits- still zurueck in den
Anwesenheitsbeweis, den P4 ausdruecklich verwirft. Verbindlich gilt deshalb:

1. **Code-Default ist die leere Menge** — und die leere Menge bedeutet
   `costTruedSource='incomplete'` und **niemals eine negative Korrektur**. Nicht "alles
   erlaubt", sondern "nichts bewiesen".
2. **Kein geratener Nicht-leer-Default.** Ein vorbelegtes `['call-control']` waere
   schlimmer als leer: es saehe nach Vollstaendigkeit aus und wuerde Rueckerstattungen auf
   genau der duennen Datenlage zulassen, gegen die P4 argumentiert. Und die Enum-Werte sind
   UNBELEGT (Kap. 2.1) — ein vorbelegter falscher Name gaukelte eine gepruefte Menge vor.
   Die Menge wird gesetzt, wenn sie gemessen ist, und vorher nicht.
3. **Kein Boot-Guard in dieser Phase — der folgt in P4, und dort allein.** Der Riegel gegen
   die leere Pflicht-Menge lautet "ist die Korrekturbuchung aktiv und die Menge leer,
   verweigert der Boot"; er haengt damit an `COST_TRUING_BOOKING_ENABLED`, und dieses Feld
   wird **erst in P4** eingefuehrt (s. dort und Anhang). In P3 gebaut, laese er ein
   undefiniertes Config-Feld, waere die Bedingung dauerhaft falsy — eine Sicherung, die ab
   Merge strukturell tot ist, also genau die Klasse, vor der dieser Plan sonst warnt
   (PM-4, PM-8). Eigentum, Datei-Liste, Akzeptanzkriterium und Test dieses Guards liegen
   **ausschliesslich bei P4**; P3 liefert nur die Laufzeit-Regel aus Punkt 1 (leere Menge ->
   `costTruedSource='incomplete'`), und die traegt ohne jedes Flag.

**Die Deckungsquote wird HIER gerechnet und sichtbar gemacht, nicht erst dort, wo sie ein
Gate freigibt.** Seit Entscheidung 1 das Kalender-Fenster gestrichen hat, ist
`COST_TRUING_MIN_COVERAGE_PERCENT` die einzige verbliebene Vorbedingung des Flips — und eine
Vorbedingung, die niemand ablesen kann, ist keine: `COST_TRUING_BOOKING_ENABLED=true` bootet
bei 20 % Deckung genauso sauber wie bei 90 %. Verbindlich in dieser Phase:

1. **Benannte Funktion `costTruingCoveragePercent(store)`** in `src/billing/cost-truing.js`.
   Zaehler: beendete Outbound-Calls mit `costTruedSource === 'telnyx_detail_records'` **und**
   vollstaendiger Typ-Menge; Nenner: alle beendeten Outbound-Calls; Nenner 0 = **0 %**, kein
   Freispruch. Der P4- und der P4b-Boot-Guard **rufen diese eine Funktion auf**, statt die
   Rechnung ein zweites Mal zu erfinden. Sie ist weiterhin **nicht persistiert** (Anhang) —
   gerechnet wird live aus dem geladenen Spiegel.
2. **Jeder Sweep gibt die Quote am Ende seines Laufs aus** und meldet den Befund-Code
   `coverage_below_threshold`, wenn sie unter `COST_TRUING_MIN_COVERAGE_PERCENT` liegt —
   ueber denselben Kanal und mit derselben Entprellung wie die P5-Befunde
   (`COST_ALERT_DEBOUNCE_MS`), ohne Rufnummer und ohne Tenant-Klarnamen. Das ist der
   Mechanismus, der den unter "Risiko" beschriebenen **stillen** Ausfall sichtbar macht; er
   steht deshalb hier im Kern, in der Datei-Liste, im Akzeptanzkriterium und im Test — nicht
   nur in einem Prosa-Absatz. Eine Sicherung, die ausschliesslich in Prosa steht, ist ab
   Merge strukturell tot (dieselbe Regel wie Punkt 3 oben und wie in P4b).
3. **Terminierungsregel, falls die Schwelle nie erreicht wird.** Bleibt die Quote ueber
   `COST_TRUING_COVERAGE_STALL_SWEEPS` (Default **8**, bei 6-h-Intervall rund zwei Tage)
   aufeinanderfolgende Sweeps unter der Schwelle, ist das ein Alarm und eine ausdrueckliche
   Owner-Entscheidung faellig: Ursachenbehebung oder der in Kapitel 7 vorgesehene Endzustand
   "Abbruch nach P3/P5". **Die Schwelle darf dabei NICHT gesenkt werden, um die Vorbedingung
   zu erfuellen** — das waere die Sicherung an ihre eigene Verletzung angepasst. Siehe
   Entscheidung 1.

#### Betroffene Dateien

`src/billing/cost-truing.js` (neu — Sweep **und** `costTruingCoveragePercent(store)`),
`src/boot.js` (Intervall registrieren),
`src/routes/api-billing.js` (Trigger-Endpunkt), `src/config.js`, `.env.example`,
`render.yaml`, `test/cost-truing-observe.test.js` (neu).

#### Akzeptanzkriterium

- **Keine** Gate-, Budget- oder Metering-Entscheidung aendert sich; `usage.costCents` und
  `spendMonthCostCents` sind nach einem Lauf byte-identisch.
- Ein Call, dessen CDR-Abruf `{ ok: false }` liefert, bekommt `costTruedSource='unavailable'`
  und **bleibt** fuer einen spaeteren Lauf offen (`costTruedAt` bleibt `null`) — bis zu einer
  Obergrenze `COST_TRUING_MAX_ATTEMPTS` (Default 5), danach `costTruedAt` gesetzt +
  `'unavailable'`, damit der Job nicht ewig gegen tote Calls laeuft. Gezaehlt wird im
  **persistierten** `costTruingAttempts` (P2), nie in-memory — s. dort.
- Der Job laeuft ueber alle Tenants, nicht nur ueber den Bootstrap-Tenant.
- **Zwei ECHT ueberlappende Laeufe** (Intervall + manueller Endpunkt, verschraenkt an einem
  haengenden Provider-Abruf) verarbeiten jeden Call genau einmal — der zweite Lauf ist ein
  No-op, weil der Laufriegel greift. Nicht nur zwei sequenzielle Laeufe.
- Bei leerer `COST_TRUING_REQUIRED_RECORD_TYPES` ist `costTruedSource` **nie**
  `'telnyx_detail_records'`, sondern `'incomplete'` — die leere Menge beweist nichts.
- **`costTruingCoveragePercent(store)` existiert, ist benannt und wird am Ende jedes Sweeps
  ausgegeben.** Bei einem Nenner von 0 liefert sie **0**, nicht 100 und nicht `NaN`.
- **Liegt die Quote unter `COST_TRUING_MIN_COVERAGE_PERCENT`, meldet der Lauf genau einen
  Befund `coverage_below_threshold`** (entprellt ueber `COST_ALERT_DEBOUNCE_MS`); liegt sie
  darueber, meldet er keinen.
- Die WARN-Zeile enthaelt **keine** Rufnummer und keine Tenant-Klarnamen.

#### Rot-vor-Fix-Test

Neu `test/cost-truing-observe.test.js`, heute rot (Modul existiert nicht):
(a) Zwei beendete Calls, fingierter Adapter liefert Records -> `actualCostMicroCents` gesetzt,
`usage.costCents` **unveraendert** (das ist der eigentliche Beweis dieser Phase).
(b) Adapter liefert `{ ok:false }` -> `costTruedAt === null` nach Lauf 1, gesetzt nach Lauf 5.
(c) Call, der vor weniger als `COST_TRUING_DELAY_MINUTES` endete -> nicht angefasst.
(d) Zwei Tenants im Store -> beide Calls abgeglichen (RLS-Schleifen-Regression).
(e) Drift 20 ct geschaetzt vs. 5 ct Ist -> genau eine WARN-Zeile, ohne PII.
(f) Adapter ohne `getVoiceCostRecords` (Twilio) -> Lauf ist ein sauberer No-op.
(g) **Nebenlaeufigkeit:** Lauf 1 wird an einem nicht aufgeloesten Provider-Promise
angehalten, Lauf 2 startet in dieser Luecke -> Lauf 2 ist ein No-op, der Call wird genau
einmal verarbeitet, `costTruingAttempts` steigt um 1 und nicht um 2. Faellt rot aus, sobald
der Laufriegel fehlt oder nach dem `await` gesetzt wird.
(h) **Leere Pflicht-Menge:** vollstaendig aussehende Records, `COST_TRUING_REQUIRED_RECORD_TYPES`
leer -> `costTruedSource === 'incomplete'`. Der Test, der ab P4 verhindert, dass eine
vergessene Env-Var jede Schaetzung zurueckerstattet.
(i) **Deckungsquote:** 4 beendete Outbound-Calls, davon 3 sauber zugeordnet ->
`costTruingCoveragePercent(store) === 75`; **kein** beendeter Call -> **0**, nicht 100 und
nicht `NaN` (der Nenner-0-Freispruch waere die fail-open-Variante dieser Zahl).
(j) **Sichtbarkeit:** Quote unter `COST_TRUING_MIN_COVERAGE_PERCENT` -> genau ein Befund
`coverage_below_threshold` je Entprellfenster, ohne PII; Quote darueber -> kein Befund.
Faellt rot aus, sobald die Quote nur gerechnet, aber nicht gemeldet wird — genau der
Zustand, in dem "dann flippen wir halt trotzdem" unbemerkt bleibt.

#### Schutzniveau

**Unveraendert.** Der Job schreibt ausschliesslich in P2-Felder, die kein Gate liest.

#### Risiko

Der Job laeuft in einem Web-Dyno, der auf dem Free Tier schlafen kann. Faellt er dauerhaft
aus, bleiben Calls unabgeglichen — nach P4 heisst das: die Schaetzung bleibt stehen. Das ist
der konservative Fall (Ueberbuchung), aber es ist ein **stiller** Ausfall. Die Gegenmassnahme
steht nicht hier, sondern verdrahtet in Kern Punkt 2 (Quote je Sweep + Befund
`coverage_below_threshold`) und in Punkt 3 (Terminierungsregel nach
`COST_TRUING_COVERAGE_STALL_SWEEPS`); s. Pre-Mortem PM-4.

---

### P4 — Der Flip: Korrekturbuchung auf Ist-Kosten

**Behebt:** D1, D3, D12. **Aufwand:** L. **Abhaengig:** P3 **+ P5 aktiv** (der Drift-Alarm
muss VOR dem Flip scharf sein — s. Kapitel 7, Korrektur 1; P4s eigener Risiko-Abschnitt
verweist auf ihn als Gegenmassnahme) **+ eine belegte Mindest-Deckungsquote** und die
beantwortete Joinbarkeits-Frage aus P3, aus der die Pflicht-Menge gesetzt wird.

> **Owner-Entscheidung 1 (2026-07-20): Flip SOFORT, sobald die Deckungsquote steht — kein
> Kalender-Fenster.** Die frueher hier stehende Vorbedingung "abgeschlossener
> Beobachtungszeitraum (mind. 1 Woche oder 50 abgeglichene Calls)" **entfaellt**, ebenso die
> in Kapitel 8 empfohlenen vier Wochen. An ihre Stelle tritt eine gemessene Zahl:
> `COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80) — der Anteil der beendeten Outbound-Calls,
> die sich sauber einem Provider-Datensatz zuordnen lassen
> (`costTruedSource === 'telnyx_detail_records'` **und** vollstaendige Typ-Menge). Das kann
> nach wenigen Tagen erfuellt sein.
>
> **Die Reihenfolge ist dabei nicht frei waehlbar, sonst waere die Bedingung zirkulaer:**
> die Deckungsquote misst gegen die Pflicht-Menge, also muss diese zuerst aus echten
> API-Antworten abgeleitet und gesetzt sein (P3). Erst danach ist die Quote ueberhaupt
> definiert. Der Ablauf lautet: P3 beobachten -> Joinbarkeit beantwortet (Fall A/B) ->
> `COST_TRUING_REQUIRED_RECORD_TYPES` aus dem Beleg gesetzt -> Quote messen -> bei
> >= `COST_TRUING_MIN_COVERAGE_PERCENT` flippen. Was dabei aufgegeben wird, ist ausdruecklich
> benannt: die vier Wochen haetten seltene Ausfallmuster sichtbar gemacht, die in wenigen
> Tagen nicht auftreten (Provider-Wartungsfenster, Monatsgrenzen, verspaetete Records). Dieses
> Risiko traegt ab dem Flip allein das Vollstaendigkeits-Praedikat unten plus der
> P5-Drift-Alarm — nicht mehr die Zeit.
>
> **Dieselbe Schwelle wie P4b, bewusst keine zweite.** Geprueft wurde, ob der Flip eine eigene
> Konstante braucht. Ergebnis: nein. Die gemessene Groesse ist woertlich dieselbe (Anteil
> sauber zuordenbarer Calls), sie wird an derselben Stelle gerechnet (Boot-Guard, live aus dem
> Store-Spiegel, s. P4b Kern Punkt 3), und zwei Zahlen mit identischer Bedeutung driften
> auseinander, sobald eine von beiden nachgezogen wird. Der Preis dieser Wahl: der Flip
> wartet moeglicherweise ein paar Tage laenger, als er streng genommen muesste — die
> Sicherheit des Flips haengt naemlich am Vollstaendigkeits-Praedikat, nicht an der Quote; die
> Quote belegt nur, dass die Messpipeline ueberhaupt traegt. Ein paar Tage sind dafuer der
> guenstigere Preis als eine zweite Zahl mit demselben Namen im Kopf.
>
> P4 und P4b bleiben trotz gemeinsamer Schwelle **getrennte** Phasen: P4b verlangt
> zusaetzlich die Vollkostendeckung (Punkt 1 dort) und die praefix-saubere Freigabe. Die
> Quote ist die gemeinsame Vorbedingung, nicht die einzige.

#### Ziel

`usage.costCents` wird zur Wahrheit: die Schaetzung wird nach dem Abgleich um die Differenz
zum gemessenen Preis korrigiert.

#### Kern

Der Kosten-Abgleich bucht zusaetzlich eine Korrektur. **Die Formel vollstaendig, mit der
Waehrungsumrechnung an ihrer einzigen Stelle** (das ist die Umrechnung, die P2 hierher
verweist — sie darf nirgends sonst stattfinden und darf hier nicht fehlen):

**Die Formel ist float-frei, und das ist keine Formalie.** Die naheliegende Fassung
(`actualCostMicroCents * rate / 1_000_000`, danach runden) fuehrt eine JS-Division und damit
einen Float auf dem Geldpfad ein — im Widerspruch zu P1, das eigens einen string-basierten
Parser vorschreibt, der `parseFloat` nie beruehrt (G26), und im Widerspruch zur Rest-Uebertrag-
Zusage weiter unten: ein Rest ist nur dann exakt, wenn der Zwischenwert ganzzahlig bleibt.
Deshalb verbindlich nach dem Muster von `trackUsage` (`state-ops.js:1614-1618`:
`Math.floor(totalMicro / MICRO_CENTS_PER_CENT)` und `totalMicro % MICRO_CENTS_PER_CENT` auf
Ganzzahlen) — Multiplikation zuerst, **eine** Division ganz am Ende, gemeinsam mit der
Cent-Rundung:

```
DIVISOR    = MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE      // 1e6 * 1e6 = 1e12
totalMicro = costCorrectionMicroCentsRem + actualCostMicroCents * providerToBucketRateMicro
istBucketCents = Math.floor(totalMicro / DIVISOR)
costCorrectionMicroCentsRem = totalMicro % DIVISOR            // nie verworfen
costCorrectionCents = istBucketCents - estimatedCostCents
```

`PROVIDER_RATE_SCALE` (= 1_000_000) ist die Skala, in der `providerToBucketRateMicro`
gefuehrt wird — benannt, nicht als nackte `1_000_000` im Rumpf, und aus derselben Quelle wie
der Kurs selbst. Alle Operanden sind Ganzzahlen, `totalMicro` ist nicht-negativ
(`actualCostMicroCents >= 0`, Rest immer in `[0, DIVISOR)`), damit sind `Math.floor` und `%`
exakt. **Groessenordnung geprueft:** ein teurer Call liegt bei ~5,4e6 Mikro-Cent, mal 9,2e5
sind 4,97e12 — knapp vier Zehnerpotenzen unter `Number.MAX_SAFE_INTEGER` (9,007e15). Selbst
ein 1000-fach teurerer Call bliebe im sicheren Bereich.

Beide Operanden der Differenz sind damit **EUR-Cents**. Wuerde die Umrechnung fehlen, wuerden
USD-Mikro-Cents direkt gegen einen EUR-Cent-Bucket subtrahiert — exakt der Waehrungsbruch D5,
den dieser Plan behebt, nur diesmal auf dem Buchungspfad. Beispiel bei Kurs 0,92: Ist 50
USD-Cent, Schaetzung 20 EUR-Cent -> Korrektur **+26**, nicht +30.

`estimatedCostCents` ist der **persistierte** Wert aus P2, nie ein zur Abgleichzeit neu
berechneter (Kapitel 4). Ein Call ohne persistierten Schaetzbetrag — jede Bestandszeile von vor
P2 — ist **nicht korrigierbar**: `costTruedSource='incomplete'`, keine Buchung, `costTruedAt`
gesetzt, damit er nicht ewig wiedervorgelegt wird.

**Hinter `COST_TRUING_BOOKING_ENABLED` (Default AUS).** Abschaltplan verbindlich: das Flag
wird in **P8** entfernt, nachdem ein voller Abrechnungsmonat mit Flag AN ohne Drift-Alarm
gelaufen ist. Ein Flag ohne Entfernungsdatum ist ein Befund, kein Feature (G4/F4).

**Der zentrale Sicherheits-Entwurf — asymmetrische Korrektur.** Eine negative Korrektur
gibt Budget frei. Ein CDR-Abruf, der faelschlich 0 oder unvollstaendig zurueckkommt, wuerde
also die gesamte Schaetzung zurueckerstatten: der Ausfall der Messung wuerde zu
"kein Verbrauch" — exakt die fail-open-durch-Vergessen-Klasse, die dieser Plan verhindern
soll. Deshalb:

**"Vollstaendig" haengt an der erwarteten Record-Type-Menge, nicht an "mind. ein Record".**
Das ist der Unterschied zwischen einem Anwesenheits- und einem Vollstaendigkeitsbeweis, und er
entscheidet ueber die Tragfaehigkeit dieser ganzen Phase. Waere "mind. 1 Record" das Kriterium,
wuerde ein Abruf, der nur den `call-control`-Record liefert, als vollstaendig gelten — obwohl
STT/TTS/Recording/Inference 1,25 von 5,4 ct/min ausmachen (23 %, mit Assistant-Pfad ueber 50 %)
und laut P3 **UNBELEGT** ist, ob sie ueberhaupt joinbar sind. Konkretes Versagen: Telnyx stellt
die Emission der `speech-to-text`-Records um (PM-8), das Ist faellt von 5,4 auf 3,9 ct/min, die
Drift betraegt 25 % und bleibt damit unter `COST_DRIFT_WARN_PERCENT` (50) — kein Alarm, und die
Korrektur erstattet die Differenz still zurueck, weil die Datenlage formal "vollstaendig" aussah.
Das Gate zaehlte dauerhaft 23 % zu wenig.

| Fall | Wirkung |
| --- | --- |
| `costTruedSource === 'telnyx_detail_records'`, `billedSec > 0`, Leg passt, **`estimatedCostCents` persistiert**, und **jeder** Typ aus `COST_TRUING_REQUIRED_RECORD_TYPES` ist vertreten (Fall A) bzw. die fehlenden Typen sind ueber `voiceOverheadCentsPerMin` ersetzt (Fall B) | Korrektur wird gebucht, beide Vorzeichen |
| Ist > Schaetzung | **immer** gebucht (Unterschaetzung wird immer geheilt, auch bei duenner Datenlage) |
| Ist < Schaetzung, aber Datenlage unvollstaendig (`'incomplete'`, `'unavailable'`, 0 Records, `billedSec === 0`, ein erwarteter record_type fehlt, oder `estimatedCostCents` fehlt) | **keine Korrektur.** Die Schaetzung bleibt stehen. |
| Waehrung unbekannt oder abweichend | keine Korrektur |
| **`COST_TRUING_REQUIRED_RECORD_TYPES` leer** | **keine negative Korrektur, `costTruedSource='incomplete'`** — und der Boot ist bei aktiver Buchung ohnehin verweigert (s.u.) |

Die Pflicht-Menge kommt aus dem P3-Beleg, nicht aus einer Annahme.

**Die leere Pflicht-Menge ist die Achillesferse dieses Praedikats und wird zweifach
verriegelt.** "Jeder Typ aus der Menge ist vertreten" ist ueber der leeren Menge fuer jeden
Call wahr — der Vollstaendigkeits- degenerierte still zum Anwesenheitsbeweis, also zu genau
dem Kriterium, das dieser Abschnitt zwei Absaetze weiter oben als untauglich verwirft. Der
realistische Weg dorthin ist kein Denkfehler, sondern ein halber Deploy: Flag auf Render
gesetzt, die zweite neue Env-Var vergessen. Deshalb:

- **Laufzeit-Riegel (P3):** leere Menge -> `'incomplete'` -> keine negative Korrektur. Der
  Riegel liegt in P3 und gilt damit schon vor dem Flip.
- **Boot-Riegel (diese Phase):** ist die Korrekturbuchung aktiv und die Pflicht-Menge leer,
  **verweigert der Boot** — dasselbe Muster wie beim Kurs-Guard. Ein Dienst, der Geld
  zurueckerstattet, ohne zu wissen, wogegen er Vollstaendigkeit prueft, darf nicht starten.
- **Deckungs-Riegel (diese Phase, WARN):** ist die Korrekturbuchung aktiv **und** liegt
  `costTruingCoveragePercent(store)` (P3, Kern Punkt 1) unter
  `COST_TRUING_MIN_COVERAGE_PERCENT`, meldet der Boot **genau eine WARN** — Stufe WARN, kein
  `exit(1)`, Praezedenz `warnUnpricedModels` (`boot.js:70-81`), gerechnet aus dem bereits
  geladenen Spiegel wie beim P4b-Guard. Ohne ihn ist die einzige Vorbedingung, die
  Entscheidung 1 vom Kalender-Fenster uebernommen hat, am Flip selbst **nicht durchgesetzt**:
  ein Flip bei 20 % Deckung bootet sonst sauber und faellt niemandem auf. Ein Boot-Refusal
  waere hier falsch — er tauschte ein Kostenproblem gegen einen Telefonie-Totalausfall; die
  laute Linie ist der Befund `coverage_below_threshold` aus P3.

Ohne diese beiden Riegel waere der Ausfallmodus konkret: Ist 3,9 ct gegen persistierte
Schaetzung 20 ct, Datenlage formal "vollstaendig", Korrektur -16 ct **je Call**. Weil
`gateUsageCents` bei `BUDGET_MONTH_ENABLED=false` genau `bucket.costCents` liest und
`MAX_BUDGET_EUR` ein geteilter Lebenszeit-Topf ist, gibt jede dieser Rueckerstattungen
Plattform-Budget frei, das andere Tenants verbrauchen. Der Drift-WARN faengt das nicht: der
oben durchgerechnete PM-8-Fall liegt bei 25 % und damit unter der Schwelle von 50 %. In **Fall B** (Typen
erwartet, aber nicht joinbar) ist der Aufschlag `voiceOverheadCentsPerMin` **nicht optional**:
er muss die fehlenden Typen ersetzt haben, **bevor** die Vollstaendigkeit bejaht werden darf.
Ein neuer, unbekannter record_type erzeugt eine WARN (PM-8), macht den Call aber nicht
unvollstaendig — Unbekanntes addiert, es fehlt nicht.

In einem Satz: **Geld darf jederzeit nachgebucht, aber nur bei beweisbar vollstaendiger
Datenlage zurueckgegeben werden** — und "beweisbar vollstaendig" heisst: die erwarteten
Kostenarten sind alle da oder alle ersetzt.

**Vorzeichenfaehiger Buchungspfad (D12).** `addVoiceUsageCostCents` verwirft negative Werte
ueber `isBookableCents` (`defaults.js:199-201`) — korrekt, das ist der Korruptions-Riegel und
er bleibt unangetastet. Neu daneben: `bookCostCorrectionCents(s, tenantId, deltaCents, nowIso)`
mit eigenem Praedikat `isCorrectionCents(x)` (`Number.isInteger`, endlich, **beliebiges
Vorzeichen**) und einem harten Boden: `usage.costCents` faellt nie unter 0.

**Monatsachse asymmetrisch (Kollision mit PLAN-BUDGET-AXES).** Eine Korrektur trifft
moeglicherweise einen Call aus dem Vormonat. Regel: **positive** Korrekturen gehen in
beide Achsen (Lebenszeit + laufender Monat, ueber `bookCents`), **negative** Korrekturen
gehen **nur** in die Lebenszeit-Achse. Sonst liesse sich die Monatsdecke durch verspaetete
Gutschriften aus einem abgeschlossenen Monat aufweiten — ein Cap, den man mit alten Calls
zurueckdrehen kann, ist kein Cap. Der resultierende Unterschied zwischen den Achsen ist
gewollt und gehoert in den Schema-Kommentar.

**Was diese Asymmetrie NICHT leistet — ausdruecklich, damit sie niemand fuer staerker haelt,
als sie ist.** Sie schuetzt die **Monats**achse. Die Monatsachse speist heute aber gar kein
Gate: `gateUsageCents` liest bei `BUDGET_MONTH_ENABLED=false` (Live-Default) genau
`bucket.costCents`, also die **Lebenszeit**achse (`state-ops.js:1675-1678`) — und genau dorthin
geht die negative Korrektur ungebremst. Zudem ist `MAX_BUDGET_EUR` ein **geteilter**
Lebenszeit-Topf: eine Rueckerstattung bei Tenant A vergroessert den Plattform-Rest, den
Tenant B verbraucht. Der eigentliche Schutz der negativen Richtung ist deshalb **nicht** diese
Asymmetrie, sondern das Vollstaendigkeits-Praedikat oben plus der persistierte
`estimatedCostCents`. Die Achsen-Asymmetrie ist eine zusaetzliche Sicherung fuer den Tag, an
dem `BUDGET_MONTH_ENABLED` auf AN geht — nicht die tragende.

**Der 0-Boden hat einen Nebeneffekt, der in den Kommentar gehoert.** Wird `usage.costCents` auf
0 geklemmt, bricht still die Invariante `spendMonthCostCents <= costCents`. `spendOrDeny`
nutzt die Lebenszeitzahl als unabhaengige Gegenprobe gegen die Monatszahl; nach einem Clamp ist
diese Gegenprobe nicht mehr aussagekraeftig. Heute entsteht daraus kein Schaden (beide bleiben
buchbar), aber die geaenderte Bedeutung der Gegenprobe wird am Praedikat dokumentiert.

**Rundung (G26):** das `Math.floor` der Formel oben ist die **einzige** Rundung vom Mikro-Cent
auf den Cent, an genau einer Stelle, mit Rest-Uebertrag nach dem Muster von `trackUsage`
(`state-ops.js:1601-1619`): der Sub-Cent-Rest der Korrekturen wird in
`costCorrectionMicroCentsRem` gehalten und nie verworfen. Weil die Waehrungsumrechnung in
denselben Schritt gezogen ist, existiert **keine** zweite, undeklarierte Praezisionsstufe
davor — der Rest ist konstruktiv exakt und nicht nur fuer die zufaellig gewaehlten Testwerte.

**Alles-oder-nichts: der Uebertrag wird ausschliesslich ZUSAMMEN mit der Buchung
fortgeschrieben.** Die Formel oben laeuft auf jedem ausgewerteten Call, die Fall-Tabelle
verwirft aber mehr Zustaende, als sie bucht (`'incomplete'`, `'unavailable'`, fehlendes
`estimatedCostCents`, unbekannte Waehrung, leere Pflicht-Menge, negative Korrektur bei
duenner Datenlage). Verbindlich: **wird die Korrektur nach der Fall-Tabelle verworfen,
bleibt `costCorrectionMicroCentsRem` bit-gleich unveraendert** — der neue Rest wird
zusammen mit dem gebuchten Cent geschrieben oder gar nicht, nach dem Muster von
`discardCorruptWrite` in `trackUsage` (`state-ops.js`). Ohne diese Regel waere der
"nie verworfene" Uebertrag kein Uebertrag mehr, sondern ein aus **nicht gebuchten**
Betraegen gespeister Zaehler: er wuechse aus Faellen, deren volle Cents nie in `costCents`
landen, und koennte eine spaetere negative Korrektur um einen Cent vergroessern — also in
die freigebende Richtung wirken. Die Wirkung ist konstruktiv auf unter 1 Cent je Korrektur
begrenzt, die Regel steht hier trotzdem, weil sonst der haeufigste Pfad dieser Phase
("Formel laeuft, Buchung faellt aus") unspezifiziert und ungetestet bliebe. Ohne diesen Uebertrag verschwindet
bei vielen kleinen Calls systematisch bis zu 1 Cent je Call — bei 5,4 ct/min ein Fehler von
bis zu 18 %.

Dieses Rest-Feld wird **persistiert**, sein Schwester-Feld `costMicroCentsRem` dagegen
ausdruecklich **nicht** (`pg.js:923`: "ephemer, nicht persistiert; Boot startet bei 0"). Zwei
gleich benannte Rest-Felder mit unterschiedlicher Lebensdauer nebeneinander sind eine Falle fuer
den naechsten Leser, deshalb die Begruendung hart im Schema-Kommentar: der Korrektur-Rest
sammelt sich ueber **Tage** (ein Abgleichlauf alle 6 h, verzoegert um 180 min), waehrend der
`trackUsage`-Rest innerhalb eines Gespraechs entsteht und verbraucht wird. Ein Restart wirft
beim Korrektur-Rest also echtes Geld weg, beim Usage-Rest nicht.

**Idempotenz:** `costTruedAt` ist der Riegel (nicht `billedAt` — der ist fuer die Schaetzung
zustaendig und bleibt es). Gesetzt = korrigiert. Der Test pinnt, dass ein zweiter Lauf nichts
bucht. Gegen **gleichzeitige** Laeufe traegt dieser Riegel nicht — dafuer sorgt der
Laufriegel aus P3, der genau deshalb dort und nicht hier steht.

**Nebenwirkung des Riegels, damit sie niemanden ueberrascht:** P3 setzt `costTruedAt`
bereits im Beobachtungsmodus. Alle bis zum Flip abgeglichenen Calls sind danach damit
**dauerhaft unkorrigierbar** — sie gelten als "schon
abgeglichen", obwohl nie gebucht wurde. Das ist die konservative Richtung (die Ueberbuchung
dieser Calls bleibt stehen, es wird nichts zurueckerstattet) und deshalb kein Fehler,
sondern eine Entscheidung: ein Nachholen ueber alte Calls waere eine gebuendelte
Rueckerstattung aus einem Zeitraum, in dem der Buchungspfad noch nie gelaufen ist — die
denkbar schlechteste erste Bewaehrungsprobe. Praktisch heisst das: **nach dem Flip
korrigiert der Job zunaechst fast nichts**, weil der Bestand abgearbeitet ist, und faengt
erst mit den neuen Calls an. Wer das nicht erwartet, haelt den Flip faelschlich fuer
wirkungslos. **Mit dem sofortigen Flip aus Entscheidung 1 faellt dieser tote Bestand
kleiner aus als bei vier Wochen Beobachtung** — der einzige Nebeneffekt jener Entscheidung,
der in die guenstige Richtung wirkt.

**Zur Nebenkosten-Frage:** Fall A (Records joinbar) -> sie fliessen automatisch in die Summe,
`voiceOverheadCentsPerMin` bleibt 0 und wird nicht eingefuehrt. Fall B (nicht joinbar) ->
die Korrektur addiert `voiceOverheadCentsPerMin * minuten` zum joinbaren Ist-Wert, mit dem
aus Kap. 2.1 abgeleiteten Default **2** (1,25 aufgerundet und aufgeschlagen; konservativ nach
oben, nie nach unten). Welcher Fall gilt, entscheidet der P3-Beleg, nicht dieser Plan.

#### Betroffene Dateien

`src/billing/cost-truing.js`, `src/store/state-ops.js`, `src/store/defaults.js`,
`src/store/pg.js` + `src/db/schema.sql` (Rest-Feld), `src/boot-guard.js` (**drei Dinge:
neu hier der Riegel gegen die leere Pflicht-Menge — er ist Eigentum DIESER Phase, weil er
das erst hier eingefuehrte `COST_TRUING_BOOKING_ENABLED` liest, s. P3 Punkt 3; neu hier der
Deckungs-Riegel (WARN) gegen `COST_TRUING_MIN_COVERAGE_PERCENT`, der
`costTruingCoveragePercent(store)` aus P3 aufruft und nichts eigenes rechnet; und die
Anhebung des seit P2 bestehenden Kurs-Guards von WARN auf FATAL, s. P2 Punkt 2**),
`src/config.js`, `.env.example`, `render.yaml`, `test/cost-truing-booking.test.js` (neu),
`test/usage-correction-booking.test.js` (neu), `test/boot-guard-*.test.js`.

#### Akzeptanzkriterium

- Flag AUS -> Verhalten byte-identisch zu P3 (der Deploy ist wirkungsfrei).
- Flag AN, vollstaendige Daten, Ist < Schaetzung -> `costCents` sinkt um genau das Delta.
- Flag AN, **unvollstaendige** Daten, Ist < Schaetzung -> `costCents` bleibt unveraendert.
- Ist > Schaetzung -> gebucht, unabhaengig von der Vollstaendigkeit.
- **Ein Tarifwechsel zwischen Buchung und Abgleich laesst die Korrektur unveraendert korrekt**
  (der Beweis, dass gegen den persistierten Schaetzbetrag gerechnet wird).
- **Fehlt ein Typ aus `COST_TRUING_REQUIRED_RECORD_TYPES`, wird nicht zurueckerstattet** — auch
  wenn Records vorhanden sind und `billedSec > 0`.
- **Ein Call ohne `estimatedCostCents` (Bestandszeile) wird nie korrigiert.**
- **Leere `COST_TRUING_REQUIRED_RECORD_TYPES` + Buchung aktiv -> der Boot verweigert**; und
  laufzeitseitig fuehrt die leere Menge nie zu einer negativen Korrektur.
- **Buchung aktiv + Deckungsquote unter `COST_TRUING_MIN_COVERAGE_PERCENT` -> genau eine
  WARN am Boot**, kein `exit(1)`; oberhalb der Schwelle schweigt der Guard. Der Guard
  **rechnet nicht selbst**, sondern ruft `costTruingCoveragePercent(store)` aus P3 auf —
  zwei Rechnungen derselben Groesse waeren zwei Zahlen, die auseinanderlaufen.
- Die Umrechnung mit `providerToBucketRateMicro` ist im Ergebnis nachweisbar (ein Testfall mit
  Kurs != 1,0 pinnt einen von der USD-Zahl abweichenden EUR-Betrag).
- `costCents` erreicht nie einen negativen Wert.
- Negative Korrektur laesst `spendMonthCostCents` unangetastet.
- 200 Korrekturen von je 0,4 Cent verlieren zusammen keinen Cent — **auch bei einem Kurs
  != 1,0**, also mit Umrechnung und Rest-Uebertrag im selben Testfall statt in zwei getrennten.
- **Ein verworfener Lauf laesst `costCorrectionMicroCentsRem` bit-gleich.** Testfall:
  Rest-Stand ablesen, eine Korrektur ueber einen Call mit unvollstaendiger Datenlage laufen
  lassen (Ist < Schaetzung, ein Pflicht-`record_type` fehlt) -> weder `costCents` noch der
  Rest aendern sich; die **darauf folgende** gebuchte Korrektur liefert exakt denselben Wert
  wie in einem Durchlauf ohne den verworfenen Lauf. Faellt rot aus, sobald der Rest vor der
  Fall-Entscheidung geschrieben wird (alles-oder-nichts, s. Rundungs-Absatz).
- **Der Kurs-Guard ist ab dieser Phase FATAL** (in P2 als WARN eingefuehrt): ein Kurs
  ausserhalb `[PROVIDER_RATE_BAND_MIN_FACTOR .. PROVIDER_RATE_BAND_MAX_FACTOR]` des Ankers
  verweigert den Boot, weiterhin ohne jede Flag-Bedingung.
- Zweiter Lauf ueber denselben Call bucht nichts.

#### Rot-vor-Fix-Test

Neu, heute rot (`bookCostCorrectionCents` existiert nicht, `isBookableCents` wuerde jedes
negative Delta verwerfen):
(a) Schaetzung 20 ct gebucht, Ist 5 ct, Quelle vollstaendig -> `costCents` = alt - 15.
(b) Gleiches Szenario, Quelle `'incomplete'` -> `costCents` = alt (**der wichtigste Test des
ganzen Plans**).
(c) Schaetzung 5 ct, Ist 20 ct, Quelle `'incomplete'` -> `costCents` = alt + 15 (Asymmetrie
in der Gegenrichtung).
(d) Tenant hat nur 3 ct gebucht, Korrektur -15 -> `costCents === 0`, kein negativer Wert.
(e) Negative Korrektur -> `spendMonthCostCents` bleibt bit-gleich.
(f) 200 x 400.000 Mikro-Cent-Korrekturen bei Kurs **920000** -> exakt 73 Cent
(`200 * 400000 * 920000 = 7,36e13`, geteilt durch `DIVISOR` 1e12 = 73 Rest 6e11), Rest nie
zurueckgesetzt und nach dem Lauf exakt `600.000.000.000`. **Kurs und Rest-Uebertrag stehen
bewusst in EINEM Fall**, weil getrennt gepinnt genau die Float-Zwischenstufe durchrutscht,
die die Formel vermeiden soll: mit `* rate / 1e6` als Zwischenschritt weicht die Summe ab.
(g) Flag AUS -> alle obigen Faelle aendern nichts.
(h) Zweiter Lauf ueber denselben Call -> No-op.
(i) **Tarif-Drift:** Call mit `estimatedCostCents = 18` (gebucht bei Tarif 6), Konfiguration
danach auf Tarif 25 gewechselt, Ist 16 ct -> Korrektur **-2**, nicht -59. Faellt rot aus,
sobald jemand die Schaetzung zur Abgleichzeit neu berechnet.
(j) **Waehrung:** Ist 50 USD-Cent, `providerToBucketRateMicro` = 920000, Schaetzung 20 ->
Korrektur **+26**. Mit fehlender Umrechnung waere es +30 — der Test faellt dann rot.
(k) **Unvollstaendige Typ-Menge:** Records vorhanden, `billedSec > 0`, aber **einer** der in
`COST_TRUING_REQUIRED_RECORD_TYPES` gefuehrten Typen fehlt (der Test setzt die Menge selbst
und haengt nicht an einem geratenen Enum-Namen), Ist < Schaetzung -> `costCents`
unveraendert.
(l) **Bestandszeile:** Call ohne `estimatedCostCents`, Ist < Schaetzung -> keine Buchung,
`costTruedSource === 'incomplete'`.
(m) **Leere Pflicht-Menge:** vollstaendig aussehende Records, Pflicht-Menge leer, Ist <
Schaetzung -> `costCents` unveraendert. Rot, sobald das Praedikat ueber der leeren Menge
allquantifiziert wahr wird.
(n) **Boot-Riegel:** Buchung aktiv + Pflicht-Menge leer -> Boot verweigert; Buchung aktiv +
Pflicht-Menge besetzt -> Boot laeuft.
(o) **Kurs-Guard jetzt FATAL:** `PROVIDER_TO_BUCKET_RATE_MICRO=920`, ohne jedes Flag-Setup
-> Boot **verweigert** (in P2 war derselbe Fall eine WARN mit laufendem Boot; dieser Test
faellt rot, solange die Anhebung fehlt). `=920000` -> Boot laeuft.
(p) **Deckungs-Riegel:** Buchung aktiv, Spiegel mit 5 beendeten Outbound-Calls, davon 1
sauber zugeordnet (20 %) -> genau eine WARN, Boot laeuft weiter; derselbe Spiegel mit 5 von
5 (100 %) -> keine WARN; Buchung AUS bei 20 % -> keine WARN. Faellt rot aus, solange der
Flip ohne jede Durchsetzung seiner einzigen Vorbedingung deployt werden kann.

#### Schutzniveau

**Formal schwaecher, real staerker — die einzige Phase mit dieser Eigenschaft, deshalb
ausdruecklich benannt.** Nach P4 kann die gebuchte Summe erstmals sinken, ohne dass jemand
eine Einstellung aendert. Das ist per Definition eine Lockerung der Bremse. Sie ist
vertretbar, weil (1) sie nur bei beweisbar vollstaendiger Datenlage eintritt, (2) sie den
Zaehler auf die Wirklichkeit zieht statt auf eine guenstigere Annahme, und (3) die
Unterschaetzungs-Richtung ohne jede Bedingung korrigiert wird. Wer diese Phase nicht
akzeptiert, muss den Plan hier beenden — P1-P3 sind fuer sich genommen vollstaendig und
liefern die Sichtbarkeit; P4 ist der Punkt, an dem Sichtbarkeit zu Wirkung wird.

#### Risiko

Ein Provider-Bug, der systematisch zu niedrige Records mit vollstaendig aussehenden
Metadaten liefert, wuerde flaechendeckend Budget freigeben. Gegenmassnahme: der
Drift-WARN aus P3 bleibt aktiv, und P5 macht daraus einen Alarm mit Schwelle — die
Kalibrierung wird nie automatisch aus diesen Daten gezogen (s. P5).

---

### P4b — Die ENV-Senkung (Owner-Aktion **plus** ein Boot-Guard)

**Behebt:** D2 (die eigentliche Ueberbuchung). **Aufwand:** S. **Abhaengig:** P4 **mit Flag AN**,
**Deckungsquote >= `COST_TRUING_MIN_COVERAGE_PERCENT`** (dieselbe Schwelle, die seit
Entscheidung 1 auch den Flip freigibt — s. P4) **plus** die beiden P4b-eigenen Vorbedingungen
aus dem Kern (Vollkostendeckung, praefix-saubere Freigabe)

#### Warum das eine eigene, benannte Phase ist

Kapitel 5 sagt: "Der Tarif darf erst sinken, wenn die Buchung ueberwiegend nicht mehr an ihm
haengt (nach P4)." Ohne diese Phase saehe der Plan aus, als sei D2 durch P3/P5 behoben — die aber nur
**sichtbar** machen. Keine der uebrigen Phasen senkt `VOICE_TARIFF_DOMESTIC_CENTS`. Eine
Ueberbuchung um Faktor ~4, die niemand mehr als offenen Punkt fuehrt, weil sie in einer
Uebersichtstabelle als "behoben" steht, ist exakt die Fehlerklasse dieses Plans.

#### Kern

`VOICE_TARIFF_DOMESTIC_CENTS` von 20 auf den gemessenen Reserve-Bedarf senken. Der Wert bleibt
bewusst **ueber** den gemessenen 5,13 ct/min Voice-Anteil — die Reserve soll den Anruf decken,
nicht ihn punktgenau treffen; Unterschaetzung ist hier die gefaehrliche Richtung (die Reserve
deckt den Anruf nicht).

**Die frueher hier stehende Begruendung "nach P4 haengt die Buchung nicht mehr am Tarif" ist
am Code FALSCH und wird zurueckgenommen.** `reconcileOutboundVoiceBudget`
(`metering.js:50-55`) bucht auch nach P4 unveraendert `minuten * tariffCentsPerMin(call.to)`;
P4 fasst `metering.js` gar nicht an (s. dessen Datei-Liste) und addiert lediglich eine
**Delta-Korrektur fuer Calls, die den Abgleich erfolgreich UND mit vollstaendiger Datenlage
durchlaufen haben**. Fuer jeden anderen Call — CDR-API kaputt (PM-4), `'unavailable'` nach
`COST_TRUING_MAX_ATTEMPTS`, `'incomplete'`, Bestandszeile ohne `estimatedCostCents` — bleibt
der gebuchte Betrag **exakt** `minuten * Tarif`. Eine Tarifsenkung senkt damit sehr wohl die
Buchung, und zwar genau in den Faellen, in denen die Messung ausgefallen ist. Bisher deckte
das 20-ct-Polster diese Faelle ab; P4b streicht es. Deshalb gelten **zwei harte
Vorbedingungen**, nicht nur die Reihenfolge:

1. **Der neue Tarif muss die vollen variablen Voice-Kosten der teuersten AKTIVIERBAREN
   Konfiguration decken** — nicht die der heute laufenden, und nicht die der beabsichtigten.
   Owner-Entscheidung 5 (2026-07-20) verwirft den `ai-voice-assistant`-Pfad ganz; der
   **Rueckbau selbst ist aber nicht Teil dieses Plans** (Scope, s. D4). **Verbindlich gilt
   deshalb eine Bedingung mit zwei Werten und einem klar benannten Ausloeser:**

   | Zustand des Assistant-Pfads | `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` | Herleitung |
   | --- | --- | --- |
   | **heute:** im Code vorhanden und per Env aktivierbar (`TELNYX_AI_ASSISTANT_ENABLED`) | **10 EUR-ct** | 10,4 USD-ct/min (Kap. 2.2) x 0,92 = 9,568, aufgerundet |
   | **nach vollzogenem Rueckbau** aus `adapters/telnyx/voice.js` und `config.js` | **5 EUR-ct** | 5,4 USD-ct/min (Kap. 2.1) x 0,92 = 4,968, aufgerundet |

   **Ausloeser fuer den Wechsel ist der gemergte Rueckbau, nicht die Absicht.** Eine
   Owner-Entscheidung entfernt keinen Code-Pfad; solange `startAssistant` existiert und ein
   Env-Wert ihn scharf schaltet, ist die konservative Schwelle die richtige. Der Beleg fuer
   den Wechsel ist derselbe wie fuer jede andere Behauptung dieses Plans: ein grep, der den
   Pfad nicht mehr findet — nicht ein Satz in einem Dokument.
   Ein Tarif von 6 waere sonst der Buchungswert
   jedes nicht abgeglichenen Calls in einer Welt, die real 10,4 USD-ct kostet — der geteilte
   Lebenszeit-Topf `MAX_BUDGET_EUR` liefe dauerhaft ~40 % zu langsam, und Tenant B verbrauchte
   Plattform-Budget, das real schon ausgegeben ist. **Vorzuziehen ist deshalb, den Rueckbau
   vor P4b zu fahren**; welcher der beiden Zustaende bei der Umsetzung galt, gehoert in den
   Phasen-Report.
2. **Gemessene Abgleich-Deckungsquote ueber dem Beobachtungsfenster.** Anteil der beendeten
   Outbound-Calls mit `costTruedSource === 'telnyx_detail_records'` **und** vollstaendiger
   Typ-Menge an allen beendeten Outbound-Calls des Fensters. Untergrenze benannt:
   **`COST_TRUING_MIN_COVERAGE_PERCENT`, Default 80**. Liegt die Quote darunter, **darf der
   Tarif nicht sinken** — dann ist die Buchung ueberwiegend Tarif und nicht Messung, und die
   Senkung waere eine Budget-Lockerung ohne Gegenwert. Die Quote ist eine Zahl aus dem
   Betrieb, kein Gefuehl: P3 zaehlt die Zustaende bereits je Call.
   **Seit Entscheidung 1 traegt dieselbe Konstante zwei Lasten**: sie gibt den Flip in P4
   frei und sie ist Vorbedingung dieser Senkung (Begruendung im Entscheidungs-Kasten von P4).
   P4b bleibt dennoch die strengere Phase — Punkt 1 und die Praefix-Regel gelten nur hier.
3. **Die gefaehrliche KOMBINATION aus beiden Vorbedingungen bekommt einen Riegel im Code —
   sonst gilt sie nur zum Zeitpunkt der Aktion und nicht danach** (Begruendung im
   Schutzniveau-Abschnitt). Deshalb ist P4b **keine** reine Owner-Aktion: sie bringt einen
   **Boot-Guard (WARN)** mit, der beim Start prueft, ob `voiceTariffDomesticCents` unter der
   **Vollkostenschwelle** `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` liegt (benannte Konstante,
   kein Literal im Guard-Rumpf; **Default 10 EUR-Cent**, nach dem Rueckbau des
   Assistant-Pfads **5** — die Zwei-Werte-Tabelle aus Punkt 1 gilt hier unveraendert und
   steht dort an genau einer Stelle). Ist der Tarif darunter **und** liegt
   die Deckungsquote unter `COST_TRUING_MIN_COVERAGE_PERCENT`, meldet der Guard genau eine
   WARN.
   **Herleitung beider Defaults, mit Kurs (Kap.-2.1-Regel):** die 10,4 bzw. 5,4 ct/min aus
   Kap. 2.2/2.1 sind **USD**-Cent, `voiceTariffDomesticCents` ist dagegen **EUR**-nativ
   (Kap. 1). Also umrechnen: 10,4 * 0,92 = **9,568**, aufgerundet **10**; 5,4 * 0,92 =
   **4,968**, aufgerundet **5**. Die frueher
   hier stehende 11 nahm die USD-Zahl unmarkiert als EUR-Schwelle — derselbe unmarkierte
   Kurs 1,0, den dieses Dokument an anderer Stelle als gefaehrlichsten Umrechnungsschritt des
   ganzen Plans fuehrt, und den es in Kap. 1, der P6-Kontrollrechnung und Entscheidung 8
   bereits korrigiert hat. Bewusst **keine** zusaetzliche Sicherheitsmarge obendrauf: die
   Aufrundung ist die Marge, und eine zweite, unbezifferte Marge waere genau die
   Sorte Zuschlag, die spaeter niemand mehr von einer Messung unterscheiden kann.
   **Was dieser Guard NICHT leistet, ausdruecklich:** er feuert nur in der **Konjunktion**.
   Vorbedingung 1 (Vollkostendeckung) ist damit **nicht eigenstaendig** ueberwacht — bei
   hoher Deckungsquote schweigt der Guard auch bei einem Tarif unter der Vollkostenschwelle
   (Test (q) pinnt das). Der Entwurf ist vertretbar, weil bei hoher Deckung die Buchung
   ueberwiegend aus der Messung stammt und der Tarif nur den Rest traegt; er ist aber keine
   Zusage. Folge, verbindlich: **solange der Assistant-Pfad im Code steht, verlangt jede
   Aenderung an `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` eine erneute Pruefung gegen den dann
   konfigurierten Tarif** — der Guard meldet sich in dieser Lage nicht von selbst. Sauberer
   und deshalb vorgezogen: den Pfad zuerst zurueckbauen (Entscheidung 5, Folgearbeit), dann
   entfaellt die Lage und die Schwelle darf auf 5 sinken. **Kein `exit(1)`** — dieselbe Praezedenz wie beim Kurs-Guard in P2
   (`warnUnpricedModels`, `boot.js:70-81`): ein Boot-Refusal tauschte hier ein Kostenproblem
   gegen einen Totalausfall der Telefonie.
   **Woher die Quote beim Boot kommt (verbindlich, kein Freiheitsgrad):** aus dem bereits
   geladenen In-Memory-Spiegel. `store.load()` laeuft in `boot.js:178` nachweislich **vor**
   `assertBootGates(config, store)` (`boot.js:187`), und `assertBootGates` bekommt `store`
   ohnehin uebergeben — der Guard holt die Quote also **live** aus dem Spiegel, und zwar
   ueber die in **P3** eingefuehrte Funktion `costTruingCoveragePercent(store)` (Zaehler:
   `costTruedSource === 'telnyx_detail_records'` **und** vollstaendige Typ-Menge; Nenner: alle
   beendeten Outbound-Calls), nach dem Muster von `spendCapCoherence`. **Er rechnet sie nicht
   selbst** — dieselbe Funktion traegt schon den P4-Guard und die Sweep-Ausgabe; drei
   Rechnungen derselben Groesse waeren drei Zahlen, die auseinanderlaufen.
   **Kein neues persistiertes Feld**, keine eigene SQL-Query, keine
   Abhaengigkeit davon, dass P3s Sweep in diesem Prozess schon lief. Ist der Nenner 0,
   schweigt der Guard nicht: 0 beendete Calls heisst 0 % Deckung, und das ist der Fall, vor
   dem gewarnt werden soll.

**Praefix-Sauberkeit (die zweite Falle).** `VOICE_TARIFF_DOMESTIC_CENTS` ist EIN Skalar fuer
**drei** Laender (`VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49","+33","+44"]`, `config.js:99`),
gemessen wurde ein Aggregat aus ueberwiegend DE-Verkehr (Kap. 2.1, dort als UNBELEGT
gekennzeichnet). Verbindlich:

- **Gesenkt wird nur fuer Praefixe, die die Mindeststichprobe `COST_CALIBRATION_MIN_SAMPLES`
  erreicht haben** und fuer die P5 einen Befund liefert, der **nicht** `insufficient_samples`
  lautet.
- Ist nur `+49` vermessen, sind es zwei zulaessige Wege: entweder `+33`/`+44` werden aus
  `VOICE_TARIFF_DOMESTIC_PREFIXES` herausgeloest und fallen bis zu ihrer eigenen Messung auf
  den konservativen `voiceTariffDefaultCents` zurueck, **oder P4b senkt gar nicht**. Was nicht
  geht: einen aus DE-Verkehr gewonnenen Satz stillschweigend auf FR und UK auszudehnen. Der
  erste FR-Kunde zu real 12 ct/min bekaeme sonst eine 6-ct-Reserve (das Gate laesst Calls
  durch, die die Decke sprengen) **und** eine 6-ct-Buchung fuer jeden nicht abgeglichenen Call.

#### Betroffene Dateien

`src/boot-guard.js` (der Deckungsquoten-Guard aus Kern Punkt 3), `src/config.js`
(`VOICE_TARIFF_FULL_COST_FLOOR_CENTS`, `COST_TRUING_MIN_COVERAGE_PERCENT`), `.env.example`,
`render.yaml` (beide neuen Env-Vars — die CLAUDE.md-Dreiheit gilt hier wie in P1/P2),
`test/boot-guard-*.test.js`. **Nicht** angefasst: `metering.js`, `outbound-gates.js` und
jeder andere Buchungs- oder Gate-Pfad. Falls Weg 2 der Praefix-Regel gewaehlt wird, kommt
`VOICE_TARIFF_DOMESTIC_PREFIXES` in `config.js` samt einem Test hinzu, der die
Tarif-Zuordnung je Praefix pinnt.

#### Akzeptanzkriterium

- **Kein Code-Diff am Buchungspfad.** Der Diff dieser Phase ist der Boot-Guard aus Kern
  Punkt 3 plus die Env-Aenderung samt `.env.example`/`render.yaml` — die frueher hier
  stehende Fassung "kein Code-Diff" war nach Einfuehrung des Guards falsch und ist
  zurueckgenommen.
- **Der Guard meldet, wenn beide Bedingungen zutreffen.** Tarif unter
  `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` **und** Deckungsquote unter
  `COST_TRUING_MIN_COVERAGE_PERCENT` -> genau eine WARN, der Boot laeuft weiter. Trifft nur
  eine der beiden zu oder keine -> keine Meldung. Keine Literale (10, 80) im Guard-Rumpf.
- **Die Abgleich-Deckungsquote des Fensters ist gemessen, benannt und liegt ueber
  `COST_TRUING_MIN_COVERAGE_PERCENT`** — die Zahl steht im Phasen-Report. Ohne sie wird nicht
  gesenkt.
- **Fuer jeden Praefix, dessen Tarif gesenkt wird, liefert P5 einen echten Befund** — nicht
  `insufficient_samples`. Ein schweigender Guard ist ab hier ausdruecklich **kein** Beleg:
  P5 unterscheidet die beiden Faelle seit dieser Fassung (s. P5, Befund-Codes), und nur
  "gemessen und im Band" zaehlt.
- Der P5-Guard meldet danach fuer die gesenkten Praefixe **keine** Ueberschaetzungs-WARN mehr
  (die Senkung hat gegriffen) und **keine** Unterschaetzungs-WARN (sie ging nicht zu weit).
- Ein Rueckgang von `usage.costCents` ist danach fuer **abgeglichene** Calls nicht zu
  beobachten (deren Wert kam schon aus P4); fuer **nicht abgeglichene** Calls sinkt er sehr
  wohl — das ist die in Punkt 1 bepreiste Wirkung und kein Fehler, solange der Tarif die
  teuerste aktivierbare Konfiguration deckt.

#### Rot-vor-Fix-Test

**(p)** Store-Spiegel mit 10 beendeten Outbound-Calls, davon 2 mit
`costTruedSource='telnyx_detail_records'` und vollstaendiger Typ-Menge (= 20 % Deckung),
`voiceTariffDomesticCents` auf 6 (unter der Vollkostenschwelle 10): Boot erzeugt **genau
eine** WARN, die beide Zahlen nennt, und der Prozess laeuft weiter (**kein** `exit(1)`).
Vor dem Guard ist der Boot still — das ist das Rot.
**(q)** Derselbe Spiegel mit 9 abgeglichenen von 10 Calls (= 90 %): **keine** Meldung.
Und: Tarif auf 20 (ueber der Schwelle) bei 20 % Deckung: ebenfalls **keine** Meldung —
der Guard feuert nur bei der Konjunktion, nicht bei jeder einzelnen Bedingung.
Der erste Teil dieses Tests pinnt zugleich die **bewusst offene Flanke** aus Kern Punkt 3:
Tarif 6 bei 90 % Deckung bleibt unbemerkt, Vorbedingung 1 ist also nicht eigenstaendig
ueberwacht. Der Test dokumentiert diese Grenze, statt sie zu verdecken.
**(r)** Nenner 0 (kein beendeter Outbound-Call im Spiegel) bei gesenktem Tarif: WARN.
Ein leerer Spiegel darf nicht als "Deckung in Ordnung" durchgehen — das ist derselbe
Fehler wie "Schweigen als Beweis" (s. P5, Befund-Codes).

Was **nicht** getestet wird, und das ist eine Entscheidung, kein Vergessen: der ENV-Wert
selbst. Ein Test, der einen ENV-Wert gegen sich selbst pinnt, prueft die Konfiguration des
Testlaufs und nicht das Verhalten des Dienstes.

Die Betriebs-Verifikation der Senkung liegt zusaetzlich im Betrieb und ist im Akzeptanzkriterium oben
festgeschrieben: **P5 ist der Testlauf dieser Phase** — aber nur, wenn er redet. Ein
schweigender Guard hat zwei Ursachen, und sie sind gegensaetzlich: "im Band" oder "unter der
Mindeststichprobe, also per Definition stumm". Die erste Fassung dieses Kapitels wertete
beide gleich und haette Schweigen als Beweis genommen. Seit P5 drei Befund-Codes fuehrt
(`underestimate` / `overestimate` / `insufficient_samples`), ist die Unterscheidung
sichtbar, und das Akzeptanzkriterium verlangt oben ausdruecklich einen **echten** Befund je
gesenktem Praefix. Deshalb ist P5 auch fuer P4b und nicht nur fuer P4 eine harte
Vorbedingung.

#### Schutzniveau

**Formal schwaecher — zweite benannte Ausnahme (s. Kapitel 7).** Die frueher hier stehende
Zusage "unveraendert, die Reserve wird kleiner, die Buchung nicht" war am Code falsch (s.
Kern): der Tarif bleibt nach P4 der Buchungswert **jedes nicht abgeglichenen Calls**. Die
Senkung wirkt damit auf zwei Groessen, nicht auf eine — auf die Reserve immer, auf die
Buchung genau dann, wenn die Messung ausgefallen ist. Vertretbar ist sie nur unter den zwei
Vorbedingungen aus dem Kern (Deckung der teuersten aktivierbaren Konfiguration; gemessene
Abgleich-Deckungsquote ueber der Untergrenze) plus der Praefix-Regel. Ohne sie ist P4b die
Ruecknahme eines Polsters mit einer Begruendung, die nicht traegt.

**Und ein Zwischenstand, der ohne Merge und ohne Test entsteht:** bricht die Kette **nach**
P4b ab (Deploy vergessen, Session tot), steht der gesenkte Tarif in der Env, waehrend der
Abgleich-Job auf einem schlafenden Free-Tier-Dyno stillsteht — die Deckungsquote faellt gegen
0 und die Untergrenze aus Punkt 2 wird nachtraeglich verletzt, ohne dass es jemand bemerkt.
Deshalb wird P4b **nicht als reine Render-ENV-Aktion gefahren**, sondern als Aenderung von
`.env.example` + `render.yaml` **mit** dem Boot-Guard (WARN) aus **Kern Punkt 3**, der den
konfigurierten Tarif gegen die live aus dem Store-Spiegel gerechnete Deckungsquote haelt.
Spezifiziert ist er dort vollstaendig — Schwelle
(`VOICE_TARIFF_FULL_COST_FLOOR_CENTS`), Datenquelle, Stufe (WARN, kein `exit(1)`) —, seine
Dateien stehen in "Betroffene Dateien", sein Verhalten im Akzeptanzkriterium und in den
Rot-vor-Fix-Faellen (p)/(q)/(r). Das ist Absicht: eine Sicherung, die nur in einem
Prosa-Absatz steht und in keiner Datei-Liste, ist ab Merge strukturell tot — dieselbe
Fehlerklasse, die dieser Plan in P3 Punkt 3 und in der P2-Kurs-Guard-Begruendung zur Regel
erhebt.

#### Risiko

Zu frueh ausgefuehrt (vor P4) ist sie der Vorfall mit umgekehrtem Vorzeichen: die Bremse
geloest auf Basis einer Zahl, die noch nicht gemessen ist. Die Abhaengigkeit ist deshalb hart.

---

### P5 — Drift-Waechter statt Selbstjustierung (**bewusste Abweichung vom Auftrag**)

**Behebt:** D2 (Sichtbarkeit dauerhaft). **Aufwand:** M. **Abhaengig:** **P3** — nicht P4.

> **Korrigierte Reihenfolge:** P5 liest ausschliesslich abgeglichene Calls (`costTruedAt`
> gesetzt), und das ist ein **P3**-Artefakt, keine P4-Ausgabe. P5 ist damit direkt nach P3
> lauffaehig und **gehoert vor P4 gezogen**: P4 benennt in seinem eigenen Risiko-Abschnitt den
> Provider-Bug mit vollstaendig aussehenden, zu niedrigen Records und verweist als
> Gegenmassnahme auf "P5 macht daraus einen Alarm". Laeuft P5 erst nach P4, existiert ein
> Zeitfenster, in dem genau dieses Risiko nur durch eine WARN-Log-Zeile abgesichert ist statt
> durch die SMS-Alarmierung — vermeidbar durch blosses Umsortieren.

#### Die Abweichung, offen benannt

Der Auftrag schlaegt als Stufe 2 vor: *"Reserve-Tarif rollend nachkalibrieren. Pro
Ziel-Praefix ein p95 der letzten N echten Anrufe, gedeckelt durch einen harten
Konfig-Hoechstwert."* **Dieser Plan setzt das nicht um** und schlaegt stattdessen einen
messenden, aber nicht justierenden Waechter vor. Begruendung — zuerst das Argument, das
**nicht** traegt und hier ausdruecklich zurueckgenommen wird, dann die beiden tragenden:

1. **Zurueckgenommen: "Nach P4 ist der Tarif keine Geldgroesse mehr."** Diese Fassung stand
   hier bis zur vierten Review-Runde und ist am Code falsch — dieselbe widerlegte Behauptung
   wie in P4b (s. dort, Kern). `reconcileOutboundVoiceBudget` (`metering.js:50-55`) bucht
   auch nach P4 unveraendert `minuten * tariffCentsPerMin(call.to)` fuer **jeden nicht
   abgeglichenen Call**; P4 fasst `metering.js` nicht an. Der Tarif ist also weiterhin eine
   Geldgroesse, und **ein zu niedriger** Tarif kostet Geld: der geteilte Lebenszeit-Topf
   `MAX_BUDGET_EUR` laeuft zu langsam. Das trifft die Ablehnung von Stufe 2 nicht
   entlastend, sondern **belastend**: eine rollende Kalibrierung zieht den Wert an den
   gemessenen Mittelwert heran, waehrend der Buchungswert das teuerste **nicht** gemessene
   Szenario decken muesste — sie bewegt ihn also genau in die gefaehrliche Richtung. Die
   Ablehnung stuetzt sich deshalb allein auf 2 und 3; die tragen ohne diese Praemisse.
2. **Der Nutzen ist klein, die Angriffsflaeche gross.** Was Stufe 2 gewinnt, ist eine
   praezisere Sperre — Komfort. Was sie einbringt, ist ein selbstjustierender Wert auf dem
   Geld-Pfad, gespeist aus Anrufen, die das Gate durchgelassen hat (die Rueckkopplung aus
   dem Pre-Mortem, PM-2). Ein dummer, falscher, aber vorhersagbarer Wert ist gegenueber
   einem klugen, beweglichen Wert im Zweifel vorzuziehen, wenn Absolute Regel 1 daran haengt.
3. **Ein Mensch alle drei Monate reicht fuer eine Groesse, die sich in Jahren bewegt.**
   Carrier-Tarife sind langsam. Der Vorfall entstand nicht daraus, dass niemand automatisch
   nachjustiert hat, sondern daraus, dass **niemand je hingeschaut hat**. Die Gegenmassnahme
   fuer "niemand schaut hin" ist ein Alarm, nicht ein Regelkreis.

**Owner-Entscheidung 3 (2026-07-20) bestaetigt diese Abweichung: keine rollende
Selbstkalibrierung.** Nur der messende Waechter; das Nachziehen des Tarifs bleibt
Owner-Handarbeit auf Basis der Waechter-Zahlen. Damit ist diese Phase in ihrer hier
beschriebenen Form endgueltig und nicht mehr ein Vorschlag gegen den Auftrag.

**Sollte die Entscheidung je zurueckgenommen werden**, ist der Aufsatzpunkt sauber
vorbereitet: P3 sammelt bereits die Datenbasis pro Call, P5 rechnet bereits das p95 pro
Praefix. Es fehlt dann nur die Verdrahtung in `tariffCentsPerMin` — als eigene Phase und
nur mit dem Band aus PM-2 (`[0,5x .. 1,0x]` des Konfig-Werts). Ohne Band: keine Umsetzung.

#### Ziel

Ein Auseinanderlaufen von konfiguriertem Reserve-Tarif und gemessener Wirklichkeit wird
sichtbar und alarmiert, ohne dass sich der Tarif selbst bewegt.

#### Kern

- Leseprojektion `measuredCentsPerMinByPrefix(calls, prefix)`: **p95** (nicht Mittelwert —
  der unterschaetzt genau den ersten teuren Anruf einer neuen Destination, PM-5) ueber die
  letzten N abgeglichenen Calls je Praefix aus `voiceTariffDomesticPrefixes`
  (`config.js:99`), Mindeststichprobe `COST_CALIBRATION_MIN_SAMPLES` (Default **20**).
  Reine Funktion, kein Zeitzugriff (`nowIso` vom Aufrufer, Muster `voiceMinutesUsedSince`).
- **Drei Befund-Codes je Praefix, nicht zwei.** `underestimate` (der konfigurierte Tarif
  liegt unter dem gemessenen p95 — die gefaehrliche Richtung: die Reserve deckt den Anruf
  nicht), `overestimate` (er uebersteigt ihn um mehr als `COST_DRIFT_WARN_PERCENT` — die
  Vorfalls-Richtung) und **`insufficient_samples`** (weniger als `COST_CALIBRATION_MIN_SAMPLES`
  abgeglichene Calls). Der dritte Code ist neu und tragend: **"kein Alarm" und "zu wenig
  Daten" duerfen nicht dieselbe Beobachtung sein.** Er loest **keine** Alarmierung aus
  (sonst wird der Kanal taub trainiert), erscheint aber sichtbar im Boot-Log und im
  Dashboard, mit der Zahl der vorliegenden Stichproben. P4b haengt sein Abnahmekriterium
  genau daran (s. dort): Schweigen ist nur dann ein Beleg, wenn es aus Daten kommt.
- **Zwei Ausloeser, nicht einer.**
  1. **Boot-Guard** (`src/boot-guard.js`, Muster `spendCapCoherence`) beim Start.
  2. **Laufzeit-Auswertung am Ende jedes Kosten-Abgleich-Sweeps** (der `setInterval` aus P3,
     Default 6 h) — hier wird der SMS-Alarm ausgeloest.

  **Der Boot-Guard allein genuegt nicht, und das ist der Grund fuer den zweiten Ausloeser.**
  Er feuert genau einmal je Prozessstart. Ein Dienst, der nach dem P4-Deploy wochenlang ohne
  Restart laeuft, wertet in genau dem Zeitraum nicht aus, in dem P4 sich auf P5 als
  Gegenmassnahme stuetzt (P4-Risiko: Provider-Bug mit vollstaendig aussehenden, zu niedrigen
  Records) — der PM-8-Fall liegt bei 25 % Drift und bleibt auch unter der P3-WARN-Schwelle von
  50 %. Ein Alarm, der nur beim Booten scharf ist, ist auf einem lange laufenden Prozess kein
  laufender Alarm. Kapitel 7 darf erst mit diesem Ausloeser sagen, der Alarm sei "vorher scharf".
- **Entprellung, verbindlich:** hoechstens **eine** Alarmmeldung je Praefix und Befund-Code
  innerhalb eines benannten Fensters (`COST_ALERT_DEBOUNCE_MS`, Default 24 h, modul-lokal
  gehalten). Ohne sie meldete der 6-h-Sweep denselben Befund viermal am Tag und erzeugte
  genau die WARN-Muedigkeit, die der Risiko-Abschnitt dieser Phase vermeiden will.
- **Alarm** ueber denselben Kanal wie die Plattform-Warnung (`PLATFORM_ALERT_SMS_TO`) —
  derselbe Kanal, der laut PLAN-BUDGET-AXES P6-Report im Dashboard **leer** ist und keinen
  Boot-Guard hat. Dieser Plan macht die Besetzung des Kanals zur **Vorbedingung von P5**,
  nicht zu einer Fussnote: ein Alarm ohne Empfaenger ist kein Alarm.
- **Und diese Vorbedingung bekommt ihren eigenen Boot-Guard (WARN, nicht fatal):** ist
  `PLATFORM_ALERT_SMS_TO` leer, meldet der Boot das beim Start. Eine Vorbedingung, die nur
  in einem Planungsdokument steht, haengt an der Disziplin dessen, der die Phase umsetzt —
  und P5 steht in der korrigierten Reihenfolge **vor** P4 gerade deshalb, weil es dessen
  Provider-Bug-Risiko abfangen soll. Ein stumm gebliebener Alarmkanal wuerde genau diese
  Absicherung lautlos entwerten. WARN und nicht fatal, weil ein fehlender Alarmkanal den
  Dienst nicht unsicherer macht als heute — er macht ihn nur blind, und Blindheit ist das
  Thema dieses Plans.
- Anzeige des gemessenen Werts neben dem konfigurierten im Owner-Dashboard.

#### Betroffene Dateien

`src/billing/cost-calibration.js` (neu, reine Funktionen), `src/boot-guard.js`,
`src/billing/cost-truing.js` (**neu in dieser Liste**: der Laufzeit-Ausloeser haengt sich
ans Ende des P3-Sweeps, s. Kern — die Auswertung selbst bleibt in `cost-calibration.js`,
der Sweep ruft sie nur), `src/routes/api-read.js`, `public/index.html`, `src/config.js`,
`.env.example`, `render.yaml` (`COST_CALIBRATION_MIN_SAMPLES` — Pruefung wie in P1, auch bei
Ergebnis "Default reicht"), `test/cost-calibration.test.js` (neu),
`test/boot-guard-*.test.js`.

#### Akzeptanzkriterium

- Der Boot-Guard warnt bei einer 4-fachen Abweichung und schweigt bei einer 10-prozentigen.
- Unter `COST_CALIBRATION_MIN_SAMPLES` Datenpunkten: **keine Tarif-Aussage und kein Alarm**,
  aber der Befund-Code `insufficient_samples` samt Stichprobenzahl ist im Boot-Log und im
  Dashboard **sichtbar**. "Zu wenig Daten" darf keinen Kanal taub trainieren, aber es darf
  auch nicht wie Zustimmung aussehen.
- **Die Auswertung laeuft ohne Restart:** ein Sweep-Durchlauf loest dieselbe Bewertung samt
  Alarm aus wie der Boot-Guard. Ein Test pinnt das an einem Prozess, der nie neu bootet.
- **Entprellung:** zwei Sweeps innerhalb von `COST_ALERT_DEBOUNCE_MS` mit demselben Befund
  fuer denselben Praefix erzeugen **eine** Meldung, nicht zwei.
- `tariffCentsPerMin` bleibt byte-identisch — das ist die Phase, die den Tarif ausdruecklich
  NICHT anfasst, und ein Test pinnt das.
- Kein Praefix-loses Ziel wird einem Praefix zugeschlagen.

#### Rot-vor-Fix-Test

Neu `test/cost-calibration.test.js`, heute rot:
(a) 20 Calls mit 5 ct/min, konfiguriert 20 -> WARN "Ueberschaetzung", Faktor 4.
(b) 20 Calls mit 25 ct/min, konfiguriert 20 -> WARN "Unterschaetzung" (andere, schaerfere
Meldung).
(c) 19 Calls -> **kein Alarm**, aber Befund `insufficient_samples` mit `samples: 19` in der
Rueckgabe. Faellt rot aus, sobald "zu wenig Daten" und "im Band" dasselbe leere Ergebnis
liefern — die Unterscheidung, an der P4bs Abnahmekriterium haengt.
(c2) **Praefix-Trennung:** 25 `+49`-Calls im Band, 0 `+33`-Calls -> `+49` meldet nichts,
`+33` meldet `insufficient_samples`. Ein Praefix ohne Daten wird nie von einem anderen
mitgedeckt.
(d) Ausreisser-Robustheit: 19 Calls a 5 ct + 1 Call a 300 ct -> p95 bleibt nahe 5 (pinnt,
dass p95 gewaehlt wurde und nicht `max`).
(e) `tariffCentsPerMin("+4915...")` liefert vor und nach der Phase denselben Wert.
(f) `PLATFORM_ALERT_SMS_TO` leer -> genau eine WARN beim Boot, kein Abbruch; besetzt ->
keine Meldung.
(g) **Laufzeit-Ausloeser ohne Boot:** ein Sweep-Durchlauf bei 4-facher Abweichung -> genau
eine Alarmmeldung, ohne dass `assertBootGates` je gelaufen ist. Faellt rot aus, solange der
Boot-Guard der einzige Ausloeser ist — der Fall, den P4 ueber die gesamte Laufzeit eines
Prozesses ungeschuetzt liesse. **Seit Entscheidung 1 (Flip sofort) wiegt dieser Ausloeser
schwerer**: die vier Wochen Beobachtung, die frueher als zusaetzliche Absicherung galten,
gibt es nicht mehr — der laufende Alarm ist ab jetzt die einzige zeitliche Sicherung.
(h) **Entprellung:** zweiter Sweep mit demselben Befund innerhalb von
`COST_ALERT_DEBOUNCE_MS` -> keine zweite Meldung; nach Ablauf des Fensters -> wieder eine.

#### Schutzniveau

**Unveraendert plus Sichtbarkeit.** Kein Gate-Verhalten aendert sich.

#### Risiko

Ein Alarm, den niemand liest, ist wertlos — deshalb die harte Vorbedingung beim
Alarmkanal. Zweitens: WARN-Muedigkeit. Die Schwellen sind so gewaehlt, dass der heutige
Zustand **genau eine** Meldung erzeugt, nicht eine pro Praefix pro Boot.

---

### P6 — Tenant-Decken aus dem Abo ableiten

**Behebt:** D8. **Aufwand:** M.
**Abhaengig:** **keine Code-Abhaengigkeit — P6 ist parallel zu P1 startbar.** Die vorherige
Fassung nannte hier P3; das war am eigenen Kern widerlegt und ist korrigiert: P6 beruehrt
weder `cost-truing.js` noch die P1/P2/P3-Felder (`estimatedCostCents`,
`actualCostMicroCents`, `costTruedAt`), und der Deckel-Basissatz stammt aus der **bereits
abgeschlossenen** Messung in Kapitel 2, nicht aus einem P3-Artefakt. Eine behauptete
Abhaengigkeit, die die eigene Datei-Liste nicht stuetzt, ist keine Vorsicht, sondern eine
Verzoegerung: D8 ist ein S1 auf dem Live-Zahlungspfad und braucht nicht auf den Flip-Strang
zu warten. P5s Live-Kalibrierung geht ausdruecklich NICHT in die Decke ein (s. Kern).
**Aber:** P6 hat eine **Owner-Vorbedingung** — die Entscheidung zu `MAX_BUDGET_EUR`, s.
Kern und Entscheidung 8 (Kapitel 8).

#### Ziel

Die Decke eines Tenants ergibt sich aus seinem Plan, nicht aus einem Registrierungs-Default.

#### Kern

Heute: `seedTenantDefaultBudget` (`state-ops.js:747-759`) schreibt bei der Registrierung
`budgetCents = hardCapCents = 600` — **vor** jeder Plan-Wahl —, und
`createTenantSubscription` (`billing/subscribe.js:92-112`) fasst die Budget-Zeile nie an.
Ergebnis: ein Business-Tenant mit 120 Inklusivminuten wird vom EUR-Gate bei ~30 Minuten
gestoppt (600 ct / 20 ct), also bei einem Viertel des beworbenen Kontingents. Beide Gates
laufen als Schnittmenge, die engere gewinnt — das Produktversprechen ist heute nicht
einloesbar.

Neu: reine Funktion `planCapCents(planSlug, cfg)` in **`src/billing/plan-caps.js`** (neu):

```
planCapCents(slug) = findPlan(slug).includedMinutes * voiceCapRateCentsPerMin * planCapHeadroom(slug)
```

(`plans.js` exportiert kein `includedMinutes(slug)`; der Zugriff laeuft ueber
`findPlan(slug).includedMinutes` — Notation hier bewusst genau, damit sie niemand als
existierende Funktion sucht.)

**Nicht in `src/plans.js`** — und das ist keine Geschmacksfrage. `plans.js` traegt einen
expliziten Modulvertrag ("Reines Daten-Modul: KEINE Imports, kein config, kein IO -> kein
Lazy-Init (P15), keine Kopplung") und eine **SPIEGEL-PFLICHT**: `apps/web/src/lib/plans.js`
ist eine 1:1-physische Kopie, deren Divergenz `test/plans-catalog.test.js` rot faerbt. Eine
config-abhaengige Funktion dort haette zwei Ausgaenge, beide schlecht: gespiegelt landet die
Ableitung der internen Budget-Decken samt `voiceCapRateCentsPerMin` im **oeffentlich
ausgelieferten** Marketing-Bundle (Innenkalkulation nach aussen, in Nachbarschaft zum
oeffentlichen `GET /api/plans`); nicht gespiegelt divergieren die Dateien und der Spiegel-Test
muss aufgeweicht werden, womit die Deploy-Isolationsgarantie beschaedigt ist. `plan-caps.js`
**liest** `includedMinutes(slug)` aus `plans.js` — die SSoT bleibt dort, der Vertrag bleibt
unangetastet, der Spiegel bleibt byte-identisch. `apps/web/src/lib/plans.js` faellt damit aus
den betroffenen Dateien heraus.

**Die Ableitung sitzt an der Schreibkante, nicht bei den Aufrufern.** Der naheliegende Entwurf
— `planCapCents` in `billing/subscribe.js` an den zwei offensichtlichen Stellen aufrufen —
ist am Code widerlegt: `setTenantSubscription` hat ausserhalb des Store **sechs** Aufrufer:
`subscribe.js:111` (`createTenantSubscription`), `subscribe.js:175` und `subscribe.js:193`
(Aktivierung aus abgeschlossener Stripe-Checkout-Session — **der Live-Geldpfad**),
`billing/webhook.js:213` (Stripe-Webhook-Patch, u.a. Plan-Wechsel), `billing/activation.js:55`,
`billing/backfill-profiles.js:51`. Wuerde nur der erste verdrahtet, blieben zwei konkrete
Loecher: (1) ein Kunde, der Business ueber den Checkout-Return-Pfad abschliesst, behaelt die
600-ct-Registrierungsdecke und wird bei ~30 statt 120 Minuten gestoppt — D8 waere ungefixt auf
genau dem Pfad, den die zahlenden Kunden nehmen; (2) ein Downgrade ueber den Webhook liesse die
Decke bei der Business-Hoehe stehen, obwohl der Kunde Starter zahlt — die Richtung, in der der
Schutz schwaecher wird.

Deshalb: **`store.setTenantSubscription` leitet die Decke aus dem `planSlug` ab.**
Eine Schreibkante, die alle sechs Pfade zwingend durchlaufen. `seedTenantDefaultBudget` bleibt
fuer den Zustand "registriert, kein Abo" und behaelt seinen konservativen Default.

**Der Patch ist selektiv, und daran haengt eine Fallgrube, die die Formulierung "aus dem
gesetzten planSlug" allein nicht abfaengt.** `setTenantSubscription` setzt **nur uebergebene
Keys** (`state-ops.js:934-951`, "selektiver Patch via `!== undefined`"), und **drei der sechs
Aufrufer liefern gar keinen Slug**: `activation.js:55` uebergibt ausschliesslich
`{numberSetupFeeExempt}`, `webhook.js:213` baut den Patch konditional zusammen
(`if (planSlug != null) patch.planSlug = ...`, `webhook.js:208`), `backfill-profiles.js:51`
uebergibt nur `{planSlug}`. Zusammen mit der Gegenmassnahme unten ("`planCapCents` wirft bei
unbekanntem Slug") ergaebe die woertliche Lesart einen **Wurf auf jedem Patch ohne Slug**.
Konkret: Stripe sendet ein ACTIVATE-Event, aus dem kein Slug aufloest (Perioden-
Verlaengerung ohne Price-Angabe), `webhook.js:213` patcht ohne `planSlug`, der Wurf reisst
`applyStripeWebhook` ab — Perioden-Anker, Karten-Bindung und Provisioning laufen nicht mehr.
Das ist der dokumentierte Abo-ohne-Nummer-Vorfall, neu eingebaut. Verbindlich deshalb:

1. **Abgeleitet wird aus dem EFFEKTIVEN Slug nach dem Patch**, nicht aus dem Patch-Feld:
   `patch.planSlug ?? tenant.stripePlanSlug`. Ein Patch, der den Slug nicht anfasst, aendert
   die Decke des bestehenden Plans nicht ungewollt — er laesst sie, wo sie war.
2. **Fehlender/leerer effektiver Slug ist ein dokumentiertes No-op**, kein Wurf: die
   Budget-Zeile bleibt unberuehrt (der Tenant behaelt den Registrierungs-Default). Der Wurf
   bleibt **ausschliesslich** dem Fall "Slug gesetzt, aber unbekannt" vorbehalten — das ist
   der Fall, den die Gegenmassnahme meint (ein neuer Plan ohne Anschluss), und nur dort ist
   fail-closed richtig.
3. **Geschrieben werden BEIDE Pflichtfelder der `tenant_budget`-Zeile, nicht nur die
   Decke.** Der Rest dieser Phase spricht durchgaengig von "der Decke" und pinnt
   `hardCapCents`; die Zeile hat aber zwei NOT-NULL-Spalten, und `setTenantBudget`
   (`state-ops.js:1785-1795`) patcht **nicht** selektiv — es schreibt bedingungslos
   `existing.budgetCents = budgetCents` und `existing.hardCapCents = hardCapCents`. Ein
   Aufruf nur mit `hardCapCents` setzt `budgetCents` auf `undefined`, und
   `tenant_budget.budget_cents` ist `BIGINT NOT NULL` (`schema.sql:377`), von
   `flushTenantBudgets` (`pg.js:1396-1407`) direkt als `$2` uebergeben. Der Schaden ist
   nicht lokal: `flush()` (`pg.js:948-964`) faengt jeden Fehler mit einem **ROLLBACK der
   GESAMTEN Transaktion** — aller Tenants, aller Calls, aller usage-Buckets, aller
   Provisioning-Jobs. Ab da schlaegt jeder weitere Flush an derselben Zeile fehl: gebuchte
   `costCents` landen nie mehr in der DB, der Verbrauchszaehler faellt beim naechsten
   Restart auf den letzten persistierten Stand zurueck, und das Budget-Gate rechnet dauerhaft
   mit zu wenig Verbrauch. Auf dem json-Backend faellt das nicht auf — es faellt in Prod auf,
   auf dem Live-Zahlungspfad. **Verbindlich: `budgetCents` wird auf denselben Wert gesetzt wie
   `hardCapCents`**, genau wie `seedTenantDefaultBudget` (`state-ops.js:758`) es fuer den
   Registrierungs-Default tut. Ein Umbau von `setTenantBudget` auf einen selektiven
   `!== undefined`-Patch (Muster `setTenantSubscription`) waere die sauberere Loesung, aendert
   aber das Verhalten der bestehenden Aufrufer und gehoert deshalb in einen **eigenen,
   getesteten Schritt** — nicht nebenbei in diese Phase.
4. **`backfill-profiles.js` bekommt den Nebeneffekt ausdruecklich zugesprochen oder
   entzogen** — heute ist es ein reines Profil-Werkzeug, nach P6 schriebe derselbe Lauf
   jede Tenant-Decke neu und ueberschriebe manuell gesetzte Zeilen. Entscheidung: **ja, es
   schreibt mit**, weil es slug-lose Bestands-Abos genau deshalb heilt und eine Decke, die
   nach dem Heilen nicht zum Plan passt, die zweite unsichtbare Wahrheit waere, die Entscheidung 2
   vermeiden will. Das gehoert in den Kommentar der Schreibkante, damit der naechste Leser
   den Nebeneffekt nicht fuer ein Versehen haelt.

**Kontrollrechnung gegen die Owner-Entscheidung** (Starter 3 EUR / Business 9 EUR aus
PLAN-BUDGET-AXES Frage 1), auf der gemessenen Basis von 5,4 ct/min. **Das ist eine
PLAUSIBILITAETS-Pruefung, keine Formel-Eingabe** — die Spalte ganz rechts bezieht sich auf
die gemessenen 5,4 ct/min, waehrend die Formel unten mit dem konfigurierten Ganzzahl-Satz 6
rechnet. Die beiden Zahlen duerfen nicht vermischt werden (s. Entscheidung 2, dort mit der
Fehlerrechnung):

**Waehrungsbasis, weil die beiden Spalten sie nicht teilen:** die 5,4 ct/min sind **USD**-Cent
(Kap. 2.1), die Owner-Decken sind EUR-Cent. Die Kontrollrechnung haelt sie deshalb **nicht**
unkorrigiert nebeneinander, sondern rechnet mit dem planeigenen Kurs 0,92 um: 5,4 USD-ct
entsprechen **4,968 EUR-ct/min**. Die frueher hier stehenden 162/648 ct waren USD-Werte in
einer EUR-Spalte — die Abweichung ging zwar konservativ (die realen EUR-Kosten liegen
niedriger, die Deckung ist besser als dargestellt), aber es war genau der unmarkierte
Kurs-1,0, den Kapitel 4 als den gefaehrlichsten Umrechnungsschritt dieses Plans fuehrt.

| Plan | inkl. Min. | Vollkosten EUR (4,968 ct/min) | *nachrichtlich: USD (5,4)* | Owner-Decke | Deckung (Decke / Vollkosten, **kein `planCapHeadroom`**) |
| --- | --- | --- | --- | --- | --- |
| Starter | 30 | **149 ct** | *162 ct* | 300 ct | **2,01** |
| Business | 120 | **596 ct** | *648 ct* | 900 ct | **1,51** |

Die Owner-Entscheidung ist mit der Messung **kohaerent** — beide Decken liegen ueber den
Vollkosten des Kontingents, nach der Umrechnung sogar komfortabler als bisher dargestellt
(2,01 statt 1,85; 1,51 statt 1,39). Der Plan uebernimmt daraus **nicht** die Zahlen 2,01/1,51:
sie gehoeren zur falschen Bezugsbasis (Messgroesse statt konfiguriertem Satz) und sind reine
Plausibilitaet.

**Die Formel rechnet mit dem konfigurierten Satz, nicht mit der Messgroesse.**
`voiceCapRateCentsPerMin` ist eine **Konfiguration**, Default **6** — die auf die naechste
GANZZAHL aufgerundeten 5,4 ct/min. Ganzzahl, weil G26 fuer Geld-Konstanten keine Floats
zulaesst; aufgerundet, weil eine Decke nach oben irren soll.

**Owner-Entscheidung 2 (2026-07-20): 300 / 900 Cent.** Die runden Zahlen gewinnen, die
Kopffreiheit wird dafuer krumm. Daraus, mit derselben Formel:

| Plan | inkl. Min. | x `voiceCapRateCentsPerMin` (6) | x `planCapHeadroom` | **Decke** |
| --- | --- | --- | --- | --- |
| Starter | 30 | 180 ct | **5/3** (dezimal 1,6667) | **300 ct** |
| Business | 120 | 720 ct | **5/4** (dezimal 1,25) | **900 ct** |

**Gegenprobe, sie geht exakt auf:** 30 x 6 x 5/3 = 900/3 = **300**; 120 x 6 x 5/4 = 3600/4 =
**900**.

**`planCapHeadroom` wird als ganzzahliger Bruch gefuehrt (Zaehler/Nenner), nicht als
Dezimalzahl — und das ist keine Kosmetik.** 1,6667 ist eine **gerundete Darstellung** von
5/3; `30 * 6 * 1.6667` ergibt 300,006 und damit eine Geldgrenze, die von einer
Rundungsentscheidung im Aufrufer abhaengt. Genau diese Sorte stiller Praezisionsstufe
verbietet G26 auf dem Geld-Pfad, und P4 fuehrt dieselbe Regel fuer die Korrekturformel.
Verbindlich: `planCapCents` multipliziert zuerst und dividiert genau einmal am Ende
(`includedMinutes * voiceCapRateCentsPerMin * num / den`), alle Operanden ganzzahlig. Die
Dezimalschreibweisen 1,6667 / 1,25 stehen in diesem Dokument nur zur Lesbarkeit; verbindlich
sind 5/3 und 5/4.

Die frueher hier stehenden **360 / 1080 ct** (Kopffreiheit 2,0 / 1,5) sind damit
zurueckgenommen — sie waren die Formel-Variante (a) aus Kapitel 8. Die verbindlichen
Zielwerte dieser Phase sind **300 / 900 ct**.

**HARTE KOLLISION MIT DEM PLATTFORM-CAP — diese Phase ist erst umsetzbar, wenn
`MAX_BUDGET_EUR` angehoben ist.** `platformSpendCapCents` betraegt heute
**800 Cent** (`MAX_BUDGET_EUR=8`, `.env.example:6`; `globalCapCents`, `defaults.js`). Die
entschiedene Business-Decke von **900 ct** liegt darueber (die verworfene Formel-Variante mit
1080 ct erst recht). Owner-Entscheidung 8 (2026-07-20) loest das: **`MAX_BUDGET_EUR` wird
angehoben, BEVOR P6 ausgeliefert wird** — Groessenordnung Summe der aktiven Tenant-Decken
plus Reserve, umgesetzt in PLAN-BUDGET-AXES (konsistent mit Entscheidung 4). Diese Anhebung
ist damit **harte Vorbedingung dieser Phase**, ihr Bauort ist der andere Plan. Genau diese
Konstellation fuehrt der
bestehende Boot-Guard `spendCapCoherence` (`boot-guard.js:100-113`) als **FATAL**, mit der
woertlichen Begruendung, die Tenant-Budget-Achse sei dann "WIRKUNGSLOS (der globale
Plattform-Cap bindet immer zuerst)".

Der Guard **greift hier aber nicht**, und das ist das eigentliche Problem: er prueft
`cfg.defaultTenantBudgetCents` (600) — also den Config-Wert. Die von P6 geschriebenen
`tenant_budget`-Zeilen sieht er nie. Die naive Umsetzung verschoebe eine Groesse aus dem
bewachten Config-Raum in den unbewachten Zeilen-Raum und setzte sie dort auf einen Wert,
den dasselbe Repo als Boot-Verweigerungsgrund fuehrt. Die Aussage "Plattformdecke
unberuehrt, Schnittmenge bleibt" waere formal wahr und praktisch leer: die Schnittmenge aus
900 und 800 ist 800. Praktisch heisst das: Tenant A (Business) telefoniert bis der
Plattform-Topf leer ist — sein EUR-Gate bindet nie —, und Tenant B (zahlender Starter)
bekommt ab da keinen Outbound mehr, Grund `budget_platform`. Vor P6 haette A bei 600
gestoppt und B waeren 200 ct geblieben. Die per-Tenant-Achse, die zweite Haelfte der von
Regel 1 geforderten Schnittmenge, waere fuer jeden Business-Tenant vollstaendig inert.

Verbindlich, alle drei Punkte:

1. **Die Kohaerenz zwischen abgeleiteter Decke und Plattform-Cap wird am BOOT
   durchgesetzt, nicht an der Schreibkante.** Das ist eine Korrektur an der frueheren
   Fassung dieses Punktes, die hier einen **Wurf beim Setzen** vorschrieb ("kein stilles
   `Math.min`"). Am Code ist diese Fassung falsch, und zwar nicht in einem Sonderfall,
   sondern im Normalbetrieb: die Schreibkante ist `setTenantSubscription`, sie liegt auf
   dem Live-Geldpfad (`billing/subscribe.js:175` und `:193`, `billing/webhook.js:213`), und
   in `webhook.js` steht der Aufruf **vor** der Karten-Bindung und vor dem Provisioning
   (Kommentar dort: "Race-Fix (Abo-ohne-Nummer)"). Mit der heutigen Konfiguration ist die
   Wurf-Bedingung bereits erfuellt — `MAX_BUDGET_EUR=8` sind 800 ct, die entschiedene
   Business-Decke ist 900 ct —, also wuerde **jeder** Business-Abschluss werfen
   und `applyStripeWebhook` abreissen: der Kunde zahlt und bekommt weder Abo-State noch
   Karte noch Nummer. Das ist exakt der Vorfall, den Punkt 2 der Slug-Liste oben mit
   derselben Begruendung bereits verworfen hat; fuer den Cap-Fall war die Analyse nicht
   wiederholt worden. **Zwei Linien statt eines Wurfs:**
   - **Erste Linie (laut, vor dem ersten Kunden): `spendCapCoherence` prueft die
     ABGELEITETEN Decken ALLER Slugs** aus `plans.js` (`CATALOG_SLUGS`, `plans.js:53`)
     gegen `platformSpendCapCents` — **Stufe `fatal: true`**, wie der bestehende
     `TENANT_DEFAULT_INERT`-Befund (`boot-guard.js:101-112`) und mit derselben Abhilfe
     ("`MAX_BUDGET_EUR` anheben ODER Kopffreiheit senken"). Der Guard braucht dafuer keine
     Store-Zeile, nur den Plan-Katalog und die Config — er greift also auch beim allerersten
     Boot nach dem P6-Deploy, wenn noch kein Tenant eine abgeleitete Decke traegt. Eine
     inkohaerente Konfiguration kommt damit gar nicht erst in den Betrieb.
   - **Zweite Linie (leise, aber nicht still): an der Schreibkante ein Clamp auf
     `platformSpendCapCents` plus WARN**, kein Wurf. Der frueher hier stehende Einwand
     "stilles `Math.min`" traegt nach der ersten Linie nicht mehr: bei kohaerenter
     Konfiguration ist der Clamp **unerreichbar**, und er ist nicht still (WARN mit beiden
     Zahlen). Er deckt allein den Fall, dass `MAX_BUDGET_EUR` **nach** dem Boot im
     Render-Dashboard gesenkt wird — dort ist ein geklemmter Cap unbedingt besser als ein
     abgerissener Zahlungspfad, denn geklemmt kostet Kopffreiheit, geworfen kostet den
     Kunden. Der Clamp ist ausdruecklich **kein** Ersatz fuer die erste Linie: er darf eine
     inkohaerente Konfiguration nicht als in Ordnung durchgehen lassen, deshalb die WARN und
     deshalb der fatale Boot-Guard davor.
   **Der Wurf bleibt ausschliesslich dem Fall "Slug gesetzt, aber unbekannt" vorbehalten**
   (s. Punkt 2 der Slug-Liste oben und "Risiko"). Die Verwechslung dieser beiden Faelle ist
   genau der Fehler, den diese Fassung behebt.
2. **`spendCapCoherence` bekommt zusaetzlich eine Klausel ueber die tatsaechlich gesetzten
   `tenant_budget`-Zeilen**, nicht nur ueber den Config-Default. Die Invariante muss auch
   dort greifen, wo der Wert nach dieser Phase lebt. Diese Klausel ist die **Nachlese** fuer
   Zeilen, die vor einer Cap-Senkung geschrieben wurden — sie ersetzt die Slug-Pruefung aus
   Punkt 1 **nicht**, weil sie nach einem frischen Deploy nichts sieht (es existiert noch
   keine abgeleitete Zeile) und der erste zahlende Kunde sonst ungebremst durchliefe.
3. **`MAX_BUDGET_EUR` wird VOR P6 angehoben** (Entscheidung 8, getroffen am 2026-07-20;
   umgesetzt in PLAN-BUDGET-AXES — **die Datei liegt seit Commit `a0431fa` nicht mehr im
   Arbeitsbaum, Wiederherstellung und Begruendung im Kasten von Entscheidung 4**).
   **Ausfallmodus, falls die Anhebung trotzdem ausbleibt — er steht hier an der Vorbedingung
   selbst und nicht nur in Entscheidung 8:** der in Punkt 1 beschriebene `spendCapCoherence`
   ueber die abgeleiteten Decken **aller** Slugs ist **fatal** und laesst den Deploy laut am
   Boot scheitern, bevor der erste Kunde zahlt — nicht als Laufzeit-Wurf im Stripe-Webhook.
   Ein vergessener Env-Wert kostet einen fehlgeschlagenen Deploy, keinen bezahlten Kunden
   ohne Nummer. Die Rechnung ist
   eindeutig: 120 Inklusivminuten zu gemessenen 5,4 USD-ct/min sind zum Kurs 0,92
   **596 EUR-ct** fuer **einen** Business-Kunden — ein 800-ct-Plattformtopf (EUR) traegt
   diesen einen knapp und keinen zweiten Tenant daneben. Kapitel 10 schliesst die Anhebung von
   `MAX_BUDGET_EUR` als **Phase** dieses Plans aus (sie gehoert in die Budget-Achsen-Kette);
   das bleibt so. Ausgeschlossen ist damit, dass dieser Plan den Cap **anfasst** — nicht,
   dass P6 auf die Entscheidung **wartet**. Die Abhaengigkeit wird hier sichtbar gemacht,
   statt sie in einer Umsetzung auflaufen zu lassen.

`voiceCapRateCentsPerMin` ist ausdruecklich **nicht** der von P5 gemessene Wert. Begruendung:
eine Decke, die sich automatisch mit einer gemessenen Groesse bewegt, waere die
Selbstjustierung aus PM-1 — diesmal auf der Deckel-Seite, wo sie doppelt gefaehrlich ist.
Gemessen wird, um den Wert **zu pruefen**; gesetzt wird er vom Menschen. Genau deshalb haengt
P6 auch nicht an P5: gebraucht wird die Messung aus Kapitel 2, nicht P5s Live-Kalibrierung.

#### Betroffene Dateien

`src/billing/plan-caps.js` (neu), `src/store/state-ops.js` (`setTenantSubscription` als
Schreibkante), `src/boot-guard.js` (**neu in dieser Liste**: `spendCapCoherence` um **zwei** Klauseln
erweitern — die abgeleiteten Decken aller Slugs aus `plans.js` gegen `platformSpendCapCents`
(fatal, erste Linie) und die Nachlese ueber gesetzte `tenant_budget`-Zeilen, s. Kern
Punkt 1/2), `src/config.js`,
`.env.example`, `render.yaml`, `test/plan-cap-derivation.test.js` (neu),
`test/boot-guard-*.test.js`, `test/subscribe-*.test.js`, `test/billing-webhook-*.test.js`
(der Patch-ohne-Slug-Pfad), `test/store-pg-*.test.js` (**der Rundlauf ueber beide
Pflichtfelder der `tenant_budget`-Zeile — die NOT-NULL-Falle aus Kern-Punkt 3 existiert nur
im pg-Backend**).
**Nicht angefasst:** `setTenantBudget` selbst (`state-ops.js:1785-1795`) — die Ableitung ruft
es mit **beiden** Feldern, statt seine Patch-Semantik in dieser Phase zu aendern; s. Kern
Punkt 3.
**Nicht betroffen:** `src/plans.js` (nur gelesen) und `apps/web/src/lib/plans.js` — der
Spiegel bleibt unberuehrt und byte-identisch, s. Kern.

#### Akzeptanzkriterium

- Neuer Business-Abschluss -> `hardCapCents === 900`; Starter -> `300`
  (Owner-Entscheidung 2). **Der Test pinnt das Produkt der Formel, nicht nur den Faktor:**
  `includedMinutes x voiceCapRateCentsPerMin x planCapHeadroom` muss exakt 300 bzw. 900
  ergeben (30x6x5/3 und 120x6x5/4). Ein Test, der nur `planCapHeadroom` prueft, laesst genau
  die Rundungsluecke offen, wegen der die Kopffreiheit als Bruch gefuehrt wird.
- **Die `tenant_budget`-Zeile ist nach JEDEM der sechs Pfade vollstaendig: `budget_cents` ist
  nie `null`/`undefined`** und traegt denselben Wert wie `hard_cap_cents`. Geprueft wird das
  ueber einen **pg-Rundlauf**, nicht nur im json-Backend — die NOT-NULL-Verletzung existiert
  nur dort, und ihr Radius ist der Rollback der gesamten Flush-Transaktion.
- **Ein `store.save()` nach jedem der sechs Pfade laeuft fehlerfrei durch**, und die danach
  geflushten Calls/usage-Buckets sind in der DB vorhanden (der Beleg, dass keine Zeile die
  Transaktion reisst).
- **Ein Test iteriert ueber ALLE sechs Aufrufer von `setTenantSubscription`** und pinnt, dass
  nach jedem Pfad `effectiveCapCents` dem gesetzten Plan entspricht — einschliesslich des
  Checkout-Return-Pfads (`subscribe.js:175/193`) und des Downgrades ueber
  `billing/webhook.js:213`. Ohne dieses Kriterium waere D8 auf dem Live-Geldpfad ungefixt.
  **Der Test spielt je Pfad die TATSAECHLICH uebergebene Patch-Form durch**, nicht einen
  synthetischen Vollpatch: `{numberSetupFeeExempt}` allein (`activation.js:55`),
  `{planSlug}` allein (`backfill-profiles.js:51`) und den konditional zusammengebauten
  Webhook-Patch ohne `planSlug` (`webhook.js:208-213`). Ein Vollpatch-Test wuerde die
  Fallgrube aus dem Kern gerade nicht treffen.
- **Kein Patch ohne Slug wirft** — `activation.js`- und Webhook-ohne-Slug-Pfad laufen
  unveraendert durch, die Budget-Zeile bleibt unangetastet.
- **Keine abgeleitete Decke erreicht oder ueberschreitet `platformSpendCapCents`** — sonst
  **verweigert der Boot** (`spendCapCoherence`, fatal, ueber alle Slugs aus `plans.js`).
  Das Setzen selbst wirft dafuer **nicht**: es klemmt auf den Cap und meldet eine WARN,
  damit ein nachtraeglich gesenkter Cap den Stripe-Webhook nicht abreisst (s. Kern Punkt 1).
- Plan-Wechsel Starter -> Business hebt die Decke; Business -> Starter **senkt** sie, auch
  wenn der Tenant bereits mehr verbraucht hat (die Decke ist eine Grenze, kein Guthaben).
- Tenant ohne Abo behaelt den konservativen Registrierungs-Default.
- Eine manuell gesetzte `tenant_budget`-Zeile **wird** durch einen Plan-Wechsel
  ueberschrieben (Entscheidung 2, untergeordneter Punkt: sonst entsteht eine zweite,
  unsichtbare Wahrheit neben dem Plan). Der Test pinnt diese Variante explizit, damit sie
  nicht per Konvention existiert.
- Das Minuten-Gate (`planMinutesExhausted`, `outbound-gates.js:255-262`) bleibt unveraendert und bleibt die
  Produktgrenze; das EUR-Gate ist ab hier die **weitere** der beiden.

#### Rot-vor-Fix-Test

Neu `test/plan-cap-derivation.test.js`, heute rot (`planCapCents` existiert nicht, Abschluss
setzt keine Decke):
(a) `createTenantSubscription` mit Business -> `effectiveCapCents === 900` (heute: 600);
Starter -> `300`. Derselbe Fall pinnt zusaetzlich das **Produkt** aus Minuten, Basissatz und
Kopffreiheit (Gegenprobe aus dem Kern) — er faellt rot aus, sobald `planCapHeadroom` als
Dezimalzahl 1,6667 gefuehrt wird und Starter bei 300,006 landet.
(b) Downgrade -> Decke sinkt, auch bei Verbrauch darueber; naechster Outbound wird geblockt.
(c) Tenant ohne Abo -> Default unveraendert.
(d) Business-Tenant telefoniert 120 Minuten zu 5,4 ct -> das EUR-Gate blockt **nicht**,
das Minuten-Gate blockt (heute genau umgekehrt — dieser Test ist der Nachweis, dass D8
behoben ist).
(e) **Alle sechs `setTenantSubscription`-Pfade** (inkl. Checkout-Return und Webhook-Downgrade)
-> Decke entspricht danach dem Plan. Faellt rot aus, sobald die Ableitung an einem Aufrufer
statt an der Schreibkante haengt.
(f) `plans.js` und `apps/web/src/lib/plans.js` bleiben byte-identisch (Bestands-Guard
`test/plans-catalog.test.js` bleibt unveraendert gruen — der Beleg, dass diese Phase den
Spiegel nicht angefasst hat).
(g) **Patch ohne Slug:** `setTenantSubscription(t, {numberSetupFeeExempt:true})` und der
Webhook-ACTIVATE-Patch ohne `planSlug` -> kein Wurf, `effectiveCapCents` unveraendert,
`applyStripeWebhook` laeuft vollstaendig durch (Perioden-Anker und Karten-Bindung werden
gesetzt). Faellt rot aus, sobald die Ableitung auf `patch.planSlug` statt auf den effektiven
Slug schaut.
(h) **Slug gesetzt, aber unbekannt** (`'enterprise'`) -> wirft. Das ist der Fall, fuer den
der Wurf gedacht ist, und der Test grenzt ihn gegen (g) ab.
(i) **pg-Rundlauf ueber beide Pflichtfelder** (**gegen das pg-Backend**, nicht json): nach
`createTenantSubscription` mit Business -> `store.save()` laeuft durch, die Zeile hydriert mit
`budget_cents === 900` **und** `hard_cap_cents === 900`. Danach ein Patch ohne Slug, erneut
`store.save()` -> immer noch beide Felder gesetzt, und ein im selben Flush geschriebener Call
ist nach dem Rundlauf in der DB. Faellt rot aus, sobald die Ableitung `setTenantBudget` nur
mit `hardCapCents` ruft: `budget_cents` wird `undefined`, der INSERT verletzt NOT NULL, und
`flush()` rollt die **gesamte** Transaktion zurueck — der Call fehlt dann ebenfalls. Genau
dieser Mit-Verlust ist die Assertion, nicht nur die Exception.
(j) **Plattform-Cap-Kohaerenz, beide Linien getrennt gepinnt** (heute rot: der Guard sieht
nur den Config-Default, und eine Ableitung existiert gar nicht):
**(j1) Erste Linie, fatal am Boot:** `MAX_BUDGET_EUR=8` (800 ct) + Business-Ableitung
(900 ct) -> `assertBootGates` verweigert den Start mit sprechender Meldung, **ohne** dass
eine einzige `tenant_budget`-Zeile im Spiegel liegt (das ist der Fall "frischer Deploy, erster
Kunde noch nicht da" — er faellt rot aus, sobald der Guard nur gesetzte Zeilen prueft).
Mit angehobenem Cap (Entscheidung 8) -> Boot laeuft, die Decke wird auf 900 gesetzt.
**(j2) Zweite Linie, kein Wurf auf dem Geldpfad:** bei geklemmter Decke (Cap unter der
abgeleiteten Decke, z. B. nach nachtraeglicher Env-Senkung) laufen Checkout-Return
(`subscribe.js:175/193`) **und** Webhook-ACTIVATE mit Business-Slug **vollstaendig** durch —
Perioden-Anker gesetzt, Karte gebunden, Provisioning ausgeloest —, `effectiveCapCents` ist
`platformSpendCapCents`, und genau **eine** WARN nennt beide Zahlen. Faellt rot aus, sobald
das Setzen wirft: dann fehlen Anker, Karte und Nummer, und der Test weist genau diesen
Mit-Verlust nach (nicht nur die Exception).
**(j3)** Die Klausel ueber gesetzte `tenant_budget`-Zeilen schlaegt bei einer Zeile
`>= platformSpendCapCents` ebenfalls an (die Nachlese aus Kern Punkt 2).

#### Schutzniveau

**Pro Tenant schwaecher, plattformweit unveraendert — dritte und letzte benannte Ausnahme.**
Die Einzeldecke steigt von 600 auf bis zu 900 Cent. Das ist gewollt: sie war zu niedrig, um
das verkaufte Produkt zu liefern. Die Plattformdecke (`MAX_BUDGET_EUR`) bleibt unberuehrt und
bleibt die Schnittmenge daraus — ein einzelner Tenant kann die Plattform nach wie vor nicht
sprengen.

**Praezisierung, weil "Schnittmenge bleibt" sonst mehr verspricht, als es haelt:** die
Schnittmenge bleibt, aber sie ist nur so lange eine ZWEI-Achsen-Sicherung, wie die
Tenant-Decke **echt unter** dem Plattform-Cap liegt. Steigt sie darueber, bindet
dauerhaft nur noch die Plattform-Achse, und die per-Tenant-Achse ist fuer diesen Tenant
inert — kein Schutz, sondern die Illusion davon (genau das, was `spendCapCoherence` als
FATAL fuehrt). Der Clamp und die Guard-Erweiterung aus dem Kern sind deshalb nicht
Feinschliff, sondern die Bedingung, unter der dieser Absatz ueberhaupt zutrifft. Wer die
Plattformdecke im selben Schritt **ohne** diese beiden Riegel anhebt, hebt beide
Sicherungen zugleich auf; die Anhebung selbst ist ausdruecklich **nicht** Teil dieser Phase
(Kapitel 10), sie ist ihre Vorbedingung (Entscheidung 8).

#### Risiko

Ein dritter Plan, der spaeter ohne `planCapCents`-Anschluss hinzukommt, faellt still auf den
Registrierungs-Default zurueck — fail-open durch Vergessen, dieselbe Klasse wie D8 selbst.
Gegenmassnahme: `planCapCents` wirft bei **gesetztem, aber unbekanntem** Slug, statt einen
Default zu liefern, und ein Test iteriert ueber **alle** Slugs aus `plans.js`. Das ist der
**einzige** Wurf dieser Phase. Er gilt ausdruecklich NICHT fuer den fehlenden Slug (s. Kern,
Punkt 2 der Slug-Liste) und NICHT fuer die Cap-Kollision (dort Boot-Guard + Clamp, s. Kern
Punkt 1) — jede Verwechslung dieser Faelle reisst den Stripe-Webhook ab und baut den
Abo-ohne-Nummer-Vorfall neu ein.

---

### P7 — Fixkosten sichtbar machen (ElevenLabs-Wand, DID-Miete)

**Behebt:** D6, D7. **Aufwand:** M.
**Abhaengig:** **keine.** Auch hier ist die vorherige Angabe ("P3, fuer die
Zaehlerinfrastruktur") am eigenen Kern widerlegt und korrigiert: P7 baut eine **eigene,
nicht tenant-scoped Tabelle** nach dem Muster von `profiles` und verwendet weder P3-Code
noch P3-Datenfelder. Es gibt keine Zaehlerinfrastruktur aus P3, die hier wiederbenutzt
wuerde. P7 ist parallel zu allem anderen startbar.

#### Ziel

Die beiden Kosten, die kein Gate je sehen wird, werden wenigstens gezaehlt und melden sich,
bevor sie zuschlagen.

#### Die Entscheidung zur Auftragsfrage: was gehoert in `costCents`?

| Position | Variabel? | Pro Tenant zurechenbar? | Entscheidung |
| --- | --- | --- | --- |
| STT, TTS (Telnyx), Recording, Inference | ja | ja (ueber den Call) | **in `costCents`** — ueber P4 |
| `ai-voice-assistant` | ja | ja | **in `costCents`** — ueber P4, sobald der Pfad genutzt wird |
| ElevenLabs | **nein** (Festpreis-Abo) | nein (ein globales Kontingent) | **Plattform-Fixkost**, nicht in `costCents` |
| DID-Miete | nein (monatlich fix je Nummer) | **ja** (strikt eine Nummer je Tenant) | **Anzeige-Fixkost**, nicht in `costCents`; s.u. |

**Die DID-Miete ist der interessante Fall, und die Begruendung dieses Plans hat sich
geaendert.** Die frueher hier stehende Fassung ("per API nicht messbar, deshalb nicht
zurechenbar") ist durch die Nachmessung vom 2026-07-20 ueberholt: der **Listenpreis** ist
abrufbar (`available_phone_numbers.cost_information.monthly_cost` = 1,00 USD/Monat fuer
US-Local, Kap. 2.4), und da je Tenant strikt eine Nummer gilt, waere die Miete sehr wohl
zurechenbar. Sie bleibt trotzdem draussen aus `costCents` — Owner-Entscheidung 6, aus vier
Gruenden, die staerker sind als der alte:

1. **Es ist eine feste Monatsgebuehr, kein Verbrauch.** In den Verbrauchszaehler gebucht,
   startet jeder Tenant den Monat vorbelastet — der Zaehler misst dann nicht mehr, was
   telefoniert wurde.
2. **Groessenordnung gegen die entschiedene Starter-Decke:** 1,00 USD x 0,92 = **92 EUR-Cent
   von 300 Cent Decke** — rund **ein Drittel des Kontingents weg, bevor der erste Anruf
   laeuft**. Das Produktversprechen waere damit erneut nicht einloesbar, diesmal durch die
   eigene Buchung.
3. **Der Abopreis deckt die Nummer bereits ab.** Im Verbrauchszaehler waere sie faktisch
   doppelt berechnet.
4. **Der Listenpreis ist nicht der belastete Betrag.** Fuer eine **Anzeige** reicht die
   Groessenordnung; fuer ein **Gate** reichte sie nicht — und `costCents` speist Gates.

Sie bleibt deshalb eine konfigurierte Fixkost (`NUMBER_MONTHLY_COST_CENTS`, Default aus dem
belegten Listenpreis abgeleitet: **92 EUR-Cent** je Nummer = 1,00 USD x 0,92). Der Owner muss
sie nicht mehr im Portal ablesen; der Wert ist belegt herleitbar und wird als Konfiguration
gepflegt, nicht je Boot abgerufen (Begruendung in Kap. 2.4).

#### Kern

- **Zeichenzaehler** an genau einer Stelle: `src/tts/synth.js:12-42` kennt den Text. Gezaehlt
  wird **an der Stelle, an der der Text bekannt ist, aber erst nach dem Ergebnis-Check** —
  die Zeichenzahl wird vor dem Aufruf ermittelt und nur bei `result.ok` verbucht. Sonst zaehlt
  der Implementierer den Fehlerfall versehentlich mit (s. Akzeptanzkriterium).
- **Der Zaehler ist plattformweit, und das bestimmt seine Tabelle.** Das Kontingent ist global
  (`config.js:228-246`). `call`, `usage` und die uebrigen Tenant-Tabellen stehen unter
  **FORCE ROW LEVEL SECURITY**; ein globaler Zaehler dort wuerde pro Tenant zaehlen statt
  plattformweit — und ein Lesepfad ueber den Bootstrap-Tenant saehe nur dessen Anteil (dieselbe
  RLS-Falle, die P2 fuer den Backfill und P3 fuer die Query behandelt). Der Zaehler gehoert
  deshalb in eine **nicht tenant-scoped** Tabelle, nach dem Muster von `profiles` (`pg.js`:
  bewusst nicht tenant-scoped). Diese Festlegung gehoert vor die Umsetzung, nicht hinein.
  Fortgeschrieben wird monatlich nach dem Muster der Spend-Monat-Achse, mit demselben
  Monotonie-/Zukunftsschluessel-Riegel.
- **Warnschwelle** `TTS_CHARACTER_QUOTA_WARN_PERCENT` (Default **75**) gegen
  `TTS_CHARACTER_QUOTA` (Default **39981**, der belegte Wert). Alarm ueber denselben Kanal
  wie P5.
- **Reset-Anker** ist der ElevenLabs-Zyklus (belegt: 2026-08-03), **nicht** der
  Kalendermonat. Ein Zaehler, der am 1. zurueckspringt und ein Kontingent, das am 3. neu
  laedt, ergeben zwei Tage lang eine falsche Auskunft.
- **Fixkosten im Dashboard:** `PLATFORM_FIXED_COST_CENTS_PER_MONTH` (ElevenLabs 600 belegt +
  `NUMBER_MONTHLY_COST_CENTS * aktive Nummern`, letzteres ein belegter **Listenpreis** und
  im UI als "Listenpreis, nicht Rechnungsposten" gekennzeichnet — nicht mehr als "geschaetzt",
  weil das die Datenlage jetzt unterzeichnet). **Reine Anzeige, kein Gate.**

#### Die Wand, mit den gemessenen Zahlen ausgerechnet

39.981 Zeichen/Monat. Wo die Wand steht, haengt am Nenner — und der ist **UNBELEGT**:

| Annahme Zeichen je Minute | Quelle | Wand liegt bei |
| --- | --- | --- |
| 83 | Planungsdokument, nirgends gemessen | ~482 Plattform-Minuten/Monat |
| 400 | Mittelweg (Agent spricht ~40 % der Zeit) | ~100 Minuten/Monat |
| 900 | normale Sprechrate, wenn der Agent durchgehend redet | ~44 Minuten/Monat |

**Der Unterschied zwischen diesen Zeilen ist Faktor 11.** Bei der pessimistischen Lesart ist
die Wand bereits nach 44 Plattform-Minuten erreicht — das liegt in derselben
Groessenordnung wie der gesamte heutige Lebenszeit-Topf. Der aktuelle Verbrauch (2.805
Zeichen, 7 %) entspricht je nach Nenner 3 bis 34 Minuten. **Dieser Plan rechnet die Wand
nicht aus, weil er es nicht kann** — er baut den Zaehler, der die Frage in einer Woche
Betrieb beantwortet. Genau das ist Regel 1 aus dem Vorfall: erst messen, dann planen. Eine
der drei Zeilen oben in den Plan zu schreiben, waere derselbe Fehler wie die 20 ct/min.

#### Betroffene Dateien

`src/tts/synth.js`, `src/tts/directive-synth.js`, `src/store/state-ops.js`,
`src/store/defaults.js`, `src/db/schema.sql`, `src/store/pg.js`, `src/boot-guard.js`,
`src/routes/api-read.js`, `public/index.html`, `src/config.js`, `.env.example`,
`render.yaml`, `test/tts-quota-counter.test.js` (neu).

#### Akzeptanzkriterium

- Der Zaehler zaehlt exakt die an ElevenLabs gesendeten Zeichen — **nicht** die Zeichen der
  `<Say>`-Fallbacks (`directive-synth.js:44-51`), sonst zaehlt der Ausfall als Verbrauch.
- Ein fehlgeschlagener Synth-Aufruf zaehlt **nicht** (kein Kontingentverbrauch bei HTTP-Fehler
  — bewusst; die Gegenannahme waere sicherer, aber sie waere geraten, und der Zaehler soll
  die Wand vermessen, nicht ueberschaetzen).
- Der Zaehler springt am Zyklus-Anker um, nicht zum Monatsersten.
- Ein Zukunfts-Schluessel setzt den Zaehler nicht zurueck (Uhr-Anomalie, Muster P4 der
  Budget-Achsen-Kette).
- `PLATFORM_FIXED_COST_CENTS_PER_MONTH` erscheint im Dashboard und beeinflusst **kein** Gate.

#### Rot-vor-Fix-Test

Neu `test/tts-quota-counter.test.js`, heute rot:
(a) Drei Synth-Aufrufe a 100 Zeichen -> Zaehler 300.
(b) Synth-Fehler -> Zaehler unveraendert, `<Say>`-Fallback greift.
(c) Zaehlerstand ueber der Warnschwelle -> genau eine WARN, nicht eine pro Aufruf.
(d) Uhr auf den Folgemonat, aber vor dem Zyklus-Anker -> Zaehler laeuft weiter.
(e) Uhr in die Zukunft -> kein Reset.
(f) Kein Gate-Verhalten aendert sich (Reserve/Budget byte-identisch).

#### Schutzniveau

**Unveraendert plus Sichtbarkeit.** Reine Zaehlung und Anzeige.

#### Risiko

Der Zaehler ist plattformweit; ein einzelner Tenant kann das Kontingent fuer alle
aufbrauchen. Das ist heute schon so und wird von dieser Phase nur sichtbar, nicht behoben —
ausdruecklich als Nicht-Ziel gefuehrt (Kapitel 10).

---

### P8 — Flag entfernen

**Behebt:** G4/F4 (abgeschaltete Sicherung mit Verfallsdatum). **Aufwand:** S.
**Abhaengig:** P4 **+ ein voller Abrechnungsmonat mit `COST_TRUING_BOOKING_ENABLED=true`
ohne Drift-Alarm**

#### Ziel

`COST_TRUING_BOOKING_ENABLED` verschwindet; die Korrekturbuchung ist normales Verhalten.

#### Kern

Flag aus `config.js`, `.env.example`, `render.yaml` und `cost-truing.js` entfernen, den
AUS-Zweig samt seiner Tests loeschen (nicht auskommentieren, C5). Diese Phase ist bewusst
**eine Phase mit einer einzigen Aufgabe**: eine Phase mit eingebauter Abbruchklausel sind
zwei Phasen.

**Die eine Stelle, an der "Flag entfernen" eine Sicherung mitreissen koennte, wird hier
ausdruecklich benannt.** Nach P4 haengt in `src/boot-guard.js` der Riegel gegen die **leere
Pflicht-Menge** an `COST_TRUING_BOOKING_ENABLED`. Wer die Zeichenkette mechanisch nach dem
grep-Kriterium unten entfernt, hat zwei Moeglichkeiten, ihn kaputtzumachen: die Bedingung
mitloeschen (Guard weg) oder `cfg.costTruingBookingEnabled` als `undefined` stehen lassen
(falsy — Guard lautlos tot). Beides waere fatal, denn die Korrekturbuchung ist ab dieser
Phase **bedingungslos** aktiv: der Guard wird wichtiger, nicht ueberfluessig. Verbindlich:
**die Flag-Bedingung faellt weg, die Pruefung bleibt und wird unkonditional** — die leere
Pflicht-Menge verweigert den Boot ab P8 immer. Der Kurs-Guard ist von dieser Frage nicht
betroffen, weil er schon seit P2 unkonditional ist (dort begruendet).

#### Betroffene Dateien

`src/config.js`, `src/billing/cost-truing.js`, **`src/boot-guard.js`** (Flag-Bedingung des
Pflicht-Mengen-Riegels entfernen, Pruefung behalten — s. Kern), `.env.example`,
`render.yaml`, `test/cost-truing-booking.test.js`, `test/boot-guard-*.test.js`.

#### Akzeptanzkriterium / Rot-vor-Fix-Test

- `grep -r "COST_TRUING_BOOKING_ENABLED" src/ test/ .env.example render.yaml` -> **0 Treffer**
  (heute rot: die Zeichenkette existiert nach P4 an sechs Stellen).
- Alle Buchungs-Tests aus P4 laufen ohne Flag-Setup unveraendert gruen.
- **Beide Boot-Guards bleiben scharf, ohne jedes Flag-Setup:** Kurs ausserhalb des Bandes ->
  Boot verweigert; leere `COST_TRUING_REQUIRED_RECORD_TYPES` -> Boot verweigert. Diese zwei
  Faelle sind der eigentliche Test dieser Phase — das grep-Kriterium allein wuerde auch von
  einer Umsetzung erfuellt, die beide Sicherungen mit entfernt hat.

#### Schutzniveau

**Unveraendert.** Der AN-Zustand wird zum einzigen Zustand.

#### Risiko

Verfrueht ausgefuehrt zementiert diese Phase einen ungeprueften Buchungspfad. Deshalb die
Zeit-Vorbedingung als harte Abhaengigkeit und nicht als Empfehlung.

---

## 7. Reihenfolge und Schutzniveau

```
        P1 (CDR-Seam, schema-frei)
         |     <-- ABNAHME: Einheit des cost-Felds live belegt
         v
        P2 (Persistenz: Schaetzung + Ist + Versuche + Kurs-Guard)
         |                <-- HARTE VORBEDINGUNG: hermes-db (Frist 2026-07-24)
         v
        P3 (Abgleich, Beobachtungsmodus)
         |     <-- rechnet + meldet die Deckungsquote je Sweep
         |         (costTruingCoveragePercent, Befund coverage_below_threshold);
         |         Stillstand ueber COST_TRUING_COVERAGE_STALL_SWEEPS = Owner-Entscheidung
         v
        P5 (Drift-Waechter)  <-- VORBEDINGUNG: PLATFORM_ALERT_SMS_TO besetzt
         |                   <-- Ausloeser: Boot UND jeder P3-Sweep (nicht nur Boot)
         v
        P4 (Flip: Korrektur)   <-- der Alarm ist VORHER scharf UND laeuft ohne Restart
         |                     <-- VORBEDINGUNG: Pflicht-Menge aus dem P3-Beleg gesetzt
         |                     <-- VORBEDINGUNG: Deckungsquote >= COST_TRUING_MIN_COVERAGE_PERCENT
         |                         (Entscheidung 1: KEIN Kalender-Fenster, keine 4 Wochen)
         |                     <-- setzt diese Vorbedingung selbst durch: Boot-Guard (WARN)
         |                         Buchung aktiv + Quote unter Schwelle -> genau eine WARN
         |                     <-- hebt den Kurs-Guard von WARN (P2) auf FATAL
         v
        P4b (ENV-Senkung + Deckungsquoten-Guard)
         |                 <-- VORBEDINGUNGEN: Deckungsquote gemessen (>= 80 %, dieselbe
         |                     Schwelle wie der Flip), teuerste AKTIVIERBARE Konfiguration
         |                     gedeckt (Schwelle 10 EUR-ct; 5 erst NACH dem Rueckbau des
         |                     Assistant-Pfads), nur praefix-weise fuer vermessene Praefixe
         |                 <-- bringt einen eigenen Boot-Guard (WARN) mit: haelt die
         |                     Vorbedingungen auch NACH der Aktion nach
         |
         v
        P8 (Flag entfernen)  <-- VORBEDINGUNG: 1 voller Monat mit Flag AN

        P6 (Plan-Decken)   [KEINE Code-Abhaengigkeit, parallel zu P1 startbar]
                           <-- Decken entschieden: 300 / 900 ct (Entscheidung 2)
                           <-- VORBEDINGUNG: MAX_BUDGET_EUR angehoben (Entscheidung 8),
                               umgesetzt in PLAN-BUDGET-AXES, VOR Auslieferung von P6
        P7 (Fixkosten/TTS-Wand)  [KEINE Abhaengigkeit, parallel startbar]
```

Azyklisch geprueft. **Sieben** Korrekturen gegenueber den frueheren Fassungen, alle aus der
Falsifikation:

1. **P5 vor P4.** P5 liest `costTruedAt`-Calls und ist damit ein P3-, kein P4-Artefakt. P4
   nennt in seinem eigenen Risiko-Abschnitt den Drift-Alarm als Gegenmassnahme gegen
   systematisch zu niedrige Records — der muss folglich **vor** dem Flip scharf sein, nicht
   danach.
2. **P6 haengt an GAR NICHTS im Code — auch nicht an P3.** Die frueheren Fassungen nannten
   erst P5, dann P3; beides ist an P6s eigener Datei-Liste widerlegt (kein `cost-truing.js`,
   keine P1/P2/P3-Felder). Der Deckel-Basissatz ist Konfiguration aus der **abgeschlossenen**
   Messung in Kapitel 2. D8 ist ein S1 auf dem Live-Zahlungspfad und wurde von einer
   erfundenen Abhaengigkeit ohne Not nach hinten geschoben. P6 haengt stattdessen an zwei
   **Owner-Entscheidungen** (2 und 8, beide am 2026-07-20 getroffen) — das ist die echte
   Vorbedingung; offen ist davon nur noch der Vollzug der `MAX_BUDGET_EUR`-Anhebung.
3. **P7 haengt ebenfalls an nichts.** "P3 fuer die Zaehlerinfrastruktur" war falsch: P7 baut
   eine eigene, nicht tenant-scoped Tabelle und benutzt keinen P3-Code.
4. **P4b ist eine eigene Phase.** Ohne sie senkt keine Phase den ueberhoehten Tarif und D2
   waere nur scheinbar behoben.
5. **Die Einheiten-Verifikation ist Abnahmebedingung von P1**, nicht ein spaeterer Schritt:
   ab P2 haengt eine persistierte Geldgroesse am Faktor Hauptwaehrung -> Mikro-Cent.
6. **P4b ist nicht wirkungsfrei.** Die Annahme "nach P4 haengt die Buchung nicht mehr am
   Tarif" ist an `metering.js:50-55` widerlegt: dort steht unveraendert
   `minuten * tariffCentsPerMin(call.to)`, und P4 fasst die Datei nicht an. P4b bekommt
   deshalb ein ehrliches Schutzniveau (Ausnahme 2) und zwei harte Vorbedingungen.
7. **P5 braucht einen Laufzeit-Ausloeser.** Ein Boot-Guard feuert einmal je Prozessstart; P4
   stuetzt sich aber ueber die gesamte Laufzeit auf P5 als laufende Gegenmassnahme. Die
   Auswertung haengt sich deshalb zusaetzlich ans Ende jedes P3-Sweeps, mit Entprellung.
   Seit Entscheidung 1 (Flip sofort statt nach vier Wochen) ist dieser Ausloeser die einzige
   verbliebene zeitliche Sicherung.

P1 ist schema-frei und **sofort** startbar, unabhaengig von der DB-Frist.

### Schutzniveau je Zwischenstand

| Nach | Kostenschutz | Begruendung |
| --- | --- | --- |
| P1 | **=** | Kein Aufrufer. |
| P2 | **=** | Kein Gate liest die Felder. |
| P3 | **= plus Sichtbarkeit** | Schreibt nur in P2-Felder. Erstmals ist die Drift sichtbar. |
| P5 | **= plus Alarm** | Der Tarif bleibt byte-identisch. |
| **P4** | **formal schwaecher** | **Benannte Ausnahme 1.** Gebuchte Summen koennen erstmals sinken. Nur bei beweisbar vollstaendiger Datenlage (erwartete record_types **komplett**, Schaetzbetrag persistiert); Unterschaetzung wird bedingungslos geheilt. Begruendung in P4. **Seit Entscheidung 1 gibt es kein Kalender-Fenster mehr vor dem Flip** — freigegeben wird ueber die gemessene Deckungsquote (`COST_TRUING_MIN_COVERAGE_PERCENT`). Aufgegeben wird damit die Chance, seltene Ausfallmuster (Wartungsfenster, Monatsgrenzen, verspaetete Records) vor dem Flip zu sehen; getragen wird das allein vom Vollstaendigkeits-Praedikat und vom laufenden P5-Alarm. |
| **P4b** | **formal schwaecher** | **Benannte Ausnahme 2.** Die frueher hier stehende Zusage "=" war am Code falsch: `metering.js:50-55` bucht auch nach P4 `minuten * Tarif` fuer jeden **nicht** abgeglichenen Call. Der Tarif bleibt damit Buchungswert genau in den Faellen, in denen die Messung ausfiel. Zulaessig nur mit den zwei Vorbedingungen aus P4b (teuerste **aktivierbare** Konfiguration gedeckt — also inkl. `ai-voice-assistant`, solange der Pfad im Code steht: Schwelle **10** EUR-ct, nach dem Rueckbau **5**; Abgleich-Deckungsquote ueber `COST_TRUING_MIN_COVERAGE_PERCENT`, dieselbe Schwelle wie der Flip) und der praefix-sauberen Freigabe. Die **gefaehrliche Kombination** aus beiden (niedriger Tarif bei duenner Messabdeckung) ist zusaetzlich durch einen Boot-Guard (WARN) nachgehalten, damit sie nicht nur zum Zeitpunkt der Aktion gilt (P4b Kern Punkt 3) — P4b ist deshalb keine code-freie Phase. **Vorbedingung 1 ist dabei nicht eigenstaendig ueberwacht**: der Guard feuert nur in der Konjunktion und schweigt bei hoher Deckungsquote auch unter der Vollkostenschwelle. Jede Aenderung von `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` verlangt deshalb eine erneute Pruefung gegen den konfigurierten Tarif; sauberer ist der Rueckbau des Assistant-Pfads (Entscheidung 5, Folgearbeit ausserhalb dieses Plans), erst danach darf die Schwelle auf 5 sinken. |
| **P6** | **pro Tenant schwaecher** | **Benannte Ausnahme 3.** Einzeldecke 600 -> bis 900 ct (Entscheidung 2). Plattformdecke unberuehrt. Die Schnittmenge bleibt **nur dann** eine Zwei-Achsen-Sicherung, wenn die abgeleitete Decke echt unter `platformSpendCapCents` (heute 800 ct) liegt — sonst ist die Tenant-Achse inert. Deshalb **fataler Boot-Guard ueber die abgeleiteten Decken aller Slugs** (erste Linie, greift vor dem ersten Kunden) + Clamp mit WARN an der Schreibkante (zweite Linie, **kein** Wurf auf dem Zahlungspfad) + die Anhebung von `MAX_BUDGET_EUR` (Entscheidung 8) als Vorbedingung; s. P6 Kern Punkt 1. |
| P7 | **= plus Sichtbarkeit** | Reine Zaehlung. |
| P8 | **=** | Der AN-Zustand wird der einzige. |

Genau **drei** Phasen schwaechen den Schutz — P4, P4b, P6 —, alle drei sind oben benannt und
begruendet. Dass es drei und nicht zwei sind, ist selbst ein Befund dieser Fassung: P4b galt
bis zur dritten Review-Runde als wirkungsfrei, weil der Plan glaubte, nach P4 haenge die
Buchung nicht mehr am Tarif. Sie tut es fuer jeden nicht abgeglichenen Call. Alle uebrigen
Phasen sind wirkungsfrei oder rein additiv. **Ein Abbruch nach P3 ist ein sinnvoller
Endzustand** — er liefert vollstaendige Sichtbarkeit ohne jede Verhaltensaenderung.

### Kollision mit PLAN-BUDGET-AXES (Koordination, verbindlich)

Beide Ketten schreiben in dieselben Kanten: `bookCents`, `addVoiceUsageCostCents`,
`spendMonthCostCents`. Regeln:

1. **PLAN-BUDGET-AXES P7 (Flip auf die Monatsachse) und P4 dieses Plans duerfen nicht im
   selben Deploy live gehen.** Beide aendern, was der Gate zaehlt. Gehen sie zusammen live
   und der Verbrauch verhaelt sich unerwartet, ist die Ursache nicht mehr zuordenbar.
2. **Reihenfolge-Empfehlung: erst die Monatsachse flippen, dann die Ist-Kosten.** Der
   Monatsschluessel-Flip ist bereits implementiert und getestet; die Ist-Kosten sind neu.
   Die neue, unbewaehrte Aenderung geht zuletzt.
3. PLAN-BUDGET-AXES P8a entwidmet `costCents` zu einem reinen Forensik-Wert. Das ist mit
   diesem Plan **vereinbar** — die Ist-Kosten fliessen ueber `bookCents` in **beide** Achsen
   (mit der Vorzeichen-Asymmetrie aus P4). P8a darf ausgefuehrt werden, ohne diesen Plan zu
   beruehren.
4. Der von PLAN-BUDGET-AXES P5b gemeldete offene Punkt gilt hier fort: der
   fail-closed-Riegel gegen korrupte Werte haengt an `costCents`; die Monatsachse hat kein
   Aequivalent. Die Korrekturbuchung aus P4 braucht **ihr eigenes** Praedikat
   (`isCorrectionCents`) und darf `isBookableCents` nicht aufweichen.

---

## 8. Getroffene Entscheidungen des Owners (2026-07-20)

Dieses Kapitel war bis zum 2026-07-20 ein Fragen-Kapitel. Alle acht Fragen sind entschieden.
Die verworfenen Optionen bleiben knapp stehen, damit nachvollziehbar ist, **wogegen**
entschieden wurde; die frueheren Empfehlungen sind durch die Entscheidung ersetzt. **Zwei
Entscheidungen fielen gegen die Empfehlung des Plans (1 und 5); beide sind unten mit dem
benannt, was dadurch an Sicherheit aufgegeben bzw. gewonnen wurde.**

### Entscheidung 1 — Bis P4, Flip SOFORT (Option c, **gegen die Empfehlung (b)**)

Verworfen: (a) nur bis P3 (Ueberbuchung bliebe, Korrektur bliebe Handarbeit);
(b) Flip erst nach vier Wochen Beobachtung — das war die Empfehlung.

**Praezisierung aus der Nachfrage, sie ist Teil der Entscheidung:** "sofort" heisst nicht
"ungeprueft". Geflippt wird, sobald **P3 eine Mindest-Deckungsquote belegt** — der Anteil der
Calls, die sich sauber einem Provider-Datensatz zuordnen lassen. Das ist eine Zahl aus dem
Betrieb, kein Kalender-Fenster, und kann nach wenigen Tagen erfuellt sein. Die vier Wochen
entfallen als Vorbedingung.

**Dieselbe Konstante wie P4b, keine zweite — geprueft und begruendet.** Verwendet wird
`COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80). Eine eigene Flip-Schwelle waere eine zweite
Zahl mit identischer Bedeutung, an derselben Stelle gerechnet, die beim ersten Nachziehen
auseinanderlaeuft. Der Preis: der Flip wartet moeglicherweise ein paar Tage laenger als
noetig — seine Sicherheit haengt am Vollstaendigkeits-Praedikat aus P4, nicht an der Quote;
die Quote belegt nur, dass die Messpipeline traegt. P4 und P4b bleiben getrennte Phasen, weil
P4b zusaetzlich die Vollkostendeckung und die praefix-saubere Freigabe verlangt.

**Reihenfolge, sonst waere die Bedingung zirkulaer:** die Quote misst gegen die
Pflicht-Menge, also muss diese zuerst aus echten API-Antworten abgeleitet sein. Ablauf:
P3 beobachten -> Joinbarkeit beantwortet -> `COST_TRUING_REQUIRED_RECORD_TYPES` gesetzt ->
Quote messen -> flippen.

**Aufgegeben wird:** die vier Wochen haetten seltene Ausfallmuster gezeigt, die in wenigen
Tagen nicht auftreten (Provider-Wartungsfenster, Monatsgrenzen, verspaetet nachgelieferte
Records). Dieses Risiko traegt ab dem Flip allein das Vollstaendigkeits-Praedikat plus der
**laufende** P5-Alarm — weshalb dessen Laufzeit-Ausloeser (P5, Kern) ab jetzt nicht mehr
Feinschliff ist, sondern die einzige verbliebene zeitliche Sicherung.
**Gewonnen wird:** die Ueberbuchung endet Wochen frueher, und der tote Bestand
unkorrigierbarer Calls (P4, Idempotenz-Riegel) faellt kleiner aus.

**Weil das Zeitfenster als zweite Sicherung entfaellt, traegt die Quote diese Last allein —
und wird deshalb gerechnet, gemeldet und durchgesetzt, nicht nur genannt.** Eine Vorbedingung
ohne Ablesbarkeit ist keine: "dann flippen wir halt trotzdem" waere sonst ein sauberer Boot
bei 20 % Deckung. Verbindlich, mit Bauort:

- **Gerechnet** in P3 als benannte Funktion `costTruingCoveragePercent(store)` (P3, Kern
  Punkt 1) — eine Quelle, aufgerufen von beiden Boot-Guards.
- **Gemeldet** am Ende jedes P3-Sweeps als Befund `coverage_below_threshold`, entprellt wie
  die P5-Befunde (P3, Kern Punkt 2).
- **Durchgesetzt** am Flip selbst durch einen Boot-Guard (**WARN**) in P4: Buchung aktiv +
  Quote unter der Schwelle -> genau eine WARN (P4, Kern; Test (p)).

**Terminierungsregel, falls die Schwelle nie erreicht wird** (die Frage, die das
Kalender-Fenster frueher automatisch beantwortet hat): bleibt die Quote ueber
`COST_TRUING_COVERAGE_STALL_SWEEPS` (Default **8**) aufeinanderfolgende Sweeps darunter, ist
ein Alarm faellig und eine ausdrueckliche Owner-Entscheidung zu treffen — Ursachenbehebung
oder der in Kapitel 7 vorgesehene Endzustand "Abbruch nach P3/P5". **`COST_TRUING_MIN_COVERAGE_PERCENT`
darf dabei nicht gesenkt werden, um die Bedingung zu erfuellen.** Das Absenken einer Schwelle,
weil sie haelt, ist die Ruecknahme der Entscheidung, nicht ihre Erfuellung.

*Eingearbeitet in:* P3 (Kern Punkte 1-3, Akzeptanzkriterium, Betroffene Dateien, Tests
(i)/(j), Risiko), P4 (Abhaengigkeiten + Entscheidungs-Kasten, Deckungs-Riegel im Kern,
Betroffene Dateien, Akzeptanzkriterium, Test (p)), P4b (Kern Punkt 2 und 3), P5
(Laufzeit-Ausloeser), Kapitel 7 (Reihenfolge-Diagramm, Schutzniveau-Tabelle), Anhang
(`COST_TRUING_COVERAGE_STALL_SWEEPS`).

### Entscheidung 2 — Decken 300 / 900 Cent (Option b)

Verworfen: (a) 360 / 1080 (Formel-Variante mit glatten Faktoren 2,0 / 1,5);
(c) groesszuegiger, z. B. 400 / 1200.

Runde Decken sind gegenueber dem Kunden erklaerbar, und die Kopffreiheit traegt die
gemessenen Kosten mit Abstand (300 ct gegen 149 ct Vollkosten, 900 ct gegen 596 ct — beides
EUR, zum Kurs 0,92 umgerechnet). Der Preis: die Kopffreiheit wird krumm.

**Gegen die Formel-Basis 30x6 = 180 bzw. 120x6 = 720 lauten die korrekten Faktoren
`planCapHeadroom` = 5/3 (dezimal 1,6667) und 5/4 (dezimal 1,25).** Sie werden als
ganzzahliger Bruch gefuehrt, nicht als Dezimalzahl: `30 * 6 * 1.6667` ergaebe 300,006 und
damit eine Geldgrenze, die von einer Rundung im Aufrufer abhaengt (G26). **Gegenprobe, sie
geht exakt auf:** 30 x 6 x 5/3 = 300 und 120 x 6 x 5/4 = 900.

**Achtung, zwei verschiedene Bezugsgroessen — hier ist die erste Fassung dieses Kapitels
schon einmal gestolpert.** Die Kopffreiheits-Spalte der **Kontrollrechnung** in P6 (2,01 /
1,51) bezieht sich auf die **gemessenen** 5,4 USD-ct/min, zum Kurs 0,92 in EUR umgerechnet
(300/149 bzw. 900/596), und ist eine reine Plausibilitaets-Pruefung. **Diese Zahlen sind
KEINE Formel-Eingabe.** Setzte man 2,01 / 1,51 in die Formel ein, kaeme **362 / 1087 ct**
heraus statt der gewollten 300 / 900 — eine stille Fehlberechnung der Tenant-Geldgrenze auf
dem Budget-Gate-Pfad.

**Bindend fuer die Umsetzung:** Kern-Tabelle, Akzeptanzkriterium und Rot-vor-Fix-Test von P6
sind in **einem** Zug auf 300 / 900 gezogen worden; dieselbe Zahl darf nicht an drei Stellen
unterschiedlich stehen. Ein Test pinnt das **Produkt**, nicht nur den Faktor.
**Untergeordnet, mitentschieden:** ein Plan-Wechsel **ueberschreibt** eine manuell gesetzte
`tenant_budget`-Zeile — sonst entsteht eine zweite, unsichtbare Wahrheit neben dem Plan.
**Reichweite:** auch 900 ct liegt ueber dem heutigen Plattform-Cap von 800 ct; Entscheidung 8
bleibt also Vorbedingung, sie wird nur um 180 ct entschaerft.

*Eingearbeitet in:* P6 (Kern-Tabelle, Akzeptanzkriterium, Rot-vor-Fix (a)/(i)/(j1),
Schutzniveau), Kapitel 7, Anhang (`planCapHeadroom`).

### Entscheidung 3 — Keine rollende Selbstkalibrierung (Option a)

Verworfen: (b) P5b mit Band `[0,5x .. 1,0x]`, p95, min. 20 Stichproben;
(c) wie im Auftrag beschrieben, ohne Band — ausdruecklich abgelehnt, weil ein
selbstjustierender Wert ohne harte Deckelung auf dem Geld-Pfad gegen Absolute Regel 1
verstiesse.

Es bleibt beim messenden Waechter P5; das Nachziehen des Tarifs bleibt Owner-Handarbeit auf
Basis der Waechter-Zahlen. Das entspricht dem bisherigen Entwurf — hier ist nur die
Entscheidung zu vermerken, es aendert sich nichts an den Phasen.

*Eingearbeitet in:* P5 (Abweichungs-Abschnitt), Kapitel 10 (Nicht-Ziele).

### Entscheidung 4 — Das dynamische Plattform-Cap wird in PLAN-BUDGET-AXES gebaut (Option a)

Verworfen: (b) hier als P9 aufnehmen; (c) weiter offenlassen.

Der Owner will den Plattform-Deckel **ausdruecklich dynamisch**: Summe der aktiven
Tenant-Decken x Faktor. Ein fester Deckel skaliert nicht mit wachsender Nutzerzahl. Nur der
**Bauort** ist der andere Plan — die Formel steuert die Achsen der Budget-Achsen-Kette, und
zwei Ketten, die dieselbe Konstante setzen, sind eine Konstante mit zwei Besitzern. Gebaut
wird sie dort als "P7b", **nach** P6 dieses Plans (erst ab dann sind die Tenant-Decken
plan-abhaengig und damit sinnvoll summierbar).

> **Wo PLAN-BUDGET-AXES.md heute liegt — verbindlich, weil dieser Plan an zehn Stellen
> darauf zeigt.** Die Datei liegt **nicht mehr im Arbeitsbaum**: sie wurde am 2026-07-20 in
> Commit `a0431fa` ("abgeschlossene Strategie-Dokumente aus dem Arbeitsbaum entfernen")
> geloescht. Die Kette ist entgegen dieser Commit-Nachricht **nicht abgeschlossen** — sie
> traegt noch zwei offene Punkte, auf die dieser Plan angewiesen ist: "P7b" (diese
> Entscheidung) und die `MAX_BUDGET_EUR`-Anhebung (Entscheidung 8, harte Vorbedingung von
> P6, einem S1-Fix auf dem Zahlungspfad). Herkunft und Wiederherstellung:
> `git show a0431fa~1:PLAN-BUDGET-AXES.md`. Wer eine der beiden Arbeiten aufnimmt, stellt
> das Dokument aus diesem Commit wieder her, statt den Bauort neu zu erfinden — ein
> Dokument, das nur ueber die Historie erreichbar ist, ist fuer den naechsten Leser
> praktisch nicht vorhanden. Alle Verweise auf "PLAN-BUDGET-AXES" in diesem Plan sind so zu
> lesen.

*Eingearbeitet in:* Kapitel 10 (Nicht-Ziele: Cap-Anhebung), Entscheidung 8 (die feste
Anhebung ist die Zwischenloesung, die spaeter von dieser Formel abgeloest wird).

### Entscheidung 5 — Der `ai-voice-assistant`-Pfad wird GANZ VERWORFEN (**gegen die Empfehlung (a)**)

Verworfen: (a) Flag bleibt aus, bis P4 die Kosten sichtbar bucht — das war die Empfehlung;
(b) aktivieren und die Kosten hinnehmen.

Nicht "aus lassen", sondern aufgeben: die **Budget-Engine bleibt der einzige Weg**. Folgen,
alle vier gezogen:

1. **D4 verliert den Status eines schwebenden Risikos und wird zu einer Entscheidung**
   (Befundtabelle, Kapitel 3).
2. **Die Vollkostenschwelle von P4b bekommt zwei Werte und einen Ausloeser.** Heute
   **10 EUR-ct** (10,4 USD-ct x 0,92 = 9,568, aufgerundet), nach vollzogenem Rueckbau
   **5 EUR-ct** (5,4 x 0,92 = 4,968, aufgerundet). **Bindend: die Schwelle darf ERST sinken,
   wenn der Pfad tatsaechlich aus dem Code entfernt ist.** Eine Absichtserklaerung des Owners
   entfernt keinen Code-Pfad; solange er aktivierbar bleibt, ist die konservative Schwelle
   die richtige.
3. **Der Rueckbau selbst ist NICHT Teil dieses Plans** (Scope). Er ist als **Folgearbeit** zu
   fuehren und betrifft `src/telephony/adapters/telnyx/voice.js` (`startAssistant`,
   `ai_assistant_start`) sowie `src/config.js` (`telnyx.telnyxAssistant`,
   `TELNYX_AI_ASSISTANT_ENABLED`). Dieser Plan plant ihn nicht, er vermerkt ihn.
4. **Aufgegeben wird** die Option, den Pfad spaeter guenstig wieder aufzunehmen — die
   Streaming-/Barge-in-Frage bleibt damit ungeloest und wandert in die Voice-Stack-Strategie.
   **Gewonnen wird** eine variable Kostenbasis, die nicht mehr per Env-Flag auf das Doppelte
   springen kann, und mittelfristig eine um die Haelfte niedrigere Vollkostenschwelle.

*Eingearbeitet in:* Kap. 2.2, D4 (Kapitel 3), P4b (Kern Punkt 1 + 3), Kapitel 7
(Schutzniveau-Tabelle), Kapitel 10, Anhang (`VOICE_TARIFF_FULL_COST_FLOOR_CENTS`).

### Entscheidung 6 — DID-Miete in die Anzeige, NICHT in `costCents` (Option a)

Verworfen: (b) weiter ignorieren.

**Mit einer Sachkorrektur an Kapitel 2.4** (Nachmessung 2026-07-20): der **Rechnungsposten**
ist per API nicht abrufbar, der **Listenpreis** sehr wohl —
`available_phone_numbers.cost_information.monthly_cost` = 1,00 USD/Monat fuer US-Local, plus
1,00 USD einmalig; bei 3 aktiven Nummern 3,00 USD/Monat. Da je Tenant strikt eine Nummer
gilt, ist die Miete **pro Tenant zurechenbar** — die alte Begruendung "nicht messbar, also
nicht zurechenbar" traegt nicht mehr.

Die Schlussfolgerung bleibt trotzdem, aber aus vier staerkeren Gruenden: (1) feste
Monatsgebuehr, kein Verbrauch — sonst startet jeder Tenant den Monat vorbelastet; (2) 1,00
USD x 0,92 = **92 von 300 Cent Starter-Decke**, also rund ein Drittel des Kontingents weg vor
dem ersten Anruf; (3) der Abopreis deckt die Nummer bereits ab, im Verbrauchszaehler waere
sie doppelt berechnet; (4) der Listenpreis ist nicht der belastete Betrag — fuer eine Anzeige
reicht die Groessenordnung, fuer ein Gate nicht.

*Eingearbeitet in:* Kap. 2.1 (Tabellenzeile), Kap. 2.4 (neu gefasst), D6, P7
(Entscheidungstabelle + Fixkosten-Anzeige), Kapitel 10, Anhang
(`NUMBER_MONTHLY_COST_CENTS`).

### Entscheidung 7 — Der Owner pflegt den Kurs quartalsweise von Hand (Option a)

Verworfen: (b) automatischer Kursabruf — waere ein zweiter selbstjustierender Wert auf dem
Geld-Pfad (PM-1 in neuer Kleidung) plus eine Netzabhaengigkeit im Buchungslauf;
(c) 1:1-Kurs (1000000) — nicht falsch, nur teurer (fail-closed durch Ueberbuchung), aber
verworfen.

`PROVIDER_TO_BUCKET_RATE_MICRO` bleibt Konfiguration, Default 920000 (0,92 EUR/USD, Stand
2026-07, **ANNAHME**). Geprueft wird quartalsweise von Hand; **der Boot-Guard aus P2 bleibt
die Sicherung** (Band `[0,5x .. 2,0x]` um den Anker, WARN ab P2, FATAL ab P4, unkonditional).

*Eingearbeitet in:* Anhang (`PROVIDER_TO_BUCKET_RATE_MICRO`) — der Entwurf entsprach dieser
Entscheidung bereits.

### Entscheidung 8 — `MAX_BUDGET_EUR` wird angehoben, BEVOR P6 ausgeliefert wird (Option a)

Verworfen: (b) P6 mit auf den Cap geklemmten Decken (ehrlich, aber das Produktversprechen
von 120 Minuten bliebe uneinloesbar, D8 nur teilweise behoben); (c) P6 zurueckstellen.

Der Plattform-Cap steht auf **800 EUR-Cent** (`eurToCents(numEnv("MAX_BUDGET_EUR"))`). Die
gemessenen 5,4 ct/min sind **USD**-Cent, zum Kurs 0,92 also 4,968 EUR-ct: ein einzelner
Business-Kunde verbraucht sein Kontingent von 120 Minuten mit **596 EUR-Cent**. Der Topf
traegt diesen einen knapp und keinen zweiten daneben; die entschiedene Business-Decke von
900 ct liegt ohnehin darueber, womit die per-Tenant-Achse fuer Business-Tenants inert waere —
was `spendCapCoherence` fuer den analogen Config-Fall als FATAL fuehrt.

**Groessenordnung der Anhebung: Summe der aktiven Tenant-Decken plus Reserve.** Die Anhebung
selbst gehoert nach **PLAN-BUDGET-AXES** (konsistent mit Entscheidung 4) und ist von dort aus
**harte Vorbedingung von P6** hier. Spaeter loest die dynamische Formel aus Entscheidung 4
diese feste Zahl ab. **Achtung, Bauort:** `PLAN-BUDGET-AXES.md` liegt seit Commit `a0431fa`
nicht mehr im Arbeitsbaum; Herkunft, Wiederherstellungsbefehl und Begruendung stehen im
Kasten von Entscheidung 4 — ohne ihn haengt die einzige harte Vorbedingung von P6 an einem
Ort, den der naechste Leser nicht findet.

**Ausfallmodus, falls die Anhebung dennoch ausbleibt** (Code vor Env ist hier die Regel):
P6 erweitert `spendCapCoherence` genau deshalb um die abgeleiteten Decken **aller** Slugs,
Stufe fatal. Der Deploy scheitert dann **laut am Boot**, bevor der erste Kunde zahlt — nicht
als Laufzeit-Wurf im Stripe-Webhook, der Anker, Karte und Nummer verschluckt. Ein vergessener
Env-Wert kostet einen fehlgeschlagenen Deploy, keinen bezahlten Kunden ohne Nummer.

*Eingearbeitet in:* D8, P6 (Kollisions-Abschnitt, Kern Punkt 3, Rot-vor-Fix (j1)),
Kapitel 7 (Reihenfolge-Diagramm, Schutzniveau), Kapitel 10.

---

## 9. Pre-Mortem — Juli 2027, rueckwaerts gelesen

**PM-1 — "Der kluge Tarif war beweglicher als die Aufsicht."**
Wir haben den Tarif selbstjustierend gemacht. Ein Jahr spaeter kann niemand mehr sagen, wie
hoch er gerade steht oder warum — die Zahl lebt in einem Regelkreis statt in einer Datei.
Ein Fehler in der Ableitung ist erst aufgefallen, als das Geld weg war. Heute ist der Tarif
dumm und falsch, aber vorhersagbar; das war eine Eigenschaft, kein Mangel.
*Gegenmassnahme (in der Kette):* P5 misst und alarmiert, justiert nicht. Der Tarif bleibt
Konfiguration. Die rollende Kalibrierung ist mit Entscheidung 3 abgelehnt, nicht nur
zurueckgestellt.

**PM-2 — "Die Kalibrierung hat sich selbst gefuettert."**
Der Satz wurde aus Anrufen berechnet, die das Gate durchgelassen hat. Er sank, mehr Anrufe
kamen durch, er sank weiter. Die Rueckkopplung war unauffaellig, weil jede einzelne Iteration
plausibel aussah.
*Gegenmassnahme:* Entscheidung 3 lehnt die rollende Kalibrierung ab, womit diese
Rueckkopplung gar nicht erst entsteht. Sollte sie je gebaut werden, gilt ein **Band**
(`[0,5x .. 1,0x]` des Konfig-Werts): der abgeleitete Satz kann den konfigurierten Hoechstwert nie ueberschreiten
und nie unter die Haelfte fallen. Der Hoechstwert bleibt Konfiguration. Ohne Band: keine
Umsetzung.

**PM-3 — "Der CDR-Verzug hat das Gate blind gemacht."**
Die Ist-Kosten kamen spaeter als der naechste Anruf. Das Gate rechnete zwischenzeitlich mit
alten Zahlen.
*Bewertung:* Fuer eine langsame Groesse — Tarife bewegen sich in Jahren — ist das
akzeptabel und in P3 bewusst entworfen (`COST_TRUING_DELAY_MINUTES`). **Nicht** akzeptabel
waere es fuer die **Reserve**: deshalb bleibt die Reserve eine Vorab-Schaetzung und wird nie
aus verzoegerten Daten gespeist. Die harte Grenze des Auftrags ist damit im Entwurf
verankert, nicht nur benannt.

**PM-4 — "Der Ausfall der Messung war kein Limit mehr."**
Die Provider-API war zwei Wochen kaputt. Der Abgleich lief leer, lieferte 0-Kosten, und die
Korrekturbuchung erstattete jedem Tenant seine Schaetzung zurueck. Die Decken sind nie
gegriffen.
*Gegenmassnahme:* die **asymmetrische Korrektur** aus P4 — Rueckerstattung nur bei
beweisbar vollstaendiger Datenlage, Nachbuchung immer. Ein `{ok:false}` ist im Typ vom
gemessenen Wert 0 unterscheidbar (P1), nicht per Konvention. Zusaetzlich meldet P3 die Zahl
der unabgeglichenen Calls; steigt sie, ist die Messung tot und man sieht es.

**PM-5 — "Der erste teure Anruf war immer gratis."**
Ein rollender Durchschnitt kennt eine neue Destination nicht und unterschaetzt sie
zwangslaeufig. Der erste Anruf nach Sattelit oder Premium-Rate hat mehr gekostet als der
Monatsumsatz.
*Gegenmassnahme:* Die Kalibrierung (falls je gebaut) arbeitet **pro Praefix** mit **p95**,
nie mit dem Mittelwert, und **Unbekanntes faellt auf `voiceTariffDefaultCents`** (heute 300
ct/min) zurueck — den harten Deckel fuer alles ohne Praefix-Treffer. Testfall P5(d) pinnt
genau das. Unabhaengig davon heilt P4 die Unterschaetzung immer, ohne Bedingung.

**PM-6 — "Die ElevenLabs-Wand kam ohne Vorwarnung."**
Mitten in der Wachstumsphase fiel die Stimme aus. Kein Budget-Gate hat gewarnt, weil ein
Festpreis-Abo in keiner Kostenachse steht. Der Fallback auf `<Say>` funktionierte technisch
— und klang so, dass Kunden abgesprungen sind, ohne den Grund zu nennen.
*Gegenmassnahme:* P7 zaehlt die Zeichen und warnt bei 75 %. Und: die Wand ist **heute nicht
ausrechenbar** — je nach Nenner steht sie bei 44 oder bei 482 Plattform-Minuten (Faktor 11).
Der Plan schreibt deshalb keine Zahl fest, sondern baut den Zaehler, der sie in einer Woche
liefert.

**PM-7 — "Zwei Ketten haben denselben Zaehler umgebaut."**
Budget-Achsen-Flip und Ist-Kosten-Flip gingen im selben Deploy live. Der Verbrauch verhielt
sich seltsam, und niemand konnte sagen, welche der beiden Aenderungen es war. Beide wurden
zurueckgerollt, und danach hat sich niemand mehr an das Thema getraut.
*Gegenmassnahme:* Kapitel 7, Koordinationsregel 1 — nie im selben Deploy, und die neuere
Aenderung geht zuletzt.

**PM-8 — "Wir haben wieder ein Produkt uebersehen."**
Beim naechsten Kostenaudit tauchte ein weiterer Telnyx-Posten auf, den niemand auf dem Zettel
hatte — so wie STT, TTS und ElevenLabs zweimal uebersehen wurden und das Ergebnis um 56 %
verschoben haben, und so wie `ai-voice-assistant` erst im dritten Anlauf auffiel.
*Gegenmassnahme:* Der Abgleich in P3 protokolliert die **gefundenen record_types** je Call,
nicht nur die Summe. Ein neuer, unbekannter `record_type` erzeugt eine WARN. Und die
Betriebsregel: bei Kostenfragen `GET /v2/usage_reports/options` aufrufen und **alle** 36
Produkte durchgehen, nicht die naheliegenden.

---

## 10. Was bewusst NICHT Teil des Plans ist

| Ausgeschlossen | Begruendung |
| --- | --- |
| Rollende Selbstkalibrierung des Reserve-Tarifs (Stufe 2 des Auftrags) — **vom Owner am 2026-07-20 bestaetigt abgelehnt (Entscheidung 3)** | **Nicht**, weil der Tarif harmlos waere — er bleibt auch nach P4 der Buchungswert jedes nicht abgeglichenen Calls (`metering.js:50-55`, s. P4b). Sondern weil eine Selbstjustierung genau auf diesem Geld-Pfad die Rueckkopplung PM-2 einbaut (der Wert wird aus Anrufen gespeist, die das Gate durchgelassen hat) und ihn an den Mittelwert zieht, wo er das teuerste ungemessene Szenario decken muesste. Nutzen klein (praezisere Sperre), Angriffsflaeche gross. Entscheidung 3, Begruendung in P5. |
| Ist-Kosten in der **Reserve** | Strukturell unmoeglich: das Gate reserviert vor dem Anruf, die Ist-Kosten existieren erst danach. Die harte Grenze des Auftrags. |
| Twilio-Implementierung von `getVoiceCostRecords` | Twilios `price` hat eine andere Deckung (nur Connectivity) — dieselbe Signatur mit anderer Semantik waere schlimmer als keine. Live laeuft Telnyx. |
| Umrechnung USD -> EUR an der Persistenzkante | Macht den Forensik-Wert unrekonstruierbar. Umrechnung lebt an einer Stelle im Gate-Pfad (P4). |
| DID-Miete pro Tenant in `costCents` | **Nicht mehr, weil unmessbar** — der Listenpreis ist belegt (1,00 USD/Monat je Nummer, Kap. 2.4) und je Tenant zurechenbar. Sondern: es ist eine feste Monatsgebuehr und kein Verbrauch (jeder Tenant startete den Monat vorbelastet), sie fraesse 92 von 300 Cent Starter-Decke vor dem ersten Anruf, der Abopreis deckt die Nummer bereits ab (Doppelberechnung), und der Listenpreis ist nicht der belastete Betrag — fuer eine Anzeige reicht das, fuer ein Gate nicht. Entscheidung 6; Anzeige in P7. |
| Pro-Tenant-Kontingent fuer ElevenLabs | Das Kontingent ist global (`config.js:228-246`). Eine Aufteilung ist ein eigenes Produktthema, kein Kostentracing. P7 macht das Problem nur sichtbar. |
| Anhebung von `MAX_BUDGET_EUR` | Reine Owner-/Cap-Entscheidung, gehoert in PLAN-BUDGET-AXES. Dieser Plan aendert, WORAUS der Topf gefuellt wird, nicht wie gross er ist. Entscheidung 8 hat sie **getroffen**; sie ist damit harte **Vorbedingung** von P6 — gebaut wird sie dort. Bauort-Hinweis: `PLAN-BUDGET-AXES.md` liegt seit `a0431fa` nur noch in der Historie (Kasten in Entscheidung 4). |
| **Dynamisches** Plattform-Cap (Summe der aktiven Tenant-Decken x Faktor) | Vom Owner ausdruecklich gewollt (Entscheidung 4) — ein fester Deckel skaliert nicht mit wachsender Nutzerzahl. Gebaut wird es als "P7b" in **PLAN-BUDGET-AXES**, nach P6 dieses Plans: zwei Ketten, die dieselbe Konstante setzen, waeren eine Konstante mit zwei Besitzern. Bauort-Hinweis: `PLAN-BUDGET-AXES.md` liegt seit `a0431fa` nur noch in der Historie (Kasten in Entscheidung 4); der Name "P7b" ist dort zu verankern, nicht neu zu vergeben. |
| Backfill der Ist-Kosten fuer Bestands-Calls | `migrate()` laeuft bei jedem Boot mit gepinnter Bootstrap-GUC; ein Backfill auf der FORCE-RLS-Tabelle `call` saehe nur einen Tenant. Bestandszeilen bleiben `NULL` = "nie abgeglichen". |
| Aktivierung des `ai-voice-assistant`-Pfads | Entscheidung 5 verwirft den Pfad ganz; die Budget-Engine bleibt der einzige Weg. |
| **Rueckbau** des `ai-voice-assistant`-Pfads | Folge aus Entscheidung 5, aber ausserhalb des Scopes dieses Plans. **Folgearbeit**, betrifft `src/telephony/adapters/telnyx/voice.js` (`startAssistant`, `ai_assistant_start`) und `src/config.js` (`telnyx.telnyxAssistant`, `TELNYX_AI_ASSISTANT_ENABLED`). Bis zum Vollzug bleibt die Vollkostenschwelle von P4b bei 10 EUR-ct. |
| Ein eigener Scheduler / Render-Cron | Existiert auf dem Free Tier nicht. P3 nutzt die zwei bereits etablierten Muster (`setInterval().unref()` + extern anstossbarer Endpunkt). |

---

## Anhang — Verbindliche Namen

| Konzept | Name | Ort |
| --- | --- | --- |
| CDR-Abruf am Voice-Port | `getVoiceCostRecords({legId, startedAt, endedAt})` | `telephony/ports.js`, `adapters/telnyx/voice.js` |
| Dezimalstring (Provider-**Hauptwaehrung**) -> Mikro-Cent, float-frei, Faktor 10^8 | `parseDecimalToMicroCents(str)` | `adapters/telnyx/cost-parse.js` |
| Faktor Hauptwaehrung -> Mikro-Cent (zusammengesetzt, keine zweite 100) | `MICRO_CENTS_PER_CURRENCY_UNIT = CENTS_PER_EUR * MICRO_CENTS_PER_CENT` | `defaults.js` |
| **Gebuchter Schaetzbetrag** (persistiert!) | `estimatedCostCents` / `estimated_cost_cents` (INTEGER) | `state-ops.js`, `schema.sql`, geschrieben in `metering.js` |
| Ist-Kosten eines Calls | `actualCostMicroCents` / `actual_cost_micro_cents` (BIGINT) | `state-ops.js`, `schema.sql` |
| Abgleich erfolgt am | `costTruedAt` / `cost_trued_at` | dito |
| Herkunft des Werts | `costTruedSource` / `cost_trued_source` (`telnyx_detail_records` \| `unavailable` \| `incomplete`) | dito |
| Versuchszaehler (persistiert!) | `costTruingAttempts` / `cost_truing_attempts` (INTEGER, Default 0) | `state-ops.js`, `schema.sql` |
| Pflicht-Menge der record_types | `COST_TRUING_REQUIRED_RECORD_TYPES` (**Default LEER**; leer = `'incomplete'` = nie eine negative Korrektur; **Boot verweigert** bei aktiver Buchung + leerer Menge. Gesetzt wird sie aus dem P3-Beleg, nie geraten) | `config.js`, `boot-guard.js` |
| Sweep-Intervall des Abgleich-Jobs | `COST_TRUING_SWEEP_INTERVAL_MS` (Default 6 h, Modul-Konstante nach Muster `RETENTION_SWEEP_INTERVAL_MS`) | `billing/cost-truing.js` |
| Der Abgleich-Job | Kosten-Abgleich, `src/billing/cost-truing.js` | neu |
| Korrekturbuchung (vorzeichenbehaftet) | `bookCostCorrectionCents(s, tenantId, deltaCents, nowIso)` | `state-ops.js` |
| Praedikat dafuer (Vorzeichen erlaubt) | `isCorrectionCents(x)` | `defaults.js` |
| Sub-Cent-Rest der Korrekturen | `costCorrectionMicroCentsRem` | `defaults.js`, `state-ops.js` |
| Nebenkosten-Aufschlag (nur Fall B) | `voiceOverheadCentsPerMin` / `VOICE_OVERHEAD_CENTS_PER_MIN` (Default 2) | `config.js` |
| Provider-Waehrung | `providerCurrency` / `PROVIDER_CURRENCY` (Default `USD`) | `config.js` |
| Umrechnung Provider -> Bucket | `providerToBucketRateMicro` / `PROVIDER_TO_BUCKET_RATE_MICRO` (**Default 920000** = 0,92 EUR/USD, ANNAHME; `min: 1`, Boot-Guard **unkonditional** — NICHT an das Flip-Flag gekoppelt; Stufe **WARN ab P2, FATAL ab P4**, s. P2 Punkt 2) | `config.js`, `boot-guard.js` |
| Skala des Kurses (keine nackte 1e6 in der Formel) | `PROVIDER_RATE_SCALE = 1_000_000` | `defaults.js` |
| Anker des Kurs-Bands (eigene Konstante, **nicht** der ENV-Default) | `PROVIDER_RATE_ANCHOR_MICRO` (920000) | `boot-guard.js` |
| Bandgrenzen des Kurs-Guards | `PROVIDER_RATE_BAND_MIN_FACTOR` (0.5) / `PROVIDER_RATE_BAND_MAX_FACTOR` (2.0) | `boot-guard.js` |
| Aufschub bis zum Abgleich | `COST_TRUING_DELAY_MINUTES` (Default 180) | `config.js` |
| Abbruch nach N Versuchen | `COST_TRUING_MAX_ATTEMPTS` (Default 5) | `config.js` |
| Flip-Flag (Abschaltplan: P8) | `COST_TRUING_BOOKING_ENABLED` (Default **AUS**) | `config.js` |
| Drift-Warnschwelle | `costDriftWarnPercent` / `COST_DRIFT_WARN_PERCENT` (Default 50) | `config.js` |
| Gemessener Satz je Praefix | `measuredCentsPerMinByPrefix(calls, prefix)` | `billing/cost-calibration.js` |
| Mindeststichprobe | `COST_CALIBRATION_MIN_SAMPLES` (Default 20) | `config.js` |
| Befund-Codes des Drift-Waechters | `underestimate` \| `overestimate` \| **`insufficient_samples`** (letzterer sichtbar, aber **ohne** Alarm — "zu wenig Daten" ist nicht dasselbe wie "im Band"; P4b haengt daran) | `billing/cost-calibration.js` |
| Entprellung der Drift-Alarme | `COST_ALERT_DEBOUNCE_MS` (Default 24 h; je Praefix UND Befund-Code) | `billing/cost-calibration.js` |
| Abgleich-Deckungsquote (Vorbedingung von **P4 (Flip)** UND **P4b** — dieselbe Schwelle, bewusst keine zweite; Entscheidung 1) | `COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80): Anteil der Calls mit `costTruedSource='telnyx_detail_records'` UND vollstaendiger Typ-Menge. **Nicht persistiert** — der Boot-Guard rechnet sie live aus dem bereits geladenen Store-Spiegel (`store.load()` in `boot.js:178` laeuft vor `assertBootGates` in `boot.js:187`), Muster `spendCapCoherence`. Nenner 0 = 0 % (kein Freispruch). Die Guards **rechnen nicht selbst**, sie rufen `costTruingCoveragePercent(store)` auf. | `config.js`, `boot-guard.js` |
| Berechnung der Deckungsquote (EINE Quelle fuer Sweep-Ausgabe, P4-Guard und P4b-Guard) | `costTruingCoveragePercent(store)` — eingefuehrt in **P3**, also VOR der Phase, die sie freigibt; Nenner 0 = **0** | `billing/cost-truing.js` |
| Befund-Code der Deckungs-Meldung | `coverage_below_threshold` (am Ende jedes Sweeps, entprellt ueber `COST_ALERT_DEBOUNCE_MS`, ohne PII) | `billing/cost-truing.js` |
| Stillstands-Grenze der Deckungsquote | `COST_TRUING_COVERAGE_STALL_SWEEPS` (Default 8): so viele aufeinanderfolgende Sweeps unter der Schwelle -> Alarm und **Owner-Entscheidung** (Ursache beheben oder Abbruch nach P3/P5). Die Schwelle selbst wird dabei **nie gesenkt**, um die Bedingung zu erfuellen (Entscheidung 1) | `config.js`, `billing/cost-truing.js` |
| Vollkostenschwelle des P4b-Guards | `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` — **zwei Werte, ein Ausloeser (Entscheidung 5): Default 10 EUR-Cent**, solange der Assistant-Pfad im Code steht (10,4 **USD**-ct/min der teuersten AKTIVIERBAREN Konfiguration, zum Kurs 0,92 = 9,568, aufgerundet); **5 EUR-Cent erst NACH vollzogenem Rueckbau** (5,4 x 0,92 = 4,968, aufgerundet). Die Einheit ist die von `voiceTariffDomesticCents`, also EUR. **Ausloeser fuer die Senkung ist der gemergte Rueckbau, nicht die Absicht** — eine Owner-Entscheidung entfernt keinen Code-Pfad. Stufe **WARN**, kein `exit(1)` — Praezedenz `warnUnpricedModels` (`boot.js:70-81`); feuert nur in Konjunktion mit `COST_TRUING_MIN_COVERAGE_PERCENT`, ueberwacht also die gefaehrliche Kombination und **nicht** Vorbedingung 1 allein | `config.js`, `boot-guard.js` |
| Decke aus dem Plan | `planCapCents(planSlug, cfg)` | **`billing/plan-caps.js`** (NICHT `plans.js` — Modulvertrag + Spiegelpflicht) |
| Deckel-Basissatz (Konfiguration!) | `voiceCapRateCentsPerMin` / `VOICE_CAP_RATE_CENTS_PER_MIN` (Default 6) | `config.js` |
| Kopffreiheit je Plan | `planCapHeadroom` — **entschieden (Entscheidung 2): Starter 5/3, Business 5/4 -> 300 / 900 ct**. Gefuehrt als ganzzahliger Bruch (Zaehler/Nenner), NICHT als Dezimalzahl: die Schreibweisen 1,6667 / 1,25 sind gerundete Darstellungen, und `30 * 6 * 1.6667` ergaebe 300,006 (G26 auf dem Geld-Pfad). `planCapCents` multipliziert zuerst und dividiert genau einmal am Ende. Bezugsbasis ist IMMER `voiceCapRateCentsPerMin`=6, nicht die gemessenen 5,4. Gegenprobe: 30x6x5/3 = 300, 120x6x5/4 = 900 | `billing/plan-caps.js` |
| Riegel gegen die inerte Tenant-Achse | **Zwei Linien, kein Wurf:** (1) `spendCapCoherence` prueft die abgeleiteten Decken **aller** Slugs aus `plans.js` gegen `platformSpendCapCents` — **fatal**, Muster `TENANT_DEFAULT_INERT` (`boot-guard.js:101-112`), greift ohne jede gesetzte Zeile; (2) Clamp auf `platformSpendCapCents` + WARN an der Schreibkante, plus die Nachlese-Klausel ueber gesetzte `tenant_budget`-Zeilen. Ein Wurf ist hier verboten — `setTenantSubscription` liegt vor Karten-Bindung und Provisioning (`webhook.js:213`) | `billing/plan-caps.js`, `boot-guard.js` |
| TTS-Zeichenzaehler | `ttsCharacterCount`, `ttsQuotaCycleKey` | `state-ops.js`, `schema.sql` |
| TTS-Kontingent | `TTS_CHARACTER_QUOTA` (39981), `TTS_CHARACTER_QUOTA_WARN_PERCENT` (75) | `config.js` |
| Plattform-Fixkosten (nur Anzeige) | `PLATFORM_FIXED_COST_CENTS_PER_MONTH`; `NUMBER_MONTHLY_COST_CENTS` (**Default 92 EUR-Cent** je Nummer = 1,00 USD Listenpreis x 0,92, belegt aus `GET /v2/available_phone_numbers` -> `cost_information.monthly_cost`, Kap. 2.4). Gepflegte Konfiguration, kein Live-Abruf im Startpfad; Listenpreis, nicht Rechnungsposten — deshalb Anzeige und **nie** ein Gate (Entscheidung 6) | `config.js` |

**Nicht neu erfunden, aus der Budget-Achsen-Kette uebernommen:** `isBookableCents`,
`spendMonthKey`, `spendMonthCostCents`, `spendMonthUsageCents`, `gateUsageCents`,
`gatePlatformUsageCents`, `platformSpendCapCents`, `BUDGET_MONTH_ENABLED`,
`PLATFORM_ALERT_SMS_TO`, Audit-Gruende `budget_tenant` / `budget_platform` /
`reserve_ueber_rest` / `reserve_erschoepft` / `usage_korrupt`.
