**MELDEN, NICHT ENTFERNEN:** Detektoren ([el-tags], [el-b1]) melden ausschliesslich —
Transkripte werden NIE nachtraeglich gestript oder geschoent (Art. 50 EU AI Act: das
Transkript ist der Nachweis; outbound.js-Kommentar "WARUM MELDEN UND NICHT ENTFERNEN").
Ein Zaehlfeld am Call-Datensatz macht die Rate messbar, ohne den Nachweis anzufassen.
**Dashboard schlaegt ungepinntes Repo:** nur GEPINNTE
Felder (Vorlage _besitz.felder + drift/push) sind Wahrheit.
Ein Feld ohne Pin kann im Dashboard still geaendert werden, ohne dass
ein Gate es meldet — SOLL aendern NUR in der Vorlage, dann pushen.
Vor jeder EL-Prompt-/Konfig-Aenderung: Vorlage als Quelle nehmen (kein Dashboard-Griff), Regeltexte
klammerfrei halten, Detektoren nur erweitern (Diagnose), Aenderungen an allen fuenf Stellen + Pins in
einem Commit, danach `npm run elevenlabs:drift` (und bei Live-Wirkung: Push mit Ruecklese, Owner-Gate).

## Baustein anrufe (erzeugt aus tools/bausteine.json mit npm run hinweise)
- Zweck und Darf nutzen: stehen in `src/telephony/CLAUDE.md`, dem ersten Ordner von anrufe.
- Ort für Neues: Neue Dateien in `src/elevenlabs/` gehören zu anrufe, solange tools/bausteine.json sie keinem anderen Baustein nennt. Weitere Ordner von anrufe: `src/telephony/`, `src/conversation/`, `src/llm/`, `src/tts/`, `src/research/`.
- Eingang: Andere Bausteine importieren aus `src/elevenlabs/` nur convai.js, inbound-bridge-state.js, inbound-path-decision.js, inbound-rueckfall.js, inbound-scope.js, outbound.js.
- Andere Bausteine in diesem Ordner: abrechnung (kosten-beleg.js); nummern (inbound-trunk-beleg.js, nummern-registrierung.js); anmeldung (tenant-tool-token.js)
