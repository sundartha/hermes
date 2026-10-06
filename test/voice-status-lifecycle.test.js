import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState, seedCall, waitForLog, waitForStoreState } from "./helpers.js";

const SEED_FROM = "+15005550006";
const SEED_TO = "+4915112345678";

async function statusEvent(srv, callId) {
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
  const line = srv.stdout
    .split("\n")
    .find((l) => l.includes("[voice/status]") && l.includes(`"callId":"${callId}"`));
  return JSON.parse(line.slice(line.indexOf("{")));
}

const postStatus = (srv, callId, fields) =>
  fetch(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });

const storedCall = (store, callId) => store.calls.find((call) => call.id === callId);

test("/voice/status provider-bewusst: Telnyx-Lifecycle + Diagnose + Store-Effekt + PII-frei", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({ id: "st_tnx_done", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_ans", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_unk", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_unk_dur", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_default_prog", status: "active" }),
      ],
    }),
  });
  try {
    let r = await postStatus(srv, "st_unknown_xyz", {
      CallStatus: "completed",
      CallDuration: "99",
    });
    assert.equal(r.status, 200);

    r = await postStatus(srv, "st_tnx_done", { CallStatus: "completed", CallDuration: "45" });
    assert.equal(r.status, 200);
    let ev = await statusEvent(srv, "st_tnx_done");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, { callDurationS: 45 });

    r = await postStatus(srv, "st_tnx_ans", { CallStatus: "answered" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_ans");
    assert.equal(ev.provider, "telnyx");
    assert.deepEqual(ev.diagnostics, {});

    r = await postStatus(srv, "st_tnx_unk", { CallStatus: "ringing" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_unk");
    assert.equal(ev.status, "ringing");
    assert.deepEqual(ev.diagnostics, {});

    r = await postStatus(srv, "st_tnx_unk_dur", { CallStatus: "ringing", CallDuration: "12" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_unk_dur");
    assert.deepEqual(ev.diagnostics, { callDurationS: 12 });

    r = await postStatus(srv, "st_default_prog", { CallStatus: "in-progress" });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_default_prog");
    assert.equal(ev.provider, "telnyx", "Call ohne provider faellt bewusst auf DEFAULT_PROVIDER");
    await waitForStoreState(srv, (store) => storedCall(store, "st_default_prog").answeredAt);

    const calls = Object.fromEntries(srv.readStore().calls.map((c) => [c.id, c]));
    assert.equal(calls.st_tnx_done.status, "completed");
    assert.ok(calls.st_tnx_done.endedAt, "completed: endedAt muss gesetzt sein");
    assert.ok(calls.st_tnx_ans.answeredAt, "answered: answeredAt muss gesetzt sein");
    assert.equal(calls.st_tnx_ans.status, "active");
    assert.ok(calls.st_default_prog.answeredAt, "in-progress: answeredAt muss gesetzt sein");
    assert.equal(calls.st_tnx_unk.answeredAt, null);
    assert.equal(calls.st_tnx_unk.status, "active");

    assert.ok(
      !srv.stdout.includes('"callId":"st_unknown_xyz"'),
      `Unbekannter Call darf keine [voice/status]-Zeile erzeugen:\n${srv.stdout}`,
    );

    const statusLines = srv.stdout.split("\n").filter((l) => l.includes("[voice/status]"));
    assert.ok(statusLines.length >= 5, "alle bekannten Faelle muessen geloggt sein");
    for (const l of statusLines) {
      assert.ok(!l.includes(SEED_FROM), `From-Nummer im Log (PII): ${l}`);
      assert.ok(!l.includes(SEED_TO), `To-Nummer im Log (PII): ${l}`);
    }
  } finally {
    await srv.stop();
  }
});

test("/voice/status Telnyx: Hangup-Ursache wird PII-frei als Diagnose geloggt", async () => {
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({ id: "st_tnx_hangup", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_hangup_dirty", provider: "telnyx", status: "active" }),
        seedCall({ id: "st_tnx_noanswer", provider: "telnyx", status: "active" }),
      ],
    }),
  });
  try {
    let r = await postStatus(srv, "st_tnx_hangup", {
      CallStatus: "completed",
      CallDuration: "30",
      HangupCause: "normal_clearing",
      HangupSource: "callee",
      SipHangupCause: "486",
    });
    assert.equal(r.status, 200);
    let ev = await statusEvent(srv, "st_tnx_hangup");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, {
      callDurationS: 30,
      hangupCause: "normal_clearing",
      hangupSource: "callee",
      sipHangupCause: "486",
    });

    const dirty = `+491511234 ${"x".repeat(60)}`;
    r = await postStatus(srv, "st_tnx_hangup_dirty", {
      CallStatus: "failed",
      HangupCause: dirty,
      HangupSource: "Erika Mustermann",
      SipHangupCause: "603",
    });
    assert.equal(r.status, 200);
    ev = await statusEvent(srv, "st_tnx_hangup_dirty");
    assert.deepEqual(ev.diagnostics, { sipHangupCause: "603" });
    assert.ok(
      !srv.stdout.includes("491511234"),
      `Unsauberes Hangup-Feld darf nicht ins Log: ${srv.stdout}`,
    );
    assert.ok(
      !srv.stdout.includes("Erika Mustermann"),
      `Mehrwort-Freitext darf nicht ins Log: ${srv.stdout}`,
    );

    r = await postStatus(srv, "st_tnx_noanswer", { CallStatus: "no-answer", SipHangupCause: "487" });
    assert.equal(r.status, 200);
    await statusEvent(srv, "st_tnx_noanswer");
    await waitForStoreState(srv, (store) => storedCall(store, "st_tnx_noanswer").endedAt);

    const calls = Object.fromEntries(srv.readStore().calls.map((c) => [c.id, c]));
    assert.ok(calls.st_tnx_hangup.endedAt, "completed: endedAt muss gesetzt sein");
    assert.ok(calls.st_tnx_hangup_dirty.endedAt, "failed: endedAt muss gesetzt sein");
    assert.equal(calls.st_tnx_noanswer.failureReason, "no-answer", "no-answer: Status gewinnt");
    assert.equal(
      calls.st_tnx_hangup_dirty.failureReason,
      "unreachable:invite-603",
      "failed + SIP 603 -> unreachable:invite-603 (sipBase, S2-1)",
    );
    assert.ok(calls.st_tnx_hangup.failureReason == null, "completed: kein failureReason");
  } finally {
    await srv.stop();
  }
});
