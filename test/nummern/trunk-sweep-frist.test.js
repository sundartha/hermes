import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  EL_INBOUND_ACCESS_BOOT_ENV,
  TELNYX_TEST_TENANT_NUMBER,
  seedWithTelnyxNumber,
  startServer,
  waitForLog,
} from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.ts";

const FRIST_MS = 10000;
const E2E_FRIST_MS = 10000;
const HTTP_UNAVAILABLE = 503;
const SOFORT_ABGELAUFEN = `const echt = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = (ms) => ms === ${FRIST_MS} ? AbortSignal.abort(new DOMException("frist", "TimeoutError")) : echt(ms);`;
const ENDUNG = `…${TELNYX_TEST_TENANT_NUMBER.slice(-4)}`;

async function startFakeEl(verhalten) {
  const haengende = [];
  const empfangen = { anzahl: 0 };
  const server = http.createServer((req, res) => {
    empfangen.anzahl += 1;
    if (verhalten === "haengt") haengende.push(res);
    else if (verhalten === "abbruch") req.socket.destroy();
    else res.writeHead(HTTP_UNAVAILABLE).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    basis: `http://127.0.0.1:${server.address().port}`,
    empfangen,
    stop: () => {
      for (const res of haengende) res.destroy();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

async function sweepLog(verhalten, zusatzEnv = {}) {
  const fakeEl = await startFakeEl(verhalten);
  const seed = seedWithTelnyxNumber();
  seed.numbers[0].providerAgentPhoneNumberId = "phnum_frist";
  let srv;
  try {
    srv = await startServer({
      env: {
        ELEVENLABS_INBOUND_ENABLED: "true",
        ELEVENLABS_INBOUND_TENANT_IDS: BOOTSTRAP_TENANT_ID,
        ...EL_INBOUND_ACCESS_BOOT_ENV,
        ELEVENLABS_API_KEY: "key-frist-test",
        ELEVENLABS_API_BASE: fakeEl.basis,
        ELEVENLABS_AGENT_ID: "agent_frist",
        ...zusatzEnv,
      },
      seed,
    });
    await waitForLog(srv, /\[el-trunk\] sweep fertig/, E2E_FRIST_MS);
    return { text: srv.stdout, anfragen: fakeEl.empfangen.anzahl, nummer: srv.readStore().numbers[0] };
  } finally {
    await srv?.stop();
    await fakeEl.stop();
  }
}

test("Haengender Abruf wird nach der Frist abgebrochen: status=timeout im Log, Nummer nicht belegt", async () => {
  const lauf = await sweepLog("haengt", { NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(SOFORT_ABGELAUFEN)}` });
  assert.match(lauf.text, new RegExp(`\\[el-trunk\\] abruf_fehler endung=${ENDUNG} status=timeout\\n`));
  assert.match(lauf.text, /sweep fertig aktiv=1 belegt=0 repariert=0 abweichung=0 unbekannt=1/);
  assert.equal(lauf.nummer.elInboundTrunkBelegtAt, undefined);
});

test("Anbieter antwortet 503: status=503 im Log, Nummer nicht belegt", async () => {
  const lauf = await sweepLog("503");
  assert.match(lauf.text, new RegExp(`\\[el-trunk\\] abruf_fehler endung=${ENDUNG} status=503\\n`));
  assert.match(lauf.text, /sweep fertig aktiv=1 belegt=0 .*unbekannt=1/);
  assert.equal(lauf.nummer.elInboundTrunkBelegtAt, undefined);
});

test("Verbindungsabbruch ohne Status: status=fehler, ohne Schluessel im Log", async () => {
  const lauf = await sweepLog("abbruch");
  assert.match(lauf.text, new RegExp(`\\[el-trunk\\] abruf_fehler endung=${ENDUNG} status=fehler\\n`));
  assert.equal(lauf.text.includes("key-frist-test"), false);
});
