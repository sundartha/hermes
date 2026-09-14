# Spec IE6-S1 (Lead, 2026-09-14)

Diese Datei hat fuer diesen Lauf VORRANG vor `PLAN-INBOUND-PARITAET.md`. Rahmen dort:
Abschnitt 2.5 (warum K4 entfernt wird, Fussnote (b)-Stimme), 2.6 Punkt 1, 3 (Pre-Mortem Q5
und Q7), 5 (Clean-Code-Auflagen) und "Phase IE6" Stufe 1. Andere Phasen/Stufen sind NICHT
der Auftrag.

## Phase IE6-S1 - Den Telnyx-AI-Assistant (das dritte Gehirn) ersatzlos entfernen

### Freigabe und Abgrenzung zur Plan-Abhaengigkeit

Der Plan knuepft IE6 an "IE5 live und bewaehrt". Diese Bedingung gilt fuer **Stufe 3**
(Budget-Engine). Stufe 1 entfernt einen Pfad, der nicht das Ziel ist und keinen Anruf
fuehrt, der nicht auch ohne ihn gefuehrt wuerde; sie haengt fachlich weder an IE1 noch an
IE5. Der Owner hat am 2026-09-13 ausdruecklich angeordnet, dass die ueberzaehligen Engines
entfernt werden (Owner-Entscheidung O8 damit erteilt). Stufe 2 und Stufe 3 sind NICHT Teil
dieses Laufs.

### Am 2026-09-13/14 gemessener Live-Stand (Render-Boot-Banner, nicht render.yaml)

- `Assistant-Pfad: AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)` — **der Master-Schalter ist
  live AN**, entgegen der Beschreibung "Schalter aus" im Kickoff.
- `Inbound-Handoff: aus (TELNYX_INBOUND_HANDOFF_ENABLED=false)`; jeder Inbound loggt
  `inbound_path {"path":"budget","reason":"handoff_disabled"}`.
- `Voice-Engine: budget`. Outbound laeuft ueber ElevenLabs: in `src/routes/api-calls.js`
  steht der `config.voice.elevenLabsOutbound.enabled`-Zweig VOR dem
  `telnyxAssistant.enabled`-Zweig. Der Assistant ist live also ein **scharf geschalteter,
  aber ruhender Outbound-Rueckfall** (greift nur, wenn jemand den EL-Schalter abdreht) und
  haelt den Shim-Endpunkt (`src/telnyx-llm-shim.js`, sonst 404) offen.
- `Pro-Call-Transkription: AKTIV (TELNYX_PER_CALL_TRANSCRIPTION_ENABLED=true)` — laut Banner
  nur fuer den Call-Control-Body des Assistant-Pfads relevant; pruefen, ob es weitere Leser gibt.

**Verhaltensfolge, bewusst akzeptiert:** nach dieser Stufe faellt Outbound bei abgedrehtem
EL-Schalter auf den bestehenden TeXML-Zweig (heutiger `else`-Zweig) statt auf den
Assistant. Bei heutiger Live-Konfiguration (EL an) aendert sich an keinem Anruf etwas. Der
Shim-Endpunkt antwortet danach unabhaengig von Env-Werten nicht mehr (Angriffsflaeche weg).

### Scope

Entfernen, ersatzlos, nicht per Flag abschalten:

1. Der Assistant-Inbound-Handoff und der Assistant-Outbound-Zweig: `src/telnyx-inbound.js`
   (soweit assistant-spezifisch), `src/telnyx-llm-shim.js`, `src/telnyx-conversation-watchdog.js`,
   `scripts/telnyx-assistant-provision.mjs`, `originateAiAssistantCall` samt dem
   `else if (config.telnyx.telnyxAssistant.enabled ...)`-Zweig in `src/routes/api-calls.js`,
   der Handoff-Aufruf in `src/routes/voice.js`, `KOSTENPROFIL.TELNYX_ASSISTANT` samt
   Registry-/Tarifpaar-Zeile, `CAPABILITY.AI_ASSISTANT`, soweit nur dieser Pfad sie traegt.
2. Die Schalter und ihre Boot-Pflichten: `TELNYX_AI_ASSISTANT_ENABLED`,
   `TELNYX_INBOUND_HANDOFF_ENABLED`, `TELNYX_ASSISTANT_ID`, `TELNYX_CALL_CONTROL_APP_ID`,
   `TELNYX_PER_CALL_TRANSCRIPTION_ENABLED` und weitere, **sofern** nach Konsumenten-Zaehlung
   je Funktion nur der Assistant-Pfad sie liest — in `src/config.js`, `.env.example`,
   `render.yaml`, `src/boot.js` (Banner-Zeilen), `src/boot-guard.js` (Befunde) und
   `test/helpers.js#BASE_ENV`.
3. Call-Control-Mechanik, die NUR der Assistant benutzt (z.B. `/voice/call-control`-Route,
   `originateViaCallControl`, `endCallViaCallControl`, der `callControlId`-Zweig in
   `hangUpAction`, Call-Control-Event-Adapter) — **nur**, wenn die Zaehlung belegt, dass es
   ausserhalb des Assistant-Pfads keinen lebenden Leser gibt. Im Zweifel stehen lassen und
   im Bericht als offene Frage benennen, NICHT raten.
4. `config.telnyx.telnyxElevenLabs`: auf seine ueberlebenden Leser zurueckschneiden, nicht
   loeschen. Belegt ueberlebt `src/elevenlabs/outbound.js#callLocaleOf` (liest den
   `defaultVoiceId`). `speakVoiceFields`, `assistantVoiceConfigured` und der Provisioner
   sterben mit dieser Stufe. Modulkopf-Kommentare nachziehen.
5. Kommentare, Modulkoepfe und Doku-Verweise in `src/`, die den Assistant als lebende Naht
   beschreiben, entfernen bzw. auf den Ist-Stand ziehen.

**Die Inbound-Sonde:** `logInboundPathDecision` und die Logzeile `inbound_path` sind das
Betriebssignal, das Kickoff, Hoerprobe und IE5 benutzen. Bleibt ein Leser (voice.js,
`scripts/inbound-hoerprobe.mjs`), bleibt die Sonde — ohne die assistant-spezifischen
Grund-Tokens. Dann ggf. in eine passend benannte Datei umziehen, wenn `telnyx-inbound.js`
sonst nur noch die Sonde enthielte. Entscheidung am Katalog (G9: kein Export ohne
Konsumenten; G5: kein zweiter Namensvorrat), im Bericht begruenden.

### NICHT-Scope

- Keine Stufe 2 (OpenAI-Realtime-Bridge, `src/bridge.js`, `VOICE_ENGINE=realtime`) und keine
  Stufe 3 (Budget-Engine, `/voice/turn`). Kein IE5-Code.
- Kein Entfernen oder Aufweichen einer Sicherung: Ed25519-Signatur, Wiederholungs-Riegel,
  Tenant-Aufloesung, Kostendecke (beide Richtungen), Max-Dauer, Offenlegung, Outbound-Gates,
  `OUTBOUND_FROZEN`, `MAX_NUMBERS*`. Reihenfolge in `/voice/incoming` unveraendert.
- Keine Aenderung an `ELEVENLABS_VOICE_ID_BY_PROFILE`, am Outbound-Anfragekoerper
  (`startCallBody`, `conversationConfigOverride`), an der Nummern-Registrierung, an
  `src/telephony/ports.js`/`registry.js` als Abstraktion, an `src/route-policy.js` ausser
  dem Streichen eines Eintrags fuer eine entfernte Route (dann `test/route-auth-inventory.test.js`
  gruen halten).
- Kein Loeschen eines Katalog- (`GAP-`, `PROMPT-`, ...) oder Abnahmetests (`ABNAHME-`,
  `[abgenommen ...]`). Misst ein solcher Test eine Zusicherung am Assistant-Pfad, zieht er
  mit Kennung und Bank an den ueberlebenden Pfad um; ist die Zusicherung dort
  gegenstandslos, im Bericht namentlich begruenden. Die Zahl der Eintraege in
  `test/abnahme-ausgewandert.json` sinkt nicht (Regel D13).
- Keine Live-Aenderung: kein Render-Env, kein Telnyx-/ElevenLabs-Aufruf, kein Deploy.

### Invarianten (byte-identisch)

- Bei der heutigen Live-Konfiguration (EL-Outbound an, Handoff aus, Engine budget) liefert
  `/voice/incoming` byte-identisches TeXML, und der EL-Outbound-Anfragekoerper ist
  byte-identisch (bestehende Snapshot-Tests gruen, nicht angepasst).
- Die sieben Inbound-Sicherungen laufen unveraendert in unveraenderter Reihenfolge.
- Kein Export ohne Konsumenten, kein auskommentierter Code, kein abgeschalteter Rest-Pfad.

### Abnahmekriterium

```
grep -rln "telnyx-llm-shim\|telnyxLlmShim\|TELNYX_AI_ASSISTANT_ENABLED\|TELNYX_INBOUND_HANDOFF_ENABLED\|originateAiAssistantCall\|TELNYX_ASSISTANT\b\|conversation-watchdog" src scripts test render.yaml .env.example
NODE_ENV=test node test/testbaenke-run.mjs regression --test-concurrency=4
node --check <jede geaenderte .js-Datei>
```
Erwartet: der grep nennt keine Datei mehr (oder nur Tests, die das NICHT-mehr-Erreichbar-Sein
beweisen, namentlich im Bericht); die Regression-Bank gruen, die Testzahl nur um die Tests
der entfernten Pfade gesunken, diese namentlich im Bericht.

**Testbank-Hinweis:** `npm test` ohne Concurrency-Limit flaked auf dieser Maschine
(Bestandsverhalten). Immer mit `--test-concurrency=4` fahren. Waehrend der Arbeit gezielte
Testdateien; die volle Bank einmal am Ende der Umsetzung.

### Testpflicht

- **Neu:** der entfernte Weg ist nicht mehr erreichbar, nicht nur abgeschaltet — z.B.
  Server mit `TELNYX_AI_ASSISTANT_ENABLED=true` in der Env: der ehemalige Shim-Endpunkt
  antwortet nicht mehr mit einem Gespraechsbeitrag, und ein Outbound mit EL-Schalter aus
  originiert NICHT ueber Call Control (faellt auf den TeXML-Zweig).
- **Bestand:** Signatur-, Route-Auth-, Budget-, Kostenarten-, Offenlegungs- und
  Outbound-Snapshot-Tests bleiben gruen, ohne Anpassung ihrer Erwartung.

### Risiko + Rueckfall

Risiko: zu viel entfernt (Q7) — ein Leser ausserhalb des Assistant-Pfads hing an einer
entfernten Funktion. Gegenmittel: Konsumenten JE FUNKTION zaehlen, nie je Modul; im Zweifel
stehen lassen und benennen. Rueckfall: `git revert` des Commits; kein Schema, kein
Datenzustand. Render-Env-Werte fuer entfernte Schalter bleiben stehen und sind danach
wirkungslos — das ist harmlos und wird im Bericht als Aufraeum-Punkt fuer den Owner genannt.
