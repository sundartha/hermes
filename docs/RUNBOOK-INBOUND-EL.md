# Runbook: Eingehender Anruf ueber ElevenLabs (Stille und Klang)

Gilt fuer den EL-Weg von `/voice/incoming` (`[inbound-path] elevenlabs`). Bezug: Paket INL, `befund` vom 31.10.

## Was Hermes besitzt und was nicht

| Teil | Besitzer | Stand |
|---|---|---|
| Annahme des Anrufs | Hermes: `EL_DIAL_ANSWER_ON_BRIDGE = false` (`src/elevenlabs/inbound-rueckfall.js`), Telnyx nimmt sofort an. `true` ist bewusst verworfen: am 17.09. hoerte Antonio bei 1,56 s unbeantwortetem Bein Netz-Klingeln und eine fremde Roboteransage (Commit 1fa2260); der Fehlerweg bei einem nie annehmenden Bein (M-S3) ist nie positiv gemessen. |
| Fuellung der Wartezeit | Hermes: `<Dial audioUrl="…/brand/hermes-begruessungslaut.wav">`, Schalter `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED` (Default `true`, `render.yaml` `true`). |
| Codec und Audioformat der Beine | NICHT Hermes. Das TeXML kennt an `<Dial>` und `<Sip>` kein Codec- oder Audioformat-Attribut (Telnyx-Doku Dial, abgerufen 31.10.). Aushandlung liegt bei der Telnyx-TeXML-App/Nummer (HD Voice) und beim ElevenLabs-SIP-Trunk und -Agenten. |
| Dauer bis zur Bindung | NICHT Hermes. Gemessen: `[el-init] gebunden call=<id> ms_seit_annahme=1863 / 2190` (Telnyx-Wahl, SIP-Aufbau, ElevenLabs-Start bis zum Eintreffen des Init-Webhooks). |

## Stille nach der Annahme: gemessen

Datei `public/brand/hermes-begruessungslaut.wav` (PCM 16 bit mono 8000 Hz, 3,0 s):

- 0,0 bis 0,1 s: kurzer Klick, Spitze -20 dBFS.
- 0,1 bis 3,0 s: Pegel zwischen -85 und -79 dBFS RMS, Spitze unter -67 dBFS. Das liegt unter dem Rauschboden einer Telefonleitung und ist fuer den Anrufer Stille.
- Gesamt: RMS -54,6 dBFS, Spitze -20,0 dBFS.

Der Laut ist an, aber hoerbar nur etwa 0,1 s lang; die gemessenen 1,9 bis 2,2 s bis zur Bindung liegen fast ganz in der ruhigen Leitung. Das ist die Stille. Der Laut wurde am 17.09. von Antonio so abgenommen (Commit fec8b5c: "weiches Abheben des Hoerers, danach ruhige Leitung"); eine hoerbare Fuellung der ganzen Wartezeit braucht einen anderen Laut, das entscheidet Antonio (Owner-Entscheidung 10). Das Skript `scripts/render-begruessungslaut.mjs` wandelt die Quelle um.

## Verzerrte Stimme: was sich pruefen laesst

Hermes setzt keinen Codec. Offen und nicht aus dem Code belegbar:

1. Laeuft der Begruessungslaut nach der Bindung unter dem Agenten weiter? Die Doku nennt `audioUrl` Ringback "while waiting for the call to be answered"; ob es bei der Bindung sofort stoppt, steht dort nicht. Bei Bindung nach 1,9 bis 2,2 s bliebe von der Datei weniger als eine Sekunde, und sie ist ab 0,1 s fast stumm; eine Verzerrung durch diesen Laut ist damit unwahrscheinlich, aber nicht ausgeschlossen.
2. HD Voice an der Nummer: Telnyx haengt Breitband (G.722/Opus) an den EL-Trunk (G.711), dabei kann Transcoding klingen.
3. Audioformat der Konversation bei ElevenLabs.

## Abnahmeliste Probeanruf (Antonio, nach Deploy; kostet Geld, nur auf Freigabe)

Reihenfolge der billigsten Gegenprobe:

| # | Pruefung | Soll | Wo ablesen |
|---|---|---|---|
| 1 | Zeit von Anwahl bis Annahme | sofort (kein Klingeln, keine Roboteransage) | Ohr |
| 2 | Zeit von Annahme bis erster Satz | notiert; Vergleich mit `ms_seit_annahme` | Ohr, Render-Log `[el-init] gebunden call=<id> ms_seit_annahme=<ms>` |
| 3 | Hoert man in dieser Zeit etwas | Klick, danach ruhige Leitung (heutiger Laut) | Ohr |
| 4 | Klang der Agentenstimme | sauber, nicht verzerrt | Ohr |
| 5 | Wenn verzerrt: Lauf mit `ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED=false` | Verzerrung verschwindet = Laut ist die Ursache | Ohr (Render-Dashboard, Antonio) |
| 6 | Wenn weiter verzerrt: HD Voice an der Nummer aus | Verzerrung verschwindet = Transcoding | Ohr (Telnyx-Portal, Antonio) |
| 7 | Codec je Bein, SIP-Antwortcodes, Dauer bis Answer | G.711 auf beiden Beinen, kein Wechsel mitten im Anruf | Telnyx-Anrufdetail |
| 8 | Audioformat der Konversation | 8 kHz u-law zum SIP-Trunk | ElevenLabs-Gespraech |
| 9 | Antwortzeit des Dienstes | `[voice-antwort] weg=incoming ms=<n> status=<code> ende=beendet`; die Zeile gibt es erst, wenn PR #2440 (Paket INB) gemergt und deployt ist, vorher entfaellt diese Pruefung | Render-Log |
| 10 | Pfad | `[inbound-path] elevenlabs` | Render-Log |

Aenderungen an Render, Telnyx und ElevenLabs macht Antonio; kein Agent ruft sie auf.
