// PER-RUN-WRAPPER fuer Welle W2, Block B1 (Sprach-Aufloesung und Prompt-Schicht, 16 Tests).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// highStakes=false: reiner Testbau gegen eine fertige Spec, kein Produktionscode
// (Regel R-A in 18-w2-scope.md). Der Safety-Review bleibt auf opus/high.

export const meta = {
  name: "w2-b1-run",
  description: "W2-B1: Sprach-Aufloesung und Prompt-Schicht (16 Katalogtests)",
  phases: [{ title: "W2-B1" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B1",
    phaseTitle: "Sprach-Aufloesung und Prompt-Schicht",
    branch: "phase/w2-b1-sprache-prompts",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
