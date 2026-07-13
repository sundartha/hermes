# Handoff-Prompt: ElevenLabs-Stimme via `<Play>` (Hören + Barge-in bleiben) — phase-impl

> Diesen gesamten Block als erste Nachricht in eine frische Session geben.

---

Führe den **vollen `phase-impl`-Workflow** (Skill `phase-impl`) fuer das unten
beschriebene Feature aus: Plan -> Implementieren (Worktree) -> dualer Review
(Safety/Verhalten + Clean-Code). Der dualer Review ist hartes Gate.

**ZUERST lesen, dann handeln** (CLAUDE.md-Regel: verlass dich NICHT auf diese
Zusammenfassung fuer Code-Details, lies die echten Dateien NEU — Zeilennummern
koennen verschoben sein):
- `CLAUDE.md`
- `.claude/refs/workflow.md`
- `.claude/refs/clean-code.md`
- `PLAN-SECURITY.md`

Modell-Politik: Subagenten explizit pinnen — **Opus** fuer Plan + Safety-Review,
**Sonnet** fuer Impl/Audit/Report. NIE Fable erben lassen.

---

## Kontext

Hermes = autonomer Telefon-KI-Agent (Node/ESM, kein Build-Step, `node:test`).
Live laeuft die **Budget-Engine** (`VOICE_ENGINE=budget`): turn-basiert,
Provider-STT/TTS ueber Telnyx TeXML, Claude Haiku als Gehirn. Live-Provider =
**Telnyx**. TTS aktuell = Azure Neural (`Azure.de-DE-KatjaNeural`). Vision:
Produkt fuer Millionen Nutzer — saubere, skalierbare Loesung, kein Wegwerf-Code.

## Das Problem (EMPIRISCH VERIFIZIERT — Beleg unten, nicht neu noetig)

ElevenLabs als Stimme geht bei Telnyx nur ueber den **Live-Relay**
(`<Say voice="ElevenLabs.Default.<id>" api_key_ref="...">`). Telnyx baut waehrend
des Calls eine Live-Verbindung zu ElevenLabs auf und streamt in Echtzeit — dieser
**Relay-Stream unterdrueckt den Inbound-Track** -> Deepgram-STT liefert LEER ->
der Agent hoert den Angerufenen NICHT. Der Kommentar in
`src/telephony/adapters/telnyx/render.js` (~Z.60: "STT bleibt UNBERUEHRT") ist
damit WIDERLEGT und im Zuge des Fixes zu korrigieren.

Wichtig: Der Ausloeser ist der **Relay**, NICHT die Stimme an sich. Native
Wiedergabe (Azure) laesst den Inbound-Track leben — Transkription laeuft dort
GLEICHZEITIG mit dem Speak (belegt).

## Die Loesung (Scope dieses Tasks)

ElevenLabs-Audio **vorab als fertige Datei** erzeugen (unser Server) und per
**`<Play>` INNERHALB des `<Gather>`** abspielen statt Live-Relay-`<Say>`. Fuer
Telnyx ist das native Wiedergabe (wie Azure-Audio) -> kein Relay -> Inbound-Track
lebt -> **Hoeren + gleichzeitiges Zuhoeren (Azure-Niveau-Unterbrechbarkeit)
bleiben, mit echter ElevenLabs-Stimme.**

Ziel-TeXML (ElevenLabs aktiv):
```
<Gather input="speech" transcriptionEngine="Deepgram" model="deepgram/nova-3"
        language="de-DE" speechTimeout="..." action="..." method="POST">
  <Play>https://<host>/voice/tts/<token></Play>
</Gather>
```
ElevenLabs aus / Synth-Fehler / Timeout -> **byte-identisch Azure-`<Say>`** wie
heute.

Klarstellung "unterbrechbar": BEWIESEN ist "Telnyx hoert waehrend der Agent redet"
(native Wiedergabe -> Mikro offen). NICHT bewiesen (fuer TeXML generell, Azure wie
Play) ist HARTES Barge-in (Agent verstummt in der Millisekunde des Reinredens);
das gaebe es nur mit dem S2S-Streaming-Stack. Play liefert also GENAU das
Unterbrechungs-Niveau, das Azure heute hat — plus die ElevenLabs-Stimme.

## Was NICHT tun (Guardrails)

- KEIN Streaming-Stack, KEIN `bridge.js`, KEINE neue Engine. NUR der
  Play-Prompt-Pfad in der bestehenden Budget-Engine.
- Azure-Pfad bleibt BYTE-IDENTISCH, wenn das Flag aus ist. Twilio-Pfad komplett
  unberuehrt.
- Safety-Gates (CLAUDE.md Regel 1) unangetastet. Offenlegungssatz (Regel 2)
  bleibt fest verdrahtet, verbatim, als ERSTER Satz — jetzt als Audio, aber
  gleicher Text, gleiche Position.
- Regel 6 (Scope): NUR das bauen, was hier steht.

## Absolute Constraints / Design-Vorgaben

1. **Fallback fail-SAFE (nicht fail-closed):** Jeder Synth-Fehler/Timeout ->
   Azure-`<Say>`. NIE den Call toeten (ein datengetriebenes TTS-Gate darf kein
   laufendes Gespraech killen — Muster wie der bestehende `sayVoiceAttrs`-Gate).
2. **Gate:** Hinter Config-Flag, Default AUS -> Azure byte-identisch (Muster wie
   `config.telnyxElevenLabs` / `PAYMENT_ENABLED`).
3. **Latenz:** Der Synth-Call darf den Webhook nicht sprengen (Telnyx wartet auf
   die TeXML-Antwort; der Claude-Call sitzt da schon drin). Hartes Timeout Pflicht.
   -> Entscheidung im Plan: Synth beim Webhook vs. beim Telnyx-Fetch (stateless,
   haelt den Webhook schnell).
4. **PII:** Die ausgelieferte Audiodatei enthaelt den gesprochenen Agent-Satz
   (evtl. Namen/Termine). Unratbarer Token, kurze TTL, EINMALIG abrufbar, danach
   loeschen. Neue Ausgabe-Surface in `PLAN-SECURITY.md` dokumentieren.
5. **Secret:** Falls Direkt-ElevenLabs (Option A unten): NEUER ElevenLabs-API-Key
   in `.env` / Render / `config.js` / `.env.example` / `render.yaml`. NIE
   loggen/leaken/in Responses.
6. **Multi-Instanz/Skala:** In-Memory-Cache bricht ueber mehrere Render-Instanzen
   (Telnyx fetcht evtl. von anderer Instanz als der, die synthetisiert hat). Fuer
   Skala: stateless-synth-on-fetch ODER Telnyx-Media-Storage ODER shared Store.
   Entscheidung im Plan (Vision = Millionen Nutzer, also skalierbar schneiden).
7. Kommentare Deutsch OHNE Umlaute. Env-Vars zentral in `config.js` +
   `.env.example` (+ `render.yaml` pruefen).

## Design-Entscheidungen (im Plan-Schritt loesen, dem Owner vorlegen)

- **Audio-Quelle:**
  - (A) ElevenLabs-API direkt: `POST https://api.elevenlabs.io/v1/text-to-speech/<voice_id>`
    (Model `eleven_flash_v2_5` fuer Latenz; output `mp3` oder `ulaw_8000`).
    Braucht UNSEREN ElevenLabs-API-Key im Env.
  - (B) Telnyx-TTS-API als DATEI: `POST https://api.telnyx.com/v2/text-to-speech/speech`
    mit ElevenLabs-Voice. Nutzt das BESTEHENDE Telnyx-Integration-Secret ->
    KEIN neuer Key. PRUEFEN, ob der `/speech`-Endpoint ElevenLabs-Voices via
    `api_key_ref` akzeptiert; wenn ja, ist B einfacher.
  - Beide liefern eine STATISCHE Datei -> kein Live-Relay -> keine Inbound-
    Unterdrueckung. Der Knackpunkt ist NUR "statische Datei statt Live-`<Say>`".
- **Synth-Zeitpunkt:** Webhook-Zeit vs. Telnyx-Fetch-Zeit.
- **Fester Offenlegungssatz:** einmal vorab rendern + cachen (jedes Mal identisch)
  statt pro Call neu synthetisieren.
- **Format:** mp3 vs wav/ulaw fuer Telnyx `<Play>` (Play unterstuetzt mp3/wav).

## Betroffene Dateien (Zeilen ca. — per Read RE-VERIFIZIEREN)

- `src/telephony/adapters/telnyx/render.js`:
  - `TELNYX_VOICE`-Map (~17-24); `sayVoiceAttrs` (~65-73, ElevenLabs-Relay-Gate —
    bei aktivem Play NICHT mehr den Relay nutzen); `gatherAttrs` (~100-108);
    `renderGather` (~110-114, hier `<Play>` statt `<Say>` wenn Audio-URL da);
    `renderDirective` (~127-142). Falschen Kommentar ~Z.60 korrigieren.
- `src/telephony/directives.js`: `DIRECTIVE`-Enum; `gatherD` (~40-44) — Feld
  `promptAudioUrl` ODER eine `PLAY`-Noun einfuehren.
- `src/server.js`: `turnDirectives` (~784-791), `followupTurnDirectives` (~804),
  `sayInCallVoice` (~797-798) — Synth + Store + URL einweben; NEUER Serve-Endpoint
  `GET /voice/tts/:token` (Auth-Ausnahme wie `/voice`, Begruendung im Kommentar;
  oeffentlich erreichbar -> Token + kurze TTL sind die einzige Absicherung).
- `src/config.js`: neuer Gate-Flag + (bei Option A) ElevenLabs-Key + Voice-Id +
  Model.
- `.env.example`, `render.yaml`: neue Env-Vars.
- `PLAN-SECURITY.md`: PII-Audio-Serve-Surface + akzeptiertes Restrisiko.

## ElevenLabs/Telnyx-Fakten (Memory-Stand, ggf. veraltet — verifizieren)

- ElevenLabs-Account "ElevenCreative", Plan Starter. Voice "Ela" =
  `SJJe86Va82zRzg6zi2dX`. Telnyx-Integration-Secret identifier = `elevenlabs_prod`.
- Telnyx TTS Voices-Liste: `GET https://api.telnyx.com/v2/text-to-speech/voices`
  (Bearer `TELNYX_API_KEY`).
- Telnyx TTS Synth (getestet, HTTP 200 audio/mpeg mit Azure-Voice):
  `POST https://api.telnyx.com/v2/text-to-speech/speech` Body `{voice, text}`.
- Lokale `.env` hat `TELNYX_API_KEY` + `TELNYX_ACCOUNT_SID` gesetzt (fuer
  Diagnose/call_events). `TELNYX_ELEVENLABS_*` lokal leer, DATABASE_URL lokal leer.

## Verifikation (Feedback-Loop, CLAUDE.md-Regel 7)

- **Unit-Tests (`node:test`):** Synth-Modul (fake fetch: Erfolg / Timeout /
  Fehler), Serve-Endpoint (Token gueltig / abgelaufen / 2x -> weg), Fallback-Pfad
  (Synth-Fehler -> Azure-`<Say>`), Render-Snapshot fuer den Play-Pfad. Bestehende
  Telnyx-Snapshot-Tests muessen bei Flag AUS byte-identisch bleiben.
- `npm test` gruen + `node --check` der geaenderten Dateien.
- **Lokaler Smoke:** `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`, dann
  `curl` gegen `/voice/outbound` und `/voice/turn`: TeXML enthaelt `<Play>` bei
  Flag AN, `<Say>` bei AUS; `/voice/tts/<token>` liefert Audio genau einmal.
- **Owner-Probe-Anruf (NICHT automatisierbar — dem Owner ueberlassen, als offener
  Punkt parken):** ElevenLabs-Flag an, ein echter Anruf. Danach in Telnyx
  `call_events` pruefen, dass `SpeechResult` GEFUELLT ist waehrend die Play-Voice
  laeuft -> beweist Hoeren + Unterbrechbarkeit mit ElevenLabs. DAS ist das
  "fertig"-Gate fuer Q2.
  - Curl-Muster (Key nie echoen):
    `API=$(grep '^TELNYX_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'"'')`
    `curl -s -G https://api.telnyx.com/v2/call_events --data-urlencode "filter[occurred_at][gte]=<ISO>" -H "Authorization: Bearer $API"`
    per `jq` die Records `name=="speak"` (Feld `.payload.voice`) und
    `name=="instructions.fetch"` (Feld `.payload.request.body.SpeechResult`) lesen.

## Belege (verifizierte A/B-Daten, zur Referenz — Telnyx call_events)

Identisches TeXML in allen dreien (`<Gather input="speech" Deepgram nova-3 de-DE>`
mit verschachteltem Prompt), EINZIGE Variable = Voice:

| Call | call_control_id | Voice | SpeechResult | Hoeren |
|---|---|---|---|---|
| 07-03 07:46 | `v3:kGQL...` | Azure Katja | "Morgen 18 Uhr." | JA |
| 07-06 09:55 | `v3:xytUP1...` | ElevenLabs SJJe (premium) | "" / Confidence null | NEIN |
| 07-06 11:10 | `v3:EdFC23...` | Azure Katja | "Ist da jetzt etwas, der mich versteht?" | JA |

Zeitstempel-Beweis (Azure 11:10): `TRANSCRIPTION_START 48.398` -> `SPEAK_STARTED
49.137` -> `TRANSCRIPTION_STOP 56.429` -> `SPEAK_ENDED 56.741` — Transkription
laeuft GLEICHZEITIG mit dem Speak (= Zuhoeren waehrend des Redens). ElevenLabs
09:55: gleiche Nebenlaeufigkeit, aber SpeechResult leer -> Relay unterdrueckt
Inbound.

## Prozess

1. `phase-impl` starten. Plan-Schritt loest die Design-Entscheidungen oben.
2. Plan dem Owner ZUR FREIGABE vorlegen, BEVOR implementiert wird.
3. Nach Impl: dualer Review (Safety + Clean-Code) als hartes Gate, Self-Fix bis
   PASS.
4. Verifikation wie oben; Owner-Probe-Anruf als offenen Punkt uebergeben.
5. Kein Deploy ohne Owner-Freigabe.
