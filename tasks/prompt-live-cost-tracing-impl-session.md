# Prompt fuer die naechste Session — Umsetzung PLAN-LIVE-COST-TRACING

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.
Grund fuer "frisch": der Lead muss ueber die ganze Kette duenn bleiben. Startest du in
einer Session, die schon Kontext traegt, ist der Vorteil weg.

---

Setze `PLAN-LIVE-COST-TRACING.md` um — **Phase fuer Phase, je ein Workflow pro Phase**.
Lies das Dokument zuerst vollstaendig; es ist die Arbeitsgrundlage und setzt keinen
Gespraechskontext voraus. Alle acht Owner-Entscheidungen sind darin bereits getroffen
(Kapitel 8), es gibt nichts mehr zu klaeren, was den Zuschnitt betrifft.

Stand: `master @ 89d8ef9`. Der Plan ist committet, **nichts davon ist umgesetzt**.

## Deine Rolle: Lead, und zwar duenn

Das ist die wichtigste Regel dieses Prompts. Du orchestrierst, du implementierst nicht.

- **Du liest NIE Quellcode.** Kein `Read` auf `src/**`, kein `grep` durch die Implementierung.
  Der Grund ist nicht Bequemlichkeit: sobald du Code liest, waechst dein Kontext, und ab
  ca. 100k Token faellt die Orchestrierung auseinander. Was du ueber den Code wissen musst,
  steht im Plan oder kommt aus dem Rueckgabewert eines Agenten.
- **Du liest die Phasen-Beschreibung im Plan, den Workflow-Rueckgabewert und `git diff --stat`.**
  Mehr nicht.
- **Erlaubte Ausnahmen** (das ist Verifikation, nicht Implementierung): `git diff --stat`,
  `git log --oneline`, `npm test`-Ausgabe, `node --check`, `curl` gegen einen lokal
  gestarteten Server.
- Nach jeder Phase: kurzer Statusbericht an den Owner (3-5 Zeilen), dann weiter.

## Der Ablauf je Phase

Fuer JEDE Phase genau ein Workflow-Aufruf, sequenziell, nicht parallel. Phasen bauen
aufeinander auf; zwei gleichzeitig laufende Worktrees auf denselben Dateien sind ein
Merge-Konflikt mit Extraschritten.

Nutze das `phase-impl-lean`-Skill, wenn es passt — sonst baue den Workflow selbst nach
dieser Form:

1. **Plan** (Opus): liest die Phase im Dokument und die betroffenen Dateien, entwirft die
   konkrete Aenderung. Gibt eine Datei-fuer-Datei-Anweisung zurueck, keinen Code.
2. **Impl** (Sonnet, `isolation: 'worktree'`): setzt um, schreibt die Tests, laesst
   `npm test` laufen. Fail-closed: kommt die Suite nicht gruen, meldet der Agent das,
   statt Tests abzuschalten oder zu ueberspringen.
3. **Dualer Review, parallel:**
   - **Safety/Verhalten** (Opus, hoher Effort): prueft gegen die Absoluten Regeln aus
     CLAUDE.md. Schwerpunkt: wird ein Gate geschwaecht, entsteht ein fail-open-Pfad
     (null/undefined/NaN/Timeout/leere Historie darf NIE "keine Grenze" heissen), ist
     der Zwischenstand nach dieser Phase sicher?
   - **Clean-Code** (Sonnet): prueft gegen `.claude/refs/clean-code.md`. S1/S2 sind
     harte Blocker. Magic Numbers ausser 0/1/-1, tote Schalter ohne Entfernungs-Phase,
     Verschachtelung > 4, Funktionen > 100 Zeilen, Argumente > 3, abgeschaltete Sicherungen.
4. **Self-Fix** (Opus) -> zurueck zu 3, bis beide PASS. Deckel bei 3 Runden; danach geht
   der Rest dokumentiert in den Report und du entscheidest, ob gemergt wird.
5. **Report** (Sonnet): schreibt `tasks/lct-<phase>-report.md` und gibt dir maximal
   20 Zeilen zurueck.

**Modell-Pins explizit pro `agent()` setzen — nie erben lassen.** Opus fuer Plan,
Safety-Review und Self-Fix; Sonnet fuer Impl, Clean-Code-Audit und Report. Ein Agent, der
das Session-Modell erbt, kann auf einem kleinen Modell landen und liefert dann Fassade
statt Arbeit.

**Die Phase im Skript hart pinnen.** Schreibe die Phasennummer als Literal in das
per-run-Skript, nicht ueber `args`. Es hat schon Faelle gegeben, in denen `args` daneben
ging und der Workflow die falsche Phase baute.

## Merge-Protokoll (nicht abkuerzen)

Der Merge passiert bei dir im Lead, nie im Workflow.

1. `git diff --stat <branch>` — **vor JEDEM Merge, ausnahmslos.** Ein Workflow kann PASS
   melden und trotzdem einen leeren Branch hinterlassen (toter Impl-Agent, Review lief
   gegen den unveraenderten Bestand). PASS ist keine Merge-Freigabe, ein Diff ist eine.
2. `npm test` nach dem Merge im Hauptbaum.
3. Erst dann die naechste Phase starten.

**Zwei Fallen mit Worktrees, beide schon eingetreten:**
- `refs/stash` ist zwischen Worktrees GETEILT. Waehrend ein `isolation: 'worktree'`-Workflow
  laeuft, **niemals `git stash`** — der Stash wird geklobbert.
- Untrackte Dateien im Hauptbaum werden von Worktree-Branches ueberschrieben. Wenn etwas
  Untracktes wichtig ist, committe es vorher.

**`git add -A` ist in diesem Repo verboten.** Es zieht 200+ Dateien inklusive Fremdmaterial
in den Commit. Immer die geaenderten Dateien einzeln adden.

## Test-Disziplin

- Neues Verhalten braucht einen Test. Der Plan nennt je Phase einen **Rot-vor-Fix-Test**:
  dieser Test muss VOR der Aenderung nachweislich rot sein. Laesst der Impl-Agent das aus,
  ist die Phase nicht fertig — ein Test, der nie rot war, beweist nichts.
- **Jede neue Env-Variable muss in `BASE_ENV` in `test/helpers.js` nachgezogen werden**,
  sonst leckt die lokale `.env` in die Spawn-Tests und die Suite wird unzuverlaessig.
- Es gibt einen vorbestehenden Flake unter Voll-Last (ca. 12 %, Seed-vor-Boot-Race).
  **Ein roter Test zaehlt nur als echt rot, wenn er isoliert ebenfalls rot ist.** Erst
  einzeln nachfahren, dann urteilen.

## Reihenfolge und was blockiert ist

Arbeite die Phasen in der Reihenfolge aus Kapitel 7 ab. Zwei Dinge musst du wissen:

- **P6 hat eine harte Vorbedingung ausserhalb dieses Plans:** `MAX_BUDGET_EUR` muss
  angehoben sein, bevor P6 ausgeliefert wird (Entscheidung 8). Heute steht der
  Plattform-Deckel auf 800 Cent, die entschiedene Business-Decke betraegt 900 Cent — P6
  laesst sich ohne die Anhebung nicht regelkonform ausliefern und wuerde am Boot-Guard
  fatal scheitern. **Frag den Owner, ob die Anhebung erfolgt ist, bevor du P6 startest.**
- **P2 beruehrt das DB-Schema.** `hermes-db` lief am 2026-07-24 ab — pruefe den aktuellen
  Stand der Datenbank, bevor du eine Migration planst.
- Der Rueckbau des Telnyx-Assistant-Pfads (Entscheidung 5) ist **Folgearbeit ausserhalb
  dieser Kette** und blockiert nichts. Erst wenn er gemergt ist, darf die Vollkostenschwelle
  `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` von 10 auf 5 EUR-Cent sinken. Ausloeser ist der
  gemergte Rueckbau, nicht die Absicht.

## Umgebungs-Randbedingungen (nicht dagegen planen)

- Render **Free Tier**: kein Cron, kein preDeploy, keine Shell. Migrationen laufen bei
  `migrate()` im DB-Connect.
- Der Live-Dienst ist **Dashboard-managed**, `render.yaml` ist nur Doku, und **`autoDeploy`
  steht auf `no`** — ein Push deployt NICHTS, der Deploy wird manuell ausgeloest.
- **Deploy-Remote ist `upstream` (jonas986), nicht `origin`.** `git push origin` macht
  nichts live. Nach einem Deploy den Live-Commit am `[boot]`-Banner pruefen.
- Secrets liegen in `.env` (lokal) bzw. im Render-Dashboard, die Prod-DB-URL in
  `~/.config/hermes/db-url`. Unter `FORCE ROW LEVEL SECURITY` liefert ein naives SELECT
  **0 Zeilen** — pro Tenant `set app.current_tenant = '<id>'` setzen; `tenant` selbst hat
  keine RLS.
- **In dieser Kette wird nicht deployt**, ausser der Owner sagt es ausdruecklich. Merges auf
  `master` sind in Ordnung, das Ausliefern ist eine eigene Entscheidung.

## Was diese Kette besonders macht

Es geht um den Geld-Pfad. Drei Dinge, an denen die Reviews in der Planungsphase echte
Defekte gefangen haben — erwarte sie wieder:

1. **Ueberbuchung ist fail-closed, Unterbuchung ist es nicht.** Wenn du im Zweifel bist,
   welche Rundung oder welcher Default richtig ist: die vorsichtige Richtung ist die,
   die mehr bucht, nicht weniger.
2. **Keine Floats auf dem Geld-Pfad.** Der Bestand rechnet in Mikro-Cent mit
   `Math.floor` und `%` auf Ganzzahlen (Muster `trackUsage` in `src/store/state-ops.js`).
   Rest-Uebertraege werden nie verworfen, und sie werden nur ZUSAMMEN mit der Buchung
   fortgeschrieben.
3. **USD und EUR nicht vermischen.** Alle Provider-Messwerte sind USD-Cent, alle Tarife
   und Deckel im Repo sind EUR-Cent. Jede Stelle, die beide zusammenbringt, braucht den
   Kurs `PROVIDER_TO_BUCKET_RATE_MICRO` — das war in der Planungsphase zweimal die Wurzel
   eines Befundes.

## Wenn etwas nicht aufgeht

Melde es dem Owner, statt es zu umgehen. Konkret: ein Workflow, der nach drei Runden nicht
PASS liefert; eine Phase, deren Rot-vor-Fix-Test sich nicht rot bekommen laesst; ein Befund,
der zeigt, dass die Phase im Plan so nicht baubar ist. Das sind Ergebnisse, keine Fehler —
der Plan ist eine Hypothese, und die Umsetzung darf sie falsifizieren.
