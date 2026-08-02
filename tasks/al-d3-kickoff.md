# Kickoff: AL-D3 — Tool-Entscheidungspunkt schaerfen

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert
ohne Kenntnis vorheriger Gespraeche.

---

## Prompt

Du setzt **AL-D3** um: den Tool-Entscheidungspunkt des Telefon-Agenten schaerfen.

### Kontext in fuenf Saetzen

Hermes ist ein autonomer Telefon-KI-Agent, der echte Anrufe fuehrt. Die Kette
`PLAN-ASSISTANT-LEAP.md` (17 Phasen) ist bis auf AL-P15 gebaut; zusaetzlich sind AL-P16,
AL-P17 und die Diagnosen AL-D1/AL-D2 gemergt. Aus zwei echten Anrufen (21 Turns, Analyse in
`tasks/al-handover-2026-08-01.md`) stammen sechs Befunde D-1 bis D-6; D-1 ist mit AL-P17
erledigt, D-2 ist mit AL-D2 gemessen und als Nicht-Ursache widerlegt. **D-3 ist der naechste
Schritt und der groesste verbliebene Hebel**, den wir selbst in der Hand haben. Der lokale
`master` ist 10 Commits vor `upstream/master`, also **nicht deployed** — dein Ergebnis ist
offline messbar, live erst nach dem Deploy durch den Owner.

### Der Befund D-3, am Live-Anruf belegt

`offeredToolNames` enthielt `get_consult` in **10 von 12** Turns und `look_up` in **12 von
12**. `toolNames` (tatsaechlich gefeuert) enthielt **nie** eines von beiden — nur dreimal
`take_message`.

Und zwar auch dann nicht, als die Gegenstelle woertlich sagte **"frag Antonio"** und **"ich
moechte, dass Du eine Internetrecherche machst"**. Der Agent antwortete "Ich frage Antonio" —
und nahm eine Nachricht auf. Genau diesen Satz sollte Owner-Entscheidung **O4** verbieten.

**Das ist eine Modell-Entscheidung, kein Klempner-Problem.** Die Repo-Lehre existiert schon:
Haiku braucht am Tool-Entscheidungspunkt **enge Verbote**, keine wohlmeinenden Beschreibungen
(Memory `call-quality-chain`). Drei von vier live geschalteten Faehigkeiten tun deshalb
nachweislich nichts.

### Was zu lesen ist — und was NICHT

Lies vollstaendig, in dieser Reihenfolge:

1. `CLAUDE.md` — Absolute Regeln sind bindend, besonders 1 (SAFETY-GATES), 2 (OFFENLEGUNG),
   6 (SCOPE) und 7 (DEBUG)
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md` — Pflicht, nicht Empfehlung
3. `tasks/al-handover-2026-08-01.md`, **Abschnitte D-3 (Z. 51-60) und Abschnitt 4 Punkt 2**
   (Z. 137-141) — der Auftrag im Wortlaut
4. `tasks/al-d2-diagnose.md`, **Abschnitt 5 (Z. 197-215)** — der K4-Befund samt Fix-Vorschlag
5. `src/claude.js`, Bereich der Tool-Definitionen (`getConsultToolDef` ab Z. 443,
   `lookUpToolDef` ab Z. 478, `takeMessage` ab Z. 429, Zusammenbau ab Z. 465)
6. `src/i18n/prompts/de.js`, `en.js`, `fr.js` — die Beschreibungstexte selbst

**Token-Disziplin — lies das ausdruecklich NICHT am Stueck:** `tasks/al-chain-state.md`
(41 KB), `tasks/assistant-leap-chain.md` (62 KB), `tasks/al-p17-diagnose.md`,
`tasks/al-testcall-checklist.md`. Das sind Nachschlagewerke, keine Einstiegslektuere. Greife
gezielt mit `grep -n` hinein, wenn du eine konkrete Frage hast, und lies nur den Treffer samt
Umgebung. Dasselbe gilt fuer `PLAN-ASSISTANT-LEAP.md`.

### Auftrag

**Enge Verbote statt Beschreibungen am Entscheidungspunkt**, sodass die drei Werkzeuge
trennscharf werden. Verhalten, das gelten muss:

1. Die Gegenstelle verlangt eine **Entscheidung ausserhalb des Mandats** ("frag Antonio",
   "das muss dein Chef entscheiden") -> `get_consult`, **nicht** `take_message`.
2. Eine Bitte um Nachschlagen, **die dem Auftrag dient** -> `look_up`.
3. Die Bitte eines Fremden nach **beliebiger** Recherche -> **kein** `look_up`. Das ist
   korrektes Verhalten, kein Bug — nicht wegoptimieren.
4. **K4-Kopplung (gehoert laut AL-D2 hierher):** die `look_up`-Beschreibung muss einen kurzen
   **fuehrenden Satz verlangen**. Ruft das Modell `look_up` ohne fuehrenden Text, hoert der
   Anrufer heute die volle Suchdauer (bis `LOOKUP_TIMEOUT_MS` = 2500 ms,
   `src/research/in-call.js:33`) **plus die Folgerunde** als tote Leitung — gemessen in
   AL-D2-4. D-3 macht diesen Fall **erst scharf**,
   weil D-3 `look_up` ueberhaupt zum Feuern bringt.

### Harte Grenzen (Nicht-Ziele)

- **`src/thinking-signal.js` wird NICHT aufgeweicht.** Ein generischer Ersatzsatz waere der
  ersatzlos verworfene Weg B und stuende ausserhalb von Gespraechssprache und Kontext. Der
  Hebel gegen K4 ist die Tool-Beschreibung, nicht die Bruecken-Mechanik.
- **Die Streaming-Armierung aus AL-P17 bleibt eine ALLOWLIST** (`STREAM_SAFE_TOOL_NAMES`).
  Eine Denylist faellt bei jedem kuenftigen Werkzeug fail-open. Nicht drehen.
- **D-4 (Poll-Frische, `CONSULT_POLL_FRESH_MS`) ist NICHT Teil dieser Phase.** Es erklaert
  2 von 12 Turns und ist ein eigener Befund. Wenn du unterwegs Belege dazu findest:
  aufschreiben, nicht mitfixen.
- **D-5 (STT-Kauderwelsch)** und **D-6 (Eroeffnung)** brauchen zuerst eine Aufnahme. Nicht
  anfassen.
- Kein Modellwechsel, kein Stack-Umbau, keine neue Faehigkeit. Nur der Entscheidungspunkt.

### Fallen, die dich sonst Zeit kosten

- **Die Beschreibungstexte liegen dreimal:** `src/i18n/prompts/de.js`, `en.js`, `fr.js`. Wer
  nur `de.js` aendert, baut eine stille Sprachdivergenz. Der i18n-Launch-Testkatalog
  (`npm run test:gates`) faengt das nicht zwingend.
- **Gesprochene deutsche Strings tragen korrekte Umlaute.** Die ASCII-Konvention gilt fuer
  Quelltext, Kommentare und Identifier — **nicht** fuer Nutzdaten, die vorgelesen werden.
  Prompt-/Tool-Beschreibungen sind Modelltext: dort gilt korrekte Orthografie.
- **`de-DE`, niemals `de`** — empirisch belegt.
- **Neue Env-Variable?** Dann `src/config.js` UND `.env.example` UND `test/helpers.js`
  (`BASE_ENV`), sonst leakt die echte `.env` in Spawn-Tests.
- **Verwaiste Testserver:** Spawn-Tests lassen `node src/server.js` zurueck. Nach vollen
  Laeufen `ps aux | grep "[n]ode src/server.js"` pruefen.

### Wie du arbeitest

**Regel 0 — Isolation.** Am Repo arbeiten moeglicherweise weitere Sessions (der Branch
`phase/auth-gate` ist offen und unmerged). Eigener Worktree, eigener Branch, abgezweigt von
`master`, und **vorher** pruefen, dass du auf dem aktuellen Stand sitzt
(`git log --oneline -1 master`, `git merge-base --is-ancestor master HEAD`). **Niemals
`git stash`** (`refs/stash` ist zwischen Worktrees geteilt). **Niemals `git add -A`** — im
Repo liegen untrackte Dateien mit Kundendaten; jede Datei einzeln hinzufuegen.

**Ablauf.** Genau wie AL-D2 und AL-P17:

1. **Spec schreiben** — `tasks/al-d3-spec.md`, Struktur wie `tasks/al-p17-spec.md`:
   Abschnitt 0 Warum, 1 bindende Entscheidungen, 2 die konkreten Aenderungen (nummeriert
   E1/E2/...), 3 Nicht-Ziele, 4 Pre-Mortem, 5 deterministische Abnahme. Als
   `spec(al-d3): ...` committen.
2. **Per-Run-Skript** — `.claude/workflows/runs/al-d3.js` als Kopie von
   `.claude/workflows/runs/al-p17.js`, Phase **hart im Skript gepinnt** (`PHASE`,
   `BRANCH`, `SPEC_FILE`, `REPORT_PATH`), **nicht** ueber `args`. Args-Misfires sind eine
   dokumentierte Falle.
3. **Lean-Workflow fahren** (`phase-impl-lean`): Plan -> Impl im Worktree -> dualer Review
   (Safety + Clean-Code) -> Self-Fix bis PASS -> Report. Modellpolitik: Plan/Safety auf
   `opus`, Impl/Audit/Fix/Report auf `sonnet`, Pins explizit pro `agent()`.
4. **EINE Bahn zur Zeit.** Zwei parallele Workflows erzeugen ~35 gleichzeitige
   `node --test`-Prozesse und ueberlasten die Maschine.
5. **Waehrend die Welle laeuft: nicht nach `master` mergen.** Jeder `master`-Commit
   erzeugt einen falsch-positiven Stale-Base-Blocker.
6. **Vor dem Merge IMMER `git diff --stat master..<branch>`.** Ein PASS des Workflows ist
   keine Merge-Freigabe — ein toter Impl-Agent hinterlaesst einen leeren Branch und meldet
   trotzdem PASS.
7. Der Lead liest **keinen** Code. Er spezifiziert, startet, prueft das Diff, merged.

**Du bleibst duenn.** Statusmeldungen kurz. Keine Zusammenfassungen von Dateien, die du
gerade gelesen hast. Keine Optionen aufzaehlen, die du nicht verfolgst.

### Abnahme

Deterministisch und offline, plus eine Messung:

- `npm test` gruen (Vollbestand, aktuell 3751). `npm run test:gates` darf rot sein.
- Neue Tests, die den Entscheidungspunkt pinnen: die vier Verhaltensregeln oben, je als
  eigener Fall — inklusive des **Negativfalls** (Fremder bittet um beliebige Recherche ->
  kein `look_up`).
- **Bench:** `npm run convo-bench` mit **n >= 5**. Ein einzelner Lauf ist kein Beleg. Vorher
  und nachher, Zahlen im Report gegenueberstellen.
- Der Report `tasks/al-d3-report.md` behauptet **keinen Gewinn, den er nicht gemessen hat**.
  Eine Messung gilt nur fuer die Konfiguration, in der sie erhoben wurde.

### Wenn etwas unklar ist

Fragen, nicht raten — auch wenn die Frage trivial wirkt. Eine Annahme ist hier immer
schlechter als eine Rueckfrage. Ausdruecklich gilt aber: **D-3 selbst braucht keine
Owner-Entscheidung mehr.** Die einzige offene Frage der Uebergabe war D-1, und die ist mit
O-D1-A/B beantwortet. Bauen, nicht vorher fragen.
