// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P8 (Geo-Backfill-Migration, GAP-34 x2).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// NEULAUF: der erste Anlauf starb mit dem Rechner-Absturz am 2026-07-27, ohne Commit
// (Branch phase/gates-p8-geo-backfill blieb leer). Deshalb neuer Branchname mit -r2.
//
// highStakes: Migration. Der Schaden waere STILL - eine zu breite Migration ueberschreibt
// eine explizit gesetzte Tenant-Sprache, der Agent spricht danach die falsche Sprache und
// niemand sieht einen Fehler. Owner-Vorgaben (nicht von der Phase entscheidbar): nur Zeilen
// mit Altwert `de` UND bekanntem Land; ohne e164-Anker bleibt das Feld leer; zweimal
// hintereinander lauffaehig.

export const meta = {
  name: "gates-p8-run",
  description: "Gates W1/P8: Geo-Backfill-Migration fuer Bestandsnummern (idempotent)",
  phases: [{ title: "GATES-P8" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P8",
    phaseTitle:
      'Geo-Backfill-Migration (Spec: Abschnitt "P8" in tasks/gates-fix-chain.md; Abnahme: die beiden GAP-34-Tests in test/f1-geo-store.test.js gruen via "npm run test:gates", "npm test" = 3295/0, und der Diff beruehrt src/ - ein Diff nur an test/ ist ein Fehlschlag der Phase)',
    branch: "phase/gates-p8-geo-backfill-r2",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
