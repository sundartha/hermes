# Kickoff: Modell- und Anbieter-Stellschrauben in Ordnung bringen

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Datei:Zeile, Log-Zeile,
Anbieter-Doku, API-Antwort) oder ist ausdruecklich als **unbelegt** markiert.

---

## Der Anlass

Am 2026-08-06 stellte sich heraus, dass das Spracherkennungs-Modell `deepgram/flux` deutsches
Telefon-Audio als **Englisch** erkennt (gemessen: 97,0 % / 95,7 % Wortfehlerrate auf zwei
echten Anrufen). Der Wechsel auf `deepgram/nova-3` brachte die Rate von 45,7 % auf **8,9 %** —
nachgemessen und live abgenommen. Details: `tasks/gq-chain-state.md`, Abschnitt "B-7".

Der Owner hat danach die Frage gestellt, die groesser ist als der Fehler: warum ein
Modell-/Anbieter-Wechsel ueberhaupt an mehreren Stellschrauben passieren muss, und ob das
nicht dem Clean-Code-Anspruch dieses Repos widerspricht.

**Diese Session klaert, was daran stimmt, und behebt den gemessenen Teil.**

---

## Die Inventur (bereits erhoben — nicht nochmal erheben, nur gegenpruefen)

| Schicht | Modell wechseln | Anbieter wechseln |
|---|---|---|
| LLM Gespraech | **ja, Env** — `CLAUDE_MODEL` (`config.js:215`) | nein — Anthropic-SDK direkt in `src/llm.js` |
| LLM Briefing | **ja, Env** — `PRECALL_BRIEFING_MODEL` (`config.js:267`) | nein — dito |
| TTS ElevenLabs | **ja, Env** — `ELEVENLABS_MODEL`, `ELEVENLABS_VOICE_ID` | teilweise — Azure-Rueckfall per Flag, Azure-Stimmen fest in `render.js:22-24` |
| TTS Realtime | **ja, Env** — `REALTIME_MODEL`, `REALTIME_VOICE` | nein — OpenAI-fest (`src/bridge.js`) |
| Telefonie | — | **ja, echt austauschbar** — `src/telephony/ports.js` + `registry.js`, Twilio<->Telnyx |
| **STT** | **NEIN — fest im Code, an ZWEI Stellen** | nein — keine Naht |

**Das Ergebnis widerspricht der urspruenglichen Vermutung:** LLM und TTS sind laengst
env-konfigurierbar, die Telefonie hat eine echte Anbieter-Naht. **STT ist der einzige
Ausreisser** — und dort ist es schlimmer als "ein Wert am falschen Ort".

---

## Der zentrale Befund: zwei STT-Pfade, zwei Modelle, unabhaengig gesetzt

| Ort | Wert | seit |
|---|---|---|
| `src/telephony/adapters/telnyx/voice.js` (`STT_MODEL`, Assistant-Pfad) | `deepgram/flux` -> seit 2026-08-06 `deepgram/nova-3` | Assistant-Pfad |
| `src/telephony/adapters/telnyx/render.js:120` (TeXML-/Gather-Pfad) | `deepgram/nova-3`, Kommentar "Owner-Wahl 2026-06-16" | Budget-Engine |
| Telnyx-Assistant-Objekt (`GET/PATCH /v2/ai/assistants/<id>`, Feld `transcription`) | wurde am 2026-08-06 mitgezogen | Anbieter-seitig |

**Drei Orte, an denen ein STT-Modell gewaehlt wird, ohne dass einer vom anderen weiss.** Der
Gather-Pfad stand seit Juni auf dem guten Modell, der Assistant-Pfad vier Wochen auf dem
kaputten — und niemand konnte den Widerspruch sehen. Das ist die Wurzel von B-7 eine Ebene
unter dem falschen Modellnamen: nicht "wir haben das falsche Modell gewaehlt", sondern
**"dieselbe Entscheidung existiert mehrfach und darf auseinanderlaufen"** (Clean Code G5/G22).

Verstoesst zusaetzlich gegen CLAUDE.md (*"Env-Variablen immer in `src/config.js` zentralisieren
UND in `.env.example` dokumentieren"*) und Clean Code **G35** (*Konfigurierbare Daten hoch
ansiedeln*). Der Preis ist nicht die Zeilenzahl — es sind **ein Deploy pro Modellwechsel** und
ein blinder Fleck, der vier Wochen gehalten hat.

### Die Kopplung Modell <-> gueltige Einstellungen ist ebenfalls nirgends abgebildet

Telnyx' Entwurf (Anbieter-Doku
`developers.telnyx.com/docs/inference/ai-assistants/transcription-settings`):

| Einstellung | gilt fuer |
|---|---|
| `eot_threshold`, `eager_eot_threshold`, `eot_timeout_ms` | **nur** `deepgram/flux` |
| `smart_format`, `numerals` | Deepgram **ausser** flux |
| `keyterm` | `deepgram/flux` **und** `deepgram/nova-3` |
| `end_of_turn_confidence_threshold`, `min_turn_silence`, `max_turn_silence` | **nur** `assemblyai/universal-streaming` |

Dass diese Kopplung existiert, ist nicht unser Fehler — dass unser Code sie nicht kennt,
schon. Sie beisst lautlos: nach dem Wechsel auf nova-3 kommt der erkannte Text **ohne
Satzzeichen und komplett kleingeschrieben** an, obwohl `smart_format` am Assistant-Objekt auf
`true` steht.

---

## Die Frage, die ZUERST beantwortet wird

**Ersetzt der Pro-Call-`transcription`-Block die Konfiguration des Assistant-Objekts
vollstaendig, oder wird sie zusammengefuehrt?**

Verdacht (vollstaendiges Ersetzen) ist **stark indiziert, nicht bewiesen**: Indiz ist der
kleingeschriebene Text bei `smart_format: true` am Assistant-Objekt.

Entscheidbar **ohne Testanruf** — und es entscheidet den Umfang:

- **Ersetzt vollstaendig** -> jede am Assistant-Objekt gepflegte Einstellung ist im Betrieb
  wirkungslos, sobald die Sprache aufloesbar ist. Dann ist das ein Funktionsdefekt, und der
  Pro-Call-Block muss die gueltigen Einstellungen mitfuehren.
- **Wird zusammengefuehrt** -> es ist Duplizierung, und der fehlende `smart_format` hat eine
  andere Ursache, die dann gesucht werden muss.

Wege in dieser Reihenfolge: Anbieter-Doku und OpenAPI-Spec zum Feld `transcription` bei
`POST /v2/calls/<id>/actions/start_ai_assistant`; danach das Telnyx-Gespraechsprotokoll eines
Anrufs nach dem Wechsel (`smart_format` wirkt sichtbar: Grossschreibung und Satzzeichen im
`user`-Text).

---

## Zuschnitt — und die ausdrueckliche Warnung davor, zu gross zu bauen

Der Owner hat einen mehrphasigen Plan mit Strategiedokument und einem Implementierungs-Workflow
je Phase erwogen und selbst gefragt, ob das Overkill ist.

**Die Inventur sagt: fuer den gemessenen Defekt ja.** Belegt sind drei Orte fuer EINE
Entscheidung plus eine nicht abgebildete Kopplung. Der richtige Zuschnitt dafuer ist **eine
Phase**, kein Plan mit Kette.

**Erstes Gate, bindend:**

1. Klaere die Frage oben (ersetzen vs. zusammenfuehren) und pruefe die Inventur oben gegen:
   Gibt es weitere Orte, an denen dieselbe Anbieter-Entscheidung mehrfach lebt? Sieh dabei
   auch `scripts/telnyx-assistant-provision.mjs` an (er schreibt Assistant-Konfiguration aus
   der lokalen `.env` — bekannte Falle) und `src/telephony/adapters/telnyx/render.js`.
   **Ein dynamischer Workflow mit lesenden Subagenten** ist dafuer angemessen: mehrere
   Hypothesen parallel, jede mit Belegpflicht, Befunde adversarisch gegengelesen.
2. **Dann entscheide den Zuschnitt und begruende ihn dem Owner:**
   - Bestaetigt sich die Inventur -> **eine Phase** ueber `phase-impl-lean`, kein
     Strategiedokument: STT-Modell (beide Pfade) nach `config.js` + `.env.example`, EINE
     Quelle der Wahrheit, die Modell-/Einstellungs-Kopplung an einer Stelle abgebildet, mit
     Test.
   - Findest du wesentlich mehr -> **dann** ein Plandokument mit Phasen, Pre-Mortem je Phase
     und anschliessend `phase-impl-lean` pro Phase.

### Was NICHT gebaut wird, solange es keinen zweiten Nutzer gibt

Der Owner moechte "Anbieter schnell wechseln koennen". Das ist eine legitime, aber **andere**
Frage als die oben gemessene — und sie ist teuer, wenn man sie falsch beantwortet:

- Eine STT-/TTS-/LLM-Anbieter-Naht nach dem Muster von `ports.js` **mit genau einer
  Implementierung** ist die spekulative Verallgemeinerung, die CLAUDE.md ausschliesst
  (*einfachste funktionsfaehige Loesung, kein BDUF*) und die Clean Code als P15/S4 fuehrt.
  Eine Naht ohne zweiten Anbieter ist totes Gewicht, das bei jeder Aenderung mitgetragen wird.
- Die Telefonie-Naht existiert, **weil es zwei echte Anbieter gibt** (Twilio und Telnyx). Das
  ist der Massstab: eine Naht entsteht, wenn der zweite Nutzer da ist, nicht davor.
- Der Wunsch *"mit einer Zeile von Flux auf ElevenLabs"* gehoert zur **Voice-Stack-Strategie**
  (langfristig eigener Streaming-Stack, `bridge.js` ist heute OpenAI-fest). Das ist eine
  eigene Owner-Entscheidung mit eigenem Plan — **nicht** Teil dieser Aufgabe, und sie darf
  nicht nebenbei als Refactor durchrutschen.

**Wenn der Owner Anbieter-Austauschbarkeit als Ziel setzt, ist die erste Frage nicht "wie
bauen wir die Naht", sondern "welchen zweiten Anbieter setzen wir konkret ein, und warum".**
Ohne diese Antwort ist jede Naht geraten.

---

## Pre-Mortem — vorweggenommen, ergaenzen ist Pflicht

Ein Jahr weiter, die Aenderung war falsch. Was ist passiert?

- *"Wir haben das Modell per Env konfigurierbar gemacht — jemand hat live einen Wert gesetzt,
  den der Anbieter nicht kennt, und alle Anrufe fielen auf Englisch zurueck."* -> Ein frei
  setzbarer String ist eine Waffe. Zulaessige Werte gehoeren gepinnt (Allowlist), der Boot
  bricht fail-closed ab, statt still auf einen Default zu fallen.
- *"Wir haben die zwei STT-Pfade zusammengelegt — und dabei den Gather-Pfad mitverbogen, der
  seit Juni funktionierte."* -> Der TeXML-Pfad (`render.js`) und der Assistant-Pfad
  (`voice.js`) haben **verschiedene** Anbieter-Vertraege. Eine gemeinsame Quelle fuer den
  WERT heisst nicht ein gemeinsamer Aufruf. Beide Pfade brauchen eine eigene Abnahme.
- *"Wir haben die Modell-/Einstellungs-Tabelle gepflegt — beim naechsten Anbieter-Update
  stimmte sie nicht mehr."* -> Die Kopplung steht an EINER Stelle, mit Datum und Doku-Link,
  und ihr Bruch macht einen Test rot, nicht ein Gespraech kaputt.
- *"Wir haben eine schoene Anbieter-Abstraktion gebaut, die nie einen zweiten Anbieter
  gesehen hat."* -> s. o., ausdruecklich ausgeschlossen.
- *"Der Refactor war verhaltens-erhaltend gemeint und hat die Erkennung verschlechtert."*
  -> **Die Abnahme ist eine Zahl:** `node scripts/stt-wer.mjs <call_session_id>` nach einem
  Testanruf. Vorher-Wert **8,9 %** (`call_mshgg6ijtyul`, 2026-08-06). Eigenrauschen des
  Werkzeugs ~±1,5 Punkte — ein Unterschied darunter ist kein Ergebnis. **Beide Pfade messen:**
  der Gather-Pfad braucht einen Anruf mit `VOICE_ENGINE=budget`-Verhalten, der Assistant-Pfad
  einen ueber den Assistant.

---

## Werkzeuge und Betriebswissen

- **Messung der Erkennungsguete:** `node scripts/stt-wer.mjs <call_session_id>` — holt die
  Dual-Channel-Aufnahme, isoliert den Kanal der Gegenstelle, laesst ihn unabhaengig
  abschreiben und rechnet die Wortfehlerrate gegen die Erkennung des Anbieters. Gibt zusaetzlich
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
| 2 | **P2 — Modellwechsel Haiku -> Sonnet** (Owner-Entscheidung O-4, bindend) als A/B mit Messung | entblockt; **ein Env-Flip**: `CLAUDE_MODEL`, und `claude-sonnet-5` steht bereits in der Preistabelle (`config.js:1416`) |
| 3 | **P3 — Persona und Identitaet** | offen, Vorher-Zahl steht |

**P2 ist das, was den Owner im letzten Testanruf wirklich geaergert hat:** der Agent bestritt
erst, Internetzugriff zu haben, raeumte die Funktion `look_up` dann ein und benutzte sie
trotzdem nicht. Drei Prompt-Runden sind daran gescheitert; O-4 sagt: Modellwechsel mit Messung,
**nicht** die vierte Formulierung. Beide Punkte stehen ausformuliert in `tasks/gq-chain-state.md`.

---

## Pflichtlektuere

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/clean-code.md` — insbesondere **G5** (Duplizierung), **G22** (logische statt
   angenommener Abhaengigkeiten), **G35** (konfigurierbare Daten hoch ansiedeln),
   **P15** (kein BDUF)
3. `.claude/refs/workflow.md` — Plan Mode, Subagenten, Verifikation
4. `tasks/gq-chain-state.md` — mit `grep -n` hineingreifen, nicht am Stueck lesen.
   Besonders: "B-7", "Die zwei offenen Punkte nach B-7"
5. `tasks/lessons.md`, die letzten fuenf Abschnitte
