import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog } from "./helpers.js";

const SEED_FROM = "+15005550006";
const SEED_TO = "+4915112345678";

const postForm = (srv, path) =>
  fetch(`${srv.localUrl}${path}`, { method: "POST", body: new URLSearchParams({}) });

test("/voice/turn + /voice/outbound: unbekannter/inaktiver Call -> Hangup MIT Logzeile, PII-frei", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [seedCall({ id: "ul_done", status: "completed" })],
    }),
  });
  try {
    let res = await postForm(srv, "/voice/turn?callId=ul_missing");
    assert.equal(res.status, 200);
    let xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/turn\] kein aktiver Call \(callId=ul_missing unbekannt\) -> Hangup/);

    res = await postForm(srv, "/voice/turn?callId=ul_done");
    assert.equal(res.status, 200);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/turn\] kein aktiver Call \(callId=ul_done status=completed\) -> Hangup/);

    res = await postForm(srv, "/voice/outbound?callId=ul_missing");
    assert.equal(res.status, 200);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/outbound\] unbekannter Call \(callId=ul_missing\) -> Hangup/);

    const lines = srv.stdout
      .split("\n")
      .filter((l) => l.includes("[voice/turn]") || l.includes("[voice/outbound]"));
    assert.ok(lines.length >= 3, `drei Logzeilen erwartet:\n${srv.stdout}`);
    for (const l of lines) {
      assert.ok(!l.includes(SEED_FROM), `From-Nummer im Log (PII): ${l}`);
      assert.ok(!l.includes(SEED_TO), `To-Nummer im Log (PII): ${l}`);
    }
  } finally {
    await srv.stop();
  }
});
