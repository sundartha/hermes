# Strategie: Azure-TTS `speak_failed` (intermittent) abfangen

## 0. Symptom (wie gemeldet)

Azure-TTS `speak_failed` tritt **sporadisch** auf und schneidet die Pflicht-Offenlegung
bzw. die Agent-Antwort ab. Der Anrufer hoert dann Stille statt des erwarteten Satzes.
Die Stoerung ist nicht reproduzierbar und bisher **undiagnostiziert**.

## 1. Architektur des TTS-Pfads (verifiziert am Code)

Das TTS ist **server-seitig** und laeuft NICHT durch einen eigenen TTS-Adapter, sondern
ueber das TeXML-`<Say>`-Verb des Providers:

- `src/telephony/adapters/telnyx/render.js:17` — `<Say voice="Azure.de-DE-KatjaNeural" language="de-DE">`.
  Telnyx synthetisiert den Text ueber sein **Azure-NTTS-Backend** und spielt das Audio in den Call.
- Es gibt **keine** Stelle im Repo, die `speak_failed` kennt (`grep` leer) — der Fehler kommt
  also vollstaendig aus der Provider-/Azure-Schicht, nicht aus eigenem Code.
- Freie Stimmen-/Modellwahl bleibt bewusst erhalten (Owner-Wahl, `render.js:10-15`); ein
  Voice-Swap ist explizit KEIN Fix.

## 2. Wurzel (5-Why): warum "intermittent **und** undiagnostiziert"

1. **Warum kommt die Offenlegung manchmal stumm an?** Das Azure-NTTS-Backend synthetisiert
   den `<Say>`-Text sporadisch nicht (Backend-Stoerung) -> Telnyx meldet ein
   `speak_failed` / `call.speak.ended (status=failed)`.
2. **Warum merkt das niemand?** Ein Speak-Command-Event traegt **kein `CallStatus`**.
3. **Warum ist das fatal?** Der `/voice/status`-Handler (`server.js`) interpretiert nur
   `CallStatus` (Lifecycle). Ein Body ohne `CallStatus` faellt durch alle Zweige
   (`extractLifecycleEvent` -> `status=undefined` -> kein Treffer in der Lifecycle-Liste)
   und wird **stumm verworfen** — kein Log, kein Zaehler, kein Signal.
4. **Warum ist das die eigentliche Wurzel?** Eine reale, wiederkehrende Stoerung ist
   damit strukturell **unbeobachtbar**. "Intermittent & undiagnosed" ist kein Zufall,
   sondern die direkte Folge fehlender Observability an genau dieser Stelle.
5. **Konsequenz fuer den Fix:** Bevor man ueber Retry/Fallback entscheidet, muss die
   Stoerung erst **sichtbar** werden. Observability ist der Wurzel-Fix; Retry/Fallback
   sind nachgelagerte, ohne echten Call nicht verifizierbare Optionen (siehe 5.).

## 3. Umgesetzter Fix (graceful degradation = "Fehler loggen")

Minimaler, additiver, fail-safe Eingriff — exakt im Muster der bestehenden
provider-bewussten Webhook-Leser (`extractSpeech`, `extractLifecycleEvent`):

1. **`src/telephony/adapters/telnyx/speak-events.js`** (neu, rein/IO-frei, unit-testbar —
   Praezedenzfall `media.js`/`parseMediaFrame`): `parseSpeakEvent(body)` klassifiziert einen
   Telnyx-Webhook-Body zu einem neutralen `{ outcome, reason }`:
   - `call.speak.failed` ODER `call.speak.ended` mit `status="failed"` -> `FAILED`.
   - `call.speak.ended` mit `status="completed"` -> `OK`.
   - alles andere (insbesondere der form-encodete `CallStatus`-Lifecycle-Callback) -> `NONE`.
   - **PII-frei**: `reason` ist ein Telnyx-Status-Token aus einer Allowlist, nie Payload-Freitext.
   - **Defensiv**: `FAILED` nur bei EINDEUTIGEM Fehlsignal (kein Fehlalarm bei fehlendem Status);
     Unbekanntes/Garbage -> `NONE`, wirft nie.
2. **`src/server.js`** — `extractSpeakOutcome(req, provider)` (Provider-Dispatch; Twilio -> `NONE`,
   Hot-Path byte-identisch) und im `/voice/status`-Handler ein additiver Zweig **vor** dem
   Lifecycle-Zweig: ein erkanntes Speak-Event terminiert den Handler (es ist kein
   Lifecycle-Uebergang), und ein `FAILED` erzeugt eine PII-freie `console.error("[voice/speak]", ...)`-
   Zeile (`callId/provider/outcome/reason`). Damit wird die sporadische Azure-Stoerung zum
   diagnostizierbaren, alarmierbaren Signal.

**Fail-safe-Garantie:** Liefert `parseSpeakEvent` `NONE` (alle Bestands-Bodies mit `CallStatus`),
laeuft der Lifecycle-Pfad unveraendert weiter — `npm test` (inkl. `voice-status-lifecycle.test.js`)
bleibt gruen.

## 4. Bewusst NICHT umgesetzt (Scope + Pre-Mortem)

- **Kein Voice-/Modell-Swap** als "Fix" — die freie Stimmenwahl bleibt (Vorgabe).
- **Kein automatischer In-Call-Retry / Call-Control-Re-Speak.** Das braeuchte einen neuen
  `VoiceControl.speak()`-Port + Call-Control-Injection, ist ohne echten Call **nicht
  verifizierbar** und birgt ein Loop-/Doppel-Audio-Risiko in einem System, das mit echten
  Menschen telefoniert (CLAUDE.md "SCOPE", "einfachste funktionsfaehige Loesung", Pre-Mortem).
  Bewusst als spaetere, live-gegatete Phase zurueckgestellt (siehe 6.).
- **Kein Store-Zaehler.** Ein `speakFailures`-Feld am Call braeuchte neue Methoden in beiden
  Backends (json + pg) + Migration — Surface ohne verifizierbaren Nutzen. Das Log-Signal
  genuegt fuer Diagnose/Alerting; der Zaehler ist ein optionaler Folgeschritt.

## 5. Einschraenkung der Verifikation (WICHTIG)

**Kein echter Anruf moeglich** — der Fix ist ausschliesslich per Unit-Test und Code-Review
verifiziert:

- `test/telnyx-speak-events.test.js` (rein, 9 Faelle): Klassifikation inkl. Fail-safe + PII-Klemme.
- `test/voice-speak-status.test.js` (Integration): `/voice/status` loggt `speak_failed` PII-frei
  ohne Lifecycle-Effekt; Lifecycle-Regression bleibt intakt.

**Live unbestaetigt** (analog der bestehenden Telnyx-Honesty in `voice.js`): Die exakten
Telnyx-Event-Namen/Payload-Formen und insbesondere **ob Telnyx Speak-Command-Events
ueberhaupt an die TeXML-`StatusCallback`-URL liefert** (statt nur an den Connection-Webhook),
sind ohne echten Call nicht bestaetigt. Der Code ist deshalb defensiv (mehrere plausible
Formen erkannt, Unbekanntes -> `NONE`): Im schlechtesten Fall greift der Logging-Zweig nie
(kein Schaden, kein Regress), im besten Fall macht er die Stoerung sofort sichtbar. Die
StatusCallback-Events sind aktuell auf `["answered","completed"]` gesetzt (`server.js`); ob
Speak-Events zusaetzlich abonniert werden muessen, ist beim ersten echten Telnyx-Call zu pruefen.

## 6. Naechste Schritte (live-gegatet)

1. Echten Outbound-Call fuehren, Telnyx-Debugger + Render-Log auf `[voice/speak]` pruefen:
   Kommt das Event an der StatusCallback-URL an? Welcher exakte `event_type`/`status`?
2. Falls JA und die Rate relevant ist: bounded In-Call-Retry oder Fallback-Voice **als
   eigene Phase** mit Live-Verifikation. Falls Events nur am Connection-Webhook ankommen:
   diesen Webhook-Pfad ergaenzen (gleiche `parseSpeakEvent`-Klassifikation wiederverwenden).
