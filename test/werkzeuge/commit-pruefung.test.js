import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment } from "./probe-repo.js";

const COMMITLINT = join(REPO_ROOT, "node_modules/@commitlint/cli/cli.js");
const KONFIGURATION = join(REPO_ROOT, "commitlint.config.mjs");
const SHA_LAENGE = 40;
const ERLAUBTE_ZEICHEN = 72;
const SHA = "a".repeat(SHA_LAENGE);
const ZU_LANG = "x".repeat(ERLAUBTE_ZEICHEN + 1);

const FAELLE = [
  { nachricht: "Rufe x auf\n\nWarum: weil.\n\nPaket: 27\n", regel: null },
  { nachricht: "Behebe x\n\nUrsache: kaputt.\nAuftrag: p1/A1\n", regel: null },
  { nachricht: "Bump x\n\nSigned-off-by: dependabot[bot] <support@github.com>\n", regel: null },
  { nachricht: `Revert "x"\n\nThis reverts commit ${SHA}.\n`, regel: null },
  { nachricht: "Rufe x auf\n\nWeil.\n\nPaket: 27\n", regel: "begruendung" },
  { nachricht: "Rufe x auf\nzweite Zeile\n\nWarum: weil.\n\nPaket: 27\n", regel: "body-leading-blank" },
  { nachricht: "Rufe x auf\n\nWarum: weil.\n", regel: "herkunft" },
  { nachricht: `${ZU_LANG}\n\nWarum: weil.\n\nPaket: 27\n`, regel: "header-max-length" },
];

function pruefe(nachricht) {
  return spawnSync(process.execPath, [COMMITLINT, "--config", KONFIGURATION], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input: nachricht,
    env: isolatedEnvironment(),
  });
}

test("die Commit-Prüfung verlangt Warum oder Ursache, Paket oder Auftrag und höchstens 72 Zeichen", () => {
  for (const { nachricht, regel } of FAELLE) {
    const lauf = pruefe(nachricht);
    assert.equal(lauf.status === 0, regel === null, `${nachricht}\n${lauf.stdout}${lauf.stderr}`);
    if (regel) assert.match(lauf.stdout, new RegExp(`\\[${regel}\\]`), nachricht);
  }
});

const AUFRAEUM_NACHRICHTEN = [
  ...["fixup!", "squash!", "amend!", "fixup! fixup!", "Fixup!"].map(
    (vorsatz) => `${vorsatz} Rufe x auf\n\nWarum: weil.\n\nPaket: 27\n`,
  ),
  `amend! Revert "x"\n\nRevert "x"\n\nThis reverts commit ${SHA}.\n`,
  "fixup! Bump x\n\nSigned-off-by: dependabot[bot] <support@github.com>\n",
];

test("die Commit-Prüfung lehnt fixup!, squash! und amend! ab und verweist auf git rebase --autosquash", () => {
  for (const nachricht of AUFRAEUM_NACHRICHTEN) {
    const lauf = pruefe(nachricht);
    assert.notEqual(lauf.status, 0, nachricht);
    assert.match(lauf.stdout, /\[kein-fixup\]/, nachricht);
    assert.match(lauf.stdout, /git rebase .*--autosquash/, nachricht);
  }
});

test("die Commit-Prüfung lässt eine Kopfzeile durch, die fixup! nur mitten im Satz nennt", () => {
  const lauf = pruefe("Lehne fixup! im Commit ab\n\nWarum: weil.\n\nPaket: 27\n");
  assert.equal(lauf.status, 0, `${lauf.stdout}${lauf.stderr}`);
});
