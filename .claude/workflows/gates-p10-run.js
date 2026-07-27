// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P10 (MCP-Oberflaeche, MCP-14 + LANG-15).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// Grenzen: nur src/mcp-tools.js. Die Tool-BESCHREIBUNGEN sind bewusst einsprachig englisch
// (src/mcp-tools.js Kopfkommentar) - das ist kein Befund, sondern Absicht. Und: Audio laeuft
// NIEMALS durch MCP, nur Transkripte/Status.
//
// EINZIGE zulaessige Testaenderung (PLAN-GATES.md Abschnitt 7): EXPECTED_MARKERS in
// test/p15-mcp-tool-descriptions-en.test.js - dort ist der entfernte language-Parameter
// als Marker gelistet.

export const meta = {
  name: "gates-p10-run",
  description: "Gates W2/P10: MCP-Oberflaeche - Stufe-0-Text und wirkungsloser language-Parameter",
  phases: [{ title: "GATES-P10" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P10",
    phaseTitle:
      'MCP-Oberflaeche (Spec: Abschnitt "P10" in tasks/gates-fix-chain.md; Abnahme: MCP-14 in test/mcp-tools-i18n.test.js und LANG-15 in test/p15-mcp-tool-descriptions-en.test.js gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: NUR EXPECTED_MARKERS laut PLAN-GATES.md Abschnitt 7)',
    branch: "phase/gates-p10-mcp-oberflaeche",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
