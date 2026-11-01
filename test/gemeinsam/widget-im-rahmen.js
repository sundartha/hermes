import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const CHROME_ENV = "CHROME_BIN";
const PLAYWRIGHT_CACHE = join(homedir(), "Library", "Caches", "ms-playwright");
const LINUX_PLAYWRIGHT_CACHE = join(homedir(), ".cache", "ms-playwright");
const SYSTEM_BROWSERS = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const SHELL_NAME = "chrome-headless-shell";
const START_TIMEOUT_MS = 15000;
const HOST_GROUND = [255, 0, 255];
const HOST_GROUND_TOLERANCE = 60;
const HOST_VIEWPORT_HEIGHT = 1200;
const SETTLED_BINDING = "hermesFrameSettled";

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
const frame = document.getElementById("f");
const nextFrame = () => new Promise((done) => requestAnimationFrame(() => done()));
let reports = 0;
let loaded = false;
async function settleWhenQuiet() {
  if (!loaded || reports === 0) return;
  const seen = reports;
  await frame.contentDocument.fonts.ready;
  await nextFrame();
  await nextFrame();
  if (seen !== reports) return;
  const box = frame.getBoundingClientRect();
  window[${JSON.stringify(SETTLED_BINDING)}](JSON.stringify({ width: box.width, height: box.height }));
}
window.addEventListener("message", (event) => {
  const m = event.data;
  if (!m || m.method !== "ui/notifications/size-changed" || !(m.params.height > 0)) return;
  frame.style.height = m.params.height + "px";
  if (${honorWidth}) frame.style.width = Math.min(m.params.width, ${frameWidth}) + "px";
  reports += 1;
  settleWhenQuiet();
});
frame.addEventListener("load", () => { loaded = true; settleWhenQuiet(); });
frame.srcdoc = new TextDecoder().decode(Uint8Array.from(atob("${source}"), (c) => c.charCodeAt(0)));
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
  const eventWaiters = new Map();
  let next = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      for (const done of eventWaiters.get(message.method) || []) done(message.params);
      eventWaiters.delete(message.method);
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
      next += 1;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const nextEvent = (method) =>
    new Promise((resolve) => {
      eventWaiters.set(method, [...(eventWaiters.get(method) || []), resolve]);
    });
  return { opened, send, nextEvent, close: () => socket.close() };
}

export async function renderInFrame(chrome, widgetHtml, { width: frameWidth, honorWidth = false }) {
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send, nextEvent } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Emulation.setDeviceMetricsOverride", { width: frameWidth, height: HOST_VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: SETTLED_BINDING }, sessionId);
    const page = hostPage(widgetHtml, frameWidth, honorWidth);
    const settled = nextEvent("Runtime.bindingCalled");
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(page).toString("base64")}` }, sessionId);
    const { height, width } = JSON.parse((await settled).payload);
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
