import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { offerDecodableAv1, reloadIfStale } from "../src/scripts/home-codec.js";

const AV1_720 = 'video/mp4; codecs="av01.0.05M.08"';
const AV1_1080 = 'video/mp4; codecs="av01.0.08M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';
const WIDE = "(min-width: 1001px)";
const SHORT_WAIT_MS = 20;
const LATE_ANSWER_MS = 60;
const MAX_WAIT_MS = 1000;
const AFTER_LATE_ANSWER_MS = 120;
const H264_SOURCES = 2;
const FULL_HD = Object.freeze({ width: 1920, height: 1080 });
const HD = Object.freeze({ width: 1280, height: 720 });
const SMOOTH_AND_EFFICIENT = Object.freeze({ supported: true, smooth: true, powerEfficient: true });
const STALE = "data-sources-changed";

function page() {
  const window = new Window({ url: "https://sundartha.test/" });
  const doc = window.document;
  doc.body.innerHTML = ["uc1", "uc2"]
    .map(
      (
        clip,
        index,
      ) => `<video data-clip="${clip}" width="1280" height="720" preload="${index ? "none" : "metadata"}" muted playsinline>
        <source src="/assets/home/${clip}-1080.mp4" type='${H264}' media="${WIDE}" data-av1-src="/assets/home/${clip}-1080.av1.mp4" data-av1-type='${AV1_1080}'>
        <source src="/assets/home/${clip}.mp4" type='${H264}' data-av1-src="/assets/home/${clip}.av1.mp4" data-av1-type='${AV1_720}'>
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
  Array.from(video.querySelectorAll("source"), (source) => [
    source.getAttribute("src"),
    source.getAttribute("media"),
  ]);

function assertOnlyH264(doc, loads) {
  for (const video of doc.querySelectorAll("video")) {
    const clip = video.dataset.clip;
    assert.deepEqual(sourcesOf(video), [
      [`/assets/home/${clip}-1080.mp4`, WIDE],
      [`/assets/home/${clip}.mp4`, null],
    ]);
    assert.equal(video.hasAttribute(STALE), false);
    assert.equal(loads.get(video), 0, "ohne AV1 lädt kein Film neu");
  }
}

test("ohne Hardware-Decoder (nicht unterstützt) bleibt es bei H.264, kein Film lädt neu", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: false })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("AV1 ohne stromsparenden Decoder kommt nicht dazu", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: true, smooth: true, powerEfficient: false })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("AV1, das ruckeln würde, kommt nicht dazu", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve({ supported: true, smooth: false, powerEfficient: true })),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("flüssig und stromsparend decodierbares AV1 steht vor H.264 gleicher Größe; die Filme laden erst bei Bedarf neu", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT)),
  );
  for (const video of doc.querySelectorAll("video")) {
    const clip = video.dataset.clip;
    assert.deepEqual(sourcesOf(video), [
      [`/assets/home/${clip}-1080.av1.mp4`, WIDE],
      [`/assets/home/${clip}-1080.mp4`, WIDE],
      [`/assets/home/${clip}.av1.mp4`, null],
      [`/assets/home/${clip}.mp4`, null],
    ]);
    assert.equal(video.querySelector("source").getAttribute("type"), AV1_1080);
    assert.equal(video.hasAttribute(STALE), true);
    assert.equal(loads.get(video), 0, "kein Laden vor dem ersten Bedarf");
  }
  await window.happyDOM.close();
});

test("nur die Größe, die der Browser gut kann, bekommt AV1", async () => {
  const { doc, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities((config) =>
      Promise.resolve(
        config.video.height === FULL_HD.height ? SMOOTH_AND_EFFICIENT : { supported: false },
      ),
    ),
  );
  const [first] = doc.querySelectorAll("video");
  assert.deepEqual(
    sourcesOf(first).map(([src]) => src),
    ["/assets/home/uc1-1080.av1.mp4", "/assets/home/uc1-1080.mp4", "/assets/home/uc1.mp4"],
  );
  await window.happyDOM.close();
});

test("die Abfrage nennt das AV1-Format, die Größe der jeweiligen Datei, Bitrate und Bildrate", async () => {
  const { doc, window } = page();
  const caps = capabilities(() => Promise.resolve({ supported: false }));
  await offerDecodableAv1(doc, caps);
  const [wide, small] = caps.asked;
  assert.equal(wide.type, "file");
  assert.equal(wide.video.contentType, AV1_1080);
  assert.deepEqual({ width: wide.video.width, height: wide.video.height }, FULL_HD);
  assert.equal(small.video.contentType, AV1_720);
  assert.deepEqual({ width: small.video.width, height: small.video.height }, HD);
  assert.ok(wide.video.bitrate > 0 && wide.video.framerate > 0);
  await window.happyDOM.close();
});

test("ohne mediaCapabilities bleibt es bei H.264", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(doc, undefined);
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine abgelehnte Abfrage lässt H.264 stehen", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.reject(new Error("nein"))),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine werfende Abfrage lässt H.264 stehen", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => {
      throw new Error("kaputt");
    }),
  );
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("eine hängende Abfrage hält die Filme nicht auf; eine späte Zusage ändert danach nichts mehr", async () => {
  const { doc, loads, window } = page();
  const started = Date.now();
  await offerDecodableAv1(
    doc,
    capabilities(
      () =>
        new Promise((resolve) => setTimeout(() => resolve(SMOOTH_AND_EFFICIENT), LATE_ANSWER_MS)),
    ),
    { waitMs: SHORT_WAIT_MS },
  );
  assert.ok(Date.now() - started < MAX_WAIT_MS);
  assertOnlyH264(doc, loads);
  await new Promise((resolve) => setTimeout(resolve, AFTER_LATE_ANSWER_MS));
  assertOnlyH264(doc, loads);
  await window.happyDOM.close();
});

test("ein Film, der schon läuft, bekommt keine neue Quelle", async () => {
  const { doc, loads, window } = page();
  const [running] = doc.querySelectorAll("video");
  Object.defineProperty(running, "paused", { get: () => false });
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT)),
  );
  assert.equal(running.querySelectorAll("source").length, H264_SOURCES);
  assert.equal(running.hasAttribute(STALE), false);
  assert.equal(loads.get(running), 0);
  await window.happyDOM.close();
});

test("ein markierter Film lädt beim ersten Bedarf genau einmal neu", async () => {
  const { doc, loads, window } = page();
  await offerDecodableAv1(
    doc,
    capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT)),
  );
  const [first] = doc.querySelectorAll("video");
  assert.equal(reloadIfStale(first), true);
  assert.equal(loads.get(first), 1);
  assert.equal(reloadIfStale(first), false);
  assert.equal(loads.get(first), 1);
  await window.happyDOM.close();
});

test("Seite ohne AV1-Angebote fragt den Browser gar nicht erst", async () => {
  const { doc, loads, window } = page();
  for (const source of doc.querySelectorAll("source")) source.removeAttribute("data-av1-src");
  const caps = capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT));
  await offerDecodableAv1(doc, caps);
  assert.equal(caps.asked.length, 0);
  for (const video of doc.querySelectorAll("video")) assert.equal(loads.get(video), 0);
  await window.happyDOM.close();
});

test("eine Quelle mit deutschem Schnitt bekommt kein AV1 davor – sonst liefe auf Deutsch der englische Film", async () => {
  const { doc, window } = page();
  const [first] = doc.querySelectorAll("video");
  for (const source of first.querySelectorAll("source")) source.setAttribute("data-src-de", "/assets/home/uc1-de.mp4");
  await offerDecodableAv1(doc, capabilities(() => Promise.resolve(SMOOTH_AND_EFFICIENT)));
  assert.equal(first.querySelectorAll("source").length, H264_SOURCES);
  assert.equal(first.hasAttribute(STALE), false);
  await window.happyDOM.close();
});
