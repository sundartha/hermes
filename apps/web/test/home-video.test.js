import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { scenePlayback, wakePlayback } from "../src/scripts/home-video.js";

const START = 0.4;
const HAVE_NOTHING = 0;
const HAVE_CURRENT_DATA = 2;
const BLOCKED = "NotAllowedError";
const LIVE = "is-live";
const SECOND_TRY = 2;

const settle = () => new Promise((resolve) => setImmediate(resolve));

function rejection(name) {
  return Promise.reject(Object.assign(new Error(name), { name }));
}

function fakeMedia(video, outcomes) {
  const state = { paused: true, muted: true, time: 0, ready: HAVE_NOTHING, seeking: false, plays: 0 };
  const fire = (type) => video.dispatchEvent(new video.ownerDocument.defaultView.Event(type));
  Object.defineProperties(video, {
    paused: { get: () => state.paused },
    muted: {
      get: () => state.muted,
      set: (value) => {
        state.muted = value;
      },
    },
    readyState: { get: () => state.ready },
    seeking: { get: () => state.seeking },
    currentTime: {
      get: () => state.time,
      set: (value) => {
        state.time = value;
        state.seeking = true;
        fire("seeking");
      },
    },
    play: {
      value: () => {
        state.plays += 1;
        const outcome = outcomes.shift();
        if (outcome) return rejection(outcome);
        state.paused = false;
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        state.paused = true;
        fire("pause");
      },
    },
  });
  return { state, fire };
}

function slot(outcomes = []) {
  const window = new Window({ url: "https://sundartha.test/" });
  window.document.body.innerHTML = `<div class="vslot"><video data-clip="uc1" data-start="${START}" muted></video><img class="bg vposter" alt=""><button type="button" class="vpause"></button></div>`;
  const video = window.document.querySelector("video");
  const { state, fire } = fakeMedia(video, outcomes);
  const firstFrameDecoded = () => {
    state.ready = HAVE_CURRENT_DATA;
    fire("loadeddata");
  };
  const seekDone = () => {
    state.seeking = false;
    fire("seeked");
  };
  const tap = (target) => target.dispatchEvent(new window.Event("click", { bubbles: true }));
  return { window, video, box: video.parentElement, playback: scenePlayback(video.parentElement), state, fire, firstFrameDecoded, seekDone, tap };
}

test("Szenen-Video: das Poster bleibt, bis ein Bild ab der Startzeit steht (das erste Bild der Clips ist schwarz)", () => {
  const scene = slot();
  scene.playback.enter();
  scene.firstFrameDecoded();
  assert.equal(scene.box.classList.contains(LIVE), false, "schwarzes erstes Bild sichtbar");
  scene.fire("playing");
  assert.equal(scene.state.time, START, "Sprung an die Startzeit fehlt");
  assert.equal(scene.box.classList.contains(LIVE), false, "Poster weg, bevor der Sprung fertig ist");
  scene.seekDone();
  assert.equal(scene.box.classList.contains(LIVE), true);
});

test("Szenen-Video: vor dem ersten Bild wird nicht gesprungen, auch nicht beim erneuten Ankommen ohne Wiedergabe", () => {
  const scene = slot();
  scene.playback.enter();
  scene.playback.leave();
  scene.playback.enter();
  assert.equal(scene.state.time, 0);
  assert.equal(scene.state.seeking, false);
});

test("Szenen-Video: läuft die Schleife über das Clip-Ende an den dunklen Anfang, springt die nächste Zeitmeldung an die Startzeit; das Poster bleibt weg", () => {
  const scene = slot();
  scene.playback.enter();
  scene.firstFrameDecoded();
  scene.fire("playing");
  scene.seekDone();
  scene.fire("timeupdate");
  scene.state.time = 0;
  scene.fire("seeking");
  assert.equal(scene.state.time, 0);
  scene.fire("timeupdate");
  assert.equal(scene.state.time, START);
  assert.equal(scene.box.classList.contains(LIVE), true);
});

test("Szenen-Video: lädt das Video neu, liegt wieder das Poster darüber", () => {
  const scene = slot();
  scene.playback.enter();
  scene.firstFrameDecoded();
  scene.fire("playing");
  scene.seekDone();
  scene.fire("emptied");
  assert.equal(scene.box.classList.contains(LIVE), false);
});

test("Szenen-Video: lehnt der Browser den Start mit Ton ab, läuft das Video stumm an", async () => {
  const scene = slot([BLOCKED]);
  scene.state.muted = false;
  scene.playback.resume();
  await settle();
  assert.equal(scene.state.muted, true);
  assert.equal(scene.state.paused, false);
  assert.equal(scene.state.plays, SECOND_TRY);
});

test("Szenen-Video: ist auch der stumme Start gesperrt (Stromsparmodus), bleibt das Poster und es gibt keinen Dauerversuch; die nächste Geste versucht es neu", async () => {
  const scene = slot([BLOCKED]);
  scene.playback.enter();
  await settle();
  scene.playback.keep();
  scene.playback.keep();
  assert.equal(scene.state.plays, 1);
  assert.equal(scene.box.classList.contains(LIVE), false);
  scene.playback.retry();
  scene.playback.keep();
  assert.equal(scene.state.plays, SECOND_TRY);
  assert.equal(scene.state.paused, false);
});

test("Szenen-Video: hält der Browser ein sichtbares Video an, startet es wieder; eine Pause des Nutzers bleibt", () => {
  const scene = slot();
  scene.playback.enter();
  scene.state.paused = true;
  scene.playback.keep();
  assert.equal(scene.state.paused, false);
  scene.video.dataset.userPaused = "1";
  scene.video.pause();
  scene.playback.keep();
  assert.equal(scene.state.paused, true);
  assert.equal(scene.state.plays, SECOND_TRY);
});

test("Szenen-Video: verlässt die Szene das Bild, hält die Seite an und markiert das; zurück im Bild beginnt sie wieder an der Startzeit", () => {
  const scene = slot();
  scene.playback.enter();
  scene.firstFrameDecoded();
  scene.fire("playing");
  scene.seekDone();
  scene.state.time = 5;
  scene.playback.leave();
  assert.equal(scene.state.paused, true);
  assert.equal(scene.video.dataset.held, "1");
  scene.playback.enter();
  assert.equal(scene.video.dataset.held, undefined);
  assert.equal(scene.state.time, START);
  assert.equal(scene.state.paused, false);
});

function woken(scene) {
  const { playback } = scene;
  wakePlayback(scene.window.document, [playback], () => playback.keep());
}

test("Szenen-Video: war der Start gesperrt, startet ein Tipp irgendwo auf der Seite das sichtbare Video", async () => {
  const scene = slot([BLOCKED]);
  woken(scene);
  scene.playback.enter();
  await settle();
  scene.tap(scene.window.document.body);
  assert.equal(scene.state.paused, false);
  assert.equal(scene.state.plays, SECOND_TRY);
});

test("Szenen-Video: ein Tipp auf den Abspiel-Knopf wird nicht doppelt behandelt (ein Tipp genügt, er gilt nicht als Pause)", async () => {
  const scene = slot([BLOCKED]);
  woken(scene);
  scene.playback.enter();
  await settle();
  scene.tap(scene.box.querySelector(".vpause"));
  assert.equal(scene.state.plays, 1);
  assert.equal(scene.state.paused, true);
});

test("Szenen-Video: wurden die Quellen ohne Neuladen getauscht, lädt das Video beim Ankommen einmal neu und startet dann", () => {
  const scene = slot();
  const playsAtLoad = [];
  Object.defineProperty(scene.video, "load", { value: () => playsAtLoad.push(scene.state.plays) });
  scene.video.dataset.sourcesChanged = "1";
  scene.playback.enter();
  assert.deepEqual(playsAtLoad, [0], "Neuladen muss vor dem ersten Start kommen");
  assert.equal(scene.state.plays, 1);
  scene.playback.leave();
  scene.playback.enter();
  assert.deepEqual(playsAtLoad, [0], "nur einmal neu laden");
  assert.equal(scene.state.plays, SECOND_TRY);
});
