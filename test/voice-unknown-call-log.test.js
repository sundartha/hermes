// Runde 2 (S-A, Diagnose-Logging): /voice/turn und /voice/outbound legen bei
// unbekanntem bzw. nicht mehr aktivem Call fail-closed auf (Bestand, unveraendert),
// loggen den Vorfall jetzt aber - vorher war der Hangup STILL und ein durch einen
// Deploy-Instanzwechsel getoetetes Live-Gespraech (Testanruf call_mr3lg2g7t9zg,
// 2026-07-02) in den Render-Logs unsichtbar (CLAUDE.md Regel 7). Dieser Test pinnt:
//   a) /voice/turn unbekannte callId      -> <Hangup/> + Logzeile "unbekannt"
//   b) /voice/turn Call nicht mehr aktiv  -> <Hangup/> + Logzeile "status=completed"
//   c) /voice/outbound unbekannte callId  -> <Hangup/> + Logzeile
//   d) Logzeilen sind PII-frei (keine Telefonnummern; callId ist server-generiert)
// Rein offline (helpers.startServer-Kindprozess), kein LLM-Pfad: beide Handler
// early-returnen VOR extractSpeech/agentTurn.
// F12 (A6): Nach dem Re-Attach-Umbau haengt der fail-closed Hangup + Warn-Log am
// json-Pfad (attachActiveCall == getCall -> im fail-closed Zweig immer logUnknown:true).
// Dieser Test pinnt, dass das Bestandsverhalten (Hangup + PII-freies Log) unter
// STORE_BACKEND=json byte-identisch bleibt. Assertions bewusst UNVERAENDERT.
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
    // a) /voice/turn mit unbekannter callId -> Hangup-TeXML + Logzeile.
    let res = await postForm(srv, "/voice/turn?callId=ul_missing");
    assert.equal(res.status, 200);
    let xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/turn\] kein aktiver Call \(callId=ul_missing unbekannt\) -> Hangup/);

    // b) /voice/turn mit bekanntem, aber beendetem Call -> Hangup + status im Log.
    res = await postForm(srv, "/voice/turn?callId=ul_done");
    assert.equal(res.status, 200);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/turn\] kein aktiver Call \(callId=ul_done status=completed\) -> Hangup/);

    // c) /voice/outbound mit unbekannter callId -> Hangup + Logzeile.
    res = await postForm(srv, "/voice/outbound?callId=ul_missing");
    assert.equal(res.status, 200);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/outbound\] unbekannter Call \(callId=ul_missing\) -> Hangup/);

    // d) PII-Gate: die neuen Logzeilen tragen keine Telefonnummern.
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
