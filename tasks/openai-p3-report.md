# P3-Bericht — securitySchemes an der SDK-Grenze (Weg B)

## Schritt 1 — Rohtext-Gegenprobe (woertlich, aus tasks/openai-p3-spec.md Abschnitt 0.1)

Quelle: `curl -sS -L https://developers.openai.com/apps-sdk/build/auth`
Abrufdatum: 2026-09-21. HTTP-Status: `200` (nach Redirect von
`https://developers.openai.com/plugins/build/auth`), 462552 Bytes.

Fundstelle 1 — vollstaendiger Tool-Deskriptor (JSON), `securitySchemes` steht top-level
zwischen `annotations` und `_meta`:

```json
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "openWorldHint": false
  },
  "securitySchemes": [
    {
      "type": "oauth2",
      "scopes": []
    }
  ],
  "_meta": {
    "openai/profile": true
  }
```

Fundstelle 2 — Fliesstext:

> "Describe each tool's auth policy with securitySchemes. Declaring securitySchemes per tool
> tells ChatGPT which tools require OAuth versus which can run anonymously. Stick to per-tool
> declarations even if the entire server uses the same policy; server-level defaults make it
> difficult to evolve individual tools later."
> "Two scheme types are available today, and you can list more than one to express optional auth:
> noauth ... oauth2 ... If you omit the array entirely, the tool inherits whatever default the
> server advertises."

Fundstelle 3 — TypeScript-Beispiel (`server.registerTool`-Konfig):

```ts
    securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
```

Folge: der Wert ist ein ARRAY von Schema-Objekten (nicht ein einzelnes Objekt, wie Plan und
P0 annahmen). Gebaut wird `[{ "type": "oauth2", "scopes": [] }]` (Widerspruch W1 in der Spec).

## Schritte 2-7 — Umsetzung und Belege

- `src/mcp-security-schemes.js` (neu): `applyToolSecuritySchemes(server)` reichert den
  privaten Original-Handler (`server.server._requestHandlers.get("tools/list")`) an,
  statt die Liste neu zu bauen; wirft laut statt still zu uebergehen, wenn der
  Original-Handler fehlt (E5).
- Verdrahtet an beiden Zusammenbau-Stellen: `src/routes/mcp.js` (HTTP, nach
  `registerTools(...)`, vor dem Transport) und `src/mcp-server.js` (stdio, nach
  `registerTools(...)`, vor dem Transport) - `grep -rn applyToolSecuritySchemes src/`
  liefert 5 Treffer (1 Definition + 2x Import + 2x Aufruf).
- `test/openai-p3-security-schemes.test.js` (neu), 6 Faelle, alle lesen rohes
  JSON-RPC-JSON (nie `client.listTools()`):
  1. Lerntest: registerTool() verwirft `securitySchemes` still; nach dem Override liegt
     das Feld im rohen Weg, nicht im typisierten (Messung B bestaetigt).
  2. Fehlender Original-Handler -> Wurf statt stillem Uebersprung (E5).
  3. Schritt 5 (HTTP `/mcp`): AC1 (Array `[{"type":"oauth2","scopes":[]}]` an allen 12
     Werkzeugen) + AC2 im selben Response (outputSchema-Bilanz 10/12, Widget-_meta von
     `place_call`, title/annotations/toolInvocation unveraendert).
  4. Schritt 6a (stdio, echtes SDK, InMemoryTransport): 10 Werkzeuge, securitySchemes an
     allen.
  5. Schritt 6b (ChatGPT-Adapter): securitySchemes liegt neben `openai/outputTemplate`.
  6. Schritt 7 (Naht-Pin): `src/mcp-server.js` verdrahtet den Override HINTER
     `registerTools()`. Gegenprobe gefahren: Aufrufzeile auskommentiert -> Test rot
     (`AssertionError: applyToolSecuritySchemes( kommt in src/mcp-server.js vor (nicht
     auskommentiert)`), danach zurueckgenommen (`git diff` leer). Wichtig: die Suche
     entfernt zuerst Kommentarzeilen, sonst faende reines `indexOf` den Aufruf auch dann
     noch, wenn er nur als Text im Kommentar steht (beim ersten Versuch tatsaechlich
     passiert und korrigiert - s. "selbstzweifel" der Ruecklieferung).

## Schritt 8 — Lint, Suite, Bilanz

- `npx eslint src/mcp-security-schemes.js src/routes/mcp.js src/mcp-server.js
  test/openai-p3-security-schemes.test.js` -> 0 Probleme (keine Ausgabe zu diesen vier
  Dateien; der volle `eslint .`-Lauf im Pre-Commit-Hook zeigt nur Bestandswarnungen in
  unveraenderten Dateien, 0 Errors).
- `npm test -- -- --test-concurrency=4` (voller Lauf, isoliert im Worktree
  `wt-p3`, symlink auf das Haupt-`node_modules`): `# tests 6186`, `# pass 6186`,
  `# fail 0`. Kein `not ok` in der vollstaendigen, ungekuerzten Ausgabe.
  Abweichung von der in der Spec genannten Baseline (6160 gruen) plus 6 neue Faelle
  (erwartet 6166): tatsaechlich 6186, Differenz 20 nicht erklaerbar ohne eine
  Baseline-Messung auf demselben master-Commit in diesem Worktree (nicht gefahren,
  Zeitgruende) - s. "abweichungen"/"selbstzweifel" der strukturierten Ruecklieferung.
  Kein `not ok` heisst: keine Regression, unabhaengig vom exakten Baseline-Wert.

## Schritt 9 — Restrisiko fuer den Deploy (Review-Korrektur)

Messung B (Spec 0.3) belegt nur: ein **SDK-basierter** Client (typisiert ueber `ToolSchema`)
sieht `securitySchemes` nicht, weil zod es beim Parsen strippt. Das ist NICHT dasselbe wie
"Risiko fuer den LIVE-Claude-Connector gemessen: null" — der claude.ai-Connector ist kein
Instanz dieses SDK-Clients und wurde nicht gemessen. Die Spec (0.3, Punkt 2) ist entsprechend
korrigiert. Kein Code-Fix noetig (der Override selbst ist protokoll-konform: das MCP-Schema
verbietet keine Zusatzfelder, OpenAI schreibt genau dieses Feld vor). Auflage fuer den ersten
Deploy: `tools/list` einmal ueber den echten claude.ai-Connector ansehen, bevor der Rollout
als abgeschlossen gilt.
