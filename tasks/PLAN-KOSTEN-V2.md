# PLAN-KOSTEN-V2: Vollstaendige Ist-Kosten je Tenant nach dem ElevenLabs-Umstieg

Stand 2026-08-30. Dies ist das ENDGUELTIGE Strategiedokument. Es ersetzt die beiden
Entwuerfe (`tasks/kostenv2/entwurf-a.md`, `tasks/kostenv2/entwurf-b.md`) und arbeitet die
drei Angriffe (`angriff-premortem.md`, `angriff-cleancode.md`, `angriff-kritiker.md`) ein.
Beweislage ist `tasks/kostenv2/AUFTRAG.md` plus die vier Befunde (`befund-code.md`,
`befund-elevenlabs.md`, `befund-telnyx.md`, `befund-gate.md`).

Es ist fuer eine Session geschrieben, die den Kontext NICHT hat. Jede tragende Zahl nennt
ihre Herkunft. Kennzeichnung durchgehend:

- **BELEGT** = mit Datei:Zeile oder einem am laufenden System gemessenen Wert.
- **VERMUTET** = Schlussfolgerung dieses Dokuments, nicht gemessen.
- **ZU MESSEN IN PHASE N** = bewusst offen gelassen, mit benanntem Ort der Messung.

Umlaut-Konvention wie im gesamten Verzeichnis `tasks/`: ue/oe/ae statt Umlauten.

---

## 1. Das Problem

Seit dem 19.08.2026 fuehrt nicht mehr unsere eigene Turn-Schleife das Gespraech, sondern
ein ElevenLabs-ConvAI-Agent, der per SIP-Trunk an der Telnyx-DID haengt
(`src/elevenlabs/outbound.js`). Damit gibt es seither ZWEI FREMDE Kostentraeger je
Outbound-Anruf - ElevenLabs (Sprachmodell, Spracherkennung, Sprachsynthese) und Telnyx
(SIP-Minuten) -, wo vorher einer genuegte, und die EIGENEN Achsen laufen dabei weiter:
`ai_token` und `research_fee` buchen auch auf dem EL-Weg auf genau die Achse, die
`budgetExceeded` liest - Vorab-Briefing (`api-calls.js:279`, vor der EL-Weiche in `:362`),
Eroeffnungssatz (`api-calls.js:310`, ausschliesslich im EL-Zweig) und der
`summarizeCall`-Rueckfall (`call-finish.js:303-305`), alle drei ausserhalb der Turn-Schleife
(BELEGT am Code, Katalogzeile #4). Der Kostenpfad kennt weiterhin nur einen Traeger. Der Ist-Kosten-Abgleich ueberspringt
JEDEN dieser Anrufe, weil sein Join-Schluessel `providerLegIdOf`
(`src/billing/cost-truing.js:138`) nur `twilioSid` und `callControlId` kennt, ein EL-Anruf
aber ausschliesslich eine `sipCallId` traegt (BELEGT, AUFTRAG B1; Produktions-DB: 12 von 12
EL-Anrufen ohne `call_control_id`, 0 Truing-Versuche, gegen 56 von 56 abgeglichenen Anrufen
im Telnyx-Zeitraum davor). Die ElevenLabs-Kosten stehen in keinem der beiden Buecher: es
existiert repo-weit kein Preis-Parameter und keine Zeile in `src/billing/cost-ledger-map.js`
fuer den ConvAI-Pfad (BELEGT, AUFTRAG B2). Ueber die 8 angenommenen EL-Anrufe wurden
270 EUR-Cent Schaetzung gebucht gegen gemessene 56,28 US-Cent echte ElevenLabs-Kosten auf
4,77 realen Minuten (11,81 US-ct/min im Schnitt, 16,0 US-ct/min im teuersten Anruf, BELEGT,
AUFTRAG B2) plus 32,69 US-Cent Telnyx-SIP-Kosten auf 9 abgerechneten Minuten (BELEGT,
`befund-telnyx.md` O2). Die Warnung, die genau das melden soll, feuert korrekt, landet aber
nirgends: `audit()` (`src/util.js:60`) ist ausschliesslich ein `console.log` und schreibt
NICHT in die Tabelle `audit_log`, fuer diesen Befund-Code ist keine SMS vorgesehen, und der
Eskalations-Zaehler ist prozesslokal und wird von jedem Render-Neustart genullt (BELEGT,
AUFTRAG B3) - Ergebnis: 11 Tage bei 0 % Deckung, einzige Spur eine Log-Zeile.

Die Falle dabei: wer NUR den Join-Schluessel repariert, gleicht gegen Telnyx-Belege ab, die
die ElevenLabs-Kosten gar nicht enthalten, und loescht damit rund 90 % der echten Kosten von
der Gate-Achse (BELEGT quantitativ, `befund-telnyx.md`: 0 bis 33 US-Cent Telnyx gegen
270 EUR-Cent gebuchte Schaetzung). Der halbe Fix ist schlimmer als kein Fix.

---

## 2. Zielbild - was am Ende gilt

1. **Jeder Anruf erklaert vor dem Waehlen, welche Kostentraeger er verursachen wird.** Diese
   Erklaerung ist ein persistiertes, set-once gesetztes Feld (`costProfile`) aus einer
   eingefrorenen Registry, gesetzt an der **Engine-Weiche** - der Zeile, die entscheidet,
   ueber welchen Traeger telefoniert wird.
2. **Je Traeger genau ein Anbieter-Beleg, unveraendert abgelegt.** Belege wohnen in einem
   eigenen Kosten-Buch (Tabelle `call_cost_evidence`), eine Zeile je `(callId, traeger)`,
   append-only, im Anbieter-Rohbetrag mit Waehrung und Herkunft.
3. **Genau EIN Settlement je Anruf.** Es summiert alle Belegzeilen, rechnet einmal um und
   ruft einmal `applyCostCorrectionCents` (`src/store/state-ops.js:3798`).
4. **Nach oben immer, nach unten nur mit Vollbeleg.** Die Vollstaendigkeit misst sich am
   PROFIL-SOLL, nie an dem, was zufaellig eingetroffen ist. Eine leere oder unbekannte
   Pflichtmenge ist NIEMALS Vollstaendigkeit.
5. **Ein Ausfall dieser Art faellt binnen Stunden auf**, unabhaengig davon, ob irgendein
   Anruf schon faellig ist - ueber einen Herzschlag ("Anrufe mit Profil X in den letzten
   N Stunden, davon 0 mit Beleg des Pflicht-Traegers Y") auf dem bestehenden, durablen
   Meldeweg.
6. **Der Tarif ist nur noch die Vorab-Reserve, nicht die Endabrechnung**, und er wird gegen
   gemessene Vollkosten geprueft - nicht gegen sich selbst fortgeschrieben.
7. **Die Safety-Gates sind unveraendert.** Die Kette macht die pro-Tenant-Kostendecke
   ausschliesslich GENAUER, nie durchlaessiger.

---

## 3. Die Kostenarten-Tabelle

Vollstaendig - auch die Arten, die bewusst NICHT je Tenant umgelegt werden. "Gate-Achse"
meint `usage.costCents`, die Zahl, die `budgetExceeded` liest. "Erloes-Buch" meint
`usage_event`, die Stripe-Meter-Quelle. "Kosten-Buch" meint die neue Tabelle
`call_cost_evidence`.

### 3.1 Warum es DREI Buecher sind und nicht zwei

Der Auftrag spricht von zwei Buechern. Am Code ist eines davon bereits vergeben:
`src/billing/meter.js` aggregiert JEDE `usage_event`-Zeile je `(tenantId, kind)` und meldet
sie an `billing.reportMeter`; `flushableMeterEvents` (`src/store/state-ops.js:4241-4249`)
filtert AUSSCHLIESSLICH nach Flush-Epoche, es gibt keinen kind-Filter (BELEGT,
`befund-code.md` 1 und `angriff-kritiker.md` K7). Eine Lieferantenkosten-Zeile in
`usage_event` waere damit eine Kundenrechnung - Doppelfakturierung, nicht Kostenerfassung.

Ein Filter im Flush loest das nicht sauber: nicht gelieferte Events werden nie ueber
`markMeterEventsSent` (`state-ops.js:4253`) markiert, bleiben also dauerhaft in
`pendingMeterEvents`, die Pending-Menge waechst monoton, und die Betriebskennzahl "Rueckstand"
wird blind (BELEGT, `angriff-kritiker.md` K7). Zusaetzlich ist `usage_event.cost_cents`
`BIGINT NOT NULL` (`src/db/schema.sql:844`), also ganzzahlige Cent ohne Rest-Uebertrag -
Kosten- und Gate-Achse liefen um bis zu einen Cent je Posten auseinander (BELEGT,
`angriff-premortem.md` 3).

**Entscheidung: eigenes Kosten-Buch.** Lieferantenkosten kommen NICHT in `usage_event`.
Der Auftragswortlaut "beide Buecher" wird als "Gate-Achse + ein Buch, in dem der Beleg
steht" gelesen. Das war eine Auslegung und stand deshalb als Owner-Entscheidung 1 in
Abschnitt 7; sie ist am 2026-08-30 vom Eigentuemer BESTAETIGT worden - eigenes Kosten-Buch
`call_cost_evidence`, `usage_event` bleibt das reine Erloes-Buch.

### 3.2 Arten, die je Anruf und Tenant anfallen

| # | Kostenart (`traeger`) | Quelle (Anbieter, Endpunkt, Feld) | Waehrung | Verfuegbar | Weg in die Gate-Achse | Weg ins Buch | Preisherleitung |
|---|---|---|---|---|---|---|---|
| 1 | `elevenlabs_convai` | ElevenLabs, `GET /v1/convai/conversations/{conversation_id}`, `metadata.cost_fiat` (Summe). Aufschluesselung `charging.llm_price` / `charging.platform_price` / `charging.analysis.price` nur als Detail | USD (BELEGT: `GET /v1/user/subscription` -> `currency: "usd"`, `befund-elevenlabs.md` 3) | synchron am Gespraechsende - die vollstaendige Antwort liegt bereits im Speicher in `persistProviderResult` (`src/elevenlabs/outbound.js:1283`), auf BEIDEN Wegen (regulaeres Ende `:1332`, Abbruch `:1452`); kein zusaetzliches Netz-IO (BELEGT, `befund-code.md` 2/4a). Reifung s. 4.4 | Settlement (4.5) -> `applyCostCorrectionCents` (`state-ops.js:3798`) | Kosten-Buch, Zeile `traeger=elevenlabs_convai` | Anbieter-Ist. Gemessen ueber 8 Anrufe: 0,0099-0,1333 USD je Anruf, 11,81 US-ct/min im Schnitt (BELEGT, AUFTRAG B2) |
| 2 | `telnyx_sip` | Telnyx, `GET /v2/detail_records?filter[record_type]=sip-trunking`, Betrag `cost`, Join `raw.sip_call_id === call.sipCallId` (strikte String-Gleichheit) | USD (BELEGT: `currency="USD"` auf allen 13 gemessenen Records, `befund-telnyx.md` O1) | verzoegert: fruehestens nach `COST_TRUING_DELAY_MINUTES` (Default 30, `src/config.js:1052`); Belegfenster 7 Tage (`PROVIDER_COST_RECORD_WINDOW_DAYS`, `cost-truing.js:119`). Reale Latenz ZU MESSEN IN PHASE KV2-5 | dasselbe Settlement | Kosten-Buch, Zeile `traeger=telnyx_sip` | Anbieter-Ist. Gemessen: 4,01 US-ct/min deutsches Mobilfunkziel (7 von 8 Anrufen), 2,31 US-ct/min deutsches Festnetzziel (1 von 8); IMMER auf volle Minute aufgerundet (BELEGT, `befund-telnyx.md` O2) |
| 3 | `telnyx_call_records` (bis zur Fassung vom 2026-08-30 `telnyx_callcontrol`; umbenannt, Begruendung und Gegenweg s. Owner-Entscheidung 12) | Telnyx, `detail_records`, betragstragend sind ALLE zuordenbaren `record_type`-Werte. Die Typmenge wird NICHT von Hand genannt, sondern aus `ASSIGNABLE_COST_RECORD_TYPES` ABGELEITET (BELEGT, `src/telephony/adapters/telnyx/voice.js:178-180`: `COST_RECORD_TYPES` `:51-54` minus `UNASSIGNABLE_COST_RECORD_TYPES` `:169`) - dasselbe G27-Muster, das der Bestand an dieser Konstante bereits anwendet, und dieselbe Menge, ueber die der Sweep laeuft (`voice.js:656`). Heute sind das SECHS: `sip-trunking` (Leitungs-/Gespraechsminuten), `call-control` (Call-Control-Steuerung des Anrufs), `speech-to-text` (die STT-Kosten der Budget-Engine), `text-to-speech` (Telnyx-seitige Synthese), `recording` (Aufzeichnung), `ai-voice-assistant` (der Kostentyp des Telnyx-Assistant-Pfads, Profil `telnyx_assistant`). Anker `call_control_id` / `telnyx_session_id` / `call_session_id` (`voice.js:140,160,903`) | USD | verzoegert wie #2 | bis KV2-7: Bestandsweg (`refundProven`/`classifyRecords`), unveraendert. Ab KV2-8: dasselbe Settlement (4.5) -> `applyCostCorrectionCents` (`state-ops.js:3798`) wie #1/#2, mit demselben Ergebnis wie der Bestandsweg (Regressionstest KV2-8(i)) | Kosten-Buch, Zeile `traeger=telnyx_call_records`, angelegt ab KV2-5(g) aus dem `measured`-Ergebnis, das `trueOneCall` heute schon bildet (`cost-truing.js:665`) - kein zusaetzlicher Anbieter-Abruf. **Der Betrag ist die Telnyx-GESAMTKOST je Anruf ueber alle zugeordneten Belegtypen**, nicht die eines einzelnen Typs: `voice.js:656` holt jeden Typ aus `ASSIGNABLE_COST_RECORD_TYPES`, `sumRecordMicroCents` (`cost-truing.js:296-305`) summiert OHNE Typfilter. Genau deshalb heisst der Traeger seit dem 2026-08-30 `telnyx_call_records` und nicht mehr `telnyx_callcontrol` - der alte Name versprach eine Kostenart und trug die Summe (Owner-Entscheidung 12). Die Alternative "gar keine Belegzeile, dafuer dauerhaft zwei Settlement-Pfade" ist Owner-Entscheidung 11 (Abschnitt 7), Default ist die Belegzeile | Anbieter-Ist. Bestand: 56 von 56 Anrufen im Telnyx-Zeitraum abgeglichen (BELEGT, AUFTRAG B1). **Die `record_type`-Angabe der Quell-Spalte ist die Traeger-Zuordnung (welche Records den Betrag tragen), NICHT die Pflicht-Typmenge** (das Vollstaendigkeits-Praedikat in `classifyRecords`, `cost-truing.js:328`). Die Pflicht-Typmenge ist ein getrenntes Datum, steht live auf `sip-trunking,call-control` (BELEGT, AUFTRAG O1 / `befund-telnyx.md`, Schluss von O1; `.env.example:573` ist leer, der Wert kommt aus der Produktionsumgebung ueber `csvEnv`, `config.js:1079`) und wird in KV2-5(f) unveraendert gepinnt. Wer sie aus dieser Zeile ableitet, setzt sie auf alle SECHS zuordenbaren Typen und macht `complete` in `classifyRecords` fuer JEDEN Anruf unwahr - keine Erstattung mehr, Deckungsquote dauerhaft 0 %. Die frueher an dieser Stelle genannte Fehlrichtung ("verengt auf `call-control`, LOCKERT die Erstattungsbedingung") galt der Fassung, die hier nur zwei Typen nannte; mit der abgeleiteten Menge kippt der Fehler in die andere Richtung. Falsch bleiben beide |
| 4 | `ai_token` (eigene LLM-Aufrufe: Turn-Schleife, Vorab-Briefing, Eroeffnungssatz, Zusammenfassung) | eigen, `meterAiTokens` (`src/llm-usage.js:23`) -> `trackUsage` -> `bookCents` (`state-ops.js:3655`) | Bucket (EUR-Cent) | live, pro Schleifenrunde | Bestand, unveraendert | gebucht zu KONFIGURIERTEN Modellpreisen; ein Anbieter-Ist-Beleg wird bewusst NICHT eingesammelt. Begruendung Aufwand/Nutzen: die LLM-Anbieter fuehren keinen anruf- und tenant-bezogenen Beleg, und ein konto-weiter Monatsabruf beantwortet die Frage je Anruf nicht. **Preis dieser Entscheidung: eine Preisdrift beim Anbieter ist auf dieser Achse unbeobachtet** - benannter offener Punkt in Abschnitt 9, nicht geschlossen. Die frueher hier stehende Begruendung "kein Beleg noetig - die Kosten entstehen bei uns" ist sachlich FALSCH und deshalb ersetzt: die Kosten entstehen beim LLM-Anbieter (Anthropic bzw. DeepSeek, gewaehlt ueber `config.llm.llmProvider`, `config.js:454-457`, aufgerufen ueber den Anbieter-Port `src/llm.js`) - genau die Bauform, die dieser Katalog drei Zeilen weiter unten bei #7 nach K10 als unzulaessig zurueckweist ("die Kosten entstehen beim Anbieter, ob unser Repo den Satz kennt oder nicht") | Konfigurierte Modellpreise, KEIN Anbieter-Ist: `config.llm.modelPricesUsd` ist eine im Repo gepflegte Preistabelle je Modell und Gueltigkeitsstaffel (`config.js:302-353`, Felder `inPerMTok`/`outPerMTok`/`cacheWritePerMTok`/`cacheReadPerMTok` je Staffel, dazu `validFrom`/`asOf`/`source`), kein abgerufener Satz. `aiCostCents(tokens, config.llm)` rechnet daraus den gebuchten Betrag (`llm-usage.js:23-35`), `bookCents` schreibt ihn (`state-ops.js:3655`). Was die Staffel dokumentiert, ist das ALTER des Satzes (`asOf`, `source`) - nicht seine Richtigkeit: aendert der Anbieter den Preis, bucht Hermes weiter den alten, bis ein Mensch die Tabelle nachzieht, und keine Stelle der Kette merkt es. **Faellt auf dem EL-Weg SEHR WOHL an.** Die frueher hier stehende Aussage "faellt auf dem EL-Weg nicht an: die Turn-Schleife laeuft dort nicht" ist FALSCH und deshalb ersetzt (Abnahmebefund R9-1; die belegte Fassung steht in `tasks/kostenv2/AUFTRAG.md` unter "KORREKTUR 2026-08-30", die Verweise sind in dieser Session am Code nachgeprueft). Aus "die Turn-Schleife laeuft nicht" folgt NICHT "es fallen keine eigenen KI-Token an": DREI Aufrufer buchen auf dem EL-Weg auf genau die Achse, die `budgetExceeded` liest, alle drei AUSSERHALB der Turn-Schleife. (1) `fetchPrecallBriefing` (`src/routes/api-calls.js:279`) steht VOR der EL-Weiche (`:362`) und ist damit gar nicht engine-abhaengig; Bedingungen sind `PRECALL_BRIEFING_ENABLED` zusammen mit `ASSISTANT_CONTEXT_ENABLED` (Und-Verknuepfung, `precall-briefing.js:127`, Flag-Herkunft `config.js:1560`) und ein leerer Owner-Kontext (`if (!ctx.context)`, `api-calls.js:278` - ein vom Auftraggeber mitgegebener Kontext gewinnt und spart den Aufruf). Alle drei Bedingungen sind engine-unabhaengig; die Aussage haengt ohnehin nicht an diesem einen Aufrufer, sondern an allen dreien. Buchung: `bookTokenUsage` (`precall-briefing.js:314`) im Gutfall, `bookEstimatedTokenUsage` (`:263`) beim abgebrochenen Versuch. (2) Der `summarizeCall`-Rueckfall (`src/telephony/call-finish.js:303-305`) laeuft flag-unabhaengig, sobald `call.summary` leer ist, und bucht ueber `bookTokenUsage` (`claude.js:1510`). (3) `fetchOpeningLine` (`api-calls.js:310`) sitzt sogar AUSSCHLIESSLICH im EL-Zweig (`if (config.voice.elevenLabsOutbound.enabled)`, `:302`) und bucht ueber `bookTokenUsage`/`bookEstimatedTokenUsage` (`elevenlabs/opening-line-llm.js:142` bzw. `:97`). Alle drei landen ueber `store.trackUsage` (`llm-usage.js:66` fuer den echten, `:77` fuer den geschaetzten Verbrauch) auf der Gate-Achse. Folge, und sie ist geldrelevant: die Vollkosten je EL-Anruf enthalten Briefing-, Eroeffnungs- und Zusammenfassungs-Token; wer sie fuer den EL-Weg als abwesend fuehrt, unterschaetzt systematisch jeden daraus abgeleiteten Tarif (s. KV2-10 und R9-2) |
| 5 | `research_fee` (Exa) | eigen, `addResearchFeeCostCents` (`state-ops.js:3687`), Aufrufer `src/llm-usage.js:119/133` | Bucket | live beim Werkzeugaufruf | Bestand, unveraendert | kein Beleg noetig | Bestand. **Wichtig:** faellt AUCH auf dem EL-Weg an - `src/routes/webhooks-elevenlabs.js:33` importiert `bookLookupSearchFee` und bucht die Gebuehr waehrend eines EL-Gespraechs live auf die Tenant-Achse (BELEGT, `angriff-kritiker.md` K13). Die Aussage "auf dem EL-Weg entstehen keine eigenen Kosten" ist falsch und darf im Katalog nicht stehen |
| 6 | `sms` (Zusammenfassung/Alarm) | eigen, `config.billing.smsCostCents` (Default 0). **Zwei getrennte Stellen, nicht eine:** der VERSAND steht in `src/telephony/call-finish.js:342-346` (`messaging(call.provider).sendSms`, Body-Kappung `:345` gegen `SMS_BODY_MAX_CHARS` = 1500, `:32`), die BUCHUNG erst danach in `:353` (`store.recordUsageEvent`, `kind=SMS`, `costCents: config.billing.smsCostCents`) - und ausschliesslich NACH erfolgreichem Send: schlaegt `sendSms` fehl, springt der catch an und es wird KEIN Event geschrieben (alles BELEGT, in dieser Session gelesen). Die frueher hier allein genannte `:353` war der Buchungs-, nicht der Versandpunkt | Bucket | sofort | **KEIN Weg, bewusst** - `gate:false`, "strukturell nie vorgesehen" (BELEGT, Zeile `sms` in `src/billing/cost-ledger-map.js`) | keine | Konfigurationswert ohne Anbieterbeleg. Bleibt offen und benannt, s. 8 |
| 7 | `eigen_tts_zeichen` (alter `<Play>`-Synthesepfad) | eigen, `recordTtsCharacters` (`state-ops.js:4464`), zaehlt Zeichen je Tenant | heute keine - es gibt repo-weit keinen Preis-Parameter (BELEGT, Zeile `play_tts_characters` in `cost-ledger-map.js`) | sofort | **heute KEIN Weg** | keine | **Die Begruendung "kein Preis im Repo" ist unzulaessig** - die Kosten entstehen beim Anbieter, ob unser Repo den Satz kennt oder nicht (`angriff-kritiker.md` K10). Ableitbar aus `GET /v1/user/subscription` (Abo-Betrag / Kontingent) ODER dem Ueberschreitungspreis. Die Frage, ob `<Play>`-Zeichen und ConvAI aus DEMSELBEN Kontingent gehen, ist ZU MESSEN IN PHASE KV2-2 (lesender GET, kein Testanruf) |
| 14 | `openai_realtime` | OpenAI Realtime API, WebSocket `wss://api.openai.com/v1/realtime?model=...` (`src/bridge.js:164-167`), Bearer `config.voice.openaiApiKey` (`config.js:1946`), Modell `config.voice.realtimeModel` (Default `gpt-realtime`, `config.js:1947`). Ein Verbrauchsfeld kaeme aus dem `response.done`-Ereignis (`bridge.js:383`) - **heute wird dort keines gelesen** (BELEGT: `grep` auf `usage` in `src/bridge.js` liefert 0 Treffer) | USD (**VERMUTET** - in diesem Lauf NICHT am Anbieter gemessen; es wurde kein OpenAI-Endpunkt abgerufen) | **GEPARKT durch Owner-Entscheidung 9 (2026-08-30)** - ob und in welchem Ereignis die Sitzung ueberhaupt einen Ist-Betrag liefert, ist am Code nicht entschieden und wird erst gemessen, wenn die Engine je wieder aktiviert werden soll (Abschnitt 9). Die Frage waere nur fuer einen Beleg-Einsammler noetig, und der wird nicht gebaut. **Pflicht in KV2-2(f) bleibt allein die PREISQUELLE** aus der OpenAI-Preisliste, weil `preisquelle` und `waehrung` Pflichtfelder jeder Katalogzeile sind (KV2-2(a)) - eine Zeile ohne sie reisst den Import ab | **heute KEINER** (BELEGT: `src/bridge.js` enthaelt grep-weit kein `bookCents` / `trackUsage` / `recordUsageEvent`, 0 Treffer). Der Bestand kennt die Luecke bereits: `REALTIME_MID_CALL_BUDGET_CHECK = false` (`bridge.js:44`) und der Boot-Befund `realtime_no_midcall_budget` (`boot-guard.js:708`, `:724-734`) | **keiner, und zwar ENTSCHIEDEN** - Owner-Entscheidung 9 ist am 2026-08-30 gefallen: OpenAI Realtime wird bis auf Weiteres NICHT verwendet (Wortlaut: "spielt erstmal keine Rolle, haben nicht vor das zu verwenden"). Der Traeger wird ausschliesslich KATALOGISIERT, kein Beleg wird eingesammelt, kein Einsammler gebaut. Die Zeile bleibt trotzdem stehen - "wird nicht verwendet" ist nicht "ist nicht einschaltbar" (s. Absatz unter der Tabelle und der Riegel KV2-2(h)) | OpenAI-Preisliste je Audio-/Text-Token. Im Repo existiert KEIN Preis-Parameter fuer diesen Pfad; der einzige Zahlenwert ist ein Kommentar ("~0,30-0,50 EUR/Minute", `config.js:1944`, gleichlautend `.env.example:948`) - ein Kommentar ist keine Preisquelle. Herleitung ist Messaufgabe KV2-2(f), rein dokumentarisch, ohne Anruf |
| 16 | `mail_zusammenfassung` (Zusammenfassungs-Mail je beendetem Anruf) | Anbieterdienst, ZWEI moegliche Kanaele mit EINER Rangfolge: Brevo (HTTP) VOR SMTP - Auswahl `selectMailer` (`src/wiring/web-login.js:139`), Rangfolge BELEGT `src/mail-boot-probe.js:11-15`, Adapter `src/brevo-mail.js` bzw. `src/smtp-mail.js`. Ausloeser je BEENDETEM Anruf: `src/telephony/call-finish.js:142` -> `planSummaryMail({ store, call, mailer, accounts })`, im selben `finishCall`-Lauf wie die SMS (#6). **Kein Betragsfeld an der Quelle** (BELEGT: weder `src/mail-summary.js` noch `src/brevo-mail.js` enthaelt einen Treffer auf `costCents`/`price`/`Preis`; Positivkontrolle `mail` trifft in beiden Dateien) | **unbekannt** - es gibt repo-weit KEIN Gegenstueck zu `SMS_COST_CENTS` -> `config.billing.smsCostCents` (`config.js:1205`) fuer Mail; `config.mail` fuehrt ausschliesslich Zugang und Absender (`config.js:2105`). Die Konto-Waehrung des Mail-Anbieters ist in diesem Lauf NICHT gemessen (es wurde kein Anbieter-Endpunkt abgerufen) | sofort (synchron am Gespraechsende, derselbe Lauf wie #6) | **KEIN Weg, bewusst** - dieselbe Lage wie #6: der Versand bucht nichts. BELEGT: `call-finish.js` schreibt genau EIN `recordUsageEvent`, und das ist der SMS-Block (`:353`); der Mail-Zweig (`sendSummaryMails`, ab `:141`) schreibt keins | keine | Anbietertarif - Brevo-Transactional-Kontingent bzw. dessen Ueberschreitungspreis, im SMTP-Fall der Postfachtarif. **Im Repo existiert KEIN Preis-Parameter, und genau das ist als Begruendung unzulaessig - exakt die Regel aus Zeile #7**: die Kosten entstehen beim Anbieter, ob unser Repo den Satz kennt oder nicht. Deshalb benannte offene Frage in Abschnitt 9; hergeleitet wird sie dokumentarisch in KV2-2(f), lesend, ohne Versand und ohne Testanruf |

**Zur Zeile #14 (`openai_realtime`) - warum sie im Katalog steht, obwohl sie heute nichts
kostet.** Die Nummern sind IDs, keine Sortierung; #14 steht in 3.2 und nicht in 3.3, weil
die Art je Anruf anfaellt (3.3 fuehrt die Arten ohne Anruf-Dimension, #8-#13, #15 und #17; die
letzte Zeile von 3.2 ist seit der Aufnahme der Zusammenfassungs-Mail #16, nicht #14).
Die zweite Voice-Engine ist kein Zukunftsthema, sondern ein Schalter: `VOICE_ENGINE`
(`config.js:1945`, Default `budget`) entscheidet an drei Stellen, ob ein Anruf durch die
Audio-Bruecke laeuft - Inbound `voice.js:324`, Outbound-TeXML `voice.js:476`, Timer-Zweig
`api-calls.js:409` (alle BELEGT, in dieser Session gelesen). Steht der Schalter auf
`realtime`, oeffnet `bridge.js:164-167` je Anruf eine kostenpflichtige OpenAI-Sitzung, und
KEINE Zeile davon erreicht heute ein Buch oder die Gate-Achse.
**Live steht der Schalter auf `budget`** (BELEGT: `render.yaml:651-652` - `- key: VOICE_ENGINE` steht auf `:651`, `value: budget` auf `:652`; die frueher hier genannte `:651` allein trug den Wert nicht) - es
entstehen aktuell also keine Kosten dieser Art. Genau deshalb gehoert sie in den Katalog:
ein Katalog, der nur die heute aktive Engine kennt, ist derselbe Mechanismus, der zum
19.08. gefuehrt hat (6.4) - ein Flag-Flip, und der Traeger existiert, ohne dass jemand an
ihn gedacht hat.

**Owner-Entscheidung 2026-08-30: OpenAI Realtime wird bis auf Weiteres NICHT verwendet.**
Wortlaut: "spielt erstmal keine Rolle, haben nicht vor das zu verwenden". Damit ist
Owner-Entscheidung 9 (Abschnitt 7) entschieden, und zwar auf Variante (a): **katalogisieren,
nicht bauen.** Kein Beleg-Einsammler, kein Weg auf die Gate-Achse, keine eigene Phase.
**Ersatzloses Streichen der Zeile waere trotzdem falsch, und das ist der ganze Punkt:**
"wird nicht verwendet" ist nicht "ist nicht einschaltbar". `VOICE_ENGINE=realtime` bleibt
ein erreichbarer Schalter (`config.js:1945`, drei Verzweigungsstellen `voice.js:324`,
`voice.js:476`, `api-calls.js:409`), `bridge.js:164-167` oeffnet dann je Anruf eine
kostenpflichtige Sitzung, und `bridge.js` bucht nichts (BELEGT: kein
`bookCents`/`trackUsage`/`recordUsageEvent`, 0 Treffer). Eine geloeschte Katalogzeile machte
genau diesen Zustand wieder unsichtbar - der Mechanismus des 19.08. (6.4).
**Deshalb bekommt die Entscheidung einen Riegel statt nur einer Notiz:** solange der
Kostenpfad dieses Traegers fehlt, meldet der Boot laut, wenn jemand die Engine anschaltet -
nach dem Muster der bestehenden Boot-Gates (`latentCostPathFindings`, `boot-guard.js:708`
ff.; die fatale Variante existiert bereits, `REQUIRED_TYPES_EMPTY`, `:657-664`). Der Riegel
ist Abnahmekriterium KV2-2(h) und bekommt ausdruecklich KEINE eigene Bauphase - er ist eine
Zeile in der Phase, die den Katalog ohnehin anlegt. Ob er fatal (Start verhindern) oder
laut (WARN plus Alarm) ist, war die einzige verbliebene Wahl an diesem Punkt und ist als
Owner-Entscheidung 13 (Abschnitt 7) am 2026-08-30 ENTSCHIEDEN: **fatal** - der Prozess
startet mit `VOICE_ENGINE=realtime` nicht, solange `openai_realtime` keinen Einsammler hat.

**Zur Zeile #16 (`mail_zusammenfassung`) - warum sie hier steht und nicht in 3.3.** Der
Befund, der diese Zeile verlangt hat, nannte 3.3 als Ort. Massgeblich ist aber das Kriterium
der beiden Abschnitte selbst: 3.2 fuehrt "Arten, die je Anruf und Tenant anfallen", 3.3
"Arten ohne Anruf-Dimension". Die Zusammenfassungs-Mail entsteht je BEENDETEM Anruf
(`call-finish.js:142`, im selben Lauf wie die SMS) und ist ueber die Konto-Zuordnung
(`accounts.accountByTenant`, gelesen in `planSummaryMail`) tenant-zuordenbar - sie hat beide
Dimensionen. Sie in 3.3 zu fuehren hiesse, sie als "ohne Anruf-Dimension" zu kennzeichnen,
und das waere am Code falsch. #13 (`infrastruktur`) deckt sie ebenfalls nicht ab: dort
stehen ausdruecklich "Gemeinkosten ohne Verursacher je Anruf". Sie steht deshalb am Ende von
3.2 neben #6 (`sms`), dem strukturell identischen Fall - anrufbezogen, tenant-zuordenbar,
Anbieterdienst, ohne Weg in Gate oder Buch. Die Nummern sind IDs, keine Sortierung (s. #14).
**Was an dieser Zeile heute NICHT belegt ist: der Preis.** Es existiert kein
Preis-Parameter im Repo, und in diesem Lauf wurde kein Mail-Anbieter abgerufen. "Kein Preis
im Repo" ist als Begruendung unzulaessig (Regel aus #7), also steht die Frage als benannter
offener Punkt in Abschnitt 9 und wird in KV2-2(f) hergeleitet.
**Ob aus der Zeile ein GEBAUTER Kostentraeger wird, ist technisch nicht entschieden** - nur
katalogisieren (wie #6) oder einen Beleg-Einsammler bauen sind beide vertretbar, und die
Antwort haengt am erst noch zu messenden Satz je Mail. Das ist Owner-Entscheidung 15
(Abschnitt 7); sie wurde am 2026-08-30 nicht ausdruecklich entschieden und laeuft auf ihrem
Default "nur katalogisieren". Der Plan laesst beide Wege offen: KV2-2 legt in JEDEM Fall nur die
Katalogzeile an und misst die Preisquelle; ein Einsammler waere eine spaetere, eigene Phase
nach KV2-10, und diese Kette wird dafuer nicht umsortiert.

### 3.3 Arten ohne Anruf-Dimension - bewusst oder strukturell NICHT je Tenant umgelegt

Alle stehen mit ihrer Begruendung im Katalog, damit sie "entschieden" aussehen und nicht
"vergessen".

| # | Kostenart | Quelle | Waehrung | Verfuegbar | Gate / Buch | Warum nicht je Tenant |
|---|---|---|---|---|---|---|
| 8 | `el_grundgebuehr` | ElevenLabs, `GET /v1/user/subscription`, `next_invoice.subtotal_cents` = 600 (BELEGT, `befund-elevenlabs.md` 3), Plan "starter", 6 USD/Monat inkl. 30.000 Credits | USD | monatlich | weder noch; reine Anzeige ueber `PLATFORM_FIXED_COST_CENTS_PER_MONTH` (Live-Wert 600, `config.js:1346`, gelesen nur von `GET /api/billing/platform-costs`, `src/routes/api-billing.js:152/156`, Antwort traegt `listPriceNotBilled: true`, BELEGT `befund-gate.md` 4) | Ein fester Monatsbetrag durch Tenants geteilt macht die Kostendecke EINES Tenants abhaengig vom Verhalten der ANDEREN - direkter Widerspruch zum Eigentuemer-Wortlaut "was ER in diesen zwei Minuten verursacht hat". **Nebenbefund, der festzuhalten ist:** der Env-Name traegt "CENTS" ohne Waehrung, der Live-Wert 600 wird in `api-billing.js` als EUR-Cent angezeigt, die ElevenLabs-Rechnung lautet aber auf 600 US-Cent. Zwei Waehrungen auf einem Feld - zu bereinigen in KV2-10 |
| 9 | `el_credit_kontingent` | ElevenLabs, `charging.free_minutes_consumed` / `free_llm_dollars_consumed` (in allen 8 gemessenen Anrufen 0, BELEGT AUFTRAG B2) | Credits | je Gespraech | weder noch; nur Detailfeld an Belegzeile #1 | Solange das Konto unter dem Kontingent liegt, ist `cost_fiat` ein LISTENPREIS, kein Zahlungsstrom (BELEGT, `befund-elevenlabs.md`, Abschlussabgleich: 6,00 USD Grundgebuehr gegen 2,33 USD Summe der Einzelgespraeche). Der Gate-Achse trotzdem den Listenpreis zu buchen ist richtig: ueber dem Kontingent ist er der echte Grenzkostensatz. Die Ueberdeckung darunter ist ein bewusst akzeptierter Sicherheitsaufschlag |
| 10 | `did_miete` | Telnyx-Nummernpreis am Nummern-Datensatz (`number.monthlyCostCents`); `NUMBER_MONTHLY_COST_CENTS` -> `config.billing.numberMonthlyCostCents` (`config.js:1352`) | USD | monatlich | Erloes-Buch ja (`kind NUMBER_MONTH`, `src/billing/metering.js:170`), Gate nein | Tenant-Zuordnung waere eindeutig (eine Nummer gehoert einem Tenant), die Buchung fehlt aber und ist als GEPARKT dokumentiert; heute traegt KEINE reale Nummer einen gelernten Preis (BELEGT, Zeile `number_month` in `cost-ledger-map.js`). Keine Gespraechskostenart - bleibt ausserhalb dieser Kette |
| 11 | `nummern_einkauf` | heute nirgends erfasst. `numberSetupFeeCents` (`config.js`, Namespace `billing`) ist der Preis, den WIR NEHMEN, nicht der, den WIR ZAHLEN | - | einmalig je Nummer | weder noch | Luecke, hier erstmals benannt (aus `entwurf-a.md` #12 uebernommen, in `entwurf-b.md` fehlend, `angriff-kritiker.md` K12). Bleibt ausserhalb dieser Kette, aber als Katalogzeile sichtbar |
| 12 | `stripe_gebuehr` | Stripe, Gebuehrenzeile je Zahlung (Balance-Transaction). Heute in keinem Code gelesen | Zahlungs-Waehrung | je Zahlung | **KEIN Weg, und zwar richtig so**: sie entsteht nicht im Anruf und gehoert nicht auf die Gespraechs-Gate-Achse | keine | In beiden Entwuerfen komplett vergessen (`angriff-kritiker.md` K11). Sie ist real, eindeutig einem Tenant zuzuordnen, anbieterbelegt - und der einzige Posten, der WAECHST, wenn das Produkt erfolgreich ist. Gehoert in den Katalog, sonst heisst der Katalog "alle Kosten, an die wir gedacht haben". Preisherleitung waere die Stripe-Gebuehrenzeile je Buchung; das ist eine eigene Kette |
| 13 | `infrastruktur` (Render, Postgres, Domains) | keine API-Quelle im System | - | monatlich | weder noch | Gemeinkosten ohne Verursacher je Anruf. Preisbildungs-Eingabe (was muss ein Abo kosten), keine Verbrauchskosten |
| 15 | `telnyx_inference` | Telnyx, `detail_records`, `record_type=inference`, Betrag `cost` | USD (VERMUTET - dieselbe Konto-Waehrung wie alle anderen `detail_records`, BELEGT fuer die 13 gemessenen Records `befund-telnyx.md` O2; fuer `inference` selbst nicht einzeln nachgemessen) | mit dem Sweep-Fenster, sobald er den Typ ueberhaupt abriefe | **KEINER - strukturell nicht zuordenbar** (BELEGT, `src/telephony/adapters/telnyx/voice.js:165-169`: der Typ traegt ausschliesslich `conversation_id`, weder den Anker `call_control_id` noch eines der Session-Felder, Messung 2026-07-21). Er steht deshalb in `UNASSIGNABLE_COST_RECORD_TYPES` und faellt aus `ASSIGNABLE_COST_RECORD_TYPES` heraus (`:178-180`); der Sweep holt ihn gar nicht erst ab (`:656`), und selbst abgerufene Belege wuerden ausnahmslos als `session_unresolved` verworfen (`:401-409`, Kommentar `:649`) | Der Anbieter-Ist waere abrufbar, ist aber KEINEM Anruf und damit keinem Tenant zuzuordnen - hier steht "nicht umgelegt" ausnahmsweise nicht fuer eine Entscheidung, sondern fuer eine Unmoeglichkeit. Ob die Art auf unserem Konto ueberhaupt Betraege traegt, ist UNGEMESSEN (s. Absatz unter der Tabelle und Abschnitt 9) |
| 17 | `workos_auth` | WorkOS (User-Management/AuthKit): die Konto-Rechnung des Identitaets-Anbieters. Im Repo gibt es KEINEN Betrags-Endpunkt - der Zugriff ist reiner Login-/Management-Zugriff: Basis `config.auth.workosApiBase` (`config.js:1886`, im Live-Blueprint gesetzt, `render.yaml:615-616`), Login/Logout ueber `makeOidc` (unbedingt gebaut, `src/wiring/web-login.js:164`; Endpunkte `user_management/authorize`, `user_management/authenticate`, `user_management/sessions/logout`, `src/web-auth.js:397/:398/:469`), Nutzerloeschung am Vertragsende ueber `makeWorkosManagement` (`src/workos-management.js:9-10`, Bearer-Aufruf `:23`) mit EIGENEM Schluessel `config.auth.workosManagementApiKey` (`config.js:1894`) - alles BELEGT, in dieser Session am Code gelesen | **ZU MESSEN IN PHASE KV2-2(f)** - Waehrung UND Satz je aktivem Nutzer stehen in der Anbieter-Preisliste, nicht im Repo; in diesem Lauf NICHT gemessen (es wurde bewusst kein Anbieter-Endpunkt abgerufen, lesende Preisrecherche ist Phasenaufgabe). "Kein Preis-Parameter im Repo" ist als Begruendung unzulaessig - dieselbe Regel wie 3.2 Zeile #7 / `angriff-kritiker.md` K10 | monatlich (Konto-Rechnung; Bezugsgroesse ist die Nutzerzahl, nicht der Anruf) | **KEIN Weg, und zwar richtig so** - dieselbe Begruendung wie #12 (`stripe_gebuehr`): die Gebuehr entsteht nicht im Anruf, sondern an der Nutzeridentitaet, und gehoert deshalb nicht auf die Gespraechs-Gate-Achse. Kein Buch, kein Einsammler, kein Pflicht-Traeger irgendeines Profils | Tenant-zuordenbar WAERE sie (eine WorkOS-Identitaet haengt ueber `idp_subject` an genau einem Tenant, `tenantIdpSubject`, `src/store/state-ops.js:3054`) - aber sie hat keine Anruf-Dimension: sie faellt an, solange ein Konto existiert, auch wenn nie telefoniert wird. Damit ist sie exakt die Klasse von #10 (`did_miete`) und #12 (`stripe_gebuehr`): real, anbieterbelegt, zuordenbar - und trotzdem ausserhalb der Gespraechskette |

**Zur Zeile #15 (`telnyx_inference`) - der siebte Telnyx-Belegtyp, der in keinem Buch
ankommt.** `COST_RECORD_TYPES` (`voice.js:51-54`) fuehrt SIEBEN Werte; sechs davon sind
zuordenbar und stehen in Katalogzeile #3, der siebte ist `inference`. Er steht in 3.3 nicht,
weil wir uns gegen eine Umlage ENTSCHIEDEN haetten, sondern weil eine Umlage strukturell
unmoeglich ist: der Beleg traegt keinen Anker und keine Session-Referenz, nur
`conversation_id`. Das ist genau die Klasse Luecke, gegen die dieser Katalog gebaut wird
(3., 6.4) - eine reale Anbieter-Kostenart, die per Konstruktion weder auf einer Gate-Achse
noch in einem Buch landet. Sie hier zu benennen ist der einzige verfuegbare Schutz: sie ist
ab jetzt sichtbar, statt unbenannt zu sein.
**Ungemessen ist, ob dieser Typ auf unserem Konto ueberhaupt Betraege traegt** - der Sweep
ruft ihn nicht ab, und in diesem Lauf konnte es niemand nachholen (der Telnyx-Zugang fiel im
Vorlauf mit HTTP 401 aus, BELEGT `tasks/kostenv2/AUFTRAG.md:138`). Die Frage steht als
benannter offener Punkt in Abschnitt 9; geklaert wird sie in KV2-5(d), im selben lesenden
Abruf, der dort ohnehin gegen `detail_records` faehrt.

**Zur Zeile #17 (`workos_auth`) - warum eine Login-Rechnung in einen
Gespraechskosten-Katalog gehoert.** WorkOS ist weder Zukunftsthema noch Vermutung: der
Identitaets-Anbieter traegt den gesamten Browser-Login (`makeOidc` wird in
`src/wiring/web-login.js:164` unbedingt gebaut, Endpunkte `src/web-auth.js:397/:398/:469`)
und zusaetzlich die Nutzerloeschung am Vertragsende (`src/workos-management.js:9`); die
API-Basis steht im Live-Blueprint (`render.yaml:615-616`). Er ist damit ein bezahlter, aktiv
genutzter Drittanbieter MIT eigener API - und faellt deshalb ausdruecklich NICHT unter #13
(`infrastruktur`), wo als Quelle "keine API-Quelle im System" steht.
Er steht in 3.3 und nicht in 3.2, weil ihm die Anruf-Dimension fehlt: die Gebuehr haengt am
Bestehen eines Nutzerkontos, nicht an einem Gespraech. Genau darin unterscheidet er sich von
#16 (`mail_zusammenfassung`), die je BEENDETEM Anruf entsteht (3.2). Zuordenbar ist er
trotzdem - wie #10 und #12, die dieser Katalog aus demselben Grund fuehrt. Die Nummern sind
IDs, keine Sortierung (s. #14).
**Warum die Zeile jetzt entsteht und nicht spaeter:** die Zeilenmenge wird in KV2-2(d)
gepinnt, und dieser Plan sagt an derselben Stelle selbst, was der Pin leistet - Loeschschutz,
kein Vollstaendigkeitsbeweis. Eine fehlende Zeile findet er nicht, er friert sie als gruenen
Test ein; genau das ist hier bereits einmal passiert (die Zahl stand auf 15, waehrend die
Zusammenfassungs-Mail fehlte). Deshalb steht die Zeile vor der Phase, und die gepinnte Menge
steht auf 17.
**Was an dieser Zeile heute NICHT belegt ist: der Preis.** Weder der Satz je aktivem Nutzer
noch die Waehrung wurden in diesem Lauf gemessen - es wurde kein Anbieter-Endpunkt
abgerufen. Die Frage steht als benannter offener Punkt in Abschnitt 9 und wird in KV2-2(f)
lesend geklaert, aus der Anbieter-Preisliste, ohne Schreibzugriff. Ein GEBAUTER Kostentraeger
wird daraus nicht - das ist keine offene Frage, sondern dieselbe Festlegung wie bei #12: die
Gebuehr entsteht nicht im Anruf (Abschnitt 8, Punkt 16).

### 3.4 Die Waehrungsfrage (O4) - beantwortet

Beide Anbieter-Quellen liefern USD (BELEGT: `befund-telnyx.md` O2, `currency="USD"` auf
allen 13 Records; `befund-elevenlabs.md` 3, `currency: "usd"` am Abo-Endpunkt).
`convertProviderMicroToBucketCents` (`state-ops.js:3705`) ist ausweislich seines eigenen
Kommentars "Provider-Mikro-Cent (USD) -> Ziel-Bucket-Cent (EUR)" und nirgends
Telnyx-spezifisch (BELEGT). **Es gilt EIN Kurs-Pfad, kein zweiter.** Die Belegzeile fuehrt
die Waehrung trotzdem mit, und das Settlement VERWIRFT eine Zeile mit fremder Waehrung
fail-closed, statt sie umzurechnen - dieselbe Regel, die der Telnyx-Adapter fuer
Fremdwaehrungs-Records bereits anwendet (`adapters/telnyx/voice.js:444` prueft gegen
`config.billing.providerCurrency`, BELEGT `angriff-kritiker.md` S11).

Der Kurs selbst (`PROVIDER_TO_BUCKET_RATE_MICRO`, `config.js:1040`) ist ein statischer
Env-Wert ohne Aktualisierungspfad. Das ist ein akzeptiertes Risiko, s. 6.9.

### 3.5 Die Einheit der Rohbetraege - Praezisierung

Der Rohwert im Telnyx-Beleg ist ein Dezimalstring in der Hauptwaehrungseinheit (z.B.
`"0.0401"` = 4,01 US-Cent). Der Faktor `10^8` (`MICRO_CENTS_PER_CURRENCY_UNIT` in
`src/telephony/adapters/telnyx/cost-parse.js:23`) ist der Schiebefaktor in Mikro-Cent, KEINE Einheit, in der die
Daten ankommen (BELEGT, `befund-telnyx.md` O2). ElevenLabs' `cost_fiat` ist ein Float in
USD (Beispiel `0.10420301650668388`, BELEGT `befund-elevenlabs.md` 1) und wird auf demselben
Weg in Mikro-Cent gebracht.

### 3.6 Die IDs - eine Falle, die eine Session bereits gekostet hat

Die Anruf-IDs aus AUFTRAG B2 (`call_...`) sind NICHT die ElevenLabs-Conversation-IDs. Das
Praefix `call_` erzeugt unser eigenes `newId("call")` (`state-ops.js:214`); ein
`GET /v1/convai/conversations/call_mtfm5ss7g3jz` liefert HTTP 404 (BELEGT,
`befund-elevenlabs.md`, Vorbemerkung). Die ElevenLabs-ID steht separat unter
`call.elevenlabsConversationId` (`src/elevenlabs/outbound.js:1448`, `:1515`) und hat das
Format `conv_...`. Die Zuordnungstabelle fuer die 8 gemessenen Anrufe steht in
`tasks/kostenv2/befund-elevenlabs.md`.

---

## 4. Architektur-Entscheidung

**Getragen wird Entwurf A's Datenmodell. Uebernommen wird Entwurf B's Betriebsteil. Die
Durchsetzungsstelle wechselt von der Anruferzeugung zur Engine-Weiche.**

### 4.1 Was aus A traegt und warum

Das **deklarierte Kostenprofil** ist die richtige Antwort auf Auftragspunkt 1. Die
Vollstaendigkeit misst sich an einer Deklaration, nicht an Daten, die ausgerechnet im
Stoerfall fehlen. Entwurf B leitet die Route aus Beweisdaten ab (`sipCallId !== null`), und
genau diese Daten fehlen im einzigen Fall, auf den es ankommt: `sipCallId` hat GENAU EINE
Quelle, `persistProviderResult`, und der Bestandskommentar nennt den Preis selbst - "kommt
nie ein Ergebnis (Anbieter stumm, Prozess vorher weg), bleibt der Schluessel leer"
(`outbound.js:1305-1311`, BELEGT). Ein EL-Anruf traegt zudem nie eine `callControlId`
(`api-calls.js:365-372`, "providerCallSid=null ist Absicht ... ohne callControlId", BELEGT).
Ergebnis waere ein Anruf ohne erkennbare Route, eine LEERE Pflichtmenge und ein
allquantifiziert wahres Vollstaendigkeitspraedikat - volle Erstattung ohne einen einzigen
Beleg. Der Bestand kennt diese Falle woertlich und riegelt sie mit
`requiredRecordTypes.length > 0` ab (`cost-truing.js:318-328`, BELEGT).

Das **eine Settlement je Anruf** ist ebenfalls A. B bucht bei jedem Postenzuwachs erneut die
volle Summe durch `convertProviderMicroToBucketCents` - diese Mechanik fuehrt aber einen
TENANT-weiten Rest-Uebertrag (`usage.costCorrectionMicroCentsRem`), der nur zusammen mit der
Buchung fortgeschrieben wird (`state-ops.js:3818`, Funktion `:3798-3820`, BELEGT). Zweimal
umgerechnet, fliesst der Bruchteil des ersten Betrages ein zweites Mal in den Uebertrag: bis
zu 1 Cent Abweichung
je Zusatzbuchung, systematisch nach oben, auf einer tenant-weiten Achse (BELEGT,
`angriff-kritiker.md` K3, `angriff-premortem.md` 2.5). Bei Anrufkosten von 11 bis 30 Cent
sind das mehrere Prozent.

Das **eigene Kosten-Buch** ist A. Begruendung in 3.1.

### 4.2 Was aus B uebernommen wird und warum

- **`meldeBetreiberAlarm` als einziger Meldeweg.** A listet die Bausteine einzeln auf und
  baut damit eine zweite Formulierung desselben Meldewegs - genau der Fehler, den der
  Bestandskommentar benennt ("EIN Meldeweg (G5) ... ein zweiter Kanal waere genau der
  Fehler, den PM-4 beschreibt", `src/telephony/outage-report.js:105-110`, BELEGT).
- **Der durable Marker `outage_alert`** (`src/db/schema.sql:789-800`, mit `first_seen_at`,
  `last_attempt_at`, `reported_at`, `delivered_channels` und Unique-Index auf offene Zeilen
  je `code`) ersetzt den prozesslokalen `sweepsBelowThreshold`. "Seit X Stunden unter der
  Schwelle" wird damit eine Datenaussage statt einer Prozesserinnerung.
- **Der Herzschlag `kosten:erfassung-tot:<traeger>`** ist der staerkste einzelne Baustein
  beider Entwuerfe: er meldet den Zustand vom 19.08. ohne dass jemand vorher an ihn gedacht
  haben muss, und er haengt nicht an einer Faelligkeit. A's Deckungsquote braucht dagegen
  faellige Anrufe und erfuellt "binnen Stunden" nicht (BELEGT, `angriff-kritiker.md` K8).
- **Der 0-Riegel**: `cost_fiat === 0` bei `call_duration_secs > 0` erzeugt KEINEN Beleg,
  sondern eine WARN-Zeile. A haette daraus einen Vollbeleg gemacht - s. 4.6.
- **Der zweiteilige Tarif** (Grundbetrag + Minutensatz je Route).
- **Die explizite "inert bis zum Umschalter"-Eigenschaft** jeder Vorphase: jede Phase vor
  dem Settlement beweist per Abnahmekriterium, dass sie keinen Cent bewegt.

### 4.3 Die Durchsetzungsstelle - der entscheidende Unterschied zu beiden Entwuerfen

A haengt das Profil an die Anruferzeugung. Das ist am Code aus zwei Gruenden falsch:

**Erstens ist es wirkungslos gegen genau den Fall, gegen den es beworben wird.** Es gibt
genau ZWEI Anruf-Erzeugungsstellen: `src/routes/api-calls.js:321` (outbound) und
`src/routes/voice.js:320` (inbound) (BELEGT, `angriff-kritiker.md` S14, in dieser Session
nachgeprueft: `grep` auf `store.createCall(` liefert genau diese zwei). Der ConvAI-Umstieg
hat KEINE davon angefasst - der Anruf wird bei `:321` erzeugt, die Engine-Weiche faellt
41 Zeilen spaeter bei `api-calls.js:362` an einem Config-Flag
(`config.voice.elevenLabsOutbound.enabled`), und der Kommentar dort sagt es selbst: "Der
PROVIDER des Anrufs bleibt telnyx ... deshalb keine Provider-Abfrage, sondern ein
Engine-Schalter" (BELEGT, in dieser Session gelesen). Ein Profil, das bei `:321` gesetzt
wird, kann den Traeger nicht kennen, ueber den der Anruf gleich laufen wird. A's
Inventar-Test waere am 19.08. gruen geblieben.

**Zweitens macht A daraus die Vorbedingung der Call-Erzeugung selbst** ("Ein neuer Wahlpfad,
der kein Profil setzt, kann keinen Call anlegen") - und stellt diese Phase an den Anfang der
Kette, VOR die Reparatur des Alarmwegs. Ein uebersehener Sonderfall blockiert dann sofort
und vollstaendig echte Anrufe, mit dem schwaechsten verfuegbaren Sicherheitsnetz
(`angriff-cleancode.md` Befund 1).

**Entscheidung:** Das Profil wird an der **Engine-Weiche** gesetzt - in jedem der drei
Zweige unter `api-calls.js:362 ff.` (ElevenLabs, Telnyx-Assistant, TeXML) je einmal, plus
in JEDEM der beiden Inbound-Zweige ab `voice.js:324`. Es ist set-once am Anruf-Datensatz.

**Ausdruecklich NICHT an `voice.js:320`.** Das ist die Anruferzeugung, nicht die Weiche
(BELEGT, in dieser Session gelesen: `:320` `store.createCall`, `:321` `store.markAnswered`,
`:322` `lifecycle.armMaxDurationTimer`) - also genau der Fehler, den dieser Abschnitt oben
an Entwurf A als "am Code falsch" zurueckweist, auf dem Inbound-Pfad wiederholt. Die
Inbound-Engine-Weiche faellt vier Zeilen spaeter bei `voice.js:324`
(`config.voice.voiceEngine === VOICE_ENGINE.REALTIME`), und die beiden Zweige tragen
UNTERSCHIEDLICHE Kostentraeger: der Realtime-Zweig gibt `streamDirectives(call)` aus und
laesst den Anruf durch die Audio-Bruecke laufen, die je Anruf eine kostenpflichtige
OpenAI-Sitzung oeffnet (`bridge.js:164-167`, Katalogzeile #14). Ein einziges Profil
`telnyx_inbound` mit dem Pflicht-Traeger `telnyx_call_records` deckte beide Engines ab, und
ein spaeterer Flip auf `VOICE_ENGINE=realtime` bliebe an KV2-2(c) gruen - dieselbe stille
Luecke wie am 19.08. Deshalb zwei Inbound-Profile, `telnyx_inbound_budget` und
`telnyx_inbound_realtime`, je Zweig eines (KV2-2). Der Schreibweg
LEHNT KEINEN ANRUF AB: fehlt das Profil, entsteht der Anruf trotzdem, es wird eine
WARN-Zeile und ein Befund `profil_fehlt` erzeugt. **Fail-closed wird stattdessen das
Settlement**: ein NACH dieser Kette entstandener Anruf ohne Profil wird nie gesettelt,
bekommt nie eine Erstattung und meldet sich (4.6, Zeile "Profil unbekannt (Anruf NACH der
Kette entstanden)"). Eine Altzeile von VOR der Kette ist davon ausdruecklich ausgenommen -
sie faellt auf ein Legacy-Profil zurueck. **Welches, entscheidet `sipCallId`, und diese
Fallunterscheidung ist nicht kosmetisch, sondern der Riegel gegen eine ungewollte Erstattung
an den 12 EL-Altanrufen:**

- Altzeile mit LEEREM `sipCallId` -> `telnyx_budget` bzw. `telnyx_inbound_budget`, gesettelt
  wie heute, Erstattung eingeschlossen.
- Altzeile mit GESETZTEM `sipCallId` -> `el_convai_sip`, also in den EL-Schutz aus KV2-5
  hinein: fuer diese Anrufe wird `bookCorrectionFor` nicht gerufen, es bewegt sich null Cent.

Der Grund steht in der Produktions-DB und ist am 2026-08-30 gemessen worden (BELEGT,
lesende Abfrage ueber `call` je Tenant): es gibt genau 12 Anrufe mit gesetztem
`elevenlabs_conversation_id`, alle bei Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH`; **12 von
12 tragen `sip_call_id`, 12 von 12 haben `ended_at`, KEINER hat `call_control_id` oder
`twilio_sid`, KEINER hat `cost_trued_at`, die Summe ihrer `cost_truing_attempts` ist 0**,
und ihre `estimated_cost_cents` summieren sich auf genau die 270, die Owner-Entscheidung 7
nennt. Heute sind sie deshalb nicht abrufbar - `providerLegIdOf` (`cost-truing.js:138`)
kennt nur `twilioSid` und `callControlId` und liefert `null`, `isRetrievable`
(`cost-truing.js:581`) ist falsch. **Genau das kippt der Join aus KV2-5**, der
`call.sipCallId` als dritte Alternative lernt: ab diesem Deploy sind alle 12 erstmals
abrufbar, sie haben `costTruedAt === null` und 0 Versuche, sind also Kandidaten, laufen in
`trueOneCall` - und dort ruft `cost-truing.js:684` `bookCorrectionFor` fuer JEDEN gemessenen
Anruf. Faellt die Legacy-Zuordnung fuer sie auf `telnyx_budget`, greift der EL-Schutz aus
KV2-5 NICHT (er haengt am Profil `el_convai_sip`, so ist Abnahmekriterium KV2-5(a)
formuliert), und ob daraus eine Erstattung wird, entschiede allein die in KV2-5(d) noch
UNGEMESSENE Frage, ob EL-Legs `call-control`-Belege fuehren: fuehren sie welche, liefert
`classifyRecords` `complete`, `refundProven` ist wahr, und die 30-ct-Schaetzung wuerde auf
den reinen SIP-Anteil (4,01 US-ct) heruntergesetzt - exakt die B6-Falle, gegen die dieser
Plan gebaut ist, und ein direkter Widerspruch zu Owner-Entscheidung 7 und Abschnitt 8
Punkt 9. Die Zuordnung ueber `sipCallId` widerspricht 4.1 nicht: sie gilt fuer eine
abgeschlossene, endliche Altmenge (12 Zeilen, Stand 2026-08-30) und nie fuer einen neuen
Anruf - neue Anrufe bekommen ihr Profil an der Weiche.
Welche der beiden Bauformen dieses Riegels gewaehlt wird - Umlenkung auf `el_convai_sip`
oder vollstaendige Herausnahme aus dem Buchungspfad - ist Owner-Entscheidung 14
(Abschnitt 7), am 2026-08-30 nicht ausdruecklich entschieden und auf ihrem Default (a)
laufend; das OB des Riegels dagegen ist durch Owner-Entscheidung 7 entschieden. realisiert und gepinnt wird sie in KV2-5(h), also in derselben Phase, die
die Gefahr erzeugt (4.6, Zeilen "Profil unbekannt (Altzeile vor der Kette ...)"). Damit ist die schlechteste Folge eines NEUEN Fehlers "kein Refund", niemals
"kein Anruf" - fuer Altzeilen gilt weiterhin das bestehende Verhalten. Der Inventar-Test
bindet die WEICHEN-ZWEIGE, nicht die Erzeugungsstellen.

**Eine Weiche bleibt bewusst ungeloest und steht als Owner-Entscheidung 10 in Abschnitt 7 -
sie ist am 2026-08-30 nicht ausdruecklich entschieden worden und laeuft auf ihrem Default
(`telnyx_budget` unveraendert).**
Der OUTBOUND-TeXML-Zweig hat dieselbe Zweiteilung wie Inbound, nur an einer anderen Stelle:
`api-calls.js` verzweigt dort NICHT auf die Engine (der `else`-Zweig ab `:394` ist fuer
`budget` und `realtime` derselbe Code, einziger Unterschied ist der Timer-Guard `:409`), die
Engine-Weiche faellt erst im Webhook `/voice/outbound` bei `voice.js:476` - also NACH der
Anruferzeugung und nach dem Zeitpunkt, an dem das Profil bisher geschrieben wuerde (alle
BELEGT, in dieser Session gelesen). Das Profil `telnyx_budget` deckt damit heute zwei
Engines ab. Weil die Loesung eine Entscheidung verlangt (Profil im Webhook nachschreiben,
oder in `api-calls.js` aus `config.voice.voiceEngine` ableiten - beides hat einen Preis),
trifft dieser Plan sie nicht, sondern legt sie dem Eigentuemer vor.

### 4.4 Reife - die Antwort auf das ungemessene O3

O3 (wann ist `cost_fiat` endgueltig?) ist NICHT gemessen und war in den Vorlaeufen nicht
messbar: es gab in der gesamten Kontohistorie (27 Konversationen) keinen Anruf juenger als
4 Stunden 20 Minuten, und ein Testanruf war verboten (BELEGT, `befund-elevenlabs.md` 2).
Belegt ist Stabilitaet ueber mindestens 4h20m bis mehrere Tage: derselbe Anruf wurde
26 Mal abgerufen, der Wert war byteidentisch, und alle 8 Werte decken sich exakt mit der
Lead-Messung aus AUFTRAG B2. NICHT belegt ist das Verhalten in den ersten Sekunden bis
Minuten.

Die Kette macht O3 von einem Blocker zu einem Parameter:

- Der bei Gespraechsende synchron gegriffene Wert wird IMMER als `vorlaeufig` abgelegt. Er
  darf **nachbuchen** (eine Untergrenze ist sicher), aber **nie erstatten**.
- Ein spaeterer Abruf (`fetchConversation`, `src/elevenlabs/convai.js:235`, existiert
  BELEGT) mindestens `EL_EVIDENCE_MIN_AGE_MINUTES` (neu, Default 15 - **VERMUTET**, nicht
  hergeleitet) nach Gespraechsende hebt die Zeile auf `belegt`. Weicht der Wert ab, gilt der
  HOEHERE, und die Abweichung wird gezaehlt: das ist die nachgeholte O3-Messung.
- Auf dem **Abbruchweg** gibt es keinen zweiten Abruf: `endActiveCall` ruft unmittelbar nach
  dem Ergebnisabruf `endConversation`, ein DELETE beim Anbieter, das "vermutlich den
  kompletten Datensatz mitnimmt" (Bestandskommentar `outbound.js:1429-1431`, Aufruf
  `:1452-1460`, BELEGT). Diese Anrufe - darunter die vom Max-Dauer-Cap beendeten, also die
  teuersten - bleiben strukturell `vorlaeufig`. Das ist die sichere Richtung, hat aber eine
  Nebenwirkung, die A nicht benennt: sie zaehlen dauerhaft als "nicht voll belegt". Deshalb
  bekommen sie einen EIGENEN Endzustand (`beleg_strukturell_unbeschaffbar`, s. 4.6) und
  gehen NICHT in die Deckungsquote ein - sonst ist der Alarm dauerhaft an, und ein Alarm,
  der immer an ist, ist keiner (`angriff-premortem.md` 2.4).

Ein Plan-Wechsel bei ElevenLabs wirkt nicht rueckwirkend: `charging.tier` stand in allen
gemessenen Anrufen auf `starter`, und laut oeffentlicher FAQ gelten bei Upgrade neue
Konditionen ab dem Wechselzeitpunkt, bei Downgrade erst nach dem laufenden Zyklus (BELEGT
im Sinn von "oeffentlich dokumentiert", nicht am eigenen Konto nachvollzogen,
`befund-elevenlabs.md` 3). **O5 ist damit beantwortet: ein gebuchter `cost_fiat` ist final
und muss bei einem Tarifwechsel nicht neu berechnet werden.**

### 4.5 Das Settlement

Ein Anruf ist *faellig*, wenn (a) alle Pflicht-Traeger seines Profils eine Belegzeile mit
`reife=belegt` haben, ODER (b) die Frist `COST_SETTLE_DEADLINE_HOURS` abgelaufen ist. Dann,
genau einmal:

```
actualCostMicroCents := Summe der Belegzeilen mit reife=belegt ODER vorlaeufig
                        (Zeilen im Zustand "erwartet" tragen NICHTS bei - sie haben
                         keinen Betrag, nicht den Betrag 0)
dataComplete         := jeder Pflicht-Traeger des PROFILS hat eine Zeile mit reife=belegt
                        UND das Profil ist bekannt UND die Pflichtmenge ist nicht leer
-> store.applyCostCorrectionCents(tenantId, {
     actualCostMicroCents, estimatedCostCents: call.estimatedCostCents,
     providerToBucketRateMicro, dataComplete, chargeAnchors: chargeAnchorsOfCall(call) })
```

Danach `costTruedAt` setzen (der bestehende set-once-Riegel, `state-ops.js:804-812`) und die
Summe in `actualCostMicroCents` schreiben - dasselbe Feld wie heute, jetzt mit der Bedeutung
"Summe ueber alle Traeger".

Die Asymmetrie muss NICHT neu gebaut werden: `applyCostCorrectionCents`
(`state-ops.js:3798-3820`) verwirft einen negativen Delta bereits ohne `dataComplete`
(`:3815`, BELEGT, "verworfen wird VOR jeder Mutation"; die Fortschreibung des
Rest-Uebertrags steht auf `:3818` und laeuft nur zusammen mit der Buchung). Was sich aendert, ist ausschliesslich,
WORAUS `dataComplete` entsteht - heute aus `refundProven` (`cost-truing.js:452-460`), das
genau EINEN `measured`-Wert kennt.

**Jeder Pflicht-Traeger eines Profils braucht einen Einsammler - sonst ist `dataComplete`
strukturell falsch.** Das Praedikat oben misst Beleg-Ist gegen Profil-Soll; ein Traeger, den
keine Phase je einsammelt, macht es fuer sein Profil dauerhaft unwahr, die Belegsumme 0 und
den Herzschlag zum Dauer-Alarm. Deshalb ist die Zuordnung Teil der Architektur und nicht
Teil einer Phase: `elevenlabs_convai` -> KV2-4, `telnyx_sip` -> KV2-5, `telnyx_call_records`
-> KV2-5(g). Die EINZIGE Ausnahme ist `openai_realtime`: der Traeger steht im Profil
`telnyx_inbound_realtime` als `nicht_belegpflichtig` und geht damit gar nicht erst in die
Pflichtmenge ein (Owner-Entscheidung 9, entschieden am 2026-08-30: die Engine wird bis auf
Weiteres nicht verwendet, der Traeger wird katalogisiert und nicht gebaut; dass der Schalter
trotzdem erreichbar bleibt, deckt der Boot-Riegel KV2-2(h) ab). Ein Traeger ist entweder
belegpflichtig UND hat einen Einsammler, oder er ist ausdruecklich nicht belegpflichtig -
ein dritter Zustand ist ein Fehler.

**Welcher Test diesen dritten Zustand faengt - und welche zwei ihn NICHT fangen.** Die
frueher an dieser Stelle genannten Tests decken ihn nicht ab, und das ist an ihrem eigenen
Wortlaut nachlesbar: KV2-2(c) prueft ausschliesslich, dass an jedem der FUENF Weichen-Zweige
ein `costProfile` gesetzt ist und in der Registry steht - ueber die Zuordnung
Traeger-zu-Einsammler sagt er nichts; KV2-6(f) pinnt genau EINEN Traeger,
`telnyx_call_records`, und schweigt zu jedem anderen. Ein NEUES Profil oder ein neuer
Pflicht-Traeger ohne Einsammler liefe durch beide gruen hindurch und machte `dataComplete`
fuer sein Profil dauerhaft unwahr: Belegsumme 0, negativer Delta, nie wieder eine Erstattung
- dieselbe Schadensklasse, die Owner-Entscheidung 11 fuer `telnyx_call_records` beschreibt,
nur ohne den Befund, der sie dort sichtbar gemacht hat. Deshalb bekommt die Zuordnung einen
eigenen Test: **KV2-2(i)** prueft sie fuer JEDES Profil und JEDEN seiner Traeger. Das ist
keine Owner-Frage, sondern die belastbarere der beiden moeglichen Korrekturen - die andere
waere gewesen, diesen Absatz auf das zurueckzunehmen, was (c) und (f) wirklich decken, und
die Regel damit zu einer Absichtserklaerung ohne Durchsetzung zu machen.

*Der Gegenweg bleibt offen (Owner-Entscheidung 11 - nicht ausdruecklich entschieden, sie
laeuft auf ihrem Default (a) "bauen").* Faellt sie spaeter auf (b), gilt an dieser
Stelle stattdessen: ein Profil, dessen Pflicht-Traeger keinen eigenen Einsammler hat, wird
weiter ueber den Bestandspfad gesettelt - `classifyRecords` (`cost-truing.js:328`) und
`refundProven` (`:452-457`) entscheiden dort ueber die Erstattung, nicht die Belegsumme.
Dann darf KV2-8 `refundProven` NICHT ersetzen, sondern ausschliesslich ERGAENZEN, und der
Herzschlag muss diese Traeger ausnehmen. Der Preis dieses Wegs steht in Abschnitt 7.

**Erneute Messung desselben Traegers** (Telnyx re-rated einen Record, ElevenLabs korrigiert
nach): die einzige sichere Regel ist "nach oben immer, nach unten nur mit vollstaendiger
Menge". Konkret: ein hoeherer Wert ersetzt den alten und der Anruf wird erneut faellig; ein
niedrigerer Wert wird nur uebernommen, wenn das Profil vollstaendig belegt ist. Beide
Entwuerfe lassen diesen Fall offen (`angriff-premortem.md` 2.2).

### 4.6 Die Matrix - nachbuchen, erstatten, verfallen

| Lage bei Faelligkeit | Ist > Schaetzung | Ist < Schaetzung |
|---|---|---|
| alle Pflicht-Traeger `belegt` | nachbuchen | **erstatten** |
| ein Traeger fehlt, Frist laeuft noch | warten, nichts buchen | warten |
| ein Traeger fehlt, Frist abgelaufen | nachbuchen | **nichts** - Schaetzung bleibt stehen, Endzustand `unvollstaendig_final`, Traeger namentlich |
| Traeger nur `vorlaeufig` | nachbuchen | **nichts** |
| Beleg strukturell unbeschaffbar (zwei Wege, zwei Erkennungen: Abbruchweg -> KV2-7(e), am Beleg; Deploy im Gespraech -> KV2-7(h), am Anruf) | nachbuchen mit dem, was da ist | **nichts**, Endzustand `beleg_strukturell_unbeschaffbar`, zaehlt NICHT in die Deckungsquote |
| Profil unbekannt (Altzeile vor der Kette, `sipCallId` LEER) | Legacy-Profil `telnyx_budget` bzw. `telnyx_inbound_budget` anwenden | wie heute, Erstattung eingeschlossen |
| Profil unbekannt (Altzeile vor der Kette, `sipCallId` GESETZT - die 12 EL-Altanrufe) | **nichts**, null Cent | **nichts**, null Cent - Legacy-Profil ist `el_convai_sip`, damit greift der EL-Schutz aus KV2-5 (`bookCorrectionFor` wird fuer die EL-Route nicht gerufen); Owner-Entscheidung 7, Bauform Owner-Entscheidung 14, gepinnt in KV2-5(h) |
| Profil unbekannt (Anruf NACH der Kette entstanden) | **gar nichts** + Befund `profil_fehlt` | dito |
| Betrag 0 bei Mengenangabe > 0 | **kein Beleg**, WARN + Befund | **kein Beleg**, WARN + Befund |
| Betrag 0 bei Mengenangabe 0 (nicht angenommener Anruf) | gueltiger Beleg mit 0 | gueltiger Beleg mit 0 |

**Die beiden Altzeilen-Zeilen sind KEINE Doppelung, sondern der Riegel gegen eine
ungewollte Erstattung an den 12 EL-Altanrufen.** Eine einzige Legacy-Regel, die jede
profillose Altzeile auf `telnyx_budget` abbildet, wuerde diese 12 ab dem KV2-5-Deploy in
`bookCorrectionFor` (`cost-truing.js:684`) laufen lassen - Herleitung, Messung und die
beiden offenen Bauformen stehen in 4.3 bzw. Owner-Entscheidung 14 (Abschnitt 7).

Die beiden `Betrag 0`-Zeilen sind der Riegel gegen den schwersten Befund gegen Entwurf A: A
haette `microCents: 0` generell als Vollbeleg gewertet. Aendert ElevenLabs eine Plan-Stufe,
erweitert das Freikontingent oder benennt ein Feld um, sodass `cost_fiat` fuer angenommene
Gespraeche 0 traegt, waeren damit ALLE Pflicht-Traeger belegt, `dataComplete` waere wahr,
und die Differenz zur 30-ct-Schaetzung ginge als Gutschrift zurueck - jeder Anruf kostete
den Tenant faktisch nur den SIP-Anteil, waehrend wir die EL-Rechnung weiter zahlen, und die
Deckungsquote staende bei 100 % (`angriff-premortem.md` 1.1). Der Bestand kennt die richtige
Regel bereits an zwei Stellen: `sumRecordMicroCents` liefert `null` statt 0 bei Datenfehlern
(`cost-truing.js:296-305`) und `refundProven` verlangt `billedSecTotal > 0`
(`cost-truing.js:452-457`), beides BELEGT. Mengenangabe heisst konkret: `billed_sec` beim
Telnyx-Beleg, `call_duration_secs` beim EL-Beleg.

### 4.7 Die Schliessregel - der gemeinsame Befund gegen beide Entwuerfe

`trueOneCall` setzt heute `closed = measured !== null || attempt >= maxAttempts` und schreibt
damit `costTruedAt`, sobald EINE Messung vorliegt; danach ist der Anruf nie wieder Kandidat
(`isTruingCandidate` verlangt `costTruedAt === null` UND
`nextCostTruingAttempt(call) <= COST_TRUING_MAX_ATTEMPTS`, Default 5, `config.js:1070`;
`cost-truing.js:288-294`, BELEGT). Der Bestandskommentar sagt es ausdruecklich: "RIEGEL GEGEN
DOPPELZAEHLUNG ist costTruedAt und sonst nichts."

Beide Entwuerfe brauchen das Gegenteil - der Anruf muss ueber mehrere Sweeps Kandidat
bleiben, bis die Traegermenge vollstaendig ist. A erwaehnt die Regel nirgends (Folge: die
erste Telnyx-Messung latcht den Anruf zu, `dataComplete` waere fuer EL-Anrufe NIE wahr, und
die Reifungsphase waere toter Code mit gruenen Tests). B stellt sie um, aber drei Phasen zu
spaet (`angriff-premortem.md` 4).

**Entscheidung: die Schliessregel bleibt in KV2-7, der Phase, die Frist, Versuche und
Endzustaende einfuehrt - NICHT in der Phase, die die Belegmenge einfuehrt (das ist KV2-3
fuer das Buch, KV2-4/KV2-5 fuer die Traeger, nicht KV2-7) -, und lautet: geschlossen wird,
wenn die Pflichtmenge vollstaendig ist ODER Frist/Versuche erschoepft sind - nie bei der
ersten Teilmessung.** Fuer Profile mit genau einem Pflicht-Traeger (`telnyx_budget`,
`telnyx_inbound_budget`, `telnyx_assistant`) ist das Verhalten byte-identisch zu heute; das
ist Abnahmekriterium.

Zusaetzlich: Versuche werden JE TRAEGER gezaehlt, nicht je Anruf. Sonst ist die Frist
dekorativ - bei 5 Versuchen im Stundentakt erschoepft der Zaehler nach ~5 Stunden, lange vor
jeder 24- oder 48-Stunden-Frist, und der Befund `settle_deadline_expired` feuerte nie
(`angriff-premortem.md` 2.2).

**Phasenschnitt-Luecke, benannt statt uebersehen.** KV2-5 laesst `providerLegIdOf` bereits
`call.sipCallId` lernen - ab diesem Deploy sind EL-Anrufe erstmals `isRetrievable`
(`cost-truing.js:581`) und laufen durch `trueOneCall`, aber die Schliessregel dieser Phase
existiert dort noch nicht. Bis zum KV2-7-Deploy gilt fuer sie weiter die ALTE Regel
(`closed = measured !== null`, s.o.): jeder EL-Anruf, der in diesem Fenster einen
ausschliesslichen Telnyx-SIP-Beleg bekommt, wird faelschlich als vollstaendig gemessen
behandelt, `costTruedAt` wird gesetzt, und der Anruf faellt dauerhaft aus
`isTruingCandidate` (`:288-294`) - ohne den Nachlauf unten koennte KV2-8 ihn NIE setteln.
KV2-7 liefert deshalb, zusaetzlich zur neuen Regel selbst, den benannten einmaligen
Nachlauf, der genau diese im Fenster gelatchten Anrufe wieder oeffnet - erkannt an ihrem
Zustand (Profil, `costTruedAt`, vorhandener Telnyx-SIP-Beleg, fehlender EL-Beleg), NICHT an
einem Deploy-Zeitfenster (s.u., Abnahmekriterium (g)).

**Es gibt einen ZWEITEN Phasenschnitt derselben Bauart, und er braucht einen eigenen
Nachlauf.** Der Nachlauf hier erfasst ihn ausdruecklich NICHT: seine Bedingung 4 verlangt,
dass KEINE `elevenlabs_convai`-Zeile mit `reife=belegt` ODER `vorlaeufig` existiert - ab
KV2-4 existiert diese Zeile aber IMMER (synchron am Gespraechsende angelegt, `vorlaeufig`).
Der zweite Schnitt liegt zwischen dem KV2-8- und dem KV2-9-Deploy: dort ist das Settlement
schon scharf, die EL-Zeile aber noch nicht reifbar, sodass ein Zwangs-Settlement nach Frist
den Anruf in `unvollstaendig_final` schliesst. Er wird in KV2-9 behandelt, nicht hier - mit
einer benannten Vorbedingung UND einem eigenen einmaligen Nachlauf.

### 4.8 Die Herkunftsangabe des Ist-Werts

`COST_TRUING_SOURCE` (`src/store/defaults.js:185-190`) ist eine fail-closed Enum mit genau
vier Werten (`telnyx_detail_records`, `incomplete`, `no_estimate`, `unavailable`);
`recordCallCostTruingResult` (`state-ops.js:804-807`) weist jeden anderen Wert ab (BELEGT,
in dieser Session gelesen). Drei geldrelevante Leser haengen an `DETAIL_RECORDS`:
`refundProven` (`cost-truing.js:452-458`), `truedSourceOf` (`:466-472`) und `isDriftSample`
(`src/billing/cost-calibration.js:57`). Kein Entwurf sagt, welchen Wert ein
Mehr-Traeger-Settlement schreibt (`angriff-kritiker.md` K4).

**Entscheidung:** die Enum bekommt zwei neue Werte - einen fuer "alle Pflicht-Traeger
belegt" und einen fuer "Frist abgelaufen, Teilbeleg" -, und alle drei Leser werden im
SELBEN Commit umgestellt (KV2-8). Der Bestandskommentar an der Enum formuliert die
tragende Regel bereits: "zwei Ursachen teilen sich NICHT ein Label"
(`defaults.js:180-184`, BELEGT).

### 4.9 Der Alarmweg

Der Meldeweg ist der bestehende, mit dem bestehenden Entprellungsmuster - nicht neu gebaut:

| Baustein | Ort | Funktion |
|---|---|---|
| `meldeBetreiberAlarm({store, config, audit, messaging, mailer, bucket, aktion, zeile, nowMs})` | `src/telephony/outage-report.js:111` | WARN + Audit + Mail + SMS in EINER Funktion |
| `meldeBetreiberNotiz({store, audit, bucket, aktion, zeile, nowMs})` | `outage-report.js:122` | kostenlose Stufe: WARN + Audit + Marker, kein Versand |
| `alarmErlaubt` / `meldeVollBefund` | `src/telephony/outbound-drift-watch.js:141` bzw. `:161` | Entprellung VOR dem Versand, Rueckfall auf die Notiz-Stufe - das Muster, das B faelschlich als Eigenschaft von `meldeBetreiberAlarm` annimmt |
| `claimOutageAlert(state, {code, nowMs, sent, channels})` | `state-ops.js:2645` | fuehrt den durablen Marker fort, entscheidet nichts |
| `openOutageAlert(state, code)` | `state-ops.js:2637` | die offene Zeile je Fehlerklasse |
| `makeAuditStore(runner).record({action, detail})` | `src/audit-store.js:3` | schreibt wirklich in `audit_log` |
| `runAlertChannelSelfTest` | `outage-report.js:282` | periodischer Kanal-Selbsttest, laeuft bereits |

B behauptet, `meldeBetreiberAlarm` bringe die Entprellung mit. Das stimmt nicht - die
Funktion sendet IMMER, die Reservierung liegt ausdruecklich beim Aufrufer
(`outage-report.js:105-110`, BELEGT). Der Aufrufer-seitige Riegel existiert aber bereits
fertig und getestet in `outbound-drift-watch.js` (`alarmErlaubt` + `meldeVollBefund`, mit
`config.billing.outageAlertDebounceMs` / `outageAlertRetryMs`, `config.js:1254/1261`); der
Kommentar dort nennt die gemessene Begruendung: 24 Sweeps bei unveraendertem Ausfall
ergaben ohne Entprellung 3 Mails und 9 Audit-Zeilen, im Stundentakt waeren es 24 Mails/Tag
(BELEGT, in dieser Session gelesen). **Die Kostenkette benutzt dieses Muster, sie erfindet
es nicht neu.**

Drei Alarmklassen, jede mit eigenem `code` und damit eigener Entprellung:

1. `kosten:deckung-unter-schwelle:<traeger>` - Deckungsquote JE TRAEGER unter
   `COST_TRUING_MIN_COVERAGE_PERCENT` (Default 80, `config.js:1084`). Je Traeger und nicht
   global, weil die heutige globale 0-%-Quote 11 Tage korrekt und trotzdem folgenlos war -
   erst "WELCHER Traeger fehlt" ist eine Information, mit der jemand handeln kann.
2. `kosten:erfassung-tot:<traeger>` - der **Herzschlag**: es gab in den letzten
   `KOSTEN_HEARTBEAT_FENSTER_H` Stunden (Default 6) beendete Anrufe mit einem Profil, das
   diesen Traeger als Pflicht fuehrt, und es wurde KEIN EINZIGER Beleg dieses Traegers
   angelegt. Was ANGELEGT heisst, entscheidet die Zaehlweise in KV2-6(f) und nichts sonst:
   eine Zeile mit `reife=vorlaeufig` zaehlt als angelegt, eine Zeile im Zustand `erwartet`
   NIE - sie ist der Platzhalter, nicht der Beleg. Diese Klasse haengt an keiner
   Faelligkeit und erfuellt allein den Auftragspunkt "binnen Stunden".
3. `kosten:profil-fehlt` - ein Anruf ist an einer Engine-Weiche vorbei entstanden. Immer
   melden; es bedeutet, dass ein Wahlpfad an der Registry vorbei existiert.

**Bekannte Schwaeche des Kanals, akzeptiert und benannt:** in `sendeUeberBeideKanaele`
(`outage-report.js:84`) gilt `const delivered = mailResult.delivered || !mailResult.hasTarget;`
- ist kein Mail-Ziel konfiguriert, wird der Marker als zugestellt fortgeschrieben (BELEGT,
in dieser Session gelesen). `PLATFORM_ALERT_MAIL_TO` und `PLATFORM_ALERT_SMS_TO` sind in
`.env.example` beide leer vorbelegt, und der Boot-Guard erzeugt bei fehlenden Zielen einen
Befund, keinen Startabbruch (`src/boot-guard.js:481-487`, BELEGT via
`angriff-premortem.md` 2.7). Diese Semantik ist bewusst so gebaut (es gibt nichts zu
WIEDERHOLEN, wenn es kein Ziel gibt) und wird von dieser Kette NICHT geaendert - das waere
eine Aenderung am Ausfall-Melder, nicht am Kostenpfad. Stattdessen: KV2-1 pinnt den
Alarm-Empfaenger als harte Vorbedingung ueber einen eigenen Boot-Guard-Befund, der zusaetzlich
durabel in `audit_log` landet, und die Sweep-Zeile nennt, ueber welche Kanaele tatsaechlich
zugestellt wurde. Ob in der Produktion ein Ziel gesetzt ist, ist NICHT GEMESSEN (haette einen
Blick in die Render-Umgebung erfordert, Secrets-Regel) - **das ist die erste Pruefung in
KV2-1.**

### 4.10 Die Verdrahtung, die heute fehlt

`makeCostTruing` wird in `src/server.js:114` erzeugt und bekommt `{store, config,
voiceControl, audit, messaging}` - **keinen `mailer`**. Der `mailer` entsteht erst bei
`server.js:134` (`selectMailer(config)`), `outageWatch` bei `:143` und `driftWatch` bei
`:151` bekommen ihn (BELEGT, in dieser Session gelesen; der Kommentar bei `:140` haelt
sogar fest, dass `outageWatch` genau deshalb nach dem Mailer verdrahtet wurde). Der
Kostenpfad muss denselben Weg gehen: Erzeugung nach `selectMailer`, `mailer` und ein
Audit-Sink hinein. Der Audit-Sink braucht einen pg-Runner (`makeAuditStore`,
`audit-store.js:3`, heute einzige Verdrahtung `src/wiring/web-login.js:176`); im
JSON-Backend gibt es keinen - dort ist der Sink ein fail-soft No-Op, und das ist eine
bewusste Festlegung, keine Auslassung.

---

## 5. Die Phasenkette

Zehn Phasen. Jede ist einzeln lieferbar, einzeln mergebar, und ihr Abnahmekriterium ist
**ohne echten Anruf** pruefbar (Fixtures + `node:test`; das Muster
`test/fixtures/elevenlabs-conversations.js` existiert bereits, 20 KB, BELEGT
`angriff-kritiker.md` Teil 1). Die Reihenfolge ist bindend; die Begruendung steht jeweils
dabei. Bis einschliesslich KV2-7 bewegt die Kette **keinen Cent** - das ist je Phase
Abnahmekriterium, nicht Absicht.

Zu den Safety-Gates: die Vorab-Gate-Kette (Verifikation als Outbound-Permit,
`OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, pro-Tenant-Kostendecke,
Max-Gespraechsdauer, Provider-Signatur) wird in KEINER Phase angefasst. Der EL-Zweig sitzt
HINTER der kompletten Kette (`api-calls.js:362`, kein zweiter Einstieg, BELEGT AUFTRAG B4).
Wo eine Phase einen Geld-Pfad beruehrt, ist unten ausdruecklich gesagt, wie sie das einhaelt.

---

### KV2-1 - Alarm-Naht scharf machen

**Ziel.** Der Kostenpfad bekommt einen Meldeweg, der wirklich ankommt: durabler
Audit-Eintrag, Mail, SMS, entprellt, mit einem Marker, der einen Neustart ueberlebt. Ohne
diese Phase scheitert jede folgende genauso still wie der Bestand.

**Betroffene Dateien.** `src/server.js` (Erzeugung von `makeCostTruing` hinter
`selectMailer`, `mailer` und Audit-Sink injizieren), `src/billing/cost-truing.js`
(`emitFinding` laeuft ueber das `meldeVollBefund`-Muster statt ueber `audit()`;
`sweepsBelowThreshold` ersetzt durch `openOutageAlert(...).firstSeenAt`),
`src/boot-guard.js` (Befund "Kosten-Alarm ohne Ziel"), `.env.example` (Doku der
Alarm-Ziele), Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Mit Stub-Audit-Store: ein Deckungsbefund erzeugt genau einen Eintrag mit einer eigenen
`action`, nachweisbar am Stub statt nur im Log.
(b) Mit Stub-Mailer und Stub-`messaging`: der erste Befund erzeugt genau eine Mail und genau
eine SMS; ein zweiter Sweep im Entprellfenster erzeugt KEINE weitere Mail, aber einen
Notiz-Eintrag (`_entprellt`), und `marker.lastSeenAt` ist fortgeschrieben.
(c) Simulierter Neustart (neue Store-Instanz, gleiche Daten): der Marker ist noch offen und
`firstSeenAt` unveraendert - der Zaehler wird nicht genullt.
(d) Ohne konfiguriertes Alarm-Ziel: der Boot erzeugt einen benannten Befund, und die
Sweep-Zeile nennt "kanaele=keine".
(e) Erste Handlung dieser Phase, vor dem Code: pruefen, ob in der Produktion ein Alarm-Ziel
gesetzt ist. Ist keines gesetzt, ist das Ergebnis der Phase eine Owner-Meldung, kein
gruener Test.

**Was diese Phase NICHT tut.** Sie aendert `sendeUeberBeideKanaele` nicht (das ist der
Ausfall-Melder, nicht der Kostenpfad, s. 4.9). Sie legt keine Kostenart an, sie bewegt keinen
Cent, sie fasst kein Gate an.

**Abhaengigkeit.** Keine. Erste Phase.

---

### KV2-2 - Kostenart-Katalog und Kostenprofil an der Engine-Weiche

**Ziel.** Die vollstaendige Kostenarten-Tabelle aus Abschnitt 3 wird eine eingefrorene,
beim Modul-Import validierte Datei, und jeder Anruf traegt ab jetzt ein set-once
`costProfile`, gesetzt an der Engine-Weiche. Nichts liest es produktiv, nichts wird
abgelehnt.

**Betroffene Dateien.** `src/billing/kostenarten.js` (neu, Muster
`src/billing/cost-ledger-map.js`: Pflichtfelder ohne Default, `assertRow`
(`cost-ledger-map.js:32-41`), Validierungsschleife beim Import (`:143`); dort liegt neben
dem Kostenart-Katalog auch die Profil-Registry, und JEDES Profil-Traeger-Paar traegt das
Pflichtfeld `einsammler` - s. Kriterium (i)),
`src/routes/api-calls.js` (Profil in jedem der drei Weichen-Zweige ab `:362`),
`src/routes/voice.js` (BEIDE Inbound-Zweige ab `:324` - NICHT die Erzeugungszeile `:320`,
s. 4.3), `src/store/state-ops.js` + `src/store/json.js` +
`src/store/pg.js` + `src/db/schema.sql` (Feld `cost_profile`, set-once),
`src/boot-guard.js` (der Riegel gegen den Realtime-Flip, Kriterium (h) - eine Zeile in
`latentCostPathFindings`, `:708` ff., keine neue Datei und keine eigene Phase), Tests.

Profile:

| Profil | Pflicht-Traeger | gesetzt in |
|---|---|---|
| `el_convai_sip` | `elevenlabs_convai`, `telnyx_sip` | EL-Zweig, `api-calls.js:362` ff. |
| `telnyx_assistant` | `telnyx_call_records` | Telnyx-Assistant-Zweig |
| `telnyx_budget` | `telnyx_call_records` (*) | TeXML-Zweig, `api-calls.js:394` ff. |
| `telnyx_inbound_budget` | `telnyx_call_records` | Inbound-Budget-Zweig, der `else`-Weg hinter `voice.js:324` |
| `telnyx_inbound_realtime` | `telnyx_call_records` + `openai_realtime` (**) | Inbound-Realtime-Zweig, `voice.js:324` ff. |

(*) `telnyx_budget` deckt heute BEIDE Outbound-Engines ab, weil `api-calls.js` dort nicht
auf die Engine verzweigt (die Weiche liegt im Webhook, `voice.js:476`). Das ist die
bekannte, benannte Restluecke dieser Phase - Owner-Entscheidung 10 (Abschnitt 7), die auf
ihrem Default laeuft. Solange der Default gilt, gilt die Traegerliste
`telnyx_call_records`, und der Plan behauptet NICHT, dass sie unter `VOICE_ENGINE=realtime`
vollstaendig waere. Ausloesen kann sie unter Owner-Entscheidung 13 (`fatal`, entschieden am
2026-08-30) allerdings niemand: mit `VOICE_ENGINE=realtime` startet der Prozess nicht.

(**) `openai_realtime` ist in diesem Profil ein katalogisierter Traeger OHNE Belegpflicht -
das ist seit dem 2026-08-30 keine Default-Annahme mehr, sondern die getroffene
Owner-Entscheidung 9 (OpenAI Realtime wird bis auf Weiteres nicht verwendet, s. 3.2 unter
der Tabelle und Abschnitt 7). Das Profil existiert und wird gesetzt, `openai_realtime` steht
in seiner Liste als `nicht_belegpflichtig`, es wird kein Beleg erwartet und kein Alarm
erzeugt. Der Phasenbericht vermerkt das als ENTSCHIEDEN, nicht als Default. Der Preis dieser
Entscheidung - ein einschaltbarer Schalter ohne Kostenpfad - wird nicht hingenommen, sondern
durch den Boot-Riegel (h) abgesichert.

(***) `telnyx_call_records` ist Pflicht-Traeger von VIER dieser fuenf Profile. Sein
Belegeinsammler entsteht in KV2-5(g) - aus dem `measured`-Ergebnis, das `trueOneCall` heute
schon bildet, ohne zusaetzlichen Anbieter-Abruf. Diese Phase hier setzt nur das Profil; sie
sammelt nichts. Die Zuordnung ist aber der Grund, warum der Einsammler ueberhaupt gebaut
werden muss: ohne ihn feuerte ab KV2-6 der Herzschlag `kosten:erfassung-tot:telnyx_call_records`
dauerhaft, und ab KV2-8 waere `dataComplete` fuer JEDEN Telnyx-Engine-Anruf falsch (4.5,
Owner-Entscheidung 11).

Die Aufteilung des frueheren Profils `telnyx_inbound` in zwei ist keine Vorratshaltung:
`VOICE_ENGINE` steht live auf `budget` (BELEGT `render.yaml:651-652`), ein einziger Env-Wert
kippt jeden Inbound-Anruf auf den Realtime-Traeger. Aus demselben Grund ist
`telnyx_inbound_budget` das Legacy-Profil fuer Altzeilen (4.6): jede Inbound-Altzeile ist
unter `budget` entstanden.

**Abnahmekriterium (ohne echten Anruf).**
(a) Eine Katalogzeile ohne `waehrung` / `pflicht` / `quelle` / `preisquelle` reisst den
Modul-Import ab (Bauzeit-Fehler, kein Testlauf-Fehler).
(b) Ein unbekannter Profilwert am Store-Mutator wirft; ein FEHLENDES Profil wirft NICHT,
sondern erzeugt eine WARN-Zeile - Regressionstest: ein Anruf entsteht auch ohne Profil.
(c) Inventar-Test ueber die WEICHEN-ZWEIGE: ein node:test faehrt einen Anruf ueber jeden der
FUENF Zweige und prueft, dass `costProfile` gesetzt ist und in der Registry steht. Die fuenf:
EL (`api-calls.js:362`), Telnyx-Assistant, TeXML-Outbound (`api-calls.js:394` ff.),
Inbound-Realtime (`voice.js:324`) und Inbound-Budget (der `else`-Weg dahinter). Der
Inbound-Teil faehrt BEIDE Stellungen von `config.voice.voiceEngine` (`budget` und
`realtime`) und erwartet ZWEI VERSCHIEDENE Profile - ein einziges Inbound-Profil laesst
diesen Test fallen. Damit deckt der Test die Stelle ab, an der ein Flag-Flip sonst still
bliebe (4.3, 6.4).
**Abgrenzung, damit (c) nicht mehr verspricht, als er haelt:** den OUTBOUND-TeXML-Zweig
faehrt dieser Test heute nur in EINER Stellung von `VOICE_ENGINE`. Der Grund ist kein
Testversaeumnis, sondern der Code: `api-calls.js` verzweigt im TeXML-Fall nicht auf die
Engine (`else`-Zweig ab `:394`, einziger Engine-Unterschied ist der Timer-Guard `:409`), die
Weiche faellt erst im Webhook (`voice.js:476`) - es existiert also gar kein zweites
Outbound-Profil, gegen das der Test pruefen koennte. Das ist Owner-Entscheidung 10, die am
2026-08-30 nicht ausdruecklich entschieden wurde und auf ihrem Default laeuft
(`telnyx_budget` unveraendert). Solange der Default gilt, deckt (c) den Flag-Flip fuer
INBOUND ab und fuer OUTBOUND NICHT, und dieser Plan behauptet das Gegenteil nicht. Wird 10
spaeter auf (a) gedreht, bekommt der Test einen sechsten Zweig und faehrt auch Outbound in
beiden Stellungen; bis dahin steht die Luecke hier geschrieben, statt unter einem gruenen
Test zu verschwinden. Wie schwer sie wiegt, haengt an Owner-Entscheidung 13 - und die ist am
2026-08-30 auf `fatal` ENTSCHIEDEN: unter `VOICE_ENGINE=realtime` startet der Prozess nicht,
also ist die Luecke unerreichbar. Der ausgeschriebene Preis in Punkt 13 gilt nur noch fuer
den Fall, dass jemand 13 spaeter auf (b) dreht.
(d) Der Katalog enthaelt alle **17** Zeilen aus Abschnitt 3, inklusive der bewusst nicht
umgelegten und der strukturell nicht umlegbaren - Test auf die Zeilenmenge (17), damit eine
spaetere Loeschung auffaellt. Die 17 schliesst `openai_realtime` (#14) ein, obwohl
Owner-Entscheidung 9 am 2026-08-30 auf "nicht bauen" gefallen ist: katalogisiert wird der
Traeger genau deshalb, weil der Schalter erreichbar bleibt. Sie schliesst ebenso
`telnyx_inference` (#15) ein, den siebten Telnyx-Belegtyp, der strukturell keinem Anruf
zuzuordnen ist (3.3), und `mail_zusammenfassung` (#16), die Zusammenfassungs-Mail je
beendetem Anruf, die heute weder gebucht noch bepreist ist (3.2), und `workos_auth` (#17),
die Konto-Rechnung des Identitaets-Anbieters WorkOS - eine reale, tenant-zuordenbare
Anbieter-Ausgabe ohne Anruf-Dimension, strukturell die Klasse von #10 und #12 (3.3). Die Zahl
17 wird an genau EINER Stelle im Test gepinnt; wer eine Zeile ergaenzt, zieht sie hier mit.
**Die gepinnte Zahl ist ein Loeschschutz, kein Vollstaendigkeitsbeweis.** Sie friert die
Menge ein, die Abschnitt 3 heute kennt; eine noch nicht bemerkte Kostenart kann sie nicht
finden, sondern nur festfrieren. Genau das ist an dieser Stelle einmal passiert: die Zahl
stand auf 15, waehrend die Zusammenfassungs-Mail fehlte. Der Schutz gegen diesen Fehler ist
deshalb nicht die Zahl, sondern die Regel aus 6.4 - jede Anbieter-Ausgabe bekommt eine
Katalogzeile, bevor sie live geht.
(e) `usage.costCents` und `usage_event` sind vor und nach jedem Test byte-identisch.
(f) Messaufgabe dieser Phase, lesend, ohne Testanruf: `GET /v1/user/subscription` gegen
ElevenLabs und die Frage, ob `<Play>`-Zeichen (Kostenart #7) und ConvAI aus DEMSELBEN
Kontingent gehen. Ergebnis wandert als `preisquelle` in die Katalogzeile - entweder als
ableitbarer Satz oder als gemessene Begruendung, warum es keinen gibt. Eine Begruendung
"kein `grep`-Treffer" ist als Ergebnis unzulaessig.
**Zweite Messaufgabe derselben Bauart, seit der Aufnahme der Katalogzeile #16:** die
Preisquelle der Zusammenfassungs-Mail (`mail_zusammenfassung`) - der Tarif des aktiven
Kanals (Brevo-Transactional bzw. Postfachtarif im SMTP-Fall) und die Konto-Waehrung.
Ebenfalls lesend, ohne Versand und ohne Testanruf. Das Ergebnis wandert als
`preisquelle`/`waehrung` in Zeile #16; "kein Preis-Parameter im Repo" ist als Ergebnis
genauso unzulaessig wie "kein `grep`-Treffer" (Regel aus 3.2 Zeile #7). Faellt
Owner-Entscheidung 15 auf "nur katalogisieren", bleibt es bei dieser dokumentarischen
Messung; faellt sie auf "bauen", ist der gemessene Satz die Eingabe des Einsammlers, der
dann als eigene Phase nach KV2-10 entsteht.
**Dritte Messaufgabe derselben Bauart, seit der Aufnahme der Katalogzeile #17:** die
Preisquelle der WorkOS-Konto-Rechnung (`workos_auth`) - Waehrung und Satz je aktivem Nutzer
aus der Anbieter-Preisliste. Lesend, ohne Schreibzugriff, ohne Anruf und ohne
Management-Aufruf (der Loeschpfad `src/workos-management.js` wird NICHT angefasst). Das
Ergebnis wandert als `preisquelle`/`waehrung` in Zeile #17; "kein Preis-Parameter im Repo"
ist auch hier als Ergebnis unzulaessig (Regel aus 3.2 Zeile #7). Ergibt die Recherche keinen
belastbaren Satz, ist das Ergebnis eine benannte offene Frage in Abschnitt 9, kein leeres
Feld. Ein Traeger wird daraus in KEINEM Fall - das ist bei #17 anders als bei #16 keine
offene Entscheidung, sondern die Festlegung aus 3.3 (die Gebuehr entsteht nicht im Anruf,
Abschnitt 8 Punkt 16).
Weitere Messaufgabe derselben Phase, rein dokumentarisch und ohne Anruf: die Preisquelle und
die Waehrung der Katalogzeile #14 (`openai_realtime`) aus der OpenAI-Preisliste. Sie bleibt
Pflicht, OBWOHL Owner-Entscheidung 9 auf "nicht bauen" gefallen ist - `preisquelle` und
`waehrung` sind Pflichtfelder jeder Katalogzeile (a), und eine Zeile ohne sie reisst den
Import ab. Die zweite, frueher hier mitgefuehrte Frage - ob das `response.done`-Ereignis der
Realtime-Sitzung einen Verbrauchs-/Kostenblock fuehrt (`bridge.js:383` liest heute keinen;
`grep` auf `usage` in `bridge.js`: 0 Treffer) - ist durch dieselbe Entscheidung GEPARKT: sie
waere nur fuer einen Einsammler noetig, der nicht gebaut wird. Sie bleibt als offener Punkt
in Abschnitt 9 stehen und ist erst zu beantworten, wenn die Engine je wieder aktiviert
werden soll. Ein Testanruf ist fuer die Preisrecherche NICHT zulaessig und auch nicht
noetig - sie steht in der Anbieter-Doku. Ergibt die Recherche keinen belastbaren Satz, ist
das Ergebnis eine benannte offene Frage in Abschnitt 9, kein leeres Feld.
(g) **Die `record_type`-Menge der Katalogzeile #3 wird gegen den Export gepinnt, nicht
abgeschrieben.** Ein node:test vergleicht die im Katalog gefuehrte Typmenge des Traegers
`telnyx_call_records` mit `ASSIGNABLE_COST_RECORD_TYPES` (`voice.js:178`, importiert - keine
Kopie) auf Mengengleichheit. Kommt ein neuer Telnyx-Belegtyp dazu (oder faellt einer aus der
Deny-Liste heraus), wird dieser Test ROT, statt dass der Katalog still unvollstaendig wird -
genau der Fall, der die frueheren zwei statt sechs Typen in Zeile #3 erzeugt hat. Gegenprobe
im selben Test, damit er nicht tautologisch gruen ist: die Menge ist nicht leer, und sie
enthaelt `inference` NICHT (der gehoert zu Katalogzeile #15, nicht zu #3).
(h) **Der Riegel gegen den Realtime-Flip** (Owner-Entscheidung 9 vom 2026-08-30, Haerte
ebenfalls entschieden am 2026-08-30: Owner-Entscheidung 13 auf `fatal`). Eine Zeile in `latentCostPathFindings`
(`boot-guard.js:708` ff., dieselbe reine, arg-injizierte Entscheidungsfunktion wie der
bestehende Befund `realtime_no_midcall_budget`): ist `VOICE_ENGINE=realtime` gewaehlt,
WAEHREND der Traeger `openai_realtime` im Katalog ohne Einsammler steht, entsteht ein
Befund. Haerte, entschieden (Punkt 13, nicht mehr Default): `fatal: true` - der Prozess
startet nicht, dasselbe Muster wie
`REQUIRED_TYPES_EMPTY` (`:657-664`), wo ein Dienst, der ohne Vollstaendigkeitsbegriff Geld
erstattet, ebenfalls nicht starten darf. Der bestehende Befund `realtime_no_midcall_budget`
bleibt daneben stehen und wird NICHT umgewidmet: er benennt die fehlende Mid-Call-BREMSE,
dieser hier die fehlende BUCHUNG - zwei Sachverhalte, zwei Labels (4.8, `defaults.js:180-184`).
Test: `VOICE_ENGINE=budget` erzeugt den Befund NICHT; `VOICE_ENGINE=realtime` erzeugt genau
einen, mit eigenem Code; wird fuer `openai_realtime` je ein Einsammler eingetragen,
verschwindet er wieder - der Riegel haengt am Kostenpfad, nicht am Schaltern-Namen.

(i) **Jeder Pflicht-Traeger jedes Profils hat einen benannten Einsammler - oder ist
ausdruecklich nicht belegpflichtig.** Das ist die Regel aus 4.5, hier zum ersten Mal als
Test; (c) und KV2-6(f) leisten sie nachweislich NICHT (Begruendung am Wortlaut beider, s.
4.5). Umsetzung: jedes Profil-Traeger-Paar der Registry traegt ein Pflichtfeld `einsammler`,
dessen Wert entweder eine Phasenkennung dieser Kette (`KV2-4` fuer `elevenlabs_convai`,
`KV2-5` fuer `telnyx_sip`, `KV2-5g` fuer `telnyx_call_records`) oder der Wert
`nicht_belegpflichtig` ist - letzterer heute genau einmal vergeben: `openai_realtime` im
Profil `telnyx_inbound_realtime` (Owner-Entscheidung 9). Ein fehlendes, leeres oder freies
drittes Feld reisst wie in (a) den Modul-Import ab, also zur Bauzeit und nicht zur
Testlaufzeit. Der node:test laeuft ueber ALLE Profile und ALLE ihre Traeger und wird rot,
sobald ein Paar keinen der beiden Zustaende traegt.
**Gegenprobe im selben Test, sonst ist er tautologisch gruen:** ein kuenstlich in eine KOPIE
der Registry eingefuegtes Profil, dessen Traeger weder Phasenkennung noch
`nicht_belegpflichtig` traegt, faellt nachweislich durch (erwarteter Fehler, benannt); die
Aenderung wirkt nur auf die Kopie, die echte Registry bleibt unberuehrt.
**Abgrenzung, damit (i) nicht mehr verspricht, als er haelt:** der Test prueft, dass ein
Einsammler BENANNT ist, nicht dass er existiert und laeuft. Dass wirklich eingesammelt wird,
pinnen KV2-5(g) (die Zeile entsteht) und KV2-6(f) (der Herzschlag schweigt nur, weil sie
entsteht). Zwei Fragen, zwei Tests - sie duerfen nicht auf denselben gelegt werden.
**Preis, bewusst getragen:** der Katalog bekommt ein Pflichtfeld mehr, und wer eine Phase
umbenennt, zieht die Werte mit. Das ist gewollt: genau diese Umbenennung verloere die
Zuordnung sonst still.
Faellt Owner-Entscheidung 11 auf (b), aendert sich an (i) nichts, nur an einem Wert - dann
traegt `telnyx_call_records` in den vier Bestandsprofilen nicht `KV2-5g`, sondern die dann
zu vergebende Kennung des Bestandspfads. Der dritte Zustand bleibt in beiden Faellen rot.

**Was diese Phase NICHT tut.** Sie lehnt keinen Anruf ab (das ist die zentrale Korrektur
gegenueber Entwurf A, s. 4.3). Sie liest das Profil nirgends produktiv. Sie legt keine
Tabelle an. Sie bewegt keinen Cent. Sie baut KEINEN Beleg-Einsammler fuer
`openai_realtime` - der Traeger wird ausschliesslich katalogisiert (Abschnitt 8, Punkt 13;
Owner-Entscheidung 9, entschieden am 2026-08-30). Was sie sehr wohl tut und was nicht unter
diesen Vorbehalt faellt: den Boot-Riegel (h). Er ist keine Bauphase fuer den Traeger,
sondern die Sicherung dagegen, dass der Schalter ohne Kostenpfad angeht. Sie baut ebenso KEINEN
Beleg-Einsammler und keinen Buchungsweg fuer `mail_zusammenfassung` (#16): die
Zusammenfassungs-Mail wird in dieser Phase ausschliesslich katalogisiert und bepreist (f),
nicht erfasst (Abschnitt 8, Punkt 15; Owner-Entscheidung 15 - nicht ausdruecklich
entschieden, sie laeuft auf dem Default "nur katalogisieren"). Sie baut ebenso KEINEN
Einsammler und keinen Buchungsweg fuer `workos_auth` (#17): die WorkOS-Konto-Rechnung wird
katalogisiert und bepreist (f), nicht erfasst - und hier ohne offene Entscheidung, weil die
Gebuehr nicht im Anruf entsteht (3.3, Abschnitt 8 Punkt 16). `workos_auth` ist Pflicht-Traeger
KEINES Profils; an der Profil-Registry und an Kriterium (i) aendert die Zeile nichts. Sie aendert nichts
an der Outbound-Weiche und schliesst damit Owner-Entscheidung 10 nicht.

**Abhaengigkeit.** KV2-1 (damit die WARN-Zeile "Profil fehlt" einen Weg nach draussen hat).
Owner-Vorbedingung: keine. Entscheidung 9 (Realtime-Traeger bauen oder katalogisieren) ist
am 2026-08-30 GETROFFEN: katalogisieren, plus Riegel (h) - kein Default mehr, sondern eine
Vorgabe. Ebenfalls GETROFFEN ist Entscheidung 13 (Haerte des Riegels (h)): `fatal` - auch
das ist Vorgabe, kein Default mehr. Auf ihrem DEFAULT laufen an dieser Phase Entscheidung 10
(Profil-Setzstelle im Outbound-TeXML-Zweig, Default: `telnyx_budget` unveraendert lassen) und
Entscheidung 12 (Traegername `telnyx_call_records` gegen Aufspaltung in Traeger je Belegtyp,
Default: umbenannt lassen, wie in diesem Dokument durchgezogen); beide sind am 2026-08-30
NICHT ausdruecklich entschieden worden, und der Phasenbericht fuehrt sie als Default.
**Die frueher hier stehende Kopplung zwischen 13 und 10 ist erledigt:** sie galt nur fuer die
verworfene Variante 13(b) (laut statt fatal), die die Outbound-Restluecke dieser Phase erst
erreichbar gemacht haette. Unter der getroffenen Entscheidung 13(a) besteht sie nicht - die
Restluecke ist unerreichbar, weil der Prozess unter `VOICE_ENGINE=realtime` nicht startet.
Wer 13 je auf (b) dreht, muss 10 im selben Zug auf (a) mitziehen; der Preis ist in Punkt 13
ausgeschrieben. Auf ihrem Default laeuft an dieser Phase ausserdem Entscheidung 15
(`mail_zusammenfassung` nur katalogisieren oder einen Traeger bauen, Default: nur
katalogisieren, wie #6 - die Katalogzeile und die Preismessung (f) entstehen in beiden
Faellen). Bleibt eine Antwort aus, laeuft die Phase mit dem jeweiligen
Default, und der Phasenbericht vermerkt ihn ausdruecklich als Default, nicht als getroffene
Entscheidung.

---

### KV2-3 - Das Kosten-Buch

**Ziel.** Eine Tabelle `call_cost_evidence` mit einer Zeile je `(call_id, traeger)`,
append-only nach vorne, plus zwei Store-Operationen. Nichts liest sie.

**Betroffene Dateien.** `src/db/schema.sql` (DDL laeuft beim Boot automatisch),
`src/store/state-ops.js` (`recordCallCostEvidence`, `callCostEvidence(callId)`),
`src/store/json.js`, `src/store/pg.js`, Tests.

Spalten: `id`, `tenant_id` (FK + RLS), `call_id`, `traeger`, `reife`
(`erwartet | vorlaeufig | belegt | beleg_strukturell_unbeschaffbar`; zum entfallenen
fuenften Wert s. den Absatz "Zum Wertebereich von `reife`" unten),
`betrag_mikro_cents BIGINT NULL`, `waehrung`, `quelle`, `beleg_ref`,
`versuche INT NOT NULL DEFAULT 0`, `gemessen_at`, `abstand_zum_gespraechsende_s`,
`detail JSONB NULL`, Unique-Index `(call_id, traeger)`.

`detail` traegt AUSSCHLIESSLICH Preis- und Mengenfelder - `llm_price`, `platform_price`,
`analysis.price`, `billed_sec`/`call_duration_secs`, `rate`, `tier` -, KEIN Transkript,
KEINE Rufnummer, KEIN Anbieter-Rohbody. `beleg_ref` traegt AUSSCHLIESSLICH die
Anbieter-Belegkennung (`conv_...`/`otb_...`), sonst nichts. Dieselbe Regel gilt an jeder
vergleichbaren Stelle im Bestand (`audit-store.js:1-2`: "detail NIEMALS mit
Secrets/Transkript-Inhalt fuellen"; `schema.sql:796`: "PII-frei, nie ein Ziel") - diese neue
Tabelle ist keine Ausnahme davon.

**Zum Wertebereich von `reife` - warum er vier Werte fuehrt und nicht fuenf.** Eine fruehere
Fassung dieses Plans fuehrte hier zusaetzlich `beleg_ausgeblieben`. Dieser Wert hat in
diesem Dokument KEINEN Schreiber: keine Phase setzt ihn, keine Zeile der Matrix 4.6 nennt
ihn, und er entspricht keinem Endzustand aus KV2-7. Im Code existiert er ebenfalls nicht
(BELEGT: `grep` ueber `src/` und `test/` liefert 0 Treffer fuer `beleg_ausgeblieben` -
ebenso fuer `call_cost_evidence` und `beleg_strukturell_unbeschaffbar`, die Tabelle ist
noch nicht gebaut; Positivkontrolle `costTruedAt` trifft in drei Dateien, die Suche sucht
also wirklich). Ein Enum-Wert ohne Schreiber ist toter Code im Schema, und ein spaeterer
Leser muesste seine Bedeutung erfinden. **Default dieses Plans: er entfaellt ersatzlos.**
Der Gegenweg - ihn behalten und ihm einen benannten Schreiber geben, etwa fuer "Frist
abgelaufen, Anbieter hat nie geliefert" - ist Owner-Entscheidung 16 (Abschnitt 7); die
Fachlage ist entscheidbar, die Kosten-/Nutzen-Abwaegung nicht rein technisch. Faellt 16 auf
(b), waechst die Spaltenliste um genau diesen Wert und (b) unten gilt fuer ihn wortgleich;
sonst aendert sich an dieser Phase nichts.
`beleg_strukturell_unbeschaffbar` bleibt in JEDEM Fall: er hat einen Schreiber
(KV2-4(c), der Abbruchweg) und einen Eintrag in der Matrix 4.6.
**Was an dieser Stelle NICHT geklaert ist, mit Grund:** ob KV2-4(c) ("markiert sie
zusaetzlich als strukturell nicht nachreifbar") diesen `reife`-Wert setzt oder ein eigenes
Feld, ist im Plan nicht ausgeschrieben - KV2-9(d) beschreibt fuer den 404-Fall ausdruecklich
"Zeile bleibt `vorlaeufig`, Endzustand `beleg_strukturell_unbeschaffbar`", also den
gleichnamigen Zustand AM ANRUF (KV2-7). Der Name lebt damit auf zwei Ebenen, und die
duerfen nicht zusammengelegt werden. Die Frage klaert KV2-4, die den Abbruchweg baut; bis
dahin pinnt (b) ausschliesslich die Beleg-Ebene.

`betrag_mikro_cents` ist NULLABLE und im Zustand `erwartet` immer `NULL`, nie `0` - dieselbe
Regel wie `usage_event.cost_micro_cents` (`schema.sql:855-862`, "eine 0 waere eine erfundene
Messung", BELEGT).

**Abnahmekriterium (ohne echten Anruf).**
(a) Idempotenz: zweiter Aufruf mit derselben `(callId, traeger)` legt keine zweite Zeile an.
(b) **Zustandsordnung der Reife - Monotonie UND Terminierung, beides gepinnt.** Die
Fortschritts-Ordnung ist `erwartet -> vorlaeufig -> belegt`; jeder Schritt entlang dieser
Ordnung ist erlaubt (das Ueberspringen von `vorlaeufig` eingeschlossen), jeder Rueckschritt
darin wirft. `beleg_strukturell_unbeschaffbar` steht NICHT in dieser Ordnung, sondern
daneben: er ist ein TERMINALER Zustand, aus jedem der drei Vorzustaende erreichbar, und aus
ihm fuehrt kein Uebergang mehr heraus. Ein Uebergang IN einen terminalen Zustand ist
deshalb ausdruecklich kein Rueckschritt und wirft nicht; jeder Uebergang HERAUS wirft, auch
der nach `belegt`. Das erneute Setzen desselben terminalen Zustands ist ein No-Op und wirft
nicht - dieselbe Idempotenz-Richtung wie (a), damit ein wiederholter Sweep-Lauf nicht
scheitert. Faellt Owner-Entscheidung 16 auf (b), gilt fuer `beleg_ausgeblieben` wortgleich
dasselbe.
Testfaelle, beide Richtungen: (i) `erwartet -> beleg_strukturell_unbeschaffbar`,
`vorlaeufig -> beleg_strukturell_unbeschaffbar` und `belegt ->
beleg_strukturell_unbeschaffbar` schreiben und werfen nicht; (ii) aus
`beleg_strukturell_unbeschaffbar` heraus werfen `-> erwartet`, `-> vorlaeufig` und
`-> belegt`; (iii) `beleg_strukturell_unbeschaffbar -> beleg_strukturell_unbeschaffbar`
aendert nichts und wirft nicht; (iv) die Bestands-Rueckschritte `belegt -> vorlaeufig`,
`belegt -> erwartet`, `vorlaeufig -> erwartet` werfen.
(c) RLS: ein Fremd-Tenant sieht 0 Zeilen (Muster der bestehenden RLS-Tests).
(d) Shape-Parity: `json.js` und `pg.js` liefern dasselbe Objekt.
(e) Eine Summenfunktion ueber die Zeilen zaehlt ausschliesslich `vorlaeufig` und `belegt`;
ein `erwartet`-Posten traegt NICHTS bei - eigener Testfall, damit ein spaeterer
Platzhalter-Betrag 0 nicht unbemerkt mitrechnet (`angriff-cleancode.md` Befund 6).
(f) Allowlist-Test: eine Fixture mit dem VOLLSTAENDIGEN EL-Antwortobjekt (Transkript,
Rufnummer, Analysefelder eingeschlossen) erzeugt eine Zeile, deren `detail`-Schluesselmenge
exakt der oben genannten Allowlist entspricht - kein zusaetzlicher Schluessel, kein
Transkript- oder Rufnummernfeld rutscht durch.

**Was diese Phase NICHT tut.** Kein Schreiber ausserhalb der Tests, kein Leser, keine
Buchung.

**Abhaengigkeit.** KV2-2 (der `traeger`-Wert wird gegen den Katalog validiert).
Owner-Vorbedingung: Entscheidung 1 (Kosten-Buch oder Erloes-Buch, Abschnitt 7) ist am
2026-08-30 GETROFFEN - eigenes Kosten-Buch `call_cost_evidence`, `usage_event` bleibt das
Erloes-Buch; das ist Vorgabe, kein Default. Entscheidung 16 (`beleg_ausgeblieben` streichen
oder ihm einen Schreiber geben) ist NICHT ausdruecklich entschieden und laeuft auf ihrem
Default: der Wert entfaellt, der Wertebereich hat vier Auspraegungen - im Phasenbericht
ausdruecklich als Default vermerkt, nicht als getroffene Entscheidung.
Entscheidung 16 beruehrt ausschliesslich das DDL und den Wertebereich dieser Phase; keine
spaetere Phase liest den Wert, also blockiert sie die Kette nicht.

---

### KV2-4 - Der ElevenLabs-Beleg, synchron und vorlaeufig

**Ziel.** `persistProviderResult` liest `metadata.cost_fiat` und legt eine Belegzeile
`traeger=elevenlabs_convai`, `reife=vorlaeufig` an - ohne zusaetzliches Netz-IO, weil die
Antwort dort bereits vollstaendig im Speicher liegt. Zusaetzlich wird die Zeile
`traeger=telnyx_sip` als `erwartet` angelegt.

**Betroffene Dateien.** `src/elevenlabs/outbound.js` (neuer Aufruf direkt neben
`store.recordSipCallId`, `:1312`; damit sind BEIDE Aufrufer bedient - regulaeres Ende
`:1332` und Abbruch `:1452`), Fixtures, Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Fixture aus den 8 gemessenen Anrufen: genau eine `vorlaeufig`-Zeile mit exaktem
Mikro-Cent-Integer und `waehrung="USD"`; `charging.llm_price` / `charging.platform_price` /
`charging.analysis.price` landen im `detail`, nicht als eigene Buchungsposten (eine Zahl,
ein Rundungspfad).
(b) Fehlt `cost_fiat`, ist es kein Float, ist es negativ, oder ist es `0` bei
`call_duration_secs > 0` -> es entsteht KEINE Zeile (nicht eine 0-Zeile) und eine
WARN-Zeile. `0` bei `call_duration_secs === 0` -> gueltige Zeile mit Betrag 0.
(c) Der Abbruchweg legt dieselbe Zeile an und markiert sie zusaetzlich als strukturell
nicht nachreifbar (der `endConversation`-DELETE, `outbound.js:1452-1460`).
(d) Zweiter Aufruf mit derselben callId legt keine zweite Zeile an.
(e) `usage.costCents`, `usage_event` und `usage.costCorrectionMicroCentsRem` sind vor und
nach dem Aufruf byte-identisch.

**Was diese Phase NICHT tut.** Keine Buchung, kein Gate-Zugriff, keine Erstattung, kein
zweiter Abruf beim Anbieter.

**Abhaengigkeit.** KV2-3.

---

### KV2-5 - Der Telnyx-SIP-Beleg, plus die Messung der Pflicht-Typmenge

**Ziel.** Der Sweep findet die SIP-Belege der EL-Anrufe und legt sie als
`traeger=telnyx_sip` ab - und fuer die Bestandsprofile legt derselbe Sweep im selben Zug die
Zeile `traeger=telnyx_call_records` an, damit der Traeger von vier der fuenf Profile ueberhaupt
je einen Beleg bekommt (g). Und er misst, welche `record_type`-Werte der EL-Weg ueberhaupt
liefert - denn `COST_TRUING_REQUIRED_RECORD_TYPES` steht live auf
`sip-trunking,call-control`, und ob der EL-Weg je einen `call-control`-Beleg fuehrt, ist
UNGEMESSEN (BELEGT, `befund-telnyx.md`, Schlussabschnitt). Bleibt die Pflichtmenge global
und liefert der EL-Weg nie `call-control`, ist `dataComplete` fuer EL-Anrufe NIE wahr, es
gaebe nie eine Erstattung, und die Deckung laege dauerhaft unter der Schwelle.

**Betroffene Dateien.** `src/billing/cost-truing.js` (`providerLegIdOf`, `:138`, lernt
`call.sipCallId` als dritte Alternative), `src/telephony/adapters/telnyx/voice.js` (zweites
Ankerfeld `sip_call_id` als direkter Primaerschluessel-Vergleich fuer `sip-trunking`-Records
neben `ANCHOR_ID_FIELD`, `:140`, Zuordnung `:903`), `src/billing/kostenarten.js`
(Pflicht-Typmenge JE PROFIL statt global - fuer die Bestandsprofile bleibt diese Menge der
heutige Env-Wert, kein Literal im Katalog, s. Abnahmekriterium (f); ausserdem die
sipCallId-bewusste Legacy-Zuordnung fuer profillose Altzeilen, s. (h) - sie gehoert in DIESE
Phase, weil DIESE Phase mit dem `sipCallId`-Join die Gefahr ueberhaupt erst erzeugt), `src/config.js` /
`.env.example`, Tests. Zusaetzlich in `cost-truing.js` der zweite Belegschreiber neben
`bookCorrectionFor`: die `telnyx_call_records`-Zeile aus `measured` (`:665`), s. (g).

Der Join ist strikte String-Gleichheit `raw.sip_call_id === call.sipCallId` - kein Fuzzy,
keine Session-Heuristik. Belegt ausreichend: 12 von 12 EL-Anrufen haben genau einen Treffer,
alle 13 EL-Belege im Zeitraum tragen `sip_call_id`, keiner `call_control_id`
(`befund-telnyx.md` O1). Das ist strukturell sicherer als der bestehende zweistufige
Session-Mechanismus, der im Bestandskommentar selbst als "nie unter Parallelverkehr
gemessen" markiert ist.

**Abnahmekriterium (ohne echten Anruf).**
(a) **Der B6-Test, und er ist der wichtigste Test der ganzen Kette:** ein Anruf mit Profil
`el_convai_sip`, `estimatedCostCents = 30`, ausschliesslich Telnyx-Beleg (4,01 US-ct) und
KEINEM EL-Beleg bewegt **null Cent** auf der Gate-Achse; `applyCostCorrectionCents` wurde
nachweislich nicht aufgerufen (Spion); `costCorrectionMicroCentsRem` ist bit-gleich. Der
Test wird rot, sobald jemand die Kette hier abkuerzt.
(b) Ein Telnyx-Engine-Anruf (mit `callControlId`) verhaelt sich auf der GATE-ACHSE exakt wie
vorher - derselbe Aufruf von `applyCostCorrectionCents` mit denselben Argumenten (Spion),
derselbe Herkunftswert, derselbe `costTruedAt`-Zeitpunkt; Regressionsschutz fuer die 56
heute funktionierenden Faelle. Was hinzukommt, ist ausschliesslich die Belegzeile aus (g):
sie wird geschrieben und in dieser Phase von niemandem gelesen. "Exakt wie vorher" heisst
also: kein Cent, kein Zustandsfeld am Anruf, kein Zaehler aendert sich - nicht: keine Zeile
im Kosten-Buch.
(c) Fixture mit dem gemessenen Roh-Record (`billed_sec=60`, `call_sec=35`, `cost=0.0401`,
`rate=0.0401`, `currency=USD`, `sip_call_id=otb_...`): genau eine `belegt`-Zeile mit
4,01 US-ct. Ein Record mit `currency != USD` wird fail-closed verworfen, nicht umgerechnet.
(d) **Messung, die in dieser Phase stattfinden MUSS und Teil der Abnahme ist** (nicht nur
eine Bitte, wie in beiden Entwuerfen): ein lesender Abruf
`GET /v2/detail_records?filter[record_type]=call-control` ueber den EL-Zeitraum und die
Feststellung, ob fuer die 12 bekannten `sip_call_id`-Werte Belege existieren. Ergebnis wird
als Pflicht-Typmenge des Profils `el_convai_sip` im Katalog eingetragen. Zusaetzlich: die
reale Latenz der `sip-trunking`-Belege (Abstand `started_at` zu erster Verfuegbarkeit),
weil genau diese Zahl darueber entscheidet, ob ein EL-Anruf je vollstaendig wird - bisher
ist nur ihre Existenz belegt, nicht ihre Latenz (`angriff-premortem.md` 6).
Dritter Punkt derselben Messung, weil er im selben lesenden Abruf mit abfaellt: ob
`record_type=inference` (Katalogzeile #15) auf unserem Konto ueberhaupt Betraege traegt. Der
Sweep holt diesen Typ nicht ab (`voice.js:656` laeuft ueber
`ASSIGNABLE_COST_RECORD_TYPES`), und ohne die Zahl bleibt eine Anbieter-Kostenart
unbeziffert, die per Konstruktion in keinem Buch landet. Das Ergebnis aendert an dieser Kette
NICHTS - es wird nur beziffert, nicht umgelegt - und wandert in Abschnitt 9 bzw. in die
`preisquelle` der Zeile #15.
**Scheitert der Abruf, ist das Ergebnis der Phase eine Owner-Meldung, kein gruener Test** -
dieselbe Regel wie in KV2-1(e) und KV2-2(f), hier ausdruecklich hingeschrieben statt
impliziert. Der Fall ist real und nicht hypothetisch: der Telnyx-Zugang ist im Vorlauf
dieses Plans mit HTTP 401 ausgefallen (BELEGT, `tasks/kostenv2/AUFTRAG.md:138`). Konkret
gilt dann: die Owner-Meldung nennt das Fehlerbild (Statuscode, Endpunkt, Zeitpunkt); die
Pflicht-Typmenge des Profils `el_convai_sip` bleibt UNGESETZT - kein geratener Wert, kein
Uebernehmen des Bestandswerts "weil er naheliegt"; die Latenz- und die
`inference`-Frage bleiben in Abschnitt 9 offen; und **KV2-8 bleibt blockiert.** Blockieren
ist hier die richtige Richtung: KV2-8 ist der Geld-Umschalter, und eine geratene
Pflichtmenge entscheidet dort ueber Erstattungen (die leere Menge ist allquantifiziert wahr,
s. Blocker-Befund 3/6 in Abschnitt 10). Die uebrigen Kriterien dieser Phase - (a), (b), (c),
(e), (f), (g), (h) - bleiben davon unberuehrt und werden normal abgenommen; die Phase ist
damit teil-erfuellt und ausdruecklich NICHT gruen. Fuer (h) gilt das ausdruecklich auch dann,
wenn (d) scheitert: der Riegel gegen eine Erstattung an den 12 EL-Altanrufen haengt NICHT an
der Antwort auf (d), sondern gerade daran, dass sie offen ist.
(e) Spion-Test: ein Fixture-Pool ausschliesslich mit `sip-trunking`-Records (keine
`text-to-speech`-Records) laesst `store.recordRelayTtsCharacters` ueber `bookTtsCharactersFor`
nachweislich UNGERUFEN. Traegt ein realer EL-Pool doch `text-to-speech`-Records, gehoert
dieses Ergebnis in die Messaufgabe KV2-5(d), nicht in eine Annahme.
(f) **Die Pflicht-Typmenge der Bestandsprofile veraendert sich durch die Umstellung NICHT.**
Fuer `telnyx_budget`, `telnyx_assistant` und `telnyx_inbound_budget` ist sie exakt der
heutige Live-Wert von `COST_TRUING_REQUIRED_RECORD_TYPES`, `sip-trunking,call-control`
(BELEGT, AUFTRAG O1 / `befund-telnyx.md`, Schluss von O1; `.env.example:573` ist leer, der
Wert kommt aus der Produktionsumgebung, gelesen ueber `csvEnv`, `config.js:1079`). Konkret:
die Umstellung macht die Menge nur ADRESSIERBAR je Profil; die drei Bestandsprofile lesen
weiterhin denselben Env-Wert, ein Literal im Katalog bekommt allein das neue Profil
`el_convai_sip` (aus der Messung (d)). `telnyx_inbound_realtime` bekommt KEINS: sein
zusaetzlicher Traeger `openai_realtime` ist seit Owner-Entscheidung 9 (2026-08-30)
`nicht_belegpflichtig` und geht gar nicht erst in eine Pflichtmenge ein; fuer seinen
Telnyx-Anteil gilt derselbe Env-Wert wie fuer die drei Bestandsprofile. So kann kein Deploy
die Menge der Bestandsprofile still verschieben, und der Boot-Waechter gegen die leere Menge
(`boot-guard.js:662`) bleibt wirksam.
**Ausdruecklich verboten ist die Ableitung der Menge aus Katalogzeile #3.** Deren
`record_type`-Angabe ist seit dem 2026-08-30 die aus `ASSIGNABLE_COST_RECORD_TYPES`
abgeleitete Menge ALLER sechs zuordenbaren Typen (`voice.js:178-180`); sie benennt die
betragstragenden Records, nicht das Vollstaendigkeits-Praedikat. Eine Ableitung setzte die
Pflichtmenge auf alle sechs Typen und machte `complete` in `classifyRecords`
(`cost-truing.js:328`) fuer JEDEN Bestandsanruf unwahr - `source` waere dauerhaft
`incomplete`, `refundProven` (`:452-457`) erstattete nie mehr, und die heute funktionierende
Erstattung (56 von 56, AUFTRAG B1) waere still tot. Auch die Gegenrichtung ist verboten und
war in der frueheren Fassung dieses Plans die naheliegende: solange Zeile #3 nur
`call-control` und `text-to-speech` nannte, verengte eine Ableitung die Menge auf
`call-control` und machte `complete` LEICHTER wahr - Erstattung fuer die 56 Bestandsanrufe
unter schwaecheren Bedingungen als heute. Beide Richtungen widersprechen (b) dieser Phase,
KV2-7(a) ("byte-identisch zu heute") und der Zusage aus Abschnitt 5, dass bis
einschliesslich KV2-7 kein Cent bewegt wird. Die Pflicht-Typmenge ist und bleibt ein
getrenntes Datum.
Test, zwei Richtungen (eine Richtung allein faengt nur den halben Fehler): ein
Fixture-Anruf des Profils `telnyx_budget` mit AUSSCHLIESSLICH `call-control`-Records ergibt
`source=incomplete` und KEINE Erstattung - genau wie heute; er wird rot, sobald jemand die
Menge verengt. Derselbe Fixture-Anruf mit genau der heutigen Live-Menge
(`sip-trunking` + `call-control`, `billedSecTotal > 0`) wird erstattet - er wird rot, sobald
jemand die Menge auf alle sechs zuordenbaren Typen ERWEITERT, also aus Katalogzeile #3
ableitet.
**Akzeptiertes Restrisiko, benannt:** eine Aenderung des Env-Werts bewegt weiterhin alle drei
Bestandsprofile gleichzeitig. Das ist das heutige Verhalten und wird hier bewusst nicht
verbessert - eine Aufteilung waere eine Verhaltensaenderung an der Erstattungsbedingung und
gehoert nicht in eine Phase, die keinen Cent bewegen darf.

(g) **Die Belegzeile `traeger=telnyx_call_records` - der Einsammler, ohne den vier der fuenf
Profile nie vollstaendig werden** (Owner-Entscheidung 11, Default: bauen). Fuer jeden Anruf,
dessen Profil diesen Traeger fuehrt (`telnyx_budget`, `telnyx_assistant`,
`telnyx_inbound_budget`, `telnyx_inbound_realtime`), legt `trueOneCall` die Zeile aus dem
BEREITS VORHANDENEN `measured`-Ergebnis an (`cost-truing.js:665`) - kein zweiter Abruf, kein
zusaetzliches Netz-IO, dieselbe Messung, die heute schon `bookCorrectionFor` speist. Betrag
`measured.actualCostMicroCents`, Waehrung USD, `quelle` `telnyx_detail_records`, `beleg_ref`
der Anker, ueber den die Records zugeordnet wurden (`call_control_id` bzw.
`telnyx_session_id`, `telephony/adapters/telnyx/voice.js:140/160/903`), `detail` mit
`billed_sec`/`rate` - alles nach der Allowlist aus KV2-3, also nie eine Rufnummer und nie ein
Anbieter-Rohbody. Die Reife wird NICHT neu erfunden, sondern Bedingung fuer Bedingung aus
dem Bestandspraedikat uebernommen:
- `belegt` genau dann, wenn `classifyRecords` `complete` liefert
  (`measured.source === COST_TRUING_SOURCE.DETAIL_RECORDS`, gesetzt `cost-truing.js:328/:331`)
  UND `measured.billedSecTotal > 0` - exakt die beiden Bedingungen, die `refundProven` heute
  prueft (`:452-457`);
- sonst `vorlaeufig`.
Die DRITTE Bedingung von `refundProven`, `isBookableCents(call.estimatedCostCents)`, ist eine
Eigenschaft des ANRUFS, nicht des Belegs. Sie wandert ausdruecklich NICHT in die Reife und
bleibt, wo sie heute steht (`bookCorrectionFor`, `cost-truing.js:477`); sonst haette ein
fehlender Schaetzbetrag stillschweigend die Bedeutung "Beleg fehlt" bekommen - zwei
Sachverhalte auf einem Label, genau das, was `truedSourceOf` (`:466-471`) im Bestand bereits
trennt.
**Profil-Trennung, sonst zaehlt das Buch doppelt:** die `telnyx_sip`-Zeile entsteht
AUSSCHLIESSLICH fuer `el_convai_sip`, die `telnyx_call_records`-Zeile AUSSCHLIESSLICH fuer die
vier Profile oben. Kein Anruf bekommt beide Zeilen aus demselben Record-Pool; sonst stuende
derselbe Betrag zweimal in der Belegsumme, die KV2-8 bildet.
Test: derselbe Fixture-Pool, der heute `refundProven === true` ergibt, erzeugt genau eine
`belegt`-Zeile mit `measured.actualCostMicroCents`; ein Pool ohne `sip-trunking`-Record
(also `source=incomplete`) erzeugt genau eine `vorlaeufig`-Zeile; ein Anruf des Profils
`el_convai_sip` erzeugt KEINE `telnyx_call_records`-Zeile. In allen drei Faellen bewegt sich
null Cent, und `usage.costCorrectionMicroCentsRem` ist bit-gleich.

(h) **Der Zwilling des B6-Tests, fuer die 12 EL-Altanrufe - dieselbe Bauform wie (a), nur
fuer die Altmenge.** Diese Phase macht die 12 Altanrufe mit dem `sipCallId`-Join erstmals
abrufbar (heute liefert `providerLegIdOf` fuer sie `null`, `isRetrievable`
`cost-truing.js:581` ist falsch); sie haben `costTruedAt === null` und 0 Versuche, werden
also im ersten Sweep nach dem Deploy Kandidaten und laufen in `trueOneCall`, wo
`cost-truing.js:684` `bookCorrectionFor` fuer JEDEN gemessenen Anruf ruft (alle Zahlen am
2026-08-30 lesend an der Produktions-DB gemessen, s. 4.3). Die Legacy-Zuordnung ist deshalb
`sipCallId`-bewusst (4.3, 4.6): eine profillose Altzeile MIT gesetztem `sipCallId` faellt auf
`el_convai_sip`, nicht auf `telnyx_budget`.
Fixture, wortgleich zur Bauform von (a): ein Anruf OHNE `costProfile`, MIT `sipCallId`,
`estimatedCostCents = 30`, ausschliesslich Telnyx-Beleg und ohne EL-Beleg bewegt **null
Cent**; `applyCostCorrectionCents` wurde nachweislich NICHT aufgerufen (Spion);
`costCorrectionMicroCentsRem` ist bit-gleich.
**Gegenprobe im selben Test, sonst pinnt er die Legacy-Regel nicht:** ein Anruf OHNE
`costProfile` und OHNE `sipCallId` (die gewoehnliche Telnyx-Altzeile) verhaelt sich
unveraendert wie heute - `applyCostCorrectionCents` wird mit denselben Argumenten gerufen
wie im Bestand, die Erstattung bleibt erhalten. Ohne diese zweite Richtung waere der Test
auch dann gruen, wenn jemand die Legacy-Zuordnung fuer ALLE Altzeilen abschaltet und damit
die 56 heute funktionierenden Faelle mit erschlaegt.
Der Test ist unabhaengig davon gruen, welche Bauform Owner-Entscheidung 14 waehlt: er misst
das Ergebnis (null Cent, Spion ungerufen), nicht den Weg dorthin.
Warum das nicht schon (a) abdeckt: (a) setzt das Profil `el_convai_sip` VORAUS. Genau das
haben die 12 Altzeilen nicht - sie sind vor KV2-2 entstanden und tragen gar kein Profil.

**Was diese Phase NICHT tut.** Sie ruft `bookCorrectionFor` (`cost-truing.js:476`) fuer
Anrufe der EL-Route ausdruecklich NICHT auf. Sie sammelt, sie bucht nicht. Die B6-Falle
wird durch eine Reihenfolge-Entscheidung entschaerft, nicht durch Sorgfalt. Fuer die
Bestandsprofile aendert sie am Buchungsweg NICHTS: `bookCorrectionFor` laeuft dort weiter wie
heute, die neue Zeile aus (g) liegt daneben und wird erst in KV2-8 gelesen. Sie liest die
Zeile also selbst nicht - auch nicht fuer die Deckungsquote, die kommt in KV2-6.

**Ein zweiter Zustands-Schreibweg laeuft trotzdem mit, benannt und gepinnt (statt
vermutet).** `trueOneCall` ruft fuer JEDEN gemessenen Anruf nicht nur `bookCorrectionFor`,
sondern zusaetzlich `bookTtsCharactersFor` (`cost-truing.js:685` -> `:515-521`), das
`store.recordRelayTtsCharacters` schreibt und einen Kontingent-Befund melden kann. Sobald
diese Phase EL-Anrufe messbar macht, laeuft dieser Schreibweg fuer sie mit. Der Betrag ist
fuer EL-Anrufe VERMUTET 0 (`measured.ttsCharacters <= 0` -> frueher Ausstieg), aber
unbelegt - Abnahmekriterium (e) macht daraus eine Messung statt einer Annahme.

**Abhaengigkeit.** KV2-4. Owner-Vorbedingung: Entscheidung 11 (Abschnitt 7) - baut diese
Phase den `telnyx_call_records`-Einsammler (a) oder settlen die Bestandsprofile dauerhaft ueber
den Bestandspfad (b)? Bleibt die Antwort aus, gilt die dortige Empfehlung als Default: (a),
also Kriterium (g) wie beschrieben - im Phasenbericht ausdruecklich als Default vermerkt,
nicht als getroffene Entscheidung. Faellt sie auf (b), entfaellt (g) ersatzlos, KV2-6(f)
wird zur Ausnahme-Regel des Herzschlags und KV2-8(i) zum Beleg, dass `refundProven`
UNVERAENDERT weiterlaeuft.
Entscheidung 9 beruehrt diese Phase nicht: sie betrifft nur die Traegerliste von
`telnyx_inbound_realtime`, nicht die drei Bestandsprofile, deren Pflicht-Typmenge (f)
unveraendert festschreibt.
Entscheidung 14 (Bauform des Altzeilen-Riegels, Abschnitt 7) beruehrt (h): Default ist
(a), die Umlenkung profilloser Altzeilen mit `sipCallId` auf `el_convai_sip`. Faellt sie auf
(b) - vollstaendige Herausnahme aus dem Buchungspfad -, aendert sich der WEG, nicht das
Kriterium: (h) misst null bewegte Cent und den ungerufenen Spion, und beide Bauformen
liefern das. Bleibt die Antwort aus, laeuft die Phase mit (a), und der Phasenbericht
vermerkt das ausdruecklich als Default, nicht als getroffene Entscheidung.
Entscheidung 12 (Traegername) beruehrt sie dagegen sehr wohl: faellt sie auf die
Aufspaltung in Traeger je Belegtyp, aendert sich (g) - dann legt der Sweep nicht EINE Zeile
mit `measured.actualCostMicroCents` an, sondern eine je Belegtyp, `dataComplete` misst gegen
eine laengere Pflichtliste, und der Regressionsbeleg gegen den Bestandspfad (b)/KV2-8(i)
muss diese Zerlegung mit abdecken. Default ist die Umbenennung; dann bleibt (g) exakt wie
beschrieben.
**Nicht-Ergebnis dieser Phase, ausdruecklich:** scheitert die Messung (d), ist die Phase
teil-erfuellt und meldet an den Owner (s. dort). KV2-6 kann darauf aufsetzen (sie misst
Deckung, nicht Vollstaendigkeit gegen eine Pflichtmenge), KV2-8 nicht.

---

### KV2-6 - Deckung je Traeger und der Herzschlag

**Ziel.** Die Erfassung wird beobachtbar, BEVOR sie Geld bewegt. Deckungsquote je Traeger
statt global, plus die faelligkeits-unabhaengige Herzschlag-Klasse, die den Zustand vom
19.08. binnen Stunden meldet.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Quoten je Traeger, Sweep-Zeile nennt
je Traeger `kandidaten/belegt/offen/unbeschaffbar`, drei Befund-Codes aus 4.9),
`src/routes/api-billing.js` (Anzeige neben `GET /api/billing/platform-costs`, hinter
`webAuthMw + adminMw` wie die Bestandsroute), `src/config.js` / `.env.example`
(`KOSTEN_HEARTBEAT_FENSTER_H`, Default 6), Tests.

**Abnahmekriterium (ohne echten Anruf).**
(a) Fixture-Bestand mit 10 Anrufen des Profils `el_convai_sip`, davon 3 ohne EL-Beleg:
EL-Quote 70 %, Telnyx-Quote 100 %, genau ein Befund, genau eine Mail.
(b) Herzschlag: ein Bestand "in den letzten 6 Stunden 5 beendete Anrufe mit Profil
`el_convai_sip`, 0 Belege `elevenlabs_convai`" erzeugt genau einen Alarm auf beiden Kanaelen -
und zwar OHNE dass irgendein Anruf faellig ist. Zweiter Sweep im Entprellfenster: kein
zweiter Alarm, aber ein Notiz-Eintrag.
(c) Anrufe im Zustand `beleg_strukturell_unbeschaffbar` zaehlen NICHT in die Deckungsquote -
Fixture mit 10 Anrufen, davon 4 unbeschaffbar, ergibt eine Quote ueber 6, nicht ueber 10.
(d) Ein Anruf ohne `endedAt` erscheint in einer eigenen, benannten Zaehlzeile "nie beendet"
und faellt nicht lautlos aus Zaehler UND Nenner (heute ist er fuer die Kennzahl unsichtbar,
`isEndedCall` false, `cost-truing.js:137`, `angriff-premortem.md` 2.4).
(e) `usage.costCents` unveraendert.
(f) **Der Herzschlag schweigt fuer die Bestandsprofile - das ist ein Kriterium, keine
Nebenfolge.** Fixture: in den letzten `KOSTEN_HEARTBEAT_FENSTER_H` Stunden 5 beendete Anrufe
mit Profil `telnyx_budget`, fuer jeden die Belegzeile `traeger=telnyx_call_records` aus
KV2-5(g) -> `kosten:erfassung-tot:telnyx_call_records` feuert NICHT, auf keinem Kanal, und es
entsteht auch keine Notiz-Zeile. Gegenprobe im selben Test: dieselben 5 Anrufe OHNE jede
`telnyx_call_records`-Zeile erzeugen genau einen Alarm - der Herzschlag ist also scharf und
nur still, weil eingesammelt wird. Ohne dieses Kriterium waere der Alarm fuer den Traeger von
vier der fuenf Profile dauerhaft an, und 4.4 verwirft genau das ("ein Alarm, der immer an
ist, ist keiner").
Zaehlweise, die dazugehoert: fuer den Herzschlag zaehlt eine Zeile mit `reife=vorlaeufig`
als ANGELEGT (die Frage lautet "sammelt ueberhaupt noch jemand"), fuer die Deckungsquote
zaehlt sie NICHT als belegt (die Frage lautet "ist es vollstaendig"). Zwei Fragen, zwei
Bedingungen - sie duerfen nicht auf dieselbe gelegt werden.
**Eine Zeile im Zustand `erwartet` zaehlt fuer den Herzschlag NIE als angelegt - sie ist der
Platzhalter, nicht der Beleg (dieselbe Regel wie in der Summenbildung 4.5/KV2-3(e)).** Ohne
diesen Satz waere `kosten:erfassung-tot:telnyx_sip` strukturell stumm: KV2-4 legt fuer JEDEN
EL-Anruf synchron am Gespraechsende eine `telnyx_sip`-Zeile im Zustand `erwartet` an, und
wer die als angelegt liest, bekommt einen Herzschlag, der per Konstruktion nie schlaegt.
Gepinnt wird das in (g).
Faellt Owner-Entscheidung 11 auf (b), kehrt sich dieses Kriterium um: dann fuehrt der
Herzschlag `telnyx_call_records` gar nicht, weil es fuer diesen Traeger keinen Einsammler
gibt, und der Test pinnt die AUSNAHME statt der Belegzeile.
(g) **Der Herzschlag des Traegers `telnyx_sip` haengt am Beleg, nicht am Platzhalter.**
Fixture: in den letzten `KOSTEN_HEARTBEAT_FENSTER_H` Stunden 5 beendete Anrufe mit Profil
`el_convai_sip`, je einer `elevenlabs_convai`-Zeile (`reife=vorlaeufig`) und je einer
`telnyx_sip`-Zeile im Zustand `erwartet` - also genau der Zustand, den KV2-4 synchron am
Gespraechsende anlegt -> `kosten:erfassung-tot:telnyx_sip` feuert GENAU EINMAL.
**Gegenprobe im selben Test:** dieselben 5 Anrufe mit `telnyx_sip` auf `belegt` -> kein
Alarm, auf keinem Kanal, und keine Notiz-Zeile. Ohne dieses Kriterium bliebe der Herzschlag
fuer genau den Traeger ungeprueft, ueber den der Telnyx-Anteil des EL-Wegs eingesammelt
wird, und zwar unbemerkt: (b) pinnt nur `elevenlabs_convai`, (f) nur
`telnyx_call_records` - fuer `telnyx_sip` pinnte bis hierher nichts, dass der Alarm
ueberhaupt scharf ist.

**Was diese Phase NICHT tut.** Keine Buchung. Kein Settlement. Keine Schliessregel-Aenderung.

**Abhaengigkeit.** KV2-5; Kriterium (g) setzt zusaetzlich die `erwartet`-Zeile
`telnyx_sip` aus KV2-4 voraus, die in der Kette ohnehin davor liegt. Diese Phase steht
bewusst VOR dem Geld-Umschalter: bleibt die
Kette hier stehen, sammelt und meldet das System korrekt, ohne falsch zu buchen. Bliebe sie
nach dem Umschalter stehen, buchten wir korrekt und merkten einen Ausfall nicht.

---

### KV2-7 - Schliessregel, Faelligkeit, Verfall, Endzustaende

**Ziel.** Ein Anruf bleibt Kandidat, bis seine Pflichtmenge vollstaendig ist oder Frist bzw.
Versuche erschoepft sind - statt beim ersten Teilbeleg zuzulatchen. Und ein Anruf, dessen
Beleg strukturell unbeschaffbar ist, bekommt einen eigenen Endzustand statt eines Dauer-Alarms.

**Betroffene Dateien.** `src/billing/cost-truing.js` (`isTruingCandidate`, `:288-294`;
Schliesslogik in `trueOneCall`; Versuche je Traeger statt je Anruf; die Erkennungsregel aus
(h) als EIN reines Praedikat ueber den Anruf-Datensatz, nicht verteilt auf zwei Stellen),
`src/store/state-ops.js` (Endzustaende am Beleg und am Anruf; gelesen werden dort
ausschliesslich vorhandene Felder - `costProfile`, `endedAt`, `elevenlabsConversationId`
(`:380`), `sipCallId` (`:389`) -, es entsteht KEIN neues Anruf-Feld fuer (h)),
`src/config.js` / `.env.example`
(`COST_SETTLE_DEADLINE_HOURS`, entschieden auf 48 - s. Owner-Entscheidung 3; die frueher
hier stehende Verweisung auf Entscheidung 6 war falsch, 6 ist die Tarif-Automatik), Tests.

Endzustaende: `vollstaendig`, `unvollstaendig_final` (mit namentlicher Liste der fehlenden
Traeger), `beleg_strukturell_unbeschaffbar`, `profil_fehlt`.

**Abnahmekriterium (ohne echten Anruf).**
(a) **Regressionsschutz, der die ganze Phase traegt:** ein Anruf mit Profil `telnyx_budget`
(genau ein Pflicht-Traeger) verhaelt sich byte-identisch zu heute - dieselbe Zahl Versuche,
derselbe Zeitpunkt fuer `costTruedAt`, derselbe Herkunftswert.
(b) Ein Anruf mit Profil `el_convai_sip`, dessen Telnyx-Beleg zuerst eintrifft, bleibt
Kandidat und wird nicht geschlossen.
(c) Nach Ablauf der Frist wird derselbe Anruf geschlossen, sein Endzustand ist
`unvollstaendig_final`, die fehlenden Traeger sind namentlich benannt, und er ist kein
Kandidat mehr - er bleibt nicht ewig offen.
(d) Versuche werden je Traeger gezaehlt: ein erschoepfter Telnyx-Zaehler beendet nicht die
Nachreifung der EL-Zeile.
(e) Ein Anruf vom Abbruchweg landet in `beleg_strukturell_unbeschaffbar` und erzeugt keinen
Deckungs-Alarm.
(f) `usage.costCents` unveraendert - diese Phase bucht noch immer nichts.
(g) **Der Phasenschnitt-Nachlauf (einmalig, s. 4.7):** Fixture mit Profil `el_convai_sip`,
`costTruedAt` gesetzt, genau eine `call_cost_evidence`-Zeile `traeger=telnyx_sip` und keine
`elevenlabs_convai`-Zeile mit `reife=belegt` oder `vorlaeufig` -> nach dem Nachlauf ist
`costTruedAt === null`, der Anruf ist im naechsten Sweep wieder Kandidat. Ein zweiter
Durchlauf des Nachlaufs auf denselben Datensatz ist ein No-Op (bereits `null`, nichts
aendert sich).
**Gegenprobe, die zum Kriterium gehoert:** ein zweites Fixture mit Profil `el_convai_sip`
und gesetztem `costTruedAt`, aber OHNE jede `call_cost_evidence`-Zeile (die Altzeile von VOR
der Kette) wird NICHT angefasst - `costTruedAt` bleibt unveraendert. Ohne diese Gegenprobe
waere das Kriterium blind fuer genau den Fall, den die gestrichene Zeitfenster-Bedingung
verdeckt abgedeckt hatte (s.u.).

(h) **Die Erkennungsregel fuer den Fall "Deploy mitten im Gespraech" (6.10) - zustandsbasiert
und ohne Deploy-Zeitstempel.** Ohne sie ist der Endzustand
`beleg_strukturell_unbeschaffbar` fuer diesen Fall eine Zusage ohne Mechanismus: (e) pinnt
ausschliesslich den ABBRUCHWEG, und dort entsteht der Zustand am BELEG, weil
`persistProviderResult` (`elevenlabs/outbound.js:1283-1331`) gelaufen ist. Im 6.10-Fall
laeuft genau dieser Aufruf NIE - `boot.js:1180` (`lifecycle.rearmActiveCallTimers`)
terminalisiert den Anruf vor `:1207` (`rearmActiveConversationPolls`), BELEGT, in dieser
Session gelesen. Es entsteht also weder eine EL-Belegzeile noch die `erwartet`-Zeile
`telnyx_sip`, die einen Marker tragen koennte. Ohne eigene Regel liefe ein solcher Anruf
nach Fristablauf in `unvollstaendig_final`, zaehlte voll in die Deckungsquote (nach KV2-6(c)
ist NUR `beleg_strukturell_unbeschaffbar` ausgenommen) und speiste den Herzschlag - also
genau den Dauer-Alarm, den 4.4 verwirft. Eine spaetere Session muesste die Regel erfinden.
**Die Regel, am Anruf-Datensatz und an nichts sonst.** Ein Anruf bekommt den Endzustand
`beleg_strukturell_unbeschaffbar` AM ANRUF (nicht an einem fehlenden Beleg), wenn ALLE
folgenden Bedingungen gleichzeitig gelten:
1. `costProfile === el_convai_sip`,
2. `endedAt` gesetzt,
3. `elevenlabsConversationId` vorhanden (das Gespraech hat beim Anbieter existiert),
4. `sipCallId === null` - der Schluessel hat genau EINEN Schreiber, `store.recordSipCallId`
   in `elevenlabs/outbound.js:1312` (BELEGT: `grep` ueber `src/` liefert ausserhalb der
   Store-Fassade genau diesen einen Aufrufer), und der sitzt INNERHALB von
   `persistProviderResult`. Ein leerer Schluessel heisst also: dieser Aufruf ist nie
   gelaufen,
5. KEINE `call_cost_evidence`-Zeile zu diesem Anruf, in keinem Zustand.
**Warum 4 und 5 beide noetig sind und keine der beiden allein reicht:** der
Bestandskommentar an `outbound.js:1305-1311` benennt einen zweiten Weg zu einem leeren
Schluessel - der Anbieter meldet ein Ergebnis ohne `phone_call.call_id`. Dann IST
`persistProviderResult` gelaufen, und KV2-4 hat die `elevenlabs_convai`-Zeile geschrieben;
Bedingung 5 schliesst diesen Fall aus. Umgekehrt hat ein Anruf, dessen Belegsammlung nur
noch nicht angelaufen ist, sehr wohl einen `sipCallId`; Bedingung 4 schliesst ihn aus.
**Zeitpunkt der Einordnung, ausdruecklich:** die Regel wird bei FAELLIGKEIT ausgewertet,
also nach Ablauf von `COST_SETTLE_DEADLINE_HOURS`, nie waehrend der laufenden Frist. Sonst
traefe sie das Fenster von wenigen Millisekunden zwischen dem Ende eines Gespraechs und dem
Lauf von `persistProviderResult` und erklaerte einen voellig gesunden Anruf fuer
unbeschaffbar. Das ist dieselbe Regel wie in der Matrix 4.6 ("ein Traeger fehlt, Frist laeuft
noch -> warten").
**Folge, dieselbe wie bei (e):** eigene, benannte Zaehlzeile, KEIN Deckungs-Alarm, nicht in
der Deckungsquote (KV2-6(c)), Schaetzung bleibt stehen (Restrisiko, 6.10).
Test: ein Fixture mit allen fuenf Bedingungen und abgelaufener Frist bekommt
`beleg_strukturell_unbeschaffbar` und erzeugt keinen Deckungs-Alarm.
**Gegenprobe im selben Test, zwei Richtungen:** (i) ein nie angenommener Anruf ohne
`estimatedCostCents` faellt NICHT in diese Menge - er ist kein unbeschaffbarer Beleg,
sondern ein Anruf ohne Kosten, und die Matrix 4.6 behandelt ihn als gueltigen Beleg mit 0;
(ii) derselbe Fixture wie oben, aber mit gesetztem `sipCallId`, faellt ebenfalls nicht in
die Menge, sondern bleibt regulaerer Kandidat.
**Reichweite, ehrlich benannt:** am 2026-08-30 gibt es in der Produktion NULL Anrufe, die
diese Regel traefe - alle 12 EL-Anrufe tragen `sip_call_id` (gemessen, s. 4.3). Die Regel
sichert einen Fall, der noch nicht eingetreten ist; das ist ihr Zweck (6.10) und keine
Vermutung ueber Bestandsdaten.

**Der Phasenschnitt-Nachlauf im Detail.** Ein benannter, EINMALIGER Migrations-Lauf (Teil
des KV2-7-Deploys, kein Dauerbetrieb) identifiziert jeden Anruf, auf den ALLE VIER
Bedingungen zutreffen:

1. Profil `el_convai_sip`,
2. `costTruedAt` gesetzt,
3. **mindestens eine `call_cost_evidence`-Zeile `traeger=telnyx_sip`**,
4. KEINE `call_cost_evidence`-Zeile `traeger=elevenlabs_convai` mit `reife=belegt` oder
   `vorlaeufig`.

Fuer jeden Treffer setzt der Lauf `costTruedAt` zurueck auf `null`.

**Die Bedingung ist rein zustandsbasiert - ein Zeitfenster gibt es ausdruecklich NICHT.**
Eine fruehere Fassung dieses Plans verlangte zusaetzlich, dass `costTruedAt` "zwischen dem
KV2-5- und dem KV2-7-Deploy-Zeitpunkt" gesetzt wurde. Diese Bedingung ist gestrichen, und
zwar aus einem Grund, der am Code steht: **keiner der beiden Zeitpunkte ist irgendwo
persistiert.** Der Anruf-Datensatz fuehrt `actualCostMicroCents`, `costTruedAt`,
`costTruedSource` und `costTruingAttempts` - keinen Deploy-Zeitstempel (BELEGT,
`src/store/state-ops.js:320-334`); auch das Abnahmekriterium (g) hat den Zeitbezug nie
geprueft. Eine spaetere Session muesste ihn raten, und ein geratener Zeitbezug an einem
einmaligen Migrationslauf ist die schlechteste Sorte Vermutung.

**Bedingung 3 ist der Riegel, den das Zeitfenster verdeckt getragen hat.** Ohne sie faellt
auch ein EL-Anruf von VOR der Kette in die Menge: er hat Profil (ueber den Legacy-Fallback),
`costTruedAt` gesetzt und keine EL-Belegzeile. Genau von dem unterscheidet ihn der
Telnyx-SIP-Beleg: `call_cost_evidence` existiert erst ab KV2-3, und eine
`telnyx_sip`-Zeile kann erst entstehen, seit KV2-5 `call.sipCallId` lernt (4.7). Eine solche
Zeile IST damit der Zustandsbeweis dafuer, dass der Anruf im Phasenschnitt-Fenster gelatcht
wurde - dieselbe Aussage, die das Zeitfenster treffen wollte, nur belegt statt datiert. Ein
Altanruf von vor der Kette bleibt geschlossen, SOLANGE er keine `telnyx_sip`-Zeile hat; das
ist gewollt und deckt sich mit Owner-Entscheidung 7.
**Eine Folge muss hier ausdruecklich stehen, weil sie sonst spaeter als Widerspruch gelesen
wird:** faellt Owner-Entscheidung 14 auf (a) - profillose Altzeilen mit gesetztem
`sipCallId` bekommen `el_convai_sip` -, dann bekommen die 12 EL-Altanrufe in KV2-5 eine
`telnyx_sip`-Zeile und `costTruedAt` und erfuellen ab KV2-7 alle vier Bedingungen des
Nachlaufs. Sie werden also wieder geoeffnet. **Das widerspricht Owner-Entscheidung 7
nicht**, denn "geoeffnet" ist nicht "gebucht": `applyCostCorrectionCents` hat fuer sie nie
gelaufen (KV2-5 ruft `bookCorrectionFor` fuer die EL-Route nicht), und im Settlement ab
KV2-8 ist ihr Ist (4,01 US-ct SIP) kleiner als die Schaetzung (30 ct) bei fehlender
EL-Belegzeile, also `dataComplete = false` - die Matrix in 4.6 sagt dafuer **nichts**, keine
Erstattung. Null Cent, in jeder Phase der Kette. Was sie stattdessen tun: bis zum
Fristablauf stehen sie sichtbar in der EL-Deckungsquote und landen dann in
`unvollstaendig_final` - genau der Preis, den Owner-Entscheidung 14 (a) benennt. Faellt 14
auf (b), tragen sie gar kein Profil, erfuellen Bedingung 1 des Nachlaufs nicht und bleiben
geschlossen.
Als Marker taugt der Ist-Betrag am Anruf ausdruecklich NICHT: im Phasenschnitt-Fenster
liefert der Telnyx-Beleg eine Messung, `recordCallCostTruingResult` schreibt
`actualCostMicroCents` (`state-ops.js:809-810`), und eine Bedingung "kein Ist-Betrag" wuerde
genau die Zielmenge ausschliessen. Dass fuer diese Anrufe trotzdem nichts gebucht wurde,
steht eine Ebene tiefer: KV2-5 ruft `bookCorrectionFor` fuer die EL-Route ausdruecklich
nicht auf.

**Das weicht den
set-once-Riegel nicht auf:** der Riegel schuetzt gegen doppelte BUCHUNG, und "bis
einschliesslich KV2-7 bewegt die Kette keinen Cent" (Abschnitt 5, Abnahmekriterium jeder
Phase bis hierher) - fuer keinen der betroffenen Anrufe hat `applyCostCorrectionCents` je
gelaufen, es gibt also nichts, was der Nachlauf doppelt buchen koennte. Der Lauf selbst ist
idempotent (zweiter Durchlauf trifft auf bereits `null` gesetzte Zeilen, No-Op) und laeuft
genau einmal beim Deploy, nicht als Teil des laufenden Sweeps.

**Was diese Phase NICHT tut.** Kein Settlement, keine Buchung, keine Aenderung an
`applyCostCorrectionCents`. Auch (h) bucht nichts: die Regel ordnet einen Anruf ein und
haelt ihn aus Deckungsquote und Herzschlag heraus, sie bewegt keinen Cent und aendert die
Schaetzung nicht (die bleibt stehen, Restrisiko 6.10). Sie verhindert den 6.10-Fall auch
NICHT - dafuer muesste die Boot-Reihenfolge angefasst werden, und das ist nicht Teil dieser
Kette; sie macht ihn unterscheidbar.

**Abhaengigkeit.** KV2-6. Owner-Vorbedingung: Entscheidung 3 (Frist bis zum
Zwangs-Settlement) und Entscheidung 4 (Anruf ohne Vollbeleg nach Fristablauf, Abschnitt 7) -
beide am 2026-08-30 GETROFFEN: 48 Stunden, und der Tenant traegt die Schaetzung.
Kriterium (h) haengt zusaetzlich an Entscheidung 3, aber an keiner neuen: seine Auswertung
findet bei Faelligkeit statt, also nach `COST_SETTLE_DEADLINE_HOURS`. Eine eigene
Owner-Frage oeffnet (h) nicht - die Bedingungsmenge ist am Code entschieden (einziger
Schreiber von `sipCallId`, Boot-Reihenfolge in `boot.js`), nicht eine Abwaegung.
Beide Werte sind damit Vorgabe, nicht Default; der Phasenbericht fuehrt sie als
Entscheidung. Eine Kulanz-Gutschrift ohne Beweis ist ausdruecklich verworfen.

---

### KV2-8 - Das Settlement (der Geld-Umschalter)

**Ziel.** Genau EIN Settlement je Anruf: Summe der Belegzeilen, ein Aufruf von
`applyCostCorrectionCents`, `dataComplete` aus Profil-Soll gegen Beleg-Ist. Im SELBEN
Commit: die neuen Herkunftswerte und die traeger-getrennte Monats-Gegenprobe.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Settlement; `refundProven` wird
ersetzt - zulaessig NUR, weil KV2-5(g) auch fuer die Bestandsprofile eine Belegzeile liefert,
s.u.),
`src/billing/kosten-projektion.js` (neu: zwei reine Funktionen - Summe der Belege,
Vollstaendigkeit gegen das Profil), `src/store/defaults.js` (`COST_TRUING_SOURCE` waechst um
zwei Werte), `src/billing/cost-calibration.js` (`isDriftSample`, `:57`),
`src/billing/cost-cross-check.js` (Traeger-Trennung), Tests.

Warum die Gegenprobe im selben Commit: `actualCostMicroCentsForMonth`
(`state-ops.js:4544`) summiert nur Calls mit `provider === PROVIDER.TELNYX`, und EL-Anrufe
tragen `provider: telnyx` (`api-calls.js:335`, BELEGT `angriff-kritiker.md` K5). Sobald
`actualCostMicroCents` die Summe ueber mehrere Traeger ist, vergleicht
`cost-cross-check.js` EL-Kosten mit einer Telnyx-Rechnung. Beide Entwuerfe reparieren das
erst vier bzw. zwei Phasen spaeter - dazwischen laeuft eine Beobachtung, die falsch statt
nur unvollstaendig ist, und das ist der Zustand, in dem eine Kette gerne liegen bleibt.

**Abnahmekriterium (ohne echten Anruf).**
(a) Tabellentest ueber die vollstaendige Matrix aus 4.6 - **zehn** Zeilen mal zwei
Richtungen, rein aus Fixtures, ohne Netz. Die Zeilenzahl **10** wird an genau EINER Stelle
im Test gepinnt; wer eine Matrixzeile ergaenzt, zieht sie hier mit (dieselbe Regel und
derselbe Grund wie bei der Katalog-Zeilenmenge in KV2-2(d)). Die zehnte Zeile ist nicht
dekorativ: die Aufspaltung der Altzeilen-Lage in `sipCallId` LEER und `sipCallId` GESETZT
(4.6, Absatz "Die beiden Altzeilen-Zeilen sind KEINE Doppelung") IST der Riegel gegen die
ungewollte Erstattung an den 12 EL-Altanrufen. Ein Test, der auf 9 stehen bleibt, laesst
mit hoher Wahrscheinlichkeit genau die zuletzt hinzugekommene, also diese geldrelevante
Lage ungeprueft - derselbe Fehlertyp, der die Katalog-Zahl einmal auf 15 stehen liess,
waehrend die Zusammenfassungs-Mail fehlte (KV2-2(d)).
(b) Vakuositaets-Test: ein Anruf mit unbekanntem oder fehlendem Profil, mit LEERER
Pflichtmenge, mit `estimatedCostCents = 30` und null Belegen bewegt **null Cent** und
erzeugt einen Befund. Ein Praedikat, das ueber Geldrueckgabe entscheidet, darf nie
allquantifiziert wahr werden.
(c) Zweites Settlement desselben Anrufs bewegt null Cent (`costTruedAt` set-once,
`state-ops.js:804-812`).
(d) Rundungstest: die Endsumme laeuft genau einmal durch
`convertProviderMicroToBucketCents`; `usage.costCorrectionMicroCentsRem` nach dem Settlement
entspricht exakt dem Wert einer einmaligen Umrechnung derselben Summe.
(e) Enum-Test: jeder Wert von `COST_TRUING_SOURCE` wird einmal durch `refundProven`,
`truedSourceOf` und `isDriftSample` geschickt; kein Wert faellt unentschieden durch, und
ein EL-Settlement behauptet nicht `telnyx_detail_records`.
(f) Gegenprobe: ein Fixture-Monat mit beiden Traegern ergibt ZWEI getrennte Differenzen,
keine Mischdifferenz.
(g) Vorzeichen und Typ: ein negativer oder nicht-numerischer Betrag erreicht
`applyCostCorrectionCents` nie (die Bestandszusage "der Aufrufer garantiert
`actualCostMicroCents >= 0`", `state-ops.js:3703`, ist genau das, was hier neu zu erfuellen
ist).
(h) Schreibstellen-Test statt einmaligem grep: eine Pruefung erfasst JEDE Schreibform an
`usage.costCents` - Zuweisung (`usage.costCents =`) UND Inkrement (`usage.costCents +=`) -
und schlaegt fehl, sobald eine dritte Fundstelle ausserhalb von `bookCents` und
`applyCreditCents` auftaucht. Dieser Test bleibt Teil der Suite, nicht ein einmaliger Beleg.
(i) **Erstattungs-Regression fuer die Bestandsprofile, byte-identisch zu heute - der Test,
der das Ersetzen von `refundProven` ueberhaupt erlaubt.** Ein Anruf mit Profil
`telnyx_budget`, `estimatedCostCents = 30` und einem VOLLSTAENDIGEN Record-Pool
(Pflicht-Typmenge `sip-trunking,call-control` erfuellt, `billedSecTotal > 0`) wird erstattet,
und zwar mit demselben Delta, demselben `usage.costCorrectionMicroCentsRem` und demselben
Herkunftswert wie der heutige `refundProven`-Pfad auf demselben Pool. Der Test faehrt beide
Pfade gegen dieselbe Fixture und VERGLEICHT die Ergebnisse, statt eine Zahl abzuschreiben -
eine abgeschriebene Zahl wuerde eine spaetere Verschiebung mitwandern lassen. Drei
Gegenproben gehoeren dazu: derselbe Anruf mit einem Pool nur aus `call-control`-Records wird
NICHT erstattet (Menge unvollstaendig, `dataComplete` falsch); derselbe Anruf mit
`billedSecTotal === 0` wird NICHT erstattet; derselbe Anruf ohne buchbaren
`estimatedCostCents` bewegt null Cent (der `isBookableCents`-Riegel, `cost-truing.js:477`,
lebt weiter und ist NICHT in die Belegreife gewandert, KV2-5(g)).
Faellt Owner-Entscheidung 11 auf (b), pinnt derselbe Test denselben Sollwert - nur laeuft er
dann gegen den unveraenderten `refundProven`-Pfad, und die Formulierung "`refundProven`
ersetzt" oben wird zu "ergaenzt".

**Wie die Safety-Gates eingehalten werden.** Diese Phase beruehrt die pro-Tenant-Kostendecke
direkt. Sie macht die Decke ausschliesslich GENAUER: der einzige Weg, auf dem Geld
zurueckfliessen kann, ist der bestehende, beweispflichtige Zweig in
`applyCostCorrectionCents` (`:3815`, verwirft negatives Delta ohne `dataComplete` VOR jeder
Mutation; Funktion `:3798-3820`). Es entsteht KEIN dritter Cent-Schreibweg: `bookCents` (`state-ops.js:3609`) und
`applyCreditCents` (`:3756`) bleiben die einzigen zwei Kanten (BELEGT, `befund-code.md` 1,
verifiziert per `grep -n "costCents +=" src/store/state-ops.js`). Die Vorab-Reserve, der
Live-Term `liveVoiceSpendCents`, der aus dem Restguthaben abgeleitete `maxDurationS`-Cap und
`armMaxDurationTimer` (`api-calls.js:372`) bleiben unangetastet.

**Praezisierung der Beleglage:** `grep -n "costCents +=" src/store/state-ops.js` findet
NUR `bookCents` (Zeile 3610) - `applyCreditCents` schreibt per Zuweisung
(`usage.costCents = Math.max(0, vorher + deltaCents)`, Zeile 3758) und wird von diesem
Muster NICHT gefunden. Die Behauptung "zwei Kanten" stimmt, das genannte Pruefmuster deckt
aber nur eine der beiden ab - und ein kuenftiger DRITTER Schreibweg per Zuweisung wuerde
von genau diesem grep ebenfalls uebersehen. Deshalb Abnahmekriterium (h): statt eines
einmaligen grep gehoert ein dauerhafter Test in diese Phase.

**Was diese Phase NICHT tut.** Sie aendert nichts an der Vorab-Gate-Kette, an der Reserve
und an der Live-Bremse. Sie schreibt keine `usage_event`-Zeile fuer Lieferantenkosten. Sie
holt keinen zweiten Wert bei ElevenLabs (das ist KV2-9) - bis dahin bleibt jede EL-Zeile
`vorlaeufig`, und damit ist in dieser Phase noch KEINE Erstattung fuer EL-Anrufe moeglich.
Das ist Absicht: der Umschalter geht in der sicheren Richtung live.

**Abhaengigkeit.** KV2-7. Und die Messung aus KV2-5(d) muss vorliegen, sonst ist die
Pflichtmenge geraten. Das ist eine harte Sperre, keine Empfehlung: liegt die Messung nicht
vor - etwa weil der Telnyx-Zugang ausgefallen ist, wie im Vorlauf dieses Plans mit HTTP 401
(BELEGT, `tasks/kostenv2/AUFTRAG.md:138`) -, wird diese Phase NICHT begonnen. Sie ist der
Geld-Umschalter; eine geratene oder leere Pflichtmenge entscheidet hier ueber Erstattungen
(Blocker-Befund 3/6, Abschnitt 10). Der Ausweg ist die Owner-Meldung aus KV2-5(d) und die
Wiederholung der Messung, nicht ein Ersatzwert. Ebenso muss KV2-5(g) geliefert haben: ohne die
`telnyx_call_records`-Belegzeile waere fuer JEDEN Telnyx-Engine-Anruf `dataComplete` falsch
und die Belegsumme 0 - gegen `estimatedCostCents = 30` ergaebe das einen negativen Delta,
den `applyCostCorrectionCents` (`:3815`) verwirft, und die heute funktionierende Erstattung
(56 von 56 Anrufen, AUFTRAG B1) waere still tot. Ist Entscheidung 11 auf (b) gefallen, faellt
diese Abhaengigkeit weg, und `refundProven` bleibt fuer diese Profile unveraendert stehen.

---

### KV2-9 - Reifung des EL-Belegs und die nachgeholte O3-Messung

**Ziel.** Ein zweiter Abruf hebt die EL-Zeile von `vorlaeufig` auf `belegt` - erst damit ist
fuer EL-Anrufe ueberhaupt eine Erstattung moeglich. Gleichzeitig ist dieser Abruf die
Messung, die in keinem Vorlauf moeglich war.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Reifungs-Zweig im Sweep, unter
derselben Kandidatenbegrenzung und Drossel wie der Telnyx-Pfad),
`src/elevenlabs/convai.js` (`fetchConversation`, `:235`, existiert - nur Aufrufer neu),
`src/config.js` / `.env.example` (`EL_EVIDENCE_MIN_AGE_MINUTES`, Default 15), Tests.

**Der Phasenschnitt KV2-8 -> KV2-9, benannt statt uebersehen.** Zwischen den beiden Deploys
bleibt jede EL-Belegzeile `vorlaeufig` (so steht es in KV2-8). Laeuft in diesem Fenster die
Frist `COST_SETTLE_DEADLINE_HOURS` (entschieden auf 48 h, Owner-Entscheidung 3) ab, wird der
EL-Anruf ueber Faelligkeitsgrund (b) zwangs-gesettelt, landet nach 4.6 ("Traeger nur
vorlaeufig -> nichts") in `unvollstaendig_final`, und `costTruedAt` ist set-once gesetzt.
Diese Anrufe behielten dauerhaft die zu hohe Schaetzung - gemessen rund 30 EUR-Cent gegen
rund 15 US-Cent Ist (EL plus Telnyx-SIP, AUFTRAG B2 / `befund-telnyx.md` O2). Deshalb zwei
Massnahmen, nicht eine:

1. **Vorbedingung (die Absicht):** KV2-9 muss live sein, BEVOR die erste
   `COST_SETTLE_DEADLINE_HOURS` nach dem KV2-8-Deploy ablaeuft. Laesst sich das nicht
   halten, wird die Frist fuer die Dauer des Fensters ausgesetzt (`COST_SETTLE_DEADLINE_HOURS`
   hochgesetzt) statt sie ablaufen zu lassen - das ist ein Env-Handgriff, kein Deploy.
2. **Nachlauf (der Mechanismus):** eine Vorbedingung ist ein Versprechen, kein Riegel.
   KV2-9 bringt deshalb einen zweiten, gleich gebauten EINMALIGEN Nachlauf mit, exakt nach
   dem Muster aus 4.7/KV2-7(g), rein zustandsbasiert und ohne Deploy-Zeitstempel (den fuehrt
   der Anruf-Datensatz nicht, `state-ops.js:320-334`). Er oeffnet jeden Anruf, auf den ALLE
   FUENF Bedingungen zutreffen: (1) Profil `el_convai_sip`; (2) `costTruedAt` gesetzt;
   (3) Endzustand `unvollstaendig_final`; (4) genau eine `elevenlabs_convai`-Zeile mit
   `reife=vorlaeufig` und KEINE mit `reife=belegt`; (5) die Belegsumme des Anrufs liegt
   UNTER `call.estimatedCostCents` - das Zwangs-Settlement hat also nichts gebucht. Fuer
   jeden Treffer setzt er `costTruedAt` auf `null` zurueck; die Reifung und das zweite
   Settlement laufen danach ueber den normalen Weg dieser Phase, mit `dataComplete` wie
   ueberall sonst.

Bedingung 3 ist der Riegel gegen die Anrufe des ABBRUCHWEGS: die tragen den Endzustand
`beleg_strukturell_unbeschaffbar` (4.4), sind nicht nachreifbar und werden vom Nachlauf
nicht angefasst. Bedingung 4 trennt ihn vom Nachlauf aus KV2-7, der genau umgekehrt das
FEHLEN jeder EL-Zeile verlangt: die beiden Mengen sind disjunkt, kein Anruf faellt in beide.

**Bedingung 5 ist der Riegel gegen die doppelte Buchung, und sie ist nicht dekorativ.** Der
set-once-Riegel schuetzt gegen genau das, und ein Nachlauf, der ihn zuruecksetzt, muss den
Schutz selbst mitbringen - "es war ja nur eine Schaetzung" reicht nicht. Anders als bei
KV2-7 hat KV2-8 bereits gebucht: liegt die Belegsumme UEBER der Schaetzung, wurde der
positive Delta beim Zwangs-Settlement bedingungslos nachgebucht (4.6, obere Haelfte). Ein
zweites Settlement rechnete denselben Delta gegen denselben persistierten
`estimatedCostCents` erneut aus und buchte ihn ein zweites Mal - der Tenant zahlte zweimal.
Bedingung 5 nimmt genau diese Anrufe aus der Menge; uebrig bleibt die Zielmenge dieses
Fensters: die ueberschaetzten Anrufe, bei denen nach 4.6 ("Traeger nur vorlaeufig ->
nichts") nichts gebucht wurde und deshalb nichts doppelt gebucht werden kann.
Die Bedingung ist zum Zeitpunkt des Nachlaufs aus dem Zustand ableitbar, ohne einen
historischen Wert aufzubewahren: zwischen dem Zwangs-Settlement und diesem Nachlauf kann
sich keine EL-Belegzeile geaendert haben, weil die Reifung erst mit DIESER Phase existiert -
die neu gebildete Summe ist bitgleich die, gegen die damals gerechnet wurde.
**Bleibt eine Restmenge, benannt statt versteckt:** ein UNTERSCHAETZTER Anruf des Fensters
(Belegsumme ueber der Schaetzung) wird nicht wieder geoeffnet und behaelt seinen
Zwangs-Endzustand. Das ist die sichere Fehlrichtung - er wurde bereits auf mindestens den
belegten Ist-Betrag hochgebucht, und eine Reifung koennte ihn nur weiter erhoehen. Wer die
Symmetrie dennoch will, braucht ein persistiertes "wurde gebucht"-Datum am Settlement; das
ist eine Erweiterung von KV2-8, keine dieser Phase, und dieser Plan baut sie nicht.

**Abnahmekriterium (ohne echten Anruf).**
(a) Stub-Fetch liefert denselben Wert -> Zeile wird `belegt`, Abweichungszaehler bleibt 0.
(b) Stub-Fetch liefert einen HOEHEREN Wert -> Zeile wird `belegt` mit dem hoeheren Wert,
Abweichungszaehler +1, Anruf wird erneut faellig.
(c) Stub-Fetch liefert einen NIEDRIGEREN Wert -> der hoehere bleibt stehen,
Abweichungszaehler +1 (nach unten nur mit vollstaendiger Menge - und die Menge kann diesen
Wert nicht bestaetigen).
(d) HTTP 404 (Datensatz beim Anbieter geloescht, Abbruchweg) -> Zeile bleibt `vorlaeufig`,
Endzustand `beleg_strukturell_unbeschaffbar`, kein Wurf, kein Alarm.
(e) Drossel: bei 500 faelligen EL-Anrufen setzt ein Sweep hoechstens so viele Anfragen ab
wie die bestehende Kandidatenbegrenzung erlaubt - nicht 500. Bekannt ist nur eine untere
Schranke des Rate-Limits (25 Requests in wenigen Sekunden ohne 429, keine
Rate-Limit-Header in ueber 60 Antworten, BELEGT `befund-elevenlabs.md` 4); die reale Grenze
bleibt ungemessen.
(f) Der Abweichungszaehler ist in der Sweep-Zeile sichtbar - er IST die O3-Messung. Zeigt er
ueber N Anrufen 0 Abweichungen, ist O3 empirisch beantwortet und die Reifefrist kann gesenkt
werden; das ist dann eine Owner-Entscheidung, keine automatische.
(g) **Der zweite Phasenschnitt-Nachlauf (einmalig, s.o.):** Fixture mit Profil
`el_convai_sip`, `estimatedCostCents = 30`, `costTruedAt` gesetzt, Endzustand
`unvollstaendig_final`, genau eine `elevenlabs_convai`-Zeile `reife=vorlaeufig` und eine
Belegsumme unter 30 -> nach dem Nachlauf ist `costTruedAt === null` und der Anruf ist im
naechsten Sweep wieder Kandidat. Ein zweiter Durchlauf auf denselben Datensatz ist ein
No-Op. Vier Gegenproben, ohne die das Kriterium blind waere: ein Anruf im Endzustand
`beleg_strukturell_unbeschaffbar` (Abbruchweg) wird NICHT angefasst; ein Anruf mit bereits
`belegt`-EL-Zeile wird NICHT angefasst; ein Anruf ohne jede `elevenlabs_convai`-Zeile - die
Altzeile von vor der Kette - wird NICHT angefasst (den behandelt, falls ueberhaupt, der
Nachlauf aus KV2-7(g)); und ein sonst identischer Anruf mit einer Belegsumme UEBER
`estimatedCostCents` wird NICHT angefasst (Bedingung 5, Riegel gegen die doppelte Buchung).
(h) **Doppelbuchungs-Probe ueber den ganzen Weg:** ein Anruf des Fensters durchlaeuft
Zwangs-Settlement, Nachlauf (g), Reifung und zweites Settlement in EINEM Test; am Ende ist
`usage.costCents` genau einmal um den Delta der reifen Summe gegen `estimatedCostCents`
bewegt, nie zweimal, und `usage.costCorrectionMicroCentsRem` entspricht exakt dem Wert einer
EINMALIGEN Umrechnung dieser Summe (dieselbe Zusage wie KV2-8(d), jetzt ueber zwei
Settlements hinweg).

**Was diese Phase NICHT tut.** Sie aendert die Settlement-Arithmetik nicht. Sie holt keinen
Wert auf dem Abbruchweg (dort ist der Datensatz weg). Der Nachlauf (g) bucht nichts - er
setzt ausschliesslich `costTruedAt` zurueck und ueberlaesst jede Geldbewegung dem normalen
Settlement aus KV2-8.

**Abhaengigkeit.** KV2-8 - und zwar mit der oben benannten Vorbedingung: KV2-9 soll vor
Ablauf der ersten `COST_SETTLE_DEADLINE_HOURS` nach dem KV2-8-Deploy live sein. Wird das
verfehlt, ist der Nachlauf (g) die Absicherung; das ist Absicht und nicht Ersatz fuer die
Reihenfolge.

---

### KV2-10 - Zweiteiliger Tarif, deckungs-unabhaengiger Boden, Boot-Waechter

**Ziel.** Der Tarif hoert auf, eine Fortschreibung zu sein. Er wird gegen gemessene
Vollkosten geprueft, in einer Form, die die Kostenkurve trifft: Grundbetrag plus
Minutensatz je Route.

**"Vollkosten je Anruf" - der Begriff, ausgeschrieben, weil an ihm die Tarifhoehe haengt.**
Vollkosten je Anruf sind die Summe der BELEGZEILEN dieses Anrufs (`elevenlabs_convai`,
`telnyx_sip` bzw. `telnyx_call_records`) PLUS der auf demselben Anruf und Tenant gebuchten
EIGEN-Achsen, naemlich Katalogzeile #4 (`ai_token` - einschliesslich Vorab-Briefing,
Eroeffnungssatz und Zusammenfassung) und Katalogzeile #5 (`research_fee`). Die Eigen-Achsen
gehoeren dazu, weil sie auf dem EL-Weg NICHT entfallen: sie laufen ausserhalb der
Turn-Schleife und buchen auch dort auf die Gate-Achse (BELEGT am Code, 3.2 Zeile #4;
Abnahmebefund R9-2). Eine Stichprobe, die nur EL- und Telnyx-Werte enthaelt, ist damit
systematisch ZU NIEDRIG - und der daraus hergeleitete Tarif samt dem neu berechneten
`VOICE_TARIFF_FULL_COST_FLOOR_CENTS` laege systematisch UNTER den echten Vollkosten. Genau
das ist der Fehler, den diese Phase nicht machen darf, denn er ist in die falsche Richtung
sicher: er sieht nach Deckung aus.

**Warum der Tarif zweiteilig ist (Owner-Entscheidung 5, entschieden am 2026-08-30).** Die
Form ist entschieden, nicht mehr abzuwaegen; hier steht ihre Begruendung. Die EL-Kosten haben
einen grossen FIXEN Anteil je Anruf (Prompt-Cache-Write): der 8-Sekunden-Anruf kostete
0,0099 USD, der 76-Sekunden-Anruf 0,1333 USD (BELEGT AUFTRAG B2). Telnyx verschaerft es von
der anderen Seite, weil es IMMER auf die volle Minute aufrundet - `call_sec=35`,
`billed_sec=60`, und der 8-Sekunden-Anruf zahlt trotzdem 4,01 US-Cent (BELEGT
`befund-telnyx.md` O2). Die Eigen-Achsen ziehen in dieselbe Richtung: Briefing und
Eroeffnungssatz fallen je ANRUF an, nicht je Minute. Alle drei Effekte machen kurze Anrufe
pro Minute teuer. Der verworfene einzelne Minutensatz bildete das nicht ab, egal wie oft man
ihn nachzieht - er muesste den 8-Sekunden-Fall decken und ueberzahlte damit jeden langen
Anruf.

**Betroffene Dateien.** `src/billing/cost-calibration.js` (Stichprobe = gesettelte Anrufe
mit vollstaendigem Profil statt des einen `costTruedSource === DETAIL_RECORDS`-Werts, `:57`;
Rechnung je Route zusaetzlich zum Praefix; zweiter p95 auf Vollkosten JE ANRUF),
`src/boot-guard.js` (`voiceTariffFloorFindings`, `:249`), `src/config.js` / `.env.example`
(Grundbetrag je Route, Neuherleitung von `VOICE_TARIFF_FULL_COST_FLOOR_CENTS`,
Waehrungs-Klarstellung an `PLATFORM_FIXED_COST_CENTS_PER_MONTH`, s. Katalogzeile #8), Tests.

Der Boden bekommt eine zweite, DECKUNGS-UNABHAENGIGE Bedingung. Heute liefert
`voiceTariffFloorFindings` nur dann einen Befund, wenn `belowFloor` UND `thinCoverage` -
also der Tarif unter dem Boden liegt UND die Abgleich-Deckung unter der Schwelle
(`boot-guard.js:249-252`, BELEGT `angriff-kritiker.md` K6). Das Ziel der ganzen Kette ist,
die Deckung ueber die Schwelle zu heben. In dem Moment, in dem sie das erreicht, verstummt
der Boden-Waechter - auch bei einem Tarif unter Vollkosten. Eine Sicherung, die die eigene
Kette abschaltet, ist keine.

**Abnahmekriterium (ohne echten Anruf).**
(a) Stichprobe aus den 8 gemessenen EL-Anrufen als Fixture (EL-Werte aus AUFTRAG B2,
Telnyx-Werte aus `befund-telnyx.md` O2) - und die Fixture traegt zusaetzlich die auf
denselben Anrufen und Tenants gebuchten EIGEN-Achsen #4 (`ai_token`, einschliesslich
Briefing, Eroeffnungssatz und Zusammenfassung) und #5 (`research_fee`), nach dem
Vollkostenbegriff oben. Der Report schlaegt daraus ein Paar aus Grundbetrag und Minutensatz
vor, das alle acht am p95 deckt. Gegenprobe im selben Test, damit das Kriterium nicht
tautologisch gruen ist: dieselbe Fixture OHNE die Eigen-Achsen ergibt ein nachweislich
NIEDRIGERES Paar - genau die Unterschaetzung, die R9-2 benennt. Eine Stichprobe nur aus EL-
und Telnyx-Werten wird ausdruecklich NICHT als Vollkosten-Stichprobe akzeptiert.
(b) Eine Stichprobe mit unvollstaendigen Belegmengen wird NICHT als Stichprobe akzeptiert -
eine unvollstaendige Menge ist systematisch zu niedrig und liesse den Waechter gegen seine
eigene Datenluecke alarmieren.
(c) Fixture mit Deckung 100 % und Tarif unter dem Boden erzeugt einen Befund - der Test, der
heute fehlschlaegt.
(d) Ein `underestimate`-Befund nennt das konkrete Zahlenpaar und geht ueber den Kanal aus
KV2-1 raus; ein gedeckter Tarif erzeugt keinen Kanal-Laerm.
(e) Der Boot-Waechter feuert beim Start, nicht erst beim naechsten Sweep.

**Was diese Phase NICHT tut.** Sie justiert nichts automatisch. Die Owner-Entscheidung vom
2026-07-20 ("keine rollende Selbstkalibrierung; ein Tarif, der sich aus Anrufen speist, die
das Gate durchgelassen hat, ist eine Rueckkopplung", `cost-calibration.js:1-8`) bleibt
unangetastet. Der Waechter misst und alarmiert, der Eigentuemer setzt die Werte. Sie aendert
auch die Reserve-Formel nicht - nur die Zahlen, die hineingehen, sofern der Eigentuemer sie
setzt.

**Abhaengigkeit.** KV2-9 (erst dort gibt es vollstaendig belegte EL-Anrufe als Stichprobe).
Owner-Vorbedingung: keine offene mehr. Entscheidung 5 (Tarifform) und Entscheidung 6 (kein
automatisches Anheben) sind am 2026-08-30 GETROFFEN - zweiteiliger Tarif aus Grundbetrag und
Minutensatz je Route; keine automatische Justierung, der Waechter misst und alarmiert, die
Zahl setzt ein Mensch (Abschnitt 7). Das ist damit Vorgabe, nicht Default, und der
Phasenbericht fuehrt beides als Entscheidung.

---

## 6. Pre-Mortem: 30. August 2027, die Umstellung ist gescheitert

### 6.1 "Der EL-Beleg blieb leise weg, und wir haben still zu wenig gebucht."
Ein Anbieter-Feldname aendert sich, die Belegzeile entsteht nicht mehr, das Settlement laeuft
mit Teilsumme.
**Gegenmassnahme:** der Herzschlag `kosten:erfassung-tot:elevenlabs_convai` (KV2-6) meldet
binnen 6 Stunden, unabhaengig von jeder Faelligkeit. Zusaetzlich sind "keine Zeile" und
"Betrag 0" verschiedene Zustaende (4.6) - ein fehlendes Feld erzeugt keine Null-Zeile.

### 6.2 "Eine 0 wurde zum Vollbeleg, und wir haben monatelang erstattet."
ElevenLabs erweitert das Freikontingent oder wechselt die Plan-Stufe, `cost_fiat` steht auf
0 fuer angenommene Gespraeche.
**Gegenmassnahme:** die 0 ist nur dann ein Beleg, wenn die Mengenangabe des Belegs selbst 0
ist (`call_duration_secs` bzw. `billed_sec`). Sonst: kein Beleg, WARN, Befund (4.6, KV2-4b).

### 6.3 "Die Schaetzung wurde auf einen halben Beleg heruntergesetzt." (B6, ein Jahr spaeter)
**Gegenmassnahme:** `dataComplete` misst gegen das PROFIL, nicht gegen die eingetroffene
Menge; leere oder unbekannte Pflichtmenge ist NIE Vollstaendigkeit; der B6-Test in KV2-5(a)
und der Vakuositaets-Test in KV2-8(b) werden rot, sobald jemand abkuerzt.

### 6.4 "Ein neuer Anbieter kam dazu, und niemand hat an die Kosten gedacht."
Der 19.08.-Fehler wiederholt sich mit dem naechsten Umstieg.
**Gegenmassnahme:** das Profil sitzt an der ENGINE-WEICHE, nicht an der Anruferzeugung
(4.3) - genau dort, wo der 19.08. stattfand. Der Inventar-Test in KV2-2(c) bindet alle
FUENF Weichen-Zweige und faehrt den Inbound-Pfad in BEIDEN Stellungen von `VOICE_ENGINE`.
Damit ist auch der billigste Anbieter-Wechsel abgedeckt, den es gibt: der Flip eines
Env-Werts auf eine zweite, laengst verdrahtete Engine (`bridge.js:164-167`,
Katalogzeile #14).
**Zweite, gleichrangige Gegenmassnahme - denn die Weiche allein reicht nicht:** eine
Anbieter-Ausgabe muss nicht an der Engine-Weiche haengen, um zu entstehen. Die
Zusammenfassungs-Mail (Katalogzeile #16) haengt am ANRUFENDE (`call-finish.js:142`), nicht
an der Weiche; kein Profil und kein Weichen-Test der Phase KV2-2 haette sie je erwaehnt. Sie
ist in diesem Plan nur deshalb sichtbar, weil der Katalog aus Abschnitt 3 unabhaengig von
den Profilen gefuehrt wird und Vollstaendigkeit ausdruecklich einfordert (3.). Daraus die
verbindliche Regel: **jede neue Anbieter-Ausgabe bekommt eine Katalogzeile, bevor sie live
geht** - auch, wenn sie kein Anruf-Profil beruehrt. Die gepinnte Zeilenmenge in KV2-2(d)
schuetzt gegen Loeschen, nicht gegen Vergessen; die Regel hier ist der Schutz gegen
Vergessen.
**Restrisiko, akzeptiert:** jemand traegt einen neuen Zweig in ein BESTEHENDES Profil ein,
dessen Traegerliste nicht passt. Der Test faengt das Fehlen, nicht die Falschzuordnung.
Sichtbar wuerde es am Herzschlag (Belege fuer einen Traeger, den es auf diesem Zweig nicht
gibt, kommen nie) - also laut, aber erst nach 6 Stunden.

### 6.5 "Ein Anruf konnte gar nicht mehr stattfinden."
Die Kehrseite eines fail-closed-Gates an der Anruferzeugung - in Entwurf A vorhanden, in
dessen eigenem Pre-Mortem nicht einmal erwaehnt (`angriff-cleancode.md` Befund 1).
**Gegenmassnahme:** der Schreibweg lehnt NIE einen Anruf ab. Fehlt das Profil, entsteht der
Anruf, es gibt eine WARN-Zeile und einen Befund; fail-closed ist ausschliesslich das
Settlement (4.3). Die schlechteste Folge eines Fehlers in dieser Kette ist "kein Refund",
niemals "kein Anruf". Abnahmekriterium KV2-2(b) pinnt genau das.

### 6.6 "Die Kostendecke hat spaeter gesperrt, als sie sollte."
Eine positive Nachbuchung aus einer abgelaufenen Periode erreicht die Perioden-Achse nicht
mehr. `budgetExceeded` liest `gateUsageCents` (`state-ops.js:4011` -> `:3966-3975`), also
die aufgeloeste PERIODEN-Groesse; Verbrauch, der sie nicht erreicht, sieht die Decke nie
(BELEGT `angriff-premortem.md` 1.2).
**Gegenmassnahme:** die Symmetrie wird NICHT stillschweigend gebaut. Default ist das heutige
Verhalten (`bookCents` ignoriert `chargeAnchors`, die laufende Periode wird belastet - die
sichere Fehlrichtung, BELEGT `befund-gate.md` 2). Owner-Entscheidung 2 hat dieses Verhalten
am 2026-08-30 ausdruecklich BESTAETIGT; die symmetrische Variante ist verworfen, eine
Aenderung waere ein neuer Auftrag.
Die Groessenordnung ist begrenzt: die Schaetzung selbst wird beim Anrufende in der richtigen
Periode gebucht (`reconcileVoiceBudget`, `src/telephony/call-finish.js:263`, IMMER), es
wandert nur der Korrektur-Delta.

### 6.7 "Der Alarm kam, aber niemand hat ihn gesehen." (B3, ein Jahr spaeter)
**Gegenmassnahme:** durabler Audit-Eintrag statt `console.log`, Mail als primaerer Kanal
(der SMS-Kanal laeuft ueber DASSELBE Telnyx-Konto wie das, was ausfallen kann - "ein Alarm,
den derselbe Defekt mitreisst, ist keiner", `outage-report.js` Modulkopf), durabler Marker
statt prozesslokalem Zaehler, bestehendes Entprellungsmuster gegen Ermuedung, laufender
Kanal-Selbsttest.
**Restrisiko, akzeptiert:** `sendeUeberBeideKanaele` wertet "kein Ziel konfiguriert" als
zugestellt (`outage-report.js:84`, BELEGT). Diese Semantik gehoert dem Ausfall-Melder und
wird von dieser Kette nicht geaendert; stattdessen pinnt KV2-1(d)/(e) den Empfaenger als
Vorbedingung. Eine Mail, die im Spam landet, bleibt genauso still - der Selbsttest deckt
den Versand, nicht den Empfang.

### 6.8 "Zwei Instanzen haben doppelt gebucht."
Der Laufriegel ist ausdruecklich PROZESS-LOKAL, und der Bestandskommentar sagt es selbst:
"Render laeuft mit EINER Instanz ... DIESE VORAUSSETZUNG FAELLT BEIM ERSTEN
SKALIERUNGSSCHRITT (2. Instanz) - dann ist der Riegel wirkungslos und muss ersetzt werden"
(`cost-truing.js:21-24`); `withStoreLock` ist ebenfalls prozesslokal (`src/store.js:376-386`),
beides BELEGT.
**Akzeptiertes Risiko, weil** der Dienst heute mit einer Instanz laeuft und ein
verteilter Riegel eine eigene Kette waere. Der Weg ist benannt: `costTruedAt` wird als
Vergleichs-und-Setze in DERSELBEN Anweisung geschrieben, in der gebucht wird
(`UPDATE ... WHERE cost_trued_at IS NULL`). Die Einmal-Buchung dieser Architektur ist dabei
deutlich weniger exponiert als eine inkrementelle: ein read-modify-write auf einem
Fortschreibungsfeld waere bei zwei Instanzen sicher falsch. **Vor dem ersten
Skalierungsschritt ist dieser Punkt zu schliessen, nicht danach.**

### 6.9 "Der Umrechnungskurs war ein Jahr alt, und alles sah trotzdem konsistent aus."
`PROVIDER_TO_BUCKET_RATE_MICRO` (`config.js:1040`) ist ein statischer Env-Wert ohne
Aktualisierungspfad; der Boot-Guard prueft nur ein Toleranzband gegen den Tippfehler "920
statt 920000", nicht die Aktualitaet (BELEGT `angriff-premortem.md` 2.5). Nach dieser
Umstellung haengen an genau diesem Wert: die Gate-Buchung, der neu hergeleitete Tarif, der
Vollkosten-Boden und die Drift-Befunde - ein um 10 % veralteter Kurs verschiebt alle vier
gleichzeitig in dieselbe Richtung, und weil sie sich gegenseitig bestaetigen, sieht das
Ergebnis konsistent aus.
**Akzeptiertes Risiko, weil** ein automatischer Kursbezug eine eigene Abhaengigkeit und
einen eigenen Ausfallmodus waere. Gegenmassnahme in Reichweite: die Sweep-Zeile und der
Drift-Report nennen den verwendeten Kurs mit, damit er bei jeder Auswertung im Blick ist -
das ist Teil der Ausgabe in KV2-10.

### 6.10 "Ein Deploy mitten im Gespraech hat beide Belege verschluckt."
Die Boot-Reihenfolge ist `lifecycle.rearmActiveCallTimers()` VOR
`elevenLabsOutbound.rearmActiveConversationPolls()` (`src/boot.js:1180` bzw. `:1207`,
BELEGT); der erste Schritt terminalisiert jeden aktiven Anruf, dessen Restzeit abgelaufen
ist. War die Ausfallzeit laenger als die Max-Gespraechsdauer, ist der EL-Anruf danach nicht
mehr `active`, der Ergebnisabruf wird nicht mehr scharf gemacht - kein `cost_fiat`, kein
`sip_call_id`, beide Traeger fehlen dauerhaft. Das Bild ist ununterscheidbar vom Ausfall
des 19.08.
**Gegenmassnahme:** solche Anrufe landen in `beleg_strukturell_unbeschaffbar`, zaehlen
nicht in die Deckungsquote (KV2-6c) und erzeugen keinen Dauer-Alarm - aber sie erscheinen in
einer eigenen, benannten Zaehlzeile. **Woran sie erkannt werden, steht als eigenes
Abnahmekriterium in KV2-7(h)** und nicht nur als Zusage hier: Profil `el_convai_sip`,
`endedAt` gesetzt, `elevenlabsConversationId` vorhanden, `sipCallId === null` und keine
`call_cost_evidence`-Zeile - alles am Anruf-Datensatz, ohne Deploy-Zeitstempel. Der Weg ueber
den Beleg, den KV2-7(e) fuer den Abbruchweg pinnt, traegt hier NICHT: im 6.10-Fall laeuft
`persistProviderResult` nie, es gibt also gar keinen Beleg, der den Marker halten koennte. Damit ist "Erfassung kaputt" von "Beleg
strukturell unbeschaffbar" unterscheidbar. Ohne diese Trennung ist der Kanal nach dem
dritten Fehlalarm tot - nicht technisch, sondern beim Empfaenger.
**Restrisiko, akzeptiert:** die Schaetzung bleibt fuer diese Anrufe stehen. Der Tenant zahlt
sie, auch wenn sie zu hoch war. Sichere Richtung, aber sichtbar.

### 6.11 "Ein Anruf ohne `endedAt` ist aus beiden Buechern und aus der Kennzahl verschwunden."
`isEndedCall` ist false (`cost-truing.js:137`), und `coverageBucketOf` setzt `answeredAt`
und `estimatedCostCents` voraus (`:161-170`) - ein Zombie-Leg zaehlt nicht einmal im Nenner
(BELEGT `angriff-premortem.md` 2.4). Kein Entwurf hatte dafuer eine Zeile.
**Gegenmassnahme:** KV2-6(d) fuehrt eine eigene Zaehlzeile "nie beendet". Sie behebt den
Zustand nicht, aber sie macht ihn zu einer Zahl statt zu einer Leerstelle.

### 6.12 "Die Pflicht-Belegtypen waren geraten, und es gab nie eine Erstattung."
`COST_TRUING_REQUIRED_RECORD_TYPES` steht live auf `sip-trunking,call-control` und
entscheidet global ueber die Vollstaendigkeit (`cost-truing.js:322-330`). Ob der EL-Weg je
einen `call-control`-Beleg liefert, ist UNGEMESSEN.
**Gegenmassnahme:** die Pflicht-Typmenge wird JE PROFIL gefuehrt, und die Messung ist
Abnahmekriterium von KV2-5(d) - keine Bitte in einem Fliesstext, sondern ein Test, der ohne
sie nicht gruen wird.

### 6.13 "Die Kette wurde auf halbem Weg abgebrochen."
**Gegenmassnahme durch Reihenfolge:** bleibt sie nach KV2-6 stehen, sammelt und meldet das
System korrekt und bucht weiter wie heute - harmlos. Bleibt sie nach KV2-8 stehen, buchen
wir korrekt, aber ohne EL-Erstattungen (jede EL-Zeile bleibt `vorlaeufig`) - die sichere
Richtung. Deshalb steht die Beobachtung VOR dem Geld-Umschalter und die Reifung DAHINTER.
**Der Abbruch ist nicht der einzige Fall - das blosse VERWEILEN zwischen KV2-8 und KV2-9 hat
denselben Effekt, nur befristet:** laeuft in diesem Fenster die Frist ab, werden EL-Anrufe
mit `vorlaeufig`-Zeile zwangs-gesettelt und behielten die zu hohe Schaetzung (rund 30
EUR-Cent gegen rund 15 US-Cent Ist). Das ist benannt und mit zwei Massnahmen gedeckt -
Vorbedingung plus zweiter einmaliger Nachlauf, beides in KV2-9 - und deshalb KEIN
akzeptiertes Restrisiko, sondern ein behandelter Fall.

### 6.14 "Ein Tenant wurde geloescht, die Anbieter-Rechnung blieb."
`call_cost_evidence` haengt an `tenant_id` mit FK und RLS; ein Loeschen nimmt die Belege mit,
waehrend die Rechnung des Anbieters bleibt (`angriff-kritiker.md` Teil 3.4).
**Akzeptiertes Risiko, weil** die Monats-Gegenprobe je Traeger (KV2-8f) den Fehlbetrag als
Differenz sichtbar macht, ohne dass personenbezogene Daten aufbewahrt werden muessen. Der
Prototyp existiert bereits: der 13. Telnyx-Beleg vom 19.08.
(`otb_8601m0cgxdvcepzrdg7yd8v8fye1`, `billed_sec=120`, `cost=0.0802`), der zu keinem unserer
12 DB-Anrufe gehoert (BELEGT `befund-telnyx.md`, Ueberraschung 2). Eine anrufbezogene
Struktur kann solche Belege grundsaetzlich nicht fassen - sie werden gezaehlt, nicht
zugeordnet.

---

## 7. Eigentuemer-Entscheidungen

Nur Punkte, die niemand technisch entscheiden kann. Je Punkt eine Empfehlung und darunter,
was aus ihr geworden ist. Getroffene Entscheidungen bleiben mit Datum stehen, aber als
Protokoll gekennzeichnet - eine geloeschte Entscheidung waere spaeter nicht von einer nie
gestellten Frage zu unterscheiden. Aus demselben Grund bleibt bei jedem Punkt die verworfene
oder nicht gewaehlte Variante samt ihren Folgestellen ausgeschrieben stehen: eine spaetere
Session muss den Punkt wieder aufmachen koennen, ohne ihn neu herzuleiten.

**Stand 2026-08-30.** Ausdruecklich vom Eigentuemer entschieden sind die Punkte 1 bis 9 und
Punkt 13 - alle der jeweiligen Empfehlung folgend (Punkt 9 bereits frueher am selben Tag).
Zu den Punkten 10, 11, 12, 14, 15 und 16 gibt es KEINE ausdrueckliche Entscheidung; sie
laufen auf dem jeweils dort benannten Default und sind einzeln so gekennzeichnet. Ein
uebernommener Default ist ausdruecklich KEINE getroffene Entscheidung: er ist die Ansage,
dass die Kette ohne Antwort weiterlaufen darf, und er ist jederzeit umkehrbar, ohne dass
jemand die Abwaegung neu herleiten muesste. Wo eine Phase einen dieser Punkte als
Vorbedingung fuehrt, vermerkt ihr Phasenbericht ihn weiterhin als Default, nicht als
Entscheidung.

**1. Kosten-Buch oder Erloes-Buch? - ENTSCHIEDEN 2026-08-30.** Der Auftragswortlaut verlangt "beide Buecher".
`usage_event` ist aber die Stripe-Meter-Quelle, und jedes `kind` wird gemeldet (BELEGT
3.1) - Lieferantenkosten dort waeren eine Kundenrechnung.
*Empfehlung: eigenes Kosten-Buch (`call_cost_evidence`), `usage_event` bleibt das
Erloes-Buch.* Das vermeidet die Allowlist-Konstruktion, die Pending-Blindheit und den
Ganzzahl-Rundungsbruch.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: eigenes Kosten-Buch
`call_cost_evidence`.** `usage_event` bleibt das reine Erloes-Buch und nimmt keine
Lieferantenkosten auf. **Verworfen** ist damit die Variante, die Lieferantenkosten als
weitere `USAGE_EVENT_KIND` in `usage_event` mitzufuehren - mitsamt der Allowlist, die die
Stripe-Meldung dann haette einschraenken muessen. Der Punkt gilt nicht mehr als offen; die
Bauform steht in KV2-3.

**2. Positive Nachbuchung ueber einen Perioden-/Monatswechsel - ENTSCHIEDEN 2026-08-30.**
Heute belastet sie die
laufende Periode, weil `bookCents` `chargeAnchors` nicht liest (BELEGT `befund-gate.md` 2) -
ungenau gegen den Eigentuemer-Wortlaut, aber die sichere Fehlrichtung. Symmetrisch zur
Gutschrift waere genauer, sperrt aber schwaecher, und die Sperrwirkung gehoert zu einem
geschuetzten Gate.
*Empfehlung: heutiges Verhalten beibehalten.* Erst aendern, wenn die Ungenauigkeit real
messbar stoert.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: das heutige Verhalten bleibt.**
Eine positive Nachbuchung belastet weiter die laufende Periode; `bookCents` liest
`chargeAnchors` nicht, und keine Phase dieser Kette aendert das. **Verworfen** ist die
symmetrische Variante (Nachbuchung wie die Gutschrift auf die Periode des Anrufs ankern) -
sie waere genauer, sperrt aber schwaecher, und die Sperrwirkung gehoert zu einem
geschuetzten Gate. Wird die Ungenauigkeit spaeter messbar, ist das ein neuer Auftrag, keine
Fortsetzung dieser Kette.

**3. Frist bis zum Zwangs-Settlement - ENTSCHIEDEN 2026-08-30.** Kuerzer heisst frueher sichtbar und mehr
unvollstaendige Settlements; laenger heisst mehr Vollbelege und spaeteren Zwangsabschluss.
Randbedingungen: Sweep stuendlich, Telnyx-Belegfenster 7 Tage
(`PROVIDER_COST_RECORD_WINDOW_DAYS`, `cost-truing.js:119`).
*Empfehlung: 48 Stunden.* Der "binnen Stunden"-Anspruch haengt am Herzschlag (6 Stunden),
nicht an der Frist - die Frist darf deshalb grosszuegig sein.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: 48 Stunden.**
`COST_SETTLE_DEADLINE_HOURS` wird in KV2-7 mit dem Wert 48 angelegt. **Verworfen** sind
beide Randlagen: eine kuerzere Frist (frueher sichtbar, aber mehr unvollstaendige
Settlements) und eine laengere (mehr Vollbelege, aber spaeterer Zwangsabschluss). Der Wert
bleibt ein Konfigurationswert, kein einbetonierter Literalwert - er ist ohne neue
Entscheidung nachziehbar, sobald die Deckungsquote aus KV2-6 eine bessere Zahl hergibt.

**4. Anruf ohne Vollbeleg nach Fristablauf - ENTSCHIEDEN 2026-08-30.** Der Tenant traegt
die Schaetzung weiter, oder
es gibt eine Kulanz-Gutschrift ohne Beweis.
*Empfehlung: der Tenant traegt die Schaetzung.* Eine Gutschrift ohne Beweis weicht genau
die Asymmetrie auf, die die ganze Architektur traegt. Die Ueberzahlung wird ueber die
Zaehlzeile "unvollstaendig" sichtbar - wenn sie systematisch wird, ist das ein Signal, kein
Kulanzfall.
*Abgrenzung, damit diese Entscheidung nicht mehr deckt, als sie soll:* sie gilt fuer Anrufe,
deren Beleg beim ANBIETER ausgeblieben ist. Sie deckt NICHT den Fall, dass ein Beleg
vorliegt und nur unsere Kette ihn noch nicht reifen kann - das Fenster zwischen dem KV2-8-
und dem KV2-9-Deploy. Dieser Fall ist kein Kulanzthema, sondern ein Phasenschnitt, und er
wird in KV2-9 mit Vorbedingung und einmaligem Nachlauf behandelt (s. dort und 6.13).
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: der Tenant traegt die
Schaetzung.** **Verworfen** ist die Kulanz-Gutschrift ohne Beweis; es gibt keine Erstattung
ohne Vollbeleg. Die Ueberzahlung bleibt ueber die Zaehlzeile "unvollstaendig" sichtbar -
wird sie systematisch, ist das ein Signal an den Eigentuemer und kein Kulanzfall. Die
Abgrenzung des Absatzes darueber bleibt Bestandteil der Entscheidung: sie deckt NICHT das
Fenster zwischen dem KV2-8- und dem KV2-9-Deploy.

**5. Zweiteiliger Tarif (Grundbetrag plus Minutensatz) oder ein einzelner, hoeherer
Minutensatz - ENTSCHIEDEN 2026-08-30.** Der Zweiteiler trifft die gemessene Kostenkurve (fixer EL-Anteil plus
Telnyx-Minutenaufrundung); er aendert aber die Reserve und damit, was ein Kunde vor dem
Anruf sieht.
*Empfehlung: zweiteilig.* Ein einzelner Satz muss den 8-Sekunden-Fall decken und ueberzahlt
damit jeden langen Anruf.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: zweiteiliger Tarif - Grundbetrag
je Anruf plus Minutensatz, je Route.** **Verworfen** ist der einzelne, hoehere Minutensatz.
KV2-10 leitet damit ein Zahlenpaar her, keinen Einzelwert; die Begruendung steht dort unter
"Warum der Tarif zweiteilig ist". Was sich dadurch fuer den Kunden aendert - Reserve und
Vorab-Anzeige zeigen ab dann Grundbetrag plus Minutensatz -, ist Teil der Entscheidung und
kein Nebeneffekt.

**6. Automatisches Anheben des Tarifs (nie Senken) - ENTSCHIEDEN 2026-08-30.** Waere die
einzige Variante ohne
Owner-Handgriff, beruehrt aber die Owner-Entscheidung vom 2026-07-20 gegen rollende
Selbstkalibrierung (`cost-calibration.js:1-8`).
*Empfehlung: nein.* Die Begruendung von 2026-07-20 traegt unveraendert: ein Tarif, der sich
aus Anrufen speist, die das Gate durchgelassen hat, ist eine Rueckkopplung. Der Waechter
misst und alarmiert; die Zahl setzt ein Mensch.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: NEIN, kein automatisches
Anheben.** Die Owner-Entscheidung vom 2026-07-20 gegen rollende Selbstkalibrierung
(`cost-calibration.js:1-8`) bleibt unangetastet. **Verworfen** ist die automatische
Justierung in jeder Richtung. KV2-10 baut deshalb einen Waechter, keinen Regler: er misst,
nennt das konkrete Zahlenpaar und alarmiert ueber den Kanal aus KV2-1 - gesetzt wird die
Zahl von einem Menschen.

**7. Die 12 EL-Altanrufe vom 19.-30.08. rueckwirkend korrigieren? - ENTSCHIEDEN
2026-08-30.** Wir haben zu VIEL
gebucht: 270 EUR-Cent Schaetzung gegen 56,28 US-Cent EL plus 32,69 US-Cent Telnyx (BELEGT
AUFTRAG B2, `befund-telnyx.md` O2). Eine Erstattung braeuchte Vollbelege, die fuer die
abgebrochenen Anrufe nicht mehr zu beschaffen sind, und sie beruehrt abgeschlossene
Perioden - mit der Anker-Asymmetrie aus Punkt 2.
*Empfehlung: nicht nachbuchen, stattdessen ein einmaliger Forensik-Report.* Alle
betroffenen Accounts sind unsere eigenen (Projektstand "noch nicht gelauncht").
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: NEIN, keine rueckwirkende
Korrektur.** Es bleibt bei einem einmaligen Forensik-Report ueber die 12 Anrufe.
**Verworfen** ist die rueckwirkende Nachbuchung - sie braeuchte Vollbelege, die fuer die
abgebrochenen Anrufe nicht mehr zu beschaffen sind, und sie beruehrte abgeschlossene
Perioden. Daraus folgt unmittelbar, dass der Buchungspfad fuer diese 12 Zeilen gesperrt
werden MUSS (Riegel, KV2-5(h)); allein die BAUFORM dieses Riegels ist offen und steht als
Punkt 14.

**Wo der Forensik-Report entsteht (Abnahmebefund, 2026-08-30):** er ist eine Ausgabe von
**KV2-5** - dort macht der `sipCallId`-Join die 12 Anrufe erstmals adressierbar, und dort
sitzt ohnehin der Riegel KV2-5(h), der sie vom Buchungspfad fernhaelt. Der Report ist eine
reine Lese-Ausgabe (Datei unter `tasks/`, kein Store-Schreibzugriff, kein Cent) und nennt
je Anruf: Kennung, Dauer, gebuchte Schaetzung, ElevenLabs-Ist und Telnyx-Ist. Datenquellen
sind `tasks/kostenv2/AUFTRAG.md` B2 (ElevenLabs, 56,28 US-ct ueber 8 Anrufe) und
`tasks/kostenv2/befund-telnyx.md` O2 (Telnyx, 32,69 US-ct). Ohne diese Verortung haette die
Entscheidung keinen Ort, an dem sie eingeloest wird - der Riegel allein ist nur ihre
Haelfte.

**8. Umlage der Plattform-Fixkosten - ENTSCHIEDEN 2026-08-30** (ElevenLabs-Grundgebuehr 600 US-ct/Monat, DID-Miete,
TTS-Kontingent, Stripe-Transaktionsgebuehr, Infrastruktur).
*Empfehlung: nicht auf Tenants umlegen.* Ein fester Betrag durch Tenants geteilt macht die
Kostendecke eines Tenants abhaengig vom Verhalten der anderen und widerspricht dem
Eigentuemer-Wortlaut direkt. Sie bleiben Preisbildungs-Eingaben und stehen sichtbar im
Katalog (3.3).
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: NEIN, keine Umlage auf
Tenants.** Die Plattform-Fixkosten bleiben Eingaben der Preisbildung und stehen sichtbar im
Katalog (3.3). **Verworfen** ist jede Umlage - insbesondere die naheliegende "fester Betrag
geteilt durch Tenants", die die Kostendecke eines Tenants vom Verhalten der anderen abhaengig
gemacht haette. Abschnitt 8 Punkt 3 fuehrt das als ausdrueckliche Nicht-Leistung dieser
Kette.

**9. Den OpenAI-Realtime-Traeger (#14) bauen oder nur katalogisieren? - ENTSCHIEDEN
2026-08-30, nicht mehr offen.** Der Schalter
`VOICE_ENGINE` steht live auf `budget` (BELEGT `render.yaml:651-652`), der Realtime-Pfad kostet
heute also nichts. Kippt der Schalter, oeffnet `bridge.js:164-167` je Anruf eine
kostenpflichtige OpenAI-Sitzung, die in KEINEM Buch und auf KEINER Gate-Achse landet
(BELEGT: kein `bookCents`/`trackUsage`/`recordUsageEvent` in `bridge.js`, 0 Treffer;
`REALTIME_MID_CALL_BUDGET_CHECK = false`, `bridge.js:44`; Boot-Befund
`realtime_no_midcall_budget`, `boot-guard.js:708`). **ENTSCHIEDEN am 2026-08-30 (Owner):** OpenAI Realtime wird bis auf Weiteres NICHT
verwendet - Wortlaut: "spielt erstmal keine Rolle, haben nicht vor das zu verwenden". Damit
gilt Variante *(a) nur katalogisieren*: der Traeger steht im Katalog (Zeile #14), das Profil
`telnyx_inbound_realtime` fuehrt ihn als `nicht_belegpflichtig`, es wird KEIN Einsammler
gebaut und keine Phase dafuer geoeffnet. Die verworfene Variante war *(b) bauen* - ein
eigener Beleg-Einsammler je Realtime-Sitzung plus Buchung auf die Gate-Achse, als eigene
Phase nach KV2-10.
**Was aus der Entscheidung NICHT folgt: die Katalogzeile zu streichen.** "Wird nicht
verwendet" ist nicht "ist nicht einschaltbar" - `VOICE_ENGINE=realtime` bleibt ein
erreichbarer Schalter, und `bridge.js` bucht nichts. **Wer den Schalter umlegt, schaltet
einen ungebuchten Kostentraeger scharf.** Deshalb gehoert zur Entscheidung ein Riegel:
Abnahmekriterium KV2-2(h) meldet den Zustand beim Boot, nach dem Muster der bestehenden
Boot-Gates und ohne eigene Bauphase. Der bestehende Befund `realtime_no_midcall_budget`
ersetzt ihn nicht - der benennt die fehlende Mid-Call-Bremse, nicht die fehlende Buchung.
Wird die Engine je wieder ein Thema, ist DAS der Moment, in dem der Einsammler als eigene
Phase nach KV2-10 dazukommt; die Reihenfolge KV2-1..KV2-10 wird dafuer nicht umsortiert.
Dieser Punkt steht nur noch als Protokoll hier, nicht mehr als offene Frage.

**10. Wo bekommt der Outbound-TeXML-Zweig sein Profil, wenn die Engine erst im Webhook
feststeht? - DEFAULT UEBERNOMMEN 2026-08-30, nicht ausdruecklich entschieden.**
`api-calls.js` verzweigt im TeXML-Fall nicht auf die Engine (`else`-Zweig ab
`:394`, einziger Engine-Unterschied ist der Timer-Guard `:409`); die Weiche faellt erst bei
`voice.js:476` - also nach der Anruferzeugung (alle BELEGT, in dieser Session gelesen).
Damit deckt `telnyx_budget` zwei Engines ab, dieselbe Luecke, die auf dem Inbound-Pfad durch
zwei Profile geschlossen wird. Beide Wege bleiben offen:
*(a) im Webhook nachschreiben* - das Profil wird bei `voice.js:476` je Zweig gesetzt,
set-once, erster Schreiber gewinnt; Preis: das Profil ist zwischen Originate und erstem
Webhook kurz leer, und ein nie zugestellter Webhook laesst es dauerhaft leer (Befund
`profil_fehlt`, 4.6 - kein Anruf wird abgelehnt).
*(b) in `api-calls.js` aus `config.voice.voiceEngine` ableiten* - das Profil steht sofort;
Preis: die Ableitung sitzt wieder NICHT an der Weiche, sondern liest denselben Schalter ein
zweites Mal - genau das Muster, das 4.3 verwirft, und es geht schief, sobald die
Engine-Wahl je pro Anruf faellt statt global.
*Empfehlung: (a), im Webhook nachschreiben.* Sie haelt die Regel "das Profil entsteht dort,
wo die Engine entschieden wird" ueber alle Pfade durch, und ihr Fehlerfall ist der bereits
gebaute (`profil_fehlt` -> kein Settlement, kein Refund, nie "kein Anruf").
**DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden: der Default dieses
Punktes, also `telnyx_budget` unveraendert lassen.** Die Kette laeuft ohne den
Webhook-Nachschreibweg; die Empfehlung (a) bleibt die Empfehlung und ist jederzeit ohne
Neuherleitung nachholbar - sie aendert dann KV2-2 (Profil-Setzstelle, sechster Zweig in
Kriterium (c)) und sonst nichts an der Reihenfolge. Solange der Default gilt, deckt
`telnyx_budget` beide Engines ab, und dieser Plan behauptet nicht, dass der Outbound-Pfad
unter `VOICE_ENGINE=realtime` vollstaendig abgedeckt waere.
**Die Restluecke ist durch Punkt 13 geschlossen - deshalb steht hier kein scharfes Risiko
mehr.** Wie schwer die Restluecke wiegt, entscheidet die Haerte des Boot-Riegels, und die ist
am 2026-08-30 auf `fatal` ENTSCHIEDEN (Punkt 13(a)): der Prozess startet mit
`VOICE_ENGINE=realtime` gar nicht, solange `openai_realtime` keinen Einsammler hat. Damit
kann kein Anruf die Luecke ausloesen - sie ist unerreichbar, nicht nur unwahrscheinlich.
Uebrig bleibt genau das, als was dieser Punkt gemeint war: eine Genauigkeitsfrage an der
Profil-Setzstelle. Das ausgeschriebene Fehlerbild ("scharf und still", je Outbound-TeXML-Anruf
eine ungebuchte OpenAI-Sitzung) steht weiter in Punkt 13 - es gilt ausschliesslich fuer den
Fall, dass jemand 13 spaeter auf (b) dreht, und dann ist (a) hier Pflicht, nicht Empfehlung.

**11. Bekommt `telnyx_call_records` einen eigenen Belegeinsammler, oder settlen die
Bestandsprofile dauerhaft ueber den Bestandspfad? - DEFAULT UEBERNOMMEN 2026-08-30, nicht
ausdruecklich entschieden.** `telnyx_call_records` ist Pflicht-Traeger
von VIER der fuenf Profile (`telnyx_budget`, `telnyx_assistant`, `telnyx_inbound_budget`,
`telnyx_inbound_realtime`, KV2-2), und 4.5 misst `dataComplete` als "jeder Pflicht-Traeger
des Profils hat eine Zeile mit `reife=belegt`". In der urspruenglichen Fassung dieses Plans
legte KEINE Phase je eine solche Zeile an - KV2-4 schreibt `elevenlabs_convai`, KV2-5
schreibt `telnyx_sip`. Die Folgen waeren nicht kosmetisch gewesen: ab KV2-6 haette der
Herzschlag `kosten:erfassung-tot:telnyx_call_records` dauerhaft gefeuert (genau der
Dauer-Alarm, den 4.4 verwirft), und ab KV2-8 waere fuer JEDEN Telnyx-Engine-Anruf
`dataComplete` falsch und die Belegsumme 0 gewesen - gegen `estimatedCostCents = 30` ein
negativer Delta, den `applyCostCorrectionCents` (`state-ops.js:3815`) verwirft. Die heute
funktionierende Erstattung (56 von 56 Anrufen, AUFTRAG B1) waere still gestorben. Beide Wege
bleiben offen:
*(a) Einsammler bauen* - KV2-5(g) legt die Zeile aus dem `measured`-Ergebnis an, das
`trueOneCall` heute schon bildet (`cost-truing.js:665`); Reife `belegt` genau dann, wenn
`classifyRecords` `complete` liefert UND `billedSecTotal > 0`, also Bedingung fuer Bedingung
aus `refundProven` (`:452-457`) uebernommen. Kein zusaetzlicher Anbieter-Abruf, kein neues
Praedikat. Preis: KV2-5 fasst den Sweep-Pfad der 56 heute funktionierenden Faelle an - der
Grund, warum KV2-5(b) und KV2-8(i) beide auf Byte-Gleichheit gegen den Bestandspfad pruefen.
*(b) nur katalogisieren* - 4.5 bekommt die Regel, dass Profile ohne eigenen Einsammler
weiter ueber den Bestandspfad (`refundProven`/`classifyRecords`) gesettelt werden; KV2-8
darf `refundProven` dann NICHT ersetzen, sondern nur ERGAENZEN, und der Herzschlag muss
`telnyx_call_records` ausnehmen. Preis: zwei dauerhaft parallele Settlement-Pfade, eine
Deckungsquote, die den mengenmaessig groessten Traeger nicht sieht, und `actualCostMicroCents`
mit zwei Bedeutungen je nach Profil.
*Empfehlung: (a) bauen - und zwar in KV2-5, nicht als eigene Phase.* Der Einsammler kostet
fast nichts (die Messung liegt bereits vor, es fehlt nur die Zeile), und er ist die einzige
Variante, in der das Kosten-Buch die Vollstaendigkeit BEANTWORTET statt sie fuer den
haeufigsten Fall offenzulassen. (b) baut genau die Doppelstruktur, deren Ende dieser Plan
ist: zwei Wahrheiten ueber dieselbe Frage, von denen die eine still veraltet.
**Default: (a)** - die Kette laeuft dann wie beschrieben.
**DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden.** Der Eigentuemer hat diesen Punkt nicht beantwortet; es gilt der oben benannte Default. Das ist KEINE getroffene Entscheidung - die Gegenvariante und ihre Folgestellen bleiben vollstaendig stehen, damit eine spaetere Session den Punkt aufmachen kann, ohne ihn neu herzuleiten. Der Phasenbericht vermerkt ihn als Default. Faellt der Punkt spaeter auf (b), aendern sich genau vier Stellen, alle hier benannt: 3.2 Zeile #3
(Spalten "Weg in die Gate-Achse"/"Weg ins Buch"), 4.5 (Absatz "Der Gegenweg bleibt offen"),
KV2-5(g) entfaellt, KV2-6(f) und KV2-8(i) kehren sich um. Eine halbe Umsetzung - Einsammler
gebaut, `refundProven` nicht ersetzt, oder umgekehrt - ist der einzige Zustand, der
schlimmer ist als beide Wege.

**12. Ein Traeger fuer die Telnyx-Gesamtkost, oder ein Traeger je Belegtyp? - DEFAULT
UEBERNOMMEN 2026-08-30, nicht ausdruecklich entschieden.** Der Traeger
hiess bis zum 2026-08-30 `telnyx_callcontrol`, sein Betrag war und ist aber
`measured.actualCostMicroCents` - die Summe ueber ALLE zugeordneten Belegtypen des Anrufs
(BELEGT: `voice.js:656` holt jeden Typ aus `ASSIGNABLE_COST_RECORD_TYPES`,
`sumRecordMicroCents` `cost-truing.js:296-305` summiert ohne Typfilter). Der Name versprach
eine Kostenart, der Betrag war die Gesamtkost: zwei Sachverhalte auf einem Label - genau die
Regel, die dieser Plan in 4.8 aus `defaults.js:180-184` zitiert und selbst zur Begruendung
der neuen Enum-Werte heranzieht. Im Betrieb faellt das auf die Deckungsquote je Traeger
(KV2-6) und den Herzschlag zurueck: beide melden unter einem Namen, der nicht sagt, was
gemessen wurde. Zwei Wege:
*(a) umbenennen* - der Traeger heisst `telnyx_call_records`, Bedeutung ausdruecklich
"Telnyx-Gesamtkost je Anruf ueber alle zugeordneten Belegtypen"; der Name wird durch 3.2,
4.5, KV2-2 (Profiltabelle), KV2-5(g), KV2-6(f) und KV2-8(i) gezogen. Verhalten unveraendert,
kein Cent bewegt sich anders, kein Praedikat aendert sich.
*(b) aufspalten* - der Betrag der Zeile wird auf Records vom Typ `call-control` beschraenkt,
die uebrigen fuenf zuordenbaren Typen werden eigene Traeger. Preis: `dataComplete` misst
dann gegen eine laengere Pflichtliste, KV2-5(g) legt mehrere Zeilen statt einer an, und die
Aenderung braucht einen eigenen Regressionsbeleg gegen den heutigen Bestandspfad (die 56
funktionierenden Faelle, AUFTRAG B1).
*Empfehlung: (a) umbenennen.* Sie ist die billigere und aendert am Verhalten nichts;
(b) loest ein Namensproblem mit einer Verhaltensaenderung an der Erstattungsbedingung.
**Dieses Dokument ist bereits auf (a) durchgezogen** - der Name `telnyx_call_records` steht
ueberall, wo vorher `telnyx_callcontrol` stand; (a) ist damit zugleich der Default.
**DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden.** Der Eigentuemer hat diesen Punkt nicht beantwortet; es gilt der oben benannte Default. Das ist KEINE getroffene Entscheidung - die Gegenvariante und ihre Folgestellen bleiben vollstaendig stehen, damit eine spaetere Session den Punkt aufmachen kann, ohne ihn neu herzuleiten. Der Phasenbericht vermerkt ihn als Default. Faellt der Punkt spaeter auf (b), aendern
sich genau die oben genannten sechs Stellen plus KV2-5's Abhaengigkeitsabschnitt; das ist
dort benannt.

**13. Wie hart ist der Riegel gegen den Realtime-Flip? - ENTSCHIEDEN 2026-08-30.**
Owner-Entscheidung 9 ist getroffen (nicht bauen), und dazu gehoert der Boot-Riegel
KV2-2(h). Zur Wahl stand allein seine Haerte:
*(a) `fatal: true`* - der Prozess startet mit `VOICE_ENGINE=realtime` nicht, solange
`openai_realtime` keinen Einsammler hat; Muster `REQUIRED_TYPES_EMPTY`
(`boot-guard.js:657-664`). *(b) laut, aber nicht fatal* - WARN-Befund plus Alarm ueber den
Weg aus KV2-1, der Start laeuft durch; Muster `realtime_no_midcall_budget` (`:708`).
*Empfehlung: (a) fatal.* Der Fall ist derselbe wie bei der leeren Pflichtmenge: ein Dienst,
der Geld bewegt, ohne den Kostenpfad seines aktiven Anrufwegs zu kennen, darf nicht starten.
Und die Fehlrichtung ist harmlos - der Schalter steht live auf `budget` (BELEGT
`render.yaml:651-652`), ein faelschlich fataler Riegel legt also nichts lahm, was heute laeuft.
(b) ist vertretbar, wenn der Owner den Start unter keinen Umstaenden an einen Kostenbefund
haengen will; dann muss der Befund aber ueber den KV2-1-Alarmweg gehen und nicht nur ins
Log - ein WARN, das niemand sieht, ist die Variante, die 6.7 verwirft.
**ENTSCHIEDEN am 2026-08-30 (Owner), der Empfehlung folgend: (a) `fatal: true`.** Der Prozess
startet mit `VOICE_ENGINE=realtime` nicht, solange der Traeger `openai_realtime` im Katalog
ohne Einsammler steht; gebaut wird das als Zeile in `latentCostPathFindings` nach dem Muster
`REQUIRED_TYPES_EMPTY` (`boot-guard.js:657-664`), Abnahmekriterium KV2-2(h). **Verworfen** ist
(b), laut aber nicht fatal - die Begruendung und ihr vollstaendiges Fehlerbild bleiben unten
stehen, damit der Punkt ohne Neuherleitung wieder aufgemacht werden kann. Was mit (b)
zusammen verworfen ist: die dort beschriebene Kopplungspflicht an Punkt 10 und die dritte
Lage ("(b) ohne 10(a)") als akzeptiertes Restrisiko. Beides ist unter (a) gegenstandslos.
**Der Preis von (b) ist groesser als "ein WARN, das niemand sieht", und er haengt an
Punkt 10 - das ist der eigentliche Inhalt dieser Frage.** Unter (a) ist die in Punkt 10
benannte Restluecke des Outbound-TeXML-Zweigs UNERREICHBAR: mit `VOICE_ENGINE=realtime`
startet der Prozess nicht, also kann kein Anruf sie ausloesen. Faellt 13 auf (b), wird sie
scharf - und zwar lautlos. Die Kette, in diesem Lauf Stueck fuer Stueck am Code gelesen:
`api-calls.js` verzweigt im TeXML-Fall NICHT auf die Engine (`else`-Zweig ab `:394`, einziger
Engine-Unterschied ist der Timer-Guard `:409`), die Weiche faellt erst im Webhook
(`voice.js:476`). Der Anruf traegt damit das Profil `telnyx_budget` mit dem einzigen
Pflicht-Traeger `telnyx_call_records`, waehrend `bridge.js:164-167` je Anruf eine
kostenpflichtige OpenAI-Sitzung oeffnet, die nichts bucht (BELEGT: `grep` auf
`bookCents`/`trackUsage`/`recordUsageEvent` in `src/bridge.js`, 0 Treffer). Und NICHTS wird
rot: der Beleg `telnyx_call_records` trifft ein, der Herzschlag aus KV2-6(f) schweigt
korrekterweise, `dataComplete` wird wahr, und der Inventar-Test KV2-2(c) faehrt nur den
INBOUND-Teil in beiden Engine-Stellungen. Das ist exakt der Mechanismus des 19.08., den 6.4
als Zweck dieser ganzen Kette benennt - diesmal mit Owner-Zustimmung, aber eine Zustimmung
gilt nur, wenn ihr die Folge vorlag. Hier liegt sie vor.
**Daraus die Bindung, und sie ist keine Stilfrage:** *(b) ist nur zulaessig, wenn Punkt 10
gleichzeitig auf (a) faellt* - das Profil wird im Webhook (`voice.js:476`) je Zweig
nachgeschrieben, sodass der Outbound-Realtime-Zweig ein EIGENES Profil mit dem Traeger
`openai_realtime` traegt (Benennung analog zum Inbound-Paar, etwa
`telnyx_outbound_realtime`; `telnyx_budget` bleibt dann der reine Budget-Zweig). Damit gilt
fuer Outbound dieselbe Sichtbarkeit wie fuer Inbound, KV2-2(c) bekommt seinen sechsten Zweig,
und (b) kostet genau das, was sein Wortlaut verspricht.
**Will der Owner (b) OHNE 10(a)** - etwa weil der Webhook-Nachschreibweg nicht gebaut werden
soll -, ist das kein Fehler, aber ein bewusst zu tragendes Restrisiko, und es wird hier mit
Fehlerbild aufgenommen statt stillschweigend gewaehlt: je Outbound-TeXML-Anruf unter
`VOICE_ENGINE=realtime` laeuft eine ungebuchte OpenAI-Sitzung; der Herzschlag schweigt, weil
der Pflicht-Traeger des gesetzten Profils belegt ist; `dataComplete` bleibt wahr; kein Test
wird rot; sichtbar wuerde der Posten erst auf der OpenAI-Rechnung, ohne Zuordnung zu Tenant
oder Anruf. Diese dritte Lage ist im Phasenbericht ausdruecklich als akzeptiertes Restrisiko
zu vermerken - mit genau diesem Fehlerbild.
**Reihenfolge, die daraus folgte - erledigt.** Wer 13 auf (b) beantwortet haette, haette 10
im selben Zug mitbeantworten muessen. Mit der Entscheidung auf (a) besteht diese Kopplung
NICHT: Punkt 10 ist wieder die reine Genauigkeitsfrage, als die er dort steht, und die
Outbound-Restluecke ist unerreichbar, weil der Prozess unter `VOICE_ENGINE=realtime` gar
nicht startet. Der ganze Abschnitt oben ab "Der Preis von (b)" beschreibt damit eine Lage,
die durch diese Entscheidung geschlossen ist - er bleibt als Herleitung stehen und wird
wieder scharf, falls jemand 13 spaeter auf (b) dreht.

**14. Wie wird der Buchungspfad fuer die 12 EL-Altanrufe gesperrt - das Legacy-Profil
umlenken oder die Zeilen ganz herausnehmen? - DEFAULT UEBERNOMMEN 2026-08-30, nicht
ausdruecklich entschieden.** Gemessen am 2026-08-30, lesend an der
Produktions-DB: es gibt genau 12 Anrufe mit `elevenlabs_conversation_id`, alle bei Tenant
`t_user_01KX600834GCJFV9GTZQKWZMTH`; 12/12 tragen `sip_call_id`, 12/12 haben `ended_at`,
KEINER `call_control_id` oder `twilio_sid`, KEINER `cost_trued_at`, Summe
`cost_truing_attempts` 0, Summe `estimated_cost_cents` 270. Der `sipCallId`-Join aus KV2-5
macht sie erstmals abrufbar (`isRetrievable`, `cost-truing.js:581`); als Kandidaten laufen
sie in `trueOneCall`, das `bookCorrectionFor` fuer jeden gemessenen Anruf ruft
(`cost-truing.js:684`). Ohne Riegel entscheidet allein die in KV2-5(d) ungemessene Frage,
ob EL-Legs `call-control`-Belege fuehren, ob daraus eine Erstattung wird - die B6-Falle,
gegen Owner-Entscheidung 7 und Abschnitt 8 Punkt 9. Ein Riegel ist also nicht optional; die
Frage ist seine Bauform. Zwei Wege:
*(a) das Legacy-Profil umlenken* - eine profillose Altzeile MIT gesetztem `sipCallId` faellt
auf `el_convai_sip` statt auf `telnyx_budget` und liegt damit im bereits gebauten EL-Schutz
aus KV2-5 (dort wird `bookCorrectionFor` fuer die EL-Route nicht gerufen). Kein neues
Praedikat, kein zweiter Mechanismus. Preis: die 12 werden regulaere Mitglieder des Profils
`el_convai_sip`. Sie bekommen ab KV2-5 eine `telnyx_sip`-Belegzeile, bekommen nie eine
`elevenlabs_convai`-Zeile (der Anbieter-Abruf dieser Gespraeche ist vorbei) und druecken
damit die EL-Deckungsquote aus KV2-6, bis die Frist abgelaufen ist und sie in
`unvollstaendig_final` landen. Das ist sichtbar und richtig herum, aber es ist ein Preis.
*(b) ganz herausnehmen* - die Legacy-Zuordnung liefert fuer diese Zeilen GAR KEIN Profil;
sie fallen damit in die bereits bestehende Regel "Profil unbekannt -> gar nichts" (4.6) und
werden nie gesettelt. Preis: 12 dauerhafte `profil_fehlt`-Befunde auf einem Kanal, der laut
6.7 genau davon stirbt, und die 12 sind in keiner Deckungskennzahl mehr sichtbar - eine
Altmenge, die aus der Beobachtung faellt, statt in ihr zu stehen.
*Empfehlung: (a) umlenken.* Sie nutzt einen Riegel, der ohnehin gebaut wird, statt einen
zweiten daneben zu stellen, und sie haelt die 12 sichtbar. Der Preis von (a) ist eine
gedrueckte Quote mit benanntem Grund; der Preis von (b) ist ein Dauerbefund und eine
unsichtbare Altmenge - die schlechtere Waehrung.
**Default: (a).** **DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden.** Der Eigentuemer hat diesen Punkt nicht beantwortet; es gilt der oben benannte Default. Das ist KEINE getroffene Entscheidung - die Gegenvariante und ihre Folgestellen bleiben vollstaendig stehen, damit eine spaetere Session den Punkt aufmachen kann, ohne ihn neu herzuleiten. Der Phasenbericht vermerkt ihn als Default. Zur Abgrenzung: das OB des Riegels ist durch
Owner-Entscheidung 7 (nicht nachbuchen) ausdruecklich entschieden - nur seine BAUFORM laeuft
hier auf dem Default. Beide Wege bewegen null Cent, und das Abnahmekriterium KV2-5(h) misst genau das
(null Cent, `applyCostCorrectionCents` per Spion ungerufen) - es ist deshalb fuer beide Wege
gueltig und muss bei einer Antwort auf (b) NICHT umgeschrieben werden. Was sich bei (b)
aendert, sind genau zwei Stellen, beide hier benannt: 4.3 (die zweite Aufzaehlungszeile) und
4.6 (die zweite Altzeilen-Zeile der Matrix).

**15. Wird `mail_zusammenfassung` (#16) nur katalogisiert, oder bekommt sie einen
Kostentraeger? - DEFAULT UEBERNOMMEN 2026-08-30, nicht ausdruecklich entschieden.** Die
Zusammenfassungs-Mail geht je beendetem Anruf raus
(`call-finish.js:142` -> `planSummaryMail`), ueber einen Anbieterdienst (Brevo/HTTP vor
SMTP, `wiring/web-login.js:139`, Rangfolge `mail-boot-probe.js:11-15`), und sie ist
tenant-zuordenbar. Gebucht wird nichts: `call-finish.js` schreibt genau ein
`recordUsageEvent`, und das ist der SMS-Block (`:353`). Damit ist sie strukturell derselbe
Fall wie #6 (`sms`) - mit EINEM Unterschied, der die Entscheidung traegt: bei #6 gibt es
wenigstens einen Konfigurationswert (`SMS_COST_CENTS`, Default 0); fuer Mail existiert
repo-weit kein Preis-Parameter (BELEGT, s. Zeile #16). Der Betrag je Mail ist heute
UNGEMESSEN - dieser Lauf hat keinen Anbieter-Endpunkt abgerufen.
*(a) Nur katalogisieren* - die Zeile steht im Katalog, `gate:false`, kein Einsammler; die
Preisquelle wird in KV2-2(f) dokumentarisch belegt. Kosten: eine reale, kleine
Anbieter-Ausgabe bleibt dauerhaft ausserhalb beider Buecher, genau wie #6.
*(b) Traeger bauen* - ein Beleg je versandter Mail und ein Weg auf die Gate-Achse, analog
zum SMS-Muster (Buchung NACH erfolgreichem Versand). Kosten: eine eigene Phase nach KV2-10,
plus ein Preis-Parameter, der gepflegt werden muss.
*Empfehlung: (a), aber erst nach der Messung in KV2-2(f) endgueltig.* Begruendung: (b) ohne
gemessenen Satz waere eine Buchung auf einen geratenen Preis - genau der Fehler, den 3.2
Zeile #7 verbietet. Liegt der gemessene Satz je Mail in der Groessenordnung der
Gespraechskosten (Anhalt: rund 15 US-Cent Ist je Anruf, AUFTRAG B2 / `befund-telnyx.md` O2),
kippt die Empfehlung auf (b); liegt er um Groessenordnungen darunter, bleibt es bei (a).
**Default: (a).** **DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden.** Der Eigentuemer hat diesen Punkt nicht beantwortet; es gilt der oben benannte Default. Das ist KEINE getroffene Entscheidung - die Gegenvariante und ihre Folgestellen bleiben vollstaendig stehen, damit eine spaetere Session den Punkt aufmachen kann, ohne ihn neu herzuleiten. Der Phasenbericht vermerkt ihn als Default. Der Default nimmt der Messung in KV2-2(f) nichts
vorweg: liegt der gemessene Satz je Mail in der Groessenordnung der Gespraechskosten, kippt
die Empfehlung auf (b), und der Punkt ist dann ohnehin neu aufzumachen. Beide Wege aendern an
KV2-2 dasselbe und nicht mehr: die Katalogzeile #16 entsteht
so oder so, die Zeilenmenge (d) steht so oder so auf 17, und die Preismessung (f) laeuft so
oder so. Was (b) zusaetzlich ausloest, ist ausschliesslich eine Folgephase nach KV2-10 - die
Reihenfolge KV2-1..KV2-10 wird dafuer nicht umsortiert.

**16. Entfaellt der Reife-Wert `beleg_ausgeblieben`, oder bekommt er einen benannten
Schreiber? - DEFAULT UEBERNOMMEN 2026-08-30, nicht ausdruecklich entschieden.** Der Wert
stand im Wertebereich von `call_cost_evidence.reife` (KV2-3) und kam
im ganzen Dokument genau einmal vor - in der Enum-Zeile selbst. Keine Phase setzt ihn, keine
Zeile der Matrix 4.6 nennt ihn, kein Endzustand aus KV2-7 entspricht ihm, und im Code gibt
es ihn nicht (BELEGT: 0 Treffer ueber `src/` und `test/`, Positivkontrolle `costTruedAt`
trifft). Ein Enum-Wert ohne Schreiber ist toter Code im Schema; ein spaeterer Leser muesste
seine Bedeutung erfinden - genau die Rueckfrage, die der Phasenschnitt ausschliessen soll.
*(a) Ersatzlos streichen* - der Wertebereich hat dann vier Auspraegungen (`erwartet`,
`vorlaeufig`, `belegt`, `beleg_strukturell_unbeschaffbar`). Kosten: kommt der Sachverhalt
spaeter doch, ist ein weiterer Wert eine Schema-Aenderung - im Postgres-Weg dieselbe Klasse
Migration wie jede andere additive DDL, die hier ohnehin beim Boot laeuft.
*(b) Behalten und den Schreiber benennen* - der einzige Sachverhalt, der im Plan ueberhaupt
dafuer in Frage kommt: der Faelligkeitslauf aus KV2-7 setzt ihn an einer Belegzeile, die bei
Fristablauf nie ueber `erwartet` hinausgekommen ist ("der Anbieter hat nie geliefert").
Kosten: derselbe Sachverhalt wird dann an ZWEI Datensaetzen gefuehrt - am Anruf als
`unvollstaendig_final` mit namentlicher Liste der fehlenden Traeger (KV2-7(c)), an der
Belegzeile zusaetzlich als eigener Reifewert. Zwei Wahrheiten ueber dieselbe Lage sind genau
das Muster, das dieser Plan an anderer Stelle ausdruecklich verwirft (4.8, "nie zwei
Sachverhalte auf ein Label" - hier die Umkehrung: nie ein Sachverhalt auf zwei Zustaende).
*Empfehlung: (a).* Der Informationsgehalt von (b) liegt bereits vollstaendig in
`unvollstaendig_final` plus der Traegerliste; der Wert traegt nichts bei, was ein Leser
nicht schon haette, und kostet eine zweite Stelle, die konsistent gehalten werden muss.
**Default: (a).** **DEFAULT UEBERNOMMEN am 2026-08-30, nicht ausdruecklich entschieden.** Der Eigentuemer hat diesen Punkt nicht beantwortet; es gilt der oben benannte Default. Das ist KEINE getroffene Entscheidung - die Gegenvariante und ihre Folgestellen bleiben vollstaendig stehen, damit eine spaetere Session den Punkt aufmachen kann, ohne ihn neu herzuleiten. Der Phasenbericht vermerkt ihn als Default. Reichweite in beiden Faellen: ausschliesslich KV2-3 (Wertebereich, DDL, Kriterium
(b) - die Terminierungsregel dort gilt fuer den Wert wortgleich, falls er bleibt). Keine
spaetere Phase liest ihn, keine Reihenfolge aendert sich, KV2-8 und der Herzschlag sind
nicht beruehrt.

---

## 8. Was NICHT Teil dieses Plans ist

1. **Keine Live-Kostenerfassung waehrend des EL-Gespraechs.** ElevenLabs liefert `cost_fiat`
   erst am Gespraechsende; ein Live-Wert existiert nicht. Die Bremse mitten im Anruf bleibt,
   was sie ist: die Vorab-Reserve (`outboundReserveCents` = Tarif mal
   `RESERVE_LEAD_MINUTES`, 60 Cent, `reserve_budget` als LETZTES Gate, 402 bei zu wenig
   Geld), `liveVoiceSpendCents` ueber alle aktiven Legs, und der aus dem Restguthaben
   abgeleitete `maxDurationS`-Cap, im EL-Zweig armiert (`api-calls.js:372`) - alles BELEGT
   AUFTRAG B4, alles unangetastet. Eine Kostenart, die erst nach dem Anruf bekannt wird,
   kann diesen Anruf nie blockieren, nur den naechsten.
2. **Keine neue `USAGE_EVENT_KIND` fuer Lieferantenkosten** (Begruendung 3.1).
3. **Keine Umlage der Fixkosten je Tenant** (3.3, Owner-Entscheidung 8, entschieden
   2026-08-30).
4. **Keine automatische Tarif-Justierung** (Owner-Entscheidung 6, entschieden 2026-08-30).
5. **Die SMS-Kostenart (#6) bleibt offen.** Sie ist alt, klein (Default-Preis 0) und ein
   zweites Thema; sie ist im Katalog benannt, damit sie nicht als "erfasst" durchgeht.
6. **DID-Miete (#10) und Nummern-Einkauf (#11) bleiben ausserhalb.** Keine
   Gespraechskostenarten; beide im Katalog sichtbar.
7. **Die Stripe-Transaktionsgebuehr (#12) wird nur katalogisiert, nicht gebaut.** Sie
   entsteht nicht im Anruf und gehoert nicht auf die Gespraechs-Gate-Achse. Sie ist eine
   eigene Kette - aber sie fehlt ab jetzt nicht mehr im Katalog.
8. **Kein Umbau am Inbound-Pfad.** Inbound laeuft ausschliesslich ueber den Bestandsweg,
   nie ueber ElevenLabs: `src/telnyx-inbound.js` und `src/routes/voice.js` enthalten
   `grep`-weit keinen EL-Treffer, und `voice.js:324` schaltet nur zwischen Realtime und
   Budget (BELEGT `befund-gate.md` 3, mit DB-Gegenprobe). O6 ist damit geschlossen, nicht
   nur beantwortet. Inbound bekommt trotzdem ein Profil (KV2-2) - und zwar ZWEI,
   `telnyx_inbound_budget` und `telnyx_inbound_realtime`, eines je Zweig ab `voice.js:324`,
   damit ein spaeterer Schwenk am Inventar-Test auffaellt statt gruen zu bleiben (4.3).
9. **Kein rueckwirkendes Nachbuchen und keine rueckwirkende Erstattung an den 12
   EL-Altanrufen** (Owner-Entscheidung 7). Das ist keine blosse Unterlassung, sondern
   braucht ab KV2-5 einen aktiven Riegel: der `sipCallId`-Join macht die 12 dort erstmals
   abrufbar, und `trueOneCall` ruft `bookCorrectionFor` fuer jeden gemessenen Anruf
   (`cost-truing.js:684`). Der Riegel ist die sipCallId-bewusste Legacy-Zuordnung (4.3,
   4.6), seine Bauform ist Owner-Entscheidung 14 (nicht ausdruecklich entschieden, Default
   (a)), sein Beleg ist Abnahmekriterium KV2-5(h).
10. **Kein verteilter Laufriegel** (akzeptiertes Risiko 6.8) und **kein automatischer
    Kursbezug** (akzeptiertes Risiko 6.9).
11. **Keine Geld-Gegenprobe gegen den ElevenLabs-Konto-Endpunkt.** `GET /v1/user/subscription`
    zaehlt konto-weit in Credits/Zeichen; `current_overage` bleibt strukturell 0, solange
    das Plankontingent nicht ueberschritten ist (BELEGT `befund-elevenlabs.md` 5). Der
    Endpunkt taugt als Preisquelle (Katalogzeile #8/#9), nicht als Kontrollsumme.
12. **Kein Anfassen der Safety-Gates.** Verifikation als Outbound-Permit, `OUTBOUND_FROZEN`,
    Denylist, Land-Gate, Stundenlimit, pro-Tenant-Kostendecke (beide Richtungen,
    Inbound eingeschlossen), Max-Gespraechsdauer, Provider-Signaturpruefung, der
    Offenlegungssatz und `callee_is_owner`: unberuehrt. Die Kette macht die Kostendecke
    ausschliesslich genauer.
13. **Der OpenAI-Realtime-Traeger (#14) wird in dieser Kette KATALOGISIERT, NICHT GEBAUT** -
    Owner-Entscheidung 9, getroffen am 2026-08-30: OpenAI Realtime wird bis auf Weiteres
    nicht verwendet. Konkret gebaut wird: die Katalogzeile, das Profil
    `telnyx_inbound_realtime`, der Inventar-Test, der den Flag-Flip sichtbar macht, und der
    Boot-Riegel KV2-2(h). NICHT gebaut wird: ein Beleg-Einsammler fuer die OpenAI-Sitzung
    und ein Weg dieser Kosten auf die Gate-Achse. Wird die Engine je wieder ein Thema, kommt
    der Einsammler als eigene Phase nach KV2-10 dazu; diese Kette wird dafuer nicht
    umsortiert. Solange er fehlt, gilt: `VOICE_ENGINE=realtime` schaltet einen ungebuchten
    Kostentraeger scharf - deshalb der Riegel, nicht nur dieser Satz.
14. **Der Telnyx-Belegtyp `inference` (#15) wird KATALOGISIERT, NICHT zugeordnet.** Er ist
    strukturell keinem Anruf zuzuordnen (`voice.js:165-169`), der Sweep holt ihn nicht ab
    (`:656`), und diese Kette aendert daran nichts. Was sie tut: ihn benennen und in
    KV2-5(d) einmal beziffern, damit "nicht zuzuordnen" nicht laenger "unbekannt gross"
    heisst. Eine Umlage waere eine eigene Entscheidung und ist hier nicht vorbereitet.
15. **Die Zusammenfassungs-Mail (#16) bleibt offen - wie #6.** Sie faellt je beendetem
    Anruf an, laeuft ueber einen Anbieterdienst und wird nirgends gebucht
    (`call-finish.js:142` gegen das einzige `recordUsageEvent` in `:353`, das der SMS
    gehoert). Diese Kette baut fuer sie KEINEN Beleg-Einsammler und KEINEN Weg auf die
    Gate-Achse. Was sie tut: die Kostenart benennen (Katalogzeile #16), sie in die gepinnte
    Zeilenmenge KV2-2(d) aufnehmen und ihre Preisquelle in KV2-2(f) belegen - damit sie
    nicht als "erfasst" durchgeht. Ob mehr daraus wird, ist Owner-Entscheidung 15 und waere
    eine eigene Phase nach KV2-10.
16. **Die WorkOS-Konto-Rechnung (#17) wird nur katalogisiert, nicht gebaut** - genau wie die
    Stripe-Gebuehr (#12, Punkt 7 oben), und aus demselben Grund: sie entsteht nicht im Anruf,
    sondern an der Nutzeridentitaet, und gehoert nicht auf die Gespraechs-Gate-Achse. WorkOS
    ist dabei kein Randposten: der Anbieter traegt den gesamten Browser-Login
    (`src/wiring/web-login.js:164`, `src/web-auth.js:397/:398/:469`) und die Nutzerloeschung
    am Vertragsende (`src/workos-management.js:9`), die API-Basis steht im Live-Blueprint
    (`render.yaml:615-616`). Was diese Kette tut: die Kostenart benennen (Katalogzeile #17),
    sie in die gepinnte Zeilenmenge KV2-2(d) aufnehmen (17 statt 16) und ihre Preisquelle in
    KV2-2(f) lesend belegen. Was sie NICHT tut: einen Beleg-Einsammler, einen Buchungsweg
    oder eine Umlage bauen. Anders als bei #16 ist das keine offene Owner-Frage, sondern die
    Festlegung aus 3.3 - eine Umlage waere eine eigene Entscheidung und ist hier nicht
    vorbereitet.

---

## 9. Offene Punkte, die diese Kette nicht schliesst

- **O3 (Endgueltigkeit von `cost_fiat` in den ersten Minuten)** - ungemessen, weil es in
  keinem Vorlauf einen Anruf juenger als 4h20m gab und Testanrufe verboten waren (BELEGT
  `befund-elevenlabs.md` 2). Die Kette umgeht die Frage ueber die Reifefrist und holt die
  Messung im Betrieb nach (KV2-9f). Der Default 15 Minuten ist **VERMUTET**.
- **Die reale Rate-Limit-Schwelle bei ElevenLabs** - nur eine untere Schranke ist bekannt
  (25 Requests ohne 429, keine Rate-Limit-Header in ueber 60 Antworten, BELEGT
  `befund-elevenlabs.md` 4).
- **Ob der EL-Weg `record_type=call-control`-Belege fuehrt** - ungemessen; die Messung ist
  Abnahmekriterium KV2-5(d).
- **Die reale Latenz der `sip-trunking`-Belege** - nur ihre Existenz ist belegt (12/12),
  nicht wie schnell sie erscheinen; ebenfalls KV2-5(d).
- **Ob in der Produktion ein Alarm-Empfaenger gesetzt ist** - NICHT GEMESSEN (Secrets-Regel
  der Vorlaeufe); erste Handlung in KV2-1(e).
- **Der Preis der eigenen `<Play>`-Synthese** - die Begruendung "kein Preis im Repo" ist
  unzulaessig; die Messung ist Abnahmekriterium KV2-2(f).
- **Der Preis der Zusammenfassungs-Mail (Katalogzeile #16)** - NICHT GEMESSEN. Grund: es
  gibt repo-weit keinen Preis-Parameter fuer Mail (BELEGT: kein Gegenstueck zu
  `config.billing.smsCostCents`, `config.js:1205`; `config.mail` fuehrt nur Zugang und
  Absender, `config.js:2105`), und in diesem Lauf wurde bewusst kein Mail-Anbieter
  abgerufen. Damit ist auch die Waehrung unbelegt. "Kein Preis im Repo" ist als Begruendung
  unzulaessig (Regel aus 3.2 Zeile #7) - die Mail kostet beim Anbieter, ob wir den Satz
  kennen oder nicht. Geklaert wird die Preisquelle in KV2-2(f), lesend und ohne Versand; ob
  daraus ein gebuchter Traeger wird, ist Owner-Entscheidung 15 und mit dieser Messung NICHT
  automatisch entschieden.
- **Der Ist-Verbrauch einer OpenAI-Realtime-Sitzung (Katalogzeile #14)** - ungemessen, weil
  `VOICE_ENGINE` live auf `budget` steht (BELEGT `render.yaml:651-652`) und ein Testanruf
  verboten war. Offen sind zwei getrennte Fragen: die PREISQUELLE (Waehrung, Satz je
  Audio-/Text-Token) - geklaert in KV2-2(f), dokumentarisch, ohne Anruf, und dort weiterhin
  Pflicht, weil `preisquelle`/`waehrung` Pflichtfelder jeder Katalogzeile sind; und ob die
  Sitzung ueberhaupt einen Ist-Betrag liefert (`bridge.js:383` liest heute keinen) - diese
  Frage ist durch Owner-Entscheidung 9 (2026-08-30, "wird bis auf Weiteres nicht verwendet")
  GEPARKT, nicht beantwortet. Sie wird erst gestellt, wenn die Engine wieder aktiviert
  werden soll; bis dahin haelt der Boot-Riegel KV2-2(h) den Zustand fest.
- **Der Preis der WorkOS-Konto-Rechnung (Katalogzeile #17)** - NICHT GEMESSEN, weder Satz je
  aktivem Nutzer noch Waehrung. Grund: es gibt repo-weit keinen Preis-Parameter fuer WorkOS
  (der Code kennt nur Basis-URL und Schluessel, `config.js:1886`/`:1894`), und in diesem Lauf
  wurde bewusst kein Anbieter-Endpunkt abgerufen. "Kein Preis-Parameter im Repo" ist als
  Begruendung unzulaessig (Regel aus 3.2 Zeile #7) - der Login kostet beim Anbieter, ob wir
  den Satz kennen oder nicht. Geklaert wird die Preisquelle in KV2-2(f), lesend, aus der
  Anbieter-Preisliste und ohne Management-Aufruf. Ein gebuchter Traeger wird daraus NICHT
  (3.3, Abschnitt 8 Punkt 16); offen ist ausschliesslich die Preisangabe der Katalogzeile.
- **Ob `record_type=inference` (Katalogzeile #15) auf unserem Konto Betraege traegt** - nicht
  gemessen. Grund: der Sweep ruft diesen Typ nicht ab (er steht in
  `UNASSIGNABLE_COST_RECORD_TYPES`, `voice.js:169`), und in diesem Lauf war der Telnyx-Zugang
  nicht verfuegbar (HTTP 401, BELEGT `tasks/kostenv2/AUFTRAG.md:138`). Es ist damit eine
  reale Anbieter-Kostenart unbekannter Groesse, die per Konstruktion in keinem Buch und auf
  keiner Gate-Achse landet. Geklaert wird sie in KV2-5(d), im dortigen lesenden Abruf; eine
  Umlage ist damit NICHT verbunden und waere eine eigene Entscheidung.
- **Preisdrift der LLM-Anbieter auf der Achse `ai_token` (Katalogzeile #4)** - unbeobachtet,
  und zwar bewusst. Gebucht wird zu den im Repo gepflegten Modellpreisen
  (`config.llm.modelPricesUsd`, `config.js:302-353`) ueber `aiCostCents` ->
  `meterAiTokens`/`bookCents` (`llm-usage.js:23-35`, `state-ops.js:3655`); ein Anbieter-Ist
  wird nie eingesammelt (Begruendung Aufwand/Nutzen, 3.2 Zeile #4). Die Achse laeuft auf
  ALLEN Wegen mit, den EL-Weg eingeschlossen (Briefing, Eroeffnungssatz,
  `summarizeCall`-Rueckfall - BELEGT am Code, 3.2 Zeile #4); dieser offene Punkt betrifft
  also nicht nur Anrufe der eigenen Turn-Schleife, sondern jeden Anruf. Folge: weicht der reale
  Anbieterpreis vom Tabellenwert ab, bucht die Gate-Achse dauerhaft falsch, ohne dass eine
  Deckungsquote, ein Herzschlag oder ein Settlement das anzeigt - diese Kette baut fuer
  `ai_token` keinen Beleg und keine Gegenprobe. Was die Staffel liefert, ist das ALTER des
  Satzes (`asOf`/`source` je Staffel), nicht seine Richtigkeit. **Diese Kette schliesst den
  Punkt NICHT**; ihn zu schliessen hiesse, einen Ist-Beleg je LLM-Anbieter einzusammeln, und
  das waere eine eigene Entscheidung und eine eigene Kette (dieselbe Bauform wie
  Owner-Entscheidung 9 fuer `openai_realtime`: erst entscheiden, dann bauen). Ein
  Zwischenschritt ohne neue Kette waere ein Boot- oder Sweep-Waechter auf das Alter der
  Staffel (`asOf` aelter als N Tage -> Befund ueber den KV2-1-Alarmweg); auch er ist hier
  NICHT vorgesehen und waere ein eigener Auftrag.
- **Der 13. Telnyx-Beleg vom 19.08. ohne zugehoerigen Anruf** - unerklaert; wird ab KV2-8(f)
  gezaehlt, nicht zugeordnet.
- **`usage.calls = 2` bei 0 `call`-Zeilen** fuer den suspendierten Tenant
  `t_user_01KXH2B75WJ75W3JYYXDPPSK3R` (BELEGT `befund-gate.md` 5) - fuer die Geldkette
  folgenlos (`calls` kommt in keiner Gate-Formel vor), aber ungeklaert.

---

## 10. Anhang: die sechs Blocker-Befunde und ihre Behandlung

Kein Befund wird stillschweigend uebergangen.

| # | Befund | Quelle | Behandlung |
|---|---|---|---|
| 1 | Der 0-Betrag ist bei Entwurf A ein Vollbeleg und erzeugt Erstattungen | `angriff-premortem.md` 1.1 | **eingearbeitet**: 4.6 (0 nur bei Mengenangabe 0), Abnahme KV2-4(b) |
| 2 | Entwurf A's Anker-Phase senkt die Wirkung der pro-Tenant-Kostendecke, ohne sie als Owner-Frage zu kennzeichnen | `angriff-premortem.md` 1.2, `angriff-cleancode.md` Befund 3 | **eingearbeitet**: Owner-Entscheidung 2, Default = heutiges Verhalten; keine Phase baut die Symmetrie ungefragt |
| 3 | Entwurf B leitet die Route aus Beweisdaten ab und laeuft in die leere, allquantifiziert wahre Pflichtmenge | `angriff-premortem.md` 1.3 | **eingearbeitet**: persistiertes Profil (4.3), leere/unbekannte Pflichtmenge ist NIE Vollstaendigkeit (4.5/4.6), Vakuositaets-Test KV2-8(b) |
| 4 | Entwurf A's erste Phase macht die Anruferzeugung selbst fail-closed, vor der Reparatur des Alarmwegs | `angriff-cleancode.md` Befund 1 | **eingearbeitet, und ueber die vorgeschlagene Abhilfe hinaus**: der Vorschlag war "erst WARN, spaeter fail-closed an der Erzeugung". Hier lehnt der Schreibweg NIE einen Anruf ab - fail-closed ist ausschliesslich das Settlement (4.3, KV2-2(b)). Der Alarmweg steht ausserdem als KV2-1 davor |
| 5 | Entwurf A's Profil sitzt an der Anruferzeugung; die Werbeaussage "haette den 19.08. gestoppt" ist am Code widerlegt | `angriff-kritiker.md` K1 | **eingearbeitet**: Profil an der ENGINE-WEICHE (`api-calls.js:362` ff.; Inbound: beide Zweige ab `voice.js:324`, ausdruecklich NICHT die Erzeugungszeile `voice.js:320`, s. 4.3/KV2-2), Inventar-Test bindet die Weichen-Zweige (KV2-2(c)). Die widerlegte Werbeaussage wird nicht wiederholt |
| 6 | Entwurf B's Vollstaendigkeitspraedikat kann vakuos wahr werden und Geld ohne Beleg zurueckgeben | `angriff-kritiker.md` K2 | **eingearbeitet**: identische Abhilfe wie #3, zusaetzlich der ausdrueckliche Nicht-Erstattungs-Fall "EL-Anruf ohne jeden Beleg" im Testkatalog (KV2-8(b)) |

Zusaetzlich eingearbeitet, obwohl nicht als Blocker eingestuft, weil sie Geld oder
Vollstaendigkeit betreffen: die Schliessregel (`angriff-premortem.md` 4 -> KV2-7), die
Herkunfts-Enum (`angriff-kritiker.md` K4 -> KV2-8(e)), die Monats-Gegenprobe im selben
Commit (K5 -> KV2-8(f)), der deckungs-unabhaengige Boden (K6 -> KV2-10(c)), die
Pending-Blindheit des Stripe-Riegels (K7 -> vermieden durch das eigene Kosten-Buch), der
"binnen Stunden"-Anspruch (K8 -> Herzschlag KV2-6(b)), die fehlende Verdrahtung von
`mailer` und Audit-Sink (K9 -> KV2-1), der Eigen-TTS-Preis (K10 -> Messung KV2-2(f)), die
Stripe-Gebuehr (K11 -> Katalogzeile #12), der Nummern-Einkauf (K12 -> Katalogzeile #11), die
Recherche-Gebuehr auf dem EL-Weg (K13 -> Katalogzeile #5), die route-spezifische
Pflicht-Typmenge als Abnahmekriterium statt als Bitte (K14 -> KV2-5(d)), die
Rest-Uebertrags-Vergiftung durch inkrementelle Buchung (K3 -> Einmal-Settlement, Test
KV2-8(d)) und die Summenregel fuer nicht gemessene Posten
(`angriff-cleancode.md` Befund 6 -> KV2-3(e)).
