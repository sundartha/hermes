// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P2 (Wechselkurs, eine Quelle, GAP-08 x2).
// WIEDERAUFNAHME: der Impl-Commit e3a8733 liegt bereits auf dem Branch; Review und Self-Fix
// starben mit dem Rechner-Absturz am 2026-07-27 (der leere -fix1-Branch war der Beleg, dass
// eine Fix-Runde lief). Dieser Lauf holt Review + Self-Fix nach, ohne neu zu implementieren.
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// highStakes: Geld. Zwei Wahrheiten fuer denselben USD/EUR-Kurs (0.93 als Literal gegen
// 920000 Mikro) ergeben fuer denselben Dollar verschiedene Euro. Welcher Wert der neue
// gemeinsame Default wird, ist eine bewusste Entscheidung und gehoert in den Bericht.
// Achtung Test-BASE_ENV-Drift: eine neue config-Env-Var MUSS in test/helpers.js nachgezogen
// sein, sonst leakt die lokale .env in die Spawn-Tests.

export const meta = {
  name: "gates-p2-resume",
  description: "Gates W1/P2 (Wiederaufnahme): Wechselkurs aus einer Quelle - Review + Self-Fix",
  phases: [{ title: "GATES-P2" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P2",
    phaseTitle: "Wechselkurs - eine Quelle (GAP-08 x2)",
    branch: "phase/gates-p2-fx-single-source",
    baseBranch: "master",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P2",
    gates: "die beiden GAP-08-Tests in test/fx-single-source*.test.js",
    maxFixRounds: 2,
    highStakes: true,
  },
);
