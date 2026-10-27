# P-013 Rückschau im Posteingang mit offset: Design Doc

Status: freigegeben
Freigabe: Sitzung P013 als Entscheider im Auftrag der Betreuung, 27.10.2026 (Halt H3 in Issue #2223)
Pitch: plaene/P-013-rueckschau-offset/pitch.md
Entscheidung: kein Design Doc (Pitch „Design Doc: nein“); dieses Dokument trägt nur die Ausgangslage.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: keine Prüfung „ganze Zahl ab 0“ für Werte aus einem JSON-Body einer Route; `parseNonNegativeInteger` wandelt auch Text um und passt deshalb nicht | `node tools/auftrag.mjs suche offset`: nur Website und Hooks, kein Blättern in `src/`; `grep -rn "Number.isSafeInteger" src`: `src/telephony/adapters/telnyx/cost-parse.js:48-55`, `src/elevenlabs/kosten-beleg.js:24` (Anbieter-Antworten, kein Routen-Body) | – |
| Die Route übergibt immer `limit: INBOX_MAX_ENTRIES` (20) und liest `include_seen` nur bei genau `true` | `src/routes/api-inbox.js:4`, `src/routes/api-inbox.js:13-17` | – |
| Der Store sortiert aufsteigend nach `startedAt`, schneidet `slice(0, limit)` und zählt `remaining` als Kandidaten minus gelieferte | `src/store/state-ops.js:406-421` | – |
| Ohne `include_seen` markiert der Store jeden gelieferten Eintrag als gesehen | `src/store/state-ops.js:414-418` | – |
| JSON- und Postgres-Store rufen dieselbe Funktion | `src/store/json.js:350-351`, `src/store/pg.js:182-183` | – |
| Das MCP-Werkzeug `check_inbox` schickt nur `include_seen` | `src/mcp-tools.js:1163-1167` | – |
| Die Route steht hinter `internalOnly` | `src/routes/api-inbox.js:10` | – |
| Bestehender Test prüft die Store-Optionen ohne `offset` genau als `{ limit: 20, includeSeen }` | `test/posteingang/posteingang-poll.test.js:208-226` (`INBOX-P2 A5`) | – |
| Testhilfen für den echten Eingang: `poll` (lokal), `startServer`, `seedState`, `seedCall` | `test/posteingang/posteingang-poll.test.js:93-99`, Import aus `test/helpers.js` (`test/posteingang/posteingang-poll.test.js:5`) | – |
