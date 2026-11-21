# Begrüßung/Stimme, Anruf call_mwnuityl849m (Staging, 19.11. 18:50) – Zwischenstand A-H956NC

Stand: BLOCKIERT bei (a) Transkript und Agent-Abfrage. Kein ElevenLabs-Schlüssel in meiner Umgebung
(env ohne ELEVEN*/RENDER*, Konten-Dateien enthalten nur Claude-Token, OpenClaw-eigener TTS-Schlüssel liegt im
Secret-Store und wird von mir nicht gelesen). hermes-staging get_call_result liefert laut Beschreibung nie das Transkript.
Es gibt keine Prüfnummer, die ich kenne; kein Testanruf, kein PR bisher.

## Was belegt ist (Quelle: Code hermes/master 75f5998a4, Snapshot der EL-Agenten vom 08.11.)
1. "Ich kann dich nicht hören" ist in unserem Repo an zwei Stellen als Text vorhanden:
   - src/i18n/locales.js (noSpeechRepromptAgain / noSpeechFarewell, de/fr/en) – Server-Texte des alten Eigenwegs (nicht der EL-Agent).
   - Prompt-Regel "Never ask whether they are still there or can hear you" steht NUR in src/i18n/prompts/en.js (Block calleeRelation, Anruf an eigene Nummer).
     de.js und fr.js enthalten keine entsprechende Regel (grep nach hören/entends/hear/Stille: 0 Treffer). Für alle Sprachen fehlt sie also.
2. EL-Agent hat (Stand 08.11., Staging-Agent agent_8701m438gxj4fxb8htht7e6fa7eb) soft_timeout_config mit use_llm_generated_message=true,
   timeout 2 s, und turn_timeout 5 s, silence_end_call_timeout 30 s, initial_wait_time null. Ein LLM-erzeugter Füllsatz oder eine
   Nachfrage nach Stille ist damit am Agenten möglich. Wer den Satz im Anruf spricht, ist OHNE Transkript NICHT belegt.

## Tabelle beider Seiten
| Eigenschaft | Vorspann (src/tts/synth.ts) | EL-Agent Staging (Snapshot 08.11., veraltet) | Abweichung |
|---|---|---|---|
| voice_id | SJJe86Va82zRzg6zi2dX (laut Auftrag) | NOpBlnGInO9m6vDvFkFC | JA, andere Stimme (heute neu prüfen) |
| Modell | eleven_v4_turbo | eleven_v3_conversational (am 08.11.; Umstellung auf v4_turbo vorbereitet, Stand heute unbekannt) | wahrscheinlich |
| Format | mp3_44100_128 | pcm_16000 | ja (nur Kodierung) |
| stability / similarity / speed | nicht gesendet (Stimmen-Standard) | 0.5 / 0.8 / 1.2 | JA |
| expressive_mode | – | true | ja |
| Sprache | kein language_code | en (Agent-Basis) | ja |
| soft_timeout | – | 2 s, LLM-Füllsatz | Verdacht Satz 1 |
Code: Body nur {text, model_id} (synth.ts openAudioStream); Vorspann-Stimme über elevenLabsVoiceIdFor (src/tts/directive-synth.js:47, :81).
Die Spalte EL-Agent ist 11 Tage alt und muss per GET aktualisiert werden.

## Offen / gebraucht
Lesender Zugriff auf ElevenLabs (GET /v1/convai/conversations?agent_id=..., GET /v1/convai/agents/<id>, GET /v1/voices/<id>/settings)
für Staging-Agent, ohne dass ich den Schlüssel sehe (z. B. Skript, das auf dem Server mit dem Schlüssel läuft), sowie eine freigegebene Prüfnummer.

---
# Nachtrag 19.11. ~19:50 – Code-Teil ohne Schlüssel (Antwort des Chefs auf die Frage)

## PR
sundartha/hermes#5507 (Branch paket-5505-vorspann-stimme, "Teil von #5505", unter der App eröffnet). Stand: eröffnet, CI läuft; Freigabe/Queue regelt Engineering.
Lokal geprüft (Node 26, nur Teilsatz): eslint auf geänderten Dateien sauber, `tools/pruefen.mjs architektur` grün (0 neue Verstöße), `test/anrufe/directive-synth.test.js` 22/22 grün (ohne Code-Änderung rot: Test "Vorspann spricht mit Modell und Stimm-Feinheiten…"), el-stimme-abnahme: nur ABNAHME-AS10 rot (bestehend, verlangt Testanruf-Nachweis im Befund-Doc, unabhängig von dieser Änderung; auf master nicht nachgemessen). tsc lief nur im Hintergrund ohne Fehlerausgabe (Exit 0).

## Was geändert ist
1. Gemeinsame Quelle = Agent-Vorlage `elevenlabs/agent_configs/outbound-agent.template.json`, Abschnitt agent.conversation_config.tts (model_id eleven_v4_turbo, stability 0.65, similarity_boost 0.75; `speed` steht dort NICHT). Diese Felder sind laut `_besitz` Eigentum der Vorlage und werden vom bestehenden Drift-Check (npm run elevenlabs:drift) gegen den Live-Agenten verglichen. `src/conversation/elevenlabs-agent-config.ts` exportiert sie als AGENT_STIMME; `synthesizeVorspann` baut den Body daraus (`model_id`, `voice_settings`); `synth.ts` sendet `voice_settings` optional. voice_id kommt wie bisher vom Anruf (wirksame Stimme; der Agent bekommt dieselbe per Override, `wirksame-stimme.ts`).
2. Test in directive-synth.test.js (ergänzt, nicht geändert): Body des Vorspanns == Modell/stability/similarity_boost/speed der Vorlage; Stimme in der URL = Stimme des Anrufs.
3. Prompt-Regel "Never ask whether the other person is still there or can hear you; if it stays quiet, simply keep waiting.": Hauptprompt der Agent-Vorlage (fehlte dort ganz) plus speechRules in de.js, en.js, fr.js (de/fr: Frage nie, ob dein Gegenüber noch da ist oder dich hören kann; fr analog). Hinweis: Vorlage wirkt am Live-Agenten erst nach Push (scripts/push-elevenlabs.mjs) – ohne Zugang nicht getan.

## Handgriff soft_timeout (nicht angewandt)
Nach EL-Doku (Get-Agent-Beispiel: soft_timeout_config.timeout_seconds = -1; Changelog 17.08.2026: neues Feld `disable_until_first_user_message`, Standard false):
- Variante A (Abschalten): PATCH /v1/convai/agents/<id> mit conversation_config.turn.soft_timeout_config.timeout_seconds = -1 (use_llm_generated_message=false). Vorlage-Besitz: soft_timeout_sekunden (-1 statt 2.0), soft_timeout_llm_filler=false.
- Variante B (milder, behält Füllsatz bei langer Denkpause): disable_until_first_user_message=true – Füllsatz erst nach der ersten Äußerung des Angerufenen. Genau das passt zu "direkt nach der Begrüßung".
- Empfehlung: erst Transkript lesen (kommt der Satz wirklich aus soft_timeout?), dann A oder B über die Vorlage + push-elevenlabs; die Vorlage ist Quelle, kein Direkt-PATCH am Dashboard.

## Noch offen (braucht EL-Zugang + Prüfnummer)
(a) Transkript/Konversation call_mwnuityl849m, (b) Tabelle mit Live-Werten (speed 1.2 war am 08.11. am Agenten gesetzt, steht nicht in der Vorlage und wird vom Vorspann nicht gesendet – erst nach Live-Abfrage entscheiden), (c) Abschalten am Agenten, Testanruf nach Staging-Deploy. Ohne Prüfnummer kein Testanruf.

---
# Nachtrag 19.11. ~19:30 (Lauf A-BHFCJ4)
Render-Schlüssel-Datei ~/.config/hermes/render-api-key existiert auf diesem Server nicht (~/.config/hermes fehlt ganz); kein ElevenLabs-/Render-Zugang, daher (a) Transkript, Live-Werte der Tabelle, (c) Abschalten am Agenten weiter nicht möglich. Kein Testanruf (keine freigegebene Prüfnummer). PR #5507 offen, CI läuft (Freigabe-Prüfung, Testschutz, Semgrep, Rotprobe grün; Tests/Abdeckung ausstehend).
Zum Weiterkommen nötig: Render-Schlüssel (nur lesend) oder ein Skript mit Schlüssel auf dem Server, das GET conversations/agent/voice-settings für Staging-Agent ausführt; Prüfnummer.
