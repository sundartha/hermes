// outbound-p3: globaler Outbound-Kill-Switch OUTBOUND_FROZEN. Ein Konzept pro Test (P14):
// (1) FROZEN=true friert JEDEN Outbound sofort (403, kein Originate) - die Notbremse;
// (2) Default (false) ist byte-identisch zum Bestand (derselbe Owner-Call erreicht den Originate).
//
// Reiner Spawn (startServer + readStore), KEIN pglite (Lehre p6a-Stall). Owner-Kontext ueber
// localhost ohne Identitaets-Header (Tenant Null) - der Owner ist via Boot-Seed ein aktiver
// Subscriber und telefonierte sonst ueber Pfad 2 (vgl. w5-abo-allowlist-gate.test.js W5-5a).
// Offline-Diskriminator: 500 = alle Gates passiert (originateCall wirft ohne
// TELNYX_API_KEY, s. BASE_ENV in helpers.js), 403 = ein Gate hat gesperrt.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, waitForLog } from "./helpers.js";
import { maskNumber } from "../src/util.js";

const TO = "+4915112345678"; // normales DE-Ziel (kein Premium/Notruf)
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
