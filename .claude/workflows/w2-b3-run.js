// PER-RUN-WRAPPER fuer Welle W2, Block B3 (Wahlziel-Normalisierung und Gate-Kette).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// 14 Tests: OUT-03/12/14/15/16/17/18/22/23/27/28 + FMT-20/21/22.
//
// WARNUNG an den Impl-Agenten (steht auch in der Spec): dieser Block fasst die
// Gate-Kette an - die Tests duerfen sie BESCHREIBEN, nie aufweichen. Kein Test darf
// ein Gate abschalten, ueberspringen oder per Env neutralisieren, um gruen zu werden.
// OUT-18 ist eine Aussage ueber die TESTSUITE selbst und altert mit W2 - beim Bau als
// Momentaufnahme kennzeichnen (Baseline 19-w2-baseline.md 3.7).

export const meta = {
  name: "w2-b3-run",
  description: "W2-B3: Wahlziel-Normalisierung und Gate-Kette (14 Katalogtests)",
  phases: [{ title: "W2-B3" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B3",
    phaseTitle: "Wahlziel-Normalisierung und Gate-Kette",
    branch: "phase/w2-b3-wahl-gates",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
