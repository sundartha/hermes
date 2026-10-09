import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { imBranch } from "../../tools/tests-ausmisten/ausnehmen.mjs";
import { DOPPELT, EINGANG_QUELLE, ausmistenRepo } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, messePaket, messeUndMelde, plane } from "./ausmisten/messung.mjs";
import {
  ANDERER,
  KUERZEN,
  LESEN,
  MIT_MUSTER,
  MIT_TEXT,
  TABULATOR,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

function erwarteSichtbarOhneSperre(ergebnis, stand) {
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.ok(
    ergebnis.melden.ausgabe.includes(
      `Ausgenommen: ${TEXTTEST}: ${TEXTFALL} (umgebaute Datei ${EINGANG_QUELLE}, im Branch ${stand})`,
    ),
    ergebnis.melden.ausgabe,
  );
  assert.doesNotMatch(ergebnis.melden.ausgabe, /Freigabe/);
  assert.equal(ergebnis.status.state, "success");
}

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

const HILFE = "test/hilfe/text.js";
const TIEF = "test/hilfe/tief.js";
const GRAPH = {
  importe: new Map([
    [TEXTTEST, [HILFE, EINGANG_QUELLE]],
    [HILFE, [TIEF]],
  ]),
};

function hilfsRepo(context) {
  return ausmistenRepo(context, {
    [TEXTTEST]: MIT_TEXT,
    [HILFE]: 'export { TIEF } from "./tief.js";\n',
    [TIEF]: "export const TIEF = 1;\n",
  });
}

function standDes(repo, kopf) {
  const lauf = { master: repo.master, kopf, verzeichnis: repo.ordner };
  return imBranch({ test: TEXTTEST, name: TEXTFALL }, lauf, [GRAPH]);
}

test("ausmisten-texttests: eine geänderte Hilfsdatei unter test/, die ein ausgenommener Fall über eine andere erreicht, wird als geänderte Hilfsdatei gemeldet", (context) => {
  const repo = hilfsRepo(context);
  const kopf = repo.committe({ [TIEF]: "export const TIEF = 2;\n" });
  assert.equal(standDes(repo, kopf), `Hilfsdatei geändert: ${TIEF}`);
});

test("ausmisten-texttests: eine ganz gleiche Testdatei mit gleichen Hilfsdateien gilt als unverändert", (context) => {
  const repo = hilfsRepo(context);
  const kopf = repo.committe(
    { [EINGANG_QUELLE]: "export function eingang(text) {\n  return text;\n}\n" },
    [DOPPELT],
  );
  assert.equal(standDes(repo, kopf), "unverändert");
});

function erwarteGeaendert(ergebnis, stand) {
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  const [ausgenommen] = ergebnis.gelesen.ausgenommen;
  assert.equal(ausgenommen.imBranch, stand);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  erwarteSichtbarOhneSperre(ergebnis, stand);
}

test("ausmisten-texttests: ein ausgenommener Fall in einer sonst geänderten Datei wird gemeldet, ohne zu sperren", async (context) => {
  const dateien = { [TEXTTEST]: MIT_TEXT };
  const neu = texttest(fall(TEXTFALL, LESEN), fall(VERHALTEN, KUERZEN), fall(ANDERER, TABULATOR));
  const ergebnis = await messeUndMelde(
    context,
    { weg: [DOPPELT], neu: { [TEXTTEST]: neu } },
    { dateien },
  );
  erwarteGeaendert(ergebnis, "Datei geändert");
});

test("ausmisten-texttests: ausgenommen-umfeld-geaendert: eine geänderte Konstante außerhalb des ausgenommenen Falls wird gemeldet, ohne zu sperren", async (context) => {
  const mitMuster = (muster) =>
    texttest(
      [`const MUSTER = ${JSON.stringify(muster)};`, ""],
      fall(TEXTFALL, MIT_MUSTER),
      fall(VERHALTEN, KUERZEN),
    );
  const dateien = { [TEXTTEST]: mitMuster("return text.trim();") };
  const ergebnis = await messeUndMelde(
    context,
    { weg: [DOPPELT], neu: { [TEXTTEST]: mitMuster("") } },
    { dateien },
  );
  erwarteGeaendert(ergebnis, "Datei geändert");
});

test("ausmisten-texttests: ein geänderter ausgenommener Fall wird als geändert festgehalten", async (context) => {
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

test("ausmisten-texttests: ein Texttest, dessen Name sich im Text nicht finden lässt, wird nicht ausgenommen", async (context) => {
  const dynamisch = [
    "test(`liest ${\"den\"} Quelltext`, () => {",
    ...LESEN.map((zeile) => `  ${zeile}`),
    "});",
    "",
  ];
  const { basis } = await basisMit(context, {
    master: texttest(dynamisch, fall(VERHALTEN, KUERZEN)),
    branch: texttest(fall(VERHALTEN, KUERZEN)),
  });
  assert.equal(basis.status, EXIT_ROT, basis.ausgabe);
  assert.match(
    basis.ausgabe,
    /„liest den Quelltext“ lässt sich im Text der Testdatei nicht eindeutig finden/,
  );
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
