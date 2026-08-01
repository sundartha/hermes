# AL-D2 — Warum feuert das Denk-Signal in KEINEM Turn? Ursache messen.

**Auftraggeber-Kontext:** `tasks/al-handover-2026-08-01.md`, Abschnitt 4, Punkt 1.
**Basis:** `master` @ `eefb685`. **Diese Phase fixt NICHTS am Verhalten.**
Sie liefert eine **Messung** und einen **Bericht**, sonst nichts.

---

## 0. Der Befund, der zu erklaeren ist

Zwei echte Anrufe am 2026-08-01 gegen Live-Commit `44a7d09`, alle Flags an, per-Tenant-Rechte
gesetzt und DB-verifiziert: `call_msabz9975sph` (9 Turns), `call_msahzky8m8p9` (12 Turns).

- `"thinkingSignal":false` in **allen 21 Turns**.
- Turn-Latenzen **0,9–3,0 s** — also genau die Wartezeiten, die der Owner am Telefon als
  „ein, zwei Sekunden Leere" gehoert hat.
- `toolNames` (tatsaechlich gefeuert) war in **18 von 21** Turns **leer**; in **3** Turns
  stand dort `take_message`. Nie `get_consult`, nie `look_up`.
- Das Boot-Banner meldete `Denk-Signal: AKTIV`.

**Die Frage der Phase ist NICHT „ist das Flag an".** Sie lautet: welche der Bedingungen, die
`speakBridge` passieren muss, hat in welcher Turn-Klasse gesperrt — und **kann** das Denk-Signal
in seiner heutigen Bauform die vom Owner gehoerten Pausen ueberhaupt erreichen?

---

## 1. Die Praemisse der Frage ist teilweise falsch — das ist Teil des Ergebnisses

Die Uebergabe formuliert: „die Schwelle sollte laut Plan der `agentTurn`-Median (~1,3 s) sein.
Es haette mehrfach feuern muessen."

**Im Code existiert dieser Zeit-Schwellwert nicht.** AL-P7b hat ihn als **bewusste Abweichung
E3** durch eine **strukturelle** Schwelle ersetzt (`tasks/al-p7b-workflow-report.md`, §2.2):
die Bruecke feuert genau dann, wenn der Tool-Loop nach dieser Runde weiterlaeuft. Begruendung
damals: ein Timer waere gegen `finish()` des SSE-Stroms geraced und ohne Fake-Timer nicht
deterministisch testbar.

Der Bericht dieser Phase MUSS diesen Punkt ausdruecklich am Code belegen (Datei + Zeile), statt
die Plan-Formulierung zu wiederholen. Eine Latenz von 2,4 s in einem werkzeuglosen Turn ist unter
der heutigen Bauform **kein** Fall, in dem das Signal „haette feuern muessen".

---

## 2. Die Bedingungskette (am Code zu verifizieren, nicht aus dieser Spec zu uebernehmen)

`src/claude.js` (`agentTurn`) und `src/thinking-signal.js` (`makeThinkingSignal`). Die Bruecke
geht raus, wenn ALLE folgenden Bedingungen halten. Die Nummerierung ist die Berichtssprache
dieser Phase:

| # | Bedingung | Ort |
|---|---|---|
| B1 | `config.voice.thinkingSignalEnabled === true` | `thinking-signal.js` `speakBridge` |
| B2 | `onSpeechChunk` vorhanden (= `wire !== null` im Shim) | `thinking-signal.js` `speakBridge`; `telnyx-llm-shim.js:573` |
| B3 | Die Runde lieferte mindestens EIN `tool_use`-Block (sonst `break` davor) | `claude.js`, `if (!toolUses.length) break;` |
| B4 | Kein angenommenes `get_consult` (das steigt vorher aus und spricht seinen EIGENEN Fueller) | `claude.js`, `decideConsultRequest` |
| B5 | `loopContinues === true`, d.h. NICHT (`speech` && (`endCall` \|\| `suppressedEndCall` \|\| `sideEffectOnlyRound`)) | `claude.js`, benannter Ausdruck `loopContinues` |
| B6 | `bridgeSpeechFrom(speech)` liefert nicht-leer — also **fuehrender Text im selben Antwort-Block wie der Werkzeugaufruf** | `thinking-signal.js` |
| B7 | Einmal-pro-Turn-Riegel noch nicht gezogen | `thinking-signal.js`, `spoken` |

**B2 ist die einzige Bedingung, die offline fuer die zwei Live-Anrufe NICHT entscheidbar ist**
(sie haengt daran, ob Telnyx `stream:true` schickt und ob `TELNYX_SHIM_TOKEN_STREAMING` an war).
Sie steht heute in **keiner** Logzeile: `streamChunks: wire ? wire.chunkCount() : 0` liefert in
beiden Faellen `0`. Siehe §5.

---

## 3. Was gebaut wird

### 3.1 Reproduktion offline gegen den Shim-Harness (Kern der Phase)

Neue Testdatei `test/al-d2-thinking-signal-diagnostics.test.js`, IDs `AL-D2-1` … `AL-D2-n`.
Getrieben wird der **Shim** (`POST` auf die Shim-Route mit `stream:true`, wie Telnyx live),
gegen einen Anthropic-Mock mit echtem SSE — dasselbe Muster wie
`test/al-d1-shim-diagnostics.test.js` und `test/al-d1-cause-diagnostics.test.js`. Die
Konfiguration ist die **Live-Konfiguration**: `thinkingSignalEnabled` an, Token-Streaming an,
Werkzeugsatz mit `look_up` **und** `get_consult` (das ist der live gemessene `offeredToolNames`).

Zu fahrende Turn-Klassen — jede ist eine Klasse aus dem Live-Korpus oder eine Zukunftsfrage:

| ID-Klasse | Szenario | Live-Anteil | Erwartung | Was sie beweist |
|---|---|---|---|---|
| **K1** | Modell antwortet mit **Text ohne Werkzeug** | **18 / 21** | `thinkingSignal:false`, `roundtrips:1` | B3 sperrt. Der haeufigste Live-Fall. |
| **K2** | `take_message` **plus** Text | **3 / 21** | `thinkingSignal:false` | B5 sperrt (`sideEffectOnlyRound`). |
| **K3** | `look_up` **mit** fuehrendem Text — **Positivkontrolle** | 0 / 21 | `thinkingSignal:true`, **Brueckenchunk liegt auf dem SSE-Draht VOR dem Antwort-Chunk** | Ohne sie waeren K1/K2/K4/K5 auch bei komplett totem Signal gruen. Pflicht. |
| **K4** | `look_up` **ohne** fuehrenden Text (nur `tool_use`) | 0 / 21 | `thinkingSignal:false` | B6 sperrt. **Der Befund mit Zukunft:** dieser Fall ueberlebt einen D-3-Fix und laesst den Anrufer waehrend der Suche stumm warten. |
| **K5** | Wie K3, aber **ohne Wire** (`stream:false` bzw. Streaming-Flag aus) | unbekannt | `thinkingSignal:false` | B2 sperrt. Pinnt genau die Bedingung, die live nicht belegt ist. |
| **K6** | Angenommenes `get_consult` | 0 / 21 | `thinkingSignal:false`, aber Fueller-Text vorhanden | B4 sperrt — und zwar **korrekt**, das ist kein Defekt. Trennt „stumm" von „anderer Sprecher". |

**Mutationsprobe ist Pflicht** (Muster AL-D1 §4): mindestens eine Mutation, die zeigt, dass die
Tests wirklich an der behaupteten Bedingung haengen — z.B. `loopContinues` unbedingt auf `true`
setzen ⇒ K2 muss rot werden, K1 darf es **nicht** (dort sperrt B3, nicht B5). Ergebnis der
Mutationsproben gehoert in den Bericht.

### 3.2 Die eine Instrumentierung, die offline nicht ersetzbar ist (B2)

`turn_ok` bekommt **ein zusaetzliches Boolean**: ob dieser Turn ueberhaupt einen offenen
Sprechkanal hatte (`wire !== null`). Ohne dieses Feld ist B2 fuer jeden kuenftigen Testanruf
**strukturell unbeantwortbar** — und B2 ist die Bedingung, an der sowohl das Denk-Signal als auch
das Token-Streaming (D-1) haengen. Eine Faehigkeit, deren Voraussetzung man nicht messen kann,
kann man auch nicht abnehmen.

Auflagen, hart:
- **Rein additiv**, fail-safe wie die Nachbarfelder, **PII-frei** (ein Boolean, kein Text).
- **Keine** neue Env-Variable, **keine** neue Konstante mit Zahl, **keine** Migration, **keine**
  Dependency.
- Negativ gepinnt: ein Test weist nach, dass die Zeile keinen Gespraechsinhalt traegt.
- Wird im selben `turn_ok`-Aufruf gefuehrt wie `streamChunks` — **eine** Schreibstelle.

### 3.3 Diagnose-Bericht `tasks/al-d2-diagnose.md`

Dieser Bericht ist ein **Liefergegenstand der Phase** und wird mit committed. Er ist NICHT der
Workflow-Prozessbericht (`tasks/al-d2-report.md`) — die beiden Dateien duerfen sich nicht
ueberschreiben.

Muss enthalten, jeweils mit Datei- und Zeilenbeleg:

1. **Die Antwort auf die Titelfrage**, pro Turn-Klasse: welche Bedingung sperrte, mit der
   Zuordnung zum Live-Korpus (18 / 3 / 0). Ergebnis in EINER Tabelle.
2. **Die Reichweite-Aussage — der eigentliche Wert der Phase.** Beantworte ausdruecklich:
   *Kann das Denk-Signal in seiner heutigen Bauform (Weg A, Schwelle E3) die vom Owner gehoerten
   Pausen ueberhaupt erreichen?* Herleitung am Code, nicht am Plan: auf Weg A **ist** der
   Brueckensatz der fuehrende Text einer Runde, die auch schon den Werkzeugaufruf traegt. In
   einem werkzeuglosen Turn (18/21) traegt dieselbe Runde bereits die fertige Antwort — es gibt
   dort nichts zu ueberbruecken. Wenn diese Herleitung am Code standhaelt, lautet die Aussage:
   das Denk-Signal deckt **ausschliesslich Werkzeug-Wartezeit**, und die Pausen des Owners lagen
   ueberwiegend woanders. Haelt sie **nicht** stand, ist der Gegenbeleg zu zeigen.
3. **Die Konsequenz fuer die Reihenfolge in Abschnitt 4 der Uebergabe.** Wenn (2) bestaetigt,
   dass D-2 die Owner-Pausen strukturell nicht erreicht, dann ist die dortige Begruendung
   („D-2 zuerst, weil es die Pausen direkt adressiert") widerlegt und die Reihenfolge gehoert
   korrigiert. **Nicht diplomatisch abschwaechen — benennen.** Diese Phase entscheidet die
   Reihenfolge nicht, sie legt dem Owner den Befund vor.
4. **Der K4-Befund** (Suche ohne fuehrenden Text) als eigenstaendiger, heute schon lebender
   Defekt mit Vorschlag — aber **ohne** Fix in dieser Phase.
5. **Was offen bleibt und warum**: B2 fuer die zwei Live-Anrufe rueckwirkend nicht entscheidbar;
   entschieden wird sie beim naechsten Testanruf mit dem Feld aus §3.2.

---

## 4. Nicht-Ziele (harte Grenze)

- **Kein Verhaltens-Fix.** Weder die Armierungsregel in `streamSinkFor`, noch `loopContinues`,
  noch die Schwelle E3, noch der Prompt werden angefasst. Wer hier fixt, hat die Phase verfehlt.
- **Kein echter Anruf.** Reproduktion ausschliesslich offline gegen den Shim-Harness
  (Owner-Weisung).
- **Kein Prompt-Eingriff am Tool-Entscheidungspunkt** — das ist D-3, die naechste Phase.
- **Kein Anfassen** von `MAX_IN_CALL_CONSULTS_PER_CALL`, `CONSULT_POLL_FRESH_MS`, Safety-Gates,
  Offenlegung, Auth, Geldpfad.

---

## 5. Pre-Mortem

| Szenario ein Jahr spaeter | Riegel in dieser Phase |
|---|---|
| Die Tests sind gruen, weil das Signal **komplett** tot ist — nicht weil die Analyse stimmt | **K3 Positivkontrolle ist Pflicht** (Lehre AL-D1-4) |
| Der Bericht behauptet eine Ursache, die Tests haengen an einer anderen | Mutationsproben, Ergebnis im Bericht |
| Wir bauen spaeter einen Fix und koennen live wieder nicht abnehmen, weil B2 unsichtbar bleibt | §3.2, ein Boolean |
| Die Phase „fixt schnell mit" und veraendert unbemerkt Live-Verhalten | Nicht-Ziele; Diff darf keine Verhaltenszeile in `claude.js`/`thinking-signal.js` enthalten |
| Ein Log-Feld leakt Gespraechsinhalt | Boolean, negativ gepinnter Test |
| Der Bericht ist hoeflich statt klar, und die Uebergabe bleibt falsch sortiert | §3.3 Punkt 3 verlangt die ausdrueckliche Benennung |

---

## 6. Abnahme (deterministisch)

1. `npm test` gruen, inkl. der neuen `AL-D2-*`-Tests; **kein** Bestandstest geaendert.
   Roter Lauf wird mitgeschnitten (`npm test > log; grep "^not ok" log`).
2. K3 ist gruen **und** weist die Reihenfolge auf dem Draht nach (Bruecke vor Antwort) — nicht
   nur `thinkingSignalSpoken === true`.
3. Mindestens eine Mutationsprobe dokumentiert, mit dem erwarteten selektiven Rot.
4. `node --check` gruen fuer jede geaenderte Datei.
5. `tasks/al-d2-diagnose.md` existiert, ist committed und beantwortet §3.3 Punkte 1–5, jeweils
   mit Codebeleg.
6. `git diff master --stat` zeigt **keine** Aenderung an Gates, Offenlegung, Auth, Geldpfad und
   keine Verhaltensaenderung in `src/claude.js` / `src/thinking-signal.js`.
