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
| AL-P5 | — | — | — | offen |
| AL-P6 | `phase/al-p6-turn-budget` | PASS (0 Fix-Runden, highStakes, 3385 gruen) | `f16c00a` | **gemergt** |
| AL-P7 | — | — | — | offen (haengt an AL-P2) |
| AL-P7b | — | — | — | offen |
| AL-P8 | `phase/al-p8-bench-fix1` | PASS (1 Fix-Runde, 3412 gruen) | `61d7563` | **gemergt** — 2 Abnahmen (kosten Geld) |
| AL-P9 | — | — | — | offen |
| AL-P10 | — | — | — | offen |
| AL-P10b | — | — | — | offen |
| AL-P11 | — | — | — | offen |
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
  sammelt `node src/server.js`-Prozesse aelter als 10 min ein. Waehrend zweier paralleler
  Workflows blieb Load1 zwischen **4,1 und 8,1 bei 15 Kernen**, Speicher ~50 % frei, **null**
  verwaiste Server. Zwei parallele Workflows sind fuer diese Maschine unkritisch; drei werden
  nicht gestartet.
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
