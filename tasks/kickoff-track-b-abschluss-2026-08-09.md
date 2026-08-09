# Kickoff: Track B zu Ende bringen — Deploy, Live-Abnahme, B4b/B3b/B5 (2026-08-09)

Prompt fuer die naechste Session. Autor: Lead-Session e3b3afe2 (B2/B3a/B4a-Abschluss).
**Regel dieser Datei: GEMESSEN traegt ein Kommando. Alles andere ist Vermutung.**

**Der Owner ist diesmal voll verfuegbar und kann Testanrufe fahren.** Das aendert die Lage:
die drei Restphasen haengen nicht mehr an Verfuegbarkeit, sondern an zwei Handgriffen
(Guthaben, Deploy) und einer Weiche (dem Spike).

---

## 1. Der Auftrag

Track B abschliessen: **Deploy + Live-Abnahme -> B4b -> Spike (Weiche) -> B3b -> B5.**
Danach ist der LLM-Anbieter-Port fertig und Track B kann aufgeraeumt werden.

**Du bist Lean Lead:** du orchestrierst, liest Specs/Reports/Diff-Stats, aber **keinen
Implementierungs-Code**. Arbeit machen Subagenten. Vor jedem Merge siehst du
`git log master..<branch>` und `git diff --stat` selbst an. **PASS ist keine Freigabe** —
in dieser Session hat ein Workflow Gate PASS gemeldet, waehrend der eigene Suite-Lauf des
Leads `fail 1` zeigte.

---

## 2. Stand (GEMESSEN am 2026-08-09)

| Behauptung | Kommando |
|---|---|
| master = `2051979`, Tree sauber | `git log --oneline -1` |
| **origin und upstream stehen auf `5f296ef` — 11 Commits ZURUECK** | `git log --oneline -1 upstream/master` |
| **Live laeuft `6aec118`** — der Stand VOR B2/B3a/B4a | `curl -s https://vodafone-agent.onrender.com/healthz` |
| Live fehlen **15 Produktionsdateien**, +1039/-317 | `git diff --stat 6aec118..master -- src/ package.json render.yaml` |
| Suite gruen | `npm test` -> **4057/4057** (roh 4077), Exit 0 |
| 1 Worktree, 45 Branches | `git worktree list`, `git branch \| wc -l` |
| **Anthropic-Guthaben LEER** | minimaler Call -> HTTP 400 `credit balance is too low` |
| DeepSeek-Guthaben ~1,11 USD, Key in der lokalen `.env` | `bash scripts/set-deepseek-key.sh` |
| Render: `autoDeploy: "no"`, Branch `master`, Repo `jonas986` | `mcp__render__get_service` |

**Erster Handgriff:** `git fetch --all && git log --oneline -1` und `npm test`. Stimmt eines
nicht mit der Tabelle, halte an und klaere es.

---

## 3. ⚠️ DAS DEPLOY-RISIKO — vor allem anderen pruefen

**B4a hat einen Boot-Abbruch eingebaut, der noch NIE gegen die Render-Env gelaufen ist.**
`assertPricedModels` (`src/boot.js`) beendet den Prozess mit Exit 1, wenn `claudeModel` oder
`briefingModel` keine Preisstaffel in `MODEL_PRICE_SCHEDULES` haben.

- **Code-Defaults sind sicher:** `claude-haiku-4-5` und `claude-sonnet-5` haben beide eine
  Staffel. Sind die Env-Vars in Render **nicht gesetzt**, ist der Deploy unkritisch.
- **Gefaehrlich ist genau ein Fall:** `CLAUDE_MODEL` oder `PRECALL_BRIEFING_MODEL` stehen in
  der Render-Env auf etwas anderes — vor allem auf eine **datierte Snapshot-ID** wie
  `claude-haiku-4-5-20251001`. Das ist ein ANDERER Schluessel als der Alias; der Boot bricht
  ab und **der Dienst kommt nicht mehr hoch**.
- **Die Render-API gibt die Env-Vars nicht heraus** (`get_service` liefert sie nicht, der
  MCP-Zugang ist schreibend). **Der Owner muss im Render-Dashboard nachsehen** — 30 Sekunden,
  zwei Variablen.

**Reihenfolge daher zwingend:** Env pruefen -> dann erst pushen/deployen. Ein Rollback ist auf
dem Free-Tier ohne Shell muehsam.

---

## 4. Was der Owner beisteuert (und was ohne ihn nicht geht)

| Punkt | Warum blockierend |
|---|---|
| **Anthropic-Guthaben aufladen** | Blockiert B4b, B3b, B5 **und den Live-Betrieb**: Claude ist das Gespraechs-Gehirn. Am 2026-08-04 lieferten echte Anrufe `[turn] 400 credit balance is too low`; **seither gab es keinen Anruf**, der Zustand ist also ungeprueft, nicht gesund. |
| **Zwei Env-Variablen im Render-Dashboard pruefen** | s. Abschnitt 3 |
| **Push auf `upstream` + manueller Deploy** | `origin` loest NICHTS aus (Render haengt an `jonas986`), und `autoDeploy` ist `no` |
| **Ein bis zwei Testanrufe** | Die Live-Abnahme fuer B3a+B4a und die Datenbasis fuer B4b |

---

## 5. Die Reihenfolge — und warum genau diese

### Schritt 1: Deploy + Live-Abnahme (das groesste offene Risiko)

**B3a hat den LLM-Seam umgebaut, B4a die Preisrechnung und einen Boot-Abbruch.** Beides ist
durch 4057 Tests gedeckt, aber **der Live-Sprechpfad ist seit diesen Merges nie gelaufen**.
Die Suite kann echte Telefonie nicht abnehmen — das steht so in CLAUDE.md.

1. Render-Env pruefen (Abschnitt 3)
2. `git push upstream master` (nicht `origin` — das deployt nichts)
3. Manueller Deploy im Render-Dashboard
4. `/healthz` gegen `git rev-parse master` pruefen — **den Deploy-Stand NIE aus einer Notiz
   lesen**
5. **Ein Inbound-Testanruf.** Erwartet: der Agent spricht, das Transkript ist vollstaendig,
   im Log stehen keine `[turn] 400`.

**Faellt der Boot ab:** die Meldung nennt die Modell-ID woertlich (`[boot] Start abgebrochen:
Modell(e) ohne Preis in modelPricesUsd: ...`). Fix ist entweder die Env-Variable auf den Alias
zu stellen oder eine Staffel in `MODEL_PRICE_SCHEDULES` zu ergaenzen.

### Schritt 2: B4b — der gemessene Betrag-Rueckgang (W6)

**Braucht keinen neuen Code.** Die vier Token-Sorten stehen je Aufruf schon in der
LLM-Metrik (`llm.js`, `metricsExtra`). Aus EINEM Anruf auf dem neuen Stand laesst sich
beides rechnen: der Betrag nach alter Faltung und der nach neuer Aufschluesselung.

- **Die Frage, die W6 beantwortet:** um wie viel sinkt der gebuchte Betrag bei realem
  Cache-Treffer-Anteil — und schwaecht das die Kostendecke praktisch?
- **Fixture-Vorhersage (nicht die Antwort, nur die Groessenordnung):** bei 80 % Cache-Treffern
  sinkt der Betrag auf 46,9 %. Der reale Anteil ist unbekannt und genau das Messziel.
- **Sauberer waere ein Vorher-Anruf auf dem alten Stand** (vor dem Deploy). Wenn du den
  willst, muss er vor Schritt 1 laufen — danach ist der alte Stand weg. Kein Muss: die
  Arithmetik auf echten Token traegt W6 auch mit einem einzigen Nachher-Anruf.
- **Owner sieht die Zahl.** Das ist Absolute Regel 1: der Betrag sinkt, das Gate greift
  spaeter. Die Groesse dieses Effekts ist eine Owner-Information, keine Fussnote.

### Schritt 3: Der Spike — die Weiche fuer alles Weitere

**Empfehlung der B3-Spec, und der einzige Schritt, der schon jetzt ohne Anthropic-Guthaben
laufen kann** (er braucht DeepSeek, ~1,11 USD sind da).

> Wegwerf-Spike auf eigenem Branch, **der NIE gemergt wird**: mit
> `scripts/deepseek-b1-messung.mjs` als Bauteil und einer handgeschriebenen Uebersetzung
> **einen mehrrundigen Werkzeug-Loop** gegen `deepseek-v4-pro` fahren (Text -> `tool_calls`
> -> `role:"tool"` -> Text).

**Ziel: W8 beantworten — traegt das Modell das Gespraech auf Deutsch ueberhaupt?** B1 konnte
das nicht (`max_tokens` war 64, die Antworten waren abgeschnitten). Praezedenzfall **B-7**:
dokumentierte Deutsch-Unterstuetzung, **gemessene 97 % Wortfehlerrate**.

- Kosten: ein paar Cent, Stunden Arbeit, **null Risiko am Live-Pfad**.
- **Faellt er negativ aus, entfallen B3b und B5** — Track B waere mit B4b abgeschlossen, und
  B3a/B4a waeren trotzdem kein Verlust (beide sind Vorbedingung fuer alles Weitere).
- Faellt er positiv aus, gehen B3b und B5 mit Daten statt mit Hoffnung an den Start.

### Schritt 4: B3b — die Anfrageseite (nur wenn der Spike traegt)

Die Uebergabe steht vollstaendig in `tasks/b3a-report.md` (Grenztabelle: welcher Marker
faellt, welcher bleibt, mit Grund). Kurzfassung der Restmenge: `input_schema` (4x in
`claude.js`, 1x in `precall-briefing.js`), `cache_control` (2x), `max_tokens` (2x+1),
`system` als Blockliste, `tool_choice` (dreiwertig!), plus der **Pflicht-Nachzug
`bridge.js` `realtimeTools`**, der an `input_schema` haengt.

- **`LlmRequest.cachePrefix` gehoert hierher** (Lead-Entscheidung E6, genehmigt): B3a hat sie
  bewusst NICHT vorgezogen, weil sie dort keinen Aufrufer hatte.
- **Abnahme braucht den Bench** — und der braucht Anthropic-Guthaben (~2,1 USD).
- **Vorher-Werte: `tasks/b3-vorher-werte.md`, ABER mit Korrektur.** 8 der 80 Laeufe sind keine
  Messung (das Guthaben lief mitten im Lauf leer). `d3-fremde-recherche` starb 5/5 mit
  `turns: 0` und meldete trotzdem `checks 10/10`. **Gueltiger Nenner ist 72, nicht 80**, und
  **beide betroffenen Szenarien muessen vor dem Vergleich neu erhoben werden.**
- Der Nachher-Wert MUSS auf demselben Treiber (`shim`) und derselben Konfiguration entstehen.

### Schritt 5: B5 — der DeepSeek-Adapter (nur wenn der Spike traegt)

Abnahme laut Plan mit **echtem Anruf** — jetzt moeglich, weil der Owner verfuegbar ist. Der
Adapter kommt hinter ein Flag, das per Env zurueckfaellt.

**Bindend aus B2:** `toolChoice` ist **DREIWERTIG** (`auto` / `required` / benanntes
Werkzeug). `precall-briefing.js` `briefingTooling` nutzt live einen namentlich erzwungenen
Zwang — ein zweiwertiger Adapter bricht das Precall-Briefing.
**Offen aus B2 (W2):** was bei unparsebaren Werkzeug-Argumenten passiert. B1 hat den Fall nie
beobachtet; B5 ist der erste Adapter, der wirklich parst, und entscheidet es.

---

## 6. Zuerst lesen (Reihenfolge)

1. `CLAUDE.md` — Absolute Regeln. **Regel 1 (pro-Tenant-Kostendecke) ist in B4b direkt
   beruehrt.**
2. `.claude/refs/workflow.md` + `.claude/refs/clean-code.md` — Pflicht
3. **`tasks/todo.md`**, die Abschnitte B2 / B3a / B4a — der Kettenstand mit allen
   Lead-Entscheidungen und Befunden
4. `tasks/b3-spec.md` (Abschnitt 6 = Zuschnitt, 7 = Abnahme) und **`tasks/b3a-report.md`**
   (die Grenztabelle fuer B3b)
5. `tasks/b4-spec.md` (Abschnitt 4.8 = W6/B4b) und `tasks/b4a-report.md` (die
   Ausloeser-Tabelle des Boot-Abbruchs — Betriebswissen)
6. `tasks/b3-vorher-werte.md` — **mit dem Korrektur-Kasten oben**
7. `tasks/lessons.md`, die letzten fuenf Abschnitte

---

## 7. Bindende Entscheidungen (nicht neu aufrollen)

- **Owner, 2026-08-08:** *"ich will dass die echten kosten abgebucht werden keine annahmen"* —
  Raten je Token-Sorte (umgesetzt in B4a), taegliche Perioden-Gegenprobe (offen, W7).
- **"Echte Kosten" heisst NICHT ein Kostenfeld des Anbieters** — das existiert nicht. Es
  heisst: anbieter-gemeldete Token je Sorte mal veroeffentlichte Rate = Arithmetik, plus die
  Gegenprobe als Beleg, dass die Rate stimmt.
- **W4:** `worstCasePrice` = punktweises Maximum jeder der vier Raten. Der Fallback wird NICHT
  gestrichen — `tokenCostUsd` hat keinen Null-Check, ohne Fallback endet ein unbekanntes
  Modell im TypeError oder in NaN, und `NaN > limit` ist immer false (**fail-open am Gate**).
- **W5:** keine Store-Migration. Die Gate-Kette liest Cent-Achsen, keine Token-Zaehler.
- **`realtimeModel` ist bewusster Nicht-Ausloeser** des Boot-Abbruchs (WF-4: `bridge.js` bucht
  keine Token). Ein Abbruch dafuer haette keine Schutzwirkung und wuerde **jeden** Start
  verhindern — belegt: die Ausweitung macht sieben Bestandstests rot.

---

## 8. Betriebswissen, das sonst Zeit kostet

- **Deploy:** Render deployt `upstream` (jonas986), `origin` (Antonio20045) loest nichts aus.
  `autoDeploy: no` -> manueller Deploy noetig. Live-Stand IMMER per `/healthz` pruefen.
- **`convo-bench` braucht `node --env-file=.env scripts/convo-bench.mjs ...`** — es laedt kein
  `dotenv`. **Nie `--all`** (ein kaputtes Szenario beendet den GESAMTEN Lauf).
  `--scenario` nimmt genau EINE ID. `inbound-nachricht` laeuft nur mit `--driver texml`.
  Werkzeug-Nutzung steht in `metrics.turns[].tools`, **nicht ins Transkript grepen**.
  **Vierter Bestandsdefekt (neu):** ein Lauf, der am LLM-Fehler stirbt, meldet **gruene
  Checks** statt eines Fehlers — ein Bericht ohne Turns darf keine Quote melden.
- **Hintergrund-Testlaeufe NIE mit `| tail`** — die volle Ausgabe in eine Datei schreiben und
  erst beim Lesen filtern. Sonst ist bei einem Fehlschlag die Diagnose weg (in dieser Session
  passiert; "Flake oder Regression?" ist fuer den Vorfall dauerhaft unbeantwortbar).
- **Commit-Messages mit Anfuehrungszeichen ueber `-F datei` schreiben** — inline zerlegt die
  Shell sie (zweimal passiert, einmal brach ein `git merge` mit *"not something we can
  merge"* ab).
- **Workflow-Skripte:** keine Backticks in den Prompt-Template-Literalen (Parse-Fehler).
  Vorlage ist `.claude/workflows/runs/b4a.js` (traegt den REPO-Hart-Pin gegen die
  Symlink-Falle).
- **`timeout` gibt es auf macOS nicht**, `xargs -a` auch nicht.
- **Worktrees nach jedem Workflow aufraeumen** — der Branch bleibt sonst belegt und
  `git checkout` scheitert. Pfad enthaelt ein Leerzeichen: `while IFS= read -r` statt
  `for w in $(...)`.

---

## 9. Offene Punkte ausserhalb der Restphasen

- **WF-4 — braucht eine Owner-Entscheidung:** `src/bridge.js` bucht **null** Token
  (`grep -c "bookTokenUsage\|trackUsage\|meterAiTokens"` -> 0). Folgenlos, solange
  `VOICE_ENGINE=budget` laeuft (Default und Live-Stand) — wer auf `realtime` umstellt, faehrt
  mit **blinder Gate-Achse**.
- **W7 — Traeger der taeglichen Perioden-Gegenprobe:** nicht in B4. Die Praemisse "Render hat
  keinen Cron" ist am Code widerlegt (`setInterval().unref()` ist Hausmuster, `boot.js`); es
  fehlen Endpunkt (DeepSeek -> B5; ein Anthropic-Aequivalent ist **unbelegt**) und Verbraucher.
- **Ein unerklaerter Suite-Fehlschlag:** der erste Lauf auf dem B4a-Branch meldete `fail 1`,
  der zweite war gruen (4057/4057). Welcher Test es war, ist unbekannt. Kein Blocker, aber ein
  Datenpunkt, kein Beweis.
- **45 Branches**, davon die Phasen-Branches aus B2/B3a/B4a gemergt. Aufraeumen ist
  ungefaehrlich, war aber nicht Auftrag.
- **Aufraeumen am Kettenende (CLAUDE.md-Pflicht):** wenn Track B fertig ist, verschwinden
  `tasks/b3-spec.md`, `tasks/b3a-report.md`, `tasks/b4-spec.md`, `tasks/b4a-report.md`, dieser
  Kickoff und das per-run-Skript. **Behalten:** `tasks/b1-report.md`,
  `tasks/b3-vorher-werte.md`, der Kettenstand in `tasks/todo.md`, `tasks/lessons.md`.
  Reihenfolge nicht optional: erst committen, dann loeschen.
