# Grounding: Offenlegungs-/Eroeffnungs-Mechanik Outbound-Calls (alle Engines)

Stand: 2026-08-20, master `ec2ac28`. Nur gelesen, nichts geaendert/ausgefuehrt/committet.
Praemisse: Produkt nicht gelauncht, alle aktiven Accounts gehoeren Owner/Jonas.

## 1. LIVE-PFAD (ElevenLabs-Outbound): wie entsteht der erste gesprochene Satz

Reihenfolge der Bausteine, mit Quelle:

1. **Wortlaut-Quelle der Pflicht-Offenlegung**: `src/i18n/locales.js`, `LOCALES.<sprache>.disclosure(name)`.
   `src/claude.js:392-397` (`disclosureSentence(call)`) delegiert nur an
   `localeFor(call.language).disclosure(name)` — der eigentliche Wortlaut liegt im
   Locale-Bundle, nicht in `claude.js` selbst.

2. **Grund-Zeile ("was will der Agent")**: entsteht VOR dem Anruf, bei Auftragsannahme, in
   `src/routes/api-calls.js:224-244` — NUR wenn `config.voice.elevenLabsOutbound.enabled`.
   Ruft `fetchOpeningLine()` (`src/elevenlabs/opening-line-llm.js`), die ein Zweit-LLM
   die Grund-Zeile erzeugen laesst, geprueft/laengenbegrenzt/preisfrei durch
   `validOpeningLine()` (`src/elevenlabs/opening-line.js:114-125`, Deckel 120 Zeichen,
   `OPENING_LINE_MAX_CHARS`). Fail-closed-Treppe bei LLM-Ausfall/Rotprobe:
   Stufe 2 `bridgedObjective()` (wortgleich der alte Bruecken-Satz), Stufe 3
   `locale.openingReasonFallback` (feste Kurzzeile je Sprache) —
   `src/elevenlabs/opening-line.js:142-202`.
   Das Ergebnis wird `createCall()` als `call.openingLine` + `call.openingLineSha256`
   mitgegeben (`src/routes/api-calls.js:245`, Hash-Feld in `src/db/schema.sql:220-221`).

3. **Hash-Gegenprobe beim tatsaechlichen Anrufstart**: `verifiedOpeningLine()`
   (`src/elevenlabs/opening-line.js:185-202`) rechnet `openingLineHash(openingLine)`
   nach; stimmt der Hash nicht mehr (Manipulation zwischen Annahme und Anruf), greift
   der deterministische Rueckfall — die veraenderte Zeile wird NIE gesprochen.

4. **Statischer Rahmen beim Anbieter**: `elevenlabs/agent_configs/outbound-agent.template.json`
   Zeile 717 (`first_message`, Basissprache EN) und Zeilen 758/765
   (`language_presets.de/fr`, Feld `language_presets_offenlegung`, art `texte`):
   ```
   "Hello, this is an AI assistant calling on behalf of {{owner_name}}. This conversation
   will be summarised for the person I represent. {{opening_line}}"
   ```
   Seit GQ-E1 (`a687f5e`) endet der statische Text **mit** der Variablen `{{opening_line}}`
   — dahinter steht am Anbieter kein Text mehr. Die feste Abschlussfrage
   (`locale.openingQuestion`) reist seit GQ-E1 IM WERT: `composedOpeningLine()`
   (`src/elevenlabs/opening-line.js:168-170`) haengt sie nur an, wenn die Grund-Zeile
   nicht schon selbst mit `?` endet.
   Die EINE Quelle des Wortlauts, gegen die Vorlage und Presets gemessen werden, ist
   `providerOpeningFor()` in `src/elevenlabs/call-locale.js:76-94`
   (`providerOpening = [locale.disclosure(ownerName), "{{opening_line}}"].join(" ")`).

5. **Anruf-Zeit-Bindung**: `src/elevenlabs/convai.js` (`dynamicVariables()`, Zeilen ~102-119)
   setzt `opening_line: verifiedOpeningLine({ call, locale })` und
   `owner_name: alsText(ownerName) || locale.disclosureOwnerFallback` (nie leer — der
   Traeger der Pflichtoffenlegung haengt nie an einer Variable ohne Default).

**Was STATISCH beim Anbieter steht (Offenlegungsteil) vs. was pro Anruf reist:**
- Statisch (Vorlage, `first_message`/`language_presets_offenlegung`): der komplette
  Offenlegungssatz WOERTLICH je Sprache, byte-identisch aus `LOCALES.<lang>.disclosure`
  uebernommen (nur `${ownerName}` -> `{{owner_name}}`) — s. Test T5(c)/(e) unten. Der
  Offenlegungssatz selbst ist NICHT Teil der Variablen, er ist Text VOR ihr.
  `{{owner_name}}` ist ebenfalls Teil des statischen Rahmens (Anbieter setzt ihn ein).
- Pro Anruf variabel: nur `{{opening_line}}` (Grund + ggf. Abschlussfrage) und
  `{{owner_name}}` als Wert (nicht der Rahmen selbst).

**Offener Befund (nicht Gegenstand dieser Aufgabe, aber relevant fuer den Planer):**
`tasks/gq-chain-state.md:1636-1639` — im ersten Live-Testanruf nach dem Cutover
(`call_mt18soytibps`, 2026-08-20) wiederholte der Agent mitten im Gespraech einen Teil
des Offenlegungssatzes ("Das Gespraech wird fuer meinen Auftraggeber zusammengefasst.").
Wurzel unklar, nicht diagnostiziert.

## 2. Per-Call-Override der first_message — heute moeglich? Was waere noetig?

**Heute NICHT moeglich, mehrfach abgesichert (Verteidigung in Tiefe, drei unabhaengige
Schichten):**

**Schicht A — unser Code baut gar kein first_message-Override.**
`src/elevenlabs/convai.js#dynamicVariables` und `#startCallBody` (~Zeile 780-845) setzen
nur `conversation_config_override: { agent: { language }, tts: { voice_id } }`
(`conversationConfigOverride()`, `src/elevenlabs/outbound.js:797-803`). Es gibt keinen
Parameter/Pfad, der `agent.first_message` fuellt.

**Schicht B — fail-closed Whitelist im Code, VOR jedem Netzzugriff.**
`src/elevenlabs/convai.js:84-122` (`OVERRIDE_ALLOWED_LEAF_PATHS = ["agent.language",
"tts.voice_id"]`, `assertOverrideWhitelisted()`). Wird von `startOutboundCall()`
(`convai.js:185`) vor jedem POST aufgerufen. Ein Override-Objekt mit `agent.first_message`
wuerde NICHT still gefiltert, sondern der GESAMTE Anrufstart abgebrochen (Wurf, kein
Netzzugriff) — belegt durch `test/elevenlabs-override-whitelist.test.js` ("EL-OVERRIDE
ROTPROBE: ein DRITTES Feld im Override-Objekt wird abgelehnt, kein Netzaufruf").

**Schicht C — die eigene Erlaubnis-Karte des ElevenLabs-Agenten verbietet es ohnehin.**
`elevenlabs/agent_configs/outbound-agent.template.json:898-900`:
```
"agent": { "first_message": false, "language": true, ... }
```
Das ist die SOLL-Erlaubnisliste des Anbieters selbst
(`platform_settings.overrides.conversation_config_override`): `first_message: false`
heisst, ein Override dieses Pfads wird vom Anbieter still ignoriert — selbst wenn Schicht
A+B umgangen wuerden, kaeme kein Effekt an ("the conversation continues and the keywords
are ignored (no error)", zitiert im Kommentar `elevenlabs/agent_configs/
outbound-agent.template.json:778`). Bewacht von
`test/elevenlabs-anrufstart.test.js` T5(f) + Drift-Waechter (`npm run elevenlabs:drift`).

**Was waere noetig, um EINEN Anruf ohne Offenlegung eroeffnen zu lassen, waehrend alle
anderen unveraendert bleiben (rein aus Code/Doku abgeleitet, NICHTS ausgefuehrt):**

Ein Override-Weg scheidet strukturell aus (Schicht C macht ihn wirkungslos, selbst wenn
A+B durchbrochen wuerden — first_message wird beim Verbindungsaufbau gesprochen, BEVOR
irgendein Modell-Turn oder eine Laufzeit-Uebersteuerung greifen kann, s.
Vorlagen-Kommentar `_first_message_hinweis`). Der einzige technisch wirksame Weg waere
ein **zweiter ElevenLabs-Agent** mit eigenem `first_message` ohne Offenlegungssatz, dazu:

1. Ein zweiter provisionierter Agent bei ElevenLabs (eigene `agent_id`), dessen
   `first_message` KEINEN Offenlegungssatz traegt — ein bewusster manueller Schritt beim
   Anbieter, nicht Code.
2. Code-Aenderung: `el.agentId` kommt heute AUSSCHLIESSLICH aus einer globalen,
   call-unabhaengigen Config (`config.voice.elevenLabsOutbound.agentId`,
   `ELEVENLABS_AGENT_ID`-Env, gelesen in `src/elevenlabs/outbound.js:1227`
   `const el = settings()` -> `startCallBody({ el, ... })` -> `agent_id: el.agentId`,
   `src/elevenlabs/outbound.js:830`). Es gibt HEUTE keine Per-Call- oder Per-Tenant-Wahl
   des Agenten. Diese muesste neu gebaut werden (z.B. ein Feld am Call-/Tenant-Datensatz),
   inklusive der Frage, wer sie setzen darf.
3. Diese Aenderung liefe der Absoluten Regel 2 (CLAUDE.md: "kein KI-Ermessen, kein
   Setting, das ihn abschaltet") direkt zuwider und braeuchte eine explizite
   Owner-Entscheidung, keine stille Implementierung.

Kurz: der Code ist heute so gebaut, dass ein "ruhiger" Einzelfall-Bypass NICHT durch
einen simplen Parameter erreichbar ist — es braucht einen zweiten Agenten (Anbieterseite)
UND eine neue Auswahllogik (Code), beides sichtbare, absichtliche Aenderungen.

## 3. Andere Pfade — welche koennen heute ueberhaupt outbound fahren, unter welchem Flag

Verzweigung in `src/routes/api-calls.js` (~Zeile 283-330), IMMER HINTER der vollstaendigen
Outbound-Gate-Kette (Regel 1):

```
if (config.voice.elevenLabsOutbound.enabled)              -> ElevenLabs-Convai-Weg (Abschnitt 1)
else if (config.telnyx.telnyxAssistant.enabled
         && providerSupports(provider, AI_ASSISTANT))      -> C-Telnyx Call-Control-Assistant
else                                                        -> TeXML/Budget-Engine (Telnyx-Gather/Say)
```

- **ElevenLabs-Convai** (`ELEVENLABS_OUTBOUND_ENABLED`): Default `false` in
  `.env.example:127` und `render.yaml:103` (Kommentar: "Erst nach angelegtem Agenten +
  registrierter Nummer im Dashboard scharfstellen"). Render-Wert ist `sync: false` —
  Dashboard-verwaltet, render.yaml ist NICHT die Quelle der Wahrheit fuer den Live-Wert
  (Memory `deploy-repo-split`). **Annahme, gestuetzt durch `tasks/gq-chain-state.md:1610-1641`
  und den juengsten Merge-Commit** ("Live-Schaltung GQ-E1/B1/B2 vollzogen"): der Schalter
  steht seit 2026-08-20 production-seitig auf `true`, belegt durch einen echten
  Testanruf (`call_mt18soytibps`). Das ist NICHT direkt aus einer Repo-Datei ablesbar
  (Dashboard-Wert), sondern aus Kettenstand + Commit-Historie erschlossen.
- **C-Telnyx Call-Control-Assistant** (`TELNYX_AI_ASSISTANT_ENABLED`): Default `false`
  (`.env.example:152`, `render.yaml:116`), ebenfalls `sync: false` im Blueprint. Memory
  `assistant-path-kept-real-costs.md` (2026-07-21) hielt fest, dass dieser Pfad damals
  live JEDEN Outbound-Call trug — aelter als die GQ-E1/B1/B2-Live-Schaltung. Da der
  ElevenLabs-Zweig im `if/else if` PRIORITAET hat, ist der aktuelle Live-Zustand dieses
  Flags fuer den tatsaechlich gefahrenen Pfad heute irrelevant, SOLANGE
  `ELEVENLABS_OUTBOUND_ENABLED=true` bleibt — beide koennten parallel `true` sein, ohne
  dass es einen Unterschied macht, weil die ElevenLabs-Bedingung zuerst greift.
  Dieser Pfad spricht `openingText(call)` (Disclosure + Bruecke, `src/claude.js:425-431`)
  als eigenen, deterministischen "Opening-Speak-Node" VOR `ai_assistant_start`
  (`src/telnyx-call-control-ingest.js:202-228`, Kommentar Zeile 231: "Regel 2:
  ai_assistant_start NUR als Reaktion auf das speak.ended des Disclosure-Nodes").
- **TeXML/Budget-Engine** (kein Flag, der Default-Zweig): `/voice/outbound`-Webhook,
  `src/routes/voice.js:443-497`, ruft `openingText(call)` (`src/claude.js:425-431`) und
  rendert sie deterministisch, LLM-frei, als `<Say>`-Praefix IM `<Gather>`
  (`src/telephony/adapters/telnyx/render.js`). Dies ist der bislang am laengsten
  etablierte, mit den meisten Regressionstests gepinnte Pfad (Abschnitt 4).
- **Realtime-Engine** (`VOICE_ENGINE=realtime`, `src/config.js:211/1754`, Default
  `budget`): eigener Opener-Pfad in `src/bridge.js:222-227`
  (`loc.realtimeOpener.outbound(disclosureSentence(call))`), nutzt DIESELBE
  `disclosureSentence()` aus `claude.js`. Memory (`telnyx-budget-stt-bugfix`,
  `voice-stack-strategy`) haelt fest, dass Realtime am Telnyx-Provider produktiv
  BLOCKIERT ist ("owner-blockiert") — dieser Zweig ist Code-vorhanden, aber nicht der
  Live-Pfad.

Alle drei/vier Zweige teilen sich dieselbe vorgelagerte Gate-Kette
(`src/telephony/outbound-gates.js`), insbesondere das Identitaets-Gate (Zeile 623-631:
kein Outbound ohne registrierten `tenant.ownerName` — der Traeger der Offenlegung).

## 4. Tests/Riegel — was wird ROT, wenn ein Owner-Anruf ohne Offenlegung eroeffnet

Direkt disclosure-pinnende Tests je Pfad (Outbound):

**Budget-Engine / TeXML (`openingText`/`disclosureSentence`):**
- `test/disclosure-outbound.test.js` — "`/voice/outbound` rendert Offenlegung als
  Say-Praefix im Gather (Regel 2, LLM-frei G2)" + "LAW-03 (gruen, Wiring-Regressionspin):
  ... die EN-Offenlegung als Say-Praefix" — prueft `twiml.indexOf(SAY_OPEN +
  DISCLOSURE_PREFIX)`.
- `test/disclosure-regression.test.js` — "T-P2-09: disclosureSentence - fester Wortlaut +
  Tenant-ownerName (callerName ignoriert, G1)"; "P10-S1-1: disclosureSentence ohne
  language faellt auf DEFAULT_LANGUAGE zurueck"; "T-P2-10: Outbound-Prompt weist das LLM
  an, die Offenlegung NICHT zu wiederholen".
- `test/g1-identity-binding.test.js` — "callerName-Override wirkungslos: Disclosure
  bindet an tenant.ownerName"; "Offenlegung rendert nie '...von .' (kein leerer Name)";
  "/voice/outbound rendert die Offenlegung mit registriertem ownerName im Gather".
- `test/claude-identity.test.js` — "disclosureSentence ohne callerName folgt B's
  ownerName"; "disclosureSentence Owner-Call nennt den geseedeten Owner-ownerName";
  "callerName wird ignoriert - Tenant-ownerName bindet (G1)".
- `test/g2-opening-turn.test.js` — "G2 (<provider>): Offenlegung vor Anliegen, EIN Say
  im Gather, kein Hangup" (parametrisiert je Provider); "G2: leeres Anliegen -> nur
  Offenlegung, kein Bruecken-Artefakt".
- `test/al-p5-opening.test.js` — "AL-P5-1 gekappte Eroeffnung benennt in de/fr/en weiter
  den Zweck des Anrufs" (haengt indirekt an der Offenlegungslaenge als Budget-Anteil).

**C-Telnyx Call-Control-Assistant (`openingText` als Disclosure-Node):**
- `test/telnyx-p8-opening-contract.test.js` — "stab-p8: goal gesetzt -> onAnswered spricht
  Offenlegung + Anliegen (openingText)"; "stab-p8 (Regel 2): Offenlegung byte-identisch
  erster Satz - goal-gesetzt UND goal-leer"; "stab-p8: leeres goal -> Speak-Text
  byte-identisch zum Status quo (== disclosureSentence)".

**ElevenLabs-Convai (`providerOpeningFor`/Vorlage/Presets):**
- `test/elevenlabs-anrufstart.test.js` — "EL-START T5 (c, Mechanismus, gruen): first_message
  der Agenten-Vorlage ist byte-identisch die Eroeffnung aus dem Code, und sie BEGINNT mit
  dem Offenlegungssatz" (`assert.ok(agent.first_message.startsWith(LOCALES.en.disclosure(...)))`
  — DER Art.-50-Riegel fuer den EN-Basissatz); "EL-START T5 (e, Mechanismus, gruen): jede
  Sprache mit kuratiertem Offenlegungssatz hat ein Preset mit GENAU diesem Satz" (dieselbe
  `startsWith`-Zusage je DE/FR-Preset); "GQ-E1-05: der statische Rahmen endet mit der
  Variablen"; "EL-START T5 (d): der Offenlegungssatz haengt an keiner Variablen ohne
  Default - blanker Auftraggeber-Name, Satz bleibt vollstaendig"; "EL-START T5 (f,
  Mechanismus): die Offenlegung ist gegen Unterbrechung gesichert - SOLL in der Vorlage
  UND vom Drift-Waechter bewacht" (`disable_first_message_interruptions`); "EL-START T5
  (a): der Anrufstart uebergibt owner_name und uebersteuert first_message NICHT"; "EL-START
  T5 (b): ohne registrierten Auftraggeber-Namen wird gar nicht erst gewaehlt".
- `test/elevenlabs-sprachwahl.test.js` — "[abgenommen G2] der ElevenLabs-Anrufstart
  spricht die Sprache des Nutzers - Deutsch mit deutscher Stimme und deutschem
  Offenlegungssatz..., Englisch fuer jeden ohne gesetzte Sprache"; "Bestandspfad
  Sprachwahl: Herkunft und Spracheinstellung ... bestimmen Sprache, Stimme und
  Offenlegungssatz"; "Sprachwahl EL: die Sprache des ANGERUFENEN gewinnt".
- `test/elevenlabs-override-whitelist.test.js` — "EL-OVERRIDE ROTPROBE: ein DRITTES Feld
  im Override-Objekt wird abgelehnt, kein Netzaufruf" (der direkte Riegel gegen einen
  first_message-Override-Versuch im Code); "EL-OVERRIDE TEIL 3: die Code-Whitelist und
  die Besitz-Karte der Vorlage nennen exakt dieselben zwei Pfade" (haelt Code- und
  Vorlagen-Whitelist synchron).
- `test/el-opening-line.test.js` — "validOpeningLine: Rotprobe Offenlegungs-Wiederholung
  (A3), alle drei Sprachen" (verhindert, dass die Grund-Zeile den Offenlegungs-Kern
  wiederholt/verwaesserst).
- `test/elevenlabs-drift-rotprobe.test.js` — Drift-Waechter-Suite (mehrere `describe`-
  Bloecke), haelt `first_message`/Presets/`disable_first_message_interruptions` gegen
  den LIVE-Agenten fest — bewacht die Anbieter-SEITE, nicht nur die Vorlage im Repo.
- `test/el-vorlage-variablen-abgleich.test.js` — "EL-VORLAGE-VARIABLEN: Platzhalter der
  Vorlage und gesendete dynamic_variables sind deckungsgleich" — faengt indirekt jede
  neue, unbedachte Variable (z.B. ein still eingefuehrtes `first_message_override`).

**Ausdruecklich NICHT outbound / nicht Gegenstand dieser Kartierung, aber
namensverwandt** (zur Abgrenzung genannt, damit niemand sie als Outbound-Beleg
missversteht): `test/inbound-disclosure-mandatory.test.js` (Inbound-Pflichtsatz, anderer
Mechanismus) und `test/legal-content.test.js` (rechtliche Website-Inhalte, keine
Anruf-Offenlegung).

Kein i18n-Launch-Testkatalog-Test (`PROMPT-*`-Praefix) wurde gefunden, der die
Anruf-Offenlegung direkt bindet — die Riegel liegen in den regulaeren `npm test`-Dateien
oben (regressionsscharf, nicht im `test:gates`-Katalog).

## Kernaussagen fuer den Planer

- Der Offenlegungssatz ist auf JEDEM der vier Outbound-Wege (TeXML/Budget, C-Telnyx,
  ElevenLabs-Convai, Realtime) byte-identisch aus `LOCALES.<lang>.disclosure` gezogen —
  KEIN Pfad generiert ihn selbst oder uebersetzt ihn neu.
- Auf dem ElevenLabs-Weg (aktuell der produktive Pfad, seit 2026-08-20) ist der
  Offenlegungssatz Teil des STATISCHEN Anbieter-Textes (`first_message`/
  `language_presets_offenlegung`); nur die Grund-Zeile dahinter (`{{opening_line}}`) ist
  pro Anruf variabel — der Rahmen endet seit GQ-E1 mit der Variablen, kein Text mehr
  dahinter.
- Ein Per-Call-Bypass der Offenlegung ist HEUTE durch drei unabhaengige Schichten
  verhindert: (A) unser Code baut keinen `first_message`-Override, (B) eine fail-closed
  Code-Whitelist (`OVERRIDE_ALLOWED_LEAF_PATHS`) liesse ihn selbst dann nicht durch, (C)
  die Erlaubnis-Karte am ElevenLabs-Agenten selbst hat `agent.first_message: false` —
  ein durchgereichter Override waere dort wirkungslos, nicht nur bei uns blockiert.
- Ein wirksamer Bypass fuer genau einen Anruf braeuchte einen ZWEITEN, separat
  provisionierten ElevenLabs-Agenten OHNE Offenlegung plus eine neue, heute nicht
  existierende Per-Call/Per-Tenant-Agentenwahl im Code (`el.agentId` ist heute global,
  eine Konstante aus `ELEVENLABS_AGENT_ID`) — beides sichtbare, absichtliche Aenderungen,
  keine stille Konfiguration.
- Der `ELEVENLABS_OUTBOUND_ENABLED`-Schalter ist per `render.yaml` `sync:false` —
  sein Live-Wert steht NICHT im Repo, sondern im Render-Dashboard; der Live-Status
  "an seit 2026-08-20" ist aus `tasks/gq-chain-state.md` + Commit-Historie erschlossen,
  nicht direkt aus einer Repo-Datei belegbar.
- Die Engine-Wahl fuer Outbound ist ein `if/else if/else` in `routes/api-calls.js`:
  ElevenLabs hat Prioritaet vor C-Telnyx vor TeXML — ein zweites aktives Flag
  (`TELNYX_AI_ASSISTANT_ENABLED`) aendert am gefahrenen Pfad nichts, solange ElevenLabs
  an ist.
- Alle Engines haengen am selben Identitaets-Gate (`outbound-gates.js`): kein Outbound
  ohne registrierten `tenant.ownerName` — der Name, den die Offenlegung nennt, existiert
  also nie leer.
- Rund 20 Tests in `test/*.test.js` pinnen die Offenlegung ueber alle Wege hinweg direkt
  per `startsWith`/exaktem Wortlautvergleich; der staerkste Einzelriegel gegen einen
  first_message-Override ist `elevenlabs-override-whitelist.test.js` ("EL-OVERRIDE
  ROTPROBE"), der schaerfste Anbieter-seitige Beleg `elevenlabs-anrufstart.test.js`
  T5(c)/(e)/(f) + der Drift-Waechter (`elevenlabs-drift-rotprobe.test.js`), der gegen den
  LIVE-Agenten misst, nicht nur gegen die Repo-Vorlage.
- Offener, nicht diagnostizierter Befund (nicht Teil dieser Kartierung, aber fuer den
  Planer relevant): erster Live-Testanruf nach dem GQ-E1/B1/B2-Cutover zeigt eine
  Wiederholung eines Offenlegungs-Fragments mitten im Gespraech
  (`tasks/gq-chain-state.md:1636-1639`).
