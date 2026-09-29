// AL-D3 Review-Fix (Runde 2, AL-D3-TEST1): startConsultPump/pumpLoop
// (scripts/convo-bench/consult-pump.mjs) hatte keinen automatisierten Test - weder der
// Normalfall (consult-Event -> answer posten -> weiterpollen -> done-Event -> Rueckkehr)
// noch die beiden Fehlerpfade (403 -> geworfener Fehler bei stop(), Abort waehrend eines
// haengenden fetch). Muster: withEchoServer aus test/al-d3-http-fake-helpers.test.js -
// ein lokaler node:http-Server, den der Test selbst steuert, statt den Bench-Server zu
// spawnen (kein Netz, kein echter Anruf).
//
// AUTH-P7: der real erreichbare Fehlschlag ist seit dem Gate-Wegfall 403 (internalOnly,
// grund=not_local), nicht mehr 401 (Basic-Auth-Gate) - s. scripts/convo-bench/
// consult-pump.mjs Kopfkommentar.
//
// Testname-Praefix "AL-D3-" trifft KEIN Katalog-Praefix aus package.json
// config.i18nCatalogPattern - dieser Test laeuft in `npm test`, wo Rot zaehlt.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readJsonBody } from "../scripts/convo-bench/http-fake-helpers.mjs";
import { startConsultPump } from "../scripts/convo-bench/consult-pump.mjs";

const CALL_ID = "call1";
const CONSULT_PATH = `/api/calls/${CALL_ID}/consult`;
const ANSWER_PATH = `/api/calls/${CALL_ID}/consult/answer`;
// Kurze Wartezeit, die den ersten Poll-Zyklus sicher durchlaufen laesst, ohne den Test
// unnoetig zu verlangsamen (kein Timing-Rennen: der Fake antwortet synchron, diese
// Wartezeit deckt nur den Event-Loop-Umweg ueber fetch/Promise ab).
const POLL_SETTLE_MS = 30;
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const POLLS_UNTIL_DONE = 2;

async function withConsultServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("AL-D3-N6: startConsultPump beantwortet ein consult-Event und kehrt bei done zurueck", async () => {
  let getCount = 0;
  const answerBodies = [];
  let resolveDone;
  const donePromise = new Promise((resolve) => (resolveDone = resolve));

  const srv = await withConsultServer(async (req, res) => {
    if (req.method === "GET" && req.url.startsWith(CONSULT_PATH)) {
      getCount += 1;
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      if (getCount === 1) {
        res.end(JSON.stringify({ event: "consult", eventId: "e1", question: "Wie spaet passt es?" }));
      } else {
        res.end(JSON.stringify({ event: "done" }));
        resolveDone();
      }
      return;
    }
    if (req.method === "POST" && req.url === ANSWER_PATH) {
      answerBodies.push(await readJsonBody(req));
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(HTTP_NOT_FOUND);
    res.end();
  });

  try {
    const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: ["14 Uhr"] });
    await donePromise;
    await wait(POLL_SETTLE_MS); // laesst pumpLoop das done-Event verarbeiten und zurueckkehren
    await assert.doesNotReject(() => pump.stop());
    assert.equal(getCount, POLLS_UNTIL_DONE);
    assert.deepEqual(answerBodies, [{ event_id: "e1", answers: ["14 Uhr"] }]);
  } finally {
    await srv.close();
  }
});

test("AL-D3-N7: startConsultPump wirft ueber stop(), wenn die Pumpe auf eine 403-Antwort lief", async () => {
  const srv = await withConsultServer((req, res) => {
    res.writeHead(HTTP_FORBIDDEN);
    res.end();
  });
  try {
    const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: [] });
    await wait(POLL_SETTLE_MS); // laesst den ersten fetch auf die 403-Antwort laufen
    await assert.rejects(() => pump.stop(), /403/);
  } finally {
    await srv.close();
  }
});

test("AL-D3-N8: startConsultPump bricht sauber ab, wenn stop() waehrend eines haengenden fetch kommt", async () => {
  const srv = await withConsultServer(() => {
    // Antwortet absichtlich nie - simuliert einen haengenden GET-Request.
  });
  try {
    const pump = startConsultPump({ baseUrl: srv.url, callId: CALL_ID, answers: [] });
    await wait(POLL_SETTLE_MS); // laesst den fetch sicher in-flight sein
    await assert.doesNotReject(() => pump.stop());
  } finally {
    await srv.close();
  }
});
