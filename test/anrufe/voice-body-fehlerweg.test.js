import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { installGlobalMiddleware } from "../../src/app.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./routen-server.js";

const HTTP_SERVER_ERROR = 500;
const UNERREICHBARES_LIMIT_PRO_MIN = 1000;
const KONFIG = Object.freeze({ safety: Object.freeze({ rateLimitPerMin: UNERREICHBARES_LIMIT_PRO_MIN }) });

function routerMitKaputtemBody() {
  const router = express.Router();
  router.use((req, _res, next) => {
    req.setEncoding("utf8");
    next();
  });
  installGlobalMiddleware({ app: router, config: KONFIG });
  router.post("/voice/incoming", (_req, res) => res.send("handler erreicht"));
  return router;
}

test("Serverseitiger Fehler beim Lesen des Voice-Bodys: geht an den Fehlerbehandler, wird nicht als Ablehnung des Anrufers gemeldet", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    await mitRoutenServer(routerMitKaputtemBody(), async (url) => {
      const res = await abrufMitFrist(`${url}/voice/incoming`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "CallSid=CAfehlerweg",
      });
      assert.equal(res.status, HTTP_SERVER_ERROR);
      assert.match(res.headers.get("content-type"), /^text\/html/, "Standard-Fehlerseite, nicht das JSON der Ablehnung");
      assert.ok(!(await res.text()).includes("stream.encoding.set"), "der Fehlertyp wird dem Aufrufer nicht zurueckgegeben");
    });
    const zeilen = log.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.ok(!zeilen.some((zeile) => zeile.includes("body_abgelehnt")), zeilen.join("\n"));
  } finally {
    log.mock.restore();
  }
});
