import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { VirtualConsoleLogLevelEnum, Window } from "happy-dom";

export const LANG = "de";
export const SHELL_HTML = join("app", "index.html");
export const OK_TONE = "ok";
export const ERR_TONE = "err";
export const NEUTRAL_TONE = "neutral";

const ORIGIN = "https://app.hermes.test";
const STATE_PATH = "/api/self-service/state";
const ASSET_PREFIX = "/_astro/";
const LANG_KEY = "hermes.lang.v2";
const DEADLINE_MS = 10_000;
const POLL_MS = 10;
const FIRST_ARGUMENT = 2;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_BLOCKED = 599;
const OK_CLASS = "billing-msg--ok";
const ERR_CLASS = "billing-msg--err";
const HIDDEN_VISIBILITY = new Set(["hidden", "collapse"]);

const TENANT_STATE = Object.freeze({
  hasCard: true,
  agent: { owner: "Probe", number: "+4930123456", numberStatus: "active" },
  subscription: {},
  calls: [],
});

function jsonResponse(window, status, body) {
  return new window.Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function interceptor(requests, scriptsRan) {
  return {
    async beforeAsyncRequest({ request, window }) {
      const url = new URL(request.url);
      requests.push(url.href);
      if (url.origin !== ORIGIN) return jsonResponse(window, HTTP_BLOCKED, { error: "extern" });
      if (url.pathname === STATE_PATH) {
        await scriptsRan;
        return jsonResponse(window, HTTP_OK, TENANT_STATE);
      }
      if (!url.pathname.startsWith(ASSET_PREFIX)) return jsonResponse(window, HTTP_NOT_FOUND, { error: "not_found" });
      return undefined;
    },
  };
}

function afterAll(scripts) {
  return Promise.all(
    scripts.map(
      (script) =>
        new Promise((resolve) => {
          script.addEventListener("load", resolve, { once: true });
          script.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
}

function isDrawn(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden) return false;
  }
  return true;
}

function isShown(window, element) {
  if (!isDrawn(element) || HIDDEN_VISIBILITY.has(window.getComputedStyle(element).visibility)) return false;
  for (let node = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return false;
  }
  return true;
}

function toneOf(element) {
  const ok = element.classList.contains(OK_CLASS);
  const err = element.classList.contains(ERR_CLASS);
  if (ok && err) return "beide";
  if (ok) return OK_TONE;
  if (err) return ERR_TONE;
  return NEUTRAL_TONE;
}

async function settle(window, ready) {
  const end = Date.now() + DEADLINE_MS;
  for (;;) {
    await window.happyDOM.waitUntilComplete();
    if (ready()) break;
    if (Date.now() > end) throw new Error(`Shell nicht binnen ${DEADLINE_MS} ms gezeichnet`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await window.happyDOM.waitUntilComplete();
}

async function openShell(dir, target) {
  const requests = [];
  let releaseState;
  const scriptsRan = new Promise((resolve) => {
    releaseState = resolve;
  });
  const window = new Window({
    url: `${ORIGIN}${target}`,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
      fetch: {
        interceptor: interceptor(requests, scriptsRan),
        virtualServers: [{ url: `${ORIGIN}/`, directory: dir }],
      },
    },
  });
  const errors = [];
  window.addEventListener("error", (event) => errors.push(String(event.error ?? event.message)));
  const collectConsoleErrors = () => {
    for (const entry of window.happyDOM.virtualConsolePrinter.read()) {
      if (entry.level >= VirtualConsoleLogLevelEnum.error) errors.push(entry.message.map(String).join(" "));
    }
    return errors.length > 0;
  };
  window.localStorage.setItem(LANG_KEY, LANG);
  try {
    window.document.write(readFileSync(join(dir, SHELL_HTML), "utf8"));
    const document = window.document;
    const modules = [...document.querySelectorAll('script[type="module"][src]')];
    if (modules.length === 0) throw new Error("Shell-Seite lädt keine Modul-Skripte");
    afterAll(modules).then(releaseState);
    const card = () => document.getElementById("billing-card");
    await settle(window, () => collectConsoleErrors() || (card() !== null && isDrawn(card())));
    collectConsoleErrors();
    const msg = document.getElementById("billing-msg");
    return {
      text: msg ? msg.textContent : null,
      shown: msg ? isShown(window, msg) && msg.textContent !== "" : false,
      tone: msg ? toneOf(msg) : null,
      cardShown: card() ? isShown(window, card()) : false,
      cardStatus: document.getElementById("billing-card-status")?.textContent ?? null,
      search: window.location.search,
      errors,
      external: requests.filter((href) => new URL(href).origin !== ORIGIN),
    };
  } finally {
    await window.happyDOM.close();
  }
}

if (import.meta.url === pathToFileURL(argv[1]).href) {
  const [dir, target] = argv.slice(FIRST_ARGUMENT);
  stdout.write(JSON.stringify(await openShell(dir, target)));
}
