`src/konfiguration/` (Teile von `config.js`; Eingang bleibt `src/config.js`, hier nichts direkt importieren)

## Baustein konfiguration (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Liest Umgebungsvariablen, prüft sie beim Start und liefert config nach Namensräumen.
- Darf nutzen: basis
- Ort für Neues: Neue Dateien in `src/konfiguration/` gehören zu konfiguration, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Kein Eingang liegt in `src/konfiguration/`.
