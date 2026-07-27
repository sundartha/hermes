// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P7 (Absender-Herkunft + Boot-Guards).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// Vorbedingung erfuellt: P2 (Wechselkurs) ist gemergt - beide Phasen fassen config-nahe
// Dateien an, deshalb lagen sie in verschiedenen Wellen.
//
// highStakes: SAFETY. Diese Phase baut Sperren. Zwei Dinge sind hier historisch teuer:
//   - Ein Boot-Guard mit fatal:true kann den Live-Dienst am Start toeten. Genau daran ist
//     P2 in zwei Fix-Runden gescheitert (fatales FX-Gate, zurueckgebaut). Die Render-Services
//     sind DASHBOARD-managed (Live != render.yaml) - was der Blueprint sagt, ist NICHT der
//     Beweis, dass die Variable live gesetzt ist.
//   - Wo eine neue Sperre entsteht, gehoert der GLUECKLICHE PFAD mitgetestet: der heute
//     erlaubte Anruf muss erlaubt bleiben.
//
// EINZIGE zulaessige Testaenderung (PLAN-GATES.md Abschnitt 7, Owner-Entscheidung):
// beide Tests in test/did-reputation-metric.test.js stilllegen, Ersatz ist ein
// Boot-Guard-Test fuer TELNYX_CONNECTION_ID. Die Deckung bleibt ueber number-lifecycle.

export const meta = {
  name: "gates-p7-run",
  description: "Gates W2/P7: Absender-Herkunft + Boot-Guards (GAP-19 x2, OUT-14)",
  phases: [{ title: "GATES-P7" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P7",
    phaseTitle:
      'Absender-Herkunft + Boot-Guards (Spec: Abschnitt "P7" in tasks/gates-fix-chain.md; Abnahme: GAP-19 in test/outbound-gates-order.test.js und test/boot-prod-footguns.test.js sowie OUT-14 gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: NUR die in PLAN-GATES.md Abschnitt 7 genannte)',
    branch: "phase/gates-p7-absender-herkunft",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
