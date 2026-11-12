import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";
import { wireSound } from "../src/scripts/home-sound.js";
import { VOICE_LANGS, VOICE_ROLES, VOICE_SCRIPT, VOICE_SPEAKERS, clipDuration, voiceFilesFor } from "../src/lib/home-voice.js";
import { KEY_HINT, VoiceError, captionsVtt, fitLine, mixGraph, readKey, run } from "../scripts/home-voice.js";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ASSETS = join(WEB_ROOT, "public/assets/home");
const CLIPS = Object.keys(VOICE_SCRIPT);
const SPOKEN = { fits: 1.5, tight: 2.1, tooLong: 2.4 };
const MIX = { duration: 80 };
const CODEC = /codecs="(\w{4})/;

function scene(clip, germanCut) {
  const de = germanCut ? ` data-src-de="/a/${clip}-de.mp4"` : "";
  return `<article class="scene"><div class="vslot">
    <span class="label">I · Scene ${clip}</span>
    <video data-clip="${clip}" muted><source src="/a/${clip}.mp4"${de}></video>
    <button type="button" class="vsound" aria-pressed="false" hidden><span class="vsound-l">Sound</span></button>
  </div></article>`;
}

function fakeMedia(element) {
  const media = { paused: true, muted: true, loads: 0, tracks: [{ language: "en", mode: "disabled" }] };
  const fire = (type) => element.dispatchEvent(new element.ownerDocument.defaultView.Event(type));
  Object.defineProperties(element, {
    paused: { get: () => media.paused },
    muted: {
      get: () => media.muted,
      set: (value) => {
        media.muted = value;
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

function page(clips) {
  const window = new Window({ url: "https://sundartha.test/" });
  const { document } = window;
  document.documentElement.lang = "en";
  document.body.innerHTML = clips.map((clip) => scene(clip, clip === "uc2")).join("");
  const videos = Array.from(document.querySelectorAll("video"));
  const media = videos.map((video) => fakeMedia(video));
  wireSound(document);
  return { window, document, videos, media, buttons: Array.from(document.querySelectorAll(".vsound")) };
}

const modes = (media) => media.tracks.map((track) => track.mode);
const pressed = (buttons) => buttons.map((button) => button.getAttribute("aria-pressed"));
const muted = (media) => media.map((entry) => entry.muted);

test("Ton-Schalter: beim Laden ist nichts hörbar, alle Videos stumm, Schalter sichtbar und aus", () => {
  const { buttons, media } = page(["uc1", "uc2"]);
  assert.deepEqual(muted(media), [true, true]);
  assert.deepEqual(pressed(buttons), ["false", "false"]);
  assert.deepEqual(
    buttons.map((button) => button.hidden),
    [false, false],
  );
  assert.equal(buttons[0].getAttribute("aria-label"), "Sound: Scene uc1");
});

test("Ton-Schalter: Klick macht genau dieses Video hörbar und startet es, ohne Untertitel einzublenden", () => {
  const { buttons, media } = page(["uc1", "uc2"]);
  buttons[0].click();
  assert.deepEqual(muted(media), [false, true]);
  assert.equal(media[0].paused, false);
  assert.deepEqual(pressed(buttons), ["true", "false"]);
  assert.deepEqual(modes(media[0]), ["disabled"]);
});

test("Ton-Schalter: zweiter Klick schaltet aus, Untertitel bleiben aus", () => {
  const { buttons, media } = page(["uc1"]);
  buttons[0].click();
  buttons[0].click();
  assert.deepEqual(muted(media), [true]);
  assert.deepEqual(pressed(buttons), ["false"]);
  assert.deepEqual(modes(media[0]), ["disabled"]);
});

test("Ton-Schalter: nie zwei Szenen hörbar, weder beim Szenenwechsel noch beim Klick auf eine andere Szene", () => {
  const { buttons, videos, media } = page(["uc1", "uc2"]);
  buttons[0].click();
  videos[1].play();
  assert.deepEqual(muted(media), [true, true]);
  buttons[1].click();
  buttons[0].click();
  assert.deepEqual(muted(media), [false, true]);
  assert.deepEqual(pressed(buttons), ["true", "false"]);
});

test("Ton-Schalter: verlässt die Szene das Bild, ist ihr Ton aus; eine Pause durch den Nutzer behält ihn", () => {
  const { buttons, videos, media } = page(["uc1"]);
  buttons[0].click();
  videos[0].dataset.userPaused = "1";
  videos[0].pause();
  assert.deepEqual(muted(media), [false]);
  delete videos[0].dataset.userPaused;
  videos[0].play();
  videos[0].pause();
  assert.deepEqual(muted(media), [true]);
  assert.deepEqual(pressed(buttons), ["false"]);
});

test("Ton-Schalter: Sprachwechsel ändert Beschriftung und das deutsche UC2-Video, Untertitel bleiben aus", async () => {
  const { window, document, buttons, videos, media } = page(["uc1", "uc2"]);
  buttons[0].click();
  document.documentElement.lang = "de";
  await window.happyDOM.waitUntilComplete();
  assert.equal(buttons[0].getAttribute("aria-label"), "Ton: Scene uc1");
  assert.equal(buttons[0].querySelector(".vsound-l").textContent, "Ton");
  assert.deepEqual(modes(media[0]), ["disabled"]);
  assert.equal(videos[1].querySelector("source").getAttribute("src"), "/a/uc2-de.mp4");
  assert.equal(media[1].loads, 1);
  assert.equal(videos[0].querySelector("source").getAttribute("src"), "/a/uc1.mp4");
  assert.equal(media[0].loads, 0);
});

test("Sprechertext: jede Zeile liegt im Video und überlappt nicht; gefilmte Zeilen brauchen keine Stimme, alle anderen eine bekannte", () => {
  for (const clip of CLIPS) {
    for (const lang of VOICE_LANGS) {
      let previous = 0;
      for (const line of VOICE_SCRIPT[clip][lang]) {
        assert.ok(line.at >= previous && line.until > line.at && line.until <= clipDuration(clip), `${clip} ${line.at}`);
        assert.ok(VOICE_SPEAKERS[lang][line.who], `${clip} ${line.who}`);
        assert.equal(Boolean(VOICE_ROLES[line.who]), !line.filmed, `${clip} ${line.who}`);
        previous = line.until;
      }
    }
  }
});

test("Pipeline: Zeile passt, wird höchstens leicht beschleunigt oder gilt als zu lang", () => {
  const line = { at: 2, until: 4 };
  assert.deepEqual(fitLine(line, SPOKEN.fits), { tempo: 1, end: 3.5 });
  assert.deepEqual(fitLine(line, SPOKEN.tight), { tempo: 1.05, end: 4 });
  assert.equal(fitLine(line, SPOKEN.tooLong), null);
});

test("Pipeline: Untertitel tragen Zeiten und Sprecher; der Originalton ist die Basis, Telefonklang nur für Zeilen am Telefon", () => {
  const lines = [
    { at: 5, until: 7.5, end: 7.25, who: "hermes", text: "Hermes here.", line: true, tempo: 1 },
    { at: 65.5, until: 70, who: "anna", text: "Berger & Co.", line: false, tempo: 1.05 },
  ];
  assert.equal(
    captionsVtt(lines, "en"),
    "WEBVTT\n\n00:00:05.000 --> 00:00:07.250 line:8%\n<v Hermes>Hermes here.\n\n00:01:05.500 --> 00:01:10.000 line:8%\n<v Anna>Berger &amp; Co.\n",
  );
  const [bed, phone, plain, mix] = mixGraph(lines, MIX.duration).split(";");
  assert.match(bed, /^\[0:a\].*\[bed\]$/);
  assert.match(phone, /^\[1:a\]highpass=f=300,lowpass=f=3400,.*adelay=5000:all=1\[l0\]$/);
  assert.equal(plain, "[2:a]atempo=1.050,adelay=65500:all=1[l1]");
  assert.match(mix, /^\[bed\]\[l0\]\[l1\]amix=inputs=3:normalize=0,apad=whole_dur=80,loudnorm/);
});

test("Pipeline: ohne Schlüssel bricht der Lauf ab, bevor irgendetwas geschrieben oder gesendet wird", async () => {
  await assert.rejects(readKey({ isTTY: true }), { message: KEY_HINT });
  await assert.rejects(readKey((async function* empty() {})()), VoiceError);
  await assert.rejects(readKey((async function* text() { yield Buffer.from("kein Schlüssel, nur Text aus der Zwischenablage"); })()), VoiceError);
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
      if (button) assert.ok(button.hidden);
    }
    assert.equal(window.document.querySelectorAll("audio").length, 0);
  } finally {
    removeBuild(workDir);
  }
});
