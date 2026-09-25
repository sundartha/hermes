// ---- ECHTE Anbieter-Antworten als Fixtures: Unterbrechungs-Messung (P6) ----------------
// Aufgezeichnet am 06.09.2026 rein LESEND gegen api.elevenlabs.io
// (GET /v1/convai/conversations/{id}) fuer die drei in PLAN-ANRUFDEFEKTE.md (W6, P6)
// belegten Anrufe. Kein Wert ist erfunden.
//
// ALLOWLIST STATT DENYLIST (fail-closed, Absolute Regel 4/5): uebernommen sind AUSSCHLIESSLICH
// conversation_id, metadata.call_duration_secs und je Turn role / time_in_call_secs /
// interrupted / message / original_message. Alles andere der Rohantwort - Analyse,
// dynamische Variablen (Auftrag, Briefing), Werkzeug-Aufrufe und -Ergebnisse (Fragetext!),
// metadata.phone_call (Rufnummern) - ist NICHT uebernommen.
//
// TEXT IST ERSETZT, LAENGE IST ECHT: jeder Sprechtext steht als laengengleiche
// Platzhalterkette ("x".repeat(n)). Die Kennzahl dieser Phase haengt ausschliesslich an den
// LAENGEN (len(message)/len(original_message)) und an interrupted - beides ist unveraendert
// echt. Gespraechsinhalt gehoert nicht ins Repo.
//
// Diese Datei ist die POSITIV-KONTROLLE des Messwerkzeugs: sie darf nicht an das Werkzeug
// angepasst werden. Weicht eine Zahl ab, ist das Werkzeug falsch (Lehre
// pruefkommando-ohne-positiv-kontrolle).
//
// Erwartete Kennzahlen, unabhaengig aus der Rohantwort nachgerechnet (Lead, 06.09.2026):
//   laut_12_44      7 Agenten-Turns, 6 unterbrochen, Anteile 56,7 / 65,7 / 86,3 / 35,5 / 21,4 / 85,4 %
//   kontrolle_10_26 6 Agenten-Turns, 1 unterbrochen, Anteil 98,7 % (607/615); 4 davon mit Text
//   referenz_03_09  7 Agenten-Turns, 2 unterbrochen, Anteile 52,5 % (63/120) und 96,7 %

export const UNTERBRECHUNGS_FIXTURES = {
  "laut_12_44": {
    "conversation_id": "conv_0501m1vbz70bfpctff3th2h2htrc",
    "metadata": {
      "call_duration_secs": 87
    },
    "transcript": [
      {
        "role": "agent",
        "time_in_call_secs": 0,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 9,
        "interrupted": false,
        "message": "xxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 12,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 16,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 20,
        "interrupted": false,
        "message": "xxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 22,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 33,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 40,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 41,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 56,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 58,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 61,
        "interrupted": true,
        "message": "xxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 61,
        "interrupted": false,
        "message": "xxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 65,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 74,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      }
    ]
  },
  "kontrolle_10_26": {
    "conversation_id": "conv_5801m1v4269mfq4bqy9qz0a04xqe",
    "metadata": {
      "call_duration_secs": 101
    },
    "transcript": [
      {
        "role": "agent",
        "time_in_call_secs": 0,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 9,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 13,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 49,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 54,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 87,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 91,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 94,
        "interrupted": false,
        "message": null,
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 101,
        "interrupted": false,
        "message": null,
        "original_message": null
      }
    ]
  },
  "referenz_03_09": {
    "conversation_id": "conv_9301m1m3z963ewbvz4s7zzrevfa0",
    "metadata": {
      "call_duration_secs": 55
    },
    "transcript": [
      {
        "role": "agent",
        "time_in_call_secs": 0,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 8,
        "interrupted": false,
        "message": "xxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 10,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 12,
        "interrupted": false,
        "message": "xxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 15,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "user",
        "time_in_call_secs": 26,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 34,
        "interrupted": true,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      },
      {
        "role": "user",
        "time_in_call_secs": 44,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 49,
        "interrupted": false,
        "message": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 52,
        "interrupted": false,
        "message": null,
        "original_message": null
      },
      {
        "role": "agent",
        "time_in_call_secs": 54,
        "interrupted": false,
        "message": null,
        "original_message": null
      }
    ]
  }
};
