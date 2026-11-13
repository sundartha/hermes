import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";

const ORIGIN = "https://sundartha.test";
const MCP_ENDE = "/mcp";
const KNOEPFE_IN_DER_REIHE = 2;
const KURZ_NACH_DEM_KLICK_MS = 50;

let workDir;
let distDir;

before(() => {
  ({ workDir, distDir } = buildSite(".chatgpt-wie-claude-", "dist"));
});

after(() => {
  removeBuild(workDir);
});

function shown(window, element) {
  for (let node = element; node; node = node.parentElement) {
    if (window.getComputedStyle(node).display === "none") return false;
  }
  return true;
}

function nurFuerScreenreader(node) {
  return node.classList.contains("sr") || node.getAttribute("aria-hidden") === "true";
}

function sichtbarerTextVon(window, node) {
  if (node.nodeType === node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== node.ELEMENT_NODE || nurFuerScreenreader(node)) return "";
  return shown(window, node) ? sichtbarerText(window, node) : "";
}

function sichtbarerText(window, element) {
  const teile = [...element.childNodes].map((node) => sichtbarerTextVon(window, node));
  return teile.join("").trim();
}

function sichtbarUnterDenKnoepfen(window, reihe) {
  return [...reihe.children].filter((kind) => kind.tagName !== "A" && shown(window, kind));
}

async function openHome(clipboardWorks, execCopyWorks = false) {
  const window = new Window({
    url: `${ORIGIN}/`,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
      fetch: { virtualServers: [{ url: `${ORIGIN}/`, directory: distDir }] },
    },
  });
  const copied = [];
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text) => {
        copied.push(text);
        return clipboardWorks ? Promise.resolve() : Promise.reject(new Error("verweigert"));
      },
    },
  });
  const execCopies = [];
  window.document.execCommand = (command) => {
    execCopies.push(command);
    return execCopyWorks;
  };
  window.document.write(readFileSync(join(distDir, "index.html"), "utf8"));
  await window.happyDOM.waitUntilComplete();
  const doc = window.document;
  const reihe = doc.querySelector("#chatgpt .obtns");
  const [claude, chatgpt] = reihe ? [...reihe.querySelectorAll("a")] : [];
  return { window, copied, execCopies, reihe, claude, chatgpt, url: doc.getElementById("chatgpt-url") };
}

test("ChatGPT-Setup: der ChatGPT-Knopf sieht aus wie der Claude-Knopf und unter der Reihe steht nichts", async () => {
  const { window, reihe, claude, chatgpt } = await openHome(true);
  try {
    assert.equal(
      reihe.querySelectorAll("a").length,
      KNOEPFE_IN_DER_REIHE,
      "Claude- und ChatGPT-Knopf fehlen",
    );
    assert.match(claude.href, /^https:\/\/claude\.ai\//, "erster Knopf ist nicht der Claude-Knopf");
    assert.equal(
      chatgpt.className,
      claude.className,
      "ChatGPT-Knopf hat nicht den Stil des Claude-Knopfs",
    );
    assert.equal(sichtbarerText(window, claude), "Claude");
    assert.equal(
      sichtbarerText(window, chatgpt),
      "ChatGPT",
      "ChatGPT-Knopf trägt mehr als den Namen",
    );
    assert.equal(
      chatgpt.querySelector("svg").outerHTML,
      claude.querySelector("svg").outerHTML,
      "ChatGPT-Knopf hat nicht denselben Pfeil",
    );
    assert.deepEqual(
      sichtbarUnterDenKnoepfen(window, reihe).map((kind) => kind.outerHTML),
      [],
      "unter den Knöpfen steht noch Text",
    );
  } finally {
    await window.happyDOM.close();
  }
});

test("ChatGPT-Setup: Klick kopiert die MCP-URL, meldet das im Knopf und blendet keinen Text darunter ein", async () => {
  const { window, copied, reihe, chatgpt, url } = await openHome(true);
  try {
    chatgpt.click();
    await new Promise((resolve) => window.setTimeout(resolve, KURZ_NACH_DEM_KLICK_MS));
    assert.ok(chatgpt.classList.contains("copied"), "Knopf meldet das Kopieren nicht");
    assert.notEqual(
      sichtbarerText(window, chatgpt),
      "ChatGPT",
      "Beschriftung zeigt keine Kopier-Rückmeldung",
    );
    await window.happyDOM.waitUntilComplete();
    assert.equal(copied.length, 1);
    assert.ok(copied[0].endsWith(MCP_ENDE), "kopiert wird nicht die MCP-URL");
    assert.equal(
      shown(window, url),
      false,
      "nach erfolgreichem Kopieren erscheint doch die URL-Zeile",
    );
    assert.equal(
      sichtbarUnterDenKnoepfen(window, reihe).length,
      0,
      "nach dem Klick steht Text unter den Knöpfen",
    );
  } finally {
    await window.happyDOM.close();
  }
});

test("ChatGPT-Setup: scheitert das Kopieren, erscheint die URL zum Markieren und der Knopf verweist darauf", async () => {
  const { window, chatgpt, url } = await openHome(false);
  try {
    assert.equal(shown(window, url), false, "URL-Zeile ist schon vor dem Klick sichtbar");
    chatgpt.click();
    await window.happyDOM.waitUntilComplete();
    assert.equal(shown(window, url), true, "URL-Zeile fehlt trotz gescheitertem Kopieren");
    assert.ok(
      url.querySelector("code").textContent.endsWith(MCP_ENDE),
      "URL-Zeile zeigt nicht die MCP-URL",
    );
    assert.equal(chatgpt.getAttribute("aria-describedby"), "chatgpt-url");
  } finally {
    await window.happyDOM.close();
  }
});

test("ChatGPT-Setup: der Link kopiert noch im Klick selbst, bevor der neue Tab den Fokus nimmt", async () => {
  const { window, copied, execCopies, chatgpt, url } = await openHome(false, true);
  try {
    chatgpt.click();
    assert.deepEqual(execCopies, ["copy"], "der Link kopiert nicht synchron im Klick");
    assert.ok(chatgpt.classList.contains("copied"), "Knopf meldet das Kopieren nicht sofort");
    await window.happyDOM.waitUntilComplete();
    assert.equal(copied.length, 0, "trotz geglücktem Kopieren im Klick wird zusätzlich die Clipboard-API bemüht");
    assert.equal(shown(window, url), false, "URL-Zeile erscheint trotz geglücktem Kopieren");
  } finally {
    await window.happyDOM.close();
  }
});
