import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_BAD_REQUEST = 400;
const PFLICHT_MELDUNG = { error: "to und objective sind Pflicht" };

const bestaetigungAnfordern = (srv, body) =>
  abrufMitFrist(`${srv.localUrl}/api/call-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("eine Anrufbestätigung ohne Rufnummer wird mit der Pflichtmeldung abgewiesen", async () => {
  const srv = await startServer();
  try {
    const antwort = await bestaetigungAnfordern(srv, { objective: "Termin vereinbaren" });

    assert.equal(antwort.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await antwort.json(), PFLICHT_MELDUNG);
  } finally {
    await srv.stop();
  }
});

test("eine Anrufbestätigung mit einer Zahl statt einer Rufnummer wird mit der Pflichtmeldung abgewiesen", async () => {
  const srv = await startServer();
  try {
    const antwort = await bestaetigungAnfordern(srv, { to: 4915112345678, objective: "Termin vereinbaren" });

    assert.equal(antwort.status, HTTP_BAD_REQUEST);
    assert.deepEqual(await antwort.json(), PFLICHT_MELDUNG);
  } finally {
    await srv.stop();
  }
});
