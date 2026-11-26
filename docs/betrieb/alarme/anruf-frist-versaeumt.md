# Alarm anruf-frist-versaeumt

Regel: `docs/betrieb/grafana/alarmregeln.json`, Eintrag `anruf-frist-versaeumt` (Schwelle und Fenster stehen nur dort). Messgröße: `hermes.call.deadline_missed` mit Attribut `frist`; die Werte stehen in `src/utils/betriebsmessung.js` (`VERSAEUMTE_FRIST`). Die Regel betrifft ausgehende Anrufe auf dem Weg `telnyx_vorspann`.

## Symptom

- `frist="el_angenommen"`: Der Angerufene hat abgehoben, ElevenLabs hat das zweite Bein aber nicht angenommen. Gezählt wird, wenn die Frist abläuft (`bridgeStartDeadlineMs` in `src/config.ts`, Env `EL_BRIDGE_START_DEADLINE_MS`), wenn die Wahl des Beins scheitert oder wenn es vor der Annahme auflegt. Legt der Angerufene vorher selbst auf, zählt nichts.
- `frist="abschluss"`: Ein verbundener Anruf war beim Ablauf seiner Höchstdauer noch offen und musste vom Fristenlauf beendet werden (`terminateExpiredCall` in `src/telephony/call-lifecycle.ts`; Höchstdauer je Anruf `maxDurationS`, Obergrenze `MAX_CALL_DURATION_CAP_S` in `src/begriffe/anrufe.js`). Auch ein echtes Gespräch, das die Höchstdauer erreicht, zählt hier.

## Prüfen

1. Im Panel der versäumten Fristen nach `frist` aufschlüsseln.
2. Bei `el_angenommen`: in den Render-Logs nach `[el-vorspann] rueckfall` und `el_bein_aufgelegt` suchen; Anbieter-Status von ElevenLabs und Telnyx ansehen.
3. Bei `abschluss`: Anrufe mit Grund `max-duration-cap` ansehen und prüfen, ob das Auflege-Ereignis von Telnyx ankam (`[voice/vorspann] verarbeitet`). Kommt `[el-vorspann] ereignis fehlgeschlagen` vor, ist die Verarbeitung gescheitert.

## Beheben

- Nimmt ElevenLabs nicht an: Trunk-Zugang und Agent-Konfiguration prüfen (`docs/RUNBOOK-OUTBOUND.md`).
- Fehlen Auflege-Ereignisse: Webhook-Adresse und Signaturprüfung bei Telnyx prüfen; die Signaturprüfung nicht abschalten.
- Hat nur ein Gespräch die Höchstdauer erreicht, ist nichts zu beheben.

## Eskalieren

Hilft das Beheben nicht, die Bereitschaft über den Kontaktpunkt `bereitschaft` ansprechen. Bei Gefahr für Kosten oder echte Anrufe zuerst den Kill-Switch `OUTBOUND_FROZEN` setzen (`docs/RUNBOOK-OUTBOUND.md`).
