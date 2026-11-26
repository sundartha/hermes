import { after, test } from "node:test";
import assert from "node:assert/strict";
import { startServer as startServerImpl, startServerExpectExit, waitForStoreState } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const MS_PER_SECOND = 1000;
const POLL_PUFFER_MS = 3000;
const DOMESTIC_TO = "+4915112345678";
const MAX_CALL_DURATION_CAP_S = 1800;
const BETREIBER_GRENZE_S = 1;

const gestartet = [];

async function startServer(env) {
  const srv = await startServerImpl({
    env: { ...vorspannMandantenUmgebung([BOOTSTRAP_TENANT_ID]), FRISTEN_TAKT_MS: "40", ...env },
  });
  gestartet.push(srv);
  return srv;
}

after(async () => {
  await Promise.all(gestartet.map((srv) => srv.stop()));
});

async function placeCall(srv) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: DOMESTIC_TO, objective: "Test" }),
  });
  assert.equal(res.status, HTTP_OK);
  return (await res.json()).callId;
}

async function angelegterAnruf(srv, callId) {
  const stand = await waitForStoreState(
    srv,
    (st) => st.calls.find((anruf) => anruf.id === callId),
    POLL_PUFFER_MS,
  );
  return stand.calls.find((anruf) => anruf.id === callId);
}

test("Betreiber-Grenze ANRUF_HOECHSTDAUER_S=1 beendet den Anruf ohne max_duration_s geordnet und bucht ihn", async () => {
  const srv = await startServer({ ANRUF_HOECHSTDAUER_S: String(BETREIBER_GRENZE_S) });
  const callId = await placeCall(srv);
  const stand = await waitForStoreState(
    srv,
    (st) => st.calls.find((anruf) => anruf.id === callId)?.billedAt,
    BETREIBER_GRENZE_S * MS_PER_SECOND + POLL_PUFFER_MS,
  );
  const call = stand.calls.find((anruf) => anruf.id === callId);
  assert.equal(call.maxDurationS, BETREIBER_GRENZE_S);
  assert.equal(call.status, "completed");
  assert.ok(call.endedAt);
});

test("Betreiber-Grenze ANRUF_HOECHSTDAUER_S=1800 verlaengert die Bremse aus Restguthaben und Plan nicht", async () => {
  const ohne = await startServer({});
  const mit = await startServer({ ANRUF_HOECHSTDAUER_S: String(MAX_CALL_DURATION_CAP_S) });
  const bremse = (await angelegterAnruf(ohne, await placeCall(ohne))).maxDurationS;
  const gesetzt = (await angelegterAnruf(mit, await placeCall(mit))).maxDurationS;
  assert.ok(bremse > BETREIBER_GRENZE_S);
  assert.equal(gesetzt, bremse);
});

for (const ungueltig of ["0", "-5", "abc", "1801"]) {
  test(`Betreiber-Grenze ANRUF_HOECHSTDAUER_S=${ungueltig} bricht den Start fail-closed ab`, async () => {
    const { code, output } = await startServerExpectExit({ env: { ANRUF_HOECHSTDAUER_S: ungueltig } });
    assert.notEqual(code, 0);
    assert.match(output, /ANRUF_HOECHSTDAUER_S/);
  });
}
