## Baustein selbstbedienung (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Website-Anmeldung, Portal, Newsletter und Geo.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten, abrechnung, anmeldung
- Ort für Neues: Neue Dateien in `src/geo/` gehören zu selbstbedienung, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Andere Bausteine importieren aus `src/geo/` nur resolve.js.
