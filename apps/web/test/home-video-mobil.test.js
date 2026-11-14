import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { offerDecodableAv1, prefersH264Only } from "../src/scripts/home-codec.js";
import { videoDiagnosis } from "../src/scripts/home-vdiag.js";
import { scenePlayback } from "../src/scripts/home-video.js";

const AV1_720 = 'video/mp4; codecs="av01.0.05M.08"';
const AV1_1080 = 'video/mp4; codecs="av01.0.08M.08"';
const H264 = 'video/mp4; codecs="avc1.640028"';
const WIDE = "(min-width: 1001px)";
const SHORT_WAIT_MS = 20;
const AFTER_ANSWERS_MS = 40;
const NO_SOURCE = 3;
const LOADING = 2;
const TOUCH_POINTS = 5;
const WINDOWS_TOUCH_POINTS = 10;
const STALE = "data-sources-changed";
const GOOD = Object.freeze({ supported: true, smooth: true, powerEfficient: true });
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function device({ agent = DESKTOP_CHROME, touchPoints = 0, queries = [] } = {}) {
  return {
    navigator: { userAgent: agent, maxTouchPoints: touchPoints },
    matchMedia: (query) => ({ matches: queries.includes(query) }),
  };
}

function scene(clip) {
  return `<article class="scene"><div class="vslot">
    <video data-clip="${clip}" width="1280" height="720" preload="none" muted playsinline>
      <source src="/assets/home/${clip}-1080.mp4" type='${H264}' media="${WIDE}" data-av1-src="/assets/home/${clip}-1080.av1.mp4" data-av1-type='${AV1_1080}'>
      <source src="/assets/home/${clip}.mp4" type='${H264}' data-av1-src="/assets/home/${clip}.av1.mp4" data-av1-type='${AV1_720}'>
    </video>
    <div class="vfail" role="status" hidden><span>Video didn't load.</span> <button type="button" class="vretry">Try again</button></div>
  </div></article>`;
}

function fakeMedia(video) {
  const media = { paused: true, networkState: LOADING, readyState: 0, loads: 0, plays: 0 };
  Object.defineProperties(video, {
    paused: { get: () => media.paused },
    networkState: { get: () => media.networkState },
    readyState: { get: () => media.readyState },
    currentSrc: { get: () => "" },
    play: {
      value: () => {
        media.plays += 1;
        return Promise.resolve();
      },
    },
    load: {
      value: () => {
        media.loads += 1;
        media.networkState = LOADING;
      },
    },
  });
  return media;
}

function page(url = "https://sundartha.test/") {
  const window = new Window({ url });
  const doc = window.document;
  doc.body.innerHTML = ["uc1", "uc2"].map(scene).join("");
  const videos = Array.from(doc.querySelectorAll("video"));
  const media = videos.map(fakeMedia);
  return { window, doc, videos, media };
}

function capabilities(answer = GOOD) {
  const asked = [];
  return {
    asked,
    decodingInfo: (config) => {
      asked.push(config);
      return Promise.resolve(answer);
    },
  };
}

const srcs = (video) =>
  Array.from(video.querySelectorAll("source"), (source) => source.getAttribute("src"));

test("Mobilerkennung: iPhone, iPad mit Desktop-Kennung, Touch-Bedienung und schmaler Bildschirm gelten als mobil", () => {
  assert.equal(
    prefersH264Only(device({ agent: IPHONE, touchPoints: TOUCH_POINTS })),
    true,
    "iPhone",
  );
  assert.equal(
    prefersH264Only(device({ agent: IPAD_AS_MAC, touchPoints: TOUCH_POINTS })),
    true,
    "iPad als Mac",
  );
  assert.equal(prefersH264Only(device({ queries: ["(pointer: coarse)"] })), true, "Touch");
  assert.equal(prefersH264Only(device({ queries: ["(max-width: 1000px)"] })), true, "schmal");
  assert.equal(prefersH264Only(device({ agent: IPAD_AS_MAC })), false, "Mac-Safari ohne Touch");
  assert.equal(prefersH264Only(device()), false, "Desktop-Chrome");
  assert.equal(
    prefersH264Only(device({ agent: WINDOWS_CHROME, touchPoints: WINDOWS_TOUCH_POINTS })),
    false,
    "Touch-Laptop mit Trackpad",
  );
  assert.equal(
    prefersH264Only({ navigator: { userAgent: DESKTOP_CHROME, maxTouchPoints: 0 } }),
    false,
    "ohne matchMedia",
  );
});

test("mobil nie AV1: auch wenn der Decoder alles zusagt, bleibt jeder Film bei H.264 und lädt nicht neu", async () => {
  const { window, videos, media, doc } = page();
  const caps = capabilities();
  await offerDecodableAv1(doc, caps, { waitMs: SHORT_WAIT_MS, mobile: true });
  await wait(AFTER_ANSWERS_MS);
  for (const [index, video] of videos.entries()) {
    const clip = video.dataset.clip;
    assert.deepEqual(srcs(video), [`/assets/home/${clip}-1080.mp4`, `/assets/home/${clip}.mp4`]);
    assert.equal(video.hasAttribute(STALE), false);
    assert.equal(media[index].loads, 0);
  }
  assert.equal(caps.asked.length, 0, "ohne Diagnose fragt das Gate den Decoder gar nicht");
  await window.happyDOM.close();
});

test("mobil nie AV1: im Diagnosemodus wird der Decoder nur protokolliert, AV1 kommt trotzdem nicht dazu", async () => {
  const { window, videos, doc } = page();
  const lines = [];
  await offerDecodableAv1(doc, capabilities(), {
    waitMs: SHORT_WAIT_MS,
    mobile: true,
    note: (line) => lines.push(line),
  });
  await wait(AFTER_ANSWERS_MS);
  for (const video of videos)
    assert.equal(
      srcs(video).some((src) => src.endsWith(".av1.mp4")),
      false,
    );
  assert.ok(lines.includes("Gate: Mobilgerät, nur H.264"));
  assert.ok(
    lines.some((line) => line.startsWith("decodingInfo /assets/home/uc1.av1.mp4: supported=true")),
  );
  await window.happyDOM.close();
});

test("vdiag nur mit Parameter aktiv: ohne ?vdiag=1 entsteht nichts, nichts wird gesendet oder gespeichert", async () => {
  const { window, doc } = page("https://sundartha.test/?av1=force&vdiag=0");
  const calls = [];
  window.fetch = () => calls.push("fetch");
  window.navigator.sendBeacon = () => calls.push("beacon");
  window.localStorage.setItem = () => calls.push("storage");
  assert.equal(videoDiagnosis(window, doc), null);
  assert.equal(doc.querySelector(".vdiag"), null);
  assert.deepEqual(calls, []);
  await window.happyDOM.close();
});

test("vdiag mit ?vdiag=1: Textfeld zeigt Gerät, Gate-Entscheidung, Ereignisse und den Grund der Fehlerzeile", async () => {
  const { window, doc, videos, media } = page("https://sundartha.test/?vdiag=1");
  const calls = [];
  window.fetch = () => calls.push("fetch");
  window.navigator.sendBeacon = () => calls.push("beacon");
  window.localStorage.setItem = () => calls.push("storage");
  const diag = videoDiagnosis(window, doc);
  assert.equal(diag.forceAv1, false);
  diag.watchVideos();
  await offerDecodableAv1(doc, capabilities(), {
    waitMs: SHORT_WAIT_MS,
    mobile: true,
    note: diag.note,
  });
  for (const slot of doc.querySelectorAll(".vslot")) scenePlayback(slot);
  media[0].networkState = NO_SOURCE;
  const sources = videos[0].querySelectorAll("source");
  sources[sources.length - 1].dispatchEvent(new window.Event("error"));
  await wait(AFTER_ANSWERS_MS);
  const text = doc.querySelector("pre.vdiag").textContent;
  assert.match(text, /UA Mozilla/);
  assert.match(text, /Gate: Mobilgerät, nur H\.264/);
  assert.match(text, /uc1 source-error uc1\.mp4 ns=3/);
  assert.match(text, /uc1 FEHLERZEILE nach: uc1 source-error uc1\.mp4/);
  assert.deepEqual(calls, []);
  await window.happyDOM.close();
});

test("vdiag mit av1=force stellt AV1 auch mobil voran", async () => {
  const { window, doc, videos } = page("https://sundartha.test/?vdiag=1&av1=force");
  const diag = videoDiagnosis(window, doc);
  assert.equal(diag.forceAv1, true);
  await offerDecodableAv1(doc, capabilities({ supported: false }), {
    waitMs: SHORT_WAIT_MS,
    mobile: true,
    force: diag.forceAv1,
    note: diag.note,
  });
  assert.deepEqual(srcs(videos[0]), [
    "/assets/home/uc1-1080.av1.mp4",
    "/assets/home/uc1-1080.mp4",
    "/assets/home/uc1.av1.mp4",
    "/assets/home/uc1.mp4",
  ]);
  assert.equal(videos[0].hasAttribute(STALE), true);
  await window.happyDOM.close();
});

test("Retry → H.264: nach erzwungenem AV1 nimmt Try again nur noch H.264 und lädt nur diesen Film neu", async () => {
  const { window, doc, videos, media } = page();
  await offerDecodableAv1(doc, capabilities(), {
    waitMs: SHORT_WAIT_MS,
    mobile: true,
    force: true,
  });
  const slots = Array.from(doc.querySelectorAll(".vslot"));
  for (const slot of slots) scenePlayback(slot);
  media[0].networkState = NO_SOURCE;
  const sources = videos[0].querySelectorAll("source");
  sources[sources.length - 1].dispatchEvent(new window.Event("error"));
  assert.equal(slots[0].querySelector(".vfail").hidden, false, "Fehlerzeile sichtbar");
  slots[0].querySelector(".vretry").click();
  assert.deepEqual(srcs(videos[0]), ["/assets/home/uc1-1080.mp4", "/assets/home/uc1.mp4"]);
  assert.equal(slots[0].querySelector(".vfail").hidden, true);
  assert.equal(media[0].loads, 1, "genau ein Neuladen");
  assert.equal(media[1].loads, 0, "die anderen Filme laden nicht mit");
  assert.equal(media[0].plays, 1);
  await window.happyDOM.close();
});

test("vdiag protokolliert auch Fehler der erst später eingefügten AV1-Quelle und nennt sie als Grund der Fehlerzeile", async () => {
  const { window, doc, videos, media } = page("https://sundartha.test/?vdiag=1&av1=force");
  const diag = videoDiagnosis(window, doc);
  diag.watchVideos();
  await offerDecodableAv1(doc, capabilities({ supported: false }), {
    waitMs: SHORT_WAIT_MS,
    mobile: true,
    force: true,
    note: diag.note,
  });
  for (const slot of doc.querySelectorAll(".vslot")) scenePlayback(slot);
  const av1 = videos[0].querySelector('source[src="/assets/home/uc1.av1.mp4"]');
  av1.dispatchEvent(new window.Event("error"));
  const sources = videos[0].querySelectorAll("source");
  media[0].networkState = NO_SOURCE;
  sources[sources.length - 1].dispatchEvent(new window.Event("error"));
  await wait(AFTER_ANSWERS_MS);
  const text = doc.querySelector("pre.vdiag").textContent;
  assert.match(text, /uc1 source-error uc1\.av1\.mp4/);
  assert.match(text, /decodingInfo \/assets\/home\/uc1\.av1\.mp4: supported=false/);
  assert.match(text, /uc1 FEHLERZEILE nach: uc1 source-error uc1\.mp4/);
  await window.happyDOM.close();
});
