# Doku-Recherche Telnyx (Ist-Kosten-Erfassung / Cost Truing)

Methode: NUR Web-Recherche (WebSearch/WebFetch) gegen developers.telnyx.com,
support.telnyx.com, telnyx.com/release-notes. KEIN API-Call gegen api.telnyx.com,
KEIN Code-Read, KEIN Schreibzugriff. Alle Zitate stammen aus WebFetch-Zusammenfassungen
der jeweiligen Doku-Seite (das Fetch-Tool liest die Seite und fasst zusammen — kein
manuelles Copy-Paste des rohen HTML durch mich). Status ist deshalb **nie hoeher als
TEILWEISE**, auch wenn eine OpenAPI-Spezifikation zitiert wird: Doku ist Zusage, keine
Messung, und die Telnyx-Doku hat in diesem Projekt bereits nachweislich falsch gelegen
(vgl. belegter Stand: Paginierung, Feldnamen leg_id/call_leg_id).

Kein Befund hier darf als Grundlage fuer Code-Aenderungen dienen, ohne live gegen die
echte API verifiziert zu werden.

---

## Q-DOC1 — Rate-Limits

**Headers dokumentiert** (developers.telnyx.com/development/api-fundamentals/reliability/rate-limiting):
> "x-ratelimit-limit: Displays the applicable rate limits for the current request";
> "x-ratelimit-remaining: Indicates how many requests a user can still make within the
> current time window"; "x-ratelimit-reset: Shows the time in seconds until the rate
> limit resets."

Kein `Retry-After`-Header dokumentiert (in der gefetchten Zusammenfassung nicht erwaehnt).

**Konkrete Zahl (req/s oder req/min) fuer `/v2/detail_records` oder allgemein:
NICHT gefunden.** Einzige oeffentlich dokumentierte numerische Limits betreffen Messaging
(SMS 50 msg/s, MMS 15 msg/s, RCS 1 msg/s laut drdroid.io-Zusammenfassung, NICHT Telnyx
selbst — Drittseite, schwaecher als TEILWEISE). Fuer die allgemeine REST-API sagt die
Recherche ausdruecklich: "Telnyx does not publicly document specific rate-limit tiers or
per-plan request quotas in their developer docs."

**Fehlercode 10011**: "Too many requests" / "You have exceeded the maximum number of
allowed requests." (developers.telnyx.com/docs/v2/development/api-guide/errors,
per WebSearch-Zusammenfassung).

**Hoehere Limits auf Anfrage**: Doku empfiehlt "Contact support@telnyx.com if you find
you are exceeding the rate limit" — kein zugesagter Prozess, keine Zahlen, nur ein
Hinweis auf Support-Kontakt.

Fazit Q-DOC1: Die von uns gemessene Rate-Limit-Schwelle (erster 429 bei Anfrage #36
in kurzer Zeit) hat **keine dokumentierte Entsprechung** — wir kennen die Kontogrenze
nur aus der eigenen Messung, nicht aus der Doku.

---

## Q-DOC2 — Detail Records API

**record_type Enum** (developers.telnyx.com/api/detail-records/search-detail-records,
OpenAPI-Spec-Zusammenfassung): `ai-voice-assistant, amd, call-control, conference,
conference-participant, embedding, fax, inference, inference-speech-to-text,
media_storage, media-streaming, messaging, noise-suppression, recording, sip-trunking,
siprec-client, stt, tts, verify, webrtc, wireless` — 21 Werte, deckt sich mit den bei
uns tatsaechlich beobachteten Typen (sip-trunking, ai-voice-assistant, call-control,
recording, tts).

**Mehrere record_types gleichzeitig filtern**: In keiner gefundenen Quelle dokumentiert.
Alle Beispiele zeigen genau einen Wert (`filter[record_type]=messaging`). **UNBELEGT**,
ob ein Array/`in`-Operator existiert.

**Paginierung**: `page[size]`: "default: 20, minimum: 1, maximum: 50";
`page[number]`: "default: 1, minimum: 1" (developers.telnyx.com/api/detail-records/search-detail-records).
Das deckt sich mit dem live gemessenen D3-Befund (Telnyx deckelt tatsaechlich bei 50,
unabhaengig vom gesetzten `COST_RECORDS_PAGE_SIZE=250`) — Doku und Messung stimmen hier
ausnahmsweise ueberein.

**sort**: Array von Strings, Beispiel `sort=-created_at` fuer absteigend.

**Weitere Filter**: `filter[date_range]` Enum `yesterday, today, tomorrow, last_week,
this_week, next_week, last_month, this_month, next_month` + dynamisches
`last_N_days`-Format; `filter[created_at]` als Objekt mit `gte`/`lt`; `filter[direction]`;
`filter[cld]`, `filter[status]` mit Operatoren `contains`/`starts_with`/`ends_with`.

Wichtiger Doku/Messungs-Widerspruch (nicht neu von mir gemessen, aus belegtem Stand
bekannt): laut Doku existiert `filter[created_at][gte]` als generischer Filter, live
gemessen lieferte er aber 0 Treffer auf unserem Konto, waehrend `filter[started_at][gte]`
funktionierte. Die Doku nennt `started_at` in der von mir gefetchten Zusammenfassung gar
nicht als Filterfeld — ein weiterer Hinweis, dass die OpenAPI-Zusammenfassung nicht
vollstaendig ist oder pro record_type unterschiedliche Felder gelten.

**Aufbewahrungsdauer / Retention**: **In keiner gefundenen Quelle explizit genannt.**
Weder die Detail-Record-Search-Doku noch die "Reporting: Detail Requests"-Support-Seite
noch das Release-Note nennen eine Zahl (Tage/Monate/Jahre), wie weit Detail Records
rueckwirkend abrufbar sind. Einzige verwandte Zahl: Call-Recordings (Audio, nicht
Kostenbelege) werden laut Support-Artikel "for 1 year" aufbewahrt, ausdruecklich als
separates Thema. **UNBELEGT fuer Kostenbelege — das ist eine echte Luecke, die jede
Nachhol-Aktion (wie weit rueckwirkend nachbuchen) begrenzt und die wir nicht aus der
Doku beantworten koennen.**

---

## Q-DOC3 — Push statt Poll

**CDR-Webhook mit Kosteninformation**: **Nicht gefunden.** Es gibt Call-Control-Webhooks
(`call.initiated`, `call.hangup` etc.), aber keine Quelle belegt einen Webhook-Typ, der
Kosten/Preis-Felder enthaelt. Recording-Callbacks liefern nur die Recording-URL, keine
Kosten.

**CDR Usage Reports API** (developers.telnyx.com/api-reference/cdr-usage-reports/*):
Existiert als eigener Endpunkt-Satz (create + list). Ablauf ist tatsaechlich asynchron:
Response-Schema enthaelt ein Feld `report_url`, Beispielwert
`"http://portal.telnyx.com/downloads/report_name_8hvb45Gu.csv"` — also Report-Job +
CSV-Download-Link, kein Sync-Response mit Rohdaten.
ABER: Die Dimensionen sind **aggregiert, nicht Einzelanruf**: `aggregation_type` nimmt
Werte "All / By Connections / By Tags / By Billing Group" an, `product_breakdown` nimmt
"No breakdown / DID vs Toll-free / Country / DID vs Toll-free per Country". Keine
Erwaehnung von `call_control_id` als Dimension oder Spalte.
**Fazit: Fuer unseren Zweck (Beleg pro einzelnem Anruf, verknuepfbar ueber
call_control_id) ist dieser Report-Weg nach Doku-Stand WERTLOS** — er aggregiert exakt
auf der Ebene, die wir nicht brauchen (Summe je Billing-Group/Tag/Connection statt
Zeile je Anruf).

**Telnyx Storage (S3-kompatibel)**: Ist ein generisches Objektspeicher-Produkt
(telnyx.com/products/cloud-storage). **Keine Quelle belegt eine automatische
CDR/Kostenbeleg-Ablieferung in einen Storage-Bucket.** Es scheint ein eigenstaendiges
Speicherprodukt zu sein, keine Billing-Export-Pipeline.

**Portal-Report ("Reporting: Detail Requests", support.telnyx.com/en/articles/4424926)**:
Beschreibt einen manuellen Portal-Flow — "Generate Detailed Report" -> Status unter
"Download Report" -> Download-Link erscheint, mit Refresh-Moeglichkeit. Das ist eine
UI-Funktion, keine dokumentierte API dafuer gefunden, und die Granularitaet (Einzelanruf
vs. aggregiert) wird in der gefetchten Zusammenfassung nicht spezifiziert. **UNBELEGT.**

**Kafka/Streaming-Feed fuer Billing-Daten**: In keiner Suche aufgetaucht. **UNBELEGT,
vermutlich existiert es nicht** (aber "existiert nicht" ist bei Doku-Recherche nie
beweisbar, nur "nicht gefunden").

Fazit Q-DOC3: Nach Doku-Stand gibt es **keinen dokumentierten Push-Weg mit
Einzelanruf-Granularitaet**. Der einzige asynchrone Report-Mechanismus mit
Download-Link (CDR Usage Reports API) aggregiert genau auf der falschen Ebene fuer
unseren Anwendungsfall.

---

## Q-DOC4 — Latenz

**Keine dokumentierte Zusage gefunden**, wie schnell ein Detail Record nach
Gespraechsende verfuegbar ist. Weder die Detail-Record-Search-Doku noch die
CDR-Usage-Reports-Doku noch die "Understanding Telnyx CDR"-Supportseite (dort 404 beim
Abruf, siehe unten) nennen eine Zahl. Einzige verwandte, aber themenfremde Zusage:
Recording-URLs sind "valid for 10 minutes after the call has ended" — das betrifft
Audio-Aufnahmen, nicht Kostenbelege, und ist keine Verfuegbarkeits-, sondern eine
Gueltigkeitsdauer-Aussage.
`https://support.telnyx.com/en/articles/1130662-understanding-telnyx-cdr` lieferte beim
WebFetch-Versuch HTTP 404 (Seite existiert laut Suchindex, war aber nicht direkt
abrufbar — moeglicherweise JS-Rendering oder verschobene URL). **UNBELEGT.**

Fazit Q-DOC4: Die bei uns gemessene Obergrenze von 17 Minuten hat **keine dokumentierte
SLA-Entsprechung** — wir wissen aus der Doku nicht, ob 17 Minuten normal, das Maximum
oder ein Ausreisser sind.

---

## Q-DOC5 — Mandantenfaehigkeit

**Managed Accounts** (support.telnyx.com/en/articles/4951492-managed-accounts):
> "A Managed Account is a sub-account created from within an existing Mission Control
> Portal account (which we call a manager account)."
- Eigene Bilanz: "Managed Accounts have their own account balances, payment methods,
  and invoices"; "billing for managed accounts does not roll up onto the manager
  account level."
- Eigener API-Key pro Managed Account: "Manager accounts can also create an API key
  associated with a Managed Account, and control the Managed Account via the Telnyx
  API." — das wuerde implizit auch **eigene Rate-Limit-Buckets pro Tenant** bedeuten,
  wenn Rate-Limits pro API-Key gelten (das ist selbst nicht dokumentiert, siehe Q-DOC1 —
  Doku sagt nicht, ob Limits pro Key oder pro Konto/Org gelten).
- Limit: "Manager accounts, by default, can only have a maximum limit of 1000 managed
  sub accounts."
- Preisvererbung: "Managed Accounts inherit pricing from their manager accounts. If
  your organization has a committed use agreement for lower rates, your Managed
  Accounts will have those rates automatically."

**Organizations** (anderes Feature, support.telnyx.com/en/articles/1189141):
> "User organizations is a feature that allows multiple user accounts to be tied
> together into one larger 'umbrella' entity." Aber: "user organizations are allowed
> only one net running balance and payment method - it is not meant to be a system for
> re-sellers to allow their customers access to their Telnyx account directly."
- **Organizations ist damit fuer unseren Zweck (Kosten je Endkunde trennen) NICHT
  geeignet** — nur EINE Bilanz/Zahlungsmethode fuer die ganze Organisation.

Konsequenz fuer Nummern-Bereitstellung (meine Einordnung, KEIN Doku-Zitat, daher
gesondert markiert als Ableitung, nicht als Befund): 1 Managed Account je Tenant wuerde
bedeuten, pro Tenant eine eigene DID-Beschaffung/-Verwaltung im jeweiligen
Sub-Account-Kontext zu betreiben — ein Architektur-Umbau (heute: 1 Konto, viele Tenants
in unserer eigenen DB). Ob das bei "1000 Sub-Accounts default" fuer Millionen Endkunden
skaliert, ist offen (Kontingent laut Doku erhoehbar? nicht gefunden).

Fazit Q-DOC5: Managed Accounts ist der dokumentierte Mechanismus fuer
Kostentrennung je Endkunde bei Telnyx; Organizations ist es explizit NICHT.

---

## Q-DOC6 — Billing-Groups/Tags am Beleg (die potenziell elegante Loesung)

**billing_group_id ist real und laesst sich beim ausgehenden Call setzen** — Dial-Command
(developers.telnyx.com/api-reference/call-commands/dial), Parameterbeschreibung
woertlich: "Use this field to set the Billing Group ID for the call. Must be a valid
and existing Billing Group ID." (optional, kein Pflichtfeld).

**billing_group_id taucht dokumentiert in Detail Records wieder auf** — aber bisher NUR
belegt fuer den `webrtc`-record_type (developers.telnyx.com/development/webrtc/troubleshooting/detail-records),
dort als Feld `billing_group_id` + `billing_group_name` neben `cost`, `rate`, `currency`,
`billed_sec`, `tags`. **Fuer die bei uns tatsaechlich relevanten record_types
(`sip-trunking`, `call-control`, `ai-voice-assistant`, `recording`, `tts`) habe ich
KEINE Doku-Seite gefunden, die explizit bestaetigt, dass billing_group_id auch dort im
Beleg erscheint.** Das ist der entscheidende offene Punkt — siehe ownerAktion unten.

**billing_group_id als Dimension in Usage Reports**: Bestaetigt fuer SIP-Trunking
("shown in SIP-Trunking dimensions list") und als `aggregation_type: "By Billing Group"`
in der CDR-Usage-Reports-API — das ist ein indirekter Hinweis, dass Telnyx
billing_group_id tatsaechlich auch fuer SIP-Trunking-Traffic (unser Pfad) mitfuehrt,
sonst waere eine Aggregation danach sinnlos. Aber: Dimension in einem AGGREGIERTEN
Report zu sein beweist nicht, dass das Feld auch in der EINZELNEN Detail-Record-Zeile
auftaucht.

**tags**: Ebenfalls in WebRTC-Detail-Records und als Usage-Report-Dimension
dokumentiert. Kein `tags`-Parameter in der Dial-Command-Doku gefunden (nur
`billing_group_id` und `client_state`) — **UNBELEGT, ob Tags sich beim Call-Aufbau
setzen lassen.**

**client_state**: Woertlich dokumentiert als "Use this field to add state to every
subsequent webhook. It must be a valid Base-64 encoded string." — **das ist explizit nur
fuer Webhooks beschrieben, KEINE Quelle nennt client_state als Feld, das im Kostenbeleg
(Detail Record) wieder auftaucht.** client_state ist damit nach Doku-Stand der falsche
Mechanismus fuer diese Frage.

**Custom Billing Groups anlegen**: API-Endpunkte existieren (create/list/get/update
billing group, developers.telnyx.com/api/billing-groups/*). Keine Quelle nennt ein
Maximum an Billing Groups pro Konto. **UNBELEGT.**

Fazit Q-DOC6: **billing_group_id ist der vielversprechendste Kandidat** — settable beim
Dial, dokumentiert im Kostenbeleg (zumindest fuer webrtc), dokumentiert als
Report-Dimension fuer SIP-Trunking. Aber die Kette ist NICHT geschlossen: ob das Feld
auch in `sip-trunking`/`call-control`/`ai-voice-assistant`-Detail-Records tatsaechlich
auftaucht, ist reine Doku-Vermutung, keine Messung. `client_state` ist nach Doku
klar NICHT der richtige Weg (nur Webhook-Kontext).

---

## Zusammenfassung offener Fragen (nur mit Owner-Aktion oder mit API-Zugriff messbar)

1. Erscheint `billing_group_id` tatsaechlich in `filter[record_type]=sip-trunking` /
   `call-control` / `ai-voice-assistant` Detail Records, wenn beim Dial gesetzt? —
   Nur durch einen echten Testanruf MIT gesetztem `billing_group_id` + anschliessendem
   `GET /v2/detail_records?filter[record_type]=sip-trunking&filter[call_leg_id]=...`
   pruefbar (Aufgabe fuer den Agenten mit API-Zugriff, NICHT mich).
2. Retentions-/Lookback-Zeitraum fuer Detail Records — in der Doku nirgends genannt.
   Nur durch einen gezielten API-Call mit einem sehr alten Datum feststellbar
   (z.B. `filter[date_range]=last_90_days` o.ae., API-Agent).
3. Existiert ein Array-/`in`-Filter fuer mehrere `record_type`-Werte gleichzeitig? —
   Nur durch echten API-Call pruefbar.
4. Maximale Anzahl Billing Groups pro Konto — in der Doku nicht genannt, ggf. nur per
   Rueckfrage an Telnyx-Support klaerbar.
5. Gilt das Rate-Limit pro API-Key oder pro Konto/Organisation? — nicht dokumentiert;
   relevant fuer die Frage, ob Managed Accounts das Rate-Limit-Problem (D1) tatsaechlich
   entschaerfen wuerden.
