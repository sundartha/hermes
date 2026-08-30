# Entwurf A: "Beleg je Kostentraeger"

Architektur-Entwurf zum Auftrag `tasks/kostenv2/AUFTRAG.md`, Stand 2026-08-30.
Haltung A: die Loesung wird vom ANBIETER-BELEG her gedacht.

**Kennzeichnung, durchgehend:** `BELEGT` = mit Datei:Zeile oder gemessenem Wert aus
AUFTRAG.md/den vier Befunden. `VERMUTET` = Schlussfolgerung dieses Entwurfs, nicht
gemessen. `NEU` = etwas, das es heute nicht gibt und das gebaut werden muss (kein
erfundener Bestandsname).

---

## 1. Zielbild

Jeder Anruf erklaert VOR dem Waehlen, welche Kostentraeger er verursachen wird
(sein *Kostenprofil*); nach dem Anruf sammelt das System je Traeger genau EINEN
Anbieter-Beleg ein und legt ihn unveraendert als eigene Zeile an den Anruf; und genau
einmal je Anruf wird die Summe aller eingesammelten Belege gegen die vorab gebuchte
Schaetzung gerechnet. Nach OBEN wird immer korrigiert (auch mit unvollstaendiger
Belegmenge, denn eine Teilsumme ist eine Untergrenze der Wahrheit); nach UNTEN nur,
wenn JEDER im Profil deklarierte Traeger belegt ist. Die Vollstaendigkeit wird dabei
nie daran gemessen, was zufaellig eingetroffen ist, sondern immer an dem, was das Profil
verlangt hat — genau darin liegt der Unterschied zwischen dieser Architektur und der
B6-Falle. Wer keinen Beleg liefert, laesst die Schaetzung stehen und erzeugt eine
gezaehlte, alarmierte Luecke, nie ein stilles Null.

---

## 2. Kostenarten-Tabelle

### 2.0 Vorbemerkung: es sind DREI Buecher, nicht zwei — und das ist keine Erfindung

Der Auftrag spricht von zwei Buechern. Am Code ist das eine Buch aber bereits vergeben:
`usage_event` ist die **Stripe-Meter-Quelle**. `src/billing/meter.js` aggregiert
JEDE Zeile je `(tenantId, kind)` und meldet sie ueber `billing.reportMeter` an Stripe
(`meter.js` Kopfkommentar Zeile 1-7, `aggregateMeterEvents`) — es gibt keinen
kind-Filter, der eine Zeile von der Meldung ausnaehme (BELEGT). Wuerde man
Lieferantenkosten (ElevenLabs, Telnyx-SIP) als neuen `USAGE_EVENT_KIND` eintragen,
wuerden sie dem KUNDEN als Verbrauch berechnet. Das ist Doppelfakturierung, nicht
Kostenerfassung.

Deshalb unterscheidet dieser Entwurf:

| Buch | Was drinsteht | Physische Schreibkante |
|---|---|---|
| **Erloes-Buch** (`usage_event`) | was wir dem Kunden berechnen (Minuten, SMS, Nummern-Monate) | `recordUsageEvent`, `state-ops.js:4096` (BELEGT, fail-closed auf `USAGE_EVENT_KIND`, `:4112`) |
| **Kosten-Buch** (`call_cost_evidence`, NEU) | was uns ein Anruf beim Lieferanten gekostet hat, je Traeger, im Anbieter-Rohwert | `recordCallCostEvidence` (NEU), append-only, ein Eintrag je (callId, traeger) |
| **Gate-Achse** (`usage.costCents`) | die eine Zahl, gegen die `budgetExceeded` prueft | `bookCents` (`state-ops.js:3609`) bzw. `applyCreditCents` (`:3756`) — es gibt keinen dritten Weg (BELEGT, befund-code Abschnitt 1) |

Das Kosten-Buch ist NEU, aber es ist die kleinstmoegliche Neuerung: heute traegt der
Call genau EINEN Skalar `actualCostMicroCents` (`state-ops.js:326`) — ein Feld, das
strukturell nur einen Traeger fassen kann. Zwei Traeger brauchen zwei Zeilen. Dass
`actualCostMicroCents` erhalten bleibt (als Summe, s. 3.4), ist Absicht: die
Monatsauswertung `actualCostMicroCentsForMonth` (`state-ops.js:4544`) haengt daran.

### 2.1 Die Tabelle

Zeitpunkt der Verfuegbarkeit: gemessen an "nach Gespraechsende".

| # | Kostenart | Quelle (Feld) | Waehrung | Verfuegbar | Weg in die Gate-Achse | Weg ins Kosten-Buch | Erloes-Buch |
|---|---|---|---|---|---|---|---|
| 1 | **ElevenLabs ConvAI, Gesamt je Gespraech** | `metadata.cost_fiat` aus `GET /v1/convai/conversations/{id}` (BELEGT, befund-elevenlabs 1) | USD | vorlaeufig sofort bei Gespraechsende (die Antwort liegt in `persistProviderResult`, `outbound.js:1283`, bereits im Speicher — BELEGT befund-code 3/Bruch 1); gereift nach Reifefrist (s. 3.3) | ueber das Settlement (3.4) in `applyCostCorrectionCents` (`state-ops.js:3798`) | Belegzeile `traeger=elevenlabs_convai` | **nein** (Lieferantenkosten, s. 2.0) |
| 1a | davon LLM-Anteil | `charging.llm_price` | USD | wie 1 | — (nur Detail, NICHT separat gebucht) | dieselbe Belegzeile, Detailfeld | nein |
| 1b | davon Plattform-Anteil (TTS+ASR+Turn) | `charging.platform_price` | USD | wie 1 | — (nur Detail) | dieselbe Belegzeile, Detailfeld | nein |
| 1c | davon Analyse | `charging.analysis.price` (in allen 8 gemessenen Anrufen 0, BELEGT) | USD | wie 1 | — | dieselbe Belegzeile, Detailfeld | nein |
| 2 | **Telnyx SIP-Trunk-Minuten des EL-Legs** | `cost` im Beleg `record_type=sip-trunking`, Join `raw.sip_call_id === call.sipCallId` (BELEGT, befund-telnyx O1, 12/12 Treffer) | USD (BELEGT: `currency=USD` auf allen 13 Records) | fruehestens nach `COST_TRUING_DELAY_MINUTES`; Belegfenster 7 Tage (`PROVIDER_COST_RECORD_WINDOW_DAYS`, `cost-truing.js:119`) | dasselbe Settlement | Belegzeile `traeger=telnyx_sip` | nein |
| 3 | **Telnyx Call-Control-Minuten** (alte Budget-Engine, Inbound, Telnyx-Outbound) | `record_type=call-control` ueber `providerLegIdOf`/`call_control_id` (Bestand, BELEGT: 56/56 abgeglichen) | USD | wie 2 | Bestandsweg, unveraendert | Belegzeile `traeger=telnyx_callcontrol` | nein |
| 4 | **Telnyx-eigenes TTS** (Assistant-/Relay-Pfad) | `record_type=text-to-speech`, Teil von `ASSIGNABLE_COST_RECORD_TYPES` (BELEGT, `cost-ledger-map.js` Zeile `play_tts_characters`, Korrektur KV-P7/C2) | USD | wie 2 | Bestandsweg (heute in derselben Summe wie 3) | Belegzeile `traeger=telnyx_tts` | nein |
| 5 | **Unsere eigenen KI-Token** (Anthropic/DeepSeek) | `meterAiTokens` (`llm-usage.js:25`) -> `trackUsage` -> `bookCents` (BELEGT, befund-code 1) | Bucket (EUR-ct) | LIVE, pro Schleifenrunde | Bestand, unveraendert (`state-ops.js:3655`) | keine Belegzeile noetig — die Kosten entstehen bei uns, es gibt keinen Dritt-Beleg einzusammeln | ja, `AI_TOKEN` |
| 6 | **Recherche-Gebuehr** (Exa) | `addResearchFeeCostCents` (`state-ops.js:3687`, Aufrufer `llm-usage.js:108/123`) | Bucket | LIVE | Bestand, unveraendert | wie 5 | nein (kein `kind`) |
| 7 | **SMS** (Zusammenfassung/Alarm) | `config.billing.smsCostCents`, Default 0 | Bucket | sofort | **KEIN Weg** — `gate:false`, "strukturell nie vorgesehen" (BELEGT, `cost-ledger-map.js` Zeile `sms`) | keine | ja, `SMS` |
| 8 | **DID-Monatsmiete** | `number.monthlyCostCents`, nur beim Kauf gelernt; heute traegt KEINE reale Nummer einen Preis (BELEGT, `cost-ledger-map.js` Zeile `number_month`) | Bucket | monatlich | **KEIN Weg**, bewusst (Owner-Entscheidung, geparkt) | keine | ja, `NUMBER_MONTH` |
| 9 | **ElevenLabs-Monatsgrundgebuehr** (6 USD/Monat, `next_invoice.subtotal_cents=600`, BELEGT befund-elevenlabs 3) | `PLATFORM_FIXED_COST_CENTS_PER_MONTH` | Bucket | monatlich | **bewusst KEIN Weg je Tenant**, Begruendung s. 2.2 | keine | nein |
| 10 | **ElevenLabs-Credit-Kontingent** (30.000 Credits/Monat) | `charging.free_minutes_consumed`/`free_llm_dollars_consumed` (in allen 8 Anrufen 0, BELEGT) | Credits | je Gespraech | **bewusst KEIN Weg**, s. 2.2 | Detailfeld der Belegzeile 1 | nein |
| 11 | **Play-TTS-Zeichen** (alter Eigen-Synthese-Pfad) | `recordTtsCharacters`, zaehlt NUR Zeichen | — | sofort | **KEIN Weg**, es existiert kein Preis (BELEGT, `cost-ledger-map.js`) | keine | nein |
| 12 | **Nummern-Kauf/Setup beim Provider** | heute nirgends erfasst (`numberSetupFeeCents` ist der KUNDEN-Preis, nicht unser Einkauf) | — | einmalig | **KEIN Weg**, Luecke — s. 2.2 | keine | nein |
| 13 | **Infrastruktur** (Render, Postgres, Domains) | keine API-Quelle im System | — | monatlich | **bewusst KEIN Weg je Tenant**, s. 2.2 | keine | nein |

### 2.2 Die Arten, die bewusst NICHT je Tenant umgelegt werden — mit Begruendung

- **#9/#10/#13 (EL-Grundgebuehr, Credit-Kontingent, Infrastruktur):** das sind
  Gemeinkosten ohne Verursacher je Anruf. Sie je Tenant umzulegen hiesse, einen
  Verteilschluessel zu erfinden (nach Minuten? nach Anrufen? nach Kopf?), und jeder
  Schluessel waere eine Zahl, die kein Beleg deckt. Genau davor warnt die Haltung dieses
  Entwurfs: der Gate-Achse darf nur zufliessen, was ein Anbieter-Beleg traegt. Diese
  Groessen sind Preisbildungs-Eingaben (was muss ein Abo kosten, damit die Fixkosten
  gedeckt sind), nicht Verbrauchskosten. Sie bleiben, wo sie heute sind: in der reinen
  Anzeige `GET /api/billing/platform-costs` mit `listPriceNotBilled: true` (BELEGT,
  befund-gate 4). **Wichtig fuer #10:** solange das Konto unter dem Kontingent liegt,
  ist `cost_fiat` ein LISTENPREIS, kein Zahlungsstrom — wir zahlen die 6 USD, nicht die
  2,33 USD Summe (BELEGT, befund-elevenlabs "Abschliessender Abgleich"). Der Gate-Achse
  den Listenpreis zu buchen ist trotzdem richtig: die Decke soll den GRENZKOSTEN-Fall
  decken, und ueber dem Kontingent ist der Listenpreis der echte Grenzkostensatz. Die
  Ueberdeckung darunter ist ein bewusst akzeptierter Sicherheitsaufschlag.
- **#7 (SMS):** die Luecke ist alt und klein (Default-Preis 0). Dieser Entwurf schliesst
  sie NICHT — sie waere ein zweites Thema in derselben Kette, und die Kette ist schon
  lang. Sie ist hier nur benannt, damit sie nicht als "erfasst" durchgeht.
- **#8 (DID-Miete) und #12 (Nummern-Einkauf):** geparkte Bestandsluecken. #12 ist neu
  benannt: `numberSetupFeeCents` ist der Preis, den wir NEHMEN, nicht der, den wir
  ZAHLEN. Beides bleibt ausserhalb dieser Kette.

---

## 3. Der Abgleich

### 3.1 Das Kostenprofil — die Deklaration, gegen die Vollstaendigkeit geprueft wird

**Der Kernmechanismus dieses Entwurfs.** Jeder Anruf traegt ein set-once-Feld
`costProfile` (NEU), gesetzt an der Stelle, die den Anruf erzeugt, aus einer
eingefrorenen Registry `CALL_COST_PROFILE` (NEU, Ort: `src/billing/`, neben
`cost-ledger-map.js`):

| Profil | Pflicht-Traeger | Gilt fuer |
|---|---|---|
| `el_convai_sip` | `elevenlabs_convai`, `telnyx_sip` | EL-Outbound (`routes/api-calls.js`, EL-Zweig hinter der Gate-Kette) |
| `telnyx_budget` | `telnyx_callcontrol` | Telnyx-Engine, Outbound |
| `telnyx_inbound` | `telnyx_callcontrol` | Inbound (BELEGT: Inbound laeuft NIE ueber EL, befund-gate 3) |

Der Store-Mutator ist fail-closed auf die Profil-Enum — genau das Muster, mit dem
`recordUsageEvent` heute ein unbekanntes `kind` abweist (`state-ops.js:4112-4113`,
BELEGT). Ein neuer Wahlpfad, der kein Profil setzt, kann keinen Call anlegen.

**Warum das die Luecke schliesst, die `cost-ledger-map.js` offenlaesst:** befund-code
Abschnitt 5 zeigt (BELEGT), dass die Landkarte "jemand hat einen `kind` angelegt und
vergessen einzutragen" faengt, aber "ein voellig neuer Kostentraeger ist live gegangen
und niemand hat daran gedacht" NICHT. Das Profil dreht die Beweislast um: die Frage
lautet nicht mehr "hat jemand eine Kostenart eingetragen?", sondern "welcher Wahlpfad
hat diesen Anruf erzeugt, und was hat er versprochen zu verursachen?". Der Wahlpfad
existiert immer — er ist die Zeile Code, die den Anruf startet. Ein Inventar-Test nach
dem Muster von `test/route-auth-inventory.test.js` (dort: jeder Endpunkt hat einen
Policy-Eintrag) haelt fest: **jede Stelle, die einen Anruf erzeugt, nennt ein Profil
aus der Registry** — sonst rot. Am 19.08. haette dieser Test den ConvAI-Umstieg
gestoppt, weil der neue Zweig ein Profil haette nennen muessen, das es noch nicht gab.

### 3.2 Belegzeilen

Je (callId, traeger) genau eine Zeile, append-only:

```
callId, traeger, microCents (Anbieter-Waehrung), waehrung, quelle, reife, beobachtetAt, roh-Kennzahlen
```

`reife` ist zweiwertig: `vorlaeufig` (nachbuchen erlaubt, Erstattung NIE) und
`belegt` (zaehlt fuer die Vollstaendigkeit). Kein Beleg = keine Zeile; eine Zeile mit
`microCents: 0` bedeutet "der Anbieter sagt: kostenlos" (z.B. die 4 nicht angenommenen
Anrufe mit `cost=0.0`, BELEGT befund-telnyx) und ist ein vollwertiger Beleg. Das ist
die Unterscheidung, an der der Bestand heute schon haengt: `unavailable` heisst
"nicht gemessen", NIEMALS "Kosten = 0" (BELEGT, `defaults.js:185` Kommentar).

**Waehrung:** beide Traeger liefern USD (BELEGT: befund-telnyx `currency=USD` auf allen
13 Records; befund-elevenlabs `"currency":"usd"` aus `/v1/user/subscription`). Damit
gilt derselbe Kurs-Pfad — `convertProviderMicroToBucketCents` (`state-ops.js:3705`) ist
ausweislich seines eigenen Kommentars "Provider-Mikro-Cent (USD) -> Ziel-Bucket-Cent
(EUR)" und nirgends Telnyx-spezifisch (BELEGT). **O4 ist damit beantwortet: EIN
Kurs-Pfad, kein zweiter.** Die Belegzeile fuehrt die Waehrung trotzdem mit, und das
Settlement verwirft eine Zeile mit fremder Waehrung, statt sie umzurechnen (fail-closed,
dasselbe Prinzip wie P1 am Telnyx-Adapter).

### 3.3 Reifefrist — die Antwort auf das ungemessene O3

O3 (wann ist `cost_fiat` final?) ist NICHT gemessen und in dieser Session auch nicht
messbar (BELEGT, befund-elevenlabs 2: kein Anruf juenger als 4h20m, kein Testanruf
erlaubt). Der Entwurf macht O3 deshalb von einem Blocker zu einem Parameter:

- Der bei Gespraechsende synchron eingesammelte `cost_fiat` wird IMMER als
  `vorlaeufig` abgelegt. Er darf nachbuchen (Untergrenze, sicher), aber nie erstatten.
- Ein spaeterer Sweep-Abruf (`fetchConversation`, `src/elevenlabs/convai.js:235`,
  existiert BELEGT) mindestens `EL_EVIDENCE_MIN_AGE_MINUTES` (NEU, Default 15) nach
  Gespraechsende hebt die Zeile auf `belegt` — und nur dann, wenn der Wert mit dem
  vorlaeufigen uebereinstimmt. Weicht er ab, gilt der HOEHERE, die Zeile bleibt
  `belegt`, und die Abweichung wird gezaehlt (sie ist die Messung von O3, die wir nie
  gemacht haben, im Betrieb nachgeholt).
- Sobald diese Zaehlung ueber N Anrufe 0 Abweichungen zeigt, ist O3 empirisch
  beantwortet und die Frist kann gesenkt werden. Das ist eine Owner-Entscheidung,
  keine automatische.

**Harte Randbedingung, die den synchronen Griff unverzichtbar macht (BELEGT):** auf dem
Abbruchweg (`endActiveCall`, `outbound.js:1452-1460`) laeuft nach dem Ergebnisabruf ein
`endConversation`-DELETE, das beim Anbieter "vermutlich den kompletten Datensatz
mitnimmt" (Bestandskommentar `outbound.js:1429-1431`). Fuer abgebrochene Anrufe —
darunter genau die vom Max-Dauer-Cap beendeten, also die teuersten — ist der
synchrone Griff die EINZIGE Chance. Diese Anrufe bleiben strukturell `vorlaeufig`
und damit dauerhaft nicht erstattungsfaehig. Das ist die sichere Richtung.

### 3.4 Das Settlement — genau einmal je Anruf

Ein Anruf ist *abgleichsreif*, wenn (a) alle Pflicht-Traeger seines Profils eine
Belegzeile mit `reife=belegt` haben, ODER (b) die Abgleichsfrist abgelaufen ist (3.5).
Dann, genau einmal:

```
actualCostMicroCents := Summe aller vorhandenen Belegzeilen des Calls
dataComplete         := alle Pflicht-Traeger des PROFILS haben eine Zeile mit reife=belegt
-> store.applyCostCorrectionCents(tenantId, {
     actualCostMicroCents, estimatedCostCents: call.estimatedCostCents,
     providerToBucketRateMicro, dataComplete, chargeAnchors: chargeAnchorsOfCall(call) })
```

Danach `costTruedAt` setzen (der bestehende set-once-Idempotenzriegel,
`state-ops.js:804-812`, BELEGT) und die Summe in `actualCostMicroCents` schreiben —
dasselbe Feld wie heute, jetzt mit der Bedeutung "Summe aller Traeger".

Die Asymmetrie muss NICHT neu gebaut werden: `applyCostCorrectionCents`
(`state-ops.js:3798-3819`) verwirft einen negativen Delta bereits ohne
`dataComplete` (`:3813`, BELEGT). Was sich aendert, ist ausschliesslich, WORAUS
`dataComplete` entsteht — heute aus `refundProven` (`cost-truing.js:453-460`), das genau
EINEN `measured`-Wert kennt (BELEGT), kuenftig aus dem Abgleich Profil-Soll gegen
Beleg-Ist.

**Warum genau einmal und nicht inkrementell:** `deltaCents = bucketCents -
estimatedCostCents` (`state-ops.js:3811`) rechnet gegen die Schaetzung. Zweimal
gebucht, waere die Schaetzung zweimal abgezogen. Ein zweiter Buchungslauf braeuchte
einen zweiten Merker "was wurde schon korrigiert" — eine zweite Wahrheit ueber
denselben Sachverhalt. Der Preis der Einmaligkeit: zwischen Gespraechsende und
Settlement (Frist + Sweep-Takt, heute stuendlich) traegt die Gate-Achse nur die
Schaetzung. Bei heutigen Zahlen ist das die sichere Seite (30 EUR-ct Schaetzung gegen
gemessene ~11,8 US-ct/min EL + ~4,0 US-ct/min Telnyx, BELEGT B2/befund-telnyx O2);
dass es die sichere Seite BLEIBT, ist genau die Aufgabe des Tarif-Waechters (6.).

### 3.5 Nachbuchen, Erstatten, Frist — die Matrix

| Lage bei Faelligkeit | Ist > Schaetzung | Ist < Schaetzung |
|---|---|---|
| alle Pflicht-Traeger `belegt` | nachbuchen | **erstatten** |
| ein Traeger fehlt, Frist laeuft noch | warten (nichts buchen) | warten |
| ein Traeger fehlt, Frist abgelaufen | nachbuchen | **nichts** — Schaetzung bleibt stehen |
| Traeger nur `vorlaeufig` | nachbuchen | **nichts** |
| Profil unbekannt (Altzeile vor der Kette) | Legacy-Profil `telnyx_*` anwenden | wie Legacy heute |
| Profil unbekannt (Zeile NACH der Kette) | **gar nichts** + Befund `profil_unbekannt` | dito |

Die letzte Zeile ist der strukturelle Fang: ein Anruf, der nach der Umstellung ohne
Profil entsteht, kann gar nicht abgerechnet werden und meldet sich lautstark. Er ist
nicht still falsch, er ist laut unfertig.

---

## 4. Wenn ein Anbieter-Beleg NIE kommt

Drei Regeln, die zusammen verhindern, dass ein Anruf ewig offen bleibt UND dass eine
Schaetzung stillschweigend verfaellt:

1. **Frist statt Unendlichkeit.** `COST_SETTLE_DEADLINE_HOURS` (NEU, Default 24).
   Herleitung: der teuerste einzelne Beleg (Telnyx) ist nach `COST_TRUING_DELAY_MINUTES`
   verfuegbar und bleibt 7 Tage abrufbar (`PROVIDER_COST_RECORD_WINDOW_DAYS`,
   `cost-truing.js:119`, BELEGT); 24 h lassen bei stuendlichem Sweep ~24 Versuche zu und
   liegen weit innerhalb des Fensters. Nach Fristablauf wird zwingend gesettelt — mit
   dem, was da ist, nachbuchen-only.
2. **Die Schaetzung verfaellt nie.** Sie ist beim Call-Ende bereits gebucht
   (`reconcileVoiceBudget`, `call-finish.js:263`, IMMER — BELEGT befund-code 2) und wird
   ohne vollstaendigen Beleg nicht angetastet. "Kein Beleg" fuehrt also NIE dazu, dass
   ein Anruf kostenlos wird. Das ist die Umkehrung des heutigen Zustands, in dem ein
   fehlender Beleg schlicht nichts bewirkt — richtig, aber unbemerkt.
3. **Die Luecke wird zur Zahl.** Der Call bekommt einen Endzustand
   `unvollstaendig_final` mit der NAMENTLICHEN Liste der fehlenden Traeger. Daraus
   entsteht eine Deckungsquote **je Traeger** (nicht mehr eine globale): "von N
   faelligen Anrufen mit Profil `el_convai_sip` sind M mit vollstaendigem EL-Beleg
   gesettelt". Faellt eine dieser Quoten unter `COST_TRUING_MIN_COVERAGE_PERCENT`,
   feuert der Alarmweg (5.).

Warum je Traeger: die heutige globale Quote von 0 % (BELEGT B1) war 11 Tage lang
korrekt und trotzdem folgenlos. Eine Quote je Traeger haette zusaetzlich gesagt,
WELCHER Traeger fehlt — und genau das ist die Information, mit der jemand handeln kann.

---

## 5. Der Alarmweg

Der belegte Befund B3 ist eindeutig: `audit()` (`src/util.js`) ist ausschliesslich ein
`console.log`, schreibt NICHT in `audit_log`, und fuer den Deckungs-Befund ist keine
SMS vorgesehen (BELEGT). Der Entwurf baut keinen neuen Kanal — er verdrahtet den
bereits gebauten, heute ungenutzten:

**Meldeweg, Reihenfolge bindend: WARN-Log -> durabler Audit-Eintrag -> Mail -> SMS.**
Das ist woertlich der Weg, den `src/telephony/outage-report.js` bereits faehrt
(Kopfkommentar Zeile 6-10, BELEGT), inklusive der dort ausformulierten Begruendung,
warum **Mail primaer** ist: der SMS-Kanal laeuft ueber DASSELBE Telnyx-Konto und
DIESELBE Nummerntabelle wie das, was ausfallen kann — "ein Alarm, den derselbe Defekt
mitreisst, ist keiner". Fuer den Kostenpfad gilt das doppelt: faellt Telnyx aus,
faellt auch die Alarm-SMS aus.

Konkret, alles Bestand:

| Stufe | Baustein | Beleg |
|---|---|---|
| Audit durabel | `makeAuditStore(runner).record({action, detail})` -> Tabelle `audit_log` | `src/audit-store.js:3-12` |
| Mail | `mailer.sendMail({to: config.mail.platformAlertMailTo, ...})` | `outage-report.js#sendMailChannel`, Config `config.js:1940` |
| SMS | `sendBootstrapAlertSms({messaging, config, store, prefix, detail, logTag})` | `src/telephony/alert-sms.js:84` |
| Selbsttest | `runAlertChannelSelfTest` laeuft bereits im Stundentakt | `src/boot.js` (`runSweepTick`, 5. Zweig) |

Drei Aenderungen an der Meldelogik:

1. **`emitFinding` (`cost-truing.js:375`) schreibt zusaetzlich in den Audit-Store.**
   Heute ruft es `audit(COST_TRUING_AUDIT_EVENT, null, line)` (`:379`) — also
   `console.log`. Der Audit-Store haengt bereits am pg-Runner und wird von
   `self-service-routes.js` genutzt (BELEGT). Damit ist die Gegenprobe des Owners
   (`select ... from audit_log where action='cost_truing_befund'`) nicht mehr leer.
2. **Der Stillstands-Zaehler wird persistiert.** `sweepsBelowThreshold` ist heute
   prozesslokal und wird von jedem Render-Neustart genullt — der Bestandskommentar
   nennt das selbst ein akzeptiertes Restrisiko (`cost-truing.js:410-420`, BELEGT), und
   B3 zeigt, dass genau dieses Risiko eingetreten ist. Ein persistierter Zaehler
   (Plattform-Bucket, gleiche Stelle wie `spendMonthKey`-artige Stempel) macht aus der
   Eskalationsstufe eine Stufe, die wirklich eskaliert.
3. **Neue Befund-Codes auf DEMSELBEN Kanal**, kein neuer Alarmtyp:
   `coverage_below_threshold_traeger` (je Traeger), `settle_deadline_expired`
   (Anrufe, die ohne Vollbeleg gesettelt wurden), `profil_unbekannt`. Die ersten
   beiden alarmieren per Mail+SMS, der letzte immer — er bedeutet, dass ein Wahlpfad an
   der Registry vorbei existiert.

**Der Zeitanspruch "binnen Stunden":** Sweep stuendlich (BELEGT, Bestand) + Frist 24 h
heisst: ein Ausfall der EL-Erfassung ist spaetestens ~25 h nach dem ersten betroffenen
Anruf eine Mail. Wer schneller sein will, senkt die Frist; darunter steigt die Zahl der
unnoetig unvollstaendigen Settlements. Das ist der einzige Regler, und er ist bewusst
sichtbar.

---

## 6. Tarif- und Preisherleitung

**Die eigentliche Aufloesung von B5:** heute ist `VOICE_TARIFF_DEFAULT_CENTS=30` zugleich
Vorab-Reserve UND Endabrechnung — deshalb ist ein falscher Tarif ein dauerhafter Fehler.
Nach dieser Architektur ist der Tarif nur noch die **Vorab-Reserve**; die Endabrechnung
kommt aus Belegen. Der Schaden eines schlechten Tarifs sinkt damit von "wir rechnen
dauerhaft falsch ab" auf "wir reservieren fuer ein paar Stunden zu viel oder zu wenig".

Der Tarif wird dennoch nachgezogen, und zwar ohne dass jemand daran denken muss:

1. **Messgrundlage umstellen (der eigentliche Fix).** Der Drift-Waechter
   `src/billing/cost-calibration.js` misst heute den p95-Ist-Satz je Praefix aus
   `actualCostMicroCents` und nimmt als Stichprobe NUR Calls mit
   `costTruedSource === DETAIL_RECORDS` (BELEGT, Kommentar Zeile 49-52). Beides passt
   nach dieser Kette weiter — aber die Zahl bedeutet dann **Vollkosten aller Traeger**
   statt Telnyx-Anteil. Das ist keine neue Mechanik, sondern eine geaenderte
   Belegmenge: derselbe Waechter, richtiger Nenner. Erst damit misst er, was der Tarif
   decken soll.
2. **Untergrenze statt Fortschreibung.** Der Waechter vergleicht p95-Vollkosten gegen
   `VOICE_TARIFF_*`. Liegt der Tarif darunter, ist das der Befund `underestimate` — der
   gefaehrliche —, und er alarmiert ueber denselben Weg wie 5.
   `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` (heute 10, hergeleitet aus der
   Assistant-Konfiguration und damit unter den heutigen Vollkosten, BELEGT B5) bekommt
   damit erstmals eine gemessene Quelle statt einer fortgeschriebenen.
3. **Boot-Waechter.** Beim Start prueft ein Boot-Guard-Eintrag den konfigurierten Tarif
   gegen den zuletzt gemessenen p95-Vollkostensatz. Liegt er darunter, ist das eine
   WARN-Zeile plus Mail — beim Start, nicht erst beim naechsten Sweep.
4. **Was der Entwurf NICHT tut: automatisch justieren.** Die Owner-Entscheidung vom
   2026-07-20 ("keine rollende Selbstkalibrierung; ein Tarif, der sich aus Anrufen
   speist, die das Gate durchgelassen hat, ist eine Rueckkopplung", BELEGT
   `cost-calibration.js:1-6`) bleibt unangetastet. Ob ein automatisches Anheben (nie
   Senken) diese Entscheidung verletzt oder nur ihre sichere Haelfte nutzt, ist eine
   Owner-Frage und steht in 9.
5. **Preis-Struktur, nicht nur Preis-Hoehe.** Die EL-Kosten haben einen grossen FIXEN
   Anteil je Anruf (Prompt-Cache-Write, BELEGT B2), Telnyx rundet auf volle Minuten auf
   (BELEGT befund-telnyx O2). Beide machen KURZE Anrufe pro Minute teuer: der 8-s-Anruf
   kostet bei Telnyx die volle Minute. Eine reine Minutenpauschale bildet das
   strukturell falsch ab. Der Waechter soll deshalb zusaetzlich den p95 der
   **Vollkosten je ANRUF** (nicht je Minute) fuehren; solange
   `Reserve = Tarif x RESERVE_LEAD_MINUTES` (60 ct, BELEGT B4) ueber diesem Wert liegt,
   ist auch der kuerzeste Anruf gedeckt. Ein echter Zweiteiler
   (Grundpreis + Minutenpreis) ist die saubere Loesung und steht in 9 als Entscheidung —
   dieser Entwurf baut ihn nicht.

---

## 7. Die Phasenkette

Jede Phase: einzeln lieferbar, einzeln mergebar, mit einem Abnahmekriterium, das
**ohne echten Anruf** pruefbar ist (Fixtures + `node:test`, Muster
`test/fixtures/elevenlabs-conversations.js`, existiert BELEGT). Reihenfolge ist
bindend, die Begruendung steht jeweils dabei.

**KV2-1 — Kostenprofil-Registry (Struktur, kein Verhalten).**
Liefert: `CALL_COST_PROFILE` (eingefroren, validiert beim Import wie
`cost-ledger-map.js:143`), set-once-Feld `costProfile` am Call, fail-closed
Store-Mutator, alle drei heutigen Wahlpfade tragen ihr Profil.
Abnahme: (a) unbekanntes Profil -> Wurf; (b) Inventar-Test: jede Stelle in `src/`, die
einen Anruf erzeugt, nennt ein Registry-Profil, sonst rot; (c) `npm test` gruen, kein
Cent bewegt sich. Warum zuerst: alles Spaetere prueft gegen diese Deklaration.

**KV2-2 — Alarmweg reparieren (unabhaengig, klein, schuetzt alles Folgende).**
Liefert: `emitFinding` schreibt zusaetzlich durabel (`auditStore.record`), Mail als
primaerer Kanal vor SMS, persistierter Stillstands-Zaehler.
Abnahme: (a) Stub-Audit-Store bekommt genau einen Eintrag mit
`action='cost_truing_befund'`; (b) Stub-Mailer bekommt genau eine Mail, Ziel wird nicht
geloggt; (c) Zaehler ueberlebt einen simulierten Neustart (Store neu laden, Zaehler
weiterhin > 0). Warum hier: ohne diese Phase scheitert jede folgende genauso still wie
der Bestand.

**KV2-3 — EL-Beleg synchron erfassen (`vorlaeufig`), noch keine Buchung.**
Liefert: `recordCallCostEvidence` (append-only), Aufruf in `persistProviderResult`
(`outbound.js:1283`) direkt neben `recordSipCallId` (`:1312`) — beide Aufrufer
(regulaeres Ende UND Abbruch) sind damit bedient, BELEGT befund-code 2. Gelesen wird
`metadata.cost_fiat` (Summe, NICHT die Teilsummen — sie deckt auch Bestandteile ab, die
wir nicht kennen, z.B. `charging.analysis`), Teilsummen als Detail.
Abnahme: Fixture-Conversation aus den 8 gemessenen Werten -> genau eine Belegzeile,
`microCents` exakt, `reife=vorlaeufig`; zweiter Aufruf mit derselben callId legt keine
zweite Zeile an. Kein Test darf eine Gate-Achse beruehren.

**KV2-4 — Telnyx-SIP-Beleg erfassen, noch keine Buchung fuer Mehr-Traeger-Profile.**
Liefert: `providerLegIdOf` (`cost-truing.js:138`) um `call.sipCallId` erweitert;
zweites Ankerfeld `sip_call_id` in `assignCostRecords`
(`adapters/telnyx/voice.js:140,903`) — direkter Primaerschluessel-Vergleich, kein
Session-Fallback (BELEGT befund-telnyx: 12/12 exakt, alle 13 EL-Belege tragen
`sip_call_id`, keiner `call_control_id`). Ergebnis wird als Belegzeile
`traeger=telnyx_sip` abgelegt, NICHT gebucht.
Abnahme, und das ist der **B6-Test**: ein EL-Profil-Anruf mit ausschliesslich
Telnyx-Beleg und einer 30-ct-Schaetzung bewegt **null Cent** auf der Gate-Achse. Rot,
sobald jemand die Kette hier abkuerzt.

**KV2-5 — Perioden-Anker-Symmetrie fuer POSITIVE Nachbuchungen.**
Liefert: `bookCents` (`state-ops.js:3609`) beruecksichtigt beim positiven
Korrektur-Zweig die `chargeAnchors` derselben Belastung — heute tut das nur
`applyCreditCents` (BELEGT befund-gate 2: eine echte, ungetestete Asymmetrie).
Abnahme: Nachbuchung eines Calls aus der VORPERIODE erhoeht den Verbrauch der
LAUFENDEN Periode nicht (Spiegelbild von `test/ks-p5-current-period-credits.test.js`,
das heute nur den Gutschrift-Zweig deckt). Warum VOR dem Settlement: ein Anruf vom
Monatsletzten wird am Ersten gesettelt — ohne diese Phase belastet er den falschen
Monat, und zwar systematisch.

**KV2-6 — Das Settlement (der Kern).**
Liefert: Faelligkeitsregel, Summenbildung ueber Belegzeilen, `dataComplete` aus
Profil-Soll gegen Beleg-Ist, EIN Aufruf von `applyCostCorrectionCents`, `costTruedAt`
set-once, Frist `COST_SETTLE_DEADLINE_HOURS`.
Abnahme: Tabellentest ueber die vollstaendige Matrix aus 3.5 (sechs Zeilen x zwei
Richtungen), rein aus Fixtures, ohne Netz. Zusaetzlich: zweiter Settlement-Lauf
desselben Calls bewegt null Cent.

**KV2-7 — EL-Nachziehen im Sweep und Reifung.**
Liefert: fuer Calls mit `vorlaeufig`er EL-Zeile und ueberschrittener
`EL_EVIDENCE_MIN_AGE_MINUTES` ein `fetchConversation`-Abruf (`convai.js:235`), Upgrade
auf `belegt`, Zaehlung der Wertabweichungen (die nachgeholte O3-Messung). 404 (Datensatz
geloescht, Abbruchweg) ist ein regulaeres Ergebnis: Zeile bleibt `vorlaeufig`.
Abnahme: Stub-Fetch liefert (a) gleichen Wert -> `belegt`, (b) hoeheren Wert -> `belegt`
mit dem hoeheren, Abweichungszaehler +1, (c) 404 -> unveraendert `vorlaeufig`, kein
Wurf. Erst mit dieser Phase ist ueberhaupt eine Erstattung moeglich.

**KV2-8 — Deckung je Traeger, Fristverfall sichtbar.**
Liefert: Deckungsquote je Traeger statt global, Befunde
`coverage_below_threshold_traeger`, `settle_deadline_expired`, `profil_unbekannt`;
Sweep-Logzeile nennt je Traeger `kandidaten/belegt/offen`; Admin-Anzeige neben
`GET /api/billing/platform-costs`.
Abnahme: Fixture-Bestand mit 10 EL-Anrufen, davon 3 ohne EL-Beleg -> EL-Quote 70 %,
Telnyx-Quote 100 %, genau ein Befund, genau eine Mail.

**KV2-9 — Tarif-/Reserve-Herleitung aus Vollkosten.**
Liefert: Drift-Waechter misst Vollkosten (Belegmenge = gesettelte Calls mit
vollstaendigem Profil), zusaetzlicher p95 der Vollkosten JE ANRUF, Boot-Waechter gegen
`VOICE_TARIFF_*` und `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`.
Abnahme: Fixture-Calls, deren p95-Vollkosten den konfigurierten Tarif ueberschreiten ->
genau ein `underestimate`-Befund + Mail; unterschreiten -> kein Befund, kein Kanal-Laerm.

**KV2-10 — Gegenprobe je Traeger.**
Liefert: `cost-cross-check.js` wird traeger-getrennt (Telnyx-Ist gegen Telnyx-Rechnung;
EL-Ist gegen die EL-Konto-Groessen). Notwendig, weil `actualCostMicroCents` ab KV2-6 die
Summe ueber Traeger ist und die heutige Gegenprobe sie gegen eine reine Telnyx-Zahl
stellt (BELEGT befund-code Bruch 4) — ohne diese Phase wird die Beobachtung nach der
Umstellung falsch, nicht nur unvollstaendig.
Abnahme: Fixture-Monat mit beiden Traegern -> zwei getrennte Differenzen, keine
Mischdifferenz ueber den Waehrungsbruch hinweg. Einschraenkung, vorab benannt: die
EL-Seite kann nur die Summe der Einzel-`cost_fiat` gegen sich selbst pruefen — ein
unabhaengiger Konto-Vergleich ist bei diesem Kontostand strukturell nicht moeglich
(BELEGT befund-elevenlabs 5).

---

## 8. Was dieser Entwurf bewusst NICHT tut

1. **Keine Live-Kostenerfassung waehrend des EL-Gespraechs.** ElevenLabs liefert
   `cost_fiat` erst am Gespraechsende; ein Live-Wert existiert nicht. Die Deckung
   waehrend des Gespraechs bleibt der Bestand: `liveVoiceSpendCents` + der aus dem
   Restguthaben abgeleitete `maxDurationS`-Cap, im EL-Zweig armiert (BELEGT B4). Diese
   Kette wird NICHT angefasst.
2. **Keine neue `USAGE_EVENT_KIND` fuer Lieferantenkosten.** Begruendung in 2.0: jeder
   `kind` wird an Stripe gemeldet (BELEGT `meter.js`). Ein Meter-Event fuer unsere
   Einkaufskosten waere eine Kundenrechnung.
3. **Keine Umlage der Fixkosten je Tenant** (#9/#10/#13). Begruendung in 2.2: jeder
   Verteilschluessel waere eine Zahl ohne Beleg — der eine Baustein, den diese
   Architektur nicht enthaelt.
4. **Keine automatische Tarif-Justierung.** Owner-Entscheidung 2026-07-20 bleibt stehen;
   der Waechter misst und alarmiert, er justiert nicht.
5. **Kein Schliessen der SMS-Luecke (#7) und der DID-Miete (#8).** Beide sind benannt,
   beide bleiben offen — sie gehoeren nicht in diese Kette, und sie hier
   mitzuerledigen hiesse, die Kette gegen ihr eigenes Abnahmekriterium zu verbreitern.
6. **Kein rueckwirkendes Nachbuchen der 12 EL-Altanrufe.** Es waere technisch moeglich
   (die Belege existieren beidseitig), es beruehrt aber abgeschlossene Perioden und ist
   eine Owner-Entscheidung, keine Bauentscheidung. Der Betrag ist klein und bekannt:
   56,28 US-ct EL + 32,69 US-ct Telnyx gegen 270 EUR-ct gebuchte Schaetzung (BELEGT
   B2/befund-telnyx) — wir haben zu VIEL gebucht, nicht zu wenig. Eine Erstattung setzte
   vollstaendige Belege voraus, die fuer die abgebrochenen Anrufe nicht mehr zu
   beschaffen sind.
7. **Kein Anfassen der Safety-Gates.** Verifikation, `OUTBOUND_FROZEN`, Denylist,
   Land-Gate, Stundenlimit, pro-Tenant-Kostendecke (beide Richtungen), Max-Dauer,
   Signaturpruefung, Offenlegungssatz, `callee_is_owner`: unberuehrt. Die Kette macht
   die Kostendecke ausschliesslich GENAUER, nie durchlaessiger — der einzige Weg, auf
   dem sie Geld zurueckgeben kann, ist der bereits bestehende, beweispflichtige.

---

## 9. Pre-Mortem: ein Jahr spaeter, die Umstellung ist gescheitert

**R1 — "Wir haben still zu wenig gebucht, weil der EL-Beleg leise wegblieb."**
Ein Anbieter-Feldname aendert sich (`cost_fiat` -> etwas anderes), die Belegzeile wird
mit 0 oder gar nicht angelegt, das Settlement laeuft mit Teilsumme und bucht nichts
zurueck — aber auch nichts nach.
*Entschaerft durch:* Deckungsquote je Traeger (KV2-8) + Alarm mit Mail (KV2-2). Eine
EL-Quote, die auf 0 faellt, ist binnen ~25 h eine Mail. Zusaetzlich: `microCents: 0` und
"keine Zeile" sind verschiedene Zustaende (3.2) — ein fehlendes Feld erzeugt keine
Null-Zeile.

**R2 — "Der Alarm kam, aber niemand hat ihn gesehen."** Genau der Bestandsdefekt B3,
nur ein Jahr spaeter.
*Entschaerft durch:* Mail als primaerer Kanal, ausdruecklich weil SMS am selben
Telnyx-Konto haengt wie das, was ausfaellt (BELEGT `outage-report.js`), plus dem bereits
laufenden monatlichen Kanal-Selbsttest. *Restrisiko, akzeptiert:* eine Mail, die im
Spam landet, ist genauso still. Der Selbsttest deckt den Versand, nicht den Empfang.

**R3 — "Die Schaetzung wurde auf einen halben Beleg heruntergesetzt."** Die B6-Falle,
ein Jahr spaeter durch eine Abkuerzung wieder eingebaut.
*Entschaerft durch:* `dataComplete` gegen das PROFIL, nicht gegen die eingetroffene
Menge (3.1/3.4) + der explizite B6-Test in KV2-4, der rot wird, sobald jemand die
Reihenfolge abkuerzt.

**R4 — "Ein neuer Anbieter kam dazu und niemand hat an die Kosten gedacht."** Der
19.08.-Fehler wiederholt sich mit dem naechsten Umstieg.
*Entschaerft durch:* der Inventar-Test in KV2-1 — jeder Wahlpfad muss ein Profil
nennen. *Restrisiko, akzeptiert:* jemand traegt einen neuen Pfad in ein BESTEHENDES
Profil ein, dessen Traegerliste nicht passt. Der Test faengt das Fehlen, nicht die
Falschzuordnung. Sichtbar wuerde es an der Deckungsquote (Belege fuer einen Traeger,
den es auf diesem Pfad gar nicht gibt, kommen nie) — also laut, aber erst nach Frist.

**R5 — "Die Kette hat einen Kunden faelschlich gesperrt."** Eine positive Nachbuchung
aus einer alten Periode belastet die laufende Decke.
*Entschaerft durch:* KV2-5, VOR dem Settlement. Ohne diese Reihenfolge ist es kein
Restrisiko, sondern eine sichere Fehlfunktion (BELEGT befund-gate 2).

**R6 — "Das Settlement hat doppelt gebucht."** Zwei Sweeps ueberlappen, oder ein
Wiederholungslauf rechnet die Schaetzung ein zweites Mal ab.
*Entschaerft durch:* `costTruedAt` als set-once-Riegel (Bestand,
`state-ops.js:806`, BELEGT) + genau EIN Settlement je Call (3.4). *Restrisiko:*
`recordCallCostEvidence` selbst muss idempotent je (callId, traeger) sein — das ist ein
Abnahmekriterium in KV2-3, kein Zufall.

**R7 — "`cost_fiat` war beim synchronen Griff noch nicht fertig, und wir haben zu wenig
gebucht."** O3, nie gemessen.
*Entschaerft durch:* die Reifefrist (3.3) — der synchrone Wert darf nur nachbuchen, nie
erstatten, und wird spaeter gegen einen gereiften Abruf geprueft. *Restrisiko,
akzeptiert:* auf dem Abbruchweg (`endConversation`-DELETE, BELEGT) gibt es keinen
zweiten Abruf. Dort bleibt es beim vorlaeufigen Wert — die sichere Richtung, aber eine
dauerhafte Ungenauigkeit bei genau den Anrufen, die der Max-Dauer-Cap beendet hat.

**R8 — "Der Tarif ist unter die Vollkosten gerutscht und niemand hat es bemerkt."**
Der EL-Preis steigt oder das Modell wird teurer; 30 ct decken die Vollkosten nicht mehr.
*Entschaerft durch:* KV2-9 (Waechter auf Vollkosten + Boot-Waechter). *Restrisiko:*
die Reserve deckt zwei Minuten voraus (`RESERVE_LEAD_MINUTES=2`, BELEGT B4) — ein
Preissprung mitten in einem laufenden Anruf ist erst beim naechsten Anruf sichtbar.

---

## 10. Offene Fragen und Owner-Entscheidungen

**Offen, weil nicht messbar in diesem Rahmen:**

- **O3 (Reifezeit von `cost_fiat`)** bleibt ungemessen (BELEGT: kein Anruf juenger als
  4h20m verfuegbar, kein Testanruf erlaubt). Der Entwurf umgeht die Frage ueber die
  Reifefrist und holt die Messung im Betrieb nach (KV2-7). Der Default 15 Minuten ist
  **VERMUTET**, nicht hergeleitet.
- **Rate-Limits bei ElevenLabs** sind nur als untere Schranke bekannt (25 Requests ohne
  429, keine Rate-Limit-Header, BELEGT befund-elevenlabs 4). Fuer den Sweep mit einem
  Abruf je EL-Call und Lauf ist das bei heutigem Volumen unkritisch; bei Skalierung
  braucht KV2-7 dieselbe Drossel-Mechanik, die der Telnyx-Pfad schon hat. **VERMUTET.**
- **`record_type=call-control` fuer den EL-Weg** wurde nicht gemessen (BELEGT
  befund-telnyx, Schlussabschnitt), waehrend `COST_TRUING_REQUIRED_RECORD_TYPES` live
  beide Typen als Pflicht fuehrt. Wenn der EL-Weg diesen Typ nie liefert, ist die
  Pflichtmenge fuer das Profil `el_convai_sip` auf `sip-trunking` zu beschraenken —
  sonst ist `dataComplete` dort NIE wahr und es gibt nie eine Erstattung. **Das ist in
  KV2-4 zu messen, bevor KV2-6 gebaut wird.**
- **Der 13. Telnyx-Beleg ohne zugehoerigen DB-Anruf** (BELEGT befund-telnyx,
  Ueberraschung 2) ist ungeklaert. Er ist der Prototyp einer Kostenzeile ohne Tenant —
  KV2-10 sollte solche Belege zaehlen statt sie zu ignorieren.

**Entscheidungen, die dem Eigentuemer gehoeren (keine technisch richtige Antwort):**

1. Duerfen Lieferantenkosten aus dem Erloes-Buch (`usage_event`) herausgehalten und in
   ein eigenes Kosten-Buch geschrieben werden — oder soll der Auftragswortlaut "BEIDE
   Buecher" woertlich gelten, mit dem Stripe-Meter-Problem aus 2.0?
2. Darf der Reserve-Tarif automatisch nach OBEN gezogen werden (nie nach unten), wenn
   die gemessenen Vollkosten ihn ueberschreiten — oder bleibt jede Tarifaenderung eine
   Handentscheidung (Owner-Entscheidung 2026-07-20)?
3. Frist bis zum Zwangs-Settlement: 24 h (frueher sichtbar, mehr unvollstaendige
   Settlements) oder laenger (mehr Vollbelege, spaeterer Alarm)?
4. Werden die 12 EL-Altanrufe rueckwirkend korrigiert (Ueberbuchung zugunsten des
   Tenants aufloesen) oder bleibt der Stand, wie er ist?
5. Braucht der Tarif einen Grundpreis je Anruf zusaetzlich zum Minutenpreis (Punkt 6.5)
   — das ist eine Produkt-/Preisentscheidung, keine Kostenerfassungsfrage.
6. Soll die SMS-Kostenart (#7) in dieser Kette mitlaufen oder bewusst offen bleiben?
