# Phase P4 (f1-p4) — Detailbericht

## Status

ABGESCHLOSSEN. Gate = PASS (dualer Review: Safety + Clean-Code, beide PASS, 0 Blocker).
Tests gruen: 794/794, 0 fail. Fix-Runden bis PASS: 0.

Scope: Statische Texte ins i18n-Bundle + Inbound-Wiring (Nummer -> Sprache) + EN-Bundle +
voiceProfile-Durchreichung. DE durchgaengig byte-identisch.

## Umgesetzte Dateien + Kernentscheidungen

### EN-Bundle
- `src/i18n/locales.js` — neue `en`-Locale: sttLocale `en-GB`, voiceProfile `en-female-neural`,
  kuratierte **fest verdrahtete EN-Offenlegung** (R8, nur `ownerName` gebunden, nicht abschaltbar),
  EN-Summary (englische JSON-Key-Texte, identische Keys), speechClause, bridgePhrase, greetingDefault.
- `src/telephony/directives.js` — `VOICE_PROFILE.EN_FEMALE_NEURAL`.
- `src/telephony/adapters/twilio/render.js` — Twilio `Polly.Amy-Neural` / `en-GB`, fail-closed.
- `src/telephony/adapters/telnyx/render.js` — Telnyx `Azure.en-GB-SoniaNeural` / `en-GB`, fail-closed.
  Beide Renderer werfen bei unbekanntem Profil (R9/R10, kein stiller DE-Fallback).

### Statische Texte (sprachabhaengig)
- `llmDegradedSpeech` / `turnErrorSpeech` / `noSpeechReprompt` / `budgetExhaustedHangup` /
  `greetingDefault` als Bundle-Felder. DE byte-identisch aus `server.js`/`defaults.js` uebernommen,
  per i18n-Test gepinnt.
- `src/server.js` — liest die Texte pro `call.language`; die drei hartkodierten Server-Konstanten entfernt.

### Inbound-Wiring (Nummer -> Sprache)
- `numberRecordByE164` (Schwester-Query, liefert vollen aktiven Record; `findTenantByNumber`
  delegiert daran -> EINE Quelle der Routing-Regel, G5 sauber).
- `resolveCallLanguage` — **Praezedenz #8 an EINER Stelle**:
  `settings.language -> number.language -> tenant.defaultLanguage -> "de"`, fail-safe ueber `localeFor`.
- `/voice/incoming` holt in EINEM Lookup `tenantId` + `language`, reicht `language` an `createCall`,
  Budget-Hangup in Zielsprache.
- `turnDirectives` + neuer `sayInCallVoice`-Helper leiten `voiceProfile` aus `call.language` ab ->
  DE-Call rendert byte-identisch (Snapshot gruen).
- Betroffen: `src/store/state-ops.js`, `src/store.js` (Fassade +2: `numberRecordByE164` /
  `resolveCallLanguage`, Count 41 -> 43), `src/server.js`.

### settings.language als optionales Override (Praezedenz-Fix)
- `src/store/defaults.js` — `defaultSettings().language` von `"de"` auf `null` (harter `"de"`-Default
  haette `number.language` IMMER ueberstimmt).
- `updateSettings` — eigene `language`-Validierung (`SUPPORTED_LANGUAGES` bzw. `""`/`null` = automatisch;
  fail-closed: Freitext/unbekannt verworfen; loest die `typeof null === "object"`-Falle korrekt).
- `src/db/schema.sql` — `settings.language` NULLABLE (`DROP NOT NULL`, idempotent fuer P1-DBs).
- `src/store/json.js`, `src/store/pg.js` — Flush/Hydrate angepasst.
- `src/self-service.js` — `language` in `SELF_SERVICE_FREE_FIELDS` (gegen `SUPPORTED_LANGUAGES` validiert).
- `public/tenant.html` — `language`-Select (Automatisch / de / fr / en) in render + patch verdrahtet.

### Owner-Fragen entschieden
- A) language self-service: JA (validiert gegen `SUPPORTED_LANGUAGES`).
- B) FR/EN-Greeting-Default NICHT rueckwirkend (DE-Seed bleibt, minimal).
- C) `deepgramModel` NICHT als Bundle-Feld (nova-2/nova-3 mehrsprachig, Renderer-Default unberuehrt).
- D) EN-Voices `Polly.Amy-Neural` / `Azure.en-GB-SoniaNeural` fail-closed (Live = Smoke-Gate).

## Bewusste Abweichungen

1. `settings.language`-Default `"de"` -> `null` (Praezedenz-Fix, vom Plan vorgesehen). 3 P1-Assertions in
   `f1-geo-store.test.js` angepasst (alte erwarteten `"de"` = alte P1-Semantik, kein Bug-Maskieren).
   `schema.sql` `NOT NULL DEFAULT 'de'` -> NULLABLE (`DROP NOT NULL` idempotent).
2. Kein rueckwirkender FR/EN-Greeting-Default fuer Bestands-Tenants (Owner-Frage B); greeting bleibt
   DE-Seed, FR/EN kommt ueber Vorlagen/P6.
3. Bestands-pg-Zeilen mit `language='de'` (aus P1-DBs) wirken nach dem NULLABLE-Switch wie ein expliziter
   `'de'`-Override — real irrelevant (Owner #9: nur Owner=DE existiert, DE-Override auf DE-Nummer = no-op);
   KEIN destruktiver `'de'`->NULL-Backfill (R7 trivial).
4. `unroutable`-Hangup (kein Tenant/Call) bleibt bewusst DE byte-identisch (keine Sprache ableitbar).
5. Realtime-Pfad (`streamDirectives`/`bridge`) unberuehrt — das ist P5.
6. Kein neuer config-Env-Var -> BASE_ENV unberuehrt (keine BASE_ENV-Drift). Keine neuen npm-Deps.

## Invarianten

- **DE byte-identisch**: `localeFor('de').voiceProfile == VOICE_PROFILE.DE_FEMALE_NEURAL`
  (= bisheriger gatherD/sayD-Default); DE-Statiktexte per Test gepinnt;
  `greetingDefault == DEFAULT_GREETING` (eine Quelle); DE-Inbound-Snapshot `Polly.Vicki`/`de-DE`.
- **fail-closed**: Renderer `voiceAttrs` wirft bei unbekanntem Profil (alle 3 Provider, kein stiller
  DE-Fallback); unbekannte `language` -> `localeFor` -> `de` (R7-Fail-safe, gewollt);
  `/voice/incoming` Hangup fail-closed bei unbekannter/nicht-aktiver Nummer;
  `updateSettings`-language-Validierung fail-closed gegen `SUPPORTED_LANGUAGES`/`""`/`null`.
- **Praezedenz** `settings.language -> number.language -> tenant.defaultLanguage -> "de"` an EINER Stelle
  (`resolveCallLanguage`), 4 Stufen-Tests.
- Offenlegung FR/EN fest verdrahtet/kuratiert (nur `ownerName` gebunden, nicht abschaltbar); FR unveraendert.
- Budget-Schnittmenge + Provider-Signaturpruefung unangetastet.

## Test-Ergebnis

- `npm test`: **794/794 gruen, 0 fail** (json-Default UND pglite-in-process; Suite enthaelt beide
  Backends; `f1-geo-store`/`store-pg`/`store-pg-multitenant` gegen pglite explizit nachverifiziert).
- Keine pre-existing roten Tests beruehrt.
- `node --check` auf allen 11 geaenderten Quelldateien + 5 Testdateien OK.
- Neue/erweiterte Tests: EN-Render-Snapshots (Twilio+Telnyx), EN-Bundle-Vertrag + DE-Statiktext-byte-Pin,
  `resolveCallLanguage`-Unit (4 Praezedenz-Stufen), `numberRecordByE164`,
  `updateSettings`-language-Validierung, Inbound-Wiring DE/FR/EN -> `call.language` + Override-Praezedenz (spawn).

## Review-Verdikte

### Safety/Verhalten — PASS, 0 Blocker
Alle harten Regeln erfuellt: DE byte-identisch verifiziert, EN-Offenlegung fest verdrahtet/kuratiert
und nicht abschaltbar, Praezedenz an EINER Stelle, fail-closed in allen 3 Renderern und am Inbound-Hangup,
`language` durch `createCall` und alle Voice-Pfade (turn/error/reprompt/end) gereicht, Budget-Schnittmenge +
Signaturpruefung unangetastet, `updateSettings` fail-closed (typeof-null-Falle geloest), self-service-Whitelist
sicher, keine neuen Deps, keine Secrets, Kommentare deutsch ohne Umlaute.
Shoulds (kein Blocker): (1) Semantik-Hinweis NOT-NULL->NULLABLE bei `settings.language` fuer Bestands-`'de'`-Zeilen
(in Prod harmlos, im Diff dokumentiert); (2) Live-Freischaltung der EN-Voices bleibt korrekt als Smoke-Gate offen.

### Clean-Code (.claude/refs/clean-code.md) — PASS, keine S1/S2
DE byte-identisch (Snapshot-Pins), Praezedenz an EINER Stelle, `findTenantByNumber` delegiert an
`numberRecordByE164` (keine doppelte Routing-Regel, G5), language-Override fail-closed, en-GB volles BCP-47 (R9),
Schema-Migration additiv NULLABLE + idempotent, keine Magic Numbers, kein toter/auskommentierter Code, keine
abgeschalteten Checks, keine zu tiefe Verschachtelung, keine >100-Zeilen-Funktion, neues Verhalten voll getestet.
Shoulds:
- **S3** — `greetingDefault` je Sprache im Bundle gesetzt, aber KEIN Produktions-Konsument:
  Inbound-Greeting (`server.js`) liest weiter `ctx.settings.greeting`; `defaultSettings().greeting` +
  self-service `GREETING_TEMPLATES` sind DE-only. Folge: FR/EN-Tenant erhaelt DE-Greeting; die
  FR/EN-`greetingDefault`-Strings werden nur vom Test gelesen. Empfehlung: Greeting-Auswahl an
  `localeFor(call.language).greetingDefault` koppeln ODER als bewusst-deferred dokumentieren.
- **S4** — `turnDirectives` und `sayInCallVoice` leiten beide `voiceProfile` via
  `localeFor(call.language).voiceProfile` ab; Kommentar bei `sayInCallVoice` ("EINE Ableitungsstelle")
  ueberzeichnet die Zentralisierung. Optional: `voiceProfileFor(call)`-Helper oder Kommentar entschaerfen.

## Offene Punkte / Smoke-Gates

- **Live-Freischaltung EN-Voices** (Polly Amy / Azure Sonia / Deepgram EN) bleibt Smoke-Gate (R9/R10);
  Produktiv-Flags aus, im Bundle-Kommentar vermerkt — nicht Teil von P4.
- **greetingDefault-Verdrahtung FR/EN** (S3): Greeting-Auswahl an `localeFor(call.language).greetingDefault`
  koppeln ODER explizit als deferred markieren (aktuell DE-Greeting fuer FR/EN-Tenant).
- **Realtime-Pfad** (streamDirectives/bridge) ist P5.
- **Semantik-Hinweis** NULLABLE `settings.language`: bei spaeterer Umstellung von Bestands-DBs mit gesetztem
  `'de'` auf number.language-Aufloesung beachten (kein Backfill durchgefuehrt).
