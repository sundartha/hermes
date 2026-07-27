// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P4 (DID-Preis aus der Provider-Antwort, GAP-11).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// Vorbedingung erfuellt: P3 (Kauf-Land-Tabelle) ist gemergt.
//
// highStakes: Geld. P5 in Welle 3 bucht den hier uebernommenen monthly_cost MONATLICH -
// ein falscher Betrag wird also nicht einmal, sondern dauerhaft vervielfacht.
//
// EINZIGE zulaessige Testaenderung der Phase (PLAN-GATES.md Abschnitt 7, Owner-Entscheidung
// 2026-07-27): der GAP-11-Test in test/f1-provisioning-geo.test.js wird NEU GEFASST - der
// Hold ist der Preis aus der Provider-Antwort statt ein Tabelleneintrag. Jede weitere
// Testaenderung ist ein Blocker.

export const meta = {
  name: "gates-p4-run",
  description: "Gates W2/P4: DID-Preis aus der Provider-Antwort statt Tabellen-Schaetzung",
  phases: [{ title: "GATES-P4" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P4",
    phaseTitle:
      'DID-Preis aus der Provider-Antwort (Spec: Abschnitt "P4" in tasks/gates-fix-chain.md; Abnahme: GAP-11 in test/f1-provisioning-geo.test.js gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/ - ein Diff nur an test/ ist ein Fehlschlag der Phase. Zulaessige Testaenderung: NUR das Neufassen des GAP-11-Tests laut PLAN-GATES.md Abschnitt 7)',
    branch: "phase/gates-p4-did-preis",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
