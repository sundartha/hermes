#!/usr/bin/env node
import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WAIT_SECONDS = 30;
export const MAX_WAIT_SECONDS = 300;
const DEFAULT_PORT = 8931;
const MS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const LOG_PREFIX = "[spike1-consult-echo]";

function readJsonBody(req) {
  return new Promise((settle, fail) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("error", fail);
    req.on("end", () => {
      try {
        settle(raw ? JSON.parse(raw) : {});
      } catch {
        settle({});
      }
    });
  });
}

function parseWaitSeconds(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return undefined;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function resolveWaitSeconds(url, body) {
  const fromQuery = parseWaitSeconds(url.searchParams.get("wait_seconds"));
  const fromBody = parseWaitSeconds(body && body.wait_seconds);
  const requested = fromBody ?? fromQuery ?? DEFAULT_WAIT_SECONDS;
  return Math.min(requested, MAX_WAIT_SECONDS);
}

function wait(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

async function handleRequest(req, res) {
  const receivedAt = new Date();
  const url = new URL(req.url, "http://localhost");
  const body = await readJsonBody(req);
  const waitSeconds = resolveWaitSeconds(url, body);
  const waitedMs = Math.round(waitSeconds * MS_PER_SECOND);

  await wait(waitedMs);

  const respondedAt = new Date();
  console.log(
    `${LOG_PREFIX} received_at=${receivedAt.toISOString()} wait_seconds=${waitSeconds} waited_ms=${waitedMs} responded_at=${respondedAt.toISOString()}`,
  );
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      wait_seconds: waitSeconds,
      waited_ms: waitedMs,
      received_at: receivedAt.toISOString(),
      responded_at: respondedAt.toISOString(),
    }),
  );
}

export async function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
      res.writeHead(HTTP_SERVER_ERROR, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
  });
  await new Promise((settle) => server.listen(port, "127.0.0.1", settle));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((settle) => server.close(settle)) };
}

async function main() {
  const portArg = Number(process.argv[2]);
  const port = Number.isFinite(portArg) && portArg > 0 ? portArg : DEFAULT_PORT;
  const { url } = await startServer(port);
  console.log(
    `${LOG_PREFIX} laeuft auf ${url} (Standard-Wartezeit ${DEFAULT_WAIT_SECONDS}s, Obergrenze ${MAX_WAIT_SECONDS}s)`,
  );
}

const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} Fehler: ${err.message}`);
    process.exit(1);
  });
}
