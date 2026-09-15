# Phase IEL-B7a: Stimme des Pflichtsatzes auf dem EL-Inbound-Pfad

**Gate:** PASS
**finalBranch:** phase/iel-b7a-stimme

## Plan (gekuerzt)

Basis: master `137b4b5`. Bestandsbank vorab gruen (15/15 in den betroffenen Testdateien).

Zentrale Befunde vorab:
- Es gibt keinen Synthese-Cache (`directive-synth.js`, `tts/store.js`, `tts/synth.js`) — die Spec-Klausel "Cache-Schluessel" entfaellt ersatzlos.
- `say(text, voiceProfile, audioUrl)` ist positionell — ein 4. Argument `voiceId` verstoesst gegen F1 und ein Objekt an Position 2 wuerde im Azure-Rueckfall zu `unbekanntes voiceProfile` fuehren (Anrufer hoert Stille). Loesung: neuer Builder `sayWithVoiceId({text, voiceProfile, voiceId})`, `say` bleibt unveraendert.
- Der Renderer (`render.js`) liest nur ausgewaehlte Felder — ein zusaetzliches `voiceId`-Feld aendert das TeXML nicht.
- Objekt-Form mit bedingtem Spread: `voiceId` entsteht nur bei nichtleerem String, sonst bleibt jede Direktive byte-identisch zur heutigen Form (`deepStrictEqual`).
- Die Stimm-Probe existiert bereits (`test/helpers/play-tts-stimm-probe.mjs`); statt einer zweiten Regex bekommt der Helfer einen allgemeinen `runPlayTtsProbe`-Export, `playTtsVoiceIdsFor` delegiert daran (G5). Bewusste Abweichung von der Spec-Dateiliste, im Plan begruendet.

Geplante Edits: `src/telephony/directives.js` (Kopfkommentar, `voiceIdField`-Helfer, `sayWithVoiceId`, `gather` um optionales `voiceId` erweitert), `src/tts/directive-synth.js#withPlayAudio` (`d.voiceId || elevenLabsVoiceIdFor(...)`), `test/helpers/play-tts-stimm-probe.mjs` (Refactor). Neue Datei `test/iel-b7a-pflichtsatz-stimme.test.js` mit 9 Faellen (gesetzte voiceId gewinnt bei say/gather, ohne Feld -> heutige Aufloesung, leerer String -> kein Feld/heutige Aufloesung, Kontingent erschoepft -> Azure-`<Say>` byte-identisch, zwei Stimmen -> zwei Synthesen/URLs, Renderer-Invariante).

Pre-Mortem: B8 darf `say(notice, {voiceId})` nicht woertlich aus der Spec uebernehmen (Stille-Risiko) — muss `sayWithVoiceId` nutzen. Fehlerhafte Stimm-ID fuehrt fail-safe zu Azure-`<Say>`, nie zu Stille. Keine neue Dependency/Env/Route, kein Cache, keine Offenlegungs- oder Gate-Beruehrung.

## Impl-Zusammenfassung

Umgesetzt exakt gemaess Plan: `sayWithVoiceId`-Builder (Objekt-Parameter, F1) plus optionales `voiceId`-Feld an `say`/`gather` ueber den gemeinsamen `voiceIdField`-Helfer (G5) — leer/fehlend ergibt byte-identische Bestandsform. `directive-synth.js#withPlayAudio` bevorzugt eine gesetzte `d.voiceId` gegenueber der Profil-Aufloesung; Riegel/Buchung/Azure-Rueckfall unveraendert. `test/helpers/play-tts-stimm-probe.mjs` bekam die injizierbare `runPlayTtsProbe`, `playTtsVoiceIdsFor` delegiert jetzt daran. Neue Testdatei `test/iel-b7a-pflichtsatz-stimme.test.js` mit 9 Faellen (IEL-B7a-1..9) deckt jede geforderte Testpflicht ab. Diff-Scope exakt die 4 im Plan genannten Dateien: `src/telephony/directives.js`, `src/tts/directive-synth.js`, `test/helpers/play-tts-stimm-probe.mjs`, `test/iel-b7a-pflichtsatz-stimme.test.js`.

Verifikation: `node --check` sauber fuer beide src-Dateien, 5733/5733 Tests gruen (erste Vollbank zeigte 1 bekannten Spawn-Race-Flake, zweiter Lauf durchgehend gruen), Lint 0 Fehler nach Fix von 2 anfaenglichen Findings (id-length, no-magic-numbers) im neuen Testfile.

### Deviations
- Kein Cache-Schluessel implementiert (Plan-Befund 0.1): kein Synthese-Cache im Bestand vorhanden, Spec-Klausel entfaellt ersatzlos — im Plan begruendet.
- Eine Helfer-Datei mehr als in einer moeglichen Minimalliste (`play-tts-stimm-probe.mjs` erweitert statt dupliziert) — bewusste G5-Abweichung, im Plan begruendet.
- Smoke-Test uebersprungen (kein `.env` im frischen Worktree, Phase beruehrt keinen Endpunkt/keine Route) — kein Blocker, per Testsuite (9 neue + 15 direkt betroffene + volle Regression 5733/5733) vollstaendig verifiziert.

## Safety-Urteil

**PASS.** Scope eingehalten. Optionales Feld `voiceId` an `say` (ueber `sayWithVoiceId`) und `gather` entsteht nur bei nichtleerem String; ohne Feld ist die Direktive `deepStrictEqual`-gleich zur heutigen Form, Renderer ignoriert das Feld, TeXML byte-identisch (B7a-5/-9). In `withPlayAudio` gewinnt ein gesetztes `d.voiceId`, leerer String faellt auf heutige Aufloesung zurueck. Kontingent-Riegel, Buchung und Azure-Rueckfall laufen unveraendert durch `synthToServeUrl` (B7a-7: kein Anbieter-Aufruf, Azure-`<Say>` byte-identisch bei erschoepftem Kontingent). Kein Aufrufer existiert noch (NICHT-Scope bis B8) — kein Inbound-/Outbound-Pfad aendert sich heute. Offenlegung, Safety-Gates, Auth und Secrets unberuehrt, keine neue Dependency, kein neuer Endpunkt.

Unabhaengig gemessen: 133/133 Tests gruen (alle 17 Testdateien, die betroffene Dateien importieren, `--test-concurrency=4`). Mutations-Gegenprobe (Entfernen von `d.voiceId ||`) liess 3 der 9 neuen Tests fehlschlagen (B7a-1, -2, -8) — die Tests messen also tatsaechlich die Stimmwahl.

**Concerns (nicht blockierend):**
- Abweichung von der Spec: statt einer Builder-Option an `say` ein neuer Export `sayWithVoiceId` (F1-begruendet). `say` selbst unveraendert, `gather` bekam die Option wie in der Spec verlangt. B8 muss `sayWithVoiceId` benutzen, nicht `say`.
- `play-tts-stimm-probe.mjs` steht nicht in der Spec-Dateiliste, wurde aber umgebaut — nur Testcode, Verhalten bestehender Nutzer bleibt gleich (verifiziert).
- `directive-synth.js` prueft bei `d.voiceId || ...` keinen Typ — Typ-Riegel sitzt nur im Builder (`voiceIdField`). Heute ohne Wirkung (kein Aufrufer), fuer B8 vermerkt.
- Kein Synthese-Cache vorhanden — Spec-Pflicht "Cache-Schluessel enthaelt die Stimme" faellt weg; IEL-B7a-8 belegt drei Synthesen mit drei verschiedenen URLs.

## Clean-Code-Audit (s1-s4)

**s1 (Blocker):** keine
**s2 (Blocker):** keine

**s3:**
- F4/G17: `sayWithVoiceId` wird exportiert, hat aber im gesamten Diff (und in `src/`, per grep geprueft) keinen Aufrufer ausserhalb der Tests — nach P1/F4 waere das tote Funktion. Sehr wahrscheinlich bewusst: Mechanismus vor Verdrahtung, die eigentliche Verdrahtung in den EL-Inbound-Init-Pfad kommt in einer Folgephase. Empfehlung: im Phasenstand explizit vermerken, dass B7a bewusst nur die Grundlage legt (dieser Bericht erfuellt das).

**s4 (kosmetisch, kein Handlungsbedarf):**
- Kommentar-Dichte in `directives.js`/`directive-synth.js` hoch, aber jeder Kommentar traegt Kontext (Owner-Entscheidung/Katalog-ID), keine Redundanz (C3).
- Testdatei nutzt durchgaengig benannte Konstanten statt Magic Numbers (`QUOTA`, `TTS_TOKEN_TTL_MS` u.a.) — keine G25-Verstoesse.

**Verdict:** PASS. Diff klein und sauber: eine einzige Aufloesungsquelle fuer `voiceId` (G5), Builder-Funktion vermeidet 4. Positionsargument an `say()` (F1), leerer String erzeugt bewusst kein Feld (byte-identisch getestet), Renderer liest das neue Feld nachweislich nicht. Alle 24 relevanten Tests isoliert gruen, `node --check` sauber.

## Fix-Runden

Keine Fix-Runde in der finalen Kette (`=== FIXES ===` leer). Vor dem Commit wurden 2 Lint-Findings im neuen Testfile (id-length, no-magic-numbers) direkt behoben, danach 0 Lint-Fehler.

## Security (final, ergaenzend zu Safety)

**PASS.** Keine Route, keine Aenderung an Auth-/Signaturpfaden, kein route-policy-/route-auth-inventory-Bezug. Alle Kosten-/Kontingent-Sicherungen laufen unveraendert (GAP-09-Vorab-Riegel, Nach-Buchungs-Riegel, `recordTtsCharacters`, Azure-Rueckfall). Stimm-ID wird in `synth.js#streamUrl` per `encodeURIComponent` kodiert — keine Pfad-Injektion in den ElevenLabs-Aufruf moeglich. Stimm-ID ist kein Geheimnis, kein neues Log. Concerns: fehlender Typ-Riegel bei `d.voiceId` in `directive-synth.js` (heute wirkungslos, kein Aufrufer); Vorgabe fuer B8, `voiceId` ausschliesslich aus Server-Konfiguration zu beziehen, nie aus Request-/Webhook-Parametern; Abnahmetests liefen wegen Worktree-Isolation nicht selbst, nur Diff-Review.
