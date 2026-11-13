import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import test from "node:test";

import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const TTL_MS = 90_000;
const TTL_S = 90;
const FRIST_UNTERGRENZE_MS = 4_500;
const STORE_URL = new URL("../../src/store.js", import.meta.url).href;
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03]);
const AUDIO_BASE64 = AUDIO.toString("base64");
const TYP = "audio/mpeg";
const ZEILEN_SQL = "SELECT token_hash, content_type, bytes, expires_at > now() AS gueltig, extract(epoch FROM expires_at - now()) AS rest_s FROM tts_ablage";
const ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM tts_ablage";
const ABLAUFEN_SQL = "UPDATE tts_ablage SET expires_at = now() - interval '1 minute' WHERE token_hash = $1";
const ALTE_ZEILE_SQL = "INSERT INTO tts_ablage (token_hash, content_type, bytes, expires_at) VALUES ($1, 'audio/mpeg', '\\x00', now() - interval '1 minute')";

const KIND_SKRIPT = `
const speicher = await import(${JSON.stringify(STORE_URL)});
await speicher.oeffneSpeicher();
const befehl = JSON.parse(process.argv[1]);
const beginn = Date.now();
const bytes = () => Buffer.from(befehl.base64, "base64");
if (befehl.aktion === "ablegen") {
  const freigabe = new Promise((fertig) => process.stdin.once("data", fertig));
  const audio = befehl.modus === "sofort"
    ? Promise.resolve(bytes())
    : freigabe.then(() => {
        if (befehl.modus === "scheitern") throw new Error("Synthese kaputt");
        return bytes();
      });
  try {
    const { fertig } = await speicher.ttsAblage.ablegen(befehl.token, { contentType: befehl.contentType, bytes: audio });
    console.log("reserviert");
    console.log("fertig " + (await fertig));
  } catch (fehler) {
    console.log("abgelehnt " + (Date.now() - beginn));
  }
} else {
  const audio = await speicher.ttsAblage.holen(befehl.token);
  const wert = audio && { base64: audio.bytes.toString("base64"), contentType: audio.contentType };
  console.log("ergebnis " + JSON.stringify(wert) + " " + (Date.now() - beginn));
}
process.exit(0);
`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

function starteProzess(umgebung, befehl) {
  const kind = spawn(process.execPath, ["--input-type=module", "-e", KIND_SKRIPT, JSON.stringify({ base64: AUDIO_BASE64, contentType: TYP, ...befehl })], {
    env: { ...process.env, ...umgebung },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let aus = "";
  let fehlerAus = "";
  const wartende = [];
  const pruefeWartende = () => {
    for (const warte of [...wartende]) {
      const treffer = warte.muster.exec(aus);
      if (!treffer) continue;
      wartende.splice(wartende.indexOf(warte), 1);
      warte.fertig(treffer);
    }
  };
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
    pruefeWartende();
  });
  kind.stderr.on("data", (stueck) => {
    fehlerAus += stueck;
  });
  const beendet = new Promise((fertig) => kind.on("close", fertig));
  return {
    wert: (muster) =>
      Promise.race([
        new Promise((fertig) => {
          const bereits = muster.exec(aus);
          if (bereits) fertig(bereits);
          else wartende.push({ muster, fertig });
        }),
        beendet.then(() => {
          const bereits = muster.exec(aus);
          return bereits ? bereits : Promise.reject(new Error(`Prozess endete ohne ${muster}: ${aus} ${fehlerAus}`));
        }),
      ]),
    freigeben: () => kind.stdin.write("frei\n"),
    beendet,
    ausgabe: () => aus,
    fehlerAusgabe: () => fehlerAus,
  };
}

const HOLEN_ERGEBNIS = /ergebnis (null|\{.*?\}) (\d+)/;
const lies = (treffer) => (treffer[1] === "null" ? null : JSON.parse(treffer[1]));

async function mitAblage(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const umgebung = pgStartUmgebung(db.adresse, { ELEVENLABS_TTS_TOKEN_TTL_MS: String(TTL_MS) });
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const holen = async (token) => lies(await starteProzess(umgebung, { aktion: "holen", token }).wert(HOLEN_ERGEBNIS));
  const ablegen = (token, modus = "sofort") => starteProzess(umgebung, { aktion: "ablegen", token, modus });
  try {
    await holen("anlauf-token");
    return await lauf({ umgebung, sql, holen, ablegen });
  } finally {
    await verwaltung.end();
  }
}

const hashVon = (token) => createHash("sha256").update(token).digest("hex");

test("TTS-Ablage: ein zweiter Prozess holt den Satz des ersten, gleiche Bytes und gleicher Inhaltstyp", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, holen }) => {
    const a = ablegen("token-eins");
    await a.beendet;
    assert.match(a.ausgabe(), /fertig true/);
    const audio = await holen("token-eins");
    assert.deepEqual(audio, { base64: AUDIO_BASE64, contentType: TYP });
  });
});

test("TTS-Ablage: in der Tabelle steht nur der SHA-256 des Tokens, nie der Token, und die Gueltigkeit folgt tokenTtlMs", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, sql }) => {
    await ablegen("geheimer-token-zwei").beendet;
    const { rows } = await sql(ZEILEN_SQL);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hashVon("geheimer-token-zwei"));
    assert.equal(rows[0].content_type, TYP);
    assert.deepEqual(rows[0].bytes, AUDIO);
    assert.ok(!JSON.stringify(rows[0]).includes("geheimer-token-zwei"));
    assert.ok(rows[0].rest_s <= TTL_S && rows[0].rest_s > TTL_S - 30, `Restzeit ${rows[0].rest_s}`);
  });
});

test("TTS-Ablage: ein zweiter Abruf liefert nichts und die Zeile ist weg", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, holen, sql }) => {
    await ablegen("token-drei").beendet;
    assert.deepEqual(await holen("token-drei"), { base64: AUDIO_BASE64, contentType: TYP });
    assert.equal(await holen("token-drei"), null);
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0);
    assert.equal(await holen("nie-abgelegter-token"), null);
  });
});

test("TTS-Ablage: vier gleichzeitige Abrufe aus vier Prozessen liefern genau einmal den Satz", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, holen }) => {
    await ablegen("token-vier").beendet;
    const ergebnisse = await Promise.all([1, 2, 3, 4].map(() => holen("token-vier")));
    assert.equal(ergebnisse.filter((audio) => audio !== null).length, 1);
  });
});

test("TTS-Ablage: nach Ablauf liefert der Abruf nichts, die Zeile samt Bytes ist entfernt, ein unabgelaufener Satz bleibt abrufbar", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, holen, sql }) => {
    await ablegen("token-fuenf-alt").beendet;
    await ablegen("token-fuenf-neu").beendet;
    await sql(ABLAUFEN_SQL, [hashVon("token-fuenf-alt")]);
    await sql(ALTE_ZEILE_SQL, [hashVon("fremde-alte-zeile")]);
    assert.deepEqual(await holen("token-fuenf-neu"), { base64: AUDIO_BASE64, contentType: TYP });
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0, "abgelaufene Zeilen sind geloescht");
    await ablegen("token-fuenf-zwei").beendet;
    await sql(ABLAUFEN_SQL, [hashVon("token-fuenf-zwei")]);
    assert.equal(await holen("token-fuenf-zwei"), null);
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0);
  });
});

test("TTS-Ablage: ein Abruf vor dem Fuellen wartet auf die Bytes und bekommt sie dann", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ umgebung, ablegen, sql }) => {
    const a = ablegen("token-sechs", "warten");
    await a.wert(/reserviert/);
    const { rows } = await sql(ZEILEN_SQL);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bytes, null);
    const b = starteProzess(umgebung, { aktion: "holen", token: "token-sechs" });
    const ergebnis = b.wert(HOLEN_ERGEBNIS);
    a.freigeben();
    await a.beendet;
    assert.deepEqual(lies(await ergebnis), { base64: AUDIO_BASE64, contentType: TYP });
  });
});

test("TTS-Ablage: scheitert die Synthese nach dem Reservieren, endet der wartende Abruf sofort ohne Satz und die Zeile ist gelöscht", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ umgebung, ablegen, sql }) => {
    const a = ablegen("token-sieben", "scheitern");
    await a.wert(/reserviert/);
    const b = starteProzess(umgebung, { aktion: "holen", token: "token-sieben" });
    const ergebnis = b.wert(HOLEN_ERGEBNIS);
    a.freigeben();
    await a.beendet;
    assert.match(a.ausgabe(), /fertig false/);
    assert.match(a.fehlerAusgabe(), /\[tts-ablage\] Satz nicht abgelegt: Synthese kaputt/);
    assert.equal(lies(await ergebnis), null);
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 0);
  });
});

test("TTS-Ablage: kommt der Satz erst nach dem Ablauf, wird er nicht mehr abgelegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ ablegen, holen, sql }) => {
    const a = ablegen("token-acht", "warten");
    await a.wert(/reserviert/);
    await sql(ABLAUFEN_SQL, [hashVon("token-acht")]);
    a.freigeben();
    await a.beendet;
    assert.match(a.ausgabe(), /fertig false/);
    assert.equal(await holen("token-acht"), null);
  });
});

async function sperreTabelle(sql) {
  await sql("BEGIN");
  await sql("LOCK TABLE tts_ablage IN ACCESS EXCLUSIVE MODE");
}

test("TTS-Ablage: ist die Datenbank nicht erreichbar, scheitert das Ablegen und der Abruf endet ohne Satz, jeweils nach der Datenbankfrist", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ umgebung, sql, ablegen }) => {
    await sperreTabelle(sql);
    try {
      const abgelegt = ablegen("token-neun");
      const geholt = starteProzess(umgebung, { aktion: "holen", token: "token-neun" });
      const [ablage, abruf] = await Promise.all([abgelegt.wert(/abgelehnt (\d+)/), geholt.wert(HOLEN_ERGEBNIS)]);
      assert.ok(Number(ablage[1]) >= FRIST_UNTERGRENZE_MS, `Ablegen wartet bis zur Frist: ${ablage[1]} ms`);
      assert.equal(lies(abruf), null);
      assert.ok(Number(abruf[2]) >= FRIST_UNTERGRENZE_MS, `Abruf wartet bis zur Frist: ${abruf[2]} ms`);
      assert.match(geholt.fehlerAusgabe(), /\[tts-ablage\] Abruf nicht moeglich, wird abgelehnt:/);
      assert.doesNotMatch(abgelegt.ausgabe(), /reserviert/);
    } finally {
      await sql("COMMIT");
    }
  });
});

test("TTS-Ablage: scheitert auch das Verwerfen, bleibt die Zeile bis zum Ablauf und der Fehler wird protokolliert", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAblage(t, async ({ sql, ablegen }) => {
    const a = ablegen("token-zehn", "scheitern");
    await a.wert(/reserviert/);
    await sperreTabelle(sql);
    try {
      a.freigeben();
      await a.beendet;
    } finally {
      await sql("COMMIT");
    }
    assert.match(a.ausgabe(), /fertig false/);
    assert.match(a.fehlerAusgabe(), /\[tts-ablage\] Zeile nicht verworfen, bleibt bis zum Ablauf:/);
    assert.equal((await sql(ANZAHL_SQL)).rows[0].anzahl, 1);
  });
});
