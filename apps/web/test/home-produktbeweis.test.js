import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Window } from "happy-dom";
import { wireProof } from "../src/scripts/home-proof.js";
import { HOME_GERMAN } from "../src/lib/home-german.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE = readFileSync(join(WEB_ROOT, "src/pages/index.astro"), "utf8");
const CUES = ["uc3-en.vtt", "uc3-de.vtt"].map((file) =>
  readFileSync(join(WEB_ROOT, "public/assets/home", file), "utf8"),
);

const CONFIRMED_AT = 0.9;
const CALL_AT = 2.7;
const STATUS_TIMES = [0, CONFIRMED_AT, CALL_AT];
const BEFORE_CONFIRMED = 0.5;
const AFTER_CONFIRMED = 1.2;
const AFTER_CALL = 3;
const SECOND_LOOP_START = 0.2;
const SECONDS = { hour: 3600, minute: 60 };
const NO_SOURCE = 3;
const LOADING = 2;

function sceneWithProof(times = STATUS_TIMES) {
  const rows = times.map((at, index) => `<li data-at="${at}">Status ${index + 1}</li>`).join("");
  return `<article class="scene"><div class="vslot">
    <video data-clip="uc3" muted></video>
    <div class="vproof"><span class="vproof-eg">Example</span><ol>${rows}</ol></div>
  </div></article>`;
}

function page(html, reduce = false) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.body.innerHTML = html;
  const video = document.querySelector("video");
  const film = { time: 0, paused: false };
  Object.defineProperties(video, {
    currentTime: { get: () => film.time },
    paused: { get: () => film.paused },
  });
  wireProof(document, reduce);
  const proof = document.querySelector(".vproof");
  const playTo = (time) => {
    film.time = time;
    video.dispatchEvent(new window.Event("timeupdate"));
  };
  const reached = () =>
    Array.from(document.querySelectorAll(".vproof li"), (row) => row.classList.contains("done"));
  return { proof, film, playTo, reached };
}

function firstHermesCue(vtt) {
  const cue = vtt.match(/(\d+):(\d+):(\d+\.\d+) --> [^\n]*\n<v Hermes>/);
  assert.ok(cue, "Untertitel-Datei nennt keinen Satz von Hermes");
  const [hours, minutes, seconds] = cue.slice(1).map(Number);
  return hours * SECONDS.hour + minutes * SECONDS.minute + seconds;
}

function proofRows() {
  const block = PAGE.match(/proof: \[([\s\S]*?)\n\s*\],/)?.[1] ?? "";
  return Array.from(block.matchAll(/at: "([^"]*)", key: "([^"]*)", text: "([^"]*)"/g), (row) => ({
    at: Number(row[1]),
    key: row[2],
    text: row[3],
  }));
}

test("Szene III: ohne laufenden Film steht der ganze Beispielablauf lesbar da", () => {
  const { proof, reached } = page(sceneWithProof());
  assert.equal(proof.classList.contains("sync"), false);
  assert.deepEqual(reached(), [false, false, false]);
});

test("Szene III: die Statusfolge folgt der Filmzeit in der Reihenfolge Auftrag, bestätigt, Anruf", () => {
  const { proof, playTo, reached } = page(sceneWithProof());
  playTo(BEFORE_CONFIRMED);
  assert.equal(proof.classList.contains("sync"), true);
  assert.deepEqual(reached(), [true, false, false]);
  playTo(AFTER_CONFIRMED);
  assert.deepEqual(reached(), [true, true, false]);
  playTo(AFTER_CALL);
  assert.deepEqual(reached(), [true, true, true]);
});

test("Szene III: nach dem ersten Durchlauf bleibt der Endzustand in der zweiten Schleife stehen", () => {
  const { playTo, reached } = page(sceneWithProof());
  playTo(AFTER_CALL);
  playTo(SECOND_LOOP_START);
  assert.deepEqual(reached(), [true, true, true]);
  playTo(AFTER_CONFIRMED);
  assert.deepEqual(reached(), [true, true, true]);
});

test("Szene III: ein Sprung zurück nimmt keinen erreichten Status zurück", () => {
  const { playTo, reached } = page(sceneWithProof());
  playTo(AFTER_CONFIRMED);
  playTo(BEFORE_CONFIRMED);
  assert.deepEqual(reached(), [true, true, false]);
});

test("Szene III: ein angehaltener Film schaltet den Ablauf nicht weiter", () => {
  const { proof, film, playTo, reached } = page(sceneWithProof());
  film.paused = true;
  playTo(AFTER_CALL);
  assert.equal(proof.classList.contains("sync"), false);
  assert.deepEqual(reached(), [false, false, false]);
});

test("Szene III: mit reduzierter Bewegung bleibt der Ablauf im lesbaren Endzustand", () => {
  const { proof, playTo, reached } = page(sceneWithProof(), true);
  playTo(BEFORE_CONFIRMED);
  assert.equal(proof.classList.contains("sync"), false);
  assert.deepEqual(reached(), [false, false, false]);
});

test("Szene III: Szenen ohne Statusfolge bleiben unberührt", () => {
  const window = new Window({ url: "https://sundartha.test/" });
  window.document.body.innerHTML = `<article class="scene"><div class="vslot"><video muted></video></div></article>`;
  assert.doesNotThrow(() => wireProof(window.document, false));
});

test("Szene III: die Seite zeigt drei Status als Beispiel, auf Englisch und Deutsch", () => {
  const rows = proofRows();
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Request", "Confirmed", "Call"],
  );
  assert.deepEqual(
    rows.map((row) => HOME_GERMAN[row.key]),
    ["Auftrag", "Bestätigt", "Anruf"],
  );
  assert.match(PAGE, /class="vproof-eg" data-i18n="example">Example</);
  assert.equal(HOME_GERMAN.example, "Beispiel");
});

test("Szene III: bestätigt steht nach dem Auftrag und vor dem ersten Satz von Hermes", () => {
  const [request, confirmed, call] = proofRows().map((row) => row.at);
  assert.ok(request < confirmed, "Auftrag und Bestätigung fallen zusammen");
  assert.ok(confirmed < call, "Bestätigung und Anruf fallen zusammen");
  for (const vtt of CUES) {
    assert.ok(confirmed < firstHermesCue(vtt), "Hermes spricht, bevor die Bestätigung erscheint");
  }
});

test("Szene IV: kein Tipp-Versprechen ohne Interaktion", () => {
  assert.doesNotMatch(PAGE, /Tap any call/);
  assert.doesNotMatch(Object.values(HOME_GERMAN).join(" "), /Tipp auf einen Anruf/);
  assert.match(PAGE, /noteKey: "uc4s2n", note: "Your call summaries, at a glance\."/);
  assert.equal(HOME_GERMAN.uc4s2n, "Deine Anrufe auf einen Blick.");
});

test("Szene IV: das Dashboard trägt die Beispiel-Kennzeichnung im sichtbaren Kopf", () => {
  const head = PAGE.match(/<div class="dhead">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(head, /data-i18n="example">Example</);
});

function failingScene(networkState) {
  const html = sceneWithProof().replace("<video data-clip=\"uc3\" muted></video>", "<video data-clip=\"uc3\" muted><source src=\"/a/uc3.mp4\"></video>");
  const view = page(html);
  const video = view.proof.ownerDocument.querySelector("video");
  Object.defineProperty(video, "networkState", { get: () => networkState });
  const fail = (target) => target.dispatchEvent(new video.ownerDocument.defaultView.Event("error"));
  return { ...view, video, fail, source: video.querySelector("source") };
}

test("Szene III: meldet der Film einen Fehler, bleibt der ganze Ablauf stehen, auch nach dem zweiten Versuch", () => {
  const { playTo, reached, video, fail } = failingScene(LOADING);
  playTo(AFTER_CONFIRMED);
  assert.deepEqual(reached(), [true, true, false]);
  fail(video);
  assert.deepEqual(reached(), [true, true, true], "im Fehlerzustand ist der Ablauf nicht festgehalten");
  playTo(BEFORE_CONFIRMED);
  assert.deepEqual(reached(), [true, true, true], "nach dem zweiten Versuch fällt ein Status zurück");
});

test("Szene III: lädt keine Quelle des Films, bleibt der ganze Ablauf nach dem zweiten Versuch stehen", () => {
  const { playTo, reached, source, fail } = failingScene(NO_SOURCE);
  fail(source);
  playTo(BEFORE_CONFIRMED);
  assert.deepEqual(reached(), [true, true, true]);
});

test("Szene III: scheitert nur eine Quelle und der Film lädt weiter, läuft der Ablauf normal an", () => {
  const { playTo, reached, source, fail } = failingScene(LOADING);
  fail(source);
  playTo(BEFORE_CONFIRMED);
  assert.deepEqual(reached(), [true, false, false]);
});
