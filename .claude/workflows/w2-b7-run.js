// PER-RUN-WRAPPER fuer Welle W2, Block B7 (Rest: MCP, Sicherungs-Vertraege, Formate).
// LETZTER Block der Welle. Phase HART GEPINNT (Memory [[phase-impl-workflow-args]]).
//
// 12 Tests: MCP-14/16 + LAW-14/15/18/22 + FMT-23/24/27/30 + GAP-26/31.
//
// Die vier LAW-IDs sind KEINE Rechtspruefung (Owner-Entscheidung 7.14 hat die echten
// Rechtsfragen gestrichen): LAW-14 ist das fail-closed CLI-Gate von erase-tenant.js,
// LAW-15 sind die Retention-Defaults, LAW-18 der Geo-Fallback, LAW-22 ein Isolations-Race.
// Code-Vertraege, kein Gutachten.
//
// Vorbefunde aus der B0-Baseline (19-w2-baseline.md):
//   - LAW-18, LAW-22, FMT-27 haengen am Weltdefault-Flip: gegen DEFAULT_LANGUAGE
//     formulieren, NIE gegen das Literal "de" (sonst falsch-rot beim naechsten Env-Flip).
//   - GAP-31 ("jedes Locale-Feld hat einen Produktionskonsumenten") ist durch P15
//     teilweise geschlossen - erst messen, welche Felder heute noch konsumentenlos sind.
//
// WARNUNG - eine Baseline-Aussage war nachweislich falsch: B0 behauptete, `buildFilter`
// existiere nicht im Repo; `grep -c buildFilter render.yaml` liefert 2. Der B6-Agent hat
// das gemessen und GAP-37 entgegen der Baseline gebaut. LEHRE FUER DIESEN BLOCK: jede
// Baseline-Aussage ist ein Hinweis, kein Beweis. Wo die Baseline "Praemisse entfaellt"
// sagt, wird das am Code NACHGEMESSEN, bevor eine ID uebersprungen wird.

export const meta = {
  name: "w2-b7-run",
  description: "W2-B7: Rest - MCP, Sicherungs-Vertraege, Formate (12 Katalogtests)",
  phases: [{ title: "W2-B7" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B7",
    phaseTitle: "Rest - MCP, Sicherungs-Vertraege, Formate",
    branch: "phase/w2-b7-rest",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: false,
  },
);
