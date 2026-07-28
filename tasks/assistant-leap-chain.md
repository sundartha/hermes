# AL-Kette — Umsetzung von PLAN-ASSISTANT-LEAP.md

Uebergabe an die naechste Session, geschrieben 2026-07-28. **Der Owner ist waehrend des Laufs
nicht erreichbar.** Alles, was hier nicht steht, ist bereits entschieden und steht in
`PLAN-ASSISTANT-LEAP.md` — Abschnitt "Entscheidungen O1-O9" ist bindend, der Abschnitt
"Herleitung der offenen Fragen" darunter ist historisch und gilt NICHT.

Diese Datei ist der `specFile` fuer `phase-impl-lean`. `planDoc` ist immer
`PLAN-ASSISTANT-LEAP.md`.

---

## 0. Was der Lead NICHT tut

- **Kein Code lesen.** Der Lead startet Workflows, merged zurueckgegebene Branches, fuehrt
  Buch. Details stehen in `tasks/al-p<N>-report.md`, die liest der Lead nicht.
- **Nicht deployen.** Der Gateway (`srv-d8m0fhflk1mc73bno570`) hat `autoDeploy: no/off`.
  Render deployt vom UPSTREAM `jonas986` — `git push origin` macht nichts live. **Es wird
  weder nach upstream gepusht noch ein Deploy ausgeloest.** Der Owner entscheidet, wann etwas
  live geht.
- **Keine geldrelevanten Flags anschalten.** Siehe Abschnitt 2.

## 1. Ausgangslage (gemessen, nicht angenommen)

- master `76f386c`, sauber. Live deployter Commit ist derselbe (Boot-Banner 2026-07-28T16:50Z).
- **`VOICE_ENGINE=budget` UND Telnyx-Assistant-Pfad AKTIV.** Belegt: Boot-Banner
  `Voice-Engine:   budget` plus `[telnyx-shim] turn_ok`-Zeilen in den Render-Logs. Ein
  fehlender `speech_result`-Treffer ist KEIN Gegenbeweis (haengt an `METRICS_ENABLED`).
- `agentTurn`-Latenz auf diesem Deploy: 10 Turns, **Median 1339 ms, Mittel 1753 ms, max 5112 ms**.
- `PLAN-ASSISTANT-LEAP.md` ist **untracked** — als Erstes committen (nur diese Datei und
  `tasks/assistant-leap-chain.md`, **nie** `git add -A`).

## 2. Owner-Entscheidungen fuer diesen Lauf

| Frage | Entscheidung |
|---|---|
| Such-Anbieter (Phase 10b) | **Brave Search** (`BRAVE_SEARCH_API_KEY`) — korrigiert am 28.07.: der Owner hat seinen frueheren Recherche-Agenten mit Brave betrieben, nicht mit Exa. Betriebserfahrung schlaegt Benchmark-Tabelle; Exa bleibt Ausweichkandidat hinter demselben Port. **Der Key wird zum BAUEN nicht gebraucht** — Adapter gegen Fixtures; leerer, dokumentierter Platzhalter in `.env.example` und `render.yaml`, ohne Key fail-closed inaktiv. |
| Render-Env-Vars aendern | **Erlaubt, mit Protokoll** — jede Aenderung mit Zeitstempel, Variable, Alt-/Neuwert und Phase in `tasks/al-env-changes.md`. |
| ABER: geldrelevante Flags | **Bleiben AUS.** `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`: ihr Anschalten IST die Abnahme, und die hat der Owner auf "offen protokollieren" gesetzt. Erlaubt sind nur neue Variablen mit Default-aus und inerte Werte. |
| Phasen mit Testanruf-Abnahme | **Code bauen, Flag AUS lassen, Abnahme offen protokollieren** in `tasks/al-testcall-checklist.md`. Nicht zurueckstellen. |

## 3. Betriebsregeln (aus frueheren Ketten teuer gelernt)

1. **Regel 0 in JEDEN Phasen-Prompt:** der Worktree MUSS auf dem aktuellen `master` stehen.
   `isolation: "worktree"` legt ihn NICHT zuverlaessig dort an. Vor dem Merge im Lead
   `git merge-base --is-ancestor master <branch>` pruefen.
2. **PASS ist keine Merge-Freigabe.** Vor JEDEM Merge `git diff --stat master..<finalBranch>`.
   Ein toter Impl-Agent liefert einen leeren Branch trotz PASS.
3. **Gemerged wird der ZURUECKGEGEBENE `finalBranch`** (kann `<branch>-fixN` sein), nicht blind
   `<branch>`.
4. **NIE `git stash`**, solange ein `isolation:worktree`-Workflow laeuft — `refs/stash` ist
   worktree-geteilt.
5. **Nicht mergen, waehrend eine Welle laeuft.** Erst wenn beide Bahnen der Welle stehen.
   Sonst falsch-positive Stale-Base-Blocker.
6. **NIE `git add -A`** — dieses Repo hat untrackte Dateien, die nicht in die History gehoeren.
7. **Nach jeder Welle verwaiste Testserver killen:**
   `pkill -f "node src/server.js"` (braucht `dangerouslyDisableSandbox`). Spawn-Tests lassen
   Kinder zurueck; 99 davon waren einmal 9,4 GB.
8. **`npm test` MUSS gruen sein.** `npm run test:gates` darf rot sein. Ein Regressionstest
   darf **nie** eine Katalog-ID (`GAP-`, `PROMPT-`, …) am Namensanfang tragen — er landet sonst
   still im Gates-Lauf und meldet nie.
9. **Neue Env-Var:** `src/config.js` + `.env.example` + `render.yaml` + **`BASE_ENV` in
   `test/helpers.js`** (sonst leakt die lokale `.env` in Spawn-Tests).
10. **Modell-Pins:** Subagenten nie erben lassen. Opus fuer Plan + Safety-Review, Sonnet fuer
    Impl/Audit/Fix/Report.

## 4. Bahnen — was parallel darf und was nicht

`src/claude.js` ist der Hub. Alles, was ihn anfasst, laeuft **strikt sequenziell**. Daneben
laeuft eine zweite Bahn, die ihn nicht beruehrt. **Maximal zwei Lean-Workflows gleichzeitig** —
mehr bringt nichts, weil jeder intern schon parallelisiert, und kostet nur Arbeitsspeicher.

```
Welle 0 (allein):          AL-P1
                            |
        +-------------------+-------------------+
        |                                       |
   BAHN A (src/claude.js, sequenziell)     BAHN B (kein claude.js)
   AL-P4  -> AL-P6 -> AL-P5                AL-P3 -> AL-P8 -> AL-P9 -> AL-P10
        |                                       -> AL-P11 -> AL-P12 -> AL-P13
        v
   [ WARTET AUF OWNER: AL-P2 ]
        |
   AL-P7 -> AL-P7b -> AL-P10b -> AL-P14 -> AL-P15
```

**AL-P2 ist der Engpass** und kann nicht autonom laufen: sie braucht einen von Hand angelegten
Wegwerf-Assistant und zwei echte Testanrufe. Ihr Ergebnis (gruen/rot) entscheidet, ob AL-P7
ueberhaupt gebaut wird und ob AL-P7b Weg A oder Weg B nimmt. **Solange sie offen ist, endet
Bahn A nach AL-P5.** Bahn B laeuft unabhaengig weiter.

## 5. Phasen-Register

Spalte "autonom": ob die Phase ohne den Owner vollstaendig abnehmbar ist.

| ID | Titel | Branch | Bahn | Blockiert durch | Autonom |
|---|---|---|---|---|---|
| AL-P1 | Latenz-Achse und Abbruch-Achse schliessen | `phase/al-p1-latenz-achse` | 0 | — | ja |
| AL-P2 | SSE-Spike: konsumiert Telnyx inkrementell? | `phase/al-p2-sse-spike` | A | Owner-Freigabe fuer eine Wegwerf-Connection | **evtl. ja** — s. `al-owner-notes.md` §4: der Spike braucht keinen Menschen, wenn Hermes eine eigene Ersatz-DID anruft, die abnimmt und schweigt |
| AL-P3 | Endpointing konfigurieren | `phase/al-p3-endpointing` | B | — | Code ja, Wirkung nur live |
| AL-P4 | Seiteneffekt-Werkzeuge brechen den Tool-Loop | `phase/al-p4-tool-loop` | A | AL-P1 | ja |
| AL-P5 | Die Eroeffnung kuerzen | `phase/al-p5-eroeffnung` | A | AL-P4 | Code ja, **Abnahme = Testanruf** |
| AL-P6 | Turn-Deadline und Budget-Pruefung pro Runde | `phase/al-p6-turn-budget` | A | AL-P4 | ja |
| AL-P7 | Echtes Token-Streaming und Satz-Chunking | `phase/al-p7-streaming` | A | **AL-P2 gruen** | nein |
| AL-P7b | Denk-Signal | `phase/al-p7b-denk-signal` | A | AL-P7 | Code ja, **Abnahme = Testanruf** |
| AL-P8 | Der Bench misst den Pfad, der live ist | `phase/al-p8-bench` | B | — | ja |
| AL-P9 | Vorab-Briefing anschalten und verbreitern | `phase/al-p9-briefing` | B | AL-P8 | Code ja, **Flag bleibt AUS** |
| AL-P10 | Recherche vor dem Waehlen | `phase/al-p10-precall-research` | B | AL-P9 | Code ja, **Flag bleibt AUS** |
| AL-P10b | `look_up`: Recherche IM Gespraech | `phase/al-p10b-lookup` | A | AL-P7b + AL-P10 | Code ja, **Abnahme = Testanruf + Key** |
| AL-P11 | Ergebnis-Karte statt Prosa | `phase/al-p11-ergebnis-karte` | B | AL-P8 | ja |
| AL-P12 | Beziehungsgedaechtnis | `phase/al-p12-gedaechtnis` | B | AL-P11 | ja |
| AL-P13 | Consult-Kanal am Call, MCP-Schleife | `phase/al-p13-consult-kanal` | B | AL-P12 | ja |
| AL-P14 | `get_consult` im Gespraech | `phase/al-p14-get-consult` | A | AL-P13 + AL-P10b | Code ja, **Abnahme = Testanruf** |
| AL-P15 | Zustellung deterministisch machen | `phase/al-p15-zustellung` | A | AL-P14 | nein (Messphase) |

## 6. Aufruf-Muster

Pro Phase genau ein Lauf. `phaseId` und `branch` IMMER hart im Aufruf setzen (args-Misfires
haben schon Phasen gebaut, die niemand wollte):

```
Workflow({
  scriptPath: ".claude/workflows/phase-impl-lean.js",
  args: {
    phaseId: "AL-P4",
    phaseTitle: "Seiteneffekt-Werkzeuge brechen den Tool-Loop",
    branch: "phase/al-p4-tool-loop",
    baseBranch: "master",
    planDoc: "PLAN-ASSISTANT-LEAP.md",
    specFile: "tasks/assistant-leap-chain.md",
    maxFixRounds: 2
  }
})
```

Der Phasen-Prompt bekommt zusaetzlich:
- **Regel 0** (Worktree auf aktuellem master, s. o.),
- den Hinweis, dass der Abschnitt "Entscheidungen O1-O9" in `PLAN-ASSISTANT-LEAP.md` bindend
  ist und "Herleitung der offenen Fragen" historisch,
- bei Phasen mit Flag: **das Flag wird angelegt und bleibt auf Default aus**,
- bei Phasen mit Testanruf-Abnahme: **die offenen Abnahmepunkte werden in
  `tasks/al-testcall-checklist.md` nachgetragen, nicht als erledigt markiert.**

## 7. Was der Owner nach seiner Rueckkehr tun muss

Die naechste Session fuehrt diese Liste in `tasks/al-testcall-checklist.md` fort. Startbestand:

1. **AL-P2 vorbereiten und fahren** — Wegwerf-Assistant VON HAND anlegen, mit **explizit
   gesetzter** `TELNYX_ASSISTANT_ID` und gesetztem `TELNYX_ELEVENLABS_MODEL`, an einer eigenen
   `TELNYX_CONNECTION_ID`/Nummer. **Nie** ueber leeres `TELNYX_ASSISTANT_ID` erzeugen:
   `scripts/telnyx-assistant-provision.mjs` schreibt die GANZE Live-Config aus der lokalen
   `.env` — ohne ID entstuende ein neuer Assistant, ohne Voice-Model wuerde die Live-Stimme
   still umgestellt. Dann 2 Testanrufe. **Ergebnis entscheidet ueber AL-P7 und AL-P7b.**
2. **`EXA_API_KEY`** in `.env` und Render setzen (erst fuer die Abnahme von AL-P10b noetig).
3. **Testanrufe** fuer AL-P5, AL-P7b, AL-P10b, AL-P14, AL-P15 — je nach Fortschritt.
4. **Flags anschalten**, jeweils nach bestandenem Testanruf: `PRECALL_BRIEFING_ENABLED`,
   `THINKING_SIGNAL_ENABLED`, `RESEARCH_ENABLED`, `LOOKUP_ENABLED`.
5. **O2 (Offenlegungssatz)** — falls die 3-4 Sekunden gewuenscht sind: Rechtspruefung des
   zweiten Teilsatzes beauftragen. Bis dahin gilt "unveraendert".
6. **O6 (Auslands-Tarif)** — die Ist-Werte von `VOICE_TARIFF_DEFAULT_CENTS`,
   `DEFAULT_TENANT_BUDGET_CENTS` und der Max-Gespraechsdauer im Dashboard nachlesen; der
   Boot-Guard `worst_case_unaffordable` feuerte am 23./25.07., seit dem 27.07. nicht mehr.
   Ausserhalb dieser Kette, aber vor AL-P9 zu klaeren.
7. **Dokumentationspflicht** aus AL-P10b: der In-Call-Such-Adapter bringt ein neues Secret und
   einen **zweiten Auftragsverarbeiter** — das durchbricht die Randbedingung aus
   `src/precall-briefing.js:5-7` und gehoert in `README.md` und `PLAN-SECURITY.md`.

## 7b. WARNUNG: eine zweite Kette liegt auf master

Am 2026-07-28 hat eine **parallele Session** `a727804 docs: PLAN-AUTH-GATE` committet —
9 Phasen, **nichts davon umgesetzt**. Diese Kette loest das Basic-Auth-Gate ab und fasst
`src/routes/`, `src/auth.js`, `src/middleware.js` und `src/config.js` an.

Kollisionsflaechen mit der AL-Kette:
- **`src/config.js`** — beide Ketten legen neue Namespaces/Variablen an. Kleine, haeufige
  Konflikte; loesbar, aber nur wenn nicht gleichzeitig gemergt wird.
- **`src/routes/`** — AL-P13 (Consult-Kanal) legt neue Routen an. Deren Absicherung haengt
  davon ab, welches Auth-Modell gilt. **AL-P13 nicht starten, ohne vorher zu pruefen, ob
  PLAN-AUTH-GATE inzwischen umgesetzt ist** (`git log --oneline -20`), sonst wird die neue
  Route gegen ein Gate gebaut, das gerade abgeloest wird.

**Regel fuer die naechste Session:** vor dem Start `git log --oneline -20` lesen und pruefen,
ob seit `2e0360b` fremde Commits dazugekommen sind. Falls die AUTH-GATE-Kette parallel laeuft:
**nicht beide gleichzeitig fahren.**

> **Owner-Entscheidung 2026-07-28: die AL-Kette hat Vorrang. PLAN-AUTH-GATE wird
> zurueckgestellt.** Wer die AUTH-GATE-Kette starten will, fragt vorher den Owner.

## 7c. ZUERST LESEN: `tasks/al-owner-notes.md`

Der Owner traegt dort vor Beginn ein, was nur er beschaffen kann. **Diese Datei ist das Erste,
was die naechste Session liest.** Ausgefuellte Abschnitte sind bindend:

- **Abschnitt 1 (Telnyx-Support zu SSE-Streaming)** — bei der Antwort "puffert bis `[DONE]`"
  wird AL-P7 zurueckgestellt und AL-P7b direkt auf **Weg B** geplant. Die endgueltige
  Streichung von AL-P7 erst nach dem Spike AL-P2: eine Doku-/Support-Aussage entrisikt, sie
  beweist nicht (Repo-Lehre: nur der Objekt-GET zaehlt).
- **Abschnitt 2 (der frueher gebaute Recherche-Agent)** — schlaegt die Benchmark-Zahlen aus dem
  Dossier. Fuellsatz-Formulierungen und Suchhaeufigkeit von dort uebernehmen, statt sie neu zu
  erfinden.
- **Abschnitt 4 (Wegwerf-Umgebung)** — ohne diese IDs kann AL-P2 nicht laufen, egal wie weit
  der Code ist.

Leere Abschnitte heissen: die betroffene Phase laeuft bis vor die Abnahme, Flag bleibt aus,
offener Punkt nach `tasks/al-testcall-checklist.md`.

## 8. Buchfuehrung

Die naechste Session pflegt fortlaufend:
- `tasks/al-chain-state.md` — welche Phase gemergt, welcher Commit, welches Gate-Urteil
- `tasks/al-testcall-checklist.md` — offene Abnahmen
- `tasks/al-env-changes.md` — jede Render-Env-Aenderung mit Zeitstempel
- `tasks/al-p<N>-report.md` — schreibt der Report-Agent je Phase selbst
