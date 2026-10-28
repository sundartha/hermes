## Baustein rueckfrage (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Rückfragen während des Anrufs.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten
- Ort für Neues: Neue Dateien in `src/consult/` gehören zu rueckfrage, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Andere Bausteine importieren aus `src/consult/` nur delivery.js, gate.js, in-call.js.
