# P7 - Vorher-Messung (Stand vor jeder Laerm-Stellschraube)

Erhoben am 06./07.09.2026 vom Lead mit `scripts/anruf-unterbrechungen.mjs` (P6), rein lesend
gegen die ElevenLabs-Conversation-API. **Diese Datei ist die Vergleichsgrundlage fuer P7.**
Ohne sie belegt die Nachher-Messung nichts (Lehre `bench-must-reproduce-defect`).

## Grundgesamtheit

Alle 13 Anrufe seit dem Wirksamwerden der heutigen Agenten-Konfiguration. Die Version ist fuer
jeden einzelnen Anruf per API geprueft und identisch:
**`agtvrsn_5901m1q67m31f22ar8vptava9skp`** (04.09.2026 21:47 bis 06.09.2026 16:06).

Die relevanten Vorwerte am Live-Agenten, ebenfalls gemessen:
`turn.turn_eagerness = "normal"`, `turn.turn_model = "turn_v3"`, `turn.turn_timeout = 5`,
`vad.background_voice_detection = false`, `turn.interruption_ignore_terms = []`,
`asr.provider = "scribe_realtime"`, `asr.keywords = []`.

## Je Anruf

| Anruf | Dauer | Agenten-Turns | unterbrochen | Anteil |
|---|---|---|---|---|
| `conv_6401m1q6bghefr5t5a2q7b0xq27t` | 41 s | 5 | 0 | 0,0 % |
| `conv_6701m1q6frmzf4pvfyj9j68b05hs` | 8 s | 1 | 1 | 100,0 % |
| `conv_3201m1q6y1y7esyaf19x4pkwxmcg` | 7 s | 1 | 1 | 100,0 % |
| `conv_4301m1r2gbx0eze8jgnrrpgps01e` | 93 s | 6 | 0 | 0,0 % |
| `conv_3901m1rdxyj9fdss62pg7t5dfnsz` | 98 s | 8 | 1 | 12,5 % |
| `conv_0501m1rrj3k4f4zt3nt33s4z9syp` | 33 s | 4 | 0 | 0,0 % |
| `conv_4001m1skx7f6fcgty3hv9kq01y8g` | 54 s | 3 | 2 | 66,7 % |
| `conv_9201m1sm2gtsff08wd3e2t6y886n` | 78 s | 12 | 5 | 41,7 % |
| `conv_5201m1tmwqmzfay9yzrcjnnk17mm` | 8 s | 1 | 1 | 100,0 % |
| `conv_5801m1v4269mfq4bqy9qz0a04xqe` | 101 s | 6 | 1 | 16,7 % |
| `conv_0501m1vbz70bfpctff3th2h2htrc` | 87 s | 7 | 6 | **85,7 %** (der Laerm-Anruf, S-3) |
| `conv_5501m1vc5k66eh29e69bdwhc4we3` | 30 s | 1 | 0 | 0,0 % |
| `conv_0401m1vqhxdce8gt5q3h816hmb3r` | 64 s | 4 | 0 | 0,0 % |

## Die zwei Vergleichszahlen

| Grundgesamtheit | n | mittlerer Unterbrechungsanteil | mittlere Gespraechsdauer |
|---|---|---|---|
| **alle Anrufe** | 13 | **40,2 %** | **54,0 s** |
| **nur gefuehrte Gespraeche** (>= 3 Agenten-Turns) | 9 | **24,8 %** | **72,1 s** |

**Die zweite Zeile ist die belastbare.** Drei der 13 Anrufe haben genau EINEN Agenten-Turn und
7-8 s Dauer: dort wurde die Eroeffnung durch das Auflegen der Gegenstelle abgeschnitten, was
als "100 % unterbrochen" zaehlt, ohne dass je ein Gespraech stattfand. Diese Faelle heben den
Mittelwert um 15 Punkte und sagen nichts ueber Laermempfindlichkeit. Die Nachher-Messung von P7
muss dieselbe Regel anwenden - **sonst vergleicht sie zwei verschiedene Dinge.**

## Die Gespraechsdauer gehoert dazu (PM-4)

`turn_eagerness: "patient"` laesst den Agenten laenger warten, bevor er den Turn uebernimmt.
Das kann die Unterbrechungsrate senken UND die Anrufe verlaengern; bei 30 ct/min schlaegt das
auf die Kostendecke durch. **Sinkt der Unterbrechungsanteil, steigt aber die mittlere
Gespraechsdauer deutlich ueber 72,1 s, ist das kein Erfolg, sondern ein Tausch** - und die
Entscheidung darueber gehoert dem Eigentuemer.

## Wie die Nachher-Messung laeuft

```
node scripts/anruf-unterbrechungen.mjs <die conversation_ids der Testanrufe>
```

Mindestens fuenf Testanrufe unter vergleichbaren Bedingungen (F-7: eine Stellschraube je
Messrunde). Der Rueckfallwert ist `turn_eagerness = "normal"`.
