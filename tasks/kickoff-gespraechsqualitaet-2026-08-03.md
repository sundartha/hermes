# Kickoff: Das Telefonat gut machen — Neustart nach 17 Phasen ohne Wirkung

Diesen Text in einer **frischen Session** als ersten Prompt verwenden. Er funktioniert ohne
Kenntnis vorheriger Gespraeche.

---

## Prompt

Du uebernimmst die Gespraechsqualitaet des Telefon-Agenten Hermes. Der Owner hat gerade,
nach einem Testanruf gegen den frisch deployten Stand, gesagt: **"eine absolute Katastrophe,
von vorne bis hinten stimmt absolut gar nichts."** Das ist die Messlatte, nicht die
Testsuite.

### Der Stand in fuenf Saetzen

Die Kette `PLAN-ASSISTANT-LEAP.md` (17 Phasen) ist gebaut, 16 davon gemergt, die
Diagnosen AL-D1/D2/D3 dazu. Alle Faehigkeitsflags sind an, alle per-Tenant-Rechte gesetzt,
`npm test` ist gruen. **Trotzdem ist das Telefonat unbrauchbar.** Der Live-Stand ist
`ce4df1d` (per `/healthz` gepruefte Tatsache, nicht aus einer Notiz gelesen). Der lokale
`master` traegt zusaetzlich AL-D3 und eine fremde, **nicht deploy-fertige** auth-gate-Kette
— nicht blind deployen, s. §Betrieb.

### Die Befunde, alle am echten Anruf belegt

Beleg-Anruf `call_msczdf1aadbw` (2026-08-03, 19 Turns, 196 s, Rohtranskript in der
Prod-DB). Vergleichsanruf **vor** dem letzten Deploy: `call_msahzky8m8p9` (2026-08-01).

**B-1 — Der Agent schneidet sich selbst das Wort ab. Ursache gefunden, Wurzel offen.**
Aeusserungen der Gegenstelle kommen **doppelt** an: einmal angefangen, einmal vollstaendig
(Zwischenergebnis + Endergebnis der Spracherkennung). **Beide** loesen einen eigenen
Agenten-Turn aus. Der Agent beginnt zu sprechen, ~1,5 s spaeter startet die zweite Runde
und ueberschreibt ihn. Belegt an Transkript-Segmenten 09/10 -> Agenten-Antworten 11/12
(zwei Antworten am Stueck), und im Log an `turnSeq` 5/6 bzw. 11/12 mit 1,5-1,7 s Abstand.
**Existiert schon am 01.08., ist also NICHT vom Streaming verursacht** (dort Segmente 09/10
-> 11/12, dasselbe Muster). Das Streaming macht es vermutlich nur hoerbarer, weil der Agent
frueher zu sprechen beginnt — Hypothese, nicht belegt. **Dieser Befund vergiftet alles
andere: jede zweite Antwort ist die Reaktion auf einen halben Satz.**

**B-2 — `get_consult` erkennt seinen eigenen Anlass nicht.** Es feuerte in diesem Anruf
genau einmal — **erst nachdem die Gegenstelle woertlich sagte "Du kannst mit der Funktion
get consult deinen Boss fragen"** (Segment 15/17). Der Owner dazu: *"Das geht ja ueberhaupt
nicht, dass ich sowas mache. Er soll das selbststaendig und autonom machen und merken, wenn
er eine Information nicht weiss."* Ein Agent, den die Gegenstelle bedienen muss, ist kaputt.
Zwei Prompt-Anlaeufe (AL-P14, AL-D3) haben daran nichts geaendert — **eine dritte
Formulierungsrunde ist der falsche Weg.**

**B-3 — Der Consult-Rueckkanal versagte, und der Agent leugnete daraufhin seine Faehigkeit.**
Die Antwort ueber `answer_consult` kam mit `accepted:false, merged_facts:0` zurueck. Zwei
Segmente spaeter sagt der Agent: *"Ich habe leider keine Funktion, um Antonio direkt zu
konsultieren – das geht technisch nicht."* (Segment 18) — nachdem er sie benutzt hatte.
**Warum die Antwort abgelehnt wurde, ist ungeklaert und muss zuerst gemessen werden.**

**B-4 — `look_up` feuert nie.** In **19 von 19** Turns angeboten, **0 mal** gefeuert. Auf
"Wann wurde Fiat gegruendet?" antwortete er *"Fiat wurde 1899 gegruendet"* aus dem
Gedaechtnis und sagte danach *"das wusste ich einfach"* (Segmente 31-34). Der Owner hat
zweimal ausdruecklich eine Internetrecherche verlangt und keine bekommen.

**B-5 — Der Agent legt nicht auf.** `end_call` wurde in **19 von 19** Turns nicht
aufgerufen. Nach *"Gut, dann gebe ich Antonio Bescheid"* (Segment 36) redet er weiter
(Segment 38).

**B-6 — Pathologische Wiederholung.** `take_message` feuerte **8 mal**, immer mit derselben
Nachricht. Die Segmente 18, 23, 24, 26, 30, 32, 34, 38 tragen im Kern denselben Satz.

**B-7 — STT-Kauderwelsch (vorbestehend).** *"Hast Du das im Internet tress passiert?"*,
*"Bis zum behindert, man."* Nicht von dieser Kette verursacht, nie behoben.

**Was NACHWEISLICH funktioniert:** das Token-Streaming aus AL-P17. `streamArmedRounds:1` und
`streamChunks:1-3` in **allen 19** Turns (vorher: 0 in allen 21). Der Owner hat entschieden:
**bleibt an.**

### Zwei Owner-Vorgaben

1. **Autonomie.** Der Agent muss selbst merken, dass ihm etwas fehlt. Kein Coaching durch die
   Gegenstelle.
2. **Kuerze ist ein Ziel, kein Nebeneffekt.** Der Agent soll das Gespraech so kurz wie
   moeglich halten — telefonierte Minuten sind der groesste Kostenblock (Tarif 30 ct/min).
   Das ist eine **neue** Anforderung und noch nirgends umgesetzt.

### Eine offene Owner-Hypothese

*"Vielleicht liegt es am Modell, vielleicht ist Haiku zu doof. Dann koennen wir ja mal
Sonnet ausprobieren."* — Das ist eine **zu pruefende Hypothese**, kein Auftrag. Sie ist
erst dann sinnvoll pruefbar, wenn es einen Messstand gibt, der die Befunde oben reproduziert
(s. unten). Vorher misst ein Modellwechsel nichts.

### Warum 17 gruene Phasen nichts gebracht haben — lies das, bevor du planst

**Der Feedback-Loop war kaputt, nicht der Arbeitsablauf.** Jede Phase wurde gegen `npm test`
und den Conversation-Bench abgenommen. Beide waren gruen, waehrend das Telefonat kaputt war:

- Der Bench simuliert die Gegenstelle mit einem sauberen Modell. **Er erzeugt keine
  doppelten Turns, kein Kauderwelsch, keine Halbsaetze** — also genau die Bedingungen nicht,
  unter denen der Agent scheitert.
- Am 02.08. gemessen und dokumentiert: das eigens gebaute Bench-Szenario feuerte `look_up`
  **schon mit den alten Beschreibungen 5/5**, waehrend es live 0/12 feuerte. Ein Szenario,
  das den Defekt nicht reproduziert, kann keinen Fix belegen.

**Deshalb ist der erste Schritt kein Feature und keine Phasenkette, sondern ein Messstand.**

### Auftrag

**Erst messen koennen, dann planen, dann bauen.** In dieser Reihenfolge.

**Schritt 1 — Der Wiederholungs-Pruefstand (bevor irgendetwas anderes passiert).**
Baue einen Harness, der **echte Anrufe aus der Prod-DB abspielt**: die tatsaechlichen
Gegenstellen-Turns in ihrer tatsaechlichen Reihenfolge, **inklusive der Doppel-Zustellungen
und des Kauderwelschs**, gegen den echten Agenten-Turn-Pfad. Ausgabe: welche Werkzeuge
angeboten/gefeuert wurden, wie viele Turns, wie viele Wiederholungen, ob `end_call` kam.
Rohmaterial liegt bereit: `call_msczdf1aadbw`, `call_msahzky8m8p9`, `call_msabz9975sph`.
**Abnahme dieses Schritts: der Pruefstand reproduziert B-1, B-4, B-5 und B-6 ROT.**
Reproduziert er sie nicht, ist er wertlos — nachschaerfen, nicht weitergehen.

**Schritt 2 — Strategiedokument mit Phasen.** Erst wenn Schritt 1 rot ist. Jede Phase nennt
ihren Befund (B-x), ihre Messgroesse auf dem Pruefstand und ihren Rueckweg. Reihenfolge nach
Wurzeltiefe, nicht nach Bequemlichkeit — **B-1 (Doppel-Turns) ist die Wurzel und kommt
zuerst**: solange jede zweite Antwort auf einen halben Satz reagiert, misst du bei allen
anderen Befunden Rauschen. Danach B-5/B-6 (sie zahlen direkt auf die Kuerze-Vorgabe ein),
dann B-2/B-3, dann B-4.

**Schritt 3 — Umsetzung je Phase.** Der etablierte Weg ist ein Lean-Phasen-Workflow
(`.claude/skills/phase-impl-lean`, Vorlage `.claude/workflows/runs/al-d3.js`): Spec ->
Plan -> Impl im Worktree -> dualer Review (Safety + Clean-Code) -> Self-Fix bis PASS ->
Report. Modellpolitik: Plan/Safety auf `opus`, Impl/Audit/Fix/Report auf `sonnet`, Pins
explizit pro `agent()`. **Eine Bahn zur Zeit** (zwei parallele Workflows ueberlasten die
Maschine). **Vor jedem Merge `git diff --stat master..<branch>`** — ein PASS ist keine
Merge-Freigabe.

**Das ist eine Vorlage, kein Dogma.** Der Owner ist ausdruecklich offen fuer einen besseren
Ablauf. Was sich als **nicht** verhandelbar erwiesen hat, ist etwas anderes: **jede Phase
endet mit einer Messung auf dem Pruefstand aus Schritt 1, und die Kette endet mit einem
echten Testanruf, den der Owner beurteilt.** Gruene Tests sind eine Vorbedingung, kein
Ergebnis.

**Schritt 4 — Die Modellfrage.** Wenn der Pruefstand steht, ist Haiku vs. Sonnet ein
A/B-Lauf, keine Phasenkette. Vorher nicht anfassen.

### Harte Grenzen

- **Token-Streaming bleibt AN** (Owner-Entscheidung 03.08.). Die Armierung bleibt eine
  **Allowlist** — eine Denylist faellt bei jedem kuenftigen Werkzeug fail-open.
- **Safety-Gates, Offenlegungssatz, Auth, Kostendecken** bleiben unberuehrt. Neue Endpunkte,
  die Calls/SMS ausloesen koennen, brauchen dieselben Gates.
- **Keine Phasenkette vor dem Pruefstand.** Das ist der Fehler, der 17 Phasen gekostet hat.
- **Kein Modellwechsel als Schnellschuss**, s. Schritt 4.

### Betrieb — was dich sonst Zeit oder Schaden kostet

- **Deploy:** Render deployt `upstream/master` (Repo `jonas986/vodafone-agent`, Service
  `srv-d8m0fhflk1mc73bno570`), `autoDeploy: no` -> manuell ausloesen. `git push origin`
  macht **nichts** live. Live-Stand IMMER per `/healthz` pruefen, nie aus einer Notiz.
- **Lokaler `master` ist NICHT deploy-fertig:** er traegt eine fremde auth-gate-Kette
  (`b111927` entfernt das Basic-Auth-Gate, das heute als einziges 17 Routen schuetzt) mit
  einem dokumentierten offenen Blocker (kein Account hat `role='admin'`). **Nicht mitdeployen**
  ohne Ruecksprache. Parallel arbeitet moeglicherweise eine zweite Session am selben `master`.
- **Prod-DB-Forensik:** `psql "$(cat ~/.config/hermes/db-url)"`. RLS ist FORCE — ein naives
  `SELECT` liefert 0 Zeilen. Erst `SELECT set_config('app.current_tenant','<tenant>',false);`
  in **derselben** Sitzung. Die Tenant-Tabelle ist ohne das lesbar, `call` und
  `transcript_segment` nicht. Der relevante Tenant ist
  `t_user_01KX600834GCJFV9GTZQKWZMTH`. Rohtranskripte existieren nur befristet
  (`EVIDENCE_RETENTION_DAYS=7`) — **zieh sie dir als Erstes und sichere sie lokal.**
- **Turn-Diagnostik live:** Render-Logs, Zeilen `[telnyx-shim] turn_ok` mit `toolNames`
  (gefeuert) gegen `offeredToolNames` (angeboten), dazu `streamArmedRounds`, `streamChunks`,
  `thinkingSignal`, `consultPollFresh`, `latencyMs`, `roundtrips`.
- **`place_call` verlangt E.164** (`+49...`), obwohl die Werkzeugbeschreibung eine
  Aufloesung der fuehrenden 0 ueber das Heimatland behauptet. Kleiner eigener Befund.
- **Niemals `git stash`** (zwischen Worktrees geteilt), **niemals `git add -A`** (untrackte
  Dateien mit Kundendaten im Repo), Dateien einzeln adden.
- Nach vollen Testlaeufen `ps -eo pid,command | grep "[n]ode src/server.js"` pruefen.

### Pflichtlektuere, in dieser Reihenfolge

1. `CLAUDE.md` — Absolute Regeln, bindend
2. `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
3. `tasks/al-chain-state.md`, **nur der Abschnitt 2026-08-03** (die Messung von AL-D3 und
   warum der Bench nichts belegt)

**Token-Disziplin:** `PLAN-ASSISTANT-LEAP.md` und die aelteren Kettenstaende sind
Nachschlagewerke. Greif mit `grep -n` hinein, lies nicht am Stueck.

### Haltung

Der Owner hat 17 gruene Phasen und ein kaputtes Telefonat. Er braucht keine weitere Phase,
die gruen abnimmt und nichts aendert. **Miss zuerst, dass du den Defekt reproduzieren
kannst. Behaupte keinen Gewinn, den du nicht gemessen hast. Und wenn eine Messung sagt, dass
deine Arbeit nichts gebracht hat, schreib genau das hin.**

Bei Unklarheit fragen, nicht raten — eine Annahme ist hier immer schlechter als eine
Rueckfrage.

---

## Beweismaterial ist bereits gesichert

Die Rohtranskripte der vier relevanten Anrufe liegen als Textdateien unter
`data/evidence/` (gitignored, also nicht im Repo — lokal auf der Maschine des Owners):

| Datei | Segmente | wozu |
|---|---:|---|
| `call_msczdf1aadbw.txt` | 38 | Beleg-Anruf 03.08. fuer B-1 bis B-7 |
| `call_msahzky8m8p9.txt` | 24 | 01.08., belegt B-1 **vor** dem Streaming-Deploy |
| `call_msabz9975sph.txt` | 17 | 01.08., zweiter Anruf |
| `call_msahy6o4y3ip.txt` | 0 | Waehlversuch ohne Gespraech |

Damit ist der Pruefstand aus Schritt 1 auch dann noch baubar, wenn die
`EVIDENCE_RETENTION_DAYS=7` in der DB abgelaufen sind. **Zieh dir trotzdem am Anfang
frische Kopien, falls seither weitere Anrufe stattgefunden haben.**
