import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { buildSite, removeBuild } from "./gebaute-seite.js";
import { wireSound } from "../src/scripts/home-sound.js";
import { VIDEO_WIDE_SUFFIX, VOICE_LANGS, VOICE_ROLES, VOICE_SCRIPT, VOICE_SPEAKERS, clipDuration, voiceFilesFor, voiceVideoFiles } from "../src/lib/home-voice.js";
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
      configurable: true,
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

test("Ton-Schalter: nie zwei Szenen hörbar; beim Szenenwechsel wandert der Ton zur neuen Szene", () => {
  const { buttons, videos, media } = page(["uc1", "uc2"]);
  buttons[0].click();
  videos[1].play();
  assert.deepEqual(muted(media), [true, false]);
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
        ["av01", "avc1", "av01", "avc1"],
      );
      const wide = sources.slice(0, SOURCES_PER_SIZE);
      for (const source of wide) {
        assert.ok(source.getAttribute("src").includes(`${VIDEO_WIDE_SUFFIX}.`), `${clip}: 1080p-Quelle zuerst`);
        assert.match(source.getAttribute("media"), /min-width: 1001px/);
      }
      for (const source of sources.slice(SOURCES_PER_SIZE)) assert.ok(!source.hasAttribute("media"), `${clip}: 720p ohne media als Rückfall`);
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

const SOURCES_PER_SIZE = 2;
const SMALL = { width: 1280, height: 720 };
const WIDE = { width: 1920, height: 1080 };
const FRAMES_PER_SECOND = 24;
const FRAME_SECONDS = 1 / FRAMES_PER_SECOND;
const BOX = { header: 8, typeOffset: 4 };
const TKHD = { widthFromEnd: 8, heightFromEnd: 4, fixedPointShift: 16 };
const HDLR = { kindStart: 8, kindEnd: 12 };
const MDHD = { longVersion: 1, scaleShort: 12, scaleLong: 20, lengthShort: 16, lengthLong: 24 };

function mp4Boxes(data, start, end) {
  const found = [];
  for (let at = start; at + BOX.header <= end; ) {
    const size = data.readUInt32BE(at);
    if (size < BOX.header) break;
    found.push({ type: data.toString("latin1", at + BOX.typeOffset, at + BOX.header), start: at + BOX.header, end: at + size });
    at += size;
  }
  return found;
}

function mp4Track(data, trak) {
  const child = (box, type) => mp4Boxes(data, box.start, box.end).find((inner) => inner.type === type);
  const tkhd = child(trak, "tkhd");
  const mdia = child(trak, "mdia");
  const mdhd = child(mdia, "mdhd");
  const hdlr = child(mdia, "hdlr");
  const long = data[mdhd.start] === MDHD.longVersion;
  const scale = data.readUInt32BE(mdhd.start + (long ? MDHD.scaleLong : MDHD.scaleShort));
  const length = long ? Number(data.readBigUInt64BE(mdhd.start + MDHD.lengthLong)) : data.readUInt32BE(mdhd.start + MDHD.lengthShort);
  return {
    kind: data.toString("latin1", hdlr.start + HDLR.kindStart, hdlr.start + HDLR.kindEnd),
    width: data.readUInt32BE(tkhd.end - TKHD.widthFromEnd) >>> TKHD.fixedPointShift,
    height: data.readUInt32BE(tkhd.end - TKHD.heightFromEnd) >>> TKHD.fixedPointShift,
    seconds: length / scale,
  };
}

function mp4Tracks(file) {
  const data = readFileSync(file);
  const moov = mp4Boxes(data, 0, data.length).find((box) => box.type === "moov");
  return mp4Boxes(data, moov.start, moov.end)
    .filter((box) => box.type === "trak")
    .map((trak) => mp4Track(data, trak));
}

const trackOf = (tracks, kind) => tracks.find((track) => track.kind === kind);

test("Videodateien: Desktop-Fassung in 1920×1080, mobil 1280×720, beide mit Tonspur und gleicher Länge", () => {
  for (const clip of CLIPS) {
    const files = voiceVideoFiles(clip).filter((file) => existsSync(join(ASSETS, file)));
    const wides = files.filter((file) => file.includes(VIDEO_WIDE_SUFFIX));
    for (const needed of [`${clip}${VIDEO_WIDE_SUFFIX}.av1.mp4`, `${clip}${VIDEO_WIDE_SUFFIX}.mp4`]) assert.ok(wides.includes(needed), `${needed} fehlt`);
    for (const wide of wides) {
      const file = wide.replace(VIDEO_WIDE_SUFFIX, "");
      assert.ok(files.includes(file), `${file} fehlt`);
      const small = mp4Tracks(join(ASSETS, file));
      const large = mp4Tracks(join(ASSETS, wide));
      const { width: smallWidth, height: smallHeight } = trackOf(small, "vide");
      const { width: largeWidth, height: largeHeight } = trackOf(large, "vide");
      assert.deepEqual({ width: smallWidth, height: smallHeight }, SMALL, file);
      assert.deepEqual({ width: largeWidth, height: largeHeight }, WIDE, wide);
      assert.ok(trackOf(small, "soun") && trackOf(large, "soun"), `${clip}: Tonspur in beiden Fassungen`);
      assert.ok(Math.abs(trackOf(small, "vide").seconds - trackOf(large, "vide").seconds) < FRAME_SECONDS, `${wide}: gleiche Bildlänge`);
      assert.ok(Math.abs(trackOf(small, "soun").seconds - trackOf(large, "soun").seconds) < FRAME_SECONDS, `${wide}: gleiche Tonlänge`);
    }
  }
});

function gesture(window, target) {
  target.dispatchEvent(new window.Event("click", { bubbles: true }));
}

test("Ton nach der ersten Geste: die laufende Szene wird hörbar, alle anderen bleiben stumm", () => {
  const { window, document, videos, media, buttons } = page(["uc1", "uc2"]);
  videos[0].play();
  assert.deepEqual(muted(media), [true, true]);
  gesture(window, document.body);
  assert.deepEqual(muted(media), [false, true]);
  assert.deepEqual(pressed(buttons), ["true", "false"]);
  videos[1].play();
  assert.deepEqual(muted(media), [true, false]);
});

test("Ton nach der ersten Geste: einmal per Knopf ausgeschaltet, bleibt er aus", () => {
  const { window, document, videos, media, buttons } = page(["uc1", "uc2"]);
  videos[0].play();
  gesture(window, document.body);
  buttons[0].click();
  assert.deepEqual(muted(media), [true, true]);
  videos[1].play();
  gesture(window, document.body);
  assert.deepEqual(muted(media), [true, true]);
});

test("Ton nach der ersten Geste: Wischen allein schaltet nicht laut (iOS wuerde das Video anhalten)", () => {
  const { window, document, videos, media } = page(["uc1"]);
  videos[0].play();
  document.body.dispatchEvent(new window.Event("touchend", { bubbles: true }));
  document.body.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
  assert.deepEqual(muted(media), [true]);
});

test("Ton nach der ersten Geste: ein Tipp auf den Ton-Knopf schaltet genau einmal um", () => {
  const { videos, media, buttons } = page(["uc1"]);
  videos[0].play();
  buttons[0].click();
  assert.deepEqual(muted(media), [false]);
  assert.deepEqual(pressed(buttons), ["true"]);
});

function blockUnmuteOnce(video) {
  let blocked = true;
  const descriptor = Object.getOwnPropertyDescriptor(video, "muted");
  Object.defineProperty(video, "muted", {
    get: descriptor.get,
    set: (value) => {
      descriptor.set(value);
      if (!value && blocked && !video.paused) {
        blocked = false;
        video.pause();
      }
    },
  });
}

test("Ton blockiert (iOS hält beim Lautschalten an): Video läuft stumm weiter, neuer Versuch erst bei der nächsten Geste", () => {
  const { window, document, videos, media, buttons } = page(["uc1", "uc2"]);
  videos[0].play();
  blockUnmuteOnce(videos[0]);
  gesture(window, document.body);
  assert.equal(media[0].paused, false);
  assert.deepEqual(muted(media), [true, true]);
  videos[0].pause();
  videos[1].play();
  assert.deepEqual(muted(media), [true, true]);
  gesture(window, document.body);
  assert.deepEqual(muted(media), [true, false]);
  assert.deepEqual(pressed(buttons), ["false", "true"]);
});

