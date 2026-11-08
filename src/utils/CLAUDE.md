## Baustein basis (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Reine technische Hilfen ohne Fachwissen: Zeit, Text, Sperren, Log-Maske, Metriken. Anfragen nach außen nur mit `anfrage()` aus `src/utils/anfrage.js`.
- Darf nutzen: nichts
- Ort für Neues: Neue Dateien in `src/utils/` gehören zu basis, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Jede Datei in `src/utils/` darf von anderen Bausteinen importiert werden.
