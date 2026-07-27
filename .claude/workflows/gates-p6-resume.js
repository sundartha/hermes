// PER-RUN-WRAPPER Gates-Kette Welle 1 — Phase P6 (Store-Vertraege + TTS-Kontingent).
// WIEDERAUFNAHME: der Impl-Commit b1808cc liegt bereits auf dem Branch; der Lauf starb beim
// Rechner-Absturz am 2026-07-27. Dieser Lauf holt Review + Self-Fix nach.
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
//
// highStakes: Geld/Sprache. Zwei Owner-Vorgaben, die die Phase NICHT selbst entscheiden darf:
//   - GAP-09: bei erschoepftem Kontingent DEGRADATION auf Azure-<Say>, NICHT Sperre. Ein
//     Anruf ohne Stimme ist bei einem Produkt, dessen Zweck Sprechen ist, der schlimmere
//     Ausgang. Unterhalb des Kontingents bleibt der ElevenLabs-Pfad byte-gleich.
//   - LANG-19: das stille `continue` bei abweichender Schreibweise ist die Wurzel - ein
//     abgelehnter Override darf nicht lautlos verschwinden.
// Ausserdem: gesprochene DE-Strings bleiben ASCII-transliteriert (i18n/locales.js).

export const meta = {
  name: "gates-p6-resume",
  description: "Gates W1/P6 (Wiederaufnahme): Store-Vertraege + TTS-Kontingent - Review + Self-Fix",
  phases: [{ title: "GATES-P6" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/gates-review-resume.js` },
  {
    phaseId: "GATES-P6",
    phaseTitle: "Store-Vertraege + TTS-Kontingent (LANG-19, GAP-09 x2)",
    branch: "phase/gates-p6-store-tts-quota",
    // Basis ist der Commit, auf dem der Impl-Lauf stand - NICHT "master" (s. gates-p2-resume.js).
    baseBranch: "695505e",
    specFile: "tasks/gates-fix-chain.md",
    specSection: "P6",
    gates:
      "LANG-19 in test/f1-geo-store.test.js und die beiden GAP-09-Tests in test/tts-quota-counter.test.js",
    maxFixRounds: 2,
    highStakes: true,
  },
);
