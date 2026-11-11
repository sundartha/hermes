`src/mcp/` (Teile von `mcp-tools.js`; Eingang bleibt `src/mcp-tools.js`, hier nichts direkt importieren)

## Baustein mcp (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: MCP-Werkzeuge: Eingabe prüfen, Gateway rufen, Ergebnis aufbereiten.
- Darf nutzen: basis, begriffe, konfiguration, speicher, texte, oberflaeche, mail, sperrdaten, rueckfrage, posteingang, abrechnung, nummern, anmeldung, selbstbedienung, anrufe
- Ort für Neues: Neue Dateien in `src/mcp/` gehören zu mcp, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Kein Eingang liegt in `src/mcp/`.
