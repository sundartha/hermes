// PER-RUN-WRAPPER Gates-Kette Welle 3 — Phase P9 (Stimme regional + Locale-Felder).
// Phase HART GEPINNT, nicht ueber args (Memory [[phase-impl-workflow-args]]).
// SPEICHER-DISZIPLIN: sequentiell, nie parallel zu einer anderen Phase.
//
// Vorbedingungen erfuellt: P2 und P7 sind gemergt (beide fassten config-nahe Dateien an).
//
// Die Stimm-IDs sind BINDEND in der Spec festgelegt (Owner 2026-07-27) - nichts erfinden,
// nichts aus einer API holen: de = heutige ELEVENLABS_VOICE_ID (unveraendert),
// fr/en-US/en-GB stehen namentlich in der Spec, en-GB ist der Default fuer Englisch.
//
// Zwei Fallen dieses Codebestands, die hier zusammentreffen:
//   - Gesprochene DE-Strings sind ASCII-TRANSLITERIERT vorgeschrieben (src/i18n/locales.js),
//     FR hat bewusst Akzente. Keine Umlaute in gesprochene DE-Texte einschmuggeln.
//   - "de-DE" (nicht "de") ist am Telnyx-Gather EMPIRISCH korrekt - nie auf "de" zurueck.

export const meta = {
  name: "gates-p9-run",
  description: "Gates W3/P9: ElevenLabs-Stimme loest regional auf, Locale-Felder bekommen Leser",
  phases: [{ title: "GATES-P9" }],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";

return await workflow(
  { scriptPath: `${REPO}/.claude/workflows/phase-impl-lean.js` },
  {
    phaseId: "GATES-P9",
    phaseTitle:
      'Stimme regional + Locale-Felder (Spec: Abschnitt "P9" in tasks/gates-fix-chain.md, die Voice-IDs dort sind bindend; Abnahme: VOICE-12 in test/telnyx-elevenlabs-render.test.js und GAP-31 in test/locale-field-consumers.test.js gruen via "npm run test:gates", "npm test" mit fail=0 und keinem neu roten Bestandstest, und der Diff beruehrt src/. Zulaessige Testaenderung: KEINE. Praezedenzfall dieser Phase: VOICE-12 wurde in Welle W2 lautlos zu einer Bestaetigung des Defekts umgeschrieben ("eine Voice-ID fuer alle Sprachen - das IST der Beweis") und beide Reviews gaben es frei. Das darf sich nicht wiederholen)',
    branch: "phase/gates-p9-stimme-regional",
    baseBranch: "master",
    planDoc: "PLAN-GATES.md",
    specFile: "tasks/gates-fix-chain.md",
    maxFixRounds: 2,
    highStakes: true,
  },
);
