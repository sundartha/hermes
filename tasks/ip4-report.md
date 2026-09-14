# Phase IP4 — Inbound spricht dieselbe Stimme wie Outbound

- **Gate:** PASS
- **finalBranch:** `phase/ip4-stimm-kohaerenz`
- **headCommit:** `e92d35c` (auf `master` @ `74c468e`)

## Ziel

Inbound-Sprechpfad (Play-TTS via ElevenLabs, hinter `ELEVENLABS_PLAY_TTS_ENABLED`) soll dieselbe Stimme sprechen wie Outbound. Diese Phase baut den Beweis dafuer (Anker-Test), macht den scharfen Sprechpfad am laufenden Dienst sichtbar (Boot-Banner) und belegt den Kontingent-Riegel als echtes Kosten-Gate — sie flippt den Schalter selbst NICHT.

## Plan (gekuerzt)

- **Ausgangslage:** geteilter Resolver `elevenLabsVoiceIdFor` (in `elevenlabs-voice.js`) mit genau zwei Konsumenten (Outbound-Anrufstart, Play-TTS-Vorabsynthese); Kontingent-Riegel existiert doppelt (Vor-Riegel + Nach-Buchungs-Riegel); Assistant-Pfad bleibt bewusst aussen vor (sprachblind, R5).
- **Befund vor Umsetzung:** die IP2-Sprechpfad-Klassifikation lag in `scripts/inbound-hoerprobe.mjs`, das `test/helpers.js` importiert — `src/boot.js` durfte das nicht mitziehen. Deshalb Umzug des Namensvorrats nach `src/telephony/sprechpfad.js` (rein, kein IO, kein `config`-Import).
- **Neue Dateien:**
  - `src/telephony/sprechpfad.js` — `SPRECHPFAD`-Token, `classifySprechpfad(texml)`, `armedInboundSprechpfad(elevenLabsPlayTts)`.
  - `test/helpers/play-tts-stimm-probe.mjs` — extrahiertes Messwerkzeug fuer die Voice-ID der Vorabsynthese (bisher lokal in `test/directive-synth.test.js` dupliziert).
  - `test/ip4-stimm-anker.test.js` — Scope 1: misst je Sprache (de/fr/en) drei Stellen (Resolver, echter Outbound-Anrufstart-Koerper, Play-TTS-Vorabsynthese) gegen denselben Wert, ohne ID-Literale; fail-closed gegen eine vierte, unbedachte Sprache.
  - `test/ip4-tts-kontingent.test.js` — Scope 3: Vor-Riegel (kein Provider-Aufruf bei erschoepftem Kontingent) und Nach-Riegel (Audio verworfen), je mit Positiv-Kontrolle, plus Grenzfall `quota=0`.
  - `test/ip4-boot-sprechpfad.test.js` — Scope 2: reine Banner-Funktion in beiden Richtungen, Mutationsprobe gegen `process.env`, ein Spawn-Test, der die Boot-Aussage gegen das tatsaechlich gerenderte TeXML desselben Servers prueft.
- **Edits:** `src/boot.js` (Import + neue reine `inboundSprechpfadBannerLine`-Funktion + ein Aufruf in `logBootBanner`), `scripts/inbound-hoerprobe.mjs` (Import statt lokaler Definition), `test/ip2-sprechpfad-klassifikation.test.js` (Import folgt Umzug), `test/directive-synth.test.js` (nutzt extrahiertes Messwerkzeug), `test/helpers/elevenlabs-anrufstart-attrappe.mjs` (additiver Export `PIN_PLATTFORM_STIMME`), `render.yaml` (reiner Kommentar: Betriebsanweisung fuer den spaeteren Owner-Flip).
- **Explizit NICHT angefasst:** `src/tts/directive-synth.js` (nur gelesen/geprueft), `elevenlabs-voice.js`/Profilkarte, `src/elevenlabs/outbound.js`, `call-locale.js`, `ELEVENLABS_MODEL`/Timeouts, Anbieter-Push-Skripte, `.env.example`, Assistant-Pfad (`adapters/telnyx/voice.js`, `telnyx-assistant-provision.mjs`).
- **Absolute Regeln:** keine Gate-Verschiebung, kein neuer Endpunkt, keine neue Env-Variable, keine Secrets in der Boot-Zeile (nur Pfad-Token + Boolean).

## Impl-Zusammenfassung

- 11 Dateien geaendert/neu, +543/-66, ein Commit `e92d35c` auf `phase/ip4-stimm-kohaerenz`.
- Produktionsseitig minimal: eine neue reine Datei (`sprechpfad.js`) + 3 Zeilen/eine Funktion in `boot.js`. Kein Verhalten am Sprechpfad selbst geaendert (Default bleibt `azure_say`, byte-identisch zum Bestand).
- Boot-Default-Zeile: `Inbound-Sprechpfad: azure_say (ELEVENLABS_PLAY_TTS_ENABLED=false) - play_tts faellt bei erschoepftem Kontingent, Synthese-Fehler oder Anbieter ohne Play-Audio fail-safe auf azure_say zurueck`.
- `npm test` (`--test-concurrency=4`): 6033 gruen, 0 rot. `npm run test:gates`: 126 gruen / 3 rot — dieselben drei Katalog-Befunde wie auf `master` (GAP-05, GAP-15, E2E-03), unveraendert; `VOICE-12` gruen.
- Smoke: Spawn-Test IP4-4 vergleicht gemeldeten Boot-Token gegen klassifiziertes TeXML desselben Servers (`azure_say == azure_say`, HTTP 200); `node scripts/inbound-hoerprobe.mjs` liefert nach dem Modul-Umzug unveraendert `sprechpfad=azure_say voice=Azure.de-DE-KatjaNeural`.
- eslint 0 Fehler / 68 Warnungen (Bestandsanspruch, keine in beruehrten Dateien), knip ohne neuen Befund.

### Deviations

1. **Zusatz-Export im neuen Test-Helfer:** `playTtsSynthConfig()` und `PROBE_API_KEY` zusaetzlich aus `play-tts-stimm-probe.mjs` exportiert — verhindert eine vierte handkopierte Play-TTS-Fake-Konfiguration (S2-Vermeidung); weiterhin genau eine neue Helferdatei wie geplant.
2. **Benennung im Boot-Test:** Faelle heissen `IP4-1..IP4-4` statt `IP4-1..IP4-3` — die geplante „Mutationsprobe"-Ebene wurde ein eigener Testfall (`IP4-3`), der Spawn ist `IP4-4`. Inhalt/Reichweite unveraendert.
3. **Reihenfolge im Spawn-Fall:** `/voice/incoming`-POST laeuft vor dem Lesen von `srv.stdout` (Banner-Zeilen treffen erst nach Gateway-Start ein) — in Plan-Reihenfolge war der Fall reproduzierbar rot.
4. **Gates-Bank rot (Bestand, nicht durch diese Phase verursacht):** 126 gruen / 3 rot — GAP-05, GAP-15, E2E-03; keiner importiert etwas, das diese Phase anfasst.
5. **Werkzeug-Befund (kein Code-Befund):** `ln -s "./node_modules" node_modules` im Worktree erzeugte einen selbstbezueglichen Symlink, der eslint/knip mit Exit 194 ohne Ausgabe stillschweigend brechen liess; behoben mit `ln -s "../../../node_modules"`. Nicht committet.

## Safety-Urteil

**FREIGABE (approved: true).** Alle Absoluten Regeln einzeln geprueft und unberuehrt:

1. **Safety-Gates:** kein Gate-Code im Diff (`directive-synth.js`, Routen, Billing, `outbound-gates.js`, `state-ops.js`, `activation.js` alle unangetastet). Die Phase HAERTET sogar: der Kontingent-Riegel des Play-TTS-Pfads (Kosten auf Plattform-Konto ohne per-Tenant-Metering) hat jetzt einen Beweis in beide Richtungen, per Mutationsprobe verifiziert.
2. **Offenlegung:** `claude.js`/`bridge.js` nicht im Diff, `disclosureSentence` unveraendert; Anker-Test liest den Anrufstart-Koerper nur, aendert ihn nicht.
3. **Auth fail-closed:** keine Route/Middleware/`route-policy.js` im Diff; Boot-Zeile druckt, entscheidet nichts.
4. **Secrets:** Banner traegt nur Pfad-Token + Boolean; Kontingent-Test prueft aktiv, dass kein Anbieter-Schluessel in Warnzeilen steht.
5. **Audio/MCP:** unberuehrt.
6. **Scope:** keine neue Dependency, kein Flag geflippt (`render.yaml` bleibt `"false"`), gesamter Nicht-Scope eingehalten.
7. **Byte-Identitaet bei Flag aus:** bestaetigt (Hoerprobe unveraendert, einzige sichtbare Aenderung ist die eine zusaetzliche Banner-Zeile).

Mutationsproben bestaetigt tragende Tests: Resolver-Manipulation → 3/3 Stimm-Anker rot; Vor-Riegel-Deaktivierung → Vor-Riegel-Test rot; `armedInboundSprechpfad` fest auf `PLAY_TTS` → IP4-1/3/4 rot (inkl. Spawn).

### Concerns (keine Blocker)

- Test-Duplikat: `test/directive-synth.test.js` behaelt eigenes `fakeConfig()` statt den geteilten Helfer zu parametrisieren (rein testseitig, Driftrisiko gering).
- `render.yaml` und `src/telephony/sprechpfad.js` standen nicht in der urspruenglichen Spec-Dateiliste (durch Scope-Punkt 2/4 aber erzwungen bzw. sachlich begruendet).
- Kommentar-Nits in `sprechpfad.js` (Dateiendungen in Konsumenten-Kommentaren fehlen teils `.test.js`/`.js`) — kosmetisch.
- Suite bleibt unter voller Parallelitaet flakig (drei verschiedene Spawn-Tests, jeweils isoliert gruen, in nicht angefassten Dateien) — Bestandsproblem, nicht IP4-verursacht.
- Owner-Handlungen bleiben offen: Flag-Flip im Render-Dashboard (kostet ElevenLabs-Zeichen ohne per-Tenant-Metering) und ein echter Inbound-Testanruf zur Stimm-Abnahme.

## Clean-Code-Audit (S1-S4)

**Verdict: PASS**, kein Blocker.

- **S1 (Blocker-Kategorie):** leer — keine Funde.
- **S2 (Duplizierung, sehr gering, kein Blocker):** zwei aehnliche aber nicht identische Fetch-Attrappen (`ip4-tts-kontingent.test.js` vs. `play-tts-stimm-probe.mjs`) — strukturelle Naehe, kein echter Doppel-Code; optionaler Fix nur bei drittem Bedarf.
- **S3:** n. z. — Namen durchgehend deskriptiv, keine Hungarian Notation; keine auskommentierten/veralteten Kommentare, ausfuehrliche deutsche WARUM-Kommentare entsprechen Hausstil.
- **S4:** n. z. — alle neuen Funktionen kurz, 0-2 Argumente, eine Aufgabe; keine Magic Numbers (`QUOTA`, `CHARACTERS_OVER_QUOTA`, `CHARACTERS_WITHOUT_QUOTA`, `HTTP_OK` benannt).

Positiv hervorgehoben: saubere DIP-Trennung (reine Funktion vs. Aufrufer reicht Namespace herein), G5-konforme Konsolidierung an drei Stellen (Namensvorrat, Voice-Probe-Harness, `PIN_PLATTFORM_STIMME`-Konstante), Tests durchgehend Build-Operate-Check mit Positiv-Kontrollen gegen das "Gate, das alles ablehnt, besteht jeden Negativtest"-Muster.

### Offene TODOs (kein Blocker)
- Optional: die zwei aehnlichen Fetch-Attrappen bei Bedarf einer dritten Nutzung zusammenfuehren.
- Vor Merge einmal den vollen `npm test`-Lauf bis zum Ende beobachten (hier nur die 24 direkt betroffenen Tests + Syntax-Check vollstaendig verifiziert).

## Fix-Runden

Keine — Safety- und Clean-Code-Review liefen direkt PASS/FREIGABE ohne Blocker, keine Fix-Runde noetig.
