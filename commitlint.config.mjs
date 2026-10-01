const FEHLER = 2;
const IMMER = "always";
const MAX_ERSTE_ZEILE = 72;
const BEGRUENDUNG = /\n\n(?:Warum|Ursache): \S/;
const HERKUNFT = /^(?:Paket: \S+|Auftrag: [^\s/]+\/\S+)$/m;
const DEPENDABOT = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/m;
const RUECKNAHME = /^Revert ".+"\n\nThis reverts commit [0-9a-f]{40}\.$/m;

function verlangt(muster, meldung) {
  return ({ raw }) => [muster.test(raw ?? ""), meldung];
}

export default {
  defaultIgnores: false,
  ignores: [(nachricht) => DEPENDABOT.test(nachricht) || RUECKNAHME.test(nachricht)],
  plugins: [
    {
      rules: {
        begruendung: verlangt(
          BEGRUENDUNG,
          "Ein Absatz muss mit „Warum:“ beginnen, bei einer Fehlerbehebung mit „Ursache:“.",
        ),
        herkunft: verlangt(HERKUNFT, "Eine Zeile „Paket: NN“ oder „Auftrag: <phase>/<id>“ fehlt."),
      },
    },
  ],
  rules: {
    "header-max-length": [FEHLER, IMMER, MAX_ERSTE_ZEILE],
    "body-leading-blank": [FEHLER, IMMER],
    begruendung: [FEHLER, IMMER],
    herkunft: [FEHLER, IMMER],
  },
};
