## Baustein begriffe (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Feste Begriffe ohne Zustand, ohne Texte, ohne Ein-/Ausgabe. Neuer Begriff in die passende `src/begriffe/<thema>.js`, nie in eine Sammeldatei.
- Darf nutzen: basis
- Ort für Neues: Neue Dateien in `src/begriffe/` gehören zu begriffe, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Jede Datei in `src/begriffe/` darf von anderen Bausteinen importiert werden.
