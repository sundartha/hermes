import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";

const ORIGIN = "https://sundartha.test";
const CONSENT_KEY = "hermes.consent";
const DEADLINE_MS = 10_000;
const POLL_MS = 10;

const PAGES = [
  ["Startseite", "/", "index.html"],
  ["Unterseite", "/kuendigen", join("kuendigen", "index.html")],
];
const DECISIONS = [
  ["Accept all", "all"],
  ["Necessary only", "necessary"],
  ["Save selection", "save"],
];

let workDir;
let distDir;

before(() => {
  ({ workDir, distDir } = buildSite(".consent-dom-", "dist"));
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

async function settle(window, ready) {
  const end = Date.now() + DEADLINE_MS;
  for (;;) {
    await window.happyDOM.waitUntilComplete();
    if (ready()) return;
    if (Date.now() > end) throw new Error(`Seite nicht binnen ${DEADLINE_MS} ms bereit`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function openPage(path, file) {
  const window = new Window({
    url: `${ORIGIN}${path}`,
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
  window.document.write(readFileSync(join(distDir, file), "utf8"));
  const root = window.document.querySelector("[data-consent-root]");
  assert.ok(root, `${path}: keine Cookie-Karte im Markup`);
  await settle(window, () => !root.hidden && window.document.styleSheets.length > 0);
  return { window, root };
}

function click(window, root, action) {
  const button = root.querySelector(`[data-consent-action="${action}"]`);
  assert.ok(button, `Knopf ${action} fehlt`);
  button.click();
}

for (const [label, path, file] of PAGES) {
  for (const [name, action] of DECISIONS) {
    test(`${label}: "${name}" schliesst die Cookie-Karte sichtbar`, async () => {
      const { window, root } = await openPage(path, file);
      try {
        assert.equal(shown(window, root), true, "Karte beim ersten Besuch nicht sichtbar");
        const prefs = root.querySelector("[data-consent-prefs]");
        assert.equal(shown(window, prefs), false, "Einstellungen beim ersten Besuch schon offen");
        if (action === "save") {
          click(window, root, "prefs");
          assert.equal(shown(window, prefs), true, "Einstellungen gehen nicht auf");
        }
        click(window, root, action);
        assert.ok(window.localStorage.getItem(CONSENT_KEY), "Entscheidung nicht gespeichert");
        assert.equal(shown(window, root), false, `Karte bleibt nach "${name}" sichtbar`);
      } finally {
        await window.happyDOM.close();
      }
    });
  }

  test(`${label}: "Cookie settings" im Footer oeffnet die Karte wieder`, async () => {
    const { window, root } = await openPage(path, file);
    try {
      click(window, root, "necessary");
      assert.equal(shown(window, root), false, "Karte nach Entscheidung noch sichtbar");
      const opener = window.document.querySelector("[data-consent-open]");
      assert.ok(opener, "kein Cookie-settings-Knopf auf der Seite");
      opener.click();
      assert.equal(shown(window, root), true, "Cookie settings oeffnet die Karte nicht");
      const prefs = root.querySelector("[data-consent-prefs]");
      assert.equal(shown(window, prefs), true, "Cookie settings zeigt die Einstellungen nicht");
    } finally {
      await window.happyDOM.close();
    }
  });
}
