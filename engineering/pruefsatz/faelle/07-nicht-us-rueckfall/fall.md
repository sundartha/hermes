# 07 Nicht-US-Rückfall
Fehler: Ausgehende Anrufe von Nicht-US-Nummern greifen nicht mehr auf die globale Registrierung zurück und brechen ab; Boot-Warnung und Log-Zeile für den Rückfall fehlen ebenfalls (145 Zeilen, drei Dateien).
Herkunft: PR #3191, Commit 9af2911, Issue #3129 (Antonio, Echtanruf); Merge/Deploy am 06.11. von Antonio freigegeben.
Fand ihn damals: Echtbetrieb (ausgehender Anruf brach ab), keine Prüfung. Der Skript-Lauf beim Fix meldete nur jscpd-Befunde.
Erwartet rot: test/nummern/absender-registrierung.test.js, test/absender-el-registrierung.test.js, test/elevenlabs-anrufstart.test.js.
