# PLAN-KOSTEN-ENDSPIEL

Strategie-Plan zum endgueltigen Abschluss der Ist-Kosten-Erfassung (Nachfolger von
`PLAN-LIVE-COST-TRACING.md`). Stand 2026-07-21.

> **UMSETZUNGSSTAND 2026-07-22: alle Code-Phasen umgesetzt und auf `master` gemergt,
> NICHT deployed.** Phase 0, 1, 2, 3, 4, 5, 6, 6b, 8 sind fertig (je ein Bericht unter
> `tasks/ke-p<N>-report.md`). Phase 7 ist Owner-Aktion und bleibt offen —
> vorbereitet in `tasks/ke-DEPLOY-CHECKLIST.md`.
> Umsetzungs-Spezifikation: `tasks/kosten-endspiel/impl-spec.md`.
> Suite 2861/0 -> **2932/0**. Live laeuft weiterhin `3516c31`.
>
> Was sich gegenueber diesem Plan als anders herausgestellt hat, steht in Kapitel 9.

Grundlage sind Messungen aus einer Fan-out-Vermessung (5 Messagenten, je ein
Gegenpruefer mit Widerlegungs-Auftrag) plus Nachmessungen des Leads an Prod-DB und
Telnyx-API. Rohprotokolle: `tasks/kosten-endspiel/`.

**Regel dieses Dokuments:** jede Zahl ist entweder gemessen (mit Befehl und Ausgabe) oder
ausdruecklich als **UNBELEGT** markiert. Dieses Thema ist zweimal an plausiblen,
ungemessenen Annahmen gestorben. Wer hier eine Zahl ergaenzt, liefert die Messung mit.

---

## 0. Was sich gegenueber dem Auftrag geaendert hat

Drei Punkte der Auftragsbeschreibung sind durch Messung ueberholt. Sie stehen hier vorn,
damit sie nicht weitergetragen werden:

| Auftrag sagte | Messung sagt |
| --- | --- |
| 3 Kandidaten liefern `params_missing` (fehlendes `startedAt`/`endedAt`) | Kein einziger Call hat leere Zeitstempel. Die 3 sind `status=failed`-Anrufe ohne jede Leg-Referenz (Origination scheiterte nach ~350 ms) und laufen im Sweep als `uebersprungen`, nicht als `params_missing`. Sie verbrauchen keinen Versuch. |
| D4: "der Fehlerpfad ist stumm" | Nur halb. Der Sweep loggt sehr wohl aggregierte Zaehler (`unbestimmt=<n>`). Stumm ist die **Ursache**: HTTP-Status und Telnyx-Code erreichen den Log nie, weil `catch {` (voice.js:318) den Fehler nicht einmal bindet. |
| Das Rate-Limit ist kontoweit (ein Topf fuer alles) | Es ist **pro Endpunkt** konfiguriert: `/v2/detail_records` traegt `40, 40;w=60`, `/v2/usage_reports` dagegen `5, 5;w=1`. Ein durchgedrehter Kosten-Sweep sprengt also nicht automatisch die Anrufsteuerung. Ob das Kontingent je Key oder je Konto zaehlt, bleibt UNBELEGT. |

---

## 1. Messprotokoll

Belegt heisst: eigener Befehl, eigene Ausgabe, in dieser Session. Doku heisst: Zitat aus
der Telnyx-/ElevenLabs-Dokumentation — eine Zusage, keine Messung.

### F1 — Das Rate-Limit-Fenster · BELEGT

`/v2/detail_records` erlaubt **40 Anfragen je fixem UTC-Minutenfenster**. Das Fenster ist
an die volle Kalenderminute gebunden, es gleitet nicht.

```
GET /v2/detail_records?filter[record_type]=sip-trunking&page[size]=1
-> x-ratelimit-limit: 40, 40;w=60
   x-ratelimit-remaining: 39
   x-ratelimit-reset: 15          (Sekunden bis zur naechsten vollen Minute)
```

Drei unabhaengige Messungen, nicht eine:

1. **Burst** (16:18:30Z): Anfragen 1–40 alle `200`, `remaining` zaehlt 39 -> 0; Anfrage 41
   ist `429` mit Telnyx-Code `10011`. **Kein `Retry-After`**, nur `x-ratelimit-reset=17`.
2. **Erholung**: 39 s nach dem `429` wieder `200` mit `remaining=39` — passend zum Reset
   um `:00`.
3. **Bestaetigung**: 35 Anfragen im Abstand von 1,71 s ueber ein volles, bei `:00`
   gestartetes Fenster -> **0 × 429**, `remaining` faellt exakt 39 -> 5.

Ohne Schritt 2 und 3 waere nur "40 bis zum ersten Fehler" belegt, nicht das Fenster.

**Kein einziger kontoweiter Topf.** `/v2/usage_reports` antwortet mit
`x-ratelimit-limit: 5, 5;w=1`. Die Kontingente sind pro Endpunkt konfiguriert.

**Kapazitaet** (Rechnung, Eingangsgroessen gemessen): 50 Belege/Seite × 40 Seiten/Minute ×
60 Minuten = **120.000 Belege je Stunde** — geteilt ueber alle 7 `record_type`, weil kein
Kombi-Filter existiert (F5).

*Grenze:* nur ein Prozess mit einem Key getestet. Ob das Kontingent je Key, je Konto oder
je Organisation zaehlt, ist **UNBELEGT** (U5). Die Kapazitaetsrechnung unten geht vom
unguenstigsten Fall aus (geteilt).

### F2 — Push statt Poll · BELEGT (negativ)

Es gibt keinen Push-Weg mit Einzel-Call-Granularitaet.

| Endpunkt | Ergebnis |
| --- | --- |
| `/v2/reports/cdr_usage_reports` | 404 — existiert nicht |
| `/v2/detail_record_reports` | 404 — existiert nicht |
| `/v2/usage_reports` | 400 (Pflichtparameter fehlen). Die Fehlermeldung listet die erlaubten Dimensionen: `date, connection_type, …` — **keine `call_control_id`**. Reines Aggregat. |
| `/v2/reports/mdr_usage_reports`, `/v2/billing_groups` | 200, aber im Konto leer/ungenutzt. POST nicht getestet (U11). |

Doku bestaetigt das Bild: die asynchrone "CDR Usage Reports"-API liefert einen
CSV-Download, aggregiert aber nach `All / By Connections / By Tags / By Billing Group` —
nie je Anruf. Kein CDR-Webhook mit Kostenfeldern auffindbar; "Telnyx Storage" ist ein
generischer S3-kompatibler Objektspeicher ohne CDR-Pipeline.

**Ein Aggregat ist fuer uns wertlos**: ohne Anruf-Bezug gibt es keinen Tenant-Bezug.

### F3 — Die echte CDR-Latenz · BELEGT (Obergrenze), Testanruf 2026-07-21

Die Doku gibt nichts her (Support-Seite "Understanding Telnyx CDR" ist 404). Also gemessen,
mit einem echten Anruf: `call_mrux7wjt0y01`, **Assistant-Pfad**, Ende
`2026-07-21T17:22:44.295Z` (Nullmarke aus der DB, nicht geschaetzt), Dauer 49,7 s.

| nach Gespraechsende | Beobachtung |
| --- | --- |
| **60 s** | ALLE 5 auf diesem Pfad anfallenden Belegtypen sichtbar; die Pflicht-Menge (`sip-trunking` + `call-control`) **vollstaendig** |
| **133 s** | der abgerechnete `sip-trunking`-Beleg (`cost=0.0401`, `billed_sec=60`) nachweislich vorhanden |
| **174 s** | Volldump, Summe ueber alle zugeordneten Belege = **0,094302 USD** gegen die Referenz 0,094267 — Datenlage vollstaendig UND wertrichtig |

**Ergebnis: die Belege sind spaetestens nach 133 s (2,2 min) vollstaendig und endgueltig.
Konfiguriert sind 180 Minuten** — das ist rund Faktor 80 zu konservativ.

*Grenzen, ehrlich:* n=1, nur der Assistant-Pfad, und es ist eine **Obergrenze** — der erste
Messpunkt lag bei 60 s, darunter wurde nicht gemessen. Ob der abgerechnete
`sip-trunking`-Beleg schon bei 60 s stand, ist offen (das Messskript nahm je Typ nur den
ersten Treffer und erwischte den Null-Zwilling, s. u.).

**Falle, die dabei sichtbar wurde — und die der Produktivcode bereits richtig loest:** je
Anruf existieren **zwei** `sip-trunking`- und **zwei** `call-control`-Belege — einer
abgerechnet (`billed_sec=60`, `call_sec=30`), einer echt bei null (`billed_sec=0`,
`call_sec=0`; das zweite Bein des Anrufs). Eine Implementierung nach dem Muster "erster
Treffer je Typ gewinnt" laese je nach Seitenreihenfolge 0,0401 USD unter den Tisch fallen
und erstattete real ausgegebenes Geld zurueck. `getVoiceCostRecords` summiert **alle**
zugeordneten Belege und ist damit korrekt — diese Eigenschaft ist ab jetzt bewusst zu
erhalten und gehoert in den Aequivalenztest aus Phase 2.

Drei Nebenmessungen desselben Anrufs, alle live bestaetigt:
`number_of_characters = 289` am `text-to-speech`-Beleg (F6, ElevenLabs je Anruf ablesbar);
Assistant-Aufschlag `0,05` bei 49,7 s (flat je ANGEFANGENER Minute); `call_sec 30` ->
`billed_sec 60` (60-s-Aufrundung).

Zusaetzlich gemessen: **Retention ≥ 31 Tage**. Belege vom 2026-06-20 waren am 2026-07-21
noch abrufbar (Seite 3 von `sip-trunking`). Untergrenze, keine Obergrenze.

### F4 — Session-Lokalitaet unter Parallelverkehr · BELEGT

Das war das schwerwiegendste Loch: die Zuordnung ruht darauf, dass eine Provider-Session
zu genau einem Anruf gehoert — gemessen war das nur an einer Stichprobe, in der **nie zwei
Anrufe gleichzeitig liefen**.

Der Testanruf war nicht noetig. In der Prod-DB liegt ein historisches Paar:

```sql
SET app.current_tenant='owner';
-- Selbstverbindung auf ueberlappende [started_at, ended_at]-Fenster, beide Tenants
call_mqxlyj3n6d2e  09:50:17 - 09:51:12   (2026-06-28)
call_mqxlz9qqthg6  09:50:52 - 09:51:15
-> Ueberlappung 20,4 s, beide completed, beide mit v3:-Leg-Token
```

Dann 12 gedrosselte API-Anfragen ueber alle 7 Typen (547 Belege gescannt,
`scratchpad/parallel_probe.py`):

```
LEG A: 2 Belege ueber den Anker   telnyx_session_id = c520bd2a-72d6-11f1-9566-…
LEG B: 1 Beleg  ueber den Anker   telnyx_session_id = d9a5d0e6-72d6-11f1-90e2-…
SESSION-SCHNITTMENGE: LEER
Belege, die NUR ueber die Session hereinkamen: A=5, B=4
  (call-control, recording, speech-to-text, text-to-speech)
```

**Die Invariante haelt unter Parallelitaet**, und die zweistufige Zuordnung traegt: 9 von
12 Belegen haengen ausschliesslich am Session-Weg — ohne ihn waeren sie verloren.

*Grenze, ehrlich:* n=1 Paar, gleicher Tenant, Budget-Pfad (TeXML), 20,4 s Ueberlappung.
Fuer den Assistant-Pfad und fuer tenant-uebergreifende Parallelitaet weiterhin ungemessen.
Aber: die Invariante hat ihren ersten echten Stresstest bestanden, statt weiter zu gelten,
weil sie nie gestresst wurde.

### F5 — Paginierungs-Semantik · BELEGT

| Frage | Messung |
| --- | --- |
| `page[size]`-Maximum | **50**, hart. Angefordert 250 / 100 / 50 -> `meta.page_size` ist immer 50. Doku bestaetigt `maximum: 50`. |
| Stabil ueber Seiten? | Ja. Seiten 1–3 mit `page[size]=50` liefern durchgehend `page_size=50`. Der frueher beobachtete Abfall auf 20 wurde **nicht reproduziert**. |
| Duplikate / Luecken | Keine. Schnittmenge der IDs von Seite 1 und 2 ist leer, die Zeitreihe schliesst luecken- und ueberlappungsfrei an (Seite 1 endet 15:52:02Z, Seite 2 beginnt 15:47:24Z). |
| Sortierung | Absteigend nach `started_at` (neueste zuerst) — gemessen an `sip-trunking`. `sort=-started_at` und `sort=started_at` liefern **identische** Antworten: der Parameter ist wirkungslos. |
| `meta` | `total_pages = ceil(total_results / page_size)`; gemessen `{total_results: 212, total_pages: 5, page_size: 50}` — also **nicht** `total_pages × page_size`. |
| Mehrere Typen je Anfrage | **Unmoeglich.** Ohne `filter[record_type]` -> 400 "Record type is missing". Array-Syntax `filter[record_type][]=a&…=b` -> ebenfalls 400. Ein Seitendurchlauf kostet zwingend 7 Anfragen. |

**Die gefaehrlichste Einzelmessung des ganzen Protokolls:**

```
filter[created_at][gte]=…  auf sip-trunking  -> HTTP 200, total_results = 0
```

obwohl `sip-trunking` gar kein Feld `created_at` hat. Ein falscher Filtername ist **kein
Fehler, sondern eine stille Leermenge**. Gegenprobe auf `speech-to-text` (Zeitfeld heisst
dort `start_time`): `filter[started_at]` liefert 0 Treffer trotz 89 vorhandener
Datensaetze. Das ist exakt der Fehlermodus, der 297 von 297 Belegen gekostet hat — nur
diesmal auf der Filter- statt auf der Feldnamen-Seite.

**Zeitfelder je Typ** (gemessen, drei Namensfamilien, keine Schnittmenge):

| record_type | Zeitfeld | Zuordnungs-IDs |
| --- | --- | --- |
| sip-trunking | `started_at` / `finished_at` | `call_control_id`, `telnyx_session_id` |
| call-control | `started_at` | `telnyx_leg_id`, `telnyx_session_id` |
| recording | `started_at` | **nur** `telnyx_session_id` — kein Anker |
| speech-to-text | `start_time` / `end_time` | `call_leg_id`, `call_session_id` |
| text-to-speech | `created_at` | `call_leg_id`, `call_session_id` |
| inference | `created_at` | nur `conversation_id` (strukturell unzuordenbar) |
| ai-voice-assistant | `created_at` / `completed_at` | `call_control_id`, `telnyx_leg_id`, `telnyx_session_id`, `conversation_id` |

Kein Feldname existiert auf allen Typen. Ein Wasserstands-Einzug braucht eine
**Pro-Typ-Feldzuordnung**, kein generisches Feld.

### F6 — ElevenLabs pro Tenant · BELEGT, und die Ausgangslage kippt

Die Ausgangslage stimmt: der Zaehler `recordTtsCharacters` (state-ops.js:2351) schreibt auf
ein **globales** Objekt ohne Tenant-Dimension und wird nur vom Budget-Pfad gefuettert
(einziger Aufrufer: `directive-synth.js:64`). Auf dem Assistant-Pfad synthetisiert Telnyx
serverseitig ueber `api_key_ref` — unser Prozess sieht davon nichts. Bezahlt wird es aus
**unserem** ElevenLabs-Konto (Telnyx haelt nur eine Referenz auf das Integration-Secret).

**Neu und entscheidend:** der Telnyx-Beleg traegt die Menge selbst.

```
record_type = text-to-speech
provider            = 'elevenlabs'
number_of_characters = 238
cost                 = '1.666E-4'
```

Damit ist der ElevenLabs-Verbrauch **je Anruf ablesbar** — ueber genau den Weg, den wir
ohnehin bauen, ohne einen zweiten Anbieter-Zugang, ohne Key-je-Tenant (was ohnehin nicht
auf Millionen Nutzer skaliert) und ohne die ElevenLabs-History-API, die kein Feld fuer eine
eigene Referenz kennt (Zuordnung dort waere reine Zeitfenster-Korrelation).

**Materialitaet:** 0,000167 / 0,094267 USD = **0,177 %** der Anrufkosten. Der Betrag ist
nicht das Argument — die *Erfassbarkeit ohne Zusatzaufwand* ist es.

### F6b — Die Pflicht-Typmenge in Produktion · BELEGT (Owner-Auskunft 2026-07-21)

```
COST_TRUING_REQUIRED_RECORD_TYPES = sip-trunking,call-control
```

Damit ist U8 geschlossen. Die Bewertung:

- **Erfuellbar, auf beiden Pfaden.** Beide Typen sind in `ASSIGNABLE_COST_RECORD_TYPES`, der
  Boot-Guard laesst sie also zu Recht durch. Gegenprobe an echten Daten (F4): fuer *beide*
  Anrufe des parallelen Paars lagen `sip-trunking` **und** `call-control` vor. Auf dem
  Assistant-Pfad ebenfalls (57-s-Anruf: sip-trunking 0,0401 + call-control 0,002 + …).
  Die Vollstaendigkeits-Bedingung ist damit **nicht** strukturell unerfuellbar — das war das
  Risiko hinter U8, und es ist ausgeraeumt.
- **Der Haken:** `call-control`-Belege tragen `telnyx_leg_id` + `telnyx_session_id`, aber
  **keinen `call_control_id`-Anker** (F5). Der Pflicht-Typ ist also ausschliesslich ueber
  Stufe 2 erreichbar. Konsequenz: **jede Rueckerstattung haengt am Session-Weg.** Faellt er
  aus, ist nicht etwa nur ein Beleg weg — es wird dauerhaft nur noch nachgefordert, nie
  erstattet, einseitig zulasten des Kunden. Das ist kein Fehler in der Konfiguration (die
  Mischung aus einem Anker-Typ und einem Session-Typ prueft im Gegenteil beide Stufen), aber
  es macht die `via_`-Zaehler aus Phase 6/7 zu einer Geld-relevanten Sonde statt zu Kosmetik.

**Nebenbefund mit Sparpotenzial:** `inference` steht in `UNASSIGNABLE_COST_RECORD_TYPES`
(voice.js:81) und wird von `assignmentOutcome` **immer** verworfen (`session_unresolved`, es
traegt nur `conversation_id`). Der Typ wird heute trotzdem bei jedem Durchlauf mitgeholt.
Das ist eine Anfrage von sieben, die strukturell nie einen Beleg beitragen kann: **7 -> 6
Anfragen je Seitenrunde, 14 % weniger, ohne jeden Informationsverlust.** Gehoert in Phase 3.

### F7 — Bestand und Mengengeruest (Prod-DB, read-only) · BELEGT

```sql
SET app.current_tenant='<tenant>';   -- FORCE RLS: ohne das liefert jedes SELECT 0 Zeilen
```

| Groesse | Wert |
| --- | --- |
| Beendete Outbound-Calls (beide Tenants) | **33** |
| davon `cost_trued_source='telnyx_detail_records'` | **0** -> Deckungsquote **0 %** |
| offene Kandidaten (`cost_trued_at IS NULL`) | 32 |
| mit Ist-Kosten | 1 (`no_estimate` — gemessen, aber ohne Schaetzbetrag) |
| strukturell unmessbar (`failed`, keine Leg-Referenz) | 3 |
| Versuchszaehler der offenen Kandidaten | **29 × `attempts=1`**, 3 × `attempts=0` |
| Anrufe gesamt / Zeitraum | 35 in 24 Tagen, 10 Tage mit Verkehr, **Spitze 10/Tag**, Mittel **1,46/Tag** |
| Tenants | 2 |

**Zwei Befunde, die im Auftrag nicht vorkamen:**

1. **Eine Frist.** `COST_TRUING_MAX_ATTEMPTS=5`; 29 Calls stehen bei Versuch 1. Jeder
   Sweep, der vor dem Fix laeuft, verbrennt einen weiteren Versuch. Nach dem fuenften wird
   der Call dauerhaft auf `failed` geschlossen und ist nie wieder Kandidat. Bei 6-h-Kadenz
   ist der historische Bestand **rund 24 Laufstunden** vom endgueltigen Abschreiben
   entfernt. Betroffen ist nur die Genauigkeit der Vergangenheit, nicht das Budget-Gate —
   aber es ist der Beweisbestand, an dem sich der Fix live zeigen liesse.
2. **Der Nenner der Deckungsquote enthaelt Unmessbares.** Die 3 `failed`-Calls bleiben
   dauerhaft im Nenner von `costTruingCoveragePercent`. Die Quote kann damit strukturell
   nie ueber **90,9 %** steigen. Die Schwelle liegt bei 80 %, das haelt — aber jeder
   weitere gescheiterte Origination-Versuch drueckt die Obergrenze weiter.

---

### F8 — Was die Korrektur wert ist · BELEGT

Der Testanruf aus F3 buchte `estimated_cost_cents = 20`. Die Formel dahinter:
`minutes × tariffCentsPerMin` (metering.js:68) mit `VOICE_TARIFF_DOMESTIC_CENTS=20` und
49,7 s -> 1 Minute. Real gekostet hat derselbe Anruf **0,094302 USD ≈ 8 EUR-Cent**.

**Die Schaetzung reserviert also rund das 2,5-Fache der tatsaechlichen Kosten.** Bezugspunkt
ist der GETEILTE Lebenszeit-Topf (`MAX_BUDGET_EUR`, heute 30 EUR): er wird 2,5-mal schneller
leergerechnet, als real Geld abfliesst. Bei 30 EUR ist das der Unterschied zwischen rund
150 und rund 370 Anrufen, bevor Outbound einfriert.

Das ist keine Fehlbuchung, sondern genau der Zweck der Korrektur — sie holt die Differenz
zurueck. Aber sie tut es **nur bei bewiesen vollstaendiger Belegmenge** (`refundProven`),
und die haengt nach F6b vollstaendig am Session-Weg. Damit ist quantifiziert, was heute
liegen bleibt: bei einer Deckungsquote von 0 % wird **jede** Ueberreservierung behalten.

## 2. Zielarchitektur

### Der Hebel

`fetchCostRecordPage` (voice.js:306–321) baut die Query aus genau zwei Parametern:

```js
q.set("filter[record_type]", recordType);
q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
```

Kein `legId`, kein Zeitfenster. **Der Abruf ist schleifeninvariant, die Zuordnung nicht.**
Jeder der 32 Kandidaten holt exakt dieselben Daten; die Zuordnung passiert danach
vollstaendig client-seitig. Die Reparatur ist damit kein Neubau, sondern das Herausziehen
eines invarianten Abrufs aus der Schleife.

### Option A-lite — geteilter Einzug je Sweep, Pool nur im Speicher · EMPFEHLUNG

Der Port wird an genau einer Stelle aufgetrennt (es gibt **einen** produktiven Aufrufer,
`cost-truing.js:290`, per grep belegt; Twilio implementiert die Methode nicht):

- `fetchCostRecordPool({ since })` — **einmal je Sweep**, vor der Kandidatenschleife. Je
  Typ `page[number]` aufsteigend, bis eine Seite vollstaendig aelter als `since` ist oder
  die Seitenobergrenze greift. Liefert `{ ok, raw[], complete }`.
- `assignCostRecords(pool, { legId, startedAt, endedAt })` — je Call, synchron,
  **byte-identisch die heutige Logik**. Die Zuordnung wird verschoben, nicht veraendert.
  Sie ist der einzige Teil der Kette, der nachweislich funktioniert (7/7/10 live, und jetzt
  zusaetzlich unter Parallelitaet bestaetigt, F4).

**Kein Zeitfilter, sondern Paginierung.** `since` wird ausschliesslich client-seitig gegen
das je Typ gemessene Zeitfeld ausgewertet. Serverseitig geht kein einziger ungemessener
Parametername raus. Das kostet Anfragen und kauft dafuer Unfaelschbarkeit — F5 zeigt, dass
ein geratener Filtername `200` mit `0` liefert statt eines Fehlers.

**Anfragen je Sweep:** untere Schranke 7, obere Schranke `7 + 0,275 × V`. Am heutigen Ist
(32 Kandidaten, ~320 Belege ueber 7 Typen): **7 bis 14 statt gemessener 224.**

**Fail-closed an drei Stellen:**
1. Zuordnung unveraendert asymmetrisch — kein Anker heisst leere Liste, nie "Kosten = 0".
2. Neu: `pool.complete === false` macht den **gesamten** Sweep zu `ok:false`. Kein
   Teil-Ergebnis, keine Herkunft `telnyx_detail_records`, damit keine Rueckerstattung.
3. Die tote 250er-Pruefung wird durch eine ersetzt, die gegen die **Antwort** prueft
   (`meta.total_pages`), nicht gegen die eigene Anforderung.

**Aufwand:** klein. Eine Datei plus eine Aufrufstelle plus Port-JSDoc. Kein Schema, keine
Migration, kein neuer Job, kein neues Env.

**Risiko:** der Pool ist gemeinsam — ein Zuordnungsfehler traefe alle Calls eines Sweeps
statt einen. Gegenmassnahme: die Zuordnungsfunktion bleibt unveraendert und bekommt einen
Aequivalenztest (Phase 2).

### Option B — Pro-Anruf-Abruf mit Paginierung und Drossel

Struktur bleibt, 7 Anfragen je Kandidat, dazu Token-Bucket und Seitenschleife.
Anfragen je Sweep: `7 × C`. Die Formel trifft die Messung exakt (7 × 32 = 224).

Gedrosselt dauert ein Sweep bei 32 Kandidaten **5,6 Minuten reine Wartezeit** —
ueberwiegend fuer Antworten, die byte-identisch zur vorherigen sind. Bricht bei rund **800
Anrufen/Tag**. Mehr Code als A-lite fuer ein um Faktor 6,3 schlechteres Ergebnis.
**Verworfen.**

### Option C — persistente Belegtabelle mit Wasserstand

Entkoppelter Ingest-Job schreibt Belege in eine kontoweite, tenant-lose Tabelle
(`audit_log` ist die existierende Praezedenz: tenant-los, ohne RLS); der Sweep liest nur
noch aus der DB. Jeder Beleg wird genau einmal geholt: `168 + 0,2 × V` Anfragen/Tag statt
`28 + 1,1 × V`. Traegt bis rund **287.000 Anrufe/Tag**.

Preis: Schema, Migration, zweiter Job, Retention (DSGVO-Pfad), und — entscheidend — der
Wasserstand ist ein **neuer stiller Verlustpunkt**: rueckt er zu frueh vor, ist der Beleg
nie wieder auffindbar. Genau die Fehlerklasse, die dieses Thema zweimal umgebracht hat
(falsch, aber HTTP 200). Zweitens liegt bei einer Tabelle ohne RLS die Tenant-Isolation
vollstaendig im Anwendungs-Join.

**Vorgemerkt als Nachfolger, nicht als Start.** A-lite ist so geschnitten, dass C ein
Additiv bleibt: `fetchCostRecordPool` bekommt spaeter eine DB-Implementierung,
`assignCostRecords` bleibt unveraendert.

### Option D — provider-seitige Tenant-Trennung (Managed Accounts / billing_group_id)

Drei belegte Gruende dagegen:

1. `billing_group_id` ist als Feld im Detail Record **nur fuer `webrtc`** dokumentiert; fuer
   unsere Typen UNBELEGT.
2. Managed Accounts sind auf **1.000 je Manager** gedeckelt — unvereinbar mit dem
   Millionen-Anspruch. Zusaetzlich hebt eine optionale "Rollup Billing"-Einstellung die
   Kostentrennung wieder auf: die Trennung ist Default, nicht Eigenschaft.
3. Pro-Tenant-Polling multipliziert Anfragen mit der Nutzerzahl gegen ein Kontingent, das
   sich nicht mitvermehrt — und ob es je Key oder je Konto zaehlt, ist UNBELEGT (U5).

**Verworfen.**

### Empfehlung

**A-lite jetzt, C am Bruchpunkt.** A-lite entfernt reine Redundanz, ohne die einzige
nachweislich funktionierende Komponente anzufassen; es braucht keinen einzigen ungemessenen
API-Parameter; es fuegt kein neues stilles Verlustrisiko hinzu. Ersparnis gegenueber dem
Ist: **Faktor 16 bis 32**.

---

## 3. Bruchpunkt

| Symbol | Bedeutung | Wert | Herkunft |
| --- | --- | --- | --- |
| L | Anfragen je Fenster | 40 / 60 s, fix an volle UTC-Minute | F1, BELEGT |
| P | Belege je Seite | 50 (hart) | F5, BELEGT |
| T | Anfragen je Seitenrunde | 7 (kein Kombi-Filter); **6 nach dem `inference`-Verzicht**, s. F6b | F5, BELEGT |
| B | Belege je Anruf | 10 (Obergrenze aus 7/7/10; F4 mass 7 und 5) | schwach belegt, n=5 |
| W | abzudeckendes Fenster | 33 h (3 h Delay + 5 Versuche × 6 h) | Code |
| V | Anrufe je Tag | **1,46 Mittel, 10 Spitze** (35 Calls / 24 Tage) | F7, BELEGT |

```
Kapazitaet je 6-h-Sweep-Intervall = 360 min × 40 = 14.400 Anfragen
Betriebsschwelle (Sweep <= 10 % des Intervalls) = 36 min × 40 = 1.440 Anfragen

Option A-lite:  Anfragen(Sweep) <= 7 + 0,275 × V
   Schwelle 1 (Betriebsschwelle):   V = 5.211 Anrufe/Tag
   Schwelle 2 (Sweep fuellt Intervall): V = 52.338 Anrufe/Tag
   Schwelle 3 (Speicher):  Pool = 13,75 × V Belege × M Bytes; M ist UNBELEGT (U7).
                           Bei M=500 B: V = 74.500. Bei M=2 kB: V = 18.600.
                           Kann VOR Schwelle 1 liegen.
```

**Wo wir stehen:** V = 1,46/Tag. Das sind **0,03 %** von Schwelle 1. Der empfohlene Entwurf
traegt drei Groessenordnungen Wachstum, bevor die erste Schwelle ueberhaupt in Sicht kommt.
Genau deshalb ist Option C heute vorgezogene Komplexitaet.

Uebersetzung in Nutzerzahlen: `U` (Anrufe je Nutzer und Tag) ist **UNBELEGT**; die
Herleitung aus der Starter-Tarifgrenze (30 min/Monat, ein gemessener Anruf 57 s) ergibt
U ≈ 1. Damit liegt Schwelle 1 bei rund **5.200 aktiven Nutzern**, Schwelle 2 bei rund
52.000. Bei U = 3 entsprechend 1.700 bzw. 17.400.

**Nach dem Bruchpunkt, in dieser Reihenfolge:**

1. **Fenster verschmaelern** (kostet nichts, Faktor ~4). Stuendliche Kadenz -> W = 8 h statt
   33 h -> `7 + 0,0667 × V`, Schwelle 1 rueckt auf V = 21.500. Ausloeser: der Waechter aus
   Phase 8. Vorbedingung: U3 (wirksame Filter je Typ) messen.
2. **Option C** — persistente Belegtabelle, traegt bis V ≈ 287.000/Tag.
3. **Jenseits davon** ist das Kontingent selbst die Mauer: verhandeltes Limit, mehrere
   Konten (setzt U5 voraus), oder ein Push-Weg, den es heute nachweislich nicht gibt (F2).
   Ehrlich benannt: Stufe 3 ist nicht loesbar, nur verschiebbar. Wer 287.000 Anrufe am Tag
   telefoniert, verhandelt einen Vertrag, keine Query.

---

## 4. Phasenplan

Fuer alle Phasen: `node --check` auf jede geaenderte Datei, `npm test` gruen (Referenz
2861/0), kein Deploy ohne ausdrueckliche Owner-Ansage, Merge auf `master` ist kein
Ausliefern.

**Fixture-Disziplin (durchgehend).** Die Gefahr ist nicht "kein Test", sondern "Test
bestaetigt die eigene Annahme" — genau daran starb die Kette zweimal. Deshalb in jeder
Phase: (a) Fixtures spiegeln **gemessene** Antwortformen (`meta={total_results:212,
total_pages:5, page_size:50}`, Feldnamen und Zeitfelder je Typ aus F5); (b) jede Fixture
traegt mindestens ein **Koeder-Feld**, das der Code nicht verwenden darf (`telnyx_leg_id`,
`call_leg_id`) — laeuft ein Test gruen, obwohl nur der Koeder passt, ist der Test falsch;
(c) jede Phase hat mindestens einen Test, der **vor** dem Fix rot ist, und dieses Rot wird
im Phasenbericht dokumentiert.

### Phase 0 — D4: den Fehlerpfad sichtbar machen (zuerst) · [x] UMGESETZT (`tasks/ke-p0-report.md`)

Ohne sie ist keine Folgephase verifizierbar: `catch {` (voice.js:318) bindet den Fehler
nicht einmal.

- **Aenderung:** Fehler binden, PII-frei loggen — `[telnyx/voice] getVoiceCostRecords
  fehler typ=<record_type> status=<providerStatus> code=<telnyx-code>`. Kein Key, keine
  Nummer, kein Body.
- **rot heute:** ein Test, der `fetch` einen 429 liefern laesst, sieht keine Log-Zeile; im
  Kosten-Abschnitt existiert kein `console.error`/`console.warn`.
- **gruen:** derselbe Test faengt eine Zeile mit `status=429` und `code=10011` ab und weist
  nach, dass sie weder `Bearer` noch eine `+`-Nummer enthaelt.
- **Test:** `test/telnyx-cost-records.test.js` — *"getVoiceCostRecords loggt Provider-Status
  und Telnyx-Code bei 429"*. Autonom verifizierbar.

### Phase 1 — D3: die tote Sicherung ersetzen (S1) · [x] UMGESETZT (`tasks/ke-p1-report.md`)

- **Aenderung:** `COST_RECORDS_PAGE_SIZE` 250 -> gemessene 50; `meta` muss den Aufrufer
  erreichen (heute wirft `parseTelnyxResource` es mit `json.data || json` strukturell weg);
  Truncation-Pruefung gegen `meta.total_pages` statt gegen die eigene Anforderung.
- **rot heute:** Fixture `{data:[50 Records], meta:{total_results:212, total_pages:5,
  page_size:50}}` liefert `ok:true` mit 50 Records — eine stille Untermenge von 212 gilt
  als vollstaendig.
- **gruen:** dieselbe Fixture liefert `{ok:false, reason:"page_truncated"}` (vor Phase 3)
  bzw. loest die Seitenschleife aus (nach Phase 3).
- **Test:** *"volle Seite mit meta.total_pages>1 gilt nicht als vollstaendig"*. Die
  bestehende 250-Zeilen-Fixture (`Array.from({length:250})`, ~Zeile 564) wird **ersetzt**,
  nicht ergaenzt — sie testet heute ausschliesslich die eigene Konstante und ist das
  Musterbeispiel des Fehlers, den (c) verhindern soll.
- Richtungshinweis: diese Phase macht das System voruebergehend **konservativer** (mehr
  `incomplete`, weniger Rueckerstattungen). Das ist die sichere Richtung.

### Phase 2 — D1: den Abruf aus der Kandidatenschleife ziehen · [x] UMGESETZT (`tasks/ke-p2-report.md`)

- **Aenderung:** Auftrennung in `fetchCostRecordPool({since})` und
  `assignCostRecords(pool, …)`. Zuordnungslogik **verschoben, nicht veraendert**. Ein
  `ok:false`-Pool laesst ALLE Kandidaten als `unavailable` stehen (kein Teilerfolg).
  Zwischen Pool-Abruf und Buchungsschleife darf **kein** weiteres Netz-`await` liegen
  (PM-5).
- **rot heute:** Test mit 5 Kandidaten zaehlt 35 `fetch`-Aufrufe.
- **gruen:** derselbe Test zaehlt hoechstens 7 — und die je Call zugeordneten Records sind
  **identisch** zum Bestand.
- **Tests:** (1) *"Sweep holt Belege einmal, nicht je Kandidat"*; (2) **Aequivalenztest**
  *"assignCostRecords ordnet aus einem geteilten Pool genau wie der Bestandspfad zu"* —
  derselbe Rohbeleg-Satz, zwei Calls mit verschiedenen Ankern, Koeder-Felder werden
  ignoriert, ein Beleg einer **fremden** Session landet bei keinem der beiden. Dieser Test
  ist die wichtigste Zusage der Kette: er pinnt, dass der geteilte Pool die fail-closed-
  Asymmetrie nicht aufweicht. Modellier ihn nach dem gemessenen Paar aus F4.

### Phase 3 — D2: Paginierung ohne geratene Filternamen · [x] UMGESETZT (`tasks/ke-p3-report.md`)

- **Aenderung:** je Typ `page[number]` aufsteigend, bis eine **ganze** Seite aelter als
  `since` ist oder die Seitenobergrenze greift. Kein ungemessener Query-Parameter.
  Ergebnis traegt `complete: boolean`. Zusaetzlich: `UNASSIGNABLE_COST_RECORD_TYPES`
  (heute `inference`) gar nicht erst abrufen — diese Belege werden ausnahmslos verworfen,
  die Anfrage ist reine Verschwendung (F6b). Die Typenliste des Abrufs wird dafuer aus
  `ASSIGNABLE_COST_RECORD_TYPES` **abgeleitet**, nicht von Hand gepflegt (G27), damit sie
  nicht auseinanderlaeuft.
- **zusaetzlich rot heute:** `fetchAllCostRecords` laeuft ueber `COST_RECORD_TYPES` und holt
  `inference` mit; **gruen:** ein Test zaehlt 6 statt 7 Abrufe je Seitenrunde und weist
  nach, dass die abgerufene Typenmenge exakt `ASSIGNABLE_COST_RECORD_TYPES` ist.
- **rot heute:** `grep 'page\[number\]\|total_pages' src/telephony/adapters/telnyx/voice.js`
  -> 0 Treffer; Belege ab Position 51 je Typ sind strukturell unauffindbar.
- **gruen:** Test mit 3 Seiten (50/50/12) liefert 112 Records; Test mit erreichter
  Seitenobergrenze liefert `complete:false` und setzt **nie** `telnyx_detail_records`.
- **Tests:** (1) *"Seitenschleife sammelt alle Seiten bis das Fenster verlassen ist"*;
  (2) *"Seitenobergrenze erreicht -> nicht vollstaendig, keine Rueckerstattung"* (greift bis
  in `refundProven` durch); (3) *"unsortierte Seite bricht die Schleife nicht vorzeitig
  ab"* — entschaerft die fuer 6 von 7 Typen UNBELEGTE Sortierung (U4), statt sie zu raten:
  Abbruch ist "ganze Seite ausserhalb", nie "erster Record ausserhalb".

### Phase 4 — Drossel am gemessenen Fenster · [x] UMGESETZT (`tasks/ke-p4-report.md`)

- **Aenderung:** Token-Bucket am **fixen UTC-Minutenfenster** (F1: Reset faellt immer auf
  `:00`, nicht gleitend), Budget bewusst 30 von 40. Bei 429 trotzdem: bis zum naechsten
  `:00` warten (`x-ratelimit-reset`), hoechstens einmal, dann `ok:false`.
- **rot heute:** 224 Anfragen ohne Pause, gemessen `{"200":40,"429":184}`.
- **gruen:** Test mit injizierter Uhr: 100 angeforderte Seiten -> hoechstens 30 `fetch` je
  simulierter Minute; ein 429-Fixture -> genau ein Wiederholungsversuch, keine Schleife.
  Kein `sleep` im Test.

### Phase 5 — `since` aus den Kandidaten ableiten · [x] UMGESETZT (`tasks/ke-p5-report.md`)

- **Aenderung:** `since` = aeltester `endedAt` der Kandidaten minus Marge; keine Kandidaten
  -> gar kein Abruf. Der Blindwert waere sonst 33 h.
- **rot heute:** ein Sweep mit einem einzigen 3 h alten Kandidaten zieht denselben Umfang
  wie einer mit 200.
- **gruen:** leere Kandidatenliste -> 0 `fetch`; ein 3 h alter Kandidat -> hoechstens 7
  Anfragen.

### Phase 6 — Boot-Guard, ElevenLabs-Zaehler und Beobachtbarkeit · [x] UMGESETZT (`tasks/ke-p6-report.md`)

- **Aenderung 1:** Die Kopplung `costTruingBookingFindings` (boot-guard.js:337–395) an
  `ASSIGNABLE_COST_RECORD_TYPES` bleibt 1:1 erhalten — loest der Umbau sie, wird die
  Pflicht-Menge unbemerkt wieder mit einem unzuordenbaren Typ erfuellbar (Rueckfall vor
  LCT-FIX-1).
- **Aenderung 2 (neu, aus F6):** aus dem `text-2-speech`-Beleg `number_of_characters` je
  zugeordnetem Call mitfuehren und **pro Tenant** verbuchen. Damit schliesst sich die
  ElevenLabs-Luecke auf demselben Weg, ohne zweiten Anbieter-Zugang.
- **Aenderung 3:** Sweep-Log um `anfragen=<n> seiten=<n> pool=<n> vollstaendig=<bool>`
  ergaenzen.
- **rot heute:** das Sweep-Log nennt keine einzige Zahl ueber den Abruf selbst — genau
  deshalb war D1 unsichtbar; der TTS-Zaehler steht global bei 0 Zeichen fuer jeden
  Assistant-Anruf.
- **gruen:** eine Log-Zeile je Sweep traegt `anfragen=` und `vollstaendig=`; ein Test pinnt
  das Format (es ist die Datenquelle des Bruchpunkt-Waechters und liefert nebenbei
  B = pool/kandidaten aus der Wirklichkeit, U9). Ein zweiter Test pinnt, dass die Zeichen
  am richtigen Tenant landen.

### Phase 6b — Verzug und Kadenz an die Messung anpassen · [x] UMGESETZT (`tasks/ke-p6b-report.md`)

Erst hier, nicht frueher: eine kuerzere Kadenz ist nur tragbar, wenn ein Sweep 7–14 statt
224 Anfragen kostet (Phase 2/3) und gedrosselt ist (Phase 4).

- **Aenderung:** `COST_TRUING_DELAY_MINUTES` 180 -> **30** (F3 misst ≤ 2,2 min; 30 min sind
  ein 13-facher Sicherheitsabstand, kein Ratewert). `COST_TRUING_SWEEP_INTERVAL_MS` 6 h ->
  **1 h**; die Zahl ist heute in `cost-truing.js:36` hartkodiert und wird bei der
  Gelegenheit zur Env-Variablen mit ebendiesem Default.
- **Warum:** nach F3 ist nicht mehr der Verzug der Engpass, sondern die Kadenz. Sie
  bestimmt, wie lange die 2,5-fache Ueberreservierung aus F8 im Topf steht. Nebeneffekt:
  W schrumpft von 33 h auf 3 h + 5 × 1 h = **8 h**, der Pool und damit die Seitenzahl je
  Sweep sinken mit.
- **Kosten:** 24 Sweeps × ≤ 14 Anfragen = **336 Anfragen/Tag** von 57.600 verfuegbaren.
- **rot heute** = eine Korrektur landet fruehestens 3 h nach Gespraechsende, im Mittel erst
  nach 6 h Wartezeit obendrauf; `grep -n "6 \* 60 \* 60 \* 1000" src/billing/cost-truing.js`
  liefert eine hartkodierte Zahl.
- **gruen** = Test: ein Call, dessen `endedAt` 31 min zurueckliegt, ist Kandidat; einer mit
  29 min nicht. Zweiter Test: das Intervall kommt aus der Config, und der Default ist 1 h.
- **Autonom verifizierbar.** Deploy-Auflage: `COST_TRUING_MAX_ATTEMPTS` wieder auf 5
  zuruecknehmen (der 2026-07-21 gesetzte Wert 20 war die Fristverlaengerung, s.
  Entscheidung 5) — sonst bleibt W bei 3 h + 20 × 1 h = 23 h statt 8 h.

### Phase 7 — Live-Verifikation (OWNER-AKTION, nicht autonom) · [ ] OFFEN (`tasks/ke-DEPLOY-CHECKLIST.md`)

1. Owner deployt und prueft den `[boot]`-Banner auf den erwarteten Commit (Deploy-Status
   immer nachsehen — der Live-Service hatte schon `autoDeploy` an trotz
   `render.yaml:false`).
2. Owner loest **einen** manuellen Sweep aus: `POST /api/billing/cost-truing/sweep` (hinter
   Basic-Auth). **Nicht** `scripts/sweep-jetzt.sh`, solange Phase 4 nicht live ist.
3. **rot heute:** `gemessen=0` bei 33 Kandidaten, ohne Fehlergrund.
4. **gruen:** `anfragen=` im einstelligen bis niedrig zweistelligen Bereich,
   `vollstaendig=true`, `gemessen>0`, **kein** `status=429`. Zusaetzlich muss `via_anchor`
   gegenueber den Session-Wegen in derselben Groessenordnung bleiben wie gemessen (F4: 3
   Anker zu 9 Session-Belegen) — ein Sprung dort ist das Frueherkennungssignal fuer fremde
   Belege.
5. **Abbruch:** erscheint `status=429` oder `vollstaendig=false`, wird nicht nachjustiert,
   sondern zurueckgerollt und Phase 3/4 nachgebessert.
6. **Vorbedingung:** Owner liest `COST_TRUING_REQUIRED_RECORD_TYPES` im Render-Dashboard ab
   (U8) — ohne den Wert ist `gemessen>0` nicht interpretierbar.

### Phase 8 — Bruchpunkt-Waechter · [x] UMGESETZT (`tasks/ke-p8-report.md`)

- **Aenderung:** ueberschreitet `anfragen` je Sweep die Betriebsschwelle 1.440, feuert der
  **bestehende** entprellte Befundkanal (`shouldEmitFinding`, 24 h) — Log + Audit, kein
  neuer Alarmweg, keine zusaetzliche SMS-Klasse (PM-7).
- **rot heute:** nichts warnt, bevor das Kontingent reisst; das Rate-Limit fiel erst durch
  sein Sprengen auf.
- **gruen:** Test mit simulierten 1.500 Anfragen erzeugt genau einen Befund je 24 h.

---

## 5. Pre-Mortem

Ein Jahr weiter, 2027. Die Ist-Kosten-Erfassung ist gescheitert. Was war die Ursache?

**PM-1 — Ein geratener Zeitfilter hat ein Jahr lang leere Antworten geliefert.** Jemand
"optimiert" den Einzug und setzt `filter[started_at][gte]` auf alle 7 Typen. Gemessen: auf
`speech-to-text` (Feld heisst `start_time`) liefert das 0 Treffer trotz 89 Datensaetzen —
**HTTP 200, kein Fehler**. Die Deckung faellt langsam, niemand verbindet es mit dem Filter.
*Gegenmassnahme:* Phase 3 sendet keinen Zeitfilter. Zusaetzlich ein Kommentar an der
Query-Konstruktion, der jeden neuen `filter[...]`-Parameter an eine vorherige Messung
bindet — dieselbe Regel, die schon `SESSION_ID_FIELDS` traegt.

**PM-2 — Fremde Belege auf fremdem Tenant.** Die Session-Invariante kippt unter Last, der
geteilte Pool haelt die Belege aller Anrufe gleichzeitig vor.
*Status neu:* die Invariante ist jetzt unter echter Parallelitaet **gemessen** und hielt
(F4). *Gegenmassnahme dreifach:* (1) Zuordnung in Phase 2 nur verschoben, plus
Aequivalenztest mit zwei Calls und einer fremden Session; (2) die `via_anchor`/
`via_<Session-Feld>`-Zaehler bleiben die Falsifikationsgroesse; (3) Phase 7 macht den
Vergleich zum Abnahmekriterium.
*Restrisiko:* n=1 Paar, gleicher Tenant, Budget-Pfad. Tenant-uebergreifende Parallelitaet
und der Assistant-Pfad bleiben ungemessen.

**PM-3 — Die Paginierung hat still Daten verloren.** Der Einzug bricht ab, sobald *ein*
Beleg ausserhalb des Fensters liegt; fuer 6 von 7 Typen ist die Sortierung UNBELEGT (U4).
Fehlende Belege heissen nur `incomplete` — es sieht nach Provider-Problem aus, nicht nach
eigenem Bug.
*Gegenmassnahme:* Abbruch erst, wenn die **ganze** Seite ausserhalb liegt; Seitenobergrenze;
`complete:false` sperrt die Rueckerstattung; Test mit absichtlich unsortierter Seite.

**PM-4 — Der Job hat monatelang geschlafen.** Der Sweep haengt an `setInterval(...).unref()`
im Web-Prozess (boot.js:318–324); der Render-Free-Tier kennt weder Cron noch Jobs. Nach dem
Aufwachen sind Calls aus dem Versuchsfenster gefallen.
*Gegenmassnahme:* der bestehende Deckungs-Waechter (`coverage_below_threshold`, Eskalation
`coverage_stalled`) ist genau dafuer gebaut. Neu belegt: die Retention ist ≥ 31 Tage, eine
Schlafphase von Tagen ist also nicht automatisch Datenverlust.
*Restrisiko, akzeptiert:* keine Ausfuehrungsgarantie ohne bezahlten Tier — tragbar, weil
`finishCall` sofort schaetzt und bucht; die Korrektur ist Praezision, nicht Abrechnung.

**PM-5 — Doppelte Korrekturbuchung nach der zweiten Instanz.** `sweepRunning` ist
prozess-lokal; der Code sagt es selbst. Zwei Instanzen sehen `costTruedAt === null` und
buchen dieselbe Korrektur zweimal.
*Gegenmassnahme jetzt:* Auflage an Phase 2 — zwischen Pool-Abruf und Buchungsschleife kein
weiteres Netz-`await`.
*Restrisiko mit Ausloeser:* vor der zweiten Instanz muss `costTruedAt` per Compare-and-Set
in der DB gesetzt werden statt per Prozess-Boolean. Gehoert in denselben Vorgang wie die
zweite Instanz, nicht davor.

**PM-6 — Telnyx hat die API geaendert.** `page[size]=50` und `40/60 s` sind gemessen, nicht
zugesagt; Telnyx dokumentiert keine numerische Rate-Limit-Zahl und schreibt "subject to
change". Ein stiller Wechsel auf 20 haette die Anfragezahl verdoppelt.
*Gegenmassnahme:* Truncation-Pruefung gegen `meta` aus der **Antwort** (Phase 1) — genau der
Fehler, der D3 zur Attrappe machte; der Waechter aus Phase 8 meldet die Verdopplung, bevor
sie das Kontingent reisst.

**PM-7 — Die Erfassung selbst hat Geld gekostet.** Ein neuer Befundtyp mit eigenem Kanal
haette die 24-h-Entprellung (max. 9 SMS/Tag) ausgehebelt.
*Gegenmassnahme:* Phase 8 nutzt denselben `shouldEmitFinding`-Pfad. Der groessere Schaden
waere ohnehin nicht die Rechnung, sondern ein gesprengtes Kontingent — dagegen steht die
Drossel mit Reserve (30 von 40). Entwarnung aus F1: das Kontingent ist **pro Endpunkt**,
ein durchgedrehter Sweep nimmt die Anrufsteuerung nicht mit runter.

**PM-8 — Die Belege waren gar nicht da, als der Sweep sie holte.** *Entschaerft:* F3 misst
≤ 133 s gegen 180 konfigurierte Minuten — der Verzug ist um Groessenordnungen zu gross, nicht
zu klein. Die befuerchtete Richtung (Versuche verbrannt, bevor der Beleg existiert) ist
ausgeschlossen.
*Rest-Restrisiko:* n=1, nur Assistant-Pfad. Bleibt der Deckungs-Waechter als laufende
Kontrolle — er wuerde genau dieses Muster sichtbar machen.

**PM-11 (neu, aus F3) — "Erster Beleg je Typ gewinnt" hat 43 % der Kosten verschluckt.**
Je Anruf existieren zwei `sip-trunking`- und zwei `call-control`-Belege, davon je einer echt
bei null (zweites Bein, `call_sec=0`). Eine Implementierung, die je Typ nur den ersten
Treffer nimmt, summiert je nach Seitenreihenfolge 0,054 statt 0,094 USD — und **erstattet
real ausgegebenes Geld zurueck**. Das ist die fail-open-Richtung im Geldpfad.
Genau dieser Fehler ist mir beim Messen selbst unterlaufen (das erste Messskript zeigte
`cost=0.0`), was zeigt, wie leicht er passiert.
*Gegenmassnahme:* der Produktivcode summiert bereits ALLE zugeordneten Belege. Diese
Eigenschaft wird in Phase 2 im Aequivalenztest ausdruecklich gepinnt — mit einer Fixture,
die den Null-Zwilling enthaelt.

**PM-9 — Der Pool hat den Prozess erstickt.** `M` (Bytes je Beleg) ist UNBELEGT; die
Speicher-Schwelle kann vor der Anfrage-Schwelle liegen, und der Prozess teilt sich den Heap
mit dem Web-Dienst.
*Gegenmassnahme:* Phase 5 haelt das Fenster schmal; U7 hat ein netzfreies Messrezept.
*Restrisiko, akzeptiert:* bei 32 Kandidaten ist der Pool trivial klein.

**PM-10 (neu) — Der Beweisbestand war weg, bevor der Fix live ging.** 29 Calls stehen bei
Versuch 1 von 5. Jeder Sweep vor dem Fix verbrennt einen Versuch; nach dem fuenften sind sie
dauerhaft `failed` und nie wieder Kandidat. Bei 6-h-Kadenz sind das rund 24 Laufstunden.
*Gegenmassnahme:* Owner-Entscheidung 5 — entweder zuegig deployen oder den historischen
Bestand bewusst abschreiben. Betroffen ist nur die Genauigkeit der Vergangenheit; das
Budget-Gate haengt nie daran.

---

## 6. Owner-Entscheidungen

Ich empfehle, du entscheidest.

### 1. Beleg-Latenz messen — ERLEDIGT (2026-07-21, Owner-Freigabe erteilt)

Testanruf durchgefuehrt, Ergebnis in F3: **≤ 133 s** statt der konfigurierten 180 Minuten.
Kosten 0,094302 USD (gemessen, nicht geschaetzt). Der Wert wandert in Phase 6b als
`COST_TRUING_DELAY_MINUTES=30`. PM-8 ist damit entschaerft.

Offen bleibt nur die Feinmessung unterhalb von 60 s — ohne praktischen Nutzen, weil kein
Entwurf so knapp misst. Keine weitere Owner-Aktion noetig.

### 2. Parallelitaet zusaetzlich mit zwei gleichzeitigen Testanrufen pruefen?

**Status:** durch F4 weitgehend erledigt — die Invariante hielt unter echter Parallelitaet,
ohne einen Cent. Offen bleiben Assistant-Pfad und tenant-uebergreifende Parallelitaet.

**Optionen.** (a) Zwei gleichzeitige Anrufe **aus verschiedenen Tenants** ueber den
Assistant-Pfad, danach beide Ankermengen auf Session-Ueberschneidung pruefen. Kosten
**0,188534 USD**. (b) Nein, F4 genuegt; weiter ueber die `via_`-Zaehler beobachten.

**Empfehlung: (a), aber erst nach Phase 2 und nur zusammen mit Entscheidung 1** (ein
Anruf misst dann beides). Vorher aendert der geteilte Pool genau die Bedingungen, die der
Test pruefen soll.

### 3. Fehlende Filter-/Sortier-Eigenschaften der uebrigen Typen nachmessen?

**Optionen.** (a) Ja, rund 20 gedrosselte Anfragen, jede mit Gegenprobe ohne Filter.
Kosten 0. (b) Nein — Phase 3 braucht diese Filter ausdruecklich nicht.

**Empfehlung: (b) jetzt nicht, (a) als Vorbedingung fuer Stufe 1 des Bruchpunkt-Plans.**
Eine Messung, die heute nichts freischaltet, ist nur ein Anlass, sie spaeter falsch zu
erinnern.

### 4. Bleibt der Sweep im Web-Prozess des Free-Tiers?

**Optionen.** (a) Ja, akzeptiertes Restrisiko; der Deckungs-Waechter macht den Ausfall
sichtbar. (b) Bezahlter Tier mit Render-Cron (laufende Kosten, Betrag UNBELEGT).
(c) Externer Ausloeser gegen den Sweep-Endpunkt — neue Angriffsflaeche auf einen
Basic-Auth-Endpunkt.

**Empfehlung: (a) bis zur zweiten Instanz.** Die Korrektur ist Praezision, keine
Abrechnung; ein verpasster Sweep kostet Genauigkeit, nicht Sicherheit. Beim Wechsel auf
zwei Instanzen wird ohnehin PM-5 faellig — dann beides zusammen.

### 5. Wird der historische Bestand gerettet? (neu, mit Frist)

29 Calls stehen bei Versuch 1 von 5; jeder Sweep verbrennt einen weiteren. Rund **24
Laufstunden**, dann sind sie dauerhaft `failed`.

**Optionen.** (a) Fix zuegig bauen und deployen, Bestand bleibt als Live-Beweis erhalten.
(b) Bestand bewusst abschreiben und in Ruhe bauen. (c) `COST_TRUING_MAX_ATTEMPTS` vorab
erhoehen, um die Frist zu strecken.

**Zu (c), praezisiert (Owner-Auskunft 2026-07-21):** die Variable existiert im Code
(`config.js:392`, Fallback **5**, `min: 1`) und in `.env.example`/`render.yaml`, ist aber im
Render-Dashboard **nicht gesetzt** — live gilt der Fallback. Sie zu setzen heisst, eine neue
Env-Variable im Dashboard anzulegen, und das **startet den Dienst neu**. Kein neuer Code,
aber auch nicht folgenlos: der Neustart setzt die 6-h-Sweep-Uhr zurueck (beim Boot laeuft
bewusst kein Sweep, `boot.js:318-324`) und schiebt damit den naechsten Lauf ohnehin um bis
zu 6 h. Der Zaehler selbst ist persistiert, ein Neustart nullt ihn NICHT.

**Empfehlung: (c) sofort, dann (a).** Der Versuchszaehler ist die einzige Uhr, die gerade
gegen uns laeuft. Achtung: ein hoeherer Wert verlaengert zugleich das abzudeckende Fenster
W (`3 h + Versuche × 6 h`) und damit den Umfang je Sweep — nach dem Fix zuruecksetzen.

### 6. Deploy in einer oder zwei Klammern?

**Optionen.** (a) Alles zusammen nach Phase 6. (b) Phase 0+1 (Beobachtbarkeit + tote
Sicherung) vorziehen, Rest danach.

**Empfehlung: (b).** Phase 1 macht das System voruebergehend konservativer — die Abweichung
geht zulasten der Marge, nie zulasten des Kunden. Eine tote fail-closed-Sicherung ist der
einzige Befund dieser Runde, der ohne Weiterarbeit gefaehrlich bleibt.

### 7. Produktivwert von `COST_TRUING_REQUIRED_RECORD_TYPES` — ERLEDIGT

Owner-Auskunft 2026-07-21: **`sip-trunking,call-control`**. Bewertung in F6b — erfuellbar
auf beiden Pfaden, das befuerchtete strukturelle Blockieren jeder Rueckerstattung liegt
nicht vor. Bleibt als Auflage: weil `call-control` keinen Anker traegt, haengt die
Rueckerstattung vollstaendig am Session-Weg; die `via_`-Zaehler sind damit eine
Geld-relevante Sonde und bleiben Abnahmekriterium in Phase 7.

---

## 7. Was UNBELEGT bleibt

| # | Frage | Status | Messung |
| --- | --- | --- | --- |
| U1 | Verfuegbarkeits-Latenz der Belege nach Anrufende | **geschlossen: ≤ 133 s** (F3, Testanruf 2026-07-21, n=1, Assistant-Pfad) | Rest ohne Nutzen: Feinmessung unter 60 s |
| U2 | Session-Lokalitaet unter Parallelitaet | **geschlossen** (F4), Rest: Assistant-Pfad + tenant-uebergreifend | Entscheidung 2 |
| U3 | Wirksame Zeitfilter fuer 5 von 7 Typen | UNBELEGT | je Typ 1 Anfrage + **zwingend** Gegenprobe ohne Filter; `200`/`0` beweist nichts |
| U4 | Sortierreihenfolge fuer 6 von 7 Typen | UNBELEGT | je Typ 2 Seiten ziehen, typeigenes Zeitfeld auf Monotonie pruefen. Entschaerft durch Phase 3 |
| U5 | Gilt das Kontingent je Key, je Konto oder je Organisation? | UNBELEGT | zwei Prozesse mit **verschiedenen** Keys gleichzeitig, `x-ratelimit-remaining` vergleichen |
| U6 | Retention der Detail Records | **untere Schranke belegt: ≥ 31 Tage** | `filter[started_at][gte]` schrittweise zurueck (30/90/180/365 Tage), nur auf `sip-trunking` |
| U7 | Bytes je Beleg im Speicher (`M`) | UNBELEGT | netzfreier Test: 10.000 Fixture-Belege, `process.memoryUsage().heapUsed` davor/danach |
| U8 | Produktivwert `COST_TRUING_REQUIRED_RECORD_TYPES` | **geschlossen**: `sip-trunking,call-control` (Owner, 2026-07-21) | — Bewertung in F6b |
| U9 | Belege je Anruf (`B`) | schwach belegt (n=5: 7/7/10/7/5) | nach Phase 6 aus `pool/kandidaten` im Sweep-Log — misst sich selbst nach |
| U10 | Anrufe je Nutzer und Tag (`U`) | UNBELEGT (V ist gemessen) | nach Phase 6 aus dem Store, ohne API |
| U11 | POST-Faehigkeit von `mdr_usage_reports` / `billing_groups` | UNBELEGT | nur schreibend pruefbar, deshalb bewusst nicht ausgefuehrt. Relevanz erst jenseits V ≈ 287.000/Tag |

---

## 8. Belege

- `tasks/kosten-endspiel/telnyx-api-vermessung.md` — 21 API-Befunde mit Header-, Status-
  und `meta`-Dumps
- `tasks/kosten-endspiel/doku-recherche-telnyx.md` — Doku-Zitate mit URL, streng getrennt
  von Messungen
- `tasks/kosten-endspiel/code-forensik-inventar.md` — D1–D4 an `file:line`, Umbau-Inventar
- `tasks/kosten-endspiel/elevenlabs-per-tenant.md` — TTS-Pfade, Zaehler-Dimension,
  ElevenLabs-Doku
- Prod-DB-Messungen und die Parallelitaets-Sonde (F4/F7) sind in diesem Dokument mit
  Abfrage und Ausgabe wiedergegeben; das Sondenskript lag im Scratchpad dieser Session.

**Ueberholt:** `PLAN-LIVE-COST-TRACING.md` Kap. 2.6 behauptet, nur `filter[record_type]` +
`page[size]` seien belegt und die Zeitfilter-Parameternamen unbekannt. Das ist durch F5
ersetzt. Beim Weiterarbeiten gilt dieses Dokument.

---

## 9. Umsetzung 2026-07-22 — was anders war als geplant

Nachtrag nach der Umsetzung. **Ueberholtes ist oben korrigiert, nicht fortgeschrieben.**
Hier steht nur, was der Plan selbst nicht richtig vorhergesehen hat.

### 9.1 Abweichungen vom Plan (inhaltlich)

| # | Plan sagte | Umsetzung | Warum |
| --- | --- | --- | --- |
| 1 | Phase 6: ElevenLabs-Zeichen je Tenant, Persistenz offen gelassen | **Spalte** `usage.tts_characters`, keine neue Tabelle | Die `usage`-Tabelle ist bereits pro Tenant und traegt `tenant_isolation`-RLS. Eine Spalte erbt sie; eine neue Tabelle haette eine eigene Policy gebraucht — mehr Flaeche fuer denselben Zweck. |
| 2 | Phase 1: `meta` muss den Aufrufer erreichen | `parseTelnyxResource` in `parseTelnyxBody` (data+meta) plus schmale Bestands-Projektion aufgeteilt | Die Funktion hat zwei weitere Aufrufer (Origination, Assistant-Start). Beide bleiben wortgleich, statt ihre Rueckgabeform mitzuaendern. |
| 3 | Phase 0: Telnyx-Code loggen | `errors.js` haengt ihn als `err.providerCode` an | Den Meldungstext zu regexen waere brittle — der Text ist kein Vertrag. Strikt nur `code`, nie `title`/`detail`/Roh-Body. |
| 4 | Phase 3: Fixture "3 Seiten 50/50/12" | Fixture in der **gemessenen** Form `{total_results:212, total_pages:5, page_size:50}` | Fixture-Disziplin (A2) schlaegt die Illustration im Plantext. |
| 5 | Phase 8: Schwelle 1440 = 10 % des Intervalls | Konstante bleibt 1440, **Herleitung im Kommentar nachgezogen** | Seit Phase 6b laeuft der Sweep stuendlich; 1440 Anfragen sind bei Drossel-Budget 30/min rund 48 min, also fast das ganze Intervall. Die Schwelle meldet weiterhin vor dem Punkt, an dem zwei Sweeps ineinanderlaufen — nur knapper. Bewusst **keine** Env-Variable. |

### 9.2 Fehler IM PLAN, die bei der Umsetzung auffielen

- **Testzahl-Arithmetik Phase 3.** Der Plan nannte als Zielwert 2890; die eigene Tabelle
  listet aber 4 Entfernungen statt der in der Kurzformel unterstellten 2. Richtig sind
  **2889**. Der Umsetzer hat die Differenz aufgeklaert, statt Tests zu erfinden, um die Zahl
  zu treffen.
- **Reihenfolge-Falle Phase 6.** Die Plan-Skizze platzierte den `poolFetchStats`-Block nach
  `NO_COST_RECORDS`, das ihn im Initializer referenziert — in dieser Reihenfolge ein
  Temporal-Dead-Zone-`ReferenceError` beim ersten `makeCostTruing()`. Block vorgezogen.

### 9.3 Was der Gate gefangen hat (echte Defekte, nicht Kosmetik)

- **Phase 4, Runde 2 (S1):** die Drossel-Konstanten waren nicht exportiert, der Test
  behauptete also seine eigene Literalzahl statt der Produktionsgroesse.
- **Phase 6, Runde 1 (S1):** ein Koeder-Test buendelte zwei Bedingungen in EINEM Beleg
  (`chars:"viele"` UND `provider:"aws-polly"`). Jede fuer sich haette den Test schon gruen
  gehalten — er waere gruen geblieben, wenn man in `elevenLabsCharactersOf` nur die
  Provider-Pruefung entfernt. Aufgeteilt.
- **Phase 4, Runde 1 (S2):** die Sprung-Uhr war byte-identisch in zwei Testdateien
  dupliziert -> `test/fake-clock.js`.

Das ist die Rechtfertigung des Verfahrens: alle drei sind genau die Fehlerklasse, an der
diese Kette zweimal gestorben ist — **ein gruener Test, der nichts beweist.**

### 9.4 Messungen, die die Umsetzung nachtraeglich bestaetigt hat

- Der Boot-Guard `COST_TRUING_REQUIRED_RECORD_TYPES ist leer -> Boot-Refusal` wurde beim
  lokalen Smoke-Test **unabsichtlich ausgeloest** und hat korrekt fail-closed verweigert.
  Mit gesetztem Wert bootet der Dienst, `/healthz` -> `200 {"ok":true}`.
- Die Kopplung Boot-Guard <-> `ASSIGNABLE_COST_RECORD_TYPES` ist jetzt mit einem echten
  Kopplungstest gepinnt, der die abgerufene Typenmenge aus **echten HTTP-Anfragen** ableitet,
  statt zweimal dieselbe Konstante zu importieren.

### 9.5 Was NICHT umgesetzt wurde

- **Phase 7** (Live-Verifikation) — Owner-Aktion, vorbereitet in
  `tasks/ke-DEPLOY-CHECKLIST.md`.
- **Option C** (persistente Belegtabelle mit Wasserstand) — bleibt der vorgemerkte
  Nachfolger am Bruchpunkt, wie im Plan entschieden.
- **PM-5 Compare-and-Set fuer `costTruedAt`** — gehoert zur zweiten Instanz, nicht davor.
  Die Phase-2-Auflage (kein Netz-`await` zwischen Pool-Abruf und Buchungsschleife) ist
  erfuellt und strukturell erzwungen: die Buchungsschleife ist jetzt synchron.
- **U3/U4/U5/U7/U10/U11** — bleiben UNBELEGT. Keine davon war Vorbedingung einer Phase;
  Phase 3 ist gerade so gebaut, dass sie U3/U4 **nicht braucht**.
