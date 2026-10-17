# Anruf platzieren

## Unterfunktionen

- Anruf vorbereiten (`prepare_call`): Hermes prüft Ziel und Auftrag und gibt einen Bestätigungscode an die Hermes-Karte des Kunden.
- Anruf auslösen (`place_call`): nur mit dem bestätigten Code; Hermes startet das Gespräch über ElevenLabs.
- Stand und Ergebnis lesen (`get_call_status`, `list_calls`, `get_call_result`, Route `GET /api/calls/:id`).
- Anruf abbrechen (`cancel_call`).

## Wie ein Nutzer hinkommt

Der Agent des Kunden ruft über MCP (`POST /mcp`) `prepare_call` auf; der Kunde bestätigt in der Hermes-Karte, die Karte ruft `place_call` mit dem Code. Danach fragt der Agent den Stand ab, bis der Anruf endet, und liest das Ergebnis.

## Steuerung mit hermes-ctl

`bestaetigen` spielt die Hermes-Karte: Es ruft `prepare_call`, nimmt den Code aus `_meta` und ruft `place_call`. `anbieter elevenlabs-ende` lässt die ElevenLabs-Attrappe das Gespräch beenden; `zustand --warten-auf completed` wartet, bis Hermes das Ende abgeholt hat.

```json rezept
{
  "flaechen": [
    "prepare_call",
    "place_call",
    "get_call_status",
    "list_calls",
    "get_call_result",
    "cancel_call",
    "POST /mcp",
    "GET /api/calls/:id"
  ],
  "schritte": [
    {
      "befehl": ["bestaetigen", { "to": "+4915112345678", "objective": "Termin für Donnerstag vereinbaren" }],
      "merke": "anruf",
      "erwarte": [
        { "pfad": "call_id", "typ": "string" },
        { "pfad": "status", "gleich": "active" }
      ]
    },
    {
      "befehl": ["werkzeug", "get_call_status", { "call_id": "{{anruf.call_id}}" }],
      "erwarte": [
        { "pfad": "ergebnis.call_id", "gleich": "{{anruf.call_id}}" },
        { "pfad": "ergebnis.status", "gleich": "in_progress" }
      ]
    },
    {
      "befehl": ["werkzeug", "list_calls", {}],
      "erwarte": [
        { "pfad": "ergebnis.calls.0.id", "gleich": "{{anruf.call_id}}" },
        { "pfad": "ergebnis.calls.0.counterparty", "gleich": "+4915112345678" }
      ]
    },
    {
      "befehl": ["anbieter", "elevenlabs-ende", { "call_id": "{{anruf.call_id}}", "zusammenfassung": "Termin am Donnerstag um 15 Uhr vereinbart." }],
      "erwarte": [{ "pfad": "anbieter_status", "gleich": "done" }]
    },
    {
      "befehl": ["zustand", "{{anruf.call_id}}", "--warten-auf", "completed"],
      "erwarte": [{ "pfad": "status", "gleich": "completed" }]
    },
    {
      "befehl": ["werkzeug", "get_call_result", { "call_id": "{{anruf.call_id}}" }],
      "erwarte": [{ "pfad": "ergebnis.result_summary", "gleich": "Termin am Donnerstag um 15 Uhr vereinbart." }]
    },
    {
      "befehl": ["bestaetigen", { "to": "+4915112345679", "objective": "Lieferstand der Bestellung erfragen" }],
      "merke": "abbruch",
      "erwarte": [{ "pfad": "status", "gleich": "active" }]
    },
    {
      "befehl": ["werkzeug", "cancel_call", { "call_id": "{{abbruch.call_id}}" }],
      "erwarte": [{ "pfad": "ergebnis.0.text", "enthaelt": "\"status\": \"cancelled\"" }]
    },
    {
      "befehl": ["zustand", "{{abbruch.call_id}}"],
      "erwarte": [{ "pfad": "status", "gleich": "cancelled" }]
    }
  ]
}
```

## Stolperfallen

- Zwei Anrufe mit gleichem `objective` an dieselbe Nummer weist Hermes als Doppelung ab; jedes Rezept nimmt je Anruf einen eigenen Auftrag.
- Einen Post-Call-Webhook von ElevenLabs gibt es nicht; Hermes fragt den Konversationsstatus ab. Ohne `anbieter elevenlabs-ende` bleibt der Anruf aktiv.
- `cancel_call` antwortet mit Text, der JSON enthält; der Status steht deshalb in `ergebnis.0.text`.
