import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { preloadNearView } from "../src/scripts/home-video.js";

function fakeObserver() {
  const seen = { observed: [], unobserved: [], margin: "", report: () => {} };
  class Observer {
    constructor(callback, options) {
      seen.report = callback;
      seen.margin = options.rootMargin;
    }
    observe(target) {
      seen.observed.push(target);
    }
    unobserve(target) {
      seen.unobserved.push(target);
    }
  }
  return { Observer, seen };
}

function videos() {
  const window = new Window({ url: "https://sundartha.test/" });
  window.document.body.innerHTML = ["metadata", "none", "auto"]
    .map((preload, index) => `<video data-clip="uc${index + 1}" preload="${preload}"></video>`)
    .join("");
  const list = Array.from(window.document.querySelectorAll("video"));
  const loads = new Map(list.map((video) => [video, 0]));
  for (const video of list) {
    Object.defineProperty(video, "load", { value: () => loads.set(video, loads.get(video) + 1) });
  }
  return { window, list, loads };
}

test("Vorladen: auch der erste Film (preload=metadata) lädt voll, sobald er in die Nähe kommt – nicht erst beim Abspielen", async () => {
  const { window, list } = videos();
  const [first, later, already] = list;
  const { Observer, seen } = fakeObserver();
  preloadNearView(list, Observer);
  assert.deepEqual(seen.observed, [first, later]);
  assert.equal(seen.observed.includes(already), false);
  seen.report([{ target: first, isIntersecting: true }, { target: later, isIntersecting: false }]);
  assert.equal(first.preload, "auto");
  assert.equal(later.preload, "none");
  assert.deepEqual(seen.unobserved, [first]);
  await window.happyDOM.close();
});

test("Vorladen: wurden die Quellen nach dem Codec-Wechsel noch nicht neu geladen, lädt der Film beim Näherkommen genau einmal neu", async () => {
  const { window, list, loads } = videos();
  const [first, later] = list;
  later.setAttribute("data-sources-changed", "");
  const { Observer, seen } = fakeObserver();
  preloadNearView(list, Observer);
  seen.report([{ target: first, isIntersecting: true }, { target: later, isIntersecting: true }]);
  assert.equal(loads.get(first), 0);
  assert.equal(loads.get(later), 1);
  assert.equal(later.hasAttribute("data-sources-changed"), false);
  await window.happyDOM.close();
});
