import assert from "node:assert/strict";
import { test } from "node:test";

import { DOPPELT } from "./ausmisten/hilfen.mjs";
import { messeUndMelde, testDatei } from "./ausmisten/messung.mjs";

test("ausmisten-basis-rot: eine rote Basis-Messung scheitert mit ihrer Ausgabe statt an einem fehlenden Artefakt", async (context) => {
  const dateien = {
    [DOPPELT]: testDatei(
      "../../src/post/eingang.js",
      "scheitert schon auf master",
      'assert.equal(modul.eingang("  a  "), "b");',
    ),
  };
  const fehler = await messeUndMelde(context, { weg: [DOPPELT] }, { dateien }).then(
    () => new Error("messeUndMelde ist trotz roter Basis-Messung durchgelaufen"),
    (grund) => grund,
  );
  assert.equal(fehler.code, "ERR_ASSERTION", fehler.message);
  assert.match(fehler.message, /Basis-Messung für Paket 0 nicht grün:/);
  assert.match(fehler.message, /besteht auch ohne Umbau der Quelldateien nicht/);
});
