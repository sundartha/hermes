import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { mitZweiHermesAufPostgres, postgresVorhanden } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const MS_JE_S = 1000;
const TTL_TOLERANZ_S = 20;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);
const TYP = "audio/mpeg";
const VORSPANN_TTL_MS = 120_000;
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const ABLAGE_URL = new URL("../../src/tts/ablage-bis-freigabe.js", import.meta.url).href;
const TTS_STORE_URL = new URL("../../src/tts/store.ts", import.meta.url).href;

const KIND_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
const { createTtsStore } = await import(${JSON.stringify(TTS_STORE_URL)});
const { makeAblageBisFreigabe } = await import(${JSON.stringify(ABLAGE_URL)});
await speicher.oeffneSpeicher();
const ttsStore = createTtsStore({ ttlMs: 60000, ablage: speicher.ttsAblage, bisFreigabeAblage: makeAblageBisFreigabe(speicher.ttsAblage) });
const befehl = JSON.parse(process.argv[1]);
if (befehl.aktion === "ablegen") {
  const audio = { contentType: befehl.contentType, bytes: Promise.resolve(Buffer.from(befehl.base64, "base64")) };
  const token = await ttsStore.put(audio, { bisFreigabe: true, ttlMs: befehl.ttlMs });
  console.log("token " + token);
  process.stdin.once("data", () => process.exit(0));
} else {
  ttsStore.release(befehl.token);
  await new Promise((fertig) => setTimeout(fertig, 500));
  process.exit(0);
}
`;

function starteKind(db, befehl) {
  const kind = spawn(
    process.execPath,
    ["--input-type=module", "-e", KIND_SKRIPT, JSON.stringify({ base64: AUDIO.toString("base64"), contentType: TYP, ...befehl })],
    { env: { ...process.env, ...pgStartUmgebung(db.adresse) }, stdio: ["pipe", "pipe", "inherit"] },
  );
  let aus = "";
  const wartende = [];
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
    for (const warte of wartende.splice(0)) warte(aus);
  });
  const ende = new Promise((fertig) => kind.on("close", fertig));
  const tokenBereit = () =>
    new Promise((fertig) => {
      const pruefe = (text) => {
        const treffer = /token (\S+)/.exec(text);
        if (treffer) fertig(treffer[1]);
        else wartende.push(pruefe);
      };
      pruefe(aus);
    });
  return { kind, ende, tokenBereit };
}

const abrufen = (srv, token) => abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);

test("Vorspann-Audio, auf Instanz A erzeugt, ist ueber Instanz B abrufbar, mehrfach, bis zur Freigabe", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, db, sql }) => {
    const erzeuger = starteKind(db, { aktion: "ablegen", ttlMs: VORSPANN_TTL_MS });
    try {
      const token = await erzeuger.tokenBereit();
      const { rows } = await sql("SELECT extract(epoch FROM expires_at - now()) AS rest_s FROM tts_ablage");
      assert.equal(rows.length, 1);
      assert.ok(rows[0].rest_s > VORSPANN_TTL_MS / MS_JE_S - TTL_TOLERANZ_S && rows[0].rest_s <= VORSPANN_TTL_MS / MS_JE_S);
      for (const srv of [b, a, b]) {
        const antwort = await abrufen(srv, token);
        assert.equal(antwort.status, HTTP_OK);
        assert.equal(antwort.headers.get("content-type"), TYP);
        assert.deepEqual(Buffer.from(await antwort.arrayBuffer()), AUDIO);
      }
      await starteKind(db, { aktion: "freigeben", token }).ende;
      assert.equal((await abrufen(b, token)).status, HTTP_NOT_FOUND);
      assert.equal((await abrufen(a, token)).status, HTTP_NOT_FOUND);
      const uebrig = await sql("SELECT count(*)::int AS anzahl FROM tts_ablage");
      assert.equal(uebrig.rows[0].anzahl, 0);
    } finally {
      erzeuger.kind.kill();
      await erzeuger.ende;
    }
  });
});
