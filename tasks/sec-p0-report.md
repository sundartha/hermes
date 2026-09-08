# Phase SEC-P0 — Testbank gruen

**Status:** Testbank gruen, Gate = **PASS**
**finalBranch:** `sec/p0`
**Basis:** `master` @ `6508268`

---

## Plan (gekuerzt)

Ausgangsmessung: 5 volle `npm test`-Laeufe zeigten genau EINEN deterministischen roten Fall
(`KV2-10`, `test/kv2-10-tarifpaar.test.js`, 5/5 Laeufe) und einen einmaligen Flake
(`OUT-05b` in `test/dial-target-normalization.test.js`, 1/5 Laeufe). Die im urspruenglichen
Protokoll genannten fuenf Verdachtsdateien feuerten in keinem der 5 Laeufe — der Plan verwirft
diese Liste als Ursachenbeleg und zerlegt die Phase in zwei Teile:

**Teil (a) — Tarifpaar-Defekt (Wurzel gemessen, nicht vermutet):**
`test/kv2-10-tarifpaar.test.js` (`sweepMitTarifpaar`) bewertete die Fixture
`test/fixtures/kostenv2-vollkosten-stichprobe.js` gegen `Date.now()` statt gegen deren festen
Anker `STICHPROBEN_ENDE_MS` (2026-08-30T12:00:00Z). `coverageBucketOf`
(`src/billing/cost-truing.js`) wirft Anrufe nach `PROVIDER_COST_RECORD_WINDOW_DAYS=7` in
`OUTSIDE_WINDOW`. Ab 2026-09-06T12:00Z fielen alle 8 Stichproben aus dem Belegfenster,
Deckung sank auf 0 %, und der Sweep meldete zusaetzlich `coverage_below_threshold` — ein
zweiter, eigener Sachverhalt, der die Zaehlung der Testfaelle (`mailCalls.length`) verfaelschte.

Entscheidung: der **Test** wird geaendert, nicht der Code. Beleg: Differentialmessung zeigt,
dass derselbe unveraenderte Code bei `now` innerhalb des 7-Tage-Fensters exakt die geforderten
Zahlen liefert (1/1 bzw. 0/0); `coverage_below_threshold` hat eigene, unabhaengige Testabdeckung
in drei anderen Dateien.

Edits (Plan): `STICHPROBEN_ENDE_MS` aus der Fixture exportieren (EINE Uhr-Quelle, G5);
`sweepMitTarifpaar` nutzt diesen Anker statt `Date.now()`; d1 bekommt zusaetzlich eine
Identitaets-Zusicherung (`grund=tarifpaar_unterschaetzt`), damit die gezaehlte Meldung nicht
von einem fremden Befund erfuellt werden kann — strikt staerker, keine Aufweichung.

**Teil (b) — Flakes:** kein Blindpatch der fuenf alten Verdachtsdateien. Pflicht-Feedback-Loop
(6 volle `npm test`-Laeufe) mit drei zulaessigen Ausgaengen: (A) reproduziert -> gezielter Fix
(erlaubt: deterministische Bereitschaftspruefung, eigener Zustand/Port je Test, sauberes
Prozess-Aufraeumen, injizierte Uhr statt Wanduhr; verboten: Retry-bis-gruen, pauschale
Timeout-Erhoehung, `--test-concurrency 1`, Aenderung an `--test-skip-pattern`);
(B) nichts reproduziert -> keine Aenderung, Messung selbst ist der Beleg; (C) reproduziert,
Wurzel ausserhalb Testcode -> Befund dokumentieren, an eigene Phase uebergeben. Diese zwei
vollen Laeufe faehrt laut Spec der Lead, nicht der Impl-Agent.

Abgrenzung: kein Produktionscode, keine neue Env-Variable, keine neue Abhaengigkeit, keine
neuen Testdateien.

---

## Implementierung — Zusammenfassung

- **headCommit:** `62ce0794ed3e37e041514491edc63ef97df79061` auf `sec/p0`
- **Geaenderte Dateien (genau 2, ausschliesslich Testcode):**
  - `test/fixtures/kostenv2-vollkosten-stichprobe.js` — `STICHPROBEN_ENDE_MS` exportiert
    (vorher modul-privat), mit Kommentar zur Kausalitaet (7-Tage-Belegfenster).
  - `test/kv2-10-tarifpaar.test.js` — Import erweitert; `sweepMitTarifpaar` nutzt
    `STICHPROBEN_ENDE_MS` statt `Date.now()` als `now`; d1 bekommt zusaetzliche
    `assert.match(..., /grund=tarifpaar_unterschaetzt/)`-Zusicherung.
- **node --check:** bestanden (beide Dateien)
- **Tests:** `test/kv2-10-tarifpaar.test.js` isoliert: **17/17 gruen** (vorher 15 pass / 2 fail)
- **committed:** ja (auf `sec/p0`)
- **smokePass:** false — Server-Smoke best-effort fehlgeschlagen, aber Ursache unabhaengig
  vom Change (Boot-Guard: kein Tenant/keine Nummer im frischen Store geseedet). Kein Blocker,
  da der Change ausschliesslich Testcode beruehrt.

### Deviations

1. **Teil (b) nicht ausgefuehrt.** Die Delegationsvorgaben verbieten dem Impl-Agenten volle
   `npm test`-Laeufe (nur betroffene Testdateien im Vordergrund). Folgerichtig keine
   Flake-Reproduktion versucht, keine Aenderung an `dial-target-normalization.test.js` oder
   anderen Verdachtsdateien (= Ausgang B des Plans). **Der Lead muss die zwei vollen
   `npm test`-Laeufe aus Plan Abschnitt 5 noch selbst fahren, um Teil (b) abzuschliessen.**
2. **node_modules-Symlink-Korrektur.** Der in VORGEHEN Schritt 1 woertlich vorgegebene Befehl
   (`ln -s ./node_modules node_modules`) erzeugte einen selbst-referenzierenden Symlink
   („Too many levels of symbolic links"), `npm run lint` brach mit Exit 194 ohne Ausgabe ab.
   Korrigiert auf Symlink zum echten `node_modules` des Haupt-Repos; danach `npm run lint`
   sauber (0 Fehler, 67 Bestands-Warnungen, unveraendert durch diesen Commit). Symlink wurde
   NICHT committet.

---

## Safety-Urteil

**verdict: PASS** (`approved: true`)

- testsPassIndependently: true — eigener Lauf auf `sec/p0`: `test/kv2-10-tarifpaar.test.js`
  17/17. Gegenprobe der Wurzel unabhaengig gefahren: `master`-Version derselben Datei via
  `git show master:...` materialisiert -> 15 pass / 2 fail, mit Logzeile
  `grund=coverage_below_threshold deckung=0%` und den erwarteten Assertion-Diffs
  (actual 2/expected 1 Mail, actual 1/expected 0 SMS). Die genannte Ursache ist damit
  unabhaengig belegt, nicht nur behauptet.
- safetyGatesIntact: true, disclosureIntact: true, authFailClosedIntact: true,
  noSecretsLeaked: true, scopeRespected: true, behaviorAsIntended: true
- **Diff-Scope:** exakt zwei Testdateien, NULL Zeilen in `src/`, `apps/`, `scripts/`,
  `package.json`, `package-lock.json`, `.env.example`, `render.yaml`, keine neue Dependency.
  Damit sind Safety-Gates, der fest verdrahtete Offenlegungssatz, fail-closed-Auth und
  Audio-nie-durch-MCP konstruktionsbedingt unberuehrt. Secret-Pattern-Grep ueber den Diff leer.
- **Concerns (kein Blocker):**
  - Fixture ist jetzt vertraglich uhr-gekoppelt (`STICHPROBEN_ENDE_MS` exportiert) — jeder
    kuenftige Verbraucher, der sie gegen eine Uhr auswertet, MUSS diesen Anker als `now`
    nehmen. Kommentar an der Export-Zeile sagt das explizit; aktuell genau EIN Verbraucher.
  - Gegengeprueft und entkraeftet: das Pinnen der Uhr verdeckt keinen Produktionsdefekt —
    die Fensterlogik (`PROVIDER_COST_RECORD_WINDOW_DAYS=7`, `src/billing/cost-truing.js:294`)
    ist unveraendert und feuert weiter; genau ihr Feuern hatte `master` rot gemacht.
    `coverage_below_threshold` behaelt eigene Abdeckung in drei anderen Dateien
    (`cost-truing-observe`, `kv2-1-kosten-alarm-naht`, `kv2-6-deckung-herzschlag`).
- blockers: keine

---

## Clean-Code-Audit (s1-s4)

**verdict: PASS**, blocker: false

- s1: []
- s2: []
- s3: []
- s4: []

Begruendung: winziger, gezielter Fix (2 Dateien, 18 Zeilen). Behebt eine reale
P12/R-Verletzung (Test war nicht wanduhr-unabhaengig repeatable, waere ab 06.09.2026 rot
geworden). Zusaetzliche Assertion (`grund=tarifpaar_unterschaetzt`) haertet den Test gegen
Verwechslung mit fremdem Befund — Gegenteil von Verwasserung. Keine neue Duplizierung (Anker
existierte bereits, nur Export ist neu), keine Magic Numbers, keine abgeschalteten
Sicherungen, keine Struktur-/Namensverstoesse. Kommentare deutsch ohne Umlaute, erklaeren die
Kausalkette statt nur zu behaupten. Alle 17 Tests isoliert gruen, verifiziert im
sec/p0-Worktree. Kein FLAG in irgendeiner Kategorie. Keine Pflicht-Todos.

---

## Fix-Runden

Keine — Implementierung erreichte PASS in beiden Reviews ohne Nacharbeit.

---

## Offen fuer den Lead

Teil (b) des Plans (Flake-Diagnose ueber 6 volle `npm test`-Laeufe, Plan Abschnitt 2.2) wurde
bewusst NICHT vom Impl-Agenten ausgefuehrt (Delegationsvorgabe). Vor Abschluss der Phase muss
der Lead:

1. die 6 vollen `npm test`-Laeufe aus Plan Abschnitt 2.2 fahren und auswerten (Ausgaenge A/B/C),
2. die zwei vollen Bestaetigungslaeufe aus Plan Abschnitt 5 fahren (`exit=0` in beiden,
   `# fail 0`, `# tests 5803`, `# skipped 0`, `# todo 0`).
