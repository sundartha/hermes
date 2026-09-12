# PLAN-INBOUND-PARITAET

**Frage:** Wie wird die Gesprächsqualität eines INBOUND-Anrufs so gut wie die eines
OUTBOUND-Anrufs — Stimme, Aussprache, Turn-Taking, Fähigkeiten?

**Stand:** 2026-09-12. Alle Aussagen unter "Ausgangslage" sind am Code dieses Commits
belegt (Datei + Symbolname, keine Zeilennummern — die rotten). Was nicht belegt ist,
steht ausschliesslich unter "Offene Messungen".

**Gegengelesen gegen den Code (2026-09-12, adversarialer Durchgang, ~45 Behauptungen).**
Drei Befunde sind übernommen und haben Abschnitte geändert, nicht nur Sätze:
die Konsumentenliste der Stimm-Auflösung (Abschnitt 5, Punkt 1 — Folgen in IP3, IP4, IP7
und in der Bewertungstabelle, samt neuer Fussnote (b)-Stimme, M10 und O7), die Zahl der
`fuer`-Vorkommen im Begrüssungskatalog (W2, IP1) und die Grösse des Bestands-Szenariensatzes
(Pre-Mortem P6, IP6). Nicht gemessen wurde in diesem Durchgang der Farbstand der Testbänke
(kein Testlauf) — daraus ist M11 geworden.

---

## 1. Ausgangslage: der belegte Ist-Unterschied

### 1.1 Welche Maschine in welcher Richtung spricht

| Achse | INBOUND (Mensch ruft uns an) | OUTBOUND (wir rufen an) | Beleg |
|---|---|---|---|
| Engine | Budget-Engine, turn-basiert: `POST /voice/incoming` → TeXML-`<Gather>` → `POST /voice/turn` | ElevenLabs-ConvAI-Agent über SIP-Trunk an derselben Telnyx-DID | `src/routes/voice.js` (Router-Aufbau), `src/elevenlabs/outbound.js` |
| Gehirn | `src/claude.js#agentTurn` (unser Tool-Loop, LLM-Seam `src/llm.js`) | LLM des Anbieters, Prompt am Agenten | `src/claude.js#agentTurn`, `elevenlabs/agent_configs/outbound-agent.template.json` |
| Weiche | keine: mit Repo-Defaults immer Budget-Engine | genau eine Verzweigung auf `config.voice.elevenLabsOutbound.enabled` | `src/telnyx-inbound.js#inboundHandoffDecision`, `src/routes/api-calls.js` |
| STT | Telnyx-Gather, `deepgram/nova-3` | Anbieter-eigenes STT | `src/telephony/adapters/telnyx/stt-model.js#sttAttrs` |
| Stimme (Default) | **Azure.de-DE-KatjaNeural** über TeXML-`<Say>` | ElevenLabs-Stimme `elevenLabsVoiceIdFor(...)` | `src/telephony/adapters/telnyx/render.js#voiceAttrs` (`TELNYX_VOICE_NAME`) vs. `src/elevenlabs/outbound.js#conversationConfigOverride` |
| Stimme (Flag an) | **dieselbe** ElevenLabs-Stimme wie Outbound | — | beide Seiten lösen über `src/telephony/adapters/telnyx/elevenlabs-voice.js#elevenLabsVoiceIdFor` auf |
| TTS-Modell | `eleven_flash_v2_5` (Latenz-optimiert, unser Default) | `tts.model_id` am Anbieter, **von der Vorlage ausdrücklich nicht besessen** | `src/config.js#elevenLabsPlayTts` vs. `outbound-agent.template.json` (`_besitz._nicht_besessen`: `tts.model_id`) |
| Barge-in | **nein** — TeXML-`<Gather>` kennt kein `bargeIn`-Attribut | ja, ausser am Pflicht-Erstsatz | `src/telephony/adapters/telnyx/render.js#gatherAttrs` vs. Vorlage (`disable_first_message_interruptions`) |
| Füllsatz bei Denkzeit | **nein** | ja, anbieter-nativ | Vorlage (`turn.soft_timeout_config`) |
| Nachlauf je Äusserung | fest `STT_SPEECH_TIMEOUT_SEC` (Default 2 s) statt `auto` | anbieter-eigene VAD | `src/telephony/voice-render.js#makeVoiceRender` (`followupTurnDirectives`), `src/config.js` (`sttSpeechTimeoutSec`) |
| Werkzeuge | `end_call`, `take_message` | `end_call`, `get_consult`, `look_up`, `voicemail_detection`, `language_detection` | `src/consult/in-call.js#consultAvailableFor`, `src/research/in-call.js#lookupProviderFor` (Richtungs-Gate), Vorlage (`built_in_tools`) |
| Sprachwahl | einmalig VOR dem ersten Wort, danach unveränderlich | `language_detection` + Wechselprotokoll im Prompt | `src/store/state-ops.js#resolveCallLanguage` vs. Vorlage |
| Pflichtsatz | von UNS gerendert (`inboundNotice` + Begrüssung) | `first_message` am Anbieter | `src/routes/voice.js` (`withInboundNotice(greetingForLanguage(...))`), `src/i18n/inbound-notice.js#withInboundNotice` |
| Kostenprofil | `TELNYX_INBOUND_BUDGET` | `EL_CONVAI_SIP` | `src/billing/kostenarten.js#KOSTENPROFIL`, `#kostenprofilFuerAnruf` |

### 1.2 Die vier belegten Wurzeln der Owner-Beschwerde

**W1 — "andere Stimme" hat GENAU EINEN Schalter, nicht zwei driftende.**
Der Befund D2-stimme behauptet, Inbound lese selbst bei aktivem Play-TTS eine *andere*
ElevenLabs-Stimme als Outbound. **Das ist am Code widerlegt.** Outbound setzt die Stimme
pro Anruf per `conversation_config_override` (`src/elevenlabs/outbound.js#conversationConfigOverride`,
`tts: { voice_id: locale.voiceId }`), und `locale.voiceId` entsteht in
`src/elevenlabs/call-locale.js#callLocaleFor` aus **genau demselben Resolver**, den der
Inbound-Play-TTS-Pfad benutzt: `elevenLabsVoiceIdFor` in
`src/telephony/adapters/telnyx/elevenlabs-voice.js`. Für `de`/`fr`/`en` trägt
`ELEVENLABS_VOICE_ID_BY_PROFILE` eine eigene Kennung, der Rückfall auf die
Plattform-Stimme greift dort nie. Der Anker existiert also schon und ist G5-konform
geteilt. Was Inbound und Outbound trennt, ist **ein einziges Flag**:
`ELEVENLABS_PLAY_TTS_ENABLED` (`src/config.js#elevenLabsPlayTts`, Fallback `false`,
`render.yaml` `"false"`). Aus → `<Say voice="Azure.de-DE-KatjaNeural">`. An → `<Play>`
derselben Stimme, die Outbound spricht.

**W2 — der erste gesprochene Satz jedes Inbound-Anrufs trägt eine falsche Schreibweise.**
`DEFAULT_GREETING` (`src/store/defaults.js`) enthält `fuer` statt `für` **genau einmal**
("Ich kann eine Nachricht fuer {owner} aufnehmen."); die erste kuratierte Zusatzvorlage
(`LOCALES.de.greetingVariants[0]`, `src/i18n/locales.js`) ebenfalls genau einmal. Die
zweite Zusatzvorlage (`greetingVariants[1]`) ist sauber. Also **zwei** Vorkommen im
gesamten DE-Katalog, nicht drei. Nachgezählt über den echten Render-Weg: **2 von 3
deutschen Begrüssungsvorlagen**
(`greetingTemplatesFor("de")`) treffen die Transliterations-Denylist
`SPOKEN_TRANSLITERATION_STEMS` (`test/umlaut-stems-helper.js`). Der Pin-Test
`test/de-umlaut-orthography.test.js` deckt sie **nicht** ab: seine Liste `SPOKEN_DE_FIELDS`
führt S1–S14, `greetingDefault`/`greetingVariants` fehlen darin. Der vorangestellte
Pflichtsatz selbst ist korrekt (`src/i18n/inbound-notice.js`, `INBOUND_NOTICES.de` trägt
"Gespräch") — der Anrufer hört also im selben Atemzug eine korrekte und eine falsche
Schreibweise. Das passt exakt zum Owner-Bericht "inbound falsch, outbound richtig":
Outbound spricht `LOCALES.de.disclosure` + LLM-Eröffnung, beide gepinnt bzw. modellerzeugt.

**W3 — dieselbe Sprecherin kann trotzdem schlechter klingen: das TTS-MODELL ist nicht
angeglichen.** Inbound-Play-TTS synthetisiert mit `eleven_flash_v2_5`
(`src/config.js#elevenLabsPlayTts`, `ELEVENLABS_MODEL`-Default, Kommentar
"Latenz-optimiert"). Das Modell des Outbound-Agenten (`tts.model_id`) steht im
Anbieter-Dashboard und ist von der Vorlage **ausdrücklich nicht besessen**
(`outbound-agent.template.json`, `_besitz._nicht_besessen`), also auch nicht
drift-geprüft. Es kann eine andere Modellklasse sein. Gleiche Stimm-ID, anderes Modell =
hörbar andere Prosodie/Qualität. Das ist die einzige Stimm-Differenz, die **nach** dem
Flag-Flip aus W1 übrig bleibt.

**W4 — Turn-Taking-Parität ist innerhalb der Budget-Engine strukturell unerreichbar.**
Das ist keine Meinung, sondern eine Plattformgrenze: `gatherAttrs`
(`src/telephony/adapters/telnyx/render.js`) setzt `input/language/transcriptionEngine/
model/speechTimeout` — TeXML hat für diesen Prompt kein `bargeIn`. Und das vorhandene
Denk-Signal-Modul ist auf diesem Pfad nicht "unverdrahtet", sondern **kanallos**:
`src/routes/voice.js` ruft `agentTurn(call, heard || null)` ohne `onSpeechChunk`, weil
eine TeXML-Antwort **ein** Dokument ist, das erst entsteht, wenn die Arbeit fertig ist —
es gibt keinen Sprechkanal *während* des Turns, in den ein Füllsatz fallen könnte
(`src/thinking-signal.js#makeThinkingSignal` benennt genau das im JSDoc). Der
Assistant-Pfad hat den Kanal (`src/telnyx-llm-shim.js` übergibt `onSpeechChunk:
speakChunk`). Wer Inbound-Turn-Taking will, muss also die Engine wechseln — kein
Flag, kein Timeout-Tuning bringt das.

### 1.3 Was am Inbound-Webhook hängt (und warum das die Weiche entscheidet)

`POST /voice/incoming` ist die **einzige** Naht, an der für einen eingehenden Anruf
folgendes passiert — alles in `src/routes/voice.js`:

1. Ed25519-Signaturprüfung, fail-closed (`router.use("/voice", ...)`, Adapter
   `src/telephony/adapters/telnyx/signature.js`)
2. Wiederholungs-Riegel (`src/telephony/webhook-idempotenz.js#makeWebhookIdempotenz`)
3. Tenant-Auflösung **nach** der Signatur (`store.numberRecordByE164`) — Anti-Spoofing;
   unbekannte Nummer → höflicher Hangup, kein Call, keine Kosten
4. pro-Tenant-Kostendecke, sperrt auch Inbound (`store.budgetExceeded`)
5. Max-Dauer-Notbremse (`brakeSecondsFor`, `lifecycle.armMaxDurationTimer`)
6. Kostenprofil (`store.recordCostProfile(..., KOSTENPROFIL.TELNYX_INBOUND_BUDGET)`)
7. der **fest verdrahtete Inbound-Pflichtsatz**
   (`withInboundNotice(greetingForLanguage(...))`)

Und: der bereits gebaute Assistant-Handoff liegt **hinter** all dem
(`inboundAssistantHandoffXml({ call, provider, body, greeting, voiceProfile })`) und
bekommt den fertigen Pflichtsatz als Wert übergeben. Ein Inbound-Weg, der diesen Webhook
nicht durchläuft, hat keine dieser sieben Sicherungen.

---

## 2. Leitentscheidung

> **(c) zuerst, (b) danach als vorbereitete Weiche, (a) verworfen.**
>
> Inbound wird in der turn-basierten Engine gezielt nachgebessert — Aussprache und
> Stimme sind dort in Tagen und mit kleinstem Radius auf Outbound-Niveau zu bringen,
> weil der Stimm-Anker schon geteilt ist (W1). Turn-Taking-Parität (Barge-in,
> Denkpausen-Füllsätze) ist in der Budget-Engine strukturell unerreichbar (W4) und
> bekommt genau einen Weg: den bereits gebauten Telnyx-AI-Assistant-Inbound-Handoff,
> der hinter unserem Webhook und damit hinter allen Gates liegt. Der ElevenLabs-Agent
> wird für Inbound **nicht** freigeschaltet, solange das nur über
> `inbound_trunk_config` ginge: dieser Weg leitet den Anruf auf SIP-Ebene am
> Inbound-Webhook vorbei und damit an sieben Sicherungen vorbei, den Pflichtsatz
> eingeschlossen.

### Bewertung aller drei Wege

| | (a) EL-ConvAI für Inbound | (b) Telnyx-AI-Assistant-Inbound | (c) Budget-Engine nachbessern |
|---|---|---|---|
| Qualitätsgewinn Stimme | maximal (identisch, weil derselbe Agent) | **null, und schlechter als "null" klingt** — der Assistant spricht **eine einzige statische Plattform-Stimme für jede Sprache** (s. Fussnote (b)-Stimme) | **voll** (W1: ein Flag, derselbe Resolver) |
| Qualitätsgewinn Aussprache | keiner (der Satz wäre Anbieter-Konfiguration) | keiner (unser Greeting reist als Wert mit) | **voll** (W2 ist unser Literal) |
| Qualitätsgewinn Turn-Taking | maximal | **hoch** (Barge-in, `onSpeechChunk`-Kanal existiert) | **keiner** (W4, Plattformgrenze) |
| Qualitätsgewinn Fähigkeiten | hoch, aber unerwünscht: `get_consult`/`look_up` sind für Inbound **absichtlich** gesperrt | keiner (gleiches Gehirn, gleiches Gate) | keiner |
| Aufwand | gross (Trunk, Gates neu bauen, Pflichtsatz verlagern) | gross (answered-Ereignis abwarten, belegter 422-Blocker) | **klein** (Literal, Flag, Test) |
| Betriebsrisiko | **unannehmbar**: Gate-Umgehung by construction | mittel: belegter Provider-Race, Rückweg ist ein Flag | klein: Flag aus = byte-identisch |
| Kosten je Anruf | anbieter-eigene Turn-Abrechnung; Lehre `elevenlabs-kosten-pro-turn`: ein *kürzerer* Anruf war teurer | **~3x**: ~5 US-Cent/angefangene Minute gegen 1,87 auf der Budget-Engine (Messung KV-M1, zitiert in `src/config.js` an `telnyxAssistant.inboundHandoffEnabled`) | +EL-Zeichen, gedeckelt durch den bestehenden Kontingent-Riegel (`src/tts/directive-synth.js#warnQuotaDegradation`) |
| Wahrheiten danach im Code | 3 (Budget + Assistant + EL), bis Outbound *und* Inbound dort laufen | 2 (Assistant live, Budget als Rückweg) — aber **ein** Gehirn (`agentTurn` via Shim) | 1 (der Bestand), Stimm-Auflösung bereits geteilt |

**Fussnote (b)-Stimme (belegt, und schärfer als ein blosses "null"):** der
Telnyx-AI-Assistant-Pfad löst die Stimme **nicht** nach Sprache auf. Beide Stellen, die
seine Stimme setzen, benutzen die rohe Namensfunktion `elevenLabsVoiceName(el)` mit der
**einen** statischen Plattform-Stimme `config.telnyx.telnyxElevenLabs.voiceId`
(`TELNYX_ELEVENLABS_VOICE_ID`): der Pflichtsatz-Speak-Node
(`src/telephony/adapters/telnyx/voice.js#speakVoiceFields`) und die Assistant-Ressource
selbst (`scripts/telnyx-assistant-provision.mjs#buildAssistantConfig`, `voice_settings.voice`).
Der `voiceProfile`-Parameter von `speakVoiceFields` wird im ElevenLabs-Zweig gar nicht
gelesen. Das ist **Absicht und gepinnt**, nicht ein Versehen: der Modulkommentar in
`voice.js` begründet es mit RCA-Wurzel R5 ("EINE Stimme im ganzen Call") — die
Assistant-Ressource hat ein global provisioniertes Voice-Setting ohne Per-Call-Auflösung,
ein sprachaufgelöster Speak-Node davor würde denselben Anruf in zwei Stimmen sprechen
lassen. `test/telnyx-call-control.test.js` hält genau das als R5-Regression fest.
**Folge für IP7:** selbst mit scharfem Assistant-Inbound spricht ein FR- oder EN-Anruf
**nicht** die Stimme, die Outbound in dieser Sprache spricht; für `de` hängt die Gleichheit
daran, ob die live gesetzte Plattform-Stimme zufällig der kuratierten DE-Kennung
entspricht — unbelegt (Offene Messung M10). Eine Sprachauflösung auf diesem Pfad wäre eine
neue Fähigkeit (Per-Call-Voice-Override oder Provisionierung je Sprache) und ist
**nicht** Teil dieser Kette (Owner-Entscheidung O7).

### Warum (a) verworfen ist

`src/elevenlabs/nummern-registrierung.js#registrierungsKoerper` lässt
`inbound_trunk_config` **bewusst** weg, mit der Begründung im Modulkopf: "der Inbound
läuft über die Telnyx-Voice-Application, nicht über diesen Trunk; eine Inbound-Freigabe
wäre eine Berechtigung ohne Zweck". Diese Auslassung ist heute die einzige Sache, die
verhindert, dass ein eingehender Anruf direkt beim Anbieter landet. Würde man sie
setzen, fiele Abschnitt 1.3 vollständig weg: keine Signaturprüfung, keine Tenant-Bindung
über die angerufene Nummer, **keine pro-Tenant-Kostendecke für Inbound** (Absolute Regel
1 nennt sie ausdrücklich als beide Richtungen sperrend), keine Max-Dauer, kein
Kostenprofil — und der Inbound-Pflichtsatz wäre eine Dashboard-Zeile statt eines
gerenderten Strings (Absolute Regel 2, Analogie; die Lehre
`el-eroeffnung-first-message` hält fest, dass der Prompt sie dort nicht mal ergänzen
kann). Das ist kein "Risiko, das man mildert", sondern das Entfernen von Regel 1 und 2.
**Nicht ohne ausdrückliche Owner-Entscheidung, und dann nur in der Variante, die die
Naht behält:** unser Webhook nimmt an, rendert den Pflichtsatz und übergibt danach per
Call-Control an den EL-Agenten. Das ist mechanisch (b) mit anderem Ziel — also erst (b)
bauen, dann darüber entscheiden.

### Warum (b) nicht zuerst kommt

(b) löst die Beschwerde des Owners **nicht**. Der Owner nennt Stimme und Aussprache; (b)
lässt beides unverändert (siehe Tabelle) und verdreifacht dabei die Inbound-Kosten. Sein
Blocker ist belegt und nicht kosmetisch: an `telnyxAssistant.inboundHandoffEnabled` in
`src/config.js` steht die Live-Messung vom 2026-08-04 — auf `inbound_path path=assistant`
folgte 370 ms später `HTTP 422 (90034 Call not answered yet)`; die Call-Control-API
verlangt einen bereits angenommenen Anruf, während TeXML beim Inbound implizit annimmt.
Der Anrufer hörte danach nur eine Fehleransage. Deshalb: (b) als letzte Phase, nach dem
Messwerkzeug, das sie überhaupt beurteilen kann.

### Welche der schnellen Fixes bei der grossen Weiche wieder wegfallen

Explizit, damit niemand zweimal zahlt:

- **IP1 (Aussprache) fällt NICHT weg.** Das Greeting wird von uns gerendert und reist als
  `greeting`-Wert in den Handoff (`inboundAssistantHandoffXml`, `src/routes/voice.js`).
  Der Fix gilt auf beiden Pfaden.
- **IP2 (Hörprobe) fällt NICHT weg** für den Say-/Play-Zweig, wird aber auf dem
  Assistant-Pfad nur noch für den Pflichtsatz-Speak-Node aussagekräftig. Das Werkzeug ist
  klein und der Vorher-Wert ist sonst nicht zu haben.
- **IP3 (Relay-Zweig entfernen) fällt NICHT weg.** Der Zweig ist auf jedem Pfad eine
  Fail-open-Selbstarmierung.
- **IP4 (Play-TTS scharf) wird auf dem Assistant-Pfad WIRKUNGSLOS**, weil dort der
  Assistant spricht, nicht unser `<Say>`/`<Play>`. Der Preis ist trotzdem nahe null: IP4
  baut nichts, es stellt einen fertigen Pfad scharf und pinnt den geteilten Resolver mit
  einem Test. Die Stimm-**Wahl** (`ELEVENLABS_VOICE_ID_BY_PROFILE`) überlebt — sie trägt
  den Outbound-Anrufstart (`src/elevenlabs/call-locale.js#callLocaleFor`) und die
  Play-TTS-Vorabsynthese (`src/tts/directive-synth.js`). **Nicht** den
  Assistant-Provisioner: der schreibt die statische Plattform-Stimme (Fussnote
  (b)-Stimme). Die Karte überlebt also wegen Outbound, nicht wegen des Assistant-Pfads.
- **IP5 (Modell-Gleichstand) fällt NICHT weg**, sofern die Entscheidung als
  Stimm-/Modell-Politik im Repo landet und nicht als Env-Wert eines Pfades.
- **IP6 (Inbound-Szenarien) fällt NICHT weg** — der Bench hat schon beide Treiber
  (`scripts/convo-bench/drivers.mjs`: `TEXML_DRIVER_ID`, `SHIM_DRIVER_ID`).

Nichts an dieser Kette wird durch (b) zu Wegwerf-Code ausser dem Flag-Flip in IP4 selbst.

---

## 3. Pre-Mortem

Ein Jahr weiter, die Kette ist gescheitert. Was ist passiert?

**P1 — Ein Anrufer bekommt keine Verbindung mehr.**
*Weg dorthin:* IP3 entfernt einen Zweig in `sayVoiceAttrs`, und weil `config.telnyx.telnyxElevenLabs`
"zum Relay gehört", verschwindet der Config-Block mit. Damit stirbt still auch
`src/elevenlabs/outbound.js#callLocaleOf` (`defaultVoiceId`),
`src/telephony/adapters/telnyx/voice.js#speakVoiceFields` und
`scripts/telnyx-assistant-provision.mjs`.
*Entschärfung:* IP3 nennt die vier Konsumenten des **Config-Blocks** namentlich in
Scope/NICHT-Scope; der Config-Block bleibt unangetastet, und die Abnahme greppt auf die
Konsumenten. Zusätzlich: `voiceAttrs` wirft bei unbekanntem Profil — der Rückfall ist
Azure, nicht Stille.
*Spiegelbild desselben Fehlers, und der wahrscheinlichere:* IP3 entfernt zu **wenig**.
Mit `sayVoiceAttrs` verliert `elevenLabsVoiceNameFor` seinen **einzigen** Konsumenten
(nachgezählt: `render.js` ist der einzige Aufrufer), und die render.js-Importe von
`elevenLabsVoiceNameFor`/`hasElevenLabsVoice` sowie `opts.elevenLabs` samt der
Registry-Injektion werden unbenutzt. Ein Export ohne Konsumenten mit der Begründung "ist
ja geteilt" ist toter Code mit falscher Schutzbehauptung (G9, hart verboten). Deshalb
zählt IP3 die Konsumenten **je Funktion**, nicht je Modul, und entfernt, was mit dem
Zweig stirbt.

**P2 — Die Kosten je Inbound-Minute vervielfachen sich unbemerkt.**
*Weg dorthin:* Zwei Wege. (i) IP7 wird scharfgestellt und niemand rechnet die dokumentierte
Verdreifachung nach; (ii) IP4 lässt die EL-Zeichen aller Mandanten auf ein
Plattform-Konto laufen — `src/config.js#telnyxElevenLabs` nennt das ausdrücklich als
bewusste Vereinfachung "ohne per-Tenant-Metering".
*Entschärfung:* (i) IP7 trägt ein eigenes Kostenprofil, sonst bleibt ein Flag-Flip in der
Buchhaltung stumm — genau die Begründung, mit der `KOSTENPROFIL.TELNYX_INBOUND_REALTIME`
existiert (`src/routes/voice.js`, KV2-2-Kommentar). (ii) IP4 stellt den bestehenden
Kontingent-Riegel als Abnahmekriterium unter Test
(`src/tts/directive-synth.js`, Vor- und Nach-Buchungs-Riegel, `store.platformTtsUsageView`
+ `ttsQuotaExhausted`); die Degradation ist fail-safe auf Azure, nie ein toter Anruf.
Die pro-Tenant-Kostendecke bleibt in beiden Richtungen unangetastet (Absolute Regel 1).
*Akzeptiertes Restrisiko:* fehlendes per-Tenant-TTS-Metering. Vorbestand, nicht von dieser
Kette eingeführt; gedeckelt durch das Plattform-Kontingent.

**P3 — Der rechtlich verdrahtete Inbound-Pflichtsatz fällt weg.**
*Weg dorthin:* IP1 "korrigiert" Greeting-Literale und trifft dabei
`hasInboundNotice`-Erkennungsstämme, oder eine Migration schreibt ein Greeting ohne
Pflichtsatz zurück. Oder jemand wählt später (a) und der Satz wandert in eine
Dashboard-Zeile.
*Entschärfung:* `withInboundNotice` ist idempotent und erkennt über Stämme
(`AI_MARKERS`/`TRANSCRIPT_MARKERS`), nicht über Volltext — die Umlaut-Korrektur berührt
keinen dieser Stämme (`fuer`/`für` steht in keinem). IP1 trägt als Pflicht-Test, dass
jede Vorlage nach der Korrektur `hasInboundNotice` erfüllt, und der Bestandstest
`test/inbound-disclosure-mandatory.test.js` bleibt grün. (a) ist verworfen (Abschnitt 2).

**P4 — Ein Deploy startet nicht mehr.**
*Weg dorthin:* IP4/IP7 führen eine neue Env-Pflicht ein, oder `assertConfig`/`boot-guard`
verlangt bei aktivem Flag einen Wert, den das Dashboard nicht hat.
*Entschärfung:* Kein Schritt dieser Kette führt eine neue Boot-Pflicht ein. IP4 braucht
`ELEVENLABS_API_KEY` (live gesetzt, sonst liefe Outbound nicht) und **keine**
`ELEVENLABS_VOICE_ID`: `elevenLabsVoiceIdFor` liefert für `de`/`fr`/`en` eine
Code-Kennung, der Plattform-Default wird nie gebraucht. Jede neue Env-Variable dieser
Kette ist optional mit Fallback und wird in `src/config.js` **und** `.env.example` **und**
`render.yaml` eingetragen (Konventionen).
*Akzeptiertes Risiko:* `render.yaml` ist nicht die Live-Wahrheit (Render-Services sind
Dashboard-managed) — deshalb ist jede Flag-Aussage dieser Kette als offene Messung
markiert, nicht als Tatsache.

**P5 — Ein Umbau macht den Outbound-Pfad kaputt, den heute niemand beklagt.**
*Weg dorthin:* Der gefährlichste Pfad der ganzen Kette. `elevenLabsVoiceIdFor` und
`ELEVENLABS_VOICE_ID_BY_PROFILE` sind **geteilt**: wer sie "für Inbound" anfasst, ändert
im selben Zug die Stimme jedes Outbound-Anrufs (`conversationConfigOverride`). Dasselbe
gilt für `config.telnyx.telnyxElevenLabs.voiceId` (P1) und für `ELEVENLABS_MODEL`, falls
IP5 es global umstellt.
*Entschärfung:* IP4 und IP5 tragen als Invariante "Outbound-Anfragekörper byte-identisch"
und als Abnahme einen Test, der `startCallBody`/`conversationConfigOverride` gegen einen
Snapshot hält. `npm run elevenlabs:drift` läuft vor und nach IP5 (es besitzt
`conversation_config_override_erlaubnisse`, also die Freigabe von `tts.voice_id`).
Ausserdem: die Kette fasst `src/bridge.js` nicht an (`HEIKLE STELLE`), und sie fasst
`elevenlabs/agent_configs/*` nur in IP5 an, dort nur mit Owner-Freigabe.

**P6 — Die Kette liefert Umbauten, aber keinen Beweis.**
*Weg dorthin:* Nach drei Phasen sagt der Owner "klingt jetzt anders, aber nicht besser",
und nichts im Repo kann vorher/nachher unterscheiden. Der Bench-Default trifft ohnehin
den falschen Pfad (`DEFAULT_DRIVER_ID = SHIM_DRIVER_ID`, `scripts/convo-bench/drivers.mjs`),
und **18 von 19** registrierten Szenarien sind `direction: "outbound"` — über
`scripts/convo-bench/scenarios/index.mjs#SCENARIOS` nachgezählt; das einzige
Inbound-Szenario ist `inbound-nachricht.mjs`.
*Entschärfung:* IP2 kommt **vor** jeder wahrnehmbaren Änderung ausser der
Orthografie-Korrektur und hält den Ist-Zustand als Artefakt fest. Die Lehre
`bench-must-reproduce-defect` ("Vorher-Messung ZUERST") ist damit befolgt.
*Akzeptiertes Risiko:* Aussprachequalität bleibt am Ende eine Hör-Entscheidung des Owners.
Kein Werkzeug dieser Kette behauptet, Phonetik automatisch zu bewerten; IP2 liefert die
Audiodatei, nicht das Urteil.

**P7 — Die Kette verschiebt einen stillen Fehlerpfad in den Normalbetrieb.**
*Weg dorthin:* IP4 ist scharf, das EL-Kontingent läuft mitten im Monat leer, und
**nur** der Inbound-Pfad wechselt klanglos die Stimme zurück auf Azure. Der Owner
berichtet erneut "andere Stimme", diesmal sporadisch — und niemand findet es, weil
Outbound keinen solchen Rückfall hat.
*Entschärfung:* Der Rückfall ist bereits laut (`[play-tts] Kontingent erschöpft ... ->
Azure-Fallback`, `warnQuotaDegradation`) und alarmiert per SMS über die
Warn-Schwelle. IP4 macht diese Zeile zum Abnahmekriterium und trägt die
Betriebsanweisung: "sporadisch andere Stimme inbound = zuerst nach dieser Logzeile
suchen".
*Bewusst akzeptiert:* Der stille Rückfall bleibt. Er ist richtig — ein Anruf, der mit
Azure-Stimme zustande kommt, ist besser als einer, der stirbt.

---

## 4. Die Phasenkette

Reihenfolge = Hebel pro Aufwand. Jede Phase ist für sich deploybar. Jede Phase, die
Live-Verhalten ändert, liegt hinter einem Schalter; Schalter aus = byte-identisch zum
Bestand. Ausnahme mit Begründung: IP1 (eine Orthografie-Korrektur hinter einem Flag wäre
absurd — das Verhalten *soll* sich ändern, und der Rückweg ist ein Revert).

---

## Phase IP1 - Gesprochene Umlaute im Inbound-Begrüssungskatalog

**Abhängigkeiten:** keine. Kann sofort und unabhängig laufen.

### Ziel (deterministisch prüfbar)

Alle drei deutschen Begrüssungsvorlagen (`greetingTemplatesFor("de")`) treffen
`SPOKEN_TRANSLITERATION_STEMS` **nicht** mehr, tragen weiterhin echte Umlaut-Zeichen und
erfüllen weiterhin `hasInboundNotice`. Ein Mandant, dessen Datensatz noch das **alte**
geseedete Greeting trägt, spricht nach dieser Phase trotzdem den korrigierten Satz.

### Scope

1. `src/store/defaults.js`: im Literal von `DEFAULT_GREETING` das **eine** Vorkommen
   `fuer` → `für` ("Ich kann eine Nachricht fuer {owner} aufnehmen."). Wortlaut sonst
   unverändert.
2. `src/i18n/locales.js`: in `LOCALES.de.greetingVariants[0]` das eine Vorkommen
   `fuer` → `für`. `greetingVariants[1]` ist bereits sauber und bleibt unangetastet.
   Wortlaut sonst unverändert. `LOCALES.fr`/`LOCALES.en` unangetastet.
   Zusammen sind das **zwei** geänderte Zeichenfolgen im ganzen DE-Katalog — mehr Treffer
   bedeuten, dass etwas ausserhalb des Scopes angefasst wurde.
3. **Die At-Rest-Falle schliessen.** `greetingForLanguage`
   (`src/i18n/greeting-catalog.js`) behandelt ein gespeichertes Greeting, das in
   **keiner** Vorlagenliste vorkommt, als frei gesetzten Text und gibt es unverändert
   zurück. Nach 1./2. ist genau das für jeden bestehenden Mandanten der Fall — der Fix
   erreicht ohne diesen Schritt **keinen einzigen Anruf**. Lösung: eine eingefrorene,
   geschlossene Karte `GREETING_ORTHOGRAPHY_MIGRATION` (altes Literal → neues Literal,
   genau die zwei historischen Fassungen) in `src/i18n/greeting-catalog.js`, mit **zwei**
   Konsumenten und genau einer Wahrheit (G5):
   - `greetingForLanguage` normalisiert die Eingabe über die Karte, **bevor** es gegen
     die Vorlagenlisten prüft. Ein nicht-migrierter Mandant spricht damit sofort richtig.
   - ein idempotenter Nachzieh-Lauf `scripts/greeting-orthografie-nachziehen.mjs`, der
     `settings.greeting` genau dort umschreibt, wo er wörtlich einem Karten-Schlüssel
     entspricht, und sonst nichts anfasst (Trockenlauf als Default, Schreiben nur mit
     `--apply`).
   Die Karten-Schlüssel sind **keine** wählbaren Vorlagen: sie dürfen weder in
   `greetingTemplatesFor` noch in `ALL_GREETING_TEMPLATES` auftauchen.
   **Form der Schlüssel (Implementierungsfalle):** `settings.greeting` hält den Wert
   **mit** vorangestelltem Pflichtsatz — `defaults.js` seedet `DEFAULT_GREETING`, und das
   ist bereits `withInboundNotice(...)`-umhüllt; `buildTemplates`
   (`src/i18n/greeting-catalog.js`) umhüllt zusätzlich (idempotent). Die Karten-Schlüssel
   sind deshalb die **umhüllten** historischen Fassungen, so wie sie at rest stehen, nicht
   die nackten Literale. Genau zwei Einträge (greetingDefault, greetingVariants[0]).
4. `test/de-umlaut-orthography.test.js`: `SPOKEN_DE_FIELDS` um
   `["S15 greetingDefault", LOCALES.de.greetingDefault]` und je Variante
   `["S16.<n> greetingVariants", ...]` erweitern. Damit fangen U1 (keine
   Transliteration) und U2 (Gegenprobe: echte Umlaute) diese Felder mit ab.

### NICHT-Scope

- Kein anderes DE-Locale-Feld, kein FR/EN-Feld, kein Prompt-Text
  (`LOCALES.de.prompt`, `summarySystem`, `realtimeOpener` bleiben **transliteriert** —
  `test/de-umlaut-orthography.test.js` P1-U3 pinnt das ausdrücklich; wer sie "mitfixt",
  bricht diesen Test).
- Kein Eingriff in `INBOUND_NOTICES` (bereits korrekt).
- Keine neuen Vorlagen, keine Wortlaut-Verbesserung, keine Stimme, kein Flag.
- Keine automatische DB-Migration beim Boot (Lehre `no-automatic-db-migration`: DDL
  läuft automatisch, Backfill nicht).

### Betroffene Dateien / Nahtstellen

`src/store/defaults.js` (`DEFAULT_GREETING`) · `src/i18n/locales.js`
(`LOCALES.de.greetingVariants`) · `src/i18n/greeting-catalog.js`
(`greetingForLanguage`, neue `GREETING_ORTHOGRAPHY_MIGRATION`) ·
`scripts/greeting-orthografie-nachziehen.mjs` (neu) ·
`test/de-umlaut-orthography.test.js`.
Mitlesende Nahtstellen, die grün bleiben müssen: `src/routes/voice.js`
(Greeting-Render), `src/self-service.js` (`selfServicePatch` gegen
`ALL_GREETING_TEMPLATES`), `test/p11-greeting-language.test.js`,
`test/p1b-no-booking.test.js`, `test/inbound-disclosure-mandatory.test.js`,
`test/helpers.js`.

### Invarianten (byte-identisch)

- Der Pflichtsatz-Präfix (`INBOUND_NOTICES.de`) bleibt byte-identisch.
- Die Anzahl wählbarer DE-Vorlagen bleibt 3, `ALL_GREETING_TEMPLATES.length` bleibt 9.
- `greetingForLanguage` verhält sich für jeden Wert, der **nicht** Karten-Schlüssel ist,
  byte-identisch zum Bestand (frei gesetzter Text bleibt unangetastet, `null` bleibt
  `null`).
- FR/EN-Kataloge byte-identisch.
- Der Self-Service-Riegel bleibt "nur Vorlage, kein Freitext".

### Abnahmekriterium

```
node --check src/store/defaults.js && node --check src/i18n/greeting-catalog.js
npm test -- --test-concurrency=4
node scripts/greeting-orthografie-nachziehen.mjs      # Trockenlauf
```
Erwartet: `npm test` grün, Zahl der Tests nicht gesunken; der Trockenlauf nennt die Zahl
betroffener Mandanten und schreibt nichts. Zusätzlich muss gelten:
`node -e "import('./src/i18n/greeting-catalog.js').then(m=>console.log(m.greetingTemplatesFor('de').filter(t=>/fuer/i.test(t)).length))"`
→ `0`.

### Testpflicht

- **Neu:** ein Test, der für jede der drei DE-Vorlagen gleichzeitig prüft: keine
  Transliteration, echte Umlaute vorhanden, `hasInboundNotice` erfüllt. (Die dritte
  Zusicherung ist der Riegel gegen Pre-Mortem P3.)
- **Neu:** `greetingForLanguage(<altes Literal>, "de")` liefert das **neue** Literal;
  `greetingForLanguage(<freier Text>, "de")` liefert ihn unverändert (Abgrenzung).
- **Neu:** der Nachzieh-Lauf ist idempotent (zweiter Lauf ändert nichts) und fasst einen
  frei gesetzten Text nicht an.
- **Erweitert:** `SPOKEN_DE_FIELDS` um S15/S16 (Bestandstests U1/U2 decken sie dann mit).

### Risiko + Rückfall

Risiko klein und bekannt: ein Mandant mit altem Greeting würde ohne Schritt 3 nichts
merken (deshalb ist Schritt 3 nicht optional). Rückfall: `git revert` — die Phase ändert
kein Schema und schreibt ohne `--apply` nichts in die DB.

### Owner / Testanruf

Keine Owner-Entscheidung nötig (derselbe Satz, richtig geschrieben). Kein Testanruf nötig
für die Abnahme; ein Hörbeleg ist erwünscht, aber IP2 liefert ihn billiger.

---

## Phase IP2 - Hörprobe: welchen Sprechpfad Inbound wirklich nimmt

**Abhängigkeiten:** keine. Muss **vor** IP4 und IP5 liegen (Vorher-Messung).

### Ziel (deterministisch prüfbar)

Ein Kommando fährt einen vollständigen Inbound-Turn lokal gegen den echten Render-Weg und
gibt aus: (1) welcher Sprechpfad gerendert wurde — `Azure-<Say>` mit Voice-Namen, oder
`<Play>` mit der Token-URL —, (2) den gesprochenen Text, (3) bei `<Play>` die
heruntergeladene Audiodatei auf der Platte. Kein echter Anruf, kein Provider-Netzzugriff
ausser der Synthese selbst.

### Scope

1. `scripts/inbound-hoerprobe.mjs` (neu): startet den Server als Kindprozess mit
   `PORT=0`, `SKIP_TWILIO_SIGNATURE_CHECK=true` und `DATA_DIR`-Override auf ein
   Temp-Verzeichnis (Muster `test/helpers.js#startServer` — **nicht** nachbauen, sondern
   denselben Helfer benutzen, sonst entsteht eine zweite Start-Wahrheit), schickt
   `POST /voice/incoming`, parst die TeXML-Antwort und berichtet den Sprechpfad. Bei
   `<Play>` holt es die Audio genau einmal über `GET /voice/tts/:token` (der Store ist
   `takeOnce`) und schreibt sie unter einen per Argument angegebenen Pfad.
2. Eine Klassifikation des Sprechpfads als **eine** Funktion, die sowohl das Skript als
   auch der Test benutzt: `<Play>` → `play_tts`, `<Say voice="Azure...">` → `azure_say`,
   `<Say voice="ElevenLabs...">` → `telnyx_relay`. Drei benannte Token, kein Freitext
   (Lehre `workflow-join-on-model-field`: nie über Freitext joinen).
3. `scripts/convo-bench` (nur Beobachtbarkeit): die Lauf-Kopfzeile nennt den effektiv
   benutzten Treiber-Namen und die Richtung des Szenarios. Damit kann eine Bench-Zahl
   nie mehr stillschweigend als Aussage über den anderen Pfad gelesen werden (Befund
   BEW-1). `DEFAULT_DRIVER_ID` bleibt unverändert.
4. In derselben Ausgabe: die bereits existierenden Latenz-Marken des Turns aus
   `src/metrics.js` (`logTurnGap`, `logSpeechResult`, LLM-Latenz) als Zeilen mitführen,
   damit der Ist-Median der Inbound-Stille ohne Testanruf einen Anker hat.

### NICHT-Scope

- **Keine** Bewertung von Aussprache oder Klangqualität. Das Werkzeug liefert die Datei,
  nicht das Urteil.
- **Keine** Änderung an `DEFAULT_DRIVER_ID`, keinem Szenario, keinem Treiber-Verhalten.
- Keine neuen Inbound-Szenarien (das ist IP6).
- Keine Änderung an `src/routes/voice.js`, `render.js` oder `directive-synth.js`.
- Kein echter Provider-Anruf, kein Telnyx-Netzzugriff.

### Betroffene Dateien / Nahtstellen

`scripts/inbound-hoerprobe.mjs` (neu) · `test/helpers.js` (nur **benutzt**, nicht
geändert; falls ein Export fehlt: additiv ergänzen) · `scripts/convo-bench/*` (nur die
Kopfzeile) · `package.json` (`scripts`-Eintrag `inbound:hoerprobe`).

### Invarianten (byte-identisch)

- Produktionscode unter `src/` bleibt unverändert — diese Phase fügt **nur** Werkzeug
  hinzu. Eine Phase, die `src/` anfasst, ist nicht mehr diese Phase.
- `test/helpers.js` bleibt für alle Bestandstests verhaltensgleich.
- Keine Secrets in der Ausgabe: das Skript gibt Schlüsselnamen und den Zustand
  `gesetzt/leer` aus, niemals Werte (Absolute Regel 4). Keine Rufnummer im Klartext —
  Testnummern kommen aus dem Temp-Seed, nicht aus `.env`.

### Abnahmekriterium

```
npm run inbound:hoerprobe -- --out /tmp/inbound-probe
```
Erwartet, mit Repo-Defaults: eine Zeile `sprechpfad=azure_say voice=Azure.de-DE-KatjaNeural`,
darunter der gesprochene Begrüssungstext, und der Hinweis, dass keine Audiodatei entsteht
(kein `<Play>`). Mit `ELEVENLABS_PLAY_TTS_ENABLED=true` und gesetztem Schlüssel:
`sprechpfad=play_tts` und eine Datei unter dem `--out`-Pfad mit Grösse > 0.
Zusätzlich `npm test -- --test-concurrency=4` grün.

### Testpflicht

- **Neu:** die Sprechpfad-Klassifikation als reiner Unit-Test über alle drei
  TeXML-Formen (`<Play>`, Azure-`<Say>`, ElevenLabs-`<Say>`) plus den Grenzfall "leeres
  Gather ohne Prompt".
- **Neu:** ein Integrationstest, der mit Repo-Defaults `azure_say` erwartet — das pinnt
  den heutigen Ist-Zustand und ist gleichzeitig der Regressionsfang für IP3/IP4.

### Risiko + Rückfall

Risiko minimal (nur Werkzeug). Einziger echter Fallstrick: verwaiste Testserver (Lehre
`verwaiste-testserver-elternwaechter`) — das Skript muss den Kindprozess im
`finally`-Zweig beenden und den Eltern-Wächter benutzen. Rückfall: Datei löschen.

### Owner / Testanruf

Weder Owner-Entscheidung noch Testanruf.

---

## Phase IP3 - Zwei Selbst-Armierungen entfernen

**Abhängigkeiten:** IP2 (der Bestandstest `azure_say` ist der Regressionsfang). Muss
**vor** IP4 liegen: sonst kann beim Scharfstellen der falsche der beiden
ElevenLabs-Pfade greifen.

### Ziel (deterministisch prüfbar)

(1) Es gibt keinen Zustand der Umgebung mehr, in dem der TeXML-Inbound-`<Say>` auf den
A/B-belegt defekten ElevenLabs-Relay umschaltet. (2) Nach dem Entfernen bleibt **kein
Export und kein Parameter ohne Konsumenten** zurück (`grep` auf
`elevenLabsVoiceNameFor` ist leer, `opts.elevenLabs` existiert nicht mehr) — kein toter
Code mit Schutzbehauptung. (3) `render.yaml` und `src/config.js` sagen über
`TELNYX_INBOUND_HANDOFF_ENABLED` dasselbe. (4) Kein Katalog-Test ist dabei verloren
gegangen.

### Scope

1. **Den Relay-Zweig am Inbound-`<Say>` entfernen.** In
   `src/telephony/adapters/telnyx/render.js` fällt `sayVoiceAttrs` weg; `renderSay`
   benutzt direkt `voiceAttrs(d.voiceProfile)`. Begründung, die im Code stehen bleibt:
   der Relay ist **A/B-belegt defekt** — er unterdrückt den Inbound-Audio-Track, Deepgram
   liefert leer, der Agent hört den Anrufer nicht (Messung 2026-07-06, im
   Modulkommentar). Er armiert sich heute **automatisch**, sobald
   `TELNYX_ELEVENLABS_API_KEY_REF` und `TELNYX_ELEVENLABS_VOICE_ID` beide gesetzt sind —
   ohne Flag, ohne Warnung. Das ist eine Fail-open-Konstruktion an einem Pfad, den
   niemand benutzen will.
2. **Mit dem Zweig stirbt, was nur für ihn existierte (G9, kein Export ohne Konsument).**
   Nachgezählt je Funktion, nicht je Modul:
   - `elevenLabsVoiceNameFor` (`src/telephony/adapters/telnyx/elevenlabs-voice.js`) hat
     **genau einen** Aufrufer, `render.js#sayVoiceAttrs`. Nach Schritt 1 ist er null →
     die Funktion wird **entfernt**. `elevenLabsVoiceIdFor`, `elevenLabsVoiceName` und
     `hasElevenLabsVoice` bleiben (Konsumenten s. NICHT-Scope).
   - die render.js-Importe `elevenLabsVoiceNameFor`/`hasElevenLabsVoice` entfallen;
     `render.js` importiert danach nichts mehr aus `elevenlabs-voice.js`.
   - `opts.elevenLabs` entfällt aus dem Renderer-Vertrag (`renderDirectives`,
     `renderSay`), und damit die Injektion `elevenLabs: config.telnyx.telnyxElevenLabs`
     in `src/telephony/registry.js` (`PORT.VOICE_RENDERER`). `opts` selbst **bleibt** —
     es trägt weiterhin `sttProfile`.
   - der Modulkopf von `elevenlabs-voice.js` nennt heute den TeXML-Renderer als
     Konsumenten. Der Satz wird nachgezogen (Call-Control-speak + Provisioner +
     Play-TTS/Outbound über `elevenLabsVoiceIdFor`), sonst bleibt ein Kommentar stehen,
     der eine zweite, falsche Wahrheit über die Konsumenten behauptet.
3. **VOICE-12 wandert, es verschwindet nicht.** Der Leittest des Katalog-Clusters,
   `test/telnyx-elevenlabs-render.test.js` (`test("VOICE-12 ... ElevenLabs-Stimme löst pro
   Sprache auf statt einer globalen ID")`), misst die Sprachauflösung **am gerenderten
   TeXML-`<Say>`** — also genau an dem Zweig, den Schritt 1 entfernt. Er darf nicht
   gelöscht und nicht auskommentiert werden (G4/G9 und die Katalog-Disziplin: ein
   entfernter Katalog-Test ist ein verlorenes Launch-Kriterium). Er wird auf den
   **überlebenden** sprachaufgelösten Pfad umgehängt: die Play-TTS-Vorabsynthese
   (`src/tts/directive-synth.js` → `elevenLabsVoiceIdFor`), wo dieselbe Zusicherung
   beobachtbar ist (`test/directive-synth.test.js` verweist bereits auf VOICE-12). Der
   Kommentar am Test hält fest, warum der Messpunkt umgezogen ist. Die Katalog-Kennung
   `VOICE-12` bleibt am Namensanfang, damit der Test in derselben Bank läuft wie vorher
   (`npm run test:gates`). Sein Farbstand vor und nach der Phase wird im Phasenbericht
   genannt (Offene Messung M11) — eine Farbänderung ohne Begründung ist ein Blocker.
   Dieselbe Prüfung gilt für die relay-bezogenen Fälle in
   `test/p9-voice-locale-source.test.js`: der R5-Fall (Assistant-speak bleibt global)
   bleibt unberührt, der Relay-Fall wird zur Inertheits-Zusicherung.
4. **`render.yaml` mit `src/config.js` in Deckung bringen.** Der Blueprint trägt für
   `TELNYX_INBOUND_HANDOFF_ENABLED` den Wert `"true"` samt Kommentar "Default true",
   während `config.telnyxAssistant.inboundHandoffEnabled` seit dem 422-Befund vom
   2026-08-04 `fallback: false` hat und der Kommentar dort "DEFAULT AUS" sagt. Ein
   erneutes Anwenden des Blueprints würde den belegt defekten Handoff scharf stellen —
   der Anrufer hört dann eine Fehleransage. Der Blueprint-Wert wird `"false"`, der
   Kommentar nennt den 422-Befund und verweist auf Phase IP7 als den Weg, ihn wieder
   einzuschalten.

### NICHT-Scope

- **`config.telnyx.telnyxElevenLabs` bleibt.** Es hat vier Konsumenten ausserhalb des
  Renderers, und **alle vier** sind Outbound oder Assistant-Pfad:
  `src/elevenlabs/outbound.js#callLocaleOf` (`defaultVoiceId`),
  `src/telephony/adapters/telnyx/voice.js#speakVoiceFields`,
  `src/telephony/adapters/telnyx/voice.js#assistantVoiceConfigured`,
  `scripts/telnyx-assistant-provision.mjs`. Wer den Block löscht, nimmt Outbound die
  Plattform-Stimme (Pre-Mortem P1). `src/telephony/registry.js` war der fünfte Leser und
  fällt mit Scope Punkt 2 weg — **genau diese vier** bleiben danach übrig.
- **`elevenLabsVoiceIdFor`, `elevenLabsVoiceName` und `hasElevenLabsVoice` bleiben
  exportiert und in ihrem Verhalten unverändert** — sie haben je einen Konsumenten
  ausserhalb des Renderers, am Code nachgezählt:
  `elevenLabsVoiceIdFor` → `src/elevenlabs/call-locale.js#callLocaleFor`
  (Outbound-Anrufstart) und `src/tts/directive-synth.js` (Play-TTS);
  `elevenLabsVoiceName` → `src/telephony/adapters/telnyx/voice.js#speakVoiceFields` und
  `scripts/telnyx-assistant-provision.mjs` (beide **ohne** Sprachauflösung, Fussnote
  (b)-Stimme); `hasElevenLabsVoice` → `speakVoiceFields` und `assistantVoiceConfigured`.
  `elevenLabsVoiceNameFor` gehört **nicht** in diese Liste: sein einziger Aufrufer ist
  der entfallende `sayVoiceAttrs`, deshalb steht es in Scope Punkt 2, nicht hier.
- Keine Änderung an der Stimm-Karte `ELEVENLABS_VOICE_ID_BY_PROFILE` und an keinem der
  drei kuratierten IDs (Owner-Entscheidung 2026-08-18, per Synthese abgehört).
- Keine Änderung am Assistant-Pfad-Verhalten, keine Änderung an `TELNYX_AI_ASSISTANT_ENABLED`.
- Keine weiteren `render.yaml`-Werte anfassen.

### Betroffene Dateien / Nahtstellen

`src/telephony/adapters/telnyx/render.js` (`sayVoiceAttrs` entfällt, `renderSay`,
Importe, `opts`-Vertrag) · `src/telephony/adapters/telnyx/elevenlabs-voice.js`
(`elevenLabsVoiceNameFor` entfällt, Modulkopf nachziehen) ·
`src/telephony/registry.js` (**wird angefasst**: die `elevenLabs`-Injektion am
`PORT.VOICE_RENDERER` entfällt mit dem Parameter; `sttProfile` bleibt) ·
`render.yaml` (ein Wert, ein Kommentar) ·
`test/telnyx-elevenlabs-render.test.js` (die Relay-Snapshots kehren sich um; VOICE-12
zieht um, s. Scope 3) · `test/p9-voice-locale-source.test.js` (Relay-Fall wird
Inertheits-Fall; der R5-Fall bleibt) · die übrigen Renderer-Snapshot-Tests (bleiben
byte-gleich).
Prüfen und **nicht** anfassen: `config.telnyx.telnyxElevenLabs` in `src/config.js`
(s. NICHT-Scope) und `src/telephony/adapters/telnyx/voice.js` (der Call-Control-Pfad
liest den Block direkt aus `config`, nicht über den Renderer-`opts` — die Änderung an
`registry.js` erreicht ihn nicht).

### Invarianten (byte-identisch)

- Das gerenderte TeXML ist für jeden Zustand, in dem `hasElevenLabsVoice` heute `false`
  liefert (also der gesamte belegte Ist-Betrieb), **byte-identisch** — Attributnamen,
  Attribut-Reihenfolge, Escaping.
- `<Play>`-Rendering (`renderPlay`, `audioUrl`/`promptAudioUrl`) unverändert.
- `gatherAttrs` unverändert (`input`, `language`, `transcriptionEngine`, `model`,
  `speechTimeout` in dieser Reihenfolge).
- Outbound-Pfad und Assistant-Speak-Node unverändert — `speakVoiceFields` liest
  `config.telnyx.telnyxElevenLabs` direkt, nicht über den Renderer-`opts`; die
  Registry-Änderung erreicht ihn nicht.
- Das Fail-closed-Verhalten von `voiceAttrs` (wirft bei unbekanntem Profil) bleibt.
- `renderDirectives` bleibt aufrufkompatibel: ein Aufruf ohne `opts`, mit `{}` oder mit
  einem `opts`, das ein `elevenLabs`-Objekt **enthält**, liefert dasselbe TeXML. Der
  Schlüssel wird inert, nicht verboten — ein Wurf wäre eine neue Fehlerquelle mitten im
  Gespräch.
- Kein Katalog- oder Abnahmetest verschwindet: `VOICE-12` bleibt existent und behält
  seine Kennung (Scope 3); die Zahl der Einträge in `test/abnahme-ausgewandert.json`
  sinkt nicht (Regel D13).

### Abnahmekriterium

```
node --check src/telephony/adapters/telnyx/render.js && node --check src/telephony/registry.js
grep -rln "telnyxElevenLabs" src scripts | grep -v "src/config.js"
grep -rn "elevenLabsVoiceNameFor" src scripts test
npm test -- --test-concurrency=4
npm run test:gates
npm run inbound:hoerprobe -- --out /tmp/inbound-probe
```
Erwartet, **nach Dateien statt nach Zeilenzahlen** (Zeilenzahlen rotten):
der erste `grep` listet genau drei Dateien — `src/elevenlabs/outbound.js`,
`src/telephony/adapters/telnyx/voice.js`, `scripts/telnyx-assistant-provision.mjs` — und
**weder** `render.js` **noch** `registry.js`. Der zweite `grep` findet
`elevenLabsVoiceNameFor` nirgends mehr (auch nicht in einem Kommentar, der ihn als
lebende Naht beschreibt). `npm test` grün und die Testzahl nicht gesunken;
`npm run test:gates` mit unverändertem Farbstand bis auf den in M11 protokollierten
VOICE-12-Umzug; die Hörprobe meldet weiter `azure_say`.

### Testpflicht

- **Neu:** ein Test, der mit **gesetzten** `apiKeyRef` + `voiceId` rendert und beweist,
  dass das TeXML **trotzdem** die Azure-Voice trägt — also dass die Selbstarmierung weg
  ist. Ohne diesen Test ist die Phase eine Behauptung. Derselbe Test deckt den Grenzfall
  "`opts` trägt einen `elevenLabs`-Schlüssel" ab: inert, kein Wurf.
- **Neu:** ein Test, der `render.yaml` und `src/config.js` für
  `TELNYX_INBOUND_HANDOFF_ENABLED` auf denselben Wahrheitswert prüft (ein
  Blueprint-gegen-Code-Vergleich; Muster der bestehenden Env-Inventar-Tests).
- **Umgehängt, nicht gelöscht:** `VOICE-12` misst die Sprachauflösung danach am
  Play-TTS-Pfad (Scope 3). Der Test behält Kennung und Bank; im Phasenbericht steht sein
  Farbstand vor und nach dem Umzug.
- **Geändert (und das ist erwartet, keine Regression):** die Relay-Fälle in
  `test/telnyx-elevenlabs-render.test.js` — `<Say>`-Attribute, innerer Gather-`<Say>`,
  Model-Slot-Override — kehren sich zu Azure-Zusicherungen um. Sie zu **löschen** ist
  nicht erlaubt: sie sind danach der Riegel gegen eine Wiederkehr der Selbstarmierung.
- **Bestand:** alle Renderer-Snapshots **ausserhalb** des Relay-Zweigs bleiben
  unverändert grün (das ist die Byte-Identität) — `<Play>`, `gatherAttrs`,
  Azure-`<Say>`, Hangup.

### Risiko + Rückfall

Mittel, und höher als die reine Zeilenzahl vermuten lässt: berührt werden drei
Produktionsdateien (`render.js`, `elevenlabs-voice.js`, `registry.js`), und
`elevenlabs-voice.js` wird von Outbound **und** vom Assistant-Pfad gelesen — deshalb die
expliziten `grep`s im Abnahmekriterium und die namentliche Konsumentenliste je Funktion
im NICHT-Scope. Zweites Risiko: die umgekehrten Relay-Tests und der VOICE-12-Umzug sehen
nach "Tests angepasst, damit es grün wird" aus. Gegenmittel: beide sind hier vorab als
Scope benannt, mit dem Grund; eine Test-Änderung, die in diesem Abschnitt nicht steht,
ist im Audit ein Blocker. Rückfall: `git revert`; kein Schema, kein Datenzustand, kein
Live-Flag.

### Owner / Testanruf

Keine Owner-Entscheidung (es wird ein belegt defekter Pfad entfernt, keine Fähigkeit).
Kein Testanruf.

---

## Phase IP4 - Inbound spricht dieselbe Stimme wie Outbound

**Abhängigkeiten:** IP2 (Vorher-Hörprobe), IP3 (kein Relay kann dazwischenkommen).
Empfohlen nach IP1, damit der erste gesprochene Satz gleich richtig synthetisiert wird.

### Ziel (deterministisch prüfbar)

Ein Test pinnt, dass Inbound-Sprachausgabe und Outbound-Anrufstart die ElevenLabs-Stimme
über **denselben** Resolver auflösen und für `de` dieselbe Kennung ergeben. Nach dem
Flag-Flip meldet die Hörprobe `sprechpfad=play_tts`, und die Audiodatei ist hörbar
dieselbe Sprecherin wie im Outbound-Anruf.

### Scope

1. **Den geteilten Anker unter Test stellen** (der eigentliche Bauteil dieser Phase).
   Ein Test, der in einem Fall zeigt:
   `elevenLabsVoiceIdFor(<Plattform-Default>, VOICE_PROFILE.DE_FEMALE_NEURAL)` ist genau
   der Wert, den `src/elevenlabs/call-locale.js#callLocaleFor` als `locale.voiceId`
   liefert und den `src/elevenlabs/outbound.js#conversationConfigOverride` als
   `tts.voice_id` setzt — und genau der Wert, den `src/tts/directive-synth.js` an
   `synthesizeSpeech` übergibt. Dasselbe für `fr` und `en`. Damit ist "eine Stimme in
   beiden Richtungen" eine geprüfte Invariante statt einer Beobachtung.
   **Reichweite des Ankers, damit daraus keine falsche Testerwartung wird:** er gilt für
   **zwei** Konsumenten — Outbound-Anrufstart und Play-TTS. Er gilt **nicht** für den
   Telnyx-AI-Assistant-Pfad: dessen Speak-Node und dessen Provisionierung benutzen
   `elevenLabsVoiceName` mit der statischen Plattform-Stimme und sind bewusst
   sprachblind (Fussnote (b)-Stimme, R5-Regression in
   `test/telnyx-call-control.test.js`). Der neue Test darf den Assistant-Pfad also nicht
   mit in die Gleichheitszusicherung nehmen — sonst pinnt er einen Sollzustand, den
   niemand beschlossen hat, und bricht einen bestehenden Test.
2. **Den Sprechpfad beim Start sichtbar machen.** Genau eine Boot-Zeile, die sagt,
   welchen Inbound-Sprechpfad diese Instanz fährt (`play_tts` / `azure_say`), mit
   derselben Klassifikation wie IP2 (kein zweiter Namensvorrat). Secret-frei: kein
   Schlüssel, keine Voice-ID im Log ist nicht nötig — der Pfad-Token genügt.
3. **Den Kontingent-Riegel als Abnahme unter Test stellen.** Der Riegel existiert
   (`src/tts/directive-synth.js`: Vor-Riegel über `store.platformTtsUsageView` +
   `ttsQuotaExhausted`, Nach-Buchungs-Riegel über `store.recordTtsCharacters`,
   beide mit `warnQuotaDegradation`). Neu ist nur der Beweis, dass er bei erschöpftem
   Kontingent **keinen** Provider-Aufruf macht und fail-safe auf Azure-`<Say>` fällt.
4. **Der Flag-Flip selbst** (`ELEVENLABS_PLAY_TTS_ENABLED=true` im Render-Dashboard) ist
   eine Owner-Handlung, kein Commit. Die Phase liefert dafür die Betriebsanweisung:
   Vorher-Hörprobe, Flip, Nachher-Hörprobe, ein echter Inbound-Testanruf, und die
   Log-Zeile, an der eine spätere sporadische Stimmänderung erkennbar ist
   (`[play-tts] Kontingent erschöpft`).

### NICHT-Scope

- **`ELEVENLABS_VOICE_ID_BY_PROFILE` wird nicht angefasst.** Die Kennungen sind eine
  Owner-Entscheidung vom 2026-08-18, vom Eigentümer per Synthese abgehört. Wer sie
  ändert, ändert im selben Zug jeden Outbound-Anruf (Pre-Mortem P5).
- Kein Eingriff in `elevenlabs/agent_configs/*`, kein Push zum Anbieter.
- **Kein** TTS-Modell-Wechsel (das ist IP5) — diese Phase ändert `ELEVENLABS_MODEL` nicht.
- Kein per-Tenant-TTS-Metering (bewusste Vereinfachung, in `src/config.js` dokumentiert).
- Kein Eingriff in die Synthese-Frist `synthTimeoutMs` (2000 ms; ihre Herleitung
  `11250 + 2000 + 1500 <= 15000` steht im Config-Kommentar und darf nicht nebenbei
  gebrochen werden).

### Betroffene Dateien / Nahtstellen

`test/` (neue Tests, der Hauptteil dieser Phase) · `src/boot.js` bzw. die bestehende
Boot-Banner-Stelle (eine Zeile) · gemeinsame Klassifikation aus IP2.
Nur **gelesen**: `src/tts/directive-synth.js`, `src/telephony/adapters/telnyx/elevenlabs-voice.js`,
`src/elevenlabs/call-locale.js`, `src/elevenlabs/outbound.js`.

### Invarianten (byte-identisch)

- **Flag aus = byte-identisch zum Bestand**, inklusive der neuen Boot-Zeile (die darf den
  Startvorgang nicht verändern, nur beschreiben).
- Der Outbound-Anfragekörper (`startCallBody`, `conversationConfigOverride`) bleibt
  byte-identisch — diese Phase liest ihn, sie ändert ihn nicht.
- Der Fehler-/Timeout-/Kontingent-Rückfall auf Azure-`<Say>` bleibt **unverändert
  fail-safe**: kein Pfad darf einen Anruf wegen Synthese-Problemen töten.
- Absolute Regel 1 unberührt: die pro-Tenant-Kostendecke liegt in `/voice/incoming`
  **vor** jeder Synthese; diese Phase verschiebt sie nicht.

### Abnahmekriterium

```
npm test -- --test-concurrency=4
npm run inbound:hoerprobe -- --out /tmp/vorher
# Owner: ELEVENLABS_PLAY_TTS_ENABLED=true im Render-Dashboard
npm run inbound:hoerprobe -- --out /tmp/nachher    # mit dem Flag lokal an
```
Erwartet: `npm test` grün inkl. der drei neuen Tests; die Nachher-Probe meldet
`sprechpfad=play_tts` und legt eine Audiodatei > 0 Bytes ab; die Boot-Zeile nennt bei
Flag aus `azure_say` und bei Flag an `play_tts`. Live-Abnahme: ein echter Inbound-Anruf,
bei dem der Owner dieselbe Sprecherin hört wie bei einem Outbound-Anruf.

### Testpflicht

- **Neu:** die Anker-Invariante (Punkt 1) für alle drei Sprachprofile. Das ist der Test,
  der verhindert, dass die Richtungen je wieder auseinanderlaufen.
- **Neu:** erschöpftes Kontingent → kein Provider-Aufruf, Direktive unverändert,
  Warnzeile vorhanden (Punkt 3).
- **Neu:** Flag aus → identisches TeXML wie der IP2-Bestandstest (`azure_say`).

### Risiko + Rückfall

Risiko: **hochrisiko**, weil Geld betroffen ist (EL-Zeichen auf einem Plattform-Konto
ohne per-Tenant-Metering) und weil die Phase einen Live-Flag-Flip auslöst. Rückfall:
Flag im Dashboard zurück auf `false` — sofort, ohne Deploy, byte-identisch zum Bestand.

### Owner / Testanruf

**Beides.** Owner-Entscheidung: den Flip vornehmen und das Zeichen-Budget akzeptieren.
Echter Inbound-Testanruf: die einzige Instanz, die "klingt jetzt wie Outbound"
entscheiden kann.

---

## Phase IP5 - Modell-Gleichstand: dieselbe ElevenLabs-Modellklasse in beiden Richtungen

**Abhängigkeiten:** IP4 (erst wenn Inbound überhaupt ElevenLabs spricht, ist das Modell
die verbleibende Differenz). IP2 liefert die Vorher-Datei zum Vergleich.

### Ziel (deterministisch prüfbar)

Die Modellwahl beider Richtungen ist im Repo **benannt und belegt**: entweder als
gemeinsamer Wert, oder als ausdrücklich festgehaltene, begründete Differenz. Der
Live-Wert des Outbound-Agenten (`tts.model_id`) ist gemessen und liegt als Beleg vor.

### Scope

1. **Messen, nicht raten.** `npm run elevenlabs:drift` bzw. ein `GET` am Live-Agenten
   liefert `conversation_config.tts.model_id`. Der Wert wird als Messung festgehalten
   (nicht als Flag). Regel `provider-config-needs-doc-before-diagnosis`: erst
   `GET` + Schnappschuss, dann entscheiden.
2. **Owner-Entscheidung einholen und im Repo festschreiben:** dieselbe Modellklasse in
   beiden Richtungen (Klang gleich, Inbound evtl. langsamer) **oder** bewusst
   verschiedene Modelle (Inbound latenzoptimiert, Outbound klangoptimiert) mit
   Begründung. Die Entscheidung gehört als Kommentar an **eine** Stelle —
   `src/config.js#elevenLabsPlayTts` (`ELEVENLABS_MODEL`) — und, falls sie das
   Anbieter-Feld betrifft, in den Besitz-Block der Agenten-Vorlage
   (`_besitz.felder`), damit der Drift-Wächter sie ab dann hält.
3. **Nur bei "gleich":** `tts.model_id` wird ein besessenes Feld der Vorlage und
   `ELEVENLABS_MODEL` bekommt denselben Wert. Der Push zum Anbieter
   (`npm run elevenlabs:push`) ist eine Owner-Handlung, kein Commit — und die
   Reihenfolge ist zu beachten (Lehre `gq-e1-b1-merged-cutover-pending`:
   Push-Reihenfolge, Preset-Feld-Gotcha).
4. Die Synthese-Frist gegenprüfen: ein langsameres Modell kann `synthTimeoutMs` (2000 ms)
   reissen. Reisst es, ist das Ergebnis **kein** Fehler, sondern der belegte
   Azure-Rückfall — aber dann ist der Gleichstand nicht erreicht, und das gehört als
   Messergebnis in die Phase, nicht in eine Timeout-Erhöhung. Eine Erhöhung würde die
   Herleitung `11250 + 2000 + 1500 <= 15000` brechen und braucht eine eigene Entscheidung.

### NICHT-Scope

- Keine Änderung an Stimm-Kennungen, an `speed`, `stability` oder anderen
  TTS-Feinheiten.
- Kein Wechsel des Sprechpfads, kein Flag.
- Keine Erhöhung von `synthTimeoutMs` in dieser Phase (siehe Punkt 4).
- Keine Anpassung des Aussprache-Weges: die Alias-Regel bleibt der gewählte Weg,
  `enable_phoneme_tags` bleibt ausdrücklich nicht besessen (Vorlage,
  `_aussprache_hinweis`).

### Betroffene Dateien / Nahtstellen

`src/config.js` (Kommentar; Wert nur bei "gleich") ·
`elevenlabs/agent_configs/outbound-agent.template.json` (`_besitz`, nur bei "gleich") ·
`outbound-drift-ausnahmen.json` (nur falls ein Feld bewusst ausgenommen wird) ·
`.env.example` und `render.yaml` (falls `ELEVENLABS_MODEL` einen neuen Default bekommt).

### Invarianten (byte-identisch)

- Bei der Entscheidung "verschiedene Modelle" ist die Phase **rein dokumentarisch**:
  kein Verhaltensbit ändert sich.
- Der Drift-Wächter bleibt fail-closed und behält seinen Exit-Code-Vertrag; die Zahl
  besessener Felder darf nur **steigen**, nie sinken.
- Der Offenlegungssatz (`first_message`, `language_presets.*.first_message`,
  `voicemail_message`) bleibt unberührt — Absolute Regel 2.

### Abnahmekriterium

```
npm run elevenlabs:drift
npm test -- --test-concurrency=4
```
Erwartet: `elevenlabs:drift` läuft mit dem dokumentierten Exit-Code-Vertrag durch und
nennt, bei "gleich", `tts.model_id` als besessenes und übereinstimmendes Feld. Die
Entscheidung ist an genau einer Code-Stelle als Kommentar nachlesbar. Zusätzlich: ein
Vorher/Nachher-Paar von Audiodateien aus IP2 liegt vor.

### Testpflicht

- **Nur bei "gleich":** ein Test, der `ELEVENLABS_MODEL`-Default und den Vorlagenwert
  `tts.model_id` auf Gleichheit prüft (damit die Angleichung nicht bei der nächsten
  Env-Änderung still zerfällt).
- **Immer:** der Drift-Wächter bleibt grün; seine Feldzahl wird im Phasenbericht genannt
  (Lehre `sec-fix-chain-complete`: Zähler nach dem Merge neu messen, nie aus einer Notiz
  lesen).

### Risiko + Rückfall

Risiko mittel: ein Push zum Anbieter wirkt sofort auf **Outbound**, den heute niemand
beklagt (Pre-Mortem P5). Deshalb gilt: Drift-Lauf vor **und** nach dem Push, und der
Rückweg ist der Vorlagenwert plus erneuter Push. Rückfall bei der reinen
Dokumentationsvariante: `git revert`.

### Owner / Testanruf

**Owner-Entscheidung zwingend** (Klang gegen Latenz, und ein Push in die Live-Konfiguration
des Outbound-Agenten). Ein Hörvergleich ist erwünscht; ein echter Anruf ist nur nötig,
wenn gepusht wird.

---

## Phase IP6 - Inbound-Szenarien im Gesprächs-Bench

**Abhängigkeiten:** keine harten; sinnvoll nach IP1 (sonst messen die Szenarien einen
Satz, der sich gleich ändert). Muss **vor** IP7 fertig sein — sonst gibt es für den
Engine-Wechsel keine Vorher-Zahl.

### Ziel (deterministisch prüfbar)

`node scripts/convo-bench.mjs run --driver texml --repeat 5` fährt einen
Inbound-Szenariensatz, der die belegten Inbound-Eigenheiten abdeckt, und liefert eine
reproduzierbare Zahl für **genau den heute live laufenden Pfad**.

### Scope

1. Vier bis sechs neue Szenarien mit `direction: "inbound"` neben dem bestehenden
   `scripts/convo-bench/scenarios/inbound-nachricht.mjs`. Jedes deckt eine am Code
   belegte Inbound-Eigenheit ab, keine erfundene:
   - Anrufer fragt etwas, das nur der Auftraggeber weiss → der Agent darf **nicht**
     zurückfragen (Richtungs-Gate, `src/consult/in-call.js#consultAvailableFor`) und muss
     es als Nachricht aufnehmen.
   - Anrufer fragt eine öffentlich prüfbare Tatsache → kein `look_up`
     (`src/research/in-call.js#lookupProviderFor`), Nachricht statt Recherche.
   - Anrufer nennt Wunschtag/-zeit → als Nachricht, **nicht** als Terminzusage (der
     Inbound-Prompt sagt ausdrücklich "du siehst den Kalender nicht").
   - Anrufer schweigt → die dreistufige No-Speech-Staffel
     (`noSpeechReprompt` → `noSpeechRepromptAgain` → `noSpeechFarewell`).
   - Anrufer kündigt Auflegen an → `end_call` statt Endlosschleife.
   - Anrufer redet in einer anderen Sprache als am Tenant hinterlegt → dokumentiert das
     heutige Verhalten (bleibt in der Tenant-Sprache), damit die offene
     Owner-Entscheidung O5 eine Messgrundlage hat.
2. Die bekannten Bestandsdefekte des Bench beachten: **ein** kaputtes Szenario reisst den
   ganzen Lauf (Lehre `convo-bench-bestandsdefekte`), und `n >= 5` ist Pflicht, damit die
   Zahl etwas bedeutet (Lehre `call-quality-chain`).
3. Der Lauf wird mit `--driver texml` dokumentiert — im Szenario-Kopf und in
   `README`/`docs`, nicht als Default-Änderung.

### NICHT-Scope

- **Kein** neues Werkzeug, kein neuer Treiber, keine Änderung an `DEFAULT_DRIVER_ID`.
- Kein Szenario, das eine Fähigkeit voraussetzt, die Inbound absichtlich nicht hat —
  die Szenarien pinnen das **Nicht**-Können als gewolltes Verhalten.
- Keine Audio-/Aussprachebewertung (das ist IP2).
- Keine Änderung an `src/`.

### Betroffene Dateien / Nahtstellen

`scripts/convo-bench/scenarios/*.mjs` (neu) · `scripts/convo-bench/scenarios/index.mjs`
(Registrierung) · Doku-Zeile mit der kanonischen Aufrufform.

### Invarianten (byte-identisch)

- Die **19** Bestandsszenarien bleiben unverändert — 18 mit `direction: "outbound"` und
  `inbound-nachricht.mjs` als einziges bestehendes Inbound-Szenario (nachgezählt über
  `scripts/convo-bench/scenarios/index.mjs#SCENARIOS`). Die Outbound-Zahlen bleiben
  vergleichbar. `SCENARIO_IDS` wächst nur um die neuen Kennungen; keine bestehende
  Kennung ändert sich, keine verschwindet.
- Kein Produktionscode unter `src/` wird angefasst.
- Die Bench schreibt nie in `data/store.json` (Temp-`DATA_DIR`, Bestandsmuster).

### Abnahmekriterium

```
node scripts/convo-bench.mjs run --driver texml --repeat 5
npm test -- --test-concurrency=4
```
Erwartet: der Lauf endet ohne Abbruch, nennt in der Kopfzeile `driver=texml`, und liefert
je Szenario eine Zahl. Diese Zahlen sind der Vorher-Wert für IP7 und werden im
Phasenbericht festgehalten.

### Testpflicht

- **Neu:** ein Test, der jedes registrierte Szenario auf Wohlgeformtheit prüft
  (Richtung gesetzt, Erwartungen vorhanden) — das ist der Riegel gegen "ein kaputtes
  Szenario killt den ganzen Lauf".
- **Neu:** derselbe Test hält fest, dass jede der 19 Bestandskennungen noch registriert
  ist. Ein Szenario, das beim Registrieren der neuen still herausfällt, wäre sonst als
  verschwundene Vorher-Zahl nicht zu bemerken.
- Kein neuer Produktionstest: diese Phase ändert kein Produktverhalten.

### Risiko + Rückfall

Risiko klein (nur Messwerkzeug), aber Aufwand real: die Szenarien müssen den Defekt
tatsächlich reproduzieren, sonst belegen sie nichts (Lehre
`bench-must-reproduce-defect`). Rückfall: Szenarien deregistrieren.

### Owner / Testanruf

Keine Owner-Entscheidung, kein Testanruf.

---

## Phase IP7 - Der Inbound-Handoff wartet auf das answered-Ereignis

**Abhängigkeiten:** IP6 (Vorher-Zahl), IP3 (Blueprint-Drift beseitigt, sonst kann der
Handoff aus der falschen Quelle scharf werden), IP1 (der korrigierte Pflichtsatz reist in
den Handoff).

### Ziel (deterministisch prüfbar)

Bei aktivem Schalter läuft ein eingehender Anruf auf dem Call-Control-AI-Assistant, **ohne**
den belegten `HTTP 422 (90034 Call not answered yet)`: der Handoff startet erst, nachdem
Telnyx den Anruf als angenommen gemeldet hat. Bei Schalter aus ist das Verhalten
byte-identisch zur Budget-Engine.

### Scope

1. **Die Wurzel, nicht das Symptom.** Belegt in `src/config.js` an
   `telnyxAssistant.inboundHandoffEnabled` (Messung 2026-08-04, Anrufe
   `call_msf0q18o473z` / `call_msf0qch6nect`): auf `inbound_path path=assistant` folgte
   370 ms später 422 — die Call-Control-API verlangt einen bereits **angenommenen**
   Anruf, während TeXML beim Inbound implizit annimmt. Der Handoff braucht also einen
   Auslöser, der nach dem answered-Ereignis liegt. Die Entscheidungsfunktion
   `src/telnyx-inbound.js#inboundHandoffDecision` bleibt rein und unverändert in ihrer
   Logik; was sich ändert, ist **wann** ihr Ergebnis ausgeführt wird.
2. **Kein Raten am Ereignisnamen.** Das answered-Ereignis wird an der Quelle belegt, nicht
   angenommen: `src/telephony/adapters/telnyx/call-control-events.js` und
   `src/telnyx-call-control-ingest.js` führen die vorhandene Ereignisbehandlung; die
   Feldnamen sind zu **messen** (dieselbe Disziplin, die
   `INBOUND_CALL_CONTROL_ID_FIELD` erzwungen hat: dort war ein geratener Feldname
   wochenlang der stille Defekt). Bis zur Messung ist der Ereignisname eine offene
   Messung, kein Implementierungsdetail.
3. **Fail-safe, nicht fail-open.** Kommt das answered-Ereignis nicht, bleibt der Anruf
   auf der Budget-Engine — der Anrufer hört immer ein funktionierendes Gespräch, niemals
   eine Fehleransage. Der Rückfallgrund wird als benanntes Token in der bestehenden
   Sonde geführt (`INBOUND_BUDGET_REASON` bekommt einen neuen Eintrag, z.B.
   `NOT_ANSWERED_YET`; `logInboundPathDecision` bleibt die **eine** Sonde, es entsteht
   keine zweite Logquelle).
4. **Eigenes Kostenprofil.** Der Assistant-Inbound-Pfad bekommt ein eigenes
   `KOSTENPROFIL` (analog `TELNYX_INBOUND_REALTIME`, dessen Existenz genau so begründet
   ist: "ein Flag-Flip bliebe sonst still"). Ohne das wäre die dokumentierte
   Verdreifachung in der Buchhaltung nicht von Budget-Inbound zu unterscheiden.
   Achtung: `src/billing/kostenarten.js#kostenprofilFuerAnruf` klassifiziert heute jeden
   Anruf mit `sipCallId` als `EL_CONVAI_SIP`, **unabhängig von der Richtung** — die
   Zuordnung des neuen Profils muss diese Reihenfolge respektieren und darf das
   EL-Profil nicht überschreiben.
5. **Der Schalter bleibt der Rückweg.** `TELNYX_INBOUND_HANDOFF_ENABLED` bleibt der
   Weg, Inbound ohne Deploy auf die Budget-Engine zurückzustellen. Default bleibt in
   dieser Phase **aus**; scharfgestellt wird nur nach einem erfolgreichen Testanruf.

### NICHT-Scope

- **Kein** Entfernen oder Aufweichen irgendeines Gates. Signaturprüfung,
  Tenant-Auflösung, pro-Tenant-Kostendecke, Max-Dauer-Notbremse und der gerenderte
  Pflichtsatz bleiben **vor** der Handoff-Entscheidung, exakt wie heute in
  `src/routes/voice.js`.
- Kein Eingriff in `src/bridge.js` (`HEIKLE STELLE`), keine Realtime-Engine.
- Keine ElevenLabs-Inbound-Freischaltung, kein `inbound_trunk_config` (Abschnitt 2).
- Keine neuen Werkzeuge für den Inbound-Agenten (das Richtungs-Gate bleibt, siehe O4).
- Keine Änderung am Assistant-Prompt oder an der Assistant-Provisionierung.
- **Keine Stimm-Sprachauflösung auf dem Assistant-Pfad.** Diese Phase ändert die Stimme
  nicht und macht Inbound damit **nicht** stimmgleich zu Outbound: der Speak-Node
  (`speakVoiceFields`) und die Assistant-Ressource
  (`scripts/telnyx-assistant-provision.mjs`) sprechen eine **statische**
  Plattform-Stimme für jede Sprache — bewusst, mit RCA-Begründung R5 und als
  R5-Regression in `test/telnyx-call-control.test.js` gepinnt (Fussnote (b)-Stimme).
  Wer hier "eine Stimme pro Sprache" einbaut, bricht diesen Test und erzeugt einen Anruf
  in zwei Stimmen. Eine Änderung daran ist Owner-Entscheidung O7 und eine eigene Kette.
  **Folge für die Abnahme:** ein FR-/EN-Testanruf auf diesem Pfad klingt erwartbar anders
  als der entsprechende Outbound-Anruf. Das ist kein Phasenfehler.

### Betroffene Dateien / Nahtstellen

`src/routes/voice.js` (Ausführungszeitpunkt des Handoffs) ·
`src/telnyx-inbound.js` (`INBOUND_BUDGET_REASON` additiv, `inboundAssistantHandoffXml`) ·
`src/telnyx-call-control-ingest.js` / `src/telephony/adapters/telnyx/call-control-events.js`
(answered-Ereignis) · `src/billing/kostenarten.js` (`KOSTENPROFIL`, `KOSTENPROFILE`,
`kostenprofilFuerAnruf`) · `src/config.js`, `.env.example`, `render.yaml` (Schalter-Doku).

### Invarianten (byte-identisch)

- **Schalter aus = byte-identisch** zum heutigen Inbound-TeXML, Attribut für Attribut.
- Die sieben Sicherungen aus Abschnitt 1.3 laufen unverändert und in unveränderter
  Reihenfolge; die Prüfreihenfolge in `inboundHandoffDecision` bleibt erhalten (ihr
  Kommentar begründet sie ausdrücklich als Sicherheit, nicht als Geschmack).
- Der Pflichtsatz wird weiterhin **von uns gerendert** und als Wert übergeben, nie
  gepromptet — Absolute Regel 2 (Inbound-Analogie, GAP-14).
- Outbound bleibt vollständig unberührt.
- Die Zahl der Ausgewanderten in `test/abnahme-ausgewandert.json` darf nicht sinken
  (Regel D13).

### Abnahmekriterium

```
node --check src/routes/voice.js && node --check src/telnyx-inbound.js
npm test -- --test-concurrency=4
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # + curl auf /voice/incoming
node scripts/convo-bench.mjs run --driver shim --repeat 5
```
Erwartet: `npm test` grün; bei Schalter aus liefert `curl` auf `/voice/incoming` dasselbe
TeXML wie vor der Phase (Byte-Vergleich); die Sonde `inbound_path` nennt bei Schalter aus
`reason=handoff_disabled` und bei Schalter an ohne answered-Ereignis den neuen
Rückfallgrund. **Live-Abnahme:** ein echter eingehender Anruf mit Schalter an, im
Render-Log ohne `422`/`90034`, mit `inbound_path path=assistant`, und der Anrufer kann
den Agenten unterbrechen.

### Testpflicht

- **Neu:** Handoff bei Schalter an, aber **ohne** answered-Ereignis → Budget-Engine, neuer
  Rückfallgrund, kein Call-Control-Aufruf (das ist der 422-Riegel als Test).
- **Neu:** Handoff bei Schalter an **mit** answered-Ereignis → Assistant-Pfad, und der
  übergebene `greeting`-Wert enthält den Pflichtsatz (Regel-2-Riegel).
- **Neu:** das neue Kostenprofil wird für einen Assistant-Inbound-Leg gesetzt, und ein
  EL-Leg mit `sipCallId` bleibt `EL_CONVAI_SIP` (Reihenfolge-Riegel aus Punkt 4).
- **Neu:** Schalter aus → byte-identisches TeXML (Snapshot).
- **Bestand:** `test/route-auth-inventory.test.js` und die Signatur-Tests bleiben grün —
  diese Phase fügt keinen Endpunkt hinzu.

### Risiko + Rückfall

**Hochrisiko:** Geld (dokumentierte Verdreifachung der Inbound-Minute), ein Live-Pfad für
echte Anrufer, und ein Provider-Race als Wurzel. Rückfall in zwei Stufen: (1) Schalter im
Render-Dashboard auf `false` — sofort, ohne Deploy; (2) `git revert`. Vor dem
Scharfstellen ist der Runtime-Output zu lesen, nicht zu raten (Absolute Regel 7):
Render-Log und Telnyx-Portal-Debugger.

### Owner / Testanruf

**Beides zwingend.** Owner-Entscheidung: die Verdreifachung der Inbound-Kosten erneut
bestätigen (die Zustimmung vom 2026-08-04 bezog sich auf einen Pfad, der danach
zurückgenommen wurde). Echter Inbound-Testanruf: der 422-Befund ist nur am echten Anruf
entstanden und nur dort zu widerlegen.

---

## 5. Clean-Code-Auflagen dieser Kette

Verbindlich ist `.claude/refs/clean-code.md`; jede Phase wird dagegen auditiert. Was in
**dieser** Kette konkret droht:

**Wo eine zweite Wahrheit droht (G5 — die wichtigste Regel, S2):**

1. **Die Stimm-Auflösung — und zwar mit der richtigen Konsumentenliste.** Es gibt
   **einen** sprachauflösenden Resolver, `elevenLabsVoiceIdFor`
   (`src/telephony/adapters/telnyx/elevenlabs-voice.js`), aber er hat **nicht** vier
   Konsumenten. Am Code nachgezählt:

   | Funktion | löst nach Sprache auf? | Konsumenten |
   |---|---|---|
   | `elevenLabsVoiceIdFor` | **ja** | `src/elevenlabs/call-locale.js#callLocaleFor` (Outbound-Anrufstart), `src/tts/directive-synth.js` (Play-TTS) |
   | `elevenLabsVoiceNameFor` | ja (Komposition darüber) | nur `render.js#sayVoiceAttrs` — der Relay-Zweig, den IP3 entfernt; danach **keiner** |
   | `elevenLabsVoiceName` | **nein**, eine statische Plattform-Stimme | `src/telephony/adapters/telnyx/voice.js#speakVoiceFields` (Call-Control-Speak), `scripts/telnyx-assistant-provision.mjs` |

   Call-Control-Speak und Assistant-Provisioner hängen also **nicht** am
   sprachauflösenden Resolver, sondern an `config.telnyx.telnyxElevenLabs.voiceId`. Das
   ist eine Entscheidung mit Begründung im Code (R5: "EINE Stimme im ganzen Call"), keine
   Nachlässigkeit — und es ist gleichzeitig die Qualitätsgrenze des (b)-Pfads
   (Fussnote (b)-Stimme, O7).
   **Auflagen daraus:**
   - Kein neuer Voice-Resolver, kein neuer Env-Schalter für eine Stimme. IP4 pinnt den
     einen Resolver mit einem Test — **für seine zwei echten Konsumenten**, nicht für
     vier (sonst pinnt der Test einen Sollzustand, den niemand beschlossen hat).
   - Die drei Funktionen bleiben **eine** Quelle für Format und Auflösung; wer den
     Assistant-Pfad je sprachaufgelöst haben will, ändert die bestehende Auflösung, statt
     eine zweite daneben zu stellen.
   - `elevenLabsVoiceNameFor` ist nach IP3 ein Export ohne Konsumenten und wird dort
     entfernt (G9). Ein "bleibt, ist ja geteilt" wäre toter Code mit falscher
     Schutzbehauptung — und die Behauptung "geteilt" war genau der Irrtum, den diese
     Tabelle korrigiert.
2. **Die Sprechpfad-Klassifikation.** IP2 führt sie ein (`play_tts`/`azure_say`/
   `telnyx_relay`), IP4 braucht sie für die Boot-Zeile. **Auflage:** eine Funktion, zwei
   Konsumenten — die Naht muss in IP2 gezogen werden, **bevor** IP4 sie braucht. Nicht
   zwei Ortsnamen für dasselbe.
3. **Der Begrüssungs-Wortlaut.** `DEFAULT_GREETING` ist schon heute die eine Quelle
   (`LOCALES.de.greetingDefault` verweist darauf). **Auflage:** IP1 darf den Satz nicht
   ein zweites Mal literal hinschreiben — auch nicht in der Migrationskarte als
   "neuer" Wert; dort steht der neue Wert als Referenz auf die Konstante, nicht als
   Kopie.
4. **Die Inbound-Pfad-Sonde.** `logInboundPathDecision` ist die eine Sonde je Leg. IP7
   ergänzt einen Grund-Token, **keine** zweite Logzeile für denselben Sachverhalt
   (Lehre `live-cost-tracing-chain-complete`: nie zwei Sachverhalte auf ein Label — und
   nie zwei Labels für einen).
5. **Blueprint gegen Code.** Der `render.yaml`/`config.js`-Widerspruch bei
   `TELNYX_INBOUND_HANDOFF_ENABLED` ist der Prototyp einer zweiten Wahrheit über einen
   Wahrheitswert. IP3 beseitigt ihn **und** stellt einen Test dahinter, damit er nicht
   zurückkommt.

**Welche gemeinsame Naht VORHER gezogen werden muss:**

- Die Sprechpfad-Klassifikation (IP2, vor IP4).
- Der Test-Server-Start: IP2 benutzt `test/helpers.js#startServer`, statt einen zweiten
  Start-Weg zu bauen. Ein zweiter Weg driftet garantiert an `BASE_ENV` vorbei (Lehre
  `test-base-env-drift`: jede neue Env-Variable gehört in `BASE_ENV`, sonst leckt `.env`
  in Spawn-Tests).
- Das answered-Ereignis (IP7) wird an der bestehenden Ingest-Naht gelesen, nicht in
  `routes/voice.js` nachgebaut — Telefonie-Logik läuft über die Ports, nie direkt im
  Server (Architektur-Regel).

**Welche Magic Numbers nach `src/config.js` gehören (G25/G35):**

- Nichts aus IP1–IP3: die Umlaut-Korrektur ist ein Wortlaut, die Migrationskarte ist
  kuratierter Produktinhalt (dieselbe Klasse wie `ELEVENLABS_VOICE_ID_BY_PROFILE`, das
  ausdrücklich **kein** Env-Schalter ist, mit Begründung im Modul).
- IP5: falls eine Modellklasse gewählt wird, bleibt sie `ELEVENLABS_MODEL` in
  `src/config.js` — mit Eintrag in `.env.example` **und** `render.yaml`.
- IP7: jede Warte-/Fristangabe am answered-Ereignis ist ein konfigurierbarer Wert und
  gehört nach `src/config.js` mit `min`/`max` (Muster `numEnv`), nie als nackte Zahl in
  den Handler. Der neue `INBOUND_BUDGET_REASON`-Eintrag ist ein benannter Token, kein
  String-Literal am Verwendungsort.

**Weitere Katalogpunkte, die diese Kette bewusst einhält:**

- **G4 (übergangene Sicherungen, S1):** keine Phase fügt einen
  `eslint-disable`-artigen Marker, einen übersprungenen Test oder einen neuen Eintrag in
  `eslint-suppressions.json` hinzu.
- **G9/toter Code:** IP3 **entfernt** einen Pfad, statt ihn abzuschalten. Ein
  abgeschalteter defekter Pfad ist toter Code mit einer falschen Schutzbehauptung. Das
  gilt bis in die Ränder: mit dem Zweig gehen `elevenLabsVoiceNameFor`, die render.js-
  Importe, der `opts.elevenLabs`-Vertrag und die Registry-Injektion — und der Modulkopf,
  der den Renderer noch als Konsumenten nennt. **Die Abnahme prüft Konsumenten je
  Funktion, nie je Modul**; auf Modulebene sieht jede dieser Funktionen benutzt aus.
- **G30 (eine Aufgabe pro Funktion):** IP7 berührt `/voice/incoming`, einen Handler, der
  bereits viel trägt. Neue Logik entsteht als eigene, benannte Funktion (Muster
  `inboundAssistantHandoffXml`), nicht als weiterer Abschnitt im Handler.
- **T5/G3 (Grenzen):** jede neue Entscheidung braucht ihren Negativfall als Test —
  fehlendes Ereignis, leeres Kontingent, unbekanntes Profil, altes Greeting.
- **Kommentare auf Deutsch, OHNE Umlaute im Code.** Dieses Dokument trägt Umlaute; jeder
  Code-Kommentar der Kette nicht. Umgekehrt: **gesprochene** DE-Strings tragen Umlaute
  (Lehre `umlaut-transliteration-root-cause`) — genau das ist IP1.

---

## 6. Offene Messungen und Owner-Entscheidungen

### Offene Messungen (jede mit dem konkreten nächsten Schritt)

| # | Was offen ist | Nächster Schritt |
|---|---|---|
| M1 | Live-Wert von `ELEVENLABS_PLAY_TTS_ENABLED` auf Render. `.env` setzt ihn nicht, `render.yaml` sagt `"false"` — aber die Services sind Dashboard-managed, der Blueprint ist **nicht** die Live-Wahrheit. Damit ist unbelegt, ob Inbound heute Azure oder ElevenLabs spricht. | Render-Dashboard lesen; danach IP2 lokal mit demselben Wert fahren. |
| M2 | Live-Wert von `ELEVENLABS_OUTBOUND_ENABLED`. Mehrere Kettenstände legen einen live laufenden EL-Outbound nahe; `.env` sagt `false`. Ohne diesen Wert ist selbst "Outbound läuft über ElevenLabs" am Repo nicht belegt. | Render-Dashboard lesen; gegenprüfen am Kostenprofil eines jungen Outbound-Anrufs (`EL_CONVAI_SIP` in der Prod-DB). |
| M3 | Live-Werte von `TELNYX_AI_ASSISTANT_ENABLED` und `TELNYX_INBOUND_HANDOFF_ENABLED`. Der Config-Kommentar hält fest, dass der Master-Schalter live **auf `true`** stand, während jeder Inbound über die Budget-Engine lief. | Render-Dashboard lesen; **vor** IP7 bestätigen, sonst wird IP7 gegen einen falschen Ausgangszustand gebaut. |
| M4 | Live-Wert von `tts.model_id` und `tts.voice_id` am Outbound-Agenten, sowie ob die Whitelist `platform_settings.overrides.conversation_config_override.tts.voice_id` live `true` trägt. Ein nicht freigeschaltetes Override-Feld wird vom Anbieter **still ignoriert** (Modulkopf `src/elevenlabs/outbound.js`) — dann spräche Outbound die Dashboard-Stimme, und der Anker aus W1 hielte nur auf dem Papier. | `npm run elevenlabs:drift`; die Kennung selbst nur per Mini-Synthese prüfen, nie per `GET /v1/voices/{id}` (Lehre `el-stimme-pruefen-nur-per-synthese`). Blocker für IP4 und IP5. |
| M5 | Ob der Owner-Test-Tenant eine **eigene** Begrüssung gesetzt hat. Dann greift `DEFAULT_GREETING` für ihn nicht, und der Umlaut-Befund wäre für seinen Anruf ohne Wirkung (für alle anderen Mandanten bleibt er). | Prod-DB-Schnappschuss von `settings.greeting` (RLS-Gotcha `app.current_tenant` beachten); danach IP1s Nachzieh-Lauf im Trockenlauf fahren. |
| M6 | Typische (nicht Worst-Case) End-zu-End-Stille eines Inbound-Turns. Belegt ist nur die rechnerische Obergrenze (`turn-budget.js`: 4 Runden, je bis 11250 ms, plus bis 2000 ms Synthese). | IP2 liefert die Marken lokal; der Median am echten Anruf braucht die `src/metrics.js`-Zeilen aus dem Render-Log. |
| M7 | Der Name und die Zustellform des Telnyx-answered-Ereignisses für einen **Inbound**-Leg. Ein geratener Feldname war hier schon einmal der stille Defekt (`INBOUND_CALL_CONTROL_ID_FIELD`, gemessen statt angenommen). | Vor IP7: einen echten Inbound-Anruf im Telnyx-Portal-Debugger mitlesen und die Schlüsselliste protokollieren — nie aus der Doku übernehmen. |
| M8 | Ob ein Inbound-Anruf über die Budget-Engine überhaupt eine Telnyx-Aufnahme erzeugt, aus der ein Audio-Sample für eine manuelle Aussprachprüfung zu gewinnen wäre. | Nur relevant, falls IP2s lokale `<Play>`-Datei als Hörbeleg nicht genügt; dann Telnyx-Recordings am Testanruf prüfen. |
| M9 | Ob der 422-Befund seit dem 2026-08-04 erneut geprüft wurde. Im Repo findet sich keine neuere Messung. | IP7, Punkt 2 — die Messung ist Teil der Phase, nicht ihre Voraussetzung. |
| M10 | Live-Wert von `TELNYX_ELEVENLABS_VOICE_ID` (und `TELNYX_ELEVENLABS_API_KEY_REF`) — also die **statische** Stimme, die der Assistant-Pfad in jeder Sprache spricht. Lokal setzt `.env` keinen der beiden Schlüssel; damit ist unbelegt, (a) ob der Assistant-Speak-Node live überhaupt ElevenLabs spricht (ohne beide Teile fällt `hasElevenLabsVoice` auf Azure zurück) und (b) ob der Wert zufällig der kuratierten DE-Kennung entspricht. Ohne diese Messung ist "IP7 klingt in DE wie Outbound" eine Vermutung. | Render-Dashboard lesen; danach die live provisionierte Assistant-Ressource per `GET` gegen `voice_settings.voice` gegenprüfen (Regel `provider-config-needs-doc-before-diagnosis`). Blocker für die Abnahme-Erwartung von IP7, nicht für IP7 selbst. |
| M11 | Farbstand des Katalog-Tests `VOICE-12` vor und nach IP3. Er misst die Sprachauflösung am TeXML-`<Say>`, also an dem Zweig, den IP3 entfernt; sein Umzug auf den Play-TTS-Pfad (IP3, Scope 3) darf keinen Farbwechsel verstecken. Dieses Dokument nennt den Stand **nicht** — er ist in der Befundphase nicht gemessen worden (kein Testlauf). | `npm run test:gates` vor dem ersten IP3-Commit fahren und den Stand im Phasenbericht notieren; danach erneut (Lehre `sec-fix-chain-complete`: Zähler neu messen, nie aus einer Notiz lesen). |

### Owner-Entscheidungen (Kette steht ohne sie)

| # | Entscheidung | Warum sie nicht delegierbar ist |
|---|---|---|
| O1 | **`ELEVENLABS_PLAY_TTS_ENABLED` live auf `true`** (IP4). | Es kostet ElevenLabs-Zeichen auf einem Plattform-Konto ohne per-Tenant-Metering — eine Geldentscheidung. Rückweg ist ein Dashboard-Flip. |
| O2 | **Modellklasse: gleich oder bewusst verschieden** (IP5), und falls gleich: Push in die Live-Konfiguration des Outbound-Agenten. | Klang gegen Latenz ist eine Produktentscheidung, und der Push wirkt sofort auf Outbound, den heute niemand beklagt. |
| O3 | **Den Assistant-Inbound-Pfad scharfstellen** (IP7) und die dokumentierte Verdreifachung der Inbound-Minute (~5 US-Cent gegen 1,87) erneut bestätigen. Die Zustimmung vom 2026-08-04 bezog sich auf einen Pfad, der danach zurückgenommen wurde. | Reine Kostenentscheidung mit Live-Wirkung auf echte Anrufer. |
| O4 | **Bleibt das Richtungs-Gate für `get_consult`/`look_up`?** Heute bekommt ein Inbound-Anrufer nie eine echte Antwort auf eine Frage, die nur der Auftraggeber weiss — mit ausdrücklicher Sicherheitsbegründung im Code. Das ist ein Fähigkeits-Delta, kein Bug. | Eine Lockerung wäre eine neue Datenfluss-Entscheidung (Rückfrage beim Auftraggeber wegen eines fremden Anrufers; Suchanfrage nach aussen aus einem fremden Gespräch). Nicht ohne Owner, und dann als eigene Kette mit `PLAN-SECURITY.md`-Eintrag. |
| O5 | **Braucht Inbound Spracherkennung im Gespräch?** Ruft jemand in einer anderen Sprache an als am Tenant/an der Nummer hinterlegt, bleibt der Agent den **ganzen** Anruf in der falschen Sprache (`resolveCallLanguage`, einmalig vor dem ersten Wort). Outbound hat dafür ein Anbieter-Werkzeug. | Grosser Aufwand, und die reale Häufigkeit ist unbekannt (M-Frage ohne Messgrundlage). Bewusst **keine** Phase dieser Kette — IP6 schafft mit einem Szenario erst die Messgrundlage. |
| O6 | **Der ElevenLabs-Agent für Inbound: dauerhaft nein, oder später über unseren Webhook?** Diese Kette verwirft nur den `inbound_trunk_config`-Weg (Gate-Umgehung). Die Variante "unser Webhook nimmt an, rendert den Pflichtsatz, übergibt dann" bleibt denkbar — mechanisch ist sie IP7 mit anderem Ziel. | Sie berührt Absolute Regel 1 und 2 und ist deshalb per Definition eine Owner-Entscheidung, keine Architekturwahl eines Implementierers. |
| O7 | **Soll der Telnyx-AI-Assistant-Pfad die Stimme pro Sprache auflösen?** Heute spricht er eine statische Plattform-Stimme in jeder Sprache — bewusst, weil die Assistant-Ressource **ein** global provisioniertes Voice-Setting hat und ein sprachaufgelöster Speak-Node davor denselben Anruf in zwei Stimmen sprechen liesse (RCA-Wurzel R5, gepinnt in `test/telnyx-call-control.test.js`). Damit gilt: auch mit scharfem IP7 klingt ein FR-/EN-Inbound-Anruf **nicht** wie der entsprechende Outbound-Anruf. | Es wäre eine neue Fähigkeit (Per-Call-Voice-Override am Assistant oder eine Assistant-Ressource je Sprache), ein Eingriff in die Live-Provisionierung und die Rücknahme einer dokumentierten RCA-Entscheidung. Bewusst **keine** Phase dieser Kette; sinnvoll erst, wenn IP7 überhaupt live ist und M10 den Ist-Wert kennt. |
