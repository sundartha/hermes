# P-013 Fragerunden

## Runde 1

1. Absicht (Entwurf): „Wer mit `POST /api/inbox/poll` und `include_seen:true` auf den Posteingang zurückschaut, soll über ein optionales `offset` auch die Einträge hinter den ersten 20 erreichen; heute meldet die Antwort `remaining` größer 0, ohne dass es einen Weg dorthin gibt. Ohne `include_seen:true` bleibt der Abruf genau wie heute, einschließlich des Markierens als gesehen, und `offset` wird dort nicht ausgewertet. Keine Abkürzung über eine Änderung am Store, am MCP-Werkzeug `check_inbox` oder an der Seitengröße von 20. Im Zweifel lehnt die Route einen `offset`, der keine ganze Zahl ab 0 ist, mit 400 ab, statt still eine andere Seite zu liefern.“ Empfehlung: ja, weil sie Umfang, Bleibt-Grenze und die Wahl im Zweifel in einem Text nennt.
2. `offset` wirkt nur mit `include_seen:true`; ohne wird es nicht gelesen (auch nicht geprüft). Empfehlung: ja, weil der verbrauchende Abruf jeden gelieferten Eintrag als gesehen markiert (`src/store/state-ops.js:414-418`) und ein `offset` dort übersprungene Einträge ungesehen mitmarkieren würde; „ohne `include_seen` wie heute“ steht so im Kandidaten.
3. Nur eine JSON-Zahl, die eine sichere ganze Zahl ab 0 ist, gilt; Text, Bruch, negativ → `400` mit `{"error":"offset muss eine ganze Zahl ab 0 sein"}`. Empfehlung: ja, weil `include_seen` ebenso nur bei genau `true` wirkt (`src/routes/api-inbox.js:13`) und deutsche Fehlertexte im Feld `error` dem Muster von `src/routes/api-calls.js:234` folgen.
4. Die Store-Funktion bleibt unverändert; die Route fragt `limit: offset + 20` ab und gibt die Einträge ab `offset` zurück. Ohne `offset` bleiben die Store-Optionen genau `{ limit: 20, includeSeen }`. Empfehlung: ja, weil `src/store/` ausgeschlossen ist, `remaining` der Store-Funktion dann schon die Einträge hinter der Seite zählt (`src/store/state-ops.js:420`) und `INBOX-P2 A5` unverändert grün bleibt.
5. Szenarien: S1 (25 Einträge, `offset:20` → 5 jüngste, `remaining:0`), S2 (`offset:"20"` → 400), B1 (ohne `offset` → 20 älteste, `remaining:5`). Empfehlung: ja, weil das die Abnahme aus dem Kandidaten, die Ablehnung und die erste Seite wie heute abdeckt, bewusst klein.
6. Tests ergänzen `test/posteingang/posteingang-poll.test.js` und nutzen dort `poll`, `startServer`, `seedState`, `seedCall`; keine neue Testdatei. Empfehlung: ja, weil die Hilfe `poll` nur in dieser Datei steht und eine neue Datei sie kopieren müsste.
7. Es entsteht kein Design Doc (`design.md` nur mit „Ausgangslage und Annahmen“). Empfehlung: ja, weil es nur einen ernsthaften Weg gibt und ein Revert die Änderung ganz zurücknimmt.

### Antworten Runde 1
Sitzung P013 (27.10.2026) als Entscheider nach dem Auftrag der Betreuung („inhaltliche Entscheidung: du entscheidest selbst wie ein Manager“): 1–7 wie empfohlen. Protokolliert als Halt H1 (Klasse B) in Issue #2223.

## Vorher-Rot
- S1: heute `entries` = die 20 ältesten Einträge und `remaining` = `5` statt der 5 jüngsten und `0`, weil die Route `offset` nicht liest und immer `limit: INBOX_MAX_ENTRIES` übergibt (`src/routes/api-inbox.js:13-17`) und der Store ab dem ältesten Eintrag schneidet (`src/store/state-ops.js:413`).
- S2: heute Status `200` mit der ersten Seite statt `400`, weil die Route `offset` nicht liest (`src/routes/api-inbox.js:13-17`).

## Runde 2 (Premortem)

1. PM1: Nicht-Ziel „Blättern über MCP“ schärfen, Problem und Ergebnis auf den Aufrufer der Route. Empfehlung: ja, weil `check_inbox` ausgeschlossen ist und der Pitch sonst einen Nutzen verspräche, den die Änderung allein nicht liefert.
2. PM2 als B1 (`{"offset":20}` ohne `include_seen` markiert nur die gelieferte Seite), B1 alt (erste Seite ohne `offset`) entfällt, weil `INBOX-P2 A5` sie schützt. Empfehlung: ja, weil der Auftrag höchstens 3 Szenarien erlaubt und B1 neu den größeren Schaden (still verlorene Einträge) abdeckt.
3. PM3: S2 auf `offset:-1` umstellen. Empfehlung: ja, weil `-1` ohne Prüfung still eine falsche Seite liefert, `"20"` dagegen zufällig die richtige.
4. PM4 hinnehmen. Empfehlung: ja, weil `remaining` laut Grober Lösung aus dem Store kommt und die Mutationsprüfung eine eigene Rechnung aufdeckt.
5. PM5 hinnehmen, Falle berichtigen. Empfehlung: ja, weil nur Aufrufer im Prozess die Route erreichen.
6. PM6 und PM7 hinnehmen. Empfehlung: ja, weil ein Cursor eine Änderung am Store bräuchte.

### Antworten Runde 2
Sitzung P013 (27.10.2026) als Entscheider nach dem Auftrag der Betreuung: 1–6 wie empfohlen. Protokolliert als Halt H2 (Klasse B) in Issue #2223.

## Freigabe
Sitzung P013 als Entscheider im Auftrag der Betreuung, 27.10.2026 (Halt H3, Klasse B): Freigabeliste 1–6 wie empfohlen (1 schwerste Wege T1/T2 passen; 2 kein fehlender Weg; 3 T2 hingenommen mit Bedingung „neu bewerten, sobald `check_inbox` ein `offset` bekommt“; 4 G1 umgesetzt, B1 mit `{"include_seen":"true","offset":20}`; 5 PM4–PM7 hingenommen wie Runde 2; 6 Altfunktionen: keine). Offene Annahme ohne Entscheidung: Auf Render erreicht nur der eigene Prozess die Route über Loopback ohne `X-Forwarded-For` (sicherheit.md, Offene Fragen 1; besteht unabhängig von dieser Änderung). Issue #2223.
