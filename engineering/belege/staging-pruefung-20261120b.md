# Staging-Prüfung 20.11.2026 (Wiederholung, A-2YTFNZ)

## 1. Deploy auf Staging (belegt, Render nur gelesen, Mac)
- Dienst: hermes-staging (srv-db1322psrm7s739r1ed0), Branch master, Auto-Deploy ja, nicht angehalten.
- Laufender Deploy: Status live, Commit 559cf5b459 („Drift-Check meldet eine Stimme im Sprach-Preset …“), fertig 20.11. 07:33 UTC.
- PR 5510 (Merge-Commit 3672f610, gemergt 19.11. 19:55 UTC): im Staging-Commit enthalten. GitHub-Vergleich 3672f610...559cf5b459 = „ahead“, 56 Commits, behind 0 (also Vorfahr).
- PR 5515 (Merge-Commit 20541927, gemergt 19.11. 22:23 UTC): enthalten. Vergleich = „ahead“, 40 Commits, behind 0.
- Staging läuft damit den neuen Stand, nicht den alten.

## 2. Transkripte – NICHT gelesen
- Werkzeug: Hermes-Staging-MCP (get_call_status liefert letzte Transkriptzeilen, get_call_result die Ergebniskarte; Beleg: doppelansage-ursache-20261118.md Frage 4). Roh-Transkript nur bei diagnostic=true.
- Nur `list_calls` ging (Zusammenfassungen). Danach lehnte der Server jeden Aufruf ab: „rejected the Authorization header in its config“. Die Anmeldung des MCP-Eintrags ist abgelaufen oder falsch; in einer nicht-interaktiven Sitzung nicht reparierbar. Nötig: auf dem Mac `/mcp` in einer interaktiven Claude-Sitzung, hermes-staging neu verbinden.
- Render-Logs als Ersatz (Zeilen nach call_id und [el-…]-Marken): der Hook sperrte den Abruf; nicht umgangen.
- Ein Werkzeug, das am 19.11. 22:37 gelesen hat, ist nicht gefunden; plausibel war es derselbe MCP.

## 3. Die drei Prüfungen – Stand
Aus den Zusammenfassungen von list_calls (kein Transkript, daher nur Indiz):
(Die Uhrzeiten der Liste sind vermutlich UTC: „19:43“ = der Anruf 20:43 Berlin aus dem Auftrag.)
- Anruf „17:50“ (Liste): „Begrüßung nur einmal“ geprüft, Antonio bestätigte, nichts doppelt gemeldet.
- Anruf „19:43“ (Liste, = 20:43 Berlin): Begrüßung kam nur noch einmal. Antonio meldete aber Latenz: nach der Begrüßung soll 2–2,5 s Pause sein, bevor „Kannst du mich hören?“ kommt, das beanstandete „Ich kann dich nicht hören“ direkt nach der Begrüßung. Dieser Anruf lief 12 Minuten VOR dem Merge von PR 5510 (19:55 UTC).
- (a) Verpasster Anruf / Widget lädt nicht endlos: unbelegt (kein Anruf dazu, kein Transkript, Widget nicht geprüft).
- (b) „Nächste Schritte“ nach Anruf: unbelegt.
- (c) Begrüßung und Gespräch klingen gleich, kein sofortiges „Ich kann dich nicht hören“: unbelegt für den neuen Stand. Bis zum Merge von 5510/5515 war der Fehler im letzten Anruf noch da; seit Deploy 559cf5b459 gibt es keinen Anruf.

## Gegenstelle
Kein neuer Anruf. Alle Staging-Anrufe gingen an +49 173 7252163; eine andere Test-Gegenstelle ist nicht eingerichtet.

## Nächste Handgriffe
1. hermes-staging-MCP neu verbinden (Mac, /mcp).
2. Dann Transkripte der Anrufe nach 19.11. 20:55 und, falls Antonio einen Anruf freigibt, ein neuer Testanruf (diagnostic=true) lesen.
