// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P14 (altes Dashboard public/tenant.html loeschen).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Vorbedingungen erfuellt: P12 und P13 sind gemergt.
//
// highStakes: das ist KEINE Datei-Loeschung, sondern eine Phase mit GELD-PFAD-Beruehrung.
// Die eigene Abnahmebedingung der Phase (PLAN-GATES.md): die Stripe-Rueckkehradressen in
// src/self-service-routes.js zeigen heute auf /tenant.html?card=ok - sie MUESSEN auf /app
// umgestellt sein UND /app MUSS die Parameter auswerten. Ohne diesen Nachweis kein Merge,
// sonst landet ein Kunde nach dem Hinterlegen der Karte auf einer Seite ohne Bestaetigung.
//
// Sicherheits-Nebenwirkung, die NICHT Teil dieser Phase ist: src/middleware.js lockert die
// CSP ausdruecklich WEGEN dieser Datei (Inline-<script>/onclick). Faellt sie, KANN die CSP
// enger werden - das ist ein Folgeauftrag, hier NICHT mitmachen.
//
// EINZIGE zulaessige Testaenderungen (PLAN-GATES.md Abschnitt 7): die FMT-15-Tests in
// test/bk1-plan-price-format.test.js und der WEB-08-Test in
// test/dashboard-i18n-surface.test.js stilllegen (die gemessene Oberflaeche verschwindet),
// plus die 21 Testdateien anpassen, die public/tenant.html lesen.

export const meta = {
  name: "gates-p14-run",
  description: "Gates W3/P14: altes Dashboard loeschen - inkl. Stripe-Rueckkehr auf /app",
  phases: [{ title: "GATES-P14" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P14",
    phaseTitle:
      'Altes Dashboard loeschen (Spec: Abschnitt "P14" in tasks/gates-fix-chain.md; EIGENE Abnahmebedingung: die Stripe-Rueckkehradressen zeigen auf /app UND /app wertet die Parameter aus - ohne Nachweis kein Merge. Ausserdem: "npm test" mit fail=0 und keinem neu roten Bestandstest, Diff beruehrt src/ bzw. public/. Zulaessige Testaenderungen: NUR die in PLAN-GATES.md Abschnitt 7 genannten. Die CSP NICHT anfassen - das ist ein Folgeauftrag)',
    branch: "phase/gates-p14-altes-dashboard-loeschen",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
