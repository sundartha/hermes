# Detailbericht Phase IEP-A — Messmaschine ("Ohrzeuge") entfernen

Owner-Entscheidung 2026-09-17 (Nr. 14, `tasks/todo.md`): der Owner-Testanruf ist bestanden, die
Messmaschine hat genau einen unbrauchbaren Lauf gemacht und ist durch den direkten Owner-Anruf
ersetzt — "ich habe keine Lust auf totes Gewicht". Die autoritative Phasendefinition steht in
`tasks/iep-abschluss-spec.md` unter der Ueberschrift "## Phase IEP-A — ..." (Scope, Scope-Haertung
Position 11, NICHT-Scope, Invarianten I1–I7, Testpflicht, Abnahmekriterien, Pre-Mortem R1–R4).

Kern der Phase: die Ohrzeugen-Gruppe war der EINZIGE Weg, auf dem `scripts/iel-mess.mjs` eine
echte Telefonnummer waehlen konnte. Die Entfernung sollte die Angriffsflaeche VERKLEINERN — nach
der Phase weist das Werkzeug fail-closed ab, wenn ein Fall das Feld `ziel_e164`, eine unbekannte
`art` oder eine unbekannte Zaehler-Gruppe traegt (mit Grund, nicht stilles Durchfallen), mit
Tests. Unberuehrt: Zaehler-Gruppen `m1`/`nachdeploy`, der abgenommene Begruessungslaut
(`scripts/render-begruessungslaut.mjs`, `test/iep-p2-begruessungslaut.test.js`),
`test/iel-b11-nachdeploy.test.js` (byte-identisch, gruen), und der gesamte Produktivpfad `src/`
— diese Phase aendert **keine Zeile** in `src/`.

- **Gate:** PASS
- **finalBranch:** `phase/iep-a-ohrzeuge-raus-fix1`
- **Basis:** `master` @ `a157afe`

---

## Plan (gekuerzt)

Leitregel: jedes Symbol, das nach dem Wegfall der Ohrzeugen-Gruppe keinen Verweis mehr hat, faellt
mit ("ist eine Funktion ungenutzt, faellt sie mit"); nichts wird umgebaut, was noch Verweise hat.
Einzige benannte Ausnahme: der Gruppen-Haken `pruefeVorAnruf` faellt mit, weil er danach ein Haken
mit genau einer Implementierung ist, die nichts tut.

Explizit **nicht** umgebaut, obwohl nach der Phase einwertig:
- `mitschnittFormat` (`MITSCHNITT_MP3` in beiden Gruppen) — Kollaps zoege die Konstante in ein
  drittes Modul und editierte den ueberlebenden Nachdeploy-Pfad in einer zweiten Datei; Kosten
  ueber Nutzen.
- `werteMitschnitt`-Haken (`werteMitschnittAus` in beiden Gruppen) — der Haken tut etwas; nur der
  tote Teil daran (`ohneEigeneMitschnittAuswertung`, der `if (mitschnitt)`-Zweig) faellt.
- `texmlWeg(anfrageBauer)`-Fabrik mit nur noch einem Aufrufer — benutzt, nicht tot; Spec verlangt
  nur die Entfernung des Wegs `texml-ohrzeuge`, keinen Umbau.

Betroffene Bereiche laut Plan:
1. `scripts/iel-mess.mjs` — Kopfkommentar, Importe (G12), Konstanten (`MAX_OHRZEUGE_ANRUFE`, der
   ganze `// --- IEP-P1: Ohrzeuge ---`-Block), Gruppen-Registry (Eintrag `ohrzeuge` weg,
   `keineZusatzpruefung`/`ohneEigeneMitschnittAuswertung` weg), Kopplungs-Riegel ersetzt durch
   neue `pruefeFallDefinition(name, fall)` (Kern der Phase — Feld `ziel_e164`, unbekannte `art`,
   unbekannte Zaehler-Gruppe, jeweils mit Grund via `Verweigerung`, `Object.hasOwn` schliesst das
   Prototyp-Loch), `loeseEinstieg` neu verdrahtet, Ohrzeugen-Riegel-Abschnitt weg
   (`werfeWennGesperrt`, `ohrzeugeUmgebung`, `pruefeOhrzeugeZiel`, `ladeSprechspur`,
   `leseKontoNummern`, `vorlaufSicht`, `pruefeOhrzeugeVorAnruf`), `messeAnruf`-Vereinfachung,
   `sammleBelegeNachAnruf` (toter `if (mitschnitt)`-Zweig weg), `neuerBeleg` (`ziel_e164`-Zeilen
   weg), Wege/Sprechspur/Unterbefehle bereinigt (`texml-ohrzeuge` aus beiden Dispatch-Tabellen,
   `sprechspur`-Unterbefehl weg).
2. `scripts/iel-mess.cases.json` — `_hinweis` aktualisiert, Fall `"OZ-vorher"` geloescht, Abschnitt
   `"ohrzeuge"` (Sprechspur-Text/Hash) geloescht.
3. `scripts/iel-mess-belege.mjs` — Importe bereinigt, `// --- IEP-P1: Ohrzeugen-Belege ---`
   komplett weg (`SITZUNGS_EREIGNIS_MAX_SEITEN`, `sammleSitzungsEreignisse`, `leseOhrzeugeAudio`,
   `ohrzeugeAufnahmeSicht`, `ereignisNamen`, `sammleOhrzeugeBelege`). `holeAufnahme`,
   `ladeMitschnitt`, `erkenneSprache` bleiben (Aufrufer `werteMitschnittAus` bleibt, von m1 UND
   nachdeploy benutzt) — nur Kommentar korrigiert.
4. `scripts/iel-mess-anbieter.mjs` — `texmlOhrzeugeDokument`/`-Anfrage`, `ccSprechspurAnfrage`,
   `sitzungsEreignisseAnfrage`, `kontoNummerAnfrage` + Trockenlauf-Muster weg; `musterAufnahme`
   auf ein Format (`mp3`) reduziert.
5. `scripts/iel-mess-audio.mjs` — nur der Ohrzeugen-Teil weg (Huellkurve/Segmente,
   Bandanteil/FFT-Helfer, `FENSTER_MS` u.a. Magic-Number-Konstanten); der gesamte RIFF-Leser
   (`tag`, `leseFormat`, `aLawZuFloat`, `muLawZuFloat`, `probenLeser`, `teileKanaele`,
   `sucheChunks`, `leseWav`, `WavFehler`) bleibt unveraendert — einziger Zweck danach: Quelle des
   abgenommenen Begruessungslauts. `WavFehler` bleibt exportiert (Vertrag von `leseWav`), obwohl
   kein Modul es mehr importiert.
6. Ganze Dateien geloescht: `scripts/iel-mess-ohrzeuge.mjs`, `test/iep-p1-ohrzeuge-audio.test.js`,
   `test/iep-p1-ohrzeuge-lauf.test.js`, `test/iep-p1-ohrzeuge-riegel.test.js`,
   `tasks/iel-ohrzeuge-zaehler.json`, `tasks/iel-ohrzeuge-vorlauf.json`.
   (`tasks/iel-ohrzeuge-sprechspur.mp3` ist untrackt und ausdruecklich NICHT Teil dieser Phase.)
7. `test/_iel-messbaum.mjs` — nur ohrzeugen-exklusive Exporte/Optionen fallen (`MESS_TENANT_ID`,
   Ohrzeugen-Optionen in `bauMessBaum`, `OUTBOUND_FROZEN`/`ELEVENLABS_INBOUND_*` aus `BASIS_ENV`);
   `test/iel-b11-nachdeploy.test.js` bleibt dadurch **byte-identisch** (I1-Ausnahme ausdruecklich
   begruendet: die drei entfallenden Optionen werden von diesem Test nirgends uebergeben).
8. Neue Testdatei `test/iel-mess-fall-riegel.test.js` — Fail-closed-Riegel der Fall-Definition:
   Positiv-Kontrolle (unveraendert kopierter Bestandsfall laeuft trocken durch),
   `ziel_e164` verweigert in jeder Gruppe, unbekannte `art` verweigert mit Grund (inkl.
   `"toString"`-Prototypfalle), unbekannte Zaehler-Gruppe verweigert mit Grund. Kein Netz
   (`--dry-run`), eigener temp-Messbaum.
9. `PLAN-SECURITY.md` — Eintrag U1 als am 2026-09-17 durch den bestandenen Owner-Testanruf
   geschlossen dokumentiert.
10. Deterministisch pruefbare Kommandokette (node --check, eslint, `grep -ril ohrzeuge`, `status`,
    argumentloser Aufruf, isolierte + volle Testbank, `git diff --stat` auf `src/` und die
    geschuetzten Testdateien).

Pre-Mortem-Abgleich im Plan: R1 (Begruessungslaut nicht mehr herstellbar) — RIFF-Leser bleibt
vollstaendig unveraendert. R2 (Nachdeploy-Probe beschaedigt) — Byte-Identitaet + gruener Lauf
belegt. R3 (Werkzeug waehlt wieder eine echte Nummer) — `ziel_e164` jetzt ueberall verboten,
`Object.hasOwn` schliesst Prototyp-Loch, vier Tests inkl. Positiv-Kontrolle. R4 (Verweise ins
Leere) — U1 geschlossen statt verwaist.

Commit-Zuschnitt (einzeln rueckrollbar): 1) `refactor(iep-a)` Code/Faelle/geloeschte Dateien,
2) `test(iep-a)` Fail-closed-Testdatei, 3) `docs(iep-a)` PLAN-SECURITY U1.

---

## Impl-Zusammenfassung

- **headCommit:** `b5afabcdd6ff6c28cd122f29abebd634f0e187c2`
- **node --check:** PASS (alle geaenderten Dateien)
- **Tests:** PASS — 6055 pass / 0 fail
- **committed:** ja, drei Commits wie im Plan vorgesehen (refactor/test/docs)

Die Ohrzeugen-Messmaschine (IEP-P1/P1b) ist restlos aus `scripts/iel-mess*.mjs`,
`scripts/iel-mess.cases.json`, `test/_iel-messbaum.mjs` entfernt; `scripts/iel-mess-ohrzeuge.mjs`,
die drei Ohrzeugen-Testdateien und die beiden Ohrzeugen-Zaehlerdateien sind geloescht. An die
Stelle des alten Art/Zaehler-Kopplungsriegels tritt `pruefeFallDefinition`
(`scripts/iel-mess.mjs`, direkt vor `loeseEinstieg`): jeder Fall mit dem Feld `ziel_e164`,
unbekannter `art` oder unbekannter Zaehler-Gruppe wird fail-closed mit Grund abgewiesen
(`Object.hasOwn` schliesst das Prototyp-Loch) — das Werkzeug waehlt seitdem ausschliesslich
SIP-Ziele, nie eine echte Telefonnummer. `test/iel-mess-fall-riegel.test.js` deckt das mit
Positiv-Kontrolle + drei Negativ-Faellen (4/4 gruen).

`m1`/`nachdeploy`, der abgenommene Begruessungslaut (`scripts/render-begruessungslaut.mjs`,
`test/iep-p2-begruessungslaut.test.js`) und `test/iel-b11-nachdeploy.test.js` sind byte-identisch
unveraendert (per `git diff --stat` gegen Basis `a157afe` belegt, leer). `src/` ist unberuehrt
(`git diff --stat` leer). PLAN-SECURITY.md: U1-Eintrag als durch den Owner-Testanruf vom
2026-09-17 geschlossen dokumentiert. Volle Testbank: 6055 pass / 0 fail
(`--test-concurrency=4`, beide Backends). eslint: 0 Fehler (nur vorbestehende, unveraenderte
Warnings).

**filesEdited:** `scripts/iel-mess.mjs`, `scripts/iel-mess.cases.json`,
`scripts/iel-mess-belege.mjs`, `scripts/iel-mess-anbieter.mjs`, `scripts/iel-mess-audio.mjs`,
`test/_iel-messbaum.mjs`, `PLAN-SECURITY.md`
**filesCreated:** `test/iel-mess-fall-riegel.test.js`
**testsAddedOrChanged:** `test/iel-mess-fall-riegel.test.js` (neu, 4 Faelle)

**smokePass:** false — Server-Boot lokal verweigert ohne zusaetzliche Pflicht-Env
(`ANTHROPIC_API_KEY` u.a.), unabhaengig von dieser Phase (`src/` unberuehrt); kein Blocker fuer
eine reine Skript/Test-Aenderung.

**cleanCodeSelfCheck (Impl):** Clean-Code-Katalog befolgt — keine Duplizierung neu eingefuehrt
(Schnittregel gegen Umbau bewusst abgewogen, z.B. `mitschnittFormat`/`werteMitschnitt`/`texmlWeg`
bleiben bewusst stehen); keine Magic Numbers ausser 0/1/-1 neu eingefuehrt (`EXIT_VERWEIGERT=2`
als benannte Konstante, `MITSCHNITT_MP3` bleibt benannte Konstante); toter/auskommentierter Code
entfernt (`rendereSprechspur`, die vier Ohrzeugen-Riegel, `WavFehler`-Huellkurve/Bandanteil-Zweig
ohne verbleibenden Aufrufer); ungenutzte Imports entfernt (`createHash`,
`synthesizeSpeechStream`, `ohrzeugeSperrenGrund`/`ohrzeugeVorlaufGrund`/`sprechspurKommandoId`,
`sitzungsEreignisseAnfrage`, `WavFehler`-Import in `iel-mess-belege.mjs`); intentions-ausdrueckende
Namen (`pruefeFallDefinition`, `laufMitAbgewandeltemFall`); eine Aufgabe pro Funktion; ≤3
Argumente eingehalten; ESM/kein Build-Step/Kommentare deutsch ohne Umlaute beibehalten; kein
`no-param-reassign`-Verstoss im neuen Test (Destrukturierung statt Mutation, per eslint 0 Fehler
bestaetigt); reiner Refactor (Commit 1) laesst die Bestandssuite ohne Test-Aenderung gruen
(`test/iel-b11-nachdeploy.test.js`, `test/iep-p2-begruessungslaut.test.js` byte-identisch, 33/33
gruen), neues Verhalten (Commit 2) traegt einen eigenen Regressionstest.

### Deviations

- Plan-interner Widerspruch in §10 (I5-Grep): die dort verlangte
  `grep -ril ohrzeuge src scripts test -> KEINE Ausgabe` ist mit dem woertlich vorgegebenen
  Kommentartext aus §1.5 (`pruefeFallDefinition`: "...gab es nur fuer die entfernte
  Ohrzeugen-Gruppe...") und dem Docstring/Testnamen aus §8 (`test/iel-mess-fall-riegel.test.js`)
  unvereinbar — beide Textstellen sind exakt wie im Plan vorgegeben umgesetzt und enthalten
  bewusst "Ohrzeugen-Gruppe" als historische Begruendung. Der zweite, praezisere Grep in §10
  (`sprechspur|ziel_e164|texml-ohrzeuge`) bestaetigt exakt die vom Plan selbst erlaubten
  Fundstellen. Kein Code-Verhalten betroffen, reine Kommentar-Diskrepanz zwischen zwei
  Pruefzeilen im selben Plan. Dieser Widerspruch fuehrte im Review-Fix-Durchgang r1 zur Behebung
  der tatsaechlichen I5-Verletzung (siehe Abschnitt Fix-Runden unten).

---

## Safety-Urteil (final)

- **approved:** true
- **testsPassIndependently:** true
- **safetyGatesIntact:** true
- **disclosureIntact:** true
- **authFailClosedIntact:** true
- **noSecretsLeaked:** true
- **scopeRespected:** true
- **behaviorAsIntended:** true
- **blockers:** keine

**Unabhaengiger Testlauf:** `node --test --test-concurrency=4 test/iel-mess-fall-riegel.test.js
test/iel-b11-nachdeploy.test.js test/iep-p2-begruessungslaut.test.js` → Exit 0, 37 Tests, 37 pass,
0 fail. Zusaetzlich die zwei Baenke, die das `test/`-Verzeichnis aufzaehlen
(`test/abnahme-bahn-selbsttest.test.js`, `test/i18n-catalog-run.test.js`) → Exit 0, 19/19. `node
--check` auf allen sechs geaenderten Dateien OK; eslint Exit 0; `node scripts/iel-mess.mjs
status` Exit 0 (nur `m1`/`nachdeploy`, nirgends `ohrzeuge`); `grep -ril ohrzeuge src scripts
test` Exit 1 (keine Treffer). Keine Produktionshandlung: kein Anruf, kein Flag-Flip, kein Push,
kein Deploy, kein Schreiben in Zaehlerdateien (`zeigeStatus` nachweislich rein lesend).

**Verdict:** PASS. IEP-A haelt den Auftrag exakt ein und macht das System nachweislich sicherer,
nicht unsicherer.

- **SCOPE:** echter Phasen-Diff gegen Merge-Base `a157afe` (nicht gegen den vorgelaufenen
  master): 14 Dateien, +130/-1905, genau die Spec-Liste. `git diff a157afe..HEAD -- src/
  .env.example render.yaml package.json` LEER: keine Zeile Produktivcode, keine
  Env-/Render-Aenderung, keine neue npm-Abhaengigkeit. Invariante I7 erfuellt.
- **Sicherheitskern (R3):** mit `iel-mess-ohrzeuge.mjs` verschwinden auch dessen
  `OUTBOUND_FROZEN`-, Denylist- und Kostendecken-Pruefungen — zulaessig, weil es
  werkzeug-eigene Riegel waren (nie Produktions-Gates, `src/telephony/outbound-gates.js`
  unveraendert) und weil der Gegenstand entfaellt: das Werkzeug kann ueberhaupt keine
  Telefonnummer mehr waehlen. Belegt: `pruefeFallDefinition` (`scripts/iel-mess.mjs:936`) sitzt in
  `loeseEinstieg`, also VOR `baueKontext` und vor jedem Netzzugriff, weist fail-closed ab
  (`ziel_e164` in JEDER Gruppe, unbekannte `art`, unbekannte Zaehler-Gruppe, je mit Grund, je Exit
  2, nie stilles `undefined`), `Object.hasOwn` ist prototypensicher (`toString`-Test). Verbliebene
  Waehl-Bauer lesen ausschliesslich `fall.sip_ziel`, allowlist-validiert. Kein `<Number>`-Verb
  mehr im `scripts/`-Baum.
- **Offenlegung/Auth/Secrets:** `src/` unangetastet → `disclosureSentence`, Outbound-Offenlegung,
  `first_message`-Hinweis, die sieben Sicherungen in `/voice/incoming` konstruktiv unveraendert.
  Keine neuen Endpunkte, keine Auth-Beruehrung, keine Signaturpruefung angefasst. Keine neuen
  Secrets im Diff; Testwerte sind Attrappen; Fehlerausgabe laeuft durch `maskiereNummern`. Die
  geloeschte `tasks/iel-ohrzeuge-vorlauf.json` nimmt sogar Tenant-Id und
  Kostendecken-Restbetrag aus dem Arbeitsbaum.
- **Invarianten:** I1/I2 halten (`git diff --stat` auf `test/iel-b11-nachdeploy.test.js`,
  `test/iep-p2-begruessungslaut.test.js`, `scripts/render-begruessungslaut.mjs` leer;
  `iel-mess-audio.mjs` behaelt genau `leseWav`/`WavFehler`). I3–I7 wie oben belegt. Kein toter
  Code.

**Concerns (keine Blocker):**
1. STALE BASE (operativ, kein Code-Defekt): Branch sass auf `a157afe`, master stand auf
   `ff180c0`. `git diff master <branch>` zeigte faelschlich `tasks/kickoff-abnahme-anrufdefekte.md`
   (226 Z.) und `tasks/p7-vorher-messung.md` (30 Z.) als GELOESCHT — beide erst nach dem Abzweig
   auf master hinzugefuegt, von der Phase nicht angefasst. Echter Phasen-Diff gegen Merge-Base:
   14 Dateien, +130/-1905, enthaelt diese beiden Dateien nicht. Der Lead MUSS regulaer mergen;
   ein Reset/Force auf den Branch-Stand wuerde die zwei Docs stillschweigend loeschen.
2. Testwert-Abdeckung vs. Invariante I5: Der Fix-Commit (r1) musste die Literale
   `"texml-ohrzeuge"` und `"ohrzeuge"` aus den neuen Tests entfernen, damit `grep -ril ohrzeuge`
   leer bleibt. Damit ist der exakte Regressionswert der entfernten Gruppe nicht mehr
   festgenagelt; getestet wird jetzt mit `"texml-erfunden"`/`"x"`/`"toString"`/`undefined`.
   Unkritisch, weil die Abweisung eine Allowlist ueber `Object.hasOwn` ist (wertunabhaengig),
   keine Denylist bekannter Altwerte.
3. Das Feldverbot ist namensgebunden (`ziel_e164`). Ein spaeter anders benanntes Feld fuer eine
   Telefonnummer wuerde diese eine Pruefung nicht greifen. Tragende Sicherung bleibt aber die
   Allowlist der Ziele (`pruefeSipZiel`/`pruefeFiktivesElZiel`); kein `<Number>`-Verb mehr im
   `scripts/`-Baum. Angriffsflaeche strikt kleiner als vorher, nicht groesser.
4. `test/_iel-messbaum.mjs` pinnt `OUTBOUND_FROZEN`, `ELEVENLABS_INBOUND_SCOPE`,
   `ELEVENLABS_INBOUND_TENANT_IDS` nicht mehr in `BASIS_ENV` — korrekt, da
   `scripts/iel-mess.mjs` diese Werte nirgends mehr liest. Kuenftiger Messfall, der eine dieser
   Variablen wieder liest, muss sie laut Bestandslehre "BASE_ENV-Drift" sofort nachtragen.

---

## Clean-Code-Audit (final)

- **s1 (Blocker):** keine
- **s2 (Blocker):** keine
- **s3 (Hinweise):**
  - G12 · `scripts/iel-mess-anbieter.mjs` (Trockenlauf-Muster) — `musterAntwort` behaelt die
    Regel fuer `/v2/phone_numbers?` nicht mehr (korrekt entfernt); kein erkennbarer Verstoss mehr
    — n. z., nur als sauber vermerkt.
  - N1 · `scripts/iel-mess-audio.mjs` Kopfkommentar — "EINZIGER Zweck: die Quelle des
    abgenommenen Begruessungslauts" praezise und korrekt, keine Handlung noetig.
- **s4:** G30/P1(S4) · `scripts/iel-mess.mjs` — `pruefeFallDefinition` uebernimmt sowohl
  Art/Zaehler-Validierung als auch `ziel_e164`-Verbot in einer Funktion, bewusst klein (3
  Pruefungen), kein Aufblaehen sichtbar, PASS.
- **blocker:** false

**Verdict:** PASS. Der Diff entfernt die Ohrzeugen-Messmaschine sauber und vollstaendig. Keine
toten Referenzen, keine verwaisten Imports/Exporte: `zaehlerHash`/`aendereKonfigurationIn`
korrekt von `export` auf modul-lokal zurueckgestuft (git grep bestaetigt). Der neue
Fail-closed-Test deckt exakt das verbliebene Verhalten ab und ersetzt sinnvoll die vier engeren
Ohrzeugen-Riegel-Tests. PLAN-SECURITY.md konsistent nachgezogen. Gezielt nachgefahrene Testbank
(29/29 gruen) sowie `node --check` auf allen vier geaenderten Skripten bestehen.

**passNotes:** (1) G5-Duplizierung vermieden — `pruefeFallDefinition` ersetzt die vorherige
zweigleisige Pruefung (`gruppeFuer` + `pruefeArtZaehlerPaarung`) durch eine einzige, klar benannte
Funktion ohne Wiederholung. (2) Keine Reste: kein toter/auskommentierter Code, keine verwaisten
Kommentar-Verweise auf geloeschte Symbole. (3) Testabdeckung fuer neues Verhalten vorhanden
(Fail-closed-Riegel-Test inkl. Positiv-Kontrolle). (4) PLAN-SECURITY.md konsistent aktualisiert.
(5) Magic-Number-Konstanten (`FFT_BLOCK`, `HANN_A`, `DBFS_BODEN` etc.) komplett mitentfernt, keine
verwaisten Konstanten uebrig. (6) Sicherheitsrelevant: die entfernte Ohrzeugen-Gruppe war der
einzige Pfad in diesem Werkzeug, der ausserhalb der `outbound-gates.js` eine echte Telefonnummer
waehlen konnte — restlose Entfernung reduziert Angriffsflaeche.

**topTodos:**
- Keine Blocker — Phase mergefaehig aus Clean-Code-Sicht.
- Vor dem Merge (ausserhalb dieses Audits) pruefen: verbleiben irgendwo noch
  Dateisystem-Reste (`tasks/iel-ohrzeuge-sprechspur.mp3` lag als untrackt im uebergeordneten
  Repo) — die gehoeren nicht in den Commit, sondern geloescht/ignoriert.
- Kickoff-Datei nennt Arbeitspaket A als "zuerst" abgeschlossen — B (Rollout) und C
  (Budget-Engine-Loeschung) bleiben laut Kickoff offen, ausserhalb des geprueften Diffs.

---

## Security-Urteil (final)

- **approved:** true
- **blockers:** keine

**Verdict:** PASS. Der IEP-A-Diff ist eine reine Verkleinerung der Angriffsflaeche und erfuellt
das Kern-Sicherheitsziel der Spec. `src/` nachweislich unberuehrt
(`git diff --stat a157afe..HEAD -- src/ apps/` leer) — Auth, Route-Policy,
Telnyx-Signaturpruefung, Offenlegungssatz/`first_message` und alle Safety-Gates unveraendert.
Wichtig fuer den Lead: der Branch stand auf Basis `a157afe`, master war zwei Commits weiter
(`ff180c0`, `116905e`) — die in `git diff master phase/...` sichtbaren Loeschungen von
`tasks/kickoff-abnahme-anrufdefekte.md` und `tasks/p7-vorher-messung.md` sind Stale-Base-Artefakte
und KEINE Aenderung dieser Phase.

R3 ist real geschlossen: `scripts/iel-mess.mjs:pruefeFallDefinition` laeuft in `loeseEinstieg` vor
jedem Transport und weist `ziel_e164`, unbekannte `art` und unbekannte Zaehler-Gruppe fail-closed
mit Grund ab (Exit 2, `Object.hasOwn` deckt Prototyp-Schluessel); beide verbliebenen Waehl-Pfade
(TeXML-Bruecke, CC-direkt) gehen ausschliesslich auf per `pruefeSipZiel`/`pruefeFiktivesElZiel`
validierte SIP-Ziele. Kein Secret-, Nummern- oder Transkript-Abfluss in Logs oder Belegen
(`ziel_e164` faellt aus `neuerBeleg` weg, Fehlertexte nennen nur Feldnamen und laufen durch
`maskiereNummern`), keine neuen Dependencies, kein toter Code.

Selbst verifiziert, alles offline und ohne Produktionshandlung: `node --check` auf allen 6
geaenderten Dateien OK; `iel-mess.mjs status --dry-run` Exit 0 mit genau `m1`/`nachdeploy` und 0
fetch-Aufrufen (I3); Usage nennt `sprechspur` nicht mehr (I4); `grep -ril ohrzeuge` ueber
`src scripts test` leer (I5); `test/iel-b11-nachdeploy.test.js` und
`test/iep-p2-begruessungslaut.test.js` byte-unveraendert und gruen (I1/I2); volle Testbank
`npm test -- --test-concurrency=4`: 6035/6035, fail 0.

**Concerns (unterhalb der Blocker-Schwelle, keiner oeffnet einen Weg zu Anruf/Kosten/Daten):**
1. Testabdeckung vs. Spec-Wortlaut: der Review-Fix hat die konkreten historischen Angriffswerte
   `"texml-ohrzeuge"` und `"ohrzeuge"` aus `test/iel-mess-fall-riegel.test.js` entfernt, um
   Invariante I5 zu erfuellen. Die Spec verlangte ausdruecklich "insbesondere
   texml-ohrzeuge"/"insbesondere ohrzeuge". Verhaltensgleich, weil `pruefeFallDefinition` per
   `Object.hasOwn` wertunabhaengig prueft — aber der Konflikt I5-gegen-Spec sollte vom Lead
   bewusst als so entschieden vermerkt werden.
2. Asymmetrie bei Namenskollision: `loeseEinstieg` prueft `UNTERBEFEHLE[name]` VOR
   `pruefeFallDefinition`. Ein Fall in `cases.json`, der `status`/`setup`/`teardown` heisst,
   umgeht damit die neue Validierung. Folgenlos — der Unterbefehl gewinnt, es wird nichts
   gewaehlt und nichts geleakt — aber die einzige Stelle, an der die neue Pruefung nicht laeuft
   (`scripts/iel-mess.mjs:loeseEinstieg`).
3. Counter-Shopping: mit dem Wegfall des Art-zu-Zaehler-Kopplungsriegels sind `art` und `zaehler`
   vollstaendig unabhaengig. Ein Fall laesst sich per `cases.json` von `nachdeploy` (max 3, enge
   `pruefeFiktivesElZiel`) auf `m1` (max 5, loesere `pruefeSipZiel` inkl. Spike2/TEST-NET)
   umhaengen. Beide Gruppen bleiben SIP-only, galt schon vor dieser Phase — keine Regression,
   residual.
4. Das Messwerkzeug umgeht `src/telephony/outbound-gates.js` und `OUTBOUND_FROZEN` vollstaendig
   (Bestand, von diesem Diff unveraendert). Kosten-Exposition haengt allein an den eigenen
   Zaehlern (`m1` max 5, `nachdeploy` max 3), Sperrdatei, 60-s-Deckel — nicht an den
   Produkt-Gates. Da nach dieser Phase kein Pfad mehr eine echte Telefonnummer waehlt, entsteht
   keine neue Exposition; weiter im Blick behalten.

---

## Fix-Runden

**r1** (Branch `phase/iep-a-ohrzeuge-raus-fix1`, Basis `phase/iep-a-ohrzeuge-raus`): beide
Review-Blocker der Phase behoben, minimal und ohne Scope-Drift.

1. I5-Verletzung (`grep -ril ohrzeuge src scripts test` lieferte 2 Treffer statt nichts): in
   `scripts/iel-mess.mjs` Kommentar umgeschrieben, der die Woerter "ohrzeuge"/"Ohrzeugen"
   enthielt, sowie der zugehoerige Docstring/Testname in `test/iel-mess-fall-riegel.test.js`
   (dort zusaetzlich die Literale `"texml-ohrzeuge"`/`"ohrzeuge"` durch wertunabhaengige
   Ersatzwerte wie `"texml-erfunden"`/`"x"` ersetzt — Konsequenz siehe Security-Concern 1 oben).

Ergebnis nach r1: `grep -ril ohrzeuge src scripts test` liefert keine Ausgabe (Exit 1), volle
Testbank weiterhin gruen, `finalBranch` = `phase/iep-a-ohrzeuge-raus-fix1`.
