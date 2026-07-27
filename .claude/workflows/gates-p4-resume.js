// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P4, WIEDERAUFNAHME.
// Der Impl-Commit 3c7bb29 liegt bereits im Branch; der Lauf wurde am 2026-07-27 vom Lead
// gestoppt, weil 99 verwaiste Testserver die Maschine ueberhitzt hatten (Memory
// [[leaked-test-servers-overheat]]). Dieser Lauf holt Review + Self-Fix nach.
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// SPEICHER-DISZIPLIN: Die Wellen laufen ab jetzt SEQUENTIELL, eine Phase nach der anderen.
// Nie zwei Workflows gleichzeitig - jeder npm-test-Lauf startet Dutzende Server-Kinder.
//
// highStakes: Geld. P5 (Welle 3) bucht den hier uebernommenen monthly_cost MONATLICH.

export const meta = {
  name: "gates-p4-resume",
  description: "Gates W2/P4 (Wiederaufnahme): DID-Preis aus der Provider-Antwort - Review + Self-Fix",
  phases: [{ title: "GATES-P4" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P4",
    phaseTitle: "DID-Preis aus der Provider-Antwort (GAP-11, neu gefasst)",
    branch: "phase/gates-p4-did-preis",
    baseBranch: "5fe5980",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P4",
    gates: "GAP-11 in test/f1-provisioning-geo.test.js (laut Spec NEU GEFASST - das ist die einzige zulaessige Testaenderung dieser Phase)",
    maxFixRounds: 2,
    highStakes: true,
  },
);
