// PER-RUN-WRAPPER fuer Welle W2, Block B5 (Provisioning und DID-Lebenszyklus).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// 9 Tests: DID-05/08/09/11/17/19 + GAP-19/23/34.
//
// highStakes=true: dieser Block beruehrt den DID-Lebenszyklus. Ein Test, der eine
// Nummer wirklich kauft oder freigibt, kostet echtes Geld bzw. verliert eine gemietete
// Nummer. PROVISIONING_ENABLED bleibt in JEDEM Test aus; kein Test darf einen echten
// Telnyx-Aufruf ausloesen.
//
// Belastbare Vorbefunde aus der B0-Baseline (19-w2-baseline.md):
//   - GAP-34 ist BESTAETIGT OFFEN: src/db/migrate.js fuehrt backfillPeriodStart und
//     backfillAccountEmailCase, KEINEN Backfill fuer country/language. Owner-Entscheidung
//     E2 gibt den Sollzustand vor: Land aus der DID-Vorwahl ableiten, kein Raten, ohne
//     ableitbares Land bleibt das Feld leer.
//   - DID-05 haengt am Weltdefault-Flip: gegen DEFAULT_LANGUAGE formulieren, nie gegen "de".
//   - GAP-19 (Absender-Land vs. Kauf-Land) ist der Leittest des Clusters D22.

export const meta = {
  name: "w2-b5-run",
  description: "W2-B5: Provisioning und DID-Lebenszyklus (9 Katalogtests)",
  phases: [{ title: "W2-B5" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "W2-B5",
    phaseTitle: "Provisioning und DID-Lebenszyklus",
    branch: "phase/w2-b5-provisioning-did",
    baseBranch: "master",
    planDoc: "PLAN-I18N-TESTS.md",
    specFile: "tasks/i18n-tests/18-w2-scope.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
