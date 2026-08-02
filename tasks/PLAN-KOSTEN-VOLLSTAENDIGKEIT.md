# PLAN-KOSTEN-VOLLSTAENDIGKEIT

Grundlage: `tasks/kosten-inventar.md` (Stand 2026-07-31). Dieser Plan schliesst die dort
belegten Luecken. Er aendert keinen Tarif, keine Marge und kein Preismodell - er sorgt
dafuer, dass jede Kosten-Art, die real anfaellt, bei dem Tenant ankommt, der sie verursacht,
und zwar auf der Achse, die das Budget-Gate liest.

---

## Befund

Auf der Gate-Achse (`usage.spendMonthCostCents`, gelesen von `budgetExceeded`
`store/state-ops.js:2613`) landen von einem **Outbound**-Anruf nachweislich alle
Telnyx-Kosten - der durchgerechnete Anruf `call_ms8nfsbk7cck` trifft die Provider-Rechnung
auf den Mikro-Cent (9424210 Provider-Mikro-Cent = 0,0942421 USD, Inventar Abschnitt 3). Bei
einem **Inbound**-Anruf erreicht dagegen KEINE Carrier-Kostenart das Gate: Sofortbuchung
(`billing/metering.js:111`) und Ist-Abgleich (`billing/cost-truing.js:76`) filtern beide hart
auf `outbound`; gedeckt ist nur der KI-Token-Anteil. Daneben stehen vier kleinere Luecken -
SMS-Kosten erreichen nur den Stripe-Ledger, die DID-Monatsmiete wird fuer 3 von 3 Nummern
nie gebucht, der Play-TTS-Pfad hat repo-weit keinen Preis-Parameter, ein abgebrochener
KI-Turn wird nicht nachgebucht - sowie eine stillgelegte Rechnungsseite: 138 von 138
`usage_event`-Zeilen tragen `stripe_meter_sent = false`, der Flush-Endpunkt hat keinen
Ausloeser.

---

## Nachgemessen fuer diesen Plan

Das Inventar ist die Grundlage; die folgenden fuenf Punkte sind eigene Messungen dieses
Plans, weil die Phasen sonst auf Vermutungen stuenden. Alle read-only (Prod-Postgres per
`psql`, FORCE-RLS je Tenant, plus `grep`/`sed` im Quelltext).

**N1 - Inbound-Minuten sind bepreist und liegen im Ledger, nur nicht auf der Gate-Achse.**
Zwei Belege, beide mit `estimated_cost_cents = NULL` und `actual_cost_micro_cents = NULL` am
Call:

| Tenant | Call | Dauer | `usage_event` | Gate-Achse |
|---|---|---|---|---|
| `owner` | inbound, 2026-07-10 | 15,3 s | `voice_minute`, quantity 1, **300 ct** | 0 |
| `t_user_01KX6008…` | `call_mrntu643cvc2`, 2026-07-16 | 88,5 s | `voice_minute`, quantity 2, **600 ct** | 0 |

Erzeuger ist `recordVoiceMinuteMeter` (`billing/metering.js:93-102`), das **richtungsblind**
schreibt; der Preis kommt aus `callTariffCentsPerMin` (`metering.js:41-44`), das fuer Inbound
ausdruecklich `tariffCentsPerMin(call.to, call.to)` liefert. Die 900 ct sind unser
Worst-Case-Tarif von damals (300 ct/min), **nicht** ein gemessener Provider-Betrag - die
Ist-Kosten eines angenommenen Inbound-Anrufs bleiben ungemessen (U1). Die Aussage ist
trotzdem hart: fuer Inbound existiert bereits eine bepreiste Buchung, sie erreicht nur die
Gate-Achse nicht.

**N2 - Inbound wird vom Kosten-Gate gesperrt, speist es aber nicht.**
`routes/voice.js:274` weist einen eingehenden Anruf ab, sobald `store.budgetExceeded(tenantId,
…)` wahr ist. Dieselbe Achse, die Inbound sperren kann, bekommt von Inbound keinen einzigen
Carrier-Cent. Die Asymmetrie laeuft in beide falschen Richtungen: der Kunde verliert die
Funktion, fuer die er zahlt, und die Kosten, die er dabei erzeugt, zahlt jemand anders.

**N3 - `PAYMENT_ENABLED` ist live `true` (loest einen Teil von U6).**
`meterAiTokens` (`llm-usage.js:36-37`) und der Aufruf von `recordVoiceMinuteMeter`
(`telephony/call-finish.js:52`) laufen beide nur bei `config.billing.paymentEnabled`. In Prod
existiert ein `voice_minute`-Event mit `occurred_at = 2026-07-31T07:57:43.135Z` und ein
`ai_token`-Event von 07:57:49 - also aus dem heutigen Betrieb. Der Metering-Pfad ist scharf.
Damit ist die Rechnungsseite kein schlafender Code, sondern ein geladener Pfad ohne
Ausloeser.

**N4 - Die Deckungsquote von 23 % misst den falschen Nenner.**
`costTruingCoveragePercent` (`billing/cost-truing.js:131-136`) rechnet
`proven / alle beendeten Outbound-Calls`. In Prod (alle drei Tenants, Stand vor dem Anruf
`call_ms8t87whrxqo` am 2026-07-31 10:38 UTC):

| | Anzahl | belegbar? |
|---|---|---|
| beendet, outbound, gesamt | 31 | Nenner heute |
| davon nie beantwortet (`answered_at IS NULL`) | 9 | nein - es gibt nichts zu belegen |
| davon beantwortet, aber ohne `estimated_cost_cents` (alle 2026-07-10 bis 07-19, vor LCT-P2) | 14 | nein - `cost_trued_source = no_estimate` |
| davon mit Schaetzung und Beleg | 8 | ja - **8 von 8 belegt** |

(9 + 14 + 8 = 31, geht exakt auf. Die 9 zerfaellt je Tenant: `owner` 1, `t_user_01KX6008…` 6,
`t_user_01KXH2B…` 2.)

Die erreichbare Quote betraegt heute also **25 %** (`floor(8/31)`), die Schwelle steht auf 80
(`COST_TRUING_MIN_COVERAGE_PERCENT`, `config.js:552`). Die Warnung kann nicht gruen werden,
bis die Altzeilen nach `RETENTION_DAYS=30` (`config.js:1072`) herausfallen. Sie ist damit
keine Aussage ueber unsere Belegdichte, sondern ueber unser Datenalter - und sie haelt
zugleich `voiceTariffFloorFindings` (`boot-guard.js:200-211`) dauerhaft im Zweig "duenne
Deckung". Die Inventar-Formulierung "77 Prozent bleiben auf der Schaetzung stehen" (L7) ist
in dieser Form falsch: von den Calls, die ueberhaupt einen Beleg haben koennen, haben ihn
alle.

**N5 - Repo-Realitaet Migration: DDL laeuft automatisch, der Backfill nicht.**
Die Vorgabe "Migrationen laufen NICHT automatisch, jede neue Spalte muss vor dem Deploy von
Hand angelegt werden" ist am Code und an der Prod-DB **widerlegt** und wird in diesem Plan
korrigiert:

- `store/pg.js:74` ruft `migrate(client, BOOTSTRAP_TENANT_ID)` unbedingt aus `init()`;
  `init()` wird in `store.js:44` awaited, und `store.js:56-66` beendet den Prozess mit
  `exit(1)`, wenn es wirft. Die Kette ist damit beweisend: **der Dienst laeuft, also ist
  `applySchema` auf der Live-DB erfolgreich durchgelaufen.**
- `migrate` ruft `applySchema` (`db/migrate.js:20-23`), das `db/schema.sql` als Skript
  ausfuehrt. Diese Datei enthaelt **66** `ADD COLUMN IF NOT EXISTS`-Anweisungen.
- Stichprobe an der Prod-DB: `call.actual_cost_micro_cents`, `call.consults`,
  `call.estimated_cost_spend_month_key`, `call.estimated_cost_period_key` sind alle
  vorhanden.

Was **nicht** automatisch laeuft, ist die Datenheilung: ein additiv-nullables Feld bleibt
NULL, bis jemand es fuellt. Genau das ist die Wurzel von L4 (`number.monthly_cost_cents` ist
seit dem `ALTER` in `schema.sql:493` bei 3 von 3 Nummern leer). Fuer die Phasen heisst das:
**Spalte anlegen = Zeile in `schema.sql`, kein Handgriff. Backfill = eigener, benannter,
verifizierter Schritt in derselben Phase.**

**N6 - Die beiden `number_month`-Belege sind keine Miete.**
Beide Zeilen (je 500 ct, 2026-07-10 und 2026-07-24) tragen `number_id = NULL` und stehen 2
bis 4 Sekunden nach dem Anlegen der jeweiligen Nummer. Der einzige heutige Schreiber
(`metering.js:153-165`) setzt `numberId` immer - es ist sein Idempotenz-Anker. Diese Zeilen
stammen also aus einem aelteren Pfad und sind der Groesse nach die einmalige
Einrichtungsgebuehr, nicht eine wiederkehrende Miete. **Wiederkehrende DID-Miete wurde noch
nie gebucht, fuer keine Nummer.**

---

## Die gemeinsame Wurzel

Es gibt **zwei Kostenbuecher und keine Kante zwischen ihnen.**

| | Buch A: Verbrauchs-Ledger | Buch B: Gate-Achse |
|---|---|---|
| Speicher | `usage_event` (append-only) | `usage.costCents` / `usage.spendMonthCostCents` |
| Einziger Schreiber | `recordUsageEvent` (`state-ops.js:2698-2725`) | `bookCents` (`state-ops.js:2212`) ueber drei Einstiege: `trackUsage` (`:2243`), `addUsageCostCents` (`:2268`), `applyCreditCents` (`:2386`) |
| Zweck | Stripe-Meldung, Belegkette | Sperrentscheidung (`budgetExceeded` `:2613`) |
| Beruehrt das jeweils andere Buch | nein - reiner `push` auf `s.usageEvents` | nein |

Weil es keine Kante gibt, muss **jede Kosten-Art zweimal von Hand verdrahtet werden**, und
die beiden Verdrahtungen bekommen unabhaengig voneinander ihre eigenen Bedingungen. Der
Beweis steht auf zwei aufeinanderfolgenden Zeilen:

```
telephony/call-finish.js:52   if (config.billing.paymentEnabled) metering.recordVoiceMinuteMeter(call);   -> Ledger, BEIDE Richtungen
telephony/call-finish.js:53   metering.reconcileOutboundVoiceBudget(call);                                -> Gate, NUR outbound (metering.js:111)
```

Dieselben Kosten desselben Anrufs, zwei Schreibvorgaenge, zwei verschiedene Filter. Genau in
dieser Differenz liegt N1.

Die Divergenz laeuft in **beide** Richtungen, das ist kein Inbound-Sonderfall:

| Kosten-Art | Buch A (Ledger) | Buch B (Gate) | Fundstelle |
|---|---|---|---|
| Voice-Minuten outbound | ja | ja | `metering.js:93` / `:110` |
| Voice-Minuten **inbound** | **ja (bepreist, N1)** | **nein** | `metering.js:93` / `:111` |
| KI-Tokens | ja, aber **auf 0 gerundet** | ja (Mikro-Cent-Carry) | `llm-usage.js:36-45` / `state-ops.js:2686` |
| **Recherche-Gebuehr** | **nein** | ja | `llm-usage.js:91-94` |
| SMS | ja, Preis-Default **0** | **nein** | `call-finish.js:116` / `config.js:655` |
| DID-Monatsmiete | nein (Preis `null`, fail-closed) | **nie vorgesehen** | `metering.js:141-156` |
| Play-TTS-Zeichen | nein | nein - **es existiert kein Preis-Parameter** | `state-ops.js:2993-3021` |

Die Wurzel hat drei Gesichter, aber es ist eine:

1. **Kein Ort, an dem eine Kosten-Art entsteht.** Kosten sind im Repo kein Ereignis, sondern
   zwei unabhaengige Schreibvorgaenge an einer Aufrufstelle. Vollstaendigkeit ist damit eine
   Eigenschaft der Sorgfalt, nicht der Struktur.
2. **Der Filter sitzt an der Buchung, nicht am Entstehen.** `if (call.direction !== "outbound")
   return;` steht in der Buchungsfunktion. Die Kosten entstehen trotzdem.
3. **Ein fehlender Preis ist lautlos eine 0.** `smsCostCents` faellt auf 0 zurueck
   (`config.js:655`, `min: 0`), `monthlyRentCents` liefert `null` und bucht dann gar nichts
   (`metering.js:141-156`), Play-TTS hat gar keinen Parameter. In allen drei Faellen ist
   "kostet nichts" von "wird nicht erfasst" nicht unterscheidbar - und nichts schlaegt an.

Das Muster fuer die Behebung existiert bereits, aber nur an genau einer Stelle:
`bookTokenUsage` (`llm-usage.js:64-68`) bucht in EINER Funktion beide Achsen und ist genau
deshalb die einzige Kosten-Art, die bei Inbound wie bei Outbound zuverlaessig ankommt. Dieser
Plan verallgemeinert dieses Muster, statt fuenf Einzelfaelle zu flicken.

---

## Phasen

Miss-Phasen vor Bau-Phasen. Eine Phase = ein abgeschlossener Schritt mit eigenem Merge.

```
KV-P0  Flush-Stichtag                     <- Schutz, sofort, unabhaengig
KV-M0  Live-Konfiguration ins Boot-Banner <- entsperrt jede Zahl danach
   |
KV-M1  Kontroll-Inbound vermessen (OWNER) -+
KV-M2  Ist-DID-Miete aus der Rechnung      +- unabhaengig voneinander
KV-M3  Deckungsquote: richtiger Nenner    -+
KV-M4  Monatliche Gegenprobe (Beobachtung) <- der einzige Schutz gegen UNBEKANNTE Luecken
   |
KV-P1  Kosten-Landkarte als Struktur      <- Vorbedingung ALLER Bau-Phasen
   |
KV-P2  Inbound-Sofortbuchung   (braucht KV-M1)
KV-P3  Inbound-Ist-Abgleich    (braucht KV-P2)
KV-P4  DID-Miete + Backfill    (braucht KV-M2)
KV-P5  SMS-Preis fail-closed
KV-P6  Ledger in Mikro-Cent
KV-P7  Latente Pfade verriegeln (Play-TTS, Realtime, ElevenLabs-Kontingent-Zaehler)
KV-P8  Abgebrochener KI-Turn   (braucht U4)
KV-P9  Stripe-Weiterbelastung  <- GEPARKT bis Owner-Entscheidung 2
```

---

### KV-P0 - Flush-Stichtag: die 138 Altzeilen koennen nicht mehr abgerechnet werden

**Zweck.** Heute liegen 138 nie gemeldete `usage_event`-Zeilen bereit, darunter die zwei
Inbound-Minuten aus N1 (300 und 600 ct, gerechnet mit dem alten 300-ct-Worst-Case-Tarif) und
zwei als `number_month` etikettierte Einrichtungsgebuehren (N6). `POST
/api/billing/flush-meters` (`routes/api-billing.js:42-48`) hat keinen Ausloeser, ist aber
scharf: `PAYMENT_ENABLED` ist live `true` (N3), der Endpunkt liegt hinter Basic-Auth und
meldet bei EINEM Aufruf alles auf einmal an Stripe. Das ist keine theoretische Gefahr,
sondern ein Ein-Klick-Fehlbetrag.

**Umfang.** Ein Stichtag im Code (kein Datenschreiben in Prod): `flushMeters` meldet nur
Ereignisse mit `occurredAt >= BILLING_FLUSH_EPOCH`. Fehlt der Wert, wird **nichts** gemeldet
(fail-closed) - nicht "alles".

**Aufwand.** S.
**Abnahme.** Test: Ledger mit Zeilen vor und nach dem Stichtag, `flushMeters` meldet
ausschliesslich die spaeteren; `sent` zaehlt die richtige Zahl. Zweiter Test: ohne gesetzten
Stichtag ist `sent === 0`. Mutationsprobe: Stichtag entfernen -> Test rot.
**Rollback.** Env-Wert loeschen; Wirkung ist dann "meldet nichts", nie "meldet alles".
**DB.** Keine Spalte, kein Backfill.

---

### KV-M0 - Live-Konfiguration im Boot-Banner (loest U6)

**Zweck.** Fuenf Werte, die jede Zahl dieses Plans traegt, sind heute nicht lesbar:
`SMS_COST_CENTS`, `COST_TRUING_REQUIRED_RECORD_TYPES`, `CLAUDE_MODEL`,
`PRECALL_BRIEFING_MODEL`, `ELEVENLABS_PLAY_TTS_ENABLED`. Es gibt kein Render-Lesetool fuer
Env-Werte. `PAYMENT_ENABLED` ist mit N3 bereits erledigt und gehoert trotzdem ins Banner,
damit die naechste Untersuchung nicht wieder ueber Ledger-Zeilen rueckschliessen muss.

**Umfang.** Das bestehende Boot-Banner (`boot.js:436-440`, zeigt heute schon
`BUDGET_MONTH_ENABLED`, `VOICE_ENGINE` und die drei Kosten-Decken) bekommt diese Werte dazu.
**Keine Secrets** - nur Zahlen, Booleans, Modell-IDs und Typenlisten.

**Aufwand.** S.
**Abnahme.** Test, der die Banner-Zeile gegen die aufgeloeste Config haelt (nicht gegen
`process.env`), plus ein Test, der die Banner-Ausgabe auf Secret-Muster greppt (`sk_`,
`KEY`, Bearer-Fragmente) und rot wird, wenn eines auftaucht.
**Rollback.** Zeile entfernen; reine Ausgabe, kein Verhalten.
**DB.** Keine.

---

### KV-M1 - Ein kontrollierter Inbound-Anruf, vollstaendig vermessen (loest U1) - OWNER

**Zweck.** Die Inbound-Luecke ist strukturell zweifelsfrei belegt, ihre **Groesse nicht**.
Ohne diese Messung waehlt KV-P2 einen Inbound-Tarif nach Gefuehl - genau der Fehler, der die
Outbound-Seite einmal um Faktor 37 danebenliegen liess.

**Umfang.** Eine Hand-Messung, kein Code:

1. Eigene DID anrufen, Assistant antworten lassen, **mindestens 2 Minuten** sprechen (die
   Assistant-Gebuehr wird je ANGEFANGENER Minute flat berechnet - eine Minute laesst nicht
   erkennen, ob die zweite pauschal oder anteilig kommt), dann auflegen.
2. `call_control_id` und `telnyx_session_id` aus der `call`-Zeile ziehen.
3. Alle SECHS zuordenbaren Record-Typen fuer diesen Anker abrufen: `sip-trunking`,
   `call-control`, `speech-to-text`, `text-to-speech`, `recording`, `ai-voice-assistant`.
   Massgeblich ist `ASSIGNABLE_COST_RECORD_TYPES`
   (`telephony/adapters/telnyx/voice.js:152-154`), nicht die Rohliste in `:50-53` - die
   enthaelt zusaetzlich `inference`, das strukturell keinem Call zuordenbar ist
   (`voice.js:143`), und faellt deshalb aus der Summe.
4. Dieselbe Rechnung wie in Inventar-Abschnitt 3 aufmachen: Provider-Summe gegen
   `usage_event` gegen Gate-Achse.

**Aufwand.** S. **Eigenkosten der Messung: ein Anruf, groessenordnungsmaessig 10 US-Cent** -
das ist die Obergrenze, sie ist bekannt und gedeckelt.
**Abnahme.** Eine Zahl: USD je angefangener Inbound-Minute, aufgeschluesselt nach den sechs
Typen (inklusive `speech-to-text`, auch wenn dessen Beitrag am Assistant-Pfad erwartbar 0 ist -
siehe Inventar K19). Plus die Feststellung, ob `sip-trunking` inbound tatsaechlich mit der beobachteten
Rate 0,0032 USD/min abrechnet (das Feld war am nicht angenommenen Anruf belegt, der Betrag
nie).
**Rollback.** Entfaellt (Messung).
**Risiko.** Die Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde (DE-DID
oder US-DID, Assistant-Pfad an). Der Konfigurationsstand gehoert in das Ergebnis, sonst
wird eine Zahl spaeter falsch verallgemeinert.

---

### KV-M2 - Ist-Miete je DID aus der Telnyx-Rechnung (loest U2) - OWNER

**Zweck.** `monthly_cost_cents` ist bei 3 von 3 Nummern leer, und `monthlyRentCents`
(`metering.js:141-143`) bucht fail-closed nichts ohne gelernten Preis. Der Owner hat am
2026-07-27 verbindlich festgelegt: **nur der beim Kauf uebernommene Provider-Preis ist die
Miete** - kein Fallback auf die Einrichtungsgebuehr, kein `NUMBER_MONTHLY_COST_CENTS`, keine
Schaetzung. `NUMBER_MONTHLY_COST_CENTS` (`config.js:712`, Default 92) existiert weiterhin,
ist aber ausdruecklich Anzeige-Listenpreis (`api-billing.js:112-126`, `listPriceNotBilled:
true`) und darf den Backfill NICHT speisen.

**Umfang.** Rechnungs-PDF ueber die `file_id` aus `/v2/invoices` beziehen und die
DID-Positionen je Nummer auslesen. Kein GET-Endpunkt liefert die Miete je gekaufter Nummer -
`/v2/phone_numbers` und `/v2/number_orders` haben kein Preisfeld.

**Aufwand.** S.
**Abnahme.** Drei Betraege, je Nummer, mit Rechnungszeitraum und Waehrung. Findet sich die
Position nicht, ist das Ergebnis "ungemessen, Grund: X" - **kein** Ersatzwert aus dem
Listenpreis.
**Blockiert.** KV-P4.

---

### KV-M3 - Die Deckungsquote misst, was belegbar ist

**Zweck.** N4: die Quote ist heute strukturell rot und darum wirkungslos. Eine Warnung, die
nie gruen werden kann, wird zur Tapete - und sie haelt zusaetzlich
`voiceTariffFloorFindings` (`boot-guard.js:200-211`) dauerhaft im Zweig "duenne Deckung".

**Umfang.** Der Nenner von `costTruingCoveragePercent` (`cost-truing.js:131-136`) wird auf
die Calls beschraenkt, die ueberhaupt einen Beleg haben koennen: beantwortet, mit
persistierter Schaetzung, beendet innerhalb des Provider-Belegfensters. Die
herausgenommenen Gruppen verschwinden nicht, sondern bekommen **eigene Zaehler in derselben
Log-Zeile** (`ohne_schaetzung=`, `nie_beantwortet=`, `ausserhalb_fenster=`) - sonst tauscht
die Phase eine unbrauchbare Zahl gegen eine geschoenigte.

**Aufwand.** S/M.
**Abnahme.** Mit dem heutigen Prod-Datenbestand ergibt die neue Formel **8/8 = 100 %**, die
alte 25 %; ein Test mit genau dieser gemischten Fixture pinnt beide Zahlen. Mutationsprobe:
alte Definition einsetzen -> Test rot.
**Nebenwirkung, die benannt werden MUSS.** Sobald die Quote ueber
`COST_TRUING_MIN_COVERAGE_PERCENT` liegt, verstummt der Tarif-Untergrenzen-Hinweis. Das ist
kein geschwaechtes Gate (es ist eine WARN-Meldung, kein Sperrpfad), aber es ist eine
Verhaltensaenderung an einer Kosten-Sicherung und gehoert in `PLAN-SECURITY.md` und in
Owner-Entscheidung 5.
**Rollback.** Formel zurueckdrehen; keine Datenwirkung.
**DB.** Keine.

---

### KV-M4 - Monatliche Gegenprobe: Provider-Rechnung gegen gebuchte Summe (Beobachtung)

**Zweck.** Alle anderen Phasen schliessen **bekannte** Luecken. Diese eine schuetzt gegen
die naechste unbekannte - und ist damit die einzige, die die Wurzel selbst adressiert. Ohne
sie faellt derselbe Befund in einem Jahr mit einer anderen Kosten-Art erneut an, und wieder
merkt es niemand.

**Umfang, bewusst klein.** Ein Lesepfad, der einmal je Kalendermonat drei Zahlen
nebeneinanderstellt und **nur loggt**:

1. Telnyx-Monatssumme aus `/v2/invoices` (existiert, Monats-Rollup, keine DID-Aufschluesselung
   noetig - hier zaehlt die Summe),
2. Summe aller `actual_cost_micro_cents` unserer Calls des Monats,
3. Summe der auf die Gate-Achse gebuchten Carrier-Betraege des Monats.

Faellt (1) merklich ueber (2), gibt es eine Kosten-Art, die wir nicht abrufen. Faellt (2)
merklich ueber (3), gibt es eine Kosten-Art, die wir abrufen aber nicht buchen. Genau diese
zwei Fragen beantwortet heute nichts.

**Aufwand.** M.
**Abnahme.** Eine Log-Zeile je Monat mit drei Betraegen und zwei Differenzen; ein Test mit
gestellten Zahlen pinnt die Rechnung. **Keine Sperrwirkung, keine Schwelle, kein Alarm in
dieser Phase** - erst wenn drei Monatswerte vorliegen, ist eine Schwelle begruendbar
(Owner-Entscheidung 6).
**Lastbudget.** Ein zusaetzlicher GET je Monat. Er reitet auf dem bestehenden stuendlichen
Sweep-Intervall (`boot.js:547-554`) mit, wie es GAP-06 fuer die DID-Miete vorgemacht hat -
**kein zweiter Timer, keine neue Ressource, kein Render-Cron** (den es auf dem Free Tier
nicht gibt).
**Rollback.** Aufruf entfernen; reine Beobachtung.

---

### KV-P1 - Die Kosten-Landkarte wird Struktur statt Konvention

**Zweck.** Das ist die eigentliche Wurzelbehebung. Solange "eine Kosten-Art muss in beide
Buecher" eine Konvention ist, wird sie wieder vergessen - dafuer gibt es in diesem Repo genug
Praezedenz (G27: Invarianten per Konvention sind die Fragilitaets-Quelle Nr. 1).

**Umfang.** Eine deklarative Tabelle im Code - je Kosten-Art genau eine Zeile mit drei
Pflichtfeldern **ohne Default**:

| Feld | Bedeutung |
|---|---|
| `ledger` | schreibt diese Art einen `usage_event`? |
| `gate` | erreicht diese Art `usage.costCents`? |
| `preisquelle` | woher kommt der Betrag - und was passiert, wenn er fehlt? |

Dazu ein Test, der die Tabelle gegen das tatsaechliche Verhalten faehrt: fuer jede Zeile wird
der Buchungspfad mit einer Fixture ausgeloest und **beide** Buecher werden danach gelesen.
Weicht die Realitaet von der Deklaration ab, ist der Test rot. Und: ein neuer Wert in
`USAGE_EVENT_KIND` (`store/defaults.js:130-135`) ohne Tabellenzeile ist rot.

**Wichtig - diese Phase aendert kein Verhalten.** Sie bildet den IST-Zustand ab, Luecken
inklusive (`inbound: gate=nein`, `sms: gate=nein`, …). Jede folgende Bau-Phase kippt genau
eine Zeile von `nein` auf `ja`, und der Test erzwingt, dass die Realitaet mitkippt. Damit ist
die Tabelle zugleich der Fortschrittsanzeiger dieses Plans.

**Aufwand.** M.
**Abnahme.** Der Test ist gruen gegen den heutigen Bestand (weil er den IST deklariert) und
wird rot, sobald (a) ein Buchungspfad geaendert wird ohne die Deklaration, oder (b) ein neues
`USAGE_EVENT_KIND` ohne Zeile dazukommt. Beides mit Mutationsprobe belegt.
**Rollback.** Test und Tabelle entfernen; kein Produktionsverhalten beruehrt.
**Blockiert.** KV-P2 bis KV-P8.

---

### KV-P2 - Inbound-Carrier-Minuten auf die Gate-Achse (schliesst L1, Hauptluecke)

**Zweck.** Die groesste Luecke mit der schnellsten Weglauf-Geschwindigkeit: die
Hermes-Nummer ist oeffentlich waehlbar, weder das Kosten-Gate noch das
Minuten-Kontingent-Gate (`outbound-gates.js:760`, "Inbound bleibt ungated") bremsen, und die
einzige verbleibende Bremse - der KI-Token-Akku - liegt je Turn im Zehntel-Cent-Bereich,
waehrend allein die Assistant-Gebuehr 5 US-Cent je angefangener Minute kostet.

**Umfang.**

- `reconcileOutboundVoiceBudget` (`metering.js:110-135`) verliert seinen Richtungsfilter und
  seinen Namen; die Funktion bucht dann fuer beide Richtungen. Der Minutensatz kommt aus
  `callTariffCentsPerMin` (`metering.js:41-44`), das den Inbound-Fall bereits kennt - **eine**
  Tarif-Quelle, keine zweite Kopie (G5).
- Der Inbound-Tarif wird an KV-M1 kalibriert. Fehlt der Wert, faellt er fail-closed auf den
  Outbound-Worst-Case zurueck, nie auf 0.
- Der Live-Zaehler aus KS-P2 (`liveVoiceSpendCents`, `metering.js:81-86`) ist heute
  ausdruecklich outbound-only, und `store.activeOutboundCallsFor` ist sein einziger Produzent.
  **Ob er mitzieht, ist eine eigene Entscheidung** (Owner-Entscheidung 3): ein Live-Term auf
  einer Achse, die auch bucht, ist konsistent - aber er legt ein laufendes Inbound-Gespraech
  mitten im Satz auf, und die Kombination mit `voice.js:274` (N2) macht daraus fuer den Kunden
  "meine Nummer ist tot". Ohne ausdruecklichen Owner-Entscheid bleibt der Live-Term
  outbound-only, und Inbound wirkt erst bei Call-Ende.
- `KV-P1`-Zeile `voice_minute/inbound` kippt von `gate=nein` auf `gate=ja`.

**Aufwand.** M.
**Abnahme.** Vier Tests. (1) Ein beendeter Inbound-Call mit 2 Minuten erhoeht
`usage.spendMonthCostCents` um `2 x Inbound-Satz` - Mutationsprobe: Bestand faerbt ihn rot.
(2) `estimated_cost_cents` und die Achsen-Anker (`estimated_cost_spend_month_key`,
`estimated_cost_period_key`) sind an der Inbound-`call`-Zeile gesetzt - sonst kann KV-P3
spaeter nicht korrigieren. (3) Ein nie beantworteter Inbound-Call bucht **nichts**
(`voiceMinutesOf` = 0). (4) Genau EINE Buchung je Call: der `billedAt`-Riegel
(`call-finish.js:49-55`) greift fuer Inbound identisch.
**Absolute Regel 1.** Diese Phase fuegt einer geschuetzten Sicherung Nahrung zu, sie entfernt
keine. Die Sperrwirkung der pro-Tenant-Decke bleibt unveraendert - inklusive der in CLAUDE.md
festgehaltenen Aussage, dass sie BEIDE Richtungen sperrt.
**Rollback.** Richtungsfilter wieder einsetzen. Bereits gebuchte Inbound-Cents bleiben stehen
(sie sind korrekt) - das ist kein sauberer Zustand fuer eine Wiederholung, deshalb: KV-P2 nur
mergen, wenn KV-M1 vorliegt.
**DB.** Keine neue Spalte (`estimated_cost_cents` und beide Anker existieren, `schema.sql:221-222`,
`:292-293`). Kein Backfill: die zwei historischen Inbound-Calls bleiben ungebucht und werden
im Phasenbericht ausdruecklich so gefuehrt.
**PLAN-SECURITY.md.** Neue Kante eintragen.

---

### KV-P3 - Inbound in den Ist-Abgleich (schliesst die zweite Haelfte von L1)

**Zweck.** Nach KV-P2 traegt Inbound eine Schaetzung. Ohne Ist-Abgleich bleibt sie stehen -
und die Schaetzung liegt bei Outbound gemessen systematisch **ueber** dem Ist (alle vier
beobachteten Korrekturen negativ). Bei Inbound wuerde das den Kunden dauerhaft zu hoch
belasten.

**Umfang.** `isEndedOutbound` (`cost-truing.js:76`) und `isTruingCandidate` (`:165-171`)
verlieren den Richtungsfilter. Der Provider-Adapter kann das bereits: die Zuordnung laeuft
ueber `call_control_id`-Anker und Session-Felder (`voice.js:138-154`), beides
richtungsunabhaengig.

**Aufwand.** M.
**Abnahme.** Test: ein beendeter Inbound-Call mit gestellten Provider-Records bekommt
`cost_trued_at`, `actual_cost_micro_cents` und eine Delta-Buchung; ein zweiter Sweep bucht
NICHT erneut (`costTruedAt !== null`). Live-Verifikation: der Anruf aus KV-M1 laesst sich
nach `COST_TRUING_DELAY_MINUTES` (30) plus einem Sweep-Takt (1 h) im Log als korrigiert
nachweisen.
**Reihenfolge.** Hart nach KV-P2: eine Korrektur ohne Schaetzung landet in `no_estimate`
(exakt der Zustand der 14 Altzeilen aus N4) und tut nichts.
**Wechselwirkung mit KV-M3.** Die Inbound-Calls kommen in den Deckungs-Nenner. Der Nenner aus
KV-M3 traegt das (er filtert auf "belegbar", nicht auf "outbound") - der Test aus KV-M3 wird
um einen Inbound-Fall erweitert.
**Rollback.** Filter zurueck; bereits korrigierte Calls bleiben korrekt.

---

### KV-P4 - DID-Monatsmiete: Preis lernen, Bestand backfillen (schliesst L4)

**Zweck.** 3 von 3 Nummern ohne Preis, seit bis zu fuenf Wochen. Der stuendliche Sweep laeuft
nachweislich (`boot.js:551-553`) - er hat nichts zu buchen. Das ist der Lehrbuchfall aus N5:
additiv-nullables Pflichtfeld ohne Backfill.

**Umfang, zwei Teile, beide in dieser Phase:**

1. **Neukauf lernt den Preis.** Der Provisioning-Pfad uebernimmt den Provider-Preis in
   `number.monthlyCostCents`. Faellt er nicht an, wird die Nummer **mit einem sichtbaren
   Befund** angelegt, nicht still ohne Preis.
2. **Backfill der drei Bestandsnummern** aus KV-M2 - ein benannter, einmaliger, idempotenter
   Schritt (Muster `backfillPeriodStart`, `db/migrate.js:38-51`: laeuft bei jedem Boot, findet
   nach dem ersten Lauf 0 Zeilen). **Nicht** als Handgriff in `psql`, sondern als
   reviewbarer, wiederholbarer Code - ein Einmal-SQL-Kommando in einer Konsole ist genau der
   Schritt, der beim naechsten Mal vergessen wird.

Die Miete rueckwirkend nachzubuchen ist **nicht** Teil der Phase (Owner-Entscheidung 4).

**Aufwand.** M.
**Abnahme.** Nach dem Deploy tragen alle drei Nummern einen Preis (`SELECT id,
monthly_cost_cents FROM number`), und im naechsten Kalendermonat existiert je Nummer genau
eine `number_month`-Zeile **mit gesetzter `number_id`** (das unterscheidet sie von den zwei
Altzeilen aus N6). Test: zweimaliger Sweep im selben Monat erzeugt genau einen Beleg je
Nummer.
**Rollback.** Backfill-Schritt entfernen; die Spalte bleibt gefuellt - das ist gewollt, der
Preis ist eine Tatsache und keine Meinung.
**DB.** Spalte existiert (`schema.sql:493`). **Backfill ist Pflichtbestandteil**, sonst
wiederholt die Phase den Fehler, den sie behebt.

---

### KV-P5 - SMS: ein fehlender Preis darf keine 0 sein (schliesst L3)

**Zweck.** `smsCostCents` faellt auf 0 zurueck (`config.js:655`, `min: 0`), und
`recordUsageEvent` schreibt diese 0 klaglos in den Ledger. Die einzige Schranke ist eine
reine Stueckzahl-Kappe (Default 20 pro 24 h), die bei teuren Auslandszielen dasselbe erlaubt
wie bei inlaendischen.

**Umfang.**

- Messung zuerst, in dieser Phase: eine Test-SMS ausloesen und `record_type=messaging`
  abrufen (U3). Der reale Preis ist heute unbekannt.
- `SMS_COST_CENTS` bekommt eine Untergrenze `> 0`, sobald der Metering-Pfad scharf ist -
  Muster `numberSetupFeeCents` (`config.js:1476`: bei `PAYMENT_ENABLED` Pflicht `> 0`,
  `assertConfig`). Ein Preis von 0 fuer eine real bepreiste Leistung ist ein
  Konfigurationsfehler, kein Betriebszustand.
- Die SMS-Kosten erreichen die Gate-Achse (`KV-P1`-Zeile kippt).

**Aufwand.** S (plus Messung).
**Abnahme.** Test: eine gesendete SMS erhoeht `usage.costCents` um `smsCostCents`;
Boot-Guard-Test: `PAYMENT_ENABLED=true` mit `SMS_COST_CENTS=0` meldet einen Befund.
**Eigenkosten der Messung.** Eine SMS. Bekannt und gedeckelt.
**Rollback.** Untergrenze entfernen.

---

### KV-P6 - Der Ledger fuehrt Geld in Mikro-Cent (schliesst L8)

**Zweck.** 101 von 101 `ai_token`-Zeilen tragen `cost_cents = 0` bei zusammen 210.825
Tokens, weil `aiCostCents` (`state-ops.js:2686`) je Einzelereignis mit `Math.round` rundet,
waehrend `trackUsage` direkt daneben den Mikro-Cent-Rest fortschreibt. Die Gate-Achse ist
davon **nicht** betroffen. Relevant wird die 0, sobald irgendein Bericht diesen Ledger als
Kostenquelle liest - dann ist sie aktive Fehlinformation. Und KV-M4 will genau das tun.

**Umfang.** `usage_event` bekommt `cost_micro_cents` (BIGINT, additiv-nullable); der
Ledger-Schreiber fuellt beide Felder. `cost_cents` bleibt unveraendert - Stripe bekommt
ohnehin die Rohmenge, nicht diesen Wert (`billing/stripe.js`, `payload[value]=quantity`).

**Aufwand.** M.
**Abnahme.** Test: 100 Turns unterhalb eines halben Cents summieren sich in
`cost_micro_cents` auf denselben Betrag, den die Gate-Achse gebucht hat (Abweichung 0, nicht
"ungefaehr"). Genau diese Gleichheit ist die Eigenschaft, die KV-M4 braucht.
**DB.** Neue Spalte -> `ALTER TABLE usage_event ADD COLUMN IF NOT EXISTS cost_micro_cents
BIGINT;` in `db/schema.sql`; laeuft beim naechsten Boot automatisch (N5). **Kein Backfill der
Altzeilen** - sie sind mit 0 gebucht und bleiben es; das gehoert ausdruecklich in den
Phasenbericht, damit nicht in einem halben Jahr jemand die 101 Nullen fuer eine Messung haelt.

---

### KV-P7 - Latente Pfade fail-closed verriegeln (schliesst L5b/5a und L9)

**Zweck.** Zwei latente Pfade sind heute wirkungslos, weil sie aus sind - und werden
gefaehrlich in genau dem Moment, in dem jemand sie einschaltet, ohne diesen Plan zu kennen.
Ein DRITTER Befund ist keine latente, sondern eine LAUFENDE Luecke und braucht deshalb einen
anderen Guard als die beiden anderen.

- **Play-TTS ohne Preis** (`ELEVENLABS_PLAY_TTS_ENABLED`, `config.js:330`, Default `false`):
  zaehlt Zeichen, es existiert repo-weit kein Preis-pro-Zeichen-Parameter. Erschoepft sich das
  Kontingent, degradiert nur die Stimme; es sperrt nichts. (Inventar L5a.)
- **Realtime-Engine** (`bridge.js:287-289`): setzt beim Gespraechsbeginn einen Timer und
  prueft danach nichts mehr; `blockingBudgetAxis` kommt dort nicht vor. Die Budget-Engine
  prueft in jeder Turn-Runde.
- **Der Kontingent-Zaehler wird vom Relay-Verbrauch nie gespeist, unabhaengig vom
  Play-TTS-Flag (Inventar K18/L5b, LAEUFT JETZT).** Ein Boot-Guard, der nur
  `ELEVENLABS_PLAY_TTS_ENABLED` betrachtet, verriegelt die falsche Sache: das eigene
  ElevenLabs-Kontingent wird schon heute ueber den Telnyx-Relay verbraucht
  (`config.telnyx.telnyxElevenLabs`), voellig unabhaengig davon, ob Play-TTS an oder aus ist -
  und `recordTtsCharacters`/`ttsCharacterQuota` (`config.js:685-693`), der einzige Zaehler mit
  einer Erschoepfungswirkung, sieht davon nichts, weil er repo-weit nur vom Play-TTS-Pfad
  aufgerufen wird. Noetig ist NICHT ein weiterer Guard auf das Flag, sondern dass der
  Kontingent-Zaehler ueberhaupt vom Relay-Verbrauch gespeist wird - oder, falls das aus
  dieser Phase herausfaellt, dass er explizit als "nicht gespeist" ausgewiesen wird (z. B. ein
  Boot-Banner-Hinweis "ElevenLabs-Kontingentwarnung deckt den Telnyx-Relay-Pfad NICHT ab"),
  damit niemand aus einem stillen `ttsCharacterQuota` faelschlich Sicherheit ableitet.

**Umfang.** Drei Massnahmen, fail-closed:

1. `ELEVENLABS_PLAY_TTS_ENABLED=true` ohne gesetzten Preis-pro-Zeichen -> Boot-Befund.
2. `VOICE_ENGINE=realtime` ohne Mid-Call-Budget-Pruefung im Realtime-Pfad -> Boot-Befund.
3. Fuer den Relay-Verbrauch (K18): entweder `recordTtsCharacters` bekommt einen zweiten
   Aufrufer aus dem Ist-Abgleich (`cost-truing.js:373` `bookTtsCharactersFor` kennt die
   Zeichenzahl bereits), oder - falls das den Umfang dieser Phase sprengt - ein permanenter,
   unuebersehbarer Boot-Banner-Hinweis, dass die Kontingentwarnung diesen Pfad nicht deckt.
   **Ein stiller Boot-Guard, der nur prueft, ob Play-TTS an ist, erfuellt diesen Punkt NICHT.**

Play-TTS und Realtime werden in dieser Phase **nicht** gebaut. Diese Phase sorgt dafuer, dass
ihr Einschalten laut ist statt still - und dass der bereits laufende Relay-Verbrauch nicht
laenger unter einem Zaehler versteckt bleibt, der ihn strukturell nicht sehen kann.

**Aufwand.** S/M (Punkt 3 ist der neue, groessere Teil).
**Abnahme.** Boot-Guard-Tests fuer 1 und 2, je mit Gegenbeispiel (Flag aus -> kein Befund).
Fuer 3: entweder ein Test, der Relay-Zeichen in `usage.tts_characters`/`platform_tts_usage`
(oder einem neuen Feld) ankommen sieht, oder ein Test, der das Boot-Banner auf den
Deckungshinweis prueft.
**Absolute Regel 1.** Diese Phase fuegt Sicherungen hinzu und macht eine bestehende, blinde
Sicherung ehrlich - sie entfernt keine.
**Rollback.** Guards entfernen - macht die Pfade wieder still einschaltbar, also nur bewusst.

---

### KV-P8 - Abgebrochener KI-Turn (schliesst L6, nach Messung)

**Zweck.** `claude.js:650-659` bucht erst NACH Rueckkehr von `llm.complete(...)`; `llm.js:43-51`
haelt im eigenen Kommentar fest, dass bei erschoepften Retries "mindestens ein Versuch auf der
Leitung war und beim Anbieter Token erzeugt haben kann". Die dafuer gebaute Kompensation
`bookEstimatedTokenUsage` (`llm-usage.js:76-78`) hat repo-weit genau EINEN Aufrufer:
`precall-briefing.js:280`. Der Live-Telefonpfad ruft sie nie.

**Umfang.** Erst U4 beantworten (rechnet Anthropic einen client-seitig abgebrochenen Request
ab? - braucht einen Admin-Key, der vorhandene antwortet mit HTTP 401). Lautet die Antwort
"nein", ist die Phase eine Zeile Dokumentation und faellt weg. Lautet sie "ja", bekommt der
Live-Pfad denselben Aufruf wie der Briefing-Pfad.

**Aufwand.** S.
**Abnahme.** Test: ein `RETRIES_EXHAUSTED`-Wurf im Turn-Pfad erhoeht die Gate-Achse um den
geschaetzten Betrag - und **nicht** den Stripe-Ledger (eine Schaetzung ist kein Kundenbeleg;
dieselbe Abwaegung, die `bookEstimatedTokenUsage` schon dokumentiert).
**Reihenfolge.** Zuletzt. Groessenordnung Zehntel-Cent je Vorfall, nicht willentlich
ausloesbar.

---

### KV-P9 - Stripe-Weiterbelastung (GEPARKT)

**Zweck / Status.** L2 ist real (138 von 138 Zeilen nie gemeldet, kein Cron im
Render-Workspace, 0 Treffer auf `/api/billing/flush-meters` im gesamten abrufbaren
Log-Fenster), aber es ist **keine technische Frage**. Ob nutzungsbasiert weiterbelastet
werden soll, entscheidet der Owner (Entscheidung 2). Bis dahin bleibt die Sperre aus KV-P0
die einzige Massnahme - sie ist genau darauf ausgelegt, diese Frage offen halten zu koennen,
ohne dass ein versehentlicher Aufruf sie beantwortet.

**Falls "ja":** der Ausloeser gehoert an den bestehenden stuendlichen Sweep
(`boot.js:547-554`), nicht an einen neuen Cron - dieselbe Begruendung wie GAP-06.
**Falls "nein":** der Flush-Endpunkt und `stripe_meter_sent` werden ausdruecklich als
"gebaut, bewusst inaktiv" in `README.md` gefuehrt. Ein Mechanismus, der so aussieht, als
liefe er, ist schlimmer als keiner.

---

## Pre-Mortem

Ein Jahr spaeter. Der Plan ist umgesetzt und gescheitert. Was ist passiert?

**TOD 1 - Das Gate sperrt zahlende Kunden aus.** KV-P2 fuettert die Tenant-Decke jetzt auch
aus Inbound. Ein Kunde, dessen Kerngebrauch das Entgegennehmen von Anrufen ist, ist Mitte
des Monats gesperrt - und weil `voice.js:274` Inbound bei erschoepfter Decke abweist (N2),
verliert er nicht nur das Telefonieren, sondern die Erreichbarkeit. Die Decke war fuer
Outbound kalibriert; niemand hat nachgerechnet, was passiert, wenn eine zweite Kostenquelle
auf dieselbe Zahl bucht.
*Gegenmittel:* Das ist der schwerste Einwand gegen KV-P2, und er ist **nicht** durch
Sorgfalt in der Phase zu erledigen - er ist eine Kalibrierung. Pflichtbestandteil des
Phasenberichts: eine Rechnung "verkaufte Minuten x Inbound-Satz aus KV-M1 gegen die
Plan-Decke je Katalog-Tarif", analog zu KS-P3a. Ergibt sie, dass ein Starter-Kunde seine
inkludierten Minuten nicht inbound telefonieren kann, wird die Decke **vorher** angehoben.
KV-P2 laeuft nicht ohne diese Rechnung. Und: Owner-Entscheidung 1 muss beantwortet sein,
bevor eine Zeile Code entsteht.

**TOD 2 - Ein Nutzer wird doppelt belastet.** KV-P2 bucht bei Call-Ende, KV-P3 korrigiert
spaeter, und irgendwo dazwischen laeuft ein zweiter Pfad. Der Kunde bezahlt eine Minute
zweimal.
*Gegenmittel:* Zwei Riegel existieren und werden in KV-P2/KV-P3 als Abnahmekriterium
mitgeprueft, nicht als bekannt vorausgesetzt: der persistierte `billedAt`-Marker
(`call-finish.js:49-55`, ueberlebt einen Neustart) und `costTruedAt !== null`
(`cost-truing.js:166`). Dazu die Struktur: `addVoiceUsageCostCents` hat repo-weit genau EINEN
Aufrufer (`metering.js:129`) - diese Eigenschaft wird von KV-P1 in einen Test gegossen, damit
ein zweiter Aufrufer nicht unbemerkt entsteht.

**TOD 3 - Ein Massenversand an Stripe belastet alle Nutzer rueckwirkend.** Jemand ruft
`/api/billing/flush-meters` einmal auf - beim Debuggen, aus Neugier, per Skript. 138
Ereignisse gehen raus, darunter Inbound-Minuten zum alten 300-ct-Worst-Case-Tarif und zwei
Einrichtungsgebuehren als "Monatsmiete" (N6).
*Gegenmittel:* Genau dafuer ist KV-P0 die erste Phase, und genau deshalb ist ihre
Fail-Richtung "meldet nichts" und nicht "meldet alles".

**TOD 4 - Die Nachbuchung kommt zu spaet, um zu schuetzen.** Der Ist-Abgleich setzt
fruehestens nach `COST_TRUING_DELAY_MINUTES=30` an (`config.js:517`) und laeuft im
Stunden-Takt (`config.js:527`). Bis zu ~1,5 Stunden sieht das Gate nur die Schaetzung.
*Gegenmittel:* Fuer Outbound ist das gemessen unkritisch, weil die Schaetzung 1 ms nach
Gespraechsende gebucht wird (`billed_at` gegen `ended_at` am Ankeranruf) und **ueber** dem
Ist liegt. Fuer Inbound gilt das nach KV-P2 genauso - vorausgesetzt der Inbound-Satz aus
KV-M1 ist konservativ gewaehlt. Deshalb ist die Fail-Richtung von KV-P2 ausdruecklich "im
Zweifel der teurere Satz". Was NICHT gedeckt ist: ein einzelnes sehr langes Inbound-Gespraech
ohne Live-Term (Owner-Entscheidung 3) - das ist ein bewusst getragenes Restrisiko und gehoert
mit Zahl in `PLAN-SECURITY.md`.

**TOD 5 - Die Messung erzeugt selbst Kosten und Last.** KV-M4 ruft Provider-APIs ab, KV-M1
und KV-P5 loesen echte Anrufe und SMS aus, und der Sweep faehrt mehr Abfragen.
*Gegenmittel:* Drei harte Grenzen. (a) KV-M1/KV-P5 sind Hand-Messungen mit bekannter
Obergrenze (ein Anruf, eine SMS). (b) KV-M4 ist **ein** GET je Monat und reitet auf dem
bestehenden Intervall mit - kein zweiter Timer. (c) Der Bruchpunkt-Waechter existiert bereits
(`cost-truing.js:74`, Warnschwelle 1440 Anfragen je Sweep) und faengt eine Abfrage-Explosion
ab. KV-P3 erhoeht die Kandidatenzahl um die Inbound-Calls; der Phasenbericht rechnet das
gegen die Schwelle, statt zu hoffen.

**TOD 6 - Der Backfill fehlt wieder.** KV-P4 laesst den Preis fuer Neukaeufe lernen, aber die
drei Bestandsnummern bleiben leer - dieselbe Bewegung, die die Luecke ueberhaupt erzeugt hat
(P4 ohne Backfill, dann P5 fail-closed). Ein halbes Jahr spaeter faellt derselbe Befund
erneut auf.
*Gegenmittel:* Der Backfill ist **Abnahmekriterium** von KV-P4, nicht Nacharbeit: die Phase
gilt erst als fertig, wenn `SELECT count(*) FROM number WHERE monthly_cost_cents IS NULL`
null liefert. Er wird als idempotenter Code-Schritt gebaut (Muster `backfillPeriodStart`),
nicht als Konsolen-Kommando. Und KV-P1s Deklarationstabelle traegt fuer jede Kosten-Art die
Spalte `preisquelle` - eine Art ohne Preisquelle ist dort sichtbar, statt in einer NULL-Spalte
zu verschwinden.

**TOD 7 - Die Landkarte aus KV-P1 wird zur Tapete.** Der Test deklariert den IST, jemand
aendert einen Buchungspfad, der Test wird rot, und die schnellste Reparatur ist, die
Deklaration nachzuziehen statt die Buchung.
*Gegenmittel:* Ehrlich benannt: dagegen gibt es keinen technischen Schutz. Was hilft, ist die
Form - die Tabelle ist kurz genug, um in einem Review vollstaendig gelesen zu werden, und
jede Zeilenaenderung ist im Diff eine Aussage ueber Geld, nicht ueber Formatierung. Das ist
schwaecher als ein Mechanismus und wird als solches getragen.

**TOD 8 - KV-M3 macht die Warnung gruen, und danach schaut niemand mehr hin.** Die
Deckungsquote springt von 23 % auf 100 %, der Tarif-Untergrenzen-Hinweis verstummt, und ein
echter Belegausfall faellt Monate spaeter auf.
*Gegenmittel:* Die drei herausgenommenen Gruppen bleiben als eigene Zaehler in derselben
Log-Zeile sichtbar (KV-M3, Umfang). Eine Quote von 100 % bei `ohne_schaetzung=14` ist eine
andere Aussage als 100 % bei `ohne_schaetzung=0`, und beide stehen nebeneinander.

---

## Owner-Entscheidungen

Zu beantworten, **bevor** gebaut wird. Keine dieser Fragen laesst sich aus dem Code ableiten.

**1. Sollen Inbound-Carrier-Minuten das Tenant-Budget belasten?**
*Kontext, gemessen:* Sie kosten real Geld (Assistant-Gebuehr 0,05 USD je angefangener Minute
flat, plus SIP, Recording, TTS), sie werden bereits bepreist im Ledger gefuehrt (N1), und die
Decke sperrt Inbound heute schon, ohne von ihm gespeist zu werden (N2).
- *(a) Ja, dieselbe Achse wie Outbound.* Ein Cent ist ein Cent; das Gate wird ehrlich.
- *(b) Ja, aber eigene Inbound-Decke.* Schuetzt die Erreichbarkeit, verdoppelt die Zahl der zu
  pflegenden Decken.
- *(c) Nein, Sundartha traegt Inbound.* Dann muss die Sperre aus `voice.js:274` fallen, sonst
  bleibt die Asymmetrie aus N2 bestehen - und es braucht eine andere Bremse gegen den
  Missbrauchsfall (Nummer dauerhaft anrufen lassen), z. B. ein Inbound-Minuten-Kontingent.
  **ACHTUNG - (c) ist keine gleichrangige Planoption.** Sie ist die Wiederaufnahme der am
  2026-07-30 zurueckgezogenen Entscheidung E11 und beruehrt `CLAUDE.md` Absolute Regel 1
  direkt: "Die pro-Tenant-Kostendecke sperrt weiterhin BEIDE Richtungen, Inbound
  eingeschlossen ... Nicht ohne ausdrueckliche Owner-Entscheidung anfassen." (c) ist damit erst
  waehlbar nach einer schriftlichen Aenderung von `CLAUDE.md` - nicht durch Ankreuzen in
  diesem Plan. Die dort festgehaltene Gegenbegruendung ist vorher zu entkraeften: ein
  Inbound-Gespraech ist nicht kostenlos, die KI-Token buchen in jeder Schleifenrunde live auf
  genau die Achse, die `budgetExceeded` liest (`claude.js:659`, `:775` -> `llm-usage.js:66` ->
  `bookCents`). Wer (c) ankreuzt, ohne das zu wissen, schaltet unbemerkt eine geschuetzte
  Sicherung ab.

*Empfehlung: (a).* Begruendung: Die Luecke ist strukturell, nicht klein, und der Weglauf ist
schnell (oeffentlich waehlbare Nummer, keine Bremse ausser dem KI-Token-Akku im Verhaeltnis
1:20 zur Assistant-Gebuehr). (b) erzeugt eine zweite Zahl, die jemand synchron halten muss -
genau das Muster, an dem der Starter-Bug gescheitert ist (E5a). (c) ist nur vertretbar, wenn
gleichzeitig ein Inbound-Kontingent gebaut wird; ohne das ist es die heutige Luecke mit einem
Etikett. **Bedingung zu (a):** die Decken-Rechnung aus TOD 1 muss zuerst vorliegen, sonst
tauscht diese Entscheidung eine Kostenluecke gegen einen gesperrten Kunden.

**2. Wird Verbrauch ueberhaupt an Stripe weiterbelastet?**
*Kontext:* 138 von 138 Zeilen nie gemeldet, der Pfad war seit Einfuehrung nie erreicht. Das
Tarifmodell ist ein Abo mit Minutenkontingent.
- *(a) Nein - Kontingent-Modell, keine nutzungsbasierte Weiterbelastung.* Dann wird der
  Flush-Pfad als bewusst inaktiv dokumentiert und KV-P9 gestrichen.
- *(b) Ja, fuer Ueberzug.* Dann braucht es einen Ausloeser, eine Ueberzugs-Definition und eine
  Entscheidung ueber die Altzeilen.

*Empfehlung: (a) fuer jetzt, ausdruecklich entschieden.* Begruendung: Es gibt keinen
Bestandskunden-Druck (alle aktiven Accounts sind wir), und ein halb gebauter Abrechnungspfad
ist gefaehrlicher als kein Abrechnungspfad - KV-P0 existiert nur wegen dieser Halbheit. Eine
spaetere Umstellung auf (b) ist billig, sobald KV-P6 den Ledger geldrichtig macht.

**3. Soll der Live-Zaehler (Mid-Call) auch fuer Inbound greifen?**
- *(a) Nein* - Inbound wirkt erst bei Call-Ende. Ein laufendes Gespraech wird nie
  abgeschnitten; die maximale Ueberziehung ist ein Gespraech.
- *(b) Ja* - konsistent mit Outbound, aber ein Anrufer wird mitten im Satz getrennt.

*Empfehlung: (a).* Begruendung: Der Schaden ist beschraenkt (ein Gespraech, gedeckelt durch
die Zeit-Notbremse), und ein aufgelegter Inbound-Anruf trifft nicht den Nutzer, sondern
dessen Anrufer - jemanden, der von unseren Decken nichts weiss. Falls (b): der Live-Term
braucht dann `store.activeInboundCallsFor` als eigenen Produzenten, `liveVoiceSpendCents`
(`metering.js:81-86`) darf seinen Vertrag "nur Outbound" nicht per Kommentar-Aenderung
verlieren.

**4. Wird die DID-Miete rueckwirkend nachgebucht?**
*Kontext:* Der Owner-Tenant haelt seine DE-Nummer seit 2026-06-24 ohne je eine Mietbuchung,
die beiden anderen seit 07-10 bzw. 07-24.
- *(a) Nein, ab Backfill vorwaerts.* Einfach, keine Rueckwirkung auf abgeschlossene Perioden.
- *(b) Ja, ab Kaufdatum.* Ehrlicher, belastet aber Perioden rueckwirkend - genau der
  Mechanismus, gegen den `applyCreditCents` (`state-ops.js:2358-2371`) bewusst riegelt.

*Empfehlung: (a).* Begruendung: Alle drei betroffenen Nummern gehoeren uns selbst; es gibt
keinen Kunden, dem etwas entgeht. Eine rueckwirkende Buchung ueber Periodengrenzen wuerde
gegen die Achsen-Anker arbeiten, die KS-P5 gerade erst eingezogen hat.

**5. Darf KV-M3 die Deckungs-Warnung verstummen lassen?**
*Kontext:* Der neue Nenner ergibt heute 100 %, damit faellt auch `voiceTariffFloorFindings`
aus dem Zweig "duenne Deckung" (WARN, kein Sperrpfad).
- *(a) Ja* - eine Warnung, die strukturell nicht gruen werden kann, ist keine.
- *(b) Nein* - Schwelle stattdessen absenken und alles beim Alten lassen.

*Empfehlung: (a), mit den drei Nebenzaehlern aus TOD 8.* Begruendung: (b) behaelt eine Zahl,
die etwas anderes misst, als ihr Name sagt - und trainiert weiter darauf, die Zeile zu
ueberlesen.

**6. Welche Abweichung in KV-M4 loest kuenftig einen Alarm aus?**
*Nicht jetzt entscheidbar* - es gibt keine drei Monatswerte, gegen die sich eine Schwelle
begruenden liesse. Die Frage wird hier festgehalten, damit KV-M4 nicht als
Dauer-Beobachtung endet. *Empfehlung:* nach dem dritten Monatswert erneut vorlegen, mit den
gemessenen Differenzen.

**7. Gehoeren Plattform-Fixkosten (Stripe-Gebuehr K14, WorkOS K15, Render K16) in diesen
Plan?**
*Empfehlung: nein fuer die Tenant-Achse, ja fuer KV-M4.* Begruendung: Sie sind nicht
verursachungsgerecht zuordenbar (Render ist verbrauchsunabhaengig, die Stripe-Gebuehr haengt
an der Zahlung, nicht am Telefonieren) - eine Umlage waere eine Preisfrage, und Preisfragen
sind ausdruecklich nicht Gegenstand. In der monatlichen Gegenprobe gehoeren sie als eigene
Zeile dazu, sonst sieht die Zahl besser aus, als die Realitaet ist.

---

## Was dieser Plan bewusst NICHT tut

- **Keine Preisgestaltung, keine Tarife, keine Margen.** Der Inbound-Satz aus KV-M1 ist ein
  Kosten-Messwert fuer das Gate, kein Kundenpreis.
- **Keine rueckwirkende Buchung** - weder Inbound-Altcalls noch DID-Miete vor dem Backfill
  (Owner-Entscheidung 4). Die zwei historischen Inbound-Calls bleiben ungebucht und werden so
  dokumentiert.
- **Kein Umbau der Plattform-Achse.** `MAX_BUDGET_EUR` ist seit E10 Beobachtung; dieser Plan
  aendert daran nichts.
- **Kein Bau der latenten Pfade.** KV-P7 verriegelt Play-TTS und Realtime, es baut sie nicht;
  der ElevenLabs-Kontingent-Zaehler (K18) ist die eine Ausnahme, wo KV-P7 selbst eine Kante
  speist statt nur zu verriegeln - siehe dort.
- **Keine Sicherung wird entfernt oder aufgeweicht.** Jede Phase fuegt hinzu oder speist eine
  vorhandene Achse. Zwei Ausnahmen, beide ausdruecklich als eigene Owner-Entscheidung
  gefuehrt und beide NICHT Teil der Phasen selbst: die WARN-Meldung aus KV-M3 (Entscheidung
  5), und Option (c) unter Owner-Entscheidung 1 - die Wiederaufnahme der zurueckgezogenen
  Entscheidung E11 (Inbound-Sperre aus `voice.js:274` faellt), die vor jeder Umsetzung eine
  eigene, schriftliche Aenderung von `CLAUDE.md` Absolute Regel 1 voraussetzt und nicht durch
  dieses Dokument allein ausgeloest werden kann.
- **Kein zweiter Scheduler, kein Render-Cron, keine neue Provider-Ressource.** Alles
  Periodische reitet auf `boot.js:547-554` mit.
- **Keine Aussage ueber Zeitraeume vor 2026-07-24** - `detail_records` reicht sieben Tage
  zurueck, die Render-Logs rund 29 Tage.

---

## Zum Verfahren

- **KV-M0, KV-M1, KV-M2** sind Messungen bzw. Owner-Handgriffe. Kein Branch, kein Review;
  Ergebnis als Zahl in dieses Dokument.
- **KV-P0, KV-P2, KV-P3, KV-P4, KV-P5** beruehren Absolute Regel 1 (Kosten-Gate, Geld-Pfad):
  volles Lean-Template - Worktree, dualer Review (Safety + Clean-Code als hartes Gate),
  Pre-Mortem je Phase, Smoke-Test.
- **KV-M3, KV-M4, KV-P1, KV-P6, KV-P7, KV-P8** sind eng umrissen und kippen keine
  Gate-Entscheidung: Lean-Template ohne Sonderbehandlung. KV-P7 fuegt Boot-Guards hinzu und
  braucht trotzdem den Safety-Blick, weil ein falsch gebauter Guard den Boot toetet.
- **Definition of Done, zusaetzlich:** KV-P0, KV-P2, KV-P3, KV-P5 und KV-M3 aktualisieren
  `PLAN-SECURITY.md`. KV-P2/KV-P3 tragen die neue Inbound-Kosten-Kante mit Zahlen ein, KV-M3
  die geaenderte Reichweite der Deckungs-Warnung.
- **DB-Regel fuer jede Phase (N5):** neue Spalte = `ADD COLUMN IF NOT EXISTS` in
  `db/schema.sql` (laeuft beim naechsten Boot automatisch, `store/pg.js:74`). Datenheilung =
  eigener, benannter, idempotenter Backfill-Schritt im Code, mit einer Prod-Abfrage als
  Abnahmekriterium. Ein Einmal-SQL in einer Konsole zaehlt nicht als erledigt.
- **Reihenfolge ist load-bearing:** KV-P1 vor allen Bau-Phasen (sonst hat keine Phase einen
  Fortschrittsanzeiger), KV-M1 vor KV-P2 (sonst wird der Inbound-Satz geraten), KV-P2 vor
  KV-P3 (sonst korrigiert der Abgleich gegen `no_estimate`), KV-M2 vor KV-P4.
- **Phasen einzeln mergen.** Einzige Kopplung: KV-P3 ohne KV-P2 ist wirkungslos, aber nicht
  schaedlich - ein Rollback von KV-P2 nach gemergtem KV-P3 laesst den Abgleich auf
  Inbound-Calls ohne Schaetzung laufen, die er als `no_estimate` verwirft. Kein Boot-Refusal,
  nur ein sinnloser Lauf.
