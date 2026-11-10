import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";

const ORIGIN = "https://sundartha.test";
const LANG_KEY = "hermes.lang.v2";
const DEADLINE_MS = 10_000;
const POLL_MS = 10;
const TITLE_EN = "Hermes — Give your AI a phone number";
const TITLE_DE = "Hermes — Gib deiner KI eine Telefonnummer";

let workDir;
let distDir;

before(() => {
  ({ workDir, distDir } = buildSite(".home-menue-titel-", "dist"));
});

after(() => {
  removeBuild(workDir);
});

async function settle(window, ready) {
  const end = Date.now() + DEADLINE_MS;
  for (;;) {
    await window.happyDOM.waitUntilComplete();
    if (ready()) return;
    if (Date.now() > end) throw new Error(`Startseite nicht binnen ${DEADLINE_MS} ms bereit`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function openHome(storedLang) {
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
  window.navigator.sendBeacon = () => true;
  if (storedLang) window.localStorage.setItem(LANG_KEY, storedLang);
  window.document.write(readFileSync(join(distDir, "index.html"), "utf8"));
  const { document } = window;
  await settle(window, () => document.styleSheets.length > 0 && document.querySelector('.sdots a[aria-current="true"]') !== null);
  return window;
}

function pageScrolls(window) {
  return window.getComputedStyle(window.document.documentElement).overflow !== "hidden";
}

test("Startseite: offenes Mobil-Menue sperrt das Scrollen der Seite dahinter, geschlossen scrollt sie wieder", async () => {
  const window = await openHome();
  try {
    const { document } = window;
    const button = document.querySelector(".navmenu");
    const sheet = document.getElementById("m-menu");
    assert.equal(pageScrolls(window), true, "Seite schon vor dem Oeffnen gesperrt");
    button.click();
    assert.equal(sheet.hidden, false, "Menue geht nicht auf");
    assert.equal(pageScrolls(window), false, "Seite scrollt hinter dem offenen Menue weiter");
    button.click();
    assert.equal(sheet.hidden, true, "Menue geht nicht zu");
    assert.equal(pageScrolls(window), true, "Seite bleibt nach dem Schliessen gesperrt");
    button.click();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(pageScrolls(window), true, "Seite bleibt nach Escape gesperrt");
    button.click();
    sheet.querySelector("a").click();
    assert.equal(pageScrolls(window), true, "Seite bleibt nach einem Menuelink gesperrt");
  } finally {
    await window.happyDOM.close();
  }
});

test("Startseite: Seitentitel folgt dem Sprachwechsel", async () => {
  const window = await openHome();
  try {
    const { document } = window;
    assert.equal(document.title, TITLE_EN);
    document.querySelector('[data-lang="de"]').click();
    assert.equal(document.documentElement.lang, "de", "Sprachwechsel greift nicht");
    assert.equal(document.title, TITLE_DE, "Titel bleibt nach Wechsel auf Deutsch englisch");
    document.querySelector('[data-lang="en"]').click();
    assert.equal(document.title, TITLE_EN, "Titel bleibt nach Wechsel auf Englisch deutsch");
  } finally {
    await window.happyDOM.close();
  }
});

test("Startseite: mit gespeichertem Deutsch ist der Seitentitel nach dem Laden deutsch", async () => {
  const window = await openHome("de");
  try {
    assert.equal(window.document.documentElement.lang, "de", "gespeicherte Sprache greift nicht");
    assert.equal(window.document.title, TITLE_DE);
  } finally {
    await window.happyDOM.close();
  }
});
