# AL-P5 — Die Eröffnung kürzen: Detailbericht

- **Gate:** PASS
- **finalBranch:** `phase/al-p5-eroeffnung-fix2`
- **Basis:** `master` (`11ccd39`)

## Plan (gekürzt)

Ziel: das ungeschützte Fenster am Anfang eines Outbound-Anrufs (Offenlegung + Bruecke + Anliegen) verkürzen, bevor der Angerufene auflegt.

- **E1** — Kappe `OPENING_GOAL_MAX_CHARS` (in `src/claude.js`) von `160` auf das obere Band-Ende `70` senken. Rechnung: DE-Offenlegung 130 Zeichen + Bruecke 23 Zeichen; bei Kappe 160 ergibt sich eine Eröffnung von bis zu 314 Zeichen (~16–18 s), bei Kappe 70 höchstens 224 Zeichen (~11–13 s). Begründung für 70 statt der unteren Bandgrenze 60: `trimGoalForSpeech` schneidet hart an der Wortgrenze ohne Satzbau-Kenntnis — bei 60 verlieren reale Testaufträge ihr Verb (z. B. „... Herrenhaarschnitt" statt „... Herrenhaarschnitt vereinbaren"), bei 70 nicht.
- **E2** — `USER_IDLE_REPLY_SECS` (Telnyx-Provisioner-Skript) von `4` auf `2` senken, ein einzelner Knopf wie in AL-P3. Wirkung tritt erst nach einem manuellen Owner-Provisioner-Lauf ein; der Code allein ist live wirkungslos.
- **E3** — keine neue Env-Variable; beide Werte bleiben Modulkonstanten (Produktentscheidungen, keine Betriebsparameter; RUNBOOK hält für die Provisioner-Werte ausdrücklich „keine Env-Var" fest).
- **E4** — `trimGoalForSpeech` bleibt mechanisch unverändert (kein „klügerer" Satzgrenzen-Trimmer, kein ungefragter Scope).
- **E5** — die Bench-Schwelle `scenario.maxOpeningChars` wird gesetzt (vom AL-P8-Kommentar explizit an AL-P5 übergeben): laengstmögliche DE-Eröffnung nach der Kürzung, als benannte Konstante `BENCH_MAX_OPENING_CHARS`, per Test an das echte `openingText` gekoppelt.

Ausdrücklich NICHT gebaut: Offenlegungssatz unverändert (Regel 2), kein Opening-Split, kein Opening-Prefetch, keine Änderung an `TEXT_LIMITS.objective`, kein neuer Endpunkt/Route/Dependency/Flag.

**Betroffene Dateien laut Plan:** `src/claude.js` (Kappe), `scripts/telnyx-assistant-provision.mjs` (Idle-Wert), `scripts/convo-bench/checks.mjs` (neue Konstante `BENCH_MAX_OPENING_CHARS`), 13 outbound-Szenario-Dateien unter `scripts/convo-bench/scenarios/` (Schwelle deklarieren), neue Testdatei `test/al-p5-opening.test.js`, nachgezogene Pins in `test/g2-opening-turn.test.js`, `test/personal-assistant-characterization.test.js`, `test/telnyx-assistant-config.test.js`, sowie `docs/RUNBOOK-TELNYX-ASSISTANT.md` (neuer Abschnitt 10) und `tasks/al-testcall-checklist.md` (drei offene Abnahmezeilen).

Ein Konsument beider Werte über beide Voice-Engines: `openingText(call)` wird sowohl vom Budget-Pfad (`src/routes/voice.js`) als auch vom Assistant-Pfad (`src/telnyx-call-control-ingest.js`) aufgerufen — eine Änderung an der Konstante wirkt automatisch auf beide.

## Implementierung — Zusammenfassung

- **Commit/Head:** `5d52d580` (initiale Umsetzung, ein Commit), finaler Stand nach Fix-Runden auf `phase/al-p5-eroeffnung-fix2` bei `9cc615d`.
- `src/claude.js`: `OPENING_GOAL_MAX_CHARS` 160 → 70 (Fix-Runde 2: → 75, s. u.), mit ausführlichem Begründungskommentar (Rechnung, Wortgrenzen-Argument, Rückdreh-Regel: bei unvollständigem Erst-Turn wird diese Zahl angehoben, nicht `situationOutbound` verändert).
- `scripts/telnyx-assistant-provision.mjs`: `USER_IDLE_REPLY_SECS` 4 → 2, mit Kostenfolgen-Hinweis (jede `[long silence]`-Nachricht = voller Shim-Turn mit `bookTokenUsage`) und Abbruchkriterium (>15 % Turn-Anstieg → zurück auf 4).
- `scripts/convo-bench/checks.mjs`: neue exportierte Konstante `BENCH_MAX_OPENING_CHARS` (initial 224, nach Fix-Runde 2: 229), rechnerisch aus DE-Offenlegung + Bruecke + Kappe hergeleitet.
- 13 outbound-Szenario-Dateien: je Import von `BENCH_MAX_OPENING_CHARS` + Feld `maxOpeningChars`. `stt-noise.mjs` erbt die Schwelle per Spread aus `friseur-voll`; `inbound-nachricht.mjs` bekommt sie bewusst nicht (keine Offenlegung/Bruecke bei Inbound).
- Neue Testdatei `test/al-p5-opening.test.js`: drei Tests —
  - AL-P5-1: gekappte Eröffnung benennt in de/fr/en weiter den Zweck des Anrufs (Fixture-Tabelle mit realen Grenzfall-Zielen).
  - AL-P5-2: laengstmögliche DE-Eröffnung == `BENCH_MAX_OPENING_CHARS` (Gleichheit statt `<=`, damit die Kopplung in beide Richtungen bricht bei Drift).
  - AL-P5-3: jedes outbound-Bench-Szenario deklariert die Schwelle, das inbound-Szenario nicht (Registry-Invariante).
- Nachgezogene Pins (Wert + Kommentar mit Grund/Phase, keine stille Reparatur): `test/g2-opening-turn.test.js`, `test/personal-assistant-characterization.test.js` (`EXPECTED_O5` neu berechnet, `O5_LONG_GOAL` byte-identisch), `test/telnyx-assistant-config.test.js` (`user_idle_reply_secs=2`, `deepEqual`-Form unverändert).
- `docs/RUNBOOK-TELNYX-ASSISTANT.md`: neuer Abschnitt 10 (Idle-Nudge, Abnahme-/Abbruchprozedur, Env-Falle `TELNYX_ASSISTANT_ID`/`TELNYX_ELEVENLABS_MODEL`).
- `tasks/al-testcall-checklist.md`: drei neue offene Zeilen (Eröffnungsfenster aus echten Aufnahmen, Provisioner-Lauf + Turn-Rate-Nachmessung, Bench-Nachweis).
- Verifikation initial: `npm test` grün, 3417/3417 (3414 Basislinie + 3 neue), `node --check` auf allen geänderten/neuen `.js`/`.mjs`-Dateien grün, Smoke gegen echten Server (`PORT=0`, `SKIP_TWILIO_SIGNATURE_CHECK`): gerendertes TwiML-Say mit 170-Zeichen-Testauftrag 221 statt 314 Zeichen, Offenlegung byte-identisch als erster Satz.

### Deviations (Impl-Meldung)

1. Plan §5/7 sprach von „genau 20 Dateien", die dort aufgezählte Liste hatte tatsächlich 22 Einträge — Additionsfehler im Plan, der Commit entspricht der aufgezählten Liste (22 Dateien).
2. Vorgelegter `node_modules`-Symlink im Worktree war eine kaputte Selbstschleife; auf das `node_modules` des Haupt-Repos umgehängt (nicht committet, gitignored), damit die Suite läuft.
3. `npx eslint` lief nicht (`@eslint/js` fehlt in geteilten `node_modules`) — kein Blocker, da das Repo keinen Lint-/Diff-Hook hat; `node --check` deckte alle geänderten Dateien ab.
4. Ein einmaliges, nicht committetes Scratch-Hilfsskript hat die 13 mechanisch identischen Szenario-Edits vorgenommen (mit Eindeutigkeitsprüfung pro Datei, Ergebnis per `git diff` kontrolliert).

## Safety-Urteil (final)

**Verdict: FREIGABE (approved)**, mit 7 Concerns, davon 2 mit Owner-Handlungsbedarf.

- Alle vier absoluten Regeln unberührt (gemessen, nicht behauptet): `git diff` gegen `src/i18n/`, `src/bridge.js`, `src/server.js`, `src/config.js`, `src/telnyx-llm-shim.js`, `src/telnyx-call-control-ingest.js`, `src/auth.js`, `src/web-auth.js`, `src/middleware.js`, `src/telephony/`, `src/billing/`, `render.yaml`, `.env.example` liefert 0 Zeilen. `src/i18n/locales.js` md5-identisch zu master. `disclosureSentence` unverändert (nur die Konstante darunter wechselt).
- Produktions-Delta ist im Kern eine Zahl: `OPENING_GOAL_MAX_CHARS` 160 → 75 (nach Fix-Runden, s. u.) in `src/claude.js`; kappt ausschließlich die TTS-Ausgabe, `TEXT_LIMITS.objective` und der ungekürzte `call.goal` im Systemprompt bleiben unberührt. `USER_IDLE_REPLY_SECS` 4 → 2 ist live wirkungslos bis zum manuellen Provisioner-Lauf.
- Unabhängig nachgemessen in frischem Worktree/Branch (`review-al-p5-r2`, HEAD `9cc615d`, `merge-base` bestätigt kein veralteter Base): JSON-Backend `npm test` 3417/3416 pass, 1 Fail — isoliert nachgefahren 2/2 grün, Datei vom Diff nicht berührt → bekannter Volllast-Spawn-Flake, keine Regression. PG-Backend 129/129. Gates 126/129 pass, 3 bekannte Fails (GAP-05, GAP-15×2) deckungsgleich mit master-Bestand.
- **Concerns:**
  1. Kappe landete bei 75, außerhalb der Plan-Spanne 60–70 — gedeckt durch die Plan-Klausel „reißt der Test, wird die Grenze angehoben"; empirisch nachgerechnet gegen 7 gepinnte Aufträge (60/65/70/71/72/73/74 verlieren je ein zweckt tragendes Wort, erst 75 hält alle).
  2. Abnahmekriterium in `tasks/al-testcall-checklist.md` auf „≤13 s" herabgesetzt statt der im Plan stehenden „≤11 s" — Plan selbst nicht nachgezogen, Widerspruch dokumentiert, transparent begründet, **Owner-Entscheidung nötig**.
  3. Kleine Kommentar-Ungenauigkeit: „129 Zeichen" statt gemessener 130 Zeichen für die DE-Offenlegung (reine Prosa-Korrektur, Konstante selbst korrekt).
  4. Inhärentes, im Plan bereits benanntes Produktrisiko: `situationOutbound`-Prompt sagt dem Modell, Offenlegung/Anliegen seien „bereits wörtlich gesagt" — bei Kappe 75 öfter faktisch ungenau; entschärft dadurch, dass der Systemprompt das ungekürzte `goal` erhält.
  5. `USER_IDLE_REPLY_SECS` 4→2 verdoppelt näherungsweise idle-getriebene Shim-Turns (Kostenfolge); kein Gate aufgeweicht, aber die Checkliste sollte laut Reviewer zusätzlich die Bedingung „Turn-Rate bleibt unter `TELNYX_SHIM_MAX_TURNS_PER_MIN`" tragen — **Owner-Handlungsbedarf/Empfehlung**.
  6. `BENCH_MAX_OPENING_CHARS=229` gilt nur für `language=de` und den fest geseedeten Bench-Owner-Namen; bei Owner-Namensänderung würde die Fehlermeldung in die falsche Richtung zeigen (nur Bench-Risiko, kein Produktionspfad).
  7. Milde Scope-Ausweitung (Bench-Arbeit nicht in der ursprünglichen „Was konkret"-Liste), aber durch AL-P8-Bestandskommentar gedeckt und ohne Produktionspfad-Berührung.

## Clean-Code-Audit (final)

**Verdict: PASS**, kein Blocker.

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (Beobachtung, kein Fix-Bedarf):** 13 Szenario-Dateien wiederholen dieselbe Import-/Feld-Zeile (`BENCH_MAX_OPENING_CHARS` + `maxOpeningChars`) — folgt der bereits etablierten Pro-Datei-Konfigurationskonvention des Bestands; `AL-P5-3` pinnt diese Konsistenz gegen stilles Auseinanderlaufen.
- **S4:** keine.
- Magic Numbers sind durchgängig benannte, hergeleitete Konstanten (`OPENING_GOAL_MAX_CHARS`, `USER_IDLE_REPLY_SECS`, `BENCH_MAX_OPENING_CHARS`); jede Zahländerung ist an mindestens einen Test gekoppelt, der bei Drift rot wird.
- Kommentare dokumentieren offen eine vorherige Fehlentscheidung (Kappe 70 verlor bei einem realen Auftrag das Verb) und deren Korrektur — genau die Nachvollziehbarkeit, die der Katalog für Magic-Number-Konstanten verlangt.
- Bestehende Pins konsistent nachgezogen, nicht still verändert, jeweils mit Kommentar (Grund + Phase).
- Verifikation (Auditor, unabhängig extrahiert per `git archive`): `npm test` 3417/3417 grün; die 4 direkt geänderten/neuen Testdateien einzeln per `node --test` ebenfalls vollständig grün (42 Tests).
- Offene ToDos: keine Blocker; optional/später ein gemeinsamer `scenario-defaults`-Merge zur Reduktion der 13-fachen Wiederholung, für AL-P5 selbst kein Fix-Bedarf.

## Fix-Runden

**r1:** Alle drei gemeldeten Review-Blocker behoben, minimal und mit Regressionstests. Kernkorrektur: der Kommentar über `OPENING_GOAL_MAX_CHARS` in `src/claude.js` behauptete fälschlich, bei Kappe 70 verlören reale Aufträge ihr Verb „nicht" — nachgemessen gegen den eigenen Testauftrag stimmte das nicht; Kappe entsprechend angepasst und Begründung korrigiert.

**r2:** Beide gemeldeten Blocker waren reine Doku-/Prosa-Abweichungen in `tasks/al-testcall-checklist.md`, kein Code verändert. (1) Die Bench-Nachweis-Zeile nannte „≤ 224 Zeichen", tatsächliches Gate ist `BENCH_MAX_OPENING_CHARS=229` — korrigiert mit Verweis auf die Konstante. (2) Weitere Prosa-Korrektur in derselben Datei (Detail laut Fix-Meldung r2 unvollständig übermittelt, betrifft ausschließlich Dokumentationstext, kein Code-/Test-Diff).

Ergebnis nach Fix-Runden: `finalBranch=phase/al-p5-eroeffnung-fix2`, Gate = **PASS**.
