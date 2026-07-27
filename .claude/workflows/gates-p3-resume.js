// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P3 (Kauf-Land-Tabelle, DID-05 + DID-09).
// WIEDERAUFNAHME: der Impl-Commit 1a93ef3 liegt bereits auf dem Branch; der Review lief noch,
// als der Rechner am 2026-07-27 abstuerzte. Dieser Lauf holt Review + Self-Fix nach.
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// highStakes: Geld. DID-09 ist der live-relevante Teil - ohne filter[phone_number_type]
// entscheidet der Provider-Default, ob wir local, toll-free oder mobile kaufen; das beruehrt
// Zustellbarkeit UND Preis jeder gekauften Nummer. DID-05 ist latent, solange
// FORCE_NUMBER_COUNTRY=US steht (Owner-Entscheidung: bleibt so) - der Override behaelt
// seinen Vorrang vor der Tabelle.

export const meta = {
  name: "gates-p3-resume",
  description: "Gates W1/P3 (Wiederaufnahme): Kauf-Land-Tabelle - Review + Self-Fix",
  phases: [{ title: "GATES-P3" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P3",
    phaseTitle: "Kauf-Land-Tabelle (DID-05, DID-09)",
    branch: "phase/gates-p3-provisioning-geo",
    baseBranch: "master",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P3",
    gates: "DID-05 und DID-09 in test/f1-provisioning-geo.test.js",
    maxFixRounds: 2,
    highStakes: true,
  },
);
