# Befund: Telnyx-Belegpfad fuer die SIP-Trunk-Legs der ElevenLabs-Anrufe (O1, O2)

Gemessen 2026-08-30, read-only gegen den Live-Telnyx-Account (`GET /v2/detail_records`,
Bearer aus `.env`, nie ausgegeben). Methode und Parameterform aus
`src/telephony/adapters/telnyx/voice.js` uebernommen (`filter[record_type]`, `page[size]=50`,
`page[number]=1..5`), nicht neu erfunden.

## Datengrundlage

Aus der Produktions-DB (Tabelle `call`, Tenant `t_user_01KX600834GCJFV9GTZQKWZMTH`,
`started_at` 2026-08-19 bis 2026-08-30, RLS via `set_config('app.current_tenant', ...)`):
12 Anrufe der EL-Engine, alle mit `sip_call_id` (`otb_...`), alle mit leerem
`call_control_id`. 8 `completed`, 4 `failed`. `from_e164` (angefordert) ist in allen 12
Zeilen `+17067101188`; die tatsaechlich am Telnyx-Beleg gemessene Absender-DID (`cli`)
weicht davon in 11 von 12 Faellen ab (siehe Ueberraschungen).

Gegen Telnyx abgerufen: `filter[record_type]=sip-trunking`, alle 5 Seiten (`page[size]=50`),
`meta.total_pages=5`, `meta.total_results=250` — das komplette Konto, keine Zeitfilterung
serverseitig (im Bestandscode dokumentiert: `filter[created_at][gte]` existiert fuer diesen
Typ nicht, liefert 200/0 statt eines Fehlers). Zeitfenster: Datensaetze liegen von
2026-07-01T08:24:03Z bis 2026-08-30T09:35:13Z — deckt sowohl den EL-Zeitraum als auch den
alten Telnyx-Engine-Zeitraum ab.

## O1 — Fuehrt Telnyx Belege fuer die EL-SIP-Legs, und unter welchem Schluessel?

**Fakt:** JA. Fuer alle 12 abgefragten `sip_call_id`-Werte des Tenants liefert
`/v2/detail_records?filter[record_type]=sip-trunking` genau EINEN Treffer je ID, und der
Treffer traegt das Feld `sip_call_id` mit EXAKT demselben `otb_...`-String wie
`call.sip_call_id` in unserer DB. Kein Fuzzy-Match, keine Teilstring-Heuristik noetig —
strikte String-Gleichheit auf einem Feld, das im Beleg bereits existiert.

**Beleg:** Stichprobe (voller Roh-Record fuer `otb_4101m190brwyf4mb9cwvhts7rymk`, Anruf
`call_mtfm5ss7g3jz`, 30.08. 09:35:12Z-09:36:00Z):

    record_type=sip-trunking, sip_call_id=otb_4101m190brwyf4mb9cwvhts7rymk,
    call_control_id=(leer), telnyx_session_id=19cc8394-a456-11f1-9056-02420aefb020,
    started_at=2026-08-30T09:35:13Z, finished_at=2026-08-30T09:35:53Z,
    billed_sec=60, call_sec=35, cost=0.0401, rate=0.0401, currency=USD,
    cld=+491737252163, cli=+17067101188, hangup_cause=NORMAL_CLEARING

Alle 12/12 gemessen (Skript-Join `sip_call_id == sip_call_id`, Trefferzahl je ID: 1);
Zeitstempel (`started_at`/`finished_at`) liegen jeweils innerhalb weniger Sekunden der
DB-Werte `started_at`/`ended_at` desselben Anrufs. Die 4 `failed`-Anrufe (Status
`CALL_REJECTED`) tragen ebenfalls einen Treffer, korrekt mit `billed_sec=0`, `cost="0.0"`.

Gegenprobe (Pflicht laut Auftrag, damit "12/12 Treffer" nicht zufaellig aussieht): dieselbe
Abfrage, derselbe Belegtyp, gegen den ALTEN Zeitraum (vor dem 19.08., Telnyx-Budget-Engine,
`call_control_id` statt `sip_call_id`) liefert im selben Pool 237 Datensaetze mit
`started_at < 2026-08-19`, davon 224 mit nicht-leerem `call_control_id`. Zwei konkrete,
aus der DB gezogene `call_control_id`-Werte (`v3:tAObcN5h...`, `v3:ucMvxOI1...`) liefern im
Beleg-Pool exakt 2 bzw. 1 Treffer. Die Abfrageform ist damit nicht "falsch gefragt" —
sie liefert dort, wo bereits BELEGTES Beweismaterial existiert (AUFTRAG B1: 56/56
abgeglichen), ebenfalls Treffer.

Zusatzbefund (nicht gefragt, aber Teil derselben Messung): von den 13 sip-trunking-Belegen
im EL-Zeitraum tragen ALLE 13 `sip_call_id`, KEINER `call_control_id`. Der bestehende
zweistufige Zuordnungsmechanismus (`ANCHOR_ROUTE` ueber `call_control_id`, dann
`SESSION_ID_FIELDS`) wuerde auf JEDEN EL-Beleg mit `reason=session_unresolved` verwerfen,
weil sein erster Zuordnungsweg (`call_control_id`) fuer diesen Belegtyp im EL-Fall
strukturell leer ist — das bestaetigt exakt B1 aus dem Auftrag, jetzt mit dem
GEGEN-Beleg: der Beleg selbst existiert und liesse sich zuordnen, nur nicht ueber den
heute verdrahteten Schluessel.

**Bedeutung:** Der Join-Schluessel fuer den EL-Weg ist NICHT der bestehende
`call_control_id`/`telnyx_session_id`-Mechanismus, sondern ein einfacherer, direkter
Vergleich: `raw.sip_call_id === call.sip_call_id`. Das ist strukturell SICHERER als der
zweistufige Session-Mechanismus (der laut Code-Kommentar in `voice.js` selbst als
"nie unter Parallelverkehr gemessen" markiert ist) — ein direkter Primaerschluessel-Treffer
statt einer Session-Heuristik. `COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control`
ist fuer den Typ `sip-trunking` damit als real gelieferter Typ bestaetigt; ob `call-control`
fuer den EL-Weg ebenfalls Belege fuehrt, wurde in dieser Messung NICHT geprueft (nicht Teil
von O1/O2, s. Offene Punkte).

## O2 — Telnyx-Anteil je Minute auf dieser Strecke

**Fakt:** Kein einzelner konstanter Satz. Gemessen zwei unterschiedliche Minutenpreise,
abhaengig vom TERMINIERUNGSTYP des Ziels, nicht von Datum, Uhrzeit oder Anrufdauer:

| Zieltyp (gemessen ueber `term_lrn_city`) | Rate | Anrufe (von 8 completed) | Beispiel |
|---|---|---|---|
| Deutsches Mobilfunkziel ("Mobile telephony service") | 0,0401 USD/min = 4,01 US-Cent/min | 7 von 8 | `otb_4101...` |
| Deutsches Festnetzziel ("Meerbusch-Buederich") | 0,0231 USD/min = 2,31 US-Cent/min | 1 von 8 | `otb_2401...` |

**Beleg:** `rate`-Feld je Record identisch mit dem impliziten `cost/billed_sec*60` —
Mobilfunk-Records: `rate=0.0401`, `billed_sec=60`, `cost=0.0401` (7x identisch, inkl. der
Anrufe mit `call_sec` 8/12/16/35/41/43/53 — Telnyx rundet IMMER auf die volle Minute auf,
bestaetigt den bereits im Repo dokumentierten 60-Sekunden-Sockel). Festnetz-Record:
`rate=0.0231`, `billed_sec=120`, `cost=0.0462` (= 2 x rate). Die 4 `failed`-Anrufe:
`rate="0"`, `billed_sec=0`, `cost="0.0"` — korrekt keine Kosten fuer nicht angenommene
Anrufe. `currency="USD"` auf allen 13 Records ohne Ausnahme (deckt sich mit der
EL-Kostenmessung aus dem Auftrag, ebenfalls USD — kein Waehrungsbruch zwischen den beiden
Kostentraegern, das erleichtert O4, loest es aber nicht: der Kurs-Pfad in
`providerToBucketRateMicro` selbst wurde hier nicht geprueft).

Der genannte Umrechnungsfaktor `10^8` (`MICRO_CENTS_PER_CURRENCY_UNIT` in
`cost-parse.js`) ist KEINE Einheit, in der die Rohdaten ankommen — der Rohwert ist ein
Dezimalstring in der Hauptwaehrungseinheit (z.B. `"0.0401"` = 4,01 US-Cent). Der Faktor
10^8 ist der Schiebefaktor, der diesen String in Mikro-Cent umrechnet
(0,0401 USD x 10^8 = 4.010.000 Mikro-Cent = 4,01 Cent). Praezisierung gegenueber dem
Auftragswortlaut ("Betraege kommen in 10^-8-Einheiten"): sie kommen NICHT so an, sie werden
so umgerechnet — inhaltlich folgenlos fuer die Architektur, aber falsch zitiert waere ein
Fehler in der naechsten Weiterverarbeitung.

**Bedeutung:** Der Telnyx-SIP-Anteil ist auf dieser Strecke klein gegen die
ElevenLabs-Kosten aus dem Auftrag (B2), aber NICHT vernachlaessigbar strukturell — er
gehoert als EIGENE Kostenart mit eigenem Minutenpreis in die Kostenlandkarte, nicht addiert
zur EL-Schaetzung. Ueber die 8 angenommenen Anrufe: Telnyx-Summe 7 x 0,0401 + 0,0462 =
0,3269 USD (32,69 US-Cent) auf 9 ABGERECHNETEN Minuten (Aufrundung), gegen 56,28 US-Cent
ECHTE EL-Kosten auf 4,77 REALEN Minuten aus dem Auftrag — zwei verschiedene
Zeitbasen (abgerechnet vs. real), die ein gemeinsamer Ist-Kosten-Abgleich NICHT vermischen
darf: Telnyx rechnet in vollen Minuten ab, ElevenLabs pro Turn/Sekunde. Ein Kurzanruf
(8 Sekunden, `otb_2001...`) zahlt bei Telnyx trotzdem die volle Minute (4,01 US-Cent) —
das verschaerft exakt das in B2 beschriebene Problem "kurze Anrufe sind pro Minute teuer"
noch einmal, auf einer zweiten, unabhaengigen Kostenachse.

Die B6-Falle aus dem Auftrag ist damit QUANTITATIV bestaetigt: ein Abgleich, der NUR den
Telnyx-SIP-Anteil misst (aktuell zwischen 0 und 33 US-Cent ueber die 8 Anrufe) und diesen
gegen die 270 EUR-Cent gebuchte Schaetzung stellt, wuerde faelschlich ~90 % der Buchung als
"zu hoch" korrigieren — die 56 US-Cent ECHTEN EL-Kosten sind darin nicht erreichbar,
weil kein Telnyx-Beleg sie traegt (ElevenLabs berechnet sein eigenes LLM/TTS/ASR, nicht
Telnyx). Ein Ist-Kosten-Abgleich fuer den EL-Weg braucht also BEIDE Quellen (ElevenLabs
`metadata.cost_fiat` UND Telnyx `sip-trunking`), niemals nur eine.

## Antwort auf die explizite Frage "Gibt es ueberhaupt keinen Beleg?"

Nein — das Gegenteil ist der gemessene Fall: der Beleg existiert, ist vollstaendig
(12 von 12 unserer EL-Anrufe gefunden), und traegt einen exakten, eindeutigen
Schluessel (`sip_call_id`), der besser ist als der heute fuer den alten Pfad genutzte
zweistufige Anker-/Session-Mechanismus. Das ist die wichtigste Korrektur gegenueber der
im Auftrag offen gelassenen Moeglichkeit "kein Beleg" — sie trifft NICHT zu.

## Ueberraschungen (nicht Teil des Auftrags, aber architekturrelevant)

1. **Absender-DID im Beleg weicht vom angeforderten `from_e164` ab.** Die DB traegt fuer
   alle 12 Anrufe `from_e164=+17067101188`. Der TATSAECHLICH am Telnyx-Beleg gemessene
   Absender (`cli`) ist aber `+15739090177` (7 Anrufe, 19.-20.08.), `+18643028341`
   (2 Anrufe, 27.-28.08.) und erst beim letzten Anruf (30.08., `otb_4101...`)
   `+17067101188` — also identisch mit dem angeforderten Feld. Das deckt sich mit der
   bestehenden Notiz zum E5-Cutover ("Absender-DID LIVE seit 08-30"): vor diesem Datum
   ging die tatsaechlich gewaehlte Absender-Nummer am angeforderten Feld vorbei, seit
   30.08. stimmen beide ueberein. Fuer den Kostenpfad selbst ist das ohne Wirkung (der
   Join laeuft ueber `sip_call_id`, nicht ueber die DID) — aber es ist ein zweiter,
   unabhaengiger Beleg fuer einen bereits bekannten Sachverhalt, hier erstmals am
   TELNYX-seitigen Record statt nur am eigenen DB-Feld sichtbar.
2. **Ein 13. EL-Beleg im Zeitraum gehoert zu KEINEM der 12 abgefragten Anrufe:**
   `otb_8601m0cgxdvcepzrdg7yd8v8fye1`, `started_at=2026-08-19T08:06:30Z`, `billed_sec=120`,
   `cost=0.0802`, Ziel `+491737252163`. Er liegt VOR dem ersten unserer 12 DB-Anrufe
   (17:32:37Z am selben Tag). Ob das ein anderer Tenant, ein Test-/Diagnostic-Anruf oder
   ein Anruf ausserhalb des abgefragten Tenant-Filters ist, wurde NICHT weiter verfolgt —
   ausserhalb des Auftragsumfangs (O1/O2 gelten dem gemessenen 12er-Set) und aus
   Zeit-/Kostenbudget dieser Session nicht mehr geprueft. Offene Frage, nicht Teil der
   beiden hier beantworteten O-Punkte.

## Was diese Messung NICHT beantwortet (bewusst ausserhalb des Auftrags dieser Session)

- O3 (Stabilitaet/Verzug von `metadata.cost_fiat` bei ElevenLabs) — reiner
  ElevenLabs-Endpunkt, hier nicht abgefragt.
- O4 (Waehrungspfad `providerToBucketRateMicro` fuer USD) — hier nur der Fakt "beide
  Quellen liefern USD" belegt, der Kurs-Code selbst wurde nicht gelesen.
- Ob `record_type=call-control` fuer den EL-Weg ebenfalls Belege liefert — nicht
  abgefragt, da O1/O2 sich auf `sip-trunking` beziehen; `COST_TRUING_REQUIRED_RECORD_TYPES`
  verlangt beide Typen als Pflicht-Typen, ein vollstaendiger Pool-Fetch braeuchte also auch
  diesen Typ gemessen — offen fuer eine Folgemessung.
