import "../../src/process-guards.js";
import "../../src/config.js";
import { once } from "node:events";
import express from "express";
import { errorHandler } from "../../src/middleware.js";
import { telnyxNumberProvisioning } from "../../src/telephony/adapters/telnyx/numbers.js";
import { audit } from "../../src/util.js";

const NUTZLAST = process.env.LOGWEG_NUTZLAST;
const zeile = (weg) => `[weg:${weg}] ${NUTZLAST}`;

function konsolenWege() {
  console.log(zeile("console.log"));
  console.info(zeile("console.info"));
  console.debug(zeile("console.debug"));
  console.warn(zeile("console.warn"));
  console.error(zeile("console.error"));
  console.trace(zeile("console.trace"));
  console.dir({ wert: zeile("console.dir") });
  console.dirxml(zeile("console.dirxml"));
  console.table([{ wert: zeile("console.table") }]);
  console.assert(false, zeile("console.assert"));
  console.group(zeile("console.group"));
  console.groupEnd();
  console.count(zeile("console.count"));
  console.time(zeile("console.timeLog"));
  console.timeLog(zeile("console.timeLog"));
}

function stromWege() {
  process.stdout.write(`${zeile("stdout.write")}\n`);
  process.stderr.write(`${zeile("stderr.write")}\n`);
  audit("logweg_probe", null, zeile("audit"));
  process.emitWarning(zeile("emitWarning"));
}

function probeApp() {
  const app = express();
  app.set("env", "production");
  app.get("/vor-antwort", () => {
    throw new Error(zeile("errorHandler"));
  });
  app.get("/nach-antwort", (_req, res, next) => {
    res.send("ok");
    next(new Error(zeile("express-nach-antwort")));
  });
  app.get("/async-nach-antwort", async (_req, res) => {
    res.send("ok");
    throw new Error(zeile("async-route"));
  });
  app.use(errorHandler);
  return app;
}

async function expressWege() {
  const server = probeApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const basis = `http://127.0.0.1:${server.address().port}`;
  for (const pfad of ["/vor-antwort", "/nach-antwort", "/async-nach-antwort"]) {
    await fetch(`${basis}${pfad}`).then((antwort) => antwort.text()).catch(() => "");
  }
  server.closeAllConnections();
  server.close();
}

async function anbieterWeg() {
  try {
    await telnyxNumberProvisioning.searchNumbers({ countryCode: "DE" });
  } catch (err) {
    console.error("[provision-worker]", err.message);
  }
}

function unbehandelteWege() {
  setImmediate(() => {
    throw new Error(zeile("uncaughtException"));
  });
  Promise.reject(new Error(zeile("unhandledRejection")));
}

konsolenWege();
stromWege();
await expressWege();
await anbieterWeg();
unbehandelteWege();
