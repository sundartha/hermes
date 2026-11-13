import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import pg from "pg";
import test from "node:test";

import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 45_000;
const KIND_FRIST_MS = 30_000;
const TTL_MS = 20_000;
const TTL_S = 20;
const FRIST_MS = 5_000;
const FRIST_OBERGRENZE_MS = 9_000;
const WARTEN_UNTERGRENZE_MS = 400;
const OBERGRENZE_MS = 5_000;
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const AUDIO_BASE64 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03]).toString("base64");
const TYP = "audio/mpeg";
const SCHRITT = /^SCHRITT (.*)$/gm;

const KIND_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
const { default: pg } = await import("pg");
const { createHash } = await import("node:crypto");
await speicher.oeffneSpeicher();
const verwaltung = new pg.Client({ connectionString: process.env.VERWALTUNG_URL });
await verwaltung.connect();
const AUDIO = Buffer.from(${JSON.stringify(AUDIO_BASE64)}, "base64");
const hashVon = (token) => createHash("sha256").update(token).digest("hex");
const melde = (name, wert) => console.log("SCHRITT " + JSON.stringify({ name, ...wert }));
const spaeter = (ms, wert) => new Promise((fertig) => setTimeout(() => fertig(wert), ms));
const scheitertSpaeter = (ms) => new Promise((_ja, nein) => setTimeout(() => nein(new Error("Synthese kaputt")), ms));
const ablegen = (token, bytes) => speicher.ttsAblage.ablegen(token, { contentType: ${JSON.stringify(TYP)}, bytes });
const zeilen = async (bedingung) => (await verwaltung.query("SELECT count(*)::int AS n FROM tts_ablage WHERE " + bedingung)).rows[0].n;
const holen = async (token) => {
  const beginn = Date.now();
  const audio = await speicher.ttsAblage.holen(token);
  const wert = audio ? { base64: audio.bytes.toString("base64"), contentType: audio.contentType } : audio;
  return { audio: wert, ms: Date.now() - beginn };
};

const warten = await ablegen("t-warten", spaeter(450, AUDIO));
const reserviert = (await verwaltung.query("SELECT bytes IS NULL AS leer, extract(epoch FROM expires_at - now()) AS rest_s FROM tts_ablage")).rows;
const geholt = await holen("t-warten");
melde("warten", { reserviert, geholt, fertig: await warten.fertig, zeilenDanach: await zeilen("true") });

melde("unbekannt", await holen("t-nie-abgelegt"));

const scheitern = await ablegen("t-scheitern", scheitertSpaeter(300));
const wartender = holen("t-scheitern");
const scheiternFertig = await scheitern.fertig;
melde("scheitern", { fertig: scheiternFertig, zeilenDanach: await zeilen("true"), geholt: await wartender });

const abgelaufen = await ablegen("t-abgelaufen", spaeter(300, AUDIO));
await verwaltung.query("UPDATE tts_ablage SET expires_at = now() - interval '1 minute' WHERE token_hash = $1", [hashVon("t-abgelaufen")]);
const abgelaufenFertig = await abgelaufen.fertig;
melde("abgelaufen", { fertig: abgelaufenFertig, gefuellt: await zeilen("bytes IS NOT NULL"), geholt: await holen("t-abgelaufen") });

await verwaltung.query("BEGIN");
await verwaltung.query("LOCK TABLE tts_ablage IN ACCESS EXCLUSIVE MODE");
const sperreBeginn = Date.now();
const [abgelegt, gesperrtGeholt] = await Promise.all([
  ablegen("t-sperre", AUDIO).then(() => ({ ok: true }), () => ({ ok: false, ms: Date.now() - sperreBeginn })),
  holen("t-sperre"),
]);
await verwaltung.query("COMMIT");
const danach = await ablegen("t-danach", AUDIO);
melde("sperre", { abgelegt, gesperrtGeholt, danachFertig: await danach.fertig, danachGeholt: await holen("t-danach") });

process.exit(0);
`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

function laufeKind(umgebung) {
  const kind = spawn(process.execPath, ["--input-type=module", "-e", KIND_SKRIPT], {
    cwd: new URL("../..", import.meta.url),
    env: { ...process.env, ...umgebung },
    timeout: KIND_FRIST_MS,
  });
  let aus = "";
  let fehlerAus = "";
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
  });
  kind.stderr.on("data", (stueck) => {
    fehlerAus += stueck;
  });
  return new Promise((fertig) => kind.on("close", () => fertig({ aus, fehlerAus })));
}

async function beobachte(t) {
  const db = await echteDatenbankMitRolle(t);
  const umgebung = {
    ...pgStartUmgebung(db.adresse, { ELEVENLABS_TTS_TOKEN_TTL_MS: String(TTL_MS) }),
    VERWALTUNG_URL: adminAdresse(db.adresse),
  };
  const { aus, fehlerAus } = await laufeKind(umgebung);
  const schritte = Object.fromEntries(
    [...aus.matchAll(SCHRITT)].map(([, zeile]) => JSON.parse(zeile)).map((schritt) => [schritt.name, schritt]),
  );
  return { schritte, fehlerAus, aus };
}

const zumTest = (name, pruefung) =>
  test(`TTS-Ablage im Ablauf: ${name}`, { timeout: ZEITGRENZE_MS }, async (t) => {
    if (!postgresVorhanden()) return;
    const beobachtung = await beobachtet(t);
    await pruefung(beobachtung);
  });

let beobachtung = null;
function beobachtet(t) {
  beobachtung ??= beobachte(t);
  return beobachtung;
}

zumTest("ein Abruf vor dem Fuellen wartet getaktet auf die Bytes und bekommt dann Satz und Inhaltstyp", ({ schritte, aus }) => {
  const { warten } = schritte;
  assert.ok(warten, `Ablauf endete vor dem Warten: ${aus}`);
  assert.deepEqual(warten.geholt.audio, { base64: AUDIO_BASE64, contentType: TYP });
  assert.ok(warten.geholt.ms >= WARTEN_UNTERGRENZE_MS, `Abruf wartete ${warten.geholt.ms} ms`);
  assert.ok(warten.geholt.ms < OBERGRENZE_MS, `Abruf wartete ${warten.geholt.ms} ms`);
  assert.equal(warten.fertig, true);
  assert.equal(warten.zeilenDanach, 0);
});

zumTest("die reservierte Zeile ist sofort sichtbar, ohne Bytes, und gilt die konfigurierte Zeit", ({ schritte }) => {
  const { reserviert } = schritte.warten;
  assert.equal(reserviert.length, 1);
  assert.equal(reserviert[0].leer, true);
  assert.ok(reserviert[0].rest_s <= TTL_S && reserviert[0].rest_s > TTL_S - 10, `Restzeit ${reserviert[0].rest_s}`);
});

zumTest("ein nie abgelegter Satz endet sofort ohne Satz", ({ schritte }) => {
  assert.equal(schritte.unbekannt.audio, null);
  assert.ok(schritte.unbekannt.ms < OBERGRENZE_MS, `Abruf dauerte ${schritte.unbekannt.ms} ms`);
});

zumTest("scheitert die Synthese, ist die Zeile sofort weg und der wartende Abruf endet vor Ablauf ohne Satz", ({ schritte, fehlerAus }) => {
  const { scheitern } = schritte;
  assert.equal(scheitern.fertig, false);
  assert.equal(scheitern.zeilenDanach, 0);
  assert.equal(scheitern.geholt.audio, null);
  assert.ok(scheitern.geholt.ms < OBERGRENZE_MS, `Abruf dauerte ${scheitern.geholt.ms} ms`);
  assert.match(fehlerAus, /\[tts-ablage\] Satz nicht abgelegt: Synthese kaputt/);
});

zumTest("kommt der Satz nach dem Ablauf, wird nichts gefuellt und der Abruf liefert nichts", ({ schritte }) => {
  const { abgelaufen } = schritte;
  assert.equal(abgelaufen.fertig, false);
  assert.equal(abgelaufen.gefuellt, 0);
  assert.equal(abgelaufen.geholt.audio, null);
  assert.ok(abgelaufen.geholt.ms < OBERGRENZE_MS, `Abruf dauerte ${abgelaufen.geholt.ms} ms`);
});

zumTest("bei gesperrter Tabelle enden Ablegen und Abruf nach der Datenbankfrist, nicht frueher und nicht spaeter", ({ schritte, fehlerAus }) => {
  const { sperre } = schritte;
  assert.equal(sperre.abgelegt.ok, false);
  assert.ok(sperre.abgelegt.ms >= FRIST_MS - 500, `Ablegen endete nach ${sperre.abgelegt.ms} ms`);
  assert.ok(sperre.abgelegt.ms < FRIST_OBERGRENZE_MS, `Ablegen endete nach ${sperre.abgelegt.ms} ms`);
  assert.equal(sperre.gesperrtGeholt.audio, null);
  assert.ok(sperre.gesperrtGeholt.ms >= FRIST_MS - 500, `Abruf endete nach ${sperre.gesperrtGeholt.ms} ms`);
  assert.ok(sperre.gesperrtGeholt.ms < FRIST_OBERGRENZE_MS, `Abruf endete nach ${sperre.gesperrtGeholt.ms} ms`);
  assert.match(fehlerAus, /\[tts-ablage\] Abruf nicht moeglich, wird abgelehnt:/);
});

zumTest("nach einem Fehlschlag in der Datenbank ist die Verbindung wieder sauber: Ablegen und Abruf gelingen", ({ schritte }) => {
  const { sperre } = schritte;
  assert.equal(sperre.danachFertig, true);
  assert.deepEqual(sperre.danachGeholt.audio, { base64: AUDIO_BASE64, contentType: TYP });
});
