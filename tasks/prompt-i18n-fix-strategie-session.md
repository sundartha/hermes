# Prompt fuer die naechste Session — Lauf-Trennung, Klassifikation, Fix-Strategie

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Drei Aufgaben, in dieser Reihenfolge. **Du bleibst duenn und delegierst alles** — du liest
selbst KEINEN Produktionscode und keine Testdateien im Volltext. Deine Arbeit ist:
Auftraege schneiden, Ergebnisse pruefen, mergen, berichten. Alles andere machen Subagenten
bzw. Workflows und liefern strukturierte Rueckgaben.

**Du setzt in dieser Session KEINEN der 85 Befunde um.** Fixen ist die uebernaechste Session.
Wer hier Produktionscode anfasst (ausser fuer Aufgabe 1), hat den Auftrag verfehlt.

## Ausgangslage (selbst pruefen, nicht glauben)

`master` sollte auf `e3c2cba` stehen, Arbeitsbaum sauber. **Pruef den echten Git-Stand
selbst** (`git log --oneline -5`, `git status --short`) — in diesem Repo sind schon Sessions
auf einem angenommenen Stand losgelaufen und haben leere Branches gemergt.

Suite: **3044 Tests, 2959 gruen, 85 rot**. Die 85 roten sind ALLE gewollte Befunde des
i18n-Launch-Testkatalogs, kein Bestandsbruch — jeder traegt eine Katalog-ID im Testnamen
(GAP-*, WORLD-*, ORIG-*, MCP-*, UI-*, E2E-*, PROMPT-*, WEB-*, DID-*, FMT-*, OUT-*, LANG-*).

Lies zuerst, in dieser Reihenfolge:
- `tasks/i18n-tests/15-w1-bericht.md` — was gebaut wurde, vier Zwischenfaelle, offene Punkte
- `tasks/i18n-tests/14-gap33-bericht.md` — GAP-33 und die Live-Env-Frage
- `tasks/i18n-tests/00-kanonische-liste.md` — Regeln R1-R5, Nachtrag vom 2026-07-25
- `PLAN-I18N-TESTS.md` Abschnitt 7.0 + 7.12 — die Owner-Entscheidungen

Merksatz aus dem Katalog: **rot = Launch-Gate, nicht Regression.** Ein roter Test wird nach
seinem Fix gruen und ist ab da Regressionsschutz. Kein roter Test wird "grün gemacht", indem
seine Erwartung gesenkt wird.

---

## Aufgabe 1 — Lauf-Trennung (klein, zuerst, blockiert alles andere)

Solange 85 Tests rot sind, ist `npm test` als Signal wertlos: niemand sieht mehr, ob ein
neuer Commit etwas kaputt gemacht hat. Das muss weg, bevor irgendjemand mit dem Fixen
anfaengt.

Ziel:
- `npm test` → nur Regressionsschutz. **Muss gruen sein.** Rot heisst: etwas ist kaputt.
- `npm run test:gates` → die Launch-Gate-Tests des Katalogs. Duerfen rot sein; die Zahl
  sinkt mit jedem Fix Richtung null.

Vorgaben:
- Der Mechanismus ist frei zu waehlen (Verzeichnis, Namenskonvention, Test-Runner-Filter) —
  **aber er muss automatisch greifen**, nicht ueber eine handgepflegte Dateiliste (G27:
  Struktur statt Konvention; eine Liste veraltet beim ersten neuen Test).
- **Kein Test darf verschwinden.** Vorher/nachher gilt: `test:gates` + `npm test` zusammen
  ergeben wieder 3044 Tests. Das ist die Abnahmebedingung, und du pruefst sie selbst.
- `package.json` und Testinfrastruktur duerfen geaendert werden — Produktionscode unter
  `src/` NICHT.
- Der bekannte Voll-Last-Flake `test/p5-gate-proof.test.js` (~12 %, Seed-vor-Boot-Race)
  bleibt im Regressionslauf. Rot gilt nur als echt, wenn die Datei ISOLIERT rot ist.
- `.claude/refs/clean-code.md` lesen und befolgen; CI/Doku (`README.md`, `CLAUDE.md`
  Abschnitt "Befehle") nachziehen, damit der zweite Lauf auffindbar ist.

## Aufgabe 2 — Klassifikation der 85 Befunde

Ein Workflow, ~4-6 Agenten. Ergebnis ist eine Tabelle, kein Fliesstext, abgelegt unter
`tasks/i18n-tests/16-befund-klassifikation.md`.

Je Befund (Katalog-ID + Testname):

| Feld | Werte |
| --- | --- |
| `art` | `env-flip` (kein Code) · `einzeiler` · `umbau` · `produktentscheidung` · `test-falsch` |
| `aufwand` | grobe Klasse, z.B. `<1h` / `halber Tag` / `mehrere Tage` |
| `risiko` | was kaputtgehen kann, wenn der Fix schiefgeht — Geld, Anrufe, Bestandskunden |
| `beruehrt` | die Produktionsdateien, die der Fix anfassen wuerde |
| `abhaengt_von` | andere Befund-IDs, die zuerst dran muessen |
| `brennt_heute` | `ja`/`nein` — trifft es den BESTAND jetzt, oder erst beim Weltstart? |

Drei Dinge, die dabei ausdruecklich mit herauskommen muessen:

1. **Die `brennt_heute`-Liste.** Manche Befunde sind kein Launch-Thema, sondern ein akutes
   Produktproblem. Bekannt sind mindestens: das plattformweite Stundenlimit von 6 Anrufen
   (GAP-10 — bei mehreren Kunden teilen die sich sechs Anrufe pro Stunde), die ignorierten
   Stripe-Dispute-/Refund-Ereignisse (GAP-03), und dass `render.yaml` nicht startfaehig ist
   (GAP-38/GAP-33-Befund — das ist der Wiederherstellungs-Pfad des Dienstes). Pruef, ob es
   weitere gibt.
2. **Migrationsrisiken.** Mindestens einer der scheinbaren Einzeiler ist keiner:
   `DEFAULT_LANGUAGE` von `de` auf `en` (WORLD-01/03) **aendert das Verhalten fuer
   Bestandskunden** — jeder Tenant ohne gesetztes Land bekommt ab dem Deploy einen englischen
   Agenten, auch die deutschen. Solche Faelle gehoeren markiert, samt der Frage, die der
   Owner davor entscheiden muss. Such gezielt nach weiteren.
3. **`test-falsch`-Kandidaten.** Nicht jeder rote Test bedeutet, dass Code zu aendern ist.
   Konkret zu pruefen: **GAP-07** verlangt einen Boot-Refusal bei leerem
   `PLATFORM_ALERT_SMS_TO` — der Kanal ist laut Boot-Log seit dem 2026-07-25 aber besetzt
   (die Warnung steht in jedem Boot bis 07-23T23:23Z und fehlt seither). Moeglicherweise ist
   dort nichts zu fixen, sondern der Test nachzuziehen. In Welle W1 sind bereits drei
   Polaritaeten der Quelle als falsch nachgewiesen worden (PAY-04, ORIG-05, MCP-05).

## Aufgabe 3 — Strategie-Dokument

Erst wenn Aufgabe 2 vorliegt. Ergebnis: `PLAN-I18N-FIX.md`. **Ein Plan, keine Umsetzung.**

Vollprogramm, weil das Dokument die naechsten Sessions steuert: mehrere unabhaengige
Entwuerfe fuer den Phasenschnitt, Bewertung durch unabhaengige Judges, Synthese aus dem
Sieger. Dazu zwingend ein **Safety-Review auf Opus** — die Fixes fassen Budget-Gates,
Land-Gate, Offenlegung und Stripe an, also genau die Stellen, an denen dieses Repo echtes
Geld ausgibt und echte Menschen anruft.

Der Plan muss enthalten:
- **Phasenschnitt** mit Reihenfolge und Begruendung. Leitlinie: was heute schon brennt und
  was Geld/Sicherheit betrifft, kommt vor dem, was nur beim Weltstart sichtbar wird.
- **Pre-Mortem je Phase** (CLAUDE.md verlangt das): ein Jahr in der Zukunft, die Entscheidung
  war falsch — was ist passiert? Konkret hier: ungewollte Anrufe, explodierende Kosten,
  geleakte Transkripte, ein Bestandskunde, der ploetzlich Englisch spricht.
- **Offene Produktentscheidungen** als Liste mit Empfehlung — sauber getrennt von dem, was
  ohne Rueckfrage umsetzbar ist. Eine Entscheidungsfrage ist KEIN Implementierungsauftrag
  (das ist in diesem Projekt schon einmal schiefgegangen).
- **Je Phase das Abnahmekriterium**, ausgedrueckt in den Katalog-IDs, die dabei von rot auf
  gruen wechseln — plus die Charakterisierungstests, die dabei nach Regel R5 zu LOESCHEN
  sind (nicht anzupassen). Betroffen sind u.a. `test/f1-geo-port.test.js:61` und
  `test/personal-assistant-characterization.test.js:215-221`.
- **Was ausdruecklich NICHT Teil ist.** Zurueckgestellt und bewusst offen: GAP-02 (Steuer),
  LAW-06/GAP-12/GAP-13 (Consent/TCPA/DNC), LAW-07 (Anrufzeitfenster). Diese Risiken sind
  getragen, nicht geloest — der Plan darf nicht so lesen, als seien sie erledigt.

---

## Arbeitsweise (bindend)

**Delegiere alles, halte deinen Kontext frei.** Aufgabe 1 als einzelner Subagent oder kleiner
Workflow, Aufgabe 2 und 3 als Workflow. Lass dir strukturierte Ergebnisse zurueckgeben
(`schema`), keine Fliesstextberichte. Du liest die Ergebnisse, nicht die Dateien.

**Modell-Politik:** Subagenten NIE auf einem geerbten Fable laufen lassen. Opus fuer Plan-
und Safety-Review, Sonnet fuer Recherche/Klassifikation/Umsetzung/Report — pro `agent()`
explizit pinnen.

**Fuenf Fallen, alle in diesem Repo schon zugeschnappt:**

1. **Worktrees stehen nicht zuverlaessig auf `master`.** In der letzten Session standen zwei
   von drei auf einem Commit, in dem die Plandateien noch gar nicht existierten. Jeder
   worktree-isolierte Agent bekommt als erste Anweisung: Basis pruefen
   (`git log --oneline -1 master` gegen `HEAD`), notfalls `git checkout -b <branch> master`,
   und ABBRECHEN, wenn die erwarteten Dateien fehlen. Du selbst pruefst vor jedem Merge
   `git merge-base master <branch>` gegen `git rev-parse master`.
2. **Workflow-PASS ist keine Merge-Freigabe.** Vor JEDEM Merge selbst
   `git diff master...<branch> --stat` und die Pfadliste ansehen. Es gab schon einen PASS auf
   einem leeren Branch.
3. **Suite-Zahlen aus Agentenreports sind Hinweise, keine Belege.** In der letzten Session
   meldete ein Block "73 Tests" als volle Suite (echt: ~3000). Nach dem Merge selbst
   `npm test` fahren.
4. **Kein `git stash`, solange worktree-isolierte Workflows laufen** — `refs/stash` ist
   zwischen Worktrees geteilt und wird geklobbert.
5. **Niemals `git add -A`** in diesem Repo. Immer die Pfade einzeln adden.

**Abschluss:** kurzer Bericht an mich mit (a) Ergebnis je Aufgabe, (b) den `brennt_heute`-
Faellen, (c) den Produktentscheidungen, die ich treffen muss, bevor das Fixen losgeht. Keine
Datei-Dumps.
