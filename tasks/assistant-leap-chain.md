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

---

## 9. Phasen-Spezifikationen (autoritativ fuer `phase-impl-lean`)

**Warum dieser Abschnitt existiert:** `phase-impl-lean.js` kennt **kein** Argument fuer einen
Zusatz-Prompt. Alles, was Abschnitt 6 „der Phasen-Prompt bekommt zusaetzlich" verlangt, muss
deshalb hier stehen — das ist der einzige Kanal zum Plan-Agenten. Der Plan-Agent bekommt die
Anweisung, „den Abschnitt fuer `AL-P<n>`" in dieser Datei zu suchen; die Ueberschriften unten
tragen darum exakt diese IDs.

### 9.0 Gilt fuer JEDE Phase dieser Kette

1. **Namensbruecke.** Die IDs dieser Kette heissen `AL-P<n>`. In `PLAN-ASSISTANT-LEAP.md` heisst
   dieselbe Phase `#### Phase <n>` (ohne `AL-`-Praefix). Der jeweils genannte Plan-Abschnitt ist
   die **inhaltliche** Spezifikation (Ziel, Was konkret, Abnahme, Zurueckdrehen). Der Abschnitt
   hier ergaenzt ihn um bindende Betriebsregeln und **geht bei Widerspruch vor**.
2. **Bindend im Plan-Doc ist der Abschnitt „Entscheidungen O1-O9".** Der Abschnitt „Herleitung
   der offenen Fragen" darunter ist **historisch und gilt NICHT** — er enthaelt Ausweich-
   Antworten, die der Owner spaeter umgekehrt hat (insbesondere O8).
3. **Regel 0 — Basis herstellen, DANN lesen.** Ein frischer Worktree sitzt hier
   erfahrungsgemaess auf einem alten Commit. Das ist normal und harmlos — solange in dieser
   Reihenfolge gearbeitet wird:
   1. **Zuerst** den Arbeitsbranch von `master` anlegen: `git checkout -b <branch> master`
      (Reviewer: `git checkout -b <review-branch> <ziel-branch>`). Refs sind zwischen Worktrees
      geteilt, `master` loest immer korrekt auf.
   2. **Danach** verifizieren: `git rev-parse HEAD` == `git rev-parse master` (bzw.
      `git merge-base --is-ancestor master HEAD` fuer einen Ziel-Branch).
   3. **Erst dann** Quelldateien lesen oder Tests fahren.

   Wer Schritt 3 vor Schritt 1 macht, liest einen veralteten Stand und zieht daraus falsche
   Schluesse (in der KS-Kette einmal passiert: der Review-Agent meldete aus seinem eigenen noch
   nicht umgestellten Worktree eine „veraltete Basis", die es nie gab). Ein veralteter HEAD
   **vor** dem Checkout ist KEIN Blocker. Ein falscher HEAD **nach** dem Checkout ist einer.
4. **Neue Env-Variable = vier Orte, sonst ist sie kaputt:** `src/config.js` (Namespace, kein
   Alias-Wildwuchs) + `.env.example` + `render.yaml` + **`BASE_ENV` in `test/helpers.js`**.
   Fehlt der vierte, leckt die lokale `.env` in die Spawn-Tests.
5. **Neue Flags stehen per Default AUS** und das Verhalten bei ausgeschaltetem Flag ist
   **byte-identisch** zum Bestand. Das ist ein Testgegenstand, keine Behauptung.
6. **`npm test` MUSS gruen sein** (beide Backends). `npm run test:gates` darf rot sein.
   Ein Regressionstest traegt **NIE** eine Katalog-ID (`GAP-`, `PROMPT-`, `PAY-`, `DID-`, …) am
   Namensanfang — er landet sonst still im Gates-Lauf und meldet nie wieder etwas.
7. **Nie `git add -A`.** Dieses Repo hat untrackte Dateien, die nicht in die History gehoeren.
   Es wird ausschliesslich die betroffene Datei-Liste gestaged.
8. **Kein Deploy, kein Push nach `upstream`.** Der Owner entscheidet, wann etwas live geht.
9. **Abnahmen, die einen echten Anruf brauchen, gelten NICHT als erledigt.** Sie werden
   woertlich in `tasks/al-testcall-checklist.md` nachgetragen (Phase, was zu tun ist, woran man
   Erfolg erkennt) und im Report als offen gefuehrt. Die Phase gilt trotzdem als gebaut.
10. **Geldrelevante Flags bleiben AUS:** `PRECALL_BRIEFING_ENABLED`, `RESEARCH_ENABLED`,
    `LOOKUP_ENABLED`, `THINKING_SIGNAL_ENABLED`. Ihr Anschalten IST die Abnahme und gehoert dem
    Owner. Anlegen ja, einschalten nein.
11. **Keine neue npm-Dependency** ohne ausdrueckliche Freigabe im Phasen-Abschnitt hier.
    HTTP-Aufrufe laufen ueber das Bestandsmuster (`fetch` + Timeout), nicht ueber ein SDK.
12. **DER PLAN IST AELTER ALS DER CODE.** `PLAN-ASSISTANT-LEAP.md` wurde vor der KS-Kette
    (Kosten-Steuerung, gemergt und live am 2026-07-30/31) geschrieben. Die KS-Kette hat genau die
    Stellen umgebaut, an denen AL weiterarbeitet. **Jede Zahl, jedes Symbol und jede
    Mechanik-Beschreibung aus dem Plan-Doc wird am ECHTEN Code auf `master` nachgeprueft, bevor
    darauf geplant wird.** Bei Widerspruch gilt der Code; die Abweichung wird im Bericht benannt
    und **nicht** nebenbei gefixt (fremde Phase). Bekannte Drift, nicht abschliessend:
    - `src/telnyx-llm-shim.js` traegt seit KS-P2 den **Live-Budget-Term** in der Mid-Call-Pruefung
      und seit KS-P1b den **geteilten Re-Attach-Pfad** (`killCallForBudget`). Beides ist
      Geldpfad — wer den Shim anfasst, darf davon nichts beschaedigen.
    - **Worst-Case-Tarif-Fallback 300 -> 30 ct/min** (KS-P6). Ist-Werte kommen aus dem
      Boot-Banner, nicht aus dem Plan-Text.
    - **`MAX_CALL_DURATION_S` wird nicht mehr gelesen** (KS-P3/E2/E3). Die nutzbare Dauer faellt
      pro Call aus dem Restguthaben; die Notbremse ist `min(Restminuten + 1 min, 1800 s)`, die
      1800 s sind hartkodiert und bewusst kein Knopf.
    - **Die Plattform-Achse (`MAX_BUDGET_EUR`) ist seit KS-P9/E10 KEINE Sperre mehr**, nur
      Messung + Warnschwelle. Die **pro-Tenant-Kostendecke sperrt weiterhin beide Richtungen**,
      Inbound eingeschlossen (E11 wurde zurueckgezogen, die Begruendung war falsch).
    - Reserve, Ablehnungstexte und Anzeige lesen seit KS-P4/P5a/P8 **dieselbe Achse wie das
      Gate**; der Nutzer sieht Prozent statt Euro.

### AL-P1 — Latenz-Achse und Abbruch-Achse schliessen

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 1`.
- **O1 ist entschieden** (`VOICE_ENGINE=budget` + Assistant-Pfad aktiv, gemessen). Der
  Teilauftrag „Pfad feststellen" entfaellt; die **Boot-Banner-Zeile fuer das Assistant-Flag wird
  trotzdem gebaut** — sie ist die dauerhafte Sonde.
- **Migration auf der Prod-DB:** `ALTER TABLE … ADD COLUMN IF NOT EXISTS` nach Bestandsmuster
  (`context`/`mandate`), idempotent. json-Backend haelt Paritaet.
- **Abnahme 3 und 4 brauchen echte Anrufe** (>= 5 gescriptete Anrufe, >= 3 Aufnahmen). Die
  gehen nach Regel 9.0/9 in die Checkliste. Gebaut wird das **Werkzeug**, das die Tabelle ohne
  Handarbeit erzeugt, plus der `callerTurns`-Zaehler.
- Die Auswertung ist ein **lokales read-only Skript** auf dem `psql`-Forensik-Pfad —
  **kein neuer HTTP-Endpunkt, keine neue Route**, keine Transkript-Texte in der Ausgabe.

### AL-P2 — SSE-Spike: konsumiert Telnyx inkrementell?

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 2`.
- **Owner-Freigabe 2026-07-28:** eine **neue Telnyx-Connection/TeXML-App** darf angelegt werden,
  eine der **nicht-live** DIDs darf darauf zeigen, einer der drei ungenutzten `Blank`-Assistants
  dient als Wegwerf-Assistant. Kein Kauf. Keine Aenderung am Live-Assistant `Hermes`
  (`assistant-dcf48d08-…`).
- **Vorbedingung ERLEDIGT am 2026-07-28** (read-only `psql` auf der Prod-DB, RLS pro Tenant
  gesetzt). Ergebnis — und es korrigiert die Annahme aus `tasks/al-owner-notes.md` §4:

  | DID | Tenant | letzter Call | Bewertung |
  |---|---|---|---|
  | `+17067101188` | `t_user_01KX6008…` | 2026-07-27, 9 outbound | **DIE LIVE GENUTZTE — nicht anfassen** |
  | `+15739090177` | `t_user_01KXH2B7…` | 2026-07-24, 2 outbound | seit 4 Tagen still |
  | `+18643028341` | `owner` | 2026-06-28, 2 outbound | seit 30 Tagen still |

  **Wichtige Abweichung von der Annahme:** es gibt **keine herrenlose Ersatz-DID**. Alle drei
  stehen auf `status=active` und jede ist die **einzige** Nummer eines eigenen Tenants
  (`number`-Tabelle, ein Datensatz je Tenant). Umhaengen einer DID auf eine Wegwerf-Connection
  nimmt dem betroffenen Tenant Inbound **und** Outbound.
  Entschaerfend: laut Bestandslage sind **alle drei Accounts wir selbst** — es gibt keine
  fremden Kunden. Daraus folgt fuer die Phase:
  - Wegwerf-**Absender** = `+18643028341` (30 Tage still, `owner`-Tenant).
  - Wegwerf-**Ziel** (nimmt ab und schweigt) = `+15739090177`.
  - `+17067101188` bleibt unberuehrt.
  - **Das Zurueckhaengen beider DIDs auf die Connection `Hermes` (`2982643896460248193`) ist
    Teil der Phase, nicht Nacharbeit.** Vorher-Zustand (Connection-ID je DID) wird notiert,
    nachher wird er per Objekt-GET verifiziert — nicht angenommen.
- **Verboten:** `scripts/telnyx-assistant-provision.mjs` fuer diesen Zweck. Es schreibt die ganze
  Live-Config aus der lokalen `.env` (ohne `TELNYX_ASSISTANT_ID` entsteht ein neuer Assistant,
  ohne `TELNYX_ELEVENLABS_MODEL` wird die Live-Stimme still umgestellt).
- **Kein Mensch noetig:** Hermes ruft eine eigene Ersatz-DID an, die ueber eine triviale TeXML-App
  abnimmt und schweigt. Gemessen wird `audio_first_token_duration_ms` plus die Aufnahme.
  Die regulaeren Gates werden **nicht** umgangen (verifizierter Tenant, `OUTBOUND_FROZEN` aus).
- **Der Verzoegerungs-Schalter wird am Ende der Phase ERSATZLOS ENTFERNT.** Bleibt er wider
  Erwarten stehen, dann nur mit Eintrag in `productionFootguns` (`src/config.js`).
- **Ergebnis ist ein Urteil:** gruen (~1 s) -> AL-P7 gerechtfertigt. rot (~8 s) -> AL-P7 wird
  ersatzlos gestrichen. Der gemessene Telnyx-Turn-Timeout wird als Zahl protokolliert.

### AL-P2b — Betriebsumgebung fuer den Spike (Wegwerf, nie nach master)

**Diese Phase baut NUR auf dem Branch `phase/al-p2-sse-spike` und wird NIE nach `master`
gemergt.** Sie liefert die zwei Bausteine, die AL-P2 ausdruecklich ausgeklammert hat, damit der
Spike ohne Menschen laufen kann. `baseBranch` ist deshalb der Spike-Branch, nicht `master`.

**Kontext, gemessen am 2026-07-29 ueber die Telnyx-API (read-only):**
- Alle drei DIDs haengen an der **TeXML-Anwendung** `Hermes` (`2982643896460248193`),
  deren `voice_url` auf `https://app.sundartha.com/voice/incoming` zeigt.
- Daneben existiert die Call-Control-Anwendung `Hermes Call Control` (`3000979485014098987`)
  und je eine automatisch erzeugte TeXML-App pro AI-Assistant.
- Live genutzt: `+17067101188`. Ungenutzt: `+18643028341` (Absender) und `+15739090177` (Ziel).

**1. Eine Route, die abnimmt und schweigt.**
Der Spike braucht ein Gegenueber, das den Anruf annimmt und **nichts sagt** — sonst ist in der
Aufnahme nicht zu trennen, wann *unser* Assistant zu sprechen beginnt.
- Neue Route, die ein minimales TeXML-Dokument liefert: annehmen, dann eine lange Pause.
- **Sie ist ausschliesslich fuer den Wegwerf-Dienst gedacht** und gehoert hinter denselben
  Schutz wie der Verzoegerungs-Schalter: ohne gesetzte Spike-Zielnummer ist sie **inaktiv**
  (404), damit sie auf einem versehentlich damit deployten Dienst nichts beantwortet.
- Kein Eingriff in `/voice/*`-Bestandsrouten, keine neue Auth-Ausnahme fuer `/api/*`.
  Begruende die Auth-Entscheidung im Code-Kommentar (Regel 3): Telnyx ruft sie unauthentifiziert,
  also gilt dasselbe Muster wie fuer die bestehenden Provider-Webhooks.

**2. Ein Treiber-Skript, das die Messung fuehrt.**
`scripts/` — read-mostly, idempotent, mit `--dry-run` als Default:
- liest den Ist-Zustand der beteiligten Telnyx-Objekte und **schreibt ihn als Datei weg**
  (Vorher-Zustand ist die Grundlage des Rueckbaus, nicht Gedaechtnis),
- setzt den Wegwerf-Assistant auf `api_base` des Wegwerf-Dienstes,
- haengt die zwei DIDs auf die Wegwerf-Anwendung um,
- loest den Anruf aus, wartet, holt `audio_first_token_duration_ms` aus dem
  Conversation-Record und faellt das Urteil ueber die in AL-P2 gebaute Urteils-Funktion,
- **`--restore` haengt beides zurueck und verifiziert per Objekt-GET**, dass wieder
  `2982643896460248193` eingetragen ist — behauptet es nicht, sondern prueft es.

**Harte Grenzen:**
- **`+17067101188` wird NIE angefasst.** Das Skript verweigert den Dienst, wenn diese Nummer
  in irgendeinem Argument auftaucht.
- **Kein Schreibzugriff auf den Live-Assistant** `assistant-dcf48d08-…`; auch hier eine
  Verweigerung im Skript, nicht nur ein Kommentar.
- **`scripts/telnyx-assistant-provision.mjs` wird nicht benutzt und nicht veraendert.**
- Secrets nie loggen; die Rufnummern duerfen im Klartext stehen (es sind unsere eigenen).

### AL-P2s — Den Spike-Schalter erneut aufsetzen (BEFRISTET, Owner-Entscheidung 2026-07-31)

**Warum es diese Phase gibt:** AL-P2 ist bis heute **nicht gemessen** — es existiert kein Urteil
(`incremental`/`buffered`). Der Messversuch am 29.07. scheiterte daran, dass die Schweige-Route
den Anruf nie annahm; die Umgebung wurde vollstaendig zurueckgebaut und der Schalter mit **KS-AUF**
(`643f8dc`) ersatzlos aus master entfernt. Die KS-Spec behauptet an einer Stelle „der AL-P2-Spike
ist gemessen und abgeschlossen" — **das ist falsch** und war der Anlass fuer diesen Abschnitt.

**Owner-Entscheidung 2026-07-31:** die Messung laeuft auf dem **Live-Dienst**, Zielnummer ist die
**Mobilnummer des Owners** — er geht ran und schweigt. Kein Wegwerf-Dienst (scheiterte am
Boot-Guard), kein Tunnel, keine Schweige-Route (scheiterte bereits).

- **Vorlage:** `git show af4a66e` ist die vollstaendige frueher gebaute Fassung. **Ein
  Revert-des-Reverts geht NICHT sauber durch** — `src/telnyx-llm-shim.js` und
  `test/telnyx-shim-harness.js` sind seit dem Spike durch KS-P2 (Live-Budget-Term) und KS-P1b
  (Re-Attach-Seam, `killCallForBudget`) umgebaut. Handarbeit gegen den **heutigen** Code, mit
  `af4a66e` als Referenz fuer Umfang und Riegel.
- **Umfang (identisch zur Vorlage, nicht groesser):**
  - `src/telnyx-llm-shim.js`: `sseSpikeDelayMsFor` ist die **EINE** Stelle, die ueber
    Betroffenheit entscheidet — Verzoegerung **UND** Zielnummer gesetzt **UND** `call.to` gleich
    Zielnummer. Jede andere Konstellation liefert die **byte-identische** Bestandssequenz.
  - Die vier Notaus-Pfade (Rate-Gate, Budget-Kill, Loop-Guard, Degradations-Catch) uebergeben
    ausdruecklich **keine** Pause und bleiben sofortig. Ebenso unberuehrt: der Live-Budget-Term
    aus KS-P2 und der Re-Attach-Pfad aus KS-P1b — **Geldpfad, nicht beschaedigen.**
  - `src/config.js`: `TELNYX_SSE_SPIKE_DELAY_MS`, `TELNYX_SSE_SPIKE_CALLEE` (E.164, fail-closed,
    Wert wird **nie** geloggt) und die `productionFootguns`-Sperre: Verzoegerung ohne Zielnummer
    ist im Hosting ein **Boot-Refusal**.
  - `src/boot.js`: Banner-Sonde bei jedem Start. `src/utils/timer.js`: `sleepMs`.
  - `scripts/telnyx-call-latency.mjs`: `sseSpikeVerdict`
    (`incremental`/`buffered`/`inconclusive`/`no_data` — **kein Urteil ohne Messung**) und
    `--spike-delay-ms`.
  - Env-Vierklang (`config.js`, `.env.example`, `render.yaml`, `BASE_ENV` in `test/helpers.js`),
    `PLAN-SECURITY.md`-Eintrag, Fahr- **und** Rueckbau-Protokoll in
    `tasks/al-testcall-checklist.md`.
- **Der Schalter ist befristet.** Der Rueckbau ist **Teil der Abnahme**, nicht „Flag auf 0" — er
  laeuft als eigene Phase **AL-P2z** direkt nach der geglueckten Messung. Genau diese Zusage
  wurde beim letzten Mal eingehalten (KS-AUF); sie gilt erneut.
- **Ausdruecklich NICHT Teil dieser Phase:** Deploy, Env-Werte setzen, Telefonieren, Telnyx-
  Objekte anfassen. Das ist Owner-/Lead-Arbeit nach dem Merge.

### AL-P2z — Den Spike-Schalter wieder ersatzlos entfernen

- Laeuft **erst nach** einer geglueckten Messung mit protokolliertem Urteil.
- Vorlage fuer den Umfang: der Abschnitt **KS-AUF** in `tasks/ks-chain-spec.md` — dort steht die
  vollstaendige Entfernungsliste, die schon einmal sauber durchgelaufen ist.
- Kein toter Code, keine verwaisten Env-Schluessel, keine Kommentare, die auf den entfernten
  Schalter verweisen. `npm test` gruen ohne neue Tests.

### AL-P3 — Endpointing konfigurieren

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 3`.
- Beruehrt `src/claude.js` **nicht** (Bahn B).
- Die Wirkung ist erst live messbar; gebaut und getestet wird die Konfiguration.

### AL-P4 — Seiteneffekt-Werkzeuge brechen den Tool-Loop

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 4`.
- Hub-Phase (`src/claude.js`). `agentTurn` wird von der Budget-Engine **und** der
  Realtime-Bridge genutzt — vor jeder Signatur-Aenderung alle Aufrufer greppen.
- Abnahme steht auf dem `turn_ok`-Log aus AL-P1 (`roundtrips`, `toolNames`, `speechEmpty`).

### AL-P5 — Die Eroeffnung kuerzen

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 5`.
- **O2 ist entschieden: der Offenlegungssatz bleibt UNVERAENDERT.** Regel 2 aus CLAUDE.md gilt
  unangetastet — fest verdrahtet, erster Satz, kein Setting, das ihn abschaltet, kein
  KI-Ermessen. Die Phase holt den Gewinn **ausserhalb** des Offenlegungssatzes.
- O2 fixiert die Phase auf den **Worst Case** (~18 s -> ~11 s). Das typische Fenster von <= 9 s
  ist **kein** Abnahmekriterium.
- **Abnahme = Testanruf** -> Checkliste.

### AL-P6 — Turn-Deadline und Budget-Pruefung pro Runde

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 6`.
- **Geldpfad, Regel 1.** Die Budget-Pruefung pro Runde darf ein bestehendes Gate nur
  **verschaerfen**, nie aufweichen. Der geteilte Lebenszeit-/Perioden-Topf und die Schnittmenge
  global/pro-Tenant bleiben unberuehrt.
- **Der KI-Kosten-Akku wird NICHT pro Inkrement gerundet** — sonst wird das Budget-Gate blind
  (teuer gelernte Repo-Lehre).
- Ein Abbruch wegen Deadline muss vom Abbruch wegen Budget **unterscheidbar** protokolliert sein
  (`grund=` maschinenlesbar, Bestandsmuster).

### AL-P7 — Echtes Token-Streaming und Satz-Chunking

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 7`.
- **Die Vorbedingung ist ERFUELLT.** AL-P2 wurde am 2026-07-31 live gemessen:
  **`status=incremental`** — bei 8000 ms kuenstlichem Rueckhalt begann Telnyx nach **129 ms** zu
  sprechen (Median ueber 3 Turns, Conversation `12d1d46e-…`), bei 30 000 ms nach **99 ms**
  (`19b2c73f-…`). Bei Pufferung bis `data:[DONE]` muessten diese Werte >= dem Rueckhalt liegen.
  Zweitbeleg am Gehoer des Owners. **Die Phase ist damit gerechtfertigt und wird gebaut.**
- **Gemessener Telnyx-Turn-Timeout: > 30 s** — der Turn ueberlebte die oberste geplante Sprosse.
  Die bindende Zeitgrenze im Turn ist deshalb **nicht** Telnyx, sondern unser eigener
  `PROVIDER_WEBHOOK_HARDCUT_MS = 15000` (`src/turn-budget.js`). Wer hier plant, rechnet gegen
  diese eigene Sicherung, nicht gegen einen vermuteten Fremdwert.
- **AL-P1-Abnahme 1 ist mitgeliefert:** dieselbe Messung ergab `unaccounted-median = 0 ms`,
  `status=ok`. Das Gegenteil (`unknown_component`) waere laut Checkliste ein **Blocker** fuer
  diese Phase gewesen.
- Groesster Blast-Radius der Kette: geteilter `agentTurn`-Seam. Der Plan zerlegt die Phase in
  kleinstmoegliche, je fuer sich gruene Schritte.

### AL-P7b — Das Denk-Signal

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 7b`.
- **WEG A IST ENTSCHIEDEN — durch Messung, nicht durch Annahme.** AL-P2 ist gruen
  (`incremental`, 2026-07-31, s. AL-P7). Damit gilt:
  - Der Fueller ist der **fuehrende Text des Modells im selben Antwort-Block wie der
    Werkzeugaufruf** — kein zusaetzlicher Roundtrip, kein zusaetzliches Token-Budget von Belang.
  - **Weg B entfaellt vollstaendig**, samt seiner drei Riegel und dem out-of-band-Sprechkanal
    ueber `voiceControl.speak` waehrend der Assistant-Session. Dieser Kanal wird in dieser Phase
    **nicht** gebaut — er waere ein Sprechweg, der an `agentTurn` vorbeilaeuft (ohne
    `shapeForSpeech`, ohne Laengen-/Sprachbindung, ohne Prompt-Leitplanken).
  - Die Saetze aus `src/i18n/locales.js` sind auf Weg A **nicht** die Quelle des Fuellers; die
    Sprachbindung traegt der bestehende Prompt-Sprachvertrag und wird per Fixture geprueft
    (de/fr/en, DE ohne Umlaute).
  - Die Phase setzt **AL-P7 voraus** (Streaming-Pfad) und laeuft deshalb nach ihr.
- **Bindende Owner-Betriebserfahrung** (`tasks/al-owner-notes.md` §2, aus einem real betriebenen
  Recherche-Telefonagenten — schlaegt jede Benchmark-Tabelle):
  1. **Der Ueberbrueckungssatz wird IMMER zu Ende gesprochen.** Das Ergebnis wartet auf
     `speak.ended`. Genau das abrupte Abschneiden mitten im Satz war **der eine hoerbare Defekt**
     des Vorgaengers. Das ist die wichtigste Anforderung der Phase.
  2. **Der Agent kuendigt die Suche NIE an.** Kein „ich schaue das kurz nach", kein „das hat die
     Suchanfrage ergeben". Er ueberbrueckt und liefert dann einfach das Ergebnis.
  3. **Der Fuellsatz ist KONTEXTABHAENGIG**, kein fester Standardsatz. Er entsteht als fuehrender
     Text im **selben** Antwort-Block wie der Werkzeugaufruf — das kostet keinen Extra-Roundtrip.
- Flag `THINKING_SIGNAL_ENABLED`, Default **aus**. **Abnahme = Testanruf** -> Checkliste.
- **UMGESETZT** (`src/thinking-signal.js`, `src/claude.js`, `src/telnyx-llm-shim.js`,
  Prompt-Bloecke in `src/i18n/prompts/{de,en,fr}.js`). Zwei bewusste Abweichungen vom
  Plan-Wortlaut oben, beide im Umsetzungsplan begruendet (§1 E3/E5):
  - **E3 (Schwelle strukturell statt zeitlich):** kein `~1,3 s`-Timer und kein Warten auf
    `speak.ended`. Die Bruecke feuert genau dann, wenn der Tool-Loop nach der Runde
    weiterlaeuft — das ist eine echte Teilmenge von "Zug ueber der Normaldauer" (ein
    weiterlaufender Loop heisst mindestens zwei Modell-Roundtrips) und ohne Uhr testbar.
    "Der Ueberbrueckungssatz wird IMMER zu Ende gesprochen" (Owner-Kriterium oben) ist
    trotzdem erfuellt — **strukturell**: Bruecke und Antwort sind zwei `content`-Deltas
    DESSELBEN SSE-Stroms, in dieser Reihenfolge; es gibt keinen zweiten Sprechkanal, der
    die Bruecke unterbrechen koennte.
  - **E5 (kein Nachhaken in die eigene Wartezeit, NICHT gebaut):** der Idle-Timer gehoert
    Telnyx (`USER_IDLE_REPLY_SECS`) und ist per-Turn nicht abschaltbar; ein serverseitiger
    In-Flight-Riegel im Shim waere geraten (unvermessen, ob/wie Telnyx auf einen zweiten
    Request waehrend eines offenen antwortet). Der Testanruf **misst** das erst (dritte
    Checklisten-Zeile); ergibt die Messung ein Nachhaken, folgt eine eigene Mini-Phase.
  - Beide Flags (`THINKING_SIGNAL_ENABLED`) bleiben Default **aus**; bei ausgeschaltetem
    Flag ist der Systemprompt byte-identisch (Test AL-P7b-6/-11).

### AL-P8 — Der Bench misst den Pfad, der live ist

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 8`.
- Bestandsbefehl ist `npm run convo-bench`; Aussagekraft erst ab n >= 5.
- Eine Messung gilt **nur** fuer die Konfiguration, in der sie erhoben wurde.

### AL-P9 — Vorab-Briefing anschalten und verbreitern

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 9`.
- Flag `PRECALL_BRIEFING_ENABLED` bleibt **AUS** (Owner-Abnahme).
- **O6:** die Ist-Werte von `VOICE_TARIFF_DEFAULT_CENTS`, `DEFAULT_TENANT_BUDGET_CENTS` und der
  Max-Gespraechsdauer sind zwischen dem 25. und 27.07. veraendert worden. Wer hier plant, **liest
  die Ist-Werte** statt gegen 300/600 zu rechnen.
- Der Boot-Guard `worst_case_unaffordable` darf durch diese Phase nicht scharf werden.

### AL-P10 — Recherche vor dem Waehlen

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 10` (ausdruecklich **nur** die billige
  Sprosse — die In-Call-Recherche ist AL-P10b).
- **KORREKTUR 2026-07-29 (diese Zeilen waren vorher falsch):** der Such-Anbieter dieser Phase ist
  **Anthropics serverseitiges `web_search`** im bestehenden `src/llm.js`-Seam — **kein**
  API-Key, **kein** zweiter Auftragsverarbeiter. So steht es in A3 des Plans:
  „pre-call = Gruendlichkeit (Anthropics serverseitiges `web_search`)".
  **Brave (`BRAVE_SEARCH_API_KEY`) gehoert ausschliesslich zu AL-P10b** (in-call =
  Geschwindigkeit). Ein Secret-Slot fuer Brave in DIESER Phase ist Scope-Drift und wurde im
  Review zu Recht als Blocker entfernt. Der gemeinsame Port `src/research/` hat zwei
  Adapter-Plaetze; diese Phase fuellt nur den ersten.
- Flag `RESEARCH_ENABLED` bleibt **AUS**, wirksam ist die **Schnittmenge** aus globalem Flag und
  Per-Tenant-Setting `allowResearch` (beide Default aus). Egress-Riegel fail-closed (O3): die
  Query wird ausschliesslich aus `goal`, `briefing`, `context`, `open_questions` komponiert.

### AL-P10b — `look_up`: Recherche IM Gespraech

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 10b`.
- Baut auf AL-P7b (Denk-Signal) und AL-P10 (Such-Port) auf und teilt sich deren Adapter —
  **kein zweiter Such-Client**.
- **Freigabe-Checkliste aus O8, vollstaendig zu erfuellen:** Denk-Signal-Kanal belegt, Suchlatenz
  p95 gemessen, **Richtungs-Gate (outbound-only)** plus Kontingent gebaut, Query-Filter und
  Injektions-Riegel **per Test gepinnt**, Suchgebuehr **vor dem Zug** auf die Budget-Achse
  gebucht.
- **Prompt-Injektion:** der Suchtreffer ist fremder Text im Gespraechspfad. Er wird als Daten
  behandelt, nie als Anweisung; das ist ein Testgegenstand.
- **Dokumentationspflicht:** der In-Call-Adapter bringt **ein neues Secret und einen zweiten
  Auftragsverarbeiter** — er durchbricht die Randbedingung aus `src/precall-briefing.js` (Kopf-
  Kommentar). Das gehoert in `README.md` **und** `PLAN-SECURITY.md`.
- Flag `LOOKUP_ENABLED` bleibt **AUS**. **Abnahme = Testanruf + Key** -> Checkliste.

### AL-P10b-fix — Den einen stehengebliebenen Review-Blocker von AL-P10b beheben

**Basis ist NICHT `master`, sondern `phase/al-p10b-lookup-fix2`.** AL-P10b lief am 2026-07-31 mit
Gate **BLOCKED** aus: zwei Fix-Runden waren verbraucht, ein Befund blieb stehen. Nur dieser
Befund wird behoben — **kein weiterer Scope, keine Nachbesserung an bereits abgenommenen
Teilen.**

**Der Befund (vom Safety-Review empirisch gemessen, nicht gelesen):** Der **Realtime-Pfad**
erhaelt die GRENZEN-Prompt-Zeile „kann nachschlagen", **ohne** dass ihm das Werkzeug angeboten
wird.

- `src/claude.js` `promptInputs()` setzt `lookupAvailable: lookupAvailableFor(call)`;
  `boundaryRules()` rendert daraus `b.lookupAllowed`.
- `systemPrompt()` ist geteilt: `src/bridge.js` baut `instructions(call)` daraus, waehrend der
  Realtime-Werkzeugsatz aus `realtimeTools(language) = toolDefs(language)` kommt — und `toolDefs`
  traegt `look_up` **bewusst nie** (Entscheidung E1 der Phase).
- Messung mit `LOOKUP_ENABLED=true`, `ASSISTANT_CONTEXT_ENABLED=true`, gesetztem Key, aktivem
  Outbound-Call, `VOICE_ENGINE=realtime`: „Prompt sagt kann nachschlagen: **true**",
  „toolDefs: **end_call,take_message**".

**Warum das zaehlt, obwohl es live nicht ausloesbar ist** (`VOICE_ENGINE=budget`, Flag aus): es
ist genau die Faehigkeits-Unehrlichkeit, die der `boundaryRules`-Block laut seinem eigenen
Kopfkommentar schliesst, und genau der geteilte Aufrufer, den CLAUDE.md unter „Vor Edits"
benennt. Der Kommentar an `promptInputs` behauptet ausdruecklich das Gegenteil („dieselbe Frage
entscheidet ueber den Werkzeugsatz UND ueber die GRENZEN-Zeile") — fuer `bridge.js` stimmt das
nicht. **Schweigend stehen lassen ist keine Option.**

**Auftrag:**
1. Die GRENZEN-Zeile an das **tatsaechlich in diesem Zug angebotene** Werkzeug binden — bzw.
   `lookupAvailable` fuer den Realtime-Pfad **fail-closed auf false**. Die kleinere, ehrlichere
   Loesung gewinnt; die Wahl wird im Kommentar begruendet.
2. **Regressionstest**, der pinnt: der Realtime-Prompt enthaelt **nie** `lookupAllowed`, solange
   `realtimeTools` kein `look_up` traegt. Mutationsprobe: die Eigenschaft absichtlich
   kaputtmachen und pruefen, dass der Test rot wird.
3. Den irrefuehrenden Kommentar an `promptInputs` korrigieren.
4. `npm test` gruen. Keine Katalog-ID am Testnamen-Anfang.

### AL-P11 — Ergebnis-Karte statt Prosa

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 11`.
- **O5 ist entschieden, in der eingeschraenkten Fassung:** hoechstens **2** woertliche Zitate,
  **kurze Frist ueber den Diagnose-Sweep — NICHT ueber `RETENTION_DAYS`**, und die Zitate werden
  erst sichtbar, **nachdem** sie in der Datenschutzerklaerung genannt sind. Bis dahin wird der
  Pfad gebaut, aber nicht freigeschaltet.
- Keine laengere PII-Haltung als heute. Das ist die harte Grenze der Phase.

### AL-P12 — Beziehungsgedaechtnis

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 12`.
- Tenant-Isolation ist nicht verhandelbar: jeder neue Lesepfad laeuft ueber `tenantContext`,
  ein tenant-uebergreifender Lesepfad im Dienst braucht Regel 3 plus Audit.

### AL-P13 — Consult-Kanal am Call, MCP-Schleife

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 13`.
- **Neue Routen.** Regel 3 (Auth fail-closed) gilt voll: standardmaessig hinter Auth, jede
  Ausnahme braucht eine eigene Absicherung **und** eine Begruendung im Code-Kommentar.
- **Kollisionswarnung:** `PLAN-AUTH-GATE` (Commit `a727804`) loest das Basic-Auth-Gate ab und ist
  **zurueckgestellt, nicht umgesetzt**. Die neuen Routen werden gegen das **heute geltende**
  Auth-Modell gebaut und so geschnitten, dass der spaetere Gate-Wechsel sie nicht bricht.
- **O9:** ChatGPT ist Ziel — die zweite Quote (>= 5 `place_call` aus ChatGPT) faehrt mit.
- **Der MCP-Rueckkanal ist tot** (Sampling/Elicitation/Tasks sind in claude.ai und ChatGPT
  unbrauchbar). Es zaehlt ausschliesslich der **client-gezogene** Tool-Aufruf. Ein Design, das
  auf Server-zu-Client-Push baut, ist falsch.

### AL-P14 — `get_consult` im Gespraech

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 14`.
- **O4 ist entschieden: Mandats-Fallback bei Timeout.** Ausdruecklich **nicht** „ich gebe das
  weiter" — genau dieser Satz hat die urspruengliche Beschwerde ausgeloest.
- Beruehrt den **Tool-Entscheidungspunkt**. Repo-Lehre: Haiku braucht dort **enge Verbote**, nicht
  wohlmeinende Beschreibungen.
- **Richtungs-Gate** wie bei AL-P10b. **Abnahme = Testanruf** -> Checkliste.
- **OWNER-ENTSCHEIDUNG 2026-07-31 (Datenschutz-Grenze, die AL-P13 ausdruecklich vor dieser Phase
  verlangt hat): die Consult-Frage ist eine PARAPHRASE — keine woertlichen Zitate des
  Angerufenen.** In AL-P13 stammten Consult-Fragen ausschliesslich aus `context.open_questions`
  (Auftrag des Nutzers). AL-P14 formuliert sie erstmals aus **fremder Rede**; damit exportiert ein
  Consult Aussagen eines Dritten, der nie eingewilligt hat. Bindend:
  - Die Frage wird **serverseitig laengenbegrenzt** (benannte Konstante, Muster
    `RESULT_EVIDENCE_MAX_ITEMS` aus AL-P11) und traegt **kein woertliches Zitat** — nur die
    Sachfrage. Durchsetzung **serverseitig UND im Prompt**, nicht nur im Prompt.
  - Das ist ein **Testgegenstand**: ein Test speist absichtlich eine Frage mit woertlichem Zitat
    ein und weist nach, dass sie den Server nicht in dieser Form verlaesst.
  - Freischaltung erst, wenn die Datenschutzerklaerung (`apps/web`) die Weitergabe von Inhalten
    aus dem laufenden Gespraech an den MCP-Host nennt — Muster O5/AL-P11. Bis dahin: gebaut,
    Flag aus, Zeile in `tasks/al-testcall-checklist.md`.
- **`consultTimeoutMs` ohne AL-P2-Messung:** der Plan schreibt „deutlich unter dem in Phase 2
  gemessenen Telnyx-Timeout". **Dieser Wert existiert nicht** — AL-P2 ist bis heute nicht
  gemessen. Die einzige Zahl im Code ist `PROVIDER_WEBHOOK_HARDCUT_MS = 15000`
  (`src/turn-budget.js`), aus der **Twilio**-Doku abgeleitet und fuer den Shim-Pfad ausdruecklich
  „live UNBESTAETIGT". Also: konservativ **deutlich darunter** waehlen, die Herleitung im
  Kommentar als unbestaetigt kennzeichnen — und **keine Zahl behaupten, die nicht gemessen ist**.
- **`USER_IDLE_REPLY_SECS`:** der Plan verlangt `>= consultTimeoutMs` **oder** dass der
  Fueller-Turn den Idle-Timer bewusst neu setzt. Der Ist-Wert ist klein (AL-P5 zielt auf 2 s; der
  Provisioner-Lauf steht noch aus) — die erste Bedingung ist damit praktisch nicht erfuellbar.
  **Also gilt der zweite Weg:** waehrend eines laufenden Consults wird das Idle-Nachhaken
  ausgesetzt. Ist-Wert live nachlesen, nicht annehmen. Das ist Abnahme, keine Nebenbemerkung.

### AL-P15 — Zustellung deterministisch machen

- **Spezifikation:** `PLAN-ASSISTANT-LEAP.md`, `#### Phase 15`.
- Messphase. Sie behauptet keinen Gewinn, den sie nicht gemessen hat, und eine Messung gilt nur
  fuer die Konfiguration, in der sie erhoben wurde.
