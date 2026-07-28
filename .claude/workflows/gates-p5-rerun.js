// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P5, NEULAUF von master.
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Warum NEULAUF statt Fix-Runde: der erste Anlauf (phase/gates-p5-did-monatsmiete*) wird
// VERWORFEN, nicht geflickt. Er traegt drei Probleme, die zusammen eine Fix-Runde nicht
// tragen wuerde:
//   1) Die Idempotenz ist am TENANT gefuehrt statt an der NUMMER - daraus hat der Review
//      eine konkrete Doppelbuchung hergeleitet. Das ist ein Entwurfsfehler, kein Detail.
//   2) Ein auf master GRUENER Geld-Test wurde unautorisiert umgedreht (aus "genau ein Beleg
//      mit dem richtigen Betrag" wurde "kein Beleg") - die Anti-Drift-Zusage aus dem
//      R3-Capture-Mismatch war damit weg.
//   3) Vier Dateien ausserhalb der Dateiliste, drei davon ungemeldet.
// Der Gate-Befund selbst war richtig erkannt (GAP-06 ist unerfuellbar), und die Einsicht
// "die Einrichtungsgebuehr ist kein Miet-Fallback" ist ebenfalls richtig - beides steht
// jetzt im Nachtrag der Spec und muss nicht neu gefunden werden.
//
// highStakes: WIEDERKEHRENDES Geld. Ein falscher Betrag wird hier jeden Monat erneut
// gebucht, eine Doppelbuchung jeden Monat verdoppelt.

export const meta = {
  name: "gates-p5-rerun",
  description: "Gates W3/P5 (Neulauf): DID-Monatsmiete - Idempotenz an der Nummer, Gate neu gefasst",
  phases: [{ title: "GATES-P5" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P5",
    phaseTitle:
      'DID-Monatsmiete im Ledger (Spec: Abschnitt "P5" in tasks/gates-fix-chain.md INKLUSIVE des Nachtrags 2026-07-28 - er ist nach dem ersten, blockierten Anlauf entstanden und aendert die Vorgaben: GAP-06 wird neu gefasst (Wiederkehr UND Idempotenz muessen beide gepinnt sein), die Idempotenz laeuft an der NUMMER statt am Tenant (eine Zaehlung je Tenant ist ausdruecklich verboten, sie erzeugt Doppelbuchungen), der GAP-11-Test darf nur ERWEITERND angepasst werden (beide Faelle gepinnt: ohne gelernten Preis kein Beleg, MIT gelerntem Preis genau ein Beleg mit diesem Betrag), und src/app.js bleibt verboten. Abnahme: das neu gefasste GAP-06 gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, Diff beruehrt src/. Ein roter Spawn-Test ("Server-Start Timeout") ist der bekannte Voll-Last-Flake: isoliert nachfahren, erst dann bewerten)',
    branch: "phase/gates-p5-monatsmiete-neu",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
