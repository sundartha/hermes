import { test } from "node:test";
import assert from "node:assert/strict";
import { createTtsStore } from "../../src/tts/store.ts";
import { FAKE_FIRST_CHUNK, FAKE_REST_CHUNK } from ".././helpers/fake-tts-stream.mjs";

const TTL_MS = 60000;
const SHORT_TTL_MS = 5;
const TTL_WAIT_MS = 30;
const BYTES_A = Buffer.from(FAKE_FIRST_CHUNK);
const BYTES_B = Buffer.from(FAKE_REST_CHUNK);

function fertigesAudio(bytes, contentType = "audio/mpeg") {
  return { bytes: Promise.resolve(bytes), contentType };
}

test("put -> takeOnce liefert exakt die Bytes + ContentType", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const bytes = BYTES_A;
  const token = store.put(fertigesAudio(bytes));
  const result = await store.takeOnce(token);
  assert.deepEqual(result, { bytes, contentType: "audio/mpeg" });
});

test("Zweiter takeOnce fuer denselben Token -> null (EINMALIGER Abruf)", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const token = store.put(fertigesAudio(BYTES_A));
  assert.notEqual(await store.takeOnce(token), null);
  assert.equal(await store.takeOnce(token), null);
});

test("Unbekannter Token -> null", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  assert.equal(await store.takeOnce("nie-vergeben"), null);
});

test("Nach Ablauf der TTL -> null (kein Nichtabruf-Leck)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createTtsStore({ ttlMs: SHORT_TTL_MS });
  const token = store.put(fertigesAudio(BYTES_A));
  t.mock.timers.tick(TTL_WAIT_MS);
  assert.equal(await store.takeOnce(token), null);
});

test("Zwei put() -> verschiedene, URL-sichere Tokens (base64url, kein Escaping noetig)", () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const t1 = store.put(fertigesAudio(BYTES_A));
  const t2 = store.put(fertigesAudio(BYTES_B));
  assert.notEqual(t1, t2);
  assert.match(t1, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
  assert.match(t2, /^[A-Za-z0-9_-]+$/, "base64url-Alphabet, kein +/=");
});

test("IE7: ein noch laufendes Versprechen wird beim Abruf abgewartet", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const bytes = BYTES_B;
  let liefern;
  const token = store.put({
    contentType: "audio/mpeg",
    bytes: new Promise((resolve) => {
      liefern = resolve;
    }),
  });
  const abruf = store.takeOnce(token);
  liefern(bytes);
  assert.deepEqual(await abruf, { bytes, contentType: "audio/mpeg" });
});

test("IE7: takeOnce loescht VOR dem Warten -> paralleler zweiter Abruf bekommt null", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  let liefern;
  const token = store.put({
    contentType: "audio/mpeg",
    bytes: new Promise((resolve) => {
      liefern = resolve;
    }),
  });
  const ersterAbruf = store.takeOnce(token);
  const zweiterAbruf = store.takeOnce(token);
  assert.equal(await zweiterAbruf, null, "kein zweiter Konsument derselben Ausgabe");
  liefern(BYTES_A);
  assert.notEqual(await ersterAbruf, null);
});

test("3365-K12: gehaltene Datei ist mehrfach abrufbar, nach release null, ohne Option bleibt es ein Einmalabruf", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS });
  const gehalten = store.put(fertigesAudio(BYTES_A), { bisFreigabe: true });
  const erwartet = { bytes: BYTES_A, contentType: "audio/mpeg" };
  assert.deepEqual(await store.takeOnce(gehalten), erwartet);
  assert.deepEqual(await store.takeOnce(gehalten), erwartet);
  store.release(gehalten);
  assert.equal(await store.takeOnce(gehalten), null);
  const einmal = store.put(fertigesAudio(BYTES_A));
  assert.deepEqual(await store.takeOnce(einmal), erwartet);
  assert.equal(await store.takeOnce(einmal), null);
  assert.doesNotThrow(() => store.release("unbekannt"));
});

test("3365-K12: eigene Lebensdauer einer gehaltenen Datei ersetzt die Standard-Lebensdauer in beide Richtungen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createTtsStore({ ttlMs: TTL_MS });
  const kurz = store.put(fertigesAudio(BYTES_A), { bisFreigabe: true, ttlMs: SHORT_TTL_MS });
  const langStore = createTtsStore({ ttlMs: SHORT_TTL_MS });
  const gehalten = langStore.put(fertigesAudio(BYTES_A), { bisFreigabe: true, ttlMs: TTL_MS });
  t.mock.timers.tick(TTL_WAIT_MS);
  assert.equal(await store.takeOnce(kurz), null);
  assert.notEqual(await langStore.takeOnce(gehalten), null);
});

const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01]);
const TYP = "audio/mpeg";

function fertigesAudioMitTyp(bytes = AUDIO) {
  return { bytes: Promise.resolve(bytes), contentType: TYP };
}

function fakeAblage({ ablegenFehler = null, holenErgebnis = null } = {}) {
  const aufrufe = { ablegen: [], holen: [] };
  return {
    aufrufe,
    async ablegen(token, audio) {
      aufrufe.ablegen.push({ token, audio });
      if (ablegenFehler) throw ablegenFehler;
      return { fertig: Promise.resolve(true) };
    },
    async holen(token) {
      aufrufe.holen.push(token);
      return holenErgebnis;
    },
  };
}

test("Ablage aktiv: put legt in der Ablage ab, liefert den Token erst danach und nicht aus dem Prozessspeicher", async () => {
  const ablage = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage });
  const audio = fertigesAudioMitTyp();
  const token = await store.put(audio);
  assert.equal(typeof token, "string");
  assert.equal(ablage.aufrufe.ablegen.length, 1);
  const [abgelegt] = ablage.aufrufe.ablegen;
  assert.equal(abgelegt.token, token);
  assert.equal(abgelegt.audio, audio);
});

test("Ablage aktiv: takeOnce holt aus der Ablage, was sie liefert, und null, wenn sie nichts hat", async () => {
  const geliefert = { bytes: AUDIO, contentType: TYP };
  const mitSatz = createTtsStore({ ttlMs: TTL_MS, ablage: fakeAblage({ holenErgebnis: geliefert }) });
  assert.deepEqual(await mitSatz.takeOnce("fremder-token"), geliefert);
  const ohneSatz = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: ohneSatz });
  assert.equal(await store.takeOnce("fremder-token"), null);
  assert.deepEqual(ohneSatz.aufrufe.holen, ["fremder-token"]);
});

test("Ablage aktiv: scheitert die Ablage, scheitert put und es gibt keinen Token", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: fakeAblage({ ablegenFehler: new Error("db weg") }) });
  await assert.rejects(() => store.put(fertigesAudioMitTyp()), /db weg/);
});

test("Ablage aktiv: ein Vorspann mit bisFreigabe bleibt im Prozess, mehrfach abrufbar, ohne Ablage", async () => {
  const ablage = fakeAblage();
  const store = createTtsStore({ ttlMs: TTL_MS, ablage });
  const token = store.put(fertigesAudioMitTyp(), { bisFreigabe: true });
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.equal(ablage.aufrufe.ablegen.length, 0);
  assert.equal(ablage.aufrufe.holen.length, 0);
  store.release(token);
  assert.equal(await store.takeOnce(token), null);
  assert.deepEqual(ablage.aufrufe.holen, [token]);
});

test("Ohne Ablage: put liefert den Token sofort und takeOnce ruft nichts ausserhalb des Prozesses", async () => {
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: null });
  const token = store.put(fertigesAudioMitTyp());
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), { bytes: AUDIO, contentType: TYP });
  assert.equal(await store.takeOnce(token), null);
});

const GELIEFERT = { bytes: AUDIO, contentType: TYP };
const EIGENE_TTL_MS = 7_000;

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
  const store = createTtsStore({ ttlMs: TTL_MS, bisFreigabeAblage: bisFreigabe });
  const audio = fertigesAudioMitTyp();
  const token = await store.put(audio, { bisFreigabe: true, ttlMs: EIGENE_TTL_MS });
  assert.deepEqual(aufrufe.ablegen, [{ token, audio, optionen: { ttlMs: EIGENE_TTL_MS } }]);
  await store.put(fertigesAudioMitTyp());
  assert.equal(aufrufe.ablegen.length, 1);
});

test("scheitert die Ablage bis Freigabe, liefert put trotzdem den Token und der Prozess liefert das Audio", async (t) => {
  const fehlerAus = t.mock.method(console, "error", () => {});
  const { bisFreigabe } = aufzeichnendeAblage({ ablegenFehler: new Error("db weg") });
  const store = createTtsStore({ ttlMs: TTL_MS, bisFreigabeAblage: bisFreigabe });
  const token = await store.put(fertigesAudioMitTyp(), { bisFreigabe: true });
  assert.equal(typeof token, "string");
  assert.deepEqual(await store.takeOnce(token), GELIEFERT);
  assert.equal(fehlerAus.mock.calls.length, 1);
  const [aufruf] = fehlerAus.mock.calls;
  assert.match(aufruf.arguments.join(" "), /Vorspann-Audio nicht in der Ablage: db weg/);
});

test("release gibt das Audio in der Ablage frei, auch wenn der Prozess es nicht selbst hielt", () => {
  const { aufrufe, bisFreigabe } = aufzeichnendeAblage();
  createTtsStore({ ttlMs: TTL_MS, bisFreigabeAblage: bisFreigabe }).release("fremder-token");
  assert.deepEqual(aufrufe.freigeben, ["fremder-token"]);
});

test("scheitert das Freigeben in der Ablage, wird es gemeldet und release wirft nicht", async (t) => {
  const fehlerAus = t.mock.method(console, "error", () => {});
  const bisFreigabe = { ...aufzeichnendeAblage().bisFreigabe, freigeben: async () => { throw new Error("db weg"); } };
  createTtsStore({ ttlMs: TTL_MS, bisFreigabeAblage: bisFreigabe }).release("tok");
  await new Promise((fertig) => setImmediate(fertig));
  const texte = fehlerAus.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
  const meldungen = texte.filter((text) => text.includes("[tts-store]"));
  assert.deepEqual(meldungen, ["[tts-store] Vorspann-Audio nicht in der Ablage: db weg"]);
});

test("takeOnce faellt ohne Eintrag auf die Ablage bis Freigabe zurueck, nachdem die einmalige Ablage nichts hat", async () => {
  const { aufrufe, bisFreigabe, normal } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: normal, bisFreigabeAblage: bisFreigabe });
  assert.deepEqual(await store.takeOnce("tok"), GELIEFERT);
  assert.deepEqual(aufrufe.holen, ["tok"]);
  assert.deepEqual(aufrufe.lesen, ["tok"]);
});

test("takeOnce liest nicht aus der Ablage bis Freigabe, wenn die einmalige Ablage das Audio hat", async () => {
  const { aufrufe, bisFreigabe } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  const normal = { ablegen: async () => {}, holen: async () => ({ bytes: AUDIO, contentType: "audio/wav" }) };
  const store = createTtsStore({ ttlMs: TTL_MS, ablage: normal, bisFreigabeAblage: bisFreigabe });
  assert.deepEqual(await store.takeOnce("tok"), { bytes: AUDIO, contentType: "audio/wav" });
  assert.deepEqual(aufrufe.lesen, []);
});

test("takeOnce liest ohne einmalige Ablage nur aus der Ablage bis Freigabe und ohne beide liefert es nichts", async () => {
  const { bisFreigabe } = aufzeichnendeAblage({ gelesen: GELIEFERT });
  assert.deepEqual(await createTtsStore({ ttlMs: TTL_MS, bisFreigabeAblage: bisFreigabe }).takeOnce("tok"), GELIEFERT);
  assert.equal(await createTtsStore({ ttlMs: TTL_MS }).takeOnce("tok"), null);
});
