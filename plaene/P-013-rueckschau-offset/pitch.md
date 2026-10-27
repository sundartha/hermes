# P-013 Rückschau im Posteingang mit offset

Status: freigegeben
Freigabe: Sitzung P013 als Entscheider im Auftrag der Betreuung, 27.10.2026 (Halt H3 in Issue #2223)
Issue: 2223
Design Doc: nein, weil die Änderung nur das Lesen eines optionalen Werts in einer Route ergänzt, es mit der unveränderten Store-Funktion nur einen ernsthaften Weg gibt und ein Revert sie ganz zurücknimmt.

## Absicht
Wer mit `POST /api/inbox/poll` und `include_seen:true` auf den Posteingang zurückschaut, soll über ein optionales `offset` auch die Einträge hinter den ersten 20 erreichen; heute meldet die Antwort `remaining` größer 0, ohne dass es einen Weg dorthin gibt. Ohne `include_seen:true` bleibt der Abruf genau wie heute, einschließlich des Markierens als gesehen, und `offset` wird dort nicht ausgewertet. Keine Abkürzung über eine Änderung am Store, am MCP-Werkzeug `check_inbox` oder an der Seitengröße von 20. Im Zweifel lehnt die Route einen `offset`, der keine ganze Zahl ab 0 ist, mit 400 ab, statt still eine andere Seite zu liefern.

## Problem
Ein Aufrufer im Prozess (die Route steht hinter `internalOnly`, `src/routes/api-inbox.js:10`; heute ruft sie nur das MCP-Werkzeug `check_inbox` auf, `src/mcp-tools.js:1167`) hat für einen Tenant mit 25 Anrufen im Posteingang `POST /api/inbox/poll` mit `{"include_seen":true}` aufgerufen, um sie noch einmal durchzusehen. Er bekommt die 20 ältesten Einträge und `"remaining":5`. Ruft er erneut auf, bekommt er dieselben 20 Einträge, weil die Rückschau nichts als gesehen markiert und die Route immer ab dem ältesten Eintrag liest (`src/routes/api-inbox.js:13-17`, `src/store/state-ops.js:406-421`). Die 5 jüngsten Einträge erreicht er in der Rückschau nie.

## Ergebnis
Nach dieser Änderung bekommt ein Aufrufer von `POST /api/inbox/poll` mit `{"include_seen":true,"offset":20}` bei 25 Einträgen genau die 5 jüngsten Einträge und `"remaining":0`.

## Grobe Lösung
Der Aufrufer der Route blättert in der Rückschau weiter, indem er `offset` um die Zahl der erhaltenen Einträge erhöht, bis `remaining` 0 ist. Die Route liest dafür von der unveränderten Store-Abfrage so viele Einträge, wie `offset` plus Seitengröße ergeben, und gibt nur die ab `offset` zurück; `remaining` zählt die Einträge hinter dieser Seite. Ohne `include_seen:true` liest die Route `offset` nicht, der Abruf liefert und markiert wie heute. Das MCP-Werkzeug `check_inbox` schickt kein `offset` und verhält sich unverändert.

## Fallen
- Die Store-Funktion markiert ohne `include_seen` jeden gelieferten Eintrag als gesehen: Ein `offset` im verbrauchenden Abruf würde die übersprungenen Einträge mitmarkieren, ohne dass jemand sie gesehen hat. Entscheidung: `offset` wirkt nur mit `include_seen:true`; ohne wird es nicht gelesen.
- Ein `offset` als Text (`"20"`), als Bruch (`1.5`) oder negativ (`-1`): Entscheidung: 400 mit `{"error":"offset muss eine ganze Zahl ab 0 sein"}`, wie `include_seen` nur bei genau `true` wirkt (fail-closed, kein Umwandeln von Text). Die vorhandene Hilfe `parseNonNegativeInteger` (`src/telephony/adapters/telnyx/cost-parse.js:48-55`) wandelt Text um und passt deshalb nicht.
- Sehr großes `offset` (etwa `1000000`): Entscheidung: 200 mit leerer Liste und `"remaining":0`; `remaining` kommt unverändert aus der Store-Abfrage, die Route rechnet es nicht selbst. Die Arbeit je Abruf wächst mit `offset`, bis zur Zahl aller Einträge des Tenants mal der Zahl aller Aufgaben (`src/store/state-ops.js:400-404`, `src/store/state-ops.js:415-419`); hingenommen, weil nur Aufrufer im Prozess die Route erreichen und `check_inbox` kein `offset` schickt (PM5).
- `offset` als Bruch (`1.5`) oder als Text (`"20"`) fällt unter dieselbe Regel R2 wie `-1` in S2; S2 nimmt `-1`, weil dort eine Umsetzung ohne Prüfung still eine falsche Seite liefert (`slice(-1)`).
- Bestehender Test `INBOX-P2 A5` prüft die Store-Optionen genau als `{ limit: 20, includeSeen }`: Entscheidung: ohne `offset` übergibt die Route weiter genau diese Optionen; der Test bleibt unverändert.

## Geänderte Dateien
- `src/routes/api-inbox.js`
- `test/posteingang/posteingang-poll.test.js`

## Altfunktionen
- nicht berührt: `src/mcp-tools.js:registerTools`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; `check_inbox` ist nur Beleg, dass kein `offset` geschickt wird (Nicht-Ziel)
- nicht berührt: `src/store/pg.js:makePgStore`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; der Postgres-Store ist nur Beleg, dass er dieselbe Store-Funktion ruft
- nicht berührt: `src/store/state-ops.js:callActionItems`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; die Funktion ist nur Beleg für den Aufwand je Ansicht (PM5, T2)
- nicht berührt: `src/telephony/adapters/telnyx/cost-parse.js:parseNonNegativeInteger`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; die Funktion ist nur Beleg, dass die vorhandene Hilfe Text umwandelt und nicht passt
- nicht berührt: `src/telephony/call-finish.js:finishCall`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; die Funktion ist nur Beleg, wann ein Anruf Eintrag wird (PM7)
- nicht berührt: `src/wiring/internal-only.js:internalOnly`, weil die Änderung nur in `src/routes/api-inbox.js` liegt; die Funktion ist nur Beleg, dass die Route nur im Prozess erreichbar ist

## Anforderungen

### Regel R1: Mit `include_seen:true` liefert die Rückschau die Einträge ab der Stelle `offset`, und `remaining` zählt die Einträge hinter dieser Seite.

#### Szenario S1: Zweite Seite der Rückschau
Gegeben ein Tenant mit 25 Posteingangs-Einträgen, die alle schon als gesehen markiert sind
Wenn er `POST /api/inbox/poll` mit `{"include_seen":true,"offset":20}` aufruft
Dann antwortet die Route mit Status `200`, `entries` enthält genau die 5 Einträge mit den jüngsten `startedAt`, aufsteigend sortiert, und `remaining` ist `0`

### Regel R2: Ein `offset`, das keine ganze Zahl ab 0 ist, wird mit `include_seen:true` abgelehnt.

#### Szenario S2: negatives offset wird abgelehnt
Gegeben ein Tenant mit 25 Posteingangs-Einträgen
Wenn er `POST /api/inbox/poll` mit `{"include_seen":true,"offset":-1}` aufruft
Dann antwortet die Route mit Status `400` und `{"error":"offset muss eine ganze Zahl ab 0 sein"}`

## Bleibt unverändert

### Szenario B1: offset ohne include_seen:true markiert nur die gelieferte Seite
Gegeben ein Tenant mit 25 Posteingangs-Einträgen, keiner als gesehen markiert
Wenn er `POST /api/inbox/poll` mit `{"include_seen":"true","offset":20}` aufruft
Dann antwortet die Route mit Status `200`, `entries` enthält die 20 Einträge mit den ältesten `startedAt`, `remaining` ist `5`, und ein folgender Aufruf mit `{}` liefert genau die 5 jüngsten Einträge

`include_seen` als Text `"true"` ist kein `include_seen:true` (`src/routes/api-inbox.js:13`); der Body deckt damit eine Route, die `offset` ganz ohne Bedingung liest, und eine, die `offset` unter einer lockereren Bedingung liest als die an den Store übergebene (Gegenprüfung G1).

Die Rückschau ohne `offset` (erste Seite, Store-Optionen genau `{ limit: 20, includeSeen: true }`) schützt der bestehende Test `INBOX-P2 A5` (`test/posteingang/posteingang-poll.test.js:208-226`); dafür entsteht kein eigenes Szenario.

## Nicht-Ziele
- Nicht Teil dieser Änderung: das Blättern für den Agenten des Kunden über MCP. `check_inbox` bekommt kein `offset`, weil `src/mcp-tools.js` für dieses Paket ausgeschlossen ist und eine Änderung am Werkzeugvertrag eine eigene Entscheidung über fremde Agenten wäre; bis dahin erreicht nur ein Aufrufer im Prozess die Einträge hinter den ersten 20.
- Nicht Teil dieser Änderung: eine stabile Fortsetzung über einen Cursor (`startedAt` und `id`), weil sie eine Änderung am Store bräuchte (PM6, PM7).
- Nicht Teil dieser Änderung: `offset` im verbrauchenden Abruf ohne `include_seen`, weil übersprungene Einträge sonst als gesehen markiert würden.
- Nicht Teil dieser Änderung: eine andere Seitengröße oder ein `limit` vom Aufrufer, weil die Seitengröße 20 die Antwortgröße für den MCP-Pfad begrenzt.

## Neue Begriffe
- `offset`: optionale ganze Zahl ab 0 im JSON-Body von `POST /api/inbox/poll`; nur mit `include_seen:true` wirksam, Stelle des ersten gelieferten Eintrags in der nach `startedAt` aufsteigend sortierten Liste.

## Offene Fragen

### Vor dem Bau zu klären
keine

### Kann warten
- Soll `check_inbox` ein `offset` bekommen, damit der Agent des Kunden über MCP blättern kann? Dann kommen PM5 (Arbeit wächst mit `offset`) und PM6/PM7 (verschobene Seiten) wieder auf den Tisch.

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil die Route hinter `internalOnly` steht und `check_inbox` kein `offset` schickt (`src/mcp-tools.js:1163-1167`), passiert für den Agenten des Kunden über MCP nach der Änderung nichts anderes, und die Folge ist, dass er bei `remaining` größer 0 weiter dieselben 20 Einträge bekommt. | Nicht-Ziel (Blättern über MCP), Problem und Ergebnis auf den Aufrufer der Route geschärft |
| PM2 | Weil eine Umsetzung `offset` auch ohne `include_seen:true` lesen könnte, passiert bei `{"offset":20}` oder `{"include_seen":"true","offset":20}` ein verbrauchender Abruf von 40 Einträgen, von denen nur 20 geliefert werden, und die Folge ist, dass 20 Anrufe als gesehen gelten, ohne dass jemand sie gesehen hat. | B1 |
| PM3 | Weil S2 nur einen Wert prüft, passiert bei `offset:-1` oder `1.5` mit einer Umsetzung, die nur den Typ prüft, still eine falsche Seite (`slice(-1)`), und die Folge ist, dass ein weiterblätternder Aufrufer Einträge überspringt. | S2 (auf `-1` umgestellt; `1.5` und `"20"` unter derselben Regel R2) |
| PM4 | Weil die Route `remaining` selbst rechnen könnte (Gesamtzahl minus `offset` minus geliefert), passiert hinter dem Ende ein negatives `remaining`, und die Folge ist eine Blätter-Schleife ohne Ende. | hingenommen: Die Grobe Lösung legt fest, dass `remaining` unverändert aus der Store-Abfrage kommt, und die Szenarien sind bewusst auf drei begrenzt; die Mutationsprüfung in `lauf` deckt eine eigene Rechnung der Route auf. |
| PM5 | Weil die Route `offset + 20` Einträge anfordert und jede Ansicht alle Aufgaben durchsucht (`src/store/state-ops.js:400-404`), passiert beim Blättern durch viele Einträge Arbeit, die mit `offset` wächst, und die Folge ist eine blockierte Ereignisschleife bei Tenants mit Tausenden Einträgen. | hingenommen: Nur Aufrufer im Prozess erreichen die Route, `check_inbox` schickt kein `offset`; Falle 3 berichtigt, Frage unter „Kann warten“. |
| PM6 | Weil der Retention-Lauf die ältesten Einträge vorn aus der Liste entfernt (`src/boot.js:736`), passiert zwischen zwei Seiten ein Verrutschen nach vorn, und die Folge ist, dass `offset` noch vorhandene Einträge still überspringt. | hingenommen: Eine stabile Fortsetzung bräuchte eine Änderung am Store, die die Absicht ausschließt (Nicht-Ziel Cursor). |
| PM7 | Weil ein Anruf erst nach seinem Ende Eintrag wird (`src/telephony/call-finish.js:225`) und nach `startedAt` einsortiert wird, passiert zwischen zwei Seiten ein Verrutschen nach hinten, und die Folge sind ein doppelter und ein fehlender Eintrag in einem Durchgang. | hingenommen: Der fehlende Eintrag ist ungesehen und kommt mit dem nächsten verbrauchenden Abruf; Cursor ist Nicht-Ziel. |
