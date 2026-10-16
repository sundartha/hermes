import assert from "node:assert/strict";
import { test } from "node:test";

import { artefakt, erwarteSichtbarOhneSperre } from "./ausmisten-texttests-hilfen.js";
import { EINGANG_QUELLE } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, messePaket, messeUndMelde, plane } from "./ausmisten/messung.mjs";
import {
  KUERZEN,
  MIT_TEXT,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

test("ausmisten-texttests: ein Texttest auf der umgebauten Datei wird sichtbar ausgenommen, und sein Löschen bleibt sichtbar, ohne zu sperren", async (context) => {
  const dateien = { [TEXTTEST]: MIT_TEXT };
  const branch = { weg: [], neu: { [TEXTTEST]: texttest(fall(VERHALTEN, KUERZEN)) } };
  const ergebnis = await messeUndMelde(context, branch, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.match(
    ergebnis.basis.ausgabe,
    /Ausgenommen, weil sie nur an der umgebauten src\/post\/eingang\.js scheitern:\ntest\/post\/text\.test\.js: liest den Quelltext/,
  );
  assert.deepEqual(ergebnis.gelesen.ausgenommen, [
    { datei: EINGANG_QUELLE, test: TEXTTEST, name: TEXTFALL, imBranch: "gelöscht" },
  ]);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  erwarteSichtbarOhneSperre(ergebnis, "gelöscht");
});

test("ausmisten-texttests: ein Texttest auf einem importierten Skript wird ebenso ausgenommen", async (context) => {
  const skript = "scripts/zaehlen.mjs";
  const skriptTest = "test/post/zaehlen.test.js";
  const kopfzeilen = [
    'import assert from "node:assert/strict";',
    'import { readFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'import { zaehle } from "../../scripts/zaehlen.mjs";',
    "",
  ];
  const lesen = [
    'const quelle = readFileSync(new URL("../../scripts/zaehlen.mjs", import.meta.url), "utf8");',
    'assert.ok(quelle.startsWith("export function zaehle"));',
  ];
  const zaehlen = ["assert.equal(zaehle([1, 2]), 2);"];
  const dateien = {
    [skript]: "export function zaehle(liste) {\n  return liste.length;\n}\n",
    [skriptTest]: [...kopfzeilen, ...fall(TEXTFALL, lesen), ...fall("zählt", zaehlen)].join("\n"),
  };
  const neu = { [skriptTest]: [...kopfzeilen, ...fall("zählt", zaehlen)].join("\n") };
  const stand = await plane(context, { weg: [], neu }, dateien);
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  const basis = await messePaket(stand, { art: "basis", paket: 0 });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  assert.deepEqual(artefakt(stand.artefakte, "basis-0").ausgenommen, [
    { datei: skript, test: skriptTest, name: TEXTFALL, imBranch: "gelöscht" },
  ]);
});
