import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { FAKE_FIRST_CHUNK, FAKE_REST_CHUNK } from "../helpers/fake-tts-stream.mjs";
import { startServer, seedWithTelnyxNumber, postTelnyxIncoming, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { playTtsEnv } from "../gemeinsam/play-tts-server.mjs";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 503;
const DETAIL_GRENZE = 300;
const ERSTES_PAKET_FRIST_MS = "500";
const AUSGABEFORMAT = "mp3_22050_32";
const FAKE_MP3 = Buffer.concat([Buffer.from(FAKE_FIRST_CHUNK), Buffer.from(FAKE_REST_CHUNK)]);
const TOKEN_IM_PLAY = /<Play>https:\/\/[^<]*\/voice\/tts\/([^<]+)<\/Play>/;

async function startOrigin(antworte) {
  const aufrufe = [];
  const haengende = new Set();
  const server = http.createServer((req, res) => {
    const teile = [];
    req.on("data", (teil) => teile.push(teil));
    req.on("end", () => {
      aufrufe.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(Buffer.concat(teile).toString("utf8")),
      });
      haengende.add(res);
      antworte(res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    aufrufe,
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const res of haengende) res.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function mitSynthese({ antworte, env = {} }, lauf) {
  const origin = await startOrigin(antworte);
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: { ...playTtsEnv(origin.url), ...env },
  });
  try {
    return await lauf(srv, origin);
  } finally {
    await srv.stop();
    await origin.close();
  }
}

const vollstaendig = (contentType) => (res) => {
  if (contentType) res.setHeader("content-type", contentType);
  res.write(Buffer.from(FAKE_FIRST_CHUNK));
  res.end(Buffer.from(FAKE_REST_CHUNK));
};

async function eingang(srv) {
  const res = await postTelnyxIncoming(srv, { callSid: "CAttsverhalten" });
  assert.equal(res.status, HTTP_OK);
  return res.text();
}

test("Anfrage an ElevenLabs: POST auf den Stream-Pfad der Stimme mit Schluessel, JSON, Ausgabeformat, Modell und gesprochenem Text", async () => {
  await mitSynthese(
    { antworte: vollstaendig("audio/mpeg"), env: { ELEVENLABS_OUTPUT_FORMAT: AUSGABEFORMAT } },
    async (srv, origin) => {
      await eingang(srv);
      assert.equal(origin.aufrufe.length, 1);
      const [aufruf] = origin.aufrufe;
      assert.equal(aufruf.method, "POST");
      assert.match(aufruf.url, new RegExp(`^/v1/text-to-speech/[A-Za-z0-9]+/stream\\?output_format=${AUSGABEFORMAT}$`));
      assert.equal(aufruf.headers["xi-api-key"], "test-elevenlabs-key");
      assert.equal(aufruf.headers["content-type"], "application/json");
      assert.equal(aufruf.headers.accept, "audio/mpeg");
      assert.deepEqual(Object.keys(aufruf.body).sort(), ["model_id", "text"]);
      assert.equal(aufruf.body.model_id, "eleven_v4_turbo");
      assert.ok(aufruf.body.text.length > 0);
    },
  );
});

test("Abruf der Play-URL: alle Bytes mit dem Inhaltstyp des Anbieters, ein zweiter Abruf und ein fremdes Token sind 404", async () => {
  await mitSynthese({ antworte: vollstaendig("audio/ogg") }, async (srv) => {
    const texml = await eingang(srv);
    const token = TOKEN_IM_PLAY.exec(texml)?.[1];
    assert.ok(token, `Play-URL mit Token erwartet: ${texml}`);
    const erster = await abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);
    assert.equal(erster.status, HTTP_OK);
    assert.match(erster.headers.get("content-type"), /^audio\/ogg/);
    assert.deepEqual(Buffer.from(await erster.arrayBuffer()), FAKE_MP3);
    const zweiter = await abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);
    assert.equal(zweiter.status, HTTP_NOT_FOUND);
    const fremd = await abrufMitFrist(`${srv.localUrl}/voice/tts/${token}x`);
    assert.equal(fremd.status, HTTP_NOT_FOUND);
  });
});

test("Antwortet der Anbieter ohne Inhaltstyp, wird audio/mpeg ausgeliefert", async () => {
  await mitSynthese({ antworte: vollstaendig(null) }, async (srv) => {
    const token = TOKEN_IM_PLAY.exec(await eingang(srv))?.[1];
    assert.ok(token);
    const res = await abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);
    assert.match(res.headers.get("content-type"), /^audio\/mpeg/);
  });
});

test("Anbieter-Fehler: kein Play, Azure-Say bleibt, die Logzeile nennt Status und hoechstens 300 Zeichen Detail", async () => {
  const lang = "a".repeat(DETAIL_GRENZE) + "RESTLICH";
  const antworte = (res) => {
    res.writeHead(HTTP_SERVER_ERROR);
    res.end(lang);
  };
  await mitSynthese({ antworte }, async (srv) => {
    const texml = await eingang(srv);
    assert.ok(!texml.includes("<Play>"));
    assert.match(texml, /<Say /);
    await waitForLog(srv, /\[play-tts\] Synth fehlgeschlagen \(http_503: a+\) -> Azure-Fallback/);
    assert.ok(srv.stdout.includes(`http_503: ${"a".repeat(DETAIL_GRENZE)})`));
    assert.ok(!srv.stdout.includes("RESTLICH"));
  });
});

test("Anbieter-Fehler ohne Text: die Logzeile hat keinen Doppelpunkt-Zusatz", async () => {
  const antworte = (res) => {
    res.writeHead(HTTP_SERVER_ERROR);
    res.end();
  };
  await mitSynthese({ antworte }, async (srv) => {
    await eingang(srv);
    await waitForLog(srv, /\[play-tts\] Synth fehlgeschlagen \(http_503\) -> Azure-Fallback/);
  });
});

test("Leerer Strom: kein Play, Logzeile empty_stream", async () => {
  await mitSynthese({ antworte: (res) => res.end() }, async (srv) => {
    const texml = await eingang(srv);
    assert.ok(!texml.includes("<Play>"));
    await waitForLog(srv, /\[play-tts\] Synth fehlgeschlagen \(empty_stream\) -> Azure-Fallback/);
  });
});

test("Anbieter antwortet nicht rechtzeitig mit dem ersten Paket: kein Play, Logzeile timeout", async () => {
  await mitSynthese(
    { antworte: () => {}, env: { ELEVENLABS_SYNTH_TIMEOUT_MS: ERSTES_PAKET_FRIST_MS } },
    async (srv) => {
      const texml = await eingang(srv);
      assert.ok(!texml.includes("<Play>"));
      await waitForLog(srv, /\[play-tts\] Synth fehlgeschlagen \(timeout\) -> Azure-Fallback/);
    },
  );
});

test("Anbieter nicht erreichbar: kein Play, Logzeile error", async () => {
  const srv = await startServer({
    seed: seedWithTelnyxNumber({ language: "de" }),
    env: playTtsEnv("http://127.0.0.1:1"),
  });
  try {
    const texml = await eingang(srv);
    assert.ok(!texml.includes("<Play>"));
    await waitForLog(srv, /\[play-tts\] Synth fehlgeschlagen \(error\) -> Azure-Fallback/);
  } finally {
    await srv.stop();
  }
});

test("Strom reisst nach dem ersten Paket ab: der Abruf liefert das erste Paket, die Logzeile sagt abgebrochen", async () => {
  const antworte = (res) => {
    res.setHeader("content-type", "audio/mpeg");
    res.write(Buffer.from(FAKE_FIRST_CHUNK));
    setImmediate(() => res.destroy());
  };
  await mitSynthese({ antworte }, async (srv) => {
    const token = TOKEN_IM_PLAY.exec(await eingang(srv))?.[1];
    assert.ok(token);
    const res = await abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);
    assert.equal(res.status, HTTP_OK);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(FAKE_FIRST_CHUNK));
    await waitForLog(srv, /\[play-tts\] Synthese abgebrochen \(erstes Audio \d+ ms, Gesamt \d+ ms\)/);
  });
});

test("Vollstaendiger Strom: die Logzeile sagt vollstaendig", async () => {
  await mitSynthese({ antworte: vollstaendig("audio/mpeg") }, async (srv) => {
    await eingang(srv);
    await waitForLog(srv, /\[play-tts\] Synthese vollstaendig \(erstes Audio \d+ ms, Gesamt \d+ ms\)/);
  });
});
