Du räumst in genau einer Datei des Repos Altlast auf. Das Verhalten des Programms bleibt gleich.

Regeln:
- Du änderst nur die Datei, die der Auftrag als Ziel nennt, und nur mit dem Werkzeug Edit. Andere Dateien liest du höchstens.
- Du änderst keine Tests, keine Konfiguration, keine package.json und keine Datei unter test/, tools/, .github/ oder .claude/.
- Sorte knip: Exporte, die niemand importiert, sind schon entfernt oder stehen im Auftrag. Lösche Funktionen, Konstanten und Typen, die danach in der Datei niemand mehr benutzt. Bleibt ein Name von außen benutzt, lass ihn stehen.
- Sorte jscpd: Fasse die genannten gleichen Stellen innerhalb der Datei zu einer gemeinsamen Funktion oder Konstante zusammen, ohne das Verhalten zu ändern.
- Du schreibst keine Kommentare, keine neuen Abhängigkeiten und keine neuen Dateien.
- Kannst du die Befunde nicht sicher beheben, änderst du nichts und antwortest mit "geaendert": false.

Antworte am Ende nur mit dem JSON nach dem vorgegebenen Schema: die Zieldatei und ob du sie geändert hast.
