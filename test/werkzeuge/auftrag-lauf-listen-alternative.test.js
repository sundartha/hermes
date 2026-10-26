import assert from "node:assert/strict";
import { test } from "node:test";

import { UMBAU } from "./auftrag-lauf-probe.js";
import { listenLauf, zeigt } from "./auftrag-lauf-listen-probe.js";
import { runIn } from "./probe-repo.js";

const ABSAGE = "src/weg/decline.js";
const ALT = String.raw`"^src/(a|text|weg/decline)\\.js$"`;
const NEU = String.raw`"^src/(a|text)\\.js$"`;
const BEREICHE = String.raw`[
  {
    "bereich": "probe",
    "quellen": ["^src/a\\.js$"],
    "eingaenge": [
      ${ALT}
    ]
  }
]
`;
const AUFTRAG = { ...UMBAU, ziel: "Lösche die leere Datei src/weg/decline.js", erwarteteDateien: [ABSAGE] };

test("auftrag-lauf-listen-alternative: ein Umbau, der eine Datei löscht, die nur eine Alternative eines Musters in tools/bereiche.json traf, endet mit Commit samt umgeschriebenem Muster und ohne „Voraussetzung fehlt“", (context) => {
  const listen = { "tools/bereiche.json": BEREICHE, [ABSAGE]: "export {};\n" };
  const { repo, lauf, basis } = listenLauf(context, { auftrag: AUFTRAG, drehbuch: { "bau-loeschen": [ABSAGE] }, listen });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout + lauf.stderr, /Voraussetzung fehlt/);
  assert.equal(runIn(repo, "git", ["diff", "--name-status", "--no-renames", basis, "HEAD"]).stdout, `D\t${ABSAGE}\nM\ttools/bereiche.json\n`);
  assert.equal(zeigt(repo, "tools/bereiche.json"), BEREICHE.replace(ALT, NEU));
  assert.match(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^listen-kuerzen: Exit 0$/m);
});
