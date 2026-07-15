# SPEC: Opening-Speak-Timeout-Guard (PLAN-TELNYX-AI-ASSISTANT-NO-AUDIO.md, Befund 2)

## Kontext / Root Cause (API-verifiziert 2026-07-15)

- Telnyx `list_call_events` (Telnyx-eigenes Event-Ledger, unabhaengig von unserem Server) fuer
  die 3 Testanrufe vom 2026-07-14 19:55-19:58 UTC ausgelesen.
- Call 1 (leg `f76f136e-...`): dial->answered->speak(19:55:35.909)->call.speak.started
  (19:55:38.676, +2.77s)->call.speak.ended(19:55:52.478, 13.8s Sprechdauer)->ai_assistant_start
  ->... ALLE Events `failed:false`, normale Zeiten. Bestaetigt Befund 1 (App-Ebene fehlerfrei -
  echtes Media-Bridging-Problem auf Telnyx-/PSTN-Seite, braucht Telnyx-Support mit
  call_control_id `v3:0eOsGlIwa784-Yo5-t7b2aZ0Vxe6XnUqeZACq7BvjXHayOr6Ao9OJg`. NICHT Teil
  dieser Phase - kein Code-Fix ohne Vendor-Bestaetigung moeglich).
- Call 2 (leg `2df8404a-...`, 19:57:01) und Call 3 (leg `4d46c476-...`, 19:57:53): BYTE-GLEICHER
  speak-Payload (Text/Stimme/voice_settings) wie Call 1. Speak-Command wird akzeptiert
  (`failed:false`), aber danach erscheint im Telnyx-Ledger WEDER `call.speak.started` NOCH
  `call.speak.ended` NOCH `call.speak.failed` - 27s bzw. 17s absolute Stille, dann direkt
  `hangup` (durch `cancel_call`/Jonas). Das ist Telnyx' EIGENES Ledger, unabhaengig von unserer
  Webhook-Zustellung -> WIDERLEGT die urspruengliche Befund-2-Hypothese ("Webhook-Zustellung an
  app.sundartha.com haengt") - das Event wurde laut Telnyx nie generiert, kein Zustellproblem
  unsererseits.
- Render `list_deploys` fuer `srv-d8m0fhflk1mc73bno570`: EINZIGER Deploy im Fenster ist der
  bekannte manuelle Redeploy 19:45:45-19:46:41 UTC (9-12 Min VOR den Calls). Kein Deploy/Restart
  zwischen 19:57-19:58 UTC -> schliesst "Redeploy waehrend der toten Calls" als Ursache aus.
- **Root Cause Befund 2 (bestaetigt, soweit app-seitig sichtbar):** Telnyx' Speak-Command kann -
  aus fuer uns unsichtbaren Gruenden (vermutlich ElevenLabs-seitiger Stall/Limit bei dicht
  aufeinanderfolgenden Calls, ~90s/~49s Abstand) - vollstaendig verstummen, OHNE jemals ein
  `call.speak.failed` zu feuern. `src/telnyx-call-control-ingest.js` (Zeile 190-193) reagiert NUR
  auf ANSWERED/SPEAK_ENDED/SPEAK_FAILED/HANGUP - faellt keines davon, haengt der Call bis zum
  manuellen Hangup in absoluter Stille. Kein Timeout, kein Retry, kein Log-Signal ausser der
  initialen "answered -> Opening-Speak abgesetzt"-Zeile.

## Scope dieser Phase

NUR der app-seitige Resilienz-Gap (Befund 2). Befund 1 (Media-Bridging bei erfolgreichem Speak)
ist NICHT Teil dieser Phase - kein Code-Fix moeglich ohne Telnyx-Support-Bestaetigung (Naechste
Schritte 1+4 im Plan-Dokument bleiben offenes Owner-Gate).

## Design

### Neue Config-Konstante (`src/config.js`, im selben Block wie `telnyxDeadAirTimeoutS`)

```js
telnyxOpeningSpeakTimeoutS: numEnv(
  "TELNYX_OPENING_SPEAK_TIMEOUT_S",
  process.env.TELNYX_OPENING_SPEAK_TIMEOUT_S,
  { fallback: 45, min: 10, max: 120 },
),
```

Kommentar-Pflicht im selben Stil wie `telnyxDeadAirTimeoutS` (G35): begruenden warum 45s
(beobachtete reale Sprechdauer Call 1 command->speak.ended = 16.57s; 45s Fallback laesst
Spielraum fuer laengere Anliegen-Saetze + Netz-Jitter, ohne bei einem echten Stall endlos zu
warten). min/max-Clamp analog `telnyxDeadAirTimeoutS` (P9-CFG1-Footgun-Schutz: 0 oder absurd
hoch wuerde den Guard lautlos inert schalten).

### Timer-Bookkeeping in `src/telnyx-call-control-ingest.js`

Neue Map im selben Closure wie `openingRetryUsed` (der bestehende Kommentar dort, Zeile 45-51,
verweist bereits auf "Muster: Watchdog-Map" als Vorbild):

```js
const openingSpeakTimers = new Map(); // callId -> Timer-Handle
```

- In `onAnswered`, NACH dem (ggf. per Sync-Retry gefallenen) `sendOpeningSpeak`-Aufruf: Timer
  armieren, der nach `config.telnyxOpeningSpeakTimeoutS * 1000` ms `onSpeakFailed(call,
  callControlId)` aufruft - FALLS er nicht vorher geloescht wurde (echtes speak.ended/
  speak.failed kam frueher).
- `onSpeakEnded` UND `onSpeakFailed`: als ALLERERSTE Aktion den Timer fuer `call.id` loeschen
  (idempotent - egal ob durch echtes Event oder durch sich selbst via Timeout ausgeloest).
- `onHangup`: Timer ebenfalls loeschen (parallel zu `openingRetryUsed.delete`, gleicher
  Aufraeum-Zeitpunkt).
- Timer via `setTimeout` + `.unref()` (Muster `telnyx-conversation-watchdog.js`
  `defaultSetTimer` - haelt den Event-Loop nicht kuenstlich am Leben).
- KEIN neuer Fehlerpfad noetig: das Timeout ruft dieselbe `onSpeakFailed`-Funktion wie ein
  echtes `call.speak.failed`-Event -> Azure-Retry-Fallback (falls Token frei) ODER Fail-Safe
  (kein Assistant-Start) - byte-identisches Verhalten zum bestehenden Pfad (G5, keine
  Duplizierung).

### Warum kein Ausbau von `telnyx-conversation-watchdog.js`

Der Watchdog deckt eine ANDERE Achse ab (Dead-Air NACH `ai_assistant_start`, terminiert den
ganzen Call). Der Opening-Speak-Timeout muss VOR `ai_assistant_start` greifen und darf NICHT den
Call terminieren, sondern denselben Retry-oder-Fail-Safe-Pfad wie `onSpeakFailed` ausloesen -
strukturell naeher am bereits vorhandenen `openingRetryUsed`-Muster IM SELBEN Modul als am
Watchdog. Zwei getrennte Ein-Zweck-State-Maps im richtigen Modul statt eines aufgeblaehten,
mehrzweckigen Watchdogs (S3/S4-Vermeidung).

## Tests (PFLICHT, neues Verhalten)

- `test/telnyx-call-control.test.js`: Fake-Timer-Test - `onAnswered` erfolgreich, KEIN
  speak.ended/speak.failed-Event kommt, Timer laeuft ab -> `onSpeakFailed`-Verhalten (Retry mit
  Azure-Stimme, wenn Token frei) wird ausgeloest. Zweiter Test: echtes `call.speak.ended` kommt
  VOR Timeout -> Timer wird geloescht, KEIN spaeterer Fehlalarm (Timer-Advance danach loest
  nichts mehr aus). Dritter Test: `onHangup` VOR Timeout -> Timer wird geloescht (kein Aufruf
  nach Call-Ende).
- Bestandssuite (`telnyx-speak-events.test.js`, `telnyx-stab-p9-watchdog.test.js`) bleibt
  UNVERAENDERT gruen (reiner Additiv-Fix, kein bestehender Pfad angefasst).

## Deterministisch pruefbares Ergebnis

- `npm test`: neue Tests gruen, Bestandssuite (aktuell 2189 Tests laut letzter Session)
  weiterhin gruen, KEIN Test-Rueckbau.
- `node --check src/config.js src/telnyx-call-control-ingest.js`.
- Smoke-Test best-effort (kein echter Anruf noetig): Unit-Test-Ebene ist der primaere Beweis
  (Timing per Fake-Timer deterministisch, ein echter Timing-Smoke-Test waere flaky/unpraktikabel).

## Nicht-Ziele

- Befund 1 (Media-Bridging) - kein Code-Fix in dieser Phase, bleibt Owner-Gate (Telnyx-Support).
- Keine Aenderung an `disclosureSentence`/Offenlegungs-Text oder -Reihenfolge (Regel 2
  unangetastet - der Fallback spricht denselben `openingText`, nur mit Azure- statt
  ElevenLabs-Stimme, exakt wie der bestehende `onSpeakFailed`-Pfad).
- Keine ElevenLabs-Konzurrenz-/Rate-Limit-Aenderung (ausserhalb unserer Kontrolle/Sichtbarkeit).
