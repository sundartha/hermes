import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const GRENZE = 128;
const MANDANT = "owner";

const ROUTEN = [
  ["POST", (id) => `/api/calls/${id}/cancel`, undefined],
  ["GET", (id) => `/api/calls/${id}/consult`, undefined],
  ["POST", (id) => `/api/calls/${id}/consult/answer`, { event_id: "c0", answers: ["a"] }],
];

const rufe = (srv, [methode, pfad, body], id) =>
  abrufMitFrist(`${srv.localUrl}${pfad(id)}`, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function mitServer(run) {
  const srv = await startServer({
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true", ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedState({
      calls: [seedCall({ id: "call_pfad", status: "completed" })],
      profiles: { [MANDANT]: { allowConsult: true } },
    }),
  });
  try {
    return await run(srv);
  } finally {
    await srv.stop();
  }
}

test("pfad-kennung-geprueft: eine Anruf-Kennung ueber der Grenze wird mit 400 invalid_body abgewiesen", async () => {
  await mitServer(async (srv) => {
    for (const route of ROUTEN) {
      const res = await rufe(srv, route, "x".repeat(GRENZE + 1));
      assert.equal(res.status, HTTP_BAD_REQUEST, route[1]("x"));
      assert.deepEqual(await res.json(), { error: "invalid_body" }, route[1]("x"));
    }
  });
});

test("pfad-kennung-geprueft: eine Kennung genau an der Grenze wird angenommen und als unbekannt mit 404 beantwortet", async () => {
  await mitServer(async (srv) => {
    for (const route of ROUTEN) {
      const res = await rufe(srv, route, "x".repeat(GRENZE));
      assert.equal(res.status, HTTP_NOT_FOUND, route[1]("x"));
      assert.deepEqual(await res.json(), { error: "not found" }, route[1]("x"));
    }
  });
});

test("pfad-kennung-geprueft: eine gueltige Kennung verhaelt sich unveraendert", async () => {
  await mitServer(async (srv) => {
    const res = await rufe(srv, ROUTEN[0], "call_pfad");
    assert.deepEqual(await res.json(), { status: "completed" });
  });
});
