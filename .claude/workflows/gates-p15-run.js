// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P15 (Deploy-Filter, GAP-37).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Die kleinste Phase der Kette - und die mit dem groessten Kollateralrisiko, wenn sie
// ausufert: in render.yaml darf AUSSCHLIESSLICH buildFilter.ignoredPaths geaendert werden.
// Jede weitere Zeile ist ein Blocker (der Blueprint wuerde sonst z.B. Multi-Tenancy
// abschalten).
//
// Erwartungsmanagement: die Phase hat KEINE Live-Wirkung. Gemessen am Live-Dienst
// (2026-07-27): der Gateway steht auf autoDeploy=no, und ein buildFilter wirkt nur auf
// Auto-Deploys - er wirkt hier also gar nicht; jeder manuelle Deploy baut apps/web ohnehin.
// Das ist reine Blueprint-Kohaerenz. Und: die Render-Services sind DASHBOARD-managed
// (Live != render.yaml), diese Aenderung geht also nicht "live", sie macht die Datei ehrlich.
//
// EINZIGE zulaessige Testaenderung (PLAN-GATES.md Abschnitt 7): der W0-Test in
// test/render-buildfilter.test.js neu fassen - er prueft heute an derselben Zeile das
// GEGENTEIL von GAP-37.

export const meta = {
  name: "gates-p15-run",
  description: "Gates W3/P15: Deploy-Filter im Blueprint kohaerent machen (GAP-37)",
  phases: [{ title: "GATES-P15" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P15",
    phaseTitle:
      'Deploy-Filter (Spec: Abschnitt "P15" in tasks/gates-fix-chain.md; Abnahme: GAP-37 gruen via "npm run test:gates", "npm test" mit fail=0, und der Diff beruehrt render.yaml. In render.yaml AUSSCHLIESSLICH buildFilter.ignoredPaths aendern - jede weitere Zeile ist ein Blocker. Zulaessige Testaenderung: NUR der W0-Test laut PLAN-GATES.md Abschnitt 7)',
    branch: "phase/gates-p15-deploy-filter",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
