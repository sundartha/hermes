import assert from "node:assert/strict";
import { mock, test } from "node:test";

import express from "express";

import konfiguration from "../../eslint.config.js";
import { installGlobalMiddleware } from "../../src/app.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { mitRoutenServer } from "./routen-server.js";

const JETZT_MS = 1_800_000_000_000;
const DAUER_MS = 250;
const UNERREICHBARES_LIMIT_PRO_MIN = 1000;
const KONFIG = Object.freeze({ safety: Object.freeze({ rateLimitPerMin: UNERREICHBARES_LIMIT_PRO_MIN }) });
const bestand = konfiguration.find((block) => block.name === "uhr-als-wert").ignores;

for (const datei of ["ani-ownership-recheck.js", "antwortdauer.ts", "call-lifecycle.ts", "reattach.ts", "webhook-idempotenz.ts"]) {
  test(`uhr-telephony: ${datei} steht nicht mehr im Uhr-Bestand`, () => {
    assert.ok(!bestand.includes(`src/telephony/${datei}`));
  });
}

test("uhr-telephony: die Antwortdauer der Voice-Anfrage ist der Abstand der Uhr zwischen Eingang und Ende", async () => {
  const log = mock.method(console, "log", () => {});
  mock.timers.enable({ apis: ["Date"], now: JETZT_MS });
  try {
    const router = express.Router();
    installGlobalMiddleware({ app: router, config: KONFIG });
    router.post("/voice/incoming", (_req, res) => {
      mock.timers.tick(DAUER_MS);
      res.send("ok");
    });
    await mitRoutenServer(router, async (url) => {
      const res = await abrufMitFrist(`${url}/voice/incoming`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "CallSid=CAuhr",
      });
      assert.equal(await res.text(), "ok");
    });
    const zeilen = log.mock.calls.map((aufruf) => aufruf.arguments.join(" "));
    assert.ok(zeilen.some((zeile) => zeile.endsWith("[voice-antwort] weg=/voice/incoming ms=250 status=200 ende=beendet")), zeilen.join("\n"));
  } finally {
    mock.timers.reset();
    log.mock.restore();
  }
});
