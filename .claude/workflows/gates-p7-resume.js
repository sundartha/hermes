// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P7, WIEDERAUFNAHME.
// Impl-Commit 73be4cf liegt im Branch; Lauf am 2026-07-27 vom Lead gestoppt (Ueberhitzung
// durch verwaiste Testserver, Memory [[leaked-test-servers-overheat]]).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// highStakes: SAFETY. Zwei Dinge sind hier besonders zu pruefen:
//   - Ein Boot-Guard mit fatal:true kann den LIVE-Dienst am Start toeten. Die
//     Render-Services sind DASHBOARD-managed (Live != render.yaml) - der Blueprint ist KEIN
//     Beweis, dass eine Variable live gesetzt ist. Genau daran ist P2 in zwei Fix-Runden
//     gescheitert (fatales FX-Gate, zurueckgebaut).
//   - Wo eine neue Sperre entsteht, MUSS der glueckliche Pfad mitgetestet sein: der heute
//     erlaubte Anruf bleibt erlaubt.

export const meta = {
  name: "gates-p7-resume",
  description: "Gates W2/P7 (Wiederaufnahme): Absender-Herkunft + Boot-Guards - Review + Self-Fix",
  phases: [{ title: "GATES-P7" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P7",
    phaseTitle: "Absender-Herkunft + Boot-Guards (GAP-19 x2, OUT-14, TELNYX_CONNECTION_ID-Guard)",
    branch: "phase/gates-p7-absender-herkunft",
    baseBranch: "5fe5980",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P7",
    gates: "GAP-19 in test/outbound-gates-order.test.js und test/boot-prod-footguns.test.js sowie OUT-14 in test/outbound-gates-order.test.js",
    maxFixRounds: 2,
    highStakes: true,
  },
);
