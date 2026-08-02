# Kosten-Inventar und Luecken-Liste

Stand: 2026-07-31. Synthese aus fuenf Mess-Achsen (Telnyx-Abrechnung, Nicht-Telnyx-Anbieter,
Buchungspfade im Code, Budget-Gate, Prod-DB) plus fuenf adversarischen Verifikationen und
eigenen Nachmessungen dieser Synthese.

Geltungsbereich: erfassen wir alle anfallenden Kosten, und landen sie beim verursachenden
Tenant. NICHT Gegenstand: Preisgestaltung, Tarife, Margen.

---

## 1. Frage und Antwort in drei Saetzen

**Ja, teilweise - und zwar strukturell, nicht zufaellig.** Auf der Achse, die das Budget-Gate
liest (`usage.spendMonthCostCents`, live per Boot-Log bestaetigt), landen von einem
**Outbound**-Anruf nachweislich alle Telnyx-Kosten vollstaendig und sogar leicht
ueberzeichnet - der durchgerechnete Anruf in Abschnitt 3 trifft die Provider-Rechnung auf
den Mikro-Cent genau; bei einem **Inbound**-Anruf dagegen erreicht KEINE einzige
Carrier-Kostenart das Gate, weil sowohl die Sofortbuchung (`billing/metering.js:111`) als
auch der Ist-Abgleich (`billing/cost-truing.js:76`) hart auf `direction === "outbound"`
gefiltert sind - gedeckt ist bei Inbound allein der KI-Token-Anteil.

Ein Nutzer kann deshalb heute beliebig viele eingehende Gespraechsminuten erzeugen (seine
Hermes-Nummer ist oeffentlich waehlbar), die Telnyx real Geld kosten - Assistant-Gebuehr,
SIP-Terminierung, Recording, TTS - und deren Kosten weder das Kosten-Gate noch das
Minuten-Kontingent-Gate (`outbound-gates.js:761`, "Inbound bleibt ungated") je sehen.

Unabhaengig davon ist die **Rechnungs**-Seite komplett stillgelegt: von 138 gebuchten
`usage_event`-Zeilen aller drei Tenants ist **keine einzige** je an Stripe gemeldet worden
(`stripe_meter_sent = false` bei 138/138), weil der Flush-Endpunkt keinen Ausloeser hat -
im Sinne "abgerechnet = in Rechnung gestellt" wird derzeit **gar kein** Verbrauch
weiterbelastet.

---

## 2. Kosten-Inventar

Legende `erfasst` = eine Zeile entsteht irgendwo; `bepreist` = ein Geldbetrag wird daraus
berechnet; `auf Gate-Achse` = der Betrag erreicht `usage.spendMonthCostCents`, die Groesse,
die `budgetExceeded` liest (`store/state-ops.js:2506`).

| Kosten-Art | Anbieter | entsteht wo (datei.js:zeile) | erfasst | bepreist | Tenant-Zuordnung | auf Gate-Achse | Groessenordnung (Beleg) | Belegart |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K1 SIP-Terminierung Outbound | Telnyx | `billing/metering.js:105-129` (Schaetzung), `billing/cost-truing.js` (Ist) | ja | ja | ja | **ja** | 0,0401 USD/min DE-Mobil, auf volle Minute gerundet | Provider-Record `sip-trunking` |
| K2 SIP-Terminierung Inbound | Telnyx | kein Buchungspfad | **nein** | nein | nein | **nein** | ungemessen (kein angenommener Inbound im 7-Tage-Fenster; Rate-Feld existiert: 0,0032 USD/min am einzigen Record) | Provider-Record + Code |
| K3 Call-Control-Kanal | Telnyx | wie K1 (in `actual_cost` enthalten) | ja | ja | ja | **nur Outbound** | 0,002 USD/min, auf volle Minute | Provider-Record `call-control` |
| K4 AI-Voice-Assistant (STT + Orchestrierung) | Telnyx | wie K1 | ja | ja | ja | **nur Outbound** | 0,05 USD je ANGEFANGENER Minute, flat (4/4 Records identisch) | Provider-Record `ai-voice-assistant` |
| K5 Text-to-Speech ueber Telnyx (ElevenLabs-Relay) | Telnyx | wie K1 | ja | ja | ja | **nur Outbound** | 7,0E-7 USD/Zeichen; 1,421E-4 bis 1,869E-4 USD je Anruf (4 Records) | Provider-Record `text-to-speech` |
| K6 Recording | Telnyx | wie K1 | ja | ja | ja | **nur Outbound** | 0,002 USD/min, auf volle Minute (4/4 Records) | Provider-Record `recording` |
| K7 Inference | Telnyx | `voice.js:143` (bewusst nicht zuordenbar) | ja | ja | nein | nein | 0,0 USD in 4/4 Records | Provider-Record `inference` |
| K8 DID-Monatsmiete | Telnyx | `billing/metering.js:141-156` | **nein** | **nein** | ja (Feld da, leer) | nein (war nie vorgesehen) | ungemessen als Ist; einziger Referenzwert 1,00 USD/Monat Listenpreis vor Kauf | Provider-GET + DB |
| K9 SMS / Messaging | Telnyx | `telephony/call-finish.js:106-122` | ja (nur Stripe-Ledger) | teilweise | ja | **nein** | ungemessen: 0 SMS im Fenster, 0 Zeilen `kind='sms'` in Prod, `SMS_COST_CENTS` live nicht lesbar (Code-Fallback 0) | DB + Code |
| K10 KI-Tokens Gespraech + Zusammenfassung | Anthropic | `claude.js:659`, `claude.js:775` -> `llm-usage.js:64` -> `state-ops.js:2243` | ja | ja | ja | **ja** | 4,33 EUR Lebenszeit / 1294 ct Monat bei einem Tenant aus 188.029 Tokens | DB + Code |
| K11 KI-Tokens Precall-Briefing | Anthropic | `precall-briefing.js:331` (+ `:280` Schaetzbuchung bei Abbruch) | ja | ja | ja | **ja** | in K10 enthalten, nicht separat auswertbar | Code |
| K12 KI-Tokens eines abgebrochenen Turns | Anthropic | `claude.js:650-659` bucht erst NACH Rueckkehr | **nein** | nein | nein | **nein** | ungemessen (Anthropic-Usage-API mit vorhandenem Key = HTTP 401) | Code |
| K13 ElevenLabs direkt (Play-TTS-Pfad) | ElevenLabs | `tts/directive-synth.js:92` -> `state-ops.js:2993-3021` | nur Zeichen | **nein** | nur Zeichen | **nein** | 6,00 USD/Monat Starter-Basis, 0 USD Ueberzug; Plattform-Zaehler `platform_tts_usage` steht bei 0 Zeichen, weil er ausschliesslich vom Play-TTS-Pfad gespeist wird (der nichts produziert) - siehe K18 fuer den tatsaechlichen Kontingentverbrauch | Provider-GET + DB |
| K14 Stripe-Transaktionsgebuehr | Stripe | nirgends gebucht (0 Treffer `stripe_fee`/`balance_transaction` in `src/`) | **nein** | nein | nein | nein | 56 ct auf 999 ct, 41 ct auf 499 ct | Provider-GET |
| K15 Auth / aktive Nutzer | WorkOS | `wiring/web-login.js:217` (Aktivitaetsbeleg) | ungeprueft | ungeprueft | ungeprueft | nein | ungemessen: kein WorkOS-Key lokal | Log |
| K16 Hosting + Datenbank | Render | Infrastruktur | nein | nein | nein | nein | Plan `free` (Web) / `starter` (Build) / `basic_256mb` (Postgres) - verbrauchsunabhaengig | Render-API |
| K17 Realtime-Audio / Twilio Voice | OpenAI / Twilio | Pfad inaktiv | n/a | n/a | n/a | n/a | 0 - 13/13 Boot-Logs `Voice-Engine: budget`, 3/3 Nummern `provider=telnyx`, Twilio-Keys leer | Log + DB |
| K18 ElevenLabs-Kontingentverbrauch ueber den Telnyx-Relay | ElevenLabs | `telephony/adapters/telnyx/voice.js` (`telnyxElevenLabs`-Relay, `config.js:298-311`) -> eigenes ElevenLabs-Konto, aber KEIN Aufrufer von `recordTtsCharacters` | **nein** | **nein** | **nein** | **nein** | **gemessen** 2026-07-31 gegen `GET /v1/usage/character-stats` (eigener Key): 07-21=240, 07-22=132, 07-27=472, 07-31=391 Zeichen, an allen anruffreien Tagen exakt 0 - deckt sich mit den Tagen mit Produktions-Anrufen (3/1/3/2 laut `call`-Tabelle); Kontostand 4105 von 39981 Zeichen, Tier `starter`, `next_invoice.subtotal` 600 ct | Provider-GET (character-stats) + DB (`call`) |
| K19 Speech-to-Text (separater Telnyx-Beleg) | Telnyx | `voice.js:614` (`ASSIGNABLE_COST_RECORD_TYPES`) | ja (abgefragt) | ja (Mechanismus vorhanden) | ja | **nur Outbound** (wie K1) | 0 Records in `last_7_days` (gemessen 2026-07-31); STT laeuft im Assistant-Pfad ueber den `ai-voice-assistant`-Beleg mit (K4, `stt_model=deepgram/flux`) statt ueber einen eigenen `speech-to-text`-Beleg | Provider-Record `speech-to-text` |
| K20 Recherche-Gebuehr serverseitige Websuche | Anthropic | `llm-usage.js:91-94` (`bookResearchSearchFee`) <- `precall-briefing.js:327,:333` | **nein** (kein `usage_event`, bewusst nur Gate-Achse) | ja (Mechanismus vorhanden) | ja | **ja** | **ungemessen**: Preis ist ein selbst gesetzter Startwert (`config.js:276`, Fallback 1 ct, `min:0`, Kommentar fordert Pruefung "VOR dem Anschalten"), Live-Zustand von `RESEARCH_ENABLED` unbekannt (`config.js:264`, Default `false`) | Code (kein Provider-Beleg gemessen) |

### Belege je Zeile

**K1 / K3 / K4 / K5 / K6 / K19 - Telnyx-Gespraechskosten Outbound.** Alle SECHS zuordenbaren
Arten werden vom Ist-Abgleich abgefragt: `telephony/adapters/telnyx/voice.js:50-53` friert die
Rohliste ein (`sip-trunking, call-control, speech-to-text, text-to-speech, recording,
inference, ai-voice-assistant` - SIEBEN Typen), `:152-154` zieht daraus
`ASSIGNABLE_COST_RECORD_TYPES` (alles ausser `inference` - SECHS Typen, `inference` ist laut
`:143` strukturell keinem Call zuordenbar), `:614` iteriert genau darueber. Empirisch
nachgemessen fuer die Session des Ankeranrufs (`649371b6-8cb5-11f1-8576-02420a1f0a70`):
`call-control` cost 0.002 bei billed_sec 60; `sip-trunking` cost 0.0401 bei billed_sec 60, rate
0.0401 (Ziel DE-Mobil); `ai-voice-assistant` cost 0.05, rate 0.05,
`rate_measured_in=ai_voice_assistant_minutes`, `tts_provider=elevenlabs`,
`stt_model=deepgram/flux`; `recording` cost 0.002 bei billed_sec 60; `text-to-speech` cost
1.421E-4, rate 7.0E-7, provider `elevenlabs`; `speech-to-text` **0 Records** (K19 - der
STT-Anteil dieses Anrufs laeuft ueber den Assistant-Beleg K4 mit `stt_model=deepgram/flux`,
nicht ueber einen eigenen `speech-to-text`-Beleg). Summe der uebrigen fuenf Typen exakt
0,0942421 USD - siehe Abschnitt 3.

Wichtig fuer die Vollstaendigkeitsfrage: eine fruehe Messung hatte nur drei dieser Typen
gesehen und daraus eine ungeklaerte 2,3-Prozent-Luecke abgeleitet. Diese Luecke existiert
nicht - sie war ein zu enger Abfrage-Umfang. Mit den sechs zuordenbaren Typen stimmt die
Rechnung auf die letzte Stelle - davon `speech-to-text` mit 0 Records (gemessen 2026-07-31,
`last_7_days`, `total_results=0`): abgefragt und leer, nicht ungeprueft uebergangen.

**K2 - Inbound-Carrier.** `billing/metering.js:111` beginnt `reconcileOutboundVoiceBudget`
mit `if (call.direction !== "outbound") return;`, und `call-finish.js:53` ruft diese Funktion
bedingungslos fuer JEDEN Anruf auf - fuer Inbound ist sie ein sofortiges No-op.
`billing/cost-truing.js:76` (`isEndedOutbound`) und `:166` (`isTruingCandidate`) schliessen
Inbound zusaetzlich als Kandidaten des Ist-Abgleichs aus. `addVoiceUsageCostCents` - der
einzige Schreibzugriff auf die Gate-Achse fuer Sprachminuten - hat repo-weit genau EINEN
Aufrufer, `metering.js:129`, innerhalb genau dieser outbound-gefilterten Funktion. Es gibt
also keinen zweiten, versteckten Pfad. Prod-Beleg: die beiden abgeschlossenen Inbound-Anrufe
`call_mrfcyadhu9wh` (owner, 15,3 s) und `call_mrntu643cvc2` (t_user_01KX600834…, 88,5 s)
tragen `estimated_cost_cents = NULL`, `actual_cost_micro_cents = NULL`, `cost_trued_at = NULL`.

Groessenordnung ungemessen: in `last_7_days` existiert genau EIN `sip-trunking`-Record mit
`direction=inbound`, und der hat `connected=0, billed_sec=0, cost=0.0` - ein nicht
angenommener Anruf. Bemerkenswert ist aber sein Feld `rate = 0.00320`: Telnyx fuehrt fuer
Inbound sehr wohl einen Minutensatz, es fehlt nur ein angenommener Anruf im abrufbaren
Fenster, an dem sich der Ist-Betrag ablesen liesse.

**K7 - Inference.** `voice.js:143` fuehrt `inference` bewusst in
`UNASSIGNABLE_COST_RECORD_TYPES`: der Typ traegt weder Session- noch Leg-Anker, laesst sich
also keinem Anruf zuordnen. Eigene Messung: 4 Records in 7 Tagen, alle mit `rate=0.0` und
`cost=0.0`. Aktuell also kein Geldbetrag, den die Nicht-Zuordenbarkeit verlieren wuerde.

**K8 - DID-Monatsmiete.** Prod-DB, alle drei aktiven Nummern:
`num_mqryght28to2` (owner, DE, seit 2026-06-24), `num_mrewxf4q19x8`
(t_user_01KX600834…, US, seit 2026-07-10), `num_mryvwncasbmb`
(t_user_01KXH2B75…, US, seit 2026-07-24) - alle drei mit `monthly_cost_cents` leer.
`billing/metering.js:141-143` (`monthlyRentCents`) liefert dafuer `null`, und
`recordNumberMonthMeter` (`:153-156`) bucht dann fail-closed nichts. Der periodische
Ausloeser existiert und laeuft (stuendlicher `setInterval` in `boot.js` ->
`settleDueNumberMonthMeters`) - er hat schlicht keinen Preis zu buchen. In `usage_event`
gibt es zwei einmalige `number_month`-Zeilen (je 500 ct, 2026-07-10 und 2026-07-24) fuer die
beiden Nutzer-Tenants; der Owner-Tenant hat fuer sein aeltestes DID **nie** eine
Mietbuchung erhalten. Kein GET-Endpunkt liefert die Ist-Miete je Nummer; `/v2/invoices`
existiert (Monats-Rollup, z. B. Zeitraum 2026-06-01 bis 2026-06-30, bezahlt), ist aber nicht
bis auf DID-Ebene aufgeschluesselt.

**K9 - SMS.** `call-finish.js:106-122` bucht nach erfolgreichem Versand ausschliesslich
`store.recordUsageEvent({ kind: SMS, costCents: config.billing.smsCostCents })`.
`state-ops.js:2698-2725` haengt diesen Eintrag nur an `s.usageEvents` an - kein `bookCents`,
also keine Beruehrung der Gate-Achse. Die einzige Schranke ist eine reine Stueckzahl-Kappe
(`sms-summary.js:36-55`, Default 20 pro 24 h) ohne jeden Bezug zum Budgetstand. In Prod:
0 Zeilen mit `kind='sms'` bei allen drei Tenants.

**K10 / K11 - Anthropic-Tokens.** Das ist der einzige Kostenstrom, der bei Inbound UND
Outbound zuverlaessig auf der Gate-Achse landet. `state-ops.js:2243-2261` (`trackUsage`)
akkumuliert in Mikro-Cents (`costMicroCentsRem`) und traegt erst den vollen Cent per
`bookCents` (`:2212`) ueber - kein Rundungsverlust. `llm-usage.js:64-68` ruft `trackUsage`
vor dem Stripe-Meter; Aufrufer sind `claude.js:659` (jede Schleifenrunde), `claude.js:775`
(Zusammenfassung) und `precall-briefing.js:331`. Prod-Beleg fuer t_user_01KX600834…:
`input_tokens = 182427`, `output_tokens = 5602`, `cost_eur = 4.33`,
`spend_month_cost_cents = 1294`.

**K12 - abgebrochener Turn.** `claude.js:650-659` bucht erst NACH Rueckkehr von
`llm.complete(...)`. `llm.js:43-51` haelt im eigenen Kommentar fest, dass bei
`RETRIES_EXHAUSTED` "mindestens ein Versuch auf der Leitung war und beim Anbieter Token
erzeugt haben kann". Die Faenger in `telnyx-llm-shim.js` und `routes/voice.js` rendern nur
eine hoefliche Degradation. Die dafuer gebaute Kompensation `bookEstimatedTokenUsage`
(`llm-usage.js:70-78`) hat repo-weit genau EINEN Aufrufer: `precall-briefing.js:280` - der
Live-Telefonpfad ruft sie nie.

**K13 - ElevenLabs direkt (Play-TTS-Pfad).** Zwei getrennte Pfade, und die Vollstaendigkeitsfrage
stellt sich fuer beide unterschiedlich - eine fruehere Fassung dieses Inventars hat sie
verwechselt und daraus einen falschen Schluss gezogen (korrigiert, siehe K18). Der in echten
Anrufen aktive TTS-Weg laeuft ueber Telnyx (`voice.js:303-305` prueft
`config.telnyx.telnyxElevenLabs`, dessen Key ausschliesslich in Telnyx' Vault liegt) - dessen
GELD-Kosten sind K5 und damit auf der Outbound-Gate-Achse abgedeckt. Der eigene Play-TTS-Pfad
(`tts/directive-synth.js`) zaehlt nur Zeichen: `state-ops.js:2993-3021` und `:3043-3047`
erhoehen ausschliesslich den Plattform-Zaehler `recordTtsCharacters`/`platform_tts_usage`, es
gibt repo-weit keinen Preis-pro-Zeichen-Parameter fuer DIESEN Pfad; der Code nennt das selbst
"REINE SICHTBARKEIT". Dieser Zaehler steht bei 0 Zeichen mit leerem Zyklus-Schluessel - der
Play-TTS-Pfad SELBST hat im Messzeitraum nichts produziert.

Das ist aber nicht dasselbe wie "das ElevenLabs-Kontingent wurde nicht verbraucht" - genau
diesen Fehlschluss zieht K18 gerade. Die 3442 Zeichen in `usage.tts_characters` eines Tenants
stammen aus dem Ist-Abgleich der Telnyx-TTS-Records (K5, `cost-truing.js:373`
`bookTtsCharactersFor`) und sind dort bereits im Geldbetrag enthalten - fuer die GATE-ACHSE
sind sie Sichtbarkeit, keine zweite, unbezahlte Kostenart. Sie speisen aber NICHT den Zaehler,
an dem der Kontingent-Erschoepfungs-Riegel haengt (`recordTtsCharacters`, Schwelle
`ttsCharacterQuota`/`TTS_CHARACTER_QUOTA_WARN_PERCENT`, `config.js:685-693`) - das ist ein
anderer, unabhaengiger Zaehler mit einer anderen Wirkung (Warnung/Riegel gegen das eigene
ElevenLabs-Kontingent). Der eigene ElevenLabs-Vertrag laeuft auf Starter, 6,00 USD Basis.

**K18 - ElevenLabs-Kontingentverbrauch ueber den Telnyx-Relay.** `config.js:298-311`
(`telnyxElevenLabs`) haelt im eigenen Kommentar fest: "EIN Plattform-Key - TTS-Zeichen aller
Tenants laufen ohne per-Tenant-Metering aufs Owner-ElevenLabs-Konto" - der Relay-Pfad
synthetisiert also gegen UNSER eigenes ElevenLabs-Kontingent, nicht gegen ein separates
Telnyx-Kontingent. Eigene Messung 2026-07-31 gegen `GET /v1/usage/character-stats` (eigener
Key aus `.env`): Tageszeichen 07-21 = 240, 07-22 = 132, 07-27 = 472, 07-31 = 391, an allen
anruffreien Tagen exakt 0 - das sind genau die Tage mit Produktions-Anrufen (Prod-DB
`call`-Tabelle: 3, 1, 3, 2 Anrufe). Kontostand zum Messzeitpunkt: 4105 von 39981 Zeichen
verbraucht, Tier `starter`, `next_invoice.subtotal` 600 ct.

Der Zaehler, an dem der Erschoepfungs-Riegel (`ttsCharacterQuota`) haengt, wird von diesem
Verbrauch NICHT gespeist - `recordTtsCharacters` hat repo-weit genau einen Aufrufer, den
Play-TTS-Pfad (`tts/directive-synth.js`), der auf dem Assistant-Pfad gar nicht laeuft. Der
Riegel sieht also strukturell nie, wie nah das eigene Kontingent an der Erschoepfung ist - das
ist eine reale, tenant-verursachte Kostenart (ein bezahlter Plan mit Ueberzugsgebuehr), die
weder im Ledger noch auf der Gate-Achse noch in der dafuer gebauten Sicherung ankommt. Offen
bleibt nur die Vault-Bestaetigung, dass `TELNYX_ELEVENLABS_API_KEY_REF` tatsaechlich auf
dieses Konto zeigt (U8) - die Tageskorrelation macht das praktisch sicher, ist aber kein
direkter Beleg der Secret-Referenz selbst.

**Nachtrag 2026-07-31 (Owner-Rueckfrage, direkt gemessen): der `text-to-speech`-Beleg K5 ist
NICHT der ElevenLabs-Preis, sondern eine Telnyx-Vermittlungsgebuehr.** Der Rohsatz jedes
`text-to-speech`-Records lautet `"type": "byoc"` (bring your own credentials),
`"provider": "elevenlabs"`, `"rate": "7.0E-7"`, `rate_measured_in` implizit je Zeichen -
gemessen an 7 Gespraechen der letzten 7 Tage, `cost` = `number_of_characters` x 7.0E-7 auf
die letzte Stelle. Das sind **0,0000007 USD/Zeichen**. Unser eigener ElevenLabs-Vertrag
(`GET /v1/user/subscription`, Tier `starter`, 39.981 Zeichen/Monat, `next_invoice.subtotal`
600 ct) kostet **0,000125 USD/Zeichen** im Schnitt - **Faktor 179**. Der erfasste Beleg deckt
also rund **0,56 Prozent** der tatsaechlichen TTS-Kosten ab; die restlichen 99,4 Prozent
liegen auf unserem ElevenLabs-Vertrag und tragen keine Tenant-Kennung. Je Gespraech gemessen:
226 Zeichen im Schnitt (7 Gespraeche, 203-267) = 0,00016 USD gebucht gegen ca. 0,028 USD real.
Zum Vergleich die Assistant-Gebuehr desselben Gespraechs: 0,05 USD je angefangener Minute.

Daraus folgt eine harte Mengengrenze, die im Inventar bisher fehlte: **39.981 Zeichen / 226
Zeichen je Gespraech = rund 177 Gespraeche pro Monat - plattformweit, alle Tenants zusammen**,
danach greift Ueberzugsgebuehr oder Qualitaetsabfall. Stand der Messung: 4.168 von 39.981
Zeichen (10,4 Prozent) im laufenden Zyklus. Der Zaehler, der das anzeigen wuerde, steht bei 0
(siehe oben) und hat laut `state-ops.js:2990` ausdruecklich "KEINE Tenant-Dimension".

**K19 - Speech-to-Text (separater Telnyx-Beleg).** Eigene Messung 2026-07-31:
`filter[record_type]=speech-to-text`, `last_7_days` -> `total_results: 0`. Der Typ ist Teil
von `ASSIGNABLE_COST_RECORD_TYPES` (`voice.js:152-154`) und wird vom Ist-Abgleich
mitabgefragt (`voice.js:614`) - er ist abgefragt und leer, nicht uebersehen. Auf dem
Assistant-Pfad laeuft STT ueber den `ai-voice-assistant`-Beleg (K4, `stt_model=deepgram/flux`)
mit; ob Telnyx STT je separat unter `speech-to-text` abrechnet (z. B. auf einem anderen
Sprach-Pfad), ist damit nicht ausgeschlossen, nur im Beobachtungsfenster nicht beobachtet.

**K20 - Recherche-Gebuehr serverseitige Websuche.** `precall-briefing.js:327` (Abbruchfall)
und `:333` (Erfolgsfall) rufen `bookResearchSearchFee` (`llm-usage.js:91-94`) auf, die ueber
`addResearchFeeCostCents` (`state-ops.js:2290-2292`) **ausschliesslich** die Gate-Achse
speist - bewusst kein `usage_event`, weil "usage_event kein research-kind kennt" (Code-Kommentar
`llm-usage.js:84-87`). Der Preis kommt aus `config.js:276` (`researchSearchFeeCents`, Fallback
1 Cent, `min: 0`); der Code-Kommentar direkt daneben (`config.js:274-275`) fordert woertlich,
den Wert "VOR dem Anschalten von RESEARCH_ENABLED gegen die aktuelle Anbieter-Preisliste zu
pruefen - der Fallback ist ein Startwert, kein Beleg". Ob der Pfad live an ist, ist unbekannt:
`RESEARCH_ENABLED` (`config.js:264`, Default `false`) steht weder im Boot-Banner noch war es
Teil dieser Untersuchung. Diese Kostenart fehlte in einer frueheren Fassung dieses Inventars
komplett, obwohl der zugehoerige Plan (`PLAN-KOSTEN-VOLLSTAENDIGKEIT.md`) sie bereits in seiner
eigenen Divergenz-Tabelle fuehrt.

**K14 - Stripe-Gebuehren.** Real (56 ct auf 999 ct, 41 ct auf 499 ct), nirgends intern
gebucht. Betrifft Marge, nicht die Verbrauchszuordnung - hier nur der Vollstaendigkeit halber
gefuehrt.

**K16 / K17.** Render ist verbrauchsunabhaengiger Fixkostenblock. Der Realtime-Pfad
(`bridge.js`) und Twilio sind im gesamten Messfenster nachweislich tot: 13 von 13
Boot-Log-Zeilen melden `Voice-Engine: budget`, alle drei Nummern liegen auf Telnyx, die
Twilio-Credentials sind lokal leer. Der `bridge.js`-Pfad traegt allerdings eine latente
Schwaeche, siehe L9.

---

## 3. Der durchgerechnete Anruf: `call_ms8nfsbk7cck`

Outbound, Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH`, 2026-07-31, Ziel DE-Mobil.
Zeitachse aus der Prod-DB: gestartet 07:56:52.640, angenommen 07:57:03.222, beendet
07:57:43.135 - also 39,9 s Gespraech, von Telnyx als `call_sec=40` gefuehrt und auf 60 s
aufgerundet.

### Was Telnyx berechnet

| Record-Typ | rate | billed_sec | cost (USD) |
| --- | --- | --- | --- |
| `call-control` (verbundene Leg) | 0,002 /min | 60 | 0,0020000 |
| `call-control` (Fehlversuch, `completed=0`) | - | 0 | 0,0000000 |
| `sip-trunking` (verbundene Leg) | 0,0401 /min | 60 | 0,0401000 |
| `sip-trunking` (Fehlversuch, `connected=0`) | 0 | 0 | 0,0000000 |
| `ai-voice-assistant` | 0,05 /min | 60 | 0,0500000 |
| `recording` | 0,002 /min | 60 | 0,0020000 |
| `text-to-speech` (elevenlabs) | 7,0E-7 /Zeichen | - | 0,0001421 |
| `inference` | 0,0 | - | 0,0000000 |
| **Summe** | | | **0,0942421 USD** = 9,42421 US-Cent |

### Was wir gebucht haben

| Ereignis | Zeitpunkt | Betrag | Achse |
| --- | --- | --- | --- |
| 5x `ai_token` waehrend des Gespraechs | 07:57:25 bis 07:57:38 | je 0 ct im Ledger; realer Betrag ging per Mikro-Cent-Carry auf die Gate-Achse | Gate + Stripe-Ledger |
| `voice_minute` (Schaetzung) | 07:57:43.135 | **+30 ct** | Gate + Stripe-Ledger |
| `billed_at` gesetzt | 07:57:43.136 | - | - |
| 1x `ai_token` (Zusammenfassung, NACH Gespraechsende) | 07:57:49.195 | 0 ct im Ledger, realer Betrag auf der Gate-Achse | Gate + Stripe-Ledger |
| Ist-Abgleich `cost_trued_at` | 08:51:01.391 | **-21 ct** | Gate |

`actual_cost_micro_cents = 9424210`, `cost_trued_source = telnyx_detail_records`. Der Wert
ist in Provider-Mikro-Cent notiert: 9424210 / 1e6 = 9,42421 US-Cent - **exakt** die
Provider-Summe oben, ohne jede Abweichung.

Umrechnung in die Bucket-Waehrung: `convertProviderMicroToBucketCents`
(`state-ops.js:2309-2319`) rechnet `9424210 x 920000 / 1e12 = 8,6702732` -> 8 volle
Bucket-Cent, Rest wandert in `costCorrectionMicroCentsRem`. Das Delta gegen die Schaetzung
ist `8 - 30 = -22`; geloggt wurde `-21`, weil ein vorbestehender Mikro-Cent-Rest mitgetragen
wurde. Die Korrektur ist additiv als Delta gebaut (`state-ops.js:2413`) und gegen einen
zweiten Durchlauf verriegelt (`cost-truing.js:166`, `costTruedAt !== null`) - kein
Doppelbuchungsrisiko.

### Was das Gate davon sieht

| Position | Cent |
| --- | --- |
| Reale Telnyx-Kosten in Bucket-Waehrung | 8,67 |
| Auf die Gate-Achse gebucht (30 - 21) | **9,00** |
| **Differenz (zu unseren Gunsten)** | **+0,33** |

Fuer die Carrier-Seite dieses Anrufs ist die Kette **vollstaendig und leicht konservativ**:
das Gate sieht 9 Cent, wo real 8,67 Cent Kosten entstanden sind. Die 53 Minuten und 18
Sekunden zwischen Gespraechsende und Korrektur sind kein blinder Fleck, weil die
Worst-Case-Schaetzung von 30 ct praktisch zeitgleich mit dem Auflegen gebucht wird
(`billed_at` 1 ms nach `ended_at`) - das Gate ist in der Zwischenzeit eher zu streng als zu
locker.

Nicht aufloesbar auf Anrufebene: der KI-Token-Anteil. Die sechs `ai_token`-Ereignisse dieses
Anrufs tragen zusammen 15.085 Tokens (2737 + 2749 + 2785 + 2791 + 2918 + 1105), aber im
Stripe-Ledger steht bei jedem `cost_cents = 0`; der reale Euro-Betrag ging ausschliesslich
in den kumulativen Tenant-Bucket und ist dort nicht je Anruf separierbar. Das ist keine
verlorene Kosten-Zuordnung (der Betrag ist auf der Gate-Achse), aber die pro-Anruf-Zahl ist
**ungemessen**.

---

## 4. Luecken-Liste

Sortiert nach Groessenordnung mal Weglauf-Geschwindigkeit.

### L1 - Inbound-Carrier-Kosten haben keinen Pfad auf die Gate-Achse

**Was faellt an:** bei jedem angenommenen eingehenden Anruf auf dem Assistant-Pfad
mindestens K4 (0,05 USD je angefangener Minute, flat), K6 (0,002 USD/min), K5 (TTS-Zeichen)
und K2 (SIP-Terminierung inbound, Rate-Feld belegt mit 0,0032 USD/min).
**Wo bricht die Kette:** `billing/metering.js:111` und `billing/cost-truing.js:76` -
beide filtern hart auf `outbound`.
**Groessenordnung:** die Bausteine sind gemessen (0,052 USD/min plus SIP und TTS als
Untergrenze aus den Outbound-Records), der Ist-Betrag eines angenommenen Inbound-Anrufs ist
**ungemessen**: im 7-Tage-Fenster gab es keinen einzigen angenommenen Inbound-Anruf.
**Wer traegt die Kosten heute:** Sundartha.
**Weglauf:** **schnell.** Die Hermes-Nummer ist oeffentlich waehlbar. Weder das Kosten-Gate
(bekommt keine Zahl) noch das Minuten-Kontingent-Gate (`outbound-gates.js:761`, "Inbound
bleibt ungated") bremsen. Die einzige verbleibende Bremse ist der KI-Token-Akku, der bei
einem typischen Turn im Bereich von Zehntel-Cent liegt, waehrend die Assistant-Gebuehr
5 Cent je angefangener Minute kostet - ein Verhaeltnis von rund 1:20 zuungunsten der
Bremse. Missbrauchsbild: ein Nutzer laesst seine Nummer dauerhaft anrufen (oder ruft sie
selbst wiederholt an) und erzeugt Provider-Kosten, die seine Decke nie erreichen.

### L2 - Kein Verbrauch wurde je an Stripe gemeldet

**Was faellt an:** jeder `usage_event` (Tokens, Sprachminuten, Nummernmonate) ist als
Meldung an Stripe vorgesehen.
**Wo bricht die Kette:** `routes/api-billing.js:36-45` - der Flush ist bewusst als extern
per Cron aufzurufender Endpunkt gebaut, es gibt keinen internen Scheduler. Im
Render-Workspace existieren nur drei Dienste (ein Web-Service, zwei statische Sites), kein
Cron-Job. Render-Logs ueber das maximal abrufbare Fenster (rund 29 Tage) liefern 0 Treffer
auf `/api/billing/flush-meters` und auf `meter_flush`.
**Groessenordnung:** 138 von 138 `usage_event`-Zeilen mit `stripe_meter_sent = false`,
ueber alle drei Tenants, seit Bestehen der Daten.
**Wer traegt die Kosten heute:** Sundartha - Verbrauch wird nicht weiterbelastet.
**Weglauf:** **mittel bis schnell**, aber begrenzt durch das vorgelagerte Kosten-Gate. Der
Pfad ist kein sporadischer Ausfall, sondern seit Einfuehrung nie erreicht worden. Zu klaeren
ist zuerst, ob nutzungsbasierte Weiterbelastung im aktuellen Tarifmodell (Abo mit
Minutenkontingent) ueberhaupt gewollt ist - das ist eine Owner-Entscheidung, keine
technische Frage.

### L3 - SMS-Kosten erreichen die Gate-Achse nie

**Was faellt an:** Telnyx-Messaging-Kosten je Zusammenfassungs-SMS.
**Wo bricht die Kette:** `call-finish.js:106-122` schreibt ausschliesslich in den
Stripe-Ledger; `state-ops.js:2698-2725` beruehrt `usage.costCents` nicht.
**Groessenordnung:** **ungemessen** - 0 SMS im Beobachtungsfenster (Telnyx-`messaging` in
24 h und 7 d jeweils leer), 0 Zeilen `kind='sms'` in Prod, und der Live-Wert von
`SMS_COST_CENTS` war nicht lesbar (Code-Fallback ist 0).
**Wer traegt die Kosten heute:** Sundartha.
**Weglauf:** **langsam.** Gedeckelt durch eine reine Stueckzahl-Kappe (Default 20 pro 24 h
pro Tenant), die aber geldunabhaengig ist: bei teuren Auslandszielen kosten 20 SMS/Tag
deutlich mehr als bei inlaendischen, ohne dass sich an der Schranke etwas aendert.

### L4 - DID-Monatsmiete wird fuer 3 von 3 Nummern nie gebucht

**Was faellt an:** wiederkehrende Telnyx-Nummernmiete, unabhaengig von Gespraechen.
**Wo bricht die Kette:** `monthly_cost_cents` ist bei allen drei Nummern leer;
`billing/metering.js:141-156` bucht fail-closed nichts ohne gelernten Preis. Der stuendliche
Sweep laeuft nachweislich - er hat nur nichts zu buchen. Der Owner-Tenant hat fuer sein
aeltestes DID (seit 2026-06-24) noch nie eine Mietbuchung erhalten.
**Groessenordnung:** Ist-Betrag **ungemessen** (kein GET-Endpunkt liefert die Miete je
gekaufter Nummer); einziger Referenzwert ist der Vorab-Listenpreis 1,00 USD/Monat fuer eine
neue US-Lokalnummer.
**Wer traegt die Kosten heute:** Sundartha.
**Weglauf:** **langsam und gedeckelt.** Die Vermehrung begrenzen `MAX_NUMBERS` und
`MAX_NUMBERS_PER_TENANT`; ein Nutzer kann sich nicht beliebig viele DIDs verschaffen. Die
Luecke waechst linear mit der Tenant-Zahl, nicht mit dem Verhalten eines einzelnen Nutzers.

### L5 - ElevenLabs-Kontingent wird verbraucht, ohne dass der dafuer gebaute Riegel es sieht (K18)

Zwei getrennte Sachverhalte, die eine fruehere Fassung dieses Punkts verwechselt hat -
korrigiert nach eigener Nachmessung 2026-07-31.

**5a - der eigene Play-TTS-Pfad produziert nichts (weiterhin zutreffend).**
**Was wuerde anfallen:** ElevenLabs-Zeichenkosten, falls der eigene Play-TTS-Pfad
(`tts/directive-synth.js`) aktiv waere. **Wo bricht die Kette:** `state-ops.js:2993-3021`
zaehlt nur Zeichen; es existiert repo-weit kein Preis-pro-Zeichen-Parameter fuer DIESEN Pfad.
**Groessenordnung:** aktuell 0 - der Plattform-Zaehler `platform_tts_usage` steht bei 0
Zeichen, weil dieser Pfad im Messzeitraum nichts produziert hat. **Weglauf:** derzeit keiner
(Pfad produziert nichts). Wird er scharf geschaltet, gilt: Kosten steigen mit gesprochenen
Zeichen, die Gate-Achse sieht davon nichts.

**5b - der Telnyx-Relay-Pfad verbraucht das Kontingent JETZT, unbemerkt (LAUFENDE LUECKE, K18).**
**Was faellt an:** echter ElevenLabs-Zeichenverbrauch gegen unser eigenes Konto bei jedem
Assistant-Anruf, der ueber den Telnyx-Relay synthetisiert (`config.js:298-311`
`telnyxElevenLabs` - "TTS-Zeichen aller Tenants laufen ... aufs Owner-ElevenLabs-Konto").
**Wo bricht die Kette:** der Erschoepfungs-Riegel haengt an `recordTtsCharacters` /
`ttsCharacterQuota` (`config.js:685-693`), und dieser Zaehler hat repo-weit genau einen
Aufrufer - den Play-TTS-Pfad aus 5a, der auf dem Assistant-Pfad gar nicht laeuft. Der Relay-
Verbrauch beruehrt diesen Zaehler nie. **Groessenordnung:** **gemessen** gegen
`GET /v1/usage/character-stats` (eigener Key): Tageszeichen 07-21=240, 07-22=132, 07-27=472,
07-31=391, exakt 0 an anruffreien Tagen (deckt sich mit 3/1/3/2 Produktions-Anrufen laut
`call`-Tabelle); Kontostand 4105 von 39981 Zeichen, Tier `starter`, `next_invoice.subtotal`
600 ct. **Wer traegt die Kosten heute:** Sundartha (im Rahmen des Starter-Kontingents; ob und
wann ein Ueberzug real anfaellt, ist ungemessen - es haengt vom weiteren Verbrauch bis
Zyklusende ab). **Weglauf:** **laufend, unbeobachtet.** Es ist keine Kosten-Luecke im Sinn von
"jemand telefoniert billig durch" (der Geldbetrag der Telnyx-Seite ist ueber K5 gedeckt), aber
es ist eine strukturell blinde Sicherung: das eigene Kontingent kann sich dem Limit naehern
oder es ueberschreiten, ohne dass `ttsCharacterQuota`/`TTS_CHARACTER_QUOTA_WARN_PERCENT` je
anschlaegt, weil der Zaehler, an dem die Warnung haengt, von diesem Verbrauch nie erreicht
wird.

### L6 - Abgebrochener KI-Turn wird nicht nachgebucht

**Was faellt an:** moeglicherweise bei Anthropic abgerechnete Tokens eines Roundtrips, der
nach erschoepften Retries wirft.
**Wo bricht die Kette:** `claude.js:650-659` bucht erst nach erfolgreicher Rueckkehr; die
dafuer existierende Kompensation `bookEstimatedTokenUsage` (`llm-usage.js:70-78`) wird
ausschliesslich von `precall-briefing.js:280` aufgerufen, nie aus dem Live-Telefonpfad.
**Groessenordnung:** **ungemessen** - ob Anthropic einen client-seitig abgebrochenen Request
abrechnet, ist mit dem vorhandenen Key nicht pruefbar (Usage-API antwortet HTTP 401,
kein Admin-Key).
**Wer traegt die Kosten heute:** Sundartha, falls ueberhaupt Kosten entstehen.
**Weglauf:** **langsam.** Der Fall setzt Anbieter-Ausfaelle voraus, ist also nicht
willentlich ausloesbar; die Betraege liegen pro Vorfall im Zehntel-Cent-Bereich.

### L7 - Ist-Abgleich laeuft auf 23 Prozent Deckung

**Was faellt an:** nichts Zusaetzliches - aber 77 Prozent der beendeten Outbound-Anrufe
bleiben auf der Worst-Case-Schaetzung stehen statt auf einem geprueften Ist-Betrag.
**Wo bricht die Kette:** `boot.js` warnt nur, ohne abzubrechen. Boot-Log 2026-07-31 07:50:57:
"Deckungsquote 23% liegt unter COST_TRUING_MIN_COVERAGE_PERCENT=80% - Korrekturbuchungen
laufen auf einer duennen Datenlage." Die Kette 10/22/23/24 Prozent haelt seit mindestens
2026-07-25 durchgehend unter der Schwelle.
**Richtung:** **nicht zu unseren Ungunsten.** Alle vier real beobachteten Korrekturen sind
negativ (-291, -583, -291, -21 Cent gegen Schaetzungen von 300, 600, 300, 30) - die
Schaetzung liegt systematisch ueber dem Ist, ein nicht korrigierter Anruf wird also zu hoch
belastet, nicht zu niedrig.
**Weglauf:** kein Kostenweglauf, aber ein Genauigkeitsproblem: es bedeutet auch, dass wir
fuer drei von vier Anrufen keinen Provider-Beleg besitzen.

### L8 - Der Stripe-Ledger fuehrt KI-Tokens dauerhaft mit 0 Cent

**Was faellt an:** nichts Zusaetzliches, aber die interne Kostenwahrheit dieses Ledgers ist
fuer KI-Tokens blind.
**Wo bricht die Kette:** `aiCostCents` (`state-ops.js:2685-2687`) rundet pro Einzelereignis
mit `Math.round` ohne Rest-Uebertrag, waehrend `trackUsage` direkt daneben den Mikro-Cent-Rest
fortschreibt. Ein Haiku-Turn liegt strukturell unter einem halben Cent und rundet damit
immer auf 0.
**Groessenordnung:** 101 von 101 `ai_token`-Zeilen mit `cost_cents = 0` bei zusammen
210.825 Tokens.
**Wirkung:** die Gate-Achse ist NICHT betroffen (siehe K10), und Stripe erhaelt ohnehin die
Rohmenge, nicht diesen Cent-Wert. Relevant wird die Null erst, wenn irgendein Bericht oder
Dashboard diesen Ledger als Kostenquelle liest - dann ist sie aktive Fehlinformation.

### L9 - Realtime-Pfad ohne Mid-Call-Pruefung (latent)

`bridge.js:287-289` setzt beim Gespraechsbeginn genau einen Timer
(`callMaxDurationMs`) und prueft danach nichts mehr; `grep` nach `blockingBudgetAxis` in
`bridge.js` liefert keinen Treffer. Die Budget-Engine prueft dagegen in jeder Turn-Runde neu
(`claude.js:556-562`, `:641-648`) inklusive der laufenden Carrier-Minuten
(`budget-gate.js:14-24`). **Heute wirkungslos**, weil der Realtime-Pfad nachweislich nicht
aktiv ist (13/13 Boot-Logs `Voice-Engine: budget`). Wird `VOICE_ENGINE=realtime` je
geschaltet, ist die maximale Ueberziehung eines Gespraechs nur noch durch die
guthaben-abgeleitete Maximaldauer begrenzt, nicht mehr durch eine laufende Pruefung.

### L10 - Zwei unabhaengige Rundungsuhren bei Telnyx (strukturell)

`call-control`/`sip-trunking` runden nach `call_sec`, `ai-voice-assistant` nach eigener
`duration_sec`. Gemessen an einem Anruf: 94 s gegen 77 s, 17 Sekunden Differenz, die hier
zufaellig in dieselbe Minutengrenze fiel. Kein beobachteter Kostenausfall - fuer uns ist
das ohnehin unkritisch, weil wir die Summe der cost-Felder uebernehmen und nicht selbst
nachrechnen. Erwaehnt, damit niemand aus einer der beiden Dauern die Gesamtkosten herleitet.

---

## 5. Ungemessen / offen

| Nr. | Was | Grund | Wie man es messen WUERDE |
| --- | --- | --- | --- |
| U1 | Ist-Kosten eines angenommenen Inbound-Anrufs | im 7-Tage-Fenster gab es keinen; `detail_records` kennt nur Presets bis `last_7_days`, die beiden echten Inbound-Anrufe (07-10, 07-16) liegen ausserhalb | einen kontrollierten Inbound-Testanruf fuehren, danach `sip-trunking`, `call-control`, `ai-voice-assistant`, `recording`, `text-to-speech` fuer dessen `call_control_id` abrufen und summieren |
| U2 | Ist-Miete je gekaufter DID | kein GET-Endpunkt liefert sie; `/v2/phone_numbers` und `/v2/number_orders` haben kein Preisfeld; `/v2/invoices` ist nur Monats-Rollup | Rechnungs-PDF ueber die `file_id` aus `/v2/invoices` beziehen und die DID-Positionen auslesen; danach `number.monthly_cost_cents` befuellen |
| U3 | Realer SMS-Preis je Nachricht | keine SMS im Fenster, `messaging`-Records leer, `SMS_COST_CENTS` live nicht lesbar | eine Test-SMS ausloesen, `record_type=messaging` abrufen; parallel den Render-Env-Wert ablesen |
| U4 | Ob Anthropic abgebrochene Requests abrechnet | vorhandener Key ist kein Admin-Key, Usage-Report-API antwortet HTTP 401 | Admin-Key erzeugen und `/v1/organizations/usage_report/messages` gegen einen bewusst abgebrochenen Request halten |
| U5 | KI-Token-Kosten je einzelnem Anruf | der Ledger bucht 0 (L8), die Gate-Achse ist kumulativ | in `usage_event` fuer `ai_token` zusaetzlich Mikro-Cents fuehren oder Input/Output getrennt ablegen |
| U6 | Live-Werte von `PAYMENT_ENABLED`, `SMS_COST_CENTS`, `CLAUDE_MODEL`, `PRECALL_BRIEFING_MODEL`, `COST_TRUING_REQUIRED_RECORD_TYPES`, `RESEARCH_ENABLED`, `RESEARCH_SEARCH_FEE_CENTS` | es gibt kein Render-Lesetool fuer Env-Werte, nur ein Schreibtool - das wurde bewusst nicht zweckentfremdet | die Werte in das Boot-Banner aufnehmen (wie es fuer `BUDGET_MONTH_ENABLED` und `VOICE_ENGINE` bereits geschieht) oder im Dashboard nachsehen |
| U7 | WorkOS-Verbrauch und -Kosten | kein WorkOS-Key lokal (`OIDC_CLIENT_SECRET` leer) | WorkOS-Konsole oder Admin-API mit einem Lese-Key |
| U8 | Ob `TELNYX_ELEVENLABS_API_KEY_REF` exakt auf UNSER ElevenLabs-Konto zeigt | **teilweise gemessen** (hochgestuft): die Tageskorrelation zwischen Telnyx-Relay-Nutzung und Assistant-Anrufen (K18, `GET /v1/usage/character-stats` gegen unseren Key) belegt, dass der Verbrauch auf UNSEREM Vertrag auflaeuft - der Key selbst liegt aber weiterhin ausschliesslich in Telnyx' Secret-Vault, die Vault-Referenz selbst wurde nicht direkt aufgeloest | in der Telnyx-Konsole die Secret-Referenz aufloesen und mit dem eigenen Konto direkt (nicht nur per Korrelation) vergleichen |
| U9 | Ob die 0-USD-Regel fuer gescheiterte Legs universell gilt | 16 beobachtete Records mit `completed=0`/`connected=0` in 7 Tagen, alle `cost=0.0` - aber nur wenige Fehlerarten abgedeckt | laengeres Beobachtungsfenster; gezielt lange klingelnde und vom Ziel abgewiesene Anrufe provozieren und die Records pruefen |
| U10 | Warum `call`-Zeilen aelterer Anrufe (07-27) nicht mehr auffindbar sind | drei `ai-voice-assistant`-Sessions vom 07-27 liessen sich keinem Tenant zuordnen; Ursache nicht untersucht | Purge-/Retention-Pfad lesen und mit dem Telnyx-Abrufhorizont (7 Tage) vergleichen - davon haengt ab, wie lange ein Abgleich ueberhaupt moeglich ist |

---

## 6. Methode und Grenzen

**Wie gemessen wurde.** Fuenf Achsen haben unabhaengig erhoben, fuenf adversarische
Verifizierer haben versucht, jeden Befund zu widerlegen; diese Synthese hat die
verbliebenen Widersprueche selbst nachgemessen. Quellen waren ausschliesslich lesend: die
Prod-Postgres per `psql` (FORCE-RLS, also je Tenant mit gesetztem `app.current_tenant`),
die Telnyx-API per GET (`/v2/detail_records` fuer alle 7 im Code gefuehrten Record-Typen aus
`COST_RECORD_TYPES`, davon 6 - `ASSIGNABLE_COST_RECORD_TYPES` - dem Ist-Abgleich zugefuehrt;
`speech-to-text` liegt darin mit 0 Records in `last_7_days`: abgefragt und leer, nicht
uebergangen; `/v2/phone_numbers`, `/v2/number_orders`, `/v2/available_phone_numbers`,
`/v2/invoices`),
ElevenLabs, Stripe und Anthropic per GET, die Render-Logs ueber die MCP-Werkzeuge, sowie
der Quelltext im Hauptverzeichnis. Kein Schreibzugriff, kein Anruf, keine
Konfigurationsaenderung.

**Zwei Widersprueche zwischen den Achsen wurden aufgeloest.**

1. *"Die Telnyx-Summe weicht um 2,3 Prozent von unserem Ist-Wert ab."* **Aufgeloest, es gibt
   keine Abweichung.** Die erste Messung hatte nur drei Record-Typen abgefragt. Mit den
   tatsaechlich vom Code genutzten Typen - `voice.js:50-53` friert die Liste ein - summieren
   sich `call-control` + `sip-trunking` + `ai-voice-assistant` + `recording` +
   `text-to-speech` auf 0,0942421 USD und treffen `actual_cost_micro_cents = 9424210` exakt.

2. *"Das Gate liest die Monats-Achse"* (Gate-Achse) gegen *"die Monats-Achse kann es nicht
   sein, sonst waere der Tenant gesperrt"* (Code-Achse). **Aufgeloest zugunsten der
   Monats-Achse.** Der Widerspruch beruhte auf einer angenommenen Tenant-Decke von 600 Cent.
   Selbst nachgemessen im Boot-Log vom 2026-07-31 07:50:57: "Kosten-Decken: Tenant-Default
   **1500 ct** | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min". Bei
   `spend_month_cost_cents = 1294` gegen 1500 Cent Decke geht der Anruf vom 07-31
   erwartungsgemaess durch - `BUDGET_MONTH_ENABLED=true` ist live und wirksam.
   Die beobachtete Spreizung (433 Cent Lebenszeit gegen 1294 Cent Monat) ist ebenfalls kein
   Fehler: `applyCreditCents` (`state-ops.js:2364-2371`) laesst eine Gutschrift nur dann auf
   die Monats-Achse wirken, wenn die urspruengliche Belastung im gerade gezaehlten Monat
   verankert war. Gutschriften ohne Anker senken deshalb nur die Lebenszeit-Zahl. Die
   Richtung ist konservativ: die Gate-Zahl ist hoeher als die Lebenszeit-Zahl, das Gate
   sperrt also frueher, nicht spaeter.

**Drei Befunde wurden als Kosten-Luecke verworfen** und stehen bewusst nicht in Abschnitt 4:
die 2,3-Prozent-Abweichung (existiert nicht, s.o.); "fuenf Anrufe buchen keinen Cent"
(gegen Telnyx gekreuzt: fuer diese Legs steht dort `cost=0.0`, `connected=0`, `billed_sec=0` -
es gibt nichts weiterzubelasten, und die in unserer DB sichtbaren 28-32 Sekunden sind unsere
eigene Zeitspanne, nicht abgerechnete Telefonie); und die Schlussfolgerung, die Monats-Achse
sei faktisch aus (durch die gemessene Decke von 1500 Cent widerlegt). Weitere sechs Befunde
gingen in berichtigter Fassung ein.

**Was dieses Dokument NICHT sagt.**

- Es sagt nichts ueber die Hoehe der Inbound-Luecke. Die Bausteine sind gemessen, der Ist-Betrag
  eines angenommenen Inbound-Anrufs ist es nicht (U1). Die Luecke ist strukturell zweifelsfrei
  belegt, ihre Groesse nicht.
- Es sagt nichts ueber Tarife, Margen oder ob die aktuelle Preisgestaltung traegt.
- Es sagt nichts ueber Zeitraeume vor dem 2026-07-24: `detail_records` reicht nur
  `last_7_days`, die Render-Logs rund 29 Tage zurueck.
- Es stuetzt sich fuer die Live-Konfiguration auf das Boot-Banner, nicht auf direkt gelesene
  Umgebungswerte - gedeckt sind damit `VOICE_ENGINE`, `TELNYX_AI_ASSISTANT_ENABLED`,
  `BUDGET_MONTH_ENABLED` und die drei Kosten-Decken; alles Uebrige steht unter U6.
- Es bewertet nicht, ob die Inbound-Ausnahme eine bewusste Entscheidung war. `CLAUDE.md`
  begruendet die Rueckabwicklung von E11 ausschliesslich mit KI-Token-Kosten und erwaehnt die
  Carrier-Seite nicht - ob sie damals mitbedacht wurde, ist eine Owner-Frage, keine Messung.
