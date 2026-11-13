import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { dropUndecodableAv1 } from "../src/scripts/home-codec.js";

const AV1_720 = 'video/mp4; codecs="av01.0.05M.08"';
const AV1_1080 = 'video/mp4; codecs="av01.0.08M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';
const WIDE = "(min-width: 1001px)";
const SHORT_WAIT_MS = 20;
const MAX_WAIT_MS = 1000;
const ALL_SOURCES = 4;

function page() {
  const window = new Window({ url: "https://sundartha.test/" });
  const doc = window.document;
  doc.body.innerHTML = ["uc1", "uc2"]
    .map(
      (clip) => `<video data-clip="${clip}" width="1280" height="720" muted playsinline>
        <source src="/assets/home/${clip}-1080.av1.mp4" type='${AV1_1080}' media="${WIDE}">
        <source src="/assets/home/${clip}-1080.mp4" type='${H264}' media="${WIDE}">
        <source src="/assets/home/${clip}.av1.mp4" type='${AV1_720}'>
        <source src="/assets/home/${clip}.mp4" type='${H264}'>
      </video>`,
    )
    .join("");
  const loads = new Map();
  for (const video of doc.querySelectorAll("video")) {
    loads.set(video, 0);
    Object.defineProperty(video, "load", { value: () => loads.set(video, loads.get(video) + 1) });
  }
  return { doc, loads, window };
}

function capabilities(answer) {
  const asked = [];
  return {
    asked,
    decodingInfo: (config) => {
      asked.push(config);
      return answer(config);
    },
  };
}

const sourcesOf = (video) => Array.from(video.querySelectorAll("source"), (source) => source.getAttribute("src"));
const isAv1 = (config) => config.video.contentType.includes("av01");

test("AV1, das der Browser nicht decodieren kann, fliegt vor dem Laden raus; H.264 bleibt", async () => {
  const { doc, loads, window } = page();
  const caps = capabilities((config) => Promise.resolve({ supported: !isAv1(config) }));
  await dropUndecodableAv1(doc, caps);
  for (const video of doc.querySelectorAll("video")) {
    const clip = video.dataset.clip;
    assert.deepEqual(sourcesOf(video), [`/assets/home/${clip}-1080.mp4`, `/assets/home/${clip}.mp4`]);
    assert.equal(loads.get(video), 1);
  }
  assert.ok(caps.asked.every((config) => config.type === "file" && config.video.width > 0 && config.video.bitrate > 0));
  await window.happyDOM.close();
});

test("decodierbares AV1 bleibt unverändert, kein Neuladen", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(doc, capabilities(() => Promise.resolve({ supported: true, smooth: true, powerEfficient: false })));
  for (const video of doc.querySelectorAll("video")) {
    assert.equal(video.querySelectorAll("source").length, ALL_SOURCES);
    assert.equal(loads.get(video), 0);
  }
  await window.happyDOM.close();
});

test("ohne mediaCapabilities bleibt alles wie bisher", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(doc, undefined);
  for (const video of doc.querySelectorAll("video")) {
    assert.equal(video.querySelectorAll("source").length, ALL_SOURCES);
    assert.equal(loads.get(video), 0);
  }
  await window.happyDOM.close();
});

test("eine abgelehnte Abfrage ändert nichts", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(doc, capabilities(() => Promise.reject(new TypeError("unsupported config"))));
  for (const video of doc.querySelectorAll("video")) {
    assert.equal(video.querySelectorAll("source").length, ALL_SOURCES);
    assert.equal(loads.get(video), 0);
  }
  await window.happyDOM.close();
});

test("eine hängende Abfrage hält die Videos nicht auf", async () => {
  const { doc, loads, window } = page();
  const started = Date.now();
  await dropUndecodableAv1(doc, capabilities(() => new Promise(() => {})), SHORT_WAIT_MS);
  assert.ok(Date.now() - started < MAX_WAIT_MS);
  for (const video of doc.querySelectorAll("video")) {
    assert.equal(video.querySelectorAll("source").length, ALL_SOURCES);
    assert.equal(loads.get(video), 0);
  }
  await window.happyDOM.close();
});

test("Seite ohne AV1-Quellen fragt den Browser gar nicht erst", async () => {
  const { doc, window } = page();
  for (const source of doc.querySelectorAll('source[type*="av01"]')) source.remove();
  const caps = capabilities(() => Promise.resolve({ supported: false }));
  await dropUndecodableAv1(doc, caps);
  assert.equal(caps.asked.length, 0);
  await window.happyDOM.close();
});
