# P-2879 Sauberes Stoppen: Design Doc

Status: freigegeben
Pitch: plaene/P-2879-sauberes-stoppen/pitch.md
Entscheidung: kein Design Doc (nur Ausgangslage), weil es nur einen ernsthaften Weg gibt und ein Revert die Änderung ganz zurücknimmt.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: nichts gefunden | `node tools/auftrag.mjs suche "in-flight"`: nur der Logtext in `src/abschalten.js:14` und die Zeile im Test `test/graceful-shutdown.test.js:93`; `node tools/auftrag.mjs suche "offene Anfragen"`: keine Treffer | – |
| Die Weiche für „von außen“ ist `isTrustedLocalCaller` (lokaler Socket und kein `X-Forwarded-For`) | `src/routes/_tenant.js:9` | Der Außenschutz müsste eine zweite Stelle bekommen (nicht gewollt) |
| `numEnv` kürzt einen Wert über dem Deckel auf den Deckel, es lehnt ihn nicht ab | `src/config.js:62` | S5 wäre prüfbar |
| Der interne MCP-Sprung geht per `fetch` auf `resolveGatewayUrl()` | `src/mcp-tools.js:35`, `src/config.js:966-970` | – |
| `place_call` macht zwei interne Sprünge nacheinander (`/api/call-confirmations`, `/api/calls`) | `src/mcp-tools.js:959-967` | S1 braucht ein anderes Werkzeug |
| Der JSON-Speicher hat kein wartendes `drainFlushes` (leer), der Postgres-Speicher wartet auf `flushChain` | `src/store/json.js:249`, `src/store/pg.js:70-80` | – |
| Render beendet nach `maxShutdownDelaySeconds` mit SIGKILL; Standard 30 s, Höchstwert 300 s; Dienste mit persistenter Disk können den Wert nicht ändern | https://render.com/docs/deploys (Abschnitt Shutdown delay); `render.yaml` hat am Dienst `vodafone-agent` keinen Eintrag `disk` | Ein Wert über 30 s in `render.yaml` hätte keine Garantie; deshalb bleibt es bei 25000 |
| `maxShutdownDelaySeconds` gilt auch für den Plan `free` des Dienstes | ungeprüft; deshalb setzt dieses Paket den Wert nicht und bleibt mit 25 s unter dem Standard von 30 s | höhere Werte kommen erst nach einem Beleg von Render |
