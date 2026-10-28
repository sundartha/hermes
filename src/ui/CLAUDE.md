## Baustein oberflaeche (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck: Widgets und Karten für die MCP-Oberfläche.
- Darf nutzen: basis, konfiguration, speicher, texte, mail, sperrdaten, rueckfrage, posteingang, abrechnung, nummern, anmeldung, selbstbedienung, anrufe
- Ort für Neues: Neue Dateien in `src/ui/` gehören zu oberflaeche, solange tools/bausteine.json sie keinem anderen Baustein nennt.
- Eingang: Andere Bausteine importieren aus `src/ui/` nur adapters/mcp-native.js, chatgpt-egress.js, contract.js, registry.js, widget-catalog.js, widget-i18n.js.
