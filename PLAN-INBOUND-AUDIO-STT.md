# Plan: Inbound-Audio / STT — Agent hört den Anrufer nicht (Telnyx, Budget-Engine)

> Status: Diagnose-zuerst. **Noch nicht implementieren.** Erst die fehlende
> Beobachtung (echter Telnyx-POST an `/voice/turn`) herstellen, dann fixen.

## Kontext

Bei einem echten **Telnyx**-Anruf (`VOICE_ENGINE=budget`) **redet** der Agent (TTS
hörbar), aber er **hört den Anrufer nicht**: Das Transkript enthält nur
`role:agent`, nach Stille wiederholt der Agent die Begrüßung (Re-Greet).
Outbound-Audio (Agent → Mensch) funktioniert, Inbound (Mensch → Agent) nicht.

Ein vorheriger Versuch (`455bd71`, `transcriptionEngine="Telnyx"` im Gather) hat das
Symptom **nicht** behoben — und war nie live verifiziert (Akzeptanzkriterium „echter
Call → ≥1 `role:caller`-Zeile" war offen). Dieser Plan wiederholt diesen Fehler
bewusst nicht: Er stellt zuerst einen Feedback-Loop her, bevor er etwas ändert.

**Gewünschtes Ergebnis:** Der Agent reagiert im Telnyx-Call inhaltlich auf das
Gesagte; das Transkript enthält mindestens eine `role:caller`-Zeile.

## Gesicherte Fakten (selbst verifiziert, mit Datei:Zeile)

- `src/server.js:303` — `/voice/turn` liest **ausschließlich** `req.body.SpeechResult`.
  Ist der Wert leer → `agentTurn(call, null)` (`:311`) → Re-Greet. **Exakt das Symptom.**
- `src/server.js:305-310` — Sonderfall: leerer `heard` + bereits eine `caller`-Zeile →
  „Ich habe Sie nicht verstanden". Beim **ersten** Turn (noch keine `caller`-Zeile)
  greift stattdessen der Re-Greet. Deckt sich mit „wiederholt die Begrüßung".
- `src/server.js:203-204` — `turnDirectives` baut Gather mit **relativer** `action`
  (`/voice/turn?callId=…`) + Redirect-Fallback.
- `src/telephony/adapters/telnyx/render.js:27-31` — `GATHER_ATTRS` rendert
  `input="speech" language="de-DE" transcriptionEngine="Telnyx"`. Fix `455bd71` ist
  live (HEAD == origin/master), ändert das Symptom **nicht**.
- `src/telephony/adapters/telnyx/voice.js:6-8` — die Telnyx-Voice-Integration ist
  „verifiziert gegen die Doku, **live UNBESTÄTIGT**". Telnyx-TeXML ist nur
  *Twilio-kompatibel*, nicht identisch.
- `src/server.js:98-108` — Signaturprüfung liegt auf dem **gesamten `/voice`-Prefix**,
  also identisch für `/voice/incoming` und `/voice/turn`. **Folgerung:** Da der Agent
  redet (`/voice/incoming` hat die Prüfung passiert), würde `/voice/turn` sie genauso
  passieren. **Signatur ist als Stillschweige-Killer unwahrscheinlich** (nicht 0, aber nachrangig).
- `data/store.json` existiert **lokal nicht** → echte Call-Daten + Logs liegen nur auf
  Render. Der Inbound-STT-Pfad ist **lokal nicht reproduzierbar** (Telnyx-STT = echte Telefonie).

## 5-Why — Wurzel statt Symptom

1. **Warum hört der Agent den Anrufer nicht?**
   `/voice/turn` bekommt ein leeres `SpeechResult` → `heard=""` → `agentTurn(null)` → Re-Greet (`server.js:303,311`).
2. **Warum ist `SpeechResult` leer?**
   Telnyx liefert den transkribierten Text entweder gar nicht — oder **nicht unter dem
   Feldnamen `SpeechResult`** an die Gather-`action`. Der Server liest aber **nur** dieses
   eine Feld. → **Diese Gabelung muss die Diagnose entscheiden (noch unbestätigt).**
3. **Warum weicht Telnyx evtl. von dieser Annahme ab?**
   Die Telnyx-Integration ist doku-basiert gebaut und explizit „live UNBESTÄTIGT"
   (`voice.js:7`). „Twilio-kompatibel" ≠ identisch: Feldname, sync-action vs. async-Webhook,
   Pflicht-Attribute/Engine wurden ohne Live-Beleg gleichgesetzt.
4. **Warum wurde das vor dem Go-Live nicht gefangen?**
   Der Inbound-STT-Pfad ist lokal nicht reproduzierbar (keine Telnyx-STT; Store/Logs nur
   live), und es gibt **keinen Live-Smoke-Test im Loop**. Die Test-Suite (264/264) nagelt
   nur das **gerenderte** TeXML (Snapshot) und das serverseitige **Lesen** von
   `SpeechResult` fest — sie kann nicht prüfen, was Telnyx tatsächlich **postet**. Eine
   falsche Annahme über den Telnyx-Callback besteht alle Tests.
5. **Warum hat der vorherige Fix trotz Auslieferung nichts geändert? (Wurzel)**
   `455bd71` behandelte eine Symptom-Theorie (fehlender `transcriptionEngine`) als
   Wurzel und ging live **ohne** die eine entscheidende Beobachtung: den echten
   Telnyx-POST-Body an `/voice/turn`.
   **Doppelte Wurzel:**
   - *Technisch:* Server liest nur `SpeechResult`; der reale Telnyx-Gather-Callback-Vertrag
     (Feldname / sync vs. async / de-DE-Reife der Engine) ist **unbeobachtet**.
   - *Prozess:* Fixen auf Basis unbestätigter Kausal-Theorie für einen Pfad, der nur live
     beobachtbar ist (vgl. `tasks/lessons.md`: „Bug-Report-Schicht ≠ aktiver Code-Pfad").

## Sinnvoller Ablauf (Diagnose → Fix → Verifikation)

### Phase 0 — Feedback-Loop herstellen (zuerst, Pflicht)
Die fehlende Beobachtung beschaffen, **bevor** Code geändert wird. Zwei Wege, parallel:
- **A (kein Deploy):** Telnyx Mission Control → Debugging / Call- & Webhook-Logs. Den
  letzten Anruf öffnen und nachsehen, **was Telnyx an `/voice/turn` POSTet**: Body-Felder,
  Feldnamen, ob ein Transkript-Feld existiert, HTTP-Status der Antwort (403? 200?).
- **B (temporär, mit Deploy):** In `/voice/turn` **zeitlich befristetes** Diagnose-Logging:
  nur **Feld-NAMEN** von `req.body` (`Object.keys`), Präsenz/Länge eines evtl.
  Transkript-Felds, `Content-Type`, ob `rawBody` vorhanden, ob Signatur ok. **Keine
  Roh-Werte, keine vollständigen Nummern** (DSGVO, siehe Pre-Mortem). Auf Render deployen.

### Phase 1 — Ein Test-Call (mit Owner, echte Telefonie)
Eine erlaubniswürdige (Allowlist-)Nummer anrufen, **einen Satz sprechen**, dann in
Logs/Debugger nachsehen. Ergebnis = die Gabelung aus Why 2 wird **belegt**.

### Phase 2 — Auf Evidenz verzweigen (erst jetzt Code ändern)
- **Fall 1 — anderer Feldname:** Telnyx postet das Transkript unter einem anderen Key →
  **provider-bewusstes Auslesen** einführen (kleiner Helfer `extractSpeech(req, provider)`),
  der für Telnyx den belegten Feldnamen liest, für Twilio weiter `SpeechResult`. Minimal,
  byte-identisch für Twilio.
- **Fall 2 — kein sync-Callback:** Telnyx liefert das Transkript gar nicht an die
  Gather-`action`, sondern async / über einen separaten Mechanismus → den Telnyx-Turn-Flow
  an den **realen** Telnyx-Vertrag anpassen (gegen Telnyx-Doku verifizieren).
- **Fall 3 — Engine erkennt de-DE nicht:** Feld existiert, aber **leer** mit
  `transcriptionEngine="Telnyx"` → auf `"Google"` umstellen (1-Zeilen-Fallback, schon im
  README als Restrisiko notiert). **Nur** wenn das Log „Feld vorhanden, aber leer" belegt.
- **Fall 4 — Request kommt nicht an (403 / action-URL):** Log/Debugger zeigt 403 oder gar
  keinen Eingang → Signatur-Verifier provider-korrekt machen **oder** action absolut
  (`config.publicUrl + …`). **Signatur niemals abschalten** (Absolute Regel 1/3).

### Phase 3 — Absichern
- Regressionstest, der das neue Verhalten festnagelt (provider-bewusstes Auslesen bzw.
  geänderter Gather-Snapshot).
- **Temporäres Diagnose-Logging wieder entfernen** (keine dauerhaft abgeschaltete
  Sicherung / kein PII-Logging im Bestand).
- `node --check` + `npm test` grün.

### Phase 4 — Live-Re-Test (Akzeptanz)
Erneuter Owner-Test-Call → **Akzeptanzkriterium:** ≥1 `role:caller`-Zeile im Transkript
**und** der Agent antwortet inhaltlich auf das Gesagte.

## Betroffene Dateien (je nach Fall)
- `src/server.js` — `/voice/turn` (Phase 0 temporäres Log; Phase 2 `extractSpeech`-Aufruf).
- `src/telephony/adapters/telnyx/render.js` — nur in Fall 3 (`transcriptionEngine`).
- `src/telephony/…` — neuer kleiner provider-bewusster Speech-Reader (Fall 1/2), an der
  Renderer-/Adapter-Naht, parallel zu bestehender Provider-Logik.
- `test/*.test.js` — Regressionstest (Phase 3).

## Pre-Mortem (ein Jahr später — der Fix ist gescheitert / hat geschadet)

- **PM1 — Wieder geraten:** Wir mappen einen Feldnamen blind (wie `455bd71`) und gehen
  ohne die Live-Beobachtung live → dritter Fehlschlag, Vertrauensverlust.
  *Gegenmaßnahme:* Hartes Gate — **kein Fix wird gemerged, bevor der echte Telnyx-POST-Body
  beobachtet und im PR/Plan dokumentiert ist.**
- **PM2 — Brüchiges Feld-Mapping:** Der gemappte Feldname gilt nur für eine bestimmte
  Engine/Locale oder unterscheidet sich In-/Outbound → stille Regression.
  *Gegenmaßnahme:* Gegen Telnyx-Doku **und** Live-Beleg absichern, Regressionstest, nicht
  aus einem einzigen Call generalisieren.
- **PM3 — DSGVO-Leck durch Diagnose-Logging:** Roh-Transkript / volle Rufnummern landen in
  Render-Logs und durchbrechen die mühsam gebaute Datenminimierung (Roh-Transkript-Purge,
  EU-Region). *Gegenmaßnahme:* Nur **Feld-Namen + Präsenz/Länge** loggen, nie Roh-Werte;
  zeitlich befristet; Logging in Phase 3 wieder entfernen.
- **PM4 — Sicherung aufgeweicht:** Jemand „repariert" den Callback, indem die
  Telnyx-Signaturprüfung deaktiviert oder `SKIP_*` live gesetzt wird → öffnet genau das
  Kosten-/Spoofing-Loch, das das Gate schließt (Absolute Regel 1/3).
  *Gegenmaßnahme:* Signatur-Gate bleibt fail-closed; bei Signatur-Ursache den Verifier
  **korrekt** (provider-bewusst) fixen, nie umgehen.
- **PM5 — Test-Call eskaliert Kosten:** Re-Greet-Schleife hält den Call offen und summiert
  Claude-Turns/Minuten, oder es wird eine Nicht-Allowlist-Nummer getroffen.
  *Gegenmaßnahme:* Max-Dauer-Timer ist bereits scharf (`server.js:284`); nur
  Allowlist-Nummer; `MAX_BUDGET_EUR`/Max-Dauer bleiben unangetastet; Test-Call kurz halten.
- **PM6 — Falsche Wurzel „gefixt":** Reflexartiger Wechsel auf `transcriptionEngine="Google"`
  „funktioniert" im Test, maskiert aber ein Feldnamen-Problem und kostet mehr.
  *Gegenmaßnahme:* Engine nur wechseln, wenn das Log „Feld vorhanden, aber leer" mit
  `"Telnyx"` **belegt** — sonst ist es ein Mapping-, kein Engine-Problem.

## Verifikation
- **Lokal (kann den Bug NICHT abdecken):** `node --check src/server.js`, `npm test` grün,
  optional `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start` + `curl` auf `/voice/turn`
  mit gesetztem `SpeechResult` — beweist nur den **serverseitigen** Pfad, nicht Telnyx.
- **Entscheidend (live):** Owner-Test-Call → ≥1 `role:caller`-Zeile + inhaltliche Antwort.
  Belegen via Telnyx-Debugger (echter POST) **und** Dashboard/Transkript.

## Scope-Guard
Nur das Gemeldete (Inbound-STT) fixen. Kein Umbau der Realtime-Engine, keine
Provisioning-/Billing-Themen — die sind nicht Teil dieses Bugs (Absolute Regel 6).
