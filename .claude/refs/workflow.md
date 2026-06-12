# Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents (Task tool) liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One tack per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- This repo has no test framework: verify via `node --check` plus a smoke test
  against a locally started server (`SKIP_TWILIO_SIGNATURE_CHECK=true`, curl
  the affected routes) - see CLAUDE.md "Befehle"
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
