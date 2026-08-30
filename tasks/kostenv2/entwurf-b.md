# Entwurf B: Anbieter-Kosten als erste Klasse

Stand 2026-08-30. Haltung B: die Kostenart ist ein eigenes Ding im Datenmodell, nicht ein
Zwischenwert in einer Funktion. Grundlage sind `tasks/kostenv2/AUFTRAG.md` (B1-B6, O1-O7)
und die vier Befunde. Alles, was hier BELEGT heisst, traegt Datei:Zeile oder einen
gemessenen Wert aus diesen Dateien; alles andere ist ausdruecklich als VERMUTET oder OFFEN
markiert. Dieser Entwurf ist blind zum zweiten Entwurf geschrieben.

---

## 1. Zielbild

Ein Anruf traegt eine **Menge von Kostenposten**. Ein Posten ist ein eigener,
persistierter Datensatz mit genau fuenf tragenden Eigenschaften: welche **Kostenart**
(aus einem eingefrorenen Katalog), welche **Quelle** (Anbieter + Endpunkt + Feld),
welche **Waehrung**, welcher **Betrag in Anbieter-Mikro-Cent unveraendert**, und **wann
gemessen**, gebunden an genau einen `call_id` und `tenant_id`. Die Gate-Achse
(`usage.costCents`) und der Verbrauchs-Ledger (`usage_event`) sind danach zwei
**Projektionen derselben Menge** statt zweier von Hand parallel gepflegter Buecher: die
Gate-Achse ist "Summe der Posten dieses Anrufs, umgerechnet, gegen den bereits gebuchten
Stand verrechnet", der Ledger ist "je Posten ein append-only Beleg". Der Ist-Abgleich hoert
damit auf, eine Pauschale zu korrigieren, und wird zum **Nachtragen fehlender Posten**;
und die Frage "duerfen wir Geld zurueckgeben?" hoert auf, eine Eigenschaft EINER Messung
zu sein, und wird zur Frage "ist die Postenmenge fuer die Route dieses Anrufs
**vollstaendig**?". Genau diese Verschiebung ist der Riegel gegen B6.

---

## 2. Die Kostenarten-Tabelle

Der Katalog ist eine eingefrorene Tabelle (`src/billing/kostenarten.js`, neu), gebaut nach
dem Vorbild von `src/billing/cost-ledger-map.js` (Pflichtfelder ohne Default, Validierung
beim MODUL-IMPORT, `assertRow`, `cost-ledger-map.js:32-41`). Sie ersetzt jene Datei nicht,
sie ist ihre Erweiterung von "eine Zeile je `usage_event`-kind" zu "eine Zeile je realem
Kostentraeger". `pflicht` heisst: fuer einen Anruf DIESER Route muss dieser Posten
vorliegen, sonst ist die Postenmenge unvollstaendig.

### 2.1 Posten, die je Anruf und Tenant anfallen

| Art | Quelle (Anbieter, Endpunkt, Feld) | Waehrung | Verfuegbar ab | Weg in die Gate-Achse | Weg in den Ledger | pflicht fuer Route |
|---|---|---|---|---|---|---|
| `el_convai_gespraech` | ElevenLabs, `GET /v1/convai/conversations/{id}`, `metadata.cost_fiat`; Aufschluesselung `charging.llm_price` + `charging.platform_price` als Forensik-Detail am Posten | USD (BELEGT: `GET /v1/user/subscription` -> `currency:"usd"`, befund-elevenlabs §1) | **synchron** am Gespraechsende: das vollstaendige `conversation`-Objekt liegt bereits im Speicher in `persistProviderResult` (`src/elevenlabs/outbound.js:1283`), auf BEIDEN Wegen (regulaeres Ende `:1332`, Abbruch `:1452`). Kein zusaetzliches Netz-IO. **Endgueltigkeit in den ersten Minuten OFFEN (O3)** | Posten -> Summenprojektion -> `applyCostCorrectionCents` (`state-ops.js:3798`) -> `bookCents` (`:3609`) bzw. `applyCreditCents` (`:3756`) | `recordUsageEvent` (`state-ops.js:4096`) mit neuem kind `provider_conversation`, **nicht Stripe-meterbar** (s. §2.4) | EL-Outbound |
| `telnyx_sip_leg` | Telnyx, `GET /v2/detail_records?filter[record_type]=sip-trunking`, Join `raw.sip_call_id === call.sipCallId`, Betrag aus `cost`/`rate` | USD (BELEGT: `currency="USD"` auf allen 13 gemessenen Records, befund-telnyx O2) | mit Verzug; heute `COST_TRUING_DELAY_MINUTES=30` (`config.js:1052`) plus Sweep-Takt. BELEGT: 12/12 unserer EL-Anrufe haben genau einen Record, Join exakt, keine Heuristik (befund-telnyx O1) | derselbe Weg | `recordUsageEvent`, kind `provider_telephony`, nicht meterbar | EL-Outbound |
| `telnyx_call_control_leg` | Telnyx, `detail_records`, `record_type=call-control`/`text-to-speech`, Anker `call_control_id`/`telnyx_session_id` (`adapters/telnyx/voice.js:140,160,903`) | USD | mit Verzug, wie oben | derselbe Weg (heute schon so, ueber `bookCorrectionFor`, `cost-truing.js:475`) | wie oben, kind `provider_telephony` | Telnyx-Engine-Outbound, Inbound |
| `ai_token` | eigene Turn-Schleife, `src/llm-usage.js:25`/`:63` | interne Cent-Rechnung | live pro Schleifenrunde | BESTEHT: `trackUsage` -> `bookCents` (`state-ops.js:3655`) | BESTEHT: `recordUsageEvent` kind `ai_token`, Stripe-meterbar | Inbound, Telnyx-Engine-Outbound. **NICHT** EL-Outbound (dort laeuft unsere Schleife gar nicht, AUFTRAG "Topologie") |
| `sms` | eigener Versand, `src/telephony/call-finish.js:353` | `config.billing.smsCostCents` | beim Senden | KEINER — heute strukturell nie vorgesehen (`cost-ledger-map.js`, Zeile `sms`, `gate:false`). Bleibt so; Begruendung: der Preis ist ein Konfigurationswert ohne Anbieterbeleg, und der Betrag ist gegen eine Gespraechsminute vernachlaessigbar. **Als Zeile im Katalog sichtbar, damit die Luecke benannt bleibt** | BESTEHT: kind `sms` | keine (optionaler Posten) |
| `research_fee` | eigene Recherche-Werkzeuge, `src/llm-usage.js:108/:123` -> `addResearchFeeCostCents` (`state-ops.js:3687`) | interne Cent-Rechnung | live beim Werkzeugaufruf | BESTEHT: `bookCents` | heute KEIN `usage_event`. Luecke bleibt als Zeile sichtbar | keine |

### 2.2 Posten, die je Anruf anfallen, aber KEINEN Beleg haben

| Art | Quelle | Waehrung | Verfuegbar | Gate / Ledger | Begruendung |
|---|---|---|---|---|---|
| `play_tts_zeichen` | eigene Synthese (`src/tts/directive-synth.js`), gezaehlt als **Zeichen** ueber `recordTtsCharacters` (`state-ops.js:4464`) | keine — es gibt repo-weit **keinen** Preis-Parameter (BELEGT, `cost-ledger-map.js`, Zeile `play_tts_characters`) | sofort | **weder noch** | Ohne Preis gibt es keinen Betrag, den man buchen koennte; eine erfundene Zahl waere schlechter als keine. Bleibt Kontingent-Zaehler mit Schwellenwarnung. Diese Zeile ist **nicht** der ConvAI-Pfad — die Verwechslung ist naheliegend und in befund-code §3 ausdruecklich auseinandergehalten |

### 2.3 Plattform-Kosten ohne Tenant-Dimension — bewusst NICHT umgelegt

Alle drei stehen im Katalog mit `tenantUmlage: false` und der Begruendung im Feld
`preisquelle`, damit sie nicht "vergessen" aussehen, sondern "entschieden".

| Art | Quelle | Waehrung | Verfuegbar | Warum nicht je Tenant |
|---|---|---|---|---|
| `el_grundgebuehr` | ElevenLabs `GET /v1/user/subscription`, `next_invoice.subtotal_cents` (BELEGT 600 = 6,00 USD, Starter, befund-elevenlabs §3) | USD | monatlich | Ein fester Monatsbetrag geteilt durch Tenants macht die Kostendecke EINES Tenants abhaengig vom Verhalten der ANDEREN: sein Gate-Wert stiege, ohne dass er telefoniert hat. Das widerspricht dem Eigentuemer-Wortlaut ("was ER in diesen zwei Minuten verursacht hat") direkt. Bleibt Plattform-Beobachtung wie heute (`PLATFORM_FIXED_COST_CENTS_PER_MONTH`, reine Anzeige, `routes/api-billing.js:132-152`, `listPriceNotBilled:true`, BELEGT befund-gate §4) |
| `did_miete` | Telnyx-Nummernpreis am Nummern-Datensatz (`number.monthlyCostCents`) | USD | monatlich | Hier ist die Tenant-Zuordnung eindeutig (eine Nummer gehoert einem Tenant), die Buchung fehlt aber und ist als GEPARKT dokumentiert. Der Katalog fuehrt sie mit `gate:false, ledger:true` (kind `number_month`, `metering.js:166`) und der Notiz, dass heute KEINE reale Nummer einen gelernten Preis traegt (BELEGT, `cost-ledger-map.js`, Zeile `number_month`). **Kein Teil dieser Kette** — sie ist keine Gespraechskostenart und wuerde die Phasenkette aufblaehen |
| `tts_kontingent` | `TTS_CHARACTER_QUOTA` (`config.billing.ttsCharacterQuota`) | keine | laufend | Plattformweiter Zaehler ohne Tenant-Dimension (BELEGT befund-gate §4). Warnung ja, Buchung nein |

### 2.4 Der Riegel gegen ein neues Stripe-Meter

`flushMeters` (`src/billing/meter.js:65`) meldet **jedes** `kind` an `billing.reportMeter`.
Zwei neue kinds (`provider_conversation`, `provider_telephony`) wuerden damit ungefragt zu
zwei neuen Stripe-Metern und beim Kunden abgerechnet werden. Deshalb gehoert zum Katalog
eine zweite eingefrorene Menge `STRIPE_METERED_KINDS`, und `flushableMeterEvents`
(`meter.js:65`, Zeilenquelle) filtert dagegen. Der Ledger bekommt damit echte, append-only
Kostenbelege, ohne dass ein einziges zusaetzliches Stripe-Ereignis entsteht.
Ohne diesen Riegel ist die "Ledger-Projektion" ein Geldschaden, kein Fortschritt.

---

## 3. Der Abgleich: nachbuchen, zurueckgeben, Beweis

### 3.1 Die Projektion

Zwei reine Funktionen (neu, `src/billing/kosten-projektion.js`):

- `postenSummeMikroCents(posten)` — Summe der Betraege, alle in Anbieter-Waehrung, ohne
  Umrechnung (die Umrechnung lebt weiterhin an genau einer Stelle,
  `convertProviderMicroToBucketCents`, `state-ops.js:3705`).
- `postenVollstaendig(call, posten, katalog)` — liefert `true`, wenn fuer die **Route**
  des Anrufs jede als `pflicht` markierte Kostenart mindestens einen Posten mit
  `zustand: gemessen` hat. Die Route wird aus dem Anruf abgeleitet (EL-Outbound:
  `call.sipCallId !== null`; Telnyx-Outbound: `call.callControlId !== null`; Inbound:
  `direction`), nicht aus einem Flag, das jemand setzen kann.

### 3.2 Die Buchung — genau eine, inkrementell

Gebucht wird **je Anruf einmal pro Postenzuwachs**, nie je Quelle einzeln. Der bestehende
Cent-Weg bleibt unangetastet: `applyCostCorrectionCents` (`state-ops.js:3798`) rechnet
`deltaCents = bucketCents - estimatedCostCents` und traegt bereits die geforderte
Asymmetrie (`deltaCents < 0 && !dataComplete` -> `booked:false`, `:3813`).

Der Anruf bekommt ein zusaetzliches Feld `trueUpBookedCents` (Default 0). Bei jedem
Zuwachs wird aufgerufen:

- `actualCostMicroCents` = `postenSummeMikroCents(posten)` (ALLE Posten, nicht nur der neue)
- `estimatedCostCents` = `call.estimatedCostCents + call.trueUpBookedCents`
  (also: der Betrag, der bisher tatsaechlich auf der Achse steht)
- `dataComplete` = `postenVollstaendig(...)`
- `chargeAnchors` = `chargeAnchorsOfCall(call)` wie heute

Danach wird `trueUpBookedCents += deltaCents`, aber **nur wenn `booked === true`**. Damit
ist die Buchung monoton, wiederholbar und kann nie doppelt zaehlen: kommt der
Telnyx-Posten 30 Minuten nach dem ElevenLabs-Posten, wird genau die Differenz gebucht.
Es entsteht **kein dritter Cent-Schreibweg** — `bookCents` und `applyCreditCents` bleiben
die einzigen zwei Kanten (BELEGT befund-code §1).

### 3.3 Wann nachgebucht, wann zurueckgegeben

| Fall | Verhalten | Beweis |
|---|---|---|
| Summe der Posten > bereits gebucht | **immer** nachbuchen | keiner noetig. Unterschaetzung wird bedingungslos geheilt (Bestandsregel, `state-ops.js:3789-3793`) |
| Summe der Posten < bereits gebucht | nur wenn `postenVollstaendig === true` **und** jeder Pflicht-Posten einen Beleg mit positiver Mengenangabe traegt (`billed_sec > 0` beim Telnyx-Posten, `call_duration_secs > 0` beim EL-Posten) **und** `isBookableCents(call.estimatedCostCents)` | die drei Bedingungen sind die Mehr-Traeger-Fassung des heutigen `refundProven` (`cost-truing.js:452`). Der Unterschied: Bedingung 1 ist jetzt eine Aussage ueber eine **Menge**, nicht ueber **eine** Messung |
| Summe der Posten < bereits gebucht, Menge unvollstaendig | **nichts wird zurueckgegeben**, der Rest-Uebertrag `costCorrectionMicroCentsRem` bleibt bit-gleich (Bestandsverhalten, `state-ops.js:3813`) | — |
| ein Posten kommt spaeter und macht die Menge vollstaendig | die Ruecknahme wird beim naechsten Zuwachs nachgeholt, weil gegen `estimated + trueUpBooked` gerechnet wird | — |

---

## 4. Wenn ein Anbieter-Beleg NIE kommt

Der heutige Mechanismus terminiert bereits: `costTruingAttempts` ist PERSISTIERT
(`state-ops.js:334`, ausdruecklich gegen den Free-Tier-Restart), `COST_TRUING_MAX_ATTEMPTS`
= 5 (`config.js:1070`), danach `costTruedSource = 'unavailable'` und `costTruedAt` gesetzt.
Dieser Mechanismus wird von der Postenmenge geerbt, aber **pro Kostenart**:

1. Jeder Pflicht-Posten, der bei Anrufende nicht sofort verfuegbar ist, wird als
   **erwarteter Posten** angelegt: `zustand: erwartet`, Betrag `null` (NIE 0 — eine 0 waere
   eine erfundene Messung, dieselbe Regel wie `cost_micro_cents` in `usage_event`,
   `schema.sql:855-862`).
2. Jeder Sweep-Versuch erhoeht `versuche` am Posten. Nach `KOSTENPOSTEN_MAX_VERSUCHE`
   (neuer Konfigwert, Default 5, gleiche Groesse wie heute) **oder** wenn der Anruf aelter
   ist als `KOSTENPOSTEN_MAX_ALTER_H` (Default 72 h, Grund: das Telnyx-Belegfenster ist
   heute schon auf `PROVIDER_COST_RECORD_WINDOW_DAYS = 7` begrenzt, `cost-truing.js:119`)
   geht der Posten auf `zustand: beleg_ausgeblieben`.
3. Dann gilt: der Anruf wird **geschlossen** (`costTruedAt` gesetzt, kein Kandidat mehr —
   er bleibt nicht ewig offen), seine Postenmenge ist **dauerhaft unvollstaendig**, und
   damit gilt bis in alle Zukunft: **es wird nie Geld zurueckgegeben**. Die gebuchte
   Schaetzung bleibt vollstaendig stehen. Sie verfaellt nicht, sie wird nicht stillschweigend
   auf einen Teilbeleg heruntergesetzt, und sie wird auch nicht heimlich erhoeht.
4. Der Anruf zaehlt in einen benannten Zaehler `unbelegt` je Kostenart, und dieser Zaehler
   ist selbst alarmierbar (§5) und schliesst den Anruf aus der Tarif-Stichprobe aus (§6).

Der Preis, bewusst getragen: bei dauerhaftem Belegausfall zahlt der Tenant die Schaetzung,
auch wenn sie zu hoch war. Das ist die sichere Fehlrichtung, aber sie darf nicht unsichtbar
sein — deshalb ist Punkt 4 kein Schmuck, sondern Teil der Entscheidung.

---

## 5. Der Alarmweg

Der belegte Befund B3 lautet: `audit()` (`src/util.js:60`) ist ausschliesslich
`console.log`, die `audit_log`-Tabelle bekommt davon nichts, es ist keine SMS vorgesehen,
und die Eskalationsstufe haengt an `sweepsBelowThreshold` — einem **prozesslokalen**
Zaehler, den jeder Render-Neustart nullt (`cost-truing.js:410-421`, das Restrisiko steht
dort woertlich im Kommentar). Ergebnis: 11 Tage 0 % Deckung, unbemerkt.

Der Entwurf baut dafuer **keinen neuen Kanal**, sondern haengt sich an den, der bereits
belastbar ist:

1. **Kanal**: `meldeBetreiberAlarm` (`src/telephony/outage-report.js:111`) — WARN + Audit +
   **Mail** + **SMS** in einer Funktion, ausdruecklich als "EIN Meldeweg (G5)" gebaut.
   Der SMS-Teil laeuft ueber `sendFailSoftAlertSms` (`src/telephony/alert-sms.js:64`) mit
   Empfaenger `PLATFORM_ALERT_SMS_TO` und dem beim Boot gebundenen Alarm-Absender
   (`platformAlertSender`, `alert-sms.js:52`).
2. **Durabilitaet**: der Entprell-/Zustandsmarker ist die Tabelle `outage_alert`
   (`src/db/schema.sql:789-800`) mit `first_seen_at`, `last_attempt_at`, `reported_at`,
   `delivered_channels` und einem Unique-Index auf offene Zeilen je `code`. Sie ueberlebt
   den Neustart — genau die Eigenschaft, die `sweepsBelowThreshold` fehlt. Der prozesslokale
   Zaehler wird ersatzlos durch das `first_seen_at` dieses Markers ersetzt: "seit X Stunden
   unter der Schwelle" ist eine Datenaussage, keine Prozesserinnerung.
3. **Drei Alarmklassen**, alle mit eigenem `code` und damit eigener Entprellung:
   - `kosten:deckung-unter-schwelle` — wie heute, aber ueber den echten Kanal.
   - `kosten:posten-fehlt:<art>` — fuer eine Kostenart, deren Belegquote unter die Schwelle
     faellt. Das ist die Klasse, die B1 gemeldet haette.
   - `kosten:erfassung-tot:<art>` — **der Herzschlag, und der eigentliche Fortschritt
     gegenueber heute**: es gab in den letzten N Stunden Anrufe auf einer Route, fuer die
     der Katalog diese Kostenart als `pflicht` fuehrt, und es wurde **kein einziger Posten
     dieser Art** angelegt. Das ist der Zustand vom 19.08.2026, und er ist aus Daten
     ableitbar, ohne dass jemand vorher an ihn gedacht haben muss.
4. **Der Kanal wird selbst geprueft**: der bestehende Alarmkanal-Selbsttest
   (`outageAlertSelfTestIntervalMs`, `outage-report.js:284`) deckt Mail und SMS periodisch
   ab. Ein stiller Kanal ist damit unterscheidbar von "es gab nichts zu melden" — sonst
   sieht der Ausfall des Melders aus wie Gesundheit.
5. **Audit dauerhaft**: `makeCostTruing` (`src/server.js:114`) bekommt heute `audit` aus
   `util.js`. Der Entwurf injiziert stattdessen einen Sink, der zusaetzlich ueber
   `makeAuditStore(...).record` (`src/audit-store.js:3`) in `audit_log` schreibt — derselbe
   Schreibpfad, der fuer `login`/`did_released` nachweislich funktioniert (B3, Gegenprobe).

**Zeit bis zur Sichtbarkeit:** Sweep-Takt (`COST_TRUING_SWEEP_INTERVAL_MS`, live stuendlich)
plus Entprellung (`COST_ALERT_DEBOUNCE_MS`, Default 24 h, `config.js:1094`). Der Herzschlag
braucht ein eigenes, kuerzeres Fenster, sonst ist "binnen Stunden" nicht erfuellt:
`KOSTEN_HEARTBEAT_FENSTER_H` (Default 6) mit eigener Entprellung von 6 h. Das ist die eine
Stelle, an der der Entwurf einen neuen Konfigwert braucht statt einen bestehenden zu erben.

---

## 6. Tarif- und Preisherleitung

### 6.1 Warum die heutige Herleitung strukturell falsch ist

`VOICE_TARIFF_DEFAULT_CENTS=30` stammt aus einer Messung der ALTEN Telnyx-Budget-Engine
(BELEGT, B5). Der Drift-Waechter (`src/billing/cost-calibration.js`) misst heute einen
**reinen Minutensatz** als p95 je Ziel-Praefix und vergleicht ihn gegen
`voiceTariffDomesticCents` (`cost-calibration.js:155`). Fuer den EL-Weg ist das die falsche
Kurvenform: die EL-Kosten haben einen grossen **fixen** Anteil je Anruf (Prompt-Cache-Write,
BELEGT B2: im 8-s-Anruf 0,0099 USD, im 76-s-Anruf 0,1333 USD; 16,0 US-ct/min im teuersten,
11,81 US-ct/min im Schnitt). Telnyx verschaerft es von der anderen Seite, weil es **immer
auf die volle Minute aufrundet** (BELEGT befund-telnyx O2: `call_sec=35`, `billed_sec=60`).
Ein einzelner Minutensatz kann beide Effekte nicht abbilden, egal wie oft man ihn nachzieht.

### 6.2 Der Satz wird zweiteilig

Der Schaetzsatz wird zu einem Paar je Route:
`grundbetragCents + satzCentsProMin * angefangeneMinuten`.
Fuer den Telnyx-Anteil ist der Grundbetrag inhaltlich der 60-Sekunden-Sockel, fuer den
EL-Anteil der Cache-Write-Sockel. Beide sind aus derselben Postenmenge herleitbar, die §3
ohnehin fuehrt — **keine zweite Datenquelle**.

### 6.3 Wie er nachgezogen wird, ohne dass jemand daran denken muss

Nachgezogen wird der **Anlass**, nicht der Wert. Owner-Entscheidung 3 (2026-07-20,
woertlich in `cost-calibration.js:1-8`) verbietet die rollende Selbstkalibrierung, und die
Begruendung traegt weiterhin: ein Tarif, der sich aus Anrufen speist, die das Gate
durchgelassen hat, ist eine Rueckkopplung.

- Der Drift-Waechter bekommt die Postenmenge als Stichprobe statt des einen
  `costTruedSource === DETAIL_RECORDS`-Werts (`cost-calibration.js:59`), und er rechnet **je
  Route**, nicht nur je Praefix. Stichprobe ist nur, was `postenVollstaendig` erfuellt —
  eine unvollstaendige Menge ist systematisch zu niedrig und wuerde den Waechter gegen
  seine eigene Datenluecke alarmieren lassen (dieselbe Begruendung wie heute bei
  `incomplete`, `cost-calibration.js:50-56`).
- Ein `underestimate`-Befund geht ueber den Kanal aus §5 raus und **nennt das konkrete
  Zahlenpaar**, das die Stichprobe am p95 gedeckt haette. Der Eigentuemer setzt zwei
  Env-Werte, mehr nicht.
- Zwei Ausloeser, wie heute: beim Boot (`src/boot.js:289`) und in jedem Sweep
  (`cost-truing.js:716`). Der Boot allein genuegt nicht, wenn der Dienst wochenlang
  durchlaeuft — das steht so schon im Bestand und bleibt.
- Der Boden bleibt: `voiceTariffFloorFindings` (`src/boot-guard.js:249`) meldet, wenn der
  Inlandssatz unter `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` liegt. Der Floor selbst ist heute
  aus der Assistant-Konfiguration hergeleitet und liegt UNTER den heutigen Vollkosten
  (BELEGT B5) — er wird in Phase KV2-P8 aus der Postenmenge neu hergeleitet.

**Automatisches Anheben** (nie Senken) waere die einzige Variante, die ohne Owner-Handgriff
auskaeme. Sie ist hier NICHT vorgesehen, weil sie Owner-Entscheidung 3 beruehrt — sie steht
als offene Entscheidung in §9.

---

## 7. Die Phasenkette

Jede Phase ist einzeln lieferbar, einzeln mergebar, und ihr Abnahmekriterium ist **ohne
echten Anruf** pruefbar (Fixture + `node:test`). Die Sperrwirkung wird nie unterbrochen:
keine Phase entfernt oder lockert ein Gate; die Phasen P0-P4 aendern **kein** gebuchtes Cent,
und erst P5 schaltet die Buchung um — mit dem Vollstaendigkeitspraedikat als Vorbedingung
im selben Commit.

### KV2-P0 — Beleg-Attrappe und Vorher-Messung
**Liefert:** Fixtures fuer (a) eine EL-`conversation`-Antwort mit `metadata.cost_fiat`,
`metadata.cost` und vollstaendigem `metadata.charging` (Werte aus den 8 gemessenen Anrufen,
befund-elevenlabs §1), (b) einen Telnyx-`sip-trunking`-Roh-Record mit `sip_call_id`,
`billed_sec`, `cost`, `rate`, `currency` (Feldform aus befund-telnyx O1). Erweitert
`test/fixtures/elevenlabs-conversations.js`, das es bereits gibt.
**Abnahme:** ein Test, der mit diesen Fixtures den HEUTIGEN Pfad faehrt und den Defekt
festhaelt: der Sweep zaehlt den EL-Anruf als `uebersprungen`, setzt `anfragen=0`, und
`applyCostCorrectionCents` wird nie aufgerufen. Der Test ist gruen, weil er den Ist-Zustand
behauptet — er wird in P4/P5 umgeschrieben. Ohne diese Vorher-Messung belegt keine spaetere
Phase, dass sie etwas geheilt hat.

### KV2-P1 — Kostenart-Katalog
**Liefert:** `src/billing/kostenarten.js` mit allen Zeilen aus §2 (auch den nicht
umgelegten), Pflichtfelder ohne Default, Validierung beim Modul-Import nach dem Vorbild
`cost-ledger-map.js:32-41`. Zusaetzlich `STRIPE_METERED_KINDS` (§2.4). Nichts liest den
Katalog produktiv.
**Abnahme:** (1) eine Zeile ohne `waehrung`/`pflicht`/`quelle` reisst den Import ab.
(2) Ein Test bindet den Katalog an eine **unabhaengige** Quelle: fuer jede zur Laufzeit
erreichbare Route (EL-Outbound wenn `config.voice.elevenLabsOutbound` aktivierbar ist,
Telnyx-Outbound, Inbound je `VOICE_ENGINE`) muss mindestens eine `pflicht`-Zeile existieren
— eine aktive Route ohne Pflicht-Kostenart ist ein **Bauzeit**-Fehler. Das schliesst genau
die in befund-code §5 belegte Luecke ("ein voellig neuer Kostentraeger geht live, niemand
legt einen kind an"). (3) `STRIPE_METERED_KINDS` enthaelt exakt die vier heutigen kinds.

### KV2-P2 — Posten-Speicher
**Liefert:** Tabelle `call_cost_item` (`src/db/schema.sql`, DDL laeuft beim Boot
automatisch): `id`, `tenant_id` (FK + RLS), `call_id`, `art`, `zustand`
(`erwartet|gemessen|beleg_ausgeblieben`), `betrag_mikro_cents BIGINT NULL`, `waehrung`,
`quelle`, `beleg_ref`, `versuche INT NOT NULL DEFAULT 0`, `gemessen_at`, `detail JSONB NULL`
(Forensik: `llm_price`/`platform_price`/`billed_sec`), Unique-Index `(call_id, art)`.
Store-Ops `recordCallCostItem` (idempotent, upsert nur nach vorne: `erwartet -> gemessen`
ist erlaubt, `gemessen -> erwartet` nie), `callCostItems(callId)`. Beide Backends
(`json.js`, `pg.js`). Nichts liest die Tabelle.
**Abnahme:** Idempotenz (zweiter Aufruf mit derselben `(callId, art)` erzeugt keine zweite
Zeile und aendert nichts), Zustands-Monotonie, RLS (Fremd-Tenant sieht 0 Zeilen),
json/pg-Shape-Parity (dasselbe Objekt aus beiden Backends).

### KV2-P3 — ElevenLabs-Posten schreiben
**Liefert:** `persistProviderResult` (`src/elevenlabs/outbound.js:1283`) liest
`conversation.metadata.cost_fiat` und schreibt EINEN Posten `el_convai_gespraech`
(`zustand: gemessen`, Betrag in USD-Mikro-Cent als Ganzzahl, `detail` mit `llm_price` und
`platform_price`), direkt neben dem bestehenden `store.recordSipCallId`-Aufruf (`:1312`).
Zusaetzlich wird der erwartete Posten `telnyx_sip_leg` als `erwartet` angelegt. Weiterhin
**inert**: kein Gate, kein Ledger, keine Buchung liest die Posten.
**Abnahme:** Fixture-Test: aus der P0-Antwort entsteht genau ein `gemessen`-Posten mit dem
erwarteten Mikro-Cent-Integer und `waehrung: "USD"`. Fehlt `cost_fiat`, ist es kein Float,
ist es negativ oder ist es `0` bei `call_duration_secs > 0`, entsteht **kein** Posten
(nicht ein 0-Posten) und eine WARN-Zeile. Gegenprobe: `usage.costCents` und
`usage_event` sind vor und nach dem Aufruf **byte-identisch**.

### KV2-P4 — Telnyx-SIP-Posten einsammeln
**Liefert:** (a) `providerLegIdOf` (`src/billing/cost-truing.js:138`) lernt `call.sipCallId`
als dritte Alternative; (b) der Telnyx-Adapter bekommt ein zweites Anker-Feld: `sip_call_id`
als direkten Primaerschluessel-Vergleich fuer `sip-trunking`-Records, neben dem bestehenden
`ANCHOR_ID_FIELD = "call_control_id"` (`adapters/telnyx/voice.js:140`, Zuordnung `:903`).
Der Vergleich ist strikte String-Gleichheit — BELEGT ausreichend (12/12 Treffer, genau
einer je ID, befund-telnyx O1); (c) das Ergebnis wird als Posten `telnyx_sip_leg`
geschrieben, nicht mehr nur als Skalar `actualCostMicroCents`.
**Der kritische Teil:** `bookCorrectionFor` (`cost-truing.js:475`) wird fuer Anrufe der
EL-Route in dieser Phase **ausdruecklich nicht** aufgerufen. Diese Phase sammelt, sie bucht
nicht. Genau hier liegt die B6-Falle, und sie wird durch eine Reihenfolge-Entscheidung
entschaerft, nicht durch Sorgfalt.
**Abnahme:** Fixture-Test mit einem EL-Anruf plus P0-Telnyx-Record: es entsteht ein
`gemessen`-Posten `telnyx_sip_leg` mit 4,01 US-ct, **und** `usage.costCents` ist unveraendert,
**und** `applyCostCorrectionCents` wurde nachweislich nicht aufgerufen (Spion). Zweiter Test:
ein Telnyx-Engine-Anruf (mit `callControlId`) verhaelt sich exakt wie vorher — Regressionsschutz.

### KV2-P5 — Projektion, Vollstaendigkeitspraedikat, Umschaltung der Buchung
**Liefert:** `src/billing/kosten-projektion.js` (§3.1), das Anruf-Feld `trueUpBookedCents`,
und die inkrementelle Buchung (§3.2) ueber das **unveraenderte**
`applyCostCorrectionCents`. `refundProven` (`cost-truing.js:452`) wird durch
`postenVollstaendig` ersetzt; die Telnyx-Route liefert dieselbe Antwort wie heute (ihre
Pflicht-Menge hat genau ein Element).
**Abnahme — das ist der B6-Test, ohne echten Anruf:**
1. EL-Anruf, `estimatedCostCents = 30`, **nur** `telnyx_sip_leg` (4,01 US-ct) gemessen,
   `el_convai_gespraech` `erwartet` -> Delta ist negativ -> `booked === false`,
   `usage.costCents` unveraendert, `costCorrectionMicroCentsRem` bit-gleich.
2. Derselbe Anruf, **nur** `el_convai_gespraech` (7,50 US-ct) gemessen -> ebenfalls negativ,
   ebenfalls nicht gebucht.
3. Beide Posten gemessen -> Summe 11,51 US-ct -> umgerechnet -> genau EINE Gutschrift,
   und `trueUpBookedCents` traegt sie.
4. Reihenfolge-Test: erst EL, dann Telnyx -> Endstand identisch zu Fall 3 (keine
   Doppelbuchung).
5. Ein Anruf, dessen Ist-Summe die Schaetzung **uebersteigt**, wird auch bei
   unvollstaendiger Menge sofort nachgebucht.

### KV2-P5b — Anker-Symmetrie der positiven Nachbuchung
**Liefert:** die in befund-gate §2 belegte Asymmetrie wird geschlossen: `bookCents`
(`state-ops.js:3609`) ignoriert `chargeAnchors`, waehrend `applyCreditCents` (`:3756`) sie
auswertet. Eine positive Nachbuchung aus einem abgelaufenen Perioden-/Monatsfenster
belastet deshalb die LAUFENDE Periode. Das ist heute folgenlos (weil fuer EL nie korrigiert
wird) und wird mit P5 akut. Die Phase legt fest, ob die Nachbuchung ausserhalb ihres Ankers
nur die Lebenszeit-Achse trifft (symmetrisch zur Gutschrift) — das ist eine
Owner-Entscheidung (§9), die Phase implementiert die getroffene.
**Abnahme:** ein Test, den es repo-weit heute nicht gibt (BELEGT: `grep` ueber
`test/ks-p5-current-period-credits.test.js` findet nur Gutschrift-Faelle): positive
Korrektur mit Anker aus der Vorperiode -> die laufende Perioden-Achse verhaelt sich
gemaess der Entscheidung, nachweisbar an `budgetPeriodUsageCents` vor/nach.

### KV2-P6 — Verfall und Abschluss
**Liefert:** `versuche`/`KOSTENPOSTEN_MAX_VERSUCHE`/`KOSTENPOSTEN_MAX_ALTER_H` am Posten,
Uebergang nach `beleg_ausgeblieben`, Schliessen des Anrufs (`costTruedAt`), der benannte
Zaehler `unbelegt` je Kostenart in der Sweep-Bilanz (neben `gemessen`/`uebersprungen`).
**Abnahme:** Fixture-Anruf, dessen `telnyx_sip_leg` nie kommt: nach N Sweeps ist der Posten
`beleg_ausgeblieben`, der Anruf geschlossen und **kein Kandidat mehr**, `usage.costCents`
traegt weiterhin die volle Schaetzung, und keine spaetere Ausfuehrung gibt je Geld zurueck.
Zweiter Test: der Anruf erscheint im `unbelegt`-Zaehler und wird von der Tarif-Stichprobe
ausgeschlossen.

### KV2-P7 — Alarmweg und Gegenprobe
**Liefert:** die drei Alarmklassen aus §5 ueber `meldeBetreiberAlarm`
(`outage-report.js:111`) mit dem durablen `outage_alert`-Marker; Ersatz des prozesslokalen
`sweepsBelowThreshold`; der DB-Audit-Sink fuer `makeCostTruing` (`server.js:114`);
Erweiterung von `src/billing/cost-cross-check.js` (heute strukturell Telnyx-only, BELEGT
befund-code Bruch 4) um eine **Deckungs**-Gegenprobe je Kostenart. Bewusst KEINE
Geld-Gegenprobe gegen den EL-Konto-Endpunkt: `GET /v1/user/subscription` zaehlt
konto-weit und in Credits/Zeichen, `current_overage` bleibt strukturell 0, solange das
Plankontingent nicht ueberschritten ist (BELEGT befund-elevenlabs §5) — er taugt nicht.
**Abnahme:** mit Attrappen fuer `messaging` und `mailer`: (1) ein Zustand "6 h Anrufe auf
der EL-Route, 0 Posten `el_convai_gespraech`" erzeugt **genau einen** Alarm auf beiden
Kanaelen; (2) der zweite Sweep im Entprellfenster erzeugt keinen; (3) nach einem simulierten
Neustart (neue Store-Instanz, gleiche Daten) ist der Marker noch offen und `first_seen_at`
unveraendert — der Zaehler wird nicht genullt; (4) `audit_log` traegt die Zeile.

### KV2-P8 — Zweiteiliger Tarif und Drift je Route
**Liefert:** `grundbetragCents` + `satzCentsProMin` je Route, hergeleitet aus vollstaendigen
Postenmengen; Drift-Report je Route statt nur je Praefix; der Boot-Guard-Befund nennt das
konkrete Zahlenpaar; Neuherleitung von `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` aus der
Postenmenge statt aus der Assistant-Konfiguration (B5). Kein Auto-Apply.
**Abnahme:** Stichprobe aus den 8 gemessenen EL-Anrufen als Fixture (befund-elevenlabs §1
plus befund-telnyx O2): der Report schlaegt ein Paar vor, das **alle acht** am p95 deckt,
und die heutige Einzahl 30 ct erzeugt bei kurzen Anrufen einen `overestimate`- und bei
einem konstruierten Langanruf keinen `underestimate`-Befund. Zweiter Test: eine Stichprobe
mit unvollstaendigen Mengen wird **nicht** als Stichprobe akzeptiert.

### KV2-P9 — Ledger-Projektion
**Liefert:** je gemessenem Posten ein `usage_event` mit den neuen kinds
`provider_conversation`/`provider_telephony`, geschrieben ueber den **einen** Schreiber
`recordUsageEvent` (`state-ops.js:4096`), plus der Filter in `flushableMeterEvents`
(`meter.js:65`) gegen `STRIPE_METERED_KINDS`. Damit sind Gate-Achse und Ledger zwei
Projektionen derselben Postenmenge — das Zielbild ist erst hier vollstaendig.
**Abnahme:** (1) ein gemessener Posten erzeugt genau einen `usage_event`; (2) ein
`erwartet`-Posten erzeugt keinen; (3) **entscheidend**: `flushMeters` mit einem Store, der
beide neuen kinds enthaelt, ruft `billing.reportMeter` fuer diese kinds **nie** auf
(Spion), waehrend `voice_minute`/`ai_token` unveraendert gemeldet werden.

---

## 8. Was dieser Entwurf bewusst NICHT tut

1. **Keine rollende Selbstkalibrierung des Tarifs.** Owner-Entscheidung 3 vom 2026-07-20
   steht woertlich in `cost-calibration.js:1-8`, und ihre Begruendung (Rueckkopplung ueber
   Anrufe, die das Gate durchgelassen hat) ist unveraendert gueltig.
2. **Keine Umlage der ElevenLabs-Grundgebuehr, der DID-Miete und des TTS-Kontingents auf
   Tenants.** Begruendung in §2.3. Sie stehen im Katalog mit Begruendung, sind also
   sichtbar entschieden, nicht vergessen.
3. **Kein dritter Cent-Schreibweg.** Alles laeuft ueber `bookCents` (`state-ops.js:3609`)
   und `applyCreditCents` (`:3756`) — die zwei belegten Kanten (befund-code §1).
   `applyCostCorrectionCents` wird **nicht umgeschrieben**, nur anders aufgerufen.
4. **Kein Backfill der 12 EL-Altanrufe.** Zwei Gruende: die in befund-gate §2 belegte
   Anker-Asymmetrie wuerde alte Kosten der laufenden Periode zuschlagen, und alle
   betroffenen Accounts sind unsere eigenen. Stattdessen ein einmaliger Forensik-Report.
   (Owner-Entscheidung, §9.)
5. **Kein Umbau am Inbound-Pfad.** BELEGT (befund-gate §3, Code + DB-Gegenprobe): Inbound
   laeuft nie ueber ElevenLabs. B1/B2 sind eine reine Outbound-Luecke. Ein
   "sicherheitshalber"-Umbau waere Arbeit ohne Befund.
6. **Kein Live-Gate auf ElevenLabs-Ist-Kosten waehrend des Gespraechs.** Der Posten
   existiert erst am Gespraechsende. Die Bremse mitten im Anruf bleibt, was sie ist:
   `liveVoiceSpendCents` auf der Schaetzung plus die aus dem Restguthaben abgeleitete
   `maxDurationS` (BELEGT B4). Eine Kostenart, die erst nach dem Anruf bekannt wird, kann
   diesen Anruf nie mehr blockieren — nur den naechsten (BELEGT befund-gate §1).
7. **Kein Aufspalten von `cost_fiat` in zwei gebuchte Posten.** `llm_price + platform_price
   = cost_fiat` ist nachgerechnet (befund-elevenlabs §1); zwei gebuchte Posten waeren zwei
   Rundungspfade fuer eine Zahl. Die Aufschluesselung wandert ins `detail`-Feld.
8. **Keine Geld-Gegenprobe gegen den ElevenLabs-Konto-Endpunkt.** BELEGT untauglich
   (befund-elevenlabs §5).
9. **Kein Anfassen der Gates, der Offenlegung, von `callee_is_owner` oder der
   Signaturpruefung.**

---

## 9. Pre-Mortem: ein Jahr weiter, die Umstellung ist gescheitert

**R1 — `cost_fiat` war beim Lesen noch nicht endgueltig, und wir haben den Beleg
geloescht.** Der Posten wird synchron in `persistProviderResult` geschrieben; auf dem
Abbruchweg ruft `endActiveCall` unmittelbar danach `endConversation` — ein DELETE beim
Anbieter (`src/elevenlabs/outbound.js:1452-1460`). War der Wert dort noch nicht final, ist
er unwiederbringlich zu niedrig gebucht. O3 ist **nicht** geschlossen: befund-elevenlabs §2
konnte nur Stabilitaet ab ~4 h 20 min belegen, nicht die ersten Minuten, weil es keinen
frischen Anruf gab.
*Massnahme:* der Posten traegt `gemessen_at` und den Abstand zum Gespraechsende. Auf dem
regulaeren Weg (dort wird nichts geloescht) holt der naechste Sweep den Wert **ein zweites
Mal** und meldet eine Abweichung als eigenen Befund. Fuer den Abbruchweg bleibt ein
*akzeptiertes Restrisiko*, bis O3 an einem echten Testanruf gemessen ist — die Messung ist
in §10 als offene Aufgabe benannt, nicht als Annahme versteckt.

**R2 — das Vollstaendigkeitspraedikat wird zur Dauersperre.** Kommt ein Pflicht-Posten
systematisch nie, bekommt nie ein Tenant Geld zurueck, und die Ueberzahlung wird
strukturell statt zufaellig. *Massnahme:* §4 Punkt 4 — der `unbelegt`-Zaehler ist selbst
alarmierbar (§5, Klasse `kosten:posten-fehlt`). Die sichere Fehlrichtung bleibt sichtbar.

**R3 — Doppelbuchung durch Nebenlaeufigkeit.** Sweep und Anrufende schreiben gleichzeitig.
*Massnahme:* Unique-Index `(call_id, art)` plus die monotone Basis
`estimatedCostCents + trueUpBookedCents` — zwei gleichzeitige Laeufe koennen nur denselben
Endstand erreichen, nie den doppelten. Zusaetzlich haelt der bestehende Laufriegel in
`cost-truing.js` die Sweeps auseinander.

**R4 — ElevenLabs drosselt den zweiten Abruf.** Nur eine **untere Schranke** ist bekannt:
25 Requests in wenigen Sekunden ohne 429 und ohne Rate-Limit-Header (befund-elevenlabs §4).
*Massnahme:* der tragende Posten braucht **null** zusaetzliche Requests (er liegt im
Speicher). Nur der Bestaetigungs-Abruf aus R1 kostet einen, und er unterliegt derselben
Kandidatenbegrenzung wie der bestehende Sweep. *Akzeptiertes Restrisiko:* die reale Grenze
ist ungemessen.

**R5 — der Katalog-Test ist zirkulaer.** Bindet die "unabhaengige Quelle" (KV2-P1) nur
wieder an dieselbe Config, faellt ein neuer Anbieter erneut durch. *Massnahme:* die Quelle
ist die Menge der **zur Laufzeit erreichbaren Routen**, und der Test ist ein Bauzeit-Fehler,
kein Testlauf-Fehler. *Ehrliche Grenze:* ein Anbieter, der ohne eigenen Config-Schluessel
und ohne eigene Route dazukaeme, faellt weiterhin durch — das ist die Restmenge, die keine
Struktur erschlagen kann.

**R6 — eine dritte Waehrung schleicht sich ein.** Beide heutigen Quellen liefern USD
(BELEGT: befund-telnyx O2 und befund-elevenlabs §1), ein Kurspfad genuegt also, und O4 ist
damit fuer diese zwei Quellen praktisch geschlossen. Eine dritte Quelle in EUR wuerde
stillschweigend mit dem USD-Kurs multipliziert. *Massnahme:* der Posten traegt `waehrung`,
und die Umrechnung verwirft fail-closed alles, was nicht `config.billing.providerCurrency`
ist — dieselbe Regel, die der Telnyx-Adapter schon fuer Fremdwaehrungs-Records anwendet.

**R7 — der Alarm ist da, aber niemand liest ihn.** *Massnahme:* der Kanal ist Mail **und**
SMS an eine reale Nummer, mit durablem Marker und periodischem Selbsttest (§5). Wenn diese
Kombination nicht ankommt, ist das ein Betriebs-, kein Architekturproblem — und der
Selbsttest macht genau diesen Unterschied sichtbar.

**R8 — die Kette wird auf halbem Weg abgebrochen.** Bleibt P4 ohne P5 stehen, sammelt das
System Telnyx-Posten, ohne zu buchen: unschoen, aber harmlos, weil P4 per Abnahmekriterium
beweist, dass es nichts bucht. Bleibt P5 ohne P6/P7 stehen, buchen wir korrekt, merken einen
Ausfall aber nicht — *deshalb steht P7 vor P8 und nicht danach*.

---

## 10. Offene Punkte, die diese Kette NICHT schliesst

- **O3 (Endgueltigkeit von `cost_fiat` in den ersten Minuten)** — ungemessen, weil es
  keinen frischen Anruf gab (befund-elevenlabs §2). Zu messen beim naechsten echten
  Testanruf: `cost_fiat` sofort bei `status: done` und noch einmal 5-10 Minuten spaeter.
  Bis dahin traegt R1 ein akzeptiertes Restrisiko.
- **Reale Rate-Limit-Schwelle bei ElevenLabs** — nur eine untere Schranke bekannt.
- **`record_type=call-control` fuer den EL-Weg** — ungeprueft (befund-telnyx, letzter
  Abschnitt), waehrend `COST_TRUING_REQUIRED_RECORD_TYPES` beide Typen als Pflicht fuehrt.
  Fuer die EL-Route muss die Pflicht-Typmenge vor P4 gemessen werden, sonst gilt jeder
  EL-Anruf strukturell als `incomplete`.
- **Der 13. Telnyx-Beleg vom 19.08.**, der zu keinem unserer 12 Anrufe gehoert
  (befund-telnyx, Ueberraschung 2) — unerklaert. Wenn es Kosten ohne zugehoerigen Anruf
  gibt, faengt sie keine anrufbezogene Struktur.
- **`usage.calls = 2` bei 0 `call`-Zeilen** fuer einen suspendierten Tenant
  (befund-gate §5) — fuer die Geldkette folgenlos, aber ungeklaert.

---

## 11. Entscheidungen, die der Eigentuemer treffen muss

Diese Punkte haben **keine** technisch richtige Antwort; sie stehen hier, damit die
naechste Session sie nicht still fuer ihn entscheidet.

1. **Grundgebuehr, DID-Miete, TTS-Kontingent:** nicht umlegen (mein Vorschlag, §2.3) — das
   heisst, die Plattform traegt sie. Oder doch umlegen, mit der Folge, dass die Kostendecke
   eines Tenants vom Verhalten anderer abhaengt.
2. **Positive Nachbuchung ueber einen Perioden-/Monatswechsel** (KV2-P5b): heutiges
   Verhalten (belastet die laufende Periode, sicher aber ungenau) oder symmetrisch zur
   Gutschrift (nur Lebenszeit, genau aber schwaecher sperrend).
3. **Zweiteiliger Tarif** (§6.2): Grundbetrag + Minutensatz — das aendert die Reserve und
   damit, was ein Kunde vor dem Anruf sieht. Alternative: ein einzelner, dafuer hoeherer
   Minutensatz.
4. **Begrenztes automatisches ANHEBEN des Tarifs** (nie Senken) — waere die einzige
   Variante ohne Owner-Handgriff, beruehrt aber Owner-Entscheidung 3 von 2026-07-20.
5. **Die 12 EL-Altanrufe vom 19.-30.08.**: nachbuchen oder als Forensik-Report belassen
   (mein Vorschlag: belassen, §8 Punkt 4).
6. **Anruf ohne vollstaendige Belege nach Ablauf der Frist** (§4): der Tenant traegt die
   Schaetzung weiter (mein Vorschlag) — oder es gibt eine Kulanz-Gutschrift, die dann
   ausdruecklich **ohne** Beweis erfolgt und damit die Asymmetrie aufweicht.
