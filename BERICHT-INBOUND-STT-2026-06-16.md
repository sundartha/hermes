# Bericht: Inbound-STT — "Die KI hört mich nicht" (Telnyx, Budget-Engine)

> Untersuchung 2026-06-16 durch ein 3-strängiges Agent-Team (Deploy-Realität,
> Telnyx-TeXML-Dokumentationsvertrag, Server-/Config-Code-Pfad). Methode: 5-Why,
> Wurzel statt Symptom. Baut auf `PLAN-INBOUND-AUDIO-STT.md` auf.

## Symptom

Echter Test-Anruf (heute): Der Agent **redet** (TTS hörbar), reagiert aber **nicht
auf die Stimme** des Anrufers. Das Transkript füllt sich nur mit `role:agent`, nach
Stille begrüßt der Agent neu. Outbound (Agent → Mensch) ok, Inbound (Mensch → Agent)
defekt.

## Was das Team gesichert hat (Belege, nicht Vermutung)

### Strang 1 — Deploy-Realität: die Repo-Split-Falle ist diesmal AUSGESCHLOSSEN
- LIVE (`upstream` jonas986/master, das von Render deployte Repo) = `origin` = lokaler
  HEAD = **`fb59001`**, byte-identisch (0/0-Divergenz zu beiden Remotes), `autoDeploy:
  true`, `region: frankfurt`.
- Der **Deepgram-STT-Code** (`transcriptionEngine="Deepgram"`, `model="deepgram/nova-3"`,
  `language="de"`) steht **live**.
- Das **temporäre Diagnose-Log `[turn-recv]`** in `/voice/turn` (`src/server.js:435`)
  steht **live**.
- **Folge:** Der Test-Anruf lief gegen den NEUEN Code — nicht (wie in der früher
  verbrannten Session) gegen Vor-Fix-Code. Die Deploy-Hypothese scheidet als Ursache aus.

### Strang 2 — Telnyx-TeXML-Vertrag (offizielle Doku, mit Quellen)
- **Feldname korrekt:** Telnyx liefert das Transkript SYNCHRON im POST an die
  Gather-`action`, Feldname `SpeechResult` — exakt wie der Server liest
  (`server.js:445`). Feldnamen-Mismatch ist damit **ausgeschlossen**.
  (Quelle: `developers.telnyx.com/api-reference/callbacks/texml-gather`, OpenAPI
  `TexmlGatherWebhookSchema`.)
- **Attribute formal gültig:** `transcriptionEngine` und `model` existieren am
  `<Gather>`; `Deepgram` + `deepgram/nova-3` ist dokumentierte Schreibweise. ABER:
  `nova-3` ist sichtbar dünner dokumentiert als `nova-2`.
- **Sprachcode:** Telnyx reicht `language` bei Deepgram **ohne Validierung** an die
  Engine durch → ein von der Engine nicht akzeptierter Code scheitert **still** (leeres
  `SpeechResult`), nicht laut. `de` ist plausibel, `de-DE` lt. Doku ebenfalls gültig.
- **Deepgram-Freischaltung:** Doku sagt NICHTS dazu, ob Deepgram erst im Account
  aktiviert werden muss. Indirekt: weil Telnyx Parameter ungeprüft durchreicht, scheitern
  falsche Engine-/Modell-Kombis vermutlich **still** (leeres `SpeechResult`).
- **Relative action-URL:** Doku sagt NICHTS zu relativen URLs mit Query-String; **alle**
  offiziellen Beispiele nutzen ABSOLUTE URLs. Ob `?callId=` bei einer relativen URL
  erhalten bleibt, ist nicht belegt.

### Strang 3 — Server-/Config-Code-Pfad
- **Symptom-Mechanik bestätigt:** `agentTurn(call, null)` (`claude.js:170-186`) fügt bei
  leerem `callerText` ein Re-Greet ein ("[Der Anrufer ist in der Leitung. Begrüße ihn.]").
  Genau das beobachtete Verhalten.
- **Live-Pfad = Telnyx:** `.env` hat `TELNYX_NUMBER`/`TELNYX_*` gesetzt, `TWILIO_*` leer;
  `VOICE_ENGINE=budget`. Der Test-Anruf lief also über Telnyx, Budget-Engine.
- **action-URL ist RELATIV:** `turnDirectives` (`server.js:333`) baut
  `/voice/turn?callId=…`; weder Telnyx- noch Twilio-Renderer macht sie absolut.
- **Server liest nur `SpeechResult`** (`server.js:445`) — kein provider-bewusster Reader.
- **Signaturprüfung** (`server.js:220`) ist provider-bewusst und fail-closed (403 bei
  fehlenden Telnyx-Headern). Nachrangig (siehe unten), aber nicht 0.

## 5-Why — Wurzel statt Symptom

1. **Warum reagiert die KI nicht auf die Stimme?**
   `/voice/turn` verarbeitet ein leeres `SpeechResult` → `agentTurn(call, null)` → Re-Greet.
2. **Warum ist `SpeechResult` leer?**
   Eine von drei sich **gegenseitig ausschließenden** Ursachen (siehe Verzweigung). Der
   Feldname ist NICHT die Ursache (Strang 2 belegt `SpeechResult` als korrekt).
3. **Warum konnten wir die Ursache bisher nicht festnageln?**
   Der Inbound-STT-Pfad ist **nur live** beobachtbar (echte Telnyx-Telefonie, Store/Logs
   auf Render). Lokal nicht reproduzierbar; die Test-Suite nagelt nur das *gerenderte*
   TeXML + das *serverseitige Lesen* fest — nicht, was Telnyx tatsächlich POSTet.
4. **Warum hat der vorige Versuch (Deepgram-Umstellung `fb59001`) das Symptom nicht
   behoben?**
   Er tauschte die Engine (Telnyx-in-house → Deepgram), OHNE die eine entscheidende
   Beobachtung zu haben: den realen `[turn-recv]`-Output eines Anrufs. Engine-Tausch ohne
   Beobachtung = dieselbe Wurzel wie beim Vorgänger-Fix `455bd71`.
5. **Wurzel.**
   - *Technisch:* Der reale Telnyx-Gather-Callback an `/voice/turn` ist **unbeobachtet** —
     es ist offen, ob der POST überhaupt korrekt ankommt (relative action-URL / callId) und
     ob Deepgram ein Transkript liefert (Freischaltung / Modell / Sprache).
   - *Prozess:* Wiederholtes Fixen auf Basis einer unbestätigten Kausal-Theorie für einen
     Pfad, der nur live beobachtbar ist. **Gegenmaßnahme bereits deployt:** das
     `[turn-recv]`-Log liefert jetzt genau diese Beobachtung.

## Die entscheidende offene Beobachtung (EIN Schritt)

Das Diagnose-Log ist **live und scharf**. Der nächste Schritt ist NICHT Code ändern,
sondern den **Render-Log während eines Anrufs lesen** (Region Frankfurt). Die
`[turn-recv]`-Zeile trennt alle drei Äste eindeutig:

| Beobachtung im Render-Log | Diagnose | Fix |
|---|---|---|
| **Kein** `[turn-recv]` + ein **403** | Signaturprüfung weist Telnyx-POST ab (Body nie gelesen) | Telnyx-Signatur-Verifier provider-korrekt machen — **niemals abschalten** (Regel 1/3) |
| **Kein** `[turn-recv]`, **kein** 403 | Telnyx erreicht `/voice/turn` nie → relative action-URL falsch aufgelöst | `action` **absolut** machen: `config.publicUrl + "/voice/turn?callId=…"` |
| `[turn-recv]` mit `callId=FEHLT` | Query-String `?callId=` ging verloren | dito — action absolut |
| `[turn-recv]` mit `callId=…`, aber **kein/leeres** `SpeechResult`-Feld | Deepgram-STT liefert nichts (Add-on nicht aktiv / `nova-3`/`de` nicht bedient) | `transcriptionEngine="Telnyx"` od. `"Google"` bzw. `model="deepgram/nova-2"` testen; ODER Deepgram im Telnyx-Portal freischalten |

**Wahrscheinlichkeits-Ranking (bis zur Log-Beobachtung):**
1. Relative action-URL / Routing (Doku-Beispiele alle absolut; billiger, risikoarmer Fix)
2. Deepgram nicht freigeschaltet / still scheiternd (Premium-Add-on, Commit-Note `fb59001`
   warnt selbst davor)
3. `model="deepgram/nova-3"` nicht bedient → `nova-2`
4. `language="de"` → `de-DE`
5. Signatur-403 (nachrangig: `/voice/incoming` hat dieselbe Prüfung bereits passiert)

## Hartes Gate (aus dem Pre-Mortem, weiterhin gültig)

**Kein Fix wird gemerged, bevor der echte Telnyx-POST-Body (`[turn-recv]`) beobachtet
und dokumentiert ist.** Sonst droht der dritte Fehlschlag durch Raten. Diagnose-Logging
nach dem Fix wieder entfernen (kein dauerhaftes PII-Logging). Signatur-Gate bleibt
fail-closed. Test-Call kurz halten, nur Allowlist-Nummer (Kosten/Max-Dauer-Gates
unangetastet).

## Quellen (Telnyx)
- `developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather`
- `developers.telnyx.com/api-reference/callbacks/texml-gather` (OpenAPI `TexmlGatherWebhookSchema`)
- `developers.telnyx.com/docs/voice/programmable-voice/speech-to-text`
- `developers.telnyx.com/docs/voice/stt/websocket-streaming/parameters/language`
