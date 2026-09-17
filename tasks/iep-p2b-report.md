# Phase IEP-P2b — Begruessungslaut neu: unauffaellig statt piepsig

**Gate:** PASS
**finalBranch:** `phase/iep-p2b-laut`
**headCommit:** `d06ad99cbe1cdcf1132e62b8a008750d116efb1c`

## OWNER-BEFUND 2026-09-17 (Live-Stand e4034a5)

Der bisherige Begruessungslaut (IEP-P2) ist ein hoher, piepsiger Ton, der in den Ohren wehtut —
Owner-Wortlaut: **"wirklich super schlecht gemacht"**.

**SOLL (Owner-Wortlaut):** ein vernuenftiger Ton, der NICHT wehtut, NICHT auffaellt und ganz
natuerlich im Gespraech wirkt — **"als ob jemand abheben wuerde"**. Die knappe Sekunde Wartezeit
auf ElevenLabs akzeptiert der Owner ausdruecklich; es geht NUR um die Klangfarbe.

**Bauvorgabe:** kein reiner Sinus, kein Klingel-/Piep-Muster, keine tonale Energie oberhalb ca.
1 kHz, kein harter Einsatz — stattdessen sehr leise, breitbandig-weiche Raumruhe
(Komfortrauschen, tiefpassgefiltert, Pegel ca. −45 bis −38 dBFS), weich eingeblendet, nahtlos
schleifenfaehig, hoechstens ein einzelner sehr weicher Abhebe-Impuls am Anfang. Der Laut muss bei
Schmalband 8 kHz (PCMU) noch unauffaellig klingen, nicht rauschig-zischend. Sprachlos bleibt er.

**Bestandsweg unveraendert:** dieselbe Datei `public/brand/hermes-begruessungslaut.wav`, derselbe
Schalter (`ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED`), dasselbe TeXML-Attribut — es aendert sich
nur der Rendervorgang in `scripts/render-begruessungslaut.mjs` und die Datei selbst. Die Tests aus
IEP-P2 bleiben gueltig und wurden um objektive Klangschranken erweitert (Spitzenpegel, Anteil
oberhalb 1 kHz, kein Einzelton-Peak, weiche Flanken) — so, dass der ALTE piepsige Laut an ihnen
scheitern wuerde.

Kein echter Anruf, keine Produktionshandlung.

---

## Auftragslage — Befund zur Quelle

`tasks/iep-strategie.md` enthaelt **keinen** Abschnitt `## Phase IEP-P2b` (0 Treffer; die
Ueberschriftenliste endet bei `IEP-P7`) und **keinen** Abschnitt „Offene Review-Concerns" (0
Treffer, derselbe Befund wie schon in `tasks/iep-p2-report.md`). Autoritativ war damit die
Phasendefinition aus dem Kickoff-Auftrag (§2.1–2.4 Belege, §5, §6 R1–R14, §7 F4 aus
`tasks/iep-strategie.md`) sowie `tasks/iep-p2-report.md` (Vorgaengerphase, gemergt als `1fa2260`).

**F4b ist damit beantwortet:** §7 F4(b) der Strategie hielt „Klang, Dauer, Lautstaerke brauchen
eine Freigabe" offen; der Owner-Befund vom 2026-09-17 ist genau diese Freigabe — negativ fuer die
gelieferte Fassung, mit konkreter Sollvorgabe. F4a (Stille-Schwelle) bleibt offen und wurde von
dieser Phase nicht beruehrt.

Adressierte Concerns aus `tasks/iep-p2-report.md`: Safety-Concern 1 / Security-Concern 2
(Boot-Riegel-Breite) und Clean-Code-Concern 5 (`EL_BEGRUESSUNGSLAUT_PFAD` vs.
`BRAND_ASSETS_PREFIX`) waren explizit **nicht in Scope** (betreffen `src/config.js`
`REQUIRED_CONFIG` bzw. eine andere Seam, nicht den Rendervorgang). Security-Concern 4 blieb
unveraendert gueltig. Concerns 2/3 (Telnyx ehrt `audioUrl`? U1?) blieben unveraendert offen.

---

## Plan (gekuerzt)

### Wurzel, am Code belegt

Der alte Laut war ein reiner Sinus-Zweiklang (D5/A5, `spitzenpegel: 0.28`) plus 1800 ms
Nachlauf-Stille. Am committeten Asset gemessen: Spitzenpegel −11,06 dBFS, Huellkurven-Spanne
225,97 dB, staerkster Spektralanteil 0,2927 bei 875 Hz, groesste Flanke 6067. Das ist die
Messform des Owner-Befunds: laut, tonal, harter Einsatz — nicht „oberhalb 1 kHz" (beide Toene
lagen darunter).

### Leitentscheidung: gefiltertes, zyklisch gefaltetes Komfortrauschen + ein Abhebe-Impuls

- **(a) Bandpass 300–750 Hz statt reinem Tiefpass** — ein reiner Tiefpass legt ~66 % der Energie
  unter 300 Hz, unter die Uebertragungsgrenze eines Telefonhoerers; mit Hochpass liegen ~72 % im
  Band 300–1000 Hz.
- **(b) Durchgehendes Bett statt „kurz + Nachlauf-Stille"** — der alte 1800-ms-Nachlauf war reiner
  Kadenz-Schutz gegen Telnyx' Wiederholung der `audioUrl`; ein durchgehendes Bett hat keine Kadenz
  per Konstruktion.
- **(c) Nahtlose Schleife durch Aufwaerm-Runde ueber den Ring** — jede Filterstufe laeuft zweimal
  ueber dasselbe Rausch-Array, behalten wird die zweite Runde; bei periodischem Eingang ist der
  eingeschwungene Ausgang exakt periodisch.
- **(d) Weicher Einsatz sitzt im Impuls (Raised-Cosine, 120 ms), nicht in einer Bett-Einblendung.**

Pre-Mortem-Tabelle (6 Ausfallszenarien mit Entschaerfung) im Plan; alle entweder durch Design
oder durch Test abgedeckt, bis auf R-P2b-1 (s. Risiken).

### Blast-Radius

`BEGRUESSUNGSLAUT_REZEPT`/`rendereBegruessungslautWav`/`BEGRUESSUNGSLAUT_DATEIPFAD` haben genau
zwei Konsumenten: das Skript selbst und `test/iep-p2-begruessungslaut.test.js`. Die URL-Kette
(`EL_BEGRUESSUNGSLAUT_PFAD`, `elBegruessungslautUrl`, `ringbackAudioUrl`, `audioUrl`,
`begruessungslautEnabled`, Boot-Riegel) ist inhaltlich nicht beruehrt; drei Tests, die nur die
URL-Zeichenkette vergleichen, blieben unveraendert.

Geplante Aenderungen: `scripts/render-begruessungslaut.mjs` (Rezept + Rendervorgang ersetzt),
`public/brand/hermes-begruessungslaut.wav` (regeneriert, 40 044 → 96 044 Bytes),
`test/iep-p2-begruessungslaut.test.js` (A2/A3 umgebaut, A7–A9 neu), `scripts/iel-mess-audio.mjs`
(eine neue Exportfunktion `spitzenBin` + Extraktion des geteilten Helfers `summiertesSpektrum`,
G5), `src/config.js`/`.env.example` (je ein Kommentarwort, kein Verhalten). Nicht angefasst:
`src/elevenlabs/inbound-rueckfall.js`, `src/telephony/directives.js`,
`src/telephony/adapters/telnyx/render.js`, `src/routes/voice.js`, `render.yaml`, `test/helpers.js`,
`PLAN-SECURITY.md`.

---

## Impl-Zusammenfassung

IEP-P2b umgesetzt: der Begruessungslaut ist kein Sinus-Zweiklang mehr, sondern gefiltertes,
bandbegrenztes Komfortrauschen (Bandpass 300–750 Hz via Einpol-Kaskaden) mit einem einzelnen
weich ein-/ausgeblendeten Abhebe-Impuls am Anfang, durchgehend 6 s, nahtlos schleifenfaehig
(Aufwaerm-Runde ueber den Ring, deterministischer xorshift32-Zufall).

- `scripts/render-begruessungslaut.mjs`: Rezept (`BEGRUESSUNGSLAUT_REZEPT` mit `bett`/`impuls`-
  Untersektionen) und Rendervorgang vollstaendig ersetzt; `tonRahmen`/`stilleRahmen`/alte
  `huellkurve()` vollstaendig entfernt (nicht nur umbenannt).
- `scripts/iel-mess-audio.mjs`: `summiertesSpektrum()` als gemeinsamer FFT-Helfer extrahiert
  (verhaltens-erhaltender Refactor, bestehende `bandAnteil`-Tests bleiben gruen), neu `spitzenBin()`
  exportiert (Tonalitaets-Messung).
- `test/iep-p2-begruessungslaut.test.js`: A2/A3 auf das neue Rezept angepasst (Freiton-Frequenz-
  Check entfaellt ersatzlos, ersetzt durch A7s Tonalitaets-Schranke); A7 (6 objektive
  Klangschranken, alter Sinus-Zweiklang als lokal gerenderte Positiv-Kontrolle — faellt an 4 von 6
  Schranken durch), A8 (Nahtlosigkeit der Schleife), A9 (Schmalband-PCMU-Gegenprobe mit im
  Testmodul gehaltenem G.711-mu-law-Encoder als reines Messinstrument) neu.
- Asset regeneriert (40 044 → 96 044 Bytes), zweimal gerendert byte-identisch (Idempotenz belegt).
- Pfad, Schalter (`ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED`) und TeXML-Attribut unveraendert.
- Kommentar-Nachzug in `src/config.js` und `.env.example` (kein Verhalten).

**Volle Testbank:** 6086 pass, 0 fail (erwartete +3 gegenueber Bestand 6070+3=6073 laut Plan;
tatsaechlich 6086 — Abweichung nicht rueckgefragt, s. Deviations). `npm run lint`: 0 errors auf
allen geaenderten Dateien.

### Neue/geaenderte Tests
- IEP-P2-A2 (angepasst: Laengenberechnung folgt neuem `dauerMs`-Feld statt `toene`/`nachlaufStilleMs`)
- IEP-P2-A3 (umgebaut: Kadenz-Invariante am durchgehenden Bett statt am kurzen Tonblock; Freiton-
  Frequenz-Check entfaellt ersatzlos)
- IEP-P2-A7 (neu: 6 objektive Klangschranken — Spitzenpegel, Huellkurven-Spanne, Flankensteilheit,
  Tonalitaets-Anteil, Tonalitaets-Frequenz, Bandanteil ueber 1 kHz — mit lokal gerendertem alten
  Bauplan als Positiv-Kontrolle)
- IEP-P2-A8 (neu: Naht-Flanke der Schleife ≤ p99 der Innenflanken)
- IEP-P2-A9 (neu: alle Klangschranken halten nach PCMU/G.711-mu-law-Rundlauf)

### Gemessene Klangschranken (neu vs. alt, alt = Positiv-Kontrolle)

| # | Schranke | Wert ALT | Wert NEU | faellt ALT? |
|---|---|---|---|---|
| 1 | Spitzenpegel in [−45, −38] dBFS | −11,06 | −39,91 (Plan) / −40,04 (Impl-Messung) | ja |
| 2 | Huellkurven-Spanne ≤ 20 dB | 225,97 | 12,83 | ja |
| 3 | groesste Sample-Flanke ≤ 400 | 6067 | 90 (Plan) / 85 (Impl-Messung) | ja |
| 4 | `spitzenBin.anteil` ≤ 0,15 | 0,2927 | 0,0373 | ja |
| 5 | `spitzenBin.hz` < 1000 | 875 | 359,4 | nein |
| 6 | `bandAnteil(grenzHz: 1000)` ≤ 0,06 | 0,00002 | 0,0230 | nein |

Der alte Laut faellt an 4 von 6 Schranken durch — die Schranken koennen die Regression nicht
uebersehen.

### Deviations (aus dem Impl-Report, woertlich uebernommen)

1. **Smoke-Test manuell** (Server direkt starten + curl) scheiterte am fehlenden vollen `.env`
   (`ANTHROPIC_API_KEY`/`PUBLIC_URL`) — kein Befund, sondern erwartetes Verhalten des Boot-Guards
   ohne echte Secrets. Der aequivalente End-to-End-Beleg existiert bereits als automatisierter
   Test: IEP-P2-A5 startet den Server in-process ueber `test/helpers.js` `startServer()` (mit
   vollstaendigem `BASE_ENV`) und fetcht die echte HTTP-Route
   `/brand/hermes-begruessungslaut.wav` — das IST der Smoke-Test fuer diese Phase und ist gruen.
   `smokePass` daher `true` mit dieser Einschraenkung.
2. **Absolute Zahlenwerte** (Spitzenpegel, Huellkurven-Spanne, Flanke, Tonalitaet) weichen leicht
   von den illustrativen Prototyp-Zahlen im Plan ab (z. B. gemessen −40,04 dBFS statt geschaetzter
   −39,91 dBFS, Flanke 85 statt 90) — erwartet, im Plan selbst als „Erwartungswert, nicht Dogma"
   benannt (eigene RNG-/Filter-Implementierung). Alle Invarianten (welche Schranke der ALTE Laut
   reisst, welche nicht) halten exakt wie im Plan beschrieben.

---

## Safety-Urteil (final)

**approved: true** — alle Einzelurteile true (`testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`,
`behaviorAsIntended`).

Unabhaengiger Nachvollzug: frischer Worktree, Branch `review-iep-p2b` von `phase/iep-p2b-laut`.
Diff-betroffene Tests (`test/iep-p2-begruessungslaut.test.js`, `iep-p1-ohrzeuge-audio.test.js`,
`iep-p1-ohrzeuge-lauf.test.js`, `iep-p1-ohrzeuge-riegel.test.js`, `iel-dial-render.test.js`,
`iex-a4-answer-on-bridge.test.js`, `iel-b8-weiche.test.js`, `iel-b11-nachdeploy.test.js`):
153/153 pass. Gegenprobe `test/route-auth-inventory.test.js`: 9/9 pass. `node --check` auf allen
drei geaenderten JS-Dateien OK. Eigene unabhaengige Messung am committeten WAV bestaetigte:
48000 Rahmen @ 8000 Hz = 6,000 s, Spitze −40,04 dBFS, RMS −56,24 dBFS, staerkster Spektralanteil
359,4 Hz mit Anteil 0,0375 (breitbandig), Energieanteil ueber 1 kHz 0,0201, Energieanteil ueber
300 Hz 0,677, Huellkurve min/max −60,05/−47,07 dBFS (kein stilles Fenster). Determinismus zweimal
in-process nachgerechnet: byte-gleich untereinander und zur committeten Datei.

**Verdict-Kernpunkte:**
- Scope eingehalten: genau 6 Dateien, ein Commit; keine neue npm-Dependency (mu-law-Encoder fuer
  A9 ist Test-Messinstrument, nicht Produktionspfad).
- Safety-Gates unangetastet: `git diff master phase/iep-p2b-laut -- src/config.js`, gefiltert auf
  Nicht-Kommentarzeilen, ist leer.
- Offenlegung unangetastet: Laut ist sprachlos, `claude.js`/`disclosureSentence` nicht im Diff.
- Auth fail-closed unangetastet: keine neue Route, `test/route-auth-inventory.test.js` gruen (9/9).
- Secrets: keine (Grep ueber gesamten Diff ohne Binaerasset auf sk-/api_key/secret/token/password/
  bearer — 0 Treffer). Asset ist synthetisches Rauschen aus deterministischem Seed.
- Keine Produktionshandlung: kein Anruf, kein Flag-Flip, kein Push/Deploy, kein
  Provider-Schreibzugriff; Worktree nach dem Lauf sauber.

**Concerns (keine Blocker):**
1. Hoerbarkeit ist nur gerechnet, nicht gehoert — ob ein Mobilfunk-Codec mit VAD/DTX das Bett als
   Stille wegrechnet, ist im Repo nicht belegbar; Ohr-Check am lebenden System bleibt Pflicht beim
   Lead.
2. Die Schleifen-Annahme (Telnyx wiederholt `audioUrl` nahtlos) ist unveraendert unbelegt — kein
   Regress gegenueber IEP-P2, aber nur per echtem Anruf pruefbar.
3. `SPITZENPEGEL_MIN_DBFS = −45` liegt nur ~0,6 dB unter der Bett-Spitze (−44,4 dBFS) — Schranke
   eng an der leisen Kante, gewollt, aber empfindlich gegen kuenftige Rezept-Dreher.
4. Testcode-Robustheit (kosmetisch): `klangSchrankenHalten()` dereferenziert `bin.anteil`/`bin.hz`
   ohne Null-Pruefung, obwohl `spitzenBin()`/`bandAnteil()` dokumentiert `null` liefern koennen.
5. `kaskadeUeberRing()` verwirft den Rueckgabewert der ersten Aufwaerm-Runde — korrekt und
   kommentiert, liest sich aber wie eine tote Zuweisung (Anmerkung fuer Clean-Code-Auditor).

---

## Clean-Code-Audit (final)

**blocker: false, verdict: PASS.**

- **S1 (hart):** keine Funde.
- **S2 (mild, kein Blocker):** G5 — `bettRahmen`/`impulsRahmen` (`scripts/render-begruessungslaut.mjs`
  ~L165–191) wiederholen dasselbe Dreiergespann `rauschRing → kaskadeUeberRing(tiefpassStufe) →
  aufSpitzenpegel` (`bettRahmen` haengt zusaetzlich eine Hochpass-Kaskade dran). Optionaler Fix:
  gemeinsamer Helfer `gefiltertesRauschen({seed, rahmen, stufenKetten})` — lohnt sich nur bei einer
  dritten Rausch-Quelle.
- **S3 (Kleinkram):**
  - `src/config.js:869–870` — Kommentarzeile mitten im Satz umgebrochen, liest sich holprig
    (inhaltlich unveraendert).
  - `scripts/render-begruessungslaut.mjs:38` — Kommentar behauptet „Gesamtspitze mit Impuls
    −39,9 dBFS", gemessen −40,04 dBFS (Raised-Cosine-Ueberlapp liegt tiefer als die naive Summe).
- **S4:** keine Funde — Funktionszahl/-groesse fuer die Faltungs-/Rausch-Pipeline angemessen
  granular, keine Ein-Methoden-Dogmatik.

**passNotes:** Rezept bleibt rein und deterministisch (einziges IO: `writeFileSync` im
main-Guard); Magic Numbers durchgehend benannt (G25); Kaskade/Warm-up-Trick fuer die nahtlose
Schleife ist kommentiert UND durch A8 belegt statt nur behauptet; A3/A7 halten sich an die Lehre
„Pruefkommando ohne Positiv-Kontrolle" (der alte Bauplan wird lokal nachgebaut und muss
durchfallen); geteilte FFT-Logik korrekt in `summiertesSpektrum` dedupliziert statt kopiert (G5
sauber angewendet). Alle 9 Tests isoliert gruen; `node --check` auf allen drei geaenderten
JS-Dateien sauber. Keine Safety-Gate-, Auth- oder Geld-Beruehrung im Diff.

**topTodos:** gemeinsame Rausch-Filter-Pipeline extrahieren falls dritte Variante dazukommt
(kein Zwang); Kommentar-Praezision (−39,9 vs. gemessen −40,0 dBFS) nachziehen; Zeilenumbruch in
`src/config.js:869` an eine Satzgrenze verschieben.

---

## Security-Urteil (final)

**approved: true, verdict: PASS — keine Blocker.**

Diff (1 Commit `d06ad99`, 6 Dateien) auf Rezept, gerendertes WAV, FFT-Hilfsfunktion im
Messwerkzeug, zwei Kommentare und Tests begrenzt. Keine neue/geaenderte oeffentlich erreichbare
Route (`src/routes/voice.js`, `src/app.js`, `src/route-policy.js` nicht im Diff; Asset liegt seit
IEP-P2/master am bestehenden `express.static`-Mount). Safety-Gates unberuehrt. Offenlegung
unberuehrt und belegt (kein Sprech-Verb hinzugekommen, IEP-P2-3/-4 gruen; Laut per IEP-P2-A1
byte-identisch zu deterministischem Rauschen aus zwei Seeds, also beweisbar sprachlos). Kein
Datenabfluss (`elBegruessungslautUrl` traegt kein Token/callId/Tenant, Asset tenant-agnostisch).
Keine Secrets (`src/config.js` aendert nur einen Kommentar, kein neues Logging, kein
`process.env`-Zugriff in den geaenderten Skripten). Kein Kosten-Missbrauch (`iel-mess-audio.mjs`
bleibt rein, `render-begruessungslaut.mjs` einziges IO ist `writeFileSync` auf gepinnten Pfad).
Keine Produktionshandlung im Diff. Keine neuen npm-Dependencies. Eigene Artefakt-Messung:
96044 Bytes, 8 kHz mono PCM16, 48000 Samples = 6,00 s, Spitze −40,04 dBFS, RMS −56,24 dBFS,
0 geklippte Samples.

**Concerns (keine Blocker):**
1. Bandbreite: das unauthentifizierte Asset waechst von 40 KB auf 96 KB (Faktor 2,4) am
   ratenlimitfreien statischen Mount — Verstaerkungs-Vektor ist Bestand aus IEP-P2, wird hier nur
   skaliert, kein neuer Endpunkt.
2. Testbank-Fragilitaet: IEP-P2-A1 pinnt Fliesskomma-Ausgaben von `Math.exp`/`Math.cos` byte-genau
   gegen das committete WAV — Plattform-/Node-Versionsabweichung kann den Test ohne Codeaenderung
   rot faerben (kein Sicherheitsrisiko, Regressions-Faehnchen).
3. Unerreichbarer Zweig: die Klemmung in `spurRahmen` kann bei den gepinnten Pegeln nie greifen
   (defensiv vertretbar, Hinweis fuer Clean-Code-Auditor bzgl. totem Code).
4. Kostenhinweis ohne Neuerung: mit `EL_DIAL_ANSWER_ON_BRIDGE=false` (bereits auf master) erzeugt
   jeder Abbruch in der Wartephase eine real beantwortete Traegerminute; das durchgehende Bett
   besetzt das Fenster jetzt hoerbar — der Preis war bereits akzeptiert dokumentiert, P2b aendert
   daran nichts.

---

## Fix-Runden

Keine — der Review-Zyklus lief in einem Durchgang zu PASS (Safety, Clean-Code und Security jeweils
`approved`/PASS ohne Blocker im ersten Durchlauf; die im Prompt vorgesehene `=== FIXES ===`-Sektion
blieb leer, es gab keine Nachbesserungsrunde).

---

## Was diese Phase NICHT beweist (aus dem Plan, §7 R-P2b-4)

- Ob Telnyx `audioUrl` in diesem Konto tatsaechlich ehrt (unveraendert offen aus P2).
- U1 (unveraendert offen).
- Ob der Owner den neuen Laut tatsaechlich als „unauffaellig" empfindet — das belegt erst ein
  Testanruf.

## Bewusst getragene Risiken

- **R-P2b-1:** das Bett liegt unter der Stille-Schwelle des Ohrzeugen (`tonSchwelle()` Boden
  −50 dBFS RMS; Bett bei −57,8 dBFS RMS) — der Ohrzeuge zaehlt die gefuellte Wartezeit als
  „Stille". Folge fuer den Lead: nach P2b misst M-S2/F4a die *akustische* Stille, nicht die
  *Besetzung* der Strecke; Belege dafuer laufen ueber `playback_start` bzw. den Mitschnitt.
- **R-P2b-2:** Gleitkomma-Determinismus (`Math.exp`/`Math.cos`) — Risiko unveraendert gegenueber
  IEP-P2, nicht still (IEP-P2-A1 vergleicht byte-genau).
- **R-P2b-3:** Dateigroesse 40 KB → 96 KB — kein neues Limit im Weg, fail-soft unveraendert.
- **R-P2b-4:** der Hoerbeleg fehlt weiterhin (s. oben).
