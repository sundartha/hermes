# Nummer und Status des Agenten

## Unterfunktionen

- Telefonnummer des Agenten lesen (`get_agent_number`).
- Stand des Agenten lesen (`get_agent_status`): Nummer, Inhaber, Zahl der Anrufe, Freigaben.

## Wie ein Nutzer hinkommt

Der Agent des Kunden ruft beide Werkzeuge über MCP auf, etwa um dem Kunden seine Hermes-Nummer zu nennen.

## Steuerung mit hermes-ctl

Beide Werkzeuge laufen über `werkzeug`; die Sitzung legt beim Start einen Eigentümer mit Nummer an.

```json rezept
{
  "flaechen": ["get_agent_number", "get_agent_status"],
  "schritte": [
    {
      "befehl": ["werkzeug", "get_agent_number", {}],
      "merke": "nummer",
      "erwarte": [{ "pfad": "ergebnis.number", "typ": "string" }]
    },
    {
      "befehl": ["werkzeug", "get_agent_status", {}],
      "erwarte": [
        { "pfad": "ergebnis.number", "gleich": "{{nummer.ergebnis.number}}" },
        { "pfad": "ergebnis.owner", "typ": "string" },
        { "pfad": "ergebnis.calls", "gleich": 0 }
      ]
    }
  ]
}
```

## Stolperfallen

- Die Nummer kommt aus dem Startbestand der Sitzung, nicht von Telnyx.
