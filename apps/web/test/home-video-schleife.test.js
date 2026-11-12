import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { scenePlayback } from "../src/scripts/home-video.js";

const FRAMES_PER_S = 24;
const HAVE_ENOUGH_DATA = 4;
const FAILED = "is-failed";
const LIVE = "is-live";
const TWO_ROUNDS = 2;
const INTRO_JUMP = 1;
const EARLIEST_CUT_FRAMES = 4;
const COARSE_STEP_S = 0.25;
const COARSE_LEAD_S = 0.35;
const COARSE_PHASES = 5;
const COARSE_PHASE_STEP_S = 0.05;
const SHORT_FILM_S = 0.3;
const MID_FILM_S = 5;
const CLIPS = Object.freeze([
  { clip: "uc1", start: 0.4, firstBright: 10, firstDimmed: 397, frames: 411 },
  { clip: "uc2", start: 0.4, firstBright: 10, firstDimmed: 508, frames: 527 },
  { clip: "uc3", start: 0.5, firstBright: 12, firstDimmed: 273, frames: 301 },
  { clip: "uc4", start: 0.4, firstBright: 10, firstDimmed: 166, frames: 180 },
]);
const [FIRST] = CLIPS;

function frameRequests(video) {
  const waiting = new Map();
  let handles = 0;
  Object.defineProperties(video, {
    requestVideoFrameCallback: {
      value: (callback) => {
        handles += 1;
        waiting.set(handles, callback);
        return handles;
      },
    },
    cancelVideoFrameCallback: { value: (handle) => waiting.delete(handle) },
  });
  return waiting;
}

function fakeFilm(video, film) {
  const state = {
    paused: true,
    muted: true,
    time: 0,
    seeking: false,
    plays: 0,
    jumps: [],
    waiting: film.perFrame ? frameRequests(video) : new Map(),
    duration: film.frames / FRAMES_PER_S,
  };
  const fire = (type) => video.dispatchEvent(new video.ownerDocument.defaultView.Event(type));
  Object.defineProperties(video, {
    paused: { get: () => state.paused },
    muted: {
      get: () => state.muted,
      set: (value) => {
        state.muted = value;
      },
    },
    readyState: { get: () => HAVE_ENOUGH_DATA },
    duration: { get: () => state.duration },
    seeking: { get: () => state.seeking },
    currentTime: {
      get: () => state.time,
      set: (value) => {
        state.jumps.push(value);
        state.time = value;
        state.seeking = true;
      },
    },
    play: {
      value: () => {
        state.plays += 1;
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

function scene(film = FIRST, perFrame = true) {
  const window = new Window({ url: "https://sundartha.test/" });
  window.document.body.innerHTML = `<div class="vslot"><video data-clip="${film.clip}" data-start="${film.start}" muted loop></video><div class="vfail" hidden><button type="button" class="vretry"></button></div></div>`;
  const video = window.document.querySelector("video");
  const { state, fire } = fakeFilm(video, { ...film, perFrame });
  const playback = scenePlayback(video.parentElement);
  const seekDone = () => {
    state.seeking = false;
    fire("seeked");
  };
  const present = (time) => {
    state.time = time;
    const callbacks = Array.from(state.waiting.values());
    state.waiting.clear();
    for (const callback of callbacks) callback();
  };
  const begin = () => {
    playback.enter();
    fire("playing");
    seekDone();
    fire("timeupdate");
  };
  return { video, box: video.parentElement, playback, state, fire, seekDone, present, begin };
}

function playRound(film, stage) {
  const shown = [];
  for (let frame = film.firstBright; frame < film.frames; frame += 1) {
    stage.present(frame / FRAMES_PER_S);
    shown.push(frame);
    if (stage.state.seeking) break;
  }
  stage.seekDone();
  return shown;
}

for (const film of CLIPS) {
  test(`Szenen-Schleife ${film.clip}: zwei Umläufe springen jeweils vor dem ersten abgedunkelten Bild zurück an den hellen Anfang`, () => {
    const stage = scene(film);
    stage.begin();
    for (let round = 0; round < TWO_ROUNDS; round += 1) {
      const shown = playRound(film, stage);
      const last = shown.at(-1);
      assert.ok(last < film.firstDimmed, `abgedunkeltes Bild ${last} gezeigt`);
      assert.ok(
        last >= film.firstDimmed - EARLIEST_CUT_FRAMES,
        `Schnitt zu früh, letztes Bild ${last}`,
      );
      assert.equal(stage.state.time, film.start, "Rücksprung landet nicht am hellen Anfang");
    }
    assert.equal(
      stage.state.jumps.length,
      INTRO_JUMP + TWO_ROUNDS,
      "je Umlauf genau ein Rücksprung",
    );
    assert.equal(stage.state.plays, 1, "die Schleife startet die Wiedergabe nicht neu");
    assert.equal(stage.box.classList.contains(LIVE), true, "Poster über dem laufenden Film");
  });
}

for (let shift = 0; shift < COARSE_PHASES; shift += 1) {
  test(`Szenen-Schleife: ohne Bild-für-Bild-Rückruf springt die Zeitmeldung vor der Abdunklung zurück (Meldungen alle ${COARSE_STEP_S} s, Versatz ${shift} × ${COARSE_PHASE_STEP_S} s)`, () => {
    const stage = scene(FIRST, false);
    stage.begin();
    const fadeOut = FIRST.firstDimmed / FRAMES_PER_S;
    let time = fadeOut - 1 + shift * COARSE_PHASE_STEP_S;
    while (!stage.state.seeking && time < FIRST.frames / FRAMES_PER_S) {
      stage.state.time = time;
      stage.fire("timeupdate");
      time += COARSE_STEP_S;
    }
    const jumpedAt = time - COARSE_STEP_S;
    assert.equal(stage.state.time, FIRST.start, "kein Rücksprung");
    assert.ok(jumpedAt < fadeOut, `erst bei ${jumpedAt} s gesprungen, Abdunklung ab ${fadeOut} s`);
    assert.ok(jumpedAt >= fadeOut - COARSE_LEAD_S - COARSE_STEP_S, `zu früh gesprungen: ${jumpedAt} s`);
  });
}

test("Szenen-Schleife: läuft der Film doch über sein Ende an den dunklen Anfang, springt die nächste Zeitmeldung an den hellen Anfang – auch ohne neues Abspiel-Ereignis", () => {
  const stage = scene();
  stage.begin();
  stage.state.time = 0;
  stage.fire("timeupdate");
  assert.equal(stage.state.time, FIRST.start);
  assert.equal(stage.state.jumps.length, INTRO_JUMP + 1);
});

test("Szenen-Schleife: landet ein Rücksprung nicht im hellen Bereich, wird nicht endlos weitergesprungen", () => {
  const stage = scene();
  stage.begin();
  stage.present(FIRST.firstDimmed / FRAMES_PER_S);
  assert.equal(stage.state.jumps.length, INTRO_JUMP + 1);
  stage.fire("timeupdate");
  stage.fire("seeked");
  assert.equal(stage.state.jumps.length, INTRO_JUMP + 1, "Sprung während eines laufenden Sprungs");
  stage.state.seeking = false;
  stage.state.time = 0;
  for (const type of ["seeked", "timeupdate", "playing", "timeupdate"]) stage.fire(type);
  stage.present(0);
  assert.equal(stage.state.jumps.length, INTRO_JUMP + 1, "Sprung-Schleife");
  stage.present(MID_FILM_S);
  stage.present(FIRST.firstDimmed / FRAMES_PER_S);
  assert.equal(
    stage.state.jumps.length,
    INTRO_JUMP + TWO_ROUNDS,
    "nach einem hellen Bild wird wieder gesprungen",
  );
});

test("Szenen-Schleife: es wartet nie mehr als ein Bild-Rückruf, auch nach Zeitmeldungen, Pause und Quellenwechsel", () => {
  const stage = scene();
  stage.begin();
  for (const type of ["timeupdate", "playing", "timeupdate"]) stage.fire(type);
  assert.equal(stage.state.waiting.size, 1);
  stage.present(MID_FILM_S);
  assert.equal(stage.state.waiting.size, 1);
  stage.video.pause();
  stage.fire("timeupdate");
  assert.equal(stage.state.waiting.size, 0, "Rückruf wartet trotz Pause");
  stage.state.paused = false;
  stage.fire("playing");
  stage.fire("emptied");
  assert.equal(stage.state.waiting.size, 0, "Rückruf wartet nach dem Quellenwechsel");
  stage.fire("playing");
  assert.equal(stage.state.waiting.size, 1);
});

test("Szenen-Schleife: eine Pause bleibt eine Pause und stumm bleibt stumm, wenn die Schleife springt", () => {
  const stage = scene();
  stage.begin();
  stage.video.dataset.userPaused = "1";
  stage.video.pause();
  stage.state.time = FIRST.firstDimmed / FRAMES_PER_S;
  stage.fire("timeupdate");
  assert.equal(stage.state.time, FIRST.start);
  assert.equal(stage.state.paused, true);
  assert.equal(stage.state.plays, 1);
  assert.equal(stage.state.muted, true);
  assert.equal(stage.video.dataset.userPaused, "1");
});

test("Szenen-Schleife: eingeschalteter Ton bleibt über den Rücksprung an, ein angehaltener Film bleibt angehalten", () => {
  const stage = scene();
  stage.begin();
  stage.state.muted = false;
  stage.present(FIRST.firstDimmed / FRAMES_PER_S);
  stage.seekDone();
  assert.equal(stage.state.muted, false);
  stage.playback.leave();
  stage.state.time = 0;
  stage.fire("timeupdate");
  assert.equal(stage.video.dataset.held, "1");
  assert.equal(stage.state.paused, true);
  assert.equal(stage.state.plays, 1);
});

test("Szenen-Schleife: im Fehlerzustand springt nichts", () => {
  const stage = scene();
  stage.begin();
  stage.box.classList.add(FAILED);
  stage.state.time = FIRST.firstDimmed / FRAMES_PER_S;
  stage.fire("timeupdate");
  stage.present(stage.state.time);
  assert.equal(stage.state.jumps.length, INTRO_JUMP);
});

test("Szenen-Schleife: nach dem zweiten Versuch und nach einem Quellenwechsel springt der Film wieder über den dunklen Anfang", () => {
  const stage = scene();
  stage.begin();
  stage.state.time = 0;
  stage.fire("timeupdate");
  stage.fire("emptied");
  stage.state.seeking = false;
  stage.state.time = 0;
  stage.fire("playing");
  assert.equal(stage.state.jumps.length, INTRO_JUMP + TWO_ROUNDS);
  assert.equal(stage.state.time, FIRST.start);
});

test("Szenen-Schleife: ohne gültige Länge gilt die gemessene Grenze; ein Film, der kürzer ist als sein Anfang, wird nicht angesprungen", () => {
  const unknown = scene();
  unknown.state.duration = NaN;
  unknown.begin();
  unknown.present(FIRST.firstDimmed / FRAMES_PER_S);
  assert.equal(unknown.state.time, FIRST.start);
  const short = scene();
  short.state.duration = SHORT_FILM_S;
  short.playback.enter();
  for (const type of ["playing", "timeupdate", "seeked", "timeupdate"]) short.fire(type);
  assert.deepEqual(short.state.jumps, []);
});

test("Szenen-Schleife: ein Film ohne gemessene Grenze läuft bis zu seinem Ende, wie im Clip angelegt", () => {
  const stage = scene({ ...FIRST, clip: "neu" });
  stage.begin();
  stage.present(FIRST.frames / FRAMES_PER_S);
  stage.fire("timeupdate");
  assert.equal(stage.state.jumps.length, INTRO_JUMP);
  stage.fire("emptied");
  stage.state.seeking = false;
  stage.state.time = MID_FILM_S;
  stage.fire("timeupdate");
  assert.equal(stage.state.jumps.length, INTRO_JUMP, "Sprung mitten im Film");
});
