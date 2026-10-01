import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";

import { startServer } from "../helpers.js";

const PHONE = "+4915112345678";
const SUBSCRIBER_DIGITS = "15112345678";
const BROKEN_ESCAPE = "%E0%A4%A";
const LOGGED_ERROR_KIND = "URIError";
const LOG_WAIT_MS = 5000;
const LOG_POLL_MS = 50;

const hermes = {};

before(async () => {
  hermes.srv = await startServer();
});

after(async () => {
  await hermes.srv?.stop();
});

async function logLinesSince(offset) {
  const deadline = Date.now() + LOG_WAIT_MS;
  while (Date.now() < deadline) {
    const log = hermes.srv.stdout.slice(offset);
    if (log.includes(LOGGED_ERROR_KIND)) return log;
    await sleep(LOG_POLL_MS);
  }
  assert.fail(`Kein ${LOGGED_ERROR_KIND} im Server-Log angekommen`);
}

test("SG-13 Server-Log enthält keine volle Telefonnummer aus einer kaputt kodierten Adresse", async () => {
  const offset = hermes.srv.stdout.length;
  await fetch(`${hermes.srv.localUrl}/api/calls/${PHONE}${BROKEN_ESCAPE}`);

  const log = await logLinesSince(offset);

  assert.equal(log.includes(SUBSCRIBER_DIGITS), false);
});
