# STATUS Anrufqualitaet — Stand 2026-07-12 (nach Deploy d83be2d + 2 Owner-Testanrufen)

Vollstaendiger Wissensstand zum Telefonie-Pfad. Quelle der Messwerte:
`tasks/afix-testcall-report.md` (Call 1) und `tasks/afix-testcall2-report.md` (Call 2,
mit Idle- und Overlap-Probe). Detail-Reports der Impl-Phasen: `tasks/afix-p{1,2,3,4}-report.md`.

## Welcher Stack laeuft im Anruf

Outbound-Kette (Telnyx-AI-Assistant-Pfad, `TELNYX_AI_ASSISTANT_ENABLED=true`):

1. `POST /api/calls` -> Call-Control-Origination (`src/telnyx-origination.js`), Gates unveraendert.
2. `call.answered` -> deterministischer Call-Control-`speak` mit der Offenlegung
   (`src/telnyx-call-control-ingest.js::onAnswered`). Seit d83be2d in der
   **ElevenLabs-Assistant-Stimme** (vorher Azure -> Stimmbruch).
3. `call.speak.ended` -> `ai_assistant_start` (Zustellgarantie fuer die Offenlegung; bei
   `speak.failed` genau EIN Azure-Retry, danach fail-safe KEIN Assistant-Start).
4. Telnyx uebernimmt das Gespraech: STT `deepgram/flux` (seit d83be2d **per-Call
   `transcription.language`**, vorher `multi` = Auto-Detect), Turn-Taking/EOT bei Telnyx,
   TTS ElevenLabs `eleven_flash_v2_5`.
5. Jeder Turn geht als OpenAI-kompatible Completion an unseren Shim
   (`src/telnyx-llm-shim.js` -> `agentTurn` -> `src/claude.js`, Claude Haiku 4.5).
6. `end_call` -> seit d83be2d **verzoegerter Hangup** ueber den Watchdog
   (`scheduleFarewellHangup`), damit der Abschied noch gespielt wird.

Assistant-Objekt (Live, per GET verifiziert): `user_idle_reply_secs: 4` (war 10),
`transcription: deepgram/flux + language "multi"` (per-Call-Override gewinnt),
`eot_threshold: 0.8`, `eot_timeout_ms: 5000`, `eager_eot_threshold: 0.8`
(= Eager-EOT laut Spec effektiv AUS), `interruption_settings.enable: true`,
`time_limit_secs: 1800`, Recording dual/mp3.

## Was heute live gefixt wurde (Commit d83be2d, boot-verifiziert)

| Wurzel (RCA) | Fix | Live-Beleg |
|---|---|---|
| R5 Stimmbruch | Opening in ElevenLabs-Stimme | `opening_voice=elevenlabs` in beiden Calls; eine Stimme durchgehend |
| R5 Totzeit 12.4s | Idle-Nudge 10s -> 4s | **6.60s** bis zur ersten Assistant-Aeusserung (Call 2, Owner schwieg 10s) |
| R2 STT-Kauderwelsch | per-Call `language`-Hint | Call 1: beide Aeusserungen sauberes Deutsch (Whisper-gegengeprueft) |
| R4 verschluckter Abschied | Farewell-Hangup im Watchdog | Abschied vollstaendig hoerbar VOR Hangup (beide Calls) |
| R3 voreiliges Auflegen | Prompt-Regel am Tool-Entscheidungspunkt | kein Fehl-Hangup in beiden Calls (n=2, schwacher Beleg) |

Latenz (TTFA = Ende Nutzer-Aeusserung -> erster Agent-Ton): **Median 2.13s** (akustisch),
1.98s (Telnyx-Metrik). Ziel <= 2.5s erreicht -> die im Plan bedingte Phase P5 (eot_timeout)
bleibt vorerst vertagt.

## Die verbleibenden Schwachstellen (belegt, nicht vermutet)

### S1 — Das Verwerf-Fenster (R1): normaler Barge-in-Preis, aber zu gross

In Call 2 wurde **1 von 4 generierten Antworten komplett verworfen**: `turn_ok #2`
(17:37:24.704, LLM 1843ms) erzeugte Text, der NIE gespielt und von Telnyx nie als Message
registriert wurde. Ausgeloest hat das keine bewusste Unterbrechung, sondern eine **normale
Sprechpause** des Owners: Telnyx erkannte ein Turn-Ende, startete die Generierung, der Owner
sprach weiter -> die laufende Antwort wurde obsolet.

EINORDNUNG (wichtig, nicht dramatisieren): Das Verwerfen IST der Preis von Barge-in — jedes
Barge-in-faehige System muss eine noch nicht gespielte Antwort fallen lassen, wenn der Nutzer
weiterspricht, sonst redet die KI drueber. Telnyx hat sich korrekt erholt: 1.37s spaeter lief
ein neuer Turn, die Antwort war nach 1.99s / 2.27s hoerbar -> R1-Gate PASS. Der Telnyx-Pfad
ist damit NICHT in Frage gestellt (Barge-in war der Grund fuer den Wechsel und funktioniert).

Der Hebel ist das LATENZFENSTER, nicht der Mechanismus: Solange ~2s zwischen Satzende und
erstem Ton liegen (LLM non-streaming), ist das Fenster gross, in dem verworfen werden kann.
Kleineres Fenster = seltener verworfen = weniger verpuffte LLM-/TTS-Kosten und weniger
Stille-Eindruck. Genau das ist Phase P-A der Optimierungs-Session.

Kosten-Nebenwirkung: jede verworfene Antwort ist bezahlte LLM- + TTS-Arbeit (25% Verschnitt
in diesem Call).

### S2 — R2 (STT) ist besser, aber nicht sauber

Call 2, Owner-Aeusserung 2: flux lieferte das Fragment `"vêtementgut"` statt sauberem
Deutsch — mit realer Gespraechsfolge (die KI musste nachfragen). Der Sprach-Hint hat das
Kauderwelsch stark reduziert (Call 1: 2/2 sauber), aber nicht eliminiert. Der
Cross-Modell-Test aus dem RCA bleibt gueltig: Whisper transkribiert dasselbe Audio Hint-los
korrekt -> flux ist die schwaechste Stelle der Kette.

### S3 — Der Farewell-Cap wird faktisch immer ausgeschoepft

Beide Calls: `farewell_scheduled delayMs=12000` (= das Maximum), Hangup exakt am Cap.
Die Heuristik `clamp(1500 + Zeichen*70, 3000, 12000)` ueberschaetzt die Sprechdauer
(ElevenLabs spricht schneller als die angenommenen ~14 Zeichen/s). Call 1 endete deshalb mit
**4.5s Stille** vor dem Hangup (E3.2 FAIL); Call 2 nur mit 0.71s — aber das war Glueck der
Satzlaenge, nicht Regelung. Es gibt kein Telnyx-Event, das das Ende der Assistant-TTS
signalisiert (deshalb die Heuristik) — hier braucht es eine bessere Loesung als eine Konstante.

Call 1 hatte zusaetzlich eine **3.9s-Stille MITTEN im Abschiedssatz** (in Call 2 nicht
reproduziert) — Ursache ungeklaert, Verdacht: TTS-Chunking/Nachsynthese.

### S4 — Totzeit im Gespraech

Call 2: **36.6% der Aufnahme komplett still** (24.3% ohne die bewusste Anfangsstille).
Nach jeder Nutzer-Aeusserung entstehen ~2s Funkstille, bevor die KI antwortet — technisch
"gute" Latenz, menschlich eine unangenehme Pause. Es gibt heute KEIN Fuellwort/Backchanneling.

### S5 — E4.1 (Bench) unbelegt

`npm run convo-bench` konnte nicht laufen: der `ANTHROPIC_API_KEY` in der lokalen `.env`
liefert 401 (der neue Key ist bisher nur auf Render gesetzt). Die P4-Prompt-Regel ist damit
nur durch einen Revert-Pin-Test abgesichert, nicht durch einen Verhaltensbeweis.

## Betriebs-/Kostenkontext

- Anthropic-Key wurde am 2026-07-12 zwischen 08:25 und 14:24 UTC ungueltig (401
  `invalid x-api-key`); Ursache unbekannt (Rotation/Widerruf). Symptom war: jeder Turn wirft,
  die KI sagt bei jedem Turn "Entschuldigung, da ist ein technisches Problem aufgetreten".
  Owner hat einen neuen Key auf Render gesetzt (Neustart 15:01/15:03 UTC) -> LLM-Turns wieder
  `outcome: success`. **Lokale `.env` traegt weiterhin den alten (toten) Key.**
- Render `vodafone-agent`: `autoDeploy: no` -> Deploys sind manuell; ein Env-Update loest
  automatisch einen Deploy aus.
- Kosten pro Anruf (Telnyx `call.analyzed`): TTS-Posten belegen Synthese auch fuer verworfene
  Antworten -> S1 kostet doppelt (LLM + TTS ohne Gegenwert).
- `hermes-db` (Postgres, FREE) laeuft am **2026-07-24** ab — harte Deadline, unabhaengig
  von diesem Thema.

## Was als naechstes ansteht

Siehe `tasks/NEXT-SESSION-CONVERSATION-OPTIMIZATION-PROMPT.md` — Ziel der naechsten Session
ist ein Strategiedokument (Phasen + Umsetzungsweg) fuer Gespraechsqualitaet: R1-Verwerfen,
Latenz/Fuellwoerter, STT-Restfehler, Farewell-Timing.
