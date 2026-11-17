import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFPAUSE_PATH, makeInternAnrufpauseRoutes } from "../../src/routes/intern-anrufpause.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./routen-server.js";

const TOKEN = "t".repeat(32);
const FALSCH = "f".repeat(32);

function routen() {
  const store = { setzeAnrufpause: async () => {}, anrufpauseAktiv: () => false };
  return makeInternAnrufpauseRoutes({ config: { auth: { deployToken: TOKEN } }, store });
}

async function zeilenBeiPost(token) {
  const zeilen = [];
  const merken = (...teile) => zeilen.push(teile.join(" "));
  const { log } = console;
  console.log = merken;
  try {
    await mitRoutenServer(
      routen(),
      (basis) =>
        abrufMitFrist(`${basis}${ANRUFPAUSE_PATH}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ an: true }),
        }),
      {},
    );
  } finally {
    console.log = log;
  }
  return zeilen;
}

test("Audit ohne Anfrage nennt ip=system und Details", async () => {
  assert.deepEqual(await zeilenBeiPost(TOKEN), ["[audit] anrufpause_gesetzt ip=system an=true"]);
});

test("Audit bei abgewiesenem Token nennt Adresse, Pfad und Grund", async () => {
  const zeilen = await zeilenBeiPost(FALSCH);
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /^\[audit\] auth_failed ip=\S*127\.0\.0\.1 path=\/intern\/anrufpause grund=deploy_token$/);
});
