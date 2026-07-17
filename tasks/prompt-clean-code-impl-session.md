# Prompt für die nächste Session — PLAN-CLEAN-CODE.md umsetzen (eine Phase pro Lean-Workflow)

> In FRISCHE Session pasten (Lead bleibt dünn). Alles unterhalb der Linie ist der Prompt.
> Pro Session genau EINE Phase umsetzen, dann stoppen — danach neue Session für die nächste Phase.

---

Setze `PLAN-CLEAN-CODE.md` (Repo-Root) um: **eine Phase = ein `phase-impl-lean`-Lauf**.
Kein Big-Bang. Diese Session macht genau die **nächste offene Phase**, dann Stopp + kompakter Bericht.

## Kontext neu einlesen (nicht auf Zusammenfassungen verlassen)
- `PLAN-CLEAN-CODE.md` — die geordneten Phasen P0, P1–P7, P8 mit Wurzel, Fix, Tests, Pre-Mortem, DoD, **Safety-Review-Auflagen**.
- `CLAUDE.md` (Absolute Regeln, Pre-Mortem, Wurzel-statt-Symptom), `.claude/refs/clean-code.md`, `.claude/refs/workflow.md`.

## Welche Phase?
Reihenfolge: **P1 → P2 → P3 → P4 → P5 → P6 → P7**, dann **P8**. Nimm die erste, die laut Git-History / einem Status-Marker in `PLAN-CLEAN-CODE.md` noch nicht gemergt ist. **Prüfe den echten Git-Stand selbst** (`git log`, betroffene Dateien) — verlass dich nicht auf Memory/Annahmen.
**P0** (Vor-Lektüre der 15 geld-/sicherheitsnahen Dateien) ist nur nötig, BEVOR eine Phase Auth-Gate, Stripe-Webhook, Signaturprüfung, Tenant-Isolation oder Provisioning-/Billing-Trigger anfasst — P1–P4 i.d.R. nicht, kurz gegenprüfen.

## Ausführung (pro Phase)
1. Lies die **Phasen-Sektion** in `PLAN-CLEAN-CODE.md` und gib sie als Spec an den `phase-impl-lean`-Skill — **inklusive der „Safety-Review-Auflagen"** dieser Phase. Die Phase im per-run Skript **hart pinnen** (nicht args vertrauen).
2. **P1-BLOCKER (falls P1):** Der Integer-Cents-Umbau darf den KI-Kosten-Akkumulator **NIE pro Inkrement runden** (kein `Math.round` via `aiCostCents` fürs Live-Gate) — sonst fallen sub-Cent-Turns auf 0 und die KI-Kosten-Achse aller Budget-Prädikate wird blind. Feinere Ganzzahl-Einheit akkumulieren, nur an Vergleichs-/Melde-Kante runden. Test-Ground-Truth = präzise Summe (nicht per-Schritt gerundet) + Fall „viele sub-Cent-Turns über Cap → Gate greift".
3. **Modell-Politik:** Opus für Plan + Safety-/Verhaltens-Review, Sonnet für Impl/Clean-Code-Audit/Self-Fix/Report — an jedem `agent()` explizit pinnen (nie Fable erben).
4. **Clean-Code ist hartes Gate:** S1/S2 im dualen Review = Blocker, Self-Fix bis PASS.

## Guardrails (Absolute Regeln)
- Kein Vorschlag/Umbau darf ein Safety-/Auth-/Budget-/Offenlegungs-Gate aufweichen — nur härten. Offenlegungssatz, Signaturprüfung fail-closed, Audio nie über MCP bleiben unangetastet.
- **Merge im Lead** (nicht im Subagenten). **Kein `git add -A`** (Repo enthält sensible untracked Dateien) — nur gezielt die Phasen-Dateien adden. Force-Push nur `--force-with-lease`.
- **Kein `git stash`, solange `isolation:worktree`-Workflows laufen** (refs/stash ist worktree-geteilt).
- **Nicht deployen.** Nur committen/mergen, wenn Verifikation grün. Push (origin **und** upstream) nur, wenn der Owner es ausdrücklich sagt.
- **P6-Sonderfall:** trägt eine Deploy-Vorbedingung (Audit der Live-Render-Boolean-Env-Vars) — im Report festhalten, NICHT selbst deployen.

## Verifikation (Feedback-Loop, ohne Owner)
`node --check` je geänderte Datei, `npm test` grün (Baseline **2301/0** — keine neuen Fails/Skips), betroffene Grenzfall-Tests laut DoD der Phase. Wo Tests nicht greifen (echte Telefonie), Smoke-Test dokumentieren. Ein Task ist erst „done", wenn die DoD der Phase in dieser Session nachweislich erfüllt ist.

## Nach dem Merge
Markiere die Phase in `PLAN-CLEAN-CODE.md` als erledigt (kurze Status-Zeile mit Commit-SHA), damit die nächste Session die nächste offene Phase greift. Dann **stoppen** und kompakt berichten: umgesetzte Phase, Commit-SHA, Testergebnis, offene Auflagen/Follow-ups. Kein Doku-/Diff-Dump in den Chat.
