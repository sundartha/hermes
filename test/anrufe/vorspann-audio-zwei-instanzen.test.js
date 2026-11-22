import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { makeAblageBisFreigabe } from "../../src/tts/ablage-bis-freigabe.js";
import { createTtsStore } from "../../src/tts/store.ts";
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

const GELIEFERT = { bytes: AUDIO, contentType: TYP };
const TTL_MS = 7_000;
const fertigesAudio = () => ({ bytes: Promise.resolve(AUDIO), contentType: TYP });

function aufzeichnendeAblage({ ablegenFehler = null, gelesen = null } = {}) {
  const aufrufe = { ablegen: [], lesen: [], freigeben: [], holen: [] };
  const bisFreigabe = {
    ablegen: async (token, audio, optionen) => {
      aufrufe.ablegen.push({ token, audio, optionen });
      if (ablegenFehler) throw ablegenFehler;
    },
    lesen: async (token) => {
      aufrufe.lesen.push(token);
      return gelesen;
    },
    freigeben: async (token) => {
      aufrufe.freigeben.push(token);
    },
  };
  const normal = {
    ablegen: async () => {},
    holen: async (token) => {
      aufrufe.holen.push(token);
      return null;
    },
  };
  return { aufrufe, bisFreigabe, normal };
}

test("put mit bisFreigabe legt das Audio mit eigener Frist in der Ablage bis Freigabe ab, ohne bisFreigabe nicht", async () => {
  const { aufrufe, bisFreigabe } = aufzeichnendeAblage();
  const store = createTtsStore({ ttlMs: 60_000, bisFreigabeAblage: bisFreigabe });
  const audio = fertigesAudio();
  const token = await store.put(audio, { bisFreigabe: true, ttlMs: TTL_MS });
  assert.deepEqual(aufrufe.ablegen, [{ token, audio, optionen: { ttlMs: TTL_MS } }]);
  await store.put(fertigesAudio());
  assert.equal(aufrufe.ablegen.length, 1);
});

test("scheitert die Ablage bis Freigabe, liefert put trotzdem den Token und der Prozess liefert das Audio", async (t) => {
  const fehlerAus = t.mock.method(console, "error", () => {});
  const { bisFreigabe } = aufzeichnendeAblage({ ablegenFehler: new Error("db weg") });
  const store = createTtsStore({ ttlMs: 60_000, bisFreigabeAblage: bisFreigabe });
  const token = await store.put(fertigesAudio(), { bisFreigabe: true });
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), GELIEFERT);
  assert.equal(fehlerAus.mock.calls.length, 1);
  const [aufruf] = fehlerAus.mock.calls;
  assert.match(aufruf.arguments.join(" "), /Vorspann-Audio nicht in der Ablage: db weg/);
});

test("release gibt das Audio in der Ablage frei, auch wenn der Prozess es nicht selbst hielt", () => {
  const { aufrufe, bisFreigabe } = aufzeichnendeAblage();
  createTtsStore({ ttlMs: 60_000, bisFreigabeAblage: bisFreigabe }).release("fremder-token");
  assert.deepEqual(aufrufe.freigeben, ["fremder-token"]);
});

test("scheitert das Freigeben in der Ablage, wird es gemeldet und release wirft nicht", async (t) => {
  const fehlerAus = t.mock.method(console, "error", () => {});
  const bisFreigabe = { ...aufzeichnendeAblage().bisFreigabe, freigeben: async () => { throw new Error("db weg"); } };
  createTtsStore({ ttlMs: 60_000, bisFreigabeAblage: bisFreigabe }).release("tok");
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(fehlerAus.mock.calls.length, 1);
});

test("takeOnce faellt ohne Eintrag auf die Ablage bis Freigabe zurueck, nachdem die einmalige Ablage nichts hat", async () => {
  const { aufrufe, bisFreigabe, normal } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  const store = createTtsStore({ ttlMs: 60_000, ablage: normal, bisFreigabeAblage: bisFreigabe });
  assert.deepEqual(await store.takeOnce("tok"), GELIEFERT);
  assert.deepEqual(aufrufe.holen, ["tok"]);
  assert.deepEqual(aufrufe.lesen, ["tok"]);
});

test("takeOnce liest nicht aus der Ablage bis Freigabe, wenn die einmalige Ablage das Audio hat", async () => {
  const { aufrufe, bisFreigabe } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  const normal = { ablegen: async () => {}, holen: async () => ({ bytes: AUDIO, contentType: "audio/wav" }) };
  const store = createTtsStore({ ttlMs: 60_000, ablage: normal, bisFreigabeAblage: bisFreigabe });
  assert.deepEqual(await store.takeOnce("tok"), { bytes: AUDIO, contentType: "audio/wav" });
  assert.deepEqual(aufrufe.lesen, []);
});

test("takeOnce liest ohne einmalige Ablage nur aus der Ablage bis Freigabe und ohne beide liefert es nichts", async () => {
  const { bisFreigabe } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  assert.deepEqual(await createTtsStore({ ttlMs: 60_000, bisFreigabeAblage: bisFreigabe }).takeOnce("tok"), GELIEFERT);
  assert.equal(await createTtsStore({ ttlMs: 60_000 }).takeOnce("tok"), null);
});

test("die Ablage bis Freigabe nutzt je Token einen eigenen Schluessel, getrennt von der einmaligen Ablage", async () => {
  const gesehen = [];
  const roh = {
    ablegen: async (schluessel, audio, optionen) => gesehen.push(["ablegen", schluessel, optionen]),
    lesen: async (schluessel) => gesehen.push(["lesen", schluessel]),
    freigeben: async (schluessel) => gesehen.push(["freigeben", schluessel]),
  };
  const ablage = makeAblageBisFreigabe(roh);
  await ablage.ablegen("tok", fertigesAudio(), { ttlMs: TTL_MS });
  await ablage.lesen("tok");
  await ablage.freigeben("tok");
  assert.deepEqual(gesehen, [
    ["ablegen", "bis-freigabe:tok", { ttlMs: TTL_MS }],
    ["lesen", "bis-freigabe:tok"],
    ["freigeben", "bis-freigabe:tok"],
  ]);
});
