import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { laufendeAusgaben } from "../gemeinsam/instanz-ausgabe.js";
import { waitUntil } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import { anrufAnBis, leseAnrufBis, zeilenBis } from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_FEHLER = 500;
const HOST = "instanz-sichtbar.agent.test";
const KURZE_FRIST_MS = 50;
const ZIEL = "+4915112349999";
const WAHL_FRIST_MS = 15_000;
const ANRUF = { streamToken: "tok-s", from: "+4915112340001" };

function gegenstelle(status) {
  return starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", () => {
      res.writeHead(status(roh), { "content-type": "application/json" });
      res.end("{}");
    });
  });
}

const post = async (url, koerper) => {
  const antwort = await abrufMitFrist(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(koerper),
  });
  await antwort.text();
  return antwort.status;
};

const waehle = (anbieter, callId, ende = "") =>
  post(`${anbieter.url}/v2/calls`, {
    command_id: `vorspann-${callId}${ende}`,
    webhook_url: `https://${HOST}/voice/vorspann?callId=${callId}`,
  });

async function aufgebaut(t, { status, leseAnruf }) {
  t.mock.method(console, "error", () => {});
  const instanz = await gegenstelle(status);
  const anbieter = await starteAnrufstartAttrappe();
  t.after(async () => {
    await anbieter.schliessen();
    await instanz.close();
  });
  anbieter.verbinde({ host: HOST, url: instanz.url, agentId: "agent_s", leseAnruf });
  return anbieter;
}

async function fristFehler(lauf) {
  const fehler = await lauf().then(
    () => null,
    (grund) => grund,
  );
  assert.ok(fehler, "die Frist muss ablaufen");
  return fehler.message;
}

const anrufFrist = (sql = async () => ({ rows: [] })) =>
  fristFehler(() => anrufAnBis(sql, { ziel: ZIEL, genug: () => false, fristMs: KURZE_FRIST_MS }));

const nimmAn = async (anbieter, callId) => {
  assert.equal(await waehle(anbieter, callId), HTTP_OK);
  assert.equal(await waehle(anbieter, callId, "-el"), HTTP_OK);
};

test("Annahme scheitert: anrufAnBis nennt Anruf, Schritt, Instanz-Ausgabe und den Fehler", async (t) => {
  const anbieter = await aufgebaut(t, { status: () => HTTP_FEHLER, leseAnruf: async () => ANRUF });
  const ausgabe = { text: "instanz-zeile-sichtbar" };
  laufendeAusgaben.add(ausgabe);
  t.after(() => laufendeAusgaben.delete(ausgabe));
  assert.equal(await waehle(anbieter, "a1"), HTTP_OK);
  await waitUntil(() => anbieter.fehler().length === 1);
  assert.match(anbieter.fehler()[0], /^Anruf a1 Schritt Annahme: /);
  const meldung = await anrufFrist();
  assert.match(
    meldung,
    /^Anruf an \+4915112349999 per SQL nach \d+ ms nicht erreicht: undefined\n/,
  );
  assert.match(meldung, /--- Ausgabe Instanz 1 ---\ninstanz-zeile-sichtbar/);
  assert.match(meldung, /\nFehler der Attrappe:\nAnruf a1 Schritt Annahme: /);
});

test("Bindung scheitert, weil die Zeile nie lesbar wird: Schritt Bindung steht in beiden Frist-Meldungen", async (t) => {
  const anbieter = await aufgebaut(t, {
    status: () => HTTP_OK,
    leseAnruf: async () => {
      throw new Error("zeile fehlt");
    },
  });
  await nimmAn(anbieter, "b1");
  await waitUntil(() => anbieter.fehler().length === 1);
  assert.equal(anbieter.fehler()[0], "Anruf b1 Schritt Bindung: zeile fehlt");
  assert.match(
    await anrufFrist(),
    /\nFehler der Attrappe:\nAnruf b1 Schritt Bindung: zeile fehlt$/,
  );
  const zeilen = await fristFehler(() =>
    zeilenBis(
      async () => [],
      () => false,
      KURZE_FRIST_MS,
    ),
  );
  assert.match(zeilen, /\nFehler der Attrappe:\nAnruf b1 Schritt Bindung: zeile fehlt$/);
});

test("Ereignis nach der Bindung scheitert: Schritt Ereignis wird genannt", async (t) => {
  const anbieter = await aufgebaut(t, {
    status: (roh) => (roh.includes("call.playback.ended") ? HTTP_FEHLER : HTTP_OK),
    leseAnruf: async () => ANRUF,
  });
  await nimmAn(anbieter, "e1");
  await waitUntil(() => anbieter.fehler().length === 1);
  assert.match(anbieter.fehler()[0], /^Anruf e1 Schritt Ereignis: /);
});

test("Auflegen scheitert: Schritt Auflegen wird genannt", async (t) => {
  const anbieter = await aufgebaut(t, { status: () => HTTP_FEHLER, leseAnruf: async () => ANRUF });
  assert.equal(await post(`${anbieter.url}/v2/calls/cc_callee_h1/actions/hangup`, {}), HTTP_OK);
  await waitUntil(() => anbieter.fehler().length === 1);
  assert.match(anbieter.fehler()[0], /^Anruf h1 Schritt Auflegen: /);
});

test(
  "EL-Bein wird nie gewaehlt: Schritt EL-Wahl wird genannt",
  { timeout: WAHL_FRIST_MS * 2 },
  async (t) => {
    const anbieter = await aufgebaut(t, { status: () => HTTP_OK, leseAnruf: async () => ANRUF });
    assert.equal(await waehle(anbieter, "w1"), HTTP_OK);
    await waitUntil(() => anbieter.fehler().length === 1, { timeoutMs: WAHL_FRIST_MS });
    assert.match(anbieter.fehler()[0], /^Anruf w1 Schritt EL-Wahl: /);
  },
);

test("nach schliessen steht der Fehler nicht mehr in der Frist-Meldung", async (t) => {
  const anbieter = await aufgebaut(t, { status: () => HTTP_FEHLER, leseAnruf: async () => ANRUF });
  assert.equal(await waehle(anbieter, "s1"), HTTP_OK);
  await waitUntil(() => anbieter.fehler().length === 1);
  await anbieter.schliessen();
  assert.doesNotMatch(await anrufFrist(), /Fehler der Attrappe/);
});

test("leseAnrufBis wartet, bis die Zeile sichtbar wird", async () => {
  let abfragen = 0;
  const lies = async () =>
    (abfragen += 1) < 3 ? [] : [{ stream_token: "tok-s", from_e164: "+4915112340001" }];
  assert.deepEqual(await leseAnrufBis(lies, "c1"), ANRUF);
  assert.equal(abfragen, 3);
});

test("leseAnrufBis meldet nach der Frist, dass die Zeile nicht lesbar war", async () => {
  const fehler = await fristFehler(() => leseAnrufBis(async () => [], "c2", KURZE_FRIST_MS));
  assert.match(fehler, /^Zeile des Anrufs c2 nach \d+ ms nicht lesbar$/);
});
