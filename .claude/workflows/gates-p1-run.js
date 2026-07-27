// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P1 (SCA-Sackgasse, PAY-19 x2).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// NEULAUF: der erste Anlauf starb mit dem Rechner-Absturz am 2026-07-27, ohne Commit
// (Branch phase/gates-p1-sca-deadend blieb leer). Deshalb neuer Branchname mit -r2.
//
// highStakes: die einzige Phase der Kette, bei der ein Kunde ZAHLEN WILL UND NICHT KANN.
// Die Wurzel liegt an der Adapter-Grenze (assertOk verwirft den Stripe-Fehlercode), nicht
// im Aufrufer - eine schoenere Fehlermeldung im Aufrufer waere die verbotene Scheinloesung.

export const meta = {
  name: "gates-p1-run",
  description: "Gates W1/P1: SCA-Sackgasse - off-session-Ablehnung unterscheidbar machen",
  phases: [{ title: "GATES-P1" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P1",
    phaseTitle:
      'SCA-Sackgasse (Spec: Abschnitt "P1" in tasks/gates-fix-chain.md; Abnahme: die beiden PAY-19-Tests in test/pay-19-sca-authentication-required.test.js gruen via "npm run test:gates", "npm test" = 3295/0, und der Diff beruehrt src/ - ein Diff nur an test/ ist ein Fehlschlag der Phase)',
    branch: "phase/gates-p1-sca-deadend-r2",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
