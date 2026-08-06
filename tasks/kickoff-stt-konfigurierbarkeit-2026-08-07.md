# Kickoff: Anbieter-Stellschrauben konfigurierbar machen (STT zuerst)

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Datei:Zeile, Log-Zeile,
Anbieter-Doku, API-Antwort) oder ist ausdruecklich als **unbelegt** markiert.

---

## Der Anlass

Am 2026-08-06 stellte sich heraus, dass das Spracherkennungs-Modell `deepgram/flux` deutsches
Telefon-Audio als **Englisch** erkennt (gemessen: 97,0 % / 95,7 % Wortfehlerrate auf zwei
echten Anrufen). Der Wechsel auf `deepgram/nova-3` brachte die Rate auf **8,9 %** —
nachgemessen und live abgenommen. Details: `tasks/gq-chain-state.md`, Abschnitt "B-7".

Der Owner hat danach eine Frage gestellt, die groesser ist als der Fehler:

> *"Damit ich etwas so Einfaches machen kann wie einen Anbieter-Wechsel, muss ich an
> verschiedenen Stellschrauben drehen. Das ist doch das Gegenteil von Clean Code."*

**Diese Session klaert, ob das stimmt, und behebt, was daran stimmt.**

---

## Was bereits geprueft ist — nicht nochmal erheben

| Behauptung | Befund |
|---|---|
| "Der Wechsel war ein grosser Eingriff" | **Nein.** Der Code-Diff war EINE Konstante: `git show b073e8d -- src/` = 18 Zeilen, davon 15 Kommentar |
| "Es gibt keine Anbieter-Abstraktion" | **Nein.** `src/telephony/ports.js` + `registry.js` + `adapters/{twilio,telnyx}/*`; Twilio<->Telnyx ist echt austauschbar |
| "Das STT-Modell ist konfigurierbar" | **Nein.** `grep -niE "stt\|transcri\|deepgram\|nova" src/config.js` findet **keinen** Wert. Das Modell steht fest verdrahtet als `STT_MODEL` in `src/telephony/adapters/telnyx/voice.js` |
| "Die Stellschrauben sind ueberall verstreut" | **Nein, es ist im Wesentlichen EINE.** Ein Scan nach fest verdrahteten Anbieter-Werten findet ausser `STT_MODEL` nur `ELEVENLABS_COST_RECORD_PROVIDER` und `ELEVENLABS_VOICE_SETTINGS_TYPE` — beides Protokoll-Diskriminatoren der Anbieter-API (Feldwerte, keine Tuning-Knoepfe), im Code begruendet |

**Der eigentliche Preis ist nicht die Zeilenzahl, sondern:** ein Modellwechsel braucht einen
**Deploy** statt eines Env-Flips. Bei einem Anbieter-Defekt ist das der Unterschied zwischen
Minuten und einer Deploy-Runde.

---

## Die drei belegten Maengel

### M1 — Konfigurierbare Daten stecken tief im Low-Level-Code

`STT_MODEL` in `src/telephony/adapters/telnyx/voice.js` (Naehe Zeile 241). Verstoesst gegen
CLAUDE.md (*"Env-Variablen immer in `src/config.js` zentralisieren UND in `.env.example`
dokumentieren"*) und gegen Clean Code **G35** (*Konfigurierbare Daten hoch ansiedeln*).

### M2 — Zwei Quellen der Wahrheit fuer dasselbe Modell

Das Modell steht **doppelt**:

1. im Pro-Call-Block, den `startAssistant` mitsendet (`transcriptionFields`, s. `voice.js`),
2. am Telnyx-Assistant-Objekt (`GET/PATCH /v2/ai/assistants/<id>`, Feld `transcription`).

Beim Wechsel mussten **beide** geaendert werden; nichts im Code sagt das. Wer nur eines
aendert, bekommt ein stilles Auseinanderlaufen — der Pro-Call-Block gewinnt, das
Assistant-Objekt sieht danach richtig aus und ist wirkungslos.

### M3 — Die Kopplung Modell <-> gueltige Einstellungen ist nirgends abgebildet

Telnyx' Entwurf (belegt in der Anbieter-Doku, `developers.telnyx.com/docs/inference/ai-assistants/transcription-settings`):

| Einstellung | gilt fuer |
|---|---|
| `eot_threshold`, `eager_eot_threshold`, `eot_timeout_ms` | **nur** `deepgram/flux` |
| `smart_format`, `numerals` | Deepgram **ausser** flux |
| `keyterm` | `deepgram/flux` **und** `deepgram/nova-3` |
| `end_of_turn_confidence_threshold`, `min_turn_silence`, `max_turn_silence` | **nur** `assemblyai/universal-streaming` |

Dass diese Kopplung existiert, ist **nicht unser Fehler** — dass unser Code sie nirgends
kennt, schon. Sie beisst lautlos: nach dem Wechsel auf nova-3 kam der erkannte Text
**ohne Satzzeichen und komplett kleingeschrieben** an, obwohl `smart_format` am
Assistant-Objekt auf `true` steht.

---

## Die Frage, die ZUERST beantwortet wird (und den ganzen Zuschnitt entscheidet)

**Ersetzt der Pro-Call-`transcription`-Block die Konfiguration des Assistant-Objekts
vollstaendig, oder wird sie zusammengefuehrt?**

Der Verdacht (vollstaendiges Ersetzen) ist **stark indiziert, aber nicht bewiesen**: Indiz
ist der kleingeschriebene Text bei `smart_format: true` am Assistant-Objekt.

Das ist entscheidbar **ohne Testanruf**, und es entscheidet den Umfang:

- **Ersetzt vollstaendig** -> jede am Assistant-Objekt gepflegte Einstellung ist im Betrieb
  wirkungslos, sobald die Sprache aufloesbar ist. Dann ist M2/M3 ein echter Funktionsdefekt
  und der Pro-Call-Block muss die gueltigen Einstellungen mitfuehren.
- **Wird zusammengefuehrt** -> M2 ist "nur" Duplizierung, und der fehlende `smart_format` hat
  eine andere Ursache, die dann gesucht werden muss.

Wege, das zu klaeren, in dieser Reihenfolge: Anbieter-Doku und OpenAPI-Spec zum Feld
`transcription` bei `POST /v2/calls/<id>/actions/start_ai_assistant`; danach die
Render-Logs/das Telnyx-Gespraechsprotokoll eines Anrufs nach dem Wechsel (`smart_format`
wirkt sichtbar: Grossschreibung und Satzzeichen im `user`-Text).

---

## Zuschnitt — und die ausdrueckliche Warnung davor, zu gross zu bauen

Der Owner hat einen mehrphasigen Plan mit Strategiedokument und einem Implementierungs-Workflow
je Phase erwogen und selbst gefragt, ob das Overkill ist. **Die Bestandsaufnahme sagt: ja, das
waere es — solange die Groessenfrage oben nicht etwas Groesseres zutage foerdert.**

Belegt ist ein Wert am falschen Ort plus eine doppelte Quelle. Dafuer ist der richtige
Zuschnitt **eine Phase**, kein Plan mit Kette.

**Deshalb das erste Gate, bindend:**

1. Klaere die Frage oben (ersetzen vs. zusammenfuehren) und mach eine kurze, lesende
   Bestandsaufnahme: welche Anbieter-Werte sind fest verdrahtet, wer schreibt sie, wo
   laufen sie auseinander? Ein **dynamischer Workflow mit lesenden Subagenten** ist dafuer
   angemessen — mehrere Hypothesen parallel, jede mit Belegpflicht.
2. **Dann entscheide den Zuschnitt und begruende ihn:**
   - Findest du **einen** Defekt der beschriebenen Groesse -> **eine Phase** ueber
     `phase-impl-lean`, **kein** Strategiedokument. Schreib das dem Owner so und leg los.
   - Findest du **mehr** (weitere stille Ueberschreibungen, weitere Werte ohne Config-Anbindung,
     ein Auseinanderlaufen mit dem Provisioner `scripts/telnyx-assistant-provision.mjs`)
     -> **dann** ein Plandokument mit Phasen, Pre-Mortem je Phase und anschliessend
     `phase-impl-lean` pro Phase.

**Nicht bauen, solange es keinen zweiten Nutzer gibt:** eine STT-Anbieter-Abstraktion nach dem
Muster von `ports.js`. Heute gibt es genau einen STT-Weg (Telnyx). Eine Naht fuer einen
einzigen Anbieter ist die spekulative Verallgemeinerung, die CLAUDE.md ausdruecklich
ausschliesst (*einfachste funktionsfaehige Loesung, kein BDUF*) und die Clean Code als P15/S4
fuehrt. Der Wunsch *"mit einer Zeile von Flux auf ElevenLabs"* gehoert zur **Voice-Stack-
Strategie** (eigener Streaming-Stack) und ist eine eigene, groessere Owner-Entscheidung —
**nicht** Teil dieser Aufgabe.

Was dagegen **sehr wohl** hierher gehoert, wenn die Messung es traegt: das Modell und die
zugehoerigen Einstellungen so zu fuehren, dass ein Wechsel **ohne Deploy** moeglich ist und
**eine** Stelle die Wahrheit haelt.

---

## Pre-Mortem — vorweggenommen, ergaenzen ist Pflicht

Ein Jahr weiter, die Aenderung war falsch. Was ist passiert?

- *"Wir haben das Modell per Env-Variable konfigurierbar gemacht — und jemand hat live einen
  Wert gesetzt, den Telnyx nicht kennt. Alle Anrufe fielen auf Englisch zurueck."*
  -> Ein frei setzbarer String ist eine Waffe. Zulaessige Werte gehoeren gepinnt (Allowlist)
  und der Boot muss fail-closed abbrechen, nicht still auf einen Default fallen.
- *"Wir haben die Einstellungen an das Modell gekoppelt — und beim naechsten Anbieter-Update
  stimmte die Tabelle nicht mehr."* -> Die Kopplung muss an EINER Stelle stehen, mit Datum
  und Doku-Link, und ihr Bruch muss einen Test rot machen, nicht ein Gespraech kaputt.
- *"Wir haben eine schoene Abstraktion gebaut, die nie einen zweiten Anbieter gesehen hat."*
  -> s. o., ausdruecklich ausgeschlossen.
- *"Der Refactor war verhaltens-erhaltend gemeint und hat die Erkennung wieder verschlechtert."*
  -> **Die Abnahme ist eine Zahl, kein Gefuehl:** `node scripts/stt-wer.mjs <call_session_id>`
  nach einem Testanruf. Vorher-Wert 8,9 % (Anruf `call_mshgg6ijtyul`, 2026-08-06). Das
  Werkzeug hat ~±1,5 Punkte Eigenrauschen — ein Unterschied darunter ist kein Ergebnis.

---

## Werkzeuge und Betriebswissen

- **Messung der Erkennungsguete:** `node scripts/stt-wer.mjs <call_session_id>` — holt die
  Dual-Channel-Aufnahme, isoliert den Kanal der Gegenstelle, laesst ihn unabhaengig
  abschreiben und rechnet die Wortfehlerrate gegen Telnyx' eigene Erkennung. Gibt zusaetzlich
  eine **Kontrollzahl** auf dem Agentenkanal aus (dort kennen wir die Wahrheit) — ohne die ist
  die Hauptzahl nicht interpretierbar.
- **Aufnahmen sind echte Gespraeche** (Absolute Regel 5): nie ins Repo, nie in Logs, nach
  Gebrauch loeschen. Das Skript raeumt sein Temp-Verzeichnis selbst auf.
- **Telnyx-Konfiguration:** erst `GET` + Snapshot nach `data/evidence/telnyx-config/`, dann
  patchen. `PATCH` merged **tief**, `null` heisst "nicht aendern". Ein Default sieht aus wie
  eine Entscheidung — `deepgram/flux` war vier Wochen lang genau das.
- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen; `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz`, nie aus einer Notiz.
- **Tests:** `npm test` muss gruen sein (Stand 2026-08-06: 4043). `npm run test:gates` darf rot
  sein (offene Produktbefunde). Ein gruener Test ist erst ein Beleg, wenn er **ohne** den Fix
  rot ist — Fix probeweise ausbauen, Rot sehen, zurueckbauen.

---

## Nicht vorziehen

Nach dieser Aufgabe warten zwei Punkte, in dieser Reihenfolge:

| | Punkt | Stand |
|---|---|---|
| 2 | **P2 — Modellwechsel Haiku -> Sonnet** (Owner-Entscheidung O-4, bindend) als A/B mit Messung | entblockt, Vorher-Zahl steht |
| 3 | **P3 — Persona und Identitaet** | offen, Vorher-Zahl steht |

**P2 ist das, was den Owner im letzten Testanruf wirklich geaergert hat:** der Agent bestritt
erst, Internetzugriff zu haben, raeumte die Funktion `look_up` dann ein und benutzte sie
trotzdem nicht. Drei Prompt-Runden sind daran gescheitert; O-4 sagt: Modellwechsel mit Messung,
**nicht** die vierte Formulierung. Beide Punkte stehen ausformuliert in `tasks/gq-chain-state.md`.

---

## Pflichtlektuere

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/clean-code.md` — insbesondere **G35** (konfigurierbare Daten hoch ansiedeln),
   **G5** (Duplizierung), **G22** (logische statt angenommener Abhaengigkeiten),
   **P15** (kein BDUF)
3. `.claude/refs/workflow.md` — Plan Mode, Subagenten, Verifikation
4. `tasks/gq-chain-state.md` — mit `grep -n` hineingreifen, nicht am Stueck lesen.
   Besonders: "B-7", "Die zwei offenen Punkte nach B-7"
5. `tasks/lessons.md`, die letzten fuenf Abschnitte
