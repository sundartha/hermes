# Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents (Task tool) liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents — **aber siehe 2a: "mehr Rechenzeit" ist nicht gratis, und die Rechnung ist quadratisch**
- One tack per subagent for focused execution

### 2a. Was Subagenten kosten (Pflicht, nicht optional)

**Die Kostenformel ist `Kontextgroesse x Turns`.** Nicht die Menge produzierten Codes. Jede
Ausgabe, die einmal im Kontext eines Agenten liegt, wird bei JEDEM weiteren Turn erneut gelesen
und erneut bezahlt. Ein Agent, der doppelt so lange arbeitet mit doppelt so viel Kontext, kostet
das Vierfache.

Am 29.08.2026 gemessen, nachdem die Outbound-Kette entgleist war:

| | |
|---|---|
| ein einzelner Implementierungs-Agent | **447 Mio Token**, 955 Turns, ~467k Durchschnittskontext |
| davon Cache-Reads (reines Wiederlesen) | **99,7 %** — sein Produkt waren 48k Output |
| die Etappe E5 gesamt (19 Agenten) | 861 Mio |
| alle 118 Laeufe dieses Projekts | **12.757 Mio** |

**Die drei Regeln, die daraus folgen:**

1. **NIE woertliche Kommando-Ausgaben verlangen.** Kein "Kommando + Ausgabe woertlich". Ein
   Testlauf produziert >11.000 Zeilen; die liegen danach fuer immer im Kontext. Als Beleg
   genuegen Exit-Code und die Zeilen `# pass` / `# fail`. Das war der groesste Einzeltreiber:
   die per-run-Skripte steigerten sich ueber E1..E5 von 6 auf 12 solcher Forderungen.
2. **Die volle Suite laeuft EINMAL, am Ende, vom Lead** — nicht in jedem Agenten und nicht
   nochmal "SELBST" von jedem Reviewer. Waehrend der Arbeit laufen gezielte Testdateien.
3. **Agenten kurz halten.** Ab ~150 Turns ist ein Agent im teuren Bereich. Viele kleine mit
   frischem Kontext schlagen einen langen — die Kosten wachsen quadratisch mit der Lebensdauer.

**Nach JEDEM Workflow-Lauf die echten Kosten messen:**

```
node scripts/workflow-kosten.mjs            # juengste Laeufe
node scripts/workflow-kosten.mjs <lauf-id>  # je Agent, mit Turn-Warnung
```

**Die vom Workflow-Werkzeug gemeldete Zahl `subagent_tokens` ist als Kostenanzeige UNBRAUCHBAR** —
sie laesst die Cache-Reads weg und zeigt dadurch um Faktor ~200 zu wenig (gemeldet 3 Mio fuer
einen Lauf, der 861 Mio kostete). Genau daran ist es ein Monat lang niemandem aufgefallen: jede
Sitzung las die beruhigende Zahl und schrieb sie in die Uebergabe fuer die naechste. Eine
Kostenangabe, die nicht aus `workflow-kosten.mjs` stammt, ist nicht zu glauben und nicht
weiterzureichen.

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- This repo uses `node:test` (`npm test`, runs offline and without `.env`):
  new behavior needs a test. Additionally verify via `node --check` and, where
  tests cannot cover it (real telephony, dashboard), a smoke test against a
  locally started server (`SKIP_TWILIO_SIGNATURE_CHECK=true`, curl the
  affected routes) - see CLAUDE.md "Befehle"
- Diff behavior between master and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Check server logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing checks - then resolve them
- Zero context switching required from the user
- Telephony bugs reproduce locally without real calls (see CLAUDE.md
  "Wurzel statt Symptom")

### 7. Deterministic Outcome + Feedback Loop (Pflicht bei autonomer Arbeit)

- NO task starts without two things written down upfront (in `tasks/todo.md`):
  1. **Expected result, deterministic and checkable** - not "improve X" but
     "request Y returns status Z / output contains W". If you cannot state the
     expected result as a check, the task is not ready to start.
  2. **Verification method** - the exact command or test that proves the result
     (e.g. `npm test`, a curl call with expected status code, a log line).
- The verification method IS your feedback loop: run it, compare against the
  expected result, fix, run again - iterate WITHOUT user involvement until it
  passes or you are provably blocked.
- A task is only "done" when its verification passed in this session and the
  result is recorded next to the todo item (command + observed output).
- If the verification itself cannot be built (needs accounts, real phone calls,
  deployed infra), the task is NOT autonomous - park it and flag it for the user.

# Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items -
   every item carries its expected result and verification method (see rule 7)
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

# Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Safety First (repo-specific)**: Any change touching calls, SMS, auth or
  budget gates is automatically non-trivial - plan mode + smoke test mandatory.
