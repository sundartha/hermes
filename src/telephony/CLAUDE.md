`src/telephony/` — Provider-Abstraktion (DIP): `ports.js` (Schnittstellen), `registry.js` (Dispatch nach
Provider), `directives.js`; Adapter unter `adapters/telnyx/*` (voice, render, messaging, numbers, signature).
Telefonie-Bugs lassen sich fast immer ohne echten Anruf reproduzieren: `/voice/*`
laesst sich lokal mit `SKIP_TWILIO_SIGNATURE_CHECK=true` und `curl` durchspielen.

## Baustein anrufe (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Anruf führen: Telefonie, ElevenLabs, LLM, TTS, Recherche und Anruf-Routen.
- Darf nutzen: basis, begriffe, konfiguration, speicher, texte, mail, sperrdaten, rueckfrage, abrechnung
- Ort für Neues: Neue Dateien in `src/telephony/` gehören zu anrufe, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von anrufe: `src/elevenlabs/`, `src/conversation/`, `src/llm/`, `src/tts/`, `src/research/`.
- Eingang: Andere Bausteine importieren aus `src/telephony/` nur adapters/telnyx/cost-parse.js, adapters/telnyx/errors.js, adapters/telnyx/http.js, alert-sms.js, failure-reason.js, number-denylist.js, outage-report.js, outbound-gates.js, registry.js, sip-call-id.js, stt-profile.js.
- Andere Bausteine in diesem Ordner: abrechnung (budget-watchdog.js); nummern (absender-registrierung.js, adapters/telnyx/numbers.js, provisioning-geo.js)
