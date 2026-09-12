# PLAN-INBOUND-PARITAET

**Frage:** Wie wird die Gesprächsqualität eines INBOUND-Anrufs so gut wie die eines
OUTBOUND-Anrufs — Stimme, Aussprache, Turn-Taking, Fähigkeiten?

**Stand:** 2026-09-12. Alle Aussagen unter "Ausgangslage" sind am Code dieses Commits
belegt (Datei + Symbolname, keine Zeilennummern — die rotten). Was nicht belegt ist,
steht ausschliesslich unter "Offene Messungen".

**Gegengelesen gegen den Code (2026-09-12, adversarialer Durchgang, ~45 Behauptungen).**
Drei Befunde daraus leben weiter, weil sie am Code belegt sind: die Konsumentenliste der
Stimm-Auflösung je **Funktion** (Abschnitt 5, Punkt 1 — Folgen in IP3, IP4 und IE6), die
Zahl der `fuer`-Vorkommen im Begrüssungskatalog (W2; behoben in IP1) und der ungemessene
Farbstand der Testbänke (daraus ist M11 geworden). Was dieser Durchgang über den
Telnyx-Assistant-Pfad festhielt, ist als Fussnote (b)-Stimme in 2.5 erhalten — sie ist der
Grund, warum dieser Pfad entfernt und nicht scharfgestellt wird.

---

**Umgeschrieben am 2026-09-12 auf den Owner-Einwand "EIN Gesprächs-System, nicht zwei".**
Ersetzt wurden die Abschnitte 2 (Leitentscheidung), 3 (Pre-Mortem) und 4 (Phasenkette);
Abschnitt 6 ist nachgezogen. Abschnitt 1 bleibt inhaltlich stehen — W1–W4 und die sieben
Sicherungen sind am Code belegt — und ist um 1.4 **ergänzt**: die Anbieter- und
Code-Belege, die dieser Lauf neu gemessen hat. Die alte Leitentscheidung (Telnyx-AI-Assistant
als Turn-Taking-Weg) ist **zurückgenommen**; der Assistant ist damit kein Ziel mehr, sondern
Löschkandidat. Was aus der alten Kette entfällt oder zurückgestellt ist, steht mit Grund in
4.1, was aus Abschnitt 6 gestrichen ist, jeweils am Ende der Tabelle.

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

### 1.4 Was der EIN-System-Lauf am Anbieter und am Code neu belegt hat

Ergänzung zu 1.1–1.3. Nichts hier streicht einen Befund von oben; W1–W4 und die sieben
Sicherungen stehen unverändert. Provider-Aussagen tragen ihre URL und das Abrufdatum,
Code-Belege Datei + Symbolname ohne Zeilennummern.

| # | Belegt | Quelle |
|---|---|---|
| B1 | Ein eingehender SIP-INVITE an ElevenLabs braucht eine **Kennung vor dem `@`**: `sip:+19991234567@sip.rtc.elevenlabs.io:5060`. Die Doku verbietet ausdrücklich den Aufruf "directly to `sip@sip.rtc.elevenlabs.io:5060` without an identifier". | elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking (2026-09-12) |
| B2 | Der ankommende INVITE wird **entweder** per Digest-Zugangsdaten **oder** per ACL über die Signalisierungs-Quell-IP authentifiziert. | dieselbe Seite |
| B3 | Eigene SIP-`X-`Header eines Inbound-Trunk-Anrufs werden **automatisch zu dynamic variables**, nach einer exakten Regel: `X-`-Präfix weg, klein, Bindestrich → Unterstrich, `sip_`-Präfix davor (`X-Contact-ID` → `{{sip_contact_id}}`). Das ist ein **Variablen**-Kanal — **kein** Override-Kanal für Stimme, Sprache oder `first_message`. | dieselbe Seite |
| B4 | **Wie** ElevenLabs einen ankommenden INVITE einem Agenten zuordnet, ist **nicht ausgesprochen**. Die Doku sagt nur, eine importierte Trunk-Nummer lasse sich "assign to an ElevenLabs agent". Die naheliegende Annahme "Kennung vor dem `@` = die zugewiesene Nummer" ist damit **unbelegt** und darf keine Phasen-Prämisse sein. | dieselbe Seite; Gegenprobe: Live-`GET /v1/convai/agents/{id}` zeigt an einer von vier verknüpften Nummern `supports_inbound=true` mit vollständigem `inbound_trunk`-Objekt |
| B5 | TeXML-`<Dial>` trägt `timeLimit` in Sekunden, Bereich **60–14400**, Default 14400; `<Sip>` wählt eine SIP-URI. **Nicht** dokumentiert: eigene SIP-Header an `<Sip>`, und was während der Brücke mit der Kontrolle über das Elternbein geschieht. | developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial (2026-09-12) |
| B6 | Ein laufendes EL-Gespräch von **aussen** zu beenden ist dokumentiert — Monitoring-WebSocket `wss://api.elevenlabs.io/v1/convai/conversations/{conversation_id}/monitor`, Kommando `{"command_type":"end_call"}`, `xi-api-key` mit Editor-Recht — aber ausdrücklich als **enterprise-only feature**, und man muss sich **nach** Gesprächsbeginn verbinden. Solange der Tarif unbelegt ist, ist das **keine** Notbremse. | elevenlabs.io/docs/eleven-agents/guides/realtime-monitoring (2026-09-12) |
| B7 | Unser Code sagt über den REST-Weg dasselbe: `src/elevenlabs/convai.js#endConversation` hält fest, der `DELETE`-Versuch beantworte nur "hat der Anbieter den Aufruf angenommen", und **ob** er die Leitung kappt, sei **nicht belegt**. `src/telephony/call-termination.js#hangUpAction` liefert für einen EL-Call folgerichtig `null`, wenn kein Telnyx-Griff existiert. | Code |
| B8 | **Die Geld-Achse hat keinen Herzschlag.** `blockingBudgetAxis` (`src/budget-gate.js`) wird aus genau vier Stellen gefragt: `claude.js#agentTurn` (vor jeder Turn-Runde), `telnyx-llm-shim.js` (Assistant-Pfad), `routes/webhooks-elevenlabs.js` (nur wenn der Agent im Gespräch ein Werkzeug ruft) und `telephony/call-lifecycle.js#reattachActiveCall` (nur an einem `/voice/*`-Request). **Kein Timer, kein Heartbeat.** Die Mid-Call-Wirkung der Kostendecke hängt heute am Turn-Loop. | Code |
| B9 | **Das Fähigkeits-Gate ist unsere Sicherung, nicht eine Eigenschaft zweier Gehirne.** `consultAvailableFor` (`src/consult/in-call.js`) verlangt `call.direction === "outbound"`, und der EL-Werkzeug-Webhook (`routes/webhooks-elevenlabs.js`) prüft die Richtung erneut, bevor er antwortet. Ein Inbound-Anruf am **selben** Agenten bekommt `get_consult`/`look_up` also weiterhin nicht. Derselbe Prädikat-Zweig sperrt heute zusätzlich `VOICE_ENGINE.REALTIME`. | Code |
| B10 | Die Ersatzantwort des Wiederholungs-Riegels ist ein **Gather**: `keepAliveXml: (call) => render(followupTurnDirectives(call, ""))` in `src/routes/voice.js`. Sie ist an die Budget-Engine gebunden, nicht an den Zustand des Anrufs. | Code |
| B11 | `src/telephony/directives.js` kennt `say`/`gather`/`hangup`/`redirect`/`stream` — **keine** SIP-Dial-Direktive. Die strukturelle Präzedenz für "einen Satz sprechen, dann übergeben" existiert dagegen: `src/telephony/voice-render.js#streamDirectives` tut in **einem** TeXML-Dokument genau das. | Code |
| B12 | `src/billing/kostenarten.js#legacyKostenprofil` klassifiziert **jeden** Anruf mit `sipCallId` als `EL_CONVAI_SIP`, **richtungsunabhängig**; `EL_CONVAI_SIP` trägt als gemessene Pflichtmenge `[sip-trunking]`. Ein neuer Inbound-Weg darf dieses Profil daher nicht wiederverwenden und seine Reihenfolge nicht überschreiben. | Code |
| B13 | Lokal (`.env`, nur Zustand, keine Werte): `TELNYX_SIP_TRUNK_USERNAME` und `-PASSWORD` leer, `ELEVENLABS_NUMBER_REGISTRATION_ENABLED` leer, `ELEVENLABS_OUTBOUND_ENABLED=false`, `ELEVENLABS_PLAY_TTS_ENABLED` leer, `TELNYX_AI_ASSISTANT_ENABLED` und `TELNYX_INBOUND_HANDOFF_ENABLED` leer, `TELNYX_ELEVENLABS_VOICE_ID` leer; `ELEVENLABS_API_KEY` und `ELEVENLABS_AGENT_ID` gesetzt. Render ist Dashboard-managed — das sind **lokale** Aussagen, nicht die Live-Wahrheit (M1–M3). | `.env` |

**Die eine Zeile, die alles trägt:** unser Webhook ist bei einem eingehenden Anruf zuerst
dran, weil die DID auf unsere Telnyx-Voice-Application zeigt. Jeder Mechanismus, der das
beibehält, behält die sieben Sicherungen an ihrer heutigen Naht. Jeder Mechanismus, der es
aufgibt, muss sie beim Anbieter neu erfinden — und dort fehlen die Bauteile (B4, B6).

---

---

## 2. Leitentscheidung

> **EIN Gesprächs-System für beide Richtungen: der ElevenLabs-ConvAI-Agent. Inbound
> erreicht ihn über K1 — unser Webhook nimmt an, rendert den Pflichtsatz und übergibt
> das Bein danach per SIP an den Agenten. Das Carrier-Bein bleibt unser, deshalb bleiben
> alle sieben Sicherungen an ihrer heutigen Naht und der Hangup-Griff in unserer Hand.
> K3 (die Nummer zeigt auf den EL-Inbound-Trunk) ist **nicht zulässig**: dort fallen drei
> Sicherungen weg, nicht "nur mit neuem Code". K2 (Media-Bridge) ist der benannte
> Rückfall mit genannter Auslösebedingung. K4 (Telnyx-Assistant) wird **entfernt**, nicht
> scharfgestellt.**
>
> Am Ende der Kette lebt Gesprächslogik bei uns **nirgends** mehr: kein Turn-Loop, kein
> eigener STT-Seam, kein Prompt je Richtung, kein zweiter Voice-Anbieter im Audiopfad.
> EIN Agent, EINE Stimme, EIN Kostenpfad. Was bei uns bleibt, ist ausschliesslich
> **Sicherungs- und Transportcode** — und das ist per Owner-Vorgabe ausdrücklich kein
> Verstoss gegen den Massstab.

### 2.1 Die Zielarchitektur in einem Satz je Schicht

| Schicht | Zielzustand | Heute |
|---|---|---|
| Gehirn | **einer**: der EL-ConvAI-Agent, für Inbound und Outbound | zwei (EL outbound, `claude.js#agentTurn` inbound) |
| Transportweg Inbound | unsere DID → unsere Voice-Application → `/voice/incoming` (sieben Sicherungen) → gerenderter Pflichtsatz → SIP-Übergabe an `sip:+<DID>@sip.rtc.elevenlabs.io:5060` | `/voice/incoming` → TeXML-`<Gather>` → `/voice/turn` (Turn-Loop bei uns) |
| Stimme | **eine**, über `elevenLabsVoiceIdFor` aufgelöst — für den gerenderten Satz **und** für den Agenten | Azure inbound (Flag aus), EL outbound |
| Kostenpfad | EL-Ist (`elevenlabs_convai`) + **ein** Telnyx-Träger, je Richtung dasselbe Muster | zwei Muster (`TELNYX_INBOUND_BUDGET` mit Konfigurationspreis vs. `EL_CONVAI_SIP` mit Anbieter-Ist) |
| Notbremse | unser Telnyx-Bein: `hangUpAction` über `callControlId`, plus `<Dial timeLimit>` als provider-erzwungene Zweitlinie (B5) | unser Telnyx-Bein (Inbound), bei EL-Outbound **kein belegter Griff** (B7) |
| Geld-Achse mid-call | ein **wiederkehrender** Wächter, pfad- und richtungsneutral (IE2) | nur über den Turn-Loop (B8) — bei EL-Outbound heute schon offen |
| Fähigkeits-Gate | unverändert unsere Sicherung am Werkzeug-Webhook (B9) | dasselbe |
| Engines im Code | **eine** | vier Zweige: Budget, Assistant (aus), Realtime-Bridge (aus), EL |

### 2.2 Der Massstab, und wie die Kandidaten daran gemessen wurden

Rangfolge des Owners: es gewinnt, wer am Ende am **wenigsten eigene Gesprächslogik und
eigene Buchhaltung** zurücklässt — **bei gleichem Sicherungsniveau**. "Schnell gebaut"
ist Tiebreaker, nie Kriterium. Sicherungs-Code zählt nicht gegen einen Kandidaten.

| | K3 "EL nimmt an, wir entscheiden vorher" | **K1 "annehmen, Satz sprechen, per SIP übergeben"** | K2 "Media-Bridge" | K4 "Telnyx-Assistant" |
|---|---|---|---|---|
| Gesprächslogik danach bei uns | **null** | **null** | Turn-Taking-Mechanik (Barge-in, Frame-Übersetzung, Call-Ende-Puffer — die als `HEIKLE STELLE` markierten Abschnitte von `bridge.js`, nur mit EL statt OpenAI) | **ein drittes Gehirn** mit eigenem Prompt |
| Buchhaltung danach | ein Profil, aber ohne unseren Anruf-Datensatz | ein Profil, Muster wie Outbound | ein Profil, deckungsgleich mit der bestehenden `telnyx_inbound_realtime`-Form | ein **drittes** Profil, dessen Haupttreiber laut Katalog nicht einmal pro Anruf zuordenbar ist |
| S1 Ed25519 fail-closed | **fällt weg** | ueberlebt unverändert | ueberlebt unverändert | ueberlebt |
| S2 Wiederholungs-Riegel | fällt weg | nur-mit-neuem-code (IE4) | nur-mit-neuem-code | ueberlebt |
| S3 Tenant nach Signatur | **fällt weg** (unsigniertes Body-Feld) | ueberlebt unverändert | ueberlebt unverändert | ueberlebt |
| S4 Kostendecke, Start | **fällt weg** (kein Reject-Vertrag) | ueberlebt unverändert | ueberlebt unverändert | ueberlebt |
| S4 Kostendecke, mid-call | fällt weg | nur-mit-neuem-code (IE2) | nur-mit-neuem-code (IE2) | ueberlebt (Shim fragt die Achse) |
| S5 Max-Dauer-Notbremse | **fällt weg** (B6/B7) | ueberlebt, Neustart eingeschlossen | nur-mit-neuem-code (Neustart-Lücke) | ueberlebt |
| S6 Kostenprofil-Buchung | fällt weg (Anruf ohne unseren Datensatz möglich) | nur-mit-neuem-code (IE3) | nur-mit-neuem-code (IE3) | nur-mit-neuem-code |
| S7 gerenderter Pflichtsatz | **fällt weg** (wird Dashboard-Zeile) | ueberlebt, plus Doppelansage-Riegel (IE5) | ueberlebt, plus Riegel | ueberlebt |
| Urteil | **unzulässig** | **gewählt** | **Rückfall** | **wird entfernt** |

### 2.3 Warum K3 nicht zulässig ist (und das ist keine Abwägung)

K3 wäre der wörtlich schönste Weg: der Anbieter führt das Gespräch, wir entscheiden vorher
und protokollieren danach, bei uns entsteht nicht eine Zeile Audio- oder Gesprächscode.
Die Prüfung dieses Laufs hat ihn deshalb **zuerst** vorgenommen, nicht als Bypass
abgetan. Er scheitert an vier Anbieter-Belegen, von denen drei Sicherungen **wegfallen** —
und Absolute Regel 1 und 2 stehen nicht zur Abwägung.

1. **S1 (Ed25519, fail-closed) hat keinen Ersatz.** Der Gesprächs-Initiations-Webhook ist
   **nicht** signiert; HMAC-signiert sind beim Anbieter nur `post_call_transcription` und
   die drei `voice_removal`-Ereignisse. Die einzige Authentifizierung ist ein von uns
   gesetztes **statisches Header-Geheimnis** — dieselbe Klasse wie unser bestehender
   `ELEVENLABS_TOOL_TOKEN`, nicht dieselbe Klasse wie ein asymmetrisches Signaturschema
   mit Wiederholungsschutz. Für Inbound wäre die Provider-Signaturprüfung damit
   **umgangen**. Kein zusätzlicher Sicherungs-Code bei uns kann eine Signatur herstellen,
   die der Anbieter nicht leistet.
2. **S3 (Tenant-Auflösung nach der Signatur) hängt danach an einem unsignierten Feld.**
   Die angerufene Nummer käme aus dem Body dieses Webhooks. Genau diesen Spoof verhindert
   S3 heute. Der Schaden ist nicht nur Geld: der Tenant entscheidet Begrüssung, Sprache,
   Kontext und Postfach — eine falsche Tenant-Bindung ist ein Datenweg zwischen Mandanten.
   Vorhandene Härtung wäre eine IP-Allowlist beim Anbieter: eine Egress-Liste, kein
   Signaturbeweis.
3. **S4 (Kostendecke) hat keinen Ablehnungs-Vertrag.** Die Doku sagt nur, ein
   fehlgeschlagener oder abgelaufener Webhook **könne** den Gesprächsstart verhindern
   ("A failed or timed-out webhook can prevent the conversation from starting"). Es gibt
   kein Reject-Feld, keinen dokumentierten Statuscode, keine Zusage über das Verhalten im
   Fehlerfall (harter SIP-Abbruch vs. Rückfall auf die Agenten-Default-Konfiguration).
   Einen absichtlichen 5xx als Gate zu benutzen ist **geraten** — und genau das hat sich
   dieses Projekt schon zweimal verletzt. Ohne Sperrwirkung gibt es unter K3 keine
   Kostendecke, keine Denylist und keine Ablehnung unbekannter Nummern.
4. **S5 (Max-Dauer-Notbremse) hat keinen benutzbaren Kanal.** Der einzige dokumentierte
   Außen-Abbruch ist die Monitoring-WebSocket mit `{"command_type":"end_call"}` — und die
   Doku nennt sie **enterprise-only** und verlangt Verbinden **nach** Gesprächsbeginn
   (B6). Unser eigener Code sagt über den REST-Weg dasselbe: **nicht belegt**, ob der
   `DELETE` die Leitung kappt (B7). Unter K3 hätten wir nie einen Telnyx-Griff auf das
   Bein. Ein Anruf, den unser Prozess nicht beenden kann, ist genau der Fall, gegen den
   die Notbremse existiert.

Der Preis, den K3 dafür verlangt, ist damit nicht "etwas mehr Sicherungs-Code", sondern
das Entfernen von Absolute Regel 1 für die eingehende Richtung. **K3 ist ausgeschieden.**
Was ihn freischalten würde, steht als Messung M18/M21 in Abschnitt 6 — bis dahin ist er
keine Option, auch nicht als Abkürzung.

### 2.4 Warum K1 gewinnt, und woran seine Prämisse noch hängt

K1 lässt bei uns **dieselbe Null an Gesprächslogik** zurück wie K3 — aber es gibt sie
nicht auf, dass unser Webhook zuerst dran ist. Damit ist die Sicherungslage die heutige:
S1, S3, S4-Start, S5 und S7 laufen unverändert an ihrer bestehenden Naht, S2/S4-mid-call/S6
brauchen zusätzlichen **Sicherungs**-Code (IE2–IE4), und S5 überlebt sogar einen
Prozess-Neustart, weil `rearmActiveCallTimers` den Call über den persistierten
Telnyx-Griff wiederfindet. Der Umbau bei uns ist: eine SIP-Dial-Direktive neben den fünf
bestehenden, ein Renderer-Zweig, eine Übergabe-Entscheidung — in der strukturellen Form,
die `streamDirectives` schon vorgibt (B11).

**Was K1 noch nicht belegt hat, und was deshalb gemessen wird, bevor gebaut wird (IE1):**

- **B4, der Kern:** dass ein INVITE an `sip:+<unsere DID>@sip.rtc.elevenlabs.io:5060`
  wirklich den Agenten erreicht, der an dieser Nummer hängt. Die URI-**Form** ist belegt
  (B1), die **Zuordnungslogik** nicht.
- **Der Variablenkanal:** `X-`Header werden zu dynamic variables, mit exakter Regel (B3) —
  aber eigene Header an TeXML-`<Sip>` sind **nicht** dokumentiert (B5). Belegt sendbar
  sind sie nur über das Call-Control-`dial`-Kommando (`custom_headers`). Wer K1 als reines
  TeXML-`<Dial><Sip>` baut, hat also **keinen** Variablenkanal; wer ihn als dial+bridge
  baut, hat einen belegten. Diese Wahl trifft IE1, nicht der Implementierer.
- **Overrides gibt es über diesen Weg gar nicht:** Stimme, Sprache und `first_message`
  sind keine dynamic variables. Was per Anruf steuerbar bleibt, entscheidet sich an den
  `language_presets` des Agenten und an den Variablen — nicht an einem
  `conversation_config_override`. Das ist die einzige Fähigkeitslücke von K1 gegenüber K2.
- **Der Elternbein-Griff während der Brücke** (B5, nicht dokumentiert) und die
  **Abrechnung des zweiten Beins** (ungemessen) sind die beiden Punkte, an denen K1
  entweder S5 oder die Kostenrechnung verlieren könnte.

**Auslösebedingung für den Rückfall auf K2, vorab festgelegt, damit sie später nicht
verhandelt wird:** ergibt IE1, dass (a) der ad-hoc-INVITE den Agenten nicht erreicht,
**oder** (b) der Elternbein-Griff während der Brücke keinen Hangup mehr trägt **und**
`<Dial timeLimit>` die Grenze nicht durchsetzt, **oder** (c) Sprache und Stimme je Anruf
über K1 nicht setzbar sind und der Agent dadurch in einer falschen Sprache antwortet —
dann wird auf K2 umgestellt. K2 hat den **einzigen belegten Per-Anruf-Override-Kanal**
(`conversation_initiation_client_data` je Verbindung: `dynamic_variables` **und**
`conversation_config_override`), und Telnyx-Media-Streams liefern `ulaw_8000`, was die
EL-WebSocket-Schnittstelle beidseitig listet — keine Transkodierung. Der Preis ist
benannt und nicht kleingeredet: K2 erbt die Turn-Taking-Mechanik von `bridge.js`
strukturell 1:1, und der Prozess-Neustart lässt dort ein unbegrenztes Bein zurück
(`rearmActiveCallTimers` kehrt bei `VOICE_ENGINE=realtime` sofort zurück, der
bridge-eigene Timer stirbt mit dem Prozess). Deshalb ist K2 Rückfall und nicht Ziel.

### 2.5 Warum K4 nicht nur nicht gewählt, sondern entfernt wird

Der Telnyx-AI-Assistant-Handoff ist gebaut, abgeschaltet, und war in der **alten**
Leitentscheidung der Weg für Turn-Taking. Er ist für die Zielarchitektur disqualifiziert:
eigener Prompt, eigene Kostenquelle, und eine **statische Plattform-Stimme in jeder
Sprache** (Fussnote (b)-Stimme, RCA-Wurzel R5) — ein drittes Gehirn, das die Beschwerde
des Owners ("andere Stimme") gar nicht löst und die Inbound-Minute laut Messung
verdreifacht. Die Auftragsregel war: K4 kommt nur in Frage, wenn K1, K2 **und** K3 alle
widerlegt sind. K1 und K2 sind nicht widerlegt. Damit ist K4 nicht "aufgehoben für
später" — ein abgeschalteter Pfad mit eigenem Gehirn ist toter Code mit
Schutzbehauptung (G9). Er wird in IE6 **gelöscht**.

**Fussnote (b)-Stimme (belegt, und der Grund für die Löschung):** der
Telnyx-AI-Assistant-Pfad löst die Stimme **nicht** nach Sprache auf. Beide Stellen, die
seine Stimme setzen, benutzen die rohe Namensfunktion `elevenLabsVoiceName(el)` mit der
**einen** statischen Plattform-Stimme `config.telnyx.telnyxElevenLabs.voiceId`: der
Pflichtsatz-Speak-Node (`src/telephony/adapters/telnyx/voice.js#speakVoiceFields`) und die
Assistant-Ressource selbst (`scripts/telnyx-assistant-provision.mjs#buildAssistantConfig`,
`voice_settings.voice`). Der `voiceProfile`-Parameter von `speakVoiceFields` wird im
ElevenLabs-Zweig gar nicht gelesen. Das ist **Absicht und gepinnt**, nicht ein Versehen:
der Modulkommentar begründet es mit RCA-Wurzel R5 ("EINE Stimme im ganzen Call") — die
Assistant-Ressource hat ein global provisioniertes Voice-Setting ohne Per-Call-Auflösung,
ein sprachaufgelöster Speak-Node davor würde denselben Anruf in zwei Stimmen sprechen
lassen. `test/telnyx-call-control.test.js` hält genau das als R5-Regression fest. Ein
FR- oder EN-Anruf auf diesem Pfad kann die Outbound-Stimme dieser Sprache also **gar
nicht** sprechen, und für `de` hinge die Gleichheit an einem Zufall (M10). Damit ist der
Pfad am Owner-Massstab nicht reparierbar, sondern überzählig: er wird in IE6 Stufe 1
entfernt.

### 2.6 Was am Ende wirklich verschwindet

Eine Konsolidierung, die nichts entfernt, ist keine. IE6 löscht in dieser Reihenfolge,
jede Stufe hinter einer eigenen Freigabe:

1. **Der Telnyx-AI-Assistant-Inbound (drittes Gehirn):** `src/telnyx-inbound.js`,
   `src/telnyx-llm-shim.js`, `src/telnyx-conversation-watchdog.js`,
   `scripts/telnyx-assistant-provision.mjs`, `KOSTENPROFIL.TELNYX_ASSISTANT`, die
   Schalter `TELNYX_AI_ASSISTANT_ENABLED` / `TELNYX_INBOUND_HANDOFF_ENABLED` — und die
   statische Plattform-Stimme `config.telnyx.telnyxElevenLabs` **nur soweit**, wie ihre
   vier belegten Konsumenten mit ihr sterben (der vierte,
   `src/elevenlabs/outbound.js#callLocaleOf`, tut es **nicht** — s. IE6, Pre-Mortem Q7).
2. **Die OpenAI-Realtime-Bridge (vierter Zweig, nie benutzt):** `src/bridge.js` samt
   seinen `HEIKLE STELLE`-Abschnitten, `DIRECTIVE.STREAM` und `streamDirectives`,
   `MEDIA_PATH`, die Media-Event-Naht, `VOICE_ENGINE=realtime`,
   `KOSTENPROFIL.TELNYX_INBOUND_REALTIME`, `KOSTENART.OPENAI_REALTIME`,
   `REALTIME_MID_CALL_BUDGET_CHECK` und die Realtime-Sonderfälle in
   `rearmActiveCallTimers` und `consultAvailableFor`.
3. **Die Gesprächslogik der Budget-Engine für Inbound:** `POST /voice/turn`, der
   Folge-Gather, der Inbound-Zweig von `claude.js#agentTurn`, der Inbound-Prompt, die
   Inbound-Werkzeuge `take_message`/`end_call` unserer Seite, der STT-Modell-Seam für
   Inbound. Das ist die Stufe mit der grössten Tragweite und der einzigen echten
   Owner-Frage (O9), weil danach **kein** nicht-EL-Weg mehr existiert, der ein Gespräch
   führen kann.
4. **Ersatz statt Lücke:** an die Stelle der entfernten Rückfall-**Engine** tritt ein
   Rückfall **ohne Gehirn** — ein gerenderter Satz plus Auflegen, plus der bestehende
   Anruf-Datensatz fürs Postfach. Kein LLM, kein Turn, keine zweite Wahrheit über
   Gesprächsführung. Damit erreicht ein eingehender Anruf auch bei einem Anbieter-Ausfall
   jemanden, ohne dass ein zweites Gesprächs-System gepflegt werden muss.

### 2.7 Was diese Entscheidung ausdrücklich NICHT verspricht

- **Kein Fähigkeitsgewinn für Inbound.** `get_consult` und `look_up` bleiben gesperrt —
  nicht weil Inbound ein anderes Gehirn hätte, sondern weil das Richtungs-Gate **unsere
  Sicherung an unserem Werkzeug-Webhook** ist (B9). Derselbe Agent, dieselbe Sperre.
- **Keine Barge-in-Garantie aus dem Nichts.** Barge-in kommt mit dem EL-Agenten; dass er
  den **von uns gerenderten** ersten Satz nicht unterbrechen kann, bleibt richtig und
  gewollt (Art.-50-Riegel, Lehre `offenlegung-ist-unterbrechbar`).
- **Keine Kostensenkung.** Der EL-Weg kostet gemessen ~14–16 US-Cent/min gegen 1,87 auf
  der Budget-Engine, und die Lehre "Turns statt Sekunden" macht daraus einen Mittelwert,
  keinen Deckel. Diese Entscheidung kauft **eine Wahrheit**, nicht einen günstigeren
  Anruf — und sie macht die Gegenrechnung erst möglich, weil danach beide Richtungen auf
  dieselbe Ist-Quelle buchen.
- **Keine Verfügbarkeits-Verbesserung.** Im Gegenteil: nach der Konsolidierung kappt ein
  leeres EL-Konto **beide** Richtungen. Das ist der bewusst akzeptierte Preis (Q8, O11).

---

## 3. Pre-Mortem

Ein Jahr weiter. Die Konsolidierung ist gescheitert — es gibt wieder zwei Systeme, oder
eines, das Schaden angerichtet hat. Was ist passiert?

**Q1 — Ein eingehender Anruf erreicht niemanden mehr.**
*Weg dorthin:* IE6 Stufe 3 entfernt die Budget-Engine, und danach fällt der EL-Weg aus:
Konto leer (402 — das ist schon einmal passiert, Lehre `live-auf-deepseek`), Agent
umkonfiguriert, SIP-Trunk-Zugangsdaten rotiert, Anbieter-Störung. Der Anrufer hört
Klingeln, Stille oder eine Fehleransage; niemand merkt es, weil Inbound-Anrufe niemand
zählt.
*Entschärfung:* (i) IE6 Stufe 3 ist die **letzte** Stufe und hat als Vorbedingung eine
benannte Beobachtungsfrist auf dem neuen Pfad mit Owner-Freigabe — nicht "Tests grün".
(ii) An die Stelle der Engine tritt der Rückfall **ohne Gehirn** (§2.6 Punkt 4): jeder
Fehler beim Übergeben — Dial scheitert, Trunk antwortet nicht, Agent unbekannt — endet in
einem gerenderten Satz und einem Anruf-Datensatz, **nie** in Stille und nie in einer
Fehleransage. Das ist dieselbe Fail-safe-Regel, die der Assistant-Handoff schon trug.
(iii) Der Rückfallgrund wird als benanntes Token an der **einen** bestehenden Sonde
geführt (`logInboundPathDecision`), damit "erreicht niemanden" im Log eine Zeile hat.
*Akzeptiertes Risiko:* der Rückfall führt kein Gespräch. Ein Anrufer, der bei einem
EL-Ausfall etwas Komplexes loswerden will, kann es nur hinterlassen, nicht besprechen.

**Q2 — Ein Anruf, den unser Prozess nicht beenden kann.**
*Weg dorthin:* der gefährlichste Einzelfall, und er ist **belegt vorgezeichnet**: bei
EL-Outbound liefert `hangUpAction` heute `null`, wenn kein Telnyx-Griff existiert, und
`endConversation` sagt selbst, dass seine Kappwirkung nicht belegt ist (B7). Wer Inbound
so baut, dass das Bein nicht mehr unser ist, erbt genau das — mit einem Anrufer am
anderen Ende und einer Uhr, die weiterläuft.
*Entschärfung:* K1 ist **genau deshalb** gewählt: das Inbound-Bein bleibt unser
Telnyx-Bein, `hangUpAction` greift über `callControlId`/`providerCallSid`, und ein Hangup
des Elternbeins reisst die SIP-Brücke mit. Zweite Linie ist `<Dial timeLimit>`
(belegt 60–14400 s, B5), gesetzt auf die guthaben-abgeleitete Frist
(`brakeSecondsFor` → `emergencyBrakeSeconds`) — eine **provider-erzwungene** Grenze, die
auch einen Neustart unseres Prozesses überlebt. Dritte Linie: `rearmActiveCallTimers`
findet den Call nach einem Deploy über den persistierten Griff wieder.
*Abbruchbedingung, nicht Risiko:* zeigt IE1, dass der Elternbein-Griff während der Brücke
**nicht** trägt **und** `timeLimit` nicht greift, ist K1 an dieser Stelle widerlegt und
die Kette wechselt auf K2 (§2.4). Ohne mindestens **einen** belegten Kappweg wird nicht
scharfgestellt.

**Q3 — Ein Gespräch läuft auf Kosten eines Tenants ohne Guthaben.**
*Weg dorthin:* die Kostendecke wirkt heute mid-call **nur**, weil `agentTurn` vor jeder
Runde `blockingBudgetAxis` fragt (B8). Fällt der Turn-Loop, wird die Achse nur noch
gefragt, wenn der Agent zufällig ein Werkzeug ruft. Ein "Nachricht hinterlassen"-Gespräch
ruft keines. Genau die Begründung, mit der CLAUDE.md die Lockerung E11 **zurückgenommen**
hat ("die KI-Token werden in jeder Schleifenrunde live gebucht"), trägt auf dem neuen
Pfad strukturell nicht mehr — und der dominante Kostentreiber (`elevenlabs_convai`) wird
erst **nach** dem Anruf erfasst.
*Entschärfung:* IE2 ist deshalb eine **eigene Phase vor** dem Pfad und kein Anhang: ein
wiederkehrender Wächter fragt die **eine** Achse und beendet über den **einen**
Terminierungspfad (`terminateActiveCall`, Geld-Token). Er ist richtungs- und pfadneutral
gebaut und schliesst damit dieselbe Lücke, die **heute schon** bei EL-Outbound und im
Realtime-Zweig offen ist (`REALTIME_MID_CALL_BUDGET_CHECK = false`, Boot-Guard-Warnung
`REALTIME_NO_MIDCALL_BUDGET`). Zweite Linie: die guthaben-abgeleitete Frist als
`timeLimit` beim Übergeben — das Guthaben wird **vor dem ersten Wort** in eine Zeitgrenze
übersetzt.
*Akzeptiertes Risiko:* zwischen zwei Wächter-Runden kann die Decke um das Intervall
überzogen werden. Das Intervall gehört mit `min`/`max` nach `src/config.js`, nicht als
nackte Zahl in den Handler, und der Betrag steht als bewusst akzeptierte Grösse im
Phasenbericht.

**Q4 — Der Pflichtsatz fällt weg, kommt vom Anbieter, oder kommt zweimal.**
*Weg dorthin:* drei Wege. (i) Jemand wählt später doch K3, und Artikel 50 wird eine
Dashboard-Zeile — die Lehren `el-eroeffnung-first-message` und
`el-agent-ist-im-kern-englisch` belegen, dass der Prompt sie dort nicht ergänzen kann und
das de-Preset **nur** die `first_message` deckt. (ii) Wir rendern den Satz, und der Agent
spricht danach **seine** `first_message` — der Anrufer hört zwei Begrüssungen, und der
`startsWith`-Riegel greift nur auf unseren Teil. (iii) Der Satz wird beim Übergeben
"eingespart", weil er ja im Agenten stehe.
*Entschärfung:* (i) K3 ist ausgeschieden, mit Begründung im Dokument, nicht im Kopf eines
Beteiligten. (ii) IE5 trägt den Doppelansage-Riegel als **Ziel**, nicht als Detail: der
Agent darf auf dem Inbound-Weg keine eigene Eröffnung sprechen, und das wird am Anbieter
**gemessen**, nicht angenommen (ein nicht freigeschaltetes Override-Feld wird laut
Bestandslehre **still** ignoriert). (iii) Der Satz bleibt in `withInboundNotice`
gerendert und reist nie als Prompt-Anweisung — Absolute Regel 2, GAP-14. Der Bestandstest
`test/inbound-disclosure-mandatory.test.js` bleibt grün, und IE5 fügt den Negativfall
hinzu: Übergabe ohne gerenderten Pflichtsatz ist ein Fehler, kein Sonderfall.

**Q5 — Der heute funktionierende Outbound-Pfad geht beim Umbau kaputt.**
*Weg dorthin:* der wahrscheinlichste Schaden der ganzen Kette, weil alles Geteilte
Outbound trägt. Vier konkrete Wege: die Stimm-Karte `ELEVENLABS_VOICE_ID_BY_PROFILE` wird
"für Inbound" angefasst und ändert jeden Outbound-Anruf; `config.telnyx.telnyxElevenLabs`
wird mit dem Assistant gelöscht und nimmt `outbound.js#callLocaleOf` den
`defaultVoiceId`; die Nummern-Registrierung bekommt `inbound_trunk_config` und
überschreibt dabei die gemessene `outbound_trunk`-Projektion; ein Push in die
Agenten-Konfiguration für Inbound-Sprachwahl verstellt Outbound.
*Entschärfung:* jede dieser vier Stellen steht in **NICHT-Scope** einer Phase, namentlich
und mit Konsumentenliste je Funktion (nicht je Modul). IE5 trägt als Invariante
"Outbound-Anfragekörper byte-identisch" und pinnt `startCallBody` /
`conversationConfigOverride` gegen einen Snapshot; `npm run elevenlabs:drift` läuft vor
**und** nach jeder Phase, die den Agenten oder die Nummern-Registrierung berührt; IE6
entfernt `config.telnyx.telnyxElevenLabs` nur, wenn **alle** Konsumenten mit ihm sterben,
und `callLocaleOf` tut das nicht.
*Akzeptiertes Risiko:* die Nummern-Registrierung muss für K1 vermutlich
`inbound_trunk_config` **zusätzlich** tragen, und ob dieselbe Nummer beides tragen kann,
ist unbelegt (M16). Deshalb wird das an einer **Testnummer** gemessen, nie an der
produktiven DID.

**Q6 — Die Übergabe funktioniert, aber der Anruf ist in der Buchhaltung unsichtbar.**
*Weg dorthin:* der neue Pfad bekommt kein eigenes Kostenprofil und läuft unter
`TELNYX_INBOUND_BUDGET` weiter — dann ist der teuerste Inbound-Anruf von einem
Budget-Anruf nicht zu unterscheiden. Oder er bekommt `EL_CONVAI_SIP` "weil da steht
schon EL": dessen gemessene Pflichtmenge ist `[sip-trunking]`, unser Inbound-Bein liefert
aber `call-control` (B12) — `istVollBelegt` kippt, und die Erstattung rechnet falsch.
*Entschärfung:* IE3 ist eine eigene Phase **vor** dem Scharfstellen, mit **gemessener**
Pflichtmenge je Träger. `PFLICHTTYPEN_UNGEMESSEN` (leer) ist die fail-closed Antwort, nie
der Env-Wert als Trostpreis. Der Reihenfolge-Riegel aus `legacyKostenprofil` wird als
Test gepinnt: ein EL-Leg mit `sipCallId` bleibt `EL_CONVAI_SIP`. Das Vorbild ist der
Boot-Riegel, der genau dafür existiert (`latentCostPathFindings`, FATAL-Muster
`REALTIME_CARRIER_UNCOLLECTED`): ohne Katalogzeile startet der Schalter nicht.
*Akzeptiertes Risiko:* erzeugt K1 ein zweites, ausgehendes Telnyx-Bein zu
`sip.rtc.elevenlabs.io`, bezahlen wir Minuten, die der Notaus `OUTBOUND_FROZEN` **nicht**
deckt — er sitzt in der Outbound-Gate-Kette, der Dial entsteht im Inbound-Webhook. Das ist
sachlich richtig (ein Inbound-Notaus darf nicht am Outbound-Schalter hängen) und wird
hiermit ausdrücklich so entschieden, nicht übersehen.

**Q7 — Die Entfernung entfernt zu viel oder zu wenig.**
*Weg dorthin:* zu viel — mit `src/bridge.js` stirbt `MEDIA_PATH`, und irgendein Leser
ausserhalb des Realtime-Zweigs hing daran; mit `config.telnyx.telnyxElevenLabs` stirbt
Outbounds `defaultVoiceId` (Q5). Zu wenig — der Assistant wird "nur abgeschaltet", und
ein Jahr später steht ein Gehirn im Repo, das niemand pflegt, aber jeder Leser für eine
lebende Naht hält; oder `elevenLabsVoiceNameFor` bleibt als Export ohne Konsumenten mit
der Schutzbehauptung "ist ja geteilt" (G9, hart verboten).
*Entschärfung:* IE6 zählt Konsumenten **je Funktion**, nie je Modul — auf Modulebene
sieht jede dieser Funktionen benutzt aus. Jede Stufe hat als Abnahme einen `grep`, der
**Dateien** nennt (keine Zeilenzahlen), und die Stufen laufen getrennt, nicht in einem
Commit. Und: entfernt wird **ersatzlos**, nicht per Flag abgeschaltet — ein
abgeschalteter Pfad mit eigenem Gehirn ist toter Code mit falscher Schutzbehauptung.
*Akzeptiertes Risiko:* kommt je wieder ein Grund für einen zweiten Voice-Anbieter im
Audiopfad, muss die Bridge neu gebaut werden. Die Historie liegt in `git`, und die
`HEIKLE STELLE`-Kommentare sind dort nachlesbar. Das ist derselbe bewusst akzeptierte
Preis, mit dem 2026-08-07 der Twilio-Verifizierer entfernt wurde.

**Q8 — Der Anbieter ändert seine Schnittstelle, und wir haben keinen zweiten Weg mehr.**
*Weg dorthin:* EL ändert die Agenten-Zuordnung am Inbound-Trunk, dreht ein
Override-Feld zu, macht einen Kanal enterprise-only (das ist bei der Monitoring-WS
**bereits** so, B6), oder das Konto ist leer. Nach IE6 Stufe 3 gibt es keinen zweiten
Weg, der ein Gespräch führen kann — **beide** Richtungen stehen.
*Entschärfung, soweit sie ohne zweites System geht:* (i) Der Rückfall ohne Gehirn (§2.6
Punkt 4) hält "ein Anrufer erreicht jemanden" aufrecht, ohne eine zweite
Gesprächswahrheit zu pflegen. (ii) Der Drift-Wächter
(`npm run elevenlabs:drift`) ist bereits die Stelle, an der eine Anbieter-Änderung
auffällt, und er ist fail-closed; IE5 nimmt die neuen inbound-relevanten Felder in seinen
Besitz-Block, damit eine Änderung dort nicht still bleibt. (iii) Die
Provider-Abstraktion (`src/telephony/ports.js`) bleibt unangetastet — der **Carrier** ist
weiter austauschbar, auch wenn das Gehirn es nicht ist.
*Ausdrücklich akzeptiertes Risiko, Owner-Entscheidung O11:* die Anbieter-Abhängigkeit ist
nach dieser Konsolidierung total und einseitig. Das ist der Preis für **eine** Wahrheit,
und er wird hier bezahlt, nicht wegdiskutiert. Wer ihn nicht zahlen will, behält zwei
Systeme — und damit genau das Ergebnis, das der Owner ausgeschlossen hat. Es gibt keine
dritte Möglichkeit, die beides hat; jeder Plan, der beides verspricht, lügt an dieser
Stelle.

---

## 4. Die Phasenkette

Reihenfolge nach der Owner-Vorgabe: (1) die schnellen Fixes, die **heute** hörbar
entlasten und den Umstieg überleben; (2) die Sicherungs-Phasen, die der neue Pfad
braucht, **vor** dem Pfad; (3) der Pfad selbst hinter einem Schalter, aus =
byte-identisch zum Bestand; (4) zuletzt das Entfernen. Jede Phase ist für sich
deploybar. Neun Phasen, davon drei unverändert aus der alten Kette.

| Phase | Titel | Hebel | Aufwand | hochrisiko | Owner | überlebt die Weiche |
|---|---|---|---|---|---|---|
| ~~IP1~~ | Gesprochene Umlaute im DE-Begrüssungskatalog | — | — | — | — | **erledigt**, s. 4.1 |
| IP2 | Hörprobe: welchen Sprechpfad Inbound nimmt | mittel | klein | nein | nein | ja |
| IP3 | Zwei Selbst-Armierungen entfernen | hoch | klein | nein | nein | ja |
| IP4 | Inbound spricht dieselbe Stimme wie Outbound | hoch | klein | **ja** | **ja** | ja (Vorbedingung) |
| IE1 | Den Anbieter-Vertrag von K1 messen | hoch | mittel | nein | **ja** | ja |
| IE2 | Die Geld-Achse bekommt einen Herzschlag | hoch | mittel | **ja** | nein | ja |
| IE3 | Kostenprofil und gemessene Pflichtmenge für den neuen Weg | hoch | mittel | nein | nein | ja |
| IE4 | Der Wiederholungs-Riegel bekommt eine pfadgerechte Antwort | mittel | klein | nein | nein | ja |
| IE5 | Inbound am EL-Agenten, hinter einem Schalter | hoch | gross | **ja** | **ja** | ja |
| IE6 | Die überzähligen Gehirne entfernen | hoch | gross | **ja** | **ja** | ja (Abschluss) |

### 4.1 Einordnung der alten Kette

| Alte Phase | Status | Begründung |
|---|---|---|
| **IP1** Orthografie | **erledigt** (`ab497ed`, gemergt in `de870ad`) — und das Ergebnis wird auf dem neuen Weg **weiter gebraucht** | Auf dem neuen Weg rendert **unser** Webhook weiterhin `withInboundNotice(greetingForLanguage(...))` als ersten gesprochenen Satz, bevor er übergibt (Code: `src/routes/voice.js`). Der korrigierte Wortlaut ist also genau der Satz, der nach dem Umstieg **noch** von uns kommt — er überlebt die Weiche nicht zufällig, sondern als einziger gesprochener Satz unserer Seite. Zusätzlich bleibt die At-Rest-Normalisierung (`GREETING_ORTHOGRAPHY_MIGRATION`) nötig, weil die Begrüssung ein Mandanten-Setting bleibt. Offen aus IP1: der Nachzieh-Lauf mit `--apply` gegen die Produktions-DB (M5). |
| **IP2** Hörprobe | **überlebt unverändert** | Sie ist die Vorher-Messung für IP4 **und** die Nachher-Messung für IE5 (welchen Sprechpfad rendert `/voice/incoming`). Ihr NICHT-Scope verbietet ohnehin jeden `src/`-Eingriff. IE5 erweitert ihre Klassifikation additiv um den Übergabe-Pfad — **in** IE5, nicht hier. |
| **IP3** Selbst-Armierungen | **überlebt unverändert** | Der A/B-belegt defekte Relay-Zweig armiert sich heute automatisch und unterdrückt den Inbound-Audio-Track. Auf dem neuen Weg wäre das **schlimmer** als heute: er würde den einen gerenderten Satz kaputtsprechen und den Anrufer mit tauber Leitung an den Agenten übergeben. Der `render.yaml`-Abgleich bleibt sinnvoll, weil IE6 erst am Ende steht und ein Blueprint-Anwenden bis dahin den defekten Handoff scharfstellen könnte. |
| **IP4** gleiche Stimme | **überlebt, mit veränderter Rolle: aus Komfort wird Vorbedingung** | Auf dem neuen Weg spricht unser Satz und danach der Agent. Rendern wir mit Azure, hört der Anrufer **zwei Stimmen in einem Anruf** — genau der Defekt, den RCA-Wurzel R5 benennt. Play-TTS ist damit keine Verschönerung mehr, sondern die Bedingung für Stimm-Kohärenz an der Übergabe. Scope, Invarianten und Abnahme bleiben unverändert. |
| **IP5** Modell-Gleichstand | **entfällt als Phase** | Nach dem Umstieg synthetisieren wir **einen** Satz; alles andere spricht der Agent mit seinem eigenen `tts.model_id`. Die Modellfrage schrumpft damit auf "klingt unser eine Satz wie der Agent" — das ist ein Messpunkt in IE5 und die Owner-Frage O2, keine eigene Phase mit Push-Risiko in die Outbound-Konfiguration. Der Live-Wert bleibt offene Messung M4. |
| **IP6** Inbound-Szenarien im Bench | **entfällt** | Beide Bench-Treiber (`TEXML_DRIVER_ID`, `SHIM_DRIVER_ID`) fahren **unsere** Turn-Schleife. Nach dem Umstieg gibt es keine, die sie fahren könnten — ein provider-geführtes Gespräch ist von einem lokalen Treiber nicht steuerbar. Vier bis sechs neue Szenarien würden also eine Engine messen, die IE6 löscht: Wegwerf-Arbeit. Die Vorher/Nachher-Zahl für die Weiche liefern stattdessen IE1 und IE5 an echten Anrufen plus die bestehenden Transkripte. |
| **IP7** Assistant wartet auf `answered` | **entfällt vollständig** | Sie hätte das **dritte** Gehirn scharfgestellt. Mit der Leitentscheidung ist es nicht mehr Zielarchitektur, sondern Löschkandidat (IE6 Stufe 1). Damit entfallen auch ihre Voraussetzungen: der 422-Befund, das answered-Ereignis (M7) und die Nachprüfung des 422 (M9) sind für die Zielarchitektur gegenstandslos. |

---

## Phase IP2 - Hörprobe: welchen Sprechpfad Inbound wirklich nimmt

**Abhängigkeiten:** keine. Muss **vor** IP4 und IE5 liegen (Vorher-Messung).

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
- Keine neuen Inbound-Szenarien (in dieser Kette nicht mehr vorgesehen, s. 4.1).
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
   Kommentar nennt den 422-Befund; der Schalter selbst verschwindet in IE6 Stufe 1 mit dem
   Assistant-Pfad.

### NICHT-Scope

- **`config.telnyx.telnyxElevenLabs` bleibt.** Es hat vier Konsumenten ausserhalb des
  Renderers, und **alle vier** sind Outbound oder Assistant-Pfad:
  `src/elevenlabs/outbound.js#callLocaleOf` (`defaultVoiceId`),
  `src/telephony/adapters/telnyx/voice.js#speakVoiceFields`,
  `src/telephony/adapters/telnyx/voice.js#assistantVoiceConfigured`,
  `scripts/telnyx-assistant-provision.mjs`. Wer den Block löscht, nimmt Outbound die
  Plattform-Stimme (Pre-Mortem Q7). `src/telephony/registry.js` war der fünfte Leser und
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
IP1 (erledigt) liegt vor, damit der erste gesprochene Satz gleich richtig synthetisiert
wird.

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
  ändert, ändert im selben Zug jeden Outbound-Anruf (Pre-Mortem Q5).
- Kein Eingriff in `elevenlabs/agent_configs/*`, kein Push zum Anbieter.
- **Kein** TTS-Modell-Wechsel (das ist Owner-Entscheidung O2) — diese Phase ändert
  `ELEVENLABS_MODEL` nicht.
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

## Phase IE1 - Den Anbieter-Vertrag von K1 messen (kein Produktionscode)

**Abhängigkeiten:** keine. Kann parallel zu IP2–IP4 laufen; ihr Ergebnis ist erst **vor**
IE5 nötig. Sie ist das Tor, das über K1 gegen K2 entscheidet.

### Ziel (deterministisch prüfbar)

Sechs benannte Fragen sind mit **belegt** oder **widerlegt** beantwortet, jede mit ihrer
Quelle (echte API-Antwort, SIP-Trace, Telnyx-Portal-Debugger oder Anbieter-Doku-URL).
Das Ergebnis steht als Messbericht im Phasenbericht und entscheidet nach der in
Abschnitt 2.4 **vorab festgelegten** Auslösebedingung zwischen K1 und K2. Kein
`src/`-Eingriff, kein Commit in Produktionscode.

| Frage | Was "belegt" bedeutet |
|---|---|
| F-A **Agenten-Zuordnung** | Ein INVITE an `sip:+<Test-DID>@sip.rtc.elevenlabs.io:5060` erreicht **den** Agenten, der an dieser Nummer hängt — nachgewiesen an einem Gespräch, das der erwartete Agent führt (B4 ist heute unbelegt). |
| F-B **Variablenkanal** | Ein selbst gesetzter `X-`Header kommt als dynamic variable beim Agenten an, nach der belegten Normalisierungsregel (B3) — und zwar auf dem Weg, den wir tatsächlich bauen würden: TeXML-`<Dial><Sip>` (Header **nicht** dokumentiert, B5) **oder** Call-Control-`dial` mit `custom_headers` (dokumentiert). Das Ergebnis bestimmt die Bauform von IE5. |
| F-C **Elternbein-Griff** | Nach dem Bridge ist ein Hangup über `callControlId`/`providerCallSid` weiter wirksam **und/oder** `<Dial timeLimit>` (60–14400 s, B5) beendet die Brücke zuverlässig. Mindestens **einer** der beiden muss belegt sein, sonst ist S5 verloren. |
| F-D **Zweites Bein und seine Abrechnung** | Ob der Dial ein zweites, separat abgerechnetes Telnyx-Bein erzeugt, und unter welchem `record_type` es in `detail_records` erscheint. Liefert die Trägerliste für IE3. |
| F-E **Nummer doppelt belegbar** | Ob dieselbe Nummer `inbound_trunk_config` **und** `outbound_trunk_config` tragen kann, ohne die gemessene `outbound_trunk`-Projektion zu verlieren (M16) — gemessen an einer **Testnummer**, nie an der produktiven DID. |
| F-F **Fehlerfall der Übergabe** | Was technisch passiert, wenn der Dial scheitert: Trunk antwortet nicht, Agent unbekannt, INVITE abgelehnt. Telnyx dokumentiert für `<Dial>` ein `action`-Attribut (URL, die beim Ende des Dial neue TeXML-Anweisungen abholt, developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial) — **belegt** heißt: gemessen, dass diese URL im Fehlerfall wirklich gerufen wird, mit welchem Status, und dass die daraufhin gerenderte Antwort den Anrufer noch erreicht. Ohne diese Messung ist die Fail-safe-Zusicherung von IE5 Scope 6 eine unbelegte Anbieter-Fähigkeit. |

### Scope

1. Eine **Testnummer** und eine **Test-Trunk-Verbindung** anlegen; die produktive DID wird
   nicht angefasst. Digest-Zugangsdaten oder ACL nach dem belegten Anbieter-Vertrag (B2).
2. Die sechs Messungen fahren, je Messung: Vorgehen, Rohbefund-Kennung (Anruf-ID,
   `conversation_id`, `record_type`), Ergebnis, Quelle. **Keine** Rufnummer im Klartext,
   **kein** Gesprächstext, **kein** Schlüsselwert im Bericht (Absolute Regel 4/5).
3. Den Bericht als **Messung** festhalten, nicht als Entscheidung: die Entscheidung K1/K2
   trifft die vorab festgelegte Auslösebedingung aus Abschnitt 2.4.
4. Für F-C zusätzlich den Negativfall messen: Hangup-Versuch **während** der Brücke, und
   `timeLimit` mit einem kleinen Wert (Untergrenze 60 s) gegen einen absichtlich langen
   Anruf.
5. Für F-F den Fehlerfall **absichtlich herbeiführen** (Dial auf eine SIP-Adresse, die
   niemand annimmt, und auf eine Nummer ohne Agenten), mit gesetztem `action`-Attribut auf
   eine eigene Testroute. Gemessen wird: wird die Route gerufen, mit welchen Feldern, und
   hört der Anrufer die daraufhin gerenderte Antwort noch. Das ist die Messung, ohne die
   IE5 nicht gebaut werden darf.

### NICHT-Scope

- **Kein** Produktionscode, keine neue Direktive, kein Renderer-Zweig. Diese Phase baut
  nichts — sie misst.
- **Keine** Änderung an `src/elevenlabs/nummern-registrierung.js` und **kein**
  `inbound_trunk_config` an der produktiven DID (Pre-Mortem Q5).
- Kein Eingriff in den Live-Agenten, keinen Prompt, keine `language_presets`, kein
  `elevenlabs:push`.
- Keine Entscheidung über K3 (ausgeschieden, Abschnitt 2.3) und keine Wiederaufnahme von K4.

### Betroffene Dateien / Nahtstellen

Keine unter `src/`. Nur **gelesen**: `src/elevenlabs/nummern-registrierung.js`
(`registrierungsKoerper` — die gemessene Trunk-Vorlage), `src/telephony/directives.js`,
`src/telephony/adapters/telnyx/render.js`. Anbieter-Seite: EL-Phone-Number-Ressource
(Testnummer), Telnyx-Connection (Test), Telnyx-Portal-Debugger.

### Invarianten

- Der Live-Agent, die produktive DID und die bestehende Nummern-Registrierung bleiben
  **unverändert**; `npm run elevenlabs:drift` läuft vor und nach der Phase mit
  unverändertem Ergebnis.
- Outbound bleibt vollständig unberührt.
- Keine Secrets, keine Rufnummern, kein Gesprächstext im Bericht.

### Abnahmekriterium

```
npm run elevenlabs:drift          # vor und nach der Phase, unverändertes Ergebnis
```
Erwartet: ein Messbericht mit **sechs** Zeilen F-A…F-F, jede mit `belegt`/`widerlegt` und
Quelle; dazu die daraus folgende Kandidaten-Entscheidung nach Abschnitt 2.4 — als
Anwendung der vorab festgelegten Bedingung, nicht als neue Abwägung. `elevenlabs:drift`
zeigt vorher und nachher denselben Stand.

### Testpflicht

Kein neuer Test (kein Produktverhalten geändert). **Pflicht ist die Protokollform:** jede
Messung nennt ihre Rohbefund-Kennung, damit sie nachprüfbar ist — die Lehre
`pruefkommando-ohne-positiv-kontrolle` gilt: eine Messung ohne Positiv-Kontrolle sieht aus
wie eine, die nichts sucht. Für F-A ist die Positiv-Kontrolle der **bekannte** Agent, für
F-D ein Anruf, der garantiert ein zweites Bein hätte.

### Risiko + Rückfall

Risiko klein für den Bestand, real für die Kasse: echte Testanrufe kosten Geld, und ein
falsch konfigurierter Test-Trunk kann Anrufe ins Leere schicken. Deshalb Testnummer,
nicht produktive DID. Rückfall: Testnummer und Test-Connection löschen; es bleibt nichts
zurück.

### Owner / Testanruf

**Beides.** Owner: Testnummer und Trunk-Zugangsdaten anlegen (heute lokal leer, B13) und
die Tarif-Frage beim Anbieter klären, soweit sie den Monitoring-Kanal betrifft (M18).
Echte Testanrufe sind die **einzige** Quelle für F-A bis F-D — die Doku beantwortet sie
nicht.

---

## Phase IE2 - Die Geld-Achse bekommt einen Herzschlag

**Abhängigkeiten:** keine. Muss **vor** IE5 fertig sein. Nützlich unabhängig vom Umstieg:
sie schliesst eine Lücke, die **heute** offen ist.

### Ziel (deterministisch prüfbar)

Ein laufender Anruf wird beendet, wenn die pro-Tenant-Kostendecke sperrt, **ohne** dass
ein Turn, ein Werkzeugaufruf oder ein `/voice/*`-Request stattfindet. Ein Test beweist
genau das: Achse sperrt, kein weiterer Request, Anruf wird über den **einen**
Terminierungspfad beendet, Grund als benanntes Token persistiert.

### Scope

1. **Die Wurzel, nicht das Symptom.** `blockingBudgetAxis` wird heute aus vier Stellen
   gefragt, alle ereignisgebunden, keine davon wiederkehrend (B8). Ein Anruf, der weder
   einen Turn noch ein Werkzeug erzeugt, erreicht die Achse nie. Neu ist **ein**
   wiederkehrender Wächter je aktivem Anruf, der dieselbe Achse fragt.
2. **Ein Terminierungspfad, nicht ein zweiter.** Beendet wird über
   `src/telephony/call-lifecycle.js#terminateActiveCall` mit dem bestehenden
   Geld-Grund-Token (dem Gegenstück zu `CAP_FAILURE_REASON`), nicht über einen neuen
   Hangup-Weg. Vorbild für Form und Lebenszyklus ist `src/telnyx-conversation-watchdog.js`
   — Vorbild, nicht Wiederverwendung: dieser Wächter stirbt in IE6 mit dem Assistant.
3. **Pfad- und richtungsneutral.** Der Wächter hängt am Anruf-Datensatz, nicht an einer
   Engine. Damit deckt er den heutigen Budget-Inbound, EL-Outbound (heute ungedeckt,
   solange kein Werkzeug feuert) und den neuen Inbound-Weg mit **einer** Wahrheit ab.
4. **Neustart-fest.** Der Wächter wird beim Boot für jeden aktiven Anruf re-armiert, an
   derselben Stelle und nach demselben Muster wie `rearmActiveCallTimers` — ohne dessen
   Realtime-Sonderfall zu erben.
5. **Das Intervall ist ein Konfigurationswert**, nicht eine nackte Zahl: `src/config.js`
   mit `min`/`max` (Muster `numEnv`), Eintrag in `.env.example` **und** `render.yaml`.
   Der Betrag ist die bewusst akzeptierte Überziehung zwischen zwei Runden (Pre-Mortem Q3)
   und wird im Phasenbericht genannt.
6. **Doppelfeuer ausschliessen:** Wächter und Max-Dauer-Timer dürfen denselben Anruf nicht
   zweimal terminalisieren; der Terminierungspfad ist idempotent zu halten, und der
   Negativfall ist ein Test.

### NICHT-Scope

- **Keine** neue Achse, kein zweiter Geld-Begriff, kein eigener Zähler.
  `blockingBudgetAxis` und `liveVoiceSpendCents` bleiben die **eine** Quelle.
- **Keine** Änderung an Tarifen, Decken, Totband oder an `MAX_BUDGET_EUR` (Owner-
  Entscheidung E10: Beobachtung, kein Gate).
- Keine Lockerung für Inbound (Owner-Entscheidung E11 ist **zurückgezogen**; die Decke
  sperrt beide Richtungen).
- Kein Eingriff in `src/bridge.js` und **keine** Umstellung von
  `REALTIME_MID_CALL_BUDGET_CHECK` — der Realtime-Zweig wird in IE6 entfernt, nicht hier
  reanimiert.
- Kein neuer Endpunkt (damit auch keine neue Zeile in `src/route-policy.js`).

### Betroffene Dateien / Nahtstellen

`src/telephony/call-lifecycle.js` (Wächter-Armierung und Boot-Re-Arm, neben
`armMaxDurationTimer`) · ein neues Modul für den Wächter selbst (eine Aufgabe, G30) ·
`src/config.js` + `.env.example` + `render.yaml` (Intervall) · `src/boot.js` bzw. die
bestehende Boot-Naht (Re-Arm-Aufruf, Position wie heute: nach den Exit-Gates, vor
`listen`).
Nur **gelesen**: `src/budget-gate.js`, `src/billing/metering.js`,
`src/telnyx-conversation-watchdog.js` (als Vorbild).

### Invarianten (byte-identisch)

- **Solange die Achse nicht sperrt, ändert sich nichts** — kein zusätzlicher Request, kein
  zusätzlicher Provider-Aufruf, kein geändertes TeXML.
- Der Terminierungspfad bleibt **einer**: `terminateActiveCall`; kein zweiter Hangup-Weg,
  keine zweite Logquelle für denselben Sachverhalt.
- Der bestehende Geld-Grund-Token behält seinen Wert (er reist über `get_call_status` zu
  MCP-Clients).
- Die Prüfreihenfolge in `/voice/incoming` bleibt unverändert; diese Phase fügt dort
  **kein** Gate hinzu, sie ergänzt die Zeit **nach** dem Start.
- `npm test` grün, Testzahl nicht gesunken, Zahl der Einträge in
  `test/abnahme-ausgewandert.json` nicht gesunken (Regel D13).

### Abnahmekriterium

```
node --check src/telephony/call-lifecycle.js
npm test -- --test-concurrency=4
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # + curl /healthz, /voice/incoming
```
Erwartet: `npm test` grün inkl. der neuen Tests; im Smoke-Test erscheint bei gesperrter
Achse genau **eine** Warnzeile mit der server-generierten `callId` (kein PII) und der
Anruf ist danach terminal; bei freier Achse ist die Ausgabe unverändert zum Bestand.

### Testpflicht

- **Neu:** Achse sperrt, **kein** Turn und **kein** Werkzeugaufruf → Anruf wird beendet,
  Grund-Token gesetzt. Das ist der Test, den es heute nicht gibt.
- **Neu:** Achse frei → der Wächter beendet **nichts** (Negativfall, T5/G3).
- **Neu:** Wächter und Max-Dauer-Timer feuern nacheinander → genau **eine**
  Terminalisierung (Idempotenz).
- **Neu:** Neustart mit einem aktiven Anruf → der Wächter ist danach armiert.
- **Bestand:** die Budget-Gate-Tests und die Metering-Tests bleiben unverändert grün.

### Risiko + Rückfall

**Hochrisiko:** dieser Code **beendet Anrufe**. Ein Fehler darin kappt gesunde Gespräche —
der teuerste denkbare Fehlalarm. Gegenmittel: er fragt ausschliesslich die bestehende
Achse (keine eigene Rechnung), er benutzt den bestehenden Terminierungspfad, und der
Negativfall "Achse frei → nichts passiert" ist Pflicht-Test. Rückfall: das Intervall im
Dashboard auf den Aus-Wert (dokumentiert in `.env.example`) — sofort, ohne Deploy; danach
`git revert`.

### Owner / Testanruf

Keine Owner-Entscheidung (die Decke ist bereits beschlossen; hier wird sie nur wirksam
gemacht). Ein echter Testanruf ist erwünscht, aber nicht abnahmenotwendig — der Sperrfall
ist lokal reproduzierbar.

---

## Phase IE3 - Kostenprofil und gemessene Pflichtmenge für den neuen Inbound-Weg

**Abhängigkeiten:** IE1 (F-D liefert die Trägerliste — ohne sie ist die Pflichtmenge
geraten). Muss **vor** IE5 scharf sein.

### Ziel (deterministisch prüfbar)

Ein Anruf auf dem neuen Inbound-Weg trägt ein **eigenes** Kostenprofil, dessen
Pflicht-Belegtypen **gemessen** sind (nicht aus der Umgebung geraten), und ein EL-Leg mit
`sipCallId` bleibt weiterhin `EL_CONVAI_SIP`. Der Boot-Riegel für latente Kostenpfade
meldet für den neuen Schalter **keinen** FATAL-Befund.

### Scope

1. **Eine neue Zeile in der Registry**, nicht eine Wiederverwendung: `KOSTENPROFIL` und
   `KOSTENPROFILE` in `src/billing/kostenarten.js` bekommen den neuen Inbound-Weg.
   `EL_CONVAI_SIP` darf **nicht** wiederverwendet werden: seine gemessene Pflichtmenge ist
   `[sip-trunking]`, unser Inbound-Bein liefert `call-control` (B12).
2. **Träger nach dem Messergebnis aus IE1 (F-D):** `elevenlabs_convai` (Anbieter-Ist,
   bestehender Einsammler) plus `telnyx_call_records` für unser Inbound-Bein — plus
   `telnyx_sip`, **falls** F-D ein zweites, separat abgerechnetes Bein belegt. Kein
   Träger ohne Messung.
3. **Pflichtmenge gemessen, sonst fail-closed.** Die Pflicht-Belegtypen werden an echten
   Anrufen gegen `detail_records` gemessen, mit Positiv-Kontrolle (ein Typ mit Treffern
   neben Typen mit echten Nullen — das Muster, mit dem `EL_CONVAI_SIP` belegt wurde). Ist
   die Messung nicht möglich, ist die Antwort `PFLICHTTYPEN_UNGEMESSEN` (leer), **nie**
   der Env-Wert als Trostpreis.
4. **Der Reihenfolge-Riegel wird gepinnt.** `legacyKostenprofil` klassifiziert jeden Anruf
   mit `sipCallId` als `EL_CONVAI_SIP`, richtungsunabhängig (B12). Die Zuordnung des neuen
   Profils respektiert diese Reihenfolge und überschreibt sie nicht — als Test, nicht als
   Kommentar.
5. **Der Boot-Riegel bleibt der Riegel.** `src/boot-guard.js#latentCostPathFindings` ist
   die Stelle, die einen Schalter ohne Katalogzeile nicht starten lässt (FATAL-Muster
   `REALTIME_CARRIER_UNCOLLECTED`). Der neue Schalter wird dort eingetragen, damit
   "Flag an, Kosten unsichtbar" nicht möglich ist.

### NICHT-Scope

- **Keine** Änderung an bestehenden Profilen, Trägern, Einsammlern oder an
  `config.billing.costTruingRequiredRecordTypes`.
- **Keine** Tarifänderung, keine Änderung an Decken oder an der Erstattungslogik
  (`istVollBelegt`, `kosten-projektion.js`).
- Keine Nachbuchung für Altanrufe (Lehre `no-existing-customers-premise`: es gibt keine
  Kundenanrufe zum Backfillen; und `did-miete-ohne-preis`: additiv-nullable braucht
  **immer** einen Backfill — der entfällt hier nur, weil es keine Altzeilen gibt).
- Kein Einsammler-Umbau für `elevenlabs_convai` (er existiert und ist belegt).

### Betroffene Dateien / Nahtstellen

`src/billing/kostenarten.js` (`KOSTENPROFIL`, `KOSTENPROFILE`, ggf.
`kostenprofilFuerAnruf`) · `src/boot-guard.js` (`latentCostPathFindings`) ·
`src/routes/voice.js` (die **eine** `recordCostProfile`-Zeile am neuen Zweig) ·
Doku der Kostenarten, wo der Katalog seine Begründungen trägt.
Nur **gelesen**: `src/billing/kosten-projektion.js`, die Einsammler.

### Invarianten (byte-identisch)

- Die vier bestehenden Profile bleiben unverändert, inklusive ihrer Pflichtmengen und
  Einsammler; `pruefeSchluesselmenge` bleibt grün.
- Ein Anruf mit `sipCallId` wird weiterhin `EL_CONVAI_SIP` zugeordnet.
- `pflichttypenFuerProfil` bleibt fail-closed für unbekannte Profile (leere Menge, nie der
  Env-Wert).
- Solange der neue Inbound-Schalter aus ist, wird das neue Profil **nie** gesetzt — die
  Buchhaltung ist byte-identisch zum Bestand.

### Abnahmekriterium

```
node --check src/billing/kostenarten.js && node --check src/boot-guard.js
npm test -- --test-concurrency=4
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # Boot-Guard-Ausgabe lesen
```
Erwartet: `npm test` grün, Testzahl nicht gesunken; der Boot-Guard meldet für den neuen
Schalter **keinen** FATAL-Befund, wenn die Katalogzeile steht, und einen FATAL-Befund,
wenn der Schalter ohne Katalogzeile an wäre (der Riegel ist als Test gegengeprobt).

### Testpflicht

- **Neu:** der neue Weg setzt das neue Profil; ein EL-Leg mit `sipCallId` bleibt
  `EL_CONVAI_SIP` (Reihenfolge-Riegel, Punkt 4).
- **Neu:** `pflichttypenFuerProfil` liefert für das neue Profil genau die **gemessene**
  Menge — und `PFLICHTTYPEN_UNGEMESSEN`, wenn sie nicht gemessen ist (fail-closed als Test).
- **Neu:** Schalter an **ohne** Katalogzeile → Boot-Riegel FATAL (die Gegenprobe).
- **Bestand:** alle Kostenarten-/Projektions-Tests bleiben unverändert grün.

### Risiko + Rückfall

Risiko mittel und rein buchhalterisch: eine falsche Pflichtmenge kippt `istVollBelegt` und
damit die Erstattungsrechnung — das ist die belegte B6-Falle. Deshalb ist die Messung mit
Positiv-Kontrolle Pflicht und `PFLICHTTYPEN_UNGEMESSEN` die erlaubte Antwort. Rückfall:
`git revert`; ohne den Inbound-Schalter ist das Profil wirkungslos.

### Owner / Testanruf

Keine Owner-Entscheidung. Ein echter Anruf ist nötig, um die Pflichtmenge gegen
`detail_records` zu **messen** — derselbe Anruf kann der IE1-Testanruf sein.

---

## Phase IE4 - Der Wiederholungs-Riegel bekommt eine pfadgerechte Antwort

**Abhängigkeiten:** keine. Muss **vor** IE5 fertig sein.

### Ziel (deterministisch prüfbar)

Eine wiederholte `/voice/incoming`-Zustellung für einen Anruf, der **nicht** mehr auf der
Budget-Engine läuft, bekommt **keine** Gather-Antwort mehr. Ein Test beweist: derselbe
Wiederholungs-Anker, aber die Ersatzantwort richtet sich nach dem Zustand des Anrufs,
nicht nach der Engine.

### Scope

1. **Die Wurzel:** `keepAliveXml: (call) => render(followupTurnDirectives(call, ""))` in
   `src/routes/voice.js` (B10). Der Anker-Mechanismus in
   `src/telephony/webhook-idempotenz.js#makeWebhookIdempotenz` ist richtig und bleibt; die
   **Ersatzantwort** ist an die Budget-Engine gebunden. Trifft eine Wiederholung nach einem
   Prozess-Neustart ein Bein, das bereits übergeben ist, antworten wir mit einem Gather auf
   eine Leitung, die der Agent führt: Brücke ab oder zwei Systeme auf einem Bein.
2. **Die Naht ist der bestehende Parameter**, nicht ein neuer Zweig im Guard: `keepAliveXml`
   wird pfadabhängig — für ein übergebenes Bein eine **leere** Direktivenliste (der
   Provider setzt das laufende Dokument nicht zurück), für ein Budget-Bein unverändert der
   Gather. Eine Funktion, eine Wahrheit; der Guard bleibt unverändert.
3. **Gilt auch für den Bestand:** dieselbe Latenz besteht heute für den Realtime-Zweig.
   Die Phase behebt sie dort mit, ohne `src/bridge.js` anzufassen (der Zweig wird in IE6
   entfernt; bis dahin ist er korrekt bedient).

### NICHT-Scope

- **Keine** Änderung am Anker (`incomingAnchors`, `CallSid`) und **keine** Änderung an der
  Erkennungslogik — der Wiederholungs-Riegel selbst ist nicht das Problem.
- Kein neuer Endpunkt, keine Änderung an der Signaturprüfung, keine neue Zeile in
  `src/route-policy.js`.
- Keine Änderung an `followupTurnDirectives` selbst (er bleibt die Antwort für ein
  Budget-Bein).
- Kein Wurf bei unbekanntem Zustand: die Ersatzantwort ist fail-safe, nie ein Fehler
  mitten im Gespräch.

### Betroffene Dateien / Nahtstellen

`src/routes/voice.js` (die `keepAliveXml`-Zuweisung) ·
`src/telephony/webhook-idempotenz.js` (nur **gelesen**, falls der Vertrag reicht; sonst
additiv erweitert) · `src/telephony/voice-render.js` (nur gelesen).

### Invarianten (byte-identisch)

- Für ein Bein auf der Budget-Engine ist die Ersatzantwort **byte-identisch** zum Bestand
  — Attribut für Attribut.
- Der Anker und die Ersatz-Antwortpflicht (immer `text/xml`, nie ein Fehlerstatus) bleiben
  unverändert.
- Kein Pfad antwortet auf eine Wiederholung mit einem Fehler oder mit Stille, wo heute ein
  Dokument steht.

### Abnahmekriterium

```
node --check src/routes/voice.js
npm test -- --test-concurrency=4
npm run inbound:hoerprobe -- --out /tmp/inbound-probe
```
Erwartet: `npm test` grün inkl. der neuen Tests; die Hörprobe meldet unverändert denselben
Sprechpfad wie vor der Phase (diese Phase ändert den ersten Turn nicht).

### Testpflicht

- **Neu:** Wiederholung auf ein Budget-Bein → byte-identischer Gather (Bestandsschutz).
- **Neu:** Wiederholung auf ein übergebenes Bein → **kein** Gather, fail-safe Antwort.
- **Neu:** Wiederholung auf ein Bein in unbekanntem Zustand → fail-safe Antwort, kein Wurf.
- **Bestand:** die Idempotenz-Tests bleiben unverändert grün.

### Risiko + Rückfall

Risiko klein, aber an einer heiklen Stelle: die Ersatzantwort ist das, was ein Anrufer
hört, wenn der Provider erneut zustellt. Gegenmittel: der Budget-Fall ist byte-gepinnt,
und der neue Fall ist fail-safe. Rückfall: `git revert`.

### Owner / Testanruf

Weder Owner-Entscheidung noch Testanruf.

---

## Phase IE5 - Inbound am ElevenLabs-Agenten, hinter einem Schalter

**Abhängigkeiten:** IE1 (der Anbieter-Vertrag ist gemessen und die Bauform entschieden),
IE2 (Geld-Achse mid-call), IE3 (Kostenprofil), IE4 (Wiederholungs-Antwort), IP3 (kein
Relay kann dazwischenkommen), IP4 (der gerenderte Satz spricht dieselbe Stimme wie der
Agent). **Ohne IE1 darf diese Phase nicht beginnen** — sonst ist ihre Prämisse geraten.

### Ziel (deterministisch prüfbar)

Bei aktivem Schalter führt ein eingehender Anruf der **EL-ConvAI-Agent** — derselbe Agent
wie bei Outbound —, nachdem unser Webhook angenommen, die sieben Sicherungen durchlaufen
und den Pflichtsatz **gerendert** hat. Der Anrufer hört **genau eine** Begrüssung und
**eine** Stimme. Bei Schalter aus ist das gerenderte TeXML byte-identisch zum Bestand.

### Scope

1. **Eine Übergabe-Direktive neben den bestehenden fünf.** `src/telephony/directives.js`
   bekommt die SIP-Übergabe (Bauform nach IE1/F-B: TeXML-`<Dial><Sip>` **oder**
   Call-Control-`dial`+`bridge` mit `custom_headers`), der Telnyx-Adapter den Renderer
   dazu. Strukturelle Vorlage ist `src/telephony/voice-render.js#streamDirectives`: **ein**
   Dokument, erst der gerenderte Satz, dann die Übergabe (B11). Telefonie-Logik läuft über
   die Ports, nicht im Server.
2. **Eine reine Entscheidungsfunktion**, Muster `inboundHandoffDecision`: sie sagt, ob
   übergeben wird, und liefert bei Nein einen **benannten** Rückfallgrund. Sie ist rein
   (kein IO), und sie ist die **eine** Stelle, die diese Frage beantwortet.
3. **Der Pflichtsatz bleibt unser, und er kommt genau einmal.** `withInboundNotice(...)`
   wird weiterhin von uns gerendert und gesprochen; der Agent darf auf diesem Weg **keine**
   eigene Eröffnung sprechen. Dass das wirklich so ist, wird am Anbieter **gemessen** und
   als Abnahme geführt — ein nicht freigeschaltetes Override-Feld wird laut Bestandslehre
   **still** ignoriert, und `hasInboundNotice` kennt nur unseren String. Der Riegel
   (Absolute Regel 2, GAP-14) ist: kein Übergeben ohne vorher gerenderten Pflichtsatz.
4. **Die Notbremse wird doppelt verdrahtet.** `armMaxDurationTimer` bleibt wie heute, und
   zusätzlich reist die guthaben-abgeleitete Frist (`brakeSecondsFor` →
   `emergencyBrakeSeconds`) als provider-erzwungene Zeitgrenze mit (`<Dial timeLimit>`,
   belegt 60–14400 s, B5) — innerhalb dieser Grenzen geklemmt, mit benannter Konstante,
   keine Magic Number. Der Wächter aus IE2 deckt die Geld-Achse.
5. **Sprache und Stimme je Anruf**, soweit IE1/F-B es belegt: die Tenant-Sprache reist als
   dynamic variable nach der belegten Normalisierungsregel (B3). Ist das nicht belegt,
   wird die Sprachwahl **nicht** geraten, sondern als Grenze dokumentiert und die
   Auslösebedingung aus Abschnitt 2.4 geprüft.
6. **Fail-safe, nie fail-open.** Jeder Fehler — Dial scheitert, Trunk antwortet nicht,
   Agent unbekannt, Entscheidung negativ — endet auf der Budget-Engine (solange sie noch
   existiert) bzw. im Rückfall ohne Gehirn, **nie** in einer Fehleransage und **nie** in
   Stille. Der Grund wird als Token an der **einen** Sonde `logInboundPathDecision`
   geführt; es entsteht keine zweite Logquelle.
7. **Der Schalter ist der Rückweg.** Default **aus**; Scharfstellen nur nach einem
   erfolgreichen Testanruf. Eintrag in `src/config.js`, `.env.example` **und**
   `render.yaml` (und der Blueprint sagt dasselbe wie der Code — der Widerspruch, den IP3
   beseitigt hat, kommt hier nicht neu herein).
8. **Die Hörprobe aus IP2 wird additiv erweitert** um den Übergabe-Pfad als vierten
   benannten Token — dieselbe Klassifikationsfunktion, kein zweiter Namensvorrat.

### NICHT-Scope

- **Kein** Entfernen oder Aufweichen irgendeines Gates. Signaturprüfung,
  Wiederholungs-Riegel, Tenant-Auflösung, Kostendecke, Max-Dauer und der gerenderte
  Pflichtsatz bleiben **vor** der Übergabe-Entscheidung, in unveränderter Reihenfolge.
- **Kein** `inbound_trunk_config`-Weg, bei dem unser Webhook übersprungen wird (K3,
  ausgeschieden — Abschnitt 2.3). Wer diesen Weg hier einbaut, entfernt Absolute Regel 1
  für Inbound.
- **Keine** Änderung an `ELEVENLABS_VOICE_ID_BY_PROFILE` (Owner-Entscheidung 2026-08-18)
  und **kein** Eingriff in den Outbound-Anfragekörper.
- **Keine** neuen Werkzeuge für Inbound: das Richtungs-Gate (`consultAvailableFor`,
  `lookupProviderFor`, und die Richtungsprüfung im Werkzeug-Webhook) bleibt unverändert —
  derselbe Agent, dieselbe Sperre (B9, Owner-Entscheidung O4).
- **Kein** Entfernen der Budget-Engine (das ist IE6) und kein Eingriff in
  `src/bridge.js`.
- Kein `elevenlabs:push`, der Outbound-Verhalten ändert, ohne Drift-Lauf davor und danach.

### Betroffene Dateien / Nahtstellen

`src/telephony/directives.js` (neue Direktive) ·
`src/telephony/adapters/telnyx/render.js` bzw. `.../voice.js` (Renderer bzw.
Call-Control-Kommando, je IE1) · `src/telephony/voice-render.js` (Direktivenliste
"Satz + Übergabe", Muster `streamDirectives`) · `src/routes/voice.js`
(Ausführungszeitpunkt, Sonde, Kostenprofil-Zeile) · eine neue Datei für die
Entscheidungsfunktion · `src/elevenlabs/nummern-registrierung.js` **nur**, wenn IE1/F-E
belegt hat, dass dieselbe Nummer beides tragen kann · `src/config.js`, `.env.example`,
`render.yaml` · `scripts/inbound-hoerprobe.mjs` (additiver Token).

### Invarianten (byte-identisch)

- **Schalter aus = byte-identisch** zum heutigen Inbound-TeXML, Attribut für Attribut,
  inklusive Attribut-Reihenfolge und Escaping.
- Die sieben Sicherungen laufen in unveränderter Reihenfolge; keine wandert hinter die
  Übergabe.
- Der Pflichtsatz wird **gerendert**, nie gepromptet, und genau einmal gesprochen.
- **Outbound bleibt vollständig unberührt**: `startCallBody` und
  `conversationConfigOverride` byte-identisch, gegen Snapshot gepinnt; die
  `outbound_trunk`-Projektion der Nummern-Registrierung unverändert.
- `test/route-auth-inventory.test.js` bleibt grün — diese Phase fügt keinen Endpunkt hinzu.
- Die Zahl der Einträge in `test/abnahme-ausgewandert.json` sinkt nicht (Regel D13).

### Abnahmekriterium

```
node --check src/routes/voice.js && node --check src/telephony/directives.js
npm test -- --test-concurrency=4
npm run test:gates
npm run elevenlabs:drift
npm run inbound:hoerprobe -- --out /tmp/nachher
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # + curl /voice/incoming, Byte-Vergleich
```
Erwartet: `npm test` grün, Testzahl nicht gesunken; bei Schalter aus liefert `curl`
byte-identisches TeXML zum Stand vor der Phase; `elevenlabs:drift` vor und nach der Phase
mit unverändertem Outbound-Ergebnis. **Live-Abnahme:** ein echter eingehender Anruf mit
Schalter an — im Log `inbound_path` mit dem neuen Token, der Anrufer hört **genau eine**
Begrüssung in **einer** Stimme, kann den Agenten nach dem Pflichtsatz unterbrechen, und
der Anruf lässt sich über unseren Griff beenden (der Nachweis aus IE1/F-C am echten
Anruf wiederholt).

### Testpflicht

- **Neu:** Schalter aus → byte-identisches TeXML (Snapshot).
- **Neu:** Schalter an → die Direktivenliste enthält den gerenderten Pflichtsatz **vor**
  der Übergabe, und `hasInboundNotice` ist für den gesprochenen Text erfüllt
  (Regel-2-Riegel).
- **Neu:** Übergabe ohne vorher gerenderten Pflichtsatz ist **nicht** möglich (Negativfall).
- **Neu:** jeder Fehlerfall (Dial scheitert, Entscheidung negativ, Ziel unbekannt) → kein
  Fehlerdokument, benannter Rückfallgrund an der **einen** Sonde.
- **Neu:** die Zeitgrenze reist innerhalb der belegten Grenzen mit und wird aus der
  guthaben-abgeleiteten Frist gebildet (nicht aus einer nackten Zahl).
- **Neu:** ein Inbound-Anruf am selben Agenten bekommt `get_consult`/`look_up`
  **nicht** — der Richtungs-Riegel als Test am neuen Weg (B9).
- **Bestand:** `test/inbound-disclosure-mandatory.test.js`, die Signatur-Tests, die
  Idempotenz-Tests und alle Outbound-Snapshots bleiben grün.

### Risiko + Rückfall

**Hochrisiko:** ein Live-Pfad für echte Anrufer, echtes Geld (der EL-Weg kostet gemessen
~14–16 US-Cent/min gegen 1,87), eine Anbieter-Naht, die vor IE1 unbelegt war, und Artikel
50 im ersten Satz. Rückfall in zwei Stufen: (1) Schalter im Render-Dashboard auf `false` —
sofort, ohne Deploy, byte-identisch zum Bestand; (2) `git revert`. Vor dem Scharfstellen
ist der Runtime-Output zu **lesen**, nicht zu raten (Absolute Regel 7): Render-Log und
Telnyx-Portal-Debugger.

### Owner / Testanruf

**Beides zwingend.** Owner: den Schalter stellen und die Kosten pro Inbound-Minute
akzeptieren (O10). Echter Inbound-Testanruf in **jeder** freigeschalteten Sprache — der
Pflichtsatz, die Stimm-Kohärenz und die Doppelansage sind nur am Ohr entscheidbar.

---

## Phase IE6 - Die überzähligen Gehirne entfernen

**Abhängigkeiten:** IE5 **live und über eine benannte Beobachtungsfrist bewährt**. Diese
Phase beginnt nicht, weil Tests grün sind, sondern weil der neue Pfad Anrufe geführt hat
und der Owner freigegeben hat.

### Ziel (deterministisch prüfbar)

Nach dieser Phase existiert im Repo **ein** Gesprächs-System. Deterministisch geprüft:
`grep` findet die entfernten Module, Schalter, Direktiven, Kostenprofile und Kostenarten
**nirgends** mehr — auch nicht in einem Kommentar, der sie als lebende Naht beschreibt —,
und es bleibt **kein Export ohne Konsumenten** zurück. `npm test` ist grün und die Zahl
der Einträge in `test/abnahme-ausgewandert.json` ist nicht gesunken.

### Scope — in drei getrennten Stufen, drei getrennten Commits, drei getrennten Freigaben

**Stufe 1 — der Telnyx-AI-Assistant (das dritte Gehirn).** Entfernt: `src/telnyx-inbound.js`,
`src/telnyx-llm-shim.js`, `src/telnyx-conversation-watchdog.js`,
`scripts/telnyx-assistant-provision.mjs`, `KOSTENPROFIL.TELNYX_ASSISTANT` samt Registry-Zeile,
die Schalter `TELNYX_AI_ASSISTANT_ENABLED` und `TELNYX_INBOUND_HANDOFF_ENABLED` in
`src/config.js` / `.env.example` / `render.yaml`, und der Handoff-Aufruf in
`src/routes/voice.js`. **Konsumenten je Funktion zählen, nie je Modul:**
`config.telnyx.telnyxElevenLabs` hat vier belegte Leser — `speakVoiceFields` und
`assistantVoiceConfigured` (`.../telnyx/voice.js`) und der Provisioner sterben mit dieser
Stufe, aber `src/elevenlabs/outbound.js#callLocaleOf` liest den `defaultVoiceId` und lebt
weiter. Der Block wird deshalb **nicht** gelöscht, sondern auf seinen überlebenden Leser
zurückgeschnitten, und der Modulkopf wird nachgezogen (Pre-Mortem Q5/Q7).

**Stufe 2 — die OpenAI-Realtime-Bridge (der vierte Zweig, nie benutzt).** Entfernt:
`src/bridge.js` samt seinen `HEIKLE STELLE`-Abschnitten, `DIRECTIVE.STREAM` und
`streamDirectives`, `MEDIA_PATH`, die Media-Event-/Media-Adapter-Naht,
`VOICE_ENGINE=realtime` samt allen Sonderfällen — darunter der Realtime-Early-Return in
`rearmActiveCallTimers` und die Realtime-Bedingung in `consultAvailableFor` —,
`KOSTENPROFIL.TELNYX_INBOUND_REALTIME`, `KOSTENART.OPENAI_REALTIME`,
`REALTIME_MID_CALL_BUDGET_CHECK` und die daran hängenden Boot-Guard-Befunde
(`REALTIME_NO_MIDCALL_BUDGET`, `REALTIME_CARRIER_UNCOLLECTED`). Mit dem Zweig
verschwinden auch die offenen Befunde, die nur er trug.

**Stufe 3 — die Gesprächslogik der Budget-Engine (die eigentliche Konsolidierung).**
Entfernt: `POST /voice/turn`, der Folge-Gather (`followupTurnDirectives`), der
Inbound-Zweig von `claude.js#agentTurn` samt Inbound-Prompt und den Inbound-Werkzeugen
unserer Seite, der STT-Modell-Seam für Inbound, `KOSTENPROFIL.TELNYX_INBOUND_BUDGET` und
die Bench-Treiber, die diese Schleife fuhren. **Was bleibt und bleiben muss:**
`claude.js`-Fähigkeiten, die nicht Gesprächsführung sind (Zusammenfassung nach dem Anruf,
Vorab-Briefing und Eröffnungszeile für Outbound — belegt getrennt verdrahtet über
`routes/api-calls.js`), und der Outbound-TeXML-Weg **nur so lange**, wie er der Rückweg
für Outbound ist (eigene Entscheidung, nicht Teil dieser Stufe).

**Stufe 3b — Ersatz statt Lücke, im selben Commit wie Stufe 3.** An die Stelle der
entfernten Rückfall-Engine tritt der Rückfall **ohne Gehirn**: ein gerenderter Satz
(`DIRECTIVE.SAY`) plus Auflegen (`DIRECTIVE.HANGUP`), plus der bestehende Anruf-Datensatz
fürs Postfach. Kein LLM, kein Turn, keine Gesprächsführung — damit ist er **keine** zweite
Wahrheit über Gesprächslogik. Er greift bei jedem Fehlerfall aus IE5, Punkt 6.
Ein Anrufbeantworter **mit Aufnahme** wäre die freundlichere Variante, ist aber am
Provider ungemessen (M22) und ist deshalb **nicht** Teil dieser Stufe.

### NICHT-Scope

- **Kein** Entfernen einer Sicherung. Alle sieben bleiben; IE6 entfernt Gehirne, nicht
  Gates. Die Prüfreihenfolge in `/voice/incoming` bleibt unverändert.
- **Kein** Entfernen der Provider-Abstraktion (`src/telephony/ports.js`, `registry.js`,
  Adapter): der **Carrier** bleibt austauschbar, auch wenn das Gehirn es nicht ist.
- **Kein** Entfernen von `claude.js` als Modul: Zusammenfassung, Briefing und
  Eröffnungszeile sind keine Gesprächsführung und haben belegt eigene Aufrufer.
- **Kein** Löschen eines Katalog- oder Abnahmetests. Ein Test, dessen Messpunkt
  verschwindet, **zieht um** und behält Kennung und Bank; sein Farbstand wird vor und nach
  dem Umzug genannt (Muster IP3/M11). Ein entfernter Katalog-Test ist ein verlorenes
  Launch-Kriterium.
- **Kein** Entfernen von `OUTBOUND_FROZEN`, `MAX_NUMBERS`, `MAX_NUMBERS_PER_TENANT` oder
  irgendeines Outbound-Gates.
- Keine Stufe in einem Commit mit einer anderen.

### Betroffene Dateien / Nahtstellen

Je Stufe die dort genannten Dateien, plus jeweils: `src/config.js`, `.env.example`,
`render.yaml` (Schalter-Entfernung), `src/boot-guard.js` (Befunde, die mit dem Zweig
sterben), `src/billing/kostenarten.js` (Profile und Kostenarten), die zugehörigen Tests.
Vor jeder Stufe zu prüfen und **nicht** anzufassen: `src/telephony/ports.js` und die
Adapter, `src/elevenlabs/**` (der überlebende Weg), `src/route-policy.js`.

### Invarianten (byte-identisch)

- Die sieben Sicherungen sind nach jeder Stufe unverändert wirksam; `npm test` und die
  Security-Tests sind nach **jeder** Stufe grün, nicht erst am Ende.
- Outbound bleibt nach jeder Stufe unverändert: `startCallBody` und
  `conversationConfigOverride` byte-identisch, `elevenlabs:drift` unverändert.
- Kein Export ohne Konsumenten, kein auskommentierter Code, kein per Flag abgeschalteter
  Pfad bleibt zurück (G9, hart verboten).
- Kein Anrufer hört nach einer Stufe Stille oder eine Fehleransage, wo vorher ein Dokument
  stand.

### Abnahmekriterium

Je Stufe, nach Dateien statt nach Zeilenzahlen:
```
grep -rn "telnyx-inbound\|telnyxLlmShim\|TELNYX_AI_ASSISTANT_ENABLED" src scripts test   # Stufe 1
grep -rn "bridge.js\|REALTIME\|MEDIA_PATH\|streamDirectives" src scripts test            # Stufe 2
grep -rn "voice/turn\|followupTurnDirectives" src scripts test                           # Stufe 3
npm test -- --test-concurrency=4
npm run test:gates
npm run elevenlabs:drift
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start   # + curl /healthz, /voice/incoming
```
Erwartet: die `grep`s finden nach ihrer Stufe **nichts** mehr (auch keinen Kommentar, der
die Naht als lebend beschreibt); `npm test` grün und die Testzahl nur um die Tests der
entfernten Pfade gesunken, **namentlich** im Phasenbericht aufgeführt; die Zahl der
Einträge in `test/abnahme-ausgewandert.json` unverändert; der Smoke-Test liefert für
`/voice/incoming` ein gültiges Dokument.

### Testpflicht

- **Neu, je Stufe:** ein Test, der beweist, dass der entfernte Weg **nicht mehr
  erreichbar** ist — nicht nur, dass er abgeschaltet ist.
- **Neu (Stufe 3b):** jeder Fehlerfall aus IE5 endet im Rückfall ohne Gehirn: ein
  gesprochener Satz, ein Anruf-Datensatz, kein Turn, kein LLM-Aufruf.
- **Umgehängt, nicht gelöscht:** jeder Katalog-/Abnahmetest, dessen Messpunkt verschwindet,
  behält Kennung und Bank und misst dieselbe Zusicherung am überlebenden Pfad.
- **Bestand:** die Signatur-, Route-Auth-, Budget- und Kostenarten-Tests bleiben nach
  jeder Stufe grün.

### Risiko + Rückfall

**Hochrisiko, und das grösste der Kette:** hier wird der Rückweg selbst entfernt. Nach
Stufe 3 gibt es kein System mehr, das ohne den Anbieter ein Gespräch führen kann
(Pre-Mortem Q1, Q8). Gegenmittel: die Stufen sind getrennt und einzeln revertierbar, jede
hat ihre eigene Freigabe, Stufe 3 kommt zuletzt und erst nach einer Beobachtungsfrist auf
dem neuen Pfad, und Stufe 3b liefert den Ersatz im **selben** Commit wie die Entfernung —
nicht als Folgephase. Rückfall: `git revert` der jeweiligen Stufe; kein Schema, kein
Datenzustand. Für Stufe 3 ist das der **einzige** Rückweg, und das ist der bewusst
akzeptierte Preis der Konsolidierung.

### Owner / Testanruf

**Beides zwingend, und für Stufe 3 eine eigene Entscheidung (O9).** Owner: Stufe 1 und 2
freigeben (zwei abgeschaltete Pfade ersatzlos entfernen), und Stufe 3 gesondert — sie
akzeptiert die einseitige Anbieter-Abhängigkeit (O11). Testanruf nach **jeder** Stufe: ein
echter eingehender Anruf, der ankommt und geführt wird.

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
   (Fussnote (b)-Stimme in 2.5; der Pfad wird in IE6 Stufe 1 entfernt).
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
4. **Die Inbound-Pfad-Sonde.** `logInboundPathDecision` ist die eine Sonde je Leg. IE5
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
- Die Übergabe-Direktive (IE5) entsteht in `telephony/directives.js` und im Adapter, nicht
  als Sonderfall in `routes/voice.js` — Telefonie-Logik läuft über die Ports, nie direkt im
  Server (Architektur-Regel). Dasselbe gilt für den Geld-Wächter (IE2): er hängt an der
  Lifecycle-Naht, nicht am Handler.

**Welche Magic Numbers nach `src/config.js` gehören (G25/G35):**

- Nichts aus IP1–IP3: die Umlaut-Korrektur ist ein Wortlaut, die Migrationskarte ist
  kuratierter Produktinhalt (dieselbe Klasse wie `ELEVENLABS_VOICE_ID_BY_PROFILE`, das
  ausdrücklich **kein** Env-Schalter ist, mit Begründung im Modul).
- O2: falls eine Modellklasse gewählt wird, bleibt sie `ELEVENLABS_MODEL` in
  `src/config.js` — mit Eintrag in `.env.example` **und** `render.yaml`.
- IE2: das Wächter-Intervall gehört nach `src/config.js` mit `min`/`max` (Muster `numEnv`),
  nie als nackte Zahl in den Wächter.
- IE5: die Zeitgrenze an der Übergabe wird aus der guthaben-abgeleiteten Frist gebildet und
  gegen die belegten Provider-Grenzen (60–14400 s, B5) geklemmt — mit benannter Konstante,
  nie als Literal. Jeder neue Rückfallgrund ist ein benannter Token an der einen Sonde, kein
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
- **G30 (eine Aufgabe pro Funktion):** IE4 und IE5 berühren `/voice/incoming`, einen
  Handler, der bereits viel trägt. Neue Logik entsteht als eigene, benannte Funktion —
  und die Übergabe-Entscheidung als **reines** Prädikat (Muster `inboundHandoffDecision`),
  nicht als weiterer Abschnitt im Handler. IE6 entfernt Zweige aus demselben Handler; auch
  das ist eine Aufgabe pro Stufe, nicht drei in einem Commit.
- **T5/G3 (Grenzen):** jede neue Entscheidung braucht ihren Negativfall als Test —
  leeres Kontingent, unbekanntes Profil, gesperrte Geld-Achse **ohne** Turn, Übergabe ohne
  gerenderten Pflichtsatz, Wiederholung auf ein übergebenes Bein, ungemessene Pflichtmenge.
- **Kommentare auf Deutsch, OHNE Umlaute im Code.** Dieses Dokument trägt Umlaute; jeder
  Code-Kommentar der Kette nicht. Umgekehrt: **gesprochene** DE-Strings tragen Umlaute
  (Lehre `umlaut-transliteration-root-cause`) — genau das ist IP1.

---

## 6. Offene Messungen und Owner-Entscheidungen

Nachgezogen auf die EIN-System-Entscheidung. Gestrichene Einträge stehen mit Grund unten,
damit niemand sie für vergessen hält.

### Offene Messungen (jede mit dem konkreten nächsten Schritt)

| # | Was offen ist | Nächster Schritt | Blocker für |
|---|---|---|---|
| M1 | Live-Wert von `ELEVENLABS_PLAY_TTS_ENABLED` auf Render. Lokal leer (B13), `render.yaml` sagt `"false"` — aber die Services sind Dashboard-managed, der Blueprint ist **nicht** die Live-Wahrheit. Damit ist unbelegt, ob Inbound heute Azure oder ElevenLabs spricht. | Render-Dashboard lesen; danach IP2 lokal mit demselben Wert fahren. | IP4 |
| M2 | Live-Wert von `ELEVENLABS_OUTBOUND_ENABLED`. Lokal `false` (B13), mehrere Kettenstände legen einen live laufenden EL-Outbound nahe. Ohne diesen Wert ist selbst "Outbound läuft über ElevenLabs" am Repo nicht belegt — und damit die Prämisse der ganzen Konsolidierung. | Render-Dashboard lesen; gegenprüfen am Kostenprofil eines jungen Outbound-Anrufs (`EL_CONVAI_SIP` in der Prod-DB, RLS-Gotcha `app.current_tenant`). | **die Leitentscheidung selbst** |
| M4 | Live-Werte von `tts.model_id` und `tts.voice_id` am Agenten, und ob die Whitelist `platform_settings.overrides.conversation_config_override` die Felder trägt, die wir brauchen. Der Live-Audit dieses Laufs fand **an**: `tts.voice_id`, `agent.first_message`, `agent.language`; **aus**: `agent.prompt.*`, `conversation.max_duration_seconds`, `tts.model_id`. Ein nicht freigeschaltetes Feld wird **still** ignoriert. | `npm run elevenlabs:drift` plus `GET /v1/convai/agents/{id}`; die Stimm-Kennung nur per Mini-Synthese prüfen, nie per `GET /v1/voices/{id}` (Lehre `el-stimme-pruefen-nur-per-synthese`). | IP4, IE5 |
| M5 | Ob der At-Rest-Nachzug aus IP1 (`scripts/greeting-orthografie-nachziehen.mjs --apply`) gegen die Produktions-DB gelaufen ist. Der Anrufweg ist über `greetingForLanguage` gedeckt, die gespeicherten Werte sind es nicht. | Trockenlauf gegen die Prod-DB, dann `--apply`; **Achtung** Lehre `pg-store-holds-state-in-memory`: der pg-Store hält Zustand im Speicher, ein Schreibweg braucht einen Neustart. | — (Hygiene) |
| M6 | Typische End-zu-End-Stille eines Inbound-Turns **heute** (der Vorher-Wert für IE5). Belegt ist nur die rechnerische Obergrenze. | IP2 liefert die Marken lokal; der Median am echten Anruf braucht die `src/metrics.js`-Zeilen aus dem Render-Log. | IE5 (Vergleichswert) |
| M10 | Live-Wert von `TELNYX_ELEVENLABS_VOICE_ID` und `TELNYX_ELEVENLABS_API_KEY_REF` (lokal beide leer, B13). Jetzt **nur noch** relevant für IE6 Stufe 1: ob die statische Plattform-Stimme irgendwo live in Gebrauch ist, bevor ihr Config-Block zurückgeschnitten wird. | Render-Dashboard lesen; die live provisionierte Assistant-Ressource per `GET` gegen `voice_settings.voice` gegenprüfen. | IE6 Stufe 1 |
| M11 | Farbstand des Katalog-Tests `VOICE-12` vor und nach IP3 (der Messpunkt zieht auf den Play-TTS-Pfad um). In der Befundphase nicht gemessen. | `npm run test:gates` vor dem ersten IP3-Commit fahren, Stand im Phasenbericht notieren, danach erneut (Lehre `sec-fix-chain-complete`: Zähler neu messen, nie aus einer Notiz lesen). | IP3 |
| M12 | **Die Prämisse von K1:** wie ElevenLabs einen ankommenden INVITE einem Agenten zuordnet. Die URI-Form ist belegt (B1), die Zuordnungslogik **nicht** (B4). | IE1/F-A: echter Anruf an `sip:+<Test-DID>@sip.rtc.elevenlabs.io:5060`, mit dem bekannten Agenten als Positiv-Kontrolle. | **IE5** |
| M13 | Auf welchem Weg eigene `X-`Header wirklich mitreisen: TeXML-`<Sip>` (nicht dokumentiert, B5) oder Call-Control-`dial` mit `custom_headers` (dokumentiert). Entscheidet die Bauform von IE5. | IE1/F-B, beide Formen an einem echten Anruf. | IE5 |
| M14 | Ob der Elternbein-Griff (`callControlId`/`providerCallSid`) während der SIP-Brücke noch einen Hangup trägt — und ob `<Dial timeLimit>` (60–14400 s, B5) die Brücke zuverlässig beendet. **Mindestens einer** muss belegt sein, sonst ist S5 verloren. | IE1/F-C, inklusive Negativfall (Hangup-Versuch während der Brücke, `timeLimit` an der Untergrenze). | **IE5, Abbruchbedingung** |
| M15 | Ob der Dial ein zweites, separat abgerechnetes Telnyx-Bein erzeugt, und unter welchem `record_type` es in `detail_records` erscheint. Liefert die Trägerliste und die Pflichtmenge. | IE1/F-D, danach die Pflichtmengen-Messung mit Positiv-Kontrolle. | IE3 |
| M16 | Ob dieselbe Nummer `inbound_trunk_config` **und** `outbound_trunk_config` tragen kann, ohne die gemessene `outbound_trunk`-Projektion zu verlieren. | IE1/F-E, an einer **Testnummer**, nie an der produktiven DID (Pre-Mortem Q5). | IE5 |
| M17 | Ob Sprache und Stimme unter K1 **pro Anruf** setzbar sind. Belegt ist nur der Variablen-Kanal (B3); Overrides reisen über SIP-Header **nicht**. Ohne diese Messung ist "FR-/EN-Inbound klingt wie Outbound" eine Vermutung. | IE1/F-B plus ein Testanruf je freigeschalteter Sprache; sonst greift die Auslösebedingung aus 2.4. | IE5, Abnahme-Erwartung |
| M18 | Ob unser Tarif den Monitoring-WebSocket (`{"command_type":"end_call"}`) überhaupt umfasst — die Doku nennt ihn **enterprise-only** (B6). Für K1 irrelevant (unser Griff ist der Telnyx-Griff), für K2 und für jede spätere K3-Wiederaufnahme entscheidend. | Beim Anbieter erfragen; ohne Zusage bleibt es kein Kappweg. | K2-Rückfall, K3-Wiederaufnahme |
| M19 | Der Live-Audit dieses Laufs fand am Agenten eine Stimm-Kennung, die **nicht** der kuratierten DE-Kennung aus `ELEVENLABS_VOICE_ID_BY_PROFILE` entspricht. Versehen, Teststand oder Absicht? Solange das offen ist, ist "eine Stimme in beiden Richtungen" am Live-Agenten unbelegt. | `GET` am Agenten plus Mini-Synthese; Owner entscheidet, welche Kennung gilt (O12). | IP4, IE5 |
| M20 | Am Live-Agenten steht `enable_conversation_initiation_client_data_from_webhook` auf `false`, und **eine von vier** verknüpften Nummern trägt bereits ein vollständiges `inbound_trunk`-Objekt. Überbleibsel eines frühen Versuchs oder absichtlich vorbereitet? Eine scharfe Inbound-Freigabe an einer produktiven Nummer wäre der K3-Bypass **ohne** Entscheidung. | Snapshot der vier Nummern lesen, mit Telnyx-Seite abgleichen (zeigt die DID dort auf EL?), und aufräumen, was nicht gewollt ist. | **sofort** (Sicherheitslage) |
| M21 | Was sich am Anbieter ändern müsste, damit K3 je zulässig wäre: HMAC-Signatur (oder gleichwertig) am Initiations-Webhook, ein dokumentiertes Reject-Feld, und ein nicht-enterprise Kappweg. Solange eines fehlt, bleibt K3 ausgeschieden. | Beobachten, nicht bauen; bei einer Anbieter-Änderung neu prüfen. | — |
| M22 | Ob TeXML eine Aufnahme-Form trägt, mit der der Rückfall ohne Gehirn (IE6 Stufe 3b) eine Nachricht **aufnehmen** könnte, statt nur zu sprechen. Ungemessen, kein Feldname geraten. | Nach IE6 Stufe 3 messen; bis dahin ist der Rückfall Satz + Auflegen. | — |

**Gestrichen, mit Grund:** M3 (Live-Werte der Assistant-Schalter) — die Schalter werden in
IE6 Stufe 1 **entfernt**; der einzige noch nötige Teil ist M10. M7 (Name des
Telnyx-`answered`-Ereignisses) und M9 (Nachprüfung des 422) — sie waren Voraussetzungen
von IP7, und IP7 entfällt vollständig (Abschnitt 4.1). M8 (Telnyx-Aufnahme als Hörbeleg) —
IP2 liefert den Hörbeleg lokal und billiger; wird nur relevant, falls IP2s Datei nicht
genügt.

### Owner-Entscheidungen

Die Kette steht ohne sie: IP2, IP3, IE1, IE2, IE3 und IE4 brauchen keine dieser
Entscheidungen. Sie werden gebraucht für IP4, IE5 und IE6.

| # | Entscheidung | Warum sie nicht delegierbar ist |
|---|---|---|
| O1 | **`ELEVENLABS_PLAY_TTS_ENABLED` live auf `true`** (IP4). Auf dem neuen Weg ist das nicht mehr Komfort, sondern die Bedingung dafür, dass der Anrufer **eine** Stimme hört statt zwei in einem Anruf. | Es kostet ElevenLabs-Zeichen auf einem Plattform-Konto ohne per-Tenant-Metering — eine Geldentscheidung. Rückweg ist ein Dashboard-Flip. |
| O2 | **Mit welchem TTS-Modell unser eine gerenderte Satz synthetisiert wird**, gemessen gegen das Modell des Agenten (M4). Gleich = kohärent, aber evtl. langsamer; verschieden = hörbarer Bruch genau an der Übergabe. | Klang gegen Latenz an der rechtlich verdrahteten Stelle des Anrufs. Ein Push in die Agenten-Konfiguration wirkt sofort auf Outbound, den heute niemand beklagt. |
| O4 | **Bleibt das Richtungs-Gate für `get_consult`/`look_up`?** Nach der Konsolidierung ist es derselbe Agent in beiden Richtungen — die Sperre bleibt trotzdem, weil sie **unsere** Sicherung an **unserem** Werkzeug-Webhook ist (B9). Die Frage ist damit unverändert offen, aber nicht mehr durch die Architektur beantwortet. | Eine Lockerung wäre eine neue Datenfluss-Entscheidung (Rückfrage beim Auftraggeber wegen eines fremden Anrufers; Suchanfrage nach aussen aus einem fremden Gespräch). Nicht ohne Owner, und dann als eigene Kette mit `PLAN-SECURITY.md`-Eintrag. |
| O5 | **Braucht Inbound Spracherkennung im Gespräch?** Diese Frage **entspannt sich** durch die Konsolidierung: der EL-Agent hat `language_detection` als eigenes Werkzeug, das Outbound heute nutzt. Ob es für Inbound freigegeben wird, bleibt eine Entscheidung — aber sie ist danach ein Schalter am Agenten, kein Umbau. | Sie ändert, was der Agent während eines Anrufs mit einem fremden Anrufer tut. Bewusst **keine** Phase dieser Kette. |
| O8 | **Den Telnyx-AI-Assistant-Pfad ersatzlos entfernen** (IE6 Stufe 1), statt ihn wie in der alten Kette scharfzustellen. Damit fällt auch die dort vorgesehene Bestätigung der dreifachen Inbound-Kosten weg — sie wird nicht mehr gebraucht. | Es ist die Rücknahme einer früheren Richtungsentscheidung und die Löschung gebauter Arbeit. Das entscheidet niemand nebenbei. |
| O9 | **Die Gesprächslogik der Budget-Engine entfernen** (IE6 Stufe 3) — die eigentliche Konsolidierung. Danach gibt es kein System mehr, das ohne den Anbieter ein Gespräch führen kann; der Ersatz ist ein Rückfall **ohne Gehirn** (Satz + Auflegen + Postfach). | Es entfernt den Rückweg selbst. Ein Plan, der "eine Wahrheit" und "ein zweites System als Versicherung" gleichzeitig verspricht, lügt — die Wahl zwischen beidem ist die Owner-Entscheidung dieser Kette. |
| O10 | **Den Inbound-Schalter aus IE5 scharfstellen** und die Kosten pro Inbound-Minute akzeptieren: gemessen ~14–16 US-Cent/min auf dem EL-Weg gegen 1,87 auf der Budget-Engine, und "Turns statt Sekunden" macht daraus einen Mittelwert, keinen Deckel. | Reine Kostenentscheidung mit Live-Wirkung auf echte Anrufer, an einer Achse, die um Faktor 8 springt. |
| O11 | **Die einseitige Anbieter-Abhängigkeit akzeptieren** (Pre-Mortem Q8): nach der Konsolidierung kappt ein leeres EL-Konto oder eine Schnittstellen-Änderung **beide** Richtungen. Heute überlebt Inbound einen EL-Ausfall, weil es ein eigenes Gehirn hat. | Das ist der Preis für eine Wahrheit, und er trifft die Verfügbarkeit des Produkts. Er gehört ausdrücklich bezahlt oder ausdrücklich abgelehnt — nicht in einer Phase versteckt. |
| O12 | **Welche Stimm-Kennung gilt** (M19): die kuratierte DE-Kennung aus `ELEVENLABS_VOICE_ID_BY_PROFILE` oder die am Live-Agenten gesetzte, abweichende. Solange das offen ist, ist "eine Stimme in beiden Richtungen" nicht belegt. | Die kuratierten Kennungen sind eine Owner-Entscheidung vom 2026-08-18, per Synthese abgehört. Eine Abweichung am Live-Agenten überstimmt sie faktisch — das muss gewollt sein oder korrigiert werden. |

**Gestrichen, mit Grund:** O3 (Assistant-Inbound scharfstellen und die Verdreifachung
bestätigen) — ersetzt durch O8: der Pfad wird entfernt, nicht scharfgestellt. O6 (EL für
Inbound: dauerhaft nein, oder später über unseren Webhook?) — **entschieden**: ja, und
zwar genau in der Variante, die die Naht behält (K1, Abschnitt 2.4); der
`inbound_trunk_config`-Bypass bleibt ausgeschieden (K3, Abschnitt 2.3). O7 (soll der
Assistant-Pfad die Stimme pro Sprache auflösen?) — gegenstandslos, der Pfad wird
entfernt.
