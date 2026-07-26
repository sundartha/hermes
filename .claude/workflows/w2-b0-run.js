// PER-RUN-WRAPPER fuer Welle W2, Block B0 (Re-Baseline + GAP-27).
// Die Phase ist hier HART GEPINNT, nicht ueber args uebergeben - Lehre aus den
// frueheren args-Misfires (Memory [[phase-impl-workflow-args]]): ein Lead-seitiger
// Tippfehler in args baut sonst lautlos die falsche Phase.
//
// highStakes=true ist Absicht: B0 liefert die Baseline, auf der die sieben Folgebloecke
// ihre Erwartungen formulieren. Ein oberflaechlicher Durchlauf hier vergiftet W2 komplett.

export const meta = {
  name: "w2-b0-run",
  description: "W2-B0: Re-Baseline der 102 W2-Tests + GAP-27 (Abbruchpunkt der Welle)",
  phases: [{ title: "W2-B0" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B0",
    phaseTitle: "Re-Baseline und GAP-27",
    branch: "phase/w2-b0-baseline-gap27",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
