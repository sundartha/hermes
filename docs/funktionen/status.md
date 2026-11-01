# Status der Datenbankanbindung

## Unterfunktionen

- Statusroute `GET /intern/status` lesen: meldet mit einem eigenen Nur-Lese-Schlüssel, ob die Datenbank binnen zwei Sekunden antwortet, und den laufenden Commit.

## Wie ein Nutzer hinkommt

Kein Kunde ruft die Route auf. Die Prüfung von außen (Better Stack, später OpenClaw) fragt sie jede Minute mit dem Schlüssel `HERMES_STATUS_TOKEN` und schlägt Alarm, wenn die Antwort 503 ist oder ausbleibt.

## Steuerung mit hermes-ctl

Der Befehl `intern` ruft die Route mit dem Schlüssel der Sitzung auf; hermes-ctl setzt ihn beim Start und gibt ihn nie aus.

```json rezept
{
  "flaechen": ["GET /intern/status"],
  "schritte": [
    {
      "befehl": ["intern", "status"],
      "erwarte": [
        { "pfad": "status", "gleich": 200 },
        { "pfad": "koerper.datenbank", "gleich": true },
        { "pfad": "koerper.commit", "typ": "string" }
      ]
    }
  ]
}
```

## Stolperfallen

- Fehlt der Schlüssel, ist er leer oder kürzer als 32 Zeichen, antwortet die Route jedem Aufruf mit 401.
- Der Schlüssel ist nicht der Deploy-Token und gilt nur für diese Route.
- Die Antwort enthält nie einen Fehlertext, nur ja oder nein und den Commit.
