// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P10, WIEDERAUFNAHME.
// Impl-Commit e7435fd liegt im Branch; Lauf am 2026-07-27 vom Lead gestoppt (Ueberhitzung
// durch verwaiste Testserver, Memory [[leaked-test-servers-overheat]]).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Grenzen: nur src/mcp-tools.js. Die Tool-BESCHREIBUNGEN sind bewusst einsprachig englisch -
// das ist Absicht, kein Befund. Audio laeuft NIEMALS durch MCP, nur Transkripte/Status.

export const meta = {
  name: "gates-p10-resume",
  description: "Gates W2/P10 (Wiederaufnahme): MCP-Oberflaeche - Review + Self-Fix",
  phases: [{ title: "GATES-P10" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P10",
    phaseTitle: "MCP-Oberflaeche (MCP-14, LANG-15)",
    branch: "phase/gates-p10-mcp-oberflaeche",
    baseBranch: "5fe5980",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P10",
    gates: "MCP-14 in test/mcp-tools-i18n.test.js und LANG-15 in test/p15-mcp-tool-descriptions-en.test.js",
    maxFixRounds: 2,
    highStakes: false,
  },
);
