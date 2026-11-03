# Abo und Tarife

## Unterfunktionen

- Tarifkatalog lesen (`GET /api/plans`): öffentlich, ohne Anmeldung; nennt die buchbaren Tarife mit Preis und Leistungsumfang.
- Stripe-Ereignis annehmen (`POST /webhooks/stripe`): Stripe meldet, dass ein Abo beginnt, sich ändert oder endet; Hermes prüft die Signatur und schaltet das Konto des Kunden entsprechend.
- Nicht in dieser Karte: Abo buchen, kündigen, fortsetzen und Zahlungsstatus lesen unter `/api/self-service/billing/*`. Diese Routen brauchen eine Kundensitzung nach dem Web-Login, die hermes-ctl nicht aufbauen kann.

## Wie ein Nutzer hinkommt

Der Kunde sieht die Tarife auf der Preisseite und bucht über Stripe. Stripe ruft danach den Webhook von Hermes mit einer Signatur auf, die nur Stripe und Hermes kennen. Der Agent des Kunden merkt den Wechsel daran, dass `get_agent_status` den Verbrauch der Tarifminuten ausweist.

## Steuerung mit hermes-ctl

`intern plaene` liest den Tarifkatalog ohne Schlüssel. `webhook stripe` signiert das Ereignis nach dem Stripe-Schema (`t=…,v1=HMAC-SHA256`) mit dem Geheimnis der Sitzung; `--falsche-signatur` nimmt ein falsches Geheimnis. Das Rezept meldet ein aktives Abo für den Eigentümer der Sitzung (`owner`) und liest danach mit `get_agent_status`, dass der Verbrauch der Tarifminuten von „unbekannt“ auf 0 Prozent steht.

```json rezept
{
  "flaechen": [
    "GET /api/plans",
    "POST /webhooks/stripe"
  ],
  "schritte": [
    {
      "befehl": [
        "intern",
        "plaene"
      ],
      "erwarte": [
        {
          "pfad": "status",
          "gleich": 200
        },
        {
          "pfad": "koerper.0.slug",
          "gleich": "starter"
        },
        {
          "pfad": "koerper.1.slug",
          "gleich": "business"
        }
      ]
    },
    {
      "befehl": [
        "werkzeug",
        "get_agent_status",
        {}
      ],
      "merke": "vorher",
      "erwarte": [
        {
          "pfad": "ergebnis.planUsagePercent",
          "gleich": null
        }
      ]
    },
    {
      "befehl": [
        "webhook",
        "stripe",
        {
          "id": "evt_karte_abo_abgelehnt",
          "type": "customer.subscription.created",
          "data": {
            "object": {
              "id": "sub_karte_abo",
              "status": "active",
              "metadata": {
                "tenant_ref": "owner",
                "plan_slug": "starter"
              }
            }
          }
        },
        "--falsche-signatur"
      ],
      "erwarte": [
        {
          "pfad": "status",
          "gleich": 400
        },
        {
          "pfad": "koerper.error",
          "gleich": "invalid signature"
        }
      ]
    },
    {
      "befehl": [
        "werkzeug",
        "get_agent_status",
        {}
      ],
      "erwarte": [
        {
          "pfad": "ergebnis.planUsagePercent",
          "gleich": "{{vorher.ergebnis.planUsagePercent}}"
        }
      ]
    },
    {
      "befehl": [
        "webhook",
        "stripe",
        {
          "id": "evt_karte_abo_aktiv",
          "type": "customer.subscription.created",
          "data": {
            "object": {
              "id": "sub_karte_abo",
              "status": "active",
              "current_period_start": 1890864000,
              "current_period_end": 1893456000,
              "metadata": {
                "tenant_ref": "owner",
                "plan_slug": "starter"
              }
            }
          }
        }
      ],
      "erwarte": [
        {
          "pfad": "status",
          "gleich": 200
        },
        {
          "pfad": "koerper.received",
          "gleich": true
        }
      ]
    },
    {
      "befehl": [
        "werkzeug",
        "get_agent_status",
        {}
      ],
      "erwarte": [
        {
          "pfad": "ergebnis.planUsagePercent",
          "gleich": 0
        }
      ]
    }
  ]
}
```

## Stolperfallen

- Ein falsch signiertes Ereignis ändert nichts: Der zweite Statusaufruf zeigt weiter „unbekannt“. Erst das richtig signierte Ereignis stellt den Verbrauch auf 0 Prozent.
- Ein Ereignis ohne `tenant_ref` oder für einen unbekannten Mandanten nimmt Hermes mit 200 an und tut nichts; ein 200 allein beweist also keine Wirkung.
- Stripe-Ereignisse außerhalb von fünf Minuten Abstand zur Uhrzeit des Servers gelten als abgelaufen und werden mit 400 abgelehnt.
- Die Stripe-Attrappe der Sitzung antwortet auf Abfragen mit 503; Hermes meldet das im Log und aktiviert das Abo trotzdem.
