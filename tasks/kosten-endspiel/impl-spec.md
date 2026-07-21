# Umsetzungs-Spezifikation Kosten-Endspiel (KE-P0 .. KE-P8)

Verbindliche Scope-/Invarianten-Definition je Phase. Autoritativ VOR `PLAN-KOSTEN-ENDSPIEL.md`
(der Plan ist der Umbrella-Kontext; Widersprueche loest dieses Dokument auf).
Stand 2026-07-21, Basis `master` = Suite **2861 pass / 0 fail** (selbst gemessen).

---

## A. Gemeinsame Grundlagen (gelten in JEDER Phase)

### A1. Gemessene Antwortformen — Fixtures duerfen NUR diese spiegeln

Alle Werte stammen aus der Vermessung (Plan Kap. 1). **Nichts hinzuerfinden.**

`meta` einer Listen-Antwort (gemessen an `sip-trunking`):

```json
{ "total_results": 212, "total_pages": 5, "page_size": 50 }
```

`page[size]` deckelt hart bei **50** — angefordert 250/100/50 liefert `meta.page_size` immer 50.
`total_pages = ceil(total_results / page_size)`.

Zeit- und Zuordnungsfelder **je record_type** (drei Namensfamilien, keine Schnittmenge):

| record_type | Zeitfeld | Zuordnungs-IDs |
| --- | --- | --- |
| sip-trunking | `started_at` / `finished_at` | `call_control_id`, `telnyx_session_id` |
| call-control | `started_at` | `telnyx_leg_id`, `telnyx_session_id` |
| recording | `started_at` | nur `telnyx_session_id` |
| speech-to-text | `start_time` / `end_time` | `call_leg_id`, `call_session_id` |
| text-to-speech | `created_at` | `call_leg_id`, `call_session_id` |
| inference | `created_at` | nur `conversation_id` (strukturell unzuordenbar) |
| ai-voice-assistant | `created_at` / `completed_at` | `call_control_id`, `telnyx_leg_id`, `telnyx_session_id`, `conversation_id` |

Weitere gemessene Feldformen: `cost` ist ein STRING in Dezimal- ODER SCI-Notation
(`"0.0401"`, `"1.666E-4"`), `billed_sec` / `call_sec` sind Zahlen, `currency` ist `"USD"`,
`provider` am TTS-Beleg ist `"elevenlabs"`, `number_of_characters` am TTS-Beleg ist eine Zahl.

### A2. Fixture-Disziplin — hier ist die Kette zweimal gestorben

Die Gefahr ist nicht "kein Test", sondern "Test bestaetigt die eigene Annahme". Die alten
Fixtures erfanden `leg_id`/`call_leg_id` als Anker — die Tests waren gruen, waehrend live
297 von 297 Belegen verworfen wurden.

1. **Koeder-Pflicht.** Jede Beleg-Fixture traegt mindestens ein Feld, das der Code NICHT
   verwenden darf: `telnyx_leg_id` und/oder `call_leg_id` mit einem Wert, der zu KEINEM
   erwarteten Ergebnis fuehrt. Laeuft ein Test gruen, obwohl nur der Koeder passt, ist der
   Test falsch.
2. **Null-Zwilling-Pflicht** (Plan F3/PM-11). Je Anruf existieren ZWEI `sip-trunking`- und
   ZWEI `call-control`-Belege, davon je einer echt bei null (`cost:"0.0"`, `billed_sec:0`,
   `call_sec:0`) — das zweite Bein. Jede Beleg-Fixture, die eine Kostensumme prueft, enthaelt
   den Null-Zwilling. Wer je Typ nur den ersten Treffer nimmt, verliert 0,0401 USD und
   erstattet real ausgegebenes Geld zurueck. Der Bestandscode summiert ALLE zugeordneten
   Belege; diese Eigenschaft ist zu erhalten.
3. **Rot-vor-Gruen-Pflicht.** Jede Phase hat mindestens einen Test, der VOR der Aenderung
   rot ist. Der rote Lauf (Befehl + Ausgabe) gehoert in den Phasenbericht. Ein Test, der vor
   dem Fix schon gruen war, beweist nichts.

### A3. Der Geldpfad bleibt fail-closed — unantastbar

- Zuordnung asymmetrisch: **kein Anker = leere Liste**, nie "Kosten = 0". Ein FREMDER Beleg
  ist eine Fehlbuchung auf einen fremden Tenant; ein FEHLENDER Beleg ist nur `incomplete`.
- `ok:false` heisst NIEMALS "keine Kosten".
- `call-control` traegt **keinen Anker** (nur `telnyx_leg_id` + `telnyx_session_id`) und ist
  Pflicht-Typ in Produktion (`COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control`).
  Damit haengt **jede Rueckerstattung am Session-Weg**. Die `via_`-Zaehler im Log sind eine
  geld-relevante Sonde: nicht anfassen, nur ergaenzen.
- Die Zuordnungslogik (`anchoredSessionIds`, `assignmentOutcome`, `toCostRecord`) wird in
  diesen Phasen **verschoben, nicht veraendert**. Sie ist der einzige nachweislich
  funktionierende Teil der Kette (live 7/7/10, unter Parallelitaet bestaetigt).

### A4. Kein geratener Query-Parameter — die teuerste Falle

Ein falscher Filtername liefert **HTTP 200 mit 0 Treffern**, keinen Fehler. Gemessen:
`filter[created_at][gte]` auf `sip-trunking` -> 200/0 Treffer, obwohl das Feld dort nicht
existiert; `filter[started_at]` auf `speech-to-text` (Zeitfeld heisst dort `start_time`) ->
0 Treffer trotz 89 Datensaetzen.

**Erlaubte Query-Parameter sind ausschliesslich:** `filter[record_type]` (Pflicht, genau EIN
Wert — Weglassen und Array-Syntax sind beide 400), `page[size]`, `page[number]`.
Jeder weitere `filter[...]`-Parameter ist verboten, solange keine Messung ihn belegt. An der
Query-Konstruktion steht ein Kommentar, der genau diese Regel festhaelt.

Zeitfenster werden **ausschliesslich client-seitig** ausgewertet.

### A5. Repo-Auflagen

- **Neue Env-Variable? An VIER Stellen:** `src/config.js` (Namespace `billing`),
  `.env.example`, `render.yaml` UND `BASE_ENV` in `test/helpers.js`. Fehlt die letzte, leckt
  die lokale `.env` in die Spawn-Tests und die Suite wird unerklaerlich instabil.
- Kommentare deutsch, **ohne Umlaute** (ue/oe/ae), wie im Bestand. ESM, kein Build-Step.
- Keine neuen npm-Dependencies.
- Magic Numbers nur als benannte Konstante; ist der Wert ein Operator-Knopf -> `config.js`,
  ist er eine gemessene Provider-Eigenschaft -> modul-lokale Konstante mit Mess-Kommentar.
- `node --check` auf jede geaenderte Datei, `npm test` gruen (Referenz 2861/0, darf nur
  wachsen).
- **Flake-Protokoll:** es gibt einen vorbestehenden Voll-Last-Flake (~12 %, Seed-vor-Boot-
  Race). Ein roter Test gilt erst als echt rot, wenn er **isoliert** ebenfalls rot ist. Nie
  einen Test "reparieren", der isoliert gruen ist.

### A6. Absolute Grenzen

- **Kein Deploy**, keine Render-Env-Aenderung, kein `scripts/sweep-jetzt.sh`.
- **Keine echten Anrufe. Keine schreibenden Telnyx-Aufrufe. Kein Netz im Test.**
- Safety-Gates, Offenlegungssatz, Auth fail-closed unantastbar.
- **Nicht neu aufrollen:** `ai-voice-assistant` bleibt im Abruf, keine Belegtabelle, kein
  Wasserstand, keine Sub-Accounts (Begruendungen: Plan Kap. 2, Optionen C und D verworfen).
- Blockiert? **Anhalten und melden**, nicht raten und nicht drumherum bauen.

### A7. Der Ist-Zustand des betroffenen Codes (gelesen 2026-07-21)

`src/telephony/adapters/telnyx/voice.js`
- `COST_RECORD_TYPES` (7 Typen, exportiert), `UNASSIGNABLE_COST_RECORD_TYPES = ["inference"]`,
  `ASSIGNABLE_COST_RECORD_TYPES` (abgeleitet, exportiert — der Boot-Guard koppelt daran).
- `COST_RECORDS_PAGE_SIZE = 250` (die tote Sicherung).
- `fetchCostRecordPage(recordType)` — setzt genau `filter[record_type]` + `page[size]`,
  `assertTelnyxOk(res, "getVoiceCostRecords", ATTACH_STATUS)`, dann `parseTelnyxResource`,
  `catch { return {ok:false, reason:"provider_error"} }` — **der Fehler wird nicht gebunden**.
- `parseTelnyxResource(res)` gibt `json.data || json` zurueck — **`meta` geht strukturell
  verloren**. Die Funktion hat zwei WEITERE Aufrufer (Origination, Assistant-Start): ihre
  Signatur/ihr Verhalten fuer diese darf sich nicht aendern.
- `fetchAllCostRecords()` — Schleife ueber `COST_RECORD_TYPES` (also inkl. `inference`),
  `page.raw.length === COST_RECORDS_PAGE_SIZE -> {ok:false, reason:"page_truncated"}`.
- `getVoiceCostRecords({legId, startedAt, endedAt})` — Port-Methode, wirft nie, ruft
  `fetchAllCostRecords()`, dann `anchoredSessionIds` + Schleife `toCostRecord`, loggt ueber
  `logCostRecordsOk`.

`src/telephony/adapters/telnyx/errors.js`
- `assertTelnyxOk(res, op, {includeDetail, attachStatus})` wirft `Error` mit Meldung
  `Telnyx <op> fehlgeschlagen: HTTP <status> (<code> <title>)` und setzt bei `attachStatus`
  `err.providerStatus`. Der Telnyx-Code steckt heute **nur im Meldungstext**.

`src/billing/cost-truing.js`
- `COST_TRUING_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000` (hartkodiert, exportiert; `boot.js`
  registriert das Intervall).
- `isTruingCandidate(call, nowMs)` — `costTruedAt === null`, Versuchszaehler <=
  `costTruingMaxAttempts`, `nowMs - endedMs >= costTruingDelayMinutes * 60000`.
- `sweepAllCandidates(trigger)` — Kandidaten-Schnappschuss, dann `for (const call of
  candidates) await trueOneCall(call, tally)`; **hier sitzt D1**: jeder Kandidat loest einen
  vollstaendigen 7-Typen-Abruf aus.
- `trueOneCall` ruft `control.getVoiceCostRecords({legId, startedAt, endedAt})`, danach
  `classifyRecords`, `refundProven`, `bookCorrectionFor`.
- Sweep-Log-Zeile: `[cost-truing] sweep trigger= kandidaten= gemessen= unvollstaendig=
  ohne_schaetzung= unbestimmt= uebersprungen=`.
- `shouldEmitFinding(key, nowMs)` — Entprellung je Schluessel ueber `costAlertDebounceMs`
  (24 h). `emitFinding(code, ...)` -> `console.warn` + `audit(COST_TRUING_AUDIT_EVENT, ...)`.

`src/boot-guard.js`
- `costTruingBookingFindings({requiredRecordTypes, assignableRecordTypes, coveragePercent,
  minCoveragePercent})` — FATAL bei leerer Pflicht-Menge und bei nicht zuordenbarem
  Pflicht-Typ. `assignableRecordTypes` wird vom Aufrufer hereingereicht (Pflicht-Parameter).

`test/telnyx-cost-records.test.js` (619 Zeilen) — enthaelt die 250-Zeilen-Fixture
(`Array.from({length: 250})`), die ausschliesslich die eigene Konstante testet.

---

## KE-P0 — Fehlerpfad sichtbar machen

**Warum zuerst:** ohne sie ist keine Folgephase verifizierbar. `catch {` bindet den Fehler
nicht einmal; HTTP-Status und Telnyx-Code erreichen den Log nie.

**Aenderung.** In `fetchCostRecordPage` den Fehler binden und PII-frei loggen:

```
[telnyx/voice] getVoiceCostRecords fehler typ=<record_type> status=<providerStatus> code=<telnyx-code>
```

- Der Telnyx-Code muss **strukturiert** verfuegbar sein. Den Meldungstext zu regexen ist
  verboten (brittle, und der Text ist kein Vertrag). Zulaessig: `errors.js` haengt den
  allowlisted `code` analog zu `providerStatus` an den Error (z. B. `err.providerCode`) —
  strikt nur `code`, NIE `detail`, NIE der Roh-Body.
- Fehlt Status oder Code (Netzfehler/Timeout, kein HTTP-Fehler), steht dort ein neutraler
  Platzhalter; die Zeile erscheint trotzdem.
- **Kein Key, keine Rufnummer, kein Body, keine Session-/Leg-ID in der Zeile.**
- Rueckgabewert und Kontrollfluss bleiben unveraendert (`{ok:false, reason:"provider_error"}`).

**rot heute:** ein Test, der `fetch` einen 429 mit Telnyx-Envelope
`{errors:[{code:"10011", title:"Too many requests"}]}` liefern laesst, sieht **keine**
Log-Zeile — im Kosten-Abschnitt existiert kein `console.error`/`console.warn`.

**gruen:** derselbe Test faengt eine Zeile mit `status=429` und `code=10011` ab und weist
nach, dass sie weder `Bearer` noch eine `+`-Nummer noch die Session-/Leg-ID enthaelt.

**Tests:** in `test/telnyx-cost-records.test.js` — *"getVoiceCostRecords loggt Provider-Status
und Telnyx-Code bei 429"* plus ein Leak-Test.

**Abgrenzung:** kein Umbau des Abrufs, keine Paginierung, keine Drossel.

---

## KE-P1 — Die tote Sicherung ersetzen (S1)

**Aenderung.**
1. `COST_RECORDS_PAGE_SIZE` 250 -> **50** (gemessenes hartes Maximum, Kommentar mit Messung).
2. `meta` muss den Aufrufer erreichen. `parseTelnyxResource` wirft es heute mit
   `json.data || json` strukturell weg. Die beiden anderen Aufrufer duerfen sich nicht
   aendern — also entweder eine eigene Listen-Parse-Funktion fuer den Belegabruf oder eine
   erweiterte Rueckgabe, die die Bestandsaufrufer unveraendert laesst. Keine Duplizierung
   der Unwrap-Regel (G5).
3. Truncation-Pruefung gegen **`meta.total_pages` aus der ANTWORT**, nie gegen die eigene
   Konstante. Fehlt/unbrauchbar `meta` bei voller Seite -> fail-closed behandeln
   (`ok:false`), nicht durchwinken.

**rot heute:** Fixture `{data:[50 Records], meta:{total_results:212, total_pages:5,
page_size:50}}` liefert `ok:true` mit 50 Records — eine stille Untermenge von 212 gilt als
vollstaendig.

**gruen:** dieselbe Fixture liefert `{ok:false, reason:"page_truncated"}`.

**Tests:** *"volle Seite mit meta.total_pages>1 gilt nicht als vollstaendig"*. Die bestehende
250-Zeilen-Fixture wird **ersetzt**, nicht ergaenzt — sie testet ausschliesslich die eigene
Konstante und ist das Musterbeispiel des Fehlers, den A2 verhindern soll.

**Richtungshinweis:** diese Phase macht das System voruebergehend **konservativer** (mehr
`incomplete`, weniger Rueckerstattungen). Das ist die sichere Richtung und ausdruecklich
gewollt — kein Grund gegenzusteuern.

---

## KE-P2 — Den Abruf aus der Kandidatenschleife ziehen

**Der Hebel:** der Abruf ist schleifeninvariant (nur `filter[record_type]` + `page[size]`,
kein `legId`, kein Zeitfenster), die Zuordnung nicht. Jeder Kandidat holt heute exakt
dieselben Daten.

**Aenderung.** Auftrennung des Ports an genau einer Stelle (ein produktiver Aufrufer:
`cost-truing.js`; Twilio implementiert die Methode nicht):

- `fetchCostRecordPool({ since })` — **einmal je Sweep**, vor der Kandidatenschleife.
  Liefert `{ ok, raw[], complete }` (in P2 noch ohne Seitenschleife; `since` wird erst in
  P3/P5 wirksam, der Parameter existiert aber bereits).
- `assignCostRecords(pool, { legId, startedAt, endedAt })` — je Call, **synchron**,
  byte-identisch die heutige Logik. Verschoben, nicht veraendert.
- Port-JSDoc in `src/telephony/ports.js` nachziehen. Beide Methoden bleiben optional
  (Twilio-Fallback = kein Abgleich).
- Ein `ok:false`-Pool laesst **ALLE** Kandidaten als `unavailable` stehen — kein Teilerfolg,
  keine Herkunft `telnyx_detail_records`, keine Rueckerstattung.
- **PM-5-Auflage:** zwischen Pool-Abruf und Buchungsschleife darf **kein weiteres Netz-
  `await`** liegen.
- Der Versuchszaehler-Verbrauch bleibt semantisch gleich: ein `ok:false`-Pool verbraucht je
  Kandidat genau so viele Versuche wie heute ein `ok:false`-Abruf.

**rot heute:** Test mit 5 Kandidaten zaehlt **35** `fetch`-Aufrufe.

**gruen:** derselbe Test zaehlt hoechstens **7** — und die je Call zugeordneten Records sind
identisch zum Bestand.

**Tests.**
1. *"Sweep holt Belege einmal, nicht je Kandidat"* — `fetch`-Zaehler.
2. **Aequivalenztest** *"assignCostRecords ordnet aus einem geteilten Pool genau wie der
   Bestandspfad zu"* — **die wichtigste Zusage der Kette**. Modelliert nach dem gemessenen
   Paar aus Plan F4: derselbe Rohbeleg-Satz, zwei Calls mit verschiedenen Ankern, dazu ein
   Beleg einer **fremden** Session, der bei keinem der beiden landet. Koeder-Felder
   (`telnyx_leg_id`, `call_leg_id`) werden ignoriert. Null-Zwillinge enthalten, Summe je Call
   exakt geprueft. Er pinnt, dass der geteilte Pool die fail-closed-Asymmetrie nicht
   aufweicht.
3. *"ok:false-Pool -> alle Kandidaten unavailable, keine Buchung"*.

**Risiko, bewusst:** der Pool ist gemeinsam — ein Zuordnungsfehler traefe alle Calls eines
Sweeps statt einen. Genau dagegen steht Test 2.

---

## KE-P3 — Paginierung ohne geratene Filternamen

**Aenderung.**
1. Je Typ `page[number]` aufsteigend, bis **eine ganze Seite** aelter als `since` ist oder
   die Seitenobergrenze greift. Abbruch ist "ganze Seite ausserhalb", **nie** "erster Record
   ausserhalb" — die Sortierung ist fuer 6 von 7 Typen UNBELEGT (U4).
2. `since` wird ausschliesslich client-seitig gegen das **je Typ gemessene Zeitfeld** (A1)
   ausgewertet. Kein Zeitfilter in der Query (A4). Traegt ein Beleg kein bekanntes Zeitfeld,
   gilt er als "innerhalb" (konservativ, wie der Bestand: fehlendes Feld ist keine Erkenntnis
   ueber die Zeit).
3. Ergebnis traegt `complete: boolean`. Seitenobergrenze erreicht -> `complete:false` ->
   **nie** `telnyx_detail_records`, keine Rueckerstattung (greift bis in `refundProven`
   durch).
4. `UNASSIGNABLE_COST_RECORD_TYPES` (heute `inference`) gar nicht erst abrufen — diese Belege
   werden ausnahmslos verworfen (`session_unresolved`), die Anfrage ist reine Verschwendung.
   Die Typenliste des Abrufs wird aus `ASSIGNABLE_COST_RECORD_TYPES` **abgeleitet**, nicht von
   Hand gepflegt (G27).
5. Die Seitenobergrenze ist eine benannte Konstante mit Begruendung.

**rot heute (a):** `grep 'page\[number\]\|total_pages' src/telephony/adapters/telnyx/voice.js`
-> 0 Treffer; Belege ab Position 51 je Typ sind strukturell unauffindbar.
**rot heute (b):** `fetchAllCostRecords` laeuft ueber `COST_RECORD_TYPES` und holt
`inference` mit — 7 Abrufe je Seitenrunde.

**gruen:** Test mit 3 Seiten (50/50/12) liefert 112 Records; Test mit erreichter
Seitenobergrenze liefert `complete:false`; ein Test zaehlt **6 statt 7** Abrufe je
Seitenrunde und weist nach, dass die abgerufene Typenmenge exakt
`ASSIGNABLE_COST_RECORD_TYPES` ist.

**Tests.**
1. *"Seitenschleife sammelt alle Seiten bis das Fenster verlassen ist"*.
2. *"Seitenobergrenze erreicht -> nicht vollstaendig, keine Rueckerstattung"*.
3. *"unsortierte Seite bricht die Schleife nicht vorzeitig ab"* — eine Seite, deren ERSTER
   Record ausserhalb und deren letzter innerhalb des Fensters liegt, darf die Schleife nicht
   beenden.
4. *"abgerufene Typenmenge == ASSIGNABLE_COST_RECORD_TYPES"*.
5. Ein Test, der die **gesendete Query** pinnt: exakt `filter[record_type]`, `page[size]=50`,
   `page[number]` — und **kein** `filter[...]`-Zeitparameter.

---

## KE-P4 — Drossel am gemessenen Minutenfenster

**Gemessen (Plan F1):** `/v2/detail_records` erlaubt **40 Anfragen je FIXEM UTC-
Minutenfenster**. Das Fenster gleitet nicht, der Reset faellt immer auf `:00`. Es gibt
**kein `Retry-After`**, nur `x-ratelimit-reset` (Sekunden bis zur naechsten vollen Minute).
Bei Ueberschreitung: HTTP 429 mit Telnyx-Code `10011`.

**Aenderung.**
- Token-Bucket am **fixen UTC-Minutenfenster** (nicht gleitend): Budget bewusst **30 von 40**
  (Reserve). Benannte Konstanten mit Mess-Kommentar.
- Bei 429 trotzdem: bis zum naechsten `:00` warten (Quelle: `x-ratelimit-reset`, Fallback
  wenn der Header fehlt), **hoechstens einmal**, dann `ok:false`. Keine Schleife.
- Uhr und Warten sind **injizierbar** (Default: echte Uhr / echter Timer), damit der Test
  ohne `sleep` auskommt. Kein `setTimeout`-Schlaf im Test.
- Die Drossel gilt fuer den Belegabruf. Andere Telnyx-Aufrufe (Origination, Assistant-Start)
  bleiben unberuehrt — das Kontingent ist pro Endpunkt konfiguriert.

**rot heute:** 224 Anfragen ohne Pause, live gemessen `{"200":40,"429":184}`.

**gruen:** Test mit injizierter Uhr: 100 angeforderte Seiten -> hoechstens **30** `fetch` je
simulierter Minute; ein 429-Fixture -> genau **ein** Wiederholungsversuch, danach `ok:false`.

---

## KE-P5 — `since` aus den Kandidaten ableiten

**Aenderung.**
- `since` = **aeltester `endedAt` der Kandidaten minus Marge** (benannte Konstante,
  Begruendung im Kommentar). Der Blindwert waere sonst das volle Fenster W.
- **Keine Kandidaten -> gar kein Abruf** (0 `fetch`), und der Sweep bleibt ein sauberes
  No-op ohne Befund und ohne Versuchsverbrauch.
- Unbrauchbarer `endedAt` eines Kandidaten darf `since` nicht ins Bodenlose ziehen: solche
  Calls sind ohnehin keine Kandidaten (`isTruingCandidate` prueft `Number.isFinite`).

**rot heute:** ein Sweep mit einem einzigen 3 h alten Kandidaten zieht denselben Umfang wie
einer mit 200.

**gruen:** leere Kandidatenliste -> **0** `fetch`; ein 3 h alter Kandidat -> hoechstens 7
Anfragen (bzw. 6 nach P3).

---

## KE-P6 — Boot-Guard-Kopplung, ElevenLabs je Tenant, Sweep-Log

Drei Aenderungen, alle in dieser Phase.

**Aenderung 1 — Boot-Guard-Kopplung 1:1 erhalten.** `costTruingBookingFindings` koppelt
heute ueber den hereingereichten `assignableRecordTypes` an `ASSIGNABLE_COST_RECORD_TYPES`.
Loest der Umbau (P3 leitet die Abruf-Typenliste daraus ab) diese Kopplung, wird die
Pflicht-Menge unbemerkt wieder mit einem unzuordenbaren Typ erfuellbar — Rueckfall vor
LCT-FIX-1. Ein Test pinnt: die Menge, gegen die der Boot-Guard prueft, und die Menge, die
der Abruf holt, stammen aus **derselben** Quelle.

**Aenderung 2 — ElevenLabs-Zeichen je Tenant (aus Plan F6).** Der Telnyx-Beleg traegt die
Menge selbst: `record_type="text-to-speech"`, `provider="elevenlabs"`,
`number_of_characters=<n>`. Heute zaehlt `recordTtsCharacters` (state-ops.js) auf ein
**globales** Objekt (`platformTtsUsage`, bewusst tenant-los) und wird nur vom Budget-Pfad
gefuettert (einziger Aufrufer `tts/directive-synth.js`); auf dem Assistant-Pfad
synthetisiert Telnyx serverseitig, unser Prozess sieht davon nichts — der Zaehler steht dort
dauerhaft bei 0.

- `number_of_characters` des zugeordneten `text-to-speech`-Belegs wird im Port-Record
  mitgefuehrt (nur wenn der Beleg zugeordnet wurde — dieselbe fail-closed-Asymmetrie).
- Die Zeichen werden **pro Tenant** verbucht. Der bestehende globale Zaehler bleibt, was er
  ist; die Tenant-Dimension kommt daneben, nach dem Muster der uebrigen pro-Tenant-Zeilen
  (beide Backends `json.js` + `pg.js`, `src/db/schema.sql` inkl. RLS wie bei anderen
  Tenant-Tabellen, `hydrate`/`flush`, `state-ops.js`-Operation, Tests auf beiden Backends —
  die Suite faehrt pglite in-process, die Tabelle ist also real testbar).
- **Doppelzaehlung ist auszuschliessen:** ein Anruf darf seine Zeichen nur einmal verbuchen.
  Der Sweep laeuft je Call genau einmal (`costTruedAt`), das ist der Riegel — er ist im Test
  zu pinnen.
- **Ist diese Aenderung ohne eine unverifizierbare DB-Migration nicht sauber machbar,
  wird sie NICHT improvisiert:** dann Phase anhalten, Aenderung 1 und 3 liefern, den Grund
  benennen. Keine Ersatzloesung erfinden, insbesondere nicht "global statt pro Tenant" —
  das waere genau die Luecke, die geschlossen werden soll.

**Aenderung 3 — Sweep-Log.** Die bestehende Zeile
`[cost-truing] sweep trigger= kandidaten= gemessen= ...` wird um
`anfragen=<n> seiten=<n> pool=<n> vollstaendig=<bool>` ergaenzt. Bestehende Felder und ihre
Reihenfolge bleiben unveraendert (Log-Konsumenten). Das Format ist testgepinnt: es ist die
Datenquelle des Bruchpunkt-Waechters (P8) und liefert nebenbei B = pool/kandidaten aus der
Wirklichkeit (U9).

**rot heute:** das Sweep-Log nennt keine einzige Zahl ueber den Abruf selbst — genau deshalb
war D1 unsichtbar; der TTS-Zaehler steht global bei 0 Zeichen fuer jeden Assistant-Anruf.

**gruen:** eine Log-Zeile je Sweep traegt `anfragen=` und `vollstaendig=`; ein Test pinnt das
Format; ein zweiter Test pinnt, dass die Zeichen am **richtigen Tenant** landen (zwei
Tenants, ein Beleg je Tenant, kein Ueberlauf in den anderen).

---

## KE-P6B — Verzug und Kadenz an die Messung anpassen

Erst hier, nicht frueher: eine kuerzere Kadenz ist nur tragbar, wenn ein Sweep 7-14 statt
224 Anfragen kostet (P2/P3) und gedrosselt ist (P4).

**Aenderung.**
- `COST_TRUING_DELAY_MINUTES` Default 180 -> **30**. Begruendung: Plan F3 misst die Belege
  spaetestens nach **133 s** vollstaendig und wertrichtig; 30 min sind ein 13-facher
  Sicherheitsabstand, kein Ratewert. Der Kommentar traegt die Messung.
- `COST_TRUING_SWEEP_INTERVAL_MS` ist heute in `cost-truing.js` hartkodiert (6 h) und wird
  zur **Env-Variablen** mit Default **1 h**. Vier Stellen (A5). `boot.js` liest weiter genau
  eine Quelle.
- Nebeneffekt, gewollt: W schrumpft von 33 h auf 3 h + 5 x 1 h = 8 h.

**rot heute:** eine Korrektur landet fruehestens 3 h nach Gespraechsende, im Mittel erst nach
6 h Wartezeit obendrauf; `grep -n "6 \* 60 \* 60 \* 1000" src/billing/cost-truing.js` liefert
eine hartkodierte Zahl.

**gruen:** Test 1: ein Call, dessen `endedAt` **31 min** zurueckliegt, ist Kandidat; einer mit
**29 min** nicht. Test 2: das Intervall kommt aus der Config, Default 1 h.

**Deploy-Auflage (keine Code-Aenderung, gehoert in die Checkliste):**
`COST_TRUING_MAX_ATTEMPTS` zurueck auf **5** — der am 2026-07-21 im Render-Dashboard
gesetzte Wert 20 war die Fristverlaengerung. Sonst bleibt W bei 3 h + 20 x 1 h = 23 h statt
8 h.

---

## KE-P8 — Bruchpunkt-Waechter

**Aenderung.**
- Ueberschreitet `anfragen` je Sweep die **Betriebsschwelle 1.440** (= 36 min x 40 Anfragen,
  10 % eines 6-h-Intervalls; benannte Konstante mit dieser Herleitung im Kommentar), feuert
  der **bestehende** entprellte Befundkanal `shouldEmitFinding` (24 h) — Log + Audit.
- **Kein neuer Alarmweg, keine zusaetzliche SMS-Klasse** (PM-7): derselbe Pfad wie
  `coverage_below_threshold`, neuer Befund-Code.

**rot heute:** nichts warnt, bevor das Kontingent reisst; das Rate-Limit fiel erst durch sein
Sprengen auf.

**gruen:** Test mit simulierten 1.500 Anfragen erzeugt **genau einen** Befund je 24 h (zwei
Sweeps hintereinander -> ein Befund).

---

## Nicht Teil dieser Kette

- **KE-P7 (Live-Verifikation)** ist Owner-Aktion und wird NICHT implementiert — nur in
  `tasks/ke-DEPLOY-CHECKLIST.md` vorbereitet.
- Option C (persistente Belegtabelle mit Wasserstand), Option D (Managed Accounts),
  Rueckbau des `ai-voice-assistant`-Pfads, Compare-and-Set fuer `costTruedAt` (gehoert zur
  zweiten Instanz, PM-5).
