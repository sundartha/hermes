import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";

let server;
let basis;

before(async () => {
  server = http.createServer(() => {});
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  basis = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((fertig) => server.close(fertig));
});

test("AK1: ohne Antwort nennt der Fristfehler Dauer, Methode und Pfad", async () => {
  await assert.rejects(abrufMitFrist(`${basis}/still`, { method: "POST" }), (fehler) => {
    assert.equal(fehler.name, "TimeoutError");
    assert.match(fehler.message, /keine Antwort nach 5000 ms: POST \/still/);
    return true;
  });
});

test("AK1: ohne Methode steht GET in der Meldung", async () => {
  await assert.rejects(abrufMitFrist(`${basis}/leise`), /keine Antwort nach 5000 ms: GET \/leise/);
});

test("AK2: mit wartezeitMs nennt die Meldung die Summe", async () => {
  await assert.rejects(
    abrufMitFrist(`${basis}/still`, { method: "post" }, { wartezeitMs: 100 }),
    /keine Antwort nach 5100 ms: POST \/still/,
  );
});

test("AK3: ein Abbruch des Aufrufers bleibt unverändert", async () => {
  const grund = new Error("vom Aufrufer abgebrochen");
  const abbruch = new AbortController();
  const lauf = abrufMitFrist(`${basis}/still`, { signal: abbruch.signal });
  abbruch.abort(grund);
  await assert.rejects(lauf, (fehler) => {
    assert.equal(fehler, grund);
    return true;
  });
});

