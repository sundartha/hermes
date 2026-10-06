import test from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";
import { maskNumber } from "../src/util.js";

const TO = "+4915112345678";
const sternImMuster = (text) => text.replace(/\*/g, "\\*");
const post = (url, to = TO) =>
  fetch(`${url}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, objective: "Test" }),
  });
const outbound = (srv) => srv.readStore().calls.filter((c) => c.direction === "outbound");

test("OUTBOUND_FROZEN=true sperrt jeden Outbound sofort (403, kein Originate)", async () => {
  const srv = await startServer({ env: { OUTBOUND_FROZEN: "true" } });
  try {
    const res = await post(srv.localUrl);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /gesperrt|OUTBOUND_FROZEN/);
    assert.equal(outbound(srv).length, 0, "Kill-Switch VOR createCall -> kein Call");
    await waitForLog(srv, new RegExp(`\\[audit\\] place_call_denied ip=\\S+ to=${sternImMuster(maskNumber(TO))} grund=frozen`));
    assert.equal(srv.stdout.includes(TO.slice(1)), false);
  } finally {
    await srv.stop();
  }
});

test("OUTBOUND_FROZEN default (false): Owner erreicht den Originate (Pfad 2, 500)", async () => {
  const srv = await startServer({});
  try {
    assert.equal((await post(srv.localUrl)).status, 500);
  } finally {
    await srv.stop();
  }
});
