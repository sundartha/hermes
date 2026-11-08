import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { anfrage } from "../../src/utils/anfrage.js";

const FRIST_MS = 50;
const OBERGRENZE_MS = 2_000;
const LANGE_FRIST_MS = 60_000;
const TESTGRENZE = { timeout: 5_000 };
const UNGUELTIGE_FRISTEN = [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "50", {}];

async function mitSchweigendemServer(lauf) {
  const eingaenge = [];
  const server = createServer((anfrageEingang) => {
    eingaenge.push(anfrageEingang.url);
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const url = `http://127.0.0.1:${server.address().port}/stumm`;
  try {
    return await lauf(url, eingaenge);
  } finally {
    server.closeAllConnections();
    await new Promise((fertig) => server.close(fertig));
  }
}

async function mitErsatzFetch(antwort, lauf) {
  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (...argumente) => {
    aufrufe.push(argumente);
    return antwort;
  };
  try {
    return await lauf(aufrufe);
  } finally {
    globalThis.fetch = original;
  }
}

test("Eine Gegenseite, die nicht antwortet, bricht die Anfrage nach der Frist mit TimeoutError ab", TESTGRENZE, async () => {
  await mitSchweigendemServer(async (url) => {
    const start = performance.now();
    await assert.rejects(anfrage(url, { fristMs: FRIST_MS }), { name: "TimeoutError" });
    assert.ok(performance.now() - start < OBERGRENZE_MS);
  });
});

test("Ohne gültige Frist wirft anfrage einen TypeError und ruft fetch nicht auf", async () => {
  await mitErsatzFetch(new Response("ok"), async (aufrufe) => {
    for (const frist of UNGUELTIGE_FRISTEN) {
      await assert.rejects(anfrage("https://x.test", { fristMs: frist }), { name: "TypeError" });
    }
    await assert.rejects(anfrage("https://x.test", {}), { name: "TypeError" });
    await assert.rejects(anfrage("https://x.test"), { name: "TypeError" });
    assert.equal(aufrufe.length, 0);
  });
});

test("Feuert das eigene Signal vor der Frist, bleibt dessen Abbruchgrund erhalten", TESTGRENZE, async () => {
  await mitSchweigendemServer(async (url) => {
    const steuerung = new AbortController();
    const grund = new Error("vom Aufrufer abgebrochen");
    const lauf = anfrage(url, { fristMs: LANGE_FRIST_MS, signal: steuerung.signal });
    steuerung.abort(grund);
    await assert.rejects(lauf, (fehler) => fehler === grund);
  });
});

test("Läuft die Frist vor dem eigenen Signal ab, ist der Abbruchgrund TimeoutError", TESTGRENZE, async () => {
  await mitSchweigendemServer(async (url) => {
    const steuerung = new AbortController();
    await assert.rejects(anfrage(url, { fristMs: FRIST_MS, signal: steuerung.signal }), {
      name: "TimeoutError",
    });
    assert.equal(steuerung.signal.aborted, false);
  });
});

test("Ein vorab abgebrochenes Signal bricht sofort ab, ohne dass die Anfrage gesendet wird", TESTGRENZE, async () => {
  await mitSchweigendemServer(async (url, eingaenge) => {
    await assert.rejects(anfrage(url, { fristMs: LANGE_FRIST_MS, signal: AbortSignal.abort() }), {
      name: "AbortError",
    });
    assert.deepEqual(eingaenge, []);
  });
});

test("fetch bekommt URL, Methode, Header und Body unverändert, aber nie fristMs, und die Antwort kommt durch", async () => {
  const antwort = new Response("antwort");
  await mitErsatzFetch(antwort, async (aufrufe) => {
    const headers = { "content-type": "application/json" };
    const erhalten = await anfrage("https://x.test/pfad", {
      fristMs: FRIST_MS,
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(erhalten, antwort);
    assert.equal(aufrufe.length, 1);
    const [url, optionen] = aufrufe[0];
    assert.equal(url, "https://x.test/pfad");
    assert.equal(optionen.method, "POST");
    assert.deepEqual(optionen.headers, headers);
    assert.equal(optionen.body, "{}");
    assert.equal("fristMs" in optionen, false);
    assert.ok(optionen.signal instanceof AbortSignal);
    assert.equal(optionen.signal.aborted, false);
  });
});
