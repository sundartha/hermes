# Phase P5 — Detailbericht

**Titel:** Provider-Registry — eine Adapter-Tabelle, fail-closed Dispatch, Capability-Seam, PROVIDER-Enum durchgezogen
**Gate:** PASS
**finalBranch:** `phase/cc-p5-provider-registry`
**Basis:** lokaler `master` @ `5ee8a68` (enthaelt bereits den P4-Clean-Code-Merge)
**headCommit:** `3cdd61fe4b2b6b64cccefecbec5a7c8fa00102db` (Kurzform `3cdd61f`)

---

## 1. Ausgangslage / Ziel

P5 adressiert die verstreute Provider-Dispatch-Logik in der Telephony-Schicht (`src/telephony/registry.js`):

- **5 provider-aware Port-Factories mit stillem Twilio-Fallback** — `voiceControl`, `messaging`, `mediaTransport`, `webhookEvents` (je `provider === PROVIDER.TELNYX ? telnyx… : twilio…`) sowie `voiceRenderer` (Ternary mit ElevenLabs-Injektion im Telnyx-Arm). Ein unbekannter/korrumpierter Provider-Wert wuerde bei diesem Muster still auf den Twilio-Adapter durchrutschen statt zu scheitern (Mis-Route-Risiko: ein Telnyx-Call wuerde ueber den Twilio-Adapter signiert/gerendert).
- `numberProvisioning` warf bereits fail-closed (`… nicht unterstuetzt`) — als Vorbild fuer die anderen fuenf Factories.
- **3 verstreute Capability-Checks (S2-22)**, zwei distinkte Faehigkeiten, alle als roher `provider === PROVIDER.TELNYX`-Vergleich verdrahtet:
  - `src/routes/api-calls.js:114` → **aiAssistant**
  - `src/routes/voice.js:89` → **aiAssistant**
  - `src/tts/directive-synth.js:19` → **playAudioTts**
- **2 rohe String-Literal-Vergleiche (CC-2)** statt Enum:
  - `src/telephony/voice-render.js:36` — `call.provider === "telnyx"`
  - `src/routes/api-calls.js:188` — `ctx.outboundProvider === "twilio"`
- **PROVIDER-Enum** bereits vorhanden (`src/store/defaults.js:29`, `Object.freeze({TWILIO:"twilio", TELNYX:"telnyx"})`), aber nicht ueberall durchgezogen.

Harte Bestands-Constraints, die gruen bleiben mussten (Regression, ausserhalb der editierten Dateien): `test/telnyx-numbers.test.js` (`numberProvisioning(TWILIO)` wirft `/nicht unterstuetzt/`), `test/telnyx-voice.test.js` + `test/webhook-events.test.js` + `test/telnyx-numbers.test.js` (exakte Adapter-Binding-Identitaet je Provider inkl. arg-loser Defaults).

## 2. Plan (gekuerzt)

**Grundidee:** Alle sechs Port-Factories auf **eine** `ADAPTERS`-Tabelle + eine `pick(port, provider)`-Lookup-Funktion umstellen, die fail-closed wirft statt still auf Twilio zu fallen. Zusaetzlich eine zweite, getrennte Tabelle `PROVIDER_CAPABILITIES` + `providerSupports(provider, capability)` als Ersatz fuer die drei verstreuten Capability-Checks. Alles in `src/telephony/registry.js` (keine sechste Datei — kleinerer Blast-Radius, der Modul-Header bleibt einzige Provider-Wahrheitsquelle fuer Ports).

```js
const PORT = Object.freeze({
  VOICE_CONTROL: "voiceControl", MESSAGING: "messaging",
  MEDIA_TRANSPORT: "mediaTransport", WEBHOOK_EVENTS: "webhookEvents",
  NUMBER_PROVISIONING: "numberProvisioning", VOICE_RENDERER: "voiceRenderer",
});

const ADAPTERS = Object.freeze({
  [PORT.VOICE_CONTROL]:   { twilio: twilioVoice,         telnyx: telnyxVoice },
  [PORT.MESSAGING]:       { twilio: twilioMessaging,     telnyx: telnyxMessaging },
  [PORT.MEDIA_TRANSPORT]: { twilio: twilioMedia,         telnyx: telnyxMedia },
  [PORT.WEBHOOK_EVENTS]:  { twilio: twilioWebhookEvents, telnyx: telnyxWebhookEvents },
  // Twilio-Provisioning bewusst NICHT eingetragen -> pick() wirft (kein stiller
  // Twilio-Fallback fuer einen Geld-Pfad)
  [PORT.NUMBER_PROVISIONING]: { telnyx: telnyxNumberProvisioning },
  // Telnyx-Eintrag = fertiger VoiceRenderer, Arrow liest config.telnyxElevenLabs
  // LAZY zur Aufrufzeit (kein Lazy-Init-Singleton, P15-Konvention)
  [PORT.VOICE_RENDERER]: {
    twilio: { renderDirectives: twilioRenderDirectives },
    telnyx: { renderDirectives: (d) => telnyxRenderDirectives(d, { elevenLabs: config.telnyxElevenLabs }) },
  },
});

function pick(port, provider) {
  const impl = ADAPTERS[port]?.[provider];
  if (impl === undefined) throw new Error(`Provider '${provider}' fuer Port '${port}' nicht unterstuetzt`);
  return impl;
}

export const CAPABILITY = Object.freeze({ AI_ASSISTANT: "aiAssistant", PLAY_AUDIO_TTS: "playAudioTts" });
const PROVIDER_CAPABILITIES = Object.freeze({
  [PROVIDER.TWILIO]: Object.freeze({}),
  [PROVIDER.TELNYX]: Object.freeze({ aiAssistant: true, playAudioTts: true }),
});
export function providerSupports(provider, capability) {
  return PROVIDER_CAPABILITIES[provider]?.[capability] === true;
}
```

**Edits pro Datei (fuenf `src`-Dateien, byte-identische Call-Sites):**

1. **`src/telephony/registry.js`** — sechs Factories auf `pick()` umgestellt; Sonderfaelle explizit erhalten: (a) `fakeOriginate`-Override **vor** `pick` in `voiceControl` (Test-Seam), (b) lazy ElevenLabs-Injektion im Telnyx-Renderer-Arm, (c) `inboundSignatureVerifier`/`providerFromHeaders` unveraendert (bleiben fail-closed-zu-`false`, werfen nie).
2. **`src/routes/api-calls.js`** — Zeile 114 auf `providerSupports(ctx.outboundProvider, CAPABILITY.AI_ASSISTANT)`; Zeile 188 `"twilio"` → `PROVIDER.TWILIO`.
3. **`src/routes/voice.js`** — Zeile 89 auf `providerSupports(provider, CAPABILITY.AI_ASSISTANT)`; toter `PROVIDER`-Import entfernt (nur noch `DEFAULT_PROVIDER` gebraucht).
4. **`src/tts/directive-synth.js`** — Zeile 19 auf `providerSupports(call.provider, CAPABILITY.PLAY_AUDIO_TTS)`; `PROVIDER`-Import durch `providerSupports`/`CAPABILITY` ersetzt.
5. **`src/telephony/voice-render.js`** — Zeile 36 `"telnyx"` → `PROVIDER.TELNYX`, `PROVIDER`-Import ergaenzt.

**Beleg-Pflicht des Plans (Eintrittspfade fail-closed vor `pick()`):** Da die Safety-Auflage eine „normalizeProvider“-Funktion verlangte, die es nicht gibt, wurde tabellarisch belegt, dass jeder reale `call.provider`-Eintrittspfad (Inbound via `providerFromHeaders` → immer Enum|`null`→Default; Outbound via `ctx.outboundProvider` aus einem enum-gegateten Number-Record; `createCall`-Default bei falsy) in Normalbetrieb ausschliesslich Enum-Werte liefert. Einziges dokumentiertes **Residual**: eine out-of-band von Hand korrumpierte `provider`-Spalte in der DB (kein CHECK-Constraint) — dafuer wirft `pick()` jetzt statt still auf Twilio zu misrouten, was der Plan explizit als *strikt sicherer* bewertet.

**Neue Tests (geplant):** `test/telephony-registry.test.js` (Adapter-Identitaet je Port/Provider, Default-Byte-Identitaet, `fakeOriginate`-Override inkl. unbekannter Provider, fail-closed-Wurf ohne Secret-Leak, Signatur-Gate `doesNotThrow`, Vollstaendigkeits-Invariante ueber alle `PROVIDER`-Werte × alle Full-Coverage-Ports, reale Eintrittspfade liefern nur Enum) und `test/provider-capabilities.test.js` (vier bekannte Kombinationen + fail-closed Grenzfaelle unbekannter Provider/Capability/`undefined`/`null`).

**Clean-Code-Ziele:** G5/S2 (5 Ternaries + 3 Checks + 2 Literale → 2 Tabellen + 2 Helfer), G25 (keine Magic Values), F1 (≤2 Args je Helfer), G12 (tote Imports raus), P15 (ElevenLabs-Config bleibt lazy, kein Singleton-Cache).

**DoD:** `node --check` auf allen fuenf Dateien; neue Tests einzeln gruen; Regressions-Anker (`provider-threading`, `signature-dispatch`, `telephony-contract`, `telnyx-voice`, `webhook-events`, `telnyx-numbers`) unveraendert gruen; volle Suite gruen mit gestiegener Zahl; vier DoD-Greps (keine rohen Provider-Literal-Vergleiche mehr in `src/` ausserhalb Kommentaren; `providerSupports` nur in den vier erwarteten Dateien; keine `PROVIDER.TELNYX`-Reste in den drei Ex-Check-Dateien; keine toten `PROVIDER`-Imports).

## 3. Implementierung — Zusammenfassung

Exakt gemaess Plan umgesetzt, Branch `phase/cc-p5-provider-registry` von lokalem `master` (`5ee8a68`, bereits P4 enthaltend) abgezweigt, Commit `3cdd61f`.

- **`src/telephony/registry.js`:** 6 Ternary-Factories auf `ADAPTERS`-Tabelle + `pick(port, provider)` umgestellt; `pick()` wirft fail-closed (`"Provider '<x>' fuer Port '<y>' nicht unterstuetzt"`, ohne Secret) bei fehlendem Eintrag. Drei Sonderfaelle exakt wie geplant erhalten (`fakeOriginate`-Override vor `pick`, lazy ElevenLabs-Injektion, unveraendertes fail-closed-zu-`false` Signatur-Gate). Neue Capability-Seam `CAPABILITY`/`PROVIDER_CAPABILITIES`/`providerSupports`.
- **`src/routes/api-calls.js`**, **`src/routes/voice.js`**, **`src/tts/directive-synth.js`**, **`src/telephony/voice-render.js`:** wie im Plan editiert, Kopf-Kommentare (C2) mitgezogen, tote `PROVIDER`-Imports entfernt.
- **Neue Tests:** `test/telephony-registry.test.js` (9 Faelle), `test/provider-capabilities.test.js` (2 Faelle).
- Alle bestehenden Call-Sites byte-identisch (arg-los/Default → Twilio, `numberProvisioning`-Default → Telnyx bleibt).

### Ergebnisse

- `node --check` sauber auf allen fuenf editierten `src`-Dateien.
- `npm test`: **2357 pass / 0 fail** (inkl. beider neuer Testdateien; Regressions-Anker `provider-threading`, `signature-dispatch`, `telephony-contract` — 46 Faelle einzeln nachgeprueft — sowie pg-Backend-Tests `store-pg.test.js`/`assistant-context-persist-pg.test.js`, 32/32 gruen).
- Alle vier DoD-Greps bestaetigt (keine rohen Provider-Literal-Vergleiche mehr in `src/` ausser den zwei out-of-scope Kommentarzeilen in `state-ops.js:1228-1229`; `providerSupports` exakt in `registry.js` + `api-calls.js` + `voice.js` + `directive-synth.js`; keine `PROVIDER.TELNYX`-Reste in den drei Ex-Check-Dateien; keine toten `PROVIDER`-Imports).
- **Manueller Smoke** (realer Server, `PORT=3999`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `FAKE_ORIGINATE=true`): `/healthz`=200; `POST /voice/incoming` ohne Provider-Header → Twilio-TwiML (mit `speechModel`, byte-identisch); `POST /voice/incoming` mit `telnyx-signature-ed25519`/`telnyx-timestamp`-Headern → Telnyx-TeXML (ohne `speechModel`, absolute URLs) — beweist den End-to-End-Dispatch durch `pick()` fuer beide Provider. Server sauber gestoppt.

### Deviations

Eine dokumentierte Abweichung, kein Scope-Bruch:

- **`test/telnyx-p6-cap-callcontrol.test.js` (Test T8)** musste minimal angepasst werden. Der Test grepte den literalen Quelltext von `api-calls.js` nach dem alten String `ctx.outboundProvider === PROVIDER.TELNYX` — genau dieser Literal-Vergleich ist das, was P5 durch `providerSupports(...)` ersetzt. Angepasst wurde **nur der Quelltext-Marker-String**, nicht die Testlogik/-Aussage (der Test prueft weiterhin `armMaxDurationTimer(call, null)` im C-Telnyx-Zweig). Ohne diesen Ein-Zeilen-Fix waere `npm test` trotz plankonformer Implementierung rot gewesen.
- Branch wurde von lokalem `master` (`5ee8a68`, bereits P4-Merge enthaltend) erstellt statt vom in der Aufgabenbeschreibung genannten Referenz-Commit — das ist der aktuelle lokale `master`-Stand im Worktree und entspricht den Vorgehens-Anweisungen (`git checkout -b … master`), kein Abweichen vom Plan.

### Clean-Code-Selbstcheck (Impl)

G5/S2 PASS (5 Ternaries + 3 Checks + 2 Literale → 2 Tabellen + 2 Helfer). G25 PASS (keine neuen Magic Values, nur benannte `PORT`/`CAPABILITY`/`PROVIDER`-Konstanten). C5/G9 PASS (kein toter/auskommentierter Code). G12 PASS (`PROVIDER`-Imports in `voice.js`/`directive-synth.js` entfernt; in `api-calls.js`/`voice-render.js` bleiben sie, da weiter aktiv genutzt). N7/N3 PASS (intentions-tragende Namen). G30/G34 PASS (jede Factory eine Zeile Delegation an `pick()`). F1 PASS (`pick`/`providerSupports` je 2 Args). P15 PASS (ElevenLabs-Config bleibt pro Aufruf gelesen, nicht beim Tabellenaufbau gecacht — Sonderfall (b) explizit dokumentiert). C2 PASS (keine Datei:Zeile-Kommentare). ESM/kein Build/kein TS unveraendert. Deutsche Kommentare ohne Umlaute per grep auf alle Diff-Zeilen verifiziert (0 Treffer).

## 4. Safety-Urteil (final)

**APPROVED**, keine Blocker.

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true

**Unabhaengiger Testlauf:** volle Suite via `NODE_ENV=test node --test test/*.test.js` → **2357 pass / 0 fail** (der erste npm-Wrapper-Exit-Code 194 war ein `| tail`-Pipe/Flush-Artefakt, keine echte Fehlschlag). Anker- + neue Tests (`provider-threading`, `signature-dispatch`, `telephony-contract`, `telephony-registry`, `provider-capabilities`, `telnyx-p6-cap-callcontrol`) = 33/33 gruen. pg-Backend explizit via pglite bestaetigt (`rls-with-check` + `store-pg-drain-flushes` + `web-auth-pg` = 31/31 gruen, auch in der vollen Suite mit `fail=0` ueber alle pg-getaggten Dateien). `node --check` sauber auf allen fuenf editierten `src`-Dateien.

**Beleg Signatur-fail-closed (Sonderfall c):** `providerFromHeaders` + `inboundSignatureVerifier` bleiben von P5 unveraendert und wurden explizit gegen-getestet, dass sie **niemals werfen** und bei unbekannten/leeren Headern fail-closed `false` liefern (nicht `pick()`-Wurf-Semantik, da hier ein anderer Fehler-Vertrag gilt — der Provider stammt aus ungeprueften Request-Headern, nicht aus einem bereits vertrauten String). Test `test/telephony-registry.test.js` deckt dies mit `assert.doesNotThrow(...)` fuer leere Header UND fuer einen Telnyx-Signatur-Header-Satz ohne gueltigen Public Key ab; beide Faelle liefern `verifyInboundSignature(...) === false`. Zusaetzlich beweist der manuelle Smoke-Test den End-to-End-Dispatch: ein `POST /voice/incoming` mit Telnyx-Signatur-Headern routet ueber die neue `ADAPTERS`/`pick()`-Registry korrekt auf den Telnyx-TeXML-Pfad (kein `speechModel`, absolute URLs), waehrend ein Request ohne Provider-Header weiterhin byte-identisch den Twilio-TwiML-Pfad nimmt.

**Concerns (nicht blockierend):**

1. `voiceRenderer` liefert jetzt ein geteiltes, modul-level eingefrorenes Objekt aus der `ADAPTERS`-Tabelle statt wie auf `master` pro Aufruf ein frisches Objekt. Beobachtbares Verhalten identisch — die Telnyx-`renderDirectives`-Closure liest `config.telnyxElevenLabs` weiterhin zur Aufrufzeit (P15-Lazy-Vertrag gewahrt), Caller mutieren das Rueckgabeobjekt nicht. Nettogewinn (weniger Allokationen), nur zur Kenntnisnahme notiert.
2. Der fail-closed `pick()`-Wurf haengt von der Store-/Config-Invariante ab, dass `number.provider`/`call.provider` immer `twilio|telnyx` sind. Dies wurde fuer jeden Eintrittspfad verifiziert (`resolveSeedProvider`+`seedBootstrapNumberFromConfig`-Doppel-Guard beim Config-Seed; `providerFromHeaders` liefert Enum|`null` inbound; hartkodiertes `PROVIDER.TELNYX` in `requestNumber`; `createCall`-Falsy-Default; pg-Hydrierung nur app-geschriebener Zeilen). Eine korrupte DB-`provider`-Spalte (nicht ueber App-Pfade schreibbar) wuerde als fail-closed 500 auf einem einzelnen Webhook auftauchen (kein Call platziert, keine Kosten, kein Leak), fuer Outbound vom bestehenden `terminateAndBillCall` try/catch abgefangen; die Vollstaendigkeits-Invarianz-Test faengt einen vergessenen dritten Provider bereits vor Deploy.

**Verdict-Kurzfassung:** Scope-sauber (nur P5: 5 `src` + 3 Testdateien; keine Vermischung mit CC-3/CC-4, kein neuer Dep). Safety-Gates intakt und **gestaerkt** (stiller Twilio-Fallback → fail-closed Wurf ist strikt sicherer, jeder `call.provider`-Eintrittspfad verifiziert gegen Nicht-Enum-Werte vor `pick()`). Signaturpruefung byte-identisch zu `master` und fail-closed-zu-`false` (wirft nie). Offenlegungspfad unberuehrt. Fehlertext traegt kein Secret. Eine `ADAPTERS`-Wahrheitsquelle + `pick()`-Helfer + `PROVIDER_CAPABILITIES`/`providerSupports`-Seam ersetzen korrekt die sechs Ternaries und drei S2-22-Capability-Checks; CC-2-Enum-Durchzug erledigt; Call-Sites byte-identisch. Alle Pflicht- und Regressionstests gruen.

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — kein S1/S2-Befund, `blocker: false`.

Alle 2357 Tests gruen auf `phase/cc-p5-provider-registry`, `node --check` sauber auf allen fuenf geaenderten `src`-Dateien. Die Kernsorge des Audit-Auftrags — ein Lazy-Init-Antipattern (P15) bei der `voiceRenderer`-Config-Injektion — wurde explizit geprueft und **nicht bestaetigt**: der Telnyx-Renderer-Eintrag wird zwar einmalig beim Modul-Load in die `ADAPTERS`-Tabelle eingetragen, liest `config.telnyxElevenLabs` aber weiterhin lazy im Funktionskoerper (bei `renderDirectives(d)`-Aufruf) — identisches Late-Binding-Verhalten wie vor P5, nur ohne die vorherige Objekt-Neuallokation pro Aufruf (Nettogewinn, keine Regression). Die versprochene „eine Datenstruktur statt mehrerer Ternaries" trifft fuer 5 der 6 Ports vollstaendig zu (G5-Fix, mit Vollstaendigkeits-Invarianz-Test abgesichert) und loest die drei verstreuten `provider === PROVIDER.TELNYX`-Checks sauber via `providerSupports()`/`CAPABILITY` auf.

### S1-S4-Befunde

| Stufe | Befunde |
|---|---|
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** | 1 |
| **S4** | 1 |

**S3 — G11 (Inkonsistenz)** · `src/telephony/registry.js` (`providerFromHeaders`/`inboundSignatureVerifier`) — Der Header→Provider-Dispatch fuer die Signaturpruefung bleibt ein manuelles `if/else` (Twilio/Telnyx/sonst `false`) statt ueber die neue `ADAPTERS`/`pick()`-Struktur zu laufen, die P5 fuer genau dieses Muster an allen anderen fuenf Ports eingefuehrt hat. Sachlich begruendbar (abweichender Fehler-Vertrag: hier MUSS fail-closed `false` zurueckkommen statt zu werfen wie `pick()`, Provider stammt aus ungeprueften Headern statt einem bereits vertrauten String) — deshalb kein zwingender Fix, aber der Kopf-Kommentar-Anspruch „EINZIGE Provider→Port-Registrierung" erwaehnt diesen dritten Dispatch-Punkt nicht; ein kuenftiger dritter Provider muss auch hier manuell ergaenzt werden, ohne die automatisierte Absicherung, die die Vollstaendigkeits-Invarianz-Test fuer `ADAPTERS` bietet. Fix (optional): Kopf-Kommentar um diesen dritten Dispatch-Punkt ergaenzen oder einen kleinen Vollstaendigkeits-Test fuer `providerFromHeaders`/`inboundSignatureVerifier` ergaenzen.

**S4 — G26/G32 (Praezision/Willkuer)** · `src/telephony/registry.js` (`ADAPTERS = Object.freeze({...})`) — `Object.freeze` ist nur shallow: die verschachtelten Pro-Port-Tabellen (z. B. `ADAPTERS.voiceControl = {twilio:.., telnyx:..}`) sind selbst nicht eingefroren, obwohl der Kommentar eine feste, unveraenderliche Registrierung suggeriert. Aktuell keine ausnutzende Call-Site sichtbar, rein defensiv. Fix (optional): jede Pro-Port-Tabelle zusaetzlich `Object.freeze()`-en (oder Deep-Freeze-Helfer) bzw. Kommentar entschaerfen.

**Nicht als Befund gewertet:** eine Formatierungs-Drift (`prettier --check`) auf je einer Zeile in `voice.js`/`api-calls.js`, die durch die Umbenennung ueber 100 Zeichen (`printWidth 100`) geschoben wurde — dieselbe Datei/der Grossteil des Repos verstoesst bereits vor P5 durchgaengig gegen diese Grenze (kein Format-Hook im Repo), eine Einzelzeile herauszupicken waere inkonsistent zur Bestandskonvention (Regel 3, Vorrang Lesbarkeit/Konsistenz).

### Top-Todos

- Kein Blocker — Merge kann erfolgen.
- Optional: Kopf-Kommentar in `registry.js` um den dritten (Signatur-Header-)Dispatch-Punkt ergaenzen oder per Test absichern (S3).
- Optional: `ADAPTERS`-Untertabellen zusaetzlich deep-freezen oder Kommentar entschaerfen (S4).

## 6. Fix-Runden

**Keine.** Der `=== FIXES ===`-Abschnitt der Quelle ist leer. Der Diff wurde im ersten Anlauf approved (Safety: APPROVED ohne Blocker; Clean-Code: PASS ohne S1/S2-Befund — die zwei S3/S4-Hinweise sind Politur und wurden als optionale Top-Todos festgehalten, nicht als Blocker gewertet) — keine Nacharbeiten in dieser Phase durchgefuehrt.

## 7. Ergebnis

| Kriterium | Status |
|---|---|
| Gate | **PASS** |
| Safety-Review | APPROVED, keine Blocker, 2 nicht-blockierende Concerns |
| Clean-Code-Audit | PASS, S1/S2 leer, 1× S3, 1× S4 (beide optional, kein Blocker) |
| Tests | 2357/2357 gruen (inkl. 9+2 neuer Faelle in `telephony-registry.test.js`/`provider-capabilities.test.js`) |
| Diff-Blast-Radius | 6 Dateien (5 editierte `src`-Dateien + 1 Marker-Nachzug in Bestandstest) + 2 neue Testdateien |
| Betroffene Befunde | S2-22 (3 Capability-Checks), CC-2 (2 Provider-Literale) |
| Neue npm-Dependency | keine |
| Deviations | 1× notwendiger Marker-String-Nachzug in `test/telnyx-p6-cap-callcontrol.test.js` (Testintent unveraendert), 1× Branch-Basis-Klarstellung |
| Merge auf `master` | liegt beim Lead/Orchestrator gemaess Lean-Phasen-Workflow |
