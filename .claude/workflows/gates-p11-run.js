// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P11 (Telefonie-Kleinvertraege, GAP-24 + GAP-26).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// EINZIGE zulaessige Testaenderung (PLAN-GATES.md Abschnitt 7): der Byte-Identitaets-Test
// ueber test/telnyx-p8-inbound.test.js - er pinnt den Aufruf OHNE language, die Kopplung
// steht im Testkommentar daneben.
//
// Der Live-Pfad ist die BUDGET-Engine, nicht Realtime. Inbound-STT ist an dieser Stelle
// schon einmal gestolpert (fehlender transcriptionEngine im Telnyx-Gather) - der Sprach-Hint
// am Assistant-Start ist genau dieselbe Achse.

export const meta = {
  name: "gates-p11-run",
  description: "Gates W3/P11: Sprach-Hint am Inbound-Assistant + maschinenlesbares Cap-Merkmal",
  phases: [{ title: "GATES-P11" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P11",
    phaseTitle:
      'Telefonie-Kleinvertraege (Spec: Abschnitt "P11" in tasks/gates-fix-chain.md; Abnahme: GAP-24 und GAP-26 gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: NUR der Byte-Identitaets-Test laut PLAN-GATES.md Abschnitt 7)',
    branch: "phase/gates-p11-telefonie-vertraege",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
