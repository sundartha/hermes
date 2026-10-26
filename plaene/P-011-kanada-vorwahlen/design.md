# P-011 Zeitzonen-Vermutung für kanadische Vorwahlen: Design Doc

Status: freigegeben
Freigabe: Betreuung im Auftrag von Antonio 25.10.2026
Pitch: plaene/P-011-kanada-vorwahlen/pitch.md
Entscheidung: kein Design Doc (Pitch „Design Doc: nein“); dieses Dokument trägt nur die Ausgangslage.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: die Vorwahl-Tabelle für US-Nummern mit Zone je Vorwahl und gesprochenem Namen je Zone; sie leistet die Änderung, sobald sie die kanadischen Vorwahlen kennt | `node tools/auftrag.mjs suche "area code"`: `src/elevenlabs/outbound.js:258` und `test/elevenlabs-anrufstart.test.js:1141` (nur die Nutzung); `node tools/auftrag.mjs suche "America/Toronto"`: nur `src/geo/resolve.js:24` (Land-Tabelle, für +1 nicht erreicht); `node tools/auftrag.mjs suche "Vorwahl"`: keine Hilfe außerhalb von Tests | – |
| Die Vermutung kommt nur aus `timezoneHypothesisForNumber` und nur, wenn die Land-Ableitung leer ist | `src/elevenlabs/time-context.js:25-34` (Zeile 31) | – |
| Für jede +1-Nummer liefert die Land-Ableitung `null` (Owner-Entscheidung E2) | `test/elevenlabs-anrufstart.test.js:1235-1239`, nachgestellt 25.10.2026 für `+14165550147` | – |
| Der Satz an den Agenten nennt die Kennung und den gesprochenen Namen und verlangt die Bestätigung vor jeder Uhrzeit | `src/elevenlabs/outbound.js:257-258`, Auswahl `src/elevenlabs/outbound.js:262-266`, Feld `callee_timezone` `src/elevenlabs/outbound.js:330` | – |
| Gesprochener Name fällt auf die Kennung zurück, wenn die Zone keinen Namen hat | `src/elevenlabs/nanp-area-codes.js:93-95` | – |
| Die Tabelle lässt Vorwahlen über zwei Zonen aus (z. B. 850, 915, 906, 541 fehlen) | `src/elevenlabs/nanp-area-codes.js:13-66` | – |
| Keine der 55 kanadischen Vorwahlen steht heute in der Tabelle | Wegwerf-Versuch 25.10.2026 06:07 am master 9294854: `timezoneHypothesisForNumber` liefert für alle 55 `""` | – |
| Liste der kanadischen Vorwahlen je Provinz | Wikipedia „Telephone numbers in Canada“, https://en.wikipedia.org/wiki/Telephone_numbers_in_Canada, gelesen 25.10.2026 (CNAC-Seite https://www.cnac.ca/area_code_maps/canadian_area_codes.htm hat nur Kartenbilder) | Eine Vorwahl fehlt: sie bleibt ohne Vermutung wie heute. Eine Vorwahl ist falsch zugeordnet: der Agent fragt nach der falschen Zone, der Angerufene korrigiert sie vor der ersten Uhrzeit |
| Die Zonen-Zuordnung je Provinz (Ontario/Quebec ohne 807, 418, 581, 367 Eastern; Manitoba Central; Alberta nur 780 Mountain; 604 Pacific) | ungeprüft gegen eine amtliche Zonenkarte; prüfen durch: IANA tzdata `zone1970.tab` (America/Toronto, America/Winnipeg, America/Edmonton, America/Vancouver) | wie Zeile davor |
| 403 und 819 haben einzelne Nummernblöcke regionaler Anbieter in den Territorien (andere Zone) | Wikipedia (wie oben), Fußnote zu den Territorien „(403, 418, 819)“ | 403 mit 587, 825, 368: ausgelassen (Yukon UTC-7 heißt auch „Mountain“, die Bestätigung fängt es nicht ab; Betreuung Runde 2). 819 mit 873, 468: hingenommen, weil die Vermutung vor jeder Uhrzeit bestätigt wird (`src/elevenlabs/outbound.js:257-258`) |
| 780 bedient nur Alberta, keine Territorien-Blöcke | Wikipedia „Area code 780“, https://en.wikipedia.org/wiki/Area_code_780, gelesen 25.10.2026: alle Vermittlungsstellen in Alberta; 587, 825, 368 sind Overlay für ganz Alberta | 780 bekäme dieselbe Lage wie 403 und müsste ausgelassen werden; S3 hätte keine Mountain-Vorwahl |
| Das Land-Gate unterscheidet Kanada und USA nicht (Präfix `+1`) | `src/telephony/outbound-gates.js:170-171` | – |
