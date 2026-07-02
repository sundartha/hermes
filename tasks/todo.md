# Arbeits-Todo (Scratch)

Dieses File ist der Arbeits-Scratch fuer die jeweils laufende Phase (siehe
`.claude/refs/workflow.md`) und wird pro Aufgabe neu befuellt.

- Dauerhafter Ueberblick ueber offene Punkte: **`STATUS.md`**
- Lehren aus abgeschlossenen Aufgaben: **`tasks/lessons.md`**
- Rebrand-Task im Detail: **`tasks/rebrand-sundartha.md`**

---

# Task: ElevenLabs-TTS ueber Telnyx (globale Plattform-Stimme)

Plan: /Users/antonio/.claude/plans/woolly-mapping-parrot.md (Owner-approved).
Kern: Telnyx rendert `<Say voice="ElevenLabs.<Model>.<VoiceId>" api_key_ref="...">`,
wenn config.telnyxElevenLabs (apiKeyRef+voiceId) gesetzt ist - sonst Azure
byte-identisch. STT bleibt Deepgram (Telnyx kann ElevenLabs nur fuer TTS).
Twilio + Realtime unberuehrt. KEINE Store-/UI-/server.js-Aenderung.

## Schritte

1. [x] `src/config.js`: `telnyxElevenLabs` {apiKeyRef, voiceId, model="Default"}
       aus TELNYX_ELEVENLABS_API_KEY_REF / _VOICE_ID / _MODEL.
2. [x] `.env.example`: 3 Vars dokumentiert (inkl. bewusster Vereinfachung:
       EIN Plattform-Key, kein per-Tenant-TTS-Metering).
3. [x] `render.yaml`: 3 Env-Eintraege (REF/VOICE_ID sync:false, MODEL value Default).
4. [x] `test/helpers.js` BASE_ENV: alle 3 mit "" (Lehre test-base-env-drift).
5. [x] `src/telephony/adapters/telnyx/render.js`: opts-Durchreichung
       (renderDirectives(directives, opts={})) + sayVoiceAttrs(d, opts):
       ElevenLabs-Zweig NUR wenn apiKeyRef UND voiceId (fail-safe, kein Wurf),
       OHNE language-Attribut; gatherAttrs byte-unveraendert; innerer
       Gather-Say erbt opts.
6. [x] `src/telephony/registry.js`: Telnyx-voiceRenderer injiziert
       { elevenLabs: config.telnyxElevenLabs }; Twilio unveraendert.
7. [x] Neu `test/telnyx-elevenlabs-render.test.js`: Snapshots (Say/Gather DE,
       FR/EN-STT-Locale, Gate halb/aus -> Azure, Model-Override v3).
8. [x] Integrationstest `test/telnyx-elevenlabs-inbound.test.js`: Spawn mit
       Env-Vars + Telnyx-Inbound -> ElevenLabs. + api_key_ref +
       transcriptionEngine="Deepgram"; Gegenproben: ohne Env -> Azure,
       Twilio-Inbound -> ElevenLabs-frei.

## Erwartetes Ergebnis (deterministisch)

- Env leer (Default): `npm test` komplett gruen, telnyx-render.test.js
  byte-identisch (kein Verhaltenswechsel).
- opts {apiKeyRef:"elevenlabs_prod", voiceId:"abc123", model:"Default"}:
  `<Say voice="ElevenLabs.Default.abc123" api_key_ref="elevenlabs_prod">` ohne
  language-Attribut; Gather-Attribute byte-identisch zum Azure-Bestand.
- Spawn-Test mit Env: /voice/incoming-Response matcht /ElevenLabs\./ und
  /api_key_ref="elevenlabs_prod"/ und /transcriptionEngine="Deepgram"/.

## Verifikation (gelaufen in dieser Session, alles gruen)

- `node --check` auf alle geaenderten src-/test-Dateien: OK.
- `npm test`: 1581/1581 gruen (inkl. 7 neuer Tests); Bestands-Snapshots
  telnyx-render/directive-render/g3-speech-timeout unveraendert gruen
  (Default aus = byte-identisch belegt).
- Lokaler curl-Smoke (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, REF+VOICE_ID
  gesetzt): Telnyx-Inbound rendert `<Say voice="ElevenLabs.Default.abc123"
  api_key_ref="elevenlabs_prod">` im Gather OHNE language-Attribut, Gather-STT
  byte-identisch (Deepgram/nova-3/de-DE/auto); Twilio-Inbound unveraendert
  Polly.Vicki-Neural (beobachteter TeXML-Output).

## Live-Schaltung (2026-07-02, Owner-genehmigt, autonom ausgefuehrt)

- [x] Merge origin/master (cc5ed53) + Push origin/upstream master; Deploy live,
      [boot] deployed commit=cc5ed53 (19:25 UTC), healthz 200.
- [x] ElevenLabs: Voice "Ela - Empathetic & Warm" (SJJe86Va82zRzg6zi2dX, Library-
      Voice fuer Customer-Support/AI-Agents) in My Voices; API-Key "telnyx-tts"
      restriktiert (TTS Access, Voices Read, Models Access, User Read).
- [x] Telnyx: Integration Secret identifier=elevenlabs_prod (per API, Key nur
      via Clipboard, nie geloggt).
- [x] Render-Env: TELNYX_ELEVENLABS_API_KEY_REF=elevenlabs_prod,
      TELNYX_ELEVENLABS_VOICE_ID=SJJe86Va82zRzg6zi2dX, _MODEL=Default.

## Offen (nur Owner, echtes Telefon)

- Testanruf DE + EN auf die Telnyx-Nummer: spricht der Gather-innere Say
  ElevenLabs? STT weiter ok? Latenz vs. Azure akzeptabel?
- Rollback jederzeit: die zwei Env-Vars in Render leeren (ein Restart).
