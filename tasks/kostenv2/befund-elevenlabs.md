# Befund: ElevenLabs-Kostenquelle (O3, O4, O5)

Gemessen 2026-08-30, ca. 13:54-13:58 UTC, gegen die produktive ElevenLabs-API
(`https://api.elevenlabs.io`), Header `xi-api-key`, Agent aus `.env`
(`ELEVENLABS_AGENT_ID`). Alle Aufrufe waren GET, kein schreibender Aufruf.

## Vorbemerkung: Die "Anruf"-IDs aus AUFTRAG.md B2 sind NICHT die ElevenLabs-Conversation-IDs

**Ueberraschung, die den Auftrag korrigiert.** Der Auftrag sagt: "Die Anruf- und
Conversation-IDs stehen im Auftrag (Tabelle unter B2)". Das stimmt nur zur Haelfte.

- Fakt: `GET /v1/convai/conversations/call_mtfm5ss7g3jz` (der Wert aus B2, Zeile "30.08.")
  liefert HTTP 404, `{"detail":{"type":"not_found","code":"conversation_not_found", ...}}`.
- Beleg: `src/store/state-ops.js:214` - `id: newId("call")`. Das Praefix `call_` ist die
  interne Hermes-Anruf-ID (`call.id`), erzeugt von unserem eigenen `newId`, nicht von
  ElevenLabs. Die tatsaechliche ElevenLabs-Conversation-ID steht im Store separat unter
  `call.elevenlabsConversationId` (`src/elevenlabs/outbound.js:1448`, `:1515`) und hat das
  Format `conv_...` (Beispiel im Code-Kommentar `src/elevenlabs/convai.js:44`:
  `conv_6801m02df3tfett9vv6jwn8fw8q0`).
- Bedeutung: Ich konnte die 8 Anrufe aus B2 trotzdem zuordnen, aber nicht ueber die ID,
  sondern ueber `GET /v1/convai/conversations?agent_id=...` (liefert `start_time_unix_secs`
  und `call_duration_secs`) und Abgleich von Datum+Dauer gegen die B2-Tabelle. Die
  Zuordnung ist eindeutig: alle 8 Dauerwerte (53/41/44/8/17/12/76/35 s) kommen in der
  Liste genau einmal vor, an den passenden Kalendertagen. Ergebnis:

  | Anruf (Hermes-ID aus B2) | ElevenLabs `conversation_id` |
  |---|---|
  | call_mt0ddduxuzgl (19.08., 53s) | conv_6301m0dha17kes9ax95jzx19cvt4 |
  | call_mt18soytibps (20.08., 41s) | conv_8801m0f3mtfxfd1ar6vjbgav2dza |
  | call_mt1rnbnfl2bp (20.08., 44s) | conv_1601m0g1v2k0ef6r67qed35nrk6b |
  | call_mt1s9bk9qvhb (20.08., 8s)  | conv_4001m0g2tct9etc9f43gxezexxgt |
  | call_mt1sa9vpavy0 (20.08., 17s) | conv_4201m0g2vr7bezb96yb5jwjgydnn |
  | call_mtd0acq2hq4q (28.08., 12s) | conv_4301m14a00vkfbx8dmqbgxqnnqft |
  | call_mtd0yf5wzpi6 (28.08., 76s) | conv_0801m14b29e1fsb88rs8kk8fwnxq |
  | call_mtfm5ss7g3jz (30.08., 35s) | conv_6101m190brwxe4ps9610a1cfkd28 |

  Fuer jede spaetere Session, die die 8 B2-Anrufe erneut abrufen will: entweder diese
  Tabelle nutzen, oder ueber die DB `call.elevenlabsConversationId` lesen - NICHT
  `call.id` gegen die ElevenLabs-API schicken.

- `GET /v1/convai/conversations?agent_id=...&page_size=30` lieferte `has_more: false`,
  also die vollstaendige Historie des Agenten: 27 Konversationen, 20 `done`, 7 `failed`.

## 1. Welche Felder tragen die Kosten, in welcher Einheit?

Fakt, Beleg (Rohdaten aller 8 B2-Anrufe per `GET /v1/convai/conversations/{conversation_id}`,
Feld `metadata`):

- `metadata.cost` - ganzzahlig, **Credits** (ElevenLabs' interne Verrechnungseinheit).
  Beispiel `conv_6301m0dha...` (19.08., 53s): `cost: 526`.
- `metadata.cost_fiat` - Float, **USD**. Gleicher Anruf: `cost_fiat: 0.10420301650668388`.
  Deckt sich exakt mit AUFTRAG-B2-Zeile ("0,1042"). Die Umrechnung Credits->USD ist NICHT
  ueberall 1:1 gleich: 526 Credits = 0,1042 USD (~198 Credits/USD), aber bei
  `conv_4301m14a...` (12s-Anruf): 80 Credits = 0,01552 USD (~5155 Credits/USD). Der
  Umrechnungskurs Credits->USD ist selbst gemischt aus mehreren Unter-Preisen (siehe
  naechster Punkt) - Credits allein sind KEIN brauchbares Kosten-Proxy, `cost_fiat` schon.
- `metadata.charging` - vollstaendige Aufschluesselung, USD-Werte:
  - `charging.llm_price` (USD), `charging.llm_charge` (Credits) - Summe aus
    `llm_usage.irreversible_generation` + `llm_usage.initiated_generation`, je Modell
    (`claude-sonnet-5` in allen 8 Faellen) mit `input`, `input_cache_read`,
    `input_cache_write`, `output_total`, je mit `tokens` und `price` (USD).
  - `charging.platform_price` (USD) / `charging.platform_charge` (Credits) -
    `platform_usage.category_usage.voice` mit `credits`, `price` (USD), `quantity`
    (vermutlich Minuten-Bruchteil, z.B. `0.8799558313335485` beim 53s-Anruf - nicht
    weiter verifiziert, da fuer den Auftrag nicht noetig).
  - `charging.call_charge` ist in allen 8 gemessenen Faellen **identisch** zu
    `charging.platform_charge` (z.B. 353/353, 51/51, 233/233) - beide Felder tragen
    denselben Wert, `call_charge` ist offenbar ein Alias/Oberbegriff, kein eigener
    Kostenblock.
  - `charging.tts_usage` (Modell, Sekunden, Zeichen, pro Stimme) und `charging.asr_usage`
    (Modell, Anzahl Transkriptions-Calls, Sekunden) sind Mengenangaben OHNE eigenen
    Preis - ihr USD-Anteil steckt bereits in `platform_price`.
  - `charging.analysis` war in allen 8 Anrufen `price: 0, charge: 0` (keine
    Analyse-Kosten in diesem Zeitraum).
  - `charging.free_minutes_consumed` / `free_llm_dollars_consumed` waren in allen 8
    Faellen `0.0` - kein Freikontingent verbraucht.

  Bedeutung: `metadata.cost_fiat` ist der richtige Einzelwert fuer eine Ist-Kosten-Achse;
  `charging.llm_price` + `charging.platform_price` sollten in Summe `cost_fiat`
  ergeben (rechnerisch grob geprueft, z.B. 53s-Anruf: 0,034607 + 0,069596 = 0,104203 -
  stimmt auf die gemessene Nachkommastelle). Fuer eine Kostenart-Landkarte
  (`cost-ledger-map.js`) sind `llm_price` und `platform_price` die zwei sinnvollen
  Unter-Zeilen, `cost_fiat` die Summenzeile.

- Ist `cost_fiat` wirklich USD? Ja, direkt bestaetigt durch den unabhaengigen
  Konto-Endpunkt `GET /v1/user/subscription`: Feld `"currency":"usd"` fuer denselben
  Account, gleicher Zeitpunkt.

## 2. Ab wann ist `cost_fiat` stabil, aendert er sich nachtraeglich? (O3)

- Fakt: Der juengste verfuegbare EL-Anruf im gesamten Konto ist `conv_6101m190brwxe...`
  (30.08., 09:35:18 UTC, 35s) - zum Messzeitpunkt (13:54-13:58 UTC) bereits **rund 4
  Stunden 20 Minuten** alt. Ein frischeres Gespraech existiert nicht; ich durfte laut
  Auftrag keinen Testanruf ausloesen ("Keine schreibenden Anbieter-Aufrufe. Keine echten
  Anrufe").
- Fakt: Fuer diesen 4h20m alten Anruf wurde `cost_fiat` in dieser Session **26 Mal**
  abgerufen (1 Einzelabruf + 25 Abrufe im Rate-Limit-Burst, siehe Punkt 4) - der Wert war
  **byteidentisch** bei jedem Abruf: `0.07499824538794604`.
- Fakt: Der Wert deckt sich zusaetzlich EXAKT mit dem in AUFTRAG.md/B2 fuer denselben
  Anruf dokumentierten Wert (0,0750 USD, dort vermutlich zu einem fruegeren Zeitpunkt
  gemessen). Gleiches gilt fuer alle anderen 7 der 8 B2-Anrufe (Abgleich Zeile fuer
  Zeile: 0,1042/0,0859/0,1175/0,0099/0,0215/0,0155/0,1333/0,0750 - alle exakt getroffen).
- Bedeutung / was das BELEGT und was NICHT: Belegt ist Stabilitaet ueber eine Spanne von
  **mindestens ~4 Stunden 20 Minuten bis hin zu mehreren Tagen** (je nachdem, wann die
  Lead-Messung in AUFTRAG.md stattfand - das Datum dort ist nicht auf die Minute
  bekannt). NICHT gemessen und damit **OFFEN**: das Verhalten in den ersten Sekunden bis
  Minuten nach Gespraechsende (z.B. ob der Wert sofort bei `status: done` vollstaendig
  ist, oder ob eine Nachbearbeitung noch laeuft). Grund: es gab in der gesamten
  Kontohistorie (27 Konversationen) keinen Anruf, der juenger als 4h20m war, und ich
  durfte keinen erzeugen. **Diese Frage bleibt offen und ist an eine Session
  weiterzugeben, die entweder einen echten Testanruf ausloesen darf, oder die einen
  Anruf abfaengt, sobald er `status: done` erreicht.**
- Ergaenzender Fakt: Alle 20 `done`-Konversationen im Konto haben einen von zwei
  Status-Werten (`done` oder `failed`) - es gibt KEINEN Zwischenzustand wie
  `processing`/`in_progress` in der Liste. Das spricht dafuer, dass der Uebergang zu
  `done` bereits den fertigen Kostenwert traegt, ist aber ein indirektes Indiz, kein
  Beleg fuer den Zeitpunkt der Verfuegbarkeit.

## 3. `charging.tier` und Plan-Wechsel (O5)

- Fakt: `charging.tier` stand in allen 8 gemessenen B2-Anrufen (und in allen weiteren 19
  `done`-Konversationen des Kontos) auf `"starter"`.
- Fakt (unabhaengiger Beleg): `GET /v1/user/subscription` liefert `"tier":"starter"` fuer
  denselben Account, plus `"status":"active"`, `"currency":"usd"`,
  `"billing_period":"monthly_period"`, `"next_invoice":{"amount_due_cents":714,
  "subtotal_cents":600,...}` (7,14 USD faellig, davon 6,00 USD Grundgebuehr - passt zum
  oeffentlich kommunizierten Starter-Preis, siehe naechster Punkt).
- Fakt (oeffentliche Preisliste, `https://elevenlabs.io/pricing`, abgerufen 2026-08-30):
  Starter-Plan kostet 6 USD/Monat inkl. 30.000 Credits. Laut FAQ der Seite: bei einem
  **Upgrade** gelten neue Konditionen ab dem Wechselzeitpunkt, ungenutzte Credits aus dem
  alten Plan werden in den naechsten Abrechnungszeitraum uebertragen (NICHT: alte
  Nutzung wird zu neuen Konditionen neu berechnet). Bei einem **Downgrade** bleibt der
  aktuelle Plan bis zum Ende des laufenden Abrechnungszyklus aktiv, der Wechsel wirkt
  erst danach.
- Bedeutung: Ein Plan-Wechsel bei ElevenLabs ist **NICHT rueckwirkend** in beide
  Richtungen - er aendert weder nachtraeglich den `cost_fiat`-Wert bereits
  abgeschlossener Gespraeche, noch die Rate laufender Nutzung vor dem Wechseldatum. Fuer
  die Architektur bedeutet das: ein einmal gemessener/gebuchter `cost_fiat`-Wert ist
  final und muss bei einem spaeteren Tarifwechsel NICHT neu berechnet werden. Diese
  Aussage stuetzt sich auf die oeffentliche FAQ-Formulierung (WebFetch-Zusammenfassung,
  nicht die Original-HTML-Passage selbst geprueft) - als BELEGT im Sinn von "oeffentlich
  dokumentiert", nicht im Sinn von "am eigenen Konto durch einen echten Wechsel
  nachvollzogen" (dafuer haette ich den Plan wechseln muessen, was ausserhalb des
  Auftrags liegt).
- Eine Diskrepanz zur AUFTRAG-Vermutung: der Auftrag fragt nach dem Zusammenhang mit der
  "oeffentlichen Preisliste" allgemein - die zuerst gefundene Doku-Seite
  (`/docs/reception-ai/billing/plans-and-pricing`) beschreibt ein ANDERES Produkt
  ("Reception AI", Tarife Basic/Plus/Premium, 1 Credit/Minute Telefon) und ist NICHT die
  fuer unseren ConvAI-Agent-Pfad (`agent_id`, SIP-Trunk-Outbound) einschlaegige Seite.
  Die tier-Bezeichnungen dort (Basic/Plus/Premium) sind NICHT dieselben wie
  `charging.tier: "starter"` im gemessenen Konto. Fuer eine spaetere Preisherleitung: die
  allgemeine Pricing-Seite (`elevenlabs.io/pricing`) und `GET /v1/user/subscription`
  sind die verlaesslichen Quellen, nicht die Reception-AI-Doku.

## 4. Rate-Limits auf dem Abruf (O3/O4)

- Fakt: In KEINEM der insgesamt uber 60 GET-Antworten in dieser Session (8 Einzelabrufe,
  27 Voll-Abrufe fuer die Konto-Summe, 25 Burst-Abrufe, 2 Konto-Endpunkte, 1 Listen-Abruf)
  erschien ein Rate-Limit-Header (`x-ratelimit-*`, `retry-after` - explizit per `grep -i`
  gegen alle mitgeschnittenen Response-Header gesucht, kein Treffer).
- Fakt: Ein Burst von 25 unmittelbar aufeinanderfolgenden `GET
  /v1/convai/conversations/{id}`-Aufrufen gegen dieselbe Conversation-ID lieferte 25x
  HTTP 200, kein einziges HTTP 429.
- Bedeutung: Innerhalb dieser Groessenordnung (25 Requests in wenigen Sekunden, einzelner
  API-Key) ist kein Rate-Limit sichtbar - weder als Grenze noch als Ankuendigungs-Header.
  Das ist eine **untere Schranke**, keine Aussage ueber das tatsaechliche Limit: fuer
  einen produktiven Sweep-Prozess mit zehntausenden Tenants/Anrufen waere ein deutlich
  groesserer Burst noetig, um die reale Grenze zu finden, und das war mit dem
  Auftrags-Rahmen ("NUR GET", keine Lastprobe) nicht angemessen. **Offen bleibt**, ob und
  bei welcher Groessenordnung ElevenLabs drosselt - dafuer gibt es keine oeffentlich
  dokumentierte Zahl, die ich in dieser Session geprueft haette (nicht gesucht, da
  ausserhalb des Zeitbudgets und mit Rate-Limit-Tests grundsaetzlich ein Vorsichtsgebot
  verbunden ist).

## 5. Kontostands-/Verbrauchs-Endpunkt als zweite Kontrolle (O3, Abgleich)

- Fakt: `GET /v1/user/subscription` existiert und liefert ohne Parameter Konto-weite
  Werte: `tier`, `character_count` (34530), `character_limit` (63996),
  `next_character_count_reset_unix` (1788432631 = 2026-09-03 10:50:31 UTC),
  `currency: "usd"`, `current_overage: {"amount":"0","currency":"usd"}`,
  `next_invoice: {"amount_due_cents":714,"subtotal_cents":600,...}`.
- Fakt: `GET /v1/user` existiert, liefert Konto-Stammdaten (`user_id`, `subscription`
  eingebettet, `subscription_extras: null`) - KEINE zusaetzliche Kosten-/Kreditgroesse
  gegenueber `/v1/user/subscription`.
- Fakt: Es gibt in beiden Endpunkten KEIN Feld, das "verbrauchte Credits/USD in diesem
  Abrechnungszeitraum, aufgeschluesselt nach Conversational-AI-Nutzung" direkt ausweist.
  Die einzigen geldwerten Felder sind `current_overage` (0 USD - noch keine
  Ueberschreitung des Plankontingents) und `next_invoice` (naechste Rechnung, im
  Wesentlichen die Grundgebuehr).
- Fakt: `character_count` (34530) ist NICHT deckungsgleich mit der Summe von
  `charging.tts_usage.total_characters` ueber alle 27 Konversationen des Agenten
  (Summe = 11027, siehe naechster Punkt). Faktor rund 3,13.
- Bedeutung: `/v1/user/subscription` ist **konto-weit**, nicht agent-/tenant-scoped. Die
  Diskrepanz (34530 vs. 11027 Zeichen) zeigt, dass entweder (a) weitere Agenten/Projekte
  denselben API-Key/Account nutzen, deren Zeichen mitgezaehlt werden, oder (b) der
  Zaehler zusaetzliche Zeichen-Quellen ausserhalb von ConvAI-Gespraechen erfasst (z.B.
  direkte TTS-API-Aufrufe), oder (c) einen anderen Abrechnungszeitraum als die
  27-Konversationen-Liste zugrunde legt. Welche der drei Ursachen zutrifft, habe ich
  NICHT geklaert - dafuer fehlt Einsicht in andere moegliche Projekte/Agenten auf
  demselben Account, und das war ausserhalb des Auftragsrahmens. **Ergebnis fuer die
  Architektur-Frage: der Konto-Endpunkt taugt NICHT als sauberer unabhaengiger
  Cross-Check auf Ebene "Summe der Hermes-Anrufe", weil er andere Groessen mitzaehlt und
  in Credits/Zeichen, nicht in EUR-Cent-vergleichbaren Ist-Kosten pro Anruf, misst. Ein
  sauberer Abgleich kann nur ueber die Summe der Einzel-`cost_fiat`-Werte je Conversation
  laufen (Punkt 1), nicht ueber diesen Konto-Endpunkt.**

## Abschliessender Abgleich: Summe Einzelgespraeche vs. Kontostand

- Fakt: Summe `metadata.cost_fiat` ueber ALLE 27 Konversationen des Agenten (20 `done` +
  7 `failed`, gesamte im Konto sichtbare Historie, `has_more:false`): **2,3261297060346457
  USD**. Summe `metadata.cost` (Credits) derselben 27: **11723 Credits**.
- Fakt: `current_overage.amount` = "0" USD zum Messzeitpunkt.
- Abweichung: Es gibt **keine direkt vergleichbare Kontostand-Zahl**, gegen die sich die
  2,33 USD Summe prüfen liesse - `current_overage` ist 0, weil 11723 Credits
  offensichtlich innerhalb der 30.000 monatlichen Starter-Credits liegen (die Rechnung
  zahlt nur die 6-USD-Grundgebuehr, keine Ueberschreitung). Ein Abgleich "Summe
  Einzelanrufe gegen Kontostand" ist bei diesem Konto-Stand **strukturell nicht
  moeglich**, weil der einzige geldwerte Vergleichswert (`current_overage`) per
  Konstruktion 0 bleibt, solange man innerhalb des Plankontingents liegt. Das ist keine
  Abweichung im Sinne einer Unstimmigkeit, sondern eine Grenze des verfuegbaren
  Kontroll-Endpunkts: er wuerde erst dann etwas zum Vergleich beitragen, wenn das Konto
  ueber sein Plankontingent hinaus verbraucht (dann muesste `current_overage` in der
  Groessenordnung liegen, die "Verbrauch minus 30.000 Credits" entspricht - bei aktuell
  11723 von 30.000 Credits ist das Konto weit davon entfernt).
- Bedeutung fuer den Auftrag: die von der Lead-Messung in AUFTRAG.md B2 vorgeschlagene
  Rechnung (Summe der 8 angenommenen Anrufe = 56,28 US-ct / 4,77 Minuten = 11,81
  US-ct/min im Schnitt) ist mit meiner unabhaengigen Nachmessung derselben 8
  Conversation-IDs **exakt reproduziert** (identische `cost_fiat`-Werte bis auf die
  gemessene Nachkommastelle). Der von O5 geforderte zweite, unabhaengige Kontroll-Pfad
  ueber einen Konto-Endpunkt existiert zwar (`/v1/user/subscription`), traegt aber in
  diesem Konto-Zustand (weit unter Plankontingent) keine pruefbare Information bei - das
  ist selbst ein Befund, kein Ausweichen.

## Zusammenfassung der offenen Punkte (fuer die naechste Session)

1. **Zeitpunkt der Verfuegbarkeit von `cost_fiat` nach Gespraechsende** (Sekunden bis
   Minuten) ist ungemessen - es gab keinen frischen Anruf, und ich durfte keinen
   ausloesen. Zu klaeren beim naechsten echten Testanruf: `cost_fiat` direkt nach
   `status: done` abrufen und mit einem zweiten Abruf 5-10 Minuten spaeter vergleichen.
2. **Reale Rate-Limit-Schwelle** ist nicht gefunden (nur eine untere Schranke: 25
   Requests/Sekunde-Groessenordnung sind unauffaellig).
3. **Ursache der 34530-vs-11027-Zeichen-Diskrepanz** im Konto-Endpunkt ist ungeklaert
   (andere Agenten/Projekte auf demselben Account? anderer Zeitraum? andere
   Zeichen-Quelle?) - relevant nur, falls der Konto-Endpunkt doch als Kontrollpfad genutzt
   werden soll, was nach dem obigen Befund aber nicht zu empfehlen ist.
4. Die Aussage zu Plan-Wechsel/Rueckwirkung (Punkt 3) stuetzt sich auf eine
   WebFetch-Zusammenfassung der oeffentlichen FAQ, nicht auf einen selbst durchgefuehrten
   Plan-Wechsel am Konto - ein Restrisiko, dass die FAQ-Formulierung Nuancen verliert,
   bleibt.
