import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { findChrome } from "./widget-im-rahmen.js";

const PROFILE_REMOVE_RETRIES = 10;
const DONE_BINDING = "hermesLadezeitFertig";
const THROTTLE = { cpu: 4, latencyMs: 150, bytesPerSecond: (1.6 * 1000 * 1000) / 8 };
const IMAGE_URI = /data:image\/(png|webp|jpeg|gif);base64,([A-Za-z0-9+/=]+)/g;

const HOST_SCRIPT = `
const frame = document.getElementById("f");
const cardSelector = CARD_SELECTOR;
const result = {};
let t0 = 0;
let before = "";
function send(message) { frame.contentWindow.postMessage(Object.assign({ jsonrpc: "2.0" }, message), "*"); }
function pushPayload(doc) {
  const payload = { status: "in_progress", call_id: "attrappe-1" };
  for (const el of doc.querySelectorAll("[data-mcp]")) {
    if (el.getAttribute("data-mcp") in payload) continue;
    const fields = (el.getAttribute("data-mcp-row") || "").split(",").filter(Boolean);
    payload[el.getAttribute("data-mcp")] = fields.length ? [Object.fromEntries(fields.map((f) => [f, "x"]))] : "x";
  }
  return payload;
}
function visible(el) { const box = el && el.getBoundingClientRect(); return Boolean(box && box.width > 0 && box.height > 0); }
function statusShown(doc) {
  const label = doc.querySelector("[data-status-pill] [data-status-label]");
  return label ? label.textContent.trim() === "Live" : doc.body.innerText !== before;
}
function wingShown(doc) {
  const img = doc.querySelector(".wing img");
  const loaded = img && img.complete && img.naturalWidth > 0 && visible(img);
  return Boolean(loaded || visible(doc.querySelector("[data-wing-canvas] canvas")));
}
function finishWhenComplete() {
  if (result.erste_zeichnung_ms && result.fluegel_sichtbar_ms && result.status_nach_push_ms) {
    window[${JSON.stringify(DONE_BINDING)}](JSON.stringify(result));
  }
}
function stampNextFrame(key, since) {
  requestAnimationFrame((now) => { result[key] = Math.max(now - since, 0.001); finishWhenComplete(); });
}
function watch() {
  const doc = frame.contentDocument;
  if (doc && doc.body) {
    if (!result.erste_zeichnung_ms && !result.erste_pending && visible(doc.querySelector(cardSelector))) {
      result.erste_pending = true;
      stampNextFrame("erste_zeichnung_ms", t0);
    }
    if (!result.fluegel_sichtbar_ms && !result.fluegel_pending && wingShown(doc)) {
      result.fluegel_pending = true;
      stampNextFrame("fluegel_sichtbar_ms", t0);
    }
    if (result.pushed_at && !result.status_nach_push_ms && !result.status_pending && statusShown(doc)) {
      result.status_pending = true;
      stampNextFrame("status_nach_push_ms", result.pushed_at);
    }
  }
  if (!result.status_nach_push_ms || !result.erste_zeichnung_ms || !result.fluegel_sichtbar_ms) requestAnimationFrame(watch);
}
function push() {
  before = frame.contentDocument.body.innerText;
  result.pushed_at = performance.now();
  send({ method: "ui/notifications/tool-result", params: { structuredContent: pushPayload(frame.contentDocument) } });
}
window.addEventListener("message", (event) => {
  const m = event.data;
  if (!m || typeof m !== "object") return;
  if (m.method === "ui/initialize") send({ id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "attrappe", version: "0" }, hostCapabilities: {}, hostContext: {} } });
  if (m.method === "ui/notifications/initialized") push();
  if (m.method === "tools/call") send({ id: m.id, result: { structuredContent: { status: "in_progress", call_id: "attrappe-1" }, content: [], _meta: { locale: "en" } } });
});
t0 = performance.now();
frame.src = "/widget";
requestAnimationFrame(watch);
`;

function hostPage(html) {
  const selector = html.includes("data-status-pill") ? "[data-status-pill]" : ".card";
  const script = HOST_SCRIPT.replace("CARD_SELECTOR", JSON.stringify(selector));
  return `<!doctype html><html><body style="margin:0"><iframe id="f" style="border:0;width:600px;height:600px"></iframe><script>${script}</script></body></html>`;
}

function serve(html) {
  const raw = Buffer.from(html);
  const zipped = gzipSync(raw);
  const host = Buffer.from(hostPage(html));
  const server = createServer((request, response) => {
    if (request.url === "/widget") {
      const gzip = String(request.headers["accept-encoding"] || "").includes("gzip");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", ...(gzip ? { "content-encoding": "gzip" } : {}) });
      response.end(gzip ? zipped : raw);
      return;
    }
    response.writeHead(request.url === "/" ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    response.end(request.url === "/" ? host : "");
  });
  const listening = new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  return { listening, close: () => { server.close(); server.closeAllConnections(); }, bytesRaw: raw.length, bytesGzip: zipped.length };
}

function launch(chrome) {
  const profile = mkdtempSync(join(tmpdir(), "hermes-ladezeit-"));
  const args = ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
  const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const endpoint = new Promise((resolve, reject) => {
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (found) resolve(found[1]);
    });
    exited.then(() => reject(new Error("Browser beendet")));
  });
  const stop = async (send) => {
    if (send) send("Browser.close").catch(() => child.kill("SIGKILL"));
    else child.kill("SIGKILL");
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: PROFILE_REMOVE_RETRIES });
  };
  return { endpoint, stop };
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const binding = { resolve: null, early: [] };
  let counter = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.bindingCalled") {
      if (binding.resolve) binding.resolve(message.params.payload);
      else binding.early.push(message.params.payload);
      return;
    }
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      counter += 1;
      pending.set(counter, { resolve, reject });
      socket.send(JSON.stringify({ id: counter, method, params, sessionId }));
    });
  const nextBinding = () =>
    new Promise((resolve) => {
      if (binding.early.length > 0) resolve(binding.early.shift());
      else binding.resolve = resolve;
    });
  return { opened, send, nextBinding, close: () => socket.close() };
}

async function applyThrottle(send, sessionId) {
  await send("Emulation.setCPUThrottlingRate", { rate: THROTTLE.cpu }, sessionId);
  await send("Network.enable", {}, sessionId);
  await send(
    "Network.emulateNetworkConditions",
    { offline: false, latency: THROTTLE.latencyMs, downloadThroughput: THROTTLE.bytesPerSecond, uploadThroughput: THROTTLE.bytesPerSecond },
    sessionId,
  );
}

function imagesIn(html) {
  const found = [...html.matchAll(IMAGE_URI)].map(([uri, format, data]) => ({ format, uri: uri.length, bytes: Buffer.from(data, "base64").length }));
  return {
    anzahl: found.length,
    formate: found.map((image) => image.format),
    groessen_uri: found.map((image) => image.uri),
    groessen_dekodiert: found.map((image) => image.bytes),
  };
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

export async function messeWidget(chrome, html, { gedrosselt = false } = {}) {
  const server = serve(html);
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send, nextBinding } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
    if (gedrosselt) await applyThrottle(send, sessionId);
    const done = nextBinding();
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    const times = JSON.parse(await done);
    return {
      gedrosselt,
      erste_zeichnung_ms: roundMs(times.erste_zeichnung_ms),
      fluegel_sichtbar_ms: roundMs(times.fluegel_sichtbar_ms),
      status_nach_push_ms: roundMs(times.status_nach_push_ms),
      bytes_roh: server.bytesRaw,
      bytes_gzip: server.bytesGzip,
      bilder: imagesIn(html),
    };
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

async function main(path) {
  const chrome = findChrome();
  if (!chrome) throw new Error("kein Chromium gefunden (CHROME_BIN setzen)");
  const html = readFileSync(path, "utf8");
  const ungedrosselt = await messeWidget(chrome, html, { gedrosselt: false });
  const gedrosselt = await messeWidget(chrome, html, { gedrosselt: true });
  console.log(JSON.stringify({ datei: path, ungedrosselt, gedrosselt }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { launch, connect, applyThrottle };
