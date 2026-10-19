import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { api } from "../../tools/wochenbericht/github.mjs";
import { echtWarten } from "../echt-warten.js";

const KURZE_FRIST_MS = 200;
const LANGSAME_ANTWORT_MS = 100;
const TESTFRIST_MS = 5000;
const UMGEBUNG = ["GITHUB_API_URL", "GH_TOKEN"];

async function attrappe(context, verhalten) {
  const anfragen = [];
  const offen = [];
  const server = createServer((anfrage, antwort) => {
    anfragen.push(`${anfrage.method} ${anfrage.url}`);
    offen.push(antwort);
    verhalten(anfragen.length, anfrage, antwort);
  });
  await new Promise((bereit) => server.listen(0, "127.0.0.1", bereit));
  const vorher = { ...process.env };
  Object.assign(process.env, { GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GH_TOKEN: "probe" });
  context.after(() => {
    for (const antwort of offen) antwort.destroy();
    server.close();
    for (const name of UMGEBUNG) {
      if (vorher[name] === undefined) delete process.env[name];
      else process.env[name] = vorher[name];
    }
  });
  return anfragen;
}

function json(antwort, status, inhalt) {
  antwort.writeHead(status, { "content-type": "application/json" });
  antwort.end(JSON.stringify(inhalt));
}

function trennen(anfrage) {
  anfrage.socket.destroy();
}

test("Wochenbericht: ein hängender Abruf endet an der Zeitgrenze und wird einmal wiederholt", { timeout: TESTFRIST_MS }, async (context) => {
  const anfragen = await attrappe(context, (nummer, anfrage, antwort) => {
    if (nummer > 1) json(antwort, 200, { stand: "zweiter Versuch" });
  });
  assert.deepEqual(await api("/rate_limit", { timeoutMs: KURZE_FRIST_MS }), { stand: "zweiter Versuch" });
  assert.equal(anfragen.length, 2);
});

test("Wochenbericht: eine langsame Antwort innerhalb der Zeitgrenze kommt ohne Wiederholung durch", async (context) => {
  const anfragen = await attrappe(context, async (nummer, anfrage, antwort) => {
    await echtWarten(LANGSAME_ANTWORT_MS);
    json(antwort, 200, { stand: "langsam" });
  });
  assert.deepEqual(await api("/rate_limit"), { stand: "langsam" });
  assert.equal(anfragen.length, 1);
});

test("Wochenbericht: ein Netzfehler wird genau einmal wiederholt", async (context) => {
  const anfragen = await attrappe(context, (nummer, anfrage, antwort) => {
    if (nummer === 1) trennen(anfrage);
    else json(antwort, 200, { stand: "wieder da" });
  });
  assert.deepEqual(await api("/rate_limit"), { stand: "wieder da" });
  assert.equal(anfragen.length, 2);
});

test("Wochenbericht: nach zwei Netzfehlern hintereinander bricht der Abruf ab", async (context) => {
  const anfragen = await attrappe(context, (nummer, anfrage) => trennen(anfrage));
  await assert.rejects(api("/rate_limit"), /GET \/rate_limit keine Antwort liefert/);
  assert.equal(anfragen.length, 2);
});

for (const status of [404, 500, 503]) {
  test(`Wochenbericht: HTTP ${status} bricht sofort ab, ohne Wiederholung`, async (context) => {
    const anfragen = await attrappe(context, (nummer, anfrage, antwort) => json(antwort, status, { message: "nein" }));
    await assert.rejects(api("/rate_limit"), new RegExp(`mit HTTP ${status} antwortet`));
    assert.equal(anfragen.length, 1);
  });
}

test("Wochenbericht: ein schreibender Aufruf wird nach einem Netzfehler nicht wiederholt", async (context) => {
  const anfragen = await attrappe(context, (nummer, anfrage) => trennen(anfrage));
  await assert.rejects(api("/repos/sundartha/hermes/issues", { method: "POST", body: { title: "Bericht" } }));
  assert.deepEqual(anfragen, ["POST /repos/sundartha/hermes/issues"]);
});
