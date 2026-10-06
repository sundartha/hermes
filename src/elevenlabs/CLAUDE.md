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
