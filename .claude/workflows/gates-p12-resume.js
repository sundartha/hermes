// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P12, WIEDERAUFNAHME.
// Impl-Commit 0ec0894 liegt im Branch; Lauf am 2026-07-27 vom Lead gestoppt (Ueberhitzung
// durch verwaiste Testserver, Memory [[leaked-test-servers-overheat]]).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// P12 laeuft VOR P14 (Welle 3), das dieselbe Datei src/self-service-routes.js loescht bzw.
// umbaut. Achtung Auth-Pfad: src/web-auth.js gehoert zur Dateiliste - Auth bleibt
// fail-closed, Credential-Vergleiche timing-sicher, eine Textaenderung darf den
// Kontrollfluss nicht anfassen. Kein Secret und keine Session-Kennung im neuen Klartext.

export const meta = {
  name: "gates-p12-resume",
  description: "Gates W2/P12 (Wiederaufnahme): sprachneutrale Server-Klartexte - Review + Self-Fix",
  phases: [{ title: "GATES-P12" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P12",
    phaseTitle: "Deutsche Klartexte am Server (WEB-10, WEB-13)",
    branch: "phase/gates-p12-server-klartexte",
    baseBranch: "5fe5980",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P12",
    gates: "WEB-10 in test/self-service-error-codes.test.js und WEB-13 in test/web-auth.test.js",
    maxFixRounds: 2,
    highStakes: false,
  },
);
