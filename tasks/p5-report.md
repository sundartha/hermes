# Phase P5 (f1-p5) — Realtime-Engine sprachabhaengig — Detailbericht

## Status

GATE = **PASS** (dualer Review: Safety + Clean-Code, beide PASS, 0 Blocker).
Fix-Runden: **0**. Tests: **800/800 gruen** (json + pglite in der Suite).
Nicht committet — Merge erfolgt im Lead.

## Scope

Realtime-Engine (NUR `VOICE_ENGINE=realtime`, `bridge.js` open-Handshake) sprachabhaengig
gemacht: OpenAI-Instructions/Voice + Whisper-Locale + Sprach-Opener. Strikt begrenzt auf
`bridge.js` + i18n-Bundle. KEIN Geo/Provisioning/Land-Gate angefasst. Die Budget-Engine
(turn-basiert, der heute live laufende Default) ist von P5 nicht beruehrt.

## Umgesetzte Dateien + Kernentscheidungen

### `src/i18n/locales.js`
Pro Locale 3 neue Felder, getrennt vom bestehenden `voiceProfile`/`sttLocale`-Namensraum:
- `realtimeVoice` — eigener OpenAI-Realtime-Voice-Namensraum.
- `whisperLocale` — ISO-639 Code fuer `input_audio_transcription.language`.
- `realtimeOpener { outbound(disclosure), inbound }` — kuratierter Steuertext je Sprache,
  Offenlegung als Pflichtsatz in der outbound-Variante eingebettet.

- **A1 — DE byte-identisch via null-Sentinel:** `de.realtimeVoice = null`,
  `de.whisperLocale = null`. Die Bridge laesst dann das `language`-Feld weg (Whisper-Auto-Detect,
  Bestand) und faellt auf `config.realtimeVoice` zurueck. FR/EN tragen explizite ISO-639-Codes
  (`fr`/`en`, R13-Haertung).
- **A3 — DE-Voice an config gekoppelt:** `loc.realtimeVoice ?? config.realtimeVoice` ->
  DE bleibt an `config.realtimeVoice` ("alloy" Default, env-uebersteuerbar).
- DE-Opener-Texte **zeichengleich** zum frueheren bridge.js-Inline-Text extrahiert
  (De-Duplizierung in das EINE Bundle, keine neue Duplizierung).
- FR/EN-Realtime-Voices als benannte Konstanten: `REALTIME_VOICE_FR = "shimmer"`,
  `REALTIME_VOICE_EN = "alloy"` (echte OpenAI-Realtime-Voices).

### `src/bridge.js` (open-Handler, ~Z.122-150; KEINE als HEIKEL markierte Stelle beruehrt)
- `const loc = localeFor(call.language)` einmal geholt (fail-closed -> immer definiertes Locale).
- `voice: loc.realtimeVoice ?? config.realtimeVoice`.
- `if (loc.whisperLocale) transcription.language = loc.whisperLocale;` — DE bleibt `{model:"whisper-1"}`.
- Opener aus `loc.realtimeOpener`: outbound = `loc.realtimeOpener.outbound(disclosureSentence(call))`,
  inbound = `loc.realtimeOpener.inbound`.
- `disclosureSentence(call)` bleibt der fest verdrahtete erste Outbound-Satz (Regel 2).
- Keine neuen Deps, Kommentare deutsch ohne Umlaute.

### `test/bridge-openai-event.test.js` + `test/f1-i18n-locale.test.js`
6 neue Tests: 3 Bridge (DE Auto-Detect + alloy unveraendert; FR Voice shimmer + Whisper fr +
FR-Opener mit FR-Offenlegung outbound; EN Voice alloy + Whisper en + EN-Inbound-Opener ohne
Offenlegung) + 3 Bundle-Unit (Sentinels/Voices/ISO; Opener-Struktur + DE byte-identisch;
localeFor-Fallback). Die beiden DE-Charakterisierungs-Tests (open-Handshake `voice==="alloy"`,
Inbound-Opener-Wortlaut) blieben UNVERAENDERT gruen.

## Bewusste Abweichungen (alle DE-invariant + safety-konform)

- **A1** — DE strikt byte-identisch via null-Sentinel statt einheitlich-explizitem `de`-Whisper-Locale.
  Spec fordert "byte-identisch DE" haerter als die R13-Haertung; null-Sentinel erfuellt beides.
  Plan-ALTERNATIVE (DE auch explizit `de`) bewusst NICHT gewaehlt.
- **A4** — `instructions()`-"SPRECHWEISE"-Engine-Anweisung bleibt deutsch (sprachunabhaengige
  Engine-Anweisung, byte-identisch DE), nicht pro Sprache in den Bundle gezogen.
- **FR/EN-Voice-Namen** (offener Owner-Punkt #3): `shimmer`/`alloy` gesetzt. Risiko minimiert
  durch fail-closed (Provider lehnt unbekannte Voice ab) + Produktiv-Default bleibt config/de +
  Live-Smoke-Gate vor Produktiv-Schalter. Andere Stimmen = 1-Zeilen-Change pro Locale.

Keine Abweichung beruehrt Safety-/Kosten-/Idempotenz-Gates, die Offenlegung oder die DE-Invariante.

## Invarianten (verifiziert am echten Code)

- **DE byte-identisch:** `realtimeVoice=null`/`whisperLocale=null` -> `config.realtimeVoice` bzw.
  Whisper-Auto-Detect; DE-Opener zeichengleich. Durch unveraenderte DE-Charakterisierungs-Tests belegt.
- **Offenlegung fest verdrahtet (Regel 2):** outbound-Opener bettet `disclosureSentence(call)` als
  Pflicht-Erstsatz ein; FR/EN-Varianten kuratiert im Bundle, nicht abschaltbar/frei waehlbar;
  inbound traegt korrekt keine Offenlegung.
- **fail-closed:** `localeFor()` faellt auf `de` zurueck (kein stiller EN/DE-Fehl-Fallback;
  unbekannte Sprache -> de). `loc.*`-Felder nie undefined -> kein Null-Deref.
- **Praezedenz unveraendert:** `settings.language -> number.language -> tenant.defaultLanguage -> "de"`
  (`resolveCallLanguage` in state-ops, von P5 nicht beruehrt), korrekt nach `call.language`
  durchgereicht (server.js -> createCall -> bridge `localeFor(call.language)`).
- Keine neue npm-Dep; Budget-Schnittmenge unberuehrt; keine Secrets geleakt; Kommentare deutsch
  ohne Umlaute.

## Test-Ergebnis

- `npm test`: **800/800 pass, 0 fail** (json + pglite). Keine pre-existing roten Tests.
- Gezielt: `test/bridge-openai-event.test.js` + `test/f1-i18n-locale.test.js` zusammen **43/43**.
- `node --check` beider Quelldateien gruen.

## Review-Verdikte

- **Safety/Verhalten — PASS, 0 Blocker.** DE byte-identisch bewiesen; Offenlegung fest verdrahtet;
  fail-closed korrekt; Praezedenz unveraendert; keine Gate-Aufweichung.
  - S3 (kein Blocker): EN=`alloy` == `config.realtimeVoice`-Default -> EN-Realtime gegen
    `REALTIME_VOICE`-Env-Aenderung nicht mehr neutral (gewollt). Bei Live-Smoke akustisch pruefen.
  - Hinweis (kein Blocker): Whisper-language nur fuer FR/EN; DE bleibt Auto-Detect (R13, Owner-Entscheidung).
- **Clean-Code — PASS, keine S1/S2.** Magic Numbers (benannte Konstanten), kein toter/auskommentierter
  Code (alter Inline-Opener vollstaendig entfernt), korrekte De-Duplizierung ins EINE Bundle,
  Nesting <=2, Funktionslaenge ok, neues Verhalten durch 6 Tests abgedeckt.
  - Hinweis (kein Blocker, ausserhalb P5-Diff): `bridge.js:51` haengt eine deutsche SPRECHWEISE-Klausel
    hart an `instructions(call)` an -> bei FR/EN-Realtime koennte das den systemPrompt verunreinigen.
    Bestandszeile, **Folge-Ticket** fuer kuenftige Phase, nicht hier fixen (SCOPE).

## Offene Punkte / Smoke-Gates

- **Live-Smoke-Gate (Owner #3, R10):** FR/EN-Realtime-Voices (`shimmer`/`alloy`) akustisch
  verifizieren, bevor Produktiv-Flags gesetzt werden. Produktiv-Default bleibt bis dahin config/de.
- **Folge-Ticket:** deutsche SPRECHWEISE-Klausel in `instructions()` sprachabhaengig machen
  (`bridge.js:51`, ausserhalb P5-Scope).
- Commit/Merge im Lead ausstehend.
