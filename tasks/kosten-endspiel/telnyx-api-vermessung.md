# Telnyx-API-Vermessung fuer Ist-Kosten-Sweep (cost truing)

Datum/Zeit aller Messungen: 2026-07-21, 16:12-16:22 UTC. Basis: `TELNYX_API_BASE` ist in `.env`
NICHT gesetzt -> Default aus `src/config.js:197` greift: `https://api.telnyx.com`. Key aus `.env`
(`TELNYX_API_KEY`, Laenge 58 Zeichen, NIE ausgegeben). Alle URLs unten ohne Key.

Werkzeug-Falle notiert: `curl` interpretiert `[` `]` in Query-Strings als eigene URL-Globbing-Syntax
(Range-Expression) -> `curl: (3) URL using bad/illegal format`. Fix: `--globoff`. Alle folgenden
Befehle nutzen `--globoff`.

Read-only bestaetigt: keine Aenderung unter `src/`, kein Commit, kein Sweep-Skript ausgefuehrt,
keine schreibende DB-Anweisung.

Rufnummern in allen Beispielen maskiert (`+49***2163` etc.).

Gesamtzahl API-Anfragen in dieser Session: 105 (S1:1, S2:7, S3:5, S4:9, S5:6, S7-Burst:41,
S7-Recovery:1, S7-Confirm:35). Dazu 1 versehentliche unauthentifizierte Anfrage vor S1 waehrend
der curl-Fehlerdiagnose (ohne Authorization-Header, zaehlt vermutlich nicht gegen das
authentifizierte Kontingent, wurde aber nicht separat vermessen -> als Unsicherheit vermerkt).

---

## S1 — Header-Inventar

Befehl:
```
curl -s --globoff -D hdr.txt -o body.json -w '%{http_code} %{time_total}\n' \
  -H "Authorization: Bearer $KEY" \
  "https://api.telnyx.com/v2/detail_records?filter[record_type]=sip-trunking&page[size]=1"
```
Zeitpunkt: 2026-07-21T16:13:45Z. Status: 200.

Header (vollstaendig):
```
HTTP/2 200
date: Tue, 21 Jul 2026 16:13:45 GMT
content-type: application/json;charset=utf-8
content-length: 2051
access-control-allow-origin: *
access-control-allow-methods: POST, OPTIONS, HEAD
access-control-allow-headers: origin, content-type, accept
server: cloudflare
cache-control: no-store
x-ratelimit-limit: 40, 40;w=60
x-ratelimit-remaining: 39
x-ratelimit-reset: 15
x-request-id: f6b3aef8-0bdd-973a-b6c0-879ac2886ff5
x-envoy-upstream-service-time: 317
cf-cache-status: DYNAMIC
strict-transport-security: max-age=0
cf-ray: a1eb7ea76ad37065-DUS
```

**Befund**: Es gibt genau drei Kontingent-Header, in Kleinschreibweise, NICHT im `Retry-After`-
oder `X-RateLimit-*`-Schema, sondern `x-ratelimit-limit` (Format `"40, 40;w=60"` — RFC-artige
Doppelnotation, zweiter Teil = Fenstergroesse in Sekunden), `x-ratelimit-remaining`,
`x-ratelimit-reset` (Sekunden-Countdown). Kein `Retry-After`-Header vorhanden (auch bei 429 in
S7 nicht, siehe dort). Keine weiteren Kontingent-Hinweise.

meta-Objekt: `{"total_pages": 212, "total_results": 212, "page_number": 1, "page_size": 1}`
(page_size in der ANTWORT = angefordert, weil 1 <= Maximum; siehe S3 fuer das echte Maximum).

---

## S2 — Feld-Inventar je record_type

7 Anfragen, je `page[size]=1`, 2026-07-21T16:14:02Z bis 16:14:10Z, alle Status 200.

### Zeitfelder je Typ (Frage a)

| record_type | Zeitfelder |
|---|---|
| sip-trunking | `started_at`, `finished_at`, `answered_at` |
| call-control | `started_at`, `finished_at` |
| recording | `started_at`, `finished_at` |
| speech-to-text | `start_time`, `end_time` |
| text-to-speech | `created_at` (einziges Zeitfeld) |
| inference | `created_at` (einziges Zeitfeld) |
| ai-voice-assistant | `created_at`, `completed_at` |

### Wasserstands-Tauglichkeit (Frage b)

**Kein Feldname ist auf allen 7 Typen identisch vorhanden.** Ein einzelner, ueber alle Typen
gemeinsamer Wasserstands-Feldname existiert NICHT (3 verschiedene Namensfamilien:
`started_at`/`finished_at`, `start_time`/`end_time`, `created_at`). Ein Wasserstands-Einzug
braucht pro Typ eine eigene Feldzuordnung, nicht ein einziges generisches Feld.

### Mengenangabe text-to-speech (Frage c)

Unmaskierter Auszug (nicht-sensibel: Provider/Zeichenzahl, keine PII):
```
provider = 'elevenlabs'
number_of_characters = 238
cost = '1.666E-4'
rate = '7.0E-7'
```
**Befund: JA**, `text-to-speech`-Belege tragen `number_of_characters` (int) UND `provider`
(`elevenlabs`). ElevenLabs-Verbrauch je Anruf ist damit aus Telnyx-Belegen ableitbar — sofern
die Zuordnungs-IDs (naechster Abschnitt) zum Anruf passen.

Bonus-Beleg (unmaskiert, nicht-sensibel) `ai-voice-assistant`:
```
stt_model = 'deepgram/flux'
tts_provider = 'elevenlabs'
tts_model_id = 'eleven_flash_v2_5'
duration_sec = 31
billed_sec = 60
cost = '0.05'
rate = '0.05'
rate_measured_in = 'ai_voice_assistant_minutes'
```
Bestaetigt den bereits belegten Stand: 31s echte Dauer -> 60s abgerechnet (Minute
aufgerundet/Minimum), Kosten 0,05 flat.

### Zuordnungs-IDs je Typ (Frage d)

| record_type | ID-Felder |
|---|---|
| sip-trunking | `call_control_id`, `telnyx_session_id` |
| call-control | `telnyx_leg_id`, `telnyx_session_id` |
| recording | `telnyx_session_id` (KEIN `call_control_id`!) |
| speech-to-text | `call_leg_id`, `call_session_id` |
| text-to-speech | `call_leg_id`, `call_session_id` |
| inference | `conversation_id` (im Sample-Beleg `null`) |
| ai-voice-assistant | `call_control_id`, `telnyx_leg_id`, `telnyx_session_id`, `conversation_id` |

---

## S3 — Paginierungs-Semantik (record_type=sip-trunking)

5 Anfragen, 2026-07-21T16:15:11Z bis 16:15:18Z, alle Status 200.

### Echtes page[size]-Maximum (Frage a)

| angefordert | `meta.page_size` (Antwort) | tatsaechliche Datensatzzahl |
|---|---|---|
| 250 | 50 | 50 |
| 100 | 50 | 50 |
| 50 | 50 | 50 |

**Befund**: Hartes Maximum ist **50**, unabhaengig von der Anfrage — bestaetigt D3
(`COST_RECORDS_PAGE_SIZE=250` kann `page.raw.length===250` NIE erreichen, der Schutz ist tot).

### page[number]=1 vs 2 vs 3 bei size=50 (Frage b)

Alle drei: `meta.page_size = 50` durchgehend stabil. **Der in einer Vormessung beobachtete Abfall
auf 20 wurde HIER NICHT reproduziert** — bei size=50 blieb page_size ueber 3 Seiten konstant 50.
Befund: WIDERLEGT fuer diese Konstellation (record_type=sip-trunking, size=50, Seiten 1-3); die
alte Beobachtung bleibt fuer andere Parameter-Kombinationen ungeklaert.

### Ueberlappung/Luecken/Sortierung (Frage c)

- Ueberschneidung Seite1/Seite2 (IDs): **leere Menge** — keine Duplikate.
- Seite1: `started_at` faellt von `2026-07-21T10:58:51Z` (erster Eintrag) auf
  `2026-07-06T15:52:02Z` (letzter Eintrag).
- Seite2: setzt bei `2026-07-06T15:47:24Z` fort, faellt bis `2026-06-29T13:02:19Z`.
- Seite3: setzt bei `2026-06-29T13:00:47Z` fort, faellt bis `2026-06-20T13:53:15Z`.

**Befund**: Default-Sortierung ist **absteigend nach `started_at`** (neueste zuerst), Seiten
schliessen luecken-/ueberlappungsfrei aneinander an, in dieser Stichprobe.

### total_results vs. total_pages*page_size (Frage d)

`total_results=212`, `total_pages=5`, `page_size=50`. `5*50=250 != 212`. **Befund**: Verhaeltnis
ist `total_pages = ceil(total_results / page_size)` (hier `ceil(212/50)=5`), NICHT ein exaktes
Produkt. Wer `total_pages*page_size` als Belegzahl annimmt, ueberschaetzt sie.

---

## S4 — Zeitfilter / Wasserstands-Tauglichkeit

9 Anfragen, 2026-07-21T16:16:09Z bis 16:16:30Z.

### Filter-Parameter, Status + Trefferzahl (Frage a)

| Filter | record_type | Status | Treffer (`meta.total_results`) |
|---|---|---|---|
| `filter[started_at][gte]=2026-07-20T00:00:00Z` | sip-trunking | 200 | **4** |
| `filter[date_range]=last_7_days` | sip-trunking | 200 | **18** |
| `filter[created_at][gte]=2026-07-20T00:00:00Z` | sip-trunking | 200 | **0** |

Gegenprobe: sip-trunking hat laut S2 KEIN `created_at`-Feld (nur `started_at`/`finished_at`/
`answered_at`). Unfiltered total fuer denselben Typ ist 212 (S1/S3). **Befund: ein Filter auf ein
beim jeweiligen record_type nicht existierendes Feld fuehrt NICHT zu einem Fehler, sondern zu
einem stillen 200 mit 0 Treffern.** Das ist eine Falle: ein 200/0 beweist nicht, dass im Zeitraum
nichts passiert ist — es kann auch heissen, der Filtername passt nicht zum Typ.

### Gilt derselbe Zeitfilter fuer alle Typen? (Frage b)

| Filter | record_type | Status | Treffer |
|---|---|---|---|
| `filter[started_at][gte]=2026-07-20T00:00:00Z` | speech-to-text | 200 | **0** |
| `filter[created_at][gte]=2026-07-20T00:00:00Z` | text-to-speech | 200 | **2** |

speech-to-text hat laut S2 kein `started_at` (sondern `start_time`) -> 0 Treffer trotz vorhandener
Datensaetze (89 total laut S2). text-to-speech hat `created_at` -> Filter griff, 2 Treffer, Beleg
zeigt `created_at: '2026-07-21T10:59:00Z'`.

**Befund: NEIN, derselbe Filtername gilt NICHT fuer alle Typen.** Der Filterparameter muss exakt
den Feldnamen des jeweiligen Typs treffen (`started_at` fuer sip-trunking/call-control/recording,
`start_time` fuer speech-to-text [ungetestet ob `filter[start_time]` existiert — s. offene Fragen],
`created_at` fuer text-to-speech/inference/ai-voice-assistant). Ein gemeinsamer,
zeitfenster-basierter Einzug ueber alle Typen braucht pro Typ den korrekten Feldnamen im Filter.

### record_type weglassen / mehrfach angeben (Frage c)

| Variante | Status | Body |
|---|---|---|
| ohne `filter[record_type]` | **400** | `{"code":"10011","title":"Bad Request","detail":"Record type is missing"}` |
| `filter[record_type][]=sip-trunking&filter[record_type][]=call-control` | **400** | `{"code":"10011","title":"Bad Request","detail":"Record type is missing"}` |

**Befund**: `record_type` ist PFLICHT und akzeptiert laut dieser Messung KEIN Array — die
Mehrfachangabe wird von der API wie "fehlend" behandelt (identischer Fehlercode). Ein Sweep MUSS
pro record_type eine eigene Anfrage stellen; die Hoffnung "1 Abfrage fuer alle Typen" ist
**widerlegt**.

### sort-Parameter (Frage d)

| Parameter | Status | Ergebnis (erste 3 IDs in Reihenfolge) |
|---|---|---|
| `sort=-started_at` | 200 | identische 3 Records, identische Reihenfolge wie unten |
| `sort=started_at` | 200 | identische 3 Records, identische Reihenfolge |

Beide Anfragen lieferten exakt dieselben 3 Datensaetze in derselben Reihenfolge (neueste zuerst,
`2026-07-21T10:58:51Z`, `2026-07-21T10:58:51Z`, `2026-07-21T10:22:57Z`).

**Befund: der `sort`-Parameter hat in dieser Messung KEINE erkennbare Wirkung** — weder
`-started_at` noch `started_at` aendert die Reihenfolge gegenueber dem Default (absteigend). Status
ist 200 (kein Fehler), aber die Sortierung bleibt fix. Das ist wichtig fuer D2: man kann sich nicht
per `sort=started_at` (aufsteigend, aeltestes zuerst) einen einfachen Wasserstands-Einzug
"von vorne nach hinten" erkaufen — die API liefert augenscheinlich immer absteigend.

---

## S5 — Alternative Bezugswege / Push statt Poll

6 Anfragen, 2026-07-21T16:17:08Z bis 16:17:30Z.

| Endpunkt | Status | Befund |
|---|---|---|
| `GET /v2/reports/cdr_usage_reports` | **404** | existiert nicht |
| `GET /v2/detail_record_reports` | **404** | existiert nicht |
| `GET /v2/usage_reports` | **400** | EXISTIERT — Fehler `"Product invalid value"`, verlangt Pflichtparameter `product` |
| `GET /v2/reports/mdr_usage_reports` | **200** | EXISTIERT, `{"data":[],"meta":{"total_pages":0,"total_results":0,"page_number":1,"page_size":20}}` — leer (keine Reports angelegt) |
| `GET /v2/billing_groups` | **200** | EXISTIERT, `{"data":[],"meta":{"total_pages":0,"total_results":0,"page_number":1,"page_size":25}}` — leer (keine Billing-Gruppen konfiguriert) |
| `GET /v2/usage_reports?product=sip-trunking` | **400** | Fehler `"Dimensions invalid values"` + `"Metrics invalid values"` — Endpunkt existiert, verlangt weitere Pflichtparameter |

Fehlerbody `usage_reports` (nicht-sensibel, enthaelt nur Enum-Werte): der Fehler zaehlt exakt
dieselben 7 Produktwerte auf, die auch als `record_type` in `/v2/detail_records` vorkommen
(`sip-trunking, call-control, ai-voice-assistant, speech-to-text, text-to-speech, recording,
inference`, plus viele weitere Produkte).

Fehlerbody `usage_reports?product=sip-trunking` (Auszug, nicht-sensibel):
```
Dimensions: date,connection_type,tn_type,tags,billing_group_id,country_code,hangup_details,
  outbound_profile_id,source_tn_type,date_time,connection_id,bundle_id,short_duration_call,
  gcb_zone_id,source_country_code,currency,tn,is_local_calling,call_type,country_iso,
  sip_response_code,direction
Metrics: connected,cost,attempted,call_sec,completed,billed_sec
```

**Befund**: `/v2/usage_reports` ist ein AGGREGATIONS-Endpunkt (Dimensionen wie `date`,
`connection_type`, `country_code` — keine Zuordnungs-ID wie `call_control_id`). Er eignet sich
augenscheinlich fuer Summen-Reporting (z.B. Tagesumsatz je Verbindungstyp als Gegenprobe), NICHT
als Ersatz fuer `/v2/detail_records` bei der Pro-Anruf-Zuordnung, weil keine anrufspezifische ID
als Dimension gelistet ist. `/v2/reports/mdr_usage_reports` und `/v2/billing_groups` existieren,
sind aber leer/ungenutzt in diesem Konto — ob sie asynchrone CSV-Exporte erzeugen koennen (POST),
wurde NICHT getestet (nur GET, s. offene Fragen).

**Rate-Limit-Ueberraschung**: `/v2/usage_reports` traegt einen **eigenen, viel strikteren
Rate-Limit-Header**: `x-ratelimit-limit: 5, 5;w=1` (5 Anfragen/Sekunde), voellig verschieden von
`/v2/detail_records` (`40, 40;w=60`). **Das widerlegt die Annahme eines EINEN, kontoweiten
Kontingents** — Rate-Limits sind hier pro Endpunkt unterschiedlich konfiguriert.

---

## S6 — Latenz-Obergrenze (PASSIV, KEINE echte Latenzmessung)

Keine neue Anfrage. Aus den bereits vorliegenden Belegen (S1-S5):
- juengster `started_at` (sip-trunking) in den Stichproben: `2026-07-21T10:58:51Z`
- juengster `created_at` (text-to-speech) in den Stichproben: `2026-07-21T10:59:00Z`
- Uhrzeit der Beobachtung: `2026-07-21T16:17:39Z` (`date -u`)

Differenz ca. 5h19min. **Das ist AUSDRUECKLICH KEINE Latenzmessung** — es zeigt nur, wann der
letzte in den Stichproben gesehene echte Anruf stattfand, nicht wie schnell EIN konkreter,
abgeschlossener Anruf als Beleg auftaucht. Um echte Verfuegbarkeits-Latenz zu messen, braucht es
einen Testanruf mit bekanntem Endzeitpunkt und wiederholtes Abfragen danach (ownerAktion, siehe
unten).

---

## S7 — Rate-Limit-Experiment

Reihenfolge zuletzt ausgefuehrt, wie vorgeschrieben. Start: `date -u` = `2026-07-21T16:18:15Z`
(kein Hinweis auf einen parallel laufenden echten Anruf zu diesem Zeitpunkt bekannt).

### (a) Burst

Sequentiell dieselbe Anfrage (`filter[record_type]=sip-trunking&page[size]=1`), keine Pause,
Skript `s7_burst.py`, Start `2026-07-21T16:18:30Z`.

Ergebnis (gekuerzt, vollstaendiges Log in Scratch `s7_burst/log.txt`):
```
n=1  elapsed_ms=317   status=200   (x-ratelimit-remaining=39, reset=30)
...
n=40 elapsed_ms=12856 status=200   (x-ratelimit-remaining=0,  reset=18)
n=41 elapsed_ms=13017 status=429
```

429-Antwort komplett (Header):
```
HTTP/2 429
x-envoy-ratelimited: true
x-ratelimit-limit: 40, 40;w=60
x-ratelimit-remaining: 0
x-ratelimit-reset: 17
(KEIN Retry-After-Header)
```
429-Body:
```
{"errors":[{"code":"10011","detail":"You have exceeded the maximum number of allowed requests.",
"meta":{"url":"https://developers.telnyx.com/docs/overview/errors/10011"},"title":"Too many requests"}]}
```

**Befund**: Erster 429 nach GENAU 40 erfolgreichen Anfragen (n=1..40 alle 200, n=41 429).
`x-ratelimit-remaining` zaehlte sauber 39,38,...,0 herunter — deckungsgleich mit dem `40, 40;w=60`
Header aus S1. Kein `Retry-After`, nur `x-ratelimit-reset`.

### Zusatzbefund vor (b): Fenster ist an die volle UTC-Minute gebunden, nicht gleitend

Vergleich der `reset`-Countdowns aus mehreren, zeitlich verstreuten Anfragen (S1-S4, alle auf
`/v2/detail_records`):

| Anfrage-Zeitpunkt (UTC) | reset (s) | Zeitpunkt + reset |
|---|---|---|
| 16:13:45 | 15 | 16:14:00 |
| 16:14:11 | 50 | 16:15:01 |
| 16:15:18 | 42 | 16:16:00 |
| 16:16:30 | 30 | 16:17:00 |
| 16:18:43 (429) | 17 | 16:19:00 |
| 16:21:00 (S7c, Start) | 60 | 16:22:00 |

**Befund: alle Reset-Zeitpunkte fallen exakt (bzw. bis auf Rundung) auf die volle Minute.** Das
Rate-Limit-Fenster ist ein **fixes, an die UTC-Kalenderminute gebundenes Fenster** (volles
Reset auf 40 bei jedem Minutenwechsel), KEIN gleitendes 60-Sekunden-Fenster. Das ist ein
belastbarer, aus mehreren unabhaengigen Messpunkten (nicht nur dem Burst) rekonstruierter Befund.

### (b) Erholung

Erster Versuch nach dem 429, `2026-07-21T16:19:22Z` (39s nach dem 429 um 16:18:43): **sofort 200**,
`x-ratelimit-remaining: 39`. Konsistent mit dem Fenster-Reset auf die volle Minute (16:19:00) —
zum Pruefzeitpunkt lag bereits eine neue, fast volle Quote vor.

### (c) Bestaetigung

Abgeleitete Regel: 40 Anfragen pro UTC-Kalenderminute, harte Reset-Grenze bei `:00`. Test:
35 Anfragen (bewusst < 40), gleichmaessig ueber ein volles Fenster verteilt (Intervall 60/35≈1,71s),
Start exakt bei `16:21:00Z` (`s7_confirm.py`, wartet aktiv bis zur vollen Minute).

Ergebnis: **`N=35 count_200=35 count_429=0`** — keine einzige 429. Header erste Anfrage
(`16:21:00Z`): `remaining=39, reset=60`. Header letzte Anfrage (`16:21:58Z`, n=35):
`remaining=5, reset=2`. Rechnung stimmt exakt: `40 - 35 = 5`.

**Befund: BESTAETIGT.** Regel haelt: 40 Anfragen/60s-Fenster, Fenster an die volle UTC-Minute
gebunden. Fenstergroesse ist damit nicht nur "Anzahl bis zum ersten 429", sondern durch (b)+(c)
tatsaechlich als Fenstermechanik belegt.

---

## Kapazitaets-Aussage (nur aus gemessenen Zahlen)

Gemessene Bausteine:
- **Belege/Seite (hart)**: 50 (S3a — Anfrage von 250/100/50 liefert immer `meta.page_size=50`)
- **Seiten/Fenster**: 40 (S7a/b/c — 40 Anfragen pro Fenster, danach 429; bestaetigt mit 35/Fenster
  ohne 429)
- **Fenster/Stunde**: 60 (Fenster = 60s, an die volle Minute gebunden, S7-Zusatzbefund)

=> **Theoretisches Maximum: 50 × 40 × 60 = 120.000 Belege/Stunde**, WENN jede Anfrage eine neue,
nicht-redundante Seite abruft (also der D1-Fehler — 7 redundante Anfragen pro Anruf ohne
anrufspezifischen Filter — behoben ist).

Einschraenkungen dieser Zahl (gemessen, keine Vermutung):
1. Dieses Kontingent ist **geteilt ueber alle 7 record_types**, weil `record_type` nicht
   kombinierbar ist (S4c) — 7 separate Anfrage-Straenge teilen sich denselben 40/Minute-Topf auf
   demselben Endpunkt `/v2/detail_records`.
2. Zeitfilter (`filter[<feldname>][gte]`) funktionieren NACHWEISLICH pro Typ (S4a/b) und liefern
   gezielt nur die relevanten Belege statt ganzer Seiten — das senkt den TATSAECHLICHEN Bedarf weit
   unter das theoretische Maximum, wurde aber in dieser Messung nicht in "Belege pro Anruf bei
   Zeitfilter-Nutzung" uebersetzt (dafuer fehlen konkrete Anruf-Zeitstempel als Testfaelle).
3. Diese Kapazitaet gilt NUR fuer `/v2/detail_records`. `/v2/usage_reports` hat ein eigenes,
   deutlich engeres Limit (5/Sekunde) — bei Mischnutzung beider Endpunkte in einem Sweep muessten
   beide Kontingente separat eingehalten werden.
4. Das Kontingent ist vermutlich kontoweit (nicht pro IP/Prozess) — das wurde in dieser Messung
   NICHT geprueft (nur eine Quelle/ein Prozess getestet), bleibt also fuer den Mehrprozess-Fall
   unbelegt.

---

## Rohdaten-Ablage (Scratch, nicht Teil des Repos)

Alle Header- und Body-Dumps liegen unter
`/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/2ddab87f-ca18-40b9-b7aa-0c87425b6426/scratchpad/kosten/`
(Unterordner `s7_burst/`, `s7_recovery/`, `s7_confirm/` sowie `s1_*`, `s2_*`, `s3_*`, `s4_*`,
`s5_*`-Dateien). Diese Dateien enthalten dieselben (bereits maskierten wo noetig) Rohdaten wie
oben zitiert; keine Secrets darin (Key wurde nie in eine Datei geschrieben).
