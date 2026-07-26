// PER-RUN-WRAPPER fuer Welle W2, Block B4 (Geld: Tarif, Metering, Plan-Decken).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// 19 Tests: PAY-01/06/08/09/10/12/15/16/17/20/22/23/24/25/26 + GAP-06/08/09/11.
// Groesster Block der Welle.
//
// highStakes=true: Geld. Ein falsch gepinnter Betrag ist kein haesslicher Test, sondern
// eine falsche Rechnung, die spaeter als "belegt" gilt. Rundung, Waehrungseinheit
// (Cent vs. Euro) und Richtung (inbound/outbound) sind die drei Stellen, an denen dieser
// Codebestand historisch gestolpert ist.
//
// ZWEI IDs ohne tragfaehiges Subjekt (Baseline 19-w2-baseline.md 3.7) - NICHT blind bauen,
// zuerst entscheiden und das Ergebnis in den Blockreport:
//   - PAY-25: VOICE_TARIFF_DOMESTIC_PREFIXES ist eine Code-Konstante, keine Env-Variable -
//     es gibt keine Env-Doku-Kohaerenz zu pruefen.
//   - PAY-20: der unterstellte fehlende Drift-Alarm existiert (providerRateOutOfBand im
//     Boot-Guard + src/billing/cost-calibration.js).
// Ausserdem: PAY-12 ist seit P15 lokalisiert (localeFor(store.tenantLanguage(...)).gates) -
// NICHT mehr als "hart deutsch" pinnen, das waere ein Mischsprach-Pin (GAP-27 schlaegt an).

export const meta = {
  name: "w2-b4-run",
  description: "W2-B4: Geld - Tarif, Metering, Plan-Decken (19 Katalogtests)",
  phases: [{ title: "W2-B4" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B4",
    phaseTitle: "Geld - Tarif, Metering, Plan-Decken",
    branch: "phase/w2-b4-geld",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
