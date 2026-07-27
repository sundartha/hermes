// PER-RUN-WRAPPER Gates-Kette Welle 2 — Phase P12 (Deutsche Klartexte am Server).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// P12 laeuft VOR P14 (Welle 3): P14 loescht das alte Dashboard und fasst dieselbe Datei
// src/self-service-routes.js an. Deshalb hier nur die Textschicht, keine Struktur-Umbauten,
// die P14 spaeter im Weg stehen.
//
// Achtung Auth-Pfad: src/web-auth.js ist Teil der Dateiliste. Auth bleibt fail-closed,
// Credential-Vergleiche timing-sicher (safeEqual) - eine Textaenderung darf den Kontrollfluss
// nicht anfassen. Und: kein Secret und keine Session-Kennung im neuen Klartext.
//
// EINZIGE zulaessige Testaenderung (PLAN-GATES.md Abschnitt 7): der Ist-Pin
// test/web-auth.test.js:337 (/Sitzung abgelaufen/) - er pinnt genau den Zustand, den WEB-13
// abloest.

export const meta = {
  name: "gates-p12-run",
  description: "Gates W2/P12: sprachneutrale Server-Klartexte statt hart deutscher (WEB-10, WEB-13)",
  phases: [{ title: "GATES-P12" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P12",
    phaseTitle:
      'Deutsche Klartexte am Server (Spec: Abschnitt "P12" in tasks/gates-fix-chain.md; Abnahme: WEB-10 in test/self-service-error-codes.test.js und WEB-13 in test/web-auth.test.js gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: NUR der Ist-Pin laut PLAN-GATES.md Abschnitt 7)',
    branch: "phase/gates-p12-server-klartexte",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
