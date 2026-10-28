## Baustein nummern (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Nummern bestellen, binden und freigeben.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten, abrechnung
- Ort für Neues: Neue Dateien in `src/worker/` gehören zu nummern, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von nummern: `src/queue/`.
- Eingang: Kein Eingang liegt in `src/worker/`.
