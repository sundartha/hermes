// GAP-21: /voice/outbound legt bei EINDEUTIGEM Maschinen-Ergebnis auf (kein Say/Gather,
// nur Hangup), sonst bleibt der Bestandspfad (Offenlegung + Anliegen im Gather) byte-
// identisch - unabhaengig davon, ob AnsweredBy fehlt/unbekannt ist oder "human" liefert.
// Flag AUS -> byte-identischer Bestand, auch bei AnsweredBy=machine_start (Rollback-Beweis).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall } from "./helpers.js";
import { GATHER_OPEN, HANGUP_TAG, DISCLOSURE_JONAS } from "./_outbound-harness.js";

const CALL_ID = "call_amd1";
const CALL_SID = "CAtest";

async function fetchOutbound(env, answeredBy) {
  const srv = await startServer({
    env,
    seed: seedState({
      calls: [seedCall({ id: CALL_ID, provider: "telnyx", status: "active", direction: "outbound" })],
    }),
  });
  try {
    const body = new URLSearchParams({ CallSid: CALL_SID });
    if (answeredBy !== undefined) body.set("AnsweredBy", answeredBy);
    const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${CALL_ID}`, { method: "POST", body });
    return { status: res.status, body: await res.text() };
  } finally {
    await srv.stop();
  }
}

const FLAG_ON = { MACHINE_DETECTION_ENABLED: "true" };

test("Flag AN + AnsweredBy=machine_start -> Hangup, kein Say/Gather", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "machine_start");
  assert.equal(status, 200);
  assert.ok(body.includes(HANGUP_TAG), `Hangup erwartet: ${body}`);
  assert.ok(!body.includes(GATHER_OPEN), `kein Gather erwartet: ${body}`);
  assert.ok(!/<Say[ >]/.test(body), `kein Say erwartet: ${body}`);
});

test("Flag AN + AnsweredBy=unknown -> Bestands-XML mit Offenlegungssatz", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "unknown");
  assert.equal(status, 200);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});

test("Flag AN + AnsweredBy=human -> Bestands-XML mit Offenlegungssatz", async () => {
  const { status, body } = await fetchOutbound(FLAG_ON, "human");
  assert.equal(status, 200);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});

test("Flag AUS + AnsweredBy=machine_start -> Bestands-XML (Rollback-Beweis)", async () => {
  const { status, body } = await fetchOutbound({}, "machine_start");
  assert.equal(status, 200);
  assert.ok(body.includes(GATHER_OPEN), `Gather erwartet: ${body}`);
  assert.ok(body.includes(DISCLOSURE_JONAS), `Offenlegung erwartet: ${body}`);
});
