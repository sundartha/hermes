import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFPAUSE_PATH, makeInternAnrufpauseRoutes } from "../../src/routes/intern-anrufpause.js";
import { DEPLOY_TOKEN_MIN_LENGTH } from "../../src/routes/intern-anrufe-laufend.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./routen-server.js";

const HTTP_OK = 200;
const TOKEN = "t".repeat(DEPLOY_TOKEN_MIN_LENGTH);
const LOGMARKE = "[anrufpause] nicht lesbar, gilt als aktiv:";

async function pauseLesen(store) {
  const zeilen = [];
  const { error } = console;
  console.error = (...teile) => zeilen.push(teile.join(" "));
  try {
    const router = makeInternAnrufpauseRoutes({ config: { auth: { deployToken: TOKEN } }, store });
    const antwort = await mitRoutenServer(router, (basis) =>
      abrufMitFrist(`${basis}${ANRUFPAUSE_PATH}`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    );
    return { status: antwort.status, koerper: await antwort.json(), zeilen };
  } finally {
    console.error = error;
  }
}

const FAELLE = [
  ["Error", new Error("kaputt"), "kaputt"],
  ["Text", "boom", "boom"],
  ["Zahl", 42, "42"],
  ["null", null, "null"],
];

for (const [art, geworfen, text] of FAELLE) {
  test(`Anrufpause nicht lesbar (${art}): gilt als aktiv und die Logzeile nennt ${text}`, async () => {
    const store = { anrufpauseGelesen: () => Promise.reject(geworfen) };
    const antwort = await pauseLesen(store);
    assert.equal(antwort.status, HTTP_OK);
    assert.deepEqual(antwort.koerper, { an: true });
    assert.deepEqual(antwort.zeilen, [`${LOGMARKE} ${text}`]);
  });
}
