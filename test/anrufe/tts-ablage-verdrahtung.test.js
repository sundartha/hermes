import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { mitZweiHermesAufPostgres, postgresVorhanden } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01]);
const TYP = "audio/mpeg";
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const ABLAGE_TOKEN = "abruf-ueber-zweiten-prozess";

const ABLEGEN_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
await speicher.oeffneSpeicher();
const { fertig } = await speicher.ttsAblage.ablegen(process.argv[1], {
  contentType: process.argv[2],
  bytes: Promise.resolve(Buffer.from(process.argv[3], "base64")),
});
console.log("fertig " + (await fertig));
process.exit(0);
`;

function legeInAblageAb(umgebung, token) {
  const kind = spawn(
    process.execPath,
    ["--input-type=module", "-e", ABLEGEN_SKRIPT, token, TYP, AUDIO.toString("base64")],
    { env: { ...process.env, ...umgebung }, stdio: ["ignore", "pipe", "inherit"] },
  );
  let aus = "";
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
  });
  return new Promise((fertig) => kind.on("close", () => fertig(aus)));
}

const abrufen = (srv, token) => abrufMitFrist(`${srv.localUrl}/voice/tts/${token}`);

test("Zwei Prozesse am selben Postgres: der Satz eines dritten Prozesses ist ueber die Route abrufbar, genau einmal", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, db }) => {
    const umgebung = pgStartUmgebung(db.adresse);
    assert.match(await legeInAblageAb(umgebung, ABLAGE_TOKEN), /fertig true/);
    const antworten = await Promise.all([abrufen(a, ABLAGE_TOKEN), abrufen(b, ABLAGE_TOKEN)]);
    const stati = antworten.map((antwort) => antwort.status).sort();
    assert.deepEqual(stati, [HTTP_OK, HTTP_NOT_FOUND]);
    const treffer = antworten.find((antwort) => antwort.status === HTTP_OK);
    assert.deepEqual(Buffer.from(await treffer.arrayBuffer()), AUDIO);
    assert.equal(treffer.headers.get("content-type"), TYP);
    assert.equal((await abrufen(b, ABLAGE_TOKEN)).status, HTTP_NOT_FOUND);
    assert.equal((await abrufen(a, "nie-abgelegt")).status, HTTP_NOT_FOUND);
  });
});
