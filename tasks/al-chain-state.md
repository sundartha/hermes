# AL-Kette — Stand

Gefuehrt vom Lead der Umsetzungs-Session. Eine Zeile je Phase, sobald sie **gemergt** ist.
Quelle der Wahrheit ist `git`, nicht diese Datei — bei Zweifel `git log --oneline` und
`git merge-base --is-ancestor <commit> master`.

**Start der Kette:** 2026-07-28, master `e4a2751`.
**Plan:** `PLAN-ASSISTANT-LEAP.md` · **Steuerung:** `tasks/assistant-leap-chain.md`

## Register

| Phase | Branch (zurueckgegeben) | Gate | Merge-Commit | Stand |
|---|---|---|---|---|
| AL-P1 | `phase/al-p1-latenz-achse` | PASS (0 Fix-Runden, 3350 gruen) | `dd0c0dc` | **gemergt** — 4 Abnahmen in der Checkliste |
| AL-P2 | — | — | — | offen |
| AL-P3 | `phase/al-p3-endpointing` | PASS (0 Fix-Runden, 3374 gruen) | `a4cbdd1` | **gemergt** — 3 Abnahmen in der Checkliste |
| AL-P4 | `phase/al-p4-tool-loop` | PASS (0 Fix-Runden, 3359 gruen) | `1021bc1` | **gemergt** — 2 Abnahmen in der Checkliste |
| AL-P5 | `phase/al-p5-eroeffnung-fix2` | PASS (2 Fix-Runden, highStakes, 3417 gruen) | `e208bc9` | **gemergt** — Abnahme = Testanruf |
| AL-P6 | `phase/al-p6-turn-budget` | PASS (0 Fix-Runden, highStakes, 3385 gruen) | `f16c00a` | **gemergt** |
| AL-P7 | — | — | — | offen (haengt an AL-P2) |
| AL-P7b | — | — | — | offen |
| AL-P8 | `phase/al-p8-bench-fix1` | PASS (1 Fix-Runde, 3412 gruen) | `61d7563` | **gemergt** — 2 Abnahmen (kosten Geld) |
| AL-P9 | `phase/al-p9-briefing-impl` (NICHT der gemeldete) | PASS (0 Fix-Runden, 3426 gruen) | `479721e` | **gemergt** — Flag bleibt AUS |
| AL-P10 | `phase/al-p10-precall-research-fix1` | PASS (1 Fix-Runde, 3462 gruen) | `21a1f9c` | **gemergt** — Flag bleibt AUS |
| AL-P10b | — | — | — | offen |
| AL-P11 | `phase/al-p11-ergebnis-karte` | PASS (0 Fix-Runden, 3457 gruen) | `dd0cc26` | **gemergt** — Zitate erst nach Datenschutzerklaerung |
| AL-P12 | — | — | — | offen |
| AL-P13 | — | — | — | offen |
| AL-P14 | — | — | — | offen |
| AL-P15 | — | — | — | offen |

## Verlauf

### 2026-07-28 — Session-Start

- master `e4a2751`, sauber. Seit `da17c4e` **keine fremden Commits** — die zurueckgestellte
  Kette `PLAN-AUTH-GATE` laeuft **nicht** parallel. AL hat Vorrang (Owner-Entscheidung).
- **Befund vor der ersten Phase:** `phase-impl-lean.js` kennt **kein** Argument fuer einen
  Zusatz-Prompt. Die in Abschnitt 6 der Kette geforderten Zusaetze (Regel 0, O1-O9-Vorrang,
  Flag-aus, Checklisten-Pflicht) waeren im Phasen-Prompt nie angekommen. Ausserdem enthielt die
  `specFile` **keine** Phasen-Abschnitte, und die IDs weichen ab (`AL-P1` hier gegen `Phase 1`
  im Plan-Doc) — der Plan-Agent haette den Abschnitt nicht gefunden.
  **Behoben:** Abschnitt 9 „Phasen-Spezifikationen" in `tasks/assistant-leap-chain.md`
  (Namensbruecke + Betriebsregeln je Phase).
- **AL-P2-Vorbedingung geklaert** (read-only `psql`, RLS pro Tenant gesetzt): `+17067101188` ist
  die live genutzte DID (letzter Outbound 2026-07-27). **Korrektur an der Annahme in
  `al-owner-notes.md` §4:** es gibt keine herrenlose Ersatz-DID — alle drei stehen auf
  `status=active` und jede ist die einzige Nummer eines eigenen Tenants. Zurueckhaengen ist
  deshalb Teil von AL-P2, nicht Nacharbeit. Details im AL-P2-Abschnitt der Kette.
- **Welle 0: AL-P1 gemergt** (`dd0c0dc`). Gate PASS ohne Fix-Runde.
- **Welle 1: AL-P4 (`1021bc1`) und AL-P3 (`a4cbdd1`) gemergt.** Beide PASS ohne Fix-Runde.
  Konflikt beim zweiten Merge nur in `tasks/al-testcall-checklist.md` (beide Bahnen haben Zeilen
  angehaengt) — beide Saetze behalten.
  AL-P3 hat die im Plan geforderte Vorpruefung per Objekt-GET am Live-Assistant erledigt und den
  spekulativen Absatz im Plan-Doc durch den Messwert ersetzt: `start_speaking_plan` haengt unter
  `interruption_settings`, **nicht** unter `transcription`. Der befuerchtete Guard-Wechsel
  entfaellt. Die Entscheidungen O1-O9 blieben unberuehrt (nachgeprueft).
- **Lastwaechter** laeuft seit Welle 1 (`scratchpad/al-load-guard.sh`): misst jede Minute und
  sammelt `node src/server.js`-Prozesse aelter als 10 min ein.
  **NACHTRAEGLICH KORRIGIERT (s. Welle 3):** die erste Fassung zaehlte die Prozesse mit
  `pgrep`. `pgrep` sieht in dieser Sandbox **keine fremden Prozesse** und lieferte stur `0`.
  Die damals notierte Entwarnung („null verwaiste Server, node=0") war deshalb **keine
  Messung, sondern ein blinder Zaehler**. Der Load-Wert selbst stimmte.
- **Flake nach dem Welle-1-Merge, ehrlich festgehalten:** der erste Volllauf auf dem gemergten
  master meldete **1 Fehlschlag von 3364**. Die Identitaet des Tests wurde nicht mitgeschnitten
  (Ausgabe lief durch `tail`). Die beiden folgenden Volllaeufe auf demselben Baum waren
  **grün (3364/3364)**. Das entspricht dem dokumentierten, vorbestehenden Spawn-Race unter
  Volllast; nach dem Gate-Protokoll gilt rot nur, wenn es isoliert rot bleibt. Sollte in einer
  spaeteren Welle erneut genau ein Test kippen: **Ausgabe mitschneiden und den Namen
  festhalten**, statt wieder nur die Zusammenfassung zu lesen.
- **Welle 2: AL-P6 (`f16c00a`) und AL-P8 (`61d7563`) gemergt.** Verifikationslauf auf dem
  gemergten master: **3414/3414 gruen**, diesmal mit vollem Mitschnitt (`exit=0`, keine
  `not ok`-Zeile). Kein Merge-Konflikt.
  - AL-P6 legt **keine** neue Env-Variable an (nachgeprueft: kein neues `numEnv`/`boolEnv` in
    `src/config.js`, die `process.env`-Zuweisungen im Diff stehen alle im Test-Setup). Damit
    keine BASE_ENV-Drift.
  - AL-P8 brauchte **eine** Fix-Runde; der zurueckgegebene `finalBranch` hiess deshalb
    `phase/al-p8-bench-fix1` — gemergt wurde dieser, nicht der geplante Branch.
  - Beide AL-P8-Abnahmen **kosten echtes Geld** (Bench-Laeufe gegen die echte Anthropic-API)
    und gehoeren damit dem Owner.
- **Lastregel nachgeschaerft:** Spitze ueber die Kette war Load1 = **21,9** bei 15 Kernen — das
  entstand, als der Lead waehrend laufender Workflows selbst die Suite fuhr. Seither gilt:
  eigene Verifikationslaeufe **nur zwischen den Wellen**, nie parallel zu einem Workflow.

### 2026-07-29 — Welle 3 und die Lastbremse

- **UEBERLAST, gemessen und behoben.** Waehrend AL-P5 und AL-P9 parallel liefen, stieg Load1 auf
  **32,4 bei 15 Kernen** (anhaltend ueber Minuten, Swap zu 94 % belegt). Ursache war **nicht**,
  was der Waechter vermutete: es lagen **null** verwaiste Testserver herum. Der Treiber waren die
  Suiten selbst — **39 node-Prozesse, davon 35 `node --test`**, weil in zwei Workflows jeweils
  Impl- und Safety-Agent gleichzeitig `npm test` fahren und `node --test` intern noch einmal
  auffaechert.
- **Wurzel der Fehlmessung:** der Waechter zaehlte mit `pgrep` (`pgrep -c node` -> 0, waehrend
  `ps -Ao comm | grep -c bin/node` -> 39). In dieser Sandbox sieht `pgrep` keine fremden
  Prozesse. **Lehre: in diesem Repo NIE mit `pgrep` messen, immer mit `ps`.** Der Waechter ist
  umgestellt und zaehlt `node --test` jetzt getrennt aus.
- **Eingriff:** AL-P9 per `TaskStop` angehalten, AL-P5 allein weiterlaufen lassen. Load fiel
  binnen zwei Minuten von 32,4 auf 12,5, danach auf 3,8.
- **Neue Betriebsregel, ersetzt „maximal zwei Workflows":** **eine Bahn zur Zeit.** Die Kette
  laeuft dadurch spuerbar laenger; das ist der Preis dafuer, dass der Arbeitsrechner benutzbar
  bleibt (ausdrueckliche Owner-Weisung).
- **Swap-Alarm wieder entfernt:** macOS holt ausgelagerte Seiten nicht zurueck, der Wert bleibt
  nach einer Spitze dauerhaft niedrig und feuerte im Minutentakt ohne Aussage. Der Wert wird
  weiter protokolliert; entschieden wird ueber Load und freien Speicher.
- **AL-P5 gemergt (`e208bc9`), PASS nach 2 Fix-Runden**, Verifikationslauf **3417/3417 gruen**.
  Regel 2 selbst nachgeprueft: der Offenlegungssatz ist unveraendert, gekuerzt wurde
  ausschliesslich die Anliegen-Zusammenfassung dahinter (`OPENING_GOAL_MAX_CHARS` 160 -> 75).
  Ein neuer Test pinnt, dass die Offenlegung der erste Satz bleibt.
  Die Fix-Runden haben eine **empirisch falsche Begruendung** im Kommentar korrigiert: die
  urspruengliche Kappe 70 haette dem gepinnten Testauftrag das Verb genommen — 75 ist die
  kleinste Kappe, die alle Grenzfaelle traegt.
- **AL-P9 wird neu gestartet, nicht per `resume` fortgesetzt** (Kickoff-Vorgabe „kein resume").
  Nebeneffekt: der Plan-Agent gruendet auf dem aktuellen master statt auf dem Stand vor AL-P5.

- **AL-P9 gemergt (`479721e`), PASS ohne Fix-Runde, 3426/3426 gruen** —
  aber nur, weil die Merge-Pruefung den **falschen** zurueckgegebenen Branch abgefangen hat:

  > **NEUER FALLSTRICK: ein abgebrochener Lauf hinterlaesst seinen Branch, und der naechste
  > Lauf weicht still auf einen anderen Namen aus.**
  >
  > Der per `TaskStop` abgebrochene erste AL-P9-Lauf hatte `phase/al-p9-briefing` bereits
  > angelegt (`4d3e02c`, Basis `11ccd39` = master **vor** AL-P5, halbfertiger
  > „Vorbereitung"-Commit). Im zweiten Lauf schlug `git checkout -b phase/al-p9-briefing
  > master` deshalb fehl; der Impl-Agent wich auf **`phase/al-p9-briefing-impl`** aus
  > (`6249608`, korrekt auf aktuellem master). Der Workflow meldete trotzdem
  > `finalBranch: phase/al-p9-briefing` — den **stale Torso**, weil das Template
  > `finalBranch` aus dem GEPLANTEN Namen ableitet, nicht aus dem, was der Agent wirklich
  > gebaut hat.
  >
  > Ein blinder Merge haette die halbfertige Arbeit des abgebrochenen Laufs auf master
  > gebracht **und die echte Umsetzung verloren** — lautlos, mit gruenem Gate.
  >
  > **Zwei Konsequenzen, ab sofort verbindlich:**
  > 1. `git merge-base --is-ancestor master <finalBranch>` ist **kein Formalismus**. Genau
  >    diese Pruefung hat den Fehler gefangen.
  > 2. **Vor dem Neustart einer abgebrochenen Phase deren Branch loeschen**
  >    (`git branch -D <branch>` + `git worktree remove`), sonst weicht der naechste Lauf
  >    wieder aus. Erledigt: Torso und sein Review-Branch sind entfernt.

- **AL-P9 legt keine neue Env-Variable an** — `.env.example` bekommt nur einen erklaerenden
  Kommentar. Keine Vier-Stellen-Pflicht, keine BASE_ENV-Drift.

- **AL-P10 gemergt**, PASS nach 1 Fix-Runde, Verifikationslauf **3442/3442 gruen**.
  **Spec-Fehler des Leads, hier korrigiert:** Abschnitt 9 dieser Kette schrieb AL-P10 den
  Brave-Adapter samt `BRAVE_SEARCH_API_KEY` zu. Falsch — A3 des Plans trennt sauber:
  **pre-call (AL-P10) = Anthropics serverseitiges `web_search`** im `llm.js`-Seam, ohne Key und
  ohne zweiten Auftragsverarbeiter; **in-call (AL-P10b) = eigener Brave-Adapter**. Der
  Clean-Code-Review hat den in AL-P10 angelegten Brave-Secret-Slot zu Recht als Scope-Drift
  blockiert. Der Spec-Abschnitt ist berichtigt, damit AL-P10b nicht auf der falschen Annahme
  aufsetzt.
  Vier-Stellen-Pflicht fuer die neuen Variablen `RESEARCH_ENABLED` und
  `RESEARCH_SEARCH_FEE_CENTS` vollstaendig erfuellt (`config.js`, `.env.example`, `render.yaml`,
  `BASE_ENV` in `test/helpers.js`) — nachgeprueft, keine Drift.

- **AL-P11 gemergt**, PASS ohne Fix-Runde, Verifikationslauf **3457/3457 gruen**.
  O5 selbst nachgeprueft (nicht dem Gate ueberlassen, weil es um PII-Haltung geht):
  hoechstens **2** woertliche Zitate (`RESULT_EVIDENCE_MAX_ITEMS`, in DE/FR/EN im Prompt UND
  serverseitig durchgesetzt; der Test speist absichtlich 4 ein); **eigene** Frist
  `EVIDENCE_RETENTION_DAYS` statt Umwidmung von `RETENTION_DAYS`/`DIAGNOSTIC_RETENTION_DAYS`;
  **Default 0** — keine laengere PII-Haltung als heute, Freischaltung erst wenn die
  Datenschutzerklaerung Zitate und Frist nennt.
