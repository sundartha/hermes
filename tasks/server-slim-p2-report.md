# Server-Slim P2 — `src/tts/directive-synth.js` extrahieren

**Typ:** Leaf, pure, Hot-Path
**Gate:** PASS
**finalBranch:** `phase/slim-p2-directive-synth`

---

## 1. Plan (gekuerzt)

### Grounding (echte Zeilen auf `master`, Plan-Zeilen verifiziert)

`src/server.js` hatte zu Beginn **2195 Zeilen** (der urspruengliche Plan-Entwurf nannte ~2244 — Plan rottet). Verifizierte Ist-Positionen vor dem Edit:

| Symbol | Plan sagt | Ist (verifiziert) |
|---|---|---|
| `synthesizeDirectiveAudio` def | ~L644 | **L650-656** |
| `withPlayAudio` def | — | **L658-664** |
| `synthToServeUrl` def | ~L680 | **L666-686** |
| Doc-Kommentar zum Block | L644 | **L644-649** |
| `ttsStore`-Konstruktion | — | **L553** |
| 6 Aufrufstellen | 893,903,967,976,991,1031 | **899, 909, 973, 982, 997, 1037** |

Alle 6 Aufrufstellen hatten exakt die Form `await synthesizeDirectiveAudio(` (Praefix `await`, Suffix `(`). `withPlayAudio`/`synthToServeUrl` waren **rein intern** (nur innerhalb des Blocks referenziert). P1 (`billing/metering.js`, bereits gemergt, `7b0103a`) definiert die verbindliche Factory-Konvention + einen direkten Unit-Test (`test/metering-unit.test.js`) — P2 spiegelt das 1:1.

Abhaengigkeiten der 3 Funktionen: `config.elevenLabsPlayTts`, `config.publicUrl`, `ttsStore.put`, `PROVIDER.TELNYX`, `DIRECTIVE.GATHER/SAY`, `synthesizeSpeech`, `fetch` (Node-Global).

**Dead-Import-Befund (G12) nach dem Move — verifiziert:**
- `synthesizeSpeech` (Import L43): einzige Nutzung L667 (zieht um) → Import wird tot, muss weg.
- `DIRECTIVE` (Import L59): einzige Nutzung L659/L663 (ziehen um) → muss aus dem `directives.js`-Importblock raus (`sayD/gatherD/hangupD/redirectD/streamD` bleiben, alle anderweitig genutzt).
- `PROVIDER` (Import L13): bleibt (5 weitere `PROVIDER.`-Nutzungen: L310,808,1152,1290,1630,1841).
- `fetch`: Node-Global, nie importiert → bleibt Global im neuen Modul (Spec: nicht importieren, sonst driftet der Timeout-Pfad).

### Neue Datei: `src/tts/directive-synth.js` (~50 LOC)

**Signatur:** `export function makeDirectiveSynth({ config, ttsStore })` → gibt `{ synthesizeDirectiveAudio }` zurueck (nur diese eine Funktion ist extern gebraucht; `withPlayAudio`/`synthToServeUrl` bleiben private Closures).

Inhalt: byte-identische Verschiebung der 3 Funktionskoerper, nur in den Factory-Scope genestet; Signaturen unveraendert (`cfg` bleibt Parameter, kein Dedup gegen die Closure — das waere Intra-Split/A2). Importe: `./synth.js` (`synthesizeSpeech`), `../store/defaults.js` (`PROVIDER`), `../telephony/directives.js` (`DIRECTIVE`).

### Edits in `src/server.js` (6 Edits, kleiner Blast-Radius)

- **Edit A** — toten `synthesizeSpeech`-Import entfernen, Factory-Import `makeDirectiveSynth` setzen (L43-44, Gruppierung nach Verzeichnis `tts/`, konsistent mit P1).
- **Edit B** — `DIRECTIVE` aus dem `directives.js`-Importblock entfernen (L58-65), `sayD/gatherD/hangupD/redirectD/streamD` bleiben.
- **Edit C** — `directiveSynth` direkt nach `ttsStore` konstruieren (nach L553, INV-7); `const` vor allen 6 Nutzungen ≥L899 → kein TDZ.
- **Edit D** — Block L644-687 loeschen (Doc-Kommentar 644-649 + die 3 Funktionen 650-686 + Leerzeile 687).
- **Edit E** — die 6 Aufrufstellen per `replace_all` umstellen: `await synthesizeDirectiveAudio(` → `await directiveSynth.synthesizeDirectiveAudio(`. Trifft genau die 6 Stellen, nicht die zwei erklaerenden Kommentare (kein `await`-Praefix bzw. kein direktes `(`).

Bewusst nicht geaendert: Kommentare, die die Operation konzeptuell nennen — Funktion existiert weiter (jetzt qualifiziert), Kommentare bleiben korrekt (Scope, A2).

Geplante Netto-LOC server.js: ≈ −42. Middleware/Mount/Boot/Boot-Log-Reihenfolge byte-identisch (INV-2/INV-6 unberuehrt).

### Neuer Test: `test/directive-synth.test.js` (Spiegel von `metering-unit.test.js`)

Begruendung: `voice-play-tts.test.js` bleibt der End-to-End-Byte-Gate. Ein Unit-Test auf `makeDirectiveSynth` deckt echte, bisher ungedeckte Faelle ab — v.a. den Synth-FAIL-Fail-safe-Pfad (kein Bestandstest prueft ihn, der Fake-Origin in `voice-play-tts` liefert immer 200).

Fuenf Faelle (Build-Operate-Check, ein Konzept je Test):
1. Flag AUS → Direktiven referenz-identisch zurueck, kein `put`, kein `fetch`.
2. Nicht-Telnyx (Flag AN) → unveraendert, kein `put`, kein `fetch` (Kosten-/Scope-Gate isoliert).
3. Telnyx + Flag AN + Synth-OK → `GATHER` bekommt `promptAudioUrl`, `SAY` bekommt `audioUrl`, URL-Form korrekt, `put` genau einmal pro sprechender Direktive.
4. Telnyx + Flag AN + Synth-FAIL → Liste unveraendert (Fail-safe → Azure-`<Say>`), `put` nie aufgerufen. *(neue Abdeckung)*
5. Telnyx + Flag AN + nicht-sprechende Direktive gemischt mit sprechender → nur die sprechende synthetisiert. *(neue Abdeckung)*

### Deterministisch pruefbares Ergebnis (Plan-Kommandos)

```bash
node --check src/tts/directive-synth.js && node --check src/server.js   # exit 0
grep -c "^export" src/server.js                                          # 0
grep -c "synthesizeSpeech" src/server.js                                 # 0
grep -cE "function (synthesizeDirectiveAudio|withPlayAudio|synthToServeUrl)" src/server.js  # 0
grep -c "directiveSynth.synthesizeDirectiveAudio" src/server.js          # 6
grep -rF "Hermes Gateway laeuft auf http://localhost" src/ | wc -l       # 1  (INV-6)
git diff --stat src/server.js                                            # Netto-Reduktion

node --test test/voice-play-tts.test.js test/telnyx-play-render.test.js \
  test/directive-render.test.js test/tts-store.test.js test/tts-synth.test.js \
  test/directive-synth.test.js                                           # alle gruen
npm test                                                                 # beide Backends gruen
```

Flake-Protokoll (A1): Voll-Last-Flake `p5-gate-proof` (~12%) gilt nur als echt rot, wenn die betroffene Datei isoliert rot bleibt. Kein Smoke laut Plan zwingend noetig (P2 beruehrt keine oeffentliche Route/Mount-Reihenfolge; wurde trotzdem gefahren, siehe unten).

### Invarianten-Kurzcheck

- **INV-7 (EINE Instanz):** `directiveSynth` einmal in der Wurzel (nach `ttsStore`), injiziert die eine `ttsStore`-Instanz.
- **INV-6/INV-2:** Boot-Log-Zeile + Middleware-/Mount-Reihenfolge unberuehrt.
- **INV-10:** `server.js` bleibt export-frei (0).
- **Hot-Path / Fail-safe:** Funktionskoerper byte-identisch verschoben, `fetch` bleibt Node-Global (kein Timeout-Drift), Fail-safe-Rueckgabe unveraendert.

**Pre-Mortem P2:** Einziges reales Risiko waere ein still gedrifteter Timeout-/Fetch-Pfad (wenn `fetch` importiert statt Global genutzt wuerde) oder ein zweiter `ttsStore` → Token-Split-Brain (Audio 404). Beide durch Edit-Design (Global bleibt Global; `ttsStore` injiziert, nicht neu gebaut) und die Test-Gates ausgeschlossen.

---

## 2. Implementierungs-Zusammenfassung

`synthesizeDirectiveAudio`/`withPlayAudio`/`synthToServeUrl` byte-identisch aus `src/server.js` (L644-687, verifiziert) in eine neue Datei `src/tts/directive-synth.js` verschoben, gekapselt in `makeDirectiveSynth({config, ttsStore})`. `directiveSynth` wird EINMAL direkt nach `ttsStore` konstruiert (INV-7).

Alle 6 Aufrufstellen (nach dem Edit bei L858, 868, 932, 941, 956, 996) zeigen jetzt auf `directiveSynth.synthesizeDirectiveAudio(...)` — per `replace_all` auf den exakten Praefix `await synthesizeDirectiveAudio(` getroffen; die zwei erklaerenden Kommentare (kein `await`-Praefix bzw. kein direktes `(`) blieben unangetastet.

Toter `synthesizeSpeech`-Import und der `DIRECTIVE`-Import aus dem `directives.js`-Block wurden aus `server.js` entfernt (beide Symbole zogen ins neue Modul um, `PROVIDER` bleibt — 5 weitere Nutzungen verifiziert).

**Netto-Reduktion server.js:** −41 Zeilen (63 geaendert: 11 Insertions / 52 Deletions).

Globale Verifikationen aus dem Plan — alle gruen:
- `node --check` beider Dateien
- `grep -c "^export" src/server.js` = 0
- `grep -c synthesizeSpeech` = 0
- `grep -cE function(...)` = 0
- `grep -c directiveSynth.synthesizeDirectiveAudio` = 6
- Boot-Log-Zeile genau 1x
- Isolierte Spec-Suite (voice-play-tts + telnyx-play-render + directive-render + tts-store + tts-synth + directive-synth) **37/37 gruen**
- Volle `npm test` **2290/2290 gruen** (0 fail, beide Backends inkl. PGlite-basierte Tests)

Neuer Unit-Test `test/directive-synth.test.js` (5 Faelle, spiegelt `metering-unit.test.js`) deckt zusaetzlich den bisher ungetesteten Synth-FAIL-Fail-safe-Pfad + Empty-Text/nicht-sprechende-Direktive isoliert ab; kein Bestandstest geaendert (reiner-Refactor-Regel gewahrt, 0 Test-Edits).

Smoke-Test bestand: Server lokal gestartet (`PORT=3999`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, `OWNER_NUMBER_SEED`/`PROVIDER` fuer den Boot-Guard). `/healthz` → 200, Boot-Log-Zeile `Hermes Gateway laeuft auf http://localhost` vorhanden. `POST /voice/incoming` mit fremder From-Nummer → `<Gather><Say>...</Say></Gather><Redirect>` byte-identisch gerendert (Flag AUS → `directiveSynth.synthesizeDirectiveAudio` liess die Direktiven unveraendert durch, `render()` unveraendert). `GET /voice/tts/<unbekannter-Token>` → 404 (`ttsStore`-Route unberuehrt). Server sauber beendet.

Commit `31e08a4` auf Branch `phase/slim-p2-directive-synth`, nur die 3 betroffenen Dateien gestaged (kein `git add -A`), `node_modules`-Symlink nicht committet (gitignored).

### Dateien

**Erstellt:**
- `src/tts/directive-synth.js`
- `test/directive-synth.test.js`

**Bearbeitet:**
- `src/server.js`

### Deviations

Keine (`deviations: []`). Plan wurde exakt umgesetzt.

---

## 3. Safety-Urteil (final)

- `approved`: **true**
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

**Concern (nicht-materiell):** Der Voll-Suite-Lauf mit `STORE_BACKEND=pg` funktioniert nur via PGlite-in-Test (die pg-Tests instanziieren PGlite selbst); ein globaler `DATABASE_URL=pglite://memory`-Override ist ungueltig (`ENOTFOUND host 'memory'`) und kein Regress von P2.

**Independent Test Summary:** JSON-Backend Voll-Suite 2290/0 (pass/fail). pg-native PGlite-Tests (web-auth-pg/portal-rls-killer/store-pg u.a.) 56/56 gruen → beide Backends gruen. Spec-Verifikationstests (voice-play-tts, telnyx-play-render, directive-render, tts-store, tts-synth, directive-synth) 37/0 inkl. Spawn-Byte-Gate (Play + Einmal-Token gepinnt). `node --check` gruen fuer `server.js` + `directive-synth.js` + neuer Test. `grep -c "^export" src/server.js` = 0; Boot-Log-Zeile genau 1; `server.js` netto −41 Zeilen (+11/−52).

**Verdict:** APPROVED. Reine Verschiebung, byte-identisch. `src/tts/directive-synth.js` kapselt `synthesizeDirectiveAudio`/`withPlayAudio`/`synthToServeUrl` unveraendert hinter `makeDirectiveSynth({config, ttsStore})`; `directiveSynth` wird genau einmal direkt nach `ttsStore` konstruiert (INV-7), alle 6 Aufrufstellen rewired. `fetch` bleibt Node-Global (kein Import, Timeout-Pfad unveraendert), `PROVIDER`/`DIRECTIVE`/`synthesizeSpeech` aus derselben Einzelquelle (G5), tote Imports (`synthesizeSpeech`, `DIRECTIVE`) sauber entfernt, keine Rest-Symbole. Nur 3 Dateien (`server.js`, neues Modul, EIN neuer Test), keine neue npm-Dep. `claude.js`+`bridge.js` unberuehrt → `disclosureSentence` fest verdrahtet. Keine Safety-Gate-/Auth-Aenderung; Modul loggt nur `result.reason`, nie den Key; Test nutzt Dummy-Key. INV-2/INV-6 (Middleware-/Mount-Reihenfolge, Boot-Log) unberuehrt. Alle globalen Verifikationen gruen.

---

## 4. Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (Bagatelle):**
  - C2 · `src/server.js:787` · Kommentar bei `/voice/incoming` ("Seit `await synthesizeDirectiveAudio` ist dieser Handler async") referenziert noch den nackten Funktionsnamen statt der jetzt gueltigen qualifizierten Form `directiveSynth.synthesizeDirectiveAudio`. Nicht falsch (der Grund fuer async bleibt derselbe), nur nicht ganz nachgezogen. Fix-Vorschlag: Kommentar auf `directiveSynth.synthesizeDirectiveAudio` aktualisieren oder generisch auf "seit die Direktiven-Synth awaited wird" umformulieren.
- **s4:** keine
- **blocker:** false

**Verdict:** PASS. Reine, verhaltenserhaltende Extraktion (Leaf, pure) nach dem in P1 etablierten Factory-Muster (`makeDirectiveSynth({config, ttsStore})` analog `makeMetering`). Alle 8 Call-Sites in `server.js` konsistent auf `directiveSynth.synthesizeDirectiveAudio` umgestellt, keine verwaisten Referenzen auf den alten freien Funktionsnamen. `DIRECTIVE`-Import aus `server.js` komplett entfernt (kein Rest-Gebrauch, grep bestaetigt), `synthesizeSpeech`-Import ebenfalls sauber verschoben, keine Duplikate. Fail-safe-Semantik (Flag AUS / Nicht-Telnyx / Synth-Fehler → Direktiven referenz-identisch, NIE den Call toeten) ist 1:1 erhalten. Neuer Unit-Test (5 Faelle, F.I.R.S.T.-konform: Fake-`ttsStore`, Fake-`fetch` via `try/finally`, kein Netz) deckt Flag-AUS, Nicht-Telnyx, Synth-OK, Synth-FAIL und gemischte Direktiven ab und ist explizit als Ergaenzung zum bestehenden Spawn-Integrationstest (`voice-play-tts.test.js`, unveraendert) und `tts-synth.test.js` dokumentiert, keine Ueberlappung. Volle Suite lokal gruen: 2290/2290 (inkl. neuer 5), `node --check` sauber auf beiden Dateien.

**Pass-Notes:** Byte-identisches Verhalten durch Tests belegt (`voice-play-tts.test.js` Spawn-Gate unveraendert + 2290/2290 gruen). Factory-Konvention konsistent mit P1 (`makeMetering`). `ttsStore`-Singleton-Invariante (INV-7) im Kommentar korrekt benannt und in der Konstruktionsreihenfolge (`ttsStore` vor `directiveSynth`) eingehalten. Keine neuen Magic Numbers, keine Flag-Argumente, keine Verschachtelung, Funktionslaenge unter Richtwert, 2 Argumente in `makeDirectiveSynth` (destrukturiertes Objekt, ok). Kein toter Code, keine deaktivierten Sicherungen.

**Top-TODOs (nicht blockierend):** Kommentar in `server.js:787` auf den qualifizierten Aufrufnamen nachziehen.

---

## 5. Fix-Runden

Keine — die S3-Bagatelle (`server.js:787`) wurde als optional/nicht-blockierend eingestuft, keine Fix-Runde ausgeloest. `FIXES`-Sektion der Quelle war leer.

---

## 6. Kontext fuer Folge-Phasen

- Neuer `tts/`-Cluster-Import-Konvention etabliert (analog `billing/*` aus P1): Import-Gruppierung nach Zielverzeichnis.
- Offener, nicht-blockierender Nachzieh-Punkt: `src/server.js:787` Kommentar auf `directiveSynth.synthesizeDirectiveAudio` aktualisieren (kann in einer spaeteren Phase oder als Trivial-Edit mitgenommen werden).
- `PROVIDER`-Import bleibt in `server.js` (5 weitere Nutzungsstellen, unabhaengig von P2).
