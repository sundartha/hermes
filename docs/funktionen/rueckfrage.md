# Rückfrage und Recherche im Gespräch

## Unterfunktionen

- Recherche (`POST /webhooks/elevenlabs/lookup`): Der ElevenLabs-Agent fragt während des Gesprächs eine Information nach; Hermes sucht über Exa.
- Rückfrage (`POST /webhooks/elevenlabs/consult`): Der ElevenLabs-Agent stellt dem Kunden eine Frage und hält das Gespräch, bis die Antwort kommt.
- Ereignis abholen (`await_call_event`) und Rückfrage beantworten (`answer_consult`) durch den Agenten des Kunden.

## Wie ein Nutzer hinkommt

Während eines laufenden Anrufs ruft ElevenLabs die beiden Webhooks mit dem Werkzeug-Token auf. Der Agent des Kunden wartet mit `await_call_event`, bekommt das Ereignis `consult` und antwortet mit `answer_consult`; Hermes gibt die Antwort im noch offenen Webhook an ElevenLabs zurück.

## Steuerung mit hermes-ctl

`webhook elevenlabs-lookup` und `webhook elevenlabs-consult` senden mit gültigem Token. Weil der Rückfrage-Webhook bis zur Antwort offen bleibt, laufen `await_call_event` und der Webhook im Hintergrund; das Rezept wartet zuerst das Ereignis ab, beantwortet es und prüft dann die Antwort des Webhooks.

```json rezept
{
  "flaechen": [
    "await_call_event",
    "answer_consult",
    "POST /webhooks/elevenlabs/consult",
    "POST /webhooks/elevenlabs/lookup"
  ],
  "schritte": [
    {
      "befehl": ["bestaetigen", { "to": "+4915112345678", "objective": "Tisch für Freitagabend reservieren" }],
      "merke": "anruf",
      "erwarte": [{ "pfad": "status", "gleich": "active" }]
    },
    {
      "befehl": ["webhook", "elevenlabs-lookup", { "conversation_id": "{{anruf.conversation_id}}", "query": "Öffnungszeiten Restaurant am Markt" }],
      "erwarte": [
        { "pfad": "status", "gleich": 200 },
        { "pfad": "koerper.status", "gleich": "ok" }
      ]
    },
    {
      "befehl": ["werkzeug", "await_call_event", { "call_id": "{{anruf.call_id}}" }],
      "hintergrund": "ereignis"
    },
    {
      "befehl": ["webhook", "elevenlabs-consult", { "conversation_id": "{{anruf.conversation_id}}", "question": "Passt Freitag um 19 Uhr?" }],
      "hintergrund": "rueckfrage"
    },
    {
      "abwarten": "ereignis",
      "merke": "ereignis",
      "erwarte": [
        { "pfad": "ergebnis.event", "gleich": "consult" },
        { "pfad": "ergebnis.event_id", "typ": "string" }
      ]
    },
    {
      "befehl": ["werkzeug", "answer_consult", { "call_id": "{{anruf.call_id}}", "event_id": "{{ereignis.ergebnis.event_id}}", "answers": ["Ja, Freitag um 19 Uhr passt."] }],
      "erwarte": [{ "pfad": "ergebnis.accepted", "gleich": true }]
    },
    {
      "abwarten": "rueckfrage",
      "erwarte": [
        { "pfad": "status", "gleich": 200 },
        { "pfad": "koerper.status", "gleich": "answered" },
        { "pfad": "koerper.answer", "enthaelt": "Freitag um 19 Uhr" }
      ]
    }
  ]
}
```

## Stolperfallen

- Eine Rückfrage höchstens einmal je Anruf, Recherche höchstens zweimal.
- Die Quittung `answer_consult` mit `status: "working"` beendet den offenen Webhook nicht; erst Antworten tun das.
- Die Rückfrage arbeitet im 250-ms-Takt; die Dauer des Webhooks schwankt deshalb um rund 250 ms.
