## Baustein anrufe (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck und Darf nutzen: stehen in `src/telephony/CLAUDE.md`, dem ersten Ordner von anrufe.
- Ort für Neues: Neue Dateien in `src/conversation/` gehören zu anrufe, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von anrufe: `src/telephony/`, `src/elevenlabs/`, `src/llm/`, `src/tts/`, `src/research/`.
- Eingang: Kein Eingang liegt in `src/conversation/`.
- Andere Bausteine in diesem Ordner: rueckfrage (consult-raised.js)
