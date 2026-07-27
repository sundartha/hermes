// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P13 (Dashboard apps/web: WEB-07, WEB-19, GAP-30).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// NEULAUF: der erste Anlauf starb mit dem Rechner-Absturz am 2026-07-27, ohne Commit
// (Branch phase/gates-p13-dashboard-web blieb leer). Deshalb neuer Branchname mit -r2.
//
// Grenzen dieser Phase: nur das DASHBOARD (/app) in apps/web, nicht die Marketing-Seiten
// (die laufen ueber staging, docs/RUNBOOK-LAB-LIVE.md). /app bleibt englisch. public/tenant.html
// NICHT anfassen - die Datei loescht P14 in der naechsten Welle. Und: privateNumber ist ein
// sensibles Feld; die Absendernummer ist IMMER eine Provider-DID, nie die Privatnummer.

export const meta = {
  name: "gates-p13-run",
  description: "Gates W1/P13: Dashboard apps/web - agentStyle, privateNumber, eine Feldliste",
  phases: [{ title: "GATES-P13" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P13",
    phaseTitle:
      'Dashboard apps/web (Spec: Abschnitt "P13" in tasks/gates-fix-chain.md; Abnahme: WEB-07, WEB-19 und GAP-30 in test/dashboard-i18n-surface.test.js gruen via "npm run test:gates", "npm test" = 3295/0, und der Diff beruehrt apps/ - ein Diff nur an test/ ist ein Fehlschlag der Phase)',
    branch: "phase/gates-p13-dashboard-web-r2",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
