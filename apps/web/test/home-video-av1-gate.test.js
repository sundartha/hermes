import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { dropUndecodableAv1, reloadIfStale } from "../src/scripts/home-codec.js";

const AV1_720 = 'video/mp4; codecs="av01.0.05M.08"';
const AV1_1080 = 'video/mp4; codecs="av01.0.08M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';
const WIDE = "(min-width: 1001px)";
const SHORT_WAIT_MS = 20;
const MAX_WAIT_MS = 1000;
const ALL_SOURCES = 4;
const FULL_HD = Object.freeze({ width: 1920, height: 1080 });
const HD = Object.freeze({ width: 1280, height: 720 });
const SMOOTH_AND_EFFICIENT = Object.freeze({ supported: true, smooth: true, powerEfficient: true });

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

const sourcesOf = (video) =>
  Array.from(video.querySelectorAll("source"), (source) => source.getAttribute("src"));

function assertOnlyH264(doc, loads) {
  for (const video of doc.querySelectorAll("video")) {
    const clip = video.dataset.clip;
    assert.deepEqual(sourcesOf(video), [
      `/assets/home/${clip}-1080.mp4`,
      `/assets/home/${clip}.mp4`,
    ]);
    assert.equal(loads.get(video), 1);
  }
}

function assertUnchanged(doc, loads) {
  for (const video of doc.querySelectorAll("video")) {
    assert.equal(video.querySelectorAll("source").length, ALL_SOURCES);
    assert.equal(loads.get(video), 0);
  }
}

test("AV1, das der Browser nicht decodieren kann, fliegt vor dem Laden raus; H.264 bleibt", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: false, smooth: false, powerEfficient: false })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("AV1 ohne Hardware-Decoder (nicht stromsparend) fliegt ebenfalls raus", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: true, smooth: true, powerEfficient: false })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("AV1, das ruckeln würde, fliegt raus", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: true, smooth: false, powerEfficient: true })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("flüssig und stromsparend decodierbares AV1 bleibt unverändert, kein Neuladen", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT)),
  );
  assertUnchanged(doc, loads);
  await window.happyDOM.close();
});

test("nur die Variante, die der Browser schlecht kann, fällt weg", async () => {
  const { doc, loads, window } = page();
  const caps = capabilities((config) =>
    Promise.resolve(
      config.video.height === FULL_HD.height
        ? { supported: true, smooth: false, powerEfficient: true }
        : SMOOTH_AND_EFFICIENT,
    ),
  );
  await dropUndecodableAv1(doc, caps);
  for (const video of doc.querySelectorAll("video")) {
    const clip = video.dataset.clip;
    assert.deepEqual(sourcesOf(video), [
      `/assets/home/${clip}-1080.mp4`,
      `/assets/home/${clip}.av1.mp4`,
      `/assets/home/${clip}.mp4`,
    ]);
    assert.equal(loads.get(video), 1);
  }
  await window.happyDOM.close();
});

test("die Abfrage nennt Format, Größe der jeweiligen Datei, Bitrate und Bildrate", async () => {
  const { doc, window } = page();
  const caps = capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT));
  await dropUndecodableAv1(doc, caps);
  assert.ok(caps.asked.length > 0);
  for (const config of caps.asked) {
    assert.equal(config.type, "file");
    assert.ok(config.video.bitrate > 0 && config.video.framerate > 0);
    const size = { width: config.video.width, height: config.video.height };
    assert.deepEqual(size, config.video.contentType === AV1_1080 ? FULL_HD : HD);
  }
  await window.happyDOM.close();
});

test("ohne mediaCapabilities spielt die Seite H.264", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(doc, undefined);
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine abgelehnte Abfrage führt zu H.264", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.reject(new TypeError("unsupported config"))),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine werfende Abfrage führt zu H.264", async () => {
  const { doc, loads, window } = page();
  await dropUndecodableAv1(
    doc,
    capabilities(() => {
      throw new TypeError("boom");
    }),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine hängende Abfrage hält die Videos nicht auf und führt zu H.264", async () => {
  const { doc, loads, window } = page();
  const started = Date.now();
  await dropUndecodableAv1(
    doc,
    capabilities(() => new Promise(() => {})),
    SHORT_WAIT_MS,
  );
  assert.ok(Date.now() - started < MAX_WAIT_MS);
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("Seite ohne AV1-Quellen fragt den Browser gar nicht erst und lädt nichts neu", async () => {
  const { doc, loads, window } = page();
  for (const source of doc.querySelectorAll('source[type*="av01"]')) source.remove();
  const caps = capabilities(() => Promise.resolve({ supported: false }));
  await dropUndecodableAv1(doc, caps);
  assert.equal(caps.asked.length, 0);
  for (const video of doc.querySelectorAll("video")) assert.equal(loads.get(video), 0);
  await window.happyDOM.close();
});

test("Video mit preload=none lädt nach dem Codec-Wechsel erst, wenn es gebraucht wird – genau einmal", async () => {
  const { doc, loads, window } = page();
  const [first, later] = doc.querySelectorAll("video");
  first.setAttribute("preload", "metadata");
  later.setAttribute("preload", "none");
  await dropUndecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: false })),
  );
  assert.equal(loads.get(first), 1);
  assert.equal(loads.get(later), 0);
  assert.equal(sourcesOf(later).some((src) => src.includes(".av1.")), false);
  assert.equal(reloadIfStale(later), true);
  assert.equal(loads.get(later), 1);
  assert.equal(reloadIfStale(later), false);
  assert.equal(reloadIfStale(first), false);
  assert.equal(loads.get(later), 1);
  assert.equal(loads.get(first), 1);
  await window.happyDOM.close();
});
