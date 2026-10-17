# Posteingang

## Unterfunktionen

- Neue Einträge abholen (`check_inbox`): Nachrichten und Ergebnisse, die seit der letzten Abfrage angekommen sind.
- Offene Aufgaben lesen (`list_action_items`).

## Wie ein Nutzer hinkommt

Der Agent des Kunden ruft beide Werkzeuge über MCP auf, etwa zu Beginn einer Sitzung.

## Steuerung mit hermes-ctl

Beide Werkzeuge laufen über `werkzeug`. Eine frische Sitzung hat keine Einträge; das Rezept prüft die leere Antwort in ihrer festen Form.

```json rezept
{
  "flaechen": ["check_inbox", "list_action_items"],
  "schritte": [
    {
      "befehl": ["werkzeug", "check_inbox", {}],
      "erwarte": [
        { "pfad": "ergebnis.entries", "gleich": [] },
        { "pfad": "ergebnis.remaining", "gleich": 0 }
      ]
    },
    {
      "befehl": ["werkzeug", "list_action_items", {}],
      "erwarte": [{ "pfad": "ergebnis.0.text", "gleich": "Keine offenen Action Items." }]
    }
  ]
}
```

## Stolperfallen

- Einträge entstehen heute vor allem aus eingehenden Anrufen und Nachrichten; hermes-ctl kann noch keinen eingehenden Anruf spielen. Das Rezept prüft deshalb nur den leeren Posteingang.
