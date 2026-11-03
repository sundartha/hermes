import { test } from "node:test";
import assert from "node:assert/strict";

import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE, SCHLUESSEL, COMMIT, bearer } from "./statusroute-hilfe.mjs";
import { mitGescheitertemFlush } from "./flush-verhalten-hilfe.mjs";

process.env.HERMES_STATUS_TOKEN = SCHLUESSEL;
process.env.RENDER_GIT_COMMIT = COMMIT;
const { starteHermesMitPglite } = await import("../abrechnung/server-mit-testdatenbank.js");

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "postfach@flush.invalid" });
const speicher = await import("../../src/store.js");

async function statusAbrufen() {
  const antwort = await laufendesHermes().anfrage("/intern/status", {
    headers: { authorization: bearer(SCHLUESSEL) },
  });
  return { status: antwort.status, koerper: await antwort.json() };
}

test("[NIE7] am laufenden Server mit pg-Speicher antwortet /intern/status 200 mit flush true, nach gescheitertem Flush 503 mit flush false, nach gelungenem Flush wieder 200", async () => {
  const { db } = laufendesHermes();
  const vorher = await statusAbrufen();
  assert.equal(vorher.status, HTTP_OK);
  assert.equal(vorher.koerper.flush, true);

  const waehrendDesFehlers = await mitGescheitertemFlush(db, speicher, statusAbrufen);
  assert.equal(waehrendDesFehlers.status, HTTP_SERVICE_UNAVAILABLE);
  assert.equal(waehrendDesFehlers.koerper.flush, false);

  const danach = await statusAbrufen();
  assert.equal(danach.status, HTTP_OK);
  assert.equal(danach.koerper.flush, true);
});
