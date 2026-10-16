import assert from "node:assert/strict";
import { test } from "node:test";

import { basisMit } from "./ausmisten-texttests-hilfen.js";
import { EXIT_GRUEN, EXIT_ROT, messeUndMelde } from "./ausmisten/messung.mjs";
import {
  KUERZEN,
  LESEN,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

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
