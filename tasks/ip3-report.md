# Phase IP3 — Zwei Selbst-Armierungen entfernen

- **Gate:** PASS
- **finalBranch:** `phase/ip3-relay-entfernen`
- **Basis:** `master` @ `de5171b`
- **headCommit (Impl):** `25585bf`

## Plan (gekuerzt)

Ziel: den ElevenLabs-LIVE-RELAY-Zweig am Telnyx-TeXML-`<Say>` entfernen (`src/telephony/adapters/telnyx/render.js`). Der Zweig war eine Selbstarmierung: sobald `TELNYX_ELEVENLABS_API_KEY_REF` und `TELNYX_ELEVENLABS_VOICE_ID` beide gesetzt waren, schaltete der Renderer ohne Flag und ohne Logzeile auf den Relay um — A/B-belegt defekt (unterdrueckt den Inbound-Audio-Track, Deepgram liefert ein leeres Transkript).

**Vorbedingung (blockierend geprueft):** IP2 (Hoerprobe-Skript) ist auf `master` nicht implementiert. Plan bot zwei Wege; gewaehlt wurde **Weg B — IP3 vorziehen**, mit Ersatz-Beweis ueber die umgekehrten Renderer-Tests statt der Hoerprobe.

Kernpunkte des Plans:
1. `opts.elevenLabs` wird am Renderer **inert** statt aktiv (kein Wurf, sieben Zustaende getestet inkl. Vollzustand).
2. `sayVoiceAttrs`, `elevenLabsVoiceNameFor` und die Registry-Injektion entfallen ersatzlos (toter Code, G9).
3. Drei ueberlebende Konsumenten von `telnyxElevenLabs` bleiben unveraendert: `src/elevenlabs/outbound.js`, `src/telephony/adapters/telnyx/voice.js` (Call-Control-speak), `scripts/telnyx-assistant-provision.mjs`.
4. `VOICE-12` (Katalogtest, Cluster D20) zieht mit Kennung und Owner-IDs auf den ueberlebenden sprachaufgeloesten Pfad um (Play-TTS-Vorabsynthese, `src/tts/directive-synth.js`).
5. Ein Blueprint-Drift bei `TELNYX_INBOUND_HANDOFF_ENABLED` (`render.yaml` sagte `"true"`, Code-Default `false` seit dem 422-Befund vom 2026-08-04) wird geschlossen und mit einem neuen Riegel-Test (`test/env-docs-spend-cap-coherence.test.js`) gegen Rueckfall gesichert.
6. Commit-Schnitt: C1 (Relay entfernen + Tests umkehren), C2 (Blueprint-Kohaerenz + Riegel), C3 (reine Kommentar-Korrekturen an Raendern, einzeln verwerfbar).
7. Deklarierte Abweichungen im Plan selbst: C3 fasst `src/config.js`/`voice.js` an (Plan-Auflage "nicht anfassen"), aber nur Prosa, keine Logik/Werte.

## Impl-Zusammenfassung

IP3 vollstaendig umgesetzt: der ElevenLabs-Relay-Zweig ist entfernt, `opts.elevenLabs` ist inert (sieben Zustaende inkl. Vollzustand getestet, kein Wurf). `sayVoiceAttrs`, `elevenLabsVoiceNameFor` und die Registry-Injektion sind entfallen; die drei ueberlebenden Konsumenten unveraendert. VOICE-12 mit Messpunkt auf Play-TTS-Vorabsynthese umgezogen, gruen wie zuvor. Blueprint-Drift bei `TELNYX_INBOUND_HANDOFF_ENABLED` gefunden und mit Riegel-Test geschlossen (vor dem Fix rot verifiziert). Eine vom Plan nicht erfasste E2E-Regression in `test/telnyx-elevenlabs-inbound.test.js` gefunden und behoben (Umkehrung statt Loeschung).

Vier Commits auf `phase/ip3-relay-entfernen` (Basis `master` @ `de5171b`).

- **nodeCheckPass:** true
- **testsPass:** true (5989 -> 5990 nach Merge-Gegenmessung, Delta +1)
- **smokePass:** true — Server lokal (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, json-Store), `/healthz` -> 200, `/voice/incoming` rendert live Azure-Stimme, kein ElevenLabs-Attribut.

### Geaenderte Dateien
`src/telephony/adapters/telnyx/render.js`, `src/telephony/adapters/telnyx/elevenlabs-voice.js`, `src/telephony/registry.js`, `src/tts/directive-synth.js`, `test/telnyx-elevenlabs-render.test.js`, `test/p9-voice-locale-source.test.js`, `test/directive-synth.test.js`, `test/telephony-registry.test.js`, `test/telnyx-call-control.test.js`, `eslint-suppressions.json`, `render.yaml`, `.env.example`, `test/env-docs-spend-cap-coherence.test.js`, `src/config.js`, `src/telephony/adapters/telnyx/voice.js`, `src/elevenlabs/outbound.js`, `test/telnyx-elevenlabs-inbound.test.js`. Keine neuen Dateien.

### Deviations (vom Impl-Bericht)
1. Vorbedingung (Plan Abschnitt 0): IP2 nicht implementiert. Weg B gewaehlt: IP3 vorgezogen, Ersatz-Beweis = umgekehrte Renderer-Tests + E2E-Test.
2. Plan-Luecke geschlossen: `test/telnyx-elevenlabs-inbound.test.js` stand nicht im Plan, bewies aber end-to-end denselben Relay-Zweig und schlug nach C1 in `npm test` fehl — eigener Commit `25585bf`.
3. Zusaetzlich zum Plan: `render.js` vollstaendig von Ein-Buchstaben-Identifiern und der `.replace`-Kette (G36) befreit, 2 Magic Numbers in `directive-synth.test.js` benannt — erzwungen durch das check-staged-suppressions-Gate.
4. C3 fasst `src/config.js` und `voice.js` an (Plan-Auflage "nicht anfassen") — als bewusste Abweichung im Plan selbst deklariert, nur Prosa geaendert.
5. Modulkopf-Text fuer `elevenlabs-voice.js` umformuliert, weil der Plan-Entwurf selbst die Zeichenkette `elevenLabsVoiceNameFor` enthielt, was der eigenen Abnahme-Probe widersprochen haette.

## Safety-Urteil

**approved: true** — alle Einzelkriterien true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended).

Unabhaengige Verifikation in frischem Worktree (Branch `review-ip3` auf `25585bf` gegen Baseline `master`/`de5171b`, selbst gefahren):

- **Regression:** `review-ip3` = 5990/5990 pass; `master` = 5989/5989 pass. Delta +1, kein Rueckgang.
- **Gates:** beide 129 Tests / 126 pass / 3 fail — identische drei Rotfaelle (GAP-05, GAP-15, E2E-03), ohne Bezug zu IP3. VOICE-12 gruen, jetzt in `directive-synth.test.js`.
- **Abnahme:** beide Baeume "13 von 14" identisch, `abnahme-ausgewandert.json` unveraendert (Regel D13 gehalten).
- **Isoliert nachgefahren** (gegen Flake-Maskierung), 97/97 gruen: telnyx-elevenlabs-render, p9-voice-locale-source, directive-synth, telephony-registry, telnyx-call-control, telnyx-elevenlabs-inbound, env-docs-spend-cap-coherence, route-auth-inventory, security.
- **Lint:** 0 errors, 68 Warnungen — alle in unberuehrten Bestandsdateien.
- **Eigene Differentialprobe** (nicht aus der Spec, selbst gebaut, danach entfernt): master- vs. IP3-`render.js`, 4960 Faelle + 4000 Fuzz auf den Escaper, 0 Abweichungen bei `hasElevenLabsVoice=false`. Gegenprobe mit vollstaendig gesetztem EL-Env: master rendert Relay, IP3 rendert Azure — genau der eine beabsichtigte Unterschied, kein Wurf.
- **Abnahme-Greps** der Spec selbst gefahren: `node --check` OK; `grep telnyxElevenLabs` liefert genau die drei erlaubten Dateien; `grep elevenLabsVoiceNameFor` in src/scripts/test leer.

Safety-Gates unangetastet: kein Gate-Modul im Diff (kein outbound-gates, state-ops, Budget/Denylist/Land-Gate/Stundenlimit/Max-Dauer, `OUTBOUND_FROZEN`). `render.yaml`-Flip `TELNYX_INBOUND_HANDOFF_ENABLED` "true"->"false" ist gate-positiv (bringt Blueprint auf Code-Default, verhindert Reaktivierung des belegt defekten 422-Pfads). Offenlegung (`src/claude.js`, `src/bridge.js`) nicht im Diff. Auth/Routen/Secrets nicht beruehrt.

### Concerns (keine Blocker)
- Spec-Buchstabe vs. Umsetzung: `src/config.js`/`voice.js` sind trotz "nicht anfassen"-Auflage im Diff — geprueft: nur Kommentarzeilen, keine ausfuehrbare Zeile.
- Unangefragtes Clean-Code-Extra in `render.js` (escapeXml-Umbau, Identifier-Umbenennung, Suppressions-Abbau) — Schulden-Abbau in richtiger Richtung, aber Scope-Extra ueber den Auftrag hinaus.
- `test/telnyx-elevenlabs-inbound.test.js` nicht in Spec-Dateiliste, Aenderung aber zwangslaeufig (E2E-Zusicherung umgekehrt und verschaerft, nicht geloescht).
- Abnahmekriterium `npm run inbound:hoerprobe` nicht fahrbar (IP2 nicht gemergt) — Ersatzbeleg selbst erbracht (Spawn-Test gegen echten Serverprozess). Lead soll Kettenreihenfolge IP2/IP3 pruefen.
- Live-Wirkung bewusst und richtig: falls TELNYX_ELEVENLABS_*-Envs live gesetzt sind, wechselt Inbound-Stimme von EL-Relay auf Azure — in jedem Zustand eine Verbesserung (Relay A/B-belegt defekt).
- Kleine Duplizierung: `readBoolCodeFallback` spiegelt bestehendes `readCodeFallback`-Muster; regexbasiert und formatabhaengig, aber wirft mit klarer Meldung statt still gruen zu werden.

## Clean-Code-Audit (S1–S4)

- **s1 (uebergangene Sicherung):** []
- **s2 (zweite Wahrheit / Duplikat):** []
- **s3:** []
- **s4:** []
- **blocker:** false

**Verdict: PASS.** Kein toter Code (`elevenLabsVoiceNameFor`/`sayVoiceAttrs` restlos weg, git-grep gegen Branch-Tree bestaetigt), alle Konsumenten konsistent nachgezogen, `node --check` gruen. Doku-Drift nicht nur behoben, sondern durch neuen Kohaerenz-Test dauerhaft abgesichert. Tests nicht geloescht, sondern zu Negativ-Beweisen umgebaut. VOICE-12 nachvollziehbar umgezogen statt verwaist. `eslint-suppressions.json` verliert Eintraege als Folge der Umbenennung (reine Aufraeumung, keine neuen Unterdrueckungen). Umbenennungen ohne Verhaltensaenderung; escapeXml-Umbau ist legitime, klar kommentierte G36-Vereinfachung mit identischer Semantik. Keine Safety-Gate-, Auth- oder Secrets-Beruehrung ausser der dokumentierten, testgepinnten `render.yaml`-Owner-Entscheidung.

topTodos: []

## Fix-Runden

Keine — Gate wurde im ersten Review-Durchlauf PASS (Safety approved, Clean-Code PASS ohne Blocker). Keine Nacharbeit noetig.
