import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer, seedState, seedCall, waitForLog, waitForStoreState } from "../helpers.js";

const BEKANNTE_STATUSFAELLE = 5;
const ERWARTETE_LOGZEILEN = 3;
const LANGER_ROHTEXT = 60;

const HTTP_OK = 200;

const SEED_FROM = "+15005550006";
const SEED_TO = "+4915112345678";

function pruefeOhneRufnummern(logZeilen) {
  for (const zeile of logZeilen) {
    assert.ok(!zeile.includes(SEED_FROM), `From-Nummer im Log (PII): ${zeile}`);
    assert.ok(!zeile.includes(SEED_TO), `To-Nummer im Log (PII): ${zeile}`);
  }
}

async function statusEvent(srv, callId) {
  await waitForLog(srv, new RegExp(`\\[voice/status\\][^\\n]*"callId":"${callId}"`));
  const line = srv.stdout
    .split("\n")
    .find((zeile) => zeile.includes("[voice/status]") && zeile.includes(`"callId":"${callId}"`));
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
    let antwort = await postStatus(srv, "st_unknown_xyz", {
      CallStatus: "completed",
      CallDuration: "99",
    });
    assert.equal(antwort.status, HTTP_OK);

    antwort = await postStatus(srv, "st_tnx_done", { CallStatus: "completed", CallDuration: "45" });
    assert.equal(antwort.status, HTTP_OK);
    let ev = await statusEvent(srv, "st_tnx_done");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, { callDurationS: 45 });

    antwort = await postStatus(srv, "st_tnx_ans", { CallStatus: "answered" });
    assert.equal(antwort.status, HTTP_OK);
    ev = await statusEvent(srv, "st_tnx_ans");
    assert.equal(ev.provider, "telnyx");
    assert.deepEqual(ev.diagnostics, {});

    antwort = await postStatus(srv, "st_tnx_unk", { CallStatus: "ringing" });
    assert.equal(antwort.status, HTTP_OK);
    ev = await statusEvent(srv, "st_tnx_unk");
    assert.equal(ev.status, "ringing");
    assert.deepEqual(ev.diagnostics, {});

    antwort = await postStatus(srv, "st_tnx_unk_dur", {
      CallStatus: "ringing",
      CallDuration: "12",
    });
    assert.equal(antwort.status, HTTP_OK);
    ev = await statusEvent(srv, "st_tnx_unk_dur");
    assert.deepEqual(ev.diagnostics, { callDurationS: 12 });

    antwort = await postStatus(srv, "st_default_prog", { CallStatus: "in-progress" });
    assert.equal(antwort.status, HTTP_OK);
    ev = await statusEvent(srv, "st_default_prog");
    assert.equal(ev.provider, "telnyx", "Call ohne provider faellt bewusst auf DEFAULT_PROVIDER");
    await waitForStoreState(srv, (store) => storedCall(store, "st_default_prog").answeredAt);

    const calls = Object.fromEntries(srv.readStore().calls.map((anruf) => [anruf.id, anruf]));
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

    const statusLines = srv.stdout.split("\n").filter((zeile) => zeile.includes("[voice/status]"));
    assert.ok(
      statusLines.length >= BEKANNTE_STATUSFAELLE,
      "alle bekannten Faelle muessen geloggt sein",
    );
    pruefeOhneRufnummern(statusLines);
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
    let antwort = await postStatus(srv, "st_tnx_hangup", {
      CallStatus: "completed",
      CallDuration: "30",
      HangupCause: "normal_clearing",
      HangupSource: "callee",
      SipHangupCause: "486",
    });
    assert.equal(antwort.status, HTTP_OK);
    let ev = await statusEvent(srv, "st_tnx_hangup");
    assert.equal(ev.provider, "telnyx");
    assert.equal(ev.status, "completed");
    assert.deepEqual(ev.diagnostics, {
      callDurationS: 30,
      hangupCause: "normal_clearing",
      hangupSource: "callee",
      sipHangupCause: "486",
    });

    const dirty = `+491511234 ${"x".repeat(LANGER_ROHTEXT)}`;
    antwort = await postStatus(srv, "st_tnx_hangup_dirty", {
      CallStatus: "failed",
      HangupCause: dirty,
      HangupSource: "Erika Mustermann",
      SipHangupCause: "603",
    });
    assert.equal(antwort.status, HTTP_OK);
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

    antwort = await postStatus(srv, "st_tnx_noanswer", {
      CallStatus: "no-answer",
      SipHangupCause: "487",
    });
    assert.equal(antwort.status, HTTP_OK);
    await statusEvent(srv, "st_tnx_noanswer");
    await waitForStoreState(srv, (store) => storedCall(store, "st_tnx_noanswer").endedAt);

    const calls = Object.fromEntries(srv.readStore().calls.map((anruf) => [anruf.id, anruf]));
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
    assert.equal(res.status, HTTP_OK);
    let xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(
      srv,
      /\[voice\/turn\] kein aktiver Call \(callId=ul_missing unbekannt\) -> Hangup/,
    );

    res = await postForm(srv, "/voice/turn?callId=ul_done");
    assert.equal(res.status, HTTP_OK);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(
      srv,
      /\[voice\/turn\] kein aktiver Call \(callId=ul_done status=completed\) -> Hangup/,
    );

    res = await postForm(srv, "/voice/outbound?callId=ul_missing");
    assert.equal(res.status, HTTP_OK);
    xml = await res.text();
    assert.match(xml, /<Hangup\s*\/>/, `Hangup erwartet: ${xml}`);
    await waitForLog(srv, /\[voice\/outbound\] unbekannter Call \(callId=ul_missing\) -> Hangup/);

    const lines = srv.stdout
      .split("\n")
      .filter((zeile) => zeile.includes("[voice/turn]") || zeile.includes("[voice/outbound]"));
    assert.ok(lines.length >= ERWARTETE_LOGZEILEN, `drei Logzeilen erwartet:\n${srv.stdout}`);
    pruefeOhneRufnummern(lines);
  } finally {
    await srv.stop();
  }
});
