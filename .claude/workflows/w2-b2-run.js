// PER-RUN-WRAPPER fuer Welle W2, Block B2 (Telefonie-Render, STT/TTS, Assistant-Pfad).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// 11 Tests: VOICE-05/09/12/18/19/22/23/24/25/29 + GAP-24. Realtime (VOICE-15/16) ist
// nach Owner-Entscheidung 7.14 aus dem Vorrat.

export const meta = {
  name: "w2-b2-run",
  description: "W2-B2: Telefonie-Render, STT/TTS, Assistant-Pfad (11 Katalogtests)",
  phases: [{ title: "W2-B2" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B2",
    phaseTitle: "Telefonie-Render, STT/TTS, Assistant-Pfad",
    branch: "phase/w2-b2-telefonie-render",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
