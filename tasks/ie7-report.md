# Phase IE7 — "Inbound wartet nicht mehr auf die fertige Audiodatei"

- **Gate:** PASS
- **finalBranch:** `phase/ie7-streaming-sprechpfad`
- **headCommit:** `1a36eba5f4c627c50ec53279ad31a443805f6fe8`
- **Datum:** 2026-09-13

## Kernaussage

Der Inbound-Webhook (`/voice/incoming`) wartete bisher auf die **vollständige** ElevenLabs-TTS-Datei (gemessen 2596–6370 ms), bevor er antwortete. Seit IE7 wartet er nur noch auf das **erste Audio-Paket** des ElevenLabs-Streaming-Endpunkts (gemessen 351–391 ms). Der Rest des Stroms läuft im Hintergrund in denselben Puffer und wird erst beim Provider-Abruf `GET /voice/tts/:token` abgewartet. Die Entscheidung `<Play>` gegen Azure-`<Say>`-Rückfall bleibt dabei unverändert **vor** dem Rendern — die Invariante "nie Stille" ist strukturell erzwungen: eine Serve-URL entsteht nur, wenn mindestens ein Paket im Puffer liegt.

## Plan (gekürzt)

**Leitentscheidung:** Statt die Serve-URL vor jeder Provider-Antwort zu vergeben (naheliegend laut Spec, aber würde den Azure-Rückfall hinter das Rendern verlegen), wartet der Webhook nur auf das erste Paket. So bleibt die `<Play>`/Azure-`<Say>`-Entscheidung an ihrer heutigen Naht.

Betroffene Bausteine:
- `src/tts/synth.js`: `synthesizeSpeech` (Vollabruf) **ersetzt** durch `synthesizeSpeechStream` — liefert `{ok, contentType, firstChunkMs, audio: Promise}`; `audio` lehnt NIE ab, trägt mindestens das erste Paket. Zwei Fristen: `firstChunkTimeoutMs` (bis erstes Paket) und `totalTimeoutMs` (Gesamtstrom).
- `src/tts/store.js`: `put`/`takeOnce` wechseln von Bytes auf ein Promise auf Bytes; `takeOnce` löscht den Eintrag **vor** dem Warten (kein Doppelabruf möglich).
- `src/tts/directive-synth.js`: ruft die Stream-Variante auf, Kontingent-Buchung (`recordTtsCharacters`) verschiebt sich auf "erstes Paket da" statt "Datei fertig"; neue Logzeile `[play-tts] Synthese ...` (nur Zahlen/Zustand, kein Token/Bytes/Key).
- `src/routes/voice.js`: `GET /voice/tts/:token` wird async mit try/catch-Rumpf (Express 4 fängt Rejections aus async-Handlern nicht ab), Fehlerpfad antwortet wie Nichtfund (404).
- `src/config.js`: neuer `ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS` (Default 10000, min 1000, max 30000), **nicht** Summand im Turn-Budget; `ELEVENLABS_MODEL`-Default wechselt auf `eleven_v3_conversational`.
- `src/turn-budget.js`: nur Kommentar-Ergänzungen, Zahlen unverändert (`synthTimeoutMs` bleibt Summand, `synthTotalTimeoutMs` bewusst nicht).
- `scripts/inbound-hoerprobe.mjs`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`: Doku/Messwerkzeug nachgezogen.
- Neuer Test-Helfer `test/helpers/fake-tts-stream.mjs` (geteilte Stream-Attrappe statt vier Kopien), neue Testbank `test/ie7-play-tts-streaming.test.js` (7 Fälle).
- Rückweg ohne Deploy: `ELEVENLABS_PLAY_TTS_ENABLED=false` (byte-identischer Azure-Bestand) bzw. `ELEVENLABS_MODEL=eleven_flash_v2_5`.

Pre-Mortem-Risiken (aus dem Plan): Stille durch ins-Leere-laufendes `<Play>` → durch `empty_stream`-Gate abgefangen; hängender async-Handler → try/catch + Gesamtfrist; Kontingent-Riegel wirkungslos → Buchung bewusst vor die Webhook-Antwort verschoben; Turn-Budget-Sprengung durch zweite Frist → explizit kein Summand, testgepinnt.

## Impl-Zusammenfassung

Wie geplant umgesetzt. `synthesizeSpeech` vollständig ersetzt (kein zweiter Produktionskonsument, kein toter Code). `ttsStore` kennt jetzt genau eine Ablageform (Promise auf Bytes). Neue Konstanten statt Magic Numbers (`TTS_STREAM_SUFFIX`, `DEFAULT_CONTENT_TYPE`, `DETAIL_MAX_CHARS`, `HTTP_NOT_FOUND`). `makeDeadline` als einziger Abbruch-Griff in `synth.js`. Regressionsbank lief zweimal vollständig grün (6045/6045 bzw. 6064/6064 inkl. i18n-Gates-Tests separat); `npm run test:gates`: 126 grün / 3 rot, alle drei bestandsrot und fachfremd (GAP-05, GAP-15, E2E-03), VOICE-12 bleibt grün.

### Deviations
1. `npm test` brach in der Impl-Sandbox ohne Ausgabe ab (Exit 194) — Ersatz: `node test/testbaenke-run.mjs regression -- --test-concurrency=4` (identische Bank/Filter). In der Safety-Verifikation lief `npm test` selbst normal durch (Exit 0, 6064 grün).
2. Pre-Commit-Gate `check-staged-suppressions` erzwang zusätzliche, nicht geplante Anpassungen: `eslint-suppressions.json` bereinigt (netto Senkung), `eslint-legacy-exceptions.json`-Pin für `src/routes/voice.js` nachgezogen (274→279 Zeilen wegen try/catch), mit Chronik-Eintrag — kein neuer Altlast-Eintrag, keine neue Verstoßart.
3. `test/tts-quota-counter.test.js` behält eigenen Fake-Audio-Inhalt (nur Antwortform vom geteilten Helfer), um einen unzusammenhängenden 64-Befund-Aufräumlauf zu vermeiden.
4. `src/routes/voice.js`: bestehendes `404` zusätzlich als `HTTP_NOT_FOUND`-Konstante benannt, um keine zweite Magic Number einzuführen.
5. `ELEVENLABS_MODEL=eleven_v3_conversational` als neuer Default ist NICHT gegen die echte ElevenLabs-API geprüft (kein Key/kein echter Call in der Impl-Sitzung).
6. Hörprobe-Lauf mit Flag AN (echter ElevenLabs-Call) bewusst nicht gefahren (keine echten Providerkosten auslösen) — stattdessen als Spawn-Test gegen langsamen Fake-Origin gepinnt.

## Safety-Urteil

**approved: true — PASS mit Auflagen-Hinweisen, keine Blocker.**

- Alle Kern-Kriterien intakt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`.
- Unabhängig nachgemessen: `npm test -- --test-concurrency=4` → 6064/6064 grün (beide Backends json+pg in derselben Suite verifiziert, u.a. FORCE-RLS-Pfade); `npm run lint` 0 errors/68 Warnungen (Bestand); eslint-Fingerabdruck der geänderten Dateien exakt wie angemeldet; eigener Smoke (`inbound:hoerprobe`, Flag aus) zeigt unveränderten Offenlegungssatz als erster Satz, `sprechpfad=azure_say`, `webhook_wartezeit_ms=31`; `package.json`/`package-lock.json`-Diff leer (keine neue Dependency); Arbeitsbaum sauber, genau ein Commit über master.
- Kein geschütztes Gate im Diff angefasst (state-ops.js, outbound-gates.js, activation.js, callee-is-owner.js, auth.js, web-auth.js, middleware.js, route-policy.js — alle nicht im Diff). Turn-Budget-Rechnung zahlenidentisch. GAP-09-Kontingentriegel bleiben beide wirksam, Buchungszeitpunkt verschoben und testgepinnt. `disclosureSentence` unverändert fest verdrahtet, claude.js/bridge.js nicht im Diff. Auth-Ausnahme für `/voice/tts/:token` wandert nicht, Reihenfolge vor Signaturprüfung unverändert.

### Concerns (kein Blocker, dokumentiert)
1. `ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS < ELEVENLABS_TTS_TOKEN_TTL_MS` ist nur behauptet, nicht durch einen Boot-Wächter erzwungen — bei einer ungünstigen Env-Kombination könnte der TTL-Timer den Store-Eintrag löschen, während der Strom noch läuft. Bei den ausgelieferten Defaults (10000 vs. 60000) ungefährlich. Empfehlung für Folgephase: Prüfung in `boot-guard.js`.
2. Modellwechsel auf `eleven_v3_conversational` ändert vermutlich den ElevenLabs-Credit-Faktor je Zeichen; `ttsCharacterQuota` zählt weiterhin Zeichen — Owner sollte den Schwellenwert vor Deploy gegen den neuen Faktor nachrechnen.
3. `GET /voice/tts/:token` hält jetzt eine Verbindung bis zu `synthTotalTimeoutMs` offen — geprüfter, akzeptierter Zuwachs (256-Bit-Token, Löschung vor dem Warten, kein Log), in PLAN-SECURITY.md eingetragen.
4. Beim Nach-Buchungs-Riegel (Kontingent erschöpft) wird der Hintergrund-Strom nicht per `reader.cancel()` abgebrochen — kein Leck, nur vergebene Bandbreite bis zu `synthTotalTimeoutMs`.
5. Neue Testdatei `test/ie7-play-tts-streaming.test.js` besteht `prettier --check` nicht (Bestand in mehreren anderen Dateien bereits unsauber) — Kosmetik, kein CI-Gate.

## Clean-Code-Audit (S1–S4)

**verdict: PASS, blocker: false**

- **S1 (Blocker):** keine Funde.
- **S2 (Blocker):** keine Funde.
- **S3 (informativ):**
  1. `src/tts/directive-synth.js:113` — `result.audio` bleibt beim Nach-Riegel (Kontingent erschöpft) ein nie konsumiertes Promise; explizit kommentiert und testabgedeckt, dass es nie ablehnt (kein `unhandledRejection`). Nur Lesehinweis.
  2. `src/tts/directive-synth.js:99-118` (`loggedAudioBytes`) — Funktionsname verspricht "liefert geloggte Bytes", tut aber zusätzlich await+Logging als Nebeneffekt (N7). Lesbar im Kontext, nur Politur-Kandidat.
- **S4 (informativ):**
  1. `test/ip4-tts-kontingent.test.js:44-45` — doppelte Leerzeile nach Entfernen von `zaehlendesFetch()` stehengeblieben; kosmetisch entfernbar.
  2. Positiv vermerkt: IE7-Kommentare, Doku (.env.example, render.yaml, PLAN-SECURITY.md) und eslint-Buchhaltung lückenlos synchron gehalten.

Hervorgehoben im Audit: ein Abbruch-Griff (`makeDeadline`) statt verstreuter `clearTimeout`-Aufrufe; `ttsStore` konsequent auf Promise-Form umgestellt inkl. Race-Test (zweiter Abruf vs. laufender Strom); async-Handler korrekt in try/catch; `HTTP_NOT_FOUND`-Konstante statt Magic Number; `turn-budget.js` dokumentiert und testet explizit, dass die neue Gesamtfrist nicht auf der Turn-Wanduhr liegt; alle drei Kern-Invarianten (nie Stille, nie leeres `<Play>`, einmalige Kontingentbuchung auch bei Abbruch) je mit eigenem Test gepinnt, inkl. Spawn-Ebenen-Test mit echtem langsamem HTTP-Origin.

## Fix-Runden

Keine — der erste Review-Durchlauf (Safety + Clean-Code) ergab direkt PASS ohne Blocker. Die im Audit genannten `topTodos` (doppelte Leerzeile entfernen, vor Merge echten `npm test`/`test:gates` laufen lassen) sind optional/bereits durch die Safety-Verifikation erledigt, nicht in dieser Sitzung nachgezogen.
