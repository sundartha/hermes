import assert from "node:assert/strict";
import { test } from "node:test";

import { startServer, seedState, seedCall } from "../helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
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

test("pfad-kennung-geprueft: eine abgewiesene Kennung loest keine Wirkung am Anruf aus", async () => {
  const lang = "y".repeat(GRENZE + 1);
  const srv = await startServer({
    env: { ...vorspannMandantenUmgebung([MANDANT]), CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true", ALLOWED_COUNTRY_CODES: "+49" },
    seed: seedState({
      calls: [seedCall({ id: lang, status: "active" })],
      profiles: { [MANDANT]: { allowConsult: true } },
    }),
  });
  try {
    const antwort = await rufe(
      srv,
      ROUTEN[2],
      lang,
    );
    assert.equal(antwort.status, HTTP_BAD_REQUEST);
    const abbruch = await rufe(srv, ROUTEN[0], lang);
    assert.equal(abbruch.status, HTTP_BAD_REQUEST);
    const abfrage = await rufe(srv, ROUTEN[1], lang);
    assert.equal(abfrage.status, HTTP_BAD_REQUEST);
    assert.doesNotMatch(srv.stdout, /ERR_HTTP_HEADERS_SENT/);
    const anrufe = srv.readStore().calls;
    assert.equal(anrufe.find((c) => c.id === lang).status, "active");
  } finally {
    await srv.stop();
  }
});
