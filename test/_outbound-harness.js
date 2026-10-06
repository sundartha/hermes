import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState, seedCall } from "./helpers.js";

export const DISCLOSURE_JONAS =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
export const GATHER_OPEN = "<Gather";
export const HANGUP_TAG = "<Hangup";

export function assertDisclosureInGather(body, disclosure = DISCLOSURE_JONAS) {
  const gatherIdx = body.indexOf(GATHER_OPEN);
  const discIdx = body.indexOf(disclosure);
  assert.ok(gatherIdx !== -1, `Gather fehlt im Body: ${body}`);
  assert.ok(discIdx !== -1, `Offenlegung fehlt im Body: ${body}`);
  assert.ok(
    gatherIdx < discIdx,
    `Offenlegung muss IM Gather stehen (Gather oeffnet zuerst): ${body}`,
  );
}

const DEFAULT_CALL_ID = "call_harness1";
const CALL_SID = "CAtest";

async function startOutboundServer({ provider = "telnyx", call = {}, seed = {}, env = {} } = {}) {
  const id = call.id || DEFAULT_CALL_ID;
  const srv = await startServer({
    env,
    seed: seedState({
      calls: [seedCall({ id, provider, status: "active", direction: "outbound", ...call })],
      ...seed,
    }),
  });
  return { srv, id };
}

async function fetchOutbound(srv, id) {
  const res = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: CALL_SID }),
  });
  const body = await res.text();
  return { body, status: res.status, contentType: res.headers.get("content-type") };
}

export async function runOutbound(opts = {}) {
  const { srv, id } = await startOutboundServer(opts);
  try {
    const result = await fetchOutbound(srv, id);
    return { ...result, stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

export async function runOutboundKeepOpen(opts = {}) {
  const { srv, id } = await startOutboundServer(opts);
  const result = await fetchOutbound(srv, id);
  return { ...result, srv };
}

export async function runOutboundThenTurn({
  provider = "telnyx",
  call = {},
  speechResult,
  mockUrl,
  env = {},
} = {}) {
  const id = call.id || DEFAULT_CALL_ID;
  const srv = await startServer({
    env: { ANTHROPIC_BASE_URL: mockUrl, ...env },
    seed: seedState({
      calls: [seedCall({ id, provider, status: "active", direction: "outbound", ...call })],
    }),
  });
  try {
    const outRes = await fetch(`${srv.localUrl}/voice/outbound?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ CallSid: CALL_SID }),
    });
    assert.equal(outRes.status, 200);
    const outboundBody = await outRes.text();

    const turnRes = await fetch(`${srv.localUrl}/voice/turn?callId=${id}`, {
      method: "POST",
      body: new URLSearchParams({ SpeechResult: speechResult }),
    });
    const turnBody = await turnRes.text();
    return { outboundBody, turnBody, turnStatus: turnRes.status, stdout: srv.stdout };
  } finally {
    await srv.stop();
  }
}

export const AGENT_SPEECH = "Ich rufe im Auftrag von Jonas an und haette eine kurze Frage.";

function anthropicMessage(content) {
  return {
    id: "msg_mock",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 16 },
  };
}

function endPremature(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("transfer-encoding", "chunked");
  res.write('{"id":"msg_mock","type":"message"');
  res.socket.destroy();
}

function endValid(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(anthropicMessage([{ type: "text", text: AGENT_SPEECH }])));
}

export async function startCountingAnthropicMock({ failFirst }) {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      if (seen <= failFirst) return endPremature(res);
      return endValid(res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function startAlwaysPrematureMock() {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      endPremature(res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}

export async function startAlways4xxMock() {
  let seen = 0;
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen += 1;
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "mock-fehler" },
        }),
      );
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    count: () => seen,
    close: () => new Promise((r) => server.close(r)),
  };
}
