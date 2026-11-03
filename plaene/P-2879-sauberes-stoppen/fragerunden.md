# P-2879 Sauberes Stoppen: Fragerunden

## Runde 1

1. Außenverkehr beim Stoppen: Nach dem Signal bekommt jede neue Anfrage, die `isTrustedLocalCaller` nicht erfüllt (also nicht über einen lokalen Socket ohne `X-Forwarded-For` kommt), sofort `503` mit `Connection: close` und `Retry-After`, auch `/healthz` von außen; ein lokaler Aufrufer ohne `X-Forwarded-For` (der interne MCP-Sprung) wird bis zur Teilfrist angenommen. Empfehlung: ja, weil „von außen“ so mit der bestehenden Auth-Weiche entschieden wird und keine zweite Stelle dieselbe Frage beantwortet.
2. Zählung: Eine Anfrage zählt vom Eingang der Kopfzeilen bis zum Ende der Antwort. Der äußere MCP-Aufruf bleibt offen, solange seine internen Sprünge laufen, deshalb steht der Zähler zwischen zwei Sprüngen nicht auf 0. Abgewiesene Anfragen zählen nicht. Empfehlung: ja, weil sonst der Server zwischen Sprung 1 und Sprung 2 von `place_call` schließen könnte.
3. Frist-Kette: Die Gesamtfrist ist `SHUTDOWN_DRAIN_TIMEOUT_MS` (Default bleibt 8000, Deckel 110000, `render.yaml` 100000). Die Teilfrist für das Warten auf offene Anfragen ist 80 % der Gesamtfrist (bei 100000: 80 s), die übrigen 20 % (20 s) gehören dem letzten Flush. `maxShutdownDelaySeconds` 120 liegt 20 s über der Gesamtfrist. Empfehlung: ja, weil Render dann erst nach der Gesamtfrist mit SIGKILL beendet und der Flush immer ein eigenes Fenster hat.
4. Nach der Teilfrist: Noch offene Anfragen werden abgebrochen, eine Logzeile nennt ihre Zahl, der Flush läuft trotzdem. Endet er sauber, ist der Exit-Code `0`; scheitert er, `1` wie heute. Läuft die Gesamtfrist ab, bevor der Flush fertig ist, schreibt der Prozess eine Logzeile und endet mit `1`. Empfehlung: ja, weil das den Bauplan wörtlich umsetzt (Code 1 nur bei Ablauf der Gesamtfrist oder Flush-Fehler).
5. Der bestehende Test „SIGTERM mit haengendem Request: Watchdog erzwingt exit 0, ohne den finalen Store-Flush zu erreichen“ (`test/graceful-shutdown.test.js`) beschreibt genau das alte Verhalten (Exit `0`, kein Flush) und wird durch die Szenarien S3 und S4 ersetzt. Ein geänderter bestehender Test braucht Antonios Freigabe am PR. Empfehlung: ja, weil das Verhalten absichtlich ändert.
6. Geänderte Dateien: `src/abschalten.js`, `src/boot.js`, `src/app.js` (falls Zähler und Abweisung dort als erste Middleware eingehängt werden müssen), `src/config.js`, `.env.example`, `render.yaml`, `docs/RUNBOOK-LAB-LIVE.md` (der Satz zu den 8 Sekunden) und `test/graceful-shutdown.test.js`. Empfehlung: ja, weil das den Umfang nach oben abdeckt; ein zu viel genannter Code-Pfad kostet nichts.
7. Szenarien: S1 interner Sprung nach dem Signal gelingt; S2 neue Außenanfrage (auch mit `X-Forwarded-For` über Loopback) bekommt `503`; S3 Teilfrist überschritten, Flush läuft trotzdem und das Transkript ist persistiert; S4 Gesamtfrist abgelaufen, Exit `1` und Logzeile; S5 Start mit `SHUTDOWN_DRAIN_TIMEOUT_MS=110000` gelingt, mit `110001` nicht; B1 eine laufende Anfrage endet mit `200` und Exit `0` (heutiges Verhalten). Empfehlung: ja, weil jede Zeile ein eigenes Verhalten hat.
8. Kein Design Doc: Nur `design.md` mit „Ausgangslage und Annahmen“; die Frist-Kette steht im Pitch unter „Grobe Lösung“. Empfehlung: ja, wie von der Betreuung vorgegeben (ein Weg, Revert nimmt alles zurück).
9. Nicht-Ziele: `boss.stop` (K1), mehrere Instanzen (S13) und ein „Fertig laufen“ von Anrufen. Empfehlung: ja, weil sie eigene Pakete sind.

### Antworten Runde 1
Betreuung 03.11.2026 (Antonio): ja zu 1–9. Ergänzungen: Zu 5 gibt die Testschutz-Freigabe (Label `verhalten-geaendert`) der unabhängige Prüf-Agent; Testname wörtlich und Datei kommen unter „Tests, deren Erwartung sich ändern darf“ ins Issue #2879, bevor gebaut wird. Zu 3/6: `src/config.js` wird gerade von KFZ (#2306) zerlegt; der neue Deckel landet nach dem KFZ-Merge in `src/konfiguration/`, der Plan nennt die Fundstelle über den Schlüsselnamen `shutdownDrainTimeoutMs`/`SHUTDOWN_DRAIN_TIMEOUT_MS`, nicht über die Zeile. Zu 4: abgebrochene Anfragen allein machen kein Exit 1, sie stehen nur in der Logzeile.
Hinweis der Sitzung zu 7: S5 (110001 abgelehnt) entfällt, weil `numEnv` einen Wert über dem Deckel nicht ablehnt, sondern auf den Deckel kürzt (`src/config.js:62`), und ein Deckel von 110 s in Testzeit nicht beobachtbar ist; die Freigabeliste legt das vor.

## Vorher-Rot
- S1: heute scheitert der erste interne Sprung (`/api/call-confirmations`), den der `place_call` erst nach dem Signal beginnt, mit Verbindungsfehler, und `place_call` meldet einen Fehler statt `dialing`, weil `httpServer.close()` neue Verbindungen sofort verweigert (`src/abschalten.js:18`) und der Sprung per `fetch` auf `localhost` geht (`src/mcp-tools.js:35`).
- S2: heute Verbindungsabbruch (keine Antwort) statt `503` mit `Retry-After: 5`, weil der Listener nach `close()` nichts mehr annimmt (`src/abschalten.js:18`) und kein Code `Retry-After` setzt (`grep Retry-After src/abschalten.js`: keine Treffer).
- S3: heute Exit `0` und keine Zeile mit „Teilfrist abgelaufen“ und keine mit „Finaler Store-Flush abgeschlossen“, weil der Watchdog nach `shutdownDrainTimeoutMs` ohne Flush `exit(0)` ruft (`src/abschalten.js:15`).
- S4: heute Exit `0` statt `1` beim Ablauf der Frist, `src/abschalten.js:15`.
- S5: heute `SHUTDOWN_DRAIN_TIMEOUT_MS` mit `8000` statt `25000` (`render.yaml:312`) und der Deckel `30000` statt `110000` (`src/config.js:739`); `.env.example` nennt `30000` als Maximum (`.env.example:845`), das Runbook nennt die 8 Sekunden (`docs/RUNBOOK-LAB-LIVE.md:159`).

## Runde 2 (Freigabeliste)
Siehe die nummerierte Liste in der Frage-Datei der Sitzung vom 03.11.2026; die Antworten der Betreuung kommen hier unter „Antworten Runde 2“.

### Antworten Runde 2
Betreuung 03.11.2026: 1 ja. 3, 4, 5 ja, unter dem Vorbehalt der Antwort von Antonio zu 2. 2 und 6 entscheidet Antonio (Frage an ihn gestellt). 7 entschieden ohne Antonio: `render.yaml` setzt `SHUTDOWN_DRAIN_TIMEOUT_MS` auf 25000 und setzt `maxShutdownDelaySeconds` nicht; der Code-Deckel 110000 ist erlaubt; PM5 bleibt Nicht-Ziel; Teilfrist 80 % = 20 s, Flush 5 s. 8, 9, 10 ja (bei 8 nennt das Runbook den Preis mit 25 s). 11 bis 17 ja (16 nur solange 2 hingenommen wird). D: a) und c) als vertrauliche Fehler, Schwere hoch (a vor B10, Bedingung zu 2); b) nicht eigens, Gegenstand von S2a (#2869). Status „freigegeben“ erst nach Antonios Antwort zu 2 und 6.

## Runde 3
1. Unter „Geänderte Dateien“ kommt die Zeile `src/abschaltweiche.js` dazu: neues Modul für Abschaltweiche und Zähler offener Anfragen (S2), von der Erkundung der Planung gemeldet. Empfehlung: ja, weil es nur die Dateiliste betrifft und kein Verhalten, Szenario oder keine Sicherheitsaussage ändert.

### Antworten Runde 3
Betreuung 03.11.2026: ja; sonst nichts ändern. Teil-Ordner und `planung/` werden gelöscht, `plane` läuft auf den Eltern-Pitch neu. Zieht die neue Teilung `src/config.js` und `render.yaml` in Teil 1 und braucht S1 sie, wird so weitergeplant (nicht von Hand umteilen) und es steht in der Schlussmeldung; KFZ zerlegt `src/config.js` gerade, Konflikte löst `lauf` beim Rebase.

## Runde 4
1. Szenario S5 (R5) kommt in den Pitch: die Werte aus `render.yaml` (Gesamtfrist 25000 ms, Deckel 110000 ms), `.env.example` und Runbook nennen 25 s, das Runbook die Anrufpause als ersten Notaus-Schritt. Empfehlung: ja, weil sonst niemand diese Werte baut.
2. Die drei festen Sätze (Zähler ab den Kopfzeilen, Teilfrist 80 %, Logzeilen nur mit Zahlen) stehen im Pitch-Kopf mit Zuordnung zu a1 und a2. Empfehlung: ja, weil die Gegenfrage der Planung sonst wiederkehrt.

### Antworten Runde 4
Betreuung 03.11.2026: (a) ja; Reihenfolge Teil 1 Frist-Kette/Flush vor Teil 2 Abschaltweiche in Ordnung; kehrt nur ein Zuordnungs- oder Formbefund wieder, löst ihn die Sitzung im Pitch-Kopf und setzt fort.

### Zuordnung (Sitzung, 03.11.2026, im Rahmen der Regel „Zuordnungsbefunde im Pitch-Kopf lösen“)
Die zweite Teilung hat S1 in Teil 1 vor die Abschaltweiche S2 gelegt. Das ließe den Server nach dem Signal Anfragen von außen annehmen, bis Teil 2 gebaut ist. Der Pitch-Kopf nennt deshalb die Zuordnung S1 mit oder nach S2; Verhalten, Szenarien und Sicherheitsaussagen sind unverändert.

### Form (Sitzung, 03.11.2026, im Rahmen der Regel „Form- und Zuordnungsbefunde im Pitch-Kopf lösen“)
Die Planung von Teil 1 endete mit Exit 4 an der Form der Nie-Sätze (die Sätze wurden mit Listenzeichen und Nummer zitiert und stehen so nicht wörtlich im Pitch). Der Pitch-Kopf nennt jetzt den Wortlaut der drei festen Sätze ohne Listenzeichen; Verhalten, Szenarien und Sicherheitsaussagen sind unverändert.

Der erste feste Satz steht im Pitch-Kopf jetzt mit den Fettdruck-Zeichen, weil der Satz im Abschnitt „Grobe Lösung“ nur so als ganzer Satz steht (zweiter Form-Befund der Planung; Verhalten, Szenarien und Sicherheitsaussagen unverändert).

Dritter Form-Befund der Planung (Zuordnung): Der Satz aus „Fallen“ zum Testgerüst für S4 gehört wörtlich zu a2 und steht jetzt als vierter fester Satz im Pitch-Kopf. Verhalten, Szenarien und Sicherheitsaussagen sind unverändert.

Vierter Befund der Planung (Zuordnung von Dateien): Die Erkundung von S3 und B3 zog `src/app.js` in die Frist-Kette, die Teilung hat die Datei der Abschaltweiche zugewiesen. Der Pitch-Kopf legt jetzt fest, dass der Zähler in `src/abschalten.js` am `httpServer` eingerichtet wird (wie schon in der Annahme des früheren Planungslaufs); Verhalten, Szenarien und Sicherheitsaussagen sind unverändert.

Fünfter Befund der Planung (Zuordnung von Dateien): Die Erkundung von S3 zog `src/config.js` in die Frist-Kette. Der Pitch-Kopf legt fest, dass die Teilfrist aus `shutdownDrainTimeoutMs` in `src/abschalten.js` abgeleitet wird und `src/config.js` nur für den Deckel (S5) geändert wird; Verhalten, Szenarien und Sicherheitsaussagen sind unverändert.

## Entscheidungen der Sitzung
Seit der Regel des Steuerprogramms (Antonio, 03.11.2026) entscheidet die Sitzung selbst nach ihrer Empfehlung; Fragen zu Kunden, Geld, Recht, Lockerung einer Prüfung oder Nicht-Zielen und Szenarien gehen an Antonio.
1. Die Teilung von `plane` ist in drei Teile gelaufen (Fristen, Abschaltweiche mit MCP-Sprung, Fristwerte). Entscheidung: so planen, nicht von Hand umteilen. Grund: die Reihenfolge Frist-Kette vor Abschaltweiche lässt den Außenschutz nie aufgeweicht, und die Betreuung hat sie am 03.11.2026 für in Ordnung erklärt.
2. Entscheidung: Die Zuordnungen im Pitch-Kopf (S1 mit oder nach S2, Zähler in `src/abschalten.js` am `httpServer`, Teilfrist aus `shutdownDrainTimeoutMs` ohne neues Feld, `src/config.js` nur für den Deckel in S5, vier feste Sätze für a1 und a2) bleiben. Grund: sie lösen Zuordnungs- und Formbefunde der Planung, ohne Verhalten, Szenarien oder Sicherheitsaussagen zu ändern; jede dieser Zeilen steht in „Form“ oder „Zuordnung“ weiter oben mit ihrem Anlass.
3. Entscheidung: Der Lauf von `plane` wird nach einem Abbruch (Exit 137, Prozess beendet) neu gestartet. Grund: der Abbruch kam von außen, es gab keine Datei und keinen Befund; der Stand ist committet.
4. Entscheidung: Die Teil-Issues 2893 (Teil 1), 2892 (Teil 2) und 2897 (Teil 3) bleiben bei jeder Neuteilung mit denselben Nummern; die Teil-Pitches bekommen sie nach der Teilung eingetragen. Grund: die Teile haben jedes Mal dieselbe Reihenfolge und denselben Inhalt.
