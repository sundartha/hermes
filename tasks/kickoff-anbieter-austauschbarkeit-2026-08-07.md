# Kickoff: Anbieter austauschbar machen (LLM zuerst) + STT-Stellschrauben aufraeumen

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

**Regel: nur Gemessenes.** Jede Aussage traegt einen Beleg (Datei:Zeile, Anbieter-Doku,
API-Antwort) oder ist ausdruecklich als **unbelegt** markiert.

---

## Die Owner-Vorgabe

> *"Einfach ein Adapter — und wenn man dann einen neuen Anbieter hat, baut man einen Adapter
> fuer diesen Anbieter. Der Code dahinter ist egal, welcher Anbieter das ist. Ich moechte
> ausprobieren koennen, ob es mit DeepSeek besser klappt, oder mit einem chinesischen
> Sprachmodell."*

**Das ist die Zielstruktur, und sie ist bindend.** Sie ist keine Vorratshaltung: das Muster
existiert in diesem Repo bereits und traegt (`src/telephony/ports.js` + `registry.js`,
Twilio<->Telnyx), und ein konkreter zweiter Anbieter ist benannt (DeepSeek).

**Prioritaet laut Owner: nicht 1.** Erst Track A (klein, gemessen), dann der Plan fuer Track B.

---

## Zwei Tracks, bewusst getrennt

| | Track | Umfang | Warum getrennt |
|---|---|---|---|
| **A** | STT-Stellschrauben aufraeumen | eine Phase | belegter Defekt, klein, sofort machbar |
| **B** | LLM-Anbieter-Port + erster Fremdadapter | Plandokument mit Phasen | beruehrt **Absolute Regel 1** (Kostendecke) und die Werkzeug-Schleife |

Track A ist **kein** Vorlauf fuer B — es ist ein eigener, unabhaengiger Defekt. Wer B zuerst
will, kann A ueberspringen; A ist nur billiger und liefert sofort Wert.

---

# Track A — STT: drei Orte, eine Entscheidung

## Der Befund

Das STT-Modell wird an **drei Orten** gewaehlt, ohne dass einer vom anderen weiss:

| Ort | Wert |
|---|---|
| `src/telephony/adapters/telnyx/voice.js` (`STT_MODEL`, Assistant-Pfad) | seit 2026-08-06 `deepgram/nova-3`, davor `deepgram/flux` |
| `src/telephony/adapters/telnyx/render.js:120` (TeXML-/Gather-Pfad) | `deepgram/nova-3`, Kommentar "Owner-Wahl 2026-06-16" |
| Telnyx-Assistant-Objekt (`GET/PATCH /v2/ai/assistants/<id>`, Feld `transcription`) | am 2026-08-06 mitgezogen |

Der Gather-Pfad lief seit Juni auf dem guten Modell, der Assistant-Pfad vier Wochen auf einem
Modell, das deutsches Telefon-Audio als **Englisch** erkennt (gemessen: 97,0 % / 95,7 %
Wortfehlerrate; nach dem Wechsel 8,9 %). **Der Widerspruch war unsichtbar.** Das ist die
Wurzel von B-7 eine Ebene unter dem falschen Modellnamen: nicht die falsche Wahl, sondern
dieselbe Entscheidung mehrfach, mit Erlaubnis auseinanderzulaufen (Clean Code **G5/G22**).

Zusaetzlich: **kein einziger STT-Wert steht in `src/config.js`** (nachgeprueft). Verstoesst
gegen CLAUDE.md (*"Env-Variablen immer in `src/config.js` zentralisieren UND in `.env.example`
dokumentieren"*) und Clean Code **G35**. Preis: ein **Deploy pro Modellwechsel**.

STT ist damit der **einzige** Ausreisser — die Inventur ueber alle Schichten:

| Schicht | Modell wechseln | Anbieter wechseln |
|---|---|---|
| LLM Gespraech / Briefing | ja, Env (`CLAUDE_MODEL` `config.js:215`, `PRECALL_BRIEFING_MODEL` `:267`) | nein — Track B |
| TTS ElevenLabs / Realtime | ja, Env (`ELEVENLABS_MODEL`/`_VOICE_ID`, `REALTIME_MODEL`/`_VOICE`) | teilweise; Azure-Stimmen fest in `render.js:22-24` |
| Telefonie | — | **ja, echt austauschbar** (`ports.js` + Registry) |
| **STT** | **nein — fest im Code, an zwei Stellen** | nein (s. Grenze unten) |

## Zuerst zu klaeren (ohne Testanruf entscheidbar)

**Ersetzt der Pro-Call-`transcription`-Block die Konfiguration des Assistant-Objekts
vollstaendig, oder wird sie zusammengefuehrt?** Verdacht auf vollstaendiges Ersetzen ist
**stark indiziert, nicht bewiesen**: nach dem Wechsel auf nova-3 kommt der erkannte Text ohne
Satzzeichen und kleingeschrieben an, obwohl `smart_format` am Assistant-Objekt `true` ist.

- **Ersetzt** -> jede am Assistant-Objekt gepflegte Einstellung ist im Betrieb wirkungslos.
  Funktionsdefekt; der Pro-Call-Block muss die gueltigen Einstellungen mitfuehren.
- **Zusammengefuehrt** -> Duplizierung, und der fehlende `smart_format` hat eine andere Ursache.

Wege: Anbieter-Doku/OpenAPI zu `transcription` bei
`POST /v2/calls/<id>/actions/start_ai_assistant`; danach das Telnyx-Gespraechsprotokoll eines
Anrufs nach dem Wechsel.

## Was Track A liefert

Eine Phase ueber `phase-impl-lean`: STT-Modell **und** die zugehoerigen Einstellungen aus
`config.js` + `.env.example`, **eine** Quelle der Wahrheit fuer beide Pfade, die Kopplung
Modell<->gueltige Einstellungen an einer Stelle abgebildet, mit Test.

**Die Kopplung, die abzubilden ist** (Anbieter-Doku
`developers.telnyx.com/docs/inference/ai-assistants/transcription-settings`):

| Einstellung | gilt fuer |
|---|---|
| `eot_threshold`, `eager_eot_threshold`, `eot_timeout_ms` | **nur** `deepgram/flux` |
| `smart_format`, `numerals` | Deepgram **ausser** flux |
| `keyterm` | `deepgram/flux` **und** `deepgram/nova-3` |
| `end_of_turn_confidence_threshold`, `min_turn_silence`, `max_turn_silence` | **nur** `assemblyai/universal-streaming` |

**Abnahme ist eine Zahl:** `node scripts/stt-wer.mjs <call_session_id>` nach einem Testanruf.
Vorher-Wert **8,9 %** (`call_mshgg6ijtyul`, 2026-08-06), Eigenrauschen ~±1,5 Punkte.
**Beide Pfade messen** — Gather-Pfad und Assistant-Pfad haben verschiedene Anbieter-Vertraege.

---

# Track B — LLM-Anbieter-Port

## Warum das LLM und nicht STT/TTS

**Weil wir das LLM selbst aufrufen.** Im Assistant-Pfad besitzt **Telnyx** den Medienweg: STT
und TTS laufen dort, wir waehlen nur Strings aus Telnyx' Liste. Ein ElevenLabs-STT-Adapter
laesst sich nicht anschliessen, solange das so ist — das setzt den **eigenen Streaming-Stack**
voraus (`src/bridge.js`, heute OpenAI-fest). Das ist eine eigene, groessere Owner-Entscheidung
(Stichwort Voice-Stack-Strategie) und **nicht** Teil dieses Kickoffs.

Beim LLM ist die Lage umgekehrt: der Aufruf gehoert uns, die Naht existiert schon, sie ist nur
anbieter-fest.

## Gemessene Ausgangslage

| Fakt | Beleg |
|---|---|
| `src/llm.js` ist der bestehende Seam (Timeout, Retry, Circuit-Breaker) — **380 Zeilen**, importiert das Anthropic-SDK direkt | `src/llm.js:19` |
| Vier Konsumenten | `claude.js`, `precall-briefing.js`, `telnyx-llm-shim.js`, `routes/voice.js` |
| **11 Stellen** in `claude.js` beruehren die Anthropic-Nachrichtenform (`tool_use`, `tool_result`, `stop_reason`, Token-Felder) | grep in `src/claude.js` (1311 Zeilen) |
| Telnyx spricht mit uns in **OpenAI-Form** (BYO-LLM ueber `external_llm` -> unser `/v1`) | `src/telnyx-llm-shim.js`; Assistant-Objekt `external_llm.base_url` |

Der letzte Punkt ist ein Aktivposten und **zu pruefen**: wir uebersetzen auf der Eingangsseite
bereits OpenAI-Form. Ob dieser Uebersetzer fuer die Ausgangsseite wiederverwendbar ist, ist
**unbelegt** und gehoert in die erste Phase.

## Die Klippe, die den Port zur Safety-Aufgabe macht

`config.modelPricesUsd` ist **pro Modell-ID** geschluesselt. Ein Modell, das dort **nicht**
steht, wird fail-closed mit der **teuersten** hinterlegten Rate gebucht (`priceForModel` in
`state-ops.js`). Genau diese Achse liest die **pro-Tenant-Kostendecke — Absolute Regel 1**
(`config.js:1394-1416`, Kommentar dort: *"Jedes neue Modell MUSS hier eingetragen werden,
BEVOR CLAUDE_MODEL darauf gestellt wird"*).

**Folge fuer den Entwurf:** ein Anbieter-Port, der nur Requests uebersetzt und die Preisquelle
nicht mittraegt, tauscht Austauschbarkeit gegen ein blindes Sicherheits-Gate. Die Preis-/
Verbrauchsmeldung gehoert **in den Port-Vertrag**, nicht daneben. Ebenso die Token-Zaehlung:
`billedTokens` nimmt heute die **angeforderte** Modell-ID, nicht die vom Anbieter
zurueckgemeldete (`src/llm-usage.js`) — ein fremder Anbieter kann hier abweichen.

## Was der Plan beantworten muss

1. **Der Port-Vertrag.** Was muss ein LLM-Adapter koennen? Mindestens: Vervollstaendigung mit
   Werkzeugen, Streaming-Deltas, Verbrauchsmeldung (Tokens **und** die ID, unter der gebucht
   wird), Fehlerklassifikation (transient vs. endgueltig — `llm.js` unterscheidet das heute
   anhand von Anthropic-Fehlertypen), Abbruch/Timeout.
2. **Die Werkzeug-Schleife.** Anthropic (`content`-Bloecke mit `tool_use`/`tool_result`) und
   OpenAI-kompatible APIs (`tool_calls`) haben verschiedene Formen. Wo liegt die Grenze —
   normalisiert der Port, oder bekommt `claude.js` eine neutrale Form? **Das ist die
   eigentliche Arbeit**, nicht der HTTP-Aufruf.
3. **DeepSeek konkret.** Ist die API OpenAI-kompatibel, und wie formt sie Werkzeug-Aufrufe und
   Streaming? **Unbelegt — mit Anbieter-Doku belegen, nicht annehmen.** Dieses Repo hat sich
   zweimal an Anbieter-Doku verbrannt, die dem Verhalten widersprach (zuletzt B-7).
4. **Kosten und Gate.** Preistabelle je Anbieter, Umrechnung, Verhalten bei unbekanntem
   Modell. Fail-closed bleibt fail-closed.
5. **Wie wird gemessen, ob der neue Anbieter "besser klappt"?** Ohne Messgroesse ist der
   Vergleich Gefuehl. Vorhanden: `npm run convo-bench` (n>=5!) und die offenen Vorher-Zahlen
   aus `tasks/gq-chain-state.md` (`get_consult` 0 von 4 bei 4/4 angeboten). Der Plan benennt
   die Zahl, an der ein Anbieterwechsel gemessen wird — **vor** dem ersten Adapter.

## Pre-Mortem Track B — ergaenzen ist Pflicht

- *"Wir haben den Port gebaut, DeepSeek angeschlossen — und die Kostendecke hat einen Monat
  lang falsch gerechnet."* -> Preisquelle im Port-Vertrag, Test, der ein unbekanntes Modell
  fail-closed nachweist.
- *"Der Port hat die Werkzeug-Schleife neutralisiert und dabei `get_consult`/`look_up`
  subtil kaputtgemacht."* -> Genau diese beiden feuern heute schon zu selten (B-4/AL-D3). Ein
  Vorher-Wert MUSS vor dem Umbau stehen, sonst ist hinterher nicht unterscheidbar, ob der Port
  oder das Modell schuld ist.
- *"Wir haben den Port fuer DeepSeek gebaut, DeepSeek war schlechter, und jetzt tragen wir
  eine Abstraktion mit einem Nutzer."* -> Akzeptiertes Risiko, **vom Owner bewusst
  eingegangen**: die Struktur ist das Ziel, nicht der eine Anbieter. Der Port bleibt trotzdem
  so schmal wie moeglich — jede Faehigkeit im Vertrag braucht einen heutigen Aufrufer.
- *"Der Umbau hat den Telnyx-Shim gebrochen und alle Anrufe fielen aus."* -> `telnyx-llm-shim.js`
  ist der Live-Sprechpfad. Abnahme mit echtem Anruf, nicht nur mit Tests.

---

## Arbeitsweise

- **Track A:** ein dynamischer Workflow mit lesenden Subagenten fuer die offene Frage
  (ersetzen vs. zusammenfuehren) und die Gegenpruefung der Inventur, danach **eine** Phase
  ueber `phase-impl-lean`. **Kein** Plandokument.
- **Track B:** zuerst ein **Plandokument** (`PLAN-LLM-PORT.md`) mit Phasen und Pre-Mortem je
  Phase — dieser Track rechtfertigt es, weil er ein Sicherheits-Gate beruehrt. Danach
  `phase-impl-lean` pro Phase. **Erst den Plan dem Owner vorlegen, bevor Code entsteht.**
- **Anbieter-Aussagen immer am Verhalten pruefen.** Doku ist eine Behauptung: bei B-7 stand
  "unterstuetzt Deutsch" in der Doku, waehrend das Modell Englisch ausgab.
- **Befunde adversarisch gegenlesen** — ein Befund gilt erst, wenn ein unabhaengiger Pruefer
  ihn zu widerlegen versucht hat und gescheitert ist.

## Betriebswissen

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen; `git push origin` macht
  **nichts** live. Live-Stand IMMER per `/healthz`, nie aus einer Notiz.
- **Tests:** `npm test` muss gruen sein (Stand 2026-08-06: 4043). `npm run test:gates` darf rot
  sein. Ein gruener Test ist erst ein Beleg, wenn er **ohne** den Fix rot ist.
- **Telnyx-Konfiguration:** erst `GET` + Snapshot nach `data/evidence/telnyx-config/`, dann
  patchen. `PATCH` merged tief, `null` heisst "nicht aendern".
- **Aufnahmen sind echte Gespraeche** (Absolute Regel 5): nie ins Repo, nie in Logs, nach
  Gebrauch loeschen.

## Nicht vorziehen

| | Punkt | Stand |
|---|---|---|
| 2 | **P2 — Modellwechsel Haiku -> Sonnet** (Owner-Entscheidung O-4, bindend), A/B mit Messung | **ein Env-Flip**: `CLAUDE_MODEL`; `claude-sonnet-5` steht bereits in der Preistabelle (`config.js:1416`) |
| 3 | **P3 — Persona und Identitaet** | offen, Vorher-Zahl steht |

P2 ist das, was den Owner im letzten Testanruf geaergert hat: der Agent bestritt erst,
Internetzugriff zu haben, raeumte die Funktion `look_up` dann ein und benutzte sie trotzdem
nicht. Drei Prompt-Runden sind daran gescheitert; O-4 sagt Modellwechsel mit Messung, **nicht**
die vierte Formulierung. Beide Punkte stehen ausformuliert in `tasks/gq-chain-state.md`.

## Pflichtlektuere

1. `CLAUDE.md` — Absolute Regeln, bindend (besonders Regel 1: Kostendecke)
2. `.claude/refs/clean-code.md` — **G5**, **G22**, **G35**, **P4** (DIP), **P15**
3. `.claude/refs/workflow.md`
4. `tasks/gq-chain-state.md` — mit `grep -n`, nicht am Stueck. Besonders "B-7"
5. `tasks/lessons.md`, die letzten fuenf Abschnitte
