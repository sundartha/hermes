import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { echtWarten } from "../echt-warten.js";

const CHROME_ENV = "CHROME_BIN";
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const LINUX_PLAYWRIGHT_CACHE = join(homedir(), ".cache", "ms-playwright");
const SYSTEM_BROWSERS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const SHELL_NAME = "chrome-headless-shell";
const START_TIMEOUT_MS = 15000;
const SETTLE_MS = 400;
const POLL_MS = 50;
const SETTLE_POLLS = 60;
const HOST_GROUND = [255, 0, 255];
const HOST_GROUND_TOLERANCE = 60;
const HOST_VIEWPORT_HEIGHT = 1200;

function findInCache(cache) {
  if (!existsSync(cache)) return null;
  const shells = readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const shell of shells) {
    const base = join(cache, shell);
    for (const arch of readdirSync(base)) {
      const candidate = join(base, arch, SHELL_NAME);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function findChrome() {
  const fromEnv = process.env[CHROME_ENV];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return findInCache(PLAYWRIGHT_CACHE) || findInCache(LINUX_PLAYWRIGHT_CACHE) || SYSTEM_BROWSERS.find((path) => existsSync(path)) || null;
}

function hostPage(widgetHtml, frameWidth, honorWidth) {
  const source = Buffer.from(widgetHtml).toString("base64");
  return `<!doctype html><html><body style="margin:0;background:rgb(${HOST_GROUND.join(",")})">
<iframe id="f" style="display:block;border:0;width:${frameWidth}px;height:10px"></iframe>
<script>
window.addEventListener("message", (event) => {
  const m = event.data;
  if (m && m.method === "ui/notifications/size-changed") {
    document.getElementById("f").style.height = m.params.height + "px";
    if (${honorWidth}) document.getElementById("f").style.width = Math.min(m.params.width, ${frameWidth}) + "px";
  }
});
document.getElementById("f").srcdoc = new TextDecoder().decode(Uint8Array.from(atob("${source}"), (c) => c.charCodeAt(0)));
</script></body></html>`;
}

function launch(chrome) {
  const profile = mkdtempSync(join(tmpdir(), "hermes-rahmen-"));
  const child = spawn(
    chrome,
    ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = new Promise((resolve, reject) => {
    AbortSignal.timeout(START_TIMEOUT_MS).addEventListener("abort", () => reject(new Error("Browser startet nicht")));
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (found) {
        resolve(found[1]);
      }
    });
    child.on("exit", () => reject(new Error("Browser beendet")));
  });
  const stop = () => {
    child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  };
  return { endpoint, stop };
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let next = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
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
      next += 1;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  return { opened, send, close: () => socket.close() };
}

async function evaluate(send, session, expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true }, session);
  return result.result.value;
}

async function settledFrameSize(send, session) {
  const probe = 'document.getElementById("f").getBoundingClientRect().height + "x" + document.getElementById("f").getBoundingClientRect().width';
  let last = "";
  let stable = 0;
  for (let poll = 0; poll < SETTLE_POLLS && stable * POLL_MS < SETTLE_MS; poll += 1) {
    await echtWarten(POLL_MS);
    const size = await evaluate(send, session, probe);
    stable = size === last && !size.startsWith("10x") ? stable + 1 : 0;
    last = size;
  }
  const [height, width] = last.split("x").map(Number);
  return { height, width };
}

export async function renderInFrame(chrome, widgetHtml, { width: frameWidth, honorWidth = false }) {
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: frameWidth, height: HOST_VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.enable", {}, sessionId);
    const page = hostPage(widgetHtml, frameWidth, honorWidth);
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(page).toString("base64")}` }, sessionId);
    const { height, width } = await settledFrameSize(send, sessionId);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } }, sessionId);
    return { width, height, png: Buffer.from(shot.data, "base64") };
  } finally {
    if (client) client.close();
    browser.stop();
  }
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const distances = [Math.abs(estimate - a), Math.abs(estimate - b), Math.abs(estimate - c)];
  const best = distances.indexOf(Math.min(...distances));
  return [a, b, c][best];
}

export function decodePng(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const channels = { 2: 3, 6: 4 }[png[25]];
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i += 1) {
      const value = raw[row * (stride + 1) + 1 + i];
      const left = i >= channels ? pixels[row * stride + i - channels] : 0;
      const up = row > 0 ? pixels[(row - 1) * stride + i] : 0;
      const upLeft = row > 0 && i >= channels ? pixels[(row - 1) * stride + i - channels] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      pixels[row * stride + i] = (value + predictor) & 255;
    }
  }
  return { width, height, at: (x, y) => Array.from(pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)) };
}

export const isHostGround = (rgb) => HOST_GROUND.every((channel, i) => Math.abs(channel - rgb[i]) < HOST_GROUND_TOLERANCE);
