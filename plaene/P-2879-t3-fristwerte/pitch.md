# P-2879 Sauberes Stoppen: Teil t3 fristwerte

Status: freigegeben
Issue: 2897
Teil von: P-2879-sauberes-stoppen; nach: P-2879-t1-frist-kette, P-2879-t2-abschaltweiche
Design Doc: nein, weil es nur einen ernsthaften Weg gibt und ein Revert die Änderung ganz zurücknimmt; die Frist-Kette steht unter „Grobe Lösung“.
Feste Sätze für a1 und a2 (der Zähler und die Teilfrist gehören zu a1, die Gesamtfrist zu a2, die Logzeilen zu beiden): (1) „Eine Anfrage zählt vom Eingang der Kopfzeilen bis zum Ende der Antwort.“ (2) „Teilfrist für das Warten auf den Zähler = 80 % der Gesamtfrist.“ (3) Die `[shutdown]`-Logzeilen enthalten nur Zahlen und feste Texte, nie Pfade, Rufnummern oder Anruf-Kennungen. (4) Das Testgerüst `test/abrechnung/server-mit-testdatenbank.js` bleibt unverändert (gilt für a2).
Wortlaut der festen Sätze für `wasDarfNiePassieren` (als ganzer Satz, ohne Listenzeichen „-“ und ohne Nummer „2.“, aber mit den Fettdruck-Zeichen, wie sie im Abschnitt stehen): zu (1) „**Zähler offener Anfragen.** Eine Anfrage zählt vom Eingang der Kopfzeilen bis zum Ende der Antwort.“ aus `## Grobe Lösung`; zu (2) „Teilfrist für das Warten auf den Zähler = 80 % der Gesamtfrist, bei 25000 also 20 s.“ aus `## Grobe Lösung`; zu (3) „Neue Logzeilen (`[shutdown] …`): Angriffswege: keiner, weil sie nur Zahlen und feste Texte enthalten (Pitch, Neue Begriffe) und durch die zentrale Log-Maske laufen (SG-13).“ aus `sicherheit.md`, `### Eingänge und Grenzen`; zu (4), nur für a2, „Entscheidung: S4 läuft über den echten Server mit Postgres-Speicher im Gerüst `test/abrechnung/server-mit-testdatenbank.js` (PGlite), dessen Pool nach dem Signal nicht mehr antwortet; das Gerüst wird genutzt, nicht geändert.“ aus `## Fallen`, ohne Listenzeichen.
Zuordnung der Dateien: Der Zähler offener Anfragen und die Teilfrist werden in `src/abschalten.js` am übergebenen `httpServer` eingerichtet (Ereignis `request`, Herunterzählen beim Ende der Antwort), damit sie ab den Kopfzeilen zählen; `src/app.js` gehört zur Abschaltweiche (S2) und ändert sich für die Frist-Kette nicht.
Zuordnung zur Teilung: S1 gehört in denselben Teil wie S2 oder in einen späteren, weil der Server nach dem Signal nur dann weiter Verbindungen annehmen darf (S1), wenn die Abschaltweiche Anfragen von außen abweist (S2); sonst wäre der Außenschutz aufgeweicht (Absicht, letzter Satz). Die Werte aus S5 gehören in den letzten Teil, damit eine Gesamtfrist von 25 s nicht mit dem alten Watchdog ohne Flush ausgeliefert wird.

## Absicht
Beim Stoppen (SIGTERM) bleibt der Server für laufende interne MCP-Sprünge erreichbar, bis keine Anfrage mehr offen ist; neue Anfragen von außen werden sofort abgewiesen, auch solche über den Proxy mit `X-Forwarded-For`. Danach läuft der letzte Store-Flush auch dann, wenn das Warten auf offene Anfragen seine Teilfrist überschreitet, und läuft die Gesamtfrist ab, endet der Prozess mit Code 1 und einer Logzeile statt mit Code 0. Der Deckel für `SHUTDOWN_DRAIN_TIMEOUT_MS` steigt von 30 s auf 110 s; `render.yaml` setzt 25 s und lässt `maxShutdownDelaySeconds` unberührt, bis bei Render belegt ist, dass der Wert dort gilt. Nicht gewollt ist ein aufgeweichter Außenschutz oder ein übersprungener Flush; im Zweifel gewinnt der Flush vor dem Warten.

## Problem
Render schickt beim Deploy SIGTERM an den laufenden Dienst. Ein Agent des Kunden hat gerade `place_call` aufgerufen: der erste interne Sprung (`/api/call-confirmations`) ist durch, der zweite (`/api/calls`) steht noch aus. Heute hat der Prozess die Verbindungsannahme sofort geschlossen, der zweite Sprung scheitert mit einem Verbindungsfehler, und der Kunde bekommt einen Fehler, obwohl die Bestätigung gültig war. Hängt eine Anfrage, beendet der Watchdog nach 8 s den Prozess mit Code 0 und ohne den letzten Flush, ohne dass eine Logzeile es sagt.

## Ergebnis
Nach diesem Stopp-Verhalten beenden laufende MCP-Aufrufe samt allen internen Sprüngen ihre Arbeit, bevor der Prozess endet; neue Anfragen von außen bekommen `503` mit `Retry-After: 5`; der letzte Flush läuft in jedem Fall nach spätestens 80 % der Gesamtfrist (bei 25 s also nach 20 s), und bleibt er hängen, endet der Prozess nach Ablauf der Gesamtfrist mit Code `1` und der Logzeile `[shutdown] Gesamtfrist abgelaufen - Exit 1`.

## Grobe Lösung
Der Kunde merkt beim Deploy nichts mehr: sein `place_call` endet mit `dialing`, auch wenn das Signal zwischen den beiden internen Sprüngen eintrifft. Von außen kommende Anfragen (Telnyx, Browser, Proxy) bekommen ab dem Signal sofort `503`, `Retry-After: 5` und `Connection: close`, damit ein Anbieter oder die zweite Instanz neu versucht, statt in einen toten Port zu laufen.

Teile, die zusammenspielen:
1. **Außenschutz.** Ab dem Signal entscheidet die bestehende Weiche `isTrustedLocalCaller` (lokaler Socket und kein `X-Forwarded-For`) über jede neue Anfrage: lokal heißt angenommen, alles andere `503`. Es gibt keine zweite Stelle, die „von außen“ beantwortet. `/healthz` von außen gehört dazu.
2. **Zähler offener Anfragen.** Eine Anfrage zählt vom Eingang der Kopfzeilen bis zum Ende der Antwort. Der äußere MCP-Aufruf bleibt offen, solange seine internen Sprünge laufen, deshalb steht der Zähler zwischen zwei Sprüngen nicht auf 0. Abgewiesene Anfragen zählen nicht.
3. **Frist-Kette.** Gesamtfrist = `SHUTDOWN_DRAIN_TIMEOUT_MS` (Default bleibt 8000, Deckel 110000, in `render.yaml` 25000). Teilfrist für das Warten auf den Zähler = 80 % der Gesamtfrist, bei 25000 also 20 s. Die übrigen 5 s gehören dem letzten Flush. `maxShutdownDelaySeconds` bleibt ungesetzt und damit bei dem Standard von 30 s, den Render laut Doku hat; die Gesamtfrist liegt 5 s darunter. Höhere Werte kommen erst, wenn bei Render belegt ist, dass `maxShutdownDelaySeconds` auf dem Plan `free` gilt (PM5).
4. **Ablauf.** Signal → Außenschutz an, offene Langläufer freigeben (wie heute) → warten, bis der Zähler 0 ist → Server schließen → letzter Flush → Exit `0`. Läuft die Teilfrist ab, bevor der Zähler 0 ist, werden die offenen Anfragen abgebrochen, die Logzeile `[shutdown] Teilfrist abgelaufen - <n> offene Anfragen abgebrochen` nennt ihre Zahl, und der Flush läuft trotzdem; sauberer Flush heißt Exit `0` und die Logzeile `[shutdown] Finaler Store-Flush abgeschlossen`, ein Flush-Fehler Exit `1` wie heute. Abgebrochene Anfragen allein machen kein Exit `1`. Läuft die Gesamtfrist ab, bevor der Flush fertig ist, steht die Logzeile `[shutdown] Gesamtfrist abgelaufen - Exit 1`, und der Prozess endet mit `1`.
5. **Später.** `boss.stop` (K1) kommt als weiterer Schritt vor dem Flush dazu und braucht dieselbe Teilfrist.

## Fallen
- Die Dienstkonfiguration `src/config.js` wird gerade von KFZ (#2306) zerlegt: Der Schlüssel `shutdownDrainTimeoutMs` mit der Variable `SHUTDOWN_DRAIN_TIMEOUT_MS` landet nach dem Merge in `src/konfiguration/`. Entscheidung: der Plan nennt die Stelle über den Schlüsselnamen, nicht über die Zeile.
- `numEnv` kürzt einen Wert über dem Deckel auf den Deckel, es lehnt ihn nicht ab (`src/config.js:62`). Entscheidung: kein Szenario für Werte über dem Deckel (Wartezeit über 110 s in Testzeit nicht beobachtbar); S5 prüft die gesetzten Werte.
- Der JSON-Speicher schreibt synchron und `drainFlushes` ist dort leer (`src/store/json.js:249`). Entscheidung: S4 läuft über den echten Server mit Postgres-Speicher im Gerüst `test/abrechnung/server-mit-testdatenbank.js` (PGlite), dessen Pool nach dem Signal nicht mehr antwortet; das Gerüst wird genutzt, nicht geändert.
- Render gibt `maxShutdownDelaySeconds` nur Diensten ohne persistente Disk (Doku Deploys); `vodafone-agent` hat keinen `disk`-Eintrag in `render.yaml`. Entscheidung: `maxShutdownDelaySeconds` wird in diesem Paket nicht gesetzt, die Gesamtfrist bleibt unter dem Standard von 30 s.
- Ein Bestätigungscode gilt heute nur innerhalb eines Prozesses einmal; ein erneuter `place_call` nach einem abgebrochenen Aufruf (PM3) kann auf einer neuen Instanz denselben Code noch einmal verwenden. Entscheidung: das ist der Gegenstand von S2a (Bestätigungscodes in der Datenbank, #2869) und nicht Teil dieser Änderung.
- Die Anrufpause wirkt heute nicht verlässlich über zwei Instanzen hinweg. Entscheidung: das behebt ein eigener, vorher gebauter Fehler und nicht diese Änderung; `docs/RUNBOOK-LAB-LIVE.md` nennt die Anrufpause als ersten Schritt eines Notaus, weil ein Notaus über `OUTBOUND_FROZEN` im alten Prozess nach dem Signal nicht wirkt.
- Bestehende Tests rufen `makeGracefulShutdown` mit `fakeHttpServer` (nur `close` und `closeIdleConnections`) und `FAKE_CONFIG` auf (`test/graceful-shutdown.test.js:164-202`). Entscheidung: die Signatur bleibt so verwendbar; diese Tests ändern sich nicht.
- Der Test „SIGTERM mit haengendem Request: Watchdog erzwingt exit 0, ohne den finalen Store-Flush zu erreichen“ beschreibt das alte Verhalten (Exit `0`, kein Flush). Entscheidung: S3 und S4 ersetzen ihn; die Erwartung ändert sich absichtlich, die Testschutz-Freigabe (Label `verhalten-geaendert`) gibt der unabhängige Prüf-Agent.

## Geänderte Dateien
- `src/abschalten.js`
- `src/abschaltweiche.js`
- `src/boot.js`
- `src/app.js`
- `src/config.js`
- `.env.example`
- `render.yaml`
- `docs/RUNBOOK-LAB-LIVE.md`
- `docs/sicherheitsgrenzen.md`
- `test/graceful-shutdown.test.js`

## Altfunktionen
- nicht berührt: `src/mcp-tools.js:registerTools`, weil die Änderung dort nichts ändert; `place_call` ist nur der Eingang, an dem S1 die Sprünge beobachtet.
- nicht berührt: `src/mcp-tools.js:anonym ab Zeile 961`, weil die Änderung dort nichts ändert; die Reihenfolge der beiden Sprünge bleibt, nur der Server bleibt dafür erreichbar.
- nicht berührt: `src/routes/api-calls.js:makeCallRoutes`, weil die Gate-Kette und der Wählauftrag unverändert bleiben; die Änderung liegt in `src/abschalten.js`.
- nicht berührt: `src/routes/api-calls.js:anonym ab Zeile 233`, weil die Gate-Kette und der Wählauftrag unverändert bleiben.
- nicht berührt: `src/routes/mcp.js:anonym ab Zeile 89`, weil die Anmeldung auf den Kopfzeilen unverändert bleibt.
- nicht berührt: `src/routes/voice.js:makeVoiceRoutes`, weil die Signaturprüfung und die Telnyx-Wege unverändert bleiben.
- nicht berührt: `src/routes/voice.js:anonym ab Zeile 376`, weil die Übernahme eines Anrufs durch eine neue Instanz Sache von S13 ist.
- nicht berührt: `src/store/pg.js:makePgStore`, weil der Speicher unverändert bleibt; die Änderung ruft nur seinen vorhandenen Flush später auf.
- nicht berührt: `src/store/pg.js:attachActiveCallRow`, weil der Speicher unverändert bleibt.
- nicht berührt: `src/wiring/internal-only.js:internalOnly`, weil die Weiche für interne Wege unverändert bleibt; die Abschaltweiche nutzt `isTrustedLocalCaller` aus `src/routes/_tenant.js` und nicht diese Funktion.

## Anforderungen

### Regel R1: Ein MCP-Aufruf über `POST /mcp`, der beim Signal läuft, endet samt interner Sprünge erfolgreich.

### Regel R2: Neue Anfragen von außen werden ab dem Signal sofort abgewiesen.

### Regel R3: Der letzte Flush läuft auch, wenn die Teilfrist abläuft.

### Regel R4: Läuft die Gesamtfrist ab, endet der Prozess mit Code 1.

### Regel R5: Die Werte der Frist-Kette stehen in Konfiguration und Doku.

#### Szenario S5: Werte aus `render.yaml`
Gegeben die Werte aus `render.yaml` für den Dienst `vodafone-agent`
Wenn der Server mit dieser Konfiguration startet
Dann beträgt die Gesamtfrist 25000 ms und der Deckel 110000 ms, `.env.example` und `docs/RUNBOOK-LAB-LIVE.md` nennen 25 s, und das Runbook nennt die Anrufpause als ersten Schritt eines Notaus

## Bleibt unverändert

## Nicht-Ziele
- Nicht Teil dieser Änderung: `boss.stop` (K1), weil es mit dem Auftragssystem kommt und eine eigene Abnahme hat.
- Nicht Teil dieser Änderung: zwei Instanzen (S13), weil die Zahl der Instanzen ein eigenes Paket ist.
- Nicht Teil dieser Änderung: laufende Anrufe zu Ende führen, weil die Frist eine Gesprächsdauer nicht deckt; ein Anruf endet beim Deploy wie heute.
- Nicht Teil dieser Änderung: eine Prüfung der Werte in `render.yaml` gegeneinander, weil sie ein eigenes Paket (B11) ist.
- Nicht Teil dieser Änderung: der stdio-MCP-Server (`npm run mcp`), weil er ein eigener lokaler Prozess ist und seinen äußeren Aufruf nicht im Zähler hat; R1 gilt nur für `POST /mcp` über HTTP.
- Nicht Teil dieser Änderung: Sicherungen (Max-Dauer-Timer, Geld-Wache, Reservierung) eines Anrufs, der nach dem Signal im alten Prozess startet, an die neue Instanz zu übergeben, weil das zum Paket S13 gehört.
- Nicht Teil dieser Änderung: Verhalten, wenn Render `maxShutdownDelaySeconds` auf dem Plan `free` nicht anwendet, weil kein Eingang in `test/` es herstellt; höhere Werte als 25000 in `render.yaml` und ein gesetztes `maxShutdownDelaySeconds` kommen erst, wenn bei Render belegt ist, dass der Wert dort gilt.
- Nicht Teil dieser Änderung: ein Szenario für Werte über dem Deckel von 110 s, weil `numEnv` darüber hinaus kürzt und die Wartezeit in Testzeit nicht beobachtbar ist.

## Neue Begriffe
- Teilfrist: 80 % der Gesamtfrist (bei 25 s: 20 s), bis zu der der Server auf offene Anfragen wartet.
- Gesamtfrist: `SHUTDOWN_DRAIN_TIMEOUT_MS`, die Zeit vom Signal bis zum Ende des Flush.
- `Retry-After: 5`: Header der `503`-Antwort beim Stoppen, fester Wert in Sekunden.
- Logzeilen `[shutdown] Teilfrist abgelaufen - <n> offene Anfragen abgebrochen`, `[shutdown] Finaler Store-Flush abgeschlossen` und `[shutdown] Gesamtfrist abgelaufen - Exit 1`.

## Offene Fragen

### Vor dem Bau zu klären
- Ist S4 über einen echten Eingang erreichbar (Postgres-Speicher mit nicht antwortender Datenbank)? Empfehlung: Der Planer prüft das; gibt es keinen echten Eingang, entfällt der Test und die Phase trägt die Begründung „nicht erreichbar, weil der Flush im JSON-Speicher synchron ist“.

- keine

### Kann warten
- keine

## Premortem
| Nr. | Grund | Ausgang |
|---|---|---|
| PM1 | Weil beide internen Sprünge von `place_call` zwei aufeinanderfolgende `await` im selben Prozess sind (`src/mcp-tools.js:963`) und kein Eingang dazwischen anhalten kann, prüft ein Test mit „erster Sprung fertig, zweiter noch nicht“ entweder durch einen Eingriff in den Code oder zu einem anderen Zeitpunkt, und der Fehler, dass der Zähler zwischen den Sprüngen auf 0 fällt, bleibt unentdeckt. | S1 umgeschrieben: Kopfzeilen vor dem Signal, Rumpf danach |
| PM2 | Weil eine Anfrage „bis zum Ende der Antwort“ zählt und eine Gegenseite die Verbindung vorher schließen kann, wird der Zähler nie heruntergezählt, und jeder Stopp wartet die volle Teilfrist und schreibt fälschlich „Teilfrist abgelaufen“. | B3 |
| PM3 | Weil die Teilfrist nur die Verbindung abbricht und der Handler von `/api/calls` weiterläuft (`src/routes/api-calls.js:314-344`), klingelt der Anruf, während der Kunde einen Abbruch sieht, ruft `place_call` erneut auf, und es entsteht ein zweiter echter Anruf bei derselben Person. | hingenommen: vorgeschlagen, zur Freigabe (siehe Freigabeliste): das Fenster besteht heute schon, denn der Watchdog bricht nach 8 s ab; mit der längeren Teilfrist wird es kleiner. |
| PM4 | Weil R1 Anrufe zulässt, die erst nach dem Signal im alten Prozess starten, hängen Max-Dauer-Timer, Geld-Wache und Reservierung an diesem Prozess (`src/telephony/call-lifecycle.js:119-131`), und die neue Instanz kennt diesen Anruf nicht. | Nicht-Ziel (S13) und hingenommen: vorgeschlagen, zur Freigabe; berührt die Gates aus Absoluter Regel 1, deshalb Bestätigung des Owners nötig. |
| PM5 | Weil der Dienst auf `plan: free` läuft und `maxShutdownDelaySeconds` dort möglicherweise nicht gilt, würde ein höherer Wert in `render.yaml` als der Standard von 30 s nicht greifen, Render beendet den Prozess nach rund 30 s mit SIGKILL, der Flush läuft nie, und Transkripte gehen verloren. | Nicht-Ziel: `render.yaml` bleibt bei 25000 und setzt `maxShutdownDelaySeconds` nicht (Entscheidung der Betreuung 03.11.2026) |
| PM6 | Weil der Prozess den Port bis zu 20 s offen hält und `503` antwortet, kann der Proxy von Render das `503` weiterreichen, und Telnyx beachtet `Retry-After` nicht, sodass ein Anrufer bis zu 25 s lang statt höchstens 8 s nicht durchkommt. | hingenommen: vorgeschlagen, zur Freigabe (Betreuung 03.11.2026: ja); der Preis mit den neuen 25 s kommt in `docs/RUNBOOK-LAB-LIVE.md` |
| PM7 | Weil der stdio-MCP-Server ein eigener Prozess ist und seinen äußeren Aufruf nicht im Zähler hat, kann der Server zwischen den Sprüngen schließen. | Nicht-Ziel (stdio); R1 auf `POST /mcp` über HTTP eingeschränkt |
| PM8 | Weil abgebrochene Handler nach der Teilfrist weiterlaufen, wird die Buchung des Verbrauchs eines Sprachmodell-Aufrufs, der nach Beginn des Flush antwortet, nicht mehr gespeichert (`src/precall-briefing.js:210`). | hingenommen: vorgeschlagen, zur Freigabe |
