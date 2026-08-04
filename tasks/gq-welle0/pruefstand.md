# PRUEFSTAND — Wiederholungs-Pruefstand (Welle 1, blockiert die Kette)

Stand: 2026-08-04, gegen `master` @ `6061b23`. Nur gelesen, nichts geaendert.

---

## 1. Der Kern-Befund: die Naht existiert bereits, das Material war falsch — aber die SCHLEIFE kann B-1 strukturell nicht erzeugen

Der Conversation-Bench (`npm run convo-bench`) hat die richtige Naht schon. Er ist NICHT
das Problem, das man wegwerfen muss. Drei Dinge sind am Code belegt:

**(a) Er misst den echten Pfad, keine Attrappe.** `scripts/convo-bench/runner.mjs:245`
startet ueber `test/helpers.js#startServer` einen echten `node src/server.js` als
Kindprozess und spricht ihn ueber HTTP an. Der Shim-Treiber
(`scripts/convo-bench/driver-shim.mjs:174-184`) postet gegen die real gemountete Route
`/v1/chat/completions` (`src/app.js:137` -> `makeTelnyxLlmShim`,
`src/telnyx-llm-shim.js:372`). Von dort laeuft es durch **alle vier Shim-Gates** und
landet in `agentTurn` (`src/telnyx-llm-shim.js:573` -> `src/claude.js:780`). Das ist
woertlich der Pfad, auf dem der Beleg-Anruf gescheitert ist (B-8: outbound = Shim/Assistant).

**(b) Das Modell ist echt.** `runner.mjs:74` pinnt `CLAUDE_MODEL=claude-haiku-4-5` fuer
den Kindprozess und `convo-bench.mjs:98-105` verlangt einen echten `ANTHROPIC_API_KEY`.
Werkzeugwahl wird also wirklich vom Modell entschieden, nicht simuliert.

**(c) Und trotzdem kann er B-1 nie erzeugen.** Die Gegenstellen-Schleife in
`runner.mjs:262-299` ist streng sequenziell: `turn = await transport.say(callee.text)`
(Zeile 296) — der naechste Anrufer-Turn geht erst raus, wenn die Antwort auf den
vorigen komplett zurueck ist. **Genau diese Reihenfolge ist der Defekt B-1.** Live
liegen `turnSeq 1` und `turnSeq 2` eine Millisekunde auseinander; im Beleg-Anruf kommt
Segment 10 (`08:43:17.880`) an, waehrend die Antwort auf Segment 09 (`08:43:15.745`)
noch laeuft — sie erscheint erst `08:43:18.583`. Ein `await`-Loop kann diese
Ueberlappung nicht bauen. Auch `scriptedTurns` (`persona.mjs:99-103`) hilft nicht: es
ersetzt nur den TEXT, nicht die Taktung.

Dazu zwei kleinere, ebenfalls belegte Bremsen: der globale Turn-Cap steht auf 10
(`convo-bench.mjs:24`), der Beleg-Anruf hat **19** Anrufer-Turns; und `nextCalleeTurn`
(`persona.mjs:91`) erfindet die Gegenseite mit einem sauberen Modell, erzeugt also weder
Kauderwelsch noch Doppel-Zustellung.

### Was daraus folgt

Nicht "Bench erweitern" und nicht "neu bauen", sondern: **Treiber, Fakes und Server-Start
wiederverwenden, die Gegenstellen-SCHLEIFE neu schreiben.** Der Treiber-Port
(`drivers.mjs`, Vertrag `say(text) -> await turn`) ist selbst sequenziell definiert — ihn
fuer Ueberlappung umzubauen, wuerde beide Bestands-Treiber und alle 18 Szenarien
beruehren. Deshalb: eigener Einstieg, geteilte Bausteine.

---

## 2. Entscheidung 1 — die Naht

**Prozess-extern, HTTP gegen einen lokal gestarteten Server. Konkret: `POST
/v1/chat/completions`** (gemountet `src/app.js:137`, Handler
`src/telnyx-llm-shim.js:372`, Kern `src/claude.js:780#agentTurn`).

Begruendung, warum NICHT in-process `agentTurn` direkt:

- Der halbe Befundsatz lebt **oberhalb** von `agentTurn`, im Shim: Loop-Guard
  (`:526,539`), Rate-Gate (`:549`), Budget-Gate (`:561`), Streaming-Armierung (`:499`),
  `end_call`-Abschieds-Terminierung (`:668-677`) und die vollstaendige Diagnose-Zeile
  `turn_ok` (`:579-596`). Ein In-Process-Harness misst genau diese Schicht **nicht** und
  waere wieder ein Harness, das eine Attrappe misst.
- Der Shim ist ausserdem die einzige Stelle, an der zwei ueberlappende Anrufer-Turns
  ueberhaupt als zwei nebenlaeufige `agentTurn`-Aufrufe auf **derselben** lebenden
  `call`-Referenz entstehen (`resolveOrReattachActiveCall`, `:487`). Beide lesen dann
  `call.transcript` (`claude.js:808`) in fast demselben Zustand — das ist die Mechanik
  von B-1. In-Process muesste man sie nachbauen, also erfinden.

**Richtung: outbound (O-13).** Inbound laeuft heute ueber die Budget-Engine (B-8/B-9) und
hat kein Rohtranskript — dort gibt es nichts abzuspielen, bis O-10/O-11 stehen.

---

## 3. Entscheidung 2 — die Fake-Grenze

**Echt (nicht gestubbt):**

| Was | Warum |
| --- | --- |
| `node src/server.js` als Kindprozess | der echte Gateway, echte Middleware, echte Gates |
| Route `/v1/chat/completions` inkl. aller vier Shim-Gates | das Messobjekt liegt teilweise dort |
| `agentTurn` + Tool-Loop + Systemprompt + `agentTools()` | Werkzeugwahl IST das Messobjekt |
| Anthropic-API, `claude-haiku-4-5` | ein Fake-Modell misst nichts |
| Store (JSON, Temp-`DATA_DIR`) | `take_message` schreibt dorthin, B-6 wird dort abgelesen |

**Gestubbt (muss weg, kostet sonst Geld oder ruft Menschen an):**

| Was | Wie | Beleg |
| --- | --- | --- |
| Telnyx Call-Control + Messaging | `TELNYX_API_BASE` -> lokaler Fake | `scripts/convo-bench/telnyx-fake.mjs`, gesetzt in `driver-shim.mjs:194` |
| Telnyx-Credentials | Wegwerf-Werte | `test/helpers.js#TELNYX_ASSISTANT_BOOT_ENV` |
| ElevenLabs-TTS | bleibt aus | `BASE_ENV.ELEVENLABS_PLAY_TTS_ENABLED="false"` (`test/helpers.js:186`) |
| Exa-Suche | lokaler Fake | `scripts/convo-bench/exa-fake.mjs` (`EXA_API_BASE`) |
| MCP-Rueckkanal fuer `get_consult` | lokale Pumpe | `scripts/convo-bench/consult-pump.mjs` |

**Die Grenze in einem Satz:** alles, was ueber HTTP zu einem Dritten geht, geht zu einem
lokalen Fake — **ausser** `api.anthropic.com`.

**Was der Harness NIE tut:** `POST /api/calls` aufrufen. Das ist die einzige Route mit
`originateCall`; der Bestands-Bench meidet sie ausdruecklich und seedet statt dessen
direkt in den Store (`runner.mjs` Kopfkommentar, Zeile 3-5). Der Pruefstand uebernimmt das
unveraendert.

**Zusaetzlicher, fail-closed Riegel (neu, gehoert in die Phase):** vor `startServer` prueft
der Harness, dass `TELNYX_API_BASE` gesetzt ist und auf `127.0.0.1`/`localhost` zeigt —
sonst Abbruch **vor** dem ersten bezahlten Request. Ohne diesen Riegel wuerde ein
vergessenes/geerbtes `TELNYX_API_BASE` aus einer lokalen `.env` echte Call-Control- und
SMS-Kommandos an Telnyx schicken (Abschieds-Hangup, `terminateCall`; SMS-Zusammenfassung
am Call-Ende). Das ist der einzige realistische Weg, auf dem dieser Harness Geld verbrennt
oder einen echten Anschluss beruehrt.

---

## 4. Entscheidung 3 — Kosten

**Schaetzung, arithmetisch, ausdruecklich nicht gemessen:** 19 Anrufer-Turns, ~1,4
Modell-Runden je Turn (Tool-Loop) = ~26 Anfragen. Je Anfrage Systemprompt + Werkzeug-
Definitionen + wachsende Historie, grob 3.500 Input-Tokens und ~130 Output-Tokens.
Haiku 4.5 kostet 1 USD / 5 USD je 1M (`runner.mjs:50-53`).

    26 x 3.500 = 91.000 In  -> 0,091 USD
    26 x   130 =  3.400 Out -> 0,017 USD
    ------------------------------------
    ~0,11 USD je Abspielen von call_msczdf1aadbw

Also **rund 10-15 US-Cent je Lauf**, ~0,30 USD fuer alle drei Anrufe, ~2x davon bei einem
Sonnet-A/B (O-4). Judge/Persona entfallen: der Pruefstand hat keine Persona (das Material
ist fix) und braucht fuer die vier Abnahme-Befunde keinen LLM-Judge — alle vier sind
deterministisch zaehlbar.

**Wichtiger als die Schaetzung:** der Lauf weist die ECHTEN Kosten aus. `runner.mjs:308`
liest `store.usage[tenantId]` aus dem Temp-Store; der Pruefstand macht dasselbe und
druckt Tokens + USD je Lauf. Nach dem ersten Lauf ersetzt die Messung diese Schaetzung.

**Wie verhindert wird, dass jemand versehentlich telefoniert:** siehe §3 — kein
`/api/calls`, Telnyx-Base auf einen lokalen Fake mit fail-closed-Vorpruefung,
Wegwerf-Credentials, TTS aus. Zusaetzlich: der Harness ist **kein** `node:test`-Test und
laeuft nie in `npm test` mit; er verlangt einen explizit gesetzten `ANTHROPIC_API_KEY`
und bricht ohne ihn ab, bevor irgendetwas startet (Muster `convo-bench.mjs:98-105`).

---

## 5. Entscheidung 4 — wo er lebt

`scripts/` — wie `convo-bench`. Nicht `test/` (er darf rot sein, er ruft das echte
Modell, er gehoert nicht in `npm test`), nicht `bin/` (existiert nicht in diesem Repo).

    scripts/replay-call.mjs            CLI-Einstieg (Muster: scripts/convo-bench.mjs)
    scripts/replay/fixture.mjs         TSV + Kopf-Metadaten -> Abspielplan
    scripts/replay/schedule.mjs        Wanduhr-Taktung, NICHT-blockierendes Senden
    scripts/replay/shim-log.mjs        Parser fuer [telnyx-shim] turn_ok/gate/farewell
    scripts/replay/measures.mjs        die sechs Zahlen
    scripts/replay/report.mjs          JSON + Tabelle
    scripts/replay/fixtures/*.json     je Anruf: Ziel/Briefing/Sprache/Flags + TSV-Pfad
    package.json                       "replay": "node scripts/replay-call.mjs"
    test/replay-harness.test.js        node:test NUR fuer die reinen Funktionen

Aufruf: `npm run replay -- --call call_msczdf1aadbw [--speed 1.0] [--out data/replay/<id>]`

---

## 6. Wie er B-1 erzeugt (der eigentliche Bauteil)

Das Rohmaterial **enthaelt die Doppel-Zustellung schon** — sie steht als zwei
aufeinanderfolgende `caller`-Zeilen mit ~2 s Abstand, wobei die zweite ein Praefix-Ausbau
der ersten ist. Gezaehlt am Material:

| Datei | Segmente | caller | agent | caller-Doppel | agent-Doppel |
| --- | --- | --- | --- | --- | --- |
| `call_msczdf1aadbw.tsv` | 38 | 19 | 19 | **2** (09/10, 21/22) | 2 (11/12, 23/24) |
| `call_msahzky8m8p9.tsv` | 24 | 12 | 12 | **1** | 1 |
| `call_msabz9975sph.tsv` | 17 | 8 | 9 | 0 | 0 |

Die Zeitstempel der `caller`-Zeilen sind brauchbar als Sendeplan, und das ist am Code
belegt: `agentTurn` schreibt die Anrufer-Zeile als ALLERERSTES, vor jeder Modellrunde
(`src/claude.js:790-791`). Der Zeitstempel einer `caller`-Zeile ist also praktisch der
Zeitpunkt, zu dem der Shim-Request ankam.

**Der Mechanismus:**

1. Sendeplan = alle `caller`-Zeilen mit Offset relativ zur ersten.
2. Jeder Eintrag wird zu seinem Offset abgeschickt — **ohne** auf die vorige Antwort zu
   warten. Die Antwort-Promises werden gesammelt, nicht seriell abgewartet.
3. Der Request selbst kommt aus dem bereits exportierten
   `shimTurnRequest({baseUrl, secret, callControlId, text, model})`
   (`driver-shim.mjs:37`) — kein Nachbau, dieselbe Draht-Form wie der Bestands-Treiber
   und wie Telnyx live.
4. Antworttext aus `completionSpeech()` (`driver-shim.mjs:59`), Abschieds-Hangup aus
   `farewellScheduled()` (`:92`), Gate-Gruende aus `shimGateReasons()` (`:102`).

Damit entsteht die Ueberlappung nicht als Simulation, sondern weil die echten Zeitabstaende
sie erzwingen: Segment 09 -> 10 sind 2,1 s, die Antwort auf 09 brauchte 2,8 s.

**Zwei Randbedingungen, gerechnet, nicht geraten:**

- Rate-Gate: `shimMaxTurnsPerMin` Default **30** (`src/config.js:424-428`, in `BASE_ENV`
  auf "30" gepinnt, `test/helpers.js:161`). Der Beleg-Anruf hat 19 Turns in 196 s ≈ 6/min.
  Bei `--speed 1.0` also weit darunter. Deshalb ist **Echtzeit der Default**; jede
  Beschleunigung ist eine bewusste CLI-Option, und `shim_gate_reasons` im Report macht ein
  `rate_limited` sichtbar statt still.
- Dead-Air-Watchdog: **45 s** (`src/config.js:438-442`, `BASE_ENV` "45"). Groesster
  Abstand zwischen zwei Anrufer-Zeilen im Beleg-Anruf: **19 s**. Der Watchdog terminiert
  bei Echtzeit-Abspielen also nicht.

---

## 7. Die Ausgabe je Lauf — und wo jede Zahl herkommt

Alle sechs geforderten Groessen sind **ohne jede Aenderung an `src/`** ablesbar. Das ist
kein Zufall: die Diagnose-Zeile `turn_ok` wurde in AL-P1/AL-D1 genau dafuer gebaut.

| Ausgabe | Quelle | Beleg |
| --- | --- | --- |
| angebotene Werkzeuge je Turn | `turn_ok.offeredToolNames` | `telnyx-llm-shim.js:164-166`, gefuellt aus `claude.js:913,1123` |
| gefeuerte Werkzeuge je Turn | `turn_ok.toolNames` | `telnyx-llm-shim.js:156`, `claude.js:1120` |
| Anzahl Turns | `turn_ok.turnSeq` (hoechster Wert) | `telnyx-llm-shim.js:526,582` |
| kam `end_call` | Zeile `[telnyx-shim] farewell_scheduled` | `telnyx-llm-shim.js:668-677`, Praedikat `driver-shim.mjs:92` |
| inhaltliche Wiederholungen | Antworttexte des Harness + `call.transcript` im Temp-Store; fuer B-6 zusaetzlich `store.actionItems` (gleicher Nachrichtentext) | `runner.mjs:158-168` liest genau diese Felder |
| ueberschriebene Antworten | der Harness besitzt Sende-/Empfangszeit jedes Requests; ueberschrieben = Antwort N kam zurueck, nachdem Request N+1 schon raus war | eigene Messung, keine Log-Ableitung |

Zusaetzlich mitgeschrieben: `latencyMs`, `speechWireOpen`, `streamChunks`,
`consultPollFresh`, `roundtrips`, `streamArmedRounds` (alle in derselben `turn_ok`-Zeile)
und die `[telnyx-shim] gate`-Gruende.

---

## 8. Die vier Abnahmen — wie jede gemessen wird

| Befund | Messung | ROT heisst |
| --- | --- | --- |
| **B-1** Doppel-Antwort | Zahl der Turn-Paare, deren Anfragen zeitlich ueberlappen, UND deren Antworten beide gesprochen werden | `>= 2` auf `call_msczdf1aadbw` (Segmente 09/10 und 21/22) |
| **B-4** `look_up` feuert nie | `count(offeredToolNames enthaelt look_up)` vs. `count(toolNames enthaelt look_up)` | angeboten 19, gefeuert **0** |
| **B-5** `end_call` feuert nie | Zeile `farewell_scheduled` fuer diesen Call | **nicht vorhanden**, Turns 19 |
| **B-6** `take_message` 8x | `count(toolNames enthaelt take_message)` + Zahl der `actionItems` mit im Kern gleichem Text | `>= 8` Aufrufe, Text-Kern identisch |

**Der eingebaute Selbsttest, und das ist der wichtigste Absatz dieses Berichts:**
B-4s Praemisse lautet "in 19 von 19 Turns ANGEBOTEN". Wenn der Pruefstand `look_up` nicht
in ~19 von 19 Turns anbietet, misst er eine **andere Konfiguration als live** — dann ist
nicht der Agent gesund, sondern die Fixture falsch (Lehre `Kalibrierungs-Reichweite`).
Die Angebots-Zahl ist damit gleichzeitig Messgroesse UND Plausibilitaetsprobe der
Fixture. Das muss der Harness laut sagen, nicht still hinnehmen.

**Was am Erwartungswert unsicher ist und offen bleiben muss:** die Befunde B-1..B-10
wurden auf `ce4df1d` erhoben, der Pruefstand laeuft gegen `master` mit AL-D3 (Kickoff
§3.b). Ein Modell ist ausserdem nicht deterministisch. Die Abnahme darf deshalb NICHT
"exakt 8 mal `take_message`" verlangen, sondern die Richtung: `look_up` 0, `end_call`
0, `take_message` >= 8, Ueberlappungen >= 2 — jeweils **ueber mehrere Wiederholungen
desselben Anrufs** (Vorschlag: 3), damit ein Ausreisser nicht als Fix durchgeht.

---

## 9. Was ich geprueft habe — und was NICHT

**Geprueft (gelesen, Datei:Zeile oben):** `scripts/convo-bench.mjs`,
`scripts/convo-bench/runner.mjs`, `driver-shim.mjs`, `driver-texml.mjs`, `drivers.mjs`,
`persona.mjs`, `metrics-parse.mjs`; `src/telnyx-llm-shim.js` (Handler, Gates,
`turnDiagnostics`, Farewell); `src/claude.js:763-830, 1090-1125`; `src/app.js:137`;
`src/config.js` (Rate-Gate, Dead-Air, Loop-Guard, Research/Lookup, ElevenLabs);
`test/helpers.js` (BASE_ENV-Auszuege); `scripts/prod-read.mjs` (Kopf); das Rohmaterial in
`data/evidence/db-2026-08-04/` (Zeilenzahlen und Zeitabstaende selbst nachgezaehlt).

**NICHT geprueft — bewusst offen gelassen:**

1. **Ich habe den Harness nicht gebaut und nichts ausgefuehrt.** Kein Server gestartet,
   kein Test gelaufen, kein Modell gerufen. Die Aussage "er reproduziert B-1" ist eine
   **falsifizierbare Konstruktions-Hypothese**, kein Messergebnis. Sie faellt oder steht
   mit dem ersten Lauf — und genau dafuer ist die Abnahme formuliert.
2. **`checks.mjs` (553 Zeilen) nur ueber die Funktionsnamen gesichtet.** Ob sich
   `checkLookupFired`/`checkMessageTaken`/`checkNoVerbatimQuestionRepeat` wortwoertlich
   wiederverwenden lassen oder ob der Pruefstand eigene, einfachere Zaehler bekommt, ist
   eine Umsetzungsfrage der Phase. Meine Neigung: **eigene Zaehler**, weil die
   Bench-Checks auf Szenario-Feldern sitzen, die eine Fixture nicht hat.
3. **Ziel/Briefing/Kontext/Mandat der drei Anrufe stehen NICHT im Rohmaterial.** Die
   TSV-Dateien tragen nur Tenant-ID und Segmente. Diese Felder praegen den Systemprompt
   massgeblich. Sie muessen aus der Prod-DB gelesen werden — `scripts/prod-read.mjs` ist
   dafuer der vorgesehene, ausschliesslich lesende Weg (`NUR SELECT`, RLS-GUC pro
   Tenant). **Aus dem Transkript rekonstruieren waere Raten** und genau die Fehlerklasse,
   die dieses Repo 297 von 297 Belegen gekostet hat.
4. **Welche Flags am 03.08. live standen, weiss ich nicht.** Dass `look_up` und
   `get_consult` angeboten wurden, steht im Kickoff (aus dem Prod-Log). Welche
   Env-Werte das erzeugt haben, ist nicht belegt. Siehe offene Frage.
5. **Inbound** habe ich nicht betrachtet (O-13) und die Budget-Engine
   (`src/routes/voice.js`) nicht gelesen.
6. **Ob `get_consult` im Replay ueberhaupt angeboten wird**, haengt an
   `consultClientIsPolling` (`telnyx-llm-shim.js:571`) und damit an der laufenden
   Consult-Pumpe. Fuer B-2/B-3 ist das entscheidend; fuer die vier Abnahme-Befunde nicht.
   Ich habe `consult-pump.mjs` nicht gelesen.

---

## 10. Loesungsskizze (die Phase in Schritten)

1. **Fixtures beschaffen.** Ein Lesevorgang gegen die Prod-DB ueber `prod-read.mjs`:
   `goal`, `briefing`, `constraints`, `context`, `mandate`, `language`, `direction` fuer
   die drei Call-IDs. Ergebnis in `scripts/replay/fixtures/<callId>.json`, mit
   Zeitstempel und Quellenangabe im Kopf.
2. **`fixture.mjs`** — TSV parsen (`seq \t rolle \t ISO \t text`, erste Zeile = Tenant),
   `caller`-Zeilen zum Sendeplan mit Offsets verdichten, Agent-Zeilen als
   Vergleichs-Referenz behalten. Reine Funktion, testbar.
3. **`schedule.mjs`** — Wanduhr-Taktung, feuert zum Offset ohne zu warten, sammelt
   `{seq, sentAt, receivedAt, text, speech}`. Reine Funktion + duenner IO-Rand.
4. **`replay-call.mjs`** — Fake-Riegel pruefen, `startExaFake`, `startTelnyxFake`,
   `seedCall`/`seedState`, `startServer`, `driver-shim`-Eroeffnung (call.answered ->
   speak -> speak.ended -> ai_assistant_start), Sendeplan abspielen, `finish`,
   Store lesen, Report schreiben.
5. **`shim-log.mjs` + `measures.mjs`** — `[telnyx-shim] <kind> {json}`-Zeilen parsen
   (Muster `metrics-parse.mjs`), die sechs Zahlen bilden.
6. **`test/replay-harness.test.js`** — node:test fuer Fixture-Parser, Ueberlappungs-Zaehler
   und Log-Parser. Kein Netz, kein Modell; laeuft in `npm test` mit.
7. **Erster Lauf, 3 Wiederholungen auf `call_msczdf1aadbw`.** Abnahme: 4 von 4 ROT.
   Reproduziert er sie nicht: nachschaerfen, NICHT weitergehen.

---

## 11. Rueckweg

Der Pruefstand aendert **keine Datei unter `src/`**. Es sind neue Dateien unter
`scripts/replay*`, ein `package.json`-Skripteintrag, eine Testdatei und drei
Fixture-JSONs. Rueckweg = `git revert` des Merge-Commits; danach ist der Betrieb
byte-identisch, weil nichts am Produktionspfad haengt. Es gibt keinen Flag-Flip, keinen
Datenzustand und keine Migration, die zurueckgedreht werden muesste.

Sollte sich waehrend der Umsetzung herausstellen, dass eine Zahl doch nicht ohne
`src/`-Aenderung ablesbar ist (ich sehe heute keine), ist das ein eigener, angekuendigter
Eingriff — kein Beiwerk dieser Phase. Der Grund: eine zusaetzliche Logzeile im Shim ist
harmlos, aber sie darf nie PII tragen (Regel 4 + die Allowlist-Disziplin in
`turnDiagnostics`).
