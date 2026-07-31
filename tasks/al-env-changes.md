# AL-Kette — Protokoll der Render-Env-Aenderungen

Owner-Auflage: Env-Vars im Render-Dashboard zu aendern ist **erlaubt, aber protokollpflichtig**.
Jede Aenderung bekommt hier eine Zeile — Zeitstempel, Variable, Alt-/Neuwert, Phase, Grund.

**Gesperrt bleiben** (Anschalten IST die Abnahme, gehoert dem Owner):
`PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`.

Erlaubt sind neue Variablen mit **Default aus** und inerte Werte. Secrets stehen **nie** hier —
nur der Variablenname und „gesetzt/entfernt", niemals der Wert.

| Zeitstempel (UTC) | Variable | Alt | Neu | Phase | Grund |
|---|---|---|---|---|---|
| 2026-07-31 10:36 | `TELNYX_SSE_SPIKE_CALLEE` | (nicht gesetzt) | **gesetzt** (E.164, Mobilnummer des Owners — Wert steht bewusst nirgends im Repo) | AL-P2 | Zielnummer des Spikes; ohne sie ist der Schalter inert |
| 2026-07-31 10:36 | `TELNYX_SSE_SPIKE_DELAY_MS` | (nicht gesetzt) | `8000` | AL-P2 | erste Messung: inkrementell oder gepuffert? |
| 2026-07-31 10:42 | `TELNYX_SSE_SPIKE_DELAY_MS` | `8000` | `30000` | AL-P2 | zweite Messung: Telnyx-Turn-Timeout (oberste Sprosse zuerst) |
| 2026-07-31 10:47 | `TELNYX_SSE_SPIKE_DELAY_MS` | `30000` | `0` | AL-P2 | **abgeruestet** nach geglueckter Messung |
| 2026-07-31 10:47 | `TELNYX_SSE_SPIKE_CALLEE` | (gesetzt) | `""` (leer) | AL-P2 | **abgeruestet**; die Schluessel verschwinden endgueltig mit AL-P2z |

**Hinweis zur Reihenfolge:** `..._DELAY_MS > 0` **ohne** `..._CALLEE` ist im Hosting ein
Boot-Refusal. Beide Werte wurden deshalb jeweils in einem Zug gesetzt bzw. entschaerft.
Beim Abruesten ist die Reihenfolge unkritisch (Verzoegerung 0 ist immer inert).
