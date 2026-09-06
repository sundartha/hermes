# P2 - Der Halt wird dreistufig: erst pruefen, ob der Kanal traegt, dann warten

Autoritative Spec fuer Phase P2 aus `PLAN-ANRUFDEFEKTE.md` (Abschnitt 4, P2). Diese Datei geht
dem Plan-Dokument vor, wo beide sich widersprechen (siehe "Entscheidung E-1"). Umbrella-Kontext:
W2, W3 und N-10 in Abschnitt 2, PM-1 in Abschnitt 5.

## Warum (in einem Satz)

Ein unbeantworteter `get_consult` friert die laufende Telefonverbindung bis `CONSULT_OPEN_MS`
(47 s) ein, waehrend der Anrufer stummgeschaltet ist und nur eine 8-Sekunden-Tippschleife hoert.
Eine pauschale Frist kann nicht gleichzeitig "kann hier ueberhaupt jemand antworten?"
(Millisekunden) und "wie lautet die Antwort?" (Sekunden) beantworten.

## SCOPE

### 1. Der Halt wird gestaffelt

| Stufe | Frist (Default) | Was geprueft wird | Bei Ausbleiben |
|---|---|---|---|
| 0 | `EL_CONSULT_DELIVERY_MS` = 5000 ms ab Consult-Entstehung | Wurde die Frage an einen pollenden Client AUSGELIEFERT? | `reason: "not_delivered"` |
| 1 | `EL_CONSULT_ACK_MS` = 5000 ms **zusaetzlich** (also 10 000 ms ab Entstehung) | Hat der Client quittiert? | `reason: "not_acked"` |
| 2 | `EL_CONSULT_ANSWER_MS` = 30000 ms **gesamt ab Entstehung** | die eigentliche Antwort | `reason: "timeout"` |

Erreicht eine Stufe ihr Ziel, laeuft die naechste; scheitert eine, endet der Halt SOFORT.

### 2. Die Quittung haengt an DERSELBEN Berechtigung wie die Antwort

Kein neues Werkzeug. `answer_consult` bekommt einen leichten Modus (Antwortfeld weggelassen
bzw. `status: "working"`), den das Modell unmittelbar nach Erhalt der Frage ruft. Ein neues
`ack_consult` haette eine eigene Connector-Berechtigung, die per Default wieder auf "nachfragen"
stuende - die Falle waere identisch nachgebaut. **Das Ausbleiben der Quittung IST der
Berechtigungstest.** Die Pflicht zur sofortigen Quittung steht in der Werkzeugbeschreibung UND
im bestehenden Instruktionsblock (`MCP_CONSULT_INSTRUCTIONS`).

### 3. Der Anrufer wird waehrend der Rueckfrage nicht mehr stummgeschaltet

Am Werkzeug `get_consult` in `elevenlabs/agent_configs/outbound-agent.template.json`:
`interruption_mode: "allow"` (Anbieter-Default) statt `disable_during_tool`. Eine Wartezeit von
bis zu 30 s ist nur vertretbar, wenn der Mensch sie jederzeit abbrechen kann. Gemessen am
16:06-Anruf: vier laute Einwuerfe (34/35/39/54 s) loesten nichts aus.

Der Plan-Agent stellt am Anbieter-Schema fest, WELCHES Feld die Unterbrechbarkeit waehrend eines
Werkzeug-Aufrufs tatsaechlich regiert (`interruption_mode` und/oder das aeltere boolesche
`disable_interruptions` am selben Werkzeug), und benennt seine Wahl mit Begruendung. Ziel ist die
WIRKUNG: der Anrufer kann waehrend `get_consult` unterbrechen.

### 4. Der Warteton wird gesprochen, nicht getippt

`tool_call_sound: null` am Werkzeug `get_consult`. `pre_tool_speech` steht bereits auf `force`,
der Agent sagt also hoerbar, dass er kurz etwas klaert. Die 8-s-Tippschleife entfaellt.

### 5. Die Vorlagenaenderung muss den Live-Agenten auch erreichen koennen

Heute fuehrt die Besitz-Karte den Eintrag `tools` mit der Vergleichsart `"namen"`: verglichen
und geschrieben werden nur Werkzeug-NAMEN, keine werkzeug-internen Felder (W9). Ohne Erweiterung
waere die Vorlagenaenderung aus 3. und 4. **wirkungslos** - der Push schriebe sie nicht, das
Drift-Gate saehe sie nicht.

Deshalb gehoert in diese Phase: **genau die zwei Felder `interruption_mode` und
`tool_call_sound` am Werkzeug `get_consult`** werden von uns besessen, vom Push geschrieben und
vom Drift-Gate ueberwacht. Nicht mehr. Der breite Umbau der Besitz-Karte ist P8 und NICHT Teil
dieser Phase.

**Fail-safe-Bedingung dazu (Blocker bei Verletzung):** die Erweiterung darf kein weiteres
werkzeug-internes Feld in den Schreibpfad ziehen. `pre_tool_speech`, `force_pre_tool_speech`,
`response_timeout_secs`, `tool_call_sound_behavior` und `disable_interruptions` (falls nicht
nach 3. bewusst gewaehlt) bleiben ungeschrieben. Begruendung: die Vorlage ist fuer diese Felder
nie gegen den Live-Stand abgeglichen worden; ein breiter Schreibpfad wuerde live gemessene
Werte durch nie gepruefte Vorlagenwerte ersetzen.

### 6. Der Consult-Datensatz haelt die neuen Zeitpunkte fest

`deliveredAt` und `ackedAt`, additiv-nullable, in BEIDEN Store-Backends (`json` und `pg`). Der
Impl-Bericht nennt ausdruecklich, ob eine DDL-Aenderung noetig war und ob ein Backfill entfaellt
(er entfaellt: Consult-Datensaetze sind pro Anruf und kurzlebig, und es gibt keine Kunden -
`no-existing-customers-premise`). Zusaetzlich haelt der Datensatz beim Abbruch den Grund fest
(`not_delivered` / `not_acked` / `timeout`), damit P3 ihn ohne Rateschritt auditieren kann.

### 7. Die falsche Datei-Doku wird richtiggestellt

`src/consult/in-call.js` behauptet woertlich "Ein laenger offener Consult verlaengert KEIN
Gespraech - es wird nirgends gewartet". Das gilt fuer den Budget-Pfad. Auf dem heute live
laufenden ElevenLabs-Weg wird sehr wohl gewartet. Der Kommentar wird praezisiert, nicht geloescht.

### 8. Betroffene Dateien (Richtwert, keine Zeilennummern uebernehmen)

`src/config.js`, `.env.example`, `render.yaml`, `src/routes/webhooks-elevenlabs.js`,
`src/conversation/consult-raised.js`, `src/consult/delivery.js`, `src/consult/in-call.js`,
`src/store/state-ops.js` (+ ggf. `src/store/json.js` / `src/store/pg.js` / Views),
`src/mcp-tools.js`, die REST-Route hinter `answer_consult`,
`elevenlabs/agent_configs/outbound-agent.template.json`, `scripts/push-elevenlabs.mjs` bzw. die
Besitz-Karte, `test/helpers.js` (BASE_ENV), neu `test/el-consult-staffelung.test.js`.

## ENTSCHEIDUNGEN (bindend)

- **E-1 (Widerspruch im Plan-Dokument, hier entschieden): die drei Fristen sind ENV-aenderbar.**
  Die P2-Tabelle nennt "Modul-Konstanten nach dem Muster von `EL_LOOKUP_TIMEOUT_MS`", die
  Entschaerfung von PM-1 verlangt "ueber Env aenderbar". PM-1 gewinnt: genau die Zahl, die den
  Kanal toeten kann, muss ohne Code-Aenderung korrigierbar sein. Also Repo-Konvention:
  Eintrag in `src/config.js` mit Herleitungskommentar, dokumentiert in `.env.example`, geprueft
  in `render.yaml`, **und in `BASE_ENV` der Test-Helper** - sonst leckt die echte `.env` in
  Spawn-Tests (`test-base-env-drift`). Die Werte sind zusaetzlich pro Aufruf ueberschreibbar
  (Testpfad, wie `holdMs` heute).
- **E-2 (F-4, Owner 06.09.): eine Antwort nach Fristablauf wird VERWORFEN.** Der Consult wird
  mit der Frist geschlossen; ein spaeteres `answer_consult` auf denselben Consult wird mit einer
  klaren, maschinenlesbaren Ablehnung beantwortet (kein stiller Erfolg). Ein offener Datensatz
  ohne Zustellweg ist ein Phantom.
- **E-3: eine Antwort ist implizit auch eine Quittung.** Ein Client, der ohne Vorab-Quittung
  direkt antwortet, wird nicht bestraft, solange seine Antwort vor der jeweiligen Frist liegt.
  Das haelt den heutigen Normalfall (5 von 5 beantworteten Rueckfragen kamen in 7,8-19,6 s) am
  Leben.
- **E-4: kein neuer gesprochener Text.** Alle drei Abbruchgruende sprechen den bestehenden
  Timeout-Text (`locale.prompt.turnControl.consultTimeout`). Der Grund ist maschinenlesbar in
  der Antwort und am Datensatz, nicht im Gespraech. Keine neuen i18n-Strings, kein
  Locale-Drift, kein neuer Uebersetzungsbedarf.
- **E-5: `CONSULT_OPEN_MS` bleibt unveraendert** der Wert fuer den MCP-Long-Poll-Weg und wird
  von dieser Phase nicht angefasst.
- **E-6: die Zahlen 5000/5000/30000 sind ausdruecklich VORLAEUFIG.** Fuer Stufe 0 und 1
  existiert keine Messung, weil genau diese Zeitpunkte heute nicht protokolliert werden (N-10).
  Der Herleitungskommentar sagt das woertlich und nennt P3 als die Phase, aus deren Telemetrie
  sie nachkalibriert werden. Bindend nach oben bleibt `response_timeout_secs = 60` am Werkzeug.

## INVARIANTEN (Verletzung = Blocker)

- **I-1:** Der Offenlegungssatz, seine feste Verdrahtung und die Reichweite der OC-Ausnahme
  bleiben unberuehrt. Diese Phase fasst `calleeIsOwner` nicht an.
- **I-2:** `transcribe_on_disabled_interruptions` wird NICHT auf `true` gesetzt - das
  reaktiviert den am 04.09. gemessenen Phantom-Turn-Defekt (Commit 5ba507a, N-6).
  `disable_first_message_interruptions` wird NICHT angefasst - dieser Schalter schuetzt die
  Art.-50-Eroeffnung davor, unterbrochen zu werden.
- **I-3:** Keine neue Route, kein Eintrag in `src/route-policy.js`, keine neue Auth-Ausnahme.
  `answer_consult` wird erweitert, nicht dupliziert.
- **I-4:** Kein Fragetext, keine Antwort, kein Transkriptfragment in Logs oder Audit
  (Absolute Regel 4/5).
- **I-5:** Der Budget-/Telnyx-Weg (`src/consult/in-call.js`, `src/claude.js`) behaelt sein
  heutiges Verhalten. Diese Phase aendert den ElevenLabs-Weg.
- **I-6:** Die Aenderung an der Besitz-Karte zieht ausschliesslich die zwei benannten Felder in
  den Schreibpfad (siehe SCOPE 5, Fail-safe-Bedingung).
- **I-7:** Der HTTP-Halt darf in keinem Fall laenger dauern als `EL_CONSULT_ANSWER_MS` + ein
  Poll-Tick. Es darf keinen Pfad geben, auf dem eine Stufe die naechste ueberspringt und
  laenger haelt als die Gesamtfrist.

## Abnahme (deterministisch, ohne echten Anruf)

1. Consult ohne jeden pollenden Client: HTTP-Antwort nach hoechstens `EL_CONSULT_DELIVERY_MS` +
   ein Tick, `{ status: "timeout", reason: "not_delivered" }`.
2. Consult zugestellt, keine Quittung: Antwort nach hoechstens
   `EL_CONSULT_DELIVERY_MS + EL_CONSULT_ACK_MS` + ein Tick, `reason: "not_acked"`.
3. Quittung da, keine Antwort: Antwort nach `EL_CONSULT_ANSWER_MS` (gesamt), `reason: "timeout"`,
   gesprochener Text unveraendert `locale.prompt.turnControl.consultTimeout`.
4. Quittung da, Antwort nach 18 s (Testzeit gegen heruntergesetzte Fristen): unveraendert
   ausgeliefert, `status: "answered"`.
5. Antwort OHNE vorherige Quittung, innerhalb der Frist: wird ausgeliefert (E-3).
6. Antwort NACH Fristablauf: wird abgelehnt, der Consult bleibt geschlossen (E-2).
7. `CONSULT_OPEN_MS` und der Budget-Pfad sind unveraendert (Regressionstest, deckt I-5).
8. **Drift:** `npm run elevenlabs:drift` meldet nach dieser Phase eine Abweichung GENAU fuer
   `interruption_mode` und `tool_call_sound` am Werkzeug `get_consult` und fuer nichts sonst -
   das ist der erwartete Zustand VOR dem Owner-Push und der Beleg, dass die Besitz-Erweiterung
   greift und eng ist. Nach dem Push (Owner) ist der Lauf gruen. Ein roter Drift-Lauf mit
   genau diesen zwei Feldern ist KEIN Merge-Blocker; jede weitere Abweichung schon.

## Verifikation

```
node --check src/routes/webhooks-elevenlabs.js && node --check src/conversation/consult-raised.js && node --check src/mcp-tools.js && node --check src/config.js
node --test test/el-consult-staffelung.test.js
node --test test/gq-p2-consult-deadline.test.js test/al-p13-consult-channel.test.js test/al-p14-in-call-consult.test.js test/elevenlabs-consult-webhook-envelope.test.js test/elevenlabs-consult-webhook-guards.test.js
npm test
npm run elevenlabs:drift    # read-only; erwartetes Ergebnis siehe Abnahme 8
```

## ABGRENZUNG (ausdruecklich NICHT in dieser Phase)

- **Kein Push zum Anbieter.** `scripts/push-elevenlabs.mjs` ist in dieser Kette in JEDER
  Aufrufform gesperrt, auch der Trockenlauf. Der Push ist Owner-Arbeit und laeuft NACH dem
  Server-Deploy (umgekehrt rendert der Anbieter nackte Platzhalter).
- **Kein Audit-Eintrag beim Timeout** - das ist P3. P2 stellt nur den Grund am Datensatz bereit.
- **Keine Sprachwahl** - das ist P4.
- **Kein breiter Besitz-Umbau** (`vad.*`, `asr.*`, alle uebrigen werkzeug-internen Felder) -
  das ist P8.
- **Keine Aenderung an `turn_eagerness`, `background_voice_detection`,
  `interruption_ignore_terms`, `asr.keywords`** - das ist P7, und dort genau EINE Stellschraube.
- Kein neues npm-Paket.
