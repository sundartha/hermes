import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";
import { wireSound } from "../src/scripts/home-sound.js";
import { VOICE_LANGS, VOICE_ROLES, VOICE_SCRIPT, clipDuration, voiceFilesFor } from "../src/lib/home-voice.js";
import { KEY_HINT, VoiceError, captionsVtt, fitLine, mixGraph, readKey, run } from "../scripts/home-voice.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = join(WEB_ROOT, "public/assets/home");
const CLIPS = Object.keys(VOICE_SCRIPT);
const START = { first: 2, second: 3 };
const SPOKEN = { fits: 1.5, tight: 2.1, tooLong: 2.4 };
const MIX = { duration: 80 };
const CODEC = /codecs="(\w{4})/;

function scene(clip, germanCut) {
  const de = germanCut ? ` data-src-de="/a/${clip}-de.mp4"` : "";
  return `<article class="scene"><div class="vslot">
    <span class="label">I · Scene ${clip}</span>
    <video data-clip="${clip}" muted><source src="/a/${clip}.mp4"${de}></video>
    <button type="button" class="vsound" aria-pressed="false" data-voice-en="/a/${clip}-en.m4a" data-voice-de="/a/${clip}-de.m4a" hidden><span class="vsound-l">Sound</span></button>
  </div></article>`;
}

function fakeMedia(element, start) {
  const media = { paused: true, time: start, loads: 0, tracks: [{ language: "en", mode: "disabled" }, { language: "de", mode: "disabled" }] };
  const fire = (type) => element.dispatchEvent(new element.ownerDocument.defaultView.Event(type));
  Object.defineProperties(element, {
    paused: { get: () => media.paused },
    currentTime: {
      get: () => media.time,
      set: (value) => {
        media.time = value;
      },
    },
    textTracks: { get: () => media.tracks },
    play: {
      value: () => {
        media.paused = false;
        fire("play");
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        media.paused = true;
        fire("pause");
      },
    },
    load: {
      value: () => {
        media.loads += 1;
      },
    },
  });
  return media;
}

function fakeAudio() {
  const audio = { paused: true, currentTime: 0, src: "", dataset: {}, plays: 0 };
  audio.play = () => {
    audio.paused = false;
    audio.plays += 1;
    return Promise.resolve();
  };
  audio.pause = () => {
    audio.paused = true;
  };
  return audio;
}

function page(clips) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = "en";
  document.body.innerHTML = clips.map((clip) => scene(clip, clip === "uc2")).join("");
  const audio = fakeAudio();
  const created = [];
  const videos = Array.from(document.querySelectorAll("video"));
  const media = videos.map((video, index) => fakeMedia(video, index + START.first));
  wireSound(document, () => {
    created.push(audio);
    return audio;
  });
  return { window, document, audio, created, videos, media, buttons: Array.from(document.querySelectorAll(".vsound")) };
}

const modes = (media) => media.tracks.map((track) => track.mode);

test("Ton-Schalter: beim Laden ist nichts hörbar, Videos bleiben stumm und kein Audio läuft", () => {
  const { audio, buttons, videos } = page(["uc1", "uc2"]);
  assert.equal(audio.plays, 0);
  assert.equal(audio.src, "");
  assert.ok(videos.every((video) => video.muted));
  assert.deepEqual(
    buttons.map((button) => [button.hidden, button.getAttribute("aria-pressed")]),
    [
      [false, "false"],
      [false, "false"],
    ],
  );
  assert.equal(buttons[0].getAttribute("aria-label"), "Sound: Scene uc1");
});

test("Ton-Schalter: Klick schaltet die Spur der Seitensprache an der Videoposition ein und zeigt Untertitel", () => {
  const { audio, buttons, media } = page(["uc1", "uc2"]);
  buttons[0].click();
  assert.equal(audio.src, "/a/uc1-en.m4a");
  assert.equal(audio.paused, false);
  assert.equal(audio.currentTime, START.first);
  assert.equal(media[0].paused, false);
  assert.deepEqual(
    buttons.map((button) => button.getAttribute("aria-pressed")),
    ["true", "true"],
  );
  assert.deepEqual(modes(media[0]), ["showing", "disabled"]);
});

test("Ton-Schalter: zweiter Klick schaltet aus, Untertitel verschwinden", () => {
  const { audio, buttons, media } = page(["uc1"]);
  buttons[0].click();
  buttons[0].click();
  assert.equal(audio.paused, true);
  assert.equal(buttons[0].getAttribute("aria-pressed"), "false");
  assert.deepEqual(modes(media[0]), ["disabled", "disabled"]);
});

test("Ton-Schalter: Szenenwechsel lässt nie zwei Spuren laufen, die neue Szene übernimmt", () => {
  const { audio, buttons, videos, media, created } = page(["uc1", "uc2"]);
  buttons[0].click();
  videos[0].pause();
  assert.equal(audio.paused, true);
  videos[1].play();
  assert.equal(created.length, 1);
  assert.equal(audio.src, "/a/uc2-en.m4a");
  assert.equal(audio.currentTime, START.second);
  assert.equal(audio.paused, false);
  assert.deepEqual(modes(media[0]), ["disabled", "disabled"]);
  assert.deepEqual(modes(media[1]), ["showing", "disabled"]);
});

test("Ton-Schalter: Sprachwechsel wechselt Spur, Untertitel, Beschriftung und das deutsche UC2-Video", async () => {
  const { window, document, audio, buttons, videos, media } = page(["uc1", "uc2"]);
  buttons[1].click();
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  assert.equal(audio.src, "/a/uc2-de.m4a");
  assert.deepEqual(modes(media[1]), ["disabled", "showing"]);
  assert.equal(buttons[1].getAttribute("aria-label"), "Ton: Scene uc2");
  assert.equal(buttons[1].querySelector(".vsound-l").textContent, "Ton");
  assert.equal(videos[1].querySelector("source").getAttribute("src"), "/a/uc2-de.mp4");
  assert.equal(media[1].loads, 1);
  assert.equal(videos[0].querySelector("source").getAttribute("src"), "/a/uc1.mp4");
  assert.equal(media[0].loads, 0);
});

test("Ton-Schalter: pausiertes Video hält auch die Spur an, auch bei eingeschaltetem Ton", () => {
  const { window, audio, buttons, videos } = page(["uc1"]);
  buttons[0].click();
  videos[0].pause();
  videos[0].dispatchEvent(new window.Event("timeupdate"));
  assert.equal(audio.paused, true);
});

test("Ton-Schalter: ohne Schalter im Markup entsteht kein Audio-Element", () => {
  const window = new Window({ url: "https://sundartha.test/" });
  window.document.body.innerHTML = '<div class="vslot"><video data-clip="uc1"></video></div>';
  const created = [];
  wireSound(window.document, () => {
    created.push(1);
    return {};
  });
  assert.equal(created.length, 0);
});

test("Sprechertext: jede Zeile liegt im Video, überlappt nicht und nutzt eine bekannte Stimme, in beiden Sprachen gleich getaktet", () => {
  const shape = (lines) => lines.map((line) => [line.at, line.until, line.who, line.line]);
  for (const clip of CLIPS) {
    const [first, ...others] = VOICE_LANGS.map((lang) => VOICE_SCRIPT[clip][lang]);
    let previous = 0;
    for (const line of first) {
      assert.ok(line.at >= previous && line.until > line.at && line.until <= clipDuration(clip), `${clip} ${line.at}`);
      assert.ok(VOICE_ROLES[line.who], `${clip} ${line.who}`);
      previous = line.until;
    }
    for (const other of others) assert.deepEqual(shape(other), shape(first));
  }
});

test("Pipeline: Zeile passt, wird höchstens leicht beschleunigt oder gilt als zu lang", () => {
  const line = { at: 2, until: 4 };
  assert.deepEqual(fitLine(line, SPOKEN.fits), { tempo: 1, end: 3.5 });
  assert.deepEqual(fitLine(line, SPOKEN.tight), { tempo: 1.05, end: 4 });
  assert.equal(fitLine(line, SPOKEN.tooLong), null);
});

test("Pipeline: Untertitel tragen Zeiten und Sprecher, Telefonklang nur für Zeilen am Telefon", () => {
  const lines = [
    { at: 5, until: 7.5, end: 7.25, who: "hermes", text: "Hermes here.", line: true, tempo: 1 },
    { at: 65.5, until: 70, who: "anna", text: "Berger & Co.", line: false, tempo: 1.05 },
  ];
  assert.equal(
    captionsVtt(lines, "en"),
    "WEBVTT\n\n00:00:05.000 --> 00:00:07.250 line:8%\n<v Hermes>Hermes here.\n\n00:01:05.500 --> 00:01:10.000 line:8%\n<v Anna>Berger &amp; Co.\n",
  );
  const [phone, plain, mix] = mixGraph(lines, MIX.duration).split(";");
  assert.match(phone, /^\[0:a\]highpass=f=300,lowpass=f=3400,.*adelay=5000:all=1\[l0\]$/);
  assert.equal(plain, "[1:a]atempo=1.050,adelay=65500:all=1[l1]");
  assert.match(mix, /^\[l0\]\[l1\]amix=inputs=2:normalize=0,apad,atrim=0:80,loudnorm/);
});

test("Pipeline: ohne Schlüssel bricht der Lauf ab, bevor irgendetwas geschrieben oder gesendet wird", async () => {
  await assert.rejects(readKey({ isTTY: true }), { message: KEY_HINT });
  await assert.rejects(run([], (async function* empty() {})(), () => {}), VoiceError);
  assert.deepEqual(await run(["--dry"], { isTTY: true }, () => {}), []);
});

test("Gebaute Startseite: AV1 vor H.264, Dateien vorhanden, Ton-Schalter und Untertitel genau dann, wenn die Sprachspuren im Ordner liegen", () => {
  const { workDir, distDir } = buildSite(".home-sound-", "dist");
  try {
    const window = new Window();
    window.document.write(readFileSync(join(distDir, "index.html"), "utf8"));
    const videos = Array.from(window.document.querySelectorAll("video[data-clip]"));
    assert.deepEqual(
      videos.map((video) => video.dataset.clip),
      CLIPS,
    );
    for (const video of videos) {
      const clip = video.dataset.clip;
      const sources = Array.from(video.querySelectorAll("source"));
      assert.deepEqual(
        sources.map((source) => CODEC.exec(source.getAttribute("type"))[1]),
        ["av01", "avc1"],
      );
      const files = sources.flatMap((source) => [source.getAttribute("src"), source.dataset.srcDe]).filter(Boolean);
      for (const file of [...files, video.getAttribute("poster")]) assert.ok(existsSync(join(distDir, file)), file);
      assert.ok(video.hasAttribute("muted") && !video.hasAttribute("src"));
      const voiced = voiceFilesFor(clip).every((file) => existsSync(join(ASSETS, file)));
      const button = video.parentElement.querySelector(".vsound");
      assert.equal(Boolean(button), voiced, `${clip}: Ton-Schalter`);
      assert.equal(video.querySelectorAll('track[kind="captions"]').length, voiced ? VOICE_LANGS.length : 0);
      if (button) {
        assert.ok(button.hidden);
        assert.ok(existsSync(join(distDir, button.dataset.voiceEn)) && existsSync(join(distDir, button.dataset.voiceDe)));
      }
    }
    assert.equal(window.document.querySelectorAll("audio").length, 0);
  } finally {
    removeBuild(workDir);
  }
});
