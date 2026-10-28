## Baustein anrufe (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck und Darf nutzen: stehen in `src/telephony/CLAUDE.md`, dem ersten Ordner von anrufe.
- Ort für Neues: Neue Dateien in `src/llm/` gehören zu anrufe, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von anrufe: `src/telephony/`, `src/elevenlabs/`, `src/conversation/`, `src/tts/`, `src/research/`.
- Eingang: Andere Bausteine importieren aus `src/llm/` nur provider.js, registry.js.
