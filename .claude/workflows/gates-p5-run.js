// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P5 (DID-Monatsmiete im Ledger, GAP-06).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Vorbedingung erfuellt: P4 ist gemergt, monthly_cost wird am Nummern-Datensatz persistiert
// (nullable, NULL = keine Miete gelernt). Genau diesen Wert liest P5.
//
// highStakes: Geld, und zwar WIEDERKEHRENDES. Ein falscher Betrag wird hier nicht einmal
// gebucht, sondern jeden Monat erneut. Drei Vorgaben, die die Phase NICHT selbst entscheiden
// darf (Owner 2026-07-27):
//   - KEIN Cron, kein neuer Endpunkt: Uhr = die Stripe-Abo-Verlaengerung
//     (customer.subscription.updated, wird bereits verarbeitet), Netz = ein Schritt im
//     bestehenden stuendlichen Sweep.
//   - Der Betrag ist der beim Kauf uebernommene monthly_cost - NICHT die Einrichtungsgebuehr
//     (die heute faelschlich gebucht wird) und NICHT NUMBER_MONTHLY_COST_CENTS.
//   - IDEMPOTENZ ist Pflicht: ein Beleg je Nummer und Kalendermonat, auch wenn beide
//     Ausloeser feuern.
// Ausserdem: Waehrung nicht verlieren - ein USD-Betrag als EUR gebucht ist ein stiller
// Geldfehler. Umrechnung nur ueber die EINE Kursquelle aus P2.

export const meta = {
  name: "gates-p5-run",
  description: "Gates W3/P5: DID-Monatsmiete im Ledger, zwei Ausloeser, ein Beleg je Monat",
  phases: [{ title: "GATES-P5" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P5",
    phaseTitle:
      'DID-Monatsmiete im Ledger (Spec: Abschnitt "P5" in tasks/gates-fix-chain.md; Abnahme: GAP-06 gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: KEINE. Ein roter Spawn-Test ("Server-Start Timeout") ist der bekannte Voll-Last-Flake - isoliert nachfahren, erst dann bewerten)',
    branch: "phase/gates-p5-did-monatsmiete",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
