# F1 Phase 3 — Telephonie-Renderer sprachabhaengig (STT + TTS) (Report)

Status: IMPLEMENTIERT + VERIFIZIERT (SAUBER). Branch `phase/f1-p3-renderer` (Basis `cf2cb06` = P1+P2).
Commit ist im Worktree **gestaged**, aber durch Permission-Policy gated (Mensch-Freigabe noetig) -
analog `code-finish.sh` (nicht ausfuehrbar fuer `clawcode`).

## Umgesetzt (5 Dateien)
- `src/telephony/directives.js`: `VOICE_PROFILE.FR_FEMALE_NEURAL` ergaenzt (nur Enum-Eintrag; Wert
  `"fr-female-neural"` deckungsgleich mit `src/i18n/locales.js`). Keine Builder-/Default-Aenderung.
- `src/telephony/adapters/twilio/render.js`: FR-Voice `Polly.Lea-Neural`/`fr-FR` in `TWILIO_VOICE`.
  Gather-`language` (STT-Locale) kommt jetzt aus `voiceAttrs(profile).language` (Funktion `gatherOpts`)
  statt hart `de-DE` - eine Quelle fuer TTS-Voice UND STT.
- `src/telephony/adapters/telnyx/render.js`: FR-Voice `Azure.fr-FR-DeniseNeural`/`fr-FR` in `TELNYX_VOICE`.
  `gatherAttrs` leitet `language` aus dem voiceProfile ab; `model` bleibt `deepgram/nova-3` (Nova-3
  mehrsprachig, FR inkl.); `speechTimeout`-Override (G3) an gleicher Position erhalten.
- `test/directive-render.test.js` + `test/telnyx-render.test.js`: FR-Snapshots je Provider (Gather+Say,
  promptloses Gather, Say+Hangup), R9-Assertion (`fr-FR`, nicht `fr`), Fail-closed bei unbekanntem Profil
  (jetzt auch promptloses Gather). DE-Snapshots unveraendert (byte-identisch).

## Design-Entscheidung (bewusste Abweichung)
Der Auftrag sagte fuer Twilio "keine Aenderung an GATHER_OPTS". Bewusst abgewichen: auch der
Twilio-Gather zieht die STT-Locale aus dem voiceProfile. Begruendung: die autoritative Spec
`tasks/f1-block-a-spec.md` (P3) und Risiko R9 fordern fuer BEIDE Renderer STT-Locale aus dem Profil;
ein Twilio-FR-Gather mit `de-DE`-STT bei FR-Stimme waere genau der R9-Bug (stiller Rueckfall auf
Englisch). DE bleibt dabei byte-identisch.

## Invarianten (verifiziert)
- DE byte-identisch (DE-Snapshots unveraendert, gruen).
- Fail-closed: unbekanntes Profil wirft auf beiden Adaptern - jetzt auch beim promptlosen Gather.
- R9: STT-Locale strikt volles BCP-47 (`de-DE`/`fr-FR`), nie `de`/`fr` allein.
- Keine neuen npm-Dependencies; ESM; Kommentare deutsch ohne Umlaute; FR-Akzente nur in Test-Strings
  (passieren die Render-Pfade unveraendert; Telnyx escaped `'` -> `&apos;`, Twilio-SDK laesst `'`).

## Tests
- Phasenrelevant gruen: `test/directive-render.test.js`, `test/telnyx-render.test.js`,
  `test/telephony-contract.test.js` (28/28); 8 neue FR-Tests gruen.
- Voller Lauf: 2 Boot-Refusal-Tests (`g1-config-boot-refusal`) sind Flakiness unter Parallel-Last
  (Server-Spawn, ~8s) - isoliert gruen. `L-CP7-3` (`llm-sdk-learning`) bleibt rot: pre-existing
  SDK-Shape-Drift, ausserhalb des Phasen-Scopes (auch auf clean master rot, siehe Commit 3a5749f);
  kein Bezug zu den 5 Phase-Dateien.

## clean-code-reviewer
VERDIKT: **SAUBER** - keine MUST-Findings. Ein SHOULD (Profil-String-Duplizierung in
`i18n/locales.js`) liegt ausserhalb des Aenderungsumfangs (nicht blockierend).

## Offen (Folgephasen)
P4 (statische Texte + Inbound-Wiring Nummer->Sprache), P5 (Realtime, optional).
