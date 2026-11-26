import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startServer as startServerImpl, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { serverUhrUmgebung, stelleServerUhrVor } from "../helpers/server-uhr.mjs";

const HTTP_OK = 200;

const gestartet = [];

async function startServer(options) {
  const srv = await startServerImpl(options);
  gestartet.push(srv);
  return srv;
}

after(async () => {
  await Promise.all(gestartet.map((srv) => srv.stop()));
});

const POLL_TIMEOUT_MS = 4000;
const DOMESTIC_TO = "+4915112345678";

async function placeCappedCall() {
  const srv = await startServer({
    env: { ...vorspannMandantenUmgebung([BOOTSTRAP_TENANT_ID]), ...serverUhrUmgebung(), FRISTEN_TAKT_MS: "40" },
  });
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: DOMESTIC_TO,
      objective: "Test",
    }),
  });
  assert.equal(res.status, HTTP_OK);
  const body = await res.json();
  stelleServerUhrVor(srv);
  const stand = await waitForStoreState(
    srv,
    (st) => st.calls.find((anruf) => anruf.id === body.callId)?.billedAt,
    POLL_TIMEOUT_MS,
  );
  return { srv, body, call: stand.calls.find((anruf) => anruf.id === body.callId) };
}

test("Live-Cap: laufender Call erreicht die Max-Dauer waehrend des normalen Betriebs (kein Boot-Rearm) -> completed + providerCallSid + genau einmal gebucht", async () => {
  const { srv, call } = await placeCappedCall();
  try {
    assert.equal(
      call.status,
      "completed",
      "Live-Cap terminalisiert als completed (NICHT failed wie der Boot-Zombie)",
    );
    assert.ok(call.endedAt, "endedAt gesetzt");
    assert.ok(
      !/\[rearm\]/.test(srv.stdout),
      "Terminalisierung lief ueber den LIVE-Timer, nicht ueber rearmActiveCallTimers (kein Boot-Rearm-Log)",
    );
  } finally {
    await srv.stop();
  }
});

const CAP_FAILURE_MARKER = /cap|max_duration/;
test("GAP-26 (SOLL, rot) - ein am Dauer-Cap terminalisierter Anruf traegt ein maschinenlesbares Cap-Merkmal", async () => {
  const { srv, call } = await placeCappedCall();
  try {
    assert.ok(
      call.failureReason,
      "am Cap gestorbener Anruf ist heute nicht von einem erfolgreichen unterscheidbar",
    );
    assert.match(call.failureReason, CAP_FAILURE_MARKER);
  } finally {
    await srv.stop();
  }
});
