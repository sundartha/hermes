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

## Schritte 2-8

Siehe `test/openai-p3-security-schemes.test.js` (Lerntest + HTTP-Beleg + stdio/ChatGPT-Adapter
+ Naht-Pin) und `src/mcp-security-schemes.js` (Implementierung). Verdrahtung in
`src/routes/mcp.js` und `src/mcp-server.js`. Testzahlen und Lint-Ergebnis siehe
strukturierte Rueckgabe des Agenten-Laufs.
