# C-P4 — Twilio-Adapter entfernen (Track C, Schritt 5a) — Report

Spec: `tasks/c-p4-spec.md`. Umbrella: `PLAN-ANBIETER-PORT.md`, Track C.

**Gate: PASS.** finalBranch: `phase/c-p4-adapter-raus-fix1`.

## Kontext

Gebaut von Session `8ec76d98` **ohne Review** (Commit `310c78a`). Dieser Lauf hat den
Review nachgeliefert: eine Fix-Runde (r1) auf einen echten, vom Impl selbst eingefuehrten
Bug, danach Safety- und Clean-Code-Freigabe.

## Testzahl

| Lauf | roh | korrigiert (i18n-Katalog ausgeschlossen) |
|---|---|---|
| `master` (b04c40e) | 4057 | 4037 |
| Branch `phase/c-p4-adapter-raus-fix1` (14f0054) | 4026 | 4006 |
| **Delta** | **-31** | **-31** |

Beide Vorgabezahlen aufgeklaert, keine unerklaerte Differenz: 4057 ist masters ROHzahl
(die Vorgabe nannte den unkorrigierten Wert); 4025 ist die Rohzahl des Vorgaenger-Commits
`310c78a` VOR fix1 — fix1 fuegt genau einen Regressionstest hinzu
(`test/check-setup-script.test.js`), macht 4026 = 4025 + 1. Beide Store-Backends laufen im
selben `npm test` (pglite-Faelle namentlich in `SAFETY.independentTestSummary` belegt).

## Fix-Runde r1

Einziger Review-Blocker: `scripts/check-setup.js:13` und `scripts/set-webhooks.js:29` lasen
`PROVIDER.TWILIO`, seit dem Enum-Ausbau `undefined`. `findActiveNumber(s, tenantId,
provider)` hat eine Kurzschluss-Bedingung `provider === undefined || n.provider ===
provider` — mit `undefined` war der Provider-Filter ABGESCHALTET statt leer, jede aktive
Nummer (inkl. Telnyx) waere faelschlich als Owner-Twilio-Nummer gemeldet worden. Fix:
String-Literal `"twilio"` statt `PROVIDER.TWILIO`, dazu `test/check-setup-script.test.js`
als Regressionstest, der genau diesen Fall pinnt (grau: der Pfad kann seit C-P4 nie mehr
treffen, weil `resolveSeedProvider("twilio")` `null` liefert — gehoert mit dem Skript in
C-P5).

## Safety-Urteil

**FREIGABE**, selbst gemessen, kein Impl-Bericht vorausgesetzt geglaubt.

- **Registry-Invariante**: unangetastet. Die Vollstaendigkeits-Schleife in
  `test/telephony-registry.test.js` (jetzt :152-157, auf master :138-143) ist
  byte-identisch, `FULL_COVERAGE` hat unveraendert dieselben fuenf Ports.
- **Gegenprobe** (Spec Abschnitt 5): durchgefuehrt, ROT gesehen. `PROVIDER.TWILIO`
  testweise ins Enum zurueck → die Vollstaendigkeits-Invariante faellt mit
  `"voiceControl/twilio fehlt in ADAPTERS"` (6 pass / 1 fail), zurueckgebaut, `git status`
  sauber. Enum und Adapter-Tabelle sind tatsaechlich gekoppelt.
- **Smoke-Test**: echter gespawnter Server, `SKIP_TWILIO_SIGNATURE_CHECK=false` + frisches
  Ed25519-Schluesselpaar. `GET /healthz` → 200. `POST /voice/incoming` mit gueltiger
  Telnyx-Ed25519-Signatur → 200 + TeXML (`transcriptionEngine="Deepgram"
  model="deepgram/nova-3"`). Gegenproben: Muell-Signatur → 403, kein Provider-Header → 403.
  `test/security.test.js` gegenueber master unveraendert (leeres Diff), gruen.
- **Scope**: eingehalten. `.env.example`, `render.yaml`, `schema.sql` unberuehrt.
  `config.js` aendert ausschliesslich zwei Kommentarzeilen; die Boot-Pflicht
  (`assertConfig` verlangt weiter `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`),
  `twilioSid`/`twilioToken`, `skipTwilioSignatureCheck` unangetastet — der Live-Dienst
  startet nach diesem Merge unveraendert.
- **Safety/Offenlegung/Auth/Secrets**: kein Gate-Code angefasst. Nur Fixture-Provider in
  Gate-Tests von `twilio` auf `telnyx` gedreht, Assertions selbst unveraendert. Der
  Telnyx-Ed25519-Verifizierer, `route-policy.js`, `auth.js`, `web-auth.js`,
  `middleware.js` unberuehrt. Keine Secrets in Logs/Meldungen/Tests.

### Concerns (nicht blockierend)

1. **Offene Kante fuer C-P5** (vom Branch selbst dokumentiert): eine Altzeile mit
   `provider='twilio'` in einer Bestands-DB laesst `webhookEvents()`/`voiceControl()`/
   `voiceRenderer()` werfen, weil `pick()` fail-closed ist — `/voice/status` bzw.
   `/voice/turn` antworten dann serverseitig fehlerhaft (siehe Clean-Code-S3 unten: nicht
   500 an den Aufrufer, `res.sendStatus(200)` ist bereits raus). Live kein Risiko
   (Prod: 3 Nummern, 67 Anrufe, alle telnyx; `createCall` setzt provider IMMER auf
   `DEFAULT_PROVIDER`).
2. **Charakterisierter Befund** in `src/telephony/voice-render.js`
   (`test/voice-render-action-url.test.js`): bei einem Call OHNE `provider`-Feld sind sich
   `render()` (→ TeXML), `streamDirectives` (→ Telnyx-Pfad) und `turnDirectives`
   (`call.provider === PROVIDER.TELNYX` → false → relative Action-URL) uneinig. Bis C-P4
   war der Zweig harmlos (er galt Twilio). Bewusst als Charakterisierungstest gepinnt statt
   gefixt — dieselbe Fehlerklasse wie C-P1b, gehoert in eine Ausbau-Phase, nicht versanden.
3. **Doku-Drift in CLAUDE.md**: Zeile 7 (`Twilio + Telnyx Voice`) und der Architektur-
   Absatz (`adapters/twilio/*` und `adapters/telnyx/*`) beschreiben einen Adapter, den es
   nach diesem Branch nicht mehr gibt.
4. `scripts/check-setup.js`/`scripts/set-webhooks.js` behalten ihren Twilio-Pfad und lesen
   jetzt das Literal `'twilio'` statt `PROVIDER.TWILIO` — verhaltens-erhaltend fuer diese
   Phase, aber der Pfad kann seit C-P4 nie mehr treffen. Gehoert mit dem twilio-npm-Import
   in C-P5.
5. Kommentar-Ungenauigkeit (kein Defekt) in `test/telnyx-numbers.test.js:222-225`: die
   Begruendung ("waere GRUEN geblieben") stimmt fuer `numberProvisioning` nicht — der
   Parameter hat Default `PROVIDER.TELNYX`, `undefined` haette den `assert.throws` ROT
   gemacht. Die Aenderung selbst ist richtig.
6. Stilfrage: vier Outbound-Testdateien (`g2-opening-turn`, `outbound-first-gather`,
   `outbound-greeting`, `outbound-premature-close`) behalten
   `for (const provider of ["telnyx"])` als einelementige Schleife — bewusst begruendet als
   die Stelle, an der ein zweiter Carrier ohne Umbau der Testkoerper wieder eintritt.

## Clean-Code-Audit (s1-s4)

**Verdict: PASS.** s1/s2/s4 leer. Ein s3-Fund, kein Blocker:

- **s3** · `test/voice-status-lifecycle.test.js` — der neu ergaenzte BEFUND-Kommentar zum
  entfallenen Fall (c) behauptet "/voice/status antwortet 500 statt 200". Tatsaechlich
  sendet der Handler `res.sendStatus(200)` als allererste Zeile, bevor `webhookEvents()`
  aufgerufen wird — ein Wurf dort kann die Client-Antwort nicht mehr auf 500 aendern
  (bestenfalls ein serverseitiger Fehler nach bereits gesendetem 200). Fix: Kommentar
  praezisieren, kein Verhaltens-Defekt.

Positiv hervorgehoben vom Auditor: alle 6 Twilio-Adapter-Dateien konsequent geloescht,
`ADAPTERS`/`PROVIDER_CAPABILITIES` ohne tote Eintraege, `PROVIDER.TWILIO` sweep-frei im
gesamten `src`/`scripts`-Baum. Der r1-Fix hat einen echten, durch die Enum-Aenderung
eingefuehrten Bug selbst gefunden und mit Regressionstest behoben. Testsuite-Migration
durchgaengig ehrlich: keine "gruen gemachten" Tests, jede entfallene Assertion traegt eine
Begruendung. `PROVIDER`/`MEDIA_PATH`/`ADAPTERS` behalten bewusst Tabellenform trotz nur
noch eines Werts — begruendeter Erweiterungspunkt, keine Ueberkonstruktion.

## Pflichtteil (Spec Abschnitt 4): Behandlung je Testdatei

Behandlungsregel: Ist der **Gegenstand** des Tests Twilio, faellt er mit dem Adapter. Ist
der Gegenstand ein **anderer** (Paritaet zwischen Adaptern, Port-Vertrag, Locale-Quelle,
STT-Naht), bleibt die Aussage erhalten — bei Paar-Tests als eigenstaendige Telnyx-
Zusicherung.

### Geloescht (Gegenstand war Twilio, entfaellt vollstaendig)

| Datei | Zeilen | Warum |
|---|---|---|
| `test/directive-render.test.js` | -222 (ganz) | Reine Twilio/TwiML-Snapshot-Tests (Say/Gather/Hangup-Markup, Voice-Profile, Fremdprofil-Wurf). Gegenstand ist ausschliesslich der Twilio-Renderer; sein Snapshot-Charakter hat keinen adapter-uebergreifenden Rest. Die eine PORT-Aussage darin (VOICE-22, STT-Modell sprachunabhaengig) ist **nicht mitgeloescht**, sondern nach `test/render-adapter-language-parity.test.js` gewandert (s. dort). |
| `test/twilio-voice.test.js` | -52 (ganz) | Testet `twilioVoice` direkt (originateCall/endCall/fail-closed bei fehlenden Credentials). Gegenstand ist der Twilio-Voice-Adapter selbst — mit der Datei entfernt, kein Telnyx-Aequivalent noetig (existiert bereits in `telnyx-voice.test.js`). |

### Geloeschte Adapter-Quelldateien (src/, zur Vollstaendigkeit — kein Test)

`src/telephony/adapters/twilio/{client,media,messaging,render,voice,webhook-events}.js`
(6 Dateien, 243 Zeilen) — der gesamte Adapter, Gegenstand der Phase.

### Gekuerzt — Twilio-Haelfte eines Paar-/Mehrfach-Tests entfernt, Telnyx-Haelfte bleibt als eigenstaendige Zusicherung

| Datei | Was fiel | Warum die Aussage nicht verloren geht |
|---|---|---|
| `test/telephony-registry.test.js` | Twilio-Imports, `voiceControl(PROVIDER.TWILIO)`-Assertions, Twilio-Zweig der `fakeOriginate`-Gegenprobe | Vollstaendigkeits-Invariante bewusst unveraendert (Gegenprobe belegt Kopplung Enum/ADAPTERS); `numberProvisioning("twilio")`-Wurftest bleibt gegen Literal statt totem Enum-Wert |
| `test/telephony-contract.test.js` | Twilio-Renderer/-Messaging-Importe, Doppel-Schleife ueber `RENDERERS`, "beweist Provider-Austauschbarkeit" | Kopf-Kommentar gibt die Austauschbarkeits-Behauptung ehrlich auf ("braucht zwei Teilnehmer"), behaelt die reine Vertrags-Form-Zusicherung (String zurueck, sendSms aufrufbar+mappt) |
| `test/media-transport.test.js` | Alle `twilioMedia`-Tests (buildMediaFrame/clearPlayback, parseMediaFrame start/media/stop, Frame-Roundtrip, T-P3-01-Haertung) | Zwei PORT-Aussagen (neutrales Event-Vokabular media/stop/unbekannt; T-P3-01-Haertung gegen malformten start-Frame) auf die Telnyx-Haelfte **uebernommen statt geloescht** — sie gelten dem Port, nicht dem Anbieter |
| `test/webhook-events.test.js` | 3 Twilio-Parsing-Tests (parseSpeechResult/parseLifecycleEvent/parseSpeakOutcome), Twilio-Import | Waren reine Twilio-Eigenheiten (kein Transcript-Vorrang, immer leere diagnostics, Speak-Outcome immer NONE) ohne Port-Charakter — bewusst entfallen, nicht uebernommen; Dispatch-Test **verschaerft**: `webhookEvents("twilio")` muss jetzt werfen statt einen Adapter zu liefern |
| `test/stt-model-seam.test.js` | Twilio-Renderer-Import, Twilio-Assertion in Test A (Wurf bei unbekannter STT-Wahl), kompletter Twilio-Block in Test B, Twilio-Aufruf in Test C | A/B/C bleiben mit zwei statt drei Uebersetzern (Telnyx-Gather, Telnyx-Assistant); die Naht selbst (`stt-profile.js`) ist unveraendert, ihr wurde nur ein Konsument entzogen |
| `test/p9-voice-locale-source.test.js` | Twilio-Renderer-Import + Twilio-Assertion im Locale-Test | "Beide Renderer folgen dem Locale-Buendel" → "der Renderer folgt" — Aussage bleibt fuer den verbliebenen Renderer gegen den Buendelwert (nicht gegen ein Literal) gemessen |
| `test/render-adapter-language-parity.test.js` | Twilio-Renderer-Import, `BUDGET_ENGINE_RENDERERS`-Doppelschleife in VOICE-23/25/29 | VOICE-23/25/29 bleiben als eigenstaendige Telnyx-Zusicherungen; **zusaetzlich VOICE-22 aus der geloeschten `directive-render.test.js` hierher gewandert** (STT-Modell sprachunabhaengig ueber `Object.values(VOICE_PROFILE)`) — Datei umbenannt von "adapter-language-parity" (Paar-Aussage) auf die Eigenschaften, die adapter-unabhaengig gelten |
| `test/telnyx-cost-records.test.js` | Abschnitt (f) "Twilio-Riegel": `twilioVoice`-Import + Test, dass `fetchCostRecordPool`/`assignCostRecords` dort `undefined` sind | Eigenschaft "Beleg-Methoden sind am Port optional" bleibt belegt, adapter-unabhaengig, in `test/cost-truing-observe.test.js` (`const control = {}`-Stub) — ein Stub sagt es allgemeiner als ein zweiter echter Adapter |
| `test/telnyx-p6-cap-callcontrol.test.js` | — (kein Twilio-Import/-Assertion entfallen) | `provider: "twilio"` → `"telnyx"` in T3/T4 — reine Fixture-Anpassung, kein Aussage-Verlust |
| `test/telnyx-numbers.test.js` | `assert.throws(() => numberProvisioning(PROVIDER.TWILIO), ...)` → Literal `"twilio"` | Waere `PROVIDER.TWILIO` stehen geblieben, haette es still `undefined` geliefert und der Test haette ab dann etwas anderes geprueft (Kommentar-Praezisierung s. Concern 5) |
| `test/provider-capabilities.test.js` | 2 direkte `PROVIDER.TWILIO`-Assertions ("vier bekannte Kombinationen" → "alle bekannten") | Faelle in die Fail-closed-Gegenprobe verschoben: `providerSupports("twilio", ...)` muss `false` liefern (Altzeilen-Fall) |
| `test/g2-opening-turn.test.js`, `test/outbound-first-gather.test.js`, `test/outbound-greeting.test.js`, `test/outbound-premature-close.test.js` | `"twilio"` aus der `for (const provider of [...])`-Schleife | Telnyx-Haelfte laeuft unveraendert; Schleifenform bewusst als Erweiterungspunkt belassen (Concern 6) |
| `test/g1-identity-binding.test.js`, `test/dial-target-normalization.test.js`, `test/number-gate.test.js`, `test/outbound-gates-order.test.js` | einzelne `provider: "twilio"`-Fixtures → `"telnyx"` | Fixture-Anpassung ohne Aussage-Aenderung |
| `test/bridge-hardening.test.js`, `test/media-token.test.js`, `test/bridge-openai-event.test.js` | Twilio-Frame-Form (`streamSid`, `/media`-Literal) → `MEDIA_PATH[PROVIDER.TELNYX]`/`stream_id` | Media-WS-Pfad und Frame-Form auf Telnyx umgestellt; Gegenstand (canSend-Guard, malformter start-Frame, Barge-in-Sequenz) unveraendert |
| `test/disclosure-outbound.test.js` | Polly-TwiML-Traeger → Azure-TeXML-Traeger (`SAY_OPEN`-Literale) | Gegenstand (Offenlegung als erster Say-Praefix im Gather, DE+EN) vollstaendig erhalten, nur der Traeger wechselt |
| `test/directive-synth.test.js` | Testname "Nicht-Telnyx" → "Anbieter ohne Play-TTS-Faehigkeit"; `provider: "twilio"` → benannte Konstante `UNSUPPORTED_PROVIDER` | Gegenstand (kein ElevenLabs-Request ohne Capability) bleibt, jetzt als Altzeilen-/Fail-closed-Fall benannt statt an Twilio gebunden |
| `test/voice-play-tts.test.js` | Test "Flag AN + provider=twilio: Renderer-Bestand unveraendert" entfernt | War die Twilio-Haelfte des Capability-Gates; Kosten-Seite bleibt anderswo gedeckt (Flag-AUS-Test + `provider-capabilities.test.js` Fail-closed) |
| `test/telnyx-p9-flag-matrix.test.js` | Orthogonalitaets-Zelle "Flag AN + NICHT-Telnyx" | Spec-Abschnitt 4 nennt dies ausdruecklich: mit einem Anbieter gibt es keine Orthogonalitaet zwischen Flag und Anbieter mehr |
| `test/check-setup-script.test.js` | — (nur Ergaenzung) | +1 Regressionstest fuer den r1-Fix (s. oben), kein Twilio-Bezug |
| `test/cost-truing-pool.test.js`, `test/directive-synth.test.js`, `test/api-cost-truing-sweep.test.js`, `test/kv-m4-monthly-cross-check.test.js`, `test/tenant-erasure-number-release.test.js` | `PROVIDER.TWILIO` als Fixture-Wert → benannte Literal-Konstante (`NO_PROOF_PROVIDER`/`UNSUPPORTED_PROVIDER`/`NON_TELNYX_PROVIDER`) | Gegenstand ist explizit "ein Provider, den die Registry NICHT kennt" bzw. "Altzeile in einer Bestands-DB" — `PROVIDER.TWILIO` waere seit C-P4 `undefined` und haette den Filter gegen etwas anderes geprueft; jetzt bewusst als Literal-Altzeilen-Fall benannt |

### Gekuerzt — Charakterisierungs-/Befund-Umbau (Gegenstand bleibt, Fokus verschiebt sich)

| Datei | Was geschah | Warum |
|---|---|---|
| `test/voice-render-action-url.test.js` | Test "twilio → relative Action-URL" und "streamDirectives → Twilio-Media-Pfad" entfernt; neuer Charakterisierungstest "Call ohne provider → TeXML-Renderer, aber RELATIVE Action-URL" ergaenzt | Die zwei geloeschten Tests hatten Twilio als Gegenstand; beim Aufraeumen deckte der Branch einen echten Bestandsbefund auf (drei provider-lesende Stellen in `voice-render.js` uneins bei fehlendem `provider`-Feld) und haelt ihn transparent als Charakterisierungstest fest statt ihn zu verschweigen (Concern 2) |
| `test/voice-status-lifecycle.test.js` | Fall (c) "Twilio in-progress" entfernt, BEFUND-Kommentar zur Altzeilen-500-Kante ergaenzt, Fall (f) traegt jetzt die in-progress-Aussage | Fall (c) hatte einen anderen Anbieter als Gegenstand; die Aussage "in-progress → markAnswered" bleibt am providerlosen Default-Fall erhalten. Kommentar-Ungenauigkeit s3 (Auditor-Fund) betrifft diese Datei |

### Unveraendert (nur Fixture-Wert `"twilio"` → `"telnyx"`, mechanisch identisch, keine Assertion geaendert)

Reine Provider-Fixture-Swaps ohne jede Aenderung an Testkoerper oder Erwartung — der
Gegenstand jedes dieser Tests ist ein anderer als der Anbieter (Budget-Gates, Multi-Tenant,
Boot-Heilung, Kosten-Truing, OAuth, RLS etc.), die Fixture musste nur auf einen weiterhin
unterstuetzten Provider zeigen:

`test/a4-default-profile-zero.test.js`, `test/al-p6-engine-reactions.test.js`,
`test/am6-oauth-tenant.test.js`, `test/api-cost-drift.test.js`, `test/b2-quota-gate.test.js`,
`test/boot-guard.test.js`, `test/bootstrap-heal-boot.test.js`, `test/bootstrap-tenant.test.js`,
`test/budget-failure-reason.test.js`, `test/cap-failure-reason.test.js`,
`test/claude-identity.test.js`, `test/cost-truing-observe.test.js`,
`test/f1-geo-store.test.js`, `test/f1-p8-outbound-lang.test.js`,
`test/f2-p9-dedup-persist.test.js`, `test/f2-p8-cost-cap.test.js`,
`test/f2-sms-summary-plan.test.js`, `test/g326-turn-shortcut-empty-guard.test.js`,
`test/gap-10-hour-limit-per-tenant.test.js`, `test/gap-35-metrics-country.test.js`,
`test/gap-38-plan-free-predeploy.test.js`, `test/ks-p2-live-carrier-spend.test.js`,
`test/ks-p3-brake-wiring.test.js`, `test/kyc-gate-outbound.test.js`,
`test/language-switch-midcall.test.js`, `test/outbound-identity-gate.test.js`,
`test/outbound-tenant.test.js`, `test/owner-number-seed.test.js` (dazu 3 Testnamen/Werte
praezisiert, s. u.), `test/p4-alarm-relay.test.js`, `test/p4-billing-hold-gate.test.js`,
`test/platform-spend-warning.test.js`, `test/profiles.test.js`,
`test/read-scope-tenant.test.js`, `test/store-pg.test.js`,
`test/store-pg-multitenant.test.js`, `test/store-pg-rls.test.js`,
`test/voice-greeting-tenant.test.js`, `test/voice-outbound-machine-detection.test.js`,
`test/w5-abo-allowlist-gate.test.js`, `test/_outbound-harness.js` (Default-Parameter der
Harness-Funktionen).

Sonderfall in dieser Gruppe: `test/owner-number-seed.test.js` — `resolveSeedProvider`
liefert fuer `"twilio"` jetzt `null` statt `PROVIDER.TWILIO` (fail-closed, Spec Abschnitt 2:
"twilio ist kein unterstuetzter Anbieter mehr"); der bisherige Tippfehler-Testfall
(`"twillio"`) wurde auf `"telnix"` umbenannt, da `"twillio"` als Tippfehler von einem nun
selbst ungueltigen Wort wenig Sinn ergab. Das ist eine Verhaltens-Verschaerfung
(dokumentiert im Safety-Urteil als "3 Stellen SCHAERFER geworden"), keine Kuerzung einer
Aussage.

## Fazit

Vollstaendige Twilio-Adapter-Entfernung, Registry-Invariante unveraendert und per Gegenprobe
als tatsaechlich gekoppelt belegt, Testsuite-Migration durchgaengig dokumentiert (jede
entfallene Aussage traegt eine Begruendung, keine still gruen gemachten Tests). Zwei echte
Nebenbefunde (Altzeilen-500-Kante, `voice-render.js`-Provider-Inkonsistenz) sind transparent
als Charakterisierung/BEFUND festgehalten statt versteckt — beide fuer C-P5 vorgemerkt.
