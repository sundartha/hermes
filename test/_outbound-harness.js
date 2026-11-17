import assert from "node:assert/strict";
import http from "node:http";
import { starteAttrappe } from "./anrufe/attrappen-server.js";

export const DISCLOSURE_JONAS =
  "Guten Tag, hier spricht ein KI-Assistent im Auftrag von Jonas Beispiel.";
export const KI_HINWEIS_JONAS = "ich bin Hermes, der KI-Assistent von Jonas Beispiel";
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

export async function startRecordingAnthropicMock() {
  const bodies = [];
  const server = await starteAttrappe((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      bodies.push(JSON.parse(raw));
      endValid(res);
    });
  });
  return { url: server.url, bodies, close: server.close };
}
