# NEXT-SESSION: Launch-Testlauf 1 (auto + lokal)

> Start-Prompt fuer eine FRISCHE Session:
> "Lies NEXT-SESSION-LAUNCH-TESTRUN.md und fuehre den Auftrag aus."

## Auftrag

Fuehre aus `PLAN-LAUNCH-TESTS.md` (Repo-Root, Stand 2026-07-02) alle Tests der
Typen **auto** und **lokal** aus und protokolliere die Ergebnisse. Tests vom Typ
**live** werden NICHT ausgefuehrt (brauchen Prod/echte Anrufe/echtes Geld/Owner)
— nur als "uebersprungen (live, Owner-Session)" markieren.

Das ist eine reine TEST-Session, keine Fix-Session. Parallel/danach laeuft eine
separate Fix-Kette fuer die bekannten Defekte (OUT-05 Budget-Race, PROV-01
Crash-Recovery, DEPLOY-04/A6). Ein roter Test ist hier ein RESULTAT, das
dokumentiert wird — kein Auftrag, Produktcode zu aendern.

## Pflichtlektuere vor Start

1. `CLAUDE.md` (gilt vollstaendig, inkl. `.claude/refs/workflow.md` —
   `tasks/todo.md` mit erwartetem Ergebnis + Verifikation befuellen)
2. `PLAN-LAUNCH-TESTS.md` — die einzige Quelle, welche Tests laufen
3. `tasks/lessons.md` — besonders die BASE_ENV-Drift-Lehre (lokales `.env`
   leakt in Spawn-Tests, wenn neue Env-Vars nicht in `test/helpers.js`
   neutralisiert sind)

## Harte Regeln (Scope)

- **KEINE Aenderung an Produktcode** (`src/`, `public/`, `apps/`). Erlaubt sind
  NUR: neue/ergaenzte Testdateien unter `test/`, das Protokoll, Checkbox-Updates
  in `PLAN-LAUNCH-TESTS.md`, `tasks/todo.md`.
- **KEINE echten Anrufe, kein echtes Geld, kein Prod**: nichts gegen Render,
  Stripe, Telnyx, Twilio, claude.ai. Auch read-only Render-MCP-Checks gehoeren
  zur Owner-Live-Session, nicht hierher.
- **Fail-safe bei lokalen Server-Smokes**: Der lokale Server laedt `.env` mit
  ECHTEN Keys. Deshalb bei JEDEM lokalen Start die Provider-Keys inline mit
  Dummy-Werten ueberschreiben, damit nie ein echter Provider-Call rausgeht:
  `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true TELNYX_API_KEY=invalid TWILIO_ACCOUNT_SID=ACinvalid TWILIO_AUTH_TOKEN=invalid PROVISIONING_ENABLED=false PAYMENT_ENABLED=false npm start`
  (weitere Overrides je Test laut Plan, z.B. `MAX_BUDGET_EUR=0`).
- `.env` selbst NIE aendern, `data/store.json` NIE anfassen (Tests nutzen
  `PORT=0` + `DATA_DIR`-Temp wie im Bestand).
- **Git**: Alles auf einem neuen Branch `test/launch-run-1` committen (neue
  Testdateien duerfen dort rot sein). `master` unberuehrt. NICHTS pushen
  (weder origin noch upstream).
- Rote Tests: Kurz-Diagnose (max. 3 Saetze, Wurzel-Vermutung) ins Protokoll —
  dann WEITER zum naechsten Test. Ausnahme: Wenn ein Test wegen eines Fehlers
  IM TEST selbst rot ist (nicht im Produkt), den Test fixen.

## Vorgehen (Reihenfolge verbindlich)

### Schritt 0 — Baseline
`npm test` komplett. Erwartung: gruen (Stand master 9f3391a: 1591 Tests).
Wenn die Baseline rot ist: ERST pruefen, ob es BASE_ENV-Drift ist
(`test/helpers.js`), dann dokumentieren. Eine rote Baseline ist ein eigener
Befund und stoppt NICHT den Rest.

### Schritt 1 — auto-Tests mit existierenden Suiten
Alle auto-Zeilen aus dem Plan, deren Schritte auf existierende `test/*.test.js`
zeigen: gebuendelt pro Bereich laufen lassen (`npm test -- test/<datei> ...`),
Ergebnis je Test-ID festhalten. Wenn eine im Plan genannte Testdatei nicht
existiert: als "Datei fehlt" protokollieren und wie Schritt 2 behandeln.

### Schritt 2 — auto-Tests, die erst geschrieben werden muessen
Alle auto-Zeilen, deren Schritte "Neuer Test" / "ergaenzen" / "erweitern"
sagen (u.a. IN-03, IN-08, MCP-06, MCP-07, MCP-08, UI-02, DASH-02,
SMS-02, CFG-03, BILL-04-Erweiterung, OUT-07/10/11-Ergaenzungen,
AUTH-07-auto-Teil): Testdatei schreiben bzw. ergaenzen, dann laufen lassen.
Konventionen des Bestands einhalten (node:test, keine neuen Dependencies,
Server-Spawn mit `PORT=0` + `DATA_DIR`-Temp, `BASE_ENV` aus `test/helpers.js`,
pglite und Server-Spawn NIE in einer Datei mischen).
SMS-02 ist per Design ein Dokumentations-Test des Ist-Verhaltens.

**AUSGENOMMEN — gehoeren der parallelen Fix-Kette (test-first dort, NICHT
hier schreiben):** OUT-05 (`test/outbound-budget-concurrency.test.js`) und
PROV-06 (Doppel-Onboard-Race). Im Protokoll als "an Fix-Kette delegiert"
markieren. Grund: Die Fix-Session schreibt diese Tests als roten Ausgangspunkt
ihres Fixes; doppeltes Schreiben in zwei Sessions erzeugt Merge-Konflikte.
Fuers Schreiben der Testdateien duerfen Subagents genutzt werden (je Datei
einer, tokeneffizient); der Lead haelt den Kontext klein.

### Schritt 3 — lokal-Tests
Die lokal-Zeilen des Plans mit dem fail-safe Serverstart von oben abarbeiten:
OUT-04, OUT-09, IN-07, SMS-01, OBS-01, CFG-02, PROV-01 (NUR Repro +
Zustandsbeschreibung, kein Fix!), DEP-01, DEP-02 (frischer Worktree/Checkout,
nicht der Arbeitsbaum), OUT-12-auto-Teil falls in Schritt 2 nicht erledigt.
Jede curl-Sequenz + beobachtete Antwort ins Protokoll.

### Schritt 4 — live-Tests markieren
Alle live-Zeilen im Protokoll als "uebersprungen (live, Owner-Session)"
listen, damit die Owner-Live-Liste vollstaendig ist.

## Buchfuehrung (Pflicht)

- **Protokoll**: `tasks/launch-test-run-1.md` — pro Test-ID eine Zeile:
  Status (GRUEN / ROT / UEBERSPRUNGEN-live / BLOCKIERT), exaktes Kommando,
  1-Zeilen-Beleg (z.B. "142 pass, 0 fail" oder HTTP-Status + Kernaussage);
  bei ROT zusaetzlich die Kurz-Diagnose.
- **Checkboxen**: In `PLAN-LAUNCH-TESTS.md` `[ ]` -> `[x]` NUR bei GRUEN.
  Rote/uebersprungene bleiben offen (das Dokument bleibt die Master-Checkliste
  fuer den Launch; das Protokoll traegt die Details).

## Abschluss-Report (letzte Nachricht der Session)

1. Zaehler: gruen / rot / uebersprungen(live) / blockiert — je auto und lokal
2. Liste ALLER roten Tests mit 1-Satz-Diagnose, sortiert nach Prio
3. Abgleich mit den drei erwarteten Rot-Faellen: Was war erwartet rot, was ist
   UNERWARTET rot (= neue Befunde fuer die Fix-Kette)?
4. Branch-Name + Commit-SHAs der neuen Testdateien
5. Empfehlung: Was muss die Fix-Kette zusaetzlich uebernehmen, was blockiert
   den Live-Testtag?
