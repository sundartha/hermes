## Baustein anmeldung (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Login, Mandant zur Anfrage und Rechte.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten
- Ort für Neues: Neue Dateien in `src/wiring/` gehören zu anmeldung, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Andere Bausteine importieren aus `src/wiring/` nur internal-only.js, operator-routes.js.
