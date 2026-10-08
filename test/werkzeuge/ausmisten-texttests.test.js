import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { DOPPELT, EINGANG_QUELLE } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, messePaket, messeUndMelde, plane } from "./ausmisten/messung.mjs";
import {
  ANDERER,
  KUERZEN,
  LESEN,
  MIT_TEXT,
  TABULATOR,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

function artefakt(artefakte, name) {
  return JSON.parse(readFileSync(join(artefakte, name, `${name}.json`), "utf8"));
}

async function basisMit(context, { master, branch }) {
  const stand = await plane(
    context,
    { weg: [], neu: { [TEXTTEST]: branch } },
    { [TEXTTEST]: master },
  );
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  return { stand, basis: await messePaket(stand, { art: "basis", paket: 0 }) };
}

test("ausmisten-texttests: ein Texttest auf der umgebauten Datei wird sichtbar ausgenommen, und sein Löschen braucht die Freigabe", async (context) => {
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
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Freigabe nötig: Ausgenommener Testfall im Branch gelöscht: test\/post\/text\.test\.js: liest den Quelltext/,
  );
  assert.equal(ergebnis.status.state, "failure");
});

test("ausmisten-texttests: ein ausgenommener Fall tötet keinen Mutanten", async (context) => {
  const nurText = texttest(fall(TEXTFALL, LESEN));
  const { stand, basis } = await basisMit(context, {
    master: nurText,
    branch: texttest(fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  const gelesen = artefakt(stand.artefakte, "basis-0");
  const getoetet = Object.entries(gelesen.mutanten).filter(([, status]) => status === "Killed");
  assert.deepEqual(getoetet, []);
  assert.equal(gelesen.ausgenommen.length, 1);
});

test("ausmisten-texttests: ein unveränderter ausgenommener Fall bleibt auch im Branch ausgenommen und braucht keine Freigabe", async (context) => {
  const dateien = { [TEXTTEST]: MIT_TEXT };
  const neu = texttest(fall(TEXTFALL, LESEN), fall(VERHALTEN, KUERZEN), fall(ANDERER, TABULATOR));
  const ergebnis = await messeUndMelde(
    context,
    { weg: [DOPPELT], neu: { [TEXTTEST]: neu } },
    { dateien },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  const [ausgenommen] = ergebnis.gelesen.ausgenommen;
  assert.equal(ausgenommen.imBranch, "unverändert");
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.equal(ergebnis.status.state, "success");
});

test("ausmisten-texttests: ein geänderter ausgenommener Fall braucht die Freigabe", async (context) => {
  const geaendert = [...LESEN.slice(0, 1), 'assert.ok(quelle.includes("trim"));'];
  const { stand, basis } = await basisMit(context, {
    master: MIT_TEXT,
    branch: texttest(fall(TEXTFALL, geaendert), fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_GRUEN, basis.ausgabe);
  const [ausgenommen] = artefakt(stand.artefakte, "basis-0").ausgenommen;
  assert.equal(ausgenommen.imBranch, "geändert");
});

test("ausmisten-texttests: ein neuer Texttest im Branch wird nicht ausgenommen und macht die Branch-Messung rot", async (context) => {
  const neuerText = texttest(fall(VERHALTEN, KUERZEN), fall("liest neu den Quelltext", LESEN));
  const dateien = { [TEXTTEST]: texttest(fall(VERHALTEN, KUERZEN)) };
  const ergebnis = await messeUndMelde(
    context,
    { weg: [], neu: { [TEXTTEST]: neuerText } },
    { dateien },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_ROT, ergebnis.zweig.ausgabe);
  assert.match(
    ergebnis.zweig.ausgabe,
    /dürfen hier nicht ausgenommen werden:\ntest\/post\/text\.test\.js: liest neu den Quelltext/,
  );
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
});

test("ausmisten-texttests: ein Fall, der auch ohne Umbau scheitert, wird nicht ausgenommen", async (context) => {
  const kaputt = ['assert.equal(eingang(" a "), "b");'];
  const { basis } = await basisMit(context, {
    master: texttest(fall(TEXTFALL, LESEN), fall("scheitert immer", kaputt)),
    branch: texttest(fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_ROT, basis.ausgabe);
  assert.match(basis.ausgabe, /„scheitert immer“ besteht auch ohne Umbau der Quelldateien nicht/);
});

test("ausmisten-texttests: ein Texttest mit doppeltem Namen wird nicht ausgenommen", async (context) => {
  const { basis } = await basisMit(context, {
    master: texttest(fall(TEXTFALL, LESEN), fall(TEXTFALL, KUERZEN)),
    branch: texttest(fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_ROT, basis.ausgabe);
  assert.match(basis.ausgabe, /der Name „liest den Quelltext“ ist nicht eindeutig \(2 Testfälle\)/);
});

test("ausmisten-texttests: ein echter verlorener Mutant bleibt neben einem ausgenommenen Fall rot und wird früh gemeldet", async (context) => {
  const dateien = { [TEXTTEST]: MIT_TEXT };
  const branch = {
    weg: [DOPPELT, "test/post/eingang.test.js"],
    neu: { [TEXTTEST]: texttest(fall(TEXTFALL, LESEN)) },
  };
  const ergebnis = await messeUndMelde(context, branch, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_ROT, ergebnis.zweig.ausgabe);
  assert.match(
    ergebnis.zweig.ausgabe,
    /Verstoß: Mutant auf dem Branch nicht mehr getötet: src\/post\/eingang\.js:/,
  );
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.doesNotMatch(ergebnis.melden.ausgabe, /Freigegeben/);
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
