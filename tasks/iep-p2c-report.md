# Phase IEP-P2c — Detailbericht

Begruessungslaut aus ElevenLabs-Soundeffekt statt gerechnetem Rauschen.

**Gate:** PASS
**finalBranch:** `phase/iep-p2c-laut-el`
**headCommit:** `fec8b5ccfa16c062169293d1e5d570cf1a81f15f`

## Owner-Entscheidung 2026-09-17

Der gerechnete Laut aus IEP-P2b (Komfortrauschen) ist durchgefallen — Owner-Urteil: "hoert sich
an wie Gewitter". Der Owner hat stattdessen einen von ElevenLabs erzeugten Soundeffekt ausgewaehlt
und abgenommen: weiches Abheben des Hoerers, danach ruhige Leitung.

Die Dateien lagen bereits abgenommen im Arbeitsbaum und wurden NICHT neu erzeugt, NICHT
veraendert, NICHT neu gemischt:
- `public/brand/hermes-begruessungslaut.wav` — 8000 Hz, 1 Kanal, 16 bit, 3,00 s, Spitze -20,0
  dBFS, weiche Ausblende ueber die letzten 150 ms
- `scripts/quellen/hermes-begruessungslaut-quelle.mp3` — ElevenLabs sound-generation

Auftrag: den Bestand an diese Realitaet anpassen, nicht umgekehrt.

---

## Plan (gekuerzt)

### Quellenlage
`tasks/iep-strategie.md` enthaelt keinen Abschnitt `## Phase IEP-P2c` (0 Treffer bei Grep).
Bindend waren daher in dieser Reihenfolge: der Workflow-Auftrag, `### IEP-P2` der Strategie
(Bedingung c: vorab gerendertes statisches Asset, fester Dateiname, kein `<Say>`, kein Parameter,
keine neue Route; Bedingung f: Fuellung aus ⇒ TeXML byte-gleich) und die Bauregel "Kein Fix ohne
Ohrzeugen" (hier erfuellt durch Datei-Messung statt Anruf). Einziger uebernommener Befund:
R-P2b-1 aus `tasks/iep-p2b-report.md`.

### Belegte Ausgangslage
Auslieferungsdatei gemessen: PCM 1 Kanal 8000 Hz 16 bit, Dauer exakt 3000,0 ms, Spitzenpegel
-20,00 dBFS bei 13,3 ms, 0 uebersteuerte Samples, Ausblende letzte 150 ms auf -78,3 dBFS (58,3 dB
unter Dateispitze), Container mit `FLLR`-Polsterchunk (4044 Bytes), Bandanteil > 1 kHz = 0,155.
Quelle: 2 ch, 44100 Hz, 132300 Rahmen = 3,000 s, 128 kbit/s.

Herkunft rekonstruiert: `afconvert -f WAVE -d LEI16@8000 -c 1 <quelle.mp3> <roh.wav>` erzeugt
byte-identischen 4096-Byte-Kopf zur abgenommenen Datei; Unterschied ist reine
Probennachbearbeitung — globale Skalierung auf Spitze 0,1 und lineare Ausblende ueber die letzten
1200 Rahmen (150 ms).

Bestand war rot: `test/iep-p2-begruessungslaut.test.js` zeigte 4 von 9 Faellen fehlgeschlagen
(A1, A2, A7, A9) gegen die alte, auf Rauschsynthese zugeschnittene Pruefung.

### Leitentscheidungen
- **D1** — Die abgenommene Datei ist die Wahrheit, das Skript ist Herkunftsdoku; KEIN
  Byte-Pin-Test (afconvert-Nachlauf weicht bis 1 LSB / Container-Polsterung ab).
- **D2** — Kein Test ruft afconvert; die Testbank fasst nur die committete Datei an.
- **D3** — Skript nicht-destruktiv pruefbar: optionaler Zielpfad-Parameter, Default = die
  Auslieferungsdatei.
- **D4** — `leseWav` bekommt additiv ein `format`-Feld statt eines zweiten RIFF-Parsers im Test.
- **D5** — Positiv-Kontrollen aus der echten Datei abgeleitet (vier Verfaelschungen: zu leise
  -40 dBFS, zu laut -6 dBFS, geklemmt, Ausblende durch Klick ersetzt), statt eines konservierten
  Synthesizer-Bauplans.
- **D6** — Tonalitaets-/Huellkurvenschranken (keine Energie > 1 kHz, Huellkurvenspanne,
  groesste Flanke) fallen: sie beschreiben bandbegrenztes Rauschen, ein Abhebe-Klick ist per
  Definition breitbandig (gemessen 0,155 gegen alte Schranke 0,06).
- **D7** — Dateinamen (Skript und Test) bleiben unveraendert (Boot-Riegel-Text, Grep-Kette).

### Arbeitsschritte
- **S0** — Binaerdateien zuerst einzeln vorgemerkt (`git add`, kein `-A`), bevor irgendjemand das
  Skript ausfuehrt.
- **S1** — `scripts/iel-mess-audio.mjs`: `leseWav` liefert additiv `format` (code, kanaele,
  abtastrate, bits) zurueck; alle drei Bestandsaufrufer destrukturieren unveraendert weiter.
- **S2** — `scripts/render-begruessungslaut.mjs`: vollstaendiger Ersatz. Rauschsynthese
  (`BEGRUESSUNGSLAUT_REZEPT`, xorshift32, Bandpass-Kaskaden, Huellkurven) ersatzlos entfernt.
  Neuer Umwandler: afconvert (mp3 → 8 kHz mono PCM16) → Skalierung auf ZIEL_SPITZENPEGEL
  (-20 dBFS) → lineare Ausblende (150 ms) → WAV schreiben. Acht kleine Funktionen, jede eine
  Aufgabe, alle Zahlenkonstanten benannt.
- **S3** — `test/iep-p2-begruessungslaut.test.js`: vollstaendiger Ersatz durch acht Faelle
  (`IEP-P2c-A1`..`A8`), die die abgenommene Datei beschreiben: Auslieferungspfad, Telefonie-Format
  (8000 Hz/mono/16 bit), Dauer im Fenster [2000,5000] ms + laenger als EL-Annahmefenster
  (900 ms), Spitzenpegel im Fenster [-26,-18] dBFS ohne Uebersteuern, Ausblende-Daempfung
  ≥ 30 dB + Schleifennaht ohne Knack, vier Positiv-Kontrollen fallen an ihrer jeweiligen Schranke
  durch, Auslieferung ueber den public-Mount ohne Auth, Config-Kohaerenz des Schalters.
- **S4** — `knip.json`: `scripts/render-begruessungslaut.mjs` als neuer Entry-Point eingetragen
  (sonst als unbenutzt gemeldet, da kein Test mehr importiert).
- **S5** — `src/elevenlabs/inbound-rueckfall.js`: ein Kommentarsatz aktualisiert (Verweis auf
  IEP-P2c / ElevenLabs-Quelle); Konstanten/Funktionen unveraendert.
- Nicht angefasst: `src/config.js` (Schalter + Boot-Riegel bleiben gueltig), `.env.example`,
  `render.yaml`, `test/helpers.js`, Telnyx-Render-Adapter, `routes/voice.js`, die drei
  Dial-Render-Tests, `package.json`.

### Sicherheitsrechnung im Plan
Kein Endpunkt, keine Route, kein Parameter, kein Gate angefasst; statisches Asset am
bestehenden `public/`-Mount, sprachlos, konkurriert nicht mit der KI-Kennzeichnung im
`first_message`. `execFileSync` mit festem Programmpfad, keine Shell, keine neue Dependency.

### Risiken im Plan
R-P2c-1 (Klick wiederholt sich bei Ringback-Wiederholung — getragen, Normalfall < 1 s
Annahmefenster), R-P2c-2 (Leitung nach dem Klick bei ~-75 dBFS, Ohrzeuge misst das als Stille —
Fortschreibung von R-P2b-1, kein Defekt sondern gewaehlte Gestalt), R-P2c-3 (Nachlauf koennte
abgenommene Datei ueberschreiben — durch S0 + optionalen Zielpfad + Schreibwarnung entschaerft),
R-P2c-4 (afconvert macOS-gebunden, kein Testpfad haengt daran), R-P2c-5 (Pegel 2 dB unter
Obergrenze, bewusst Owner-Vorgabe), R-P2c-6 (geteiltes Messwerkzeug rein additiv erweitert).

---

## Implementierung — Zusammenfassung

**headCommit:** `fec8b5ccfa16c062169293d1e5d570cf1a81f15f`
**nodeCheckPass:** true · **testsPass:** true · **testPassCount:** 6105 · **testFailCount:** 0
**committed:** true

`scripts/render-begruessungslaut.mjs` ist kein Synthesizer mehr, sondern der dokumentierte
Umwandler Quelle (`scripts/quellen/hermes-begruessungslaut-quelle.mp3`) → Auslieferungsdatei
(`public/brand/hermes-begruessungslaut.wav`), via afconvert → Skalierung auf -20 dBFS → lineare
150-ms-Ausblende. Die alte Rauschsynthese (Rezept, xorshift32, Bandpass-Kaskaden) ist vollstaendig
entfernt, kein toter Code. `scripts/iel-mess-audio.mjs` liefert additiv `format` aus `leseWav`
(alle drei Bestandsaufrufer destrukturieren unveraendert). `test/iep-p2-begruessungslaut.test.js`
ist vollstaendig ersetzt durch 8 Faelle (`IEP-P2c-A1..A8`), die die abgenommene Datei beschreiben
(Format 8000Hz/mono/16bit, Dauer 3000ms im Fenster [2000,5000], Spitzenpegel -20 dBFS im Fenster
[-26,-18], kein Uebersteuern, Ausblende-Daempfung ≥30dB gemessen 58,3dB, Naht ohne Knack,
Auslieferung ueber public-Mount, Config-Kohaerenz) — kein Byte-Pin-Test, kein Test ruft afconvert.
`knip.json` bekam das Skript als neuen Entry-Point. Die abgenommenen Binaerdateien (wav 52096
Bytes, mp3-Quelle) wurden zuerst gesichert (eigener Commit `fa0d419`), dann der Rest (`fec8b5c`).

**Bearbeitete Dateien:**
- `scripts/render-begruessungslaut.mjs`
- `scripts/iel-mess-audio.mjs`
- `src/elevenlabs/inbound-rueckfall.js`
- `test/iep-p2-begruessungslaut.test.js`
- `knip.json`

**Neu erstellte Dateien:** keine

**Tests hinzugefuegt/geaendert:**
- `test/iep-p2-begruessungslaut.test.js` (vollstaendig ersetzt: `IEP-P2c-A1..A8`)

**Beweise:** `node --check` auf allen 4 Dateien gruen; Phasentest 8/8 gruen; volle Regressionsbank
zweimal gefahren (`--test-concurrency=4`) — erster Lauf zeigte 1 bekannten Flake
(`el-fixtures-echte-antworten.test.js`, unabhaengig von dieser Phase, isoliert gruen bestaetigt),
zweiter Lauf 6105/6105 gruen, 0 fail; `npm run lint` 0 Fehler (69 Bestandswarnungen unveraendert);
`npx knip` zeigt `render-begruessungslaut.mjs`/`iel-mess-audio.mjs` nicht als unbenutzt;
Umwandler-Probelauf gegen `/tmp/hermes-probe/probe.wav` lieferte exakt "8000 Hz, 1 Kanal, 16 bit,
3000.0 ms, -20.00 dBFS" ohne die Auslieferungsdatei anzufassen (`git status` blieb sauber); Smoke:
Server lokal gestartet (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env), `/healthz` → 200,
`/brand/hermes-begruessungslaut.wav` → 200 `audio/wav`. `git diff --stat master -- src/ public/
render.yaml .env.example` zeigt exakt die Binaerdatei + den einen Kommentarsatz in
`inbound-rueckfall.js` — die Auslieferungskette ist unberuehrt. Keine Produktionshandlung, kein
echter Anruf, kein Push, kein Deploy.

**smokePass:** true — Server lokal gestartet (PORT=3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`,
`DATA_DIR`=temp, `STORE_BACKEND=json`, Dummy-API-Keys, `COST_TRUING_REQUIRED_RECORD_TYPES`
gesetzt). `/healthz` → 200. `/brand/hermes-begruessungslaut.wav` → 200, content-type `audio/wav`.
Prozess danach beendet.

### Deviations
- A6 (Positiv-Kontrolle "Ausblende durch den Klick ersetzt") wurde anders konstruiert als der
  Plan (dort: erste 150ms-Region auf die letzten 150ms kopieren) — eine Messung zeigte, dass diese
  Konstruktion nicht durchfaellt, weil das Sample bei 150ms Offset im echten Klick bereits leise
  ist (-90 dBFS). Stattdessen: die letzten 150ms werden auf die Dateispitze konstant gesetzt (kein
  Abklingen) — das ist die sachlich richtige Verfaelschung fuer "keine Ausblende" und faellt
  zuverlaessig an der Daempfungs-Schranke durch.
- Ein zusaetzlicher A9-Testfall (Huellkurven-Berechenbarkeit) wurde zunaechst geschrieben, dann
  wieder entfernt, um exakt bei den 8 im Plan vorgesehenen Faellen zu bleiben (kein Scope-Creep).

### Clean-Code-Selbstcheck (Impl-Agent)
Keine Duplizierung (G5/S2): `leseWav` bleibt die einzige RIFF-Leseroutine, `format` additiv statt
zweitem Parser. Keine Magic Numbers ausser 0/1/-1 (G25): alle Zahlen sind benannte Konstanten; im
Test wurden bei der Lint-Pruefung 5 uebersehene Magic Numbers (1000, 10) nachtraeglich benannt
(`MS_PER_SECOND`, `DEZIBEL_BASIS`). Kein toter/auskommentierter Code (C5/G9): komplette alte
Rauschsynthese und alter mu-law-Pruefapparat/ALT-Bauplan im Test ersatzlos entfernt. Keine
ungenutzten Imports (G12): `MS_PER_SECOND`-Import aus `timer.js` entfaellt im neuen Skript
(lokale Konstante statt), alle Importe per eslint `no-unused-vars` verifiziert (0 Warnungen).
Funktionen mit einer Aufgabe/Abstraktionsebene (G30/G34): render-Skript in 8 kleine Funktionen
zerlegt. ≤3 Argumente (F1): kein Aufruf > 2 Argumente; unbenutztes `abtastrate`-Argument aus
`ausblendeDaempfungDb()` entfernt. Kein Lazy-Init mit Seiteneffekt (P15). Keine brittle
Datei:Zeile-Kommentare (C2). ESM/kein Build/kein TS eingehalten, Kommentare deutsch ohne Umlaute.
Neues Verhalten traegt einen automatisierten Test (8 Faelle); der reine additive Refactor in
`iel-mess-audio.mjs` liess die Bestandssuite unveraendert gruen.

---

## Safety-Urteil (final)

**approved:** true — testsPassIndependently: true, safetyGatesIntact: true, disclosureIntact:
true, authFailClosedIntact: true, noSecretsLeaked: true, scopeRespected: true,
behaviorAsIntended: true

**Unabhaengige Testzusammenfassung:** Nur die vom Diff betroffenen Dateien gefahren (keine volle
Bank): `node --test --test-concurrency=4 test/iep-p2-begruessungslaut.test.js
test/iep-p1-ohrzeuge-audio.test.js test/iex-a4-answer-on-bridge.test.js test/iel-dial-render.test.js
test/iel-b8-weiche.test.js` → Exit-Code 0, tests 87 / pass 87 / fail 0 / skipped 0. Zusaetzliche
eigene Gegenprobe (kein Produktionspfad, nur Scratchpad): `node scripts/render-begruessungslaut.mjs
<tmp>` reproduziert die abgenommene Datei — beide 8000 Hz mono PCM16, 24000 Samples (3000,0 ms),
Spitze -20,00 dBFS, maximale Sample-Abweichung 0,000031 (1 LSB). Energieprofil der
Auslieferungsdatei: RMS 0-200 ms 0,0072 vs. 200-3000 ms 0,00007 → Klick + ruhige Leitung, keine
Sprache in der Ringback-Datei. Branch-Basis aktuell (`phase..master` leer).

**Blockers:** keine

**Concerns:**
1. Doku-Drift, nicht mitgezogen: `src/config.js:868` beschreibt den Laut weiter als
   "durchgehender ... (Komfortrauschen, IEP-P2b)" und `.env.example:196` als "IEP-P2/P2b:
   durchgehender, sehr leiser Begruessungslaut". Nach P2c ist der Laut ein Abhebe-Klick mit
   anschliessend nahezu stiller Leitung (gemessen -83 dBFS ab 200 ms) bei -20 dBFS Spitze. Nur
   der Kommentar in `src/elevenlabs/inbound-rueckfall.js` wurde aktualisiert. Kein
   Verhaltens-/Sicherheitsbefund, aber die naechste Session liest hier etwas Falsches.
2. Weggefallene Zusicherung ohne Ersatz: master-Fall `IEP-P2-A3` pinnte "keine Kadenz — das Bett
   traegt luecken- und pausenlos". Die neue Datei ist bewusst Klick + Stille und 3000 ms lang;
   Telnyx wiederholt die audioUrl. Dauert die Dial-Wartezeit laenger als 3,0 s (gemessenes
   Annahmefenster 0,7-0,9 s, also normalerweise nicht), hoert der Anrufer den Abhebe-Klick ein
   zweites Mal — genau die Kadenz, die der alte Fall ausschloss. Der neue A3 deckt nur das
   0,9-s-Fenster ab. Owner hat den Laut abgenommen, daher kein Blocker; als bewusst akzeptiertes
   Risiko festhalten.
3. Es gibt keinen Test mehr, der die Auslieferungsdatei an die committete Quelle bindet
   (byte-genau war nach P2c zu Recht nicht mehr moeglich). Die Datei koennte kuenftig unbemerkt
   von `scripts/quellen/hermes-begruessungslaut-quelle.mp3` abdriften und trotzdem alle acht
   Eigenschafts-Tests bestehen. Reproduktion diesmal von Hand gefahren (1 LSB Abweichung) — heute
   belegt, aber nicht automatisiert.

**Verdict:** PASS. IEP-P2c ist eng, belegt und ohne Regelverstoss. Der einzige `src/`-Treffer ist
eine Kommentarzeile in `src/elevenlabs/inbound-rueckfall.js`; `claude.js`, `routes/voice.js`, alle
Gate-Dateien, `render.yaml` und `.env` sind unberuehrt — Outbound-Offenlegung,
Inbound-`first_message`, die sieben Sicherungen vor der Uebergabe, Kostendecke/Denylist/Land-Gate/
Stundenlimit/`OUTBOUND_FROZEN` und die Ed25519-Pruefung unveraendert. Keine neue Route, keine neue
npm-Dependency, keine Secrets (die beiden neuen Binaerdateien tragen laut strings nur einen
Lavf-Encoder-Tag). Keine Produktionshandlung moeglich (kein fetch, keine URL, kein `process.env`,
kein npm-Skript ruft es, kein Test ruft afconvert; nur mit Ziel im Scratchpad ausgefuehrt). Der
Schalter-aus-Pfad bleibt byte-gleich, die Ringback-Datei enthaelt nachweislich keine Sprache und
kann der KI-Kennzeichnung daher nicht widersprechen. Drei nicht blockierende Befunde (stale Doku
an zwei Stellen, weggefallene Kadenz-Zusicherung, keine automatisierte Quelle-zu-Auslieferung-
Bindung) oben notiert, sollten im Merge-Commit bzw. als Folgeaufgabe aufgenommen werden.

---

## Clean-Code-Audit (final)

**blocker:** false

**S1 (Blocker-Kategorie):** keine

**S2 (Blocker-Kategorie):** keine

**S3 (Grenzfaelle, kein FLAG):**
- G25/G35 · `scripts/render-begruessungslaut.mjs` · alle Zahlenkonstanten bereits benannt
  (`ZIEL_SPITZENPEGEL`, `AUSBLENDE_MS`, `INT16_SKALA` usw.) inkl. Begruendungskommentar je
  Konstante — vorbildlich, keine nackten Zahlen gefunden.
- N7 · `scripts/render-begruessungslaut.mjs:schreibePcm16Umwandlung` · Funktionsname traegt den
  Nebeneffekt (Datei-Schreiben) explizit im Namen — konform.

**S4:**
- G30/G34 · `scripts/render-begruessungslaut.mjs` · `schreibeBegruessungslaut()` mischt
  IO-Orchestrierung, Messung und Konsolen-Logging (inkl. Rueckbau-Hinweis) auf einer Ebene —
  Funktion ist aber unter 40 Zeilen, gut kommentiert in klar getrennte Abschnitte, und das
  Buendeln ist bewusst ("EINZIGES IO ausser afconvert"). Kein FLAG, da Aufspalten die Lesbarkeit
  hier eher senken wuerde (Vorrang Lesbarkeit).

**Verdict:** PASS. Der Diff ersetzt den durchgefallenen synthetischen Begruessungslaut (IEP-P2b)
durch einen dokumentierten, wiederholbaren Umwandlungsweg von einer abgenommenen
ElevenLabs-Quelle. Code-Qualitaet ist hoch: alle Magic Numbers benannt und begruendet,
fail-closed Formatpruefung (`pruefeZielformat` wirft bei falschem afconvert-Output statt still
weiterzumachen), reine Funktionen fuer Skalierung/Ausblende sauber von IO getrennt, `execFileSync`
ohne Shell (keine Injection-Flaeche trotz externem Tool-Aufruf). Der Test wurde konsequent auf
Eigenschaftspruefung umgestellt (keine Byte-Pin-Tests mehr, da afconvert nicht deterministisch
ist) inkl. Positiv-Kontrollen (vier verfaelschte Fassungen muessen an ihrer jeweiligen Schranke
durchfallen — deckt die Lehre "Pruefkommando ohne Positiv-Kontrolle" ab). Alle 8 Tests liefen
gruen. `leseWav()` wurde additiv um das `format`-Feld erweitert, alle Bestandsaufrufer bleiben
unveraendert kompatibel. `knip.json` korrekt um das neue Skript ergaenzt. Kein Safety-Gate, keine
Auth-Route, kein Geld-/Call-Pfad beruehrt — die Datei ist ein statisches Audio-Asset hinter dem
bestehenden public-Mount (Test A7 bestaetigt ausdruecklich: ohne Auth ausgeliefert, wie
beabsichtigt fuer ein Marken-Asset). Keine S1/S2-Befunde, kein Blocker.

**passNotes:** Saubere Trennung reine Funktionen (`aufSpitzenpegelSkaliert`,
`mitLinearerAusblende`, `alsWavDatei`, `pcmDaten`) von IO (`schreibePcm16Umwandlung`,
`schreibeBegruessungslaut`). Fail-closed Formatvalidierung nach afconvert statt blindem Vertrauen
in externes Tool. `execFileSync` mit Array-Argumenten, keine Shell-Injection. Kommentare erklaeren
WARUM (z.B. warum kein Byte-Pin-Test moeglich ist, warum afconvert statt npm-Dependency).
Test-Suite nutzt EINE geteilte Messfunktions-Bibliothek fuer Ist-Messung UND Positiv-Kontrollen
(keine Duplizierung der Pegel-/Ausblende-Berechnung). Rueckbauweg dokumentiert
(`git checkout --`). Alle Aenderungen minimal-invasiv, Bestandscode (state-ops, config,
route-policy) nicht angefasst.

**topTodos:** Keine Pflicht-Todos aus dem Audit. Optional: der im Skript-Kommentar dokumentierte
Hinweis, dass afconvert nur auf macOS existiert, koennte spaeter zum Problem werden, falls
CI/Render (Linux) den Regenerierungs-Lauf je automatisiert braucht — aktuell bewusst akzeptiert
(Kommentar im Code) und nicht Teil dieser Phase.

---

## Security-Review (final)

**approved:** true · **blockers:** keine

**Concerns:**
1. Container-Abweichung zur dokumentierten Kette: die committete
   `public/brand/hermes-begruessungslaut.wav` traegt einen 4044-Byte-`FLLR`-Polsterchunk (alle
   Bytes 0), den der Schreiber in `scripts/render-begruessungslaut.mjs:alsWavDatei` gar nicht
   erzeugen kann — der Nachlauf liefert 48044 Bytes mit fmt+data ohne FLLR. Die Samples stimmen
   bis auf 1 LSB ueberein, die Provenienz ist also belegt; der Skriptkommentar erklaert die
   Abweichung aber mit "Container-Polsterung von afconvert", was fuer die Ausgabe dieses Skripts
   nicht zutreffen kann. Sicherheitlich harmlos (Nullbytes, keine Metadaten), aber der Kommentar
   beschreibt den Weg der Datei ungenau.
2. Weggefallene Klang-Schranken gegenueber master: der Test verliert die Tonalitaets-Schranken
   (alter A7, "kein Ton/piepsig") und den PCMU-Schmalband-Rundlauf (alter A9). Neu geprueft
   werden nur Format, Dauer, Pegel, Uebersteuerung, Ausblende, Schleifennaht. Ein kuenftiger
   Tausch der Quell-mp3 wuerde einen wieder piepsigen Laut nicht mehr auffangen. Kein
   Sicherheitsbefund — gehoert dem Verhaltens-/Clean-Code-Review.
3. `scripts/render-begruessungslaut.mjs` ueberschreibt ohne Argument die vom Owner abgenommene
   Auslieferungsdatei und warnt erst NACH dem Schreiben. Reines Entwickler-Werkzeug, vom Server
   nicht erreichbar, daher kein Sicherheitsrisiko — aber ein Fussangel fuer die naechste Session.
4. Das Asset bleibt unauthentifiziert ueber den bestehenden `express.static`-Mount erreichbar
   (Test `IEP-P2c-A7` pinnt das ausdruecklich). Bestandsentscheidung aus IEP-P2 wie bei
   favicon/brand-Assets, keine neue Flaeche und kein neuer Endpunkt; als akzeptiertes
   Bestandsrisiko notiert, nicht als Befund.

**Verdict:** PASS. IEP-P2c ist ein reiner Asset-/Werkzeug-Wechsel ohne Sicherheitswirkung. Keine
neue oder geaenderte Route, kein Auth-Pfad beruehrt, weder `.env`/`render.yaml`/`config.js` noch
`route-policy.js`/`routes/*` im Diff; die einzige `src`-Aenderung
(`src/elevenlabs/inbound-rueckfall.js:48`) ist ein Kommentar. Alle Gates (Kostendecke beidseitig,
Denylist/Land/Stundenlimit, Max-Dauer, Verifikations-Permit, `OUTBOUND_FROZEN`, Telnyx-Ed25519
fail-closed) und beide Offenlegungswege (`disclosureSentence` outbound, serverseitiger
`first_message`-Riegel inbound) sind unveraendert. Kein Pfad der Phase kann Anrufe, SMS oder
EL-Minuten ausloesen. Die beiden neuen Audio-Dateien wurden auf Datenabfluss geprueft: WAV enthaelt
nur fmt/FLLR(4044 Nullbytes)/data ohne LIST/INFO/ID3, die Quell-mp3 nur den ID3-Rahmen
`TSSE=Lavf60.16.101` — keine Voice-ID, kein Konto, kein Key, kein Owner-Name, keine Nummer;
`scripts/quellen/` liegt ausserhalb jedes statischen Mounts. Das erweiterte `leseWav`-Ergebnis
wird nur von Skripten und Tests gelesen, von keiner Route serialisiert. `execFileSync` laeuft
shell-frei mit konstanten Argumenten, keine neue npm-Dependency. Nicht-gepinnte Tenants bleiben
unberuehrt: die audioUrl entsteht nur im EL-Zweig hinter `begruessungslautEnabled`, der
Budget-Pfad sieht sie nie; das Asset ist tenant-unabhaengig, also keine Tenant-Verwechslung und
keine Fehlbuchung. Verifikation: Phasentests 8/8 gruen, route-auth-inventory + security +
iep-p1-ohrzeuge-audio 42/42 gruen, Provenienz-Gegenmessung durch Nachlauf des Umwandlers in ein
Temp-Ziel (max. Sample-Differenz 1 LSB, gleiche Spitze 3277). Keine Produktionshandlung
ausgeloest: kein Anruf, kein Flag-Flip, kein Push, kein Schreiben in Zaehlerdateien.

---

## Fix-Runden

Keine. Der Workflow ist in einem Durchlauf auf PASS gelaufen (Impl → Safety → Clean-Code →
Security), keine Fix-Runde noetig.
