import assert from "node:assert/strict";
import { test } from "node:test";

import { artefakt, basisMit } from "./ausmisten-texttests-hilfen.js";
import { DOPPELT } from "./ausmisten/hilfen.mjs";
import { EXIT_GRUEN, EXIT_ROT, messeUndMelde } from "./ausmisten/messung.mjs";
import {
  KUERZEN,
  LESEN,
  MIT_TEXT,
  TEXTFALL,
  TEXTTEST,
  VERHALTEN,
  fall,
  texttest,
} from "./ausmisten/texttest.mjs";

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
