# Server-Slim Phase P11 — Report

**Ziel:** `src/routes/voice.js` extrahieren — die 5 `/voice/*`-Webhooks (`incoming`/`turn`/`outbound`/`status`/`call-control`) + `GET /voice/tts/:token` + die `/voice`-Signatur-Middleware aus `src/server.js` (hoechstes Einzel-Risiko der gesamten Server-Slim-Kette: Telefonie-Kernpfad, Signaturpruefung fail-closed, Offenlegungssatz-Pfade, Geld-Settlement)
**Gate:** PASS
**finalBranch:** `phase/slim-p11-voice-routes`
**headCommit (Impl):** `8d1f77dd58950c9f331ab0457e1d2b8427ae68f8`

---

## 1. Plan (gekuerzt)

### 0. Realitaets-Abgleich

`src/server.js` war zu Phasenbeginn **1307 Zeilen** (P0a-P10 bereits gemergt, letzter Commit `f280d0a merge(slim-p10)`). Die Voice-Bloecke liegen zusammenhaengend zwischen `express.static(config.publicDir)` (L590) und der REST-API-Section (L987). `grep -c "^export" src/server.js` = 0 zu Phasenbeginn.

**Echte Fundstellen (verifiziert, ersetzen gerottete Plan-Nummern):**

| Block | echte Zeilen |
|---|---|
| `ttsStore`-Konstruktion | L592-593 (**bleibt**) |
| `directiveSynth`-Konstruktion | L595-597 (**bleibt**) |
| `GET /voice/tts/:token` | L599-609 |
| `app.use("/voice", sig-MW)` | L611-641 |
| `voiceRender`-Konstruktion + Destrukturierung | L643-648 (Konstruktion **bleibt**, Destrukturierung wandert) |
| `INBOUND_ASSISTANT_HANDOFF` + `inboundAssistantHandoffXml` | L669-692 |
| `POST /voice/incoming` | L694-791 |
| `POST /voice/turn` | L793-859 |
| `POST /voice/outbound` | L861-899 |
| `POST /voice/status` | L901-966 |
| `POST /voice/call-control` (`makeCallControlIngest`) | L968-985 |
| Mount-Ziel | nach L590 (static), vor L997 (`makeCallRoutes`) |

### 1. Neue Datei `src/routes/voice.js`

**Factory-Signatur (ein `deps`-Objekt, F1):**

```js
export function makeVoiceRoutes({
  store, config, audit,
  voiceRender, directiveSynth, ttsStore,
  lifecycle, finishCall,
  voiceControl, webhookEvents, providerFromHeaders, inboundSignatureVerifier,
  terminateAndBillCall, billThunk,
  watchdog,
}) { … return router; }
```

**Import-vs-Inject-Konvention** (bindend, uebernommen vom unmittelbaren Sibling `api-calls.js`/P9): reine Modul-Konstanten/Praedikate/Formatierer mit EINER kanonischen Heimat werden **direkt importiert** (G5 "eine Quelle"); Laufzeit-Instanzen, der Provider-Dispatch-/Action-Seam, der Settlement-Seam sowie `config`/`store`/`audit` werden **injiziert** (INV-7 "eine Instanz"). Beide Wege sind zur Laufzeit byte-identisch (ES-Modul-Singletons).

- **Direktimport:** `Router` (express), `normNum`/`DEFAULT_PROVIDER`/`PROVIDER` (store/defaults.js), `say as sayD`/`hangup as hangupD` (telephony/directives.js), `SPEAK_OUTCOME` (telnyx/speak-events.js), `localeFor` (i18n/locales.js), `callFailureReason` (telephony/failure-reason.js), `degradedSpeechFor` (llm.js), `agentTurn`/`openingText`/`callerHasSpoken` (claude.js), `metrics` (metrics.js), `startInboundAiAssistant`/`inboundCallControlId` (telnyx-inbound.js), `makeCallControlIngest` (telnyx-call-control-ingest.js).
- **Injiziert (15 Keys):** `store`, `config`, `audit`, `voiceRender` (INV-7), `directiveSynth` (INV-7), `ttsStore` (INV-7), `lifecycle` (INV-7), `finishCall` = `callFinish.finishCall` (INV-7, eine Referenz), `voiceControl`/`webhookEvents`/`providerFromHeaders`/`inboundSignatureVerifier` (registry-Provider-Dispatch-Seam, DIP), `terminateAndBillCall`/`billThunk` (Settlement-Seam, wie `api-calls.js`), `watchdog` = `conversationWatchdog` (INV-7, geteilt mit dem Shim).

Diese Aufteilung praezisiert die illustrative Dep-Liste des Plan-Sketches (die `localeFor`/`DEFAULT_PROVIDER`/`PROVIDER`/`SPEAK_OUTCOME` als injiziert nannte, `sayD`/`hangupD`/`normNum` aber gar nicht auffuehrte) auf Basis der echten Konvention-Konsistenz mit `api-calls.js` (G11/G24-Gate). Als Deviation dokumentiert.

**Vollstaendigkeitsbeweis** (jeder Handler durch `deps ∪ imports` gedeckt): `/voice/tts`→`ttsStore`; sig-MW→`config,inboundSignatureVerifier,providerFromHeaders`; incoming→`providerFromHeaders,DEFAULT_PROVIDER,normNum,store,audit,voiceRender,sayD,hangupD,localeFor,config,lifecycle,directiveSynth,inboundAssistantHandoffXml`; turn→`store,lifecycle,voiceRender,metrics,webhookEvents,callerHasSpoken,localeFor,directiveSynth,agentTurn,hangupD,degradedSpeechFor`; outbound→`store,lifecycle,voiceRender,hangupD,config,openingText,directiveSynth`; status→`store,lifecycle,DEFAULT_PROVIDER,webhookEvents,SPEAK_OUTCOME,callFailureReason,terminateAndBillCall,billThunk,finishCall`; call-control→`makeCallControlIngest({store,voiceControl,finishCall,openingText,localeFor,reattachActiveCall:lifecycle.reattachActiveCall,watchdog,config})`.

**Inhalts-Skizze:** die 5 Webhooks + `inboundAssistantHandoffXml` + `INBOUND_ASSISTANT_HANDOFF` wandern VERBATIM. Kritische Reihenfolge im Router (INV-4, Pflicht-Kommentar): `GET /voice/tts/:token` **zuerst**, **dann** die Sig-MW, **dann** die 5 Webhooks — rueckte die Sig-MW vor die TTS-Route, wuerde PII-Audio faelschlich signaturpflichtig (Telnyx kann GET nicht signieren -> 403 -> tote Audio-Ausgabe).

**Zwei zwingende, byte-verhaltens-neutrale Text-Aenderungen** (DI-Umbenennung, exakt wie P9): `bill: billThunk(callFinish.finishCall, store, call.id)` → `bill: billThunk(finishCall, store, call.id)`; `finishCall: callFinish.finishCall` → `finishCall,`; `watchdog: conversationWatchdog` → `watchdog,`. Selbe Funktionsreferenz, nur der lokale Name aendert sich. `app.post`/`app.get`/`app.use` → `router.post`/`router.get`/`router.use`; alle uebrigen Zeilen bleiben wortwoertlich.

### 2. Edits an `src/server.js`

- **Imports entfernen** (verifiziert voice-only): `makeCallControlIngest`, `startInboundAiAssistant`/`inboundCallControlId`, `metrics`, `degradedSpeechFor`, `sayD`/`hangupD`, `SPEAK_OUTCOME`, `callFailureReason` (komplette Zeilen); Teil-Edits an 3 Sammel-Imports (`DEFAULT_PROVIDER`/`normNum` aus store/defaults.js raus, `openingText`/`callerHasSpoken` aus claude.js raus, `webhookEvents`/`inboundSignatureVerifier`/`providerFromHeaders` aus registry.js raus) — jeweils verifiziert, dass die verbleibenden Symbole (`PROVIDER`, `agentTurn`, `summarizeCall`, `voiceControl`, `messaging`, `numberProvisioning`, `localeFor`, `makeVoiceRender`, `terminateAndBillCall`/`hangUpAction`/`billThunk`, `audit`) weiterhin ausserhalb der Voice-Bloecke genutzt werden. Vorbestehende ungenutzte `NUMBER_STATUS`/`USAGE_EVENT_KIND` bewusst nicht angefasst (ausserhalb P11-Scope).
- **Neuer Import:** `import { makeVoiceRoutes } from "./routes/voice.js";`
- **Region L599-985 kollabiert:** geloescht (TTS-Route, Sig-MW, `voiceRender`-Destrukturierung, `INBOUND_ASSISTANT_HANDOFF`, `inboundAssistantHandoffXml`, alle 5 Webhooks); `ttsStore`/`directiveSynth` bleiben unveraendert stehen (Singletons, INV-7). `voiceRender`-Konstruktion wandert direkt vor den neuen Mount-Block. Ersetzt durch `app.use(makeVoiceRoutes({ store, config, audit, voiceRender, directiveSynth, ttsStore, lifecycle, finishCall: callFinish.finishCall, voiceControl, webhookEvents, providerFromHeaders, inboundSignatureVerifier, terminateAndBillCall, billThunk, watchdog: conversationWatchdog }));` mit Sicherheits-Pflichtkommentar (Mount-Position, INV-4-Hinweis, Singleton-Herkunft).
- **Stale-Kommentar (C2, optional):** L156 (`callFinish`-Konstruktions-Kommentar) minimal auf "…UND — via makeVoiceRoutes — makeCallControlIngest" nachgezogen.

### 3. Tests

**Drei mechanische Whitebox-Updates** (Plan-erlaubt, exaktes P9-Muster):

1. `test/reattach-active-call.test.js` — Quelle `server.js`→`src/routes/voice.js`, Marker `app.post`→`router.post`, Testnamen aktualisiert; Assertions/`+1500`-Fenster unveraendert.
2. `test/call-termination-order.test.js` — neue `voiceSrc`-Konstante fuer `routes/voice.js`; `/voice/status`-Test liest jetzt `voiceSrc` mit `router.post`-Markern; `billThunk`-Assertion auf bare `finishCall`. `serverSrc` bleibt (weiter fuer Import-Zeilen-Check genutzt).
3. `test/telnyx-observability-secret-guard.test.js` — `routes/voice.js` zu `WHOLE_FILE_SCAN_TARGETS` ergaenzt; redundanter server.js-Regionsschnitt-Test samt `voiceMiddlewareRegion()`-Helfer und Markern entfernt (deckt jetzt alle Handler-Logs staerker ab als der alte Regionsschnitt).

**Ein neuer Test** (Budget: hoechstens einer) — `test/voice-tts-before-signature.test.js`: INV-4-Struktur-Freeze. Begruendung: Spawn-Tests laufen mit `SKIP_TWILIO_SIGNATURE_CHECK=true` (`helpers.js` BASE_ENV), daher ist die Reihenfolge "TTS-Route vor Sig-MW" behavioral nicht gefangen — ein deterministischer Quelltext-Freeze (`indexOf`-Vergleich) schliesst die Luecke.

**Nicht betroffen** (verifiziert): `telnyx-p6-cap-callcontrol.test.js`, `telnyx-event-ingest-route.test.js`, `telnyx-assistant-route-drift.test.js` (ankert auf dem in server.js bleibenden Shim), `process-guards.test.js`.

### 4. Deterministisch pruefbares Ergebnis

`node --check` beide Dateien; `grep -c "^export" src/server.js` = 0; `grep -c 'app\.\(get\|post\|use\)("/voice' src/server.js` = 0; `grep -c 'export function makeVoiceRoutes'` = 1; Boot-Log-Zeile genau 1x; `git diff --stat src/server.js` grosse Netto-Reduktion (~-385 Zeilen); volle + isolierte P11-Testliste gruen; SMOKE-Test (isoliertes DATA_DIR, `/voice/incoming` liefert TeXML byte-identisch).

### 5. Deviations (geplant)

1. Import-vs-Inject refined ggue. Plan-Sketch: `localeFor`/`DEFAULT_PROVIDER`/`PROVIDER`/`SPEAK_OUTCOME`/`sayD`/`hangupD`/`normNum` direktimportiert statt injiziert — Konvention-Konsistenz mit `api-calls.js` (G11/G24), zur Laufzeit byte-identisch.
2. Drei mechanische Test-Updates (reattach, call-termination-order, observability-secret-guard) — vom Plan explizit erlaubt.
3. Ein neuer Test (`voice-tts-before-signature`) — INV-4-Struktur-Freeze, Test-Budget des Plans.

### 6. Clean-Code / Blast-Radius / Pre-Mortem (Plan-Einschaetzung)

INV-3/INV-4 (TTS vor Sig-MW), INV-7 (kein Symbol neu konstruiert, alle Singletons bleiben Wurzel-Instanzen), INV-2 (Mount-Position unveraendert) explizit adressiert. Blast-Radius: eine neue Datei + `server.js` (Import-Trim + Regions-Kollaps + ein Mount) + 3 mechanische Test-Updates + 1 neuer Test; `bridge.js`/`claude.js`/Adapter/Store/alle Route-Pfade/Bodies/Audit-Events unveraendert.

---

## 2. Impl-Zusammenfassung

`src/routes/voice.js` als `makeVoiceRoutes({...15 Deps})`-Factory (express.Router) aus `server.js` extrahiert: reine Verschiebung der 5 `/voice/*`-Webhooks (`incoming`/`turn`/`outbound`/`status`/`call-control`) + `GET /voice/tts/:token` + der `/voice`-Signatur-Middleware, DI-Muster identisch zu `makeCallRoutes`/P9. 15 injizierte Deps + Direktimports fuer reine Modul-Konstanten (Konvention wie `api-calls.js`). INV-4 (TTS-Route vor Sig-MW) im Router erhalten und zusaetzlich per neuem Struktur-Freeze-Test gepinnt.

`server.js`: netto **-371 Zeilen**, bleibt export-frei (`grep -c '^export'` = 0), Boot-Log-Zeile genau 1x im Repo, keine echten `app.*("/voice"`-Registrierungen mehr in `server.js` (nur noch 1 Kommentar-Erwaehnung).

**Globale Verifikation:** `node --check` auf beiden Dateien; volle `npm test` **2291/2291 gruen** (json-Default-Backend + pg/pglite-Tests im selben Lauf); isolierte P11-Testliste (voice-signature, voice-signature-403-log, inbound-routing, voice-incoming-catch-path, voice-status-lifecycle, voice-unknown-call-log, telnyx-p8-inbound, telnyx-event-ingest-route, disclosure-outbound, graceful-shutdown, voice-play-tts, reattach-active-call, call-termination-order, telnyx-observability-secret-guard, voice-tts-before-signature) gruen. Ein Fail bei Voll-Last in `telnyx-event-ingest-route.test.js` war der bekannte `p5-gate-proof`-Spawn-Race-Flake — isoliert erneut gruen, kein echter Regress.

**Smoke-Test** (`SKIP_TWILIO_SIGNATURE_CHECK=true`, geseedetes DATA_DIR via `scripts/bootstrap-tenant.js`): `/healthz` → 200; `/voice/incoming` (bekannte Telnyx-Nummer) → korrektes TeXML mit Gather/Say-Greeting; `/voice/turn` → erwarteter Degraded-Error-TeXML-Pfad (Dummy-LLM-Key); `/voice/status` → 200; `/voice/tts/:token` mit unbekanntem Token → 404 (beweist Route registriert und laeuft vor der Signatur-MW). Alle 5 Webhooks + TTS-Route strukturell erreichbar bestaetigt.

**Dateien:**
- neu: `src/routes/voice.js`, `test/voice-tts-before-signature.test.js`
- geaendert: `src/server.js`, `test/reattach-active-call.test.js`, `test/call-termination-order.test.js`, `test/telnyx-observability-secret-guard.test.js`

**Tests:** 1 neu, 3 geaendert (mechanisch); Testergebnis 2291 pass / 0 fail.

### Deviations (Impl, final)

1. **Import-vs-Inject in `voice.js`** folgt der im Plan begruendeten Refinement ggue. dem Spec-Sketch: `normNum`/`DEFAULT_PROVIDER`/`PROVIDER`/`sayD`/`hangupD` werden direkt importiert statt injiziert (Konvention-Konsistenz mit dem gemergten Sibling `api-calls.js`/P9, G5/G11/G24). Laufzeit-identisch (ES-Modul-Singletons); alle Laufzeit-Instanzen/Seams bleiben injiziert wie in der Spec gefordert.
2. **`telnyx-observability-secret-guard.test.js`** ueber die reine "Marker hinzufuegen"-Variante hinaus bereinigt: der jetzt redundante `server.js`-Regionsschnitt-Test samt `voiceMiddlewareRegion()`-Helfer und den beiden `VOICE_MIDDLEWARE_*_MARKER`-Konstanten wurde entfernt (keine tote Test-Infrastruktur, C5/G9); Header-Kommentar an neuen Stand angepasst. Eine der 3 vom Plan explizit erlaubten "zwingend-mechanischen" Test-Updates, keine neue Verhaltenspruefung.
3. **Ein bewusst nicht geaenderter Kommentar** in `voice.js`: der Kommentar innerhalb der Signatur-Middleware referenziert weiterhin "`app.use`", obwohl der Code jetzt "`router.use`" heisst — exakt wie vom Plan verlangt ("alle uebrigen Zeilen bleiben wortwoertlich", nur die 2 explizit genannten Text-Aenderungen + der mechanische `app`→`router`-Swap sind erlaubt). Rein kosmetische Kommentar-Staleness, keine Verhaltensrelevanz.
4. **Voll-Last-Flake** in `test/telnyx-event-ingest-route.test.js` (1 Fail bei kombiniertem Lauf der P11-Testliste) ist der vorbekannte `p5-gate-proof`-Spawn-Race (~12%, Lehren-Memory) — isoliert erneut gruen, kein echter Regress; per Gate-Protokoll nicht blockierend.

---

## 3. Safety-Urteil

**approved: true** — alle Kernkriterien erfuellt:

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengige Verifikation:** Volle `npm test` im eigenen Lauf gruen — 2291 pass / 0 fail / 0 skipped (json-Backend Default; pg-Backend im selben Lauf via pglite/`STORE_BACKEND=pg` mitgetestet — 0 Fehlschlaege heisst beide gruen). Isolierte P11-Verifikationsliste (voice-signature, voice-signature-403-log, inbound-routing, voice-incoming-catch-path, voice-status-lifecycle, voice-unknown-call-log, telnyx-p8-inbound, telnyx-event-ingest-route, disclosure-outbound, graceful-shutdown, voice-play-tts, plus die 4 angefassten/neuen Tests): 60 pass / 0 fail. Live-Smoke (`helpers.startServer`, `SKIP_TWILIO_SIGNATURE_CHECK=false`): `POST /voice/incoming` ohne Signatur → 403 (fail-closed); `GET /voice/tts/<bad>` → 404 NICHT 403 (beweist TTS-Route vor Sig-MW registriert, INV-4); `/healthz` → 200; Boot-Log-Zeilenzahl = 1 (INV-6). `node --check` sauber fuer `routes/voice.js` und `server.js`; `grep -c '^export' src/server.js` = 0.

**Blockers:** keine.

**Concerns (nicht blockierend):**
1. `makeVoiceRoutes` ist eine lange Factory (442 Zeilen mit allen 5 Handlern). Konform mit der P11-Spec (reine Verschiebung, keine Intra-Funktions-Splits; G5-1/`attachOrHangup`-Dedup ausdruecklich Folgearbeit), aber die spaetere Dedup-Phase sollte das aufloesen.
2. In `test/telnyx-observability-secret-guard.test.js` wurde der `server.js`-Regionsschnitt-Test entfernt und durch einen Whole-File-Scan von `routes/voice.js` ersetzt. Das ist eine Staerkung (deckt jetzt alle 7 `console.*`-Calls statt nur der Sig-MW ab), kein Coverage-Verlust, und mechanisch durch den Quelltext-Move gerechtfertigt.

**Verdict:** APPROVED. P11 ist eine byte-treue reine Verschiebung der `/voice`-Webhook-Gruppe aus `src/server.js` nach `src/routes/voice.js` (Factory `makeVoiceRoutes`, DI-Muster wie `makeCallRoutes`). Alle absoluten Regeln und die load-bearing Invarianten sind eingehalten: **INV-4** (TTS-Route vor der Sig-MW, live bewiesen via 404-statt-403), **INV-2** (Mount-Position identisch: nach `express.static(publicDir)`, hinter Auth-Gate, vor `makeCallRoutes`), **INV-3** (`/voice`-Auth-Exemption unveraendert, `safeEqual` unberuehrt), Signatur fail-closed (Skip nur via `config.skipTwilioSignatureCheck`; live 403), **INV-9** (Budget-Schnittmenge, Max-Dauer-Timer, `terminateAndBillCall`-Settlement verbatim mitgewandert), **INV-7** (`conversationWatchdog` + `callFinish` + `makeVoiceRoutes` je einmal konstruiert/gemountet), **INV-6** (Boot-Zeile genau 1), **INV-10** (0 Exports). Disclosure (`claude.js`+`bridge.js` unberuehrt), keine Secret-Leaks (Guard jetzt staerker), keine neuen Dependencies, keine ungefragten Extras. Die einzige nicht-verbatim Aenderung im Aufrufcode (`billThunk(callFinish.finishCall,...)` → `billThunk(finishCall,...)`) ist durch den injizierten Dep semantisch identisch. Unabhaengige Tests gruen.

---

## 4. Clean-Code-Audit (S1-S4)

**Verdict: PASS**, `blocker: false`.

Der Diff ist eine verifiziert reine Verschiebung: `/voice/tts/:token`, die `/voice`-Signatur-Middleware und die 5 Webhook-Handler (`incoming`/`turn`/`outbound`/`status`/`call-control`) wandern unveraendert aus `server.js` in `src/routes/voice.js` (`makeVoiceRoutes`, DI-Factory-Muster wie `makeCallRoutes`/`makeReadRoutes`). Textuell normalisierter Diff des entfernten vs. neuen Blocks zeigt nur (a) Kommentare, die an die neue Modulgrenze angepasst wurden, und (b) DI-bedingte Umbenennungen (`callFinish.finishCall`→`finishCall`, `conversationWatchdog`→`watchdog`) durch die Parameter-Injektion — keine Logik-/Verhaltensaenderung. Mount-Position in `server.js` unveraendert (nach `express.static(publicDir)`, vor `makeCallRoutes`). Alle 15 injizierten Dependencies an der Aufrufstelle 1:1 auf die Factory-Signatur gemappt, alle vor der Aufrufstelle deklariert (keine TDZ — bekannte Falle dieser Umbau-Kette). `node --check` sauber; volle Testsuite lief zweimal: erster Lauf 2289/2291 (zwei Fehlschlaege), zweiter Lauf 2291/2291 gruen; beide Fehlschlaege (`outbound-first-gather.test.js`, `telnyx-event-ingest-route.test.js`) liefen isoliert sofort gruen und reproduzieren exakt das dokumentierte vorbestehende Voll-Last-Flake-Muster (Seed-vor-Boot-Race) — keine durch P11 verursachte Regression.

INV-4 (TTS-Route muss vor der Signatur-MW registriert sein, sonst wird PII-Audio faelschlich signaturpflichtig) ist strukturell (neuer Test `voice-tts-before-signature.test.js`) und zur Laufzeit (bestehender Spawn-Test `voice-signature-403-log.test.js`, prueft Pfad+Provider im 403-Log inkl. der durch die Router-Verschachtelung potenziell veraenderten `req.baseUrl`/`req.path`-Berechnung) abgesichert und gruen. Begleit-Tests (`call-termination-order`, `reattach-active-call`, `telnyx-observability-secret-guard`) korrekt auf die neue Datei umgezogen; der secret-guard-Test wurde von einem bruechigen Textanker-Regionsschnitt auf einen robusteren Whole-File-Scan umgestellt (Verbesserung, keine Abschwaechung). Keine toten Imports, kein toter Code, keine deaktivierten Sicherungen, keine Magic Numbers, keine Secrets im Diff.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (nicht blockierend):**
  - `src/routes/voice.js` — G5-Duplikation (`reattachActiveCall`+`logUnknown`-Hangup-Pattern fast identisch in `/voice/turn` und `/voice/outbound`). Existierte bereits unveraendert in `master` (vor P11) und wurde durch die Phase nur mitverschoben, nicht verschaerft. Der Modul-Docblock von `voice.js` benennt sie selbst explizit und verschiebt sie bewusst: "G5-1-Dedup (`attachOrHangup`) ist ausdruecklich Folgearbeit, NICHT diese Phase" — daher als S3-Hinweis statt S2-Blocker gewertet, da nicht durch diesen Diff eingefuehrt/verschlimmert. Fix (Folge-Phase): gemeinsamen `attachOrHangup(callId, label)`-Helper extrahieren.
- **S4 (informativ):**
  - `src/routes/voice.js` — `makeVoiceRoutes` buendelt TTS-Route, Signatur-Middleware, 5 Webhook-Handler und die Call-Control-Delegation in einer Factory mit 15 injizierten Dependencies. Groesseres Interface/mehr Verantwortung als kleinere Route-Module, deckt sich aber mit dem bestehenden Repo-Muster (`makeCallRoutes` hat vergleichbar viele Deps fuer den Outbound-Money-Path) und der `/voice`-Namespace war schon vor der Extraktion EIN zusammenhaengender Sicherheits-Block (Signatur-Gate + Offenlegungspfade) — keine Abweichung von der Projekt-Konvention (G24), daher nur als Groessen-Notiz vermerkt, kein Fix gefordert.

**passNotes:** Reine Verschiebung textuell verifiziert (normalisierter Diff alt/neu zeigt nur Kommentar-Anpassungen + DI-bedingte Umbenennungen, keine Logikaenderung). Mount-Reihenfolge in `server.js` unveraendert (`express.static(publicDir)` → `makeVoiceRoutes` → `makeCallRoutes`). DI-Wiring 15/15 Parameter passgenau (`store`/`config`/`audit`/`voiceRender`/`directiveSynth`/`ttsStore`/`lifecycle`/`finishCall`/`voiceControl`/`webhookEvents`/`providerFromHeaders`/`inboundSignatureVerifier`/`terminateAndBillCall`/`billThunk`/`watchdog`), alle Abhaengigkeiten vor der Aufrufstelle deklariert (keine TDZ). Sicherheitsgates (Provider-Signatur fail-closed, TTS-vor-Signatur INV-4, Offenlegungssatz, Budget-Gate, Max-Dauer-Timer) alle unveraendert und mit bestehenden + einem neuen gezielten Test abgesichert. Keine toten Imports/Symbole in `server.js` zurueckgeblieben (grep-verifiziert). Keine Secrets/PII im Diff. Testsuite: `node --check` gruen, `npm test` zweimal komplett durchgelaufen (1x 2289/2291 mit 2 isoliert-gruenen, dokumentiert vorbestehenden Flakes; 1x 2291/2291 komplett gruen).

**topTodos:**
1. Nicht blockierend, fuer eine spaetere Phase vormerken: G5-1-Dedup (`attachOrHangup`-Helper fuer `/voice/turn` + `/voice/outbound`) umsetzen — vom Phase-Autor selbst bereits als Folgearbeit dokumentiert, keine neue Erkenntnis dieses Audits.
2. Vor Merge/Deploy: den bereits im Repo dokumentierten Hinweis pruefen, dass die exakte Telnyx-Handoff-Direktive (`INBOUND_ASSISTANT_HANDOFF`-Pfad in `inboundAssistantHandoffXml`) laut Kommentar noch "live unbestaetigt" ist — unveraendert aus P8 uebernommen, keine P11-Regression, aber offener Punkt fuer den naechsten echten Telnyx-Assistant-Testanruf.
3. Keine weiteren kritischen To-dos aus diesem Audit — Phase ist sauber genug zum Mergen.

---

## 5. Fix-Runden

Keine — es gab keine Blocker (S1/S2 leer), daher keine Fix-Runde noetig. Phase in einem Durchgang PASS.
