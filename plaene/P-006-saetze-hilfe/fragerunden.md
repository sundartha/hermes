# P-006 Fragerunden

## Runde 1
1. Die beiden Sätze werden je eine Funktion der Zahl, etwa `(count) => \`${count} Angabe an den Anruf uebergeben.\``, und `countedText(lang, singular, plural)` gibt `(count) => (… === "one" ? singular : plural)(count)` zurück? Empfehlung: ja, weil nur so der Satz die Zahl selbst einsetzt, ohne dass die Hilfe „Zahl + Wort“ zusammensetzt oder einen Platzhalter ersetzt.
2. Name, Parameterliste und Ort der Hilfe bleiben (`countedText(lang, singular, plural)`, nicht exportiert, in der Datei der MCP-Texte)? Empfehlung: ja, weil ein Umbau im kleinsten Schritt nur die Form der beiden Argumente ändert und jede weitere Änderung eine Nebenoptimierung wäre (P-005 N7).
3. Alle drei Sprachen behalten die Zahl vorne, der Wortlaut bleibt byte-gleich? Empfehlung: ja, weil das ein reiner Umbau ist; die freie Wortstellung wird nur möglich, nicht genutzt.
4. Kein neuer und kein geänderter Test; die Falle „keine Zahl + Wort“ prüfen die Sitzung vor dem Push und der KI-Prüfer, kein Test? Empfehlung: ja, weil ein Test auf die Form der Hilfe nach `CLAUDE.md` bei einem reinen Umbau rot würde, ohne dass sich für einen Kunden etwas ändert; die bestehenden S1–S6, B1, B2 sichern den Wortlaut.
5. Die übrigen noch gültigen Fallen aus P-005 kommen mit in den Pitch (festes Sprachkürzel der Tabelle, `Intl.PluralRules` erst beim Aufruf, Umschrift „uebergeben“, genau `one` und Rest)? Empfehlung: ja, weil der Umbau dieselbe Zeile anfasst und jede davon dabei kippen kann; die Falle zur fehlenden vorhandenen Hilfe entfällt, weil die Hilfe jetzt existiert.
6. Design Doc: nein? Empfehlung: ja (nein), weil es mit Frage 1 nur einen ernsthaften Weg gibt, weder Werkzeugvertrag noch Daten berührt werden und ein Code-Rollback alles zurücknimmt; `design.md` bekommt nur „Ausgangslage und Annahmen“.

### Antworten Runde 1
1–6: wie empfohlen (Betreuung). Begründung zu 4: kein Strukturtest; der Wortlaut bleibt durch S1–S6, B1, B2 gesichert, die Falle prüft die Sitzung vor dem Push am Code und belegt es im Protokoll.

## Runde 2 (Premortem)
1. PM1 (Zusammensetzen in eine Fabrik neben `countedText` verschoben, alle Tests grün) wird hingenommen, und die Prüfung vor dem Push am Code erfasst die ganze Datei `src/i18n/mcp-texts.js`, nicht nur `countedText`: kein `${count} ${…}` und keine Funktion, die aus einem Wort einen Satz mit Zahl macht? Empfehlung: ja, weil kein Verhaltenstest die Formen unterscheiden kann und ein Strukturtest nach `CLAUDE.md` verboten ist; zusätzlich steht die Fabrik als ausdrücklich verbotene Form in der Falle, damit Entwurf und Bau sie sehen.

### Antworten Runde 2
1: wie empfohlen (Betreuung): zusätzliche Falle-Zeile gegen die Fabrik, P-005-Falle wörtlich unverändert, Prüfung vor dem Push über die ganze Datei.

## Vorher-Rot
keine Szenarien unter „Anforderungen“ (reiner Umbau), daher kein Beleg nötig.
