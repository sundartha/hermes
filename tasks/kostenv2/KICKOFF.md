# Kickoff: PLAN-KOSTEN-V2 als Lean Lead autonom durchziehen

Kopiere alles unterhalb der Linie als ersten Prompt einer FRISCHEN Session.

---

Du bist **Lead** fuer die Kette KV2-1..KV2-10 aus `tasks/PLAN-KOSTEN-V2.md`. Ziel der Kette:
alle Kosten eines Anrufs (ElevenLabs + Telnyx + eigene LLM-/Recherche-Achsen) vollstaendig
je Tenant erfassen und vom Guthaben abbuchen.

## Deine Rolle: duenn bleiben

**Du liest KEINEN Quellcode, KEINE Diffs und NICHT den Plan im Fliesstext.** Das ist die
tragende Regel, nicht eine Praeferenz - dein Kontext soll am Ende unter 100k liegen. Du
liest ausschliesslich: kompakte Workflow-Returns, kurze `git`-Ausgaben, und die
Phasen-UEBERSCHRIFTEN. Die Subagenten lesen den Code.

Wie du eine Phase uebergibst, ohne sie zu lesen - schneide sie mit `sed` direkt in eine
Datei, niemals nach stdout:

```bash
grep -n "^## KV2-\|^### KV2-" tasks/PLAN-KOSTEN-V2.md      # nur Ueberschriften + Zeilennummern
sed -n '<von>,<bis>p' tasks/PLAN-KOSTEN-V2.md > tasks/kostenv2/spec-kv2-<N>.md
wc -l tasks/kostenv2/spec-kv2-<N>.md                        # Kontrolle, dass es nicht leer ist
```

Der Inhalt landet in der Datei, nicht in deinem Kontext. Den Pfad reichst du als
`specFile` weiter.

## Einmalige Vorbereitung (vor der ersten Phase)

1. `git status --porcelain` und `git log --oneline -3`. Bist du auf `master`, **branche vor
   jeder Aenderung**.
2. `npm test` EINMAL - muss gruen sein. Rot heisst: erst reparieren, nicht bauen.
   (`npm run test:gates` und `npm run test:abnahme` DUERFEN rot sein, das sind
   Produktbefund-Baenke, keine Regressionsfaenger.)
3. Modell-Pins pruefen: `grep -c "agent(" .claude/workflows/phase-impl-lean.js` gegen
   `grep -c "model:" .claude/workflows/phase-impl-lean.js`. Fehlen Pins, lege eine
   per-run-Kopie unter `.claude/workflows/runs/` an und setze sie: **Opus** fuer Plan und
   Safety-Review, **Sonnet** fuer Implementierung, Clean-Code-Audit, Self-Fix und Report.
   Vererbung ist ein Kostenfehler, kein Default.

## Je Phase, immer gleich

```
Workflow({
  scriptPath: ".claude/workflows/phase-impl-lean.js",   // oder deine per-run-Kopie
  args: {
    phaseId: "KV2-<N>",
    phaseTitle: "<Titel aus der Ueberschrift>",
    branch: "phase/kv2-<n>-impl",
    baseBranch: "master",
    planDoc: "tasks/PLAN-KOSTEN-V2.md",
    specFile: "tasks/kostenv2/spec-kv2-<N>.md",
    maxFixRounds: 2
  }
})
```

`args` muss ein **echtes Objekt** sein - ein Fliesstext-String parst zu `null` und der
Workflow bricht fail-closed ab. Der lange Auftragstext gehoert in die `specFile`, nicht in
`args`.

Nach jedem Lauf, in dieser Reihenfolge:

1. **Kosten messen:** `node scripts/workflow-kosten.mjs <lauf-id>`. Die Zahl aus dem
   Workflow-Return (`subagent_tokens`) ist um Faktor ~40-200 zu niedrig - **glaube sie
   nie und reiche sie nie weiter.** Nur diese Messung zaehlt.
2. **Echten Stand pruefen, nicht das Return-Feld:** `git log --oneline <finalBranch> -3`
   und `git diff --stat master..<finalBranch>`. Ein PASS des Workflows ist **keine**
   Merge-Freigabe.
3. **Mergen im Lead**, klein: `git merge --no-ff <finalBranch>`. Merge `finalBranch`, NICHT
   blind `branch` - der kann `-fix1`/`-fix2` heissen.
4. `npm test` einmal im Lead nach dem Merge.

## Die Fallen, die diese Kette schon gekostet haben

- **Eine Bahn zur Zeit.** Nie zwei Workflows parallel, nie ein eigener `npm test` waehrend
  ein Workflow laeuft. Gemessen: Load 32 auf 15 Kernen, Rechner unbenutzbar.
- **Nicht mergen, waehrend eine Welle laeuft** - ein neuer master-Commit macht den
  laufenden Worktree stale und blockiert ihn mit einer falschen Begruendung.
- **Worktree auf veraltetem Commit:** erst `git checkout -b <branch> master`, DANN lesen.
- **Abgebrochener Lauf hinterlaesst einen kollidierenden Branch** - der naechste Lauf weicht
  still auf `-impl` aus. Vor dem Neustart aufraeumen.
- **`git add -A` ist hier verboten.** Dateien einzeln adden, vorher auf Secrets/PII pruefen.
  Force-Push nur `--force-with-lease`.
- **`refs/stash` ist worktree-GETEILT** - ein Stash aus einem Worktree klobbert den anderen.
- **Neue Env-Variable? Sofort in `BASE_ENV`** der Testhilfen, sonst leakt die echte `.env`
  in Spawn-Tests.
- **Roter Test = Behauptung, kein Beweis.** Das SOLL-Setup eines Tests kann prod-fremd sein.
  Isoliert nachfahren, bevor du ihn glaubst.
- **Deploy:** `git push origin` macht NICHTS live. Render deployt den UPSTREAM
  (`jonas986`). Erst pushen/deployen, wenn der Owner es sagt.

## Wann du STOPPST und fragst

- Der Workflow meldet nach `maxFixRounds` weiter BLOCKED.
- `npm test` ist nach einem Merge rot und der Grund ist nicht in einer Minute klar.
- Eine Phase will ein Safety-Gate anfassen (Verifikation als Outbound-Permit,
  `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, **pro-Tenant-Kostendecke**,
  Max-Gespraechsdauer, Provider-Signatur), den Offenlegungssatz oder `callee_is_owner`.
- **Vor KV2-8.** Das ist der Geld-Umschalter: bis einschliesslich KV2-7 bewegt die Kette
  per Abnahmekriterium keinen Cent, ab KV2-8 schon. Melde dich beim Owner, bevor du ihn
  faehrst - auch wenn KV2-1..KV2-7 glatt liefen.

## Entscheidungslage (nicht neu aufmachen)

Abschnitt 7 des Plans: Punkte **1-9 und 13 sind vom Owner entschieden** (2026-08-30).
Punkte **10, 11, 12, 14, 15, 16 laufen auf ihrem dokumentierten Default** und sind so
gekennzeichnet - der Phasenbericht vermerkt das als Default, nicht als Entscheidung. Wenn
eine Phase einen dieser Punkte scharf stellt, ist das ein Grund zur Rueckfrage, kein
Grund zur eigenen Festlegung.

## Wenn eine Abnahme-/Review-Schleife nicht auf PASS kommt

Steuere nach der **Schwere** der Funde, nicht nach ihrer Zahl. Liefern zwei Runden
nacheinander nur noch Textkorrekturen (Zeilenverweise, Zahlen-Nachzug, Formulierung),
ist Schluss - Restmaengel sind ein normales Uebergabeartefakt und werden benannt
weitergereicht. Das Selbsturteil eines Kritikers ("danach ist es abnahmefaehig") ist
**kein** Konvergenzsignal; in der Vorsession kam es dreimal und war dreimal zu frueh.
Bei Geld-/Sicherheitspfaden eine Runde laenger als sonst.

## Am Ende der Kette (Pflicht, in den Merge-Commit)

Prozessmuell der gemergten Phasen loeschen: `tasks/kv2-*-report.md`,
`-workflow-report.md`, die `spec-kv2-*.md`, verbrauchte Kickoffs und die per-run-Skripte
aus `.claude/workflows/runs/` (die neueste Kopie bleibt als Vorlage). **Reihenfolge ist
nicht optional:** untrackte Doku erst committen, dann loeschen. Behalten:
`tasks/PLAN-KOSTEN-V2.md`, die vier `tasks/kostenv2/befund-*.md` (die Beweislage),
`tasks/kostenv2/AUFTRAG.md`, `tasks/lessons.md`.

Melde am Schluss: gemergte Phasen, Testlage, **gemessene** Gesamtkosten, offene Punkte.
