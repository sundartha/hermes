# briefing-bench

Misst, wie die Werkzeugtexte von `prepare_call`/`place_call` und die Server-Instructions auf
das **rufende** Chat-Modell wirken - das Modell, das die Anruf-Argumente befuellt. `convo-bench`
kann das nicht: es schreibt das Briefing direkt in den Anruf-Datensatz und liest diese Texte nie.

## Was das Werkzeug tut und was nie

- Holt `tools/list` und `instructions` ueber den echten stdio-Draht eines Checkouts
  (`src/mcp-server.js` als Kindprozess, `NODE_ENV=test`, `MCP_UI_ENABLED=true`). Der
  Kindprozess liest keine `.env`.
- Gibt dem Modell nur `prepare_call`/`place_call` samt Instructions und EINE Nutzer-Nachricht je
  Szenario, und wertet den Werkzeugwunsch aus.
- Fuehrt **nie** ein Werkzeug aus, spricht nie mit einem Hermes-Server, waehlt nie, sendet keine
  SMS und liest keine Produktionsdaten. Alle Nummern in den Szenarien sind erfunden.
- Echter Modus: nur die Messages-API von Anthropic mit `ANTHROPIC_API_KEY` (ueber
  `src/config.js`, also auch aus der lokalen `.env`). Kosten: 6 Szenarien x Laeufe x 2 Staende.

## Metriken (je Lauf, `metriken.mjs`)

| Metrik | Bedeutung | Abnahme alt gegen neu |
|---|---|---|
| `selbstnennung` | Markenname eines Chat-Modells in einem Freitext-Argument | neu = 0 |
| `erfunden` | Zahl, Uhrzeit oder Preis im Briefing, der nicht in der Nutzer-Nachricht steht | neu = 0 |
| `lueckeKorrekt` | Luecken-Szenarien: Luecke richtig behandelt (offen erklaert / "meldet sich" / nichts geschrieben) | neu >= alt |
| `verweigert` | kein Aufruf von `prepare_call`/`place_call` (Ablehnung oder Rueckfrage) | neu <= alt |

Die Muster sind Heuristiken. Der Bericht enthaelt deshalb je Lauf die rohen Argumente und den
Antworttext zur Sichtpruefung. Die drei Legitim-Szenarien (Arzttermin fuer die Mutter, drei
Friseure abtelefonieren, Vorstellungsgespraech verschieben) messen, ob eine Zweckregel
legitime Anrufe verweigern laesst.

## Attrappen-Modus (ohne Guthaben, deterministisch)

```
node scripts/briefing-bench/lauf.mjs snapshot --repo . --out /tmp/bb-neu.json
node scripts/briefing-bench/lauf.mjs run --tools /tmp/bb-neu.json --out /tmp/bb-sauber.json
node scripts/briefing-bench/lauf.mjs run --tools /tmp/bb-neu.json --out /tmp/bb-kontrolle.json --einschleusen selbstnennung
node scripts/briefing-bench/lauf.mjs vergleich --alt /tmp/bb-sauber.json --neu /tmp/bb-kontrolle.json
```

Der saubere Lauf ergibt 0 Befunde; jede Einschleusung (`selbstnennung`, `erfindung`,
`verweigerung`) muss anschlagen und den Vergleich durchfallen lassen (Exit 2). Das haelt
`test/briefing-bench.test.js` fest.

## Deploy-Vorbedingung: echte Messung alt gegen neu

1. Alten Stand bereitstellen, ohne den Arbeitsbaum anzufassen:
   `mkdir /tmp/bb-alt && git archive 288376b src elevenlabs package.json | tar -x -C /tmp/bb-alt && ln -s "$PWD/node_modules" /tmp/bb-alt/node_modules`
2. Schnappschuesse: `snapshot --repo /tmp/bb-alt --out /tmp/bb-alt.json` und
   `snapshot --repo . --out /tmp/bb-neu.json`.
3. Je Stand `run --modus anthropic --modell <modell-id> --laeufe 5 --tools <schnappschuss> --out <bericht>`,
   gleiches Modell, gleiche Laeufe.
4. `vergleich --alt <bericht-alt> --neu <bericht-neu>`: `erfuellt: true` ist die Freigabe.

## Rueckbau, falls die Messung verfehlt

Die Textaenderung ist nicht in einem einzelnen Commit revertierbar: Draht-Scan-Test, Pins und
Doku-Zitate haengen am neuen Wortlaut. Zurueckzunehmen sind gemeinsam:

- Texte: `src/mcp-tools.js` (Beschreibungen von `place_call`, `prepare_call`, `briefing`,
  `context` samt Unterfeldern, `on_out_of_scope`) und `src/mcp-server-info.js`
  (`CALL_PURPOSE_RULE`, Reihenfolge in `MCP_BASE_INSTRUCTIONS`).
- Tests: `test/openai-t2-16-place-call-texte.test.js`, die Anker in
  `test/p15-mcp-tool-descriptions-en.test.js`, `test/gq-b1-briefing-openness.test.js`,
  `test/elevenlabs-anrufstart.test.js` und der Hash-Pin in `test/openai-p8-widget-ui.test.js`.
- Doku: Zitate und Zeilenanker in `docs/OPENAI-POLICY-ABGLEICH.md` und
  `docs/OPENAI-TOOL-INVENTORY.md`.

Danach `npm test`: rote Pins zeigen jede vergessene Stelle.
